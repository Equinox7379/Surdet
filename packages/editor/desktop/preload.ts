import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './contracts.js';

if (process.isMainFrame) {
  const bridge: DesktopBridge = {
    context: () => ipcRenderer.invoke('editor:context'),
    openProject: () => ipcRenderer.invoke('editor:open-project'),
    pickDirectory: () => ipcRenderer.invoke('editor:pick-directory'),
    read: (token, path) => ipcRenderer.invoke('editor:read', token, path),
    reportUnloadState: busy => { ipcRenderer.sendSync('editor:unload-state', busy); },
  };
  contextBridge.exposeInMainWorld('surdetDesktop', bridge);
}
