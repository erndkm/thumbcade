/**
 * One Brinebop run on top of the board: the clock, the score, time bonuses, the final frenzy and the cash-out.
 * Pure (no DOM), like the board, so the headless playtests run exactly what players get.
 *
 *   play (60 s clock; specials and big cascades add a little time)
 *   -> frenzy (the last 5 s: points ×2, three critters puff up into specials)
 *   -> timeup (no more swaps; whatever is falling finishes and still scores)
 *   -> cashout (every special left goes off, one by one, each at a higher multiplier)
 *   -> done
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { Board, N, type BoardEvent, type Special } from "./board.ts";

export const CLOCK = 60;
export const FRENZY_T = 5;
export const FRENZY_MULT = 2;
/** Seconds of bonus time a run can earn in all. */
export const BONUS_CAP = 18;
/** Specials sprinkled in when the frenzy starts. */
export const FRENZY_SPECIALS = 3;
export const CASH_FIRST = 0.55;
export const CASH_GAP = 0.5;
export const CASH_GAP_MIN = 0.36;
export const CASH_MAX = 14;

export type RunPhase = "play" | "timeup" | "cashout" | "done";

/** Board events with the points they actually scored, plus the run's own beats. */
export type RunEvent =
  | (BoardEvent & { pts?: number })
  | { type: "time"; amount: number; at: number; why: "special" | "chain" }
  | { type: "frenzy"; cells: number[] }
  | { type: "timeup" }
  | { type: "cashout"; specials: number }
  | { type: "cash"; at: number; mult: number }
  | { type: "done" };

export interface RunStats {
  biggestChain: number;
  specialsMade: number;
  specialsFired: number;
  combos: number;
  /** Most points from one chain. */
  bestMove: number;
  /** Specials set off by the cash-out, and the points they made. */
  cashout: number;
  cashPoints: number;
  moves: number;
  rejects: number;
  bonusTime: number;
}

export class Run {
  readonly board: Board;
  /** Seconds left on the clock. */
  clock: number;
  elapsed = 0;
  score = 0;
  phase: RunPhase = "play";
  frenzy = false;
  readonly events: RunEvent[] = [];
  readonly stats: RunStats = { biggestChain: 0, specialsMade: 0, specialsFired: 0, combos: 0, bestMove: 0, cashout: 0, cashPoints: 0, moves: 0, rejects: 0, bonusTime: 0 };
  private phaseT = 0;
  private cashT = 0;
  private cashCount = 0;
  /** Points since the board was last calm (the "best move" stat). */
  private wave = 0;
  private lastChainBonus = 0;
  /** The clock waits until the critters have poured in. */
  private warm = false;

  constructor(
    private readonly rng: Rng,
    readonly opts: { endless?: boolean; pour?: boolean; clock?: number } = {},
  ) {
    this.board = new Board(rng, { pour: opts.pour ?? false });
    this.clock = opts.clock ?? CLOCK;
  }

  get canSwap(): boolean {
    return this.phase === "play";
  }

  get mult(): number {
    // The cash-out has its own climb (×2, ×3, ...); the frenzy doubles everything before it.
    if (this.phase === "cashout") return 1 + this.cashCount;
    return this.frenzy ? FRENZY_MULT : 1;
  }

  /** The player drags critter i onto neighbour j. */
  swap(i: number, j: number, drag = 0): boolean {
    if (!this.canSwap) return false;
    const ok = this.board.trySwap(i, j, drag);
    if (ok) this.stats.moves++;
    return ok;
  }

  step(dt: number): void {
    this.elapsed += dt;
    this.phaseT += dt;
    if (!this.warm && this.board.calm) this.warm = true;
    if (this.phase === "play" && !this.opts.endless && this.warm) {
      this.clock = Math.max(0, this.clock - dt);
      if (!this.frenzy && this.clock <= FRENZY_T) this.startFrenzy();
      if (this.clock <= 0) this.setPhase("timeup");
    }
    this.board.step(dt);
    for (const e of this.board.events) this.score1(e);
    this.board.events.length = 0;

    if (this.phase === "timeup") {
      // Let the last cascade land (it still scores), then cash out.
      if (this.board.calm || this.phaseT > 4) this.setPhase("cashout");
    } else if (this.phase === "cashout") {
      this.cashT -= dt;
      if (this.cashT <= 0) {
        const left = this.cashCount < CASH_MAX && this.phaseT < 12 ? this.board.specials() : [];
        if (left.length) {
          // Bottom-most first, so what falls in from above has a chance to cash out too.
          left.sort((a, b) => b - a);
          const at = left[0]!;
          this.cashCount++;
          this.stats.cashout++;
          this.board.detonate(at);
          this.events.push({ type: "cash", at, mult: this.mult });
          this.cashT = Math.max(CASH_GAP_MIN, CASH_GAP - this.cashCount * 0.025);
        } else if (this.board.calm) {
          this.setPhase("done");
          this.events.push({ type: "done" });
        } else this.cashT = 0.1;
      }
    }
  }

  private setPhase(p: RunPhase): void {
    this.phase = p;
    this.phaseT = 0;
    if (p === "timeup") this.events.push({ type: "timeup" });
    if (p === "cashout") {
      this.cashT = CASH_FIRST;
      this.events.push({ type: "cashout", specials: this.board.specials().length });
    }
  }

  private startFrenzy(): void {
    this.frenzy = true;
    // Three critters puff up into specials, so the last seconds are loud and the cash-out has something to pop.
    const spots: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = this.board.grid[i];
      if (this.board.settled(p ?? null) && p!.special === "none") spots.push(i);
    }
    this.rng.shuffle(spots);
    const made: number[] = [];
    const kinds: Special[] = ["bomb", "lineH", "lineV"];
    for (const i of spots) {
      if (made.length >= FRENZY_SPECIALS) break;
      // Keep them apart so each one reads.
      if (made.some((m) => Math.abs((m % 7) - (i % 7)) + Math.abs(((m / 7) | 0) - ((i / 7) | 0)) < 3)) continue;
      if (this.board.makeSpecial(i, kinds[made.length % kinds.length]!)) made.push(i);
    }
    this.events.push({ type: "frenzy", cells: made });
  }

  private addTime(amount: number, at: number, why: "special" | "chain"): void {
    if (this.phase !== "play" || this.frenzy || this.opts.endless) return;
    const room = BONUS_CAP - this.stats.bonusTime;
    const add = Math.min(room, amount);
    if (add <= 0) return;
    this.stats.bonusTime += add;
    this.clock += add;
    this.events.push({ type: "time", amount: add, at, why });
  }

  private score1(e: BoardEvent): void {
    const out = e as BoardEvent & { pts?: number };
    if (e.type === "match" || e.type === "fire") {
      const pts = Math.round(e.points * this.mult);
      if (this.phase !== "done") {
        this.score += pts;
        if (this.phase === "cashout") this.stats.cashPoints += pts;
        else {
          // The best move is the player's own: everything one swap set going, not the cash-out.
          this.wave += pts;
          this.stats.bestMove = Math.max(this.stats.bestMove, this.wave);
        }
      }
      out.pts = pts;
      this.stats.biggestChain = Math.max(this.stats.biggestChain, e.chain);
    }
    if (e.type === "match") {
      if (e.created !== "none") {
        this.stats.specialsMade++;
        this.addTime(e.created === "conch" ? 2 : 1, e.at, "special");
      }
      // Long cascades buy time too: one second at 4 waves, and at every second wave after that.
      if (e.chain >= 4 && e.chain % 2 === 0 && e.chain > this.lastChainBonus) {
        this.lastChainBonus = e.chain;
        this.addTime(1, e.at, "chain");
      }
    } else if (e.type === "fire") {
      this.stats.specialsFired++;
      if (e.combo) this.stats.combos++;
    } else if (e.type === "chainEnd" || e.type === "calm") {
      this.wave = 0;
      this.lastChainBonus = 0;
    }
    this.events.push(out);
  }
}

/** A run's seed: the launch seed mixed with the run number (never with how long the attract demo ran). */
export function runSeed(seed: number, run: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(run + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  return h >>> 0;
}
