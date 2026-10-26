'use strict';
// Exercise delayed page loads without allowing cancelled overlays to reappear.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

// Virtual timers verify native cache retirement without a minute-long test wait.
let clock = 0;
const timers = new Set();
global.setTimeout = (fn, ms) => {
  const timer = { fn, at: clock + ms, unref() {} };
  timers.add(timer);
  return timer;
};
global.clearTimeout = timer => timers.delete(timer);
global.setInterval = () => ({ unref() {} });
global.clearInterval = () => {};
function advance(ms) {
  const end = clock + ms;
  for (;;) {
    const next = [...timers].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    clock = next.at;
    timers.delete(next);
    next.fn();
  }
  clock = end;
}

const windows = [];
let nextId = 1;
class Window extends EventEmitter {
  constructor(options) {
    super();
    this.visible = false;
    this.shows = 0;
    this.resizes = 0;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.options = options;
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
  loadFile(file, options) { this.query = options.query; this.webContents.mainFrame.url = pathToFileURL(file).href; return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  show() { this.visible = true; this.shows++; }
  showInactive() { this.visible = true; this.shows++; }
  isVisible() { return this.visible; }
  hide() { this.visible = false; }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  setBounds(bounds) { this.bounds = { ...bounds }; this.resizes++; }
  getBounds() { return this.bounds; }
  setAlwaysOnTop() {}
  setVisibleOnAllWorkspaces() {}
  setIgnoreMouseEvents(ignore) { this.ignoring = ignore; }
  finishLoading() { this.loading = false; this.webContents.emit('did-finish-load'); }
  finishPainting(id = this.messages.findLast(([channel]) => channel === 'overlay:break')?.[1].presentationId) {
    electron.ipcMain.emit('overlay:painted', { sender: this.webContents, senderFrame: this.webContents.mainFrame }, id);
  }
}
const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const secondDisplay = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
let point = { x: 0, y: 0 };
let displays = [display, secondDisplay];
const electron = {
  BrowserWindow: Window, ipcMain: new EventEmitter(),
  screen: { getAllDisplays: () => displays, getDisplayNearestPoint: () => point.x >= 1920 ? secondDisplay : display, getCursorScreenPoint: () => point },
};
const originalLoad = Module._load;
let Overlay;
Module._load = function(name) { return name === 'electron' ? electron : originalLoad.apply(this, arguments); };
try { ({ Overlay } = require('../../src/main/overlay')); }
finally { Module._load = originalLoad; }

const overlay = new Overlay();
overlay.register();
overlay.showGlow(10000);
overlay.hideGlow();
windows[0].finishLoading();
assert.equal(windows[0].visible, false, 'Cancelled glow never reappears when its page finishes loading');
assert.equal(windows[0].messages.length, 0);
assert.equal(overlay.glowPointerTimer, null, 'Hiding a glow stops pointer polling');
overlay.showGlow(10000);
const glow = windows[0];
assert.equal(glow.ignoring, true, 'Glow does not intercept normal desktop input');
const oldToken = overlay.glowToken;
overlay.hideGlow();
point = { x: display.bounds.width - 100, y: 40 };
overlay.showGlow(10000);
assert.equal(glow.ignoring, false, 'The glow close button can receive clicks');
const event = { sender: glow.webContents, senderFrame: glow.webContents.mainFrame };
electron.ipcMain.emit('overlay:action', event, { action: 'dismiss-glow', token: oldToken });
assert.equal(glow.visible, true, 'An obsolete glow token cannot dismiss the replacement reminder');
electron.ipcMain.emit('overlay:action', event, { action: 'dismiss-glow', token: overlay.glowToken });
assert.equal(glow.visible, false, 'The close control hides the current reminder');
assert.equal(overlay.glowPointerTimer, null);

const first = { token: 1, endsAt: Date.now() + 10000 };
overlay.showBreak(first);
const win = overlay.breakWins[0];
overlay.hideBreak();
win.finishLoading();
assert.equal(win.visible, false, 'A cancelled session never appears after a late load');
overlay.showBreak(first);
assert.equal(win.visible, false, 'An opaque window stays hidden until its updated content paints');
win.finishPainting();
assert.equal(win.visible, true);
overlay.hideBreak();
overlay.destroyBreak();
overlay.showBreak(first);
const latest = overlay.breakWins[0];
const second = { ...first, token: 2 };
overlay.showBreak(second);
latest.finishLoading();
assert.equal(latest.messages.length, 1, 'Only the newest pending payload is displayed');
assert.equal(latest.messages[0][1].token, second.token);
latest.finishPainting(latest.messages[0][1].presentationId - 1);
assert.equal(latest.visible, false, 'Stale paint acknowledgements cannot expose a newer phase');
electron.ipcMain.emit('overlay:painted', { sender: latest.webContents, senderFrame: {} }, latest.messages[0][1].presentationId);
assert.equal(latest.visible, false, 'A child or unknown frame cannot expose an opaque cover');
latest.finishPainting();
assert.equal(overlay.breakWins.length, 2);
const actions = [];
overlay.onAction = (...args) => actions.push(args);
for (const win of overlay.breakWins) {
  assert.equal(win.query.mode, 'break', 'Every display has the full controls rather than a blank veil');
  assert.equal(win.options.focusable, true, 'Every display accepts keyboard input');
  win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'Escape' });
}
assert.deepEqual(actions, [['cancel', 2], ['cancel', 2]], 'Native Escape cancels from either display even if renderer handlers fail');
const stable = [...overlay.breakWins];
stable[1].finishLoading();
stable[1].finishPainting();
const messageCount = stable.map(win => win.messages.length);
for (let i = 0; i < 100; i++) overlay.refreshBreak();
assert.deepEqual(stable.map(win => win.messages.length), messageCount, 'Unchanged display metrics do not repaint or rebuild a cover');
point = { x: 2000, y: 40 };
overlay.showBreak({ ...second, phase: 'blink' });
assert.deepEqual(overlay.breakWins, stable, 'Moving the pointer cannot swap displays during a session');
assert.equal(stable.every(win => win.shows === 1 && win.resizes === 0), true, 'Phase changes do not re-show or resize visible windows');
secondDisplay.bounds.width = 1280;
overlay.refreshBreak();
assert.equal(stable[1].resizes, 1, 'A real bounds change resizes only the affected window');
assert.equal(stable[0].resizes, 0);
assert.deepEqual(overlay.breakWins, stable, 'Bounds changes preserve window identities');
displays = [display];
point = { x: 100, y: 40 };
overlay.refreshBreak();
assert.deepEqual(overlay.breakWins, [stable[0]], 'Removing one display preserves the remaining cover');
assert.equal(stable[1].isDestroyed(), true);
displays = [display, secondDisplay];
overlay.hideAll();
overlay.destroyBreak();
overlay.destroyGlow();

const stalled = new Overlay();
for (let i = 0; i < 500; i++) {
  stalled.showGlow(10000);
  stalled.showBreak({ token: i, endsAt: Date.now() + 10000 });
}
const stalledWindows = [stalled.glowWin, ...stalled.breakWins];
for (const win of stalledWindows) {
  assert.equal(win.webContents.listenerCount('did-finish-load'), 1, 'A stalled page retains only the latest load callback');
}
stalled.hideAll();
assert.equal(stalled.pendingLoads.size, 0, 'Cancellation releases all pending load closures');
for (const win of stalledWindows) {
  assert.equal(win.webContents.listenerCount('did-finish-load'), 0);
}
advance(59999);
assert.equal(stalledWindows.every(win => !win.isDestroyed()), true, 'Briefly cached windows remain reusable');
advance(1);
assert.equal(stalledWindows.every(win => win.isDestroyed()), true, 'Idle windows release their native resources after one minute');
assert.equal(stalled.glowWin, null);
assert.equal(stalled.breakWins.length, 0);
assert.equal(stalled.glowReleaseTimer, null);
assert.equal(stalled.breakReleaseTimer, null);

stalled.showGlow(10000);
stalled.showBreak(first);
const reused = [stalled.glowWin, ...stalled.breakWins];
reused.forEach(win => win.finishLoading());
stalled.hideAll();
advance(30000);
stalled.showGlow(100000);
stalled.showBreak(first);
advance(30001);
assert.equal(reused.every(win => !win.isDestroyed()), true, 'Reusing the cache cancels its previous retirement deadline');
stalled.hideAll();
advance(60000);
assert.equal(reused.every(win => win.isDestroyed()), true);
stalled.showGlow(10000);
const crashed = stalled.glowWin;
crashed.finishLoading();
crashed.webContents.emit('render-process-gone');
assert.equal(crashed.isDestroyed(), true, 'A crashed glow renderer is discarded');
assert.equal(stalled.glowPointerTimer, null, 'A renderer crash stops pointer polling');
assert.equal(stalled.pendingLoads.size, 0);
assert.equal(timers.size, 0, 'Disposal leaves no pending main-process overlay timers');
let failedPaints = 0;
const failedPaint = new Overlay({ onDismiss: () => { failedPaints++; failedPaint.hideAll(); } });
failedPaint.register();
failedPaint.showBreak(first);
failedPaint.breakWins.forEach(win => win.finishLoading());
advance(5000);
assert.equal(failedPaints, 1, 'A renderer that never acknowledges painting cancels the invisible session');
assert.equal(failedPaint.pendingPaints.size, 0);
failedPaint.destroyBreak();
assert.equal(timers.size, 0);
console.log('Overlay tests passed: bounded load callbacks, idle disposal, reuse, crash cleanup, and stale-session protection');
