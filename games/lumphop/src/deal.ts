/**
 * Levels and deals. Every level is dealt fresh from the run's seed: the lumps are shuffled into full pots, a few are
 * covered, empty pots are added, and the deal is kept only if the solver clears it with the real rules (covered lumps
 * included), so every level that reaches a player can be tidied. The solver's line is kept as the deal's witness.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { FULL, type Board, type Move } from "./rules.ts";
import { solve } from "./solver.ts";

export interface Plan {
  /** Kinds of lump (four of each). */
  kinds: number;
  /** Empty full-size pots. */
  empty: number;
  /** Size of a little pot added empty (0 = none). */
  little: number;
  /** Lumps dealt covered (never a pot's top). */
  covered: number;
}

/** The levels of a run. Past the last one, the last repeats. */
export const PLANS: readonly Plan[] = [
  { kinds: 2, empty: 1, little: 0, covered: 0 },
  { kinds: 3, empty: 2, little: 0, covered: 0 },
  { kinds: 4, empty: 2, little: 0, covered: 0 },
  { kinds: 5, empty: 2, little: 0, covered: 2 },
  { kinds: 6, empty: 2, little: 0, covered: 4 },
  { kinds: 6, empty: 1, little: 3, covered: 5 },
  { kinds: 7, empty: 2, little: 0, covered: 6 },
  { kinds: 8, empty: 2, little: 0, covered: 7 },
];

export const planFor = (level: number): Plan => PLANS[Math.min(PLANS.length - 1, Math.max(0, level - 1))]!;

export interface Deal {
  board: Board;
  /** A clearing line, as the solver found it. */
  witness: Move[];
  /** Deals tried before this one was kept. */
  tries: number;
}

/** A pot holds at most two of a kind at the start, so nothing is half done before the first tap. */
function fair(pots: number[][], kinds: number): boolean {
  for (const p of pots) {
    const c = new Map<number, number>();
    for (const k of p) c.set(k, (c.get(k) ?? 0) + 1);
    for (const n of c.values()) if (n > 2 && kinds > 2) return false;
    if (kinds === 2 && p[p.length - 1] === p[p.length - 2] && p[p.length - 2] === p[p.length - 3]) return false;
  }
  return true;
}

/** Deals a level for `plan`. Deterministic for a given rng state. */
export function dealLevel(plan: Plan, rng: Rng, limit = 30_000): Deal {
  for (let tries = 1; ; tries++) {
    const lumps: number[] = [];
    for (let k = 0; k < plan.kinds; k++) for (let i = 0; i < FULL; i++) lumps.push(k);
    rng.shuffle(lumps);
    const pots: number[][] = [];
    for (let p = 0; p < plan.kinds; p++) pots.push(lumps.slice(p * FULL, (p + 1) * FULL));
    if (!fair(pots, plan.kinds) && tries < 200) continue;
    const board: Board = pots.map((units) => ({ units, covered: units.map(() => false), cap: FULL }));
    // Covered lumps: anywhere below a pot's top, spread over different pots first.
    const spots: Array<[number, number]> = [];
    for (let p = 0; p < board.length; p++) for (let i = 0; i < FULL - 1; i++) spots.push([p, i]);
    rng.shuffle(spots);
    const chosen = spots.slice(0, Math.min(plan.covered, spots.length));
    for (const [p, i] of chosen) board[p]!.covered[i] = true;
    for (let e = 0; e < plan.empty; e++) board.push({ units: [], covered: [], cap: FULL });
    if (plan.little) board.push({ units: [], covered: [], cap: plan.little });
    const s = solve(board, limit);
    if (s.status === "solved") return { board, witness: s.moves, tries };
  }
}
