import { textWidth } from "./font.ts";

/** HUD geometry (art px), shared by the game and its tests. */
export const PIP = 4;
export const BADGE = 7;
/** Moon icon (7 × 7 plus outline). */
export const MOON_W = 9;
/** The score lane fits the worst case, "99,999 x4", outlines included. */
export const SCORE_LANE = textWidth("99,999") + 3 + textWidth("x4") + 2;
/** Two badges and three pips a side. */
export const PIPS_LANE = BADGE + 1 + (3 * PIP + 1) + 3 + BADGE + 1 + (3 * PIP + 1);
/** The moon (its right edge is mostly clear) and the widest time ("0:40"), its outline included. */
export const CLOCK_W = MOON_W - 1 + Math.max(textWidth("0:40"), textWidth("0:00")) + 1;

/**
 * Three fixed lanes across a screen `w` art px wide: score from the left edge, pips against the right edge, the clock
 * centred between them. Returns each lane's left edge and the clear gap left on either side of the clock.
 */
export function hudLanes(w: number): { scoreX: number; scoreEnd: number; clockX: number; pipsX: number; gap: number } {
  const scoreX = 2;
  const scoreEnd = scoreX + SCORE_LANE;
  const pipsX = w - 2 - PIPS_LANE;
  const clockX = Math.round((scoreEnd + pipsX) / 2 - CLOCK_W / 2);
  return { scoreX, scoreEnd, clockX, pipsX, gap: Math.min(clockX - scoreEnd, pipsX - (clockX + CLOCK_W)) };
}
