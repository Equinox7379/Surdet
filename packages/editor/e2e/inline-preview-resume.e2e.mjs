import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

// A bound project (real dev server and project identity) is needed for "回到上次位置".
// The player chooses an option whose label has a colour tag and an interpolated value
// containing `<b>`; continuing from the saved position replays that choice by its index.
const source = [
  '@scene start',
  '凛：你说什么？<w=400>……<color=accent>再说一遍</color>。',
  '沈岳：我在读《红楼梦》，<ruby=せかい>世界</ruby>很大。',
  '@choice',
  '  <color=accent>{hero}</color>先走 -> @goto after',
  '  留下 -> @goto stay',
  '@label after',
  '凛：到了。',
  '@end',
  '@label stay',
  '凛：留下了。',
  '@end',
  '',
].join('\n');

async function choosePort() {
  for (let port = 4471; port <= 4500; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('no free port for the inline preview resume test');
}

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-inline-preview-'));
const projectRoot = path.join(fixtureRoot, 'project');
await fs.mkdir(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
await fs.writeFile(path.join(projectRoot, 'game.config.json'), `${JSON.stringify({
  title: 'Inline Preview Resume', version: '0.1.0', entryScene: 'start',
  characters: { lynn: { name: '凛' }, shen: { name: '沈岳' } },
  variables: { hero: { type: 'string', initial: '<b>凛' } },
}, null, 2)}\n`);
await fs.writeFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), source);

const outDir = process.env.SURDET_INLINE_E2E_OUTPUT;
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: projectRoot }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('start'));

  await page.locator('[data-editor-mode="preview"]').click();
  // The preview iframe can be rebuilt by the panel, so every query looks it up again.
  const debug = (read) => page.evaluate(`(() => { const debug = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return debug?.interp && debug?.runtime ? (${read})(debug) : null; })()`);
  const waitDebug = (read, arg) => page.waitForFunction(`(() => { const debug = document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug; return Boolean(debug?.interp && debug?.runtime && (${read})(debug, ${JSON.stringify(arg ?? null)})); })()`);
  // Keys go to the focused iframe; otherwise Enter would press the panel button that has focus.
  const pressInPreview = async (key) => { await page.locator('iframe.preview-frame').focus(); await page.keyboard.press(key); };
  const dialogue = '(d) => d.runtime.queries.diagnostics.projectionSnapshot().dialogue';
  await waitDebug(`(d) => (${dialogue})(d)?.dialogText.includes('你说什么？')`);
  for (let step = 0; step < 12 && (await debug('(d) => d.interp.status')) !== 'awaiting-choice'; step++) {
    const before = await debug(`(d) => JSON.stringify((${dialogue})(d))`);
    await pressInPreview('Enter');
    await waitDebug(`(d, previous) => d.interp.status === 'awaiting-choice' || JSON.stringify((${dialogue})(d)) !== previous`, before);
  }
  assert.equal(await debug('(d) => d.interp.status'), 'awaiting-choice');
  // Core styles the option and escapes the interpolated value, so `<b>` from the variable stays visible text.
  assert.deepEqual(await debug(`(d) => (${dialogue})(d).choiceLabels`), ['<b>凛先走', '留下']);
  if (outDir) await page.screenshot({ path: path.join(outDir, '05-preview-styled-option.png') });
  await pressInPreview('1');
  await waitDebug(`(d) => (${dialogue})(d)?.dialogText === '到了。'`);
  console.log('PASS styled, interpolated option shown by Core and chosen in the real preview');

  await page.getByRole('button', { name: '回到上次位置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.preview-diagnostics')?.textContent.includes('试玩已回到保存的目标源点')).catch(async (error) => {
    throw new Error(`${error.message}\n${await page.locator('.preview-diagnostics').innerText()}\n${await page.locator('.preview-source-state').innerText()}`);
  });
  await waitDebug(`(d) => (${dialogue})(d)?.dialogText === '到了。' && d.interp.status === 'awaiting-advance'`);
  if (outDir) await page.screenshot({ path: path.join(outDir, '06-preview-resumed.png') });
  console.log('PASS back to last position replays the styled option by index and stops at 到了。');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS inline preview resume');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
