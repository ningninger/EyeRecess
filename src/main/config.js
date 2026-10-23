'use strict';
/**
 * 配置：默认值、预设、读写。所有阈值单位都是「秒」。
 * 参数来源见 eye-rest-app-spec.md
 */

const fs = require('fs');
const path = require('path');

const PRESETS = {
  standard: {
    label: '标准（推荐）',
    hint: '每 10 分钟微休息 30 秒 · 每 50 分钟短休息 3 分钟',
    micro: { enabled: true, every: 600, len: 30 },
    short: { enabled: true, every: 3000, len: 200 },
    long: { enabled: true, every: 7200, len: 600 },
  },
  dense: {
    label: '干眼友好（更密）',
    hint: '眼睛已经很干时选这个：每 6 分钟微休息 30 秒 · 每 40 分钟短休息 5 分钟',
    micro: { enabled: true, every: 360, len: 30 },
    short: { enabled: true, every: 2400, len: 300 },
    long: { enabled: true, every: 6000, len: 900 },
  },
  classic: {
    label: '20-20-20（保守兼容档）',
    hint: '经典法则：每 20 分钟看 20 英尺外 20 秒。证据较弱，但打断感最轻',
    micro: { enabled: true, every: 1200, len: 20 },
    short: { enabled: true, every: 3600, len: 300 },
    long: { enabled: true, every: 7200, len: 600 },
  },
  gentle: {
    label: '轻打扰',
    hint: '只发光不遮屏，适合开会多、不喜欢被打断的人',
    micro: { enabled: true, every: 900, len: 30 },
    short: { enabled: true, every: 3600, len: 180 },
    long: { enabled: true, every: 7200, len: 600 },
  },
};

const DEFAULTS = {
  version: 1,
  preset: 'standard',

  micro: {
    enabled: true,
    every: 600, // 累计有效用眼多少秒后微休息
    len: 30, // 微休息时长（秒）
    style: 'glow', // glow=屏幕边缘呼吸光；toast=角落小提示
    forceEvery: 3, // 每 N 次微休息里强制 1 次闭眼（不可跳过）
    forceLen: 20, // 强制闭眼时长
  },

  short: {
    enabled: true,
    every: 3000, // 50 分钟
    defer: 1, // 每次可延后次数
    deferMinutes: 5,
    phases: {
      eyes: 90, // 闭眼
      blink: 30, // 眨眼训练（5 轮 × 6 秒：2s 闭 / 2s 闭 / 2s 挤）
      stretch: 80, // 起身 / 远眺
    },
  },

  long: {
    enabled: true,
    every: 7200, // 2 小时
    len: 600, // 总时长 10 分钟
    defer: 1,
    deferMinutes: 5,
    eyes: 60, // 前 60 秒闭眼，之后自由离开
  },

  ui: {
    glow: true, // 微休息用呼吸光
    sound: false,
    dim: 0.94, // 遮罩下背景亮度（0-1）
  },

  idle: {
    pause: 60, // 空闲超过 60 秒：暂停累计并清微休息计时
    rest: 180, // 空闲超过 3 分钟：视为已休息，清零全部计时
  },

  dnd: {
    meetingDowngrade: true, // 检测到会议软件在跑 → 只发光不遮屏
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
  },

  system: {
    launchAtLogin: false,
    multiMonitor: 'all', // all | cursor
    shortcuts: true,
    hideDock: false,
  },

  pausedUntil: 0, // 时间戳；0 = 未暂停
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, patch) {
  if (!isObj(patch)) return patch === undefined ? base : patch;
  const out = isObj(base) ? { ...base } : {};
  for (const k of Object.keys(patch)) {
    out[k] = isObj(base?.[k]) && isObj(patch[k]) ? merge(base[k], patch[k]) : patch[k];
  }
  return out;
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** 夹取非法值，避免配置文件被手改坏后炸掉 */
function sanitize(cfg) {
  const c = merge(DEFAULTS, cfg || {});
  c.preset = Object.prototype.hasOwnProperty.call(PRESETS, c.preset) ? c.preset : 'custom';

  c.micro.every = clampNum(c.micro.every, 60, 7200, 600);
  c.micro.len = clampNum(c.micro.len, 10, 300, 30);
  c.micro.forceLen = clampNum(c.micro.forceLen, 10, 120, 20);
  c.micro.forceEvery = clampNum(c.micro.forceEvery, 1, 10, 3);

  c.short.every = clampNum(c.short.every, 300, 21600, 3000);
  c.short.phases.eyes = clampNum(c.short.phases.eyes, 0, 600, 90);
  c.short.phases.blink = clampNum(c.short.phases.blink, 0, 180, 30);
  c.short.phases.stretch = clampNum(c.short.phases.stretch, 0, 600, 80);

  c.long.every = clampNum(c.long.every, 1200, 28800, 7200);
  c.long.eyes = clampNum(c.long.eyes, 0, 600, 60);

  c.idle.pause = clampNum(c.idle.pause, 15, 900, 60);
  c.idle.rest = clampNum(c.idle.rest, 60, 3600, 180);
  if (c.idle.rest <= c.idle.pause) c.idle.rest = c.idle.pause + 60;

  // 短休息时长由各阶段合成
  c.short.len = c.short.phases.eyes + c.short.phases.blink + c.short.phases.stretch;
  c.long.len = clampNum(c.long.len, 120, 1800, 600);
  if (c.long.eyes > c.long.len - 60) c.long.eyes = Math.max(0, c.long.len - 60);

  c.ui.dim = clampNum(c.ui.dim, 0.2, 1, 0.94);
  return c;
}

function applyPreset(cfg, name) {
  const p = PRESETS[name];
  if (!p) return sanitize(cfg);
  const next = merge(cfg, { preset: name, micro: p.micro, short: p.short, long: p.long });
  return sanitize(next);
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.config = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return sanitize(JSON.parse(raw));
    } catch {
      return sanitize({});
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('[config] 保存失败', err);
      return false;
    }
  }

  patch(partial) {
    this.config = sanitize(merge(this.config, partial));
    this.save();
    return this.config;
  }

  usePreset(name) {
    this.config = applyPreset(this.config, name);
    this.save();
    return this.config;
  }
}

module.exports = { Store, DEFAULTS, PRESETS, sanitize, merge, applyPreset };
