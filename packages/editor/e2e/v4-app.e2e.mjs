import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Full built Editor + real preview.html/Interpreter/RendererRuntime. The file chooser
// is the existing in-memory FS test adapter, NOT native Windows IO or a new authority.
const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(editorRoot, 'dist');
await fs.access(path.join(dist, 'index.html'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' };
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
const address = server.address();
assert(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#6c8993"/><path d="M0 370L450 160L960 400V540H0Z" fill="#314d5d"/></svg>';
const source = '@scene start\r\n@label opening\r\n@bg hall\r\n@show lynn:uniform normal @ right\r\n@set score = 10 + 5\r\n凛：分数是 {score}。\r\n@timeline intro\r\n@end';
const documents = {
  'game.config.json': JSON.stringify({ entryScene: 'start', variables: { score: { type: 'number', initial: 0 } }, characters: { lynn: { name: '凛' } } }),
  'content/scenario/start.gal': source,
  'content/config/terminology.json': JSON.stringify({ terms: [{ canonical: '重逢', variants: ['再会'] }] }),
  'content/assets/bg/hall.svg': svg,
  'content/assets/portrait/lynn_uniform_normal.svg': svg,
  'content/assets/portrait/lynn_uniform_despair.svg': svg,
  'content/timelines/intro.json': JSON.stringify({ version: 1, id: 'intro', durationMs: 600, tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 600, easing: 'linear', action: 'fade', alpha: 0 }] }] }),
  'content/timelines/invalid.json': JSON.stringify({ version: 1, id: 'invalid', durationMs: -1, tracks: [] }),
  'content/assets/bg/long-technical-path-for-image-failure/unavailable.svg': 'controlled invalid image in the isolated test project',
};
// Reuse existing Starter SVGs only as test art; never depend on this project in production.
for (const [target, original] of [
  ['content/assets/bg/hall.svg', 'bg/castle_hall.svg'],
  ['content/assets/portrait/lynn_uniform_normal.svg', 'portrait/lynn_uniform_normal.svg'],
  ['content/assets/portrait/lynn_uniform_despair.svg', 'portrait/lynn_uniform_despair.svg'],
]) documents[target] = await fs.readFile(path.resolve(editorRoot, 'e2e/fixtures/asset-authority-project/content/assets', original), 'utf8');
let files = Object.entries(documents).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));
let browser;
let zoomContext;
let zoomRoot;
const errors = [];
const open = async (context = undefined) => {
  context ??= await browser.newContext({ viewport: { width: 1792, height: 900 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-v4-test-only-中文长项目名称与跨页面编辑体验检查', files });
  await context.addInitScript(() => {
    window.__pass10ImageStates = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[data-image-state],[data-asset-thumbnail-state]')) {
        const state = node.getAttribute('data-image-state') ?? node.getAttribute('data-asset-thumbnail-state');
        if (!window.__pass10ImageStates.includes(state)) window.__pass10ImageStates.push(state);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-image-state', 'data-asset-thumbnail-state'] });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.request().resourceType() === 'stylesheet' && !response.ok()) errors.push(`stylesheet ${response.status()}: ${response.url()}`); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(url);
  assert.equal(await page.locator('.editor-project-name').innerText(), '未打开项目');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.locator('.editor-project-name').innerText(), '未打开项目', 'empty-history undo must remain a no-op');
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.v4-authoring .block[data-line="3"]').waitFor();
  return { context, page };
};

const keyboardActivate = async (control, key = 'Enter') => {
  await control.focus();
  if (!await control.evaluate((node) => node === document.activeElement)) {
    console.error('Keyboard focus mismatch', await control.evaluate(node => ({ target: node.outerHTML.slice(0, 400), active: document.activeElement?.outerHTML.slice(0, 400), openDialog: Boolean(document.querySelector('dialog[open]')) })));
  }
  assert(await control.evaluate((node) => node === document.activeElement), 'keyboard target did not receive focus');
  await control.press(key);
};

const checkSurface = async (page, mode) => {
  const root = page.locator(`[data-editor-mode-surface="${mode}"]`);
  await root.waitFor();
  assert.equal(await root.count(), 1, `${mode}: duplicate mode roots`);
  assert.equal(await page.locator(`[data-editor-mode="${mode}"]`).getAttribute('aria-current'), 'page');
  const controlledId = await page.locator(`[data-editor-mode="${mode}"]`).getAttribute('aria-controls');
  assert(await root.evaluate((node, id) => Boolean(id && node.contains(document.getElementById(id))), controlledId), `${mode}: navigation does not reference its active work surface`);
  assert(await root.evaluate((node) => getComputedStyle(node).display === 'flex' && node.getBoundingClientRect().height > 100), `${mode}: main structure collapsed`);
  const pageBounds = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  if (pageBounds.content > pageBounds.viewport + 2) console.error('Overflow elements', await page.evaluate(() => [...document.body.children, ...document.querySelectorAll('.editor-project-bar *')].filter(node => node.getBoundingClientRect().right > innerWidth + 2).map(node => ({ class: node.className, width: node.getBoundingClientRect().width, text: node.textContent?.slice(0, 100) }))));
  assert(pageBounds.content <= pageBounds.viewport + 2, `${mode}: page overflow ${JSON.stringify(pageBounds)}`);
  assert(await page.locator('iframe.preview-frame').count() <= 1, `${mode}: multiple preview runtimes`);
  if (mode === 'preview') {
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe.preview-frame');
      const canvas = frame?.contentDocument?.querySelector('canvas')?.getBoundingClientRect();
      return canvas && canvas.width > 0 && canvas.height > 0 && canvas.left >= -1 && canvas.top >= -1 && canvas.right <= frame.contentWindow.innerWidth + 1 && canvas.bottom <= frame.contentWindow.innerHeight + 1;
    }).catch(async (error) => {
      console.error('Preview canvas bounds', await page.locator('iframe.preview-frame').evaluate((frame) => ({ viewport: [innerWidth, innerHeight], frame: [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight], canvas: frame.contentDocument.querySelector('canvas')?.getBoundingClientRect().toJSON() })));
      throw error;
    });
  }
};
try {
  browser = await chromium.launch({ headless: true });
  let opened = await open();
  let page = opened.page;
  await page.mouse.move(0, 0);
  const hiddenSceneActions = await page.locator('.scene-row-actions').first().evaluate((actions) => {
    const rect = actions.querySelector('button').getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { opacity: getComputedStyle(actions).opacity, intercepts: Boolean(hit?.closest('.scene-row-action')) };
  });
  assert.equal(hiddenSceneActions.opacity, '0');
  assert.equal(hiddenSceneActions.intercepts, false, 'invisible scene rename/delete controls must not intercept row clicks');
  // Studio workbench: layout and navigation never alter the original document.
  for (const label of ['调整目录宽度', '调整画面与属性区宽度']) {
    const separator = page.getByRole('separator', { name: label, exact: true });
    const pane = page.locator(label === '调整目录宽度' ? '#sidebar' : '.v4-script-dock');
    const beforeWidth = (await pane.boundingBox()).width;
    const before = Number(await separator.getAttribute('aria-valuenow'));
    await separator.press('ArrowRight');
    assert.notEqual(Number(await separator.getAttribute('aria-valuenow')), before);
    assert.notEqual((await pane.boundingBox()).width, beforeWidth, 'resizer must change the actual panel, not only its accessible value');
    await separator.press('ArrowLeft');
  }
  await page.keyboard.press('Control+k');
  let projectSearch = page.getByRole('dialog', { name: '搜索项目', exact: true });
  await keyboardActivate(projectSearch.getByRole('button', { name: '关闭搜索', exact: true }));
  await projectSearch.waitFor({ state: 'detached' });
  assert.equal(await page.locator('[data-editor-mode="editor"]').getAttribute('aria-current'), 'page', 'Enter on close must not activate a search result');
  await page.keyboard.press('Control+k');
  projectSearch = page.getByRole('dialog', { name: '搜索项目', exact: true });
  await projectSearch.getByRole('combobox').fill('分数是');
  await projectSearch.getByRole('combobox').press('Enter');
  await projectSearch.waitFor({ state: 'detached' });
  assert(await page.locator('.block[data-line="5"]').evaluate(node => node.classList.contains('v4-current')), 'project search must reveal the actual matching row');
  await page.getByRole('button', { name: 'lynn:uniform · normal', exact: false }).click();
  assert(await page.locator('.block[data-line="3"]').evaluate(node => node.classList.contains('v4-current')), 'inherited presentation must reveal the original show instruction');
  const beforeDynamicStage = await page.locator('.v4-edit-stage').boundingBox();
  await page.locator('[data-step-summary="6"]').click();
  const dynamicStage = await page.locator('.v4-edit-stage').boundingBox();
  assert(Math.abs(dynamicStage.height - beforeDynamicStage.height) <= 1, 'dynamic presentation must keep the same stage frame');
  await page.getByRole('button', { name: '编辑 intro 画面效果 第 1 个节点', exact: false }).click();
  await page.locator('#timeline-view').waitFor();
  assert.deepEqual(await page.evaluate(() => window.surdetEditorDebug.state.currentTimelineCue), { trackIndex: 0, cueIndex: 0 });
  await page.locator('[data-editor-mode="editor"]').click();
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text), source);
  console.log('PASS Studio: panel resizing, project search, presentation source and exact timeline cue navigation preserve source');
  const addStory = page.locator('#script-v4-toolbar').getByRole('button', { name: '添加剧情', exact: true });
  await keyboardActivate(addStory, 'Space');
  const dialog = page.getByRole('dialog', { name: '添加剧情', exact: true });
  assert.equal(await dialog.count(), 1, 'one activation must open only one dialog');
  await page.keyboard.press('Tab');
  assert(await dialog.evaluate((node) => node.contains(document.activeElement)), 'dialog Tab escaped the active modal');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert(await addStory.evaluate((node) => node === document.activeElement), 'Escape did not restore the insertion trigger');
  assert(await addStory.evaluate((node) => getComputedStyle(node).outlineStyle === 'solid' && parseFloat(getComputedStyle(node).outlineWidth) >= 2), 'focus must remain independently visible');
  await keyboardActivate(page.locator('.scene-item').first());
  await keyboardActivate(page.locator('[data-step-summary="3"]'), 'Space');
  await page.locator('[data-step-summary="3"]').click();
  await page.getByRole('button', { name: '选择表情 despair', exact: true }).click();
  await page.getByRole('button', { name: '左侧', exact: true }).click();
  const beforeSearchUndo = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text);
  await page.keyboard.press('Control+k');
  projectSearch = page.getByRole('dialog', { name: '搜索项目', exact: true });
  await projectSearch.getByRole('combobox').fill('查询文字');
  await projectSearch.getByRole('combobox').press('Control+z');
  await projectSearch.getByRole('combobox').press('Control+s');
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text), beforeSearchUndo, 'search undo must not undo the project');
  assert.equal(await page.locator('[data-save-state]').getAttribute('data-save-state'), 'dirty', 'search keyboard must not save underlying drafts');
  await page.keyboard.press('Escape');
  await projectSearch.waitFor({ state: 'detached' });
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved');
  files = await page.evaluate(() => window.__surdetDumpFakeRoot());
  const saved = Buffer.from(files.find((item) => item.path === 'content/scenario/start.gal').bytes, 'base64').toString('utf8');
  assert.equal(saved, source.replace('@show lynn:uniform normal @ right', '@show lynn:uniform despair @ left'));
  await opened.context.close();
  opened = await open(); page = opened.page;
  await page.locator('[data-script-view="source"]').click();
  assert.equal(await page.locator('.v4-source-editor').inputValue(), saved.replace(/\r\n/g, '\n'));
  await page.locator('[data-script-view="arrange"]').click();
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe.preview-frame');
    const debug = frame?.contentWindow?.surdetPreviewDebug;
    return debug?.interp && debug?.runtime;
  });
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe.preview-frame');
    const runtime = frame?.contentWindow?.surdetPreviewDebug?.runtime;
    if (!runtime) return false;
    return JSON.stringify(runtime.queries.diagnostics.projectionSnapshot()).includes('分数是 15。')
      || JSON.stringify(runtime.queries.presentation.snapshot()).includes('分数是 15。');
  });
  console.log('PASS full Editor: visual changes -> original save -> reopen -> real preview interpolation');
  // This input must not silently restart or label an old runtime frame as current.
  const beforeFrame = await page.locator('iframe.preview-frame').getAttribute('src');
  await page.locator('.block[data-line="5"] .v4-dialogue-input').fill('更新后的对白。');
  await page.locator('[data-preview-source-state="stale"]').waitFor();
  assert.equal(await page.locator('iframe.preview-frame').getAttribute('src'), beforeFrame);
  // Final-audit closure: exercise the actual composition root, not only module fixtures.
  await page.locator('[data-script-view="source"]').click();
  const sourceBeforeClosure = await page.locator('.v4-source-editor').inputValue();
  const sourceEdited = sourceBeforeClosure.replace('更新后的对白。', '源码修改后的对白。');
  assert.notEqual(sourceEdited, sourceBeforeClosure, 'source closure fixture drifted');
  // End the existing 600 ms typing-coalescing window before the new source edit.
  await page.waitForTimeout(650);
  await page.locator('.v4-source-editor').fill(sourceEdited);
  await page.locator('.v4-source-editor').evaluate((node) => {
    const caret = node.value.indexOf('凛：源码修改后的对白。');
    if (caret < 0) throw new Error('source insertion anchor is missing');
    node.setSelectionRange(caret, caret);
  });
  await page.locator('#script-v4-toolbar').getByRole('button', { name: '添加剧情', exact: true }).click();
  await page.locator('.v4-insert-fields textarea').fill('源码插入定位用例。');
  await page.getByRole('button', { name: '插入到当前步骤之后', exact: true }).click();
  await page.locator('.v4-insert-dialog').waitFor({ state: 'detached' });
  const sourceAfterInsert = sourceEdited.replace('凛：源码修改后的对白。', '凛：源码修改后的对白。\n源码插入定位用例。');
  assert.equal(await page.locator('.v4-source-editor').inputValue(), sourceAfterInsert);
  assert.equal(await page.locator('.v4-authoring').getAttribute('data-script-view'), 'source');
  await page.keyboard.press('Control+f');
  await page.locator('#search-input').fill('源码插入定位用例。');
  await page.locator('#search-panel').getByRole('button', { name: '搜索', exact: true }).click();
  await page.locator('.search-item').filter({ hasText: '源码插入定位用例。' }).first().click();
  const sourceLocation = await page.locator('.v4-source-editor').evaluate((node) => ({
    active: node === document.activeElement,
    selected: node.value.slice(node.selectionStart, node.selectionEnd),
  }));
  assert.deepEqual(sourceLocation, { active: true, selected: '源码插入定位用例。' });
  assert.equal(await page.locator('.v4-source-editor').inputValue(), sourceAfterInsert, 'search navigation changed source');
  // Keep original fixture shape for the existing nine-workspace checks.
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.locator('.v4-source-editor').inputValue(), sourceEdited);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.locator('.v4-source-editor').inputValue(), sourceBeforeClosure);
  await page.locator('[data-script-view="arrange"]').click();
  console.log('PASS full Editor: source edit -> anchored insertion -> visible search location -> independent undo');
  await page.locator('[data-editor-mode="config"]').click();
  await page.getByRole('button', { name: '名词表', exact: true }).click();
  const variants = page.getByRole('textbox', { name: '变体列表，第 1 行', exact: true });
  assert(await variants.evaluate((node) => node.getBoundingClientRect().width >= node.closest('tr').getBoundingClientRect().width - 2), 'multiline JSON did not span the object workspace');
  const originalVariants = await variants.inputValue();
  const invalidVariants = '[\n  "保留未完成草稿",\n';
  await variants.fill(invalidVariants);
  await page.getByRole('button', { name: '保存名词表', exact: true }).click();
  assert.equal(await variants.inputValue(), invalidVariants, 'rejected JSON draft was silently rewritten');
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '名词表', exact: true }).click();
  assert.equal(await variants.inputValue(), invalidVariants, 'section selection lost an invalid JSON draft');
  await variants.fill(originalVariants);
  await page.getByRole('button', { name: '保存名词表', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('名词表已保存'));
  await page.getByRole('button', { name: '角色', exact: true }).click();
  console.log('PASS full-width native JSON textarea and preserved invalid draft');
  await keyboardActivate(page.locator('[data-editor-mode="timeline"]'));
  await keyboardActivate(page.locator('[data-timeline-id="invalid"]'));
  assert(await page.getByText('此时间轴暂不可播放', { exact: true }).isVisible(), 'invalid timeline must have a textual error state');
  const disabledPreview = page.locator('.timeline-header-actions .primary');
  assert(await disabledPreview.isDisabled(), 'invalid timeline preview must stay disabled');
  await disabledPreview.evaluate((node) => node.focus());
  assert(!await disabledPreview.evaluate((node) => node === document.activeElement), 'disabled preview remained focusable');
  assert.equal(await page.locator('.timeline-header-actions .primary').isDisabled(), true);
  await keyboardActivate(page.locator('[data-timeline-id="intro"]'));
  await keyboardActivate(page.locator('[data-editor-mode="assets"]'));
  await page.locator('.asset-center-item[data-asset-id]').filter({ hasText: 'unavailable' }).first().scrollIntoViewIfNeeded();
  await page.locator('[data-asset-thumbnail-state="error"]').first().waitFor();
  assert(await page.locator('[data-asset-thumbnail-state="error"] .asset-center-thumbnail-label').first().evaluate((node) => {
    const label = node.getBoundingClientRect(), item = node.closest('[data-asset-id]').getBoundingClientRect();
    return label.left >= item.left && label.right <= item.right && label.top >= item.top && label.bottom <= item.bottom;
  }), 'failed image label escaped its own asset row');
  const imageStates = await page.evaluate(() => window.__pass10ImageStates);
  assert(imageStates.includes('loading') && imageStates.includes('ready') && imageStates.includes('error'), 'image loading/failure must settle into readable placeholders');
  console.log('PASS textual validation error, disabled preview, real image loading/error and long technical path');
  const modes = ['editor', 'assets', 'flow', 'timeline', 'config', 'preview', 'review', 'stats', 'audit'];
  for (const [width, height] of [[1792, 900], [1280, 800], [960, 720], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const mode of modes) {
      await keyboardActivate(page.locator(`[data-editor-mode="${mode}"]`), modes.indexOf(mode) % 2 ? 'Space' : 'Enter');
      await checkSurface(page, mode);
      await page.waitForTimeout(100);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${mode} ${width}: page overflow`);
      assert(await page.locator('iframe.preview-frame').count() <= 1, `${mode}: multiple preview runtimes`);
      if (mode === 'editor' && width >= 1280) {
        const firstStep = await page.locator('.block[data-line="0"]').boundingBox();
        assert(firstStep && firstStep.height < 100, 'legacy spreadsheet layout expanded a compact step');
        const inspector = await page.locator('#script-v4-inspector').boundingBox();
        assert(inspector && inspector.height >= 200, 'picture squeezed out the inspector');
      }
      if (mode === 'config') {
        await page.locator('.config-ledger-section:not([hidden]) .config-table').waitFor();
        const avatar = await page.getByRole('textbox', { name: 'lynn 的头像素材', exact: true }).boundingBox();
        assert(avatar && avatar.width >= 120, 'legacy last-column width squeezed a configuration field');
      }
    }
  }
  await page.locator('[data-editor-mode="editor"]').click();
  await page.setViewportSize({ width: 960, height: 720 });
  const compactDock = page.locator('.v4-script-dock');
  const compactDockWidth = (await compactDock.boundingBox()).width;
  await page.getByRole('separator', { name: '调整画面与属性区宽度', exact: true }).press('ArrowLeft');
  assert((await compactDock.boundingBox()).width > compactDockWidth, 'desktop split window must retain a working resizer');
  await page.locator('[data-workbench-panel="outline"]').click();
  assert(await page.locator('#sidebar').isVisible(), 'medium-width scene directory is unreachable');
  await page.locator('[data-workbench-panel="editor"]').click();
  const dialogue = page.locator('.block[data-line="5"] .v4-dialogue-input');
  const longText = '长对白仍可连续编辑，标点和内容都保留。'.repeat(30);
  // A wider preview/directory and a narrower desktop window must reflow the
  // existing textarea, not hide its bottom lines until the next text edit.
  await page.setViewportSize({ width: 1600, height: 1000 });
  await dialogue.fill(longText);
  await dialogue.press('End');
  await dialogue.press('Shift+ArrowLeft');
  const beforeResizeSource = await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text);
  const beforeResizeSelection = await dialogue.evaluate(node => [node.selectionStart, node.selectionEnd, node.selectionDirection]);
  const expectDialogueReflow = async () => {
    await page.waitForFunction(() => {
      const node = document.querySelector('.block[data-line="5"] .v4-dialogue-input');
      return node && node.clientHeight > 0 && node.scrollHeight <= node.clientHeight + 1;
    }, null, { timeout: 3_000 }).catch(async (error) => {
      console.error('Dialogue reflow dimensions', await dialogue.evaluate(node => ({ width: node.clientWidth, height: node.clientHeight, contentHeight: node.scrollHeight })));
      throw error;
    });
    assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text), beforeResizeSource,
      'layout reflow must not edit the shared scene');
    assert.deepEqual(await dialogue.evaluate(node => [node.selectionStart, node.selectionEnd, node.selectionDirection]), beforeResizeSelection,
      'layout reflow must preserve the textarea selection');
  };
  await expectDialogueReflow();
  for (const [label, key, count] of [
    ['调整目录宽度', 'ArrowRight', 6],
    ['调整画面与属性区宽度', 'ArrowLeft', 8],
  ]) {
    const separator = page.getByRole('separator', { name: label, exact: true });
    const beforeWidth = await dialogue.evaluate(node => node.clientWidth);
    for (let index = 0; index < count; index++) await separator.press(key);
    assert((await dialogue.evaluate(node => node.clientWidth)) < beforeWidth,
      'the regression must actually narrow the existing dialogue');
    await expectDialogueReflow();
  }
  await dialogue.focus();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectDialogueReflow();
  assert(await dialogue.evaluate(node => node === document.activeElement), 'window reflow must not steal dialogue focus');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('separator', { name: '调整目录宽度', exact: true }).dblclick();
  await page.getByRole('separator', { name: '调整画面与属性区宽度', exact: true }).dblclick();
  await expectDialogueReflow();
  await dialogue.focus();
  await page.setViewportSize({ width: 960, height: 720 });
  await expectDialogueReflow();
  assert(await dialogue.evaluate(node => node === document.activeElement), 'desktop split reflow must preserve dialogue focus');
  console.log('PASS desktop dialogue reflow follows both panes and window width without changing source or selection');
  const beforeCompositionRows = await page.locator('.block[data-line]').count();
  await dialogue.evaluate((node) => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    node.value += '确认';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, data: '确认', isComposing: true }));
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', isComposing: true }));
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '确认' }));
  });
  assert.equal(await page.locator('.block[data-line]').count(), beforeCompositionRows, 'composition Enter inserted another DSL row');
  assert(await dialogue.evaluate((node) => node === document.activeElement), 'long input or composition lost focus');
  await page.locator('[data-script-view="source"]').click();
  assert((await page.locator('.v4-source-editor').inputValue()).includes(`${longText}确认`), 'composition did not reach shared source');
  await page.locator('[data-script-view="arrange"]').click();
  await dialogue.fill('更新后的对白。');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [panel, selector] of [['outline', '#sidebar'], ['picture', '#script-v4-edit-layout'], ['inspector', '#script-v4-inspector'], ['context', '#right'], ['editor', '#editor']]) {
    await keyboardActivate(page.locator(`[data-workbench-panel="${panel}"]`));
    assert(await page.locator(selector).isVisible(), `mobile ${panel} is unreachable`);
    assert(await page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement && active.getClientRects().length > 0 && !active.closest('[hidden],[inert]');
    }), `mobile ${panel}: focus remained in a hidden panel`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await page.locator('.editor-mode-button').first().evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration) < .001), 'reduced motion did not disable navigation transitions');
  await keyboardActivate(page.locator('[data-editor-mode="review"]'));
  assert(await page.getByText('暂无审阅任务', { exact: true }).isVisible(), 'empty review state disappeared');
  await checkSurface(page, 'review');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  console.log('PASS medium directory, mobile panels, long dialogue and synthetic composition (not native IME)');
  if (process.env.SURDET_V4_SCREENSHOTS) {
    const output = path.resolve(process.env.SURDET_V4_SCREENSHOTS); await fs.mkdir(output, { recursive: true });
    await page.setViewportSize({ width: 1792, height: 900 });
    for (const [mode, name, width, height] of [
      ['editor', '01-editor-wide.png', 1792, 900],
      ['assets', '02-assets-wide.png', 1792, 900],
      ['flow', '03-flow-medium.png', 960, 720],
      ['preview', '04-preview-or-review-wide.png', 1792, 900],
      ['stats', '05-project-health-wide.png', 1792, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await page.locator(`[data-editor-mode="${mode}"]`).click();
      await page.waitForTimeout(100);
      if (mode === 'preview') await page.waitForFunction(() => {
        const runtime = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.runtime;
        return runtime && JSON.stringify(runtime.queries.diagnostics.projectionSnapshot()).includes('更新后的对白。');
      });
      if (mode === 'assets') await page.locator('.asset-center-item[data-asset-id]').first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-image-state="loading"],[data-asset-thumbnail-state="loading"]')].every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight;
      }));
      await page.locator('img').evaluateAll(async (images) => {
        for (const image of images) {
          const rect = image.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= innerHeight) await image.decode();
        }
      });
      await page.screenshot({ path: path.join(output, name) });
    }
  }
  // Close the real preview while its source hashing is in flight. The original
  // teardown used to let this continuation start an interpreter on a disposed renderer.
  await page.locator('[data-editor-mode="preview"]').click();
  const closingFrame = await (await page.locator('iframe.preview-frame').elementHandle()).contentFrame();
  await closingFrame.waitForFunction(() => Boolean(window.surdetPreviewDebug?.interp && window.surdetPreviewDebug?.runtime));
  await closingFrame.evaluate(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    window.__heldHashes = [];
    window.__pendingHashes = [];
    crypto.subtle.digest = async (...args) => {
      const result = await digest(...args);
      const pending = new Promise(resolve => window.__heldHashes.push(resolve));
      window.__pendingHashes.push(pending);
      await pending;
      return result;
    };
  });
  await page.locator('[data-action="reload-preview"]').click();
  await closingFrame.waitForFunction(() => window.__heldHashes.length > 0);
  await closingFrame.evaluate(async () => {
    window.dispatchEvent(new Event('beforeunload'));
    window.__heldHashes.forEach(resolve => resolve());
    await Promise.all(window.__pendingHashes);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert(await closingFrame.evaluate(() => window.surdetPreviewDebug.runtime === null && window.surdetPreviewDebug.interp === null), 'closing a preview must not resurrect the renderer or interpreter');
  console.log('PASS actual preview teardown cancels the in-flight source continuation without querying a disposed renderer');
  await browser.close(); browser = null;
  // Reuse the Pass 8 chrome.tabs.setZoom method in a disposable profile. Local
  // zoom is headed; CI uses Chromium's headless extension support, never page-scale.
  zoomRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-pass10-zoom-'));
  const extension = path.join(zoomRoot, 'extension'); await fs.mkdir(extension);
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Surdet Editor zoom test', version: '1.0', permissions: ['tabs'], background: { service_worker: 'zoom.js' } }));
  await fs.writeFile(path.join(extension, 'zoom.js'), 'chrome.runtime.onInstalled.addListener(() => {}); setInterval(() => chrome.runtime.getPlatformInfo(), 20000);');
  zoomContext = await chromium.launchPersistentContext(path.join(zoomRoot, 'profile'), { channel: 'chromium', headless: Boolean(process.env.CI), viewport: { width: 1792, height: 1000 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  opened = await open(zoomContext); page = opened.page;
  const worker = zoomContext.serviceWorkers()[0] ?? await zoomContext.waitForEvent('serviceworker');
  const zoomBaseline = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio }));
  const zoom = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(url));
    if (!tab) throw new Error('Editor zoom tab missing');
    await chrome.tabs.setZoom(tab.id, 2);
    return chrome.tabs.getZoom(tab.id);
  }, url);
  assert.equal(zoom, 2);
  await page.waitForFunction((baseline) => Math.abs(innerWidth - baseline.width / 2) <= 1 && Math.abs(devicePixelRatio - baseline.ratio * 2) < .01, zoomBaseline).catch(async (error) => {
    console.error('Browser zoom metrics', { zoom, baseline: zoomBaseline, actual: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })) });
    throw error;
  });
  console.log('PASS actual browser zoom', JSON.stringify({ zoom, before: zoomBaseline, after: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })) }));
  for (const mode of ['editor', 'assets', 'review']) {
    await keyboardActivate(page.locator(`[data-editor-mode="${mode}"]`));
    await checkSurface(page, mode);
    if (mode === 'editor') {
      await keyboardActivate(page.locator('[data-workbench-panel="outline"]'));
      assert(await page.locator('#sidebar').isVisible());
      await keyboardActivate(page.locator('[data-workbench-panel="editor"]'));
      await keyboardActivate(page.locator('#script-v4-toolbar').getByRole('button', { name: '添加剧情', exact: true }));
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: '添加剧情', exact: true }).waitFor({ state: 'detached' });
    }
    if (mode === 'assets') {
      await keyboardActivate(page.locator('.asset-center-item[data-asset-id]').first());
      const search = page.locator('.asset-center-search input');
      await search.fill('没有匹配的素材');
      assert.equal(await page.locator('.asset-center-item[data-asset-id]').count(), 0);
      await search.fill('');
    }
  }
  await keyboardActivate(page.locator('[data-editor-mode="editor"]'));
  if (process.env.SURDET_V4_SCREENSHOTS) await page.screenshot({ path: path.join(path.resolve(process.env.SURDET_V4_SCREENSHOTS), '06-editor-narrow-or-zoom.png') });
  assert.deepEqual(errors, []);
  console.log(`PASS nine modes × four viewports, keyboard/modal focus, reduced motion, empty review, genuine 200% Chromium zoom (${process.env.CI ? 'CI headless' : 'local visible'}); no runtime/style errors or duplicate preview; FS adapter scope only.`);
} finally {
  await browser?.close();
  await zoomContext?.close();
  if (zoomRoot) {
    assert.equal(path.dirname(zoomRoot), path.resolve(os.tmpdir()));
    assert(path.basename(zoomRoot).startsWith('surdet-pass10-zoom-'));
    await fs.rm(zoomRoot, { recursive: true, force: true });
  }
  await new Promise((resolve) => server.close(resolve));
}
