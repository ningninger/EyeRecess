'use strict';
/**
 * 安全加固层。
 *
 * 这个程序的定位是「一个只在本地跑、不联网、只读自己数据的托盘小程序」，
 * 所以这里把能关的权限全部关掉，而不是去申请更多权限：
 *
 *  1. 渲染进程一律 sandbox + contextIsolation，页面拿不到 Node；
 *  2. 不申请任何系统权限（摄像头/麦克风/定位/通知/剪贴板……全拒）；
 *  3. 网络请求全封锁 —— 只允许 file: / data: / blob: / devtools:，一个包都发不出去；
 *  4. 页面不能跳转、不能开新窗口、不能挂 webview；
 *  5. IPC 只认我们自己创建的那几个窗口发来的消息（按 webContents.id + 页面地址双重校验）；
 *  6. 打开外部链接只允许 http/https，别的协议一律拒绝（防止 file:/smb:/javascript: 之类）。
 */

const path = require('path');
const { fileURLToPath } = require('url');

const RENDERER_ROOT = path.resolve(__dirname, '..', 'renderer');

/** 我们自己创建的窗口的 webContents.id */
const trusted = new Set();

/** 登记一个可信窗口（只应该由 main.js / overlay.js 在创建窗口时调用） */
function trust(contents) {
  if (!contents || typeof contents.id !== 'number') return contents;
  trusted.add(contents.id);
  if (typeof contents.once === 'function') {
    contents.once('destroyed', () => trusted.delete(contents.id));
  }
  return contents;
}

/** 这个地址是不是我们自己的 renderer 页面 */
function isAppUrl(rawUrl) {
  const u = String(rawUrl || '');
  if (!u.startsWith('file://')) return false;
  let p;
  try {
    p = path.resolve(fileURLToPath(u.split('#')[0].split('?')[0]));
  } catch {
    return false;
  }
  return p === RENDERER_ROOT || p.startsWith(RENDERER_ROOT + path.sep);
}

/**
 * 判断一条 IPC 消息是不是来自我们自己的窗口。
 * 双重条件：这个 webContents 是我们登记的 + 它当前加载的确实是我们自己的页面。
 */
function assertTrusted(event) {
  try {
    const wc = event && event.sender;
    if (!wc || !trusted.has(wc.id)) return false;
    const url =
      (event.senderFrame && event.senderFrame.url) ||
      (typeof wc.getURL === 'function' ? wc.getURL() : '');
    return isAppUrl(url);
  } catch {
    return false;
  }
}

/** 只允许用系统浏览器打开 http/https，别的协议（file:/smb:/javascript:…）一律不碰 */
function safeOpenExternal(rawUrl) {
  const u = String(rawUrl || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return false;
  if (u.length > 2048) return false;
  // 排除 http://%00 之类的小把戏
  if (/[\u0000-\u001f]/.test(u)) return false;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * 装上所有加固。必须在创建任何窗口之前调用（app ready 之后即可）。
 * @param {object} appInstance electron 的 app
 */
function harden(appInstance) {
  // ---- 1. 全局：任何 webContents 都不能跳转/开窗/挂 webview ----
  appInstance.on('web-contents-created', (_e, contents) => {
    try {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    } catch {
      /* 老版本没有这个方法 */
    }
    const stop = (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    };
    contents.on('will-navigate', stop);
    contents.on('will-redirect', stop);
    contents.on('will-attach-webview', stop);
  });

  // ---- 2. 会话级：权限全拒 + 断网 ----
  const { session } = require('electron');
  const ses = session && session.defaultSession;
  if (!ses) return;

  try {
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  } catch {
    /* 忽略 */
  }
  try {
    ses.setPermissionCheckHandler(() => false);
  } catch {
    /* 忽略 */
  }
  try {
    ses.setDevicePermissionHandler(() => false);
  } catch {
    /* 忽略 */
  }
  try {
    ses.setSpellCheckerEnabled(false);
  } catch {
    /* 忽略 */
  }

  const LOCAL_OK = /^(file|data|blob|about|devtools|chrome-devtools|electroprompt):/i;
  try {
    ses.webRequest.onBeforeRequest((details, callback) => {
      const u = String((details && details.url) || '');
      // 只放行本地资源，其余（http/https/ws/wss/自定义协议）一律取消
      callback({ cancel: !LOCAL_OK.test(u) });
    });
  } catch {
    /* 忽略 */
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
