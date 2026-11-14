/**
 * Writes shoot.json: screenshots of a real first run on the normal build. The review harness launches every game with
 * seed 1234, so the first run's road is known in advance; this replays that run headless at 60 Hz the way the game
 * does (the halftone wipe before it starts, the first-run coach and its slow motion at the first bends) for a player
 * who never touches the screen, and times the shots: attract, the first "hold" the coach asks for, and the game-over
 * strip after the cart runs wide. The mid-run docs shots come from autoplay builds (`shoot.qa.json`).
 *
 *   pnpm exec tsx games/saltbend/scripts/shoot-plan.ts   (then the reviewer's `shoot` with games/saltbend/shoot.json)
 */
import { writeFileSync } from "node:fs";
import { Run, runSeed } from "../src/sim.ts";
import { Teacher } from "../src/teach.ts";

const HARNESS_SEED = 1234;
const dt = 1 / 60;
const VEIL = 0.23;
const END_AFTER = 0.9;
const STRIP = 1.7;

type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 3200 }, { shot: "attract" }, { tap: [195, 560] }];

const run = new Run(runSeed(HARNESS_SEED, 1));
const teacher = new Teacher();
let wall = VEIL;
let firstHold = -1;
while (run.phase === "drive" && wall < 120) {
  const slow = teacher.update(run, true, 0, dt);
  if (teacher.wants && firstHold < 0) firstHold = wall;
  run.step(dt * slow);
  run.events.length = 0;
  wall += dt;
}
if (firstHold < 0) throw new Error("the coach never asked for a hold");
const hint = firstHold + 0.7;
const over = wall + END_AFTER + STRIP;
actions.push({ wait: Math.round(hint * 1000) }, { shot: "hold" }, { wait: Math.round((over - hint) * 1000) }, { shot: "over" });
console.log(`first hold asked at ${firstHold.toFixed(2)} s, off the road at ${wall.toFixed(2)} s (${run.metres} m, ${run.stats.end})`);
writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 2)}\n`);
console.log("wrote shoot.json");
