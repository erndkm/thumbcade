import { describe, expect, it } from "vitest";
import { CHAIN_HOLD, GRAZE_R, MAX_LEVEL, MAX_SHIELDS, MULT_STEPS, SHIP_HIT_R } from "../src/consts.ts";
import { SKILLS } from "../src/pilot.ts";
import { playRun } from "../src/runs.ts";
import { EV, multFor, Sim, sweepDist2, type SimEvent } from "../src/sim.ts";
import { LOOP, LOOP_BOSS, LOOP_WARN, OVERDRIVE_FROM } from "../src/waves.ts";

const H = 696;
const DT = 1 / 60;

function run(sim: Sim, seconds: number, each?: (s: Sim) => void): SimEvent[] {
  const seen: SimEvent[] = [];
  const end = sim.t + seconds;
  while (sim.t < end - 1e-9) {
    each?.(sim);
    sim.step(DT);
    sim.drain((e) => seen.push({ ...e }));
  }
  return seen;
}

/** A sim with nothing scripted happening yet: we place things by hand. */
function bare(): Sim {
  const s = new Sim({ seed: 1, fieldH: H, noScript: true });
  s.placeShip(180, 500);
  return s;
}

describe("wave script", () => {
  it("is in time order, and the warning and the Loom come after the last wave", () => {
    for (let i = 1; i < LOOP.length; i++) expect(LOOP[i]!.at).toBeGreaterThanOrEqual(LOOP[i - 1]!.at);
    expect(LOOP[LOOP.length - 1]!.at).toBeLessThan(LOOP_WARN);
    expect(LOOP_WARN).toBeLessThan(LOOP_BOSS);
    expect(OVERDRIVE_FROM).toBeGreaterThan(LOOP[0]!.at);
  });

  it("fires nothing before 12 s and can't be lost in the first 10 s, wherever the ship sits", () => {
    for (const [x, y] of [[180, 9999], [20, 0], [340, 0], [180, 0], [60, 400]] as const) {
      const sim = new Sim({ seed: 7, fieldH: H });
      sim.placeShip(x, y);
      const ev = run(sim, 10);
      expect(ev.some((e) => e.type === EV.shieldHit), `ship at ${x},${y}`).toBe(false);
      run(sim, 1.9);
      expect(sim.bullets.length).toBe(0);
    }
  });

  it("an idle ship is lost well inside a minute (so every run ends)", () => {
    const sim = new Sim({ seed: 3, fieldH: H });
    run(sim, 60);
    expect(sim.dead).toBe(true);
    expect(sim.stats.timeAlive).toBeGreaterThan(14);
    expect(sim.stats.timeAlive).toBeLessThan(45);
  });

  it("warns, then brings the Loom, on schedule", () => {
    const sim = new Sim({ seed: 2, fieldH: H });
    // Keep the ship alive: we only care about the schedule here.
    const ev = run(sim, LOOP_BOSS + 0.5, (s) => {
      s.ship.invuln = 1;
    });
    const warn = ev.find((e) => e.type === EV.warning);
    const boss = ev.find((e) => e.type === EV.bossIn);
    expect(warn).toBeDefined();
    expect(boss).toBeDefined();
    expect(sim.phase).toBe("boss");
    expect(sim.enemies.filter((e) => e.kind === "arm")).toHaveLength(6);
  });
});

describe("collisions and the hitbox", () => {
  it("only the tiny hitbox counts", () => {
    const sim = bare();
    sim.ship.invuln = 0;
    // A bullet passing just outside the hitbox (bullet radius + ship radius) misses.
    sim.fire(180 + 4.2 + SHIP_HIT_R + 1.5, 420, 0, 200);
    run(sim, 0.8);
    expect(sim.ship.shields).toBe(MAX_SHIELDS);
    // One passing through the centre hits.
    sim.fire(180, 420, 0, 200);
    run(sim, 0.8);
    expect(sim.ship.shields).toBe(MAX_SHIELDS - 1);
  });

  it("a fast drag sweeps: the ship can't jump over a bullet", () => {
    const sim = bare();
    sim.fire(180, 500, 0, 0); // a bullet sitting still in front of the ship
    sim.placeShip(120, 500);
    sim.moveShip(120, 0); // one frame from x=120 to x=240, straight through it
    sim.step(DT);
    expect(sim.ship.shields).toBe(MAX_SHIELDS - 1);
  });

  it("the swept distance is the closest approach", () => {
    expect(sweepDist2(0, 0, 10, 0, 5, 3)).toBeCloseTo(9);
    expect(sweepDist2(0, 0, 10, 0, -4, 0)).toBeCloseTo(16);
  });

  it("a hit clears nearby bullets and gives a moment of cover", () => {
    const sim = bare();
    for (let i = 0; i < 8; i++) sim.fire(180 + (i - 4) * 12, 480, 0, 60);
    sim.fire(180, 470, 0, 120);
    run(sim, 0.5);
    expect(sim.ship.shields).toBe(MAX_SHIELDS - 1);
    expect(sim.ship.invuln).toBeGreaterThan(1);
    expect(sim.bullets.filter((b) => Math.hypot(b.x - 180, b.y - 500) < 100)).toHaveLength(0);
  });
});

describe("grazing", () => {
  it("a bullet that skims past pays once, tops up the chain and never hurts", () => {
    const sim = bare();
    sim.chain = 9;
    sim.chainTimer = 0.5;
    const before = sim.score;
    sim.fire(180 + GRAZE_R - 6, 400, 0, 220);
    const ev = run(sim, 1);
    const grazes = ev.filter((e) => e.type === EV.graze);
    expect(grazes).toHaveLength(1);
    expect(sim.stats.grazes).toBe(1);
    expect(sim.ship.shields).toBe(MAX_SHIELDS);
    expect(sim.score - before).toBeGreaterThanOrEqual(10 * multFor(9));
  });

  it("no graze while invulnerable", () => {
    const sim = bare();
    sim.ship.invuln = 2;
    sim.fire(180 + 12, 400, 0, 220);
    run(sim, 1);
    expect(sim.stats.grazes).toBe(0);
  });
});

describe("the chain multiplier", () => {
  it("steps up at the thresholds", () => {
    expect(multFor(0)).toBe(1);
    for (let i = 1; i < MULT_STEPS.length; i++) {
      expect(multFor(MULT_STEPS[i]!)).toBe(i + 1);
      expect(multFor(MULT_STEPS[i]! - 0.01)).toBe(i);
    }
  });

  it("holds for a moment after a kill, then drains", () => {
    const sim = bare();
    sim.chain = 40;
    sim.chainTimer = CHAIN_HOLD;
    run(sim, CHAIN_HOLD - 0.1);
    expect(sim.chain).toBe(40);
    expect(sim.mult).toBe(multFor(40));
    const ev = run(sim, 2);
    expect(sim.chain).toBeLessThan(20);
    expect(ev.some((e) => e.type === EV.multDown)).toBe(true);
  });

  it("a hit halves it", () => {
    const sim = bare();
    sim.chain = 60;
    sim.chainTimer = CHAIN_HOLD;
    sim.fire(180, 470, 0, 120);
    run(sim, 0.5);
    expect(sim.chain).toBeLessThanOrEqual(30);
  });
});

describe("upgrades", () => {
  function pick(sim: Sim, kind: "power" | "drone" | "shield" | "nova") {
    // Drop a pickup right on the ship.
    (sim as unknown as { dropPickup(k: string, x: number, y: number, vx: number, vy: number): void }).dropPickup(kind, sim.ship.x, sim.ship.y, 0, 0);
    run(sim, 0.4);
  }

  it("power raises the gun a level, up to the top, then pays", () => {
    const sim = bare();
    for (let l = 2; l <= MAX_LEVEL; l++) {
      pick(sim, "power");
      expect(sim.ship.level).toBe(l);
    }
    const s0 = sim.score;
    pick(sim, "power");
    expect(sim.ship.level).toBe(MAX_LEVEL);
    expect(sim.score - s0).toBeGreaterThanOrEqual(2000);
  });

  it("a hit costs one shield and at most one gun level, which pops out to be caught again", () => {
    const sim = bare();
    sim.ship.level = 4;
    sim.fire(180, 470, 0, 120);
    const ev = run(sim, 0.3);
    expect(sim.ship.shields).toBe(MAX_SHIELDS - 1);
    expect(sim.ship.level).toBe(3);
    expect(ev.find((e) => e.type === EV.shieldHit)?.b).toBe(1);
    const back = sim.pickups.find((p) => p.recover);
    expect(back?.kind).toBe("power");
    // It floats up and drifts back down onto the ship.
    run(sim, 2.5, (s) => {
      const p = s.pickups.find((q) => q.recover);
      if (p) s.moveShip(p.x - s.ship.x, p.y - s.ship.y);
    });
    expect(sim.ship.level).toBe(4);
  });

  it("the gun never drops below level 1", () => {
    const sim = bare();
    sim.fire(180, 470, 0, 120);
    run(sim, 0.3);
    expect(sim.ship.level).toBe(1);
    expect(sim.pickups.some((p) => p.recover)).toBe(false);
  });

  it("drones cap at two, shields at three", () => {
    const sim = bare();
    pick(sim, "drone");
    pick(sim, "drone");
    pick(sim, "drone");
    expect(sim.ship.drones).toBe(2);
    sim.ship.shields = 2;
    pick(sim, "shield");
    pick(sim, "shield");
    expect(sim.ship.shields).toBe(MAX_SHIELDS);
  });

  it("a nova turns the bullets on screen into crystals", () => {
    const sim = bare();
    for (let i = 0; i < 30; i++) sim.fire(20 + i * 10, 120, 0, 0);
    pick(sim, "nova");
    run(sim, 0.6);
    expect(sim.bullets).toHaveLength(0);
    expect(sim.crystals.length).toBeGreaterThan(0);
  });
});

describe("scoring", () => {
  it("a kill pays its value times the multiplier and adds to the chain", () => {
    const sim = bare();
    sim.chain = MULT_STEPS[3]!;
    sim.chainTimer = CHAIN_HOLD;
    const e = sim.spawn("bloom", "drop", 180, 200, 200, 0.01, 99, -70)!;
    e.entered = true;
    const s0 = sim.score;
    const ev = run(sim, 1.5);
    const kill = ev.find((x) => x.type === EV.kill);
    expect(kill?.a).toBe(400 * 4);
    expect(sim.score - s0).toBeGreaterThanOrEqual(1600);
    expect(sim.chain).toBeGreaterThan(MULT_STEPS[3]!);
  });

  it("the formation bonus needs the whole formation, none escaped", () => {
    const whole = bare();
    whole.hookChain(180, 4, 0, 0.3, { gap: 0.05 });
    const ev = run(whole, 4);
    expect(ev.some((e) => e.type === EV.formation)).toBe(true);

    const broken = bare();
    broken.placeShip(20, 500); // nowhere near: most of them get away
    broken.hookChain(300, 4, 0, 0.3, { gap: 0.05 });
    const ev2 = run(broken, 5);
    expect(ev2.some((e) => e.type === EV.formation)).toBe(false);
  });

  it("crystals drift to the ship and pay on arrival", () => {
    const sim = bare();
    const e = sim.spawn("dart", "swoop", 180, 0, 0, 0, 60)!;
    e.t = 3;
    const ev = run(sim, 3);
    expect(ev.some((x) => x.type === EV.kill)).toBe(true);
    expect(ev.filter((x) => x.type === EV.crystal).length).toBeGreaterThanOrEqual(2);
    expect(sim.crystals).toHaveLength(0);
  });
});

describe("the Loom", () => {
  function atBoss(): Sim {
    const sim = new Sim({ seed: 5, fieldH: H });
    run(sim, LOOP_BOSS + 3, (s) => {
      s.ship.invuln = 1;
    });
    return sim;
  }

  it("its eye is armoured until all six arms are broken", () => {
    const sim = atBoss();
    const core = sim.enemies.find((e) => e.kind === "core")!;
    expect(core.armor).toBe(true);
    const hp = core.hp;
    // Pour fire straight up at the eye: it glances off while the arms stand.
    run(sim, 1, (s) => {
      s.ship.invuln = 1;
      s.ship.level = 5;
      s.moveShip(core.x - s.ship.x, 0);
    });
    expect(core.hp).toBe(hp);
    for (const e of sim.enemies) if (e.kind === "arm") e.hp = 0.5;
    run(sim, 3, (s) => {
      s.ship.invuln = 1;
      s.ship.level = 5;
      const a = s.enemies.find((x) => x.kind === "arm");
      if (a) s.moveShip(a.x - s.ship.x, 0);
    });
    expect(sim.enemies.filter((e) => e.kind === "arm")).toHaveLength(0);
    expect(sim.boss.phase).toBe("core");
    expect(core.armor).toBe(false);
  });

  it("falls into a bonus, turns its bullets to crystals, then overdrive begins", () => {
    const sim = atBoss();
    for (const e of sim.enemies) if (e.kind === "arm") e.hp = 0.1;
    const ev = run(sim, 12, (s) => {
      s.ship.invuln = 1;
      s.ship.level = 5;
      const core = s.enemies.find((x) => x.kind === "core");
      const a = s.enemies.find((x) => x.kind === "arm");
      const t = a ?? core;
      if (t) s.moveShip(t.x - s.ship.x, 0);
      if (core && !a) core.hp = Math.min(core.hp, 5);
    });
    const dead = ev.find((e) => e.type === EV.bossDead);
    expect(dead).toBeDefined();
    expect(dead!.a).toBeGreaterThanOrEqual(25000);
    expect(sim.stats.bossesKilled).toBe(1);
    expect(ev.some((e) => e.type === EV.loop)).toBe(true);
    expect(sim.loop).toBe(1);
    expect(sim.d).toBeGreaterThan(3);
  });
});

describe("determinism", () => {
  function scripted(seed: number): { score: number; kills: number; events: string } {
    const sim = new Sim({ seed, fieldH: H });
    let i = 0;
    const types: number[] = [];
    while (sim.t < 30 && sim.ship.alive) {
      // The same thumb every time: a slow figure of eight.
      sim.moveShip(Math.sin(i * 0.05) * 3, Math.cos(i * 0.031) * 2);
      sim.step(DT);
      sim.drain((e) => types.push(e.type, Math.round(e.x)));
      i++;
    }
    return { score: sim.score, kills: sim.stats.kills, events: types.join(",") };
  }

  it("the same seed and inputs give the same run", () => {
    const a = scripted(1234);
    const b = scripted(1234);
    expect(a).toEqual(b);
    expect(a.kills).toBeGreaterThan(10);
  });

  it("the same run at a different frame rate lands in the same place", () => {
    const at = (dt: number) => {
      const sim = new Sim({ seed: 9, fieldH: H });
      while (sim.t < 8 - 1e-9) sim.step(dt);
      return { t: sim.t, kills: sim.stats.kills, enemies: sim.enemies.length };
    };
    const a = at(1 / 120);
    const b = at(1 / 120);
    expect(a).toEqual(b);
    expect(at(1 / 60).enemies).toBe(a.enemies);
  });
});

describe("run lengths (headless pilot)", () => {
  it("land inside 20-120 s for every skill, and skill pays", () => {
    const seeds = [11, 22, 33, 44, 55, 66];
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const novice = median(seeds.map((s) => playRun(SKILLS.novice, s).seconds));
    const good = median(seeds.map((s) => playRun(SKILLS.good, s).seconds));
    expect(novice).toBeGreaterThan(20);
    expect(good).toBeLessThan(130);
    expect(good).toBeGreaterThan(novice);
  });
});
