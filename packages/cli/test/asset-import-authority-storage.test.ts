import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { stableStringify } from '@surdet/authoring';
import { ProjectAssetImportAuthority } from '../src/asset-import-authority/authority.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';
import { acquireAssetImportProjectLease } from '../src/asset-import-authority/project-lease.js';
import { AssetImportBindingService } from '../src/asset-import-authority/binding.js';
import {
  ASSET_IMPORT_AUTHORITY_BASE_PATH,
  ASSET_IMPORT_AUTHORITY_TOKEN_HEADER,
  createAssetImportAuthorityHttpHandler,
  type AssetImportAuthorityHttpTarget,
} from '../src/asset-import-authority/http-handler.js';

const roots: string[] = [];
const servers: http.Server[] = [];

const textHasher = {
  sha256: async (text: string): Promise<string> => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
};

type AuthorityPaths = Awaited<ReturnType<typeof openAssetImportAuthorityPaths>>;

function testAuthority(paths: AuthorityPaths): ProjectAssetImportAuthority {
  return new ProjectAssetImportAuthority(paths, new AssetImportRecordStore(paths), {
    textHasher,
    assertLeaseHeld: () => undefined,
  });
}

async function createCommittedFixture(
  paths: AuthorityPaths,
  operationId: string,
  itemId: string,
  fileName: string,
): Promise<{
  authority: ProjectAssetImportAuthority;
  planFingerprint: string;
  receiptId: string;
  receiptSha256: string;
}> {
  const authority = testAuthority(paths);
  await authority.createOperation({
    operationId,
    items: [{ itemId, sourceName: fileName, declaredBytes: 4 }],
  });
  await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('data')));
  const planned = await authority.plan(operationId, {
    targets: [{ itemId, kind: 'background', fileName }],
  });
  await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
  const committed = await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });
  return {
    authority,
    planFingerprint: planned.plan.planFingerprint,
    receiptId: committed.receipt.receiptId,
    receiptSha256: committed.receipt.receiptSha256,
  };
}

async function createUndoneFixture(
  paths: AuthorityPaths,
  operationId: string,
  itemId: string,
  fileName: string,
): Promise<{
  authority: ProjectAssetImportAuthority;
  quarantineFile: string;
}> {
  const committed = await createCommittedFixture(paths, operationId, itemId, fileName);
  await committed.authority.undo(operationId, {
    receiptId: committed.receiptId,
    receiptSha256: committed.receiptSha256,
  });
  return {
    authority: committed.authority,
    quarantineFile: path.join(
      paths.projectRoot,
      '.surdet',
      'asset-import',
      operationId,
      'undo',
      `${itemId}.bin`,
    ),
  };
}

function jsonRecordSha256(value: unknown): string {
  return crypto.createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`, 'utf8').digest('hex');
}

function stableRecordSha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

async function createUploadingJournalFixture(
  paths: AuthorityPaths,
  operationId: string,
  itemId: string,
): Promise<{
  store: AssetImportRecordStore;
  initial: Awaited<ReturnType<AssetImportRecordStore['createInitialJournal']>>;
  journalFile: string;
}> {
  const store = new AssetImportRecordStore(paths);
  const createdAt = '2026-09-01T00:00:00.000Z';
  await store.registerOperation({ operationId, itemCount: 1, createdAt });
  await store.createOperationManifest({
    schemaVersion: 1,
    operationId,
    createdAt,
    manifestFingerprint: 'a'.repeat(64),
    items: [{ itemId, sourceName: 'journal-generation.png', declaredBytes: 0 }],
  });
  const initial = await store.createInitialJournal(operationId, {
    status: 'UPLOADING',
    itemCount: 1,
    updatedAt: createdAt,
  });
  return {
    store,
    initial,
    journalFile: path.join(paths.projectNamespace, 'operations', operationId, 'journal.json'),
  };
}

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

type ChallengeParent = 'challenge-index' | 'challenges';
type ChallengeParentReplacement = 'non-directory' | 'symlink';

async function replaceChallengeParent(
  fixture: string,
  paths: AuthorityPaths,
  parent: ChallengeParent,
  replacement: ChallengeParentReplacement,
): Promise<void> {
  const directory = path.join(paths.projectNamespace, parent);
  await rm(directory, { recursive: true, force: true });
  if (replacement === 'non-directory') {
    await writeFile(directory, 'not a directory', 'utf8');
    return;
  }
  const mirror = path.join(fixture, `${parent}-mirror`);
  await mkdir(mirror, { recursive: true });
  await symlink(mirror, directory, process.platform === 'win32' ? 'junction' : 'dir');
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
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

  it('rejects an authority data root that overlaps the project without creating it', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-overlap');
    const projectRoot = path.join(fixture, 'project');
    const nestedDataRoot = path.join(projectRoot, '.authority-data');
    await mkdir(projectRoot, { recursive: true });

    await expect(openAssetImportAuthorityPaths({ projectRoot, dataRoot: nestedDataRoot }))
      .rejects.toMatchObject({ code: 'IMPORT_TARGET_UNSAFE', details: { field: 'dataRoot' } });
    await expect(readFile(path.join(nestedDataRoot, 'data-root-identity.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });

    await expect(openAssetImportAuthorityPaths({ projectRoot, dataRoot: fixture }))
      .rejects.toMatchObject({ code: 'IMPORT_TARGET_UNSAFE', details: { field: 'dataRoot' } });
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
    await store.createOperationManifest({
      schemaVersion: 1,
      operationId,
      createdAt: '2026-09-01T00:00:00.000Z',
      manifestFingerprint: 'a'.repeat(64),
      items: [{
        itemId: '22222222-2222-4222-8222-222222222222',
        sourceName: 'fixture.png',
        declaredBytes: 1,
      }],
    });
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

  it.each(['old', 'skipped', 'pseudo-terminal'] as const)(
    'rejects a $mode current journal generation after restart',
    async (mode) => {
      const fixture = await temporaryRoot(`surdet-asset-import-journal-generation-${mode}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const operationId = '45454545-4545-4454-8454-454545454545';
      const itemId = '56565656-5656-4565-8565-565656565656';
      const { store, initial, journalFile } = await createUploadingJournalFixture(paths, operationId, itemId);
      const initialBytes = await readFile(journalFile);
      const current = await store.writeJournal(initial, {
        ...initial,
        status: 'STAGED',
        updatedAt: '2026-09-01T00:01:00.000Z',
      });
      const currentBytes = await readFile(journalFile);
      const currentValue = JSON.parse(currentBytes.toString('utf8')) as typeof current;
      let replacement: typeof current;
      if (mode === 'old') {
        replacement = JSON.parse(initialBytes.toString('utf8')) as typeof current;
      } else if (mode === 'skipped') {
        replacement = {
          ...currentValue,
          journalVersion: currentValue.journalVersion + 2,
          previousGenerationSha256: jsonRecordSha256(currentValue),
          status: 'READY',
          updatedAt: '2026-09-01T00:03:00.000Z',
        };
      } else {
        replacement = {
          ...JSON.parse(initialBytes.toString('utf8')) as typeof current,
          journalVersion: 2,
          previousGenerationSha256: jsonRecordSha256(JSON.parse(initialBytes.toString('utf8'))),
          status: 'COMMITTED',
          updatedAt: '2026-09-01T00:02:00.000Z',
        };
      }
      await writeFile(journalFile, `${JSON.stringify(replacement, null, 2)}\n`, 'utf8');

      await expect(new AssetImportRecordStore(paths).readOperation(operationId))
        .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
      await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
    },
  );

  it('bounds ordinary binding discovery to the latest 20 terminal records without reading older staged binaries', async () => {
    const authorityToken = 'a'.repeat(64);
    const challengeId = '11111111-1111-4111-8111-111111111111';
    const operations = Array.from({ length: 25 }, (_, index) => {
      const operationId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      const updatedAt = new Date(Date.parse('2026-09-01T00:00:00.000Z') + index * 1_000).toISOString();
      return {
        schemaVersion: 1 as const,
        operationId,
        journalVersion: 4,
        previousGenerationSha256: 'a'.repeat(64),
        status: 'COMMITTED' as const,
        itemCount: 1,
        updatedAt,
      };
    });
    const queried: string[] = [];
    const target = {
      projectIdentity: 'b'.repeat(64),
      async createChallenge() {
        return {
          challengeId,
          relativeProbePath: '.surdet-bind-test.json',
          expiresAt: '2026-09-01T00:01:00.000Z',
        };
      },
      async confirmChallenge() {
        return {
          projectIdentity: 'b'.repeat(64),
          projectName: 'fixture',
          bindingToken: 'c'.repeat(64),
          bindingExpiresAt: '2026-09-01T00:30:00.000Z',
          recoveryBarrier: 'clear' as const,
          pendingOperations: [],
          recentReceipts: [],
        };
      },
      validateBinding() {
        return true;
      },
      revoke() {},
      async list() {
        return { operations };
      },
      async query(operationId: string) {
        const index = Number.parseInt(operationId.slice(-12), 16);
        if (index < 5) throw new Error('older terminal staged binary must not be read during discovery');
        queried.push(operationId);
        const operation = operations[index]!;
        return {
          operation,
          manifest: null as never,
          stagedItems: [],
          plan: null,
          receipt: {
            schemaVersion: 1,
            receiptId: `receipt-${index}`,
            receiptSha256: 'd'.repeat(64),
            operationId,
            planId: `plan-${index}`,
            planFingerprint: 'e'.repeat(64),
            projectIdentity: 'b'.repeat(64),
            status: 'COMMITTED' as const,
            journalVersion: operation.journalVersion,
            authorityContractVersion: 1 as const,
            files: [],
            committedAt: operation.updatedAt,
          },
          undoReceipt: null,
        };
      },
    } as unknown as AssetImportAuthorityHttpTarget;

    let origin = '';
    const server = http.createServer(createAssetImportAuthorityHttpHandler({
      authority: target,
      token: authorityToken,
      expectedOrigin: () => origin,
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing test server address');
    origin = `http://127.0.0.1:${address.port}`;
    const headers = {
      Origin: origin,
      'Content-Type': 'application/json',
      [ASSET_IMPORT_AUTHORITY_TOKEN_HEADER]: authorityToken,
    };

    const response = await fetch(`${origin}${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges/${challengeId}/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ browserSessionId: 'browser-1', nonce: 'nonce' }),
    });
    const body = await response.json() as {
      data?: { recentReceipts?: Array<{ operationId: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.data?.recentReceipts).toHaveLength(20);
    expect(queried).toHaveLength(20);
    expect(queried).toEqual(operations.slice(5).reverse().map((operation) => operation.operationId));
  });

  it.each(['missing', 'invalid'] as const)(
    'restarts into recovery when a COMMITTED operation has a %s success receipt',
    async (receiptState) => {
      const fixture = await temporaryRoot(`surdet-asset-import-committed-${receiptState}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const makeAuthority = () => new ProjectAssetImportAuthority(paths, new AssetImportRecordStore(paths), {
        textHasher,
        assertLeaseHeld: () => undefined,
      });
      const operationId = '12121212-1212-4121-8121-121212121212';
      const itemId = '23232323-2323-4232-8232-232323232323';
      const authority = makeAuthority();

      await authority.createOperation({
        operationId,
        items: [{ itemId, sourceName: 'restart-receipt.png', declaredBytes: 4 }],
      });
      await authority.uploadItem(operationId, itemId, Readable.from(Buffer.from('data')));
      const planned = await authority.plan(operationId, {
        targets: [{ itemId, kind: 'background', fileName: 'restart-receipt.png' }],
      });
      await authority.seal(operationId, { planFingerprint: planned.plan.planFingerprint });
      await authority.commit(operationId, { planFingerprint: planned.plan.planFingerprint });

      const receiptFile = path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json');
      if (receiptState === 'missing') {
        await rm(receiptFile);
      } else {
        const receipt = JSON.parse(await readFile(receiptFile, 'utf8')) as { committedAt: string };
        receipt.committedAt = 'tampered-after-commit';
        await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
      }

      const reopened = makeAuthority();
      await expect(reopened.query(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
      expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
    },
  );

  it('does not report clear after restart when an UPLOADING operation retains an unfinished upload intent', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-upload-restart');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const store = new AssetImportRecordStore(paths);
    const operationId = '34343434-3434-4343-8343-343434343434';
    const itemId = '45454545-4545-4454-8454-454545454545';
    const nonce = '56565656-5656-4565-8565-565656565656';
    const createdAt = '2026-09-01T00:00:00.000Z';

    await store.registerOperation({ operationId, itemCount: 1, createdAt });
    await store.createOperationManifest({
      schemaVersion: 1,
      operationId,
      createdAt,
      manifestFingerprint: 'a'.repeat(64),
      items: [{ itemId, sourceName: 'unfinished-upload.png', declaredBytes: 7 }],
    });
    await store.createInitialJournal(operationId, { status: 'UPLOADING', itemCount: 1, updatedAt: createdAt });
    await store.createUploadIntent({
      schemaVersion: 1,
      operationId,
      itemId,
      nonce,
      partialFileName: `.${itemId}.${nonce}.partial`,
      createdAt,
    });
    await writeFile(store.stagedItemTemporaryFile(operationId, itemId, nonce), 'partial', 'utf8');

    const reopenedBinding = new AssetImportBindingService(paths, new AssetImportRecordStore(paths));
    const challenge = await reopenedBinding.createChallenge('browser-session-restarted');
    const probe = JSON.parse(await readFile(path.join(projectRoot, challenge.relativeProbePath), 'utf8')) as { nonce: string };
    const discovered = await reopenedBinding.confirmChallenge(challenge.challengeId, {
      browserSessionId: 'browser-session-restarted',
      nonce: probe.nonce,
    });

    const safelyReconciled = discovered.recoveryBarrier !== 'clear'
      || (discovered.pendingOperations.length === 0
        && await readFile(store.stagedItemTemporaryFile(operationId, itemId, nonce)).then(() => false).catch(() => true));
    expect(safelyReconciled).toBe(true);
  });

  it.each(['directory', 'symlink'] as const)(
    'fails closed instead of skipping a non-regular operation-index %s',
    async (entryKind) => {
      const fixture = await temporaryRoot(`surdet-asset-import-index-${entryKind}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const store = new AssetImportRecordStore(paths);
      const operationId = '67676767-6767-4676-8676-676767676767';
      const itemId = '78787878-7878-4787-8787-787878787878';
      const createdAt = '2026-09-01T00:00:00.000Z';

      await store.registerOperation({ operationId, itemCount: 1, createdAt });
      await store.createOperationManifest({
        schemaVersion: 1,
        operationId,
        createdAt,
        manifestFingerprint: 'a'.repeat(64),
        items: [{ itemId, sourceName: 'index-entry.png', declaredBytes: 0 }],
      });
      await store.createInitialJournal(operationId, { status: 'UPLOADING', itemCount: 1, updatedAt: createdAt });

      const regularIndex = path.join(paths.projectNamespace, 'operation-index', `${operationId}.json`);
      const invalidEntry = path.join(
        paths.projectNamespace,
        'operation-index',
        entryKind === 'directory' ? 'unknown-entry' : 'unknown-entry.json',
      );
      if (entryKind === 'directory') await mkdir(invalidEntry);
      else await symlink(regularIndex, invalidEntry, 'file');

      await expect(store.listOperations()).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    },
  );

  it('fails closed when the operation journal is replaced by a symlink', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-journal-symlink');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const store = new AssetImportRecordStore(paths);
    const operationId = '89898989-8989-4898-8898-898989898989';
    const itemId = '9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a';
    const createdAt = '2026-09-01T00:00:00.000Z';

    await store.registerOperation({ operationId, itemCount: 1, createdAt });
    await store.createOperationManifest({
      schemaVersion: 1,
      operationId,
      createdAt,
      manifestFingerprint: 'b'.repeat(64),
      items: [{ itemId, sourceName: 'journal-symlink.png', declaredBytes: 0 }],
    });
    await store.createInitialJournal(operationId, { status: 'UPLOADING', itemCount: 1, updatedAt: createdAt });

    const journalFile = path.join(paths.projectNamespace, 'operations', operationId, 'journal.json');
    const mirror = path.join(fixture, 'journal-mirror.json');
    await writeFile(mirror, await readFile(journalFile));
    await rm(journalFile);
    await symlink(mirror, journalFile, 'file');

    await expect(new AssetImportRecordStore(paths).readOperation(operationId))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
  });

  it.each(['directory', 'symlink'] as const)(
    'does not silently skip a recovery-barrier %s leaf',
    async (entryKind) => {
      const fixture = await temporaryRoot(`surdet-asset-import-barrier-${entryKind}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const barrierId = 'barrier_storage_entry_11111111';
      const barrierFile = path.join(paths.projectNamespace, 'recovery-barriers', `${barrierId}.json`);
      const incident = {
        barrierId,
        operationId: 'abababab-abab-4bab-8bab-abababababab',
        reason: 'RECOVERY_REQUIRED',
        createdAt: '2026-09-01T00:00:00.000Z',
      };
      if (entryKind === 'directory') {
        await mkdir(barrierFile);
      } else {
        const mirror = path.join(fixture, 'barrier-mirror.json');
        await writeFile(mirror, `${JSON.stringify(incident)}\n`, 'utf8');
        await symlink(mirror, barrierFile, 'file');
      }

      await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
    },
  );

  it.each([
    { parent: 'challenge-index', replacement: 'non-directory', method: 'list' },
    { parent: 'challenge-index', replacement: 'non-directory', method: 'create' },
    { parent: 'challenge-index', replacement: 'non-directory', method: 'read' },
    { parent: 'challenge-index', replacement: 'symlink', method: 'list' },
    { parent: 'challenge-index', replacement: 'symlink', method: 'create' },
    { parent: 'challenge-index', replacement: 'symlink', method: 'read' },
    { parent: 'challenges', replacement: 'non-directory', method: 'list' },
    { parent: 'challenges', replacement: 'non-directory', method: 'create' },
    { parent: 'challenges', replacement: 'non-directory', method: 'read' },
    { parent: 'challenges', replacement: 'symlink', method: 'list' },
    { parent: 'challenges', replacement: 'symlink', method: 'create' },
    { parent: 'challenges', replacement: 'symlink', method: 'read' },
  ] as const)(
    'fails closed when the $parent parent is replaced by a $replacement before challenge $method',
    async ({ parent, replacement, method }) => {
      const fixture = await temporaryRoot(`surdet-asset-import-${parent}-${replacement}-${method}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const store = new AssetImportRecordStore(paths);
      const service = new AssetImportBindingService(paths, store);
      const challenge = await service.createChallenge('browser-session-1');
      await replaceChallengeParent(fixture, paths, parent, replacement);

      const action = method === 'list'
        ? store.listChallenges()
        : method === 'create'
          ? service.createChallenge('browser-session-2')
          : store.readChallenge(challenge.challengeId);
      await expect(action).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    },
  );

  it('fails closed when a recovery resolution is replaced by a symlink', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-resolution-symlink');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const operationId = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
    const itemId = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    await createCommittedFixture(paths, operationId, itemId, 'resolution-symlink.png');

    const store = new AssetImportRecordStore(paths);
    const barrierId = 'barrier_resolution_symlink_111111';
    await store.writeBarrier({
      barrierId,
      operationId,
      reason: 'RECOVERY_REQUIRED',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    await store.resolveBarrier({ barrierId, resolvedAt: '2026-09-01T00:01:00.000Z' });

    const resolutionFile = path.join(paths.projectNamespace, 'recovery-resolutions', `${barrierId}.json`);
    const mirror = path.join(fixture, 'resolution-mirror.json');
    await writeFile(mirror, await readFile(resolutionFile));
    await rm(resolutionFile);
    await symlink(mirror, resolutionFile, 'file');

    await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
  });

  it('blocks recovery when a COMMITTED publication journal is missing before resolving its barrier', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-committed-publication-missing');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const operationId = 'dededede-dede-4ede-8ede-dededededede';
    const itemId = 'efefefef-efef-4fef-8fef-efefefefefef';
    await createCommittedFixture(paths, operationId, itemId, 'missing-publication.png');
    const store = new AssetImportRecordStore(paths);
    const barrierId = 'barrier_missing_publication_111111';
    await store.writeBarrier({
      barrierId,
      operationId,
      reason: 'RECOVERY_REQUIRED',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    await rm(path.join(paths.projectNamespace, 'operations', operationId, 'publication.json'));

    await expect(testAuthority(paths).recover(operationId, { action: 'resume' }))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(readFile(path.join(paths.projectNamespace, 'recovery-resolutions', `${barrierId}.json`)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
  });

  it('fails closed when a COMMITTED receipt is replaced by a symlink to valid JSON', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-receipt-symlink');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const operationId = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
    const itemId = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
    await createCommittedFixture(paths, operationId, itemId, 'receipt-symlink.png');

    const receiptFile = path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json');
    const mirror = path.join(fixture, 'receipt-mirror.json');
    await writeFile(mirror, await readFile(receiptFile));
    await rm(receiptFile);
    await symlink(mirror, receiptFile, 'file');

    await expect(testAuthority(paths).query(operationId))
      .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
  });

  it.each(['missing', 'tampered'] as const)(
    'keeps a resolved COMMITTED barrier unresolved when its success receipt is $0',
    async (receiptState) => {
      const fixture = await temporaryRoot(`surdet-asset-import-committed-resolution-${receiptState}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const operationId = '12121212-1212-4121-8121-121212121212';
      const itemId = '23232323-2323-4232-8232-232323232323';
      await createCommittedFixture(paths, operationId, itemId, `resolved-committed-${receiptState}.png`);

      const store = new AssetImportRecordStore(paths);
      const barrierId = `barrier_committed_resolution_${receiptState}`;
      await store.writeBarrier({
        barrierId,
        operationId,
        reason: 'RECOVERY_REQUIRED',
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      await store.resolveBarrier({ barrierId, resolvedAt: '2026-09-01T00:01:00.000Z' });

      const receiptFile = path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json');
      if (receiptState === 'missing') {
        await rm(receiptFile);
      } else {
        const receipt = JSON.parse(await readFile(receiptFile, 'utf8')) as { committedAt: string };
        receipt.committedAt = 'tampered-after-resolution';
        await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
      }

      await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
    },
  );

  it.each(['missing', 'tampered'] as const)(
    'does not resolve a COMMITTED barrier when its success receipt is $0',
    async (receiptState) => {
      const fixture = await temporaryRoot(`surdet-asset-import-committed-resolution-reject-${receiptState}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const operationId = '34343434-3434-4343-8343-343434343434';
      const itemId = '45454545-4545-4454-8454-454545454545';
      await createCommittedFixture(paths, operationId, itemId, `unresolved-committed-${receiptState}.png`);

      const store = new AssetImportRecordStore(paths);
      const barrierId = `barrier_committed_resolution_reject_${receiptState}`;
      await store.writeBarrier({
        barrierId,
        operationId,
        reason: 'RECOVERY_REQUIRED',
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      const receiptFile = path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json');
      if (receiptState === 'missing') {
        await rm(receiptFile);
      } else {
        const receipt = JSON.parse(await readFile(receiptFile, 'utf8')) as { committedAt: string };
        receipt.committedAt = 'tampered-before-resolution';
        await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
      }

      await expect(store.resolveBarrier({ barrierId, resolvedAt: '2026-09-01T00:01:00.000Z' }))
        .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
      await expect(readFile(path.join(paths.projectNamespace, 'recovery-resolutions', `${barrierId}.json`)))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each(['missing-receipt', 'target-reappeared', 'publication-state'] as const)(
    'keeps a resolved UNDONE barrier unresolved when terminal evidence is $0',
    async (tamper) => {
      const fixture = await temporaryRoot(`surdet-asset-import-undone-resolution-${tamper}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const operationId = '56565656-5656-4656-8656-565656565656';
      const itemId = '67676767-6767-4676-8676-676767676767';
      const fileName = `resolved-undone-${tamper}.png`;
      await createUndoneFixture(paths, operationId, itemId, fileName);

      const store = new AssetImportRecordStore(paths);
      const barrierId = `barrier_undone_resolution_${tamper}`;
      await store.writeBarrier({
        barrierId,
        operationId,
        reason: 'RECOVERY_REQUIRED',
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      await store.resolveBarrier({ barrierId, resolvedAt: '2026-09-01T00:01:00.000Z' });

      if (tamper === 'missing-receipt') {
        await rm(path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json'));
      } else if (tamper === 'target-reappeared') {
        const target = path.join(paths.projectRoot, 'content', 'assets', 'bg', fileName);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, 'reappeared', 'utf8');
      } else {
        const publicationFile = path.join(paths.projectNamespace, 'operations', operationId, 'publication.json');
        const publication = JSON.parse(await readFile(publicationFile, 'utf8')) as {
          publicationSha256: string;
          files: Array<{ state: string }>;
        };
        publication.files[0]!.state = 'UNDO_QUARANTINED';
        const { publicationSha256: previousPublicationSha256, ...publicationSemantic } = publication;
        void previousPublicationSha256;
        publication.publicationSha256 = stableRecordSha256(publicationSemantic);
        await writeFile(publicationFile, `${JSON.stringify(publication, null, 2)}\n`, 'utf8');
      }

      await expect(new AssetImportRecordStore(paths).hasUnresolvedBarrier()).resolves.toBe(true);
    },
  );

  it.each(['missing-receipt', 'target-reappeared', 'publication-state'] as const)(
    'does not resolve an UNDONE barrier when terminal evidence is $0',
    async (tamper) => {
      const fixture = await temporaryRoot(`surdet-asset-import-undone-resolution-reject-${tamper}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const operationId = '78787878-7878-4787-8787-787878787878';
      const itemId = '89898989-8989-4898-8898-898989898989';
      const fileName = `unresolved-undone-${tamper}.png`;
      await createUndoneFixture(paths, operationId, itemId, fileName);

      const store = new AssetImportRecordStore(paths);
      const barrierId = `barrier_undone_resolution_reject_${tamper}`;
      await store.writeBarrier({
        barrierId,
        operationId,
        reason: 'RECOVERY_REQUIRED',
        createdAt: '2026-09-01T00:00:00.000Z',
      });

      if (tamper === 'missing-receipt') {
        await rm(path.join(paths.projectNamespace, 'operations', operationId, 'receipt.json'));
      } else if (tamper === 'target-reappeared') {
        const target = path.join(paths.projectRoot, 'content', 'assets', 'bg', fileName);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, 'reappeared', 'utf8');
      } else {
        const publicationFile = path.join(paths.projectNamespace, 'operations', operationId, 'publication.json');
        const publication = JSON.parse(await readFile(publicationFile, 'utf8')) as {
          publicationSha256: string;
          files: Array<{ state: string }>;
        };
        publication.files[0]!.state = 'UNDO_QUARANTINED';
        const { publicationSha256: previousPublicationSha256, ...publicationSemantic } = publication;
        void previousPublicationSha256;
        publication.publicationSha256 = stableRecordSha256(publicationSemantic);
        await writeFile(publicationFile, `${JSON.stringify(publication, null, 2)}\n`, 'utf8');
      }

      await expect(store.resolveBarrier({ barrierId, resolvedAt: '2026-09-01T00:01:00.000Z' }))
        .rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
      await expect(readFile(path.join(paths.projectNamespace, 'recovery-resolutions', `${barrierId}.json`)))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each([
    { method: 'list', tamper: 'missing' },
    { method: 'list', tamper: 'rewritten' },
    { method: 'list', tamper: 'symlink' },
    { method: 'query', tamper: 'missing' },
    { method: 'query', tamper: 'rewritten' },
    { method: 'query', tamper: 'symlink' },
    { method: 'create', tamper: 'missing' },
    { method: 'create', tamper: 'rewritten' },
    { method: 'create', tamper: 'symlink' },
  ] as const)(
    'blocks $method after an UNDONE quarantine is $tamper without a pre-existing barrier',
    async ({ method, tamper }) => {
      const fixture = await temporaryRoot(`surdet-asset-import-undone-${method}-${tamper}`);
      const projectRoot = path.join(fixture, 'project');
      await mkdir(projectRoot, { recursive: true });
      const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
      const operationId = 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3';
      const itemId = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';
      const { quarantineFile } = await createUndoneFixture(paths, operationId, itemId, 'undone-quarantine.png');

      expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(false);
      if (tamper === 'missing') {
        await rm(quarantineFile);
      } else if (tamper === 'rewritten') {
        await writeFile(quarantineFile, 'changed-after-undo', 'utf8');
      } else {
        const mirror = path.join(fixture, 'undo-quarantine-mirror.bin');
        await writeFile(mirror, 'data', 'utf8');
        await rm(quarantineFile);
        await symlink(mirror, quarantineFile, 'file');
      }

      const restarted = testAuthority(paths);
      if (method === 'list') {
        const listed = await restarted.list();
        expect(listed.operations).toContainEqual(expect.objectContaining({
          operationId,
          status: 'RECOVERY_REQUIRED',
        }));
        expect(await new AssetImportRecordStore(paths).hasUnresolvedBarrier()).toBe(true);
      } else if (method === 'query') {
        await expect(restarted.query(operationId)).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
      } else {
        await expect(restarted.createOperation({
          operationId: 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5',
          items: [{ itemId: 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', sourceName: 'new.png', declaredBytes: 4 }],
        })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
      }
    },
  );

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
    await expect(first.assertHeld()).resolves.toBeUndefined();
    await expect(acquireAssetImportProjectLease({ projectRoot, dataRoot })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
    await first.release();
    await expect(first.assertHeld()).rejects.toMatchObject({ code: 'IMPORT_AUTHORITY_NOT_READY' });
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

  it('binds a browser directory through an exact one-time probe and removes it', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-binding');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const service = new AssetImportBindingService(paths, new AssetImportRecordStore(paths), {
      now: () => Date.parse('2026-09-01T00:00:00.000Z'),
    });

    const challenge = await service.createChallenge('browser-session-1');
    const probe = JSON.parse(await readFile(path.join(projectRoot, challenge.relativeProbePath), 'utf8')) as { nonce: string };
    const confirmed = await service.confirmChallenge(challenge.challengeId, {
      browserSessionId: 'browser-session-1',
      nonce: probe.nonce,
    });

    expect(confirmed.projectIdentity).toBe(paths.projectIdentity);
    expect(confirmed.bindingToken).toMatch(/^[0-9a-f]{64}$/);
    await expect(readFile(path.join(projectRoot, challenge.relativeProbePath))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.validateBinding(confirmed.bindingToken, 'browser-session-1')).resolves.toBe(true);
    service.revoke('browser-session-1');
    await expect(service.validateBinding(confirmed.bindingToken, 'browser-session-1')).resolves.toBe(false);
  });

  it('revokes a binding when the bound project root is replaced', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-binding-root');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const service = new AssetImportBindingService(paths, new AssetImportRecordStore(paths));
    const challenge = await service.createChallenge('browser-session-1');
    const probe = JSON.parse(await readFile(path.join(projectRoot, challenge.relativeProbePath), 'utf8')) as { nonce: string };
    const confirmed = await service.confirmChallenge(challenge.challengeId, {
      browserSessionId: 'browser-session-1',
      nonce: probe.nonce,
    });

    await rename(projectRoot, path.join(fixture, 'replaced-project'));
    await mkdir(projectRoot);

    await expect(service.validateBinding(confirmed.bindingToken, 'browser-session-1')).resolves.toBe(false);
    await expect(service.validateBindingToken(confirmed.bindingToken)).resolves.toBe(false);
  });

  it('rejects a wrong browser session or nonce without issuing a binding', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-wrong-binding');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const service = new AssetImportBindingService(paths, new AssetImportRecordStore(paths));
    const challenge = await service.createChallenge('browser-session-1');

    await expect(service.confirmChallenge(challenge.challengeId, {
      browserSessionId: 'browser-session-2',
      nonce: 'wrong',
    })).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_MISMATCH' });
  });

  it('recovers only registered expired probe files with the authority marker', async () => {
    const fixture = await temporaryRoot('surdet-asset-import-probe-recovery');
    const projectRoot = path.join(fixture, 'project');
    await mkdir(projectRoot, { recursive: true });
    const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(fixture, 'data') });
    const store = new AssetImportRecordStore(paths);
    let now = Date.parse('2026-09-01T00:00:00.000Z');
    const service = new AssetImportBindingService(paths, store, { now: () => now });
    const challenge = await service.createChallenge('browser-session-1');
    const unrelated = path.join(projectRoot, '.surdet-bind-unrelated.json');
    await writeFile(unrelated, '{"owner":"user"}\n', 'utf8');
    now += 61_000;

    await new AssetImportBindingService(paths, new AssetImportRecordStore(paths), { now: () => now }).recoverExpiredChallenges();

    await expect(readFile(path.join(projectRoot, challenge.relativeProbePath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(unrelated, 'utf8')).toContain('user');
  });
});
