'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ov', {
  onGlow: (cb) => ipcRenderer.on('overlay:glow', (_e, p) => cb(p)),
  onBreak: (cb) => ipcRenderer.on('overlay:break', (_e, p) => cb(p)),
  action: (action, token) => ipcRenderer.send('overlay:action', { action, token }),
  platform: process.platform,
});
