'use strict';
// Defaults, presets, normalization, and local persistence. Durations use seconds.

const fs = require('fs');
const path = require('path');

const PRESETS = {
  standard: {
    label: '标准（推荐）',
    hint: '每 10 分钟微休息 20 秒 · 每 50 分钟短休息 2 分钟',
    micro: { enabled: true, every: 600, len: 20 },
    short: { enabled: true, every: 3000, phases: { eyes: 40, blink: 20, stretch: 60 } },
    long: { enabled: true, every: 7200, len: 600 },
  },
  dense: {
    label: '更频繁',
    hint: '每 6 分钟微休息 20 秒 · 每 40 分钟短休息 3 分钟',
    micro: { enabled: true, every: 360, len: 20 },
    short: { enabled: true, every: 2400, phases: { eyes: 60, blink: 20, stretch: 100 } },
    long: { enabled: true, every: 6000, len: 900 },
  },
  classic: {
    label: '20-20-20（经典）',
    hint: '每 20 分钟看 20 英尺（约 6 米）外 20 秒 · 每 60 分钟短休息 2 分钟 · 保留长休息',
    micro: { enabled: true, every: 1200, len: 20 },
    short: { enabled: true, every: 3600, phases: { eyes: 40, blink: 20, stretch: 60 } },
    long: { enabled: true, every: 7200, len: 600 },
  },
  gentle: {
    label: '轻打扰',
    hint: '每 15 分钟微休息 20 秒 · 每 60 分钟短休息 1 分 30 秒',
    micro: { enabled: true, every: 900, len: 20 },
    short: { enabled: true, every: 3600, phases: { eyes: 20, blink: 20, stretch: 50 } },
    long: { enabled: true, every: 7200, len: 600 },
  },
};

const DEFAULTS = {
  version: 2,
  preset: 'standard',

  micro: {
    enabled: true,
    message: '',
    every: 600,
    len: 20,
    style: 'glow',
    forceEvery: 3,
    forceLen: 20,
  },

  short: {
    enabled: true,
    message: '',
    every: 3000,
    defer: 1,
    deferMinutes: 5,
    phases: {
      eyes: 40,
      blink: 20,
      stretch: 60,
    },
  },

  long: {
    enabled: true,
    message: '',
    every: 7200,
    len: 600,
    defer: 1,
    deferMinutes: 5,
    eyes: 60,
  },

  ui: {
    glow: true,
    sound: false,
    dim: 0.94,
  },

  idle: {
    enabled: true,
    pause: 60,
    rest: 180,
  },

  dnd: {
    meetingDowngrade: true,
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
  },

  system: {
    launchAtLogin: false,
    multiMonitor: 'all', // all | cursor
    shortcuts: true,
    hideDock: false,
  },

  pausedUntil: 0,
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, patch) {
  if (!isObj(patch) && patch !== undefined) return patch;
  const out = {};
  for (const k of new Set([...Object.keys(isObj(base) ? base : {}), ...Object.keys(patch || {})])) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = merge(base?.[k], patch?.[k]);
  }
  return isObj(base) || isObj(patch) ? out : base;
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// Copy the known schema only; ignore unknown and recursively nested IPC payloads.
function knownConfig(input, schema = DEFAULTS) {
  const out = {};
  if (!isObj(input)) return out;
  for (const key of Object.keys(schema)) {
    if (!Object.hasOwn(input, key)) continue;
    out[key] = isObj(schema[key]) ? knownConfig(input[key], schema[key])
      : typeof input[key] === 'object' ? schema[key] : input[key];
  }
  return out;
}

function sanitize(cfg) {
  const c = merge(DEFAULTS, knownConfig(cfg));

  // Malformed JSON groups must not replace the expected configuration shape.
  for (const key of ['micro', 'short', 'long', 'ui', 'idle', 'dnd', 'system']) {
    if (!isObj(c[key])) c[key] = merge(DEFAULTS[key]);
  }
  if (!isObj(c.short.phases)) c.short.phases = merge(DEFAULTS.short.phases);
  if (!isObj(c.dnd.quietHours)) c.dnd.quietHours = merge(DEFAULTS.dnd.quietHours);
  c.preset = Object.prototype.hasOwnProperty.call(PRESETS, c.preset) ? c.preset : 'custom';

  for (const kind of ['micro', 'short', 'long']) {
    c[kind].enabled = typeof c[kind].enabled === 'boolean' ? c[kind].enabled : DEFAULTS[kind].enabled;
    c[kind].message = typeof c[kind].message === 'string'
      ? c[kind].message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120)
      : '';
  }

  c.micro.every = clampNum(c.micro.every, 60, 7200, 600);
  c.micro.len = clampNum(c.micro.len, 10, 300, DEFAULTS.micro.len);
  c.micro.forceLen = clampNum(c.micro.forceLen, 10, 120, 20);
  c.micro.forceEvery = clampNum(c.micro.forceEvery, 1, 10, 3);
  c.micro.forceEvery = Math.round(c.micro.forceEvery);
  c.micro.style = 'glow';

  c.short.every = clampNum(c.short.every, 300, 21600, 3000);
  c.short.phases.eyes = clampNum(c.short.phases.eyes, 0, 600, DEFAULTS.short.phases.eyes);
  c.short.phases.blink = clampNum(c.short.phases.blink, 0, 180, DEFAULTS.short.phases.blink);
  c.short.phases.stretch = clampNum(c.short.phases.stretch, 0, 600, DEFAULTS.short.phases.stretch);

  c.long.every = clampNum(c.long.every, 1200, 28800, 7200);
  c.long.eyes = clampNum(c.long.eyes, 0, 600, 60);
  for (const kind of ['short', 'long']) {
    c[kind].defer = Math.round(clampNum(c[kind].defer, 0, 1, 1));
    c[kind].deferMinutes = Math.round(clampNum(c[kind].deferMinutes, 1, 60, 5));
  }
  for (const key of ['ui', 'idle', 'dnd', 'system']) {
    for (const [field, fallback] of Object.entries(DEFAULTS[key])) {
      if (typeof fallback === 'boolean' && typeof c[key][field] !== 'boolean') c[key][field] = fallback;
    }
  }
  const quiet = c.dnd.quietHours;
  if (typeof quiet.enabled !== 'boolean') quiet.enabled = false;
  for (const field of ['start', 'end']) {
    if (typeof quiet[field] !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(quiet[field])) {
      quiet[field] = DEFAULTS.dnd.quietHours[field];
    }
  }
  if (!['all', 'cursor'].includes(c.system.multiMonitor)) c.system.multiMonitor = 'all';
  c.pausedUntil = clampNum(c.pausedUntil, 0, Date.now() + 24 * 60 * 60 * 1000, 0);
  c.version = DEFAULTS.version;

  c.idle.pause = clampNum(c.idle.pause, 15, 900, 60);
  c.idle.rest = clampNum(c.idle.rest, 60, 3600, 180);
  if (c.idle.rest <= c.idle.pause) c.idle.rest = c.idle.pause + 60;

  // Phase durations are the only source of truth for the short-break length.
  c.short.len = c.short.phases.eyes + c.short.phases.blink + c.short.phases.stretch;
  if (c.short.len === 0) {
    c.short.phases = merge(DEFAULTS.short.phases);
    c.short.len = Object.values(c.short.phases).reduce((sum, seconds) => sum + seconds, 0);
  }
  c.long.len = clampNum(c.long.len, 120, 1800, 600);
  if (c.long.eyes > c.long.len - 60) c.long.eyes = Math.max(0, c.long.len - 60);

  c.ui.dim = clampNum(c.ui.dim, 0.2, 1, 0.94);
  return c;
}

function applyPreset(cfg, name) {
  const p = typeof name === 'string' && Object.hasOwn(PRESETS, name) ? PRESETS[name] : null;
  if (!p) return sanitize(cfg);
  const next = merge(cfg, { preset: name, micro: p.micro, short: p.short, long: p.long });
  return sanitize(next);
}

// Upgrade shipped timings only; preserve custom values and unrelated preferences.
function upgradeStoredPlan(input) {
  if (!isObj(input) || input.version !== 1 || !Object.hasOwn(PRESETS, input.preset)) return input;
  const next = knownConfig(input);
  const plan = PRESETS[input.preset];
  const previous = {
    standard: [90, 30, 80], dense: [90, 30, 180],
    classic: [90, 30, 180], gentle: [90, 30, 60],
  }[input.preset];
  if (next.micro?.every === plan.micro.every && next.micro.len === 30) next.micro.len = 20;
  if (next.short?.every === plan.short.every &&
      ['eyes', 'blink', 'stretch'].every((key, i) => next.short.phases?.[key] === previous[i])) {
    next.short.phases = { ...plan.short.phases };
  }
  return next;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this.config = this.load();
  }

  load() {
    try {
      if (fs.statSync(this.file).size > 256 * 1024) return sanitize({});
      const raw = fs.readFileSync(this.file, 'utf8');
      return sanitize(upgradeStoredPlan(JSON.parse(raw)));
    } catch {
      return sanitize({});
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const temporary = this.file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.file);
      return true;
    } catch (err) {
      console.error('[config] Save failed:', err);
      return false;
    }
  }

  patch(partial) {
    const next = sanitize(merge(this.config, knownConfig(partial)));
    if (['micro', 'short', 'long'].some((key) => JSON.stringify(next[key]) !== JSON.stringify(this.config[key]))) {
      next.preset = 'custom';
    }
    return this.persist(next);
  }

  usePreset(name) {
    return this.persist(applyPreset(this.config, name));
  }

  resetPlan() {
    return this.persist(sanitize(merge(this.config, {
      preset: 'standard', micro: DEFAULTS.micro, short: DEFAULTS.short, long: DEFAULTS.long,
    })));
  }

  persist(next) {
    const previous = this.config;
    this.config = next;
    if (!this.save()) {
      this.config = previous;
      throw new Error('Unable to save settings');
    }
    return this.config;
  }
}

module.exports = { Store, DEFAULTS, PRESETS, sanitize, merge, applyPreset };
