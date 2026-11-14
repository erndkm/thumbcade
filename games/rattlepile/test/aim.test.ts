import { describe, expect, it } from "vitest";
import { aimOf, ARM, LOCK, moveDrag, startDrag } from "../src/aim.ts";
import { MIN_ELEV } from "../src/sim.ts";

const angle = (d: [number, number] | null) => (d ? Math.atan2(-d[1], d[0]) : NaN);

describe("reading the thumb", () => {
  it("a tap or a tiny drag is no shot", () => {
    const a = startDrag(1, 200, 600);
    expect(aimOf(a)).toBeNull();
    expect(moveDrag(a, 205, 608)).toBe(false);
    expect(aimOf(a)).toBeNull();
  });

  it("dragging down pulls back like a slingshot: the shot goes the other way", () => {
    const a = startDrag(1, 200, 600);
    expect(moveDrag(a, 180, 640)).toBe(true);
    expect(a.mode).toBe(1);
    const d = aimOf(a)!;
    expect(d[0]).toBeGreaterThan(0);
    expect(d[1]).toBeLessThan(0);
    expect(angle(d)).toBeCloseTo(Math.atan2(40, 20), 6);
    // Straight down is straight up.
    moveDrag(a, 200, 700);
    expect(aimOf(a)![0]).toBeCloseTo(0, 9);
    expect(aimOf(a)![1]).toBeCloseTo(-1, 9);
  });

  it("dragging up or sideways points: the shot follows the thumb", () => {
    const a = startDrag(1, 200, 600);
    moveDrag(a, 240, 540);
    expect(a.mode).toBe(2);
    expect(angle(aimOf(a))).toBeCloseTo(Math.atan2(60, 40), 6);
    const side = startDrag(1, 200, 600);
    moveDrag(side, 150, 600);
    expect(side.mode).toBe(2);
    // Flat, to the thumb's side, at the shallowest angle allowed.
    expect(aimOf(side)![0]).toBeLessThan(0);
    expect(Math.PI - angle(aimOf(side))).toBeCloseTo(MIN_ELEV, 6);
  });

  it("the drag's mind is made up once it is long enough, and the aim stays continuous after that", () => {
    const a = startDrag(1, 200, 600);
    moveDrag(a, 200, 600 + ARM + 2);
    expect(a.mode).toBe(1);
    // Still short: swinging up re-reads it as pointing.
    moveDrag(a, 200 + ARM + 4, 598);
    expect(a.mode).toBe(2);
    // Long pull back, then the thumb wanders above the start: still a slingshot, clamped flat on the far side.
    const b = startDrag(1, 200, 600);
    moveDrag(b, 190, 600 + LOCK + 20);
    expect(b.mode).toBe(1);
    moveDrag(b, 120, 590);
    expect(b.mode).toBe(1);
    expect(aimOf(b)![0]).toBeGreaterThan(0);
    expect(angle(aimOf(b))).toBeCloseTo(MIN_ELEV, 6);
  });

  it("coming back to the middle cancels, and the drag can arm again", () => {
    const a = startDrag(1, 200, 600);
    moveDrag(a, 200, 680);
    expect(aimOf(a)).not.toBeNull();
    moveDrag(a, 202, 604);
    expect(aimOf(a)).toBeNull();
    expect(moveDrag(a, 230, 560)).toBe(true);
    expect(a.mode).toBe(2);
  });
});
