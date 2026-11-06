/**
 * Headless runs: the pilot plays the cat through the same mallet targets a thumb sets, at 240 steps a second, for the
 * run-length checks (`scripts/pilot.ts`, `test/run.test.ts`).
 */
import { PILOTS } from "./ai.ts";
import { pilotCat, Run, type RunStats } from "./run.ts";

export type Skill = keyof typeof PILOTS | "idle";
export const SKILLS: readonly Skill[] = ["idle", "novice", "casual", "good", "expert"];

export interface RunResult {
  seconds: number;
  score: number;
  stats: RunStats;
  /** Critter index the run ended on (0-4). */
  reached: number;
  /** Seconds left on the clock at 10 s into the run. */
  clockAt10: number;
}

export function playRun(skill: Skill, seed: number, maxSeconds = 300): RunResult {
  const run = new Run(seed);
  const cat = skill === "idle" ? undefined : pilotCat(PILOTS[skill], seed ^ 0xca7).drive;
  let clockAt10 = -1;
  while (!run.over && run.t < maxSeconds) {
    run.update(1 / 60, cat);
    run.drain();
    if (clockAt10 < 0 && run.t >= 10) clockAt10 = run.clock;
  }
  return { seconds: run.t, score: run.score, stats: run.stats, reached: run.critter, clockAt10 };
}

export const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
