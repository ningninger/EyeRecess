'use strict';
// Application composition, lifecycle, scheduling, tray, and settings IPC.

const path = require('path');
const log = require('./log');
const security = require('./security');

// Initialize logging before loading Electron so early failures are recorded.
log.init(null);
log.install();
log.boot('EyeRecess starting');
log.boot('node:', process.versions.node, ' electron:', process.versions.electron || '(not Electron)');

const electron = require('electron');

if (typeof electron === 'string' || !electron || !electron.app) {
  log.error('Electron GUI runtime unavailable; module type:', typeof electron);
  log.error('Check whether ELECTRON_RUN_AS_NODE is set.');
  console.error('');
  console.error('[EyeRecess] Startup failed: the process is running in Node mode.');
  console.error('[EyeRecess] Clear ELECTRON_RUN_AS_NODE and retry.');
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

if (process.env.EYERECESS_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.EYERECESS_USER_DATA));
}

log.init(app);

const { Store, PRESETS } = require('./config');
const { Tracker } = require('./tracker');
const { Stats } = require('./stats');
const { Dnd } = require('./dnd');
const { Overlay } = require('./overlay');
const { BreakController } = require('./breaks');
const icons = require('./icons');

const SMOKE = process.argv.includes('--smoke');
const FAST = process.argv.includes('--fast');

app.on('child-process-gone', (_e, details) => {
  log.error('Child process exited:', details && details.type, details && details.reason, details && details.exitCode);
});
app.on('render-process-gone', (_e, _wc, details) => {
  log.error('Renderer process exited:', details && details.reason, details && details.exitCode);
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

let breaks;

let lastTick = Date.now();
let lastPush = 0;
let tickTimer = null;
let quitting = false;
let wasSilent = false;
let shortcutPreference;
let loginPreference;

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

function onDue(kind) {
  stats.add('reminded');
  if (kind === 'micro') return handleMicro();
  // Retry reduced reminders later without recording a completed break.
  if (dnd.isDowngraded(cfg)) {
    overlay.showGlow(cfg.micro.len * 1000);
    tracker.deferFor(kind, 180);
    return;
  }
  return breaks.startBreak(kind);
}

function handleMicro() {
  const wantForce = tracker.shouldForceMicro();
  const downgraded = dnd.isDowngraded(cfg);

  if (wantForce && !downgraded) {
    return breaks.startBreak('micro');
  }

  tracker.noteMicroPassed();
  stats.add('micro');

  if (cfg.ui.glow) overlay.showGlow(cfg.micro.len * 1000, cfg.micro.message || undefined);
  // Keep a visible fallback when both presentation options are disabled.
  else if (!cfg.ui.sound) overlay.showGlow(6000, cfg.micro.message || undefined);
  if (cfg.ui.sound) shell.beep();
  tracker.consume('micro');
  pushState();
  return undefined;
}

function onTick() {
  const now = Date.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!(dt > 0)) return;
  if (dt > 5) dt = 1;

  if (cfg.dnd.meetingDowngrade) dnd.scan();

  const idle = safeIdle();
  const silent = dnd.isSilent(cfg) || isPaused();
  const paused = breaks.resting;

  if (wasSilent && !silent) tracker.clampAfterDnd();
  wasSilent = silent;

  const due = tracker.tick(dt, idle, { paused, silent });
  if (idle >= cfg.idle.rest && !breaks.resting) breaks.resetDeferrals();
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

function updateTray(force = false) {
  if (!tray) return;
  const p = tracker.progress();
  const state = breaks.resting ? 'rest' : tracker.due ? 'due' : 'idle';
  if (state !== trayState) {
    trayState = state;
    try {
      tray.setImage(icons.trayImage(state));
    } catch {
    }
  }
  const tip = breaks.resting
    ? 'EyeRecess · 正在休息'
    : isPaused()
      ? `EyeRecess · 已暂停（${Math.ceil((cfg.pausedUntil - Date.now()) / 60000)} 分钟）`
      : `EyeRecess · 连续用眼 ${fmtDur(p.streak)}，${cfg.micro.enabled ? `${fmtDur(p.microLeft)}后微休息` : '微休息已关闭'}`;
  tray.setToolTip(tip);

  if (force || Date.now() - lastMenuBuild > 15000) {
    lastMenuBuild = Date.now();
    try {
      tray.setContextMenu(buildMenu());
    } catch {
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
      label: `连续用眼 ${fmtDur(p.streak)} · ${cfg.micro.enabled ? `${fmtDur(p.microLeft)}后微休息` : '微休息已关闭'}`,
      enabled: false,
    },
    {
      label: `短休息 ${cfg.short.enabled ? fmtDur(p.shortLeft) : '已关闭'} · 长休息 ${cfg.long.enabled ? fmtDur(p.longLeft) : '已关闭'}`,
      enabled: false,
    },
    { type: 'separator' },
    { label: `立即短休息（${fmtDur(cfg.short.len)}）`, click: () => breaks.startBreak('short') },
    { label: `立即长休息（${fmtDur(cfg.long.len)}）`, click: () => breaks.startBreak('long') },
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
  if (process.platform !== 'linux') {
    tray.on('double-click', () => openSettings());
  } else if (process.platform === 'linux') {
    tray.on('click', () => {
      try {
        tray.popUpContextMenu();
      } catch {
      }
    });
  }

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

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('ui:scroll-to', section);
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 860,
    minWidth: 460,
    minHeight: 560,
    title: 'EyeRecess 课间',
    backgroundColor: '#f4f6f3',
    icon: icons.appIcon(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.js'),

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
  }).catch(() => log.error('Failed to load the settings page.'));
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
    resting: breaks.resting,
    paused: isPaused(),
    pauseLeft: isPaused() ? Math.ceil((cfg.pausedUntil - Date.now()) / 60000) : 0,
    app: {
      name: app.getName(),
      version: app.getVersion(),
      canHideDock: process.platform === 'darwin',
      canLaunchAtLogin: app.isPackaged && ['darwin', 'win32'].includes(process.platform),
    },
  };
}

/* ---------------------------------- IPC ----------------------------------- */

function handleIpc(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!security.assertTrusted(event)) {
      log.warn('Rejected untrusted IPC request:', channel);
      return null;
    }
    return fn(event, ...args);
  });
}

function onIpc(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!security.assertTrusted(event)) {
      log.warn('Rejected untrusted IPC message:', channel);
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

  handleIpc('app:reset-plan', () => {
    cfg = store.resetPlan();
    applyConfig();
    updateTray(true);
    return getState();
  });

  handleIpc('app:pause', (_e, minutes) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return getState();
    togglePause(minutes);
    return getState();
  });

  handleIpc('app:focus', (_e, minutes) => {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes > 1440) return getState();
    if (minutes > 0) dnd.startFocus(minutes);
    else dnd.stopFocus();
    updateTray(true);
    return getState();
  });

  handleIpc('app:start-break', (_e, kind) => {
    if (!breaks.resting && ['long', 'micro', 'short'].includes(kind)) breaks.startBreak(kind);
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
    if (security.safeOpenExternal(url)) shell.openExternal(url).catch(() => log.warn('Failed to open an external link.'));
    else log.warn('Rejected an invalid external link.');
  });
}

function applyConfig() {
  tracker.setConfig(cfg);
  overlay.setMultiMonitor(cfg.system.multiMonitor);
  registerShortcuts();
  syncLoginItem();
  syncDock();
}

function syncDock() {
  if (process.platform !== 'darwin' || !app.isReady() || !app.dock) return;
  try {
    if (cfg.system.hideDock) app.dock.hide();
    else app.dock.show();
  } catch (err) {
    log.warn('Failed to update Dock visibility:', err && err.message);
  }
}

function registerShortcuts() {
  const enabled = Boolean(cfg.system.shortcuts);
  if (shortcutPreference === enabled) return;
  try {
    globalShortcut.unregisterAll();
    shortcutPreference = enabled;
    if (!enabled) return;
    const ok = [
      globalShortcut.register('CommandOrControl+Alt+B', () => {
        if (!breaks.resting) breaks.startBreak('short');
      }),
      globalShortcut.register('CommandOrControl+Alt+P', () => togglePause(30)),
    ];
    if (ok.some((value) => !value)) log.warn('Some global shortcuts are unavailable on this desktop.');
  } catch {
    shortcutPreference = undefined;
    log.warn('Global shortcut registration is unavailable on this desktop.');
  }
}

function syncLoginItem() {
  if (!app.isPackaged || !['darwin', 'win32'].includes(process.platform)) return;
  const enabled = Boolean(cfg.system.launchAtLogin);
  if (loginPreference === enabled) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true,
    });
    loginPreference = enabled;
  } catch {
  }
}

function applyFastMode() {
  const c = cfg;
  c.micro.every = 8;
  c.micro.forceLen = 5;
  c.micro.forceEvery = 2;
  c.short.every = 20;
  c.short.phases = { eyes: 5, blink: 6, stretch: 5 };
  c.short.len = 16;
  c.long.every = 40;
  c.long.len = 15;
  c.long.eyes = 5;
  c.idle.pause = 15;
  c.idle.rest = 30;
  tracker.setConfig(c);
  console.log('[demo] Reminder intervals: micro 8s, short 20s, long 40s.');
}

function quitApp() {
  quitting = true;
  clearInterval(tickTimer);
  breaks.endSession();
  overlay.hideAll();
  try {
    tray.destroy();
  } catch {
  }
  app.quit();
}

function init() {
  const dir = app.getPath('userData');
  store = new Store(dir);
  cfg = store.config;
  stats = new Stats(dir);
  dnd = new Dnd();
  tracker = new Tracker(cfg);
  overlay = new Overlay({
    onAction: (action, token) => breaks.handleOverlayAction(action, token),
    onDismiss: () => breaks.endSession(),
  });
  breaks = new BreakController({
    getConfig: () => cfg, tracker, stats, overlay, beep: () => shell.beep(),
    onChange: () => {
      lastTick = Date.now();
      if (quitting) return;
      updateTray(true);
      pushState();
    },
  });
  overlay.register();
  overlay.setMultiMonitor(cfg.system.multiMonitor);
  registerIpc();
  log.info('Services ready; preset:', cfg.preset);

  const resetWorkSession = () => {
    tracker.reset();
    overlay.hideGlow();
    breaks.reset();
  };
  powerMonitor.on('suspend', resetWorkSession);
  powerMonitor.on('resume', () => {
    tracker.reset();
    lastTick = Date.now();
  });
  powerMonitor.on('lock-screen', resetWorkSession);
  powerMonitor.on('unlock-screen', () => {
    lastTick = Date.now();
  });

  const refreshDisplays = () => { overlay.hideGlow(); overlay.refreshBreak(); };
  screen.on('display-added', refreshDisplays);
  screen.on('display-removed', refreshDisplays);
  screen.on('display-metrics-changed', refreshDisplays);

}

async function runSmoke() {
  console.log('[smoke] electron', process.versions.electron, 'node', process.versions.node, process.platform);
  init();
  const errors = [];
  try {
    createTray();
    console.log('[smoke] tray ok');
  } catch (err) {
    errors.push('tray: ' + err.message);
    console.log('[smoke] tray failed:', err.message);
  }

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

  const before = JSON.stringify(breaks.session);
  console.log('[smoke] state before', before);

  console.log('[smoke] errors', errors.length ? JSON.stringify(errors) : 'none');
  console.log('[smoke] DONE');
  setTimeout(() => app.exit(errors.length ? 2 : 0), 300);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn('Another EyeRecess instance is already running.');
  app.exit(3);
} else {
  log.info('Single-instance lock acquired.');
  app.on('second-instance', () => openSettings());
  app.on('activate', () => { if (store) openSettings(); });

  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    clearInterval(tickTimer);
    breaks?.endSession();
    overlay?.hideAll();

    try {
      if (stats && stats.dirty) stats.save();
    } catch {
    }
  });

  app.whenReady().then(async () => {
    log.info('app ready, Electron', process.versions.electron);

    security.harden(app);
    log.info('Renderer security policy installed.');
    if (SMOKE) {
      await runSmoke();
      return;
    }
    init();
    createTray();
    log.info('Tray created.');
    registerShortcuts();
    syncLoginItem();
    startTicking();
    if (FAST) applyFastMode();
    updateTray(true);
    log.info('Activity tracking started.');

    if (process.platform === 'darwin' && cfg.system.hideDock) {
      app.dock?.hide();
    }
    console.log('[EyeRecess] Running. Open Settings or Quit from the tray menu.');
  }).catch((err) => {
    log.error('Startup failed:', err);
    app.exit(1);
  });
}
