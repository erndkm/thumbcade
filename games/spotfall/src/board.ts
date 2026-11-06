/**
 * The sheet: a hex-packed field of printed dots hanging from the press at the top, in board units (one dot is one
 * unit across). Pure and deterministic, so the aim guide, the shot in flight, the pilot and the tests all use the same
 * geometry: the cell the guide shows is the cell the dot lands in.
 *
 * Rows alternate between COLS cells and COLS - 1 cells shifted half a dot right. When the press feeds a new row in at
 * the top, every dot moves down one row and `shift` flips, so each dot keeps its x.
 */

/** Cells in a full row; offset rows have one fewer. */
export const COLS = 9;
/** Rows 0..LIMIT-1 are on the sheet. A dot left at row LIMIT or below jams the press. */
export const LIMIT = 12;
/** Rows of storage (a jam can push a row or two past the limit before the run ends). */
export const ROWS = LIMIT + 3;
export const ROW_H = Math.sqrt(3) / 2;
/** Where the shot leaves from. */
export const LAUNCH_X = COLS / 2;
/** The jam line: the bottom edge of the last row on the sheet. */
export const LINE_Y = (LIMIT - 1) * ROW_H + 1;
export const LAUNCH_Y = LINE_Y + 1.75;
/** A flying dot touches a resting one when their centres are this close (under 1, so a shot slips past a graze). */
export const HIT = 0.78;
/** Shallowest shot, from the horizontal (radians). */
export const MIN_ANGLE = (9 * Math.PI) / 180;

/** Six inks: three spot inks and their three overprints. */
export const INKS = 6;
/** A registration mark: matches any ink. */
export const WILD = 6;
/** An ink blot: bursts the dots around where it lands. */
export const BOMB = 7;
export const EMPTY = -1;
/** How far a blot reaches, centre to centre. */
export const BLAST = 1.75;

export interface Cell {
  r: number;
  c: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Trace {
  /** The launch point, every wall bounce, and the contact point. */
  points: Pt[];
  /** Where the shot's centre is when it touches the sheet. */
  contact: Pt;
  /** The cell it settles in. */
  cell: Cell;
  bounces: number;
  /** Path length in units. */
  length: number;
}

export const idx = (r: number, c: number): number => r * COLS + c;

export class Board {
  cells: Int8Array;
  shift: 0 | 1 = 0;

  constructor() {
    this.cells = new Int8Array(ROWS * COLS).fill(EMPTY);
  }

  clone(): Board {
    const b = new Board();
    b.cells.set(this.cells);
    b.shift = this.shift;
    return b;
  }

  offset(r: number): boolean {
    return ((r + this.shift) & 1) === 1;
  }

  cols(r: number): number {
    return this.offset(r) ? COLS - 1 : COLS;
  }

  valid(r: number, c: number): boolean {
    return r >= 0 && r < ROWS && c >= 0 && c < this.cols(r);
  }

  get(r: number, c: number): number {
    return this.valid(r, c) ? this.cells[idx(r, c)]! : EMPTY;
  }

  set(r: number, c: number, k: number): void {
    if (this.valid(r, c)) this.cells[idx(r, c)] = k;
  }

  cx(r: number, c: number): number {
    return 0.5 + c + (this.offset(r) ? 0.5 : 0);
  }

  cy(r: number): number {
    return 0.5 + r * ROW_H;
  }

  neighbors(r: number, c: number): Cell[] {
    const out: Cell[] = [];
    const push = (rr: number, cc: number) => {
      if (this.valid(rr, cc)) out.push({ r: rr, c: cc });
    };
    push(r, c - 1);
    push(r, c + 1);
    // An offset row sits half a dot right, so its neighbours above and below are c and c + 1; a full row's are c - 1 and c.
    const a = this.offset(r) ? c : c - 1;
    push(r - 1, a);
    push(r - 1, a + 1);
    push(r + 1, a);
    push(r + 1, a + 1);
    return out;
  }

  /** Every occupied cell. */
  occupied(): Cell[] {
    const out: Cell[] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < this.cols(r); c++) if (this.cells[idx(r, c)]! !== EMPTY) out.push({ r, c });
    return out;
  }

  count(): number {
    let n = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < this.cols(r); c++) if (this.cells[idx(r, c)]! !== EMPTY) n++;
    return n;
  }

  /** The lowest occupied row, or -1 on a clean sheet. */
  lowest(): number {
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < this.cols(r); c++) if (this.cells[idx(r, c)]! !== EMPTY) return r;
    return -1;
  }

  /** Inks on the sheet (specials excluded), in ink order. */
  inks(): number[] {
    const seen = new Array<boolean>(INKS).fill(false);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < this.cols(r); c++) {
        const k = this.cells[idx(r, c)]!;
        if (k >= 0 && k < INKS) seen[k] = true;
      }
    return seen.flatMap((s, k) => (s ? [k] : []));
  }

  /** A cell a dot could settle in: empty, and either under the press or next to a dot. */
  attachable(r: number, c: number): boolean {
    if (!this.valid(r, c) || this.get(r, c) !== EMPTY) return false;
    if (r === 0) return true;
    return this.neighbors(r, c).some((n) => this.get(n.r, n.c) !== EMPTY);
  }

  /** The cell a dot touching the sheet at `p` settles in: the nearest attachable cell to its centre. */
  snap(p: Pt): Cell {
    const r0 = Math.round((p.y - 0.5) / ROW_H);
    let best: Cell | null = null;
    let bestD = Infinity;
    for (let r = Math.max(0, r0 - 2); r <= Math.min(ROWS - 1, r0 + 2); r++) {
      for (let c = 0; c < this.cols(r); c++) {
        if (!this.attachable(r, c)) continue;
        const d = (this.cx(r, c) - p.x) ** 2 + (this.cy(r) - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { r, c };
        }
      }
    }
    if (best) return best;
    // Nothing attachable nearby (cannot happen on a sheet that touched the shot): the nearest empty cell.
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < this.cols(r); c++) {
        if (this.get(r, c) !== EMPTY) continue;
        const d = (this.cx(r, c) - p.x) ** 2 + (this.cy(r) - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { r, c };
        }
      }
    return best ?? { r: 0, c: 0 };
  }

  /**
   * The path of a shot fired at `angle` (radians from the horizontal, counter-clockwise; π/2 is straight up): straight
   * lines between wall bounces until it touches a dot or the press. Analytic, so the guide and the flight agree exactly.
   */
  trace(angle: number, from: Pt = { x: LAUNCH_X, y: LAUNCH_Y }): Trace {
    const a = clampAngle(angle);
    let px = from.x;
    let py = from.y;
    let dx = Math.cos(a);
    const dy = -Math.sin(a);
    const points: Pt[] = [{ x: px, y: py }];
    let length = 0;
    let bounces = 0;
    const occ = this.occupied().map((o) => ({ x: this.cx(o.r, o.c), y: this.cy(o.r) }));
    for (let seg = 0; seg < 24; seg++) {
      let t = Infinity;
      let what: "wall" | "ceil" | "dot" = "ceil";
      const tc = (py - 0.5) / -dy;
      if (tc < t) {
        t = tc;
        what = "ceil";
      }
      if (dx > 1e-9) {
        const tw = (COLS - 0.5 - px) / dx;
        if (tw < t) {
          t = tw;
          what = "wall";
        }
      } else if (dx < -1e-9) {
        const tw = (0.5 - px) / dx;
        if (tw < t) {
          t = tw;
          what = "wall";
        }
      }
      for (const o of occ) {
        // |p + t d - o|² = HIT²  →  t² - 2 t (d·(o - p)) + |o - p|² - HIT² = 0
        const ox = o.x - px;
        const oy = o.y - py;
        const b = ox * dx + oy * dy;
        if (b <= 0) continue;
        const cc = ox * ox + oy * oy - HIT * HIT;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const th = b - Math.sqrt(disc);
        if (th >= -1e-6 && th < t) {
          t = Math.max(0, th);
          what = "dot";
        }
      }
      px += dx * t;
      py += dy * t;
      length += t;
      points.push({ x: px, y: py });
      if (what === "wall") {
        dx = -dx;
        bounces++;
        continue;
      }
      const contact = { x: px, y: py };
      return { points, contact, cell: this.snap(contact), bounces, length };
    }
    const contact = { x: px, y: Math.max(0.5, py) };
    return { points, contact, cell: this.snap(contact), bounces, length };
  }

  /** The connected dots of ink `kind` through (r, c) (which counts whatever is in it). */
  group(r: number, c: number, kind: number): Cell[] {
    const seen = new Uint8Array(ROWS * COLS);
    const out: Cell[] = [];
    const stack: Cell[] = [{ r, c }];
    seen[idx(r, c)] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      for (const n of this.neighbors(cur.r, cur.c)) {
        const i = idx(n.r, n.c);
        if (seen[i]) continue;
        const k = this.cells[i]!;
        if (k === kind || k === WILD) {
          seen[i] = 1;
          stack.push(n);
        }
      }
    }
    return out;
  }

  /** Dots no longer hanging from the press (through other dots), top to bottom. */
  floating(): Cell[] {
    const seen = new Uint8Array(ROWS * COLS);
    const stack: Cell[] = [];
    for (let c = 0; c < this.cols(0); c++)
      if (this.cells[idx(0, c)]! !== EMPTY) {
        seen[idx(0, c)] = 1;
        stack.push({ r: 0, c });
      }
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of this.neighbors(cur.r, cur.c)) {
        const i = idx(n.r, n.c);
        if (seen[i] || this.cells[i]! === EMPTY) continue;
        seen[i] = 1;
        stack.push(n);
      }
    }
    const out: Cell[] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < this.cols(r); c++) if (this.cells[idx(r, c)]! !== EMPTY && !seen[idx(r, c)]) out.push({ r, c });
    return out;
  }

  /** Occupied cells within `reach` (centre to centre) of (r, c), nearest first, (r, c) itself included. */
  around(r: number, c: number, reach: number): Cell[] {
    const x = this.cx(r, c);
    const y = this.cy(r);
    const out: Array<Cell & { d: number }> = [];
    for (let rr = Math.max(0, r - 3); rr <= Math.min(ROWS - 1, r + 3); rr++)
      for (let cc = 0; cc < this.cols(rr); cc++) {
        if (this.get(rr, cc) === EMPTY) continue;
        const d = Math.hypot(this.cx(rr, cc) - x, this.cy(rr) - y);
        if (d <= reach + 1e-6) out.push({ r: rr, c: cc, d });
      }
    return out.sort((a, b) => a.d - b.d).map(({ r: rr, c: cc }) => ({ r: rr, c: cc }));
  }

  /**
   * The press feeds a fresh row in at the top: every dot moves down a row (keeping its x) and `row` is printed at row
   * 0. `row` is indexed by column and may be longer than the new row 0 (the extra cell is ignored).
   */
  feed(row: ArrayLike<number>): void {
    this.cells.copyWithin(COLS, 0, (ROWS - 1) * COLS);
    this.shift = (this.shift ^ 1) as 0 | 1;
    for (let c = 0; c < COLS; c++) this.cells[c] = c < this.cols(0) ? (row[c] ?? EMPTY) : EMPTY;
  }
}

export function clampAngle(a: number): number {
  return Math.min(Math.PI - MIN_ANGLE, Math.max(MIN_ANGLE, a));
}

/** The ink sitting on a printing plate, for the mark and pairing logic. Overprints sit on two plates. */
export const PLATES: ReadonlyArray<ReadonlyArray<0 | 1 | 2>> = [
  [0], // blue
  [1], // pink
  [2], // yellow
  [0, 2], // green: blue over yellow
  [1, 2], // orange: pink over yellow
  [0, 1], // violet: blue over pink
];
