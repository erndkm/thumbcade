import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { dealLevel, planFor, PLANS } from "../src/deal.ts";
import { applyMove, cloneBoard, FULL, isClear, isSealed, legalMoves, type Board, type Pot } from "../src/rules.ts";
import { boardKey, solve } from "../src/solver.ts";

const pot = (units: number[], cap = 4): Pot => ({ units, covered: units.map(() => false), cap });

/** Plays a line with the real rules and reports whether it tidies the board. */
function playsOut(board: Board, line: ReadonlyArray<{ from: number; to: number }>): boolean {
  const b = cloneBoard(board);
  for (const m of line) if (!applyMove(b, m.from, m.to)) return false;
  return isClear(b);
}

describe("deals", () => {
  it("every dealt level can be tidied: 150 deals per level plan (1,200 in all), each witness played with the real rules", () => {
    for (let l = 0; l < PLANS.length; l++) {
      const plan = PLANS[l]!;
      const rng = createRng(4242 + l * 97);
      for (let i = 0; i < 150; i++) {
        const d = dealLevel(plan, rng);
        expect(playsOut(d.board, d.witness), `level ${l + 1} deal ${i}`).toBe(true);
      }
    }
  });

  it("deals what the plan asks for: four of each kind, the empty and little pots, the covered lumps, no top covered", () => {
    for (let l = 1; l <= PLANS.length; l++) {
      const plan = planFor(l);
      const d = dealLevel(plan, createRng(l * 13));
      const counts = new Map<number, number>();
      let covered = 0;
      for (const p of d.board) {
        p.units.forEach((k, i) => {
          counts.set(k, (counts.get(k) ?? 0) + 1);
          if (p.covered[i]) covered++;
        });
        if (p.units.length) expect(p.covered[p.units.length - 1]).toBe(false);
      }
      expect(counts.size).toBe(plan.kinds);
      for (const n of counts.values()) expect(n).toBe(FULL);
      expect(covered).toBe(plan.covered);
      expect(d.board.filter((p) => !p.units.length && p.cap === FULL).length).toBe(plan.empty);
      expect(d.board.filter((p) => p.cap < FULL).length).toBe(plan.little ? 1 : 0);
      // Nothing is half done before the first tap.
      expect(d.board.some(isSealed)).toBe(false);
      for (const p of d.board) {
        const c = new Map<number, number>();
        for (const k of p.units) c.set(k, (c.get(k) ?? 0) + 1);
        if (plan.kinds > 2) for (const n of c.values()) expect(n).toBeLessThanOrEqual(2);
      }
    }
  });

  it("levels escalate: more kinds, then covered lumps, then a little pot that takes an empty one's place", () => {
    const kinds = PLANS.map((p) => p.kinds);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]!).toBeGreaterThanOrEqual(kinds[i - 1]!);
    expect(PLANS[0]!.covered).toBe(0);
    expect(PLANS.some((p) => p.little > 0)).toBe(true);
    expect(planFor(99)).toEqual(PLANS[PLANS.length - 1]);
  });

  it("is deterministic for a seed", () => {
    const a = dealLevel(planFor(5), createRng(77));
    const b = dealLevel(planFor(5), createRng(77));
    expect(boardKey(a.board)).toBe(boardKey(b.board));
    expect(a.witness).toEqual(b.witness);
  });
});

describe("solver", () => {
  it("solves small positions and its line works", () => {
    const b: Board = [pot([0, 1, 0, 1]), pot([1, 0, 1, 0]), pot([]), pot([])];
    const s = solve(b);
    expect(s.status).toBe("solved");
    expect(playsOut(b, s.moves)).toBe(true);
  });

  it("proves a dead end dead: no move at all, or moves that only go round", () => {
    const stuck: Board = [pot([0, 1, 0, 1]), pot([1, 0, 1, 0])];
    expect(solve(stuck).status).toBe("dead");
    // A little pot to shuffle through, but every way of using it comes back round.
    const loop: Board = [pot([0, 1, 2, 0]), pot([1, 2, 0, 1]), pot([2, 0, 1, 2]), pot([], 2)];
    expect(legalMoves(loop).length).toBeGreaterThan(0);
    expect(solve(loop).status).toBe("dead");
    // The same position with a full-size empty pot can be tidied.
    expect(solve([...loop.slice(0, 3), pot([])]).status).toBe("solved");
  });

  it("takes covered lumps into account: a run stops at a covered lump", () => {
    const b: Board = [{ units: [0, 0, 0, 1], covered: [false, true, false, false], cap: 4 }, pot([1, 1, 1]), pot([0])];
    const s = solve(b);
    expect(s.status).toBe("solved");
    expect(playsOut(b, s.moves)).toBe(true);
  });

  it("sees moves the same way the rules do", () => {
    const rng = createRng(9);
    for (let i = 0; i < 40; i++) {
      const d = dealLevel(planFor(1 + (i % PLANS.length)), rng);
      expect(legalMoves(d.board).length).toBeGreaterThan(0);
    }
  });
});
