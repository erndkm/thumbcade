/**
 * Writes `art/icon.svg`: a 32 × 32 pixel scene, one rect per run of a colour (the build renders it to 1024²).
 * `pnpm --filter @thumbcade-games/pittermoon icon`
 *
 * The cat sits on the lane's edge looking at you, a broom sweeps past behind it, the moon is up, first light is just
 * pinking the bottom of the hill, and pixelwitch's sparkle sits in the corner.
 */
import { writeFileSync } from "node:fs";
import { broomRows, CAT_FRONT, MOON, SPARKLE } from "../src/art.ts";
import { KEY, PAL } from "../src/palette.ts";
import { dither } from "../src/pixel.ts";

const N = 32;
const g: string[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => PAL.ink));
const set = (x: number, y: number, c: string) => {
  if (x >= 0 && y >= 0 && x < N && y < N) g[y]![x] = c;
};
const stamp = (rows: readonly string[], x0: number, y0: number) =>
  rows.forEach((r, j) => [...r].forEach((ch, i) => ch !== "." && KEY[ch] && set(x0 + i, y0 + j, KEY[ch]!)));

// Sky: ink fading into night, a few stars.
for (let y = 0; y < 11; y++) for (let x = 0; x < N; x++) set(x, y, dither(x, y, (y / 11) * 0.7) ? PAL.night : PAL.ink);
for (const [x, y] of [[12, 2], [17, 5], [21, 1], [9, 8], [24, 8], [15, 9]] as const) set(x, y, PAL.cream);
stamp(MOON, 2, 1);
// The broom lane: a dusk band with ink edges and sweep marks.
for (let y = 11; y < 18; y++) for (let x = 0; x < N; x++) set(x, y, y === 11 || y === 17 ? PAL.ink : (y === 13 || y === 15) && (x >> 1) % 2 === 0 ? PAL.mauve : PAL.dusk);
// The broom (flying left), its shadow on the lane.
const broom = broomRows(1).map((r) => [...r].reverse().join(""));
for (let x = 8; x < 26; x += 2) set(x, 16, PAL.ink);
stamp(broom, 3, 9);
// Grass by moonlight.
for (let y = 18; y < N; y++) for (let x = 0; x < N; x++) set(x, y, Math.sin(x * 0.6 + y * 0.9) + Math.sin(x * 0.23 - y * 0.5) * 0.8 > 0.9 ? PAL.teal : PAL.moss);
for (const [x, y] of [[3, 21], [27, 20], [6, 27], [29, 26]] as const) {
  set(x, y, PAL.sage);
  set(x - 1, y - 1, PAL.sage);
  set(x + 1, y - 1, PAL.sage);
}
set(25, 23, PAL.rose);
set(24, 23, PAL.blush);
set(26, 23, PAL.blush);
set(25, 24, PAL.butter);
// First light along the bottom.
for (let y = 28; y < N; y++) for (let x = 0; x < N; x++) if (y === 31 || dither(x, y, (y - 27) * 0.25)) set(x, y, y === 31 ? PAL.blush : PAL.dawn);
// The cat, with its contact shadow.
for (let x = 9; x < 21; x++) set(x, 30, PAL.ink);
stamp(CAT_FRONT, 9, 17);
// The sparkle.
stamp(SPARKLE[0]!, 26, 1);

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="1024" height="1024" shape-rendering="crispEdges">\n`;
for (let y = 0; y < N; y++) {
  let x = 0;
  while (x < N) {
    const c = g[y]![x]!;
    let e = x + 1;
    while (e < N && g[y]![e] === c) e++;
    svg += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${c}"/>\n`;
    x = e;
  }
}
svg += "</svg>\n";
writeFileSync(new URL("../art/icon.svg", import.meta.url), svg);
// A preview map for the contact sheet.
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(g));
console.log("art/icon.svg written");
