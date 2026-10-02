import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-player-late-asset-'));
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const directory of ['starter', 'zero-after-midnight']) {
    const root = path.join(repo, 'examples', directory);
    const fileBase = '/@fs/' + root.split(path.sep).join('/');
    const shared = directory === 'starter';
    const modulePath = shared ? '/@fs/' + repo.split(path.sep).join('/') + '/examples/shared/player/player.ts' : fileBase + '/src/main.ts';
    const fonts = shared ? ['fonts/NotoSerifSC-Variable.ttf'] : ['fonts/NotoSerifSC-Variable.ttf', 'fonts/NotoSansSC-Variable.ttf'];
    const scene = '@scene start\n旁白：素材测试。\n@end\n';
    const startup = shared ? [
      'import { startPlayer } from ' + JSON.stringify(modulePath) + ';',
      'window.auditController = new AbortController();',
      "window.auditStart = startPlayer({ id: 'audit-late-assets', config: { title: 'Audit', entryScene: 'start', variables: {}, fonts: { body: 'content/assets/fonts/NotoSerifSC-Variable.ttf' } },",
      "  sceneFiles: { 'content/scenario/start.gal': async () => " + JSON.stringify(scene) + ' },',
      '  assetFiles: {}, fontFiles: {}, resolveSceneUrl: path => path }, window.auditController.signal);',
    ].join('\n') : 'await import(' + JSON.stringify(modulePath) + ');';
    const html = [
      '<!doctype html><meta charset="utf-8"><style>body{margin:0}canvas{display:block}</style><div id="app"></div><script type="module">',
      'window.auditLiveUrls = new Set();',
      'const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);',
      'URL.createObjectURL = value => { const url = create(value); window.auditLiveUrls.add(url); return url; };',
      'URL.revokeObjectURL = value => { window.auditLiveUrls.delete(value); return revoke(value); };',
      'const listReady = new Promise(resolve => { window.auditReleaseList = resolve; });',
      'window.surdetAsset = {',
      '  list: async () => { await listReady; return ' + JSON.stringify(['bg/audit.svg', ...fonts]) + '; },',
      "  read: async rel => rel.startsWith('fonts/')",
      '    ? new Uint8Array(await (await fetch(' + JSON.stringify(fileBase + '/content/assets/') + ' + rel)).arrayBuffer())',
      "    : new TextEncoder().encode('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\"><rect width=\"32\" height=\"32\" fill=\"#198044\"/></svg>'),",
      '};',
      startup,
      '</script>',
    ].join('\n');
    const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 18083, strictPort: true },
      plugins: [{ name: 'audit-player-fixture', configureServer(server) { server.middlewares.use('/audit-late-assets', (_req, res) => { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); }); } }],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await server.listen();
      await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/audit-late-assets');
      await page.waitForFunction(() => window.surdetDebug?.commands);
      await page.evaluate(() => {
        const assets = window.surdetDebug.commands.assets;
        const register = assets.registerBackground;
        assets.registerBackground = async (...args) => {
          // Decode and register through real Pixi; delay only promise delivery.
          await register(...args);
          await new Promise(resolve => { window.auditReleaseRegistration = resolve; });
        };
        window.auditReleaseList();
      });
      await page.waitForFunction(() => typeof window.auditReleaseRegistration === 'function');
      await page.waitForFunction(() => window.__surdetDebug.fontFamilies.body.startsWith('SurdetGame'));
      const result = await page.evaluate(async shared => {
        const debug = window.__surdetDebug;
        if (shared) window.auditController.abort();
        else window.dispatchEvent(new Event('beforeunload'));
        const disposed = window.surdetDebug.queries.diagnostics.isDisposed();
        const before = { retained: debug.activeBlobUrls, live: window.auditLiveUrls.size };
        window.auditReleaseRegistration();
        if (shared) await window.auditStart;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { disposed, before, after: { retained: debug.activeBlobUrls, live: window.auditLiveUrls.size } };
      }, shared);
      results.push({ directory, result, errors });
      await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify({ directory, result, errors }, null, 2));
      assert.equal(result.disposed, true, directory);
      assert.deepEqual(result.after, { retained: 0, live: 0 }, directory);
      assert.deepEqual(errors, [], directory);
    } catch (error) {
      console.log(JSON.stringify({ directory, errors, body: await page.locator('body').innerText() }, null, 2));
      throw error;
    } finally { await page.close(); await server.close(); }
  }
} finally { await browser.close(); }
