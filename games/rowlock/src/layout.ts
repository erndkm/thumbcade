/**
 * Where everything sits, as pure functions of the viewport, so the game, the tests and the screenshot plans agree
 * on every key. Two layouts: attract (inside the feed's preview safe area, under the title block) and play (full
 * width, the board low enough for a thumb, the pad in the thumb's row).
 */
import type { Shape } from "./grid.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Board {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Key size, gap between keys, gap between boxes. */
  cell: number;
  gap: number;
  boxGap: number;
  shape: Shape;
}

export interface PlayGeometry {
  /** Bottom of the score and clock. */
  hud: number;
  /** Centre line of the grid's tag ("TODAY'S GRID", "GRID 3 · 6×6"). */
  tagY: number;
  board: Board;
  /** Centre line of the streak meter row, between the board and the pad. */
  meterY: number;
  lamp: Rect;
  pad: Rect[];
}

/** Gaps for a key size: boxes stand apart clearly, keys only a little. */
function gaps(cell: number): { gap: number; boxGap: number } {
  return { gap: Math.max(3, Math.round(cell * 0.075)), boxGap: Math.max(7, Math.round(cell * 0.2)) };
}

/** Board width and height for a key size. */
export function boardSize(shape: Shape, cell: number): { w: number; h: number } {
  const { n, br, bc } = shape;
  const { gap, boxGap } = gaps(cell);
  const across = n / bc;
  const down = n / br;
  return { w: n * cell + (n - across) * gap + (across - 1) * boxGap, h: n * cell + (n - down) * gap + (down - 1) * boxGap };
}

/** The largest key size that fits w × h (capped at `max`). */
export function fitCell(shape: Shape, w: number, h: number, max: number): number {
  let lo = 8;
  let hi = max;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    const s = boardSize(shape, mid);
    if (s.w <= w && s.h <= h) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 4) / 4;
}

export function makeBoard(shape: Shape, cell: number, cx: number, top: number): Board {
  const s = boardSize(shape, cell);
  const { gap, boxGap } = gaps(cell);
  return { x: cx - s.w / 2, y: top, w: s.w, h: s.h, cell, gap, boxGap, shape };
}

/** The rectangle of key `i` on a board. */
export function keyRect(b: Board, i: number): Rect {
  const { n, br, bc } = b.shape;
  const r = Math.floor(i / n);
  const c = i % n;
  const bx = Math.floor(c / bc);
  const by = Math.floor(r / br);
  return { x: b.x + c * b.cell + (c - bx) * b.gap + bx * b.boxGap, y: b.y + r * b.cell + (r - by) * b.gap + by * b.boxGap, w: b.cell, h: b.cell };
}

/** Which key a point is on, with near misses in the gaps going to the nearest key. Null when off the board. */
export function keyAt(b: Board, x: number, y: number, slack = 10): number | null {
  if (x < b.x - slack || x > b.x + b.w + slack || y < b.y - slack || y > b.y + b.h + slack) return null;
  let best = -1;
  let bestD = Infinity;
  const n = b.shape.n;
  for (let i = 0; i < n * n; i++) {
    const k = keyRect(b, i);
    const dx = Math.max(k.x - x, 0, x - (k.x + k.w));
    const dy = Math.max(k.y - y, 0, y - (k.y + k.h));
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
  }
  return bestD <= slack * slack ? best : null;
}

/** Largest key per grid size during play. */
const MAX_CELL: Record<number, number> = { 4: 78, 6: 60 };

/**
 * The play layout on a W × H game viewport whose status bar is `insetTop` tall. The pad sits in the thumb's row,
 * the streak meter just above it, and the board as large as the width allows, pushed toward the thumb.
 */
export function playGeometry(W: number, H: number, insetTop: number, shape: Shape): PlayGeometry {
  const hud = insetTop + 98;
  const boardTop = hud + 28;
  const n = shape.n;
  const padH = Math.max(56, Math.min(66, H * 0.085));
  const padBottom = H - 14;
  const padTop = padBottom - padH;
  const meterH = 46;
  const meterY = padTop - 10 - meterH / 2;
  const boardBottom = meterY - meterH / 2 - 8;
  // 22 px either side: room for the lock marks beside locked rows.
  const cell = fitCell(shape, W - 44, boardBottom - boardTop, MAX_CELL[n] ?? 60);
  const size = boardSize(shape, cell);
  const spare = Math.max(0, boardBottom - boardTop - size.h);
  const board = makeBoard(shape, cell, W / 2, boardTop + spare * 0.6);
  const gap = 8;
  const keyW = Math.min(84, (W - 24 - gap * (n - 1)) / n);
  const rowW = n * keyW + (n - 1) * gap;
  const x0 = (W - rowW) / 2;
  const pad = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (keyW + gap), y: padTop, w: keyW, h: padH }));
  const lamp = { x: W - 12 - 64, y: meterY - 22, w: 64, h: 44 };
  return { hud, tagY: board.y - 16, board, meterY, lamp, pad };
}

export interface AttractGeometry {
  titleY: number;
  board: Board;
  pad: Rect[];
  promptY: number;
}

/** The attract layout inside the preview safe rect `r`: title block, the board, a small pad, the prompt. */
export function attractGeometry(r: Rect, shape: Shape): AttractGeometry {
  const titleY = r.y + 42;
  const first = r.y + 124;
  const promptY = r.y + r.h - 14;
  const padH = 30;
  const avail = promptY - 30 - padH - 12 - first;
  const n = shape.n;
  const cell = fitCell(shape, Math.min(r.w, 270), avail, n === 4 ? 56 : 40);
  // The board and its pad sit in the middle of the room between the title block and the prompt.
  const block = boardSize(shape, cell).h + 12 + padH;
  const top = first + Math.max(0, (avail + 12 + padH - block) / 2);
  const board = makeBoard(shape, cell, r.x + r.w / 2, top);
  const gap = 5;
  const keyW = Math.min(40, (board.w - gap * (n - 1)) / n);
  const rowW = n * keyW + (n - 1) * gap;
  const x0 = r.x + (r.w - rowW) / 2;
  const padY = board.y + board.h + 12;
  return { titleY, board, pad: Array.from({ length: n }, (_, i) => ({ x: x0 + i * (keyW + gap), y: padY, w: keyW, h: padH })), promptY };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}
export function lerpBoard(a: Board, b: Board, t: number): Board {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), cell: lerp(a.cell, b.cell, t), gap: lerp(a.gap, b.gap, t), boxGap: lerp(a.boxGap, b.boxGap, t), shape: b.shape };
}
