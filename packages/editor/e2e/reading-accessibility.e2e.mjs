import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { fakeFileSystemInit } from './support/fake-file-system.mjs';

// Built Editor with the in-memory test file system. Covers the reading-accessibility front end:
// the UI designer offers Core's reading settings, and the preview's try-out changes only the
// running preview through Renderer commands, never the work or any stored settings.
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

const config = { entryScene: 'start', characters: { lynn: { name: '凛' } } };
const files = Object.entries({
  'game.config.json': JSON.stringify(config),
  'content/scenario/start.gal': '@scene start\n凛：雨一直下到傍晚，站台上的灯一盏接一盏亮起来。\n凛：她把车票折成很小的方块。\n@end\n',
}).map(([file, text]) => ({ path: file, bytes: Buffer.from(text).toString('base64') }));

const outDir = process.env.SURDET_READING_E2E_OUTPUT;
const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 } });
  context.setDefaultTimeout(20000);
  await context.addInitScript(fakeFileSystemInit, { rootName: 'surdet-reading-test', files });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.goto(url);
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.v4-authoring .block[data-line="1"]').waitFor();

  // 1. UI designer: setting lists come from Core's table.
  await page.locator('[data-editor-mode="config"]').click();
  await page.locator('[data-config-section-target="ui"]').click();
  await page.locator('[data-ui-designer="true"]').waitFor({ state: 'visible' });
  const optionLabels = (locator) => locator.locator('option').allTextContents();
  const bindingName = () => page.getByLabel('控件绑定项', { exact: true });
  await page.getByLabel('作品界面页面', { exact: true }).selectOption('settings');
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.getByLabel('新增组件类型', { exact: true }).selectOption('toggle');
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const toggleNames = await optionLabels(bindingName());
  for (const label of ['减少动态效果', '朗读未配音台词', '快进策略']) assert(toggleNames.includes(label), `toggle offers ${label}: ${toggleNames}`);
  assert(!toggleNames.includes('文字大小'), 'a toggle never offers a number setting');
  await bindingName().selectOption({ label: '朗读未配音台词' });
  await page.waitForFunction(() => document.querySelector('select[aria-label="控件绑定项"]')?.value === 'readAloud');
  await page.getByLabel('新增组件类型', { exact: true }).selectOption('slider');
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  const sliderNames = await optionLabels(bindingName());
  for (const label of ['文字大小', '对话框不透明度', '文本速度']) assert(sliderNames.includes(label), `slider offers ${label}: ${sliderNames}`);
  assert(!sliderNames.includes('朗读未配音台词'), 'a slider never offers an on/off setting');
  if (outDir) await page.screenshot({ path: path.join(outDir, 'designer-settings.png') });
  console.log('PASS UI designer offers Core reading settings by control type');

  // 2. Preview try-out: Renderer commands only; nothing stored.
  await page.locator('[data-editor-mode="editor"]').click();
  await page.getByRole('button', { name: '运行预览', exact: true }).click();
  const debug = (read) => page.evaluate(`(() => { const debug = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return debug?.interp && debug?.runtime ? (${read})(debug) : null; })()`);
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.runtime?.queries.diagnostics.projectionSnapshot().dialogue?.dialogText.includes('雨一直下'));
  const recorded = await debug(`(d) => {
    const preferences = d.runtime.commands.preferences, window_ = document.querySelector('iframe.preview-frame').contentWindow;
    window_.readingCalls = [];
    for (const name of ['setReadingPreferences', 'setPresentationPreferences']) {
      const original = preferences[name].bind(preferences);
      preferences[name] = (value) => { window_.readingCalls.push({ name, value }); return original(value); };
    }
    return preferences.setReadingPreferences !== undefined;
  }`);
  assert(recorded, 'preview preferences can be observed');
  const stored = () => page.evaluate(() => ({
    preview: document.querySelector('iframe.preview-frame').contentWindow.localStorage.getItem('surdet:preview:settings'),
    config: window.surdetEditorDebug?.state?.gameConfigText ?? null,
  }));
  const before = await stored();
  const calls = () => page.evaluate(() => document.querySelector('iframe.preview-frame').contentWindow.readingCalls);
  await page.getByLabel('试看文字大小', { exact: true }).selectOption({ label: '字号 140%' });
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame').contentWindow.readingCalls.some((call) => call.name === 'setReadingPreferences' && call.value.textScale === 1.4));
  await page.getByLabel('试看动态效果', { exact: true }).selectOption({ label: '减少动态' });
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame').contentWindow.readingCalls.some((call) => call.name === 'setPresentationPreferences' && call.value.reducedMotion === true));
  if (outDir) await page.screenshot({ path: path.join(outDir, 'preview-trial-140.png') });
  await page.getByLabel('试看文字大小', { exact: true }).selectOption({ label: '字号按设置' });
  await page.waitForFunction(() => document.querySelector('iframe.preview-frame').contentWindow.readingCalls.at(-2)?.value.textScale === 1);
  assert.deepEqual(await stored(), before, 'the try-out writes neither the preview settings nor the work configuration');
  console.log(`PASS preview try-out applies through Renderer commands and stores nothing ${JSON.stringify((await calls()).slice(-4))}`);

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS reading accessibility front end');
} finally {
  await browser.close();
  server.close();
}
