import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/pilot.ts";
import { pct, playRun } from "../src/runs.ts";

const SEEDS = Array.from({ length: 16 }, (_, i) => 1000 + i * 7919);

describe("headless pilots", () => {
  it("nobody loses the run in the first ten seconds", () => {
    for (const skill of [null, ...SKILLS]) {
      for (const seed of SEEDS) expect(playRun(skill, seed, 12).diedBy10, `${skill?.name ?? "idle"} ${seed}`).toBe(false);
    }
  });

  it("an idle thumb is out well inside the reviewer's window", () => {
    const secs = SEEDS.map((s) => playRun(null, s).seconds);
    expect(pct(secs, 0.5)).toBeLessThan(28);
    expect(Math.max(...secs)).toBeLessThan(80);
  });

  it("runs last 20-90 s or so, longer for better thumbs", () => {
    const median = (name: string) => pct(SEEDS.map((s) => playRun(SKILLS.find((k) => k.name === name)!, s).seconds), 0.5);
    const novice = median("novice");
    const good = median("good");
    expect(novice).toBeGreaterThan(20);
    expect(good).toBeGreaterThan(novice);
    expect(good).toBeLessThan(110);
  });
});
