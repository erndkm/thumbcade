import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { plans, SKILLS } from "../src/pilot.ts";
import { afterShot, FIRST_T, playRun } from "../src/runs.ts";
import {
  castGuide,
  CLUTCH_T,
  drainAt,
  guideLengths,
  HL,
  HW,
  makeRack,
  MAX_CLOCK,
  multFor,
  playbackRate,
  POCKETS,
  R,
  rackSpec,
  respawnCue,
  Run,
  SCRATCH_TIME,
  simulateShot,
  START_CLOCK,
  watchTime,
  type Shot,
  type Table,
} from "../src/sim.ts";

const ball = (n: number, x: number, z: number) => ({ n, x, z, vx: 0, vz: 0, pocket: -1 });
const tableOf = (...balls: Array<[number, number, number]>): Table => ({ balls: balls.map(([n, x, z]) => ball(n, x, z)), blockers: [] });
const fakeShot = (over: Partial<Shot>): Shot => ({ ...simulateShot(tableOf([0, 0, 2]), 0, 0.01), ...over });

describe("cushions, jaws and pockets", () => {
  it("never loses a ball off the table: every ball is on the cloth or down a pocket", () => {
    const rng = createRng(3);
    for (let k = 0; k < 120; k++) {
      const t = tableOf([0, rng.range(-HW + 0.3, HW - 0.3), rng.range(-HL + 0.3, HL - 0.3)]);
      const s = simulateShot(t, rng.range(0, Math.PI * 2), rng.range(2, 12.5));
      const b = s.after.balls[0]!;
      if (b.pocket < 0) {
        expect(Math.abs(b.x)).toBeLessThanOrEqual(HW + 0.05);
        expect(Math.abs(b.z)).toBeLessThanOrEqual(HL + 0.05);
      }
    }
  });

  it("a ball rolled into a corner goes down; one rolled along a rail past a side pocket doesn't", () => {
    const corner = simulateShot(tableOf([0, 0, 0]), Math.atan2(-HL, -HW), 8);
    expect(corner.scratch).toBe(true);
    expect(corner.after.balls[0]!.pocket).toBe(0);
    const along = simulateShot(tableOf([0, HW - R - 0.01, HL - 1]), -Math.PI / 2, 4.5);
    expect(along.after.balls[0]!.pocket).not.toBe(3);
  });

  it("a ball straight into the side pocket drops", () => {
    const s = simulateShot(tableOf([0, 0, 0]), 0, 5);
    expect(s.after.balls[0]!.pocket).toBe(3);
  });

  it("cushions give back most of the speed, not all", () => {
    const s = simulateShot(tableOf([0, 0, 2]), 0.3, 6);
    expect(s.events.some((e) => e.kind === "cushion")).toBe(true);
    expect(s.end).toBeGreaterThan(1);
    expect(s.end).toBeLessThan(10);
  });
});

describe("balls", () => {
  it("head on, the cue ball stops and the object ball takes the speed", () => {
    const s = simulateShot(tableOf([0, 0, 2], [1, 0, 0]), -Math.PI / 2, 5);
    const [cue, obj] = s.after.balls;
    expect(Math.abs(cue!.z - 2) > 1.4).toBe(true);
    expect(obj!.z).toBeLessThan(-1);
    expect(s.first).toBe(1);
  });

  it("a cut sends the object ball along the line of centres (the ghost-ball rule)", () => {
    const t = tableOf([0, 0, 2], [1, 0.25, 0]);
    const angle = -Math.PI / 2 + 0.06;
    const g = castGuide(t, angle);
    expect(g.hit).toBe("ball");
    const s = simulateShot(t, angle, 4);
    const o = s.after.balls[1]!;
    const dir = Math.atan2(o.z - 0, o.x - 0.25);
    expect(Math.abs(dir - Math.atan2(g.objDir.z, g.objDir.x))).toBeLessThan(0.04);
  });

  it("is deterministic", () => {
    const t = makeRack(3, 9);
    const a = simulateShot(t, -1.4, 11);
    const b = simulateShot(t, -1.4, 11);
    expect(a.end).toBe(b.end);
    expect(a.pots.map((p) => p.n)).toEqual(b.pots.map((p) => p.n));
    expect(a.events.length).toBe(b.events.length);
  });

  it("marks banks, kicks, combos and long pots", () => {
    // A combination: the cue hits 1, which knocks 2 into the corner.
    const combo = simulateShot(tableOf([0, -1.3, -2.2], [1, -1.6, -2.9], [2, -1.9, -3.6]), Math.atan2(-2.9 + 2.2 - 0, -1.6 + 1.3), 7);
    const potted = combo.pots.find((p) => p.n === 2);
    if (potted) expect(potted.combo).toBe(true);
    // A bank: rail first for the object ball.
    let banks = 0;
    for (let a = -2.4; a < -0.7; a += 0.02) {
      const s = simulateShot(tableOf([0, 0, 3], [1, 0.4, 1.6]), a, 9);
      if (s.pots.some((p) => p.bank)) banks++;
    }
    expect(banks).toBeGreaterThan(0);
  });
});

describe("the guide", () => {
  it("puts the ghost ball where the cue ball really first touches", () => {
    const rng = createRng(5);
    let checked = 0;
    for (let k = 0; k < 40; k++) {
      const t = makeRack(1, 100 + k);
      const angle = rng.range(0, Math.PI * 2);
      const g = castGuide(t, angle);
      if (g.hit !== "ball") continue;
      const s = simulateShot(t, angle, 10);
      expect(s.first).toBe(g.ball);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("is generous early and shorter later", () => {
    expect(guideLengths(0).obj).toBeGreaterThan(guideLengths(5).obj);
    expect(guideLengths(0).cue).toBeGreaterThan(guideLengths(5).cue);
    expect(guideLengths(0).bounce).toBe(true);
    expect(guideLengths(3).bounce).toBe(false);
  });
});

describe("racks", () => {
  it("every rack is legal: no overlaps, on the cloth, clear of the pockets and the cue ball", () => {
    for (let n = 0; n < 9; n++) {
      for (let seed = 1; seed < 15; seed++) {
        const t = makeRack(n, seed);
        const spec = rackSpec(n);
        expect(t.balls.length - 1).toBe(spec.count);
        expect(t.blockers.length).toBe(spec.blockers);
        for (let i = 0; i < t.balls.length; i++) {
          const a = t.balls[i]!;
          expect(Math.abs(a.x)).toBeLessThan(HW - R + 1e-6);
          expect(Math.abs(a.z)).toBeLessThan(HL - R + 1e-6);
          for (const p of POCKETS) expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeGreaterThan(p.r + 0.05);
          for (let j = i + 1; j < t.balls.length; j++) expect(Math.hypot(a.x - t.balls[j]!.x, a.z - t.balls[j]!.z)).toBeGreaterThanOrEqual(2 * R - 1e-6);
          for (const k of t.blockers) expect(Math.hypot(a.x - k.x, a.z - k.z)).toBeGreaterThan(k.r + R);
        }
      }
    }
  });

  it("gets harder: more balls, tighter, blockers later", () => {
    expect(rackSpec(0).count).toBeLessThan(rackSpec(2).count);
    expect(rackSpec(0).blockers).toBe(0);
    expect(rackSpec(3).blockers).toBeGreaterThan(0);
    expect(rackSpec(6).count).toBeGreaterThanOrEqual(10);
  });

  it("puts a scratched cue ball back on the head line, clear of everything", () => {
    const t = makeRack(3, 4);
    const p = respawnCue(t);
    for (let i = 1; i < t.balls.length; i++) expect(Math.hypot(t.balls[i]!.x - p.x, t.balls[i]!.z - p.z)).toBeGreaterThan(2 * R);
    const s = simulateShot(tableOf([0, 0, 0]), 0, 5);
    expect(s.scratch).toBe(true);
    const after = afterShot(s);
    expect(after.balls[0]!.pocket).toBe(-1);
  });

  it("the pilot's planned pots really go in when played exactly", () => {
    let tried = 0;
    let went = 0;
    for (let seed = 1; seed < 30; seed++) {
      const t = makeRack(0, seed);
      const p = plans(t)[0];
      if (!p) continue;
      tried++;
      if (simulateShot(t, p.angle, p.speed).pots.length > 0) went++;
    }
    expect(tried).toBeGreaterThan(20);
    expect(went / tried).toBeGreaterThan(0.7);
  });
});

describe("the run", () => {
  const pot = (n: number, extra: Partial<Shot["pots"][number]> = {}) => ({ i: n, n, pocket: 0, t: 1, bank: false, combo: false, long: false, ...extra });

  it("a pot buys time and points; a dry shot ends the streak", () => {
    const r = new Run();
    r.clock = 10;
    const a = r.settle(fakeShot({ pots: [pot(1)], scratch: false, first: 1 }), 4, false);
    expect(a.points).toBe(100);
    expect(r.clock).toBeGreaterThan(13);
    r.settle(fakeShot({ pots: [], scratch: false, first: 1 }), 4, false);
    expect(r.streak).toBe(0);
  });

  it("pots in a row climb the multiplier: ×2 at 2, ×3 at 4, ×4 at 7", () => {
    expect([1, 2, 3, 4, 6, 7, 12].map(multFor)).toEqual([1, 2, 2, 3, 3, 4, 4]);
    const r = new Run();
    const pts = [1, 2, 3, 4].map(() => r.settle(fakeShot({ pots: [pot(1)], first: 1 }), 5, false).points);
    expect(pts).toEqual([100, 200, 200, 300]);
  });

  it("multi-pots, banks, combos and long pots pay more", () => {
    const r = new Run();
    const multi = r.settle(fakeShot({ pots: [pot(1), pot(2)], first: 1 }), 5, false);
    expect(multi.tags).toContain("Double");
    expect(multi.points).toBeGreaterThan(200);
    expect(new Run().settle(fakeShot({ pots: [pot(1, { bank: true })], first: 1 }), 5, false).points).toBe(250);
    expect(new Run().settle(fakeShot({ pots: [pot(1, { combo: true })], first: 2 }), 5, false).points).toBe(300);
    expect(new Run().settle(fakeShot({ pots: [pot(1, { long: true })], first: 1 }), 5, false).points).toBe(200);
  });

  it("clearing a rack pays a big bonus and time", () => {
    const r = new Run();
    r.clock = 20;
    const a = r.settle(fakeShot({ pots: [pot(1)], first: 1 }), 0, false);
    expect(a.rackClear).toBe(true);
    expect(a.points).toBeGreaterThan(1000);
    expect(r.clock).toBeGreaterThan(30);
  });

  it("a scratch costs a few seconds and the streak, gently", () => {
    const r = new Run();
    r.clock = 20;
    r.streak = 3;
    const a = r.settle(fakeShot({ pots: [], scratch: true, first: -1 }), 5, false);
    expect(a.scratch).toBe(true);
    expect(r.clock).toBeCloseTo(20 - SCRATCH_TIME, 5);
    expect(r.streak).toBe(0);
  });

  it("the last seconds count double; the clock is capped; it burns faster later; the buzzer sounds at zero", () => {
    const r = new Run();
    r.clock = CLUTCH_T - 1;
    expect(r.settle(fakeShot({ pots: [pot(1)], first: 1 }), 4, false).points).toBe(200);
    for (let i = 0; i < 30; i++) r.settle(fakeShot({ pots: [pot(1)], first: 1 }), 4, false);
    expect(r.clock).toBeLessThanOrEqual(MAX_CLOCK);
    expect(drainAt(0)).toBe(1);
    expect(drainAt(85)).toBeGreaterThan(1.9);
    const idle = new Run();
    let t = 0;
    let buzz = false;
    while (!buzz && t < 60) {
      t += 1 / 30;
      buzz = idle.tick(1 / 30, t < FIRST_T);
    }
    expect(buzz).toBe(true);
    expect(t).toBeLessThan(START_CLOCK);
  });

  it("a shot still rolling at the buzzer scores but buys no time", () => {
    const r = new Run();
    r.clock = 0;
    r.buzzer = true;
    const a = r.settle(fakeShot({ pots: [pot(1)], first: 1 }), 4, true);
    expect(a.points).toBe(100);
    expect(a.time).toBe(0);
    expect(r.clock).toBe(0);
  });
});

describe("pacing", () => {
  it("speeds playback up once everything crawls, so a shot never drags", () => {
    expect(playbackRate(5)).toBe(1);
    expect(playbackRate(0.2)).toBe(3);
    const s = simulateShot(tableOf([0, 0, 3]), -Math.PI / 2 + 0.2, 9);
    expect(watchTime(s)).toBeLessThan(s.end);
  });

  it("runs last 20-100 s at every skill, longer for better players, with no danger in the first 10 s", () => {
    const med: number[] = [];
    for (const skill of Object.values(SKILLS)) {
      const secs: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = playRun(skill, createRng(300 + i * 77), 5 + i * 13);
        secs.push(r.seconds);
        expect(r.minClock10).toBeGreaterThan(15);
      }
      secs.sort((a, b) => a - b);
      med.push(secs[5]!);
      expect(secs[1]!, skill.name).toBeGreaterThan(20);
      expect(secs[8]!, skill.name).toBeLessThan(110);
    }
    for (let i = 1; i < med.length; i++) expect(med[i]!).toBeGreaterThan(med[i - 1]!);
  }, 60_000);
});
