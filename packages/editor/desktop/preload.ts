import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './contracts.js';

if (process.isMainFrame) {
  const bridge: DesktopBridge = {
    inspectGameExport: () => ipcRenderer.invoke('editor:export-inspect'),
    chooseExportLocation: () => ipcRenderer.invoke('editor:export-location'),
    exportGame: request => ipcRenderer.invoke('editor:export-game', request),
    cancelGameExport: () => ipcRenderer.invoke('editor:export-cancel'),
    showGameExport: () => ipcRenderer.invoke('editor:export-show'),
    onGameExportProgress: callback => {
      const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) => callback(progress);
      ipcRenderer.on('editor:export-progress', listener);
      return () => { ipcRenderer.removeListener('editor:export-progress', listener); };
    },
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
