'use strict';
/**
 * 纯逻辑测试：不启动 Electron，只验证计时 / 配置 / 统计 / 免打扰这几块。
 *
 *   node scripts/test-logic.js
 *
 * 覆盖 spec 里最容易写错的规则：空闲处理、免打扰不补发、强制闭眼轮次、
 * 预设夹取、跨午夜勿扰时段。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { sanitize, applyPreset, merge, Store, PRESETS } = require('../src/main/config');
const { Tracker } = require('../src/main/tracker');
const { Stats, dayKey } = require('../src/main/stats');
const { Dnd, hhmmToMinutes } = require('../src/main/dnd');

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
  ok(actual === expected, name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------ 配置与预设 ------------------------------ */

section('配置 · 默认值与夹取');
{
  const c = sanitize({});
  eq(c.micro.every, 600, '默认微休息间隔 600s');
  eq(c.micro.len, 30, '默认微休息时长 30s');
  eq(c.short.every, 3000, '默认短休息间隔 3000s');
  eq(c.short.len, 90 + 30 + 80, '短休息时长 = 各阶段之和');
  eq(c.long.every, 7200, '默认长休息间隔 7200s');
  eq(c.long.len, 600, '默认长休息时长 600s');
  eq(c.idle.rest, 180, '默认空闲视为休息阈值 180s');

  const clamped = sanitize({ micro: { every: 5, len: 9999 }, long: { len: 5 } });
  eq(clamped.micro.every, 60, '微休息间隔下限夹到 60s');
  eq(clamped.micro.len, 300, '微休息时长上限夹到 300s');
  eq(clamped.long.len, 120, '长休息时长下限夹到 120s');

  const idle = sanitize({ idle: { pause: 300, rest: 100 } });
  eq(idle.idle.rest, 360, 'rest 必须大于 pause，自动抬到 pause+60');

  eq(sanitize({ preset: 'nope' }).preset, 'custom', '未知预设名降级为 custom');
  eq(sanitize({ preset: 'standard' }).preset, 'standard', '合法预设名保留');

  const broken = sanitize({ micro: { every: 'abc' } });
  eq(broken.micro.every, 600, '非数字回落到默认值');
}

section('配置 · 预设切换');
{
  const base = sanitize({});
  const classic = applyPreset(base, 'classic');
  eq(classic.preset, 'classic', '预设名写入配置');
  eq(classic.micro.every, 1200, '20-20-20：每 20 分钟');
  eq(classic.micro.len, 20, '20-20-20：20 秒');
  eq(classic.ui.dim, base.ui.dim, '切换预设不影响界面设置');

  const dense = applyPreset(base, 'dense');
  eq(dense.short.every, 2400, '干眼友好：每 40 分钟短休息');
  eq(dense.long.len, 900, '干眼友好：长休息 15 分钟');
  ok(Object.keys(PRESETS).length === 4, '预设共 4 档');

  const custom = merge(sanitize({}), { micro: { every: 700 } });
  eq(custom.micro.every, 700, 'merge 只改指定字段');
  eq(custom.short.every, 3000, 'merge 保留其余默认值');
}

section('配置 · 落盘读写');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyerest-test-'));
  const store = new Store(dir);
  eq(store.config.micro.every, 600, '首次启动读默认值');
  store.patch({ micro: { every: 900 } });
  const reopened = new Store(dir);
  eq(reopened.config.micro.every, 900, 'patch 后重新读盘能拿到新值');
  const used = store.usePreset('gentle');
  eq(used.micro.every, 900, '预设生效');
  eq(used.preset, 'gentle', '预设名落盘');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* -------------------------------- 计时器 -------------------------------- */

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

section('计时器 · 基本阈值');
{
  const t = new Tracker(sanitize({}));
  const hits = tickFor(t, 600);
  eq(hits.length, 1, '600 秒内只触发 1 次');
  eq(hits[0].kind, 'micro', '第一次触发微休息');
  eq(hits[0].at, 600, '恰好在第 600 秒触发');

  const t2 = new Tracker(sanitize({}));
  const hits2 = tickFor(t2, 599);
  eq(hits2.length, 0, '差 1 秒不触发');
  ok(t2.progress().micro > 0.99, '进度条接近满格');
}

section('计时器 · 两小时完整节奏');
{
  const t = new Tracker(sanitize({}));
  const hits = tickFor(t, 7200);
  const kinds = hits.map((h) => h.kind);
  const at = hits.map((h) => h.at);
  // 600/1200/1800/2400 微休息；3000 短休息（同时命中，短休息优先）
  eq(at.slice(0, 5).join(','), '600,1200,1800,2400,3000', '前 5 次触发时间点');
  eq(kinds.slice(0, 5).join(','), 'micro,micro,micro,micro,short', '第 50 分钟由短休息接管');
  ok(kinds.filter((k) => k === 'short').length === 2, '两小时内 2 次短休息');
  ok(kinds.filter((k) => k === 'long').length === 1, '两小时内 1 次长休息');
  eq(hits[hits.length - 1].kind, 'long', '最后一次是长休息');
  ok(hits[hits.length - 1].at >= 7199, '长休息在第 2 小时末尾触发');
  const microCount = kinds.filter((k) => k === 'micro').length;
  ok(microCount >= 8, `两小时内微休息次数合理（${microCount} 次）`);
}

section('计时器 · 空闲处理');
{
  const t = new Tracker(sanitize({}));
  tickFor(t, 700); // 第 600 秒触发一次微休息并清零，之后又走了 100 秒
  eq(t.micro, 100, '微休息后微计时从触发点重新开始');
  eq(t.short, 700, '短休息计时不清零');

  // 短暂离开（60–179 秒）：清微计时，其余暂停
  const shortBefore = t.short;
  eq(t.tick(1, 120, {}), null, '短暂离开不触发提醒');
  eq(t.micro, 0, '短暂离开清空微休息计时');
  eq(t.short, shortBefore, '短暂离开不累计短休息');
  const streakBefore = t.streak;
  eq(streakBefore, 100, '微休息后连续用眼从 0 重新计');
  eq(t.streak, streakBefore, '短暂离开不重置连续用眼');

  // 长时间离开（>=180 秒）：全部清零
  const t3 = new Tracker(sanitize({}));
  tickFor(t3, 500);
  ok(t3.short > 0, '先积累一些时间');
  t3.tick(1, 400, {});
  eq(t3.micro, 0, '离开 3 分钟以上：微计时清零');
  eq(t3.short, 0, '离开 3 分钟以上：短计时清零');
  eq(t3.long, 0, '离开 3 分钟以上：长计时清零');
  eq(t3.streak, 0, '离开 3 分钟以上：连续用眼清零');
}

section('计时器 · 休息中与暂停');
{
  const t = new Tracker(sanitize({}));
  for (let i = 0; i < 300; i++) t.tick(1, 0, { paused: true });
  eq(t.micro, 0, '休息中完全不累计');
  eq(t.activeToday, 0, '休息中不计入今日有效用眼');
  eq(t.lastAccumulated, 0, '休息中 lastAccumulated 为 0');
}

section('计时器 · 免打扰只累计不提醒，结束后不补发');
{
  const t = new Tracker(sanitize({}));
  const hits = [];
  for (let i = 0; i < 3000; i++) {
    const due = t.tick(1, 0, { silent: true });
    if (due) hits.push(due);
  }
  eq(hits.length, 0, '免打扰期间一次都不提醒');
  ok(t.micro >= 600, '免打扰期间照常累计用眼');
  t.clampAfterDnd();
  eq(t.micro, 600 - 180, '结束后把计时夹到「阈值 − 3 分钟」');
  eq(t.short, 3000 - 180, '短休息同样夹到阈值前 3 分钟');
  eq(t.long, 3000, '未到阈值的计时器不受影响');

  // 只看微休息：把短休息的阈值调远，避免同时命中
  const t2 = new Tracker(sanitize({ short: { every: 21600 } }));
  for (let i = 0; i < 3000; i++) t2.tick(1, 0, { silent: true });
  t2.clampAfterDnd();
  eq(t2.micro, 420, '同一个计时器夹取后为「阈值 − 3 分钟」');
  let fired = null;
  for (let i = 0; i < 179; i++) if (t2.tick(1, 0, {})) fired = i + 1;
  eq(fired, null, '夹取后 179 秒内不提醒');
  eq(t2.tick(1, 0, {}), 'micro', '第 180 秒才提醒');
}

section('计时器 · 强制闭眼轮次');
{
  const t = new Tracker(sanitize({}));
  eq(t.shouldForceMicro(), false, '第 1 次微休息只发光');
  t.noteMicroPassed();
  eq(t.shouldForceMicro(), false, '第 2 次仍然只发光');
  t.noteMicroPassed();
  eq(t.shouldForceMicro(), true, '第 3 次强制闭眼');
  t.resetMicroCycle();
  eq(t.shouldForceMicro(), false, '强制闭眼后重新计数');
  eq(t.microSeen, 0, '轮次归零');

  const one = new Tracker(sanitize({ micro: { forceEvery: 1 } }));
  eq(one.shouldForceMicro(), true, 'forceEvery=1 时每次都强制');
}

section('计时器 · 延后');
{
  const t = new Tracker(sanitize({}));
  tickFor(t, 400);
  t.deferFor('micro', 120);
  eq(t.micro, 600 - 120, '延后把计时拨回「还差 120 秒」');
  eq(t.due, null, '延后清除 due 状态');
  const t2 = new Tracker(sanitize({}));
  tickFor(t2, 3000);
  t2.deferFor('long', 300);
  eq(t2.long, 7200 - 300, '长休息延后 5 分钟');
}

section('计时器 · 进度换算');
{
  const t = new Tracker(sanitize({}));
  tickFor(t, 300);
  const p = t.progress();
  eq(p.micro, 0.5, '微休息进度 50%');
  eq(p.microLeft, 300, '剩余 300 秒');
  t.tick(1, 0, {});
  ok(p.microLeft >= 0, '剩余时间不会为负');
}

/* --------------------------------- 统计 --------------------------------- */

section('统计 · 按天聚合');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyerest-stats-'));
  const s = new Stats(dir);
  s.addActive(120);
  s.add('micro');
  s.add('micro');
  s.add('defer');
  const snap = s.snapshot();
  eq(snap.today.activeSec, 120, '今日有效用眼累计');
  eq(snap.today.micro, 2, '今日微休息计数');
  eq(snap.week.micro, 2, '本周汇总包含今日');
  eq(snap.recent.length, 7, '近 7 天数据长度');
  eq(snap.recent[6].date, dayKey(), '最后一天是今天');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(dayKey()), '日期键格式 YYYY-MM-DD');

  // 落盘：add 只打脏标记，save 真正写文件
  ok(fs.existsSync(path.join(dir, 'stats.json')) === false, 'add 之后不会立刻写盘（5 秒节流）');
  s.save();
  const s2 = new Stats(dir);
  eq(s2.snapshot().today.micro, 2, '统计能落盘并读回');
  ok(s2.dirty === false, '读回后没有待写标记');

  s.resetToday();
  eq(s.snapshot().today.micro, 0, '重置今天清零');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------- 免打扰 -------------------------------- */

section('免打扰 · 时段与降级');
{
  eq(hhmmToMinutes('08:30'), 510, 'HH:MM 转分钟');
  eq(hhmmToMinutes('bad'), null, '非法时间返回 null');

  const dnd = new Dnd();
  const off = sanitize({});
  eq(dnd.isSilent(off), false, '默认不静默');
  eq(dnd.isDowngraded(off), false, '没有会议进程时不降级');
  eq(dnd.describe(off), '正常', '状态描述为正常');

  const allDay = sanitize({ dnd: { quietHours: { enabled: true, start: '00:00', end: '23:59' } } });
  eq(dnd.inQuietHours(allDay), true, '全天勿扰时段内返回 true');
  eq(dnd.isSilent(allDay), true, '勿扰时段 → 静默');

  const disabled = sanitize({ dnd: { quietHours: { enabled: false, start: '00:00', end: '23:59' } } });
  eq(dnd.inQuietHours(disabled), false, '未启用勿扰时段时返回 false');

  dnd.startFocus(30);
  eq(dnd.focusActive(), true, '手动专注生效');
  eq(dnd.isSilent(off), true, '专注期间静默');
  ok(dnd.describe(off).includes('专注'), '状态描述包含「专注」');
  dnd.stopFocus();
  eq(dnd.focusActive(), false, '取消专注');

  dnd.meetingRunning = true;
  eq(dnd.isDowngraded(off), true, '会议软件在跑 → 降级');
  ok(dnd.describe(off).includes('会议'), '状态描述包含「会议」');
  eq(dnd.isSilent(off), false, '降级不等于静默：仍然计时');
  const noDowngrade = sanitize({ dnd: { meetingDowngrade: false } });
  eq(dnd.isDowngraded(noDowngrade), false, '关闭降级开关后不降级');
}

/* -------------------------------- 汇总 --------------------------------- */

console.log(`\n${'-'.repeat(52)}`);
if (fail === 0) {
  console.log(`全部通过：${pass} 项`);
} else {
  console.log(`通过 ${pass} 项，失败 ${fail} 项：`);
  for (const f of failures) console.log('  - ' + f);
}
process.exitCode = fail ? 1 : 0;
