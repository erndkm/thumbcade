import { describe, expect, it } from "vitest";
import { DAWN, dawnSpeed, Run, RULES, tierOf, type RunEvent } from "../src/run.ts";
import { CELL, colX, COLS, LEFT, type Kind, type Row } from "../src/world.ts";

const DT = 1 / 60;

function step(run: Run, seconds: number): RunEvent[] {
  const out: RunEvent[] = [];
  for (let s = 0; s < seconds - 1e-9; s += DT) {
    run.update(DT);
    out.push(...run.drain());
  }
  return out;
}

const tap = (run: Run) => {
  run.press();
  run.release();
};

/** Makes row i a lane of one kind with the given movers (left edges at time t, in field px). */
function lane(run: Run, i: number, kind: Kind, speed: number, dir: 1 | -1, at: Array<[number, number]>, t = run.t): Row {
  const row = run.row(i);
  row.kind = kind;
  row.speed = speed;
  row.dir = dir;
  row.period = 400;
  row.block = Array(COLS).fill(-1);
  row.pickup = null;
  row.movers = at.map(([x, len]) => ({ off: (((x - LEFT - dir * speed * t) % 400) + 400) % 400, len, v: 0 }));
  return row;
}

function path(run: Run, i: number): Row {
  const row = run.row(i);
  row.kind = "path";
  row.movers = [];
  row.block = Array(COLS).fill(-1);
  row.pickup = null;
  row.arch = false;
  return row;
}

/** A fresh run with a clear doorstep and the next few rows safe ground. */
function fresh(seed = 5): Run {
  const run = new Run(seed);
  for (let i = 0; i < 8; i++) path(run, i);
  return run;
}

describe("taps and swipes", () => {
  it("a press only crouches; the cat pads up on the release, in one hop", () => {
    const run = fresh();
    run.press();
    step(run, 0.3);
    expect(run.cat.row).toBe(RULES.startRow);
    expect(run.pressing).toBe(true);
    run.release();
    expect(run.hop?.kind).toBe("up");
    step(run, RULES.hop + DT);
    expect(run.cat.row).toBe(RULES.startRow + 1);
    expect(run.rows).toBe(1);
  });

  it("a press the feed takes over (a vertical swipe) never moves the cat", () => {
    const run = fresh();
    run.press();
    step(run, 0.05);
    run.cancel();
    run.release();
    step(run, 0.3);
    expect(run.cat.row).toBe(RULES.startRow);
    expect(run.stats.hops).toBe(0);
  });

  it("a sideways swipe sidesteps at once; the edge of the hill and things in the way bump", () => {
    const run = fresh();
    run.press();
    run.swipe(1);
    step(run, RULES.side + DT);
    expect(run.cat.x).toBe(colX(RULES.startCol + 1));
    run.cat.x = colX(COLS - 1);
    run.swipe(1);
    step(run, 0.2);
    expect(run.cat.x).toBe(colX(COLS - 1));
    expect(run.stats.bumps).toBe(1);
    // A pumpkin patch's pumpkin straight ahead: the cat boops it and stays put.
    path(run, 2).block[COLS - 1] = 0;
    tap(run);
    step(run, 0.2);
    expect(run.cat.row).toBe(RULES.startRow);
    expect(run.stats.bumps).toBe(2);
  });

  it("a tap during a hop is kept and played the moment the cat lands", () => {
    const run = fresh();
    tap(run);
    step(run, 0.05);
    tap(run);
    step(run, 0.4);
    expect(run.cat.row).toBe(RULES.startRow + 2);
  });
});

describe("bumps, soakings and the escape", () => {
  it("a broom bumps the cat back to the last safe ground: dazed, then nothing can bump it for a moment", () => {
    const run = fresh();
    // A broom sweeping left that reaches the cat's column just after it lands in the lane.
    const x = colX(RULES.startCol);
    lane(run, 2, "broom", 60, -1, [[x + 12, 26]]);
    tap(run);
    const ev = step(run, 0.6);
    const fail = ev.find((e) => e.type === "fail");
    expect(fail && fail.type === "fail" && fail.kind).toBe("bonk");
    expect(fail && fail.type === "fail" && fail.toRow).toBe(RULES.startRow);
    step(run, RULES.knock);
    expect(run.cat.row).toBe(RULES.startRow);
    expect(run.cat.state).toBe("ok");
    expect(run.cat.invuln).toBeGreaterThan(0.5);
    expect(run.stats.bonks.broom).toBe(1);
    // While dazed, taps do nothing.
    run.cat.stun = 0.2;
    tap(run);
    expect(run.hop).toBeNull();
  });

  it("a bump that lands while a finger is already down waits for the release: hop away in time and it never happened", () => {
    const run = fresh();
    const x = colX(RULES.startCol);
    tap(run);
    step(run, RULES.hop + DT);
    // The cat stands in a broom lane; a broom is about to reach it.
    lane(run, 2, "broom", 60, -1, [[x + CELL / 2 - 1, 26]]);
    run.press();
    // It touches the cat ~0.08 s in; the finger is still down, so the bump waits.
    const ev = step(run, 0.12);
    expect(ev.some((e) => e.type === "fail")).toBe(false);
    run.release();
    const ev2 = step(run, 0.4);
    expect(ev2.some((e) => e.type === "fail")).toBe(false);
    expect(run.cat.row).toBe(3);
    expect(run.stats.escapes).toBe(1);
    expect(ev2.some((e) => e.type === "whisker" && e.escape)).toBe(true);
  });

  it("...but a finger held too long gets bumped after the grace", () => {
    const run = fresh();
    const x = colX(RULES.startCol);
    tap(run);
    step(run, RULES.hop + DT);
    lane(run, 2, "broom", 60, -1, [[x + CELL / 2 - 1, 26]]);
    run.press();
    const ev = step(run, RULES.defer + 0.1);
    expect(ev.some((e) => e.type === "fail")).toBe(true);
  });

  it("the brook: a boat carries the cat, a near miss scrambles aboard, open water is a splash", () => {
    const run = fresh();
    const x = colX(RULES.startCol);
    lane(run, 2, "brook", 20, 1, [[x - 10, 28]]);
    tap(run);
    step(run, RULES.hop + DT);
    expect(run.cat.row).toBe(2);
    const x0 = run.cat.x;
    step(run, 0.5);
    expect(run.cat.x).toBeCloseTo(x0 + 20 * 0.5, 0);
    // Scramble: the next boat's end is a few px off where the cat lands.
    const run2 = fresh();
    lane(run2, 2, "brook", 1, 1, [[x + 5, 28]]);
    tap(run2);
    const ev = step(run2, 0.3);
    expect(ev.some((e) => e.type === "scramble")).toBe(true);
    expect(ev.some((e) => e.type === "fail")).toBe(false);
    // Open water.
    const run3 = fresh();
    lane(run3, 2, "brook", 20, 1, [[x + 40, 28]]);
    tap(run3);
    const ev3 = step(run3, 0.3);
    expect(ev3.some((e) => e.type === "fail" && e.kind === "splash")).toBe(true);
  });

  it("a boat carries the cat to the edge of the hill and slides out from under it", () => {
    const run = fresh();
    lane(run, 2, "brook", 40, 1, [[colX(COLS - 1) - 30, 28]]);
    run.cat.x = colX(COLS - 1) - 16;
    tap(run);
    const ev = step(run, 2.5);
    expect(ev.some((e) => e.type === "edge")).toBe(true);
    expect(ev.some((e) => e.type === "fail" && e.kind === "splash")).toBe(true);
  });

  it("the bog: a toadstool with its cap up holds the cat; a sunk one is a glug", () => {
    const run = fresh();
    const row = run.row(2);
    row.kind = "bog";
    row.cycle = 4;
    row.up = 2.4;
    row.toads = Array.from({ length: COLS }, (_, col) => ({ col, phase: 0 }));
    tap(run);
    step(run, 0.3);
    expect(run.cat.row).toBe(2);
    expect(run.stats.sinks).toBe(0);
    // It sinks once the cap goes down (2.4 s into its cycle).
    const ev = step(run, 2.4);
    expect(ev.some((e) => e.type === "fail" && e.kind === "sink")).toBe(true);
  });
});

describe("the run economy", () => {
  it("each new row pays 10 times the zoomies tier; quick hops build x2 at 6, x3 at 15, x4 at 30", () => {
    expect([0, 5, 6, 14, 15, 29, 30].map(tierOf)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    const run = fresh();
    for (let i = 0; i < 40; i++) path(run, i);
    const tiers: number[] = [];
    let score = 0;
    for (let i = 0; i < 31; i++) {
      tap(run);
      for (const e of step(run, 0.2)) if (e.type === "tier") tiers.push(e.tier);
      score += RULES.rowPts * tierOf(i + 1 >= 6 ? i + 1 : 0) + RULES.rowPts;
    }
    expect(tiers).toEqual([1, 2, 3]);
    expect(run.stats.maxTier).toBe(3);
    expect(run.score).toBe(score);
    // Waiting longer than the grace lets the zoomies cool.
    const ev = step(run, RULES.streakGrace + 0.1);
    expect(ev.some((e) => e.type === "cool")).toBe(true);
    expect(run.mult).toBe(1);
  });

  it("whisker-close: a broom sweeping through the spot the cat just left pays and keeps the zoomies", () => {
    const run = fresh();
    const x = colX(RULES.startCol);
    tap(run);
    step(run, RULES.hop + DT);
    // In the lane; a broom 10 px off and closing. Hop on, it sweeps through behind.
    lane(run, 2, "broom", 70, -1, [[x + 16, 26]]);
    tap(run);
    const ev = step(run, 0.4);
    const w = ev.find((e) => e.type === "whisker");
    expect(w && w.type === "whisker" && w.points).toBe(RULES.whiskerPts);
    expect(ev.some((e) => e.type === "fail")).toBe(false);
  });

  it("fish pay; every fifth brings the witch, who lifts the cat six rows up to safe ground, paying each row", () => {
    const run = fresh();
    for (let i = 0; i < 20; i++) path(run, i);
    for (let i = 2; i <= 6; i++) run.row(i).pickup = { col: RULES.startCol, gold: false, mover: -1 };
    let lift = 0;
    let rowsPaid = 0;
    for (let i = 0; i < 5; i++) {
      tap(run);
      for (const e of step(run, 0.3)) {
        if (e.type === "lift") lift = e.toRow;
      }
    }
    expect(run.fish).toBe(5);
    expect(lift).toBeGreaterThanOrEqual(6 + RULES.liftRows);
    expect(run.cat.state).toBe("lift");
    for (const e of step(run, RULES.liftTime + 0.1)) if (e.type === "liftRow") rowsPaid++;
    expect(run.cat.row).toBe(lift);
    expect(rowsPaid).toBe(lift - 6);
    expect(run.basket).toBe(0);
    expect(run.row(run.cat.row).kind).toBe("path");
  });

  it("a new stretch of scenery pays 150 times its number", () => {
    const run = fresh();
    for (let i = 0; i < 30; i++) path(run, i);
    run.row(25).arch = true;
    const ev: RunEvent[] = [];
    for (let i = 0; i < 25; i++) {
      tap(run);
      ev.push(...step(run, 0.2));
    }
    const s = ev.find((e) => e.type === "stretch");
    expect(s && s.type === "stretch" && s.points).toBe(RULES.stretchPts);
    expect(s && s.type === "stretch" && s.name).toBe("the night market");
    expect(ev.filter((e) => e.type === "milestone").map((e) => (e as { rows: number }).rows)).toEqual([10, 20]);
  });

  it("passing your best row says so", () => {
    const run = fresh();
    run.bestRows = 3;
    for (let i = 0; i < 12; i++) path(run, i);
    const ev: RunEvent[] = [];
    for (let i = 0; i < 5; i++) {
      tap(run);
      ev.push(...step(run, 0.2));
    }
    expect(ev.filter((e) => e.type === "bestRow")).toHaveLength(1);
  });
});

describe("first light", () => {
  it("holds still for a moment, then climbs faster and faster", () => {
    expect(dawnSpeed(0)).toBe(0);
    expect(dawnSpeed(RULES.grace + 0.01)).toBeCloseTo(DAWN.base, 2);
    expect(dawnSpeed(60)).toBeGreaterThan(dawnSpeed(30));
    expect(dawnSpeed(110)).toBeGreaterThan(dawnSpeed(60) * 1.4);
  });

  it("ends an idle run on its own after about 20 s", () => {
    const run = new Run(9);
    let t = 0;
    while (!run.over && run.t < 60) {
      run.update(DT);
      for (const e of run.drain()) if (e.type === "over") t = run.t;
    }
    expect(t).toBeGreaterThan(17);
    expect(t).toBeLessThan(24);
    expect(run.stats.caughtWaiting).toBe(true);
  });

  it("is never more than six and a half rows behind, and gains on the cat while it tumbles", () => {
    const run = fresh();
    for (let i = 0; i < 40; i++) path(run, i);
    for (let i = 0; i < 25; i++) {
      tap(run);
      step(run, 0.15);
    }
    expect(run.gap).toBeLessThanOrEqual(RULES.leash + 1e-6);
    step(run, 13 - run.t);
    const before = run.dawn;
    lane(run, run.cat.row + 1, "broom", 60, -1, [[run.cat.x + 12, 26]]);
    tap(run);
    step(run, 0.4);
    expect(run.dawn - before).toBeGreaterThan(DAWN.fumble - 0.1);
  });

  it("nothing costs a fumble in the first 12 s", () => {
    const run = fresh();
    const before = run.dawn;
    lane(run, 2, "broom", 60, -1, [[colX(RULES.startCol) + 12, 26]]);
    tap(run);
    step(run, 0.5);
    expect(run.stats.bonks.broom).toBe(1);
    expect(run.dawn - before).toBeLessThan(0.01);
  });

  it("when it reaches the cat the night is over, and the run stops listening", () => {
    const run = new Run(3);
    const ev = step(run, 30);
    expect(ev.filter((e) => e.type === "over")).toHaveLength(1);
    expect(run.over).toBe(true);
    tap(run);
    step(run, 0.5);
    expect(run.stats.hops).toBe(0);
  });
});

describe("determinism", () => {
  it("the same seed and the same taps at the same times play out the same", () => {
    const play = () => {
      const run = new Run(77);
      let k = 0;
      while (!run.over && run.t < 120) {
        if (k % 23 === 0) tap(run);
        if (k % 61 === 30) run.swipe(k % 2 ? 1 : -1);
        run.update(DT);
        run.drain();
        k++;
      }
      return [run.t, run.score, run.rows, run.stats.hops, run.stats.splashes, JSON.stringify(run.stats.bonks)];
    };
    expect(play()).toEqual(play());
  });
});
