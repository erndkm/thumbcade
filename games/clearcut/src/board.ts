import type { Rng } from "@thumbcade-games/kit";

/** Clearcut's rules: an 8×8 board, polyomino pieces, full rows and columns cut away. Pure logic, no drawing. */

export const N = 8;

export interface Shape {
  /** Cells as [row, col] from the top-left of the bounding box. */
  cells: ReadonlyArray<readonly [number, number]>;
  rows: number;
  cols: number;
  /** 0 = small (1-3 cells), 1 = medium (4), 2 = big (5+). */
  tier: 0 | 1 | 2;
  weight: number;
}

function parse(rows: string[], weight: number): Shape {
  const cells: Array<[number, number]> = [];
  rows.forEach((line, r) => [...line].forEach((ch, c) => ch === "#" && cells.push([r, c])));
  const n = cells.length;
  return { cells, rows: rows.length, cols: Math.max(...rows.map((l) => l.length)), tier: n <= 3 ? 0 : n === 4 ? 1 : 2, weight };
}

function rotate(rows: string[]): string[] {
  const h = rows.length;
  const w = Math.max(...rows.map((l) => l.length));
  const out: string[] = [];
  for (let c = 0; c < w; c++) {
    let line = "";
    for (let r = h - 1; r >= 0; r--) line += rows[r]![c] ?? ".";
    out.push(line);
  }
  return out;
}

/** Every distinct rotation (and mirror, if asked) of a pattern. */
function variants(rows: string[], weight: number, mirror = false): Shape[] {
  const seen = new Set<string>();
  const out: Shape[] = [];
  const add = (p: string[]) => {
    for (let i = 0; i < 4; i++) {
      const key = p.join("/");
      if (!seen.has(key)) {
        seen.add(key);
        out.push(parse(p, 0));
      }
      p = rotate(p);
    }
  };
  add(rows);
  if (mirror) add(rows.map((l) => [...l].reverse().join("")));
  // A pattern's weight is shared by its orientations, so shapes with many rotations don't crowd the tray.
  for (const s of out) s.weight = weight / out.length;
  return out;
}

/**
 * The cut list. Bars of every length, blocks, corners small and large, plus the four-cell bends;
 * small pieces keep a crowded board alive, big ones pay off when there's room.
 */
export const SHAPES: Shape[] = [
  ...variants(["#"], 0.5),
  ...variants(["##"], 1),
  ...variants(["###"], 1.1),
  ...variants(["####"], 0.9),
  ...variants(["#####"], 0.7),
  ...variants(["##", "##"], 1.1),
  ...variants(["###", "###", "###"], 0.45),
  ...variants(["###", "###"], 0.7),
  ...variants(["##", "#."], 1),
  ...variants(["###", "#..", "#.."], 0.7),
  ...variants(["###", "#.."], 0.8, true),
  ...variants(["###", ".#."], 0.7),
  ...variants(["##.", ".##"], 0.6, true),
];

export type Cells = Uint8Array;

export const newBoard = (): Cells => new Uint8Array(N * N);
export const at = (b: Cells, r: number, c: number): number => b[r * N + c]!;

export function fits(b: Cells, s: Shape, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r + s.rows > N || c + s.cols > N) return false;
  for (const [dr, dc] of s.cells) if (b[(r + dr) * N + c + dc]) return false;
  return true;
}

export function canFit(b: Cells, s: Shape): boolean {
  for (let r = 0; r <= N - s.rows; r++) for (let c = 0; c <= N - s.cols; c++) if (fits(b, s, r, c)) return true;
  return false;
}

/** Writes `tone` (1-based) into the cells. */
export function place(b: Cells, s: Shape, r: number, c: number, tone: number): void {
  for (const [dr, dc] of s.cells) b[(r + dr) * N + c + dc] = tone;
}

export interface Lines {
  rows: number[];
  cols: number[];
}

export function fullLines(b: Cells): Lines {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < N; i++) {
    let row = true;
    let col = true;
    for (let j = 0; j < N; j++) {
      if (!b[i * N + j]) row = false;
      if (!b[j * N + i]) col = false;
    }
    if (row) rows.push(i);
    if (col) cols.push(i);
  }
  return { rows, cols };
}

/** Lines that placing `s` at (r, c) would complete (without changing `b`). */
export function linesIf(b: Cells, s: Shape, r: number, c: number): Lines {
  const copy = b.slice();
  place(copy, s, r, c, 1);
  return fullLines(copy);
}

export interface Cut {
  r: number;
  c: number;
  tone: number;
  /** 0..1 along the sweep that removes it (sweeps run left→right and top→bottom). */
  order: number;
}

/** Empties the given lines and returns each removed cell once. */
export function cut(b: Cells, lines: Lines): Cut[] {
  const out = new Map<number, Cut>();
  for (const r of lines.rows) for (let c = 0; c < N; c++) out.set(r * N + c, { r, c, tone: b[r * N + c]!, order: c / (N - 1) });
  for (const c of lines.cols)
    for (let r = 0; r < N; r++) {
      const prev = out.get(r * N + c);
      const order = r / (N - 1);
      if (prev) prev.order = Math.min(prev.order, order);
      else out.set(r * N + c, { r, c, tone: b[r * N + c]!, order });
    }
  for (const k of out.keys()) b[k] = 0;
  return [...out.values()];
}

export const isEmpty = (b: Cells): boolean => b.every((v) => v === 0);
export const filled = (b: Cells): number => b.reduce((a, v) => a + (v ? 1 : 0), 0);

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

/** Piece weights shift toward big pieces as the run goes on (d = 0..1). */
function pick(rng: Rng, d: number, pool: Shape[] = SHAPES): Shape {
  const tierBoost = [1.25 - d * 0.45, 1, 0.7 + d * 0.8];
  let total = 0;
  for (const s of pool) total += s.weight * tierBoost[s.tier]!;
  let x = rng() * total;
  for (const s of pool) {
    x -= s.weight * tierBoost[s.tier]!;
    if (x <= 0) return s;
  }
  return pool[pool.length - 1]!;
}

/**
 * Three pieces for the tray. At least one always fits the current board, and now and then one of them
 * completes a line somewhere: the tray deals fair, the player still has to find the spot.
 */
export function deal(b: Cells, rng: Rng, d: number, assist = 0.42 - d * 0.22): Shape[] {
  const tray = [pick(rng, d), pick(rng, d), pick(rng, d)];
  if (rng.chance(assist)) {
    const helpful = rng.shuffle(SHAPES.slice()).find((s) => {
      for (let r = 0; r <= N - s.rows; r++)
        for (let c = 0; c <= N - s.cols; c++) if (fits(b, s, r, c)) {
          const l = linesIf(b, s, r, c);
          if (l.rows.length + l.cols.length) return true;
        }
      return false;
    });
    if (helpful) tray[rng.int(0, 2)] = helpful;
  }
  if (!tray.some((s) => canFit(b, s))) {
    const small = SHAPES.filter((s) => s.tier === 0 && canFit(b, s));
    if (small.length) tray[rng.int(0, 2)] = pick(rng, 0, small);
  }
  return tray;
}

// ---------------------------------------------------------------------------
// The demo player (attract mode) and the playtest bot
// ---------------------------------------------------------------------------

export interface Move {
  slot: number;
  r: number;
  c: number;
  value: number;
}

/** How good a board is to keep playing on: open space, few single-cell holes, smooth edges. */
function evaluate(b: Cells): number {
  let v = 0;
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const k = r * N + c;
      if (b[k]) continue;
      v += 1;
      let open = 0;
      if (r > 0 && !b[k - N]) open++;
      if (r < N - 1 && !b[k + N]) open++;
      if (c > 0 && !b[k - 1]) open++;
      if (c < N - 1 && !b[k + 1]) open++;
      if (open === 0) v -= 7;
      else if (open === 1) v -= 1.5;
    }
  // Edges between filled and empty cells: fewer is smoother.
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N - 1; c++) {
      if (!b[r * N + c] !== !b[r * N + c + 1]) v -= 0.6;
      if (!b[c * N + r] !== !b[(c + 1) * N + r]) v -= 0.6;
    }
  return v;
}

/** The best single placement for the pieces still in the tray (null entries are used up). */
export function bestMove(b: Cells, tray: ReadonlyArray<Shape | null>, noise = 0, rng?: Rng): Move | null {
  let best: Move | null = null;
  const copy = new Uint8Array(N * N);
  tray.forEach((s, slot) => {
    if (!s) return;
    for (let r = 0; r <= N - s.rows; r++)
      for (let c = 0; c <= N - s.cols; c++) {
        if (!fits(b, s, r, c)) continue;
        copy.set(b);
        place(copy, s, r, c, 1);
        const lines = fullLines(copy);
        const n = lines.rows.length + lines.cols.length;
        cut(copy, lines);
        let value = evaluate(copy) + n * n * 14 + s.cells.length * 0.8;
        // Keep room for the other pieces in the tray.
        for (const other of tray) if (other && other !== s && !canFit(copy, other)) value -= 40;
        if (noise && rng) value += (rng() - 0.5) * noise;
        if (!best || value > best.value) best = { slot, r, c, value };
      }
  });
  return best;
}
