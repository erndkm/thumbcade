/**
 * Writes shoot.json: screenshots of a real run played through real taps. The review harness launches every game with
 * seed 1234, so the first run's walls are known in advance: this plays them headless, taps each wall's witness at the
 * iPhone layout (waiting for swings to settle, as a player would), and places the shots on a swing, a smash, the
 * cleared wall, the next wall and the game over.
 *
 *   pnpm exec tsx games/platterbang/scripts/shoot-plan.ts   (then the reviewer's `shoot` with games/platterbang/shoot.json)
 */
import { writeFileSync } from "node:fs";
import { playFrame, toScreen } from "../src/layout.ts";
import { Run, runSeed } from "../src/run.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator; the status bar is 47.
const frame = playFrame(390, 844 - 56 - 34, { top: 47, right: 0, bottom: 0, left: 0 });
type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 3200 }, { shot: "attract" }, { tap: [195, 330] }, { wait: 1300 }, { shot: "teach" }];

const run = new Run(runSeed(HARNESS_SEED, 1));
const dt = 1 / 60;
const step = (s: number) => {
  for (let t = 0; t < s; t += dt) run.step(dt);
  run.events.length = 0;
};
step(1.3);
const shots = new Set<string>();
let walls = 0;
while (run.live && walls < 1) {
  const wall = run.wallNo;
  for (const id of run.deal.witness) {
    // Wait until nothing swings, plus a beat.
    let wait = 0.35;
    step(0.35);
    while (run.phys.busy && wait < 6) {
      step(0.1);
      wait += 0.1;
    }
    actions.push({ wait: Math.round(wait * 1000) });
    const p = run.wall.pegs[id]!;
    const [x, y] = toScreen(frame, p.x, p.y);
    actions.push({ tap: [Math.round(x), Math.round(y)] });
    const evs = [...run.tap(id)];
    run.events.length = 0;
    if (!shots.has("play") && evs.some((e) => e.type === "swing") && evs.some((e) => e.type === "pull" && e.dest.to === "jar")) {
      shots.add("play");
      actions.push({ wait: 320 }, { shot: "play" });
      step(0.32);
    } else if (!shots.has("smash") && evs.some((e) => e.type === "drop") && run.wallNo === wall && run.pegsLeft > 2) {
      shots.add("smash");
      actions.push({ wait: 520 }, { shot: "smash" });
      step(0.52);
    }
    if (evs.some((e) => e.type === "clear")) {
      walls++;
      if (!shots.has("clear")) {
        shots.add("clear");
        actions.push({ wait: 450 }, { shot: "clear" });
        step(0.45);
      }
      break;
    }
  }
  // Into the next wall: let it deal.
  step(2);
  actions.push({ wait: 2000 });
  if (walls === 1 && !shots.has("wall2")) {
    shots.add("wall2");
    actions.push({ shot: "wall2" });
  }
}
// Then hands off: the clock (45 s at most) runs out and the result strip shows. No taps after this point, since a tap
// on the result would start the next run.
actions.push({ wait: 50000 }, { shot: "over" });
writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 0).replace(/\},\{/g, "},\n  {").replace(/^\[/, "[\n  ").replace(/\]$/, "\n]")}\n`);
console.log(`shoot.json: ${actions.length} steps, shots ${[...shots].join(", ")}, over`);
