/**
 * Headless pilot: the player models in src/pilot.ts play full runs against the real rules at four skill levels,
 * and the run lengths and what happened in them are printed. An idle run and a run of random flailing follow.
 * `pnpm --filter @thumbcade-games/hotband pilot [runs]` (default 200 per skill).
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const RUNS = Number(process.argv[2] ?? 200);
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const band = (xs: number[]) => [0.1, 0.5, 0.9].map((x) => Math.round(q(xs, x))).join("/");

for (const skill of Object.values(SKILLS)) {
  const rows: Record<string, number[]> = { secs: [], score: [], rows: [], chain: [], gain: [], hot: [], level: [], pieces: [], noise: [], cut: [] };
  let early = 0;
  for (let i = 0; i < RUNS; i++) {
    const run = new Run(1000 + i * 7919);
    playRun(run, new Pilot(skill, createRng(9000 + i)));
    const s = run.stats;
    if (s.seconds < 10) early++;
    rows.secs!.push(s.seconds);
    rows.score!.push(run.score);
    rows.rows!.push(s.rows);
    rows.chain!.push(s.bestChain);
    rows.gain!.push(s.bestGain);
    rows.hot!.push(s.hot);
    rows.level!.push(run.level);
    rows.pieces!.push(s.pieces);
    rows.noise!.push(s.noisePushed);
    rows.cut!.push(s.noiseCut);
  }
  console.log(
    `${skill.name.padEnd(7)} run s ${band(rows.secs!)}  score ${band(rows.score!)}  rows ${band(rows.rows!)}  best chain ${band(rows.chain!)}  gain ${band(rows.gain!)}  hot ${band(rows.hot!)}  level ${band(rows.level!)}  pieces ${band(rows.pieces!)}  noise in/cut ${band(rows.noise!)} / ${band(rows.cut!)}  over before 10 s: ${early}`,
  );
}

// Nobody touches the screen.
const idle = new Run(4242).start();
while (!idle.over && idle.time < 300) idle.step(1 / 60);
console.log(`idle    ends after ${idle.time.toFixed(1)} s, ${idle.stats.pieces} pieces`);

// Random taps and swipes, four a second, like the reviewer's script.
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
      if (r < 0.55) run.rotate();
      else if (r < 0.7) run.slam();
      else run.shift(rng.int(-3, 3));
    }
    run.step(1 / 60);
  }
  flail.push(run.time);
}
console.log(`flail   run s ${band(flail)} (max ${Math.max(...flail).toFixed(1)})`);
