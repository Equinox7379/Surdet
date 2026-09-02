import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AssetImportClientError,
  createAssetImportAuthorityClient,
} from '../src/asset-import-client.js';
import {
  createAssetImportWorkspace,
  resolveAssetImportEntryState,
} from '../src/asset-import-workspace.js';

const AUTHORITY_PATH = '/__surdet/project-asset-import/v1';
const AUTHORITY_TOKEN = 'Z'.repeat(64);
const FIRST_BINDING_TOKEN = 'b'.repeat(64);
const SECOND_BINDING_TOKEN = 'd'.repeat(64);
const FIRST_OPERATION_TOKEN = 'c'.repeat(64);
const SECOND_OPERATION_TOKEN = 'e'.repeat(64);
const PROJECT_IDENTITY = '1'.repeat(64);
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const CHALLENGE_ID = '33333333-3333-4333-8333-333333333333';
const RECEIPT_ID = '44444444-4444-4444-8444-444444444444';
const RELOCATION_OPERATION_ID = '66666666-6666-4666-8666-666666666666';
const RELOCATION_RECEIPT_ID = '77777777-7777-4777-8777-777777777777';
const RELOCATION_OPERATION_TOKEN = 'r'.repeat(64);
const RELOCATION_RESUMED_TOKEN = 's'.repeat(64);
const SCENE_OPERATION_ID = '88888888-8888-4888-8888-888888888888';
const SCENE_REQUEST_ID = '99999999-9999-4999-8999-999999999999';
const SCENE_PLAN_FINGERPRINT = '8'.repeat(64);
const SCENE_SOURCE_PATH = 'content/scenario/chapter/old.gal';
const SCENE_TARGET_PATH = 'content/scenario/chapter/new.gal';

const configuration = {
  authorityContractVersion: 1 as const,
  endpoint: AUTHORITY_PATH,
  token: AUTHORITY_TOKEN,
};

type RequestRecord = { input: string; init: RequestInit };

function success(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function failure(
  code: string,
  retryDisposition: string,
  messageKey = `assetImport.${code}`,
): Response {
  return new Response(JSON.stringify({
    ok: false,
    error: { code, messageKey, retryDisposition },
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function operationSummary(status: 'UPLOADING' | 'STAGED' | 'READY' | 'COMMITTED' | 'UNDONE' = 'STAGED') {
  return {
    operationId: OPERATION_ID,
    status,
    itemCount: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
    manualRecoveryRequired: false,
  };
}

function operationDetail(status: 'STAGED' | 'READY' | 'COMMITTED' | 'UNDONE' = 'STAGED') {
  return {
    operation: operationSummary(status),
    plan: null,
    receipt: null,
    undoReceipt: null,
    allowedActions: status === 'STAGED' ? ['plan', 'cancel'] : ['commit', 'cancel'],
  };
}

function relocationEvidence(sha256 = 'a'.repeat(64)) {
  return {
    device: '1',
    inode: '2',
    birthtimeNs: '3',
    size: 5,
    mtimeNs: '4',
    sha256,
  };
}

function relocationSummary(status: 'PLANNED' | 'COMMITTED' | 'UNDONE' | 'RECOVERY_REQUIRED' = 'PLANNED') {
  return {
    operationId: RELOCATION_OPERATION_ID,
    status,
    sourcePath: 'content/assets/bg/old.webp',
    targetPath: 'content/assets/bg/new.webp',
    updatedAt: '2026-09-01T00:00:00.000Z',
    manualRecoveryRequired: status === 'RECOVERY_REQUIRED',
  };
}

function relocationPlan() {
  return {
    schemaVersion: 1,
    operationId: RELOCATION_OPERATION_ID,
    planId: 'relocation-plan-' + 'f'.repeat(32),
    planFingerprint: 'f'.repeat(64),
    status: 'ready',
    source: {
      path: 'content/assets/bg/old.webp',
      directory: 'content/assets/bg',
      fileName: 'old.webp',
      kind: 'background',
      key: 'old',
      format: 'webp',
      invalidName: false,
    },
    target: {
      path: 'content/assets/bg/new.webp',
      directory: 'content/assets/bg',
      fileName: 'new.webp',
      kind: 'background',
      key: 'new',
      format: 'webp',
      invalidName: false,
    },
    affectedReferenceCount: 0,
    affectedFileCount: 0,
    referenceChanges: [],
    blockers: [],
  };
}

function relocationReceipt() {
  return {
    schemaVersion: 1,
    receiptId: RELOCATION_RECEIPT_ID,
    receiptFingerprint: 'a'.repeat(64),
    operationId: RELOCATION_OPERATION_ID,
    planId: 'relocation-plan-' + 'f'.repeat(32),
    planFingerprint: 'f'.repeat(64),
    projectIdentity: PROJECT_IDENTITY,
    sourcePath: 'content/assets/bg/old.webp',
    targetPath: 'content/assets/bg/new.webp',
    targetIdentity: relocationEvidence(),
    textFiles: [],
    committedAt: '2026-09-01T00:02:00.000Z',
  };
}

function relocationUndoReceipt() {
  return {
    schemaVersion: 1,
    undoReceiptId: '88888888-8888-4888-8888-888888888888',
    undoReceiptFingerprint: 'b'.repeat(64),
    operationId: RELOCATION_OPERATION_ID,
    receiptId: RELOCATION_RECEIPT_ID,
    sourcePath: 'content/assets/bg/old.webp',
    targetPath: 'content/assets/bg/new.webp',
    sourceIdentity: relocationEvidence(),
    restoredTextFiles: [],
    undoneAt: '2026-09-01T00:03:00.000Z',
  };
}

function relocationDetail(status: 'PLANNED' | 'COMMITTED' | 'UNDONE' | 'RECOVERY_REQUIRED' = 'PLANNED') {
  return {
    request: {
      operationId: RELOCATION_OPERATION_ID,
      sourcePath: 'content/assets/bg/old.webp',
      targetPath: 'content/assets/bg/new.webp',
    },
    operation: relocationSummary(status),
    plan: relocationPlan(),
    receipt: status === 'COMMITTED' || status === 'UNDONE' ? relocationReceipt() : null,
    undoReceipt: status === 'UNDONE' ? relocationUndoReceipt() : null,
    allowedActions: status === 'PLANNED'
      ? ['commit', 'cancel']
      : status === 'COMMITTED'
        ? ['resume', 'undo']
        : status === 'RECOVERY_REQUIRED'
          ? ['resume', 'recover']
          : [],
  };
}

function batchRelocationDetail() {
  const firstSource = relocationPlan().source;
  const firstTarget = relocationPlan().target;
  const secondSource = {
    ...firstSource,
    path: 'content/assets/bg/other.webp',
    fileName: 'other.webp',
    key: 'other',
  };
  const secondTarget = {
    ...firstTarget,
    path: 'content/assets/bg/old.webp',
    fileName: 'old.webp',
    key: 'old',
  };
  const moves = [
    { sourcePath: firstSource.path, targetPath: firstTarget.path },
    { sourcePath: secondSource.path, targetPath: secondTarget.path },
  ];
  return {
    request: {
      operationId: RELOCATION_OPERATION_ID,
      sourcePath: moves[0]!.sourcePath,
      targetPath: moves[0]!.targetPath,
      moves,
    },
    operation: {
      ...relocationSummary(),
      sourcePath: moves[0]!.sourcePath,
      targetPath: moves[0]!.targetPath,
      moves,
    },
    plan: {
      schemaVersion: 2,
      operationId: RELOCATION_OPERATION_ID,
      planId: 'relocation-plan-' + 'e'.repeat(32),
      planFingerprint: 'e'.repeat(64),
      status: 'ready',
      source: firstSource,
      target: firstTarget,
      moves: [
        { moveId: 'move-a', source: firstSource, target: firstTarget },
        { moveId: 'move-b', source: secondSource, target: secondTarget },
      ],
      affectedAssetCount: 2,
      affectedReferenceCount: 0,
      affectedFileCount: 0,
      referenceChanges: [],
      blockers: [],
    },
    receipt: null,
    undoReceipt: null,
    allowedActions: ['commit', 'cancel'],
  };
}

function committedReceipt() {
  return {
    schemaVersion: 1,
    receiptId: RECEIPT_ID,
    receiptSha256: 'a'.repeat(64),
    operationId: OPERATION_ID,
    planId: 'p'.repeat(32),
    planFingerprint: 'f'.repeat(64),
    projectIdentity: PROJECT_IDENTITY,
    status: 'COMMITTED',
    journalVersion: 4,
    authorityContractVersion: 1,
    files: [],
    committedAt: '2026-09-01T00:02:00.000Z',
  } as const;
}

function plan() {
  return {
    schemaVersion: 1,
    planId: 'p'.repeat(32),
    planFingerprint: 'f'.repeat(64),
    projectIdentity: PROJECT_IDENTITY,
    manifestFingerprint: 'a'.repeat(64),
    status: 'ready',
    items: [{
      itemId: ITEM_ID,
      sourceName: '风景.png',
      bytes: 5,
      sha256: '0'.repeat(64),
      kind: 'background',
      fileName: '风景.png',
      targetPath: 'content/assets/bg/风景.png',
      issues: [],
    }],
    issues: [],
    totalBytes: 5,
  };
}

class MemoryFile {
  constructor(readonly name: string, readonly textValue: string) {}

  handle(): FileSystemFileHandle {
    return {
      kind: 'file',
      name: this.name,
      getFile: async () => ({
        name: this.name,
        size: new TextEncoder().encode(this.textValue).byteLength,
        text: async () => this.textValue,
        arrayBuffer: async () => new TextEncoder().encode(this.textValue).buffer,
      } as unknown as File),
    } as unknown as FileSystemFileHandle;
  }
}

class MemoryDirectory {
  readonly files = new Map<string, MemoryFile>();
  fileReadCount = 0;

  file(name: string, textValue: string): this {
    this.files.set(name, new MemoryFile(name, textValue));
    return this;
  }

  handle(): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: 'project',
      getFileHandle: async (name: string) => {
        this.fileReadCount += 1;
        const file = this.files.get(name);
        if (file === undefined) {
          const error = new Error(`missing file ${name}`);
          error.name = 'NotFoundError';
          throw error;
        }
        return file.handle();
      },
      getDirectoryHandle: async (name: string) => {
        const error = new Error(`missing directory ${name}`);
        error.name = 'NotFoundError';
        throw error;
      },
    } as unknown as FileSystemDirectoryHandle;
  }
}

interface FakeXhr {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  status: number;
  responseText: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
}

class UploadXhr implements FakeXhr {
  readonly upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  status = 200;
  responseText = '';
  timeout = -1;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = '';
  url = '';
  body: unknown = null;
  readonly headers = new Map<string, string>();

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(body: unknown): void {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 5 } as ProgressEvent);
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 5 } as ProgressEvent);
    this.responseText = JSON.stringify({ ok: true, data: {
      operationId: OPERATION_ID,
      itemId: ITEM_ID,
      bytes: 5,
      sha256: '0'.repeat(64),
      stagedItemFingerprint: 'b'.repeat(64),
    } });
    queueMicrotask(() => this.onload?.());
  }

  abort(): void {
    this.onabort?.();
  }
}

function clientOptions(
  fetcher: typeof fetch,
  xhrFactory?: () => XMLHttpRequest,
): Record<string, unknown> {
  return {
    configuration,
    fetcher,
    ...(xhrFactory === undefined ? {} : { xhrFactory }),
  };
}

function requestRecords(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): RequestRecord[] {
  return fetcher.mock.calls.map(([input, init]) => ({
    input: String(input),
    init: init ?? {},
  }));
}

function jsonBody(init: RequestInit): any {
  return JSON.parse(String(init.body));
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

function makeBindingFetcher(
  bindingToken = FIRST_BINDING_TOKEN,
  operationToken = FIRST_OPERATION_TOKEN,
): {
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  root: MemoryDirectory;
} {
  const root = new MemoryDirectory();
  const fetcher = vi.fn<typeof fetch>();
  let committed = false;
  fetcher.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/status')) {
      return success({
        authorityContractVersion: 1,
        authorityAvailable: true,
        projectIdentity: PROJECT_IDENTITY,
        bindingRequired: true,
      });
    }
    if (url.endsWith('/binding/challenges')) {
      root.file(`.surdet-bind-${CHALLENGE_ID}.json`, JSON.stringify({
        schemaVersion: 1,
        authority: 'surdet-asset-import',
        challengeId: CHALLENGE_ID,
        nonce: 'fresh-nonce',
        expiresAt: '2026-09-01T00:01:00.000Z',
      }));
      return success({
        challengeId: CHALLENGE_ID,
        relativeProbePath: `.surdet-bind-${CHALLENGE_ID}.json`,
        expiresAt: '2026-09-01T00:01:00.000Z',
      });
    }
    if (url.endsWith(`/binding/challenges/${CHALLENGE_ID}/confirm`)) {
      expect(jsonBody(init ?? {})).toEqual({
        browserSessionId: expect.any(String),
        nonce: 'fresh-nonce',
      });
      return success({
        projectIdentity: PROJECT_IDENTITY,
        projectName: '测试项目',
        bindingToken,
        bindingExpiresAt: '2026-09-01T00:30:00.000Z',
        recoveryBarrier: 'clear',
        pendingOperations: [],
        recentReceipts: [],
        pendingRelocations: [],
        recentRelocationReceipts: [],
      });
    }
    if (url.endsWith('/relocations/plan')) {
      return success({
        operationToken: RELOCATION_OPERATION_TOKEN,
        expiresAt: '2026-09-01T00:30:00.000Z',
        detail: relocationDetail(),
      });
    }
    if (url.endsWith('/relocations/query')) {
      return success({ operations: [relocationSummary()], recentReceipts: [relocationReceipt()] });
    }
    if (url.endsWith(`/relocations/${RELOCATION_OPERATION_ID}/query`)) {
      return success(relocationDetail());
    }
    if (url.endsWith(`/relocations/${RELOCATION_OPERATION_ID}/resume`)) {
      return success({
        operationToken: RELOCATION_RESUMED_TOKEN,
        expiresAt: '2026-09-01T00:30:00.000Z',
        detail: relocationDetail('COMMITTED'),
      });
    }
    if (url.endsWith(`/relocations/${RELOCATION_OPERATION_ID}/commit`)) {
      return success(relocationDetail('COMMITTED'));
    }
    if (url.endsWith(`/relocations/${RELOCATION_OPERATION_ID}/cancel`)) {
      return success(relocationDetail('PLANNED'));
    }
    if (url.endsWith(`/relocations/${RELOCATION_OPERATION_ID}/recover`)) {
      return success(relocationDetail('COMMITTED'));
    }
    if (url.endsWith(`/relocations/${RELOCATION_OPERATION_ID}/undo`)) {
      return success(relocationDetail('UNDONE'));
    }
    if (url.endsWith('/operations')) {
      return success({
        operationId: OPERATION_ID,
        operationToken,
        status: 'UPLOADING',
        expiresAt: '2026-09-01T00:30:00.000Z',
      });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/plan`)) {
      return success({ operationId: OPERATION_ID, status: 'READY', plan: plan() });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/seal`)) {
      return success({ operationId: OPERATION_ID, status: 'READY', planId: 'p'.repeat(32), planFingerprint: 'f'.repeat(64) });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/query`)) {
      return success(committed
        ? { ...operationDetail('COMMITTED'), receipt: committedReceipt(), allowedActions: ['resume', 'undo'] }
        : operationDetail('STAGED'));
    }
    if (url.endsWith('/operations/query')) {
      return success({ pendingOperations: [operationSummary()], recentReceipts: [] });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/resume`)) {
      return success({ operationToken: SECOND_OPERATION_TOKEN, expiresAt: '2026-09-01T00:30:00.000Z', detail: operationDetail('STAGED') });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/commit`)) {
      committed = true;
      return success({ operation: operationSummary('COMMITTED'), receipt: committedReceipt() });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/cancel`)) {
      return success({ operation: { ...operationSummary(), status: 'CANCELLED' } });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/recover`)) {
      return success({ detail: operationDetail('STAGED') });
    }
    if (url.endsWith(`/operations/${OPERATION_ID}/undo`)) {
      return success({ operation: { ...operationSummary('COMMITTED'), status: 'UNDONE' }, undoReceipt: {
        schemaVersion: 1,
        undoReceiptId: '55555555-5555-4555-8555-555555555555',
        undoReceiptSha256: 'b'.repeat(64),
        operationId: OPERATION_ID,
        projectIdentity: PROJECT_IDENTITY,
        status: 'UNDONE',
        journalVersion: 5,
        removedPaths: [],
        quarantinePaths: [],
        undoneAt: '2026-09-01T00:03:00.000Z',
      } });
    }
    if (url.endsWith('/binding/revoke')) return success({ revoked: true });
    throw new Error(`unexpected fake fetch route ${url}`);
  });
  return { fetcher, root };
}

async function bindClient(
  client: ReturnType<typeof createAssetImportAuthorityClient>,
  root: MemoryDirectory,
): Promise<void> {
  await client.bindProject(root.handle());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Editor 素材导入 authority client', () => {
  it('maps an absent authority to a safe client error without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createAssetImportAuthorityClient({ configuration: null, fetcher } as never);
    await expect(client.status()).rejects.toMatchObject({
      code: 'AUTHORITY_UNAVAILABLE',
      retryDisposition: 'same-request',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the exact closed JSON envelope and reads the challenge through the supplied project handle', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);

    const records = requestRecords(fetcher);
    expect(records.map((entry) => entry.input)).toEqual([
      `${AUTHORITY_PATH}/status`,
      `${AUTHORITY_PATH}/binding/challenges`,
      `${AUTHORITY_PATH}/binding/challenges/${CHALLENGE_ID}/confirm`,
    ]);
    expect(root.fileReadCount).toBe(1);
    expect(jsonBody(records[0]!.init)).toEqual({ browserSessionId: expect.any(String) });
    expect(jsonBody(records[1]!.init)).toEqual({ browserSessionId: expect.any(String) });
    expect(jsonBody(records[2]!.init)).toEqual({
      browserSessionId: jsonBody(records[0]!.init).browserSessionId,
      nonce: 'fresh-nonce',
    });
    expect(jsonBody(records[1]!.init).browserSessionId).toBe(jsonBody(records[0]!.init).browserSessionId);
    for (const record of records) {
      expect(header(record.init, 'x-surdet-asset-import-authority')).toBe(AUTHORITY_TOKEN);
      expect(header(record.init, 'content-type')).toMatch(/^application\/json/);
      expect(header(record.init, 'x-surdet-project-binding')).toBeNull();
      expect(header(record.init, 'x-surdet-import-operation')).toBeNull();
    }
  });

  it('keeps binding and operation tokens in separate in-memory headers', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    await client.createOperation({
      operationId: OPERATION_ID,
      items: [{ itemId: ITEM_ID, sourceName: '风景.png', declaredBytes: 5 }],
    });
    await client.plan(OPERATION_ID, { targets: [{ itemId: ITEM_ID, kind: 'background', fileName: '风景.png' }] });

    const records = requestRecords(fetcher);
    const create = records.find((entry) => entry.input.endsWith('/operations'))!;
    const planRequest = records.find((entry) => entry.input.endsWith(`/operations/${OPERATION_ID}/plan`))!;
    expect(jsonBody(create.init)).toEqual({
      operationId: OPERATION_ID,
      items: [{ itemId: ITEM_ID, sourceName: '风景.png', declaredBytes: 5 }],
    });
    expect(jsonBody(planRequest.init)).toEqual({
      targets: [{ itemId: ITEM_ID, kind: 'background', fileName: '风景.png' }],
    });
    expect(header(create.init, 'x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(header(create.init, 'x-surdet-import-operation')).toBeNull();
    expect(header(planRequest.init, 'x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(header(planRequest.init, 'x-surdet-import-operation')).toBe(FIRST_OPERATION_TOKEN);
    expect(header(planRequest.init, 'x-surdet-asset-import-authority')).toBe(AUTHORITY_TOKEN);
  });

  it('sends scenePlan to the exact endpoint with binding auth and no operation token', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    const expected = {
      operationId: SCENE_OPERATION_ID,
      kind: 'rename' as const,
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
      planFingerprint: SCENE_PLAN_FINGERPRINT,
      status: 'PLANNED' as const,
    };
    fetcher.mockResolvedValueOnce(success(expected));

    await expect(client.scenePlan({
      operationId: SCENE_OPERATION_ID,
      kind: 'rename',
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
    })).resolves.toEqual(expected);

    const request = requestRecords(fetcher).at(-1)!;
    expect(request.input).toBe(`${AUTHORITY_PATH}/scenes/plan`);
    expect(jsonBody(request.init)).toEqual({
      operationId: SCENE_OPERATION_ID,
      kind: 'rename',
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
    });
    expect(header(request.init, 'x-surdet-asset-import-authority')).toBe(AUTHORITY_TOKEN);
    expect(header(request.init, 'x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(header(request.init, 'x-surdet-import-operation')).toBeNull();
  });

  it('sends sceneCommit with the exact batch body and rejects malformed scene responses', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    const input = {
      requestId: SCENE_REQUEST_ID,
      plans: [{ operationId: SCENE_OPERATION_ID, planFingerprint: SCENE_PLAN_FINGERPRINT }],
      writes: [{ path: SCENE_TARGET_PATH, text: '@scene new\n', expectedSha256: null }],
    };
    const expected = {
      requestId: SCENE_REQUEST_ID,
      status: 'COMMITTED' as const,
      writes: [{ path: SCENE_TARGET_PATH, sha256: 'a'.repeat(64) }],
      deletedPaths: [SCENE_SOURCE_PATH],
    };
    fetcher.mockResolvedValueOnce(success(expected));

    await expect(client.sceneCommit(input)).resolves.toEqual(expected);

    const request = requestRecords(fetcher).at(-1)!;
    expect(request.input).toBe(`${AUTHORITY_PATH}/scenes/commit`);
    expect(jsonBody(request.init)).toEqual(input);
    expect(header(request.init, 'x-surdet-asset-import-authority')).toBe(AUTHORITY_TOKEN);
    expect(header(request.init, 'x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(header(request.init, 'x-surdet-import-operation')).toBeNull();

    fetcher.mockResolvedValueOnce(success({ ...expected, unexpected: true }));
    await expect(client.sceneCommit(input)).rejects.toMatchObject({ code: 'AUTHORITY_INVALID_RESPONSE' });
  });

  it('rejects a malformed scenePlan success response', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    fetcher.mockResolvedValueOnce(success({
      operationId: SCENE_OPERATION_ID,
      kind: 'rename',
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
      planFingerprint: SCENE_PLAN_FINGERPRINT,
      status: 'PLANNED',
      unexpected: true,
    }));

    await expect(client.scenePlan({
      operationId: SCENE_OPERATION_ID,
      kind: 'rename',
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
    })).rejects.toMatchObject({ code: 'AUTHORITY_INVALID_RESPONSE' });
  });

  it('rejects valid scene responses that belong to a different request', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    fetcher.mockResolvedValueOnce(success({
      operationId: SCENE_REQUEST_ID,
      kind: 'rename',
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
      planFingerprint: SCENE_PLAN_FINGERPRINT,
      status: 'PLANNED',
    }));

    await expect(client.scenePlan({
      operationId: SCENE_OPERATION_ID,
      kind: 'rename',
      sourcePath: SCENE_SOURCE_PATH,
      targetPath: SCENE_TARGET_PATH,
    })).rejects.toMatchObject({ code: 'AUTHORITY_INVALID_RESPONSE' });

    fetcher.mockResolvedValueOnce(success({
      requestId: SCENE_OPERATION_ID,
      status: 'COMMITTED',
      writes: [{ path: SCENE_TARGET_PATH, sha256: 'a'.repeat(64) }],
      deletedPaths: [SCENE_SOURCE_PATH],
    }));
    await expect(client.sceneCommit({
      requestId: SCENE_REQUEST_ID,
      plans: [{ operationId: SCENE_OPERATION_ID, planFingerprint: SCENE_PLAN_FINGERPRINT }],
      writes: [{ path: SCENE_TARGET_PATH, text: '@scene new\n', expectedSha256: null }],
    })).rejects.toMatchObject({ code: 'AUTHORITY_INVALID_RESPONSE' });
  });

  it('strictly parses relocation discovery/detail and reuses the bound operation token map', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    const binding = await client.bindProject(root.handle());
    expect(binding.pendingRelocations).toEqual([]);
    expect(binding.recentRelocationReceipts).toEqual([]);

    const planned = await client.relocationPlan({
      operationId: RELOCATION_OPERATION_ID,
      sourcePath: 'content/assets/bg/old.webp',
      targetDirectory: 'content/assets/bg',
      fileName: 'new.webp',
    });
    expect(planned.detail.request.targetPath).toBe('content/assets/bg/new.webp');
    expect(planned.operationToken).toBe(RELOCATION_OPERATION_TOKEN);

    const planRequest = requestRecords(fetcher).at(-1)!;
    expect(planRequest.input).toBe(`${AUTHORITY_PATH}/relocations/plan`);
    expect(jsonBody(planRequest.init)).toEqual({
      operationId: RELOCATION_OPERATION_ID,
      sourcePath: 'content/assets/bg/old.webp',
      targetDirectory: 'content/assets/bg',
      fileName: 'new.webp',
    });
    expect(header(planRequest.init, 'x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(header(planRequest.init, 'x-surdet-import-operation')).toBeNull();

    const listed = await client.relocationList();
    expect(listed.operations[0]).toMatchObject({
      operationId: RELOCATION_OPERATION_ID,
      sourcePath: 'content/assets/bg/old.webp',
      targetPath: 'content/assets/bg/new.webp',
    });
    expect(listed.recentReceipts[0]?.receiptId).toBe(RELOCATION_RECEIPT_ID);

    const queried = await client.relocationQuery(RELOCATION_OPERATION_ID);
    expect(queried.request.operationId).toBe(RELOCATION_OPERATION_ID);
    expect(queried.plan.planFingerprint).toBe('f'.repeat(64));

    const resumed = await client.relocationResume(RELOCATION_OPERATION_ID);
    expect(resumed.operationToken).toBe(RELOCATION_RESUMED_TOKEN);
    expect(resumed.detail.operation.status).toBe('COMMITTED');
    expect(header(requestRecords(fetcher).at(-1)!.init, 'x-surdet-import-operation')).toBeNull();

    const committed = await client.relocationCommit(RELOCATION_OPERATION_ID, 'f'.repeat(64));
    expect(committed.operation.status).toBe('COMMITTED');
    const commitRequest = requestRecords(fetcher).at(-1)!;
    expect(commitRequest.input).toBe(`${AUTHORITY_PATH}/relocations/${RELOCATION_OPERATION_ID}/commit`);
    expect(jsonBody(commitRequest.init)).toEqual({ planFingerprint: 'f'.repeat(64) });
    expect(header(commitRequest.init, 'x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(header(commitRequest.init, 'x-surdet-import-operation')).toBe(RELOCATION_RESUMED_TOKEN);

    await expect(client.relocationUndo(RELOCATION_OPERATION_ID, {
      receiptId: RELOCATION_RECEIPT_ID,
      receiptFingerprint: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'IMPORT_OPERATION_NOT_AUTHORIZED' });
  });

  it('sends and parses one strict batch relocation request without creating a second client path', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await client.bindProject(root.handle());
    const detail = batchRelocationDetail();
    fetcher.mockResolvedValueOnce(success({
      operationToken: RELOCATION_OPERATION_TOKEN,
      expiresAt: '2026-09-01T00:30:00.000Z',
      detail,
    }));

    const planned = await client.relocationPlan({
      operationId: RELOCATION_OPERATION_ID,
      moves: detail.request.moves,
    });

    expect(planned.detail.plan).toMatchObject({
      schemaVersion: 2,
      affectedAssetCount: 2,
      moves: [{ moveId: 'move-a' }, { moveId: 'move-b' }],
    });
    expect(planned.detail.request.moves).toEqual(detail.request.moves);
    const request = requestRecords(fetcher).at(-1)!;
    expect(request.input).toBe(`${AUTHORITY_PATH}/relocations/plan`);
    expect(jsonBody(request.init)).toEqual({
      operationId: RELOCATION_OPERATION_ID,
      moves: detail.request.moves,
    });
  });

  it('rejects malformed relocation detail and unsafe relocation input before a request', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await client.bindProject(root.handle());
    fetcher.mockImplementation(async () => success({ ...relocationDetail(), unexpected: true }));
    await expect(client.relocationQuery(RELOCATION_OPERATION_ID)).rejects.toMatchObject({
      code: 'AUTHORITY_INVALID_RESPONSE',
    });
    fetcher.mockImplementation(async () => success({
      ...relocationDetail(),
      plan: { ...relocationPlan(), projectRevision: 'internal-only' },
    }));
    await expect(client.relocationQuery(RELOCATION_OPERATION_ID)).rejects.toMatchObject({
      code: 'AUTHORITY_INVALID_RESPONSE',
    });
    fetcher.mockImplementation(async () => success({
      ...relocationDetail(),
      operation: { ...relocationSummary(), journalVersion: 1 },
    }));
    await expect(client.relocationQuery(RELOCATION_OPERATION_ID)).rejects.toMatchObject({
      code: 'AUTHORITY_INVALID_RESPONSE',
    });

    const invalidFetcher = vi.fn<typeof fetch>();
    const invalidClient = createAssetImportAuthorityClient(clientOptions(invalidFetcher) as never);
    await expect(invalidClient.relocationPlan({
      operationId: RELOCATION_OPERATION_ID,
      sourcePath: '../outside.webp',
      targetDirectory: 'content/assets/bg',
      fileName: 'new.webp',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(invalidFetcher).not.toHaveBeenCalled();
  });

  it('rejects a result-shaped envelope and maps a business error without exposing raw secrets', async () => {
    const malformedFetcher = vi.fn<typeof fetch>().mockResolvedValue(success({ result: true }));
    const malformed = createAssetImportAuthorityClient(clientOptions(malformedFetcher) as never);
    await expect(malformed.status()).rejects.toMatchObject({ code: 'AUTHORITY_INVALID_RESPONSE' });

    const errorFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      failure('PROJECT_BUSY', 'after-refresh'),
    );
    const errored = createAssetImportAuthorityClient(clientOptions(errorFetcher) as never);
    const error = await errored.status().then(() => null, (value: unknown) => value);
    expect(error).toBeInstanceOf(AssetImportClientError);
    expect(error).toMatchObject({ code: 'PROJECT_BUSY', retryDisposition: 'after-refresh' });
    expect((error as Error).message).toMatch(/[\u4e00-\u9fff]/u);
    expect((error as Error).message).not.toContain('assetImport.PROJECT_BUSY');
    expect((error as Error).message).not.toContain(AUTHORITY_TOKEN);
  });

  it('uses XMLHttpRequest for binary upload and reports monotonic progress', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const xhr = new UploadXhr();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher, () => xhr as unknown as XMLHttpRequest) as never);
    await bindClient(client, root);
    await client.createOperation({
      operationId: OPERATION_ID,
      items: [{ itemId: ITEM_ID, sourceName: '风景.png', declaredBytes: 5 }],
    });
    const progress: Array<{ loaded: number; total: number }> = [];
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], '风景.png', { type: 'image/png' });
    await client.uploadItem(OPERATION_ID, ITEM_ID, file, (loaded, total) => progress.push({ loaded, total }));

    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(`${AUTHORITY_PATH}/operations/${OPERATION_ID}/items/${ITEM_ID}`);
    expect(xhr.body).toBe(file);
    expect(xhr.timeout).toBe(0);
    expect(xhr.headers.get('content-type')).toBe('application/octet-stream');
    expect(xhr.headers.get('x-surdet-asset-import-authority')).toBe(AUTHORITY_TOKEN);
    expect(xhr.headers.get('x-surdet-project-binding')).toBe(FIRST_BINDING_TOKEN);
    expect(xhr.headers.get('x-surdet-import-operation')).toBe(FIRST_OPERATION_TOKEN);
    expect(progress).toEqual([{ loaded: 2, total: 5 }, { loaded: 5, total: 5 }]);
  });

  it('keeps the five entry states in deterministic safety order', () => {
    const base = {
      authorityAvailable: true,
      bindingState: 'bound',
      recoveryBarrier: 'clear',
      pendingOperations: [],
    };
    const resolve = (overrides: Record<string, unknown>): string => resolveAssetImportEntryState({ ...base, ...overrides } as never);
    expect(resolve({ authorityAvailable: false })).toBe('unavailable');
    expect(resolve({ bindingState: 'unbound' })).toBe('unbound');
    expect(resolve({ bindingState: 'mismatch' })).toBe('mismatch');
    expect(resolve({ recoveryBarrier: 'manual-recovery' })).toBe('manual-recovery');
    expect(resolve({ pendingOperations: [operationSummary()] })).toBe('recoverable');
    expect(resolve({})).toBe('ready');
  });

  it('clears stale project projections when the binding becomes unavailable', () => {
    const workspace = createAssetImportWorkspace();
    workspace.applyBinding({
      projectIdentity: PROJECT_IDENTITY,
      projectName: '旧项目',
      bindingExpiresAt: '2026-09-01T00:30:00.000Z',
      recoveryBarrier: 'clear',
      pendingOperations: [operationSummary()],
      recentReceipts: [],
      pendingRelocations: [],
      recentRelocationReceipts: [],
    });
    workspace.setOperation(operationDetail('STAGED'));

    workspace.markUnavailable();

    expect(workspace.snapshot()).toMatchObject({
      entryState: 'unavailable',
      projectIdentity: null,
      projectName: null,
      bindingExpiresAt: null,
      pendingOperations: [],
      recentReceipts: [],
      activeOperation: null,
    });
    workspace.dispose();
  });

  it('keeps the recent receipt projection aligned after commit and undo', () => {
    const workspace = createAssetImportWorkspace();
    workspace.applyBinding({
      projectIdentity: PROJECT_IDENTITY,
      projectName: '当前项目',
      bindingExpiresAt: '2026-09-01T00:30:00.000Z',
      recoveryBarrier: 'clear',
      pendingOperations: [],
      recentReceipts: [],
      pendingRelocations: [],
      recentRelocationReceipts: [],
    });
    const receipt = { ...committedReceipt(), files: [] };
    workspace.setOperation({
      ...operationDetail('COMMITTED'),
      receipt,
      allowedActions: ['resume', 'undo'],
    });
    expect(workspace.snapshot().recentReceipts).toMatchObject([{
      operationId: OPERATION_ID,
      status: 'COMMITTED',
      fileCount: 0,
    }]);

    workspace.setOperation({
      ...operationDetail('UNDONE'),
      receipt,
      undoReceipt: {
        schemaVersion: 1,
        undoReceiptId: '55555555-5555-4555-8555-555555555555',
        undoReceiptSha256: 'b'.repeat(64),
        operationId: OPERATION_ID,
        projectIdentity: PROJECT_IDENTITY,
        status: 'UNDONE',
        journalVersion: 5,
        removedPaths: [],
        quarantinePaths: [],
        undoneAt: '2026-09-01T00:03:00.000Z',
      },
      allowedActions: [],
    });
    expect(workspace.snapshot().recentReceipts).toMatchObject([{
      operationId: OPERATION_ID,
      status: 'UNDONE',
      fileCount: 0,
    }]);
    workspace.dispose();
  });

  it('rejects unsafe error details instead of exposing them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'PROJECT_BUSY',
        messageKey: 'assetImport.PROJECT_BUSY',
        retryDisposition: 'after-refresh',
        details: { projectRoot: 'C:\\secret', token: AUTHORITY_TOKEN },
      },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);

    const error = await client.status().then(() => null, (value: unknown) => value as Error & { code: string });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('AUTHORITY_INVALID_RESPONSE');
    expect(error!.message).not.toContain('C:\\secret');
    expect(error!.message).not.toContain(AUTHORITY_TOKEN);
  });

  it('releases draft object URLs when a file is removed or the workspace is disposed', () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset-import-test');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const workspace = createAssetImportWorkspace();
    const file = new File([new Uint8Array([1])], '风景.png', { type: 'image/png' });
    const added = workspace.addFiles([file]);
    expect(added).toHaveLength(1);
    expect(createObjectUrl).toHaveBeenCalledWith(file);
    workspace.removeFile(added[0]!.itemId);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:asset-import-test');

    const second = workspace.addFiles([file]);
    workspace.dispose();
    expect(revokeObjectUrl).toHaveBeenCalledWith(second[0]!.previewUrl);
  });

  it('does not serialize authority tokens and a fresh client reacquires binding before resume', async () => {
    const first = makeBindingFetcher(FIRST_BINDING_TOKEN, FIRST_OPERATION_TOKEN);
    const firstClient = createAssetImportAuthorityClient(clientOptions(first.fetcher) as never);
    await bindClient(firstClient, first.root);
    await firstClient.createOperation({
      operationId: OPERATION_ID,
      items: [{ itemId: ITEM_ID, sourceName: '风景.png', declaredBytes: 5 }],
    });
    await firstClient.plan(OPERATION_ID, { targets: [{ itemId: ITEM_ID, kind: 'background', fileName: '风景.png' }] });

    const second = makeBindingFetcher(SECOND_BINDING_TOKEN, SECOND_OPERATION_TOKEN);
    const secondClient = createAssetImportAuthorityClient(clientOptions(second.fetcher) as never);
    await bindClient(secondClient, second.root);
    await secondClient.queryOperation(OPERATION_ID);
    await secondClient.resume(OPERATION_ID);

    const firstWire = JSON.stringify(requestRecords(first.fetcher));
    const secondWire = JSON.stringify(requestRecords(second.fetcher));
    expect(firstWire).toContain(FIRST_BINDING_TOKEN);
    expect(firstWire).toContain(FIRST_OPERATION_TOKEN);
    expect(secondWire).not.toContain(FIRST_BINDING_TOKEN);
    expect(secondWire).not.toContain(FIRST_OPERATION_TOKEN);
    expect(secondWire).toContain(SECOND_BINDING_TOKEN);
    expect(secondWire).not.toContain(SECOND_OPERATION_TOKEN);
    expect(JSON.stringify(secondClient)).not.toContain(SECOND_BINDING_TOKEN);
    expect(JSON.stringify(secondClient)).not.toContain(SECOND_OPERATION_TOKEN);
    expect(requestRecords(second.fetcher).at(-1)?.input).toBe(`${AUTHORITY_PATH}/operations/${OPERATION_ID}/resume`);
    expect(header(requestRecords(second.fetcher).at(-1)!.init, 'x-surdet-project-binding')).toBe(SECOND_BINDING_TOKEN);
    expect(header(requestRecords(second.fetcher).at(-1)!.init, 'x-surdet-import-operation')).toBeNull();
  });

  it('treats the persisted query receipt as the commit authority', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    await client.createOperation({
      operationId: OPERATION_ID,
      items: [{ itemId: ITEM_ID, sourceName: '风景.png', declaredBytes: 5 }],
    });

    const committed = await client.commit(OPERATION_ID, 'f'.repeat(64));

    expect(committed.operation.status).toBe('COMMITTED');
    expect(committed.receipt.receiptId).toBe(RECEIPT_ID);
    const paths = requestRecords(fetcher).map((entry) => entry.input);
    expect(paths.slice(-2)).toEqual([
      `${AUTHORITY_PATH}/operations/${OPERATION_ID}/commit`,
      `${AUTHORITY_PATH}/operations/${OPERATION_ID}/query`,
    ]);
  });

  it('keeps operation controls narrow and replays only the server response envelopes', async () => {
    const { fetcher, root } = makeBindingFetcher();
    const client = createAssetImportAuthorityClient(clientOptions(fetcher) as never);
    await bindClient(client, root);
    await client.createOperation({
      operationId: OPERATION_ID,
      items: [{ itemId: ITEM_ID, sourceName: '风景.png', declaredBytes: 5 }],
    });
    await client.plan(OPERATION_ID, { targets: [{ itemId: ITEM_ID, kind: 'background', fileName: '风景.png' }] });
    await client.seal(OPERATION_ID, { planFingerprint: 'f'.repeat(64) });
    await client.queryOperation(OPERATION_ID);
    await client.listOperations();
    await client.cancel(OPERATION_ID);
    await client.resume(OPERATION_ID);
    await client.recover(OPERATION_ID, { action: 'resume' });
    await client.undo(OPERATION_ID, { receiptId: RECEIPT_ID, receiptSha256: 'a'.repeat(64) });
    await client.revokeBinding();

    const records = requestRecords(fetcher);
    expect(records.some((entry) => entry.input.endsWith(`/operations/${OPERATION_ID}/seal`))).toBe(true);
    expect(records.some((entry) => entry.input.endsWith(`/operations/${OPERATION_ID}/query`))).toBe(true);
    expect(records.some((entry) => entry.input.endsWith('/operations/query'))).toBe(true);
    expect(records.some((entry) => entry.input.endsWith(`/operations/${OPERATION_ID}/cancel`))).toBe(true);
    expect(records.some((entry) => entry.input.endsWith(`/operations/${OPERATION_ID}/recover`))).toBe(true);
    expect(records.some((entry) => entry.input.endsWith(`/operations/${OPERATION_ID}/undo`))).toBe(true);
    expect(records.some((entry) => entry.input.endsWith('/binding/revoke'))).toBe(true);
    for (const record of records.filter((entry) => entry.input.includes('/operations/'))) {
      expect(record.input).not.toContain('C:\\');
      expect(String(record.init.body)).not.toContain(AUTHORITY_TOKEN);
    }
  });
});
