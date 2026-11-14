/**
 * The pages: where my textbooks are piled and what the doodles built on them. A page is pure data, made from the
 * page number and a seed, and every piece sits exactly on what holds it (touching, never overlapping), so a fort
 * stands still until a wad arrives. Units are metres of the world, y up, the desk at y = 0.
 *
 * Forts are made of modules side by side (a table, a perch, a tower of sticky notes, a cup with a doodle under it,
 * dominoes...), and later pages get more doodles, more modules, and a second, lower pile of books.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { CUP, MITES, PIECES, type Kind, type MiteKind, type PieceKind } from "./pieces.ts";

/** The world the view shows: 8 m across. The desk line is y = 0. */
export const VIEW_W = 8;
/**
 * My side of the desk: a pile of books at the left, my pencil case on it, and the launcher on the case (two pencils
 * stuck in an eraser, a rubber band between their points). It sits halfway up the page so the shots go across and
 * up at the forts, and the thumb has the whole lower half to pull back in.
 */
export const BASE: Book[] = [
  { x0: 0.05, x1: 3.0, y0: 0, y1: 1.05, tone: 4, title: "DICTIONARY" },
  { x0: 0.2, x1: 2.9, y0: 1.05, y1: 2.05, tone: 0, title: "maths" },
  { x0: 0.12, x1: 2.85, y0: 2.05, y1: 2.95, tone: 2, title: "notes" },
];
export const CASE = { x0: 0.35, x1: 2.75, bottom: 2.95, top: 4.55 } as const;
/** Where the wad sits in the band before you pull. */
export const REST = { x: 1.62, y: 6.07 } as const;
/** The two pencil tips the band is tied to. */
export const POSTS = { l: { x: 1.06, y: 6.27 }, r: { x: 2.18, y: 6.27 } } as const;
/** No fort reaches higher than this (the HUD lives above it). */
export const MAX_TOP = 12.6;
/** Forts stand between these. */
export const FORT_X0 = 3.0;
export const FORT_X1 = 7.9;

export interface Book {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Cover colour index and spine title. */
  tone: number;
  title: string;
}

export interface Pile {
  x0: number;
  x1: number;
  top: number;
  books: Book[];
}

export interface Placed {
  kind: PieceKind | MiteKind;
  x: number;
  y: number;
  angle: number;
  /** Doodles are drawn smaller deeper into the notebook (1 = full size). */
  s?: number;
}

/** How big I draw the doodles on page `p`: full size to page 4, then smaller, down to 0.66. */
export function miteScale(p: number): number {
  return p <= 4 ? 1 : Math.max(0.62, 1 - 0.022 * (p - 4) - 0.012 * Math.max(0, p - 8) ** 1.3);
}
let SCALE = 1;

export interface Layout {
  page: number;
  seed: number;
  piles: Pile[];
  pieces: Placed[];
  /** A gold star sticker on the page (hit it for a wad), or none. */
  star: { x: number; y: number } | null;
}

const TITLES = ["MATH 7", "history", "bio", "ATLAS", "French II", "chem", "poems", "algebra", "geo", "lit.", "physics", "art"];

interface Mod {
  w: number;
  h: number;
  parts: Placed[];
  mites: number;
  /** Doodles a straight shot can't reach (under a cup, under a table). */
  cover?: number;
}

const UP = Math.PI / 2;

/** A column standing at local x (its centre), from y0 up; returns its height. */
type ColKind = "pencilUp" | "pad" | "eraserUp" | "eraserFlat" | "cup";
function colWidth(k: ColKind): number {
  switch (k) {
    case "pencilUp":
      return PIECES.pencil.hh * 2;
    case "pad":
      return PIECES.pad.hw * 2;
    case "eraserUp":
      return PIECES.eraser.hh * 2;
    case "eraserFlat":
      return PIECES.eraser.hw * 2;
    case "cup":
      return CUP.bottom * 2;
  }
}

function column(parts: Placed[], k: ColKind, n: number, x: number, y0: number): number {
  let y = y0;
  for (let i = 0; i < n; i++) {
    switch (k) {
      case "pencilUp":
        parts.push({ kind: "pencil", x, y: y + PIECES.pencil.hw, angle: UP });
        y += PIECES.pencil.hw * 2;
        break;
      case "pad":
        parts.push({ kind: "pad", x, y: y + PIECES.pad.hh, angle: 0 });
        y += PIECES.pad.hh * 2;
        break;
      case "eraserUp":
        parts.push({ kind: "eraser", x, y: y + PIECES.eraser.hw, angle: UP });
        y += PIECES.eraser.hw * 2;
        break;
      case "eraserFlat":
        parts.push({ kind: "eraser", x, y: y + PIECES.eraser.hh, angle: 0 });
        y += PIECES.eraser.hh * 2;
        break;
      case "cup":
        parts.push({ kind: "cup", x, y: y + PIECES.cup.hh, angle: 0 });
        y += PIECES.cup.hh * 2;
        break;
    }
  }
  return y - y0;
}

function mite(parts: Placed[], k: MiteKind, x: number, y0: number): number {
  parts.push({ kind: k, x, y: y0 + MITES[k].hh * SCALE, angle: 0, s: SCALE });
  return MITES[k].hh * 2 * SCALE;
}

function lintel(parts: Placed[], k: "pencil" | "ruler", x: number, y0: number): number {
  parts.push({ kind: k, x, y: y0 + PIECES[k].hh, angle: 0 });
  return PIECES[k].hh * 2;
}

const lintelLen = (k: "pencil" | "ruler") => PIECES[k].hw * 2;

/** Two equal columns and a pencil or ruler across them; a doodle on top, maybe one underneath. */
function table(rng: Rng, legs: ColKind, top: "pencil" | "ruler", on: MiteKind, under: MiteKind | null): Mod {
  const L = lintelLen(top);
  const lw = colWidth(legs);
  const n = legs === "pad" ? rng.int(2, 3) : legs === "eraserFlat" ? rng.int(2, 3) : 1;
  // The legs stand well inside the lintel's ends (a third of its length from each end at most, so it balances).
  const span = Math.min(L - 0.3, Math.max(lw * 2 + 0.7, L * rng.range(0.62, 0.86)));
  const w = L;
  const parts: Placed[] = [];
  const xl = w / 2 - span / 2 + lw / 2;
  const xr = w / 2 + span / 2 - lw / 2;
  const hl = column(parts, legs, n, xl, 0);
  column(parts, legs, n, xr, 0);
  const th = lintel(parts, top, w / 2, hl);
  const mx = w / 2 + rng.range(-0.25, 0.25) * (span / 2 - 0.2);
  const mh = mite(parts, on, mx, hl + th);
  let mites = 1;
  if (under && span - lw * 2 > MITES[under].hw * 2 * SCALE + 0.2 && MITES[under].hh * 2 * SCALE < hl - 0.05) {
    mite(parts, under, w / 2, 0);
    mites++;
  }
  return { w, h: hl + th + mh, parts, mites, cover: mites - 1 };
}

/** A doodle on a stack of erasers or sticky-note pads. */
function perch(rng: Rng, k: "eraserFlat" | "pad" | "eraserUp", n: number, on: MiteKind): Mod {
  const w = Math.max(colWidth(k), MITES[on].hw * 2 * SCALE);
  const parts: Placed[] = [];
  const h = column(parts, k, n, w / 2, 0);
  const mh = mite(parts, on, w / 2 + rng.range(-0.04, 0.04), h);
  return { w, h: h + mh, parts, mites: 1 };
}

/** An upturned paper cup with a tick hiding under it; sometimes a pad and another doodle on top. */
function hut(rng: Rng, topped: boolean, on: MiteKind): Mod {
  const w = CUP.bottom * 2;
  const parts: Placed[] = [];
  const h = column(parts, "cup", 1, w / 2, 0);
  mite(parts, "tick", w / 2, 0);
  let mites = 1;
  let top = h;
  if (topped) {
    top += column(parts, "pad", 1, w / 2, h);
    top += mite(parts, on, w / 2 + rng.range(-0.03, 0.03), top);
    mites++;
  }
  return { w: Math.max(w, PIECES.pad.hw * 2), h: top, parts, mites, cover: 1 };
}

/** Sticky-note pads in a pyramid (3-2-1 or 2-1), a doodle on top. */
function pyramid(rng: Rng, rows: number, on: MiteKind): Mod {
  const s = PIECES.pad.hw * 2;
  const w = rows * s;
  const parts: Placed[] = [];
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let i = 0; i < n; i++) parts.push({ kind: "pad", x: (r * s) / 2 + s / 2 + i * s, y: r * s + s / 2, angle: 0 });
  }
  const mh = mite(parts, on, w / 2 + rng.range(-0.04, 0.04), rows * s);
  return { w, h: rows * s + mh, parts, mites: 1 };
}

/** Pencils standing on end in a row, and a lanky at the far end: knock the first one over. */
function dominoes(rng: Rng, n: number): Mod {
  const gap = rng.range(0.78, 0.92);
  const pw = colWidth("pencilUp");
  const parts: Placed[] = [];
  for (let i = 0; i < n; i++) column(parts, "pencilUp", 1, pw / 2 + i * gap, 0);
  const lx = pw / 2 + n * gap - 0.1;
  mite(parts, "lanky", lx, 0);
  return { w: lx + MITES.lanky.hw, h: PIECES.pencil.hw * 2, parts, mites: 1 };
}

/** Two tables, one on the other: pads on the lower lintel hold up a second one. */
function bunk(rng: Rng, on: MiteKind, mid: MiteKind): Mod {
  const lower = table(rng, rng.chance(0.5) ? "pencilUp" : "eraserUp", "ruler", mid, null);
  const parts = lower.parts;
  // The lower lintel is the ruler; the doodle on it moves to the middle, pads go near its ends.
  const ruler = parts.find((p) => p.kind === "ruler")!;
  const y0 = ruler.y + PIECES.ruler.hh;
  const off = PIECES.ruler.hw - PIECES.pad.hw - rng.range(0.15, 0.3);
  const midMite = parts.find((p) => p.kind === mid && p.y > ruler.y)!;
  midMite.x = ruler.x;
  const ph = column(parts, "pad", 2, ruler.x - off, y0);
  column(parts, "pad", 2, ruler.x + off, y0);
  const th = lintel(parts, "pencil", ruler.x, y0 + ph);
  if (MITES[mid].hh * 2 * SCALE > ph - 0.05) {
    midMite.kind = "tick";
    midMite.y = y0 + MITES.tick.hh * SCALE;
  }
  const mh = mite(parts, on, ruler.x + rng.range(-0.2, 0.2), y0 + ph + th);
  return { w: lower.w, h: y0 + ph + th + mh, parts, mites: 2, cover: 1 };
}

/** Doodles standing on each other's heads on a perch: stubs, two or three high. */
function totem(rng: Rng, n: number): Mod {
  const base: ColKind = rng.chance(0.5) ? "eraserFlat" : "pad";
  const w = colWidth(base);
  const parts: Placed[] = [];
  let h = column(parts, base, rng.int(1, 2), w / 2, 0);
  for (let i = 0; i < n; i++) h += mite(parts, "stub", w / 2 + rng.range(-0.03, 0.03), h);
  return { w, h, parts, mites: n };
}

/** An eraser standing on end: a wall in front of the next module. */
function shield(): Mod {
  const parts: Placed[] = [];
  const h = column(parts, "eraserUp", 1, colWidth("eraserUp") / 2, 0);
  return { w: colWidth("eraserUp"), h, parts, mites: 0 };
}

/** How many of page `p`'s doodles hide where a straight shot can't reach (under a cup or a table). */
export function coverFor(p: number): number {
  return p < 5 ? 0 : Math.floor((p - 2) / 2.5);
}

/** How many doodles page `p` has (pages escalate; from page 9 there are five, sometimes six). */
export function mitesFor(p: number, rng: Rng): number {
  if (p <= 1) return 1;
  if (p <= 3) return 2;
  if (p <= 5) return 3;
  if (p <= 8) return rng.chance(0.5) ? 3 : 4;
  if (p <= 11) return rng.chance(0.6) ? 4 : 5;
  return rng.chance(0.5) ? 5 : 6;
}

function pickMite(rng: Rng, p: number): MiteKind {
  if (p <= 1) return "stub";
  if (p <= 2) return rng.chance(0.5) ? "stub" : "tick";
  const r = rng();
  return r < 0.38 ? "stub" : r < 0.7 ? "tick" : "lanky";
}

/**
 * One module for page `p`, at most `maxW` wide and `maxH` tall, with at most `want` doodles (null if nothing fits).
 * A few candidates are drawn and the one that houses the most of the doodles still to place wins, so a crowded
 * page stacks them up (bunks, totems, a doodle under a table) instead of running out of books.
 */
function module(rng: Rng, p: number, maxW: number, maxH: number, want: number, cover: number): Mod | null {
  const options: Array<() => Mod> = [];
  const m = () => pickMite(rng, p);
  options.push(() => table(rng, "pencilUp", "pencil", m(), p >= 4 && want >= 2 && rng.chance(0.6) ? "tick" : null));
  if (p >= 2) options.push(() => perch(rng, "eraserFlat", rng.int(1, p >= 4 ? 3 : 2), m()));
  if (p >= 3) options.push(() => perch(rng, "pad", rng.int(2, p >= 5 ? 4 : 3), m()));
  if (p >= 3) options.push(() => table(rng, rng.chance(0.5) ? "pad" : "eraserFlat", "pencil", m(), null));
  if (p >= 4) options.push(() => table(rng, rng.chance(0.6) ? "pencilUp" : "eraserUp", "ruler", m(), want >= 2 && rng.chance(0.7) ? rng.pick(["tick", "stub"] as const) : null));
  if (p >= 4) options.push(() => dominoes(rng, rng.int(2, 3)));
  if (p >= 5) options.push(() => hut(rng, want >= 2 && rng.chance(0.6), m()));
  if (cover > 0 && p >= 5) options.push(() => hut(rng, want >= 2 && rng.chance(0.5), m()));
  if (cover > 0 && p >= 4 && want >= 2) options.push(() => table(rng, rng.chance(0.5) ? "pencilUp" : "eraserUp", "ruler", m(), rng.pick(["tick", "stub"] as const)));
  if (p >= 6) options.push(() => pyramid(rng, rng.chance(0.5) ? 2 : 3, m()));
  if (p >= 6 && want >= 2) options.push(() => totem(rng, want >= 3 && p >= 9 && rng.chance(0.4) ? 3 : 2));
  if (p >= 7 && want >= 2) options.push(() => bunk(rng, m(), m()));
  let best: Mod | null = null;
  const value = (mod: Mod) => mod.mites + Math.min(cover, mod.cover ?? 0) * 2;
  for (let tries = 0; tries < 8; tries++) {
    const mod = rng.pick(options)();
    if (mod.w > maxW || mod.h > maxH || mod.mites > Math.max(1, want)) continue;
    if (!best || value(mod) > value(best)) best = mod;
  }
  if (best) return best;
  // Nothing bigger fits: a single eraser perch usually does.
  const fallback = perch(rng, "eraserFlat", 1, pickMite(rng, p));
  return fallback.w <= maxW && fallback.h <= maxH ? fallback : null;
}

function makePile(rng: Rng, x0: number, x1: number, top: number): Pile {
  const books: Book[] = [];
  let y = 0;
  const n = Math.max(2, Math.round(top / 0.95));
  const th = top / n;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    // Lower books stick out a little either side; the top one is exactly the fort's floor.
    const out = last ? 0 : rng.range(0.02, 0.22);
    const shift = last ? 0 : rng.range(-0.12, 0.12);
    books.push({
      x0: Math.max(FORT_X0 - 0.35, x0 - out + shift),
      x1: Math.min(VIEW_W + 0.6, x1 + out + shift),
      y0: y,
      y1: y + th,
      tone: rng.int(0, 5),
      title: rng.pick(TITLES),
    });
    y += th;
  }
  return { x0, x1, top, books };
}

/** The layout of page `p` for a run seeded with `seed`. */
export function makeLayout(p: number, seed: number): Layout {
  const rng = createRng((seed ^ Math.imul(p, 0x9e3779b1)) >>> 0);
  SCALE = miteScale(p);
  const want = mitesFor(p, rng);
  const two = p >= 10 || (p >= 6 && rng.chance(0.5));
  const piles: Pile[] = [];
  const pieces: Placed[] = [];
  // The main pile on the right; from page 6 a lower one in front of it.
  const mainX1 = FORT_X1 - rng.range(0, 0.12);
  const lowX0 = FORT_X0 + rng.range(0, 0.12);
  const lowW = rng.range(1.2, 1.45);
  const mainW = two ? Math.min(rng.range(2.8, 3.2), mainX1 - (lowX0 + lowW) - 0.38) : p <= 2 ? rng.range(2.6, 3.2) : rng.range(3.4, 4.6);
  const mainTop = p <= 1 ? 6.7 : Math.min(9.2, 6.4 + p * 0.2 + rng.range(-0.5, 0.6));
  piles.push(makePile(rng, mainX1 - mainW, mainX1, mainTop));
  if (two) piles.unshift(makePile(rng, lowX0, lowX0 + lowW, rng.range(4.6, Math.min(6.4, mainTop - 1.4))));
  // Doodles go to every pile: the low pile gets one or two, the main pile the rest.
  let left = want;
  const share = piles.map((_, i) => (piles.length === 2 && i === 0 ? Math.min(2, Math.max(1, Math.floor(want / 3))) : 0));
  if (piles.length === 2) share[1] = want - share[0]!;
  else share[0] = want;
  let top = 0;
  let cover = coverFor(p);
  piles.slice().reverse().forEach((pile) => {
    const i = piles.indexOf(pile);
    const mods: Mod[] = [];
    let need = share[i]!;
    let room = pile.x1 - pile.x0 - 0.16;
    const maxH = MAX_TOP - pile.top;
    while (need > 0 && room > 0.5) {
      const mod = module(rng, p, room, maxH, need, cover);
      if (!mod) break;
      mods.push(mod);
      need -= mod.mites;
      cover = Math.max(0, cover - (mod.cover ?? 0));
      room -= mod.w + 0.22;
      // A wall in front, now and then, on later pages.
      if (p >= 6 && need > 0 && room > 1.0 && rng.chance(Math.min(0.5, 0.1 + p * 0.025))) {
        const s = shield();
        mods.splice(mods.length - 1, 0, s);
        room -= s.w + 0.22;
      }
    }
    left -= share[i]! - Math.max(0, need);
    // Spread the modules over the pile with even gaps.
    const total = mods.reduce((a, m) => a + m.w, 0);
    const gap = mods.length > 1 ? Math.min(0.6, (pile.x1 - pile.x0 - 0.16 - total) / (mods.length - 1)) : 0;
    let x = pile.x0 + 0.08 + Math.max(0, (pile.x1 - pile.x0 - 0.16 - total - gap * (mods.length - 1)) * rng.range(0.2, 0.8));
    for (const m of mods) {
      for (const part of m.parts) pieces.push({ ...part, x: x + part.x, y: pile.top + part.y });
      top = Math.max(top, pile.top + m.h);
      x += m.w + gap;
    }
  });
  void left;
  let star: Layout["star"] = null;
  if (p >= 2 && rng.chance(0.45)) {
    const main = piles[piles.length - 1]!;
    star = { x: rng.range(Math.max(FORT_X0, main.x0 - 0.8), main.x1 - 0.6), y: Math.min(12.2, Math.max(top, main.top + 2) + rng.range(0.9, 1.6)) };
  }
  return { page: p, seed, piles, pieces, star };
}

/** The kinds a layout uses (for "new: paper cups!" the first time a run meets them). */
export function kindsOf(l: Layout): Set<Kind> {
  return new Set(l.pieces.map((p) => p.kind));
}
