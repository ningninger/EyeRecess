'use strict';
/**
 * EyeRecess 主进程。
 *
 * 分工：
 *  config.js  ｜ 参数与预设
 *  tracker.js ｜ 只算「有效用眼时间」，决定什么时候该提醒
 *  breaks 逻辑在这里｜ 提醒怎么打断（L0 发光 / L2 遮罩 / L3 强遮罩）
 *  overlay.js ｜ 全屏覆盖层窗口
 *  dnd.js     ｜ 勿扰时段 + 会议软件降级
 *  stats.js   ｜ 本地统计
 */

const path = require('path');
const log = require('./log');
const security = require('./security');

/* ------ 第一件事：把日志开起来。放在 require('electron') 之前，         ------ */
/* ------ 这样即使进程马上死掉，磁盘上也有一行「我启动过」。            ------ */
log.init(null);
log.install();
log.boot('==================== EyeRecess 启动 ====================');
log.boot('argv:', process.argv.slice(1).join(' ') || '(无参数)');
log.boot('node:', process.versions.node, ' electron:', process.versions.electron || '(不是 Electron 进程)');
log.boot('平台:', `${process.platform} ${process.arch}`, ' 日志文件:', log.path() || '(写不了)');

const electron = require('electron');

// 如果 ELECTRON_RUN_AS_NODE 之类的环境变量在起作用，Electron 会把主进程当普通
// Node 脚本跑：require('electron') 返回的是应用路径字符串，app 根本不存在，
// 表现就是「窗口闪一下就没了」。这里把它变成一句能看懂的报错。
if (typeof electron === 'string' || !electron || !electron.app) {
  log.error('致命：Electron 没有以 GUI 模式运行，require("electron") 拿到的是', typeof electron);
  log.error('最常见原因：环境变量 ELECTRON_RUN_AS_NODE 被设置成了 1。');
  console.error('');
  console.error('  [EyeRecess] 启动失败：当前被当成普通 Node.js 脚本执行了，不是图形程序。');
  console.error('  [EyeRecess] 请先清掉环境变量 ELECTRON_RUN_AS_NODE 再重试：');
  console.error('            PowerShell:  Remove-Item env:ELECTRON_RUN_AS_NODE');
  console.error('');
  process.exit(2);
}

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  powerMonitor,
  globalShortcut,
  shell,
} = electron;

// 开发与自动化测试时可以把配置目录重定向到项目内，避免写系统目录
if (process.env.EYERECESS_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.EYERECESS_USER_DATA));
}

log.init(app); // 拿到 app 之后把日志落到真正的 userData 目录

const { Store, PRESETS } = require('./config');
const { Tracker } = require('./tracker');
const { Stats } = require('./stats');
const { Dnd } = require('./dnd');
const { Overlay } = require('./overlay');
const icons = require('./icons');

const SMOKE = process.argv.includes('--smoke');
const FAST = process.argv.includes('--fast');

// 把崩溃类事件也记下来：这些是「窗口闪一下就没了」的典型来源
app.on('child-process-gone', (_e, details) => {
  log.error('子进程消失:', details && details.type, details && details.reason, details && details.exitCode);
});
app.on('render-process-gone', (_e, _wc, details) => {
  log.error('渲染进程消失:', details && details.reason, details && details.exitCode);
});


let store;
let cfg;
let tracker;
let stats;
let dnd;
let overlay;

let tray = null;
let trayState = '';
let lastMenuBuild = 0;
let settingsWin = null;

let resting = false;
let session = null; // { kind, token }
let pendingResolve = null;
let breakToken = 0;
// 本轮「延后额度」用掉多少次（真休息完一次就回满，见 finishBreak）
const deferUsed = { micro: 0, short: 0, long: 0 };

let lastTick = Date.now();
let lastPush = 0;
let tickTimer = null;
let quitting = false;
let wasSilent = false;

/* ---------------------------------- 工具 ---------------------------------- */

function safeIdle() {
  try {
    return powerMonitor.getSystemIdleTime();
  } catch {
    return 0;
  }
}

function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

function isPaused() {
  return cfg.pausedUntil > Date.now();
}

/* -------------------------------- 休息计划 -------------------------------- */

function buildPlan(kind, c) {
  if (kind === 'micro') {
    return [
      {
        id: 'eyes',
        label: '闭眼休息',
        sub: '只闭着，别睁眼',
        ms: Math.max(3, c.micro.forceLen) * 1000,
        canDefer: false,
      },
    ];
  }
  if (kind === 'short') {
    const out = [];
    if (c.short.phases.eyes > 0) {
      out.push({
        id: 'eyes',
        label: '闭眼',
        sub: '什么都别看，就闭着',
        ms: c.short.phases.eyes * 1000,
        canDefer: true,
      });
    }
    if (c.short.phases.blink > 0) {
      out.push({
        id: 'blink',
        label: '眨眼训练',
        sub: '跟着节奏：闭 · 闭 · 挤',
        ms: c.short.phases.blink * 1000,
        allowEnd: true,
      });
    }
    if (c.short.phases.stretch > 0) {
      out.push({
        id: 'stretch',
        label: '起身 / 远眺',
        sub: '站起来走两步，或者看看 6 米外',
        ms: c.short.phases.stretch * 1000,
        allowEnd: true,
      });
    }
    return out;
  }
  const eyes = Math.min(c.long.eyes, c.long.len);
  return [
    {
      id: 'eyes',
      label: '长休息',
      sub: '闭眼一分钟，然后离开工位',
      ms: eyes * 1000,
      canDefer: true,
    },
    {
      id: 'away',
      label: '离开屏幕',
      sub: '走一走、喝口水、看看远处。屏幕黑着就对了',
      ms: Math.max(3, c.long.len - eyes) * 1000,
      allowEnd: true,
    },
  ];
}

/* --------------------------------- 提醒逻辑 -------------------------------- */

function onDue(kind) {
  stats.add('reminded');
  if (kind === 'micro') return handleMicro();
  return startBreak(kind);
}

function handleMicro() {
  const wantForce = tracker.shouldForceMicro();
  const downgraded = dnd.isDowngraded(cfg);

  if (wantForce && !downgraded) {
    // 「不可无限拒绝」：每 N 次微休息里强制一次真闭眼
    return startBreak('micro');
  }

  tracker.noteMicroPassed();
  stats.add('micro');
  // 微休息的提示就是那圈呼吸光。用户若只关了声音，仍要发光；
  // 若连发光都关了，则退化成一次更短的闪光——绝不能「计时器清零但屏幕上什么都没发生」。
  if (cfg.ui.glow) overlay.showGlow(12000);
  else if (!cfg.ui.sound) overlay.showGlow(6000);
  if (cfg.ui.sound) shell.beep();
  tracker.consume('micro');
  pushState();
  return undefined;
}

function startBreak(kind) {
  if (resting) return;
  overlay.hideGlow();
  resting = true;
  const token = ++breakToken;
  session = { kind, token };
  const plan = buildPlan(kind, cfg);
  runPhases(kind, token, plan);
  updateTray(true);
  pushState();
}

async function runPhases(kind, token, plan) {
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (!session || session.token !== token) return;
    const canDefer =
      Boolean(p.canDefer) && (cfg[kind] ? cfg[kind].defer > deferUsed[kind] : false);
    overlay.showBreak({
      token,
      kind,
      phase: p.id,
      label: p.label,
      sub: p.sub,
      ms: p.ms,
      endsAt: Date.now() + p.ms,
      index: i,
      total: plan.length,
      canDefer,
      allowEnd: Boolean(p.allowEnd),
      deferMin: (cfg[kind] && cfg[kind].deferMinutes) || 5,
      dim: cfg.ui.dim,
    });
    const why = await waitPhase(p.ms, token);
    if (!session || session.token !== token) return;
    if (why === 'defer') return doDefer(kind);
    if (why === 'end') return finishBreak(kind);
    if (why === 'skip') return doSkip(kind);
    if (why === 'abort') return endSession();
  }
  if (!session || session.token !== token) return;
  finishBreak(kind);
}

function waitPhase(ms, token) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (session && session.token === token) {
        pendingResolve = null;
        resolve('timeout');
      }
    }, ms);
    pendingResolve = (why) => {
      clearTimeout(timer);
      pendingResolve = null;
      resolve(why);
    };
  });
}

function handleOverlayAction(action, token) {
  if (!session || session.token !== token) return;
  if (action === 'defer') return void pendingResolve?.('defer');
  if (action === 'end') return void pendingResolve?.('end');
  if (action === 'skip') return void pendingResolve?.('skip');
  return undefined;
}

function doSkip(kind) {
  // 跳过：不算休息，也不消耗「延后」额度，但只给 2 分钟喘息，马上再来
  stats.add('skip');
  tracker.deferFor(kind, 120);
  stats.save();
  endSession();
}

function doDefer(kind) {
  stats.add('defer');
  deferUsed[kind] = (deferUsed[kind] || 0) + 1;
  const minutes = (cfg[kind] && cfg[kind].deferMinutes) || 5;
  tracker.deferFor(kind, minutes * 60);
  stats.save();
  endSession();
}

function finishBreak(kind) {
  tracker.consume(kind);
  // 真休息过了 → 该档的「延后额度」回满
  deferUsed[kind] = 0;
  if (kind === 'micro') {
    stats.add('forced');
    tracker.resetMicroCycle();
  } else {
    stats.add(kind);
  }
  stats.save();
  if (cfg.ui.sound) shell.beep();
  endSession();
}

function endSession() {
  session = null;
  resting = false;
  pendingResolve = null;
  overlay.hideBreak();
  lastTick = Date.now();
  updateTray(true);
  pushState();
}

/* ---------------------------------- 计时 ---------------------------------- */

function onTick() {
  const now = Date.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!(dt > 0)) return;
  if (dt > 5) dt = 1; // 睡眠/卡死回来，不补算

  dnd.scan();

  const idle = safeIdle();
  const silent = dnd.isSilent(cfg) || isPaused();
  const paused = resting;

  // 免打扰刚结束：不补发，只留 3 分钟缓冲
  if (wasSilent && !silent) tracker.clampAfterDnd();
  wasSilent = silent;

  const due = tracker.tick(dt, idle, { paused, silent });
  if (tracker.lastAccumulated > 0) stats.addActive(tracker.lastAccumulated);

  if (due) onDue(due);

  updateTray();
  if (now - lastPush > 4000) {
    lastPush = now;
    pushState();
  }
}

function startTicking() {
  lastTick = Date.now();
  clearInterval(tickTimer);
  tickTimer = setInterval(onTick, 1000);
}

/* ----------------------------------- 托盘 ---------------------------------- */

function updateTray(force = false) {
  if (!tray) return;
  const p = tracker.progress();
  const state = resting ? 'rest' : tracker.due ? 'due' : 'idle';
  if (state !== trayState) {
    trayState = state;
    try {
      tray.setImage(icons.trayImage(state));
    } catch {
      /* 忽略 */
    }
  }
  const tip = resting
    ? 'EyeRecess · 正在休息'
    : isPaused()
      ? `EyeRecess · 已暂停（${Math.ceil((cfg.pausedUntil - Date.now()) / 60000)} 分钟）`
      : `EyeRecess · 连续用眼 ${fmtDur(p.streak)}，${fmtDur(p.microLeft)}后微休息`;
  tray.setToolTip(tip);

  if (force || Date.now() - lastMenuBuild > 15000) {
    lastMenuBuild = Date.now();
    try {
      tray.setContextMenu(buildMenu());
    } catch {
      /* 忽略 */
    }
  }
}

function buildMenu() {
  const p = tracker.progress();
  const paused = isPaused();
  const presetItems = Object.entries(PRESETS).map(([key, v]) => ({
    label: v.label,
    type: 'radio',
    checked: cfg.preset === key,
    click: () => {
      cfg = store.usePreset(key);
      applyConfig();
      updateTray(true);
      pushState();
    },
  }));

  return Menu.buildFromTemplate([
    {
      label: `连续用眼 ${fmtDur(p.streak)} · ${fmtDur(p.microLeft)}后微休息`,
      enabled: false,
    },
    {
      label: `短休息 ${fmtDur(p.shortLeft)} · 长休息 ${fmtDur(p.longLeft)}`,
      enabled: false,
    },
    { type: 'separator' },
    { label: '现在休息 3 分钟', click: () => startBreak('short') },
    { label: '长休息 10 分钟', click: () => startBreak('long') },
    { type: 'separator' },
    paused
      ? {
          label: '恢复计时',
          click: () => {
            cfg = store.patch({ pausedUntil: 0 });
            applyConfig();
            updateTray(true);
            pushState();
          },
        }
      : { label: '暂停 30 分钟', click: () => togglePause(30) },
    { label: '专注 / 开会 60 分钟', click: () => setFocus(60) },
    { type: 'separator' },
    { label: '休息方案', submenu: presetItems },
    { label: dnd.describe(cfg), enabled: false },
    { type: 'separator' },
    {
      label: '打开日志文件夹',
      click: () => {
        const d = log.dir();
        if (d) shell.openPath(d);
      },
    },
    { label: '设置…', click: () => openSettings() },
    { label: '今日统计', click: () => openSettings('stats') },
    { type: 'separator' },
    { label: '退出 EyeRecess', click: () => quitApp() },
  ]);
}

function createTray() {
  tray = new Tray(icons.trayImage('idle'));
  tray.setToolTip('EyeRecess');
  tray.setContextMenu(buildMenu());
  trayState = 'idle';
  if (process.platform === 'darwin') {
    // macOS：点图标自动弹菜单，双击开设置（setContextMenu 不会抢占左键）
    tray.on('double-click', () => openSettings());
  } else if (process.platform === 'linux') {
    // Linux：部分桌面环境不认 setContextMenu，需要手动补一次左键
    tray.on('click', () => {
      try {
        tray.popUpContextMenu();
      } catch {
        /* 忽略 */
      }
    });
  }
  // Windows：setContextMenu 已让左键自动弹菜单，再手动 popUp 会弹两个，不要补
}

function togglePause(minutes) {
  if (isPaused()) {
    cfg = store.patch({ pausedUntil: 0 });
  } else {
    cfg = store.patch({ pausedUntil: Date.now() + minutes * 60000 });
  }
  applyConfig();
  updateTray(true);
  pushState();
}

function setFocus(minutes) {
  dnd.startFocus(minutes);
  updateTray(true);
  pushState();
}

/* --------------------------------- 设置窗口 -------------------------------- */

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('ui:scroll-to', section);
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 780,
    minWidth: 460,
    minHeight: 560,
    title: 'EyeRecess 课间',
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.js'),
      // 安全基线：页面拿不到 Node，渲染进程跑在系统沙箱里
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      disableDialogs: true,
    },
  });
  security.trust(settingsWin.webContents);
  settingsWin.loadFile(path.join(__dirname, '../renderer/settings/index.html'), {
    query: section ? { section } : {},
  });
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    if (section) settingsWin.webContents.send('ui:scroll-to', section);
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
  return settingsWin;
}

function pushState() {
  if (!settingsWin || settingsWin.isDestroyed() || settingsWin.webContents.isLoading()) return;
  settingsWin.webContents.send('app:state', getState());
}

function getState() {
  const p = tracker.progress();
  return {
    config: cfg,
    presets: Object.fromEntries(
      Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, hint: v.hint }])
    ),
    stats: stats.snapshot(),
    progress: p,
    dnd: {
      label: dnd.describe(cfg),
      meeting: dnd.meetingRunning,
      focusUntil: dnd.focusUntil,
      quiet: dnd.inQuietHours(cfg),
    },
    resting,
    paused: isPaused(),
    pauseLeft: isPaused() ? Math.ceil((cfg.pausedUntil - Date.now()) / 60000) : 0,
    app: {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      configDir: app.getPath('userData'),
      electron: process.versions.electron,
    },
  };
}

/* ---------------------------------- IPC ----------------------------------- */

/* IPC 只接受我们自己创建的窗口发来的消息，别的来源一律忽略并记日志 */
function handleIpc(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!security.assertTrusted(event)) {
      log.warn('忽略了来源不明的 IPC 调用:', channel);
      return null;
    }
    return fn(event, ...args);
  });
}

function onIpc(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!security.assertTrusted(event)) {
      log.warn('忽略了来源不明的 IPC 消息:', channel);
      return;
    }
    fn(event, ...args);
  });
}

function registerIpc() {
  handleIpc('app:get-state', () => getState());

  handleIpc('app:patch', (_e, partial) => {
    cfg = store.patch(partial || {});
    applyConfig();
    updateTray(true);
    return getState();
  });

  handleIpc('app:preset', (_e, name) => {
    cfg = store.usePreset(name);
    applyConfig();
    updateTray(true);
    return getState();
  });

  handleIpc('app:pause', (_e, minutes) => {
    togglePause(minutes || 30);
    return getState();
  });

  handleIpc('app:focus', (_e, minutes) => {
    if (minutes > 0) dnd.startFocus(minutes);
    else dnd.stopFocus();
    updateTray(true);
    return getState();
  });

  handleIpc('app:start-break', (_e, kind) => {
    if (!resting) startBreak(kind === 'long' || kind === 'micro' ? kind : 'short');
    return getState();
  });

  handleIpc('app:reset-stats', () => {
    stats.resetToday();
    return getState();
  });

  handleIpc('app:quit', () => {
    quitApp();
    return true;
  });

  onIpc('ui:open-external', (_e, url) => {
    // 只允许系统浏览器打开 http/https，别的协议一律拒绝
    if (security.safeOpenExternal(url)) shell.openExternal(String(url));
    else log.warn('拒绝了不合法的外部链接:', String(url).slice(0, 200));
  });
}

/* --------------------------------- 配置生效 -------------------------------- */

function applyConfig() {
  tracker.setConfig(cfg);
  overlay.setMultiMonitor(cfg.system.multiMonitor);
  registerShortcuts();
  syncLoginItem();
  syncDock();
}

// macOS 上可以只留菜单栏；改了设置立刻生效，不用重启
function syncDock() {
  if (process.platform !== 'darwin' || !app.isReady() || !app.dock) return;
  try {
    if (cfg.system.hideDock) app.dock.hide();
    else app.dock.show();
  } catch (err) {
    log.warn('切换 Dock 图标失败:', err && err.message);
  }
}

function registerShortcuts() {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* 忽略 */
  }
  if (!cfg.system.shortcuts) return;
  const ok = [
    globalShortcut.register('CommandOrControl+Alt+B', () => {
      if (!resting) startBreak('short');
    }),
    globalShortcut.register('CommandOrControl+Alt+P', () => togglePause(30)),
  ];
  if (ok.some((v) => !v)) console.warn('[shortcut] 全局快捷键注册失败，可能被其他程序占用');
}

function syncLoginItem() {
  if (process.platform === 'darwin' && !app.isPackaged) return; // 开发态不注册，否则会注册 Electron 本身
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(cfg.system.launchAtLogin),
      openAsHidden: true,
    });
  } catch {
    /* 忽略 */
  }
}

function applyFastMode() {
  const c = cfg;
  c.micro.every = 8;
  c.micro.forceLen = 5;
  c.micro.forceEvery = 2;
  c.short.every = 20;
  c.short.phases = { eyes: 5, blink: 6, stretch: 5 };
  c.long.every = 40;
  c.long.len = 15;
  c.long.eyes = 5;
  c.idle.pause = 15;
  c.idle.rest = 30;
  tracker.setConfig(c);
  console.log('[fast] 演示模式：微休息 8 秒一次、短休息 20 秒一次、长休息 40 秒一次');
}

function quitApp() {
  quitting = true;
  clearInterval(tickTimer);
  overlay.hideAll();
  try {
    tray.destroy();
  } catch {
    /* 忽略 */
  }
  app.quit();
}

/* ---------------------------------- 启动 ---------------------------------- */

function init() {
  const dir = app.getPath('userData');
  log.info('配置目录:', dir);
  store = new Store(dir);
  cfg = store.config;
  stats = new Stats(dir);
  dnd = new Dnd();
  tracker = new Tracker(cfg);
  overlay = new Overlay({ onAction: handleOverlayAction });
  overlay.register();
  overlay.setMultiMonitor(cfg.system.multiMonitor);
  registerIpc();
  log.info('核心模块就绪（预设:', cfg.preset, '）');

  powerMonitor.on('suspend', () => tracker.reset());
  powerMonitor.on('resume', () => {
    tracker.reset();
    lastTick = Date.now();
  });
  powerMonitor.on('lock-screen', () => tracker.reset());
  powerMonitor.on('unlock-screen', () => {
    lastTick = Date.now();
  });

  screen.on('display-added', () => overlay.destroyBreak());
  screen.on('display-removed', () => overlay.destroyBreak());
  screen.on('display-metrics-changed', () => overlay.destroyBreak());

  console.log(`[boot] 配置目录 ${dir}`);
}

async function runSmoke() {
  console.log('[smoke] electron', process.versions.electron, 'node', process.versions.node, process.platform);
  init();
  try {
    createTray();
    console.log('[smoke] tray ok');
  } catch (err) {
    console.log('[smoke] tray failed:', err.message);
  }

  const errors = [];
  const report = await overlay.warmUp().catch((e) => {
    errors.push('overlay: ' + e.message);
    return [];
  });
  console.log('[smoke] overlay', JSON.stringify(report));

  let settings = null;
  try {
    const win = openSettings();
    await new Promise((r) => setTimeout(r, 1500));
    settings = {
      loaded: !win.webContents.isLoading(),
      title: await win.webContents.executeJavaScript('document.title'),
      buttons: await win.webContents.executeJavaScript(
        '[...document.querySelectorAll("button")].map(b=>b.textContent.trim()).join("|")'
      ),
      sections: await win.webContents.executeJavaScript(
        '[...document.querySelectorAll("h2")].map(h=>h.textContent.trim()).join("|")'
      ),
    };
  } catch (err) {
    errors.push('settings: ' + err.message);
  }
  console.log('[smoke] settings', JSON.stringify(settings));

  // 走一遍休息流程（不弹窗，只走状态机）
  const before = JSON.stringify(session);
  console.log('[smoke] state before', before);

  console.log('[smoke] errors', errors.length ? JSON.stringify(errors) : 'none');
  console.log('[smoke] DONE');
  setTimeout(() => app.exit(errors.length ? 2 : 0), 300);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 以前这里是静默 app.quit()：用户看到的就是「闪一下就没了、进程也找不到」。
  // 现在至少留一条能看懂的记录，并用非 0 退出码让 .cmd 停下来给提示。
  log.warn('单实例锁被占用：已有另一个 EyeRecess 在跑（或上一次崩溃留下了残留进程），本次退出。');
  console.warn('');
  console.warn('  [EyeRecess] 已经有一个 EyeRecess 在运行了，不会再开第二个。');
  console.warn('  [EyeRecess] 如果你在托盘里看不到它，可能是上次崩溃留下的 electron.exe 僵尸进程：');
  console.warn('            打开任务管理器 → 详细信息 → 找到 electron.exe → 结束任务，然后重试。');
  console.warn('');
  app.exit(3);
} else {
  log.info('单实例锁已拿到，开始初始化');
  app.on('second-instance', () => openSettings());

  app.on('window-all-closed', () => {
    // 常驻托盘：关掉设置窗口不等于退出
    if (quitting) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    // 退出前把还没落盘的统计写掉
    try {
      if (stats && stats.dirty) stats.save();
    } catch {
      /* 忽略 */
    }
  });

  app.whenReady().then(async () => {
    log.info('app ready, Electron', process.versions.electron);
    // 安全策略要在创建任何窗口之前装好
    security.harden(app);
    log.info('安全策略已启用：渲染进程沙箱 / 权限全拒 / 禁止联网 / 禁止跳转');
    if (SMOKE) {
      await runSmoke();
      return;
    }
    init();
    createTray();
    log.info('托盘已创建');
    registerShortcuts();
    syncLoginItem();
    startTicking();
    if (FAST) applyFastMode();
    updateTray(true);
    log.info('计时已开始，等待第一次提醒');

    if (process.platform === 'darwin' && cfg.system.hideDock) {
      app.dock?.hide();
    }
    const where = process.platform === 'darwin' ? '屏幕右上角的菜单栏' : '系统托盘';
    console.log(`[EyeRecess] 已启动，图标在${where}（蓝色圆环）。左键点它看菜单。`);
    console.log('[EyeRecess] 设置页、暂停、立即休息都在菜单里；要退出请用菜单里的「退出」。');
    console.log(`[EyeRecess] 日志：${log.path()}`);
  }).catch((err) => {
    log.error('启动过程出错:', err);
    throw err;
  });
}
