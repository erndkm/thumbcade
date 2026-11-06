/**
 * One-line puzzles: a grid with some cells left out and a marked start. Every puzzle is built from a
 * Hamiltonian path that we actually found, so every puzzle has at least one solution.
 */

export interface Puzzle {
  cols: number;
  rows: number;
  /** 1 = a dot, 0 = no dot. Index = row * cols + col. */
  cells: Uint8Array;
  start: number;
  /** One solution (the pen's route in attract mode). */
  solution: number[];
  dots: number;
}

export const SIZES: Array<[cols: number, rows: number, holesMin: number, holesMax: number]> = [
  [4, 4, 1, 2],
  [4, 5, 2, 2],
  [5, 5, 2, 3],
  [5, 6, 2, 4],
  [6, 6, 3, 4],
  [6, 7, 3, 5],
  [6, 8, 4, 6],
];

export function neighbours(p: Pick<Puzzle, "cols" | "rows">, i: number): number[] {
  const c = i % p.cols;
  const r = Math.floor(i / p.cols);
  const out: number[] = [];
  if (r > 0) out.push(i - p.cols);
  if (c < p.cols - 1) out.push(i + 1);
  if (r < p.rows - 1) out.push(i + p.cols);
  if (c > 0) out.push(i - 1);
  return out;
}

export const adjacent = (p: Pick<Puzzle, "cols">, a: number, b: number): boolean => {
  const d = Math.abs(a - b);
  return (d === 1 && Math.floor(a / p.cols) === Math.floor(b / p.cols)) || d === p.cols;
};

/**
 * Depth-first search for a Hamiltonian path over the open cells from `start`, trying the neighbour with
 * the fewest onward options first (Warnsdorff), pruning dead cells, with a deadline.
 */
function hamiltonian(cols: number, rows: number, open: Uint8Array, start: number, total: number, rand: () => number, deadline: number): number[] | null {
  const grid = { cols, rows };
  const nb = Array.from({ length: cols * rows }, (_, i) => neighbours(grid, i).filter((n) => open[n]));
  const used = new Uint8Array(cols * rows);
  const path = [start];
  used[start] = 1;
  const options: number[][] = [];
  let nodes = 0;

  const onward = (n: number) => {
    let d = 0;
    for (const m of nb[n]!) if (!used[m]) d++;
    return d;
  };
  // A path can only end once: two open cells with a single way in means a dead end.
  const viable = (head: number) => {
    let ends = 0;
    for (let i = 0; i < used.length; i++) {
      if (!open[i] || used[i]) continue;
      let d = 0;
      for (const m of nb[i]!) if (!used[m] || m === head) d++;
      if (d === 0) return false;
      if (d === 1 && ++ends > 1) return false;
    }
    return true;
  };
  const order = (head: number) =>
    nb[head]!
      .filter((n) => !used[n])
      .map((n) => [n, onward(n) + rand() * 0.9] as const)
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => n);

  options.push(order(start));
  while (path.length) {
    if (path.length === total) return path.slice();
    if ((++nodes & 255) === 0 && performance.now() > deadline) return null;
    const opts = options[options.length - 1]!;
    const next = opts.pop();
    if (next === undefined) {
      used[path.pop()!] = 0;
      options.pop();
      continue;
    }
    used[next] = 1;
    path.push(next);
    if (path.length < total && !viable(next)) {
      used[path.pop()!] = 0;
      continue;
    }
    options.push(order(next));
  }
  return null;
}

/** Picks holes (often mirrored, so the shapes look composed) keeping the two colours of the grid balanced. */
function pickHoles(cols: number, rows: number, count: number, rand: () => number): Uint8Array | null {
  const open = new Uint8Array(cols * rows).fill(1);
  const mirror = rand() < 0.6;
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < 200) {
    const c = Math.floor(rand() * cols);
    const r = Math.floor(rand() * rows);
    const i = r * cols + c;
    if (!open[i]) continue;
    const j = r * cols + (cols - 1 - c);
    if (mirror && j !== i && placed + 2 <= count && open[j]) {
      open[i] = 0;
      open[j] = 0;
      placed += 2;
    } else if (!mirror || placed + 1 === count || j === i) {
      open[i] = 0;
      placed += 1;
    }
  }
  let dark = 0;
  let light = 0;
  for (let i = 0; i < open.length; i++) {
    if (!open[i]) continue;
    if (((i % cols) + Math.floor(i / cols)) % 2) dark++;
    else light++;
  }
  return Math.abs(dark - light) <= 1 ? open : null;
}

function finish(cols: number, rows: number, open: Uint8Array, solution: number[]): Puzzle {
  return { cols, rows, cells: open, start: solution[0]!, solution, dots: solution.length };
}

/** A solvable puzzle of the given size, within about `budgetMs`. */
export function generate(cols: number, rows: number, holesMin: number, holesMax: number, rand: () => number, budgetMs = 30): Puzzle {
  const deadline = performance.now() + budgetMs;
  const n = cols * rows;
  for (let attempt = 0; attempt < 40 && performance.now() < deadline; attempt++) {
    const holes = holesMin + Math.floor(rand() * (holesMax - holesMin + 1));
    const open = pickHoles(cols, rows, holes, rand);
    if (!open) continue;
    const total = n - holes;
    let dark = 0;
    for (let i = 0; i < n; i++) if (open[i] && ((i % cols) + Math.floor(i / cols)) % 2) dark++;
    const light = total - dark;
    // With an odd count the path must start (and end) on the majority colour.
    const starts: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!open[i]) continue;
      const isDark = ((i % cols) + Math.floor(i / cols)) % 2 === 1;
      if (dark !== light && isDark !== dark > light) continue;
      starts.push(i);
    }
    for (let k = starts.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [starts[k], starts[j]] = [starts[j]!, starts[k]!];
    }
    for (const s of starts.slice(0, 4)) {
      const sol = hamiltonian(cols, rows, open, s, total, rand, Math.min(deadline, performance.now() + budgetMs / 4));
      if (sol) return finish(cols, rows, open, sol);
    }
  }
  // Fallback: walk a self-avoiding path for most of the grid and leave the rest out.
  const open = new Uint8Array(n).fill(1);
  const target = n - holesMin;
  const s = Math.floor(rand() * n);
  const sol = hamiltonian(cols, rows, open, s, target, rand, performance.now() + 15);
  if (sol) {
    const cells = new Uint8Array(n);
    for (const i of sol) cells[i] = 1;
    return finish(cols, rows, cells, sol);
  }
  // Last resort: a plain serpentine through a full grid.
  const snake: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) snake.push(r * cols + (r % 2 ? cols - 1 - c : c));
  return finish(cols, rows, new Uint8Array(n).fill(1), snake);
}
