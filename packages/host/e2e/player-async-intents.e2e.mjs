import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_PLAYER_INTENT_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-player-intent-'));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="app"></div><script type="module">
import { startPlayer } from '/examples/shared/player/player.ts';
window.surdetSave = {
  list: async () => [], read: async () => null, write: async () => {}, delete: async () => {},
  listMeta: async () => { if (window.delaySlots) await new Promise(resolve => window.releaseSlots = resolve); return []; },
  listBackupMeta: async () => [], restoreBackup: async () => {},
};
window.surdetProfile = {
  read: async key => { if (key === 'clear-record' && window.delayProfile) await new Promise(resolve => window.releaseProfile = resolve); return null; },
  write: async () => {}, delete: async () => {},
};
const config = {title:'Async intent test',entryScene:'start',characters:{}};
if (!new URL(location.href).searchParams.has('without-variables')) config.variables = {};
await startPlayer({ id:'audit-player-intents', config,
  sceneFiles:{'content/scenario/start.gal':async()=> '@scene start\\n第一句。\\n第二句。\\n@end\\n'},
  assetFiles:{},fontFiles:{},resolveSceneUrl:path=>path });
window.playerReady = true;
</script></body></html>`;
let server, browser, page;
const errors = [];
try {
  await fs.mkdir(output, { recursive: true });
  server = await createServer({ root, configFile: false, cacheDir: path.join(output, 'vite'),
    server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'player-intent-fixture', configureServer(instance) {
      instance.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/audit-player/') return next();
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    } }] });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  const startupFailure = new Promise((_, reject) => page.once('pageerror', reject));
  await Promise.race([
    page.goto(`http://127.0.0.1:${port}/audit-player/?without-variables`)
      .then(() => page.waitForFunction(() => window.playerReady, null, { timeout: 60000 })),
    startupFailure,
  ]);
  await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
  await page.waitForFunction(() => window.__surdetDebug.position?.sceneId === 'start');
  assert.equal(await page.evaluate(() => window.__surdetDebug.position.sceneId), 'start');
  await page.screenshot({ path: path.join(output, 'no-variable-table-first-line.png') });
  await page.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/audit-player/`);
  await page.waitForFunction(() => window.playerReady, null, { timeout: 60000 });

  await page.evaluate(() => { window.delayProfile = true; window.pendingStart = window.__surdetDebug.titleSelect('new'); });
  await page.waitForFunction(() => typeof window.releaseProfile === 'function');
  await page.evaluate(() => window.surdetDebug.showTitleScreen());
  await page.evaluate(async () => { window.releaseProfile(); await window.pendingStart; window.delayProfile = false; });
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.base), 'title');
  assert.equal(await page.evaluate(() => window.__surdetDebug.position), null);

  await page.evaluate(() => { window.delaySlots = true; window.pendingList = window.surdetDebug.openSaveLoad('load', 'title'); });
  await page.waitForFunction(() => typeof window.releaseSlots === 'function');
  await page.evaluate(() => window.__surdetDebug.titleSelect('settings'));
  await page.evaluate(async () => { window.releaseSlots(); await window.pendingList; window.delaySlots = false; });
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.overlay), 'settings');
  await page.screenshot({ path: path.join(output, 'late-list-keeps-settings.png') });

  await page.evaluate(() => window.surdetDebug.showTitleScreen());
  await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
  await page.waitForFunction(() => window.__surdetDebug.position?.sceneId === 'start');
  await page.keyboard.press('o');
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.overlay), 'settings');
  await page.keyboard.press('g');
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.overlay), 'settings');
  // The real modal capture owns closing/navigation; host shortcuts must not bypass it.
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.overlay), 'none');
  await page.keyboard.press('g');
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.overlay), 'gallery');
  await page.keyboard.press('o');
  assert.equal(await page.evaluate(() => window.__surdetDebug.uiSession.overlay), 'gallery');
  assert.deepEqual(errors, []);
  console.log('PASS full shared Player: omitted variable table starts the story; delayed new game cancelled by title, delayed list keeps settings, real G/O keys respect overlays; page errors 0');
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') });
  if (page && !page.isClosed()) console.error(await page.evaluate(() => ({ ui: window.__surdetDebug?.uiSession,
    system: window.surdetDebug?.queries.overlay.system(), position: window.__surdetDebug?.position })));
  console.error(errors); throw error;
} finally { await browser?.close(); await server?.close(); }
