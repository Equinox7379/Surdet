import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import { assertValidSnapshot, type SaveSnapshot } from '@surdet/core'; // 复用 core 深度校验（审计修复：消灭弱版重复实现）
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

/** 桌面设置文件：userData/settings.json（设备级设置，独立于存档目录） */
function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** 会话日志：userData/logs/session.log（超 1MB 重新开文件，防无限膨胀） */
function logLine(level: string, msg: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'session.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.rmSync(file);
    fs.appendFileSync(file, `[${new Date().toISOString()}] [${level}] ${msg}\n`);
  } catch {
    /* 日志失败不影响游戏 */
  }
}

/** 游戏根目录：打包后为 asar 内 game/；开发时为 examples/starter */
function gameRoot(): string {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'game')
    : path.resolve(__dirname, '../../../examples/starter');
}

/** 窗口标题：优先取游戏 game.config.json 的 title 字段（游戏品牌化），缺省默认 */
function readGameTitle(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(gameRoot(), 'game.config.json'), 'utf8')) as { title?: string };
    return cfg.title && cfg.title.length > 0 ? cfg.title : 'Surdet Game';
  } catch {
    return 'Surdet Game';
  }
}

/** 素材加密密钥（打包时生成于 game/.skey，32 字节 hex）；文件不存在 = 素材未加密（开发模式） */
function assetKey(): Buffer | null {
  try {
    const hex = fs.readFileSync(path.join(gameRoot(), '.skey'), 'utf8').trim();
    const key = Buffer.from(hex, 'hex');
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/** 注册设置持久化 IPC（渲染层 preload 经 invoke 转发；内容校验 + 原子写） */
function registerSettingsIpc(): void {
  ipcMain.handle('settings:read', (e) => {
    assertTrustedSender(e);
    try {
      return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    } catch {
      return null; // 无设置文件/损坏：渲染层按默认值合并
    }
  });
  ipcMain.handle('settings:write', (e, data: unknown) => {
    assertTrustedSender(e);
    if (typeof data !== 'object' || data === null) {
      throw new Error('设置数据必须是对象');
    }
    const file = settingsPath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  });
}

/** 应用级 IPC：退出/全屏切换/渲染端日志/素材读取（自动解密） */
function registerAppIpc(): void {
  ipcMain.handle('app:quit', (e) => {
    assertTrustedSender(e);
    app.quit();
  });
  ipcMain.handle('window:toggleFullscreen', (e) => {
    assertTrustedSender(e);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.handle('log', (e, level: unknown, msg: unknown) => {
    assertTrustedSender(e);
    logLine(typeof level === 'string' ? level : 'info', typeof msg === 'string' ? msg : String(msg));
  });
  ipcMain.handle('asset:list', (e) => {
    assertTrustedSender(e);
    const root = path.join(gameRoot(), 'content', 'assets');
    if (!fs.existsSync(root)) return [];
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else out.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    };
    walk(root);
    return out;
  });
  ipcMain.handle('asset:read', (e, relPath: unknown) => {
    assertTrustedSender(e);
    if (typeof relPath !== 'string' || relPath.includes('..') || path.isAbsolute(relPath)) {
      throw new Error(`非法素材路径：${String(relPath)}`);
    }
    const full = path.join(gameRoot(), 'content', 'assets', relPath);
    const data = fs.readFileSync(full);
    if (data.subarray(0, 5).toString() === 'SDAT2') {
      // AES-256-GCM 加密素材：'SDAT2' + iv(12) + authTag(16) + 密文；篡改/密钥错误即抛错
      const key = assetKey();
      if (!key) throw new Error('素材已加密但缺少密钥（game/.skey 丢失）');
      const iv = data.subarray(5, 17);
      const tag = data.subarray(17, 33);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data.subarray(33)), decipher.final()]);
    }
    // 无 SDAT2 魔数 = 明文素材直读（审计修复：移除旧 XOR 回退——
    // 原实现在密钥存在时会把漏加密的明文素材 XOR 成乱码且无报错；旧 XOR 包请重新以 AES 打包）
    return data;
  });
}

/** 窗口状态记忆：userData/window-state.json（位置/尺寸/全屏，跨会话恢复） */
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fullScreen?: boolean;
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  try {
    const s = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8')) as WindowState;
    if (typeof s.width === 'number' && typeof s.height === 'number' && s.width > 0 && s.height > 0) {
      return s;
    }
  } catch {
    /* 缺失/损坏 → 默认尺寸 */
  }
  return { width: 1280, height: 720 };
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const b = win.getNormalBounds();
    const s: WindowState = { x: b.x, y: b.y, width: b.width, height: b.height, fullScreen: win.isFullScreen() };
    fs.writeFileSync(windowStatePath(), JSON.stringify(s));
  } catch {
    /* 状态保存失败不影响退出 */
  }
}

function createWindow(): void {
  const ws = loadWindowState();
  const win = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    ...(ws.x !== undefined && ws.y !== undefined ? { x: ws.x, y: ws.y } : {}),
    resizable: true,
    autoHideMenuBar: true, // 游戏窗口不显示菜单栏（Alt 也不再唤出）
    backgroundColor: '#000000',
    title: readGameTitle(),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  // 全屏切换：Alt+Enter / F11（GalGame 惯例）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if ((input.key === 'Enter' && input.alt) || input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // 窗口状态：恢复上次全屏状态；关闭时保存位置/尺寸
  if (ws.fullScreen) win.setFullScreen(true);
  win.on('close', () => saveWindowState(win));

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

// 未捕获异常：落日志 + 错误框（稳定性工程：玩家可见的崩溃信息而非白屏）
process.on('uncaughtException', (err) => {
  logLine('fatal', err.stack ?? String(err));
  if (app.isReady()) {
    dialog.showErrorBox('运行错误', `${err.message}\n\n详细日志：userData/logs/session.log`);
    app.quit();
  }
});

// 单实例锁：防止双开时两个进程互写同一份存档/设置（后开者退出并聚焦已有窗口）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    logLine('info', `app ready, packaged=${String(app.isPackaged)}`);
    registerSaveIpc();
    registerSettingsIpc();
    registerAppIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
