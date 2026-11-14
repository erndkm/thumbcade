/**
 * The dungeon map: a 7 × 9 sheet of squares with pen lines between some of them. Every floor is drawn fresh from
 * its seed: one connected maze with no dead ends (a knight with something behind him always has a way on), loops
 * to lead things round, and no open 2 × 2 rooms, so it reads as corridors.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const COLS = 7;
export const ROWS = 9;
export const N = COLS * ROWS;
/** 0 up, 1 right, 2 down, 3 left. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (d: number): Dir => ((d + 2) % 4) as Dir;
export const cellOf = (x: number, y: number): number => y * COLS + x;
export const xOf = (c: number): number => c % COLS;
export const yOf = (c: number): number => Math.floor(c / COLS);

/** The square next door in direction `d`, or -1 off the sheet (walls are not checked). */
export function beside(c: number, d: number): number {
  const x = xOf(c) + DX[d]!;
  const y = yOf(c) + DY[d]!;
  return x < 0 || x >= COLS || y < 0 || y >= ROWS ? -1 : cellOf(x, y);
}

export interface Maze {
  /** open[c * 4 + d] = 1 when there is no line between square c and its neighbour in direction d. */
  open: Uint8Array;
  /** Where the knight starts: bottom middle. */
  start: number;
  /** The holes the scribbles crawl out of. */
  holes: number[];
  /** Where the two swords lie. */
  swords: number[];
}

export const START = cellOf(3, ROWS - 1);
export const HOLES = [cellOf(0, 0), cellOf(COLS - 1, 0), cellOf(0, 4), cellOf(COLS - 1, 5)];

export const isOpen = (m: Maze, c: number, d: number): boolean => m.open[c * 4 + d] === 1;
export const degree = (m: Maze, c: number): number => m.open[c * 4]! + m.open[c * 4 + 1]! + m.open[c * 4 + 2]! + m.open[c * 4 + 3]!;

function setOpen(open: Uint8Array, c: number, d: number): void {
  const n = beside(c, d);
  if (n < 0) return;
  open[c * 4 + d] = 1;
  open[n * 4 + opposite(d)] = 1;
}

/** True when the four squares with top-left (x, y) would have no line between any of them. */
function roomAt(open: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= COLS - 1 || y >= ROWS - 1) return false;
  const a = cellOf(x, y);
  const b = cellOf(x + 1, y + 1);
  return open[a * 4 + 1] === 1 && open[a * 4 + 2] === 1 && open[b * 4 + 0] === 1 && open[b * 4 + 3] === 1;
}

/** Would rubbing out the line on side `d` of square `c` open a 2 × 2 room? */
function makesRoom(open: Uint8Array, c: number, d: number): boolean {
  const n = beside(c, d);
  if (n < 0 || open[c * 4 + d]) return false;
  open[c * 4 + d] = 1;
  open[n * 4 + opposite(d)] = 1;
  const x = Math.min(xOf(c), xOf(n));
  const y = Math.min(yOf(c), yOf(n));
  // The line is shared by at most two 2 × 2 blocks.
  const room = d === 1 || d === 3 ? roomAt(open, x, y) || roomAt(open, x, y - 1) : roomAt(open, x, y) || roomAt(open, x - 1, y);
  open[c * 4 + d] = 0;
  open[n * 4 + opposite(d)] = 0;
  return room;
}

/** Steps from `from` to every square (-1: unreachable), walking only through gaps. */
export function distances(m: Maze, from: number, out: Int16Array = new Int16Array(N)): Int16Array {
  out.fill(-1);
  const queue = new Int16Array(N);
  let head = 0;
  let tail = 0;
  out[from] = 0;
  queue[tail++] = from;
  while (head < tail) {
    const c = queue[head++]!;
    for (let d = 0; d < 4; d++) {
      if (!m.open[c * 4 + d]) continue;
      const n = beside(c, d);
      if (out[n]! >= 0) continue;
      out[n] = out[c]! + 1;
      queue[tail++] = n;
    }
  }
  return out;
}

export function generate(seed: number): Maze {
  const rng: Rng = createRng(seed);
  const open = new Uint8Array(N * 4);
  // 1. One path to everywhere: a random walk that backs up when it is boxed in.
  const seen = new Uint8Array(N);
  const stack = [rng.int(0, N - 1)];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1]!;
    const dirs = rng.shuffle([0, 1, 2, 3]).filter((d) => {
      const n = beside(c, d);
      return n >= 0 && !seen[n];
    });
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const n = beside(c, dirs[0]!);
    setOpen(open, c, dirs[0]!);
    seen[n] = 1;
    stack.push(n);
  }
  const m: Maze = { open, start: START, holes: HOLES, swords: [] };
  // 2. No dead ends: every square gets a second way out, without opening a room if that can be helped.
  for (const c of rng.shuffle(Array.from({ length: N }, (_, i) => i))) {
    while (degree(m, c) < 2) {
      const shut = rng.shuffle([0, 1, 2, 3]).filter((d) => beside(c, d) >= 0 && !open[c * 4 + d]);
      const pick = shut.find((d) => !makesRoom(open, c, d) && degree(m, beside(c, d)) < 3) ?? shut.find((d) => !makesRoom(open, c, d)) ?? shut[0]!;
      setOpen(open, c, pick);
    }
  }
  // 3. A few more loops, so there is always a way round.
  let extra = Math.round(N * 0.13);
  for (let tries = 0; tries < 400 && extra > 0; tries++) {
    const c = rng.int(0, N - 1);
    const d = rng.int(0, 3);
    const n = beside(c, d);
    if (n < 0 || open[c * 4 + d] || makesRoom(open, c, d)) continue;
    if (degree(m, c) >= 3 || degree(m, n) >= 3) continue;
    setOpen(open, c, d);
    extra--;
  }
  // 4. Rule a line back through any room. The four squares stay joined by the room's other sides; a square left
  //    with one way out gets a new gap somewhere that opens no room. If that can't be done, the line comes out again.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let y = 0; y < ROWS - 1; y++) {
      for (let x = 0; x < COLS - 1; x++) {
        if (!roomAt(open, x, y)) continue;
        const sides: Array<[number, number]> = [[cellOf(x, y), 1], [cellOf(x, y), 2], [cellOf(x + 1, y + 1), 0], [cellOf(x + 1, y + 1), 3]];
        for (const [c, d] of rng.shuffle(sides)) {
          const n = beside(c, d);
          const before = open.slice();
          open[c * 4 + d] = 0;
          open[n * 4 + opposite(d)] = 0;
          let ok = true;
          for (const e of [c, n]) {
            if (degree(m, e) >= 2) continue;
            const way = rng.shuffle([0, 1, 2, 3]).find((dd) => beside(e, dd) >= 0 && !open[e * 4 + dd] && !(e === c && dd === d) && !(e === n && dd === opposite(d)) && !makesRoom(open, e, dd));
            if (way === undefined) ok = false;
            else setOpen(open, e, way);
          }
          if (ok) {
            changed = true;
            break;
          }
          open.set(before);
        }
      }
    }
    if (!changed) break;
  }
  // 5. Two swords, far from the start and from each other.
  const fromStart = distances(m, START);
  const far = Array.from({ length: N }, (_, i) => i).filter((c) => fromStart[c]! >= 6 && !HOLES.includes(c));
  const first = rng.pick(far.filter((c) => yOf(c) <= 4).length ? far.filter((c) => yOf(c) <= 4) : far);
  const fromFirst = distances(m, first);
  const apart = (c: number): number => Math.abs(xOf(c) - xOf(first)) + Math.abs(yOf(c) - yOf(first));
  const rest = far.filter((c) => fromFirst[c]! >= 6 && apart(c) >= 4);
  const second = rest.length ? rng.pick(rest) : far.reduce((a, c) => (fromFirst[c]! + apart(c) > fromFirst[a]! + apart(a) ? c : a), far[0]!);
  m.swords = [first, second];
  return m;
}
