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
// input chrome gives way only to the layer the author replaces; a boxed progress track keeps the legacy track.
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
    { id: 'log', type: 'scroll', frame: frame(40, 160, 400, 200), style: { border: line(2), padding: { top: 16, right: 16, bottom: 16, left: 16 } }, children: [
      { id: 'log_text', type: 'text', frame: frame(0, 0, 368, 400), text: { kind: 'literal', value: '记录'.repeat(200) } },
    ] },
    { id: 'panel', type: 'container', frame: frame(480, 160, 400, 200), style: { border: line(2), padding: { top: 16, right: 16, bottom: 16, left: 16 }, background: 0xeeeeee } },
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
      out[element.dataset.uiNode] = {
        rect: box(element), padding: computed.padding, pointer: computed.pointerEvents, background: computed.backgroundColor, radius: computed.borderTopLeftRadius,
        decor: decor && { rect: box(decor), pointer: getComputedStyle(decor).pointerEvents, background: getComputedStyle(decor.querySelector('[data-ui-decor-background]') ?? decor).backgroundColor, radius: getComputedStyle(decor).borderTopLeftRadius },
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
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
