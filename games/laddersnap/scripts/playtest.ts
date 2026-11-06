/**
 * Headless playtest: the pilots in src/pilot.ts play full runs against the real rules and dealer, at four skill
 * levels, and the run lengths are printed. `pnpm --filter @thumbcade-games/laddersnap playtest [runs]`.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Dealer } from "../src/deal.ts";
import { act, Pilot, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const RUNS = Number(process.argv[2] ?? 60);
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

for (const skill of Object.values(SKILLS)) {
  const secs: number[] = [];
  const scores: number[] = [];
  const cleared: number[] = [];
  const streaks: number[] = [];
  const firstTen: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const dealer = new Dealer(createRng(1000 + i));
    const pilot = new Pilot(skill, createRng(9000 + i));
    const run = new Run((k) => dealer.get(k)).start();
    let clockAt10 = 0;
    for (let f = 0; f < 400 * 60 && !run.over; f++) {
      run.step(1 / 60);
      act(run, pilot.update(run, 1 / 60));
      if (f === 600) clockAt10 = run.clock;
    }
    secs.push(run.stats.seconds);
    scores.push(run.score);
    cleared.push(run.stats.cleared);
    streaks.push(run.stats.bestStreak);
    firstTen.push(clockAt10);
  }
  const p = (xs: number[]) => [0.1, 0.5, 0.9].map((x) => Math.round(q(xs, x))).join(" / ");
  console.log(
    `${skill.name.padEnd(8)} run s ${p(secs)}  score ${p(scores)}  hands cleared ${p(cleared)}  best streak ${p(streaks)}  clock left at 10 s (min) ${Math.min(...firstTen).toFixed(1)}`,
  );
}
