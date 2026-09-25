import * as crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssetImportInjectedTermination,
  ProjectAssetImportAuthority,
  type AssetImportFaultPoint,
} from '../src/asset-import-authority/authority.js';
import { AssetImportBindingService } from '../src/asset-import-authority/binding.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';

// These cases fsync real multi-generation journals, including crash recovery.
// Disk latency is not the contract under test; keep the bound local to this suite.
vi.setConfig({ testTimeout: 30_000 });
const roots: string[] = [];
const textHasher = {
  sha256: async (text: string): Promise<string> => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
};

async function fixture(options: {
  createBackgroundDirectory?: boolean;
  faultInjector?: (point: AssetImportFaultPoint) => void | Promise<void>;
  now?: () => number;
} = {}): Promise<{
  projectRoot: string;
  authority: ProjectAssetImportAuthority;
  paths: Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surdet-asset-import-authority-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  if (options.createBackgroundDirectory !== false) {
    await mkdir(path.join(projectRoot, 'content', 'assets', 'bg'), { recursive: true });
  } else {
    await mkdir(projectRoot, { recursive: true });
  }
  const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(root, 'data') });
  const authorityOptions = {
    textHasher,
    assertLeaseHeld: () => undefined,
    ...(options.faultInjector === undefined ? {} : { faultInjector: options.faultInjector }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  return {
    projectRoot,
    paths,
    authority: new ProjectAssetImportAuthority(paths, new AssetImportRecordStore(paths), authorityOptions),
  };
}

function reopenedAuthority(
  paths: Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>,
  faultInjector?: (point: AssetImportFaultPoint) => void | Promise<void>,
): ProjectAssetImportAuthority {
  return new ProjectAssetImportAuthority(paths, new AssetImportRecordStore(paths), {
    textHasher,
    assertLeaseHeld: () => undefined,
    faultInjector,
  });
}

async function seedUploadingDiscovery(
  authority: ProjectAssetImportAuthority,
  paths: Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>,
  options: {
    operationId: string;
    itemId: string;
    sourceName: string;
    declaredBytes: number;
    binary?: Buffer;
    fact?: { sourceName?: string; bytes?: number; sha256?: string };
    intent?: boolean;
  },
): Promise<AssetImportRecordStore> {
  await authority.createOperation({
    operationId: options.operationId,
    items: [{ itemId: options.itemId, sourceName: options.sourceName, declaredBytes: options.declaredBytes }],
  });
  const store = new AssetImportRecordStore(paths);
  if (options.fact !== undefined) {
    const binary = options.binary ?? Buffer.alloc(options.fact.bytes ?? options.declaredBytes);
    await writeFile(store.stagedItemBinaryFile(options.operationId, options.itemId), binary);
    await store.createStagedItem({
      operationId: options.operationId,
      itemId: options.itemId,
      sourceName: options.fact.sourceName ?? options.sourceName,
      bytes: options.fact.bytes ?? binary.byteLength,
      sha256: options.fact.sha256 ?? crypto.createHash('sha256').update(binary).digest('hex'),
      stagedItemFingerprint: 'a'.repeat(64),
    });
  }
  if (options.intent === true) {
    const nonce = 'abababab-abab-4aba-8aba-abababababab';
    await store.createUploadIntent({
      schemaVersion: 1,
      operationId: options.operationId,
      itemId: options.itemId,
      nonce,
      partialFileName: `.${options.itemId}.${nonce}.partial`,
      createdAt: new Date().toISOString(),
    });
    await writeFile(store.stagedItemTemporaryFile(options.operationId, options.itemId, nonce), 'partial');
  }
  return store;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project asset import authority operations', () => {
  it('blocks duplicate music runtime keys across supported directory aliases and formats', async () => {
    const { authority, projectRoot } = await fixture();
    await mkdir(path.join(projectRoot, 'content/assets/music'), { recursive: true });
    await writeFile(path.join(projectRoot, 'content/assets/music/song.mp3'), 'existing-song');
    const operationId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'song.ogg', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, { targets: [{ itemId, kind: 'music', fileName: 'song.ogg' }] });
    expect(planned.plan.status).toBe('blocked');
    expect(planned.plan.items[0]!.issues).toContain('IMPORT_ASSET_KEY_CONFLICT');
    expect(await readFile(path.join(projectRoot, 'content/assets/music/song.mp3'), 'utf8')).toBe('existing-song');
  });

  it('allows a new import after undo and a legal reimport of the same target', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const importFile = async () => {
      const operationId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'reimport.png', declaredBytes: 5 }] });
      await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
      const planned = await authority.plan(operationId, { targets: [{ itemId, kind: 'background', fileName: 'reimport.png' }] });
      await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
      const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
      return { operationId, receiptId: committed.receipt.receiptId, receiptSha256: committed.receipt.receiptSha256 };
    };
    const first = await importFile();
    await authority.undo(first.operationId, first);
    const second = await importFile();
    const reopened = reopenedAuthority(paths);
    expect((await reopened.query(first.operationId)).operation.status).toBe('UNDONE');
    expect((await reopened.undo(first.operationId, first)).operation.status).toBe('UNDONE');
    expect((await reopened.query(second.operationId)).operation.status).toBe('COMMITTED');
    expect(await readFile(path.join(projectRoot, 'content/assets/bg/reimport.png'), 'utf8')).toBe('hello');
    await expect(reopened.createOperation({ operationId: crypto.randomUUID(), items: [{
      itemId: crypto.randomUUID(), sourceName: 'unrelated.png', declaredBytes: 5,
    }] })).resolves.toMatchObject({ status: 'UPLOADING' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
  }, 30_000);

  it('unknown operation queries never establish a project recovery barrier', async () => {
    const { authority, paths } = await fixture();
    const unknown = crypto.randomUUID();
    for (const instance of [authority, reopenedAuthority(paths)]) {
      await expect(instance.query(unknown)).rejects.toMatchObject({ code: 'IMPORT_OPERATION_NOT_FOUND' });
      expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
    }
    const created = await authority.createOperation({ operationId: crypto.randomUUID(),
      items: [{ itemId: crypto.randomUUID(), sourceName: 'new.png', declaredBytes: 1 }] });
    expect(created.status).toBe('UPLOADING');
  });

  it('rejects binary license bytes at the shared Editor authority without publishing or entering recovery', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = crypto.randomUUID(), itemId = crypto.randomUUID();
    const bytes = Buffer.from('license\u0000binary');
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'NOTICE.txt', declaredBytes: bytes.length }] });
    await authority.uploadItem(operationId, itemId, Readable.from(bytes));
    await expect(authority.plan(operationId, { targets: [{ itemId, kind: 'license', fileName: 'NOTICE.txt' }] }))
      .rejects.toMatchObject({ code: 'IMPORT_PLAN_BLOCKED' });
    expect((await authority.query(operationId)).operation.status).toBe('STAGED');
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
    await expect(readFile(path.join(projectRoot, 'content/assets/licenses/NOTICE.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('streams measured bytes, creates a ready plan and seals it deterministically', async () => {
    const { authority } = await fixture();
    const operationId = '22222222-2222-4222-8222-222222222222';
    const itemId = '33333333-3333-4333-8333-333333333333';
    const created = await authority.createOperation({
      operationId,
      items: [{ itemId, sourceName: '站台.webp', declaredBytes: 5 }],
    });
    expect(created).toMatchObject({ operationId, status: 'UPLOADING' });
    expect(created.operationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(() => authority.verifyOperationToken(operationId, created.operationToken)).not.toThrow();
    expect(() => authority.verifyOperationToken(operationId, '')).toThrowError('导入操作授权无效');

    const staged = await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    expect(staged).toMatchObject({ operationId, itemId, sourceName: '站台.webp', bytes: 5 });
    expect(staged.sha256).toBe(crypto.createHash('sha256').update('hello').digest('hex'));

    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: '站台.webp' }],
    });
    expect(planned.status).toBe('READY');
    expect(planned.plan.status).toBe('ready');
    expect(planned.plan.items[0]?.targetPath).toBe('content/assets/bg/站台.webp');
    const sealed = await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    expect(sealed).toMatchObject({ status: 'READY', planId: planned.plan.planId });
    expect((await authority.query(operationId)).operation.status).toBe('READY');
  });

  it('keeps ordinary restart discovery metadata-only and defers full staged-byte verification to query', async () => {
    const { authority, paths } = await fixture();
    const operationId = '20202020-2020-4020-8020-202020202020';
    const itemId = '21212121-2121-4121-8121-212121212121';
    await seedUploadingDiscovery(authority, paths, {
      operationId,
      itemId,
      sourceName: 'metadata-only.png',
      declaredBytes: 4,
      binary: Buffer.from('evil'),
      fact: { bytes: 4, sha256: crypto.createHash('sha256').update('good').digest('hex') },
    });

    const listed = await reopenedAuthority(paths).list();
    expect(listed.operations).toContainEqual(expect.objectContaining({ operationId, status: 'STAGED' }));
    await expect(reopenedAuthority(paths).query(operationId))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
  });

  it('keeps incomplete upload intents and unsafe staged metadata fail-closed during discovery', async () => {
    const { authority, paths } = await fixture();
    await seedUploadingDiscovery(authority, paths, {
      operationId: '24242424-2424-4242-8242-242424242424',
      itemId: '25252525-2525-4252-8252-252525252525',
      sourceName: 'partial.png',
      declaredBytes: 4,
      intent: true,
    });
    const listed = await reopenedAuthority(paths).list();
    expect(listed.operations).toContainEqual(expect.objectContaining({
      operationId: '24242424-2424-4242-8242-242424242424',
      status: 'RECOVERY_REQUIRED',
    }));
  });

  it('issues a fresh operation token when an idempotent create follows expiry', async () => {
    let clock = Date.parse('2026-09-02T00:00:00.000Z');
    const { authority } = await fixture({ now: () => clock });
    const request = {
      operationId: '26262626-2626-4262-8262-262626262626',
      items: [{ itemId: '27272727-2727-4272-8272-272727272727', sourceName: 'retry.png', declaredBytes: 4 }],
    };
    const first = await authority.createOperation(request);
    clock += 30 * 60_000;
    expect(() => authority.verifyOperationToken(request.operationId, first.operationToken))
      .toThrowError('导入操作授权无效');
    const retried = await authority.createOperation(request);
    expect(retried.operationToken).not.toBe(first.operationToken);
    expect(() => authority.verifyOperationToken(request.operationId, retried.operationToken)).not.toThrow();
  });

  it('periodically removes expired binding probes in a long-lived process', async () => {
    let clock = Date.parse('2026-09-02T00:00:00.000Z');
    const { paths, projectRoot } = await fixture();
    const store = new AssetImportRecordStore(paths);
    const binding = new AssetImportBindingService(paths, store, {
      now: () => clock,
      challengeCleanupIntervalMs: 5,
    });
    const challenge = await binding.createChallenge('long-lived-browser');
    const stop = binding.startExpiredChallengeCleanup();
    clock += 61_000;
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((await store.readChallenge(challenge.challengeId)).journal.status === 'PROBE_REMOVED') break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect((await store.readChallenge(challenge.challengeId)).journal.status).toBe('PROBE_REMOVED');
      await expect(stat(path.join(projectRoot, challenge.relativeProbePath)))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      stop();
    }
  });

  it('makes byte-equal upload retry idempotent and rejects different bytes', async () => {
    const { authority } = await fixture();
    const operationId = '44444444-4444-4444-8444-444444444444';
    const itemId = '55555555-5555-4555-8555-555555555555';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'same.png', declaredBytes: 4 }] });
    const first = await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('same')));
    const retries = await Promise.all([
      authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('same'))),
      authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('same'))),
    ]);
    expect(retries).toEqual([first, first]);
    await expect(authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('diff'))))
      .rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
  });

  it('rejects unsafe identities and removes exact partial files after short or long streams', async () => {
    const { authority, paths } = await fixture();
    await expect(authority.createOperation({
      operationId: 'NOT-A-UUID',
      items: [{ itemId: '33333333-3333-4333-8333-333333333333', sourceName: 'x.png', declaredBytes: 1 }],
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const operationId = '12121212-1212-4212-8212-121212121212';
    const itemId = '34343434-3434-4434-8434-343434343434';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 4 }] });
    await expect(authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('abc'))))
      .rejects.toMatchObject({ code: 'IMPORT_UPLOAD_MISMATCH' });
    await expect(authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('abcde'))))
      .rejects.toMatchObject({ code: 'IMPORT_UPLOAD_MISMATCH' });
    const stagedPath = new AssetImportRecordStore(paths).stagedItemBinaryFile(operationId, itemId);
    await expect(stat(stagedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('four')))).resolves.toMatchObject({ bytes: 4 });
  });

  it('blocks existing targets and never offers an overwrite plan', async () => {
    const { authority, projectRoot } = await fixture();
    const operationId = '66666666-6666-4666-8666-666666666666';
    const itemId = '77777777-7777-4777-8777-777777777777';
    await writeFile(path.join(projectRoot, 'content', 'assets', 'bg', 'exists.png'), 'old');
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'exists.png', declaredBytes: 3 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));

    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'exists.png' }],
    });
    expect(planned.plan.status).toBe('blocked');
    expect(planned.plan.issues).toContain('IMPORT_TARGET_EXISTS');
    await expect(authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toMatchObject({ code: 'IMPORT_PLAN_BLOCKED' });
  });

  it('revalidates target absence at seal and keeps a stale operation unsealed', async () => {
    const { authority, projectRoot } = await fixture();
    const operationId = '56565656-5656-4656-8656-565656565656';
    const itemId = '78787878-7878-4878-8878-787878787878';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'race.png', declaredBytes: 3 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'race.png' }],
    });
    await writeFile(path.join(projectRoot, 'content', 'assets', 'bg', 'race.png'), 'external');
    await expect(authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    expect((await authority.query(operationId)).operation.status).toBe('STAGED');
  });

  it('fails closed when a registered operation or staged binary is incomplete after restart', async () => {
    const orphanFixture = await fixture();
    const orphanOperationId = '13131313-1313-4313-8313-131313131313';
    await new AssetImportRecordStore(orphanFixture.paths).registerOperation({
      operationId: orphanOperationId,
      itemCount: 1,
      createdAt: new Date().toISOString(),
    });
    await expect(orphanFixture.authority.list()).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await new AssetImportRecordStore(orphanFixture.paths).hasUnresolvedBarrier()).toBe(true);

    const stagedFixture = await fixture();
    const operationId = '24242424-2424-4424-8424-242424242424';
    const itemId = '35353535-3535-4535-8535-353535353535';
    await stagedFixture.authority.createOperation({
      operationId,
      items: [{ itemId, sourceName: 'missing.png', declaredBytes: 3 }],
    });
    await stagedFixture.authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));
    const store = new AssetImportRecordStore(stagedFixture.paths);
    await rm(store.stagedItemBinaryFile(operationId, itemId));
    await expect(stagedFixture.authority.query(operationId))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await store.hasUnresolvedBarrier()).toBe(true);
  });

  it('blocks a replaced staging directory before any byte can escape the authority namespace', async () => {
    const { authority, paths } = await fixture();
    const operationId = '46464646-4646-4646-8646-464646464646';
    const itemId = '57575757-5757-4757-8757-575757575757';
    await authority.createOperation({
      operationId,
      items: [{ itemId, sourceName: 'escape.png', declaredBytes: 3 }],
    });
    const store = new AssetImportRecordStore(paths);
    const staging = path.dirname(store.stagedItemBinaryFile(operationId, itemId));
    const outside = path.join(paths.dataRoot, 'outside-staging');
    await mkdir(outside);
    await rm(staging, { recursive: true });
    await symlink(outside, staging, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new'))))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readdir(outside)).resolves.toEqual([]);
    expect(await store.hasUnresolvedBarrier()).toBe(true);
  });

  it('rejects a byte-valid manifest whose canonical fingerprint was changed', async () => {
    const { authority, paths } = await fixture();
    const operationId = '68686868-6868-4686-8686-686868686868';
    const itemId = '79797979-7979-4797-8979-797979797979';
    await authority.createOperation({
      operationId,
      items: [{ itemId, sourceName: 'tampered.png', declaredBytes: 3 }],
    });
    const manifestFile = path.join(paths.projectNamespace, 'operations', operationId, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.manifestFingerprint = 'f'.repeat(64);
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(authority.query(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('discovers a staged operation after authority reconstruction and cancels before publication', async () => {
    const { authority, paths } = await fixture();
    const operationId = '88888888-8888-4888-8888-888888888888';
    const itemId = '99999999-9999-4999-8999-999999999999';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'resume.png', declaredBytes: 3 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));
    const stagedFile = new AssetImportRecordStore(paths).stagedItemBinaryFile(operationId, itemId);

    const reopened = new ProjectAssetImportAuthority(paths, new AssetImportRecordStore(paths), {
      textHasher,
      assertLeaseHeld: () => undefined,
    });
    expect((await reopened.query(operationId)).operation.status).toBe('STAGED');
    expect((await reopened.list()).operations.map((operation) => operation.operationId)).toContain(operationId);
    expect((await reopened.cancel(operationId)).operation.status).toBe('CANCELLED');
    await expect(stat(stagedFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves an unknown staging entry and blocks cancellation instead of deleting evidence', async () => {
    const { authority, paths } = await fixture();
    const operationId = '89898989-8989-4989-8989-898989898989';
    const itemId = '90909090-9090-4090-8090-909090909090';
    await authority.createOperation({
      operationId,
      items: [{ itemId, sourceName: 'known.png', declaredBytes: 3 }],
    });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));
    const store = new AssetImportRecordStore(paths);
    const unknown = path.join(path.dirname(store.stagedItemBinaryFile(operationId, itemId)), 'unknown.keep');
    await writeFile(unknown, 'keep');

    await expect(authority.cancel(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(stat(unknown)).resolves.toMatchObject({ size: 4 });
    await expect(stat(store.stagedItemBinaryFile(operationId, itemId))).resolves.toMatchObject({ size: 3 });
    expect(await store.hasUnresolvedBarrier()).toBe(true);
  });

  it('publishes only a new hard-linked target and returns one immutable receipt', async () => {
    const { authority, projectRoot } = await fixture();
    const operationId = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1';
    const itemId = 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2';
    const created = await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'publish.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'publish.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });

    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    expect(committed.operation.status).toBe('COMMITTED');
    expect(committed.receipt).toMatchObject({ operationId, status: 'COMMITTED', projectIdentity: expect.any(String) });
    expect(committed.receipt.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(committed.receipt.files).toHaveLength(1);
    expect(() => authority.verifyOperationToken(operationId, created.operationToken))
      .toThrowError('导入操作授权无效');
    const resumedToken = await authority.issueOperationToken(operationId);
    expect(resumedToken).not.toBe(created.operationToken);
    expect(() => authority.verifyOperationToken(operationId, resumedToken)).not.toThrow();
    await expect(readFile(path.join(projectRoot, 'content', 'assets', 'bg', 'publish.png'), 'utf8')).resolves.toBe('hello');
    await expect(authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint })).resolves.toEqual(committed);
  });

  it('expires operation tokens at the absolute server TTL while binding renewal cannot extend them', async () => {
    const epoch = Date.parse('2026-09-01T00:00:00.000Z');
    let nowMs = epoch;
    const { authority, paths, projectRoot } = await fixture({ now: () => nowMs });
    const operationId = 'b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1';
    const itemId = 'c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2';
    const browserSessionId = 'browser-operation-token-ttl';
    const created = await authority.createOperation({
      operationId,
      items: [{ itemId, sourceName: 'token-ttl.png', declaredBytes: 1 }],
    });

    const binding = new AssetImportBindingService(paths, new AssetImportRecordStore(paths), { now: () => nowMs });
    const challenge = await binding.createChallenge(browserSessionId);
    const probe = JSON.parse(await readFile(path.join(projectRoot, challenge.relativeProbePath), 'utf8')) as { nonce: string };
    const confirmed = await binding.confirmChallenge(challenge.challengeId, { browserSessionId, nonce: probe.nonce });
    expect(await binding.validateBinding(confirmed.bindingToken, browserSessionId)).toBe(true);

    expect(() => authority.verifyOperationToken(operationId, created.operationToken)).not.toThrow();
    nowMs = epoch + (30 * 60_000) - 1;
    expect(() => authority.verifyOperationToken(operationId, created.operationToken)).not.toThrow();
    expect(await binding.validateBinding(confirmed.bindingToken, browserSessionId)).toBe(true);

    nowMs = epoch + (30 * 60_000);
    expect(await binding.validateBinding(confirmed.bindingToken, browserSessionId)).toBe(true);
    expect(() => authority.verifyOperationToken(operationId, created.operationToken))
      .toThrowError('导入操作授权无效');

    const resumedToken = await authority.issueOperationToken(operationId);
    expect(resumedToken).not.toBe(created.operationToken);
    expect(() => authority.verifyOperationToken(operationId, resumedToken)).not.toThrow();
    expect(() => authority.verifyOperationToken(operationId, created.operationToken))
      .toThrowError('导入操作授权无效');
  });

  it('commits different operations concurrently while creating a shared missing parent', async () => {
    let firstParentIntent = true;
    const { authority, paths, projectRoot } = await fixture({
      createBackgroundDirectory: false,
      faultInjector: async (point) => {
        if (point !== 'after_parent_intent_before_mkdir' || !firstParentIntent) return;
        firstParentIntent = false;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      },
    });
    const operations = [
      {
        operationId: 'c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1',
        itemId: 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1',
        sourceName: 'parallel-a.png',
        content: 'A',
      },
      {
        operationId: 'e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1',
        itemId: 'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1',
        sourceName: 'parallel-b.png',
        content: 'B',
      },
    ] as const;
    const plans: Array<{ operationId: string; planFingerprint: string }> = [];
    for (const operation of operations) {
      await authority.createOperation({
        operationId: operation.operationId,
        items: [{ itemId: operation.itemId, sourceName: operation.sourceName, declaredBytes: 1 }],
      });
      await authority.uploadItem(operation.operationId, operation.itemId, Readable.from(Buffer.from(operation.content)));
      const planned = await authority.plan(operation.operationId, {
        targets: [{ itemId: operation.itemId, kind: 'background', fileName: operation.sourceName }],
      });
      expect(planned.plan.status).toBe('ready');
      await authority.seal(operation.operationId, { planFingerprint: planned.plan.planFingerprint });
      plans.push({ operationId: operation.operationId, planFingerprint: planned.plan.planFingerprint });
    }

    const results = await Promise.all(plans.map(async ({ operationId, planFingerprint }) => {
      try {
        const committed = await authority.commit(operationId, { planFingerprint });
        return { operationId, status: committed.operation.status };
      } catch (error) {
        return { operationId, errorCode: (error as { code?: string }).code };
      }
    }));

    expect(results).toEqual(operations.map(({ operationId }) => ({ operationId, status: 'COMMITTED' })));
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', 'parallel-a.png'))).resolves.toBeDefined();
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', 'parallel-b.png'))).resolves.toBeDefined();
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
  });

  it('blocks a queued operation before publication when an earlier mutation enters recovery', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operations = [
      {
        operationId: 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3',
        itemId: 'b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4',
        sourceName: 'recovery-first.png',
        content: 'A',
      },
      {
        operationId: 'c5c5c5c5-c5c5-45c5-85c5-c5c5c5c5c5c5',
        itemId: 'd6d6d6d6-d6d6-46d6-86d6-d6d6d6d6d6d6',
        sourceName: 'recovery-second.png',
        content: 'B',
      },
    ] as const;
    const plans: Array<{ operationId: string; planFingerprint: string }> = [];
    for (const operation of operations) {
      await authority.createOperation({
        operationId: operation.operationId,
        items: [{ itemId: operation.itemId, sourceName: operation.sourceName, declaredBytes: 1 }],
      });
      await authority.uploadItem(operation.operationId, operation.itemId, Readable.from(Buffer.from(operation.content)));
      const planned = await authority.plan(operation.operationId, {
        targets: [{ itemId: operation.itemId, kind: 'background', fileName: operation.sourceName }],
      });
      await authority.seal(operation.operationId, { planFingerprint: planned.plan.planFingerprint });
      plans.push({ operationId: operation.operationId, planFingerprint: planned.plan.planFingerprint });
    }

    const firstPrepared = path.join(
      projectRoot,
      '.surdet',
      'asset-import',
      operations[0].operationId,
      'prepared',
      `${operations[0].itemId}.bin`,
    );
    const faulted = reopenedAuthority(paths, async (point) => {
      if (point === 'after_prepare_intent_before_file') await writeFile(firstPrepared, 'external-evidence');
    });
    const results = await Promise.all(plans.map(async ({ operationId, planFingerprint }) => {
      try {
        const committed = await faulted.commit(operationId, { planFingerprint });
        return { operationId, status: committed.operation.status };
      } catch (error) {
        return { operationId, errorCode: (error as { code?: string }).code };
      }
    }));

    expect(results).toEqual(operations.map(({ operationId }) => ({ operationId, errorCode: 'IMPORT_RECOVERY_REQUIRED' })));
    const store = new AssetImportRecordStore(paths);
    expect((await store.readOperation(operations[0].operationId)).journal.status).toBe('RECOVERY_REQUIRED');
    expect((await store.readOperation(operations[1].operationId)).journal.status).toBe('READY');
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', operations[0].sourceName)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', operations[1].sourceName)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path.join(projectRoot, '.surdet', 'asset-import', operations[1].operationId, 'publication.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path.join(projectRoot, '.surdet', 'asset-import', operations[1].operationId, 'receipt.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.hasUnresolvedBarrier()).toBe(true);
  });

  it('keeps an externally created target byte-identical when commit revalidation becomes stale', async () => {
    const { authority, projectRoot } = await fixture();
    const operationId = 'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3';
    const itemId = 'd4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'race.png', declaredBytes: 3 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'commit-race.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const target = path.join(projectRoot, 'content', 'assets', 'bg', 'commit-race.png');
    await writeFile(target, 'external');

    await expect(authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });
    await expect(readFile(target, 'utf8')).resolves.toBe('external');
    expect((await authority.query(operationId)).operation.status).toBe('READY');
  });

  it('preserves an existing prepared path instead of deleting unowned recovery evidence', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = 'e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5';
    const itemId = 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'owned.png', declaredBytes: 3 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('new')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'prepared-evidence.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const prepared = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'prepared', `${itemId}.bin`);
    const faulted = reopenedAuthority(paths, async (point) => {
      if (point === 'after_prepare_intent_before_file') await writeFile(prepared, 'external-evidence');
    });

    await expect(faulted.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(prepared, 'utf8')).resolves.toBe('external-evidence');
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', 'prepared-evidence.png')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('does not claim or delete a canonical parent created by an external writer in the mkdir window', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '17171717-1717-4717-8717-171717171717';
    const itemId = '28282828-2828-4828-8828-282828282828';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'theme.mp3', declaredBytes: 3 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('mp3')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'music', fileName: 'theme.mp3' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const externalParent = path.join(projectRoot, 'content', 'assets', 'bgm');
    const sentinel = path.join(externalParent, 'external.keep');
    await mkdir(path.join(projectRoot, '.surdet', 'asset-import', operationId, 'prepared'), { recursive: true });
    await mkdir(path.join(projectRoot, '.surdet', 'asset-import', operationId, 'rollback'));
    await mkdir(path.join(projectRoot, '.surdet', 'asset-import', operationId, 'undo'));
    const faulted = reopenedAuthority(paths, async (point) => {
      if (point === 'after_parent_intent_before_mkdir') {
        await mkdir(externalParent);
        await writeFile(sentinel, 'keep');
      }
    });

    await expect(faulted.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('keep');
    await expect(stat(path.join(externalParent, 'theme.mp3'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['rollback', 'resume'] as const)('retains a competing runtime key while recovering a linked-but-unjournaled target with %s', async (action) => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '39393939-3939-4939-8939-393939393939';
    const itemId = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'crash.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'crash.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const faulted = reopenedAuthority(paths, (point) => {
      if (point === 'after_final_link_before_linked_journal') throw new Error('simulated process termination');
    });

    await expect(faulted.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toBeInstanceOf(AssetImportInjectedTermination);
    const target = path.join(projectRoot, 'content', 'assets', 'bg', 'crash.png');
    await expect(readFile(target, 'utf8')).resolves.toBe('hello');
    expect((await new AssetImportRecordStore(paths).readOperation(operationId)).journal.status).toBe('PUBLISHING');

    const competingPath = path.join(projectRoot, 'content', 'assets', 'bg', 'crash.webp');
    await writeFile(competingPath, 'keep this competing image');
    const recovered = reopenedAuthority(paths);
    const result = await recovered.recover(operationId, { action });
    expect(result.detail.operation.status).toBe('ROLLED_BACK');
    await expect(readFile(competingPath, 'utf8')).resolves.toBe('keep this competing image');
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    const quarantine = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'rollback', `${itemId}.bin`);
    await expect(readFile(quarantine, 'utf8')).resolves.toBe('hello');
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
    await expect(recovered.recover(operationId, { action: 'rollback' }))
      .resolves.toMatchObject({ detail: { operation: { status: 'ROLLED_BACK' } } });
  }, 30_000);

  it.each([
    {
      point: 'after_rollback_rename_intent_before_rename' as const,
      operationId: '7d7d7d7d-7d7d-4d7d-8d7d-7d7d7d7d7d7d',
      itemId: '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e',
    },
    {
      point: 'after_rollback_final_rename_before_quarantined_journal' as const,
      operationId: '9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f',
      itemId: 'abababab-abab-4bab-8bab-abababababab',
    },
  ])('resumes rollback after restart at $point', async ({ point, operationId, itemId }) => {
    const { authority, paths, projectRoot } = await fixture();
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'rollback.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: `${itemId.slice(0, 4)}-rollback.png` }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const commitCrash = reopenedAuthority(paths, (faultPoint) => {
      if (faultPoint === 'after_final_link_before_linked_journal') throw new Error('stop after link');
    });
    await expect(commitCrash.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toBeInstanceOf(AssetImportInjectedTermination);

    const rollbackCrash = reopenedAuthority(paths, (faultPoint) => {
      if (faultPoint === point) throw new Error('stop during rollback');
    });
    await expect(rollbackCrash.recover(operationId, { action: 'rollback' }))
      .rejects.toBeInstanceOf(AssetImportInjectedTermination);

    const recovered = reopenedAuthority(paths);
    const result = await recovered.recover(operationId, { action: 'rollback' });
    expect(result.detail.operation.status).toBe('ROLLED_BACK');
    const target = path.join(projectRoot, 'content', 'assets', 'bg', `${itemId.slice(0, 4)}-rollback.png`);
    const quarantine = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'rollback', `${itemId}.bin`);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(quarantine, 'utf8')).resolves.toBe('hello');
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
  });

  it('rejects a publication journal that names a parent outside the exact target and workspace allowlist', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '12131415-1617-4819-8a1b-1c1d1e1f2021';
    const itemId = '22232425-2627-4829-8a2b-2c2d2e2f3031';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'parent.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'parent.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const faulted = reopenedAuthority(paths, (point) => {
      if (point === 'after_final_link_before_linked_journal') throw new Error('stop after link');
    });
    await expect(faulted.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toBeInstanceOf(AssetImportInjectedTermination);
    const unrelated = path.join(projectRoot, 'user-empty-directory');
    await mkdir(unrelated);
    const publicationFile = path.join(paths.projectNamespace, 'operations', operationId, 'publication.json');
    const publication = JSON.parse(await readFile(publicationFile, 'utf8'));
    publication.parents.push({
      ...publication.parents[0],
      relativePath: 'user-empty-directory',
      state: 'CREATED',
    });
    await writeFile(publicationFile, `${JSON.stringify(publication, null, 2)}\n`);

    await expect(reopenedAuthority(paths).recover(operationId, { action: 'rollback' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect((await stat(unrelated)).isDirectory()).toBe(true);
  });

  it('finishes the same immutable receipt after restart when commit crashed after receipt creation', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b';
    const itemId = '6c6c6c6c-6c6c-4c6c-8c6c-6c6c6c6c6c6c';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'receipt.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'receipt.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const faulted = reopenedAuthority(paths, (point) => {
      if (point === 'after_receipt_create_before_committed_journal') throw new Error('simulated process termination');
    });

    await expect(faulted.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toBeInstanceOf(AssetImportInjectedTermination);
    const storedBefore = await new AssetImportRecordStore(paths).readReceipt(operationId);
    expect(storedBefore?.receiptSha256).toMatch(/^[0-9a-f]{64}$/);

    const competingPath = path.join(projectRoot, 'content', 'assets', 'bg', 'receipt.webp');
    await writeFile(competingPath, 'keep this later image');
    const recovered = reopenedAuthority(paths);
    await expect(recovered.recover(operationId, { action: 'rollback' }))
      .rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
    expect((await new AssetImportRecordStore(paths).readOperation(operationId)).journal.status).toBe('PUBLISHING');
    await expect(readFile(path.join(projectRoot, 'content', 'assets', 'bg', 'receipt.png'), 'utf8'))
      .resolves.toBe('hello');
    const result = await recovered.recover(operationId, { action: 'resume' });
    expect(result.detail.operation.status).toBe('COMMITTED');
    expect(result.detail.receipt).toEqual(storedBefore);
    await expect(readFile(competingPath, 'utf8')).resolves.toBe('keep this later image');
    await expect(readFile(path.join(projectRoot, 'content', 'assets', 'bg', 'receipt.png'), 'utf8'))
      .resolves.toBe('hello');
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
    await expect(recovered.recover(operationId, { action: 'resume' }))
      .resolves.toMatchObject({ detail: { operation: { status: 'COMMITTED' } } });
  });

  it('fails closed when an immutable receipt is changed on disk', async () => {
    const { authority, paths } = await fixture();
    const operationId = 'efefefef-efef-4fef-8fef-efefefefefef';
    const itemId = '10101010-1010-4010-8010-101010101010';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'receipt-check.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'receipt-check.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    const receiptFile = path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json');
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    receipt.committedAt = 'changed-after-commit';
    await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);

    await expect(authority.query(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('preserves externally changed bytes when the final full-batch rescan detects a late mutation', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
    const firstId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    const secondId = 'dededede-dede-4ede-8ede-dededededede';
    await authority.createOperation({
      operationId,
      items: [
        { itemId: firstId, sourceName: 'first.png', declaredBytes: 5 },
        { itemId: secondId, sourceName: 'second.png', declaredBytes: 5 },
      ],
    });
    await authority.uploadItem(operationId, firstId, Readable.from(Buffer.from('first')));
    await authority.uploadItem(operationId, secondId, Readable.from(Buffer.from('other')));
    const planned = await authority.plan(operationId, {
      targets: [
        { itemId: firstId, kind: 'background', fileName: 'batch-first.png' },
        { itemId: secondId, kind: 'background', fileName: 'batch-second.png' },
      ],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const firstTarget = path.join(projectRoot, 'content', 'assets', 'bg', 'batch-first.png');
    let verifiedCount = 0;
    const mutating = reopenedAuthority(paths, async (point) => {
      if (point === 'after_verify_before_verified_journal' && ++verifiedCount === 2) {
        await writeFile(firstTarget, 'external-change');
      }
    });

    await expect(mutating.commit(operationId, { planFingerprint: planned.plan.planFingerprint }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(firstTarget, 'utf8')).resolves.toBe('external-change');
    const firstQuarantine = path.join(
      projectRoot,
      '.surdet',
      'asset-import',
      operationId,
      'rollback',
      `${firstId}.bin`,
    );
    await expect(readFile(firstQuarantine, 'utf8')).resolves.toBe('external-change');
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', 'batch-second.png')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('undoes only an unchanged committed receipt and returns one immutable undo receipt', async () => {
    const { authority, projectRoot } = await fixture();
    const operationId = '32333435-3637-4839-8a3b-3c3d3e3f4041';
    const itemId = '42434445-4647-4849-8a4b-4c4d4e4f5051';
    const created = await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'undo.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'undo.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });

    const undone = await authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    });
    expect(undone.operation.status).toBe('UNDONE');
    expect(undone.undoReceipt.undoReceiptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => authority.verifyOperationToken(operationId, created.operationToken))
      .toThrowError('导入操作授权无效');
    await expect(stat(path.join(projectRoot, 'content', 'assets', 'bg', 'undo.png')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const quarantine = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'undo', `${itemId}.bin`);
    await expect(readFile(quarantine, 'utf8')).resolves.toBe('hello');
    await expect(authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    })).resolves.toEqual(undone);
    await expect(authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: 'f'.repeat(64),
    })).rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
  });

  it.each([
    { mode: 'changed' as const, operationId: '52535455-5657-4859-8a5b-5c5d5e5f6061' },
    { mode: 'missing' as const, operationId: '62636465-6667-4869-8a6b-6c6d6e6f7071' },
    { mode: 'replaced' as const, operationId: '72737475-7677-4879-8a7b-7c7d7e7f8081' },
  ])('blocks the entire undo before mutation when one receipt target is $mode', async ({ mode, operationId }) => {
    const { authority, projectRoot } = await fixture();
    const firstId = `${operationId.slice(0, 8)}-1111-4111-8111-111111111111`;
    const secondId = `${operationId.slice(0, 8)}-2222-4222-8222-222222222222`;
    await authority.createOperation({
      operationId,
      items: [
        { itemId: firstId, sourceName: 'undo-first.png', declaredBytes: 5 },
        { itemId: secondId, sourceName: 'undo-second.png', declaredBytes: 5 },
      ],
    });
    await authority.uploadItem(operationId, firstId, Readable.from(Buffer.from('first')));
    await authority.uploadItem(operationId, secondId, Readable.from(Buffer.from('other')));
    const planned = await authority.plan(operationId, {
      targets: [
        { itemId: firstId, kind: 'background', fileName: `${mode}-first.png` },
        { itemId: secondId, kind: 'background', fileName: `${mode}-second.png` },
      ],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    const first = path.join(projectRoot, 'content', 'assets', 'bg', `${mode}-first.png`);
    const second = path.join(projectRoot, 'content', 'assets', 'bg', `${mode}-second.png`);
    if (mode === 'changed') await writeFile(first, 'changed-after-commit');
    if (mode === 'missing') await rm(first);
    if (mode === 'replaced') {
      await rm(first);
      await writeFile(first, 'first');
    }

    await expect(authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    })).rejects.toMatchObject({ code: 'IMPORT_UNDO_BLOCKED_CHANGED' });
    expect((await authority.query(operationId)).operation.status).toBe('COMMITTED');
    await expect(readFile(second, 'utf8')).resolves.toBe('other');
    if (mode !== 'missing') await expect(stat(first)).resolves.toMatchObject({ size: expect.any(Number) });
    const undoRoot = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'undo');
    await expect(readdir(undoRoot)).resolves.toEqual([]);
  });

  it.each([
    {
      point: 'after_undo_rename_intent_before_rename' as const,
      operationId: '82838485-8687-4889-8a8b-8c8d8e8f9091',
      itemId: '92939495-9697-4899-8a9b-9c9d9e9fa0a1',
    },
    {
      point: 'after_undo_final_rename_before_quarantined_journal' as const,
      operationId: 'a2a3a4a5-a6a7-48a9-8aab-acadaeafb0b1',
      itemId: 'b2b3b4b5-b6b7-48b9-8abb-bcbdbebfc0c1',
    },
    {
      point: 'after_undo_quarantine_verify_before_undo_receipt' as const,
      operationId: 'c2c3c4c5-c6c7-48c9-8acb-cccdcecfd0d1',
      itemId: 'd2d3d4d5-d6d7-48d9-8adb-dcdddedfe0e1',
    },
  ])('recovers an interrupted undo at $point', async ({ point, operationId, itemId }) => {
    const { authority, paths, projectRoot } = await fixture();
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'undo-crash.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: `${itemId.slice(0, 4)}-undo-crash.png` }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    const faulted = reopenedAuthority(paths, (faultPoint) => {
      if (faultPoint === point) throw new Error('stop during undo');
    });
    await expect(faulted.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    })).rejects.toBeInstanceOf(AssetImportInjectedTermination);

    const recovered = reopenedAuthority(paths);
    const result = await recovered.recover(operationId, { action: 'resume' });
    expect(result.detail.operation.status).toBe('UNDONE');
    expect(result.detail.undoReceipt?.undoReceiptSha256).toMatch(/^[0-9a-f]{64}$/);
    const target = path.join(projectRoot, 'content', 'assets', 'bg', `${itemId.slice(0, 4)}-undo-crash.png`);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    const quarantine = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'undo', `${itemId}.bin`);
    await expect(readFile(quarantine, 'utf8')).resolves.toBe('hello');
  }, 30_000);

  it('revalidates target parent identity before resuming an interrupted undo', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '11223344-5566-4788-8abc-def012345678';
    const itemId = '22334455-6677-4899-8abc-def012345679';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'parent.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'parent-recovery.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    const faulted = reopenedAuthority(paths, (point) => {
      if (point === 'after_undo_rename_intent_before_rename') throw new Error('stop before undo rename');
    });
    await expect(faulted.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    })).rejects.toBeInstanceOf(AssetImportInjectedTermination);

    const targetParent = path.join(projectRoot, 'content', 'assets', 'bg');
    const displacedParent = path.join(projectRoot, 'content', 'assets', 'bg-before-replacement');
    await rename(targetParent, displacedParent);
    await mkdir(targetParent);
    await expect(reopenedAuthority(paths).recover(operationId, { action: 'resume' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(path.join(displacedParent, 'parent-recovery.png'), 'utf8')).resolves.toBe('hello');
    await expect(readdir(targetParent)).resolves.toEqual([]);
  });

  it('preflights every remaining target before continuing a partial multi-file undo', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '99aabbcc-ddee-4f01-8abc-456789abcdef';
    const firstId = 'aabbccdd-eeff-4012-8bcd-56789abcdef0';
    const secondId = 'bbccddee-ff00-4123-8cde-6789abcdef01';
    await authority.createOperation({
      operationId,
      items: [
        { itemId: firstId, sourceName: 'first.png', declaredBytes: 5 },
        { itemId: secondId, sourceName: 'second.png', declaredBytes: 6 },
      ],
    });
    await authority.uploadItem(operationId, firstId, Readable.from(Buffer.from('first')));
    await authority.uploadItem(operationId, secondId, Readable.from(Buffer.from('second')));
    const planned = await authority.plan(operationId, {
      targets: [
        { itemId: firstId, kind: 'background', fileName: 'partial-first.png' },
        { itemId: secondId, kind: 'background', fileName: 'partial-second.png' },
      ],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    let renameCount = 0;
    const faulted = reopenedAuthority(paths, (point) => {
      if (point === 'after_undo_final_rename_before_quarantined_journal' && ++renameCount === 1) {
        throw new Error('stop after first undo rename');
      }
    });
    await expect(faulted.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    })).rejects.toBeInstanceOf(AssetImportInjectedTermination);
    const secondTarget = path.join(projectRoot, 'content', 'assets', 'bg', 'partial-second.png');
    await writeFile(secondTarget, 'changed-after-partial-undo');

    await expect(reopenedAuthority(paths).recover(operationId, { action: 'resume' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(secondTarget, 'utf8')).resolves.toBe('changed-after-partial-undo');
    const secondQuarantine = path.join(
      projectRoot,
      '.surdet',
      'asset-import',
      operationId,
      'undo',
      `${secondId}.bin`,
    );
    await expect(stat(secondQuarantine)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores unexpected undo bytes only to an absent final path and enters recovery', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '33445566-7788-49aa-8bcd-ef0123456789';
    const itemId = '44556677-8899-4abb-8cde-f0123456789a';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'race.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'undo-race.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    const faulted = reopenedAuthority(paths, (point) => {
      if (point === 'after_undo_final_rename_before_quarantined_journal') throw new Error('stop after undo rename');
    });
    await expect(faulted.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    })).rejects.toBeInstanceOf(AssetImportInjectedTermination);
    const target = path.join(projectRoot, 'content', 'assets', 'bg', 'undo-race.png');
    const quarantine = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'undo', `${itemId}.bin`);
    await writeFile(quarantine, 'changed-after-rename');

    await expect(reopenedAuthority(paths).recover(operationId, { action: 'resume' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(target, 'utf8')).resolves.toBe('changed-after-rename');
    await expect(stat(quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await new AssetImportRecordStore(paths).readOperation(operationId)).journal.status)
      .toBe('RECOVERY_REQUIRED');
  });

  it('fails closed when an UNDONE operation loses its immutable undo receipt', async () => {
    const { authority, paths } = await fixture();
    const operationId = '55667788-99aa-4bbc-8def-0123456789ab';
    const itemId = '66778899-aabb-4ccd-8efa-123456789abc';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'missing.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'missing-undo-receipt.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    await authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    });
    await rm(path.join(paths.projectNamespace, 'operations', operationId, 'undo-receipt.json'));

    await expect(authority.query(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('keeps a recovery barrier unresolved when retained undo quarantine bytes change', async () => {
    const { authority, paths, projectRoot } = await fixture();
    const operationId = '778899aa-bbcc-4dde-8fab-23456789abcd';
    const itemId = '8899aabb-ccdd-4eef-8abc-3456789abcde';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'barrier.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'barrier-undo.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    await authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    });
    const store = new AssetImportRecordStore(paths);
    await store.ensureOperationRecoveryBarrier(operationId, undefined, 'test-undo-quarantine-change');
    const quarantine = path.join(projectRoot, '.surdet', 'asset-import', operationId, 'undo', `${itemId}.bin`);
    await writeFile(quarantine, 'changed-after-undo');

    await expect(reopenedAuthority(paths).recover(operationId, { action: 'resume' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('fails closed when the immutable undo receipt is changed on disk', async () => {
    const { authority, paths } = await fixture();
    const operationId = 'e2e3e4e5-e6e7-48e9-8aeb-ecedeeeff0f1';
    const itemId = 'f2f3f4f5-f6f7-48f9-8afb-fcfdfeff0011';
    await authority.createOperation({ operationId, items: [{ itemId, sourceName: 'undo-receipt.png', declaredBytes: 5 }] });
    await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('hello')));
    const planned = await authority.plan(operationId, {
      targets: [{ itemId, kind: 'background', fileName: 'undo-receipt.png' }],
    });
    await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
    const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
    await authority.undo(operationId, {
      receiptId: committed.receipt.receiptId,
      receiptSha256: committed.receipt.receiptSha256,
    });
    const undoReceiptFile = path.join(paths.projectNamespace, 'operations', operationId, 'undo-receipt.json');
    const undoReceipt = JSON.parse(await readFile(undoReceiptFile, 'utf8'));
    undoReceipt.undoneAt = 'changed-after-undo';
    await writeFile(undoReceiptFile, `${JSON.stringify(undoReceipt, null, 2)}\n`);

    await expect(authority.query(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });
});
