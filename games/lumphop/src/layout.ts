/**
 * Where everything sits, as pure functions of the viewport, the insets and the board, so the game, the shoot plan
 * and the tests agree on every pot's position and hit area.
 *
 * A pot stands on a shelf; its lumps stack up out of it, the bottom one sunk into the pot. Sizes are in U, the
 * width of a lump in CSS px.
 */
import type { Insets } from "@thumbcade/sdk";

/** Lump height, the step between stacked lumps, the pot's size, how deep the bottom lump sits, how far a lift rises. */
export const UNIT_H = 0.64;
export const STEP = 0.56;
export const POT_H = 0.58;
export const POT_W = 1.14;
export const SINK = 0.3;
export const LIFT = 0.7;
/** A column, top of a lifted run of a full pot to the shelf's lip, and the room between two rows. */
export const COL_ABOVE = 2.86;
export const COL_BELOW = POT_H + 0.16;
export const ROW_GAP = 0.3;
/** Pots are spaced this far apart, centre to centre. */
export const PITCH = 1.3;
export const MAX_U = 84;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Spot {
  /** Centre x of the pot, and the y of its rim. */
  x: number;
  rim: number;
  row: number;
}

export interface Geo {
  U: number;
  spots: Spot[];
  /** The shelf under each row: its top y and its extent. */
  shelves: Array<{ y: number; x0: number; x1: number }>;
}

/** Pots per row: one row up to three pots, then two rows with the longer one on top. */
export function rowsFor(n: number): number[] {
  if (n <= 3) return [n];
  const top = Math.ceil(n / 2);
  return [top, n - top];
}

/** Lays out `n` pots in `box`, a little below the middle (nearer the thumb). */
export function boardGeo(n: number, box: Box): Geo {
  const rows = rowsFor(n);
  const per = Math.max(...rows);
  // Each column keeps 0.1 U above and below for its tap area.
  const colH = COL_ABOVE + COL_BELOW + 0.2;
  const byW = box.w / (per * PITCH);
  const byH = box.h / (rows.length * colH + (rows.length - 1) * ROW_GAP);
  const U = Math.max(24, Math.min(MAX_U, byW, byH));
  const blockH = (rows.length * colH + (rows.length - 1) * ROW_GAP) * U;
  const y0 = box.y + (box.h - blockH) * 0.62;
  const spots: Spot[] = [];
  const shelves: Geo["shelves"] = [];
  rows.forEach((count, r) => {
    const rim = y0 + (0.1 + COL_ABOVE + r * (colH + ROW_GAP)) * U;
    const w = count * PITCH * U;
    const x0 = box.x + (box.w - w) / 2;
    for (let i = 0; i < count; i++) spots.push({ x: x0 + (i + 0.5) * PITCH * U, rim, row: r });
    const sw = Math.max(w, per * PITCH * U) + U * 0.3;
    shelves.push({ y: rim + POT_H * U, x0: box.x + (box.w - sw) / 2, x1: box.x + (box.w + sw) / 2 });
  });
  return { U, spots, shelves };
}

/** Centre y of the i-th lump up from the bottom of a pot whose rim is at `rim`. */
export const lumpY = (rim: number, U: number, i: number): number => rim + SINK * U - i * STEP * U - (UNIT_H * U) / 2;

/** The tap area of pot `i`: its whole column, from above a lifted run down to the shelf. */
export function hitBox(g: Geo, i: number): Box {
  const s = g.spots[i]!;
  const w = PITCH * g.U;
  return { x: s.x - w / 2, y: s.rim - (COL_ABOVE + 0.1) * g.U, w, h: (COL_ABOVE + COL_BELOW + 0.2) * g.U };
}

/** The pot under a tap, with near-miss help: a tap within `slack` px of a pot's column still counts. */
export function potAt(g: Geo, x: number, y: number, slack = 30): number {
  let best = -1;
  let bestD = slack;
  for (let i = 0; i < g.spots.length; i++) {
    const b = hitBox(g, i);
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d === 0) return i;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The HUD row, the message lane, the board and the bottom strip during a run. */
export interface PlayFrame {
  top: number;
  hud: Box;
  lane: Box;
  board: Box;
  strip: Box;
}

export function playFrame(W: number, H: number, play: Insets): PlayFrame {
  const top = play.top + 6;
  const hud: Box = { x: 12, y: top, w: W - 24, h: 58 };
  const lane: Box = { x: 16, y: top + 62, w: W - 32, h: 36 };
  const strip: Box = { x: 12, y: H - 62, w: W - 24, h: 54 };
  const board: Box = { x: 10, y: lane.y + lane.h + 4, w: W - 20, h: strip.y - (lane.y + lane.h + 4) - 4 };
  return { top, hud, lane, board, strip };
}

/** In attract mode the demo board sits between the title block and the caption, clear of the action rail. */
export function attractBoard(W: number, H: number, pv: Insets, titleBottom: number): Box {
  const x = pv.left + 8;
  return { x, y: titleBottom + 6, w: W - pv.right - 4 - x, h: Math.max(140, H - pv.bottom - 8 - (titleBottom + 6)) };
}
