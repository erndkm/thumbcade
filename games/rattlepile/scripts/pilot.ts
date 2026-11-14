/**
 * Headless run lengths: `pnpm --filter @thumbcade-games/rattlepile pilot [runs]`.
 * Plays whole runs with the pilot at each skill level (and an idle thumb) and prints the spread of run lengths,
 * scores, rows survived and marbles collected.
 */
import { pct, playRun } from "../src/runs.ts";
import { SKILLS, type Skill } from "../src/pilot.ts";

const runs = Number(process.argv[2] ?? 60);
const levels: Array<Skill | null> = [null, ...SKILLS];
console.log(`${runs} runs per level (seconds from the first tap to the pile reaching the floor)\n`);
for (const skill of levels) {
  const res = Array.from({ length: runs }, (_, i) => playRun(skill, 1000 + i * 7919));
  const secs = res.map((r) => r.seconds);
  console.log(
    `${(skill?.name ?? "idle").padEnd(7)} run p10 ${pct(secs, 0.1).toFixed(0)} s · median ${pct(secs, 0.5).toFixed(0)} s · p90 ${pct(secs, 0.9).toFixed(0)} s · max ${Math.max(...secs).toFixed(0)} s` +
      ` | score median ${pct(res.map((r) => r.score), 0.5)} | rows median ${pct(res.map((r) => r.turn), 0.5)} | marbles median ${pct(res.map((r) => r.marbles), 0.5)}` +
      ` | best chain median ${pct(res.map((r) => r.stats.maxChain), 0.5)} | sweeps median ${pct(res.map((r) => r.stats.sweeps), 0.5)} | max mult median ×${pct(res.map((r) => r.stats.maxMult), 0.5)}` +
      ` | unfinished ${res.filter((r) => !r.over).length}`,
  );
}
