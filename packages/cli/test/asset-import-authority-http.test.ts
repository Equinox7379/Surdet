import * as http from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ASSET_IMPORT_AUTHORITY_BASE_PATH,
  ASSET_IMPORT_AUTHORITY_BINDING_HEADER,
  ASSET_IMPORT_AUTHORITY_MAX_JSON_BYTES,
  ASSET_IMPORT_AUTHORITY_OPERATION_HEADER,
  ASSET_IMPORT_AUTHORITY_TOKEN_HEADER,
  createAssetImportAuthorityHttpHandler,
  type AssetImportAuthorityHttpTarget,
} from '../src/asset-import-authority/http-handler.js';
import {
  assetImportAuthorityVitePlugin,
  injectAssetImportAuthorityConfig,
} from '../src/asset-import-authority/vite-plugin.js';
import { AssetImportAuthorityError } from '../src/asset-import-authority/types.js';
import type {
  AssetRelocationDetailResponse,
  AssetRelocationOperationSummary,
  AssetRelocationReceipt,
} from '../src/asset-import-authority/types.js';
import { AssetImportBindingService } from '../src/asset-import-authority/binding.js';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../src/asset-import-authority/record-store.js';
import { EditorWorkspaceAuthority } from '../src/editor-workspace-authority/editor-workspace-authority.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';

const servers: http.Server[] = [];
const roots: string[] = [];
const authorityToken = 'a'.repeat(64);
const bindingToken = 'b'.repeat(64);
const operationToken = 'c'.repeat(64);
const otherBindingToken = 'd'.repeat(64);
const operationId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const relocationReceiptId = '33333333-3333-4333-8333-333333333333';
const relocationPlanId = '44444444-4444-4444-8444-444444444444';

const relocationSourcePath = 'content/assets/background/old.png';
const relocationTargetPath = 'content/assets/background/new.png';

function relocationReceipt(): AssetRelocationReceipt {
  return {
    schemaVersion: 1,
    receiptId: relocationReceiptId,
    receiptFingerprint: '4'.repeat(64),
    operationId,
    planId: relocationPlanId,
    planFingerprint: '5'.repeat(64),
    projectIdentity: '1'.repeat(64),
    sourcePath: relocationSourcePath,
    targetPath: relocationTargetPath,
    targetIdentity: {
      device: '1',
      inode: '2',
      birthtimeNs: '3',
      size: 5,
      mtimeNs: '4',
      sha256: '6'.repeat(64),
    },
    moves: [{
      moveId: 'relocation-move-http-fixture',
      sourcePath: relocationSourcePath,
      targetPath: relocationTargetPath,
      targetIdentity: {
        device: '1', inode: '2', birthtimeNs: '3', size: 5, mtimeNs: '4', sha256: '6'.repeat(64),
      },
    }],
    textFiles: [],
    committedAt: '2026-09-01T00:00:00.000Z',
  };
}

function relocationDetail(status: 'PLANNED' | 'COMMITTED' | 'CANCELLED' | 'ROLLED_BACK' | 'UNDONE' = 'PLANNED'): AssetRelocationDetailResponse {
  return {
    request: {
      operationId,
      moves: [{ sourcePath: relocationSourcePath, targetPath: relocationTargetPath }],
      sourcePath: relocationSourcePath,
      targetPath: relocationTargetPath,
    },
    operation: {
      schemaVersion: 1,
      operationId,
      journalVersion: 1,
      status,
      recoveryPhase: null,
      binaryState: status === 'PLANNED' ? 'SOURCE' : status === 'UNDONE' ? 'UNDONE' : 'TARGET',
      binaryBackupRelativePath: `.surdet/asset-relocation/${operationId}/backup/source.bin`,
      binaryBackupIdentity: null,
      binaryTargetIdentity: null,
      binaryItems: [{
        moveId: 'relocation-move-http-fixture',
        sourcePath: relocationSourcePath,
        targetPath: relocationTargetPath,
        state: status === 'PLANNED' ? 'SOURCE' : status === 'UNDONE' ? 'UNDONE' : 'TARGET',
        backupRelativePath: `.surdet/asset-relocation/${operationId}/backup/source.bin`,
        backupIdentity: null,
        targetIdentity: null,
      }],
      textStates: [],
      textResultIdentities: [],
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    plan: {
      schemaVersion: 1,
      operationId,
      planId: relocationPlanId,
      planFingerprint: '5'.repeat(64),
      // Deliberately hostile-looking data exercises the HTTP projection boundary.
      projectRevision: 'C:\\private\\project',
      status: 'ready',
      source: null,
      target: null,
      affectedReferenceCount: 0,
      affectedFileCount: 0,
      referenceChanges: [],
      blockers: [],
    },
    receipt: status === 'COMMITTED' || status === 'UNDONE' ? relocationReceipt() : null,
    undoReceipt: null,
  };
}

function relocationSummary(status: 'PLANNED' | 'COMMITTED' | 'CANCELLED' | 'ROLLED_BACK' | 'UNDONE' = 'PLANNED'): AssetRelocationOperationSummary {
  return {
    operationId,
    status,
    sourcePath: relocationSourcePath,
    targetPath: relocationTargetPath,
    moves: [{ sourcePath: relocationSourcePath, targetPath: relocationTargetPath }],
    updatedAt: '2026-09-01T00:00:00.000Z',
    manualRecoveryRequired: false,
  };
}

function target(): AssetImportAuthorityHttpTarget & {
  calls: Array<[string, unknown?]>;
  error?: unknown;
  uploadError?: unknown;
  terminalStatus?: 'COMMITTED' | 'CANCELLED' | 'ROLLED_BACK' | 'UNDONE';
  operationTokenExpired?: boolean;
  bindingValid?: boolean;
} {
  const calls: Array<[string, unknown?]> = [];
  const operation = {
    schemaVersion: 1 as const,
    operationId,
    journalVersion: 3,
    previousGenerationSha256: 'd'.repeat(64),
    status: 'STAGED' as const,
    itemCount: 1,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const detail = {
    operation,
    manifest: {
      schemaVersion: 1 as const,
      operationId,
      createdAt: '2026-09-01T00:00:00.000Z',
      manifestFingerprint: 'e'.repeat(64),
      items: [{ itemId, sourceName: 'secret-source.png', declaredBytes: 5 }],
    },
    stagedItems: [{
      operationId,
      itemId,
      sourceName: 'secret-source.png',
      bytes: 5,
      sha256: 'f'.repeat(64),
      stagedItemFingerprint: '0'.repeat(64),
    }],
    plan: null,
    receipt: null,
    undoReceipt: null,
  };
  return {
    calls,
    projectIdentity: '1'.repeat(64),
    async createChallenge(browserSessionId) {
      calls.push(['challenge', browserSessionId]);
      return { challengeId: operationId, relativeProbePath: `.surdet-bind-${operationId}.json`, expiresAt: '2026-09-01T00:01:00.000Z' };
    },
    async confirmChallenge(challengeId, request) {
      calls.push(['confirm', { challengeId, request }]);
      return {
        projectIdentity: '1'.repeat(64),
        projectName: 'fixture',
        bindingToken,
        bindingExpiresAt: '2026-09-01T00:30:00.000Z',
        recoveryBarrier: 'clear' as const,
        pendingOperations: [],
        recentReceipts: [],
      };
    },
    validateBinding(token, browserSessionId) {
      calls.push(['validate-binding', { token, browserSessionId }]);
      return this.bindingValid !== false
        && (token === bindingToken || token === otherBindingToken)
        && (browserSessionId === undefined || browserSessionId === 'browser-1');
    },
    revoke(browserSessionId) { calls.push(['revoke', browserSessionId]); },
    async createOperation(request) {
      calls.push(['create', request]);
      return { operationId: request.operationId, operationToken, status: 'UPLOADING' as const, itemCount: request.items.length };
    },
    async expectedUploadBytes(requestOperationId, requestItemId) {
      calls.push(['expected-bytes', { operationId: requestOperationId, itemId: requestItemId }]);
      return 5;
    },
    async uploadItem(requestOperationId, requestItemId, body) {
      let bytes = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) bytes += chunk.byteLength;
      calls.push(['upload', { operationId: requestOperationId, itemId: requestItemId, bytes }]);
      if (this.uploadError !== undefined) throw this.uploadError;
      return detail.stagedItems[0]!;
    },
    async plan() { calls.push(['plan']); return { operationId, status: 'STAGED' as const, plan: null as never }; },
    async seal() { calls.push(['seal']); return { operationId, status: 'READY' as const, planId: operationId, planFingerprint: '2'.repeat(64) }; },
    async commit() {
      calls.push(['commit']);
      if (this.error !== undefined) throw this.error;
      this.terminalStatus = 'COMMITTED';
      this.operationTokenExpired = true;
      return { operation: { ...operation, status: 'COMMITTED' as const }, receipt: null as never };
    },
    async cancel() {
      calls.push(['cancel']);
      this.terminalStatus = 'CANCELLED';
      this.operationTokenExpired = true;
      return { ...detail, operation: { ...operation, status: 'CANCELLED' as const } };
    },
    async list() { calls.push(['list']); return { operations: [operation] }; },
    async query() {
      calls.push(['query']);
      return this.terminalStatus === undefined
        ? detail
        : { ...detail, operation: { ...operation, status: this.terminalStatus } };
    },
    async issueOperationToken() { calls.push(['resume-token']); return operationToken; },
    async recover() {
      calls.push(['recover']);
      this.terminalStatus = 'ROLLED_BACK';
      this.operationTokenExpired = true;
      return { detail: { ...detail, operation: { ...operation, status: 'ROLLED_BACK' as const } } };
    },
    async undo() {
      calls.push(['undo']);
      this.terminalStatus = 'UNDONE';
      this.operationTokenExpired = true;
      return { operation: { ...operation, status: 'UNDONE' as const }, undoReceipt: null as never };
    },
    verifyOperationToken(requestOperationId, token) {
      calls.push(['verify-operation', { operationId: requestOperationId, token }]);
      if (token !== operationToken || this.operationTokenExpired === true) {
        throw new AssetImportAuthorityError('IMPORT_AUTH_REQUIRED', 'secret token mismatch');
      }
    },
  };
}

function installRelocationTarget(service: ReturnType<typeof target>): ReturnType<typeof target> {
  let status: 'PLANNED' | 'COMMITTED' | 'CANCELLED' | 'ROLLED_BACK' | 'UNDONE' = 'PLANNED';
  service.relocationPlan = async (request) => {
    service.calls.push(['relocation-plan', request]);
    status = 'PLANNED';
    return relocationDetail(status);
  };
  service.relocationList = async () => {
    service.calls.push(['relocation-list']);
    return { operations: [relocationSummary(status)], recentReceipts: [relocationReceipt()] };
  };
  service.relocationQuery = async (requestOperationId) => {
    service.calls.push(['relocation-query', requestOperationId]);
    return relocationDetail(status);
  };
  service.relocationCommit = async (requestOperationId, request) => {
    service.calls.push(['relocation-commit', { operationId: requestOperationId, request }]);
    status = 'COMMITTED';
    return relocationDetail(status);
  };
  service.relocationCancel = async (requestOperationId) => {
    service.calls.push(['relocation-cancel', requestOperationId]);
    status = 'CANCELLED';
    return relocationDetail(status);
  };
  service.relocationRecover = async (requestOperationId, request) => {
    service.calls.push(['relocation-recover', { operationId: requestOperationId, request }]);
    status = 'ROLLED_BACK';
    return relocationDetail(status);
  };
  service.relocationUndo = async (requestOperationId, request) => {
    service.calls.push(['relocation-undo', { operationId: requestOperationId, request }]);
    status = 'UNDONE';
    return relocationDetail(status);
  };
  return service;
}

function installSceneTarget(service: ReturnType<typeof target>): ReturnType<typeof target> {
  service.scenePlan = async (request) => {
    service.calls.push(['scene-plan', request]);
    return {
      operationId: request.operationId,
      kind: request.kind,
      sourcePath: request.sourcePath,
      targetPath: request.targetPath ?? null,
      planFingerprint: '5'.repeat(64),
      status: 'PLANNED' as const,
    };
  };
  service.sceneCommit = async (request) => {
    service.calls.push(['scene-commit', request]);
    return {
      requestId: request.requestId,
      status: 'COMMITTED' as const,
      writes: request.writes.map((write) => ({ path: write.path, sha256: '6'.repeat(64) })),
      deletedPaths: [],
    };
  };
  return service;
}

async function harness(service: ReturnType<typeof target> = target()): Promise<{ origin: string; target: ReturnType<typeof target> }> {
  let expectedOrigin = '';
  const server = http.createServer(createAssetImportAuthorityHttpHandler({
    authority: service,
    token: authorityToken,
    expectedOrigin: () => expectedOrigin,
  }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing address');
  expectedOrigin = `http://127.0.0.1:${address.port}`;
  return { origin: expectedOrigin, target: service };
}

async function bindingHarness(): Promise<{
  origin: string;
  target: ReturnType<typeof target>;
  projectRoot: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'surdet-asset-import-http-binding-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  await mkdir(projectRoot, { recursive: true });
  const paths = await openAssetImportAuthorityPaths({ projectRoot, dataRoot: path.join(root, 'data') });
  const store = new AssetImportRecordStore(paths);
  const binding = new AssetImportBindingService(paths, store);
  const service = target();
  service.projectIdentity = paths.projectIdentity;
  service.createChallenge = (browserSessionId) => binding.createChallenge(browserSessionId);
  service.confirmChallenge = (challengeId, request) => binding.confirmChallenge(challengeId, request);
  service.validateBinding = (token, browserSessionId) => browserSessionId === undefined
    ? binding.validateBindingToken(token)
    : binding.validateBinding(token, browserSessionId);
  return { ...(await harness(service)), projectRoot };
}

async function bindProjectConfirmation(
  fixture: Awaited<ReturnType<typeof bindingHarness>>,
  browserSessionId: string,
): Promise<any> {
  const challenge = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges`, {
    method: 'POST',
    headers: headers(fixture.origin),
    body: JSON.stringify({ browserSessionId }),
  });
  expect(challenge.response.status).toBe(200);
  const probe = JSON.parse(await readFile(
    path.join(fixture.projectRoot, challenge.body.data.relativeProbePath),
    'utf8',
  )) as { nonce: string };
  const confirmed = await request(
    fixture.origin,
    `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges/${challenge.body.data.challengeId}/confirm`,
    {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify({ browserSessionId, nonce: probe.nonce }),
    },
  );
  expect(confirmed.response.status).toBe(200);
  return confirmed.body.data;
}

async function bindProject(
  fixture: Awaited<ReturnType<typeof bindingHarness>>,
  browserSessionId: string,
): Promise<string> {
  const confirmed = await bindProjectConfirmation(fixture, browserSessionId);
  return confirmed.bindingToken as string;
}

function headers(origin: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Origin: origin,
    'Content-Type': 'application/json',
    [ASSET_IMPORT_AUTHORITY_TOKEN_HEADER]: authorityToken,
    ...extra,
  };
}

async function request(origin: string, route: string, init: RequestInit): Promise<{ response: Response; text: string; body: any }> {
  const response = await fetch(`${origin}${route}`, init);
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project asset import authority HTTP boundary', () => {
  it('requires matching browser binding for workspace state and publishes only under the guarded write lease', async () => {
    const fixture = await bindingHarness();
    await writeFile(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }));
    const workspace = new EditorWorkspaceAuthority(await realpath(fixture.projectRoot), {
      leaseManager: new NodeLocalLeaseManager(path.join(path.dirname(fixture.projectRoot), 'coordination')),
    });
    fixture.target.workspace = workspace;
    const browserSessionId = 'workspace-http-browser';
    const token = await bindProject(fixture, browserSessionId);
    const state = { workspaceSessionId: itemId, browserSessionId, workspaceGeneration: 0, availability: 'clean',
      dirtyScopes: [], busyReasons: [], blockedReasons: [] };
    const send = (action: string, body: object, binding = token) => request(fixture.origin,
      `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/workspace/${action}`, { method: 'POST',
        headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: binding }), body: JSON.stringify(body) });
    try {
      expect((await send('heartbeat', { ...state, browserSessionId: 'another-browser' })).response.status).toBe(403);
      expect((await send('heartbeat', { ...state, draftText: 'private text must not be accepted' })).response.status).toBe(400);
      const heartbeat = await send('heartbeat', state);
      expect(heartbeat.response.status).toBe(200);
      expect(Object.keys(heartbeat.body.data).sort()).toEqual(['heartbeatAt', 'workspaceGeneration']);
      const snapshot = await send('snapshot', { workspaceSessionId: itemId, browserSessionId });
      expect(snapshot.response.status).toBe(200);
      expect(snapshot.text).not.toContain(fixture.projectRoot.replaceAll('\\', '\\\\'));
      expect(snapshot.text).not.toContain('browserSessionId');
      const baseline = snapshot.body.data.diskBaseline;
      const saving = { ...state, workspaceGeneration: 1, availability: 'busy', busyReasons: ['saving'] };
      const begin = { ...saving, purpose: 'save-all', expectedProjectRevision: baseline.projectRevision,
        expectedCoordinationRevision: baseline.coordinationRevision };
      const stale = await send('begin', { ...begin, expectedCoordinationRevision: '0'.repeat(64) });
      expect(stale.body.error.code).toBe('EDITOR_PROJECT_BASELINE_CHANGED');
      const begun = await send('begin', begin);
      expect(begun.response.status).toBe(200);
      const active = { ...saving, writeLeaseId: begun.body.data.writeLeaseId };
      const published = await send('publish', { ...active, path: 'content/scenario/start.gal', expectedSha256: null,
        text: '@scene start\n凛：真实绑定保存。\n@end\n' });
      expect(published.response.status).toBe(200);
      expect(await readFile(path.join(fixture.projectRoot, 'content/scenario/start.gal'), 'utf8')).toContain('真实绑定保存');
      const finished = await send('finish', { ...active, workspaceGeneration: 2, availability: 'clean', busyReasons: [] });
      expect(finished.response.status).toBe(200);
      expect(finished.body.data.changedPaths).toEqual(['content/scenario/start.gal']);
      expect(finished.body.data.mutationNotice.status).toBe('written');
      const late = await send('publish', { ...active, path: 'content/scenario/start.gal', expectedSha256: published.body.data.sha256, text: 'late' });
      expect(late.body.error.code).toBe('HUMAN_WORKSPACE_STATE_CORRUPT');
    } finally {
      await workspace.close();
    }
  });

  it('injects a rotating token only for an explicitly bound main Editor document', async () => {
    const html = '<html><head></head><body></body></html>';
    const config = { authorityContractVersion: 1 as const, endpoint: ASSET_IMPORT_AUTHORITY_BASE_PATH, token: authorityToken };
    expect(injectAssetImportAuthorityConfig(html, '/index.html', config)).toContain(authorityToken);
    expect(injectAssetImportAuthorityConfig(html, '/preview.html', config)).toBe(html);
    const unbound = assetImportAuthorityVitePlugin();
    expect(unbound.transformIndexHtml.handler(html, { path: '/index.html', server: {} })).toBe(html);
    const first = assetImportAuthorityVitePlugin({ projectRoot: 'C:\\fixture', dataRoot: 'C:\\data' });
    const second = assetImportAuthorityVitePlugin({ projectRoot: 'C:\\fixture', dataRoot: 'C:\\data' });
    const injected = first.transformIndexHtml.handler(html, { path: '/index.html', server: {} });
    expect(injected).not.toMatch(/localStorage|document\.cookie/i);
    expect(second.transformIndexHtml.handler(html, { path: '/index.html', server: {} })).not.toBe(injected);

    const failedConfigure = assetImportAuthorityVitePlugin({ projectRoot: 'C:\\fixture', dataRoot: 'C:\\data' });
    expect(() => failedConfigure.configureServer({
      middlewares: { use() { throw new Error('middleware registration failed'); } },
      httpServer: { once() {} },
    })).not.toThrow();
    await expect(failedConfigure.api.ready()).rejects.toThrow('middleware registration failed');
  });

  it('requires exact same-origin JSON and the server token even for status', async () => {
    const fixture = await harness();
    const valid = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/status`, {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify({ browserSessionId: 'browser-1' }),
    });
    expect(valid.response.status).toBe(200);
    expect(valid.body).toEqual({ ok: true, data: {
      authorityContractVersion: 1,
      authorityAvailable: true,
      projectIdentity: '1'.repeat(64),
      bindingRequired: true,
    } });
    expect(valid.response.headers.get('access-control-allow-origin')).toBeNull();

    for (const init of [
      { method: 'POST', headers: headers('http://attacker.invalid'), body: '{}' },
      { method: 'POST', headers: headers('null'), body: '{}' },
      { method: 'POST', headers: headers(fixture.origin.replace('127.0.0.1', 'localhost')), body: '{}' },
      { method: 'POST', headers: { 'Content-Type': 'application/json', [ASSET_IMPORT_AUTHORITY_TOKEN_HEADER]: authorityToken }, body: '{}' },
      { method: 'POST', headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_TOKEN_HEADER]: 'wrong' }), body: '{}' },
      { method: 'OPTIONS', headers: headers(fixture.origin), body: '{}' },
    ]) {
      const rejected = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/status`, init);
      expect(rejected.response.status).toBeGreaterThanOrEqual(400);
      expect(rejected.body.ok).toBe(false);
    }
  });

  it('keeps binding and operation authorization in separate headers', async () => {
    const fixture = await harness();
    const created = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 5 }] }),
    });
    expect(created.response.status).toBe(200);
    expect(created.body.data.operationToken).toBe(operationToken);
    expect(created.body.data).not.toHaveProperty('itemCount');

    const missingOperationToken = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ targets: [] }),
    });
    expect(missingOperationToken.response.status).toBe(403);
    expect(fixture.target.calls.some(([name]) => name === 'plan')).toBe(false);

    const wrongBindingScope = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, {
        [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: otherBindingToken,
        [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: operationToken,
      }),
      body: JSON.stringify({ targets: [] }),
    });
    expect(wrongBindingScope.response.status).toBe(403);
  });

  it('rejects a previous binding token after the same browser session rebinds', async () => {
    const fixture = await bindingHarness();
    const browserSessionId = 'browser-binding-rotation';
    const oldBindingToken = await bindProject(fixture, browserSessionId);
    const currentBindingToken = await bindProject(fixture, browserSessionId);
    expect(currentBindingToken).not.toBe(oldBindingToken);

    fixture.target.calls.length = 0;
    const replay = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: oldBindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'old-token.png', declaredBytes: 5 }] }),
    });

    expect(replay.response.status).toBe(403);
    expect(replay.body).toMatchObject({ ok: false, error: { code: 'AUTHORITY_TOKEN_REJECTED' } });
    expect(fixture.target.calls.filter(([name]) => name === 'create')).toHaveLength(0);
    expect(await fixture.target.validateBinding(currentBindingToken)).toBe(true);
  });

  it('rejects a previous binding token after a different browser session binds', async () => {
    const fixture = await bindingHarness();
    const oldBindingToken = await bindProject(fixture, 'browser-binding-old-session');
    const currentBindingToken = await bindProject(fixture, 'browser-binding-new-session');
    expect(currentBindingToken).not.toBe(oldBindingToken);

    fixture.target.calls.length = 0;
    const replay = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: oldBindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'cross-session-old-token.png', declaredBytes: 5 }] }),
    });

    expect(replay.response.status).toBe(403);
    expect(replay.body).toMatchObject({ ok: false, error: { code: 'AUTHORITY_TOKEN_REJECTED' } });
    expect(fixture.target.calls.filter(([name]) => name === 'create')).toHaveLength(0);
    expect(await fixture.target.validateBinding(currentBindingToken)).toBe(true);
  });

  it.each([
    ['commit', JSON.stringify({ planFingerprint: '2'.repeat(64) }), JSON.stringify({ planFingerprint: '4'.repeat(64) }), 'COMMITTED'],
    ['cancel', '{}', JSON.stringify({ unexpected: true }), 'CANCELLED'],
    ['recover', JSON.stringify({ action: 'rollback' }), JSON.stringify({ action: 'resume' }), 'ROLLED_BACK'],
    [
      'undo',
      JSON.stringify({ receiptId: itemId, receiptSha256: '3'.repeat(64) }),
      JSON.stringify({ receiptId: itemId, receiptSha256: '4'.repeat(64) }),
      'UNDONE',
    ],
  ] as const)('allows only an idempotent %s replay after its operation token expires', async (action, body, differentBody, status) => {
    const fixture = await harness();
    await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 5 }] }),
    });
    const authorized = headers(fixture.origin, {
      [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken,
      [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: operationToken,
    });
    const route = `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}`;

    const first = await request(fixture.origin, `${route}/${action}`, { method: 'POST', headers: authorized, body });
    const second = await request(fixture.origin, `${route}/${action}`, { method: 'POST', headers: authorized, body });
    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    const terminal = second.body.data.operation ?? second.body.data.detail?.operation;
    expect(terminal.status).toBe(status);

    const changedRequest = await request(fixture.origin, `${route}/${action}`, {
      method: 'POST', headers: authorized, body: differentBody,
    });
    expect(changedRequest.response.status).toBe(403);

    const plan = await request(fixture.origin, `${route}/plan`, {
      method: 'POST', headers: authorized, body: JSON.stringify({ targets: [] }),
    });
    expect(plan.response.status).toBe(403);
    expect(fixture.target.calls.filter(([name]) => name === 'plan')).toHaveLength(0);

    if (action === 'commit' || action === 'undo') {
      const differentTerminalAction = await request(fixture.origin, `${route}/recover`, {
        method: 'POST', headers: authorized, body: JSON.stringify({ action: 'resume' }),
      });
      expect(differentTerminalAction.response.status).toBe(403);
    }
  });

  it('forgets operation-token scope after the project binding is invalidated', async () => {
    const fixture = await harness();
    await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 5 }] }),
    });
    fixture.target.bindingValid = false;
    const bindingHeaders = headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken });
    const rejected = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/query`, {
      method: 'POST', headers: bindingHeaders, body: '{}',
    });
    expect(rejected.response.status).toBe(403);

    fixture.target.bindingValid = true;
    const stale = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}/plan`, {
      method: 'POST',
      headers: { ...bindingHeaders, [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: operationToken },
      body: JSON.stringify({ targets: [] }),
    });
    expect(stale.response.status).toBe(403);
    expect(fixture.target.calls.filter(([name]) => name === 'plan')).toHaveLength(0);
  });

  it('streams exact binary uploads and rejects a mismatched Content-Length before dispatch', async () => {
    const fixture = await harness();
    await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 5 }] }),
    });
    const route = `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}/items/${itemId}`;
    const common = {
      Origin: fixture.origin,
      'Content-Type': 'application/octet-stream',
      [ASSET_IMPORT_AUTHORITY_TOKEN_HEADER]: authorityToken,
      [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken,
      [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: operationToken,
    };
    const uploaded = await request(fixture.origin, route, { method: 'PUT', headers: common, body: Buffer.from('hello') });
    expect(uploaded.response.status).toBe(200);
    expect(fixture.target.calls).toContainEqual(['upload', { operationId, itemId, bytes: 5 }]);

    fixture.target.uploadError = new AssetImportAuthorityError('IMPORT_UPLOAD_TIMEOUT', 'secret timeout detail');
    const timedOut = await request(fixture.origin, route, { method: 'PUT', headers: common, body: Buffer.from('hello') });
    expect(timedOut.response.status).toBe(408);
    expect(timedOut.body).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(timedOut.text).not.toContain('secret timeout detail');
    fixture.target.uploadError = undefined;

    const rejected = await request(fixture.origin, route, {
      method: 'PUT',
      headers: { ...common, 'Content-Length': '4' },
      body: Buffer.from('nope'),
    });
    expect(rejected.response.status).toBe(422);
  });

  it('rejects unknown JSON fields and hides internal manifest, staged identity, paths, tokens, causes, and stacks', async () => {
    const fixture = await harness();
    const unknown = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/query`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ projectRoot: 'C:\\secret' }),
    });
    expect(unknown.response.status).toBe(400);

    const oversized = await new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
      const url = new URL(`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/query`, fixture.origin);
      const outgoing = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          ...headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
          'Content-Length': String(ASSET_IMPORT_AUTHORITY_MAX_JSON_BYTES + 1),
        },
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
    expect(oversized.status).toBe(413);
    expect(JSON.parse(oversized.text)).toMatchObject({ ok: false, error: { code: 'IMPORT_LIMIT_EXCEEDED' } });

    const projected = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}/query`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: '{}',
    });
    expect(projected.response.status).toBe(200);
    for (const hidden of ['secret-source.png', 'manifest', 'stagedItems', 'previousGenerationSha256']) {
      expect(projected.text).not.toContain(hidden);
    }

    fixture.target.error = new AssetImportAuthorityError('PROJECT_BUSY', `C:\\secret ${authorityToken}`, {
      field: 'projectRoot', cause: 'hidden-cause', operationId,
    });
    await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 5 }] }),
    });
    const failed = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations/${operationId}/commit`, {
      method: 'POST',
      headers: headers(fixture.origin, {
        [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken,
        [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: operationToken,
      }),
      body: JSON.stringify({ planFingerprint: '2'.repeat(64) }),
    });
    expect(failed.response.status).toBe(409);
    for (const secret of ['C:\\secret', authorityToken, operationToken, 'hidden-cause', 'stack']) {
      expect(failed.text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('requires a project binding before dispatching scene plan or commit', async () => {
    const fixture = await harness(installSceneTarget(target()));
    const planBody = {
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/start.gal',
      targetPath: 'content/scenario/intro.gal',
    };
    const commitBody = {
      requestId: itemId,
      plans: [{ operationId, planFingerprint: '5'.repeat(64) }],
      writes: [{ path: 'content/scenario/intro.gal', text: '@scene intro\n', expectedSha256: null }],
    };

    for (const [route, body] of [
      [`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`, planBody],
      [`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`, commitBody],
    ] as const) {
      const rejected = await request(fixture.origin, route, {
        method: 'POST',
        headers: headers(fixture.origin),
        body: JSON.stringify(body),
      });
      expect(rejected.response.status).toBe(403);
      expect(rejected.body).toMatchObject({ ok: false, error: { code: 'AUTHORITY_TOKEN_REJECTED' } });
    }
    expect(fixture.target.calls.filter(([name]) => name === 'scene-plan' || name === 'scene-commit')).toHaveLength(0);
  });

  it('strictly validates scene plan and commit fields and project-relative paths before dispatch', async () => {
    const fixture = await harness(installSceneTarget(target()));
    const validPlan = {
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/start.gal',
      targetPath: 'content/scenario/intro.gal',
    };
    const validCommit = {
      requestId: itemId,
      plans: [{ operationId, planFingerprint: '5'.repeat(64) }],
      writes: [{ path: 'content/scenario/intro.gal', text: '@scene intro\n', expectedSha256: null }],
    };
    const invalidRequests = [
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`,
        body: { ...validPlan, unexpected: true },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`,
        body: { ...validPlan, sourcePath: '/outside/start.gal' },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`,
        body: { ...validPlan, targetPath: 'C:/outside/intro.gal' },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`,
        body: { ...validPlan, sourcePath: 'content/scenario/../outside.gal' },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`,
        body: { ...validPlan, sourcePath: 'content\\scenario\\start.gal' },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`,
        body: { ...validPlan, kind: 'delete', targetPath: 'content/scenario/deleted.gal' },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`,
        body: { ...validCommit, unexpected: true },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`,
        body: {
          ...validCommit,
          plans: [{ operationId, planFingerprint: '5'.repeat(64), unexpected: true }],
        },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`,
        body: {
          ...validCommit,
          writes: [{ ...validCommit.writes[0], path: '/outside/intro.gal' }],
        },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`,
        body: {
          ...validCommit,
          writes: [{ ...validCommit.writes[0], expectedSha256: 'not-a-sha256' }],
        },
      },
      {
        route: `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`,
        body: {
          ...validCommit,
          writes: [{ ...validCommit.writes[0], text: 42 }],
        },
      },
    ];

    for (const { route, body } of invalidRequests) {
      const rejected = await request(fixture.origin, route, {
        method: 'POST',
        headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
        body: JSON.stringify(body),
      });
      expect(rejected.response.status).toBe(400);
      expect(rejected.body).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(fixture.target.calls.filter(([name]) => name === 'scene-plan' || name === 'scene-commit')).toHaveLength(0);
  });

  it('dispatches valid scene plan and commit requests and returns their public responses', async () => {
    const fixture = await harness(installSceneTarget(target()));
    const planBody = {
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/start.gal',
      targetPath: 'content/scenario/intro.gal',
    };
    const planned = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify(planBody),
    });
    expect(planned.response.status).toBe(200);
    expect(planned.body).toEqual({ ok: true, data: {
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/start.gal',
      targetPath: 'content/scenario/intro.gal',
      planFingerprint: '5'.repeat(64),
      status: 'PLANNED',
    } });
    expect(fixture.target.calls).toContainEqual(['scene-plan', planBody]);

    const commitBody = {
      requestId: itemId,
      plans: [{ operationId, planFingerprint: '5'.repeat(64) }],
      writes: [{ path: 'content/scenario/intro.gal', text: '@scene intro\n', expectedSha256: null }],
    };
    const committed = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify(commitBody),
    });
    expect(committed.response.status).toBe(200);
    expect(committed.body).toEqual({ ok: true, data: {
      requestId: itemId,
      status: 'COMMITTED',
      writes: [{ path: 'content/scenario/intro.gal', sha256: '6'.repeat(64) }],
      deletedPaths: [],
    } });
    expect(fixture.target.calls).toContainEqual(['scene-commit', commitBody]);

    const createOnlyBody = {
      requestId: relocationReceiptId,
      plans: [],
      writes: [{ path: 'content/scenario/fresh.gal', text: '@scene fresh\n', expectedSha256: null }],
    };
    const created = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify(createOnlyBody),
    });
    expect(created.response.status).toBe(200);
    expect(fixture.target.calls).toContainEqual(['scene-commit', createOnlyBody]);
  });

  it('strictly validates relocation plan fields and rejects absolute paths', async () => {
    const fixture = await harness(installRelocationTarget(target()));
    const valid = {
      operationId,
      sourcePath: relocationSourcePath,
      targetDirectory: 'content/assets/background',
      fileName: 'new.png',
    };
    const invalidRequests = [
      { ...valid, unexpected: true },
      { ...valid, sourcePath: '/outside/old.png' },
      { ...valid, sourcePath: 'C:/outside/old.png' },
      { ...valid, targetDirectory: 'D:/outside' },
    ];

    for (const body of invalidRequests) {
      const rejected = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`, {
        method: 'POST',
        headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
        body: JSON.stringify(body),
      });
      expect(rejected.response.status).toBe(400);
      expect(rejected.body).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    expect(fixture.target.calls.filter(([name]) => name === 'relocation-plan')).toHaveLength(0);

    const accepted = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify(valid),
    });
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.data.operationToken).toEqual(expect.any(String));
    expect(fixture.target.calls).toContainEqual(['relocation-plan', {
      operationId,
      sourcePath: relocationSourcePath,
      targetPath: relocationTargetPath,
    }]);

    const batchMoves = [
      { sourcePath: relocationSourcePath, targetPath: relocationTargetPath },
      { sourcePath: 'content/assets/background/second.png', targetPath: 'content/assets/background/second-new.png' },
    ];
    const batchAccepted = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId: itemId, moves: batchMoves }),
    });
    expect(batchAccepted.response.status).toBe(200);
    expect(fixture.target.calls).toContainEqual(['relocation-plan', { operationId: itemId, moves: batchMoves }]);

    const invalidBatch = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId: itemId, moves: [{ ...batchMoves[0], extra: true }] }),
    });
    expect(invalidBatch.response.status).toBe(400);
  });

  it('routes relocation plan/query/resume/commit/cancel/recover/undo through the relocation target', async () => {
    const fixture = await harness(installRelocationTarget(target()));
    const bindingHeaders = { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken };
    const planned = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, bindingHeaders),
      body: JSON.stringify({
        operationId,
        sourcePath: relocationSourcePath,
        targetDirectory: 'content/assets/background',
        fileName: 'new.png',
      }),
    });
    expect(planned.response.status).toBe(200);
    const plannedToken = planned.body.data.operationToken as string;
    const plannedHeaders = {
      ...bindingHeaders,
      [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: plannedToken,
    };

    const queried = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/query`, {
      method: 'POST', headers: headers(fixture.origin, plannedHeaders), body: '{}',
    });
    expect(queried.response.status).toBe(200);

    const resumed = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/resume`, {
      method: 'POST', headers: headers(fixture.origin, plannedHeaders), body: '{}',
    });
    expect(resumed.response.status).toBe(200);
    const resumedToken = resumed.body.data.operationToken as string;
    const actionHeaders = {
      ...bindingHeaders,
      [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: resumedToken,
    };

    const committed = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/commit`, {
      method: 'POST', headers: headers(fixture.origin, actionHeaders), body: JSON.stringify({ planFingerprint: '5'.repeat(64) }),
    });
    const cancelled = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/cancel`, {
      method: 'POST', headers: headers(fixture.origin, actionHeaders), body: '{}',
    });
    const recovered = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/recover`, {
      method: 'POST', headers: headers(fixture.origin, actionHeaders), body: JSON.stringify({ action: 'rollback' }),
    });
    const undone = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/undo`, {
      method: 'POST',
      headers: headers(fixture.origin, actionHeaders),
      body: JSON.stringify({ receiptId: relocationReceiptId, receiptFingerprint: '4'.repeat(64) }),
    });
    expect([committed, cancelled, recovered, undone].map((result) => result.response.status)).toEqual([200, 200, 200, 200]);
    expect(fixture.target.calls.filter(([name]) => name.startsWith('relocation-')).map(([name]) => name)).toEqual([
      'relocation-plan',
      'relocation-query',
      'relocation-query',
      'relocation-commit',
      'relocation-cancel',
      'relocation-recover',
      'relocation-undo',
    ]);
  });

  it('does not accept an import operation token on a relocation route', async () => {
    const fixture = await harness(installRelocationTarget(target()));
    const created = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/operations`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({ operationId, items: [{ itemId, sourceName: 'safe.png', declaredBytes: 5 }] }),
    });
    expect(created.response.status).toBe(200);
    const rejected = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/commit`, {
      method: 'POST',
      headers: headers(fixture.origin, {
        [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken,
        [ASSET_IMPORT_AUTHORITY_OPERATION_HEADER]: created.body.data.operationToken,
      }),
      body: JSON.stringify({ planFingerprint: '5'.repeat(64) }),
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.body).toMatchObject({ ok: false, error: { code: 'AUTHORITY_TOKEN_REJECTED' } });
    expect(fixture.target.calls.filter(([name]) => name === 'relocation-commit')).toHaveLength(0);
  });

  it('keeps relocation public responses free of absolute paths and internal workspace paths', async () => {
    const fixture = await harness(installRelocationTarget(target()));
    const planned = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/plan`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: JSON.stringify({
        operationId,
        sourcePath: relocationSourcePath,
        targetDirectory: 'content/assets/background',
        fileName: 'new.png',
      }),
    });
    expect(planned.response.status).toBe(200);
    for (const hidden of ['C:\\\\private\\\\project', '.surdet/asset-relocation', 'record.json']) {
      expect(planned.text).not.toContain(hidden);
    }

    const queried = await request(fixture.origin, `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/relocations/${operationId}/query`, {
      method: 'POST',
      headers: headers(fixture.origin, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken }),
      body: '{}',
    });
    expect(queried.response.status).toBe(200);
    expect(queried.text).not.toContain('.surdet/asset-relocation');
  });

  it('returns import and relocation discovery in separate arrays on binding confirmation', async () => {
    const fixture = await bindingHarness();
    installRelocationTarget(fixture.target);
    const confirmed = await bindProjectConfirmation(fixture, 'browser-relocation-discovery');
    expect(confirmed.pendingOperations).toEqual(expect.any(Array));
    expect(confirmed.recentReceipts).toEqual(expect.any(Array));
    expect(confirmed.pendingRelocations).toEqual([relocationSummary('PLANNED')]);
    expect(confirmed.recentRelocationReceipts).toEqual([expect.objectContaining({
      operationId,
      receiptId: relocationReceiptId,
    })]);
  });
});
