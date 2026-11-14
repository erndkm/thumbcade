/**
 * One run: levels of pots against one clock. Tap a pot to lift its top run, tap another to drop it on its own kind or
 * into an empty pot. Four of a kind in a full-size pot is sealed and gives time back; sealing every pot tidies the
 * level, gives more time back and deals a bigger one. A dead position (no way left to tidy the level) is never the
 * end: the level's grace rewinds it for free, then a held spare pot, then a rewind that costs a few seconds.
 * Pure and time-stepped, so the game, the pilot and the tests all play the same rules.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { dealLevel, planFor } from "./deal.ts";
import { applyMove, cloneBoard, FULL, isClear, isSealed, moveCount, runLength, top, type Board, type Move } from "./rules.ts";
import { solve } from "./solver.ts";

export const TUNE = {
  /** Seconds on the clock at the first tap, and the most it ever holds. */
  clock: 26,
  clockMax: 45,
  /** The clock burns 1 + (t / burnScale)^burnPow seconds a second. */
  burnScale: 100,
  burnPow: 1.3,
  /** Seconds a sealed pot gives back. */
  sealTime: 2,
  /** Seconds a tidied level gives back: the first, then less each level down to the floor. */
  clearTime: 7,
  clearTimeStep: 0.5,
  clearTimeMin: 4,
  /** A seal within this many seconds of the last one keeps the streak going. */
  streakWindow: 4,
  /** The streak that reaches each multiplier: ×2 at two seals in a row, ×3 at four, ×4 at seven, ×5 at eleven. */
  tiers: [2, 4, 7, 11],
  sealPoints: 100,
  revealPoints: 10,
  /** A tidied level: per level number, plus per second left on the clock. */
  clearPoints: 200,
  clockPoints: 10,
  /** Seconds the clock stands still while a tidied level is celebrated and the next one dealt. */
  dealPause: 2,
  /** Spare pots held at most (one is earned with every tidied level). */
  sparesMax: 2,
  /** Seconds between a dead position and the help, so the player sees why. */
  stuckDelay: 0.9,
  /** Seconds a rewind costs once the level's grace is used and no spare pot is held. */
  rewindCost: 3,
  /** In the run's first seconds every dead end is forgiven for free. */
  safeStart: 15,
  /** Positions the solver may look at when checking whether a position is still alive. */
  aliveLimit: 25_000,
} as const;

/** The line for each multiplier tier. */
export const TIER_LINES = ["", "", "pat-pat!", "on a roll!", "knead for speed!", "hot from the oven!"] as const;

export function multiplier(streak: number): number {
  let m = 1;
  for (const t of TUNE.tiers) if (streak >= t) m++;
  return m;
}

export const clearTimeFor = (level: number): number => Math.max(TUNE.clearTimeMin, TUNE.clearTime - TUNE.clearTimeStep * (level - 1));

export type Help = "grace" | "spare" | "rewind";

export type RunEvent =
  | { type: "lift"; pot: number; n: number; kind: number }
  | { type: "putBack"; pot: number }
  | { type: "retarget"; from: number; pot: number; n: number; kind: number }
  | { type: "nope"; pot: number; why: "sealed" | "empty" | "busy" }
  | { type: "move"; from: number; to: number; n: number; kind: number; left: number }
  | { type: "reveal"; pot: number; index: number; kind: number; id: number }
  | { type: "seal"; pot: number; kind: number; streak: number; mult: number; tierUp: boolean; points: number }
  | { type: "clear"; level: number; points: number; time: number; spare: boolean }
  | { type: "deal"; level: number; fresh: number[] }
  | { type: "stuck" }
  | { type: "help"; how: Help; undone: number; cost: number; pot: number }
  | { type: "spare"; pot: number }
  | { type: "over" };

export interface RunStats {
  levels: number;
  seals: number;
  bestStreak: number;
  moves: number;
  /** Taps that switched the lifted run to another pot. */
  retargets: number;
  /** Taps on a sealed pot, or on an empty pot with nothing lifted. */
  nopes: number;
  graces: number;
  rewinds: number;
  sparesUsed: number;
  reveals: number;
  /** Moves that left part of the run behind (the target was too full). */
  partial: number;
  /** Seconds from the first tap. */
  seconds: number;
  /** Seconds spent holding a spare pot without using it. */
  spareIdle: number;
}

interface Snapshot {
  board: Board;
  alive: boolean;
}

let nextId = 1;

/** Gives every lump an identity, so the game can follow it from pot to pot. */
function tag(board: Board): Board {
  for (const p of board) p.ids = p.units.map(() => nextId++);
  return board;
}

export class Run {
  readonly rng: Rng;
  t = 0;
  clock: number = TUNE.clock;
  level = 0;
  board: Board = [];
  witness: Move[] = [];
  /** The pot whose top run is lifted, or -1. */
  held = -1;
  score = 0;
  streak = 0;
  lastSeal = -Infinity;
  /** Seconds left in the pause between levels (the clock stands still, taps are ignored). */
  pause = 0;
  graceUsed = false;
  spares = 0;
  /** Seconds until a dead position gets help (-1 = alive). */
  stuckIn = -1;
  over = false;
  /** Kinds seen so far this run. */
  seen = new Set<number>();
  stats: RunStats = { levels: 0, seals: 0, bestStreak: 0, moves: 0, retargets: 0, nopes: 0, graces: 0, rewinds: 0, sparesUsed: 0, reveals: 0, partial: 0, seconds: 0, spareIdle: 0 };
  private history: Snapshot[] = [];
  private dealNext = false;

  /** Attract mode: the clock never runs down, and after `loopAfter` levels the demo starts again at level 1. */
  readonly demo: boolean;
  private readonly loopAfter: number;

  constructor(seed: number, opts: { demo?: boolean; loopAfter?: number } = {}) {
    this.rng = createRng(seed);
    this.demo = opts.demo ?? false;
    this.loopAfter = opts.loopAfter ?? Infinity;
    this.deal();
  }

  get live(): boolean {
    return !this.over;
  }

  /** Seconds the clock burns per second right now. */
  get burn(): number {
    return 1 + (this.t / TUNE.burnScale) ** TUNE.burnPow;
  }

  get accepting(): boolean {
    return this.live && this.pause <= 0;
  }

  get spareOnBoard(): boolean {
    return this.board.some((p) => p.spare);
  }

  private deal(): RunEvent {
    if (this.level >= this.loopAfter) this.level = 0;
    this.level++;
    const d = dealLevel(planFor(this.level), this.rng);
    this.board = tag(d.board);
    this.witness = d.witness;
    this.graceUsed = false;
    this.history = [];
    this.held = -1;
    this.stuckIn = -1;
    const fresh: number[] = [];
    for (const p of this.board) for (const k of p.units) if (!this.seen.has(k) && !fresh.includes(k)) fresh.push(k);
    for (const k of fresh) this.seen.add(k);
    return { type: "deal", level: this.level, fresh };
  }

  /** Advances the clock and anything waiting on it. */
  step(dt: number): RunEvent[] {
    if (!this.live) return [];
    if (this.pause > 0) {
      this.pause = Math.max(0, this.pause - dt);
      if (this.pause === 0 && this.dealNext) {
        this.dealNext = false;
        return [this.deal()];
      }
      return [];
    }
    const out: RunEvent[] = [];
    this.t += dt;
    this.stats.seconds = this.t;
    if (this.spares > 0 && !this.spareOnBoard) this.stats.spareIdle += dt;
    if (this.stuckIn >= 0) {
      this.stuckIn -= dt;
      if (this.stuckIn < 0) out.push(...this.help());
    }
    if (!this.demo) this.clock -= dt * this.burn;
    if (this.clock <= 0) {
      this.clock = 0;
      this.over = true;
      this.held = -1;
      out.push({ type: "over" });
    }
    return out;
  }

  /** The input path: a tap on pot `i` lifts, drops, re-targets or puts back. */
  tap(i: number): RunEvent[] {
    if (!this.accepting) return [];
    const p = this.board[i];
    if (!p) return this.tapAway();
    if (this.held < 0) {
      if (isSealed(p)) {
        this.stats.nopes++;
        return [{ type: "nope", pot: i, why: "sealed" }];
      }
      if (!p.units.length) {
        this.stats.nopes++;
        return [{ type: "nope", pot: i, why: "empty" }];
      }
      this.held = i;
      return [{ type: "lift", pot: i, n: runLength(p), kind: top(p) }];
    }
    if (i === this.held) {
      this.held = -1;
      return [{ type: "putBack", pot: i }];
    }
    if (moveCount(this.board, this.held, i) > 0) return this.move(this.held, i);
    if (isSealed(p) || !p.units.length) {
      this.stats.nopes++;
      return [{ type: "nope", pot: i, why: isSealed(p) ? "sealed" : "busy" }];
    }
    // It can't go there: lift that pot's run instead (the old one settles back).
    const from = this.held;
    this.held = i;
    this.stats.retargets++;
    return [{ type: "retarget", from, pot: i, n: runLength(p), kind: top(p) }];
  }

  /** A tap on no pot puts a lifted run back. */
  tapAway(): RunEvent[] {
    if (this.held < 0 || !this.accepting) return [];
    const pot = this.held;
    this.held = -1;
    return [{ type: "putBack", pot }];
  }

  private move(from: number, to: number): RunEvent[] {
    const before = cloneBoard(this.board);
    const wasAlive = this.history.length === 0 || this.stuckIn < 0;
    const runN = runLength(this.board[from]!);
    const r = applyMove(this.board, from, to)!;
    this.history.push({ board: before, alive: wasAlive });
    this.held = -1;
    this.stats.moves++;
    if (r.n < runN) this.stats.partial++;
    const out: RunEvent[] = [{ type: "move", from, to, n: r.n, kind: r.kind, left: runN - r.n }];
    if (r.revealed >= 0) {
      this.score += TUNE.revealPoints;
      this.stats.reveals++;
      out.push({ type: "reveal", pot: from, index: r.revealed, kind: r.revealedKind, id: this.board[from]!.ids![r.revealed]! });
    }
    if (r.sealed) out.push(this.seal(to));
    if (isClear(this.board)) {
      out.push(this.clearLevel());
      return out;
    }
    if (this.stuckIn < 0 && solve(this.board, TUNE.aliveLimit).status === "dead") {
      this.stuckIn = TUNE.stuckDelay;
      out.push({ type: "stuck" });
    }
    return out;
  }

  private seal(pot: number): RunEvent {
    this.streak = this.t - this.lastSeal <= TUNE.streakWindow ? this.streak + 1 : 1;
    this.lastSeal = this.t;
    const mult = multiplier(this.streak);
    const points = TUNE.sealPoints * mult;
    this.score += points;
    this.addClock(TUNE.sealTime);
    this.stats.seals++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    return { type: "seal", pot, kind: this.board[pot]!.units[0]!, streak: this.streak, mult, tierUp: mult > multiplier(this.streak - 1), points };
  }

  private clearLevel(): RunEvent {
    const time = clearTimeFor(this.level);
    const points = TUNE.clearPoints * this.level + Math.round(this.clock) * TUNE.clockPoints;
    this.score += points;
    this.addClock(time);
    this.stats.levels++;
    const spare = this.spares < TUNE.sparesMax;
    if (spare) this.spares++;
    this.pause = TUNE.dealPause;
    this.dealNext = true;
    this.stuckIn = -1;
    return { type: "clear", level: this.level, points, time, spare };
  }

  private addClock(s: number) {
    this.clock = Math.min(TUNE.clockMax, this.clock + s);
  }

  /** The way out of a dead position: the level's grace, a held spare pot, or a rewind that costs a few seconds. */
  private help(): RunEvent[] {
    this.held = -1;
    const free = !this.graceUsed || this.t < TUNE.safeStart;
    if (!free && this.spares > 0 && !this.spareOnBoard) {
      const trial = cloneBoard(this.board);
      trial.push({ units: [], covered: [], cap: FULL, spare: true });
      if (solve(trial, TUNE.aliveLimit).status !== "dead") {
        const pot = this.addSpare();
        this.stats.sparesUsed++;
        return [{ type: "help", how: "spare", undone: 0, cost: 0, pot }];
      }
    }
    const undone = this.rewind();
    if (free) {
      this.graceUsed = true;
      this.stats.graces++;
      return [{ type: "help", how: "grace", undone, cost: 0, pot: -1 }];
    }
    const cost = Math.min(TUNE.rewindCost, Math.max(0, this.clock - 2));
    this.clock -= cost;
    this.stats.rewinds++;
    return [{ type: "help", how: "rewind", undone, cost, pot: -1 }];
  }

  /** Back to the last position that could still be tidied. Returns how many moves were undone. */
  private rewind(): number {
    let undone = 0;
    while (this.history.length) {
      const s = this.history.pop()!;
      undone++;
      if (s.alive) {
        this.board = s.board;
        break;
      }
    }
    this.stuckIn = -1;
    return undone;
  }

  private addSpare(): number {
    this.spares--;
    this.board.push({ units: [], covered: [], cap: FULL, spare: true, ids: [] });
    // A spare pot is part of the position from now on: earlier snapshots get it too, so a rewind keeps it.
    for (const s of this.history) s.board.push({ units: [], covered: [], cap: FULL, spare: true, ids: [] });
    if (this.stuckIn >= 0 && solve(this.board, TUNE.aliveLimit).status !== "dead") this.stuckIn = -1;
    return this.board.length - 1;
  }

  /** Uses a held spare pot by hand: an empty pot for the rest of the level. */
  useSpare(): RunEvent[] {
    if (!this.accepting || this.spares <= 0 || this.spareOnBoard) return [];
    this.stats.sparesUsed++;
    return [{ type: "spare", pot: this.addSpare() }];
  }

  /** A good next move for the idle hint and the first-run ghost: the solver's, or null if there is none. */
  hint(): Move | null {
    if (!this.accepting) return null;
    const s = solve(this.board, TUNE.aliveLimit);
    return s.moves[0] ?? null;
  }
}

/** The seed of the n-th run of a session. */
export const runSeed = (seed: number, n: number): number => (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0;
