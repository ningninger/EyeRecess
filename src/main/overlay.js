'use strict';
// Native glow and break windows. Session rules belong to BreakController.

const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');
const security = require('./security');

const HTML = path.join(__dirname, '../renderer/overlay/index.html');
const PRELOAD = path.join(__dirname, '../preload/overlay.js');
const IDLE_WINDOW_MS = 60000;

class Overlay {
  constructor(opts = {}) {
    this.onAction = opts.onAction || (() => {});
    this.glowWin = null;
    this.breakWins = [];
    this.glowTimer = null;
    this.glowPointerTimer = null;
    this.glowToken = null;
    this.glowReleaseTimer = null;
    this.breakReleaseTimer = null;
    this.pendingLoads = new Map();
    this.pendingPaints = new Map();
    this.presentationId = 0;
    this.breakDisplays = new Map();
    this.breakAnchorId = null;
    this.multiMonitor = 'all';
    this.payload = null;
    this.registered = false;
    this.glowGeneration = 0;
    this.rebuilding = false;
    this.onDismiss = opts.onDismiss || (() => {});
  }

  register() {
    if (this.registered) return;
    this.registered = true;
    ipcMain.on('overlay:painted', (event, id) => {
      if (!security.assertTrusted(event, 'overlay')) return;
      const win = this.breakWins.find((w) => w.webContents === event.sender);
      const pending = this.pendingPaints.get(win);
      if (!pending || pending.id !== id || !this.payload || win.isDestroyed()) return;
      this.cancelPendingPaint(win);
      if (pending.focus) win.show();
      else win.showInactive();
    });
    ipcMain.on('overlay:action', (event, msg) => {
      if (!msg) return;

      if (!security.assertTrusted(event, 'overlay')) return;
      if (event.sender === this.glowWin?.webContents) {
        if (msg.action === 'dismiss-glow' && msg.token === this.glowToken) this.hideGlow();
        return;
      }
      if (!this.breakWins.some((win) => win.webContents === event.sender)) return;
      this.onAction(msg.action, msg.token);
    });
  }

  setMultiMonitor(mode) {
    if (this.multiMonitor !== mode) {
      this.multiMonitor = mode;
      this.refreshBreak();
    }
  }

  orderedDisplays() {
    const all = screen.getAllDisplays();
    // Keep the initial display stable while a session advances through phases.
    const cur = all.find((d) => d.id === this.breakAnchorId) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (this.multiMonitor === 'cursor') return [cur];
    return [cur, ...all.filter((d) => d.id !== cur.id)];
  }

  cancelPendingLoad(win) {
    const callback = this.pendingLoads.get(win);
    if (callback) {
      win.webContents.removeListener('did-finish-load', callback);
      this.pendingLoads.delete(win);
    }
  }

  cancelPendingPaint(win) {
    const pending = this.pendingPaints.get(win);
    if (pending) clearTimeout(pending.timer);
    this.pendingPaints.delete(win);
  }

  sendWhenLoaded(win, callback) {
    // A stalled renderer must not retain one closure for every later reminder.
    this.cancelPendingLoad(win);
    if (!win.webContents.isLoading()) return callback();
    const ready = () => {
      this.pendingLoads.delete(win);
      callback();
    };
    this.pendingLoads.set(win, ready);
    win.webContents.once('did-finish-load', ready);
  }

  showGlow(ms = 12000, hint) {
    clearTimeout(this.glowReleaseTimer);
    this.glowReleaseTimer = null;
    const generation = ++this.glowGeneration;
    this.glowToken = generation;
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (!this.glowWin || this.glowWin.isDestroyed()) {
      this.glowWin = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        show: false,
        hasShadow: false,
        alwaysOnTop: true,
        enableLargerThanScreen: true,
        webPreferences: {
          preload: PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          spellcheck: false,
          disableDialogs: true,
          backgroundThrottling: false,
        },
      });
      security.trust(this.glowWin.webContents, 'overlay');
      this.glowWin.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') {
        this.glowWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      const created = this.glowWin;
      const failed = () => { if (this.glowWin === created) this.destroyGlow(); };
      created.loadFile(HTML, { query: { mode: 'glow' } }).catch(failed);
      created.webContents.on('render-process-gone', failed);
      created.on('closed', () => {
        this.cancelPendingLoad(created);
        if (this.glowWin !== created) return;
        this.glowWin = null;
        this.hideGlow();
      });
    } else {
      this.glowWin.setBounds(d.bounds);
    }

    const win = this.glowWin;
    // Keep the reminder transparent to input except over its fixed close button.
    let ignoring = null;
    const updatePointer = () => {
      if (win.isDestroyed() || generation !== this.glowGeneration) return;
      const point = screen.getCursorScreenPoint();
      const x = point.x - d.bounds.x;
      const y = point.y - d.bounds.y;
      const next = !(x >= d.bounds.width - 180 && x <= d.bounds.width - 20 && y >= 20 && y <= 64);
      if (next !== ignoring) {
        win.setIgnoreMouseEvents(next);
        ignoring = next;
      }
    };
    clearInterval(this.glowPointerTimer);
    updatePointer();
    this.glowPointerTimer = setInterval(updatePointer, 100);
    const fire = () => {
      if (win.isDestroyed() || generation !== this.glowGeneration) return;
      win.webContents.send('overlay:glow', { ms, hint, token: generation });
      win.showInactive();
    };
    this.sendWhenLoaded(win, fire);

    clearTimeout(this.glowTimer);
    this.glowTimer = setTimeout(() => this.hideGlow(), ms + 400);
  }

  hideGlow() {
    this.glowGeneration++;
    this.glowToken = null;
    clearInterval(this.glowPointerTimer);
    this.glowPointerTimer = null;
    clearTimeout(this.glowTimer);
    this.glowTimer = null;
    if (this.glowWin && !this.glowWin.isDestroyed()) {
      this.cancelPendingLoad(this.glowWin);
      if (!this.glowWin.webContents.isLoading()) this.glowWin.webContents.send('overlay:hide');
      this.glowWin.hide();
      if (!this.glowReleaseTimer) {
        this.glowReleaseTimer = setTimeout(() => this.destroyGlow(), IDLE_WINDOW_MS);
        this.glowReleaseTimer.unref?.();
      }
    }
  }

  destroyGlow() {
    const win = this.glowWin;
    this.glowWin = null;
    clearTimeout(this.glowReleaseTimer);
    this.glowReleaseTimer = null;
    this.hideGlow();
    if (win) this.cancelPendingLoad(win);
    if (win && !win.isDestroyed()) win.destroy();
  }

  ensureBreakWindows() {
    clearTimeout(this.breakReleaseTimer);
    this.breakReleaseTimer = null;
    const displays = this.orderedDisplays();
    this.rebuilding = true;
    for (const [id, win] of this.breakDisplays) {
      if (displays.some((d) => d.id === id) && !win.isDestroyed()) continue;
      this.breakDisplays.delete(id);
      this.cancelPendingLoad(win);
      this.cancelPendingPaint(win);
      if (!win.isDestroyed()) win.destroy();
    }
    displays.forEach((d) => {
      const existing = this.breakDisplays.get(d.id);
      if (existing) {
        const bounds = existing.getBounds();
        if (['x', 'y', 'width', 'height'].some((key) => bounds[key] !== d.bounds[key])) existing.setBounds(d.bounds);
        return;
      }
      const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#0e1713',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: true,
        show: false,
        hasShadow: false,
        alwaysOnTop: true,
        enableLargerThanScreen: true,
        webPreferences: {
          preload: PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          spellcheck: false,
          disableDialogs: true,
          backgroundThrottling: false,
        },
      });
      security.trust(win.webContents, 'overlay');
      win.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      const dismiss = () => {
        if (!win.isDestroyed() && this.breakWins.includes(win) && this.payload) this.onDismiss();
      };
      win.loadFile(HTML, { query: { mode: 'break' } }).catch(dismiss);
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape' || !this.payload || !this.breakWins.includes(win)) return;
        event.preventDefault();
        this.onAction('cancel', this.payload.token);
      });
      win.webContents.on('render-process-gone', dismiss);
      win.on('closed', () => {
        this.cancelPendingLoad(win);
        this.cancelPendingPaint(win);
        if (this.breakDisplays.get(d.id) === win) this.breakDisplays.delete(d.id);
        this.breakWins = this.breakWins.filter((w) => w !== win);
        if (this.payload && !this.rebuilding) this.onDismiss();
      });
      this.breakDisplays.set(d.id, win);
    });
    this.breakWins = displays.map((d) => this.breakDisplays.get(d.id));
    this.rebuilding = false;
  }

  showBreak(payload) {
    if (!this.payload) this.breakAnchorId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    this.payload = payload;
    this.ensureBreakWindows();
    this.breakWins.forEach((win, i) => {
      if (!win || win.isDestroyed()) return;
      const send = () => {
        if (win.isDestroyed() || this.payload !== payload) return;
        this.cancelPendingPaint(win);
        const presentationId = ++this.presentationId;
        if (!win.isVisible()) {
          // Wait for the updated page to paint before exposing an opaque cover.
          const timer = setTimeout(() => {
            this.pendingPaints.delete(win);
            if (this.payload === payload && !win.isDestroyed()) this.onDismiss();
          }, 5000);
          timer.unref?.();
          this.pendingPaints.set(win, { id: presentationId, timer, focus: i === 0 });
        }
        win.webContents.send('overlay:break', { ...payload, presentationId });
      };
      this.sendWhenLoaded(win, send);
    });
  }

  updateBreak(payload) {
    this.showBreak(payload);
  }

  hideBreak() {
    this.payload = null;
    this.breakAnchorId = null;
    this.breakWins.forEach((win) => {
      if (win && !win.isDestroyed()) {
        this.cancelPendingLoad(win);
        this.cancelPendingPaint(win);
        if (!win.webContents.isLoading()) win.webContents.send('overlay:hide');
        win.hide();
      }
    });
    if (this.breakWins.length && !this.breakReleaseTimer) {
      this.breakReleaseTimer = setTimeout(() => this.destroyBreak(), IDLE_WINDOW_MS);
      this.breakReleaseTimer.unref?.();
    }
  }

  destroyBreak() {
    clearTimeout(this.breakReleaseTimer);
    this.breakReleaseTimer = null;
    this.rebuilding = true;
    this.breakWins.forEach((win) => {
      this.cancelPendingLoad(win);
      this.cancelPendingPaint(win);
      if (win && !win.isDestroyed()) win.destroy();
    });
    this.breakWins = [];
    this.breakDisplays.clear();
    this.rebuilding = false;
  }

  refreshBreak() {
    const payload = this.payload;
    const displays = this.orderedDisplays();
    if (displays.length === this.breakDisplays.size && displays.every((d) => {
      const win = this.breakDisplays.get(d.id);
      if (!win || win.isDestroyed()) return false;
      const bounds = win.getBounds();
      return ['x', 'y', 'width', 'height'].every((key) => bounds[key] === d.bounds[key]);
    })) return;
    if (payload && payload.endsAt > Date.now()) this.showBreak(payload);
  }

  hideAll() {
    this.hideGlow();
    this.hideBreak();
  }

  async warmUp() {
    this.setMultiMonitor('cursor');
    this.showGlow(1500);
    this.showBreak({ token: 0, kind: 'short', phase: 'eyes', label: 'Eye closure', sub: 'Smoke test', ms: 1500, endsAt: Date.now() + 1500, canDefer: false });
    await new Promise((r) => setTimeout(r, 1200));
    const report = [];
    if (this.glowWin && !this.glowWin.isDestroyed()) {
      const c = this.glowWin.webContents;
      report.push({ win: 'glow', url: c.getURL(), title: await c.executeJavaScript('document.title'), text: await c.executeJavaScript('document.body.innerText.slice(0,120)') });
    }
    if (this.breakWins[0] && !this.breakWins[0].isDestroyed()) {
      const c = this.breakWins[0].webContents;
      report.push({ win: 'break', url: c.getURL(), title: await c.executeJavaScript('document.title'), text: await c.executeJavaScript('document.body.innerText.slice(0,120)') });
    }
    return report;
  }
}

module.exports = { Overlay };
