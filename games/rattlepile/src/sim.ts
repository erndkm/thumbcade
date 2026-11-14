/**
 * Rattlepile's rules, pure and deterministic: a pile of numbered toy blocks creeps down the play mat one row a
 * volley, and every volley is one aimed stream of marbles that rattles around until each marble drops back to the
 * floor. A block's number is the knocks it still takes.
 *
 * Everything runs on fixed ticks (240 a second), so a volley is a pure function of the pile and the angle and a
 * run plays out the same at 30, 60 or 120 frames a second. Units are logical px, y down.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const COLS = 7;
/** Row 0 is headroom above the pile; blocks live in rows 1..ROWS-1. */
export const ROWS = 9;
export const CELL = 50;
export const W = COLS * CELL;
export const PILE_H = ROWS * CELL;
/** The floor the marbles land on, a little under the last row. */
export const FLOOR = PILE_H + 46;
export const R = 7;
export const SPEED = 780;
export const HZ = 240;
const H = 1 / HZ;
/** One marble every 1/15 s; a big bag fires faster, so the whole stream is out in about a second and a half. */
export const FIRE_TICKS = 16;
export const fireTicks = (marbles: number): number => Math.max(7, Math.min(FIRE_TICKS, Math.round((1.5 * HZ) / Math.max(1, marbles))));
/** The shallowest shot: this many radians above the floor. */
export const MIN_ELEV = 0.16;
export const START_MARBLES = 4;
/** The cannon keeps this far from the mat's sides. */
export const LAUNCH_MARGIN = 24;
export const MAX_MARBLES = 60;
/** Volley seconds (in physics time) after which the stream speeds up, twice, and is then called home. */
export const FAST_AT = 2.5;
export const FASTER_AT = 4.5;
export const RECALL_AT = 8.5;
export const FAST = 1.6;
export const FASTER = 2.4;
/** Seconds a thumb may dawdle before the pile creeps a row by itself, and between creeps after that. */
export const CREEP_FIRST = 7;
export const CREEP_NEXT = 1.9;
const SETTLE_TICKS = Math.round(0.2 * HZ);
export const ADVANCE_TICKS = Math.round(0.3 * HZ);
/** Volleys in a row with at least one smash for ×2, ×3, ×4. */
export const STREAK_TIERS = [3, 6, 10] as const;
export const CHAIN_CAP = 12;
const PLUS_R = 12;
const ZAP_R = 13;

export const EMPTY = 0;
export const BLOCK = 1;
export const PLUS = 2;
export const ZAP = 3;

export type Phase = "aim" | "volley" | "settle" | "advance" | "over";

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Called home: falls straight through everything. */
  ghost: boolean;
  /** The zapper this marble is inside right now (cell id), so one pass fires it once. */
  zapIn: number;
}

export type SimEvent =
  | { k: "fire"; x: number; y: number; n: number; left: number }
  | { k: "wall"; x: number; y: number }
  | { k: "hit"; x: number; y: number; c: number; r: number; hp: number; zap: boolean }
  | { k: "smash"; x: number; y: number; c: number; r: number; max: number; pts: number; chain: number; close: boolean; zap: boolean }
  | { k: "plus"; x: number; y: number }
  | { k: "zap"; x: number; y: number; c: number; r: number }
  | { k: "land"; x: number; first: boolean }
  | { k: "speed"; scale: number }
  | { k: "recall" }
  | { k: "volleyEnd"; smashes: number; chain: number; hits: number; pts: number; gained: number }
  | { k: "sweep"; pts: number }
  | { k: "streak"; streak: number; mult: number; up: boolean }
  | { k: "streakLost"; mult: number }
  | { k: "advance"; turn: number; creep: boolean }
  | { k: "danger"; level: 1 | 2 }
  | { k: "over"; cols: number[] };

export interface Stats {
  volleys: number;
  hits: number;
  smashes: number;
  maxChain: number;
  bestVolley: number;
  sweeps: number;
  plus: number;
  plusMissed: number;
  zaps: number;
  creeps: number;
  closeCalls: number;
  maxMult: number;
  /** Volleys that smashed nothing. */
  duds: number;
  /** Sum over volleys of the launch elevation in radians (for the average). */
  elevSum: number;
}

/** Knocks a fresh block takes on `turn`, before its own spread. */
export function hpBase(turn: number): number {
  return Math.max(1, Math.round(turn * (1 + turn * 0.17)));
}

/** Clamps a direction to a legal shot (always upward, never flatter than MIN_ELEV). Returns a unit vector. */
export function clampAim(dx: number, dy: number): [number, number] {
  let a = Math.atan2(-dy, dx);
  if (a < 0) a = dx >= 0 ? 0 : Math.PI;
  a = Math.min(Math.PI - MIN_ELEV, Math.max(MIN_ELEV, a));
  return [Math.cos(a), -Math.sin(a)];
}

export const multFor = (streak: number): number => 1 + STREAK_TIERS.filter((t) => streak >= t).length;

export class Sim {
  readonly kind = new Uint8Array(ROWS * COLS);
  readonly hp = new Int16Array(ROWS * COLS);
  readonly max = new Int16Array(ROWS * COLS);
  readonly ids = new Int32Array(ROWS * COLS);
  /** Tick of the last knock on each cell (for the wobble). */
  readonly hitAt = new Int32Array(ROWS * COLS).fill(-9999);
  /** Zappers that fired this volley (they leave when it ends). */
  private readonly spent = new Uint8Array(ROWS * COLS);

  balls: Ball[] = [];
  events: SimEvent[] = [];
  phase: Phase = "aim";
  /** Rows the pile has come down so far (1 on the first volley). */
  turn = 0;
  marbles = START_MARBLES;
  /** Marbles won this volley; they join the stream when it ends. */
  gained = 0;
  score = 0;
  streak = 0;
  launcherX = W / 2;
  aimX = 0;
  aimY = -1;
  /** Real ticks since the run began. */
  tick = 0;
  /** Physics ticks into this volley. */
  vt = 0;
  /** Ticks into the current settle / advance / aim phase. */
  pt = 0;
  scale = 1;
  toFire = 0;
  /** Smashes so far in this volley. */
  chain = 0;
  volleyHits = 0;
  volleyPts = 0;
  /** True once the pile has crept by itself and until the next shot: the creeps come quickly now. */
  creeping = false;
  readonly stats: Stats = { volleys: 0, hits: 0, smashes: 0, maxChain: 0, bestVolley: 0, sweeps: 0, plus: 0, plusMissed: 0, zaps: 0, creeps: 0, closeCalls: 0, maxMult: 1, duds: 0, elevSum: 0 };

  private readonly rng: Rng;
  private readonly demo: boolean;
  private acc = 0;
  private phys = 0;
  private nextId = 1;
  private firstLand = -1;
  private readonly struck: number[] = [];

  constructor(o: { seed: number; demo?: boolean }) {
    this.rng = createRng(o.seed);
    this.demo = !!o.demo;
    // Three rows to open with, so the first stream has something to rattle between.
    this.spawnRow(2);
    this.shiftDown();
    this.spawnRow(1);
    this.shiftDown();
    this.spawnRow(1);
    this.turn = 1;
  }

  get t(): number {
    return this.tick / HZ;
  }
  get over(): boolean {
    return this.phase === "over";
  }
  get mult(): number {
    return multFor(this.streak);
  }
  /** 0-1: how close the pile is to creeping by itself (aim phase only). */
  get creepFrac(): number {
    if (this.phase !== "aim" || this.demo) return 0;
    return Math.min(1, this.pt / ((this.creeping ? CREEP_NEXT : CREEP_FIRST) * HZ));
  }
  /** The lowest row that holds a block (0 when the mat is clear). */
  get lowestRow(): number {
    for (let r = ROWS - 1; r >= 1; r--) for (let c = 0; c < COLS; c++) if (this.kind[r * COLS + c] === BLOCK) return r;
    return 0;
  }
  get blocksLeft(): number {
    let n = 0;
    for (let i = 0; i < this.kind.length; i++) if (this.kind[i] === BLOCK) n++;
    return n;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The pile
  // -------------------------------------------------------------------------------------------------------------

  /** Fills row 1 for `turn`: 2-6 blocks (never a full row), usually a +1 marble, now and then a zapper. */
  private spawnRow(turn: number): void {
    const rng = this.rng;
    const base = hpBase(turn);
    const lo = turn < 4 ? 2 : turn < 9 ? 3 : 4;
    const hi = turn < 4 ? 4 : turn < 9 ? 5 : 6;
    const n = rng.int(lo, hi);
    const cols = rng.shuffle([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < n; i++) {
      const c = cols[i]!;
      let hp = Math.max(1, Math.round(base * rng.pick([0.6, 0.8, 1, 1, 1.2])));
      if (turn > 3 && rng.chance(0.12)) hp *= 2;
      this.put(COLS + c, BLOCK, hp);
    }
    let free = n;
    if (turn <= 8 || rng.chance(0.85)) this.put(COLS + cols[free++]!, PLUS, 0);
    if (turn >= 3 && free < COLS && rng.chance(0.22)) this.put(COLS + cols[free]!, ZAP, 0);
  }

  /** Sets one square (the dealer's own tool; the tests build piles with it too). */
  put(i: number, kind: number, hp: number): void {
    this.kind[i] = kind;
    this.hp[i] = hp;
    this.max[i] = hp;
    this.ids[i] = this.nextId++;
    this.hitAt[i] = -9999;
    this.spent[i] = 0;
  }

  /** Empties the whole mat. */
  clear(): void {
    for (let i = 0; i < this.kind.length; i++) this.clearCell(i);
  }

  private clearCell(i: number): void {
    this.kind[i] = EMPTY;
    this.hp[i] = 0;
    this.max[i] = 0;
    this.spent[i] = 0;
  }

  private shiftDown(): void {
    const n = ROWS * COLS;
    // A +1 or a zapper that reaches the floor is simply gone.
    for (let c = 0; c < COLS; c++) if (this.kind[n - COLS + c] === PLUS) this.stats.plusMissed++;
    for (const a of [this.kind, this.hp, this.max, this.ids, this.hitAt, this.spent]) {
      a.copyWithin(COLS, 0, n - COLS);
      a.fill(0, 0, COLS);
    }
    this.hitAt.fill(-9999, 0, COLS);
  }

  /** The pile comes down a row (after a volley, or by itself when the thumb dawdles). */
  private comeDown(creep: boolean): void {
    const doomed: number[] = [];
    for (let c = 0; c < COLS; c++) if (this.kind[(ROWS - 1) * COLS + c] === BLOCK) doomed.push(c);
    if (doomed.length) {
      this.phase = "over";
      this.pt = 0;
      this.events.push({ k: "over", cols: doomed });
      return;
    }
    this.shiftDown();
    this.turn++;
    this.spawnRow(this.turn);
    this.phase = "advance";
    this.pt = 0;
    this.events.push({ k: "advance", turn: this.turn, creep });
    const low = this.lowestRow;
    if (low >= ROWS - 1) this.events.push({ k: "danger", level: 2 });
    else if (low === ROWS - 2) this.events.push({ k: "danger", level: 1 });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Shots
  // -------------------------------------------------------------------------------------------------------------

  /** Fires the stream along (dx, dy). Only in the aim phase. */
  fire(dx: number, dy: number): boolean {
    if (this.phase !== "aim") return false;
    [this.aimX, this.aimY] = clampAim(dx, dy);
    this.phase = "volley";
    this.vt = 0;
    this.phys = 0;
    this.scale = 1;
    this.toFire = this.marbles;
    this.chain = 0;
    this.volleyHits = 0;
    this.volleyPts = 0;
    this.gained = 0;
    this.firstLand = -1;
    this.creeping = false;
    this.stats.volleys++;
    this.stats.elevSum += Math.atan2(-this.aimY, Math.abs(this.aimX));
    return true;
  }

  step(dt: number): void {
    this.acc += dt;
    // The hair's breadth keeps 1/30 s at exactly eight ticks whatever the float rounding.
    while (this.acc >= H - 1e-9) {
      this.acc -= H;
      this.realTick();
    }
  }

  private realTick(): void {
    this.tick++;
    switch (this.phase) {
      case "aim":
        this.pt++;
        if (!this.demo && this.pt >= (this.creeping ? CREEP_NEXT : CREEP_FIRST) * HZ) {
          this.creeping = true;
          this.stats.creeps++;
          if (this.streak > 0) {
            const lost = this.mult;
            this.streak = 0;
            if (lost > 1) this.events.push({ k: "streakLost", mult: lost });
          }
          this.comeDown(true);
        }
        break;
      case "volley": {
        this.phys += this.scale;
        while (this.phys >= 1 && this.phase === "volley") {
          this.phys -= 1;
          this.volleyTick();
        }
        break;
      }
      case "settle":
        if (++this.pt >= SETTLE_TICKS) this.comeDown(false);
        break;
      case "advance":
        if (++this.pt >= ADVANCE_TICKS) {
          this.phase = "aim";
          this.pt = 0;
        }
        break;
      case "over":
        this.pt++;
        break;
    }
  }

  private volleyTick(): void {
    if (this.toFire > 0 && this.vt % fireTicks(this.marbles) === 0) {
      const n = this.marbles - this.toFire;
      this.toFire--;
      const b: Ball = { id: n, x: this.launcherX, y: FLOOR - R, vx: this.aimX * SPEED, vy: this.aimY * SPEED, ghost: false, zapIn: -1 };
      this.balls.push(b);
      this.events.push({ k: "fire", x: b.x, y: b.y, n, left: this.toFire });
    }
    this.vt++;
    const scale = this.vt >= FASTER_AT * HZ ? FASTER : this.vt >= FAST_AT * HZ ? FAST : 1;
    if (scale !== this.scale) {
      this.scale = scale;
      this.events.push({ k: "speed", scale });
    }
    if (this.vt === RECALL_AT * HZ) {
      for (const b of this.balls) b.ghost = true;
      this.events.push({ k: "recall" });
    }
    let landed = false;
    for (const b of this.balls) {
      const res = this.advanceBall(b, this.hp, this.struck);
      if (res === 1) this.events.push({ k: "wall", x: b.x, y: b.y });
      for (const i of this.struck) this.knock(i, b.x, b.y, false);
      if (!b.ghost) this.touchExtras(b);
      if (res === 2) {
        landed = true;
        b.y = 1e9;
        const first = this.firstLand < 0;
        // The cannon rolls to where the first marble landed, but never so far that it hangs off the mat.
        if (first) this.firstLand = Math.min(W - LAUNCH_MARGIN, Math.max(LAUNCH_MARGIN, b.x));
        this.events.push({ k: "land", x: b.x, first });
      }
    }
    if (landed) this.balls = this.balls.filter((b) => b.y < 1e8);
    if (this.toFire === 0 && this.balls.length === 0) this.endVolley();
  }

  /**
   * Moves a marble one tick against the blocks in `hp`. Returns 0, 1 (bounced off a wall) or 2 (landed); the cells
   * it struck are left in `struck`. A step is 3.25 px and a marble is 14 across, so nothing is ever skipped.
   */
  advanceBall(b: Ball, hp: Int16Array, struck: number[]): 0 | 1 | 2 {
    struck.length = 0;
    if (b.ghost) {
      b.y += SPEED * 1.6 * H;
      return b.y >= FLOOR - R ? 2 : 0;
    }
    let x = b.x + b.vx * H;
    let y = b.y + b.vy * H;
    let res: 0 | 1 | 2 = 0;
    let bounced = false;
    if (x < R) {
      x = 2 * R - x;
      b.vx = Math.abs(b.vx);
      bounced = true;
      res = 1;
    } else if (x > W - R) {
      x = 2 * (W - R) - x;
      b.vx = -Math.abs(b.vx);
      bounced = true;
      res = 1;
    }
    if (y < R) {
      y = 2 * R - y;
      b.vy = Math.abs(b.vy);
      bounced = true;
      res = 1;
    }
    if (y < PILE_H + R) {
      for (let pass = 0; pass < 3; pass++) {
        // The block the marble is deepest into, if any.
        let best = -1;
        let bestD = R;
        let bqx = 0;
        let bqy = 0;
        const c0 = Math.max(0, Math.floor((x - R) / CELL));
        const c1 = Math.min(COLS - 1, Math.floor((x + R) / CELL));
        const r0 = Math.max(0, Math.floor((y - R) / CELL));
        const r1 = Math.min(ROWS - 1, Math.floor((y + R) / CELL));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const i = r * COLS + c;
            if (hp[i]! <= 0) continue;
            const qx = Math.min((c + 1) * CELL, Math.max(c * CELL, x));
            const qy = Math.min((r + 1) * CELL, Math.max(r * CELL, y));
            const dx = x - qx;
            const dy = y - qy;
            const d = Math.hypot(dx, dy);
            if (d >= bestD) continue;
            // A corner that is really the seam of a flat face (a block next door) belongs to the neighbour.
            if (dx !== 0 && dy !== 0) {
              const nc = c + (dx > 0 ? 1 : -1);
              const nr = r + (dy > 0 ? 1 : -1);
              if ((nc >= 0 && nc < COLS && hp[r * COLS + nc]! > 0) || (nr >= 0 && nr < ROWS && hp[nr * COLS + c]! > 0)) continue;
            }
            best = i;
            bestD = d;
            bqx = qx;
            bqy = qy;
          }
        }
        if (best < 0) break;
        let nx = x - bqx;
        let ny = y - bqy;
        if (bestD < 1e-6) {
          // Dead centre on a face or inside (never in play; kept so nothing can ever stick): back out the way it came.
          const l = Math.hypot(b.vx, b.vy) || 1;
          nx = -b.vx / l;
          ny = -b.vy / l;
          const c = best % COLS;
          const r = (best - c) / COLS;
          const out = Math.min(x - c * CELL, (c + 1) * CELL - x, y - r * CELL, (r + 1) * CELL - y) + R;
          x += nx * out;
          y += ny * out;
        } else {
          nx /= bestD;
          ny /= bestD;
          x = bqx + nx * R;
          y = bqy + ny * R;
        }
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= 2 * vn * nx;
          b.vy -= 2 * vn * ny;
          bounced = true;
        }
        if (!struck.includes(best)) struck.push(best);
      }
    }
    if (bounced) {
      // Never let a marble settle into a flat left-right rattle: keep a little vertical speed, in the direction it has.
      const minVy = SPEED * 0.1;
      if (Math.abs(b.vy) < minVy) b.vy = b.vy < 0 ? -minVy : minVy;
      const l = Math.hypot(b.vx, b.vy);
      b.vx = (b.vx / l) * SPEED;
      b.vy = (b.vy / l) * SPEED;
    }
    b.x = Math.min(W - R, Math.max(R, x));
    b.y = Math.max(R, y);
    if (b.y >= FLOOR - R && b.vy > 0) {
      b.y = FLOOR - R;
      return 2;
    }
    return res;
  }

  /** +1 marbles and zappers under a marble. */
  private touchExtras(b: Ball): void {
    if (b.y > PILE_H + ZAP_R + R) {
      b.zapIn = -1;
      return;
    }
    const reach = R + ZAP_R;
    const c0 = Math.max(0, Math.floor((b.x - reach) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((b.x + reach) / CELL));
    const r0 = Math.max(0, Math.floor((b.y - reach) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((b.y + reach) / CELL));
    let inZap = -1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * COLS + c;
        const k = this.kind[i]!;
        if (k !== PLUS && k !== ZAP) continue;
        const cx = (c + 0.5) * CELL;
        const cy = (r + 0.5) * CELL;
        const d = Math.hypot(b.x - cx, b.y - cy);
        if (k === PLUS) {
          if (d < R + PLUS_R) {
            this.clearCell(i);
            this.gained++;
            this.stats.plus++;
            this.events.push({ k: "plus", x: cx, y: cy });
          }
        } else if (d < R + ZAP_R) {
          inZap = this.ids[i]!;
          if (b.zapIn !== inZap) {
            this.spent[i] = 1;
            this.stats.zaps++;
            this.events.push({ k: "zap", x: cx, y: cy, c, r });
            for (let cc = 0; cc < COLS; cc++) if (this.kind[r * COLS + cc] === BLOCK) this.knock(r * COLS + cc, (cc + 0.5) * CELL, cy, true);
            for (let rr = 0; rr < ROWS; rr++) if (this.kind[rr * COLS + c] === BLOCK) this.knock(rr * COLS + c, cx, (rr + 0.5) * CELL, true);
          }
        }
      }
    }
    b.zapIn = inZap;
  }

  /** One knock on a block. */
  private knock(i: number, x: number, y: number, zap: boolean): void {
    if (this.kind[i] !== BLOCK) return;
    const c = i % COLS;
    const r = (i - c) / COLS;
    this.hp[i]!--;
    this.hitAt[i] = this.tick;
    this.volleyHits++;
    this.stats.hits++;
    this.score += 1;
    this.volleyPts += 1;
    if (this.hp[i]! > 0) {
      this.events.push({ k: "hit", x, y, c, r, hp: this.hp[i]!, zap });
      return;
    }
    const max = this.max[i]!;
    this.clearCell(i);
    this.chain++;
    this.stats.smashes++;
    this.stats.maxChain = Math.max(this.stats.maxChain, this.chain);
    const close = r === ROWS - 1;
    if (close) this.stats.closeCalls++;
    const pts = (10 * Math.min(this.chain, CHAIN_CAP) + (close ? 25 : 0)) * this.mult;
    this.score += pts;
    this.volleyPts += pts;
    this.events.push({ k: "smash", x: (c + 0.5) * CELL, y: (r + 0.5) * CELL, c, r, max, pts, chain: this.chain, close, zap });
  }

  private endVolley(): void {
    this.balls.length = 0;
    this.scale = 1;
    for (let i = 0; i < this.kind.length; i++) if (this.kind[i] === ZAP && this.spent[i]) this.clearCell(i);
    const before = this.mult;
    if (this.chain > 0) {
      this.streak++;
      const m = this.mult;
      this.stats.maxMult = Math.max(this.stats.maxMult, m);
      this.events.push({ k: "streak", streak: this.streak, mult: m, up: m > before });
    } else {
      this.stats.duds++;
      this.streak = 0;
      if (before > 1) this.events.push({ k: "streakLost", mult: before });
    }
    if (this.blocksLeft === 0) {
      const pts = 100 * (1 + Math.floor(this.turn / 5)) * this.mult;
      this.score += pts;
      this.volleyPts += pts;
      this.gained++;
      this.stats.sweeps++;
      this.events.push({ k: "sweep", pts });
    }
    this.stats.bestVolley = Math.max(this.stats.bestVolley, this.volleyPts);
    this.marbles = Math.min(MAX_MARBLES, this.marbles + this.gained);
    this.events.push({ k: "volleyEnd", smashes: this.chain, chain: this.chain, hits: this.volleyHits, pts: this.volleyPts, gained: this.gained });
    this.gained = 0;
    if (this.firstLand >= 0) this.launcherX = this.firstLand;
    this.phase = "settle";
    this.pt = 0;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Looking ahead (the aiming guide and the pilots)
  // -------------------------------------------------------------------------------------------------------------

  /** The first marble's path along (dx, dy) as a polyline, up to `contacts` bounces (or the floor). */
  trace(dx: number, dy: number, contacts = 2, maxLen = 900): Array<{ x: number; y: number }> {
    const [ax, ay] = clampAim(dx, dy);
    const b: Ball = { id: -1, x: this.launcherX, y: FLOOR - R, vx: ax * SPEED, vy: ay * SPEED, ghost: false, zapIn: -1 };
    const pts = [{ x: b.x, y: b.y }];
    const struck: number[] = [];
    let hits = 0;
    const maxTicks = Math.ceil(maxLen / (SPEED * H));
    for (let i = 0; i < maxTicks; i++) {
      const res = this.advanceBall(b, this.hp, struck);
      if (res === 2) break;
      if (res === 1 || struck.length) {
        pts.push({ x: b.x, y: b.y });
        if (++hits >= contacts) return pts;
      }
    }
    pts.push({ x: b.x, y: b.y });
    return pts;
  }

  /**
   * What a shot along (dx, dy) is worth, roughly: one marble flies the path on a copy of the pile, knocking as hard
   * as the whole stream would. Low blocks count for more, and so do smashes and +1 marbles.
   */
  probe(dx: number, dy: number): number {
    const [ax, ay] = clampAim(dx, dy);
    const hp = Int16Array.from(this.hp);
    const b: Ball = { id: -1, x: this.launcherX, y: FLOOR - R, vx: ax * SPEED, vy: ay * SPEED, ghost: false, zapIn: -1 };
    const struck: number[] = [];
    const plus = new Set<number>();
    let value = 0;
    const low = this.lowestRow;
    for (let i = 0; i < 6 * HZ; i++) {
      const res = this.advanceBall(b, hp, struck);
      for (const s of struck) {
        const r = Math.floor(s / COLS);
        const dealt = Math.min(hp[s]!, this.marbles);
        hp[s]! -= dealt;
        const urgent = r >= ROWS - 2 ? 3 : r >= low - 1 ? 1.6 : 1;
        value += dealt * urgent + (hp[s]! <= 0 ? 6 * urgent : 0);
      }
      const c = Math.floor(b.x / CELL);
      const r = Math.floor(b.y / CELL);
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        const k = this.kind[r * COLS + c];
        if (k === PLUS && !plus.has(r * COLS + c) && Math.hypot(b.x - (c + 0.5) * CELL, b.y - (r + 0.5) * CELL) < R + PLUS_R) {
          plus.add(r * COLS + c);
          value += 8 + this.marbles * 0.5;
        }
      }
      if (res === 2) break;
    }
    return value;
  }
}
