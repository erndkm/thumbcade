import { Chess, type Square } from "chess.js";
import { describe, expect, it } from "vitest";
import { mainLine, Solver } from "../scripts/solver.ts";
import { PUZZLES } from "../src/puzzles.ts";

const play = (c: Chess, u: string) => c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

describe("Gambit puzzle set", () => {
  it("ships at least 40 puzzles across mate in 1, 2 and 3, all distinct", () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(40);
    for (const n of [1, 2, 3]) expect(PUZZLES.filter((p) => p.mateIn === n).length).toBeGreaterThanOrEqual(8);
    expect(new Set(PUZZLES.map((p) => p.fen)).size).toBe(PUZZLES.length);
  });

  it.each(PUZZLES.map((p, i) => [i, p] as const))("puzzle %i is a legal position with a unique, exact forced mate", (_i, p) => {
    const c = new Chess(p.fen);
    const them = c.turn() === "w" ? "b" : "w";
    // The side not to move is not in check; at most one queen per side.
    const king = c.board().flat().find((s) => s?.type === "k" && s.color === them)!;
    expect(c.isAttacked(king.square as Square, c.turn())).toBe(false);
    for (const color of ["w", "b"]) expect(c.board().flat().filter((s) => s?.type === "q" && s.color === color).length).toBeLessThanOrEqual(1);

    // The stored line is legal, alternates sides, and ends in checkmate after the player's last move.
    expect(p.line.length).toBe(p.mateIn * 2 - 1);
    for (const u of p.line) play(c, u);
    expect(c.isCheckmate()).toBe(true);

    // Exactly one key move, no faster mate, and the solver reproduces a line with the same key.
    const s = new Solver(p.fen);
    const keys = s.keys(p.mateIn).map((m) => `${"abcdefgh"[m.from & 15]}${8 - (m.from >> 4)}${"abcdefgh"[m.to & 15]}${8 - (m.to >> 4)}${m.promotion ?? ""}`);
    if (p.mateIn === 1) expect(keys).toEqual([p.line[0]]);
    else {
      expect(keys).toEqual([p.line[0]]);
      expect(s.mateIn(p.mateIn - 1)).toBe(false);
    }
    expect(mainLine(p.fen, p.mateIn)?.[0]).toBe(p.line[0]);
  }, 120_000);
});
