#!/usr/bin/env node
// Generate the PWA icons (192/512) and OG image (1200x630) from scratch.
// Pure-Node PNG encoder — no native deps. Re-run if the design changes.
//
// Output: /public/icon-192.png, /public/icon-512.png, /public/og.png
//
// Design: amber (#f5b840) background, black "S" mark drawn from rectangles.
// The OG image adds a subtle radial halo + S badge centered in the 1200x630.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "public");
mkdirSync(PUBLIC, { recursive: true });

// ─── PNG encoding ──────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tag = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])), 0);
  return Buffer.concat([len, tag, data, crc]);
}
function encodePNG(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(2, 9);   // color type RGB
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Drawing primitives ────────────────────────────────────────────────────
function newCanvas(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  }
  return { w, h, buf };
}
function setPixel(c, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 3;
  c.buf[i] = r; c.buf[i + 1] = g; c.buf[i + 2] = b;
}
function rect(c, x, y, w, h, color) {
  const x0 = Math.round(x), y0 = Math.round(y);
  const x1 = Math.round(x + w), y1 = Math.round(y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPixel(c, xx, yy, color);
  }
}
function radialHalo(c, cx, cy, radius, [r, g, b], maxAlpha = 0.5) {
  // Composite a soft amber glow over the existing pixels.
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const a = (1 - d / radius) ** 2 * maxAlpha;
      const i = (y * c.w + x) * 3;
      c.buf[i]     = Math.round(c.buf[i]     * (1 - a) + r * a);
      c.buf[i + 1] = Math.round(c.buf[i + 1] * (1 - a) + g * a);
      c.buf[i + 2] = Math.round(c.buf[i + 2] * (1 - a) + b * a);
    }
  }
}

// Draw a stylized "S" using 3 horizontal strokes + 2 vertical half-strokes.
// Box is the S's bounding rect. Stroke is the line thickness.
function drawS(c, bx, by, bw, bh, color) {
  const sw = Math.max(2, Math.round(bw * 0.18)); // stroke thickness
  // 3 horizontal bars
  rect(c, bx, by,                bw, sw, color); // top
  rect(c, bx, by + (bh - sw) / 2, bw, sw, color); // middle
  rect(c, bx, by + bh - sw,      bw, sw, color); // bottom
  // upper-left vertical (top stroke center → middle stroke center)
  rect(c, bx, by, sw, (bh - sw) / 2, color);
  // lower-right vertical (middle stroke → bottom stroke)
  rect(c, bx + bw - sw, by + (bh - sw) / 2, sw, (bh - sw) / 2 + sw, color);
}

// ─── Compose icons ─────────────────────────────────────────────────────────
const AMBER = [0xf5, 0xb8, 0x40];
const BLACK = [0x10, 0x10, 0x10];
const BG = [0x0b, 0x0d, 0x10];

function makeIcon(size) {
  const c = newCanvas(size, size, AMBER);
  // Center an S that fills ~56% of the icon
  const sBoxW = Math.round(size * 0.48);
  const sBoxH = Math.round(size * 0.62);
  const x = Math.round((size - sBoxW) / 2);
  const y = Math.round((size - sBoxH) / 2);
  drawS(c, x, y, sBoxW, sBoxH, BLACK);
  return encodePNG(size, size, c.buf);
}

function makeOG() {
  const w = 1200, h = 630;
  const c = newCanvas(w, h, BG);
  // Amber halo behind a black-bordered amber S badge.
  radialHalo(c, w / 2, h / 2, 460, AMBER, 0.35);
  // Round-ish badge: amber square with rounded corners faked as a full square.
  const badge = 280;
  const bx = Math.round((w - badge) / 2);
  const by = Math.round((h - badge) / 2);
  rect(c, bx, by, badge, badge, AMBER);
  // Inset S
  const sBoxW = Math.round(badge * 0.48);
  const sBoxH = Math.round(badge * 0.62);
  drawS(c, bx + (badge - sBoxW) / 2, by + (badge - sBoxH) / 2, sBoxW, sBoxH, BLACK);
  // Bottom hairline
  rect(c, w / 2 - 60, h - 80, 120, 2, [0xa8, 0xad, 0xb6]);
  return encodePNG(w, h, c.buf);
}

const icon192 = makeIcon(192);
writeFileSync(join(PUBLIC, "icon-192.png"), icon192);
const icon512 = makeIcon(512);
writeFileSync(join(PUBLIC, "icon-512.png"), icon512);
const og = makeOG();
writeFileSync(join(PUBLIC, "og.png"), og);

console.log(`wrote public/icon-192.png  ${icon192.length}b`);
console.log(`wrote public/icon-512.png  ${icon512.length}b`);
console.log(`wrote public/og.png        ${og.length}b`);
