/**
 * Dealing in reverse. The wall is laid out first, with no colours. Then the dealer pulls its pegs in a random order
 * that only ever takes a free one (the way a hand would clear it, top layers first more often than not), and hands
 * out colours along that order against the real jar line-up so that playing it back never holds more than a few pegs
 * on the shelf. That order is the deal's witness: every wall that reaches a player can be cleared. On later walls a
 * share of the colours is then swapped at random, and the wall is kept only if the solver still clears it.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { drain, freePegs, layoutSteps, type Plan, type Wall } from "./board.ts";
import { type JarRules, ranks, shelfAfter, solve } from "./solve.ts";

/** Jars open at the top at once, and the shelf's slots. */
export const DOCKS = 2;
export const SHELF = 5;

export interface Deal {
  wall: Wall;
  /** Jar colours in the order they arrive. */
  queue: number[];
  /** Peg ids in an order that clears the wall with the real jars and shelf. */
  witness: number[];
  /** Whether the colours were scattered after dealing. */
  scattered: boolean;
}

/** A random order of pulling every peg that only ever pulls a free one (resting poses). */
export function pullOrder(wall: Wall, rng: Rng): number[] {
  const left = new Uint8Array(wall.pegs.length).fill(1);
  const order: number[] = [];
  while (order.length < wall.pegs.length) {
    const free = freePegs(wall, left);
    let pick = free[Math.floor(rng() * free.length)]!;
    if (rng() < 0.45) for (const id of free) if (wall.dishes[wall.pegs[id]!.dish]!.layer > wall.dishes[wall.pegs[pick]!.dish]!.layer) pick = id;
    // Finishing the dish already started is what hands do, too.
    if (rng() < 0.35) {
      const started = free.find((id) => {
        const d = wall.dishes[wall.pegs[id]!.dish]!;
        const n = d.pegs.filter((p) => left[p]).length;
        return n < d.pegs.length;
      });
      if (started !== undefined) pick = started;
    }
    left[pick] = 0;
    order.push(pick);
  }
  return order;
}

/** The jar line-up: `jars` jars over `colors` colours, every colour at least once, the first two different. */
export function jarQueue(jars: number, colors: number, rng: Rng): number[] {
  const k = Math.min(colors, jars);
  const pool = rng.shuffle([0, 1, 2, 3, 4, 5]).slice(0, k);
  const q: number[] = [...pool];
  while (q.length < jars) q.push(rng.pick(pool));
  rng.shuffle(q);
  if (q.length > 1 && q[0] === q[1]) {
    const j = q.findIndex((c) => c !== q[0]);
    if (j > 0) [q[1], q[j]] = [q[j]!, q[1]!];
  }
  return q;
}

/**
 * Hands out colours along `order`: each peg goes to an open jar, or (now and then, while the shelf has room under
 * `cap`) to the shelf for a jar further down the line. Returns the colours in order, or null if it got stuck.
 */
export function assignColors(order: readonly number[], rules: JarRules, cap: number, spread: number, rng: Rng): number[] | null {
  const rank = ranks(rules.queue);
  const want = new Uint8Array(6);
  for (const c of rules.queue) want[c]! += 3;
  const counts = new Uint8Array(6);
  const out: number[] = [];
  let shelf = 0;
  for (let step = 0; step < order.length; step++) {
    const direct: number[] = [];
    const later: number[] = [];
    for (let c = 0; c < 6; c++) {
      if (counts[c]! >= want[c]!) continue;
      counts[c]!++;
      const s = shelfAfter(rules, counts, rank);
      counts[c]!--;
      if (s <= shelf) direct.push(c);
      else if (s <= cap) later.push(c);
    }
    let c: number;
    if (later.length && (rng() < spread || !direct.length)) c = rng.pick(later);
    else if (direct.length) c = rng.pick(direct);
    else return null;
    counts[c]!++;
    shelf = shelfAfter(rules, counts, rank);
    out.push(c);
  }
  return out;
}

/** Deals wall `plan.board`. Deterministic for a given rng state. */
export function dealWall(plan: Plan, rng: Rng, limit = 1500): Deal {
  return drain(dealSteps(plan, rng, limit));
}

/** `dealWall` in small steps, with the same result: a game deals the next wall a little each frame. */
export function* dealSteps(plan: Plan, rng: Rng, limit = 1500): Generator<void, Deal> {
  for (;;) {
    const wall: Wall = yield* layoutSteps(plan, rng);
    const jars = wall.pegs.length / 3;
    const queue = jarQueue(jars, plan.colors, rng);
    const rules: JarRules = { queue, docks: DOCKS, cap: SHELF };
    const order = pullOrder(wall, rng);
    const colors = assignColors(order, rules, plan.witnessCap, plan.spread, rng);
    if (!colors) continue;
    order.forEach((id, i) => (wall.pegs[id]!.color = colors[i]!));
    const swaps = Math.round(wall.pegs.length * plan.scatter);
    if (swaps > 0) {
      const dealt = wall.pegs.map((p) => p.color);
      for (let attempt = 0; attempt < 4; attempt++) {
        for (let i = 0; i < swaps; i++) {
          const a = rng.pick(wall.pegs);
          const b = rng.pick(wall.pegs);
          [a.color, b.color] = [b.color, a.color];
        }
        yield;
        const path = solve(wall, rules, limit);
        if (path) return { wall, queue, witness: path, scattered: true };
        wall.pegs.forEach((p, i) => (p.color = dealt[i]!));
      }
    }
    return { wall, queue, witness: order, scattered: false };
  }
}
