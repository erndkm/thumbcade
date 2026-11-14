/**
 * Headless playtests: plays whole runs at every skill level and prints run lengths (first tap to the bell, the pauses
 * while lines are marked and slips filed included), words, lines per word, streaks and scores.
 *   pnpm --filter @thumbcade-games/galley-proof playtest [runs]
 */
import { percentile, playRun, SKILLS } from "../src/pilot.ts";
import { loadLists } from "./lists.ts";

const runs = Number(process.argv[2] ?? 200);
const lists = loadLists();
const f = (n: number) => n.toFixed(0).padStart(3);
const t0 = performance.now();
console.log(`${runs} runs per skill level (the first slip is a daily word in half of them)\n`);
console.log("skill     run p10 / median / p90 s   words p50/p90  lines/word  misses p50  streak p50/p90  score p50   pencils used  shakes p50  lost by 10 s  clock at 10 s (min)");
for (const skill of SKILLS) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919, lists, { daily: i % 2 ? lists.answers[(i * 37) % lists.answers.length]! : null }));
  const secs = res.map((r) => r.seconds);
  const solved = res.reduce((a, r) => a + r.stats.words, 0);
  const lines = res.reduce((a, r) => a + r.stats.solvedLines, 0);
  console.log(
    [
      skill.name.padEnd(9),
      `${f(percentile(secs, 0.1))} / ${f(percentile(secs, 0.5))} / ${f(percentile(secs, 0.9))}`.padEnd(26),
      `${percentile(res.map((r) => r.stats.words), 0.5)}/${percentile(res.map((r) => r.stats.words), 0.9)}`.padStart(13),
      (lines / Math.max(1, solved)).toFixed(2).padStart(11),
      String(percentile(res.map((r) => r.stats.misses), 0.5)).padStart(11),
      `${percentile(res.map((r) => r.stats.bestStreak), 0.5)}/${percentile(res.map((r) => r.stats.bestStreak), 0.9)}`.padStart(15),
      String(percentile(res.map((r) => r.score), 0.5)).padStart(10),
      (res.reduce((a, r) => a + r.stats.pencilsUsed, 0) / runs).toFixed(2).padStart(14),
      String(percentile(res.map((r) => r.stats.unknown), 0.5)).padStart(11),
      `${res.filter((r) => r.lostBy10).length}`.padStart(13),
      Math.min(...res.map((r) => r.clockAt10)).toFixed(1).padStart(18),
    ].join(" "),
  );
  const none = res.filter((r) => r.stats.words === 0).length;
  const best = res.map((r) => r.stats.bestStreak);
  console.log(`          no word solved in ${((none / runs) * 100).toFixed(0)}% of runs; reached ×2 in ${pct(best, 2)}, ×3 in ${pct(best, 3)}, ×4 in ${pct(best, 5)}, ×5 in ${pct(best, 7)}`);
}
const idle = playRun(null, 1, lists);
console.log(`\nidle: the clock runs out after ${idle.seconds.toFixed(1)} s; ${((performance.now() - t0) / 1000).toFixed(1)} s for everything`);

function pct(xs: number[], at: number): string {
  return `${((xs.filter((x) => x >= at).length / xs.length) * 100).toFixed(0)}%`;
}
