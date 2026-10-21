import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';

const output = process.env.SURDET_AUDIT_OUTPUT ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-config-history-'));
const project = path.join(output, 'project');
const configPath = path.join(project, 'game.config.json');
let server, browser, page;
const errors = [];
try {
  await fs.mkdir(path.join(project, 'content/scenario'), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ title: 'Saved config history', entryScene: 'start',
    characters: { rin: { name: '凛' } }, variables: { trust: { type: 'number', initial: 0 } }, privateField: { retain: true } }));
  await fs.writeFile(path.join(project, 'content/scenario/start.gal'), '@scene start\n正文。\n@end\n');
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = await startDevProject(['--project', project, '--data-root', path.join(output, 'authority'), '--port', String(port)],
    { registerSignals: false, cacheDir: path.join(output, 'vite') });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false
    && window.surdetEditorDebug.state.assetImportWorkspace?.entryState === 'ready'
    && !document.querySelector('[data-action="save-project"]').disabled);
  await page.locator('[data-editor-mode="config"]').click();
  const section = async name => page.locator(`[data-config-section-target="${name}"]`).click();
  const save = async label => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => !window.surdetEditorDebug.state.projectWriteLocked);
  };
  const disk = async () => JSON.parse(await fs.readFile(configPath, 'utf8'));

  await section('characters');
  await page.getByLabel('新角色标识', { exact: true }).fill('new_char');
  await page.getByLabel('新角色显示名称', { exact: true }).fill('新角色');
  await page.getByRole('button', { name: '添加角色', exact: true }).click();
  await save('保存角色表');
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('角色表已保存'));
  assert.equal((await disk()).characters.new_char.name, '新角色');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.getByLabel('new_char 的显示名称', { exact: true }).inputValue(), '新角色');
  await section('variables');
  await page.getByLabel('初始值，第 1 行', { exact: true }).fill('7');
  await save('保存变量表');
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('变量表已保存'));
  assert.equal((await disk()).characters.new_char.name, '新角色');
  assert.equal((await disk()).variables.trust.initial, 7);

  await section('characters');
  await page.getByLabel('rin 的显示名称', { exact: true }).fill('新名字');
  await save('保存角色表');
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('角色表已保存'));
  assert.equal((await disk()).characters.rin.name, '新名字');
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.getByLabel('rin 的显示名称', { exact: true }).inputValue(), '凛');
  await section('variables');
  await page.getByLabel('初始值，第 1 行', { exact: true }).fill('8');
  await save('保存变量表');
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('变量表已保存'));
  const saved = await disk();
  assert.equal(saved.characters.rin.name, '新名字');
  assert.equal(saved.characters.new_char.name, '新角色');
  assert.equal(saved.variables.trust.initial, 8);
  assert.deepEqual(saved.privateField, { retain: true });
  await section('characters');
  assert.equal(await page.getByLabel('rin 的显示名称', { exact: true }).inputValue(), '凛');
  assert.equal(await page.getByLabel('new_char 的显示名称', { exact: true }).inputValue(), '新角色');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'saved-source-and-undone-draft.png') });
  console.log('PASS real Editor controls -> authority -> filesystem: saved characters preserved, variable-only save leaves character draft unpublished');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    console.error(await page.evaluate(() => ({ status: document.getElementById('status')?.textContent })).catch(() => ({})), errors);
  }
  throw error;
} finally { await browser?.close(); await server?.close(); }
