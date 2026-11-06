/**
 * A whole run played headless by the pilot, timed the way the game paces it. Used by the run-length script and
 * the tests; no DOM.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { pilotFlick, type Skill } from "./pilot.ts";
import { aimFor, distanceOf, GOAL_HOLD, MISS_HOLD, newFrames, Run, SETUP_T, setupFor, simulateShot, solveKick, viewFor, type Outcome } from "./sim.ts";

export interface RunReport {
  seconds: number;
  kicks: number;
  goals: number;
  corners: number;
  score: number;
  bestStreak: number;
  /** Did the player lose a ball within the first 10 s? */
  lostBy10s: boolean;
  outcomes: Partial<Record<Outcome, number>>;
}

const frames = newFrames();

export function playRun(skill: Skill, rng: Rng, width = 390, height = 788): RunReport {
  const run = new Run();
  let seconds = 0;
  let lostBy10s = false;
  const outcomes: Partial<Record<Outcome, number>> = {};
  let n = 0;
  while (!run.over && n < 200) {
    const s = setupFor(n, rng);
    const view = viewFor(s.spot, width, height);
    seconds += SETUP_T + rng.range(skill.think[0], skill.think[1]);
    const f = pilotFlick(s, view, skill, rng);
    const aim = aimFor(view, s.spot, f, s.rings);
    const shot = simulateShot(s, solveKick(s.spot, aim, aim.speed, aim.curl), frames);
    const free = run.free;
    run.take();
    run.settle(shot, distanceOf(s));
    outcomes[shot.outcome] = (outcomes[shot.outcome] ?? 0) + 1;
    seconds += shot.decided + (shot.outcome === "goal" ? GOAL_HOLD : MISS_HOLD);
    if (shot.outcome !== "goal" && !free && seconds < 10) lostBy10s = true;
    n++;
  }
  return { seconds, kicks: run.kicks, goals: run.goals, corners: run.corners, score: run.score, bestStreak: run.bestStreak, lostBy10s, outcomes };
}
