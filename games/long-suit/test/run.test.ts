import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { canHome, card, cardsHome, hidden, type Step, type Table } from "../src/cards.ts";
import { specOf } from "../src/deal.ts";
import type { Target } from "../src/natural.ts";
import { multOf, Run, TUNE, type ClearEvent, type RunListener } from "../src/run.ts";

const DT = 1 / 60;
const advance = (run: Run, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    run.think(Infinity);
    run.step(DT);
  }
};
/** A run past the laying of its first deal. */
const fresh = (seed = 7, listener: RunListener = {}) => {
  const run = new Run(seed, listener).start();
  advance(run, TUNE.lay + 0.02);
  return run;
};
/** Plays the deal on the table along its witness, a tap every `gap` seconds. */
const playDeal = (run: Run, gap = 0) => {
  for (const tap of run.dealt().witness) {
    if (run.phase !== "play") break;
    run.tap(tap);
    if (gap) advance(run, gap);
  }
};
const S = 0;
const H = 1;

describe("a tap", () => {
  it("waits for the deal to be laid, then plays; the clock only starts then", () => {
    const run = new Run(7).start();
    expect(run.phase).toBe("lay");
    expect(run.tap({ kind: "stock" })).toEqual([]);
    advance(run, TUNE.lay - 0.05);
    expect(run.clock).toBe(TUNE.clock);
    advance(run, 0.1);
    expect(run.phase).toBe("play");
    expect(run.tap({ kind: "stock" }).map((s) => s.kind)).toContain("draw");
    advance(run, 1);
    expect(run.clock).toBeLessThan(TUNE.clock);
    expect(run.stats).toMatchObject({ taps: 1, draws: 1 });
  });

  it("that fits nowhere costs nothing but is counted, and the listener hears of it", () => {
    const duds: Target[] = [];
    const run = fresh(7, { dud: (t) => duds.push(t) });
    run.table.cols[0] = { down: [], up: [card(S, 8)] };
    run.table.cols[1] = { down: [], up: [card(S, 7)] };
    const clock = run.clock;
    const score = run.score;
    expect(run.tap({ kind: "col", col: 1, index: 0 })).toEqual([]);
    expect(run.stats.duds).toBe(1);
    expect(duds).toHaveLength(1);
    expect([run.clock, run.score]).toEqual([clock, score]);
  });

  it("a card home pays ten times the multiplier and buys time; a card turned up pays five and buys a little", () => {
    const steps: Step[][] = [];
    const run = fresh(7, { steps: (s) => steps.push(s) });
    run.table.cols = [
      { down: [card(H, 7)], up: [card(S, 0)] },
      { down: [], up: [card(S, 9)] },
    ];
    run.table.home = [0, 0, 0, 0];
    run.table.stock = [];
    run.table.waste = [];
    const clock = run.clock;
    run.tap({ kind: "col", col: 0, index: 0 });
    expect(run.score).toBe(TUNE.home + TUNE.flip);
    expect(run.clock).toBeCloseTo(clock + TUNE.homeTime + TUNE.flipTime, 5);
    expect(run.stats).toMatchObject({ home: 1, flips: 1, bestChain: 1 });
    expect(steps[0]!.map((s) => s.kind)).toEqual(["home", "flip"]);
  });

  it("cards home back to back build the multiplier at 4, 9, 15 and 24, and a pause breaks the chain", () => {
    expect([0, 3, 4, 8, 9, 14, 15, 23, 24, 60].map(multOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    const tiers: number[] = [];
    const run = fresh(7, { tier: (m) => tiers.push(m) });
    // A column of spades in order, ace on top: tap after tap sends them home.
    run.table.ranks = 13;
    run.table.home = [0, 0, 0, 0];
    run.table.cols = [
      { down: [], up: [6, 5, 4, 3, 2, 1, 0].map((r) => card(S, r)) },
      // (A card face down somewhere keeps the deal from sweeping itself home.)
      { down: [card(H, 3)], up: [card(H, 9)] },
    ];
    run.table.stock = [];
    run.table.waste = [];
    let paid = 0;
    for (let i = 0; i < 5; i++) {
      const before = run.score;
      run.tap({ kind: "col", col: 0, index: 99 });
      paid = run.score - before;
      advance(run, 0.2);
    }
    // Five taps, six cards: the two followed the ace home of its own accord.
    expect(run.chain).toBe(6);
    expect(run.mult).toBe(2);
    expect(paid).toBe(TUNE.home * 2);
    expect(tiers).toEqual([2]);
    expect(run.toNextTier).toBe(TUNE.tiers[1]! - 6);
    expect(run.chainLeft).toBeGreaterThan(0);
    advance(run, TUNE.chainGap + 0.1);
    expect(run.chain).toBe(0);
    expect(run.mult).toBe(1);
    expect(run.stats.bestChain).toBe(6);
    expect(run.stats.bestMult).toBe(2);
  });
});

describe("a deal", () => {
  it("played along its witness is cleared: the last cards sweep home with the clock held, then the next deal is laid", () => {
    const cleared: ClearEvent[] = [];
    const dealt: number[] = [];
    const run = fresh(21, { cleared: (e) => cleared.push(e), dealt: (_t, level) => dealt.push(level) });
    playDeal(run);
    expect(hidden(run.table)).toBe(0);
    expect(["sweep", "cheer"]).toContain(run.phase);
    const clock = run.clock;
    for (let i = 0; i < 400 && run.phase === "sweep"; i++) run.step(DT);
    expect(run.phase).toBe("cheer");
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ level: 0, refund: TUNE.clearTime(0) });
    expect(cleared[0]!.points).toBe(TUNE.clear + Math.round(clock) * TUNE.perSecond);
    expect(run.clock).toBeCloseTo(Math.min(TUNE.max, clock + TUNE.clearTime(0)), 5);
    expect(run.stats.home).toBe(20);
    advance(run, TUNE.cheer + 0.05);
    expect(run.level).toBe(1);
    expect(run.phase).toBe("lay");
    expect(dealt).toEqual([0, 1]);
    expect(run.table.ranks).toBe(specOf(1).ranks);
    expect(cardsHome(run.table)).toBe(0);
  });

  it("the sweep's cards score with the chain but buy no time", () => {
    const run = fresh(5);
    playDeal(run);
    const clock = run.clock;
    const home = run.stats.home;
    expect(run.phase).toBe("sweep");
    run.step(TUNE.sweepStep + 0.001);
    expect(run.stats.home).toBeGreaterThan(home);
    expect(run.clock).toBe(clock);
  });

  it("a later deal gives less time back, and the clock never holds more than its cap", () => {
    expect(TUNE.clearTime(0)).toBeGreaterThan(TUNE.clearTime(4));
    expect(TUNE.clearTime(40)).toBeGreaterThanOrEqual(3);
    expect(TUNE.burn(60)).toBeGreaterThan(TUNE.burn(10));
    const run = fresh(4);
    for (let i = 0; i < 4; i++) {
      playDeal(run);
      for (let k = 0; k < 2000 && run.phase !== "play"; k++) run.step(DT);
      expect(run.clock).toBeLessThanOrEqual(TUNE.max);
    }
    expect(run.level).toBe(4);
    expect(run.table.cols).toHaveLength(7);
  });
});

describe("a dead end", () => {
  /** A table nothing can be played on: each column's top card needs the other's. */
  const stuck = (t: Table) => {
    t.ranks = 2;
    t.home = [0, 0, 2, 2];
    t.cols = [
      { down: [card(H, 0)], up: [card(S, 1)] },
      { down: [card(S, 0)], up: [card(H, 1)] },
    ];
    t.stock = [];
    t.waste = [];
  };

  it("is noticed when a tap fits nowhere and the pack is gone: the deal is dealt afresh, same size, clock held", () => {
    let dead = 0;
    const fresh2: boolean[] = [];
    const run = fresh(9, { dead: () => dead++, dealt: (_t, _l, f) => fresh2.push(f) });
    stuck(run.table);
    expect(run.tap({ kind: "col", col: 0, index: 0 })).toEqual([]);
    run.think(Infinity);
    expect(dead).toBe(1);
    expect(run.phase).toBe("afresh");
    const clock = run.clock;
    advance(run, TUNE.afresh + 0.05);
    expect(run.clock).toBe(clock);
    expect([run.level, run.redeal]).toEqual([0, 1]);
    expect(run.phase).toBe("lay");
    expect(fresh2).toEqual([false, true]);
    expect(run.stats.afresh).toBe(1);
    expect(cardsHome(run.table)).toBe(0);
    expect(run.table.ranks).toBe(5);
  });

  it("is noticed after a whole pass through the pack with nothing played, when nothing can win any more", () => {
    let dead = 0;
    const run = fresh(9, { dead: () => dead++ });
    stuck(run.table);
    // Two dead cards in the pack as well: the threes of a pack that only goes to two cannot go anywhere.
    run.table.ranks = 2;
    run.table.stock = [card(S, 5), card(H, 5)];
    for (let i = 0; i < 12 && run.phase === "play"; i++) {
      run.tap({ kind: "stock" });
      run.think(Infinity);
    }
    expect(dead).toBe(1);
    expect(run.phase).toBe("afresh");
  });

  it("a table that can still be won is left alone, and the way on becomes the hint", () => {
    let dead = 0;
    const run = fresh(31, { dead: () => dead++ });
    for (let i = 0; i < 40 && run.phase === "play"; i++) {
      run.tap({ kind: "stock" });
      run.think(Infinity);
    }
    expect(dead).toBe(0);
    expect(run.phase).toBe("play");
    run.wantHint();
    run.think(Infinity);
    expect(run.hint).not.toBeNull();
    // A hint is a tap that does something.
    expect(run.tap(run.hint!).length).toBeGreaterThan(0);
    expect(run.hint).toBeNull();
  });
});

describe("the run", () => {
  it("an untouched run ends on its own when the clock runs out, on every seed inside 35 seconds", () => {
    let worst = 0;
    let least = 99;
    for (let seed = 1; seed <= 200; seed++) {
      let over = 0;
      const run = new Run(seed * 977, { over: () => over++ }).start();
      for (let t = 0; t < 60 && !run.over; t += DT) run.step(DT);
      expect(run.over).toBe(true);
      expect(over).toBe(1);
      expect(run.score).toBe(0);
      worst = Math.max(worst, run.time);
      least = Math.min(least, run.time);
    }
    expect(worst).toBeLessThan(35);
    expect(worst).toBeLessThan(26);
    expect(least).toBeGreaterThan(10);
    const run = new Run(5).start();
    advance(run, 40);
    const t = run.time;
    advance(run, 1);
    expect(run.time).toBe(t);
    expect(run.tap({ kind: "stock" })).toEqual([]);
  });

  it("random tapping ends inside the reviewer's script, and never in the first ten seconds", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(seed);
      const run = new Run(seed * 31).start();
      let t = 0;
      while (!run.over && run.time < 200) {
        t += DT;
        if (t >= 0.25) {
          t = 0;
          const r = rng();
          run.tap(r < 0.25 ? { kind: "stock" } : r < 0.35 ? { kind: "waste" } : { kind: "col", col: rng.int(0, run.table.cols.length - 1), index: rng.int(0, 3) });
        }
        run.think(Infinity);
        run.step(DT);
      }
      expect(run.time).toBeLessThan(70);
      expect(run.time).toBeGreaterThan(10);
    }
  });

  it("the same seed and the same taps make the same run; the deals depend only on the seed, the level and the redeal", () => {
    const play = (seed: number, gap: number) => {
      const run = new Run(seed).start();
      const deals: string[] = [];
      let level = -1;
      for (let guard = 0; guard < 200000 && !run.over && run.level < 3; guard++) {
        if (run.level !== level) {
          level = run.level;
          deals.push(JSON.stringify(run.dealt().table));
        }
        if (run.phase === "play") {
          const w = run.dealt().witness;
          for (const tap of w) {
            if (run.phase !== "play") break;
            run.tap(tap);
            if (gap) advance(run, gap);
          }
        }
        run.step(DT);
      }
      return { deals, score: run.score, home: run.stats.home };
    };
    const a = play(4242, 0);
    expect(play(4242, 0)).toEqual(a);
    expect(a.deals).toHaveLength(3);
    // A slower player meets the very same deals.
    const slow = play(4242, 0.15);
    expect(slow.deals).toEqual(a.deals.slice(0, slow.deals.length));
    expect(play(4243, 0).deals).not.toEqual(a.deals);
    expect(canHome({ ranks: 5, cols: [], home: [0, 0, 0, 0], stock: [], waste: [] }, card(S, 0))).toBe(true);
  });
});
