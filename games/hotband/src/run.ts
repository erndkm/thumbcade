/**
 * One run of Hotband: pieces fall into the meter, a full row is cut, and the run ends when the stack clips the top.
 *
 * Pure and fixed-step (60 ticks a second), so the same seed and the same commands at the same times give the same
 * run on any frame rate. The screen, the pilot and the tests all drive it through `shift`, `rotate`, `slam` and
 * `setSoft`.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { cellsOf, COLS, HIDDEN, KICKS, ROWS, spawnAt, VISIBLE } from "./pieces.ts";
import { clipped, collides, dropRow, fullRows, lit, newWell, NOISE, place, pushNoise, removeRows, type Well } from "./well.ts";

export const TUNE = {
  tick: 1 / 60,
  /** Seconds a piece takes to fall one row at a level. */
  fall: (level: number) => Math.max(0.05, 0.44 * 0.85 ** (level - 1)),
  /** Seconds per row while the finger pulls down. */
  softFall: 0.035,
  /** With no touch for this long, pieces stop waiting: an untouched run ends on its own. */
  idleAfter: 6,
  idleFall: 0.08,
  /** A piece resting on the stack can still be slid or turned for this long; each move starts it again, a few times. */
  lockDelay: 0.42,
  lockResets: 6,
  /** How long a cut row shows before the stack drops. */
  clearPause: 0.3,
  spawnDelay: 0.07,
  rowsPerLevel: 5,
  secondsPerLevel: 13,
  maxLevel: 14,
  /** The noise floor: rows pushed in from below, slowly at first, then faster than anyone can cut them. */
  noiseStart: 24,
  noiseEvery: (t: number) => Math.max(1.2, 7 - (t - 24) * 0.1),
  noiseWarn: 1,
  /** The top rows of the meter are the red. */
  redRows: 5,
  amberRows: 4,
  /** Points for cutting 1, 2 or 3 rows with one piece, before the gain. */
  base: [0, 100, 300, 600] as readonly number[],
  /** Extra per row cut in the red, per noise row cut, and for leaving the meter dark. */
  hot: 100,
  noiseCut: 50,
  silence: 500,
  slamRow: 2,
  /** Rows cut in a chain for gain x2, x3, x4, x5. A chain survives one piece that cuts nothing. */
  tiers: [2, 4, 7, 11] as readonly number[],
  chainGrace: 1,
  /** This early in a run a clipped meter trips the breaker instead of ending it, as long as the player is playing. */
  breakerUntil: 12,
  breakerPause: 0.7,
} as const;

export const GAIN_NAMES = ["", "WARMING UP", "CRANKED", "ROARING", "WIDE OPEN"] as const;
export const CUT_NAMES = ["", "", "DOUBLE CUT", "TRIPLE CUT"] as const;

/** The gain (score multiplier) a chain of this many rows has earned. */
export function gainOf(chain: number): number {
  let g = 1;
  for (const t of TUNE.tiers) if (chain >= t) g++;
  return g;
}

/** Which zone of the meter a row is in: 2 the red, 1 amber, 0 green. */
export function zoneOf(row: number): 0 | 1 | 2 {
  const v = row - HIDDEN;
  return v < TUNE.redRows ? 2 : v < TUNE.redRows + TUNE.amberRows ? 1 : 0;
}

export interface Active {
  kind: number;
  rot: number;
  x: number;
  y: number;
}

export interface CutEvent {
  /** The rows cut, top first. */
  rows: number[];
  /** How many of them were in the red, and how many were noise. */
  hot: number;
  noise: number;
  gain: number;
  chain: number;
  points: number;
  /** The meter is dark once these rows are gone. */
  silence: boolean;
}

export interface LockEvent {
  kind: number;
  /** Indices of the segments it lit. */
  cells: number[];
  /** Rows it was slammed through (0 for a piece that settled). */
  slam: number;
  /** Row it was slammed from. */
  from: number;
}

export interface RunListener {
  spawn?(kind: number): void;
  slide?(steps: number): void;
  turn?(ok: boolean): void;
  land?(): void;
  lock?(e: LockEvent): void;
  cut?(e: CutEvent): void;
  /** The cut rows are gone and the stack has dropped. */
  drop?(rows: number[]): void;
  tier?(gain: number): void;
  chainEnd?(): void;
  level?(level: number): void;
  noiseWarn?(): void;
  noise?(gap: number): void;
  /** The breaker tripped: the meter went dark, and this is what was lit. */
  breaker?(was: Uint8Array): void;
  over?(): void;
}

export interface Stats {
  seconds: number;
  pieces: number;
  rows: number;
  singles: number;
  doubles: number;
  triples: number;
  bestChain: number;
  bestGain: number;
  hot: number;
  silences: number;
  slams: number;
  turns: number;
  slides: number;
  softs: number;
  noisePushed: number;
  noiseCut: number;
  /** Seconds spent with no touch for longer than the idle limit. */
  idle: number;
  /** Times the breaker saved an early run. */
  trips: number;
  /** Lit segments left when the run ended. */
  left: number;
}

const FIRST_BAG = [1, 2, 3, 0, 4, 1, 2];
const BAG = [0, 1, 1, 2, 2, 3, 4, 5, 6];

export class Run {
  readonly well: Well = newWell();
  active: Active | null = null;
  next = 1;
  score = 0;
  level = 1;
  chain = 0;
  time = 0;
  over = false;
  started = false;
  soft = false;
  /** Counts pieces as they arrive, so a watcher can tell a new one from the last. */
  pieceCount = 0;
  /** Rows being cut right now (they stay lit until the pause ends). */
  cutting: number[] | null = null;
  cutT = 0;
  /** Seconds until the next noise row, for the screen's warning. */
  noiseIn = Infinity;
  /** Progress of the piece through its current row, 0-1, for smooth drawing. */
  fallK = 0;
  readonly stats: Stats = {
    seconds: 0, pieces: 0, rows: 0, singles: 0, doubles: 0, triples: 0, bestChain: 0, bestGain: 1, hot: 0, silences: 0,
    slams: 0, turns: 0, slides: 0, softs: 0, noisePushed: 0, noiseCut: 0, idle: 0, trips: 0, left: 0,
  };

  private readonly rng: Rng;
  private queue: number[] = [];
  private acc = 0;
  private fallT = 0;
  private lockT = 0;
  private resets = 0;
  private grounded = false;
  private spawnT = 0;
  private misses = 0;
  private sinceInput = 0;
  private nextNoise: number = TUNE.noiseStart;
  private warned = false;
  private lastGap = -1;
  private acted = false;

  constructor(seed: number, private readonly listener: RunListener = {}) {
    this.rng = createRng(seed);
    this.queue = [...FIRST_BAG];
    this.next = this.queue.shift()!;
  }

  start(): this {
    this.started = true;
    this.spawnT = 0;
    return this;
  }

  get gain(): number {
    return gainOf(this.chain);
  }

  /** Rows still to cut for the next gain tier (0 at the top tier). */
  get toNextTier(): number {
    for (const t of TUNE.tiers) if (this.chain < t) return t - this.chain;
    return 0;
  }

  /** The chain has already survived a piece that cut nothing: the next one has to cut. */
  get chainAtRisk(): boolean {
    return this.chain > 0 && this.misses >= TUNE.chainGrace;
  }

  /** Seconds a row takes right now. */
  interval(): number {
    const base = TUNE.fall(this.level);
    if (this.soft) return Math.min(base, TUNE.softFall);
    if (this.sinceInput > TUNE.idleAfter) return Math.min(base, TUNE.idleFall);
    return base;
  }

  /** Where the piece would come to rest if slammed now. */
  ghostY(): number {
    const a = this.active;
    return a ? dropRow(this.well, a.kind, a.rot, a.x, a.y) : 0;
  }

  /** The tallest lit segment, in rows above the floor (hidden rows included). */
  height(): number {
    for (let i = 0; i < this.well.length; i++) if (this.well[i]) return ROWS - Math.floor(i / COLS);
    return 0;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /** Slides the piece up to `n` bands (negative = left). Returns how many it moved. */
  shift(n: number): number {
    const a = this.active;
    if (!a || this.over || n === 0) return 0;
    const dir = n > 0 ? 1 : -1;
    this.acted = true;
    let done = 0;
    for (let i = 0; i < Math.abs(n); i++) {
      if (collides(this.well, a.kind, a.rot, a.x + dir, a.y)) break;
      a.x += dir;
      done++;
    }
    this.sinceInput = 0;
    if (done) {
      this.stats.slides += done;
      this.touched();
      this.listener.slide?.(done * dir);
    }
    return done ? done * dir : 0;
  }

  /** A quarter turn clockwise, nudged sideways or up a row if it doesn't fit where it is. */
  rotate(): boolean {
    const a = this.active;
    if (!a || this.over) return false;
    this.sinceInput = 0;
    this.acted = true;
    const rot = (a.rot + 1) & 3;
    for (const [kx, ky] of KICKS) {
      if (collides(this.well, a.kind, rot, a.x + kx, a.y + ky)) continue;
      a.rot = rot;
      a.x += kx;
      a.y += ky;
      this.stats.turns++;
      this.touched();
      this.listener.turn?.(true);
      return true;
    }
    this.listener.turn?.(false);
    return false;
  }

  /** Drops the piece straight home and locks it at once. Returns the rows it fell. */
  slam(): number {
    const a = this.active;
    if (!a || this.over) return 0;
    this.sinceInput = 0;
    this.acted = true;
    const from = a.y;
    const d = dropRow(this.well, a.kind, a.rot, a.x, a.y) - a.y;
    a.y += d;
    this.stats.slams++;
    this.lock(d, from);
    return d;
  }

  setSoft(on: boolean): void {
    if (on && !this.soft) {
      this.stats.softs++;
      this.sinceInput = 0;
      this.acted = true;
    }
    this.soft = on;
  }

  /** Any touch counts as attention, even one that moves nothing. */
  poke(): void {
    this.sinceInput = 0;
  }

  // -------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------

  step(dt: number): void {
    if (!this.started || this.over) return;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TUNE.tick - 1e-9 && !this.over) {
      this.acc -= TUNE.tick;
      this.tick();
    }
  }

  private tick(): void {
    const dt = TUNE.tick;
    this.time += dt;
    this.stats.seconds = this.time;
    this.sinceInput += dt;
    if (this.sinceInput > TUNE.idleAfter) this.stats.idle += dt;

    const level = Math.min(TUNE.maxLevel, 1 + Math.max(Math.floor(this.stats.rows / TUNE.rowsPerLevel), Math.floor(this.time / TUNE.secondsPerLevel)));
    if (level > this.level) {
      this.level = level;
      this.listener.level?.(level);
    }

    this.noiseIn = this.nextNoise - this.time;
    if (!this.warned && this.noiseIn <= TUNE.noiseWarn) {
      this.warned = true;
      this.listener.noiseWarn?.();
    }

    if (this.cutting) {
      this.cutT -= dt;
      if (this.cutT <= 0) {
        const rows = this.cutting;
        this.cutting = null;
        removeRows(this.well, rows);
        this.listener.drop?.(rows);
        if (clipped(this.well)) return this.end();
        this.spawnT = TUNE.spawnDelay;
      }
      return;
    }

    if (this.time >= this.nextNoise) {
      this.raiseNoise();
      if (this.over) return;
    }

    const a = this.active;
    if (!a) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) this.spawn();
      return;
    }

    const resting = collides(this.well, a.kind, a.rot, a.x, a.y + 1);
    if (resting) {
      if (!this.grounded) {
        this.grounded = true;
        this.listener.land?.();
      }
      this.fallT = 0;
      this.fallK = 0;
      this.lockT += dt;
      if (this.lockT >= TUNE.lockDelay) this.lock(0, a.y);
      return;
    }
    this.grounded = false;
    const interval = this.interval();
    this.fallT += dt;
    while (this.fallT >= interval && !collides(this.well, a.kind, a.rot, a.x, a.y + 1)) {
      a.y++;
      this.fallT -= interval;
    }
    this.fallK = collides(this.well, a.kind, a.rot, a.x, a.y + 1) ? 0 : Math.min(1, this.fallT / interval);
  }

  private touched(): void {
    if (this.grounded && this.resets < TUNE.lockResets) {
      this.resets++;
      this.lockT = 0;
    }
  }

  private draw(): number {
    if (this.queue.length === 0) this.queue = this.rng.shuffle([...BAG]);
    return this.queue.shift()!;
  }

  private spawn(): void {
    const kind = this.next;
    this.next = this.draw();
    const { x, y } = spawnAt(kind);
    this.active = { kind, rot: 0, x, y };
    this.pieceCount++;
    this.fallT = 0;
    this.fallK = 0;
    this.lockT = 0;
    this.resets = 0;
    this.grounded = false;
    if (collides(this.well, kind, 0, x, y)) {
      this.active = null;
      this.end();
      return;
    }
    this.listener.spawn?.(kind);
  }

  private lock(slam: number, from: number): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.soft = false;
    const cells = place(this.well, a.kind, a.rot, a.x, a.y);
    if (!cells) return this.end();
    this.stats.pieces++;
    this.score += slam * TUNE.slamRow;
    this.listener.lock?.({ kind: a.kind, cells, slam, from });

    const rows = fullRows(this.well);
    if (rows.length === 0) {
      this.misses++;
      if (this.chain > 0 && this.misses > TUNE.chainGrace) {
        this.chain = 0;
        this.listener.chainEnd?.();
      }
      if (clipped(this.well)) return this.end();
      this.spawnT = TUNE.spawnDelay;
      return;
    }

    const n = rows.length;
    const before = this.gain;
    this.misses = 0;
    this.chain += n;
    const gain = this.gain;
    let hot = 0;
    let noise = 0;
    for (const r of rows) {
      if (zoneOf(r) === 2) hot++;
      for (let x = 0; x < COLS; x++) {
        if (this.well[r * COLS + x] === NOISE) {
          noise++;
          break;
        }
      }
    }
    const silence = lit(this.well) === n * COLS;
    const points = (TUNE.base[Math.min(n, 3)]! + hot * TUNE.hot + noise * TUNE.noiseCut + (silence ? TUNE.silence : 0)) * gain;
    this.score += points;
    const s = this.stats;
    s.rows += n;
    if (n === 1) s.singles++;
    else if (n === 2) s.doubles++;
    else s.triples++;
    s.hot += hot;
    s.noiseCut += noise;
    if (silence) s.silences++;
    if (this.chain > s.bestChain) s.bestChain = this.chain;
    if (gain > s.bestGain) s.bestGain = gain;
    this.cutting = rows;
    this.cutT = TUNE.clearPause;
    this.listener.cut?.({ rows, hot, noise, gain, chain: this.chain, points, silence });
    if (gain > before) this.listener.tier?.(gain);
  }

  private raiseNoise(): void {
    let gap = this.rng.int(0, COLS - 1);
    if (gap === this.lastGap) gap = (gap + 1 + this.rng.int(0, COLS - 3)) % COLS;
    this.lastGap = gap;
    const lost = pushNoise(this.well, gap);
    this.stats.noisePushed++;
    this.nextNoise = this.time + TUNE.noiseEvery(this.time);
    this.warned = false;
    const a = this.active;
    if (a && collides(this.well, a.kind, a.rot, a.x, a.y)) a.y--;
    this.listener.noise?.(gap);
    if (lost || clipped(this.well)) this.end();
  }

  private end(): void {
    if (this.over) return;
    if (this.time < TUNE.breakerUntil && this.acted) {
      // Too early to lose a run someone is playing: the breaker trips and the meter starts dark again.
      const was = this.well.slice();
      this.well.fill(0);
      this.active = null;
      this.cutting = null;
      this.chain = 0;
      this.misses = 0;
      this.soft = false;
      this.acted = false;
      this.spawnT = TUNE.breakerPause;
      this.stats.trips++;
      this.listener.breaker?.(was);
      return;
    }
    this.over = true;
    this.active = null;
    this.cutting = null;
    this.stats.left = lit(this.well);
    this.listener.over?.();
  }
}

/** The segments a piece covers on the grid, for the screen. */
export function activeCells(a: Active): Array<[number, number]> {
  return cellsOf(a.kind, a.rot).map(([x, y]) => [a.x + x, a.y + y]);
}

export { VISIBLE };
