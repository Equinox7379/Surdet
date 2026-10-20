import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createProject } from '../../cli/dist/new.js';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';

// U3 Editor import dialog over real projects and dev servers: project A (the U3 technical theme)
// exports through the designer, projects B and C choose those files, look at a read-only preview,
// stage and really import missing files, confirm once, undo/redo, Save All, reopen and play.
// Every refused path is checked to leave the draft, the files and the asset workbench alone.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const themeDir = path.join(repo, 'docs/ui-theme-u3-technical');
const fontDir = path.join(repo, 'node_modules/@fontsource-variable/noto-serif-sc/files');
const FONT_A = 'noto-serif-sc-97-wght-normal.woff2', FONT_B = 'noto-serif-sc-98-wght-normal.woff2';
const output = process.env.SURDET_U3_DIALOG_E2E_OUTPUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-share-dialog-'));
const shots = path.join(output, 'screens'), shares = path.join(output, 'shares');
fs.mkdirSync(shots, { recursive: true }); fs.mkdirSync(shares, { recursive: true });
const PORTS = { a: 18084, b: 18085, c: 18086 };
const roots = { a: path.join(output, 'project-a'), b: path.join(output, 'project-b'), c: path.join(output, 'project-c') };
const configPath = key => path.join(roots[key], 'game.config.json');
const readConfig = key => JSON.parse(fs.readFileSync(configPath(key), 'utf8'));
const writeConfig = (key, change) => fs.writeFileSync(configPath(key), `${JSON.stringify(change(readConfig(key)), null, 2)}\n`);
const full = { x: 0, y: 0, width: 1280, height: 720 };
const literal = value => ({ kind: 'literal', value });

// ── Fixtures ──
// The committed share file is the only source of the technical theme: project A is rebuilt from
// its config and embedded images, and exporting A again must reproduce the same share.
const committedShareText = fs.readFileSync(path.join(themeDir, 'u3-technical.surdet-ui-theme.json'), 'utf8');
const committedShare = JSON.parse(committedShareText);
const techConfig = committedShare.config;
const techAssetBytes = new Map(committedShare.assets.map(asset => [path.basename(asset.path), Buffer.from(asset.base64, 'base64')]));
const techAssets = [...techAssetBytes.keys()].filter(name => name.endsWith('.png'));
assert(committedShare.assets.every(asset => asset.path.startsWith('content/assets/bg/')) && techAssets.length === 6);
createProject('u3-source-a', { directory: roots.a, template: 'blank', title: 'U3源作品A' });
writeConfig('a', config => ({ ...config, theme: techConfig.theme, player: { ...config.player, ...techConfig.player }, ui: techConfig.ui }));
fs.mkdirSync(path.join(roots.a, 'content/assets/bg'), { recursive: true });
for (const name of techAssets) fs.writeFileSync(path.join(roots.a, 'content/assets/bg', name), techAssetBytes.get(name));

createProject('u3-target-b', { directory: roots.b, template: 'blank', title: 'U3目标B' });
fs.mkdirSync(path.join(roots.b, 'content/assets/fonts'), { recursive: true });
fs.copyFileSync(path.join(fontDir, FONT_B), path.join(roots.b, 'content/assets/fonts', FONT_B));
fs.mkdirSync(path.join(roots.b, 'plugins'), { recursive: true });
fs.writeFileSync(path.join(roots.b, 'plugins/notes.ts'), 'export default () => ({ apiVersion: 1, instructions: { margin_note() {} } });\n');
const B_PLUGINS = [{ id: 'notes', entry: 'plugins/notes.ts', apiVersion: 1, instructions: [{ name: 'margin_note', blocking: false, parameters: [] }] }];
writeConfig('b', config => ({
  ...config, privateMarker: 'KEEP_B', theme: { colors: { accent: 0x884422 }, privateMarker: 'KEEP_THEME' },
  fonts: { body: `content/assets/fonts/${FONT_B}` },
  variables: { gold: { type: 'number', initial: 3 }, met: { type: 'flag', initial: false } },
  player: { ...config.player, subtitle: 'B的副标题' }, plugins: B_PLUGINS,
  ui: { version: 1, pages: {
    title: { id: 'b_title', type: 'container', frame: full, children: [
      { id: 'b_start', type: 'button', frame: { x: 80, y: 560, width: 240, height: 48 }, text: literal('B原开始'), action: { kind: 'start' } },
    ] },
    hud: { id: 'b_hud', type: 'container', frame: full, children: [
      { id: 'b_gold', type: 'text', frame: { x: 40, y: 24, width: 240, height: 40 }, text: { kind: 'variable', name: 'gold' } },
    ] },
  } },
}));

createProject('u3-target-c', { directory: roots.c, template: 'blank', title: 'U3目标C' });
writeConfig('c', config => ({
  ...config, theme: { colors: { accent: 0xcc3355, text: 0xfff4e8 }, radius: { md: 2 } },
  variables: { gold: { type: 'flag', initial: false } },
  ui: { version: 1, pages: { title: { id: 'c_title', type: 'container', frame: full, children: [
    { id: 'c_panel', type: 'container', frame: { x: 680, y: 80, width: 560, height: 560 }, style: { background: 0x2a1820 }, children: [
      { id: 'c_hello', type: 'text', frame: { x: 700, y: 100, width: 400, height: 40 }, text: literal('C原有面板') },
    ] },
    { id: 'c_start', type: 'button', frame: { x: 80, y: 600, width: 240, height: 48 }, text: literal('C开始'), action: { kind: 'start' } },
  ] } } },
}));

const results = { output, steps: [], screens: [], notes: {}, errors: [], consoleErrors: [], httpErrors: [] };
const errors = results.errors;
const step = (name, detail) => { results.steps.push(detail === undefined ? name : { name, ...detail }); console.log(`✓ ${name}`); };
const shot = async (target, name) => { await target.screenshot({ path: path.join(shots, `${name}.png`) }); results.screens.push(name); };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
function tree(dir) {
  const out = {};
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) { if (!['node_modules', '.git'].includes(entry.name)) walk(next); } else out[next] = sha(fs.readFileSync(path.join(dir, next)));
    }
  };
  walk(''); return out;
}
const withoutAssets = (files, prefix = 'content/assets/') => Object.fromEntries(Object.entries(files).filter(([name]) => !name.startsWith(prefix)));
const sortedShare = share => ({ ...share, assets: [...share.assets].sort((x, y) => x.path.localeCompare(y.path)) });
const ids = node => [node.id, ...(node.children ?? []).flatMap(ids)];
const find = (node, id) => node.id === id ? node : (node.children ?? []).map(child => find(child, id)).find(Boolean);

let browser; const servers = [];
async function openEditor(key, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}) });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(`${key}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(`${key}: ${message.text()} @ ${message.location()?.url ?? ''}`); });
  page.on('response', response => { if (response.status() >= 400) results.httpErrors.push(`${key}: ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`); });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge(roots));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: key });
  await page.goto(`http://127.0.0.1:${PORTS[key]}/index.html`);
  await page.locator('[data-action="open-project"]').click();
  await loaded(page);
  await toDesigner(page);
  return page;
}
// Reopen in the same Editor page (as an author would via 打开项目): the dev authority stays bound
// to this page, so later staging and real imports keep working after the reload from disk.
async function reopen(page, key) {
  await page.evaluate(root => window.__surdetE2eSetPickerRoot(root), key);
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.projectLoading, null, { timeout: 5000 }).catch(() => {});
  await loaded(page);
  await page.waitForFunction(() => window.surdetEditorDebug.state.assetImportWorkspace?.entryState === 'ready', null, { timeout: 60000 });
  await toDesigner(page);
}
const loaded = page => page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState === 'ready', null, { timeout: 60000 });
async function toDesigner(page) {
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('[data-config-section-target="ui"]').click();
  await page.locator('[data-ui-designer="true"]').waitFor({ state: 'visible' });
}
const selectNode = async (page, pageId, id) => {
  await page.getByLabel('作品界面页面', { exact: true }).selectOption(pageId);
  await page.locator(`.ui-designer-tree [data-ui-node="${id}"]`).click();
  await page.locator(`[data-ui-style-form="${id}"]`).waitFor();
};
const toolbarButton = (page, name) => page.locator('.ui-designer-toolbar').getByRole('button', { name, exact: true });
async function exportShare(page, name, directory) {
  const [download] = await Promise.all([page.waitForEvent('download'), toolbarButton(page, name).click()]);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, download.suggestedFilename());
  await download.saveAs(file);
  return { file, share: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
const snapshot = page => page.evaluate(async () => {
  const config = await import('/src/panels/config.ts');
  return { ui: config.readUiConfigDraft(), theme: config.readThemeConfigDraft(), dirty: config.inspectConfigDraftState().dirtySections,
    history: config.configHistoryDepth(), staged: (window.surdetEditorDebug.state.assetImportWorkspace?.draftItems ?? []).map(item => item.fileName) };
});
const dialog = page => page.locator('[data-ui-share-import-dialog]');
async function chooseShare(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('[data-ui-share-import]').click()]);
  await chooser.setFiles(file);
  await dialog(page).waitFor();
  return settle(page);
}
const settle = async page => {
  await page.waitForFunction(() => {
    const d = document.querySelector('[data-ui-share-import-dialog]');
    const status = d?.querySelector('.ui-share-import-status')?.textContent ?? '';
    return Boolean(d) && !status.startsWith('正在') && (status.includes('预览已就绪') || Boolean(d.querySelector('[data-ui-share-import-error]')));
  }, null, { timeout: 60000 });
  return dialogInfo(page);
};
const dialogInfo = page => page.evaluate(() => {
  const d = document.querySelector('[data-ui-share-import-dialog]');
  if (!d) return null;
  const apply = d.querySelector('[data-ui-share-import-apply]'), active = document.activeElement;
  const placeholder = d.querySelector('[data-ui-share-import-placeholder]');
  return {
    file: d.querySelector('.ui-share-import-file')?.textContent ?? null,
    status: d.querySelector('.ui-share-import-status')?.textContent ?? null,
    kind: d.querySelector('[data-ui-share-import-kind]')?.dataset.uiShareImportKind ?? null,
    kindText: d.querySelector('[data-ui-share-import-kind] p')?.textContent ?? null,
    pages: Object.fromEntries([...d.querySelectorAll('[data-ui-share-import-page]')].map(item => [item.dataset.uiShareImportPage, item.dataset.change])),
    details: Object.fromEntries([...d.querySelectorAll('[data-ui-share-import-page]')].map(item => [item.dataset.uiShareImportPage, item.innerText])),
    restored: d.querySelector('[data-ui-share-import-restored]')?.dataset.uiShareImportRestored ?? null,
    resources: Object.fromEntries([...d.querySelectorAll('[data-ui-share-import-resource]')].map(item => [item.dataset.uiShareImportResource, item.dataset.state])),
    theme: d.querySelector('.ui-share-import-theme')?.innerText ?? null,
    variables: d.querySelector('.ui-share-import-variables')?.innerText ?? null,
    placements: [...d.querySelectorAll('input[name="ui-share-import-placement"]')].map(radio => `${radio.value}${radio.checked ? '*' : ''}`),
    error: d.querySelector('[data-ui-share-import-error]')?.innerText ?? null,
    apply: { disabled: apply.disabled, title: apply.title },
    stage: d.querySelector('[data-ui-share-import-stage-assets]')?.textContent ?? null,
    views: [...d.querySelectorAll('[data-ui-share-import-view] option')].map(option => option.value),
    view: d.querySelector('[data-ui-share-import-view]')?.value ?? null,
    reduce: d.querySelector('[data-ui-share-import-reduce]')?.checked ?? null,
    placeholder: placeholder && !placeholder.hidden ? placeholder.textContent : null,
    note: d.querySelector('[data-ui-share-import-note]')?.textContent ?? null,
    active: active ? `${active.tagName}${active.dataset?.focusKey ? `:${active.dataset.focusKey}` : ''}` : null,
    activeInside: Boolean(active && d.contains(active)),
  };
});
const prefixOf = info => /import_[0-9a-f]{12}/.exec(info.kindText ?? '')?.[0] ?? null;
async function previewFrame(page) {
  await page.locator('[data-ui-share-import-frame][data-ready="true"]').waitFor({ timeout: 60000 })
    .catch(async error => { console.log('PREVIEW', await page.locator('[data-ui-share-import-dialog]').innerText().catch(() => '')); throw error; });
  return (await page.locator('[data-ui-share-import-frame]').elementHandle()).contentFrame();
}
const shownPage = (frame, pageId) => frame.waitForFunction(id => {
  const element = document.querySelector(`[data-surdet-project-ui] [data-ui-page="${id}"]:not([data-ui-closing])`);
  return Boolean(element) && element.getBoundingClientRect().width > 0;
}, pageId, { timeout: 20000 });
async function showView(page, frame, key, custom = true) {
  await page.locator('[data-ui-share-import-view]').selectOption(key);
  const pageId = key.split(':')[0];
  if (custom) await shownPage(frame, pageId);
  await page.waitForTimeout(450); // the page's own enter transition (≤ 320 ms) settles for the screenshot
}
/** Waits until at least `count` elements paint an image from a temporary (blob) URL, plain or nine-slice. */
const blobImages = async (frame, count) => {
  await frame.waitForFunction(count => [...document.querySelectorAll('[data-surdet-project-ui] *')]
    .filter(element => `${element.style.backgroundImage}${element.style.borderImageSource}`.includes('blob:')).length >= count, count, { timeout: 15000 });
  return true;
};
const decorImages = (frame, id) => frame.evaluate(id => {
  const element = document.querySelector(`[data-surdet-project-ui] [data-ui-page]:not([data-ui-closing]) [data-ui-node="${id}"]`);
  const decor = element?.previousElementSibling?.matches('[data-ui-decor]') ? element.previousElementSibling : null;
  return { state: element?.dataset.uiState ?? null, images: decor ? [...decor.querySelectorAll('*')].map(item => item.style.backgroundImage || item.style.borderImageSource).filter(Boolean).join('|') : '' };
}, id);
/** Records the page root's painted opacity/transform while the preview replays its entrance. */
async function recordMotion(page, frame, action) {
  await frame.evaluate(() => {
    window.__motion = [];
    window.__motionObserver?.disconnect();
    window.__motionObserver = new MutationObserver(records => {
      for (const record of records) {
        const target = record.target;
        if (target.dataset?.uiPage) window.__motion.push({ page: target.dataset.uiPage, opacity: target.style.opacity, transform: target.style.transform });
      }
    });
    window.__motionObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
  });
  await action();
  await page.waitForTimeout(700);
  return frame.evaluate(() => { window.__motionObserver.disconnect(); return window.__motion; });
}
const partial = motion => motion.filter(item => item.opacity !== '' && Number(item.opacity) > 0 && Number(item.opacity) < 1);
async function commitStaged(page, expected) {
  await page.waitForFunction(count => (window.surdetEditorDebug.state.assetImportWorkspace?.draftItems?.length ?? 0) === count, expected.length);
  assert.deepEqual((await snapshot(page)).staged.sort(), [...expected].sort());
  await page.locator('.asset-import-primary:not([disabled])', { hasText: '准备导入' }).waitFor({ timeout: 30000 })
    .catch(async error => { console.log('WORKBENCH', JSON.stringify(await page.evaluate(() => { const w = window.surdetEditorDebug.state.assetImportWorkspace; return { entryState: w?.entryState, message: w?.message, items: w?.draftItems, op: w?.activeOperation?.operation ?? null, dom: document.querySelector('.asset-import-workbench, [data-asset-import-state]')?.textContent?.slice(0, 600) }; })).slice(0, 3000)); throw error; });
  await page.locator('.asset-import-primary', { hasText: '准备导入' }).click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.plan?.status === 'ready', null, { timeout: 60000 })
    .catch(async error => { console.log(JSON.stringify(await page.evaluate(() => window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.plan ?? null)).slice(0, 2000)); throw error; });
  await page.locator('.asset-import-primary', { hasText: '确认导入' }).click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.assetImportWorkspace?.activeOperation?.operation?.status === 'COMMITTED'
    && window.surdetEditorDebug.state.assetImportWorkspace?.message === '导入完成', null, { timeout: 60000 });
}
const statusText = page => page.locator('#status').innerText();
// The node-backed directory bridge finishes the disk write shortly after the Editor reports success,
// so the helper waits for the saved text to reach game.config.json before reading it.
async function saveAll(page, key) {
  const before = fs.readFileSync(configPath(key), 'utf8');
  await page.locator('body').press('Control+S');
  await page.waitForFunction(async () => (await import('/src/panels/config.ts')).inspectConfigDraftState().dirtySections.length === 0 && window.surdetEditorDebug.state.projectWriteLock === null, null, { timeout: 30000 });
  for (const deadline = Date.now() + 10000; fs.readFileSync(configPath(key), 'utf8') === before;) {
    if (Date.now() > deadline) throw new Error(`Save All did not change ${key}/game.config.json`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
async function openPlayer(page, trigger, label) {
  await trigger();
  const iframe = page.locator('.ui-player-preview iframe');
  await iframe.waitFor();
  const player = await (await iframe.elementHandle()).contentFrame();
  await page.waitForFunction(text => document.querySelector('.ui-player-preview-heading span')?.textContent === text, label);
  return player;
}
const playerNode = (player, id) => player.locator(`[data-surdet-project-ui] [data-ui-page]:not([data-ui-closing]) [data-ui-node="${id}"]`);
const visibleIn = (player, pageId, id) => player.waitForFunction(({ pageId, id }) => {
  const element = document.querySelector(`[data-surdet-project-ui] [data-ui-page="${pageId}"]:not([data-ui-closing]) [data-ui-node="${id}"]`);
  return Boolean(element) && element.offsetParent !== null;
}, { pageId, id }, { timeout: 60000 });
const previewKeys = (page, prefix) => page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)), prefix);

try {
  browser = await chromium.launch({ headless: true });
  for (const key of ['a', 'b', 'c']) {
    servers.push(await startDevProject(['--project', roots[key], '--data-root', path.join(output, `authority-${key}`), '--port', String(PORTS[key])], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') }));
  }

  // ── 1. Project A exports the technical theme and a fragment through the designer ──
  let a = await openEditor('a');
  await shot(a, '01-a-designer-title');
  const themeExport = await exportShare(a, '导出作品主题', path.join(shares, 'theme'));
  assert.equal(path.basename(themeExport.file), 'surdet-ui-theme.json');
  assert.deepEqual(sortedShare(themeExport.share), sortedShare(committedShare), 'the committed technical theme is what the Editor exports from project A');
  results.notes.themeExportByteIdentical = fs.readFileSync(themeExport.file, 'utf8') === committedShareText;
  assert.deepEqual(themeExport.share.config.fonts, {}); assert.deepEqual(themeExport.share.variables, {});
  await selectNode(a, 'title', 'u3t_title_frame');
  const fragmentExport = await exportShare(a, '导出所选片段', path.join(shares, 'fragment'));
  assert.equal(fragmentExport.share.kind, 'fragment');
  assert.deepEqual(Object.keys(fragmentExport.share.config.ui.pages), ['title']);
  assert.deepEqual(fragmentExport.share.assets.map(asset => asset.path).sort(),
    ['content/assets/bg/u3tech_button.png', 'content/assets/bg/u3tech_button_hover.png', 'content/assets/bg/u3tech_panel.png']);
  step('A 通过设计器导出完整技术主题（与提交文件一致）和标题按钮组片段', { bytes: results.notes.themeExportByteIdentical });

  // ── 2. Project B: preview, cancel, Player try-out, stage, import, apply, undo/redo, save, reopen, play ──
  let b = await openEditor('b');
  await selectNode(b, 'hud', 'b_gold');
  const hudExport = await exportShare(b, '导出所选片段', path.join(shares, 'hud'));
  assert.deepEqual(hudExport.share.variables, { gold: { type: 'number' } });
  await b.getByLabel('作品界面页面', { exact: true }).selectOption('title');
  const bInitial = await snapshot(b), bConfigBefore = fs.readFileSync(configPath('b'), 'utf8'), bTree = tree(roots.b);
  const bBefore = JSON.parse(bConfigBefore);

  let info = await chooseShare(b, themeExport.file);
  assert.equal(info.kind, 'theme'); assert.equal(info.file, '文件：surdet-ui-theme.json');
  assert.deepEqual(info.pages, { title: 'replace', 'system-menu': 'add', 'save-load': 'add', settings: 'add', gallery: 'add', backlog: 'add',
    dialogue: 'add', choices: 'add', toolbar: 'unchanged', hud: 'remove' });
  assert.equal(info.restored, 'hud');
  assert.match(info.details.hud, /恢复 Player 默认页（2 个组件移出草稿）/);
  assert.deepEqual(info.resources, Object.fromEntries(techAssets.map(name => [`content/assets/bg/${name}`, 'missing'])));
  assert.deepEqual(info.apply, { disabled: true, title: '先导入缺失的图片或字体' });
  assert.equal(info.stage, '加入素材导入（6）');
  assert.match(info.theme, /标题 Logo：本包未设置，应用后不再使用；标题背景：u3tech_title_bg/);
  assert.match(info.theme, /字体：本包不带字体，应用后本作品改用 Player 默认字体/);
  assert.equal(info.active, 'H2', 'the dialog opens with focus on its heading');
  assert.deepEqual(info.views.slice(0, 4), ['title', 'system-menu', 'save-load:save', 'save-load:load']);
  let frame = await previewFrame(b);
  await shownPage(frame, 'title');
  assert.equal(await frame.locator('[data-ui-node="u3t_title_name"]').textContent(), 'U3目标B', 'the preview keeps B\'s title');
  assert.equal(await frame.locator('[data-ui-node="u3t_title_subtitle"]').textContent(), 'B的副标题');
  assert(await blobImages(frame, 3), 'the preview paints the bundled images before they are imported');
  const normalLook = await decorImages(frame, 'u3t_title_load');
  await frame.locator('[data-ui-node="u3t_title_load"]').hover();
  await frame.waitForFunction(() => document.querySelector('[data-ui-node="u3t_title_load"]')?.dataset.uiState?.includes('hover'));
  let hoverLook = await decorImages(frame, 'u3t_title_load');
  for (let tries = 0; tries < 30 && (!hoverLook.images || hoverLook.images === normalLook.images); tries++) { await b.waitForTimeout(100); hoverLook = await decorImages(frame, 'u3t_title_load'); }
  assert(normalLook.images.includes('blob:') && hoverLook.images.includes('blob:'), JSON.stringify({ normalLook, hoverLook }));
  assert.notEqual(hoverLook.images, normalLook.images, 'the hover-only state image is shown on hover');
  await b.mouse.move(5, 5);
  assert.deepEqual(await snapshot(b), bInitial);
  await shot(b, '02-b-dialog-theme');
  const views = { title: '03-preview-title', 'system-menu': '04-preview-system-menu', 'save-load:save': '05-preview-save', 'save-load:load': '06-preview-load',
    settings: '07-preview-settings', gallery: '08-preview-gallery', backlog: '09-preview-backlog', dialogue: '10-preview-dialogue', choices: '11-preview-choices' };
  for (const [key, name] of Object.entries(views)) { await showView(b, frame, key); await shot(b.locator('[data-ui-share-import-screen]'), name); }
  await showView(b, frame, 'hud', false);
  assert.match((await dialogInfo(b)).placeholder, /「剧情信息栏」导入后使用 Player 默认页/);
  await showView(b, frame, 'gallery');
  await b.locator('[data-ui-share-import-empty]').check();
  await frame.waitForFunction(() => document.querySelector('[data-ui-node="u3t_gallery_endings"]')?.textContent === '已收集 0/3 个结局');
  await b.waitForTimeout(300); await shot(b.locator('[data-ui-share-import-screen]'), '12-preview-gallery-empty');
  await b.locator('[data-ui-share-import-empty]').uncheck();
  await frame.waitForFunction(() => document.querySelector('[data-ui-node="u3t_gallery_endings"]')?.textContent === '已收集 2/3 个结局');
  await showView(b, frame, 'system-menu');
  const animated = await recordMotion(b, frame, () => b.getByRole('button', { name: '重播进场', exact: true }).click());
  assert(partial(animated).length > 0, 'the page entrance animates in the preview');
  await b.locator('[data-ui-share-import-reduce]').check();
  const reduced = await recordMotion(b, frame, () => b.getByRole('button', { name: '重播进场', exact: true }).click());
  assert.deepEqual(partial(reduced), [], 'reduced motion shows the page without its entrance');
  await b.locator('[data-ui-share-import-reduce]').uncheck();
  step('B 选择文件后只读预览：影响范围、恢复默认页、缺失素材、悬停状态图、空内容、进场与减少动态', { animatedFrames: partial(animated).length });

  // The real Player with the not yet imported files; it neither imports nor keeps progress.
  const tryOut = await openPlayer(b, () => b.locator('[data-ui-share-import-player]').click(), '导入效果试玩 · 尚未应用，进度和设置不保存');
  await visibleIn(tryOut, 'title', 'u3t_title_start');
  assert.equal(await playerNode(tryOut, 'u3t_title_name').textContent(), 'U3目标B');
  assert(await blobImages(tryOut, 3));
  await b.waitForTimeout(500); await shot(b, '13-b-tryout-player');
  await playerNode(tryOut, 'u3t_title_settings').click();
  await visibleIn(tryOut, 'settings', 'u3t_settings_close');
  await playerNode(tryOut, 'u3t_settings_close').click();
  await visibleIn(tryOut, 'title', 'u3t_title_start');
  await b.getByRole('button', { name: '关闭试玩', exact: true }).click();
  await b.locator('.ui-player-preview').waitFor({ state: 'detached' });
  assert.deepEqual(await previewKeys(b, 'surdet:game:editor-ui-import-preview-'), [], 'the try-out leaves no browser progress or settings');
  assert(await dialog(b).isVisible(), 'closing the try-out returns to the import dialog');
  assert.deepEqual(await snapshot(b), bInitial);
  step('导入前在真实 Player 中试玩：共享包图片仅供试玩、关闭后不留进度或设置，草稿不变');

  // Keyboard: Tab stays inside the modal; a disabled apply does nothing however it is reached.
  const tabTrail = [];
  for (let index = 0; index < 8; index++) { await b.keyboard.press('Tab'); tabTrail.push((await dialogInfo(b)).activeInside); }
  assert(tabTrail.every(Boolean), 'Tab stays in the dialog');
  await b.locator('[data-ui-share-import-apply]').click({ force: true, timeout: 2000 }).catch(() => {});
  await b.evaluate(() => document.querySelector('[data-ui-share-import-apply]').onclick());
  assert.deepEqual(await snapshot(b), bInitial); assert(await dialog(b).isVisible());
  await b.keyboard.press('Escape');
  await dialog(b).waitFor({ state: 'detached' });
  assert.equal(await b.evaluate(() => document.activeElement?.dataset.uiShareImport ?? null), 'true', 'cancel returns focus to the import button');
  assert.deepEqual(await snapshot(b), bInitial); assert.deepEqual(tree(roots.b), bTree);
  assert.equal(await b.locator('[data-ui-share-import-resume]').count(), 0);
  step('键盘焦点：打开聚焦标题、Tab 不离开对话框、禁用的应用不触发、Esc 取消后焦点回到导入按钮，草稿和文件不变');

  // Stage: only the asset workbench's pending list changes; nothing is imported yet.
  info = await chooseShare(b, themeExport.file);
  await b.locator('[data-ui-share-import-stage-assets]').click();
  await dialog(b).waitFor({ state: 'detached' });
  await b.waitForFunction(() => window.surdetEditorDebug.state.mainTab === 'assets');
  const staged = await snapshot(b);
  assert.deepEqual([staged.ui, staged.theme, staged.history], [bInitial.ui, bInitial.theme, bInitial.history]);
  assert.deepEqual(staged.staged.sort(), [...techAssets].sort());
  assert.deepEqual(tree(roots.b), bTree, 'staging writes nothing');
  assert.match(await statusText(b), /已把 6 个缺失文件放入素材导入待选区，尚未导入/);
  await shot(b, '14-b-asset-workbench');
  await commitStaged(b, techAssets);
  for (const name of techAssets) assert.equal(sha(fs.readFileSync(path.join(roots.b, 'content/assets/bg', name))), sha(techAssetBytes.get(name)));
  await b.waitForFunction(() => window.surdetEditorDebug.state.dirAssets.some(asset => asset.key === 'u3tech_title_bg'));
  const bImported = tree(roots.b);
  await toDesigner(b);
  assert.equal(await b.locator('[data-ui-share-import-resume]').textContent(), '继续导入「surdet-ui-theme.json」');
  await b.locator('[data-ui-share-import-resume]').click();
  info = await settle(b);
  assert.deepEqual(info.resources, Object.fromEntries(techAssets.map(name => [`content/assets/bg/${name}`, 'present'])));
  assert.deepEqual(info.apply, { disabled: false, title: '' }); assert.equal(info.stage, null);
  step('加入素材导入只改待选区；在原素材导入工作台真正导入后“继续导入”重新预览，资源齐全');

  // A draft edit while previewing makes the proposal stale; it is refused, not replayed.
  await b.evaluate(async () => (await import('/src/panels/config.ts')).editUiConfigDraft({ type: 'node.update', page: 'title', id: 'b_start', patch: { text: { kind: 'literal', value: '预览期间改动' } } }));
  await b.locator('[data-ui-share-import-apply]').click();
  await b.locator('[data-ui-share-import-error]').waitFor();
  info = await dialogInfo(b);
  assert.match(info.error, /应用被拒绝[\s\S]*未应用，草稿保持原样：[\s\S]*草稿已变化/);
  assert.equal(info.apply.disabled, true); assert.equal(info.active, 'BUTTON:repreview');
  const edited = await snapshot(b);
  assert.equal(find(edited.ui.pages.title, 'b_start').text.value, '预览期间改动'); assert.equal(edited.theme, bInitial.theme);
  assert.equal(edited.history.past, bInitial.history.past + 1);
  await b.evaluate(async () => (await import('/src/panels/config.ts')).configUndo());
  await b.getByRole('button', { name: '重新预览', exact: true }).click();
  info = await settle(b);
  assert.equal(info.error, null); assert.equal(info.apply.disabled, false);
  step('预览期间草稿变化：确认被拒绝且不重放旧方案，草稿保持原样；重新预览后才可确认');

  // Double confirm: one apply, one undo step for theme and UI together.
  await b.locator('[data-ui-share-import-apply]').dblclick();
  await dialog(b).waitFor({ state: 'detached' });
  const applied = await snapshot(b);
  assert.equal(applied.history.past, bInitial.history.past + 1, 'a double click applies once');
  assert.deepEqual(applied.ui, themeExport.share.config.ui);
  const appliedTheme = JSON.parse(applied.theme);
  assert.deepEqual(appliedTheme.theme, themeExport.share.config.theme);
  assert.equal(appliedTheme.titleBackground, 'u3tech_title_bg'); assert.equal(appliedTheme.titleLogo, null); assert.deepEqual(appliedTheme.fonts, {});
  assert.deepEqual(applied.dirty.sort(), ['theme', 'ui']);
  assert.deepEqual(tree(roots.b), bImported, 'apply changes only the draft');
  assert.match(await statusText(b), /完整主题已放入草稿，尚未保存/);
  assert.equal(await b.evaluate(() => document.activeElement?.dataset.uiShareImport ?? null), 'true');
  assert.equal(await b.locator('[data-ui-share-import-resume]').count(), 0, 'the applied import is no longer resumable');
  await shot(b, '15-b-designer-applied');
  await toolbarButton(b, '撤销').click();
  let undone = await snapshot(b);
  assert.deepEqual(undone.ui, bInitial.ui); assert.equal(undone.theme, bInitial.theme);
  await toolbarButton(b, '重做').click();
  assert.deepEqual((await snapshot(b)).ui, applied.ui); assert.equal((await snapshot(b)).theme, applied.theme);
  await toolbarButton(b, '保存界面').click();
  await b.waitForFunction(() => document.getElementById('status')?.textContent?.includes('需要一起保存'));
  assert.equal(fs.readFileSync(configPath('b'), 'utf8'), bConfigBefore, 'saving the UI alone would persist half of the theme');
  await saveAll(b, 'b');
  const savedB = readConfig('b');
  assert.equal(savedB.title, 'U3目标B'); assert.equal(savedB.privateMarker, 'KEEP_B'); assert.equal(savedB.theme.privateMarker, 'KEEP_THEME');
  assert.deepEqual(savedB.variables, bBefore.variables); assert.deepEqual(savedB.plugins, B_PLUGINS);
  assert.deepEqual(savedB.player, { ...bBefore.player, titleBackground: 'u3tech_title_bg' });
  assert.deepEqual(savedB.ui, themeExport.share.config.ui);
  const { privateMarker: _marker, ...savedTheme } = savedB.theme;
  assert.deepEqual(savedTheme, themeExport.share.config.theme);
  results.notes.bFontsAfterTheme = savedB.fonts ?? null;
  assert.deepEqual(withoutAssets(tree(roots.b)), { ...withoutAssets(bTree), 'game.config.json': sha(fs.readFileSync(configPath('b'))) }, 'Save All writes only game.config.json');
  step('确认一次应用（双击只算一次）→ 撤销/重做一起回退主题和界面 → 单独“保存界面”被拒 → 保存全部；B 的标题、变量、玩家设置、插件声明和私有字段保留', { fonts: results.notes.bFontsAfterTheme });

  await reopen(b, 'b');
  const reopened = await snapshot(b);
  assert.deepEqual(reopened.ui, themeExport.share.config.ui); assert.deepEqual(reopened.dirty, []);
  await shot(b, '16-b-reopened-designer');
  const player = await openPlayer(b, () => toolbarButton(b, '试玩草稿').click(), '试玩草稿 · 独立测试进度');
  await visibleIn(player, 'title', 'u3t_title_start');
  assert.equal(await playerNode(player, 'u3t_title_name').textContent(), 'U3目标B');
  await b.waitForTimeout(500); await shot(b, '17-player-title');
  await playerNode(player, 'u3t_title_load').hover();
  await player.waitForFunction(() => document.querySelector('[data-ui-page="title"] [data-ui-node="u3t_title_load"]')?.dataset.uiState?.includes('hover'));
  await b.waitForTimeout(200); await shot(b, '18-player-title-hover');
  for (const [button, pageId, close, name] of [['u3t_title_settings', 'settings', 'u3t_settings_close', '19-player-settings'], ['u3t_title_gallery', 'gallery', 'u3t_gallery_close', '20-player-gallery'], ['u3t_title_load', 'save-load', 'u3t_saveload_close', '21-player-load']]) {
    await playerNode(player, button).click();
    await visibleIn(player, pageId, close);
    await b.waitForTimeout(500); await shot(b, name);
    await playerNode(player, close).click();
    await visibleIn(player, 'title', 'u3t_title_start');
  }
  await playerNode(player, 'u3t_title_start').click();
  await player.waitForFunction(() => document.querySelector('[data-ui-page="dialogue"] [data-ui-node="u3t_dialogue_body"]')?.textContent?.includes('在这里写下你的第一句故事'), null, { timeout: 30000 });
  await b.waitForTimeout(500); await shot(b, '22-player-dialogue');
  await b.getByRole('button', { name: '关闭试玩', exact: true }).click();
  await b.locator('.ui-player-preview').waitFor({ state: 'detached' });
  step('重新打开一致；真实 Player 中标题、悬停、设置、鉴赏、读档、对白可操作');

  // ── 3. Same theme with a font: unchanged pages, present images, one missing font ──
  writeConfig('a', config => ({ ...config, fonts: { ui: `content/assets/fonts/${FONT_A}` } }));
  fs.mkdirSync(path.join(roots.a, 'content/assets/fonts'), { recursive: true });
  fs.copyFileSync(path.join(fontDir, FONT_A), path.join(roots.a, 'content/assets/fonts', FONT_A));
  await reopen(a, 'a');
  const fontExport = await exportShare(a, '导出作品主题', path.join(shares, 'theme-font'));
  assert.deepEqual(fontExport.share.config.fonts, { ui: `content/assets/fonts/${FONT_A}` });
  info = await chooseShare(b, fontExport.file);
  assert(Object.values(info.pages).every(change => change === 'unchanged'), JSON.stringify(info.pages));
  assert.deepEqual(info.resources, { ...Object.fromEntries(techAssets.map(name => [`content/assets/bg/${name}`, 'present'])), [`content/assets/fonts/${FONT_A}`]: 'missing' });
  assert.match(info.theme, new RegExp(`字体（替换本作品的字体设置）：界面 content/assets/fonts/${FONT_A}`));
  frame = await previewFrame(b);
  await b.waitForTimeout(300);
  assert.doesNotMatch((await dialogInfo(b)).note, /无法加载/);
  await b.locator('[data-ui-share-import-stage-assets]').click();
  await dialog(b).waitFor({ state: 'detached' });
  await commitStaged(b, [FONT_A]);
  assert(fs.existsSync(path.join(roots.b, 'content/assets/fonts', FONT_A)));
  await toDesigner(b);
  await b.locator('[data-ui-share-import-resume]').click();
  info = await settle(b);
  assert.equal(info.resources[`content/assets/fonts/${FONT_A}`], 'present');
  await b.locator('[data-ui-share-import-apply]').click();
  await dialog(b).waitFor({ state: 'detached' });
  await saveAll(b, 'b');
  assert.deepEqual(readConfig('b').fonts, { ui: `content/assets/fonts/${FONT_A}` });
  assert.deepEqual(readConfig('b').ui, themeExport.share.config.ui);
  step('带字体的主题：页面不变、图片已存在、缺失字体经素材导入后应用并保存');

  // ── 4. Project C: fragment placements, unique ids, C's own theme ──
  let c = await openEditor('c');
  const cInitial = await snapshot(c), cTree = tree(roots.c);
  await selectNode(c, 'title', 'c_panel');
  info = await chooseShare(c, fragmentExport.file);
  const prefix = prefixOf(info);
  assert(prefix, info.kindText);
  assert.equal(info.kind, 'fragment'); assert.match(info.kindText, /沿用本作品现有主题与字体/);
  assert.deepEqual(info.placements, ['container*', 'root', 'replace']);
  assert.deepEqual(info.pages.title, 'insert'); assert.match(info.details.title, /到所选容器/);
  assert.deepEqual(Object.values(info.resources), ['missing', 'missing', 'missing']);
  frame = await previewFrame(c);
  await shownPage(frame, 'title');
  assert.equal(await frame.locator(`[data-ui-node="${prefix}_u3t_title_frame"]`).count(), 1);
  assert.equal(await frame.locator('[data-ui-node="c_hello"]').count(), 1);
  await c.waitForTimeout(450); await shot(c, '23-c-dialog-fragment');
  await c.locator('input[name="ui-share-import-placement"][value="root"]').check();
  info = await settle(c);
  assert.deepEqual(info.placements, ['container', 'root*', 'replace']); assert.match(info.details.title, /到页面根组件/); assert.equal(prefixOf(info), prefix);
  await c.locator('input[name="ui-share-import-placement"][value="container"]').check();
  info = await settle(c);
  await c.locator('[data-ui-share-import-stage-assets]').click();
  await dialog(c).waitFor({ state: 'detached' });
  await commitStaged(c, ['u3tech_button.png', 'u3tech_button_hover.png', 'u3tech_panel.png']);
  await c.waitForFunction(() => window.surdetEditorDebug.state.dirAssets.some(asset => asset.key === 'u3tech_button_hover'));
  await toDesigner(c);
  await c.locator('[data-ui-share-import-resume]').click();
  info = await settle(c);
  assert.equal(prefixOf(info), prefix, 'continuing keeps the previewed component ids'); assert.deepEqual(info.placements, ['container*', 'root', 'replace']);
  await c.locator('[data-ui-share-import-apply]').focus();
  await c.keyboard.press('Enter');
  await dialog(c).waitFor({ state: 'detached' });
  let cDraft = await snapshot(c);
  const panel = find(cDraft.ui.pages.title, 'c_panel');
  assert.equal(panel.children.at(-1).id, `${prefix}_u3t_title_frame`);
  assert(ids(panel.children.at(-1)).every(id => id.startsWith(`${prefix}_`)));
  assert.equal(cDraft.theme, cInitial.theme, 'a fragment keeps C\'s theme and fonts');
  assert.equal(cDraft.history.past, cInitial.history.past + 1);
  await c.locator(`[data-ui-style-form="${prefix}_u3t_title_frame"]`).waitFor();
  info = await chooseShare(c, fragmentExport.file);
  const prefix2 = prefixOf(info);
  assert.notEqual(prefix2, prefix);
  await c.locator('input[name="ui-share-import-placement"][value="root"]').check();
  info = await settle(c);
  assert.deepEqual(Object.values(info.resources), ['present', 'present', 'present']);
  await c.locator('[data-ui-share-import-apply]').click();
  await dialog(c).waitFor({ state: 'detached' });
  cDraft = await snapshot(c);
  assert.equal(cDraft.ui.pages.title.children.at(-1).id, `${prefix2}_u3t_title_frame`);
  const allIds = ids(cDraft.ui.pages.title);
  assert.equal(new Set(allIds).size, allIds.length, 'two imports of one fragment never repeat an id');
  info = await chooseShare(c, fragmentExport.file);
  await c.locator('input[name="ui-share-import-placement"][value="replace"]').check();
  info = await settle(c);
  assert.equal(info.pages.title, 'replace');
  assert.match(info.details.title, new RegExp(`替换自定义页：移除 ${allIds.length} 个组件，加入 ${ids(fragmentExport.share.config.ui.pages.title).length} 个组件`));
  await c.getByRole('button', { name: '取消', exact: true }).click();
  await dialog(c).waitFor({ state: 'detached' });
  assert.deepEqual((await snapshot(c)).ui, cDraft.ui);
  await shot(c, '24-c-designer-fragments');
  await toolbarButton(c, '撤销').click(); await toolbarButton(c, '撤销').click();
  assert.deepEqual((await snapshot(c)).ui, cInitial.ui);
  await toolbarButton(c, '重做').click(); await toolbarButton(c, '重做').click();
  assert.deepEqual((await snapshot(c)).ui, cDraft.ui);
  await saveAll(c, 'c');
  const savedC = readConfig('c');
  assert.deepEqual(savedC.ui, cDraft.ui); assert.deepEqual(savedC.theme, JSON.parse(JSON.stringify(readConfig('c').theme)));
  assert.deepEqual(savedC.theme, { colors: { accent: 0xcc3355, text: 0xfff4e8 }, radius: { md: 2 } });
  assert.deepEqual(savedC.variables, { gold: { type: 'flag', initial: false } });
  const cPlayer = await openPlayer(c, () => toolbarButton(c, '试玩草稿').click(), '试玩草稿 · 独立测试进度');
  await visibleIn(cPlayer, 'title', `${prefix}_u3t_title_load`);
  await playerNode(cPlayer, `${prefix2}_u3t_title_load`).hover();
  await cPlayer.waitForFunction(id => document.querySelector(`[data-ui-node="${id}"]`)?.dataset.uiState?.includes('hover'), `${prefix2}_u3t_title_load`);
  await c.waitForTimeout(400); await shot(c, '25-c-player-fragments');
  await c.getByRole('button', { name: '关闭试玩', exact: true }).click();
  await c.locator('.ui-player-preview').waitFor({ state: 'detached' });
  assert.deepEqual(await previewKeys(c, 'surdet:game:editor-ui-preview-'), []);
  step('片段：插入所选容器/页面根组件/替换整页可选，前缀在预览、继续导入和应用中一致，两次导入组件标识不重复，沿用 C 主题；撤销重做、保存、Player 试玩', { prefix, prefix2 });

  // ── 5. Refusals in C: nothing reaches the draft, the files or the workbench ──
  const cBase = await snapshot(c), cBaseTree = tree(roots.c);
  const refuse = async (label, file, pattern) => {
    const refused = await chooseShare(c, file);
    assert.match(refused.error ?? '', pattern, `${label}: ${refused.error}`);
    assert.equal(refused.apply.disabled, true, label);
    await shot(c, `26-refused-${label}`);
    await c.keyboard.press('Escape'); await dialog(c).waitFor({ state: 'detached' });
    assert.deepEqual(await snapshot(c), cBase, label); assert.deepEqual(tree(roots.c), cBaseTree, label);
    return refused.error;
  };
  const writeShare = (name, value) => { const file = path.join(shares, 'refused', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  const refusals = {};
  refusals.typeMismatch = await refuse('variable-type', hudExport.file, /gold/);
  refusals.invalidJson = await refuse('invalid-json', writeShare('broken.json', '{"format":"surdet-ui",'), /无法预览/);
  refusals.wrongFormat = await refuse('wrong-format', writeShare('other.json', { format: 'other', version: 1 }), /无法预览/);
  const nested = structuredClone(fragmentExport.share);
  nested.config.ui.pages.title.children[0].transition = { enter: { durationMs: 120, opacity: 0 } };
  refusals.nestedTransition = await refuse('illegal-fragment', writeShare('nested-transition.json', nested), /无法预览/);
  const conflicting = structuredClone(fragmentExport.share);
  // Same-named image with different bytes; u3tech_dialog.png still fits the panel's nine-slice cuts.
  conflicting.assets.find(asset => asset.path.endsWith('u3tech_panel.png')).base64 = techAssetBytes.get('u3tech_dialog.png').toString('base64');
  refusals.conflict = await refuse('asset-conflict', writeShare('conflict.json', conflicting), /冲突/);
  const aMissing = await chooseShare(a, hudExport.file);
  assert.match(aMissing.error ?? '', /gold/); refusals.variableMissing = aMissing.error;
  await a.keyboard.press('Escape'); await dialog(a).waitFor({ state: 'detached' });
  results.notes.refusals = refusals;

  // A file that changes after the preview is re-read at confirmation and refused.
  info = await chooseShare(c, fragmentExport.file);
  assert.equal(info.apply.disabled, false);
  const panelPath = path.join(roots.c, 'content/assets/bg/u3tech_panel.png'), panelBytes = fs.readFileSync(panelPath);
  fs.writeFileSync(panelPath, techAssetBytes.get('u3tech_dialog.png'));
  await c.locator('[data-ui-share-import-apply]').click();
  await c.locator('[data-ui-share-import-error]').waitFor();
  assert.match((await dialogInfo(c)).error, /应用被拒绝[\s\S]*冲突/);
  fs.writeFileSync(panelPath, panelBytes);
  assert.deepEqual(await snapshot(c), cBase);
  await c.getByRole('button', { name: '重新预览', exact: true }).click();
  info = await settle(c); assert.equal(info.apply.disabled, false);
  // Choosing another file inside the dialog replaces the preview (new prefix); the refused one stays gone.
  const [otherChooser] = await Promise.all([c.waitForEvent('filechooser'), c.getByRole('button', { name: '选择其他文件…', exact: true }).click()]);
  await otherChooser.setFiles(writeShare('broken-again.json', '[1,'));
  info = await settle(c);
  assert.equal(info.file, '文件：broken-again.json'); assert.match(info.error, /无法预览/); assert.equal(info.apply.disabled, true);
  const [againChooser] = await Promise.all([c.waitForEvent('filechooser'), c.getByRole('button', { name: '选择其他文件…', exact: true }).click()]);
  await againChooser.setFiles(fragmentExport.file);
  info = await settle(c);
  assert.equal(info.file, '文件：surdet-ui-fragment.json'); assert.equal(info.error, null); assert.equal(info.apply.disabled, false);
  // The project closes while the dialog is open: the dialog goes away and nothing is applied.
  await c.evaluate(() => { window.__surdetE2eSetPickerRoot('c'); document.querySelector('[data-action="open-project"]').click(); });
  await dialog(c).waitFor({ state: 'detached' });
  await loaded(c);
  assert.equal(await c.evaluate(async () => (await import('/src/ui-share-import-dialog.ts')).isUiShareImportDialogOpen()), false);
  await toDesigner(c);
  assert.deepEqual((await snapshot(c)).ui, cBase.ui); assert.deepEqual(tree(roots.c), cBaseTree);
  step('拒绝路径：变量类型不符/缺失、无效 JSON、错误格式、非法片段、素材冲突、预览后素材变化均不写草稿/文件/待选区；对话框内换文件以新预览为准；关闭项目时对话框消失', refusals);

  // ── 6. System reduced motion; staging that is abandoned ──
  // Only one page may hold the project workspace; close C first so its heartbeat is not revoked mid-run.
  await c.close();
  const r = await openEditor('c', { reducedMotion: 'reduce' });
  info = await chooseShare(r, themeExport.file);
  assert.equal(info.reduce, true, 'the preview follows the system reduced-motion setting');
  frame = await previewFrame(r);
  await showView(r, frame, 'system-menu');
  const systemReduced = await recordMotion(r, frame, () => r.getByRole('button', { name: '重播进场', exact: true }).click());
  assert.deepEqual(partial(systemReduced), []);
  await r.locator('[data-ui-share-import-stage-assets]').click();
  await dialog(r).waitFor({ state: 'detached' });
  const abandoned = (await snapshot(r)).staged;
  await toDesigner(r);
  await r.locator('[data-ui-share-import-discard]').click();
  assert.equal(await r.locator('[data-ui-share-import-resume]').count(), 0);
  assert.equal(await r.evaluate(() => document.activeElement?.dataset.uiShareImport ?? null), 'true');
  assert.deepEqual((await snapshot(r)).staged, abandoned, 'abandoning the import leaves the workbench list alone');
  assert.deepEqual(tree(roots.c), cBaseTree);
  await r.close();
  step('系统减少动态时预览默认不播放进场；放弃继续导入只移除入口，不动素材待选区与文件', { abandoned });

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, steps: results.steps.length, notes: results.notes, consoleErrors: results.consoleErrors.length }, null, 2));
} catch (error) {
  results.failure = String(error.stack ?? error);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, errors, failure: results.failure }, null, 2));
  throw error;
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
}
