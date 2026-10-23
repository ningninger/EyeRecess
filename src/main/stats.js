'use strict';
/**
 * 统计：只存在本地，按天聚合，最多保留 120 天。
 */

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
    activeSec: 0, // 有效用眼时长
    micro: 0, // 完成（含发光）的微休息次数
    forced: 0, // 强制闭眼次数
    short: 0, // 完成的短休息次数
    long: 0, // 完成的长休息次数
    defer: 0, // 点击「延后」次数
    skip: 0, // 直接跳过次数
    reminded: 0, // 触发提醒总次数
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
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.days && typeof raw.days === 'object') this.data = raw;
    } catch {
      /* 首次运行 */
    }
  }

  save() {
    this.dirty = false;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data), 'utf8');
    } catch (err) {
      console.error('[stats] 保存失败', err);
    }
  }

  /**
   * 打标记，最多每 5 秒落一次盘。
   * 计时器每秒都在 addActive，真每秒写文件没必要；但也不能不写，
   * 否则被强杀 / 断电就丢掉今天的数据。
   */
  touch() {
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
    const d = this.today();
    d[field] = (d[field] || 0) + n;
    this.touch();
    return d[field];
  }

  addActive(seconds) {
    this.today().activeSec += seconds;
    this.touch();
  }

  /** 过去 7 天的汇总，给设置页画小图 */
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
    this.data.days[dayKey()] = emptyDay();
    this.save();
  }
}

module.exports = { Stats, dayKey };
