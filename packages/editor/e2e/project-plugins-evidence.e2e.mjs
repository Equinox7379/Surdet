import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

// One bound project across the plugin evidence boundary. Without plugins its preview publishes a formal
// observation and keeps a resume position. Once its saved config declares a plugin, the same preview
// plays for local viewing only: no formal observation begins, the old one is no longer current, and the
// earlier resume position is neither reused nor kept. Without the plugin again, formal publishing returns.

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
for (const dir of ['content/scenario', 'plugins']) await fs.mkdir(file(dir), { recursive: true });
const baseConfig = { title: 'Plugin Evidence', version: '0.1.0', entryScene: 'intro', characters: { lynn: { name: '凛' } } };
const pluginDeclaration = { id: 'marks', entry: 'plugins/marks.js', apiVersion: 1, instructions: [{ name: 'mark', blocking: false, parameters: [] }] };
const writeConfig = (config) => fs.writeFile(file('game.config.json'), `${JSON.stringify(config, null, 2)}\n`);
await writeConfig(baseConfig);
await fs.writeFile(file('plugins/marks.js'), 'export default () => ({ apiVersion: 1, instructions: { mark() {} } });\n');
await fs.writeFile(file('content/scenario/intro.gal'), ['@scene intro', '凛：第一句。', '凛：第二句。', '凛：第三句。', '@end', ''].join('\n'));

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
  /** Trace appends go out one after another; wait until the queue is quiet before the files change. */
  const publishingSettled = async () => {
    for (let count = -1; count !== published.length;) { count = published.length; await page.waitForTimeout(800); }
  };
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
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('intro'));
    await page.waitForFunction(() => document.body.innerText.includes('接力保护：已连接'));
  };
  const playFromEntry = async () => {
    await page.locator('[data-editor-mode="preview"]').click();
    await shown('第一句。');
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

  // 2. The saved config now declares a plugin: the same content plays for local viewing only.
  await publishingSettled();
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
  assert.deepEqual(published.filter((action) => action !== 'invalidate'), [], `no formal observation began or grew: ${published}`);
  const local = await readObservation();
  assert.notEqual(local.status, 'current', `no current formal observation for plugin content: ${JSON.stringify({ status: local.status, reasons: local.reasons })}`);
  console.log('PASS with a plugin declared the preview plays locally, publishes nothing, keeps no resume position, and the old observation is not current');

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

  assert.deepEqual(errors, [], `page errors; refused requests: ${refusedRequests}`);
  console.log('PASS plugin evidence boundary');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
