'use strict';
// Quiet hours, manual focus, and best-effort meeting-process detection.

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
        // macOS may return a full executable path rather than a process name.
        const base = v.split('/').pop();
        if (base) out.add(base);
      }
      cb(out);
    });
  }
}

function hhmmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

class Dnd {
  constructor() {
    this.meetingRunning = false;
    this.lastScan = 0;
    this.scanning = false;
    this.focusUntil = 0; // Manual focus window.
    this.enabled = true;
  }

  /** Scan process names at most once every 15 seconds. */
  scan(force = false) {
    // Process presence is a reduction hint, not proof that a call is active.
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
    return a < b ? cur >= a && cur < b : cur >= a || cur < b; // Overnight range.
  }

  /** Silent modes accumulate activity without reminders. */
  isSilent(cfg) {
    return this.inQuietHours(cfg) || this.focusActive();
  }

  /** Reduce reminders to a glow when a meeting app is present. */
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
