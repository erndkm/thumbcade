/**
 * How a beetle that isn't steered by a thumb decides where to walk: rest a moment on its print, pick a way out with
 * room ahead, walk a rectangle and come home. It comes home early when another beetle gets near its wet line, and
 * the bolder ones go for somebody else's line when it is within reach. The rivals run on this; so do the pilots that
 * stand in for a thumb in the tests and the attract demo.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { beside, dirTo, N, steps } from "./grid.ts";
import type { Bug, Sim } from "./sim.ts";

export interface BrainSpec {
  name: string;
  /** Squares a second (rivals; a pilot walks at the player's speed). */
  speed: number;
  /** The sides of the rectangle it walks, [min, max] squares. */
  loop: [number, number];
  /** Seconds it rests on its own print between loops, [min, max]. */
  rest: [number, number];
  /** It heads home when another beetle is within this many steps of its wet line. */
  fear: number;
  /** It goes for another beetle's wet line within this many steps (0: never). */
  cut: number;
  /** It sizes each loop to how far away the nearest other beetle is (the rivals don't: they walk what they fancy). */
  wary?: boolean;
}

/** The rivals, from the first sheet's to the last: quicker, bolder, and readier to cut. */
export const RIVALS: BrainSpec[] = [
  { name: "timid", speed: 4.2, loop: [2, 3], rest: [0.9, 1.8], fear: 5, cut: 0 },
  { name: "plain", speed: 4.8, loop: [2, 4], rest: [0.6, 1.3], fear: 4, cut: 0 },
  { name: "bold", speed: 5.4, loop: [3, 5], rest: [0.4, 1.0], fear: 3, cut: 2 },
  { name: "sharp", speed: 6.0, loop: [3, 6], rest: [0.3, 0.8], fear: 3, cut: 3 },
  { name: "mean", speed: 6.6, loop: [3, 6], rest: [0.2, 0.6], fear: 2, cut: 4 },
];

/** Just enough of a beetle for a brain to think about (a pilot hands in the square the player is about to reach). */
export type Mind = Pick<Bug, "id" | "cell" | "line">;

export class Brain {
  private plan: number[] = [];
  private restUntil = 0;
  private homing = false;
  private readonly seen = new Int16Array(N);
  private readonly queue = new Int16Array(N);

  constructor(
    readonly spec: BrainSpec,
    private readonly rng: Rng,
  ) {}

  reset(): void {
    this.plan = [];
    this.homing = false;
    this.restUntil = 0;
  }

  /** The way to step from the beetle's square (-1: stay put for now). */
  choose(sim: Sim, b: Mind): number {
    const c = b.cell;
    const out = b.line.length > 0;
    if (!out) this.homing = false;
    else if (!this.homing && this.threat(sim, b) <= this.spec.fear) {
      this.homing = true;
      this.plan = this.pathTo(sim, b, (x) => sim.owner[x] === b.id, 99);
    }
    if (this.spec.cut > 0 && !this.homing && b.line.length <= 2) {
      const p = this.pathTo(sim, b, (x) => (b.id === 1 ? sim.wet[x]! > 1 : sim.wet[x] === 1), this.spec.cut);
      if (p.length) this.plan = p;
    }
    while (this.plan.length && this.plan[0] === c) this.plan.shift();
    let next = this.plan[0];
    if (next !== undefined && (dirTo(c, next) < 0 || sim.wet[next] === b.id)) {
      // Knocked off the plan (a late turn, a rival in the way): home if there is a line out, otherwise think again.
      this.plan = out ? this.pathTo(sim, b, (x) => sim.owner[x] === b.id, 99) : [];
      next = this.plan[0];
    }
    if (next === undefined) {
      if (out) this.plan = this.pathTo(sim, b, (x) => sim.owner[x] === b.id, 99);
      else {
        if (sim.tick < this.restUntil) return -1;
        this.plan = this.sortie(sim, b);
        this.restUntil = sim.tick + Math.round(this.rng.range(this.spec.rest[0], this.spec.rest[1]) * 120) + this.plan.length * 14;
      }
      next = this.plan[0];
    }
    return next === undefined ? -1 : dirTo(c, next);
  }

  /** Steps from the nearest other beetle to this one's wet line (or to the beetle itself). */
  private threat(sim: Sim, b: Mind): number {
    let near = 99;
    for (const o of sim.bugs) {
      if (o.id === b.id || !o.on) continue;
      const at = o.dir >= 0 && o.t > 0.5 ? beside(o.cell, o.dir) : o.cell;
      near = Math.min(near, steps(at, b.cell));
      for (const c of b.line) near = Math.min(near, steps(at, c));
    }
    return near;
  }

  /** The shortest way from the beetle's square to a square that passes `goal`, never across its own wet line. */
  private pathTo(sim: Sim, b: Mind, goal: (c: number) => boolean, reach: number): number[] {
    const seen = this.seen;
    const q = this.queue;
    seen.fill(-1);
    let head = 0;
    let tail = 0;
    seen[b.cell] = b.cell;
    q[tail++] = b.cell;
    let depth = 0;
    let levelEnd = 1;
    while (head < tail) {
      const c = q[head++]!;
      if (c !== b.cell && goal(c)) {
        const path: number[] = [];
        for (let x = c; x !== b.cell; x = seen[x]!) path.push(x);
        return path.reverse();
      }
      if (depth < reach) {
        for (let d = 0; d < 4; d++) {
          const n = beside(c, d);
          if (n < 0 || seen[n]! >= 0 || sim.wet[n] === b.id) continue;
          seen[n] = c;
          q[tail++] = n;
        }
      }
      if (head === levelEnd) {
        depth++;
        levelEnd = tail;
      }
    }
    return [];
  }

  /** A rectangle off the print: across its own ink to a way out with room ahead, out, along, and back. */
  private sortie(sim: Sim, b: Mind): number[] {
    const rng = this.rng;
    const [lo, hi] = this.spec.loop;
    const room = (from: number, d: number, max: number): number => {
      let n = 0;
      for (let c = beside(from, d); c >= 0 && n < max && sim.owner[c] !== b.id && sim.wet[c] !== b.id; c = beside(c, d)) n++;
      return n;
    };
    let best = -1;
    let bestD = 0;
    let bestV = -1e9;
    for (let c = 0; c < N; c++) {
      if (sim.owner[c] !== b.id) continue;
      for (let d = 0; d < 4; d++) {
        const n = beside(c, d);
        if (n < 0 || sim.owner[n] === b.id) continue;
        const ahead = room(c, d, hi);
        if (ahead < 1) continue;
        // Bare paper ahead is worth more than somebody's print; a long walk across its own ink costs a little.
        let v = Math.min(ahead, hi) + (sim.owner[n] === 0 ? 1.2 : 0) - steps(c, b.cell) * (this.spec.wary ? 0.4 : 0.12) + rng() * (this.spec.wary ? 1 : 2.5);
        if (ahead < lo) v -= 2;
        // A wary beetle would rather set out where nobody else is.
        if (this.spec.wary) {
          let near = 99;
          for (const o of sim.bugs) if (o.id !== b.id && o.on) near = Math.min(near, steps(o.cell, n));
          v += Math.min(near, 12) * 0.45;
        }
        if (v > bestV) {
          bestV = v;
          best = c;
          bestD = d;
        }
      }
    }
    if (best < 0) return [];
    const plan = this.pathTo(sim, { id: b.id, cell: b.cell, line: [] }, (x) => x === best, 99).filter((x) => sim.owner[x] === b.id || x === best);
    if (b.cell !== best && (plan.length === 0 || plan[plan.length - 1] !== best)) return [];
    // A wary beetle walks no further than it can get round before the nearest other beetle could reach the line.
    let cap = hi;
    if (this.spec.wary) {
      let near = 99;
      for (const o of sim.bugs) if (o.id !== b.id && o.on) near = Math.min(near, steps(o.cell, best));
      cap = Math.max(2, Math.min(hi, Math.floor((near - 1) / 1.6)));
    }
    const a = Math.max(1, Math.min(rng.int(Math.min(lo, cap), cap), room(best, bestD, hi)));
    let c = best;
    for (let i = 0; i < a; i++) {
      c = beside(c, bestD);
      plan.push(c);
    }
    // Along: to the side with more room.
    const left = (bestD + 3) % 4;
    const right = (bestD + 1) % 4;
    const rl = room(c, left, hi);
    const rr = room(c, right, hi);
    const side = rl === rr ? (rng.chance(0.5) ? left : right) : rl > rr ? left : right;
    const along = Math.min(rng.int(Math.min(lo, cap), cap), Math.max(rl, rr));
    for (let i = 0; i < along; i++) {
      c = beside(c, side);
      plan.push(c);
    }
    // And back toward the print; the way home is worked out when the plan runs out.
    const back = (bestD + 2) % 4;
    for (let i = 0; i < a; i++) {
      const n = beside(c, back);
      if (n < 0) break;
      c = n;
      plan.push(c);
      if (sim.owner[c] === b.id) break;
    }
    return plan;
  }
}
