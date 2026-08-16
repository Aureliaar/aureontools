#!/usr/bin/env node
// Generates hub.ico — a dark rounded tile with a stack of status dots, which is
// what the hub actually shows you. No image libraries: PNGs are hand-encoded and
// wrapped in an ICO container (Vista+ accepts PNG-compressed icon entries).
//
//   node make-icon.mjs [outfile]

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SS = 4; // supersampling factor, for cheap antialiasing

// ---------------------------------------------------------------- drawing

const BG = [26, 27, 30, 255];       // near-black tile
const DOTS = [
  [ 81, 207, 102, 255],             // green   — running
  [173, 181, 189, 110],             // grey    — idle
  [173, 181, 189, 110],
];

function inRoundRect(x, y, w, h, r) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= r && x <= w - r) || (y >= r && y <= h - r)
    ? (x < r || x > w - r) && (y < r || y > h - r)
      ? (x - cx) ** 2 + (y - cy) ** 2 <= r * r
      : true
    : false;
}

function over(dst, i, [r, g, b, a]) {
  const af = a / 255;
  dst[i]     = Math.round(dst[i]     * (1 - af) + r * af);
  dst[i + 1] = Math.round(dst[i + 1] * (1 - af) + g * af);
  dst[i + 2] = Math.round(dst[i + 2] * (1 - af) + b * af);
  dst[i + 3] = Math.round(dst[i + 3] + (255 - dst[i + 3]) * af);
}

/** Render at size*SS then box-filter down, so edges come out smooth. */
function render(size) {
  const S = size * SS;
  const big = new Uint8Array(S * S * 4);

  const radius = S * 0.22;
  const dotR = S * 0.085;
  const dotX = S * 0.30;
  const barX = S * 0.46;
  const barW = S * 0.26;
  const barH = S * 0.055;
  const rows = [S * 0.28, S * 0.5, S * 0.72];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!inRoundRect(x, y, S, S, radius)) continue;
      over(big, i, BG);

      for (let r = 0; r < rows.length; r++) {
        const cy = rows[r];
        // status dot
        if ((x - dotX) ** 2 + (y - cy) ** 2 <= dotR * dotR) over(big, i, DOTS[r]);
        // the name bar beside it
        if (x >= barX && x <= barX + barW && Math.abs(y - cy) <= barH / 2) {
          over(big, i, r === 0 ? [236, 236, 236, 235] : [154, 154, 154, 120]);
        }
      }
    }
  }

  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += big[i]; g += big[i + 1]; b += big[i + 2]; a += big[i + 3];
        }
      }
      const n = SS * SS, o = (y * size + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

// ---------------------------------------------------------------- png

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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // truecolour + alpha
  // 10,11,12 = compression / filter / interlace, all 0

  // Each scanline gets a leading filter byte; filter 0 (none) keeps this simple.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- ico

const SIZES = [256, 64, 48, 32, 16];
const images = SIZES.map((s) => ({ size: s, data: png(render(s), s) }));

const dir = Buffer.alloc(6 + 16 * images.length);
dir.writeUInt16LE(0, 0);              // reserved
dir.writeUInt16LE(1, 2);              // type: icon
dir.writeUInt16LE(images.length, 4);

let offset = dir.length;
images.forEach((img, i) => {
  const p = 6 + i * 16;
  dir[p] = img.size >= 256 ? 0 : img.size;      // 0 means 256
  dir[p + 1] = img.size >= 256 ? 0 : img.size;
  dir[p + 2] = 0;                                // palette size
  dir[p + 3] = 0;                                // reserved
  dir.writeUInt16LE(1, p + 4);                   // colour planes
  dir.writeUInt16LE(32, p + 6);                  // bits per pixel
  dir.writeUInt32LE(img.data.length, p + 8);
  dir.writeUInt32LE(offset, p + 12);
  offset += img.data.length;
});

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || resolve(here, 'hub.ico'));
writeFileSync(out, Buffer.concat([dir, ...images.map((i) => i.data)]));
console.log(`${out} — ${images.length} sizes (${SIZES.join(', ')}), ${Buffer.concat([dir, ...images.map((i) => i.data)]).length} bytes`);
