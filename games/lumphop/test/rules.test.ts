import { describe, expect, it } from "vitest";
import { applyMove, canMove, cloneBoard, isClear, isIdleMove, isSealed, legalMoves, moveCount, runLength, type Board, type Pot } from "../src/rules.ts";

const pot = (units: number[], cap = 4, covered: boolean[] = units.map(() => false)): Pot => ({ units, covered, cap, ids: units.map((_, i) => 100 + i + units.length * 10) });

describe("rules", () => {
  it("the top run is the shown lumps of the top kind, and stops at a covered one", () => {
    expect(runLength(pot([0, 1, 1]))).toBe(2);
    expect(runLength(pot([1, 1, 1]))).toBe(3);
    expect(runLength(pot([1, 1, 1], 4, [false, true, false]))).toBe(1);
    expect(runLength(pot([]))).toBe(0);
  });

  it("a run lands on its own kind or in an empty pot, as much as fits", () => {
    const b: Board = [pot([0, 1, 1]), pot([2, 3, 1]), pot([]), pot([2, 0])];
    expect(moveCount(b, 0, 1)).toBe(1);
    expect(moveCount(b, 0, 2)).toBe(2);
    expect(moveCount(b, 0, 3)).toBe(0);
    expect(moveCount(b, 0, 0)).toBe(0);
    const r = applyMove(b, 0, 1)!;
    expect(r.n).toBe(1);
    expect(b[0]!.units).toEqual([0, 1]);
    expect(b[1]!.units).toEqual([2, 3, 1, 1]);
    // The rest stays behind, still the top run of its pot.
    expect(runLength(b[0]!)).toBe(1);
  });

  it("lumps keep their identities as they move", () => {
    const b: Board = [pot([0, 1, 1]), pot([])];
    const ids = b[0]!.ids!.slice();
    applyMove(b, 0, 1);
    expect(b[1]!.ids).toEqual(ids.slice(1));
    expect(b[0]!.ids).toEqual(ids.slice(0, 1));
  });

  it("uncovers the lump that comes to the top, and only that one", () => {
    const b: Board = [pot([0, 2, 1], 4, [true, true, false]), pot([])];
    const r = applyMove(b, 0, 1)!;
    expect(r.revealed).toBe(1);
    expect(r.revealedKind).toBe(2);
    expect(b[0]!.covered).toEqual([true, false]);
  });

  it("four of a kind in a full-size pot is sealed and takes no part any more", () => {
    const b: Board = [pot([1, 1, 1]), pot([1]), pot([])];
    const r = applyMove(b, 1, 0)!;
    expect(r.sealed).toBe(true);
    expect(isSealed(b[0]!)).toBe(true);
    expect(canMove(b, 0, 2)).toBe(false);
    expect(isClear(b)).toBe(true);
    // A little pot never seals, and four covered alike aren't sealed until shown.
    expect(isSealed(pot([1, 1, 1], 3))).toBe(false);
    expect(isSealed(pot([1, 1, 1, 1], 4, [true, false, false, false]))).toBe(false);
  });

  it("refuses moves into a full pot, from an empty one, or onto another kind", () => {
    const b: Board = [pot([0, 0, 1, 1]), pot([2, 2, 1, 1]), pot([]), pot([3], 2)];
    expect(canMove(b, 0, 1)).toBe(false);
    expect(canMove(b, 2, 0)).toBe(false);
    expect(canMove(b, 0, 3)).toBe(false);
    expect(applyMove(b, 0, 3)).toBeNull();
  });

  it("knows an idle move: a pot of one kind poured whole into an empty pot no bigger", () => {
    const b: Board = [pot([1, 1]), pot([]), pot([2, 1]), pot([1], 3), pot([], 3)];
    expect(isIdleMove(b, 0, 1)).toBe(true);
    expect(isIdleMove(b, 0, 4)).toBe(true);
    expect(isIdleMove(b, 2, 1)).toBe(false);
    // From a little pot into a full-size one it helps: the lumps can seal there.
    expect(isIdleMove(b, 3, 1)).toBe(false);
  });

  it("lists every legal move, and a clone is independent", () => {
    const b: Board = [pot([0, 1]), pot([1]), pot([])];
    expect(legalMoves(b).map((m) => `${m.from}${m.to}`)).toEqual(["01", "02", "10", "12"]);
    const c = cloneBoard(b);
    applyMove(c, 0, 1);
    expect(b[0]!.units).toEqual([0, 1]);
  });
});
