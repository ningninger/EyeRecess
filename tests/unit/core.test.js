'use strict';
// Pure configuration, scheduling, persistence, and quiet-mode tests.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { sanitize, applyPreset, merge, Store, PRESETS, DEFAULTS } = require('../../src/main/config');
const { buildPlan } = require('../../src/main/breaks');
const { Tracker } = require('../../src/main/tracker');
const { Stats, dayKey } = require('../../src/main/stats');
const { Dnd, hhmmToMinutes } = require('../../src/main/dnd');

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, name, extra) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(name + (extra ? `  (${extra})` : ''));
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ''}`);
  }
}

function eq(actual, expected, name) {
  ok(actual === expected, name, `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function section(title) {
  console.log(`\n${title}`);
}

section('Configuration: defaults and bounds');
{
  const c = sanitize({});
  eq(c.micro.every, 600, 'Default micro interval is 600 seconds');
  eq(c.micro.len, 20, 'Default micro duration is 20 seconds');
  eq(c.short.every, 3000, 'Default short interval is 3000 seconds');
  eq(c.short.len, 40 + 20 + 60, 'Short duration is the sum of its phases');
  eq(c.long.every, 7200, 'Default long interval is 7200 seconds');
  eq(c.long.len, 600, 'Default long duration is 600 seconds');
  eq(c.idle.rest, 180, 'Default idle reset threshold is 180 seconds');

  const clamped = sanitize({ micro: { every: 5, len: 9999 }, long: { len: 5 } });
  eq(clamped.micro.every, 60, 'Micro interval has a 60-second lower bound');
  eq(clamped.micro.len, 300, 'Micro duration has a 300-second upper bound');
  eq(clamped.long.len, 120, 'Long duration has a 120-second lower bound');

  const idle = sanitize({ idle: { pause: 300, rest: 100 } });
  eq(idle.idle.rest, 360, 'Idle reset must exceed idle pause by at least 60 seconds');

  eq(sanitize({ preset: 'nope' }).preset, 'custom', 'Unknown presets become custom');
  eq(sanitize({ preset: 'standard' }).preset, 'standard', 'Known preset names are preserved');

  const broken = sanitize({ micro: { every: 'abc' } });
  eq(broken.micro.every, 600, 'Non-numeric values use the default');
  eq(DEFAULTS.micro.every, 600, 'Normalization does not mutate shared defaults');
  const isolated = sanitize({});
  isolated.short.phases.eyes = 1;
  eq(sanitize({}).short.phases.eyes, 40, 'Configuration instances do not share nested objects');
  const malformed = sanitize({ micro: null, short: { phases: [] }, dnd: false });
  eq(malformed.micro.every, 600, 'Invalid configuration groups use defaults');
  eq(malformed.short.len, 120, 'Invalid phase groups use defaults');
  eq(malformed.dnd.quietHours.enabled, false, 'Invalid quiet-mode groups use defaults');
  eq(sanitize('broken').micro.every, 600, 'Invalid root configuration uses defaults');
  eq(sanitize({ micro: { enabled: 'false' } }).micro.enabled, true, 'Malformed switches use boolean defaults');
  eq(sanitize({ micro: { message: '  hello\nworld  ' } }).micro.message, 'hello world', 'Hints are normalized as bounded text');
  eq(sanitize({ long: { message: 'x'.repeat(200) } }).long.message.length, 120, 'Hints have a storage limit');
  eq(sanitize({ short: { message: { text: 'invalid' } } }).short.message, '', 'Non-text hints use built-in copy');
  ok(sanitize({ short: { phases: { eyes: 0, blink: 0, stretch: 0 } } }).short.len > 0, 'Empty short plans recover to usable defaults');
  const personalized = sanitize({ micro: { message: 'Micro hint' }, short: { message: 'Stretch hint' }, long: { eyes: 0, message: 'Away hint' } });
  eq(buildPlan('micro', personalized)[0].sub, 'Micro hint', 'Micro plans use custom copy');
  eq(buildPlan('short', personalized).at(-1).sub, 'Stretch hint', 'Stretch phases use custom copy');
  eq(buildPlan('long', personalized)[0].id, 'away', 'Zero eye closure skips the phase');
  eq(buildPlan('long', personalized)[0].sub, 'Away hint', 'Away phases use custom copy');
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"unknown":{"nested":true},"system":{"launchAtLogin":"false","multiMonitor":"other"},"short":{"defer":999,"deferMinutes":-2},"ui":{"sound":"true"},"dnd":{"quietHours":{"enabled":"false","start":"99:99"}}}');
  const safe = sanitize(hostile);
  eq(safe.unknown, undefined, 'Unknown configuration fields are discarded');
  eq(safe.system.launchAtLogin, false, 'A string never enables login integration');
  eq(safe.system.multiMonitor, 'all', 'Unknown display modes use the safe default');
  eq(safe.short.defer, 1, 'Deferral allowances are bounded');
  eq(safe.short.deferMinutes, 1, 'Deferral duration is positive');
  eq(safe.ui.sound, false, 'Malformed presentation switches use defaults');
  eq(safe.dnd.quietHours.start, '22:00', 'Malformed quiet-hour times use defaults');
  eq(safe.dnd.quietHours.enabled, false, 'Malformed quiet-hour switches cannot enable a schedule');
  eq({}.polluted, undefined, 'Configuration cannot pollute object prototypes');
  const cyclic = { micro: {} };
  cyclic.micro.message = cyclic;
  eq(sanitize(cyclic).micro.message, '', 'Non-text recursive input is rejected before merging');
}

section('Configuration: upgrading saved plans');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyerecess-upgrade-'));
  try {
    const file = path.join(dir, 'config.json');
    const previous = {
      standard: [90, 30, 80], dense: [90, 30, 180],
      classic: [90, 30, 180], gentle: [90, 30, 60],
    };
    for (const name of Object.keys(PRESETS)) {
      const saved = applyPreset(sanitize({}), name);
      saved.version = 1;
      saved.micro.len = name === 'classic' ? 20 : 30;
      saved.micro.message = 'Personal hint';
      saved.ui.sound = true;
      saved.short.phases = Object.fromEntries(['eyes', 'blink', 'stretch'].map((key, i) => [key, previous[name][i]]));
      fs.writeFileSync(file, JSON.stringify(saved));
      const upgraded = new Store(dir);
      eq(upgraded.config.micro.len, 20, `${name} saved micro duration upgrades`);
      eq(upgraded.config.short.len, applyPreset(sanitize({}), name).short.len, `${name} saved short plan upgrades`);
      eq(upgraded.config.micro.message, 'Personal hint', 'Upgrade preserves custom copy');
      eq(upgraded.config.ui.sound, true, 'Upgrade preserves system and interface preferences');
      upgraded.patch({ ui: { sound: false } });
      eq(new Store(dir).config.version, 2, 'Upgraded settings persist the new version');
    }
    for (const preset of ['custom', 'standard']) {
      const saved = sanitize({ preset, short: { phases: { eyes: 55, blink: 25, stretch: 65 } } });
      saved.version = 1;
      fs.writeFileSync(file, JSON.stringify(saved));
      eq(new Store(dir).config.short.phases.eyes, 55, 'Upgrade preserves individually adjusted timings');
    }
    const custom = sanitize({ preset: 'custom', micro: { len: 30 } });
    custom.version = 1;
    fs.writeFileSync(file, JSON.stringify(custom));
    eq(new Store(dir).config.micro.len, 30, 'Upgrade leaves explicitly custom durations unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

section('Configuration: presets');
{
  const base = sanitize({});
  const classic = applyPreset(base, 'classic');
  eq(classic.preset, 'classic', 'Preset name is stored');
  eq(classic.micro.every, 1200, 'Classic micro interval is 20 minutes');
  eq(classic.micro.len, 20, 'Classic micro duration is 20 seconds');
  eq(classic.ui.dim, base.ui.dim, 'Changing presets preserves interface settings');

  const dense = applyPreset(base, 'dense');
  eq(dense.short.every, 2400, 'Dense short interval is 40 minutes');
  eq(dense.long.len, 900, 'Dense long duration is 15 minutes');
  ok(Object.keys(PRESETS).length === 4, 'Four presets are available');
  eq(dense.short.len, 180, 'Dense short duration is 3 minutes');
  eq(applyPreset(dense, 'gentle').short.len, 90, 'Gentle preset resets phases to 90 seconds');
  eq(applyPreset(dense, 'standard').short.len, 120, 'Standard preset resets phases to 120 seconds');
  for (const name of Object.keys(PRESETS)) {
    const cfg = applyPreset(base, name);
    eq(buildPlan('short', cfg).reduce((sum, phase) => sum + phase.ms, 0), cfg.short.len * 1000, `${name} plan duration matches the configuration`);
  }

  const custom = merge(sanitize({}), { micro: { every: 700 } });
  eq(custom.micro.every, 700, 'Merge changes only supplied fields');
  eq(custom.short.every, 3000, 'Merge preserves remaining defaults');
}

section('Configuration: persistence');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyerecess-test-'));
  const store = new Store(dir);
  eq(store.config.micro.every, 600, 'First launch uses defaults');
  store.patch({ ui: { sound: true } });
  eq(store.config.preset, 'standard', 'Changing sound preserves the schedule preset');
  store.patch({ micro: { every: 900 } });
  eq(store.config.preset, 'custom', 'Changing the schedule marks it custom');
  const reopened = new Store(dir);
  eq(reopened.config.micro.every, 900, 'Patched values survive reopening the store');
  const used = store.usePreset('gentle');
  eq(used.micro.every, 900, 'Preset values are applied');
  eq(used.preset, 'gentle', 'Preset name is persisted');
  store.patch({ micro: { forceEvery: 8, message: 'Custom' }, short: { enabled: false }, system: { launchAtLogin: true } });
  const reset = store.resetPlan();
  eq(reset.micro.forceEvery, DEFAULTS.micro.forceEvery, 'Reset restores advanced plan options');
  eq(reset.micro.message, '', 'Reset restores built-in copy');
  eq(reset.short.enabled, true, 'Reset enables the default reminders');
  eq(reset.ui.sound, true, 'Reset preserves presentation preferences');
  eq(reset.system.launchAtLogin, true, 'Reset preserves system preferences');
  eq(new Store(dir).config.preset, 'standard', 'Reset persists the recommended plan');
  const persisted = fs.readFileSync(store.file, 'utf8');
  const rename = fs.renameSync;
  const report = console.error;
  fs.renameSync = () => { throw new Error('Expected replacement failure'); };
  console.error = () => {};
  try {
    let failed = false;
    try { store.patch({ ui: { sound: false } }); } catch { failed = true; }
    ok(failed, 'A failed atomic replacement is reported');
    eq(fs.readFileSync(store.file, 'utf8'), persisted, 'A replacement failure preserves the previous configuration file');
  } finally { fs.renameSync = rename; console.error = report; }
  const beforeFailure = store.config;
  store.save = () => false;
  let rejected = false;
  try { store.patch({ micro: { every: 1000 } }); } catch { rejected = true; }
  ok(rejected, 'Storage errors are returned to the caller');
  eq(store.config, beforeFailure, 'Storage failure preserves the last saved state');
  fs.rmSync(dir, { recursive: true, force: true });
}

function tickFor(tracker, seconds, flags = {}, idle = 0) {
  const hits = [];
  for (let i = 0; i < seconds; i++) {
    const due = tracker.tick(1, idle, flags);
    if (due) {
      hits.push({ at: i + 1, kind: due });
      tracker.consume(due);
    }
  }
  return hits;
}

section('Tracker: thresholds');
{
  const disabled = new Tracker(sanitize({ micro: { enabled: false }, short: { enabled: false }, long: { enabled: false } }));
  eq(tickFor(disabled, 8000).length, 0, 'Disabling all reminders suppresses automatic breaks');
  ok(disabled.activeToday > 0, 'Disabling reminders keeps activity summaries available');
  const t = new Tracker(sanitize({}));
  const hits = tickFor(t, 600);
  eq(hits.length, 1, 'One reminder fires within 600 seconds');
  eq(hits[0].kind, 'micro', 'The first reminder is a micro break');
  eq(hits[0].at, 600, 'The reminder fires at 600 seconds');

  const t2 = new Tracker(sanitize({}));
  const hits2 = tickFor(t2, 599);
  eq(hits2.length, 0, 'One second before the threshold does not fire');
  ok(t2.progress().micro > 0.99, 'Progress approaches the threshold');
}

section('Tracker: two-hour schedule');
{
  const t = new Tracker(sanitize({}));
  const hits = tickFor(t, 7200);
  const kinds = hits.map((h) => h.kind);
  const at = hits.map((h) => h.at);

  eq(at.slice(0, 5).join(','), '600,1200,1800,2400,3000', 'First five reminder timestamps');
  eq(kinds.slice(0, 5).join(','), 'micro,micro,micro,micro,short', 'Short break takes priority at 50 minutes');
  ok(kinds.filter((k) => k === 'short').length === 2, 'Two short breaks occur in two hours');
  ok(kinds.filter((k) => k === 'long').length === 1, 'One long break occurs in two hours');
  eq(hits[hits.length - 1].kind, 'long', 'The last reminder is a long break');
  ok(hits[hits.length - 1].at >= 7199, 'Long break fires at the end of two active hours');
  const microCount = kinds.filter((k) => k === 'micro').length;
  ok(microCount >= 8, `Micro reminder count is reasonable: ${microCount}`);
}

section('Tracker: idle handling');
{
  const t = new Tracker(sanitize({}));
  tickFor(t, 700);
  eq(t.micro, 100, 'Micro counter restarts after its reminder');
  eq(t.short, 700, 'Short counter is preserved');

  const shortBefore = t.short;
  eq(t.tick(1, 120, {}), null, 'Short idle periods do not trigger reminders');
  eq(t.micro, 0, 'Short idle periods reset the micro counter');
  eq(t.short, shortBefore, 'Short idle periods pause the short counter');
  const streakBefore = t.streak;
  eq(streakBefore, 100, 'Displayed streak restarts after a micro reminder');
  eq(t.streak, streakBefore, 'Short idle periods preserve the displayed streak');

  const t3 = new Tracker(sanitize({}));
  tickFor(t3, 500);
  ok(t3.short > 0, 'Active time has accumulated');
  t3.tick(1, 400, {});
  eq(t3.micro, 0, 'Long idle resets the micro counter');
  eq(t3.short, 0, 'Long idle resets the short counter');
  eq(t3.long, 0, 'Long idle resets the long counter');
  eq(t3.streak, 0, 'Long idle resets the displayed streak');
}

section('Tracker: active break handling');
{
  const t = new Tracker(sanitize({}));
  for (let i = 0; i < 300; i++) t.tick(1, 0, { paused: true });
  eq(t.micro, 0, 'Breaks do not accumulate activity');
  eq(t.activeToday, 0, 'Breaks do not add daily activity');
  eq(t.lastAccumulated, 0, 'Breaks report zero accumulated time');
}

section('Tracker: silent accumulation and recovery');
{
  const t = new Tracker(sanitize({}));
  const hits = [];
  for (let i = 0; i < 3000; i++) {
    const due = t.tick(1, 0, { silent: true });
    if (due) hits.push(due);
  }
  eq(hits.length, 0, 'Silent mode does not trigger reminders');
  ok(t.micro >= 600, 'Silent mode accumulates active time');
  t.clampAfterDnd();
  eq(t.micro, 600 - 180, 'Recovery clamps micro time before the threshold');
  eq(t.short, 3000 - 180, 'Recovery also clamps short time before the threshold');
  eq(t.long, 3000, 'Counters below the grace threshold are unchanged');

  const t2 = new Tracker(sanitize({ short: { every: 21600 } }));
  for (let i = 0; i < 3000; i++) t2.tick(1, 0, { silent: true });
  t2.clampAfterDnd();
  eq(t2.micro, 420, 'The clamped micro counter leaves 180 seconds');
  let fired = null;
  for (let i = 0; i < 179; i++) if (t2.tick(1, 0, {})) fired = i + 1;
  eq(fired, null, 'No reminder fires during the first 179 seconds');
  eq(t2.tick(1, 0, {}), 'micro', 'The reminder fires at 180 seconds');
}

section('Tracker: forced micro cycle');
{
  const t = new Tracker(sanitize({}));
  eq(t.shouldForceMicro(), false, 'First micro reminder uses a glow');
  t.noteMicroPassed();
  eq(t.shouldForceMicro(), false, 'Second micro reminder still uses a glow');
  t.noteMicroPassed();
  eq(t.shouldForceMicro(), true, 'Third micro reminder requires eye closure');
  t.resetMicroCycle();
  eq(t.shouldForceMicro(), false, 'Forced completion restarts the cycle');
  eq(t.microSeen, 0, 'Cycle counter resets');

  const one = new Tracker(sanitize({ micro: { forceEvery: 1 } }));
  eq(one.shouldForceMicro(), true, 'forceEvery=1 forces every micro reminder');
}

section('Tracker: deferral');
{
  const t = new Tracker(sanitize({}));
  tickFor(t, 400);
  t.deferFor('micro', 120);
  eq(t.micro, 600 - 120, 'Deferral leaves 120 seconds until the next reminder');
  eq(t.due, null, 'Deferral clears the due state');
  const t2 = new Tracker(sanitize({}));
  tickFor(t2, 3000);
  t2.deferFor('long', 300);
  eq(t2.long, 7200 - 300, 'Long break is deferred by five minutes');
}

section('Tracker: progress');
{
  const t = new Tracker(sanitize({}));
  tickFor(t, 300);
  const p = t.progress();
  eq(p.micro, 0.5, 'Micro progress is 50 percent');
  eq(p.microLeft, 300, '300 seconds remain');
  t.tick(1, 0, {});
  ok(p.microLeft >= 0, 'Remaining time cannot be negative');
}

section('Statistics: daily aggregation');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyerecess-stats-'));
  const s = new Stats(dir);
  s.addActive(120);
  s.add('micro');
  s.add('micro');
  s.add('defer');
  const snap = s.snapshot();
  eq(snap.today.activeSec, 120, 'Daily active time accumulates');
  eq(snap.today.micro, 2, 'Daily micro count accumulates');
  eq(snap.week.micro, 2, 'Weekly summary includes today');
  eq(snap.recent.length, 7, 'Recent summary contains seven days');
  eq(snap.recent[6].date, dayKey(), 'The most recent day is today');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(dayKey()), 'Day keys use YYYY-MM-DD');

  ok(fs.existsSync(path.join(dir, 'stats.json')) === false, 'Updates defer writes for five seconds');
  s.save();
  const s2 = new Stats(dir);
  eq(s2.snapshot().today.micro, 2, 'Statistics survive saving and reopening');
  ok(s2.dirty === false, 'Reloaded statistics are clean');

  s.resetToday();
  eq(s.snapshot().today.micro, 0, 'Reset clears current-day counts');
  for (let i = 1; i <= 130; i++) s.data.days[dayKey(new Date(2020, 0, i))] = { activeSec: 1 };
  s.save();
  const retained = JSON.parse(fs.readFileSync(s.file, 'utf8')).days;
  eq(Object.keys(retained).length, 120, 'Saving limits retention to 120 dates without a snapshot');
  ok(Boolean(retained[dayKey()]), 'Retention preserves current-day data');
  fs.writeFileSync(s.file, JSON.stringify({ days: {
    [dayKey()]: { micro: '<img src=x>', activeSec: -10, short: 3 },
    unexpected: { activeSec: 999 },
  } }));
  const repaired = new Stats(dir);
  eq(repaired.snapshot().today.micro, 0, 'Stored statistics cannot inject markup');
  eq(repaired.snapshot().today.activeSec, 0, 'Negative active time is rejected');
  eq(repaired.snapshot().today.short, 3, 'Valid fields survive a malformed record');
  eq(repaired.data.days.unexpected, undefined, 'Invalid date keys are discarded');
  repaired.add('unknown');
  eq(repaired.snapshot().today.unknown, undefined, 'Unknown counters cannot be added');
  const rename = fs.renameSync;
  const report = console.error;
  fs.renameSync = () => { throw new Error('Expected replacement failure'); };
  console.error = () => {};
  try {
    repaired.add('micro');
    eq(repaired.save(), false, 'Failed statistic replacement is reported');
    eq(repaired.dirty, true, 'Failed statistics remain dirty for a later retry');
    const total = repaired.snapshot().today.micro;
    let rejected = false;
    try { repaired.resetToday(); } catch { rejected = true; }
    ok(rejected, 'A failed statistics reset is rejected');
    eq(repaired.snapshot().today.micro, total, 'A failed reset preserves current-day statistics');
  } finally { fs.renameSync = rename; console.error = report; }
  eq(repaired.save(), true, 'Statistics can be saved after a transient failure');
  eq(repaired.dirty, false, 'Successful retry clears dirty state');
  fs.rmSync(dir, { recursive: true, force: true });
}

section('Quiet mode: hours and meeting reduction');
{
  eq(hhmmToMinutes('08:30'), 510, 'HH:MM converts to minutes');
  eq(hhmmToMinutes('bad'), null, 'Invalid times return null');
  eq(hhmmToMinutes('24:00'), null, 'Out-of-range hours are rejected');
  eq(hhmmToMinutes('12:60'), null, 'Out-of-range minutes are rejected');

  const dnd = new Dnd();
  const off = sanitize({});
  eq(dnd.isSilent(off), false, 'Default mode is not silent');
  eq(dnd.isDowngraded(off), false, 'No meeting process means no reduction');
  eq(dnd.describe(off), '\u6b63\u5e38', 'Status describes normal operation');

  const allDay = sanitize({ dnd: { quietHours: { enabled: true, start: '00:00', end: '23:59' } } });
  eq(dnd.inQuietHours(allDay), true, 'Quiet hours include the current time');
  eq(dnd.isSilent(allDay), true, 'Quiet hours enable silent mode');

  const disabled = sanitize({ dnd: { quietHours: { enabled: false, start: '00:00', end: '23:59' } } });
  eq(dnd.inQuietHours(disabled), false, 'Disabled quiet hours are inactive');

  dnd.startFocus(30);
  eq(dnd.focusActive(), true, 'Manual focus is active');
  eq(dnd.isSilent(off), true, 'Manual focus enables silent mode');
  ok(dnd.describe(off).includes('\u4e13\u6ce8'), 'Status describes focus mode');
  dnd.stopFocus();
  eq(dnd.focusActive(), false, 'Focus can be stopped');

  dnd.meetingRunning = true;
  eq(dnd.isDowngraded(off), true, 'Meeting processes reduce reminders');
  ok(dnd.describe(off).includes('\u4f1a\u8bae'), 'Status describes meeting reduction');
  eq(dnd.isSilent(off), false, 'Meeting reduction is distinct from silent mode');
  const noDowngrade = sanitize({ dnd: { meetingDowngrade: false } });
  eq(dnd.isDowngraded(noDowngrade), false, 'Disabling meeting reduction prevents it');
}

console.log(`\n${'-'.repeat(52)}`);
if (fail === 0) {
  console.log(`Passed assertions: ${pass}`);
} else {
  console.log(`Passed assertions: ${pass}; failed assertions: ${fail}`);
  for (const f of failures) console.log('  - ' + f);
}
process.exitCode = fail ? 1 : 0;
