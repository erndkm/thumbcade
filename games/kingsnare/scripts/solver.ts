/**
 * A small forced-mate solver on top of chess.js internals (legal move generation without SAN, make/undo).
 * Used offline to generate and verify Kingsnare's puzzle set; never shipped to players.
 */
import { Chess } from "chess.js";

export interface IMove {
  from: number;
  to: number;
  promotion?: string;
  piece: string;
  captured?: string;
  flags: number;
}

interface Internal {
  _moves(opts?: { legal?: boolean }): IMove[];
  _makeMove(m: IMove): void;
  _undoMove(): void;
  isCheck(): boolean;
  isCheckmate(): boolean;
  turn(): "w" | "b";
  fen(): string;
}

export const sq = (x: number): string => "abcdefgh"[x & 15]! + String(8 - (x >> 4));
export const uci = (m: IMove): string => sq(m.from) + sq(m.to) + (m.promotion ?? "");

export class Solver {
  readonly ch: Internal;
  nodes = 0;
  budget = Infinity;
  constructor(fen: string) {
    this.ch = new Chess(fen) as unknown as Internal;
  }
  moves(): IMove[] {
    return this.ch._moves({ legal: true });
  }
  make(m: IMove): void {
    this.nodes++;
    if (this.nodes > this.budget) throw new Error("budget");
    this.ch._makeMove(m);
  }
  undo(): void {
    this.ch._undoMove();
  }
  /** Attacker to move: is there a forced mate in <= n moves? */
  mateIn(n: number): boolean {
    const moves = this.ordered();
    for (const m of moves) {
      this.make(m);
      const ok = this.forcedAfter(n);
      this.undo();
      if (ok) return true;
    }
    return false;
  }
  /** After an attacker move: does every defense lose to mate within the remaining n-1 moves? */
  forcedAfter(n: number): boolean {
    if (this.ch.isCheckmate()) return true;
    if (n <= 1) return false;
    const replies = this.moves();
    if (replies.length === 0) return false; // stalemate
    for (const r of replies) {
      this.make(r);
      const ok = this.mateIn(n - 1);
      this.undo();
      if (!ok) return false;
    }
    return true;
  }
  /** Attacker moves that force mate within n. */
  keys(n: number): IMove[] {
    const out: IMove[] = [];
    for (const m of this.moves()) {
      this.make(m);
      if (this.forcedAfter(n)) out.push(m);
      this.undo();
    }
    return out;
  }
  /** Checks first, then captures, then the rest: early exits come sooner. */
  private ordered(): IMove[] {
    const ms = this.moves();
    const checks: IMove[] = [];
    const caps: IMove[] = [];
    const rest: IMove[] = [];
    for (const m of ms) {
      this.ch._makeMove(m);
      const c = this.ch.isCheck();
      this.ch._undoMove();
      (c ? checks : m.captured ? caps : rest).push(m);
    }
    return [...checks, ...caps, ...rest];
  }
}

/**
 * Builds the main line for a puzzle whose unique key mates in n: attacker moves are unique at every
 * step except the final mate (any mate is accepted there); the defender picks the most stubborn reply.
 * Returns null if uniqueness fails.
 */
export function mainLine(fen: string, n: number): string[] | null {
  const s = new Solver(fen);
  const line: string[] = [];
  for (let left = n; left >= 1; left--) {
    const keys = s.keys(left);
    if (left > 1 && keys.length !== 1) return null;
    if (left === 1 && keys.length === 0) return null;
    // Also reject if a shorter mate exists at this point (the puzzle's count must be exact).
    if (left > 1 && s.mateIn(left - 1)) return null;
    const key = keys[0]!;
    line.push(uci(key));
    s.make(key);
    if (left === 1) {
      if (!s.ch.isCheckmate()) return null;
      break;
    }
    // Defender: prefer replies that don't allow a faster mate, then the one with the fewest mating answers.
    let best: IMove | null = null;
    let bestScore = -Infinity;
    for (const r of s.moves()) {
      s.make(r);
      const faster = left - 1 > 1 && s.mateIn(left - 2);
      const answers = s.keys(left - 1).length;
      s.undo();
      const score = (faster ? -100 : 0) - answers + (r.captured ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) return null;
    line.push(uci(best));
    s.make(best);
  }
  return line;
}
