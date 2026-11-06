import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";

/** Fewer runs than the pilot script (200 per skill), same seeds. */
const RUNS = 100;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const results = Object.fromEntries(
  Object.values(SKILLS).map((s) => [s.name, Array.from({ length: RUNS }, (_, i) => playRun(s, createRng(1000 + i * 7919)))]),
);

describe("pilots", () => {
  it("run lengths sit in the feed's 20-90 s and climb with skill", () => {
    const med = Object.values(SKILLS).map((s) => pct(results[s.name]!.map((r) => r.seconds), 0.5));
    for (let i = 1; i < med.length; i++) expect(med[i]!).toBeGreaterThan(med[i - 1]!);
    expect(pct(results.novice!.map((r) => r.seconds), 0.1)).toBeGreaterThan(22);
    expect(med[0]!).toBeGreaterThan(30);
    expect(med[0]!).toBeLessThan(50);
    expect(pct(results.expert!.map((r) => r.seconds), 0.9)).toBeLessThanOrEqual(90);
  });

  it("nobody loses in the first ten seconds", () => {
    for (const s of Object.values(SKILLS)) {
      for (const r of results[s.name]!) {
        expect(r.seconds).toBeGreaterThan(20);
        expect(r.minClock10).toBeGreaterThan(8);
      }
    }
  });

  it("skill shows in strikes and spares", () => {
    const rate = (name: string, k: "strikes" | "spares") => {
      const rs = results[name]!;
      const n = rs.reduce((a, r) => a + r[k], 0);
      const d = rs.reduce((a, r) => a + (k === "strikes" ? r.strikes + r.spares + r.opens : r.spares + r.opens), 0);
      return n / d;
    };
    expect(rate("expert", "strikes")).toBeGreaterThan(rate("novice", "strikes") + 0.1);
    expect(rate("expert", "spares")).toBeGreaterThan(rate("novice", "spares") + 0.15);
    expect(rate("novice", "strikes")).toBeGreaterThan(0.15);
  });

  it("good players see turkeys, and runs are reproducible from their seed", () => {
    expect(results.good!.filter((r) => r.bestChain >= 3).length).toBeGreaterThan(RUNS * 0.25);
    const a = playRun(SKILLS.casual, createRng(42));
    const b = playRun(SKILLS.casual, createRng(42));
    expect(b.seconds).toBe(a.seconds);
    expect(b.score).toBe(a.score);
  });
});
