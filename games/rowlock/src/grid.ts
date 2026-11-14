/**
 * The shape of a number grid and everything that follows from it: units, peers, candidate masks, full solutions
 * and an exact solution counter. No drawing and no clock here: the solver, the dealer, the run and the tests all
 * build on this.
 *
 * A grid of size n has n rows, n columns and n boxes of br × bc keys. Every unit takes each digit 1..n once.
 * Cells are numbered row by row (0 .. n² − 1). A value of 0 is an empty key.
 */
import type { Rng } from "@thumbcade-games/kit/rng";

export interface Shape {
  n: number;
  /** Rows per box. */
  br: number;
  /** Columns per box. */
  bc: number;
}

export const SHAPE_4: Shape = { n: 4, br: 2, bc: 2 };
export const SHAPE_6: Shape = { n: 6, br: 2, bc: 3 };

export type UnitKind = "row" | "col" | "box";

export interface Geometry {
  shape: Shape;
  cells: number;
  /** Bit mask with every digit set. */
  all: number;
  /** Units 0..n-1 are rows, n..2n-1 columns, 2n..3n-1 boxes; each lists its cells in reading order. */
  units: number[][];
  /** The row, column and box unit of every cell. */
  unitsOf: [number, number, number][];
  /** The other cells that share a unit with each cell. */
  peers: number[][];
}

const cache = new Map<string, Geometry>();

export function geometry(shape: Shape): Geometry {
  const key = `${shape.n}:${shape.br}:${shape.bc}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { n, br, bc } = shape;
  const units: number[][] = [];
  for (let r = 0; r < n; r++) units.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) units.push(Array.from({ length: n }, (_, r) => r * n + c));
  const boxesAcross = n / bc;
  for (let b = 0; b < n; b++) {
    const r0 = Math.floor(b / boxesAcross) * br;
    const c0 = (b % boxesAcross) * bc;
    const cells: number[] = [];
    for (let r = 0; r < br; r++) for (let c = 0; c < bc; c++) cells.push((r0 + r) * n + c0 + c);
    units.push(cells);
  }
  const unitsOf: [number, number, number][] = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const b = Math.floor(r / br) * boxesAcross + Math.floor(c / bc);
    unitsOf.push([r, n + c, 2 * n + b]);
  }
  const peers = unitsOf.map((us, i) => {
    const set = new Set<number>();
    for (const u of us) for (const j of units[u]!) if (j !== i) set.add(j);
    return [...set].sort((a, b) => a - b);
  });
  const g: Geometry = { shape, cells: n * n, all: (1 << n) - 1, units, unitsOf, peers };
  cache.set(key, g);
  return g;
}

export const unitKind = (g: Geometry, u: number): UnitKind => (u < g.shape.n ? "row" : u < 2 * g.shape.n ? "col" : "box");
export const rowOf = (g: Geometry, cell: number): number => Math.floor(cell / g.shape.n);
export const colOf = (g: Geometry, cell: number): number => cell % g.shape.n;
export const boxOf = (g: Geometry, cell: number): number => g.unitsOf[cell]![2] - 2 * g.shape.n;

export const bit = (d: number): number => 1 << (d - 1);
export function popcount(m: number): number {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}
/** The lowest digit in a mask (0 for an empty mask). */
export function firstDigit(m: number): number {
  if (!m) return 0;
  let d = 1;
  while (!(m & 1)) {
    m >>= 1;
    d++;
  }
  return d;
}
export function digitsOf(m: number): number[] {
  const out: number[] = [];
  for (let d = 1; m; d++, m >>= 1) if (m & 1) out.push(d);
  return out;
}

/** The digits each empty key can still take, looking only at the placed digits around it (0 for a filled key). */
export function candidates(g: Geometry, values: ArrayLike<number>): Uint16Array {
  const out = new Uint16Array(g.cells);
  for (let i = 0; i < g.cells; i++) {
    if (values[i]) continue;
    let m = g.all;
    for (const p of g.peers[i]!) if (values[p]) m &= ~bit(values[p]!);
    out[i] = m;
  }
  return out;
}

/** True when no unit holds a digit twice (empty keys allowed). */
export function consistent(g: Geometry, values: ArrayLike<number>): boolean {
  for (const u of g.units) {
    let seen = 0;
    for (const i of u) {
      const v = values[i]!;
      if (!v) continue;
      if (seen & bit(v)) return false;
      seen |= bit(v);
    }
  }
  return true;
}

/** True when every key is filled and the grid is consistent. */
export function complete(g: Geometry, values: ArrayLike<number>): boolean {
  for (let i = 0; i < g.cells; i++) if (!values[i]) return false;
  return consistent(g, values);
}

/** A random full grid: depth-first fill with the digits tried in a shuffled order at every key. */
export function randomSolution(shape: Shape, rng: Rng): Int8Array {
  const g = geometry(shape);
  const v = new Int8Array(g.cells);
  const fill = (i: number): boolean => {
    if (i === g.cells) return true;
    let m = g.all;
    for (const p of g.peers[i]!) if (v[p]) m &= ~bit(v[p]!);
    const ds = rng.shuffle(digitsOf(m));
    for (const d of ds) {
      v[i] = d;
      if (fill(i + 1)) return true;
    }
    v[i] = 0;
    return false;
  };
  fill(0);
  return v;
}

/**
 * Counts the solutions of a grid, stopping at `limit`. Plain backtracking on the key with the fewest candidates;
 * a 6 × 6 grid takes well under a millisecond. Used to prove that every dealt grid has exactly one solution.
 */
export function countSolutions(g: Geometry, values: ArrayLike<number>, limit = 2): number {
  if (!consistent(g, values)) return 0;
  const v = Int8Array.from(values as ArrayLike<number>);
  let found = 0;
  const go = (): void => {
    if (found >= limit) return;
    let best = -1;
    let bestMask = 0;
    let bestCount = 99;
    for (let i = 0; i < g.cells; i++) {
      if (v[i]) continue;
      let m = g.all;
      for (const p of g.peers[i]!) if (v[p]) m &= ~bit(v[p]!);
      const c = popcount(m);
      if (c === 0) return;
      if (c < bestCount) {
        best = i;
        bestMask = m;
        bestCount = c;
        if (c === 1) break;
      }
    }
    if (best < 0) {
      found++;
      return;
    }
    for (const d of digitsOf(bestMask)) {
      v[best] = d;
      go();
      if (found >= limit) break;
    }
    v[best] = 0;
  };
  go();
  return found;
}
