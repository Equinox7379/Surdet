import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './contracts.js';

if (process.isMainFrame) {
  const bridge: DesktopBridge = {
    context: () => ipcRenderer.invoke('editor:context'),
    openProject: () => ipcRenderer.invoke('editor:open-project'),
    chooseProjectLocation: () => ipcRenderer.invoke('editor:choose-project-location'),
    createProject: request => ipcRenderer.invoke('editor:create-project', request),
    recentProjects: () => ipcRenderer.invoke('editor:recent-projects'),
    openRecentProject: id => ipcRenderer.invoke('editor:open-recent-project', id),
    pickDirectory: () => ipcRenderer.invoke('editor:pick-directory'),
    read: (token, path) => ipcRenderer.invoke('editor:read', token, path),
    reportUnloadState: busy => { ipcRenderer.sendSync('editor:unload-state', busy); },
  };
  contextBridge.exposeInMainWorld('surdetDesktop', bridge);
}
