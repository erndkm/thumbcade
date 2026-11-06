import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { STEP } from "../src/physics.ts";
import { Pilot, SKILLS } from "../src/pilot.ts";
import { CAKE_BONUS, CHAIN_KNOCK, COOLDOWN, FLOOR0, firstBonus, GRACE, HOLD_Y, KNOCK, points, RIM, riseRate, Run, runSeed, SHOWSTOPPER, TIN_W, type RunEvent } from "../src/run.ts";
import { radius, TIERS, TOP } from "../src/tiers.ts";

function stepFor(run: Run, seconds: number): RunEvent[] {
  const out: RunEvent[] = [];
  for (let t = 0; t < seconds; t += STEP) {
    run.update(STEP);
    out.push(...run.events);
    run.events.length = 0;
  }
  return out;
}

/** Puts a piece straight onto the dough at x. */
function place(run: Run, tier: number, x: number, y = run.world.floor + radius(tier)): number {
  return run.world.add(tier, x, y, radius(tier));
}

describe("merging", () => {
  it("squishes two touching twins into the next bake at their contact point", () => {
    const run = new Run(1, { attract: false });
    const r = radius(2);
    place(run, 2, 4, run.world.floor + r);
    place(run, 2, 4 + 2 * r + 0.01, run.world.floor + r);
    const ev = stepFor(run, 0.05);
    const m = ev.find((e) => e.type === "merge");
    expect(m).toBeDefined();
    if (m?.type !== "merge") return;
    expect(m.tier).toBe(3);
    expect(m.x).toBeCloseTo(4 + r + 0.005, 1);
    expect(m.chain).toBe(1);
    expect(m.pts).toBe(points(3));
    expect(run.world.n).toBe(1);
    expect(run.world.tier[0]).toBe(3);
    expect(run.score).toBe(points(3));
  });

  it("leaves different bakes alone", () => {
    const run = new Run(2);
    place(run, 1, 4);
    place(run, 2, 4 + radius(1) + radius(2));
    const ev = stepFor(run, 1);
    expect(ev.some((e) => e.type === "merge")).toBe(false);
    expect(run.world.n).toBe(2);
  });

  it("chains: a fresh bake that meets its twin merges again and pays double", () => {
    const run = new Run(3);
    // Two gumdrops meet in the air above a cookie: the cookie they make drops onto it.
    place(run, 2, 3.6);
    place(run, 1, 3.6 - radius(1), 5);
    place(run, 1, 3.6 + radius(1), 5);
    const ev = stepFor(run, 1.5).filter((e) => e.type === "merge");
    expect(ev.map((e) => e.type === "merge" && e.tier)).toEqual([2, 3]);
    const second = ev[1]!;
    expect(second.type === "merge" && second.chain).toBe(2);
    expect(second.type === "merge" && second.pts).toBe(points(3) * 2);
    expect(run.stats.biggestChain).toBe(2);
  });

  it("bakes the party cake from two pies, with the jackpot bonus", () => {
    const run = new Run(4);
    const r = radius(TOP - 1);
    place(run, TOP - 1, r, run.world.floor + r);
    place(run, TOP - 1, r * 3, run.world.floor + r);
    const ev = stepFor(run, 0.2);
    const m = ev.find((e) => e.type === "merge");
    expect(m?.type === "merge" && m.tier).toBe(TOP);
    expect(m?.type === "merge" && m.pts).toBe(points(TOP) + firstBonus(TOP) + CAKE_BONUS);
    expect(run.stats.cakes).toBe(1);
  });

  it("sends two party cakes out of the tin as a showstopper and punches the dough all the way down", () => {
    const run = new Run(5);
    run.floorTarget = 4;
    run.world.floor = 4;
    const r = radius(TOP);
    place(run, TOP, r);
    place(run, TOP, r * 3);
    let s: RunEvent | undefined;
    for (let t = 0; t < 0.5 && !s; t += STEP) {
      run.update(STEP);
      s = run.events.find((e) => e.type === "showstopper");
      run.events.length = 0;
    }
    expect(s?.type === "showstopper" && s.pts).toBe(SHOWSTOPPER);
    expect(run.world.n).toBe(0);
    expect(run.floorTarget).toBeLessThan(FLOOR0 + 0.01);
    expect(run.stats.showstoppers).toBe(1);
  });

  it("gives the new-bake bonus only the first time a run makes a tier", () => {
    const run = new Run(6);
    const make = () => {
      const r = radius(3);
      place(run, 3, r);
      place(run, 3, r * 3);
      return stepFor(run, 0.1).find((e) => e.type === "merge");
    };
    const a = make();
    stepFor(run, 1);
    run.world.clear();
    const b = make();
    expect(a?.type === "merge" && a.first && a.bonus).toBe(firstBonus(4));
    expect(b?.type === "merge" && b.first).toBe(false);
    expect(b?.type === "merge" && b.bonus).toBe(0);
  });
});

describe("merges in real play", () => {
  it("never throw a settled piece up out of the pile", () => {
    for (const seed of [1, 2, 3, 4]) {
      const run = new Run(seed);
      const pilot = new Pilot(SKILLS[3]!, createRng(seed));
      let aimed = false;
      let up = 0;
      for (let t = 0; t < 120 && run.phase === "play"; t += 1 / 60) {
        if (run.canDrop && !aimed) {
          pilot.decide(run);
          aimed = true;
        }
        if (aimed && pilot.tick(run, 1 / 60)) {
          run.aim(pilot.target);
          run.drop();
          aimed = false;
        }
        run.update(1 / 60);
        run.events.length = 0;
        const w = run.world;
        for (let i = 0; i < w.n; i++) if (w.age[i]! > 1.5 && !(w.chain[i]! > 0 && w.age[i]! < 0.5)) up = Math.max(up, w.vy[i]!);
      }
      // A merge lifts what's above it a little (a hop of a few pixels at most), never launches it.
      expect(up, `seed ${seed}`).toBeLessThan(8);
    }
  });
});

describe("the starter (the pressure)", () => {
  it("rises on its own, faster as the run goes on", () => {
    const run = new Run(7);
    stepFor(run, 10);
    const at10 = run.world.floor;
    expect(at10).toBeGreaterThan(FLOOR0 + 0.5);
    stepFor(run, 10);
    expect(run.world.floor - at10).toBeGreaterThan(at10 - FLOOR0);
    expect(riseRate(60)).toBeGreaterThan(riseRate(0) * 3);
  });

  it("is knocked back by merges, harder for bigger bakes and longer chains", () => {
    for (const tier of [2, 6]) {
      const run = new Run(8);
      run.floorTarget = 5;
      run.world.floor = 5;
      const r = radius(tier - 1);
      place(run, tier - 1, 2 + r);
      place(run, tier - 1, 2 + r * 3);
      const before = run.floorTarget;
      const m = stepFor(run, 0.05).find((e) => e.type === "merge");
      expect(m?.type === "merge" && m.knock).toBeCloseTo(KNOCK[tier]!, 5);
      expect(before - run.floorTarget).toBeGreaterThan(KNOCK[tier]! - riseRate(0.1) * 0.1);
    }
    expect(KNOCK[8]).toBeGreaterThan(KNOCK[2]! * 4);
    expect(CHAIN_KNOCK).toBeGreaterThan(0);
  });

  it("never knocks back below where it started", () => {
    const run = new Run(9);
    const r = radius(7);
    place(run, 7, r);
    place(run, 7, r * 3);
    stepFor(run, 1);
    expect(run.floorTarget).toBeGreaterThanOrEqual(FLOOR0);
    expect(run.world.floor).toBeGreaterThanOrEqual(FLOOR0);
  });

  it("stays put in attract mode", () => {
    const run = new Run(10, { attract: true });
    stepFor(run, 20);
    expect(run.world.floor).toBe(FLOOR0);
  });
});

describe("the rim", () => {
  /** A party cake sitting on dough high enough that its top is over the rim. */
  function overfull(seed: number): Run {
    const run = new Run(seed);
    run.floorTarget = RIM - 3;
    run.world.floor = RIM - 3;
    place(run, TOP, 5);
    return run;
  }

  it("counts down a visible grace, then spills", () => {
    const run = overfull(11);
    // Hold the dough where it is: only the pile is over.
    const ev: RunEvent[] = [];
    for (let t = 0; t < GRACE + 1 && run.phase === "play"; t += STEP) {
      run.floorTarget = RIM - 3;
      run.update(STEP);
      ev.push(...run.events);
      run.events.length = 0;
    }
    expect(ev.find((e) => e.type === "danger")).toMatchObject({ on: true });
    expect(ev.filter((e) => e.type === "grace").map((e) => e.type === "grace" && e.left)).toEqual([3, 2, 1]);
    const over = ev.find((e) => e.type === "over");
    expect(over).toMatchObject({ reason: "pile" });
    expect(run.phase).toBe("over");
    // The spill comes once the grace is used up (plus the moment a new piece needs to count).
    expect(run.stats.overTime).toBeGreaterThanOrEqual(GRACE - STEP);
  });

  it("forgives a pile that drops back under the rim in time", () => {
    const run = overfull(12);
    stepFor(run, 2.2);
    expect(run.dangerOn).toBe(true);
    // A big merge (or a knock) brings it down: here the cake simply leaves.
    run.world.clear();
    const ev = stepFor(run, 1.5);
    expect(ev.find((e) => e.type === "danger")).toMatchObject({ on: false });
    expect(ev.some((e) => e.type === "over")).toBe(false);
    expect(run.danger).toBeLessThan(GRACE);
  });

  it("doesn't count a piece that is only just falling in", () => {
    const run = new Run(13);
    const i = run.world.add(4, 5, RIM + 0.5, radius(4));
    run.world.landed[i] = 1;
    run.update(STEP * 2);
    expect(run.dangerOn).toBe(false);
  });

  it("spills when the starter itself reaches the rim, even with an empty tin", () => {
    const run = new Run(14);
    let over: RunEvent | undefined;
    for (let t = 0; t < 200 && !over; t += 1 / 60) {
      run.update(1 / 60);
      over = run.events.find((e) => e.type === "over");
      run.events.length = 0;
    }
    expect(over).toMatchObject({ reason: "dough" });
    expect(run.elapsed).toBeLessThan(120);
  });
});

describe("the pinch", () => {
  it("opens every run with the same easy pieces, then only ever hands out the five small bakes", () => {
    const run = new Run(15);
    const seen: number[] = [run.held, run.next];
    for (let k = 0; k < 300; k++) {
      run.cooldown = 0;
      run.drop();
      seen.push(run.next);
      run.world.clear();
    }
    expect(seen.slice(0, 7)).toEqual([0, 0, 1, 0, 1, 2, 0]);
    expect(Math.max(...seen)).toBeLessThanOrEqual(3);
    // Truffles join the bag as the run goes on.
    run.elapsed = 60;
    for (let k = 0; k < 300; k++) {
      run.cooldown = 0;
      run.drop();
      seen.push(run.next);
      run.world.clear();
    }
    expect(Math.max(...seen)).toBe(4);
    expect(new Set(seen).size).toBe(5);
  });

  it("waits a short cooldown between drops", () => {
    const run = new Run(16);
    expect(run.drop()).toBeGreaterThan(0);
    expect(run.canDrop).toBe(false);
    expect(run.drop()).toBe(0);
    stepFor(run, COOLDOWN + STEP);
    expect(run.canDrop).toBe(true);
  });

  it("keeps the held piece inside the walls and drops it from the pinch", () => {
    const run = new Run(17);
    run.aim(-5);
    expect(run.aimX).toBeCloseTo(radius(run.held), 6);
    run.aim(99);
    expect(run.aimX).toBeCloseTo(TIN_W - radius(run.held), 6);
    run.aim(3.3);
    const id = run.drop();
    const i = run.world.indexOf(id);
    expect(run.world.x[i]).toBeCloseTo(3.3, 6);
    expect(run.world.y[i]).toBeCloseTo(HOLD_Y, 6);
  });

  it("gives each run its own deal, from the launch seed and the run number only", () => {
    expect(runSeed(1234, 0)).toBe(runSeed(1234, 0));
    expect(runSeed(1234, 0)).not.toBe(runSeed(1234, 1));
    expect(TIERS.length).toBeGreaterThanOrEqual(9);
  });
});
