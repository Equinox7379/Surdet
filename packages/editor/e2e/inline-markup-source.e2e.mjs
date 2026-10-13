import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseInlineText } from '@surdet/core';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Built Editor with the in-memory test file system. Inline markup help in the two entries the
// dialogue box does not cover: the whole-scene source view and an option's text in the inspector.
// Real typing throughout; the IME step is Chromium's CDP composition, not a native Windows IME.
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

// CRLF on purpose: edits in the LF source textarea must keep the file's own line endings.
const source = [
  '@scene start',
  '@label opening',
  '// 注释 <b>不算</b>',
  '@wait 300',
  '凛：我在读《红楼梦》，{hero}来了。',
  '凛：普通的一句话。',
  '@choice',
  '  <color=accent>先走</color> -> @goto after',
  '  留下 [if:trust > 1] -> @goto stay',
  '@label after',
  '凛：到了。',
  '@end',
  '@label stay',
  '凛：留下了。',
  '@end',
  '',
].join('\r\n');
const files = Object.entries({
  'game.config.json': JSON.stringify({ entryScene: 'start', variables: { hero: { type: 'string', initial: '凛' }, trust: { type: 'number', initial: 2 } }, characters: { lynn: { name: '凛' } } }),
  'content/scenario/start.gal': source,
}).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));
const issuesOf = (text, context) => parseInlineText(text, context).issues;
const message = (text, context) => issuesOf(text, context).map((issue) => issue.message).join('；');
const issueTexts = (text, context) => issuesOf(text, context).map((issue) => text.slice(issue.start, issue.end));

const outDir = process.env.SURDET_INLINE_E2E_OUTPUT;
const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-inline-source-test', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(url);
  const openProject = async () => {
    await page.locator('[data-action="open-project"]').click();
    await page.locator('.v4-authoring .block[data-line="5"]').waitFor();
  };
  await openProject();
  const status = () => page.locator('#status').innerText();
  const sceneText = () => page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text);
  const issueListed = (code) => page.waitForFunction((code) => [...document.querySelectorAll('#issues-box button.issue')].some((node) => node.textContent.includes(code)), code);
  const undoUntil = async (expected) => {
    for (let step = 0; step < 30 && (await sceneText()) !== expected; step++) await page.keyboard.press('Control+z');
    assert.equal(await sceneText(), expected, 'undo returns the earlier source');
  };

  // ---- Source view ----
  const src = page.locator('.v4-source-editor');
  const mirror = page.locator('.v4-source-mirror');
  const sourceStatus = page.locator('.v4-source-markup-status');
  const sourceCompletion = page.locator('.v4-source-box .v4-inline-completion');
  const caretAt = (needle, offset = 0) => src.evaluate((node, { needle, offset }) => {
    node.focus();
    const at = node.value.indexOf(needle);
    if (at < 0) throw new Error(`missing ${needle}`);
    node.setSelectionRange(at + offset, at + offset);
  }, { needle, offset });
  const completionCodes = (list) => list.locator('code').allTextContents();
  /** Moves the caret to the row end (source) or the text end without any event the field listens to,
   *  as a caret change the field never sees would. The open list is then left behind. */
  const moveCaretUnseen = (locator) => locator.evaluate(async (node) => {
    const swallow = (event) => { if (event.target === node) event.stopImmediatePropagation(); };
    window.addEventListener('select', swallow, true);
    const rowEnd = node.value.indexOf('\n', node.selectionEnd);
    const at = node.classList.contains('v4-source-editor') && rowEnd >= 0 ? rowEnd : node.value.length;
    node.setSelectionRange(at, at);
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.removeEventListener('select', swallow, true);
  });

  // 1. Only dialogue and option text are marked: the comment's tag, the book title and the variable are left alone.
  await page.locator('[data-script-view="source"]').click();
  assert.equal(await src.inputValue(), source.replace(/\r\n/g, '\n'));
  assert.deepEqual(await mirror.locator('.is-tag').allTextContents(), ['<color=accent>', '</color>']);
  assert.equal(await mirror.locator('.is-error, .is-warning').count(), 0);
  assert.equal(await sourceStatus.isHidden(), true, 'no problems, no status line');
  const aligned = await page.evaluate(() => {
    const area = document.querySelector('.v4-source-editor').getBoundingClientRect(), copy = document.querySelector('.v4-source-mirror').getBoundingClientRect();
    return ['left', 'top', 'width', 'height'].every((side) => Math.abs(area[side] - copy[side]) < 1);
  });
  assert(aligned, 'the highlight copy sits exactly behind the source textarea');
  console.log('PASS source view marks only dialogue and option tags; comment, book title and variable untouched');

  // 2. `<` offers the tags of the row's context; instructions, comments, conditions and jumps get none.
  await caretAt('普通的一句话。', 7);
  await page.keyboard.type('<s');
  await sourceCompletion.waitFor();
  assert.deepEqual(await completionCodes(sourceCompletion), ['<size=…>', '<speed=…>', '<shake>']);
  await page.keyboard.press('Escape');
  assert.equal(await sourceCompletion.count(), 0);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await caretAt('留下', 2);
  await page.keyboard.type('<s');
  await sourceCompletion.waitFor();
  assert.deepEqual(await completionCodes(sourceCompletion), ['<size=…>'], 'an option is offered only the tags Core allows in options');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  for (const [needle, offset, typed] of [['@wait 300', 9, '<'], ['// 注释', 5, '<b'], ['[if:trust', 4, '<'], ['@goto stay', 10, '<']]) {
    await caretAt(needle, offset);
    await page.keyboard.type(typed);
    await page.waitForTimeout(100);
    assert.equal(await sourceCompletion.count(), 0, `no tag completion in ${needle}`);
    for (let index = 0; index < typed.length; index++) await page.keyboard.press('Backspace');
  }
  assert.equal(await sceneText(), source, 'the source is back to its original text and line endings');
  console.log('PASS source completion follows the row: dialogue tags, option tags only; none in instructions, comments, conditions or jumps');

  // 2b. 36-REV-01: a list offered at one `<` never writes at another place. End leaves the prefix and
  //     closes it, so Enter is an ordinary Enter; a caret moved without a key or a click is checked
  //     again when the list is used, by Enter or by a click on an entry.
  const sourceRow = async (index) => (await src.inputValue()).split('\n')[index];
  const offerAtLineStart = async () => {
    await page.waitForTimeout(650);
    await caretAt('普通的一句话。');
    await page.keyboard.type('<co');
    await sourceCompletion.waitFor();
  };
  await offerAtLineStart();
  await page.keyboard.press('End');
  assert.equal(await sourceCompletion.count(), 0, 'End leaves the prefix and closes the list');
  await page.keyboard.press('Enter');
  assert.deepEqual([await sourceRow(5), await sourceRow(6)], ['凛：<co普通的一句话。', ''], 'Enter after End is an ordinary new line; the line is kept');
  await undoUntil(source);
  await offerAtLineStart();
  await moveCaretUnseen(src);
  assert.equal(await sourceCompletion.count(), 1, 'the list offered at the line start is still open');
  await page.keyboard.press('Enter');
  assert.deepEqual([await sourceRow(5), await sourceRow(6)], ['凛：<co普通的一句话。', ''], 'a list offered elsewhere is not used by Enter');
  assert.equal(await sourceCompletion.count(), 0);
  await undoUntil(source);
  await offerAtLineStart();
  await moveCaretUnseen(src);
  assert.equal(await sourceCompletion.count(), 1, 'the list offered at the line start is still open');
  await sourceCompletion.locator('.v4-inline-completion-option').first().dispatchEvent('pointerdown');
  assert.equal(await sourceRow(5), '凛：<co普通的一句话。', 'a list offered elsewhere is not used by a click');
  assert.equal(await sourceCompletion.count(), 0);
  await undoUntil(source);
  console.log('PASS 36-REV-01 source: End closes the list; a moved caret never accepts by Enter or click; the line is kept');

  // 3. Accepting inserts through the normal edit path; the file keeps CRLF; undo goes through the existing history.
  await page.waitForTimeout(650);
  await caretAt('普通的一句话。', 7);
  await page.keyboard.type('<co');
  await sourceCompletion.waitFor();
  await page.keyboard.press('Enter');
  const accepted = await src.evaluate((node) => ({ selected: node.value.slice(node.selectionStart, node.selectionEnd), row: node.value.split('\n')[5] }));
  assert.deepEqual(accepted, { selected: 'accent', row: '凛：普通的一句话。<color=accent></color>' });
  await page.keyboard.type('danger');
  assert(( await sceneText()).includes('凛：普通的一句话。<color=danger></color>\r\n@choice\r\n'), 'the edit is in the scene with its CRLF');
  assert.deepEqual(await mirror.locator('.is-tag').allTextContents(), ['<color=danger>', '</color>', '<color=accent>', '</color>']);
  await undoUntil(source);
  assert.deepEqual(await page.locator('.v4-source-mirror .is-tag').allTextContents(), ['<color=accent>', '</color>'], 'the marks follow the undone source');
  console.log('PASS source completion writes through the scene history; CRLF kept; undo restores text and marks');

  // 4. IME composition keeps the same textarea and offers nothing while composing.
  await page.waitForTimeout(650);
  await caretAt('到了。', 3);
  await src.evaluate((node) => { node.dataset.identity = 'same-source'; });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '<', selectionStart: 1, selectionEnd: 1 });
  assert.equal(await sourceCompletion.count(), 0, 'no completion while composing');
  await cdp.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '你' });
  assert.equal(await src.evaluate((node) => node.dataset.identity), 'same-source', 'composition must not replace the textarea');
  assert.equal((await src.inputValue()).split('\n')[10], '凛：到了。你');
  await page.keyboard.press('Backspace');
  assert.equal(await sceneText(), source);
  console.log('PASS source IME composition keeps the textarea and its text');

  // 5. Problems: Core's message on the caret's row, the others by row; F8 selects the exact tag, an edit makes it stale.
  await page.waitForTimeout(650);
  await caretAt('到了。', 3);
  await page.keyboard.type('<size=9>大</size>');
  assert.deepEqual(await mirror.locator('.is-error').allTextContents(), issueTexts('到了。<size=9>大</size>', 'dialogue'));
  assert.equal(await sourceStatus.innerText(), `第 11 行：${message('到了。<size=9>大</size>', 'dialogue')}`);
  assert(await sourceStatus.evaluate((node) => node.classList.contains('has-error')));
  if (outDir) await page.screenshot({ path: path.join(outDir, 'source-problem.png') });
  await caretAt('@label opening');
  await page.keyboard.press('ArrowRight');
  assert.equal(await sourceStatus.innerText(), '标签问题在第 11 行');
  await issueListed('M004');
  await page.locator('h1').first().click();
  await page.keyboard.press('F8');
  const located = await src.evaluate((node) => ({ active: node === document.activeElement, selected: node.value.slice(node.selectionStart, node.selectionEnd) }));
  assert.deepEqual(located, { active: true, selected: '<size=9>' }, 'F8 selects the exact tag Core reported in the source view');
  await page.keyboard.press('End');
  await page.keyboard.type('。');
  await page.keyboard.press('F8');
  assert.match(await status(), /内容已修改，请等待重新校验后再定位/);
  await undoUntil(source);
  await page.waitForTimeout(650);
  await caretAt('留下', 2);
  await page.keyboard.type('<w>');
  assert.deepEqual(await page.locator('.v4-source-mirror .is-error').allTextContents(), issueTexts('留下<w>', 'choice'));
  assert.equal(await sourceStatus.innerText(), `第 9 行：${message('留下<w>', 'choice')}`, 'an option is checked as an option');
  assert((await sceneText()).includes('  留下<w> [if:trust > 1] -> @goto stay\r\n'), 'the source is written as typed, not corrected');
  await undoUntil(source);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'source-view.png') });
  console.log('PASS source problems: Core message on the row, other rows named, F8 exact then stale after an edit, option rules for options');

  // 6. Edits kept for saving: a bold word in a dialogue and an italic option, typed in full.
  await page.waitForTimeout(650);
  await caretAt('普通的一句话。');
  await page.keyboard.type('<b>重</b>');
  await caretAt('留下');
  await page.keyboard.type('<i>');
  await caretAt('留下', 2);
  await page.keyboard.type('</i>');
  const sourceEdited = source.replace('凛：普通的一句话。', '凛：<b>重</b>普通的一句话。').replace('  留下 [if', '  <i>留下</i> [if');
  assert.equal(await sceneText(), sourceEdited);

  // ---- Option text in the inspector ----
  await page.locator('[data-script-view="arrange"]').click();
  await page.locator('[data-step-summary="7"]').click();
  const optionBox = page.locator('#script-v4-inspector textarea[aria-label="选项文字"]');
  const optionField = page.locator('#script-v4-inspector .v4-inline-field.is-choice');
  const optionIssues = page.locator('#script-v4-inspector .v4-inline-issues');
  const optionCompletion = optionField.locator('.v4-inline-completion');
  const optionRow = async () => (await sceneText()).split('\r\n')[7];

  // 7. Unfocused it reads styled; focused it shows the source with its tags marked.
  assert.equal(await optionBox.inputValue(), '<color=accent>先走</color>');
  assert.equal(await optionField.evaluate((node) => node.classList.contains('is-projected')), true, 'an unfocused styled option shows its reading view');
  const reading = await optionField.locator('.v4-inline-view').evaluate((node) => ({ text: node.textContent,
    accent: [...node.querySelectorAll('span')].some((span) => span.textContent === '先' && span.style.color.includes('--surdet-action-primary')) }));
  assert.deepEqual(reading, { text: '先走', accent: true });
  await optionBox.focus();
  assert.equal(await optionField.evaluate((node) => node.classList.contains('is-projected')), false);
  assert.deepEqual(await optionField.locator('.v4-inline-mirror .is-tag').allTextContents(), ['<color=accent>', '</color>']);
  console.log('PASS option text: styled reading view when unfocused, tags marked when focused');

  // 8. Completion and the selection toolbar offer only what Core allows in an option; Enter adds no line.
  await optionBox.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
  await page.keyboard.type('<s');
  await optionCompletion.waitFor();
  assert.deepEqual(await completionCodes(optionCompletion), ['<size=…>']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  assert.equal(await optionBox.inputValue(), '<color=accent>先走</color>', 'Enter adds no line to an option');
  await optionBox.evaluate((node) => { const at = node.value.indexOf('先走'); node.setSelectionRange(at, at + 2); node.dispatchEvent(new Event('select')); });
  const toolbar = optionField.locator('.v4-inline-toolbar');
  await toolbar.waitFor();
  const tools = await toolbar.locator('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  assert(tools.includes('粗体（Ctrl+B）') && tools.includes('给选中文字加注音'), tools.join());
  for (const refused of ['打字速度 0.5 倍', '逐字抖动', '逐字波浪']) assert(!tools.includes(refused), `${refused} is not offered for an option`);
  await toolbar.getByRole('button', { name: '粗体（Ctrl+B）' }).click();
  assert.equal(await optionBox.inputValue(), '<color=accent><b>先走</b></color>');
  assert.equal(await optionRow(), '  <color=accent><b>先走</b></color> -> @goto after');
  console.log('PASS option completion and toolbar limited to option tags; Enter adds no line; wrapping writes the source row');

  // 8b. 36-REV-01 in the option field: Home, `<co`, End, Enter keeps the option text; so does a moved caret.
  const boldOption = await sceneText();
  const offerAtOptionStart = async () => {
    await page.waitForTimeout(650);
    await optionBox.evaluate((node) => { node.focus(); node.setSelectionRange(0, 0); });
    await page.keyboard.type('<co');
    await optionCompletion.waitFor();
  };
  await offerAtOptionStart();
  await page.keyboard.press('End');
  assert.equal(await optionCompletion.count(), 0, 'End closes the option list');
  await page.keyboard.press('Enter');
  assert.equal(await optionBox.inputValue(), '<co<color=accent><b>先走</b></color>', 'the option text is kept');
  await undoUntil(boldOption);
  await page.locator('[data-step-summary="7"]').click();
  await offerAtOptionStart();
  await moveCaretUnseen(optionBox);
  assert.equal(await optionCompletion.count(), 1, 'the list offered at the option start is still open');
  await page.keyboard.press('Enter');
  assert.equal(await optionBox.inputValue(), '<co<color=accent><b>先走</b></color>', 'a list offered elsewhere is not used by Enter');
  assert.equal(await optionCompletion.count(), 0);
  await undoUntil(boldOption);
  await page.locator('[data-step-summary="7"]').click();
  console.log('PASS 36-REV-01 option: End closes the list; a moved caret never accepts; the option text is kept');

  // 9. Problems are reported in Core's words and written as typed; an edit makes the old location stale.
  await optionBox.evaluate((node) => { node.focus(); node.setSelectionRange(node.value.length, node.value.length); });
  await page.waitForTimeout(650);
  await page.keyboard.type('<w>');
  const optionWithPause = '<color=accent><b>先走</b></color><w>';
  assert.equal(await optionIssues.innerText(), message(optionWithPause, 'choice'));
  assert(await optionIssues.evaluate((node) => node.classList.contains('has-error')));
  if (outDir) await page.screenshot({ path: path.join(outDir, 'option-problem.png') });
  assert.deepEqual(await optionField.locator('.v4-inline-mirror .is-error').allTextContents(), issueTexts(optionWithPause, 'choice'));
  assert.equal(await optionRow(), '  <color=accent><b>先走</b></color><w> -> @goto after', 'the option is written as typed, not corrected');
  await issueListed('M005');
  await page.keyboard.type('x');
  await page.keyboard.press('F8');
  assert.match(await status(), /内容已修改，请等待重新校验后再定位/);
  for (let index = 0; index < 4; index++) await page.keyboard.press('Backspace');
  assert.equal(await optionIssues.isHidden(), true);
  // A book title and a variable are ordinary option text.
  await page.keyboard.type('《书》{hero}');
  await page.waitForTimeout(100);
  assert.equal(await optionCompletion.count(), 0);
  assert.equal(await optionIssues.isHidden(), true);
  assert.equal(await optionField.locator('.v4-inline-mirror .is-error, .v4-inline-mirror .is-warning').count(), 0);
  const withTitle = sourceEdited.replace('  <color=accent>先走</color> -> @goto after', '  <color=accent><b>先走</b></color>《书》{hero} -> @goto after');
  assert.equal(await sceneText(), withTitle);
  await undoUntil(sourceEdited.replace('  <color=accent>先走</color> -> @goto after', '  <color=accent><b>先走</b></color> -> @goto after'));
  await page.locator('[data-step-summary="7"]').click();
  assert.equal(await optionBox.inputValue(), '<color=accent><b>先走</b></color>', 'the inspector shows the undone option');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'option-text.png') });
  console.log('PASS option problems in Core words, written as typed, stale after an edit; book title and variable plain; undo restores');

  // 9b. 36-REV-01 in a dialogue box (the same field code): the line is kept, and Enter then splits it as usual.
  const beforeDialogue = await sceneText();
  const dialogueBox = page.locator('.v4-authoring .block[data-line="10"] .v4-dialogue-input');
  const dialogueCompletion = page.locator('.v4-authoring .block[data-line="10"] .v4-inline-completion');
  const offerAtDialogueStart = async () => {
    await page.waitForTimeout(650);
    await dialogueBox.click();
    await dialogueBox.evaluate((node) => node.setSelectionRange(0, 0));
    await page.keyboard.type('<co');
    await dialogueCompletion.waitFor();
  };
  await offerAtDialogueStart();
  await page.keyboard.press('End');
  assert.equal(await dialogueCompletion.count(), 0, 'End closes the dialogue list');
  await page.keyboard.press('Enter');
  assert((await sceneText()).includes('\r\n凛：<co到了。\r\n'), 'the dialogue is kept');
  await undoUntil(beforeDialogue);
  await offerAtDialogueStart();
  await moveCaretUnseen(dialogueBox);
  assert.equal(await dialogueCompletion.count(), 1, 'the list offered at the dialogue start is still open');
  await page.keyboard.press('Enter');
  assert((await sceneText()).includes('\r\n凛：<co到了。\r\n'), 'a list offered elsewhere is not used by Enter');
  await undoUntil(beforeDialogue);
  console.log('PASS 36-REV-01 dialogue: End closes the list; a moved caret never accepts; the line is kept');

  // 10. Save and reopen: the file has exactly these edits with its CRLF, and both entries show them again.
  const finalSource = sourceEdited.replace('  <color=accent>先走</color> -> @goto after', '  <color=accent><b>先走</b></color> -> @goto after');
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved');
  const saved = await page.evaluate(() => window.__surdetDumpFakeRoot());
  assert.equal(Buffer.from(saved.find((item) => item.path === 'content/scenario/start.gal').bytes, 'base64').toString('utf8'), finalSource);
  await openProject();
  await page.locator('[data-script-view="source"]').click();
  assert.equal(await src.inputValue(), finalSource.replace(/\r\n/g, '\n'));
  assert.deepEqual(await page.locator('.v4-source-mirror .is-tag').allTextContents(), ['<b>', '</b>', '<color=accent>', '<b>', '</b>', '</color>', '<i>', '</i>']);
  await page.locator('[data-script-view="arrange"]').click();
  await page.locator('[data-step-summary="7"]').click();
  assert.equal(await optionBox.inputValue(), '<color=accent><b>先走</b></color>');
  console.log('PASS save and reopen keep both entries\' edits with CRLF; marks shown again');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS inline markup in the source view and option text');
} finally {
  await browser.close();
  server.close();
}
