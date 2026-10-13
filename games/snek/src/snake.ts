/** Grid snake rules + the attract-mode pilot. Pure logic; rendering interpolates between steps. */

export type Dir = "up" | "down" | "left" | "right";
export interface Cell {
  x: number;
  y: number;
}

export const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const DIRS: Dir[] = ["up", "right", "down", "left"];

export interface Arena {
  cols: number;
  rows: number;
}

export const key = (c: Cell) => c.y * 1000 + c.x;

export function inside(a: Arena, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < a.cols && c.y < a.rows;
}

/** Cells the snake will occupy after its next step (the tail moves away unless it is growing). */
function blocked(body: Cell[], growing: boolean, rocks: ReadonlySet<number>): Set<number> {
  const s = new Set<number>(rocks);
  const n = growing ? body.length : body.length - 1;
  for (let i = 0; i < n; i++) s.add(key(body[i]!));
  return s;
}

/** Number of free cells reachable from `start` (flood fill), capped. */
function room(a: Arena, start: Cell, block: Set<number>, cap: number): number {
  const seen = new Set<number>([key(start)]);
  const q = [start];
  while (q.length && seen.size < cap) {
    const c = q.shift()!;
    for (const d of DIRS) {
      const n = { x: c.x + DELTA[d].x, y: c.y + DELTA[d].y };
      const k = key(n);
      if (!inside(a, n) || block.has(k) || seen.has(k)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen.size;
}

/** BFS toward food; falls back to the move with the most room. */
export function pilot(a: Arena, body: Cell[], dir: Dir, food: Cell, rocks: ReadonlySet<number> = new Set()): Dir {
  const head = body[0]!;
  const block = blocked(body, false, rocks);
  const prev = new Map<number, number>();
  const firstDir = new Map<number, Dir>();
  const startK = key(head);
  const q: Cell[] = [head];
  prev.set(startK, -1);
  let found: Cell | null = null;
  while (q.length) {
    const c = q.shift()!;
    if (c.x === food.x && c.y === food.y) {
      found = c;
      break;
    }
    for (const d of DIRS) {
      if (c === head && d === OPPOSITE[dir]) continue;
      const n = { x: c.x + DELTA[d].x, y: c.y + DELTA[d].y };
      const k = key(n);
      if (!inside(a, n) || block.has(k) || prev.has(k)) continue;
      prev.set(k, key(c));
      firstDir.set(k, c === head ? d : firstDir.get(key(c))!);
      q.push(n);
    }
  }
  const cap = body.length * 2 + 20;
  if (found) {
    const d = firstDir.get(key(found));
    if (d) {
      const n = { x: head.x + DELTA[d].x, y: head.y + DELTA[d].y };
      // Don't take a path into a pocket smaller than ourselves.
      if (room(a, n, block, cap) > body.length) return d;
    }
  }
  let best = dir;
  let bestRoom = -1;
  for (const d of DIRS) {
    if (d === OPPOSITE[dir]) continue;
    const n = { x: head.x + DELTA[d].x, y: head.y + DELTA[d].y };
    if (!inside(a, n) || block.has(key(n))) continue;
    const r = room(a, n, block, cap);
    if (r > bestRoom) {
      bestRoom = r;
      best = d;
    }
  }
  return best;
}
