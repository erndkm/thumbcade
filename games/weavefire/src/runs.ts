/** Headless whole runs for the playtest script and the tests. */
import { Pilot, type Skill } from "./pilot.ts";
import { Sim, type RunStats } from "./sim.ts";

export interface RunResult {
  seconds: number;
  score: number;
  stats: RunStats;
  loops: number;
  /** Hits taken in the first ten seconds. */
  hitsBy10: number;
  /** Where the run ended: the loop phase and whether a bullet or a body did it. */
  endedIn: string;
  hitTimes: number[];
}

/** Plays one run at 60 Hz until the ship is lost (or `maxSeconds`). The field is the iPhone game viewport by default. */
export function playRun(skill: Skill, seed: number, fieldH = 696, maxSeconds = 240): RunResult {
  const sim = new Sim({ seed, fieldH });
  const pilot = new Pilot(skill, seed ^ 0x5bd1e995);
  const dt = 1 / 60;
  let hitsBy10 = 0;
  const hitTimes: number[] = [];
  let hits = 0;
  while (sim.ship.alive && sim.t < maxSeconds) {
    pilot.update(sim, dt);
    sim.step(dt);
    sim.evCount = 0;
    if (sim.t <= 10) hitsBy10 = sim.stats.hits;
    if (sim.stats.hits > hits) {
      hits = sim.stats.hits;
      hitTimes.push(Math.round(sim.t * 10) / 10);
    }
  }
  return { seconds: sim.t, score: sim.score, stats: sim.stats, loops: sim.loop, hitsBy10, endedIn: `L${sim.loop}:${sim.phase}:${sim.stats.deathBy}`, hitTimes };
}
