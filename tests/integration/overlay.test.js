'use strict';
// Exercise delayed page loads without allowing cancelled overlays to reappear.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

const windows = [];
let nextId = 1;
class Window extends EventEmitter {
  constructor() {
    super();
    this.visible = false;
    this.destroyed = false;
    this.loading = true;
    this.messages = [];
    this.webContents = new EventEmitter();
    Object.assign(this.webContents, {
      id: nextId++, mainFrame: {}, isLoading: () => this.loading,
      getURL: () => this.webContents.mainFrame.url,
      send: (...args) => this.messages.push(args),
    });
    windows.push(this);
  }
  loadFile(file) { this.webContents.mainFrame.url = pathToFileURL(file).href; return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  show() { this.visible = true; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  setBounds() {}
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setIgnoreMouseEvents() {}
  finishLoading() { this.loading = false; this.webContents.emit('did-finish-load'); }
}
const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const electron = {
  BrowserWindow: Window, ipcMain: new EventEmitter(),
  screen: { getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
};
const originalLoad = Module._load;
let Overlay;
Module._load = function(name) { return name === 'electron' ? electron : originalLoad.apply(this, arguments); };
try { ({ Overlay } = require('../../src/main/overlay')); }
finally { Module._load = originalLoad; }

const overlay = new Overlay();
overlay.showGlow(10000);
overlay.hideGlow();
windows[0].finishLoading();
assert.equal(windows[0].visible, false, 'Cancelled glow never reappears when its page finishes loading');
assert.equal(windows[0].messages.length, 0);

const first = { token: 1, endsAt: Date.now() + 10000 };
overlay.showBreak(first);
const win = overlay.breakWins[0];
overlay.hideBreak();
win.finishLoading();
assert.equal(win.visible, false, 'A cancelled session never appears after a late load');
overlay.showBreak(first);
assert.equal(win.visible, true);
overlay.hideBreak();
overlay.destroyBreak();
overlay.showBreak(first);
const latest = overlay.breakWins[0];
const second = { ...first, token: 2 };
overlay.showBreak(second);
latest.finishLoading();
assert.deepEqual(latest.messages, [['overlay:break', second]], 'Only the newest pending payload is displayed');
overlay.hideAll();
overlay.destroyBreak();
console.log('Overlay tests passed: cancelled loads and superseded payloads never display stale windows');
