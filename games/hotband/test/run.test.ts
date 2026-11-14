import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { COLS, HIDDEN, ROWS, spawnAt, VISIBLE } from "../src/pieces.ts";
import { gainOf, Run, TUNE, zoneOf, type CutEvent, type RunListener } from "../src/run.ts";
import { at, collides, isEmpty, lit, NOISE, SIGNAL } from "../src/well.ts";

const DT = 1 / 60;
const advance = (run: Run, seconds: number, dt = DT) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) run.step(dt);
};
/** A run with its first piece (always a bar of three) in play. */
const fresh = (seed = 7, listener: RunListener = {}) => {
  const run = new Run(seed, listener).start();
  run.step(DT);
  return run;
};
const fillRow = (run: Run, y: number, except: number[] = [], v = SIGNAL) => {
  for (let x = 0; x < COLS; x++) if (!except.includes(x)) run.well[at(x, y)] = v;
};
/** Slides the bar so its left end is at band `x`, then slams it. */
const slamBarAt = (run: Run, x: number) => {
  const a = run.active!;
  expect(a.kind).toBe(1);
  run.shift(x - a.x);
  expect(run.active!.x).toBe(x);
  return run.slam();
};
/** Waits for the next piece to arrive. */
const nextPiece = (run: Run) => {
  const n = run.pieceCount;
  for (let i = 0; i < 600 && run.pieceCount === n && !run.over; i++) run.step(DT);
};

describe("moving a piece", () => {
  it("the first piece is a bar, centred, and the opening pieces are the plain ones", () => {
    for (let seed = 1; seed < 40; seed++) {
      const run = fresh(seed);
      expect(run.active).toMatchObject({ kind: 1, rot: 0, ...spawnAt(1) });
      const kinds = [run.active!.kind];
      for (let i = 0; i < 6; i++) {
        run.slam();
        // Keep the meter from filling while we look at what arrives.
        run.well.fill(0);
        nextPiece(run);
        kinds.push(run.active!.kind);
      }
      expect(kinds.sort()).toEqual([0, 1, 1, 2, 2, 3, 4]);
    }
  });

  it("after the opening every nine pieces hold each kind, the bar and the corner twice", () => {
    const run = fresh(11);
    const kinds: number[] = [];
    for (let i = 0; i < 7 + 27; i++) {
      kinds.push(run.active!.kind);
      run.slam();
      run.well.fill(0);
      nextPiece(run);
    }
    for (let bag = 0; bag < 3; bag++) {
      expect(kinds.slice(7 + bag * 9, 16 + bag * 9).sort()).toEqual([0, 1, 1, 2, 2, 3, 4, 5, 6]);
    }
  });

  it("slides band by band, stops at the walls and says how far it got", () => {
    const run = fresh();
    expect(run.shift(-1)).toBe(-1);
    expect(run.shift(-9)).toBe(-1);
    expect(run.active!.x).toBe(0);
    expect(run.shift(-1)).toBe(0);
    expect(run.shift(99)).toBe(5);
    expect(run.active!.x).toBe(5);
    expect(run.stats.slides).toBe(7);
  });

  it("turns a quarter at a time and steps away from a wall when it has to", () => {
    const run = fresh();
    run.shift(-9);
    // The bar upright against the left wall, then turned again: it has to come back flat inside the meter.
    expect(run.rotate()).toBe(true);
    run.shift(-9);
    for (let i = 0; i < 3; i++) expect(run.rotate()).toBe(true);
    const a = run.active!;
    expect(collides(run.well, a.kind, a.rot, a.x, a.y)).toBe(false);
    expect(run.stats.turns).toBe(4);
  });

  it("a turn with no room anywhere is refused and changes nothing", () => {
    let refused = 0;
    const run = fresh(7, { turn: (ok) => void (ok || refused++) });
    // An upright bar in a one-band shaft, three rows deep.
    run.rotate();
    const a = run.active!;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== a.x + 2) run.well[at(x, y)] = SIGNAL;
    const before = { ...a };
    expect(run.rotate()).toBe(false);
    expect(run.active).toEqual(before);
    expect(refused).toBe(1);
  });

  it("a slam lands the piece at once, pays two points a row, and the next piece follows", () => {
    const locks: number[] = [];
    const run = fresh(7, { lock: (e) => locks.push(e.slam) });
    const fell = run.slam();
    expect(fell).toBe(ROWS - 1 - HIDDEN);
    expect(run.active).toBeNull();
    expect(run.score).toBe(fell * TUNE.slamRow);
    expect(lit(run.well)).toBe(3);
    expect(locks).toEqual([fell]);
    nextPiece(run);
    expect(run.pieceCount).toBe(2);
  });

  it("falls a row at a time, faster each level, and a pull down is faster still", () => {
    expect(TUNE.fall(1)).toBeGreaterThan(TUNE.fall(2));
    expect(TUNE.fall(TUNE.maxLevel)).toBeGreaterThanOrEqual(0.05);
    const run = fresh();
    const y0 = run.active!.y;
    run.poke();
    advance(run, TUNE.fall(1) * 3 + 0.02);
    expect(run.active!.y).toBe(y0 + 3);
    run.setSoft(true);
    advance(run, TUNE.softFall * 4 + 0.02);
    expect(run.active!.y).toBeGreaterThanOrEqual(y0 + 6);
    expect(run.stats.softs).toBe(1);
  });

  it("a piece resting on the stack can still be slid for a moment, a few times over, and then locks", () => {
    const run = fresh();
    run.setSoft(true);
    advance(run, 0.6);
    run.setSoft(false);
    const a = run.active!;
    expect(a.y).toBe(ROWS - 2);
    // Sliding keeps it alive, but only so many times.
    for (let i = 0; i < TUNE.lockResets + 3 && run.active; i++) {
      advance(run, TUNE.lockDelay * 0.8);
      if (run.active) run.shift(i % 2 ? 1 : -1);
    }
    advance(run, TUNE.lockDelay + 0.05);
    expect(run.pieceCount).toBe(2);
    expect(lit(run.well)).toBe(3);
  });
});

describe("cutting rows", () => {
  it("a full row is cut: it pays, shows for a moment, then the stack drops", () => {
    const cuts: CutEvent[] = [];
    const drops: number[][] = [];
    const run = fresh(7, { cut: (e) => cuts.push(e), drop: (r) => drops.push(r) });
    fillRow(run, 17, [0, 1, 2]);
    run.well[at(6, 16)] = SIGNAL;
    const fell = slamBarAt(run, 0);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ rows: [17], hot: 0, noise: 0, gain: 1, chain: 1, points: 100, silence: false });
    expect(run.score).toBe(100 + fell * TUNE.slamRow);
    expect(run.cutting).toEqual([17]);
    advance(run, TUNE.clearPause + 0.03);
    expect(run.cutting).toBeNull();
    expect(drops).toEqual([[17]]);
    expect(run.well[at(6, 17)]).toBe(SIGNAL);
    expect(lit(run.well)).toBe(1);
    expect(run.stats).toMatchObject({ rows: 1, singles: 1, bestChain: 1 });
  });

  it("two and three rows with one piece pay 300 and 600", () => {
    const cuts: CutEvent[] = [];
    const run = fresh(7, { cut: (e) => cuts.push(e) });
    fillRow(run, 17, [7]);
    fillRow(run, 16, [7]);
    fillRow(run, 15, [7]);
    run.well[at(0, 14)] = SIGNAL;
    run.rotate();
    // The upright bar sits in the middle column of its box.
    run.shift(7 - 1 - run.active!.x);
    run.slam();
    expect(cuts[0]).toMatchObject({ rows: [15, 16, 17], points: 600 * gainOf(3), chain: 3 });
    expect(run.stats.triples).toBe(1);
    expect(TUNE.base).toEqual([0, 100, 300, 600]);
  });

  it("a row cut in the red pays extra, and so does a noise row", () => {
    const cuts: CutEvent[] = [];
    const run = fresh(7, { cut: (e) => cuts.push(e) });
    const red = HIDDEN + TUNE.redRows - 1;
    expect(zoneOf(red)).toBe(2);
    expect(zoneOf(red + 1)).toBe(1);
    expect(zoneOf(ROWS - 1)).toBe(0);
    for (let y = red + 1; y < ROWS; y++) fillRow(run, y, [7], y === ROWS - 1 ? NOISE : SIGNAL);
    fillRow(run, red, [0, 1, 2]);
    slamBarAt(run, 0);
    expect(cuts[0]).toMatchObject({ rows: [red], hot: 1, noise: 0, points: 100 + TUNE.hot });
    // Now the noise row at the floor.
    const run2 = fresh(8, { cut: (e) => cuts.push(e) });
    fillRow(run2, 17, [0, 1, 2], NOISE);
    run2.well[at(7, 16)] = SIGNAL;
    slamBarAt(run2, 0);
    expect(cuts[1]).toMatchObject({ rows: [17], noise: 1, points: 100 + TUNE.noiseCut });
    expect(run2.stats.noiseCut).toBe(1);
  });

  it("leaving the meter dark is a silence bonus", () => {
    const cuts: CutEvent[] = [];
    const run = fresh(7, { cut: (e) => cuts.push(e) });
    fillRow(run, 17, [0, 1, 2]);
    slamBarAt(run, 0);
    expect(cuts[0]).toMatchObject({ silence: true, points: 100 + TUNE.silence });
    advance(run, TUNE.clearPause + 0.03);
    expect(isEmpty(run.well)).toBe(true);
    expect(run.stats.silences).toBe(1);
  });

  it("gain tiers come at 2, 4, 7 and 11 rows in a chain, and every cut is paid times the gain", () => {
    expect([0, 1, 2, 3, 4, 6, 7, 10, 11, 40].map(gainOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    const cuts: CutEvent[] = [];
    const tiers: number[] = [];
    const run = fresh(7, { cut: (e) => cuts.push(e), tier: (g) => tiers.push(g) });
    for (let i = 0; i < 4; i++) {
      // Whatever arrives, park it out of the way; a bar is conjured for each cut.
      run.active!.kind = 1;
      run.active!.rot = 0;
      fillRow(run, 17, [0, 1, 2]);
      run.well[at(7, 16)] = SIGNAL;
      slamBarAt(run, 0);
      advance(run, TUNE.clearPause + 0.03);
      run.well[at(7, 17)] = 0;
      nextPiece(run);
    }
    expect(cuts.map((c) => c.chain)).toEqual([1, 2, 3, 4]);
    expect(cuts.map((c) => c.gain)).toEqual([1, 2, 2, 3]);
    expect(cuts.map((c) => c.points)).toEqual([100, 200, 200, 300]);
    expect(tiers).toEqual([2, 3]);
    expect(run.toNextTier).toBe(3);
    expect(run.stats.bestGain).toBe(3);
  });

  it("a chain survives one piece that cuts nothing and ends on the second", () => {
    let ended = 0;
    const run = fresh(7, { chainEnd: () => ended++ });
    fillRow(run, 17, [0, 1, 2]);
    run.well[at(7, 16)] = SIGNAL;
    slamBarAt(run, 0);
    advance(run, TUNE.clearPause + 0.03);
    nextPiece(run);
    expect(run.chain).toBe(1);
    expect(run.chainAtRisk).toBe(false);
    run.slam();
    nextPiece(run);
    expect(run.chain).toBe(1);
    expect(run.chainAtRisk).toBe(true);
    run.well.fill(0);
    run.slam();
    expect(run.chain).toBe(0);
    expect(ended).toBe(1);
  });
});

describe("the run", () => {
  it("levels come with rows cut and with time", () => {
    const levels: number[] = [];
    const run = fresh(7, { level: (l) => levels.push(l) });
    run.stats.rows = TUNE.rowsPerLevel * 2;
    run.step(DT);
    expect(run.level).toBe(3);
    const idle = new Run(9, { level: (l) => levels.push(l) }).start();
    idle.well.fill(0);
    for (let t = 0; t < TUNE.secondsPerLevel + 0.1 && !idle.over; t += DT) {
      idle.well.fill(0);
      idle.step(DT);
    }
    expect(idle.level).toBe(2);
    expect(levels).toEqual([3, 2]);
  });

  it("the noise floor: a warning, then a row from below with one dark band, sooner and sooner", () => {
    const gaps: number[] = [];
    let warned = 0;
    const run = fresh(7, { noise: (g) => gaps.push(g), noiseWarn: () => (warned = run.time) });
    const times: number[] = [];
    while (gaps.length < 14 && run.time < 200) {
      // Keep the meter empty and the piece in play, so only the floor's clock matters.
      const n = gaps.length;
      run.well.fill(0);
      if (run.active) run.active.y = HIDDEN;
      run.poke();
      run.step(DT);
      if (gaps.length > n) {
        times.push(run.time);
        expect(run.time - warned).toBeCloseTo(TUNE.noiseWarn, 1);
        for (let x = 0; x < COLS; x++) expect(run.well[at(x, ROWS - 1)]).toBe(x === gaps[n] ? 0 : NOISE);
      }
    }
    expect(times[0]).toBeCloseTo(TUNE.noiseStart, 1);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).not.toBe(gaps[i - 1]);
    const waits = times.slice(1).map((t, i) => t - times[i]!);
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeLessThanOrEqual(waits[i - 1]! + 1e-6);
    expect(waits[0]!).toBeGreaterThan(5);
    expect(TUNE.noiseEvery(500)).toBeGreaterThanOrEqual(1);
  });

  it("a piece the floor rises under is lifted with the stack, never left inside it", () => {
    const run = fresh();
    run.setSoft(true);
    advance(run, 0.6);
    run.setSoft(false);
    for (let i = 0; i < 400 && run.stats.noisePushed === 0; i++) {
      if (run.active) run.shift(i % 2 ? 1 : -1);
      advance(run, 0.1);
      const a = run.active;
      if (a) expect(collides(run.well, a.kind, a.rot, a.x, a.y)).toBe(false);
    }
    expect(run.stats.noisePushed).toBe(1);
  });

  it("clipping ends the run: a stack into the hidden rows, or no room for the next piece", () => {
    let over = 0;
    const run = fresh(7, { over: () => over++ });
    advance(run, TUNE.breakerUntil);
    for (let y = HIDDEN + 1; y < ROWS; y++) fillRow(run, y, [0]);
    run.well.fill(0, 0, (HIDDEN + 1) * COLS);
    run.active!.y = spawnAt(1).y;
    run.slam();
    run.step(DT);
    advance(run, 0.2);
    // The bar rests on the stack's top row; the next piece has nowhere to arrive.
    expect(run.over).toBe(true);
    expect(over).toBe(1);
    expect(run.stats.left).toBeGreaterThan(0);
    const before = run.time;
    advance(run, 1);
    expect(run.time).toBe(before);
  });

  it("the breaker: a played run that clips in its first seconds starts again dark, and an untouched one does not", () => {
    let trips = 0;
    const run = fresh(7, { breaker: () => trips++ });
    for (let y = HIDDEN; y < ROWS; y++) fillRow(run, y, [0]);
    run.shift(1);
    run.slam();
    advance(run, 0.2);
    expect(run.over).toBe(false);
    expect(trips).toBe(1);
    expect(isEmpty(run.well)).toBe(true);
    expect(run.stats.trips).toBe(1);
    nextPiece(run);
    expect(run.active).not.toBeNull();
    // Nobody is playing: no second chance.
    for (let y = HIDDEN; y < ROWS; y++) fillRow(run, y, [0]);
    advance(run, 3);
    expect(run.over).toBe(true);
    expect(trips).toBe(1);
  });

  it("an untouched run ends on its own inside the reviewer's wait, but not in the first ten seconds", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const run = new Run(seed * 977).start();
      advance(run, 60);
      expect(run.over).toBe(true);
      expect(run.time).toBeGreaterThan(10);
      expect(run.time).toBeLessThan(24);
      expect(run.score).toBe(0);
    }
  });

  it("random flailing ends inside the reviewer's script", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(seed);
      const run = new Run(seed * 31).start();
      let t = 0;
      while (!run.over && run.time < 120) {
        t += DT;
        if (t >= 0.25) {
          t = 0;
          const r = rng();
          if (r < 0.55) run.rotate();
          else if (r < 0.7) run.slam();
          else run.shift(rng.int(-3, 3));
        }
        run.step(DT);
      }
      expect(run.time).toBeLessThan(70);
    }
  });

  it("is the same run at 30, 60 and 120 frames a second, and the same again from the same seed", () => {
    const play = (dt: number, seed: number) => {
      const run = new Run(seed).start();
      // Commands at fixed moments of run time, whatever the frame rate.
      const script: Array<[number, () => void]> = [];
      for (let i = 0; i < 80; i++) {
        script.push([0.3 + i * 0.6, () => run.rotate()]);
        script.push([0.4 + i * 0.6, () => run.shift((i % 7) - 3)]);
        script.push([0.5 + i * 0.6, () => run.slam()]);
      }
      let next = 0;
      for (let step = 0; !run.over && run.time < 55; step++) {
        while (next < script.length && script[next]![0] <= run.time + 1e-9) script[next++]![1]();
        // The commands fall on whole tenths of a second, which every one of these rates steps on exactly.
        run.step(dt);
        if (step > 100000) break;
      }
      return { score: run.score, time: Math.round(run.time * 60), rows: run.stats.rows, well: [...run.well].join("") };
    };
    const a = play(1 / 60, 4242);
    expect(play(1 / 60, 4242)).toEqual(a);
    expect(play(1 / 60, 4243)).not.toEqual(a);
    expect(play(1 / 30, 4242)).toEqual(a);
    expect(play(1 / 120, 4242)).toEqual(a);
    expect(a.time / 60).toBeGreaterThan(8);
    expect(VISIBLE).toBe(16);
  });
});
