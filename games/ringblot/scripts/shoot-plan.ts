/**
 * Writes shoot.qa.json: screenshots of a whole run played by the expert pilot. The review harness launches every game
 * with seed 1234 and a `VITE_AUTOPLAY=expert` build plays its run in lockstep (sixty looks a second, no hit-stop), so
 * this replays the same run headless and puts the shots on a long wet line, a big loop being printed, the first sheet
 * finished, the second sheet, a rival being smudged, a later sheet and the game-over strip.
 *
 *   pnpm exec tsx games/ringblot/scripts/shoot-plan.ts
 *   (cd games/ringblot && VITE_AUTOPLAY=expert pnpm exec vite build --outDir <somewhere outside the package>)
 *   pnpm --filter @thumbcade/reviewer shoot <that folder> --slug ringblot --actions ../../games/ringblot/shoot.qa.json --out ../../docs/screenshots/games
 */
import { writeFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { Pilot, SKILLS } from "../src/pilot.ts";
import { QA_PILOT_SEED, runSeed } from "../src/runs.ts";
import { HERO, Sim } from "../src/sim.ts";

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
  if (sim.hero.line.length >= 11) mark("line", sim.t + 0.05);
  for (const e of sim.events) {
    if (e.k === "print" && e.id === HERO && e.tier >= 3 && sim.t > (at.line ?? 1e9) + 0.5) mark("print", sim.t + 0.14);
    if (e.k === "smudge" && e.by === HERO) mark("smudge", sim.t + 0.16);
    if (e.k === "sheet" && e.sheet === 1) mark("printed", sim.t + 0.55);
    if (e.k === "fresh" && e.sheet === 2) mark("sheet2", sim.t + 4);
    if (e.k === "fresh" && e.sheet === 4) mark("late", sim.t + 5);
    if (e.k === "over") mark("over", sim.t + 2.4);
  }
  sim.events.length = 0;
}
// Shots less than a third of a second apart can't both be taken: keep the earlier one.
const shots = Object.entries(at)
  .sort((a, b) => a[1] - b[1])
  .filter(([, t], i, all) => i === 0 || t - all[i - 1]![1] > 0.33);
type Action = { wait: number } | { tap: [number, number] } | { shot: string };
// The run starts on the tap; the tap itself takes about a tenth of a second to land.
const actions: Action[] = [{ wait: 1500 }, { tap: [150, 400] }];
let clock = -0.1;
for (const [name, t] of shots) {
  actions.push({ wait: Math.max(50, Math.round((t - clock) * 1000)) }, { shot: name });
  clock = t;
}
writeFileSync(new URL("../shoot.qa.json", import.meta.url), `[\n${actions.map((a) => `  ${JSON.stringify(a)}`).join(",\n")}\n]\n`);
console.log(`run: ${sim.t.toFixed(1)} s, sheet ${sim.sheet}, score ${sim.score}`);
console.log(shots.map(([n, t]) => `${n} @ ${t.toFixed(1)} s`).join(" · "));
