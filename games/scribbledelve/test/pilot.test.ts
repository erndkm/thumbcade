import { describe, expect, it } from "vitest";
import { SKILLS } from "../src/pilot.ts";
import { pct, playRun } from "../src/runs.ts";

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
const skill = (name: string) => SKILLS.find((k) => k.name === name)!;
const runs = (name: string) => SEEDS.map((s) => playRun(skill(name), s));

describe("headless pilots", () => {
  it("nobody who is steering loses the run in the first twelve seconds", () => {
    for (const s of SKILLS) for (const seed of SEEDS) expect(playRun(s, seed, 12).over, `${s.name} ${seed}`).toBe(false);
  });

  it("an idle knight is caught three times and the run ends by itself", () => {
    const secs = SEEDS.map((s) => {
      const r = playRun(null, s);
      expect(r.over).toBe(true);
      expect(r.score).toBe(0);
      // The first scribble is not even drawn for three seconds.
      expect(r.firstCaught).toBeGreaterThan(4.5);
      return r.seconds;
    });
    expect(pct(secs, 0.5)).toBeLessThan(27);
    expect(Math.max(...secs)).toBeLessThan(60);
  });

  it("random swipes, like the reviewer's, end the run well inside its 95 s", () => {
    const secs = SEEDS.map((s) => playRun("random", s).seconds);
    expect(pct(secs, 0.5)).toBeLessThan(35);
    expect(Math.max(...secs)).toBeLessThan(70);
  });

  it("runs last 40-90 s or so, longer for better thumbs; none drags on", () => {
    const [novice, good, expert] = ["novice", "good", "expert"].map((n) => runs(n).map((r) => r.seconds)) as [number[], number[], number[]];
    expect(pct(novice, 0.5)).toBeGreaterThan(30);
    expect(pct(novice, 0.5)).toBeLessThan(70);
    expect(pct(good, 0.5)).toBeGreaterThan(pct(novice, 0.5));
    expect(pct(expert, 0.5)).toBeGreaterThan(pct(good, 0.5));
    expect(pct(expert, 0.5)).toBeLessThan(120);
    expect(Math.max(...expert)).toBeLessThan(260);
  });

  it("a better thumb scores more, clears more floors and uses its swords", () => {
    const [novice, good, expert] = ["novice", "good", "expert"].map(runs) as [ReturnType<typeof runs>, ReturnType<typeof runs>, ReturnType<typeof runs>];
    const med = (rs: ReturnType<typeof runs>, f: (r: ReturnType<typeof runs>[number]) => number) => pct(rs.map(f), 0.5);
    expect(med(good, (r) => r.score)).toBeGreaterThan(med(novice, (r) => r.score) * 1.5);
    expect(med(expert, (r) => r.score)).toBeGreaterThan(med(good, (r) => r.score));
    expect(med(good, (r) => r.floor)).toBeGreaterThanOrEqual(2);
    expect(med(expert, (r) => r.stats.poofs)).toBeGreaterThan(med(novice, (r) => r.stats.poofs));
    // Every kind of scribble catches somebody.
    const by = [0, 0, 0, 0];
    for (const r of [...novice, ...good, ...expert]) r.stats.caughtBy.forEach((n, i) => (by[i]! += n));
    for (const n of by) expect(n).toBeGreaterThan(0);
  });

  it("the same seed and skill give the same run", () => {
    const a = playRun(skill("good"), 4242);
    const b = playRun(skill("good"), 4242);
    expect(b.score).toBe(a.score);
    expect(b.seconds).toBe(a.seconds);
  });
});
