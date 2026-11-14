/**
 * Where the sheet sits on a phone: under the two tickets and the ink bar, as big as the screen allows, centred in
 * whatever is left. Pure, so the tests can check it fills each of the phones the simulator and the reviewer use.
 */
import { COLS, ROWS } from "./grid.ts";

/** The tickets and the ink bar above the sheet (CSS px). */
export const HUD_H = 68;
/** Paper left at the sides and under the sheet. */
export const SIDE = 8;
export const FOOT = 10;

export interface SheetLayout {
  /** Px a square. */
  cs: number;
  /** The sheet's top-left corner. */
  fx: number;
  fy: number;
}

export function sheetLayout(W: number, H: number, top: number): SheetLayout {
  const room = H - top - HUD_H - FOOT;
  const cs = Math.min((W - SIDE * 2) / COLS, room / ROWS);
  return { cs, fx: (W - COLS * cs) / 2, fy: top + HUD_H + (room - ROWS * cs) / 2 };
}
