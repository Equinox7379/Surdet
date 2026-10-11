import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
import { startDevProject } from '../scripts/dev-project.mjs';

// A bound project on disk. Every edit on the flow map goes through the shared scene.create /
// scene.patch operations, is previewed as a source diff, and lands in the scene history; after
// 保存全部 and reopening, the map, the scripts on disk and what an Agent reads are the same.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = path.join(repoRoot, 'packages/cli/dist/index.js');
const run = promisify(execFile);

async function choosePort() {
  for (let port = 4531; port <= 4560; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once('error', () => resolve(false));
      probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('no free port for the flow operations test');
}

const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-flow-operations-'));
const projectRoot = path.join(fixtureRoot, 'project');
const scenario = (id) => path.join(projectRoot, 'content', 'scenario', `${id}.gal`);
await fs.mkdir(path.dirname(scenario('intro')), { recursive: true });
await fs.writeFile(path.join(projectRoot, 'game.config.json'), `${JSON.stringify({
  title: 'Flow Operations', version: '0.1.0', entryScene: 'intro', characters: { lynn: { name: '凛' } },
}, null, 2)}\n`);
await fs.writeFile(scenario('intro'), '@scene intro\n凛：开场。\n@end\n');
await fs.writeFile(scenario('home'), '@scene home\n@label door\n凛：到家。\n@end\n');

const outDir = process.env.SURDET_FLOW_E2E_OUTPUT;
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

  const openProject = async () => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.locator('[data-action="open-project"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false && window.surdetEditorDebug.state.scenes.has('intro'));
    await page.locator('[data-editor-mode="flow"]').click();
    await page.locator('[data-editor-region="flow-workbench"]').waitFor();
    // The technical view keeps every real node, including labels, on the canvas.
    if (await page.locator('[data-editor-region="flow-legend"]').isHidden()) await page.locator('[data-flow-action="toggle-legend"]').click();
    await page.locator('.flow-technical > summary').click();
    await page.locator('[data-flow-action="toggle-technical-edges"]').click();
    await page.locator('[data-node-id="l:home.door"]').waitFor();
  };
  const text = (id) => page.evaluate((id) => window.surdetEditorDebug.state.scenes.get(id)?.text ?? null, id);
  const dialog = page.locator('dialog.flow-edit-dialog');
  const editNode = async (nodeId) => {
    await page.locator(`[data-node-id="${nodeId}"]`).focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: '编辑连接…' }).click();
    await dialog.waitFor();
  };
  const previewThenApply = async (expectedAdded, expectedRemoved = []) => {
    const preview = dialog.locator('.flow-edit-preview');
    await preview.waitFor();
    const added = await preview.locator('.flow-edit-line--added code').allTextContents();
    const removed = await preview.locator('.flow-edit-line--removed code').allTextContents();
    assert.deepEqual({ added, removed }, { added: expectedAdded, removed: expectedRemoved });
    const summary = await preview.locator('.flow-edit-summary').innerText();
    await dialog.getByRole('button', { name: '应用修改' }).click();
    await dialog.waitFor({ state: 'detached' });
    return summary;
  };
  const graphUpdated = (nodeId) => page.locator(`[data-node-id="${nodeId}"]`).waitFor();

  await openProject();
  // A. Drag intro onto home: the jump goes before the real @end, not after the end of the file.
  await page.locator('[data-flow-action="fit-canvas"]').click();
  const box = async (id) => page.locator(`[data-node-id="${id}"] .flow-node-surface`).boundingBox();
  const from = await box('s:intro'), to = await box('s:home');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await dialog.waitFor();
  assert.match(await previewThenApply(['@jump home']), /插在第 3 行的 @end 之前/);
  assert.equal(await text('intro'), '@scene intro\n凛：开场。\n@jump home\n@end\n');
  console.log('PASS drag connect: shared insertBefore before the real @end, after a source diff');

  // B. From the door label, create a new scene and connect to it.
  await editNode('l:home.door');
  await dialog.getByLabel('新场景标识').fill('river');
  await dialog.locator('.flow-edit-row', { has: page.getByLabel('新场景标识') }).getByRole('button', { name: '预览' }).click();
  await dialog.locator('.flow-edit-file', { hasText: 'content/scenario/river.gal（新文件）' }).waitFor();
  await previewThenApply(['@jump river', '@scene river', '@end']);
  assert.equal(await text('home'), '@scene home\n@label door\n凛：到家。\n@jump river\n@end\n');
  assert.equal(await text('river'), '@scene river\n@end\n');
  await graphUpdated('s:river');
  console.log('PASS create: scene.create made river, and home·door connects to it');

  // C. A branch from river: a typed choice group, before river's @end.
  await editNode('s:river');
  await dialog.getByLabel('选项 1 文字').fill('回家');
  await dialog.getByLabel('选项 1 去处').selectOption('s:home');
  await dialog.getByLabel('选项 2 文字').fill('再来');
  await dialog.getByLabel('选项 2 去处').selectOption('s:intro');
  await dialog.getByRole('button', { name: '预览分支' }).click();
  if (outDir) { await dialog.locator('.flow-edit-preview').waitFor(); await page.screenshot({ path: path.join(outDir, 'flow-operations-preview.png') }); }
  await previewThenApply(['@choice', '  回家 -> @jump home', '  再来 -> @jump intro']);
  assert.equal(await text('river'), '@scene river\n@choice\n  回家 -> @jump home\n  再来 -> @jump intro\n@end\n');
  console.log('PASS branch: a choice group with one target per option');

  // D. Retarget a jump and a choice option.
  await editNode('s:intro');
  await dialog.getByLabel('第 3 行的新去处').selectOption('l:home.door');
  await dialog.locator('.flow-edit-edge', { hasText: '第 3 行' }).getByRole('button', { name: '改目标' }).click();
  await previewThenApply(['@jump home.door'], ['@jump home']);
  await editNode('s:river');
  await dialog.getByLabel('第 4 行的新去处').selectOption('l:home.door');
  await dialog.locator('.flow-edit-edge', { hasText: '「再来」' }).getByRole('button', { name: '改目标' }).click();
  assert.match(await previewThenApply(['  再来 -> @jump home.door'], ['  再来 -> @jump intro']), /条件和效果保持不变/);
  console.log('PASS retarget: @jump by replaceInstruction, an option by replaceChoiceOption');

  // E. Delete an option and its connection; undo and redo it through the scene history.
  await editNode('s:river');
  await dialog.locator('.flow-edit-edge', { hasText: '「回家」' }).getByRole('button', { name: '删除' }).click();
  await previewThenApply([], ['  回家 -> @jump home']);
  const removed = '@scene river\n@choice\n  再来 -> @jump home.door\n@end\n';
  assert.equal(await text('river'), removed);
  await page.locator('[data-action="undo"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug.state.scenes.get('river').text.includes('回家'));
  await page.locator('[data-action="redo"]').click();
  await page.waitForFunction((text) => window.surdetEditorDebug.state.scenes.get('river').text === text, removed);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'flow-operations-edited.png') });
  console.log('PASS delete an option and its connection; undo and redo through the scene history');

  // F. Save, reopen: the map is rebuilt from the saved scripts.
  const expected = {
    intro: '@scene intro\n凛：开场。\n@jump home.door\n@end\n',
    home: '@scene home\n@label door\n凛：到家。\n@jump river\n@end\n',
    river: removed,
  };
  await page.locator('[data-action="save-project"]').click();
  for (const deadline = Date.now() + 30_000; ;) {
    const disk = Object.fromEntries(await Promise.all(Object.keys(expected).map(async (id) => [id, await fs.readFile(scenario(id), 'utf8').catch(() => null)])));
    if (JSON.stringify(disk) === JSON.stringify(expected)) break;
    if (Date.now() > deadline) throw new Error(`saved scripts differ: ${JSON.stringify(disk)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await openProject();
  for (const [id, value] of Object.entries(expected)) assert.equal(await text(id), value, `${id} after reopening`);
  await editNode('s:river');
  assert.match(await dialog.locator('.flow-edit-edges').innerText(), /「再来」 → home · door · 第 3 行/);
  if (outDir) await page.screenshot({ path: path.join(outDir, 'flow-operations-reopened.png') });
  await dialog.getByRole('button', { name: '关闭' }).click();
  console.log('PASS save and reopen: the map shows the saved connections');

  // G. An Agent reads the same scripts and finds the new route reachable.
  const agent = async (...args) => JSON.parse((await run(process.execPath, [cli, ...args, '--project', projectRoot, '--json'], { env: { ...process.env, SURDET_AGENT_DATA_DIR: dataRoot } })).stdout);
  for (const [id, value] of Object.entries(expected)) {
    const inspected = await agent('object', 'inspect', '--ref', `scene:${id}`);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.result.fingerprint, createHash('sha256').update(value).digest('hex'), `${id} as the Agent reads it`);
  }
  const input = path.join(fixtureRoot, 'path.json');
  await fs.writeFile(input, JSON.stringify({ sceneId: 'river', line: 3 }));
  const reached = await agent('project', 'preview-path', '--input', input);
  assert.equal(reached.result.status, 'reached', JSON.stringify(reached.result));
  assert.deepEqual(reached.result.target, { sceneId: 'river', requestedLine: 3, line: 2, index: 1, kind: 'choice-group' });
  console.log('PASS the Agent reads the same saved scripts and reaches river from the entry');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS flow operations');
} finally {
  await browser?.close();
  await server?.close();
  if (previousAgentDataRoot === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
  else process.env.SURDET_AGENT_DATA_DIR = previousAgentDataRoot;
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
