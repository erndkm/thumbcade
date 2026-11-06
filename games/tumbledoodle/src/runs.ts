/**
 * Whole runs played headless by the pilot on the real 60 Hz world: used by the run-length script and the tests.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, type Skill } from "./pilot.ts";
import { Game, TOP } from "./sim.ts";

export interface RunReport {
  seconds: number;
  score: number;
  tier: number;
  eaten: number;
  scrubs: number;
  erasersEaten: number;
  bestCombo: number;
  feasts: number;
  topFeast: number;
  finalGulp: number;
  /** The clock 10 s into the run. */
  clock10: number;
  /** Seconds to reach each tier (NaN if never). */
  tierAt: number[];
}

/** `skill` null = an idle player who never touches the screen. */
export function playRun(skill: Skill | null, seed: number): RunReport {
  const g = new Game(seed);
  const pilot = skill ? new Pilot(skill, createRng(seed * 31 + 7), g) : null;
  const tierAt = Array.from({ length: TOP + 1 }, (_, i) => (i === 0 ? 0 : NaN));
  let clock10 = g.clock;
  let n = 0;
  while (g.phase !== "done" && g.time < 240) {
    let tx = g.hole.x;
    let ty = g.hole.y;
    if (pilot) {
      pilot.control(g);
      tx = pilot.x;
      ty = pilot.y;
    }
    g.step(tx, ty);
    for (const ev of g.events) if (ev.t === "tier") tierAt[ev.tier] = g.time;
    g.events.length = 0;
    if (g.time <= 10) clock10 = g.clock;
    if (++n % 60 === 0) g.compact();
  }
  const st = g.stats;
  return {
    seconds: g.time,
    score: g.score,
    tier: g.hole.tier,
    eaten: st.eaten,
    scrubs: st.scrubs,
    erasersEaten: st.erasersEaten,
    bestCombo: st.bestCombo,
    feasts: st.feasts,
    topFeast: st.topFeast,
    finalGulp: st.finalGulp,
    clock10,
    tierAt,
  };
}
