// npm run icons — рисует иконки PWA (арка «райских врат») без внешних зависимостей: PNG через zlib.
// Результат коммитится в public/; запускать заново нужно только при смене рисунка.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '../..');
const BG = [0x16, 0x14, 0x1f];
const GOLD = [0xe8, 0xbd, 0x5a];
const DOOR = [0x2b, 0x27, 0x40];

/** Цвет точки (x, y) в нормированных координатах рисунка 0..1; null — прозрачно. */
function shade(x, y, { rounded }) {
  if (rounded) {
    const r = 0.22;
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  const inArch = (inset) => {
    const left = 0.28 + inset;
    const right = 0.72 - inset;
    const radius = 0.22 - inset;
    const cy = 0.52;
    if (x < left || x > right || y > 0.8) return false;
    return y >= cy || (x - 0.5) ** 2 + (y - cy) ** 2 <= radius * radius;
  };
  if ((x - 0.5) ** 2 + (y - 0.19) ** 2 <= 0.032 ** 2) return GOLD;
  if (y >= 0.8 && y <= 0.835 && x >= 0.2 && x <= 0.8) return GOLD;
  if (inArch(0.045)) return Math.abs(x - 0.5) <= 0.008 ? GOLD : DOOR;
  if (inArch(0)) return GOLD;
  return BG;
}

function render(size, { scale = 1, rounded = false } = {}) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // Масштаб рисунка относительно центра: для maskable рисунок меньше, фон — на весь холст
          const nx = (pxi + (sx + 0.5) / ss) / size;
          const ny = (py + (sy + 0.5) / ss) / size;
          const inner = shade(0.5 + (nx - 0.5) / scale, 0.5 + (ny - 0.5) / scale, { rounded: false });
          const outer = rounded ? shade(nx, ny, { rounded: true }) : BG;
          if (!outer) continue;
          const c = scale === 1 ? (rounded ? outer : inner) : inner;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const o = (py * size + pxi) * 4;
      px[o] = Math.round(r / Math.max(1, a / 255));
      px[o + 1] = Math.round(g / Math.max(1, a / 255));
      px[o + 2] = Math.round(b / Math.max(1, a / 255));
      px[o + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = [
  ['public/icons/icon-192.png', render(192, { rounded: true })],
  ['public/icons/icon-512.png', render(512, { rounded: true })],
  ['public/icons/icon-maskable-512.png', render(512, { scale: 0.72 })],
  ['public/icons/apple-touch-icon.png', render(180, { scale: 0.86 })],
];
for (const [file, data] of outputs) {
  const path = resolve(ROOT, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${file}: ${(data.length / 1024).toFixed(1)} КБ`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#16141f"/>
  <path d="M28 80V52a22 22 0 0 1 44 0v28z" fill="#e8bd5a"/>
  <path d="M32.5 80V52a17.5 17.5 0 0 1 35 0v28z" fill="#2b2740"/>
  <rect x="49.2" y="34.5" width="1.6" height="45.5" fill="#e8bd5a"/>
  <rect x="20" y="80" width="60" height="3.5" fill="#e8bd5a"/>
  <circle cx="50" cy="19" r="3.2" fill="#e8bd5a"/>
</svg>
`;
writeFileSync(resolve(ROOT, 'public/favicon.svg'), svg);
console.log('public/favicon.svg');
