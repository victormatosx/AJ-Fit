#!/usr/bin/env node
// Regenerates the static `android:previewImage` bitmaps used by the Home
// Screen Widgets picker (modules/ajfit-widgets/android/src/main/res/drawable-nodpi/ajfit_preview_*.png).
//
// Why this exists: Android's richer `android:previewLayout` mechanism
// (API 31+) was verified NOT to be honored by the MIUI/Xiaomi launcher on a
// physical test device (Android 13) — it silently falls back to
// `previewImage`. A plain app-icon `previewImage` is what originally made
// the AJ Fit widgets show no useful preview in the picker, so these bitmaps
// must be a representative rendering of each widget (demo data only — never
// read from WidgetSnapshot/SharedPreferences).
//
// No raster/SVG library is available in this environment (no sharp, no
// canvas, no ImageMagick), and Glance/RemoteViews text can't be reproduced
// faithfully without real font rendering, so these previews are drawn with
// plain shape primitives (rounded rects, circles) in the real AJ Fit
// palette — not real typography. See the Fase 4 report for that limitation.
//
// Deterministic: run with `node plugins/widgets/tools/generate_preview_bitmaps.js`
// any time the preview composition changes; re-running with unchanged
// constants below reproduces byte-identical PNGs.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })());
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

class Canvas {
  constructor(w, h, bg) {
    this.w = w; this.h = h;
    this.data = Buffer.alloc(w * h * 4);
    this.fillRect(0, 0, w, h, bg);
  }
  setPx(x, y, [r, g, b, a]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = 255;
      return;
    }
    const srcA = a / 255;
    const dstR = this.data[i], dstG = this.data[i + 1], dstB = this.data[i + 2], dstA = this.data[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) { this.data[i + 3] = 0; return; }
    this.data[i] = Math.round((r * srcA + dstR * dstA * (1 - srcA)) / outA);
    this.data[i + 1] = Math.round((g * srcA + dstG * dstA * (1 - srcA)) / outA);
    this.data[i + 2] = Math.round((b * srcA + dstB * dstA * (1 - srcA)) / outA);
    this.data[i + 3] = Math.round(outA * 255);
  }
  fillRect(x0, y0, w, h, color) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.setPx(x, y, color);
  }
  fillRoundRect(x0, y0, w, h, radius, color) {
    for (let y = y0; y < y0 + h; y++) {
      const inCornerY = y < y0 + radius || y >= y0 + h - radius;
      for (let x = x0; x < x0 + w; x++) {
        const inCornerX = x < x0 + radius || x >= x0 + w - radius;
        if (!(inCornerX && inCornerY)) { this.setPx(x, y, color); continue; }
        const cx = x < x0 + radius ? x0 + radius : x0 + w - radius;
        const cy = y < y0 + radius ? y0 + radius : y0 + h - radius;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) this.setPx(x, y, color);
      }
    }
  }
  fillCircle(cx, cy, r, color) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx + 0.5, dy = y - cy + 0.5;
        if (dx * dx + dy * dy <= r * r) this.setPx(x, y, color);
      }
    }
  }
  strokeCircle(cx, cy, r, width, color) {
    for (let y = Math.floor(cy - r - width); y <= Math.ceil(cy + r + width); y++) {
      for (let x = Math.floor(cx - r - width); x <= Math.ceil(cx + r + width); x++) {
        const dx = x - cx + 0.5, dy = y - cy + 0.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= r - width / 2 && d <= r + width / 2) this.setPx(x, y, color);
      }
    }
  }
  toPNG() {
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(this.w, 0);
    ihdrData.writeUInt32BE(this.h, 4);
    ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
    const ihdr = chunk('IHDR', ihdrData);
    const raw = Buffer.alloc(this.h * (1 + this.w * 4));
    for (let y = 0; y < this.h; y++) {
      const rowStart = y * (1 + this.w * 4);
      raw[rowStart] = 0;
      this.data.copy(raw, rowStart + 1, y * this.w * 4, (y + 1) * this.w * 4);
    }
    const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
    const iend = chunk('IEND', Buffer.alloc(0));
    return Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), ihdr, idat, iend]);
  }
}

const BG = [2, 0, 16, 255];
const PRIMARY = [11, 112, 249, 255];
const EMPHASIS = [77, 163, 255, 255];
const SURFACE = [255, 255, 255, 18];
const FAINT_STROKE = [77, 163, 255, 70];
const OUTDIR = path.resolve(__dirname, '../../../modules/ajfit-widgets/android/src/main/res/drawable-nodpi');
fs.mkdirSync(OUTDIR, { recursive: true });

// Monthly preview — calendar grid dominant. Canvas height is sized from the
// grid math itself (cell solved from width, rows solved from that cell) so
// no row can silently fall outside the canvas.
{
  const W = 300, startY = 42, gap = 4, cols = 7, rows = 5;
  const cell = (W - 28 - gap * (cols - 1)) / cols;
  const H = Math.ceil(startY + rows * cell + (rows - 1) * gap + 10);
  const c = new Canvas(W, H, BG);
  c.fillRoundRect(14, 14, 90, 14, 4, [255, 255, 255, 230]); // title bar
  c.fillCircle(276, 21, 9, EMPHASIS); // logo dot
  const completed = new Set([2, 6, 9, 10, 15, 21, 24]);
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = 14 + col * (cell + gap);
      const y = startY + r * (cell + gap);
      c.fillRoundRect(Math.round(x), Math.round(y), Math.round(cell), Math.round(cell), 3, completed.has(idx) ? PRIMARY : SURFACE);
      idx++;
    }
  }
  fs.writeFileSync(path.join(OUTDIR, 'ajfit_preview_monthly.png'), c.toPNG());
}

// Weekly preview — 300x150, big streak block + 7 circles
{
  const c = new Canvas(300, 150, BG);
  c.fillRoundRect(14, 14, 110, 10, 3, [255, 255, 255, 230]); // header title
  c.fillCircle(276, 19, 9, EMPHASIS);
  c.fillRoundRect(14, 70, 70, 40, 8, PRIMARY); // streak block proxy
  const states = [PRIMARY, SURFACE, PRIMARY, [255, 255, 255, 60], PRIMARY, SURFACE, [96, 96, 160, 120]];
  const n = states.length, startX = 104, endX = 286, spacing = (endX - startX) / (n - 1);
  for (let i = 0; i < n; i++) {
    const cx = startX + i * spacing;
    c.fillCircle(cx, 95, 13, states[i]);
    if (states[i] === SURFACE) c.strokeCircle(cx, 95, 13, 1.5, FAINT_STROKE);
  }
  fs.writeFileSync(path.join(OUTDIR, 'ajfit_preview_weekly.png'), c.toPNG());
}

// Compact preview — big ring watermark (bleeding past the top-right corner,
// same adaptation as the real widget) + streak block + dots.
{
  const c = new Canvas(200, 200, BG);
  c.strokeCircle(170, 40, 60, 3, [77, 163, 255, 15]); // nearly transparent AJ watermark
  c.fillRoundRect(14, 14, 64, 9, 3, [77, 163, 255, 220]); // "SEQUENCIA" label
  c.fillRoundRect(14, 36, 78, 48, 10, [255, 255, 255, 235]); // big streak number block
  let dx = 14;
  const dotColors = [PRIMARY, PRIMARY, SURFACE, PRIMARY, SURFACE, PRIMARY, SURFACE];
  for (const col of dotColors) { c.fillCircle(dx + 5, 178, 5, col); dx += 15; }
  fs.writeFileSync(path.join(OUTDIR, 'ajfit_preview_compact.png'), c.toPNG());
}

// Frequency preview — dense heatmap grid dominant. Canvas height solved
// from the grid math, same reasoning as the monthly preview above.
{
  const W = 300, startY = 36, gap = 4, cols = 10, rows = 3, footerH = 18;
  const cell = (W - 28 - gap * (cols - 1)) / cols;
  const H = Math.ceil(startY + rows * cell + (rows - 1) * gap + footerH + 10);
  const c = new Canvas(W, H, BG);
  c.fillRoundRect(14, 10, 90, 12, 4, [255, 255, 255, 230]);
  c.fillCircle(276, 16, 10, EMPHASIS);
  const completedIdx = new Set([1,3,4,8,9,10,14,17,18,22,23,27,29]);
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = 14 + col * (cell + gap);
      const y = startY + r * (cell + gap);
      c.fillRoundRect(Math.round(x), Math.round(y), Math.round(cell), Math.round(cell), 3, completedIdx.has(idx) ? PRIMARY : SURFACE);
      idx++;
    }
  }
  const footerY = H - footerH;
  c.fillRoundRect(14, footerY, 70, 8, 3, [255, 255, 255, 150]); // footer "N treinos"
  c.fillRoundRect(W - 14 - 56, footerY, 56, 8, 3, [255, 255, 255, 90]); // footer "30 DIAS"
  fs.writeFileSync(path.join(OUTDIR, 'ajfit_preview_frequency.png'), c.toPNG());
}

// Próximo Treino preview — representative small-family hierarchy: eyebrow
// and logo, workout title, centered BodyMap, then one metric per line.
{
  const c = new Canvas(200, 200, BG);
  c.fillRoundRect(14, 14, 88, 9, 3, [77, 163, 255, 220]);
  c.fillCircle(178, 18, 9, EMPHASIS);
  c.fillRoundRect(14, 40, 154, 14, 4, [255, 255, 255, 235]);
  c.fillRoundRect(14, 61, 128, 14, 4, [255, 255, 255, 235]);
  for (const x of [82, 118]) {
    c.fillCircle(x, 85, 6, [255, 255, 255, 90]);
    c.fillRoundRect(x - 8, 92, 16, 33, 5, [255, 255, 255, 90]);
    c.fillRoundRect(x - 13, 95, 5, 30, 2, [255, 255, 255, 90]);
    c.fillRoundRect(x + 8, 95, 5, 30, 2, [255, 255, 255, 90]);
    c.fillRoundRect(x - 8, 122, 7, 34, 3, [255, 255, 255, 90]);
    c.fillRoundRect(x + 1, 122, 7, 34, 3, [255, 255, 255, 90]);
    c.fillRoundRect(x - 8, 122, 7, 14, 2, EMPHASIS);
    c.fillRoundRect(x + 1, 122, 7, 14, 2, EMPHASIS);
  }
  c.fillRoundRect(14, 168, 78, 7, 3, [255, 255, 255, 150]);
  c.fillRoundRect(14, 181, 62, 7, 3, [255, 255, 255, 150]);
  fs.writeFileSync(path.join(OUTDIR, 'ajfit_preview_workout.png'), c.toPNG());
}

console.log('Generated preview PNGs in', OUTDIR);
