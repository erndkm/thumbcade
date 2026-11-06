/**
 * Writes shoot.json: screenshots of a real run, played through real swipes. The review harness launches every game
 * with seed 1234, so the first run's pool is known in advance; this plays that run headless to find swaps that
 * make specials and then sets two of them off together, and turns them into finger swipes at the iPhone layout.
 *
 *   npx tsx games/brinebop/scripts/shoot-plan.ts          (then the reviewer's `shoot` with games/brinebop/shoot.json)
 */
import { writeFileSync } from "node:fs";
import { createRng } from "@thumbcade-games/kit/rng";
import { col, COLS, row, type Move } from "../src/board.ts";
import { poolLayout } from "../src/layout.ts";
import { Run, runSeed } from "../src/run.ts";

const HARNESS_SEED = 1234;
// iPhone 6.1": 390×844 minus the 56 pt bottom bar and the 34 pt home indicator; the status bar is 47.
const L = poolLayout(390, 844 - 56 - 34, 47);
const dt = 1 / 60;

type Action = { wait: number } | { tap: [number, number] } | { swipe: [number, number, number, number] } | { shot: string };
const actions: Action[] = [{ wait: 2600 }, { shot: "attract" }, { tap: [195, 420] }];

const run = new Run(createRng(runSeed(HARNESS_SEED, 1)), { pour: true });
let clock = 0;
const settle = (max = 6) => {
  let t = 0;
  while (t < max && !(run.board.calm && t > 0.05)) {
    run.step(dt);
    run.events.length = 0;
    t += dt;
  }
  clock += t;
  return t;
};
const advance = (s: number) => {
  for (let t = 0; t < s; t += dt) {
    run.step(dt);
    run.events.length = 0;
  }
  clock += s;
};

settle();
// The first-run ghost hand, over the poured-in pool.
actions.push({ wait: Math.round(clock * 1000) + 900 }, { shot: "play" });
advance(0.9);

const swipeFor = (m: Move): [number, number, number, number] => {
  const x = L.bx + (col(m.from) + 0.5) * L.cell;
  const y = L.by + (row(m.from) + 0.5) * L.cell;
  return [Math.round(x), Math.round(y), (col(m.to) - col(m.from)) * 60, (row(m.to) - row(m.from)) * 60];
};

let fired = false;
for (let n = 0; n < 30 && !fired; n++) {
  const moves = run.board.findMoves();
  const specials = new Set(run.board.specials());
  // Two specials side by side: set them off together.
  const combo = moves.find((m) => specials.has(m.from) && specials.has(m.to));
  // A special made next to one already on the board can be swapped into it on the next move.
  const nearSpecial = (m: Move) => [...specials].some((s) => s !== m.from && s !== m.to && Math.abs(col(s) - col(m.to)) + Math.abs(row(s) - row(m.to)) === 1);
  const make = moves.filter((m) => m.makes !== "none").sort((a, b) => Number(nearSpecial(b)) - Number(nearSpecial(a)) || b.value - a.value)[0];
  const m = combo ?? make ?? moves.sort((a, b) => b.value - a.value)[0];
  if (!m) break;
  // The harness swipe lasts 180 ms; the drag commits about 70 ms in.
  actions.push({ swipe: swipeFor(m) });
  advance(0.07);
  run.swap(m.from, m.to, 0.4);
  advance(0.13);
  if (combo) {
    // Mid-blast.
    actions.push({ wait: 230 }, { shot: "combo" });
    advance(0.23);
    fired = true;
    break;
  }
  const t = settle() + 0.45;
  advance(0.45);
  actions.push({ wait: Math.round(t * 1000) });
}
if (!fired) console.warn("no combo found in 30 moves; shoot.json ends without the combo shot");
// --qa <file>: also hands off and shoots the frenzy, the cash-out and the end (for design QA, not the docs).
const qa = process.argv.indexOf("--qa");
if (qa > 0) {
  let last = clock;
  const shotAt = (name: string, until: () => boolean, extra = 0) => {
    while (!until() && run.elapsed < 200) advance(dt);
    advance(extra);
    actions.push({ wait: Math.round((clock - last) * 1000) }, { shot: name });
    last = clock;
  };
  shotAt("frenzy", () => run.frenzy, 0.6);
  shotAt("timeup", () => run.phase === "timeup", 0.2);
  // A burst through the cash-out (screenshots take real time, so these are spaced loosely).
  for (let k = 0; k < 8; k++) actions.push({ wait: 150 }, { shot: `cash${k}` });
  actions.push({ wait: 4000 }, { shot: "over" });
  writeFileSync(process.argv[qa + 1]!, `${JSON.stringify(actions, null, 2)}\n`);
} else writeFileSync(new URL("../shoot.json", import.meta.url), `${JSON.stringify(actions, null, 2)}\n`);
console.log(`${actions.length} actions, layout cell ${L.cell} at (${L.bx}, ${L.by}), ${COLS} columns`);
