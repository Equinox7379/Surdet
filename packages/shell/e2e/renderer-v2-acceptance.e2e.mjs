/**
 * Renderer v2 deterministic acceptance harness.
 *
 * This is a controlled visual-evidence probe. Every state has a semantic
 * projection assertion and a complete PNG SHA-256 record. Without an
 * approved manifest the result is explicitly CANDIDATE, never visual PASS.
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
const reviewParent = path.join(shellDir, 'e2e', 'artifacts');
const approvedManifestPath = process.env.SURDET_RENDERER_V2_APPROVED_MANIFEST
  ? path.resolve(process.env.SURDET_RENDERER_V2_APPROVED_MANIFEST)
  : path.join(shellDir, 'e2e', 'visual-baselines', 'renderer-v2-approved.json');

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
    const projection = publicDebug?.queries?.diagnostics?.projectionSnapshot?.() ?? null;
    return {
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      assets: publicDebug?.assetLoading ?? null,
      fonts: publicDebug?.fontFamilies ?? null,
      status: publicDebug?.status ?? null,
      rendererStatus: publicDebug?.rendererStatus ?? null,
      position: publicDebug?.position ?? null,
      overlays: {
        menu: publicDebug?.queries?.overlay?.menu?.() ?? null,
        gallery: publicDebug?.queries?.overlay?.gallery?.() ?? null,
        system: publicDebug?.queries?.overlay?.system?.() ?? null,
      },
      projection,
      world: projection?.world ?? null,
      debugBoundary: {
        legacyLayersOnLegacyDebug: Object.prototype.hasOwnProperty.call(debug ?? {}, 'rendererV2Layers'),
        legacyLayersOnPublicDebug: Object.prototype.hasOwnProperty.call(publicDebug ?? {}, 'rendererV2Layers'),
        rendererDebugOnPublicDebug: Object.prototype.hasOwnProperty.call(publicDebug ?? {}, '__rendererV2Debug'),
      },
      backlogEntries: publicDebug?.queries?.dialogue?.backlogEntries?.() ?? [],
      preferences: publicDebug?.queries?.preferences?.presentationPreferences?.() ?? null,
      resources: publicDebug?.queries?.diagnostics?.resourceSnapshot?.() ?? null,
      presentation: publicDebug?.queries?.presentation?.snapshot?.() ?? null,
    };
  });
}

function semanticChecks(name, probe, expectedOverlay) {
  const checks = [];
  const add = (label, ok, actual) => checks.push({ label, ok: Boolean(ok), actual });
  add('debug exposes no legacy Layer references', probe.debugBoundary?.legacyLayersOnLegacyDebug === false
    && probe.debugBoundary?.legacyLayersOnPublicDebug === false
    && probe.debugBoundary?.rendererDebugOnPublicDebug === false, probe.debugBoundary);
  const overlays = [probe.overlays.menu, probe.overlays.gallery, probe.overlays.system];
  const overlayNames = overlays.map(overlayName);
  const actualOverlay = expectedOverlay === undefined
    ? overlayNames.find((value) => value !== 'none') ?? 'none'
    : overlayNames.find((value) => value === expectedOverlay)
      ?? overlayNames.find((value) => value !== 'none')
      ?? 'none';
  if (expectedOverlay !== undefined) add('expected overlay', actualOverlay === expectedOverlay, actualOverlay);
  const dialogue = probe.projection?.dialogue ?? {};
  const menu = probe.projection?.menu ?? {};
  const gallery = probe.projection?.gallery ?? {};
  const system = probe.projection?.system ?? {};
  switch (name) {
    case 'title':
      add('title menu projection', menu.overlay?.type === 'title', menu.overlay?.type);
      add('title item count', menu.titleItemCount > 0, menu.titleItemCount);
      break;
    case 'settings':
      add('settings row count', menu.settingsRowCount > 0, menu.settingsRowCount);
      break;
    case 'settings-command':
      add('settings command row count', menu.settingsRowCount === 2, menu.settingsRowCount);
      break;
    case 'gallery-tabs':
      add('gallery tab query', probe.overlays.gallery?.type === 'gallery', probe.overlays.gallery);
      add('gallery CG count', gallery.cgCount > 0, gallery.cgCount);
      add('gallery music count', gallery.musicCount > 0, gallery.musicCount);
      break;
    case 'gallery-command':
      add('gallery CG count', gallery.cgCount === 1, gallery.cgCount);
      add('gallery music count', gallery.musicCount === 1, gallery.musicCount);
      add('gallery text count', gallery.textCount === 1, gallery.textCount);
      break;
    case 'adv-ruby':
      add('Ruby base projection', dialogue.rubyBaseCount > 0, dialogue.rubyBaseCount);
      add('Ruby text projection', dialogue.rubyTextCount > 0, dialogue.rubyTextCount);
      add('Ruby dialogue projection advanced', dialogue.projectionVersion > 0, dialogue.projectionVersion);
      break;
    case 'narration':
      add('narration speaker is null', dialogue.activeSpeakerId === null, dialogue.activeSpeakerId);
      add('narration text projected', dialogue.dialogText.includes('旁白'), dialogue.dialogText);
      break;
    case 'choice':
      add('two visible choices', dialogue.visibleChoiceCount === 2, dialogue.visibleChoiceCount);
      add('choice labels projected', JSON.stringify(dialogue.choiceLabels) === JSON.stringify(['继续前进', '返回车站']), dialogue.choiceLabels);
      break;
    case 'nvl':
      add('NVL active', dialogue.nvlActive === true, dialogue.nvlActive);
      add('two NVL lines', dialogue.nvlLines.length === 2, dialogue.nvlLines);
      break;
    case 'backlog':
      add('Backlog visible', dialogue.backlogVisible === true, dialogue.backlogVisible);
      add('Backlog has entries', probe.backlogEntries.length > 0, probe.backlogEntries.length);
      break;
    case 'save-load':
      add('save-load slot count', menu.saveLoadSlotCount === 2, menu.saveLoadSlotCount);
      break;
    case 'map':
      add('map node count', system.mapNodeCount === 2, system.mapNodeCount);
      break;
    case 'base':
      add('base command count', system.baseCommandCount === 2, system.baseCommandCount);
      break;
    case 'shop':
      add('shop item count', system.shopItemCount === 2, system.shopItemCount);
      break;
    case 'battle':
      add('battle unit count', system.battleUnitCount === 2, system.battleUnitCount);
      break;
    case 'particle-transition':
      add('snow particle projection', probe.world?.particleKind === 'snow', probe.world?.particleKind);
      add('reduced motion disabled', probe.preferences?.reducedMotion === false, probe.preferences?.reducedMotion);
      break;
    case 'reduced-motion':
      add('reduced motion enabled', probe.preferences?.reducedMotion === true, probe.preferences?.reducedMotion);
      break;
    default:
      throw new Error(`未定义的视觉语义断言：${name}`);
  }
  return { actualOverlay, checks, ok: checks.every((check) => check.ok) };
}

function readApprovedManifest() {
  if (!fs.existsSync(approvedManifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(approvedManifestPath, 'utf8'));
  const states = Array.isArray(parsed.states) ? parsed.states : [];
  return new Map(states.filter((state) => typeof state?.name === 'string' && typeof state?.sha256 === 'string').map((state) => [state.name, state]));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function writeContactSheet(page, results, reviewRoot) {
  const tiles = results.map((result) => {
    const image = fs.readFileSync(result.screenshotPath).toString('base64');
    const checks = result.semanticAssertions.map((check) => `${check.ok ? '✓' : '✗'} ${escapeHtml(check.label)}`).join('<br>');
    return `<figure><img src="data:image/png;base64,${image}" alt="${escapeHtml(result.name)}"><figcaption><strong>${escapeHtml(result.name)}</strong><br>${escapeHtml(result.visualStatus)} · ${result.bytes} B<br>${escapeHtml(result.sha256)}<br>${checks}</figcaption></figure>`;
  }).join('');
  // Electron's BrowserContext does not support context.newPage(). Reuse the
  // already-tested renderer page only after all app assertions are complete;
  // the app is closed immediately after the artifact is written.
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#10131b;color:#eef3ff;font-family:system-ui,sans-serif}main{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:18px}figure{margin:0;background:#1b2230;border:1px solid #44516d;padding:8px}img{display:block;width:100%;height:auto;background:#000}figcaption{font-size:12px;line-height:1.45;padding-top:7px;word-break:break-word}</style><main>${tiles}</main>`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  const contactSheetPath = path.join(reviewRoot, 'contact-sheet.png');
  await page.screenshot({ path: contactSheetPath, fullPage: true, type: 'png' });
  return contactSheetPath;
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

async function captureState(page, reviewRoot, name, expectedOverlay, results, approvedManifest) {
  const imagePath = path.join(reviewRoot, `${name}.png`);
  assertUnder(reviewRoot, imagePath, `${name} 截图`);
  const image = await page.screenshot({ path: imagePath, type: 'png' });
  const probe = await readProbe(page);
  const semantic = semanticChecks(name, probe, expectedOverlay);
  const approved = approvedManifest?.get(name);
  const visualStatus = approved ? (approved.sha256 === sha256(image) ? 'PASS' : 'FAIL') : 'CANDIDATE';
  const ok = image.length > 0 && probe.canvas !== null && semantic.ok && visualStatus !== 'FAIL';
  results.push({
    name,
    ok,
    visualStatus,
    bytes: image.length,
    sha256: sha256(image),
    screenshotPath: path.resolve(imagePath),
    overlay: semantic.actualOverlay,
    semanticAssertions: semantic.checks,
    status: probe.status,
    rendererStatus: probe.rendererStatus,
    resourceSnapshot: probe.resources,
  });
  console.log(`${ok ? visualStatus : 'FAIL'} visual ${name} overlay=${semantic.actualOverlay ?? '-'} sha256=${sha256(image).slice(0, 16)}`);
  if (!ok) {
    throw new Error(`${name} visual probe failed: ${JSON.stringify({ expectedOverlay, semantic, visualStatus, probe })}`);
  }
  return probe;
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-renderer-v2-acceptance-'));
  const userData = path.join(tempRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(reviewParent, { recursive: true });
  const reviewRoot = path.join(reviewParent, `renderer-v2-review-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
  fs.mkdirSync(reviewRoot, { recursive: true });
  assertUnder(os.tmpdir(), tempRoot, '验收临时根目录');
  assertUnder(tempRoot, userData, 'Electron userData');
  assertUnder(reviewParent, reviewRoot, '视觉 review 目录');
  const approvedManifest = readApprovedManifest();

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

    await captureState(page, reviewRoot, 'title', 'title', visualResults, approvedManifest);
    await page.evaluate(() => window.__surdetDebug.titleSelect('settings'));
    await page.waitForTimeout(120);
    await captureState(page, reviewRoot, 'settings', 'settings', visualResults, approvedManifest);
    await page.evaluate(() => window.surdetDebug.showTitleScreen());
    await page.waitForTimeout(120);

    await page.evaluate(() => window.surdetDebug.openGallery());
    await page.waitForTimeout(120);
    await page.evaluate(() => window.surdetDebug.commands.menu.hideTitle());
    await page.waitForTimeout(80);
    await captureState(page, reviewRoot, 'gallery-tabs', 'gallery', visualResults, approvedManifest);
    await page.evaluate(() => window.surdetDebug.showTitleScreen());
    await page.waitForTimeout(120);
    await clearOverlays(page);

    await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
    await page.waitForFunction(() => window.__surdetDebug?.position?.sceneId !== undefined, undefined, { timeout: 15000 });
    await page.waitForFunction(() => window.__surdetDebug?.status !== 'awaiting-timer', undefined, { timeout: 15000 });
    await page.waitForFunction(() => window.__surdetDebug?.rendererStatus !== 'typing', undefined, { timeout: 15000 });
    // The starter scene is the real consumer smoke path; inject the explicit
    // Ruby-bearing text only after it reaches its stable first line so this
    // named visual state proves the Ruby projection itself.
    await page.evaluate(() => {
      const d = window.surdetDebug;
      d.commands.dialogue.setSpeakerProfiles([{ id: 'lynn', name: '凛' }]);
      d.commands.dialogue.showText('凛', '这座城的夜色《よるいろ》还没有散去。');
    });
    await page.waitForTimeout(80);
    await captureState(page, reviewRoot, 'adv-ruby', 'none', visualResults, approvedManifest);

    await clearOverlays(page);
    await projectState(page, 'narration');
    await captureState(page, reviewRoot, 'narration', 'none', visualResults, approvedManifest);
    await clearOverlays(page);
    await projectState(page, 'choice');
    await captureState(page, reviewRoot, 'choice', 'none', visualResults, approvedManifest);
    await clearOverlays(page);
    await projectState(page, 'nvl');
    await captureState(page, reviewRoot, 'nvl', 'none', visualResults, approvedManifest);
    await clearOverlays(page);
    await projectState(page, 'backlog');
    await captureState(page, reviewRoot, 'backlog', 'none', visualResults, approvedManifest);
    await clearOverlays(page);

    await projectState(page, 'settings');
    await captureState(page, reviewRoot, 'settings-command', 'settings', visualResults, approvedManifest);
    await clearOverlays(page);
    await projectState(page, 'save-load');
    await captureState(page, reviewRoot, 'save-load', 'save-load:load', visualResults, approvedManifest);
    await clearOverlays(page);
    await projectState(page, 'gallery');
    await captureState(page, reviewRoot, 'gallery-command', 'gallery', visualResults, approvedManifest);
    await clearOverlays(page);

    for (const systemState of ['map', 'base', 'shop', 'battle']) {
      await projectState(page, systemState);
      await captureState(page, reviewRoot, systemState, systemState, visualResults, approvedManifest);
      await clearOverlays(page);
    }
    await projectState(page, 'particle-transition');
    await captureState(page, reviewRoot, 'particle-transition', 'none', visualResults, approvedManifest);
    await projectState(page, 'reduced-motion');
    await captureState(page, reviewRoot, 'reduced-motion', 'none', visualResults, approvedManifest);
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
    const contactSheetPath = await writeContactSheet(page, visualResults, reviewRoot);
    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      approvedManifestPath: fs.existsSync(approvedManifestPath) ? path.resolve(approvedManifestPath) : null,
      visualStatus: approvedManifest ? 'COMPARED' : 'CANDIDATE',
      contactSheetPath: path.resolve(contactSheetPath),
      states: visualResults,
      errors: { page: pageErrors.length, console: consoleErrors.length, failedRequests: failedRequests.length },
    };
    const manifestPath = path.join(reviewRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ reviewRoot: path.resolve(reviewRoot), manifestPath: path.resolve(manifestPath), contactSheetPath: path.resolve(contactSheetPath), visualResults, finalResources: finalProbe.resources, errors: manifest.errors }, null, 2));
  } finally {
    try {
      if (app) await app.close();
    } finally {
      assertUnder(os.tmpdir(), tempRoot, '验收临时根目录');
      assertUnder(tempRoot, userData, 'Electron userData');
      fs.rmSync(tempRoot, { recursive: true, force: true });
      // Review PNGs/contact sheet intentionally remain for independent review.
      assertUnder(reviewParent, reviewRoot, '视觉 review 目录');
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
