import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthoringOperationError, type ReviewTerminalSnapshot } from '@surdet/authoring';
import {
  createReviewAuthorityHttpHandler,
  type ReviewAuthorityHttpTarget,
} from '../src/review-authority/http-handler.js';
import {
  injectReviewAuthorityConfig,
  reviewAuthorityVitePlugin,
  type ReviewAuthorityBrowserConfig,
} from '../src/review-authority/vite-plugin.js';

const servers: http.Server[] = [];
const token = 'test-authority-token';
const openSnapshot: ReviewTerminalSnapshot = {
  protocolVersion: '1.0.0',
  projectIdentity: '0123456789abcdef0123456789abcdef',
  reviewId: 'review-http',
  state: 'open',
};
const describeInput = {
  projectIdentity: openSnapshot.projectIdentity,
  reviewId: openSnapshot.reviewId,
  reviewPayload: { bytes: 123, sha256: 'a'.repeat(64) },
};
const writeCommand = {
  protocolVersion: '1.0.0',
  requestId: 'request-http',
  ...describeInput,
  action: 'comparison-decision',
  receipt: {
    receiptVersion: '1.0.0',
    decisionId: 'decision-http',
    reviewId: openSnapshot.reviewId,
    decisionFingerprint: 'b'.repeat(64),
  },
};

interface Harness {
  origin: string;
  calls: { describe: unknown[]; write: unknown[] };
  target: ReviewAuthorityHttpTarget & { writeError?: unknown };
}

async function harness(options: { maxBodyBytes?: number; bodyTimeoutMs?: number } = {}): Promise<Harness> {
  const calls = { describe: [] as unknown[], write: [] as unknown[] };
  const target: ReviewAuthorityHttpTarget & { writeError?: unknown } = {
    async describe(input) {
      calls.describe.push(input);
      return openSnapshot;
    },
    async write(command) {
      calls.write.push(command);
      if (this.writeError !== undefined) throw this.writeError;
      return openSnapshot;
    },
  };
  let expectedOrigin = '';
  const server = http.createServer(createReviewAuthorityHttpHandler({
    authority: target,
    token,
    expectedOrigin: () => expectedOrigin,
    ...options,
  }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing HTTP address');
  expectedOrigin = `http://127.0.0.1:${address.port}`;
  return { origin: expectedOrigin, calls, target };
}

async function request(
  origin: string,
  route: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string; body: unknown }> {
  const response = await fetch(`${origin}${route}`, options);
  const text = await response.text();
  return { response, text, body: text.length === 0 ? null : JSON.parse(text) };
}

function headers(origin: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Origin': origin,
    'X-Surdet-Review-Authority': token,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('review authority HTTP boundary', () => {
  it('injects the token only into the main Editor HTML and never into preview.html', () => {
    const config: ReviewAuthorityBrowserConfig = {
      protocolVersion: '1.0.0',
      endpoint: '/__surdet/review-authority/v1',
      token,
    };
    const html = '<html><head></head><body></body></html>';
    const main = injectReviewAuthorityConfig(html, '/index.html', config);
    expect(main).toContain('data-surdet-review-authority');
    expect(main).toContain(token);
    expect(injectReviewAuthorityConfig(main, '/index.html', config)).toBe(main);
    expect(injectReviewAuthorityConfig(html, '/preview.html', config)).toBe(html);
    const plugin = reviewAuthorityVitePlugin({ token });
    expect(plugin.transformIndexHtml.handler(html, { path: '/index.html' })).toBe(html);
    expect(plugin.transformIndexHtml.handler(html, { path: '/index.html', server: {} })).toContain(token);
  });

  it('reports same-origin protocol status without exposing receipt data or calling authority methods', async () => {
    const fixture = await harness();
    const result = await request(fixture.origin, '/__surdet/review-authority/v1/status', {
      headers: { 'X-Surdet-Review-Authority': token },
    });
    expect(result.response.status).toBe(200);
    expect(result.body).toEqual({ ok: true, result: { protocolVersion: '1.0.0', status: 'available' } });
    expect(result.text).not.toContain('receipt');
    expect(fixture.calls).toEqual({ describe: [], write: [] });
  });

  it('accepts exact describe and write requests only after boundary validation', async () => {
    const fixture = await harness();
    const described = await request(fixture.origin, '/__surdet/review-authority/v1/describe', {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify(describeInput),
    });
    const written = await request(fixture.origin, '/__surdet/review-authority/v1/write', {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify(writeCommand),
    });
    expect(described.response.status).toBe(200);
    expect(written.response.status).toBe(200);
    expect(fixture.calls.describe).toEqual([describeInput]);
    expect(fixture.calls.write).toEqual([writeCommand]);
  });

  it.each([
    ['wrong token', '/__surdet/review-authority/v1/write', { method: 'POST', headers: headers('ORIGIN', { 'X-Surdet-Review-Authority': 'wrong' }), body: JSON.stringify(writeCommand) }, 403],
    ['wrong origin', '/__surdet/review-authority/v1/write', { method: 'POST', headers: headers('http://attacker.invalid'), body: JSON.stringify(writeCommand) }, 403],
    ['wrong content type', '/__surdet/review-authority/v1/write', { method: 'POST', headers: headers('ORIGIN', { 'Content-Type': 'text/plain' }), body: JSON.stringify(writeCommand) }, 415],
    ['wrong method', '/__surdet/review-authority/v1/write', { method: 'GET', headers: { 'X-Surdet-Review-Authority': token } }, 405],
    ['unknown route', '/__surdet/review-authority/v1/unknown', { method: 'POST', headers: headers('ORIGIN'), body: '{}' }, 404],
  ] as const)('rejects %s without dispatch', async (_name, route, rawOptions, status) => {
    const fixture = await harness();
    const options = {
      ...rawOptions,
      headers: Object.fromEntries(Object.entries(rawOptions.headers).map(([key, value]) => [
        key,
        value === 'ORIGIN' ? fixture.origin : value,
      ])),
    } satisfies RequestInit;
    const result = await request(fixture.origin, route, options);
    expect(result.response.status).toBe(status);
    expect(fixture.calls).toEqual({ describe: [], write: [] });
  });

  it('rejects unknown keys and oversized bodies before authority dispatch', async () => {
    const fixture = await harness();
    const unknown = await request(fixture.origin, '/__surdet/review-authority/v1/describe', {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify({ ...describeInput, reviewPath: 'C:/secret' }),
    });
    const oversized = await request(fixture.origin, '/__surdet/review-authority/v1/write', {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify({ padding: 'x'.repeat(262_145) }),
    });
    expect(unknown.response.status).toBe(400);
    expect(oversized.response.status).toBe(413);
    expect(fixture.calls).toEqual({ describe: [], write: [] });
  });

  it('caps configured limits and rejects chunked bodies as soon as they exceed the bound', async () => {
    expect(() => createReviewAuthorityHttpHandler({
      authority: { describe: async () => openSnapshot, write: async () => openSnapshot },
      token,
      expectedOrigin: () => 'http://127.0.0.1',
      maxBodyBytes: 262_145,
    })).toThrowError(/between 1 and 262144/);

    const fixture = await harness({ maxBodyBytes: 64 });
    const url = new URL('/__surdet/review-authority/v1/write', fixture.origin);
    const result = await new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
      const outgoing = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          ...headers(fixture.origin),
          'Transfer-Encoding': 'chunked',
        },
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      });
      outgoing.on('error', reject);
      outgoing.write('x'.repeat(40));
      outgoing.write('y'.repeat(40));
      outgoing.end();
    });
    expect(result.status).toBe(413);
    expect(JSON.parse(result.text)).toMatchObject({ ok: false, error: { code: 'REQUEST_TOO_LARGE' } });
    expect(fixture.calls).toEqual({ describe: [], write: [] });
  });

  it('times out an incomplete chunked body and closes it without dispatch', async () => {
    const fixture = await harness({ bodyTimeoutMs: 100 });
    const url = new URL('/__surdet/review-authority/v1/write', fixture.origin);
    const result = await new Promise<{ status: number | undefined; text: string }>((resolve, reject) => {
      const outgoing = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          ...headers(fixture.origin),
          'Transfer-Encoding': 'chunked',
        },
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      });
      outgoing.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
      });
      outgoing.write('{');
    });
    expect(result.status).toBe(408);
    expect(JSON.parse(result.text)).toMatchObject({ ok: false, error: { code: 'REQUEST_TIMEOUT' } });
    expect(fixture.calls).toEqual({ describe: [], write: [] });
  });

  it('redacts business details, paths, tokens, receipt bodies, causes, and stacks', async () => {
    const fixture = await harness();
    fixture.target.writeError = new AuthoringOperationError(
      'REVIEW_BUSY',
      `secret ${fixture.origin} C:\\private\\agent-data ${token}`,
      { ownerToken: token, receipt: writeCommand.receipt, cause: 'hidden cause' },
    );
    const result = await request(fixture.origin, '/__surdet/review-authority/v1/write', {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify(writeCommand),
    });
    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      ok: false,
      error: { code: 'REVIEW_BUSY', message: '本机审阅服务暂时无法完成这项请求。' },
    });
    for (const secret of [fixture.origin, 'C:\\private', token, 'decision-http', 'hidden cause', 'stack']) {
      expect(result.text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('maps an unrecognized upstream code to a fixed internal error code', async () => {
    const fixture = await harness();
    fixture.target.writeError = new AuthoringOperationError('C:\\private\\secret', 'hidden message');
    const result = await request(fixture.origin, '/__surdet/review-authority/v1/write', {
      method: 'POST',
      headers: headers(fixture.origin),
      body: JSON.stringify(writeCommand),
    });
    expect(result.response.status).toBe(500);
    expect(result.body).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '本机审阅服务暂时无法完成这项请求。' },
    });
    expect(result.text).not.toContain('private');
  });
});
