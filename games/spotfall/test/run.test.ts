import { describe, expect, it } from "vitest";
import { BOMB, EMPTY, LIMIT, WILD } from "../src/board.ts";
import {
  CLEAN_ROWS,
  comboMult,
  COMBO_WILD,
  dropPoints,
  missesPerFeed,
  paletteAt,
  rowSeconds,
  Run,
  SHOT_FILL,
  START_ROWS,
  WARMUP,
  WILD_DROP,
  BOMB_DROP,
} from "../src/run.ts";

/** Steps until the shot in flight has landed. */
function settleShot(run: Run): void {
  for (let i = 0; i < 200 && run.shot; i++) run.step(1 / 60);
}

/** A run on a cleared sheet (row 0 full width), for building positions by hand. */
function blank(seed = 1): Run {
  const run = new Run(seed);
  clear(run);
  run.meter = 0;
  return run;
}

function clear(run: Run): void {
  run.board.cells.fill(EMPTY);
  run.board.shift = 0;
}

/**
 * A pink pair either side of the middle of row 0, so a pink shot straight up lands between them and pops three, and
 * one green dot in the corner so the sheet doesn't come clean.
 */
function pinkPair(run: Run, anchor = true): void {
  run.board.set(0, 3, 1);
  run.board.set(0, 5, 1);
  if (anchor) run.board.set(0, 0, 3);
  run.current = 1;
}

/** Cells hanging in a chain from (0, 5), down the right of the sheet and clear of a straight-up shot. */
const CHAIN: Array<[number, number]> = [
  [1, 5],
  [2, 6],
  [3, 6],
  [4, 7],
  [5, 7],
  [6, 7],
  [7, 7],
  [8, 7],
  [9, 7],
  [10, 7],
];

describe("a fresh run", () => {
  it("starts with six rows of four inks, and loads inks that are on the sheet", () => {
    const run = new Run(42);
    expect(run.board.lowest()).toBe(START_ROWS - 1);
    expect(run.board.inks().every((k) => k < paletteAt(0))).toBe(true);
    expect(run.board.inks()).toContain(run.current);
    expect(run.board.inks()).toContain(run.next);
  });

  it("is the same sheet for the same seed", () => {
    expect(Array.from(new Run(7).board.cells)).toEqual(Array.from(new Run(7).board.cells));
    expect(Array.from(new Run(7).board.cells)).not.toEqual(Array.from(new Run(8).board.cells));
  });

  it("adds inks and pressure as it goes", () => {
    expect([paletteAt(0), paletteAt(12), paletteAt(35)]).toEqual([4, 5, 6]);
    expect([missesPerFeed(0), missesPerFeed(30), missesPerFeed(60)]).toEqual([4, 3, 2]);
    expect(rowSeconds(0)).toBeGreaterThan(rowSeconds(60));
    expect(rowSeconds(200)).toBeGreaterThan(1);
  });
});

describe("the press", () => {
  it("a miss moves it on more than a pop does", () => {
    const run = blank();
    run.board.set(0, 4, 0);
    run.current = 1;
    run.fire(Math.PI / 2);
    settleShot(run);
    const missFill = run.meter;
    expect(missFill).toBeGreaterThan(SHOT_FILL + 1 / missesPerFeed(0) - 0.02);
    const run2 = blank();
    pinkPair(run2);
    run2.fire(Math.PI / 2);
    settleShot(run2);
    expect(run2.meter).toBeLessThan(SHOT_FILL + 0.05);
  });

  it("waits for the shot in flight before it feeds", () => {
    const run = new Run(3);
    run.meter = 0.999;
    run.time = 20;
    run.fire(Math.PI / 2);
    run.step(1 / 60);
    expect(run.events.some((e) => e.k === "feed")).toBe(false);
    settleShot(run);
    run.step(1 / 60);
    expect(run.events.some((e) => e.k === "feed")).toBe(true);
  });

  it("feeds at most one row in the warm-up, whatever happens", () => {
    const run = new Run(5);
    for (let i = 0; i < 12; i++) {
      run.fire(0.3 + (i % 5) * 0.6);
      settleShot(run);
    }
    while (run.time < WARMUP - 0.1) run.step(1 / 30);
    expect(run.feeds).toBeLessThanOrEqual(1);
    expect(run.phase).toBe("play");
  });

  it("jams an idle player inside the reviewer's 25 s, but not in the first 10 s", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const run = new Run(seed);
      while (run.phase === "play" && run.time < 60) run.step(1 / 30);
      expect(run.phase).toBe("over");
      expect(run.time).toBeGreaterThan(10);
      expect(run.time).toBeLessThan(25);
    }
  });

  it("jams the run when a dot is left past the line", () => {
    const run = blank();
    for (let r = 0; r < LIMIT; r++) run.board.set(r, 4, r % 2 ? 0 : 1);
    run.current = 2;
    run.fire(Math.PI / 2);
    settleShot(run);
    expect(run.phase).toBe("over");
    expect(run.events.some((e) => e.k === "over")).toBe(true);
  });
});

describe("scoring and rewards", () => {
  it("the hand-built chain hangs dot by dot", () => {
    const run = blank();
    for (let i = 1; i < CHAIN.length; i++) {
      const [r, c] = CHAIN[i]!;
      const [pr, pc] = CHAIN[i - 1]!;
      expect(run.board.neighbors(r, c).some((n) => n.r === pr && n.c === pc)).toBe(true);
    }
    expect(run.board.neighbors(1, 5).some((n) => n.r === 0 && n.c === 5)).toBe(true);
  });

  it("pops pay 10 a dot, drops pay more for every dot that falls", () => {
    const run = blank();
    pinkPair(run);
    for (const [r, c] of CHAIN.slice(0, 3)) run.board.set(r, c, 2);
    run.fire(Math.PI / 2);
    settleShot(run);
    const pop = run.events.find((e) => e.k === "pop");
    const drop = run.events.find((e) => e.k === "drop");
    expect(pop && pop.k === "pop" && pop.points).toBe(30);
    expect(drop && drop.k === "drop" && drop.points).toEqual([dropPoints(1), dropPoints(2), dropPoints(3)]);
    expect(run.score).toBe(30 + 20 + 40 + 60);
    expect(run.board.count()).toBe(1);
  });

  it("the combo multiplies consecutive popping shots and a miss breaks it", () => {
    expect([comboMult(1), comboMult(2), comboMult(3), comboMult(20)]).toEqual([1, 1.5, 2, 5]);
    const run = blank();
    for (let i = 0; i < 2; i++) {
      clear(run);
      pinkPair(run);
      run.fire(Math.PI / 2);
      settleShot(run);
    }
    expect(run.combo).toBe(2);
    clear(run);
    run.board.set(0, 4, 3);
    run.current = 0;
    run.fire(Math.PI / 2);
    settleShot(run);
    expect(run.combo).toBe(0);
  });

  it(`every ${COMBO_WILD}th popping shot in a row earns a registration mark`, () => {
    const run = blank();
    for (let i = 0; i < COMBO_WILD; i++) {
      clear(run);
      pinkPair(run);
      run.fire(Math.PI / 2);
      settleShot(run);
    }
    expect(run.events.some((e) => e.k === "earn" && e.special === WILD && e.why === "combo")).toBe(true);
  });

  it(`a drop of ${WILD_DROP} earns a registration mark, ${BOMB_DROP} an ink blot`, () => {
    for (const [n, special] of [
      [WILD_DROP, WILD],
      [BOMB_DROP, BOMB],
    ] as const) {
      const run = blank();
      pinkPair(run);
      CHAIN.slice(0, n).forEach(([r, c], i) => run.board.set(r, c, 2 + (i % 2)));
      run.fire(Math.PI / 2);
      settleShot(run);
      const drop = run.events.find((e) => e.k === "drop");
      expect(drop && drop.k === "drop" && drop.dots.length).toBe(n);
      expect(run.events.some((e) => e.k === "earn" && e.special === special)).toBe(true);
      expect(run.next).toBe(special);
    }
  });

  it("a clean sheet pays a bonus and the press feeds a fresh one", () => {
    const run = blank();
    pinkPair(run, false);
    run.fire(Math.PI / 2);
    settleShot(run);
    const clean = run.events.find((e) => e.k === "clean");
    expect(clean && clean.k === "clean" && clean.bonus).toBe(1000);
    expect(run.board.lowest()).toBe(CLEAN_ROWS - 1);
    expect(run.score).toBe(30 + 1000);
  });

  it("swapping trades the loaded ink for the next one", () => {
    const run = new Run(11);
    let guard = 0;
    while (run.current === run.next && guard++ < 50) run.next = (run.next + 1) % 4;
    const [a, b] = [run.current, run.next];
    expect(run.swap()).toBe(true);
    expect([run.current, run.next]).toEqual([b, a]);
  });
});
