'use strict';
// Renderer isolation, local-resource restrictions, navigation, and trusted IPC.

const path = require('path');
const { fileURLToPath } = require('url');

const RENDERER_ROOT = path.resolve(__dirname, '..', 'renderer');

const trusted = new Map();
const PAGES = {
  settings: path.join(RENDERER_ROOT, 'settings', 'index.html'),
  overlay: path.join(RENDERER_ROOT, 'overlay', 'index.html'),
};

function trust(contents, surface = 'settings') {
  if (!contents || typeof contents.id !== 'number') return contents;
  if (!Object.hasOwn(PAGES, surface)) throw new Error('Unknown renderer surface');
  trusted.set(contents.id, surface);
  if (typeof contents.once === 'function') {
    contents.once('destroyed', () => trusted.delete(contents.id));
  }
  return contents;
}

function isAppUrl(rawUrl, surface) {
  if (typeof rawUrl !== 'string') return false;
  let p;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'file:' || url.host) return false;
    p = path.resolve(fileURLToPath(url));
  } catch {
    return false;
  }
  return surface ? p === PAGES[surface] : Object.values(PAGES).includes(p);
}

// Trust requires both a registered webContents and an application page URL.
function assertTrusted(event, surface = 'settings') {
  try {
    const wc = event && event.sender;
    if (!wc || trusted.get(wc.id) !== surface || wc.isDestroyed?.()) return false;
    // A child frame must never inherit the main page's privileged bridge.
    if (!event.senderFrame || event.senderFrame !== wc.mainFrame) return false;
    return isAppUrl(event.senderFrame.url, surface) && isAppUrl(wc.getURL(), surface);
  } catch {
    return false;
  }
}

function safeOpenExternal(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  if (/[\u0000-\u001f\u007f]/.test(rawUrl)) return false;
  const u = rawUrl.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return false;
  if (u.length > 2048) return false;

  if (/[\u0000-\u001f]/.test(u)) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!parsed.hostname || parsed.username || parsed.password) return false;
  } catch {
    return false;
  }
  return true;
}

// Install after app readiness and before creating any application window.
function harden(appInstance) {
  appInstance.on('web-contents-created', (_e, contents) => {
    try {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    } catch {
    }
    const stop = (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    };
    contents.on('will-navigate', stop);
    contents.on('will-redirect', stop);
    contents.on('will-frame-navigate', stop);
    contents.on('will-attach-webview', stop);
  });

  const { session } = require('electron');
  const ses = session && session.defaultSession;
  if (!ses) return;

  try {
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  } catch {
  }
  try {
    ses.setPermissionCheckHandler(() => false);
  } catch {
  }
  try {
    ses.setDevicePermissionHandler(() => false);
  } catch {
  }
  try {
    ses.setSpellCheckerEnabled(false);
  } catch {
  }

  const ASSET_ROOT = path.resolve(__dirname, '../../assets');
  try {
    ses.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try {
        const url = new URL(details.url);
        if (url.protocol === 'file:' && !url.host) {
          const file = path.resolve(fileURLToPath(url));
          allowed = file.startsWith(RENDERER_ROOT + path.sep) || file.startsWith(ASSET_ROOT + path.sep);
        }
      } catch { /* Unrecognized requests are blocked. */ }
      callback({ cancel: !allowed });
    });
  } catch {
  }
}

module.exports = {
  harden,
  trust,
  assertTrusted,
  safeOpenExternal,
  isAppUrl,
  RENDERER_ROOT,
};
