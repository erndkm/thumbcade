import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { coveredAtRest, coverTable, layoutWall, MAX_PEGS, planFor, WALL_H, WALL_W } from "../src/board.ts";
import { outline, PEG_R, sdf, sdfAt, toWorld } from "../src/geom.ts";

const walls = Array.from({ length: 90 }, (_, i) => ({ n: 1 + (i % 9), wall: layoutWall(planFor(1 + (i % 9)), createRng(900 + i * 13)) }));

describe("the dish wall", () => {
  it("has a peg total divisible by three, at least two pegs per dish and at least two layers", () => {
    for (const { n, wall } of walls) {
      expect(wall.pegs.length % 3, `wall ${n}`).toBe(0);
      expect(wall.pegs.length).toBeLessThanOrEqual(MAX_PEGS);
      expect(wall.pegs.length).toBeGreaterThanOrEqual(9);
      for (const d of wall.dishes) expect(d.pegs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(wall.dishes.map((d) => d.layer)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("puts every peg inside its own dish, on the wall, and a finger apart from every other peg", () => {
    for (const { wall } of walls) {
      for (const p of wall.pegs) {
        const d = wall.dishes[p.dish]!;
        expect(sdf(d.shape, p.lx, p.ly)).toBeLessThan(0);
        const [x, y] = toWorld(d.base, p.lx, p.ly);
        expect(x).toBeCloseTo(p.x, 9);
        expect(y).toBeCloseTo(p.y, 9);
        expect(p.x).toBeGreaterThan(0.29);
        expect(p.x).toBeLessThan(WALL_W - 0.29);
        for (const q of wall.pegs) if (q !== p) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(0.72 - 1e-9);
      }
    }
  });

  it("keeps dishes on one layer apart, and every dish on the wall (hanging from any peg it stays there)", () => {
    for (const { wall } of walls) {
      for (const d of wall.dishes) {
        for (const pose of [d.base, ...d.hang]) {
          for (const [x, y] of outline(d.shape, 24)) {
            const [wx, wy] = toWorld(pose, x, y);
            expect(wx).toBeGreaterThan(-0.06);
            expect(wx).toBeLessThan(WALL_W + 0.06);
            expect(wy).toBeLessThan(WALL_H + 0.52);
          }
        }
        for (const e of wall.dishes) {
          if (e === d || e.layer !== d.layer) continue;
          for (const [x, y] of outline(d.shape, 24)) {
            const [wx, wy] = toWorld(d.base, x, y);
            expect(sdfAt(e.shape, e.base, wx, wy)).toBeGreaterThan(0.07);
          }
        }
      }
    }
  });

  it("never leaves a peg within a hair of a covering dish's edge, pinned or hanging", () => {
    for (const { wall } of walls) {
      for (const p of wall.pegs) {
        const own = wall.dishes[p.dish]!;
        for (const d of wall.dishes) {
          if (d.layer <= own.layer) continue;
          for (const pose of [d.base, ...d.hang]) expect(Math.abs(sdfAt(d.shape, pose, p.x, p.y) - PEG_R)).toBeGreaterThanOrEqual(0.07 - 1e-9);
        }
      }
    }
  });

  it("covers pegs on lower layers only, and the table agrees with the shapes", () => {
    let covered = 0;
    for (const { wall } of walls) {
      const again = coverTable(wall.dishes, wall.pegs);
      expect(again).toEqual(wall.cover);
      const left = new Uint8Array(wall.pegs.length).fill(1);
      for (const p of wall.pegs) {
        for (const e of wall.cover[p.id]!) expect(wall.dishes[e.dish]!.layer).toBeGreaterThan(wall.dishes[p.dish]!.layer);
        if (coveredAtRest(wall, left, p.id)) covered++;
      }
      // The top layer is always free to start with.
      const top = Math.max(...wall.dishes.map((d) => d.layer));
      for (const d of wall.dishes) if (d.layer === top) for (const id of d.pegs) expect(coveredAtRest(wall, left, id)).toBe(false);
    }
    // And there is something to dig for: a good share of pegs start covered.
    expect(covered / walls.reduce((s, w) => s + w.wall.pegs.length, 0)).toBeGreaterThan(0.12);
  });

  it("grows with the walls: more pegs, layers and colours, new dish kinds", () => {
    expect(planFor(1).kinds).toEqual(["plate", "board"]);
    expect(planFor(5).kinds).toContain("pan");
    const mean = (n: number) => {
      const ws = walls.filter((w) => w.n === n);
      return ws.reduce((s, w) => s + w.wall.pegs.length, 0) / ws.length;
    };
    expect(mean(7)).toBeGreaterThan(mean(1) + 3);
    expect(planFor(6).colors).toBeGreaterThan(planFor(1).colors);
    expect(planFor(6).layers).toBeGreaterThan(planFor(1).layers);
  });

  it("is deterministic", () => {
    const a = layoutWall(planFor(6), createRng(5));
    const b = layoutWall(planFor(6), createRng(5));
    expect(a.pegs.map((p) => [p.x, p.y])).toEqual(b.pegs.map((p) => [p.x, p.y]));
  });
});
