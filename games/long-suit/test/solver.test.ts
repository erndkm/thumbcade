import { describe, expect, it } from "vitest";
import { card, cloneTable, won, type Table } from "../src/cards.ts";
import { Dealer } from "../src/deal.ts";
import { spent, targetOf } from "../src/run.ts";
import { playLine, solve, Solver } from "../src/solver.ts";

const S = 0;
const H = 1;
const D = 2;
const C = 3;
const table = (ranks: number, cols: Array<[number[], number[]]>, o: Partial<Table> = {}): Table => ({
  ranks,
  cols: cols.map(([down, up]) => ({ down: [...down], up: [...up] })),
  home: [0, 0, 0, 0],
  stock: [],
  waste: [],
  ...o,
});

describe("the solver", () => {
  it("wins a table that only needs its cards sent home, and says how", () => {
    const t = table(2, [[[], [card(S, 1)]], [[card(H, 1)], [card(S, 0)]]], { stock: [card(H, 0), card(D, 0), card(D, 1), card(C, 1), card(C, 0)] });
    const s = solve(t);
    expect(s.status).toBe("won");
    expect(playLine(t, s.line)).not.toBeNull();
    expect(won(t)).toBe(true);
  });

  it("proves a dead end: two cards each lying on the one the other needs", () => {
    // The two of spades covers the ace of hearts and the two of hearts covers the ace of spades; nothing can move.
    const t = table(2, [[[card(H, 0)], [card(S, 1)]], [[card(S, 0)], [card(H, 1)]]], { home: [0, 0, 2, 2] });
    expect(solve(t, { thorough: true }).status).toBe("dead");
    expect(solve(t).status).toBe("dead");
    expect(spent(t)).toBe(true);
    // Free a column for one of the twos and it is won again.
    const u = table(2, [[[card(H, 0)], [card(S, 1)]], [[card(S, 0)], [card(H, 1)]], [[], []]], { home: [0, 0, 2, 2] });
    expect(spent(u)).toBe(false);
    expect(solve(u, { thorough: true }).status).toBe("won");
  });

  it("treats the pack and the drawn cards as one hand: any of them can be reached", () => {
    const t = table(3, [[[], [card(S, 2)]]], { home: [0, 3, 3, 3], stock: [card(S, 0)], waste: [card(S, 1)] });
    const s = solve(t);
    expect(s.status).toBe("won");
    const steps = playLine(t, s.line)!;
    // The ace is under the two: the pack has to be drawn to get at it.
    expect(steps.some((st) => st.kind === "draw")).toBe(true);
    expect(won(t)).toBe(true);
  });

  it("gives up at its node limit rather than run on, and says so", () => {
    const { table: t } = new Dealer(99).get(4);
    const s = solve(t, { thorough: true, maxNodes: 40 });
    expect(["unknown", "won"]).toContain(s.status);
    expect(s.nodes).toBeLessThanOrEqual(41);
  });

  it("can be run a little at a time and comes to the same answer", () => {
    const { table: t } = new Dealer(321).get(3);
    const whole = solve(cloneTable(t), { maxNodes: 4000 });
    const sliced = new Solver(cloneTable(t), { maxNodes: 4000 });
    let frames = 0;
    while (!sliced.pump(0.02) && frames < 1_000_000) frames++;
    expect(sliced.status).toBe(whole.status);
    expect(sliced.line).toEqual(whole.line);
    expect(sliced.nodes).toBe(whole.nodes);
  });

  it("its first move turns into the tap that makes it", () => {
    const t = table(13, [[[card(D, 9)], [card(S, 0)]], [[], [card(H, 5)]]], { stock: [card(C, 3)], waste: [card(S, 4)] });
    expect(targetOf(t, { k: "home", col: 0 })).toEqual({ kind: "col", col: 0, index: 0 });
    expect(targetOf(t, { k: "run", from: 1, index: 0, to: 0 })).toEqual({ kind: "col", col: 1, index: 0 });
    expect(targetOf(t, { k: "hand", card: card(S, 4), to: 1 })).toEqual({ kind: "waste" });
    // A card still in the pack is reached by tapping the pack.
    expect(targetOf(t, { k: "handHome", card: card(C, 3) })).toEqual({ kind: "stock" });
    expect(targetOf(t, undefined)).toBeNull();
  });
});
