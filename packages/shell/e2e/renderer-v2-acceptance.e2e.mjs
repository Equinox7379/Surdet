/**
 * Renderer v2 deterministic acceptance harness.
 *
 * This is deliberately a probe, not a visual golden-image test: the renderer
 * uses generated placeholder art in the starter, so each state is recorded by
 * a fresh screenshot hash plus its public overlay/resource/query state. The
 * actual Layer visual contracts remain covered by the Renderer suites.
 */
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const readyTimeout = 120000;

function assertUnder(parent, candidate, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须位于 ${path.resolve(parent)} 下：${path.resolve(candidate)}`);
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function overlayName(overlay) {
  if (!overlay) return 'unknown';
  if (overlay.type === 'save-load') return `save-load:${overlay.mode}`;
  return overlay.type;
}

async function readProbe(page) {
  return page.evaluate(() => {
    const debug = window.surdetDebug;
    const publicDebug = window.__surdetDebug;
    const canvas = document.querySelector('canvas');
    return {
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      assets: publicDebug?.assetLoading ?? null,
      fonts: publicDebug?.fontFamilies ?? null,
      status: publicDebug?.status ?? null,
      rendererStatus: publicDebug?.rendererStatus ?? null,
      position: publicDebug?.position ?? null,
      overlays: {
        menu: debug?.queries?.overlay?.menu?.() ?? null,
        gallery: debug?.queries?.overlay?.gallery?.() ?? null,
        system: debug?.queries?.overlay?.system?.() ?? null,
      },
      resources: debug?.queries?.diagnostics?.resourceSnapshot?.() ?? null,
      presentation: debug?.queries?.presentation?.snapshot?.() ?? null,
    };
  });
}

async function clearOverlays(page) {
  await page.evaluate(() => {
    const d = window.surdetDebug;
    d.commands.menu.hideTitle();
    d.commands.menu.hideEnding();
    d.commands.menu.hideSystemMenu();
    d.commands.menu.hideSettings();
    d.commands.menu.hideSaveLoad();
    d.commands.gallery.hideGallery();
    d.commands.system.hideBattle();
    d.commands.system.hideMap();
    d.commands.system.hideShop();
    d.commands.system.hideBaseCommands();
    d.commands.dialogue.hideChoices();
    d.commands.dialogue.hideBacklog();
    d.commands.dialogue.setNvlMode(false);
    d.commands.dialogue.clearNvlText();
  });
  await page.waitForTimeout(80);
}

async function projectState(page, state) {
  await page.evaluate((name) => {
    const d = window.surdetDebug;
    const noop = () => undefined;
    if (name === 'dialogue') {
      d.commands.dialogue.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
      d.commands.dialogue.showText('凛', '这座城的夜色《よるいろ》还没有散去。');
    } else if (name === 'narration') {
      d.commands.dialogue.showText(null, '旁白：风从旧车站的方向吹来。');
    } else if (name === 'choice') {
      d.commands.dialogue.showChoices([
        { index: 0, label: '继续前进' },
        { index: 1, label: '返回车站' },
      ]);
    } else if (name === 'nvl') {
      d.commands.dialogue.setNvlMode(true);
      d.commands.dialogue.appendNvlText('凛', '第一行回忆。');
      d.commands.dialogue.appendNvlText(null, '第二行旁白。');
    } else if (name === 'backlog') {
      d.commands.dialogue.showText('凛', '已记录的文本。');
      d.commands.dialogue.showBacklog(d.queries.dialogue.backlogEntries(), noop, '记录');
    } else if (name === 'settings') {
      d.commands.menu.showSettings(
        [{ id: 'textSpeedCps', label: '文本速度', display: '24' }, { id: 'masterVolume', label: '主音量', display: '100%' }],
        noop,
        noop,
      );
    } else if (name === 'save-load') {
      d.commands.menu.showSaveLoad(
        { mode: 'load', slots: [{ id: '1', empty: false, label: '第一行', updatedAt: Date.now(), kind: 'manual' }, { id: '2', empty: true, kind: 'manual' }] },
        noop,
        noop,
      );
    } else if (name === 'gallery') {
      d.commands.gallery.showGallery({
        cgs: [{ id: 'cg_hall', name: '大厅', unlocked: true }],
        music: [{ id: 'tense_01', name: '紧张', unlocked: false }],
        texts: [{ id: 't_first', name: '第一次相遇', unlocked: true, scene: 'ch01_01', label: 'start' }],
        onPlayMusic: noop,
        onReplayText: noop,
        onClose: noop,
      });
    } else if (name === 'map') {
      d.commands.system.showMap(
        { turn: 1, ap: 2, maxAp: 3, date: '第1月 第1周', nodes: [{ id: 'base', name: '据点', x: 140, y: 420, enterable: true, visited: true, apCost: 0 }, { id: 'town', name: '城镇', x: 620, y: 300, enterable: true, visited: false, apCost: 1 }] },
        noop,
        noop,
      );
    } else if (name === 'base') {
      d.commands.system.showBaseCommands(
        { ap: 2, maxAp: 3, date: '第1月 第1周', commands: [{ id: 'rest', name: '休息', apCost: 1, enabled: true, remaining: null }, { id: 'train', name: '特训', apCost: 2, enabled: true, remaining: 1 }] },
        noop,
        noop,
      );
    } else if (name === 'shop') {
      d.commands.system.showShop(
        { gold: 100, items: [{ id: 'potion', name: '回复药', price: 30 }, { id: 'iron_sword', name: '铁剑', price: 60 }], message: '欢迎光临！' },
        noop,
        noop,
      );
    } else if (name === 'battle') {
      d.commands.system.showBattle(
        {
          turn: 1,
          actingTeam: 'allies',
          finished: false,
          winner: null,
          units: [
            { uid: 'sword', name: '剑士', team: 'allies', hp: 20, maxHp: 20, hpRatio: 1, alive: true, skills: [], canMove: true },
            { uid: 'goblin', name: '哥布林', team: 'enemies', hp: 10, maxHp: 10, hpRatio: 1, alive: true, skills: [], canMove: false },
          ],
        },
        { onAttack: noop, onPass: noop, onMove: noop },
        '点击敌方单位发起攻击',
      );
    } else if (name === 'particle-transition') {
      d.commands.preferences.setPresentationPreferences({ reducedMotion: false });
      d.commands.world.startParticles('snow');
      d.commands.world.setTint(0x334455, 0.2, 120);
      d.commands.world.transition('fade', 120);
    } else if (name === 'reduced-motion') {
      d.commands.preferences.setPresentationPreferences({ reducedMotion: true });
      d.commands.world.transition('fade', 120);
      d.commands.world.clearTint(120);
    }
  }, state);
  await page.waitForTimeout(120);
}

async function captureState(page, tempRoot, name, expectedOverlay, results) {
  const imagePath = path.join(tempRoot, `${name}.png`);
  assertUnder(tempRoot, imagePath, `${name} 截图`);
  const image = await page.screenshot({ path: imagePath, type: 'png' });
  const probe = await readProbe(page);
  const overlays = [
    overlayName(probe.overlays.menu),
    overlayName(probe.overlays.gallery),
    overlayName(probe.overlays.system),
  ];
  const actualOverlay = expectedOverlay !== undefined && overlays.includes(expectedOverlay)
    ? expectedOverlay
    : overlays.find((value) => value !== 'none') ?? 'none';
  const overlayOk = expectedOverlay === undefined || actualOverlay === expectedOverlay;
  const ok = image.length > 0 && probe.canvas !== null && overlayOk;
  results.push({
    name,
    ok,
    bytes: image.length,
    sha256: sha256(image),
    overlay: actualOverlay,
    status: probe.status,
    rendererStatus: probe.rendererStatus,
    resourceSnapshot: probe.resources,
  });
  console.log(`${ok ? 'PASS' : 'FAIL'} visual ${name} overlay=${actualOverlay ?? '-'} sha256=${sha256(image).slice(0, 16)}`);
  if (!ok) {
    throw new Error(`${name} visual probe failed: ${JSON.stringify({ actualOverlay, expectedOverlay, probe })}`);
  }
  return probe;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v2-acceptance-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, '验收临时根目录');
  assertUnder(tempRoot, userData, 'Electron userData');

  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const visualResults = [];
  let app = null;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellDir });
    const page = await app.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error instanceof Error ? error.stack ?? error.message : String(error)));
    page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim()));
    await page.waitForFunction(() => window.surdetDebug?.runtime !== undefined, undefined, { timeout: readyTimeout });
    await page.waitForFunction(() => {
      const progress = window.__surdetDebug?.assetLoading;
      return progress?.done === true && progress.total > 0 && progress.completed === progress.total && progress.failed === 0;
    }, undefined, { timeout: readyTimeout });

    const ready = await readProbe(page);
    if (!ready.canvas || !ready.fonts || Object.values(ready.fonts).some((family) => typeof family !== 'string' || family.length === 0)) {
      throw new Error(`Renderer v2 ready probe failed: ${JSON.stringify(ready)}`);
    }
    console.log(`PASS ready assets=${ready.assets.completed}/${ready.assets.total} failed=${ready.assets.failed} fonts=${JSON.stringify(ready.fonts)}`);

    await captureState(page, tempRoot, 'title', 'title', visualResults);
    await page.evaluate(() => window.__surdetDebug.titleSelect('settings'));
    await page.waitForTimeout(120);
    await captureState(page, tempRoot, 'settings', 'settings', visualResults);
    await page.evaluate(() => window.surdetDebug.showTitleScreen());
    await page.waitForTimeout(120);

    await page.evaluate(() => window.surdetDebug.openGallery());
    await page.waitForTimeout(120);
    await page.evaluate(() => window.surdetDebug.commands.menu.hideTitle());
    await page.waitForTimeout(80);
    await captureState(page, tempRoot, 'gallery-tabs', 'gallery', visualResults);
    await page.evaluate(() => window.surdetDebug.showTitleScreen());
    await page.waitForTimeout(120);
    await clearOverlays(page);

    await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
    await page.waitForFunction(() => window.__surdetDebug?.position?.sceneId !== undefined, undefined, { timeout: 15000 });
    await page.waitForFunction(() => window.__surdetDebug?.status !== 'awaiting-timer', undefined, { timeout: 15000 });
    await captureState(page, tempRoot, 'adv-ruby', undefined, visualResults);

    await clearOverlays(page);
    await projectState(page, 'narration');
    await captureState(page, tempRoot, 'narration', undefined, visualResults);
    await clearOverlays(page);
    await projectState(page, 'choice');
    await captureState(page, tempRoot, 'choice', undefined, visualResults);
    await clearOverlays(page);
    await projectState(page, 'nvl');
    await captureState(page, tempRoot, 'nvl', undefined, visualResults);
    await clearOverlays(page);
    await projectState(page, 'backlog');
    await captureState(page, tempRoot, 'backlog', undefined, visualResults);
    await clearOverlays(page);

    await projectState(page, 'settings');
    await captureState(page, tempRoot, 'settings-command', 'settings', visualResults);
    await clearOverlays(page);
    await projectState(page, 'save-load');
    await captureState(page, tempRoot, 'save-load', 'save-load:load', visualResults);
    await clearOverlays(page);
    await projectState(page, 'gallery');
    await captureState(page, tempRoot, 'gallery-command', 'gallery', visualResults);
    await clearOverlays(page);

    for (const systemState of ['map', 'base', 'shop', 'battle']) {
      await projectState(page, systemState);
      await captureState(page, tempRoot, systemState, systemState, visualResults);
      await clearOverlays(page);
    }
    await projectState(page, 'particle-transition');
    await captureState(page, tempRoot, 'particle-transition', undefined, visualResults);
    await projectState(page, 'reduced-motion');
    await captureState(page, tempRoot, 'reduced-motion', undefined, visualResults);
    await clearOverlays(page);

    const seed = await page.evaluate(() => {
      const d = window.surdetDebug;
      const before = { interpreter: d.interp.status, renderer: d.renderer.status, position: d.interp.position };
      if (d.interp.status === 'awaiting-advance') d.interp.advance();
      return { before, after: { interpreter: d.interp.status, renderer: d.renderer.status, position: d.interp.position } };
    });
    await page.waitForTimeout(80);
    console.log(`INFO rollback seed ${JSON.stringify(seed)}`);
    const boundary = await page.evaluate(async () => window.__surdetDebug.systemBoundaryProbe());
    if (!boundary.opened || !boundary.hadRollback || !boundary.rollbackBlocked) {
      throw new Error(`system boundary probe failed: ${JSON.stringify(boundary)}`);
    }
    console.log(`PASS system boundary rollback cleared: ${JSON.stringify(boundary)}`);

    const finalProbe = await readProbe(page);
    if (finalProbe.resources?.disposed !== false) throw new Error(`runtime unexpectedly disposed before close: ${JSON.stringify(finalProbe.resources)}`);
    if (pageErrors.length > 0 || consoleErrors.length > 0 || failedRequests.length > 0) {
      throw new Error(`runtime errors: ${JSON.stringify({ pageErrors, consoleErrors, failedRequests })}`);
    }
    console.log(JSON.stringify({ visualResults, finalResources: finalProbe.resources, errors: { page: pageErrors.length, console: consoleErrors.length, failedRequests: failedRequests.length } }, null, 2));
  } finally {
    try {
      if (app) await app.close();
    } finally {
      assertUnder(os.tmpdir(), tempRoot, '验收临时根目录');
      assertUnder(tempRoot, userData, 'Electron userData');
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
