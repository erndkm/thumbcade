import { describe, expect, it } from "vitest";
import { aimView, BALL_R, BALL_D0, BALL_SCREEN, D_HEAD, PIN_COUNT, PINS_SCREEN, POCKET_X, project, SPOTS } from "../src/lane.ts";
import { ballLine, FULL_RACK, newFrames, simulateThrow } from "../src/pins.ts";
import {
  aimFor,
  assistCurve,
  assistFor,
  ballSpeed,
  bowFor,
  directionFor,
  flickFor,
  flickPath,
  flickSpeedFor,
  headingOf,
  hookOf,
  readFlick,
  spareTarget,
  V_MAX,
  V_MIN,
  type Sample,
} from "../src/throw.ts";

const frames = newFrames();

function path(dx: number, dy: number, ms: number, bulge = 0, n = 14, x0 = 195, y0 = 640): Sample[] {
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    const b = Math.sin(u * Math.PI) * bulge;
    return { x: x0 + dx * u + nx * b, y: y0 + dy * u + ny * b, t: ms * u };
  });
}
const rack = (...up: number[]) => Array.from({ length: PIN_COUNT }, (_, i) => up.includes(i + 1));

describe("the aiming view", () => {
  it("puts the ball and the head pin on their rows on every screen shape", () => {
    for (const [w, h] of [
      [390, 788],
      [390, 844],
      [430, 860],
      [360, 640],
      [600, 900],
    ] as const) {
      const v = aimView(w, h);
      expect(project(v, 0, BALL_R, BALL_D0).y / h).toBeCloseTo(BALL_SCREEN, 2);
      expect(project(v, 0, 0.2, D_HEAD).y / h).toBeCloseTo(PINS_SCREEN, 2);
      expect(project(v, 0, 0, D_HEAD).x).toBeCloseTo(w / 2, 3);
    }
  });
});

describe("reading a flick", () => {
  it("throws on an upward flick, ignores taps, sideways and downward swipes", () => {
    expect(readFlick(path(0, -240, 200)).kind).toBe("throw");
    expect(readFlick(path(4, -5, 80)).kind).toBe("none");
    expect(readFlick(path(220, -40, 200)).kind).toBe("none");
    expect(readFlick(path(0, 220, 200)).kind).toBe("none");
    expect(readFlick(path(0, -240, 1400)).kind).toBe("soft");
  });

  it("reads speed from the flick and maps it onto the ball's range", () => {
    expect(readFlick(path(0, -240, 120)).speed).toBeGreaterThan(readFlick(path(0, -240, 300)).speed);
    expect(ballSpeed(100)).toBe(V_MIN);
    expect(ballSpeed(9000)).toBe(V_MAX);
    for (const v of [8, 10, 12.5]) expect(ballSpeed(flickSpeedFor(v))).toBeCloseTo(v, 6);
  });

  it("hooks the way the swipe's end turns: a path bulging right hooks left", () => {
    const right = readFlick(path(0, -260, 220, 30));
    const left = readFlick(path(0, -260, 220, -30));
    expect(right.bow).toBeGreaterThan(0.08);
    expect(hookOf(right.bow)).toBeLessThan(-0.3);
    expect(hookOf(left.bow)).toBeGreaterThan(0.3);
    // A thumb's natural slight arc doesn't hook.
    expect(hookOf(readFlick(path(0, -260, 220, 5)).bow)).toBe(0);
    for (const h of [-1, -0.4, 0.25, 0.9]) expect(hookOf(bowFor(h))).toBeCloseTo(h, 6);
  });

  it("aims along the flick's direction, both ways round", () => {
    const v = aimView(390, 788);
    expect(headingOf(v, 0, -200)).toBeCloseTo(0, 6);
    expect(headingOf(v, 40, -200)).toBeGreaterThan(0);
    for (const h of [-0.04, -0.01, 0.02, 0.05]) {
      const d = directionFor(v, h);
      expect(headingOf(v, d.dx * 220, d.dy * 220)).toBeCloseTo(h, 5);
    }
  });

  it("draws the ghost finger along the flick it describes", () => {
    const v = aimView(390, 788);
    const f = flickFor(v, 0.02, 10, -0.6, 230);
    const out: Sample[] = [];
    const n = flickPath(f, 195, 650, out, 16);
    const back = readFlick(out, n);
    expect(back.kind).toBe("throw");
    expect(hookOf(back.bow)).toBeCloseTo(-0.6, 1);
    expect(headingOf(v, back.dx, back.dy)).toBeCloseTo(0.02, 2);
  });
});

describe("the assist", () => {
  it("shrinks near misses, leaves wild throws wild, and is monotonic", () => {
    expect(Math.abs(assistCurve(0.05, 0.2, 0.6))).toBeCloseTo(0.02, 6);
    expect(assistCurve(0.5, 0.2, 0.6)).toBe(0.5);
    let last = -Infinity;
    for (let e = -0.6; e <= 0.6; e += 0.005) {
      const a = assistCurve(e, 0.2, 0.6);
      expect(a).toBeGreaterThanOrEqual(last - 1e-12);
      last = a;
    }
  });

  it("is generous early and tightens later, and gives less on spares", () => {
    expect(assistFor(0).pull).toBeGreaterThan(assistFor(9).pull);
    expect(assistFor(0).win).toBeGreaterThan(assistFor(9).win);
    expect(assistFor(3, true).pull).toBeLessThan(assistFor(3).pull);
  });

  it("pulls toward the pocket on a full rack, and the ball really goes there", () => {
    const v = aimView(390, 788);
    for (const [hx, hook] of [
      [0.12, -0.6],
      [0.0, -0.6],
      [-0.12, 0.6],
    ] as const) {
      const heading = Math.atan2(hx + 0.32 * Math.sign(-hook), D_HEAD);
      const f = flickFor(v, heading, 10, hook, 230);
      const a = aimFor(v, f, FULL_RACK, 0, false);
      expect(Math.abs(a.assistedX - a.target.x)).toBeLessThanOrEqual(Math.abs(a.rawX - a.target.x) + 1e-9);
      const th = simulateThrow(a.input, FULL_RACK, frames);
      expect(Math.abs(th.entryX - a.assistedX)).toBeLessThan(0.015);
    }
    // A ball heading right of the head pin is helped to the pocket on that side.
    const f = flickFor(v, 0.012, 10, 0, 230);
    expect(aimFor(v, f, FULL_RACK, 0, false).target.x).toBeCloseTo(POCKET_X, 6);
  });

  it("monotonic end to end: a flick further right never lands further left", () => {
    const v = aimView(390, 788);
    let last = -Infinity;
    for (let h = -0.05; h <= 0.05; h += 0.001) {
      const a = aimFor(v, flickFor(v, h, 10, -0.5, 230), FULL_RACK, 2, false);
      expect(a.assistedX).toBeGreaterThanOrEqual(last - 1e-6);
      last = a.assistedX;
    }
  });

  it("sends spares at the key pin of the leave", () => {
    expect(spareTarget(rack(10)).x).toBeCloseTo(SPOTS[9]!.x, 6);
    expect(spareTarget(rack(7)).x).toBeCloseTo(SPOTS[6]!.x, 6);
    const t = spareTarget(rack(2, 4, 5, 8));
    // A line through the 2 and the 5/8 pocket: between them.
    expect(t.x).toBeLessThan(0);
    expect(t.x).toBeGreaterThan(SPOTS[3]!.x);
    const s = spareTarget(rack(3, 6, 10));
    expect(s.x).toBeGreaterThan(0);
    expect(ballLine(0, 0, 10, 0).x).toBeCloseTo(0, 6);
  });
});
