import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseInlineText, textTranslationIssue } from '@surdet/core';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Built Editor with the in-memory test file system: the search panel's two modes (shown text and
// source) and inline tags on the translation page, through the real buttons.
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
  '@label opening',
  '@wait 300',
  '凛：<color=accent>危</color>险，真的危险。',
  '凛：<b>重要</b>的事。',
  '@choice',
  '  <b>危险</b>的路 [if:trust > 1] -> @goto after',
  '  留下 -> @goto after',
  '@label after',
  '凛：到了。',
  '@end',
  '',
].join('\n');
const files = Object.entries({
  'game.config.json': JSON.stringify({ entryScene: 'start', variables: { trust: { type: 'number', initial: 2 } }, characters: { lynn: { name: '凛' } } }),
  'content/scenario/start.gal': source,
}).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));

const outDir = process.env.SURDET_TRANSLATION_SEARCH_E2E_OUTPUT;
const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-translation-search-test', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(url);
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.v4-authoring .block[data-line="4"]').waitFor();
  const status = () => page.locator('#status').innerText();
  const sceneText = () => page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text);
  const undoUntil = async (expected) => {
    await page.locator('h1').first().click();
    for (let step = 0; step < 10 && (await sceneText()) !== expected; step++) await page.keyboard.press('Control+z');
    assert.equal(await sceneText(), expected, 'undo returns the earlier source');
  };

  // ---- Search ----
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+f');
  const query = page.locator('#search-input');
  const mode = page.getByLabel('查找方式', { exact: true });
  const items = page.locator('.search-item');
  const empty = page.locator('.search-empty');
  const search = async (text) => { await query.fill(text); await page.waitForTimeout(100); };
  const lines = async () => (await items.evaluateAll((nodes) => nodes.map((node) => node.querySelector('.search-location').textContent)))
    .map((location) => Number(location.split(' · ')[1]) - 1);

  // 1. Shown text by default: dialogue and option text as the player sees it, across tags; nothing else.
  assert.equal(await mode.inputValue(), 'visible');
  assert.equal(await query.getAttribute('placeholder'), '查找对白和选项文字');
  await search('危险');
  assert.deepEqual(await lines(), [3, 6]);
  assert.deepEqual(await items.locator('.search-excerpt').evaluateAll((nodes) => nodes.map((node) => [node.textContent, node.title])), [
    ['危险，真的危险。', '按显示文字匹配（跨过了样式标签）'],
    ['危险的路', '按显示文字匹配'],
  ]);
  for (const hidden of ['@wait', 'trust', 'goto', '凛', '<b>']) {
    await search(hidden);
    assert.equal(await items.count(), 0, `${hidden} is not shown text`);
    assert.match(await empty.innerText(), /请改为按原文查找/);
  }
  if (outDir) await page.screenshot({ path: path.join(outDir, 'search-visible.png') });
  console.log('PASS shown-text search: dialogue and options across tags; speaker, instructions, conditions, jumps and tags are not shown text');

  // 2. Source: every row as written, with a clear label.
  await mode.selectOption('source');
  assert.equal(await query.getAttribute('placeholder'), '查找剧本原文');
  for (const [text, expected] of [['@wait', [2]], ['trust', [6]], ['goto', [6, 7]], ['凛', [3, 4, 9]], ['<b>', [4, 6]], ['危险', [3, 6]]]) {
    await search(text);
    assert.deepEqual(await lines(), expected, `source search for ${text}`);
  }
  assert.deepEqual(await items.locator('.search-excerpt').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.title))]), ['按原文匹配']);
  assert.match(await items.first().locator('.search-excerpt').textContent(), /<color=accent>危<\/color>险，真的危险。$/, 'the source row is shown as written');
  assert.equal(await items.first().locator('.search-excerpt mark').textContent(), '危险', 'the source match is the run written in the row');
  console.log('PASS source search: every row as written, tags, speakers, instructions, conditions and jumps included');

  // 3. Shown-text replacement writes text only; a match across a tag is left and reported.
  await mode.selectOption('visible');
  await search('危险');
  await page.getByRole('button', { name: '展开或收起替换' }).click();
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('<i>安全</i>');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  const dialog = page.locator('.search-replace-dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /查找（按显示文字）：危险 → <i>安全<\/i>/);
  assert.match(await dialog.locator('.search-replace-skipped').innerText(), /另有 1 处跨过或位于行内标签内/);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'search-replace-visible.png') });
  await page.getByRole('button', { name: '确认替换' }).click();
  const replaced = source
    .replace('凛：<color=accent>危</color>险，真的危险。', '凛：<color=accent>危</color>险，真的\\<i>安全\\</i>。')
    .replace('  <b>危险</b>的路', '  <b>\\<i>安全\\</i></b>的路');
  assert.equal(await sceneText(), replaced, 'tags typed as replacement are written as text; the crossing match is unchanged');
  await undoUntil(source);
  console.log('PASS shown-text replacement: text written escaped, the match across a tag skipped and reported, undo restores');

  // 4. Source replacement is written as typed, unless it would break a dialogue's or option's tags.
  await page.keyboard.press('Control+f');
  await mode.selectOption('source');
  await search('</b>');
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  await page.waitForFunction(() => /另有 2 行替换后会让对白或选项的标签出错/.test(document.querySelector('#status')?.textContent ?? ''));
  assert.equal(await dialog.count(), 0, 'nothing safe to replace, no preview');
  assert.equal(await sceneText(), source);
  await search('trust');
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('faith');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /查找（按原文（含标签））：trust → faith/);
  await page.getByRole('button', { name: '确认替换' }).click();
  assert.equal(await sceneText(), source.replace('[if:trust > 1]', '[if:faith > 1]'), 'a condition is replaced in source mode');
  await undoUntil(source);
  await page.keyboard.press('Control+f');
  await search('accent');
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('danger');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  await dialog.waitFor();
  await page.getByRole('button', { name: '确认替换' }).click();
  assert.equal(await sceneText(), source.replace('<color=accent>', '<color=danger>'), 'a tag value edited as source stays a valid tag');
  await undoUntil(source);
  console.log('PASS source replacement: written as typed in conditions and tag values; rows whose tags would break are left and reported');

  // ---- Translation page ----
  // The catalog binds saved script text; the undone replacements above left the scene marked unsaved.
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved');
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('[data-config-section-target="texts"]').click();
  const catalog = page.locator('.text-catalog');
  const entries = catalog.locator('.text-catalog-entries');
  const sourceSelect = catalog.getByLabel('当前文本来源', { exact: true });
  await catalog.getByRole('button', { name: '读取文本目录' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="当前文本来源"] option').length > 0);
  const bindSource = async (needle, key) => {
    const value = await sourceSelect.evaluate((select, needle) => [...select.options].find((option) => option.textContent.includes(needle))?.value, needle);
    assert(value, `source containing ${needle}`);
    await sourceSelect.selectOption(value);
    await catalog.getByLabel('稳定文本键', { exact: true }).fill(key);
    await catalog.getByRole('button', { name: '加入绑定清单' }).click();
  };
  await bindSource('<b>重要</b>的事。', 'line.important');
  await bindSource('<b>危险</b>的路', 'choice.road');
  await catalog.getByRole('button', { name: '绑定清单并保存' }).click();
  await page.waitForFunction(() => document.querySelector('.text-catalog')?.textContent.includes('译稿目录已保存'));

  // 5. Source texts show their tags as marks; the row reads the same as the text (entries in binding order).
  assert.deepEqual(await entries.locator('.text-catalog-tag').allTextContents(), ['<b>', '</b>', '<b>', '</b>']);
  assert.deepEqual(await entries.locator('.text-catalog-entry').evaluateAll((rows) => rows.map((row) => row.textContent)), [
    'line.important · 未翻译 · 凛：<b>重要</b>的事。 →  · 配音：未关联',
    'choice.road · 未翻译 · <b>危险</b>的路 → ',
  ]);
  console.log('PASS translation page: source tags shown as marks for dialogue and option entries');

  // 6. Import: Core's check refuses a pause in an option translation; tags need not match the source one for one.
  await catalog.getByRole('button', { name: '载入已保存译稿' }).click();
  const csv = catalog.getByLabel('译稿表格', { exact: true });
  await page.waitForFunction(() => document.querySelector('[aria-label="译稿表格"]')?.value.includes('line.important'));
  // The exported sheet quotes every cell (the context cell holds commas); the translation is the seventh.
  const csvCells = (row) => {
    const cells = []; let cell = '', quoted = false;
    for (let index = 0; index < row.length; index++) {
      const char = row[index];
      if (quoted && char === '"' && row[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
      else cell += char;
    }
    return [...cells, cell];
  };
  const translate = (text, values) => text.split('\n').map((row, index) => {
    const cells = index === 0 || !row ? [] : csvCells(row);
    return cells[0] in values ? [...cells.slice(0, 6), values[cells[0]], ...cells.slice(7)].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',') : row;
  }).join('\n');
  const exported = await csv.inputValue();
  const important = 'An <b>important</b> <i>thing</i>. <x>', roadPause = 'The <w>road', road = 'The <color=accent>dangerous</color> road';
  await csv.fill(translate(exported, { 'line.important': important, 'choice.road': roadPause }));
  await catalog.getByRole('button', { name: '预览导入差异' }).click();
  await page.waitForFunction(() => document.querySelector('.text-catalog')?.textContent.includes('导入未通过'));
  assert.match(await catalog.locator('.text-catalog-differences .error').innerText(), new RegExp(textTranslationIssue('危险的路', roadPause, 'choice').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await csv.fill(translate(exported, { 'line.important': important, 'choice.road': road }));
  await catalog.getByRole('button', { name: '预览导入差异' }).click();
  await page.waitForFunction(() => document.querySelector('.text-catalog')?.textContent.includes('差异预览通过'));
  const differences = catalog.locator('.text-catalog-differences');
  assert.deepEqual(await differences.locator('.text-catalog-tag').allTextContents(), ['<b>', '</b>', '<i>', '</i>', '<color=accent>', '</color>']);
  const warning = parseInlineText(important, 'dialogue').issues.find((issue) => issue.severity === 'warning').message;
  assert.deepEqual(await differences.locator('.text-catalog-note').allTextContents(), [`译文：${warning}`], 'an unknown tag is noted in Core\'s words, not refused');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'translation-preview.png') });
  await catalog.getByRole('button', { name: '确认导入并保存' }).click();
  await page.waitForFunction(() => document.querySelector('.text-catalog')?.textContent.includes('译稿目录已保存'));
  console.log('PASS translation import: Core refuses an option pause with its own message; tags shown as marks; an unknown tag noted, not refused');

  // 7. Saved entries: tags as marks on both sides, Core's note kept with the entry, the CSV round-trips the source as written.
  assert.deepEqual(await entries.locator('.text-catalog-entry').evaluateAll((rows) => rows.map((row) => row.textContent)), [
    `line.important · 已翻译 · 凛：<b>重要</b>的事。 → ${important} · 配音：未关联译文：${warning}`,
    `choice.road · 已翻译 · <b>危险</b>的路 → ${road}`,
  ]);
  assert.deepEqual(await entries.locator('.text-catalog-tag').allTextContents(),
    ['<b>', '</b>', '<b>', '</b>', '<i>', '</i>', '<b>', '</b>', '<color=accent>', '</color>']);
  await catalog.getByRole('button', { name: '载入已保存译稿' }).click();
  await page.waitForFunction((important) => document.querySelector('[aria-label="译稿表格"]')?.value.includes(important), important);
  assert((await csv.inputValue()).includes(`"${road}"`) && (await csv.inputValue()).includes('"<b>危险</b>的路"'), 'the CSV carries the tags as written');
  if (outDir) { await entries.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(outDir, 'translation-entries.png') }); }
  console.log('PASS translation entries: tags as marks on both sides; Core notes kept; the CSV keeps the markup as written');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS translation and search markup');
} finally {
  await browser.close();
  server.close();
}
