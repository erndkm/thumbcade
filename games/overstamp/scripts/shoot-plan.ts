/**
 * Writes shoot.json: screenshots of a real run played through real taps. The review harness launches every game
 * with seed 1234, so the first run's heap is known in advance; this deals it headless, lifts slips in the deal's own
 * clearing order at the iPhone layout, and places the shots on a seal, on the cleared sheet, and on the game over.
 *
 *   pnpm exec tsx games/overstamp/scripts/shoot-plan.ts   (then the reviewer's `shoot` with games/overstamp/shoot.json)
 */
import { writeFileSync } from "node:fs";
import { heapGeo, playFrame, slipPos } from "../src/layout.ts";
import { Run } from "../src/run.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator; the status bar is 47.
const frame = playFrame(390, 844 - 56 - 34, { top: 47, right: 0, bottom: 0, left: 0 });
type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 3400 }, { shot: "attract" }, { tap: [195, 380] }, { wait: 1300 }];

const run = new Run((HARNESS_SEED ^ Math.imul(1, 0x9e3779b1)) >>> 0);
const geo = heapGeo(run.slips, frame.board);
let seals = 0;
let shotPlay = false;
for (const id of run.witness) {
  const [x, y] = slipPos(geo, run.slips[id]!);
  actions.push({ tap: [Math.round(x + geo.S / 2), Math.round(y + geo.S / 2)] });
  const evs = run.tap(id);
  const sealed = evs.some((e) => e.type === "seal");
  if (sealed) seals++;
  if (evs.some((e) => e.type === "sheet")) {
    actions.push({ wait: 520 }, { shot: "clear" });
    break;
  }
  // The second seal, while the trio is pressed in the lane and the tray still holds the next pair.
  if (sealed && seals === 2 && !shotPlay) {
    shotPlay = true;
    actions.push({ wait: 600 }, { shot: "play" });
  } else actions.push({ wait: 260 });
}
// Then hands off: the clock runs out on the second sheet.
actions.push({ wait: 48000 }, { shot: "over" });
writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 0).replace(/\},\{/g, "},\n  {").replace(/^\[/, "[\n  ").replace(/\]$/, "\n]")}\n`);
console.log(`shoot.json: ${actions.length} steps, ${run.witness.length} lifts on the first sheet, seals ${seals}`);
