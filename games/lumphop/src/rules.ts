/**
 * The rules, pure and small, so the game, the solver, the dealer, the pilot and the tests all play the same game.
 *
 * A board is a row of pots. A pot holds a stack of clay lumps, bottom first, up to its capacity (4 for a full pot, less
 * for a little one). Some lumps start covered: plain putty until they reach the top of their pot, when they show their
 * kind and stay shown. A move takes the top run (the shown lumps of one kind on top) and puts as many as fit on
 * another pot that is empty or has the same kind on top. A full-size pot holding four of one kind is sealed and done.
 */

/** Lumps of each kind in a level, and the size of a full pot. */
export const FULL = 4;

export interface Pot {
  /** Kinds, bottom first. */
  units: number[];
  /** Covered flags, parallel to `units`. The top lump is never covered. */
  covered: boolean[];
  cap: number;
  /** A spare pot brought in by a helper (drawn apart; plays like any other). */
  spare?: boolean;
  /** Identities of the lumps, parallel to `units`, so the game can follow each one (moved along by `applyMove`). */
  ids?: number[];
}

export type Board = Pot[];

export interface Move {
  from: number;
  to: number;
}

export const top = (p: Pot): number => (p.units.length ? p.units[p.units.length - 1]! : -1);

/** A full-size pot holding four of one kind. */
export function isSealed(p: Pot): boolean {
  if (p.cap !== FULL || p.units.length !== FULL) return false;
  const k = p.units[0]!;
  for (let i = 0; i < FULL; i++) if (p.units[i] !== k || p.covered[i]) return false;
  return true;
}

/** Shown lumps of the top kind on top of a pot (0 for an empty pot). */
export function runLength(p: Pot): number {
  const n = p.units.length;
  if (!n) return 0;
  const k = p.units[n - 1]!;
  let r = 0;
  for (let i = n - 1; i >= 0 && p.units[i] === k && !p.covered[i]; i--) r++;
  return r;
}

/** How many lumps a move from `a` to `b` would carry (0 if it can't be made). */
export function moveCount(board: Board, from: number, to: number): number {
  if (from === to) return 0;
  const a = board[from];
  const b = board[to];
  if (!a || !b || !a.units.length || isSealed(a) || isSealed(b)) return 0;
  const free = b.cap - b.units.length;
  if (free <= 0) return 0;
  if (b.units.length && top(b) !== top(a)) return 0;
  return Math.min(runLength(a), free);
}

export const canMove = (board: Board, from: number, to: number): boolean => moveCount(board, from, to) > 0;

export interface MoveResult {
  n: number;
  kind: number;
  /** The index (in `from`) of a lump that was uncovered by the move, or -1. */
  revealed: number;
  /** The kind it showed. */
  revealedKind: number;
  sealed: boolean;
}

/** Makes a move in place. Returns null (and changes nothing) if it isn't legal. */
export function applyMove(board: Board, from: number, to: number): MoveResult | null {
  const n = moveCount(board, from, to);
  if (!n) return null;
  const a = board[from]!;
  const b = board[to]!;
  const kind = top(a);
  const moved = a.ids && b.ids ? a.ids.splice(a.ids.length - n, n) : null;
  for (let i = 0; i < n; i++) {
    a.units.pop();
    a.covered.pop();
    b.units.push(kind);
    b.covered.push(false);
  }
  if (moved) b.ids!.push(...moved);
  let revealed = -1;
  let revealedKind = -1;
  const t = a.units.length - 1;
  if (t >= 0 && a.covered[t]) {
    a.covered[t] = false;
    revealed = t;
    revealedKind = a.units[t]!;
  }
  return { n, kind, revealed, revealedKind, sealed: isSealed(b) };
}

/** Every pot empty or sealed. */
export function isClear(board: Board): boolean {
  return board.every((p) => !p.units.length || isSealed(p));
}

export function cloneBoard(board: Board): Board {
  return board.map((p) => ({ units: p.units.slice(), covered: p.covered.slice(), cap: p.cap, ...(p.spare ? { spare: true } : {}), ...(p.ids ? { ids: p.ids.slice() } : {}) }));
}

/** All legal moves (every pair), in board order. */
export function legalMoves(board: Board): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < board.length; i++) for (let j = 0; j < board.length; j++) if (canMove(board, i, j)) out.push({ from: i, to: j });
  return out;
}

/**
 * A move that can't help: a pot holding one kind only, moved whole into an empty pot no bigger than itself. The solver
 * skips these, and the pilot and the idle hint never suggest them.
 */
export function isIdleMove(board: Board, from: number, to: number): boolean {
  const a = board[from]!;
  const b = board[to]!;
  return !b.units.length && runLength(a) === a.units.length && b.cap <= a.cap;
}
