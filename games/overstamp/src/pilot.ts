/**
 * The pilot: plays the attract demo, picks the first-run hint and plays headless runs at several skill levels, so
 * run lengths can be measured without a person (scripts/playtest.ts, test/pilot.test.ts). It sees what a player
 * sees: the free slips, the faded marks of the covered ones, and the tray.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { TRAY } from "./deal.ts";
import { Run, type RunEvent, type RunStats } from "./run.ts";

export interface Skill {
  name: string;
  /** Seconds from one lift to the next (uniform range): finding the slip and tapping it. */
  think: [number, number];
  /** Extra seconds to look when nothing in the tray can be finished. */
  ponder: [number, number];
  /** Share of the free slips noticed on each look. */
  sight: number;
  /** Chance a lift is a careless one (any free slip). */
  careless: number;
  /** How much the covered marks count (0 = ignored, 1 = read like a free slip). */
  depth: number;
  /** Chance of tapping a covered slip by mistake. */
  fumble: number;
  /** Uses the paper clip and the riffle when the tray is tight. */
  helpers: boolean;
}

export const SKILLS: Skill[] = [
  { name: "novice", think: [1.15, 2.1], ponder: [0.4, 1.2], sight: 0.55, careless: 0.18, depth: 0, fumble: 0.08, helpers: false },
  { name: "casual", think: [0.85, 1.5], ponder: [0.3, 0.9], sight: 0.7, careless: 0.1, depth: 0.2, fumble: 0.04, helpers: true },
  { name: "good", think: [0.6, 1.05], ponder: [0.2, 0.6], sight: 0.85, careless: 0.05, depth: 0.5, fumble: 0.02, helpers: true },
  { name: "expert", think: [0.42, 0.75], ponder: [0.1, 0.4], sight: 0.97, careless: 0.02, depth: 0.85, fumble: 0.01, helpers: true },
];

export const skillByName = (name: string): Skill | undefined => SKILLS.find((s) => s.name === name);

export type Choice = { kind: "tap"; id: number } | { kind: "clip" } | { kind: "riffle" };

/** How much a lift is worth to a player who sees this much. */
function value(run: Run, id: number, seen: ReadonlySet<number>, depth: number): number {
  const k = run.slips[id]!.type;
  const c = run.inTray(k);
  let freeSame = 0;
  for (const j of seen) if (j !== id && run.slips[j]!.type === k) freeSame++;
  // What lifting it uncovers, as far as the player reads the faded marks.
  let uncover = 0;
  let uncoverSame = 0;
  for (let j = 0; j < run.slips.length; j++) {
    const o = run.slips[j]!;
    if (o.gone || !run.above[j]!.includes(id)) continue;
    if (run.above[j]!.every((a) => a === id || run.slips[a]!.gone)) {
      uncover++;
      if (o.type === k) uncoverSame++;
    }
  }
  const room = TRAY - run.tray.length;
  let v: number;
  if (c === 2) v = 100;
  else if (c === 1) v = freeSame >= 1 ? 62 : 26 + depth * 20 * uncoverSame;
  else v = freeSame >= 2 ? 48 : freeSame === 1 ? 22 : 4 + depth * 14 * uncoverSame;
  // A tight tray makes a new kind expensive.
  if (c === 0) v -= Math.max(0, 5 - room) * 14;
  if (c === 1 && freeSame === 0) v -= Math.max(0, 4 - room) * 10;
  v += depth * 6 * uncover;
  return v;
}

export class Pilot {
  wait: number;
  constructor(
    readonly skill: Skill,
    private readonly rng: Rng,
  ) {
    this.wait = rng.range(skill.think[0], skill.think[1]);
  }

  /** What to do now, or null to keep looking. Call every frame with the frame's dt. */
  next(run: Run, dt: number): Choice | null {
    if (!run.live || run.pause > 0) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    const c = this.choose(run);
    const s = this.skill;
    this.wait = this.rng.range(s.think[0], s.think[1]);
    return c;
  }

  /** The move this player would make on this frame. */
  choose(run: Run): Choice | null {
    const s = this.skill;
    const free = run.freeIds();
    if (!free.length) return null;
    if (this.rng() < s.fumble) {
      const covered = run.slips.filter((o) => !o.gone && !run.isFree(o.id));
      if (covered.length) return { kind: "tap", id: this.rng.pick(covered).id };
    }
    const seen = new Set(free.filter(() => this.rng() < s.sight));
    if (!seen.size) seen.add(this.rng.pick(free));
    let best = -1;
    let bestV = -Infinity;
    for (const id of seen) {
      const v = value(run, id, seen, s.depth) + this.rng() * 6;
      if (v > bestV) {
        bestV = v;
        best = id;
      }
    }
    if (s.helpers) {
      const room = TRAY - run.tray.length;
      if (bestV < 60 && room <= 2 && run.riffles > 0) return { kind: "riffle" };
      if (bestV < 40 && room <= 1 && run.clips > 0) return { kind: "clip" };
    }
    if (bestV < 60) this.wait += this.rng.range(s.ponder[0], s.ponder[1]);
    if (this.rng() < s.careless) best = this.rng.pick(free);
    return { kind: "tap", id: best };
  }
}

export function apply(run: Run, c: Choice): RunEvent[] {
  return c.kind === "tap" ? run.tap(c.id) : c.kind === "clip" ? run.clip() : run.riffle();
}

export interface Played {
  seconds: number;
  score: number;
  stats: RunStats;
  why: string;
  /** Clock left at 10 s (Infinity if the run never got there). */
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
    if (!pilot || !run.live) continue;
    const c = pilot.next(run, dt);
    if (c) apply(run, c);
  }
  return { seconds: wall, score: run.score, stats: run.stats, why: run.over ?? "cap", clockAt10, lostBy10: !run.live && wall < 10 };
}

export const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
