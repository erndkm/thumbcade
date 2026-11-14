import { describe, expect, it } from "vitest";
import {
  allCards, canBuild, canHome, card, cardsHome, cardsLeft, cloneTable, drawOrTurn, hidden, isRed, layOut, newPack, rankOf, safeHome, settle, suitOf, sweepOne, tapColumn,
  tapStock, tapWaste, won, type Step, type Table,
} from "../src/cards.ts";

const S = 0;
const H = 1;
const D = 2;
const C = 3;
/** A table set by hand: columns as [face-down cards, face-up cards]. */
const table = (cols: Array<[number[], number[]]>, o: Partial<Table> = {}): Table => ({
  ranks: 13,
  cols: cols.map(([down, up]) => ({ down: [...down], up: [...up] })),
  home: [0, 0, 0, 0],
  stock: [],
  waste: [],
  ...o,
});
const kinds = (steps: Step[]) => steps.map((s) => s.kind);

describe("the pack", () => {
  it("has four suits, two red and two black, from the ace up", () => {
    expect(newPack(13)).toHaveLength(52);
    expect(new Set(newPack(13)).size).toBe(52);
    expect(newPack(5).map(rankOf).filter((r) => r > 4)).toHaveLength(0);
    expect([S, H, D, C].map((s) => isRed(card(s, 3)))).toEqual([false, true, true, false]);
    expect([suitOf(card(D, 12)), rankOf(card(D, 12))]).toEqual([D, 12]);
  });

  it("is laid out with one more card in each column, the last face up, and the rest as the pack", () => {
    const t = layOut(newPack(13), 13, 7);
    expect(t.cols.map((c) => c.down.length)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(t.cols.every((c) => c.up.length === 1)).toBe(true);
    expect(t.stock).toHaveLength(24);
    expect(hidden(t)).toBe(21);
    expect(new Set(allCards(t)).size).toBe(52);
    const short = layOut(newPack(5), 5, 4);
    expect(short.stock).toHaveLength(10);
    expect(cardsLeft(short)).toBe(20);
  });
});

describe("the rules", () => {
  it("a card is laid on one a rank higher of the other colour, and only the pack's top card starts an empty column", () => {
    const t = table([[[], [card(S, 7)]], [[], [card(H, 6)]], [[], []], [[card(C, 2)], []]]);
    expect(canBuild(t, card(H, 6), 0)).toBe(true);
    expect(canBuild(t, card(D, 6), 0)).toBe(true);
    expect(canBuild(t, card(C, 6), 0)).toBe(false);
    expect(canBuild(t, card(H, 5), 0)).toBe(false);
    expect(canBuild(t, card(S, 12), 2)).toBe(true);
    expect(canBuild(t, card(S, 11), 2)).toBe(false);
    // In a short pack its highest card stands in for the king.
    expect(canBuild({ ...t, ranks: 5 }, card(H, 4), 2)).toBe(true);
    expect(canBuild({ ...t, ranks: 5 }, card(H, 12), 2)).toBe(false);
  });

  it("each suit goes home in order from the ace", () => {
    const t = table([], { home: [0, 3, 0, 0] });
    expect(canHome(t, card(S, 0))).toBe(true);
    expect(canHome(t, card(S, 1))).toBe(false);
    expect(canHome(t, card(H, 3))).toBe(true);
    expect(canHome(t, card(H, 4))).toBe(false);
  });

  it("a card goes home of its own accord only when nothing in play could still want to lie on it", () => {
    const t = table([], { home: [2, 2, 1, 2] });
    // The three of spades: both red twos must be home first. Diamonds are not.
    expect(safeHome(t, card(S, 2))).toBe(false);
    expect(safeHome({ ...t, home: [2, 2, 2, 2] }, card(S, 2))).toBe(true);
    expect(safeHome(table([]), card(C, 0))).toBe(true);
    expect(safeHome(table([], { home: [0, 1, 0, 0] }), card(H, 1))).toBe(true);
    expect(safeHome(t, card(S, 3))).toBe(false);
  });
});

describe("a tap", () => {
  it("on a column's top card sends it home, and turns up the card under it", () => {
    const t = table([[[card(D, 9)], [card(S, 0)]]]);
    const steps = tapColumn(t, 0, 0);
    expect(kinds(steps)).toEqual(["home", "flip"]);
    expect(t.home[S]).toBe(1);
    expect(t.cols[0]).toEqual({ down: [], up: [card(D, 9)] });
  });

  it("on a run moves it from the tapped card, onto a column with cards before an empty one", () => {
    const t = table([[[card(C, 1)], [card(H, 6), card(S, 5), card(D, 4)]], [[], [card(C, 7)]], [[], [card(C, 6)]], [[], []]]);
    // The five of spades and what lies on it go to the six of... no red six is free: the tap falls back to the whole run.
    let steps = tapColumn(t, 0, 1);
    expect(steps[0]).toMatchObject({ kind: "build", cards: [card(H, 6), card(S, 5), card(D, 4)], from: 0, to: 1 });
    expect(kinds(steps)).toEqual(["build", "flip"]);
    // Now a tap on the four of diamonds, in the middle of nothing it can leave: it stays put with its run.
    steps = tapColumn(t, 1, 3);
    expect(steps).toEqual([]);
    // A tap in the middle of a run that can split: the five and four go to the red six? There is none; nothing moves.
    expect(tapColumn(t, 1, 2)).toEqual([]);
  });

  it("in the middle of a run moves just that part when it fits somewhere", () => {
    const t = table([[[], [card(S, 8), card(H, 7), card(C, 6), card(D, 5)]], [[], [card(D, 7)]]]);
    const steps = tapColumn(t, 0, 2);
    expect(steps).toEqual([{ kind: "build", cards: [card(C, 6), card(D, 5)], from: 0, to: 1 }]);
    expect(t.cols[0]!.up).toEqual([card(S, 8), card(H, 7)]);
  });

  it("is generous: a tap on a top card that cannot go home moves the whole run instead", () => {
    const t = table([[[card(S, 3)], [card(H, 6), card(S, 5)]], [[], [card(C, 7)]]]);
    const steps = tapColumn(t, 0, 1);
    expect(steps[0]).toMatchObject({ kind: "build", cards: [card(H, 6), card(S, 5)], to: 1 });
    expect(t.cols[0]!.up).toEqual([card(S, 3)]);
  });

  it("never shuffles a column that already starts with the top card into another empty column", () => {
    const t = table([[[], [card(S, 12), card(H, 11)]], [[], []]]);
    expect(tapColumn(t, 0, 0)).toEqual([]);
    // With a card under it, the king does move: that turns the card up.
    const u = table([[[card(D, 2)], [card(S, 12)]], [[], []]]);
    expect(kinds(tapColumn(u, 0, 0))).toEqual(["build", "flip"]);
  });

  it("on the drawn cards plays the top one home or onto a column; on the pack draws, and turns the pack when it runs out", () => {
    const t = table([[[], [card(S, 5)]]], { stock: [card(H, 4), card(C, 0)], home: [0, 0, 0, 0] });
    expect(tapWaste(t)).toEqual([]);
    expect(tapStock(t)).toEqual([{ kind: "draw", card: card(C, 0) }]);
    expect(tapWaste(t)).toEqual([{ kind: "home", card: card(C, 0), from: "waste" }]);
    expect(tapStock(t)).toEqual([{ kind: "draw", card: card(H, 4) }]);
    expect(tapWaste(t)).toEqual([{ kind: "build", cards: [card(H, 4)], from: "waste", to: 0 }]);
    expect(tapStock(t)).toEqual([]);
    const u = table([], { stock: [card(S, 5), card(S, 6)] });
    tapStock(u);
    tapStock(u);
    expect(u.waste).toEqual([card(S, 6), card(S, 5)]);
    expect(tapStock(u)).toEqual([{ kind: "turn", count: 2 }]);
    // Turned over, the pack comes round in the same order.
    expect(u.stock).toEqual([card(S, 5), card(S, 6)]);
    const out: Step[] = [];
    expect(drawOrTurn(u, out)).toBe(true);
    expect(out).toEqual([{ kind: "draw", card: card(S, 6) }]);
  });

  it("then whatever can go home without a second thought goes by itself", () => {
    const t = table([[[], [card(S, 1)]], [[], [card(S, 0)]], [[card(H, 5)], [card(H, 0)]]]);
    const steps: Step[] = [];
    settle(t, steps);
    expect(steps.filter((s) => s.kind === "home").map((s) => (s.kind === "home" ? s.card : -1))).toEqual([card(S, 0), card(H, 0), card(S, 1)]);
    expect(t.home).toEqual([2, 1, 0, 0]);
    expect(t.cols[2]!.up).toEqual([card(H, 5)]);
  });
});

describe("the end of a deal", () => {
  it("with nothing face down the rest sweeps home, lowest card first, wherever it lies", () => {
    const t = table([[[], [card(S, 2), card(H, 1)]], [[], [card(D, 1)]]], { ranks: 3, home: [1, 0, 0, 3], stock: [card(D, 0), card(D, 2)], waste: [card(S, 1), card(H, 0), card(H, 2)] });
    expect(hidden(t)).toBe(0);
    const before = cloneTable(t);
    let n = 0;
    const steps: Step[] = [];
    while (sweepOne(t, steps)) n++;
    expect(won(t)).toBe(true);
    expect(n).toBe(cardsLeft(before));
    expect(cardsHome(t)).toBe(12);
    expect(sweepOne(t, steps)).toBe(false);
  });
});
