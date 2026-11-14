/**
 * Whole runs played headless by the pilot on the real physics, through the same release the thumb uses: for the
 * run-length script and the tests.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Run, STEP } from "./game.ts";
import { Pilot, type Skill } from "./pilot.ts";

export interface RunReport {
  seconds: number;
  score: number;
  pages: number;
  kos: number;
  shots: number;
  bestChain: number;
  oneShots: number;
  stars: number;
  drains: number;
  tapes: number;
  biggestTopple: number;
  /** Wads in hand 10 s into the run. */
  ammo10: number;
  /** Seconds at which each page was cleared. */
  clears: number[];
  hint: string;
  /** Milliseconds the run took to simulate. */
  ms: number;
}

/** `skill` null = an idle player who never touches the screen after the tap. */
export function playRun(skill: Skill | null, seed: number, maxT = 240): RunReport {
  const t0 = performance.now();
  const run = new Run(seed);
  const pilot = skill ? new Pilot(skill, createRng(seed * 31 + 7)) : null;
  let ammo10 = run.ammo;
  let wall = 0;
  const clears: number[] = [];
  while (run.phase !== "done" && wall < maxT) {
    if (pilot) {
      const rel = pilot.update(run, STEP);
      if (rel) run.release(rel.dx, rel.dy);
    }
    run.step();
    wall += STEP;
    for (const ev of run.events) if (ev.t === "clear") clears.push(wall);
    run.events.length = 0;
    if (wall <= 10) ammo10 = run.ammo;
  }
  const st = run.stats;
  return {
    seconds: wall,
    score: run.score,
    pages: st.pages,
    kos: st.kos,
    shots: st.shots,
    bestChain: st.bestChain,
    oneShots: st.oneShots,
    stars: st.stars,
    drains: st.drains,
    tapes: st.tapes,
    biggestTopple: st.biggestTopple,
    ammo10,
    clears,
    hint: run.hint(),
    ms: performance.now() - t0,
  };
}
