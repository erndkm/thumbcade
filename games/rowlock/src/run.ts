/**
 * The rules of a run, with no drawing in them: the game, the attract demo and the headless pilots all drive this.
 *
 * A run is a string of grids against one clock. A right digit scores, and right digits in a row build a streak
 * whose tier multiplies the points. Filling the last key of a row, column or box locks that unit: it rings, pays
 * and gives a little time back, and a digit that locks two or three units at once is a combo. Filling the grid
 * locks it shut and refunds a lot of time while the next grid is dealt. A wrong digit never sticks: the key
 * shakes, the clock loses a few seconds and the streak starts over. The clock is what ends a run.
 */
import { boxOf, candidates, colOf, geometry, popcount, rowOf, type Geometry } from "./grid.ts";
import type { Puzzle } from "./gen.ts";
import { easiest, type Placement } from "./solver.ts";

export const TUNE = {
  /** Seconds on the clock at the first tap, and the most it holds. */
  start: 26,
  max: 45,
  /** Clock seconds burned per real second on grid `i`. */
  drain: (grid: number) => 1 + 0.08 * Math.max(0, grid - 1),
  /** Seconds a wrong digit costs (the warm-up is gentler, and the first seconds of a run gentler still). */
  wrong: (grid: number) => (grid === 0 ? 2 : 3),
  grace: 10,
  graceCost: 1,
  /** Seconds back per unit locked, and for a filled grid. */
  unitBack: 0.45,
  solveBack: (grid: number) => (grid === 0 ? 6 : Math.max(3.5, 6.5 - 0.5 * (grid - 1))),
  /** Points. */
  digit: 10,
  unit: 25,
  /** Bonus for locking two or three units with one digit. */
  combo: [0, 0, 60, 180] as readonly number[],
  solve: (grid: number) => 150 + 100 * grid,
  /** A grid filled without a single wrong digit. */
  clean: 100,
  spark: 50,
  /** Lamps held at most. */
  lampMax: 2,
  /** Idle seconds before the easiest key is nudged, and before pencil marks fade in. */
  nudgeAfter: 4,
  marksAfter: 8,
  /** Phase lengths (s); the clock stands still while a grid is dealt and while a filled grid is celebrated. */
  dealIn: 0.8,
  solvedOut: 1.6,
} as const;

/** Streak tiers: right digits in a row → multiplier ×1..×5, each with its line. */
export const TIERS = [0, 4, 9, 15, 24] as const;
export const TIER_NAMES = ["", "IN STEP", "ON A ROLL", "LOCKED IN", "PERFECT SQUARE"] as const;
export function tierOf(streak: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (streak >= TIERS[i]!) t = i;
  return t;
}
export const multOf = (streak: number): number => tierOf(streak) + 1;
export const COMBO_NAMES = ["", "", "DOUBLE LOCK", "TRIPLE LOCK"] as const;

export type Phase = "deal" | "play" | "solved" | "over";
/** How a digit was entered: key first, digit first (armed), or by a lamp. */
export type Via = "key" | "armed" | "lamp";

export interface RunListener {
  deal?(index: number, p: Puzzle): void;
  place?(cell: number, digit: number, streak: number, points: number, tierUp: boolean, via: Via): void;
  wrong?(cell: number, digit: number, clashes: number[], seconds: number): void;
  lock?(units: number[], points: number, seconds: number, cell: number, final: boolean): void;
  spark?(cell: number, lamp: boolean): void;
  solve?(index: number, points: number, seconds: number, clean: boolean): void;
  lamp?(cell: number, digit: number): void;
  marks?(): void;
  end?(): void;
}

export interface Stats {
  grids: number;
  solved: number;
  digits: number;
  wrong: number;
  locks: number;
  doubles: number;
  triples: number;
  bestStreak: number;
  sparks: number;
  lampsEarned: number;
  lampsUsed: number;
  /** Grids on which the pencil marks came out (the player sat idle for `marksAfter`). */
  marked: number;
  /** Times the idle nudge showed. */
  nudges: number;
  armed: number;
  keyFirst: number;
  /** Seconds the run lasted (real time). */
  seconds: number;
  /** Wrong digits that clashed with a digit already in its row, column or box. */
  clashes: number;
}

export type PlaceResult =
  | { ok: false }
  | { ok: true; right: true; units: number[]; solved: boolean }
  | { ok: true; right: false; clashes: number[] };

export type GridSource = (index: number) => Puzzle;

export class Run {
  phase: Phase = "deal";
  phaseT = 0;
  clock: number = TUNE.start;
  score = 0;
  streak = 0;
  index = 0;
  lamps = 0;
  puzzle!: Puzzle;
  g!: Geometry;
  values!: Int8Array;
  /** Units locked on this grid. */
  locked = new Set<number>();
  /** Wrong digits on this grid. */
  slips = 0;
  /** Play seconds since the last right digit (or since the grid was dealt). */
  idle = 0;
  /** Seconds of play in this run (the clock running). */
  played = 0;
  /** Pencil marks are out on this grid. */
  marks = false;
  /** Keys filled by a lamp on this grid. */
  lit = new Set<number>();
  readonly stats: Stats = {
    grids: 0,
    solved: 0,
    digits: 0,
    wrong: 0,
    locks: 0,
    doubles: 0,
    triples: 0,
    bestStreak: 0,
    sparks: 0,
    lampsEarned: 0,
    lampsUsed: 0,
    marked: 0,
    nudges: 0,
    armed: 0,
    keyFirst: 0,
    seconds: 0,
    clashes: 0,
  };
  private nudged = false;
  private hint: { at: Int8Array | null; p: Placement | null } = { at: null, p: null };

  constructor(
    private source: GridSource,
    private listener: RunListener = {},
  ) {}

  /** Deals the first grid. */
  start(): this {
    this.begin(0);
    return this;
  }

  private begin(index: number): void {
    this.index = index;
    this.puzzle = this.source(index);
    this.g = geometry(this.puzzle.shape);
    this.values = Int8Array.from(this.puzzle.givens);
    this.locked = new Set();
    for (let u = 0; u < this.g.units.length; u++) if (this.g.units[u]!.every((i) => this.values[i])) this.locked.add(u);
    this.lit = new Set();
    this.slips = 0;
    this.idle = 0;
    this.marks = false;
    this.nudged = false;
    this.hint = { at: null, p: null };
    this.phase = "deal";
    this.phaseT = 0;
    this.stats.grids++;
    this.listener.deal?.(index, this.puzzle);
  }

  get n(): number {
    return this.puzzle.shape.n;
  }
  get mult(): number {
    return multOf(this.streak);
  }
  get over(): boolean {
    return this.phase === "over";
  }
  get given(): Int8Array {
    return this.puzzle.givens;
  }
  /** How many of digit `d` are on the grid. */
  count(d: number): number {
    let c = 0;
    for (let i = 0; i < this.values.length; i++) if (this.values[i] === d) c++;
    return c;
  }
  /** True when all n of digit `d` are placed. */
  done(d: number): boolean {
    return this.count(d) >= this.n;
  }
  /** The easiest move on the board (the idle nudge), cached per position. */
  nudge(): Placement | null {
    if (this.phase !== "play") return null;
    if (this.hint.at && this.hint.at.every((v, i) => v === this.values[i])) return this.hint.p;
    this.hint = { at: Int8Array.from(this.values), p: easiest(this.g, this.values) };
    return this.hint.p;
  }
  /** The nudge is showing (idle long enough). */
  get nudging(): boolean {
    return this.phase === "play" && this.idle >= TUNE.nudgeAfter;
  }
  /** Peers of `cell` that already hold `digit`. */
  clashesOf(cell: number, digit: number): number[] {
    return this.g.peers[cell]!.filter((p) => this.values[p] === digit);
  }

  /** Advances time by dt real seconds. */
  step(dt: number): void {
    if (this.phase === "over") return;
    this.stats.seconds += dt;
    this.phaseT += dt;
    if (this.phase === "play") {
      this.idle += dt;
      this.played += dt;
      if (!this.nudged && this.idle >= TUNE.nudgeAfter) {
        this.nudged = true;
        this.stats.nudges++;
      }
      if (!this.marks && this.idle >= TUNE.marksAfter) {
        this.marks = true;
        this.stats.marked++;
        this.listener.marks?.();
      }
      this.clock -= TUNE.drain(this.index) * dt;
      if (this.clock <= 0) {
        this.clock = 0;
        this.phase = "over";
        this.phaseT = 0;
        this.listener.end?.();
        return;
      }
    }
    if (this.phase === "deal" && this.phaseT >= TUNE.dealIn) {
      this.phase = "play";
      this.phaseT = 0;
    } else if (this.phase === "solved" && this.phaseT >= TUNE.solvedOut) this.begin(this.index + 1);
  }

  /** Enters `digit` in `cell`. Filled keys and other phases are refused (ok: false) and change nothing. */
  place(cell: number, digit: number, via: Via = "key"): PlaceResult {
    if (this.phase !== "play" || this.values[cell] !== 0 || digit < 1 || digit > this.n) return { ok: false };
    if (this.puzzle.solution[cell] !== digit) {
      const clashes = this.clashesOf(cell, digit);
      const secs = this.played < TUNE.grace ? TUNE.graceCost : TUNE.wrong(this.index);
      this.streak = 0;
      this.slips++;
      this.stats.wrong++;
      if (clashes.length) this.stats.clashes++;
      this.clock = Math.max(0, this.clock - secs);
      this.listener.wrong?.(cell, digit, clashes, secs);
      if (this.clock <= 0) {
        this.phase = "over";
        this.phaseT = 0;
        this.listener.end?.();
      }
      return { ok: true, right: false, clashes };
    }
    const tierBefore = tierOf(this.streak);
    this.values[cell] = digit;
    this.idle = 0;
    this.nudged = false;
    if (via === "lamp") {
      this.lit.add(cell);
      this.stats.lampsUsed++;
      this.listener.lamp?.(cell, digit);
    } else {
      this.streak++;
      this.stats.digits++;
      if (via === "armed") this.stats.armed++;
      else this.stats.keyFirst++;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
      const pts = TUNE.digit * this.mult;
      this.score += pts;
      this.listener.place?.(cell, digit, this.streak, pts, tierOf(this.streak) > tierBefore, via);
    }
    if (cell === this.puzzle.spark && via !== "lamp") {
      this.stats.sparks++;
      this.score += TUNE.spark;
      const lamp = this.earnLamp();
      this.listener.spark?.(cell, lamp);
    }
    // Units this digit finished.
    const units = this.g.unitsOf[cell]!.filter((u) => !this.locked.has(u) && this.g.units[u]!.every((i) => this.values[i]));
    const solved = this.values.every((v) => v !== 0);
    if (units.length) {
      for (const u of units) this.locked.add(u);
      this.stats.locks += units.length;
      if (units.length === 2) this.stats.doubles++;
      if (units.length === 3) this.stats.triples++;
      const pts = TUNE.unit * units.length * this.mult + TUNE.combo[units.length]!;
      const secs = TUNE.unitBack * units.length;
      this.score += pts;
      this.addClock(secs);
      // Three units with one digit before the last key: that is worth a lamp.
      if (units.length === 3 && !solved) this.earnLamp();
      this.listener.lock?.(units, pts, secs, cell, solved);
    }
    if (solved) {
      const clean = this.slips === 0;
      const pts = TUNE.solve(this.index) + (clean ? TUNE.clean : 0);
      const secs = TUNE.solveBack(this.index);
      this.score += pts;
      this.addClock(secs);
      this.stats.solved++;
      this.phase = "solved";
      this.phaseT = 0;
      this.listener.solve?.(this.index, pts, secs, clean);
    }
    return { ok: true, right: true, units, solved };
  }

  /**
   * Lights a key with its digit: `cell` if it is empty, else the key that is hardest to read right now (the most
   * digits still fit it). Costs one lamp; never breaks or builds the streak.
   */
  lamp(cell: number | null = null): number | null {
    if (this.phase !== "play" || this.lamps <= 0) return null;
    let target = cell !== null && this.values[cell] === 0 ? cell : -1;
    if (target < 0) {
      const c = candidates(this.g, this.values);
      let most = -1;
      for (let i = 0; i < this.values.length; i++) {
        if (this.values[i]) continue;
        const k = popcount(c[i]!);
        if (k > most) {
          most = k;
          target = i;
        }
      }
    }
    if (target < 0) return null;
    this.lamps--;
    this.place(target, this.puzzle.solution[target]!, "lamp");
    return target;
  }

  private earnLamp(): boolean {
    if (this.lamps >= TUNE.lampMax) return false;
    this.lamps++;
    this.stats.lampsEarned++;
    return true;
  }

  private addClock(s: number): void {
    this.clock = Math.min(TUNE.max, this.clock + s);
  }
}

/** Where a unit sits, for drawing: its kind and index along that kind. */
export function unitPlace(g: Geometry, u: number): { kind: "row" | "col" | "box"; i: number } {
  const n = g.shape.n;
  return u < n ? { kind: "row", i: u } : u < 2 * n ? { kind: "col", i: u - n } : { kind: "box", i: u - 2 * n };
}

export { boxOf, colOf, rowOf };
