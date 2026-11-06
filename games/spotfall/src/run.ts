/**
 * One run of Spotfall, time-stepped and pure (no DOM): the ink queue, the shot in flight, what a landing pops and drops,
 * the score, combos and specials, and the press that feeds a new row in at the top.
 *
 * The press has one meter. A shot that pops nothing fills a fifth of it (a quarter later, a third late in a run), and
 * time fills it slowly while you shoot and quickly once you stop: idle for four seconds and it starts to hurry. When the
 * meter is full and no shot is in flight, the press feeds a row and every dot moves down. A dot left past the line jams
 * the press and ends the run.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { BLAST, Board, BOMB, COLS, EMPTY, INKS, LIMIT, WILD, type Cell, type Trace } from "./board.ts";

/** Shot speed, board units per second (a dot is one unit). */
export const SPEED = 26;
/** Rows on a fresh sheet. */
export const START_ROWS = 6;
/** Rows fed in after a clean sheet. */
export const CLEAN_ROWS = 5;
/** Seconds without a shot before the press starts to hurry, and how long the hurry takes to reach full speed. */
export const IDLE_GRACE = 4;
export const IDLE_RAMP = 4;
/** Seconds per row while hurrying (on top of the normal rate). */
export const IDLE_ROW_S = 2.2;
/** A drop this big earns a registration mark (wild), this big an ink blot. */
export const WILD_DROP = 6;
export const BOMB_DROP = 10;
/** Every this many popping shots in a row earns a registration mark. */
export const COMBO_WILD = 5;
/** Every shot moves the press on a tenth of a row, popping or not; a miss adds 1 / missesPerFeed on top. */
export const SHOT_FILL = 0.1;

export interface Dot extends Cell {
  kind: number;
  /** Centre in board units, taken before the dot left the sheet. */
  x: number;
  y: number;
}

export type FeedWhy = "time" | "miss" | "clean" | "start";

export type RunEvent =
  | { k: "fire"; kind: number; angle: number; trace: Trace }
  | { k: "land"; dot: Dot; bounces: number }
  | { k: "pop"; dots: Dot[]; points: number; combo: number; mult: number; how: "match" | "wild" | "bomb"; at: Dot }
  | { k: "drop"; dots: Dot[]; points: number[]; total: number; mult: number }
  | { k: "miss"; meter: number }
  | { k: "earn"; special: number; why: "drop" | "combo" }
  | { k: "feed"; why: FeedWhy; rows: number }
  | { k: "clean"; bonus: number }
  | { k: "swap" }
  | { k: "danger"; on: boolean }
  | { k: "over" };

export interface RunStats {
  shots: number;
  popShots: number;
  popped: number;
  dropped: number;
  biggestDrop: number;
  bestCombo: number;
  banks: number;
  swaps: number;
  specials: number;
  cleans: number;
  feedsTime: number;
  feedsMiss: number;
  bestShot: number;
}

export interface RunOptions {
  /** The attract demo: the press is patient and never hurries. */
  demo?: boolean;
}

export interface Settled {
  popped: Dot[];
  dropped: Dot[];
  how: "match" | "wild" | "bomb" | "none";
  /** What the landed dot is now (a registration mark takes the ink it matched). */
  kind: number;
}

const dotAt = (b: Board, c: Cell, kind: number): Dot => ({ r: c.r, c: c.c, kind, x: b.cx(c.r, c.c), y: b.cy(c.r) });

/**
 * Lands a dot of `kind` in `cell` and resolves it on `board` (mutated): an ink blot bursts everything within reach, a
 * registration mark joins the biggest group next to it, any other ink pops when it makes a group of three or more;
 * then every dot no longer hanging from the press drops.
 */
export function settle(board: Board, cell: Cell, kind: number): Settled {
  board.set(cell.r, cell.c, kind);
  let popped: Cell[] = [];
  let how: Settled["how"] = "none";
  let now = kind;
  if (kind === BOMB) {
    popped = board.around(cell.r, cell.c, BLAST);
    how = "bomb";
  } else if (kind === WILD) {
    let best: Cell[] = [];
    let bestKind = -1;
    const seen = new Set<number>();
    for (const n of board.neighbors(cell.r, cell.c)) {
      const k = board.get(n.r, n.c);
      if (k < 0 || k >= INKS || seen.has(k)) continue;
      seen.add(k);
      const g = board.group(cell.r, cell.c, k);
      if (g.length > best.length) {
        best = g;
        bestKind = k;
      }
    }
    now = bestKind >= 0 ? bestKind : 0;
    if (best.length >= 3) {
      popped = best;
      how = "wild";
    } else board.set(cell.r, cell.c, now);
  } else {
    const g = board.group(cell.r, cell.c, kind);
    if (g.length >= 3) {
      popped = g;
      how = "match";
    }
  }
  const poppedDots = popped.map((p) => dotAt(board, p, board.get(p.r, p.c) === WILD ? now : board.get(p.r, p.c)));
  for (const p of popped) board.set(p.r, p.c, EMPTY);
  const droppedDots = popped.length ? board.floating().map((p) => dotAt(board, p, board.get(p.r, p.c))) : [];
  for (const d of droppedDots) board.set(d.r, d.c, EMPTY);
  return { popped: poppedDots, dropped: droppedDots, how, kind: now };
}

/** Inks in play this far into a run: four to start, a fifth at 12 s, the sixth at 35 s. */
export function paletteAt(time: number): number {
  return 4 + (time >= 12 ? 1 : 0) + (time >= 35 ? 1 : 0);
}

/** Misses per press: four early, three from 30 s, two from 60 s. */
export function missesPerFeed(time: number): number {
  return time < 30 ? 4 : time < 60 ? 3 : 2;
}

/** Seconds per row from time alone while you keep shooting: 10 at the start, 3 by 70 s, 1.2 by 92 s. */
export function rowSeconds(time: number): number {
  return time < 70 ? 10 - (7 * time) / 70 : Math.max(1.2, 3 - (time - 70) / 12);
}

/** The first seconds of a run feed at most one row, whatever happens. */
export const WARMUP = 10;

/** Combo multiplier: ×1, ×1.5, ×2 … capped at ×5. */
export function comboMult(combo: number): number {
  return Math.min(5, 1 + 0.5 * Math.max(0, combo - 1));
}

/** Points for the i-th dot (1-based) of a drop before the combo multiplier: 20, 40, 60 … */
export const dropPoints = (i: number): number => 20 * i;

/** Per-run seed from the launch seed and the run number, never from how long the demo ran. */
export function runSeed(seed: number, run: number): number {
  return (Math.imul(seed >>> 0 || 1, 2654435761) ^ Math.imul(run + 1, 40503)) >>> 0;
}

export class Run {
  readonly board = new Board();
  readonly rng: Rng;
  readonly demo: boolean;
  time = 0;
  phase: "play" | "over" = "play";
  score = 0;
  current = 0;
  next = 0;
  /** Specials earned while the next slot already held one. */
  queued: number[] = [];
  shot: { kind: number; angle: number; trace: Trace; t: number; dur: number } | null = null;
  meter = 0;
  /** Rows the press has fed this run (clean sheets aside). */
  feeds = 0;
  /** What last filled the meter (for the post-run tip). */
  lastFill: "time" | "miss" = "time";
  sinceShot = 0;
  combo = 0;
  danger = false;
  events: RunEvent[] = [];
  readonly stats: RunStats = {
    shots: 0,
    popShots: 0,
    popped: 0,
    dropped: 0,
    biggestDrop: 0,
    bestCombo: 0,
    banks: 0,
    swaps: 0,
    specials: 0,
    cleans: 0,
    feedsTime: 0,
    feedsMiss: 0,
    bestShot: 0,
  };

  constructor(seed: number, o: RunOptions = {}) {
    this.rng = createRng(seed);
    this.demo = o.demo ?? false;
    for (let i = 0; i < START_ROWS; i++) this.board.feed(this.newRow());
    this.current = this.pick();
    this.next = this.pick();
  }

  get palette(): number {
    return paletteAt(this.time);
  }

  /** Can fire now. */
  get loaded(): boolean {
    return this.phase === "play" && this.shot === null;
  }

  /** Meter fill per second right now. */
  fillRate(): number {
    const base = 1 / rowSeconds(this.time);
    if (this.demo) return base * 0.55;
    const hurry = Math.min(1, Math.max(0, (this.sinceShot - IDLE_GRACE) / IDLE_RAMP));
    return base + hurry / IDLE_ROW_S;
  }

  /** True while the press is hurrying an idle player. */
  get hurrying(): boolean {
    return !this.demo && this.sinceShot > IDLE_GRACE && this.phase === "play";
  }

  fire(angle: number): Trace | null {
    if (!this.loaded) return null;
    const kind = this.current;
    const trace = this.board.trace(angle);
    this.shot = { kind, angle, trace, t: 0, dur: trace.length / SPEED };
    this.current = this.next;
    this.next = this.queued.shift() ?? this.pick();
    this.sinceShot = 0;
    this.stats.shots++;
    if (trace.bounces > 0) this.stats.banks++;
    this.events.push({ k: "fire", kind, angle, trace });
    return trace;
  }

  swap(): boolean {
    if (this.phase !== "play" || this.current === this.next) return false;
    [this.current, this.next] = [this.next, this.current];
    this.stats.swaps++;
    this.events.push({ k: "swap" });
    return true;
  }

  step(dt: number): void {
    if (this.phase !== "play") return;
    this.time += dt;
    this.sinceShot += dt;
    if (this.shot) {
      this.shot.t += dt;
      if (this.shot.t >= this.shot.dur) this.land();
      if (this.phase !== "play") return;
    }
    const before = this.meter;
    this.meter += this.fillRate() * dt;
    if (before < 1 && this.meter >= 1) this.lastFill = "time";
    if (this.time < WARMUP && this.feeds >= 1) this.meter = Math.min(this.meter, 0.999);
    if (this.meter >= 1 && !this.shot) {
      this.feeds++;
      this.meter -= 1;
      const why = this.lastFill;
      if (why === "miss") this.stats.feedsMiss++;
      else this.stats.feedsTime++;
      this.feedRows(1, why);
    }
  }

  private land(): void {
    const s = this.shot!;
    this.shot = null;
    const cell = s.trace.cell;
    const res = settle(this.board, cell, s.kind);
    this.fill(SHOT_FILL);
    const at = dotAt(this.board, cell, res.kind);
    this.events.push({ k: "land", dot: { ...at, kind: s.kind }, bounces: s.trace.bounces });
    if (res.popped.length) {
      this.combo++;
      this.stats.popShots++;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
      const mult = comboMult(this.combo);
      const popPts = Math.round(10 * res.popped.length * mult);
      this.score += popPts;
      this.stats.popped += res.popped.length;
      this.events.push({ k: "pop", dots: res.popped, points: popPts, combo: this.combo, mult, how: res.how as "match" | "wild" | "bomb", at });
      let shotPts = popPts;
      if (res.dropped.length) {
        const pts = res.dropped.map((_, i) => Math.round(dropPoints(i + 1) * mult));
        const total = pts.reduce((a, b) => a + b, 0);
        this.score += total;
        shotPts += total;
        this.stats.dropped += res.dropped.length;
        this.stats.biggestDrop = Math.max(this.stats.biggestDrop, res.dropped.length);
        this.events.push({ k: "drop", dots: res.dropped, points: pts, total, mult });
        if (res.dropped.length >= BOMB_DROP) this.earn(BOMB, "drop");
        else if (res.dropped.length >= WILD_DROP) this.earn(WILD, "drop");
      }
      this.stats.bestShot = Math.max(this.stats.bestShot, shotPts);
      if (this.combo % COMBO_WILD === 0) this.earn(WILD, "combo");
      if (this.board.count() === 0) {
        const bonus = 1000 + 250 * this.stats.cleans;
        this.score += bonus;
        this.stats.cleans++;
        this.events.push({ k: "clean", bonus });
        this.feedRows(CLEAN_ROWS, "clean");
      }
    } else {
      this.combo = 0;
      this.fill(1 / missesPerFeed(this.time));
      this.events.push({ k: "miss", meter: this.meter });
    }
    // An ink that left the sheet is no use in the queue.
    const inks = this.board.inks();
    if (inks.length) {
      if (this.next < INKS && !inks.includes(this.next)) this.next = this.pick();
      if (this.current < INKS && !inks.includes(this.current)) this.current = this.pick();
    }
    this.checkJam();
  }

  private fill(amount: number): void {
    const before = this.meter;
    this.meter += amount;
    if (before < 1 && this.meter >= 1) this.lastFill = "miss";
  }

  private earn(special: number, why: "drop" | "combo"): void {
    this.stats.specials++;
    if (this.next < INKS) this.next = special;
    else this.queued.push(special);
    this.events.push({ k: "earn", special, why });
  }

  private feedRows(n: number, why: FeedWhy): void {
    for (let i = 0; i < n; i++) this.board.feed(this.newRow());
    this.events.push({ k: "feed", why, rows: n });
    this.checkJam();
  }

  private checkJam(): void {
    const low = this.board.lowest();
    if (low >= LIMIT) {
      this.phase = "over";
      this.events.push({ k: "over" });
      return;
    }
    const danger = low >= LIMIT - 2;
    if (danger !== this.danger) {
      this.danger = danger;
      this.events.push({ k: "danger", on: danger });
    }
  }

  /** The next ink to load: one that's on the sheet (any ink of the palette on a clean sheet). */
  private pick(): number {
    const inks = this.board.inks();
    if (!inks.length) return this.rng.int(0, this.palette - 1);
    return this.rng.pick(inks);
  }

  /** A fresh row: runs of the same ink along the row and down from the row below, so groups are there to find. */
  private newRow(): number[] {
    const n = this.palette;
    const row: number[] = [];
    const below = this.board;
    for (let c = 0; c < COLS; c++) {
      const under = below.get(0, c);
      const roll = this.rng();
      if (c > 0 && roll < 0.28) row.push(row[c - 1]!);
      else if (under >= 0 && under < INKS && under < n && roll < 0.44) row.push(under);
      else row.push(this.rng.int(0, n - 1));
    }
    return row;
  }
}
