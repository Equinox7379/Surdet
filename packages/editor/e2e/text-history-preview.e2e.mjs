import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Built Editor with the in-memory test file system. The second tag batch in the dialogue box
// (completion, toolbar, reading view) and the preview's reading history across a quick save and
// load: the history returns to the saved lines without a duplicate, styled lines keep their
// static markup, and trace evidence stays without the history.
const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(editorRoot, 'dist');
await fs.access(path.join(dist, 'index.html'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  void (async () => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const target = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(dist, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403); response.end(); return; }
    try { const bytes = await fs.readFile(target); response.writeHead(200, { 'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream' }); response.end(bytes); }
    catch { response.writeHead(404); response.end('Not found'); }
  })().catch((error) => { response.writeHead(500); response.end(String(error)); });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/`;

const source = [
  '@scene start',
  '凛：第一句<em>着重</em>。',
  '凛：第二句<shake>别动</shake>。',
  '凛：第三句<wave>轻声</wave>说。',
  '凛：第四句。',
  '凛：第五句。',
  '凛：普通的一句话。',
  '@end',
].join('\n');
const files = Object.entries({
  'game.config.json': JSON.stringify({ entryScene: 'start', characters: { lynn: { name: '凛' } } }),
  'content/scenario/start.gal': source,
}).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));

const outDir = process.env.SURDET_TEXT_HISTORY_E2E_OUTPUT;
const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-text-history-test', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.v4-authoring .block[data-line="6"]').waitFor();
  const row = (line) => page.locator(`.v4-authoring .block[data-line="${line}"]`);
  const box = (line) => row(line).locator('.v4-dialogue-input');

  // 1. Reading view marks emphasis and the static effects; the source keeps the tags.
  await page.locator('h1').first().click();
  const marks = await page.evaluate(() => ({
    em: [...document.querySelectorAll('.block[data-line="1"] .v4-inline-view .v4-inline-emphasis')].map((node) => node.textContent).join(''),
    shake: document.querySelector('.block[data-line="2"] .v4-inline-view .v4-inline-shake')?.title,
    wave: document.querySelector('.block[data-line="3"] .v4-inline-view .v4-inline-wave')?.title,
  }));
  assert.deepEqual(marks, { em: '着重', shake: '逐字抖动', wave: '逐字波浪' });
  console.log('PASS reading view: emphasis dots, shake and wave marked without animation');

  // 2. Completion offers the new tags; <nw> is inserted as a single tag and shown as an auto-continue mark.
  await box(6).click();
  await box(6).evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
  await page.keyboard.type('<');
  const list = row(6).locator('.v4-inline-completion code');
  await list.first().waitFor();
  const labels = await list.allTextContents();
  for (const label of ['<em>', '<shake>', '<wave>', '<nw>']) assert(labels.includes(label), `completion offers ${label}: ${labels}`);
  await page.keyboard.type('nw');
  await page.keyboard.press('Enter');
  assert.equal(await box(6).inputValue(), '普通的一句话。<nw>');
  await page.locator('h1').first().click();
  assert.equal(await row(6).locator('.v4-inline-view .v4-inline-pause').innerText(), '↦');
  console.log('PASS completion: em/shake/wave/nw offered; <nw> inserted alone and shown as auto-continue');

  // 3. Toolbar wraps with emphasis; a misplaced <nw> is M006 and F8 selects it exactly.
  await box(5).click();
  await box(5).evaluate((node) => { node.setSelectionRange(0, 2); node.dispatchEvent(new Event('select')); });
  await row(5).getByRole('button', { name: '着重号' }).click();
  assert.equal(await box(5).inputValue(), '<em>第五</em>句。');
  await box(5).evaluate((node) => node.setSelectionRange(node.value.indexOf('句'), node.value.indexOf('句')));
  await page.keyboard.type('<nw>');
  await page.waitForFunction(() => [...document.querySelectorAll('#issues-box button.issue')].some((node) => node.textContent.includes('M006')));
  await page.locator('h1').first().click();
  await page.keyboard.press('F8');
  const located = await box(5).evaluate((node) => ({ active: node === document.activeElement, selected: node.value.slice(node.selectionStart, node.selectionEnd) }));
  assert.deepEqual(located, { active: true, selected: '<nw>' });
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => ![...document.querySelectorAll('#issues-box button.issue')].some((node) => node.textContent.includes('M006')));
  if (outDir) await page.screenshot({ path: path.join(outDir, 'text-history-editor.png') });
  console.log('PASS toolbar emphasis; M006 located exactly by F8 and cleared after the fix');

  // 4. Preview: quick save at the third line, read on, quick load returns the saved history.
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  const debug = (read) => page.evaluate(`(() => { const debug = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return debug?.interp && debug?.runtime ? (${read})(debug) : null; })()`);
  const waitDebug = (read) => page.waitForFunction(`(() => { const debug = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return Boolean(debug?.interp && debug?.runtime && (${read})(debug)); })()`);
  const press = async (key) => { await page.locator('iframe.preview-frame').focus(); await page.keyboard.press(key); };
  const history = () => debug('(d) => d.runtime.queries.dialogue.backlogEntries().map((entry) => ({ text: entry.text, markup: entry.markup ?? null }))');
  const shown = '(d) => d.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText ?? ""';
  await waitDebug(`(d) => (${shown})(d).startsWith('第一句') && d.interp.status === 'awaiting-advance'`);
  for (const next of ['第二句', '第三句']) {
    await press('Enter');
    await waitDebug(`(d) => (${shown})(d).startsWith('${next}') && d.interp.status === 'awaiting-advance'`);
  }
  const saved = await history();
  assert.deepEqual(saved.map((entry) => entry.text), ['第一句着重。', '第二句别动。', '第三句轻声说。']);
  assert.equal(saved[0].markup, '第一句<em>着重</em>。', 'emphasis stays as static markup');
  assert(!saved.some((entry) => /shake|wave/.test(entry.markup ?? '')), 'motion tags are not kept in the history');
  await press('F5');
  await page.waitForTimeout(500); // the quick save is written asynchronously
  for (const next of ['第四句', '<em>第五']) {
    await press('Enter');
    await waitDebug(`(d) => (${shown})(d).startsWith('${next.replace(/<[^>]+>/g, '')}') && d.interp.status === 'awaiting-advance'`);
  }
  assert.equal((await history()).length, 5);
  await press('F9');
  await waitDebug(`(d) => (${shown})(d).startsWith('第三句') && d.runtime.queries.dialogue.backlogEntries().length === 3`);
  const restored = await history();
  assert.deepEqual(restored, saved, 'quick load returns the saved history, the current line recorded once');
  await press('Enter');
  await waitDebug(`(d) => (${shown})(d).startsWith('第四句') && d.interp.status === 'awaiting-advance'`);
  assert.deepEqual((await history()).map((entry) => entry.text), ['第一句着重。', '第二句别动。', '第三句轻声说。', '第四句。']);
  await press('l');
  await waitDebug('(d) => d.runtime.queries.diagnostics.projectionSnapshot().dialogue?.backlogVisible === true');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'text-history-preview.png') });
  await press('l');
  console.log('PASS preview quick save/load restores the saved reading history once, with static markup');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS second tag batch and preview reading history');
} finally {
  await browser.close();
  server.close();
}
