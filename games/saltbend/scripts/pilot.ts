/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/saltbend pilot [runs]`.
 * Plays whole runs at each skill level (plus an idle player and a random tapper, like the reviewer) and prints the
 * spread of run lengths (first tap to the crash), scores, distances and the reward beats per run.
 */
import { simulate, SKILLS, type SimResult } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 200);
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const med = (xs: number[]) => pct([...xs].sort((a, b) => a - b), 0.5);

function report(name: string, res: SimResult[]): void {
  const secs = res.map((r) => r.seconds).sort((a, b) => a - b);
  const early = res.filter((r) => r.early).length;
  const s = (f: (r: SimResult) => number) => med(res.map(f));
  const g = (k: keyof SimResult["stats"]["grades"]) => s((r) => r.stats.grades[k]);
  const wide = res.filter((r) => r.stats.end === "wide").length;
  console.log(
    `${name.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0).padStart(3)} s · median ${pct(secs, 0.5).toFixed(0).padStart(3)} s · p90 ${pct(secs, 0.9).toFixed(0).padStart(3)} s` +
      ` | score ${String(s((r) => r.score)).padStart(6)} | ${String(s((r) => r.metres)).padStart(5)} m | bends ${s((r) => r.stats.bends)}` +
      ` (paint ${g("paint")} kissed ${g("kissed")} tight ${g("tight")} clean ${g("clean")} wide ${g("wide")} gravel ${g("scraped")})` +
      ` | streak ${s((r) => r.stats.bestStreak)} ×${s((r) => r.stats.bestMult)} | lemons ${s((r) => r.stats.lemons)} gates ${s((r) => r.stats.gates)} saves ${s((r) => r.stats.saves)}` +
      ` | ends wide ${Math.round((wide / res.length) * 100)}% | in 10 s: ${early}`,
  );
}

console.log(`${runs} runs per level\n`);
for (const skill of SKILLS) report(skill.name, Array.from({ length: runs }, (_, i) => simulate(1000 + i * 7919, skill)));
report("idle", Array.from({ length: 40 }, (_, i) => simulate(1000 + i * 7919, null)));
report("tapper", Array.from({ length: 40 }, (_, i) => simulate(1000 + i * 7919, "tapper")));
