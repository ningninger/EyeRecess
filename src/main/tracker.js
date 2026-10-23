'use strict';
/**
 * 计时器：只统计「真正在用眼」的时间。
 *
 * 规则（对应 spec §3.3）：
 *  - 空闲 60s–3min      → 暂停累计，并清空微休息计时（刚离开过一会儿，别马上又催）
 *  - 空闲 ≥3min         → 视为已经休息，全部清零
 *  - 免打扰 / 休息中    → 不累计
 *  - 免打扰结束         → 不补发，只把计时夹到「阈值 − 3 分钟」
 */

const DND_GRACE = 180; // 免打扰结束后至少留 3 分钟喘息

class Tracker {
  constructor(config) {
    this.setConfig(config);
    this.reset();
  }

  setConfig(config) {
    this.cfg = config;
  }

  reset() {
    this.micro = 0; // 距上次微休息的累计用眼秒数
    this.short = 0;
    this.long = 0;
    this.streak = 0; // 连续用眼（不受休息重置影响，仅用于展示）
    this.microSeen = 0; // 本周期内「只发光糊弄过去」的次数
    this.activeToday = 0;
    this.lastAccumulated = 0;
    this.due = null; // 'micro' | 'short' | 'long'
  }

  /** 休息结束后调用：消费掉对应计数器 */
  consume(kind) {
    this.streak = 0;
    if (kind === 'micro') {
      this.micro = 0;
    } else if (kind === 'short') {
      this.micro = 0;
      this.short = 0;
    } else if (kind === 'long') {
      this.micro = 0;
      this.short = 0;
      this.long = 0;
    }
    this.due = null;
  }

  /** 延后：把计时器拨回到「还差 N 秒到期」 */
  deferFor(kind, seconds) {
    const c = this.cfg;
    if (kind === 'micro') this.micro = Math.max(0, c.micro.every - seconds);
    else if (kind === 'short') this.short = Math.max(0, c.short.every - seconds);
    else if (kind === 'long') this.long = Math.max(0, c.long.every - seconds);
    this.due = null;
  }

  /** 免打扰结束：不补发，夹到阈值前 3 分钟 */
  clampAfterDnd() {
    const c = this.cfg;
    this.micro = Math.min(this.micro, Math.max(0, c.micro.every - DND_GRACE));
    this.short = Math.min(this.short, Math.max(0, c.short.every - DND_GRACE));
    this.long = Math.min(this.long, Math.max(0, c.long.every - DND_GRACE));
  }

  /**
   * @param {number} dt   距上次 tick 的秒数
   * @param {number} idle 系统空闲秒数
   * @param {{paused?:boolean, silent?:boolean}} flags
   *   paused = 正在休息，完全不计
   *   silent = 免打扰/暂停中：仍然计时间（眼睛确实在累），但不出声
   * @returns {'micro'|'short'|'long'|null}
   */
  tick(dt, idle, flags) {
    this.lastAccumulated = 0;
    if (!(dt > 0)) return null;
    const c = this.cfg;

    // 长时间离开：当作已经休息过了
    if (idle >= c.idle.rest) {
      if (this.micro || this.short || this.long) this.reset();
      return null;
    }
    // 短暂离开：清掉微休息计时，其他计时暂停
    if (idle >= c.idle.pause) {
      this.micro = 0;
      return null;
    }
    // 休息中：完全不计
    if (flags && flags.paused) return null;

    this.micro += dt;
    this.short += dt;
    this.long += dt;
    this.streak += dt;
    this.activeToday += dt;
    this.lastAccumulated = dt;

    // 免打扰期间只累计、不提醒（结束后由 clampAfterDnd 夹到阈值前 3 分钟，
    // 既不补发、也不会让人在开完两小时会后还要再等 50 分钟）
    if (flags && flags.silent) return null;

    if (c.long.enabled && this.long >= c.long.every) return (this.due = 'long');
    if (c.short.enabled && this.short >= c.short.every) return (this.due = 'short');
    if (c.micro.enabled && this.micro >= c.micro.every) return (this.due = 'micro');
    return null;
  }

  /** 微休息是否需要「强制闭眼」而不是发光了事 */
  shouldForceMicro() {
    return this.microSeen + 1 >= Math.max(1, this.cfg.micro.forceEvery);
  }

  /** 这次只发光糊弄过去了（没真闭眼） */
  noteMicroPassed() {
    this.microSeen += 1;
  }

  /** 强制闭眼完成 → 重新开始计数 */
  resetMicroCycle() {
    this.microSeen = 0;
  }

  progress() {
    const c = this.cfg;
    const pct = (cur, every) => Math.max(0, Math.min(1, cur / every));
    return {
      micro: pct(this.micro, c.micro.every),
      short: pct(this.short, c.short.every),
      long: pct(this.long, c.long.every),
      microLeft: Math.max(0, Math.ceil(c.micro.every - this.micro)),
      shortLeft: Math.max(0, Math.ceil(c.short.every - this.short)),
      longLeft: Math.max(0, Math.ceil(c.long.every - this.long)),
      streak: Math.floor(this.streak),
    };
  }
}

module.exports = { Tracker };
