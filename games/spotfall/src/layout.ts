/**
 * Where the sheet sits on screen. The board is the same shape on every phone (9 dots wide, the launcher a fixed
 * distance below the jam line), so a shot is the same shot everywhere; only its scale changes. Pure, so the
 * screenshot planner can place taps exactly where the game reads them.
 */
import { COLS, LAUNCH_Y } from "./board.ts";

/** The pot's surface, in board units below the launch point. */
export const POT_DY = 1.18;
/** Space above the drum for the score. */
const HEAD = 58;

export interface SheetLayout {
  /** A dot's diameter in CSS px. */
  S: number;
  /** The sheet's left edge and the drum's lower edge (board origin) in CSS px. */
  bx: number;
  by: number;
}

export function sheetLayout(W: number, H: number, top: number): SheetLayout {
  const needed = LAUNCH_Y + POT_DY + 0.55;
  const S = Math.min((W - 20) / COLS, (H - top - HEAD - 10) / needed);
  const extra = Math.max(0, H - top - HEAD - 10 - S * needed);
  return { S, bx: (W - COLS * S) / 2, by: top + HEAD + extra * 0.45 };
}
