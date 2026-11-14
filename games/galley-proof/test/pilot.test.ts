import { describe, expect, it } from "vitest";
import { createRng } from "@thumbcade-games/kit/rng";
import { percentile, Pilot, playRun, SKILLS } from "../src/pilot.ts";
import { Run } from "../src/run.ts";
import { loadLists } from "../scripts/lists.ts";

const lists = loadLists();

describe("pilots", () => {
  const runs = 60;
  const results = SKILLS.map((s) => ({ s, res: Array.from({ length: runs }, (_, i) => playRun(s, 300 + i * 7919, lists, { daily: i % 2 ? lists.answers[i]! : null })) }));
  const med = (name: string) => percentile(results.find((r) => r.s.name === name)!.res.map((r) => r.seconds), 0.5);

  it("run lengths land in their bands, and the reviewer's 95 s is never reached", () => {
    expect(med("novice")).toBeGreaterThan(40);
    expect(med("novice")).toBeLessThan(62);
    expect(med("casual")).toBeGreaterThan(45);
    expect(med("casual")).toBeLessThan(68);
    expect(med("good")).toBeGreaterThan(60);
    expect(med("good")).toBeLessThan(82);
    expect(med("expert")).toBeGreaterThan(75);
    expect(med("expert")).toBeLessThan(100);
    for (const { res } of results) expect(percentile(res.map((r) => r.seconds), 0.9)).toBeLessThan(95);
  });

  it("skill pays: each level scores more and solves more than the one before", () => {
    for (let i = 1; i < results.length; i++) {
      const a = results[i - 1]!.res;
      const b = results[i]!.res;
      expect(percentile(b.map((r) => r.score), 0.5)).toBeGreaterThan(percentile(a.map((r) => r.score), 0.5));
      expect(b.reduce((n, r) => n + r.stats.words, 0)).toBeGreaterThan(a.reduce((n, r) => n + r.stats.words, 0));
    }
  });

  it("nobody loses in the first ten seconds", () => {
    for (const { res } of results) for (const r of res) {
      expect(r.lostBy10).toBe(false);
      expect(r.clockAt10).toBeGreaterThan(30);
    }
  });

  it("most beginners file at least one slip, and good players reach the named tiers", () => {
    const novice = results[0]!.res;
    expect(novice.filter((r) => r.stats.words >= 1).length / runs).toBeGreaterThan(0.4);
    const good = results[2]!.res;
    expect(good.filter((r) => r.stats.bestStreak >= 3).length / runs).toBeGreaterThan(0.5);
  });

  it("an idle player hears the bell inside the reviewer's idle window", () => {
    const idle = playRun(null, 1, lists);
    expect(idle.seconds).toBeGreaterThan(18);
    expect(idle.seconds).toBeLessThan(25);
  });

  it("the attract pilot never writes today's word, and every line it writes is a real word", () => {
    const today = lists.answers[123]!;
    const answers = lists.answers.filter((w) => w !== today);
    const run = new Run({ seed: 5, answers, daily: null, isWord: lists.isWord });
    const pilot = new Pilot({ ...SKILLS[2]!, typo: 0 }, createRng(9), answers, new Set([today]));
    let unknown = 0;
    for (let t = 0; t < 240; t += 1 / 60) {
      run.clock = 60;
      run.step(1 / 60);
      const k = pilot.next(run, 1 / 60);
      if (!k) continue;
      for (const e of run.press(k)) {
        if (e.type === "line") expect(e.word).not.toBe(today);
        if (e.type === "unknown") unknown++;
      }
    }
    expect(unknown).toBe(0);
    expect(run.stats.words).toBeGreaterThan(5);
  });

  it("is deterministic for a seed", () => {
    const a = playRun(SKILLS[1]!, 77, lists);
    const b = playRun(SKILLS[1]!, 77, lists);
    expect(a.seconds).toBe(b.seconds);
    expect(a.score).toBe(b.score);
  });
});
