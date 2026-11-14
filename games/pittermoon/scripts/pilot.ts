/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/pittermoon pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (and an idle cat, and the reviewer's scripted taps) and prints
 * the spread of run lengths, rows, scores and what happened on the way.
 */
import { pct, playRun, SKILLS, type Skill } from "../src/sim.ts";

const runs = Number(process.argv[2] ?? 100);
console.log(`${runs} runs per skill (seconds from the first tap to sunrise)\n`);
for (const skill of [...SKILLS, "scripted"] as Skill[]) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const m = (f: (r: (typeof res)[number]) => number) => pct(res.map(f), 0.5);
  const bonks = (r: (typeof res)[number]) => Object.values(r.stats.bonks).reduce((a, b) => a + b, 0);
  console.log(
    `${skill.padEnd(8)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s · min ${Math.min(...secs).toFixed(0)} s` +
      ` | rows ${m((r) => r.rows)} (p90 ${pct(res.map((r) => r.rows), 0.9)}) · score ${m((r) => r.score)} · gap at 10 s ${Math.min(...res.map((r) => r.gapAt10)).toFixed(1)}`,
  );
  console.log(
    `         bonks ${m(bonks)} · splashes ${m((r) => r.stats.splashes)} · sinks ${m((r) => r.stats.sinks)} · whiskers ${m((r) => r.stats.whiskers)} · fish ${m((r) => r.stats.fish)} · lifts ${m((r) => r.stats.lifts)}` +
      ` · best streak ${m((r) => r.stats.bestStreak)} · tier x2 ${pc(res, (r) => r.stats.maxTier >= 1)} x3 ${pc(res, (r) => r.stats.maxTier >= 2)} x4 ${pc(res, (r) => r.stats.maxTier >= 3)}` +
      ` · stretches ${m((r) => r.stats.stretches)} · escapes ${m((r) => r.stats.escapes)}`,
  );
}

function pc<T>(xs: T[], f: (x: T) => boolean): string {
  return `${Math.round((xs.filter(f).length / xs.length) * 100)}%`;
}
