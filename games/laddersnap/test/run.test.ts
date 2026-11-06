import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { Dealer, DRAW, plays, solve, type Checked, type Deal } from "../src/deal.ts";
import { act, Pilot, SKILLS } from "../src/pilot.ts";
import { multOf, Run, tierOf, TUNE } from "../src/run.ts";

const hand = (d: Deal): Checked => ({ deal: d, solution: solve(d) ?? { draws: 0, moves: [] }, luck: 1 });

/** Ranks (0 = ace): columns [1 under 2] and [3 under 4], pile 3, stock [8, 5]. */
const tiny: Deal = { shape: { cols: 2, depth: 2, stock: 2 }, cols: [[1, 2], [3, 4]], pile: 3, stock: [8, 5] };

function started(source: (i: number) => Checked = () => hand(tiny)) {
  const events: string[] = [];
  const run = new Run(source, {
    play: (_c, _card, streak, pts, up) => events.push(`play ${streak} ${pts}${up ? " up" : ""}`),
    draw: () => events.push("draw"),
    column: () => events.push("column"),
    clear: (_h, pts, secs, stock) => events.push(`clear ${pts} ${secs} ${stock}`),
    stall: (left) => events.push(`stall ${left}`),
    end: () => events.push("end"),
  }).start();
  run.step(TUNE.dealIn + 0.01);
  return { run, events };
}

describe("streak tiers", () => {
  it("multiplies by tier", () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 11, 12, 30].map(multOf)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(tierOf(12)).toBe(4);
  });
});

describe("a run", () => {
  it("deals, then plays: the clock stands still while the hand is dealt", () => {
    const run = new Run(() => hand(tiny)).start();
    expect(run.phase).toBe("deal");
    run.step(TUNE.dealIn * 0.5);
    expect(run.clock).toBe(TUNE.start);
    run.step(TUNE.dealIn);
    expect(run.phase).toBe("play");
  });

  it("refuses a card that isn't one up or one down, and changes nothing", () => {
    const { run } = started();
    // Exposed: 2 (col 0) and 4 (col 1) on a 3: both go. After the 4, the pile is 4 and the 2 no longer goes.
    expect(run.play(1)).toBe(true);
    const before = run.score;
    expect(run.play(0)).toBe(false);
    expect(run.score).toBe(before);
  });

  it("scores plays with the streak multiplier, empties columns for time, and clears the hand", () => {
    const { run, events } = started();
    run.play(0); // 2 onto 3
    run.play(0); // 1 onto 2, empties column 0
    expect(events).toContain("column");
    expect(run.clock).toBeCloseTo(TUNE.start - 0 + TUNE.columnBack, 5);
    expect(run.play(1)).toBe(false); // 4 doesn't go on 1
    expect(run.streak).toBe(2);
    run.draw(); // 8
    expect(run.streak).toBe(0);
    expect(events).toContain("draw");
    expect(run.stock).toBe(1);
    run.draw(); // 5: now the 4 goes
    expect(run.play(1)).toBe(true);
    expect(run.play(1)).toBe(true); // 3 onto 4: cleared
    expect(run.phase).toBe("clear");
    expect(events.at(-1)).toBe(`clear ${TUNE.clear} ${TUNE.clearBack(0)} 0`);
  });

  it("a stuck hand is swept away and the next one is dealt", () => {
    const stuck: Deal = { shape: { cols: 1, depth: 2, stock: 1 }, cols: [[7, 7 + 13]], pile: 1, stock: [3] };
    let n = 0;
    const { run, events } = started(() => (n++ === 0 ? hand(stuck) : hand(tiny)));
    run.draw();
    expect(run.phase).toBe("stall");
    expect(events).toContain("stall 2");
    expect(run.streak).toBe(0);
    run.step(TUNE.stallOut + 0.01);
    expect(run.phase).toBe("deal");
    expect(run.hand).toBe(1);
  });

  it("ends when the clock runs out, and the clock burns faster on later hands", () => {
    expect(TUNE.drain(4)).toBeGreaterThan(TUNE.drain(0));
    const { run, events } = started();
    for (let i = 0; i < 60 * 40 && !run.over; i++) run.step(1 / 60);
    expect(run.over).toBe(true);
    expect(events.at(-1)).toBe("end");
    expect(run.play(0)).toBe(false);
  });

  it("time bought back never overfills the clock", () => {
    const { run } = started();
    run.clock = TUNE.max - 0.5;
    run.play(0);
    run.play(0);
    expect(run.clock).toBeLessThanOrEqual(TUNE.max);
  });
});

describe("pilots", () => {
  it("measured runs land inside 20-90 s at every skill", () => {
    for (const skill of Object.values(SKILLS)) {
      const secs: number[] = [];
      for (let i = 0; i < 12; i++) {
        const dealer = new Dealer(createRng(300 + i));
        const pilot = new Pilot(skill, createRng(700 + i));
        const run = new Run((k) => dealer.get(k)).start();
        for (let f = 0; f < 200 * 60 && !run.over; f++) {
          run.step(1 / 60);
          act(run, pilot.update(run, 1 / 60));
        }
        secs.push(run.stats.seconds);
      }
      secs.sort((a, b) => a - b);
      const median = secs[secs.length >> 1]!;
      expect(median).toBeGreaterThanOrEqual(20);
      expect(median).toBeLessThanOrEqual(90);
    }
  }, 60_000);

  it("nobody can lose in the first ten seconds", () => {
    const run = new Run((k) => new Dealer(createRng(5)).get(k)).start();
    for (let f = 0; f < 600; f++) run.step(1 / 60);
    expect(run.over).toBe(false);
    expect(run.clock).toBeGreaterThan(15);
  });

  it("a pilot's moves are always legal", () => {
    const dealer = new Dealer(createRng(42));
    const pilot = new Pilot(SKILLS.casual, createRng(1));
    const run = new Run((k) => dealer.get(k)).start();
    for (let f = 0; f < 60 * 60 && !run.over; f++) {
      run.step(1 / 60);
      const m = pilot.update(run, 1 / 60);
      if (m === null) continue;
      if (m === DRAW) expect(run.canDraw).toBe(true);
      else expect(plays(run.deal, run.pos)).toContain(m);
      act(run, m);
    }
  });
});
