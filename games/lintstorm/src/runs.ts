/**
 * Headless runs: the pilot plays a whole run at 60 steps a second, exactly as a thumb would, and reports how long
 * it lasted. Used by scripts/pilot.ts and the tests.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, type Skill } from "./pilot.ts";
import { Sim, type Stats } from "./sim.ts";

export interface RunResult {
  seconds: number;
  score: number;
  stats: Stats;
  /** Seconds until the first heart was lost (-1: never). */
  firstHurt: number;
  /** Hearts lost in the first 10 s. */
  lostBy10: number;
  diedBy10: boolean;
}

/** `skill: null` is an idle player: the iron sits where it starts and fires on its own. */
export function playRun(skill: Skill | null, seed: number, maxSeconds = 240): RunResult {
  const sim = new Sim({ seed });
  const pilot = skill ? new Pilot(skill, createRng(seed ^ 0x51f15e)) : null;
  const dt = 1 / 60;
  let lostBy10 = 0;
  while (!sim.over && sim.t < maxSeconds) {
    if (pilot) {
      const [dx, dy] = pilot.step(sim, dt);
      sim.moveBy(dx, dy);
    }
    sim.step(dt);
    for (const e of sim.events) if (e.k === "hurt" && sim.t <= 10) lostBy10++;
    sim.events.length = 0;
  }
  return { seconds: sim.t, score: sim.score, stats: sim.stats, firstHurt: sim.stats.firstHurt, lostBy10, diedBy10: sim.over && sim.t <= 10 };
}

export const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
