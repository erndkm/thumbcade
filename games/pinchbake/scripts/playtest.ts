/**
 * Headless playtests: plays runs at every skill level and prints run length, score and what got made.
 *   pnpm --filter @thumbcade-games/pinchbake playtest [runs]
 */
import { median, quantile, simulate, SKILLS } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 40);
console.log(`${runs} runs per skill level (seconds from the first tap to the spill)\n`);
console.log("skill         p10   p50   p90  min-max    score  drops merges chain  top    cakes  scares  safe10");
for (const skill of SKILLS) {
  const t0 = performance.now();
  const res = Array.from({ length: runs }, (_, i) => simulate(1000 + i * 7919, skill));
  const ms = (performance.now() - t0) / runs;
  const secs = res.map((r) => r.seconds);
  const st = res.map((r) => r.run.stats);
  const line = [
    skill.name.padEnd(12),
    quantile(secs, 0.1).toFixed(0).padStart(5),
    median(secs).toFixed(0).padStart(5),
    quantile(secs, 0.9).toFixed(0).padStart(5),
    `${Math.min(...secs).toFixed(0)}-${Math.max(...secs).toFixed(0)}`.padStart(8),
    median(res.map((r) => r.score)).toFixed(0).padStart(8),
    median(st.map((s) => s.drops)).toFixed(0).padStart(6),
    median(st.map((s) => s.merges)).toFixed(0).padStart(6),
    median(st.map((s) => s.biggestChain)).toFixed(0).padStart(6),
    median(st.map((s) => s.highest)).toFixed(0).padStart(4),
    String(st.reduce((a, s) => a + s.cakes, 0)).padStart(9),
    median(st.map((s) => s.scares)).toFixed(0).padStart(7),
    `${secs.filter((s) => s > 10).length}/${runs}`.padStart(7),
    `  ${ms.toFixed(0)} ms/run`,
  ];
  console.log(line.join(" "));
}
