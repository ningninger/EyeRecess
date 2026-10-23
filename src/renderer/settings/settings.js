'use strict';

const $ = (id) => document.getElementById(id);
let state = null;
let saveTimer = 0;

/* --------------------------------- 工具 ---------------------------------- */

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
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

/* -------------------------------- 表单读写 -------------------------------- */

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

  $('quietRow').style.display = cfg.dnd.quietHours.enabled ? '' : 'none';

  const total = cfg.short.phases.eyes + cfg.short.phases.blink + cfg.short.phases.stretch;
  $('short-total').textContent = `一轮短休息合计 ${fmtDur(total)}。闭眼那一步可以延后 1 次，延后 ${cfg.short.deferMinutes} 分钟。`;
  $('preset-hint').textContent = (state?.presets?.[cfg.preset]?.hint) || '自定义参数';
}

function renderPresets(state) {
  const wrap = $('presets');
  wrap.innerHTML = '';
  for (const [key, meta] of Object.entries(state.presets)) {
    const div = document.createElement('div');
    div.className = 'preset' + (state.config.preset === key ? ' active' : '');
    div.innerHTML = `<b></b><span></span>`;
    div.querySelector('b').textContent = meta.label;
    div.querySelector('span').textContent = meta.hint;
    div.addEventListener('click', async () => {
      const s = await window.api.preset(key);
      applyState(s);
    });
    wrap.appendChild(div);
  }
}

function collect() {
  return {
    micro: {
      every: Math.round(num('micro-every', 10) * 60),
      len: Math.round(num('micro-len', 30)),
      forceEvery: Math.round(num('micro-forceEvery', 3)),
      forceLen: Math.round(num('micro-forceLen', 20)),
    },
    short: {
      every: Math.round(num('short-every', 50) * 60),
      phases: {
        eyes: Math.round(num('short-eyes', 90)),
        blink: Math.round(num('short-blink', 30)),
        stretch: Math.round(num('short-stretch', 80)),
      },
    },
    long: {
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

let patchQueued = false;

async function save() {
  if (patchQueued) return;
  patchQueued = true;
  try {
    const s = await window.api.patch(collect());
    applyState(s, { keepInputs: true });
    $('quietRow').style.display = s.config.dnd.quietHours.enabled ? '' : 'none';
    const total = s.config.short.phases.eyes + s.config.short.phases.blink + s.config.short.phases.stretch;
    $('short-total').textContent = `一轮短休息合计 ${fmtDur(total)}。闭眼那一步可以延后 1 次，延后 ${s.config.short.deferMinutes} 分钟。`;
    $('preset-hint').textContent = '自定义参数';
    toast('已保存');
  } finally {
    setTimeout(() => (patchQueued = false), 120);
  }
}

/* --------------------------------- 渲染 ---------------------------------- */

function renderStatus(s) {
  const p = s.progress;
  $('s-streak').textContent = fmtDur(p.streak);
  $('s-micro').textContent = fmtClock(p.microLeft);
  $('s-today').textContent = fmtDur(s.stats.today.activeSec);
  $('bar-micro').style.width = `${Math.round(p.micro * 100)}%`;

  const dot = $('dot');
  dot.className = 'dot' + (s.resting ? ' rest' : s.paused ? ' paused' : '');

  const pauseBtn = $('pauseBtn');
  pauseBtn.textContent = s.paused ? `恢复计时（还剩 ${s.pauseLeft} 分钟）` : '暂停 30 分钟';

  const bits = [];
  if (s.resting) bits.push('正在休息');
  if (s.paused) bits.push(`已暂停 ${s.pauseLeft} 分钟`);
  if (s.dnd.label && s.dnd.label !== '正常') bits.push(s.dnd.label);
  $('dnd-hint').textContent = bits.join(' · ');
}

function renderStats(s) {
  const t = s.stats.today;
  const cells = [
    ['微休息', t.micro, '次（其中强制闭眼 ' + t.forced + ' 次）'],
    ['短休息', t.short, '次完成'],
    ['长休息', t.long, '次完成'],
    ['提醒', t.reminded, '次触发'],
    ['延后', t.defer, '次'],
    ['跳过', t.skip, '次'],
  ];
  $('statsGrid').innerHTML = cells
    .map(
      ([k, v, sub]) =>
        `<div class="cell"><b>${v}</b><span>${k} · ${sub}</span></div>`
    )
    .join('');

  const recent = s.stats.recent || [];
  const max = Math.max(1800, ...recent.map((d) => d.activeSec || 0));
  // 用 CSSOM 设置高度：页面有严格 CSP，写 style 属性会被拦掉
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
  else {
    $('quietRow').style.display = s.config.dnd.quietHours.enabled ? '' : 'none';
  }
  renderPresets(s);
  renderStatus(s);
  renderStats(s);
  // 「隐藏 Dock 图标」只在 macOS 上有意义
  const dockRow = $('row-hideDock');
  if (dockRow) dockRow.style.display = s.app.platform === 'darwin' ? '' : 'none';
  $('version').textContent = 'v' + s.app.version;
  $('about').textContent = `EyeRecess（课间）${s.app.version} · Electron ${s.app.electron} · ${s.app.platform}\n配置与统计保存在：${s.app.configDir}`;
}

/* --------------------------------- 事件 ---------------------------------- */

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

const CHECKS = ['meetingDowngrade', 'quietOn', 'ui-glow', 'ui-sound', 'launchAtLogin', 'hideDock', 'shortcuts'];

for (const id of [...INPUTS, ...CHECKS]) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener('change', save);
  if (el.type === 'number') el.addEventListener('blur', save);
}

$('rest3').addEventListener('click', async () => applyState(await window.api.startBreak('short')));
$('rest10').addEventListener('click', async () => applyState(await window.api.startBreak('long')));
$('pauseBtn').addEventListener('click', async () => {
  const s = state;
  applyState(await window.api.pause(s && s.paused ? 0 : 30));
});
$('quit').addEventListener('click', () => window.api.quit());
$('resetStats').addEventListener('click', async () => {
  applyState(await window.api.resetStats());
  toast('今天的统计已清空');
});

window.api.onState((s) => {
  state = s;
  renderStatus(s);
  renderStats(s);
});

window.api.onScrollTo((section) => {
  const el = $('sec-' + section);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* --------------------------------- 启动 ---------------------------------- */

(async () => {
  const s = await window.api.getState();
  applyState(s);
  const section = new URLSearchParams(location.search).get('section');
  if (section) {
    const el = $('sec-' + section);
    if (el) el.scrollIntoView({ block: 'start' });
  }
})();
