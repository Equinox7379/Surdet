import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { inlineTextLength } from '@surdet/core';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Built Editor with the in-memory test file system. Covers the inline markup front end:
// reading view, highlight, IME, completion, wrapping, problems, splitting and search/replace.
// Preview continuation through a styled option needs a bound project: inline-preview-resume.e2e.mjs.
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
  '凛：你说什么？<w=400>……<color=accent>再说一遍</color>。',
  '沈岳：我在读《红楼梦》，<ruby=せかい>世界</ruby>很大。',
  '凛：普通的一句话。',
  '@choice',
  '  <color=accent>{hero}</color>先走 -> @goto after',
  '  留下 -> @goto stay',
  '@label after',
  '凛：到了。',
  '@end',
  '@label stay',
  '凛：留下了。',
  '@end',
].join('\n');
const files = Object.entries({
  'game.config.json': JSON.stringify({ entryScene: 'start', variables: { hero: { type: 'string', initial: '<b>凛' } }, characters: { lynn: { name: '凛' }, shen: { name: '沈岳' } } }),
  'content/scenario/start.gal': source,
}).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));

const outDir = process.env.SURDET_INLINE_E2E_OUTPUT;
const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-inline-markup-test', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(url);
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.v4-authoring .block[data-line="4"]').waitFor();
  const row = (line) => page.locator(`.v4-authoring .block[data-line="${line}"]`);
  const box = (line) => row(line).locator('.v4-dialogue-input');
  const status = () => page.locator('#status').innerText();

  // 1. Reading view while unfocused: styles, pause mark, ruby, and the book title kept as text.
  await page.locator('h1').first().click();
  assert(await row(2).locator('.v4-inline-field.is-projected').count(), 'styled line must show its reading view when unfocused');
  const reading2 = await row(2).locator('.v4-inline-view').evaluate((node) => ({
    text: node.textContent,
    pause: node.querySelector('.v4-inline-pause')?.textContent,
    accent: [...node.querySelectorAll('span')].some((span) => span.textContent === '再' && span.style.color.includes('--surdet-action-primary')),
  }));
  assert.equal(reading2.pause, '停0.4秒');
  assert(reading2.text.includes('你说什么？') && reading2.text.includes('……再说一遍。') && !reading2.text.includes('<'), JSON.stringify(reading2));
  assert(reading2.accent, 'colour tag must colour its text in the reading view');
  const reading3 = await row(3).locator('.v4-inline-view').evaluate((node) => ({ text: node.textContent, rt: node.querySelector('ruby rt')?.textContent }));
  assert.equal(reading3.rt, 'せかい');
  assert(reading3.text.includes('《红楼梦》'), 'book title marks are ordinary text');
  assert.equal(await box(2).inputValue(), '你说什么？<w=400>……<color=accent>再说一遍</color>。', 'the textarea still holds the source');
  assert.equal(await row(4).locator('.v4-inline-field.is-projected').count(), 0, 'a plain line has no reading view');
  const characters = await page.locator('[data-manuscript-fact="characters"]').innerText();
  const expectedCharacters = source.split('\n').filter((line) => !line.startsWith('@') && !line.startsWith('  '))
    .reduce((sum, line) => sum + inlineTextLength(line.slice(line.indexOf('：') + 1)), 0);
  assert.equal(characters, `${expectedCharacters} 字`, 'manuscript count uses Core visible text');
  assert.equal(await page.locator('.scene-item[data-scene-id] .scene-meta').first().innerText(), `${expectedCharacters} 字`, 'scene list uses the same count');
  if (outDir) await page.screenshot({ path: path.join(outDir, '01-reading-view.png') });
  console.log('PASS reading view: styles, pause mark, ruby, book title and Core count');

  // 2. Focus shows the source with tags highlighted behind the native textarea; clicking a
  //    visible character puts the caret at that character's source position.
  const target = row(2).locator('.v4-inline-view span').filter({ hasText: /^说$/ }).first();
  const targetBox = await target.boundingBox();
  await page.mouse.click(targetBox.x + 1, targetBox.y + targetBox.height / 2);
  assert.equal(await row(2).locator('.v4-inline-field.is-projected').count(), 0, 'focus returns to the source');
  const caret = await box(2).evaluate((node) => ({ active: node === document.activeElement, at: node.selectionStart, value: node.value }));
  assert(caret.active, 'clicking the reading view focuses the textarea');
  assert.equal(caret.value.slice(caret.at, caret.at + 1), '说', 'caret lands before the clicked character');
  assert.deepEqual(await row(2).locator('.v4-inline-mirror .is-tag').allTextContents(), ['<w=400>', '<color=accent>', '</color>']);
  await page.waitForFunction(() => document.querySelector('.v4-edit-stage .v4-stage-dialogue p')?.textContent === '你说什么？……再说一遍。');
  const aligned = await row(2).evaluate((block) => {
    const area = block.querySelector('.v4-dialogue-input').getBoundingClientRect();
    const mirror = block.querySelector('.v4-inline-mirror').getBoundingClientRect();
    return Math.abs(area.left - mirror.left) < 1 && Math.abs(area.top - mirror.top) < 1 && Math.abs(area.width - mirror.width) < 1;
  });
  assert(aligned, 'the highlight layer sits exactly behind the textarea');
  if (outDir) await page.screenshot({ path: path.join(outDir, '02-focused-highlight.png') });
  console.log('PASS focused source: tag highlight aligned, caret mapped from the reading view');

  // 3. IME composition does not rebuild the textarea, and the committed text is kept.
  await box(4).click();
  await box(4).evaluate((node) => { node.dataset.identity = 'same-node'; node.setSelectionRange(node.value.length, node.value.length); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '你' });
  assert.equal(await box(4).evaluate((node) => node.dataset.identity), 'same-node', 'composition must not replace the textarea');
  assert.equal(await box(4).inputValue(), '普通的一句话。你');
  await page.keyboard.press('Backspace');
  console.log('PASS IME composition keeps the same textarea');

  // 4. Typing `<` offers the tag table; accepting inserts the pair and selects the value.
  await page.keyboard.type('<co');
  const completion = row(4).locator('.v4-inline-completion');
  await completion.waitFor();
  assert.deepEqual(await completion.locator('code').allTextContents(), ['<color=…>']);
  await page.keyboard.press('Enter');
  const accepted = await box(4).evaluate((node) => ({ value: node.value, selected: node.value.slice(node.selectionStart, node.selectionEnd) }));
  assert.deepEqual(accepted, { value: '普通的一句话。<color=accent></color>', selected: 'accent' });
  await page.keyboard.type('danger');
  assert.equal(await box(4).inputValue(), '普通的一句话。<color=danger></color>');
  await page.keyboard.press('Control+z');
  assert.notEqual(await box(4).inputValue(), '普通的一句话。<color=danger></color>', 'undo goes through the existing history');
  await page.waitForFunction(() => document.querySelector('.block[data-line="4"] .v4-dialogue-input')?.value === '普通的一句话。');
  console.log('PASS completion inserts tag pairs through the normal edit and undo path');

  // 5. Selecting text shows the toolbar; wrapping keeps the text selected; a crossing selection is refused.
  await box(4).click();
  await box(4).evaluate((node) => { node.focus(); node.setSelectionRange(0, 2); node.dispatchEvent(new Event('select')); });
  const toolbar = row(4).locator('.v4-inline-toolbar');
  await toolbar.waitFor();
  await toolbar.getByRole('button', { name: '强调色' }).click();
  const wrapped = await box(4).evaluate((node) => ({ value: node.value, selected: node.value.slice(node.selectionStart, node.selectionEnd), active: node === document.activeElement }));
  assert.deepEqual(wrapped, { value: '<color=accent>普通</color>的一句话。', selected: '普通', active: true });
  await page.keyboard.press('Control+b');
  assert.equal(await box(4).inputValue(), '<color=accent><b>普通</b></color>的一句话。');
  await box(4).evaluate((node) => { node.setSelectionRange(node.value.indexOf('通'), node.value.indexOf('的') + 1); node.dispatchEvent(new Event('select')); });
  await toolbar.getByRole('button', { name: '粗体（Ctrl+B）' }).click();
  assert.match(await status(), /边界/);
  assert.equal(await box(4).inputValue(), '<color=accent><b>普通</b></color>的一句话。', 'a refused wrap leaves the text unchanged');
  await box(4).evaluate((node) => { node.setSelectionRange(node.value.indexOf('一句'), node.value.indexOf('一句') + 2); node.dispatchEvent(new Event('select')); });
  await toolbar.getByRole('button', { name: '给选中文字加注音' }).click();
  await toolbar.locator('.v4-inline-reading').fill('いっく');
  await toolbar.locator('.v4-inline-reading').press('Enter');
  assert.equal(await box(4).inputValue(), '<color=accent><b>普通</b></color>的<ruby=いっく>一句</ruby>话。');
  if (outDir) await page.screenshot({ path: path.join(outDir, '03-wrapped.png') });
  console.log('PASS selection toolbar: colour, Ctrl+B, ruby, crossing selection refused');

  // 6. An invalid tag is reported by Core; F8 selects its exact range in the dialogue box,
  //    and an edit after validation makes the old location stale.
  await box(4).click();
  await box(4).evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
  await page.keyboard.type('<size=9>大</size>');
  await page.waitForFunction(() => [...document.querySelectorAll('#issues-box button.issue')].some((node) => node.textContent.includes('M004')));
  await page.locator('h1').first().click();
  await page.keyboard.press('F8');
  const located = await box(4).evaluate((node) => ({ active: node === document.activeElement, selected: node.value.slice(node.selectionStart, node.selectionEnd) }));
  assert.deepEqual(located, { active: true, selected: '<size=9>' }, 'F8 selects the exact tag Core reported');
  await page.keyboard.press('End');
  await page.keyboard.type('。');
  await page.keyboard.press('F8');
  assert.match(await status(), /内容已修改，请等待重新校验后再定位/);
  await page.keyboard.press('Backspace');
  await box(4).evaluate((node) => { node.setSelectionRange(node.value.indexOf('<size=9>'), node.value.length); });
  await page.keyboard.press('Delete');
  await page.waitForFunction(() => ![...document.querySelectorAll('#issues-box button.issue')].some((node) => node.textContent.includes('M004')));
  console.log('PASS problems: exact Core range, stale location refused after an edit');

  // 7. Enter inside a styled span splits into two valid lines; inside a tag it is refused.
  await box(2).click();
  await box(2).evaluate((node) => { const at = node.value.indexOf('一遍'); node.setSelectionRange(at, at); });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.block[data-line="3"] .v4-dialogue-input')?.value === '<color=accent>一遍</color>。');
  assert.equal(await box(2).inputValue(), '你说什么？<w=400>……<color=accent>再说</color>');
  const reopened = await box(3).evaluate((node) => ({ active: node === document.activeElement, at: node.selectionStart }));
  assert.deepEqual(reopened, { active: true, at: '<color=accent>'.length }, 'the caret follows the reopened style');
  await box(2).click();
  await box(2).evaluate((node) => { const at = node.value.indexOf('<color') + 3; node.setSelectionRange(at, at); });
  await page.keyboard.press('Enter');
  assert.match(await status(), /标签内部/);
  assert.equal(await box(2).inputValue(), '你说什么？<w=400>……<color=accent>再说</color>', 'a refused split changes nothing');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('.block[data-line="2"] .v4-dialogue-input')?.value === '你说什么？<w=400>……<color=accent>再说一遍</color>。');
  console.log('PASS split: styles closed and reopened, split inside a tag refused');

  // 8. Search finds text across style tags; replacement keeps tags and skips crossing matches.
  await page.locator('h1').first().click();
  await page.keyboard.press('Control+f');
  await page.locator('#search-input').fill('……再说');
  const hit = page.locator('.search-item').first();
  await hit.waitFor();
  assert.equal(await hit.locator('mark').innerText(), '……再说');
  assert.equal(await hit.locator('.search-excerpt').getAttribute('title'), '按显示文字匹配（跨过了样式标签）');
  await page.getByRole('button', { name: '展开或收起替换' }).click();
  await page.locator('#search-input').fill('一遍');
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('两遍');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  await page.locator('.search-replace-dialog').waitFor();
  await page.getByRole('button', { name: '确认替换' }).click();
  await page.waitForFunction(() => document.querySelector('.block[data-line="2"] .v4-dialogue-input')?.value.includes('再说两遍'));
  assert.equal(await box(2).inputValue(), '你说什么？<w=400>……<color=accent>再说两遍</color>。');
  await page.locator('#search-input').fill('……再');
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('！');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  assert.match(await status(), /跨过或位于行内标签内/);
  assert.equal(await box(2).inputValue(), '你说什么？<w=400>……<color=accent>再说两遍</color>。', 'a match across a tag is never replaced');
  // Option text is searched as Core reads it; a tag typed as replacement is written as text.
  await page.locator('#search-input').fill('{hero}先走');
  const optionHit = page.locator('.search-item').first();
  await optionHit.waitFor();
  assert.equal(await optionHit.locator('mark').innerText(), '{hero}先走');
  await page.locator('#search-input').fill('先走');
  await page.getByRole('textbox', { name: '替换为（可空）' }).fill('<i>先走</i>');
  await page.getByRole('button', { name: '替换整个项目' }).click();
  await page.locator('.search-replace-dialog').waitFor();
  await page.getByRole('button', { name: '确认替换' }).click();
  await page.waitForFunction(() => document.querySelector('.block[data-line="6"] .raw input')?.value.includes('\\<i>'));
  assert.equal(await row(6).locator('.raw input').inputValue(), '  <color=accent>{hero}</color>\\<i>先走\\</i> -> @goto after');
  console.log('PASS search across tags, safe replacement, crossing match skipped, option text found and replaced as text');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS inline markup front end');
} finally {
  await browser.close();
  server.close();
}
