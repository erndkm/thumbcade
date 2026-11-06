/**
 * The heap: printed slips lying in layers. Positions are in half-slip units, so a slip on the layer above can sit
 * square on one below or straddle four of them. A slip is free when nothing on a higher layer overlaps it; only free
 * slips can be lifted. Pure: no DOM, no clock.
 */
import type { Rng } from "@thumbcade-games/kit/rng";

/** Slips across the widest row of a heap. The heap is 2·COLS half-units wide. */
export const COLS = 6;
/** Slips down the tallest column. */
export const ROWS = 7;
/** Half-unit extents: x in 0..XMAX, y in 0..YMAX (a slip covers [x, x+2) × [y, y+2)). */
export const XMAX = COLS * 2 - 2;
export const YMAX = ROWS * 2 - 2;

export interface Slot {
  x: number;
  y: number;
  z: number;
}

export interface Slip extends Slot {
  id: number;
  type: number;
  /** Lifted off the heap (in the tray or sealed). */
  gone: boolean;
}

export const overlaps = (a: Slot, b: Slot): boolean => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;

/** For every slip, the ids of the slips above it that overlap it. */
export function coverMap(slots: readonly Slot[]): number[][] {
  const above: number[][] = slots.map(() => []);
  for (let i = 0; i < slots.length; i++) {
    for (let j = 0; j < slots.length; j++) {
      if (slots[j]!.z > slots[i]!.z && overlaps(slots[i]!, slots[j]!)) above[i]!.push(j);
    }
  }
  return above;
}

/** A heap's shape for the n-th sheet of a run. */
export interface Plan {
  tiles: number;
  layers: number;
  types: number;
  /** Most slips the dealer's own solution ever holds in the tray at once. */
  witnessCap: number;
  /** How readily the dealer starts a new kind before closing an open one (0-1): higher hides the triples deeper. */
  spread: number;
}

/** Sheets grow wider and deeper, and bring in more kinds of slip. */
export const PLANS: readonly Plan[] = [
  { tiles: 12, layers: 2, types: 4, witnessCap: 4, spread: 0.1 },
  { tiles: 18, layers: 2, types: 5, witnessCap: 4, spread: 0.4 },
  { tiles: 24, layers: 3, types: 6, witnessCap: 5, spread: 0.55 },
  { tiles: 30, layers: 3, types: 7, witnessCap: 5, spread: 0.65 },
  { tiles: 36, layers: 4, types: 8, witnessCap: 6, spread: 0.7 },
  { tiles: 42, layers: 4, types: 9, witnessCap: 6, spread: 0.75 },
  { tiles: 45, layers: 5, types: 10, witnessCap: 6, spread: 0.8 },
  { tiles: 48, layers: 5, types: 11, witnessCap: 6, spread: 0.8 },
];

export const planFor = (sheet: number): Plan => PLANS[Math.min(PLANS.length - 1, Math.max(0, sheet - 1))]!;

/** How many slips each layer takes: the lower layers hold the most. */
function shares(total: number, layers: number): number[] {
  const w = Array.from({ length: layers }, (_, k) => layers - k + 1.2);
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((v) => Math.floor((total * v) / sum));
  let left = total - out.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k = (k + 1) % layers, left--) out[k]!++;
  return out;
}

const mirrorX = (x: number) => XMAX - x;
const key = (x: number, y: number, z: number) => (z * 64 + y) * 64 + x;

/**
 * Lays out `plan.tiles` slips in `plan.layers` layers, mirrored left to right where it can be. Layer 0 sits on the
 * even grid; odd layers straddle the corners of the layer below; even layers above 0 sit square on it again. A slip
 * above layer 0 always rests on at least two slips below (one when it sits square), so the heap looks like it could
 * have been dropped there.
 */
export function layoutHeap(plan: Plan, rng: Rng): Slot[] {
  for (let attempt = 0; attempt < 40; attempt++) {
    const slots = tryLayout(plan, rng);
    if (slots) return slots;
  }
  // Never reached in practice: fall back to a plain grid of the right size.
  const out: Slot[] = [];
  for (let i = 0; i < plan.tiles; i++) out.push({ x: (i % COLS) * 2, y: Math.floor(i / COLS) * 2, z: Math.floor(i / (COLS * ROWS)) });
  return out;
}

function tryLayout(plan: Plan, rng: Rng): Slot[] | null {
  const want = shares(plan.tiles, plan.layers);
  const taken = new Set<number>();
  const slots: Slot[] = [];
  const at = (x: number, y: number, z: number) => taken.has(key(x, y, z));
  const add = (x: number, y: number, z: number) => {
    taken.add(key(x, y, z));
    slots.push({ x, y, z });
  };
  // How far the heap spreads: small sheets keep to the middle of the page.
  // (The even grid has no centre column, so a mirrored layer 0 is 2, 4 or 6 slips wide.)
  const spanX = plan.tiles <= 18 ? 4 : COLS;
  const spanY = plan.tiles <= 12 ? 3 : plan.tiles <= 18 ? 4 : plan.tiles <= 24 ? 5 : plan.tiles <= 36 ? 6 : ROWS;
  const y0 = 2 * Math.floor((ROWS - spanY) / 2);
  const supported = (x: number, y: number, z: number) => {
    if (z === 0) return Math.abs(x - XMAX / 2) <= spanX - 1 && y >= y0 && y <= y0 + spanY * 2 - 2;
    let n = 0;
    for (const s of slots) if (s.z === z - 1 && overlaps(s, { x, y, z })) n++;
    return n >= 2 || slots.some((s) => s.z === z - 1 && s.x === x && s.y === y);
  };
  for (let z = 0; z < plan.layers; z++) {
    const odd = z % 2 === 1;
    const cands: Array<{ x: number; y: number; w: number }> = [];
    for (let y = 0; y <= YMAX; y++) {
      for (let x = 0; x <= XMAX / 2; x++) {
        if (odd ? x % 2 === 0 || y % 2 === 0 : x % 2 === 1 || y % 2 === 1) continue;
        if (at(x, y, z) || !supported(x, y, z)) continue;
        let support = 2;
        if (z > 0) {
          support = 0;
          for (const s of slots) if (s.z === z - 1 && overlaps(s, { x, y, z })) support++;
        }
        // Weighted toward the middle of the page and toward well-supported spots.
        const dx = Math.abs(x - XMAX / 2) / (XMAX / 2);
        const dy = Math.abs(y - YMAX / 2) / (YMAX / 2);
        cands.push({ x, y, w: (1.4 - 0.7 * dx - 0.5 * dy) * (0.6 + 0.2 * support) });
      }
    }
    let need = want[z]!;
    while (need > 0 && cands.length) {
      let total = 0;
      for (const c of cands) total += c.w;
      let r = rng() * total;
      let i = 0;
      for (; i < cands.length - 1; i++) {
        r -= cands[i]!.w;
        if (r <= 0) break;
      }
      const c = cands.splice(i, 1)[0]!;
      const mx = mirrorX(c.x);
      if (mx === c.x) {
        add(c.x, c.y, z);
        need--;
      } else if (need >= 2 && supported(mx, c.y, z) && !at(mx, c.y, z)) {
        add(c.x, c.y, z);
        add(mx, c.y, z);
        need -= 2;
      } else {
        // One left: a slip on the centre line if there is one, otherwise a lone slip off it.
        const centre = cands.findIndex((k) => mirrorX(k.x) === k.x);
        if (centre >= 0) {
          const k = cands.splice(centre, 1)[0]!;
          add(k.x, k.y, z);
        } else add(c.x, c.y, z);
        need--;
      }
    }
    // Whatever this layer couldn't hold moves up to the next one.
    if (need > 0) {
      if (z + 1 < plan.layers) want[z + 1]! += need;
      else return null;
    }
  }
  return slots.length === plan.tiles ? slots : null;
}

/** Ids of the slips still on the heap with nothing above them. */
export function freeSlips(slips: readonly Slip[], above: readonly number[][]): number[] {
  const out: number[] = [];
  for (const s of slips) if (!s.gone && isFree(slips, above, s.id)) out.push(s.id);
  return out;
}

export function isFree(slips: readonly Slip[], above: readonly number[][], id: number): boolean {
  if (slips[id]!.gone) return false;
  for (const j of above[id]!) if (!slips[j]!.gone) return false;
  return true;
}
