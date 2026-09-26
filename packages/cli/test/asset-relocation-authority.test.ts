import { deflateSync } from 'node:zlib';
import * as crypto from 'node:crypto';
import {
  mkdtemp,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
  utimes,
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
const chainedOperationId = '33333333-3333-4333-8333-333333333333';
const sourcePath = 'content/assets/bg/old.webp';
const targetPath = 'content/assets/bg/new.webp';
const chainedTargetPath = 'content/assets/bg/final.webp';
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
  faultAction?: (point: AssetRelocationFaultPoint, projectRoot: string) => void | Promise<void>;
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
  faultAction?: (point: AssetRelocationFaultPoint, projectRoot: string) => void | Promise<void>;
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
  faultAction?: (point: AssetRelocationFaultPoint) => void | Promise<void>,
): ProjectAssetRelocationAuthority {
  const store = new AssetRelocationStore(paths);
  let faultCalls = 0;
  return new ProjectAssetRelocationAuthority(paths, store, barrierStore, {
    textHasher,
    assertLeaseHeld: () => undefined,
    ...(coordinator === undefined ? {} : { mutationCoordinator: coordinator }),
    ...(faultPoint === undefined && faultAction === undefined ? {} : {
      faultInjector: async (point) => {
        await faultAction?.(point);
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
  const authority = makeAuthority(
    paths,
    options.faultPoint,
    undefined,
    barrierStore,
    options.faultOccurrence,
    options.faultAction === undefined ? undefined : (point) => options.faultAction!(point, projectRoot),
  );
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
    options.faultAction === undefined ? undefined : (point) => options.faultAction!(point, projectRoot),
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
  it('publishes and restores current-media bytes and their real consumers through the existing authority', async () => {
    for (const [directory, extension, command] of [
      ['bgm', 'wav', 'bgm'], ['ambience', 'ogg', 'ambience'], ['se', 'mp3', 'se'],
      ['voice', 'wav', 'voice'], ['video', 'webm', 'video'], ['fonts', 'ttf', ''], ['licenses', '', ''],
    ] as const) {
      const value = await fixture();
      const name = directory === 'licenses' ? 'OFL' : `旧 媒体.${extension}`;
      const next = directory === 'licenses' ? 'NOTICE' : `新 媒体.${extension}`;
      const source = `content/assets/${directory}/${name}`;
      const target = `content/assets/${directory}/${next}`;
      await mkdir(path.dirname(absolute(value.projectRoot, source)), { recursive: true });
      const bytes = Buffer.from(`publication fixture for ${directory}; not decode evidence`);
      await writeFile(absolute(value.projectRoot, source), bytes);
      const configPath = absolute(value.projectRoot, 'game.config.json');
      const config = JSON.stringify({ entryScene: 'start', ...(directory === 'fonts' ? { font: source, fonts: { body: source, title: '', ui: '' } } : {}) });
      await writeFile(configPath, config);
      const scene = command ? `@scene start\n@${command} "旧 媒体"\n@end\n` : '@scene start\n@end\n';
      await writeFile(absolute(value.projectRoot, scenePath), scene);
      const planned = await value.authority.plan({ operationId, moves: [{ sourcePath: source, targetPath: target }] });
      expect(planned.plan.status, directory).toBe('ready');
      expect(await readFile(absolute(value.projectRoot, source))).toEqual(bytes);
      const committed = await value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
      expect(committed.operation.status).toBe('COMMITTED');
      expect(await readFile(absolute(value.projectRoot, target))).toEqual(bytes);
      await expect(stat(absolute(value.projectRoot, source))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(absolute(value.projectRoot, scenePath), 'utf8')).toBe(command ? scene.replace('旧 媒体', '新 媒体') : scene);
      if (directory === 'fonts') expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({ font: target, fonts: { body: target } });
      const repeated = await value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
      expect(repeated.receipt).toEqual(committed.receipt);
      await value.authority.undo(operationId, { receiptId: committed.receipt!.receiptId, receiptFingerprint: committed.receipt!.receiptFingerprint });
      expect(await readFile(absolute(value.projectRoot, source))).toEqual(bytes);
      expect(await readFile(configPath, 'utf8')).toBe(config);
      expect(await readFile(absolute(value.projectRoot, scenePath), 'utf8')).toBe(scene);
      await expect(stat(absolute(value.projectRoot, target))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('recovers an interrupted font/config publication without inventing a second journal', async () => {
    const value = await fixture({ faultPoint: 'after_text_replace_before_journal' });
    const source = 'content/assets/fonts/正文.ttf', target = 'content/assets/fonts/正文新.ttf';
    await mkdir(path.dirname(absolute(value.projectRoot, source)), { recursive: true });
    await writeFile(absolute(value.projectRoot, source), 'font publication fixture');
    const configPath = absolute(value.projectRoot, 'game.config.json');
    const before = JSON.stringify({ entryScene: 'start', font: source, fonts: { body: source } });
    await writeFile(configPath, before);
    const planned = await value.authority.plan({ operationId, moves: [{ sourcePath: source, targetPath: target }] });
    expect(planned.plan.status).toBe('ready');
    await expect(value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const resumed = makeAuthority(value.paths);
    const recovered = await resumed.recover(operationId, { action: 'rollback' });
    expect(recovered.operation.status).toBe('ROLLED_BACK');
    expect(await readFile(configPath, 'utf8')).toBe(before);
    expect(await readFile(absolute(value.projectRoot, source), 'utf8')).toBe('font publication fixture');
    await expect(stat(absolute(value.projectRoot, target))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform === 'win32')('preserves POSIX text permissions through commit and undo', async () => {
    const value = await fixture();
    const scene = absolute(value.projectRoot, scenePath);
    await chmod(scene, 0o640);
    const planned = await plan(value);
    const committed = await value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    expect((await stat(scene)).mode & 0o777).toBe(0o640);
    await value.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId, receiptFingerprint: committed.receipt!.receiptFingerprint,
    });
    expect((await stat(scene)).mode & 0o777).toBe(0o640);
  });

  it('reports a missing rollback backup as recovery-required and preserves the surviving target', async () => {
    const value = await fixture({ faultPoint: 'after_text_replace_before_journal' });
    const planned = await plan(value);
    await expect(value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const record = (await value.store.read(operationId))!;
    await unlink(absolute(value.projectRoot, record.journal.binaryItems[0]!.backupRelativePath));
    const recovered = makeAuthority(value.paths);
    await expect(recovered.recover(operationId, { action: 'rollback' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect((await value.store.read(operationId))?.journal.status).toBe('RECOVERY_REQUIRED');
    expect(await readFile(absolute(value.projectRoot, targetPath), 'utf8')).toBe('source-bytes');
  });

  it('preserves an unknown occupied text publication temporary file', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const temporary = absolute(fixtureValue.projectRoot, `content/scenario/.surdet-relocation-${operationId}-0.tmp`);
    const foreignText = 'unknown text created outside this operation';
    await writeFile(temporary, foreignText, { flag: 'wx' });
    const before = await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8');
    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await readFile(temporary, 'utf8')).toBe(foreignText);
    expect(await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8')).toBe(before);
    expect(await readFile(fixtureValue.sourceFile, 'utf8')).toBe('source-bytes');
  });

  it('commits with identity-bearing receipt and undoes the complete relocation', async () => {
    const fixtureValue = await fixture();
    const configPath = absolute(fixtureValue.projectRoot, 'game.config.json');
    const config = '\uFEFF{"entryScene":"start","characters":{},"variables":{},"player":{"titleBackground":"old","subtitle":"old","custom":42}}\r\n';
    await writeFile(configPath, config);
    const beforeText = await readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8');
    const sourceIdentity = await assetImportFileIdentity(fixtureValue.sourceFile);
    const planned = await plan(fixtureValue);

    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    expect(await readFile(configPath, 'utf8')).toBe(config.replace('"titleBackground":"old"', '"titleBackground":"new"'));
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
    expect(await readFile(configPath, 'utf8')).toBe(config);
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

  it('rejects a same-content source replacement with a different file identity', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const replacement = path.join(path.dirname(fixtureValue.sourceFile), 'replacement.webp');
    await writeFile(replacement, 'source-bytes');
    await rm(fixtureValue.sourceFile);
    await rename(replacement, fixtureValue.sourceFile);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
    await expect(stat(absolute(fixtureValue.projectRoot, targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves a source replaced after the backup link but before source removal', async () => {
    let replaced = false;
    const fixtureValue = await fixture({
      faultAction: async (point, projectRoot) => {
        if (point !== 'before_source_remove' || replaced) return;
        replaced = true;
        const source = absolute(projectRoot, sourcePath);
        await rename(source, `${source}.owned`);
        await writeFile(source, 'source-bytes');
      },
    });
    const planned = await plan(fixtureValue);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
    await expect(stat(absolute(fixtureValue.projectRoot, targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks text identity immediately before publish and preserves a concurrent external edit', async () => {
    let replaced = false;
    const fixtureValue = await fixture({
      faultAction: async (point, projectRoot) => {
        if (point !== 'before_text_publish' || replaced) return;
        replaced = true;
        const scene = absolute(projectRoot, scenePath);
        const replacement = path.join(path.dirname(scene), 'external.gal');
        await writeFile(replacement, 'external edit\n');
        await rm(scene);
        await rename(replacement, scene);
      },
    });
    const planned = await plan(fixtureValue);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8')).resolves.toBe('external edit\n');
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

  it('keeps a committed relocation queryable after a legal edit while undo remains blocked', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const sceneFile = absolute(fixtureValue.projectRoot, scenePath);
    await writeFile(sceneFile, '@scene start\n@bg new\n@bg new\n@end\n');

    await expect(fixtureValue.authority.query(operationId)).resolves.toMatchObject({
      operation: { operationId, status: 'COMMITTED' },
    });
    await expect(fixtureValue.authority.list()).resolves.toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({ operationId, status: 'COMMITTED' }),
      ]),
    });
    await expect(fixtureValue.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_UNDO_BLOCKED_CHANGED' });
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('COMMITTED');
    await expect(readFile(sceneFile, 'utf8')).resolves.toBe('@scene start\n@bg new\n@bg new\n@end\n');
  });

  it('keeps committed history readable but blocks undo when its owned backup is missing', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const backup = path.join(
      fixtureValue.paths.relocationWorkspace,
      operationId,
      'backup',
      'source-0000.bin',
    );
    await unlink(backup);

    await expect(fixtureValue.authority.query(operationId)).resolves.toMatchObject({
      operation: { operationId, status: 'COMMITTED' },
    });
    await expect(fixtureValue.authority.list()).resolves.toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({ operationId, status: 'COMMITTED' }),
      ]),
    });
    await expect(fixtureValue.authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_UNDO_BLOCKED_CHANGED' });
    await expect(readFile(absolute(fixtureValue.projectRoot, targetPath), 'utf8')).resolves.toBe('source-bytes');
    await expect(stat(fixtureValue.sourceFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows a committed target to move again without its old history blocking the next relocation', async () => {
    const fixtureValue = await fixture();
    const firstPlan = await plan(fixtureValue);
    const firstCommit = await fixtureValue.authority.commit(operationId, {
      planFingerprint: firstPlan.plan.planFingerprint,
    });
    expect(firstCommit.operation.status).toBe('COMMITTED');

    const secondPlan = await fixtureValue.authority.plan({
      operationId: chainedOperationId,
      sourcePath: targetPath,
      targetPath: chainedTargetPath,
    });
    expect(secondPlan.plan.status).toBe('ready');
    const secondCommit = await fixtureValue.authority.commit(chainedOperationId, {
      planFingerprint: secondPlan.plan.planFingerprint,
    });
    expect(secondCommit.operation.status).toBe('COMMITTED');
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toBe('@scene start\n@bg final\n@end\n');
    await expect(readFile(absolute(fixtureValue.projectRoot, chainedTargetPath), 'utf8'))
      .resolves.toBe('source-bytes');
    await expect(stat(absolute(fixtureValue.projectRoot, targetPath))).rejects.toMatchObject({ code: 'ENOENT' });

    await expect(fixtureValue.authority.query(operationId)).resolves.toMatchObject({
      operation: { operationId, status: 'COMMITTED' },
    });
    await expect(fixtureValue.authority.list()).resolves.toMatchObject({
      operations: expect.arrayContaining([
        expect.objectContaining({ operationId, status: 'COMMITTED' }),
        expect.objectContaining({ operationId: chainedOperationId, status: 'COMMITTED' }),
      ]),
    });
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

  it('records a plan before workspace materialization and retries the missing workspace after interruption', async () => {
    const fixtureValue = await fixture({ faultPoint: 'after_plan_record_before_workspace' });
    const workspace = path.join(fixtureValue.paths.relocationWorkspace, operationId);
    const request = { operationId, sourcePath, targetPath: fixtureValue.targetPath };

    await expect(fixtureValue.authority.plan(request))
      .rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('PLANNED');
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toBe('@scene start\n@bg old\n@end\n');

    const retried = makeAuthority(fixtureValue.paths, undefined, undefined, fixtureValue.barrierStore);
    const result = await retried.plan(request);
    expect(result.operation.status).toBe('PLANNED');
    expect((await stat(workspace)).isDirectory()).toBe(true);
    await expect(readFile(path.join(workspace, 'prepared', 'text-0000.txt'), 'utf8'))
      .resolves.toBe('@scene start\n@bg new\n@end\n');
    await expect(readFile(path.join(workspace, 'backup', 'text-0000.txt'), 'utf8'))
      .resolves.toBe('@scene start\n@bg old\n@end\n');
  });

  it('refuses to adopt workspace text whose identity was not recorded before interruption', async () => {
    const fixtureValue = await fixture({ faultPoint: 'after_workspace_text_before_record' });
    const workspace = path.join(fixtureValue.paths.relocationWorkspace, operationId);
    const request = { operationId, sourcePath, targetPath: fixtureValue.targetPath };

    await expect(fixtureValue.authority.plan(request))
      .rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const interrupted = await fixtureValue.store.read(operationId);
    expect(interrupted?.journal.status).toBe('PLANNED');
    expect(interrupted?.textFiles[0]?.preparedIdentity).toBeUndefined();
    await expect(readFile(path.join(workspace, 'prepared', 'text-0000.txt'), 'utf8'))
      .resolves.toBe('@scene start\n@bg new\n@end\n');
    await expect(readFile(path.join(workspace, 'backup', 'text-0000.txt'), 'utf8'))
      .resolves.toBe('@scene start\n@bg old\n@end\n');

    const prepared = path.join(workspace, 'prepared', 'text-0000.txt');
    const replacement = `${prepared}.replacement`;
    await writeFile(replacement, '@scene start\n@bg new\n@end\n');
    await rename(prepared, `${prepared}.interrupted`);
    await rename(replacement, prepared);

    const retried = makeAuthority(fixtureValue.paths, undefined, undefined, fixtureValue.barrierStore);
    await expect(retried.plan(request))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(retried.cancel(operationId)).resolves.toMatchObject({ operation: { status: 'CANCELLED' } });
    await expect(readFile(prepared, 'utf8')).resolves.toBe('@scene start\n@bg new\n@end\n');
    await expect(readFile(path.join(workspace, 'backup', 'text-0000.txt'), 'utf8'))
      .resolves.toBe('@scene start\n@bg old\n@end\n');
  });

  it('cleans a planned workspace before recording cancellation and retries after interruption', async () => {
    const fixtureValue = await fixture();
    await plan(fixtureValue);
    const workspace = path.join(fixtureValue.paths.relocationWorkspace, operationId);
    const interrupted = makeAuthority(
      fixtureValue.paths,
      'after_cancel_workspace_before_record',
      undefined,
      fixtureValue.barrierStore,
    );

    await expect(interrupted.cancel(operationId))
      .rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('PLANNED');
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });

    const retried = makeAuthority(fixtureValue.paths, undefined, undefined, fixtureValue.barrierStore);
    await expect(retried.cancel(operationId)).resolves.toMatchObject({
      operation: { operationId, status: 'CANCELLED' },
    });
    await expect(stat(workspace)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(retried.cancel(operationId)).resolves.toMatchObject({
      operation: { operationId, status: 'CANCELLED' },
    });
  });

  it('preserves a same-content workspace replacement whose ownership cannot be proven', async () => {
    const fixtureValue = await fixture();
    await plan(fixtureValue);
    const prepared = path.join(
      fixtureValue.paths.relocationWorkspace,
      operationId,
      'prepared',
      'text-0000.txt',
    );
    const replacement = `${prepared}.replacement`;
    const content = await readFile(prepared, 'utf8');
    await writeFile(replacement, content);
    await rename(prepared, `${prepared}.owned`);
    await rename(replacement, prepared);

    await expect(fixtureValue.authority.cancel(operationId))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(prepared, 'utf8')).resolves.toBe(content);
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('PLANNED');
  });

  it('does not mutate cancelled history during concurrent reads', async () => {
    const fixtureValue = await fixture();
    await plan(fixtureValue);
    await fixtureValue.authority.cancel(operationId);
    const workspace = path.join(fixtureValue.paths.relocationWorkspace, operationId);
    await mkdir(path.join(workspace, 'prepared'), { recursive: true });
    await writeFile(path.join(workspace, 'prepared', 'external.txt'), 'external');

    await expect(Promise.all([
      fixtureValue.authority.query(operationId),
      fixtureValue.authority.list(),
      fixtureValue.authority.query(operationId),
    ])).resolves.toHaveLength(3);
    await expect(readFile(path.join(workspace, 'prepared', 'external.txt'), 'utf8')).resolves.toBe('external');
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

  it('rejects new references before resuming publication and still permits rollback', async () => {
    const value = await fixture({ faultPoint: 'after_target_link_intent' });
    const planned = await plan(value);
    await expect(value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const before = await value.store.read(operationId);
    const added = absolute(value.projectRoot, 'content/scenario/added.gal');
    const text = '@scene added\n@bg old\n@end\n';
    await writeFile(added, text);
    const recovered = makeAuthority(value.paths);
    await expect(recovered.recover(operationId, { action: 'resume' }))
      .rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    expect(await value.store.read(operationId)).toEqual(before);
    expect(await readFile(added, 'utf8')).toBe(text);
    expect((await recovered.recover(operationId, { action: 'rollback' })).operation.status).toBe('ROLLED_BACK');
    expect(await readFile(value.sourceFile, 'utf8')).toBe('source-bytes');
  });

  it('rewrites choice inline references on disk without changing quoted at signs or dialogue', async () => {
    const value = await fixture();
    const original = '@scene start\r\n@choice\r\n  old text -> @bg old @goto done\r\n@label done\r\n旁白：mail@old\r\n@end\r\n';
    await writeFile(absolute(value.projectRoot, scenePath), original);
    const planned = await plan(value);
    const result = await value.authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    expect(result.operation.status).toBe('COMMITTED');
    expect(await readFile(absolute(value.projectRoot, scenePath), 'utf8')).toBe(original.replace('@bg old', '@bg new'));
  });

  it('resumes rollback after interruption between displacing and publishing a text file', async () => {
    const fixtureValue = await fixture({ faultPoint: 'after_text_replace_before_journal' });
    const planned = await plan(fixtureValue);
    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const interruptedRollback = makeAuthority(
      fixtureValue.paths,
      'after_text_displaced_before_publish',
      undefined,
      fixtureValue.barrierStore,
    );

    await expect(interruptedRollback.recover(operationId, { action: 'rollback' }))
      .rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    await expect(stat(absolute(fixtureValue.projectRoot, scenePath))).rejects.toMatchObject({ code: 'ENOENT' });

    const recovered = makeAuthority(fixtureValue.paths, undefined, undefined, fixtureValue.barrierStore);
    const result = await recovered.recover(operationId, { action: 'rollback' });
    expect(result.operation.status).toBe('ROLLED_BACK');
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toBe('@scene start\n@bg old\n@end\n');
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
  });

  it('resumes undo after interruption between displacing and restoring a text file', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const interruptedUndo = makeAuthority(
      fixtureValue.paths,
      'after_text_displaced_before_publish',
      undefined,
      fixtureValue.barrierStore,
    );

    await expect(interruptedUndo.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    await expect(stat(absolute(fixtureValue.projectRoot, scenePath))).rejects.toMatchObject({ code: 'ENOENT' });

    const recovered = makeAuthority(fixtureValue.paths, undefined, undefined, fixtureValue.barrierStore);
    const result = await recovered.recover(operationId, { action: 'resume' });
    expect(result.operation.status).toBe('UNDONE');
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toBe('@scene start\n@bg old\n@end\n');
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
  });

  it('finishes a durable receipt window instead of rolling committed files back', async () => {
    const fixtureValue = await fixture({ faultPoint: 'after_receipt_before_committed' });
    const planned = await plan(fixtureValue);
    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const interrupted = await fixtureValue.store.read(operationId);
    expect(interrupted?.journal.status).toBe('PUBLISHING');
    expect(interrupted?.receipt).not.toBeNull();

    const recovered = makeAuthority(fixtureValue.paths, undefined, undefined, fixtureValue.barrierStore);
    const result = await recovered.recover(operationId, { action: 'rollback' });
    expect(result.operation.status).toBe('COMMITTED');
    expect(result.receipt).not.toBeNull();
    await expect(readFile(absolute(fixtureValue.projectRoot, targetPath), 'utf8')).resolves.toBe('source-bytes');
  });

  it('does not persist a success receipt after a result changes during receipt creation', async () => {
    let modified = false;
    const fixtureValue = await fixture({
      faultAction: async (point, projectRoot) => {
        if (point !== 'before_receipt_persist' || modified) return;
        modified = true;
        await writeFile(absolute(projectRoot, scenePath), 'external receipt-window edit\n');
      },
    });
    const planned = await plan(fixtureValue);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect((await fixtureValue.store.read(operationId))?.receipt).toBeNull();
    await expect(readFile(absolute(fixtureValue.projectRoot, scenePath), 'utf8'))
      .resolves.toBe('external receipt-window edit\n');
  });

  it('rejects a target parent directory replaced after source backup', async () => {
    const archiveTarget = 'content/assets/bg/archive/new.webp';
    let replaced = false;
    const fixtureValue = await fixture({
      targetPath: archiveTarget,
      faultAction: async (point, projectRoot) => {
        if (point !== 'after_binary_backups_before_targets' || replaced) return;
        replaced = true;
        const directory = path.dirname(absolute(projectRoot, archiveTarget));
        await rename(directory, `${directory}-old`);
        await mkdir(directory);
      },
    });
    const planned = await plan(fixtureValue);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(stat(absolute(fixtureValue.projectRoot, archiveTarget))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fixtureValue.sourceFile, 'utf8')).resolves.toBe('source-bytes');
  });

  it('rejects a target parent directory replaced immediately before target publication', async () => {
    const archiveTarget = 'content/assets/bg/archive/new.webp';
    let replaced = false;
    const fixtureValue = await fixture({
      targetPath: archiveTarget,
      faultAction: async (point, projectRoot) => {
        if (point !== 'before_target_publish' || replaced) return;
        replaced = true;
        const directory = path.dirname(absolute(projectRoot, archiveTarget));
        await rename(directory, `${directory}-old`);
        await mkdir(directory);
      },
    });
    const planned = await plan(fixtureValue);

    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(stat(absolute(fixtureValue.projectRoot, archiveTarget))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not delete a target replaced after rollback intent', async () => {
    const fixtureValue = await fixture({ faultPoint: 'after_target_link_before_journal' });
    const planned = await plan(fixtureValue);
    await expect(fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const target = absolute(fixtureValue.projectRoot, targetPath);
    let replaced = false;
    const recovered = makeAuthority(
      fixtureValue.paths,
      undefined,
      undefined,
      fixtureValue.barrierStore,
      1,
      async (point) => {
        if (point !== 'after_rollback_target_intent' || replaced) return;
        replaced = true;
        await rename(target, `${target}.owned`);
        await writeFile(target, 'external-target');
      },
    );

    await expect(recovered.recover(operationId, { action: 'rollback' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('RECOVERY_REQUIRED');
    await expect(readFile(target, 'utf8')).resolves.toBe('external-target');
  });

  it('does not delete a target replaced after undo intent', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const target = absolute(fixtureValue.projectRoot, targetPath);
    let replaced = false;
    const authority = makeAuthority(
      fixtureValue.paths,
      undefined,
      undefined,
      fixtureValue.barrierStore,
      1,
      async (point) => {
        if (point !== 'after_undo_target_intent' || replaced) return;
        replaced = true;
        await rename(target, `${target}.owned`);
        await writeFile(target, 'external-target');
      },
    );

    await expect(authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect((await fixtureValue.store.read(operationId))?.journal.status).toBe('RECOVERY_REQUIRED');
    await expect(readFile(target, 'utf8')).resolves.toBe('external-target');
  });

  it('does not delete a target modified in place after undo intent', async () => {
    const fixtureValue = await fixture();
    const planned = await plan(fixtureValue);
    const committed = await fixtureValue.authority.commit(operationId, {
      planFingerprint: planned.plan.planFingerprint,
    });
    const target = absolute(fixtureValue.projectRoot, targetPath);
    let modified = false;
    const authority = makeAuthority(
      fixtureValue.paths,
      undefined,
      undefined,
      fixtureValue.barrierStore,
      1,
      async (point) => {
        if (point !== 'after_undo_target_intent' || modified) return;
        modified = true;
        await writeFile(target, 'external-target');
      },
    );

    await expect(authority.undo(operationId, {
      receiptId: committed.receipt!.receiptId,
      receiptFingerprint: committed.receipt!.receiptFingerprint,
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(target, 'utf8')).resolves.toBe('external-target');
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


describe('same-path replacement uses the original relocation transaction', () => {
  const replacementPath = 'content/assets/bg/image.png';
  function png(fill: number): Buffer {
    const crc = (bytes: Buffer): number => {
      let value = 0xffffffff;
      for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
      return (value ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, bytes: Buffer) => {
      const body = Buffer.concat([Buffer.from(type), bytes]);
      const result = Buffer.alloc(body.length + 8); result.writeUInt32BE(bytes.length); body.copy(result, 4); result.writeUInt32BE(crc(body), body.length + 4); return result;
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 2;
    const pixels = Buffer.alloc(8 * 25, fill); for (let row = 0; row < 8; row++) pixels[row * 25] = 0;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  }
  const a = png(37), b = png(71), c = png(19);
  const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
  const request = (bytes = b, id = operationId) => ({ operationId: id, targetPath: replacementPath,
    sourceId: 'source-permitted-fixture', sourcePath: 'new-image.png', sha256: digest(bytes) });
  it('replaces an exact configured portrait despite an ambiguous unrelated automatic slot', async () => {
    const f = await fixture();
    const target = 'content/assets/portrait/library_coat_normal.png';
    const other = 'content/assets/portrait/sub/library_coat_normal.png';
    await mkdir(path.dirname(absolute(f.projectRoot, other)), { recursive: true });
    await writeFile(absolute(f.projectRoot, target), a);
    await writeFile(absolute(f.projectRoot, other), c);
    const config = JSON.stringify({ entryScene: 'start', variables: {}, characters: {
      rin: { name: 'Rin', portraits: { uniform: { normal: target, smile: target } } },
    } });
    await writeFile(absolute(f.projectRoot, 'game.config.json'), config);
    const scene = '@scene start\n@show rin:uniform normal\n@end\n';
    await writeFile(absolute(f.projectRoot, scenePath), scene);
    const plan = await f.authority.planReplacement({ ...request(), targetPath: target }, b);
    expect(plan.plan.status).toBe('ready');
    const result = await f.authority.commit(operationId, { planFingerprint: plan.plan.planFingerprint });
    expect(await readFile(absolute(f.projectRoot, target))).toEqual(b);
    expect(await readFile(absolute(f.projectRoot, other))).toEqual(c);
    expect(await readFile(absolute(f.projectRoot, 'game.config.json'), 'utf8')).toBe(config);
    expect(await readFile(absolute(f.projectRoot, scenePath), 'utf8')).toBe(scene);
    await f.authority.undo(operationId, { receiptId: result.receipt!.receiptId, receiptFingerprint: result.receipt!.receiptFingerprint });
    expect(await readFile(absolute(f.projectRoot, target))).toEqual(a);
    expect(await readFile(absolute(f.projectRoot, other))).toEqual(c);
  });
  async function setup() {
    const f = await fixture();
    await writeFile(absolute(f.projectRoot, replacementPath), a);
    await writeFile(absolute(f.projectRoot, scenePath), '@scene start\n@bg image\n画面保持原键。\n@end\n');
    await writeFile(absolute(f.projectRoot, 'content/assets/bg/LICENSE.txt'), 'retain the original license');
    return f;
  }
  it('plans without changing source, replaces exact bytes without rewriting references, and undoes once', async () => {
    const f = await setup(), target = absolute(f.projectRoot, replacementPath);
    const scene = await readFile(absolute(f.projectRoot, scenePath));
    const plan = await f.authority.planReplacement(request(), b);
    expect(plan.plan).toMatchObject({ schemaVersion: 2, status: 'ready', replacement: { beforeSha256: digest(a), afterSha256: digest(b), noChange: false }, referenceChanges: [] });
    expect((plan.plan as any).replacement.references.length).toBeGreaterThan(0);
    expect(await readFile(target)).toEqual(a);
    const commit = { planFingerprint: plan.plan.planFingerprint };
    const result = await f.authority.commit(operationId, commit);
    expect(result.operation.status).toBe('COMMITTED'); expect(await readFile(target)).toEqual(b);
    expect(result.receipt!.targetIdentity.sha256).toBe(digest(b));
    expect(await readFile(absolute(f.projectRoot, scenePath))).toEqual(scene);
    expect(await readFile(absolute(f.projectRoot, 'content/assets/bg/LICENSE.txt'), 'utf8')).toBe('retain the original license');
    expect((await f.authority.commit(operationId, commit)).receipt).toEqual(result.receipt);
    const undo = { receiptId: result.receipt!.receiptId, receiptFingerprint: result.receipt!.receiptFingerprint };
    const undone = await f.authority.undo(operationId, undo);
    expect(undone.operation.status).toBe('UNDONE'); expect(await readFile(target)).toEqual(a);
    expect((await f.authority.undo(operationId, undo)).undoReceipt).toEqual(undone.undoReceipt);
  });

  it('recognizes equal-content replacement as no-change without swapping the original inode', async () => {
    const f = await setup(), target = absolute(f.projectRoot, replacementPath);
    const before = await assetImportFileIdentity(target);
    const plan = await f.authority.planReplacement(request(a), a);
    expect(plan.plan).toMatchObject({ affectedAssetCount: 0, replacement: { noChange: true } });
    const done = await f.authority.commit(operationId, { planFingerprint: plan.plan.planFingerprint });
    expect(await assetImportFileIdentity(target)).toEqual(before);
    await f.authority.undo(operationId, { receiptId: done.receipt!.receiptId, receiptFingerprint: done.receipt!.receiptFingerprint });
    expect(await assetImportFileIdentity(target)).toEqual(before);
  });

  it('rejects source hash/format mismatch, stale same-size target bytes, and a conflicting operation retry', async () => {
    const f = await setup(), target = absolute(f.projectRoot, replacementPath);
    await expect(f.authority.planReplacement(request(), c)).rejects.toMatchObject({ code: 'IMPORT_UPLOAD_MISMATCH' });
    await expect(f.authority.planReplacement({ ...request(), sourcePath: 'bad.webp' }, b)).rejects.toMatchObject({ code: 'IMPORT_TARGET_UNSAFE' });
    const plan = await f.authority.planReplacement(request(), b);
    await expect(f.authority.planReplacement(request(c), c)).rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
    const before = await stat(target); await writeFile(target, c); await utimes(target, before.atime, before.mtime);
    await expect(f.authority.commit(operationId, { planFingerprint: plan.plan.planFingerprint })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    expect(await readFile(target)).toEqual(c);
  });

  it('preserves a third-party C after commit and refuses both undo and stale receipt retry', async () => {
    const f = await setup(), target = absolute(f.projectRoot, replacementPath);
    const plan = await f.authority.planReplacement(request(), b);
    const done = await f.authority.commit(operationId, { planFingerprint: plan.plan.planFingerprint });
    await writeFile(target, c);
    await expect(f.authority.undo(operationId, { receiptId: done.receipt!.receiptId, receiptFingerprint: done.receipt!.receiptFingerprint })).rejects.toMatchObject({ code: 'IMPORT_UNDO_BLOCKED_CHANGED' });
    expect(await readFile(target)).toEqual(c);
    await expect(f.authority.commit(operationId, { planFingerprint: '0'.repeat(64) })).rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
  });

  for (const point of ['after_binary_backup_intent', 'after_binary_backup_before_journal', 'after_target_link_intent',
    'after_text_displaced_before_publish', 'after_target_link_before_journal', 'after_receipt_before_committed'] as const) {
    it(`resumes replacement after durable interruption at ${point}`, async () => {
      const f = await setup(), target = absolute(f.projectRoot, replacementPath);
      const plan = await f.authority.planReplacement(request(), b);
      let hit = false;
      const interrupted = makeAuthority(f.paths, undefined, undefined, f.barrierStore, 1, at => {
        if (at === point && !hit) { hit = true; throw new AssetRelocationInjectedTermination(at); }
      });
      await expect(interrupted.commit(operationId, { planFingerprint: plan.plan.planFingerprint })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
      const recovered = await f.authority.recover(operationId, { action: 'resume' });
      expect(recovered.operation.status).toBe('COMMITTED'); expect(await readFile(target)).toEqual(b);
      expect(recovered.receipt!.targetIdentity.sha256).toBe(digest(b));
    });
  }

  it('rolls back an interrupted displacement, retaining the old file and later same-path replacement history', async () => {
    const f = await setup(), target = absolute(f.projectRoot, replacementPath);
    const plan = await f.authority.planReplacement(request(), b);
    const interrupted = makeAuthority(f.paths, undefined, undefined, f.barrierStore, 1, at => {
      if (at === 'after_text_displaced_before_publish') throw new AssetRelocationInjectedTermination(at);
    });
    await expect(interrupted.commit(operationId, { planFingerprint: plan.plan.planFingerprint })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    const rolledBack = await f.authority.recover(operationId, { action: 'rollback' });
    expect(rolledBack.operation.status).toBe('ROLLED_BACK'); expect(await readFile(target)).toEqual(a);
    const second = await f.authority.planReplacement(request(c, batchOperationId), c);
    await f.authority.commit(batchOperationId, { planFingerprint: second.plan.planFingerprint });
    expect((await f.authority.query(operationId)).operation.status).toBe('ROLLED_BACK'); expect(await readFile(target)).toEqual(c);
  });

  it('finishes an interrupted undo displacement without repeating or discarding other assets', async () => {
    const f = await setup(), target = absolute(f.projectRoot, replacementPath);
    const plan = await f.authority.planReplacement(request(), b);
    const done = await f.authority.commit(operationId, { planFingerprint: plan.plan.planFingerprint });
    const interrupted = makeAuthority(f.paths, undefined, undefined, f.barrierStore, 1, at => {
      if (at === 'after_text_displaced_before_publish') throw new AssetRelocationInjectedTermination(at);
    });
    await expect(interrupted.undo(operationId, { receiptId: done.receipt!.receiptId, receiptFingerprint: done.receipt!.receiptFingerprint })).rejects.toBeInstanceOf(AssetRelocationInjectedTermination);
    expect((await f.authority.recover(operationId, { action: 'resume' })).operation.status).toBe('UNDONE');
    expect(await readFile(target)).toEqual(a); expect(await readFile(f.sourceFile)).toEqual(Buffer.from('source-bytes'));
  });
});
