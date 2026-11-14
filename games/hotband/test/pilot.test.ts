import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { DEMO, judge, Pilot, playRun, SKILLS, spots } from "../src/pilot.ts";
import { COLS } from "../src/pieces.ts";
import { Run } from "../src/run.ts";
import { at, newWell, SIGNAL } from "../src/well.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const play = (name: keyof typeof SKILLS, n: number) => {
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) runs.push(playRun(new Run(1000 + i * 7919), new Pilot(SKILLS[name]!, createRng(9000 + i))));
  return runs;
};

describe("pilots", () => {
  it("prefer a flat, low meter without covered gaps", () => {
    const flat = newWell();
    for (let x = 0; x < 4; x++) flat[at(x, 17)] = SIGNAL;
    const tall = newWell();
    for (let y = 14; y < 18; y++) tall[at(0, y)] = SIGNAL;
    const holey = newWell();
    for (let x = 0; x < 4; x++) holey[at(x, 16)] = SIGNAL;
    expect(judge(flat)).toBeGreaterThan(judge(tall));
    expect(judge(flat)).toBeGreaterThan(judge(holey));
  });

  it("see every resting place of a piece, and value the one that cuts a row most", () => {
    const run = new Run(7).start();
    run.step(1 / 60);
    for (let x = 3; x < COLS; x++) run.well[at(x, 17)] = SIGNAL;
    const all = spots(run);
    // The bar flat in 6 places, upright in 8 (twice each, one per matching rotation).
    expect(all.length).toBe(2 * (6 + 8));
    const best = all.reduce((a, b) => (b.value > a.value ? b : a));
    expect(best).toMatchObject({ x: 0, y: 16 });
    expect(best.rot % 2).toBe(0);
  });

  it("the demo player cuts rows steadily and never misplaces on purpose", () => {
    expect(DEMO.blunder).toBe(0);
    const run = new Run(321).start();
    const pilot = new Pilot(DEMO, createRng(5));
    for (let t = 0; t < 30 && !run.over; t += 1 / 60) {
      pilot.update(run, 1 / 60);
      run.step(1 / 60);
    }
    expect(run.over).toBe(false);
    expect(run.stats.rows).toBeGreaterThanOrEqual(5);
  });

  it("run lengths sit in their bands and climb with skill; nobody is out in the first ten seconds", () => {
    const bands: Record<string, [number, number]> = { novice: [48, 68], casual: [58, 74], good: [66, 82], expert: [78, 94] };
    const medians: number[] = [];
    const scores: number[] = [];
    for (const name of ["novice", "casual", "good", "expert"] as const) {
      const runs = play(name, 60);
      const secs = runs.map((r) => r.stats.seconds);
      const m = median(secs);
      expect(m, name).toBeGreaterThanOrEqual(bands[name]![0]);
      expect(m, name).toBeLessThanOrEqual(bands[name]![1]);
      expect(Math.min(...secs), name).toBeGreaterThan(10);
      expect(Math.max(...secs), name).toBeLessThan(125);
      medians.push(m);
      scores.push(median(runs.map((r) => r.score)));
    }
    for (let i = 1; i < medians.length; i++) {
      expect(medians[i]!).toBeGreaterThan(medians[i - 1]!);
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]! * 1.5);
    }
  });

  it("everyone gets rewarded: a novice cuts a few rows, an expert reaches the top gain", () => {
    const novice = play("novice", 40);
    expect(median(novice.map((r) => r.stats.rows))).toBeGreaterThanOrEqual(3);
    const expert = play("expert", 40);
    expect(median(expert.map((r) => r.stats.bestGain))).toBeGreaterThanOrEqual(4);
    expect(median(expert.map((r) => r.stats.rows))).toBeGreaterThanOrEqual(30);
    // A reward at least every few seconds for a good player.
    const good = play("good", 40);
    expect(median(good.map((r) => r.stats.seconds / Math.max(1, r.stats.rows)))).toBeLessThan(5.5);
  });
});
