/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/scribbledelve pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (plus an idle thumb and one that swipes at random) and prints
 * the spread of run lengths, scores, floors reached and what caught the knight.
 */
import { pct, playRun } from "../src/runs.ts";
import { SKILLS, type Skill } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 60);
const levels: Array<Skill | null | "random"> = [null, "random", ...SKILLS];
console.log(`${runs} runs per level (seconds from the first tap to the last heart)\n`);
for (const skill of levels) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const by = [0, 0, 0, 0];
  for (const r of res) r.stats.caughtBy.forEach((n, i) => (by[i]! += n));
  const total = by.reduce((a, b) => a + b, 0) || 1;
  const name = skill === null ? "idle" : skill === "random" ? "random" : skill.name;
  console.log(
    `${name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s · max ${Math.max(...secs).toFixed(0)} s` +
      ` | score median ${pct(res.map((r) => r.score), 0.5)} | floor median ${pct(res.map((r) => r.floor), 0.5)} (p90 ${pct(res.map((r) => r.floor), 0.9)})` +
      ` | first heart lost median ${pct(res.map((r) => (r.firstCaught < 0 ? r.seconds : r.firstCaught)), 0.5).toFixed(0)} s` +
      ` | poofs median ${pct(res.map((r) => r.stats.poofs), 0.5)} | max streak median ${pct(res.map((r) => r.stats.maxStreak), 0.5)} | shaves median ${pct(res.map((r) => r.stats.shaves), 0.5)}` +
      ` | caught by grumble ${((by[0]! / total) * 100).toFixed(0)}% sneak ${((by[1]! / total) * 100).toFixed(0)}% dither ${((by[2]! / total) * 100).toFixed(0)}% lurk ${((by[3]! / total) * 100).toFixed(0)}%` +
      ` | unfinished ${res.filter((r) => !r.over).length}`,
  );
}
