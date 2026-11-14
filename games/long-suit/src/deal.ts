/**
 * Dealing. Every deal handed to a player can be won, and won without thinking ahead: a shuffled pack is laid out
 * and played to the end by natural play (src/natural.ts), once taking the first play on the list every time and
 * two dozen more times taking any of them at random. Only a layout that every one of those wins is dealt, so a
 * deal is all but never lost by playing what fits; the first playout's taps are kept as the deal's witness.
 *
 * A deal depends only on the run's seed, its level and how many times that level has been dealt afresh, never on
 * how the work was split over frames.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { cloneTable, layOut, newPack, type Table } from "./cards.ts";
import { playout, type Target } from "./natural.ts";

export interface Spec {
  /** Cards per suit: the pack runs from the ace to this rank. */
  ranks: number;
  cols: number;
}

/** The deals of a run: a short pack on four columns first, the whole pack on seven from the fifth deal on. */
export const SPECS: readonly Spec[] = [
  { ranks: 5, cols: 4 },
  { ranks: 7, cols: 5 },
  { ranks: 9, cols: 6 },
  { ranks: 11, cols: 7 },
  { ranks: 13, cols: 7 },
];

export const specOf = (level: number): Spec => SPECS[Math.min(level, SPECS.length - 1)]!;

/** Cards left in the pack once the columns are laid. */
export const stockOf = (s: Spec): number => s.ranks * 4 - (s.cols * (s.cols + 1)) / 2;

export interface Dealt {
  table: Table;
  /** Taps that win it: natural play, the first play on the list every time. */
  witness: Target[];
  /** Layouts shuffled before one passed. */
  tries: number;
}

/** Random-order playouts a layout must also win. */
export const PLAYOUTS = 24;

const mix = (seed: number, level: number, redeal: number, attempt: number): number =>
  (seed ^ Math.imul(level + 1, 0x9e3779b1) ^ Math.imul(redeal + 1, 0x85ebca6b) ^ Math.imul(attempt + 1, 0xc2b2ae35)) >>> 0;

function shuffled(seed: number, level: number, redeal: number, attempt: number): Table {
  const spec = specOf(level);
  const rng = createRng(mix(seed, level, redeal, attempt));
  return layOut(rng.shuffle(newPack(spec.ranks)), spec.ranks, spec.cols);
}

/** Does natural play win this layout whichever play comes first? Returns the witness, or null. */
export function passes(table: Table, seed: number): Target[] | null {
  const witness = playout(table);
  if (!witness) return null;
  const rng = createRng(seed ^ 0x51ed270b);
  for (let i = 0; i < PLAYOUTS; i++) if (!playout(table, rng)) return null;
  return witness;
}

interface Job {
  attempt: number;
  done: Dealt | null;
}

export class Dealer {
  private readonly jobs = new Map<string, Job>();

  constructor(readonly seed: number) {}

  private job(level: number, redeal: number): Job {
    const key = `${level}:${redeal}`;
    let j = this.jobs.get(key);
    if (!j) this.jobs.set(key, (j = { attempt: 0, done: null }));
    return j;
  }

  private work(j: Job, level: number, redeal: number, ms: number): boolean {
    const until = performance.now() + ms;
    while (!j.done) {
      const table = shuffled(this.seed, level, redeal, j.attempt);
      const witness = passes(table, mix(this.seed, level, redeal, j.attempt));
      if (witness) j.done = { table, witness, tries: j.attempt + 1 };
      else j.attempt++;
      if (!j.done && performance.now() >= until) return false;
    }
    return true;
  }

  /** Works on a deal for at most `ms` milliseconds. True when it is ready. */
  pump(level: number, redeal: number, ms: number): boolean {
    return this.work(this.job(level, redeal), level, redeal, ms);
  }

  ready(level: number, redeal: number): boolean {
    return this.jobs.get(`${level}:${redeal}`)?.done != null;
  }

  /** The deal, finishing the work now if it is not ready yet. The table is a fresh copy every time. */
  get(level: number, redeal = 0): Dealt {
    const j = this.job(level, redeal);
    this.work(j, level, redeal, Infinity);
    const d = j.done!;
    return { table: cloneTable(d.table), witness: d.witness, tries: d.tries };
  }
}
