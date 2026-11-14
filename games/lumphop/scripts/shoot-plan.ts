/**
 * Writes shoot.json: screenshots of a real run played through real taps. The review harness launches every game with
 * seed 1234, so the first run's levels are known in advance; this plays them headless with the deals' own clearing
 * lines at the iPhone layout, and places the shots on a lifted run, a seal being patted, a level party and the end.
 *
 *   pnpm --filter @thumbcade-games/lumphop exec tsx scripts/shoot-plan.ts   (then the reviewer's `shoot`)
 */
import { writeFileSync } from "node:fs";
import { boardGeo, playFrame } from "../src/layout.ts";
import { Run, runSeed, TUNE } from "../src/run.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator; the status bar is 47.
const W = 390;
const H = 844 - 56 - 34;
const frame = playFrame(W, H, { top: 47, right: 0, bottom: 0, left: 0 });
type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 3200 }, { shot: "attract" }, { tap: [195, 330] }, { wait: 1300 }];

const run = new Run(runSeed(HARNESS_SEED, 1));
const tapPot = (i: number) => {
  const g = boardGeo(run.board.length, frame.board);
  const s = g.spots[i]!;
  actions.push({ tap: [Math.round(s.x), Math.round(s.rim - g.U * 0.9)] });
};
const dt = 1 / 60;
const wait = (ms: number) => {
  actions.push({ wait: ms });
  for (let t = 0; t < ms / 1000; t += dt) run.step(dt);
};

let shotLift = false;
let shotSeal = false;
let shotClear = false;
for (let level = 1; level <= 3; level++) {
  const line = run.witness.slice();
  for (const m of line) {
    tapPot(m.from);
    run.tap(m.from);
    if (level === 2 && !shotLift) {
      shotLift = true;
      wait(180);
      actions.push({ shot: "play" });
    }
    wait(260);
    tapPot(m.to);
    const evs = run.tap(m.to);
    const sealed = evs.some((e) => e.type === "seal");
    const cleared = evs.some((e) => e.type === "clear");
    if (cleared && level === 2 && !shotClear) {
      shotClear = true;
      wait(1250);
      actions.push({ shot: "clear" });
    } else if (sealed && level === 2 && !shotSeal) {
      shotSeal = true;
      wait(520);
      actions.push({ shot: "seal" });
      wait(300);
    } else wait(cleared ? 400 : 420);
    if (cleared) break;
  }
  wait(TUNE.dealPause * 1000 + 700);
}
// Hands off: the clock runs out.
actions.push({ wait: 45000 }, { shot: "over" });
writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 0).replace(/\},\{/g, "},\n  {").replace(/^\[/, "[\n  ").replace(/\]$/, "\n]")}\n`);
console.log(`shoot.json: ${actions.length} steps, level reached ${run.level}, clock ${run.clock.toFixed(1)} s, score ${run.score}`);
