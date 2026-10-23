'use strict';
// Active-time counters and reminder priority. Silent mode still accumulates activity.

const DND_GRACE = 180;

class Tracker {
  constructor(config) {
    this.setConfig(config);
    this.reset();
  }

  setConfig(config) {
    this.cfg = config;
  }

  reset() {
    this.micro = 0;
    this.short = 0;
    this.long = 0;
    this.streak = 0;
    this.microSeen = 0;
    this.activeToday = 0;
    this.lastAccumulated = 0;
    this.due = null; // 'micro' | 'short' | 'long'
  }

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

  deferFor(kind, seconds) {
    const c = this.cfg;
    if (kind === 'micro') this.micro = Math.max(0, c.micro.every - seconds);
    else if (kind === 'short') this.short = Math.max(0, c.short.every - seconds);
    else if (kind === 'long') this.long = Math.max(0, c.long.every - seconds);
    this.due = null;
  }

  clampAfterDnd() {
    const c = this.cfg;
    this.micro = Math.min(this.micro, Math.max(0, c.micro.every - DND_GRACE));
    this.short = Math.min(this.short, Math.max(0, c.short.every - DND_GRACE));
    this.long = Math.min(this.long, Math.max(0, c.long.every - DND_GRACE));
  }

  /**
   * Accumulate dt seconds using system idle seconds.
   * flags.paused means an active break; flags.silent suppresses reminders only.
   * Returns the highest-priority due break, or null.
   */
  tick(dt, idle, flags) {
    this.lastAccumulated = 0;
    if (!(dt > 0)) return null;
    const c = this.cfg;

    if (idle >= c.idle.rest) {
      if (this.micro || this.short || this.long) this.reset();
      return null;
    }

    if (idle >= c.idle.pause) {
      this.micro = 0;
      return null;
    }

    if (flags && flags.paused) return null;

    this.micro += dt;
    this.short += dt;
    this.long += dt;
    this.streak += dt;
    this.activeToday += dt;
    this.lastAccumulated = dt;

    if (flags && flags.silent) return null;

    if (c.long.enabled && this.long >= c.long.every) return (this.due = 'long');
    if (c.short.enabled && this.short >= c.short.every) return (this.due = 'short');
    if (c.micro.enabled && this.micro >= c.micro.every) return (this.due = 'micro');
    return null;
  }

  shouldForceMicro() {
    return this.microSeen + 1 >= Math.max(1, this.cfg.micro.forceEvery);
  }

  noteMicroPassed() {
    this.microSeen += 1;
  }

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
