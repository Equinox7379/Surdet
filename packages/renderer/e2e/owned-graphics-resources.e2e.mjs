import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer as createProbe } from 'node:net';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-owned-graphics-'));
const html = `<!doctype html><meta charset="UTF-8"><title>Owned World resources</title><script type="module">
import { Application, Container, Graphics, Texture, VERSION } from 'pixi.js';
import { WorldLayer } from '/packages/renderer/src/layers/world/world-layer.ts';
import { RenderAssetRegistry } from '/packages/renderer/src/services/render-asset-registry.ts';
import { RenderLifecycle } from '/packages/renderer/src/lifecycle/render-lifecycle.ts';
import { MenuLayer } from '/packages/renderer/src/layers/menu/menu-layer.ts';
import { GalleryLayer } from '/packages/renderer/src/layers/gallery/gallery-layer.ts';
import { DialogueLayer } from '/packages/renderer/src/layers/dialogue/dialogue-layer.ts';
import { SystemPanelLayer } from '/packages/renderer/src/layers/system-panel/system-panel-layer.ts';
import { LoadingLayer } from '/packages/renderer/src/loading-layer.ts';
const app = new Application();
await app.init({ width: 1280, height: 720, preference: 'webgl', autoStart: false });
document.body.append(app.canvas);
const results = [];
const contexts = () => Object.values(app.renderer.graphicsContext._managedContexts.items).filter(Boolean).length;
const baseline = contexts();
for (const phase of ['active', 'completed', 'reset']) {
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const layer = new WorldLayer({ width: 1280, height: 720, assets, lifecycle });
  app.stage.addChild(layer.worldContainer, layer.particleContainer, layer.screenContainer, layer.wipeOverlay, layer.fadeOverlay, layer.flashOverlay);
  layer.setBackground('owned-audit-fallback');
  layer.transition('circle', 100); layer.update(50);
  const mask = layer.worldContainer.mask;
  const maskContext = mask.context;
  const overlayContext = layer.fadeOverlay.context;
  app.render();
  const drawn = Boolean(maskContext._gpuData[app.renderer.uid]);
  if (phase === 'completed') layer.update(50);
  if (phase === 'reset') layer.reset();
  const visibleBeforeDispose = Boolean(layer.worldContainer.mask);
  const beforeDispose = contexts();
  layer.dispose(); assets.dispose();
  results.push({ phase, drawn, visibleBeforeDispose, beforeDispose, afterDispose: contexts(), maskDestroyed: mask.destroyed,
    contextDestroyed: maskContext.destroyed, gpuRetained: Boolean(maskContext._gpuData[app.renderer.uid]),
    overlayContextDestroyed: overlayContext.destroyed, lifecycle: lifecycle.snapshot() });
  lifecycle.dispose(); app.render();
}
const uiResults = [];
const assets = new RenderAssetRegistry();
const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
canvas.getContext('2d').fillRect(0, 0, 32, 32);
const texture = assets.getOrCreateBackground('shared-audit', () => Texture.from(canvas));
const frame = { width: 1280, height: 720, assets };
const visit = (node, found = []) => { if (node instanceof Graphics) found.push(node.context); for (const child of node.children) visit(child, found); return found; };
for (const mode of ['menu-title', 'menu-settings', 'menu-save', 'gallery', 'dialogue', 'system-map', 'system-base', 'system-shop', 'system-battle', 'loading']) {
  const root = new Container(); app.stage.addChild(root);
  let layer, draw, clear;
  if (mode.startsWith('menu-')) {
    layer = new MenuLayer({ ...frame, uiLayer: root });
    if (mode === 'menu-title') { draw = () => layer.showTitle({ title: 'Owned title', backgroundKey: 'shared-audit', logoKey: 'shared-audit', items: [{ id: 'start', label: 'Start' }] }, () => {}); clear = () => layer.hideTitle(); }
    if (mode === 'menu-settings') { draw = () => layer.showSettings([{ id: 'masterVolume', label: 'Sound', display: '100%' }], () => {}, () => {}); clear = () => layer.hideSettings(); }
    if (mode === 'menu-save') { draw = () => layer.showSaveLoad({ mode: 'save', slots: [{ id: '1', empty: true }] }, () => {}, () => {}); clear = () => layer.hideSaveLoad(); }
  } else if (mode === 'gallery') {
    layer = new GalleryLayer({ ...frame, uiLayer: root, createBackgroundTexture: () => texture });
    draw = () => layer.showGallery({ cgs: [{ id: 'shared-audit', name: 'Picture', unlocked: true }], music: [] }); clear = () => layer.hideGallery();
  } else if (mode === 'dialogue') {
    layer = new DialogueLayer({ ...frame, uiLayer: root }); layer.mountTextDisplays();
    draw = () => { layer.showText('Owner', 'Retained dialogue.'); layer.showChoices([{ index: 0, label: 'Choice' }]); layer.update(1000); layer.showBacklog([{ speaker: 'Owner', text: 'Retained record.' }]); };
    clear = () => layer.reset();
  } else if (mode === 'loading') {
    layer = new LoadingLayer(1280, 720); root.addChild(layer.container);
    draw = () => layer.show({ total: 2, completed: 1, failed: 0, current: 'owned', done: false }); clear = () => layer.hide();
  } else {
    layer = new SystemPanelLayer({ ...frame, uiLayer: root });
    if (mode === 'system-map') draw = () => layer.showMap({ turn: 1, ap: 3, maxAp: 3, date: '1', nodes: [{ id: 'base', name: 'Base', x: 300, y: 300, apCost: 0, visited: false, enterable: true }] }, () => {}, () => {});
    if (mode === 'system-base') draw = () => layer.showBaseCommands({ date: '1', ap: 3, maxAp: 3, commands: [{ id: 'rest', name: 'Rest', apCost: 1, enabled: true }] }, () => {}, () => {});
    if (mode === 'system-shop') draw = () => layer.showShop({ gold: 100, items: [{ id: 'item', name: 'Item', price: 10 }] }, () => {}, () => {});
    if (mode === 'system-battle') draw = () => layer.showBattle({ turn: 1, actingTeam: 'allies', finished: false, winner: null, units: [] }, { onAttack: () => {}, onPass: () => {} });
    clear = () => layer.reset();
  }
  draw(); app.render();
  const owned = visit(root);
  const rendered = owned.filter(context => Boolean(context._gpuData[app.renderer.uid])).length;
  clear(); draw(); app.render();
  const rebuilt = visit(root);
  if (mode === 'loading') layer.destroy(); else layer.dispose();
  const all = [...new Set([...owned, ...rebuilt])];
  uiResults.push({ mode, rendered, ownedCount: all.length, undisposed: all.filter(context => !context.destroyed).length,
    retainedGpu: all.filter(context => Boolean(context._gpuData[app.renderer.uid])).length, sharedTextureDestroyed: texture.destroyed, activeContexts: contexts() });
  root.destroy({ children: true, context: true });
}
const sharedTexturePreserved = !texture.destroyed && assets.resolveBackground('shared-audit') === texture;
assets.dispose();
window.__worldMaskResult = { version: VERSION, renderer: app.renderer.constructor.name, baseline, results, uiResults, sharedTexturePreserved, finalContexts: contexts() };
app.destroy(true, { children: true, context: true });
</script>`;
fs.writeFileSync(path.join(output, 'index.html'), html);
const probe = createProbe();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const server = await createServer({ root: repo, cacheDir: path.join(output, 'vite-cache'), configFile: false,
  resolve: { alias: { 'pixi.js': path.join(repo, 'node_modules/pixi.js/lib/index.mjs') } },
  plugins: [{ name: 'audit-owned-world-page', configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      if (request.url !== '/audit.html') return next();
      try { response.setHeader('Content-Type', 'text/html'); response.end(await vite.transformIndexHtml('/audit.html', html)); }
      catch (error) { response.statusCode = 500; response.end(String(error)); }
    });
  } }],
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [repo, output] } } });
let browser;
const errors = [];
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR', error.message); });
  page.on('console', message => { if (message.type() === 'error') console.log('CONSOLEERROR', message.text()); });
  await page.goto('http://127.0.0.1:' + port + '/audit.html');
  await page.waitForFunction(() => window.__worldMaskResult || document.body.textContent.includes('failed'), null, { timeout: 30000 });
  const result = await page.evaluate(() => window.__worldMaskResult);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ output, ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const row of result.results) {
    assert.equal(row.drawn, true, 'the mask must have reached the actual WebGL renderer');
    assert.equal(row.maskDestroyed, true, 'World disposal must destroy its private mask');
    assert.equal(row.contextDestroyed, true);
    assert.equal(row.gpuRetained, false);
    assert.equal(row.overlayContextDestroyed, true, 'owned overlay contexts must also be disposed');
  }
  for (const row of result.uiResults) {
    assert(row.rendered > 0 && row.ownedCount > 0);
    assert.equal(row.undisposed, 0, row.mode + ' must destroy all its owned graphics contexts');
    assert.equal(row.retainedGpu, 0);
    assert.equal(row.sharedTextureDestroyed, false, 'layer cleanup must preserve assets owned by the shared registry');
  }
  assert.equal(result.sharedTexturePreserved, true);
  assert.equal(result.finalContexts, result.baseline);
} catch (error) { console.log(JSON.stringify({ output, errors, failure: String(error) })); throw error; }
finally { await browser?.close(); await server.close(); }
