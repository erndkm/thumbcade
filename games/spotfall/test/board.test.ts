import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { Board, BOMB, COLS, EMPTY, HIT, LAUNCH_X, LAUNCH_Y, MIN_ANGLE, ROW_H, ROWS, WILD } from "../src/board.ts";
import { settle } from "../src/run.ts";

function randomBoard(seed: number, rows: number, inks = 5): Board {
  const rng = createRng(seed);
  const b = new Board();
  for (let i = 0; i < rows; i++) b.feed(Array.from({ length: COLS }, () => (rng() < 0.12 ? EMPTY : rng.int(0, inks - 1))));
  // Holes can leave islands; drop them so the sheet is a real one.
  for (const f of b.floating()) b.set(f.r, f.c, EMPTY);
  return b;
}

describe("hex sheet", () => {
  it("alternates full and offset rows, and the press flips them as it feeds", () => {
    const b = new Board();
    expect(b.cols(0)).toBe(COLS);
    expect(b.cols(1)).toBe(COLS - 1);
    b.feed([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(b.shift).toBe(1);
    expect(b.cols(0)).toBe(COLS - 1);
    expect(b.cols(1)).toBe(COLS);
  });

  it("neighbours are one dot apart and mutual", () => {
    const b = new Board();
    for (let shift = 0; shift < 2; shift++) {
      b.shift = shift as 0 | 1;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < b.cols(r); c++)
          for (const n of b.neighbors(r, c)) {
            expect(Math.hypot(b.cx(n.r, n.c) - b.cx(r, c), b.cy(n.r) - b.cy(r))).toBeCloseTo(1, 6);
            expect(b.neighbors(n.r, n.c).some((m) => m.r === r && m.c === c)).toBe(true);
          }
    }
  });

  it("a feed moves every dot down one row and keeps its x", () => {
    const b = randomBoard(3, 5);
    const round = (v: number) => Math.round(v * 1e6) / 1e6;
    const before = b.occupied().map((o) => ({ k: b.get(o.r, o.c), x: round(b.cx(o.r, o.c)), y: round(b.cy(o.r)) }));
    b.feed([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const after = b
      .occupied()
      .filter((o) => o.r > 0)
      .map((o) => ({ k: b.get(o.r, o.c), x: round(b.cx(o.r, o.c)), y: round(b.cy(o.r) - ROW_H) }));
    expect(after).toEqual(before);
    // Row 0 is now the other kind of row than the old row 0.
    expect(b.cols(0)).toBe(b.cols(1) === COLS ? COLS - 1 : COLS);
    for (let c = 0; c < b.cols(0); c++) expect(b.get(0, c)).toBe(1);
  });
});

describe("the shot", () => {
  it("straight up on a clean sheet reaches the press and settles in row 0, mid-sheet", () => {
    const b = new Board();
    const t = b.trace(Math.PI / 2);
    expect(t.bounces).toBe(0);
    expect(t.length).toBeCloseTo(LAUNCH_Y - 0.5, 6);
    expect(t.cell.r).toBe(0);
    expect(b.cx(0, t.cell.c)).toBeCloseTo(LAUNCH_X, 6);
  });

  it("bounces off a wall like a mirror", () => {
    const b = new Board();
    const a = 0.5;
    const t = b.trace(a);
    expect(t.bounces).toBeGreaterThan(0);
    const [p0, p1, p2] = t.points;
    expect(p1!.x).toBeCloseTo(COLS - 0.5, 6);
    // Incoming and outgoing slopes mirror each other.
    const s1 = (p1!.y - p0!.y) / (p1!.x - p0!.x);
    const s2 = (p2!.y - p1!.y) / (p2!.x - p1!.x);
    expect(s2).toBeCloseTo(-s1, 6);
  });

  it("never clamps past the shallowest angle", () => {
    const b = new Board();
    const t = b.trace(0);
    const [p0, p1] = t.points;
    expect(Math.atan2(p0!.y - p1!.y, p1!.x - p0!.x)).toBeCloseTo(MIN_ANGLE, 6);
  });

  it("what the guide shows is where the dot lands: the path never passes through a dot, and it settles touching where it stopped", () => {
    let traces = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const b = randomBoard(seed, 4 + (seed % 5));
      const dots = b.occupied().map((o) => ({ x: b.cx(o.r, o.c), y: b.cy(o.r) }));
      for (let a = MIN_ANGLE; a < Math.PI - MIN_ANGLE; a += 0.037) {
        const t = b.trace(a);
        // Sample the path up to contact: no point is ever closer than the hit distance to a resting dot.
        let closest = Infinity;
        for (let i = 1; i < t.points.length; i++) {
          const p = t.points[i - 1]!;
          const q = t.points[i]!;
          const len = Math.hypot(q.x - p.x, q.y - p.y);
          for (let d = 0; d < len - 1e-6; d += 0.05) {
            const x = p.x + ((q.x - p.x) * d) / len;
            const y = p.y + ((q.y - p.y) * d) / len;
            for (const o of dots) closest = Math.min(closest, Math.hypot(o.x - x, o.y - y));
          }
        }
        // It settles in an empty cell it can hang from, right where it touched.
        const ok =
          closest > HIT - 1e-6 &&
          b.get(t.cell.r, t.cell.c) === EMPTY &&
          b.attachable(t.cell.r, t.cell.c) &&
          Math.hypot(b.cx(t.cell.r, t.cell.c) - t.contact.x, b.cy(t.cell.r) - t.contact.y) < 1;
        if (!ok) expect({ seed, a, closest, cell: t.cell, contact: t.contact }).toBe("a fair landing");
        traces++;
      }
    }
    expect(traces).toBeGreaterThan(700);
  });
});

describe("pops and drops", () => {
  it("three of an ink pop; fewer stay", () => {
    const b = new Board();
    b.set(0, 3, 1);
    b.set(0, 4, 1);
    const stay = settle(b.clone(), { r: 0, c: 6 }, 1);
    expect(stay.popped).toHaveLength(0);
    const pop = settle(b, { r: 0, c: 5 }, 1);
    expect(pop.how).toBe("match");
    expect(pop.popped).toHaveLength(3);
    expect(b.count()).toBe(0);
  });

  it("dots that only hung from a popped group drop", () => {
    const b = new Board();
    // A pink pair at the top, a yellow chain hanging off it.
    b.set(0, 4, 1);
    b.set(0, 5, 1);
    b.set(1, 4, 2);
    b.set(2, 4, 2);
    b.set(3, 4, 0);
    const s = settle(b, { r: 0, c: 3 }, 1);
    expect(s.popped).toHaveLength(3);
    expect(s.dropped.map((d) => d.kind).sort()).toEqual([0, 2, 2]);
    expect(b.count()).toBe(0);
  });

  it("a dot still hanging by another path stays", () => {
    const b = new Board();
    b.set(0, 4, 1);
    b.set(0, 5, 1);
    b.set(0, 6, 3);
    b.set(1, 5, 2); // hangs from (0,5) and (0,6) on an offset row
    const s = settle(b, { r: 0, c: 3 }, 1);
    expect(s.popped).toHaveLength(3);
    expect(s.dropped).toHaveLength(0);
    expect(b.get(1, 5)).toBe(2);
  });

  it("a registration mark joins the biggest group next to it", () => {
    const b = new Board();
    b.set(0, 2, 0);
    b.set(0, 3, 0);
    b.set(0, 5, 4);
    const s = settle(b, { r: 0, c: 4 }, WILD);
    expect(s.how).toBe("wild");
    expect(s.kind).toBe(0);
    expect(s.popped).toHaveLength(3);
    expect(b.get(0, 5)).toBe(4);
  });

  it("a registration mark with nothing to join takes its neighbour's ink and stays", () => {
    const b = new Board();
    b.set(0, 2, 3);
    const s = settle(b, { r: 0, c: 3 }, WILD);
    expect(s.how).toBe("none");
    expect(b.get(0, 3)).toBe(3);
  });

  it("an ink blot bursts everything around it and drops what hung from it", () => {
    const b = randomBoard(9, 6, 6);
    const cell = { r: 6, c: 4 };
    b.set(5, 4, 1);
    b.set(5, 3, 2);
    const s = settle(b, cell, BOMB);
    expect(s.how).toBe("bomb");
    expect(s.popped.length).toBeGreaterThanOrEqual(3);
    expect(b.get(cell.r, cell.c)).toBe(EMPTY);
    expect(b.floating()).toHaveLength(0);
  });
});
