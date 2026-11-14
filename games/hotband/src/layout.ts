/**
 * Where everything sits, for a run and for the attract screen. Pure, so the tests can check it on every phone.
 */
import { COLS, VISIBLE } from "./pieces.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The meter: its top-left corner (first visible row) and the size of one segment's slot. */
export interface Meter {
  x: number;
  y: number;
  cw: number;
  ch: number;
  w: number;
  h: number;
}

export interface PlayLayout {
  meter: Meter;
  /** Centre of the score. */
  score: { x: number; y: number };
  /** The gain read-out, left of the row under the score. */
  gain: Rect;
  /** Level and rows, in the middle of that row. */
  info: { x: number; y: number };
  /** The next piece, right of that row. */
  next: Rect;
  /** One message at a time shows here, between the HUD and the meter. */
  lane: { x: number; y: number };
  /** Band labels under the meter. */
  labelsY: number;
}

const HUD_H = 122;
const FOOT_H = 30;

function meterIn(x: number, y: number, w: number, h: number, maxCw = 48): Meter {
  let cw = Math.min(maxCw, Math.floor(w / COLS));
  let ch = Math.min(Math.floor(h / VISIBLE), Math.round(cw * 0.78));
  // Never squarer than a segment should be, never thinner than a thumb can read.
  if (ch < cw * 0.5) cw = Math.max(18, Math.floor(ch / 0.5));
  ch = Math.max(8, ch);
  const mw = cw * COLS;
  const mh = ch * VISIBLE;
  return { x: Math.round(x + (w - mw) / 2), y: Math.round(y + (h - mh) / 2), cw, ch, w: mw, h: mh };
}

export function playLayout(W: number, H: number, top: number): PlayLayout {
  const side = 14;
  const y0 = top + HUD_H;
  const availH = H - y0 - FOOT_H;
  const m = meterIn(side, y0, W - side * 2, availH);
  // Keep the meter up against the HUD rather than floating in the middle of a tall screen.
  const meter = { ...m, y: Math.min(m.y, y0 + 6) };
  const rowY = top + 78;
  return {
    meter,
    score: { x: W / 2, y: top + 34 },
    gain: { x: meter.x, y: rowY - 18, w: 104, h: 36 },
    info: { x: W / 2, y: rowY },
    next: { x: meter.x + meter.w - 76, y: rowY - 18, w: 76, h: 36 },
    lane: { x: W / 2, y: top + 108 },
    labelsY: meter.y + meter.h + 13,
  };
}

export interface AttractLayout {
  meter: Meter;
  title: { x: number; y: number; maxW: number };
  sub: { x: number; y: number };
  best: { x: number; y: number };
  prompt: { x: number; y: number };
}

/** The title block on top, the demo meter under it, the prompt at the bottom: all inside what the feed leaves free. */
export function attractLayout(W: number, H: number, insets: Insets): AttractLayout {
  const m = 16;
  const x = insets.left + m;
  const y = insets.top + m;
  const w = Math.max(40, W - insets.right - m - x);
  const h = Math.max(40, H - insets.bottom - m - y);
  const cx = x + w / 2;
  const titleH = 104;
  const promptH = 44;
  const meter = meterIn(x, y + titleH, w, h - titleH - promptH, 34);
  return {
    meter,
    title: { x: cx, y: y + 44, maxW: w },
    sub: { x: cx, y: y + 66 },
    best: { x: cx, y: y + 86 },
    prompt: { x: cx, y: y + h - 14 },
  };
}

/** The game-over panel: above the caption, left of the action rail. */
export function summaryBox(W: number, H: number, insets: Insets, standalone: boolean, lines: number): Rect {
  const m = 12;
  const x = insets.left + m;
  const w = Math.max(60, W - insets.right - m - x);
  const h = 58 + lines * 16;
  const y = H - insets.bottom - m - h - (standalone ? 34 : 0);
  return { x, y, w, h };
}

/** Top-left of a segment's slot. Rows count from the top of the meter (0 = first visible row). */
export const slotAt = (m: Meter, col: number, visRow: number): { x: number; y: number } => ({ x: m.x + col * m.cw, y: m.y + visRow * m.ch });
