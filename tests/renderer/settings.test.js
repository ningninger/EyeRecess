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
    appendChild() {}, setAttribute() {},
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
    progress: { micro: 0, streak: 0, microLeft: 600 },
    dnd: { label: '\u6b63\u5e38' }, paused: false, resting: false,
    stats: { today: { activeSec: 0 }, recent: [] },
    app: { version: 'test', canHideDock: true },
  });
  const pending = [];
  const api = {
    getState: async () => snapshot(),
    patch: (partial) => new Promise((resolve) => pending.push({ partial, resolve })),
    onState() {}, onScrollTo() {},
  };
  const context = vm.createContext({
    document: {
      getElementById: getElement, activeElement: null,
      createElement: element, querySelector: () => null, body: element(),
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
  assert.match(getElement('rest3').textContent, /3 \u5206 20 \u79d2/);
  assert.doesNotMatch(getElement('about').textContent, /Electron|undefined|\/test/, 'About text excludes runtime diagnostics');

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
  complete(pending[3]);
  await inFlight;
  assert.equal(getElement('micro-message').value, 'Still editing', 'A late save response does not overwrite a newer draft');

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
