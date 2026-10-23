// Verify installation ordering and recovery without downloads or native extraction.
const assert = require('node:assert/strict');
const path = require('node:path');

async function main() {
  const { setupElectron, explainFailure } = await import('../../scripts/dev/setup-electron.mjs');

  function fixture({ ready = false, downloadError, extractError, missingProxy = false } = {}) {
    const events = [];
    const messages = [];
    const checksums = { 'electron-v45.0.0-linux-x64.zip': 'trusted-hash' };
    let details;
    const load = (name) => {
      if (name === '@electron/get') return {
        initializeProxy() { events.push('proxy'); },
        async downloadArtifact(options) {
          details = options;
          events.push('download');
          if (downloadError) throw downloadError;
          return '/cache/runtime.zip';
        },
      };
      if (name === '@electron-internal/extract-zip') return {
        async extract(archive, options) {
          assert.equal(archive, '/cache/runtime.zip');
          events.push(['extract', options.dir]);
          if (extractError) throw extractError;
        },
      };
      if (name === 'undici') {
        if (missingProxy) throw new Error('Missing optional package');
        return {};
      }
      if (name.endsWith('checksums.json')) return checksums;
      if (name.endsWith('package.json')) return { version: '45.0.0' };
      throw new Error('Unexpected module');
    };
    load.resolve = (name) => name === 'electron/package.json' ? '/runtime/package.json' : name;
    const files = {
      readFileSync(name) {
        if (!ready) throw new Error('Not installed');
        return name.endsWith('version') ? 'v45.0.0\n' : 'electron';
      },
      accessSync(name) { events.push(['access', name]); },
      existsSync() { return false; },
      writeFileSync(name, content) { events.push(['write', name, content]); },
    };
    return {
      events, messages, checksums, get details() { return details; },
      run: (env = {}) => setupElectron({ env, platform: 'linux', load, files, log: (message) => messages.push(message) }),
    };
  }

  const skipped = fixture();
  await skipped.run({ ELECTRON_SKIP_BINARY_DOWNLOAD: '1' });
  assert.deepEqual(skipped.events, [], 'Test-only installs perform no runtime work');
  assert.match(skipped.messages[0], /skipped/);
  const ready = fixture({ ready: true });
  await ready.run();
  assert.equal(ready.details, undefined, 'Ready runtimes never download again');
  const installed = fixture();
  await installed.run({ HTTPS_PROXY: 'http://private-user:private-password@proxy.invalid', ELECTRON_INSTALL_ARCH: 'arm64' });
  assert.equal(installed.events[0], 'proxy', 'Proxy is initialized before download');
  assert.equal(installed.details.arch, 'arm64');
  assert.equal(installed.details.checksums, installed.checksums, 'Use checksums bundled with the Electron npm package');
  assert.equal(installed.details.platform, 'linux');
  assert.deepEqual(installed.events.at(-1), ['write', path.join('/runtime', 'path.txt'), 'electron']);
  assert.doesNotMatch(installed.messages.join('\n'), /private-|proxy.invalid/, 'Never print proxy credentials or URLs');
  const forced = fixture({ ready: true });
  await forced.run({ force_no_cache: 'true', ELECTRON_SKIP_BINARY_DOWNLOAD: 'false', ELECTRON_OVERRIDE_DIST_PATH: '/custom/runtime' });
  assert.equal(forced.details.force, true, 'Forced setup repairs a previously installed runtime');
  assert.ok(forced.events.some((event) => event[0] === 'extract' && event[1] === '/custom/runtime'));
  const lowercaseProxy = fixture();
  await lowercaseProxy.run({ https_proxy: 'http://proxy.invalid' });
  assert.equal(lowercaseProxy.events[0], 'proxy', 'Lowercase proxy variables are supported');
  const missingProxy = fixture({ missingProxy: true });
  await assert.rejects(missingProxy.run({ HTTPS_PROXY: 'http://proxy.invalid' }), { code: 'PROXY_SUPPORT_MISSING' });
  assert.equal(missingProxy.details, undefined, 'Missing proxy support fails before attempting a direct connection');
  for (const failure of [
    { downloadError: new Error('fetch failed', { cause: { code: 'ENOTFOUND' } }) },
    { extractError: new Error('Native extraction failed') },
  ]) {
    const broken = fixture(failure);
    await assert.rejects(broken.run());
    assert.ok(!broken.events.some((event) => event[0] === 'write'), 'Failed setup never publishes a readiness manifest');
  }
  for (const [error, expected] of [
    [new Error('fetch failed', { cause: { code: 'ENOTFOUND' } }), /DNS/],
    [new AggregateError([{ code: 'ETIMEDOUT' }]), /connection failed/],
    [{ cause: { code: 'SELF_SIGNED_CERT_IN_CHAIN' } }, /TLS/],
    [{ response: { status: 407, url: 'https://secret.invalid' } }, /HTTP 407/],
    [{ name: 'ChecksumMismatchError' }, /checksum/],
    [{ code: 'ENOSPC' }, /disk space/],
    [{ code: 'PROXY_SUPPORT_MISSING' }, /include=optional/],
    [new Error('/private/path with sensitive details'), /download or extraction/],
  ]) {
    const message = explainFailure(error);
    assert.match(message, expected);
    assert.doesNotMatch(message, /secret.invalid|private\/path/);
  }
  console.log('Electron setup tests passed: skip, readiness, proxy, checksums, extraction, and safe failure guidance');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
