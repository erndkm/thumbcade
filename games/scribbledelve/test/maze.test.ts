import { describe, expect, it } from "vitest";
import { beside, COLS, degree, distances, generate, HOLES, isOpen, N, opposite, ROWS, START, xOf, yOf } from "../src/maze.ts";

const SEEDS = Array.from({ length: 400 }, (_, i) => 17 + i * 7919);

function rooms(m: ReturnType<typeof generate>): number {
  let n = 0;
  for (let y = 0; y < ROWS - 1; y++) {
    for (let x = 0; x < COLS - 1; x++) {
      const a = y * COLS + x;
      const b = (y + 1) * COLS + x + 1;
      if (isOpen(m, a, 1) && isOpen(m, a, 2) && isOpen(m, b, 0) && isOpen(m, b, 3)) n++;
    }
  }
  return n;
}

describe("the dungeon map", () => {
  it("is one connected maze: every square can be reached from the start", () => {
    for (const s of SEEDS) {
      const d = distances(generate(s), START);
      for (let c = 0; c < N; c++) expect(d[c], `seed ${s} square ${c}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("has no dead ends, no gaps off the sheet, and every gap opens both ways", () => {
    for (const s of SEEDS) {
      const m = generate(s);
      for (let c = 0; c < N; c++) {
        expect(degree(m, c), `seed ${s} square ${c}`).toBeGreaterThanOrEqual(2);
        for (let d = 0; d < 4; d++) {
          const n = beside(c, d);
          if (n < 0) expect(isOpen(m, c, d)).toBe(false);
          else expect(isOpen(m, c, d)).toBe(isOpen(m, n, opposite(d)));
        }
      }
    }
  });

  it("is corridors with loops: no open 2 × 2 room, always several ways round", () => {
    for (const s of SEEDS) {
      const m = generate(s);
      expect(rooms(m), `seed ${s}`).toBe(0);
      let gaps = 0;
      for (let c = 0; c < N; c++) gaps += degree(m, c);
      gaps /= 2;
      // A maze with no loops has N - 1 gaps; every extra gap is another way round.
      expect(gaps - (N - 1), `seed ${s}`).toBeGreaterThanOrEqual(6);
      // Still a maze: at least a quarter of the 110 lines between squares are left standing.
      expect(gaps).toBeLessThanOrEqual(0.75 * (COLS * (ROWS - 1) + ROWS * (COLS - 1)));
    }
  });

  it("puts the knight bottom middle, the holes at the edges well away from him, and two swords far apart", () => {
    expect(START).toBe((ROWS - 1) * COLS + 3);
    expect(HOLES).toHaveLength(4);
    for (const s of SEEDS) {
      const m = generate(s);
      const d = distances(m, START);
      for (const h of m.holes) {
        expect(xOf(h) === 0 || xOf(h) === COLS - 1).toBe(true);
        expect(d[h]).toBeGreaterThanOrEqual(5);
      }
      expect(m.swords).toHaveLength(2);
      const [a, b] = m.swords as [number, number];
      expect(a).not.toBe(b);
      for (const sw of m.swords) {
        expect(m.holes).not.toContain(sw);
        expect(sw).not.toBe(START);
        expect(d[sw], `seed ${s}`).toBeGreaterThanOrEqual(6);
      }
      expect(distances(m, a)[b], `seed ${s}`).toBeGreaterThanOrEqual(4);
      expect(Math.abs(yOf(a) - yOf(b)) + Math.abs(xOf(a) - xOf(b)), `seed ${s}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("is the same maze for the same seed and a different one for another", () => {
    const a = generate(1234);
    expect([...generate(1234).open]).toEqual([...a.open]);
    expect(generate(1234).swords).toEqual(a.swords);
    let same = 0;
    for (const s of SEEDS.slice(0, 50)) if ([...generate(s).open].join("") === [...a.open].join("")) same++;
    expect(same).toBe(0);
  });

  it("counts steps through the gaps only", () => {
    const m = generate(99);
    const d = distances(m, START);
    expect(d[START]).toBe(0);
    for (let c = 0; c < N; c++) {
      for (let dir = 0; dir < 4; dir++) {
        if (!isOpen(m, c, dir)) continue;
        expect(Math.abs(d[c]! - d[beside(c, dir)]!)).toBeLessThanOrEqual(1);
      }
      if (c !== START) expect([0, 1, 2, 3].some((dir) => isOpen(m, c, dir) && d[beside(c, dir)] === d[c]! - 1)).toBe(true);
    }
  });
});
