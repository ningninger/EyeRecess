'use strict';
/**
 * 免打扰：跨平台只能做「尽力而为」的判断。
 *
 * 1) 勿扰时段（用户自己设）
 * 2) 会议软件在运行 → 降级为「只发光，不遮屏」（不是完全静默：
 *    会议中照样在用眼，只是不该被全屏遮罩打断）
 *
 * 注意：没有可靠的跨平台办法判断「是否真的在开会」（需要读麦克风占用
 * 或窗口枚举，都要原生模块）。所以这里只做降级，不做完全静默。
 */

const { execFile } = require('child_process');

const MEETING_APPS = {
  win32: [
    'zoom.exe',
    'teams.exe',
    'ms-teams.exe',
    'webex.exe',
    'webexmta.exe',
    'feishu.exe',
    'dingtalk.exe',
    'voov.exe',
    'wemeetapp.exe',
    'tencentmeeting.exe',
    'bluejeans.exe',
    'gotomeeting.exe',
  ],
  darwin: [
    'zoom.us',
    'microsoft teams',
    'webex',
    'feishu',
    'lark',
    'dingtalk',
    'voov',
    'wemeetapp',
    'tencentmeeting',
  ],
  linux: ['zoom', 'teams', 'webex', 'feishu', 'dingtalk'],
};

function listProcesses(cb) {
  if (process.platform === 'win32') {
    execFile('tasklist', ['/fo', 'csv', '/nh'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return cb(null);
      const out = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        if (m) out.add(m[1].toLowerCase());
      }
      cb(out);
    });
  } else {
    execFile('ps', ['-Ao', 'comm='], { timeout: 4000 }, (err, stdout) => {
      if (err || !stdout) return cb(null);
      const out = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        const v = line.trim().toLowerCase();
        if (!v) continue;
        out.add(v);
      }
      cb(out);
    });
  }
}

function hhmmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

class Dnd {
  constructor() {
    this.meetingRunning = false;
    this.lastScan = 0;
    this.scanning = false;
    this.focusUntil = 0; // 手动「专注 / 开会」
    this.enabled = true;
  }

  /** 每 15 秒扫一次进程 */
  scan(force = false) {
    const now = Date.now();
    if (this.scanning) return;
    if (!force && now - this.lastScan < 15000) return;
    this.lastScan = now;
    this.scanning = true;
    listProcesses((procs) => {
      this.scanning = false;
      if (!procs) {
        this.meetingRunning = false;
        return;
      }
      const keys = MEETING_APPS[process.platform] || MEETING_APPS.linux;
      this.meetingRunning = keys.some((k) => procs.has(k));
    });
  }

  startFocus(minutes) {
    this.focusUntil = Date.now() + minutes * 60000;
  }

  stopFocus() {
    this.focusUntil = 0;
  }

  focusActive() {
    return this.focusUntil > Date.now();
  }

  inQuietHours(cfg) {
    const q = cfg?.dnd?.quietHours;
    if (!q || !q.enabled) return false;
    const a = hhmmToMinutes(q.start);
    const b = hhmmToMinutes(q.end);
    if (a === null || b === null || a === b) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    return a < b ? cur >= a && cur < b : cur >= a || cur < b; // 跨午夜
  }

  /** 完全静默：不累计、不提醒 */
  isSilent(cfg) {
    return this.inQuietHours(cfg) || this.focusActive();
  }

  /** 降级：只发光，不弹遮罩 */
  isDowngraded(cfg) {
    return Boolean(cfg?.dnd?.meetingDowngrade) && this.meetingRunning;
  }

  describe(cfg) {
    if (this.focusActive()) {
      const left = Math.ceil((this.focusUntil - Date.now()) / 60000);
      return `专注中，还有 ${left} 分钟`;
    }
    if (this.inQuietHours(cfg)) return '勿扰时段';
    if (this.isDowngraded(cfg)) return '会议软件运行中 · 仅发光';
    return '正常';
  }
}

module.exports = { Dnd, hhmmToMinutes };
