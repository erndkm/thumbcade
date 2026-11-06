/** The knight's tour: squares 0-63, col = i % 8, row = i / 8 (row 0 is the top rank). */

export const N = 8;
const JUMPS: Array<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

/** Precomputed knight neighbours of every square. */
export const NEIGHBOURS: number[][] = Array.from({ length: N * N }, (_, i) => {
  const c = i % N;
  const r = Math.floor(i / N);
  const out: number[] = [];
  for (const [dc, dr] of JUMPS) {
    const cc = c + dc;
    const rr = r + dr;
    if (cc >= 0 && cc < N && rr >= 0 && rr < N) out.push(rr * N + cc);
  }
  return out;
});

export class Tour {
  readonly path: number[] = [];
  /** 0 = unvisited, else the 1-based move number. */
  readonly order = new Int8Array(N * N);

  constructor(start: number) {
    this.visit(start);
  }

  get head(): number {
    return this.path[this.path.length - 1]!;
  }

  get length(): number {
    return this.path.length;
  }

  visit(sq: number): void {
    this.path.push(sq);
    this.order[sq] = this.path.length;
  }

  legal(from = this.head): number[] {
    return NEIGHBOURS[from]!.filter((n) => this.order[n] === 0);
  }

  /** Onward options from `sq` if the knight stood there now. */
  degree(sq: number): number {
    let d = 0;
    for (const n of NEIGHBOURS[sq]!) if (this.order[n] === 0 && n !== sq) d++;
    return d;
  }

  /** Warnsdorff's rule: the legal move with the fewest onward options (ties: furthest from the centre). */
  warnsdorff(rand: () => number = Math.random): number | null {
    let best: number | null = null;
    let bestKey = Infinity;
    for (const m of this.legal()) {
      const c = m % N - 3.5;
      const r = Math.floor(m / N) - 3.5;
      const key = this.degree(m) * 1000 - (c * c + r * r) * 10 + rand();
      if (key < bestKey) {
        bestKey = key;
        best = m;
      }
    }
    return best;
  }
}

/** A complete tour from `start` by Warnsdorff's rule with seeded tie-breaks, retried until it closes all 64. */
export function fullTour(start: number, rand: () => number): number[] {
  let fallback: number[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const t = new Tour(start);
    for (;;) {
      const m = t.warnsdorff(rand);
      if (m === null) break;
      t.visit(m);
    }
    if (t.length === N * N) return t.path;
    if (t.length > fallback.length) fallback = t.path;
  }
  return fallback;
}
