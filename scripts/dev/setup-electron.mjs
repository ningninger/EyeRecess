// Install the source runtime using the downloader and extractor shipped with Electron.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export function explainFailure(error) {
  const errors = [];
  const visit = (item) => {
    if (!item || errors.includes(item)) return;
    errors.push(item);
    visit(item.cause);
    if (Array.isArray(item.errors)) item.errors.forEach(visit);
  };
  visit(error);
  const codes = errors.map((item) => item.code);
  if (codes.includes('PROXY_SUPPORT_MISSING')) {
    return 'Proxy support is missing. Run npm ci --include=optional, then retry runtime setup.';
  }
  if (codes.includes('MODULE_NOT_FOUND')) return 'Electron setup dependencies are missing. Run npm ci --include=optional.';
  if (codes.includes('UNSUPPORTED_PLATFORM')) return 'Electron is not available for the selected platform.';
  if (codes.some((code) => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))) {
    return 'DNS lookup failed. Check your network or configure an HTTPS proxy.';
  }
  if (codes.some((code) => ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code))) {
    return 'The download connection failed. Check network access and your HTTPS proxy settings.';
  }
  if (codes.some((code) => /CERT|TLS|SSL/.test(String(code))) || codes.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
    return 'TLS certificate verification failed. Check your trusted certificates; do not disable verification.';
  }
  const status = errors.find((item) => Number.isInteger(item.response?.status))?.response.status;
  if (status) return `The download server returned HTTP ${status}. Check access to the selected source and release.`;
  if (errors.some((item) => /checksum/i.test(item.name || '') || /checksum/i.test(item.message || ''))) {
    return 'Archive checksum verification failed. Retry with force_no_cache=true; do not use the unverified archive.';
  }
  if (codes.some((code) => ['EACCES', 'EPERM', 'ENOSPC'].includes(code))) {
    return 'Runtime files could not be written. Check directory permissions and available disk space.';
  }
  return 'Runtime setup failed during download or extraction. Check network access, disk space, and platform support.';
}

export async function setupElectron({
  env = process.env, platform = process.platform, files = fs,
  load = createRequire(import.meta.url), log = console.log,
} = {}) {
  if (env.ELECTRON_SKIP_BINARY_DOWNLOAD && !['0', 'false'].includes(env.ELECTRON_SKIP_BINARY_DOWNLOAD)) {
    log('[EyeRecess] Electron download skipped. Desktop launch requires npm run setup:electron without ELECTRON_SKIP_BINARY_DOWNLOAD.');
    return;
  }
  const directory = path.dirname(load.resolve('electron/package.json'));
  // Resolve these through Electron so its compatible downloader/extractor versions stay paired.
  const { version } = load(path.join(directory, 'package.json'));
  const target = env.ELECTRON_INSTALL_PLATFORM || env.npm_config_platform || platform;
  const executable = {
    darwin: 'Electron.app/Contents/MacOS/Electron', mas: 'Electron.app/Contents/MacOS/Electron',
    win32: 'electron.exe', linux: 'electron', freebsd: 'electron', openbsd: 'electron',
  }[target];
  if (!executable) throw Object.assign(new Error('Unsupported platform'), { code: 'UNSUPPORTED_PLATFORM' });
  const dist = env.ELECTRON_OVERRIDE_DIST_PATH || path.join(directory, 'dist');
  const manifest = path.join(directory, 'path.txt');
  try {
    if (env.force_no_cache !== 'true' &&
        files.readFileSync(path.join(dist, 'version'), 'utf8').trim().replace(/^v/, '') === version &&
        files.readFileSync(manifest, 'utf8').trim() === executable) {
      files.accessSync(path.join(dist, executable), target === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      log('[EyeRecess] Electron runtime is ready. Run npm start.');
      return;
    }
  } catch { /* Download missing or incomplete runtime files. */ }

  const downloaderPath = load.resolve('@electron/get', { paths: [directory] });
  const downloader = load(downloaderPath);
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ELECTRON_GET_USE_PROXY) {
    // Upstream treats proxy support as optional; fail clearly if it was omitted during npm install.
    try {
      load(load.resolve('undici', { paths: [path.dirname(downloaderPath)] }));
    } catch {
      throw Object.assign(new Error('Proxy support missing'), { code: 'PROXY_SUPPORT_MISSING' });
    }
    downloader.initializeProxy();
    log('[EyeRecess] Using the configured HTTP(S) proxy.');
  }
  log('[EyeRecess] Downloading and verifying Electron. The first download may take a few minutes.');
  const archive = await downloader.downloadArtifact({
    version, artifactName: 'electron', platform: target,
    arch: env.ELECTRON_INSTALL_ARCH || env.npm_config_arch,
    force: env.force_no_cache === 'true', cacheRoot: env.electron_config_cache,
    checksums: load(path.join(directory, 'checksums.json')),
    downloadOptions: { quiet: true },
  });
  const { extract } = load(load.resolve('@electron-internal/extract-zip', { paths: [directory] }));
  await extract(archive, { dir: dist });
  const types = path.join(dist, 'electron.d.ts');
  if (files.existsSync(types)) files.renameSync(types, path.join(directory, 'electron.d.ts'));
  files.accessSync(path.join(dist, executable), target === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
  // Publish readiness only after extraction and executable checks succeed.
  files.writeFileSync(manifest, executable);
  log('[EyeRecess] Electron runtime is ready. Run npm start.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  setupElectron().catch((error) => {
    console.error(`[EyeRecess] ${explainFailure(error)}`);
    console.error('npm registry access does not guarantee access to Electron release downloads.');
    console.error('Use a reachable HTTPS_PROXY, or see docs/support.md for an opt-in mirror command, then rerun npm run setup:electron.');
    process.exitCode = 1;
  });
}
