/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/curlwall pilot [runs]`.
 * Plays whole runs with the pilot at each skill level, counting the same seconds a player spends per kick
 * (setup, lining up, the flight, the result beat), and prints the spread of run lengths, kicks and scores.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { playRun } from "../src/runs.ts";
import { SKILLS } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 200);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const kicks: number[] = [];
  const scores: number[] = [];
  const goals: number[] = [];
  let corners = 0;
  let first10 = 0;
  const outcomes: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const r = playRun(skill, createRng(1000 + i * 7919));
    secs.push(r.seconds);
    kicks.push(r.kicks);
    scores.push(r.score);
    goals.push(r.goals);
    corners += r.corners;
    if (r.lostBy10s) first10++;
    for (const [k, v] of Object.entries(r.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + v;
  }
  for (const a of [secs, kicks, scores, goals]) a.sort((x, y) => x - y);
  const total = Object.values(outcomes).reduce((a, b) => a + b, 0);
  console.log(
    `${skill.name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | kicks median ${pct(kicks, 0.5)} | goals median ${pct(goals, 0.5)} | score median ${pct(scores, 0.5)} | corners/run ${(corners / runs).toFixed(1)}` +
      ` | a ball lost in the first 10 s: ${((first10 / runs) * 100).toFixed(0)}%`,
  );
  console.log(`        ${Object.entries(outcomes).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(0)}%`).join(" · ")}`);
}
