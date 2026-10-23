import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array w*h*4 (straight alpha) */
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Sample a rounded eye with a pause mark; small tray variants stay monochrome.
function roundedRect(x, y, cx, cy, width, height, radius) {
  const dx = Math.max(Math.abs(x - cx) - width / 2 + radius, 0);
  const dy = Math.max(Math.abs(y - cy) - height / 2 + radius, 0);
  return dx * dx + dy * dy <= radius * radius;
}

function mark(x, y, state = 'idle', app = false) {
  const cx = .5;
  const cy = app ? .51 : .5;
  const width = app ? .31 : .43;
  const q = Math.abs((x - cx) / width);
  const curve = .19 * Math.max(0, 1 - q * q);
  const stroke = app ? .021 : .035;
  if (state === 'rest') {
    return q <= 1 && Math.abs(y - cy - curve * .65) < stroke;
  }
  const eye = q <= 1 && Math.abs(Math.abs(y - cy) - curve) < stroke;
  const bars = [-1, 1].some((side) => roundedRect(x, y, cx + side * .058, cy, .038, .16, .018));
  const dot = state === 'due' && Math.hypot(x - .82, y - .17) < .065;
  return eye || bars || dot;
}

function render(size, state, color, app = false) {
  const rgba = new Uint8Array(size * size * 4);
  const samples = size <= 32 ? 4 : 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = (x + (sx + .5) / samples) / size;
          const py = (y + (sy + .5) / samples) / size;
          let pixel = null;
          if (app && roundedRect(px, py, .5, .5, .9, .9, .21)) {
            const glow = Math.max(0, 1 - Math.hypot(px - .2, py - .1));
            pixel = [16 + glow * 13, 55 + glow * 25, 47 + glow * 18];
          }
          if (mark(px, py, state, app)) pixel = color;
          if (pixel) {
            for (let channel = 0; channel < 3; channel++) sum[channel] += pixel[channel];
            sum[3]++;
          }
        }
      }
      const offset = (y * size + x) * 4;
      if (sum[3]) {
        for (let channel = 0; channel < 3; channel++) rgba[offset + channel] = Math.round(sum[channel] / sum[3]);
        rgba[offset + 3] = Math.round(255 * sum[3] / (samples * samples));
      }
    }
  }
  return encodePng(size, size, rgba);
}

function write(name, size, state, color, app = false, directory = outDir) {
  fs.writeFileSync(path.join(directory, name), render(size, state, color, app));
  console.log('wrote', name, size + 'x' + size);
}

const BLACK = [0, 0, 0];
const MINT = [195, 237, 208];
for (const [state, suffix, color] of [
  ['idle', '', [44, 122, 99]], ['due', '-due', [200, 130, 29]], ['rest', '-rest', [61, 145, 100]],
]) {
  for (const [scale, dpi] of [[1, ''], [2, '@2x']]) {
    write(`trayTemplate${suffix}${dpi}.png`, 16 * scale, state, BLACK);
    write(`tray-${state}${dpi}.png`, 16 * scale, state, color);
  }
}
write('icon.png', 256, 'idle', MINT, true);
write('icon-512.png', 512, 'idle', MINT, true);
write('icon.png', 1024, 'idle', MINT, true, path.join(root, 'build'));
// Keep the settings mark editable as a vector, using the same shape and palette.
fs.writeFileSync(path.join(outDir, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <rect x="5" y="5" width="90" height="90" rx="21" fill="#174c3f"/>
  <path d="M19 51 Q50 13 81 51 Q50 89 19 51Z" stroke="#c3edd0" stroke-width="4.2" stroke-linejoin="round"/>
  <path d="M44.2 44.5V57.5M55.8 44.5V57.5" stroke="#c3edd0" stroke-width="4" stroke-linecap="round"/>
</svg>\n`);
