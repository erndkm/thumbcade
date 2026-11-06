/**
 * Headless playtests: plays runs at every skill level and prints run length and score.
 *   pnpm --filter @thumbcade-games/brinebop playtest [runs]
 */
import { median, simulate, SKILLS } from "../src/sim.ts";

const runs = Number(process.argv[2] ?? 30);
console.log(`${runs} runs per skill level (seconds from the first tap to the end of the cash-out)\n`);
console.log("skill        median s  min-max s   median score  chain  specials  bonus s  cash-out");
for (const skill of SKILLS) {
  const res = Array.from({ length: runs }, (_, i) => simulate(1000 + i * 7919, skill));
  const secs = res.map((r) => r.seconds);
  const line = [
    skill.name.padEnd(12),
    median(secs).toFixed(1).padStart(8),
    `${Math.min(...secs).toFixed(0)}-${Math.max(...secs).toFixed(0)}`.padStart(10),
    median(res.map((r) => r.score)).toFixed(0).padStart(14),
    median(res.map((r) => r.stats.biggestChain)).toFixed(0).padStart(6),
    median(res.map((r) => r.stats.specialsMade)).toFixed(0).padStart(9),
    median(res.map((r) => r.stats.bonusTime)).toFixed(0).padStart(8),
    median(res.map((r) => r.stats.cashout)).toFixed(0).padStart(9),
  ];
  console.log(line.join(" "));
}
