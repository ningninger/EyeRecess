'use strict';
// Verify renderer identity, permission denials, and local resource boundaries.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');
const security = require('../../src/main/security');

const settings = pathToFileURL(path.join(security.RENDERER_ROOT, 'settings/index.html')).href;
const overlay = pathToFileURL(path.join(security.RENDERER_ROOT, 'overlay/index.html')).href;
function contents(id, url) {
  return { id, mainFrame: { url }, getURL() { return this.mainFrame.url; }, once(_name, fn) { this.destroy = fn; } };
}
const page = security.trust(contents(1, settings));
const mask = security.trust(contents(2, overlay), 'overlay');
const event = (wc) => ({ sender: wc, senderFrame: wc.mainFrame });
assert.equal(security.assertTrusted(event(page)), true);
assert.equal(security.assertTrusted(event(mask)), false, 'Overlays cannot control settings');
assert.equal(security.assertTrusted(event(mask), 'overlay'), true);
assert.equal(security.assertTrusted({ sender: page, senderFrame: { url: settings } }), false, 'Matching child URLs never confer main-frame privileges');
assert.equal(security.assertTrusted({ sender: page }), false, 'A missing frame never falls back to the page URL');
page.mainFrame.url = 'https://example.com';
assert.equal(security.assertTrusted(event(page)), false);
page.mainFrame.url = settings;
page.destroy();
assert.equal(security.assertTrusted(event(page)), false, 'Destroyed renderers lose their registration');
for (const url of [settings.replace('index.html', 'other.html'), 'file://server/share/index.html', 'data:text/html,test', settings.replace('/settings/', '/settings/../../')]) {
  assert.equal(security.isAppUrl(url), false);
}
assert.equal(security.isAppUrl(settings + '?section=stats#today', 'settings'), true);
for (const url of ['javascript:alert(1)', 'file:///private/example', 'https://user:secret@example.com', 'https://example.com\n', { url: 'https://example.com' }]) {
  assert.equal(security.safeOpenExternal(url), false);
}
assert.equal(security.safeOpenExternal('https://example.com/\nfoo'), false);
assert.equal(security.safeOpenExternal('https://example.com'), true);

const handlers = {};
const session = {
  setPermissionRequestHandler(fn) { handlers.request = fn; },
  setPermissionCheckHandler(fn) { handlers.check = fn; },
  setDevicePermissionHandler(fn) { handlers.device = fn; },
  setSpellCheckerEnabled() {},
  webRequest: { onBeforeRequest(fn) { handlers.resource = fn; } },
};
const originalLoad = Module._load;
Module._load = function(name) {
  if (name === 'electron') return { session: { defaultSession: session } };
  return originalLoad.apply(this, arguments);
};
try {
  security.harden({ on(name, fn) { handlers[name] = fn; } });
} finally { Module._load = originalLoad; }
handlers.request(null, 'media', (granted) => assert.equal(granted, false));
assert.equal(handlers.check(), false);
assert.equal(handlers.device(), false);
for (const [url, allowed] of [
  [settings, true], [settings.replace('index.html', 'settings.css'), true],
  [pathToFileURL(path.resolve(__dirname, '../../assets/mark.svg')).href, true],
  ['file:///private/example', false], ['https://example.com/image.png', false],
  ['file://remote/share/image.png', false], ['data:text/html,test', false],
]) {
  handlers.resource({ url }, ({ cancel }) => assert.equal(cancel, !allowed));
}
let denied = 0;
const navigation = {};
handlers['web-contents-created'](null, {
  setWindowOpenHandler(fn) { assert.equal(fn().action, 'deny'); },
  on(name, fn) { navigation[name] = fn; },
});
for (const fn of Object.values(navigation)) fn({ preventDefault() { denied++; } });
assert.equal(denied, 4, 'Top-level navigation, redirects, child navigation, and webviews are denied');
console.log('Security tests passed: frame identity, surface permissions, navigation, and local resource limits');
