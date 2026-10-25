'use strict';
// Cancellation must remain available in every phase without recording completion.
const assert = require('node:assert/strict');
const { BreakController, buildPlan } = require('../../src/main/breaks');
const { sanitize } = require('../../src/main/config');
const { Tracker } = require('../../src/main/tracker');

async function main() {
  for (const kind of ['micro', 'short', 'long']) {
    const cfg = sanitize({});
    const phases = buildPlan(kind, cfg);
    for (let target = 0; target < phases.length; target++) {
      const tracker = new Tracker(cfg);
      tracker.micro = cfg.micro.every;
      tracker.short = cfg.short.every;
      tracker.long = cfg.long.every;
      const counts = {};
      let shown;
      let hidden = 0;
      const controller = new BreakController({
        getConfig: () => cfg, tracker,
        stats: { add: (key) => { counts[key] = (counts[key] || 0) + 1; }, save() {} },
        overlay: { hideGlow() {}, hideBreak: () => hidden++, showBreak: (payload) => { shown = payload; } },
        beep: () => assert.fail('Cancellation must not play a completion sound'), onChange() {},
      });
      controller.startBreak(kind);
      for (let step = 0; step < target; step++) {
        controller.pendingResolve('timeout');
        await Promise.resolve();
      }
      assert.equal(shown.phase, phases[target].id);
      assert.equal(shown.allowEnd, true);
      controller.handleOverlayAction('cancel', shown.token + 1);
      assert.equal(controller.resting, true, 'Stale cancellation cannot end the current session');
      controller.handleOverlayAction('cancel', shown.token);
      await Promise.resolve();
      assert.equal(controller.resting, false, `${kind}/${phases[target].id} can exit immediately`);
      assert.equal(controller.pendingResolve, null);
      assert.equal(hidden, 1, 'All overlay windows are hidden exactly once');
      assert.deepEqual(counts, { skip: 1 }, 'Cancellation counts as skipped, never completed');
      assert.equal(tracker.tick(1, 0, {}), null, 'No overdue reminder immediately replaces the dismissed break');
      controller.handleOverlayAction('cancel', shown.token);
      assert.deepEqual(counts, { skip: 1 }, 'Repeated clicks cannot double count cancellation');
    }
  }
  console.log('Break cancellation tests passed: every phase, stale tokens, cleanup, statistics, and reminder grace');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
