/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/clackwood pilot [runs]`.
 * Plays whole runs with the pilot at each skill level, on the same clock, aiming time, roll time (with the speed-up)
 * and rack drops a player gets, and prints the spread of run lengths, racks, pots and scores.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { SKILLS } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";

const runs = Number(process.argv[2] ?? 80);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const racks: number[] = [];
  const pots: number[] = [];
  const scores: number[] = [];
  const streaks: number[] = [];
  let minClock = Infinity;
  let shots = 0;
  let potShots = 0;
  let scratches = 0;
  let banks = 0;
  let multis = 0;
  let combos = 0;
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) {
    const r = playRun(skill, createRng(1000 + i * 7919), 17 + i * 101);
    secs.push(r.seconds);
    racks.push(r.racks);
    pots.push(r.pots);
    scores.push(r.score);
    streaks.push(r.bestStreak);
    minClock = Math.min(minClock, r.minClock10);
    shots += r.shots;
    potShots += r.potRate * r.shots;
    scratches += r.scratches;
    banks += r.banks;
    multis += r.multis;
    combos += r.combos;
  }
  for (const a of [secs, racks, pots, scores, streaks]) a.sort((x, y) => x - y);
  console.log(
    `${skill.name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | racks cleared median ${pct(racks, 0.5)} (p90 ${pct(racks, 0.9)}) | pots ${pct(pots, 0.5)} | best streak ${pct(streaks, 0.5)} | score ${pct(scores, 0.5)}` +
      ` | lowest clock in the first 10 s ${minClock.toFixed(1)} s`,
  );
  console.log(
    `        potting shots ${((potShots / shots) * 100).toFixed(0)}% of ${(shots / runs).toFixed(1)} shots/run · scratches ${(scratches / runs).toFixed(1)}/run · banks ${(banks / runs).toFixed(1)} · multi-pots ${(multis / runs).toFixed(1)} · combos ${(combos / runs).toFixed(1)} · ${((Date.now() - t0) / runs).toFixed(0)} ms/run`,
  );
}
