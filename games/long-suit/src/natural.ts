/**
 * Natural play: the taps anyone makes without thinking ahead. A card home, a run moved to turn up the card under
 * it, the drawn card laid on a column, a column cleared for the pack's top card; failing all of those, the pack.
 *
 * The dealer only hands out deals that natural play wins whichever of those taps comes first, so a deal is never
 * lost by playing what fits; the pilots look for the same plays.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { canBuild, canHome, cloneTable, hidden, rankOf, settle, sweepOne, tapColumn, tapStock, tapWaste, won, type Step, type Table } from "./cards.ts";

export type Target = { kind: "col"; col: number; index: number } | { kind: "waste" } | { kind: "stock" };

/** The plays a careful player looks for, best first. Empty when only the pack is left to try. */
export function plays(t: Table): Target[] {
  const out: Target[] = [];
  t.cols.forEach((c, col) => {
    const top = c.up[c.up.length - 1];
    if (top !== undefined && canHome(t, top)) out.push({ kind: "col", col, index: c.up.length - 1 });
  });
  const w = t.waste[t.waste.length - 1];
  if (w !== undefined && canHome(t, w)) out.push({ kind: "waste" });
  // Runs that would turn up a card, the deepest pile first.
  const turning = t.cols
    .map((c, col) => ({ c, col }))
    .filter(({ c }) => c.down.length > 0 && c.up.length > 0)
    .sort((a, b) => b.c.down.length - a.c.down.length);
  for (const { c, col } of turning) {
    for (let to = 0; to < t.cols.length; to++) {
      if (to !== col && canBuild(t, c.up[0]!, to)) {
        out.push({ kind: "col", col, index: 0 });
        break;
      }
    }
  }
  if (w !== undefined && !canHome(t, w)) {
    for (let to = 0; to < t.cols.length; to++) {
      if (canBuild(t, w, to)) {
        out.push({ kind: "waste" });
        break;
      }
    }
  }
  // A column with nothing under it moved aside, when the pack's top card is waiting for the space.
  const top = t.ranks - 1;
  if (w !== undefined && rankOf(w) === top && !t.cols.some((c) => c.up.length === 0)) {
    for (let col = 0; col < t.cols.length; col++) {
      const c = t.cols[col]!;
      if (c.down.length > 0 || c.up.length === 0 || rankOf(c.up[0]!) === top) continue;
      if (t.cols.some((d, to) => to !== col && d.up.length > 0 && canBuild(t, c.up[0]!, to))) {
        out.push({ kind: "col", col, index: 0 });
        break;
      }
    }
  }
  return out;
}

/** Makes a tap on a table the way the game does: the move, then whatever goes home of its own accord. */
export function tapTable(t: Table, target: Target): Step[] {
  const steps = target.kind === "col" ? tapColumn(t, target.col, target.index) : target.kind === "waste" ? tapWaste(t) : tapStock(t);
  if (steps.length) settle(t, steps);
  return steps;
}

/**
 * Plays a copy of the table by natural play to the end: the first play on the list each time, or (with `rng`) any
 * of them at random. Returns the taps made if the deal was won, null if a whole pass through the pack turned up
 * nothing to play.
 */
export function playout(table: Table, rng: Rng | null = null): Target[] | null {
  const t = cloneTable(table);
  const taps: Target[] = [];
  let fruitless = 0;
  for (let guard = 0; guard < 2000; guard++) {
    if (won(t)) return taps;
    if (hidden(t) === 0) {
      // Nothing face down: the rest goes home by itself.
      while (sweepOne(t, [])) {
        /* sweep */
      }
      return taps;
    }
    const options = plays(t);
    let target: Target = { kind: "stock" };
    if (options.length) target = rng ? rng.pick(options) : options[0]!;
    const steps = tapTable(t, target);
    taps.push(target);
    if (target.kind === "stock") {
      fruitless++;
      if (steps.length === 0 || fruitless > t.stock.length + t.waste.length + 1) return null;
    } else {
      if (steps.length === 0) return null;
      fruitless = 0;
    }
  }
  return null;
}
