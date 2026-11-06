/**
 * Writes shoot.json. The reviewer harness launches with seed 1234, so the first run's hands are known: the planner
 * plays hand 1 (screenshot "clear" right after it is cleared) and hand 2 (screenshot "play" at its longest streak),
 * then the run times out ("over"). Tap positions come from the game's own play layout (src/layout.ts) on the
 * reviewer's iPhone viewport (390 × 754, 47 pt status bar). `npx tsx scripts/shoot.ts > shoot.json`
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { apply, cleared, Dealer, DRAW, plan, startPos, type Move } from "../src/deal.ts";
import { playGeometry } from "../src/layout.ts";

const SEED = (1234 ^ Math.imul(1, 0x9e3779b1)) >>> 0;
// The reviewer's phone profiles (@thumbcade/sdk/host DEVICES): `npx tsx scripts/shoot.ts android` for the 360 pt one.
const VIEW = process.argv[2] === "android" ? { w: 360, h: 724, statusBar: 28 } : { w: 390, h: 754, statusBar: 47 };

const dealer = new Dealer(createRng(SEED));
const actions: unknown[] = [{ wait: 3000 }, { shot: "attract" }, { tap: [195, 400] }, { wait: 1300 }];

function playHand(index: number, shotAtLongestStreak: boolean): void {
  const deal = dealer.get(index).deal;
  const g = playGeometry(VIEW.w, VIEW.h, VIEW.statusBar, deal.shape.cols, deal.shape.depth);
  const stock: [number, number] = [Math.round(g.stock.x), Math.round(g.stock.y)];
  // Any point in a column plays its exposed card; just below the top of the tableau works at every depth.
  const columnY = Math.round(g.top + 20);
  let pos = startPos(deal);
  const moves: Move[] = [];
  while (!cleared(pos)) {
    const m = plan(deal, pos);
    if (m === null) break;
    moves.push(m);
    pos = apply(deal, pos, m);
  }
  let longest = 0;
  let at = -1;
  let streak = 0;
  moves.forEach((m, i) => {
    streak = m === DRAW ? 0 : streak + 1;
    if (streak > longest) [longest, at] = [streak, i];
  });
  moves.forEach((m, i) => {
    actions.push({ tap: m === DRAW ? stock : [Math.round(g.colX[m]!), columnY] }, { wait: 330 });
    if (shotAtLongestStreak && i === at) actions.push({ wait: 200 }, { shot: "play" });
  });
}

playHand(0, false);
actions.push({ wait: 150 }, { shot: "clear" }, { wait: 1900 });
playHand(1, true);
actions.push({ wait: 45000 }, { shot: "over" });
console.log(`[\n${actions.map((a) => `  ${JSON.stringify(a)}`).join(",\n")}\n]`);
