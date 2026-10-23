// Download the Electron prebuilt binary without relying on @electron/get.
//
// Why: @electron/get v5 uses undici's fetch, and inside this sandbox that path
// stalls forever with no output. Node's plain `https` module works fine, so we
// drive the download ourselves, follow redirects manually, and report progress.
//
//   node scripts/fetch-electron.mjs --probe   # show what each mirror answers
//   node scripts/fetch-electron.mjs           # download the zip into .electron-cache
//   node scripts/fetch-electron.mjs --force   # redownload even if cached

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version;
const ZIP_NAME = `electron-v${VERSION}-win32-x64.zip`;
const CACHE_DIR = path.join(ROOT, '.electron-cache');
const OUT = path.join(CACHE_DIR, ZIP_NAME);

const MIRRORS = [
  `https://cdn.npmmirror.com/binaries/electron/${VERSION}/${ZIP_NAME}`,
  `https://npmmirror.com/mirrors/electron/${VERSION}/${ZIP_NAME}`,
  `https://registry.npmmirror.com/-/binary/electron/${VERSION}/${ZIP_NAME}`,
  `https://github.com/electron/electron/releases/download/v${VERSION}/${ZIP_NAME}`,
];

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const PROBE = args.has('--probe');
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function get(url, { headers = {}, redirects = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'eyerest-setup', ...headers } }, (res) => {
      const code = res.statusCode || 0;
      if (REDIRECTS.has(code) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(get(next, { headers, redirects: redirects - 1 }));
        return;
      }
      resolve({ res, url });
    });
    req.setTimeout(60_000, () => req.destroy(new Error('timeout waiting for response headers')));
    req.on('error', reject);
  });
}

async function probeOne(url) {
  process.stdout.write(`  ${url}\n`);
  try {
    const { res, url: finalUrl } = await get(url, { headers: { range: 'bytes=0-1023' } });
    const len = res.headers['content-range'] || res.headers['content-length'] || '?';
    if (finalUrl !== url) process.stdout.write(`    -> ${finalUrl}\n`);
    process.stdout.write(`    ${res.statusCode} len=${len}\n`);
    res.resume();
    return { url, ok: res.statusCode === 200 || res.statusCode === 206, len };
  } catch (err) {
    process.stdout.write(`    FAIL ${err.message}\n`);
    return { url, ok: false };
  }
}

function human(n) {
  return `${(n / 1048576).toFixed(1)} MB`;
}

async function downloadFrom(url) {
  const { res, url: finalUrl } = await get(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode}`);
  }
  const total = Number(res.headers['content-length'] || 0);
  if (total && total < 20 * 1048576) throw new Error(`suspiciously small payload (${human(total)})`);
  if (finalUrl !== url) process.stdout.write(`  redirected to ${finalUrl}\n`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${OUT}.part`;
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(tmp, 'w');
  let got = 0;
  let lastTick = 0;

  try {
    await new Promise((resolve, reject) => {
      res.on('data', (chunk) => {
        got += chunk.length;
        hash.update(chunk);
        fs.writeSync(fd, chunk);
        const now = Date.now();
        if (now - lastTick > 1000) {
          lastTick = now;
          const pct = total ? ((got / total) * 100).toFixed(1) : '?';
          process.stdout.write(`\r  ${human(got)} / ${total ? human(total) : '?'}  (${pct}%)   `);
        }
      });
      res.on('end', resolve);
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('connection aborted')));
    });
  } finally {
    fs.closeSync(fd);
  }
  process.stdout.write('\n');
  if (total && got !== total) throw new Error(`truncated: got ${got} of ${total} bytes`);

  const digest = hash.digest('hex');
  fs.renameSync(tmp, OUT);
  fs.writeFileSync(`${OUT}.sha256`, digest);
  return { bytes: got, digest };
}

async function main() {
  console.log(`electron ${VERSION} -> ${ZIP_NAME}`);

  if (PROBE) {
    console.log('probing mirrors:');
    for (const url of MIRRORS) await probeOne(url);
    return;
  }

  if (!FORCE && fs.existsSync(OUT)) {
    const size = fs.statSync(OUT).size;
    if (size > 20 * 1048576) {
      console.log(`already cached: ${OUT} (${human(size)})`);
      return;
    }
    console.log(`cached file too small (${size} bytes), redownloading`);
  }

  const errors = [];
  for (const url of MIRRORS) {
    console.log(`trying ${url}`);
    try {
      const { bytes, digest } = await downloadFrom(url);
      console.log(`done: ${human(bytes)}  sha256=${digest}`);
      console.log(`saved to ${OUT}`);
      return;
    } catch (err) {
      console.log(`  failed: ${err.message}`);
      errors.push(`${url}: ${err.message}`);
      try { fs.unlinkSync(`${OUT}.part`); } catch {}
    }
  }
  console.error('all mirrors failed:\n' + errors.map((e) => '  ' + e).join('\n'));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
