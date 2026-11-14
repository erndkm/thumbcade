/**
 * Writes `art/icon.svg`: a 36 × 36 pixel scene, one rect per run of a colour (the build renders it to 1024²).
 * `pnpm --filter @thumbcade-games/scootpurr icon`
 *
 * The witch's long black cat lies awake across the plum hearth rug, a ginger kitten naps below her, a ball of yarn
 * has rolled into the corner, and pixelwitch's sparkle sits in the other.
 */
import { writeFileSync } from "node:fs";
import { catRows, COAT_SWAPS, SPARKLE } from "../src/art.ts";
import { KEY, PAL } from "../src/palette.ts";
import { flipRows, outlineRows } from "../src/pixel.ts";

const N = 36;
const g: string[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => PAL.plum));
const set = (x: number, y: number, c: string) => {
  if (x >= 0 && y >= 0 && x < N && y < N) g[y]![x] = c;
};
const stamp = (rows: readonly string[], x0: number, y0: number, swap: Record<string, string> = {}) =>
  rows.forEach((r, j) =>
    [...r].forEach((ch, i) => {
      const key = swap[ch] ?? ch;
      if (ch !== "." && KEY[key]) set(x0 + i, y0 + j, KEY[key]!);
    }),
  );

// The rug: fringe on the short ends, a rose line inside the edge, woven marks.
for (let x = 0; x < N; x++) {
  for (const y of [0, 1, N - 2, N - 1]) set(x, y, x % 2 ? PAL.cream : PAL.ink);
  set(x, 2, PAL.ink);
  set(x, N - 3, PAL.ink);
  set(x, 4, PAL.rose);
  set(x, N - 5, PAL.rose);
}
for (let y = 4; y < N - 4; y++) {
  set(1, y, PAL.rose);
  set(N - 2, y, PAL.rose);
}
for (let y = 9; y < N - 6; y += 9) {
  for (let x = 5; x < N - 3; x += 9) {
    for (const [dx, dy] of [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2]] as const) set(x + dx, y + dy, PAL.mauve);
  }
}
// The witch's cat, awake, nose to the right.
stamp(outlineRows(catRows(2, "awake"), "k", false), 1, 6, COAT_SWAPS[0]);
// A ginger kitten asleep under her, nose to the left, and what it is dreaming.
stamp(outlineRows(flipRows(catRows(1, "nap")), "k", false), 4, 20, COAT_SWAPS[1]);
for (const [x, y] of [[21, 21], [22, 21], [23, 21], [23, 22], [22, 23], [21, 24], [21, 25], [22, 25], [23, 25]] as const) set(x, y, PAL.cream);
// A ball of yarn in the corner, its end trailing.
for (const [x, y, c] of [
  [28, 26, PAL.ink], [29, 26, PAL.ink], [30, 26, PAL.ink],
  [27, 27, PAL.ink], [28, 27, PAL.rose], [29, 27, PAL.blush], [30, 27, PAL.rose], [31, 27, PAL.ink],
  [27, 28, PAL.ink], [28, 28, PAL.blush], [29, 28, PAL.rose], [30, 28, PAL.rose], [31, 28, PAL.ink],
  [27, 29, PAL.ink], [28, 29, PAL.rose], [29, 29, PAL.rose], [30, 29, PAL.blush], [31, 29, PAL.ink],
  [28, 30, PAL.ink], [29, 30, PAL.ink], [30, 30, PAL.ink],
  [26, 30, PAL.rose], [25, 29, PAL.rose], [24, 30, PAL.rose], [23, 30, PAL.rose],
] as const) set(x, y, c);
// The sparkle.
stamp(SPARKLE[0]!, 29, 1);

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
console.log(`art/icon.svg: ${N} x ${N}`);
