import { KEY } from "./palette.ts";
import { outlineRows, sprite } from "./pixel.ts";

/**
 * Two hand-drawn bitmap fonts, no font files (copied from Frostwhisk; the chunky face gained j, q, the digits and an
 * apostrophe for Pittermoon's signs and row banners):
 * - "crumb": a tiny proportional lowercase face, x-height 5, ascenders 7, descenders 2.
 * - "chunky": two-pixel strokes for titles on wooden signs.
 */

// prettier-ignore
const CRUMB: Record<string, string[]> = {
  a: ["", "", ".##.", "...#", ".###", "#..#", ".###"],
  b: ["#...", "#...", "###.", "#..#", "#..#", "#..#", "###."],
  c: ["", "", ".###", "#...", "#...", "#...", ".###"],
  d: ["...#", "...#", ".###", "#..#", "#..#", "#..#", ".###"],
  e: ["", "", ".##.", "#..#", "####", "#...", ".###"],
  f: [".##", "#..", "###", "#..", "#..", "#..", "#.."],
  g: ["", "", ".###", "#..#", "#..#", "#..#", ".###", "...#", ".##."],
  h: ["#...", "#...", "###.", "#..#", "#..#", "#..#", "#..#"],
  i: ["#", "", "#", "#", "#", "#", "#"],
  j: [".#", "", ".#", ".#", ".#", ".#", ".#", ".#", "#."],
  k: ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
  l: ["#.", "#.", "#.", "#.", "#.", "#.", ".#"],
  m: ["", "", "####.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  n: ["", "", "###.", "#..#", "#..#", "#..#", "#..#"],
  o: ["", "", ".##.", "#..#", "#..#", "#..#", ".##."],
  p: ["", "", "###.", "#..#", "#..#", "#..#", "###.", "#...", "#..."],
  q: ["", "", ".###", "#..#", "#..#", "#..#", ".###", "...#", "...#"],
  r: ["", "", "#.##", "##..", "#...", "#...", "#..."],
  s: ["", "", ".###", "#...", ".##.", "...#", "###."],
  t: [".#.", ".#.", "###", ".#.", ".#.", ".#.", "..#"],
  u: ["", "", "#..#", "#..#", "#..#", "#..#", ".###"],
  v: ["", "", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
  w: ["", "", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  x: ["", "", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: ["", "", "#..#", "#..#", "#..#", "#..#", ".###", "...#", ".##."],
  z: ["", "", "####", "...#", ".##.", "#...", "####"],
  "0": [".##.", "#..#", "#..#", "#..#", "#..#", "#..#", ".##."],
  "1": [".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###"],
  "2": [".##.", "#..#", "...#", "..#.", ".#..", "#...", "####"],
  "3": ["###.", "...#", "...#", ".##.", "...#", "...#", "###."],
  "4": ["#..#", "#..#", "#..#", "####", "...#", "...#", "...#"],
  "5": ["####", "#...", "###.", "...#", "...#", "#..#", ".##."],
  "6": [".##.", "#...", "#...", "###.", "#..#", "#..#", ".##."],
  "7": ["####", "...#", "...#", "..#.", "..#.", ".#..", ".#.."],
  "8": [".##.", "#..#", "#..#", ".##.", "#..#", "#..#", ".##."],
  "9": [".##.", "#..#", "#..#", ".###", "...#", "...#", ".##."],
  ".": ["", "", "", "", "", "", "#"],
  ",": ["", "", "", "", "", "", ".#", "#."],
  "!": ["#", "#", "#", "#", "#", "", "#"],
  "?": [".##.", "#..#", "...#", "..#.", ".#..", "", ".#.."],
  ":": ["", "", "", "#", "", "", "#"],
  "'": ["#", "#"],
  "-": ["", "", "", "", "###"],
  "+": ["", "", "", ".#.", "###", ".#."],
  "/": ["..#", "..#", ".#.", ".#.", ".#.", "#..", "#.."],
  "~": ["", "", "", ".#...", "#.#.#", "...#."],
  "(": [".#", "#.", "#.", "#.", "#.", "#.", ".#"],
  ")": ["#.", ".#", ".#", ".#", ".#", ".#", "#."],
  "♥": ["", ".#.#.", "#####", "#####", ".###.", "..#..", ""],
  "*": ["", "", ".#.", "###", ".#."],
  " ": ["..."],
  "%": ["", "#..#", "...#", "..#.", ".#..", "#...", "#..#"],
  "·": ["", "", "", "", "#"],
};

export const CRUMB_H = 9;
export const CRUMB_LINE = 10;

const glyph = (ch: string): string[] => CRUMB[ch] ?? CRUMB[ch.toLowerCase()] ?? CRUMB["?"]!;
const glyphW = (g: string[]) => g.reduce((m, r) => Math.max(m, r.length), 0);

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += glyphW(glyph(ch)) + 1;
  return Math.max(0, w - 1);
}

/** Text as sprite rows (`fill` key), so it can be outlined like any other sprite. */
function textRows(s: string, key: string): string[] {
  const rows: string[] = Array.from({ length: CRUMB_H }, () => "");
  let first = true;
  for (const ch of s) {
    const g = glyph(ch);
    const w = glyphW(g);
    for (let y = 0; y < CRUMB_H; y++) {
      const src = g[y] ?? "";
      rows[y] += (first ? "" : ".") + [...src.padEnd(w, ".")].map((c) => (c === "#" ? key : ".")).join("");
    }
    first = false;
  }
  return rows;
}

const keyOf = (hex: string): string => Object.keys(KEY).find((k) => KEY[k] === hex) ?? "c";

const cache = new Map<string, HTMLCanvasElement>();

/**
 * A text sprite in palette colors (hex values from PAL). `outline` wraps it in a one-pixel border,
 * `shadow` drops a one-pixel shadow down-right. Cached; strings that change every frame stay cheap.
 */
export function textSprite(s: string, color: string, o: { outline?: string; shadow?: string } = {}): HTMLCanvasElement {
  const id = `${s}|${color}|${o.outline ?? ""}|${o.shadow ?? ""}`;
  let c = cache.get(id);
  if (c) return c;
  let rows = textRows(s, keyOf(color));
  if (o.outline) rows = outlineRows(rows, keyOf(o.outline), true);
  if (o.shadow) rows = dropShadow(rows, keyOf(o.shadow));
  c = sprite(rows);
  if (cache.size > 160) cache.clear();
  cache.set(id, c);
  return c;
}

/** Draws crumb text. `x` is the left edge, or the center / right edge with `align`. `y` is the top of the ascenders. */
export function drawText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  o: { align?: "left" | "center" | "right"; outline?: string; shadow?: string } = {},
): void {
  const img = textSprite(s, color, o);
  const pad = o.outline ? 1 : 0;
  const w = textWidth(s);
  const left = o.align === "center" ? Math.round(x - w / 2) : o.align === "right" ? Math.round(x - w) : Math.round(x);
  ctx.drawImage(img, left - pad, Math.round(y) - pad);
}

function dropShadow(rows: string[], key: string): string[] {
  const h = rows.length + 1;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0) + 1;
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const self = rows[y]?.[x];
      if (self && self !== ".") line += self;
      else {
        const sh = rows[y - 1]?.[x - 1];
        line += sh && sh !== "." ? key : ".";
      }
    }
    out.push(line);
  }
  return out;
}

// prettier-ignore
const CHUNKY: Record<string, string[]> = {
  a: ["", "", "", ".####.", "....##", ".#####", "##..##", "##..##", "##..##", ".#####"],
  b: ["##....", "##....", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", "##..##", "#####."],
  e: ["", "", "", ".####.", "##..##", "##..##", "######", "##....", "##....", ".#####"],
  g: ["", "", "", ".#####", "##..##", "##..##", "##..##", "##..##", "##..##", ".#####", "....##", "....##", ".####."],
  h: ["##....", "##....", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##"],
  i: ["##", "##", "", "##", "##", "##", "##", "##", "##", "##"],
  l: ["##.", "##.", "##.", "##.", "##.", "##.", "##.", "##.", "##.", ".##"],
  o: ["", "", "", ".####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  r: ["", "", "", "##.###", "####..", "###...", "##....", "##....", "##....", "##...."],
  s: ["", "", "", ".#####", "##....", "##....", ".####.", "....##", "....##", "#####."],
  t: [".##..", ".##..", ".##..", "#####", ".##..", ".##..", ".##..", ".##..", ".##..", "..###"],
  u: ["", "", "", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".#####"],
  c: ["", "", "", ".#####", "##....", "##....", "##....", "##....", "##....", ".#####"],
  d: ["....##", "....##", "....##", ".#####", "##..##", "##..##", "##..##", "##..##", "##..##", ".#####"],
  f: ["..###", ".##..", ".##..", "####.", ".##..", ".##..", ".##..", ".##..", ".##..", ".##.."],
  k: ["##....", "##....", "##....", "##..##", "##.##.", "####..", "###...", "####..", "##.##.", "##..##"],
  m: ["", "", "", "#######.", "##.##.##", "##.##.##", "##.##.##", "##.##.##", "##.##.##", "##.##.##"],
  n: ["", "", "", "#####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##"],
  p: ["", "", "", "#####.", "##..##", "##..##", "##..##", "##..##", "##..##", "#####.", "##....", "##....", "##...."],
  v: ["", "", "", "##..##", "##..##", "##..##", "##..##", "##..##", ".####.", "..##.."],
  w: ["", "", "", "##....##", "##....##", "##.##.##", "##.##.##", "##.##.##", "##.##.##", ".##..##."],
  x: ["", "", "", "##..##", "##..##", ".####.", "..##..", ".####.", "##..##", "##..##"],
  y: ["", "", "", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".#####", "....##", "....##", ".####."],
  z: ["", "", "", "######", "....##", "...##.", "..##..", ".##...", "##....", "######"],
  "!": ["##", "##", "##", "##", "##", "##", "##", "", "##", "##"],
  " ": ["...."],
  j: ["...##", "...##", "", "...##", "...##", "...##", "...##", "...##", "...##", "...##", "...##", "...##", "####."],
  q: ["", "", "", ".#####", "##..##", "##..##", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "....##"],
  "'": ["##", "##", ".#"],
  "-": ["", "", "", "", "", "####", "####"],
  "0": [".####.", "##..##", "##..##", "##.###", "###.##", "##..##", "##..##", "##..##", "##..##", ".####."],
  "1": ["..##..", ".###..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
  "2": [".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "##....", "######"],
  "3": [".####.", "##..##", "....##", "....##", "..###.", "....##", "....##", "....##", "##..##", ".####."],
  "4": ["##..##", "##..##", "##..##", "##..##", "######", "....##", "....##", "....##", "....##", "....##"],
  "5": ["######", "##....", "##....", "#####.", "....##", "....##", "....##", "....##", "##..##", ".####."],
  "6": [".####.", "##....", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  "7": ["######", "....##", "....##", "...##.", "...##.", "..##..", "..##..", "..##..", "..##..", "..##.."],
  "8": [".####.", "##..##", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
  "9": [".####.", "##..##", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "....##", ".####."],
};

/** Width (art px, outline and shadow excluded) of a chunky title. */
export function chunkyWidth(s: string, gap = 2): number {
  let w = 0;
  let first = true;
  for (const ch of s) {
    const g = CHUNKY[ch] ?? CHUNKY.o!;
    w += (first ? 0 : gap) + g.reduce((m, r) => Math.max(m, r.length), 0);
    first = false;
  }
  return w;
}

/** True when every character of `s` has a chunky glyph. */
export const chunkyCovers = (s: string): boolean => [...s].every((ch) => CHUNKY[ch] !== undefined);

/**
 * Sign lettering: chunky glyphs with a lit top edge, a darker underside, a one-pixel ink outline and a
 * drop shadow. Keys are palette letters.
 */
export function chunkyTitle(s: string, keys: { fill: string; light: string; dark: string; outline?: string; shadow?: string; gap?: number }): HTMLCanvasElement {
  const H = 13;
  const mask: string[] = Array.from({ length: H }, () => "");
  let first = true;
  for (const ch of s) {
    const g = CHUNKY[ch] ?? CHUNKY.o!;
    const w = g.reduce((m, r) => Math.max(m, r.length), 0);
    for (let y = 0; y < H; y++) mask[y] += (first ? "" : ".".repeat(keys.gap ?? 2)) + (g[y] ?? "").padEnd(w, ".");
    first = false;
  }
  // Drop descender rows nobody uses.
  while (mask.length > 10 && !mask[mask.length - 1]!.includes("#")) mask.pop();
  const on = (x: number, y: number) => mask[y]?.[x] === "#";
  const rows = mask.map((r, y) =>
    [...r]
      .map((c, x) => {
        if (c !== "#") return ".";
        if (!on(x, y - 1)) return keys.light;
        if (!on(x, y + 1) || !on(x + 1, y + 1)) return keys.dark;
        return keys.fill;
      })
      .join(""),
  );
  let out = outlineRows(rows, keys.outline ?? "k", true);
  if (keys.shadow) out = dropShadow(dropShadow(out, keys.shadow), keys.shadow);
  return sprite(out);
}
