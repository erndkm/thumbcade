import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { DemoPilot, landings, simulate, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("pilots", () => {
  it("every skill level plays runs of 20–100 s and nobody jams in the first 10 s", () => {
    for (const skill of SKILLS) {
      const res = Array.from({ length: 10 }, (_, i) => simulate(500 + i * 104729, skill));
      const m = median(res.map((r) => r.seconds));
      expect(m, skill.name).toBeGreaterThan(20);
      expect(m, skill.name).toBeLessThan(100);
      expect(res.some((r) => r.early), skill.name).toBe(false);
    }
  }, 60_000);

  it("better players last longer and score more", () => {
    const novice = Array.from({ length: 10 }, (_, i) => simulate(900 + i * 7919, SKILLS[0]!));
    const expert = Array.from({ length: 10 }, (_, i) => simulate(900 + i * 7919, SKILLS[3]!));
    expect(median(expert.map((r) => r.seconds))).toBeGreaterThan(median(novice.map((r) => r.seconds)));
    expect(median(expert.map((r) => r.score))).toBeGreaterThan(median(novice.map((r) => r.score)) * 2);
  }, 60_000);

  it("an idle player is jammed inside 25 s", () => {
    for (let i = 0; i < 5; i++) expect(simulate(77 + i, null).seconds).toBeLessThan(25);
  });

  it("aims at the middle of each landing window", () => {
    const run = new Run(21);
    const opts = landings(run.board, run.current, true);
    expect(opts.length).toBeGreaterThan(5);
    for (const o of opts) expect(run.board.trace(o.angle).cell).toEqual(o.cell);
  });

  it("the attract demo lines up, fires and keeps playing", () => {
    const run = new Run(31, { demo: true });
    const demo = new DemoPilot(createRng(3));
    let shots = 0;
    for (let i = 0; i < 60 * 20; i++) {
      if (demo.step(run, 1 / 60)) shots++;
      run.step(1 / 60);
    }
    expect(shots).toBeGreaterThan(6);
    expect(run.stats.popShots).toBeGreaterThan(2);
  });
});
