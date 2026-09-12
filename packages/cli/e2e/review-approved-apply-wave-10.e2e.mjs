import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { chromium } from 'playwright';
import { startDevProject } from '../../editor/scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from '../../editor/e2e/asset-import-authority.e2e.mjs';
import { HumanWorkspaceStore } from '../dist/authoring/human-workspace-store.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-wave10-browser-'));
const source = await fs.readFile(path.join(repo, 'packages/cli/test/helpers/review-apply-fixture.ts'), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const fixtureModule = path.join(root, 'fixture.mjs');
await fs.writeFile(fixtureModule, compiled.code
  .replaceAll('"@surdet/authoring"', JSON.stringify(pathToFileURL(path.join(repo, 'packages/authoring/dist/index.js')).href))
  .replace(/"\.\.\/\.\.\/src\/([^"\n]+)"/g, (_, relative) => JSON.stringify(pathToFileURL(path.join(repo, 'packages/cli/dist', relative)).href)));
const { createReviewApplyFixture } = await import(pathToFileURL(fixtureModule).href);
const fixture = await createReviewApplyFixture(root, false);
const priorDataRoot = process.env.SURDET_AGENT_DATA_DIR;
process.env.SURDET_AGENT_DATA_DIR = fixture.dataRoot;
let server, browser;
const errors = [];
try {
  // Asset staging and Authoring coordination intentionally use different roots.
  server = await startDevProject(['--project', fixture.projectRoot, '--data-root', path.join(root, 'asset-data'), '--port', '5186'],
    { registerSignals: false, cacheDir: path.join(root, 'vite-cache') });
  const reviewRoot = path.join(fixture.dataRoot, fixture.result.identity.projectIdentity, 'reviews', fixture.result.reviewId);
  const roots = { project: fixture.projectRoot, result: reviewRoot };
  const bridge = createNodeFsBridge(roots);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  await page.exposeFunction('__surdetNodeFs', bridge);
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto('http://127.0.0.1:5186', { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.locator('[data-relay-protection="connected"]').waitFor();
  await page.waitForFunction(() => !window.surdetEditorDebug.state.projectLoading);
  await page.evaluate(() => window.__surdetE2eSetPickerRoot('result'));
  await page.locator('[data-action="open-review"]').click();
  await page.locator('[data-review-main="result"]').waitFor();
  await page.locator('[data-action="approve-result"]').click();
  const apply = page.locator('.review-approved-apply');
  const write = page.locator('[data-action="write-approved-result"]');
  await write.waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-action="write-approved-result"]')?.disabled);
  const sourceFile = path.join(fixture.projectRoot, 'content/scenario/start.gal');
  assert.equal(await fs.readFile(sourceFile, 'utf8'), fixture.initial);

  // The bound source window reports its actual dirty state to the same backend.
  await page.locator('[data-editor-mode="editor"]').click();
  await page.locator('[data-script-view="source"]').click();
  const draft = `${await page.locator('.v4-source-editor').inputValue()}\n暂时保留的草稿。\n`;
  await page.locator('.v4-source-editor').fill(draft);
  await page.locator('[data-editor-mode="review"]').click();
  await page.locator('[data-action="inspect-approved-apply"]').click();
  await page.waitForFunction(() => document.querySelector('.review-approved-apply')?.textContent?.includes('未保存草稿'));
  assert.equal(await write.isDisabled(), true);
  assert.equal(await fs.readFile(sourceFile, 'utf8'), fixture.initial);
  await page.locator('[data-action="preview-result"]').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('请先保存当前草稿'));
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start')?.text), draft);
  // Explicit existing discard action restores the clean source before previewing.
  await page.locator('[data-action="discard-project-drafts"]').click();
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('项目已同步'));
  await page.locator('[data-action="preview-result"]').click();
  await page.waitForFunction(() => document.querySelector('#review-preview-host iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.rendererStatus === 'awaiting');
  const previewBox = await page.locator('#review-preview-host .preview-stage').boundingBox();
  assert(previewBox.width >= 900 && previewBox.height >= 500, 'desktop result preview must remain large and proportionate');
  await page.locator('[data-action="inspect-approved-apply"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="write-approved-result"]')?.disabled);
  await write.focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-action="sync-approved-project"]').waitFor();
  assert.notEqual(await fs.readFile(sourceFile, 'utf8'), fixture.initial);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-action')), 'sync-approved-project');
  assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.mainTab), 'review');
  await apply.screenshot({ path: path.join(root, 'written.png') });
  await page.setViewportSize({ width: 800, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(root, 'narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-action="sync-approved-project"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="continue-approved-project"]')?.disabled);
  await page.locator('[data-action="continue-approved-project"]').click();
  await page.locator('[data-script-view="source"]').click();
  const loaded = await page.locator('.v4-source-editor').inputValue();
  assert.equal(loaded, await fs.readFile(sourceFile, 'utf8'));
  const continued = `${loaded}\n继续编辑并保存的正文。\n`;
  await page.locator('.v4-source-editor').fill(continued);
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => !window.surdetEditorDebug.state.scenes.get('start')?.dirty);
  assert.equal(await fs.readFile(sourceFile, 'utf8'), continued);
  await page.screenshot({ path: path.join(root, 'continued.png') });
  await page.locator('[data-editor-mode="review"]').click();
  await page.locator('[data-action="inspect-approved-apply"]').click();
  await page.waitForFunction(() => document.querySelector('.review-approved-apply')?.textContent?.includes('项目之后还有新改动'));
  assert.equal(await page.locator('[data-action="write-approved-result"]').count(), 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.__surdetE2eSetPickerRoot('project'));
  await page.locator('[data-action="open-project"]').click();
  await page.locator('[data-relay-protection="connected"]').waitFor();
  await page.locator('[data-scene-key="start"] .scene-item').click();
  await page.locator('[data-script-view="source"]').click();
  assert.equal(await page.locator('.v4-source-editor').inputValue(), continued);
  // Reopen the review without a previously remembered source handle. A wrong
  // picker target is rejected; an explicit correct selection loads current disk.
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.__surdetE2eSetPickerRoot('result'));
  await page.locator('[data-action="open-review"]').click();
  await page.locator('[data-action="sync-approved-project"]').waitFor();
  assert.equal(await page.locator('[data-action="write-approved-result"]').count(), 0);
  await page.locator('[data-action="sync-approved-project"]').click();
  await page.waitForFunction(() => document.querySelector('.review-approved-apply')?.textContent?.includes('目录与导入服务绑定的项目不一致'));
  assert.equal(await fs.readFile(sourceFile, 'utf8'), continued);
  await page.evaluate(() => window.__surdetE2eSetPickerRoot('project'));
  await page.locator('[data-action="sync-approved-project"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action="continue-approved-project"]')?.disabled);
  await page.locator('[data-action="continue-approved-project"]').click();
  await page.locator('[data-scene-key="start"] .scene-item').click();
  await page.locator('[data-script-view="source"]').click();
  assert.equal(await page.locator('.v4-source-editor').inputValue(), continued);
  assert.deepEqual(errors, []);
  const workspace = await new HumanWorkspaceStore({ dataRoot: fixture.dataRoot }).inspect(await fs.realpath(fixture.projectRoot));
  assert.equal(workspace.summary.availability, 'clean');
  console.log(`PASS real approval -> draft protection -> preview -> write -> load -> edit/save -> reopen\nArtifacts: ${root}`);
} catch (error) {
  if (browser) {
    const page = browser.contexts().flatMap(context => context.pages())[0];
    if (page) { await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true });
      await fs.writeFile(path.join(root, 'failure.txt'), await page.locator('body').innerText()); }
  }
  console.error(`Browser failure artifacts: ${root}`);
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  if (priorDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = priorDataRoot;
}
