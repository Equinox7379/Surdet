import { app, BrowserWindow } from 'electron';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

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
    },
  });
  // 打包后游戏产物在 asar 内的 game/ 目录；开发时指向 starter 的 vite 构建产物
  const entry = app.isPackaged
    ? path.join(app.getAppPath(), 'game', 'index.html')
    : path.resolve(__dirname, '../../examples/starter/dist/index.html');
  void win.loadFile(entry);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
