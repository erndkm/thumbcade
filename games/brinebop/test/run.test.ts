import { createRng } from "@thumbcade-games/kit/rng";
import { claims, gestureConfigFor } from "@thumbcade/swipe-contract";
import { describe, expect, it } from "vitest";
import manifest from "../thumbcade.json" with { type: "json" };
import { Board, idx } from "../src/board.ts";
import { BONUS_CAP, CLOCK, FRENZY_MULT, FRENZY_SPECIALS, FRENZY_T, Run, type RunEvent } from "../src/run.ts";
import { chooseMove, median, simulate, SKILLS } from "../src/sim.ts";

function stepFor(run: Run, seconds: number): RunEvent[] {
  const out: RunEvent[] = [];
  for (let t = 0; t < seconds && run.phase !== "done"; t += 1 / 60) {
    run.step(1 / 60);
    out.push(...run.events);
    run.events.length = 0;
  }
  return out;
}

describe("a run", () => {
  it("counts the clock down and stops swaps when it runs out", () => {
    const run = new Run(createRng(1));
    expect(run.clock).toBe(CLOCK);
    stepFor(run, 10);
    expect(run.clock).toBeCloseTo(CLOCK - 10, 1);
    run.clock = 0.01;
    const ev = stepFor(run, 0.1);
    expect(ev.some((e) => e.type === "timeup")).toBe(true);
    const m = run.board.findMoves()[0];
    if (m) expect(run.swap(m.from, m.to)).toBe(false);
  });

  it("starts the frenzy in the last seconds: specials appear and points double", () => {
    const run = new Run(createRng(2));
    run.clock = FRENZY_T + 0.05;
    const ev = stepFor(run, 0.2);
    const f = ev.find((e) => e.type === "frenzy");
    expect(f && f.type === "frenzy" && f.cells.length).toBe(FRENZY_SPECIALS);
    expect(run.frenzy).toBe(true);
    expect(run.board.specials().length).toBeGreaterThanOrEqual(FRENZY_SPECIALS);
    expect(run.mult).toBe(FRENZY_MULT);
  });

  it("cashes out every special left on the board, one by one, at rising multipliers", () => {
    const run = new Run(createRng(3));
    stepFor(run, 1);
    // Plant three specials and run the clock out.
    const spots = [idx(1, 2), idx(5, 4), idx(2, 7)];
    for (const i of spots) run.board.makeSpecial(i, "bomb");
    run.clock = 0.02;
    const before = run.score;
    const ev = stepFor(run, 40);
    const cash = ev.filter((e) => e.type === "cash");
    expect(cash.length).toBeGreaterThanOrEqual(3);
    expect(cash.map((c) => c.type === "cash" && c.mult)).toEqual(cash.map((_, i) => i + 2));
    expect(run.phase).toBe("done");
    expect(ev.at(-1)).toMatchObject({ type: "done" });
    expect(run.score).toBeGreaterThan(before);
    expect(run.board.specials()).toEqual([]);
  });

  it("caps the bonus time", () => {
    const run = new Run(createRng(4));
    // An expert-ish loop for a long time: bonus never passes the cap.
    for (let t = 0; t < 120 && run.phase === "play"; t += 1 / 60) {
      const m = chooseMove(run.board.findMoves(), 1, Math.random);
      if (m && Math.random() < 0.05) run.swap(m.from, m.to);
      run.step(1 / 60);
      run.events.length = 0;
    }
    expect(run.stats.bonusTime).toBeLessThanOrEqual(BONUS_CAP);
  });

  it("is deterministic for a seed", () => {
    const a = simulate(77, SKILLS[2]!);
    const b = simulate(77, SKILLS[2]!);
    expect(a.score).toBe(b.score);
    expect(a.seconds).toBe(b.seconds);
  });
});

describe("headless playtests", () => {
  it("lands every skill level in a 20-90 s run, and better play scores more", () => {
    let last = 0;
    for (const skill of SKILLS) {
      const res = Array.from({ length: 12 }, (_, i) => simulate(500 + i * 131, skill));
      const secs = res.map((r) => r.seconds);
      expect(Math.min(...secs)).toBeGreaterThanOrEqual(20);
      expect(Math.max(...secs)).toBeLessThanOrEqual(90);
      const score = median(res.map((r) => r.score));
      expect(score).toBeGreaterThan(last);
      last = score;
    }
  });
});

describe("Swipe Contract", () => {
  it("declares vertical play, so a drag on the pool never moves the feed", () => {
    expect(manifest.controls.vertical).toBe(true);
    expect(gestureConfigFor("PLAYING", manifest.controls).surfacePan.enabled).toBe(false);
    expect(gestureConfigFor("PREVIEW", manifest.controls).surfacePan.enabled).toBe(true);
    // A 220 pt upward drag: the feed takes it in PREVIEW, never in PLAYING; the Dock always can.
    expect(claims(gestureConfigFor("PLAYING", manifest.controls).surfacePan, 0, -220)).toBe(false);
    expect(claims(gestureConfigFor("PREVIEW", manifest.controls).surfacePan, 0, -220)).toBe(true);
    expect(claims(gestureConfigFor("PLAYING", manifest.controls).dockPan, 0, -220)).toBe(true);
  });

  it("never leaves the board without a way to play", () => {
    for (let seed = 1; seed < 40; seed++) expect(new Board(createRng(seed)).hasMove()).toBe(true);
  });
});
