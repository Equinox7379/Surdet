import { contextBridge, ipcRenderer } from 'electron';
import type { SaveSnapshot } from '@surdet/core';

/**
 * Preload：把文件存档桥暴露给渲染层（window.surdetSave）。
 * 同步 IPC（sendSync）——存档为低频小数据，可接受；浏览器环境无此 API，宿主回退 localStorage。
 * sandbox: true 下 preload 只能使用 contextBridge/ipcRenderer，fs 读写全部在主进程完成。
 */
contextBridge.exposeInMainWorld('surdetSave', {
  list: (): string[] => ipcRenderer.sendSync('save:list') as string[],
  read: (slot: string): SaveSnapshot | null => ipcRenderer.sendSync('save:read', slot) as SaveSnapshot | null,
  write: (slot: string, data: SaveSnapshot): void => {
    ipcRenderer.sendSync('save:write', slot, data);
  },
  delete: (slot: string): void => {
    ipcRenderer.sendSync('save:delete', slot);
  },
});
