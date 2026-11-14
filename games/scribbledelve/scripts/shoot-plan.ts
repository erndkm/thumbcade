/**
 * Writes shoot.qa.json: screenshots of a whole run played by the expert pilot. The review harness launches every game
 * with seed 1234 and a `VITE_AUTOPLAY=expert` build plays its run in lockstep (sixty looks a second, no hit-stop), so
 * this replays the same run headless and puts the shots on a coin streak, the sword in hand, a scribble being poofed,
 * the second and third floors and the game-over card.
 *
 *   pnpm exec tsx games/scribbledelve/scripts/shoot-plan.ts
 *   (cd games/scribbledelve && VITE_AUTOPLAY=expert pnpm exec vite build --outDir <somewhere outside the package>)
 *   pnpm --filter @thumbcade/reviewer shoot <that folder> --slug scribbledelve --actions ../../games/scribbledelve/shoot.qa.json --out ../../docs/screenshots/games
 */
import { writeFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, SKILLS } from "../src/pilot.ts";
import { QA_PILOT_SEED, runSeed } from "../src/runs.ts";
import { Sim } from "../src/sim.ts";

const HARNESS_SEED = 1234;
const sim = new Sim({ seed: runSeed(HARNESS_SEED, 1) });
const pilot = new Pilot(SKILLS.find((s) => s.name === "expert")!, createRng(QA_PILOT_SEED));
const at: Record<string, number> = {};
const mark = (name: string, t: number) => {
  if (at[name] === undefined) at[name] = t;
};
while (!sim.over && sim.t < 400) {
  pilot.step(sim, 1 / 60);
  sim.step(1 / 60);
  for (const e of sim.events) {
    if (e.k === "sword") mark("sword", sim.t + 0.9);
    if (e.k === "poof") mark("poof", sim.t + 0.2);
    if (e.k === "tier" && e.mult >= 2) mark("streak", sim.t + 0.5);
    if (e.k === "floor" && e.floor === 2) mark("floor2", sim.t + 4.5);
    if (e.k === "floor" && e.floor === 3) mark("late", sim.t + 7);
    if (e.k === "over") mark("over", sim.t + 2.4);
  }
  sim.events.length = 0;
}
// Shots less than a quarter of a second apart can't both be taken: keep the earlier one.
const shots = Object.entries(at)
  .sort((a, b) => a[1] - b[1])
  .filter(([, t], i, all) => i === 0 || t - all[i - 1]![1] > 0.25);
type Action = { wait: number } | { tap: [number, number] } | { shot: string };
// The run starts on the tap; the tap itself takes about a tenth of a second to land.
const actions: Action[] = [{ wait: 1500 }, { tap: [160, 420] }];
let clock = -0.1;
for (const [name, t] of shots) {
  actions.push({ wait: Math.max(50, Math.round((t - clock) * 1000)) }, { shot: name });
  clock = t;
}
writeFileSync(new URL("../shoot.qa.json", import.meta.url), `[\n${actions.map((a) => `  ${JSON.stringify(a)}`).join(",\n")}\n]\n`);
console.log(`run: ${sim.t.toFixed(1)} s, floor ${sim.floor}, score ${sim.score}`);
console.log(shots.map(([n, t]) => `${n} @ ${t.toFixed(1)} s`).join(" · "));
