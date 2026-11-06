import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { adjacent, rankOf, shuffledDeck, step } from "../src/cards.ts";
import { apply, candidate, cleared, Dealer, DRAW, handSpec, plan, playout, plays, solve, startPos, type Deal, type Move } from "../src/deal.ts";

/** A deal from explicit ranks (suits don't matter to the rules). */
function make(cols: number[][], pile: number, stock: number[]): Deal {
  return { shape: { cols: cols.length, depth: cols[0]!.length, stock: stock.length }, cols, pile, stock };
}

function replay(d: Deal, moves: Move[]): boolean {
  let p = startPos(d);
  for (const m of moves) {
    if (m !== DRAW && !plays(d, p).includes(m)) return false;
    if (m === DRAW && p.drawn >= d.stock.length) return false;
    p = apply(d, p, m);
  }
  return cleared(p);
}

/** Exhaustive search for the fewest draws, to check the solver against. */
function bruteDraws(d: Deal): number | null {
  let best: number | null = null;
  const go = (p: ReturnType<typeof startPos>, draws: number) => {
    if (best !== null && draws >= best) return;
    if (cleared(p)) {
      best = draws;
      return;
    }
    for (const c of plays(d, p)) go(apply(d, p, c), draws);
    if (p.drawn < d.stock.length) go(apply(d, p, DRAW), draws + 1);
  };
  go(startPos(d), 0);
  return best;
}

describe("cards", () => {
  it("one up or one down, wrapping king and ace", () => {
    expect(adjacent(4, 5)).toBe(true);
    expect(adjacent(5, 4)).toBe(true);
    expect(adjacent(4, 6)).toBe(false);
    expect(adjacent(0, 12)).toBe(true); // ace on king
    expect(adjacent(12, 0)).toBe(true);
    expect(adjacent(13 + 3, 4)).toBe(true); // suits don't matter
    expect(adjacent(3, 3 + 13)).toBe(false); // same rank never goes
    expect(step(12, 0)).toBe(1);
    expect(step(0, 12)).toBe(-1);
    expect(step(2, 7)).toBe(0);
  });

  it("shuffles a full deck", () => {
    const d = shuffledDeck(createRng(3));
    expect(new Set(d).size).toBe(52);
    expect([...d].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe("solver", () => {
  it("finds a clearing line that replays legally", () => {
    // Ranks (0 = ace): pile 3; columns [2 under 4] and [5 under 3]. 4, 3, 2 chain down, then the 5 needs the
    // stock's 4: a hand that needs a draw at the right moment.
    const d = make([[2, 4], [5, 3]], 3, [4]);
    const s = solve(d);
    expect(s).not.toBeNull();
    expect(s!.draws).toBe(1);
    expect(replay(d, s!.moves)).toBe(true);
  });

  it("reports a hand that can't be cleared", () => {
    // Every card is a 7 or a 9 and the pile is a 2: nothing ever goes, and the stock can't help.
    const d = make([[6, 8], [8, 6]], 1, [3]);
    expect(solve(d)).toBeNull();
  });

  it("returns the fewest draws, matching an exhaustive search", () => {
    const rand = createRng(11);
    for (let i = 0; i < 40; i++) {
      const deck = shuffledDeck(rand);
      const d = make([deck.slice(0, 2), deck.slice(2, 4), deck.slice(4, 6)], deck[6]!, deck.slice(7, 13));
      const s = solve(d);
      const b = bruteDraws(d);
      expect(s?.draws ?? null).toBe(b);
      if (s) {
        expect(replay(d, s.moves)).toBe(true);
        expect(s.moves.filter((m) => m === DRAW).length).toBe(s.draws);
      }
    }
  });

  it("the planner only ever makes legal moves", () => {
    const rand = createRng(5);
    for (let i = 0; i < 30; i++) {
      const d = candidate(2, rand)?.deal;
      if (!d) continue;
      let p = startPos(d);
      for (let g = 0; g < 100 && !cleared(p); g++) {
        const m = plan(d, p);
        if (m === null) break;
        if (m === DRAW) expect(p.drawn).toBeLessThan(d.stock.length);
        else expect(rankOf(d.cols[m]![p.heights[m]! - 1]!) >= 0 && plays(d, p).includes(m)).toBe(true);
        p = apply(d, p, m);
      }
    }
  });
});

describe("dealing", () => {
  it("every dealt hand is clearable, clearable by the planner, and inside its luck band", () => {
    for (const seed of [1, 2, 3, 4]) {
      const dealer = new Dealer(createRng(seed));
      for (let h = 0; h < 7; h++) {
        const c = dealer.get(h);
        const spec = handSpec(h);
        expect(c.deal.shape).toEqual(spec.shape);
        expect(solve(c.deal)).not.toBeNull();
        expect(playout(c.deal, "planner", createRng(9)).clear).toBe(true);
        expect(c.luck).toBeGreaterThanOrEqual(spec.luck[0]);
        expect(c.luck).toBeLessThanOrEqual(spec.luck[1]);
        // A hand uses distinct cards from one deck.
        const cards = [...c.deal.cols.flat(), c.deal.pile, ...c.deal.stock];
        expect(new Set(cards).size).toBe(cards.length);
      }
    }
  });

  it("the first hand is easy even for random taps", () => {
    for (const seed of [10, 11, 12, 13, 14]) expect(new Dealer(createRng(seed)).get(0).luck).toBeGreaterThanOrEqual(0.85);
  });

  it("spreading the search over frames deals exactly the same hands", () => {
    const a = new Dealer(createRng(77));
    const b = new Dealer(createRng(77));
    for (let i = 0; i < 400 && b.ready < 4; i++) b.step();
    for (let h = 0; h < 4; h++) expect(b.get(h).deal).toEqual(a.get(h).deal);
  });

  it("different seeds deal different hands", () => {
    expect(new Dealer(createRng(1)).get(0).deal).not.toEqual(new Dealer(createRng(2)).get(0).deal);
  });
});
