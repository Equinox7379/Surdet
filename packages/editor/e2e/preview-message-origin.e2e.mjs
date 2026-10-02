import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-preview-origins-'));
await fs.mkdir(output, { recursive: true });
const foreign = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><p>Foreign message sender</p>'); });
await new Promise((resolve, reject) => { foreign.once('error', reject); foreign.listen(0, '127.0.0.1', resolve); });
const foreignOrigin = `http://127.0.0.1:${foreign.address().port}`;
const parentHtml = `<!doctype html><meta charset="utf-8"><iframe name="preview" src="/preview.html" style="width:960px;height:600px"></iframe><iframe name="sender" src="${foreignOrigin}/"></iframe><iframe name="sibling" src="/audit-sibling"></iframe><script>
window.auditTraceStarts = [];
window.addEventListener('message', event => { if (event.source === window.frames[0] && event.data?.type === 'surdet-preview-trace-start') window.auditTraceStarts.push(event.data.traceId); });
</script>`;
const server = await createServer({ root: editorRoot, configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18080, strictPort: true },
  plugins: [{ name: 'preview-origin-fixture', configureServer(server) { server.middlewares.use((req, res, next) => {
    if (req.url !== '/audit-parent' && req.url !== '/audit-sibling') return next();
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(req.url === '/audit-parent' ? parentHtml : '<!doctype html><p>Same-origin sibling sender</p>');
  }); } }],
});
let browser; const errors = [], results = [];
const payload = (id, text) => ({ type: 'surdet-preview-load', payload: {
  sceneId: 'start', projectKey: 'message-origin-own-fixture', traceId: id, seed: 7, fast: true,
  scenes: [{ id: 'start', text: `@scene start\n旁白：${text}\n@end\n` }], variables: [],
  assets: { backgrounds: [], portraits: [], avatars: [], audio: [] },
} });
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:18080/audit-parent');
  const preview = page.frames().find(frame => frame.name() === 'preview');
  const sender = page.frames().find(frame => frame.name() === 'sender');
  const sibling = page.frames().find(frame => frame.name() === 'sibling');
  assert(preview && sender && sibling);
  await preview.waitForFunction(() => window.surdetPreviewDebug?.runtime);
  for (const source of ['foreign', 'sibling']) for (const command of ['load', 'fast']) {
    const trustedId = `trusted-${source}-${command}`, attackerId = `attacker-${source}-${command}`;
    await page.evaluate(message => window.frames[0].postMessage(message, location.origin), payload(trustedId, trustedId));
    await preview.waitForFunction(id => window.surdetPreviewDebug?.runtime?.queries.diagnostics.projectionSnapshot().dialogue?.dialogText.includes(id), trustedId);
    const before = await preview.evaluate(() => {
      const controller = window.surdetPreviewDebug.runtime.controller;
      const original = controller.setTextSpeed.bind(controller);
      window.auditOriginalSetTextSpeed = original;
      window.auditSpeedCalls = []; window.auditDelivered = 0;
      controller.setTextSpeed = value => { window.auditSpeedCalls.push(value); original(value); };
      window.addEventListener('message', event => { if (event.data?.type === 'surdet-preview-load' || event.data?.type === 'surdet-preview-fast') window.auditDelivered++; }, { once: true });
      return window.surdetPreviewDebug.interp.saveSnapshot();
    });
    const message = command === 'load' ? payload(attackerId, attackerId) : { type: 'surdet-preview-fast', fast: false };
    await (source === 'foreign' ? sender : sibling).evaluate(message => window.parent.frames[0].postMessage(message, 'http://127.0.0.1:18080'), message);
    await preview.waitForFunction(() => window.auditDelivered === 1);
    await preview.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await preview.evaluate(() => {
      window.surdetPreviewDebug.runtime.controller.setTextSpeed = window.auditOriginalSetTextSpeed;
      return { snapshot: window.surdetPreviewDebug.interp?.saveSnapshot() ?? null,
        text: window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText,
        speedCalls: window.auditSpeedCalls };
    });
    const traceStarted = await page.evaluate(id => window.auditTraceStarts.includes(id), attackerId);
    results.push({ source, command, before, after, traceStarted });
  }
  await page.evaluate(message => window.frames[0].postMessage(message, location.origin), payload('trusted-after-denials', '可信父页面继续播放'));
  await preview.waitForFunction(() => window.surdetPreviewDebug?.runtime?.queries.diagnostics.projectionSnapshot().dialogue?.dialogText.includes('可信父页面继续播放'));
  await preview.evaluate(() => {
    const controller = window.surdetPreviewDebug.runtime.controller, original = controller.setTextSpeed.bind(controller);
    window.auditSpeedCalls = [];
    controller.setTextSpeed = value => { window.auditSpeedCalls.push(value); original(value); };
  });
  await page.evaluate(() => window.frames[0].postMessage({ type: 'surdet-preview-fast', fast: false }, location.origin));
  await preview.waitForFunction(() => window.auditSpeedCalls.includes(30));
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ results, errors, trustedContinuation: true }, null, 2));
  console.log(JSON.stringify({ output, results: results.map(result => ({ source: result.source, command: result.command,
    sceneHashHeld: result.before.position.sceneHash === result.after.snapshot?.position.sceneHash, traceStarted: result.traceStarted,
    speedCalls: result.after.speedCalls, text: result.after.text })), errors, trustedContinuation: true }, null, 2));
  for (const result of results) {
    assert.equal(result.traceStarted, false, result.source + '/' + result.command);
    assert.equal(result.after.snapshot?.position.sceneHash, result.before.position.sceneHash, result.source + '/' + result.command);
    assert.deepEqual(result.after.speedCalls, [], result.source + '/' + result.command);
  }
  assert.deepEqual(errors, []);
} catch (error) { await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ results, errors, failure: String(error) }, null, 2)); console.log(JSON.stringify({ output, errors, failure: String(error) })); throw error; }
finally { await browser?.close(); await server.close(); await new Promise(resolve => foreign.close(resolve)); }
