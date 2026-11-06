/**
 * Shared helpers for the swuple sketch sheets (concepts.mjs, mascots.mjs, marks.mjs, swipe.mjs, script*.mjs): palette,
 * fonts, text as paths, tiles, app icons, the smooth-to-pixel fade, the mark sheet layout and the home screen mock.
 * Marks are drawn in a 1024 box on a transparent background.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(HERE, "../../packages/design-tokens");
// sharp and opentype.js come from the design-tokens package, so the sketches need no install of their own.
const require = createRequire(resolve(TOKENS, "package.json"));
const sharp = require("sharp");
const opentype = require("opentype.js");
export const { palette: P } = await import(resolve(TOKENS, "src/index.ts"));

export const OUT = resolve(HERE, "concepts");
mkdirSync(OUT, { recursive: true });

export const f = (v) => +v.toFixed(2);
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;

export function loadFont(file) {
  const buf = readFileSync(resolve(TOKENS, "fonts/native", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
export const DISPLAY = loadFont("MonaSansDisplayExpanded-Black.ttf");
export const MONO = loadFont("DepartureMono-Regular.otf");

/** Text as path data, tracked like the wordmark. */
export function text(str, size, x, baseline, { font = DISPLAY, tracking = -0.02 } = {}) {
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  let cursor = x;
  const d = glyphs
    .map((g, i) => {
      const p = g.getPath(cursor, baseline, size).toPathData(2);
      const next = glyphs[i + 1];
      cursor += (g.advanceWidth ?? 0) * scale + (next ? font.getKerningValue(g, next) * scale + tracking * size : 0);
      return p;
    })
    .join("");
  return { d, width: cursor - x };
}

/** One glyph centered on (cx, cy) by its ink bounds. */
export function glyphAt(ch, size, cx, cy, fill) {
  const bb = DISPLAY.getPath(ch, 0, 0, size).getBoundingBox();
  const x = cx - (bb.x1 + bb.x2) / 2;
  const y = cy - (bb.y1 + bb.y2) / 2;
  return `<path d="${DISPLAY.getPath(ch, x, y, size).toPathData(2)}" fill="${fill}"/>`;
}

/** An uppercase mono label, tracked +4 % like the product's labels. */
export const label = (str, x, y, color = P.paperMute, size = 24) => `<path d="${text(str, size, x, y, { font: MONO, tracking: 0.04 }).d}" fill="${color}"/>`;

/** A rounded tile centered on (x, y). */
export const tile = (x, y, w, fill, r = w * 0.19) => `<rect x="${f(x - w / 2)}" y="${f(y - w / 2)}" width="${f(w)}" height="${f(w)}" rx="${f(r)}" fill="${fill}"/>`;

/** 1024-box artwork placed at (x, y), `size` wide. */
export const place = (art, x, y, size) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(size / 1024)})">${art}</g>`;

/** An app icon: ink rounded square with the artwork inset by `inset` of its size. */
export const icon = (art, x, y, size, inset = 0) =>
  `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${f(size * 0.2237)}" fill="${P.ink1}"/>${place(art, x + size * inset, y + size * inset, size * (1 - 2 * inset))}`;

let iconClip = 0;
/** Artwork that is a whole app icon: `bg` and `art` clipped to the icon's rounded square in the 1024 box. */
export function appIcon(art, bg) {
  const id = `appicon${iconClip++}`;
  return `<defs><clipPath id="${id}"><rect width="1024" height="1024" rx="${f(1024 * 0.2237)}"/></clipPath></defs><g clip-path="url(#${id})"><rect width="1024" height="1024" fill="${bg}"/>${art}</g>`;
}

/** Renders a sheet body to concepts/<file>. */
export async function writeSheet(body, w, h, file) {
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`), { density: 72 })
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT, file));
  console.log(`${file} written to ${OUT}`);
}

/** The plain wordmark: Mona Sans Display Expanded Black, ink on light, paper on dark. */
const TYPESET = {
  width: (size) => text("swuple", size, 0, 0).width,
  draw: (m, x, baseline, size, light) => `<path d="${text("swuple", size, x, baseline).d}" fill="${light ? P.ink1 : P.paper}"/>`,
};

/**
 * A lockup centered on (cx, cy): the mark (`vis` = its visible left and right edge), then the wordmark, `{ width(size),
 * draw(mark, x, baseline, size, light) }`.
 */
function lockup(art, m, cx, cy, light, wordmark = TYPESET) {
  const s = 130, size = 60, gap = 24;
  const k = s / 1024;
  const markW = (m.vis[1] - m.vis[0]) * k;
  const x = cx - (markW + gap + wordmark.width(size)) / 2;
  return place(art, x - m.vis[0] * k, cy - s / 2, s) + wordmark.draw(m, x + markW + gap, cy + size * 0.27, size, light);
}

/**
 * Eight marks, four to a row: each as an app icon, at 96 / 48 / 32 px, and in a lockup on ink and on paper.
 * A mark is { title, vis: [left, right], draw: () => artwork | Promise<artwork>, inset? }. `inset` (default 0.06) is
 * the margin inside the app icon; 0 for artwork that is a whole icon itself (see `appIcon`). `wordmark` replaces the
 * plain wordmark in the lockups (see `lockup`).
 */
export async function markSheet(marks, file, { wordmark } = {}) {
  const W = 2400, CELL_W = 600, CELL_H = 880;
  const SH = Math.ceil(marks.length / 4) * CELL_H + 60;
  let body = `<rect width="${W}" height="${SH}" fill="#000000"/>`;
  for (const [i, m] of marks.entries()) {
    const art = await m.draw();
    const x = (i % 4) * CELL_W, y = Math.floor(i / 4) * CELL_H + 20;
    const inset = m.inset ?? 0.06;
    body += icon(art, x + 40, y + 40, 360, inset);
    body += icon(art, x + 430, y + 40, 96, inset) + icon(art, x + 454, y + 166, 48, inset) + icon(art, x + 462, y + 244, 32, inset);
    body += lockup(art, m, x + 300, y + 500, false, wordmark);
    body += `<rect x="${x + 30}" y="${y + 580}" width="540" height="160" rx="8" fill="${P.paper}"/>`;
    body += lockup(art, m, x + 300, y + 660, true, wordmark);
    body += label(m.title, x + 40, y + 810, P.paperDim);
  }
  body += label("SKETCHES · NOT FINAL ARTWORK", 40, SH - 24, P.paperMute, 22);
  await writeSheet(body, W, SH, file);
}

/**
 * Home screens: app icons (whole-icon artwork, see `appIcon`) at real size among neutral placeholder apps, on a dark
 * and a light wallpaper, each labeled with its name. Up to eight.
 */
export async function homeScreens(arts, names, file) {
  const SEMI = loadFont("MonaSans-SemiBold.ttf");
  const W = 2400, H = 1500, SIZE = 180, GAP = 82, COLS = 4;
  const placeholder = (x, y, i, light) => {
    const tones = light ? ["#D9D5CC", "#C9C4BA", "#E4E0D8", "#BDB8AE"] : ["#2A2A31", "#34343C", "#202026", "#3A3A44"];
    const glyphs = [`<circle cx="0.5" cy="0.5" r="0.2"/>`, `<rect x="0.3" y="0.3" width="0.4" height="0.4" rx="0.08"/>`, `<path d="M0.5 0.28 L0.72 0.68 L0.28 0.68Z"/>`, `<rect x="0.26" y="0.44" width="0.48" height="0.12" rx="0.06"/>`];
    return `<g transform="translate(${x} ${y}) scale(${SIZE})"><rect width="1" height="1" rx="0.2237" fill="${tones[i % 4]}"/><g fill="${light ? "#FFFFFF" : "#55555F"}" opacity="0.8">${glyphs[i % 4]}</g></g>`;
  };
  const appLabel = (str, x, y, light) => {
    const t = text(str, 24, 0, 0, { font: SEMI, tracking: 0 });
    return `<path d="${t.d}" transform="translate(${f(x + SIZE / 2 - t.width / 2)} ${y + SIZE + 38})" fill="${light ? "#1A1A1F" : "#FFFFFF"}"/>`;
  };
  let h = `<rect width="${W}" height="${H}" fill="#000000"/>`;
  for (const [wi, light] of [false, true].entries()) {
    const x0 = 80 + wi * 1180, y0 = 80;
    const stops = light ? [[0, "#F6F1E7"], [1, "#D8D2C6"]] : [[0, "#1B1730"], [0.6, "#0E0E14"], [1, "#2A1410"]];
    h += `<defs><linearGradient id="wall${wi}" x1="0" y1="0" x2="1" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient></defs>`;
    h += `<rect x="${x0}" y="${y0}" width="1080" height="1340" rx="60" fill="url(#wall${wi})"/>`;
    for (let s = 0; s < 16; s++) {
      const cx = x0 + 80 + (s % COLS) * (SIZE + GAP), cy = y0 + 70 + Math.floor(s / COLS) * (SIZE + 110);
      h += s < arts.length ? place(arts[s], cx, cy, SIZE) + appLabel(names[s], cx, cy, light) : placeholder(cx, cy, s, light) + appLabel("App", cx, cy, light);
    }
  }
  h += label("SKETCHES · NOT FINAL ARTWORK", 80, H - 24, P.paperMute, 22);
  await writeSheet(h, W, H, file);
}

// ---------------------------------------------------------------------------
// Smooth to pixel
// ---------------------------------------------------------------------------

const PALETTE = [
  { hex: P.heat, w: 1 },
  { hex: P.paper, w: 1.7 },
  { hex: P.ink1, w: 2.4 },
  { hex: P.ink4, w: 1 },
].map((c) => ({ ...c, rgb: [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)) }));

async function raster(art) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${art}</svg>`;
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

/** The palette color a b-sized block at (x0, y0) resolves to, or null when it's mostly empty. Small features win ties. */
function sample(data, x0, y0, b) {
  const acc = PALETTE.map(() => 0);
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(1024, y0 + b); y++)
    for (let x = Math.max(0, x0); x < Math.min(1024, x0 + b); x++) {
      n++;
      const i = (y * 1024 + x) * 4;
      const a = data[i + 3] / 255;
      if (a < 0.05) continue;
      let best = 0, bestD = Infinity;
      PALETTE.forEach((c, k) => {
        const d = (c.rgb[0] - data[i]) ** 2 + (c.rgb[1] - data[i + 1]) ** 2 + (c.rgb[2] - data[i + 2]) ** 2;
        if (d < bestD) [best, bestD] = [k, d];
      });
      acc[best] += a;
    }
  if (!n || acc.reduce((s, v) => s + v, 0) / n < 0.45) return null;
  let k = 0;
  acc.forEach((v, j) => { if (v * PALETTE[j].w > acc[k] * PALETTE[k].w) k = j; });
  return PALETTE[k].hex;
}

/** Last row with any ink, so the fade reaches its coarsest blocks at the very end of the trail. */
function bottom(data) {
  for (let y = 1023; y > 0; y--) for (let x = 0; x < 1024; x++) if (data[(y * 1024 + x) * 4 + 3] > 20) return y;
  return 1023;
}

/**
 * Blocks from y0 down. Block size eases from b0 to b1 and the gap between blocks from 0 to `gap` (of the block),
 * so the artwork dissolves into separate tiles toward its trail. A column is centered on x = 512.
 */
function blocks(data, y0, { b0, b1, gap = 0.24, end = bottom(data) }) {
  let d = "";
  let y = y0;
  while (y <= end) {
    const t = clamp((y - y0) / Math.max(1, end - y0));
    const b = Math.round(lerp(b0, b1, t ** 1.2));
    const g = lerp(0, gap, t ** 1.4);
    for (let x = 512 - b / 2 - Math.ceil((512 - b / 2) / b) * b; x < 1024; x += b) {
      const color = sample(data, Math.round(x), y, b);
      if (!color) continue;
      const s = b * (1 - g);
      const pad = g < 0.02 ? 0.6 : 0;
      const r = g < 0.02 ? 0 : s * 0.18;
      d += `<rect x="${f(x + (b - s) / 2 - pad)}" y="${f(y + (b - s) / 2 - pad)}" width="${f(s + 2 * pad)}" height="${f(s + 2 * pad)}" rx="${f(r)}" fill="${color}"/>`;
    }
    y += b;
  }
  return d;
}

let clipId = 0;
/**
 * The artwork smooth above y0 and resampled into growing, separating blocks below it.
 * `pixelOnly` is drawn only into the blocks (a smear that exists as trail, never as a smooth shape).
 */
export async function fade(art, { y0, b0 = 28, b1 = 96, gap = 0.3, pixelOnly = "" }) {
  const data = await raster(art + pixelOnly);
  const id = `fade${clipId++}`;
  return `<defs><clipPath id="${id}"><rect width="1024" height="${y0}"/></clipPath></defs><g clip-path="url(#${id})">${art}</g>${blocks(data, y0, { b0, b1, gap })}`;
}
