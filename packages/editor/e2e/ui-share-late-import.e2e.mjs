import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { createStageFixture } from './support/stage-fixture.mjs';

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
const results = [], errors = [];
let server, browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const mode of ['editing', 'new-file', 'missing-assets', 'unchanged']) {
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
      await page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState === 'ready');
      await page.locator('[data-editor-mode="config"]').click();
      await page.locator('[data-config-section-target="ui"]').click();
      await page.locator('[data-ui-designer="true"]').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function () {
          if (this.name !== 'delayed-fragment.json') return original.call(this);
          window.__shareReading = true;
          return new Promise(resolve => { window.__releaseShare = async () => resolve(await original.call(this)); });
        };
      });
      const upload = page.locator('.ui-designer input[type="file"]');
      await upload.setInputFiles({ name: 'delayed-fragment.json', mimeType: 'application/json', buffer: Buffer.from(mode === 'missing-assets' ? assetShare('old_a') : share('旧文件A')) });
      await page.waitForFunction(() => window.__shareReading === true);
      if (mode === 'editing') {
        await page.getByRole('button', { name: '添加组件', exact: true }).click();
        await page.getByLabel('新增组件类型', { exact: true }).selectOption('text');
        await page.getByRole('button', { name: '添加组件', exact: true }).click();
        await page.getByLabel('文字或数据字段', { exact: true }).fill('读取期间的新组件');
        await page.getByLabel('文字或数据字段', { exact: true }).press('Tab');
      } else if (mode === 'new-file') {
        await upload.setInputFiles({ name: 'new-fragment.json', mimeType: 'application/json', buffer: Buffer.from(share('后选文件B')) });
        await page.waitForFunction(async () => JSON.stringify((await import('/src/panels/config.ts')).readUiConfigDraft()).includes('后选文件B'));
      } else if (mode === 'missing-assets') {
        await upload.setInputFiles({ name: 'new-fragment.json', mimeType: 'application/json', buffer: Buffer.from(assetShare('new_b')) });
        await page.waitForFunction(() => window.surdetEditorDebug.state.assetImportWorkspace.draftItems.some(item => item.fileName === 'new_b.png'));
      }
      const before = await page.evaluate(async () => { const config = await import('/src/panels/config.ts'); return { ui: config.readUiConfigDraft(), dirty: config.inspectConfigDraftState(), history: config.configHistoryDepth(), files: window.surdetEditorDebug.state.assetImportWorkspace.draftItems.map(item => item.fileName) }; });
      await page.evaluate(() => window.__releaseShare());
      await page.waitForFunction(async () => /导入期间|另一个共享文件/.test(document.getElementById('status')?.textContent ?? '')
        || JSON.stringify((await import('/src/panels/config.ts')).readUiConfigDraft()).includes('旧文件A')
        || window.surdetEditorDebug.state.assetImportWorkspace.draftItems.some(item => item.fileName === 'old_a.png'));
      const after = await page.evaluate(async () => { const config = await import('/src/panels/config.ts'); return { ui: config.readUiConfigDraft(), dirty: config.inspectConfigDraftState(), history: config.configHistoryDepth(), files: window.surdetEditorDebug.state.assetImportWorkspace.draftItems.map(item => item.fileName) }; });
      const status = await page.locator('#status').innerText();
      results.push({ mode, before, after, status });
      assert.deepEqual(fs.readFileSync(configPath), originalConfig, 'import must remain a draft');
    } finally { await page.close(); await server.close(); server = undefined; }
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ output, results, errors }, null, 2));
  const missing = results.find(result => result.mode === 'missing-assets');
  assert.deepEqual(missing.after, missing.before, 'a newer pending resource share must supersede the old read even without a UI draft change');
  for (const result of results) {
    if (result.mode === 'unchanged') assert(JSON.stringify(result.after.ui).includes('旧文件A'));
    else assert.deepEqual(result.after, result.before, result.mode + ' must not be overwritten by the old read');
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.log(JSON.stringify({ output, errors, failure: String(error) }));
  throw error;
} finally { await browser?.close(); await server?.close(); }
