/**
 * Headless playtests: plays whole runs at every skill level and prints run lengths (first tap to game over, the
 * pauses between sheets included), sheets, triples and scores.
 *   pnpm --filter @thumbcade-games/overstamp playtest [runs]
 */
import { percentile, playRun, SKILLS } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 200);
const f = (n: number) => n.toFixed(0).padStart(3);
console.log(`${runs} runs per skill level\n`);
console.log("skill     run p10 / median / p90 s   sheets p50  triples p50  combo p50  score p50   ended full  lost by 10 s  clock at 10 s (min)");
const idle = playRun(null, 1);
for (const skill of SKILLS) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const full = res.filter((r) => r.why === "full").length;
  console.log(
    [
      skill.name.padEnd(9),
      `${f(percentile(secs, 0.1))} / ${f(percentile(secs, 0.5))} / ${f(percentile(secs, 0.9))}`.padEnd(26),
      String(percentile(res.map((r) => r.stats.sheets), 0.5)).padStart(10),
      String(percentile(res.map((r) => r.stats.triples), 0.5)).padStart(12),
      String(percentile(res.map((r) => r.stats.bestCombo), 0.5)).padStart(10),
      String(percentile(res.map((r) => r.score), 0.5)).padStart(10),
      `${((full / runs) * 100).toFixed(0)}% (fills ${percentile(res.map((r) => r.stats.fills), 0.5)}/${percentile(res.map((r) => r.stats.fills), 0.9)})`.padStart(12),
      `${res.filter((r) => r.lostBy10).length}`.padStart(13),
      Math.min(...res.map((r) => r.clockAt10)).toFixed(1).padStart(18),
    ].join(" "),
  );
}
console.log(`\nidle: the clock runs out after ${idle.seconds.toFixed(1)} s`);
