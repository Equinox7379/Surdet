import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { createStageFixture } from './support/stage-fixture.mjs';

// U1 in the real Editor: style form → Authoring draft → save → reopen → undo/redo, then the same saved
// config in the designer canvas and in the designer's own Player preview window (real shared Player).
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_U1_E2E_OUTPUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-style-u1-'));
fs.mkdirSync(output, { recursive: true });

function png(width, height, paint) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8); result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc(body), body.length + 4); return result; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const rgba = paint(x, y); for (let c = 0; c < 4; c++) bytes[y * (width * 4 + 1) + x * 4 + 1 + c] = rgba[c]; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}

const frame = (x, y, width, height) => ({ x, y, width, height });
const slice = { top: 12, right: 12, bottom: 12, left: 12, fillCenter: true };
const nine = { asset: 'u1_frame', fit: 'stretch', slice };
const line = { width: 2, color: 0x335577, opacity: 1 };
const LONG = '雨一直下到傍晚，站台上的灯一盏接一盏亮起来。她把车票折成很小的方块，又慢慢展开，像是要从折痕里读出什么答案。远处的列车鸣笛两次，月台上的人群开始移动，只有她还站在原地，看着玻璃上的水痕慢慢汇成一条线。';
const ui = { version: 1, pages: {
  title: { id: 'title_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'card', type: 'container', frame: frame(80, 80, 560, 560), style: { backgroundImage: nine, border: line, padding: { top: 20, right: 24, bottom: 20, left: 24 } }, children: [
      { id: 'title_name', type: 'text', frame: frame(0, 0, 500, 70), text: { kind: 'data', field: 'title' }, style: { fontRole: 'title', fontSize: 44 } },
      { id: 'btn_start', type: 'button', frame: frame(0, 90, 260, 48), text: { kind: 'literal', value: '开始' }, action: { kind: 'start' }, style: { shadows: [] } },
      { id: 'btn_frame', type: 'button', frame: frame(0, 150, 260, 48), text: { kind: 'literal', value: '九宫格按钮' }, action: { kind: 'start' }, style: { backgroundImage: nine, padding: { top: 0, right: 16, bottom: 0, left: 16 } } },
      { id: 'btn_noskin', type: 'button', frame: frame(0, 210, 260, 48), text: { kind: 'literal', value: '无皮肤' }, action: { kind: 'start' }, enabledWhen: 'ready == true', style: { backgroundImage: null, background: 0xdde4ea } },
      { id: 'btn_legacy', type: 'button', frame: frame(0, 270, 260, 48), text: { kind: 'literal', value: '旧按钮' }, action: { kind: 'start' } },
      { id: 'title_note', type: 'text', frame: frame(0, 340, 500, 30), text: { kind: 'literal', value: 'U1 集成核验' }, style: { fontSize: 14, color: 0x335577 } },
    ] },
  ] },
  hud: { id: 'hud_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'hp_boxed', type: 'progress', frame: frame(40, 24, 280, 20), binding: { kind: 'variable', name: 'hp' }, text: { kind: 'literal', value: '体力' }, style: { border: { width: 1, color: 0x445566, opacity: 1 } } },
    { id: 'hp_legacy', type: 'progress', frame: frame(40, 56, 280, 20), binding: { kind: 'variable', name: 'hp' }, text: { kind: 'literal', value: '体力（旧）' } },
    { id: 'ready_toggle', type: 'toggle', frame: frame(340, 20, 120, 48), binding: { kind: 'variable', name: 'ready' }, text: { kind: 'literal', value: '准备' }, style: { border: line, padding: { top: 12, right: 40, bottom: 12, left: 40 }, background: 0xffffff } },
    { id: 'scale_slider', type: 'slider', frame: frame(480, 20, 280, 40), binding: { kind: 'setting', name: 'textScale' }, text: { kind: 'literal', value: '文字大小' }, style: { border: { width: 1, color: 0x335577, opacity: 1 }, padding: { top: 8, right: 12, bottom: 8, left: 12 }, background: 0xffffff } },
    { id: 'name_plain', type: 'input', frame: frame(780, 20, 220, 44), binding: { kind: 'variable', name: 'nickname' }, text: { kind: 'literal', value: '昵称' }, style: { padding: { top: 6, right: 10, bottom: 6, left: 10 } } },
    { id: 'name_boxed', type: 'input', frame: frame(1020, 20, 220, 44), binding: { kind: 'variable', name: 'nickname' }, text: { kind: 'literal', value: '昵称（框）' }, style: { background: 0xffffff, border: line, borderRadius: 8, padding: { top: 6, right: 10, bottom: 6, left: 10 } } },
  ] },
  dialogue: { id: 'dialogue_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'box', type: 'container', frame: frame(120, 488, 1040, 208), style: { backgroundImage: nine, border: line, borderRadius: 12, padding: { top: 18, right: 36, bottom: 18, left: 36 } }, children: [
      { id: 'speaker', type: 'text', frame: frame(0, 0, 360, 32), text: { kind: 'data', field: 'speaker' }, style: { fontSize: 22, fontWeight: 700 } },
      { id: 'body', type: 'text', frame: frame(0, 40, 964, 120), text: { kind: 'data', field: 'dialogue' }, style: { fontRole: 'body', fontSize: 26, lineHeight: 1.7 } },
    ] },
  ] },
  choices: { id: 'choices_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'list', type: 'content', source: 'choices', frame: frame(340, 160, 600, 300), style: { border: { width: 1, color: 0x335577, opacity: 1 }, padding: { top: 10, right: 10, bottom: 10, left: 10 } }, children: [
      { id: 'opt', type: 'button', frame: frame(0, 0, 578, 56), text: { kind: 'data', field: 'label' }, action: { kind: 'choice' }, enabledWhen: 'ready == true',
        style: { background: 0xffffff, border: line, borderRadius: 10, fontRole: 'body', fontSize: 24, align: 'center' } },
    ] },
  ] },
} };

const fixture = createStageFixture(path.join(output, 'project'));
const configPath = path.join(fixture.root, 'game.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
Object.assign(config, {
  privateAuditMarker: 'KEEP_UI_SOURCE',
  variables: { ready: { type: 'flag', initial: false }, hp: { type: 'number', initial: 40, min: 0, max: 100, readonly: true }, nickname: { type: 'string', initial: '凛' } },
  theme: { buttonSkin: 'u1_skin' },
  fonts: { title: 'content/assets/fonts/MiSans-Regular.otf' },
  ui,
});
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
const write = (file, bytes) => { const target = path.join(fixture.root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); };
// 48×48 skin: red 12px frame, cream centre; 32×32 theme button skin: solid green.
write('content/assets/bg/u1_frame.png', png(48, 48, (x, y) => x < 12 || y < 12 || x >= 36 || y >= 36 ? [200, 60, 60, 255] : [240, 230, 200, 255]));
write('content/assets/bg/u1_skin.png', png(32, 32, () => [60, 160, 90, 255]));
for (const name of ['MiSans-Regular.otf', 'MiSans-LICENSE.pdf']) write(`content/assets/fonts/${name}`, fs.readFileSync(path.join(repo, 'examples/starter/content/assets/fonts', name)));
write('content/scenario/start.gal', `@scene start\n@stage dock\n凛：${LONG}\n@choice\n  留在站台 -> @goto stay\n  追上去 -> @goto chase\n\n@label stay\n凛：那就留下来。\n\n@label chase\n凛：那就追上去。\n`);

const STYLE_NOTE_FINAL = { fontSize: 14, color: 0x335577, letterSpacing: 0, border: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
const results = { output, steps: [] }, errors = [];
const log = (step, value) => { results.steps.push({ step, ...value }); };
let server, browser;

async function openDesigner(page) {
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: fixture.root }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto('http://127.0.0.1:18080/index.html');
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState === 'ready');
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('[data-config-section-target="ui"]').click();
  await page.locator('[data-ui-designer="true"]').waitFor({ state: 'visible' });
}
const draftStyle = (page, pageId, id) => page.evaluate(async ({ pageId, id }) => {
  const config = await import('/src/panels/config.ts');
  const find = node => node.id === id ? node : node.children?.map(find).find(Boolean);
  const node = find(config.readUiConfigDraft().pages[pageId]);
  return { style: node.style ?? null, dirty: config.inspectConfigDraftState(), history: config.configHistoryDepth() };
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
const fieldState = (page, key) => page.locator(`[data-ui-style-key="${key}"] .ui-style-state`).first().innerText();

/** Rects in design pixels, relative to the 1280×720 frame, plus what the decoration paints. */
const measure = (root, ids, scope) => root.evaluate(({ ids, scope }) => {
  const frameElement = scope === 'player' ? document.querySelector('[data-surdet-project-ui] > div') : document.querySelector('.ui-designer-canvas');
  const box = frameElement.getBoundingClientRect(), scale = box.width / 1280;
  const rect = element => { const r = element.getBoundingClientRect(); return { x: +((r.left - box.left) / scale).toFixed(2), y: +((r.top - box.top) / scale).toFixed(2), width: +(r.width / scale).toFixed(2), height: +(r.height / scale).toFixed(2) }; };
  const out = {};
  for (const id of ids) {
    const element = scope === 'player' ? document.querySelector(`[data-surdet-project-ui] [data-ui-node="${id}"]`) : document.querySelector(`.ui-designer-canvas [data-ui-node="${id}"]`);
    if (!element) { out[id] = null; continue; }
    const decor = element.previousElementSibling?.matches('[data-ui-decor]') ? element.previousElementSibling : null;
    const background = decor?.querySelector('[data-ui-decor-background]');
    const images = decor ? [...decor.querySelectorAll('[data-ui-decor-image]')] : [];
    const computed = getComputedStyle(element);
    const input = element.querySelector('input');
    out[id] = {
      rect: rect(element), padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => +(parseFloat(computed[`padding${side}`]) / (scope === 'player' ? 1 : scale)).toFixed(2)),
      color: computed.color, lineHeight: computed.lineHeight === 'normal' ? 'normal' : +(parseFloat(computed.lineHeight) / parseFloat(computed.fontSize)).toFixed(2), label: (() => { const text = [...element.childNodes].find(child => child.nodeType === 3 && child.textContent.trim()); if (!text) return null; const range = document.createRange(); range.selectNodeContents(text); return rect(range); })(),
      fontFamily: computed.fontFamily, fontSize: +(parseFloat(computed.fontSize) / (scope === 'player' ? 1 : scale)).toFixed(2),
      elementBackgroundImage: element.style.backgroundImage, elementBackground: `${computed.backgroundColor} ${computed.backgroundClip}`,
      decor: decor && {
        rect: rect(decor), radius: +(parseFloat(getComputedStyle(decor).borderTopLeftRadius) / (scope === 'player' ? 1 : scale)).toFixed(2),
        background: background && getComputedStyle(background).backgroundColor, opacity: getComputedStyle(decor).opacity, pointerEvents: getComputedStyle(decor).pointerEvents,
        images: images.map(layer => ({ kind: layer.dataset.uiDecorImage, url: layer.style.backgroundImage || layer.style.borderImageSource, patches: layer.dataset.uiNineSlice ? JSON.parse(layer.dataset.uiNineSlice).length : 0 })),
        border: decor.querySelector('[data-ui-decor-border]') ? getComputedStyle(decor.querySelector('[data-ui-decor-border]')).borderTopWidth : null,
      },
      input: input && { rect: rect(input), border: getComputedStyle(input).borderTopWidth, background: getComputedStyle(input).backgroundColor, radius: getComputedStyle(input).borderTopLeftRadius, disabled: input.disabled, checked: input.checked, value: input.value },
      disabled: element.disabled ?? null, opacity: computed.opacity,
      // Player: a decorated node's decoration and content share one group that carries the whole-node opacity.
      group: element.parentElement?.dataset.uiGroup === id ? { opacity: getComputedStyle(element.parentElement).opacity } : null,
    };
  }
  return out;
}, { ids, scope });

/** Average RGB inside a design-pixel rectangle of a screenshot of `frameLocator`'s 1280×720 frame. */
async function sample(page, frameBox, rect, name) {
  const file = path.join(output, `${name}.png`);
  const scale = frameBox.width / 1280;
  await page.screenshot({ path: file, clip: { x: frameBox.x + rect.x * scale, y: frameBox.y + rect.y * scale, width: Math.max(1, rect.width * scale), height: Math.max(1, rect.height * scale) } });
  return page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data; const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
    return sum.map(value => Math.round(value / (data.length / 4)));
  }, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
}
const imagesReady = (scope, count) => ({ scope, count });
const imagesReadyCheck = ({ scope, count }) => { const layers = [...document.querySelectorAll(`${scope} [data-ui-decor-image]`)];
  return layers.length >= count && layers.every(layer => (layer.style.backgroundImage || layer.style.borderImageSource) && (layer.dataset.uiDecorImage !== 'nine-slice' || layer.dataset.uiNineSlice)); };
const close = (a, b, tolerance = 6) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);

try {
  browser = await chromium.launch({ headless: true });
  server = await startDevProject(['--project', fixture.root, '--data-root', path.join(output, 'authority'), '--port', '18080'], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') });
  const originalUi = JSON.parse(fs.readFileSync(configPath, 'utf8')).ui;

  // ── 1. Style form → draft → save → reopen → undo/redo ──
  let page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`editor: ${error.message}`));
  await openDesigner(page);
  await selectNode(page, 'title', 'title_note');
  await openGroup(page, 'text'); await openGroup(page, 'box'); await openGroup(page, 'background');
  const edits = [];
  const edit = async (label, act, expected) => {
    await act();
    await page.waitForFunction(async ({ expected }) => {
      const config = await import('/src/panels/config.ts');
      const find = node => node.id === 'title_note' ? node : node.children?.map(find).find(Boolean);
      return JSON.stringify(find(config.readUiConfigDraft().pages.title).style ?? null) === JSON.stringify(expected);
    }, { expected });
    const draft = await draftStyle(page, 'title', 'title_note');
    assert.deepEqual(draft.style, expected, label);
    edits.push({ label, style: draft.style, history: draft.history });
  };
  const base = { fontSize: 14, color: 0x335577 };
  await edit('字距「无附加字距」写入数值 0', () => page.locator('[data-ui-style-control="letterSpacing:clear"]').click(), { ...base, letterSpacing: 0 });
  assert.equal(await fieldState(page, 'letterSpacing'), '已设置');
  assert.equal(await page.locator('[data-ui-style-control="letterSpacing"]').inputValue(), '0');
  await edit('添加边框', () => page.locator('[data-ui-style-control="border.add"]').click(), { ...base, letterSpacing: 0, border: { width: 1, color: 0x335577, opacity: 1 } });
  await edit('边框「无边框」写入 null', () => page.locator('[data-ui-style-control="border:clear"]').click(), { ...base, letterSpacing: 0, border: null });
  assert.equal(await fieldState(page, 'border'), '已明确清空');
  await edit('上内边距 0 写入完整四边', async () => { const input = page.locator('[data-ui-style-control="padding.top"]'); await input.fill('0'); await input.press('Tab'); },
    { ...base, letterSpacing: 0, border: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
  assert.equal(await fieldState(page, 'padding'), '已明确清空');
  await edit('背景不透明度 0', async () => { const input = page.locator('[data-ui-style-control="backgroundOpacity"]'); await input.fill('0'); await input.press('Tab'); },
    { ...base, letterSpacing: 0, border: null, padding: { top: 0, right: 0, bottom: 0, left: 0 }, backgroundOpacity: 0 });
  await edit('背景不透明度恢复继承', () => page.locator('[data-ui-style-control="backgroundOpacity:inherit"]').click(), STYLE_NOTE_FINAL);
  assert.match(await fieldState(page, 'backgroundOpacity'), /^继承：100%/);
  await edit('撤销恢复继承', () => page.locator('.ui-designer-toolbar').getByRole('button', { name: '撤销', exact: true }).click(), { ...STYLE_NOTE_FINAL, backgroundOpacity: 0 });
  await edit('重做恢复继承', () => page.locator('.ui-designer-toolbar').getByRole('button', { name: '重做', exact: true }).click(), STYLE_NOTE_FINAL);
  log('form-edits', { edits });
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).ui, originalUi, 'edits stay a draft until saved');

  assert.deepEqual((await draftStyle(page, 'title', 'title_note')).dirty.dirtySections, ['ui'], 'edited UI is a dirty draft before saving');
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '保存界面', exact: true }).click();
  const saveStatus = await page.waitForFunction(() => [...document.querySelectorAll('[data-config-section="ui"] p.dim, .ui-designer p, p')]
    .map(item => item.textContent).find(text => /界面已保存|保存失败/.test(text ?? '')) ?? false).then(handle => handle.jsonValue());
  assert.match(saveStatus, /^界面已保存/, `designer save status: ${saveStatus}`);
  await page.waitForFunction(async () => !(await import('/src/panels/config.ts')).inspectConfigDraftState().dirty);
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const findIn = (root, id) => root.id === id ? root : root.children?.map(child => findIn(child, id)).find(Boolean);
  assert.deepEqual(findIn(saved.ui.pages.title, 'title_note').style, STYLE_NOTE_FINAL, 'saved style is the whole edited style');
  const expectedUi = structuredClone(originalUi); findIn(expectedUi.pages.title, 'title_note').style = STYLE_NOTE_FINAL;
  assert.deepEqual(saved.ui, expectedUi, 'saving touches only the edited node');
  assert.equal(saved.privateAuditMarker, 'KEEP_UI_SOURCE');
  log('saved', { titleNote: findIn(saved.ui.pages.title, 'title_note').style });
  await page.close();

  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(`editor(reopen): ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await openDesigner(page);
  const reopened = await draftStyle(page, 'title', 'title_note');
  assert.deepEqual(reopened.style, STYLE_NOTE_FINAL, 'reopened draft reads the saved style');
  assert.deepEqual(reopened.dirty.dirtySections, []);
  await selectNode(page, 'title', 'title_note');
  await openGroup(page, 'text'); await openGroup(page, 'box'); await openGroup(page, 'background');
  const states = {};
  for (const key of ['letterSpacing', 'border', 'padding', 'backgroundOpacity', 'borderRadius']) states[key] = await fieldState(page, key);
  assert.equal(states.letterSpacing, '已设置'); assert.equal(states.border, '已明确清空');
  // padding has no null; four explicit zeros is its "清空内边距" form, so it reads as an explicit clear.
  assert.equal(states.padding, '已明确清空');
  assert.match(states.backgroundOpacity, /^继承/); assert.match(states.borderRadius, /^继承/);
  assert.equal(await page.locator('[data-ui-style-control="padding.top"]').inputValue(), '0');
  log('reopened', { states });

  // ── 2. Designer canvas with the saved config ──
  const canvasBox = async () => page.locator('.ui-designer-canvas').boundingBox();
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('title');
  await page.waitForFunction(() => [...document.fonts].some(face => face.family.startsWith('SurdetDesignerTitleFont') && face.status === 'loaded'), null, { timeout: 30000 });
  await page.waitForFunction(imagesReadyCheck, imagesReady('.ui-designer-canvas', 3));
  const canvasTitle = await measure(page, ['card', 'title_name', 'btn_start', 'btn_frame', 'btn_noskin', 'btn_legacy', 'title_note'], 'canvas');
  await page.locator('.ui-designer-canvas').screenshot({ path: path.join(output, 'designer-title.png') });
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('hud');
  const canvasHud = await measure(page, ['hp_boxed', 'hp_legacy', 'ready_toggle', 'scale_slider', 'name_plain', 'name_boxed'], 'canvas');
  const hudBox = await canvasBox();
  const canvasTrack = await sample(page, hudBox, { x: 260, y: 30, width: 50, height: 8 }, 'designer-hp-track');
  await page.locator('.ui-designer-canvas').screenshot({ path: path.join(output, 'designer-hud.png') });
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('dialogue');
  await page.waitForFunction(imagesReadyCheck, imagesReady('.ui-designer-canvas', 1));
  const canvasDialogue = await measure(page, ['box', 'speaker', 'body'], 'canvas');
  await page.locator('.ui-designer-canvas').screenshot({ path: path.join(output, 'designer-dialogue.png') });
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('choices');
  const canvasChoices = await measure(page, ['list', 'opt'], 'canvas');
  await page.locator('.ui-designer-canvas').screenshot({ path: path.join(output, 'designer-choices.png') });
  log('canvas', { canvasTitle, canvasHud, canvasTrack, canvasDialogue, canvasChoices });

  // ── 3. The designer's Player preview window (real shared Player in its iframe) ──
  await page.locator('.ui-designer-toolbar').getByRole('button', { name: '试玩草稿', exact: true }).click();
  const iframe = page.locator('.ui-player-preview iframe');
  await iframe.waitFor();
  const player = page.frames().find(item => item.url().includes('ui-preview.html')) ?? await (await iframe.elementHandle()).contentFrame();
  player.on?.('pageerror', error => errors.push(`player: ${error.message}`));
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="btn_start"]')?.offsetParent !== null, null, { timeout: 60000 });
  await player.waitForFunction(() => [...document.fonts].some(face => face.family === 'SurdetGameTitleFont' && face.status === 'loaded'), null, { timeout: 60000 });
  await player.waitForFunction(imagesReadyCheck, imagesReady('[data-surdet-project-ui]', 3));
  const playerBox = async () => {
    const outer = await iframe.boundingBox();
    const inner = await player.evaluate(() => { const r = document.querySelector('[data-surdet-project-ui] > div').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
    return { x: outer.x + inner.x, y: outer.y + inner.y, width: inner.width, height: inner.height };
  };
  const playerTitle = await measure(player, ['card', 'title_name', 'btn_start', 'btn_frame', 'btn_noskin', 'btn_legacy', 'title_note'], 'player');
  const titleBox = await playerBox();
  await page.screenshot({ path: path.join(output, 'player-title.png'), clip: titleBox });
  log('player-title', { playerTitle });

  // Skins: explicit image beats the theme skin, omitted inherits, null disables, legacy path only without box.
  assert.equal(playerTitle.btn_start.decor.images.length, 1); assert.match(playerTitle.btn_start.decor.images[0].url, /u1_skin\.png/); assert.equal(playerTitle.btn_start.elementBackgroundImage, '');
  assert.equal(playerTitle.btn_frame.decor.images.length, 1); assert.equal(playerTitle.btn_frame.decor.images[0].kind, 'nine-slice'); assert.match(playerTitle.btn_frame.decor.images[0].url, /u1_frame\.png/);
  assert.equal(playerTitle.btn_frame.elementBackgroundImage, '');
  assert.equal(playerTitle.btn_noskin.decor.images.length, 0); assert.equal(playerTitle.btn_noskin.elementBackgroundImage, '');
  assert.equal(playerTitle.btn_legacy.decor, null); assert.match(playerTitle.btn_legacy.elementBackgroundImage, /u1_skin\.png/);
  assert.equal(playerTitle.btn_noskin.disabled, true); assert.equal(playerTitle.btn_noskin.group.opacity, '0.45');
  assert.equal(playerTitle.btn_noskin.decor.opacity, '1'); assert.equal(playerTitle.btn_noskin.opacity, '1', 'disabled fade is applied once, to the group');
  assert.equal(playerTitle.card.decor.images[0].patches, 9);
  // Designer canvas draws the same skins and rects.
  assert.equal(canvasTitle.btn_start.decor.images.length, 1); assert.equal(canvasTitle.btn_frame.decor.images[0].kind, 'nine-slice'); assert.equal(canvasTitle.btn_noskin.decor.images.length, 0);
  // The canvas puts a container at its outer box with CSS padding; the Player puts it at the content box with the
  // decoration at the outer box. Compare what is drawn: the decoration (outer) box and the content box children use.
  const contentBox = item => ({ x: item.rect.x + item.padding[3], y: item.rect.y + item.padding[0], width: item.rect.width - item.padding[1] - item.padding[3], height: item.rect.height - item.padding[0] - item.padding[2] });
  const sameRect = (label, a, b) => { for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(a[key] - b[key]) <= 1.5, `${label}.${key}: canvas ${a[key]} vs player ${b[key]}`); };
  const sameBoxes = (canvas, played, ids, containers = []) => {
    for (const id of ids) {
      if (canvas[id].decor || played[id].decor) sameRect(`${id}.decor`, canvas[id].decor.rect, played[id].decor.rect);
      if (containers.includes(id)) sameRect(`${id}.content`, contentBox(canvas[id]), played[id].rect);
      else sameRect(id, canvas[id].rect, played[id].rect);
    }
  };
  sameBoxes(canvasTitle, playerTitle, ['card', 'title_name', 'btn_start', 'btn_frame', 'btn_noskin', 'btn_legacy', 'title_note'], ['card']);
  assert.deepEqual(contentBox(canvasTitle.card), { x: 106, y: 102, width: 508, height: 516 }, 'border 2 + padding 20/24 deducted once');
  // The canvas draws the inherited theme skin on an unstyled button too, and text over the work's own surfaces in
  // the Player's colour; button labels sit vertically centred in the content box as in the Player's native button.
  assert.match(canvasTitle.btn_legacy.elementBackgroundImage, /^url\("blob:/);
  for (const id of ['title_name', 'btn_start', 'btn_frame', 'btn_legacy', 'title_note']) assert.equal(canvasTitle[id].color, playerTitle[id].color, `${id} text colour`);
  for (const id of ['btn_start', 'btn_frame', 'btn_noskin', 'btn_legacy']) {
    const centre = item => item.label.y + item.label.height / 2;
    assert(Math.abs(centre(canvasTitle[id]) - centre(playerTitle[id])) <= 2, `${id} label centre: canvas ${centre(canvasTitle[id])} vs player ${centre(playerTitle[id])}`);
  }
  // Title role font: the project file in both, not the Editor's own UI font.
  assert.match(canvasTitle.title_name.fontFamily, /SurdetDesignerTitleFont/); assert.match(playerTitle.title_name.fontFamily, /SurdetGameTitleFont/);

  // Keyboard focus on the title page (modal: Tab cycles its enabled buttons, the disabled one is skipped).
  const focusOrder = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); focusOrder.push(await player.evaluate(() => document.activeElement?.dataset.uiNode ?? document.activeElement?.tagName)); }
  assert(!focusOrder.includes('btn_noskin'), `disabled button is not focusable: ${focusOrder}`);
  log('title-focus', { focusOrder });

  await player.locator('[data-ui-node="btn_start"]').click();
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]')?.textContent.length > 20, null, { timeout: 30000 });
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="hp_boxed"]')?.offsetParent !== null);
  await page.waitForTimeout(600);
  const hudPlayerBox = await playerBox();
  const playerHud = await measure(player, ['hp_boxed', 'hp_legacy', 'ready_toggle', 'scale_slider', 'name_plain', 'name_boxed'], 'player');
  const playerTrack = await sample(page, hudPlayerBox, { x: 260, y: 30, width: 50, height: 8 }, 'player-hp-track');
  const playerLegacyTrack = await sample(page, hudPlayerBox, { x: 260, y: 62, width: 50, height: 8 }, 'player-hp-legacy-track');
  await page.screenshot({ path: path.join(output, 'player-dialogue.png'), clip: hudPlayerBox });
  const playerDialogue = await measure(player, ['box', 'speaker', 'body'], 'player');
  log('player-hud', { playerHud, playerTrack, playerLegacyTrack, canvasTrack, playerDialogue });

  // Progress track defaults: boxed track = legacy track = designer track.
  assert.equal(playerHud.hp_boxed.decor.background, canvasHud.hp_boxed.decor.background, 'progress track colour');
  assert.equal(playerHud.hp_boxed.decor.radius, canvasHud.hp_boxed.decor.radius, 'progress track radius');
  assert(close(playerTrack, playerLegacyTrack), `boxed track ${playerTrack} vs legacy ${playerLegacyTrack}`);
  assert(close(playerTrack, canvasTrack), `player track ${playerTrack} vs designer ${canvasTrack}`);
  // Content box: nine-slice frame on the outer box, children from Core's content box, no double deduction.
  assert.deepEqual(playerDialogue.box.decor.rect, { x: 120, y: 488, width: 1040, height: 208 });
  assert.deepEqual(playerDialogue.box.rect, { x: 158, y: 508, width: 964, height: 168 });
  assert.deepEqual(playerDialogue.body.rect, { x: 158, y: 548, width: 964, height: 120 });
  sameBoxes(canvasDialogue, playerDialogue, ['box', 'speaker', 'body'], ['box']);
  // Controls: wrapper on the outer box, native control exactly on the content box.
  assert.deepEqual(playerHud.ready_toggle.rect, { x: 340, y: 20, width: 120, height: 48 });
  assert.deepEqual(playerHud.ready_toggle.input.rect, { x: 382, y: 34, width: 36, height: 20 });
  assert.deepEqual(playerHud.scale_slider.input.rect, { x: 493, y: 29, width: 254, height: 22 });
  assert.notEqual(playerHud.name_plain.input.border, '0px', 'padding alone keeps the native field border');
  assert.notEqual(playerHud.name_plain.input.background, 'rgba(0, 0, 0, 0)', 'padding alone keeps the native field background');
  assert.equal(playerHud.name_boxed.input.border, '0px'); assert.equal(playerHud.name_boxed.input.background, 'rgba(0, 0, 0, 0)');
  // The canvas shows the same split: padding alone keeps a field inside the content box, an author fill replaces it.
  assert.match(canvasHud.name_plain.elementBackground, /^rgb\(.* content-box$/, canvasHud.name_plain.elementBackground);
  assert.match(canvasHud.name_boxed.elementBackground, /^rgba\(0, 0, 0, 0\)/, canvasHud.name_boxed.elementBackground);

  // A click on the toggle's padding operates the toggle and never reaches the stage.
  const bodyBefore = await player.evaluate(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]').textContent);
  const scale = hudPlayerBox.width / 1280;
  await page.mouse.click(hudPlayerBox.x + 346 * scale, hudPlayerBox.y + 44 * scale);
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="ready_toggle"] input').checked === true);
  await page.mouse.click(hudPlayerBox.x + 346 * scale, hudPlayerBox.y + 44 * scale);
  await player.waitForFunction(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="ready_toggle"] input').checked === false);
  await page.waitForTimeout(400);
  const bodyAfter = await player.evaluate(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]').textContent);
  assert.equal(bodyAfter, bodyBefore, 'padding clicks did not advance the story');
  // The input's padding focuses the native field.
  await page.mouse.click(hudPlayerBox.x + 784 * scale, hudPlayerBox.y + 42 * scale);
  assert.equal(await player.evaluate(() => document.activeElement?.closest('[data-ui-node]')?.dataset.uiNode), 'name_plain');
  log('padding-clicks', { bodyUnchanged: bodyAfter === bodyBefore });

  // 140% reading size from the slider (keyboard), then scrolling the long body.
  await player.locator('[data-ui-node="scale_slider"] input').focus();
  await page.keyboard.press('End');
  await player.waitForFunction(() => parseFloat(document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]').style.fontSize) > 36);
  await page.waitForTimeout(1500);
  const reading = await player.evaluate(() => {
    const body = document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]');
    return { fontSize: body.style.fontSize, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop, tabIndex: body.tabIndex };
  });
  assert.equal(reading.fontSize, '36.4px');
  assert(reading.scrollHeight > reading.clientHeight + 10, `body overflows at 140%: ${JSON.stringify(reading)}`);
  await player.locator('[data-ui-node="body"]').focus();
  await page.keyboard.press('Home');
  const top = await player.evaluate(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]').scrollTop);
  await page.keyboard.press('ArrowDown');
  const down = await player.evaluate(() => document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]').scrollTop);
  assert.equal(top, 0); assert(down > 0, 'ArrowDown scrolls the long body');
  const scaledBody = (await measure(player, ['body'], 'player')).body;
  assert.deepEqual(scaledBody.rect, { x: 158, y: 548, width: 964, height: 120 }, 'text scale keeps the content box');
  await page.screenshot({ path: path.join(output, 'player-dialogue-140.png'), clip: await playerBox() });
  log('reading-140', { reading, top, down });

  // Advance to the choices: the options are disabled until the toggle sets `ready`.
  await player.evaluate(() => document.activeElement?.blur());
  const stageCanvas = await iframe.boundingBox();
  for (let i = 0; i < 6 && !(await player.evaluate(() => !!document.querySelector('[data-surdet-project-ui] [data-ui-node="opt"]')?.offsetParent)); i++) {
    await page.mouse.click(stageCanvas.x + stageCanvas.width / 2, stageCanvas.y + stageCanvas.height * 0.35);
    await page.waitForTimeout(500);
  }
  await player.waitForFunction(() => document.querySelectorAll('[data-surdet-project-ui] [data-ui-node="opt"]').length === 2);
  const disabled = await player.evaluate(() => [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-node="opt"]')].map(button => ({ text: button.textContent, disabled: button.disabled, opacity: getComputedStyle(button).opacity,
    group: button.parentElement?.dataset.uiGroup === 'opt' ? getComputedStyle(button.parentElement).opacity : null, decorOpacity: getComputedStyle(button.previousElementSibling).opacity })));
  assert(disabled.every(item => item.disabled && item.group === '0.45' && item.opacity === '1' && item.decorOpacity === '1'), JSON.stringify(disabled));
  await player.locator('[data-ui-node="opt"]').first().click({ force: true });
  await page.waitForTimeout(300);
  assert.equal(await player.locator('[data-ui-node="opt"]').count(), 2, 'a disabled option cannot be chosen');
  await page.screenshot({ path: path.join(output, 'player-choices-disabled.png'), clip: await playerBox() });
  const playerChoices = await measure(player, ['list', 'opt'], 'player');
  await page.mouse.click(hudPlayerBox.x + 346 * scale, hudPlayerBox.y + 44 * scale);
  await player.waitForFunction(() => [...document.querySelectorAll('[data-surdet-project-ui] [data-ui-node="opt"]')].every(button => !button.disabled));
  // Keyboard only from here: Tab reaches an enabled option with a visible focus ring, Enter chooses it.
  const focusTrail = [];
  for (let i = 0; i < 12 && focusTrail.at(-1) !== 'opt'; i++) { await page.keyboard.press('Tab'); focusTrail.push(await player.evaluate(() => document.activeElement?.dataset.uiNode ?? document.activeElement?.tagName)); }
  const focus = await player.evaluate(() => { const active = document.activeElement, style = getComputedStyle(active);
    return { node: active?.dataset.uiNode, text: active?.textContent, visible: active?.matches(':focus-visible'), outline: `${style.outlineStyle} ${style.outlineWidth}` }; });
  focus.trail = focusTrail;
  await page.screenshot({ path: path.join(output, 'player-choices-enabled.png'), clip: await playerBox() });
  await page.keyboard.press('Enter');
  await player.waitForFunction(() => /留下来|追上去/.test(document.querySelector('[data-surdet-project-ui] [data-ui-node="body"]')?.textContent ?? ''), null, { timeout: 20000 });
  log('choices', { disabled, playerChoices, canvasChoices, focus });
  assert.equal(focus.node, 'opt'); assert.equal(focus.visible, true, `focus ring: ${JSON.stringify(focus)}`);
  assert.doesNotMatch(focus.outline, /^none|\b0px$/, `focused option draws an outline: ${focus.outline}`);
  sameBoxes(canvasChoices, playerChoices, ['list'], ['list']);

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
