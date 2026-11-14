/**
 * One run of Scootpurr: rug after rug against one candle. Pure and stepped by time, so the same seed and the same
 * taps at the same moments give the same run.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { BASKET, catsLeft, deal, EMPTY, freeCats, wayOf, type Board, type Cat } from "./board.ts";

export const TUNE = {
  /** Seconds of candle at the first tap, and the most it can hold. */
  clock: 26,
  max: 40,
  /** The candle burns faster the longer the run goes on. */
  burn: (t: number) => 1 + (t / 95) ** 1.4,
  /** Left alone this long, the candle gutters and burns this much faster, so an untouched run ends on its own. */
  idleAfter: 6,
  idleBurn: 1.7,
  /** Seconds a cleared rug gives back. */
  refund: (level: number) => Math.max(4.5, 7.5 - level * 0.4),
  /** A bump costs this much candle (less in the first seconds), at most once in `bumpGap`. */
  bump: 2,
  bumpEarly: 0.5,
  earlyUntil: 10,
  bumpGap: 0.6,
  /** Cats in a row without a bump for purr x2, x3, x4, x5. */
  tiers: [4, 10, 18, 28] as readonly number[],
  /** Points per square of cat, before the purr. */
  square: 10,
  /** A cleared rug: this times its number, plus a little for every second of candle left. */
  rug: 60,
  perSecond: 4,
  /** Extra for a rug cleared without a bump, and for seeing the witch's cat out last (each times the rug's number). */
  clean: 40,
  last: 50,
  /** The candle stands still while a cleared rug is cheered and the next one is laid. */
  cheer: 1.5,
  lay: 0.7,
} as const;

export const PURR_NAMES = ["", "purring", "rumbling", "motorboat!", "the big purr!"] as const;

/** The purr (score multiplier) a streak has earned. */
export function purrOf(streak: number): number {
  let p = 1;
  for (const t of TUNE.tiers) if (streak >= t) p++;
  return p;
}

export type TapResult =
  | { kind: "out"; cat: Cat; points: number; purr: number; streak: number; cleared: boolean }
  | { kind: "bump"; cat: Cat; by: number; free: number; cost: number }
  | { kind: "none" };

export interface ClearEvent {
  level: number;
  points: number;
  clean: boolean;
  last: boolean;
  refund: number;
}

export interface RunListener {
  /** A new rug is down. */
  laid?(board: Board, level: number): void;
  cleared?(e: ClearEvent): void;
  tier?(purr: number): void;
  over?(): void;
}

export interface Stats {
  seconds: number;
  rugs: number;
  cats: number;
  bumps: number;
  bestStreak: number;
  bestPurr: number;
  cleanRugs: number;
  lastOut: number;
  /** Taps that landed on no cat. */
  misses: number;
}

export class Run {
  board: Board;
  level = 0;
  clock: number = TUNE.clock;
  score = 0;
  streak = 0;
  time = 0;
  over = false;
  started = false;
  /** "lay": the rug is being laid, "play", or "cheer": a cleared rug is being cheered. */
  phase: "lay" | "play" | "cheer" = "lay";
  phaseT = 0;
  /** Bumps on the rug in play. */
  rugBumps = 0;
  readonly stats: Stats = { seconds: 0, rugs: 0, cats: 0, bumps: 0, bestStreak: 0, bestPurr: 1, cleanRugs: 0, lastOut: 0, misses: 0 };
  private lastBump = -9;
  private lastTouch = 0;
  private starWasLast = false;

  constructor(private readonly seed: number, private readonly listener: RunListener = {}) {
    this.board = this.dealLevel(0);
  }

  /** Each rug comes from the run's seed and its number alone, so nothing else that happens changes it. */
  private dealLevel(level: number): Board {
    return deal(level, createRng((this.seed ^ Math.imul(level + 1, 0x9e3779b1)) >>> 0));
  }

  start(): this {
    this.started = true;
    this.phase = "lay";
    this.phaseT = 0;
    this.listener.laid?.(this.board, this.level);
    return this;
  }

  get purr(): number {
    return purrOf(this.streak);
  }

  /** Cats still to go before the next purr tier (0 at the top). */
  get toNextTier(): number {
    for (const t of TUNE.tiers) if (this.streak < t) return t - this.streak;
    return 0;
  }

  /** Nobody has touched the rug for a while. */
  get guttering(): boolean {
    return this.time - this.lastTouch > TUNE.idleAfter;
  }

  /** What a bump would cost right now. */
  bumpCost(): number {
    if (this.time - this.lastBump < TUNE.bumpGap) return 0;
    return this.time < TUNE.earlyUntil ? TUNE.bumpEarly : TUNE.bump;
  }

  /** A tap on a cat: off it scoots if its way is clear, or it bumps into whatever is ahead. */
  tap(id: number): TapResult {
    if (this.over || !this.started || this.phase === "cheer") return { kind: "none" };
    this.lastTouch = this.time;
    const b = this.board;
    const cat = b.cats.find((c) => c.id === id);
    if (!cat || cat.out) return { kind: "none" };
    const way = wayOf(b, cat);
    if (way.by !== EMPTY) {
      const cost = this.bumpCost();
      if (cost > 0) this.lastBump = this.time;
      this.clock = Math.max(0, this.clock - cost);
      this.streak = 0;
      this.rugBumps++;
      this.stats.bumps++;
      return { kind: "bump", cat, by: way.by, free: way.free, cost };
    }
    cat.out = true;
    const before = this.purr;
    this.streak++;
    const purr = this.purr;
    const points = TUNE.square * cat.len * purr;
    this.score += points;
    const s = this.stats;
    s.cats++;
    if (this.streak > s.bestStreak) s.bestStreak = this.streak;
    if (purr > s.bestPurr) s.bestPurr = purr;
    if (purr > before) this.listener.tier?.(purr);
    const cleared = catsLeft(b) === 0;
    if (cleared) {
      this.starWasLast = cat.coat === 0;
      this.clearRug();
    }
    return { kind: "out", cat, points, purr, streak: this.streak, cleared };
  }

  /** A tap that hit nothing. */
  miss(): void {
    this.lastTouch = this.time;
    this.stats.misses++;
  }

  private clearRug(): void {
    const n = this.level + 1;
    const clean = this.rugBumps === 0;
    const last = this.starWasLast && this.board.cats.length > 1;
    const refund = TUNE.refund(this.level);
    const points = TUNE.rug * n + Math.round(this.clock) * TUNE.perSecond + (clean ? TUNE.clean * n : 0) + (last ? TUNE.last * n : 0);
    this.score += points;
    this.clock = Math.min(TUNE.max, this.clock + refund);
    const s = this.stats;
    s.rugs++;
    if (clean) s.cleanRugs++;
    if (last) s.lastOut++;
    this.phase = "cheer";
    this.phaseT = 0;
    this.listener.cleared?.({ level: this.level, points, clean, last, refund });
  }

  step(dt: number): void {
    if (!this.started || this.over) return;
    this.time += dt;
    this.stats.seconds = this.time;
    this.phaseT += dt;
    if (this.phase === "cheer") {
      if (this.phaseT >= TUNE.cheer) {
        this.level++;
        this.rugBumps = 0;
        this.board = this.dealLevel(this.level);
        this.phase = "lay";
        this.phaseT = 0;
        this.listener.laid?.(this.board, this.level);
      }
      return;
    }
    if (this.phase === "lay" && this.phaseT >= TUNE.lay) {
      this.phase = "play";
      this.phaseT = 0;
    }
    // The candle burns while a rug is down, even as it is being laid: taps already count.
    this.clock -= dt * TUNE.burn(this.time) * (this.guttering ? TUNE.idleBurn : 1);
    if (this.clock <= 0) {
      this.clock = 0;
      this.over = true;
      this.listener.over?.();
    }
  }

  /** The cats that could go right now. */
  free(): Cat[] {
    return freeCats(this.board);
  }
}

export { BASKET, EMPTY };
