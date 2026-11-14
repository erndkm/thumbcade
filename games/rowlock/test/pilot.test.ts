import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { Controls, type TapResult, type Target } from "../src/controls.ts";
import { Dealer } from "../src/gen.ts";
import { Pilot, SKILLS, type Skill } from "../src/pilot.ts";
import { Run, TUNE } from "../src/run.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

function runOnce(skill: Skill, i: number): { run: Run; at10: number } {
  const dealer = new Dealer(1000 + i * 7919, 77 + (i % 9));
  const pilot = new Pilot(skill, createRng(9000 + i));
  const run = new Run((k) => dealer.get(k)).start();
  const controls = new Controls(() => run);
  let at10 = -1;
  for (let t = 0; t < 400 && !run.over; t += 1 / 60) {
    run.step(1 / 60);
    const target = pilot.update(run, controls, 1 / 60);
    if (target) controls.tap(target);
    if (at10 < 0 && run.stats.seconds >= 10) at10 = run.clock;
  }
  return { run, at10 };
}

describe("pilot run lengths (the full bands: pnpm --filter @thumbcade-games/rowlock pilot)", () => {
  const BANDS: Record<Skill["name"], [number, number]> = { novice: [28, 44], casual: [42, 60], good: [58, 80], expert: [78, 104] };
  for (const skill of Object.values(SKILLS)) {
    it(`${skill.name}: median run inside ${BANDS[skill.name].join("-")} s, and alive with time to spare at 10 s`, () => {
      const secs: number[] = [];
      const at10: number[] = [];
      for (let i = 0; i < 30; i++) {
        const r = runOnce(skill, i);
        secs.push(r.run.stats.seconds);
        at10.push(r.at10);
      }
      const m = median(secs);
      expect(m).toBeGreaterThanOrEqual(BANDS[skill.name][0]);
      expect(m).toBeLessThanOrEqual(BANDS[skill.name][1]);
      expect(Math.min(...at10)).toBeGreaterThan(5);
    }, 120_000);
  }

  it("better players solve more grids, longer streaks and fewer slips", () => {
    const stat = (s: Skill) => {
      const runs = Array.from({ length: 16 }, (_, i) => runOnce(s, 100 + i).run);
      return { solved: median(runs.map((r) => r.stats.solved)), streak: median(runs.map((r) => r.stats.bestStreak)), wrong: median(runs.map((r) => r.stats.wrong / Math.max(1, r.stats.digits))) };
    };
    const n = stat(SKILLS.novice);
    const e = stat(SKILLS.expert);
    expect(e.solved).toBeGreaterThan(n.solved + 2);
    expect(e.streak).toBeGreaterThan(n.streak * 3);
    expect(e.wrong).toBeLessThan(n.wrong);
  }, 120_000);
});

describe("pilots play through the same taps as a player", () => {
  it("their taps are always ones a player could make, and the attract demo never slips", () => {
    for (const skill of [SKILLS.casual, SKILLS.expert, { ...SKILLS.good, slip: 0 }]) {
      const dealer = new Dealer(42, 7);
      const run = new Run((k) => dealer.get(k)).start();
      const controls = new Controls(() => run);
      const pilot = new Pilot(skill, createRng(3));
      const results: TapResult[] = [];
      for (let t = 0; t < 120 && !run.over; t += 1 / 60) {
        run.step(1 / 60);
        const target = pilot.update(run, controls, 1 / 60);
        if (target) results.push(controls.tap(target));
      }
      expect(results).not.toContain("ignored");
      expect(results.filter((r) => r === "nope").length).toBeLessThanOrEqual(1);
      if (skill.slip === 0) expect(run.stats.wrong).toBe(0);
    }
  }, 60_000);

  it("random tapping (the reviewer's script) reaches the end well inside 95 s; doing nothing ends it in 20-35 s", () => {
    for (let i = 0; i < 20; i++) {
      const dealer = new Dealer(500 + i, 3);
      const run = new Run((k) => dealer.get(k)).start();
      const controls = new Controls(() => run);
      const rng = createRng(i);
      let t = 0;
      for (; t < 200 && !run.over; t += 1 / 60) {
        run.step(1 / 60);
        if (rng() < 3 / 60) {
          const k = rng();
          const target: Target = k < 0.55 ? { kind: "key", cell: rng.int(0, run.n * run.n - 1) } : k < 0.97 ? { kind: "pad", digit: rng.int(1, run.n) } : { kind: "lamp" };
          controls.tap(target);
        }
      }
      expect(t).toBeLessThan(70);
    }
    const run = new Run((k) => new Dealer(1, 1).get(k)).start();
    let t = 0;
    for (; t < 200 && !run.over; t += 1 / 60) run.step(1 / 60);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(35);
    expect(TUNE.start).toBeLessThanOrEqual(30);
  });
});
