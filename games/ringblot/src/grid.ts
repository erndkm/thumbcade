/** The sheet: 15 × 26 squares, numbered row by row from the top left. */
export const COLS = 15;
export const ROWS = 26;
export const N = COLS * ROWS;
/** 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (d: number): number => (d + 2) % 4;
export const cellOf = (x: number, y: number): number => y * COLS + x;
export const xOf = (c: number): number => c % COLS;
export const yOf = (c: number): number => Math.floor(c / COLS);

/** The square next door in direction `d`, or -1 off the sheet. */
export function beside(c: number, d: number): number {
  const x = xOf(c) + DX[d]!;
  const y = yOf(c) + DY[d]!;
  return x < 0 || x >= COLS || y < 0 || y >= ROWS ? -1 : cellOf(x, y);
}

/** Steps between two squares, walking along the grid. */
export const steps = (a: number, b: number): number => Math.abs(xOf(a) - xOf(b)) + Math.abs(yOf(a) - yOf(b));

/** The direction from a square to the one next to it (-1 if they aren't neighbours). */
export function dirTo(a: number, b: number): number {
  for (let d = 0; d < 4; d++) if (beside(a, d) === b) return d;
  return -1;
}
