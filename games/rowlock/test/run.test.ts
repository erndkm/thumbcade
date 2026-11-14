import { describe, expect, it } from "vitest";
import { Controls } from "../src/controls.ts";
import type { Puzzle } from "../src/gen.ts";
import { SHAPE_4, SHAPE_6 } from "../src/grid.ts";
import { multOf, Run, tierOf, TIERS, TUNE } from "../src/run.ts";

// A 4 × 4 and a 6 × 6 full grid to cut puzzles from (the run judges against the stored solution).
const S4 = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1];
const S6 = [
  1, 2, 3, 4, 5, 6, 4, 5, 6, 1, 2, 3, 2, 3, 1, 5, 6, 4, 5, 6, 4, 2, 3, 1, 3, 1, 2, 6, 4, 5, 6, 4, 5, 3, 1, 2,
];

function puzzle(solution: number[], blanks: number[], spark = -1): Puzzle {
  const n = solution.length === 16 ? 4 : 6;
  const givens = Int8Array.from(solution);
  for (const b of blanks) givens[b] = 0;
  return { shape: n === 4 ? SHAPE_4 : SHAPE_6, givens, solution: Int8Array.from(solution), spark, grade: 1, width: 1, empties: blanks.length, tries: 1 };
}

function started(grids: Puzzle[]) {
  const events: string[] = [];
  const run = new Run((i) => grids[Math.min(i, grids.length - 1)]!, {
    place: (_c, _d, streak, pts, up) => events.push(`place ${streak} ${pts}${up ? " up" : ""}`),
    wrong: (_c, _d, clashes, secs) => events.push(`wrong ${clashes.length} ${secs}`),
    lock: (units, pts, secs, _cell, final) => events.push(`lock ${units.length} ${pts} ${secs.toFixed(2)}${final ? " final" : ""}`),
    spark: (_c, lamp) => events.push(`spark ${lamp}`),
    solve: (i, pts, secs, clean) => events.push(`solve ${i} ${pts} ${secs} ${clean}`),
    lamp: (cell, d) => events.push(`lamp ${cell} ${d}`),
    marks: () => events.push("marks"),
    end: () => events.push("end"),
  }).start();
  run.step(TUNE.dealIn + 0.001);
  return { run, events };
}

describe("streak tiers", () => {
  it("multiplies ×1 to ×5 at 4, 9, 15 and 24 right digits in a row", () => {
    expect(TIERS).toEqual([0, 4, 9, 15, 24]);
    expect([0, 3, 4, 8, 9, 14, 15, 23, 24, 99].map(multOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(tierOf(24)).toBe(4);
  });
});

describe("a run", () => {
  it("deals, then plays: the clock stands still while a grid is dealt", () => {
    const run = new Run(() => puzzle(S4, [0, 5])).start();
    expect(run.phase).toBe("deal");
    run.step(TUNE.dealIn * 0.9);
    expect(run.clock).toBe(TUNE.start);
    run.step(TUNE.dealIn);
    expect(run.phase).toBe("play");
  });

  it("a right digit scores with the multiplier; a wrong one never sticks, costs time and resets the streak", () => {
    const { run, events } = started([puzzle(S4, [0, 5, 10, 15, 3, 12])]);
    expect(run.place(0, 1).ok).toBe(true);
    expect(events.at(-1)).toBe(`place 1 ${TUNE.digit}`);
    const clock = run.clock;
    // 2 is already in row 1 (key 7): a clash.
    const r = run.place(5, 2);
    // 2 is already in its row (key 7), column and box (key 1): it clashes with both.
    expect(r).toEqual({ ok: true, right: false, clashes: [1, 7] });
    expect(run.values[5]).toBe(0);
    expect(run.streak).toBe(0);
    // Inside the first seconds a slip costs only the grace second; later the warm-up costs 2 s and grids after it 3 s.
    expect(run.clock).toBeCloseTo(clock - TUNE.graceCost, 6);
    run.played = TUNE.grace;
    const c2 = run.clock;
    run.place(5, 3);
    expect(run.clock).toBeCloseTo(c2 - TUNE.wrong(0), 6);
    expect(TUNE.wrong(0)).toBeLessThan(TUNE.wrong(1));
    expect(run.stats.clashes).toBe(2);
    // Filled keys are refused and change nothing.
    expect(run.place(1, 2)).toEqual({ ok: false });
  });

  it("filling a unit locks it: it pays and gives time back; two units at once are a double lock", () => {
    // Blanks: key 3 (row 0, col 3) alone in row 0; keys 7 and 11 in column 3.
    const { run, events } = started([puzzle(S4, [3, 7, 11, 13])]);
    const clock = run.clock;
    run.place(3, 4); // closes row 0 and the top-right box (keys 2, 3, 6, 7? no: 7 is blank) → row only
    expect(events).toContain(`lock 1 ${TUNE.unit} ${TUNE.unitBack.toFixed(2)}`);
    expect(run.clock).toBeCloseTo(clock + TUNE.unitBack, 6);
    run.place(7, 2); // closes row 1 and the top-right box: a double
    expect(events.at(-1)).toBe(`lock 2 ${TUNE.unit * 2 + TUNE.combo[2]!} ${(TUNE.unitBack * 2).toFixed(2)}`);
    expect(run.stats.doubles).toBe(1);
  });

  it("three units with one digit before the grid is full earn a lamp", () => {
    // Key 0 closes row 0, column 0 and box 0 at once; keys 15 and 10 keep the grid open.
    const { run, events } = started([puzzle(S4, [0, 10, 15])]);
    run.place(0, 1);
    expect(events.find((e) => e.startsWith("lock"))).toBe(`lock 3 ${TUNE.unit * 3 + TUNE.combo[3]!} ${(TUNE.unitBack * 3).toFixed(2)}`);
    expect(run.lamps).toBe(1);
    expect(run.stats.triples).toBe(1);
  });

  it("the spark key pays 50 and a lamp (two held at most)", () => {
    const { run, events } = started([puzzle(S6, [0, 7, 14, 21, 28, 35], 7)]);
    run.lamps = TUNE.lampMax - 1;
    run.place(7, S6[7]!);
    expect(events).toContain("spark true");
    expect(run.lamps).toBe(TUNE.lampMax);
    expect(run.stats.sparks).toBe(1);
    expect(run.score).toBeGreaterThanOrEqual(TUNE.digit + TUNE.spark);
  });

  it("a lamp lights the selected key, or the hardest one, and never touches the streak", () => {
    const { run, events } = started([puzzle(S6, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]);
    run.place(0, 1);
    run.place(1, 2);
    expect(run.streak).toBe(2);
    expect(run.lamp()).toBeNull();
    run.lamps = 2;
    expect(run.lamp(3)).toBe(3);
    expect(run.values[3]).toBe(S6[3]);
    expect(run.streak).toBe(2);
    const cell = run.lamp();
    expect(cell).not.toBeNull();
    expect(run.values[cell!]).toBe(S6[cell!]);
    expect(run.lamps).toBe(0);
    expect(run.stats.lampsUsed).toBe(2);
    expect(events.filter((e) => e.startsWith("lamp"))).toHaveLength(2);
  });

  it("a filled grid refunds time, pays (more when clean), holds the clock, then deals the next grid", () => {
    const { run, events } = started([puzzle(S4, [0, 15]), puzzle(S6, [0, 1])]);
    run.place(0, 1);
    const clock = run.clock;
    run.place(15, 1);
    expect(events.at(-1)).toBe(`solve 0 ${TUNE.solve(0) + TUNE.clean} ${TUNE.solveBack(0)} true`);
    expect(run.phase).toBe("solved");
    const held = run.clock;
    expect(held).toBeGreaterThan(clock);
    run.step(TUNE.solvedOut * 0.9);
    expect(run.clock).toBe(held);
    run.step(TUNE.solvedOut);
    expect(run.phase).toBe("deal");
    expect(run.index).toBe(1);
    expect(run.n).toBe(6);
    expect(run.stats.solved).toBe(1);
  });

  it("a slip on a grid costs its clean bonus", () => {
    const { run, events } = started([puzzle(S4, [0, 15])]);
    run.place(0, 3);
    run.place(0, 1);
    run.place(15, 1);
    expect(events.at(-1)!.endsWith("false")).toBe(true);
  });

  it("time back never overfills the clock; later grids burn faster and refund less", () => {
    const { run } = started([puzzle(S4, [3, 7, 11, 15])]);
    run.clock = TUNE.max - 0.1;
    run.place(3, 4);
    expect(run.clock).toBeLessThanOrEqual(TUNE.max);
    expect(TUNE.drain(5)).toBeGreaterThan(TUNE.drain(1));
    expect(TUNE.solveBack(6)).toBeLessThan(TUNE.solveBack(1));
  });

  it("an idle run ends on its own once the clock runs out, between 20 and 35 seconds", () => {
    const { run, events } = started([puzzle(S4, [0, 1, 2, 3, 4, 5, 6, 7, 8])]);
    let t = TUNE.dealIn;
    while (!run.over && t < 120) {
      run.step(1 / 60);
      t += 1 / 60;
    }
    expect(events.at(-1)).toBe("end");
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(35);
    expect(run.place(0, 1)).toEqual({ ok: false });
  });

  it("idling nudges after 4 s and brings the pencil marks out after 8 s; a right digit resets it", () => {
    const { run, events } = started([puzzle(S4, [0, 1, 2, 3, 4, 5, 6, 7, 8])]);
    run.step(TUNE.nudgeAfter - 0.1);
    expect(run.nudging).toBe(false);
    run.step(0.2);
    expect(run.nudging).toBe(true);
    const p = run.nudge()!;
    expect(S4[p.cell]).toBe(p.digit);
    run.step(TUNE.marksAfter - TUNE.nudgeAfter);
    expect(run.marks).toBe(true);
    expect(events).toContain("marks");
    run.place(p.cell, p.digit);
    expect(run.nudging).toBe(false);
    expect(run.stats.nudges).toBe(1);
    expect(run.stats.marked).toBe(1);
  });

  it("nobody can lose in the first ten seconds, even tapping wrong digits every second", () => {
    const { run } = started([puzzle(S4, [0, 1, 2, 3, 4, 5, 6, 7, 8])]);
    for (let s = 0; s < 10; s++) {
      run.place(0, 2);
      for (let f = 0; f < 60; f++) run.step(1 / 60);
    }
    expect(run.over).toBe(false);
  });
});

describe("controls: a key and a digit, in either order", () => {
  function setup() {
    const { run } = started([puzzle(S4, [0, 5, 10, 15, 1])]);
    return { run, c: new Controls(() => run) };
  }

  it("key first: select a key, then its digit; a wrong digit keeps the key selected", () => {
    const { run, c } = setup();
    expect(c.tap({ kind: "key", cell: 0 })).toBe("select");
    // 3 is complete on this grid: the pad shrugs. 2 is still open, and wrong here.
    expect(c.tap({ kind: "pad", digit: 3 })).toBe("nope");
    expect(c.tap({ kind: "pad", digit: 2 })).toBe("wrong");
    expect(c.selected).toBe(0);
    expect(c.tap({ kind: "pad", digit: 1 })).toBe("right");
    expect(c.selected).toBeNull();
    expect(run.values[0]).toBe(1);
    expect(run.stats.keyFirst).toBe(1);
    expect(c.tap({ kind: "key", cell: 5 })).toBe("select");
    expect(c.tap({ kind: "key", cell: 5 })).toBe("deselect");
  });

  it("digit first: arm a digit, then every key it fits; tap it again to drop it", () => {
    const { run, c } = setup();
    expect(c.tap({ kind: "pad", digit: 4 })).toBe("arm");
    expect(c.tap({ kind: "key", cell: 0 })).toBe("wrong");
    expect(c.armed).toBe(4);
    expect(c.tap({ kind: "key", cell: 5 })).toBe("right");
    expect(c.armed).toBe(4);
    expect(run.stats.armed).toBe(1);
    expect(c.tap({ kind: "pad", digit: 4 })).toBe("disarm");
    expect(c.armed).toBeNull();
    // Armed again, the last 4 completes the digit and the pad drops it by itself.
    c.tap({ kind: "pad", digit: 4 });
    expect(c.tap({ kind: "key", cell: 10 })).toBe("right");
    expect(c.armed).toBeNull();
  });

  it("tapping a key that holds a digit arms that digit; a finished digit only shows itself", () => {
    const { run, c } = setup();
    expect(c.tap({ kind: "key", cell: 3 })).toBe("arm"); // a 4, with two still to place
    expect(c.armed).toBe(4);
    expect(c.tap({ kind: "key", cell: 2 })).toBe("peek"); // a 3: all four are in
    expect(c.armed).toBeNull();
    // Finish the 1s: keys 0 and 15 are the last two.
    c.tap({ kind: "pad", digit: 1 });
    c.tap({ kind: "key", cell: 0 });
    expect(c.tap({ kind: "key", cell: 15 })).toBe("right");
    expect(run.done(1)).toBe(true);
    // The armed 1 dropped itself when the last one went in.
    expect(c.armed).toBeNull();
    expect(c.tap({ kind: "key", cell: 0 })).toBe("peek");
    expect(c.tap({ kind: "pad", digit: 1 })).toBe("nope");
  });

  it("the lamp needs a lamp; with one it lights the selected key", () => {
    const { run, c } = setup();
    expect(c.tap({ kind: "lamp" })).toBe("nope");
    run.lamps = 1;
    c.tap({ kind: "key", cell: 10 });
    expect(c.tap({ kind: "lamp" })).toBe("lamp");
    expect(run.values[10]).toBe(S4[10]);
    expect(c.selected).toBeNull();
  });

  it("ignores taps while a grid is dealt or celebrated", () => {
    const run = new Run(() => puzzle(S4, [0])).start();
    const c = new Controls(() => run);
    expect(c.tap({ kind: "key", cell: 0 })).toBe("ignored");
  });
});
