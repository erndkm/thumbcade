/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/clatterlane pilot [runs]`.
 * Plays whole runs with the pilot at each skill level, paced like the game, and prints the spread of run lengths,
 * strike and spare rates, chains and scores.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { SKILLS } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";

const runs = Number(process.argv[2] ?? 200);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const t0 = performance.now();

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const scores: number[] = [];
  const racks: number[] = [];
  const chains: number[] = [];
  let strikes = 0;
  let firsts = 0;
  let spares = 0;
  let leaves = 0;
  let splits = 0;
  let conv = 0;
  let gutters = 0;
  let balls = 0;
  let turkeys = 0;
  let minClock = Infinity;
  for (let i = 0; i < runs; i++) {
    const r = playRun(skill, createRng(1000 + i * 7919));
    secs.push(r.seconds);
    scores.push(r.score);
    racks.push(r.racks);
    chains.push(r.bestChain);
    strikes += r.strikes;
    firsts += r.strikes + r.spares + r.opens;
    spares += r.spares;
    leaves += r.spares + r.opens;
    splits += r.splits;
    conv += r.converted;
    gutters += r.gutters;
    balls += r.balls;
    if (r.bestChain >= 3) turkeys++;
    minClock = Math.min(minClock, r.minClock10);
  }
  for (const a of [secs, scores, racks, chains]) a.sort((x, y) => x - y);
  console.log(
    `${skill.name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` (min ${secs[0]!.toFixed(0)}, max ${secs[secs.length - 1]!.toFixed(0)})` +
      ` | racks ${pct(racks, 0.5)} | strikes ${((strikes / Math.max(1, firsts)) * 100).toFixed(0)}% · spares ${((spares / Math.max(1, leaves)) * 100).toFixed(0)}%` +
      ` | splits ${(splits / runs).toFixed(2)}/run, converted ${conv} | gutters ${((gutters / Math.max(1, balls)) * 100).toFixed(1)}%` +
      ` | best chain median ${pct(chains, 0.5)}, turkey+ in ${Math.round((turkeys / runs) * 100)}% | score ${pct(scores, 0.5)}` +
      ` | lowest clock in the first 10 s ${minClock.toFixed(1)} s`,
  );
}
console.log(`(${runs} runs per skill, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
