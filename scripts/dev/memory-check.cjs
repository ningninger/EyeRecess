'use strict';
// Opt-in native resource soak test. Reports and isolated data stay under .local/.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
function option(name, fallback) {
  return args.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
}
function numberOption(name, fallback, min, max) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid --${name}: expected ${min}..${max}`);
  return value;
}

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const directory = path.dirname(require.resolve('electron/package.json'));
  const executable = path.join(directory, 'dist', fs.readFileSync(path.join(directory, 'path.txt'), 'utf8').trim());
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['--js-flags=--expose-gc', __filename, ...args], { cwd: root, env, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
  run().catch(error => { console.error(error); require('electron').app.exit(1); });
}

async function run() {
  const rounds = numberOption('rounds', 3, 1, 10);
  const cycles = numberOption('cycles', 60, 1, 500);
  const idleSeconds = numberOption('idle-seconds', 70, 0, 600);
  const expectIdleRelease = args.includes('--expect-idle-release');
  const label = option('label', 'memory');
  if (!/^[a-z0-9-]{1,40}$/.test(label)) throw new Error('Invalid report label');
  const directory = path.join(root, '.local/memory-check', `${label}-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true });
  process.env.EYERECESS_USER_DATA = path.join(directory, 'userdata');
  process.env.EYERECESS_LOG_DIR = path.join(directory, 'logs');
  const electron = require('electron');
  const { app, BrowserWindow, webContents, Menu, screen, ipcMain, powerMonitor } = electron;
  // Native pages and processes run normally, without disruptive full-screen flashes.
  BrowserWindow.prototype.show = function() {};
  BrowserWindow.prototype.showInactive = function() {};
  let overlay;
  let breaks;
  let menuBuilds = 0;
  const originalMenu = Menu.buildFromTemplate;
  Menu.buildFromTemplate = function(...values) { menuBuilds++; return originalMenu.apply(this, values); };
  const Module = require('node:module');
  const load = Module._load;
  Module._load = function(request, parent) {
    const result = load.apply(this, arguments);
    if (parent?.filename === path.join(root, 'src/main/main.js')) {
      if (request === './overlay') return { ...result, Overlay: class extends result.Overlay {
        constructor(options) { super(options); overlay = this; }
      } };
      if (request === './breaks') return { ...result, BreakController: class extends result.BreakController {
        constructor(options) { super(options); breaks = this; }
      } };
    }
    return result;
  };
  require(path.join(root, 'src/main/main.js'));
  Module._load = load;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = {
    runtime: { electron: process.versions.electron, platform: process.platform, arch: process.arch },
    scenario: { rounds, cycles, idleSeconds, expectIdleRelease, presentation: 'Hidden native windows; visual and focus behavior are not tested' },
    samples: [], result: 'running',
  };
  const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  const watchdog = setTimeout(() => {
    report.result = 'timeout'; save(); app.exit(2);
  }, 20 * 60 * 1000);
  const start = Date.now();
  const listeners = emitter => Object.fromEntries(emitter.eventNames().map(name => [String(name), emitter.listenerCount(name)]));
  async function ready(win) {
    const deadline = Date.now() + 10000;
    while (win.webContents.isLoading() && Date.now() < deadline) await delay(20);
    if (win.webContents.isLoading()) throw new Error('A native page did not finish loading');
    // Allow the preload bridge and initial getState response to finish.
    await delay(30);
  }
  async function sample(stage) {
    const rawHeapBytes = process.memoryUsage().heapUsed;
    global.gc?.();
    const renderers = [];
    for (const contents of webContents.getAllWebContents()) {
      if (contents.isDestroyed() || contents.isLoading()) continue;
      contents.debugger.attach('1.3');
      try {
        await contents.debugger.sendCommand('HeapProfiler.collectGarbage');
        renderers.push({
          page: contents.getURL().includes('/settings/') ? 'settings' : 'overlay',
          heap: await contents.debugger.sendCommand('Runtime.getHeapUsage'),
          dom: await contents.debugger.sendCommand('Memory.getDOMCounters'),
          pendingLoads: contents.listenerCount('did-finish-load'),
        });
      } finally { if (!contents.isDestroyed()) contents.debugger.detach(); }
    }
    const metrics = app.getAppMetrics().map(item => ({
      type: item.type, memoryKiB: item.memory.workingSetSize, cpu: item.cpu.percentCPUUsage,
    }));
    const row = {
      stage, elapsedSeconds: Math.round((Date.now() - start) / 1000),
      totalWorkingSetMiB: metrics.reduce((sum, item) => sum + item.memoryKiB, 0) / 1024,
      rawHeapBytes, heapAfterGcBytes: process.memoryUsage().heapUsed,
      mainMemoryKiB: await process.getProcessMemoryInfo(), metrics, renderers,
      windows: BrowserWindow.getAllWindows().length,
      pendingLoads: overlay.pendingLoads?.size ?? null,
      glowPointerPolling: Boolean(overlay.glowPointerTimer),
      phasePending: Boolean(breaks.pendingResolve),
      resources: process.getActiveResourcesInfo().reduce((counts, type) => ({ ...counts, [type]: (counts[type] || 0) + 1 }), {}),
      listeners: { app: listeners(app), screen: listeners(screen), powerMonitor: listeners(powerMonitor), ipcMain: listeners(ipcMain) },
      menuBuilds,
    };
    report.samples.push(row);
    save();
    console.log(JSON.stringify({ stage, seconds: row.elapsedSeconds, workingSetMiB: Math.round(row.totalWorkingSetMiB), heapMiB: +(row.heapAfterGcBytes / 1048576).toFixed(2), windows: row.windows, renderers: renderers.length }));
    if (row.totalWorkingSetMiB > 1536) throw new Error('Native soak test exceeded its 1.5 GiB resource budget');
    if (JSON.stringify(row.listeners) !== JSON.stringify(report.samples[0].listeners)) throw new Error('Application listeners accumulated during native soak');
    if (row.glowPointerPolling || row.phasePending) throw new Error('A cancelled reminder retained active work');
    if (row.pendingLoads) throw new Error('A cancelled reminder retained a load callback');
    if (expectIdleRelease && /-idle-/.test(stage) && Number(stage.split('-').at(-1)) >= 60 && (row.windows || row.renderers.length)) {
      throw new Error('Idle reminder windows were not released');
    }
  }
  async function settings() {
    app.emit('activate');
    const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/settings/'))
      || BrowserWindow.getAllWindows().find(item => !item.webContents.getURL());
    if (!win) throw new Error('Settings window was not created');
    await ready(win);
    return win;
  }
  try {
    await app.whenReady();
    // Wait for main-process initialization, then suppress automatic reminders only.
    for (let i = 0; !breaks && i < 100; i++) await delay(50);
    if (!breaks) throw new Error('Application services did not initialize');
    const firstSettings = await settings();
    await firstSettings.webContents.executeJavaScript('window.api.pause(1440)');
    await delay(1000);
    await sample('startup');
    firstSettings.close();
    for (let round = 0; round <= rounds; round++) {
      const count = round === 0 ? 10 : cycles;
      for (let i = 0; i < count; i++) {
        overlay.showGlow(20000, 'Memory check');
        await ready(overlay.glowWin);
        overlay.hideGlow();
        breaks.startBreak(['micro', 'short', 'long'][i % 3]);
        await Promise.all(overlay.breakWins.map(ready));
        // Exercise every phase without waiting for the configured human duration.
        for (let phase = 0; phase < 2 && breaks.session; phase++) {
          breaks.pendingResolve?.('timeout');
          await delay(10);
        }
        if (breaks.session) breaks.handleOverlayAction(i % 2 ? 'defer' : 'cancel', breaks.session.token);
        // A later phase may not permit deferral; always terminate this iteration.
        if (breaks.session) breaks.handleOverlayAction('cancel', breaks.session.token);
        await delay(20);
        if (i % 10 === 0) { const win = await settings(); win.close(); await delay(50); }
        if (i % 15 === 0) overlay.refreshBreak();
      }
      const win = await settings();
      const state = await win.webContents.executeJavaScript('window.api.getState()');
      // Accelerate periodic status updates while keeping the production IPC path.
      for (let update = 0; update < 250; update++) win.webContents.send('app:state', state);
      await delay(100);
      await sample(round === 0 ? 'warm-active' : `round-${round}-active`);
      win.close();
      for (let elapsed = 0; elapsed < idleSeconds; elapsed += 10) {
        await delay(Math.min(10, idleSeconds - elapsed) * 1000);
        await sample(`round-${round}-idle-${Math.min(elapsed + 10, idleSeconds)}`);
      }
    }
    report.result = 'completed'; save();
    clearTimeout(watchdog);
    console.log(`Saved ${path.relative(root, path.join(directory, 'report.json'))}`);
    app.quit();
  } catch (error) {
    report.result = 'failed';
    report.error = error.message;
    save();
    clearTimeout(watchdog);
    throw error;
  }
}
