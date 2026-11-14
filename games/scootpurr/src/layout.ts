/**
 * Where the rug and the HUD sit, in art pixels. Pure, so the tests can check every phone.
 */
import { textWidth } from "./font.ts";

/** One square of the rug. (The sprites in art.ts are drawn for this size.) */
export const CELL = 18;
/** HUD: the score row, the candle row and the banner lane take this much under the status bar. */
export const HUD_H = 40;
/** The hearth sits under the HUD during a run. */
export const HEARTH_H = 24;
/** Room the rug's border and fringe need round the squares. */
export const RUG_PAD = 6;
/** The attract screen's sign and prompt plates. */
export const SIGN_H = 24;
export const PROMPT_H = 28;

export interface Safe {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Top-left of the rug's squares during a run: centred under the HUD. */
export function playBoard(sw: number, sh: number, top: number, cols: number, rows: number): { x: number; y: number } {
  const y0 = top + HUD_H + HEARTH_H + RUG_PAD;
  const room = sh - RUG_PAD - 2 - y0;
  return { x: Math.round((sw - cols * CELL) / 2), y: Math.round(y0 + Math.max(0, room - rows * CELL) / 2) };
}

/** Top-left of the demo rug: centred in what the feed leaves free, between the sign and the prompt. */
export function attractBoard(safe: Safe, cols: number, rows: number): { x: number; y: number } {
  const y0 = safe.y0 + SIGN_H + RUG_PAD;
  const y1 = safe.y1 - PROMPT_H - RUG_PAD;
  return { x: Math.round((safe.x0 + safe.x1 - cols * CELL) / 2), y: Math.round(y0 + Math.max(0, y1 - y0 - rows * CELL) / 2) };
}

export interface Hud {
  /** Left edge of the score, and where the purr sits after its widest value. */
  scoreX: number;
  purrX: number;
  /** Right edge of the rug number. */
  rugX: number;
  rowY: number;
  /** The candle: left end, top, and its longest wax. */
  candleX: number;
  candleY: number;
  candleW: number;
  /** Top of the banner lane. */
  laneY: number;
}

export function hud(sw: number, top: number): Hud {
  const scoreX = 3;
  return {
    scoreX,
    purrX: scoreX + textWidth("999,999") + 4,
    rugX: sw - 3,
    rowY: top + 2,
    candleX: 3,
    candleY: top + 16,
    candleW: sw - 6 - 6,
    laneY: top + 27,
  };
}
