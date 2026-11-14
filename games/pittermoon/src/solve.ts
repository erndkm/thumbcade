/**
 * A solver for the tests: is a group of lanes crossable at all? A time-expanded search over (row, x, time) in 1/30 s
 * steps, with the real hop lengths and the same bump, soak and sink rules as the run, from the safe row below the
 * group to the safe row above it. It may wait, hop up or sidestep at any step (a perfect player), so "no way across"
 * means the hill itself is unfair, not the player.
 */
import { RULES } from "./run.ts";
import { boatAt, colOf, COLS, colX, isHazard, laneHit, toadUp, type Row, type World } from "./world.ts";

const DT = 1 / 30;
const HOP_STEPS = Math.ceil(RULES.hop / DT);
const SIDE_STEPS = Math.ceil(RULES.side / DT);
const LO = colX(0) - RULES.edge;
const HI = colX(COLS - 1) + RULES.edge;

function safe(row: Row, x: number, t: number, landed: boolean): boolean {
  if (row.kind === "path") return row.block[colOf(x)]! < 0;
  if (isHazard(row.kind)) return !laneHit(row, x, t);
  if (!landed) return true;
  if (row.kind === "brook") return boatAt(row, x, t) >= 0;
  return toadUp(row, colOf(x), t);
}

const ride = (row: Row) => (row.kind === "brook" ? row.dir * row.speed : 0);

/**
 * Seconds a perfect player needs to cross from path row `from` (standing in any free column at time t0) to the next
 * path row above it, or Infinity if there is no way across within `horizon` seconds.
 */
export function crossTime(world: World, from: number, t0: number, horizon = 12): number {
  const rows: Row[] = [];
  for (let i = from; ; i++) {
    const r = world.row(i);
    rows.push(r);
    if (i > from && r.kind === "path") break;
    if (rows.length > 8) return Infinity;
  }
  const goal = rows.length - 1;
  const steps = Math.ceil(horizon / DT);
  // Frontier per step: (row offset, x) pairs.
  const seen = new Set<string>();
  let frontier: Array<[number, number]> = [];
  for (let c = 0; c < COLS; c++) if (rows[0]!.block[c]! < 0) frontier.push([0, colX(c)]);
  const later = new Map<number, Array<[number, number]>>();
  const push = (s: number, r: number, x: number) => {
    const key = `${s}|${r}|${Math.round(x * 2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    let l = later.get(s);
    if (!l) later.set(s, (l = []));
    l.push([r, x]);
  };
  for (let s = 0; s < steps; s++) {
    const t = t0 + s * DT;
    const next = later.get(s);
    if (next) {
      frontier = frontier.concat(next);
      later.delete(s);
    }
    const cur = frontier;
    frontier = [];
    for (const [r, x] of cur) {
      if (r === goal) return s * DT;
      const row = rows[r]!;
      const v = ride(row);
      // Wait a step.
      const xw = Math.max(LO, Math.min(HI, x + v * DT));
      if (safe(row, xw, t + DT, true)) {
        const key = `${s + 1}|${r}|${Math.round(xw * 2)}`;
        if (!seen.has(key)) {
          seen.add(key);
          frontier.push([r, xw]);
        }
      }
      // Hop up.
      const up = rows[r + 1]!;
      const ux = up.kind === "brook" ? x : colX(colOf(x));
      if (!(up.kind === "path" && up.block[colOf(x)]! >= 0)) {
        let ok = true;
        for (let k = 1; k <= HOP_STEPS && ok; k++) {
          const tk = t + k * DT;
          const p = (k * DT) / RULES.hop;
          if (p < 0.3) ok = safe(row, x, tk, false);
          else if (p > 0.7) ok = safe(up, ux, tk, k === HOP_STEPS);
        }
        if (ok) push(s + HOP_STEPS, r + 1, ux);
      }
      // Sidestep either way.
      for (const dir of [-1, 1]) {
        let to: number;
        if (row.kind === "brook") {
          to = x + dir * 14;
          if (to < LO || to > HI) continue;
        } else {
          const c = colOf(x) + dir;
          if (c < 0 || c >= COLS || (row.kind === "path" && row.block[c]! >= 0)) continue;
          to = colX(c);
        }
        let ok = true;
        for (let k = 1; k <= SIDE_STEPS && ok; k++) {
          const tk = t + k * DT;
          const p = (k * DT) / RULES.side;
          const xx = (p < 0.5 ? x : to) + v * k * DT;
          ok = safe(row, xx, tk, k === SIDE_STEPS);
        }
        if (ok) push(s + SIDE_STEPS, r, to + v * SIDE_STEPS * DT);
      }
    }
    if (!frontier.length && !later.size) return Infinity;
  }
  return Infinity;
}
