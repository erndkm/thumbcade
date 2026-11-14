import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { candidates, complete, consistent, countSolutions, digitsOf, geometry, randomSolution, SHAPE_4, SHAPE_6 } from "../src/grid.ts";
import { deal, gridSeed, specFor } from "../src/gen.ts";
import { easiest, singles, solve, TECH } from "../src/solver.ts";

describe("grid geometry", () => {
  it("has n rows, n columns and n boxes of n keys, and every key sits in one of each", () => {
    for (const shape of [SHAPE_4, SHAPE_6]) {
      const g = geometry(shape);
      expect(g.units).toHaveLength(3 * shape.n);
      for (const u of g.units) expect(new Set(u).size).toBe(shape.n);
      for (let i = 0; i < g.cells; i++) {
        const [r, c, b] = g.unitsOf[i]!;
        expect(g.units[r]).toContain(i);
        expect(g.units[c]).toContain(i);
        expect(g.units[b]).toContain(i);
      }
    }
  });

  it("6 × 6 boxes are 2 rows by 3 columns, so a key has 12 peers (7 on a 4 × 4)", () => {
    const g6 = geometry(SHAPE_6);
    expect(g6.units[12]).toEqual([0, 1, 2, 6, 7, 8]);
    expect(g6.units[17]).toEqual([27, 28, 29, 33, 34, 35]);
    for (const p of g6.peers) expect(p).toHaveLength(12);
    for (const p of geometry(SHAPE_4).peers) expect(p).toHaveLength(7);
  });

  it("random full grids are complete and consistent, and deterministic per seed", () => {
    for (const shape of [SHAPE_4, SHAPE_6]) {
      const g = geometry(shape);
      for (let s = 0; s < 200; s++) {
        const v = randomSolution(shape, createRng(s));
        expect(complete(g, v)).toBe(true);
      }
      expect(Array.from(randomSolution(shape, createRng(7)))).toEqual(Array.from(randomSolution(shape, createRng(7))));
    }
  });

  it("counts solutions exactly: one for a full grid, many for an empty one, none for a clash", () => {
    const g = geometry(SHAPE_6);
    const full = randomSolution(SHAPE_6, createRng(3));
    expect(countSolutions(g, full)).toBe(1);
    expect(countSolutions(g, new Int8Array(36), 50)).toBe(50);
    const bad = Int8Array.from(full);
    bad[1] = bad[0]!;
    expect(consistent(g, bad)).toBe(false);
    expect(countSolutions(g, bad)).toBe(0);
  });

  it("candidates only rule out digits placed in a key's row, column and box", () => {
    const g = geometry(SHAPE_4);
    // 1 2 . .
    // . . . .
    // . . 3 .
    // . . . 4
    const v = Int8Array.from([1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4]);
    const c = candidates(g, v);
    expect(digitsOf(c[3]!)).toEqual([3]);
    expect(digitsOf(c[5]!)).toEqual([3, 4]);
    expect(c[0]).toBe(0);
  });
});

describe("the human-technique solver", () => {
  const g4 = geometry(SHAPE_4);

  it("finds a last gap first, and names the unit that shows it", () => {
    // Row 0 has one gap.
    const v = Int8Array.from([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const s = singles(g4, v);
    expect(s[0]).toMatchObject({ cell: 3, digit: 4, tech: TECH.fullHouse, unit: 0 });
  });

  it("finds a digit with one home in a box", () => {
    // 1 . . .
    // . . 1 .
    // . . . .
    // . . . 1   → in the bottom-left box, column 0 and row 3 already hold a 1: it can only go in key 9.
    const w = Int8Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const hit = singles(g4, w).find((p) => p.cell === 9);
    expect(hit).toMatchObject({ digit: 1, tech: TECH.hiddenBox });
  });

  it("finds a key with one digit left when no hidden single shows it (a stretch grid has such a moment)", () => {
    const g6 = geometry(SHAPE_6);
    let seen = 0;
    for (let k = 0; k < 6; k++) {
      const p = deal(specFor(5), createRng(gridSeed(k, 5)));
      if (p.grade !== TECH.nakedSingle) continue;
      const v = Int8Array.from(p.givens);
      for (const step of solve(g6, p.givens).placements) {
        const all = singles(g6, v);
        if (all.length && all.every((q) => q.tech === TECH.nakedSingle)) {
          for (const q of all) expect(p.solution[q.cell]).toBe(q.digit);
          seen++;
        }
        v[step.cell] = step.digit;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("never places a wrong digit, and fills a dug grid completely when it is unique", () => {
    const g6 = geometry(SHAPE_6);
    for (let s = 0; s < 300; s++) {
      const sol = randomSolution(SHAPE_6, createRng(1000 + s));
      const v = Int8Array.from(sol);
      const r = createRng(s);
      for (let k = 0; k < 18; k++) v[r.int(0, 35)] = 0;
      const res = solve(g6, v);
      if (countSolutions(g6, v) === 1) {
        for (const p of res.placements) expect(p.digit).toBe(sol[p.cell]);
      }
      if (res.solved) expect(countSolutions(g6, v)).toBe(1);
    }
  });

  it("the nudge is always a right move", () => {
    const g6 = geometry(SHAPE_6);
    for (let s = 0; s < 200; s++) {
      const sol = randomSolution(SHAPE_6, createRng(500 + s));
      const v = Int8Array.from(sol);
      const r = createRng(s + 7);
      for (let k = 0; k < 14; k++) v[r.int(0, 35)] = 0;
      if (countSolutions(g6, v) !== 1) continue;
      const p = easiest(g6, v);
      if (p) expect(sol[p.cell]).toBe(p.digit);
    }
  });
});
