import { app, BrowserWindow, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
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
function assertTrustedSender(event: IpcMainEvent): void {
  const frameUrl = event.senderFrame?.url ?? '';
  if (!frameUrl.startsWith('file://')) {
    throw new Error(`拒绝来自非本地帧的存档请求：${frameUrl}`);
  }
}

/** 注册渲染层（preload）经 ipcRenderer 转发的存档读写（同步 IPC，低频小数据）。 */
function registerSaveIpc(): void {
  ipcMain.on('save:list', (e) => {
    assertTrustedSender(e);
    e.returnValue = getSaveStore().list();
  });
  ipcMain.on('save:read', (e, slot: string) => {
    assertTrustedSender(e);
    e.returnValue = getSaveStore().read(slot);
  });
  ipcMain.on('save:write', (e, slot: string, data: SaveSnapshot) => {
    assertTrustedSender(e);
    getSaveStore().write(slot, data);
  });
  ipcMain.on('save:delete', (e, slot: string) => {
    assertTrustedSender(e);
    getSaveStore().delete(slot);
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
