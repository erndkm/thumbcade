import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { applyMove, cloneBoard, FULL, isIdleMove, isSealed, legalMoves, type Move } from "../src/rules.ts";
import { clearTimeFor, multiplier, Run, runSeed, TIER_LINES, TUNE, type RunEvent } from "../src/run.ts";
import { boardKey, solve } from "../src/solver.ts";

/** Plays a move through the input path: tap the pot to lift, tap the target to drop. */
function play(run: Run, m: Move): RunEvent[] {
  return [...run.tap(m.from), ...run.tap(m.to)];
}

/** Steps the clock in frames. */
function wait(run: Run, s: number): RunEvent[] {
  const out: RunEvent[] = [];
  for (let t = 0; t < s; t += 1 / 60) out.push(...run.step(1 / 60));
  return out;
}

/** A run and a move from its position that leaves no way to tidy the level. */
function fatal(seed: number): { run: Run; move: Move } {
  const rng = createRng(seed);
  for (let tries = 0; tries < 200; tries++) {
    const run = new Run(seed + tries);
    for (let step = 0; step < 12; step++) {
      const moves = legalMoves(run.board).filter((m) => !isIdleMove(run.board, m.from, m.to));
      for (const m of moves) {
        const b = cloneBoard(run.board);
        applyMove(b, m.from, m.to);
        if (!b.every((p) => !p.units.length || isSealed(p)) && solve(b).status === "dead") return { run, move: m };
      }
      const alive = moves.filter((m) => {
        const b = cloneBoard(run.board);
        applyMove(b, m.from, m.to);
        return solve(b).status === "solved";
      });
      if (!alive.length) break;
      play(run, rng.pick(alive));
      if (run.pause > 0) break;
    }
  }
  throw new Error("no fatal move found");
}

describe("the run", () => {
  it("starts with a deal and a full clock; the clock burns faster as the run goes on", () => {
    const run = new Run(1);
    expect(run.level).toBe(1);
    expect(run.clock).toBe(TUNE.clock);
    expect(run.burn).toBe(1);
    run.t = 60;
    expect(run.burn).toBeGreaterThan(1.3);
  });

  it("an idle run ends on its own inside the reviewer's idle window", () => {
    const run = new Run(2);
    const evs = wait(run, 40);
    expect(evs.some((e) => e.type === "over")).toBe(true);
    expect(run.t).toBeGreaterThan(20);
    expect(run.t).toBeLessThan(25);
    expect(run.stats.seconds).toBeCloseTo(run.t);
  });

  it("lift, put back, re-target and nope through taps", () => {
    const run = new Run(3);
    const b = run.board;
    const src = b.findIndex((p) => p.units.length > 0);
    expect(run.tap(src)[0]!.type).toBe("lift");
    expect(run.held).toBe(src);
    expect(run.tap(src)[0]!.type).toBe("putBack");
    expect(run.held).toBe(-1);
    const empty = b.findIndex((p) => !p.units.length);
    expect(run.tap(empty)[0]).toMatchObject({ type: "nope", why: "empty" });
    // A tap on a pot that can't take the run lifts that pot's run instead.
    run.tap(src);
    const other = b.findIndex((p, i) => i !== src && p.units.length > 0 && p.units[p.units.length - 1] !== b[src]!.units[b[src]!.units.length - 1]);
    if (other >= 0) {
      expect(run.tap(other)[0]).toMatchObject({ type: "retarget", from: src, pot: other });
      expect(run.held).toBe(other);
    }
    expect(run.tapAway()[0]!.type).toBe("putBack");
  });

  it("sealing pays by the streak, gives time back, and the tiers have names", () => {
    expect([1, 2, 3, 4, 6, 7, 10, 11, 20].map(multiplier)).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5]);
    for (let m = 2; m <= 5; m++) expect(TIER_LINES[m]!.length).toBeGreaterThan(3);
    const run = new Run(4);
    let seals: Array<Extract<RunEvent, { type: "seal" }>> = [];
    let guard = 0;
    while (run.level === 1 && guard++ < 50) {
      const before = run.clock;
      const line = solve(run.board).moves;
      const evs = play(run, line[0]!);
      const s = evs.filter((e) => e.type === "seal") as typeof seals;
      if (s.length) expect(run.clock).toBeGreaterThan(before);
      seals = seals.concat(s);
      if (run.pause > 0) break;
    }
    expect(seals.length).toBe(2);
    expect(seals[0]!.points).toBe(TUNE.sealPoints);
    // Two seals within the window: the second is ×2.
    expect(seals[1]!.streak).toBe(2);
    expect(seals[1]!.mult).toBe(2);
    expect(seals[1]!.tierUp).toBe(true);
  });

  it("a streak breaks when the next seal comes too late", () => {
    const run = new Run(5);
    run.streak = 3;
    run.lastSeal = 0;
    run.t = TUNE.streakWindow + 0.5;
    const line = solve(run.board).moves;
    let seal: Extract<RunEvent, { type: "seal" }> | undefined;
    for (const m of line) {
      seal = play(run, m).find((e) => e.type === "seal") as typeof seal;
      if (seal) break;
    }
    expect(seal!.streak).toBe(1);
  });

  it("a tidied level pays, refunds time, earns a spare pot, waits with the clock still, then deals a bigger one", () => {
    const run = new Run(6);
    let clear: Extract<RunEvent, { type: "clear" }> | undefined;
    for (const m of run.witness) {
      clear = play(run, m).find((e) => e.type === "clear") as typeof clear;
      if (clear) break;
    }
    expect(clear).toBeDefined();
    expect(clear!.time).toBe(clearTimeFor(1));
    expect(run.spares).toBe(1);
    expect(run.pause).toBe(TUNE.dealPause);
    const clock = run.clock;
    expect(run.tap(0)).toEqual([]);
    const evs = wait(run, TUNE.dealPause + 0.05);
    expect(run.clock).toBeCloseTo(clock - 0.05 * run.burn, 1);
    expect(evs.some((e) => e.type === "deal")).toBe(true);
    expect(run.level).toBe(2);
    expect(run.board.length).toBeGreaterThan(3);
    expect(clearTimeFor(30)).toBe(TUNE.clearTimeMin);
  });

  it("a dead end is never the end: the grace rewinds it for free", () => {
    const { run, move } = fatal(11);
    const before = boardKey(run.board);
    const clock0 = run.clock;
    const evs = play(run, move);
    expect(evs.some((e) => e.type === "stuck")).toBe(true);
    const help = wait(run, TUNE.stuckDelay + 0.05).find((e) => e.type === "help");
    expect(help).toMatchObject({ how: "grace", cost: 0 });
    expect(boardKey(run.board)).toBe(before);
    expect(run.clock).toBeGreaterThan(clock0 - TUNE.stuckDelay * 1.5);
    expect(solve(run.board).status).toBe("solved");
  });

  it("after the grace, a held spare pot steps in; without one, a rewind costs a few seconds", () => {
    const a = fatal(12);
    a.run.graceUsed = true;
    a.run.t = TUNE.safeStart + 1;
    a.run.spares = 1;
    const n = a.run.board.length;
    play(a.run, a.move);
    const h1 = wait(a.run, TUNE.stuckDelay + 0.05).find((e) => e.type === "help");
    expect(h1).toMatchObject({ how: "spare" });
    expect(a.run.board.length).toBe(n + 1);
    expect(a.run.board[n]!.spare).toBe(true);
    expect(a.run.spares).toBe(0);

    const b = fatal(13);
    b.run.graceUsed = true;
    b.run.t = TUNE.safeStart + 1;
    b.run.clock = 20;
    const before = boardKey(b.run.board);
    play(b.run, b.move);
    const h2 = wait(b.run, TUNE.stuckDelay + 0.05).find((e) => e.type === "help");
    expect(h2).toMatchObject({ how: "rewind", cost: TUNE.rewindCost });
    expect(boardKey(b.run.board)).toBe(before);
    expect(b.run.clock).toBeLessThan(20 - TUNE.rewindCost + 0.1);
  });

  it("a spare pot can be used by hand, once a level, and it is an empty full-size pot", () => {
    const run = new Run(14);
    expect(run.useSpare()).toEqual([]);
    run.spares = 2;
    const evs = run.useSpare();
    expect(evs[0]!.type).toBe("spare");
    const p = run.board[run.board.length - 1]!;
    expect(p).toMatchObject({ cap: FULL, spare: true });
    expect(p.units.length).toBe(0);
    expect(run.useSpare()).toEqual([]);
    expect(run.spares).toBe(1);
  });

  it("is deterministic: the same seed and taps give the same run", () => {
    const a = new Run(runSeed(1234, 1));
    const b = new Run(runSeed(1234, 1));
    for (let i = 0; i < 12; i++) {
      const m = solve(a.board).moves[0];
      if (m) {
        play(a, m);
        play(b, m);
      }
      wait(a, 0.3);
      wait(b, 0.3);
    }
    expect(boardKey(a.board)).toBe(boardKey(b.board));
    expect(a.score).toBe(b.score);
    expect(a.clock).toBe(b.clock);
    expect(runSeed(1, 1)).not.toBe(runSeed(1, 2));
  });

  it("the attract demo never runs out and loops back to level 1", () => {
    const run = new Run(15, { demo: true, loopAfter: 2 });
    for (let l = 0; l < 3; l++) {
      for (const m of run.witness) play(run, m);
      wait(run, TUNE.dealPause + 0.1);
    }
    expect(run.live).toBe(true);
    expect(run.level).toBeLessThanOrEqual(2);
    expect(run.clock).toBeGreaterThan(TUNE.clock);
  });
});
