/**
 * The meter and the pieces that fall into it.
 *
 * The meter is eight bands wide and sixteen segments tall, with two hidden rows above for a piece to arrive in.
 * The seven pieces are Hotband's own set: a pair, a bar of three, a corner of three, a block, a tee, and a zig and
 * its mirror. Rows count down the screen: row 0 is the top hidden row, row ROWS - 1 the bottom of the meter.
 */
export const COLS = 8;
export const VISIBLE = 16;
export const HIDDEN = 2;
export const ROWS = VISIBLE + HIDDEN;

export const KINDS = ["pair", "bar", "corner", "block", "tee", "zig", "zag"] as const;
export type Kind = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const KIND_COUNT = KINDS.length;

export type Cell = readonly [x: number, y: number];

/** Each piece in its box (the box turns about its centre), as it arrives. */
const BASE: ReadonlyArray<{ box: number; cells: Cell[] }> = [
  { box: 2, cells: [[0, 0], [1, 0]] },
  { box: 3, cells: [[0, 1], [1, 1], [2, 1]] },
  { box: 2, cells: [[0, 0], [0, 1], [1, 1]] },
  { box: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { box: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { box: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { box: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
];

const turn = (cells: readonly Cell[], box: number): Cell[] => cells.map(([x, y]) => [box - 1 - y, x] as const);

/** SHAPES[kind][rot]: the cells of a piece after `rot` quarter turns clockwise. */
export const SHAPES: ReadonlyArray<ReadonlyArray<readonly Cell[]>> = BASE.map(({ box, cells }) => {
  const rots: Cell[][] = [cells];
  for (let i = 1; i < 4; i++) rots.push(turn(rots[i - 1]!, box));
  return rots;
});

export const BOX: readonly number[] = BASE.map((b) => b.box);
export const SIZE: readonly number[] = BASE.map((b) => b.cells.length);

/** Where a rotation that doesn't fit may shift to: a step sideways, a step up, then two sideways. */
export const KICKS: readonly Cell[] = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];

export const cellsOf = (kind: number, rot: number): readonly Cell[] => SHAPES[kind]![rot & 3]!;

/** The piece's extent inside its box. */
export function extent(kind: number, rot: number): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = 9;
  let x1 = -1;
  let y0 = 9;
  let y1 = -1;
  for (const [x, y] of cellsOf(kind, rot)) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1 };
}

/** Box position a new piece arrives at: centred, its lowest segment on the first visible row. */
export function spawnAt(kind: number): { x: number; y: number } {
  const e = extent(kind, 0);
  const width = e.x1 - e.x0 + 1;
  return { x: Math.floor((COLS - width) / 2) - e.x0, y: HIDDEN - e.y1 };
}

/** How many distinct poses a piece has (a block has one, a bar two). */
export function poses(kind: number): number {
  const key = (rot: number) => {
    const e = extent(kind, rot);
    return cellsOf(kind, rot)
      .map(([x, y]) => `${x - e.x0},${y - e.y0}`)
      .sort()
      .join(" ");
  };
  const seen = new Set<string>();
  for (let r = 0; r < 4; r++) seen.add(key(r));
  return seen.size;
}
