import { describe, expect, it } from "vitest";
import manifest from "../thumbcade.json" with { type: "json" };
import { LANES } from "../src/chart.ts";
import {
  CLEAN_BONUS,
  ENCORE_BONUS,
  ENCORE_PER_LIFE,
  GREAT,
  LIVES,
  median,
  MULT_AT,
  PERFECT,
  Pilot,
  Run,
  SHOWMAN,
  simulate,
  SKILLS,
  type RunEvent,
} from "../src/sim.ts";

const dt = 1 / 60;

/** Steps until roll time `t`, collecting events. */
function stepTo(run: Run, t: number): RunEvent[] {
  const out: RunEvent[] = [];
  while (run.now < t && !run.over) {
    run.step(Math.min(dt, Math.max(1e-4, t - run.now)));
    out.push(...run.events);
    run.events.length = 0;
  }
  return out;
}

const drain = (run: Run): RunEvent[] => run.events.splice(0, run.events.length);

describe("judging", () => {
  it("grades a tap by how close to the line it lands", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const t0 = run.tiles[0]!;
    stepTo(run, t0.t);
    expect(run.press(1, [t0.lane], t0.P)).toBe(t0);
    run.release(1);
    expect(run.judge[0]).toBe("perfect");
    const t1 = run.tiles[1]!;
    stepTo(run, t1.t - (PERFECT + GREAT) / 2);
    run.press(2, [t1.lane], t1.P);
    run.release(2);
    expect(run.judge[1]).toBe("great");
    const t2 = run.tiles[2]!;
    stepTo(run, t2.t + GREAT + 0.04);
    run.press(3, [t2.lane], t2.P);
    run.release(3);
    expect(run.judge[2]).toBe("late");
    expect(run.combo).toBe(3);
  });

  it("judges at the moment the finger landed, not at the frame", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const t0 = run.tiles[0]!;
    stepTo(run, t0.t - 0.17);
    // The frame says 0.17 s early (great at best); the finger landed 0.05 s later: 0.12 s early.
    run.press(1, [t0.lane], t0.P, 0.05);
    expect(run.judge[0]).toBe("great");
    const run2 = new Run({ seed: 1, set: ["ode"] });
    stepTo(run2, t0.t - 0.1);
    run2.press(1, [t0.lane], t0.P, 0.05);
    expect(run2.judge[0]).toBe("perfect");
  });

  it("counts a tap anywhere in the right lane near the moment", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const t0 = run.tiles[0]!;
    stepTo(run, t0.t - 0.05);
    // Pointing well below the tile, at the bottom of the screen.
    expect(run.press(1, [t0.lane], run.S - 0.3)).toBe(t0);
  });

  it("tries the neighbouring lane for a tap near the border", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const t0 = run.tiles[0]!;
    const wrongLane = t0.lane === 0 ? 1 : t0.lane - 1;
    stepTo(run, t0.t);
    expect(run.press(1, [wrongLane, t0.lane], t0.P)).toBe(t0);
    expect(run.lives).toBe(LIVES);
  });
});

describe("forgiveness and lives", () => {
  it("never punishes a tap when no ink is on screen", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    run.step(0.05);
    expect(run.tiles[0]!.P - run.S).toBeGreaterThan(1);
    run.press(1, [0], run.S);
    expect(drain(run).some((e) => e.k === "wrong")).toBe(false);
    expect(run.lives).toBe(LIVES);
  });

  it("ignores a second tap on a note just played", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const t0 = run.tiles[0]!;
    stepTo(run, t0.t);
    run.press(1, [t0.lane], t0.P);
    run.release(1);
    run.step(0.05);
    run.press(2, [t0.lane], t0.P);
    expect(run.lives).toBe(LIVES);
    expect(run.stats.wrongs).toBe(0);
  });

  it("costs a life for paper when there is ink to aim at, and slows the roll a moment", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const t0 = run.tiles[0]!;
    stepTo(run, t0.t - 0.6);
    const empty = (t0.lane + 2) % LANES;
    run.press(1, [empty], run.S);
    const ev = drain(run);
    expect(ev.some((e) => e.k === "wrong")).toBe(true);
    expect(run.lives).toBe(LIVES - 1);
    expect(run.combo).toBe(0);
    expect(run.pace).toBeLessThan(1);
    run.step(1);
    expect(run.pace).toBe(1);
  });

  it("misses a tile whose head leaves the screen, and ends the run on the last life", () => {
    const run = new Run({ seed: 1, set: ["ode"] });
    const ev = stepTo(run, 30);
    expect(ev.filter((e) => e.k === "miss").length).toBe(LIVES);
    expect(ev.some((e) => e.k === "die")).toBe(true);
    expect(run.over).toBe(true);
    expect(run.won).toBe(false);
  });

  it("never loses anything in the attract demo", () => {
    const run = new Run({ seed: 1, set: ["ode"], demo: true });
    stepTo(run, 30);
    expect(run.lives).toBe(LIVES);
  });
});

describe("holds", () => {
  it("pays the full bonus when held to the end, less when let go early", () => {
    const result = (letGo: number) => {
      // Demo runs: the misses before the hold cost nothing.
      const run = new Run({ seed: 4, set: ["ode"], demo: true });
      const h = run.tiles.find((t) => t.hold)!;
      stepTo(run, h.t);
      expect(run.press(9, [h.lane], h.P)).toBe(h);
      expect(run.isHeld(h.id)).toBe(true);
      const ev = stepTo(run, h.t + h.dur * letGo);
      if (letGo < 1) run.release(9);
      ev.push(...stepTo(run, h.t + h.dur + 0.1), ...drain(run));
      const end = ev.find((e) => e.k === "holdEnd");
      if (end?.k !== "holdEnd") throw new Error("no holdEnd");
      return end;
    };
    const full = result(1.05);
    const part = result(0.5);
    expect(full.full).toBe(true);
    expect(part.full).toBe(false);
    expect(full.points).toBeGreaterThan(part.points);
  });
});

describe("a whole set", () => {
  it("clears each tune, gives a life back, and plays an encore after the finale", () => {
    const run = new Run({ seed: 11 });
    const pilot = new Pilot(SHOWMAN, 3);
    const ev: RunEvent[] = [];
    // Lose one life early on purpose.
    const t0 = run.tiles[0]!;
    while (run.now < t0.t - 0.5) {
      run.step(dt);
      run.events.length = 0;
    }
    run.press(77, [(t0.lane + 2) % LANES], run.S);
    expect(run.lives).toBe(LIVES - 1);
    while (!run.over && run.now < 200) {
      pilot.play(run);
      run.step(dt);
      ev.push(...run.events);
      run.events.length = 0;
    }
    const clears = ev.filter((e) => e.k === "clear");
    expect(clears.map((e) => (e.k === "clear" ? e.slot : -1))).toEqual([0, 1, 2, 3]);
    expect(clears[0]!.k === "clear" && clears[0]!.clean).toBe(false);
    expect(clears[1]!.k === "clear" && clears[1]!.clean && clears[1]!.bonus).toBe(CLEAN_BONUS * 2);
    expect(ev.some((e) => e.k === "life" && e.delta === 1)).toBe(true);
    const enc = ev.find((e) => e.k === "encore");
    expect(enc && enc.k === "encore" && enc.bonus).toBe(ENCORE_BONUS + ENCORE_PER_LIFE * LIVES);
    expect(run.won).toBe(true);
  });

  it("climbs the multiplier with the combo", () => {
    const run = new Run({ seed: 2 });
    const pilot = new Pilot(SHOWMAN, 9);
    const seen: number[] = [];
    while (!run.over && run.now < 200) {
      pilot.play(run);
      run.step(dt);
      for (const e of run.events) if (e.k === "mult") seen.push(e.mult);
      run.events.length = 0;
    }
    expect(seen).toEqual([2, 3, 4, 5]);
    expect(run.stats.bestCombo).toBeGreaterThanOrEqual(MULT_AT[4]!);
  });
});

describe("run lengths", () => {
  it("lands every skill level inside 20–90 s at the median, the first seconds hard to fail", () => {
    for (const skill of SKILLS) {
      const res = Array.from({ length: 24 }, (_, i) => simulate(500 + i * 131, skill));
      const m = median(res.map((r) => r.seconds));
      expect(m, skill.name).toBeGreaterThan(20);
      expect(m, skill.name).toBeLessThan(92);
      expect(Math.min(...res.map((r) => r.seconds)), skill.name).toBeGreaterThan(10);
    }
  });

  it("ranks better players higher", () => {
    const score = (k: number) => median(Array.from({ length: 16 }, (_, i) => simulate(900 + i * 17, SKILLS[k]!).score));
    expect(score(0)).toBeLessThan(score(1));
    expect(score(1)).toBeLessThan(score(2));
    expect(score(2)).toBeLessThan(score(3));
  });
});

describe("the manifest", () => {
  it("is a tap game: the feed keeps vertical swipes", () => {
    expect(manifest.controls.vertical).toBe(false);
    expect(manifest.description.length).toBeLessThanOrEqual(120);
    expect(manifest.score.order).toBe("desc");
  });
});
