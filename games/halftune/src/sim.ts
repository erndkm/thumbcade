/**
 * A run, with no drawing and no sound: the roll clock, judging taps against tiles, holds, combo and multiplier,
 * lives, tune clears and the end. The game feeds it presses; the headless pilot (attract mode, run-length tests)
 * feeds it the presses a player of some skill would make.
 *
 * Forgiving by design:
 * - a press counts for a tile if it lands on it (with slop), or anywhere in its lane close to the right moment;
 * - a press near a lane border also tries the neighbouring lane;
 * - a press on paper only costs a life when there is ink on screen to aim at, and a second press on a tile just
 *   played is ignored;
 * - after a lost life the roll slows down for a moment so the player can find the next tile.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { Chart, LANES, setList, type Tile } from "./chart.ts";

export type Judge = "perfect" | "great" | "early" | "late";

/** Timing windows (seconds either side of the moment the head meets the line). */
export const PERFECT = 0.075;
export const GREAT = 0.15;
/** A press anywhere in the right lane counts this close to the moment. */
export const LANE_WINDOW = 0.17;
/** Slop around a tile for a press that lands on it (units). */
export const SLOP = 0.045;
/** A tile that gets this far past the line (units) is missed: its head has left the screen. */
export const LATE = 0.3;
/** Taps can reach this far above the line (units): the top edge, plus a little. */
export const VISIBLE = 1.02;
export const LIVES = 3;
/** Combo needed for each multiplier step (×1 … ×5). */
export const MULT_AT = [0, 10, 25, 50, 90];
export const POINTS: Record<Judge, number> = { perfect: 3, great: 2, early: 1, late: 1 };
/** Points for a fully held long note, on top of its head, times the multiplier. */
export const HOLD_BONUS = 4;
/** A tune cleared without losing a life. */
export const CLEAN_BONUS = 50;
export const ENCORE_BONUS = 200;
export const ENCORE_PER_LIFE = 100;

export type RunEvent =
  | { k: "hit"; tile: Tile; judge: Judge; points: number; combo: number }
  | { k: "holdEnd"; tile: Tile; full: boolean; points: number }
  | { k: "miss"; tile: Tile }
  | { k: "wrong"; lane: number; at: number }
  | { k: "mult"; mult: number }
  | { k: "life"; lives: number; delta: number }
  | { k: "clear"; slot: number; clean: boolean; bonus: number; life: boolean }
  | { k: "encore"; bonus: number }
  | { k: "die" };

export interface Stats {
  perfect: number;
  great: number;
  early: number;
  late: number;
  misses: number;
  wrongs: number;
  bestCombo: number;
  cleared: number;
  holds: number;
  holdsFull: number;
}


export interface RunOptions {
  seed: number;
  /** Tunes to play; defaults to the set list for the seed. */
  set?: string[];
  /** Attract mode: nothing is ever lost. */
  demo?: boolean;
  leadIn?: number;
  /** Lead per slot (seconds from the top edge to the line), for the attract demo. */
  leads?: number[];
}

export class Run {
  readonly chart: Chart;
  readonly set: string[];
  readonly demo: boolean;
  /** Roll clock (seconds). */
  now = 0;
  /** Roll position (units). */
  S = 0;
  lives = LIVES;
  combo = 0;
  mult = 1;
  score = 0;
  over = false;
  won = false;
  readonly stats: Stats = { perfect: 0, great: 0, early: 0, late: 0, misses: 0, wrongs: 0, bestCombo: 0, cleared: 0, holds: 0, holdsFull: 0 };
  readonly events: RunEvent[] = [];
  /** Per tile: state (0 waiting, 1 held, 2 played, 3 missed), when it was played, hold progress, judgement. */
  readonly state: Uint8Array;
  readonly hitAt: Float64Array;
  readonly progress: Float32Array;
  readonly judge: Array<Judge | null>;
  /** Slot currently being played (the next tune once one is cleared). */
  slot = 0;
  /** Lives lost in the current tune. */
  private lostHere = 0;
  /** First tile that may still be waiting (everything before it is resolved). */
  private head = 0;
  /** Seconds of slow roll left after a lost life. */
  private stumble = 0;
  private holding = new Map<number, number>(); // pointer id → tile index

  constructor(o: RunOptions) {
    this.set = o.set ?? setList(o.seed);
    this.demo = !!o.demo;
    this.chart = new Chart(this.set, o.seed, { leadIn: o.leadIn, leads: o.leads });
    const n = this.chart.tiles.length;
    this.state = new Uint8Array(n);
    this.hitAt = new Float64Array(n).fill(-1);
    this.progress = new Float32Array(n);
    this.judge = Array.from({ length: n }, () => null);
    this.S = this.chart.pos(0);
  }

  get tiles(): Tile[] {
    return this.chart.tiles;
  }

  /** The roll's speed factor right now (1 = normal; lower right after a lost life). */
  get pace(): number {
    if (this.stumble <= 0) return 1;
    const k = Math.min(1, this.stumble / 0.45);
    return 1 - 0.6 * k * k;
  }

  /** Advance by dt real seconds. */
  step(dt: number): void {
    if (this.over) return;
    const rdt = dt * this.pace;
    this.stumble = Math.max(0, this.stumble - dt);
    this.now += rdt;
    this.S = this.chart.pos(this.now);
    const tiles = this.chart.tiles;

    // Holds: progress, and completion when the note has run out.
    for (const [pid, i] of this.holding) {
      const tl = tiles[i]!;
      this.progress[i] = Math.max(0, Math.min(1, (this.now - tl.t) / tl.dur));
      if (this.now >= tl.t + tl.dur) {
        this.holding.delete(pid);
        this.finishHold(i, true);
      }
    }

    // Misses: a waiting head that has left the screen.
    for (let i = this.head; i < tiles.length; i++) {
      const tl = tiles[i]!;
      if (tl.P - this.S > VISIBLE) break;
      if (this.state[i] === 0 && this.S - tl.P > LATE) this.miss(i);
      if (this.over) return;
    }
    while (this.head < tiles.length && this.state[this.head] !== 0 && this.state[this.head] !== 1) this.head++;

    // Tune cleared: every tile of the slot resolved and its last note over.
    const play = this.chart.plays[this.slot];
    if (play && !this.over && this.head >= play.stop && this.now >= play.end) {
      let held = false;
      for (const i of this.holding.values()) if (tiles[i]!.slot === this.slot) held = true;
      if (!held) this.clear();
    }
  }

  /**
   * A finger came down. `lanes`: the lane under it, then (near a border) the neighbouring one. `at`: the roll
   * position it points at (units). `ahead`: roll seconds between the last step and the moment the finger landed
   * (events arrive between frames), so timing is judged at the touch, not at the frame. Returns the tile played.
   */
  press(id: number, lanes: number[], at: number, ahead = 0): Tile | null {
    if (this.over) return null;
    const tiles = this.chart.tiles;
    const when = this.now + Math.max(0, Math.min(0.05, ahead));
    for (const lane of lanes) {
      const i = this.find(lane, at, when);
      if (i >= 0) {
        this.hit(i, id, when);
        return tiles[i]!;
      }
    }
    // Paper. Forgiven when nothing is on screen to aim at, or when it lands on (or right after) a played tile.
    const lane = lanes[0] ?? 0;
    let inkOnScreen = false;
    for (let i = this.head; i < tiles.length; i++) {
      const tl = tiles[i]!;
      if (tl.P - this.S > VISIBLE) break;
      if (this.state[i] === 0) inkOnScreen = true;
      if (tl.lane === lane && this.state[i] === 2 && (this.now - this.hitAt[i]! < 0.3 || (at >= tl.P - SLOP && at <= tl.P + tl.L + SLOP))) return null;
    }
    // Also look back past the head: played tiles still on screen.
    for (let i = this.head - 1; i >= 0; i--) {
      const tl = tiles[i]!;
      if (this.S - (tl.P + tl.L) > LATE + 0.2) break;
      if (tl.lane === lane && this.state[i] === 2 && (this.now - this.hitAt[i]! < 0.3 || (at >= tl.P - SLOP && at <= tl.P + tl.L + SLOP))) return null;
    }
    if (!inkOnScreen) return null;
    this.wrong(lane, at);
    return null;
  }

  /** A finger lifted. */
  release(id: number): void {
    const i = this.holding.get(id);
    if (i === undefined) return;
    this.holding.delete(id);
    const tl = this.chart.tiles[i]!;
    this.progress[i] = Math.max(0, Math.min(1, (this.now - tl.t) / tl.dur));
    this.finishHold(i, this.progress[i]! >= 0.93);
  }

  /** Releases every finger (input cancelled, pause). */
  releaseAll(): void {
    for (const id of [...this.holding.keys()]) this.release(id);
  }

  /** Is a tile being held right now? */
  isHeld(i: number): boolean {
    for (const v of this.holding.values()) if (v === i) return true;
    return false;
  }

  /** The earliest waiting tile in `lane` that a press pointing at `at` plays, or -1. */
  private find(lane: number, at: number, when: number): number {
    const tiles = this.chart.tiles;
    let best = -1;
    for (let i = this.head; i < tiles.length; i++) {
      const tl = tiles[i]!;
      if (tl.P - this.S > VISIBLE) break;
      if (this.state[i] !== 0 || tl.lane !== lane) continue;
      const onIt = at >= tl.P - SLOP && at <= tl.P + tl.L + SLOP;
      const onTime = Math.abs(when - tl.t) <= LANE_WINDOW;
      if (onIt || onTime) {
        best = i;
        break;
      }
    }
    return best;
  }

  private hit(i: number, pointer: number, when: number): void {
    const tl = this.chart.tiles[i]!;
    const dt = when - tl.t;
    const judge: Judge = Math.abs(dt) <= PERFECT ? "perfect" : Math.abs(dt) <= GREAT ? "great" : dt < 0 ? "early" : "late";
    this.judge[i] = judge;
    this.hitAt[i] = this.now;
    this.stats[judge]++;
    this.combo++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    this.bumpMult();
    const points = POINTS[judge] * this.mult;
    this.score += points;
    if (tl.hold) {
      this.state[i] = 1;
      this.stats.holds++;
      this.holding.set(pointer, i);
    } else this.state[i] = 2;
    this.events.push({ k: "hit", tile: tl, judge, points, combo: this.combo });
  }

  private finishHold(i: number, full: boolean): void {
    const tl = this.chart.tiles[i]!;
    this.state[i] = 2;
    if (full) {
      this.progress[i] = 1;
      this.stats.holdsFull++;
    }
    const points = Math.round(HOLD_BONUS * (full ? 1 : this.progress[i]! * 0.75)) * this.mult;
    this.score += points;
    this.events.push({ k: "holdEnd", tile: tl, full, points });
  }

  private bumpMult(): void {
    let m = 1;
    for (let k = 0; k < MULT_AT.length; k++) if (this.combo >= MULT_AT[k]!) m = k + 1;
    if (m !== this.mult) {
      const up = m > this.mult;
      this.mult = m;
      if (up) this.events.push({ k: "mult", mult: m });
    }
  }

  private miss(i: number): void {
    this.state[i] = 3;
    this.stats.misses++;
    this.events.push({ k: "miss", tile: this.chart.tiles[i]! });
    this.lose();
  }

  private wrong(lane: number, at: number): void {
    this.stats.wrongs++;
    this.events.push({ k: "wrong", lane, at });
    this.lose();
  }

  private lose(): void {
    this.combo = 0;
    this.bumpMult();
    this.mult = 1;
    if (this.demo) return;
    this.lives--;
    this.lostHere++;
    this.stumble = 0.7;
    this.events.push({ k: "life", lives: this.lives, delta: -1 });
    if (this.lives <= 0) {
      this.over = true;
      this.releaseAllSilently();
      this.events.push({ k: "die" });
    }
  }

  private releaseAllSilently(): void {
    this.holding.clear();
  }

  private clear(): void {
    const clean = this.lostHere === 0;
    const bonus = clean ? CLEAN_BONUS * (this.slot + 1) : 0;
    this.score += bonus;
    this.stats.cleared++;
    const last = this.slot + 1 >= this.chart.plays.length;
    const life = !last && !this.demo && this.lives < LIVES;
    this.events.push({ k: "clear", slot: this.slot, clean, bonus, life });
    this.lostHere = 0;
    this.slot++;
    if (last) {
      const enc = ENCORE_BONUS + ENCORE_PER_LIFE * this.lives;
      this.score += this.demo ? 0 : enc;
      this.events.push({ k: "encore", bonus: enc });
      this.over = true;
      this.won = true;
      return;
    }
    if (life) {
      this.lives++;
      this.events.push({ k: "life", lives: this.lives, delta: 1 });
    }
  }
}

// --- the pilot -------------------------------------------------------------------------------------

export interface Skill {
  name: string;
  /** Timing spread (seconds, one standard deviation). */
  sigma: number;
  /** Taps per second this player keeps up with comfortably. */
  cap: number;
  /** Base chance of fumbling a tile. */
  slip: number;
  /** Chance of letting go of a long note early. */
  letGo: number;
}

export const SKILLS: Skill[] = [
  { name: "novice", sigma: 0.075, cap: 3.3, slip: 0.012, letGo: 0.35 },
  { name: "casual", sigma: 0.058, cap: 4.4, slip: 0.0065, letGo: 0.2 },
  { name: "good", sigma: 0.044, cap: 5.7, slip: 0.0035, letGo: 0.1 },
  { name: "expert", sigma: 0.03, cap: 7.2, slip: 0.0015, letGo: 0.03 },
];
/** The attract-mode player: very good, never fumbles. */
export const SHOWMAN: Skill = { name: "showman", sigma: 0.022, cap: 99, slip: 0, letGo: 0 };

interface Plan {
  at: number;
  kind: "tap" | "miss" | "wrong";
  lane: number;
  release: number;
  done: boolean;
}

export class Pilot {
  private plans = new Map<number, Plan>();
  private next = 0;
  private rng: Rng;
  private pointer = 1000;
  private held = new Map<number, { id: number; at: number }>();

  constructor(
    readonly skill: Skill,
    seed: number,
  ) {
    this.rng = createRng(seed);
  }

  /** Call every frame before run.step(). */
  play(run: Run): void {
    const tiles = run.tiles;
    // Plan each tile once, as it comes into view.
    while (this.next < tiles.length && tiles[this.next]!.P - run.S <= 1) {
      const i = this.next++;
      this.plans.set(i, this.plan(run, i));
    }
    for (const [i, p] of this.plans) {
      if (p.done || run.now < p.at) continue;
      p.done = true;
      const tl = tiles[i]!;
      if (p.kind === "tap") {
        const id = this.pointer++;
        if (run.press(id, [tl.lane], tl.P + Math.min(tl.L, 0.1) * 0.5) && tl.hold) this.held.set(i, { id, at: p.release });
      } else if (p.kind === "wrong") run.press(this.pointer++, [p.lane], tl.P);
    }
    for (const [i, h] of this.held) {
      if (run.now >= h.at) {
        run.release(h.id);
        this.held.delete(i);
      }
    }
    for (const [i, p] of this.plans) if (p.done && !this.held.has(i)) this.plans.delete(i);
  }

  private plan(run: Run, i: number): Plan {
    const tiles = run.tiles;
    const tl = tiles[i]!;
    const s = this.skill;
    // How busy the music is around this note.
    let n = 0;
    for (let j = Math.max(0, i - 8); j < Math.min(tiles.length, i + 8); j++) if (Math.abs(tiles[j]!.t - tl.t) <= 0.5) n++;
    const rate = n / 1.0;
    const over = Math.max(0, rate / s.cap - 0.8);
    const pErr = s.slip + 0.55 * over * over;
    const jitter = gauss(this.rng) * s.sigma * (1 + over);
    const at = tl.t + jitter;
    let kind: Plan["kind"] = "tap";
    let lane = tl.lane;
    if (this.rng() < pErr) {
      if (this.rng() < 0.55) kind = "miss";
      else {
        kind = "wrong";
        lane = tl.lane === 0 ? 1 : tl.lane === LANES - 1 ? LANES - 2 : tl.lane + (this.rng() < 0.5 ? -1 : 1);
      }
    }
    const release = tl.hold ? tl.t + tl.dur * (this.rng() < s.letGo ? this.rng.range(0.35, 0.85) : 1.05) : 0;
    return { at, kind, lane, release, done: false };
  }
}

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimResult {
  seconds: number;
  score: number;
  won: boolean;
  stats: Stats;
  set: string[];
}

/** Plays a whole run headless. Seconds are real time from the starting tap to the end. */
export function simulate(seed: number, skill: Skill, set?: string[]): SimResult {
  const run = new Run({ seed, set });
  const pilot = new Pilot(skill, seed ^ 0x2545f491);
  const dt = 1 / 60;
  let seconds = 0;
  while (!run.over && seconds < 400) {
    pilot.play(run);
    run.step(dt);
    run.events.length = 0;
    seconds += dt;
  }
  return { seconds, score: run.score, won: run.won, stats: { ...run.stats }, set: run.set };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]!;
}
