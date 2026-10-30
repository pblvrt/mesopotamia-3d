// TEMPORARY FIXTURES — used only when the real files in src/data/ or public/terrain/ are missing.
// Run: node src/fixtures/make-fixtures.mjs
// Writes a procedural fake Terrarium heightmap (height-fixture.png) covering the contract bbox.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const W = 260, H = 200; // 0.05 deg/px over lon 37.5..50.5, lat 28.5..38.5
const B = { west: 37.5, east: 50.5, south: 28.5, north: 38.5 };

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2; } return s; }

function elev(lon, lat) {
  // Gulf (sea) south-east
  const coast = 30.0 - (lon - 48.3) * 0.35;
  if (lon > 47.8 && lat < coast) return -20 - 40 * Math.min(1, (coast - lat));
  // Zagros: ridge along a line NW->SE, NE side is high plateau
  const d = ((lat - 36.5) * 0.75 + (lon - 45.0) * 0.66); // signed distance-ish
  const zag = d > -0.4 ? 1600 + 1400 * Math.exp(-((d - 0.6) ** 2) * 3) : 0;
  const taurus = lat > 37.2 ? (lat - 37.2) * 1600 : 0;
  // alluvium rising to NW and to the western desert
  const base = 2 + Math.max(0, lat - 30.2) * 40 + Math.max(0, 43.5 - lon) * 90 + Math.max(0, 31.5 - lat) * Math.max(0, 45 - lon) * 60;
  const n = fbm(lon * 2, lat * 2);
  return Math.max(1, base + zag * (0.6 + 0.6 * n) + taurus * (0.7 + 0.5 * n) + n * 30);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  const lat = B.north - (y + 0.5) / H * (B.north - B.south);
  for (let x = 0; x < W; x++) {
    const lon = B.west + (x + 0.5) / W * (B.east - B.west);
    const v = elev(lon, lat) + 32768;
    const r = Math.floor(v / 256), g = Math.floor(v) % 256, b = 0;
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(join(here, 'height-fixture.png'), png);
writeFileSync(join(here, 'terrain-fixture.json'), JSON.stringify({ bbox: B, width: W, height: H, encoding: 'terrarium', pixelRegistration: 'area', source: 'PROCEDURAL FIXTURE (not real terrain)' }, null, 2));
console.log('wrote height-fixture.png', png.length, 'bytes');
