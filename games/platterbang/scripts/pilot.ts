/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/platterbang pilot [runs]`.
 * Plays whole runs at every skill level (and an idle thumb) and prints run lengths (first tap to the end, the pauses
 * between walls included), walls cleared, jars, smashes, the best multiplier, saves, how runs ended, and the first
 * ten seconds.
 */
import { percentile, playRun, SKILLS } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 200);
const f = (n: number) => n.toFixed(0).padStart(3);
console.log(`${runs} runs per skill level\n`);
console.log("skill     run p10 / median / p90 s   walls p50  jars p50  smashes p50  best × p50  score p50  ended full  saves p50  shelf peak p50/p90  lost by 10 s  clock at 10 s (min)");
const idle = playRun(null, 1);
for (const skill of SKILLS) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const full = res.filter((r) => r.why === "full").length;
  console.log(
    [
      skill.name.padEnd(9),
      `${f(percentile(secs, 0.1))} / ${f(percentile(secs, 0.5))} / ${f(percentile(secs, 0.9))}`.padEnd(26),
      String(percentile(res.map((r) => r.stats.walls), 0.5)).padStart(9),
      String(percentile(res.map((r) => r.stats.ships), 0.5)).padStart(9),
      String(percentile(res.map((r) => r.stats.drops), 0.5)).padStart(12),
      `×${percentile(res.map((r) => r.stats.bestMult), 0.5)}`.padStart(11),
      String(percentile(res.map((r) => r.score), 0.5)).padStart(10),
      `${((full / runs) * 100).toFixed(0)}%`.padStart(11),
      String(percentile(res.map((r) => r.stats.saves), 0.5)).padStart(10),
      `${percentile(res.map((r) => r.stats.peakShelf), 0.5)}/${percentile(res.map((r) => r.stats.peakShelf), 0.9)}`.padStart(18),
      `${res.filter((r) => r.lostBy10).length}`.padStart(13),
      Math.min(...res.map((r) => r.clockAt10)).toFixed(1).padStart(18),
    ].join(" "),
  );
}
console.log(`\nidle: the clock runs out after ${idle.seconds.toFixed(1)} s`);
