import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { BASKET, catsLeft, deal, EMPTY, freeCats, occupancy, SPECS, specOf, squares, waves, wayOf, type Board, type Cat } from "../src/board.ts";

const cat = (id: number, x: number, y: number, len: number, dir: 0 | 1 | 2 | 3, coat = 1): Cat => ({ id, x, y, len, dir, coat, out: false });
const board = (cats: Cat[], baskets: number[] = [], cols = 4, rows = 4): Board => ({ cols, rows, cats, baskets, witness: [] });

describe("cats on a rug", () => {
  it("a cat lies behind its head, away from where it faces", () => {
    expect(squares(cat(0, 2, 1, 3, 0))).toEqual([[2, 1], [1, 1], [0, 1]]);
    expect(squares(cat(0, 1, 1, 2, 1))).toEqual([[1, 1], [1, 0]]);
    expect(squares(cat(0, 1, 2, 2, 2))).toEqual([[1, 2], [2, 2]]);
    expect(squares(cat(0, 3, 0, 2, 3))).toEqual([[3, 0], [3, 1]]);
    expect(squares(cat(0, 2, 2, 1, 0))).toEqual([[2, 2]]);
  });

  it("looks ahead: free squares, then the rug's edge, a cat or a basket", () => {
    const a = cat(0, 1, 0, 2, 0);
    const b = cat(1, 3, 1, 2, 3);
    const c = cat(2, 0, 3, 1, 3);
    const rug = board([a, b, c], [0 * 4 + 0 + 8]);
    // a faces right along the top row: one empty square, then b's tail... b lies in column 3, rows 1-2.
    expect(wayOf(rug, a)).toEqual({ free: 2, by: EMPTY });
    // b faces up column 3: the top square is empty, then the edge.
    expect(wayOf(rug, b)).toEqual({ free: 1, by: EMPTY });
    // c faces up column 0 into the basket on (0, 2).
    expect(wayOf(rug, c)).toEqual({ free: 0, by: BASKET });
    const d = cat(3, 1, 1, 2, 0);
    const rug2 = board([b, d]);
    expect(wayOf(rug2, d)).toEqual({ free: 1, by: 1 });
    expect(freeCats(rug2).map((k) => k.id)).toEqual([1]);
    b.out = true;
    expect(wayOf(rug2, d)).toEqual({ free: 2, by: EMPTY });
    expect(occupancy(rug2)[1 * 4 + 3]).toBe(EMPTY);
  });

  it("counts the rounds a rug takes, and knows one that cannot be cleared", () => {
    const open = board([cat(0, 0, 0, 1, 2), cat(1, 3, 3, 1, 0)]);
    expect(waves(open)).toBe(1);
    const queue = board([cat(0, 1, 0, 2, 0), cat(1, 2, 0, 1, 0), cat(2, 3, 0, 1, 0)]);
    expect(waves(queue)).toBe(3);
    // Two cats nose to nose.
    const stuck = board([cat(0, 1, 0, 2, 0), cat(1, 2, 0, 2, 2)]);
    expect(waves(stuck)).toBe(Infinity);
    expect(catsLeft(stuck)).toBe(2);
    // Counting never changes the rug.
    expect(queue.cats.every((c) => !c.out)).toBe(true);
  });
});

describe("dealing", () => {
  const DEALS = 150;

  it("every rug is laid inside its edges with nothing on top of anything else", () => {
    for (let level = 0; level < SPECS.length; level++) {
      const spec = specOf(level);
      for (let i = 0; i < DEALS; i++) {
        const b = deal(level, createRng(1 + i * 7919 + level * 131));
        expect([b.cols, b.rows]).toEqual([spec.cols, spec.rows]);
        const seen = new Set<number>();
        for (const idx of b.baskets) {
          expect(seen.has(idx)).toBe(false);
          seen.add(idx);
          // Baskets keep off the rim.
          const x = idx % b.cols;
          const y = Math.floor(idx / b.cols);
          expect(x > 0 && y > 0 && x < b.cols - 1 && y < b.rows - 1).toBe(true);
        }
        for (const c of b.cats) {
          expect(c.len).toBeGreaterThanOrEqual(1);
          expect(c.len).toBeLessThanOrEqual(3);
          for (const [x, y] of squares(c)) {
            expect(x >= 0 && y >= 0 && x < b.cols && y < b.rows).toBe(true);
            expect(seen.has(y * b.cols + x)).toBe(false);
            seen.add(y * b.cols + x);
          }
        }
        expect(b.baskets.length).toBe(spec.baskets);
      }
    }
  });

  it("every dealt rug clears: its witness scoots every cat off without one bump, the witch's cat last", () => {
    let total = 0;
    for (let level = 0; level < SPECS.length; level++) {
      for (let i = 0; i < DEALS; i++) {
        const b = deal(level, createRng(77 + i * 104729 + level * 17));
        expect(b.witness.length).toBe(b.cats.length);
        for (const id of b.witness) {
          const c = b.cats.find((k) => k.id === id)!;
          expect(c.out).toBe(false);
          expect(wayOf(b, c).by).toBe(EMPTY);
          c.out = true;
        }
        expect(catsLeft(b)).toBe(0);
        const last = b.cats.find((k) => k.id === b.witness[b.witness.length - 1])!;
        expect(last.coat).toBe(0);
        expect(b.cats.filter((k) => k.coat === 0)).toHaveLength(1);
        expect(last.len).toBe(2);
        total++;
      }
    }
    expect(total).toBe(SPECS.length * DEALS);
  });

  it("a rug that can be cleared stays clearable whatever free cat goes next", () => {
    for (let level = 0; level < SPECS.length; level++) {
      for (let i = 0; i < 60; i++) {
        const rng = createRng(500 + i * 31 + level);
        const b = deal(level, rng);
        while (catsLeft(b) > 0) {
          const free = freeCats(b);
          expect(free.length).toBeGreaterThan(0);
          rng.pick(free).out = true;
        }
      }
    }
  });

  it("no cat is ever shut in by a basket, and somebody can always go first", () => {
    for (let level = 3; level < SPECS.length; level++) {
      for (let i = 0; i < 80; i++) {
        const b = deal(level, createRng(9 + i * 613 + level));
        const occ = occupancy(b);
        for (const c of b.cats) {
          let x = c.x;
          let y = c.y;
          const dx = [1, 0, -1, 0][c.dir]!;
          const dy = [0, 1, 0, -1][c.dir]!;
          for (x += dx, y += dy; x >= 0 && y >= 0 && x < b.cols && y < b.rows; x += dx, y += dy) expect(occ[y * b.cols + x]).not.toBe(BASKET);
        }
        expect(freeCats(b).length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("rugs get fuller and more tangled: the cats asked for, and at least the rounds asked for, nearly always", () => {
    const meanWaves: number[] = [];
    for (let level = 0; level < SPECS.length; level++) {
      const spec = specOf(level);
      let full = 0;
      let tangled = 0;
      let sum = 0;
      for (let i = 0; i < DEALS; i++) {
        const b = deal(level, createRng(31337 + i * 271 + level * 7));
        if (b.cats.length === spec.cats) full++;
        const w = waves(b);
        if (w >= spec.waves) tangled++;
        sum += w;
      }
      expect(full / DEALS, `level ${level} cats`).toBeGreaterThanOrEqual(0.98);
      expect(tangled / DEALS, `level ${level} waves`).toBeGreaterThanOrEqual(0.9);
      meanWaves.push(sum / DEALS);
    }
    expect(meanWaves[SPECS.length - 1]!).toBeGreaterThan(meanWaves[0]! + 1.5);
    for (let i = 1; i < SPECS.length; i++) expect(specOf(i).cats).toBeGreaterThanOrEqual(specOf(i - 1).cats);
    // The first rug is four two-square cats on a four by four; past the last spec it repeats.
    expect(specOf(0)).toMatchObject({ cols: 4, rows: 4, cats: 4, baskets: 0 });
    expect(deal(0, createRng(5)).cats.every((c) => c.len === 2)).toBe(true);
    expect(specOf(99)).toBe(SPECS[SPECS.length - 1]);
  });

  it("the same seed deals the same rug, and a deal is quick", () => {
    const key = (b: Board) => JSON.stringify([b.cats, b.baskets]);
    expect(key(deal(5, createRng(42)))).toBe(key(deal(5, createRng(42))));
    expect(key(deal(5, createRng(42)))).not.toBe(key(deal(5, createRng(43))));
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      deal(6, createRng(i * 13 + 1));
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(40);
  });
});
