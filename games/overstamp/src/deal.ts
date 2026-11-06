/**
 * Dealing in reverse. A heap is laid out first; then the dealer lifts its slips off in a random order that only
 * ever takes a free slip, and hands out the kinds along that order so that playing it back never holds more than
 * `cap` slips in the tray. That order is the deal's witness: every sheet that reaches a player can be cleared.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { coverMap, layoutHeap, type Plan, type Slip, type Slot } from "./board.ts";

/** Slots in the tray. Seven slips without three alike among them fills it. */
export const TRAY = 7;

export interface Deal {
  slips: Slip[];
  above: number[][];
  /** Ids in an order that clears the sheet. */
  witness: number[];
}

/** A random order of lifting every slip that only ever lifts a free one. */
export function liftOrder(slots: readonly Slot[], above: readonly number[][], rng: Rng, ids?: readonly number[]): number[] {
  const left = new Set<number>(ids ?? slots.map((_, i) => i));
  const order: number[] = [];
  while (left.size) {
    const free: number[] = [];
    for (const i of left) if (above[i]!.every((j) => !left.has(j))) free.push(i);
    // A light pull toward the top of the heap, the way a hand clears it.
    let pick = free[Math.floor(rng() * free.length)]!;
    if (rng() < 0.4) for (const i of free) if (slots[i]!.z > slots[pick]!.z) pick = i;
    order.push(pick);
    left.delete(pick);
  }
  return order;
}

/**
 * Hands out kinds along `order`. `triples[k]` is how many whole triples of kind k still go on the heap; `open` maps a
 * kind to how many of it already sit in the tray (1 or 2), and each of those needs 3 − n more from the heap first.
 * Returns the kind for each slip of `order`, or null if the tray as it stands can't be played out.
 */
export function assignKinds(order: readonly number[], triples: number[], open: Map<number, number>, cap: number, rng: Rng, spread = 0.45): number[] | null {
  const pending = triples.slice();
  const tray = new Map(open);
  let fill = 0;
  for (const n of tray.values()) fill += n;
  const kinds: number[] = [];
  for (let step = 0; step < order.length; step++) {
    const openKinds = [...tray.keys()];
    const fresh: number[] = [];
    for (let k = 0; k < pending.length; k++) if (pending[k]! > 0 && !tray.has(k)) fresh.push(k);
    const mustClose = fill >= cap - 1 || fresh.length === 0;
    let kind: number;
    if (openKinds.length && (mustClose || rng() >= spread)) {
      // Close the fullest open kind first when the tray is tight; otherwise any of them.
      openKinds.sort((a, b) => tray.get(b)! - tray.get(a)!);
      kind = mustClose ? openKinds[0]! : openKinds[Math.floor(rng() * openKinds.length)]!;
    } else if (fresh.length) {
      kind = fresh[Math.floor(rng() * fresh.length)]!;
      pending[kind]!--;
    } else return null;
    const n = (tray.get(kind) ?? 0) + 1;
    if (n === 3) {
      tray.delete(kind);
      fill -= 2;
    } else {
      // Seven without a triple is a full tray.
      if (fill + 1 >= TRAY) return null;
      tray.set(kind, n);
      fill++;
    }
    kinds.push(kind);
  }
  return tray.size === 0 && pending.every((p) => p === 0) ? kinds : null;
}

/** How many triples of each of `types` kinds a heap of `tiles` slips gets: every kind at least one. */
export function tripleCounts(tiles: number, types: number, rng: Rng): number[] {
  const n = tiles / 3;
  const out = Array.from({ length: types }, () => 1);
  for (let i = types; i < n; i++) out[Math.floor(rng() * types)]!++;
  return out;
}

/** Which kinds a sheet uses: the first sheets take the plainest, most different marks. */
export function kindsFor(types: number, rng: Rng, pool = 12): number[] {
  const easy = [0, 1, 2, 3];
  const rest = Array.from({ length: pool - easy.length }, (_, i) => i + easy.length);
  rng.shuffle(rest);
  const all = [...easy, ...rest].slice(0, types);
  return rng.shuffle(all);
}

/**
 * Deals a sheet for `plan`. The kinds are scattered over the heap (a share of them, `plan.spread`, at random; the
 * rest along a lifting order so the opening isn't a wall), and the sheet is only kept if the solver finds a way to
 * clear it with the tray. That way is kept as the deal's witness. Deterministic for a given rng state.
 */
export function dealSheet(plan: Plan, rng: Rng): Deal {
  for (let attempt = 0; ; attempt++) {
    const slots = layoutHeap(plan, rng);
    const above = coverMap(slots);
    const order = liftOrder(slots, above, rng);
    const kinds = kindsFor(plan.types, rng);
    const counts = tripleCounts(plan.tiles, plan.types, rng);
    const local = assignKinds(order, counts, new Map(), plan.witnessCap, rng, 0.5);
    if (!local) continue;
    const slips: Slip[] = slots.map((s, id) => ({ ...s, id, type: 0, gone: false }));
    order.forEach((id, i) => (slips[id]!.type = kinds[local[i]!]!));
    // Scatter: swap the kinds of random pairs of slips.
    const swaps = Math.round(plan.tiles * plan.spread);
    for (let i = 0; i < swaps; i++) {
      const a = Math.floor(rng() * slips.length);
      const b = Math.floor(rng() * slips.length);
      [slips[a]!.type, slips[b]!.type] = [slips[b]!.type, slips[a]!.type];
    }
    const path = solve(slips, above, [], 3000);
    if (path) return { slips, above, witness: path };
    if (attempt >= 8) return { slips: slots.map((s, id) => ({ ...s, id, type: kinds[local[order.indexOf(id)]!]!, gone: false })), above, witness: order };
  }
}

/**
 * Re-deals the kinds of the slips still on the heap so the sheet can be cleared from the tray as it stands (the
 * riffle). Keeps the same multiset of kinds. Returns false, and changes nothing, if no order can save this tray.
 */
export function riffleSheet(slips: Slip[], above: readonly number[][], tray: readonly number[], rng: Rng): boolean {
  const live = slips.filter((s) => !s.gone).map((s) => s.id);
  if (!live.length) return false;
  const kinds = [...new Set([...live.map((id) => slips[id]!.type), ...tray])];
  const index = new Map(kinds.map((k, i) => [k, i]));
  const open = new Map<number, number>();
  for (const k of tray) open.set(index.get(k)!, (open.get(index.get(k)!) ?? 0) + 1);
  const onHeap = kinds.map(() => 0);
  for (const id of live) onHeap[index.get(slips[id]!.type)!]!++;
  const triples = onHeap.map((n, k) => (n - (open.has(k) ? 3 - open.get(k)! : 0)) / 3);
  if (triples.some((t) => t < 0 || !Number.isInteger(t))) return false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const order = liftOrder(slips, above, rng, live);
    const got = assignKinds(order, triples, open, TRAY - 1, rng);
    if (!got) continue;
    order.forEach((id, i) => (slips[id]!.type = kinds[got[i]!]!));
    return true;
  }
  return false;
}

/** Plays `order` from `tray` and reports whether every slip is lifted without the tray filling. */
export function playsOut(slips: readonly Slip[], above: readonly number[][], order: readonly number[], tray: readonly number[] = []): { ok: boolean; peak: number } {
  const gone = new Set<number>(slips.filter((s) => s.gone).map((s) => s.id));
  const counts = new Map<number, number>();
  let fill = 0;
  for (const k of tray) {
    counts.set(k, (counts.get(k) ?? 0) + 1);
    fill++;
  }
  let peak = fill;
  for (const id of order) {
    if (gone.has(id) || above[id]!.some((j) => !gone.has(j))) return { ok: false, peak };
    gone.add(id);
    const k = slips[id]!.type;
    const n = (counts.get(k) ?? 0) + 1;
    fill++;
    peak = Math.max(peak, fill);
    if (n === 3) {
      counts.delete(k);
      fill -= 3;
    } else {
      if (fill >= TRAY) return { ok: false, peak };
      counts.set(k, n);
    }
  }
  return { ok: gone.size === slips.length && fill === 0, peak };
}

/**
 * Depth-first solver with memo on the set of lifted slips (the tray follows from it). Tries slips that finish a triple
 * first, then pairs, then kinds with the most copies in reach. Returns a clearing order from this position, or null
 * if there is none within `limit` positions.
 */
export function solve(slips: readonly Slip[], above: readonly number[][], tray: readonly number[] = [], limit = 2_000_000): number[] | null {
  const n = slips.length;
  const gone = new Uint8Array(n);
  for (const s of slips) if (s.gone) gone[s.id] = 1;
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  for (const k of tray) counts.set(k, (counts.get(k) ?? 0) + 1);
  let fill = tray.length;
  let left = 0;
  for (let i = 0; i < n; i++) if (!gone[i]) left++;
  let visits = 0;
  const path: number[] = [];
  const maskKey = () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      if (!gone[i]) continue;
      if (i < 31) a |= 1 << i;
      else b |= 1 << (i - 31);
    }
    return `${a},${b}`;
  };
  const go = (): boolean => {
    if (left === 0) return fill === 0;
    const key = maskKey();
    if (seen.has(key) || ++visits > limit) return false;
    seen.add(key);
    const free: number[] = [];
    for (let i = 0; i < n; i++) if (!gone[i] && above[i]!.every((j) => gone[j])) free.push(i);
    const reach = new Map<number, number>();
    for (const i of free) reach.set(slips[i]!.type, (reach.get(slips[i]!.type) ?? 0) + 1);
    const rank = (i: number) => {
      const k = slips[i]!.type;
      return (counts.get(k) ?? 0) * 10 + (reach.get(k) ?? 0);
    };
    free.sort((x, y) => rank(y) - rank(x));
    for (const i of free) {
      const k = slips[i]!.type;
      const c = (counts.get(k) ?? 0) + 1;
      if (c < 3 && fill + 1 >= TRAY) continue;
      gone[i] = 1;
      left--;
      if (c === 3) counts.delete(k);
      else counts.set(k, c);
      fill += c === 3 ? -2 : 1;
      path.push(i);
      if (go()) return true;
      path.pop();
      fill -= c === 3 ? -2 : 1;
      if (c === 3) counts.set(k, 2);
      else if (c === 1) counts.delete(k);
      else counts.set(k, c - 1);
      left++;
      gone[i] = 0;
    }
    return false;
  };
  return go() ? path.slice() : null;
}
