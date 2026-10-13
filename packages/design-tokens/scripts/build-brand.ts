/**
 * Generates the Thumbcade brand assets from code so they stay exact and reproducible.
 *
 * The mark: a top-down arcade button in volt whose concentric rings form a thumbprint whorl.
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
const VOLT = palette.volt;

// ---------------------------------------------------------------------------
// Whorl geometry
// ---------------------------------------------------------------------------

interface Ring {
  r: number;
  /** Gap center angle in degrees (0 = 3 o'clock, clockwise). */
  gapAt: number;
  /** Gap width in degrees. */
  gap: number;
}

/** Ridges of the print, innermost first. Gaps are staggered so the rings read as one whorl. */
const RINGS: Ring[] = [
  { r: 34, gapAt: 205, gap: 150 },
  { r: 88, gapAt: 22, gap: 50 },
  { r: 142, gapAt: 232, gap: 34 },
  { r: 196, gapAt: 120, gap: 28 },
  { r: 250, gapAt: 320, gap: 24 },
];

/** Elliptical arc path around (cx, cy) skipping the gap. Slightly taller than wide, like a fingertip. */
function ringPath(cx: number, cy: number, ring: Ring, squash = 1.1, scale = 1): string {
  const rx = ring.r * scale;
  const ry = ring.r * squash * scale;
  const start = ((ring.gapAt + ring.gap / 2) * Math.PI) / 180;
  const sweepDeg = 360 - ring.gap;
  const end = start + (sweepDeg * Math.PI) / 180;
  const p = (a: number) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
  const [x0, y0] = p(start);
  const [x1, y1] = p(end);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${rx.toFixed(2)} ${ry.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * The button mark centered at (cx, cy) with cap radius R.
 * Housing ring (dark), cap (volt with a soft convex highlight), engraved whorl ridges (ink).
 */
function markGroup(cx: number, cy: number, R: number, opts: { mono?: boolean; idPrefix?: string } = {}): string {
  const id = opts.idPrefix ?? "m";
  const s = R / 300; // geometry is authored for R = 300
  const housing = R + 44 * s;
  const stroke = 25 * s;
  const depth = 22 * s;
  const ridges = RINGS.map((ring) => `<path d="${ringPath(cx, cy - depth / 2 - 6 * s, ring, 1.08, s)}"/>`).join("");
  if (opts.mono) {
    return `<g>
  <circle cx="${cx}" cy="${cy}" r="${housing}" fill="#fff"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 6 * s}" fill="#000"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="#fff"/>
  <g fill="none" stroke="#000" stroke-width="${stroke}" stroke-linecap="round">${ridges}</g>
</g>`;
  }
  return `<defs>
  <radialGradient id="${id}-cap" cx="0.38" cy="0.32" r="0.85">
    <stop offset="0" stop-color="#E9FF8A"/>
    <stop offset="0.45" stop-color="${VOLT}"/>
    <stop offset="1" stop-color="#B4DE1E"/>
  </radialGradient>
  <linearGradient id="${id}-housing" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#2E2E36"/>
    <stop offset="1" stop-color="#141418"/>
  </linearGradient>
  <linearGradient id="${id}-side" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7E9C0E"/>
    <stop offset="1" stop-color="#4E6305"/>
  </linearGradient>
  <clipPath id="${id}-clip"><circle cx="${cx}" cy="${cy - (11 * R) / 300}" r="${R}"/></clipPath>
</defs>
<g>
  <circle cx="${cx}" cy="${cy}" r="${housing}" fill="url(#${id}-housing)"/>
  <circle cx="${cx}" cy="${cy}" r="${housing - 1.5 * s}" fill="none" stroke="#3A3A44" stroke-width="${3 * s}" stroke-opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="${R + depth / 2 + 8 * s}" fill="#08080A"/>
  <circle cx="${cx}" cy="${cy + depth / 2}" r="${R}" fill="url(#${id}-side)"/>
  <circle cx="${cx}" cy="${cy - depth / 2}" r="${R}" fill="url(#${id}-cap)"/>
  <g clip-path="url(#${id}-clip)" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-opacity="0.94">${ridges}</g>
  <path d="M${cx - R * 0.62} ${cy - depth / 2 - R * 0.62} A${R * 0.88} ${R * 0.88} 0 0 1 ${cx + R * 0.2} ${cy - depth / 2 - R * 0.86}" fill="none" stroke="#FBFFE6" stroke-width="${7 * s}" stroke-linecap="round" stroke-opacity="0.32"/>
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
