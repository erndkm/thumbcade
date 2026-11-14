/**
 * The jar and shelf rules as counts, and a solver that plays them. Jars come in a fixed order; the first `docks` jars
 * not yet shipped stand open at the top. A pulled peg goes into the earliest open jar of its colour, or onto the shelf;
 * a jar that has three ships and the next one in line takes its place, pulling its colour off the shelf. Pegs of a
 * colour fill that colour's jars in order, so where everything is follows from how many pegs of each colour have been
 * pulled, whatever the order: the solver can remember positions by the set of pegs pulled.
 */
import { coveredAtRest, freePegs, type Wall } from "./board.ts";

export interface JarRules {
  /** Colour of each jar, in the order they arrive. */
  queue: readonly number[];
  /** Jars open at once. */
  docks: number;
  /** Shelf slots. */
  cap: number;
}

/** Pegs on the shelf after `counts[c]` pegs of each colour c have been pulled. */
export function shelfAfter(rules: JarRules, counts: ArrayLike<number>, rank: readonly number[]): number {
  const q = rules.queue;
  const shipped = new Uint8Array(q.length);
  const assigned = (j: number) => Math.max(0, Math.min(3, counts[q[j]!]! - 3 * rank[j]!));
  for (let changed = true; changed; ) {
    changed = false;
    let open = 0;
    for (let j = 0; j < q.length && open < rules.docks; j++) {
      if (shipped[j]) continue;
      open++;
      if (assigned(j) === 3) {
        shipped[j] = 1;
        changed = true;
      }
    }
  }
  // Pegs that are in a jar: the shipped ones and the open ones.
  let inJars = 0;
  let open = 0;
  let pulled = 0;
  for (let j = 0; j < q.length; j++) {
    if (shipped[j]) inJars += 3;
    else if (open < rules.docks) {
      open++;
      inJars += assigned(j);
    }
  }
  for (let c = 0; c < counts.length; c++) pulled += counts[c]!;
  return pulled - inJars;
}

/** For each jar, how many jars of its colour come before it. */
export function ranks(queue: readonly number[]): number[] {
  const seen = new Map<number, number>();
  return queue.map((c) => {
    const r = seen.get(c) ?? 0;
    seen.set(c, r + 1);
    return r;
  });
}

const colorsOf = (wall: Wall) => 1 + wall.pegs.reduce((m, p) => Math.max(m, p.color), 0);

/** Plays `order` and reports whether it clears the wall without the shelf overflowing, and the fullest it got. */
export function playsOut(wall: Wall, rules: JarRules, order: readonly number[]): { ok: boolean; peak: number } {
  const left = new Uint8Array(wall.pegs.length).fill(1);
  const counts = new Uint8Array(Math.max(6, colorsOf(wall)));
  const rank = ranks(rules.queue);
  let peak = 0;
  for (const id of order) {
    if (!left[id] || coveredAtRest(wall, left, id)) return { ok: false, peak };
    left[id] = 0;
    counts[wall.pegs[id]!.color]!++;
    const s = shelfAfter(rules, counts, rank);
    peak = Math.max(peak, s);
    if (s > rules.cap) return { ok: false, peak };
  }
  return { ok: left.every((v) => v === 0) && order.length === wall.pegs.length, peak };
}

/**
 * Depth-first search for an order that clears the wall with these jars and this shelf, from the start. Tries the
 * pegs that keep the shelf emptiest first, then pegs on higher layers. Positions are remembered by the set of pegs
 * pulled. Returns the order, or null if there is none within `limit` positions.
 */
export function solve(wall: Wall, rules: JarRules, limit = 200_000): number[] | null {
  const n = wall.pegs.length;
  const left = new Uint8Array(n).fill(1);
  const counts = new Uint8Array(Math.max(6, colorsOf(wall)));
  const rank = ranks(rules.queue);
  const bit = Array.from({ length: n }, (_, i) => 2 ** i);
  const seen = new Set<number>();
  const path: number[] = [];
  let visits = 0;
  let mask = 0;
  const go = (): boolean => {
    if (path.length === n) return true;
    if (seen.has(mask) || ++visits > limit) return false;
    seen.add(mask);
    const free = freePegs(wall, left);
    const opts: Array<{ id: number; shelf: number; layer: number }> = [];
    for (const id of free) {
      const c = wall.pegs[id]!.color;
      counts[c]!++;
      const s = shelfAfter(rules, counts, rank);
      counts[c]!--;
      if (s <= rules.cap) opts.push({ id, shelf: s, layer: wall.dishes[wall.pegs[id]!.dish]!.layer });
    }
    opts.sort((a, b) => a.shelf - b.shelf || b.layer - a.layer);
    for (const o of opts) {
      const c = wall.pegs[o.id]!.color;
      left[o.id] = 0;
      counts[c]!++;
      mask += bit[o.id]!;
      path.push(o.id);
      if (go()) return true;
      path.pop();
      mask -= bit[o.id]!;
      counts[c]!--;
      left[o.id] = 1;
    }
    return false;
  };
  return go() ? path.slice() : null;
}
