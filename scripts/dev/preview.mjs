// Generate a static settings preview outside the production source tree.
// Run with npm run preview.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { DEFAULTS, PRESETS, applyPreset } = require(path.join(root, 'src/main/config.js'));

const cfg = applyPreset(JSON.parse(JSON.stringify(DEFAULTS)), 'standard');

const today = { activeSec: 8340, micro: 13, forced: 4, short: 2, long: 0, defer: 1, skip: 1, reminded: 21 };
const days = [
  ['2026-10-17', 16440], ['2026-10-18', 9240], ['2026-10-19', 18600],
  ['2026-10-20', 6120], ['2026-10-21', 14400], ['2026-10-22', 10800], ['2026-10-23', 8340],
];

const state = {
  config: cfg,
  presets: Object.fromEntries(Object.entries(PRESETS).map(([key, { label, hint }]) => [key, { label, hint }])),
  stats: { today, recent: days.map(([date, activeSec]) => ({ date, activeSec })) },
  progress: { streak: 1380, microLeft: 240, micro: 0.6, shortLeft: 1620, short: 0.46, longLeft: 5820, long: 0.19 },
  dnd: { label: '\u6b63\u5e38', meeting: false, focusUntil: 0, quiet: false },
  resting: false,
  paused: false,
  pauseLeft: 0,
  app: {
    name: 'EyeRecess',
    version: require(path.join(root, 'package.json')).version,
    canHideDock: true,
    canLaunchAtLogin: false,
  },
};

const mock = `
/* In-memory preview data; no desktop operations or persistent writes. */
const STATE = ${JSON.stringify(state)};
const DEFAULTS = ${JSON.stringify(DEFAULTS)};
const PRESETS = ${JSON.stringify(PRESETS)};
function merge(base, patch) {
  const next = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(next[key] || {}, value) : value;
  }
  return next;
}
function update(partial) {
  STATE.config = merge(STATE.config, partial);
  const phases = STATE.config.short.phases;
  STATE.config.short.len = phases.eyes + phases.blink + phases.stretch;
  return STATE;
}
const noop = async () => STATE;
window.api = {
  getState: noop,
  patch: async (partial) => update({ ...partial, preset: 'custom' }),
  preset: async (name) => {
    const { micro, short, long } = PRESETS[name];
    return update({ preset: name, micro, short, long });
  },
  resetPlan: async () => update({ preset: 'standard', micro: DEFAULTS.micro, short: DEFAULTS.short, long: DEFAULTS.long }),
  pause: async (minutes) => {
    STATE.paused = minutes > 0;
    STATE.pauseLeft = minutes;
    return STATE;
  },
  focus: noop,
  startBreak: noop, resetStats: noop,
  quit: () => {}, openExternal: () => {}, onState: () => {}, onScrollTo: () => {},
};
`;

const sourceDir = path.join(root, 'src/renderer/settings');
const dir = path.join(root, '.local/preview/settings');
mkdirSync(dir, { recursive: true });
for (const name of ['settings.js', 'settings.css']) copyFileSync(path.join(sourceDir, name), path.join(dir, name));
copyFileSync(path.join(root, 'assets/mark.svg'), path.join(dir, 'mark.svg'));
const html = readFileSync(path.join(sourceDir, 'index.html'), 'utf8');
const out = html.replace('../../../assets/mark.svg', 'mark.svg').replace(
  '<script src="settings.js"></script>',
  `<script src="_preview-api.js"></script>\n    <script src="settings.js"></script>`
);
if (out === html) throw new Error('Cannot locate the settings script for preview injection');

const target = path.join(dir, 'index.html');
writeFileSync(path.join(dir, '_preview-api.js'), mock, 'utf8');
writeFileSync(target, out, 'utf8');
console.log(`Generated: ${path.relative(root, target)}`);
console.log('Open this file in a browser. Settings changes use memory only; desktop actions are disabled.');
