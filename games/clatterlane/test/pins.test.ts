import { describe, expect, it } from "vitest";
import { BALL_D0, D_HEAD, PIN_COUNT, PIN_R, POCKET_X, SPOTS } from "../src/lane.ts";
import {
  ballLine,
  BALL_F,
  FRAME_STRIDE,
  FULL_RACK,
  isSplit,
  leaveName,
  newFrames,
  PIN_F,
  sampleThrow,
  simulateThrow,
  TIP_CRIT,
  type ThrowInput,
} from "../src/pins.ts";
import { headingThrough } from "../src/throw.ts";

const frames = newFrames();

function at(x: number, speed = 10.2, hook = 0, standing: readonly boolean[] = FULL_RACK, bumpers = false) {
  const input: ThrowInput = { x0: 0, heading: headingThrough(x, D_HEAD, speed, hook), speed, hook, bumpers };
  return simulateThrow(input, standing, frames);
}
const rack = (...up: number[]) => Array.from({ length: PIN_COUNT }, (_, i) => up.includes(i + 1));

describe("the rack", () => {
  it("is the ten-pin triangle, head pin nearest, a foot apart", () => {
    expect(SPOTS).toHaveLength(10);
    expect(SPOTS[0]!.d).toBe(D_HEAD);
    for (let i = 0; i < 10; i++)
      for (let j = i + 1; j < 10; j++) expect(Math.hypot(SPOTS[i]!.x - SPOTS[j]!.x, SPOTS[i]!.d - SPOTS[j]!.d)).toBeGreaterThan(0.3);
    expect(SPOTS[6]!.x).toBeLessThan(0);
    expect(SPOTS[9]!.x).toBeGreaterThan(0);
  });

  it("knows a split when it sees one", () => {
    for (const s of [[7, 10], [4, 6], [5, 7], [2, 7], [3, 10], [8, 10], [4, 7, 10], [6, 7]]) expect(isSplit(rack(...s)), s.join("-")).toBe(true);
    for (const s of [[2, 4], [3, 6, 10], [9, 10], [10], [1, 7, 10], [2, 4, 5, 8]]) expect(isSplit(rack(...s)), s.join("-")).toBe(false);
    expect(leaveName(rack(7, 10))).toBe("7-10");
  });

  it("has a critical tipping angle near 10 degrees", () => {
    expect((TIP_CRIT * 180) / Math.PI).toBeGreaterThan(8);
    expect((TIP_CRIT * 180) / Math.PI).toBeLessThan(12);
  });
});

describe("the ball", () => {
  it("rolls straight without hook and bends late with it", () => {
    expect(ballLine(0, 0, 10, 0).x).toBeCloseTo(0, 6);
    const hooked = ballLine(0, 0, 10, -1);
    expect(hooked.x).toBeLessThan(-0.3);
    // Late: almost nothing in the first half of the lane.
    expect(Math.abs(ballLine(0, 0, 10, -1, 6).x)).toBeLessThan(0.02);
    // A slower ball hooks more.
    expect(ballLine(0, 0, 8, -1).x).toBeLessThan(ballLine(0, 0, 12.5, -1).x);
  });

  it("goes where the solved heading says, through the full solver too", () => {
    for (const [x, hook] of [
      [POCKET_X, -0.7],
      [-POCKET_X, 0.7],
      [0.2, 0],
      [-0.3, 0.4],
    ] as const) {
      const th = at(x, 10, hook);
      expect(th.entryX, `${x} ${hook}`).toBeCloseTo(x, 1);
      expect(Math.abs(th.entryX - x)).toBeLessThan(0.02);
    }
  });

  it("drops into the gutter off the edge, knocking nothing, unless the bumpers are up", () => {
    const wild = { x0: 0, heading: 0.06, speed: 10, hook: 0, bumpers: false };
    const g = simulateThrow(wild, FULL_RACK, frames);
    expect(g.gutter).toBe(true);
    expect(g.knocked).toBe(0);
    const b = simulateThrow({ ...wild, bumpers: true }, FULL_RACK, frames);
    expect(b.gutter).toBe(false);
    expect(b.events.some((e) => e.kind === "bumper")).toBe(true);
    expect(b.knocked).toBeGreaterThan(0);
  });
});

describe("the pins", () => {
  it("are deterministic: the same throw falls the same way, frame for frame", () => {
    const a = at(0.05, 10.4, -0.6);
    const fa = frames.slice(0, a.frames * FRAME_STRIDE);
    const b = at(0.05, 10.4, -0.6);
    expect(b.knocked).toBe(a.knocked);
    expect(b.after).toEqual(a.after);
    expect(b.events.length).toBe(a.events.length);
    expect(frames.slice(0, b.frames * FRAME_STRIDE)).toEqual(fa);
  });

  it("carry from the pocket with a hook and split on a head-on hit", () => {
    let pocket = 0;
    let headOn = 0;
    let n = 0;
    for (let i = 0; i < 24; i++) {
      for (const v of [9.4, 10.4, 11.4]) {
        n++;
        if (at(0.045 + (i / 23) * 0.03, v, -0.7).knocked === 10) pocket++;
        if (at(-0.012 + (i / 23) * 0.024, v, -0.7).knocked === 10) headOn++;
      }
    }
    expect(pocket / n).toBeGreaterThan(0.6);
    expect(headOn / n).toBeLessThan(0.2);
  });

  it("go down in chains: a pocket strike touches only a few pins with the ball", () => {
    for (let i = 0; i < 12; i++) {
      const th = at(0.05 + i * 0.002, 10.4, -0.7);
      if (th.knocked !== 10) continue;
      const touched = new Set(th.events.filter((e) => e.kind === "ball").map((e) => e.pin));
      expect(touched.size).toBeLessThan(7);
      expect(th.events.filter((e) => e.kind === "pin").length).toBeGreaterThan(3);
      return;
    }
    throw new Error("no strike in the pocket sweep");
  });

  it("never end up inside each other, and what stands stands upright on its spot", () => {
    const sample = new Float32Array(FRAME_STRIDE);
    for (let k = 0; k < 40; k++) {
      const th = at(-0.3 + k * 0.015, 9 + (k % 4), ((k % 5) - 2) * 0.35);
      sampleThrow(frames, th, th.end, sample);
      for (let i = 0; i < PIN_COUNT; i++) {
        if (!th.after[i]) continue;
        const o = BALL_F + i * PIN_F;
        expect(sample[o + 5]!, `tilt of pin ${i + 1}`).toBeLessThan(0.05);
        expect(Math.hypot(sample[o]! - SPOTS[i]!.x, sample[o + 2]! - SPOTS[i]!.d)).toBeLessThan(0.12);
        for (let j = 0; j < PIN_COUNT; j++) {
          if (j === i || !th.after[j]) continue;
          const q = BALL_F + j * PIN_F;
          expect(Math.hypot(sample[o]! - sample[q]!, sample[o + 2]! - sample[q + 2]!)).toBeGreaterThan(PIN_R * 1.8);
        }
      }
    }
  });

  it("decide before they finish rolling, and settle within the cap", () => {
    for (let k = 0; k < 20; k++) {
      const th = at(-0.2 + k * 0.02, 8 + (k % 6), -0.5);
      expect(th.decided).toBeLessThanOrEqual(th.end);
      expect(th.decided).toBeGreaterThan(0.5);
      expect(th.decided).toBeLessThan(4.2);
      if (th.knocked) expect(th.impact).toBeLessThan(th.decided);
    }
  });

  it("only knock what was standing, and count it right on a leave", () => {
    const leave = rack(7, 10);
    for (const x of [SPOTS[6]!.x, SPOTS[9]!.x]) {
      const th = at(x, 10, 0, leave);
      expect(th.knocked).toBeGreaterThanOrEqual(1);
      expect(th.after.filter(Boolean).length).toBe(2 - th.knocked);
      th.after.forEach((s, i) => !leave[i] && expect(s).toBe(false));
    }
  });

  it("pitch the clatter: impact counts climb through a throw", () => {
    const th = at(POCKET_X, 10.4, -0.7);
    const n = th.events.filter((e) => e.kind === "ball" || e.kind === "pin").map((e) => e.n);
    for (let i = 1; i < n.length; i++) expect(n[i]!).toBeGreaterThanOrEqual(n[i - 1]!);
    expect(th.impacts).toBeGreaterThan(4);
  });

  it("are cheap enough to solve on release", () => {
    const t0 = performance.now();
    for (let k = 0; k < 30; k++) at(-0.15 + k * 0.01, 10, -0.5);
    expect((performance.now() - t0) / 30).toBeLessThan(30);
    void BALL_D0;
  });
});
