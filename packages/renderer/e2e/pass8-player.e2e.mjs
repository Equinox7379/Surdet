import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer as createPortProbe } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { FileSaveStore, canonicalSlotStem } from '../../shell/dist/save-store.js';

// Actual Starter entry/Interpreter/RendererRuntime/Host with an isolated FileSaveStore bridge.
// Only the selected scenario and theme input are replaced in the served test module;
// no example source, original game data, native dialog, or browser profile is modified.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.resolve(process.env.SURDET_PASS8_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-pass8-')));
await fs.mkdir(output, { recursive: true });
const saveDir = await fs.mkdtemp(path.join(output, 'saves-'));
const extensionDir = await fs.mkdtemp(path.join(output, 'zoom-extension-'));
const browserProfile = await fs.mkdtemp(path.join(output, 'browser-profile-'));
await fs.writeFile(path.join(extensionDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Surdet isolated browser zoom test', version: '1.0', permissions: ['tabs'], background: { service_worker: 'zoom.js' } }));
await fs.writeFile(path.join(extensionDir, 'zoom.js'), 'chrome.runtime.onInstalled.addListener(() => {}); setInterval(() => chrome.runtime.getPlatformInfo(), 20000);');
const saves = new FileSaveStore(saveDir);
let writes = 0;
const scenario = await fs.readFile(new URL('./fixtures/pass8.gal', import.meta.url), 'utf8');
const systemsScenario = await fs.readFile(new URL('./fixtures/pass8-systems.gal', import.meta.url), 'utf8');
const battleScenario = await fs.readFile(new URL('./fixtures/pass8-battle.gal', import.meta.url), 'utf8');
const baseScenario = '@scene ch01_01\n@label start\n@calendar map_01\n@end';
const longBaseConfig = JSON.parse(await fs.readFile(path.join(root, 'examples/starter/content/config/calendar.json'), 'utf8'));
longBaseConfig.baseCommands = Array.from({ length: 15 }, (_, index) => ({
  id: `audit_${index + 1}`, name: `审计指令${index + 1}`, apCost: 1, effects: { 'lynn.trust': 1 },
}));
const longScenario = `@scene ch01_01\n@label start\n@bg post_office\n旁白：${'长篇中文。'.repeat(120)}\n@nvl on\n旁白：${'全文阅读。'.repeat(120)}\n@end`;
const errors = [];
// Vite treats port: 0 as its default 5173, which Windows may reserve.
const portProbe = createPortProbe();
await new Promise((resolve, reject) => {
  portProbe.once('error', reject);
  portProbe.listen(0, '127.0.0.1', resolve);
});
const port = portProbe.address().port;
await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
const server = await createServer({
  root: path.join(root, 'examples/starter'),
  cacheDir: path.join(output, '.vite'),
  configFile: false,
  build: { assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'pass8-controlled-project-input', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // The isolated browser's optional favicon probe is not a game asset.
        if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
        next();
      });
    },
    transform(code, id) {
      const file = id.replaceAll('\\', '/').split('?')[0];
      if (file.endsWith('/examples/starter/src/scene-hmr-boundary.ts')) {
        return code.replace('export const sceneFiles =', 'const originalScenes =')
          + `\nconst mode = new URLSearchParams(location.search).get('system-test');\nexport const sceneFiles = new URLSearchParams(location.search).has('fixture') || mode ? {'../content/scenario/ch01_01.gal': async () => mode === 'long' ? ${JSON.stringify(longScenario)} : mode === 'battle' ? ${JSON.stringify(battleScenario)} : mode === 'base-long' ? ${JSON.stringify(baseScenario)} : mode ? ${JSON.stringify(systemsScenario)} : ${JSON.stringify(scenario)}} : originalScenes;`;
      }
      if (file.endsWith('/examples/starter/src/main.ts')) {
        assert(code.includes('theme: PROJECT_THEME'));
        assert(code.includes("import calendar from '../content/config/calendar.json';"));
        return code.replace('theme: PROJECT_THEME', "theme: new URLSearchParams(location.search).has('project-theme') ? { colors: { accent: 0xda9146, panel: 0x22202b }, typography: { bodySize: 32, titleSize: 44 } } : PROJECT_THEME")
          .replace("import calendar from '../content/config/calendar.json';", `import defaultCalendar from '../content/config/calendar.json';\nconst calendar = new URLSearchParams(location.search).get('system-test') === 'base-long' ? ${JSON.stringify(longBaseConfig)} : defaultCalendar;`);
      }
    },
  }],
});
let browser;
let page;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  // A fresh test-only profile permits the real chrome.tabs.setZoom API. No personal browser is touched.
  const context = await chromium.launchPersistentContext(browserProfile, { channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`] });
  browser = context;
  // Standalone Playwright has no test-runner deadline. Keep CI failures bounded and diagnostic.
  context.setDefaultTimeout(60_000);
  context.setDefaultNavigationTimeout(60_000);
  const zoomWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await context.exposeBinding('__pass8Save', async (_source, operation, ...args) => {
    assert(['read', 'write', 'delete', 'list', 'listMeta', 'listBackupMeta', 'restoreBackup'].includes(operation));
    if (operation === 'write') writes++;
    return saves[operation](...args);
  });
  await context.addInitScript(() => {
    window.surdetSave = Object.fromEntries(['read', 'write', 'delete', 'list', 'listMeta', 'listBackupMeta', 'restoreBackup']
      .map((name) => [name, (...args) => window.__pass8Save(name, ...args)]));
    window.__pass8Gamepads = [];
    window.__pass8GamepadReads = 0;
    Object.defineProperty(navigator, 'getGamepads', { value: () => { window.__pass8GamepadReads++; return window.__pass8Gamepads; } });
  });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()}${message.location().url ? ` [${message.location().url}]` : ''}`); });
  await page.goto(`${url}?fixture`);
  await page.waitForFunction(() => window.__surdetDebug?.uiSession.base === 'title');
  await page.getByRole('button', { name: '开始游戏', exact: true }).waitFor();
  const activate = async (name) => {
    // Pixi redraws may replace/pool accessibility nodes. Wait for the named live projection.
    await page.waitForFunction((name) => Array.from(document.querySelectorAll('button')).some((button) => {
      const target = button.container;
      if (button.getAttribute('aria-label') !== name || !target?.parent || target.destroyed || target.accessibleHint !== name) return false;
      for (let node = target; node; node = node.parent) if (!node.visible || node.destroyed) return false;
      return true;
    }), name);
    await page.getByRole('button', { name, exact: true }).focus();
    await page.keyboard.press('Enter');
  };
  const state = () => page.evaluate(() => ({ position: window.__surdetDebug.position, session: window.__surdetDebug.sessionId, dialogue: window.__surdetDebug.dialogueProjection, ui: window.__surdetDebug.uiSession }));
  const overlay = (name) => page.waitForFunction((expected) => window.__surdetDebug.uiSession.overlay === expected, name);
  const openMenu = async () => { if ((await state()).ui.overlay !== 'system-menu') await page.keyboard.press('Escape'); await overlay('system-menu'); };
  const canvasText = (message) => page.waitForFunction((message) => {
    let root = Array.from(document.querySelectorAll('button')).find((button) => button.container?.parent)?.container;
    if (!root) return false;
    while (root.parent) root = root.parent;
    const contains = (node) => String(node.text ?? '').includes(message) || node.children?.some(contains);
    return contains(root);
  }, message);
  const advanceUntil = async (predicate, budget = 10) => {
    for (let i = 0; i < budget; i++) {
      if (await page.evaluate(predicate)) return;
      // End keyboard focus on an optional command-rail button before using story shortcuts.
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.keyboard.press('Space');
      await page.waitForTimeout(60);
    }
    await page.waitForFunction(predicate, null, { timeout: 4000 });
  };
  // Keyboard activation uses Pixi's existing accessibility projection, not a debug action.
  await page.getByRole('button', { name: '开始游戏', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__surdetDebug?.dialogueProjection?.dialogText.includes('真实阅读路径'));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__surdetDebug?.dialogueProjection?.dialogText.includes('保持清楚'));
  const first = await state();
  const sceneThumbnail = await page.evaluate(() => window.__surdetDebug.queries.world.captureThumbnail());
  await page.screenshot({ path: path.join(output, '01-reading.png') });
  await openMenu();
  await page.keyboard.press('x');
  await page.keyboard.press('F5');
  assert.deepEqual((await state()).position, first.position, 'menu must contain story and quick-save keys');
  assert.equal(writes, 0);
  await activate('存档'); await overlay('save-load');
  await activate('保存到槽位 1：空槽位'); await overlay('none');
  assert.equal(writes, 1);
  const savedA = saves.read('1');
  assert.deepEqual(savedA.position, first.position);
  assert(sceneThumbnail && savedA.meta.thumbnail === sceneThumbnail, 'saving must not capture the save-menu overlay in the scene thumbnail');
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.includes('那一句'));
  const second = await state();
  assert.notDeepEqual(second.position, first.position);
  await openMenu(); await activate('存档'); await overlay('save-load');
  const slotName = await page.getByRole('button', { name: /^保存到槽位 1：/ }).getAttribute('aria-label');
  await activate(slotName);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '取消');
  await page.keyboard.press('Escape');
  assert.equal(writes, 1, 'cancel overwrite makes zero storage writes');
  assert.deepEqual(saves.read('1').position, first.position);
  await page.waitForFunction(() => {
    const card = Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label')?.startsWith('保存到槽位 1：'))?.container;
    return card?.children?.some(child => child.texture?.source?.resource instanceof HTMLImageElement && child.texture.source.resource.complete && child.texture.source.resource.naturalWidth > 0);
  });
  const thumbnail = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('button')).find(button => button.getAttribute('aria-label')?.startsWith('保存到槽位 1：'))?.container;
    const sprite = card?.children?.find(child => child.texture?.source?.resource instanceof HTMLImageElement);
    return sprite ? { width: sprite.width, height: sprite.height } : null;
  });
  assert(thumbnail && thumbnail.width === 128 && thumbnail.height === 72, 'saved thumbnail must occupy its 128 x 72 card area after loading');
  await page.screenshot({ path: path.join(output, '03-save-load.png') });
  await activate(slotName); await activate('覆盖存档'); await overlay('none');
  assert.equal(writes, 2);
  const savedB = saves.read('1');
  assert.deepEqual(savedB.position, second.position);
  assert.equal(saves.listBackupMeta().length, 1);

  await advanceUntil(() => window.__surdetDebug.rendererStatus === 'choice');
  assert.equal((await state()).dialogue.choiceLabels.length, 2, 'unavailable Core branch stays filtered');
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(output, '01-reading.png') });
  const option = page.getByRole('button', { name: '接受邀请，继续阅读', exact: true });
  const bounds = await option.boundingBox(); assert(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.includes('信任是 3'));
  await openMenu(); await activate('读档'); await overlay('save-load');
  await activate(await page.getByRole('button', { name: /^读取槽位 1：/ }).getAttribute('aria-label'));
  await overlay('none');
  assert.deepEqual((await state()).position, savedB.position, 'original interpreter restores the saved position');
  assert.equal((await state()).session, first.session, 'menu/load do not construct another runtime');
  await advanceUntil(() => window.__surdetDebug.rendererStatus === 'choice');
  const pad = async (button) => {
    const reads = await page.evaluate((pressed) => {
      window.__pass8Gamepads = [{ id: 'Pass8 simulated standard pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === pressed, touched: i === pressed, value: i === pressed ? 1 : 0 })), timestamp: performance.now() }];
      return window.__pass8GamepadReads;
    }, button);
    await page.waitForFunction(reads => window.__pass8GamepadReads > reads, reads);
  };
  // The original controller starts at -1: Down -> first, Down -> second, Up -> first.
  await pad(13); await pad(-1); await pad(13); await pad(-1); await pad(12); await pad(-1); await pad(0); await pad(-1);
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.includes('信任是 3'));
  console.log('PASS pointer and simulated GamepadPoller choose the same original branch; actual file save/cancel/overwrite/load');

  await advanceUntil(() => window.__surdetDebug.dialogueProjection.nvlActive && window.__surdetDebug.dialogueProjection.nvlLines.length > 0);
  assert((await state()).dialogue.nvlLines.some((line) => line.replaceAll('\n', '').includes('真实 NVL 模式')));
  await openMenu(); await activate('返回游戏'); await overlay('none');
  assert.equal((await state()).dialogue.nvlActive, true);
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.includes('普通对白'));
  assert.equal((await state()).dialogue.nvlActive, false);

  await openMenu(); await activate('设置'); await overlay('settings');
  await activate('声音设置');
  await activate('减小主音量');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('surdet:game:surdet-starter:settings') ?? '{}').masterVolume === 0.9);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '减小主音量');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('surdet:game:surdet-starter:settings') ?? '{}').masterVolume === 1);
  await page.screenshot({ path: path.join(output, '02-settings.png') });
  const settingsState = await state();
  await page.mouse.wheel(0, 300);
  await page.keyboard.press('x');
  assert.deepEqual((await state()).position, settingsState.position);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay !== 'settings');
  assert.equal((await state()).session, first.session);
  console.log('PASS real NVL/ADV mode, menu isolation, settings stepper and focus restoration');
  if ((await state()).ui.overlay === 'system-menu') await activate('返回游戏');
  await overlay('none');
  await page.getByRole('button', { name: '自动播放', exact: true }).focus();
  await page.keyboard.press('F5');
  await page.waitForFunction(() => window.__surdetDebug.uiSession.operation === 'idle');
  assert.equal(writes, 3, 'original quick-save shortcut still works with command-rail focus');

  await openMenu(); await activate('文字记录');
  await page.waitForFunction(() => window.__surdetDebug.dialogueProjection.backlogVisible);
  const beforeBacklog = (await state()).position;
  await page.keyboard.press('Control+f');
  await page.keyboard.type('NVL');
  await page.waitForFunction(() => window.__surdetDebug.dialogueProjection.backlogLayout.searchVisible);
  await page.keyboard.press('PageDown');
  assert.deepEqual((await state()).position, beforeBacklog);
  // Preserve the existing three-step contract: clear query, blur search, close backlog.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__surdetDebug.dialogueProjection.backlogVisible);
  await overlay('none');
  await page.keyboard.press('l'); await overlay('backlog');
  await activate('返回正文'); await overlay('none');
  await openMenu(); await activate('鉴赏'); await overlay('gallery');
  const locked = page.getByRole('button', { name: '未解锁的图片（不可用）', exact: true }).first();
  assert.equal(await locked.getAttribute('aria-disabled'), 'true');
  const lockedBox = await locked.boundingBox(); assert(lockedBox);
  await page.mouse.click(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2);
  assert.equal(await page.evaluate(() => window.__surdetDebug.queries.overlay.gallery().mode), 'grid');
  await activate('查看 雾港清晨');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.gallery().mode === 'viewer');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.gallery().mode === 'grid');
  await activate('音乐');
  assert.equal(await page.evaluate(() => window.__surdetDebug.queries.overlay.gallery().tab), 'music');
  await activate('关闭');
  await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay !== 'gallery');
  console.log('PASS original backlog search/escape and real gallery unlock/view/return; no music rows are fabricated');

  for (const viewport of [{ width: 1280, height: 720 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(viewport);
    await openMenu(); await activate('设置'); await overlay('settings');
    for (const button of await page.getByRole('button').all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      assert(box.x >= -2 && box.y >= -2 && box.x + box.width <= viewport.width + 2 && box.y + box.height <= viewport.height + 2, `setting hit target outside ${viewport.width}x${viewport.height}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay !== 'settings');
  }
  console.log('PASS actual menu/settings at 1440x900, 1280x720 and 800x600');

  const file = path.join(saveDir, `${canonicalSlotStem('1')}.json`);
  const originalSave = await fs.readFile(file);
  const beforeFailure = (await state()).position;
  assert.deepEqual(errors, []);
  try {
    await fs.writeFile(file, '{controlled invalid snapshot');
    await openMenu(); await activate('读档');
    await canvasText('存档列表读取失败');
    assert.equal((await state()).ui.overlay, 'none', 'invalid metadata is not projected as empty slots');
    assert.deepEqual((await state()).position, beforeFailure);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^\[starter\] 存档列表读取失败:/);
    await fs.writeFile(file, originalSave);
    await openMenu(); await activate('读档'); await overlay('save-load');
    // A real file change between listing and selecting exercises the read transaction separately.
    await fs.writeFile(file, '{controlled invalid snapshot');
    await activate(await page.getByRole('button', { name: /^读取槽位 1：/ }).getAttribute('aria-label'));
    await page.waitForFunction(() => window.__surdetDebug.uiSession.operation === 'idle');
    await page.waitForFunction(() => {
      let root = document.querySelector('button[aria-label^="读取槽位 1："]')?.container;
      if (!root) return false;
      while (root.parent) root = root.parent;
      const contains = (node) => String(node.text ?? '').includes('读取未完成') || node.children?.some(contains);
      return contains(root);
    });
    assert.deepEqual((await state()).position, beforeFailure, 'corrupt read must not reset the real interpreter');
    assert.equal((await state()).ui.overlay, 'save-load');
    assert.equal(errors.length, 3);
    assert.match(errors[1], /^\[starter\] player shell operation failed:/);
    assert.match(errors[2], /^\[starter\] 读档失败:/);
    console.log('PASS controlled corrupt listing and read fail visibly; real interpreter remains unchanged');
    await activate('关闭存读档');
  } finally { await fs.writeFile(file, originalSave); }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${url}?fixture&project-theme`);
  await page.waitForFunction(() => window.__surdetDebug?.uiSession.base === 'title');
  const customTheme = await page.evaluate(() => window.__surdetDebug.queries.preferences.theme());
  assert.equal(customTheme.colors.accent, 0xda9146);
  assert.equal(customTheme.colors.panel, 0x22202b);
  assert.equal(customTheme.typography.bodySize, 32);
  await activate('开始游戏');
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.includes('保持清楚'));
  const projected = await page.evaluate(() => {
    let root = document.querySelector('button[aria-label="打开设置"]')?.container;
    if (!root) throw new Error('actual command rail is missing');
    while (root.parent) root = root.parent;
    const visit = (node) => String(node.text ?? '').includes('真实阅读路径') ? node.style.fontSize : node.children?.map(visit).find(Boolean);
    return { bodySize: visit(root), colors: window.__surdetDebug.queries.diagnostics.projectionSnapshot().themeProjection.dialogue.visibleGraphicsColors };
  });
  assert.equal(projected.bodySize, 32);
  assert(projected.colors.includes(0x22202b));
  await advanceUntil(() => window.__surdetDebug.rendererStatus === 'choice');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.includes('信任是 3'));
  await openMenu(); await activate('设置'); await overlay('settings');
  const actualZoom = await zoomWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url?.startsWith(url));
    if (!tab) throw new Error('test player tab missing');
    await chrome.tabs.setZoom(tab.id, 2);
    return chrome.tabs.getZoom(tab.id);
  }, url);
  assert.equal(actualZoom, 2);
  await page.waitForFunction(() => window.innerWidth === 720 && window.devicePixelRatio === 2);
  await activate('声音设置'); await activate('减小主音量');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('surdet:game:surdet-starter:settings') ?? '{}').masterVolume === 0.9);
  for (const button of await page.getByRole('button').all()) {
    const box = await button.boundingBox(); if (!box) continue;
    assert(box.x >= -2 && box.y >= -2 && box.x + box.width <= 722 && box.y + box.height <= 452, '200% zoom control outside CSS viewport');
  }
  await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__surdetDebug.uiSession.overlay !== 'settings');
  await openMenu(); await activate('返回游戏'); await overlay('none');
  console.log('PASS project theme applied to actual text/panels, keyboard branch parity, and genuine Chromium 200% browser zoom');
  await zoomWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((item) => item.url?.startsWith(url));
    await chrome.tabs.setZoom(tab.id, 1);
  }, url);
  await page.goto(`${url}?system-test=shop-map`);
  await page.waitForFunction(() => window.__surdetDebug?.uiSession.base === 'title');
  await activate('开始游戏');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'shop');
  await activate('购买 回复药'); await canvasText('金币：70');
  await activate('购买 铁剑'); await canvasText('金币：10');
  const unavailable = page.getByRole('button', { name: '回复药：金币不足（不可用）', exact: true });
  assert.equal(await unavailable.getAttribute('aria-disabled'), 'true');
  const unavailableBox = await unavailable.boundingBox(); assert(unavailableBox);
  await page.mouse.click(unavailableBox.x + 10, unavailableBox.y + 10);
  await canvasText('金币：10');
  await activate('离开商店');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
  await activate('进入 旧邮局');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'base');
  await activate('执行 喝一杯热茶');
  await canvasText('执行了「喝一杯热茶」。');
  await activate('返回地图');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${url}?system-test=base-long`);
    await page.waitForFunction(() => window.__surdetDebug?.uiSession.base === 'title');
    await activate('开始游戏');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
    await activate('进入 旧邮局');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'base');
    const last = page.getByRole('button', { name: '执行 审计指令15', exact: true });
    await page.mouse.move(viewport.width / 2, viewport.height / 2); await page.mouse.wheel(0, 4000);
    for (let step = 0; step < 18 && await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) !== '执行 审计指令15'; step++) {
      await page.keyboard.press('ArrowDown');
    }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '执行 审计指令15');
    await page.waitForFunction(() => {
      const button = document.querySelector('button[aria-label="执行 审计指令15"]');
      const target = button?.container;
      if (!target?.parent || target.destroyed || target.accessibleHint !== '执行 审计指令15') return false;
      const bounds = target.getBounds();
      if (bounds.y < 104 || bounds.y + bounds.height > 604) return false;
      // Focus reveals the Pixi row immediately; its DOM rectangle follows at postrender.
      // Wait for that projection too, otherwise the real mouse can click the old row position.
      const hit = target.hitArea;
      const point = target.toGlobal({ x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 });
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      const box = button.getBoundingClientRect();
      return box.width > 0 && box.height > 0
        && Math.abs(box.x + box.width / 2 - (canvas.x + point.x / 1280 * canvas.width)) < 1
        && Math.abs(box.y + box.height / 2 - (canvas.y + point.y / 720 * canvas.height)) < 1;
    });
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'command focus must reveal inside the canvas without scrolling the document');
    const box = await last.boundingBox(); assert(box && box.y >= 0 && box.y + box.height <= viewport.height);
    if (viewport.width === 1440) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    else await page.keyboard.press('Enter');
    await canvasText('执行了「审计指令15」。');
    await page.screenshot({ path: path.join(output, `base-long-${viewport.width}.png`) });
    await activate('返回地图');
    await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'map');
  }
  console.log('PASS long base command list remains in the real canvas; last command executes by pointer and keyboard at two viewports');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${url}?system-test=battle`);
  await page.waitForFunction(() => window.__surdetDebug?.uiSession.base === 'title');
  await activate('开始游戏');
  await page.waitForFunction(() => window.__surdetDebug.queries.overlay.system().type === 'battle');
  // Exercise the real beforeunload path while the enemy's delayed action is
  // pending. A slow destination must not leave callbacks targeting a disposed runtime.
  const longUrl = `${url}?system-test=long`;
  await page.route(longUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await route.continue();
  });
  await page.waitForFunction((destination) => {
    // System overlay state can precede Pixi's next accessibility update.
    // Capture the live battle control's canvas only after its DOM projection is ready.
    let root = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '跳过行动'
      && button.container?.parent && !button.container.destroyed && button.container.accessibleHint === '跳过行动')?.container;
    if (!root) return false;
    while (root.parent) root = root.parent;
    // The pass message lasts only until the 650ms enemy timer. Observe the real
    // native click's rendered result and navigate in that event, before a CI round trip.
    window.addEventListener('click', (event) => {
      const contains = (node) => String(node.text ?? '').includes('跳过本次行动') || node.children?.some(contains);
      if (!event.isTrusted || !contains(root)) return;
      console.info('PASS8_BATTLE_SKIP_OBSERVED');
      window.location.assign(destination);
    }, { once: true });
    return true;
  }, longUrl);
  try {
    await Promise.all([
      page.waitForEvent('console', { predicate: (message) => message.text() === 'PASS8_BATTLE_SKIP_OBSERVED' }),
      page.waitForURL(longUrl),
      activate('跳过行动'),
    ]);
  } finally { await page.unroute(longUrl); }
  console.log('PASS real Host system routes: purchase/disabled purchase, map/base action/return, battle pass and pending-action navigation');
  await page.waitForFunction(() => window.__surdetDebug?.uiSession.base === 'title');
  await activate('开始游戏');
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.dialogText.length > 500);
  const longPosition = (await state()).position;
  await page.mouse.move(720, 650); await page.mouse.wheel(0, 3000);
  const scrolled = (prefix) => page.waitForFunction((prefix) => {
    let root = Array.from(document.querySelectorAll('button')).find((button) => button.container?.parent)?.container;
    if (!root) return false;
    while (root.parent) root = root.parent;
    const visit = (node) => String(node.text ?? '').startsWith(prefix) ? node.y < 0 : node.children?.some(visit);
    return visit(root);
  }, prefix);
  await scrolled('长篇中文');
  assert.deepEqual((await state()).position, longPosition);
  await advanceUntil(() => window.__surdetDebug.dialogueProjection.nvlActive);
  const nvlPosition = (await state()).position;
  await page.mouse.move(720, 650); await page.mouse.wheel(0, 3000);
  await scrolled('旁白：全文阅读');
  assert.deepEqual((await state()).position, nvlPosition);
  console.log('PASS oversized ADV/NVL text remains scrollable without advancing the original interpreter');
  assert.equal(errors.length, 3, 'only the expected listing error and two reports of the induced read failure occurred');
  console.log(`PASS actual Starter title -> original runtime / output=${output} / writes=${writes}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.error('PAGE', await page.locator('body').innerText().catch(() => 'unavailable'));
    console.error('STATE', await page.evaluate(() => ({ position: window.__surdetDebug?.position, dialogue: window.__surdetDebug?.dialogueProjection, ui: window.__surdetDebug?.uiSession, focused: document.activeElement?.getAttribute('aria-label') })).catch(() => 'unavailable'));
    console.error('ERRORS', errors);
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
  for (const directory of [extensionDir, browserProfile]) {
    if (!path.resolve(directory).startsWith(path.resolve(output) + path.sep)) throw new Error('test cleanup outside output');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
