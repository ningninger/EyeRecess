'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  patch: (partial) => ipcRenderer.invoke('app:patch', partial),
  preset: (name) => ipcRenderer.invoke('app:preset', name),
  resetPlan: () => ipcRenderer.invoke('app:reset-plan'),
  pause: (minutes) => ipcRenderer.invoke('app:pause', minutes),
  focus: (minutes) => ipcRenderer.invoke('app:focus', minutes),
  startBreak: (kind) => ipcRenderer.invoke('app:start-break', kind),
  resetStats: () => ipcRenderer.invoke('app:reset-stats'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.send('ui:open-external', url),
  onState: (cb) => ipcRenderer.on('app:state', (_e, s) => cb(s)),
  onScrollTo: (cb) => ipcRenderer.on('ui:scroll-to', (_e, s) => cb(s)),
  platform: process.platform,
});
