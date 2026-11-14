/**
 * A solver that sees every card, face down or not. It answers two questions: can this table still be won (and
 * how), and has it become a dead end?
 *
 * With the pack drawn one card at a time and turned as often as wanted, every card in the pack or among the drawn
 * cards can be brought to the top, so the solver treats them as one hand. It searches depth first with a memory
 * of every table it has seen, sends home at once whatever can go home without a second thought, and can be run a
 * few milliseconds at a time.
 *
 * Two modes. `thorough` tries every legal move, so "dead" is a proof that nothing wins. The quick mode tries only
 * the moves a good player would (turn up a card, free a column, lay a card from the hand), which is enough to find
 * a winning line for a new deal fast; what it finds is always a real line.
 */
import { buildFromWaste, drawOrTurn, homeFromColumn, homeFromWaste, isRed, moveRun, rankOf, suitOf, SUITS, type Card, type Step, type Table } from "./cards.ts";

/** One move of a line: a column's top card home, a card from the hand home, a run to a column, a hand card to a column. */
export type Move =
  | { k: "home"; col: number }
  | { k: "handHome"; card: Card }
  | { k: "run"; from: number; index: number; to: number }
  | { k: "hand"; card: Card; to: number };

interface State {
  home: number[];
  /** Face-down cards left in each column. */
  down: number[];
  up: Card[][];
  /** Bit i set: hand card i is still in the hand. */
  hand: number;
}

interface Frame {
  s: State;
  moves: Move[];
  i: number;
  /** The moves that led here from the frame below (the chosen one, then anything sent home at once). */
  via: Move[];
}

export type Status = "running" | "won" | "dead" | "unknown";

export class Solver {
  status: Status = "running";
  /** The winning line, once won. */
  line: Move[] = [];
  nodes = 0;

  private readonly ranks: number;
  private readonly cols: number;
  /** Each column's face-down cards as dealt, bottom first. */
  private readonly under: Card[][];
  private readonly handCards: Card[];
  private readonly seen = new Set<string>();
  private readonly stack: Frame[] = [];
  private readonly thorough: boolean;
  private readonly maxNodes: number;

  constructor(t: Table, opts: { thorough?: boolean; maxNodes?: number } = {}) {
    this.thorough = opts.thorough ?? false;
    this.maxNodes = opts.maxNodes ?? 6000;
    this.ranks = t.ranks;
    this.cols = t.cols.length;
    this.under = t.cols.map((c) => [...c.down]);
    this.handCards = [...t.stock, ...t.waste];
    const s: State = { home: [...t.home], down: t.cols.map((c) => c.down.length), up: t.cols.map((c) => [...c.up]), hand: this.handCards.length >= 31 ? -1 : (1 << this.handCards.length) - 1 };
    const forced = this.sendHome(s);
    if (this.isWon(s)) {
      this.line = forced;
      this.status = "won";
      return;
    }
    this.seen.add(this.key(s));
    this.stack.push({ s, moves: this.moves(s), i: 0, via: forced });
  }

  /** Searches for at most `ms` milliseconds. True once there is an answer. */
  pump(ms: number): boolean {
    const until = performance.now() + ms;
    for (let n = 0; this.status === "running"; n++) {
      if ((n & 31) === 31 && performance.now() >= until) return false;
      this.advance();
    }
    return true;
  }

  /** Searches to the end (or the node limit). */
  run(): Status {
    while (this.status === "running") this.advance();
    return this.status;
  }

  private advance(): void {
    const f = this.stack[this.stack.length - 1];
    if (!f) {
      this.status = "dead";
      return;
    }
    if (f.i >= f.moves.length) {
      this.stack.pop();
      return;
    }
    if (this.nodes >= this.maxNodes) {
      this.status = "unknown";
      return;
    }
    const m = f.moves[f.i++]!;
    const s: State = { home: [...f.s.home], down: [...f.s.down], up: f.s.up.map((u) => [...u]), hand: f.s.hand };
    this.apply(s, m);
    const via = [m, ...this.sendHome(s)];
    this.nodes++;
    if (this.isWon(s)) {
      this.line = [...this.stack.flatMap((x) => x.via), ...via];
      this.status = "won";
      return;
    }
    const key = this.key(s);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.stack.push({ s, moves: this.moves(s), i: 0, via });
  }

  private isWon(s: State): boolean {
    for (let i = 0; i < SUITS; i++) if (s.home[i] !== this.ranks) return false;
    return true;
  }

  /** A table's fingerprint. Which column a pile stands in makes no difference, so the piles are listed in order. */
  private key(s: State): string {
    const piles: string[] = [];
    for (let i = 0; i < this.cols; i++) piles.push(`${s.down[i] ? this.under[i]![s.down[i]! - 1] : "-"}.${s.down[i]}.${s.up[i]!.join(",")}`);
    return `${s.home.join("")}|${piles.sort().join("|")}|${s.hand}`;
  }

  private canHome(s: State, c: Card): boolean {
    return rankOf(c) === s.home[suitOf(c)];
  }

  private safe(s: State, c: Card): boolean {
    if (!this.canHome(s, c)) return false;
    const r = rankOf(c);
    if (r <= 1) return true;
    const red = isRed(c);
    for (let i = 0; i < SUITS; i++) if ((i === 1 || i === 2) !== red && s.home[i]! < r) return false;
    return true;
  }

  private fits(s: State, c: Card, to: number): boolean {
    const up = s.up[to]!;
    if (up.length === 0) return s.down[to] === 0 && rankOf(c) === this.ranks - 1;
    const top = up[up.length - 1]!;
    return isRed(top) !== isRed(c) && rankOf(top) === rankOf(c) + 1;
  }

  private turnUp(s: State, col: number): void {
    if (s.up[col]!.length === 0 && s.down[col]! > 0) s.up[col]!.push(this.under[col]![--s.down[col]!]!);
  }

  private apply(s: State, m: Move): void {
    if (m.k === "home") {
      const c = s.up[m.col]!.pop()!;
      s.home[suitOf(c)]!++;
      this.turnUp(s, m.col);
    } else if (m.k === "handHome") {
      s.hand &= ~(1 << this.handCards.indexOf(m.card));
      s.home[suitOf(m.card)]!++;
    } else if (m.k === "run") {
      const cards = s.up[m.from]!.splice(m.index);
      s.up[m.to]!.push(...cards);
      this.turnUp(s, m.from);
    } else {
      s.hand &= ~(1 << this.handCards.indexOf(m.card));
      s.up[m.to]!.push(m.card);
    }
  }

  /** Sends home whatever can go without a second thought. Returns the moves made. */
  private sendHome(s: State): Move[] {
    const out: Move[] = [];
    for (let again = true; again; ) {
      again = false;
      for (let i = 0; i < this.cols; i++) {
        const up = s.up[i]!;
        const top = up[up.length - 1];
        if (top !== undefined && this.safe(s, top)) {
          const m: Move = { k: "home", col: i };
          this.apply(s, m);
          out.push(m);
          again = true;
        }
      }
      for (let b = 0; b < this.handCards.length; b++) {
        if (!(s.hand & (1 << b))) continue;
        const c = this.handCards[b]!;
        if (this.safe(s, c)) {
          const m: Move = { k: "handHome", card: c };
          this.apply(s, m);
          out.push(m);
          again = true;
        }
      }
    }
    return out;
  }

  /** The moves to try from a table, most promising first. */
  private moves(s: State): Move[] {
    const first: Move[] = [];
    const turning: Array<[number, Move]> = [];
    const hand: Move[] = [];
    const rest: Move[] = [];
    const top = this.ranks - 1;
    // Is there a top card that an empty column would help? (One in the hand, or one with cards under it.)
    let wantsEmpty = false;
    for (let b = 0; b < this.handCards.length && !wantsEmpty; b++) if (s.hand & (1 << b) && rankOf(this.handCards[b]!) === top) wantsEmpty = true;
    for (let i = 0; i < this.cols && !wantsEmpty; i++) {
      const up = s.up[i]!;
      if (s.down[i]! > 0 && up.some((c) => rankOf(c) === top)) wantsEmpty = true;
    }

    for (let from = 0; from < this.cols; from++) {
      const up = s.up[from]!;
      const n = up.length;
      if (n === 0) continue;
      if (this.canHome(s, up[n - 1]!)) first.push({ k: "home", col: from });
      for (let index = 0; index < n; index++) {
        const base = up[index]!;
        // The quick search moves a part of a run only to send the card under it home.
        if (!this.thorough && index > 0 && !this.canHome(s, up[index - 1]!)) continue;
        let emptyTried = false;
        for (let to = 0; to < this.cols; to++) {
          if (to === from || !this.fits(s, base, to)) continue;
          const toEmpty = s.up[to]!.length === 0;
          if (toEmpty) {
            // A run that already starts its column gains nothing in another empty one; and one empty column is like the next.
            if ((index === 0 && s.down[from] === 0) || emptyTried) continue;
            emptyTried = true;
          }
          const m: Move = { k: "run", from, index, to };
          if (index === 0 && s.down[from]! > 0) turning.push([s.down[from]!, m]);
          else if (index === 0 && !toEmpty) {
            // Emptying a column: worth it only if something is waiting for the space (the thorough search tries it anyway).
            if (this.thorough || wantsEmpty) rest.push(m);
          } else rest.push(m);
        }
      }
    }
    for (let b = 0; b < this.handCards.length; b++) {
      if (!(s.hand & (1 << b))) continue;
      const c = this.handCards[b]!;
      if (this.canHome(s, c)) first.push({ k: "handHome", card: c });
      let emptyTried = false;
      for (let to = 0; to < this.cols; to++) {
        if (!this.fits(s, c, to)) continue;
        if (s.up[to]!.length === 0) {
          if (emptyTried) continue;
          emptyTried = true;
        }
        hand.push({ k: "hand", card: c, to });
      }
    }
    turning.sort((a, b) => b[0] - a[0]);
    return [...first, ...turning.map((x) => x[1]), ...hand, ...rest];
  }
}

/**
 * Plays a line on a real table with the real rules: a card from the hand is reached by drawing (and turning the
 * pack) until it is on top. Returns the steps made, or null as soon as a move is not legal.
 */
export function playLine(t: Table, line: readonly Move[]): Step[] | null {
  const out: Step[] = [];
  const reach = (c: Card): boolean => {
    for (let guard = 0; guard < 2 * (t.stock.length + t.waste.length) + 3; guard++) {
      if (t.waste[t.waste.length - 1] === c) return true;
      if (!drawOrTurn(t, out)) return false;
    }
    return false;
  };
  for (const m of line) {
    let ok: boolean;
    if (m.k === "home") ok = homeFromColumn(t, m.col, out);
    else if (m.k === "handHome") ok = reach(m.card) && homeFromWaste(t, out);
    else if (m.k === "run") ok = moveRun(t, m.from, m.index, m.to, out);
    else ok = reach(m.card) && buildFromWaste(t, m.to, out);
    if (!ok) return null;
  }
  return out;
}

/** Solves a table outright. */
export function solve(t: Table, opts: { thorough?: boolean; maxNodes?: number } = {}): Solver {
  const s = new Solver(t, opts);
  s.run();
  return s;
}
