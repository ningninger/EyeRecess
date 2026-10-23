// Start a source checkout with actionable runtime checks and no automatic installs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`[EyeRecess] ${message}`);
  console.error('For a source checkout: install Node.js 22.12.0 or later, then run npm ci from the repository root.');
  console.error('If npm packages are already installed, run npm run setup:electron to download the runtime.');
  console.error('To use the app without development tools, download an installer or portable build from:');
  console.error('https://github.com/ningninger/eyerecess/releases');
  process.exitCode = 1;
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  fail('Node.js 22.12.0 or later is required to run from source.');
} else {
  let executable;
  try {
    // Requiring Electron 45 can trigger a download; inspect its installed files instead.
    const directory = path.dirname(require.resolve('electron/package.json'));
    const relative = fs.readFileSync(path.join(directory, 'path.txt'), 'utf8').trim();
    if (!relative) throw new Error('Missing runtime manifest');
    executable = path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(directory, 'dist'), relative);
    fs.accessSync(executable, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
  } catch {
    fail('The Electron runtime is missing or incomplete.');
  }
  if (executable && !process.exitCode) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [root, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
    child.once('error', () => fail('The Electron runtime could not start. Reinstall the source dependencies with npm ci.'));
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`[EyeRecess] The Electron runtime terminated with ${signal}. Check local startup logs if available.`);
        process.exitCode = 1;
      } else {
        process.exitCode = code ?? 1;
      }
    });
  }
}
