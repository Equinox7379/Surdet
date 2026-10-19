import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// U1 box fields on interactive nodes, in the real Project UI DOM: a boxed toggle/slider wrapper owns the outer box and
// its native control fills exactly the content box; presses on the border/padding operate the control and never
// reach the stage; framed scroll areas keep their frame off the stage while containers stay click-through; native
// input chrome gives way only to the layer the author replaces; a boxed progress track keeps the legacy track;
// a decorated node fades as one group (whole-node opacity), and boxed containers/tabs clip children to the content box.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_UI_STYLE_CONTROLS_E2E_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-project-ui-style-controls-'));
await fs.mkdir(output, { recursive: true });
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: path.join(root, 'packages/renderer/src/project-ui-dom.ts'), name: 'StyleUi', formats: ['iife'] },
} });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).filter(item => item.type === 'chunk' && item.isEntry);
assert.equal(chunks.length, 1);

const frame = (x, y, width, height) => ({ x, y, width, height });
const line = width => ({ width, color: 0x335577, opacity: 1 });
const uiDocument = { version: 1, pages: {
  hud: { id: 'hud_root', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'toggle_boxed', type: 'toggle', frame: frame(40, 20, 120, 48), binding: { kind: 'variable', name: 'ready' }, text: { kind: 'literal', value: '准备' },
      style: { border: line(2), padding: { top: 12, right: 40, bottom: 12, left: 40 }, background: 0xffffff } },
    { id: 'toggle_legacy', type: 'toggle', frame: frame(200, 20, 40, 40), binding: { kind: 'variable', name: 'ready' }, text: { kind: 'literal', value: '旧开关' } },
    { id: 'slider_boxed', type: 'slider', frame: frame(260, 20, 280, 40), binding: { kind: 'setting', name: 'textScale' }, text: { kind: 'literal', value: '文字大小' },
      style: { border: line(1), padding: { top: 8, right: 12, bottom: 8, left: 12 }, background: 0xffffff } },
    { id: 'input_plain', type: 'input', frame: frame(560, 20, 220, 44), binding: { kind: 'variable', name: 'nickname' }, style: { padding: { top: 6, right: 10, bottom: 6, left: 10 } } },
    { id: 'input_radius', type: 'input', frame: frame(800, 20, 220, 44), binding: { kind: 'variable', name: 'nickname' }, style: { borderRadius: 8 } },
    { id: 'input_boxed', type: 'input', frame: frame(1040, 20, 220, 44), binding: { kind: 'variable', name: 'nickname' }, style: { background: 0xffffff, border: line(2), borderRadius: 8 } },
    { id: 'hp_boxed', type: 'progress', frame: frame(40, 90, 280, 20), binding: { kind: 'variable', name: 'hp' }, style: { border: line(1) } },
    { id: 'hp_legacy', type: 'progress', frame: frame(40, 120, 280, 20), binding: { kind: 'variable', name: 'hp' } },
    { id: 'toggle_small', type: 'toggle', frame: frame(360, 90, 120, 48), binding: { kind: 'variable', name: 'ready' },
      style: { border: line(2), padding: { top: 20, right: 40, bottom: 20, left: 40 } } },
    { id: 'slider_small', type: 'slider', frame: frame(520, 90, 280, 32), binding: { kind: 'setting', name: 'textScale' },
      style: { border: line(2), padding: { top: 12, right: 12, bottom: 12, left: 12 } } },
    { id: 'log', type: 'scroll', frame: frame(40, 160, 400, 200), style: { border: line(2), padding: { top: 16, right: 16, bottom: 16, left: 16 } }, children: [
      { id: 'log_text', type: 'text', frame: frame(0, 0, 368, 400), text: { kind: 'literal', value: '记录'.repeat(200) } },
    ] },
    { id: 'panel', type: 'container', frame: frame(480, 160, 400, 200), style: { border: line(2), padding: { top: 16, right: 16, bottom: 16, left: 16 }, background: 0xeeeeee } },
    // Whole-node opacity: the fill is drawn over the red track first, then the assembled bar fades once.
    { id: 'fade_bar', type: 'progress', frame: frame(40, 400, 280, 20), binding: { kind: 'variable', name: 'hp' }, style: { border: line(1), background: 0xff0000, opacity: 0.5 } },
    { id: 'fade_button', type: 'button', frame: frame(340, 390, 120, 40), text: { kind: 'literal', value: '淡' }, enabledWhen: 'ready',
      style: { background: 0xffffff, border: line(1), opacity: 0.5 } },
    { id: 'hidden_box', type: 'text', frame: frame(1040, 400, 200, 40), visibleWhen: 'hp > 50', text: { kind: 'literal', value: '隐' }, style: { background: 0xffffff, border: line(1) } },
    // Children reaching past a boxed parent's content box are clipped there (paint and input); legacy parents are not.
    { id: 'clip_box', type: 'container', frame: frame(480, 400, 300, 160), style: { border: line(2), padding: { top: 16, right: 16, bottom: 16, left: 16 }, background: 0xeeeeee }, children: [
      { id: 'clip_child', type: 'button', frame: frame(-40, 20, 120, 40), text: { kind: 'literal', value: '裁' } },
    ] },
    { id: 'clip_legacy', type: 'container', frame: frame(820, 460, 200, 100), children: [
      { id: 'legacy_child', type: 'button', frame: frame(-40, 20, 120, 40), text: { kind: 'literal', value: '旧' } },
    ] },
    { id: 'clip_tabs', type: 'tabs', frame: frame(40, 440, 400, 200), style: { border: line(2), padding: { top: 10, right: 10, bottom: 10, left: 10 }, background: 0xeeeeee }, children: [
      { id: 'tab_child', type: 'button', tab: '甲', frame: frame(-30, 10, 100, 30), text: { kind: 'literal', value: '页' } },
    ] },
  ] },
} };

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><body style="margin:0;background:#111"><canvas width="1280" height="720" style="width:100vw;height:56.25vw;display:block"></canvas></body>');
  await page.addScriptTag({ content: chunks[0].code });
  await page.evaluate((document_) => {
    window.values = { ready: false, textScale: 1, nickname: '凛', hp: 40 };
    window.writes = []; window.stageClicks = 0;
    document.querySelector('canvas').addEventListener('click', () => { window.stageClicks++; });
    window.styleUi = StyleUi.createProjectUiDom({
      canvas: document.querySelector('canvas'),
      document: document_,
      theme: { colors: { text: 0xf4efe6, panel: 0x1b1d22, surface: 0x272a31, line: 0x5b6070, accent: 0xd98b4a, textOnAccent: 0x111111 }, typography: { uiSize: 20 }, radius: { md: 4, sm: 2 }, skins: {} },
      fontFamily: () => 'sans-serif', imageUrl: () => undefined, onError: error => { throw error; },
    });
    window.styleUi.show('hud', {
      data: () => undefined,
      read: name => window.values[name],
      write: (binding, value) => { window.writes.push([binding.name, value]); window.values[binding.name] = value; window.styleUi.refresh(); },
      bounds: binding => binding.name === 'hp' ? { min: 0, max: 100, step: 1 } : { min: 1, max: 1.4, step: 0.05 },
      content: () => [], select: () => true, action: () => {},
    });
  }, uiDocument);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = element => { const r = element.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const snapshot = () => page.evaluate(({ boxSource }) => {
    const box = eval(boxSource);
    const out = {};
    for (const element of document.querySelectorAll('[data-surdet-project-ui] [data-ui-node]')) {
      const decor = element.previousElementSibling?.matches('[data-ui-decor]') ? element.previousElementSibling : null;
      const input = element.querySelector('input'), computed = getComputedStyle(element);
      const group = element.parentElement?.dataset.uiGroup === element.dataset.uiNode ? element.parentElement : null;
      out[element.dataset.uiNode] = {
        rect: box(element), padding: computed.padding, pointer: computed.pointerEvents, background: computed.backgroundColor, radius: computed.borderTopLeftRadius,
        opacity: computed.opacity, overflow: computed.overflow,
        group: group && { rect: box(group), opacity: getComputedStyle(group).opacity, pointer: getComputedStyle(group).pointerEvents, hidden: group.hidden, layers: [...group.children].map(child => child === decor ? 'decor' : child === element ? 'node' : '?') },
        decor: decor && { rect: box(decor), pointer: getComputedStyle(decor).pointerEvents, background: getComputedStyle(decor.querySelector('[data-ui-decor-background]') ?? decor).backgroundColor, radius: getComputedStyle(decor).borderTopLeftRadius, opacity: getComputedStyle(decor).opacity, shown: decor.getClientRects().length > 0 },
        input: input && { rect: box(input), margin: getComputedStyle(input).margin, border: getComputedStyle(input).borderTopWidth, background: getComputedStyle(input).backgroundColor, radius: getComputedStyle(input).borderTopLeftRadius },
      };
    }
    return out;
  }, { boxSource: box.toString() });
  const nodes = await snapshot();
  await page.screenshot({ path: path.join(output, 'style-controls.png') });

  // Boxed controls: wrapper on the outer box, native control exactly on Core's content box (no UA margin).
  assert.deepEqual(nodes.toggle_boxed.rect, { x: 40, y: 20, width: 120, height: 48 });
  assert.deepEqual(nodes.toggle_boxed.input.rect, { x: 82, y: 34, width: 36, height: 20 });
  assert.equal(nodes.toggle_boxed.input.margin, '0px');
  assert.deepEqual(nodes.toggle_boxed.decor.rect, nodes.toggle_boxed.rect);
  assert.deepEqual(nodes.slider_boxed.input.rect, { x: 273, y: 29, width: 254, height: 22 });
  assert.equal(nodes.slider_boxed.input.margin, '0px');
  // A valid 4px-tall content box must not be displaced by the wrapper's larger text baseline.
  assert.deepEqual(nodes.toggle_small.input.rect, { x: 402, y: 112, width: 36, height: 4 });
  assert.deepEqual(nodes.slider_small.input.rect, { x: 534, y: 104, width: 252, height: 4 });
  // An unstyled legacy toggle keeps its existing native layout.
  assert.deepEqual(nodes.toggle_legacy.rect, { x: 200, y: 20, width: 40, height: 40 });
  assert.notEqual(nodes.toggle_legacy.input.margin, '0px', 'legacy checkbox keeps the UA margin');
  console.log(`PASS boxed toggle/slider fill the content box ${JSON.stringify({ toggle: nodes.toggle_boxed.input.rect, slider: nodes.slider_boxed.input.rect })}`);

  // Native input chrome: padding alone keeps it; a radius alone rounds the native field; an author fill/border replaces it.
  assert.notEqual(nodes.input_plain.input.border, '0px'); assert.notEqual(nodes.input_plain.input.background, 'rgba(0, 0, 0, 0)');
  assert.deepEqual(nodes.input_plain.input.rect, { x: 570, y: 26, width: 200, height: 32 });
  assert.notEqual(nodes.input_radius.input.border, '0px'); assert.equal(nodes.input_radius.input.radius, '8px');
  assert.equal(nodes.input_boxed.input.border, '0px'); assert.equal(nodes.input_boxed.input.background, 'rgba(0, 0, 0, 0)');
  assert.equal(nodes.input_boxed.input.radius, '6px', 'inside a 2px author border the field follows the inner corner');
  console.log('PASS input chrome gives way only to the replaced layer');

  // Progress: a boxed track (border only) keeps the legacy track colour and radius.
  assert.equal(nodes.hp_boxed.decor.background, 'rgb(39, 42, 49)'); assert.equal(nodes.hp_boxed.decor.radius, '2px');
  assert.equal(nodes.hp_legacy.background, 'rgb(39, 42, 49)'); assert.equal(nodes.hp_legacy.radius, '2px');
  console.log('PASS boxed progress track = legacy track (surface, radius.sm)');

  // Presses on control frames operate the control, never the stage.
  await page.mouse.click(46, 44);
  assert.deepEqual(await page.evaluate(() => ({ writes: window.writes, stage: window.stageClicks })), { writes: [['ready', true]], stage: 0 });
  await page.mouse.click(156, 64);
  assert.deepEqual(await page.evaluate(() => ({ writes: window.writes, stage: window.stageClicks })), { writes: [['ready', true], ['ready', false]], stage: 0 });
  await page.mouse.click(264, 40);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-ui-node]')?.dataset.uiNode), 'slider_boxed');
  await page.mouse.click(563, 42);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-ui-node]')?.dataset.uiNode), 'input_plain');
  assert.equal(await page.evaluate(() => window.stageClicks), 0, 'control frames keep presses');
  console.log('PASS toggle/slider/input frames operate their control');

  // A framed scroll area keeps presses on its border and padding; a plain container stays click-through.
  assert.equal(nodes.log.decor.pointer, 'auto'); assert.equal(nodes.panel.decor.pointer, 'none');
  await page.mouse.click(41, 161); await page.mouse.click(48, 200);
  assert.equal(await page.evaluate(() => window.stageClicks), 0, 'scroll frame does not advance the story');
  await page.mouse.click(484, 200);
  assert.equal(await page.evaluate(() => window.stageClicks), 1, 'container frame stays click-through');
  console.log('PASS scroll frame keeps presses; container stays click-through');

  // Whole-node opacity: decoration and content share one group that carries the opacity; neither layer fades alone.
  for (const id of ['fade_bar', 'fade_button', 'toggle_boxed', 'clip_box']) {
    assert.deepEqual(nodes[id].group.layers, ['decor', 'node'], id);
    assert.deepEqual(nodes[id].group.rect, nodes[id].decor.rect, id); assert.equal(nodes[id].group.pointer, 'none', id);
    assert.equal(nodes[id].decor.opacity, '1', id); assert.equal(nodes[id].opacity, '1', id);
  }
  assert.equal(nodes.fade_bar.group.opacity, '0.5');
  assert.equal(Number(nodes.fade_button.group.opacity).toFixed(3), '0.225', 'disabled boxed button: node opacity × 0.45 on the group');
  assert.equal(nodes.toggle_legacy.group, null); assert.equal(nodes.hp_legacy.group, null);
  assert.equal(nodes.hidden_box.group.hidden, true); assert.equal(nodes.hidden_box.decor.shown, false, 'a hidden node hides its decoration too');
  // Pixel proof on the fill: fading once gives accent·0.5 + page·0.5 (117,78,46); fading layers separately would
  // composite the fill over a half-transparent red track (≈177,74,41).
  const shot = (await page.screenshot()).toString('base64');
  const pixel = await page.evaluate(async ({ shot, x, y }) => {
    const image = new Image(); image.src = `data:image/png;base64,${shot}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
  }, { shot, x: 60, y: 410 });
  for (const [channel, expected] of [117, 78, 46].entries()) assert(Math.abs(pixel[channel] - expected) <= 3, `fill pixel ${JSON.stringify(pixel)} ≠ [117,78,46]`);
  console.log(`PASS decorated nodes fade as one group ${JSON.stringify({ pixel, button: nodes.fade_button.group.opacity })}`);

  // Boxed container/tabs clip their children at Core's content box, for paint and input; a legacy container does not.
  assert.equal(nodes.clip_box.overflow, 'hidden'); assert.equal(nodes.clip_tabs.overflow, 'hidden'); assert.equal(nodes.clip_legacy.overflow, 'visible');
  assert.deepEqual(nodes.clip_box.rect, { x: 498, y: 418, width: 264, height: 124 });
  // The node under a point, or `frame:<id>` when a decorated node's own frame takes the press.
  const hit = (x, y) => page.evaluate(([x, y]) => {
    const target = document.elementFromPoint(x, y), decor = target?.closest('[data-ui-decor]');
    return decor ? `frame:${decor.parentElement.dataset.uiGroup}` : target?.closest('[data-ui-node]')?.dataset.uiNode ?? null;
  }, [x, y]);
  assert.equal(await hit(470, 458), null, 'outside the boxed parent'); assert.equal(await hit(490, 458), null, 'on the parent border/padding');
  assert.equal(await hit(520, 458), 'clip_child');
  assert.equal(await hit(30, 515), null); assert.equal(await hit(45, 515), 'frame:clip_tabs', 'the tabs frame keeps the press, not the child'); assert.equal(await hit(80, 515), 'tab_child');
  assert.equal(await hit(800, 500), 'legacy_child', 'legacy container keeps overflow visible');
  console.log('PASS boxed container/tabs clip children to the content box; legacy container unchanged');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
