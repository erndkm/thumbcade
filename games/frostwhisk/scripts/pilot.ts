/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/frostwhisk pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (and an idle cat) and prints the spread of run lengths, how far
 * up the ladder each got, goals for and against, and scores.
 */
import { CRITTERS } from "../src/ai.ts";
import { pct, playRun, SKILLS } from "../src/sim.ts";

const runs = Number(process.argv[2] ?? 100);
console.log(`${runs} runs per skill (seconds from the first tap to game over)\n`);
for (const skill of SKILLS) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  const kos = res.map((r) => r.stats.kos);
  const champs = res.filter((r) => r.stats.champion).length;
  const reachedBy = CRITTERS.map((_, i) => res.filter((r) => r.reached >= i).length);
  const low10 = Math.min(...res.map((r) => r.clockAt10));
  console.log(
    `${skill.padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s` +
      ` | KOs median ${pct(kos, 0.5)} · champion ${((champs / runs) * 100).toFixed(0)}%` +
      ` | goals ${pct(res.map((r) => r.stats.goals), 0.5)} for, ${pct(res.map((r) => r.stats.against), 0.5)} against` +
      ` | score median ${pct(res.map((r) => r.score), 0.5)} | lowest clock at 10 s ${low10.toFixed(1)} s`,
  );
  console.log(
    `        reached ${CRITTERS.map((c, i) => `${c.id} ${((reachedBy[i]! / runs) * 100).toFixed(0)}%`).join(" · ")}` +
      ` | banks ${pct(res.map((r) => r.stats.banks), 0.5)} · zingers ${pct(res.map((r) => r.stats.zingers), 0.5)} · blocks ${pct(res.map((r) => r.stats.blocks), 0.5)} · best streak ${pct(res.map((r) => r.stats.bestStreak), 0.5)}`,
  );
}
