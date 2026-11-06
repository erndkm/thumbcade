import { describe, expect, it } from "vitest";
import { COMBO_WINDOW, FIRE_FROM, FIRST_BOSS, HEARTS, INV_TIME, multFor, POWER_TIME, Sim, TIERS, type SimEvent } from "../src/sim.ts";

const step = (sim: Sim, seconds: number, dt = 1 / 60): SimEvent[] => {
  const out: SimEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    sim.step(dt);
    out.push(...sim.events);
    sim.events.length = 0;
  }
  return out;
};

/** A spark right on the iron. */
const sparkAt = (sim: Sim, dx = 0, dy = 0) => sim.sparks.push({ id: 9e6 + sim.sparks.length, x: sim.hero.x + dx, y: sim.hero.y + dy, vx: 0, vy: 0, r: 9, t: 0, alive: true });

describe("the iron", () => {
  it("moves by the thumb's motion and stays in the field, below the boss line", () => {
    const sim = new Sim({ seed: 1 });
    const { x, y } = sim.hero;
    sim.moveBy(30, -20);
    expect(sim.hero.x).toBeCloseTo(x + 30);
    expect(sim.hero.y).toBeCloseTo(y - 20);
    sim.moveBy(-9999, -9999);
    expect(sim.hero.x).toBe(20);
    expect(sim.hero.y).toBe(sim.ceiling);
    expect(sim.ceiling).toBeGreaterThan(sim.top + 140);
    sim.moveBy(9999, 9999);
    expect(sim.hero.x).toBe(sim.w - 20);
    expect(sim.hero.y).toBe(sim.h - 34);
  });

  it("fires on its own: nine puffs a second, three-way with triple steam, faster with turbo", () => {
    const sim = new Sim({ seed: 2 });
    const shots = (s: Sim, sec: number) => step(s, sec).filter((e) => e.k === "fire").reduce((n, e) => n + (e.k === "fire" ? e.n : 0), 0);
    expect(shots(sim, 2)).toBeGreaterThanOrEqual(16);
    const spread = new Sim({ seed: 2 });
    spread.hero.power.spread = 5;
    const volleys = step(spread, 1).filter((e) => e.k === "fire");
    expect(volleys.every((e) => e.k === "fire" && e.n === 3)).toBe(true);
    const turbo = new Sim({ seed: 2 });
    turbo.hero.power.rapid = 5;
    expect(shots(turbo, 2)).toBeGreaterThan(shots(new Sim({ seed: 2 }), 2) * 1.6);
  });
});

describe("enemies", () => {
  it("never fire in the first eight seconds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = new Sim({ seed });
      const ev = step(sim, FIRE_FROM - 0.05);
      expect(ev.some((e) => e.k === "spark"), `seed ${seed}`).toBe(false);
      expect(sim.sparks.length).toBe(0);
    }
  });

  it("start with a clothesline of socks, then a V of fluff", () => {
    const sim = new Sim({ seed: 3 });
    const waves = step(sim, 6).filter((e) => e.k === "wave").map((e) => (e.k === "wave" ? e.kind : ""));
    expect(waves.slice(0, 2)).toEqual(["line", "vee"]);
  });

  it("drop loose change when pressed, and score with the multiplier", () => {
    const sim = new Sim({ seed: 4 });
    const ev = step(sim, 6);
    const kills = ev.filter((e) => e.k === "kill");
    expect(kills.length).toBeGreaterThan(0);
    expect(sim.pickups.length + sim.stats.coins).toBeGreaterThan(0);
    for (const k of kills) if (k.k === "kill") expect(k.pts % k.mult).toBe(0);
  });

  it("a whole clothesline pressed pays a bonus and drops a power-up sticker", () => {
    // The iron parks under the line and sweeps it.
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new Sim({ seed });
      let cleared = false;
      for (let i = 0; i < 60 * 8 && !cleared; i++) {
        const socks = sim.enemies.filter((e) => e.kind === "sock");
        if (socks.length) sim.moveBy(Math.max(-12, Math.min(12, socks[0]!.x - sim.hero.x)), 0);
        sim.step(1 / 60);
        for (const e of sim.events) if (e.k === "clear" && e.kind === "line") cleared = true;
        sim.events.length = 0;
      }
      if (!cleared) continue;
      expect(sim.pickups.some((p) => p.kind === "spread" || p.kind === "rapid" || p.kind === "shield" || p.kind === "magnet" || p.kind === "heart")).toBe(true);
      expect(sim.stats.clears).toBe(1);
      return;
    }
    throw new Error("no seed cleared the first clothesline");
  });
});

describe("combo", () => {
  it("steps the multiplier at the tiers", () => {
    expect(multFor(0)).toBe(1);
    expect(multFor(TIERS[1]! - 1)).toBe(1);
    expect(multFor(TIERS[1]!)).toBe(2);
    expect(multFor(TIERS[2]!)).toBe(3);
    expect(multFor(10_000)).toBe(TIERS.length);
  });

  it("builds on pickups and cools off after the window", () => {
    const sim = new Sim({ seed: 5 });
    for (let i = 0; i < TIERS[1]!; i++) sim.pickups.push({ id: 1e6 + i, kind: "coin", x: sim.hero.x, y: sim.hero.y, vx: 0, vy: 0, t: 1, alive: true, pulled: false });
    const ev = step(sim, 0.1);
    expect(sim.mult).toBe(2);
    expect(ev.some((e) => e.k === "tier" && e.mult === 2)).toBe(true);
    // Park in a corner where nothing happens and let it cool.
    sim.moveBy(-999, 999);
    const later = step(sim, COMBO_WINDOW + 0.2);
    expect(sim.combo === 0 || later.some((e) => e.k === "kill" || e.k === "pickup")).toBe(true);
  });
});

describe("hearts", () => {
  it("one hit costs one heart, then a breather; three hits end the run", () => {
    const sim = new Sim({ seed: 6 });
    sparkAt(sim);
    let ev = step(sim, 1 / 60);
    expect(ev.filter((e) => e.k === "hurt")).toHaveLength(1);
    expect(sim.hero.hearts).toBe(HEARTS - 1);
    // A second spark during the breather is forgiven.
    sparkAt(sim);
    ev = step(sim, 1 / 60);
    expect(ev.some((e) => e.k === "hurt")).toBe(false);
    expect(sim.hero.hearts).toBe(HEARTS - 1);
    step(sim, INV_TIME + 0.05);
    sparkAt(sim);
    step(sim, 1 / 60);
    step(sim, INV_TIME + 0.05);
    sparkAt(sim);
    ev = step(sim, 1 / 60);
    expect(sim.hero.hearts).toBe(0);
    expect(sim.over).toBe(true);
    expect(ev.some((e) => e.k === "over")).toBe(true);
  });

  it("the softener shield takes a hit instead of a heart", () => {
    const sim = new Sim({ seed: 7 });
    sim.hero.power.shield = POWER_TIME.shield;
    sparkAt(sim);
    const ev = step(sim, 1 / 60);
    expect(ev.some((e) => e.k === "shield")).toBe(true);
    expect(sim.hero.hearts).toBe(HEARTS);
    expect(sim.hero.power.shield).toBe(0);
  });

  it("a hit clears the sparks right around the iron, so one mistake never costs two hearts", () => {
    const sim = new Sim({ seed: 8 });
    sparkAt(sim);
    sparkAt(sim, 40, -40);
    step(sim, 1 / 60);
    expect(sim.sparks.filter((s) => Math.hypot(s.x - sim.hero.x, s.y - sim.hero.y) < 100)).toHaveLength(0);
  });

  it("attract mode never ends", () => {
    const sim = new Sim({ seed: 9, demo: true });
    for (let i = 0; i < 10; i++) {
      sparkAt(sim);
      step(sim, INV_TIME + 0.1);
    }
    expect(sim.over).toBe(false);
    expect(sim.hero.hearts).toBeGreaterThanOrEqual(1);
  });
});

describe("pickups and power-ups", () => {
  it("static cling pulls loose change across the sky", () => {
    const sim = new Sim({ seed: 10 });
    sim.hero.power.magnet = POWER_TIME.magnet;
    sim.pickups.push({ id: 5e6, kind: "coin", x: 30, y: sim.top + 200, vx: 0, vy: 0, t: 1, alive: true, pulled: false });
    sim.moveBy(200, 0);
    const ev = step(sim, 1.2);
    expect(ev.some((e) => e.k === "pickup")).toBe(true);
  });

  it("power-ups run out with an event", () => {
    const sim = new Sim({ seed: 11 });
    sim.pickups.push({ id: 5e6, kind: "rapid", x: sim.hero.x, y: sim.hero.y, vx: 0, vy: 0, t: 1, alive: true, pulled: false });
    const ev = step(sim, POWER_TIME.rapid + 0.5);
    expect(ev.some((e) => e.k === "power" && e.kind === "rapid")).toBe(true);
    expect(ev.some((e) => e.k === "powerEnd" && e.kind === "rapid")).toBe(true);
    expect(sim.hero.power.rapid).toBe(0);
  });
});

describe("bosses", () => {
  it("the first rolls in a little after 21 s, and an iron parked under it breaks it", () => {
    const sim = new Sim({ seed: 12 });
    let inAt = -1;
    let broke = -1;
    while (sim.t < 60 && broke < 0) {
      // Stay alive (this test is about the boss), and follow it.
      sim.hero.inv = 1;
      if (sim.boss) sim.moveBy(Math.max(-10, Math.min(10, sim.boss.x - sim.hero.x)), 0);
      sim.step(1 / 60);
      for (const e of sim.events) {
        if (e.k === "bossIn" && inAt < 0) inAt = sim.t;
        if (e.k === "bossBreak") broke = sim.t;
      }
      sim.events.length = 0;
    }
    expect(inAt).toBeGreaterThanOrEqual(FIRST_BOSS);
    expect(inAt).toBeLessThan(FIRST_BOSS + 5);
    expect(broke).toBeGreaterThan(inAt);
    expect(sim.stats.bosses).toBe(1);
    expect(sim.pickups.filter((p) => p.kind === "coin").length).toBeGreaterThan(10);
  });

  it("a boss nobody hurts gets bored and leaves", () => {
    const sim = new Sim({ seed: 13 });
    let left = false;
    while (sim.t < 70 && !left) {
      sim.hero.inv = 1;
      sim.hero.fireT = 1; // the iron's steam is off
      sim.step(1 / 60);
      for (const e of sim.events) if (e.k === "bossLeave") left = true;
      sim.events.length = 0;
    }
    expect(left).toBe(true);
  });
});

describe("determinism", () => {
  it("the same seed and the same thumb give the same run", () => {
    const play = () => {
      const sim = new Sim({ seed: 77 });
      for (let i = 0; i < 60 * 30 && !sim.over; i++) {
        sim.moveBy(Math.sin(i / 40) * 4, Math.cos(i / 55) * 2);
        sim.step(1 / 60);
        sim.events.length = 0;
      }
      return [sim.t, sim.score, sim.hero.hearts, sim.stats.kills];
    };
    expect(play()).toEqual(play());
  });
});
