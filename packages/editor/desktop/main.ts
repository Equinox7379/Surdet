import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDirectory } from './directory.js';
import { findRecentProject, parseRecentProjects, summarizeRecentProjects, withRecentProject, type RecentProject } from './recent-projects.js';
import { startEditorServer } from './server.js';
import { DESKTOP_ORIGIN } from './contracts.js';
import { createDesktopProject, selectProjectLocation, type SelectedProjectLocation } from './project-creation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('Surdet Editor');
const isolatedData = app.commandLine.getSwitchValue('user-data-dir');
app.setPath('userData', isolatedData || path.join(app.getPath('appData'), 'Surdet Editor'));
protocol.registerSchemesAsPrivileged([{ scheme: 'surdet-editor', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

type Directory = Awaited<ReturnType<typeof openDirectory>>;
type WindowState = { window: BrowserWindow; project: Directory | null; grants: Map<string, Directory>; busy: boolean; creationLocation: SelectedProjectLocation | null; creating: boolean };
const windows = new Map<number, WindowState>();
const closing = new Set<Promise<void>>();
let picking = false;
function trusted(event: IpcMainInvokeEvent | IpcMainEvent): WindowState {
  const state = windows.get(event.sender.id);
  if (!state || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== `${DESKTOP_ORIGIN}/index.html`) throw new Error('此页面不能访问本机项目。');
  return state;
}
function showError(error: unknown, parent?: BrowserWindow) {
  const options = { type: 'error' as const, title: 'Surdet 编辑器', message: '无法完成操作', detail: error instanceof Error ? error.message : String(error) };
  if (parent && !parent.isDestroyed()) void dialog.showMessageBox(parent, options);
  else void dialog.showMessageBox(options);
}

const recentProjectsFile = (): string => path.join(app.getPath('userData'), 'recent-projects.json');
async function readRecentProjects(): Promise<RecentProject[]> {
  try { return parseRecentProjects(JSON.parse(await fs.readFile(recentProjectsFile(), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Recent projects:', error);
    return [];
  }
}
// Windows may open projects concurrently; serialize the read-modify-write.
let recentWrites: Promise<void> = Promise.resolve();
function recordRecentProject(project: Directory): Promise<void> {
  recentWrites = recentWrites.then(async () => {
    const next = withRecentProject(await readRecentProjects(), { path: project.root, name: project.grant.name, openedAt: Date.now() });
    await fs.writeFile(recentProjectsFile(), JSON.stringify({ entries: next }));
    buildMenu(next);
  }).catch(error => { console.error('Recent projects:', error); });
  return recentWrites;
}
async function openRecentProject(entry: RecentProject): Promise<void> {
  let directory: Directory;
  try { directory = await openDirectory(entry.path); }
  catch { throw new Error(`无法打开「${entry.name}」：文件夹已移动、删除或暂时无法访问。`); }
  await openWindow(directory);
}

// A restored project opens straight into its window, so the start page and recent
// projects stay reachable from the native project menu.
function buildMenu(recent: readonly RecentProject[]): void {
  const focused = () => BrowserWindow.getFocusedWindow() ?? undefined;
  // Windows menus treat & as a mnemonic marker.
  const label = (text: string) => text.replaceAll('&', '&&');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '项目', submenu: [
      { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseProject(focused()).catch(error => showError(error)); } },
      { label: '最近项目', submenu: recent.length === 0 ? [{ label: '暂无最近项目', enabled: false }] : recent.map(entry => ({
        label: label(`${entry.name} — ${entry.path}`),
        click: () => { void openRecentProject(entry).catch(error => showError(error, focused())); },
      })) },
      { label: '显示启动页', click: () => { void openWindow(null).catch(error => showError(error)); } },
      { type: 'separator' },
      { label: '关闭窗口', role: 'close' },
      { type: 'separator' }, { label: '退出', role: 'quit' },
    ] },
    { label: '编辑', submenu: [{ label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' }, { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' }, { label: '全选', role: 'selectAll' }] },
    { label: '视图', submenu: [{ label: '放大', role: 'zoomIn' }, { label: '缩小', role: 'zoomOut' }, { label: '实际大小', role: 'resetZoom' }, { label: '全屏', role: 'togglefullscreen' }] },
  ]));
}

async function chooseProject(parent?: BrowserWindow): Promise<void> {
  if (picking) return;
  picking = true;
  try {
    const options = { title: '打开 Surdet 游戏项目', properties: ['openDirectory'] as Array<'openDirectory'> };
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    if (result.canceled || !result.filePaths[0]) return;
    await openWindow(await openDirectory(result.filePaths[0]));
  } finally { picking = false; }
}

async function openWindow(project: Directory | null) {
  const existing = [...windows.values()].find(state => state.project?.grant.identity === project?.grant.identity);
  if (existing) { existing.window.show(); existing.window.focus(); return; }
  const partition = `persist:editor-${project?.grant.identity ?? 'home'}`;
  const browserSession = session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    windows.has(contents.id) && permission === 'clipboard-sanitized-write'
    && details.isMainFrame && details.requestingUrl === `${DESKTOP_ORIGIN}/index.html`,
  ));
  browserSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents !== null && windows.has(contents.id) && permission === 'clipboard-sanitized-write'
    && details.isMainFrame && details.requestingUrl === `${DESKTOP_ORIGIN}/index.html`,
  );
  const runtime = await startEditorServer(path.join(here, 'ui'), path.join(app.getPath('userData'), 'authority'), project?.root);
  browserSession.protocol.handle('surdet-editor', request => runtime.request(request));
  const window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 680, show: false,
    title: project ? `${project.grant.name} — Surdet 编辑器` : 'Surdet 编辑器',
    backgroundColor: '#111317',
    webPreferences: { preload: path.join(here, 'preload.cjs'), session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
  });
  const state: WindowState = { window, project, grants: new Map(project ? [[project.grant.token, project]] : []), busy: false, creationLocation: null, creating: false };
  windows.set(window.webContents.id, state);
  const id = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => { event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    if (state.busy) {
      dialog.showMessageBoxSync(window, { type: 'info', title: '暂时不能关闭', message: '项目正在保存、写回审阅结果、整理或恢复，请完成后再关闭。审阅结果尚未确认时，请先检查或恢复原操作。', buttons: ['返回编辑器'] });
      return;
    }
    const choice = dialog.showMessageBoxSync(window, { type: 'question', title: '尚有未保存修改', message: '修改尚未保存。返回编辑器保存，还是不保存并关闭？', buttons: ['继续编辑', '不保存并关闭'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice === 1) event.preventDefault();
  });
  window.on('closed', () => {
    windows.delete(id);
    state.grants.clear();
    browserSession.protocol.unhandle('surdet-editor');
    const cleanup = runtime.close().catch(error => { console.error('Editor shutdown:', error); });
    closing.add(cleanup);
    void cleanup.finally(() => closing.delete(cleanup));
  });
  try {
    await window.loadURL(`${DESKTOP_ORIGIN}/index.html`);
    window.show();
    if (project) {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.writeFile(path.join(app.getPath('userData'), 'last-project.json'), JSON.stringify({ path: project.root }));
      await recordRecentProject(project);
      // The home window remains open if its in-memory demo has unsaved work.
      for (const other of windows.values()) if (!other.project && other.window !== window) other.window.close();
    }
  } catch (error) { window.destroy(); throw error; }
}

ipcMain.handle('editor:context', event => trusted(event).project?.grant ?? null);
ipcMain.handle('editor:open-project', async event => { const state = trusted(event); await chooseProject(state.window); });
ipcMain.handle('editor:choose-project-location', async event => {
  const state = trusted(event);
  if (picking || state.creating) return null;
  picking = true;
  try {
    const result = await dialog.showOpenDialog(state.window, { title: '选择新项目的保存位置', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0] || state.window.isDestroyed()) return null;
    const location = selectProjectLocation(result.filePaths[0]);
    state.creationLocation = location;
    return { id: location.id, location: location.location };
  } finally { picking = false; }
});
ipcMain.handle('editor:create-project', async (event, request: unknown) => {
  const state = trusted(event);
  if (state.creating) throw new Error('项目正在创建，请稍候。');
  state.creating = true;
  try {
    const directory = createDesktopProject(state.creationLocation, request, path.join(app.isPackaged ? process.resourcesPath : here, 'templates'));
    state.creationLocation = null;
    try { await openWindow(await openDirectory(directory)); }
    catch (error) { throw new Error(`项目已创建在「${directory}」，但暂时无法打开：${error instanceof Error ? error.message : String(error)}`); }
  } finally { state.creating = false; }
});
ipcMain.handle('editor:recent-projects', async event => { trusted(event); return summarizeRecentProjects(await readRecentProjects()); });
ipcMain.handle('editor:open-recent-project', async (event, id: unknown) => {
  trusted(event);
  // Only a directory recorded from an earlier native selection; never a renderer path.
  const entry = findRecentProject(await readRecentProjects(), id);
  if (!entry) throw new Error('最近项目列表已变化，请重新打开项目。');
  await openRecentProject(entry);
});
ipcMain.handle('editor:pick-directory', async event => {
  const state = trusted(event);
  const result = await dialog.showOpenDialog(state.window, { title: '选择审阅目录', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const directory = await openDirectory(result.filePaths[0]);
  state.grants.set(directory.grant.token, directory);
  return directory.grant;
});
ipcMain.handle('editor:read', async (event, token: unknown, relative: unknown) => {
  const state = trusted(event);
  if (typeof token !== 'string' || typeof relative !== 'string') throw new Error('无效的目录读取请求。');
  const directory = state.grants.get(token);
  if (!directory) throw new Error('此目录尚未获准访问，请重新选择。');
  return directory.read(relative);
});
ipcMain.on('editor:unload-state', (event, busy: unknown) => {
  try { trusted(event).busy = busy !== false; event.returnValue = true; }
  catch { event.returnValue = false; }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const window = [...windows.values()][0]?.window; window?.show(); window?.focus(); });
  app.on('window-all-closed', () => { void Promise.all([...closing]).finally(() => app.quit()); });
  app.on('will-quit', event => {
    if (closing.size === 0) return;
    event.preventDefault();
    void Promise.all([...closing]).finally(() => app.quit());
  });
  app.whenReady().then(async () => {
    buildMenu(await readRecentProjects());
    let project: Directory | null = null;
    try {
      const recent = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'last-project.json'), 'utf8')) as { path?: unknown };
      if (typeof recent.path === 'string') project = await openDirectory(recent.path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') showError(error); }
    try { await openWindow(project); }
    catch (error) { showError(error); if (project) await openWindow(null); else app.quit(); }
  }).catch(error => { showError(error); app.quit(); });
}
