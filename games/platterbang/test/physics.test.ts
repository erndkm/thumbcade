import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { layoutWall, planFor, type Wall } from "../src/board.ts";
import { hangPose, outline, toWorld, wrap } from "../src/geom.ts";
import { FLOOR, Physics, STEP } from "../src/physics.ts";

const run = (p: Physics, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += STEP) {
    p.step();
    each?.();
  }
};

const walls: Wall[] = Array.from({ length: 12 }, (_, i) => layoutWall(planFor(2 + (i % 7)), createRng(70 + i)));

describe("the swing", () => {
  it("never moves a pinned dish, not by a hair", () => {
    for (const wall of walls) {
      const p = new Physics(wall);
      // Swing and drop a few others meanwhile.
      p.hang(wall.dishes[0]!, 0);
      run(p, 0.3);
      p.drop(wall.dishes[0]!);
      run(p, 8);
      for (const d of wall.dishes.slice(1)) {
        const b = p.bodies[d.id]!;
        expect(b.pose).toEqual(d.base);
      }
    }
  });

  it("swings a dish on its last peg and settles it exactly in its resting pose, then it never creeps", () => {
    let worst = 0;
    for (const wall of walls) {
      for (const d of wall.dishes) {
        for (let k = 0; k < d.pegs.length; k++) {
          const p = new Physics(wall);
          p.hang(d, k);
          const b = p.bodies[d.id]!;
          let t = 0;
          while (!b.settled && t < 10) {
            p.step();
            t += STEP;
          }
          worst = Math.max(worst, t);
          expect(b.settled, `dish ${d.id} peg ${k}`).toBe(true);
          const rest = d.hang[k]!;
          expect(b.pose.x).toBeCloseTo(rest.x, 12);
          expect(b.pose.y).toBeCloseTo(rest.y, 12);
          expect(Math.abs(wrap(b.pose.th - rest.th))).toBeLessThan(1e-12);
          const before = { ...b.pose };
          run(p, 5);
          expect(b.pose).toEqual(before);
          expect(b.w).toBe(0);
        }
      }
    }
    // Swings settle in a few seconds (from upside down, the longest).
    expect(worst).toBeLessThan(6.5);
  });

  it("keeps the pivot where the peg is while it swings, and the swing dies down", () => {
    const wall = walls[3]!;
    const d = wall.dishes.find((x) => x.shape.kind !== "plate") ?? wall.dishes[0]!;
    const p = new Physics(wall);
    p.hang(d, 0);
    const b = p.bodies[d.id]!;
    const peg = wall.pegs[d.pegs[0]!]!;
    const peaks: number[] = [];
    let last = 0;
    let lastW = 0;
    run(p, 4, () => {
      const [x, y] = toWorld(b.pose, peg.lx, peg.ly);
      expect(Math.hypot(x - peg.x, y - peg.y)).toBeLessThan(1e-9);
      const phi = Math.abs(wrap(b.pose.th - b.rest));
      if (lastW > 0 !== b.w > 0 && last > 0.02) peaks.push(last);
      last = phi;
      lastW = b.w;
    });
    for (let i = 2; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 2]! + 1e-6);
  });

  it("drops a dish with no pegs off the wall, keeping its spin, onto the counter", () => {
    for (const wall of walls.slice(0, 6)) {
      const d = wall.dishes[wall.dishes.length - 1]!;
      const p = new Physics(wall);
      p.hang(d, 0);
      run(p, 0.25);
      const spin = p.bodies[d.id]!.w;
      p.drop(d);
      let landed: { y: number; speed: number } | null = null;
      for (let t = 0; t < 3 && !landed; t += STEP) {
        for (const e of p.step()) if (e.dish === d.id) landed = e;
      }
      expect(landed).not.toBeNull();
      expect(landed!.y).toBe(FLOOR);
      expect(landed!.speed).toBeGreaterThan(0);
      expect(p.bodies[d.id]!.state).toBe("gone");
      if (Math.abs(spin) > 0.5) expect(Math.sign(p.bodies[d.id]!.w)).toBe(Math.sign(spin));
    }
  });

  it("never lets a falling dish pass through the counter (it lands the step it reaches it)", () => {
    for (const wall of walls) {
      const d = wall.dishes[0]!;
      const p = new Physics(wall);
      p.drop(d);
      const b = p.bodies[d.id]!;
      for (let t = 0; t < 3 && b.state === "falling"; t += STEP) {
        p.step();
        if (b.state !== "falling") break;
        let low = -Infinity;
        for (const [x, y] of outline(d.shape, 24)) low = Math.max(low, toWorld(b.pose, x, y)[1]);
        expect(low).toBeLessThan(FLOOR + 0.3);
      }
      expect(b.state).toBe("gone");
    }
  });

  it("is deterministic to the bit", () => {
    const go = () => {
      const wall = walls[5]!;
      const p = new Physics(wall);
      p.hang(wall.dishes[1]!, 1);
      run(p, 0.7);
      p.drop(wall.dishes[1]!);
      p.hang(wall.dishes[2]!, 0);
      run(p, 1.3);
      return p.bodies.map((b) => [b.pose.x, b.pose.y, b.pose.th]);
    };
    expect(go()).toEqual(go());
  });

  it("rests where the dealer said it would", () => {
    for (const wall of walls) for (const d of wall.dishes) d.pegs.forEach((id, k) => expect(hangPose(d.mass, [wall.pegs[id]!.lx, wall.pegs[id]!.ly], [wall.pegs[id]!.x, wall.pegs[id]!.y])).toEqual(d.hang[k]));
  });
});
