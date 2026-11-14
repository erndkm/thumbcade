/** Headless whole runs for the pilot script and the tests. */
import { Pilot, SKILLS, type SkillName } from "./pilot.ts";
import { Game, GE, type RunStats } from "./rules.ts";

export interface RunResult {
  seconds: number;
  score: number;
  stats: RunStats;
  /** Seconds into the run of each ball lost. */
  drains: number[];
  corrections: number;
  maxSpeed: number;
}

/** Plays one run at 60 Hz until it ends (or `maxSeconds`). `skill` null = nobody touches the screen. */
export function playRun(skill: SkillName | null, seed: number, maxSeconds = 300): RunResult {
  const g = new Game({ seed });
  const pilot = skill ? new Pilot(SKILLS[skill], seed ^ 0x5bd1e995) : null;
  const dt = 1 / 60;
  const drains: number[] = [];
  const idle = { left: false, right: false, launch: false };
  let maxSpeed = 1;
  while (g.phase !== "over" && g.t < maxSeconds) {
    const c = pilot ? pilot.update(g, dt) : idle;
    g.step(dt, c);
    maxSpeed = Math.max(maxSpeed, g.speed);
    g.drain((e) => {
      if (e.type === GE.Drain) drains.push(Math.round(g.t * 10) / 10);
    });
  }
  return { seconds: g.t, score: g.score, stats: { ...g.stats }, drains, corrections: g.world.corrections, maxSpeed };
}
