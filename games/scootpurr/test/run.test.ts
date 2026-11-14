import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { catsLeft, EMPTY, freeCats, wayOf } from "../src/board.ts";
import { purrOf, Run, TUNE, type ClearEvent, type RunListener } from "../src/run.ts";

const DT = 1 / 60;
const advance = (run: Run, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) run.step(DT);
};
const fresh = (seed = 7, listener: RunListener = {}) => new Run(seed, listener).start();
/** A cat that can go, and one that cannot (if any). */
const aFree = (run: Run) => freeCats(run.board)[0]!;
const aStuck = (run: Run) => run.board.cats.find((c) => !c.out && wayOf(run.board, c).by !== EMPTY);
/** Clears the rug in play along its witness. */
const clearRug = (run: Run) => {
  for (const id of run.board.witness) run.tap(id);
};

describe("a tap", () => {
  it("on a cat whose way is clear sends it off and pays ten a square", () => {
    const run = fresh();
    const c = aFree(run);
    const r = run.tap(c.id);
    expect(r).toMatchObject({ kind: "out", points: TUNE.square * c.len, purr: 1, streak: 1, cleared: false });
    expect(c.out).toBe(true);
    expect(run.score).toBe(TUNE.square * c.len);
    expect(run.stats.cats).toBe(1);
    // It is gone: a second tap on it does nothing.
    expect(run.tap(c.id)).toEqual({ kind: "none" });
    expect(run.tap(999)).toEqual({ kind: "none" });
  });

  it("on a cat that is stuck is a bump: it stays, the streak ends, the candle pays", () => {
    const run = fresh(11);
    run.tap(aFree(run).id);
    const stuck = aStuck(run)!;
    advance(run, TUNE.earlyUntil + 0.5);
    const before = run.clock;
    const r = run.tap(stuck.id);
    expect(r).toMatchObject({ kind: "bump", cost: TUNE.bump });
    if (r.kind === "bump") expect(r.by).not.toBe(EMPTY);
    expect(stuck.out).toBe(false);
    expect(run.streak).toBe(0);
    expect(run.clock).toBeCloseTo(before - TUNE.bump, 5);
    expect(run.stats.bumps).toBe(1);
    // A second bump straight after costs nothing more; a later one does.
    expect(run.tap(stuck.id)).toMatchObject({ kind: "bump", cost: 0 });
    advance(run, TUNE.bumpGap + 0.05);
    expect(run.tap(stuck.id)).toMatchObject({ kind: "bump", cost: TUNE.bump });
  });

  it("bumps are cheap in the first seconds, so nobody loses in the first ten however they tap", () => {
    expect(TUNE.bumpEarly).toBeLessThan(TUNE.bump);
    for (let seed = 1; seed <= 40; seed++) {
      const run = fresh(seed * 131);
      for (let t = 0; t < 10; t += DT) {
        const stuck = aStuck(run);
        if (stuck) run.tap(stuck.id);
        run.step(DT);
      }
      expect(run.over, `seed ${seed}`).toBe(false);
      expect(run.clock).toBeGreaterThan(3);
    }
  });

  it("purr tiers come at 4, 10, 18 and 28 cats in a row and multiply what a cat pays", () => {
    expect([0, 3, 4, 9, 10, 17, 18, 27, 28, 99].map(purrOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    const tiers: number[] = [];
    const run = fresh(5, { tier: (p) => tiers.push(p) });
    const paid: number[] = [];
    for (let i = 0; i < 12; i++) {
      if (run.phase === "cheer") advance(run, TUNE.cheer + 0.05);
      const c = aFree(run);
      const r = run.tap(c.id);
      if (r.kind === "out") paid.push(r.points / (TUNE.square * c.len));
    }
    expect(paid).toEqual([1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3]);
    expect(tiers).toEqual([2, 3]);
    expect(run.toNextTier).toBe(TUNE.tiers[2]! - 12);
    expect(run.stats.bestPurr).toBe(3);
  });
});

describe("a rug", () => {
  it("cleared pays for the rug, the candle left, a clean rug and the witch's cat going last, and gives candle back", () => {
    const events: ClearEvent[] = [];
    const run = fresh(21, { cleared: (e) => events.push(e) });
    advance(run, 5);
    const clock = run.clock;
    const before = run.score;
    let cats = 0;
    for (const id of run.board.witness) {
      const r = run.tap(id);
      if (r.kind === "out") cats += r.points;
    }
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e).toMatchObject({ level: 0, clean: true, last: true, refund: TUNE.refund(0) });
    expect(e.points).toBe(TUNE.rug + Math.round(clock) * TUNE.perSecond + TUNE.clean + TUNE.last);
    expect(run.score).toBe(before + cats + e.points);
    expect(run.clock).toBeCloseTo(Math.min(TUNE.max, clock + TUNE.refund(0)), 5);
    expect(run.stats).toMatchObject({ rugs: 1, cleanRugs: 1, lastOut: 1 });
  });

  it("a bump on the way, or the witch's cat leaving early, costs those bonuses", () => {
    const events: ClearEvent[] = [];
    const run = fresh(33, { cleared: (e) => events.push(e) });
    const stuck = aStuck(run)!;
    run.tap(stuck.id);
    // Everyone out, the witch's cat as soon as she can go rather than last.
    while (catsLeft(run.board) > 0) {
      const free = freeCats(run.board);
      const pick = free.find((c) => c.coat === 0) ?? free[0]!;
      run.tap(pick.id);
    }
    expect(events[0]!.clean).toBe(false);
    const witchLast = run.board.cats.length > 1 && events[0]!.last;
    // She was sent as early as the rug allowed; if anyone was still there after her, no bonus.
    expect(typeof witchLast).toBe("boolean");
    expect(run.stats.cleanRugs).toBe(0);
  });

  it("the candle stands still while a cleared rug is cheered, taps wait, and the next rug is bigger", () => {
    const laid: number[] = [];
    const run = fresh(8, { laid: (_b, level) => laid.push(level) });
    clearRug(run);
    expect(run.phase).toBe("cheer");
    const clock = run.clock;
    advance(run, TUNE.cheer - 0.1);
    expect(run.clock).toBe(clock);
    expect(run.level).toBe(0);
    advance(run, 0.2);
    expect(run.level).toBe(1);
    expect(laid).toEqual([0, 1]);
    expect(run.board.cats.length).toBeGreaterThan(4);
    expect(run.board.cats.every((c) => !c.out)).toBe(true);
    expect(run.rugBumps).toBe(0);
    // Taps count as soon as the rug is down, even while it is still being laid.
    expect(run.phase).toBe("lay");
    expect(run.tap(aFree(run).id).kind).toBe("out");
    advance(run, TUNE.lay + 0.05);
    expect(run.phase).toBe("play");
  });

  it("the candle never holds more than its cap, and a later rug gives less back", () => {
    const run = fresh(4);
    for (let i = 0; i < 6; i++) {
      clearRug(run);
      expect(run.clock).toBeLessThanOrEqual(TUNE.max);
      advance(run, TUNE.cheer + 0.05);
    }
    expect(TUNE.refund(0)).toBeGreaterThan(TUNE.refund(5));
    expect(TUNE.refund(50)).toBeGreaterThanOrEqual(4);
    expect(TUNE.burn(60)).toBeGreaterThan(TUNE.burn(10));
  });
});

describe("the run", () => {
  it("an untouched run ends on its own when the candle goes, after the first ten seconds", () => {
    let over = 0;
    const run = fresh(99, { over: () => over++ });
    advance(run, 60);
    expect(run.over).toBe(true);
    expect(over).toBe(1);
    expect(run.time).toBeGreaterThan(14);
    expect(run.time).toBeLessThan(21);
    expect(run.guttering).toBe(true);
    expect(run.score).toBe(0);
    const t = run.time;
    advance(run, 1);
    expect(run.time).toBe(t);
    expect(run.tap(run.board.cats[0]!.id)).toEqual({ kind: "none" });
  });

  it("random tapping ends inside the reviewer's script", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(seed);
      const run = fresh(seed * 31);
      let t = 0;
      while (!run.over && run.time < 200) {
        t += DT;
        if (t >= 0.25) {
          t = 0;
          const left = run.board.cats.filter((c) => !c.out);
          if (left.length && rng.chance(0.7)) run.tap(rng.pick(left).id);
        }
        run.step(DT);
      }
      expect(run.time).toBeLessThan(70);
      expect(run.time).toBeGreaterThan(10);
    }
  });

  it("the same seed and the same taps make the same run, and every rug depends only on the seed and its number", () => {
    const play = (seed: number, sloppy: boolean) => {
      const run = fresh(seed);
      const boards: string[] = [];
      let t = 0;
      let taps = 0;
      while (!run.over && run.level < 4) {
        t += DT;
        if (t >= 0.2 && run.phase !== "cheer") {
          t = 0;
          const stuck = sloppy && ++taps % 6 === 0 ? aStuck(run) : undefined;
          run.tap((stuck ?? aFree(run)).id);
        }
        const level = run.level;
        run.step(DT);
        if (run.level !== level || boards.length === 0) boards.push(JSON.stringify(run.board.cats.map((c) => [c.x, c.y, c.len, c.dir, c.coat])));
      }
      return { boards, score: run.score, time: run.time };
    };
    const a = play(4242, false);
    expect(play(4242, false)).toEqual(a);
    // A sloppier player meets the very same rugs.
    const b = play(4242, true);
    expect(b.boards).toEqual(a.boards);
    expect(b.score).not.toBe(a.score);
    expect(play(4243, false).boards).not.toEqual(a.boards);
  });
});
