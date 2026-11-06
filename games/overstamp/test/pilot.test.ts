import { describe, expect, it } from "vitest";
import { percentile, playRun, SKILLS } from "../src/pilot.ts";

describe("pilots", () => {
  const runs = 50;
  const results = SKILLS.map((s) => ({ s, res: Array.from({ length: runs }, (_, i) => playRun(s, 300 + i * 7919)) }));

  it("run lengths sit between 20 and 90 seconds for every skill, the expert's p90 included", () => {
    for (const { s, res } of results) {
      const secs = res.map((r) => r.seconds);
      expect(percentile(secs, 0.5), s.name).toBeGreaterThan(20);
      expect(percentile(secs, 0.9), s.name).toBeLessThanOrEqual(90);
    }
  });

  it("skill pays: each level lasts longer and scores more than the one before", () => {
    for (let i = 1; i < results.length; i++) {
      const a = results[i - 1]!.res;
      const b = results[i]!.res;
      expect(percentile(b.map((r) => r.seconds), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.seconds), 0.5));
      expect(percentile(b.map((r) => r.score), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.score), 0.5));
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

  it("an idle player hears the bell inside the reviewer's idle window", () => {
    const idle = playRun(null, 1);
    expect(idle.why).toBe("time");
    expect(idle.seconds).toBeLessThan(25);
  });

  it("most first-timers clear the first sheet", () => {
    const novice = results[0]!.res;
    expect(novice.filter((r) => r.stats.sheets >= 1).length / runs).toBeGreaterThan(0.6);
  });
});
