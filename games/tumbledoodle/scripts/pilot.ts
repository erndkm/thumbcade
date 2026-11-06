/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/tumbledoodle pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (and an idle player) on the real world and prints the spread
 * of run lengths, tiers, scores, eraser scrubs and catches, combos and the final gulp.
 */
import { SKILLS } from "../src/pilot.ts";
import { playRun, type RunReport } from "../src/runs.ts";

const runs = Number(process.argv[2] ?? 200);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const row = (name: string, rs: RunReport[]) => {
  const col = <K extends keyof RunReport>(k: K) => rs.map((r) => r[k] as number);
  const secs = col("seconds");
  const tiers = col("tier").map((t) => t + 1);
  const tierHist = [1, 2, 3, 4, 5, 6, 7].map((t) => `${t}:${Math.round((tiers.filter((x) => x === t).length / rs.length) * 100)}%`).join(" ");
  const reach = (t: number) => {
    const xs = rs.map((r) => r.tierAt[t]!).filter((x) => !Number.isNaN(x));
    return xs.length ? `${pct(xs, 0.5).toFixed(0)}s(${Math.round((xs.length / rs.length) * 100)}%)` : "-";
  };
  console.log(
    `${name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s (min ${Math.min(...secs).toFixed(0)}, max ${Math.max(...secs).toFixed(0)})` +
      ` | score p10/med/p90 ${pct(col("score"), 0.1)}/${pct(col("score"), 0.5)}/${pct(col("score"), 0.9)}` +
      ` | eaten ${pct(col("eaten"), 0.5)} | scrubs ${pct(col("scrubs"), 0.5)} (p90 ${pct(col("scrubs"), 0.9)}) | erasers eaten ${(col("erasersEaten").reduce((a, b) => a + b, 0) / rs.length).toFixed(2)}/run`,
  );
  console.log(
    `        final tier ${tierHist} | tier reached at (median, share): ${[2, 3, 4, 5, 6].map((t) => `${t + 1}:${reach(t)}`).join(" ")}` +
      ` | best combo ${pct(col("bestCombo"), 0.5)} | feasts ${pct(col("feasts"), 0.5)} | top feast ${pct(col("topFeast"), 0.5)} | final gulp ${pct(col("finalGulp"), 0.5)} | clock at 10 s min ${Math.min(...col("clock10")).toFixed(1)}`,
  );
};

const t0 = Date.now();
for (const skill of Object.values(SKILLS)) row(skill.name, Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919)));
row("idle", Array.from({ length: Math.min(runs, 40) }, (_, i) => playRun(null, 1000 + i * 7919)));
console.log(`(${runs} runs per skill, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
