'use strict';

const $ = (id) => document.getElementById(id);
let state = null;
let saveTimer = 0;
let dirty = false;
let presetKey = '';

function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function toast(text) {
  let el = document.querySelector('.saved');
  if (!el) {
    el = document.createElement('div');
    el.className = 'saved';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

function setVal(id, v) {
  const el = $(id);
  if (!el || document.activeElement === el) return;
  el.value = v;
}

function setChk(id, v) {
  const el = $(id);
  if (!el) return;
  el.checked = Boolean(v);
}

function num(id, def) {
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : def;
}

function chk(id) {
  return Boolean($(id).checked);
}

function val(id) {
  return $(id).value;
}

function renderConfig(cfg) {
  for (const kind of ['micro', 'short', 'long']) {
    setChk(kind + '-enabled', cfg[kind].enabled);
    setVal(kind + '-message', cfg[kind].message);
  }
  setVal('micro-every', Math.round(cfg.micro.every / 60));
  setVal('micro-len', cfg.micro.len);
  setVal('micro-forceEvery', cfg.micro.forceEvery);
  setVal('micro-forceLen', cfg.micro.forceLen);

  setVal('short-every', Math.round(cfg.short.every / 60));
  setVal('short-eyes', cfg.short.phases.eyes);
  setVal('short-blink', cfg.short.phases.blink);
  setVal('short-stretch', cfg.short.phases.stretch);

  setVal('long-every', Math.round(cfg.long.every / 60));
  setVal('long-len', Math.round(cfg.long.len / 60));
  setVal('long-eyes', cfg.long.eyes);

  setChk('meetingDowngrade', cfg.dnd.meetingDowngrade);
  setChk('quietOn', cfg.dnd.quietHours.enabled);
  setVal('quietStart', cfg.dnd.quietHours.start);
  setVal('quietEnd', cfg.dnd.quietHours.end);

  setChk('ui-glow', cfg.ui.glow);
  setChk('ui-sound', cfg.ui.sound);

  setChk('launchAtLogin', cfg.system.launchAtLogin);
  setChk('hideDock', cfg.system.hideDock);
  setChk('shortcuts', cfg.system.shortcuts);
  setVal('multiMonitor', cfg.system.multiMonitor);

  const total = cfg.short.phases.eyes + cfg.short.phases.blink + cfg.short.phases.stretch;
  $('short-total').textContent = `一轮短休息合计 ${fmtDur(total)}。闭眼那一步可以延后 1 次，延后 ${cfg.short.deferMinutes} 分钟。`;
  $('preset-hint').textContent = (state?.presets?.[cfg.preset]?.hint) || '自定义参数';
  $('rest3').textContent = `短休息（${fmtDur(cfg.short.len)}）`;
  $('rest10').textContent = `长休息（${fmtDur(cfg.long.len)}）`;
  renderDraft();
}

function renderPresets(state) {
  const key = JSON.stringify([state.presets, state.config.preset, saving]);
  if (key === presetKey) return;
  presetKey = key;
  const wrap = $('presets');
  wrap.innerHTML = '';
  for (const [key, meta] of Object.entries(state.presets)) {
    const div = document.createElement('button');
    div.type = 'button';
    div.disabled = saving;
    div.setAttribute('aria-pressed', String(state.config.preset === key));
    div.className = 'preset' + (state.config.preset === key ? ' active' : '');
    div.innerHTML = `<b></b><span></span>`;
    div.querySelector('b').textContent = meta.label;
    div.querySelector('span').textContent = meta.hint;
    div.addEventListener('click', () => choosePlan(key));
    wrap.appendChild(div);
  }
}

function collect() {
  return {
    micro: {
      enabled: chk('micro-enabled'),
      message: val('micro-message'),
      every: Math.round(num('micro-every', 10) * 60),
      len: Math.round(num('micro-len', 20)),
      forceEvery: Math.round(num('micro-forceEvery', 3)),
      forceLen: Math.round(num('micro-forceLen', 20)),
    },
    short: {
      enabled: chk('short-enabled'),
      message: val('short-message'),
      every: Math.round(num('short-every', 50) * 60),
      phases: {
        eyes: Math.round(num('short-eyes', 40)),
        blink: Math.round(num('short-blink', 20)),
        stretch: Math.round(num('short-stretch', 60)),
      },
    },
    long: {
      enabled: chk('long-enabled'),
      message: val('long-message'),
      every: Math.round(num('long-every', 120) * 60),
      len: Math.round(num('long-len', 10) * 60),
      eyes: Math.round(num('long-eyes', 60)),
    },
    dnd: {
      meetingDowngrade: chk('meetingDowngrade'),
      quietHours: { enabled: chk('quietOn'), start: val('quietStart'), end: val('quietEnd') },
    },
    ui: { glow: chk('ui-glow'), sound: chk('ui-sound') },
    system: {
      launchAtLogin: chk('launchAtLogin'),
      hideDock: chk('hideDock'),
      shortcuts: chk('shortcuts'),
      multiMonitor: val('multiMonitor'),
    },
  };
}

let saving = false;
let saveAgain = false;
let draftVersion = 0;

function saveStatus(text, failed = false) {
  $('save-status').textContent = text;
  $('save-status').className = 'save-status' + (failed ? ' error' : '');
  $('retrySave').hidden = !failed;
}

function setPlanBusy(busy) {
  $('resetPlan').disabled = busy;
  renderPresets(state);
}

function renderDraft() {
  for (const kind of ['micro', 'short', 'long']) {
    const enabled = chk(kind + '-enabled');
    $(kind + '-fields').disabled = !enabled;
    const seconds = kind === 'short'
      ? num('short-eyes', 40) + num('short-blink', 20) + num('short-stretch', 60)
      : num(kind + '-len', kind === 'micro' ? 20 : 10) * (kind === 'long' ? 60 : 1);
    $(kind + '-summary').textContent = enabled
      ? `每累计使用 ${num(kind + '-every', 10)} 分钟，${kind === 'micro' ? '轻提醒' : '休息'} ${fmtDur(seconds)}${kind === 'micro' ? '，并定期安排闭眼。' : '。'}`
      : '自动提醒已关闭，仍可手动开始休息。';
  }
  $('quietRow').hidden = !chk('quietOn');
  $('quietStart').disabled = $('quietEnd').disabled = !chk('quietOn');
  $('launchAtLogin').disabled = !state?.app.canLaunchAtLogin;
  $('hideDock').disabled = !state?.app.canHideDock;
  $('short-eyes').setCustomValidity('');
  const shortTotal = num('short-eyes', 0) + num('short-blink', 0) + num('short-stretch', 0);
  $('short-total').textContent = `一轮短休息合计 ${fmtDur(shortTotal)}。${num('short-eyes', 0) > 0 && state?.config.short.defer > 0 ? '闭眼这一步可延后；' : ''}每一步都可随时退出。`;
  if (shortTotal === 0) {
    $('short-eyes').setCustomValidity('请至少保留一项休息内容。');
  }
  $('long-eyes').setCustomValidity('');
  if (num('long-eyes', 0) > num('long-len', 10) * 60 - 60) {
    $('long-eyes').setCustomValidity('请至少留出 1 分钟离开屏幕的时间。');
  }
  for (const kind of ['micro', 'short', 'long']) {
    const invalid = [...INPUTS, ...MESSAGES].filter((id) => id.startsWith(kind + '-'))
      .map($).find((el) => !el.checkValidity());
    const error = $(kind + '-error');
    error.hidden = !invalid;
    error.textContent = invalid ? invalid.validationMessage : '';
  }
}

function validDraft() {
  return [...INPUTS, ...MESSAGES].every((id) => $(id).checkValidity());
}

async function choosePlan(key) {
  if (saving || !state) return;
  saving = true;
  setPlanBusy(true);
  for (const id of [...INPUTS, ...CHECKS, ...MESSAGES]) $(id).disabled = true;
  saveStatus('正在保存方案…');
  try {
    const s = key ? await window.api.preset(key) : await window.api.resetPlan();
    dirty = false;
    applyState(s);
    saveStatus(key ? '方案已应用并保存' : '已恢复推荐方案，其他偏好保持不变');
  } catch (err) {
    console.error('Failed to apply break plan', err);
    saveStatus('方案未能保存，请重试选择', false);
  } finally {
    saving = false;
    for (const id of [...INPUTS, ...CHECKS, ...MESSAGES]) $(id).disabled = false;
    renderDraft();
    setPlanBusy(false);
    if (saveAgain) await save();
  }
}

async function save() {
  if (!state) return;
  renderDraft();
  if (!validDraft()) {
    saveStatus('尚未保存：请检查时间范围与休息内容', true);
    return;
  }
  saveAgain = true;
  if (saving) return;
  saving = true;
  setPlanBusy(true);
  saveStatus('正在保存…');
  try {
    while (saveAgain) {
      saveAgain = false;
      if (!validDraft()) {
        saveStatus('尚未保存：请检查时间范围与休息内容', true);
        return;
      }
      const version = draftVersion;
      const s = await window.api.patch(collect());
      applyState(s, { keepInputs: true });
      if (!saveAgain && version === draftVersion) renderConfig(s.config);
      if (!saveAgain && version !== draftVersion) {
        saveStatus('有未保存的修改，编辑完成后自动保存');
        return;
      }
    }
    dirty = false;
    saveStatus('已自动保存，仅存于本机');
  } catch (err) {
    console.error('Failed to save settings', err);
    saveStatus('保存失败，你的修改仍在这里，请重试', true);
  } finally {
    saving = false;
    setPlanBusy(false);
  }
}

function renderStatus(s) {
  const p = s.progress;
  const focus = s.dnd.focusUntil > Date.now();
  const silent = s.paused || focus || s.dnd.quiet;
  const next = [
    ['long', '长休息'], ['short', '短休息'], ['micro', '微休息'],
  ].filter(([kind]) => s.config[kind].enabled)
    .sort(([a], [b]) => p[a + 'Left'] - p[b + 'Left']);
  const [kind, label] = next[0] || [];
  $('s-streak').textContent = fmtDur(p.streak);
  $('next-label').textContent = kind ? `下次${label}` : '自动提醒';
  $('s-micro').textContent = s.resting ? '休息中' : silent ? '免打扰' : kind ? fmtClock(p[kind + 'Left']) : '已关闭';
  $('s-today').textContent = fmtDur(s.stats.today.activeSec);
  $('bar-micro').style.width = `${!silent && !s.resting && kind ? Math.round(p[kind] * 100) : 0}%`;

  const dot = $('dot');
  dot.className = 'dot' + (s.resting ? ' rest' : silent ? ' paused' : '');

  const pauseBtn = $('pauseBtn');
  pauseBtn.textContent = s.paused ? `恢复提醒（还剩 ${s.pauseLeft} 分钟）` : '暂停提醒 30 分钟';
  $('endFocus').hidden = !focus;
  $('rest3').disabled = $('rest10').disabled = s.resting;

  const bits = [];
  if (s.resting) bits.push('正在休息');
  if (s.paused) bits.push(`提醒已暂停，还剩 ${s.pauseLeft} 分钟`);
  if (s.dnd.label && s.dnd.label !== '正常') bits.push(s.dnd.label);
  if (silent) bits.push('继续记录活跃时间');
  $('dnd-hint').textContent = bits.join(' · ') || '关闭设置窗口后，提醒仍会在后台运行；休息时可随时按 Esc 退出。';
}

function renderStats(s) {
  const t = s.stats.today;
  const cells = [
    ['微休息', t.micro, '次（其中闭眼提醒 ' + t.forced + ' 次）'],
    ['短休息', t.short, '次完成'],
    ['长休息', t.long, '次完成'],
    ['提醒', t.reminded, '次触发'],
    ['延后', t.defer, '次'],
    ['跳过', t.skip, '次'],
  ];
  $('statsGrid').textContent = '';
  for (const [name, value, description] of cells) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const number = document.createElement('b');
    number.textContent = value ?? 0;
    const label = document.createElement('span');
    label.textContent = `${name} · ${description}`;
    cell.appendChild(number);
    cell.appendChild(label);
    $('statsGrid').appendChild(cell);
  }

  const recent = s.stats.recent || [];
  const max = Math.max(1800, ...recent.map((d) => d.activeSec || 0));

  const chart = $('chart');
  chart.textContent = '';
  for (const d of recent) {
    const h = Math.max(2, Math.round(((d.activeSec || 0) / max) * 62));
    const col = document.createElement('div');
    col.className = 'col';
    col.title = `${d.date} · ${fmtDur(d.activeSec)}`;
    const bar = document.createElement('i');
    bar.style.height = h + 'px';
    const label = document.createElement('em');
    label.textContent = d.date.slice(5).replace('-', '/');
    col.appendChild(bar);
    col.appendChild(label);
    chart.appendChild(col);
  }
}

function applyState(s, opts = {}) {
  state = s;
  if (!opts.keepInputs) renderConfig(s.config);
  renderPresets(s);
  renderStatus(s);
  renderStats(s);

  const dockRow = $('row-hideDock');
  if (dockRow) dockRow.style.display = s.app.canHideDock ? '' : 'none';
  $('launchAtLogin').disabled = !s.app.canLaunchAtLogin;
  $('login-hint').hidden = Boolean(s.app.canLaunchAtLogin);
  $('version').textContent = 'v' + s.app.version;
  $('about').textContent = `EyeRecess（课间）${s.app.version} · 帮助建立定期休息的习惯`;
}

const INPUTS = [
  'micro-every',
  'micro-len',
  'micro-forceEvery',
  'micro-forceLen',
  'short-every',
  'short-eyes',
  'short-blink',
  'short-stretch',
  'long-every',
  'long-len',
  'long-eyes',
  'quietStart',
  'quietEnd',
  'multiMonitor',
];

const MESSAGES = ['micro-message', 'short-message', 'long-message'];
const CHECKS = ['micro-enabled', 'short-enabled', 'long-enabled', 'meetingDowngrade', 'quietOn', 'ui-glow', 'ui-sound', 'launchAtLogin', 'hideDock', 'shortcuts'];

for (const id of [...INPUTS, ...CHECKS, ...MESSAGES]) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener('change', save);
  el.addEventListener('input', () => {
    dirty = true;
    draftVersion++;
    renderDraft();
    saveStatus('有未保存的修改，编辑完成后自动保存');
  });
}

$('resetPlan').addEventListener('click', () => choosePlan());
$('retrySave').addEventListener('click', save);

async function runAction(action, success) {
  try {
    const next = await action();
    if (!next?.config) throw new Error('Missing application state');
    applyState(next, { keepInputs: true });
    if (success) toast(success);
  } catch (error) {
    console.error('Desktop action failed', error);
    toast('操作未完成，请稍后重试');
  }
}

$('rest3').addEventListener('click', () => runAction(() => window.api.startBreak('short')));
$('rest10').addEventListener('click', () => runAction(() => window.api.startBreak('long')));
$('pauseBtn').addEventListener('click', () => {
  const s = state;
  return runAction(() => window.api.pause(s && s.paused ? 0 : 30));
});
$('endFocus').addEventListener('click', () => runAction(() => window.api.focus(0), '已结束专注，其他免打扰设置仍然有效'));
$('quit').addEventListener('click', () => window.api.quit());
let resetConfirmation = false;
let resetTimer;
$('resetStats').addEventListener('click', () => {
  if (!resetConfirmation) {
    resetConfirmation = true;
    $('resetStats').textContent = '再次点击，确认清空今天的统计';
    resetTimer = setTimeout(() => {
      resetConfirmation = false;
      $('resetStats').textContent = '清空今天的统计';
    }, 5000);
    return;
  }
  clearTimeout(resetTimer);
  resetConfirmation = false;
  $('resetStats').textContent = '清空今天的统计';
  return runAction(() => window.api.resetStats(), '今天的统计已清空');
});

window.api.onState((s) => {
  applyState(s, { keepInputs: dirty || saving });
});

function showSection(section, behavior = 'smooth') {
  const el = $('sec-' + section);
  if (!el) return;
  let parent = el;
  while (parent) {
    if (parent.tagName === 'DETAILS') parent.open = true;
    parent = parent.parentElement;
  }
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduceMotion ? 'instant' : behavior, block: 'start' });
}

window.api.onScrollTo((section) => showSection(section));
for (const button of document.querySelectorAll('[data-section]')) {
  button.addEventListener('click', () => showSection(button.dataset.section));
}

(async () => {
  const s = await window.api.getState();
  applyState(s);
  const section = new URLSearchParams(location.search).get('section');
  if (section) showSection(section, 'instant');
})().catch((err) => {
  console.error('Failed to load settings', err);
  saveStatus('设置暂时无法加载，请关闭后重新打开', false);
});
