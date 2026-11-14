/**
 * Where everything sits. The cards are sized to the screen for every deal: four columns of a short pack fill the
 * width as surely as seven of the whole one. Pure, so the tests can check it on every phone.
 */
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

/** Height of the HUD under the status bar: the score row, the clock's rule and the lane for one line of news. */
export const HUD_H = 64;
/** A card is this much taller than wide. */
export const CARD_RATIO = 1.38;
/** How far each face-down card, and at least how far each face-up card, shows above the next (in card heights). */
export const DOWN_STEP = 0.17;
export const UP_STEP_MIN = 0.25;
/** A short run is fanned wider than a long one, up to this. */
export const UP_STEP_MAX = 0.5;
const ROW_GAP = 10;

export interface Frame {
  cols: number;
  /** Card size. */
  cw: number;
  ch: number;
  gap: number;
  /** Left edge of column 0. */
  x0: number;
  /** Top of the row of home piles (four, over the first four columns). */
  homeY: number;
  /** Top of the columns. */
  tableY: number;
  downStep: number;
  /** Height the columns have to grow in, from `tableY`. */
  room: number;
  /** Top of the bottom row: the pack on the right, the drawn cards fanned to its left. */
  packY: number;
  stockX: number;
  wasteX: number;
  /** How far each of the last drawn cards shows left of the next. */
  fan: number;
}

/** The largest table for `cols` columns of a pack of `ranks` cards a suit that fits `r`. */
export function frameIn(r: Rect, cols: number, ranks: number): Frame {
  const gap = cols <= 4 ? 6 : cols <= 5 ? 5 : 4;
  let cw = Math.floor((r.w - (cols - 1) * gap) / cols);
  let ch = Math.round(cw * CARD_RATIO);
  // Homes, the tallest column there can be (every hidden card, then a run from the top card to the ace), the pack.
  const need = 3 + (cols - 1) * DOWN_STEP + (ranks - 1) * UP_STEP_MIN;
  const maxCh = Math.floor((r.h - 2 * ROW_GAP) / need);
  if (ch > maxCh) {
    ch = maxCh;
    cw = Math.floor(ch / CARD_RATIO);
  }
  const width = cols * cw + (cols - 1) * gap;
  const x0 = Math.round(r.x + (r.w - width) / 2);
  const homeY = r.y;
  const tableY = homeY + ch + ROW_GAP;
  const packY = r.y + r.h - ch;
  const room = packY - ROW_GAP - tableY;
  const downStep = Math.round(ch * DOWN_STEP);
  const stockX = x0 + width - cw;
  return { cols, cw, ch, gap, x0, homeY, tableY, downStep, room, packY, stockX, wasteX: stockX - gap - cw - 4, fan: Math.round(cw * 0.3) };
}

export const colX = (f: Frame, col: number): number => f.x0 + col * (f.cw + f.gap);
export const homeX = (f: Frame, suit: number): number => f.x0 + suit * (f.cw + f.gap);
/**
 * How far each face-up card of a column shows above the next: a short run is fanned wide, and a long one closes up
 * just enough to stay above the pack.
 */
export function upStep(f: Frame, down: number, up: number): number {
  const fit = (f.room - f.ch - down * f.downStep) / Math.max(1, up - 1);
  return Math.max(f.ch * UP_STEP_MIN, Math.min(f.ch * UP_STEP_MAX, fit));
}

/** Top of a column's card: `i` counts from the bottom of a column of `down` face-down and `up` face-up cards. */
export const cardY = (f: Frame, down: number, up: number, i: number): number => f.tableY + (i < down ? i * f.downStep : down * f.downStep + (i - down) * upStep(f, down, up));

/** The table's rectangle during a run: under the HUD, to the bottom of the screen. */
export function playRect(W: number, H: number, top: number): Rect {
  return { x: 8, y: top + HUD_H, w: W - 16, h: H - top - HUD_H - 8 };
}

export interface Hud {
  scoreX: number;
  scoreY: number;
  /** The multiplier, right-aligned. */
  multX: number;
  /** The clock: an ink rule from x0 to x1. */
  clockX0: number;
  clockX1: number;
  clockY: number;
  /** Baseline of the lane's one line. */
  laneY: number;
}

export function hud(W: number, top: number): Hud {
  return { scoreX: 12, scoreY: top + 30, multX: W - 12, clockX0: 12, clockX1: W - 12, clockY: top + 40, laneY: top + 57 };
}

export const TITLE_H = 126;
export const PROMPT_H = 40;

export interface AttractLayout {
  /** Left edge and width of the title block, and its top. */
  x: number;
  y: number;
  w: number;
  /** The demo table's rectangle. */
  table: Rect;
  /** Baseline of the prompt. */
  promptY: number;
}

/** The title block on top, the demo table under it, the prompt at the bottom: all inside what the feed leaves free. */
export function attractLayout(W: number, H: number, ins: Insets): AttractLayout {
  const m = 14;
  const x = ins.left + m;
  const y = ins.top + 6;
  const w = Math.max(60, W - ins.right - m - x);
  const bottom = H - ins.bottom - 8;
  return { x, y, w, table: { x, y: y + TITLE_H, w, h: Math.max(60, bottom - PROMPT_H - (y + TITLE_H)) }, promptY: bottom - 12 };
}

/** Font sizes of the game-over slip's three lines, and its padding. */
export const SUMMARY_PX = [22, 15, 16] as const;
export const SUMMARY_PAD = 14;

/** The game-over slip: above the caption, left of the action rail. */
export function summaryPlate(W: number, H: number, ins: Insets, standalone: boolean): Rect {
  const m = 12;
  const x = ins.left + m;
  const w = Math.max(80, W - ins.right - m - x);
  const h = 104;
  return { x, y: H - ins.bottom - m - h - (standalone ? 30 : 0), w, h };
}

/** Font size of the lane's line and of the first-run plate. */
export const LANE_PX = 16;
export const TEACH_PX = 17;
