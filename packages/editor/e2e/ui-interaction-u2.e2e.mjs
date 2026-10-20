import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { createStageFixture } from './support/stage-fixture.mjs';

// U2 in the real Editor: interaction states and page enter/exit edited in the designer → Authoring draft → undo/redo →
// save → reopen, the canvas state preview and the one-off motion preview, then the same draft in the designer's own
// Player preview window (real shared Player, real mouse and keyboard), with and without reduced motion.
const output = process.env.SURDET_U2_E2E_OUTPUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-interaction-u2-'));
fs.mkdirSync(output, { recursive: true });
const PORT = 18082;

const frame = (x, y, width, height) => ({ x, y, width, height });
const literal = value => ({ kind: 'literal', value });
const line = { width: 2, color: 0x335577, opacity: 1 };
const MENU_ENTER = { durationMs: 600, opacity: 0, y: 40, easing: 'linear' };
const MENU_EXIT = { durationMs: 600, opacity: 0, easing: 'linear' };
const ui = { version: 1, pages: {
  title: { id: 'title_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'btn_start', type: 'button', frame: frame(80, 120, 300, 56), text: literal('开始'), action: { kind: 'start' }, style: { background: 0xffffff, color: 0x223344 },
      states: { hover: { background: 0xcc3333, color: 0xffffff }, pressed: { background: 0x3333cc, color: 0xffffff } } },
    { id: 'btn_locked', type: 'button', frame: frame(80, 200, 300, 56), text: literal('未解锁'), action: { kind: 'start' }, enabledWhen: 'ready == true', style: { background: 0xffffff },
      states: { disabled: { background: 0x888888, opacity: 0.8 } } },
    { id: 'btn_plain', type: 'button', frame: frame(80, 280, 300, 56), text: literal('设计器按钮'), action: { kind: 'start' }, style: { background: 0xffffff, border: line, color: 0x223344 } },
    { id: 'title_note', type: 'text', frame: frame(80, 380, 500, 30), text: literal('U2 集成核验'), style: { fontSize: 16 } },
  ] },
  dialogue: { id: 'dialogue_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'body', type: 'text', frame: frame(120, 540, 1040, 120), text: { kind: 'data', field: 'dialogue' }, style: { fontSize: 26 } },
    { id: 'btn_menu', type: 'button', frame: frame(1100, 24, 140, 48), text: literal('菜单'), action: { kind: 'open', page: 'system-menu' }, style: { background: 0xffffff, color: 0x223344 },
      states: { hover: { background: 0x33aa55 } } },
  ] },
  'system-menu': { id: 'menu_root', type: 'container', frame: frame(0, 0, 1280, 720), transition: { enter: MENU_ENTER, exit: MENU_EXIT }, children: [
    { id: 'menu_title', type: 'text', frame: frame(480, 200, 320, 60), text: literal('暂停菜单'), style: { fontSize: 32 } },
    { id: 'menu_close', type: 'button', frame: frame(480, 300, 320, 56), text: literal('返回游戏'), action: { kind: 'close' }, style: { background: 0xffffff, color: 0x223344 } },
    { id: 'menu_restart', type: 'button', frame: frame(480, 400, 320, 56), text: literal('重新开始'), action: { kind: 'start' }, style: { background: 0xffffff, color: 0x223344 } },
  ] },
} };

const fixture = createStageFixture(path.join(output, 'project'));
const configPath = path.join(fixture.root, 'game.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
Object.assign(config, { privateAuditMarker: 'KEEP_UI_SOURCE', variables: { ready: { type: 'flag', initial: false } }, ui });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
fs.writeFileSync(path.join(fixture.root, 'content/scenario/start.gal'), '@scene start\n@stage dock\n凛：第一句话。\n凛：第二句话。\n凛：第三句话。\n凛：第四句话。\n凛：第五句话。\n');

const PLAIN_STATES = { hover: { background: 0xff0000 }, pressed: { color: 0x112233 }, disabled: { opacity: 0.5 } };
const MENU_TRANSITION = { enter: MENU_ENTER, exit: { ...MENU_EXIT, durationMs: 500 } };
const results = { output, steps: [] }, errors = [];
const log = (step, value) => { results.steps.push({ step, ...value }); };
const findIn = (root, id) => root.id === id ? root : root.children?.map(child => findIn(child, id)).find(Boolean);
let server, browser;

async function openDesigner(page) {
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: fixture.root }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState === 'ready');
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('[data-config-section-target="ui"]').click();
  await page.locator('[data-ui-designer="true"]').waitFor({ state: 'visible' });
}
const draftNode = (page, pageId, id) => page.evaluate(async ({ pageId, id }) => {
  const config = await import('/src/panels/config.ts');
  const find = node => node.id === id ? node : node.children?.map(find).find(Boolean);
  const node = find(config.readUiConfigDraft().pages[pageId]);
  return { node: JSON.parse(JSON.stringify(node)), dirty: config.inspectConfigDraftState(), history: config.configHistoryDepth() };
}, { pageId, id });
const selectNode = async (page, pageId, id) => {
  await page.getByLabel('作品界面页面', { exact: true }).selectOption(pageId);
  await page.locator(`.ui-designer-tree [data-ui-node="${id}"]`).click();
  await page.locator(`[data-ui-style-form="${id}"]`).waitFor();
};
const openGroup = async (page, group) => {
  const details = page.locator(`[data-ui-style-group="${group}"]`);
  if (!await details.evaluate(element => element.open)) await details.locator('summary').click();
};
const control = (page, name) => page.locator(`[data-ui-style-control="${name}"]`);
const fieldState = (page, key) => page.locator(`[data-ui-style-key="${key}"] .ui-style-state`).first().innerText();
const pressedState = page => page.locator('[data-ui-style-key="state"] [aria-pressed="true"]').getAttribute('data-ui-style-control');
/** Waits until one draft field of a node equals `expected` (undefined = absent), then returns the draft. */
async function expectDraft(page, label, pageId, id, key, expected) {
  await page.waitForFunction(async ({ pageId, id, key, expected }) => {
    const config = await import('/src/panels/config.ts');
    const find = node => node.id === id ? node : node.children?.map(find).find(Boolean);
    return JSON.stringify(find(config.readUiConfigDraft().pages[pageId])?.[key]) === JSON.stringify(expected);
  }, { pageId, id, key, expected: expected ?? null }).catch(() => {});
  const draft = await draftNode(page, pageId, id);
  assert.deepEqual(draft.node[key], expected, label);
  return draft;
}
const canvasLook = (page, id) => page.evaluate(id => {
  const item = document.querySelector(`.ui-designer-canvas [data-ui-node="${id}"]`);
  const decor = item?.previousElementSibling?.matches('[data-ui-decor]') ? item.previousElementSibling : null;
  const fill = decor?.querySelector('[data-ui-decor-background]');
  return { state: item.dataset.uiPreviewState ?? null, color: getComputedStyle(item).color, opacity: item.style.opacity, decorOpacity: decor?.style.opacity ?? null,
    background: fill ? getComputedStyle(fill).backgroundColor : null, focusRing: Boolean(item.querySelector('[data-ui-focus-preview]')), decor: Boolean(decor) };
}, id);

try {
  browser = await chromium.launch({ headless: true });
  server = await startDevProject(['--project', fixture.root, '--data-root', path.join(output, 'authority'), '--port', String(PORT)], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') });
  const originalUi = JSON.parse(fs.readFileSync(configPath, 'utf8')).ui;

  // ── 1. Interaction states: switch, edit, canvas preview, undo/redo ──
  let page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`editor: ${error.message}`));
  await openDesigner(page);
  await selectNode(page, 'title', 'btn_plain');
  assert.equal(await pressedState(page), 'state:normal', 'a control opens on its normal state');
  assert.deepEqual(await page.locator('[data-ui-style-key="state"] button').allInnerTexts(), ['正常', '悬停', '焦点', '按下', '禁用']);
  const normalStyle = (await draftNode(page, 'title', 'btn_plain')).node.style;

  await control(page, 'state:hover').click();
  await page.locator('[data-ui-style-form="btn_plain"][data-ui-style-state="hover"]').waitFor();
  assert.equal(await pressedState(page), 'state:hover');
  // A state edits only what the control draws: no frame-, border-, padding- or typography-like field.
  for (const key of ['border', 'borderRadius', 'padding', 'fontSize', 'fontRole', 'lineHeight', 'align']) assert.equal(await page.locator(`[data-ui-style-form] [data-ui-style-key="${key}"]`).count(), 0, `${key} is not a state field`);
  await openGroup(page, 'background'); await openGroup(page, 'text'); await openGroup(page, 'box');
  assert.match(await fieldState(page, 'background'), /^沿用正常状态/);
  let canvas = await canvasLook(page, 'btn_plain');
  assert.deepEqual([canvas.state, canvas.background, canvas.decor], ['hover', 'rgb(255, 255, 255)', true], 'unset hover shows the normal look');
  const historyBefore = (await draftNode(page, 'title', 'btn_plain')).history;
  await control(page, 'background').fill('#ff0000');
  let draft = await expectDraft(page, 'hover background', 'title', 'btn_plain', 'states', { hover: { background: 0xff0000 } });
  assert.deepEqual(draft.node.style, normalStyle, 'editing a state never touches the normal style');
  assert.equal(draft.history.past, historyBefore.past + 1, 'one edit is one undo step');
  assert.equal(await fieldState(page, 'background'), '已设置');
  canvas = await canvasLook(page, 'btn_plain');
  assert.deepEqual([canvas.state, canvas.background], ['hover', 'rgb(255, 0, 0)'], 'canvas shows the hover state');
  assert.equal(await control(page, 'state:hover').innerText(), '悬停 •');

  await control(page, 'state:pressed').click();
  await page.locator('[data-ui-style-form="btn_plain"][data-ui-style-state="pressed"]').waitFor();
  await openGroup(page, 'text');
  await control(page, 'color').fill('#112233');
  await expectDraft(page, 'pressed colour keeps hover', 'title', 'btn_plain', 'states', { hover: { background: 0xff0000 }, pressed: { color: 0x112233 } });
  canvas = await canvasLook(page, 'btn_plain');
  assert.deepEqual([canvas.state, canvas.color, canvas.background], ['pressed', 'rgb(17, 34, 51)', 'rgb(255, 255, 255)'], 'pressed shows alone over normal, not over hover');

  await control(page, 'state:disabled').click();
  await page.locator('[data-ui-style-form="btn_plain"][data-ui-style-state="disabled"]').waitFor();
  await openGroup(page, 'box');
  assert.equal(await page.locator('[data-ui-disabled-opacity]').getAttribute('data-ui-disabled-opacity'), '0.45');
  { const input = control(page, 'opacity'); await input.fill('50'); await input.press('Tab'); }
  draft = await expectDraft(page, 'disabled opacity', 'title', 'btn_plain', 'states', PLAIN_STATES);
  assert.deepEqual(Object.keys(draft.node.states), ['hover', 'pressed', 'disabled'], 'states stay in Core order');
  assert.match(await page.locator('[data-ui-disabled-opacity]').innerText(), /最终整体不透明度 23%/);
  assert.equal(await page.locator('[data-ui-disabled-opacity]').getAttribute('data-ui-disabled-opacity'), '0.225');
  canvas = await canvasLook(page, 'btn_plain');
  assert.deepEqual([canvas.state, canvas.opacity, canvas.decorOpacity], ['disabled', '0.225', '0.225'], 'canvas disabled = state opacity × 0.45, once');

  await control(page, 'state:focus').click();
  canvas = await canvasLook(page, 'btn_plain');
  assert.deepEqual([canvas.state, canvas.focusRing, canvas.background], ['focus', true, 'rgb(255, 255, 255)'], 'focus preview draws the Player focus ring');
  await control(page, 'state:normal').click();
  canvas = await canvasLook(page, 'btn_plain');
  assert.deepEqual([canvas.state, canvas.focusRing, canvas.background, canvas.opacity], [null, false, 'rgb(255, 255, 255)', '1']);
  const stateHistory = (await draftNode(page, 'title', 'btn_plain')).history;
  assert.equal(stateHistory.past, historyBefore.past + 3, 'switching states adds no undo step');

  // Clear one state, undo, redo; an emptied state disappears and the others stay.
  await control(page, 'state:hover').click();
  await control(page, 'state:hover:clear').click();
  await expectDraft(page, 'clear hover', 'title', 'btn_plain', 'states', { pressed: { color: 0x112233 }, disabled: { opacity: 0.5 } });
  assert.equal(await control(page, 'state:hover').innerText(), '悬停');
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '撤销', exact: true }).click();
  await expectDraft(page, 'undo clear', 'title', 'btn_plain', 'states', PLAIN_STATES);
  assert.equal(await pressedState(page), 'state:hover', 'undo keeps the edited state');
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '重做', exact: true }).click();
  await expectDraft(page, 'redo clear', 'title', 'btn_plain', 'states', { pressed: { color: 0x112233 }, disabled: { opacity: 0.5 } });
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '撤销', exact: true }).click();
  await expectDraft(page, 'undo again', 'title', 'btn_plain', 'states', PLAIN_STATES);
  // Choosing another control returns to 正常; text has no state switch.
  await selectNode(page, 'title', 'btn_start');
  assert.equal(await pressedState(page), 'state:normal');
  assert.equal(await control(page, 'state:hover').innerText(), '悬停 •');
  assert.equal((await canvasLook(page, 'btn_plain')).state, null, 'only the selected control previews a state');
  await selectNode(page, 'title', 'title_note');
  assert.equal(await page.locator('[data-ui-style-key="state"]').count(), 0, 'text has no interaction states');
  log('states', { states: (await draftNode(page, 'title', 'btn_plain')).node.states });

  // ── 2. Page enter/exit fields on the root and the one-off canvas preview ──
  await selectNode(page, 'title', 'title_root');
  await openGroup(page, 'motion');
  assert.equal(await control(page, 'transition.enter.enabled').isChecked(), false);
  await control(page, 'transition.enter.enabled').check();
  await expectDraft(page, 'enable title enter', 'title', 'title_root', 'transition', { enter: { durationMs: 200, opacity: 0, y: 16 } });
  { const input = control(page, 'transition.enter.durationMs'); await input.fill('300'); await input.press('Tab'); }
  await expectDraft(page, 'title enter duration', 'title', 'title_root', 'transition', { enter: { durationMs: 300, opacity: 0, y: 16 } });
  { const input = control(page, 'transition.enter.y'); await input.fill('200'); await input.press('Tab'); }
  await expectDraft(page, 'offset pulled into range', 'title', 'title_root', 'transition', { enter: { durationMs: 300, opacity: 0, y: 128 } });
  await control(page, 'transition.enter.easing').selectOption('ease-in-out');
  await expectDraft(page, 'title enter easing', 'title', 'title_root', 'transition', { enter: { durationMs: 300, opacity: 0, y: 128, easing: 'ease-in-out' } });
  await control(page, 'transition.enter.enabled').uncheck();
  await expectDraft(page, 'disable title enter', 'title', 'title_root', 'transition', undefined);
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '撤销', exact: true }).click();
  await expectDraft(page, 'undo disable', 'title', 'title_root', 'transition', { enter: { durationMs: 300, opacity: 0, y: 128, easing: 'ease-in-out' } });
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '重做', exact: true }).click();
  await expectDraft(page, 'redo disable', 'title', 'title_root', 'transition', undefined);
  assert.equal(await page.locator('[data-ui-style-form="btn_start"] [data-ui-style-group="motion"], [data-ui-style-group="motion"]').count(), 1);
  await selectNode(page, 'title', 'btn_start');
  assert.equal(await page.locator('[data-ui-style-group="motion"]').count(), 0, 'only a page root has enter/exit');

  await selectNode(page, 'system-menu', 'menu_root');
  await openGroup(page, 'motion');
  const shown = {};
  for (const key of ['durationMs', 'opacity', 'y', 'x', 'scale']) shown[key] = await control(page, `transition.enter.${key}`).inputValue();
  assert.deepEqual(shown, { durationMs: '600', opacity: '0', y: '40', x: '', scale: '' }, 'existing motion is shown as authored (opacity in %)');
  assert.equal(await control(page, 'transition.enter.easing').inputValue(), 'linear');
  { const input = control(page, 'transition.exit.durationMs'); await input.fill('500'); await input.press('Tab'); }
  await expectDraft(page, 'menu exit duration keeps enter', 'system-menu', 'menu_root', 'transition', MENU_TRANSITION);

  const beforePreview = await draftNode(page, 'system-menu', 'menu_root');
  const layer = page.locator('.ui-designer-canvas [data-ui-canvas-page="system-menu"]');
  assert.equal(await control(page, 'transition.stop').isDisabled(), true);
  await control(page, 'transition.enter.preview').click();
  await page.waitForFunction(() => { const layer = document.querySelector('[data-ui-canvas-page]'); return layer?.dataset.uiMotionPreview === 'enter' && layer.style.opacity !== '' && Number(layer.style.opacity) > 0.05; });
  const midEnter = await layer.evaluate(element => ({ opacity: Number(element.style.opacity), transform: element.style.transform }));
  assert(midEnter.opacity > 0 && midEnter.opacity < 1, `enter preview fades in: ${JSON.stringify(midEnter)}`);
  assert.match(midEnter.transform, /^translate\(0cqw, [\d.]+cqw\) scale\(1\)$/, 'enter preview starts below and moves up');
  assert.equal(await control(page, 'transition.stop').isDisabled(), false);
  await control(page, 'transition.stop').click();
  const stopped = await layer.evaluate(element => ({ opacity: element.style.opacity, transform: element.style.transform, previewing: element.dataset.uiMotionPreview ?? null }));
  assert.deepEqual(stopped, { opacity: '', transform: '', previewing: null }, '停止预览 returns the canvas to its normal pose');
  assert.equal(await control(page, 'transition.stop').isDisabled(), true);
  await control(page, 'transition.exit.preview').click();
  await page.waitForFunction(() => document.querySelector('[data-ui-canvas-page]')?.dataset.uiMotionPreview === 'exit');
  const exitSamples = [];
  for (let i = 0; i < 4; i++) { exitSamples.push(await layer.evaluate(element => element.style.opacity)); await page.waitForTimeout(80); }
  await page.waitForFunction(() => document.querySelector('[data-ui-canvas-page]')?.dataset.uiMotionPreview === undefined, null, { timeout: 3000 });
  const ended = await layer.evaluate(element => ({ opacity: element.style.opacity, transform: element.style.transform }));
  assert.deepEqual(ended, { opacity: '', transform: '' }, 'a finished preview leaves the canvas at its normal pose');
  assert(exitSamples.some(value => value !== '' && Number(value) < 1), `exit preview fades out: ${exitSamples}`);
  const afterPreview = await draftNode(page, 'system-menu', 'menu_root');
  assert.deepEqual([afterPreview.node, afterPreview.history, afterPreview.dirty], [beforePreview.node, beforePreview.history, beforePreview.dirty], 'previews never change the draft or history');
  // A redraw (page switch) ends a running preview.
  await control(page, 'transition.enter.preview').click();
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('title');
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('system-menu');
  assert.deepEqual(await layer.evaluate(element => [element.style.opacity, element.style.transform, element.dataset.uiMotionPreview ?? null]), ['', '', null]);
  log('motion', { midEnter, exitSamples, transition: afterPreview.node.transition });

  // ── 3. Save → file → reopen ──
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).ui, originalUi, 'edits stay a draft until saved');
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '保存界面', exact: true }).click();
  const saveStatus = await page.waitForFunction(() => [...document.querySelectorAll('p')].map(item => item.textContent).find(text => /界面已保存|保存失败/.test(text ?? '')) ?? false).then(handle => handle.jsonValue());
  assert.match(saveStatus, /^界面已保存/, `designer save status: ${saveStatus}`);
  await page.waitForFunction(async () => !(await import('/src/panels/config.ts')).inspectConfigDraftState().dirty);
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const expectedUi = structuredClone(originalUi);
  findIn(expectedUi.pages.title, 'btn_plain').states = PLAIN_STATES;
  expectedUi.pages['system-menu'].transition = MENU_TRANSITION;
  assert.deepEqual(saved.ui, expectedUi, 'saving writes exactly the edited states and transition');
  assert.equal(saved.privateAuditMarker, 'KEEP_UI_SOURCE');
  await page.close();

  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`editor(reopen): ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await openDesigner(page);
  const reopened = await draftNode(page, 'title', 'btn_plain');
  assert.deepEqual([reopened.node.states, reopened.dirty.dirtySections], [PLAIN_STATES, []]);
  assert.deepEqual((await draftNode(page, 'system-menu', 'menu_root')).node.transition, MENU_TRANSITION);
  await selectNode(page, 'title', 'btn_plain');
  assert.deepEqual(await page.locator('[data-ui-style-key="state"] button').allInnerTexts(), ['正常', '悬停 •', '焦点', '按下 •', '禁用 •']);
  log('saved', { states: saved.ui.pages.title.children.find(node => node.id === 'btn_plain').states, transition: saved.ui.pages['system-menu'].transition });

  // ── 4. The designer's Player preview window: real pointer, keyboard and page motion ──
  const openPreview = async page => {
    await page.locator('.ui-designer-toolbar').getByRole('button', { name: '试玩草稿', exact: true }).click();
    const iframe = page.locator('.ui-player-preview iframe');
    await iframe.waitFor();
    const player = await (await iframe.elementHandle()).contentFrame();
    player.page().on('pageerror', error => errors.push(`player: ${error.message}`));
    await player.waitForFunction(() => { const button = document.querySelector('[data-surdet-project-ui] [data-ui-page="title"] [data-ui-node="btn_start"]'); return Boolean(button) && button.offsetParent !== null; }, null, { timeout: 60000 });
    return { iframe, player };
  };
  const { iframe, player } = await openPreview(page);
  const look = id => player.evaluate(id => {
    const element = document.querySelector(`[data-surdet-project-ui] [data-ui-page]:not([data-ui-closing]) [data-ui-node="${id}"]`), group = element?.closest(`[data-ui-group="${id}"]`);
    const decor = group?.querySelector(':scope > [data-ui-decor]'), fill = decor?.querySelector('[data-ui-decor-background]');
    return { state: element?.dataset.uiState ?? null, groupOpacity: group ? getComputedStyle(group).opacity : null, background: fill ? getComputedStyle(fill).backgroundColor : null,
      color: element ? getComputedStyle(element).color : null, disabled: element?.disabled ?? null };
  }, id);
  const centre = async id => { const box = await player.locator(`[data-surdet-project-ui] [data-ui-page]:not([data-ui-closing]) [data-ui-node="${id}"]`).boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const markers = () => player.evaluate(() => [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-focus-marker]')].filter(item => !item.hidden).map(item => item.dataset.uiFocusFor));
  const settle = () => page.waitForTimeout(120);

  // A modal page focuses its first control when it opens (Chrome shows that as keyboard focus before any input), so
  // pointer states below are compared without the focus part.
  const initialFocus = { state: (await look('btn_start')).state, markers: await markers() };
  const pointerState = item => item.state.split(' ').filter(part => part !== 'focus').join(' ') || 'normal';
  // Disabled from enabledWhen: the work's own disabled state × 0.45, hover never applies.
  let seen = await look('btn_locked');
  assert.deepEqual([seen.state, seen.disabled, seen.groupOpacity, seen.background], ['disabled', true, '0.36', 'rgb(136, 136, 136)']);
  let at = await centre('btn_locked'); await page.mouse.move(at.x, at.y); await settle();
  seen = await look('btn_locked');
  assert.deepEqual([seen.state, seen.background], ['hover disabled', 'rgb(136, 136, 136)']);
  // The state edited in the designer is what the Player draws.
  at = await centre('btn_plain'); await page.mouse.move(at.x, at.y); await settle();
  assert.deepEqual(await look('btn_plain').then(item => [item.state, item.background]), ['hover', 'rgb(255, 0, 0)']);
  at = await centre('btn_start'); await page.mouse.move(at.x, at.y); await settle();
  seen = await look('btn_start');
  assert.deepEqual([pointerState(seen), seen.background, seen.color], ['hover', 'rgb(204, 51, 51)', 'rgb(255, 255, 255)']);
  assert.equal((await look('btn_plain')).state, 'normal', 'leaving a control repaints its normal state');
  await page.mouse.move(at.x + 600, at.y); await settle();
  assert.deepEqual(await look('btn_start').then(item => [pointerState(item), item.background, item.color]), ['normal', 'rgb(255, 255, 255)', 'rgb(34, 51, 68)']);
  // Keyboard focus: Core's focus state plus the page focus marker; the disabled button is skipped.
  const trail = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab'); await settle();
    trail.push(await player.evaluate(() => document.activeElement?.closest('[data-ui-node]')?.dataset.uiNode ?? document.activeElement?.tagName));
  }
  assert(!trail.includes('btn_locked'), `disabled control is not focusable: ${trail}`);
  const focused = trail.at(-1);
  assert.match((await look(focused)).state, /focus/, `${focused} shows its focus state`);
  assert.deepEqual(await markers(), [focused], 'one focus marker on the keyboard-focused control');
  await page.screenshot({ path: path.join(output, 'player-title-focus.png'), clip: await iframe.boundingBox() });
  // Press: pressed state while held, one activation on release (start).
  at = await centre('btn_start'); await page.mouse.move(at.x, at.y); await page.mouse.down(); await settle();
  seen = await look('btn_start');
  assert.match(seen.state, /pressed/); assert.equal(seen.background, 'rgb(51, 51, 204)');
  assert.deepEqual(await markers(), [], 'a mouse press shows no keyboard focus marker');
  await page.mouse.up();
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]')?.textContent === '第一句话。', null, { timeout: 30000 });
  log('player-states', { initialFocus, trail });

  // Page entry: visual only, the menu takes input at once and the story stays paused.
  const pageState = id => player.evaluate(id => [...document.querySelectorAll(`[data-surdet-project-ui] [data-ui-page="${id}"]`)].map(element => ({
    opacity: element.style.opacity, transform: element.style.transform, closing: element.dataset.uiClosing === 'true', inert: element.inert,
    blocker: Boolean(document.querySelector(`[data-surdet-project-ui] [data-ui-motion-blocker="${id}"]`)) })), id);
  // Frames in this headless (software GL) browser can be slow while the stage ticks, and the ticker caps one step at
  // 100 ms, so motion ends are awaited rather than timed.
  const STABLE_MENU = [{ opacity: '', transform: '', closing: false, inert: false, blocker: false }];
  const menuSettled = () => player.waitForFunction(() => {
    const pages = [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-page="system-menu"]')];
    return pages.length === 1 && pages[0].style.opacity === '' && pages[0].style.transform === '' && !pages[0].dataset.uiClosing && !document.querySelector('[data-surdet-project-ui] [data-ui-motion-blocker]');
  }, null, { timeout: 15000 });
  const menuGone = () => player.waitForFunction(() => !document.querySelector('[data-surdet-project-ui] [data-ui-page="system-menu"]'), null, { timeout: 15000 });
  const body = () => player.evaluate(() => document.querySelector('[data-surdet-project-ui] [data-ui-page="dialogue"] [data-ui-node="body"]')?.textContent);
  const stage = await iframe.boundingBox();
  const clickStage = () => page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height * 0.3);
  at = await centre('btn_menu'); await page.mouse.move(at.x, at.y); await settle();
  assert.deepEqual(await look('btn_menu').then(item => [item.state, item.background]), ['hover', 'rgb(51, 170, 85)']);
  await page.mouse.click(at.x, at.y);
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-page="system-menu"]'));
  // The renderer's own frame record shows whether the Runtime ticker is still running.
  const frameRecord = () => player.evaluate(() => JSON.stringify(window.surdetDebug.queries.diagnostics.performanceSnapshot()?.samples ?? null));
  const recordAtOpen = await frameRecord();
  const entering = [];
  for (let i = 0; i < 6; i++) { entering.push((await pageState('system-menu'))[0]); await page.waitForTimeout(70); }
  assert(entering.some(item => item.opacity !== '' && Number(item.opacity) < 1 && /translate\(0px, [\d.]+px\)/.test(item.transform)), `menu enters: ${JSON.stringify(entering)}`);
  assert(entering[0].blocker, 'a modal page blocks the stage while it is still moving');
  const opacities = entering.map(item => item.opacity === '' ? 1 : Number(item.opacity));
  assert(opacities.every((value, index) => index === 0 || value >= opacities[index - 1]), `entry only moves forward: ${opacities}`);
  assert.notEqual(await frameRecord(), recordAtOpen, 'the entry runs on the Runtime ticker while the story is paused');
  await menuSettled();
  assert.deepEqual(await pageState('system-menu'), STABLE_MENU, 'entry ends at the stable pose');
  assert.equal(await body(), '第一句话。', 'the story stays paused under the menu');
  await page.waitForTimeout(500);
  const idleRecord = await frameRecord(); await page.waitForTimeout(1500);
  assert(idleRecord !== 'null' && idleRecord !== '[]', 'the renderer keeps a frame record');
  assert.equal(await frameRecord(), idleRecord, 'once the entry has ended no further Runtime frame is requested');

  // Exit: the page gives input back at once, its picture fades out and is removed.
  const closeBox = await player.locator('[data-surdet-project-ui] [data-ui-page="system-menu"] [data-ui-node="menu_close"]').boundingBox();
  const restartBox = await player.locator('[data-surdet-project-ui] [data-ui-page="system-menu"] [data-ui-node="menu_restart"]').boundingBox();
  await page.mouse.click(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
  const closing = (await pageState('system-menu'))[0];
  assert.deepEqual([closing?.closing, closing?.inert], [true, true], `closing page is an inert picture: ${JSON.stringify(closing)}`);
  await clickStage();
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-page="dialogue"] [data-ui-node="body"]')?.textContent === '第二句话。', null, { timeout: 15000 });
  const ghostWhileAdvancing = await pageState('system-menu');
  await menuGone();
  assert.deepEqual(await pageState('system-menu'), [], 'the closing picture is removed after the exit');
  log('player-menu', { entering, closing, ghostWhileAdvancing });

  // Rapid switching with real clicks issued back to back: open, close during the entry, reopen during the exit. A
  // recorder in the Player keeps every painted pose, because this headless browser paints the ticking stage slowly
  // and one round trip per sample would miss whole phases.
  await player.evaluate(() => {
    const log = window.__menuLog = [], ids = new WeakMap(); let batch = 0, next = 0;
    const id = element => { if (!ids.has(element)) ids.set(element, ++next); return ids.get(element); };
    new MutationObserver(records => {
      batch++;
      for (const record of records) {
        for (const node of record.addedNodes) if (node.dataset?.uiPage === 'system-menu') log.push({ batch, kind: 'added', page: id(node) });
        for (const node of record.removedNodes) if (node.dataset?.uiPage === 'system-menu') log.push({ batch, kind: 'removed', page: id(node), closing: node.dataset.uiClosing === 'true', opacity: node.style.opacity });
        const target = record.target;
        if (record.type === 'attributes' && target.dataset?.uiPage === 'system-menu' && target.isConnected) {
          const pose = { batch, kind: 'pose', page: id(target), closing: target.dataset.uiClosing === 'true', opacity: target.style.opacity, transform: target.style.transform };
          const last = log.findLast(item => item.kind === 'pose' && item.page === pose.page);
          if (!last || last.closing !== pose.closing || last.opacity !== pose.opacity || last.transform !== pose.transform) log.push(pose);
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'data-ui-closing'] });
  });
  const menuAt = await centre('btn_menu');
  // 20 design px below the close button's centre stays inside it (56 px tall) anywhere along the 40 px entry offset.
  const closeAt = { x: closeBox.x + closeBox.width / 2, y: closeBox.y + closeBox.height / 2 + 20 * closeBox.width / 320 };
  await page.mouse.click(menuAt.x, menuAt.y);
  await page.mouse.click(closeAt.x, closeAt.y);
  await page.mouse.click(menuAt.x, menuAt.y);
  await menuSettled();
  assert.deepEqual(await pageState('system-menu'), STABLE_MENU, 'the reopened menu ends at the stable pose');
  const menuLog = await player.evaluate(() => window.__menuLog);
  const [firstMenu, secondMenu] = menuLog.filter(item => item.kind === 'added').map(item => item.page);
  assert(firstMenu && secondMenu, `opened twice: ${JSON.stringify(menuLog)}`);
  const posesOf = id => menuLog.filter(item => item.kind === 'pose' && item.page === id);
  const entry = posesOf(firstMenu).filter(item => !item.closing), exit = posesOf(firstMenu).filter(item => item.closing);
  const opacityOf = item => item.opacity === '' ? 1 : Number(item.opacity);
  const ordered = (items, direction) => items.map(opacityOf).every((value, index, all) => index === 0 || direction * (value - all[index - 1]) >= 0);
  assert(entry.length > 0 && exit.length > 0, `menu closed during its entry: ${JSON.stringify(menuLog)}`);
  assert(posesOf(firstMenu).every(item => item.opacity !== '' && item.transform !== ''), `the first menu never jumps to its stable pose: ${JSON.stringify(menuLog)}`);
  assert(ordered(entry, 1) && ordered(exit, -1), `entry only fades in, exit only fades out: ${JSON.stringify(menuLog)}`);
  // The exit has no offset of its own, so the whole exit keeps the entry offset it started from.
  assert.equal(exit[0].opacity, entry.at(-1).opacity, 'the exit starts from the entry opacity on screen');
  assert(exit.every(item => item.transform === entry.at(-1).transform) && /translate\(0px, [1-9]/.test(exit[0].transform), `the exit continues from the entry offset: ${JSON.stringify(menuLog)}`);
  const dropped = menuLog.find(item => item.kind === 'removed' && item.page === firstMenu);
  const reopenedAt = menuLog.find(item => item.kind === 'added' && item.page === secondMenu);
  assert(dropped?.closing && dropped.batch === reopenedAt.batch && opacityOf(dropped) > 0, `reopening during the exit drops the closing picture at once: ${JSON.stringify({ dropped, reopenedAt })}`);
  const secondEntry = posesOf(secondMenu);
  assert(secondEntry[0]?.opacity === '0' && secondEntry.at(-1).opacity === '' && ordered(secondEntry, 1) && secondEntry.every(item => !item.closing), `the reopened menu enters afresh: ${JSON.stringify(secondEntry)}`);
  at = await centre('menu_close'); await page.mouse.click(at.x, at.y);
  await menuGone();
  log('player-rapid', { menuLog });

  // New game while the menu is still entering: the Shell closes it and the session reset drops its motion and closing
  // picture in the same step; nothing of the old run returns or moves the new story on.
  await player.evaluate(() => { window.__menuLog.length = 0; });
  const restartAt = { x: restartBox.x + restartBox.width / 2, y: restartBox.y + restartBox.height / 2 + 20 * restartBox.width / 320 };
  await page.mouse.click(menuAt.x, menuAt.y);
  await page.mouse.click(restartAt.x, restartAt.y);
  const afterRestart = await pageState('system-menu');
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-page="dialogue"] [data-ui-node="body"]')?.textContent === '第一句话。', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const restartLog = await player.evaluate(() => window.__menuLog);
  assert.deepEqual(afterRestart, [], `new game leaves no menu or closing picture: ${JSON.stringify(afterRestart)}`);
  assert(restartLog.some(item => item.kind === 'pose') && restartLog.every(item => item.kind !== 'pose' || item.opacity !== ''), `the menu was still entering when the new game began: ${JSON.stringify(restartLog)}`);
  assert.deepEqual([await body(), await pageState('system-menu')], ['第一句话。', []], 'no late motion callback reopens the menu or advances the new story');
  log('player-restart', { restartLog });

  // Closing the preview while the menu is entering: the Player goes with its motion, no late callback errors.
  at = await centre('btn_menu'); await page.mouse.click(at.x, at.y);
  await page.getByRole('button', { name: '关闭试玩', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.close();

  // ── 5. Reduced motion (the player's setting follows the system preference): pages appear and leave at once ──
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`editor(reduced): ${error.message}`));
  await openDesigner(page);
  const reduced = await openPreview(page);
  const reducedState = () => reduced.player.evaluate(() => [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-page="system-menu"]')].map(element => ({
    opacity: element.style.opacity, transform: element.style.transform, closing: element.dataset.uiClosing === 'true', blocker: Boolean(document.querySelector('[data-ui-motion-blocker]')) })));
  await reduced.player.locator('[data-surdet-project-ui] [data-ui-node="btn_start"]').click();
  await reduced.player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]')?.textContent === '第一句话。', null, { timeout: 30000 });
  await reduced.player.locator('[data-surdet-project-ui] [data-ui-node="btn_menu"]').click();
  await reduced.player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-page="system-menu"]'));
  const reducedOpen = await reducedState();
  await reduced.player.locator('[data-surdet-project-ui] [data-ui-node="menu_close"]').click();
  const reducedClosed = await reducedState();
  assert.deepEqual(reducedOpen, [{ opacity: '', transform: '', closing: false, blocker: false }], 'reduced motion shows the page at its stable pose');
  assert.deepEqual(reducedClosed, [], 'reduced motion removes the page at once');
  log('reduced-motion', { reducedOpen, reducedClosed });
  await page.getByRole('button', { name: '关闭试玩', exact: true }).click();
  await page.close();

  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...results, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, passed: results.steps.map(step => step.step), errors }, null, 2));
} catch (error) {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...results, errors, failure: String(error?.stack ?? error) }, null, 2));
  console.log(JSON.stringify({ output, errors, failure: String(error) }));
  throw error;
} finally { await browser?.close(); await server?.close(); }
