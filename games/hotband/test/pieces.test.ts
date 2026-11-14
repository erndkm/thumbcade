import { describe, expect, it } from "vitest";
import { BOX, cellsOf, COLS, extent, HIDDEN, KIND_COUNT, KINDS, poses, ROWS, SHAPES, SIZE, spawnAt, VISIBLE } from "../src/pieces.ts";
import { collides, newWell } from "../src/well.ts";

describe("the piece set", () => {
  it("is Hotband's own seven: a pair, a bar and a corner of three, a block, a tee, a zig and its mirror", () => {
    expect(KINDS).toEqual(["pair", "bar", "corner", "block", "tee", "zig", "zag"]);
    expect([...SIZE]).toEqual([2, 3, 3, 4, 4, 4, 4]);
    // No straight piece of four and no four-segment hooks: this is not the seven classic falling pieces.
    for (let k = 0; k < KIND_COUNT; k++) {
      const e = extent(k, 0);
      expect(Math.max(e.x1 - e.x0, e.y1 - e.y0) + 1, KINDS[k]).toBeLessThanOrEqual(3);
    }
    expect(KINDS).not.toContain("hook");
  });

  it("the meter is eight bands by sixteen rows with two hidden rows above", () => {
    expect([COLS, VISIBLE, HIDDEN, ROWS]).toEqual([8, 16, 2, 18]);
  });

  it("every piece keeps its segments through four quarter turns and comes back to where it began", () => {
    for (let k = 0; k < KIND_COUNT; k++) {
      const start = JSON.stringify([...cellsOf(k, 0)].sort());
      for (let r = 0; r < 4; r++) {
        const cells = cellsOf(k, r);
        expect(cells.length).toBe(SIZE[k]);
        expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(SIZE[k]);
        for (const [x, y] of cells) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(BOX[k]!);
          expect(y).toBeLessThan(BOX[k]!);
        }
      }
      const back = SHAPES[k]![3]!.map(([x, y]) => [BOX[k]! - 1 - y, x]);
      expect(JSON.stringify(back.sort())).toBe(start);
    }
  });

  it("segments of a piece touch edge to edge", () => {
    for (let k = 0; k < KIND_COUNT; k++) {
      const cells = cellsOf(k, 0);
      const seen = new Set([0]);
      const todo = [0];
      while (todo.length) {
        const [x, y] = cells[todo.pop()!]!;
        cells.forEach(([cx, cy], i) => {
          if (!seen.has(i) && Math.abs(cx - x) + Math.abs(cy - y) === 1) {
            seen.add(i);
            todo.push(i);
          }
        });
      }
      expect(seen.size, KINDS[k]).toBe(cells.length);
    }
  });

  it("counts poses: a block has one, a bar, a pair and the zigs two, a corner and a tee four", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(poses)).toEqual([2, 2, 4, 1, 4, 2, 2]);
  });

  it("zig and zag are mirror images", () => {
    const mirror = cellsOf(5, 0).map(([x, y]) => `${2 - x},${y}`).sort();
    expect(cellsOf(6, 0).map(([x, y]) => `${x},${y}`).sort()).toEqual(mirror);
  });

  it("a new piece arrives centred, inside the walls, with its lowest segment on the first visible row", () => {
    const w = newWell();
    for (let k = 0; k < KIND_COUNT; k++) {
      const { x, y } = spawnAt(k);
      expect(collides(w, k, 0, x, y)).toBe(false);
      const e = extent(k, 0);
      expect(y + e.y1).toBe(HIDDEN);
      expect(y + e.y0).toBeGreaterThanOrEqual(0);
      const left = x + e.x0;
      const right = COLS - 1 - (x + e.x1);
      expect(Math.abs(left - right), KINDS[k]).toBeLessThanOrEqual(1);
    }
  });
});
