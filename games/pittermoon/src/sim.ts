/**
 * Headless runs: the pilot plays the cat through the same press, release and swipe calls a thumb makes, at 60 steps
 * a second, for the run-length checks (`scripts/pilot.ts`, `test/pilot.test.ts`).
 */
import { pilotCat, PILOTS, scripted, type PilotName } from "./pilot.ts";
import { Run, type RunStats } from "./run.ts";

export type Skill = PilotName | "idle" | "scripted";
export const SKILLS: readonly Skill[] = ["idle", "novice", "casual", "good", "expert"];

export interface RunResult {
  seconds: number;
  score: number;
  rows: number;
  stats: RunStats;
  /** Rows between the dawn and the cat 10 s in. */
  gapAt10: number;
}

export function playRun(skill: Skill, seed: number, maxSeconds = 300): RunResult {
  const run = new Run(seed);
  const drive = skill === "idle" ? undefined : skill === "scripted" ? scripted().drive : pilotCat(PILOTS[skill], seed ^ 0xca7).drive;
  let gapAt10 = -1;
  while (!run.over && run.t < maxSeconds) {
    run.update(1 / 60, drive);
    run.drain();
    if (gapAt10 < 0 && run.t >= 10) gapAt10 = run.gap;
    if (run.t > 4) run.world.forget(Math.floor(run.dawn) - 8);
  }
  return { seconds: run.t, score: run.score, rows: run.rows, stats: run.stats, gapAt10 };
}

export const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
