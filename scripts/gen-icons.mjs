// 生成托盘与应用图标（无第三方依赖：手写 PNG 编码器）
// 用法: node scripts/gen-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });

/* ---------- PNG 编码 ---------- */
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

/* ---------- 绘制 ---------- */
/** 圆环 + 中间弧形缺口，4x4 超采样抗锯齿 */
function drawRing(size, { color, stroke, gap = true, dot = false, ss = 4 }) {
  const rgba = new Uint8Array(size * size * 4);
  const [r, g, b] = color;
  const c = (size - 1) / 2;
  const outer = size * 0.42;
  const inner = Math.max(outer - Math.max(stroke, size / 16), size * 0.06);
  const dotR = size * 0.15;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss - 0.5;
          const py = y + (sy + 0.5) / ss - 0.5;
          const d = Math.hypot(px - c, py - c);
          let on = false;
          if (d <= outer && d >= inner) {
            on = true;
            if (gap) {
              // 在 -58° 位置开一个 26° 的口，让它看起来像"计时/暂停"
              const ang = (Math.atan2(py - c, px - c) * 180) / Math.PI;
              if (ang > -71 && ang < -45) on = false;
            }
          }
          // due 状态在圆心多一个点，图标仍保持单色（模板图也能区分状态）
          if (!on && dot && d <= dotR) on = true;
          if (on) hits++;
        }
      }
      if (hits > 0) {
        const a = Math.round((hits / (ss * ss)) * 255);
        const i = (y * size + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = a;
      }
    }
  }
  return rgba;
}

function write(name, size, opts) {
  const rgba = drawRing(size, opts);
  fs.writeFileSync(path.join(outDir, name), encodePng(size, size, rgba));
  console.log('wrote', name, size + 'x' + size);
}

const BLACK = [0, 0, 0];
const GRAY = [0x8a, 0x8f, 0x98];
const AMBER = [0xf5, 0xa6, 0x23];
const GREEN = [0x34, 0xc7, 0x59];
const BLUE = [0x2f, 0x6f, 0xed];

// macOS 模板图：纯黑 + alpha，系统自动适配深浅色菜单栏。
// 三种状态靠形状区分：空心环=正常，环+点心=快到时间，实心粗环=正在休息
write('trayTemplate.png', 16, { color: BLACK, stroke: 2 });
write('trayTemplate@2x.png', 32, { color: BLACK, stroke: 3 });
write('trayTemplate-due.png', 16, { color: BLACK, stroke: 2, dot: true });
write('trayTemplate-due@2x.png', 32, { color: BLACK, stroke: 3, dot: true });
write('trayTemplate-rest.png', 16, { color: BLACK, stroke: 3, gap: false });
write('trayTemplate-rest@2x.png', 32, { color: BLACK, stroke: 4, gap: false });

// Windows / Linux 彩色状态图标
write('tray-idle.png', 16, { color: GRAY, stroke: 2 });
write('tray-idle@2x.png', 32, { color: GRAY, stroke: 3 });
write('tray-due.png', 16, { color: AMBER, stroke: 2 });
write('tray-due@2x.png', 32, { color: AMBER, stroke: 3 });
write('tray-rest.png', 16, { color: GREEN, stroke: 2 });
write('tray-rest@2x.png', 32, { color: GREEN, stroke: 3 });

// 应用图标
write('icon.png', 256, { color: BLUE, stroke: 26, gap: false });
write('icon-512.png', 512, { color: BLUE, stroke: 52, gap: false });
