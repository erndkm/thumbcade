/**
 * Words for the player: the next move to point at (the first-run ghost thumb and the idle nudge), and the one tip on
 * the game-over strip, picked from what actually happened in the run.
 */
import { eyeScore } from "./pilot.ts";
import { canMove, type Move } from "./rules.ts";
import type { Run, RunStats } from "./run.ts";
import { solve } from "./solver.ts";

/** Where the lifted run on `held` should go: the solver's line if it starts there, else the best-looking target. */
export function hintFor(run: Run, held: number): Move {
  const line = solve(run.board, 20_000);
  const first = line.moves[0];
  if (first && first.from === held) return first;
  let best = -1;
  let bestV = -Infinity;
  for (let j = 0; j < run.board.length; j++) {
    if (!canMove(run.board, held, j)) continue;
    const v = eyeScore(run.board, held, j);
    if (v > bestV) {
      bestV = v;
      best = j;
    }
  }
  return { from: held, to: best >= 0 ? best : held };
}

/** Every tip the game-over strip can show, longest first (the copy test checks they fit). */
export const TIPS = {
  idle: "tap a pot, then tap where its lump should go",
  dead: "check the next lump has a home before you move",
  nope: "lumps land only on their own kind, or in an empty pot",
  spare: "a spare pot gives you room when it gets tight",
  stuckEarly: "park a lump in the empty pot to dig out the one below",
  streak: "seal pots back to back to climb the multiplier",
  partial: "move a whole run to a pot where it all fits",
  covered: "dig out the grey lumps early: they hide a kind",
} as const;

export function tipFor(s: RunStats, sparesLeft: number): string {
  if (s.moves === 0) return TIPS.idle;
  if (s.graces + s.rewinds >= 2) return TIPS.dead;
  if (s.nopes + s.retargets >= 4 && s.nopes + s.retargets > s.moves / 3) return TIPS.nope;
  if (sparesLeft > 0 && s.spareIdle > 12) return TIPS.spare;
  if (s.levels === 0) return TIPS.stuckEarly;
  if (s.bestStreak < 2) return TIPS.streak;
  if (s.partial >= 3) return TIPS.partial;
  return TIPS.covered;
}
