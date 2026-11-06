/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/lintstorm pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (and an idle thumb), and prints the spread of run lengths,
 * scores, bosses beaten and how the first ten seconds went.
 */
import { pct, playRun } from "../src/runs.ts";
import { SKILLS, type Skill } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 100);
const levels: Array<Skill | null> = [null, ...SKILLS];
console.log(`${runs} runs per level (seconds from the first tap to the last heart)\n`);
for (const skill of levels) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const scores = res.map((r) => r.score);
  const bosses = res.map((r) => r.stats.bosses);
  const first = res.map((r) => (r.firstHurt < 0 ? r.seconds : r.firstHurt));
  const died10 = res.filter((r) => r.diedBy10).length;
  const hurt10 = res.filter((r) => r.lostBy10 > 0).length;
  const hurtBy = { spark: 0, body: 0, boss: 0 };
  for (const r of res) for (const k of Object.keys(hurtBy) as Array<keyof typeof hurtBy>) hurtBy[k] += r.stats.hurt[k];
  const total = hurtBy.spark + hurtBy.body + hurtBy.boss || 1;
  console.log(
    `${(skill?.name ?? "idle").padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | score median ${pct(scores, 0.5)} | bosses median ${pct(bosses, 0.5)} (p90 ${pct(bosses, 0.9)})` +
      ` | first hit median ${pct(first, 0.5).toFixed(0)} s | lost a heart by 10 s ${((hurt10 / runs) * 100).toFixed(0)}% · died by 10 s ${died10}`,
  );
  console.log(
    `        hearts lost to sparks ${((hurtBy.spark / total) * 100).toFixed(0)}% · bodies ${((hurtBy.body / total) * 100).toFixed(0)}% · bosses ${((hurtBy.boss / total) * 100).toFixed(0)}%` +
      ` | max mult median ×${pct(res.map((r) => r.stats.maxMult), 0.5)} | power-ups median ${pct(res.map((r) => r.stats.powerups), 0.5)}`,
  );
}
