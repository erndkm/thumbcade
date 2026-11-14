/**
 * Scootpurr's sprites: long cats seen from above, the hearth rug they nap on, a yarn basket, the candle.
 * Hand-placed pixel maps in pixelwitch's palette; a cat is a tail, as much middle as it is long, and a head.
 */
import { KEY, PAL } from "./palette.ts";
import { dither, flipRows, outlineRows, Painter, rotRows, sprite } from "./pixel.ts";
import type { Dir } from "./board.ts";
import { CELL } from "./layout.ts";

/** A cat's body is this tall (ears included) and stops this short of its squares' ends. */
const CAT_H = 13;
const INSET = 2;

export type Pose = "nap" | "awake" | "grump" | "scootA" | "scootB";

// Sprite-map letters for a cat: B coat, D stripes and tail, L muzzle and paws, P ears and nose, E eye, K pupil,
// C a closed eye, R the collar, Y its bell. Each coat swaps them for palette keys.

/** The head, nose to the right (10 × 13). */
// prettier-ignore
const HEAD: Record<"nap" | "awake" | "grump", string[]> = {
  nap: [
    "...B......",
    "..BPB.....",
    "RBBPBBBB..",
    "RBBBBBBBB.",
    "RBBBBBCBB.",
    "RBBBBBCBL.",
    "YBBBBBBLLP",
    "RBBBBBCBL.",
    "RBBBBBCBB.",
    "RBBBBBBBB.",
    "RBBPBBBB..",
    "..BPB.....",
    "...B......",
  ],
  awake: [
    "...B......",
    "..BPB.....",
    "RBBPBBBB..",
    "RBBBBBBBB.",
    "RBBBBEKBB.",
    "RBBBBEEBL.",
    "YBBBBBBLLP",
    "RBBBBEEBL.",
    "RBBBBEKBB.",
    "RBBBBBBBB.",
    "RBBPBBBB..",
    "..BPB.....",
    "...B......",
  ],
  grump: [
    "..........",
    ".BBB......",
    "RBBBBBBB..",
    "RBBBBBBBB.",
    "RBBBBKBBB.",
    "RBBBBBKBL.",
    "YBBBBBBLLP",
    "RBBBBBKBL.",
    "RBBBBKBBB.",
    "RBBBBBBBB.",
    "RBBBBBBB..",
    ".BBB......",
    "..........",
  ],
};

/** The rump, with the tail tucked along one flank (6 × 13). */
// prettier-ignore
const RUMP = [
  "......",
  "......",
  "...BBB",
  ".BBBBB",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
  "BBBBBB",
  ".BBBBB",
  "..DBBB",
  "..DDDD",
  "......",
];

/** A kitten's rump: all there is behind its head (4 × 13). */
// prettier-ignore
const KITTEN_RUMP = [
  "....",
  "....",
  "..BB",
  ".BBB",
  "BBBB",
  "BBBB",
  "BBBB",
  "BBBB",
  "BBBB",
  ".BBB",
  ".DBB",
  ".DD.",
  "....",
];

/** One column of the middle: `stripe` puts a flank stripe on it, `tail` how much tail still runs along it. */
function midColumn(stripe: boolean, tail: "" | "D" | "L"): string {
  let col = "..";
  for (let y = 2; y <= 10; y++) col += stripe && (y <= 4 || y >= 8) ? "D" : "B";
  return `${col}${tail || "."}.`;
}

/** A cat as sprite rows, nose to the right. Scooting stretches a front paw out ahead, one then the other. */
export function catRows(len: number, pose: Pose): string[] {
  const head = HEAD[pose === "scootA" || pose === "scootB" ? "awake" : pose].map((r) => r);
  const mid = len * CELL - INSET * 2 - 10 - (len === 1 ? 4 : 6);
  const rows: string[] = [];
  for (let y = 0; y < CAT_H; y++) {
    let line = len === 1 ? KITTEN_RUMP[y]! : RUMP[y]!;
    for (let x = 0; x < mid; x++) line += midColumn(x % 6 === 2 || x % 6 === 3, x < 4 ? "D" : x === 4 ? "L" : "")[y]!;
    rows.push(line + head[y]!);
  }
  if (pose === "scootA" || pose === "scootB") {
    const y = pose === "scootA" ? 3 : 9;
    const w = rows[y]!.length;
    rows[y] = `${rows[y]!.slice(0, w - 2)}LL`;
  }
  return rows;
}

/** The coats: the witch's black cat (rose collar, a bell) first, then ginger, cream, silver and peach. */
export const COAT_SWAPS: ReadonlyArray<Record<string, string>> = [
  { B: "n", D: "d", L: "v", P: "r", E: "y", K: "k", C: "v", R: "r", Y: "y" },
  { B: "o", D: "e", L: "c", P: "r", E: "c", K: "k", C: "k", R: "o", Y: "o" },
  { B: "c", D: "y", L: "c", P: "r", E: "g", K: "k", C: "k", R: "c", Y: "c" },
  { B: "f", D: "g", L: "c", P: "r", E: "t", K: "k", C: "k", R: "f", Y: "f" },
  { B: "b", D: "r", L: "c", P: "e", E: "t", K: "k", C: "k", R: "b", Y: "b" },
];

const cache = new Map<string, HTMLCanvasElement>();

/** A cat sprite (outlined), facing `dir`. Cached. */
export function catSprite(len: number, coat: number, dir: Dir, pose: Pose): HTMLCanvasElement {
  const id = `${len}|${coat}|${dir}|${pose}`;
  let c = cache.get(id);
  if (c) return c;
  let rows = catRows(len, pose);
  if (dir === 2 || dir === 3) rows = flipRows(rows);
  if (dir === 1 || dir === 3) rows = rotRows(rows);
  c = sprite(outlineRows(rows, "k", false), COAT_SWAPS[coat % COAT_SWAPS.length]!);
  cache.set(id, c);
  return c;
}

/** A yarn basket seen from above (14 × 13). */
// prettier-ignore
export const BASKET_ROWS = [
  "....wwwwww....",
  "..wwowowowww..",
  ".wownnnnnnwow.",
  ".wwnnrrrrnnww.",
  "wonnrrbrrrnnow",
  "wwnrrbrrrrrnww",
  "wonrbrrrrrrnow",
  "wwnrrrrrrbrnww",
  "wonnrrrrbrnnow",
  ".wwnnrrrrnnww.",
  ".wownnnnnnwow.",
  "..wwowowowww..",
  "....wwwwww....",
];

/** The candle's flame, two frames (5 × 7), and a guttering one for the last seconds. */
// prettier-ignore
export const FLAME = [
  ["..y..", ".yy..", ".yoy.", "yocoy", "yocoy", ".yoy.", "..k.."],
  ["..y..", "..yy.", ".yoy.", "yocoy", "yocoy", ".yoy.", "..k.."],
  [".....", "..e..", ".eo..", ".eoe.", "eoyoe", ".eoe.", "..k.."],
];

/** A cat's paw print in cream, for the first-run hints (9 × 8). */
// prettier-ignore
export const PAW = [
  ".c..c....",
  "ccc.ccc..",
  ".c..cc.c.",
  "......ccc",
  "..ccc..c.",
  ".ccccc...",
  ".ccccc...",
  "..ccc....",
];

/** A sparkle (two frames), pixelwitch's mark on every icon and title. */
export const SPARKLE = [
  ["..c..", "..c..", "ccycc", "..c..", "..c.."],
  ["c...c", ".c.c.", "..y..", ".c.c.", "c...c"],
];

/** A little crescent moon (7 × 7). */
// prettier-ignore
export const MOON = [
  "..ccc..",
  ".cyy...",
  "cyy....",
  "cyy....",
  "cyy....",
  ".cyy...",
  "..ccc..",
];

/** Bump stars (5 × 5). */
export const STAR = ["..y..", ".yyy.", "yycyy", ".yyy.", "..y.."];

/** The floorboards under everything: night planks, darker seams, the odd knot. */
export function paintFloor(w: number, h: number): HTMLCanvasElement {
  const p = new Painter(w, h);
  for (let y = 0; y < h; y++) {
    const plank = Math.floor(y / 12);
    const shift = (plank * 37) % 46;
    for (let x = 0; x < w; x++) {
      const seam = y % 12 === 0 || (x + shift) % 46 === 0;
      const grain = (x * 7 + plank * 13) % 29 === 0 && y % 12 > 3 && y % 12 < 9;
      p.set(x, y, seam ? PAL.ink : grain ? PAL.dusk : PAL.night);
    }
  }
  return p.toCanvas();
}

/** The hearth at the top of the room (46 × 24): a stone arch under a wooden mantel, embers inside. */
export const HEARTH_W = 46;
export const HEARTH_H = 24;
export function paintHearth(): HTMLCanvasElement {
  const p = new Painter(HEARTH_W, HEARTH_H);
  // Mantel.
  p.rect(0, 0, HEARTH_W, 4, PAL.ink);
  p.rect(1, 1, HEARTH_W - 2, 2, PAL.wood);
  p.rect(1, 1, HEARTH_W - 2, 1, PAL.ember);
  // Stones.
  p.rect(2, 4, HEARTH_W - 4, HEARTH_H - 4, PAL.ink);
  for (let y = 5; y < HEARTH_H - 1; y += 5) {
    for (let x = 3 + ((y / 5) % 2 ? 3 : 0); x < HEARTH_W - 3; x += 7) p.rect(x, y, Math.min(6, HEARTH_W - 3 - x), 4, (x + y) % 3 === 0 ? PAL.mauve : PAL.dusk);
  }
  // The opening, arched, with the grate.
  for (let y = 9; y < HEARTH_H; y++) {
    const inset = y < 11 ? 12 - (y - 8) * 2 : 8;
    p.rect(8 + inset - 8, y, HEARTH_W - 2 * (8 + inset - 8), 1, PAL.ink);
  }
  for (let x = 11; x < HEARTH_W - 10; x += 3) p.set(x, HEARTH_H - 2, PAL.wood);
  return p.toCanvas();
}

/** Embers for the hearth's opening, two frames (24 × 8). */
// prettier-ignore
export const EMBERS = [
  [
    "........y...............",
    "...y...yo....y....y.....",
    "..yoy.yooy..yoy..yoy....",
    ".yoooyoeoy.yoooy.yooy.y.",
    ".oeeooeeeoyoeeoyyoeeoyoy",
    "oeeeeeeeeeoeeeeooeeeeoeo",
    "eewweewweeeeweeeewweeeee",
    "wwwwwwwwwwwwwwwwwwwwwwww",
  ],
  [
    ".....y..........y.......",
    "..y..yo...y....yo...y...",
    ".yoy.yoy.yoy..yooy.yoy..",
    ".yooyoooyyooy.yoeoyyooy.",
    "yoeeoeeeoyeeoyoeeeooeeoy",
    "oeeeeeeeeoeeeoeeeeeeeeeo",
    "eeweewweeeeeweewweeeewee",
    "wwwwwwwwwwwwwwwwwwwwwwww",
  ],
];

/** Firelight on the floor in front of the hearth: a dithered pool (w × 20). */
export function paintGlow(w: number): HTMLCanvasElement {
  const h = 20;
  const p = new Painter(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2);
      const dy = y / h;
      const d = dx * dx + dy * dy;
      if (d < 1 && dither(x, y, (1 - d) * 0.55)) p.set(x, y, d < 0.3 ? PAL.mauve : PAL.dusk);
    }
  }
  return p.toCanvas();
}

/** The rug for a board of cols × rows squares: plum, a rose border, a small mark on every square, fringed ends. */
export function paintRug(cols: number, rows: number): { img: HTMLCanvasElement; ox: number; oy: number } {
  const pad = 3;
  const fringe = 3;
  const w = cols * CELL + pad * 2;
  const h = rows * CELL + pad * 2 + fringe * 2;
  const p = new Painter(w, h);
  const y0 = fringe;
  p.rect(0, y0, w, h - fringe * 2, PAL.ink);
  p.rect(1, y0 + 1, w - 2, h - fringe * 2 - 2, PAL.plum);
  // Border: a rose line just inside the edge.
  for (let x = 2; x < w - 2; x++) {
    p.set(x, y0 + 2, PAL.rose);
    p.set(x, h - fringe - 3, PAL.rose);
  }
  for (let y = y0 + 2; y < h - fringe - 2; y++) {
    p.set(2, y, PAL.rose);
    p.set(w - 3, y, PAL.rose);
  }
  // A woven mark in the middle of every square, and faint corner stitches, so the squares read.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = pad + c * CELL + CELL / 2;
      const cy = y0 + pad + r * CELL + CELL / 2;
      const dark = (r + c) % 2 === 0;
      for (const [dx, dy] of [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2]] as const) p.set(cx + dx - 0.5, cy + dy - 0.5, dark ? PAL.mauve : PAL.rose);
      if (c > 0 && r > 0) p.set(pad + c * CELL, y0 + pad + r * CELL, PAL.mauve);
    }
  }
  // Fringe on the two short ends.
  for (let x = 1; x < w - 1; x += 2) {
    p.rect(x, 0, 1, fringe, PAL.cream);
    p.rect(x, h - fringe, 1, fringe, PAL.cream);
    p.set(x, 0, PAL.blush);
    p.set(x, h - 1, PAL.blush);
  }
  return { img: p.toCanvas(), ox: -pad, oy: -pad - fringe };
}

export interface Sprites {
  hearth: HTMLCanvasElement;
  embers: HTMLCanvasElement[];
  basket: HTMLCanvasElement;
  flame: HTMLCanvasElement[];
  paw: HTMLCanvasElement;
  sparkle: HTMLCanvasElement[];
  moon: HTMLCanvasElement;
  star: HTMLCanvasElement;
}

export function makeSprites(): Sprites {
  return {
    hearth: paintHearth(),
    embers: EMBERS.map((e) => sprite(e)),
    basket: sprite(outlineRows(BASKET_ROWS, "k", false)),
    flame: FLAME.map((f) => sprite(f)),
    paw: sprite(outlineRows(PAW, "k", false)),
    sparkle: SPARKLE.map((s) => sprite(s)),
    moon: sprite(MOON),
    star: sprite(STAR),
  };
}

/** Every palette key a sprite map here uses exists (checked by the tests). */
export const usesOnlyPalette = (rows: readonly string[], swap: Record<string, string> = {}): boolean =>
  rows.every((r) => [...r].every((ch) => ch === "." || KEY[swap[ch] ?? ch] !== undefined));
