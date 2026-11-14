import { describe, expect, it } from "vitest";
import { percentile, playRun, SKILLS } from "../src/pilot.ts";

describe("pilots", () => {
  const runs = 60;
  const results = SKILLS.map((s) => ({ s, res: Array.from({ length: runs }, (_, i) => playRun(s, 300 + i * 7919)) }));
  const median = (name: string) => percentile(results.find((r) => r.s.name === name)!.res.map((r) => r.seconds), 0.5);

  it("run lengths land in their bands: novice ~30-40 s, casual ~45-55, good ~60-75, expert ~80-100", () => {
    expect(median("novice")).toBeGreaterThan(28);
    expect(median("novice")).toBeLessThan(42);
    expect(median("casual")).toBeGreaterThan(42);
    expect(median("casual")).toBeLessThan(57);
    expect(median("good")).toBeGreaterThan(56);
    expect(median("good")).toBeLessThan(77);
    expect(median("expert")).toBeGreaterThan(78);
    expect(median("expert")).toBeLessThan(105);
    for (const { s, res } of results) expect(percentile(res.map((r) => r.seconds), 0.9), s.name).toBeLessThan(115);
  });

  it("skill pays: each level lasts longer, tidies more and scores more than the one before", () => {
    for (let i = 1; i < results.length; i++) {
      const a = results[i - 1]!.res;
      const b = results[i]!.res;
      expect(percentile(b.map((r) => r.seconds), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.seconds), 0.5));
      expect(percentile(b.map((r) => r.score), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.score), 0.5));
      expect(percentile(b.map((r) => r.stats.levels), 0.5)).toBeGreaterThanOrEqual(percentile(a.map((r) => r.stats.levels), 0.5));
    }
  });

  it("nobody loses in the first ten seconds, and the clock still has time in it then", () => {
    for (const { res } of results) {
      for (const r of res) {
        expect(r.lostBy10).toBe(false);
        expect(r.clockAt10).toBeGreaterThan(10);
      }
    }
  });

  it("an idle player's run ends on its own, before the reviewer's scripted taps begin", () => {
    const idle = playRun(null, 1);
    expect(idle.seconds).toBeGreaterThan(20);
    expect(idle.seconds).toBeLessThan(25);
  });

  it("most first-timers tidy the first level, and experts reach covered lumps", () => {
    const novice = results[0]!.res;
    expect(novice.filter((r) => r.stats.levels >= 1).length / runs).toBeGreaterThan(0.8);
    const expert = results[3]!.res;
    expect(percentile(expert.map((r) => r.level), 0.5)).toBeGreaterThanOrEqual(5);
  });

  it("a dead end never ends a run: graces and rewinds keep everyone playing to the clock", () => {
    for (const { res } of results) for (const r of res) expect(r.stats.seconds).toBeGreaterThan(20);
  });
});
