'use strict';
// Main-process integration with a virtual clock and explicit Electron substitutes.

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.join(__dirname, '../..');
const USER_DATA = path.join(ROOT, '.boot-test', 'userdata');
const APP_URL = require('url').pathToFileURL(path.join(ROOT, 'src', 'renderer', 'settings', 'index.html')).href;
const TRUSTED_ID = 4242;
const TRUSTED_FRAME = { url: APP_URL };

const realSetImmediate = setImmediate;
const realNow = Date.now;
let now = new Date('2026-10-22T09:00:00+08:00').getTime();
Date.now = () => now;

let timerSeq = 0;
const timers = new Map();
const state = { idle: 0, meeting: false, shortcutFailure: false };

function addTimer(fn, delay, type, args) {
  const d = Math.max(0, Number(delay) || 0);
  const id = ++timerSeq;
  const handle = {
    id,
    unref() { return this; },
    ref() { return this; },
    hasRef() { return true; },
    refresh() { const t = timers.get(id); if (t) t.at = now + t.delay; return this; },
    close() { timers.delete(id); },
  };
  timers.set(id, { id, at: now + d, delay: d, fn, type, args, handle });
  return handle;
}

function clearTimer(handle) {
  if (handle == null) return;
  const id = typeof handle === 'object' ? handle.id : Number(handle);
  timers.delete(id);
}

global.setTimeout = (fn, d, ...args) => addTimer(fn, d, 'timeout', args);
global.setInterval = (fn, d, ...args) => addTimer(fn, d, 'interval', args);
global.setImmediate = (fn, ...args) => addTimer(fn, 0, 'timeout', args);
global.clearTimeout = clearTimer;
global.clearInterval = clearTimer;

const errors = [];

function flush() {
  return new Promise((r) => realSetImmediate(r));
}

async function advance(ms) {
  const target = now + ms;
  for (;;) {
    let next = null;
    for (const t of timers.values()) {
      if (t.at <= target && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
    }
    if (!next) break;
    now = Math.max(now, next.at);
    if (next.type === 'interval') next.at = now + Math.max(1, next.delay);
    else timers.delete(next.id);
    try {
      next.fn(...(next.args || []));
    } catch (e) {
      errors.push(`Timer callback failed: ${e && e.stack ? e.stack.split('\n')[0] : e}`);
    }
    await flush();
  }
  now = target;
  await flush();
}

const sends = []; // { win, channel, payload }
const wins = [];
const ipcOn = new Map();
const ipcHandle = new Map();
const tray = { menus: [], images: [], tooltip: '' };

function display(id, bounds, primary) {
  return { id, bounds, workArea: bounds, size: { width: bounds.width, height: bounds.height }, scaleFactor: 1, primary: !!primary, internal: false };
}
const displays = [
  display(1, { x: 0, y: 0, width: 1920, height: 1080 }, true),
  display(2, { x: 1920, y: 0, width: 1280, height: 720 }, false),
];

let winIdSeq = 0;

function makeWindow(opts = {}) {
  const win = {
    opts,
    destroyed: false,
    visible: false,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    listeners: {},
    webContents: {
      id: ++winIdSeq,
      send(channel, payload) { sends.push({ win, channel, payload }); },
      on() {},
      once() {},
      openDevTools() {},
      setWindowOpenHandler() {},
      isLoading() { return false; },
      mainFrame: { url: APP_URL },
      getURL() { return this.mainFrame.url; },
    },
    loadFile(file) { win.webContents.mainFrame.url = require('url').pathToFileURL(file).href; return Promise.resolve(); },
    loadURL() { return Promise.resolve(); },
    on(ev, fn) { (win.listeners[ev] || (win.listeners[ev] = [])).push(fn); return win; },
    once(ev, fn) { return win.on(ev, fn); },
    emit(ev, ...a) { (win.listeners[ev] || []).forEach((f) => f(...a)); },
    show() { win.visible = true; },
    showInactive() { win.visible = true; },
    hide() { win.visible = false; },
    focus() {},
    blur() {},
    isVisible() { return win.visible; },
    isDestroyed() { return win.destroyed; },
    destroy() { win.destroyed = true; win.visible = false; win.emit('closed'); },
    close() { win.destroy(); },
    setBounds(b) { win.bounds = { ...win.bounds, ...b }; },
    getBounds() { return win.bounds; },
    setAlwaysOnTop() {},
    setIgnoreMouseEvents() {},
    setVisibleOnAllWorkspaces() {},
    setSkipTaskbar() {},
    setFullScreenable() {},
    setFocusable() {},
    setHasShadow() {},
    setResizable() {},
    center() {},
    maximize() {},
    unmaximize() {},
    setMenuBarVisibility() {},
    removeMenu() {},
  };
  return new Proxy(win, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'string') return () => undefined;
      return undefined;
    },
  });
}

function fakeEvent() {
  return { sender: { id: TRUSTED_ID, mainFrame: TRUSTED_FRAME, getURL: () => APP_URL }, senderFrame: TRUSTED_FRAME };
}

const appListeners = {};
const app = {
  isPackaged: false,
  name: 'EyeRecess',
  getName: () => 'EyeRecess',
  getVersion: () => '0.1.0',
  getPath: (n) => (n === 'userData' ? USER_DATA : path.join(ROOT, '.boot-test', n)),
  setPath: () => undefined,
  setAppUserModelId: () => undefined,
  requestSingleInstanceLock: () => true,
  quit: () => { app.quitCalled = true; },
  exit: () => { app.quitCalled = true; },
  whenReady: () => Promise.resolve(),
  on(ev, fn) { (appListeners[ev] || (appListeners[ev] = [])).push(fn); return app; },
  once(ev, fn) { return app.on(ev, fn); },
  emit(ev, ...a) { (appListeners[ev] || []).forEach((f) => f(...a)); },
  setLoginItemSettings: () => undefined,
  getLoginItemSettings: () => ({ openAtLogin: false }),
  dock: { hide() {}, show() {}, setBadge() {} },
  isReady: () => true,
  disableHardwareAcceleration: () => undefined,
  commandLine: { appendSwitch: () => undefined },
};

function makeImage() {
  return {
    isEmpty: () => false,
    setTemplateImage: () => undefined,
    addRepresentation: () => undefined,
    resize: () => makeImage(),
    toPNG: () => Buffer.alloc(0),
    getSize: () => ({ width: 16, height: 16 }),
  };
}

const electronStub = {
  app,
  BrowserWindow: function BrowserWindow(opts) {
    const w = makeWindow(opts);
    wins.push(w);
    return w;
  },
  Tray: class Tray {
    constructor(image) {
      this.image = image;
      tray.created = true;
    }
    setToolTip(t) { tray.tooltip = t; }
    setContextMenu(m) { tray.menu = m; tray.menus.push(m); }
    setImage(i) { tray.images.push(i); }
    setTitle() {}
    popUpContextMenu() { tray.popped = (tray.popped || 0) + 1; }
    on() { return this; }
    destroy() { tray.destroyed = true; }
    isDestroyed() { return Boolean(tray.destroyed); }
  },
  Menu: {
    buildFromTemplate: (tpl) => ({ items: tpl }),
    setApplicationMenu: () => undefined,
    getApplicationMenu: () => null,
  },
  ipcMain: {
    on(ch, fn) { (ipcOn.get(ch) || ipcOn.set(ch, []).get(ch)).push(fn); },
    handle(ch, fn) { ipcHandle.set(ch, fn); },
    removeHandler(ch) { ipcHandle.delete(ch); },
    emit(ch, ...args) {
      const win = wins.find((win) => win.visible && win.opts.focusable === true && !win.destroyed);
      const event = ch === 'overlay:action' && win ? { sender: win.webContents, senderFrame: win.webContents.mainFrame } : fakeEvent();
      (ipcOn.get(ch) || []).forEach((f) => f(event, ...args));
    },
  },
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getDisplayNearestPoint: () => displays[0],
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    listeners: {},
    on(event, fn) { (this.listeners[event] ||= []).push(fn); },
    emit(event) { (this.listeners[event] || []).forEach((fn) => fn()); },
  },
  powerMonitor: {
    getSystemIdleTime: () => state.idle,
    getSystemIdleState: (t) => (state.idle >= t ? 'idle' : 'active'),
    listeners: {},
    on(event, fn) { (this.listeners[event] ||= []).push(fn); },
    emit(event) { (this.listeners[event] || []).forEach((fn) => fn()); },
  },
  globalShortcut: {
    register() { if (state.shortcutFailure) throw new Error('Expected platform failure'); return true; },
    unregisterAll: () => undefined, isRegistered: () => true,
  },
  shell: { beep: () => undefined, openExternal: () => Promise.resolve(), showItemInFolder: () => undefined },
  session: {
    defaultSession: {
      setPermissionRequestHandler: () => undefined,
      setPermissionCheckHandler: () => undefined,
      setDevicePermissionHandler: () => undefined,
      setSpellCheckerEnabled: () => undefined,
      webRequest: { onBeforeRequest: () => undefined },
    },
  },
  nativeImage: { createFromPath: () => makeImage(), createEmpty: () => makeImage() },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
};

const origLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return origLoad.apply(this, arguments);
};

//   win32   tasklist /fo csv /nh  ->  "zoom.exe","1234","Console",...
//   darwin  ps -Ao comm=          ->  /Applications/zoom.us.app/Contents/MacOS/zoom.us
//   linux   ps -Ao comm=          ->  zoom
const cp = require('child_process');
cp.execFile = (file, args, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb;
  let out = '';
  if (state.meeting) {
    if (process.platform === 'win32') {
      out = '"zoom.exe","1234","Console","1","10,000 K"\n"explorer.exe","5678","Console","1","20,000 K"\n';
    } else if (process.platform === 'darwin') {
      out = '/Applications/zoom.us.app/Contents/MacOS/zoom.us\n/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder\n';
    } else {
      out = 'zoom\ncode\n';
    }
  }
  if (done) done(null, out, '');
  return { on() {}, kill() {} };
};

async function advanceUntil(pred, maxMs) {
  const start = now;
  while (now - start <= maxMs) {
    if (pred()) return true;
    await advance(1000);
  }
  return pred();
}

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) {
    pass++;
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}`);
  }
}
function eq(a, b, label) {
  ok(a === b, `${label} (expected ${JSON.stringify(b)}, received ${JSON.stringify(a)})`);
}
function section(t) {
  console.log(`\n${t}`);
}

function resetUserData() {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
}

function breaks(pred) {
  return sends.filter((s) => s.channel === 'overlay:break' && (!pred || pred(s.payload)));
}
function glows() {
  return sends.filter((s) => s.channel === 'overlay:glow');
}

async function main() {
  resetUserData();
  process.env.EYERECESS_USER_DATA = USER_DATA;
  process.env.EYERECESS_LOG_DIR = path.join(USER_DATA, 'logs');
  delete process.env.ELECTRON_RUN_AS_NODE;

  const security = require(path.join(ROOT, 'src/main/security.js'));
  security.trust({ id: TRUSTED_ID, once: () => undefined });

  require(path.join(ROOT, 'src/main/main.js'));
  await advance(0);

  section('Startup');
  ok(tray.created, 'Tray is created');
  ok(String(tray.tooltip).startsWith('EyeRecess'), 'Tray tooltip includes the application name');
  ok(String(tray.tooltip).includes('\u5fae\u4f11\u606f'), 'Tray tooltip includes the next reminder');
  eq(ipcHandle.has('app:get-state'), true, 'State IPC handler is registered');
  const st = await ipcHandle.get('app:get-state')(fakeEvent());
  eq(st.app.name, 'EyeRecess', 'Settings state includes the app name');
  eq(st.app.canHideDock, process.platform === 'darwin', 'Settings receive the required Dock capability');
  eq(Object.keys(st.app).sort().join(','), 'canHideDock,canLaunchAtLogin,name,version', 'Settings metadata excludes paths and runtime diagnostics');
  eq(st.app.canLaunchAtLogin, false, 'Source builds never offer login integration');
  eq(typeof st.config.micro.every, 'number', 'State includes configuration');

  section('Micro reminder after ten active minutes');
  const t0 = now;
  await advance(9 * 60 * 1000);
  eq(glows().length, 0, 'No reminder before ten active minutes');
  const gotMicro = await advanceUntil(() => glows().length > 0, 3 * 60 * 1000);
  ok(gotMicro, 'First glow is shown');
  eq(glows()[0].payload.ms, st.config.micro.len * 1000, 'Glow uses the configured micro duration');
  const microAt = (now - t0) / 1000;
  ok(microAt >= 595 && microAt <= 615, `First micro reminder occurs at ten minutes: ${microAt} seconds`);
  eq(breaks((p) => p.kind === 'micro').length, 0, 'First micro reminder does not force eye closure');

  section('Third micro reminder forces eye closure');
  const gotForce = await advanceUntil(
    () => breaks((p) => p.kind === 'micro').length > 0,
    30 * 60 * 1000,
  );
  ok(gotForce, 'Forced eye-closure overlay follows accumulated activity');
  const microOv = breaks((p) => p.kind === 'micro')[0];
  ok(microOv.payload.ms >= 3000, 'Forced eye closure lasts at least three seconds');
  eq(microOv.payload.canDefer, false, 'Forced eye closure cannot be deferred');
  ok(wins.some((w) => w.visible), 'Forced eye-closure overlay is visible');
  await advanceUntil(() => !wins.some((w) => w.visible), 60 * 1000);
  ok(!wins.some((w) => w.visible), 'Overlay hides after eye closure');
  const forcedStats = (await ipcHandle.get('app:get-state')(fakeEvent())).stats.today;
  eq(forcedStats.micro, 3, 'Micro total includes completed forced breaks');
  eq(forcedStats.forced, 1, 'Forced completions are counted separately');

  section('Short break after fifty active minutes');
  const shortBeforeShort = breaks((p) => p.kind === 'short').length;
  await advanceUntil(() => breaks((p) => p.kind === 'short').length > shortBeforeShort, 40 * 60 * 1000);
  const shortOv = breaks((p) => p.kind === 'short');
  ok(shortOv.length > shortBeforeShort, 'Short-break overlay is shown');
  const first = shortOv[shortOv.length - 1].payload;
  eq(first.phase, 'eyes', 'Short break begins with eye closure');
  eq(first.canDefer, true, 'Short break permits one deferral');
  eq(first.allowEnd, true, 'Eye closure always allows exit');
  ok(wins.some((w) => w.visible), 'Break overlay is visible');

  section('One deferral retries after five minutes without another allowance');
  const deferAt = now;
  ipcMainEmit('overlay:action', { action: 'defer', token: first.token });
  await flush();
  ok(!wins.some((w) => w.visible), 'Overlay is hidden');
  const d1 = await ipcHandle.get('app:get-state')(fakeEvent());
  eq(d1.resting, false, 'Deferral ends the active session');
  const n0 = shortOv.length;
  await advance(4 * 60 * 1000);
  eq(breaks((p) => p.kind === 'short').length, n0, 'Deferred break does not return within four minutes');
  await advanceUntil(() => breaks((p) => p.kind === 'short').length > n0, 4 * 60 * 1000);
  const again = breaks((p) => p.kind === 'short');
  ok(again.length > n0, 'Deferred break returns after five minutes');
  const backIn = (now - deferAt) / 1000;
  ok(backIn >= 295 && backIn <= 320, `Deferral lasts five minutes: ${backIn} seconds`);
  const second = again[again.length - 1].payload;
  eq(second.canDefer, false, 'The same break cannot be deferred twice');
  eq(second.allowEnd, true, 'Exit remains available after the deferral allowance is exhausted');
  ipcMainEmit('overlay:action', { action: 'defer', token: second.token });
  await flush();
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).resting, true, 'Main process rejects deferral beyond its allowance');

  section('Eye closure advances to blinking with early end available');
  await advanceUntil(() => breaks((p) => p.phase === 'blink').length > 0, 3 * 60 * 1000);
  const blinkOv = breaks((p) => p.phase === 'blink');
  ok(blinkOv.length >= 1, 'Blinking phase begins');
  eq(blinkOv[blinkOv.length - 1].payload.allowEnd, true, 'Blinking permits early end');
  const stretchBefore = breaks((p) => p.phase === 'stretch').length;
  ipcMainEmit('overlay:action', { action: 'end', token: blinkOv[blinkOv.length - 1].payload.token });
  await flush();
  await advance(30 * 1000);
  eq(breaks((p) => p.phase === 'stretch').length, stretchBefore, 'Early end prevents later phases');
  ok(!wins.some((w) => w.visible), 'Early end hides the overlay');

  section('Long break after two active hours');
  await advanceUntil(() => breaks((p) => p.kind === 'long').length > 0, 2.5 * 60 * 60 * 1000);
  const longOv = breaks((p) => p.kind === 'long');
  ok(longOv.length >= 1, 'Long-break overlay is shown');
  const lp = longOv[0].payload;
  eq(lp.phase, 'eyes', 'Long break begins with eye closure');
  eq(lp.canDefer, true, 'Long break permits deferral');
  await advance(lp.ms);
  ipcMainEmit('overlay:action', { action: 'end', token: lp.token });
  await flush();

  section('Meeting reduction uses glow without overlays');
  state.meeting = true;
  await advance(16 * 1000);
  const glowBefore = glows().length;
  const microBreakBefore = breaks((p) => p.kind === 'micro').length;
  const allBreaksBefore = breaks().length;
  await advance(140 * 60 * 1000);
  ok(glows().length > glowBefore, 'Meetings still receive a glow');
  eq(breaks((p) => p.kind === 'micro').length, microBreakBefore, 'Meetings do not force micro eye closure');
  eq(breaks().length, allBreaksBefore, 'Meetings crossing short and long thresholds do not show overlays');
  state.meeting = false;
  await advance(16 * 1000);

  section('Idle periods pause activity and reset work counters');
  state.idle = 200;
  const g0 = glows().length;
  const b0 = breaks().length;
  await advance(20 * 60 * 1000);
  eq(glows().length, g0, 'Long idle periods do not show glows');
  eq(breaks().length, b0, 'Long idle periods do not show break overlays');
  state.idle = 0;

  section('Persistence');
  await advance(10 * 1000);
  const cfgFile = path.join(USER_DATA, 'config.json');
  const statsFile = path.join(USER_DATA, 'stats.json');
  ok(fs.existsSync(statsFile), 'Statistics are persisted');
  const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  const today = stats.days[Object.keys(stats.days).sort().pop()];
  ok(today.activeSec > 0, 'Active seconds are recorded');
  ok(today.micro > 0, 'Micro reminders are recorded');
  ok(today.short + today.long > 0, 'Completed short or long breaks are recorded');
  ok(fs.existsSync(cfgFile) === false, 'Unchanged configuration is not written');

  section('Settings IPC');
  await ipcHandle.get('app:patch')(fakeEvent(), { system: { shortcuts: false } });
  state.shortcutFailure = true;
  const shortcutFallback = await ipcHandle.get('app:patch')(fakeEvent(), { system: { shortcuts: true } });
  eq(shortcutFallback.config.system.shortcuts, true, 'Unavailable native shortcuts do not break settings persistence');
  state.shortcutFailure = false;
  for (const bad of [Infinity, -1, '30', {}, 1441]) {
    const invalid = await ipcHandle.get('app:pause')(fakeEvent(), bad);
    eq(invalid.paused, false, 'Invalid pause payloads do not change state');
  }
  const patched = await ipcHandle.get('app:patch')(fakeEvent(), { micro: { every: 420 } });
  eq(patched.config.micro.every, 420, 'Configuration can be patched');
  eq(patched.config.preset, 'custom', 'Custom schedule is reflected in settings state');
  const preset = await ipcHandle.get('app:preset')(fakeEvent(), 'dense');
  eq(preset.config.micro.every, 360, 'Presets can be selected');
  await ipcHandle.get('app:patch')(fakeEvent(), {
    micro: { message: 'Look outside', enabled: false },
    dnd: { meetingDowngrade: false },
  });
  const rejectedReset = await ipcHandle.get('app:reset-plan')({
    sender: { id: -1, getURL: () => APP_URL }, senderFrame: { url: APP_URL },
  });
  eq(rejectedReset, null, 'Untrusted renderers cannot reset a plan');
  const reset = await ipcHandle.get('app:reset-plan')(fakeEvent());
  eq(reset.config.micro.enabled, true, 'Reset enables recommended reminders');
  eq(reset.config.micro.message, '', 'Reset clears personalized hints');
  eq(reset.config.dnd.meetingDowngrade, false, 'Reset preserves quiet preferences');
  const persistedReset = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  eq(persistedReset.preset, 'standard', 'Reset is written to local storage through IPC');
  const paused = await ipcHandle.get('app:pause')(fakeEvent(), 30);
  ok(paused.paused, 'Pause is active for thirty minutes');
  const resumed = await ipcHandle.get('app:pause')(fakeEvent(), 0);
  eq(resumed.paused, false, 'Pause can be cleared');
  const focus = await ipcHandle.get('app:focus')(fakeEvent(), 45);
  ok(focus.dnd.focusUntil > Date.now(), 'Focus mode can be enabled');
  const focusExit = tray.menu.items.find(item => item.label === '\u7ed3\u675f\u4e13\u6ce8');
  ok(focusExit, 'The tray offers an exit from manual focus');
  focusExit.click();
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).dnd.focusUntil, 0, 'Tray exit clears manual focus');
  await ipcHandle.get('app:focus')(fakeEvent(), 45);
  const sb = await ipcHandle.get('app:start-break')(fakeEvent(), 'short');
  eq(sb.resting, true, 'Manual breaks are available during focus');

  section('Display changes and window dismissal');
  const activeWindow = wins.find((win) => win.visible && win.opts.focusable === true);
  const overlayEvent = { sender: activeWindow.webContents, senderFrame: activeWindow.webContents.mainFrame };
  eq(await ipcHandle.get('app:reset-plan')(overlayEvent), null, 'Overlay renderers cannot invoke settings actions');
  const deadline = breaks().at(-1).payload.endsAt;
  electronStub.screen.emit('display-metrics-changed');
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).resting, true, 'Display changes preserve the current session');
  eq(breaks().at(-1).payload.endsAt, deadline, 'Display changes do not restart the phase timer');
  ok(wins.some((win) => !win.destroyed && win.visible), 'Display changes restore the visible overlay');
  wins.find((win) => win.visible && win.opts.focusable === true && !win.destroyed).close();
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).resting, false, 'Closing the interactive overlay cancels the session');
  ok(!wins.some((win) => win.visible && !win.destroyed), 'Dismissing one overlay hides all screens');
  await ipcHandle.get('app:start-break')(fakeEvent(), 'short');

  section('Lock and session cleanup');
  const completedBeforeLock = sb.stats.today.short;
  const obsoleteToken = breaks().at(-1).payload.token;
  electronStub.powerMonitor.emit('lock-screen');
  await flush();
  const locked = await ipcHandle.get('app:get-state')(fakeEvent());
  eq(locked.resting, false, 'Locking ends the active session');
  eq(locked.progress.micro, 0, 'Locking resets counters');
  ok(!wins.some((win) => win.visible), 'Locking hides all overlays');
  await advance(4 * 60 * 1000);
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).stats.today.short, completedBeforeLock, 'Cancelled sessions never record a later completion');
  await ipcHandle.get('app:start-break')(fakeEvent(), 'short');
  ipcMainEmit('overlay:action', { action: 'defer', token: obsoleteToken });
  await flush();
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).resting, true, 'Stale actions cannot affect a new session');

  section('Quit');
  app.emit('before-quit');
  await flush();
  eq((await ipcHandle.get('app:get-state')(fakeEvent())).resting, false, 'Quitting clears the active session');
  ok(!wins.some((win) => win.visible), 'Quitting hides all overlays');

  console.log('\n' + '-'.repeat(52));
  if (errors.length) {
    console.log(`Runtime errors: ${errors.length}`);
    errors.slice(0, 10).forEach((e) => console.log('  ! ' + e));
  }
  if (fails.length || errors.length) {
    console.log(`Failed assertions: ${fails.length}`);
    fails.forEach((f) => console.log('  - ' + f));
    console.log(`Passed assertions: ${pass}`);
    process.exitCode = 1;
  } else {
    console.log(`Passed assertions: ${pass}; runtime errors: ${errors.length}`);
  }
  Date.now = realNow;
  process.exit(process.exitCode || 0);
}

function ipcMainEmit(channel, payload) {
  electronStub.ipcMain.emit(channel, payload);
}

main().catch((e) => {
  console.error('Test harness failed:', e);
  process.exit(1);
});
