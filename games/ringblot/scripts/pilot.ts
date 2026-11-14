/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/ringblot pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (plus an idle thumb and one that swipes at random) and prints
 * the spread of run lengths, scores, sheets reached and how the lines fared.
 */
import { pct, playRun } from "../src/runs.ts";
import { SKILLS, type Skill } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 100);
const levels: Array<Skill | null | "random"> = [null, "random", ...SKILLS];
console.log(`${runs} runs per level (seconds from the first tap until the ink is dry)\n`);
for (const skill of levels) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const name = skill === null ? "idle" : skill === "random" ? "random" : skill.name;
  const reached2 = res.filter((r) => r.sheet >= 2).length;
  console.log(
    `${name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s · max ${Math.max(...secs).toFixed(0)} s` +
      ` | score median ${pct(res.map((r) => r.score), 0.5)} | sheet median ${pct(res.map((r) => r.sheet), 0.5)} (p90 ${pct(res.map((r) => r.sheet), 0.9)}) · reached sheet 2: ${((reached2 / runs) * 100).toFixed(0)}%` +
      ` at median ${pct(res.filter((r) => r.sheet2At > 0).map((r) => r.sheet2At), 0.5)?.toFixed(0) ?? "-"} s` +
      ` | prints median ${pct(res.map((r) => r.stats.prints), 0.5)} · biggest ${pct(res.map((r) => r.stats.biggest), 0.5)} · smudges dealt ${pct(res.map((r) => r.stats.smudges), 0.5)} · suffered ${pct(res.map((r) => r.stats.smudged), 0.5)} · self ${pct(res.map((r) => r.stats.selfCuts), 0.5)}` +
      ` | unfinished ${res.filter((r) => !r.over).length}`,
  );
}
