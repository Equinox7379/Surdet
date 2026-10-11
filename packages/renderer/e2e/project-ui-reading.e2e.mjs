import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

// Work-authored DOM UI and the player's reading preferences: the dialogue body and option text
// follow textScale, the name plate and system pages do not; on/off settings are switches that
// keep keyboard focus after they change.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.SURDET_READING_E2E_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-project-ui-reading-'));
await fs.mkdir(output, { recursive: true });
const result = await build({ root, configFile: false, publicDir: false, logLevel: 'error', build: {
  write: false, minify: false, lib: { entry: path.join(root, 'packages/renderer/src/project-ui-dom.ts'), name: 'ReadingUi', formats: ['iife'] },
} });
const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []).filter(item => item.type === 'chunk' && item.isEntry);
assert.equal(chunks.length, 1);

const frame = (x, y, width, height) => ({ x, y, width, height });
const uiDocument = { version: 1, pages: {
  dialogue: { id: 'box', type: 'container', frame: frame(80, 500, 1120, 200), children: [
    { id: 'speaker', type: 'text', frame: frame(24, 8, 300, 36), text: { kind: 'data', field: 'speaker' }, style: { fontSize: 24 } },
    { id: 'body', type: 'text', frame: frame(24, 52, 1072, 90), text: { kind: 'data', field: 'dialogue' }, style: { fontSize: 28, fontRole: 'body' } },
  ] },
  choices: { id: 'list', type: 'content', source: 'choices', frame: frame(240, 160, 800, 300) },
  settings: { id: 'page', type: 'container', frame: frame(0, 0, 1280, 720), children: [
    { id: 'heading', type: 'text', frame: frame(40, 24, 400, 48), text: { kind: 'literal', value: '设置' }, style: { fontSize: 32 } },
    { id: 'rows', type: 'content', source: 'settings', frame: frame(40, 96, 900, 400) },
  ] },
} };

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><body style="margin:0;background:#111"><canvas width="1280" height="720" style="width:100vw;height:56.25vw;display:block"></canvas></body>');
  await page.addScriptTag({ content: chunks[0].code });
  await page.evaluate((document_) => {
    window.reading = { textScale: 1, reducedMotion: false, readAloud: true, actions: [] };
    window.readingUi = ReadingUi.createProjectUiDom({
      canvas: document.querySelector('canvas'),
      document: document_,
      theme: { colors: { text: 0xf4efe6, panel: 0x1b1d22, surface: 0x272a31, line: 0x5b6070, accent: 0xd98b4a, textOnAccent: 0x111111 }, typography: { uiSize: 20 }, radius: { md: 4, sm: 2 }, skins: {} },
      fontFamily: () => 'sans-serif', imageUrl: () => undefined, onError: error => { throw error; },
    });
    const longLine = '雨一直下到傍晚，站台上的灯一盏接一盏亮起来。她把车票折成很小的方块，又慢慢展开，像是要从折痕里读出什么答案。';
    const labels = { reducedMotion: '减少动态效果', readAloud: '朗读未配音台词', textScale: '文字大小' };
    window.readingContext = {
      data: field => field === 'speaker' ? '凛' : field === 'dialogue' ? longLine : undefined,
      read: (name) => window.reading[name],
      write: () => {}, bounds: () => ({ min: 0, max: 1, step: 1 }),
      content: source => source === 'choices'
        ? [{ id: '0', label: '留在站台' }, { id: '1', label: '追上去，把话说清楚' }]
        : Object.keys(labels).map(id => ({ id, label: labels[id], value: typeof window.reading[id] === 'boolean' ? (window.reading[id] ? '开启' : '关闭') : `${Math.round(window.reading[id] * 100)}%` })),
      select: () => true,
      action: action => {
        window.reading.actions.push(action);
        if (action.kind === 'setting-step' && typeof window.reading[action.name] === 'boolean') window.reading[action.name] = !window.reading[action.name];
      },
    };
    for (const id of ['dialogue', 'choices']) window.readingUi.show(id, window.readingContext);
  }, uiDocument);
  const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sizes = () => page.evaluate(() => {
    const px = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
    const body = document.querySelector('[data-ui-node="body"]');
    return { speaker: px('[data-ui-node="speaker"]'), body: px('[data-ui-node="body"]'), option: px('[data-ui-item="1"]'),
      bodyScroll: body.scrollTop, bodyOverflows: body.scrollHeight > body.clientHeight, bodyPointer: getComputedStyle(body).pointerEvents };
  });

  await nextFrame();
  const normal = await sizes();
  assert.equal(normal.speaker, 24); assert.equal(normal.body, 28);
  await page.evaluate(() => { window.reading.textScale = 1.4; });
  await nextFrame();
  const large = await sizes();
  assert.equal(large.speaker, 24, 'the name plate keeps the author size');
  assert(Math.abs(large.body - 28 * 1.4) < 0.01, `dialogue body follows the text scale: ${large.body}`);
  assert(Math.abs(large.option / normal.option - 1.4) < 0.01, `option text follows the text scale: ${normal.option} → ${large.option}`);
  assert.equal(large.bodyPointer, 'none', 'the body never takes clicks meant to advance the story');
  assert.equal(normal.bodyOverflows, false);
  assert(large.bodyOverflows && large.bodyScroll > 0, 'a body longer than its box keeps its newest words in view');
  await page.screenshot({ path: path.join(output, 'reading-140.png') });
  console.log(`PASS custom DOM body and options follow textScale; name plate unchanged ${JSON.stringify({ normal, large })}`);

  // Narrow window: the design canvas scales as a whole, the reading text stays inside the canvas.
  await page.setViewportSize({ width: 800, height: 450 });
  await page.evaluate(() => window.readingUi.resize());
  await nextFrame();
  const fits = await page.evaluate(() => {
    const canvas = document.querySelector('canvas').getBoundingClientRect(), body = document.querySelector('[data-ui-node="body"]').getBoundingClientRect();
    return body.left >= canvas.left - 1 && body.right <= canvas.right + 1 && body.bottom <= canvas.bottom + 1;
  });
  assert(fits, 'the dialogue body stays inside the scaled canvas in a narrow window');
  await page.screenshot({ path: path.join(output, 'reading-140-narrow.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.readingUi.resize());
  console.log('PASS narrow window keeps the scaled body inside the canvas');

  // System page: not scaled; on/off rows are switches that keep keyboard focus.
  await page.evaluate(() => window.readingUi.show('settings', window.readingContext));
  await nextFrame();
  assert.equal(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-ui-node="heading"]')).fontSize)), 32, 'system pages keep the author size');
  const toggle = page.locator('[data-ui-item="readAloud"] [role="switch"]');
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
  assert.equal(await toggle.innerText(), '开启');
  assert.equal(await page.locator('[data-ui-item="readAloud"] [data-ui-control^="step"]').count(), 0, 'an on/off row has no −/+ steppers');
  assert.equal(await page.locator('[data-ui-item="textScale"] [data-ui-control^="step"]').count(), 2, 'a number row keeps its steppers');
  await toggle.focus();
  await page.keyboard.press('Space');
  await nextFrame();
  const after = await page.evaluate(() => ({
    checked: document.querySelector('[data-ui-item="readAloud"] [role="switch"]').getAttribute('aria-checked'),
    focused: document.activeElement?.closest('[data-ui-item]')?.dataset.uiItem, control: document.activeElement?.dataset.uiControl,
    actions: window.reading.actions,
  }));
  assert.deepEqual(after, { checked: 'false', focused: 'readAloud', control: 'switch', actions: [{ kind: 'setting-step', name: 'readAloud', direction: 1 }] });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-ui-item]')?.dataset.uiItem), 'textScale', 'Tab moves on from the switch');
  await page.screenshot({ path: path.join(output, 'settings-switches.png') });
  console.log('PASS settings switch: role, state, keyboard toggle keeps focus, system page not scaled');

  await page.evaluate(() => window.readingUi.dispose());
  assert.deepEqual(errors, []);
  console.log(`PASS custom UI reading preferences / ${output}`);
} finally { await browser.close(); }
