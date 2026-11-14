/**
 * The pack and the rules of the table.
 *
 * Patience as everyone knows it: columns of cards, the lower ones face down; a face-up card may be laid on a card
 * one higher of the other colour; a run of such cards moves as one; only the pack's top card may start an empty
 * column; each suit goes home in order from the ace. The pack is drawn one card at a time and turned as often as
 * needed. Early deals use a short pack (ace to five, to seven, ...), whose highest card stands in for the king.
 */

/** A card: suit × 13 + rank, with rank 0 the ace. Suits: 0 spades, 1 hearts, 2 diamonds, 3 clubs. */
export type Card = number;
export const SUITS = 4;
export const suitOf = (c: Card): number => Math.floor(c / 13);
export const rankOf = (c: Card): number => c % 13;
export const isRed = (c: Card): boolean => suitOf(c) === 1 || suitOf(c) === 2;
export const card = (suit: number, rank: number): Card => suit * 13 + rank;
export const RANK_NAMES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const RANK_WORDS = ["ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king"] as const;

export interface Column {
  /** Face-down cards, bottom first. */
  down: Card[];
  /** The face-up run on top of them, bottom first. */
  up: Card[];
}

export interface Table {
  /** Cards per suit in this pack; rank `ranks - 1` is its top card. */
  ranks: number;
  cols: Column[];
  /** Per suit, how many cards are home (so also the rank wanted next). */
  home: number[];
  /** The pack, face down; the next card drawn is the last one. */
  stock: Card[];
  /** Drawn cards, face up; the playable one is the last. */
  waste: Card[];
}

export const cloneTable = (t: Table): Table => ({
  ranks: t.ranks,
  cols: t.cols.map((c) => ({ down: [...c.down], up: [...c.up] })),
  home: [...t.home],
  stock: [...t.stock],
  waste: [...t.waste],
});

/** Lays a shuffled pack out: column i gets i cards face down and one face up; the rest is the pack. */
export function layOut(pack: readonly Card[], ranks: number, cols: number): Table {
  const t: Table = { ranks, cols: [], home: [0, 0, 0, 0], stock: [], waste: [] };
  let k = 0;
  for (let i = 0; i < cols; i++) {
    const down: Card[] = [];
    for (let j = 0; j < i; j++) down.push(pack[k++]!);
    t.cols.push({ down, up: [pack[k++]!] });
  }
  t.stock = pack.slice(k).reverse();
  return t;
}

/** A fresh pack in order: four suits of `ranks` cards. */
export function newPack(ranks: number): Card[] {
  const out: Card[] = [];
  for (let s = 0; s < SUITS; s++) for (let r = 0; r < ranks; r++) out.push(card(s, r));
  return out;
}

export const canHome = (t: Table, c: Card): boolean => rankOf(c) === t.home[suitOf(c)];

/** Home without a second thought: nothing still in play could want to be laid on this card. */
export function safeHome(t: Table, c: Card): boolean {
  if (!canHome(t, c)) return false;
  const r = rankOf(c);
  if (r <= 1) return true;
  const red = isRed(c);
  for (let s = 0; s < SUITS; s++) if ((s === 1 || s === 2) !== red && t.home[s]! < r) return false;
  return true;
}

/** May `c` be laid on column `to`? */
export function canBuild(t: Table, c: Card, to: number): boolean {
  const col = t.cols[to]!;
  if (col.up.length === 0) return col.down.length === 0 && rankOf(c) === t.ranks - 1;
  const top = col.up[col.up.length - 1]!;
  return isRed(top) !== isRed(c) && rankOf(top) === rankOf(c) + 1;
}

export const won = (t: Table): boolean => t.home.every((h) => h === t.ranks);
export const hidden = (t: Table): number => t.cols.reduce((n, c) => n + c.down.length, 0);
export const cardsHome = (t: Table): number => t.home.reduce((n, h) => n + h, 0);
export const cardsLeft = (t: Table): number => t.ranks * SUITS - cardsHome(t);

/** What a move did, for the screen and the score. */
export type Step =
  | { kind: "home"; card: Card; from: number | "waste" | "stock" }
  | { kind: "build"; cards: Card[]; from: number | "waste"; to: number }
  | { kind: "flip"; card: Card; col: number }
  | { kind: "draw"; card: Card }
  | { kind: "turn"; count: number };

/** Turns up the top face-down card of a column whose face-up run has gone. */
function flip(t: Table, col: number, out: Step[]): void {
  const c = t.cols[col]!;
  if (c.up.length === 0 && c.down.length > 0) {
    const cardUp = c.down.pop()!;
    c.up.push(cardUp);
    out.push({ kind: "flip", card: cardUp, col });
  }
}

/** Sends the top card of a column home. */
export function homeFromColumn(t: Table, col: number, out: Step[]): boolean {
  const c = t.cols[col]!;
  const top = c.up[c.up.length - 1];
  if (top === undefined || !canHome(t, top)) return false;
  c.up.pop();
  t.home[suitOf(top)]!++;
  out.push({ kind: "home", card: top, from: col });
  flip(t, col, out);
  return true;
}

export function homeFromWaste(t: Table, out: Step[]): boolean {
  const top = t.waste[t.waste.length - 1];
  if (top === undefined || !canHome(t, top)) return false;
  t.waste.pop();
  t.home[suitOf(top)]!++;
  out.push({ kind: "home", card: top, from: "waste" });
  return true;
}

/** Moves the run starting at `index` of column `from` onto column `to`. */
export function moveRun(t: Table, from: number, index: number, to: number, out: Step[]): boolean {
  const c = t.cols[from]!;
  const first = c.up[index];
  if (first === undefined || from === to || !canBuild(t, first, to)) return false;
  const cards = c.up.splice(index);
  t.cols[to]!.up.push(...cards);
  out.push({ kind: "build", cards, from, to });
  flip(t, from, out);
  return true;
}

export function buildFromWaste(t: Table, to: number, out: Step[]): boolean {
  const top = t.waste[t.waste.length - 1];
  if (top === undefined || !canBuild(t, top, to)) return false;
  t.waste.pop();
  t.cols[to]!.up.push(top);
  out.push({ kind: "build", cards: [top], from: "waste", to });
  return true;
}

/** Draws a card, or turns the drawn cards back over into a pack when the pack has run out. */
export function drawOrTurn(t: Table, out: Step[]): boolean {
  if (t.stock.length > 0) {
    const c = t.stock.pop()!;
    t.waste.push(c);
    out.push({ kind: "draw", card: c });
    return true;
  }
  if (t.waste.length === 0) return false;
  t.stock = t.waste.reverse();
  t.waste = [];
  out.push({ kind: "turn", count: t.stock.length });
  return true;
}

/** Every card that can go home at once without a second thought goes, one after another. */
export function settle(t: Table, out: Step[]): void {
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < t.cols.length; i++) {
      const up = t.cols[i]!.up;
      const top = up[up.length - 1];
      if (top !== undefined && safeHome(t, top)) again = homeFromColumn(t, i, out) || again;
    }
    const w = t.waste[t.waste.length - 1];
    if (w !== undefined && safeHome(t, w)) again = homeFromWaste(t, out) || again;
  }
}

/**
 * With nothing left face down the deal is as good as won: the lowest card still out is always within reach.
 * Sends the next one home (from a column, the drawn cards or the pack). False when all are home.
 */
export function sweepOne(t: Table, out: Step[]): boolean {
  for (let i = 0; i < t.cols.length; i++) if (homeFromColumn(t, i, out)) return true;
  if (homeFromWaste(t, out)) return true;
  for (const pile of [t.waste, t.stock]) {
    const k = pile.findIndex((c) => canHome(t, c));
    if (k >= 0) {
      const c = pile.splice(k, 1)[0]!;
      t.home[suitOf(c)]!++;
      out.push({ kind: "home", card: c, from: pile === t.waste ? "waste" : "stock" });
      return true;
    }
  }
  return false;
}

/** A column a run with base `first` could go to: one with cards before an empty one, leftmost first. -1 if none. */
function findTarget(t: Table, first: Card, from: number, allowEmpty: boolean): number {
  for (let to = 0; to < t.cols.length; to++) if (to !== from && t.cols[to]!.up.length > 0 && canBuild(t, first, to)) return to;
  if (allowEmpty) for (let to = 0; to < t.cols.length; to++) if (to !== from && t.cols[to]!.up.length === 0 && canBuild(t, first, to)) return to;
  return -1;
}

/**
 * A tap on a column, on its face-up card number `index` (0 is the lowest face-up card). The card goes where it
 * fits: the top card home; else the run from the tapped card onto another column; and failing that the game is
 * generous and tries the column's whole run, its top card home, then shorter runs. Returns what happened (empty if
 * nothing fits).
 */
export function tapColumn(t: Table, col: number, index: number): Step[] {
  const out: Step[] = [];
  const c = t.cols[col]!;
  const n = c.up.length;
  if (n === 0) return out;
  const i = Math.max(0, Math.min(n - 1, index));
  // Moving a whole run that already starts its column to another empty column changes nothing.
  const run = (k: number): boolean => {
    const to = findTarget(t, c.up[k]!, col, !(k === 0 && c.down.length === 0));
    return to >= 0 && moveRun(t, col, k, to, out);
  };
  if (i === n - 1 && homeFromColumn(t, col, out)) return out;
  if (i > 0 && i < n - 1 && run(i)) return out;
  if (run(0)) return out;
  if (homeFromColumn(t, col, out)) return out;
  for (let k = 1; k < n; k++) if (run(k)) return out;
  return out;
}

/** A tap on the drawn cards: the top one goes home, or onto a column. */
export function tapWaste(t: Table): Step[] {
  const out: Step[] = [];
  const top = t.waste[t.waste.length - 1];
  if (top === undefined) return out;
  if (homeFromWaste(t, out)) return out;
  const to = findTarget(t, top, -1, true);
  if (to >= 0) buildFromWaste(t, to, out);
  return out;
}

/** A tap on the pack. */
export function tapStock(t: Table): Step[] {
  const out: Step[] = [];
  drawOrTurn(t, out);
  return out;
}

/** Every card on the table and in the pack, for checks. */
export function allCards(t: Table): Card[] {
  const out: Card[] = [];
  for (const c of t.cols) out.push(...c.down, ...c.up);
  out.push(...t.stock, ...t.waste);
  for (let s = 0; s < SUITS; s++) for (let r = 0; r < t.home[s]!; r++) out.push(card(s, r));
  return out;
}
