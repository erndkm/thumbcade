/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/spotfall pilot [runs]`.
 * Plays whole runs at each skill level (plus an idle player and a random tapper, like the reviewer) and prints the
 * spread of run lengths (first tap to the jam), scores and the reward beats per run.
 */
import { simulate, SKILLS, type SimResult } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 120);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const med = (xs: number[]) => pct([...xs].sort((a, b) => a - b), 0.5);

function report(name: string, res: SimResult[]): void {
  const secs = res.map((r) => r.seconds).sort((a, b) => a - b);
  const early = res.filter((r) => r.early).length;
  const s = (f: (r: SimResult) => number) => med(res.map(f));
  console.log(
    `${name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0).padStart(3)} s · median ${pct(secs, 0.5).toFixed(0).padStart(3)} s · p90 ${pct(secs, 0.9).toFixed(0).padStart(3)} s` +
      ` | score ${String(s((r) => r.score)).padStart(6)} | shots ${s((r) => r.stats.shots)} | popped ${s((r) => r.stats.popped)} dropped ${s((r) => r.stats.dropped)}` +
      ` | biggest drop ${s((r) => r.stats.biggestDrop)} | combo ${s((r) => r.stats.bestCombo)} | specials ${s((r) => r.stats.specials)}` +
      ` | clean sheets/run ${(res.reduce((a, r) => a + r.stats.cleans, 0) / res.length).toFixed(2)} | ended in 10 s: ${early}`,
  );
}

console.log(`${runs} runs per level\n`);
for (const skill of SKILLS) report(skill.name, Array.from({ length: runs }, (_, i) => simulate(1000 + i * 7919, skill)));
report("idle", Array.from({ length: 20 }, (_, i) => simulate(1000 + i * 7919, null)));
report("tapper", Array.from({ length: 40 }, (_, i) => simulate(1000 + i * 7919, "tapper")));
