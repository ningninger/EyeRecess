// Enforce repository conventions without adding a build or lint dependency.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);
const git = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
if (git.status !== 0) throw new Error('Cannot read the repository file inventory');
const files = [...new Set(git.stdout.split('\0').filter(Boolean))]
  .filter((file) => fs.existsSync(path.join(root, file)));
const rootFiles = new Set([
  'AGENTS.md', 'CONTRIBUTING.md', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'LICENSE',
  'package.json', 'package-lock.json', '.gitignore', '.gitattributes', '.editorconfig',
  'EyeRecess.vbs', 'run-windows.cmd', 'diagnose.cmd',
]);
const directories = new Set(['src', 'scripts', 'tests', 'assets', 'build', 'docs', '.github']);
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.yml', '.yaml', '.ps1', '.cmd', '.vbs', '.plist']);
const han = /\p{Script=Han}/u;

// Extract comments while preserving quoted and template text as UI literals.
function comments(source) {
  const found = [];
  for (let i = 0; i < source.length;) {
    const quote = source[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === quote) break;
      }
    } else if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      found.push(source.slice(i, end < 0 ? source.length : end));
      i = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      found.push(source.slice(i, end < 0 ? source.length : end + 2));
      i = end < 0 ? source.length : end + 2;
    } else {
      i++;
    }
  }
  return found;
}

for (const file of files) {
  const parts = file.split('/');
  if (han.test(file)) fail(file, 'repository filenames must use English');
  if (parts.length === 1 && !rootFiles.has(file)) fail(file, 'unexpected root file; use a designated directory');
  if (parts.length > 1 && !directories.has(parts[0])) fail(file, 'unexpected top-level directory');
  if (parts[0] === 'scripts' && file !== 'scripts/check.mjs' && !['dev', 'windows'].includes(parts[1])) fail(file, 'place tools under scripts/dev or scripts/windows');
  if (parts[0] === 'tests' && !['unit', 'integration', 'renderer'].includes(parts[1])) fail(file, 'tests must declare their scope');
  if (parts[0] === 'tests' && !file.endsWith('.test.js')) fail(file, 'test files must use the .test.js suffix');
  if (parts[0] === 'src' && !['main', 'preload', 'renderer'].includes(parts[1])) fail(file, 'unknown process boundary');
  if (/\/(?:_preview[^/]*|.*\.log)$/.test(file)) fail(file, 'generated output must not be committed');

  const ext = path.extname(file);
  if (!textExtensions.has(ext) && !rootFiles.has(file)) continue;
  const buffer = fs.readFileSync(path.join(root, file));
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const windows = ['.ps1', '.cmd', '.vbs'].includes(ext);
  if (windows) {
    if (/(?<!\r)\n/.test(text) || /\r(?!\n)/.test(text)) fail(file, 'Windows scripts must use CRLF');
    if (ext === '.ps1' && !buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) fail(file, 'PowerShell scripts require a UTF-8 BOM');
    if (ext !== '.ps1' && /[^\x00-\x7f]/.test(text)) fail(file, 'Windows entry points must remain ASCII');
  } else if (text.includes('\r')) {
    fail(file, 'text must use LF');
  }
  if (!text.endsWith('\n')) fail(file, 'missing final newline');
  if (/[\t ]+\r?$/m.test(text)) fail(file, 'trailing whitespace');
  if (/^\t/m.test(text)) fail(file, 'use spaces for indentation');

  const developerContent = ['scripts', 'tests', 'docs', '.github'].includes(parts[0]) || parts.length === 1;
  if (developerContent && file !== 'README.zh-CN.md' && han.test(text)) fail(file, 'developer-facing content must use English');
  if (developerContent && /(?:\/Users\/|\/home\/)[a-zA-Z0-9_.-]+\/|[a-zA-Z]:\\(?:Workspace|Users)\\/.test(text)) fail(file, 'remove machine-specific paths from public repository content');
  if (parts[0] === 'src') {
    if (comments(text).some((comment) => han.test(comment))) fail(file, 'source comments must use English');
    for (const line of text.split('\n')) {
      if (/(?:console|log)\.(?:log|warn|error|info|boot)\(/.test(line) && han.test(line)) fail(file, 'developer logs must use English');
    }
  }

  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    if (result.status !== 0) fail(file, result.stderr.trim());
    if (parts[0] === 'src' && /(?:require\(|from\s)[^\n]*(?:tests\/|scripts\/|\.local\/)/.test(text)) fail(file, 'runtime code must not depend on development files');
  }
  if (ext === '.md') {
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      if (!fs.existsSync(path.resolve(root, path.dirname(file), target))) fail(file, `broken documentation link: ${target}`);
    }
  }
}

for (const file of ['config.js', 'tracker.js', 'stats.js', 'breaks.js']) {
  const source = fs.readFileSync(path.join(root, 'src/main', file), 'utf8');
  if (/require\(['"]electron['"]\)/.test(source)) fail(file, 'pure services must not import Electron');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version) fail('package-lock.json', 'package versions must agree');
if (pkg.engines?.node !== lock.packages[''].engines?.node) fail('package-lock.json', 'Node requirements must agree');
const allowedRuntimeFiles = ['src/**/*', 'assets/**/*', 'package.json', '!**/*.map', 'LICENSE'];
if (JSON.stringify(pkg.build.files) !== JSON.stringify(allowedRuntimeFiles)) fail('package.json', 'review changes to the runtime packaging allowlist');
for (const [name, command] of Object.entries(pkg.scripts)) {
  for (const match of command.matchAll(/(?:node\s+|-File\s+)([^\s]+)/g)) {
    if (!fs.existsSync(path.join(root, match[1]))) fail('package.json', `${name} references a missing script: ${match[1]}`);
  }
}
const ignored = ['.local/check.txt', '.boot-test/check.txt', 'dist/check.txt', 'node_modules/check.txt'];
const ignoreCheck = spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, encoding: 'utf8', input: ignored.join('\n') + '\n' });
const ignoredPaths = new Set(ignoreCheck.stdout.trim().split('\n'));
for (const file of ignored) if (!ignoredPaths.has(file)) fail('.gitignore', `generated or private directory is not ignored: ${file}`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed (${files.length} files): placement, language, encoding, syntax, links, and packaging.`);
}
