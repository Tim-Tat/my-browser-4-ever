const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aven', {
  invoke: (action, payload) => ipcRenderer.invoke('aven:action', action, payload),
  onState: (cb) => ipcRenderer.on('aven:state', (_e, state) => cb(state)),
  onEvent: (cb) => ipcRenderer.on('aven:event', (_e, name, data) => cb(name, data)),
});
