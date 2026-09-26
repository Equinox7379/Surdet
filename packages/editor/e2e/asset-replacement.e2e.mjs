import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { createStageFixture } from './support/stage-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.resolve(process.argv[2] ?? path.join(repo, '../replacement-browser-' + Date.now()));
fs.mkdirSync(output, { recursive: true });
const fixture = createStageFixture(path.join(output, 'project'));
const target = path.join(fixture.root, 'content/assets/bg/dock.png');
const before = fs.readFileSync(target), after = fs.readFileSync(path.join(fixture.root, 'content/assets/bg/night.png'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const evidence = { status: 'running', checks: [], console: [], pageErrors: [], responses: [] };
let browser, server, page;
const pass = (name, detail = {}) => { evidence.checks.push({ name, ...detail }); console.log('PASS ' + name); };
try {
  server = await startDevProject(['--project', fixture.root, '--data-root', path.join(output, 'authority'), '--port', '4438'], { registerSignals: false, cacheDir: path.join(output, 'vite-cache') });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.console.push(message.text()); });
  page.on('response', async response => { if (response.status() >= 400) evidence.responses.push({ status: response.status(), url: new URL(response.url()).pathname, error: (await response.json().catch(() => null))?.error }); });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: fixture.root }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto('http://127.0.0.1:4438/index.html', { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.assetImportWorkspace?.entryState === 'ready' && !window.surdetEditorDebug.state.projectLoading);
  await page.locator('[data-editor-mode="assets"]').click();
  await page.locator('[data-asset-id="file:content/assets/bg/dock.png"]').click();
  const selectReplacement = async bytes => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '替换文件内容', exact: true }).click();
    await (await chooser).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: bytes });
  };
  await selectReplacement(after);
  await page.getByRole('button', { name: '确认替换文件内容', exact: true }).waitFor();
  assert.deepEqual(fs.readFileSync(target), before);
  const plan = await page.locator('.asset-relocation').innerText();
  assert(plan.includes(digest(before)) && plan.includes(digest(after)));
  pass('bound-browser-upload-prepares-exact-before-and-after-digests-without-publishing');
  await page.screenshot({ path: path.join(output, 'replacement-plan.png'), fullPage: true });
  await page.getByRole('button', { name: '确认替换文件内容', exact: true }).click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.projectWriteLock === null && document.querySelector('[data-relocation-status="COMMITTED"]'));
  assert.deepEqual(fs.readFileSync(target), after);
  assert.equal(fs.readFileSync(path.join(fixture.root, 'content/scenario/start.gal'), 'utf8'), fixture.source);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, 'game.config.json'))).stage.compositions.dock.background, 'dock');
  pass('browser-commit-replaces-bytes-at-same-key-and-keeps-actual-references');
  await page.locator('[data-editor-mode="preview"]').click();
  const preview = page.frames().find(frame => /preview\.html/.test(frame.url())); assert(preview);
  await preview.waitForFunction(() => window.surdetPreviewDebug?.interp?.status === 'awaiting-advance');
  const pixel = await preview.evaluate(async () => {
    const data = window.surdetPreviewDebug.runtime.queries.world.captureThumbnail();
    if (!data) throw new Error('No real frame capture');
    const bitmap = await createImageBitmap(await (await fetch(data)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); const rgba = Array.from(ctx.getImageData(Math.floor(bitmap.width*.5),Math.floor(bitmap.height*.2),1,1).data); bitmap.close(); return rgba;
  });
  assert(pixel[0] < 70 && pixel[2] < 110, `real rendered background still uses previous bytes: ${pixel}`);
  pass('same-key-reload-renders-replacement-pixels', { pixel });
  await page.locator('[data-editor-mode="assets"]').click();
  await page.getByRole('button', { name: '撤销本次整理', exact: true }).click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.projectWriteLock === null && document.querySelector('[data-relocation-status="UNDONE"]'));
  assert.deepEqual(fs.readFileSync(target), before); pass('browser-undo-restores-verified-original-bytes');
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await selectReplacement(before);
  await page.getByRole('button', { name: '确认无变化', exact: true }).click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.projectWriteLock === null && document.querySelector('[data-relocation-status="COMMITTED"]'));
  assert.deepEqual(fs.readFileSync(target), before); pass('identical-byte-replacement-is-no-change');
  assert.equal(evidence.pageErrors.length,0,JSON.stringify(evidence.pageErrors));
  assert.equal(evidence.responses.length,0,JSON.stringify(evidence.responses));
  evidence.status='passed';
} catch(error) {
  evidence.status='failed'; evidence.failure=error?.stack??String(error); process.exitCode=1;
  if(page){ evidence.visibleText=await page.locator('body').innerText().catch(()=> 'unavailable'); await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{}); }
} finally {
  await browser?.close(); await server?.close(); fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({status:evidence.status,checks:evidence.checks.length,failure:evidence.failure,pageErrors:evidence.pageErrors,output},null,2));
}
