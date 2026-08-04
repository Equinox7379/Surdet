import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import * as url from 'node:url';
import type { SaveSnapshot } from '@surdet/core';
import { FileSaveStore } from './save-store.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

/** 桌面存档目录：userData/saves（第一次访问时创建） */
let saveStore: FileSaveStore | null = null;

function getSaveStore(): FileSaveStore {
  if (!saveStore) {
    saveStore = new FileSaveStore(path.join(app.getPath('userData'), 'saves'));
  }
  return saveStore;
}

/** IPC sender 校验：仅接受本地 file:// 帧（打包后 asar 亦为 file://），拒绝外部/网络内容注入。 */
function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url ?? '';
  if (!frameUrl.startsWith('file://')) {
    throw new Error(`拒绝来自非本地帧的存档请求：${frameUrl}`);
  }
}

/** 存档数据最小形状校验：防渲染端写入非对象/缺 meta 的垃圾数据。 */
function assertValidSnapshot(data: unknown): asserts data is SaveSnapshot {
  if (typeof data !== 'object' || data === null) {
    throw new Error('存档数据必须是对象');
  }
  const meta = (data as SaveSnapshot).meta;
  if (typeof meta !== 'object' || meta === null) {
    throw new Error('存档数据缺少 meta 元信息');
  }
}

/** 注册渲染层（preload）经 ipcRenderer.invoke 转发的存档读写。
 *  异步 IPC（handle/invoke）：存档 I/O 不阻塞主进程事件循环（旧版 sendSync 会卡渲染帧）。 */
function registerSaveIpc(): void {
  ipcMain.handle('save:list', (e) => {
    assertTrustedSender(e);
    return getSaveStore().list();
  });
  ipcMain.handle('save:read', (e, slot: string) => {
    assertTrustedSender(e);
    return getSaveStore().read(slot);
  });
  ipcMain.handle('save:write', (e, slot: string, data: SaveSnapshot) => {
    assertTrustedSender(e);
    assertValidSnapshot(data);
    getSaveStore().write(slot, data);
  });
  ipcMain.handle('save:delete', (e, slot: string) => {
    assertTrustedSender(e);
    getSaveStore().delete(slot);
  });
  ipcMain.handle('save:listMeta', (e) => {
    assertTrustedSender(e);
    return getSaveStore().listMeta();
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    resizable: true,
    backgroundColor: '#000000',
    title: 'Surdet Game',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // 导航加固：游戏内容是本地静态页面，绝不应导航到外部地址。
  // 外部链接交给系统浏览器打开，防止游戏窗口被劫持成攻击面（如钓鱼页复用存档 IPC）。
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    }
  });
  // 拦截 window.open 弹窗（游戏内容无合法的新窗口需求；http(s) 链接转系统浏览器）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // 打包后游戏产物在 asar 内的 game/ 目录；开发时指向 starter 的 vite 构建产物
  // __dirname = packages/shell/dist → 上溯三级到仓库根的 examples/
  const entry = app.isPackaged
    ? path.join(app.getAppPath(), 'game', 'index.html')
    : path.resolve(__dirname, '../../../examples/starter/dist/index.html');
  void win.loadFile(entry);
}

app.whenReady().then(() => {
  registerSaveIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
