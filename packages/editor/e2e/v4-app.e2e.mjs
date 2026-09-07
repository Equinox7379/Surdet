import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
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
const source = '@scene start\r\n@label opening\r\n@bg hall\r\n@show lynn:uniform normal @ right\r\n@set score = 10 + 5\r\n凛：分数是 {score}。\r\n@end';
const documents = {
  'game.config.json': JSON.stringify({ entryScene: 'start', variables: { score: { type: 'number', initial: 0 } }, characters: { lynn: { name: '凛' } } }),
  'content/scenario/start.gal': source,
  'content/config/terminology.json': JSON.stringify({ terms: [{ canonical: '重逢', variants: ['再会'] }] }),
  'content/assets/bg/hall.svg': svg,
  'content/assets/portrait/lynn_uniform_normal.svg': svg,
  'content/assets/portrait/lynn_uniform_despair.svg': svg,
  'content/timelines/intro.json': JSON.stringify({ version: 1, id: 'intro', durationMs: 600, tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 600, easing: 'linear', action: 'fade', alpha: 0 }] }] }),
};
// Reuse existing Starter SVGs only as test art; never depend on this project in production.
for (const [target, original] of [
  ['content/assets/bg/hall.svg', 'bg/castle_hall.svg'],
  ['content/assets/portrait/lynn_uniform_normal.svg', 'portrait/lynn_uniform_normal.svg'],
  ['content/assets/portrait/lynn_uniform_despair.svg', 'portrait/lynn_uniform_despair.svg'],
]) documents[target] = await fs.readFile(path.resolve(editorRoot, '../../examples/starter/content/assets', original), 'utf8');
let files = Object.entries(documents).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));
let browser;
const errors = [];
const open = async () => {
  const context = await browser.newContext({ viewport: { width: 1792, height: 900 } });
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-v4-test-only', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(url);
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.v4-authoring .block[data-line="3"]').waitFor();
  return { context, page };
};
try {
  browser = await chromium.launch({ headless: true });
  let opened = await open();
  let page = opened.page;
  await page.locator('[data-step-summary="3"]').click();
  await page.getByRole('button', { name: '选择表情 despair', exact: true }).click();
  await page.getByRole('button', { name: '左侧', exact: true }).click();
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
  const modes = ['editor', 'assets', 'flow', 'timeline', 'config', 'preview', 'review', 'stats', 'audit'];
  for (const [width, height] of [[1792, 900], [1280, 800], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const mode of modes) {
      await page.locator(`[data-editor-mode="${mode}"]`).click();
      await page.locator(`[data-editor-mode-surface="${mode}"]`).waitFor();
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
  await page.setViewportSize({ width: 960, height: 800 });
  await page.locator('[data-workbench-panel="outline"]').click();
  assert(await page.locator('#sidebar').isVisible(), 'medium-width scene directory is unreachable');
  await page.locator('[data-workbench-panel="editor"]').click();
  const dialogue = page.locator('.block[data-line="5"] .v4-dialogue-input');
  const longText = '长对白仍可连续编辑，标点和内容都保留。'.repeat(30);
  await dialogue.fill(longText);
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
    await page.locator(`[data-workbench-panel="${panel}"]`).click();
    assert(await page.locator(selector).isVisible(), `mobile ${panel} is unreachable`);
  }
  console.log('PASS medium directory, mobile panels, long dialogue and synthetic composition (not native IME)');
  if (process.env.SURDET_V4_SCREENSHOTS) {
    const output = path.resolve(process.env.SURDET_V4_SCREENSHOTS); await fs.mkdir(output, { recursive: true });
    await page.setViewportSize({ width: 1792, height: 900 });
    for (const mode of ['editor', 'assets', 'config']) {
      await page.locator(`[data-editor-mode="${mode}"]`).click();
      await page.waitForTimeout(100);
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
      await page.screenshot({ path: path.join(output, `${mode}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS nine modes × three widths, no page errors, no duplicate preview; FS adapter scope only.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
