/**
 * A whole run played headless by the pilot, timed the way the game paces it: lining up each shot, watching it roll
 * (with the speed-up once everything slows), new racks dropping in. Used by the run-length script and the tests.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { choose, execute, type Skill } from "./pilot.ts";
import { makeRack, respawnCue, Run, simulateShot, watchTime, type Shot, type Table } from "./sim.ts";

/** From the starting tap until you can shoot, and the pause while a new rack drops in (the clock waits). */
export const FIRST_T = 0.6;
export const RACK_DROP_T = 1.3;

export interface RunReport {
  seconds: number;
  shots: number;
  pots: number;
  racks: number;
  score: number;
  bestStreak: number;
  scratches: number;
  banks: number;
  multis: number;
  combos: number;
  minClock10: number;
  potRate: number;
}

/** The table after a shot: potted balls gone, the cue ball back on the head line after a scratch. */
export function afterShot(s: Shot): Table {
  const t = s.after;
  const balls = t.balls.filter((b, i) => i === 0 || b.pocket < 0);
  const out: Table = { balls, blockers: t.blockers };
  const cue = balls[0]!;
  cue.vx = cue.vz = 0;
  if (cue.pocket >= 0) {
    cue.pocket = -1;
    const p = respawnCue({ balls: balls.map((b, i) => (i === 0 ? { ...b, x: 99, z: 99 } : b)), blockers: t.blockers });
    cue.x = p.x;
    cue.z = p.z;
  }
  return out;
}

export function playRun(skill: Skill, rng: Rng, seed = 1): RunReport {
  const run = new Run();
  let table = makeRack(0, seed);
  let t = 0;
  let minClock10 = run.clock;
  const wait = (secs: number, frozen = false) => {
    const dt = 1 / 30;
    for (let k = 0; k < secs / dt && !run.buzzer; k++) {
      t += dt;
      run.tick(dt, frozen);
      if (t <= 10) minClock10 = Math.min(minClock10, run.clock);
    }
  };
  wait(FIRST_T, true);
  while (!run.buzzer && t < 400) {
    wait(rng.range(skill.think[0], skill.think[1]));
    if (run.buzzer) break;
    const plan = choose(table, skill, rng);
    const { angle, speed } = execute(plan, skill, run.rack, rng);
    const shot = simulateShot(table, angle, speed);
    wait(watchTime(shot));
    const left = shot.after.balls.filter((b, i) => i > 0 && b.pocket < 0).length;
    const a = run.settle(shot, left, run.buzzer);
    table = afterShot(shot);
    if (a.rackClear && !run.buzzer) {
      run.nextRack();
      table = makeRack(run.rack, seed * 31 + run.rack, table.balls[0]!);
      wait(RACK_DROP_T, true);
    }
  }
  return {
    seconds: t,
    shots: run.shots,
    pots: run.pots,
    racks: run.racksCleared,
    score: run.score,
    bestStreak: run.bestStreak,
    scratches: run.scratches,
    banks: run.banks,
    multis: run.multis,
    combos: run.combos,
    minClock10,
    potRate: run.shots ? run.potShots / run.shots : 0,
  };
}
