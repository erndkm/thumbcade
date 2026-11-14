import { describe, expect, it } from "vitest";
import { percentile, playRun, SKILLS } from "../src/pilot.ts";

describe("pilots", () => {
  const runs = 40;
  const results = SKILLS.map((s) => ({ s, res: Array.from({ length: runs }, (_, i) => playRun(s, 300 + i * 7919)) }));
  const median = (name: string) => percentile(results.find((r) => r.s.name === name)!.res.map((r) => r.seconds), 0.5);

  it("run lengths land in their bands: novice ~30-40 s, casual ~45-55, good ~60-75, expert ~80-100", () => {
    expect(median("novice")).toBeGreaterThan(28);
    expect(median("novice")).toBeLessThan(42);
    expect(median("casual")).toBeGreaterThan(42);
    expect(median("casual")).toBeLessThan(57);
    expect(median("good")).toBeGreaterThan(57);
    expect(median("good")).toBeLessThan(78);
    expect(median("expert")).toBeGreaterThan(78);
    expect(median("expert")).toBeLessThan(102);
  }, 120_000);

  it("skill pays: each level lasts longer, clears more walls and scores more than the one before", () => {
    for (let i = 1; i < results.length; i++) {
      const a = results[i - 1]!.res;
      const b = results[i]!.res;
      expect(percentile(b.map((r) => r.seconds), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.seconds), 0.5));
      expect(percentile(b.map((r) => r.stats.walls), 0.5)).toBeGreaterThanOrEqual(percentile(a.map((r) => r.stats.walls), 0.5));
      expect(percentile(b.map((r) => r.score), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.score), 0.5));
    }
  });

  it("nobody loses in the first ten seconds, and the clock still has time in it then", () => {
    for (const { res } of results) {
      for (const r of res) {
        expect(r.lostBy10).toBe(false);
        expect(r.clockAt10).toBeGreaterThan(8);
      }
    }
  });

  it("an idle player hears closing time inside the reviewer's idle window", () => {
    const idle = playRun(null, 1);
    expect(idle.why).toBe("time");
    expect(idle.seconds).toBeGreaterThan(20);
    expect(idle.seconds).toBeLessThan(25);
  });

  it("a thumb that taps any free peg at random (the reviewer's scripted input) still reaches the end", () => {
    const random = { ...SKILLS[0]!, name: "random", careless: 1, sight: 1, fumble: 0.3, think: [0.5, 1] as [number, number], magnet: false };
    const res = Array.from({ length: 20 }, (_, i) => playRun(random, 50 + i * 31, 200));
    for (const r of res) expect(r.why).not.toBe("cap");
    // The shelf is a real danger for it.
    expect(res.filter((r) => r.stats.saves > 0 || r.why === "full").length).toBeGreaterThan(10);
  });

  it("good players earn the multiplier tiers and see a few walls", () => {
    const good = results.find((r) => r.s.name === "good")!.res;
    expect(percentile(good.map((r) => r.stats.bestMult), 0.5)).toBeGreaterThanOrEqual(3);
    expect(percentile(good.map((r) => r.stats.walls), 0.5)).toBeGreaterThanOrEqual(3);
  });
});
