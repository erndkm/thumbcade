import { adjacent, shuffledDeck } from "./cards.ts";

/**
 * A hand: `cols` columns of `depth` face-up cards (index 0 is the back of the column, the last one is exposed and
 * playable), a stock dealt from the top, and one card on the pile to start. The top card of the stock is shown face
 * up ("next"), so a player can plan one draw ahead.
 */
export interface Shape {
  cols: number;
  depth: number;
  stock: number;
}

export interface Deal {
  shape: Shape;
  /** cols[c][0] sits at the back; cols[c][depth - 1] is the exposed card. */
  cols: number[][];
  /** stock[0] is drawn first. */
  stock: number[];
  /** The card face up on the pile before the first move. */
  pile: number;
}

/** A position in a hand. `heights[c]` cards are left in column c; `drawn` stock cards have been turned. */
export interface Pos {
  heights: number[];
  drawn: number;
  pile: number;
}

/** A move: a column index to play its exposed card, or DRAW. */
export const DRAW = -1;
export type Move = number;

/** How many stock cards the player can see (the next one is face up). */
export const PEEK = 1;

export function deal(shape: Shape, rand: () => number): Deal {
  const deck = shuffledDeck(rand);
  const cols: number[][] = [];
  let k = 0;
  for (let c = 0; c < shape.cols; c++) cols.push(deck.slice(k, (k += shape.depth)));
  const pile = deck[k++]!;
  const stock = deck.slice(k, k + shape.stock);
  return { shape, cols, stock, pile };
}

export const startPos = (d: Deal): Pos => ({ heights: d.cols.map((c) => c.length), drawn: 0, pile: d.pile });

export const exposed = (d: Deal, p: Pos, c: number): number | null => (p.heights[c]! > 0 ? d.cols[c]![p.heights[c]! - 1]! : null);

/** Columns whose exposed card goes on the pile. */
export function plays(d: Deal, p: Pos): number[] {
  const out: number[] = [];
  for (let c = 0; c < p.heights.length; c++) {
    const e = exposed(d, p, c);
    if (e !== null && adjacent(e, p.pile)) out.push(c);
  }
  return out;
}

export const left = (p: Pos): number => p.heights.reduce((a, b) => a + b, 0);
export const cleared = (p: Pos): boolean => left(p) === 0;
export const canDraw = (d: Deal, p: Pos): boolean => p.drawn < d.stock.length;
export const stockLeft = (d: Deal, p: Pos): number => d.stock.length - p.drawn;
/** The face-up next stock card, or null when the stock is empty. */
export const nextCard = (d: Deal, p: Pos): number | null => (canDraw(d, p) ? d.stock[p.drawn]! : null);
export const stuck = (d: Deal, p: Pos): boolean => !cleared(p) && !canDraw(d, p) && plays(d, p).length === 0;

/** Applies a move to a copy of the position. */
export function apply(d: Deal, p: Pos, m: Move): Pos {
  if (m === DRAW) return { heights: p.heights, drawn: p.drawn + 1, pile: d.stock[p.drawn]! };
  const heights = p.heights.slice();
  const card = d.cols[m]![heights[m]! - 1]!;
  heights[m]!--;
  return { heights, drawn: p.drawn, pile: card };
}

function key(d: Deal, p: Pos): number {
  let h = 0;
  for (let c = p.heights.length - 1; c >= 0; c--) h = h * (d.shape.depth + 1) + p.heights[c]!;
  return (h * (d.stock.length + 1) + p.drawn) * 52 + p.pile;
}

// ---------------------------------------------------------------------------
// Solver: 0-1 breadth-first search (plays cost nothing, a draw costs one) over every position of the hand, with
// the whole stock known. The position graph is acyclic and small, so the answer is exact: a hand that passes can
// be cleared, and `draws` is the fewest stock cards that clearing it takes.
// ---------------------------------------------------------------------------

export interface Solution {
  draws: number;
  moves: Move[];
}

export function solve(d: Deal, from: Pos = startPos(d)): Solution | null {
  const seen = new Map<number, { cost: number; prev: number; move: Move; pos: Pos }>();
  const k0 = key(d, from);
  seen.set(k0, { cost: 0, prev: -1, move: 0, pos: from });
  const front: number[] = [k0];
  const back: number[] = [];
  let bi = 0;
  const done = new Set<number>();
  while (front.length || bi < back.length) {
    const k = front.length ? front.pop()! : back[bi++]!;
    if (done.has(k)) continue;
    done.add(k);
    const node = seen.get(k)!;
    const p = node.pos;
    if (cleared(p)) {
      const moves: Move[] = [];
      for (let at = k; at !== k0; ) {
        const n = seen.get(at)!;
        moves.push(n.move);
        at = n.prev;
      }
      return { draws: node.cost, moves: moves.reverse() };
    }
    for (const c of plays(d, p)) {
      const q = apply(d, p, c);
      const kq = key(d, q);
      const old = seen.get(kq);
      if (!old || old.cost > node.cost) {
        seen.set(kq, { cost: node.cost, prev: k, move: c, pos: q });
        front.push(kq);
      }
    }
    if (canDraw(d, p)) {
      const q = apply(d, p, DRAW);
      const kq = key(d, q);
      const old = seen.get(kq);
      if (!old || old.cost > node.cost + 1) {
        seen.set(kq, { cost: node.cost + 1, prev: k, move: DRAW, pos: q });
        back.push(kq);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Policies: how people play. None of them knows more of the stock than the face-up next card.
// ---------------------------------------------------------------------------

/**
 * The planner: the best line it can see (play freely, draw only into the face-up part of the stock), scored by
 * cards cleared. Ties prefer uncovering the tallest column. This is the skilled player the deals are built for.
 */
export function plan(d: Deal, p: Pos, peek = PEEK): Move | null {
  const horizon = p.drawn + peek;
  const memo = new Map<number, number>();
  const value = (q: Pos): number => {
    const k = key(d, q);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let best = 0;
    for (const c of plays(d, q)) best = Math.max(best, 1 + value(apply(d, q, c)));
    if (q.drawn < horizon && canDraw(d, q)) best = Math.max(best, value(apply(d, q, DRAW)) - 0.01);
    memo.set(k, best);
    return best;
  };
  let move: Move | null = null;
  let top = -Infinity;
  for (const c of plays(d, p)) {
    const v = 1 + value(apply(d, p, c)) + p.heights[c]! * 0.001;
    if (v > top) {
      top = v;
      move = c;
    }
  }
  if (canDraw(d, p)) {
    const v = value(apply(d, p, DRAW)) - 0.01;
    if (move === null || v > top) move = DRAW;
  }
  return move;
}

/** Longest run of plays available without drawing. */
export function chainLength(d: Deal, p: Pos): number {
  const memo = new Map<number, number>();
  const walk = (q: Pos): number => {
    const k = key(d, q);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    let best = 0;
    for (const c of plays(d, q)) best = Math.max(best, 1 + walk(apply(d, q, c)));
    memo.set(k, best);
    return best;
  };
  return walk(p);
}

export type Policy = "random" | "greedy" | "planner";

/**
 * "random" plays any playable card and draws only when stuck; "greedy" plays the card that leaves the longest chain
 * of plays (it never draws on purpose); "planner" is `plan` above.
 */
export function choose(d: Deal, p: Pos, policy: Policy, rand: () => number): Move | null {
  if (policy === "planner") return plan(d, p);
  const opts = plays(d, p);
  if (!opts.length) return canDraw(d, p) ? DRAW : null;
  if (policy === "random" || opts.length === 1) return opts[Math.floor(rand() * opts.length)]!;
  let best: Move = opts[0]!;
  let top = -Infinity;
  for (const c of opts) {
    const v = chainLength(d, apply(d, p, c)) * 10 + p.heights[c]! + rand() * 0.5;
    if (v > top) {
      top = v;
      best = c;
    }
  }
  return best;
}

/** Plays a hand to the end with a policy. */
export function playout(d: Deal, policy: Policy, rand: () => number): { clear: boolean; moves: Move[] } {
  let p = startPos(d);
  const moves: Move[] = [];
  for (let guard = 0; guard < 200; guard++) {
    if (cleared(p)) return { clear: true, moves };
    const m = choose(d, p, policy, rand);
    if (m === null) return { clear: false, moves };
    moves.push(m);
    p = apply(d, p, m);
  }
  return { clear: false, moves };
}

// ---------------------------------------------------------------------------
// Dealing: every hand is checked before it is dealt. It must be clearable (solver), clearable by the planner (so
// skill is enough), and inside a luck band for its place in the run: the first hand is easy even for random taps,
// later ones need a plan.
// ---------------------------------------------------------------------------

export interface HandSpec {
  shape: Shape;
  /** Share of random-policy playouts that may clear it. */
  luck: [number, number];
}

export function handSpec(index: number): HandSpec {
  if (index === 0) return { shape: { cols: 5, depth: 2, stock: 15 }, luck: [0.85, 1] };
  if (index === 1) return { shape: { cols: 5, depth: 3, stock: 15 }, luck: [0.3, 0.85] };
  if (index === 2) return { shape: { cols: 5, depth: 3, stock: 14 }, luck: [0.2, 0.75] };
  if (index === 3) return { shape: { cols: 5, depth: 4, stock: 16 }, luck: [0.1, 0.6] };
  return { shape: { cols: 5, depth: 4, stock: Math.max(13, 15 - Math.floor((index - 4) / 2)) }, luck: [0.02, 0.5] };
}

export interface Checked {
  deal: Deal;
  solution: Solution;
  luck: number;
}

const SAMPLES = 20;

/** One candidate hand for slot `index`: returned when it passes every check, else null. */
export function candidate(index: number, rand: () => number): Checked | null {
  const spec = handSpec(index);
  const d = deal(spec.shape, rand);
  const solution = solve(d);
  if (!solution) return null;
  if (!playout(d, "planner", rand).clear) return null;
  let wins = 0;
  for (let i = 0; i < SAMPLES; i++) if (playout(d, "random", rand).clear) wins++;
  const luck = wins / SAMPLES;
  if (luck < spec.luck[0] || luck > spec.luck[1]) return null;
  return { deal: d, solution, luck };
}

/** After this many rejected candidates a hand only has to be clearable (never seen in testing). */
const TRIES = 300;

/**
 * Deals the hands of one run in order from one seed. `step()` tries a single candidate, so the game can spread the
 * search over frames (a candidate costs 1-2 ms) and still get exactly the hands `get()` would compute at once.
 */
export class Dealer {
  private readonly hands: Checked[] = [];
  private tries = 0;
  constructor(private rand: () => number) {}

  /** How many hands are ready. */
  get ready(): number {
    return this.hands.length;
  }

  /** One candidate for the next missing hand. Returns true when that hand is done. */
  step(): boolean {
    const index = this.hands.length;
    const c = candidate(index, this.rand);
    this.tries++;
    if (c) {
      this.hands.push(c);
      this.tries = 0;
      return true;
    }
    if (this.tries >= TRIES) {
      for (;;) {
        const d = deal(handSpec(index).shape, this.rand);
        const s = solve(d);
        if (s) {
          this.hands.push({ deal: d, solution: s, luck: 0 });
          this.tries = 0;
          return true;
        }
      }
    }
    return false;
  }

  /** Works on hands up to `index` for at most `ms` milliseconds. */
  pump(index: number, ms: number): void {
    const t0 = performance.now();
    while (this.hands.length <= index && performance.now() - t0 < ms) this.step();
  }

  /** Hand `index`, computing whatever is still missing. */
  get(index: number): Checked {
    while (this.hands.length <= index) this.step();
    return this.hands[index]!;
  }
}

/** Hand `index` of a run seeded with `rand` (a fresh dealer each call: for tests and tools). */
export function dealHand(index: number, rand: () => number): Checked {
  return new Dealer(rand).get(index);
}
