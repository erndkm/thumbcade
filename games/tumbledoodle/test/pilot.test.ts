import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/pilot.ts";
import { playRun, type RunReport } from "../src/runs.ts";

/**
 * Whole runs played headless by the pilot (the same drag target the thumb moves) at four skill levels: run lengths
 * stay in the feed's 20-90 s, nobody loses early, an idle player reaches game over inside the reviewer's window, and
 * skill shows: in the score, the size reached, and against the eraser.
 */
const RUNS = 16;
const runs = Object.fromEntries(
  Object.entries(SKILLS).map(([k, s]) => [k, Array.from({ length: RUNS }, (_, i) => playRun(s, 500 + i * 7919))]),
) as Record<keyof typeof SKILLS, RunReport[]>;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const med = (rs: RunReport[], k: keyof RunReport) => pct(rs.map((r) => r[k] as number), 0.5);

describe("pilot runs", () => {
  it("every run lasts 20-90 s, expert p90 at most 90 s", () => {
    for (const [name, rs] of Object.entries(runs)) {
      for (const r of rs) {
        expect(r.seconds, name).toBeGreaterThanOrEqual(20);
        expect(r.seconds, name).toBeLessThanOrEqual(90);
      }
    }
    expect(pct(runs.expert.map((r) => r.seconds), 0.9)).toBeLessThanOrEqual(90);
  });

  it("nobody is in trouble in the first 10 s", () => {
    for (const rs of Object.values(runs)) for (const r of rs) expect(r.clock10).toBeGreaterThan(25);
  });

  it("an idle player hears the end inside the reviewer's window", () => {
    const r = playRun(null, 77);
    expect(r.seconds).toBeGreaterThan(20);
    expect(r.seconds).toBeLessThan(60);
    expect(r.scrubs).toBeGreaterThan(2);
  });

  it("skill shows in the score and in how big the hole gets", () => {
    const order = ["novice", "casual", "good", "expert"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(med(runs[order[i]!], "score")).toBeGreaterThan(med(runs[order[i - 1]!], "score"));
      expect(med(runs[order[i]!], "tier")).toBeGreaterThanOrEqual(med(runs[order[i - 1]!], "tier"));
    }
    expect(med(runs.novice, "tier")).toBeLessThanOrEqual(4);
    expect(med(runs.expert, "tier")).toBe(6);
  });

  it("the eraser is a threat for beginners and a meal for good players", () => {
    expect(med(runs.novice, "scrubs")).toBeGreaterThan(med(runs.expert, "scrubs"));
    expect(med(runs.novice, "scrubs")).toBeGreaterThanOrEqual(2);
    expect(med(runs.good, "erasersEaten")).toBeGreaterThanOrEqual(2);
    expect(med(runs.novice, "erasersEaten")).toBe(0);
  });

  it("everyone gets a feast and a final gulp", () => {
    for (const [name, rs] of Object.entries(runs)) {
      expect(med(rs, "feasts"), name).toBeGreaterThanOrEqual(1);
      expect(med(rs, "finalGulp"), name).toBeGreaterThanOrEqual(1);
    }
  });
});
