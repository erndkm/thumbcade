/**
 * A whole run played headless by the pilot, timed the way the game paces it (the clock, reloads, balls in the air,
 * stage changes). Used by the run-length script and the tests; no DOM.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { gauss, pilotFlick, type Skill } from "./pilot.ts";
import {
  aimFor,
  launchFor,
  MAX_IN_AIR,
  newFrames,
  RELOAD_T,
  Run,
  simulateShot,
  STAGE_T,
  STILL,
  viewFor,
  type Motion,
  type Outcome,
  type Shot,
  type Stage,
} from "./sim.ts";

/** Time from the starting tap to the first ball in your hands. */
export const FIRST_BALL_T = 0.6;

export interface RunReport {
  seconds: number;
  shots: number;
  makes: number;
  swishes: number;
  banks: number;
  score: number;
  bestStreak: number;
  stage: number;
  outcomes: Partial<Record<Outcome, number>>;
  /** Make rate per stage reached: [makes, shots]. */
  perStage: Array<[number, number]>;
  /** Lowest the clock got in the first 10 s. */
  minClock10: number;
  buzzerBeaters: number;
}

export function motionFor(stage: Stage, t0: number): Motion {
  return stage.amp > 0 ? { amp: stage.amp, period: stage.period, t0 } : STILL;
}

export function playRun(skill: Skill, rng: Rng, width = 390, height = 788): RunReport {
  const run = new Run();
  let stage = run.stageDef();
  let motion = motionFor(stage, 0);
  let view = viewFor(stage.spot, width, height);
  let bias = gauss(rng) * skill.bias;
  const dt = 1 / 60;
  let t = 0;
  let nextShot = FIRST_BALL_T + rng.range(skill.think[0], skill.think[1]);
  let frozenUntil = 0;
  const air: Array<{ shot: Shot; bonus: boolean; dist: number; at: number }> = [];
  const outcomes: Partial<Record<Outcome, number>> = {};
  const perStage: Array<[number, number]> = [[0, 0]];
  let minClock10 = run.clock;
  let buzzerBeaters = 0;
  while (t < 400) {
    t += dt;
    const frozen = t < frozenUntil;
    run.tick(dt, frozen || t < FIRST_BALL_T);
    if (t <= 10) minClock10 = Math.min(minClock10, run.clock);
    // Balls coming down.
    for (let i = air.length - 1; i >= 0; i--) {
      const b = air[i]!;
      if (t < b.at) continue;
      air.splice(i, 1);
      const a = run.settle(b.shot, b.dist, b.bonus, run.buzzer);
      if (a.buzzer) buzzerBeaters++;
      outcomes[b.shot.outcome] = (outcomes[b.shot.outcome] ?? 0) + 1;
      // It sees short/long misses and corrects its habit.
      bias *= 0.82;
    }
    if (run.buzzer && !air.length) break;
    if (run.pendingStage && !air.length && !run.buzzer) {
      stage = run.advance();
      perStage.push([0, 0]);
      motion = motionFor(stage, t + STAGE_T);
      view = viewFor(stage.spot, width, height);
      frozenUntil = t + STAGE_T;
      bias = gauss(rng) * skill.bias * 0.7;
      nextShot = t + STAGE_T + rng.range(skill.think[0], skill.think[1]);
      continue;
    }
    if (run.buzzer || frozen || run.pendingStage || t < nextShot || air.length >= MAX_IN_AIR) continue;
    const bonus = run.take();
    const f = pilotFlick(view, stage, motion, t, skill, rng, bias);
    const aim = aimFor(view, stage, motion, t, f);
    const shot = simulateShot(stage.spot, launchFor(stage.spot, aim.target), motion, t, newFrames());
    air.push({ shot, bonus, dist: stage.dist, at: t + shot.decided });
    const ps = perStage[perStage.length - 1]!;
    ps[1]++;
    if (shot.outcome !== "miss") ps[0]++;
    const think = rng.range(skill.think[0], skill.think[1]);
    // Rapid fire, or wait to see this one drop first.
    nextShot = rng.chance(skill.rapid) ? t + RELOAD_T + think : Math.max(t + RELOAD_T, t + shot.decided) + think * 0.6;
  }
  return {
    seconds: t,
    shots: run.shots,
    makes: run.makes,
    swishes: run.swishes,
    banks: run.banks,
    score: run.score,
    bestStreak: run.bestStreak,
    stage: run.stage,
    outcomes,
    perStage,
    minClock10,
    buzzerBeaters,
  };
}
