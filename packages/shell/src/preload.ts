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
