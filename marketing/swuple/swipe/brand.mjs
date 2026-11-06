/**
 * Generates the swuple swipe logo: the app icon is a screen, and a swipe up crosses all of it, coming in below the
 * bottom edge and leaving through the top. It bends in a gentle S, the name's first letter, and fades in from
 * nothing to solid heat on its way up, so the motion reads in a still. Ink, heat, paper, like the button logo.
 * Geometry: ../swipe-geometry.mjs (LOGO). The wordmark is the plain swuple wordmark, set like Thumbcade's.
 *
 *   node marketing/swuple/swipe/brand.mjs   -> marketing/swuple/swipe/brand/
 *
 * Outputs (brand/):
 *   icon.svg                 the mark: the icon with its rounded corners, transparent outside them
 *   app-icon.svg / .png      1024 square, full bleed, for the stores (they apply their own corner mask)
 *   favicon.svg / favicon-*.png
 *   wordmark.svg             "swuple" in Mona Sans Display Expanded Black, as paths (paper)
 *   wordmark-ink.svg         the same in ink, for light backgrounds
 *   lockup.svg / .png        icon + wordmark
 *   logo-sheet.png           overview of all of the above
 *   brand.json               what the video compositors need (`render.mjs --brand swuple/swipe`)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGO, bezier, centerline, stroke, tAtY } from "../swipe-geometry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = resolve(HERE, "../../../packages/design-tokens");
// sharp and opentype.js come from the design-tokens package, so this script needs no install of its own.
const require = createRequire(resolve(TOKENS, "package.json"));
const sharp = require("sharp");
const opentype = require("opentype.js");
const { palette, pixelAvatarSvg } = await import(resolve(TOKENS, "src/index.ts"));

const NAME = "swuple";
const out = resolve(HERE, "brand");
mkdirSync(out, { recursive: true });

const INK = palette.ink1;
const HEAT = palette.heat;
const f = (v) => +v.toFixed(2);
const lerp = (a, b, k) => a + (b - a) * k;

/** Corner radius of the icon in the 1024 box, the iOS proportion. */
const RADIUS = f(1024 * 0.2237);
const SWIPE = stroke(LOGO.path, LOGO.w0, LOGO.w1);

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

/**
 * The icon artwork in the 1024 box. `rounded` clips to the icon's corners (the mark); without it the square is full
 * bleed (the store icon). `mono` draws it in one flat color: the icon in `mono`, the swipe cut out of it.
 */
function iconArt({ id = "i", rounded = true, mono } = {}) {
  const shape = `<rect width="1024" height="1024"${rounded ? ` rx="${RADIUS}"` : ""}`;
  if (mono) {
    return `<defs><mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">${shape} fill="#fff"/><path d="${SWIPE}" fill="#000"/></mask></defs>
      ${shape} fill="${mono}" mask="url(#${id}-cut)"/>`;
  }
  const stops = LOGO.ramp.map(([y, o]) => `<stop offset="${f((1024 - y) / 1024)}" stop-color="${HEAT}" stop-opacity="${o}"/>`).join("");
  return `<defs><linearGradient id="${id}-ramp" gradientUnits="userSpaceOnUse" x1="0" y1="1024" x2="0" y2="0">${stops}</linearGradient>
      <clipPath id="${id}-clip">${shape}/></clipPath></defs>
    <g clip-path="url(#${id}-clip)">${shape} fill="${INK}"/><path d="${SWIPE}" fill="url(#${id}-ramp)"/></g>`;
}

/** 1024-box artwork placed at (x, y), `size` wide. */
const place = (art, x, y, size) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(size / 1024)})">${art}</g>`;

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

writeFileSync(resolve(out, "icon.svg"), svg(S, S, iconArt()));

const appIcon = svg(S, S, iconArt({ rounded: false }));
writeFileSync(resolve(out, "app-icon.svg"), appIcon);
await png(appIcon, "app-icon.png");

writeFileSync(resolve(out, "favicon.svg"), svg(64, 64, place(iconArt({ id: "f" }), 0, 0, 64)));
for (const px of [32, 180, 512]) await png(svg(S, S, iconArt()), `favicon-${px}.png`, { w: px, h: px });

const wm = wordmarkPath(NAME, 120, 0, 120);
const wmW = Math.ceil(wm.width) + 4;
const wordmark = svg(wmW, 150, `<path d="${wm.d}" fill="${palette.paper}"/>`);
writeFileSync(resolve(out, "wordmark.svg"), wordmark);
writeFileSync(resolve(out, "wordmark-ink.svg"), svg(wmW, 150, `<path d="${wm.d}" fill="${INK}"/>`));

// Lockup: the icon at the height of the button lockup's mark, the wordmark at the same size and baseline.
const lockH = 200;
const lw = wordmarkPath(NAME, 92, 220, 132);
const lockW = Math.ceil(220 + lw.width + 8);
const lockIcon = (id) => place(iconArt({ id }), 18, 18, 164);
writeFileSync(resolve(out, "lockup.svg"), svg(lockW, lockH, `${lockIcon("l")}<path d="${lw.d}" fill="${palette.paper}"/>`));
await png(svg(lockW, lockH, `${lockIcon("l")}<path d="${lw.d}" fill="${palette.paper}"/>`, palette.ink0), "lockup.png", undefined, 216);

// Overview sheet: the icon large, the store square, one color, small sizes, the lockups.
{
  const W = 2400, H = 1500;
  // Rendered at 72 dpi, so one unit is one pixel and these are the icons' real sizes.
  const tiny = [96, 64, 48, 32, 24].map((d, i, a) => place(iconArt({ id: `t${i}` }), 1100 + a.slice(0, i).reduce((sum, v) => sum + v + 64, 0), 880 - d / 2, d)).join("");
  const label = (text, x, y, color = palette.paperMute) => `<path d="${wordmarkPath(text, 22, x, y, 0.04, "DepartureMono-Regular.otf").d}" fill="${color}"/>`;
  const sheet = svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="#000000"/>
    ${place(iconArt({ id: "a" }), 230, 120, 660)}
    ${label("ICON", 120, 1010)}
    ${place(iconArt({ id: "b", rounded: false }), 1100, 120, 560)}
    ${label("STORE ICON, FULL BLEED", 1100, 730)}
    <rect x="1760" y="120" width="560" height="560" fill="${palette.paper}"/>
    ${place(iconArt({ id: "c", mono: INK }), 1840, 200, 400)}
    ${label("ONE COLOR", 1760, 730)}
    ${tiny}
    ${label("96 · 64 · 48 · 32 · 24 PX", 1100, 1010)}
    <g transform="translate(120 1120)">${lockIcon("d")}<path d="${lw.d}" fill="${palette.paper}"/></g>
    <rect x="1220" y="1080" width="1100" height="300" fill="${palette.paper}"/>
    <g transform="translate(1300 1130)">${lockIcon("e")}<path d="${lw.d}" fill="${INK}"/></g>
    ${label("SWIPE UP FOR THE NEXT GAME", 120, 1440, palette.paperDim)}`,
  );
  await png(sheet, "logo-sheet.png", undefined, 72);
}

// What the compositors need (`render.mjs --brand swuple/swipe`): names, wordmark, avatar, and instead of a button
// engraving, the icon itself. The videos draw the swipe on along its centerline, dive into it where it is solid,
// and land the end card's LIVE dot where it enters the icon.
const entryT = tAtY(LOGO.path, 1024);
const diveT = tAtY(LOGO.path, 230);
const brand = {
  name: NAME,
  site: `${NAME}.com`,
  wordmark: `data:image/svg+xml;base64,${Buffer.from(wordmark).toString("base64")}`,
  wordmarkWidth: wmW,
  avatar: pixelAvatarSvg(NAME, 64),
  icon: {
    bg: INK,
    color: HEAT,
    radius: RADIUS,
    swipe: SWIPE,
    ramp: LOGO.ramp,
    centerline: centerline(LOGO.path),
    reveal: Math.max(LOGO.w0, LOGO.w1) + 40,
    dive: bezier(LOGO.path, diveT).map(f),
    entry: [f(bezier(LOGO.path, entryT)[0]), f(lerp(LOGO.w0, LOGO.w1, entryT))],
  },
};
writeFileSync(resolve(out, "brand.json"), `${JSON.stringify(brand, null, 2)}\n`);
console.log(`swuple swipe brand written to ${out} (dive ${brand.icon.dive.join(", ")}, entry x ${brand.icon.entry[0]})`);
