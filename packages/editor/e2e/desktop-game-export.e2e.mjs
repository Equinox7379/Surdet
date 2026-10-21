import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { _electron as electron } from 'playwright';

// The packaged desktop Editor's Windows export dialog over the real preload bridge and main process:
// drafts are saved first, the real inspection fills the form, every declared plugin needs its own
// permission, and a real export call reports its reason when it fails. The export handlers are then
// replaced in the main process to drive stage progress, a cancellation that settles late, the close
// protection while it runs, and a finished export.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.SURDET_DESKTOP_E2E_OUTPUT ?? path.join(os.tmpdir(), 'surdet-desktop-export-e2e'));
await fs.mkdir(output, { recursive: true });

/** A real RGBA PNG for the program icon. */
function png(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) rows.set([40, 90, 200, 255], y * (size * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]), length = Buffer.alloc(4), sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const fixture = await fs.mkdtemp(path.join(output, 'project-'));
for (const dir of ['content/scenario', 'content/assets/bg', 'content/assets/ui', 'plugins']) await fs.mkdir(path.join(fixture, dir), { recursive: true });
await fs.copyFile(path.join(root, 'e2e/fixtures/asset-authority-project/content/assets/bg/castle_hall.svg'), path.join(fixture, 'content/assets/bg/castle_hall.svg'));
await fs.writeFile(path.join(fixture, 'content/assets/ui/icon.png'), png(32));
await fs.writeFile(path.join(fixture, 'package.json'), `${JSON.stringify({ name: 'export-check', version: '0.2.0', private: true }, null, 2)}\n`);
await fs.writeFile(path.join(fixture, 'game.config.json'), `${JSON.stringify({ title: '导出验证', version: '0.2.0', entryScene: 'ch01_01', characters: {},
  plugins: [{ id: 'letters', entry: 'plugins/letters.js', apiVersion: 1, instructions: [{ name: 'letter_mark', blocking: false, parameters: [] }] }] }, null, 2)}\n`);
await fs.writeFile(path.join(fixture, 'plugins/letters.js'), "export default () => ({ apiVersion: 1, instructions: { letter_mark() {} } });\n");
const scenePath = path.join(fixture, 'content/scenario/ch01_01.gal');
const originalScene = '@scene ch01_01\n@bg castle_hall\n凛：导出前的初稿。\n@end\n';
await fs.writeFile(scenePath, originalScene);
const exportParent = await fs.mkdtemp(path.join(output, 'export-parent-'));
const profile = await fs.mkdtemp(path.join(output, 'profile-'));

let app;
const errors = [];
const executablePath = process.env.SURDET_DESKTOP_EXECUTABLE;
const args = [...(executablePath ? [] : [path.join(root, 'desktop-dist')]), `--user-data-dir=${profile}`];
const env = { ...process.env, SURDET_AGENT_DATA_DIR: path.join(output, 'agent-data') };
const watch = page => {
  page.on('dialog', d => { if (d.type() !== 'beforeunload') void d.accept(); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const attemptClose = (application, id) => application.evaluate(({ dialog, BrowserWindow }, id) => new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error('native close prompt missing')), 5000);
  dialog.showMessageBoxSync = (_window, options) => { clearTimeout(deadline); resolve(options.message); return 0; };
  BrowserWindow.fromId(id).close();
}), id);
try {
  app = await electron.launch({ args, env, ...(executablePath ? { executablePath } : {}) });
  app.process().stderr.on('data', data => process.stderr.write(data));
  const home = await app.firstWindow();
  watch(home);
  await home.waitForSelector('#app button');
  assert.equal(await home.locator('[data-action="export-game"]').count(), 0, 'the start page without a project offers no export');
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  const opened = app.waitForEvent('window');
  await home.getByRole('button', { name: '打开项目', exact: true }).click();
  const page = await opened;
  watch(page);
  await page.waitForFunction(() => window.surdetEditorDebug?.state.dirName && document.body.innerText.includes('接力保护：已连接'));
  const windowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible() && w.getTitle().includes('导出验证'))?.id
    ?? BrowserWindow.getAllWindows().at(-1).id);

  // 1. A draft is saved before anything is inspected: the export reads only the saved project.
  await page.getByRole('button', { name: '源码', exact: true }).click();
  const edited = originalScene.replace('导出前的初稿。', '保存后再导出。');
  await page.getByRole('textbox', { name: '完整剧本源码' }).fill(edited);
  await page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'dirty');
  await page.locator('[data-action="export-game"]').click();
  const dialog = page.locator('dialog.game-export-dialog');
  const status = dialog.locator('.game-export-status');
  await dialog.getByText('有尚未保存的修改。导出只使用磁盘上已保存的版本，请先保存。').waitFor();
  await dialog.getByRole('button', { name: '保存全部并继续' }).click();
  await dialog.locator('.game-export-identity').getByText('export-check').waitFor();
  assert.equal(await fs.readFile(scenePath, 'utf8'), edited, 'the draft was saved before the inspection');
  console.log('PASS drafts are saved before the export inspects the project');

  // 2. The real inspection fills the form; the declared plugin is not allowed until the person checks it.
  const inspection = await page.evaluate(() => window.surdetDesktop.inspectGameExport());
  assert.equal(inspection.id, 'export-check');
  assert.equal(await dialog.getByLabel('游戏标题').inputValue(), '导出验证');
  assert.equal(await dialog.getByLabel('Windows 版本').inputValue(), '0.2.0');
  assert.equal(await dialog.getByLabel('新文件夹名称').inputValue(), '导出验证-windows');
  assert.equal(await dialog.locator('.game-export-issue').count(), inspection.issues.length, 'every inspected issue is listed');
  const plugin = dialog.getByLabel('允许把插件 letters 打包进游戏');
  assert.equal(await plugin.isChecked(), false);
  const pluginText = await dialog.locator('.game-export-plugins').innerText();
  assert.ok(pluginText.includes('plugins/letters.js') && pluginText.includes('声明不算同意'), pluginText);
  const run = dialog.getByRole('button', { name: '导出', exact: true });
  const blocker = dialog.locator('.game-export-blocker');
  assert.equal(await run.isDisabled(), true);
  assert.equal(await blocker.innerText(), '请逐个确认要打包的插件：letters。');
  await dialog.getByLabel('Windows 版本').fill('1.2');
  assert.match(await blocker.innerText(), /版本须为三段或四段数字/);
  await dialog.getByLabel('Windows 版本').fill('1.2.0');
  await plugin.check();
  assert.equal(await blocker.innerText(), '请选择导出位置。');
  assert.deepEqual(await dialog.getByLabel('程序图标').locator('option').allTextContents(), ['默认图标', 'ui/icon.png']);
  await dialog.getByLabel('程序图标').selectOption('content/assets/ui/icon.png');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, exportParent);
  await dialog.getByRole('button', { name: '选择位置…' }).click();
  await dialog.locator('.game-export-where').getByText(exportParent).waitFor();
  assert.match(await dialog.locator('.game-export-target').innerText(), /将新建：.*导出验证-windows（已有同名文件夹时不会覆盖）/);
  assert.equal(await run.isDisabled(), false);
  if (process.env.SURDET_DESKTOP_E2E_OUTPUT) await page.screenshot({ path: path.join(output, 'export-form.png') });
  console.log('PASS the real inspection fills the form; the plugin needs its own permission; version and location are required');

  // 3. A real export call: validate either the finished game or the failed export's cleanup.
  await page.evaluate(() => { window.__exportPhases = []; window.surdetDesktop.onGameExportProgress(progress => window.__exportPhases.push(progress.phase)); });
  await run.click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('dialog.game-export-dialog');
    if (!dialog) return false;
    const message = dialog.querySelector('.game-export-status').textContent;
    return (/^导出没有完成：/.test(message) && !dialog.querySelector('.game-export-form').hidden)
      || (/^已导出/.test(message) && !dialog.querySelector('.game-export-result').hidden);
  }, undefined, { timeout: 120_000 });
  const realOutcome = await status.innerText();
  console.log(`REAL EXPORT ON ${process.platform}: ${realOutcome.split('\n')[0]}`);
  const phases = await page.evaluate(() => window.__exportPhases);
  assert.ok(phases.includes('checking'), `the real export reported its stages: ${phases}`);
  if (process.platform !== 'win32') {
    assert.match(realOutcome, /^导出没有完成：/, 'a failed export is not shown as finished');
  }
  if (realOutcome.startsWith('已导出')) {
    assert.match(realOutcome, /^已导出「导出验证」1\.2\.0。/);
    assert.equal(await dialog.locator('.game-export-form').isVisible(), false, 'a finished export shows its result instead of the form');
    assert.deepEqual(await fs.readdir(exportParent), ['导出验证-windows']);
    const executable = path.join(exportParent, '导出验证-windows', '导出验证.exe');
    assert.equal((await fs.stat(executable)).isFile(), true, 'the real export produced its executable');
    await dialog.locator('.game-export-result').getByText(executable, { exact: true }).waitFor();

    await dialog.getByRole('button', { name: '再导出一份' }).click();
    await dialog.locator('.game-export-form').waitFor({ state: 'visible' });
    await dialog.locator('.game-export-where').getByText('尚未选择').waitFor();
    await dialog.getByLabel('Windows 版本').fill('1.2.0');
    await plugin.check();
    await dialog.getByLabel('程序图标').selectOption('content/assets/ui/icon.png');
    const controlledParent = await fs.mkdtemp(path.join(output, 'controlled-parent-'));
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, controlledParent);
    await dialog.getByRole('button', { name: '选择位置…' }).click();
    await dialog.locator('.game-export-where').getByText(controlledParent).waitFor();
  } else {
    assert.match(realOutcome, /^导出没有完成：/, 'a failed export is not shown as finished');
    assert.deepEqual(await fs.readdir(exportParent), [], 'a failed export leaves no folder behind');
    assert.equal(await dialog.locator('.game-export-where').innerText(), exportParent, 'the location stays chosen for a retry');
  }
  assert.equal(await page.locator('[data-action="save-project"]').isDisabled(), false, 'the export no longer holds the Editor lock');
  console.log('PASS the real export outcome and files agree; the lock is released and the next export has a usable form/location');

  // 4. Controlled main-process export: stage progress, protection while it runs, and a cancellation that settles late.
  await app.evaluate(({ ipcMain }) => {
    const shared = globalThis;
    for (const channel of ['editor:export-game', 'editor:export-cancel', 'editor:export-show']) ipcMain.removeHandler(channel);
    shared.__exportRequests = []; shared.__showCalls = 0; shared.__cancelCalls = 0;
    ipcMain.handle('editor:export-game', (event, request) => new Promise((resolve, reject) => {
      shared.__exportRequests.push(request);
      event.sender.send('editor:export-progress', { phase: 'checking', completed: 0, total: 1 });
      event.sender.send('editor:export-progress', { phase: 'archive', completed: 2, total: 5 });
      shared.__settleExport = ok => ok
        ? resolve({ directory: '/games/export-check-windows', executable: '/games/export-check-windows/导出验证.exe', id: 'export-check', title: request.title, version: request.version })
        : reject(new Error('导出已取消。'));
    }));
    ipcMain.handle('editor:export-cancel', () => { shared.__cancelCalls += 1; setTimeout(() => shared.__settleExport(false), 1500); });
    ipcMain.handle('editor:export-show', () => { shared.__showCalls += 1; });
  });
  await dialog.getByLabel('新文件夹名称').fill('导出验证-正式');
  await run.click();
  await dialog.locator('.game-export-phases [aria-current="step"]').getByText('打包素材').waitFor();
  assert.match(await dialog.locator('.game-export-phases [aria-current="step"]').innerText(), /打包素材 2\/5/);
  assert.deepEqual(await dialog.locator('.game-export-phases li').evaluateAll(items => items.map(item => item.dataset.phaseState)),
    ['done', 'done', 'done', 'current', 'waiting', 'waiting']);
  const request = await app.evaluate(() => globalThis.__exportRequests.at(-1));
  assert.equal(typeof request.locationId, 'string');
  assert.deepEqual({ ...request, locationId: '<id>' }, { locationId: '<id>', folderName: '导出验证-正式', title: '导出验证', version: '1.2.0',
    icon: 'content/assets/ui/icon.png', trustedPlugins: ['letters'] }, 'the bridge carries the form as entered and no physical path');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'Escape does not close a running export');
  assert.equal(await dialog.getByRole('button', { name: '关闭' }).isDisabled(), true);
  assert.equal(await page.locator('[data-action="save-project"]').isDisabled(), true, 'saving waits for the export');
  assert.match(await page.locator('.editor-save-state').innerText(), /正在导出游戏/);
  // The main process's existing "暂时不能关闭" box; its text names saving and the other operations.
  assert.match(await attemptClose(app, windowId), /请完成后再关闭/);
  assert.equal(page.isClosed(), false, 'the window stays open while the export runs');
  if (process.env.SURDET_DESKTOP_E2E_OUTPUT) await page.screenshot({ path: path.join(output, 'export-progress.png') });
  await dialog.getByRole('button', { name: '取消导出' }).click();
  await status.getByText('正在取消，等待当前文件操作和清理结束…').waitFor();
  await page.waitForTimeout(700);
  assert.equal(await status.innerText(), '正在取消，等待当前文件操作和清理结束…', 'cancellation is not reported before the export settled');
  assert.equal(await page.locator('[data-action="save-project"]').isDisabled(), true, 'the lock holds until the export settled');
  await status.getByText('导出已取消。').waitFor();
  assert.equal(await app.evaluate(() => globalThis.__cancelCalls), 1);
  assert.equal(await page.locator('[data-action="save-project"]').isDisabled(), false);
  console.log('PASS stage progress, Escape/close/save protection while it runs, and a cancellation reported only once it settled');

  // 5. A finished export: the result, the folder button, and the location spent.
  await run.click();
  await dialog.locator('.game-export-phases [aria-current="step"]').waitFor();
  await app.evaluate(() => globalThis.__settleExport(true));
  await dialog.locator('.game-export-result').getByText('/games/export-check-windows/导出验证.exe').waitFor();
  assert.match(await status.innerText(), /^已导出「导出验证」1\.2\.0。/);
  await dialog.getByRole('button', { name: '在文件夹中显示' }).click();
  for (const deadline = Date.now() + 5000; await app.evaluate(() => globalThis.__showCalls) !== 1;) {
    if (Date.now() > deadline) throw new Error('the folder was not shown');
    await page.waitForTimeout(50);
  }
  if (process.env.SURDET_DESKTOP_E2E_OUTPUT) await page.screenshot({ path: path.join(output, 'export-done.png') });
  await dialog.getByRole('button', { name: '再导出一份' }).click();
  await dialog.locator('.game-export-where').getByText('尚未选择').waitFor();
  await dialog.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'detached' });
  console.log('PASS a finished export shows the result and opens its folder; another export needs a new location');

  assert.deepEqual(errors, [], 'page errors');
  console.log('PASS desktop game export');
} finally {
  if (app) {
    // A failed step may leave the controlled export running, which keeps the window from closing.
    await app.evaluate(({ dialog }) => { globalThis.__settleExport?.(false); dialog.showMessageBoxSync = () => 1; }).catch(() => {});
    const closed = app.close().then(() => true, () => true);
    if (!await Promise.race([closed, new Promise(resolve => setTimeout(() => resolve(false), 10_000))])) app.process().kill('SIGKILL');
  }
}
