import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';

// Real Editor + local authority + disk files. Only the native directory picker
// is replaced by the existing Node-backed handle bridge.
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-label-baseline-'));
const game = path.join(scratch, 'game');
const output = path.resolve(process.env.SURDET_LABEL_BASELINE_OUTPUT ?? path.join(scratch, 'evidence'));
let server, browser;
try {
  await fs.mkdir(path.join(game, 'content/scenario'), { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(game, 'game.config.json'), '{"title":"Label baseline","entryScene":"start","variables":{}}');
  const file = path.join(game, 'content/scenario/start.GAL');
  const original = '\uFEFF@scene start\r\n原有正文。\r\n@end';
  await fs.writeFile(file, original);
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  server = await startDevProject(['--project', game, '--data-root', path.join(scratch, 'authority'), '--port', String(port)],
    { registerSignals: false, cacheDir: path.join(scratch, 'vite') });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.exposeFunction('__surdetNodeFs', createNodeFsBridge({ project: game }));
  await page.addInitScript(nodeBackedFileSystemInit, { initialRootKey: 'project' });
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...keys) {
      if (this.name === 'project-handles' && value?.handle?.__surdetRootKey) {
        const h = value.handle;
        value = { ...value, handle: { kind: h.kind, name: h.name, __surdetRootKey: h.__surdetRootKey, __surdetRelativePath: h.__surdetRelativePath } };
      }
      return put.call(this, value, ...keys);
    };
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  const reopen = async () => {
    await page.locator('[data-action="open-project"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false
      && window.surdetEditorDebug.state.assetImportWorkspace?.entryState === 'ready'
      && window.surdetEditorDebug.state.scenes.has('start') && !document.querySelector('[data-action="save-project"]').disabled);
    await page.locator('[data-editor-mode="editor"]').click();
    await page.locator('.scene-item[data-scene-id="start"]').click();
  };
  const text = () => page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').text);
  const settle = async action => {
    const finished = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/workspace/finish'));
    await action(); const response = await finished; assert.ok(response.ok(), await response.text());
    await page.waitForFunction(() => !document.querySelector('[data-action="save-project"]').disabled);
  };
  const rename = async (from, to) => {
    const index = (await text()).split(/\r\n|\n|\r/).findIndex(line => line.trim() === `@label ${from}`);
    assert.ok(index >= 0, `missing ${from}`);
    await page.locator(`.block[data-line="${index}"] .v4-step-summary`).click();
    await page.getByRole('button', { name: '改名并更新引用', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `重命名标签「${from}」` });
    await dialog.getByRole('textbox', { name: '新标签名' }).fill(to);
    await settle(() => dialog.getByRole('button', { name: '改名', exact: true }).click());
    return dialog;
  };
  const save = async () => {
    await settle(() => page.locator('[data-action="save-project"]').click());
    assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.pendingSceneCommit), null);
    assert.equal(await page.evaluate(() => window.surdetEditorDebug.state.scenes.get('start').dirty), false);
  };
  await reopen();
  await page.getByRole('button', { name: '添加剧情', exact: true }).click();
  await page.locator('.v4-insert-dialog > label select').selectOption('choice');
  await page.getByRole('button', { name: '插入到当前步骤之后', exact: true }).click();
  const draft = await text(); assert.match(draft, /@label branch_1_a/);
  const refused = await rename('branch_1_a', 'middle');
  assert.match(await refused.getByRole('alert').textContent(), /先保存.*新标签/);
  assert.equal(await refused.getByRole('textbox', { name: '新标签名' }).inputValue(), 'middle');
  await refused.getByRole('button', { name: '取消', exact: true }).click();
  await refused.waitFor({ state: 'detached' });
  assert.equal(await text(), draft);
  assert.deepEqual(await page.evaluate(() => window.surdetEditorDebug.state.pendingSceneConfigRenames), []);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  await page.screenshot({ path: path.join(output, 'new-label-save-first.png') });
  await save(); assert.equal(await fs.readFile(file, 'utf8'), draft);
  // Keep an ordinary unsaved body revision while doing two identity edits.
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.locator('.v4-source-editor').fill(draft.replace('原有正文。', '同稿返修仍保留。'));
  await page.getByRole('button', { name: '编排', exact: true }).click();
  await (await rename('branch_1_a', 'middle')).waitFor({ state: 'detached' });
  await (await rename('middle', 'arrival')).waitFor({ state: 'detached' });
  const renamed = await text(); assert.match(renamed, /@goto arrival/); assert.match(renamed, /同稿返修仍保留/);
  assert.equal(await fs.readFile(file, 'utf8'), draft);
  await save(); assert.equal(await fs.readFile(file, 'utf8'), renamed);
  await reopen(); assert.equal(await text(), renamed);
  assert.ok(renamed.startsWith('\uFEFF@scene start\r\n'));
  await page.screenshot({ path: path.join(output, 'saved-renamed-reopened.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ rejectedBeforeMutation: true, savedDraft: true,
    chainedRenameWithDirtyProse: true, realAuthoritySaveAndReopen: true, errors }, null, 2));
  console.log(`PASS new branch label refused -> original draft saved -> two renames with dirty prose -> authority save -> reopen: ${output}`);
} finally {
  await browser?.close(); await server?.close();
  // Keep this small fixture and failure evidence; no user project is touched.
}
