/**
 * A whole run played headless by the pilot, paced the way the game paces it (thinking, the roll, the pins coming
 * down, the hold, the sweep). Used by the run-length script and the tests; no DOM.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { aimView } from "./lane.ts";
import { newHabit, pilotFlick, type Skill } from "./pilot.ts";
import { newFrames, simulateThrow } from "./pins.ts";
import { FIRST_BALL_T, HOLD_T, RESET_T, Run, type Award } from "./run.ts";
import { aimFor } from "./throw.ts";

/** Real seconds a strike's slow motion adds (the clock runs on game time, so it costs nothing). */
export const SLOWMO_EXTRA = 0.32;

export interface RunReport {
  seconds: number;
  score: number;
  racks: number;
  balls: number;
  strikes: number;
  spares: number;
  opens: number;
  splits: number;
  converted: number;
  gutters: number;
  bestChain: number;
  /** Lowest the clock got in the first 10 s. */
  minClock10: number;
  /** Strike rate on full racks. */
  strikeRate: number;
  awards: Award[];
}

const frames = newFrames();

export function holdFor(a: Award): number {
  return a.kind === "strike" ? HOLD_T.strike : a.kind === "spare" ? HOLD_T.spare : HOLD_T.other;
}

export function playRun(skill: Skill, rng: Rng, width = 390, height = 788): RunReport {
  const view = aimView(width, height);
  const run = new Run(rng);
  const habit = newHabit(skill, rng);
  let t = 0;
  let minClock10 = run.clock;
  let firstBalls = 0;
  const awards: Award[] = [];
  const advance = (sec: number, frozen: boolean): boolean => {
    let left = sec;
    let buzzed = false;
    while (left > 1e-9) {
      const dt = Math.min(1 / 60, left);
      left -= dt;
      t += dt;
      if (run.tick(dt, frozen)) buzzed = true;
      if (t <= 10) minClock10 = Math.min(minClock10, run.clock);
    }
    return buzzed;
  };
  advance(FIRST_BALL_T, true);
  while (t < 400 && !run.buzzer) {
    if (advance(rng.range(skill.think[0], skill.think[1]), false)) break;
    const f = pilotFlick(view, run.standing, skill, rng, habit);
    const aim = aimFor(view, f, run.standing, run.rack, run.bumpers);
    if (run.ball === 1 && run.standing.every((s) => s)) firstBalls++;
    const th = simulateThrow(aim.input, run.standing, frames, run.jitter);
    const buzzed = advance(th.decided, false);
    const a = run.settle(th, buzzed);
    awards.push(a);
    if (a.kind === "strike" || a.converted) t += SLOWMO_EXTRA;
    if (buzzed) {
      t += holdFor(a);
      break;
    }
    if (advance(holdFor(a), false)) break;
    advance(RESET_T, true);
  }
  return {
    seconds: t,
    score: run.score,
    racks: run.rack,
    balls: run.balls,
    strikes: run.strikes,
    spares: run.spares,
    opens: run.opens,
    splits: run.splits,
    converted: run.converted,
    gutters: run.gutters,
    bestChain: run.bestChain,
    minClock10,
    strikeRate: firstBalls ? run.strikes / firstBalls : 0,
    awards,
  };
}
