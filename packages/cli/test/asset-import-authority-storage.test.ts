import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';
import { acquireAssetImportProjectLease } from '../src/asset-import-authority/project-lease.js';

const roots: string[] = [];

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project asset import authority storage', () => {
  it('opens a stable external namespace without creating the project workspace', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-storage');
    const projectRoot = path.join(fixture, 'project');
    const dataRoot = path.join(fixture, 'authority-data');
    await mkdir(path.join(projectRoot, 'content', 'assets'), { recursive: true });

    const first = await openAssetImportAuthorityPaths({ projectRoot, dataRoot });
    const second = await openAssetImportAuthorityPaths({ projectRoot, dataRoot });

    expect(first.projectIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(second.projectIdentity).toBe(first.projectIdentity);
    expect(second.projectNamespace).toBe(first.projectNamespace);
    expect(await readFile(path.join(dataRoot, 'data-root-identity.json'), 'utf8')).toContain('asset-import-authority');
    await expect(readFile(path.join(projectRoot, '.surdet', 'asset-import', 'sentinel'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a non-absolute project root', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-relative');
    await expect(openAssetImportAuthorityPaths({ projectRoot: 'relative-project', dataRoot: fixture }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('registers operations create-only and discovers their latest journal after restart', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-records');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const store = new AssetImportRecordStore(paths);
    const operationId = '11111111-1111-4111-8111-111111111111';

    await store.registerOperation({ operationId, itemCount: 1, createdAt: '2026-09-01T00:00:00.000Z' });
    await expect(store.registerOperation({ operationId, itemCount: 2, createdAt: '2026-09-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
    const initial = await store.createInitialJournal(operationId, {
      status: 'UPLOADING',
      itemCount: 1,
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    await store.writeJournal(initial, {
      ...initial,
      status: 'STAGED',
      updatedAt: '2026-09-01T00:01:00.000Z',
    });

    const reopened = new AssetImportRecordStore(paths);
    const operations = await reopened.listOperations();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ operationId, status: 'STAGED', journalVersion: 2 });
  });

  it('persists an unresolved recovery barrier', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-barrier');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const store = new AssetImportRecordStore(paths);
    await store.writeBarrier({
      barrierId: 'barrier_1111111111111111',
      operationId: '11111111-1111-4111-8111-111111111111',
      reason: 'RECOVERY_REQUIRED',
      createdAt: '2026-09-01T00:00:00.000Z',
    });

    expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
  });

  it('allows only one lifetime authority lease for a project and data root', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-lease');
    const projectRoot = path.join(fixture, 'project');
    const dataRoot = path.join(fixture, 'data');
    await mkdir(projectRoot, { recursive: true });
    const first = await acquireAssetImportProjectLease({ projectRoot, dataRoot });
    await expect(acquireAssetImportProjectLease({ projectRoot, dataRoot })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
    await first.release();
    const replacement = await acquireAssetImportProjectLease({ projectRoot, dataRoot });
    await replacement.release();
  });

  it('fails closed when the persisted data-root identity is malformed', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-corrupt-root');
    const projectRoot = path.join(fixture, 'project');
    const dataRoot = path.join(fixture, 'data');
    await mkdir(projectRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await writeFile(path.join(dataRoot, 'data-root-identity.json'), '{broken', 'utf8');
    await expect(openAssetImportAuthorityPaths({ projectRoot, dataRoot }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
  });
});
