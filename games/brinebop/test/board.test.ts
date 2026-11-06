import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { Board, CLEAR_T, COLS, idx, KINDS, N, ROWS, SWAP_T, type BoardEvent } from "../src/board.ts";

const rng = (seed = 1) => createRng(seed);

/** Steps the board until it is calm (or a time limit), collecting every event. */
function settle(b: Board, max = 10): BoardEvent[] {
  const out: BoardEvent[] = [];
  for (let t = 0; t < max; t += 1 / 60) {
    b.step(1 / 60);
    out.push(...b.events);
    b.events.length = 0;
    if (b.calm) break;
  }
  return out;
}

/** Any run of three anywhere among resting critters? */
function hasRun(b: Board): boolean {
  const k = (c: number, r: number) => {
    const p = b.grid[idx(c, r)];
    return p && p.kind >= 0 ? p.kind : -1 - c - r * 100;
  };
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (c + 2 < COLS && k(c, r) === k(c + 1, r) && k(c, r) === k(c + 2, r)) return true;
      if (r + 2 < ROWS && k(c, r) === k(c, r + 1) && k(c, r) === k(c, r + 2)) return true;
    }
  return false;
}

/** A board with no move at all: kind (c + 2r) mod 6. */
const DEAD = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => "ABCDEF"[(c + 2 * r) % 6]).join(" "));

/** DEAD with a few cells replaced. */
function dead(edits: Record<string, string>): string[] {
  const rows = DEAD.map((l) => l.split(" "));
  for (const [key, tok] of Object.entries(edits)) {
    const [c, r] = key.split(",").map(Number) as [number, number];
    rows[r]![c] = tok;
  }
  return rows.map((r) => r.join(" "));
}

describe("a fresh board", () => {
  it("never starts with a match and always has a move", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const b = new Board(rng(seed));
      expect(b.grid.every((p) => p && p.kind >= 0 && p.kind < KINDS)).toBe(true);
      expect(hasRun(b)).toBe(false);
      expect(b.hasMove()).toBe(true);
    }
  });

  it("is the same for the same seed", () => {
    expect(new Board(rng(42)).toRows()).toEqual(new Board(rng(42)).toRows());
    expect(new Board(rng(42)).toRows()).not.toEqual(new Board(rng(43)).toRows());
  });
});

describe("moves", () => {
  it("knows a dead board when it sees one", () => {
    const b = Board.fromRows(DEAD, rng());
    expect(hasRun(b)).toBe(false);
    expect(b.hasMove()).toBe(false);
    expect(b.findMoves()).toEqual([]);
  });

  it("finds a swap that makes three and drags the right critter", () => {
    // Row 0: A B C D E F A -> put an A at (2,1)? Make "A A . A" style: (0,0)=A, (1,0)=A, (3,0)=A with C at (2,0).
    const b = Board.fromRows(dead({ "1,0": "A", "3,0": "A", "2,1": "A" }), rng());
    // (2,1) is A under (2,0) C: dragging it up makes A A A A in row 0.
    const moves = b.findMoves();
    const up = moves.find((m) => m.from === idx(2, 1) && m.to === idx(2, 0));
    expect(up).toBeDefined();
    expect(up!.makes).toBe("lineH");
    expect(b.wouldWork(idx(2, 1), idx(2, 0))).toBe(true);
    expect(b.wouldWork(idx(4, 4), idx(5, 4))).toBe(false);
  });

  it("counts special pairs and the conch as moves on their own", () => {
    const b = Board.fromRows(dead({ "3,4": "@" }), rng());
    expect(b.hasMove()).toBe(true);
    const c = Board.fromRows(dead({ "3,4": "A-", "4,4": "B*" }), rng());
    expect(c.findMoves().some((m) => [m.from, m.to].sort().join() === [idx(3, 4), idx(4, 4)].join())).toBe(true);
  });
});

describe("swapping", () => {
  it("snaps a swap that makes nothing back, with no score", () => {
    const b = Board.fromRows(dead({ "6,8": "@" }), rng());
    const before = b.toRows();
    expect(b.trySwap(idx(1, 1), idx(2, 1))).toBe(true);
    const ev = settle(b);
    expect(ev.some((e) => e.type === "reject")).toBe(true);
    expect(ev.some((e) => e.type === "match")).toBe(false);
    expect(b.toRows()).toEqual(before);
  });

  it("only swaps resting neighbours", () => {
    const b = new Board(rng(3));
    expect(b.trySwap(idx(0, 0), idx(2, 0))).toBe(false);
    expect(b.trySwap(idx(0, 0), idx(1, 1))).toBe(false);
    expect(b.trySwap(idx(0, 0), idx(1, 0))).toBe(true);
    // Both are moving now.
    expect(b.trySwap(idx(1, 0), idx(2, 0))).toBe(false);
  });
});

describe("matches and specials", () => {
  it("clears three in a row and refills the pool", () => {
    // A at (0,0) (1,0); C at (2,0); an A below (2,1) -> swap up.
    const b = Board.fromRows(dead({ "1,0": "A", "2,1": "A", "3,0": "D" }), rng(5));
    b.trySwap(idx(2, 1), idx(2, 0));
    const ev = settle(b);
    const m = ev.find((e) => e.type === "match");
    expect(m).toMatchObject({ type: "match", kind: 0, chain: 1, created: "none", player: true });
    expect(m && m.type === "match" && m.cells.length).toBe(3);
    expect(b.grid.every((p) => p !== null)).toBe(true);
    expect(ev.filter((e) => e.type === "pop").length).toBeGreaterThanOrEqual(3);
  });

  it("makes a squirter from four in a row, where the critter was dragged", () => {
    const b = Board.fromRows(dead({ "1,0": "A", "3,0": "A", "2,1": "A" }), rng(5));
    b.trySwap(idx(2, 1), idx(2, 0));
    const ev = settle(b);
    const m = ev.find((e) => e.type === "match" && e.player);
    expect(m && m.type === "match" && m.created).toBe("lineH");
    expect(b.grid[idx(2, 0)]!.special).toBe("lineH");
  });

  it("makes a boomer from an L or T", () => {
    // Column 3 rows 2-4 = A (after swap), row 4 cols 3-5 = A -> L.
    const b = Board.fromRows(dead({ "3,2": "A", "3,3": "A", "4,4": "A", "5,4": "A", "2,4": "A", "3,4": "F" }), rng(5));
    // (2,4)=A moves right onto (3,4): column 3 = A A A (rows 2..4), row 4 = A A A (3..5).
    b.trySwap(idx(2, 4), idx(3, 4));
    settle(b);
    expect(b.grid[idx(3, 4)]!.special).toBe("bomb");
  });

  it("makes a conch from five in a row", () => {
    const b = Board.fromRows(dead({ "0,6": "A", "1,6": "A", "3,6": "A", "4,6": "A", "2,7": "A" }), rng(5));
    b.trySwap(idx(2, 7), idx(2, 6));
    settle(b);
    const p = b.grid[idx(2, 6)]!;
    expect(p.special).toBe("conch");
    expect(p.kind).toBe(-1);
  });

  it("a squirter clears its whole row", () => {
    const b = Board.fromRows(dead({ "3,5": "C-" }), rng(5));
    expect(b.detonate(idx(3, 5))).toBe(true);
    const ev = settle(b);
    const fire = ev.find((e) => e.type === "fire");
    expect(fire && fire.type === "fire" && fire.cells.length).toBe(COLS);
    const pops = ev.filter((e) => e.type === "pop" && Math.round(e.y) === 5);
    expect(pops.length).toBeGreaterThanOrEqual(COLS);
  });

  it("a boomer clears a 5x5 without its corners", () => {
    const b = Board.fromRows(dead({ "3,4": "C*" }), rng(5));
    b.detonate(idx(3, 4));
    const ev = settle(b);
    const fire = ev.find((e) => e.type === "fire");
    expect(fire && fire.type === "fire" && fire.cells.length).toBe(21);
  });

  it("specials set each other off", () => {
    const b = Board.fromRows(dead({ "0,2": "A-", "4,2": "B|" }), rng(5));
    b.detonate(idx(0, 2));
    const ev = settle(b);
    const fires = ev.filter((e) => e.type === "fire");
    expect(fires.map((f) => f.type === "fire" && f.special)).toEqual(["lineH", "lineV"]);
  });
});

describe("special combos", () => {
  it("conch + critter honks every critter of that kind off the board", () => {
    const b = Board.fromRows(dead({ "3,4": "@" }), rng(5));
    const kind = b.grid[idx(4, 4)]!.kind;
    const count = b.grid.filter((p) => p!.kind === kind).length;
    b.trySwap(idx(3, 4), idx(4, 4));
    const ev = settle(b);
    const fire = ev.find((e) => e.type === "fire");
    expect(fire).toMatchObject({ combo: "conchKind", kind });
    expect(fire && fire.type === "fire" && fire.cells.length).toBe(count - 1);
  });

  it("squirter + squirter is a cross", () => {
    const b = Board.fromRows(dead({ "3,4": "A-", "4,4": "B|" }), rng(5));
    b.trySwap(idx(3, 4), idx(4, 4));
    const fire = settle(b).find((e) => e.type === "fire" && e.combo);
    expect(fire).toMatchObject({ combo: "cross" });
    expect(fire && fire.type === "fire" && fire.cells.length).toBe(COLS + ROWS - 1);
  });

  it("squirter + boomer clears three rows and three columns", () => {
    const b = Board.fromRows(dead({ "3,4": "A-", "4,4": "B*" }), rng(5));
    b.trySwap(idx(3, 4), idx(4, 4));
    const fire = settle(b).find((e) => e.type === "fire" && e.combo);
    expect(fire).toMatchObject({ combo: "triple" });
    expect(fire && fire.type === "fire" && fire.cells.length).toBe(3 * COLS + 3 * ROWS - 9);
  });

  it("boomer + boomer is a mega blast", () => {
    const b = Board.fromRows(dead({ "3,4": "A*", "3,5": "B*" }), rng(5));
    b.trySwap(idx(3, 4), idx(3, 5));
    const fire = settle(b).find((e) => e.type === "fire" && e.combo);
    expect(fire).toMatchObject({ combo: "megablast" });
  });

  it("conch + conch clears the whole pool", () => {
    const b = Board.fromRows(dead({ "3,4": "@", "4,4": "@" }), rng(5));
    b.trySwap(idx(3, 4), idx(4, 4));
    const ev = settle(b, 15);
    expect(ev.find((e) => e.type === "fire")).toMatchObject({ combo: "tidal" });
    expect(ev.filter((e) => e.type === "pop").length).toBeGreaterThanOrEqual(N);
  });

  it("conch + squirter turns every critter of that kind into a squirter and sets them off", () => {
    const b = Board.fromRows(dead({ "3,4": "@", "4,4": "B-" }), rng(5));
    b.trySwap(idx(3, 4), idx(4, 4));
    const ev = settle(b, 15);
    expect(ev.find((e) => e.type === "fire")).toMatchObject({ combo: "conchLine", kind: 1 });
    const lineFires = ev.filter((e) => e.type === "fire" && !e.combo && (e.special === "lineH" || e.special === "lineV"));
    expect(lineFires.length).toBeGreaterThan(5);
  });
});

describe("cascades", () => {
  it("counts each wave and scores it at a higher multiplier", () => {
    let best = 0;
    // Random boards cascade on their own once refills land; find one that does and check the chain grows.
    for (let seed = 1; seed < 80 && best < 2; seed++) {
      const b = new Board(rng(seed));
      const m = b.findMoves()[0]!;
      b.trySwap(m.from, m.to);
      const matches = settle(b).filter((e) => e.type === "match");
      for (const e of matches) if (e.type === "match") best = Math.max(best, e.chain);
      const second = matches.find((e) => e.type === "match" && e.chain === 2);
      if (second && second.type === "match") {
        expect(second.player).toBe(false);
        expect(second.points).toBe((second.cells.length * 10 + (second.created === "none" ? 0 : second.created === "bomb" ? 80 : second.created === "conch" ? 150 : 50)) * 2);
      }
    }
    expect(best).toBeGreaterThanOrEqual(2);
  });

  it("resets the chain once the pool is calm", () => {
    const b = new Board(rng(9));
    const m = b.findMoves()[0]!;
    b.trySwap(m.from, m.to);
    settle(b);
    expect(b.calm).toBe(true);
    expect(b.chain).toBe(0);
  });

  it("lets the player swap resting critters while a cascade is still falling", () => {
    const b = Board.fromRows(dead({ "1,0": "A", "2,1": "A", "3,0": "D", "6,8": "@", "5,8": "E" }), rng(5));
    b.trySwap(idx(2, 1), idx(2, 0));
    for (let t = 0; t < SWAP_T + CLEAR_T + 0.05; t += 1 / 60) b.step(1 / 60);
    // The top row is refilling; the bottom-right corner is untouched and resting.
    expect(b.calm).toBe(false);
    expect(b.trySwap(idx(6, 8), idx(5, 8))).toBe(true);
    expect(settle(b).some((e) => e.type === "fire" && e.combo === "conchKind")).toBe(true);
  });
});

describe("no moves left", () => {
  it("reshuffles into a board with a move and no match, keeping specials in place", () => {
    const b = Board.fromRows(dead({ "0,0": "A*" }), rng(11));
    const kinds = b.grid.map((p) => p!.kind).sort().join();
    const ev = settle(b);
    expect(ev.some((e) => e.type === "shuffle")).toBe(true);
    expect(b.grid[0]!.special).toBe("bomb");
    // The bomb counts as a critter of its kind but never moves.
    expect(b.calm).toBe(true);
    expect(hasRun(b)).toBe(false);
    expect(b.hasMove()).toBe(true);
    expect(ev.some((e) => e.type === "match")).toBe(false);
    expect(b.grid.map((p) => p!.kind).sort().join()).toBe(kinds);
  });
});
