'use strict';
// Native glow and break windows. Session rules belong to BreakController.

const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');
const security = require('./security');

const HTML = path.join(__dirname, '../renderer/overlay/index.html');
const PRELOAD = path.join(__dirname, '../preload/overlay.js');

class Overlay {
  constructor(opts = {}) {
    this.onAction = opts.onAction || (() => {});
    this.glowWin = null;
    this.breakWins = [];
    this.glowTimer = null;
    this.glowPointerTimer = null;
    this.glowToken = null;
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
    const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (this.multiMonitor === 'cursor') return [cur];
    return [cur, ...all.filter((d) => d.id !== cur.id)];
  }

  showGlow(ms = 12000, hint) {
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
      this.glowWin.loadFile(HTML, { query: { mode: 'glow' } }).catch(() => this.hideGlow());
      this.glowWin.on('closed', () => {
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
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fire);
    else fire();

    clearTimeout(this.glowTimer);
    this.glowTimer = setTimeout(() => this.hideGlow(), ms + 400);
  }

  hideGlow() {
    this.glowGeneration++;
    this.glowToken = null;
    clearInterval(this.glowPointerTimer);
    this.glowPointerTimer = null;
    clearTimeout(this.glowTimer);
    if (this.glowWin && !this.glowWin.isDestroyed()) {
      if (!this.glowWin.webContents.isLoading()) this.glowWin.webContents.send('overlay:hide');
      this.glowWin.hide();
    }
  }

  ensureBreakWindows() {
    const displays = this.orderedDisplays();
    const alive =
      this.breakWins.length === displays.length && this.breakWins.every((w) => w && !w.isDestroyed());
    if (alive) {
      displays.forEach((d, i) => this.breakWins[i].setBounds(d.bounds));
      return;
    }
    this.destroyBreak();
    displays.forEach((d) => {
      const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#0a0a0a',
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
        this.breakWins = this.breakWins.filter((w) => w !== win);
        if (this.payload && !this.rebuilding) this.onDismiss();
      });
      this.breakWins.push(win);
    });
  }

  showBreak(payload) {
    this.payload = payload;
    this.ensureBreakWindows();
    this.breakWins.forEach((win, i) => {
      if (!win || win.isDestroyed()) return;
      const send = () => {
        if (win.isDestroyed() || this.payload !== payload) return;
        win.webContents.send('overlay:break', payload);
        if (i === 0) win.show();
        else win.showInactive();
      };
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
      else send();
    });
  }

  updateBreak(payload) {
    this.payload = payload;
    const win = this.breakWins[0];
    if (win && !win.isDestroyed()) win.webContents.send('overlay:break', payload);
  }

  hideBreak() {
    this.payload = null;
    this.breakWins.forEach((win) => {
      if (win && !win.isDestroyed()) {
        if (!win.webContents.isLoading()) win.webContents.send('overlay:hide');
        win.hide();
      }
    });
  }

  destroyBreak() {
    this.rebuilding = true;
    this.breakWins.forEach((win) => {
      if (win && !win.isDestroyed()) win.destroy();
    });
    this.breakWins = [];
    this.rebuilding = false;
  }

  refreshBreak() {
    const payload = this.payload;
    this.destroyBreak();
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
