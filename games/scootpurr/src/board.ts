/**
 * The rug and the cats on it.
 *
 * A cat lies along a row or a column, one to three squares long, and faces the way its head points. Tapped, it
 * scoots straight ahead and off the rug, if every square between its nose and the rug's edge is empty. Baskets
 * never move. A cat that leaves only ever frees squares, so a rug that can be cleared stays clearable whatever
 * order the free cats go in.
 */
import type { Rng } from "@thumbcade-games/kit/rng";

/** 0 right, 1 down, 2 left, 3 up. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export interface Cat {
  id: number;
  /** The square its head is on. The body trails behind, away from where it faces. */
  x: number;
  y: number;
  len: number;
  dir: Dir;
  /** Which coat it wears (0 is the witch's black cat). */
  coat: number;
  out: boolean;
}

export interface Board {
  cols: number;
  rows: number;
  cats: Cat[];
  /** Squares with a basket on them. */
  baskets: number[];
  /** One order that clears the rug without a bump: cat ids, first out first. The witch's cat is last. */
  witness: number[];
}

export const EMPTY = -1;
export const BASKET = -2;

/** The squares a cat lies on, head first. */
export function squares(c: Cat): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < c.len; i++) out.push([c.x - DX[c.dir] * i, c.y - DY[c.dir] * i]);
  return out;
}

/** What is on each square: a cat's id, a basket, or nothing. */
export function occupancy(b: Board): Int8Array {
  const occ = new Int8Array(b.cols * b.rows).fill(EMPTY);
  for (const i of b.baskets) occ[i] = BASKET;
  for (const c of b.cats) {
    if (c.out) continue;
    for (const [x, y] of squares(c)) occ[y * b.cols + x] = c.id;
  }
  return occ;
}

export interface Way {
  /** Empty squares ahead of the cat's nose before the rug's edge or whatever is in the way. */
  free: number;
  /** What stops it: a cat's id, BASKET, or EMPTY when the way is clear to the edge. */
  by: number;
}

/** Looks ahead of a cat. */
export function wayOf(b: Board, c: Cat, occ: Int8Array = occupancy(b)): Way {
  let x = c.x + DX[c.dir];
  let y = c.y + DY[c.dir];
  let free = 0;
  while (x >= 0 && y >= 0 && x < b.cols && y < b.rows) {
    const o = occ[y * b.cols + x]!;
    if (o !== EMPTY) return { free, by: o };
    free++;
    x += DX[c.dir];
    y += DY[c.dir];
  }
  return { free, by: EMPTY };
}

/** The cats that could leave right now. */
export function freeCats(b: Board): Cat[] {
  const occ = occupancy(b);
  return b.cats.filter((c) => !c.out && wayOf(b, c, occ).by === EMPTY);
}

export const catsLeft = (b: Board): number => b.cats.reduce((n, c) => n + (c.out ? 0 : 1), 0);

/**
 * How many rounds it takes to clear the rug if every free cat leaves at once each round: 1 means nobody is in
 * anybody's way; Infinity means it cannot be cleared.
 */
export function waves(b: Board): number {
  const copy: Board = { ...b, cats: b.cats.map((c) => ({ ...c })) };
  let n = 0;
  while (catsLeft(copy) > 0) {
    const free = freeCats(copy);
    if (free.length === 0) return Infinity;
    for (const c of free) c.out = true;
    n++;
  }
  return n;
}

export interface Spec {
  cols: number;
  rows: number;
  cats: number;
  baskets: number;
  /** Chances of a cat being 1, 2 or 3 squares long. */
  lens: readonly [number, number, number];
  /** 0-1: how hard the dealer tries to lay each cat across another's way. */
  tangle: number;
  /** The rug must take at least this many rounds to clear. */
  waves: number;
}

/** The rugs of a run: small and open first, then bigger and more tangled; the last one repeats. */
export const SPECS: readonly Spec[] = [
  { cols: 4, rows: 4, cats: 4, baskets: 0, lens: [0, 1, 0], tangle: 0.2, waves: 2 },
  { cols: 4, rows: 5, cats: 6, baskets: 0, lens: [1, 4, 1], tangle: 0.45, waves: 2 },
  { cols: 5, rows: 5, cats: 8, baskets: 0, lens: [1, 4, 2], tangle: 0.6, waves: 3 },
  { cols: 5, rows: 6, cats: 10, baskets: 1, lens: [1, 4, 2], tangle: 0.7, waves: 3 },
  { cols: 6, rows: 6, cats: 12, baskets: 1, lens: [1, 4, 3], tangle: 0.8, waves: 4 },
  { cols: 6, rows: 7, cats: 14, baskets: 2, lens: [1, 4, 3], tangle: 0.9, waves: 4 },
  { cols: 6, rows: 7, cats: 16, baskets: 2, lens: [1, 4, 3], tangle: 1, waves: 5 },
];

export const specOf = (level: number): Spec => SPECS[Math.min(level, SPECS.length - 1)]!;

/** The coats a cat that is not the witch's can wear. */
export const COATS = 4;

function pickLen(rng: Rng, lens: readonly [number, number, number]): number {
  const total = lens[0] + lens[1] + lens[2];
  let r = rng() * total;
  for (let i = 0; i < 3; i++) {
    r -= lens[i]!;
    if (r < 0) return i + 1;
  }
  return 2;
}

/**
 * Deals a rug backwards: the cat that will leave last (the witch's) is laid first, and every cat after it is laid
 * where its own way out is clear of everything already down. Taken in the opposite order, each cat finds its way
 * empty, so the rug clears without a bump; that order is kept as the witness.
 */
function dealOnce(spec: Spec, rng: Rng): Board | null {
  const { cols, rows } = spec;
  const occ = new Int8Array(cols * rows).fill(EMPTY);
  const baskets: number[] = [];
  for (let i = 0; i < spec.baskets; i++) {
    // Baskets stay off the rim, so no cat on the rim is ever shut in by one.
    for (let t = 0; t < 40; t++) {
      const x = rng.int(1, cols - 2);
      const y = rng.int(1, rows - 2);
      if (occ[y * cols + x] !== EMPTY) continue;
      occ[y * cols + x] = BASKET;
      baskets.push(y * cols + x);
      break;
    }
  }
  const cats: Cat[] = [];
  const board: Board = { cols, rows, cats, baskets, witness: [] };
  const looks = 1 + Math.round(spec.tangle * 7);
  for (let id = 0; id < spec.cats; id++) {
    let best: Cat | null = null;
    let bestScore = -1;
    let found = 0;
    for (let t = 0; t < 260 && found < looks; t++) {
      const c: Cat = { id, x: rng.int(0, cols - 1), y: rng.int(0, rows - 1), len: id === 0 ? 2 : pickLen(rng, spec.lens), dir: rng.int(0, 3) as Dir, coat: id === 0 ? 0 : 1 + rng.int(0, COATS - 1), out: false };
      const sq = squares(c);
      if (sq.some(([x, y]) => x < 0 || y < 0 || x >= cols || y >= rows || occ[y * cols + x] !== EMPTY)) continue;
      if (wayOf(board, c, occ).by !== EMPTY) continue;
      found++;
      // Lying across the way of cats already down makes them wait for this one.
      let score = rng() * 0.5;
      for (const other of cats) {
        let x = other.x + DX[other.dir];
        let y = other.y + DY[other.dir];
        let near = 3;
        while (x >= 0 && y >= 0 && x < cols && y < rows) {
          if (sq.some(([sx, sy]) => sx === x && sy === y)) {
            score += near;
            break;
          }
          near = Math.max(1, near - 1);
          x += DX[other.dir];
          y += DY[other.dir];
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) return null;
    cats.push(best);
    for (const [x, y] of squares(best)) occ[y * cols + x] = id;
  }
  board.witness = cats.map((c) => c.id).reverse();
  return board;
}

/** Deals the rug for a level. The same seed and level always give the same rug. */
export function deal(level: number, rng: Rng): Board {
  const spec = specOf(level);
  let fallback: Board | null = null;
  for (let t = 0; t < 60; t++) {
    const b = dealOnce(spec, rng);
    if (!b) continue;
    fallback ??= b;
    if (waves(b) >= spec.waves) return b;
  }
  if (fallback) return fallback;
  // A rug so crowded nothing fitted: thin it out until one does.
  for (let cats = spec.cats - 1; cats >= 1; cats--) {
    const b = dealOnce({ ...spec, cats }, rng);
    if (b) return b;
  }
  throw new Error("no rug could be dealt");
}
