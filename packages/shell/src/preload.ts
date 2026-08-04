import { contextBridge, ipcRenderer } from 'electron';
import type { SaveSnapshot, SaveSlotMeta } from '@surdet/core';

/**
 * Preload：把文件存档桥暴露给渲染层（window.surdetSave）。
 * 异步 IPC（invoke）——存档读写不阻塞渲染帧；浏览器环境无此 API，宿主回退 localStorage。
 * sandbox: true 下 preload 只能使用 contextBridge/ipcRenderer，fs 读写全部在主进程完成。
 */
contextBridge.exposeInMainWorld('surdetSave', {
  list: (): Promise<string[]> => ipcRenderer.invoke('save:list') as Promise<string[]>,
  read: (slot: string): Promise<SaveSnapshot | null> =>
    ipcRenderer.invoke('save:read', slot) as Promise<SaveSnapshot | null>,
  write: (slot: string, data: SaveSnapshot): Promise<void> =>
    ipcRenderer.invoke('save:write', slot, data) as Promise<void>,
  delete: (slot: string): Promise<void> =>
    ipcRenderer.invoke('save:delete', slot) as Promise<void>,
  /** 槽位元信息索引（列表界面用，主进程无需全量读取存档体） */
  listMeta: (): Promise<SaveSlotMeta[]> => ipcRenderer.invoke('save:listMeta') as Promise<SaveSlotMeta[]>,
});

/** 设置持久化桥（userData/settings.json）：文本速度/音量等设备级设置，跨存档共享 */
contextBridge.exposeInMainWorld('surdetSettings', {
  read: (): Promise<unknown> => ipcRenderer.invoke('settings:read') as Promise<unknown>,
  write: (data: unknown): Promise<void> => ipcRenderer.invoke('settings:write', data) as Promise<void>,
});

/** 应用控制桥：退出 / 全屏切换 / 渲染端日志上报 */
contextBridge.exposeInMainWorld('surdetApp', {
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit') as Promise<void>,
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('window:toggleFullscreen') as Promise<void>,
  log: (level: string, msg: string): Promise<void> => ipcRenderer.invoke('log', level, msg) as Promise<void>,
});

/** 素材桥：打包 exe 内素材经 AES-256-GCM 加密（SDAT2），主进程读取并解密返回字节；
 *  浏览器开发模式无此 API，宿主回退直接 URL 加载。 */
contextBridge.exposeInMainWorld('surdetAsset', {
  /** 列出 content/assets 下全部素材相对路径 */
  list: (): Promise<string[]> => ipcRenderer.invoke('asset:list') as Promise<string[]>,
  /** 读取（自动解密）素材字节 */
  read: (relPath: string): Promise<Uint8Array> => ipcRenderer.invoke('asset:read', relPath) as Promise<Uint8Array>,
});
