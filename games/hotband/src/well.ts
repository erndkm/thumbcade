/**
 * The meter's grid: which segments are lit. Pure functions over a flat array, shared by the run, the pilot and
 * the tests.
 */
import { cellsOf, COLS, HIDDEN, ROWS } from "./pieces.ts";

/** 0 dark, 1 signal (lit by a piece), 2 noise (pushed up from the floor). */
export type Well = Uint8Array;
export const EMPTY = 0;
export const SIGNAL = 1;
export const NOISE = 2;

export const newWell = (): Well => new Uint8Array(COLS * ROWS);
export const at = (x: number, y: number): number => y * COLS + x;

/** Would the piece overlap a lit segment, a wall or the floor? Rows above the grid are open. */
export function collides(w: Well, kind: number, rot: number, px: number, py: number): boolean {
  for (const [cx, cy] of cellsOf(kind, rot)) {
    const x = px + cx;
    const y = py + cy;
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && w[y * COLS + x] !== EMPTY) return true;
  }
  return false;
}

/** The row the piece comes to rest on if it drops straight down from `py`. */
export function dropRow(w: Well, kind: number, rot: number, px: number, py: number): number {
  let y = py;
  while (!collides(w, kind, rot, px, y + 1)) y++;
  return y;
}

/** Lights the piece's segments. Returns their indices, or null if any of it is above the grid. */
export function place(w: Well, kind: number, rot: number, px: number, py: number): number[] | null {
  const out: number[] = [];
  for (const [cx, cy] of cellsOf(kind, rot)) {
    const y = py + cy;
    if (y < 0) return null;
    out.push(at(px + cx, y));
  }
  for (const i of out) w[i] = SIGNAL;
  return out;
}

/** Rows with every band lit, top first. */
export function fullRows(w: Well): number[] {
  const rows: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    let full = true;
    for (let x = 0; x < COLS; x++) {
      if (w[y * COLS + x] === EMPTY) {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  return rows;
}

/** Takes the rows out; everything above each one drops a row. */
export function removeRows(w: Well, rows: readonly number[]): void {
  for (const row of [...rows].sort((a, b) => a - b)) {
    w.copyWithin(COLS, 0, row * COLS);
    w.fill(EMPTY, 0, COLS);
  }
}

/** Pushes a row of noise in at the floor with one band left dark. True if lit segments were pushed off the top. */
export function pushNoise(w: Well, gap: number): boolean {
  let lost = false;
  for (let x = 0; x < COLS; x++) if (w[x] !== EMPTY) lost = true;
  w.copyWithin(0, COLS);
  for (let x = 0; x < COLS; x++) w[(ROWS - 1) * COLS + x] = x === gap ? EMPTY : NOISE;
  return lost;
}

/** Height of each band: lit segments counted from the floor to its highest one. */
export function heights(w: Well): number[] {
  const h = new Array<number>(COLS).fill(0);
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (w[y * COLS + x] !== EMPTY) {
        h[x] = ROWS - y;
        break;
      }
    }
  }
  return h;
}

/** Dark segments with a lit one somewhere above them in the same band. */
export function holes(w: Well): number {
  let n = 0;
  for (let x = 0; x < COLS; x++) {
    let covered = false;
    for (let y = 0; y < ROWS; y++) {
      const v = w[y * COLS + x];
      if (v !== EMPTY) covered = true;
      else if (covered) n++;
    }
  }
  return n;
}

/** Is anything lit above the meter's top row? */
export function clipped(w: Well): boolean {
  for (let i = 0; i < HIDDEN * COLS; i++) if (w[i] !== EMPTY) return true;
  return false;
}

export const isEmpty = (w: Well): boolean => w.every((v) => v === EMPTY);

/** Lit segments in all. */
export const lit = (w: Well): number => w.reduce((n, v) => n + (v !== EMPTY ? 1 : 0), 0);
