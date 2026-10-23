'use strict';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') || 'break'; // glow | break | veil
const C = 2 * Math.PI * 88;

const $ = (id) => document.getElementById(id);
const glowEl = $('glow');
const glowHint = $('glowHint');
const brkEl = $('brk');
const kickerEl = $('kicker');
const labelEl = $('label');
const subEl = $('sub');
const timeEl = $('time');
const progEl = $('prog');
const blinkEl = $('blink');
const blinkCircle = $('blinkCircle');
const blinkWord = $('blinkWord');
const blinkRound = $('blinkRound');
const deferBtn = $('defer');
const endBtn = $('end');
const footEl = $('foot');

progEl.style.strokeDasharray = String(C);

if (MODE === 'veil') {
  document.body.classList.add('veil');
  brkEl.hidden = true;
  glowEl.hidden = true;
} else if (MODE === 'glow') {
  brkEl.hidden = true;
} else {
  glowEl.hidden = true;
}

let glowTimer = 0;

function showGlow(payload) {
  const ms = (payload && payload.ms) || 12000;
  glowEl.hidden = false;
  glowEl.classList.remove('play');
  void glowEl.offsetWidth;
  glowEl.classList.add('play');
  glowHint.textContent = (payload && payload.hint) || '眼睛该歇一下了 · 看 6 米外，或者干脆闭眼';
  glowHint.style.animation = 'none';
  void glowHint.offsetWidth;
  glowHint.style.animation = '';
  clearTimeout(glowTimer);
  glowTimer = setTimeout(() => {
    glowEl.hidden = true;
  }, Math.max(800, ms - 800));
}

const KICKER = { micro: '微休息', short: '短休息', long: '长休息' };
const COLORS = { eyes: '#9ddbb8', blink: '#e4bd7b', stretch: '#9ddbb8', away: '#9ddbb8' };

let cur = null;
let raf = 0;
let lastBlinkKey = '';

function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function updateBlink(elapsed, total) {
  const ROUND = 6000;
  const rounds = Math.max(1, Math.round(total / ROUND));
  const idx = Math.min(rounds - 1, Math.floor(elapsed / ROUND));
  const t = Math.max(0, elapsed - idx * ROUND);
  let word = '闭眼';
  let cls = 'small';
  if (t < 2000) {
    word = '闭眼';
    cls = 'small';
  } else if (t < 4000) {
    word = '闭着';
    cls = 'small';
  } else {
    word = '用力闭紧';
    cls = 'tight';
  }
  const key = word + ':' + idx;
  if (key === lastBlinkKey) return;
  lastBlinkKey = key;
  blinkWord.textContent = word;
  blinkCircle.classList.toggle('small', cls === 'small');
  blinkCircle.classList.toggle('tight', cls === 'tight');
  blinkRound.textContent = `第 ${idx + 1} / ${rounds} 轮`;
}

function frame() {
  if (!cur) return;
  const left = Math.max(0, cur.endsAt - Date.now());
  const total = Math.max(1, cur.ms);
  const frac = Math.min(1, Math.max(0, left / total));
  timeEl.textContent = fmtLeft(left);
  progEl.style.strokeDashoffset = String(C * (1 - frac));
  if (cur.phase === 'blink') updateBlink(total - left, total);
  if (left <= 0) return;
  raf = requestAnimationFrame(frame);
}

function showBreak(s) {
  cur = s;
  if (MODE !== 'break') return;

  brkEl.hidden = false;
  const kick = KICKER[s.kind] || '休息';
  kickerEl.textContent = s.total > 1 ? `${kick} · 第 ${s.index + 1} / ${s.total} 步` : kick;
  labelEl.textContent = s.label || '';
  subEl.textContent = s.sub || '';
  document.documentElement.style.setProperty('--accent', COLORS[s.phase] || '#4c8dff');

  blinkEl.hidden = s.phase !== 'blink';
  lastBlinkKey = '';

  deferBtn.hidden = !s.canDefer;
  deferBtn.textContent = `延后 ${s.deferMin || 5} 分钟`;
  endBtn.hidden = !s.allowEnd;

  const foot = [];
  if (s.canDefer) foot.push('Esc 延后');
  if (s.allowEnd) foot.push('回车 提前结束');

  footEl.textContent = foot.length ? foot.join('   ·   ') : '请闭眼休息，倒计时结束后自动继续';

  cancelAnimationFrame(raf);
  frame();
}

deferBtn.addEventListener('click', () => {
  if (cur) window.ov.action('defer', cur.token);
});

endBtn.addEventListener('click', () => {
  if (cur) window.ov.action('end', cur.token);
});

window.addEventListener('keydown', (e) => {
  if (!cur) return;
  if (e.key === 'Escape' && !deferBtn.hidden) window.ov.action('defer', cur.token);
  else if ((e.key === 'Enter' || e.key === ' ') && !endBtn.hidden) {
    e.preventDefault();
    window.ov.action('end', cur.token);
  }
});

window.ov.onGlow(showGlow);
window.ov.onBreak(showBreak);
window.ov.onHide(() => {
  cur = null;
  cancelAnimationFrame(raf);
  clearTimeout(glowTimer);
  glowEl.hidden = brkEl.hidden = true;
});
