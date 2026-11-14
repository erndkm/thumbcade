import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { DEMO, Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => sorted(xs)[Math.floor(xs.length / 2)]!;
const p90 = (xs: number[]) => sorted(xs)[Math.floor(xs.length * 0.9)]!;
const play = (name: keyof typeof SKILLS, n: number) => {
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) runs.push(playRun(new Run(1000 + i * 7919), new Pilot(SKILLS[name]!, createRng(9000 + i))));
  return runs;
};

describe("pilots", () => {
  it("the demo player clears deal after deal without a tap that fits nowhere", () => {
    const run = new Run(321).start();
    const pilot = new Pilot(DEMO, createRng(5));
    for (let t = 0; t < 45 && !run.over; t += 1 / 60) {
      run.clock = 30;
      const tap = pilot.update(run, 1 / 60);
      if (tap) run.tap(tap);
      run.think(Infinity);
      run.step(1 / 60);
    }
    expect(run.stats.deals).toBeGreaterThanOrEqual(2);
    expect(run.stats.duds).toBe(0);
    expect(run.stats.afresh).toBe(0);
  });

  it("run lengths: a novice's median inside 30-50 s, a good player's inside 50-75 s, an expert's ninth decile under 90 s", () => {
    const runs = { novice: play("novice", 120), casual: play("casual", 120), good: play("good", 120), expert: play("expert", 120) };
    const secs = (k: keyof typeof runs) => runs[k].map((r) => r.stats.seconds);
    expect(median(secs("novice"))).toBeGreaterThanOrEqual(30);
    expect(median(secs("novice"))).toBeLessThanOrEqual(50);
    expect(median(secs("good"))).toBeGreaterThanOrEqual(50);
    expect(median(secs("good"))).toBeLessThanOrEqual(75);
    expect(p90(secs("expert"))).toBeLessThan(90);
    expect(Math.max(...secs("expert"))).toBeLessThan(100);
    // Skill shows in seconds as well as in score.
    const order = ["novice", "casual", "good", "expert"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(median(secs(order[i]!))).toBeGreaterThan(median(secs(order[i - 1]!)) + 2);
      expect(median(runs[order[i]!].map((r) => r.score))).toBeGreaterThan(median(runs[order[i - 1]!].map((r) => r.score)) * 1.4);
    }
    expect(median(secs("expert"))).toBeGreaterThan(median(secs("novice")) + 30);
    // Nobody is out in the first ten seconds.
    for (const k of order) expect(Math.min(...secs(k))).toBeGreaterThan(10);
  }, 30_000);

  it("everyone gets rewarded: a novice clears the first deal, an expert reaches the whole pack and the top multiplier", () => {
    const novice = play("novice", 80);
    expect(median(novice.map((r) => r.stats.deals))).toBeGreaterThanOrEqual(1);
    expect(median(novice.map((r) => r.stats.home))).toBeGreaterThanOrEqual(18);
    const expert = play("expert", 80);
    expect(median(expert.map((r) => r.stats.deals))).toBeGreaterThanOrEqual(4);
    expect(median(expert.map((r) => r.stats.bestMult))).toBe(5);
    // Dead ends are rare for everyone: natural play wins the deals that are dealt.
    for (const runs of [novice, expert, play("good", 80)]) expect(runs.reduce((n, r) => n + r.stats.afresh, 0) / runs.length).toBeLessThan(0.2);
    // A card home every second or so for a good player.
    const good = play("good", 80);
    expect(median(good.map((r) => r.stats.seconds / Math.max(1, r.stats.home)))).toBeLessThan(1.2);
  }, 30_000);
});
