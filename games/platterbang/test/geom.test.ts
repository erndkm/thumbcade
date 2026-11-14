import { describe, expect, it } from "vitest";
import { hangPose, massOf, outline, sdf, sdfAt, type Shape, toLocal, toWorld } from "../src/geom.ts";

const SHAPES: Shape[] = [
  { kind: "plate", a: 1, b: 0, c: 0 },
  { kind: "board", a: 1.4, b: 0.42, c: 0 },
  { kind: "tray", a: 1, b: 0.8, c: 0.24 },
  { kind: "platter", a: 1.3, b: 0.85, c: 0 },
  { kind: "wedge", a: 1.5, b: 0, c: 0.2 },
  { kind: "pan", a: 0.8, b: 1, c: 0.24 },
];

describe("dish shapes", () => {
  it("measure distance exactly where it is easy to check", () => {
    const plate = SHAPES[0]!;
    expect(sdf(plate, 0, 0)).toBeCloseTo(-1, 9);
    expect(sdf(plate, 2, 0)).toBeCloseTo(1, 9);
    const board = SHAPES[1]!;
    expect(sdf(board, 0, 0)).toBeCloseTo(-0.42, 9);
    expect(sdf(board, 1.4 + 0.42, 0)).toBeCloseTo(0, 9);
    expect(sdf(board, 0, 1)).toBeCloseTo(0.58, 9);
    const tray = SHAPES[2]!;
    expect(sdf(tray, 1.5, 0)).toBeCloseTo(0.5, 9);
    expect(sdf(tray, 0, -0.8)).toBeCloseTo(0, 9);
  });

  it("every outline point sits on the edge, and the centre inside", () => {
    for (const s of SHAPES) {
      expect(sdf(s, 0, 0), s.kind).toBeLessThan(0);
      for (const [x, y] of outline(s, 32)) expect(Math.abs(sdf(s, x, y)), s.kind).toBeLessThan(0.01);
    }
  });

  it("the platter's distance is right near its edge (where covering is decided)", () => {
    const s = SHAPES[3]!;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const ex = Math.cos(a) * s.a;
      const ey = Math.sin(a) * s.b;
      // Move 0.2 out along the true normal of the ellipse.
      const nx = ex / (s.a * s.a);
      const ny = ey / (s.b * s.b);
      const n = Math.hypot(nx, ny);
      expect(sdf(s, ex + (nx / n) * 0.2, ey + (ny / n) * 0.2)).toBeCloseTo(0.2, 1);
    }
  });

  it("mass properties match a disc's formulas, and a pan's weight sits toward its handle", () => {
    const m = massOf(SHAPES[0]!, 0.01);
    expect(m.area).toBeCloseTo(Math.PI, 2);
    expect(m.inertia).toBeCloseTo((Math.PI * 1) / 2, 2);
    expect(Math.abs(m.cx) + Math.abs(m.cy)).toBeLessThan(1e-6);
    const pan = massOf(SHAPES[5]!, 0.02);
    expect(pan.cx).toBeGreaterThan(0.1);
  });

  it("closed-form masses agree with integrating the shape on a fine grid", () => {
    for (const s of [SHAPES[0]!, SHAPES[1]!, SHAPES[3]!]) {
      const m = massOf(s);
      let area = 0;
      let ii = 0;
      const h = 0.01;
      for (let y = -2; y < 2; y += h)
        for (let x = -2.5; x < 2.5; x += h)
          if (sdf(s, x + h / 2, y + h / 2) <= 0) {
            area += h * h;
            ii += ((x + h / 2) ** 2 + (y + h / 2) ** 2) * h * h;
          }
      expect(m.area / area, s.kind).toBeCloseTo(1, 2);
      expect(m.inertia / ii, s.kind).toBeCloseTo(1, 2);
    }
  });

  it("poses turn there and back, and a hanging dish rests with its weight straight below the peg", () => {
    const p = { x: 2, y: 3, th: 0.7 };
    const [wx, wy] = toWorld(p, 0.4, -0.3);
    const [lx, ly] = toLocal(p, wx, wy);
    expect(lx).toBeCloseTo(0.4, 12);
    expect(ly).toBeCloseTo(-0.3, 12);
    for (const s of SHAPES) {
      const m = massOf(s, 0.03);
      const peg: [number, number] = [0.5, -0.3];
      const h = hangPose(m, peg, [3, 2]);
      const [px, py] = toWorld(h, peg[0], peg[1]);
      expect(px).toBeCloseTo(3, 9);
      expect(py).toBeCloseTo(2, 9);
      const [cx, cy] = toWorld(h, m.cx, m.cy);
      expect(cx).toBeCloseTo(3, 9);
      expect(cy).toBeGreaterThan(2);
      expect(sdfAt(s, h, cx, cy)).toBeLessThan(0.05);
    }
  });
});
