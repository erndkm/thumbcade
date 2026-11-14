import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { DEMO, Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const play = (name: keyof typeof SKILLS, n: number) => {
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) runs.push(playRun(new Run(1000 + i * 7919), new Pilot(SKILLS[name]!, createRng(9000 + i))));
  return runs;
};

describe("pilots", () => {
  it("the demo player never bumps and always sees the witch's cat out last", () => {
    const run = new Run(321).start();
    const pilot = new Pilot(DEMO, createRng(5));
    for (let t = 0; t < 40 && !run.over; t += 1 / 60) {
      run.clock = 30;
      const id = pilot.update(run, 1 / 60);
      if (id >= 0) run.tap(id);
      run.step(1 / 60);
    }
    expect(run.stats.bumps).toBe(0);
    expect(run.stats.rugs).toBeGreaterThanOrEqual(3);
    expect(run.stats.lastOut).toBe(run.stats.rugs);
    expect(run.stats.cleanRugs).toBe(run.stats.rugs);
  });

  it("run lengths sit in their bands and climb with skill; nobody is out in the first ten seconds", () => {
    const bands: Record<string, [number, number]> = { novice: [30, 42], casual: [39, 52], good: [52, 66], expert: [70, 88] };
    const medians: number[] = [];
    const scores: number[] = [];
    for (const name of ["novice", "casual", "good", "expert"] as const) {
      const runs = play(name, 80);
      const secs = runs.map((r) => r.stats.seconds);
      const m = median(secs);
      expect(m, name).toBeGreaterThanOrEqual(bands[name]![0]);
      expect(m, name).toBeLessThanOrEqual(bands[name]![1]);
      expect(Math.min(...secs), name).toBeGreaterThan(10);
      expect(Math.max(...secs), name).toBeLessThan(110);
      medians.push(m);
      scores.push(median(runs.map((r) => r.score)));
    }
    for (let i = 1; i < medians.length; i++) {
      expect(medians[i]!).toBeGreaterThan(medians[i - 1]!);
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]! * 1.5);
    }
  });

  it("everyone gets rewarded: a novice clears a rug or two, an expert purrs at the top and keeps her for last", () => {
    const novice = play("novice", 60);
    expect(median(novice.map((r) => r.stats.rugs))).toBeGreaterThanOrEqual(1);
    expect(median(novice.map((r) => r.stats.cats))).toBeGreaterThanOrEqual(8);
    const expert = play("expert", 60);
    expect(median(expert.map((r) => r.stats.bestPurr))).toBe(5);
    expect(median(expert.map((r) => r.stats.rugs))).toBeGreaterThanOrEqual(8);
    expect(median(expert.map((r) => r.stats.lastOut / Math.max(1, r.stats.rugs)))).toBeGreaterThan(0.8);
    // A cleared rug every ten seconds or so for a good player.
    const good = play("good", 60);
    expect(median(good.map((r) => r.stats.seconds / Math.max(1, r.stats.rugs)))).toBeLessThan(13);
  });
});
