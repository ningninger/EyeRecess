'use strict';
// Source launcher behavior with controlled runtime and process substitutes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

const launcher = path.resolve(__dirname, '../../scripts/dev/start.mjs');
const source = fs.readFileSync(launcher, 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', 'scriptUrl');

function run({ node = '22.12.0', missingPackage = false, missingBinary = false } = {}) {
  const messages = [];
  const events = new Map();
  const launches = [];
  const process = {
    versions: { node }, exitCode: 0,
    argv: ['node', launcher, '--smoke'],
    env: { ELECTRON_RUN_AS_NODE: '1', TEST_FLAG: 'preserved' },
  };
  vm.runInNewContext(source, {
    fs: {
      constants: fs.constants,
      readFileSync() { return 'electron'; },
      accessSync() { if (missingBinary) throw new Error('Missing binary'); },
    },
    path, fileURLToPath, scriptUrl: pathToFileURL(launcher).href, process,
    console: { error: (message) => messages.push(message) },
    createRequire: () => ({
      resolve() {
        if (missingPackage) throw new Error('Missing package');
        return '/runtime/package.json';
      },
    }),
    spawn: (...args) => {
      launches.push(args);
      return { once: (name, fn) => events.set(name, fn) };
    },
  });
  return { process, messages, launches, events };
}

for (const options of [{ node: '20.0.0' }, { node: '22.11.0' }, { missingPackage: true }, { missingBinary: true }]) {
  const result = run(options);
  assert.equal(result.launches.length, 0, 'Invalid setups never start an application process');
  assert.equal(result.process.exitCode, 1, 'Setup failures return a nonzero exit status');
  assert.match(result.messages.join('\n'), /npm ci/, 'Source users receive recovery steps');
  assert.match(result.messages.join('\n'), /setup:electron/, 'Existing checkouts receive a runtime-only repair command');
  assert.match(result.messages.join('\n'), /installer or portable/, 'Users receive a bundled-runtime alternative');
  assert.doesNotMatch(result.messages.join('\n'), /Missing package|Missing binary/, 'Raw errors are not exposed');
}

const ready = run();
assert.equal(ready.launches.length, 1);
const [executable, args, options] = ready.launches[0];
assert.equal(executable, path.join('/runtime', 'dist', 'electron'));
assert.equal(args[0], path.resolve(__dirname, '../..'));
assert.equal(args[1], '--smoke', 'Launch modes are forwarded');
assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined, 'Electron starts in GUI mode');
assert.equal(options.env.TEST_FLAG, 'preserved');
assert.equal(ready.process.env.ELECTRON_RUN_AS_NODE, '1', 'The parent environment remains unchanged');
ready.events.get('exit')(7, null);
assert.equal(ready.process.exitCode, 7, 'Runtime failures propagate to callers');
const failedStart = run();
failedStart.events.get('error')(new Error('Cannot spawn'));
assert.equal(failedStart.process.exitCode, 1);
assert.match(failedStart.messages.join('\n'), /could not start/);
const terminated = run();
terminated.events.get('exit')(null, 'SIGABRT');
assert.equal(terminated.process.exitCode, 1);
assert.match(terminated.messages.join('\n'), /SIGABRT/, 'Abnormal native termination is reported');
console.log('Source launcher tests passed: runtime checks, setup guidance, environment, and exit status');
