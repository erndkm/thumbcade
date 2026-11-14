/**
 * Dealing grids. A grid is dug out of a random full solution: keys are emptied one at a time in a shuffled order,
 * and a key stays empty only if the human-technique solver (src/solver.ts) still fills the whole grid. So every
 * dealt grid has exactly one solution and can be solved by logic alone.
 *
 * Two numbers grade a grid. Its technique is the hardest one the solve needed (the solver always takes the
 * easiest move on the board, so a grid graded "one home in a line" has a moment where no box shows a single).
 * Its width is how many singles the placed digits show, on average, along the solve: a narrow grid hides its
 * next move, which is what slows a person down against a clock.
 *
 * A run deals a 4 × 4 warm-up (today's grid, the same for everyone) and then 6 × 6 grids that dig deeper, ask for
 * a single in a line from the fifth grid and for a key with one digit left (or a locked digit or a pair) from
 * the sixth. Such grids are rare among random digs (about 2 % at 26 empty keys), so the dealer tries many and
 * spreads the work over frames (`DealJob.work`). Every grid's seed comes from the run's seed and its index, so
 * the order, timing and budget of the work never change a grid.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { geometry, randomSolution, SHAPE_4, SHAPE_6, type Shape } from "./grid.ts";
import { singles, solve, TECH } from "./solver.ts";

export interface Spec {
  shape: Shape;
  /** Empty keys to dig to (the dig stops there, or earlier when no key can go). */
  empties: number;
  /** The hardest technique the solve must need; a grid below it is dug again. */
  minTech: number;
  /** Digs to try for `minTech` before settling for the best one. */
  tries: number;
  /** Among qualifying digs, keep the narrowest of this many (1 = the first). */
  pick: number;
  /** One key carries a spark (it pays a lamp). The warm-up has none. */
  spark: boolean;
}

/** What grid `index` of a run looks like. */
export function specFor(index: number): Spec {
  if (index === 0) return { shape: SHAPE_4, empties: 9, minTech: 0, tries: 1, pick: 1, spark: false };
  if (index === 1) return { shape: SHAPE_6, empties: 16, minTech: 0, tries: 1, pick: 1, spark: true };
  if (index === 2) return { shape: SHAPE_6, empties: 19, minTech: 0, tries: 1, pick: 1, spark: true };
  if (index === 3) return { shape: SHAPE_6, empties: 22, minTech: 0, tries: 3, pick: 3, spark: true };
  if (index === 4) return { shape: SHAPE_6, empties: 24, minTech: TECH.hiddenLine, tries: 40, pick: 1, spark: true };
  return { shape: SHAPE_6, empties: 26, minTech: TECH.nakedSingle, tries: 160, pick: 1, spark: true };
}

export interface Puzzle {
  shape: Shape;
  givens: Int8Array;
  solution: Int8Array;
  /** The key with the spark, or -1. */
  spark: number;
  /** Hardest technique the logic solve needs. */
  grade: number;
  /** Mean number of visible singles along the solve (lower is harder to read). */
  width: number;
  empties: number;
  /** Digs it took. */
  tries: number;
}

function measure(shape: Shape, givens: Int8Array): { grade: number; width: number; order: number[] } {
  const g = geometry(shape);
  const r = solve(g, givens);
  const v = Int8Array.from(givens);
  let w = 0;
  for (const p of r.placements) {
    w += singles(g, v).length;
    v[p.cell] = p.digit;
  }
  return { grade: r.hardest, width: r.placements.length ? w / r.placements.length : 0, order: r.placements.map((p) => p.cell) };
}

/** One dig: a fresh full grid emptied in a shuffled order as far as logic allows (up to `spec.empties`). */
export function dig(spec: Spec, rng: Rng): Puzzle {
  const g = geometry(spec.shape);
  const solution = randomSolution(spec.shape, rng);
  const givens = Int8Array.from(solution);
  const order = rng.shuffle(Array.from({ length: g.cells }, (_, i) => i));
  let empties = 0;
  for (const i of order) {
    if (empties >= spec.empties) break;
    const keep = givens[i]!;
    givens[i] = 0;
    if (solve(g, givens).solved) empties++;
    else givens[i] = keep;
  }
  const m = measure(spec.shape, givens);
  return { shape: spec.shape, givens, solution, spark: -1, grade: m.grade, width: m.width, empties, tries: 1 };
}

/** Picks the spark: a key the solve reaches in its second half, so it is never the first thing you fill. */
function pickSpark(p: Puzzle, rng: Rng): number {
  const order = measure(p.shape, p.givens).order;
  const half = Math.floor(order.length / 2);
  const late = order.slice(half, Math.max(half + 1, order.length - 2));
  return late.length ? rng.pick(late) : (order.at(-1) ?? -1);
}

const better = (a: Puzzle, b: Puzzle, minTech: number) => {
  const qa = a.grade >= minTech ? 1 : 0;
  const qb = b.grade >= minTech ? 1 : 0;
  if (qa !== qb) return qa > qb;
  if (a.empties !== b.empties) return a.empties > b.empties;
  if (a.grade !== b.grade) return a.grade > b.grade;
  return a.width < b.width;
};

/** Deals one grid a dig at a time, so the work can be spread over frames. */
export class DealJob {
  private best: Puzzle | null = null;
  private tries = 0;
  private qualified = 0;
  private result: Puzzle | null = null;
  constructor(
    readonly spec: Spec,
    private rng: Rng,
  ) {}
  get done(): boolean {
    return this.result !== null;
  }
  /** Digs until done or until `budgetMs` has passed (Infinity: to the end). Returns the grid once dealt. */
  work(budgetMs = Infinity, now: () => number = () => performance.now()): Puzzle | null {
    if (this.result) return this.result;
    const t0 = now();
    const { spec } = this;
    do {
      const p = dig(spec, this.rng);
      this.tries++;
      if (!this.best || better(p, this.best, spec.minTech)) this.best = p;
      if (p.grade >= spec.minTech) this.qualified++;
      if (this.qualified >= spec.pick || this.tries >= Math.max(spec.tries, spec.pick)) {
        const out: Puzzle = { ...this.best, tries: this.tries };
        out.spark = spec.spark ? pickSpark(out, this.rng) : -1;
        this.result = out;
        return out;
      }
    } while (now() - t0 < budgetMs);
    return null;
  }
}

/** Deals one grid to `spec` in one go. */
export function deal(spec: Spec, rng: Rng): Puzzle {
  return new DealJob(spec, rng).work()!;
}

/** Mixes a run seed and a grid index into the seed for that grid. */
export function gridSeed(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Today's warm-up: the same 4 × 4 for every player on a UTC day. */
export function dailyGrid(dailySeed: number): Puzzle {
  return deal(specFor(0), createRng(gridSeed(dailySeed, 0x7da1)));
}

/**
 * Grids for one run: grid 0 is today's, the rest come from the run's seed. `pump` deals the next grid a few
 * milliseconds per frame while the current one is played; `get` finishes any grid at once if it is needed now.
 */
export class Dealer {
  private grids = new Map<number, Puzzle>();
  private jobs = new Map<number, DealJob>();
  constructor(
    readonly seed: number,
    readonly dailySeed: number,
  ) {}
  private job(index: number): DealJob {
    let j = this.jobs.get(index);
    if (!j) {
      j = new DealJob(specFor(index), createRng(gridSeed(this.seed, index)));
      this.jobs.set(index, j);
    }
    return j;
  }
  get(index: number): Puzzle {
    let p = this.grids.get(index);
    if (!p) {
      p = index === 0 ? dailyGrid(this.dailySeed) : this.job(index).work()!;
      this.grids.set(index, p);
      this.jobs.delete(index);
    }
    return p;
  }
  /** Works on grid `index` for up to `budgetMs`. True once it is ready. */
  pump(index: number, budgetMs: number): boolean {
    if (this.grids.has(index)) return true;
    if (index === 0) {
      this.get(0);
      return true;
    }
    const p = this.job(index).work(budgetMs);
    if (!p) return false;
    this.grids.set(index, p);
    this.jobs.delete(index);
    return true;
  }
  has(index: number): boolean {
    return this.grids.has(index);
  }
}
