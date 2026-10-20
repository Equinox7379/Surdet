import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { createStageFixture } from './support/stage-fixture.mjs';

// U3 dialog semantics: a chosen share file is read and prepared inside the import dialog. A read
// that finishes late never reaches a dialog that was cancelled, a newer file or a reopened project,
// and nothing changes the draft or the asset workbench before an explicit 应用到草稿 / 加入素材导入.
const base = os.tmpdir();
const output = fs.mkdtempSync(path.join(base, 'surdet-ui-share-late-import-'));
const share = (text) => JSON.stringify({ format: 'surdet-ui', version: 1, kind: 'fragment', variables: {}, assets: [],
  config: { ui: { version: 1, pages: { title: { id: 'root', type: 'container', frame: { x: 0, y: 0, width: 1280, height: 720 }, children: [
    { id: 'label', type: 'text', frame: { x: 30, y: 30, width: 250, height: 50 }, text: { kind: 'literal', value: text } },
  ] } } } } });
const assetShare = (name) => {
  const value = JSON.parse(share(name));
  value.config.ui.pages.title.children.push({ id: 'picture', type: 'image', frame: { x: 0, y: 0, width: 50, height: 50 }, asset: name });
  value.assets.push({ path: `content/assets/bg/${name}.png`, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw4kAAAAASUVORK5CYII=' });
  return JSON.stringify(value);
};
const snapshot = page => page.evaluate(async () => {
  const config = await import('/src/panels/config.ts');
  return { ui: config.readUiConfigDraft(), dirty: config.inspectConfigDraftState(), history: config.configHistoryDepth(),
    files: window.surdetEditorDebug.state.assetImportWorkspace.draftItems.map(item => item.fileName) };
});
const dialogState = page => page.evaluate(() => {
  const dialog = document.querySelector('[data-ui-share-import-dialog]');
  if (!dialog) return null;
  return { file: dialog.querySelector('.ui-share-import-file')?.textContent, status: dialog.querySelector('.ui-share-import-status')?.textContent,
    error: dialog.querySelector('[data-ui-share-import-error]')?.innerText ?? null, applyDisabled: dialog.querySelector('[data-ui-share-import-apply]').disabled,
    resources: [...dialog.querySelectorAll('[data-ui-share-import-resource]')].map(item => `${item.dataset.uiShareImportResource}:${item.dataset.state}`),
    impact: [...dialog.querySelectorAll('[data-ui-share-import-page]')].map(item => item.innerText).join('\n') };
});
const ready = page => page.waitForFunction(() => document.querySelector('[data-ui-share-import-dialog] .ui-share-import-status')?.textContent?.includes('预览已就绪'));
const loaded = page => page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState === 'ready');
const results = [], errors = [];
let server, browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const mode of ['cancel-then-edit', 'new-file', 'missing-assets', 'project-reopen', 'unchanged']) {
    const fixture = createStageFixture(path.join(output, mode, 'project'));
    const configPath = path.join(fixture.root, 'game.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')); delete config.ui;
    config.privateAuditMarker = 'KEEP_UI_SOURCE';
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    const originalConfig = fs.readFileSync(configPath);
    server = await startDevProject(['--project', fixture.root, '--data-root', path.join(output, mode, 'authority'), '--port', '18080'], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: fixture.root }));
      await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
      await page.goto('http://127.0.0.1:18080/index.html');
      await page.locator('[data-action="open-project"]').click();
      await loaded(page);
      const toDesigner = async () => {
        await page.locator('[data-editor-mode="config"]').click();
        await page.locator('[data-config-section-target="ui"]').click();
        await page.locator('[data-ui-designer="true"]').waitFor({ state: 'visible' });
      };
      await toDesigner();
      await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function () {
          if (this.name !== 'delayed-fragment.json') return original.call(this);
          window.__shareReading = true;
          return new Promise(resolve => { window.__releaseShare = async () => resolve(await original.call(this)); });
        };
      });
      const initial = await snapshot(page);
      const upload = page.locator('.ui-designer input[type="file"]');
      await upload.setInputFiles({ name: 'delayed-fragment.json', mimeType: 'application/json', buffer: Buffer.from(mode === 'missing-assets' ? assetShare('old_a') : share('旧文件A')) });
      await page.waitForFunction(() => window.__shareReading === true);
      const reading = await dialogState(page);
      assert.equal(reading.status, '正在读取文件…'); assert.equal(reading.applyDisabled, true);
      assert.deepEqual(await snapshot(page), initial, 'choosing a file changes nothing');
      const chooseInDialog = async (name, text) => {
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '选择其他文件…', exact: true }).click()]);
        await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
        await ready(page);
      };
      if (mode === 'cancel-then-edit') {
        await page.keyboard.press('Escape');
        await page.locator('[data-ui-share-import-dialog]').waitFor({ state: 'detached' });
        await page.getByRole('button', { name: '添加组件', exact: true }).click();
        await page.getByLabel('新增组件类型', { exact: true }).selectOption('text');
        await page.getByRole('button', { name: '添加组件', exact: true }).click();
        await page.getByLabel('文字或数据字段', { exact: true }).fill('读取期间的新组件');
        await page.getByLabel('文字或数据字段', { exact: true }).press('Tab');
      } else if (mode === 'new-file') {
        await chooseInDialog('new-fragment.json', share('后选文件B'));
      } else if (mode === 'missing-assets') {
        await chooseInDialog('new-fragment.json', assetShare('new_b'));
      } else if (mode === 'project-reopen') {
        await page.evaluate(() => document.querySelector('[data-action="open-project"]').click());
        await page.locator('[data-ui-share-import-dialog]').waitFor({ state: 'detached' });
        await loaded(page); await toDesigner();
      }
      const before = { draft: await snapshot(page), dialog: await dialogState(page) };
      await page.evaluate(() => window.__releaseShare());
      if (mode === 'unchanged') await ready(page); else await page.waitForTimeout(800);
      const after = { draft: await snapshot(page), dialog: await dialogState(page) };
      if (mode === 'unchanged') {
        assert.deepEqual(after.draft, initial, 'a ready preview is not an apply');
        assert.match(after.dialog.impact, /标题/);
      } else assert.deepEqual(after, before, `${mode}: the late read must not reach the dialog or the draft`);
      if (mode === 'cancel-then-edit') assert(JSON.stringify(after.draft.ui).includes('读取期间的新组件'));
      if (mode === 'new-file') assert.equal(after.dialog.file, '文件：new-fragment.json');
      if (mode === 'missing-assets') {
        assert.deepEqual(after.dialog.resources, ['content/assets/bg/new_b.png:missing']);
        await page.locator('[data-ui-share-import-stage-assets]').click();
        await page.waitForFunction(() => window.surdetEditorDebug.state.assetImportWorkspace.draftItems.length > 0);
        assert.deepEqual((await snapshot(page)).files, ['new_b.png'], 'only the newer file\'s assets are staged');
      }
      if (mode === 'project-reopen') assert.equal(after.dialog, null);
      if (mode === 'new-file' || mode === 'unchanged') {
        await page.locator('[data-ui-share-import-apply]').click();
        await page.locator('[data-ui-share-import-dialog]').waitFor({ state: 'detached' });
        const applied = JSON.stringify((await snapshot(page)).ui);
        assert(applied.includes(mode === 'new-file' ? '后选文件B' : '旧文件A'), applied);
        assert(!applied.includes(mode === 'new-file' ? '旧文件A' : '后选文件B'), applied);
      }
      results.push({ mode, before, after, status: await page.locator('#status').innerText() });
      assert.deepEqual(fs.readFileSync(configPath), originalConfig, 'import must remain a draft');
    } finally { await page.close(); await server.close(); server = undefined; }
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ output, modes: results.map(result => result.mode), errors }, null, 2));
  assert.deepEqual(errors, []);
} catch (error) {
  console.log(JSON.stringify({ output, errors, failure: String(error.stack ?? error) }));
  throw error;
} finally { await browser?.close(); await server?.close(); }
