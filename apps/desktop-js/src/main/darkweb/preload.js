const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('darkweb', {
  invoke: (action, payload) => ipcRenderer.invoke('darkweb:action', action, payload),
  onEvent: (cb) => ipcRenderer.on('darkweb:event', (_e, name, data) => cb(name, data)),
});
