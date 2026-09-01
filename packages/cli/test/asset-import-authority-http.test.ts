import * as http from 'node:http';
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

const servers: http.Server[] = [];
const authorityToken = 'a'.repeat(64);
const bindingToken = 'b'.repeat(64);
const operationToken = 'c'.repeat(64);
const otherBindingToken = 'd'.repeat(64);
const operationId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';

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

async function harness(): Promise<{ origin: string; target: ReturnType<typeof target> }> {
  const service = target();
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
});

describe('project asset import authority HTTP boundary', () => {
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
});
