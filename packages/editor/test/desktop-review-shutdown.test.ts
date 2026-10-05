import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Server } from 'node:http';
import { startEditorServer } from '../desktop/server.js';
import { ReviewTerminalAuthority } from '../../cli/dist/authoring/review-terminal-authority.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

it.each(['success', 'failure'] as const)('drains disconnected review work before desktop shutdown: %s', async outcome => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-review-shutdown-')); roots.push(root);
  vi.stubEnv('SURDET_AGENT_DATA_DIR', path.join(root, 'agent'));
  await fs.writeFile(path.join(root, 'index.html'), '<html><head></head><body></body></html>');
  const entered = deferred(), release = deferred(), listenerClosed = deferred();
  let completed = false;
  vi.spyOn(ReviewTerminalAuthority.prototype, 'write').mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    completed = true;
    if (outcome === 'failure') throw new Error('controlled business failure');
    return { protocolVersion: '1.0.0', projectIdentity: '0123456789abcdef0123456789abcdef', reviewId: 'shutdown-review', state: 'open' };
  });
  const realClose = Server.prototype.close;
  vi.spyOn(Server.prototype, 'close').mockImplementation(function (this: Server, callback) {
    return realClose.call(this, error => { listenerClosed.resolve(); callback?.(error); });
  });
  const runtime = await startEditorServer(root, path.join(root, 'imports'));
  const abort = new AbortController();
  let request: Promise<Response> | undefined, closing: Promise<void> | undefined;
  try {
    const html = await (await runtime.request(new Request('surdet-editor://app/index.html'))).text();
    const config = JSON.parse(/__SURDET_REVIEW_AUTHORITY__=Object\.freeze\((.*?)\);/.exec(html)![1]!) as { token: string };
    request = runtime.request(new Request('surdet-editor://app/__surdet/review-authority/v1/write', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-surdet-review-authority': config.token },
      body: JSON.stringify({ protocolVersion: '1.0.0', requestId: 'shutdown-request',
        projectIdentity: '0123456789abcdef0123456789abcdef', reviewId: 'shutdown-review',
        reviewPayload: { bytes: 123, sha256: 'a'.repeat(64) }, action: 'comparison-decision',
        receipt: { receiptVersion: '1.0.0', decisionId: 'shutdown-decision', reviewId: 'shutdown-review', decisionFingerprint: 'b'.repeat(64) } }),
      signal: abort.signal,
    }));
    await Promise.race([entered.promise, request.then(async response => {
      throw new Error(`Request returned before business entry: ${response.status} ${await response.text()}`);
    })]);
    abort.abort(); await request;
    let shutdownFinished = false;
    closing = runtime.close().then(() => { shutdownFinished = true; });
    await listenerClosed.promise;
    // The listener has really closed, so a pending socket cannot accidentally satisfy this check.
    expect(completed).toBe(false);
    expect(shutdownFinished).toBe(false);
    expect((await runtime.request(new Request('surdet-editor://app/index.html'))).status).toBe(503);
    release.resolve(); await closing;
    expect(completed).toBe(true);
    expect(shutdownFinished).toBe(true);
  } finally {
    abort.abort(); release.resolve(); await request?.catch(() => {});
    if (closing) await closing; else await runtime.close();
  }
}, 10000);
