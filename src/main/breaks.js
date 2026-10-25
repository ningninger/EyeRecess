'use strict';
// Break plans and session transitions. Platform effects are injected.

function buildPlan(kind, c) {
  if (kind === 'micro') {
    return [
      {
        id: 'eyes',
        label: '闭眼休息',
        sub: c.micro.message || '闭上眼睛，放松片刻',
        ms: Math.max(3, c.micro.forceLen) * 1000,
        canDefer: false,
      },
    ];
  }
  if (kind === 'short') {
    const out = [];
    if (c.short.phases.eyes > 0) {
      out.push({
        id: 'eyes',
        label: '闭眼',
        sub: '暂时离开屏幕，让眼睛放松',
        ms: c.short.phases.eyes * 1000,
        canDefer: true,
      });
    }
    if (c.short.phases.blink > 0) {
      out.push({
        id: 'blink',
        label: '轻柔眨眼',
        sub: '轻轻闭眼，再自然睁开，无需用力；不舒服时可随时退出',
        ms: c.short.phases.blink * 1000,
      });
    }
    if (c.short.phases.stretch > 0) {
      out.push({
        id: 'stretch',
        label: '起身 / 远眺',
        sub: c.short.message || '站起来走两步，或者看看 6 米外',
        ms: c.short.phases.stretch * 1000,
      });
    }
    return out;
  }
  const eyes = Math.min(c.long.eyes, c.long.len);
  return [
    {
      id: 'eyes',
      label: '长休息',
      sub: '先闭眼休息，然后离开工位',
      ms: eyes * 1000,
      canDefer: true,
    },
    {
      id: 'away',
      label: '离开屏幕',
      sub: c.long.message || '走一走、喝口水、看看远处，按舒服的节奏放松',
      ms: Math.max(3, c.long.len - eyes) * 1000,
    },
  ].filter((phase) => phase.ms > 0);
}

class BreakController {
  constructor({ getConfig, tracker, stats, overlay, beep, onChange }) {
    Object.assign(this, { getConfig, tracker, stats, overlay, beep, onChange });
    this.resting = false;
    this.session = null;
    this.pendingResolve = null;
    this.breakToken = 0;
    this.deferUsed = { micro: 0, short: 0, long: 0 };
  }

  startBreak(kind) {
    if (this.resting || !['micro', 'short', 'long'].includes(kind)) return;
    this.overlay.hideGlow();
    this.resting = true;
    const token = ++this.breakToken;
    this.session = { kind, token, phase: null };
    const plan = buildPlan(kind, this.getConfig());
    this.runPhases(kind, token, plan).catch(() => {
      console.error('[break] Session failed; closing the overlay.');
      if (this.session?.token === token) this.endSession();
    });
    this.onChange();
  }

  async runPhases(kind, token, plan) {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      if (!this.session || this.session.token !== token) return;
      const cfg = this.getConfig();
      const canDefer = Boolean(p.canDefer) && cfg[kind].defer > this.deferUsed[kind];
      this.session.phase = { canDefer };
      this.overlay.showBreak({
        token,
        kind,
        phase: p.id,
        label: p.label,
        sub: p.sub,
        ms: p.ms,
        endsAt: Date.now() + p.ms,
        index: i,
        total: plan.length,
        canDefer,
        allowEnd: true,
        deferMin: cfg[kind].deferMinutes || 5,
        dim: cfg.ui.dim,
      });
      const why = await this.waitPhase(p.ms, token);
      if (!this.session || this.session.token !== token) return;
      if (why === 'defer') return this.doDefer(kind);
      if (why === 'abort') return this.endSession();
    }
    if (!this.session || this.session.token !== token) return;
    this.finishBreak(kind);
  }

  waitPhase(ms, token) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.session && this.session.token === token) {
          this.pendingResolve = null;
          resolve('timeout');
        }
      }, ms);
      this.pendingResolve = (why) => {
        clearTimeout(timer);
        this.pendingResolve = null;
        resolve(why);
      };
    });
  }

  handleOverlayAction(action, token) {
    if (!this.session || this.session.token !== token) return;
    if (['cancel', 'end', 'skip'].includes(action)) return this.doSkip(this.session.kind);
    if (action === 'defer' && this.session.phase?.canDefer) return void this.pendingResolve?.('defer');
    return undefined;
  }

  doSkip(kind) {
    this.stats.add('skip');
    this.tracker.clampAfterDnd();
    this.tracker.deferFor(kind, 300);
    this.stats.save();
    this.endSession();
  }

  doDefer(kind) {
    this.stats.add('defer');
    this.deferUsed[kind] = (this.deferUsed[kind] || 0) + 1;
    const minutes = (this.getConfig()[kind] && this.getConfig()[kind].deferMinutes) || 5;
    this.tracker.deferFor(kind, minutes * 60);
    this.stats.save();
    this.endSession();
  }

  finishBreak(kind) {
    this.tracker.consume(kind);

    this.deferUsed[kind] = 0;
    if (kind === 'micro') {
      this.stats.add('micro');
      this.stats.add('forced');
      this.tracker.resetMicroCycle();
    } else {
      this.stats.add(kind);
    }
    this.stats.save();
    if (this.getConfig().ui.sound) this.beep();
    this.endSession();
  }

  endSession() {
    this.session = null;
    this.resting = false;
    this.pendingResolve?.('abort');
    this.pendingResolve = null;
    this.overlay.hideBreak();
    this.onChange();
  }

  reset() {
    this.resetDeferrals();
    this.endSession();
  }

  resetDeferrals() {
    this.deferUsed = { micro: 0, short: 0, long: 0 };
  }
}

module.exports = { BreakController, buildPlan };
