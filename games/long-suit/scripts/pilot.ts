/**
 * Headless pilot: the player models in src/pilot.ts play full runs against the real rules and dealer at four
 * skill levels, and the run lengths and what happened in them are printed. Idle runs and runs of random tapping
 * follow. `pnpm --filter @thumbcade-games/long-suit pilot [runs]` (default 200 per skill).
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run, type Target } from "../src/run.ts";

const RUNS = Number(process.argv[2] ?? 200);
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const band = (xs: number[]) => [0.1, 0.5, 0.9].map((x) => Math.round(q(xs, x))).join("/");

for (const skill of Object.values(SKILLS)) {
  const rows: Record<string, number[]> = { secs: [], score: [], deals: [], home: [], flips: [], taps: [], duds: [], chain: [], mult: [], afresh: [], at10: [] };
  for (let i = 0; i < RUNS; i++) {
    const run = new Run(1000 + i * 7919);
    let at10 = -1;
    const step = run.step.bind(run);
    run.step = (dt: number) => {
      step(dt);
      if (at10 < 0 && run.time >= 10) at10 = run.clock;
    };
    playRun(run, new Pilot(skill, createRng(9000 + i)));
    const s = run.stats;
    rows.secs!.push(s.seconds);
    rows.score!.push(run.score);
    rows.deals!.push(s.deals);
    rows.home!.push(s.home);
    rows.flips!.push(s.flips);
    rows.taps!.push(s.taps);
    rows.duds!.push(s.duds);
    rows.chain!.push(s.bestChain);
    rows.mult!.push(s.bestMult);
    rows.afresh!.push(s.afresh);
    rows.at10!.push(at10);
  }
  console.log(
    `${skill.name.padEnd(7)} run s ${band(rows.secs!)} (max ${Math.max(...rows.secs!).toFixed(0)})  score ${band(rows.score!)}  deals ${band(rows.deals!)}  home ${band(rows.home!)}  turned up ${band(rows.flips!)}  taps ${band(rows.taps!)}  duds ${band(rows.duds!)}  best chain ${band(rows.chain!)}  mult ${band(rows.mult!)}  dealt afresh ${(rows.afresh!.reduce((a, b) => a + b, 0) / RUNS).toFixed(2)}/run  min clock at 10 s ${Math.min(...rows.at10!).toFixed(1)}`,
  );
}

const idle: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const run = new Run(1000 + i * 7919).start();
  while (!run.over && run.time < 300) run.step(1 / 60);
  idle.push(run.time);
}
console.log(`idle    ends after ${Math.min(...idle).toFixed(1)}-${Math.max(...idle).toFixed(1)} s over ${RUNS} seeds`);

const flail: number[] = [];
for (let i = 0; i < 100; i++) {
  const rng = createRng(555 + i);
  const run = new Run(31 + i * 13).start();
  let t = 0;
  while (!run.over && run.time < 300) {
    t += 1 / 60;
    if (t >= 0.25) {
      t = 0;
      const r = rng();
      const target: Target = r < 0.25 ? { kind: "stock" } : r < 0.35 ? { kind: "waste" } : { kind: "col", col: rng.int(0, run.table.cols.length - 1), index: rng.int(0, 3) };
      run.tap(target);
    }
    run.think(Infinity);
    run.step(1 / 60);
  }
  flail.push(run.time);
}
console.log(`flail   run s ${band(flail)} (max ${Math.max(...flail).toFixed(1)})`);
