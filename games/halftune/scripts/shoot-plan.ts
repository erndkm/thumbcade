/**
 * Writes shoot.json: screenshots of a real run, played through real taps. The review harness launches every game
 * with seed 1234, so the first run's set list and tiles are known in advance; this taps each tile on the strike line
 * at its moment, at the iPhone layout, and takes shots along the way.
 *
 *   npx tsx games/halftune/scripts/shoot-plan.ts
 *   pnpm --filter @thumbcade/reviewer shoot ../../games/halftune/dist --actions ../../games/halftune/shoot.json --out ../../docs/screenshots/games
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANES } from "../src/chart.ts";
import { Run } from "../src/sim.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator.
const W = 390;
const H = 844 - 56 - 34;
const u = Math.min(1.5, Math.max(0.85, Math.min(W / 390, H / 760)));
const lineY = Math.round(H * 0.76);
const side = Math.round(8 * u);
const laneW = (W - side * 2) / LANES;
/**
 * What one scripted tap costs the driver (touch down, 60 ms, touch up, and the round trips), in ms: measured
 * 105–140 ms, median 123. The spread adds up over many taps, so the plan plays only the opening tune; the later
 * screenshots come from a QA build where the pilot plays (`VITE_AUTOPLAY=expert`).
 */
const TAP_MS = 123;

type Action = { wait: number } | { tap: [number, number] } | { shot: string };
const actions: Action[] = [{ wait: 2600 }, { shot: "attract" }, { tap: [195, 330] }];

const run = new Run({ seed: (HARNESS_SEED ^ Math.imul(1, 7919)) >>> 0 });
const shots = [{ at: 5.0, name: "play" }];
// The run starts when the starting tap lifts; each later tap lands when its touch goes down.
let clock = 0;
for (const tl of run.tiles) {
  if (tl.t > 4.9) break;
  for (const s of shots) {
    if (s.at > clock && s.at <= tl.t) {
      actions.push({ wait: Math.round((s.at - clock) * 1000) }, { shot: s.name });
      clock = s.at + 0.03;
    }
  }
  const wait = Math.round((tl.t - clock) * 1000);
  if (wait > 0) actions.push({ wait });
  actions.push({ tap: [Math.round(side + (tl.lane + 0.5) * laneW), lineY - 10] });
  clock = Math.max(clock, tl.t) + TAP_MS / 1000;
}

for (const s of shots) if (s.at > clock) {
  actions.push({ wait: Math.round((s.at - clock) * 1000) }, { shot: s.name });
  clock = s.at;
}

const out = fileURLToPath(new URL("../shoot.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(actions, null, 2)}\n`);
console.log(`${actions.length} actions, set ${run.set.join(", ")} → ${out}`);
