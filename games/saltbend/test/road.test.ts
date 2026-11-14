import { describe, expect, it } from "vitest";
import { BEND_K, Course, GATE_M, HALF, HEADING_MAX, isBend, OFF, poseIn, WARM_M, wrap } from "../src/road.ts";

const seeds = Array.from({ length: 24 }, (_, i) => 101 + i * 7919);

describe("the road", () => {
  it("is one continuous ribbon: every segment starts where the last one ended, at its heading", () => {
    for (const seed of seeds.slice(0, 8)) {
      const c = new Course(seed);
      c.ensure(4000);
      for (let i = 1; i < c.segs.length; i++) {
        const a = c.segs[i - 1]!;
        const b = c.segs[i]!;
        const end = poseIn(a, a.len);
        expect(Math.hypot(end.x - b.x0, end.y - b.y0)).toBeLessThan(1e-6);
        expect(Math.abs(wrap(end.a - b.a0))).toBeLessThan(1e-9);
        expect(b.s0).toBeCloseTo(a.s0 + a.len, 9);
      }
    }
  });

  it("never turns back south, so it can't cross itself, and no two stretches of it ever touch", () => {
    for (const seed of seeds) {
      const c = new Course(seed);
      c.ensure(5000);
      let lastY = -Infinity;
      const pts: Array<{ s: number; x: number; y: number }> = [];
      for (let s = 0; s < 5000; s += 2) {
        const p = c.pose(s);
        expect(Math.abs(wrap(p.a - Math.PI / 2)), `seed ${seed} at ${s}`).toBeLessThanOrEqual(HEADING_MAX + 1e-9);
        expect(p.y).toBeGreaterThan(lastY);
        lastY = p.y;
        pts.push({ s, x: p.x, y: p.y });
      }
      // Any two points more than 60 m apart along the road are more than two road widths apart on the map.
      for (let i = 0; i < pts.length; i += 3) {
        for (let j = i + 31; j < Math.min(pts.length, i + 220); j += 2) {
          const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y);
          expect(d, `seed ${seed} s ${pts[i]!.s} vs ${pts[j]!.s}`).toBeGreaterThan(2 * OFF + 2);
        }
      }
    }
  }, 30_000);

  it("finds the cart on it: projection returns the distance and offset that placed a point", () => {
    const c = new Course(77);
    c.ensure(2500);
    let hint = 0;
    for (let s = 1; s < 2400; s += 3.7) {
      for (const d of [-OFF - 0.4, -2, 0, 1.3, HALF]) {
        const p = c.point(s, d);
        const pr = c.project(p.x, p.y, hint);
        expect(pr.s).toBeCloseTo(s, 4);
        expect(pr.d).toBeCloseTo(d, 4);
      }
      hint = s;
    }
  });

  it("starts with a warm-up the cart drives on its own, and gentle bends until the first gate", () => {
    for (const seed of seeds) {
      const c = new Course(seed);
      c.ensure(GATE_M + 100);
      for (const g of c.segs) {
        if (g.s0 + g.len <= WARM_M) expect(Math.abs(g.k)).toBeLessThan(BEND_K);
        else if (g.s0 < GATE_M - 20 && isBend(g)) expect(1 / Math.abs(g.k)).toBeGreaterThanOrEqual(40 - 1e-9);
      }
    }
  });

  it("tightens with distance: smaller radii, bigger angles, shorter straights", () => {
    const early: number[] = [];
    const late: number[] = [];
    const lateAng: number[] = [];
    const earlyAng: number[] = [];
    for (const seed of seeds) {
      const c = new Course(seed);
      c.ensure(3000);
      for (const g of c.segs) {
        if (!isBend(g)) continue;
        if (g.s0 > GATE_M && g.s0 < GATE_M + 300) {
          early.push(1 / Math.abs(g.k));
          earlyAng.push(Math.abs(g.k) * g.len);
        }
        if (g.s0 > 1500) {
          late.push(1 / Math.abs(g.k));
          lateAng.push(Math.abs(g.k) * g.len);
        }
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(late)).toBeLessThan(mean(early) * 0.75);
    expect(mean(lateAng)).toBeGreaterThan(mean(earlyAng));
    expect(Math.min(...late)).toBeGreaterThanOrEqual(11.5 - 1e-9);
  });

  it("stands every gate on a straight with room before and after", () => {
    for (const seed of seeds) {
      const c = new Course(seed);
      c.ensure(4000);
      const gates = c.gates.map((g) => g.s);
      expect(gates.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => (i + 1) * GATE_M));
      for (const s of gates) {
        for (let q = s - 25; q <= s + 25; q += 1) expect(Math.abs(c.segAt(q).k), `seed ${seed} gate ${s}`).toBeLessThan(1e-9);
      }
    }
  });

  it("puts lemons on the inside line of their bend, and gulls on or by the road", () => {
    for (const seed of seeds.slice(0, 10)) {
      const c = new Course(seed);
      c.ensure(3000);
      expect(c.lemons.length).toBeGreaterThan(5);
      for (const l of c.lemons) {
        const g = c.segAt(l.s);
        expect(isBend(g)).toBe(true);
        expect(Math.sign(l.d)).toBe(Math.sign(g.k));
        expect(Math.abs(l.d)).toBeLessThan(HALF);
      }
      for (const f of c.flocks) expect(Math.abs(f.d)).toBeLessThan(OFF);
    }
  });

  it("swings into the bend ahead: the one it's in, or the next one from a straight", () => {
    const c = new Course(5);
    c.ensure(2000);
    for (let s = 200; s < 1900; s += 5) {
      const g = c.segAt(s);
      const dir = c.bendAhead(s, 0);
      if (isBend(g)) expect(dir).toBe(Math.sign(g.k));
      else {
        let i = c.segs.indexOf(g) + 1;
        while (!isBend(c.segs[i])) i++;
        expect(dir).toBe(Math.sign(c.segs[i]!.k));
      }
    }
  });

  it("is the same road for the same seed", () => {
    const a = new Course(42);
    const b = new Course(42);
    a.ensure(3000);
    b.ensure(3000);
    expect(a.segs.map((g) => [g.len, g.k])).toEqual(b.segs.map((g) => [g.len, g.k]));
    const d = new Course(43);
    d.ensure(3000);
    expect(d.segs.map((g) => g.k)).not.toEqual(a.segs.map((g) => g.k));
  });
});
