import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createStageFixture } from './support/stage-fixture.mjs';

// One bound project across the plugin evidence boundary. Without plugins its preview publishes a formal
// observation and keeps a resume position. Once its saved config declares a plugin, the same preview
// plays for local viewing only: no formal observation begins, the old one is no longer current, and the
// earlier resume position is neither reused nor kept, not even by the stage adjustment's replay after
// "应用到选定来源". Without the plugin again, formal publishing and that replay return.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliDist = (relative) => pathToFileURL(path.join(repoRoot, 'packages/cli/dist', relative)).href;
const { PreviewObservationService } = await import(cliDist('authoring/preview-observation-service.js'));
const { NodeProjectStorage } = await import(cliDist('authoring/node-project-storage.js'));

async function choosePort() {
  for (let port = 4621; port <= 4650; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('no free port for the plugin evidence test');
}

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-plugin-evidence-'));
const projectRoot = path.join(fixtureRoot, 'project');
const file = (relative) => path.join(projectRoot, ...relative.split('/'));
// The stage fixture supplies a stage.version 1 config with a pinned portrait for the stage adjustment.
const baseConfig = createStageFixture(projectRoot).config;
await fs.mkdir(file('plugins'), { recursive: true });
const pluginDeclaration = { id: 'marks', entry: 'plugins/marks.js', apiVersion: 1, instructions: [{ name: 'mark', blocking: false, parameters: [] }] };
const writeConfig = (config) => fs.writeFile(file('game.config.json'), `${JSON.stringify(config, null, 2)}\n`);
await writeConfig(baseConfig);
await fs.writeFile(file('plugins/marks.js'), 'export default () => ({ apiVersion: 1, instructions: { mark() {} } });\n');
await fs.writeFile(file('content/scenario/start.gal'), ['@scene start', '@stage dock', '@show rin:coat normal @pos=left @scale=1 @opacity=1',
  '凛：第一句。', '凛：第二句。', '凛：第三句。', '@end', ''].join('\n'));

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
  // The same observation read an agent gets, from the authority's own data.
  const observations = new PreviewObservationService(dataRoot);
  const rootIdentity = (await NodeProjectStorage.open(projectRoot)).rootIdentity;
  const readObservation = () => observations.read(rootIdentity);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  const refusedRequests = [];
  page.on('response', async (response) => { if (response.status() >= 400) refusedRequests.push(`${response.status()} ${new URL(response.url()).pathname} ${await response.text().catch(() => '')}`); });
  const published = [];
  page.on('request', (request) => {
    if (!request.url().includes('/workspace/preview') || request.method() !== 'POST') return;
    const action = JSON.parse(request.postData() ?? '{}').preview?.action;
    if (action) published.push(action);
  });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: projectRoot }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });

  const sourceState = () => page.locator('.preview-source-state').textContent();
  const checkpoints = () => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('surdet:preview:checkpoint:')));
  const shown = (text) => page.waitForFunction((text) => {
    const d = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug;
    return d?.interp?.status === 'awaiting-advance' && d.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText === text;
  }, text);
  const advance = async (text) => { await page.locator('iframe.preview-frame').focus(); await page.keyboard.press('Enter'); await shown(text); };
  const openProject = async () => {
    await page.locator('[data-editor-mode="editor"]').click().catch(() => {});
    await page.locator('[data-action="open-project"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('start'));
    await page.waitForFunction(() => document.body.innerText.includes('接力保护：已连接'));
  };
  const playFromEntry = async () => {
    await page.locator('[data-editor-mode="preview"]').click();
    await shown('第一句。');
  };
  const rinX = () => page.locator('iframe.preview-frame').evaluate((node) =>
    node.contentWindow.surdetPreviewDebug.runtime.queries.world.inspectStage().objects.find((object) => object.target === 'rin:coat')?.pose.x);
  const sceneText = () => page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text);
  /** The real stage adjustment buttons: pause and read, move 凛 to x 520, apply to the scene source. */
  const applyStageX = async () => {
    const details = page.locator('.stage-adjustment-workspace');
    if (!await details.evaluate((node) => node.open)) await details.locator('> summary').click();
    await page.getByRole('button', { name: '暂停并读取舞台', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelector('[aria-label="舞台对象列表"]')?.options ?? []].some((option) => option.value === 'portrait:rin:coat'));
    await page.getByLabel('舞台对象列表', { exact: true }).selectOption('portrait:rin:coat');
    const x = page.getByLabel('舞台横坐标', { exact: true });
    await x.fill('520'); await x.dispatchEvent('change');
    await page.getByRole('button', { name: '应用到选定来源', exact: true }).click();
    await page.waitForFunction(() => window.surdetEditorDebug.state.scenes.get('start').text.includes('@x=520'));
  };
  const undoStageX = async () => {
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(() => !window.surdetEditorDebug.state.scenes.get('start').text.includes('@x=520'));
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await openProject();

  // 1. No plugins: the run publishes a formal observation and keeps a resume position.
  await playFromEntry();
  await page.waitForFunction(() => document.querySelector('.preview-source-state')?.textContent === '已载入保存的内容；智能体可读取本次实际播放记录。');
  await advance('第二句。');
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith('surdet:preview:checkpoint:')));
  for (const deadline = Date.now() + 10_000; (await readObservation()).status !== 'current';) {
    if (Date.now() > deadline) throw new Error(`no current formal observation: ${JSON.stringify(await readObservation())}`);
    await page.waitForTimeout(100);
  }
  assert.ok(published.includes('begin') && published.includes('append'), `formal observation published: ${published}`);
  console.log('PASS without plugins the preview publishes a current formal observation and keeps a resume position');

  // Finish the run: once the observation has passed, no append of this run can arrive after the files change.
  await advance('第三句。');
  await page.keyboard.press('Enter');
  for (const deadline = Date.now() + 10_000; (await readObservation()).observation?.state !== 'passed';) {
    if (Date.now() > deadline) throw new Error(`the formal run did not finish: ${JSON.stringify((await readObservation()).observation?.state)}`);
    await page.waitForTimeout(100);
  }

  // 2. The saved config now declares a plugin: the same content plays for local viewing only.
  await writeConfig({ ...baseConfig, plugins: [pluginDeclaration] });
  const stale = await readObservation();
  assert.notEqual(stale.status, 'current', 'the earlier observation is no longer current once plugins are declared');
  assert.ok(stale.reasons.includes('PREVIEW_OBSERVATION_UNAVAILABLE'), `stale reasons: ${stale.reasons}`);
  await openProject();
  published.length = 0;
  await playFromEntry();
  await page.waitForFunction(() => /^插件试玩仅供本地查看：不生成正式观察记录，也不保留续接位置。/.test(document.querySelector('.preview-source-state')?.textContent ?? ''));
  assert.deepEqual(await checkpoints(), [], 'the resume position saved before the plugin was declared is not kept');
  await advance('第二句。');
  await advance('第三句。');
  assert.match(await page.locator('.preview-trace').innerText(), /显示台词/, 'the local causal record still works');
  assert.deepEqual(await checkpoints(), [], 'a plugin run keeps no resume position');
  await page.getByRole('button', { name: '回到上次位置' }).click();
  await page.waitForFunction(() => /^插件试玩仅供本地查看，不保留可续接的位置/.test(document.querySelector('.preview-source-state')?.textContent ?? ''));
  console.log('PASS with a plugin declared the preview plays locally and keeps no resume position');

  // 2b. The stage adjustment's apply does not replay a remembered position either.
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await shown('第一句。');
  await advance('第二句。');
  await page.locator('iframe.preview-frame').evaluate((node) => { node.contentWindow.__runBeforeApply = node.contentWindow.surdetPreviewDebug.interp; });
  await applyStageX();
  await page.waitForFunction(() => /^插件试玩仅供本地查看，不保留可续接的位置/.test(document.querySelector('.preview-source-state')?.textContent ?? '')
    || /试玩已回到保存的目标源点/.test(document.querySelector('.preview-diagnostics')?.textContent ?? ''));
  assert.doesNotMatch(await page.locator('.preview-diagnostics').textContent(), /试玩已回到保存的目标源点/, 'the stage apply did not replay to the earlier line');
  assert.match(await sourceState(), /^插件试玩仅供本地查看，不保留可续接的位置/);
  assert.equal(await page.locator('iframe.preview-frame').evaluate((node) => node.contentWindow.surdetPreviewDebug.interp === node.contentWindow.__runBeforeApply),
    true, 'no new run started from a remembered position');
  assert.equal(await page.locator('iframe.preview-frame').evaluate((node) => node.contentWindow.surdetPreviewDebug.runtime.controller.presentationPaused === true),
    false, 'the stage is not left paused');
  assert.deepEqual(await checkpoints(), [], 'the stage apply keeps no resume position');
  // The applied draft stays, plays from the entry as usual, and undoes as usual.
  await page.getByRole('button', { name: '重新播放', exact: true }).click();
  await shown('第一句。');
  assert.equal(await rinX(), 520, 'the replay from the entry shows the applied draft');
  assert.match(await sourceState(), /^插件试玩仅供本地查看：不生成正式观察记录，也不保留续接位置。/);
  await undoStageX();
  assert.doesNotMatch(await sceneText(), /@x=520/);
  assert.deepEqual(await checkpoints(), []);
  console.log('PASS with a plugin declared the stage apply keeps the draft but replays no remembered position; replay from the entry and undo still work');
  assert.deepEqual(published.filter((action) => action !== 'invalidate'), [], `no formal observation began or grew: ${published}`);
  const local = await readObservation();
  assert.notEqual(local.status, 'current', `no current formal observation for plugin content: ${JSON.stringify({ status: local.status, reasons: local.reasons })}`);
  console.log('PASS with a plugin declared nothing was published and the old observation is not current');

  // 3. Without the plugin again, the formal observation and the resume position return.
  await writeConfig(baseConfig);
  await openProject();
  published.length = 0;
  await playFromEntry();
  await page.waitForFunction(() => document.querySelector('.preview-source-state')?.textContent === '已载入保存的内容；智能体可读取本次实际播放记录。');
  await advance('第二句。');
  await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith('surdet:preview:checkpoint:')));
  for (const deadline = Date.now() + 10_000; (await readObservation()).status !== 'current';) {
    if (Date.now() > deadline) throw new Error(`no current formal observation again: ${JSON.stringify(await readObservation())}`);
    await page.waitForTimeout(100);
  }
  assert.ok(published.includes('begin'), `formal observation published again: ${published}`);
  console.log('PASS without the plugin the formal observation and the resume position return');

  // 3b. Control: without plugins the stage apply still replays to the line it was applied on.
  await applyStageX();
  await page.waitForFunction(() => /试玩已回到保存的目标源点/.test(document.querySelector('.preview-diagnostics')?.textContent ?? ''));
  await shown('第二句。');
  assert.equal(await rinX(), 520, 'the replay shows the applied draft at the same line');
  await undoStageX();
  console.log('PASS without plugins the stage apply replays to the same line');

  assert.deepEqual(errors, [], `page errors; refused requests: ${refusedRequests}`);
  console.log('PASS plugin evidence boundary');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
