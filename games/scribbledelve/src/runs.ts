/**
 * Headless runs: a pilot plays a whole run at 60 steps a second, exactly as a thumb would, and reports how long it
 * lasted. Used by scripts/pilot.ts and the tests.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, type Skill } from "./pilot.ts";
import { Sim, type Stats } from "./sim.ts";

export interface RunResult {
  seconds: number;
  score: number;
  floor: number;
  stats: Stats;
  over: boolean;
  /** Seconds until the first heart was lost (-1: never). */
  firstCaught: number;
}

/** `skill: null` is an idle thumb: the knight never moves. `"random"` swipes at random, like the reviewer does. */
export function playRun(skill: Skill | null | "random", seed: number, maxSeconds = 600, fps = 60): RunResult {
  const sim = new Sim({ seed });
  const rng = createRng(seed ^ 0x51f15e);
  const pilot = skill && skill !== "random" ? new Pilot(skill, rng) : null;
  const dt = 1 / fps;
  let firstCaught = -1;
  let swipeIn = 0.5;
  while (!sim.over && sim.t < maxSeconds) {
    pilot?.step(sim, dt);
    if (skill === "random" && (swipeIn -= dt) <= 0) {
      swipeIn = 0.75;
      sim.steer(rng.int(0, 3));
    }
    sim.step(dt);
    for (const e of sim.events) if (e.k === "caught" && firstCaught < 0) firstCaught = sim.t;
    sim.events.length = 0;
  }
  return { seconds: sim.t, score: sim.score, floor: sim.floor, stats: sim.stats, over: sim.over, firstCaught };
}

/** The seed of a player's `run`-th run (1 for the first), from the seed the shell hands the game. */
export const runSeed = (seed: number, run: number): number => ((seed >>> 0) ^ Math.imul(run + 1, 0x9e3779b1)) >>> 0;
/** The QA pilot's own dice (`VITE_AUTOPLAY` builds and scripts/shoot-plan.ts replay the same run). */
export const QA_PILOT_SEED = 7;

export const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
