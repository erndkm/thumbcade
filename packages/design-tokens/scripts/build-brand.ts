/**
 * Generates the Thumbcade brand assets from code so they stay exact and reproducible.
 *
 * The mark: a top-down red arcade button whose concentric rings form a thumbprint whorl. Toward the bottom the
 * ridges resolve into pixels (smooth, then half pixels, then full pixels): a real thumb turning into a game.
 * Outputs (brand/):
 *   mark.svg                  the button alone, transparent background
 *   app-icon.svg / .png       1024 iOS app icon (ink background, full bleed)
 *   adaptive-foreground.png   1024 Android adaptive foreground (mark inside the 66% safe zone)
 *   adaptive-background.png   1024 solid ink
 *   adaptive-monochrome.png   1024 Android 13 themed icon (white silhouette)
 *   splash-icon.png           1024 transparent mark for expo-splash-screen
 *   favicon.svg / favicon-*.png
 *   wordmark.svg              "thumbcade" set in Mona Sans Display Expanded Black, as paths
 *   lockup.svg                mark + wordmark
 *   og-default.png            1200x630 social card
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";
import { palette } from "../src/tokens.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "brand");
mkdirSync(out, { recursive: true });

const INK = palette.ink1;
/** The button cap: a classic red arcade button. Every cap shade below is derived from it. */
const CAP = palette.heat;

/** Mixes a hex color toward white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return `#${[16, 8, 0]
    .map((bits) => (n >> bits) & 255)
    .map((v) => Math.round(v + (target - v) * t).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Whorl geometry
// ---------------------------------------------------------------------------

/**
 * The print is authored on a pixel grid (for a cap radius of 300) so its lower part can resolve into pixels:
 * ring k is a circle of radius (2k + 1) * CELL around the print center and one CELL wide, so a ridge is exactly
 * one full pixel and every ring runs through pixel centers.
 */
const CELL = 28;

/** Where the ridges change resolution, measured down from the print center: smooth, then half pixels, then full pixels. */
const HALF_PIXELS_FROM = 1.5 * CELL;
const FULL_PIXELS_FROM = 4.5 * CELL;

interface Ring {
  k: number;
  /** Gap center angle in degrees (0 = 3 o'clock, clockwise). */
  gapAt: number;
  /** Gap width in degrees. */
  gap: number;
}

/** Ridges of the print, innermost first. Gaps are staggered so the rings read as one whorl. */
const RINGS: Ring[] = [
  { k: 0, gapAt: 205, gap: 150 },
  { k: 1, gapAt: 22, gap: 50 },
  { k: 2, gapAt: 232, gap: 34 },
  { k: 3, gapAt: 120, gap: 28 },
  { k: 4, gapAt: 320, gap: 24 },
];

const radius = (ring: Ring) => (2 * ring.k + 1) * CELL;

/** True when (x, y), relative to the print center, lies on the drawn part of the ring rather than in its gap. */
function onRing(ring: Ring, x: number, y: number): boolean {
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  const fromGap = Math.abs(((((angle - ring.gapAt) % 360) + 540) % 360) - 180);
  return fromGap > ring.gap / 2;
}

/** Circular arc path around (cx, cy) skipping the gap. */
function ringPath(cx: number, cy: number, ring: Ring, scale: number): string {
  const r = radius(ring) * scale;
  const start = ((ring.gapAt + ring.gap / 2) * Math.PI) / 180;
  const sweepDeg = 360 - ring.gap;
  const end = start + (sweepDeg * Math.PI) / 180;
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  const [x0, y0] = p(start);
  const [x1, y1] = p(end);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** A square pixel: top-left corner and size, relative to the print center. */
type Pixel = readonly [x: number, y: number, size: number];

/**
 * Half-size pixels between HALF_PIXELS_FROM and FULL_PIXELS_FROM: every cell whose center lies inside a ridge, so
 * the ridges stay two pixels wide and follow the curve closely. Cells nest inside the full-pixel grid.
 */
function halfPixels(): Pixel[] {
  const size = CELL / 2;
  const pixels: Pixel[] = [];
  const n = Math.ceil(320 / size);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = (i - 0.5) * size;
      const y = (j - 0.5) * size;
      const top = y - size / 2;
      if (top < HALF_PIXELS_FROM || top >= FULL_PIXELS_FROM) continue;
      const rho = Math.hypot(x, y);
      const ring = RINGS.find((r) => Math.abs(rho - radius(r)) < CELL / 2 && onRing(r, x, y));
      if (ring) pixels.push([x - size / 2, top, size]);
    }
  }
  return pixels;
}

/** Full pixels below FULL_PIXELS_FROM: each ridge as a one-pixel, 8-connected pixel-art circle. */
function fullPixels(): Pixel[] {
  const pixels: Pixel[] = [];
  for (const ring of RINGS) {
    const n = 2 * ring.k + 1;
    const cells = new Map<string, readonly [number, number]>();
    for (let i = 0; i <= n; i++) {
      const j = Math.round(Math.sqrt(n * n - i * i));
      if (i > j) continue;
      for (const [a, b] of [[i, j], [j, i]] as const) {
        for (const sx of [1, -1]) for (const sy of [1, -1]) cells.set(`${a * sx},${b * sy}`, [a * sx, b * sy]);
      }
    }
    for (const [i, j] of cells.values()) {
      const top = (j - 0.5) * CELL;
      if (top >= FULL_PIXELS_FROM && onRing(ring, i * CELL, j * CELL)) pixels.push([(i - 0.5) * CELL, top, CELL]);
    }
  }
  return pixels;
}

/** Merges horizontally adjacent pixels of the same size into runs: [x, y, width, height]. */
function runs(pixels: Pixel[]): (readonly [number, number, number, number])[] {
  const sorted = [...pixels].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const out: [number, number, number, number][] = [];
  for (const [x, y, size] of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === y && last[3] === size && Math.abs(last[0] + last[2] - x) < 1e-6) last[2] += size;
    else out.push([x, y, size, size]);
  }
  return out;
}

const PIXEL_RUNS = runs([...halfPixels(), ...fullPixels()]);

/**
 * The ridges around print center (cx, cy) at scale s: smooth strokes above HALF_PIXELS_FROM, pixels below.
 * The strokes run half a unit into the pixel band so no hairline shows at the seam.
 */
function ridges(cx: number, cy: number, s: number, color: string, id: string): string {
  const smooth = RINGS.map((ring) => `<path d="${ringPath(cx, cy, ring, s)}"/>`).join("");
  const f = (v: number) => +v.toFixed(2);
  const pixels = PIXEL_RUNS.map(([x, y, w, h]) => `M${f(cx + x * s)} ${f(cy + y * s)}h${f(w * s)}v${f(h * s)}h${f(-w * s)}z`).join("");
  return `<defs><clipPath id="${id}-smooth"><rect x="${f(cx - 320 * s)}" y="${f(cy - 320 * s)}" width="${f(640 * s)}" height="${f((320 + HALF_PIXELS_FROM + 0.5) * s)}"/></clipPath></defs>
  <g clip-path="url(#${id}-smooth)" fill="none" stroke="${color}" stroke-width="${CELL * s}" stroke-linecap="round">${smooth}</g>
  <path d="${pixels}" fill="${color}"/>`;
}

/**
 * The button mark centered at (cx, cy) with cap radius R.
 * Housing ring (dark), cap (red with a soft convex highlight), engraved whorl ridges (ink) that turn to pixels
 * toward the bottom.
 */
function markGroup(cx: number, cy: number, R: number, opts: { mono?: boolean; idPrefix?: string } = {}): string {
  const id = opts.idPrefix ?? "m";
  const s = R / 300; // geometry is authored for R = 300
  const housing = R + 44 * s;
  const depth = 22 * s;
  const capY = cy - depth / 2;
  const printY = capY - 6 * s;
  if (opts.mono) {
    return `<g>
  <circle cx="${cx}" cy="${cy}" r="${housing}" fill="#fff"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 6 * s}" fill="#000"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff"/>
  ${ridges(cx, printY, s, "#000", id)}
</g>`;
  }
  return `<defs>
  <radialGradient id="${id}-cap" cx="0.38" cy="0.32" r="0.85">
    <stop offset="0" stop-color="${shade(CAP, 0.4)}"/>
    <stop offset="0.45" stop-color="${CAP}"/>
    <stop offset="1" stop-color="${shade(CAP, -0.14)}"/>
  </radialGradient>
  <linearGradient id="${id}-housing" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2E2E36"/>
    <stop offset="1" stop-color="#141418"/>
  </linearGradient>
  <linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${shade(CAP, -0.42)}"/>
    <stop offset="1" stop-color="${shade(CAP, -0.66)}"/>
  </linearGradient>
  <clipPath id="${id}-clip"><circle cx="${cx}" cy="${capY}" r="${R}"/></clipPath>
</defs>
<g>
  <circle cx="${cx}" cy="${cy}" r="${housing}" fill="url(#${id}-housing)"/>
  <circle cx="${cx}" cy="${cy}" r="${housing - 1.5 * s}" fill="none" stroke="#3A3A44" stroke-width="${3 * s}" stroke-opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="${R + depth / 2 + 8 * s}" fill="#08080A"/>
  <circle cx="${cx}" cy="${cy + depth / 2}" r="${R}" fill="url(#${id}-side)"/>
  <circle cx="${cx}" cy="${capY}" r="${R}" fill="url(#${id}-cap)"/>
  <g clip-path="url(#${id}-clip)" opacity="0.94">${ridges(cx, printY, s, INK, id)}</g>
  <path d="M${cx - R * 0.62} ${capY - R * 0.62} A${R * 0.88} ${R * 0.88} 0 0 1 ${cx + R * 0.2} ${capY - R * 0.86}" fill="none" stroke="${shade(CAP, 0.9)}" stroke-width="${7 * s}" stroke-linecap="round" stroke-opacity="0.32"/>
</g>`;
}

const svg = (w: number, h: number, body: string, bg?: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ""}${body}</svg>\n`;

// ---------------------------------------------------------------------------
// Wordmark (text -> paths)
// ---------------------------------------------------------------------------

/** Text set as SVG path data, laid out glyph by glyph with kerning and tracking (fraction of size). */
function wordmarkPath(
  text: string,
  size: number,
  x: number,
  baseline: number,
  tracking = -0.02,
  fontFile = "MonaSansDisplayExpanded-Black.ttf",
): { d: string; width: number } {
  const buf = readFileSync(resolve(root, "fonts/native", fontFile));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const parts: string[] = [];
  let cursor = x;
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(cursor, baseline, size).toPathData(2));
    const next = glyphs[i + 1];
    cursor += (g.advanceWidth ?? 0) * scale + (next ? font.getKerningValue(g, next) * scale + tracking * size : 0);
  });
  const d = parts.join("");
  if (d.includes("NaN")) throw new Error(`NaN in glyph path for "${text}"`);
  return { d, width: cursor - x };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function png(svgText: string, file: string, size?: { w: number; h: number }, density = 300) {
  // librsvg drops geometry on very wide rasters (~5000px); keep wide canvases at a lower density.
  let img = sharp(Buffer.from(svgText), { density });
  if (size) img = img.resize(size.w, size.h);
  await img.png({ compressionLevel: 9 }).toFile(resolve(out, file));
}

async function main() {
  const S = 1024;
  const C = S / 2;

  const mark = svg(S, S, markGroup(C, C, 300));
  writeFileSync(resolve(out, "mark.svg"), mark);

  // iOS: full-bleed ink square (iOS applies the mask). Slightly smaller mark so it breathes.
  const appIcon = svg(S, S, markGroup(C, C, 312), INK);
  writeFileSync(resolve(out, "app-icon.svg"), appIcon);
  await png(appIcon, "app-icon.png");

  // Android adaptive: foreground must keep content inside the inner 66% (r <= ~338 at 1024).
  await png(svg(S, S, markGroup(C, C, 228)), "adaptive-foreground.png");
  await png(svg(S, S, "", INK), "adaptive-background.png");
  await png(svg(S, S, markGroup(C, C, 228, { mono: true })), "adaptive-monochrome.png");

  // Splash (transparent; the splash background color is ink0).
  await png(svg(S, S, markGroup(C, C, 300)), "splash-icon.png");

  // Favicons.
  const fav = svg(64, 64, markGroup(32, 32, 19, { idPrefix: "f" }), INK);
  writeFileSync(resolve(out, "favicon.svg"), fav);
  for (const px of [32, 48, 180, 192, 512]) await png(svg(S, S, markGroup(C, C, 300), INK), `favicon-${px}.png`, { w: px, h: px });

  // Wordmark + lockup.
  const wm = wordmarkPath("thumbcade", 120, 0, 120);
  const wmW = Math.ceil(wm.width) + 4;
  writeFileSync(resolve(out, "wordmark.svg"), svg(wmW, 150, `<path d="${wm.d}" fill="${palette.paper}"/>`));
  writeFileSync(resolve(out, "wordmark-ink.svg"), svg(wmW, 150, `<path d="${wm.d}" fill="${INK}"/>`));

  const lockH = 200;
  const lockMark = markGroup(100, 100, 74, { idPrefix: "l" });
  const lw = wordmarkPath("thumbcade", 92, 220, 132);
  const lockW = Math.ceil(220 + lw.width + 8);
  const lockup = svg(lockW, lockH, `${lockMark}<path d="${lw.d}" fill="${palette.paper}"/>`);
  writeFileSync(resolve(out, "lockup.svg"), lockup);
  await png(svg(lockW, lockH, `${lockMark}<path d="${lw.d}" fill="${palette.paper}"/>`, INK), "lockup.png", undefined, 216);

  // Default OG card.
  const og = wordmarkPath("thumbcade", 96, 470, 352);
  const ogSvg = svg(
    1200,
    630,
    `${markGroup(250, 315, 150, { idPrefix: "o" })}<path d="${og.d}" fill="${palette.paper}"/>
     <path d="${wordmarkPath("SWIPE UP FOR THE NEXT GAME", 26, 474, 420, 0.04, "DepartureMono-Regular.otf").d}" fill="${palette.paperDim}"/>`,
    "#000000",
  );
  writeFileSync(resolve(out, "og-default.svg"), ogSvg);
  await png(ogSvg, "og-default.png", undefined, 144);
  await png(ogSvg, "og-default-1200.png", { w: 1200, h: 630 }, 144);

  console.log(`brand assets written to ${out}`);
}

void main();
