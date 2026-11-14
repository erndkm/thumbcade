import { describe, expect, it } from "vitest";
import type { Ball } from "../src/physics.ts";
import { Game, GE, RULES, type Controls, type GameEvent } from "../src/rules.ts";
import { Sensor } from "../src/table.ts";

const IDLE: Controls = { left: false, right: false, launch: false };
const LAUNCH: Controls = { left: false, right: false, launch: true };

/** Steps the game `secs` at 60 Hz, collecting events. */
function play(g: Game, secs: number, c: Controls | ((t: number) => Controls) = IDLE, until?: (e: GameEvent) => boolean): GameEvent[] {
  const out: GameEvent[] = [];
  const t0 = g.t;
  let stop = false;
  while (g.t - t0 < secs && g.phase !== "over" && !stop) {
    g.step(1 / 60, typeof c === "function" ? c(g.t - t0) : c);
    g.drain((e) => {
      out.push({ ...e });
      if (until?.(e)) stop = true;
    });
  }
  return out;
}

/** A ball in play: launches the waiting one if needed. */
function ballInPlay(g: Game): Ball {
  for (let i = 0; i < 200; i++) {
    const b = g.world.balls.find((q) => q.live && q !== g.laneBall);
    if (b) return b;
    g.step(1 / 60, LAUNCH);
    g.evCount = 0;
  }
  throw new Error("no ball in play");
}

/** Puts a ball somewhere with a velocity (teleports the ball in play). */
function put(g: Game, x: number, y: number, vx = 0, vy = 0): Ball {
  const b = ballInPlay(g);
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.harbourImmune = 0;
  return b;
}

/** Shoots each flag from the front until all four are down. */
function dropFlags(g: Game): void {
  for (let i = 0; i < 4; i++) {
    if (!g.flags[i]) continue;
    const tg = g.def.targets[i]!;
    const mx = (tg.ax + tg.bx) / 2;
    const my = (tg.ay + tg.by) / 2;
    put(g, mx + tg.nx * 26, my + tg.ny * 26, -tg.nx * 900, -tg.ny * 900);
    play(g, 0.3, IDLE, (e) => e.type === GE.Target);
  }
}

/** Drops a ball into the harbour. */
function sink(g: Game): GameEvent[] {
  put(g, g.def.harbour.x, g.def.harbour.y - 2, 0, 40);
  return play(g, 0.2, IDLE, (e) => e.type === GE.Harbour);
}

describe("the run", () => {
  it("serves the first ball to the plunger; a tap launches it, or the tide takes it", () => {
    const g = new Game({ seed: 1 });
    expect(g.laneBall).not.toBeNull();
    let ev = play(g, 0.5);
    expect(ev.some((e) => e.type === GE.Launch)).toBe(false);
    ev = play(g, 0.2, LAUNCH);
    expect(ev.some((e) => e.type === GE.Launch)).toBe(true);
    const h = new Game({ seed: 2 });
    ev = play(h, RULES.autoLaunchFirst + 0.3);
    expect(ev.some((e) => e.type === GE.Launch)).toBe(true);
  });

  it("nobody loses the first ball inside 10 s, flipping or not", () => {
    for (let s = 0; s < 30; s++) {
      const g = new Game({ seed: 100 + s });
      let launchT = -1;
      let lostT = -1;
      while (g.phase !== "over" && lostT < 0 && g.t < 60) {
        g.step(1 / 60, s % 2 ? IDLE : { left: Math.floor(g.t * 3) % 2 === 0, right: false, launch: true });
        g.drain((e) => {
          if (e.type === GE.Launch && launchT < 0) launchT = g.t;
          if (e.type === GE.Drain) lostT = g.t;
        });
      }
      expect(lostT - launchT, `seed ${s}`).toBeGreaterThanOrEqual(10);
    }
  });

  it("an idle run ends on its own, inside 20-35 s", () => {
    for (let s = 0; s < 20; s++) {
      const g = new Game({ seed: 300 + s * 7 });
      const ev = play(g, 200);
      expect(g.phase).toBe("over");
      expect(g.t, `seed ${s}`).toBeGreaterThan(20);
      expect(g.t, `seed ${s}`).toBeLessThan(35);
      // Only the first ball's sure 10 s save anything: later balls get no lifeboat without a flip.
      const ball2 = ev.findIndex((e) => e.type === GE.BallStart);
      expect(ev.slice(ball2).some((e) => e.type === GE.Save)).toBe(false);
    }
  });

  it("random taps (the reviewer's script) still end the run inside 95 s", () => {
    for (let s = 0; s < 10; s++) {
      const g = new Game({ seed: 500 + s });
      let k = 0;
      play(g, 25);
      // A 60 ms tap every 300 ms, alternating halves.
      play(g, 70, (t) => {
        const phase = t % 0.3;
        const side = Math.floor(t / 0.3) % 2;
        k++;
        return { left: side === 0 && phase < 0.06, right: side === 1 && phase < 0.06, launch: phase < 0.017 };
      });
      expect(g.phase, `seed ${s}`).toBe("over");
      expect(k).toBeGreaterThan(0);
    }
  });

  it("the lifeboat saves a ball lost inside its window once you have flipped, and not after it", () => {
    const g = new Game({ seed: 9 });
    ballInPlay(g);
    play(g, 0.1, { left: true, right: false, launch: false });
    // Straight down the middle.
    put(g, 169, 600, 0, 900);
    let ev = play(g, 1, IDLE, (e) => e.type === GE.Save || e.type === GE.Drain);
    expect(ev.some((e) => e.type === GE.Save)).toBe(true);
    expect(g.ballNo).toBe(1);
    // Window and grace over: the same drain loses the ball.
    g.saveUntil = g.t - RULES.saveGrace - 1;
    put(g, 169, 600, 0, 900);
    ev = play(g, 1, IDLE, (e) => e.type === GE.Drain);
    expect(ev.some((e) => e.type === GE.Drain)).toBe(true);
    play(g, 2);
    expect(g.ballNo).toBe(2);
  });

  it("on later balls the lifeboat waits for a flip (so an idle run ends)", () => {
    const g = new Game({ seed: 10 });
    (g as unknown as { ballNo: number }).ballNo = 2;
    ballInPlay(g);
    expect(g.saveLeft).toBeGreaterThan(0);
    expect(g.lifeboatOn).toBe(false);
    put(g, 169, 600, 0, 900);
    const ev = play(g, 1, IDLE, (e) => e.type === GE.Drain || e.type === GE.Save);
    expect(ev.some((e) => e.type === GE.Drain)).toBe(true);
    expect(ev.some((e) => e.type === GE.Save)).toBe(false);
  });

  it("three balls, then the end; the last ball is the last", () => {
    const g = new Game({ seed: 4 });
    const ev = play(g, 200);
    expect(ev.filter((e) => e.type === GE.BallStart).map((e) => e.a)).toEqual([2, 3]);
    expect(ev.filter((e) => e.type === GE.Drain)).toHaveLength(3);
    expect(ev.at(-1)!.type).toBe(GE.GameOver);
    expect(g.phase).toBe("over");
  });
});

describe("the storm", () => {
  it("climbs a tier with the shots it needs, multiplies every point, and quickens the table", () => {
    const g = new Game({ seed: 5 });
    ballInPlay(g);
    expect(g.tier).toBe(1);
    const shot = (g as unknown as { shot: (x: number, y: number) => void }).shot.bind(g);
    const s0 = g.speed;
    for (let i = 0; i < RULES.tierNeed[0]!; i++) shot(100, 100);
    expect(g.tier).toBe(2);
    expect(g.speed).toBeGreaterThan(s0);
    // Points are multiplied by the tier.
    const before = g.score;
    const award = (g as unknown as { award: (b: number, x: number, y: number) => number }).award.bind(g);
    expect(award(100, 0, 0)).toBe(200);
    expect(g.score - before).toBe(200);
    for (let i = 0; i < 40; i++) shot(100, 100);
    expect(g.tier).toBe(5);
    expect(g.needed).toBe(0);
  });

  it("STORM lights the extra ball once; the harbour collects it, and the run gets a fourth ball", () => {
    const g = new Game({ seed: 6 });
    ballInPlay(g);
    const shot = (g as unknown as { shot: (x: number, y: number) => void }).shot.bind(g);
    const ev: GameEvent[] = [];
    while (g.tier < RULES.extraAt - 1) shot(0, 0);
    expect(g.extraLit).toBe(false);
    while (g.tier < RULES.extraAt) shot(0, 0);
    g.drain((e) => ev.push({ ...e }));
    expect(ev.some((e) => e.type === GE.ExtraLit)).toBe(true);
    expect(g.harbourLit).toBe("extra");
    const got = sink(g);
    expect(got.some((e) => e.type === GE.ExtraBall)).toBe(true);
    expect(g.ballsTotal).toBe(4);
    expect(g.extraLit).toBe(false);
    // Never twice.
    while (g.tier < 5) shot(0, 0);
    expect(g.extraLit).toBe(false);
  });

  it("speed creeps with the run's length and stops at the cap", () => {
    const g = new Game({ seed: 7 });
    expect(g.speed).toBe(1);
    g.t = RULES.creepStart + 50;
    expect(g.speed).toBeCloseTo(1 + 50 * RULES.creepRate);
    g.t = 1000;
    expect(g.speed).toBe(RULES.maxSpeed);
  });
});

describe("flags, harbour and the high tide", () => {
  it("four flags down light the lock; two moored balls call in the high tide; orbits are jackpots", () => {
    const g = new Game({ seed: 8 });
    ballInPlay(g);
    expect(g.harbourLit).toBe("none");
    dropFlags(g);
    expect(g.flags.every((f) => !f)).toBe(true);
    expect(g.harbourLit).toBe("lock");
    let ev = sink(g);
    expect(ev.some((e) => e.type === GE.Lock && e.a === 1)).toBe(true);
    // A new ball comes to the plunger; the flags pop back up.
    expect(g.laneBall).not.toBeNull();
    play(g, 1.2, LAUNCH);
    expect(g.flags.every((f) => f)).toBe(true);
    dropFlags(g);
    ev = sink(g);
    expect(ev.some((e) => e.type === GE.Lock && e.a === 2)).toBe(true);
    expect(g.harbourLit).toBe("multiball");
    play(g, 0.5, LAUNCH);
    ev = sink(g);
    expect(ev.some((e) => e.type === GE.Multiball)).toBe(true);
    // The two moored balls follow the one that called them.
    play(g, 2.6, { left: true, right: true, launch: false });
    expect(g.multiball).toBe(true);
    expect(g.liveBalls).toBe(3);
    // An orbit is a jackpot; two light the super jackpot.
    for (let n = 0; n < 2; n++) {
      put(g, 31, 330, 0, -2400);
      ev = play(g, 2, IDLE, (e) => e.type === GE.Jackpot);
      expect(ev.some((e) => e.type === GE.Orbit)).toBe(true);
      expect(ev.some((e) => e.type === GE.Jackpot && e.b === n + 1)).toBe(true);
    }
    expect(g.harbourLit).toBe("super");
    ev = sink(g);
    expect(ev.some((e) => e.type === GE.Super)).toBe(true);
  });

  it("the tide goes out when one ball is left", () => {
    const g = new Game({ seed: 12 });
    ballInPlay(g);
    const gg = g as unknown as { locks: number };
    gg.locks = 2;
    sink(g);
    play(g, 2.6, { left: true, right: true, launch: false });
    expect(g.liveBalls).toBe(3);
    // Past the high tide's lifeboat, drain two of them.
    g.saveUntil = g.t;
    const balls = g.world.balls.filter((b) => b !== g.laneBall);
    const ev: GameEvent[] = [];
    for (const b of balls.slice(0, 2)) {
      b.x = 169;
      b.y = 650;
      b.vx = 0;
      b.vy = 600;
      ev.push(...play(g, 0.2, { left: true, right: true, launch: false }));
    }
    expect(ev.some((e) => e.type === GE.MultiballEnd)).toBe(true);
    expect(g.multiball).toBe(false);
    expect(g.ballNo).toBe(1);
  });

  it("an orbit needs the full loop: up one side and down the other", () => {
    const g = new Game({ seed: 13 });
    put(g, 31, 330, 0, -2400);
    const ev = play(g, 2, IDLE, (e) => e.type === GE.Orbit);
    expect(ev.some((e) => e.type === GE.Orbit)).toBe(true);
    // A weak shot up the left lane that falls back down the same lane is not an orbit.
    const h = new Game({ seed: 14 });
    put(h, 31, 330, 0, -700);
    const ev2 = play(h, 2);
    expect(ev2.some((e) => e.type === GE.Orbit)).toBe(false);
    expect(Sensor.OrbitL).not.toBe(Sensor.OrbitR);
  });
});

describe("rewards", () => {
  it("shots within 4 s chain into combos; a pause breaks the chain", () => {
    const g = new Game({ seed: 15 });
    ballInPlay(g);
    const shot = (g as unknown as { shot: (x: number, y: number) => void }).shot.bind(g);
    shot(0, 0);
    g.t += 2;
    shot(0, 0);
    g.t += 3.5;
    shot(0, 0);
    expect(g.combo).toBe(3);
    expect(g.stats.maxCombo).toBe(3);
    g.t += 5;
    shot(0, 0);
    expect(g.combo).toBe(1);
  });

  it("lamp lanes: all three lit pays and charges the storm; a flip shifts the lit lamps", () => {
    const g = new Game({ seed: 16 });
    ballInPlay(g);
    g.lanes = [true, false, false];
    play(g, 0.05, { left: true, right: false, launch: false });
    expect(g.lanes).toEqual([false, false, true]);
    play(g, 0.1);
    play(g, 0.05, { left: false, right: true, launch: false });
    expect(g.lanes).toEqual([true, false, false]);
    g.lanes = [true, true, false];
    const sensor = (g as unknown as { sensor: (id: number, dir: number, x: number, y: number) => void }).sensor.bind(g);
    const charge = g.charge;
    sensor(Sensor.Lane2, -1, 203, 80);
    expect(g.stats.lamps).toBe(1);
    expect(g.charge).toBe(charge + 1);
  });

  it("a gold buoy lights 12-18 s into a ball and pays 2,000 × the tier", () => {
    const g = new Game({ seed: 17 });
    ballInPlay(g);
    expect(g.nextGold).toBeGreaterThanOrEqual(RULES.goldEvery[0]);
    expect(g.nextGold).toBeLessThanOrEqual(RULES.goldEvery[1]);
    g.ballT = g.nextGold - 0.01;
    const ev = play(g, 0.1, IDLE, (e) => e.type === GE.GoldLit);
    expect(ev.some((e) => e.type === GE.GoldLit)).toBe(true);
    const i = g.gold;
    const bp = g.def.bumpers[i]!;
    const before = g.score;
    put(g, bp.x, bp.y + bp.R + 20, 0, -500);
    const hit = play(g, 0.4, IDLE, (e) => e.type === GE.GoldHit);
    expect(hit.some((e) => e.type === GE.GoldHit)).toBe(true);
    expect(g.score - before).toBeGreaterThanOrEqual(2000 * g.tier);
    expect(g.gold).toBe(-1);
  });

  it("a ball held still on a raised flipper slips after 3.5 s", () => {
    const g = new Game({ seed: 18 });
    ballInPlay(g);
    put(g, 30, 400, 0, 0);
    const ev = play(g, 6, { left: true, right: false, launch: false }, (e) => e.type === GE.Slip);
    const slip = ev.find((e) => e.type === GE.Slip);
    expect(slip).toBeDefined();
    expect(g.stats.slips).toBe(1);
    expect(g.stats.cradles).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic: the same seed and the same thumbs give the same run", () => {
    const runOnce = () => {
      const g = new Game({ seed: 99 });
      play(g, 120, (t) => ({ left: Math.sin(t * 5.1) > 0.3, right: Math.sin(t * 4.3 + 1) > 0.3, launch: true }));
      return [g.score, g.t, g.stats.bells, g.stats.flips];
    };
    expect(runOnce()).toEqual(runOnce());
  });
});
