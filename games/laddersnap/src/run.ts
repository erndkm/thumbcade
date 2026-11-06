import { apply, canDraw, cleared, DRAW, exposed, nextCard, plays, startPos, stockLeft, type Checked, type Deal, type Pos } from "./deal.ts";

/**
 * The rules of a run, with no drawing in them: the game and the headless pilots both drive this.
 *
 * A run is a string of hands against one clock. Every play off the tableau scores, and plays made without drawing
 * build a streak whose tier multiplies the points. Clearing a column gives a little time back, clearing the hand
 * gives a lot, plus a bonus for every stock card left. A hand that runs out of cards and moves just gets swept
 * away and the next one is dealt: the clock is what ends a run, never one bad hand.
 */

export const TUNE = {
  /** Seconds on the clock at the start, and the most it can hold. */
  start: 32,
  max: 45,
  /** Clock seconds burned per real second, by hand index. */
  drain: (hand: number) => 1 + 0.18 * hand,
  /** Seconds back for emptying a column, and for clearing a hand (+ per stock card left). */
  columnBack: 1.5,
  clearBack: (hand: number) => Math.max(3.5, 7 - 0.5 * hand),
  stockBack: 0.4,
  /** Points. */
  play: 10,
  column: 40,
  clear: 300,
  stockBonus: 40,
  /** Phase lengths (s). The clock is stopped while a hand is dealt or celebrated; a stall keeps it running. */
  dealIn: 0.75,
  clearOut: 1.25,
  stallOut: 0.9,
  /** The last seconds don't end the run mid-celebration: a hand cleared at 0.2 s left still gets its time. */
} as const;

/** Streak tiers: plays in a row without drawing → multiplier. */
export const TIERS = [1, 3, 5, 8, 12] as const;
export function tierOf(streak: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (streak >= TIERS[i]!) t = i;
  return t;
}
export const multOf = (streak: number): number => tierOf(streak) + 1;

export type Phase = "deal" | "play" | "clear" | "stall" | "over";

export interface RunListener {
  deal?(hand: number, d: Deal): void;
  play?(col: number, card: number, streak: number, points: number, tierUp: boolean): void;
  draw?(card: number, next: number | null, left: number): void;
  column?(col: number, points: number, seconds: number): void;
  clear?(hand: number, points: number, seconds: number, stock: number): void;
  stall?(left: number): void;
  end?(): void;
}

export interface Stats {
  hands: number;
  cleared: number;
  plays: number;
  draws: number;
  bestStreak: number;
  columns: number;
  /** Seconds the run lasted (real time). */
  seconds: number;
}

/** Supplies hand `index` (the game pre-computes them over several frames; pilots call dealHand directly). */
export type HandSource = (index: number) => Checked;

export class Run {
  phase: Phase = "deal";
  phaseT = 0;
  clock: number = TUNE.start;
  score = 0;
  streak = 0;
  hand = 0;
  deal!: Deal;
  pos!: Pos;
  readonly stats: Stats = { hands: 0, cleared: 0, plays: 0, draws: 0, bestStreak: 0, columns: 0, seconds: 0 };
  private listener: RunListener;

  constructor(
    private source: HandSource,
    listener: RunListener = {},
  ) {
    this.listener = listener;
  }

  /** Deals the first hand. */
  start(): this {
    this.begin(0);
    return this;
  }

  private begin(index: number): void {
    this.hand = index;
    this.deal = this.source(index).deal;
    this.pos = startPos(this.deal);
    this.phase = "deal";
    this.phaseT = 0;
    this.stats.hands++;
    this.listener.deal?.(index, this.deal);
  }

  get mult(): number {
    return multOf(this.streak);
  }
  get playable(): number[] {
    return this.phase === "play" ? plays(this.deal, this.pos) : [];
  }
  get canDraw(): boolean {
    return this.phase === "play" && canDraw(this.deal, this.pos);
  }
  get next(): number | null {
    return nextCard(this.deal, this.pos);
  }
  get stock(): number {
    return stockLeft(this.deal, this.pos);
  }
  get over(): boolean {
    return this.phase === "over";
  }

  /** Advances time by dt real seconds. */
  step(dt: number): void {
    if (this.phase === "over") return;
    this.stats.seconds += dt;
    this.phaseT += dt;
    if (this.phase === "play" || this.phase === "stall") {
      this.clock -= TUNE.drain(this.hand) * dt;
      if (this.clock <= 0) {
        this.clock = 0;
        this.phase = "over";
        this.phaseT = 0;
        this.listener.end?.();
        return;
      }
    }
    if (this.phase === "deal" && this.phaseT >= TUNE.dealIn) this.toPlay();
    else if (this.phase === "clear" && this.phaseT >= TUNE.clearOut) this.begin(this.hand + 1);
    else if (this.phase === "stall" && this.phaseT >= TUNE.stallOut) this.begin(this.hand + 1);
  }

  private toPlay(): void {
    this.phase = "play";
    this.phaseT = 0;
    this.checkStall();
  }

  private checkStall(): void {
    if (this.phase === "play" && !cleared(this.pos) && !canDraw(this.deal, this.pos) && plays(this.deal, this.pos).length === 0) {
      this.phase = "stall";
      this.phaseT = 0;
      this.streak = 0;
      this.listener.stall?.(this.pos.heights.reduce((a, b) => a + b, 0));
    }
  }

  /** Plays the exposed card of column `col`. Returns false (and changes nothing) when it doesn't go. */
  play(col: number): boolean {
    if (this.phase !== "play" || !plays(this.deal, this.pos).includes(col)) return false;
    const card = exposed(this.deal, this.pos, col)!;
    const tierBefore = tierOf(this.streak);
    this.pos = apply(this.deal, this.pos, col);
    this.streak++;
    this.stats.plays++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    const points = TUNE.play * this.mult;
    this.score += points;
    this.listener.play?.(col, card, this.streak, points, tierOf(this.streak) > tierBefore);
    if (this.pos.heights[col] === 0) {
      this.stats.columns++;
      this.score += TUNE.column;
      this.addClock(TUNE.columnBack);
      this.listener.column?.(col, TUNE.column, TUNE.columnBack);
    }
    if (cleared(this.pos)) {
      const stock = stockLeft(this.deal, this.pos);
      const pts = TUNE.clear + TUNE.stockBonus * stock;
      const secs = TUNE.clearBack(this.hand) + TUNE.stockBack * stock;
      this.score += pts;
      this.addClock(secs);
      this.stats.cleared++;
      this.phase = "clear";
      this.phaseT = 0;
      this.listener.clear?.(this.hand, pts, secs, stock);
      return true;
    }
    this.checkStall();
    return true;
  }

  /** Turns the next stock card onto the pile. Breaks the streak. */
  draw(): boolean {
    if (this.phase !== "play" || !canDraw(this.deal, this.pos)) return false;
    this.pos = apply(this.deal, this.pos, DRAW);
    this.streak = 0;
    this.stats.draws++;
    this.listener.draw?.(this.pos.pile, nextCard(this.deal, this.pos), stockLeft(this.deal, this.pos));
    this.checkStall();
    return true;
  }

  private addClock(s: number): void {
    this.clock = Math.min(TUNE.max, this.clock + s);
  }
}
