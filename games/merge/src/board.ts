/** 4×4 sliding-merge rules. Pure logic; the renderer animates from `fromR/fromC` to `r/c`. */

export type Dir = "up" | "down" | "left" | "right";
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];
export const N = 4;

export interface Tile {
  id: number;
  value: number;
  r: number;
  c: number;
  fromR: number;
  fromC: number;
  /** Game time the tile appeared (spawn pop). */
  born: number;
  /** Game time of its last merge (merge pop), or -1. */
  mergedAt: number;
}

export interface MoveResult {
  moved: boolean;
  /** Tiles that grew this move, after the move. */
  merges: Tile[];
  /** Tiles consumed by a merge; render them sliding into their partner, then drop them. */
  ghosts: Tile[];
  gained: number;
}

/** Cell indices of each line, ordered from the side tiles slide toward. */
function lines(dir: Dir): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < N; i++) {
    const line: number[] = [];
    for (let j = 0; j < N; j++) {
      if (dir === "left") line.push(i * N + j);
      else if (dir === "right") line.push(i * N + (N - 1 - j));
      else if (dir === "up") line.push(j * N + i);
      else line.push((N - 1 - j) * N + i);
    }
    out.push(line);
  }
  return out;
}
const LINES: Record<Dir, number[][]> = { up: lines("up"), down: lines("down"), left: lines("left"), right: lines("right") };

export class Board {
  cells: Array<Tile | null> = new Array<Tile | null>(N * N).fill(null);
  private nextId = 1;

  constructor(private rand: () => number) {}

  tiles(): Tile[] {
    return this.cells.filter((t): t is Tile => t !== null);
  }

  empty(): number[] {
    const out: number[] = [];
    this.cells.forEach((t, i) => {
      if (!t) out.push(i);
    });
    return out;
  }

  spawn(now: number, value?: number): Tile | null {
    const free = this.empty();
    if (!free.length) return null;
    const i = free[Math.floor(this.rand() * free.length)]!;
    const r = Math.floor(i / N);
    const c = i % N;
    const t: Tile = { id: this.nextId++, value: value ?? (this.rand() < 0.88 ? 2 : 4), r, c, fromR: r, fromC: c, born: now, mergedAt: -1 };
    this.cells[i] = t;
    return t;
  }

  move(dir: Dir, now: number): MoveResult {
    const next = new Array<Tile | null>(N * N).fill(null);
    const merges: Tile[] = [];
    const ghosts: Tile[] = [];
    let gained = 0;
    let moved = false;
    for (const t of this.tiles()) {
      t.fromR = t.r;
      t.fromC = t.c;
    }
    for (const line of LINES[dir]) {
      let pos = 0;
      let last: Tile | null = null;
      let lastMerged = false;
      for (const idx of line) {
        const t = this.cells[idx];
        if (!t) continue;
        if (last && !lastMerged && last.value === t.value) {
          last.value *= 2;
          last.mergedAt = now;
          gained += last.value;
          merges.push(last);
          lastMerged = true;
          t.r = last.r;
          t.c = last.c;
          ghosts.push(t);
          moved = true;
          continue;
        }
        const target = line[pos]!;
        pos++;
        if (target !== idx) moved = true;
        t.r = Math.floor(target / N);
        t.c = target % N;
        next[target] = t;
        last = t;
        lastMerged = false;
      }
    }
    this.cells = next;
    return { moved, merges, ghosts, gained };
  }

  canMove(): boolean {
    if (this.empty().length) return true;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const v = this.cells[r * N + c]!.value;
        if (c < N - 1 && this.cells[r * N + c + 1]!.value === v) return true;
        if (r < N - 1 && this.cells[(r + 1) * N + c]!.value === v) return true;
      }
    return false;
  }

  maxValue(): number {
    return this.tiles().reduce((m, t) => Math.max(m, t.value), 0);
  }

  values(): number[] {
    return this.cells.map((t) => (t ? t.value : 0));
  }

  reset(): void {
    this.cells.fill(null);
  }
}

/** Pure slide on a value grid (for the attract-mode AI). */
export function simulate(values: readonly number[], dir: Dir): { grid: number[]; gained: number; merges: number; moved: boolean } {
  const grid = new Array<number>(N * N).fill(0);
  let gained = 0;
  let merges = 0;
  let moved = false;
  for (const line of LINES[dir]) {
    let pos = 0;
    let lastIdx = -1;
    let lastMerged = false;
    for (const idx of line) {
      const v = values[idx]!;
      if (!v) continue;
      if (lastIdx >= 0 && !lastMerged && grid[lastIdx] === v) {
        grid[lastIdx] = v * 2;
        gained += v * 2;
        merges++;
        lastMerged = true;
        moved = true;
        continue;
      }
      const target = line[pos]!;
      pos++;
      if (target !== idx) moved = true;
      grid[target] = v;
      lastIdx = target;
      lastMerged = false;
    }
  }
  return { grid, gained, merges, moved };
}

/** Greedy-with-lookahead move picker: merges, empty cells, and keeping the big tile in a corner. */
export function bestMove(values: readonly number[]): Dir | null {
  let best: Dir | null = null;
  let bestScore = -Infinity;
  for (const d of DIRS) {
    const r = simulate(values, d);
    if (!r.moved) continue;
    const empties = r.grid.filter((v) => v === 0).length;
    const max = Math.max(...r.grid);
    const corner = r.grid[N * N - 1] === max || r.grid[N * (N - 1)] === max ? max * 0.6 : 0;
    // One step of lookahead: how many merges remain available afterwards.
    let follow = 0;
    for (const d2 of DIRS) follow = Math.max(follow, simulate(r.grid, d2).merges);
    const s = r.gained * 1.2 + empties * 14 + corner + follow * 6 + (d === "up" ? -8 : 0);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}
