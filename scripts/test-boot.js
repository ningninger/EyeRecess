'use strict';
/**
 * 无 GUI 环境下的主进程联调测试。
 *
 * 这个沙箱跑不起来 Electron（Chromium 子进程建管道被拒），所以用一个假的
 * electron 模块 + 虚拟时钟，把 src/main/main.js 整个启动起来，快进 2 小时，
 * 验证：计时节奏、微/短/长休息触发、延后与提前结束、设置页 IPC、统计落盘。
 *
 * 用法： node scripts/test-boot.js
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const USER_DATA = path.join(ROOT, '.boot-test', 'userdata');
const APP_URL = require('url').pathToFileURL(path.join(ROOT, 'src', 'renderer', 'settings', 'index.html')).href;
const TRUSTED_ID = 4242; // 安全层要求 IPC 来自登记过的窗口，测试里用一个固定 id

/* ------------------------------- 虚拟时钟 -------------------------------- */

const realSetImmediate = setImmediate;
const realNow = Date.now;
let now = new Date('2026-10-22T09:00:00+08:00').getTime();
Date.now = () => now;

let timerSeq = 0;
const timers = new Map();
const state = { idle: 0, meeting: false };

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
      errors.push(`定时器回调抛错: ${e && e.stack ? e.stack.split('\n')[0] : e}`);
    }
    await flush();
  }
  now = target;
  await flush();
}

/* ------------------------------ 假 electron ------------------------------- */

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
      getURL() { return APP_URL; },
    },
    loadFile() { return Promise.resolve(); },
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
    destroy() { win.destroyed = true; win.emit('closed'); },
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
  return { sender: { id: TRUSTED_ID, getURL: () => APP_URL }, senderFrame: { url: APP_URL } };
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
    emit(ch, ...args) { (ipcOn.get(ch) || []).forEach((f) => f(fakeEvent(), ...args)); },
  },
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    getDisplayNearestPoint: () => displays[0],
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    on: () => undefined,
  },
  powerMonitor: {
    getSystemIdleTime: () => state.idle,
    getSystemIdleState: (t) => (state.idle >= t ? 'idle' : 'active'),
    on: () => undefined,
  },
  globalShortcut: { register: () => true, unregisterAll: () => undefined, isRegistered: () => true },
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

// 进程扫描要走真的 tasklist/ps —— 换成立即返回的空结果，否则 2 小时要跑几百次
const cp = require('child_process');
cp.execFile = (file, args, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb;
  const out = state.meeting ? '"zoom.exe","1234","Console","1","10,000 K"\n' : '';
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

/* -------------------------------- 断言工具 -------------------------------- */

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
  ok(a === b, `${label}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`);
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

/* ---------------------------------- 主流程 --------------------------------- */

async function main() {
  resetUserData();
  process.env.EYERECESS_USER_DATA = USER_DATA;
  process.env.EYERECESS_LOG_DIR = path.join(USER_DATA, 'logs'); // 测试的日志别写到真实 APPDATA
  delete process.env.ELECTRON_RUN_AS_NODE;

  // 让假事件带上一个已登记的窗口 id：安全层会校验 sender.id + 页面地址
  const security = require(path.join(ROOT, 'src/main/security.js'));
  security.trust({ id: TRUSTED_ID, once: () => undefined });

  require(path.join(ROOT, 'src/main/main.js'));
  await advance(0);

  section('启动');
  ok(tray.created, '托盘已创建');
  ok(String(tray.tooltip).startsWith('EyeRecess'), '托盘提示文字带应用名');
  ok(String(tray.tooltip).includes('微休息'), '托盘提示文字带下次休息时间');
  eq(ipcHandle.has('app:get-state'), true, 'IPC app:get-state 已注册');
  const st = await ipcHandle.get('app:get-state')(fakeEvent());
  eq(st.app.name, 'EyeRecess', '设置页能拿到应用名');
  eq(st.app.platform, process.platform, '平台字段');
  eq(typeof st.config.micro.every, 'number', '状态里带配置');

  section('微休息（连续用眼 10 分钟）');
  const t0 = now;
  await advance(9 * 60 * 1000);
  eq(glows().length, 0, '9 分钟还不到，没有提醒');
  const gotMicro = await advanceUntil(() => glows().length > 0, 3 * 60 * 1000);
  ok(gotMicro, '出现第一次呼吸光');
  const microAt = (now - t0) / 1000;
  ok(microAt >= 595 && microAt <= 615, `第一次微休息发生在 10 分钟（实际 ${microAt} 秒）`);
  eq(breaks((p) => p.kind === 'micro').length, 0, '第 1 次微休息不强制闭眼');

  section('第 3 次微休息强制闭眼');
  const gotForce = await advanceUntil(
    () => breaks((p) => p.kind === 'micro').length > 0,
    30 * 60 * 1000,
  );
  ok(gotForce, '累计用眼后出现强制闭眼遮罩');
  const microOv = breaks((p) => p.kind === 'micro')[0];
  ok(microOv.payload.ms >= 3000, '强制闭眼时长 >= 3s');
  eq(microOv.payload.canDefer, false, '强制闭眼不允许延后');
  ok(wins.some((w) => w.visible), '强制闭眼遮罩真的显示了');
  await advanceUntil(() => !wins.some((w) => w.visible), 60 * 1000);
  ok(!wins.some((w) => w.visible), '闭眼结束后遮罩自动收起');

  section('短休息（连续用眼 50 分钟）');
  const shortBeforeShort = breaks((p) => p.kind === 'short').length;
  await advanceUntil(() => breaks((p) => p.kind === 'short').length > shortBeforeShort, 40 * 60 * 1000);
  const shortOv = breaks((p) => p.kind === 'short');
  ok(shortOv.length > shortBeforeShort, '出现短休息遮罩');
  const first = shortOv[shortOv.length - 1].payload;
  eq(first.phase, 'eyes', '短休息从闭眼开始');
  eq(first.canDefer, true, '短休息可以延后 1 次');
  eq(first.allowEnd, false, '闭眼阶段不能提前结束');
  ok(wins.some((w) => w.visible), '遮罩窗口已显示');

  section('延后一次 → 5 分钟后再来 → 不能再延后');
  const deferAt = now;
  ipcMainEmit('overlay:action', { action: 'defer', token: first.token });
  await flush();
  ok(!wins.some((w) => w.visible), '遮罩已收起');
  const d1 = await ipcHandle.get('app:get-state')(fakeEvent());
  eq(d1.resting, false, '延后后不再处于休息状态');
  const n0 = shortOv.length;
  await advance(4 * 60 * 1000);
  eq(breaks((p) => p.kind === 'short').length, n0, '延后 4 分钟时还没来');
  await advanceUntil(() => breaks((p) => p.kind === 'short').length > n0, 4 * 60 * 1000);
  const again = breaks((p) => p.kind === 'short');
  ok(again.length > n0, '延后 5 分钟后又来了');
  const backIn = (now - deferAt) / 1000;
  ok(backIn >= 295 && backIn <= 320, `延后 5 分钟（实际 ${backIn} 秒）`);
  const second = again[again.length - 1].payload;
  eq(second.canDefer, false, '同一次休息不能延后第二次');
  eq(second.allowEnd, false, '闭眼阶段仍然不能提前结束');

  section('闭眼阶段走完 → 自动进入眨眼训练（可提前结束）');
  await advanceUntil(() => breaks((p) => p.phase === 'blink').length > 0, 3 * 60 * 1000);
  const blinkOv = breaks((p) => p.phase === 'blink');
  ok(blinkOv.length >= 1, '进入眨眼训练');
  eq(blinkOv[blinkOv.length - 1].payload.allowEnd, true, '眨眼训练可以提前结束');
  const stretchBefore = breaks((p) => p.phase === 'stretch').length;
  ipcMainEmit('overlay:action', { action: 'end', token: blinkOv[blinkOv.length - 1].payload.token });
  await flush();
  await advance(5 * 60 * 1000);
  eq(breaks((p) => p.phase === 'stretch').length, stretchBefore, '提前结束后不再进入下一步');
  ok(!wins.some((w) => w.visible), '提前结束后遮罩已收起');

  section('长休息（连续用眼 2 小时）');
  await advanceUntil(() => breaks((p) => p.kind === 'long').length > 0, 2.5 * 60 * 60 * 1000);
  const longOv = breaks((p) => p.kind === 'long');
  ok(longOv.length >= 1, '出现长休息遮罩');
  const lp = longOv[0].payload;
  eq(lp.phase, 'eyes', '长休息从闭眼开始');
  eq(lp.canDefer, true, '长休息可以延后');
  ipcMainEmit('overlay:action', { action: 'end', token: lp.token });
  await flush();

  section('会议中降级：只发光，不弹遮罩');
  state.meeting = true;
  await advance(16 * 1000); // 让进程扫描把降级状态读进来
  const glowBefore = glows().length;
  const microBreakBefore = breaks((p) => p.kind === 'micro').length;
  await advance(40 * 60 * 1000);
  ok(glows().length > glowBefore, '会议中仍然有呼吸光');
  eq(breaks((p) => p.kind === 'micro').length, microBreakBefore, '会议中不弹强制闭眼遮罩');
  state.meeting = false;
  await advance(16 * 1000);

  section('空闲：60 秒以上不累计、3 分钟以上视为已休息');
  state.idle = 200;
  const g0 = glows().length;
  const b0 = breaks().length;
  await advance(20 * 60 * 1000);
  eq(glows().length, g0, '长时间空闲不会弹提醒');
  eq(breaks().length, b0, '长时间空闲不会弹休息遮罩');
  state.idle = 0;

  section('落盘');
  await advance(10 * 1000);
  const cfgFile = path.join(USER_DATA, 'config.json');
  const statsFile = path.join(USER_DATA, 'stats.json');
  ok(fs.existsSync(statsFile), 'stats.json 已写入');
  const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  const today = stats.days[Object.keys(stats.days).sort().pop()];
  ok(today.activeSec > 0, '记录了有效用眼秒数');
  ok(today.micro > 0, '记录了微休息次数');
  ok(today.short + today.long > 0, '记录了长短休息次数');
  ok(fs.existsSync(cfgFile) === false, '没改配置就不写 config.json');

  section('设置页 IPC');
  const patched = await ipcHandle.get('app:patch')(fakeEvent(), { micro: { every: 420 } });
  eq(patched.config.micro.every, 420, '能改配置');
  const preset = await ipcHandle.get('app:preset')(fakeEvent(), 'dense');
  eq(preset.config.micro.every, 360, '能切预设');
  const paused = await ipcHandle.get('app:pause')(fakeEvent(), 30);
  ok(paused.paused, '能暂停 30 分钟');
  await ipcHandle.get('app:pause')(fakeEvent(), 0);
  const focus = await ipcHandle.get('app:focus')(fakeEvent(), 45);
  ok(focus.dnd.focusUntil > Date.now(), '能进入专注模式');
  const sb = await ipcHandle.get('app:start-break')(fakeEvent(), 'short');
  ok(sb.ok !== false, '能手动触发休息');

  section('退出');
  app.emit('before-quit');
  await flush();
  ok(true, 'before-quit 不抛错');

  /* ------------------------------- 汇总 ------------------------------- */
  console.log('\n' + '-'.repeat(52));
  if (errors.length) {
    console.log(`运行期异常 ${errors.length} 条：`);
    errors.slice(0, 10).forEach((e) => console.log('  ! ' + e));
  }
  if (fails.length) {
    console.log(`失败 ${fails.length} 项：`);
    fails.forEach((f) => console.log('  - ' + f));
    console.log(`通过 ${pass} 项`);
    process.exitCode = 1;
  } else {
    console.log(`全部通过：${pass} 项，运行期异常 ${errors.length} 条`);
  }
  Date.now = realNow;
  process.exit(process.exitCode || 0);
}

function ipcMainEmit(channel, payload) {
  electronStub.ipcMain.emit(channel, payload);
}

main().catch((e) => {
  console.error('测试崩了：', e);
  process.exit(1);
});
