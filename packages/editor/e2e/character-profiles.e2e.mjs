import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-character-profiles-'));
const game = path.join(scratch, 'game');
const output = path.resolve(process.env.SURDET_CHARACTER_OUTPUT ?? path.join(scratch, 'evidence'));
const imagePath = 'content/assets/portrait/art_coat_smile.svg';
let server, browser, page;
try {
  await fs.mkdir(path.join(game, 'content/scenario'), { recursive: true });
  await fs.mkdir(path.dirname(path.join(game, imagePath)), { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const configPath = path.join(game, 'game.config.json');
  const original = JSON.stringify({ title: 'Character profiles', entryScene: 'start', characters: { rin: { name: '凛', custom: { keep: true } } }, variables: {} });
  await fs.writeFile(configPath, original);
  await fs.writeFile(path.join(game, imagePath), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="400"><rect width="240" height="400" fill="#1020f0"/></svg>');
  await fs.writeFile(path.join(game, 'content/scenario/start.gal'), '@scene start\n@show rin:uniform smile\nrin：角色资料已经生效。\n@end\n');
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = await startDevProject(['--project', game, '--data-root', path.join(scratch, 'authority'), '--port', String(port)],
    { registerSignals: false, cacheDir: path.join(scratch, 'vite') });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
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
  const open = async () => {
    await page.locator('[data-action="open-project"]').click();
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.projectLoading === false
      && window.surdetEditorDebug.state.assetImportWorkspace?.entryState === 'ready' && !document.querySelector('[data-action="save-project"]').disabled);
    await page.locator('[data-editor-mode="config"]').click();
    await page.locator('[data-config-section-target="characters"]').click();
    await page.locator('[data-config-section="characters"] summary').filter({ hasText: /^\d+ 项显式绑定$/ }).click();
  };
  await open();
  await page.getByRole('button', { name: 'rin 添加服装 / 表情', exact: true }).click();
  await page.getByRole('textbox', { name: 'rin 第 1 项服装', exact: true }).fill('uniform');
  await page.getByRole('textbox', { name: 'rin 第 1 项表情', exact: true }).fill('smile');
  await page.getByRole('combobox', { name: 'rin 第 1 项立绘', exact: true }).selectOption(imagePath);
  const bounds = await page.locator('[aria-label^="rin 第 1 项"]').evaluateAll(controls => controls.map(control => {
    const rect = control.getBoundingClientRect(); return { label: control.getAttribute('aria-label'), left: rect.left, right: rect.right };
  }));
  assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= 1440), `portrait fields overflow: ${JSON.stringify(bounds)}`);
  assert.equal(await fs.readFile(configPath, 'utf8'), original);
  await page.screenshot({ path: path.join(output, 'portrait-draft.png') });
  await page.getByRole('button', { name: '保存角色表', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('角色表已保存'));
  const saved = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(saved.characters.rin, { name: '凛', custom: { keep: true }, portraits: { uniform: { smile: imagePath } } });
  await open();
  assert.equal(await page.getByRole('textbox', { name: 'rin 第 1 项服装', exact: true }).inputValue(), 'uniform');
  assert.equal(await page.getByRole('combobox', { name: 'rin 第 1 项立绘', exact: true }).inputValue(), imagePath);
  const frameReady = page.waitForEvent('framenavigated', { predicate: frame => frame.url().includes('/preview.html') });
  await page.keyboard.press('Control+p');
  const frame = await frameReady;
  await frame.waitForFunction(() => {
    let root = [...document.querySelectorAll('button')].find(button => button.container?.parent)?.container;
    while (root?.parent) root = root.parent;
    const visible = node => node && node.visible && !node.destroyed
      && (String(node.text ?? '').includes('角色资料已经生效') || (node.children ?? []).some(visible));
    return visible(root);
  });
  const pixels = await frame.evaluate(async () => {
    const image = new Image(); image.src = window.surdetPreviewDebug.runtime.queries.world.captureThumbnail(); await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 40 && data[i + 1] < 65 && data[i + 2] > 210) blue++;
    return blue;
  });
  assert.ok(pixels > 1000, `configured image was not rendered: ${pixels}`);
  await page.screenshot({ path: path.join(output, 'saved-reopened-preview.png') });
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ diskUnchangedDuringEdit: true, savedThroughAuthority: true,
    preservedUnknownFields: true, reopenedMapping: true, renderedBluePixels: pixels, errors }, null, 2));
  console.log(`PASS character table -> authority save -> reopen -> actual mapped image: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, `failure-${Date.now()}.png`) });
    console.error(await page.evaluate(() => ({ status: document.getElementById('status')?.textContent, preview: document.querySelector('.preview-source-state')?.textContent })));
  }
  throw error;
} finally { await browser?.close(); await server?.close(); }
