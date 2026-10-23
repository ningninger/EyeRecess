// Use local PNG resizing and ICNS encoding instead of a downloaded icon converter.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = path.join(root, '.local', 'build');
const source = path.join(root, 'build', 'icon.png');
const output = path.join(root, 'build', 'icon.icns');

if (process.platform !== 'darwin') {
  console.error('[EyeRecess] Generate the macOS packaging icon on macOS.');
  process.exitCode = 1;
} else {
  fs.mkdirSync(scratch, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(scratch, 'mac-icon-'));
  try {
    // Modern ICNS entries contain PNG images; include standard and Retina sizes.
    const entries = [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
    const chunks = [];
    for (const [type, size] of entries) {
      const image = path.join(temporary, `${size}.png`);
      if (!fs.existsSync(image)) {
        execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', image], { stdio: 'pipe' });
      }
      const png = fs.readFileSync(image);
      const header = Buffer.alloc(8);
      header.write(type, 0, 'ascii');
      header.writeUInt32BE(png.length + header.length, 4);
      chunks.push(header, png);
    }
    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(chunks.reduce((sum, chunk) => sum + chunk.length, header.length), 4);
    const generated = path.join(temporary, 'icon.icns');
    fs.writeFileSync(generated, Buffer.concat([header, ...chunks]));
    fs.copyFileSync(generated, output);
    console.log('[EyeRecess] macOS packaging icon is ready (no download required).');
  } catch {
    console.error('[EyeRecess] Could not generate the macOS icon. Check build/icon.png and macOS image tools.');
    process.exitCode = 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
