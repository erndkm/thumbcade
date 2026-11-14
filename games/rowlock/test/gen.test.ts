import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { dailyGrid, deal, DealJob, Dealer, gridSeed, specFor, type Puzzle } from "../src/gen.ts";
import { countSolutions, geometry } from "../src/grid.ts";
import { solve, TECH } from "../src/solver.ts";

/**
 * Every dealt grid must have exactly one solution and be solvable by logic alone, at the grade its place in the run
 * asks for. These run the dealer over many seeds per grid index.
 */
const COUNTS = [400, 400, 400, 300, 150, 60];

function checkGrid(p: Puzzle, index: number) {
  const g = geometry(p.shape);
  expect(countSolutions(g, p.givens, 2)).toBe(1);
  const r = solve(g, p.givens);
  expect(r.solved).toBe(true);
  expect(Array.from(r.values)).toEqual(Array.from(p.solution));
  for (let i = 0; i < g.cells; i++) if (p.givens[i]) expect(p.givens[i]).toBe(p.solution[i]);
  const spec = specFor(index);
  expect(p.shape).toBe(spec.shape);
  expect(p.empties).toBeLessThanOrEqual(spec.empties);
  if (spec.spark) {
    expect(p.spark).toBeGreaterThanOrEqual(0);
    expect(p.givens[p.spark]).toBe(0);
  } else expect(p.spark).toBe(-1);
}

describe("dealing", () => {
  for (let index = 0; index < COUNTS.length; index++) {
    it(`grid ${index + 1}: ${COUNTS[index]} deals, each unique, logic-solvable and graded`, () => {
      const spec = specFor(index);
      let meets = 0;
      const empties: number[] = [];
      for (let s = 0; s < COUNTS[index]!; s++) {
        const p = deal(spec, createRng(gridSeed(31 + s * 977, index)));
        checkGrid(p, index);
        if (p.grade >= spec.minTech) meets++;
        empties.push(p.empties);
      }
      // The grade target is met nearly always (the stretch grids fall back to the hardest dig they found).
      expect(meets / COUNTS[index]!).toBeGreaterThanOrEqual(index >= 5 ? 0.85 : 0.95);
      empties.sort((a, b) => a - b);
      expect(empties[Math.floor(empties.length / 2)]).toBeGreaterThanOrEqual(spec.empties - 1);
    }, 120_000);
  }

  it("grids get harder through a run: more empty keys and harder techniques", () => {
    const meanGrade = (i: number) => {
      let sum = 0;
      for (let s = 0; s < 40; s++) sum += deal(specFor(i), createRng(gridSeed(s, i))).grade;
      return sum / 40;
    };
    expect(specFor(0).shape.n).toBe(4);
    for (let i = 1; i < 6; i++) expect(specFor(i).shape.n).toBe(6);
    for (let i = 2; i < 6; i++) expect(specFor(i).empties).toBeGreaterThan(specFor(i - 1).empties);
    expect(meanGrade(5)).toBeGreaterThanOrEqual(TECH.nakedSingle - 0.2);
    expect(meanGrade(4)).toBeGreaterThanOrEqual(TECH.hiddenLine - 0.1);
    expect(meanGrade(1)).toBeLessThan(TECH.hiddenLine);
  }, 60_000);

  it("is deterministic: the same seed deals the same grid, however the work is split over frames", () => {
    for (const index of [1, 4, 5]) {
      const a = deal(specFor(index), createRng(gridSeed(99, index)));
      const job = new DealJob(specFor(index), createRng(gridSeed(99, index)));
      let t = 0;
      let frames = 0;
      // A fake clock that runs out after every dig: one dig per "frame".
      let p = job.work(0.5, () => (t += 1));
      while (!p) {
        frames++;
        p = job.work(0.5, () => (t += 1));
      }
      expect(frames + 1).toBe(p.tries);
      expect(Array.from(p.givens)).toEqual(Array.from(a.givens));
      expect(p.spark).toBe(a.spark);
    }
  });

  it("today's grid is the same 4 × 4 for everyone, and another day's is different", () => {
    const a = dailyGrid(12345);
    expect(Array.from(dailyGrid(12345).givens)).toEqual(Array.from(a.givens));
    expect(a.shape.n).toBe(4);
    const others = [1, 2, 3, 4, 5].map((d) => Array.from(dailyGrid(12345 + d).givens).join(""));
    expect(new Set(others).size).toBeGreaterThan(3);
    // The run's own seed never changes grid 1.
    expect(Array.from(new Dealer(1, 12345).get(0).givens)).toEqual(Array.from(new Dealer(2, 12345).get(0).givens));
    expect(Array.from(new Dealer(1, 12345).get(1).givens)).not.toEqual(Array.from(new Dealer(2, 12345).get(1).givens));
  });

  it("deals fast enough for a mid-range phone (taken as 4× slower than this machine): measured per grid and per dig", () => {
    const times: number[][] = [];
    for (let index = 0; index < 6; index++) {
      const ts: number[] = [];
      for (let s = 0; s < (index >= 5 ? 40 : 80); s++) {
        const t0 = performance.now();
        deal(specFor(index), createRng(gridSeed(7 + s, index)));
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      times.push(ts);
    }
    // A single dig (the unit of work the game does per frame) stays far below a frame, even at 4×.
    const one = new DealJob(specFor(5), createRng(5));
    let digs = 0;
    const t0 = performance.now();
    for (let k = 0; k < 50; k++) {
      one.work(0, () => 0);
      digs++;
      if (one.done) break;
    }
    const perDig = (performance.now() - t0) / digs;
    // The game deals one dig at a time between frames (Dealer.pump), so the cost that matters is one dig: at 4×
    // it must stay far from a 50 ms long task, even on a loaded machine.
    expect(perDig * 4).toBeLessThan(25);
    // The warm-up (today's grid, dealt in one go when a run starts) is a single dig.
    expect(times[0]![Math.floor(times[0]!.length * 0.9)]! * 4).toBeLessThan(25);
    console.log(
      "deal ms p50/p90/max per grid:",
      times.map((t, i) => `${i + 1}: ${t[t.length >> 1]!.toFixed(1)}/${t[Math.floor(t.length * 0.9)]!.toFixed(1)}/${t.at(-1)!.toFixed(1)}`).join("  "),
      ` per dig ${perDig.toFixed(2)} ms`,
    );
  }, 60_000);
});
