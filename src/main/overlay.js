'use strict';
/**
 * 覆盖层窗口。
 *  - glowWin   ：全屏透明 + 鼠标穿透 + 不抢焦点，只画屏幕边缘的呼吸光（L0 微休息）
 *  - breakWins ：每块屏幕一个，深色遮罩，主屏那一个有按钮（L2/L3）
 */

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
    this.multiMonitor = 'all';
    this.payload = null;
    this.registered = false;
  }

  register() {
    if (this.registered) return;
    this.registered = true;
    ipcMain.on('overlay:action', (event, msg) => {
      if (!msg) return;
      // 只接受遮罩窗口自己发来的操作
      if (!security.assertTrusted(event)) return;
      this.onAction(msg.action, msg.token);
    });
  }

  setMultiMonitor(mode) {
    if (this.multiMonitor !== mode) {
      this.multiMonitor = mode;
      this.destroyBreak();
    }
  }

  /** 打 UI 的那块屏：优先鼠标所在屏 */
  orderedDisplays() {
    const all = screen.getAllDisplays();
    const cur = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (this.multiMonitor === 'cursor') return [cur];
    return [cur, ...all.filter((d) => d.id !== cur.id)];
  }

  /* ---------------- 微休息：呼吸光 ---------------- */

  showGlow(ms = 12000) {
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
      security.trust(this.glowWin.webContents);
      this.glowWin.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') {
        this.glowWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      this.glowWin.setIgnoreMouseEvents(true);
      this.glowWin.loadFile(HTML, { query: { mode: 'glow' } });
      this.glowWin.on('closed', () => (this.glowWin = null));
    } else {
      this.glowWin.setBounds(d.bounds);
    }

    const win = this.glowWin;
    const fire = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('overlay:glow', { ms, token: Date.now() });
      win.showInactive();
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fire);
    else fire();

    clearTimeout(this.glowTimer);
    this.glowTimer = setTimeout(() => this.hideGlow(), ms + 400);
  }

  hideGlow() {
    clearTimeout(this.glowTimer);
    if (this.glowWin && !this.glowWin.isDestroyed()) this.glowWin.hide();
  }

  /* ---------------- 休息：遮罩 ---------------- */

  ensureBreakWindows() {
    const displays = this.orderedDisplays();
    const alive =
      this.breakWins.length === displays.length && this.breakWins.every((w) => w && !w.isDestroyed());
    if (alive) {
      displays.forEach((d, i) => this.breakWins[i].setBounds(d.bounds));
      return;
    }
    this.destroyBreak();
    displays.forEach((d, i) => {
      const interactive = i === 0;
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
        focusable: interactive,
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
      security.trust(win.webContents);
      win.setAlwaysOnTop(true, 'screen-saver');
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      if (!interactive) win.setIgnoreMouseEvents(true);
      win.loadFile(HTML, { query: { mode: interactive ? 'break' : 'veil' } });
      win.on('closed', () => {
        this.breakWins = this.breakWins.filter((w) => w !== win);
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
        if (win.isDestroyed()) return;
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
    this.breakWins.forEach((win) => {
      if (win && !win.isDestroyed()) win.hide();
    });
  }

  destroyBreak() {
    this.breakWins.forEach((win) => {
      if (win && !win.isDestroyed()) win.destroy();
    });
    this.breakWins = [];
  }

  hideAll() {
    this.hideGlow();
    this.hideBreak();
  }

  /** 冒烟测试用：把所有窗口的真实加载结果汇报出来 */
  async warmUp() {
    this.setMultiMonitor('cursor');
    this.showGlow(1500);
    this.showBreak({ token: 0, kind: 'short', phase: 'eyes', label: '闭眼', sub: '冒烟测试', ms: 1500, endsAt: Date.now() + 1500, canDefer: false });
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
