/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/snapwad pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (and an idle player) on the real physics and prints the spread
 * of run lengths, pages cleared, scores, chains, one-shot pages and the wads in hand at 10 s.
 */
import { SKILLS } from "../src/pilot.ts";
import { playRun, type RunReport } from "../src/runs.ts";

const runs = Number(process.argv[2] ?? 200);
const only = process.argv[3];
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const row = (name: string, rs: RunReport[]) => {
  const col = <K extends keyof RunReport>(k: K) => rs.map((r) => r[k] as number);
  const secs = col("seconds");
  const pages = col("pages");
  const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
  console.log(
    `${name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s (min ${Math.min(...secs).toFixed(0)}, max ${Math.max(...secs).toFixed(0)})` +
      ` | pages p10/med/p90 ${pct(pages, 0.1)}/${pct(pages, 0.5)}/${pct(pages, 0.9)} | score med ${pct(col("score"), 0.5)} (p90 ${pct(col("score"), 0.9)})`,
  );
  console.log(
    `        shots med ${pct(col("shots"), 0.5)} | kos ${pct(col("kos"), 0.5)} | best chain med ${pct(col("bestChain"), 0.5)} (p90 ${pct(col("bestChain"), 0.9)}) | one-shot pages ${mean(col("oneShots"))}/run | stars ${mean(col("stars"))} | tapes ${mean(col("tapes"))}` +
      ` | drains ${mean(col("drains"))} | biggest topple med ${pct(col("biggestTopple"), 0.5)} | wads at 10 s min ${Math.min(...col("ammo10"))} | first clear med ${pct(rs.map((r) => r.clears[0] ?? NaN).filter((x) => !Number.isNaN(x)), 0.5)?.toFixed(1)} s | ms/run ${mean(col("ms"))}`,
  );
};

const t0 = Date.now();
for (const skill of Object.values(SKILLS)) {
  if (only && skill.name !== only) continue;
  row(skill.name, Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919)));
}
if (!only) row("idle", Array.from({ length: Math.min(runs, 20) }, (_, i) => playRun(null, 1000 + i * 7919)));
console.log(`(${runs} runs per skill, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
