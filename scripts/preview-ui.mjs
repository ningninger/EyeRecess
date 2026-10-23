// 生成设置页的离线预览（不需要 Electron）：
//   node scripts/preview-ui.mjs
// 然后用浏览器打开 src/renderer/settings/_preview.html 就能看到界面长什么样。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULTS, applyPreset } = require(path.join(root, 'src/main/config.js'));

const cfg = applyPreset(JSON.parse(JSON.stringify(DEFAULTS)), 'standard');

const today = { activeSec: 8340, micro: 13, forced: 4, short: 2, long: 0, defer: 1, skip: 1, reminded: 21 };
const days = [
  ['2026-10-17', 16440], ['2026-10-18', 9240], ['2026-10-19', 18600],
  ['2026-10-20', 6120], ['2026-10-21', 14400], ['2026-10-22', 10800], ['2026-10-23', 8340],
];

const state = {
  config: cfg,
  presets: {
    standard: { label: '标准（推荐）', hint: '10 分钟微休息 · 50 分钟短休息 · 2 小时长休息' },
    dense: { label: '加强', hint: '6 分钟微休息 · 40 分钟短休息 · 100 分钟长休息' },
    classic: { label: '20-20-20', hint: '每 20 分钟看 20 英尺外 20 秒' },
    gentle: { label: '温和', hint: '15 分钟微休息 · 60 分钟短休息 · 2 小时长休息' },
  },
  stats: { today, recent: days.map(([date, activeSec]) => ({ date, activeSec })) },
  progress: { streak: 1380, microLeft: 240, micro: 0.6 },
  dnd: { label: '正常', meeting: false, focusUntil: 0, quiet: false },
  resting: false,
  paused: false,
  pauseLeft: 0,
  app: {
    name: 'EyeRest',
    version: '0.1.0',
    platform: 'darwin',
    configDir: '~/Library/Application Support/EyeRest',
    electron: '45.0.0',
  },
};

const mock = `<script>
/* 预览用的假数据，只在这个 _preview.html 里生效 */
const STATE = ${JSON.stringify(state)};
const noop = async () => STATE;
window.api = {
  getState: noop, patch: noop, preset: noop, pause: noop, focus: noop,
  startBreak: noop, resetStats: noop,
  quit: () => {}, openExternal: () => {}, onState: () => {}, onScrollTo: () => {},
};
</script>`;

const dir = path.join(root, 'src/renderer/settings');
const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
const out = html.replace(
  '<script src="settings.js"></script>',
  `${mock}\n    <script src="settings.js"></script>`
);
if (out === html) throw new Error('没找到 settings.js 的 script 标签，注入失败');

const target = path.join(dir, '_preview.html');
writeFileSync(target, out, 'utf8');
console.log(`已生成：${path.relative(root, target)}`);
console.log('用浏览器打开它就能看到设置页（数据是假的，只为了看排版）。');
