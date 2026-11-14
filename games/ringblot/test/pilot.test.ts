import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/pilot.ts";
import { pct, playRun } from "../src/runs.ts";
import { INK_START } from "../src/sim.ts";

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);
const skill = (name: string) => SKILLS.find((k) => k.name === name)!;
const runs = (name: string) => SEEDS.map((s) => playRun(skill(name), s));

describe("headless pilots", () => {
  it("an idle beetle's run ends by itself when the ink is dry: on every seed, well inside 35 s", () => {
    for (const seed of SEEDS) {
      const r = playRun(null, seed);
      expect(r.over).toBe(true);
      expect(r.score).toBe(0);
      expect(r.seconds).toBeGreaterThan(INK_START - 0.1);
      expect(r.seconds).toBeLessThan(INK_START + 0.1);
    }
    expect(INK_START).toBeLessThanOrEqual(25);
  });

  it("random swipes, like the reviewer's, end the run well inside its 95 s", () => {
    const secs = SEEDS.map((s) => playRun("random", s).seconds);
    expect(pct(secs, 0.5)).toBeLessThan(30);
    expect(Math.max(...secs)).toBeLessThan(75);
  });

  it("nobody who is steering runs dry in the first fifteen seconds", () => {
    for (const s of SKILLS) for (const seed of SEEDS) expect(playRun(s, seed, 15).over, `${s.name} ${seed}`).toBe(false);
  });

  it("a novice lasts 30-50 s, a good thumb 50-75 s, an expert longer still but under 90 s nine times in ten", () => {
    const [novice, good, expert] = ["novice", "good", "expert"].map((n) => runs(n).map((r) => r.seconds)) as [number[], number[], number[]];
    expect(pct(novice, 0.5)).toBeGreaterThanOrEqual(30);
    expect(pct(novice, 0.5)).toBeLessThanOrEqual(50);
    expect(pct(good, 0.5)).toBeGreaterThanOrEqual(50);
    expect(pct(good, 0.5)).toBeLessThanOrEqual(75);
    expect(pct(expert, 0.9)).toBeLessThan(90);
    // Skill shows in the seconds, not only the score.
    expect(pct(good, 0.5)).toBeGreaterThan(pct(novice, 0.5) + 10);
    expect(pct(expert, 0.5)).toBeGreaterThan(pct(good, 0.5));
    expect(Math.max(...expert)).toBeLessThan(150);
  });

  it("a better thumb prints more, bigger, and gets further through the sheets", () => {
    const [novice, good, expert] = ["novice", "good", "expert"].map(runs) as [ReturnType<typeof runs>, ReturnType<typeof runs>, ReturnType<typeof runs>];
    const med = (rs: ReturnType<typeof runs>, f: (r: ReturnType<typeof runs>[number]) => number) => pct(rs.map(f), 0.5);
    expect(med(good, (r) => r.score)).toBeGreaterThan(med(novice, (r) => r.score) * 2);
    expect(med(expert, (r) => r.score)).toBeGreaterThan(med(good, (r) => r.score) * 1.2);
    expect(med(expert, (r) => r.stats.biggest)).toBeGreaterThan(med(good, (r) => r.stats.biggest));
    expect(med(good, (r) => r.stats.biggest)).toBeGreaterThan(med(novice, (r) => r.stats.biggest));
    expect(med(expert, (r) => r.sheet)).toBeGreaterThan(med(novice, (r) => r.sheet));
    expect(med(good, (r) => r.sheet)).toBeGreaterThanOrEqual(3);
  });

  it("a novice reaches the second sheet in at least three runs out of four, and sees it for a while", () => {
    const novice = runs("novice");
    const reached = novice.filter((r) => r.sheet >= 2);
    expect(reached.length / novice.length).toBeGreaterThanOrEqual(0.75);
    // On sheet 2 for ten seconds or more, in the median run that got there.
    expect(pct(reached.map((r) => r.seconds - r.sheet2At), 0.5)).toBeGreaterThan(10);
  });

  it("the same seed and skill give the same run", () => {
    const a = playRun(skill("good"), 4242);
    const b = playRun(skill("good"), 4242);
    expect(b.score).toBe(a.score);
    expect(b.seconds).toBe(a.seconds);
  });
});
