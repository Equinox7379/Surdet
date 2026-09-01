import * as crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectAssetImportAuthority } from '../src/asset-import-authority/authority.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';

const roots: string[] = [];
const textHasher = {
  sha256: async (text: string): Promise<string> => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
};

async function fixture(): Promise<{
  projectRoot: string;
  authority: ProjectAssetImportAuthority;
  paths: Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surdet-asset-import-authority-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  await mkdir(path.join(projectRoot, 'content', 'assets', 'bg'), { recursive: true });
  const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(root, 'data') });
  return {
    projectRoot,
    paths,
    authority: new ProjectAssetImportAuthority(paths, new AssetImportRecordStore(paths), {
      textHasher,
      assertLeaseHeld: () => undefined,
    }),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project asset import authority operations', () => {
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
});
