'use strict';
// Exercise always-available exit controls with a minimal DOM substitute.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const handlers = new Map();
    elements.set(id, {
      hidden: true, textContent: '', offsetWidth: 100, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener: (name, fn) => handlers.set(name, fn),
      click: () => handlers.get('click')?.(),
    });
  }
  return elements.get(id);
}
const actions = [];
const handlers = {};
let keydown;
const context = vm.createContext({
  document: { getElementById: element, body: element('body'), documentElement: { style: { setProperty() {} } } },
  location: { search: '?mode=break' }, URLSearchParams,
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {},
  window: {
    addEventListener: (name, fn) => { if (name === 'keydown') keydown = fn; },
    ov: {
      action: (...args) => actions.push(args),
      onGlow: (fn) => { handlers.glow = fn; }, onBreak: (fn) => { handlers.break = fn; }, onHide: (fn) => { handlers.hide = fn; },
    },
  },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/renderer/overlay/overlay.js'), 'utf8'), context);
let token = 0;
for (const [elapsed, expected] of [[0, '\u95ed\u773c'], [2000, '\u653e\u677e'], [4000, '\u7741\u773c']]) {
  vm.runInContext(`updateBlink(${elapsed}, 20000)`, context);
  assert.equal(element('blinkWord').textContent, expected, 'Blink guidance closes, relaxes, and opens gently');
}
for (const phase of ['eyes', 'blink', 'stretch', 'away']) {
  for (const canDefer of [true, false]) {
    token++;
    handlers.break({ token, kind: 'short', phase, canDefer, allowEnd: false, ms: 20000, endsAt: Date.now() + 20000 });
    assert.equal(element('end').hidden, false, 'Exit remains visible even for an older restrictive payload');
    element('end').click();
    element('close').click();
    keydown({ key: 'Escape', preventDefault() {} });
    assert.deepEqual(actions.slice(-3), Array.from({ length: 3 }, () => ['cancel', token]), 'Both buttons and Escape cancel every phase');
    handlers.hide();
    const before = actions.length;
    keydown({ key: 'Escape', preventDefault() {} });
    element('close').click();
    assert.equal(actions.length, before, 'Hidden overlays cannot send stale cancellation');
  }
}
handlers.glow({ token: 100, ms: 20000 });
element('dismissGlow').click();
assert.deepEqual(actions.at(-1), ['dismiss-glow', 100], 'The glow close button carries its current token');
handlers.hide();
const before = actions.length;
element('dismissGlow').click();
assert.equal(actions.length, before);
console.log('Overlay renderer tests passed: both exit buttons, Escape, glow dismissal, and hidden-state cleanup');
