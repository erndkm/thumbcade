/**
 * Headless pilot: the player models in src/pilot.ts play full runs against the real rules and dealer at four
 * skill levels, and the run lengths and what happened in them are printed. An idle run and a run of random
 * tapping follow. `pnpm --filter @thumbcade-games/scootpurr pilot [runs]` (default 200 per skill).
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const RUNS = Number(process.argv[2] ?? 200);
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const band = (xs: number[]) => [0.1, 0.5, 0.9].map((x) => Math.round(q(xs, x))).join("/");

for (const skill of Object.values(SKILLS)) {
  const rows: Record<string, number[]> = { secs: [], score: [], rugs: [], cats: [], bumps: [], streak: [], purr: [], clean: [], last: [], at10: [] };
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
    rows.rugs!.push(s.rugs);
    rows.cats!.push(s.cats);
    rows.bumps!.push(s.bumps);
    rows.streak!.push(s.bestStreak);
    rows.purr!.push(s.bestPurr);
    rows.clean!.push(s.cleanRugs);
    rows.last!.push(s.lastOut);
    rows.at10!.push(at10);
  }
  console.log(
    `${skill.name.padEnd(7)} run s ${band(rows.secs!)}  score ${band(rows.score!)}  rugs ${band(rows.rugs!)}  cats ${band(rows.cats!)}  bumps ${band(rows.bumps!)}  best streak ${band(rows.streak!)}  purr ${band(rows.purr!)}  clean rugs ${band(rows.clean!)}  witch's cat last ${band(rows.last!)}  min candle at 10 s ${Math.min(...rows.at10!).toFixed(1)}`,
  );
}

const idle = new Run(4242).start();
while (!idle.over && idle.time < 300) idle.step(1 / 60);
console.log(`idle    ends after ${idle.time.toFixed(1)} s`);

const flail: number[] = [];
let early = 0;
for (let i = 0; i < 100; i++) {
  const rng = createRng(555 + i);
  const run = new Run(31 + i * 13).start();
  let t = 0;
  while (!run.over && run.time < 300) {
    t += 1 / 60;
    if (t >= 0.25) {
      t = 0;
      const left = run.board.cats.filter((c) => !c.out);
      if (left.length && rng.chance(0.7)) run.tap(rng.pick(left).id);
    }
    run.step(1 / 60);
  }
  if (run.time < 10) early++;
  flail.push(run.time);
}
console.log(`flail   run s ${band(flail)} (max ${Math.max(...flail).toFixed(1)}), over before 10 s: ${early}`);
