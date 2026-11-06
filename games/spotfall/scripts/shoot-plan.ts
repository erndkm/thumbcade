/**
 * Writes shoot.json: screenshots of a real run, played through real taps. The review harness launches every game with
 * seed 1234, so the first run's sheet is known in advance; this plays that run headless with the expert's choice of
 * shots and turns each into a tap along its line at the iPhone layout (a tap fires toward where it lands). Then it
 * leaves the run alone until the press jams it, for the game-over strip.
 *
 *   pnpm exec tsx games/spotfall/scripts/shoot-plan.ts   (then the reviewer's `shoot` with games/spotfall/shoot.json)
 */
import { writeFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { clampAngle, LAUNCH_X, LAUNCH_Y } from "../src/board.ts";
import { sheetLayout } from "../src/layout.ts";
import { plan, SKILLS } from "../src/pilot.ts";
import { Run, runSeed } from "../src/run.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator; the status bar is 47.
const W = 390;
const H = 844 - 56 - 34;
const L = sheetLayout(W, H, 47);
const lx = L.bx + LAUNCH_X * L.S;
const ly = L.by + LAUNCH_Y * L.S;
const angleTo = (x: number, y: number) => clampAngle(Math.atan2(Math.max(L.S * 0.25, ly - y), x - lx));

type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 3200 }, { shot: "attract" }, { tap: [150, 470] }];

const run = new Run(runSeed(HARNESS_SEED, 1));
const dt = 1 / 60;
// The run begins once the halftone wipe has covered the old sheet, a few frames after the starting tap.
const VEIL = 0.25;
let clock = -VEIL;
const advance = (s: number) => {
  for (let t = 0; t < s; t += dt) {
    if (clock >= 0) run.step(dt);
    run.events.length = 0;
    clock += dt;
  }
};

const rng = createRng(5);
const expert = { ...SKILLS[3]!, greed: 1, swaps: false };
const waits = [1500, 1100];
for (const [i, wait] of waits.entries()) {
  advance(wait / 1000);
  const p = plan(run, expert, rng);
  if (!p) throw new Error("no shot");
  // A tap along the planned line, far enough out for a precise angle, rounded to whole px like a touch.
  let tap: [number, number] | null = null;
  for (let d = 6 * L.S; d > 2 * L.S && !tap; d -= 3) {
    const x = Math.round(lx + Math.cos(p.angle) * d);
    const y = Math.round(ly - Math.sin(p.angle) * d);
    if (x < 4 || x > W - 4 || y < 60) continue;
    if (run.board.trace(angleTo(x, y)).cell.c === p.cell.c && run.board.trace(angleTo(x, y)).cell.r === p.cell.r) tap = [x, y];
  }
  if (!tap) throw new Error(`no tap reaches shot ${i}`);
  actions.push({ wait }, { tap });
  advance(0.06);
  run.fire(angleTo(tap[0], tap[1]));
  console.log(`shot ${i + 1} at ${clock.toFixed(2)} s: tap ${tap.join(",")} → r${p.cell.r} c${p.cell.c}, pops ${p.pops}, drops ${p.drops}`);
}
// Mid-cascade: the last shot has landed and its dots are falling into the pot.
actions.push({ wait: 720 }, { shot: "play" });
advance(0.72);
// Leave it: the press hurries an idle player and jams the sheet.
const before = clock;
while (run.phase === "play" && clock < 60) advance(0.1);
const until = clock - before + 0.6 + 1.6;
console.log(`jam at ${clock.toFixed(1)} s of the run; score ${run.score}`);
actions.push({ wait: Math.round(until * 1000) }, { shot: "over" });

writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 2)}\n`);
console.log("wrote shoot.json");
