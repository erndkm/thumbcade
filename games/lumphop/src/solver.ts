/**
 * An exact solver for the real rules: depth-first search over positions with a memo of every position seen (pots are
 * interchangeable, so a position's key is its pots sorted), sealing and consolidating moves first. It answers three
 * questions: can this deal be cleared (the dealer keeps only deals it can clear), is the position in play still alive
 * (a dead one triggers the grace), and what is a good next move (the idle hint and the pilot).
 */
import { FULL, isClear, isIdleMove, isSealed, moveCount, runLength, top, type Board, type Move } from "./rules.ts";

export type Status = "solved" | "dead" | "unknown";

export interface Solution {
  status: Status;
  /** A clearing line from this position (empty unless solved). */
  moves: Move[];
  /** Positions looked at. */
  visits: number;
}

/** A pot's key: its size, then its lumps bottom first (a covered lump in upper case). */
function potKey(units: readonly number[], covered: readonly boolean[], cap: number): string {
  let s = String(cap);
  for (let i = 0; i < units.length; i++) s += String.fromCharCode((covered[i] ? 65 : 97) + units[i]!);
  return s;
}

export function boardKey(board: Board): string {
  const keys: string[] = [];
  for (const p of board) if (!isSealed(p)) keys.push(potKey(p.units, p.covered, p.cap));
  keys.sort();
  return keys.join("|");
}

/** How promising a move looks, for ordering: seal > whole run onto its kind > uncover > empty a pot > into an empty pot. */
export function moveScore(board: Board, from: number, to: number, n: number): number {
  const a = board[from]!;
  const b = board[to]!;
  const run = runLength(a);
  let s = 0;
  if (b.cap === FULL && b.units.length + n === FULL && b.units.length && runLength(b) === b.units.length) s += 1000;
  if (b.units.length) s += n === run ? 100 + runLength(b) * 4 : -40;
  else s += n === run ? -10 : -60;
  const below = a.units.length - n - 1;
  if (below >= 0 && a.covered[below]) s += 40;
  if (below < 0) s += 30;
  else if (a.units[below] === top(a)) s -= 5;
  // Lifting a run off a mixed pot uncovers the next kind; off a pot of one kind it only moves it.
  if (run < a.units.length) s += 8;
  return s;
}

/** Candidate moves in the solver's order: one empty target per pot size, no idle moves. */
export function candidates(board: Board): Array<{ from: number; to: number; n: number; score: number }> {
  const out: Array<{ from: number; to: number; n: number; score: number }> = [];
  const emptySeen = new Set<number>();
  const emptyFirst = new Map<number, number>();
  for (let j = 0; j < board.length; j++) {
    const b = board[j]!;
    if (!b.units.length && !emptySeen.has(b.cap)) {
      emptySeen.add(b.cap);
      emptyFirst.set(b.cap, j);
    }
  }
  for (let i = 0; i < board.length; i++) {
    const a = board[i]!;
    if (!a.units.length || isSealed(a)) continue;
    for (let j = 0; j < board.length; j++) {
      if (i === j) continue;
      const b = board[j]!;
      if (!b.units.length && emptyFirst.get(b.cap) !== j) continue;
      const n = moveCount(board, i, j);
      if (!n || isIdleMove(board, i, j)) continue;
      out.push({ from: i, to: j, n, score: moveScore(board, i, j, n) });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

/**
 * Searches for a clearing line from `board` (not changed). `limit` caps the positions looked at: past it the answer
 * is "unknown". "dead" means every reachable position was seen and none clears.
 */
export function solve(board: Board, limit = 40_000): Solution {
  const b = board.map((p) => ({ units: p.units.slice(), covered: p.covered.slice(), cap: p.cap }));
  const seen = new Set<string>();
  const path: Move[] = [];
  let visits = 0;
  let capped = false;
  const go = (): boolean => {
    if (isClear(b)) return true;
    const key = boardKey(b);
    if (seen.has(key)) return false;
    seen.add(key);
    if (++visits > limit) {
      capped = true;
      return false;
    }
    for (const m of candidates(b)) {
      const a = b[m.from]!;
      const d = b[m.to]!;
      const kind = top(a);
      for (let i = 0; i < m.n; i++) {
        a.units.pop();
        a.covered.pop();
        d.units.push(kind);
        d.covered.push(false);
      }
      const t = a.units.length - 1;
      const uncovered = t >= 0 && a.covered[t] === true;
      if (uncovered) a.covered[t] = false;
      path.push({ from: m.from, to: m.to });
      if (go()) return true;
      if (capped) return false;
      path.pop();
      if (uncovered) a.covered[t] = true;
      for (let i = 0; i < m.n; i++) {
        d.units.pop();
        d.covered.pop();
        a.units.push(kind);
        a.covered.push(false);
      }
    }
    return false;
  };
  const ok = go();
  return { status: ok ? "solved" : capped ? "unknown" : "dead", moves: ok ? path.slice() : [], visits };
}
