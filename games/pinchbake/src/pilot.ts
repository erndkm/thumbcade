/**
 * The pilot: plays the attract demo, and plays headless runs at several skill levels so run lengths can be measured
 * without a person (scripts/playtest.ts, test/pilot.test.ts). It uses the same two inputs a thumb has: aim, then
 * let go.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import type { World } from "./physics.ts";
import { RIM, Run, TIN_W } from "./run.ts";
import { radius } from "./tiers.ts";

export interface Skill {
  name: string;
  /** Seconds between drops (uniform range): looking, deciding, dragging. */
  think: [number, number];
  /** How far a drop lands from where the player meant it (uniform ± tin units). */
  noise: number;
  /** Chance a drop is thought through at all (otherwise anywhere that looks free). */
  smart: number;
  /** Looks at the next piece too. */
  plans: boolean;
}

export const SKILLS: Skill[] = [
  { name: "first-timer", think: [1.1, 2.4], noise: 1.1, smart: 0.3, plans: false },
  { name: "casual", think: [0.85, 1.7], noise: 0.6, smart: 0.6, plans: false },
  { name: "good", think: [0.6, 1.15], noise: 0.3, smart: 0.88, plans: true },
  { name: "expert", think: [0.45, 0.8], noise: 0.14, smart: 1, plans: true },
];

/** The attract-mode baker: good, unhurried, never wild. */
export const DEMO: Skill = { name: "demo", think: [0.75, 1.1], noise: 0.12, smart: 0.92, plans: true };

export interface Landing {
  /** Height of the dropped piece's centre where it first rests. */
  y: number;
  /** Index of the body it lands on (-1 = the dough). */
  on: number;
}

/** Where a piece of radius `r` dropped at `x` first comes to rest (straight down, no rolling). */
export function landing(w: World, x: number, r: number): Landing {
  let y = w.floor + r;
  let on = -1;
  for (let j = 0; j < w.n; j++) {
    const dx = x - w.x[j]!;
    const rr = r + w.r[j]!;
    if (dx >= rr || dx <= -rr) continue;
    const yc = w.y[j]! + Math.sqrt(rr * rr - dx * dx);
    if (yc > y) {
      y = yc;
      on = j;
    }
  }
  return { y, on };
}

/** How good it looks to drop `tier` at `x`. Higher is better. */
export function judge(w: World, tier: number, x: number, next: number, plans: boolean): number {
  const r = radius(tier);
  const l = landing(w, x, r);
  let s = -(l.y + r) * 0.7;
  if (l.on >= 0) {
    const t = w.tier[l.on]!;
    if (t === tier) s += 14 + tier * 2.5;
    else if (t < tier) s -= 2.5 * (tier - t);
  }
  // Same tier close by at the landing spot: it will likely roll into it.
  for (let j = 0; j < w.n; j++) {
    if (j === l.on || w.tier[j] !== tier) continue;
    const dx = x - w.x[j]!;
    const dy = l.y - w.y[j]!;
    const gap = Math.sqrt(dx * dx + dy * dy) - r - w.r[j]!;
    if (gap < 0.35) s += 7;
    else if (gap < 1.2) s += 2;
  }
  if (plans && next === tier && l.on >= 0 && w.tier[l.on] !== tier) s += 0.8;
  // Big bakes belong near the walls; small ones in the middle stay easy to reach.
  if (tier >= 3) s += (Math.abs(x - TIN_W / 2) / (TIN_W / 2)) * 1.2;
  if (l.y + r > RIM - 0.4) s -= 40;
  return s;
}

/** The best spot for the held piece among evenly spaced aims. */
export function bestAim(run: Run, plans: boolean, samples = 33): number {
  const w = run.world;
  const r = radius(run.held);
  let best = TIN_W / 2;
  let bestS = -Infinity;
  for (let k = 0; k < samples; k++) {
    const x = r + ((TIN_W - 2 * r) * k) / (samples - 1);
    const s = judge(w, run.held, x, run.next, plans);
    if (s > bestS) {
      bestS = s;
      best = x;
    }
  }
  return best;
}

export class Pilot {
  /** Seconds until the next decision. */
  wait: number;
  /** Where the pilot is aiming for the coming drop. */
  target = TIN_W / 2;
  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.wait = rng.range(skill.think[0], skill.think[1]) * 0.7;
  }

  /** Picks the next aim (called when a piece is ready). */
  decide(run: Run): number {
    const r = radius(run.held);
    let x: number;
    if (this.rng() < this.skill.smart) x = bestAim(run, this.skill.plans);
    else x = this.rng.range(r, TIN_W - r);
    x += this.rng.range(-this.skill.noise, this.skill.noise);
    this.target = Math.min(TIN_W - r, Math.max(r, x));
    return this.target;
  }

  /** True when it is time to let go this frame. */
  tick(run: Run, dt: number): boolean {
    this.wait -= dt;
    if (this.wait > 0 || !run.canDrop) return false;
    this.wait = this.rng.range(this.skill.think[0], this.skill.think[1]);
    return true;
  }
}

export interface SimResult {
  seconds: number;
  score: number;
  run: Run;
}

/** Plays one run headless at 60 frames a second, through aim and drop like a thumb. */
export function simulate(seed: number, skill: Skill, maxSeconds = 300): SimResult {
  const run = new Run(seed);
  const pilot = new Pilot(skill, createRng(seed ^ 0x2545f491));
  const dt = 1 / 60;
  let aimed = false;
  while (run.phase === "play" && run.elapsed < maxSeconds) {
    if (run.canDrop && !aimed) {
      run.aim(pilot.decide(run));
      aimed = true;
    }
    if (pilot.tick(run, dt) && aimed) {
      run.aim(pilot.target);
      run.drop();
      aimed = false;
    }
    run.update(dt);
    run.events.length = 0;
  }
  return { seconds: run.elapsed, score: run.score, run };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}
