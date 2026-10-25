'use strict';
// Settings-save behavior with a minimal DOM substitute; layout is not tested.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitize, merge, PRESETS } = require('../../src/main/config');

function element() {
  const children = new Map();
  const handlers = new Map();
  return {
    value: '', checked: false, style: {}, textContent: '',
    disabled: false, hidden: false, validationMessage: '',
    classList: { add() {}, remove() {} },
    appendChild() {}, setAttribute() {}, scrollIntoView(options) { this.scrolled = options; },
    addEventListener(name, fn) { handlers.set(name, fn); },
    emit(name) { return handlers.get(name)?.(); },
    setCustomValidity(message) { this.validationMessage = message; },
    checkValidity() { return this.disabled || !this.validationMessage; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
  };
}

async function main() {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  let cfg = sanitize({});
  const snapshot = () => ({
    config: cfg, presets: PRESETS,
    progress: { micro: 0, short: 0, long: 0, streak: 0, microLeft: 600, shortLeft: 3000, longLeft: 7200 },
    dnd: { label: '\u6b63\u5e38', focusUntil: 0, quiet: false }, paused: false, resting: false,
    stats: { today: { activeSec: 0 }, recent: [] },
    app: { version: 'test', canHideDock: true },
  });
  const pending = [];
  let receiveState;
  const navButton = element();
  navButton.dataset = { section: 'dnd' };
  const api = {
    getState: async () => snapshot(),
    patch: (partial) => new Promise((resolve) => pending.push({ partial, resolve })),
    onState(fn) { receiveState = fn; }, onScrollTo() {},
  };
  const context = vm.createContext({
    document: {
      getElementById: getElement, activeElement: null,
      createElement: element, querySelector: () => null, body: element(),
      querySelectorAll: () => [navButton],
    },
    window: { api }, location: { search: '' }, URLSearchParams,
    console, setTimeout: () => 1, clearTimeout() {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/settings/settings.js'), 'utf8');
  vm.runInContext(source, context);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const complete = (request) => {
    cfg = sanitize(merge(cfg, request.partial));
    request.resolve(snapshot());
  };
  await flush();
  assert.equal(getElement('launchAtLogin').disabled, true, 'Source-only capabilities are unavailable');
  assert.equal(getElement('login-hint').hidden, false, 'Unavailable login integration has an explanation');
  assert.match(getElement('rest3').textContent, /2 \u5206\u949f/);
  assert.doesNotMatch(getElement('about').textContent, /Electron|undefined|\/test/, 'About text excludes runtime diagnostics');
  assert.equal(getElement('s-micro').textContent, '10:00');
  assert.equal(getElement('endFocus').hidden, true);
  receiveState({ ...snapshot(), paused: true, pauseLeft: 17 });
  assert.notEqual(getElement('s-micro').textContent, '10:00', 'Paused reminders do not show a running countdown');
  assert.equal(getElement('bar-micro').style.width, '0%');
  assert.match(getElement('pauseBtn').textContent, /17/);
  receiveState({ ...snapshot(), dnd: { focusUntil: Date.now() + 60000 } });
  assert.equal(getElement('endFocus').hidden, false, 'Manual focus has an exit in settings');
  let focusMinutes;
  api.focus = async (minutes) => { focusMinutes = minutes; return snapshot(); };
  await getElement('endFocus').emit('click');
  assert.equal(focusMinutes, 0);
  assert.equal(getElement('endFocus').hidden, true);
  receiveState({ ...snapshot(), dnd: { quiet: true } });
  assert.notEqual(getElement('s-micro').textContent, '10:00', 'Quiet hours suppress the displayed countdown');
  cfg.micro.enabled = false;
  receiveState(snapshot());
  assert.equal(getElement('s-micro').textContent, '50:00', 'The next enabled break remains visible when micro reminders are off');
  cfg.micro.enabled = true;
  receiveState({ ...snapshot(), progress: { ...snapshot().progress, microLeft: 120, shortLeft: 120, longLeft: 120 } });
  assert.equal(getElement('s-micro').textContent, '2:00');
  assert.equal(getElement('next-label').textContent.includes('\u957f'), true, 'Tied reminders follow the long-break priority');
  receiveState({ ...snapshot(), resting: true });
  assert.notEqual(getElement('s-micro').textContent, '10:00', 'An active break does not show a work countdown');
  assert.equal(getElement('rest3').disabled, true);
  const external = sanitize(merge(cfg, { micro: { every: 720 } }));
  receiveState({ ...snapshot(), config: external });
  assert.equal(getElement('micro-every').value, 12, 'Clean inputs follow changes made outside settings');
  receiveState(snapshot());
  const advanced = getElement('advanced-settings');
  advanced.tagName = 'DETAILS';
  getElement('sec-dnd').parentElement = advanced;
  navButton.emit('click');
  assert.equal(advanced.open, true, 'Navigation reveals collapsed settings');
  assert.ok(getElement('sec-dnd').scrolled, 'Navigation scrolls to the chosen section');

  getElement('micro-every').value = '12';
  const firstSave = vm.runInContext('save()', context);
  assert.equal(pending.length, 1);
  getElement('micro-every').value = '14';
  getElement('ui-sound').checked = true;
  await vm.runInContext('save()', context);
  assert.equal(pending.length, 1, 'Edits are queued while a save is pending');

  complete(pending[0]);
  await flush();
  assert.equal(pending.length, 2, 'Queued edits are submitted after the first save');
  assert.equal(pending[1].partial.micro.every, 840, 'Queued saves use the latest input');
  assert.equal(pending[1].partial.ui.sound, true, 'Checkbox edits are preserved');
  complete(pending[1]);
  await firstSave;
  assert.equal(cfg.micro.every, 840);
  assert.equal(cfg.ui.sound, true);

  getElement('short-enabled').checked = false;
  getElement('micro-message').value = '<b>Take a moment</b>';
  const customize = vm.runInContext('save()', context);
  complete(pending[2]);
  await customize;
  assert.equal(cfg.short.enabled, false, 'Automatic reminders can be disabled independently');
  assert.equal(getElement('short-fields').disabled, true, 'Disabled reminders make their options inactive');
  assert.equal(cfg.micro.message, '<b>Take a moment</b>', 'Custom hints are saved as text');

  getElement('short-enabled').checked = true;
  for (const phase of ['eyes', 'blink', 'stretch']) getElement('short-' + phase).value = '0';
  await vm.runInContext('save()', context);
  assert.equal(pending.length, 3, 'An empty short-break plan is not submitted');
  assert.equal(getElement('retrySave').hidden, false, 'Invalid drafts have a visible recovery action');
  getElement('short-stretch').value = '60';

  const inFlight = vm.runInContext('save()', context);
  getElement('micro-message').value = 'Still editing';
  getElement('micro-message').emit('input');
  receiveState(snapshot());
  assert.equal(getElement('micro-message').value, 'Still editing', 'Periodic state updates retain drafts during saving');
  complete(pending[3]);
  await inFlight;
  assert.equal(getElement('micro-message').value, 'Still editing', 'A late save response does not overwrite a newer draft');
  receiveState(snapshot());
  assert.equal(getElement('micro-message').value, 'Still editing', 'An unsaved draft survives later state updates');

  getElement('long-eyes').value = '600';
  getElement('long-len').value = '2';
  await vm.runInContext('save()', context);
  assert.equal(pending.length, 4, 'Long-break eye closure must leave time away');
  getElement('long-eyes').value = '60';

  api.resetPlan = async () => {
    cfg = sanitize(merge(cfg, { preset: 'standard', micro: sanitize({}).micro, short: sanitize({}).short, long: sanitize({}).long }));
    return snapshot();
  };
  await vm.runInContext('choosePlan()', context);
  assert.equal(cfg.micro.every, 600, 'Recommended timings can be restored');
  assert.equal(getElement('micro-message').value, '', 'Restoring the plan clears custom hints');
  assert.equal(cfg.ui.sound, true, 'Restoring a plan preserves other preferences');

  api.patch = async () => { throw new Error('expected test failure'); };
  context.console = { ...console, error() {} };
  await vm.runInContext('save()', context);
  api.patch = async (partial) => {
    cfg = sanitize(merge(cfg, partial));
    return snapshot();
  };
  getElement('micro-every').value = '16';
  await vm.runInContext('save()', context);
  assert.equal(cfg.micro.every, 960, 'Saving can be retried after failure');
  let resetCalls = 0;
  api.resetStats = async () => { resetCalls++; return snapshot(); };
  await getElement('resetStats').emit('click');
  assert.equal(resetCalls, 0, 'Statistics reset requires confirmation');
  await getElement('resetStats').emit('click');
  assert.equal(resetCalls, 1, 'The second click performs the confirmed reset');
  api.startBreak = async () => { throw new Error('Expected desktop failure'); };
  await getElement('rest3').emit('click');
  assert.equal(cfg.micro.every, 960, 'A failed desktop action does not change preferences');
  console.log('Settings tests passed: customization, validation, draft preservation, reset, queued edits, and retry');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
