/**
 * A solver that only uses the techniques a person uses, in the order a person reaches for them: the last gap in a
 * unit, a digit with one home in a box or a line, a key with one digit left, and only then the intersections and
 * pairs. It never guesses, so a grid it fills completely has exactly one solution, and the hardest technique it
 * needed is the grid's grade.
 *
 * The same code finds the idle nudge (the easiest move on the board right now) and tells the pilots what a
 * person could see.
 */
import { bit, candidates, digitsOf, firstDigit, type Geometry, popcount } from "./grid.ts";

/** Techniques, easiest first. The numbers are ordered: a grade is the hardest one a solve needed. */
export const TECH = {
  /** The only gap left in a row, column or box. */
  fullHouse: 1,
  /** A digit that fits one key of a box. */
  hiddenBox: 2,
  /** A digit that fits one key of a row or column. */
  hiddenLine: 3,
  /** A key that only one digit fits. */
  nakedSingle: 4,
  /** A digit confined to one line inside a box (or one box inside a line) rules it out elsewhere. */
  locked: 5,
  /** Two keys of a unit that share the same two digits rule them out for the rest. */
  nakedPair: 6,
  /** Two digits that only fit the same two keys of a unit claim them. */
  hiddenPair: 7,
} as const;
export type Tech = (typeof TECH)[keyof typeof TECH];
export const TECH_NAME: Record<Tech, string> = {
  1: "last gap",
  2: "one home in a box",
  3: "one home in a line",
  4: "one digit left",
  5: "locked in a line",
  6: "a pair",
  7: "a hidden pair",
};
/** Techniques that place a digit (the rest only rule candidates out). */
export const SINGLES: readonly Tech[] = [TECH.fullHouse, TECH.hiddenBox, TECH.hiddenLine, TECH.nakedSingle];

export interface Placement {
  cell: number;
  digit: number;
  tech: Tech;
  /** The unit that shows it (for full houses and hidden singles). */
  unit: number;
}

export interface SolveResult {
  solved: boolean;
  /** Every placement in the order found, with the technique that found it. */
  placements: Placement[];
  /** The hardest technique used (0 for an already full grid). */
  hardest: number;
  /** How many elimination steps (locked candidates, pairs) were needed. */
  eliminations: number;
  values: Int8Array;
}

/**
 * Every single on the board right now, judged only from the placed digits (what a player sees without pencil
 * marks): each empty key at most once, under the easiest technique that finds it.
 */
export function singles(g: Geometry, values: ArrayLike<number>, cand: Uint16Array = candidates(g, values)): Placement[] {
  const best = new Map<number, Placement>();
  const offer = (p: Placement) => {
    const had = best.get(p.cell);
    if (!had || p.tech < had.tech) best.set(p.cell, p);
  };
  const n = g.shape.n;
  for (let u = 0; u < g.units.length; u++) {
    const cells = g.units[u]!;
    let empty = -1;
    let gaps = 0;
    let placed = 0;
    for (const i of cells) {
      if (values[i]) placed |= bit(values[i]!);
      else {
        gaps++;
        empty = i;
      }
    }
    if (gaps === 1) offer({ cell: empty, digit: firstDigit(g.all & ~placed), tech: TECH.fullHouse, unit: u });
    const tech = u >= 2 * n ? TECH.hiddenBox : TECH.hiddenLine;
    for (let d = 1; d <= n; d++) {
      if (placed & bit(d)) continue;
      let at = -1;
      let count = 0;
      for (const i of cells) {
        if (!values[i] && cand[i]! & bit(d)) {
          count++;
          at = i;
        }
      }
      if (count === 1) offer({ cell: at, digit: d, tech, unit: u });
    }
  }
  for (let i = 0; i < g.cells; i++) {
    if (!values[i] && popcount(cand[i]!) === 1) offer({ cell: i, digit: firstDigit(cand[i]!), tech: TECH.nakedSingle, unit: g.unitsOf[i]![2] });
  }
  return [...best.values()].sort((a, b) => a.tech - b.tech || a.cell - b.cell);
}

/** One elimination step, if any: removes candidates in place and returns the technique used, or 0. */
function eliminate(g: Geometry, values: Int8Array, cand: Uint16Array, maxTech: number): number {
  const n = g.shape.n;
  if (maxTech >= TECH.locked) {
    // Pointing: a digit confined to one line inside a box leaves the rest of that line. Claiming: confined to one
    // box inside a line, it leaves the rest of that box.
    for (let b = 2 * n; b < 3 * n; b++) {
      for (let d = 1; d <= n; d++) {
        const where = g.units[b]!.filter((i) => !values[i] && cand[i]! & bit(d));
        if (where.length < 2) continue;
        for (const k of [0, 1] as const) {
          const line = g.unitsOf[where[0]!]![k];
          if (!where.every((i) => g.unitsOf[i]![k] === line)) continue;
          let hit = false;
          for (const j of g.units[line]!) {
            if (!values[j] && g.unitsOf[j]![2] !== b && cand[j]! & bit(d)) {
              cand[j]! &= ~bit(d);
              hit = true;
            }
          }
          if (hit) return TECH.locked;
        }
      }
    }
    for (let line = 0; line < 2 * n; line++) {
      for (let d = 1; d <= n; d++) {
        const where = g.units[line]!.filter((i) => !values[i] && cand[i]! & bit(d));
        if (where.length < 2) continue;
        const box = g.unitsOf[where[0]!]![2];
        if (!where.every((i) => g.unitsOf[i]![2] === box)) continue;
        let hit = false;
        for (const j of g.units[box]!) {
          if (!values[j] && g.unitsOf[j]![line < n ? 0 : 1] !== line && cand[j]! & bit(d)) {
            cand[j]! &= ~bit(d);
            hit = true;
          }
        }
        if (hit) return TECH.locked;
      }
    }
  }
  if (maxTech >= TECH.nakedPair) {
    for (const cells of g.units) {
      const open = cells.filter((i) => !values[i]);
      for (let a = 0; a < open.length; a++) {
        const m = cand[open[a]!]!;
        if (popcount(m) !== 2) continue;
        for (let b = a + 1; b < open.length; b++) {
          if (cand[open[b]!] !== m) continue;
          let hit = false;
          for (const j of open) {
            if (j !== open[a] && j !== open[b] && cand[j]! & m) {
              cand[j]! &= ~m;
              hit = true;
            }
          }
          if (hit) return TECH.nakedPair;
        }
      }
    }
  }
  if (maxTech >= TECH.hiddenPair) {
    for (const cells of g.units) {
      const open = cells.filter((i) => !values[i]);
      const homes = new Map<number, number[]>();
      for (let d = 1; d <= n; d++) {
        const where = open.filter((i) => cand[i]! & bit(d));
        if (where.length === 2) homes.set(d, where);
      }
      const ds = [...homes.keys()];
      for (let a = 0; a < ds.length; a++) {
        for (let b = a + 1; b < ds.length; b++) {
          const wa = homes.get(ds[a]!)!;
          const wb = homes.get(ds[b]!)!;
          if (wa[0] !== wb[0] || wa[1] !== wb[1]) continue;
          const keep = bit(ds[a]!) | bit(ds[b]!);
          let hit = false;
          for (const i of wa) {
            if (cand[i]! & ~keep) {
              cand[i]! &= keep;
              hit = true;
            }
          }
          if (hit) return TECH.hiddenPair;
        }
      }
    }
  }
  return 0;
}

/** Places `digit` in `cell` and strikes it from the peers' candidates. */
function place(g: Geometry, values: Int8Array, cand: Uint16Array, cell: number, digit: number): void {
  values[cell] = digit;
  cand[cell] = 0;
  for (const p of g.peers[cell]!) cand[p]! &= ~bit(digit);
}

/** Singles from the working candidates (which may already carry eliminations). */
function nextSingle(g: Geometry, values: Int8Array, cand: Uint16Array): Placement | null {
  const all = singles(g, values, cand);
  return all[0] ?? null;
}

/**
 * Solves as far as the techniques up to `maxTech` reach. Each round takes the easiest placement on the board;
 * only when there is none does it look for an elimination.
 */
export function solve(g: Geometry, givens: ArrayLike<number>, maxTech: number = TECH.hiddenPair): SolveResult {
  const values = Int8Array.from(givens as ArrayLike<number>);
  const cand = candidates(g, values);
  const placements: Placement[] = [];
  let hardest = 0;
  let eliminations = 0;
  let empty = 0;
  for (let i = 0; i < g.cells; i++) if (!values[i]) empty++;
  // Elimination level reached since the last placement: a single found only after a pair counts as a pair.
  let pending = 0;
  while (empty > 0) {
    const s = nextSingle(g, values, cand);
    if (s && s.tech <= maxTech) {
      const tech = Math.max(s.tech, pending) as Tech;
      // A naked single that only shows after eliminations is graded by the elimination that revealed it.
      place(g, values, cand, s.cell, s.digit);
      placements.push({ ...s, tech });
      hardest = Math.max(hardest, tech);
      pending = 0;
      empty--;
      continue;
    }
    const t = eliminate(g, values, cand, maxTech);
    if (!t) break;
    // Contradiction (no candidate left): the grid is not solvable from here.
    for (let i = 0; i < g.cells; i++) if (!values[i] && !cand[i]) return { solved: false, placements, hardest, eliminations, values };
    eliminations++;
    pending = Math.max(pending, t);
  }
  return { solved: empty === 0, placements, hardest, eliminations, values };
}

/**
 * The easiest placement available from this position (the idle nudge, the lamp's fallback): a single if one
 * shows, else whatever the full solver finds first. Null when even that is stuck (never on a dealt grid).
 */
export function easiest(g: Geometry, values: ArrayLike<number>): Placement | null {
  const s = singles(g, values);
  if (s.length) return s[0]!;
  const r = solve(g, values);
  return r.placements[0] ?? null;
}

/** Digits each empty key can take from the placed digits alone, as lists (the pencil marks). */
export function pencil(g: Geometry, values: ArrayLike<number>): number[][] {
  const c = candidates(g, values);
  return Array.from(c, (m) => digitsOf(m));
}
