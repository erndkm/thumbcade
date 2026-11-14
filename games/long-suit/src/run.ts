/**
 * One run of Long Suit: deal after deal of patience against one clock. Pure and stepped by time; the screen, the
 * pilot and the tests all drive it through `tap`.
 */
import { canBuild, canHome, cardsHome, cloneTable, hidden, settle, sweepOne, tapColumn, tapStock, tapWaste, won, type Card, type Step, type Table } from "./cards.ts";
import { Dealer, specOf, type Dealt } from "./deal.ts";
import type { Target } from "./natural.ts";
import { Solver, type Move } from "./solver.ts";

export const TUNE = {
  /** Seconds on the clock at the first tap, and the most it can hold. */
  clock: 25,
  max: 40,
  /** The clock runs faster the longer the run goes on. */
  burn: (t: number) => 1 + (t / 75) ** 1.7,
  /** Seconds back for a card sent home by hand, for a card turned up, and for a cleared deal. */
  homeTime: 0.28,
  flipTime: 0.25,
  clearTime: (level: number) => Math.max(3, 5.5 - level * 0.6),
  /** Points for a card home (times the chain's multiplier) and for a card turned up. */
  home: 10,
  flip: 5,
  /** A cleared deal: this times its number, plus a little for every second left. */
  clear: 100,
  perSecond: 5,
  /** Cards sent home back to back for x2, x3, x4, x5; the chain breaks after `chainGap` seconds without one. */
  tiers: [4, 9, 15, 24] as readonly number[],
  chainGap: 3,
  /** The clock stands still while a deal is laid, while the last cards sweep home, and while a cleared deal is cheered. */
  lay: 0.7,
  sweepStep: 0.075,
  cheer: 1.3,
  /** A dead end: this long to read why, then a fresh deal of the same size. */
  afresh: 1.1,
  /** Nodes the solver may spend deciding whether a table is a dead end, and looking for a hint. */
  deadNodes: 20000,
  hintNodes: 2500,
} as const;

/** The multiplier a chain of cards home has earned. */
export function multOf(chain: number): number {
  let m = 1;
  for (const t of TUNE.tiers) if (chain >= t) m++;
  return m;
}

export type { Target };

export interface ClearEvent {
  level: number;
  points: number;
  refund: number;
}

export interface RunListener {
  /** A new deal is on the table (`fresh`: the last one was a dead end). */
  dealt?(table: Table, level: number, fresh: boolean): void;
  /** Things that just happened on the table, in order. `cause`: a tap, or the sweep at the end of a deal. */
  steps?(steps: Step[], cause: "tap" | "sweep"): void;
  /** A tap that fitted nowhere. */
  dud?(target: Target): void;
  tier?(mult: number): void;
  cleared?(e: ClearEvent): void;
  /** The table can no longer be won. */
  dead?(): void;
  over?(): void;
}

export interface Stats {
  seconds: number;
  deals: number;
  home: number;
  flips: number;
  taps: number;
  duds: number;
  draws: number;
  /** Times the drawn cards were turned back into a pack. */
  turns: number;
  bestChain: number;
  bestMult: number;
  /** Deals abandoned as dead ends. */
  afresh: number;
}

export class Run {
  table: Table;
  level = 0;
  redeal = 0;
  clock: number = TUNE.clock;
  score = 0;
  chain = 0;
  time = 0;
  over = false;
  started = false;
  phase: "lay" | "play" | "sweep" | "cheer" | "afresh" = "lay";
  phaseT = 0;
  /** A move that leads to a win from here, when one has been looked for and found. */
  hint: Target | null = null;
  readonly stats: Stats = { seconds: 0, deals: 0, home: 0, flips: 0, taps: 0, duds: 0, draws: 0, turns: 0, bestChain: 0, bestMult: 1, afresh: 0 };

  private readonly dealer: Dealer;
  private lastHome = -99;
  private sweepT = 0;
  /** Draws and turns since anything was played. */
  private fruitless = 0;
  private judge: Solver | null = null;
  private judging: "dead" | "hint" | null = null;

  constructor(seed: number, private readonly listener: RunListener = {}, dealer?: Dealer) {
    this.dealer = dealer ?? new Dealer(seed);
    this.table = this.dealer.get(0, 0).table;
  }

  /** The deal now on the table, with its winning line (for tests and the attract demo). */
  dealt(): Dealt {
    return this.dealer.get(this.level, this.redeal);
  }

  start(): this {
    this.started = true;
    this.phase = "lay";
    this.phaseT = 0;
    this.listener.dealt?.(this.table, this.level, false);
    return this;
  }

  get mult(): number {
    return multOf(this.chain);
  }

  /** Cards still to send home in this chain before the next multiplier (0 at the top). */
  get toNextTier(): number {
    for (const t of TUNE.tiers) if (this.chain < t) return t - this.chain;
    return 0;
  }

  /** Seconds the chain has left before it breaks. */
  get chainLeft(): number {
    return this.chain > 0 ? Math.max(0, TUNE.chainGap - (this.time - this.lastHome)) : 0;
  }

  /** A tap on a column's card, the drawn cards or the pack. Returns what happened (empty if nothing fitted). */
  tap(target: Target): Step[] {
    if (this.over || !this.started || this.phase !== "play") return [];
    const t = this.table;
    const steps = target.kind === "col" ? tapColumn(t, target.col, target.index) : target.kind === "waste" ? tapWaste(t) : tapStock(t);
    this.stats.taps++;
    this.hint = null;
    this.judge = null;
    this.judging = null;
    if (steps.length === 0) {
      this.stats.duds++;
      this.listener.dud?.(target);
      // Nothing in the pack and a tap that fits nowhere: time to ask whether anything still can.
      if (t.stock.length + t.waste.length === 0) this.ask("dead");
      return steps;
    }
    settle(t, steps);
    this.account(steps, true);
    this.listener.steps?.(steps, "tap");
    if (won(t)) this.clear();
    else if (hidden(t) === 0) {
      this.phase = "sweep";
      this.phaseT = 0;
      this.sweepT = 0;
    } else if (this.fruitless > t.stock.length + t.waste.length + 1) {
      // Once through the whole pack and nothing played.
      this.fruitless = 0;
      this.ask("dead");
    }
    return steps;
  }

  /** Scores what happened. Cards sent home by hand buy time; the sweep's do not (the cleared deal does). */
  private account(steps: Step[], byHand: boolean): void {
    const s = this.stats;
    for (const st of steps) {
      if (st.kind === "home") {
        this.chain = this.time - this.lastHome <= TUNE.chainGap ? this.chain + 1 : 1;
        this.lastHome = this.time;
        const before = multOf(this.chain - 1);
        const m = this.mult;
        this.score += TUNE.home * m;
        if (byHand) this.clock = Math.min(TUNE.max, this.clock + TUNE.homeTime);
        s.home++;
        if (this.chain > s.bestChain) s.bestChain = this.chain;
        if (m > s.bestMult) s.bestMult = m;
        if (m > before) this.listener.tier?.(m);
        this.fruitless = 0;
      } else if (st.kind === "flip") {
        this.score += TUNE.flip;
        this.clock = Math.min(TUNE.max, this.clock + TUNE.flipTime);
        s.flips++;
        this.fruitless = 0;
      } else if (st.kind === "build") this.fruitless = 0;
      else if (st.kind === "draw") {
        s.draws++;
        this.fruitless++;
      } else {
        s.turns++;
        this.fruitless++;
      }
    }
  }

  private clear(): void {
    const n = this.level + 1;
    const refund = TUNE.clearTime(this.level);
    const points = TUNE.clear * n + Math.round(this.clock) * TUNE.perSecond;
    this.score += points;
    this.clock = Math.min(TUNE.max, this.clock + refund);
    this.stats.deals++;
    this.phase = "cheer";
    this.phaseT = 0;
    this.listener.cleared?.({ level: this.level, points, refund });
  }

  /** Starts the solver on the table: is it a dead end, or (for a hint) what wins from here? */
  private ask(what: "dead" | "hint"): void {
    this.judging = what;
    this.judge = new Solver(cloneTable(this.table), what === "dead" ? { thorough: true, maxNodes: TUNE.deadNodes } : { maxNodes: TUNE.hintNodes });
  }

  /** Asks for a hint: a tap that is on a winning line. It arrives in `hint` after some thinking. */
  wantHint(): void {
    if (this.phase !== "play" || this.hint || this.judging) return;
    this.ask("hint");
  }

  /**
   * Gives the solver up to `ms` milliseconds. A dead end is announced and the deal dealt afresh; a line found
   * becomes the hint.
   */
  think(ms: number): void {
    const j = this.judge;
    if (!j || this.phase !== "play") return;
    if (!j.pump(ms)) return;
    const what = this.judging;
    this.judge = null;
    this.judging = null;
    if (j.status === "won") this.hint = targetOf(this.table, j.line[0]);
    else if (j.status === "dead" || (what === "dead" && spent(this.table))) {
      this.phase = "afresh";
      this.phaseT = 0;
      this.stats.afresh++;
      this.listener.dead?.();
    }
  }

  /** Keeps the next deals ready: a few milliseconds of dealing per frame. */
  prepare(ms: number): void {
    if (!this.dealer.pump(this.level + 1, 0, ms)) return;
    this.dealer.pump(this.level, this.redeal + 1, ms);
  }

  private lay(level: number, redeal: number, fresh: boolean): void {
    this.level = level;
    this.redeal = redeal;
    this.table = this.dealer.get(level, redeal).table;
    this.phase = "lay";
    this.phaseT = 0;
    this.fruitless = 0;
    this.hint = null;
    this.judge = null;
    this.judging = null;
    this.listener.dealt?.(this.table, level, fresh);
  }

  step(dt: number): void {
    if (!this.started || this.over) return;
    this.time += dt;
    this.stats.seconds = this.time;
    this.phaseT += dt;
    if (this.phase === "lay") {
      if (this.phaseT >= TUNE.lay) {
        this.phase = "play";
        this.phaseT = 0;
      }
      return;
    }
    if (this.phase === "sweep") {
      this.sweepT += dt;
      while (this.sweepT >= TUNE.sweepStep && this.phase === "sweep") {
        this.sweepT -= TUNE.sweepStep;
        const steps: Step[] = [];
        if (sweepOne(this.table, steps)) {
          this.account(steps, false);
          this.listener.steps?.(steps, "sweep");
        }
        if (won(this.table)) this.clear();
      }
      return;
    }
    if (this.phase === "cheer") {
      if (this.phaseT >= TUNE.cheer) this.lay(this.level + 1, 0, false);
      return;
    }
    if (this.phase === "afresh") {
      if (this.phaseT >= TUNE.afresh) this.lay(this.level, this.redeal + 1, true);
      return;
    }
    if (this.chain > 0 && this.time - this.lastHome > TUNE.chainGap) this.chain = 0;
    this.clock -= dt * TUNE.burn(this.time);
    if (this.clock <= 0) {
      this.clock = 0;
      this.over = true;
      this.listener.over?.();
    }
  }
}

/** The tap that makes a solver's move on the real table (a card deep in the pack is reached by tapping the pack). */
export function targetOf(t: Table, m: Move | undefined): Target | null {
  if (!m) return null;
  if (m.k === "home") return { kind: "col", col: m.col, index: t.cols[m.col]!.up.length - 1 };
  if (m.k === "run") return { kind: "col", col: m.from, index: m.index };
  return t.waste[t.waste.length - 1] === m.card ? { kind: "waste" } : { kind: "stock" };
}

/** Nothing at all can be played: no card home, none from the pack onto a column, no run anywhere. */
export function spent(t: Table): boolean {
  const hand: Card[] = [...t.stock, ...t.waste];
  for (const c of hand) {
    if (canHome(t, c)) return false;
    for (let to = 0; to < t.cols.length; to++) if (canBuild(t, c, to)) return false;
  }
  for (let from = 0; from < t.cols.length; from++) {
    const col = t.cols[from]!;
    const n = col.up.length;
    if (n === 0) continue;
    if (canHome(t, col.up[n - 1]!)) return false;
    for (let i = 0; i < n; i++) {
      for (let to = 0; to < t.cols.length; to++) {
        if (to === from || !canBuild(t, col.up[i]!, to)) continue;
        if (t.cols[to]!.up.length === 0 && i === 0 && col.down.length === 0) continue;
        return false;
      }
    }
  }
  return true;
}

export { cardsHome, specOf };
