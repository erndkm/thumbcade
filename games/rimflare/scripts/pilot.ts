/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/rimflare pilot [runs]`.
 * Plays whole runs with the pilot at each skill level, on the same clock, reloads and stage changes a player gets,
 * and prints the spread of run lengths, make rates per stage, shot types and scores.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { SKILLS } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";

const runs = Number(process.argv[2] ?? 200);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const scores: number[] = [];
  const makes: number[] = [];
  const stages: number[] = [];
  const streaks: number[] = [];
  const st: Array<[number, number]> = [];
  const out: Record<string, number> = {};
  let minClock = Infinity;
  let beaters = 0;
  for (let i = 0; i < runs; i++) {
    const r = playRun(skill, createRng(1000 + i * 7919));
    secs.push(r.seconds);
    scores.push(r.score);
    makes.push(r.makes);
    stages.push(r.stage + 1);
    streaks.push(r.bestStreak);
    minClock = Math.min(minClock, r.minClock10);
    beaters += r.buzzerBeaters;
    r.perStage.forEach(([m, s], k) => {
      st[k] ??= [0, 0];
      st[k][0] += m;
      st[k][1] += s;
    });
    for (const [k, v] of Object.entries(r.outcomes)) out[k] = (out[k] ?? 0) + v;
  }
  for (const a of [secs, scores, makes, stages, streaks]) a.sort((x, y) => x - y);
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  console.log(
    `${skill.name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | stage median ${pct(stages, 0.5)} (p90 ${pct(stages, 0.9)}) | makes ${pct(makes, 0.5)} | best streak ${pct(streaks, 0.5)} | score ${pct(scores, 0.5)}` +
      ` | lowest clock in the first 10 s ${minClock.toFixed(1)} s | buzzer beaters ${(beaters / runs).toFixed(2)}/run`,
  );
  console.log(`        ${Object.entries(out).map(([k, v]) => `${k} ${((v / total) * 100).toFixed(0)}%`).join(" · ")}`);
  console.log(`        make rate by stage: ${st.slice(0, 9).map(([m, s], k) => `${k + 1}:${s ? Math.round((m / s) * 100) : 0}%(${s})`).join(" ")}`);
}
