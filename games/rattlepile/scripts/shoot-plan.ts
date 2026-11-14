/**
 * Writes shoot.qa.json: screenshots of a whole run played by the expert pilot. The review harness launches every game
 * with seed 1234 and a `VITE_AUTOPLAY=expert` build plays its run in lockstep (sixty looks a second, no hit-stop), so
 * this replays the same run headless and puts the shots on a rattling volley, a hot streak, the pile near the floor
 * and the game-over card.
 *
 *   pnpm exec tsx games/rattlepile/scripts/shoot-plan.ts
 *   (cd games/rattlepile && VITE_AUTOPLAY=expert pnpm exec vite build --outDir <somewhere outside the package>)
 *   pnpm --filter @thumbcade/reviewer shoot <that folder> --slug rattlepile --actions ../../games/rattlepile/shoot.qa.json --out ../../docs/screenshots/games
 */
import { writeFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, SKILLS } from "../src/pilot.ts";
import { QA_PILOT_SEED, runSeed } from "../src/runs.ts";
import { ROWS, Sim } from "../src/sim.ts";

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
    if (e.k === "smash" && e.chain >= 5) mark("rattle", sim.t + 0.1);
    if (e.k === "smash" && sim.mult >= 3 && e.chain >= 2 && sim.t > (at.rattle ?? 1e9) + 4) mark("streak", sim.t + 0.1);
    if (e.k === "fire" && e.n === 6 && sim.lowestRow >= ROWS - 2 && sim.turn >= 12) mark("late", sim.t + 0.45);
    if (e.k === "over") mark("over", sim.t + 2.4);
  }
  sim.events.length = 0;
}
const shots = Object.entries(at).sort((a, b) => a[1] - b[1]);
type Action = { wait: number } | { tap: [number, number] } | { shot: string };
// The run starts on the tap; the tap itself takes about a tenth of a second to land.
const actions: Action[] = [{ wait: 1500 }, { tap: [160, 420] }];
let clock = -0.1;
for (const [name, t] of shots) {
  actions.push({ wait: Math.max(50, Math.round((t - clock) * 1000)) }, { shot: name });
  clock = t;
}
writeFileSync(new URL("../shoot.qa.json", import.meta.url), `[\n${actions.map((a) => `  ${JSON.stringify(a)}`).join(",\n")}\n]\n`);
console.log(`run: ${sim.t.toFixed(1)} s, row ${sim.turn}, score ${sim.score}`);
console.log(shots.map(([n, t]) => `${n} @ ${t.toFixed(1)} s`).join(" · "));
