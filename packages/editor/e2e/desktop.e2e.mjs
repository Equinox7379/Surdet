import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.SURDET_DESKTOP_E2E_OUTPUT ?? path.join(os.tmpdir(), 'surdet-desktop-e2e'));
await fs.mkdir(output, { recursive: true });
const fixture = await fs.mkdtemp(path.join(output, 'project-'));
await fs.mkdir(path.join(fixture, 'content/scenario'), { recursive: true });
await fs.mkdir(path.join(fixture, 'content/assets/bg'), { recursive: true });
await fs.copyFile(path.join(root, 'e2e/fixtures/asset-authority-project/content/assets/bg/castle_hall.svg'), path.join(fixture, 'content/assets/bg/castle_hall.svg'));
await fs.writeFile(path.join(fixture, 'game.config.json'), JSON.stringify({ title: '桌面验证', version: '0.1.0', entryScene: 'ch01_01', characters: {}, variables: { score: { type: 'number', initial: 1 } } }));
const profile = await fs.mkdtemp(path.join(output, 'profile-'));
const scenePath = path.join(fixture, 'content/scenario/ch01_01.gal');
const originalScene = '@scene ch01_01\n@bg castle_hall\n凛：桌面初稿。\n主角：这一段会保存到文件。\n@end\n';
await fs.writeFile(scenePath, originalScene);
let app;
const errors = [];
const executablePath = process.env.SURDET_DESKTOP_EXECUTABLE;
const args = [...(executablePath ? [] : [path.join(root, 'desktop-dist')]), `--user-data-dir=${profile}`];
const env = { ...process.env, SURDET_AGENT_DATA_DIR: path.join(output, 'agent-data') };
const watch = page => {
  // Electron owns beforeunload confirmation; CDP must not answer the same dialog.
  page.on('dialog', d => { if (d.type() !== 'beforeunload') void d.accept(); });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
};
const waitSaved = page => page.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'saved' && document.getElementById('status')?.textContent.includes('全部成功'));
const attemptClose = (application, id) => application.evaluate(({ dialog, BrowserWindow }, id) => new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error('native close prompt missing')), 5000);
  dialog.showMessageBoxSync = (_window, options) => { clearTimeout(deadline); resolve(options.message); return 0; };
  BrowserWindow.fromId(id).close();
}), id);
try {
  app = await electron.launch({ args, env, ...(executablePath ? { executablePath } : {}) });
  app.process().stderr.on('data', data => process.stderr.write(data));
  const page = await app.firstWindow();
  watch(page);
  await page.waitForSelector('#app button');
  await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: '打开项目', exact: true }).click();
  const project = await opened;
  watch(project);
  await project.waitForFunction(() => window.surdetEditorDebug?.state.dirName && document.body.innerText.includes('接力保护：已连接'));
  assert.notEqual(await project.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-write' })).state), 'denied', 'copy actions remain available to the editor');
  await project.getByRole('button', { name: '源码', exact: true }).click();
  const source = project.getByRole('textbox', { name: '完整剧本源码' });
  await source.fill(originalScene.replace('桌面初稿。', '独立窗口保存成功。'));
  await project.waitForFunction(() => document.querySelector('[data-save-state]')?.getAttribute('data-save-state') === 'dirty');
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).id);
  assert.match(await attemptClose(app, id), /未保存/);
  assert.equal(project.isClosed(), false, 'cancel close must preserve draft');
  assert.equal(await source.inputValue(), originalScene.replace('桌面初稿。', '独立窗口保存成功。'));
  console.log('CANCEL CLOSE: draft retained');
  // Playwright routing does not intercept Electron's custom protocol. Delay just
  // the actual write transport, without changing any editor/authority state.
  await project.evaluate(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (/\/(?:workspace\/publish|scenes\/commit)$/.test(String(input))) {
        window.fetch = fetch;
        await new Promise(resolve => { window.resumeDesktopSave = resolve; });
      }
      return fetch(input, init);
    };
  });
  await project.keyboard.press('Control+S');
  await project.waitForFunction(() => typeof window.resumeDesktopSave === 'function');
  assert.match(await attemptClose(app, id), /正在保存/);
  assert.equal(project.isClosed(), false, 'window must remain open while saving');
  await project.evaluate(() => window.resumeDesktopSave());
  await waitSaved(project);
  assert.match(await fs.readFile(scenePath, 'utf8'), /独立窗口保存成功/);
  await project.locator('[data-editor-mode="preview"]').click();
  await project.locator('iframe.preview-frame').waitFor();
  const frame = await (await project.locator('iframe.preview-frame').elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.surdetPreviewDebug?.runtime && document.querySelector('canvas')?.getBoundingClientRect().width > 0);
  await frame.waitForFunction(() => window.surdetPreviewDebug?.presentationSnapshot?.stage?.backgroundKey === 'castle_hall'
    && JSON.stringify(window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot()).includes('独立窗口保存成功'));
  assert.equal(await frame.evaluate(() => typeof window.surdetDesktop), 'undefined');
  await project.screenshot({ path: path.join(output, 'desktop-preview.png') });
  console.log('PREVIEW: real background and saved dialogue visible; no native bridge in preview frame');
  // Native reopen focuses the existing project instead of making two owners.
  await project.getByRole('button', { name: '打开项目', exact: true }).click();
  assert.equal((await app.windows()).length, 1);
  await project.locator('[data-editor-mode="config"]').click();
  await project.getByRole('button', { name: '变量', exact: true }).click();
  await project.getByRole('textbox', { name: '初始值，第 1 行', exact: true }).fill('42');
  assert.match(await attemptClose(app, id), /未保存/);
  assert.equal(project.isClosed(), false, 'configuration drafts must also prevent closing');
  await project.keyboard.press('Control+S');
  await waitSaved(project);
  assert.equal(JSON.parse(await fs.readFile(path.join(fixture, 'game.config.json'), 'utf8')).variables.score.initial, 42);
  await project.locator('[data-editor-mode="editor"]').click();
  await project.getByRole('button', { name: '源码', exact: true }).click();
  await source.fill(originalScene.replace('桌面初稿。', '重启后恢复的草稿。'));
  const identity = await project.evaluate(() => window.surdetEditorDebug.state.autosaveProjectId);
  assert.match(identity, /^desktop:/);
  await project.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('surdet-editor:autosave:') && localStorage.getItem(key).includes('重启后恢复的草稿')), null, { timeout: 35000 });
  const exited = project.waitForEvent('close');
  await app.evaluate(({ dialog, BrowserWindow }, id) => { dialog.showMessageBoxSync = () => 1; BrowserWindow.fromId(id).close(); }, id);
  await exited;
  // Native close has completed; disconnect Playwright's inspector so Node can exit.
  await app.close();
  app = undefined;
  assert.doesNotMatch(await fs.readFile(scenePath, 'utf8'), /重启后恢复的草稿/);
  app = await electron.launch({ args, env, ...(executablePath ? { executablePath } : {}) });
  const restored = await app.firstWindow(); watch(restored);
  await restored.waitForFunction(() => [...(window.surdetEditorDebug?.state.scenes.values() ?? [])].some(scene => scene.dirty && scene.text.includes('重启后恢复的草稿')));
  assert.equal(await restored.evaluate(() => window.surdetEditorDebug.state.autosaveProjectId), identity);
  await restored.keyboard.press('Control+S');
  await waitSaved(restored);
  assert.match(await fs.readFile(scenePath, 'utf8'), /重启后恢复的草稿/);
  assert.equal(JSON.parse(await fs.readFile(path.join(fixture, 'game.config.json'), 'utf8')).variables.score.initial, 42);
  console.log('RESTART: same physical project, saved configuration, persisted draft recovered and saved');
  await restored.screenshot({ path: path.join(output, 'desktop-reopened.png') });
  // Start page: recent projects are only directories the main process recorded.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await app.close();
  app = undefined;
  await fs.rm(path.join(profile, 'last-project.json'));
  const recentFile = path.join(profile, 'recent-projects.json');
  const recorded = JSON.parse(await fs.readFile(recentFile, 'utf8')).entries;
  assert.deepEqual(recorded.map(entry => entry.path), [await fs.realpath(fixture)]);
  await fs.writeFile(recentFile, JSON.stringify({ entries: [...recorded, { path: path.join(output, 'moved-away'), name: 'moved-away', openedAt: 1 }] }));
  app = await electron.launch({ args, env, ...(executablePath ? { executablePath } : {}) });
  const home = await app.firstWindow(); watch(home);
  const recentItems = home.locator('.editor-welcome-recent-item');
  await recentItems.nth(1).waitFor();
  assert.deepEqual(await recentItems.locator('strong').allInnerTexts(), [path.basename(recorded[0].path), 'moved-away']);
  await home.screenshot({ path: path.join(output, 'desktop-recent-projects.png') });
  await assert.rejects(home.evaluate(path => window.surdetDesktop.openRecentProject(path), fixture), /最近项目列表已变化/);
  await recentItems.nth(1).click();
  await home.waitForFunction(() => document.getElementById('status')?.textContent.includes('无法打开「moved-away」'));
  assert.equal(app.windows().length, 1, 'a missing recent folder must not open a window');
  const homeClosed = home.waitForEvent('close');
  const recentOpened = app.waitForEvent('window');
  await recentItems.first().click();
  const recentProject = await recentOpened; watch(recentProject);
  await recentProject.waitForFunction(() => window.surdetEditorDebug?.state.scenes.size > 0 && document.body.innerText.includes('接力保护：已连接'));
  await homeClosed;
  assert.equal(await recentProject.evaluate(() => window.surdetEditorDebug.state.autosaveProjectId), identity);
  // A restored project opens straight into its window; the native menu still reaches
  // the start page and the recent list.
  const projectMenu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map(item => ({ label: item.label, items: item.submenu?.items.map(sub => sub.label) ?? null })));
  const recentMenu = (await projectMenu()).find(item => item.label === '最近项目');
  assert.equal(recentMenu?.items.length, 2);
  assert(recentMenu.items[0].startsWith(`${path.basename(recorded[0].path)} — `), recentMenu.items[0]);
  const homeAgainOpened = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '显示启动页').click());
  const homeAgain = await homeAgainOpened; watch(homeAgain);
  await homeAgain.locator('.editor-welcome-recent-item').nth(1).waitFor();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === '最近项目').submenu.items[0].click());
  await recentProject.waitForTimeout(500);
  assert.equal(app.windows().length, 2, 'reopening an open project from the menu focuses it instead of adding a window');
  console.log('RECENT PROJECTS: recorded project reopened from the start page and native menu; forged id and moved folder rejected');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS', { fixture, profile });
} catch (error) {
  console.error(error);
  const last = app?.windows().at(-1);
  if (last && !last.isClosed()) { console.error('EDITOR AT FAILURE', await last.locator('body').innerText()); await last.screenshot({ path: path.join(output, 'desktop-failure.png') }); }
  // Failed cases own only temporary projects/profiles. Do not leave a dialog or
  // deliberately held transport keeping their test process alive.
  if (app) { await app.evaluate(({ app }) => app.exit(1)).catch(() => {}); app = undefined; }
  throw error;
} finally { if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close(); } }
