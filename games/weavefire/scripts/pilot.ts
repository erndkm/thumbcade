/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/weavefire pilot [runs] [fieldH]`.
 * Plays whole runs with the pilot at each skill level and prints the spread of run lengths, scores and what happened.
 */
import { playRun } from "../src/runs.ts";
import { SKILLS } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 60);
const fieldH = Number(process.argv[3] ?? 696);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(Math.round(n)));

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const scores: number[] = [];
  let boss = 0;
  let early = 0;
  let grazes = 0;
  let mult = 0;
  let level = 0;
  let bossLeft = 0;
  let met = 0;
  const t0 = performance.now();
  const ends: Record<string, number> = {};
  const hitAt: number[] = [];
  for (let i = 0; i < runs; i++) {
    const r = playRun(skill, 1000 + i * 7919, fieldH);
    secs.push(r.seconds);
    scores.push(r.score);
    boss += r.stats.bossesKilled;
    if (r.hitsBy10 > 0) early++;
    ends[r.endedIn] = (ends[r.endedIn] ?? 0) + 1;
    hitAt.push(...r.hitTimes);
    grazes += r.stats.grazes;
    mult += r.stats.maxMult;
    level += r.stats.peakLevel;
    if (r.stats.bossLeft >= 0) {
      met++;
      bossLeft += r.stats.bossLeft;
    }
  }
  secs.sort((a, b) => a - b);
  scores.sort((a, b) => a - b);
  console.log(
    `${skill.name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | score median ${fmt(pct(scores, 0.5))} | met the Loom ${((met / runs) * 100).toFixed(0)}% · killed ${boss}x · avg left ${met ? ((bossLeft / met) * 100).toFixed(0) : "-"}%` +
      ` | hit in first 10 s ${((early / runs) * 100).toFixed(0)}% | grazes ${(grazes / runs).toFixed(0)} · max mult ${(mult / runs).toFixed(1)} · peak gun ${(level / runs).toFixed(1)}` +
      ` | ${((performance.now() - t0) / runs).toFixed(0)} ms/run`,
  );
  if (process.env.DETAIL) {
    const buckets = new Array<number>(12).fill(0);
    for (const t of hitAt) buckets[Math.min(11, Math.floor(t / 10))]!++;
    console.log(`        ends ${JSON.stringify(ends)}\n        hits per 10 s ${buckets.join(" ")}`);
  }
}
