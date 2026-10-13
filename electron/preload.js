const { contextBridge, ipcRenderer } = require('electron');

// Única ponte entre a tela (sem acesso ao Node) e o processo principal.
contextBridge.exposeInMainWorld('gateway', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  openLogsFolder: () => ipcRenderer.invoke('logs:open-folder'),
  onLog: (listener) => ipcRenderer.on('log:entry', (_event, entry) => listener(entry)),
  onStatus: (listener) => ipcRenderer.on('status:change', (_event, snapshot) => listener(snapshot)),
  onClosing: (listener) => ipcRenderer.on('app:closing', () => listener()),
});
