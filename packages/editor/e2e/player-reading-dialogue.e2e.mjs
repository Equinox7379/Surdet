import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// The real shared Player (the Editor's ui-preview page) with a work-authored dialogue page whose
// body is shorter than a long line at 140%: the reader can scroll back, typing follows the tail
// only while the reader is there, a new line starts at its top, and one click advances once.
const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(editorRoot, 'dist');
await fs.access(path.join(dist, 'ui-preview.html'));
const outDir = process.env.SURDET_READING_E2E_OUTPUT;

const longLine = (mark, end) => `${mark}雨一直下到傍晚，站台上的灯一盏接一盏亮起来。她把车票折成很小的方块，又慢慢展开，像是要从折痕里读出什么答案。`
  + '远处的列车鸣了一声笛，人群开始往前挪动，伞面互相碰撞，水珠沿着伞骨滑落到鞋面上。她没有动，只是看着那盏最近的灯，'
  + `看它在雨里一点点晕开，直到整个站台都变成一片模糊的暖黄色。${end}`;
const scene = ['@scene start', `凛：${longLine('开头标记。', '结束标记。')}`, `凛：${longLine('第二句开头。', '第二句结束。')}`, '凛：第三句。', '@end', ''].join('\n');
const frame = (x, y, width, height) => ({ x, y, width, height });
const config = {
  title: 'Reading', version: '0.1.0', entryScene: 'start', characters: { lynn: { name: '凛' } }, variables: {},
  ui: { version: 1, pages: { dialogue: { id: 'box', type: 'container', frame: frame(80, 470, 1120, 230), children: [
    { id: 'speaker', type: 'text', frame: frame(24, 8, 300, 36), text: { kind: 'data', field: 'speaker' }, style: { fontSize: 24 } },
    { id: 'scale', type: 'slider', frame: frame(820, 8, 260, 32), binding: { kind: 'setting', name: 'textScale' }, text: { kind: 'literal', value: '文字大小' } },
    { id: 'body', type: 'text', frame: frame(24, 52, 1072, 90), text: { kind: 'data', field: 'dialogue' }, style: { fontSize: 28, fontRole: 'body' } },
  ] } } },
};
const payload = { type: 'surdet-ui-player-load', id: 'reading-dialogue-e2e', config, sceneTexts: { 'content/scenario/start.gal': scene },
  timelineFiles: {}, assetFiles: {}, fontFiles: {}, gallery: { cgs: [], music: [] } };
const host = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}iframe{display:block;width:100vw;height:100vh;border:0}</style>
<iframe id="player" src="./ui-preview.html" title="player"></iframe>
<script>addEventListener('message', (event) => { if (event.data?.type === 'surdet-ui-player-ready') document.getElementById('player').contentWindow.postMessage(window.readingPayload, location.origin); });</script>`;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (pathname === '/reading-host.html') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(host); return; }
    const target = path.resolve(dist, '.' + pathname);
    const relative = path.relative(dist, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403); response.end(); return; }
    try { const bytes = await fs.readFile(target); response.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream' }); response.end(bytes); }
    catch { response.writeHead(404); response.end('Not found'); }
  })().catch((error) => { response.writeHead(500); response.end(String(error)); });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/reading-host.html`;

const errors = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => { if (window === window.top) window.readingPayload = value; }, payload);
  await page.goto(url);
  const player = () => page.frames().find((candidate) => candidate.url().includes('ui-preview.html'));
  await page.waitForFunction(() => document.getElementById('player')?.contentWindow?.__surdetDebug?.uiSession?.base === 'title');
  await player().evaluate(() => window.__surdetDebug.titleSelect('new'));
  await player().waitForSelector('[data-ui-node="body"]');
  const body = () => player().evaluate(() => {
    const node = document.querySelector('[data-ui-node="body"]');
    return { text: node.textContent, size: parseFloat(getComputedStyle(node).fontSize), top: node.scrollTop, max: node.scrollHeight - node.clientHeight,
      status: window.__surdetDebug.rendererStatus, pointer: getComputedStyle(node).pointerEvents };
  });
  const frames = (count = 4) => player().evaluate((n) => new Promise((resolve) => { const step = (left) => left ? requestAnimationFrame(() => step(left - 1)) : resolve(); step(n); }), count);
  const bodyCentre = async () => {
    const box = await player().locator('[data-ui-node="body"]').boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // 1. The real slider writes 140% through the shared settings store; the body follows the tail while typing.
  await player().locator('[data-ui-node="scale"] input').focus();
  await page.keyboard.press('End');
  await player().waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('[data-ui-node="body"]')).fontSize) > 39);
  await player().locator('[data-ui-node="scale"] input').blur();
  assert.equal((await body()).size, 39.2);
  await player().waitForFunction(() => { const node = document.querySelector('[data-ui-node="body"]'); return node.scrollHeight - node.clientHeight > 40; });
  const typing = await body();
  assert.equal(typing.status, 'typing', 'the line is still typing');
  assert(typing.top >= typing.max - 1, `typing follows the newest words: ${JSON.stringify(typing)}`);
  assert.equal(typing.pointer, 'none', 'the body leaves clicks to the stage');
  console.log(`PASS real slider 140% (${typing.size}px); typing follows the tail`);

  // 2. Scrolling back while typing keeps the reader's place as the text grows.
  const centre = await bodyCentre();
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -60);
  await frames();
  const back = await body();
  assert(back.top < back.max - 1, `the wheel scrolls back: ${JSON.stringify(back)}`);
  await player().waitForFunction((length) => document.querySelector('[data-ui-node="body"]').textContent.length > length + 5, back.text.length);
  const kept = await body();
  assert.equal(kept.top, back.top, 'growing text does not pull the reader back to the tail');
  console.log(`PASS reading back while typing keeps the place (${back.top} of ${back.max})`);

  // 3. After typing stops the reader can reach the beginning, and it stays there.
  await player().waitForFunction(() => window.__surdetDebug.rendererStatus !== 'typing' && document.querySelector('[data-ui-node="body"]').textContent.endsWith('结束标记。'), undefined, { timeout: 60000 });
  await page.mouse.wheel(0, -5000);
  await frames(10);
  const start = await body();
  assert.equal(start.top, 0, 'the beginning is reachable');
  assert(start.text.startsWith('开头标记'), 'the same line is still shown');
  await frames(10);
  assert.equal((await body()).top, 0, 'an unchanged refresh does not move the reader');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'player-reading-back.png') });
  console.log('PASS after typing: the beginning stays reachable and in place');

  // 4. Keyboard: the overflowing body is focusable; End/Home scroll it without advancing the story.
  await player().locator('[data-ui-node="body"]').focus();
  await page.keyboard.press('End');
  const end = await body();
  assert(end.top >= end.max - 1 && end.text.startsWith('开头标记'), 'End reaches the tail without advancing');
  await page.keyboard.press('Home');
  assert.equal((await body()).top, 0, 'Home returns to the beginning');
  await player().locator('[data-ui-node="body"]').blur();
  console.log('PASS keyboard read-back without advancing');

  // 5. One click advances exactly one line; the new line starts at its top.
  await page.mouse.click(centre.x, centre.y);
  await player().waitForFunction(() => document.querySelector('[data-ui-node="body"]').textContent.startsWith('第二句开头'));
  const next = await body();
  assert(next.text.startsWith('第二句开头'), `one click shows the second line, not the third: ${next.text.slice(0, 12)}`);
  assert.equal(next.top, 0, 'a new line starts at its top');
  console.log('PASS one click advances once; the next line starts at its top');

  // 6. Narrow window: the body stays in the canvas and the wheel still reads back.
  await page.setViewportSize({ width: 800, height: 450 });
  await player().waitForFunction(() => window.__surdetDebug.rendererStatus !== 'typing' && document.querySelector('[data-ui-node="body"]').textContent.endsWith('第二句结束。'), undefined, { timeout: 60000 });
  await frames(6);
  const narrow = await bodyCentre();
  await page.mouse.move(narrow.x, narrow.y);
  await page.mouse.wheel(0, -5000);
  await frames(6);
  const narrowState = await body();
  assert.equal(narrowState.top, 0, 'the wheel reads back in a narrow window');
  const inside = await player().evaluate(() => {
    const canvas = document.querySelector('canvas').getBoundingClientRect(), node = document.querySelector('[data-ui-node="body"]').getBoundingClientRect();
    return node.left >= canvas.left - 1 && node.right <= canvas.right + 1 && node.bottom <= canvas.bottom + 1;
  });
  assert(inside, 'the body stays inside the canvas');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'player-reading-narrow.png') });
  console.log('PASS narrow window: body inside the canvas, wheel reads back');

  // 7. A body shorter than one line at 140% (48px) and one about a line high (57px): PageDown always
  //    moves forward and PageUp back, by a non-zero step, without advancing the story.
  for (const height of [48, 57]) {
    const small = structuredClone(payload);
    small.id = `reading-dialogue-e2e-${height}`;
    small.config.ui.pages.dialogue.children.find((node) => node.id === 'body').frame.height = height;
    const casePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    casePage.setDefaultTimeout(20000);
    casePage.on('pageerror', (error) => errors.push(error.message));
    await casePage.addInitScript((value) => { if (window === window.top) window.readingPayload = value; }, small);
    await casePage.goto(url);
    await casePage.waitForFunction(() => document.getElementById('player')?.contentWindow?.__surdetDebug?.uiSession?.base === 'title');
    const caseFrame = casePage.frames().find((candidate) => candidate.url().includes('ui-preview.html'));
    await caseFrame.evaluate(() => window.__surdetDebug.titleSelect('new'));
    await caseFrame.locator('[data-ui-node="scale"] input').focus();
    await casePage.keyboard.press('End');
    await caseFrame.locator('[data-ui-node="scale"] input').blur();
    await caseFrame.waitForFunction(() => window.__surdetDebug.rendererStatus !== 'typing' && document.querySelector('[data-ui-node="body"]').textContent.endsWith('结束标记。'), undefined, { timeout: 60000 });
    const read = () => caseFrame.evaluate(() => {
      const node = document.querySelector('[data-ui-node="body"]');
      return { top: node.scrollTop, max: node.scrollHeight - node.clientHeight, client: node.clientHeight, size: parseFloat(getComputedStyle(node).fontSize),
        pc: window.__surdetDebug.position?.pc, text: node.textContent.slice(0, 5) };
    });
    await caseFrame.locator('[data-ui-node="body"]').focus();
    await casePage.keyboard.press('Home');
    const first = await read();
    assert.equal(first.size, 39.2);
    assert(first.client < first.size * 1.45 + 1, `the ${height}px body holds at most one line at 140%: ${JSON.stringify(first)}`);
    assert.equal(first.top, 0);
    const downs = [first.top];
    for (let press = 0; press < 80 && downs.at(-1) < first.max - 1; press++) {
      await casePage.keyboard.press('PageDown');
      const next = (await read()).top;
      assert(next > downs.at(-1), `${height}px PageDown moves forward: ${downs.at(-1)} → ${next}`);
      downs.push(next);
    }
    assert(downs.at(-1) >= first.max - 1, `${height}px PageDown reaches the end`);
    const ups = [downs.at(-1)];
    for (let press = 0; press < 80 && ups.at(-1) > 0; press++) {
      await casePage.keyboard.press('PageUp');
      const next = (await read()).top;
      assert(next < ups.at(-1), `${height}px PageUp moves back: ${ups.at(-1)} → ${next}`);
      ups.push(next);
    }
    assert.equal(ups.at(-1), 0, `${height}px PageUp reaches the beginning`);
    const last = await read();
    assert.deepEqual({ pc: last.pc, text: last.text }, { pc: first.pc, text: first.text }, 'paging never advances the story');
    if (outDir) await casePage.screenshot({ path: path.join(outDir, `player-reading-${height}px.png`) });
    console.log(`PASS ${height}px body at 140%: PageDown ${downs.length - 1} steps forward, PageUp ${ups.length - 1} steps back`);
    await casePage.close();
  }

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS real Player long dialogue read-back');
} finally {
  await browser.close();
  server.close();
}
