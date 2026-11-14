import { textWidth } from "./font.ts";

/** HUD geometry (art px), shared by the game and its tests. */
export const MOON_W = 9;
export const FISH_W = 9;
export const PIP = 4;
/** The score lane fits the worst case, "999,999 x4", outlines included. */
export const SCORE_LANE = textWidth("999,999") + 3 + textWidth("x4") + 2;
/** The moon and the rows climbed, up to "999". */
export const ROWS_W = MOON_W + Math.max(textWidth("999"), textWidth("0")) + 1;
/** The fish and its basket: five pips. */
export const FISH_LANE = FISH_W + 2 + 5 * PIP + 1;

/**
 * Three fixed lanes across a screen `w` art px wide: score from the left edge, the fish basket against the right edge,
 * the rows climbed centred between them. Returns each lane's left edge and the clear gap either side of the middle.
 */
export function hudLanes(w: number): { scoreX: number; scoreEnd: number; rowsX: number; fishX: number; gap: number } {
  const scoreX = 2;
  const scoreEnd = scoreX + SCORE_LANE;
  const fishX = w - 2 - FISH_LANE;
  const rowsX = Math.round((scoreEnd + fishX) / 2 - ROWS_W / 2);
  return { scoreX, scoreEnd, rowsX, fishX, gap: Math.min(rowsX - scoreEnd, fishX - (rowsX + ROWS_W)) };
}
