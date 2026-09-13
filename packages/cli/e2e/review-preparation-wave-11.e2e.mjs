import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { chromium } from 'playwright';
import { startDevProject } from '../../editor/scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from '../../editor/e2e/asset-import-authority.e2e.mjs';
import { NodeChangeStore } from '../dist/authoring/node-change-store.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-wave11-browser-'));
const source = await fs.readFile(path.join(repo, 'packages/cli/test/helpers/review-apply-fixture.ts'), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
const fixtureModule = path.join(root, 'fixture.mjs');
await fs.writeFile(fixtureModule, compiled.code
  .replaceAll('"@surdet/authoring"', JSON.stringify(pathToFileURL(path.join(repo, 'packages/authoring/dist/index.js')).href))
  .replace(/"\.\.\/\.\.\/src\/([^"\n]+)"/g, (_, relative) => JSON.stringify(pathToFileURL(path.join(repo, 'packages/cli/dist', relative)).href)));
const { createReviewComparisonFixture } = await import(pathToFileURL(fixtureModule).href);
const priorDataRoot = process.env.SURDET_AGENT_DATA_DIR;
const background = await fs.readFile(path.join(repo, 'examples/starter/content/assets/bg/harbor.png'));
let server, browser, page;
try {
  browser = await chromium.launch({ headless: true });
  for (const mode of ['whole', 'mixed']) {
    const entryScene = mode === 'whole' ? 'arrival' : 'opening';
    const fixture = await createReviewComparisonFixture(path.join(root, mode), entryScene, background, true);
    process.env.SURDET_AGENT_DATA_DIR = fixture.dataRoot;
    const sourceFile = path.join(fixture.projectRoot, 'content/scenario', `${entryScene}.gal`);
    const projectData = path.join(fixture.dataRoot, fixture.comparison.identity.projectIdentity);
    const comparisonRoot = path.join(projectData, 'reviews', fixture.comparison.reviewId);
    assert.deepEqual((await fs.readdir(projectData)).filter((name) => name === 'composition-plans'), []);
    assert.equal((await fs.readdir(path.join(projectData, 'reviews'))).length, 1);
    server = await startDevProject(['--project', fixture.projectRoot, '--data-root', path.join(root, mode, 'asset-data'), '--port', '5187'],
      { registerSignals: false, cacheDir: path.join(root, mode, 'vite-cache') });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: fixture.projectRoot, comparison: comparisonRoot }));
    await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
    await page.goto('http://127.0.0.1:5187', { waitUntil: 'networkidle' });
    await page.locator('[data-action="open-project"]').click();
    await page.locator('[data-relay-protection="connected"]').waitFor();
    await page.evaluate(() => window.__surdetE2eSetPickerRoot('comparison'));
    await page.locator('[data-action="open-review"]').click();
    await page.locator('[data-review-main="comparison"]').waitFor();
    const [a, b] = fixture.comparison.projection.candidates;
    let mixedScene;
    await page.locator(`[data-adopt-candidate="${a.candidateId}"]`).click();
    if (mode === 'mixed') {
      await page.locator('[data-action="custom-mix"]').click();
      await page.locator(`[data-mix-base="${a.candidateId}"]`).click();
      const addition = b.verifiedFacts.units.find((unit) => unit.outcomes.some((outcome) => outcome.objectRef.startsWith('scene:ending_')));
      assert(addition, 'mixed path needs a real independent contribution from B');
      mixedScene = addition.outcomes.find((outcome) => outcome.objectRef.startsWith('scene:ending_')).objectRef.slice('scene:'.length);
      await page.locator(`[data-mix-unit="${addition.unitId}"]`).check();
      await page.locator('[data-action="preview-decision"]').click();
    }
    await page.locator('[data-action="save-decision"]').click();
    await page.locator('[data-action="prepare-review-result"]').waitFor();
    assert.equal(await fs.readFile(sourceFile, 'utf8'), fixture.initial);
    assert.equal((await fs.readdir(path.join(projectData, 'reviews'))).length, 1);
    await page.locator('.review-preparation').screenshot({ path: path.join(root, `${mode}-saved.png`) });
    let draft;
    if (mode === 'mixed') {
      await page.locator('[data-editor-mode="editor"]').click();
      await page.locator('[data-script-view="source"]').click();
      draft = `${await page.locator('.v4-source-editor').inputValue()}\n保留到准备结果之后的草稿。\n`;
      await page.locator('.v4-source-editor').fill(draft);
      await page.locator('[data-editor-mode="review"]').click();
    } else {
      await fs.appendFile(sourceFile, '\n外部来源变化。\n');
      await page.locator('[data-action="prepare-review-result"]').click();
      await page.locator('.review-preparation[data-preparation-error="REVIEW_DECISION_STALE"]').waitFor();
      assert.equal(await fs.stat(path.join(comparisonRoot, 'preparation.json')).then(() => true, () => false), false);
      await page.locator('.review-preparation').screenshot({ path: path.join(root, 'source-changed.png') });
      await fs.writeFile(sourceFile, fixture.initial);
    }
    let dropped = false;
    if (mode === 'whole') {
      await page.route('**/review-authority/v1/prepare-result', async (route) => {
        const request = route.request().postDataJSON();
        const response = await route.fetch();
        if (!dropped && request.action === 'prepare-result' && (await response.json()).result?.stage === 'run') {
          dropped = true; await route.abort('connectionfailed');
        } else await route.fulfill({ response });
      });
    }
    await page.locator('[data-action="prepare-review-result"]').click();
    if (mode === 'whole') {
      await page.locator('.review-preparation[data-preparation-error="REVIEW_PREPARATION_UNKNOWN"]').waitFor();
      const checkpoint = JSON.parse(await fs.readFile(path.join(comparisonRoot, 'preparation.json'), 'utf8'));
      assert.equal(checkpoint.completed, 5);
      const beforeRestart = await NodeChangeStore.openForProject(checkpoint.changeId, fixture.projectRoot, { dataRoot: fixture.dataRoot });
      const simulationId = beforeRestart.record.latestSimulation.evidenceId;
      const simulation = await beforeRestart.store.readEvidence(checkpoint.changeId, simulationId);
      assert.equal(simulation.result.paths[0].termination, 'pruned');
      assert.deepEqual(simulation.result.paths.find(p => p.termination === 'ended').choices, [1, 1]);
      await page.unroute('**/review-authority/v1/prepare-result');
      await server.close();
      server = await startDevProject(['--project', fixture.projectRoot, '--data-root', path.join(root, mode, 'asset-data'), '--port', '5187'],
        { registerSignals: false, cacheDir: path.join(root, mode, 'vite-cache') });
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-action="prepare-review-result"]').waitFor();
      await page.locator('[data-action="prepare-review-result"]').click();
      await page.locator('[data-review-main="result"]').waitFor({ timeout: 60000 });
      const resumed = JSON.parse(await fs.readFile(path.join(comparisonRoot, 'preparation.json'), 'utf8'));
      assert.equal(resumed.plan.planId, checkpoint.plan.planId);
      assert.equal(resumed.changeId, checkpoint.changeId);
      assert.equal(resumed.resultReviewId, checkpoint.resultReviewId);
      const afterRestart = await NodeChangeStore.openForProject(resumed.changeId, fixture.projectRoot, { dataRoot: fixture.dataRoot });
      assert.equal(afterRestart.record.latestSimulation.evidenceId, simulationId);
    } else await page.locator('[data-review-main="result"]').waitFor({ timeout: 60000 });
    assert.equal(await fs.readFile(sourceFile, 'utf8'), fixture.initial);
    const progress = JSON.parse(await fs.readFile(path.join(comparisonRoot, 'preparation.json'), 'utf8'));
    const resultRoot = path.join(projectData, 'reviews', progress.resultReviewId);
    assert.deepEqual(await fs.readFile(path.join(resultRoot, 'result/project/content/assets/bg/harbor.png')), background);
    assert.equal(await fs.stat(path.join(resultRoot, 'final-approval.json')).then(() => true, () => false), false);
    if (mode === 'mixed') {
      assert.equal(await page.evaluate((scene) => window.surdetEditorDebug.state.scenes.get(scene)?.text, entryScene), draft);
      await page.locator('[data-action="preview-result"]').click();
      await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('请先保存当前草稿'));
      assert.equal(await page.evaluate((scene) => window.surdetEditorDebug.state.scenes.get(scene)?.text, entryScene), draft);
      await page.locator('[data-action="discard-project-drafts"]').click();
      await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('项目已同步'));
    }
    await page.locator('[data-action="preview-result"]').click();
    await page.waitForFunction(() => document.querySelector('#review-preview-host iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.rendererStatus === 'awaiting');
    assert.equal((await page.locator('#status').innerText()).includes('自动备份未启用'), false);
    const previewFrame = await (await page.locator('#review-preview-host iframe.preview-frame').elementHandle()).contentFrame();
    await previewFrame.locator('canvas').click({ position: { x: 40, y: 40 } });
    await previewFrame.waitForFunction(() => window.surdetPreviewDebug?.rendererStatus === 'choice');
    await page.screenshot({ path: path.join(root, `${mode}-choices.png`), fullPage: true });
    await page.keyboard.press('2');
    await previewFrame.waitForFunction(() => window.surdetPreviewDebug?.rendererStatus === 'choice'
      && window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.choiceLabels.includes('返回路口'));
    await page.keyboard.press('2');
    await previewFrame.waitForFunction(() => window.surdetPreviewDebug?.rendererStatus === 'awaiting'
      && window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText === '我们走到了故事的出口。');
    await page.screenshot({ path: path.join(root, `${mode}-preview.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await previewFrame.waitForFunction(() => window.surdetPreviewDebug?.interp?.status === 'ended');
    await page.locator('[data-action="approve-result"]').click();
    await page.locator('[data-action="write-approved-result"]').click();
    await page.locator('[data-action="sync-approved-project"]').waitFor();
    await page.screenshot({ path: path.join(root, `${mode}-written.png`), fullPage: true });
    await page.evaluate(() => window.__surdetE2eSetPickerRoot('project'));
    await page.locator('[data-action="sync-approved-project"]').click();
    await page.locator('[data-action="continue-approved-project"]').click();
    await page.locator('[data-script-view="source"]').click();
    const current = await page.locator('.v4-source-editor').inputValue();
    assert.equal(current, await fs.readFile(sourceFile, 'utf8'));
    await page.locator('.v4-source-editor').fill(`${current}\n继续写作。\n`);
    await page.locator('[data-action="save-project"]').click();
    await page.waitForFunction((scene) => !window.surdetEditorDebug.state.scenes.get(scene)?.dirty, entryScene);
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.__surdetE2eSetPickerRoot('project'));
    await page.locator('[data-action="open-project"]').click();
    await page.locator('[data-relay-protection="connected"]').waitFor();
    await page.locator(`[data-scene-key="${entryScene}"] .scene-item`).click();
    await page.locator('[data-script-view="source"]').click();
    assert.equal(await page.locator('.v4-source-editor').inputValue(), `${current}\n继续写作。\n`);
    assert.equal((await fs.readdir(path.join(projectData, 'composition-plans'))).length, 1);
    assert.equal((await fs.readdir(path.join(projectData, 'reviews'))).length, 2);
    if (mode === 'mixed') assert.equal(await fs.stat(path.join(fixture.projectRoot, `content/scenario/${mixedScene}.gal`)).then(() => true, () => false), true);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: saved decision -> prepare -> automatic result -> two real choices -> ending -> approve -> write -> load -> edit/save/reopen`);
    await context.close(); await server.close(); server = undefined;
  }
  console.log(`Artifacts: ${root}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(root, 'failure.png'), fullPage: true });
    await fs.writeFile(path.join(root, 'failure.txt'), await page.locator('body').innerText());
  }
  console.error(`Artifacts: ${root}`); throw error;
} finally {
  if (browser) await browser.close(); if (server) await server.close();
  if (priorDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR; else process.env.SURDET_AGENT_DATA_DIR = priorDataRoot;
}
