import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-autosave-project-identity-'));
let server, browser;
const errors = [];
try {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  server = await createServer({ root: path.join(repository, 'packages/editor'),
    cacheDir: path.join(output, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true },
    plugins: [{ name: 'audit-identity-page', configureServer(vite) {
      vite.middlewares.use('/audit-identity.html', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await vite.transformIndexHtml('/audit-identity.html', '<!doctype html><html><body>Autosave identity probe</body></html>'));
      });
    } }],
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/audit-identity.html`);
  const result = await page.evaluate(async () => {
    const autosave = await import('/src/autosave.ts');
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('same-project', { create: true });
    const ids = await Promise.all(Array.from({ length: 4 }, () => autosave.resolveAutosaveProjectIdentity(directory)));
    ids.forEach((id, index) => autosave.writeAutosave({ dirName: directory.name, projectId: id,
      savedAt: index, scenes: [{ key: 'start', text: `unsaved-tab-${index}` }] }));
    const reopenedId = await autosave.resolveAutosaveProjectIdentity(directory);
    const reopened = autosave.readAutosave(reopenedId);
    const other = await root.getDirectoryHandle('other-project', { create: true });
    const otherId = await autosave.resolveAutosaveProjectIdentity(other);
    return { ids, reopenedId, reopened, otherId, locksAvailable: !!navigator.locks,
      handleType: directory.constructor.name, sameEntry: await directory.isSameEntry(await root.getDirectoryHandle('same-project')) };
  });
  await page.reload();
  const afterReload = await page.evaluate(async () => {
    const autosave = await import('/src/autosave.ts');
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle('same-project');
    const id = await autosave.resolveAutosaveProjectIdentity(directory);
    return { id, payload: autosave.readAutosave(id) };
  });
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(error.message));
  await second.goto(`${origin}/audit-identity.html`);
  const crossPageIds = await Promise.all([page, second].map(active => active.evaluate(async () => {
    const autosave = await import('/src/autosave.ts');
    const root = await navigator.storage.getDirectory();
    return autosave.resolveAutosaveProjectIdentity(await root.getDirectoryHandle('cross-page-project', { create: true }));
  })));
  const unsupported = await second.evaluate(async () => {
    const autosave = await import('/src/autosave.ts');
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('same-project');
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    return autosave.resolveAutosaveProjectIdentity(directory);
  });
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ result, afterReload, crossPageIds, unsupported, errors }, null, 2));
  console.log(JSON.stringify({ output, result, afterReload, crossPageIds, unsupported, errors }, null, 2));
  assert(result.ids.every(id => typeof id === 'string' && id === result.ids[0]), 'one physical directory must resolve to one stable identity during concurrent opens');
  assert.equal(result.reopenedId, result.ids[0]);
  assert.equal(result.reopened.scenes[0].text, 'unsaved-tab-3');
  assert.notEqual(result.otherId, result.reopenedId);
  assert.equal(afterReload.id, result.reopenedId);
  assert.deepEqual(afterReload.payload, result.reopened);
  assert.equal(typeof crossPageIds[0], 'string');
  assert.equal(crossPageIds[0], crossPageIds[1], 'separate pages must share the registry lock');
  assert.equal(unsupported, null, 'without cross-page coordination, autosave identity must fail closed');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); await server?.close(); }
