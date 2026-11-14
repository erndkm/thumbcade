import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/pilot.ts";
import { pct, playRun } from "../src/runs.ts";

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);
const skill = (name: string) => SKILLS.find((k) => k.name === name)!;
const runs = (name: string) => SEEDS.map((s) => playRun(skill(name), s));

describe("headless pilots", () => {
  it("nobody loses the run in the first twenty seconds", () => {
    for (const s of SKILLS) for (const seed of SEEDS) expect(playRun(s, seed, 20).over, `${s.name} ${seed}`).toBe(false);
  });

  it("an idle thumb is out by itself, inside the reviewer's 25 s", () => {
    for (const seed of SEEDS) {
      const r = playRun(null, seed);
      expect(r.over).toBe(true);
      expect(r.seconds).toBeGreaterThan(14);
      expect(r.seconds).toBeLessThan(23);
      expect(r.score).toBe(0);
    }
  });

  it("runs last about a minute and a quarter; none drags on", () => {
    for (const name of ["novice", "good", "expert"]) {
      const secs = runs(name).map((r) => r.seconds);
      expect(pct(secs, 0.5), name).toBeGreaterThan(50);
      expect(pct(secs, 0.5), name).toBeLessThan(110);
      expect(Math.max(...secs), name).toBeLessThan(170);
      expect(Math.min(...secs), name).toBeGreaterThan(30);
    }
  });

  it("a better thumb gets further down the rows and scores more", () => {
    const [novice, good, expert] = ["novice", "good", "expert"].map(runs) as [ReturnType<typeof runs>, ReturnType<typeof runs>, ReturnType<typeof runs>];
    const med = (rs: ReturnType<typeof runs>, f: (r: ReturnType<typeof runs>[number]) => number) => pct(rs.map(f), 0.5);
    expect(med(good, (r) => r.score)).toBeGreaterThan(med(novice, (r) => r.score) * 1.2);
    expect(med(expert, (r) => r.score)).toBeGreaterThan(med(good, (r) => r.score) * 1.2);
    expect(med(expert, (r) => r.turn)).toBeGreaterThan(med(novice, (r) => r.turn));
    expect(med(good, (r) => r.turn)).toBeGreaterThanOrEqual(med(novice, (r) => r.turn));
  });

  it("the same seed and skill give the same run", () => {
    const a = playRun(skill("good"), 4242);
    const b = playRun(skill("good"), 4242);
    expect(b.score).toBe(a.score);
    expect(b.seconds).toBe(a.seconds);
  });
});
