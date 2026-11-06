import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { MAX_BODIES, STEP, World } from "../src/physics.ts";
import { radius } from "../src/tiers.ts";

const W = 10;

function settle(w: World, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) w.step();
}

/** A deterministic pile: `n` pieces of mixed tiers dropped across the tin, given time to land. */
function pile(seed: number, n: number): World {
  const w = new World(W);
  w.floor = 0.5;
  const rng = createRng(seed);
  for (let k = 0; k < n; k++) {
    const tier = rng.int(0, 5);
    const r = radius(tier);
    w.add(tier, rng.range(r, W - r), 14, r);
    settle(w, 0.4);
  }
  return w;
}

function snapshot(w: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.n; i++) out.push(w.x[i]!, w.y[i]!);
  return out;
}

describe("the circle solver", () => {
  it("drops a piece onto the dough and lets it come to rest on the surface", () => {
    const w = new World(W);
    w.floor = 1;
    w.add(3, 5, 12, radius(3));
    settle(w, 3);
    expect(w.y[0]).toBeCloseTo(1 + radius(3), 3);
    expect(Math.abs(w.vy[0]!)).toBeLessThan(1e-6);
    expect(w.landed[0]).toBe(1);
  });

  it("settles a mixed pile completely: no jitter and no creep", () => {
    for (const seed of [3, 17, 92]) {
      const w = pile(seed, 22);
      settle(w, 12);
      const before = snapshot(w);
      let maxV = 0;
      for (let t = 0; t < 3; t += STEP) {
        w.step();
        for (let i = 0; i < w.n; i++) maxV = Math.max(maxV, Math.hypot(w.vx[i]!, w.vy[i]!));
      }
      const after = snapshot(w);
      const drift = Math.max(...after.map((v, k) => Math.abs(v - before[k]!)));
      // Three seconds later nothing has moved by a fifth of a pixel (a tin unit is about 34 px), and no speed is left to see.
      expect(drift, `seed ${seed}`).toBeLessThan(0.005);
      // What's left is the substep estimate wobbling around zero inside a stack (a few thousandths of a unit), well
      // under the 1 unit/s it takes to squash a piece or make a sound.
      expect(maxV, `seed ${seed}`).toBeLessThan(0.9);
      // Nothing is sunk into anything: the bottom of a tall stack squishes by at most a pixel and a half.
      for (let i = 0; i < w.n; i++)
        for (let j = i + 1; j < w.n; j++) {
          const gap = Math.hypot(w.x[i]! - w.x[j]!, w.y[i]! - w.y[j]!) - w.r[i]! - w.r[j]!;
          expect(gap).toBeGreaterThan(-0.05);
        }
    }
  });

  it("never lets a fast piece tunnel through another, the walls or the dough", () => {
    const w = new World(W);
    w.floor = 0.5;
    w.add(7, 5, 0.5 + radius(7), radius(7));
    settle(w, 1);
    const small = w.add(0, 5.1, 14, radius(0));
    w.vy[small] = -28;
    for (let t = 0; t < 2; t += STEP) {
      w.step();
      const d = Math.hypot(w.x[0]! - w.x[1]!, w.y[0]! - w.y[1]!);
      expect(d).toBeGreaterThan(radius(7) + radius(0) - 0.06);
      for (let i = 0; i < w.n; i++) {
        expect(w.x[i]! - w.r[i]!).toBeGreaterThanOrEqual(-1e-9);
        expect(w.x[i]! + w.r[i]!).toBeLessThanOrEqual(W + 1e-9);
        expect(w.y[i]! - w.r[i]!).toBeGreaterThanOrEqual(w.floor - 0.03);
      }
    }
  });

  it("eases a swelling piece out of its neighbours: the pile is lifted, never thrown", () => {
    const w = pile(5, 18);
    settle(w, 4);
    // Swap the piece low in the middle of the pile for one that swells half again its size, much more than a merge.
    let mid = 0;
    for (let i = 1; i < w.n; i++) if (Math.abs(w.x[i]! - 5) + w.y[i]! < Math.abs(w.x[mid]! - 5) + w.y[mid]!) mid = i;
    const { x, y } = { x: w.x[mid]!, y: w.y[mid]! };
    const r0 = w.r[mid]!;
    w.remove(mid);
    w.add(6, x, y, r0, r0 * 1.5, 0.14);
    let up = 0;
    for (let t = 0; t < 1; t += STEP) {
      w.step();
      for (let i = 0; i < w.n; i++) up = Math.max(up, w.vy[i]!);
    }
    // The pile above has to rise by the extra diameter in 0.14 s; it should not fly much faster than that.
    expect(up).toBeLessThan((r0 * 1.0) / 0.14 + 2);
    for (let i = 0; i < w.n; i++) expect(w.y[i]! - w.r[i]!).toBeGreaterThanOrEqual(w.floor - 0.03);
  });

  it("carries the pile up as the dough rises", () => {
    const w = pile(8, 10);
    settle(w, 3);
    const y0 = w.y[0]!;
    for (let t = 0; t < 2; t += STEP) w.step(w.floor + 0.3 * STEP);
    expect(w.floor).toBeCloseTo(0.5 + 0.6, 2);
    expect(w.y[0]! - y0).toBeGreaterThan(0.5);
  });

  it("is deterministic: the same drops give the same pile, to the bit", () => {
    expect(snapshot(pile(41, 20))).toEqual(snapshot(pile(41, 20)));
  });

  it("refuses bodies beyond its cap", () => {
    const w = new World(W);
    for (let k = 0; k < MAX_BODIES; k++) expect(w.add(0, 5, 5, 0.4)).toBe(k);
    expect(w.add(0, 5, 5, 0.4)).toBe(-1);
  });
});
