'use strict';
// Daily aggregate statistics with bounded retention and delayed writes.

const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 120;

function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emptyDay() {
  return {
    activeSec: 0,
    micro: 0,
    forced: 0,
    short: 0,
    long: 0,
    defer: 0,
    skip: 0,
    reminded: 0,
  };
}

class Stats {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'stats.json');
    this.data = { days: {} };
    this.dirty = false;
    this.saveTimer = null;
    this.load();
    this.today();
  }

  load() {
    try {
      if (fs.statSync(this.file).size > 2 * 1024 * 1024) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
        const days = {};
        for (const key of Object.keys(raw.days).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort().slice(-KEEP_DAYS)) {
          const day = emptyDay();
          for (const field of Object.keys(day)) {
            const value = raw.days[key]?.[field];
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) day[field] = Math.min(value, Number.MAX_SAFE_INTEGER);
          }
          days[key] = day;
        }
        this.data = { days };
      }
    } catch {
    }
  }

  save() {
    this.prune();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const temporary = this.file + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, this.file);
      this.dirty = false;
      return true;
    } catch (err) {
      this.dirty = true;
      console.error('[stats] Save failed:', err);
      return false;
    }
  }

  touch() {
    // Coalesce frequent activity updates; a normal quit flushes pending data.
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) this.save();
    }, 5000);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  prune() {
    const keys = Object.keys(this.data.days).sort();
    while (keys.length > KEEP_DAYS) delete this.data.days[keys.shift()];
  }

  today() {
    const k = dayKey();
    if (!this.data.days[k]) this.data.days[k] = emptyDay();
    return this.data.days[k];
  }

  add(field, n = 1) {
    if (!Object.hasOwn(emptyDay(), field) || !Number.isFinite(n) || n < 0) return;
    const d = this.today();
    d[field] = (d[field] || 0) + n;
    this.touch();
    return d[field];
  }

  addActive(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    this.today().activeSec += seconds;
    this.touch();
  }

  recent(days = 7) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const k = dayKey(d);
      out.push({
        date: k,
        ...(this.data.days[k] ? { ...this.data.days[k] } : emptyDay()),
      });
    }
    this.prune();
    return out;
  }

  snapshot() {
    const t = this.today();
    const week = this.recent(7);
    const sum = (f) => week.reduce((a, d) => a + (d[f] || 0), 0);
    return {
      today: { ...t },
      week: {
        activeSec: sum('activeSec'),
        micro: sum('micro'),
        short: sum('short'),
        long: sum('long'),
        reminded: sum('reminded'),
        defer: sum('defer'),
      },
      recent: week,
    };
  }

  resetToday() {
    const key = dayKey();
    const previous = this.today();
    const wasDirty = this.dirty;
    this.data.days[key] = emptyDay();
    if (!this.save()) {
      this.data.days[key] = previous;
      this.dirty = wasDirty;
      throw new Error('Unable to reset statistics');
    }
  }
}

module.exports = { Stats, dayKey };
