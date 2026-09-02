import * as crypto from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AssetRelocationInjectedTermination,
  ProjectAssetRelocationAuthority,
  type AssetRelocationFaultPoint,
} from '../src/asset-import-authority/asset-relocation-authority.js';
import { AssetRelocationStore } from '../src/asset-import-authority/asset-relocation-store.js';
import { AssetProjectMutationCoordinator } from '../src/asset-import-authority/mutation-coordinator.js';
import { openAssetImportAuthorityPaths, assetImportFileIdentity } from '../src/asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';

const roots: string[] = [];
const operationId = '11111111-1111-4111-8111-111111111111';
const batchOperationId = '22222222-2222-4222-8222-222222222222';
const sourcePath = 'content/assets/bg/old.webp';
const targetPath = 'content/assets/bg/new.webp';
const batchSourceA = 'content/assets/bg/batch-a.webp';
const batchSourceB = 'content/assets/bg/batch-b.webp';
const batchTargetA = 'content/assets/bg/batch-a-new.webp';
const batchTargetB = 'content/assets/bg/batch-b-new.webp';
const scenePath = 'content/scenario/start.gal';
const secondScenePath = 'content/scenario/second.gal';
const tempRoot = process.env['SURDET_TEST_TEMP_ROOT']
  ?? process.env['TEMP']
  ?? process.env['TMP']
  ?? os.tmpdir();

const textHasher = {
  sha256: async (text: string): Promise<string> => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
};

function absolute(projectRoot: string, relativePath: string): string {
  return path.join(projectRoot, ...relativePath.split('/'));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

interface FixtureOptions {
  faultPoint?: AssetRelocationFaultPoint;
  faultOccurrence?: number;
  secondScene?: boolean;
  targetPath?: string;
}

interface Fixture {
  projectRoot: string;
  paths: Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>;
  authority: ProjectAssetRelocationAuthority;
  store: AssetRelocationStore;
  barrierStore: AssetImportRecordStore;
  sourceFile: string;
  targetPath: string;
}

interface BatchFixtureOptions {
  faultPoint?: AssetRelocationFaultPoint;
  faultOccurrence?: number;
  exchange?: boolean;
}

interface BatchFixture {
  projectRoot: string;
  paths: Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>;
  authority: ProjectAssetRelocationAuthority;
  store: AssetRelocationStore;
  barrierStore: AssetImportRecordStore;
  sourceA: string;
  sourceB: string;
  targetA: string;
  targetB: string;
  sceneFile: string;
}

function makeAuthority(
  paths: Fixture['paths'],
  faultPoint?: AssetRelocationFaultPoint,
  coordinator?: AssetProjectMutationCoordinator,
  barrierStore = new AssetImportRecordStore(paths),
  faultOccurrence = 1,
): ProjectAssetRelocationAuthority {
  const store = new AssetRelocationStore(paths);
  let faultCalls = 0;
  return new ProjectAssetRelocationAuthority(paths, store, barrierStore, {
    textHasher,
    assertLeaseHeld: () => undefined,
    ...(coordinator === undefined ? {} : { mutationCoordinator: coordinator }),
    ...(faultPoint === undefined ? {} : {
      faultInjector: async (point) => {
        if (point === faultPoint && ++faultCalls === faultOccurrence) throw new Error(`test fault: ${point}`);
      },
    }),
  });
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(tempRoot!, 'surdet-asset-relocation-authority-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  const target = options.targetPath ?? targetPath;
  await mkdir(path.dirname(absolute(projectRoot, sourcePath)), { recursive: true });
  await mkdir(path.dirname(absolute(projectRoot, target)), { recursive: true });
  await mkdir(path.dirname(absolute(projectRoot, scenePath)), { recursive: true });
  await writeFile(
    absolute(projectRoot, 'game.config.json'),
    '{"entryScene":"start","characters":{},"variables":{}}\n',
  );
  await writeFile(absolute(projectRoot, scenePath), '@scene start\n@bg old\n@end\n');
  if (options.secondScene === true) {
    await writeFile(absolute(projectRoot, secondScenePath), '@scene second\n@bg old\n@end\n');
  }
  await writeFile(absolute(projectRoot, sourcePath), Buffer.from('source-bytes'));

  const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot });
  const store = new AssetRelocationStore(paths);
  const barrierStore = new AssetImportRecordStore(paths);
  const authority = makeAuthority(paths, options.faultPoint, undefined, barrierStore);
  return {
    projectRoot,
    paths,
    authority,
    store,
    barrierStore,
    sourceFile: absolute(projectRoot, sourcePath),
    targetPath: target,
  };
}

async function batchFixture(options: BatchFixtureOptions = {}): Promise<BatchFixture> {
  const root = await mkdtemp(path.join(tempRoot!, 'surdet-asset-relocation-batch-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  const targetA = options.exchange === true ? batchSourceB : batchTargetA;
  const targetB = options.exchange === true ? batchSourceA : batchTargetB;
  await mkdir(path.dirname(absolute(projectRoot, batchSourceA)), { recursive: true });
  await mkdir(path.dirname(absolute(projectRoot, batchSourceB)), { recursive: true });
  await mkdir(path.dirname(absolute(projectRoot, targetA)), { recursive: true });
  await mkdir(path.dirname(absolute(projectRoot, targetB)), { recursive: true });
  await mkdir(path.dirname(absolute(projectRoot, scenePath)), { recursive: true });
  await writeFile(
    absolute(projectRoot, 'game.config.json'),
    '{"entryScene":"start","characters":{},"variables":{}}\n',
  );
  const sceneFile = absolute(projectRoot, scenePath);
  await writeFile(sceneFile, '@scene start\n@bg batch-a\n@bg batch-b\n@end\n');
  await writeFile(absolute(projectRoot, batchSourceA), Buffer.from('batch-source-a'));
  await writeFile(absolute(projectRoot, batchSourceB), Buffer.from('batch-source-b'));

  const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot });
  const store = new AssetRelocationStore(paths);
  const barrierStore = new AssetImportRecordStore(paths);
  const authority = makeAuthority(
    paths,
    options.faultPoint,
    undefined,
    barrierStore,
    options.faultOccurrence,
  );
  return {
    projectRoot,
    paths,
    authority,
    store,
    barrierStore,
    sourceA: absolute(projectRoot, batchSourceA),
    sourceB: absolute(projectRoot, batchSourceB),
    targetA: absolute(projectRoot, targetA),
    targetB: absolute(projectRoot, targetB),
    sceneFile,
  };
}

async function plan(fixtureValue: Fixture, id = operationId) {
  const result = await fixtureValue.authority.plan({
    operationId: id,
    sourcePath,
    targetPath: fixtureValue.targetPath,
  });
  expect(result.plan.status).toBe('ready');
  return result;
}

interface BatchMoveReceipt {
  sourcePath: string;
  targetPath: string;
  targetIdentity: Record<string, unknown>;
}

interface BatchUndoMoveReceipt {
  sourcePath: string;
  targetPath: string;
  sourceIdentity: Record<string, unknown>;
}

interface BatchReceipt {
  operationId: string;
  moves: BatchMoveReceipt[];
}

interface BatchUndoReceipt {
  operationId: string;
  moves: BatchUndoMoveReceipt[];
}

function requireBatchReceipt(value: unknown): BatchReceipt {
  const receipt = value as BatchReceipt | null;
  expect(receipt).not.toBeNull();
  expect(Array.isArray(receipt?.moves)).toBe(true);
  return receipt!;
}

function requireBatchUndoReceipt(value: unknown): BatchUndoReceipt {
  const receipt = value as BatchUndoReceipt | null;
  expect(receipt).not.toBeNull();
  expect(Array.isArray(receipt?.moves)).toBe(true);
  return receipt!;
}

interface BatchMove {
  sourcePath: string;
  targetPath: string;
}

async function planBatch(
  fixtureValue: BatchFixture,
  moves: BatchMove[],
  id = batchOperationId,
) {
  const result = await fixtureValue.authority.plan({ operationId: id, moves } as never);
  expect(result.plan.status).toBe('ready');
  return result;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project asset relocation authority', () => {
  it('commits with identity-bearing receipt and undoes the complete relocation', async () => {
    const fixtureValue = await fixture();
    const beforeText = await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8');
    const sourceIdentity = await assetImportFileIdentity(fixtureValue.sourceFile);
    const planned = await plan(fixtureValue);

    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    expect(committed.operation.status).toBe('COMMITTED');
    expect(committed.receipt).not.toBeNull();
    expect(committed.receipt).toMatchObject({
      operationId,
      projectIdentity: fixtureValue.paths.projectIdentity,
      sourcePath,
      targetPath: targetPath,
    });
    expect(committed.receipt!.targetIdentity).toMatchObject(sourceIdentity);
    expect(committed.receipt!.targetIdentity.sha256).toBe(
      crypto.createHash('sha256').update('source-bytes').digest('hex'),
    );
    const targetFile = absolute(fixtureValue.projectRoot, targetPath);
    const { sha256: _targetSha256, ...targetIdentity } = committed.receipt!.targetIdentity;
    expect(await assetImportFileIdentity(targetFile)).toEqual(targetIdentity);
    await expect(stat(fixtureValue.sourceFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(targetFile, 'utf8')).resolves.toBe('source-bytes');
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toBe(beforeText.replace('old', 'new'));

    const undone = await fixtureValue.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    });
    expect(undone.operation.status).toBe('UNDONE');
    expect(undone.undoReceipt).toMatchObject({ operationId, sourcePath, targetPath });
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
    await expect(stat(targetFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8')).resolves.toBe(beforeText);
  });

  it('rejects a stale source before any project material write', async () => {
    const fixtureValue = await fixture();
    const beforeText = await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8');
    const planned = await plan(fixtureValue);
    const beforeRecord = await fixtureValue.store.read(operationId);
    await writeFile(fixtureValue.sourceFile, Buffer.from('changed-source'));

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    expect(await readFile(fixtureValue.sourceFile, 'utf8')).toBe('changed-source');
    await expect(stat(absolute(fixtureValue.projectRoot, targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8')).toBe(beforeText);
    const afterRecord = await fixtureValue.store.read(operationId);
    expect(afterRecord?.journal.status).toBe('PLANNED');
    expect(afterRecord?.journal.journalVersion).toBe(beforeRecord?.journal.journalVersion);
  });

  it('rejects same-content text replacement with a different inode before writing', async () => {
    const fixtureValue = await fixture();
    const beforeText = await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8');
    const planned = await plan(fixtureValue);
    const replacement = path.join(path.dirname(absolute(fixtureValue.projectRoot, scenePath)), 'replacement.gal');
    await writeFile(replacement, beforeText);
    await rm(absolute(fixtureValue.projectRoot, scenePath));
    await rename(replacement, absolute(fixtureValue.projectRoot, scenePath));

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    expect(await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8')).toBe(beforeText);
    await expect(stat(absolute(fixtureValue.projectRoot, targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('PLANNED');
  });

  it('runs undo preflight for every touched text file before changing any of them', async () => {
    const fixtureValue = await fixture({ secondScene: true });
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const firstTextPath = absolute(fixtureValue.projectRoot, scenePath);
    const secondTextPath = absolute(fixtureValue.projectRoot, secondScenePath);
    const firstAfter = await readFile(firstTextPath, 'utf8');
    const targetFile = absolute(fixtureValue.projectRoot, targetPath);
    await writeFile(secondTextPath, 'external edit\n');
    const beforeUndo = await fixtureValue.store.read(operationId);

    await expect(fixtureValue.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_UNDO_BLOCKED_CHANGED' });
    expect(await readFile(firstTextPath, 'utf8')).toBe(firstAfter);
    expect(await readFile(secondTextPath, 'utf8')).toBe('external edit\n');
    await expect(readFile(targetFile, 'utf8')).resolves.toBe('source-bytes');
    await expect(stat(fixtureValue.sourceFile)).rejects.toMatchObject({ code: 'ENOENT' });
    const afterUndo = await fixtureValue.store.read(operationId);
    expect(afterUndo?.journal.status).toBe('COMMITTED');
    expect(afterUndo?.journal.journalVersion).toBe(beforeUndo?.journal.journalVersion);
  });

  it('clears a recovery barrier when an idempotent terminal request verifies committed or undone state', async () => {
    const fixtureValue = await fixture();
    const barrierStore = fixtureValue.barrierStore;
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    await barrierStore.ensureRelocationRecoveryBarrier(operationId, new Date().toISOString(), 'terminal-commit-window');
    expect(await barrierStore.hasUnresolvedBarrier('asset-relocation')).toBe(true);

    await fixtureValue.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    expect(await barrierStore.hasUnresolvedBarrier('asset-relocation')).toBe(false);

    const undone = await fixtureValue.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    });
    await barrierStore.ensureRelocationRecoveryBarrier(operationId, new Date().toISOString(), 'terminal-undo-window');
    expect(await barrierStore.hasUnresolvedBarrier('asset-relocation')).toBe(true);

    await fixtureValue.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    });
    expect(undone.operation.status).toBe('UNDONE');
    expect(await barrierStore.hasUnresolvedBarrier('asset-relocation')).toBe(false);
  });

  it.each([
    ['after_binary_backup_intent', 'BACKUP_INTENT'],
    ['after_target_link_intent', 'TARGET_INTENT'],
  ] as const)('recovers an interrupted %s journal state', async (faultPoint, expectedBinaryState) => {
    const fixtureValue = await fixture({ faultPoint });
    const planned = await plan(fixtureValue);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const interrupted = await fixtureValue.store.read(operationId);
    expect(interrupted?.journal.status).toBe('PUBLISHING');
    expect(interrupted?.journal.binaryState).toBe(expectedBinaryState);

    const recovered = makeAuthority(fixtureValue.paths);
    const result = await recovered.recover(operationId, { action: 'resume' });
    expect(result.operation.status).toBe('COMMITTED');
    await expect(stat(fixtureValue.sourceFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(absolute(fixtureValue.projectRoot, targetPath), 'utf8'))
      .resolves.toBe('source-bytes');
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toContain('new');
  });

  it('does not overwrite a target created after planning', async () => {
    const fixtureValue = await fixture();
    const beforeSource = await readFile(fixtureValue.sourceFile, 'utf8');
    const beforeText = await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8');
    const planned = await plan(fixtureValue);
    const targetFile = absolute(fixtureValue.projectRoot, targetPath);
    await writeFile(targetFile, 'external-target');

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    await expect(readFile(targetFile, 'utf8')).resolves.toBe('external-target');
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe(beforeSource);
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8')).resolves.toBe(beforeText);
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('PLANNED');
  });

  it('commits a two-move exchange with one operation, receipt, and undo', async () => {
    const fixtureValue = await batchFixture({ exchange: true });
    const moves: BatchMove[] = [
      { sourcePath: batchSourceA, targetPath: batchSourceB },
      { sourcePath: batchSourceB, targetPath: batchSourceA },
    ];
    const beforeScene = await readFile(fixtureValue.sceneFile, 'utf8');
    const planned = await planBatch(fixtureValue, moves);
    const plannedRequest = planned.request as unknown as { operationId: string; moves: BatchMove[] };
    const plannedPlan = planned.plan as unknown as { moves: unknown[]; affectedAssetCount: number };
    expect(plannedRequest).toMatchObject({ operationId: batchOperationId, moves });
    expect(plannedPlan.moves).toHaveLength(2);
    expect(plannedPlan.affectedAssetCount).toBe(2);

    const committed = await fixtureValue.authority.commit(batchOperationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    expect(committed.operation.status).toBe('COMMITTED');
    const receipt = requireBatchReceipt(committed.receipt);
    const receiptIdentity = committed.receipt as unknown as {
      receiptId: string;
      receiptFingerprint: string;
    };
    expect(receipt).toMatchObject({ operationId: batchOperationId });
    expect(receipt.moves).toHaveLength(2);
    expect(await readFile(fixtureValue.targetA, 'utf8')).toBe('batch-source-a');
    expect(await readFile(fixtureValue.targetB, 'utf8')).toBe('batch-source-b');
    await expect(readFile(fixtureValue.sceneFile, 'utf8')).resolves.toBe(
      '@scene start\n@bg batch-b\n@bg batch-a\n@end\n',
    );

    const undone = await fixtureValue.authority.undo(batchOperationId, {
      receiptId: receiptIdentity.receiptId,
      receiptFingerprint: receiptIdentity.receiptFingerprint,
    });
    expect(undone.operation.status).toBe('UNDONE');
    const undoReceipt = requireBatchUndoReceipt(undone.undoReceipt);
    expect(undoReceipt).toMatchObject({ operationId: batchOperationId });
    expect(undoReceipt.moves).toHaveLength(2);
    await expect(readFile(fixtureValue.sourceA, 'utf8')).resolves.toBe('batch-source-a');
    await expect(readFile(fixtureValue.sourceB, 'utf8')).resolves.toBe('batch-source-b');
    await expect(readFile(fixtureValue.sceneFile, 'utf8')).resolves.toBe(beforeScene);
    const record = await fixtureValue.store.read(batchOperationId);
    expect(record?.receipt).not.toBeNull();
    expect(record?.undoReceipt).not.toBeNull();
  });

  it('rolls back the whole batch when the second target publication faults', async () => {
    const fixtureValue = await batchFixture({
      faultPoint: 'after_target_link_intent' as AssetRelocationFaultPoint,
      faultOccurrence: 2,
    });
    const moves: BatchMove[] = [
      { sourcePath: batchSourceA, targetPath: batchTargetA },
      { sourcePath: batchSourceB, targetPath: batchTargetB },
    ];
    const beforeScene = await readFile(fixtureValue.sceneFile, 'utf8');
    const planned = await planBatch(fixtureValue, moves);

    await expect(fixtureValue.authority.commit(batchOperationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    expect((await fixtureValue.store.read(batchOperationId))?.journal.status).toBe('PUBLISHING');

    const recovered = makeAuthority(fixtureValue.paths);
    const rolledBack = await recovered.recover(batchOperationId, { action: 'rollback' });
    expect(rolledBack.operation.status).toBe('ROLLED_BACK');
    await expect(readFile(fixtureValue.sourceA, 'utf8')).resolves.toBe('batch-source-a');
    await expect(readFile(fixtureValue.sourceB, 'utf8')).resolves.toBe('batch-source-b');
    await expect(stat(fixtureValue.targetA)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(fixtureValue.targetB)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixtureValue.sceneFile, 'utf8')).resolves.toBe(beforeScene);
    const record = await fixtureValue.store.read(batchOperationId);
    expect(record?.receipt).toBeNull();
    expect(record?.undoReceipt).toBeNull();
  });

  it('does not write any batch file when the second source drifts after planning', async () => {
    const fixtureValue = await batchFixture();
    const moves: BatchMove[] = [
      { sourcePath: batchSourceA, targetPath: batchTargetA },
      { sourcePath: batchSourceB, targetPath: batchTargetB },
    ];
    const planned = await planBatch(fixtureValue, moves);
    const beforeRecord = await fixtureValue.store.read(batchOperationId);
    const beforeSourceA = await readFile(fixtureValue.sourceA, 'utf8');
    const beforeScene = await readFile(fixtureValue.sceneFile, 'utf8');
    await writeFile(fixtureValue.sourceB, 'changed-after-plan');

    await expect(fixtureValue.authority.commit(batchOperationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    await expect(readFile(fixtureValue.sourceA, 'utf8')).resolves.toBe(beforeSourceA);
    await expect(readFile(fixtureValue.sourceB, 'utf8')).resolves.toBe('changed-after-plan');
    await expect(stat(fixtureValue.targetA)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(fixtureValue.targetB)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixtureValue.sceneFile, 'utf8')).resolves.toBe(beforeScene);
    const afterRecord = await fixtureValue.store.read(batchOperationId);
    expect(afterRecord?.journal.status).toBe('PLANNED');
    expect(afterRecord?.journal.journalVersion).toBe(beforeRecord?.journal.journalVersion);
  });

  it('does not partially undo when the second target drifts after commit', async () => {
    const fixtureValue = await batchFixture();
    const moves: BatchMove[] = [
      { sourcePath: batchSourceA, targetPath: batchTargetA },
      { sourcePath: batchSourceB, targetPath: batchTargetB },
    ];
    const planned = await planBatch(fixtureValue, moves);
    const committed = await fixtureValue.authority.commit(batchOperationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const receiptIdentity = committed.receipt as unknown as {
      receiptId: string;
      receiptFingerprint: string;
    };
    const beforeUndo = await fixtureValue.store.read(batchOperationId);
    const afterScene = await readFile(fixtureValue.sceneFile, 'utf8');
    await writeFile(fixtureValue.targetB, 'changed-before-undo');

    await expect(fixtureValue.authority.undo(batchOperationId, {
      receiptId: receiptIdentity.receiptId,
      receiptFingerprint: receiptIdentity.receiptFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_UNDO_BLOCKED_CHANGED' });
    await expect(readFile(fixtureValue.targetA, 'utf8')).resolves.toBe('batch-source-a');
    await expect(readFile(fixtureValue.targetB, 'utf8')).resolves.toBe('changed-before-undo');
    await expect(stat(fixtureValue.sourceA)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(fixtureValue.sourceB)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixtureValue.sceneFile, 'utf8')).resolves.toBe(afterScene);
    const afterUndo = await fixtureValue.store.read(batchOperationId);
    expect(afterUndo?.journal.status).toBe('COMMITTED');
    expect(afterUndo?.journal.journalVersion).toBe(beforeUndo?.journal.journalVersion);
  });

  it('shares one coordinator lane without self-gating and without overlap', async () => {
    const coordinator = new AssetProjectMutationCoordinator();
    const events: string[] = [];
    let importGateCalls = 0;
    coordinator.register('asset-import', () => {
      importGateCalls += 1;
      events.push('import-gate');
    });
    coordinator.register('asset-relocation', () => {
      events.push('relocation-gate');
    });
    const entered = deferred<void>();
    const release = deferred<void>();
    const first = coordinator.run('asset-import', async () => {
      events.push('import-enter');
      entered.resolve();
      await release.promise;
      events.push('import-exit');
    });
    await entered.promise;
    const second = coordinator.run('asset-relocation', async () => {
      events.push('relocation-enter');
    });
    expect(events).toEqual(['relocation-gate', 'import-enter']);
    release.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual([
      'relocation-gate',
      'import-enter',
      'import-exit',
      'import-gate',
      'relocation-enter',
    ]);
    expect(importGateCalls).toBe(1);
  });
});
