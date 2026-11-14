/**
 * Headless pilot: the player models in src/pilot.ts play full runs against the real rules and dealer at four
 * skill levels, and the run lengths and what happened in them are printed.
 * `pnpm --filter @thumbcade-games/rowlock pilot [runs]` (default 200 per skill).
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Dealer } from "../src/gen.ts";
import { Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const RUNS = Number(process.argv[2] ?? 200);
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const band = (xs: number[]) => [0.1, 0.5, 0.9].map((x) => Math.round(q(xs, x))).join("/");

for (const skill of Object.values(SKILLS)) {
  const rows: Record<string, number[]> = { secs: [], score: [], solved: [], streak: [], wrong: [], locks: [], doubles: [], lamps: [], at10: [], marked: [] };
  for (let i = 0; i < RUNS; i++) {
    const dealer = new Dealer(1000 + i * 7919, 77 + (i % 9));
    const pilot = new Pilot(skill, createRng(9000 + i));
    let at10 = 0;
    const run = new Run((k) => dealer.get(k)).start();
    // Sample the clock at 10 s with a step hook.
    const step = run.step.bind(run);
    run.step = (dt: number) => {
      step(dt);
      if (!at10 && run.stats.seconds >= 10) at10 = run.over ? -1 : run.clock;
    };
    playRun(run, pilot);
    const s = run.stats;
    rows.secs!.push(s.seconds);
    rows.score!.push(run.score);
    rows.solved!.push(s.solved);
    rows.streak!.push(s.bestStreak);
    rows.wrong!.push(s.wrong);
    rows.locks!.push(s.locks);
    rows.doubles!.push(s.doubles + s.triples);
    rows.lamps!.push(s.lampsUsed);
    rows.marked!.push(s.marked);
    rows.at10!.push(at10);
  }
  console.log(
    `${skill.name.padEnd(7)} run s ${band(rows.secs!)}  score ${band(rows.score!)}  grids ${band(rows.solved!)}  best streak ${band(rows.streak!)}  wrong ${band(rows.wrong!)}  locks ${band(rows.locks!)}  combos ${band(rows.doubles!)}  lamps used ${band(rows.lamps!)}  marks ${band(rows.marked!)}  min clock at 10 s ${Math.min(...rows.at10!).toFixed(1)}`,
  );
}
