/**
 * The pilot: plays the attract demo, picks the idle hint, and plays headless runs at four skill levels so run lengths
 * can be measured without a person (scripts/pilot.ts, test/pilot.test.ts). It sees what a player sees: the free pegs
 * and their colours, the open jars, the next jar in line and the shelf, and it taps through the same `tap` a finger
 * does.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { coveredAtRest } from "./board.ts";
import { Run, type RunEvent, type RunStats } from "./run.ts";

export interface Skill {
  name: string;
  /** Seconds from one pull to the next (finding the peg and tapping it). */
  think: [number, number];
  /** Extra seconds when nothing on the wall fits an open jar. */
  ponder: [number, number];
  /** Share of the free pegs noticed on each look. */
  sight: number;
  /** Chance a pull is a careless one (any free peg). */
  careless: number;
  /** Chance of tapping a covered peg by mistake. */
  fumble: number;
  /** How much it thinks about what a pull uncovers (0 = not at all). */
  depth: number;
  /** Uses the magnet by hand when the shelf is tight. */
  magnet: boolean;
}

export const SKILLS: Skill[] = [
  { name: "novice", think: [1.0, 1.9], ponder: [0.4, 1.1], sight: 0.5, careless: 0.3, fumble: 0.08, depth: 0, magnet: false },
  { name: "casual", think: [0.8, 1.4], ponder: [0.3, 0.8], sight: 0.68, careless: 0.14, fumble: 0.04, depth: 0.25, magnet: true },
  { name: "good", think: [0.6, 1.05], ponder: [0.2, 0.6], sight: 0.85, careless: 0.06, fumble: 0.02, depth: 0.6, magnet: true },
  { name: "expert", think: [0.45, 0.8], ponder: [0.1, 0.35], sight: 0.97, careless: 0.02, fumble: 0.01, depth: 1, magnet: true },
];

export const skillByName = (name: string): Skill | undefined => SKILLS.find((s) => s.name === name);

export type Choice = { kind: "tap"; id: number } | { kind: "magnet" };

/** How good pulling `id` looks to a player who reads `depth` into what it uncovers. */
export function value(run: Run, id: number, depth: number): number {
  const wall = run.wall;
  const peg = wall.pegs[id]!;
  const jar = run.jarFor(peg.color);
  const shelf = run.shelf.length;
  const cap = run.shelfCap;
  let v: number;
  if (jar) v = 100 + (jar.jar.n === 2 ? 25 : 0);
  else {
    v = 12 - 20 * shelf;
    if (shelf >= cap) v -= 900;
    else if (shelf >= cap - 1) v -= 120;
    if (run.upcoming(0) === peg.color) v += 22;
    if (run.shelf.some((s) => s.color === peg.color)) v += 6;
  }
  const n = run.count[peg.dish]!;
  if (n === 1) v += 12;
  if (depth > 0) {
    // What comes free once this dish rests again (or drops), as far as the player reads it.
    const left = run.left.slice();
    left[id] = 0;
    let freed = 0;
    let freedDirect = 0;
    for (let q = 0; q < left.length; q++) {
      if (!left[q] || q === id) continue;
      if (!wall.cover[q]!.some((e) => e.dish === peg.dish)) continue;
      if (coveredAtRest(wall, run.left, q) && !coveredAtRest(wall, left, q)) {
        freed++;
        if (run.jarFor(wall.pegs[q]!.color)) freedDirect++;
      }
    }
    v += depth * (6 * freed + 10 * freedDirect);
  }
  return v;
}

export class Pilot {
  wait: number;
  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.wait = rng.range(skill.think[0], skill.think[1]) * 0.6;
  }

  /** What to do now, or null to keep looking. Call every frame with the frame's dt. */
  next(run: Run, dt: number): Choice | null {
    if (!run.live || run.pause > 0) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    const c = this.choose(run);
    const s = this.skill;
    this.wait += this.rng.range(s.think[0], s.think[1]);
    return c;
  }

  /** The move this player would make right now. */
  choose(run: Run): Choice | null {
    const s = this.skill;
    const free = run.freePegs();
    if (!free.length) {
      this.wait = Math.max(this.wait, 0.15);
      return null;
    }
    if (this.rng() < s.fumble) {
      const covered: number[] = [];
      for (let i = 0; i < run.left.length; i++) if (run.left[i] && !free.includes(i)) covered.push(i);
      if (covered.length) return { kind: "tap", id: this.rng.pick(covered) };
    }
    const seen = free.filter(() => this.rng() < s.sight);
    if (!seen.length) seen.push(this.rng.pick(free));
    let best = seen[0]!;
    let bestV = -Infinity;
    for (const id of seen) {
      const v = value(run, id, s.depth) + this.rng() * 8;
      if (v > bestV) {
        bestV = v;
        best = id;
      }
    }
    if (s.magnet && run.magnets > 0 && run.shelf.length >= run.shelfCap - 1 && bestV < 60) return { kind: "magnet" };
    if (bestV < 60) this.wait += this.rng.range(s.ponder[0], s.ponder[1]);
    if (this.rng() < s.careless) best = this.rng.pick(free);
    return { kind: "tap", id: best };
  }
}

export function apply(run: Run, c: Choice): RunEvent[] {
  return c.kind === "tap" ? run.tap(c.id) : run.useMagnet();
}

export interface Played {
  seconds: number;
  score: number;
  stats: RunStats;
  why: string;
  /** Clock left at 10 s. */
  clockAt10: number;
  lostBy10: boolean;
}

/** Plays one whole run headless at 60 steps a second. `skill` null = an idle player. */
export function playRun(skill: Skill | null, seed: number, maxSeconds = 300): Played {
  const run = new Run(seed);
  const pilot = skill ? new Pilot(skill, createRng(seed ^ 0x5eed)) : null;
  const dt = 1 / 60;
  let clockAt10 = Infinity;
  let wall = 0;
  while (run.live && wall < maxSeconds) {
    wall += dt;
    run.step(dt);
    if (clockAt10 === Infinity && run.t >= 10) clockAt10 = run.clock;
    if (pilot && run.live) {
      const c = pilot.next(run, dt);
      if (c) apply(run, c);
    }
    run.events.length = 0;
  }
  return { seconds: wall, score: run.score, stats: run.stats, why: run.over ?? "cap", clockAt10, lostBy10: !run.live && wall < 10 };
}

export const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
