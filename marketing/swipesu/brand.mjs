/**
 * Generates the swipesu logo from code, in the same system as the Thumbcade mark (packages/design-tokens/scripts/build-brand.ts):
 * the same top-down red arcade button (housing, cap, highlight), with a new engraving on the cap.
 *
 * The engraving: a swipe up. One bold chevron, the gesture, and under it a narrower echo of five pixels, the trail it
 * leaves behind. A real swipe turning into a game, which is what the feed is.
 *
 *   node marketing/swipesu/brand.mjs        -> marketing/swipesu/brand/
 *
 * Outputs (brand/):
 *   mark.svg                 the button alone, transparent background
 *   app-icon.svg / .png      1024 app icon (ink background, full bleed)
 *   favicon.svg / favicon-*.png
 *   wordmark.svg             "swipesu" in Mona Sans Display Expanded Black, as paths (paper)
 *   wordmark-ink.svg         the same in ink, for light backgrounds
 *   lockup.svg / .png        mark + wordmark
 *   logo-sheet.png           overview of all of the above
 *   brand.json               what the video compositors need (`render.mjs --brand swipesu`)
 *
 * Only marketing uses this so far. The product brand in packages/design-tokens/brand is still Thumbcade.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const TOKENS = resolve(REPO, "packages/design-tokens");
// sharp and opentype.js come from the design-tokens package, so this script needs no install of its own.
const require = createRequire(resolve(TOKENS, "package.json"));
const sharp = require("sharp");
const opentype = require("opentype.js");
const { palette, pixelAvatarSvg } = await import(resolve(TOKENS, "src/index.ts"));

const NAME = "swipesu";
const out = resolve(HERE, "brand");
mkdirSync(out, { recursive: true });

const INK = palette.ink1;
const CAP = palette.heat;

/** Mixes a hex color toward white (amount > 0) or black (amount < 0). */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return `#${[16, 8, 0]
    .map((bits) => (n >> bits) & 255)
    .map((v) => Math.round(v + (target - v) * t).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

const f = (v) => +v.toFixed(2);

// ---------------------------------------------------------------------------
// Engraving geometry, authored for a cap radius of 300 around the print center
// ---------------------------------------------------------------------------

/** Grid cell: one echo pixel. */
const CELL = 50;
/** The chevron: apex CHEV_APEX cells above the print center, arms CHEV_ARM cells out and down at 45 degrees. */
const CHEV_APEX = -3.2;
const CHEV_ARM = 3;
const CHEV_STROKE = 70;
/** The echo: the same 45-degree chevron as pixels, apex ECHO_APEX cells below the print center, ECHO_ARM cells per arm. */
const ECHO_APEX = 0.6;
const ECHO_ARM = 2;
/** The whole engraving sits this far below the print center, so the pair reads optically centered on the cap. */
const DROP = 4;

/** Echo pixels as [x, y, size], top-left corner relative to the print center. */
const ECHO = Array.from({ length: 2 * ECHO_ARM + 1 }, (_, k) => k - ECHO_ARM).map((i) => [(i - 0.5) * CELL, (ECHO_APEX + Math.abs(i) - 0.5) * CELL + DROP, CELL]);

/** The engraving around print center (cx, cy) at scale s, in `color`. */
function engraving(cx, cy, s, color) {
  const ay = cy + (CHEV_APEX * CELL + DROP) * s;
  const arm = CHEV_ARM * CELL * s;
  const chevron = `<path d="M${f(cx - arm)} ${f(ay + arm)}L${f(cx)} ${f(ay)}L${f(cx + arm)} ${f(ay + arm)}" fill="none" stroke="${color}" stroke-width="${f(CHEV_STROKE * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const pixels = ECHO.map(([x, y, size]) => `M${f(cx + x * s)} ${f(cy + y * s)}h${f(size * s)}v${f(size * s)}h${f(-size * s)}z`).join("");
  return `${chevron}<path d="${pixels}" fill="${color}"/>`;
}

/**
 * Where the trailer's opening camera dives into the cap (y in the 1024 mark space, cap at 512, 501):
 * the center of the largest clear circle between the chevron's inner corner and the echo's top pixel,
 * so the dive passes between the gesture and its trail and ends in clean red.
 */
function diveY() {
  const printY = 495;
  const inner = printY + CHEV_APEX * CELL + DROP + (CHEV_STROKE / 2) * Math.SQRT2;
  const echoTop = printY + ECHO[ECHO_ARM][1];
  // Equal distance to the 45-degree inner edges and to the echo's top edge.
  return f((echoTop * Math.SQRT2 + inner) / (1 + Math.SQRT2));
}

/** The button mark centered at (cx, cy) with cap radius R. Same chrome as the Thumbcade mark. */
/** `mono` draws it in two flat colors instead ({ fg, bg }), for one-color use. */
function markGroup(cx, cy, R, { idPrefix = "m", mono } = {}) {
  const id = idPrefix;
  const s = R / 300;
  const housing = R + 44 * s;
  const depth = 22 * s;
  const capY = cy - depth / 2;
  const printY = capY - 6 * s;
  if (mono) {
    return `<g>
  <circle cx="${cx}" cy="${cy}" r="${housing}" fill="${mono.fg}"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 6 * s}" fill="${mono.bg}"/>
  <circle cx="${cx}" cy="${cy}" r="${R}" fill="${mono.fg}"/>
  ${engraving(cx, printY, s, mono.bg)}
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
  <g clip-path="url(#${id}-clip)" opacity="0.94">${engraving(cx, printY, s, INK)}</g>
  <path d="M${cx - R * 0.62} ${capY - R * 0.62} A${R * 0.88} ${R * 0.88} 0 0 1 ${cx + R * 0.2} ${capY - R * 0.86}" fill="none" stroke="${shade(CAP, 0.9)}" stroke-width="${7 * s}" stroke-linecap="round" stroke-opacity="0.32"/>
</g>`;
}

const svg = (w, h, body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ""}${body}</svg>\n`;

// ---------------------------------------------------------------------------
// Wordmark (text -> paths), set exactly like the Thumbcade wordmark
// ---------------------------------------------------------------------------

function wordmarkPath(text, size, x, baseline, tracking = -0.02, fontFile = "MonaSansDisplayExpanded-Black.ttf") {
  const buf = readFileSync(resolve(TOKENS, "fonts/native", fontFile));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(text);
  const parts = [];
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

async function png(svgText, file, size, density = 300) {
  let img = sharp(Buffer.from(svgText), { density });
  if (size) img = img.resize(size.w, size.h);
  await img.png({ compressionLevel: 9 }).toFile(resolve(out, file));
}

const S = 1024;
const C = S / 2;

const mark = svg(S, S, markGroup(C, C, 300));
writeFileSync(resolve(out, "mark.svg"), mark);

const appIcon = svg(S, S, markGroup(C, C, 312), INK);
writeFileSync(resolve(out, "app-icon.svg"), appIcon);
await png(appIcon, "app-icon.png");

const fav = svg(64, 64, markGroup(32, 32, 19, { idPrefix: "f" }), INK);
writeFileSync(resolve(out, "favicon.svg"), fav);
for (const px of [32, 180, 512]) await png(svg(S, S, markGroup(C, C, 300), INK), `favicon-${px}.png`, { w: px, h: px });

const wm = wordmarkPath(NAME, 120, 0, 120);
const wmW = Math.ceil(wm.width) + 4;
const wordmark = svg(wmW, 150, `<path d="${wm.d}" fill="${palette.paper}"/>`);
writeFileSync(resolve(out, "wordmark.svg"), wordmark);
writeFileSync(resolve(out, "wordmark-ink.svg"), svg(wmW, 150, `<path d="${wm.d}" fill="${INK}"/>`));

const lockH = 200;
const lockMark = markGroup(100, 100, 74, { idPrefix: "l" });
const lw = wordmarkPath(NAME, 92, 220, 132);
const lockW = Math.ceil(220 + lw.width + 8);
writeFileSync(resolve(out, "lockup.svg"), svg(lockW, lockH, `${lockMark}<path d="${lw.d}" fill="${palette.paper}"/>`));
await png(svg(lockW, lockH, `${lockMark}<path d="${lw.d}" fill="${palette.paper}"/>`, INK), "lockup.png", undefined, 216);

// Overview sheet: the mark large, on paper and in mono, the app icon, small sizes, the lockups.
{
  const W = 2400, H = 1500;
  // Rendered at 72 dpi, so one unit is one pixel and these are the marks' real diameters.
  const tiny = [96, 64, 48, 32, 24].map((d, i, a) => {
    const x = 1100 + a.slice(0, i).reduce((sum, v) => sum + v + 64, 0) + d / 2;
    return markGroup(x, 880, (d / 2) * (300 / 344), { idPrefix: `t${i}` });
  });
  const label = (text, x, y, color = palette.paperMute) => `<path d="${wordmarkPath(text, 22, x, y, 0.04, "DepartureMono-Regular.otf").d}" fill="${color}"/>`;
  const sheet = svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="#000000"/>
    ${markGroup(560, 560, 330, { idPrefix: "a" })}
    ${label("MARK", 120, 1010)}
    <rect x="1100" y="120" width="560" height="560" rx="124" fill="${INK}"/>
    <g transform="translate(1100 120) scale(${560 / 1024})">${markGroup(C, C, 312, { idPrefix: "b" })}</g>
    ${label("APP ICON", 1100, 730)}
    <rect x="1760" y="120" width="560" height="560" fill="${palette.paper}"/>
    <g transform="translate(1760 120) scale(${560 / 1024})">${markGroup(C, C, 300, { mono: { fg: INK, bg: palette.paper } })}</g>
    ${label("ONE COLOR", 1760, 730)}
    ${tiny.join("")}
    ${label("96 · 64 · 48 · 32 · 24 PX", 1100, 1010)}
    <g transform="translate(120 1120)">${markGroup(100, 100, 74, { idPrefix: "d" })}<path d="${lw.d}" fill="${palette.paper}"/></g>
    <rect x="1220" y="1080" width="1100" height="300" fill="${palette.paper}"/>
    <g transform="translate(1300 1130)">${markGroup(100, 100, 74, { idPrefix: "e" })}<path d="${lw.d}" fill="${INK}"/></g>
    ${label("SWIPE UP FOR THE NEXT GAME", 120, 1440, palette.paperDim)}`,
  );
  await png(sheet, "logo-sheet.png", undefined, 72);
}

// What the compositors need: names, the cap engraving in the 1024 mark space, the dive point, the wordmark, the avatar.
const brand = {
  name: NAME,
  site: `${NAME}.com`,
  engraving: `<g clip-path="url(#m-clip)" opacity="0.94">${engraving(C, 495, 1, INK)}</g>`,
  dive: diveY(),
  wordmark: `data:image/svg+xml;base64,${Buffer.from(wordmark).toString("base64")}`,
  wordmarkWidth: wmW,
  avatar: pixelAvatarSvg(NAME, 64),
};
writeFileSync(resolve(out, "brand.json"), `${JSON.stringify(brand, null, 2)}\n`);
console.log(`swipesu brand written to ${out} (dive y ${brand.dive})`);
