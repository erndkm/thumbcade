import { COLS, ROWS } from "./board.ts";

/** Room the HUD (score, clock) takes above the pool, below the status bar. */
export const HUD_H = 92;

/** Where the pool sits for a viewport: cell size in CSS px and the pool's top-left corner. Pure, so tools share it. */
export function poolLayout(W: number, H: number, playTop: number): { cell: number; bx: number; by: number } {
  const top = playTop + HUD_H;
  const avail = H - top - 16;
  const cell = Math.max(20, Math.floor(Math.min((W - 36) / COLS, avail / ROWS, 64)));
  const bx = Math.round((W - cell * COLS) / 2);
  const by = Math.round(top + Math.max(0, (avail - cell * ROWS) * 0.6));
  return { cell, bx, by };
}
