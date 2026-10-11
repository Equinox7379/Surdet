import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

// A bound project, so "试玩内容" can select the saved project. A found start depends on the
// editor line it was picked from and on the selected version it was found in: an edit while the
// query waits, a new saved version read for the start, or an edit after the start makes it old.
const intro = ['@scene intro', '@set trust = 1', '凛：目标。', '凛：之后。', '@end', ''].join('\n');

async function choosePort() {
  for (let port = 4501; port <= 4530; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('no free port for the bound from-line test');
}

/** Requests held while `hold` is armed, each until the test releases that hold; routing also bypasses the HTTP cache. */
function gate() {
  const value = { held: 0, armed: null };
  value.hold = () => { let open; const opened = new Promise((resolve) => { open = resolve; }); value.held = 0; value.armed = { opened, open }; };
  value.release = () => { value.armed?.open(); value.armed = null; };
  return value;
}

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-from-line-bound-'));
const projectRoot = path.join(fixtureRoot, 'project');
await fs.mkdir(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
await fs.writeFile(path.join(projectRoot, 'game.config.json'), `${JSON.stringify({
  title: 'From Line Bound', version: '0.1.0', entryScene: 'intro',
  characters: { lynn: { name: '凛' } }, variables: { trust: { type: 'number', initial: 0 } },
}, null, 2)}\n`);
await fs.writeFile(path.join(projectRoot, 'content', 'scenario', 'intro.gal'), intro);

const outDir = process.env.SURDET_FROM_LINE_E2E_OUTPUT;
const errors = [];
const previousAgentDataRoot = process.env.SURDET_AGENT_DATA_DIR;
let server = null, browser = null;
try {
  const dataRoot = path.join(fixtureRoot, 'agent-data');
  process.env.SURDET_AGENT_DATA_DIR = dataRoot;
  const port = await choosePort();
  server = await startDevProject(['--project', projectRoot, '--data-root', dataRoot, '--port', String(port)],
    { registerSignals: false, cacheDir: path.join(fixtureRoot, 'vite-cache') });
  const url = `http://127.0.0.1:${port}/index.html`;
  for (const deadline = Date.now() + 30_000; ;) {
    if (await fetch(url).then((response) => response.ok, () => false)) break;
    if (Date.now() > deadline) throw new Error('dev project did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: projectRoot }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  // Every preview start posts one trace start; a refused start posts none.
  await page.addInitScript(() => {
    window.__previewStarts = 0;
    addEventListener('message', (event) => { if (event.data?.type === 'surdet-preview-trace-start') window.__previewStarts += 1; });
  });
  const worker = gate(), content = gate();
  const held = (hold) => async (route) => { const armed = hold.armed; if (armed) { hold.held += 1; await armed.opened; } await route.continue(); };
  await page.route(/preview-path-worker/, held(worker));
  await page.route(/\/workspace\/preview-content/, held(content));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('intro'));
  const row = (line) => page.locator(`.v4-authoring .block[data-line="${line}"]`);
  await row(2).waitFor();
  const status = page.locator('.preview-target-status');
  const waitStatus = async (text) => {
    try { await status.filter({ hasText: text }).waitFor(); }
    catch {
      const read = async (selector) => page.locator(selector).first().innerText().catch(() => '');
      throw new Error(`target status never showed “${text}”: ${await read('.preview-target-status')} | ${await read('.preview-source-state')} | ${await read('.preview-diagnostics')}`);
    }
  };
  const select = async (line) => {
    await row(line).evaluate((node) => node.focus());
    await page.waitForFunction((line) => document.querySelector(`.v4-authoring .block[data-line="${line}"]`)?.classList.contains('v4-current'), line);
  };
  const starts = () => page.evaluate(() => window.__previewStarts);
  const sourceState = () => page.locator('[data-preview-source-state]').evaluate((node) => ({ state: node.dataset.previewSourceState, text: node.textContent }));
  const until = async (read, why) => { for (const deadline = Date.now() + 30_000; !(await read());) { if (Date.now() > deadline) throw new Error(why); await new Promise((resolve) => setTimeout(resolve, 50)); } };
  const duplicateSetStep = async () => {
    await select(1);
    await row(1).locator('.v4-row-menu > summary').click();
    await page.getByRole('button', { name: '复制剧情步骤，第 2 行' }).click();
    await page.waitForFunction(() => window.surdetEditorDebug.state.scenes.get('intro').text.split('\n')[2] === '@set trust = 1');
  };
  const removeDuplicate = async () => {
    await select(2);
    await row(2).locator('.v4-row-menu > summary').click();
    await page.getByRole('button', { name: '删除剧情步骤，第 3 行' }).click();
    await page.waitForFunction((text) => window.surdetEditorDebug.state.scenes.get('intro').text === text, intro);
  };

  // Start from line 3 on the editor content, then select the saved project as the content to play.
  await select(2);
  await page.locator('[data-action="preview-from-line"]').click();
  await waitStatus('已停在 intro 第 3 行之前');
  await page.locator('.preview-workspace').getByLabel('试玩内容').selectOption({ label: '来源项目（已保存）' });
  await page.waitForFunction(() => /来源项目（已保存）/.test(document.querySelector('.preview-source-state')?.textContent ?? '')
    && document.querySelector('[data-preview-source-state]')?.dataset.previewSourceState === 'fresh');
  await waitStatus('已改为正常播放');
  console.log('PASS the saved project is the content to play; the earlier start is replaced by normal play');

  // 1. The query waits; a line is inserted above the target; the old result must not start.
  worker.hold();
  const beforeQuery = await starts();
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await until(() => worker.held > 0, 'the query worker was not requested');
  await duplicateSetStep();
  worker.release();
  await waitStatus('查找期间剧本已修改，结果属于旧版本');
  await page.waitForTimeout(1000);
  assert.equal(await starts(), beforeQuery, 'the old line did not start a run');
  assert.match((await sourceState()).text, /来源项目（已保存）/, 'the normal saved-project run is still what plays');
  console.log('PASS selected saved project: inserting a line while the query waits refuses the old start');

  // 2. While the query waits, the line is inserted and saved, then removed again in the editor:
  // the editor text is what the query saw, but the saved version read for the start is new.
  await removeDuplicate();
  worker.hold();
  const beforeStart = await starts();
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await until(() => worker.held > 0, 'the second query worker was not requested');
  await duplicateSetStep();
  await page.locator('[data-action="save-project"]').click();
  await until(async () => (await fs.readFile(path.join(projectRoot, 'content', 'scenario', 'intro.gal'), 'utf8')).split('\n')[2] === '@set trust = 1', 'the inserted line was not saved');
  await removeDuplicate();
  worker.release();
  await waitStatus('剧本或所选内容已更新，这次起点属于旧版本');
  await page.waitForTimeout(1000);
  assert.equal(await starts(), beforeStart, 'a start found on the previous saved version did not run');
  assert.deepEqual(await sourceState(), { state: 'stale', text: '剧本或所选内容已更新，找到的起点属于旧版本，本次未启动。' });
  console.log('PASS a new saved version read for the start refuses a path found on the previous one');

  // Save the editor text back and replay, so the panel holds the saved version that matches it.
  await page.locator('[data-action="save-project"]').click();
  await until(async () => (await fs.readFile(path.join(projectRoot, 'content', 'scenario', 'intro.gal'), 'utf8')) === intro, 'the editor text was not saved back');
  const beforeReplay = await starts();
  await page.locator('.preview-workspace').getByRole('button', { name: '重新播放' }).click();
  await page.waitForFunction(() => /来源项目（已保存）/.test(document.querySelector('.preview-source-state')?.textContent ?? '')
    && document.querySelector('[data-preview-source-state]')?.dataset.previewSourceState === 'fresh');
  await until(async () => (await starts()) > beforeReplay, 'the replay did not start');

  // 3. A fresh query on the current version starts; an edit after the start marks it old.
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await waitStatus('已停在 intro 第 3 行之前');
  assert.match((await sourceState()).text, /来源项目（已保存）/);
  const continueButton = page.locator('.preview-debugger').getByRole('button', { name: '继续运行' });
  assert.equal(await continueButton.isDisabled(), false);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'from-line-saved-reached.png') });
  await duplicateSetStep();
  await waitStatus('剧本已修改，这次起点属于旧版本');
  assert.equal(await continueButton.isDisabled(), true, 'the old start can no longer be continued from this panel');
  console.log('PASS selected saved project: a start reached, then an edit marks it old and disables its controls');

  // 4. Last, because it leaves the binding waiting on the outside update: an external change on
  // disk during the start's read is refused by the binding itself, and the start reports it.
  await removeDuplicate();
  content.hold();
  const beforeExternal = await starts();
  await page.locator('.preview-target').getByRole('button', { name: '查找并试玩' }).click();
  await until(() => content.held > 0, 'the start did not read the selected version');
  await fs.writeFile(path.join(projectRoot, 'content', 'scenario', 'extra.gal'), '@scene extra\n凛：新加的场景。\n@end\n');
  content.release();
  await waitStatus('所选内容未能重新读取，这次起点没有开始');
  await page.waitForTimeout(1000);
  assert.equal(await starts(), beforeExternal, 'nothing started on a version changed outside the Editor');
  // The browser logs the binding's refusal (HTTP 409) of that read; it is the expected outcome here.
  const conflicts = errors.filter((message) => message.includes('status of 409 (Conflict)'));
  assert(conflicts.length >= 1, 'the binding refused the read');
  errors.splice(0, errors.length, ...errors.filter((message) => !conflicts.includes(message)));
  console.log('PASS an external change during the start read is refused by the binding; the start reports it');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS bound from-line preview');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
