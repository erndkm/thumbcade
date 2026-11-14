import { describe, expect, it } from "vitest";
import { aimTable } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe("pilot run lengths (the full spread is `pnpm pilot`, 200 runs a skill)", () => {
  const N = 40;
  const runs = (skill: Parameters<typeof playRun>[0], n = N) => Array.from({ length: n }, (_, i) => playRun(skill, 1000 + i * 7919));
  const bands = {
    novice: [27, 46],
    casual: [40, 64],
    good: [52, 85],
    expert: [70, 112],
  } as const;
  const medians: number[] = [];
  for (const [skill, [lo, hi]] of Object.entries(bands) as Array<[keyof typeof bands, readonly [number, number]]>) {
    it(`${skill}: median run ${lo}-${hi} s, nobody out inside 10 s, the safety net never acts`, () => {
      const rs = runs(skill);
      const m = median(rs.map((r) => r.seconds));
      medians.push(m);
      expect(m).toBeGreaterThan(lo);
      expect(m).toBeLessThan(hi);
      expect(Math.min(...rs.map((r) => r.seconds))).toBeGreaterThan(10);
      expect(rs.every((r) => r.corrections === 0)).toBe(true);
      expect(rs.every((r) => r.stats.nudges === 0)).toBe(true);
    }, 60_000);
  }

  it("better pilots last longer and score more", () => {
    expect(medians).toHaveLength(4);
    for (let i = 1; i < 4; i++) expect(medians[i]).toBeGreaterThan(medians[i - 1]!);
    const lo = median(runs("novice", 20).map((r) => r.score));
    const hi = median(runs("expert", 20).map((r) => r.score));
    expect(hi).toBeGreaterThan(lo * 2);
  }, 60_000);

  it("an idle run ends on its own: median about half a minute, never past 36 s", () => {
    const rs = runs(null, 40);
    const m = median(rs.map((r) => r.seconds));
    expect(m).toBeGreaterThan(22);
    expect(m).toBeLessThan(33);
    for (const r of rs) {
      expect(r.seconds).toBeGreaterThan(20);
      expect(r.seconds).toBeLessThan(36);
    }
  });
});

describe("the cradle", () => {
  it("is a place to aim from: from a held ball, some delay reaches each kind of shot", () => {
    const [left, right] = aimTable();
    for (const rows of [left, right]) {
      const up = new Set(rows.map((r) => r.up));
      const open = new Set(rows.map((r) => r.open));
      expect(up.has("flag")).toBe(true);
      expect(up.has("orbit") || open.has("orbit")).toBe(true);
      expect(open.has("harbour")).toBe(true);
    }
  });
});
