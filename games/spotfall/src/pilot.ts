/**
 * The pilot: plays the attract demo, picks the first-run hint, and plays headless runs at several skill levels so run
 * lengths can be measured without a person (scripts/pilot.ts, test/pilot.test.ts).
 *
 * It aims the way a thumb does with the guide on screen: it sweeps the angles, groups the ones that land in the same
 * cell, aims at the middle of each window (the safest angle for that cell), values what each landing would pop and
 * drop, and then fires with a human-sized error in the angle.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { BOMB, INKS, LIMIT, MIN_ANGLE, WILD, type Board, type Cell } from "./board.ts";
import { Run, settle, type RunStats } from "./run.ts";

export interface Skill {
  name: string;
  /** Seconds from a loaded launcher to the shot (uniform range): looking, dragging, lining up. */
  think: [number, number];
  /** Standard deviation of the fired angle around the one aimed at (degrees). */
  noise: number;
  /** Looks for shots off a wall. */
  banks: boolean;
  /** Chance of taking the best shot seen; otherwise one of the few next best. */
  greed: number;
  /** Swaps for the next ink when that is better. */
  swaps: boolean;
}

export const SKILLS: Skill[] = [
  { name: "novice", think: [2.0, 3.4], noise: 2.0, banks: false, greed: 0.35, swaps: false },
  { name: "casual", think: [1.6, 2.7], noise: 1.3, banks: false, greed: 0.55, swaps: false },
  { name: "good", think: [1.25, 2.1], noise: 0.8, banks: true, greed: 0.75, swaps: true },
  { name: "expert", think: [0.95, 1.6], noise: 0.5, banks: true, greed: 0.95, swaps: true },
];

/** The attract-mode player: good and a little showy, slow enough to watch the guide find its mark. */
export const DEMO: Skill = { name: "demo", think: [1.05, 1.6], noise: 0, banks: true, greed: 0.9, swaps: true };

export interface Plan {
  angle: number;
  cell: Cell;
  swap: boolean;
  value: number;
  pops: number;
  drops: number;
  bounces: number;
}

const STEP = (0.6 * Math.PI) / 180;

/** What landing `kind` in `cell` would be worth to a player. */
export function value(board: Board, cell: Cell, kind: number): { v: number; pops: number; drops: number } {
  const b = board.clone();
  const s = settle(b, cell, kind);
  const pops = s.popped.length;
  const drops = s.dropped.length;
  if (pops) return { v: 3 + pops + drops * 2.2 + (b.count() === 0 ? 12 : 0), pops, drops };
  // No pop: build towards one, and keep the sheet high.
  let same = 0;
  for (const n of board.neighbors(cell.r, cell.c)) if (board.get(n.r, n.c) === kind) same++;
  const low = cell.r / LIMIT;
  let v = same * 0.8 - low * low * 2.5;
  if (cell.r >= LIMIT - 1) v -= 40;
  return { v, pops, drops };
}

/** Every distinct landing for `kind`, aimed at the middle of the window of angles that reach it. */
export function landings(board: Board, kind: number, banks: boolean): Plan[] {
  const out: Plan[] = [];
  let runStart = -1;
  let runKey = "";
  let runBounces = 0;
  const flush = (endA: number) => {
    if (runStart < 0) return;
    const angle = (runStart + endA) / 2;
    const tr = board.trace(angle);
    if (!banks && tr.bounces > 0) return;
    if (tr.bounces > 1) return;
    const { v, pops, drops } = value(board, tr.cell, kind);
    // Narrow windows are hard to hit: a small nudge toward the wide ones.
    const width = endA - runStart;
    out.push({ angle, cell: tr.cell, swap: false, value: v + Math.min(1, width / (4 * STEP)) * 0.6, pops, drops, bounces: runBounces });
  };
  let last = MIN_ANGLE;
  for (let a = MIN_ANGLE; a <= Math.PI - MIN_ANGLE + 1e-9; a += STEP) {
    const tr = board.trace(a);
    const key = `${tr.cell.r},${tr.cell.c},${tr.bounces}`;
    if (key !== runKey) {
      flush(last);
      runStart = a;
      runKey = key;
      runBounces = tr.bounces;
    }
    last = a;
  }
  flush(last);
  return out;
}

/** The shot a player of `skill` would line up (before their aim error). */
export function plan(run: Run, skill: Skill, rng: Rng): Plan | null {
  const board = run.board;
  if (board.count() === 0) return { angle: Math.PI / 2, cell: { r: 0, c: 4 }, swap: false, value: 0, pops: 0, drops: 0, bounces: 0 };
  let options = landings(board, run.current, skill.banks);
  if (skill.swaps && run.next !== run.current) {
    const alt = landings(board, run.next, skill.banks).map((p) => ({ ...p, swap: true, value: p.value - 0.3 }));
    options = options.concat(alt);
  }
  if (!options.length) return null;
  options.sort((a, b) => b.value - a.value);
  if (rng() < skill.greed) return options[0]!;
  const k = Math.min(options.length, 4);
  return options[Math.floor(rng() * k)]!;
}

/** A normal deviate. */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimResult {
  seconds: number;
  score: number;
  stats: RunStats;
  /** Ended in the first ten seconds. */
  early: boolean;
}

/**
 * Plays a whole run headless. `skill` null is an idle player (never shoots); "tapper" fires at random angles every
 * half second or so, like the reviewer's random taps.
 */
export function simulate(seed: number, skill: Skill | null | "tapper", maxSeconds = 300): SimResult {
  const run = new Run(seed);
  const rng = createRng(seed ^ 0x5bd1e995);
  const dt = 1 / 30;
  const think = () => (skill && skill !== "tapper" ? skill.think[0] + rng() * (skill.think[1] - skill.think[0]) : 0.3 + rng() * 0.4);
  let wait = think();
  while (run.phase === "play" && run.time < maxSeconds) {
    run.step(dt);
    if (skill === null || !run.loaded) continue;
    wait -= dt;
    if (wait > 0) continue;
    if (skill === "tapper") {
      run.fire(MIN_ANGLE + rng() * (Math.PI - 2 * MIN_ANGLE));
    } else {
      const p = plan(run, skill, rng);
      if (p) {
        if (p.swap) run.swap();
        run.fire(p.angle + (gauss(rng) * skill.noise * Math.PI) / 180);
      }
    }
    wait = think();
  }
  return { seconds: run.time, score: run.score, stats: run.stats, early: run.phase === "over" && run.time < 10 };
}

/**
 * The attract-mode pilot, frame by frame: it settles on a shot, sweeps the guide over to it the way a thumb would,
 * holds a beat, and fires.
 */
export class DemoPilot {
  /** The angle the guide shows. */
  aim = Math.PI / 2;
  /** True while the guide is up. */
  aiming = false;
  private target: Plan | null = null;
  private t = 0;
  private dur = 1;
  private from = Math.PI / 2;
  private rest = 0.25;

  constructor(
    private readonly rng: Rng,
    private readonly skill: Skill = DEMO,
  ) {}

  /** Advances the demo; returns true on the frame it fires. */
  step(run: Run, dt: number): boolean {
    if (!run.loaded) {
      this.aiming = false;
      return false;
    }
    if (this.rest > 0) {
      this.rest -= dt;
      return false;
    }
    if (!this.target) {
      this.target = plan(run, this.skill, this.rng);
      if (!this.target) return false;
      if (this.target.swap) run.swap();
      this.from = this.aim;
      this.t = 0;
      this.dur = this.skill.think[0] + this.rng() * (this.skill.think[1] - this.skill.think[0]);
      this.aiming = true;
    }
    this.t += dt;
    const k = Math.min(1, this.t / (this.dur * 0.7));
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    // A little overshoot and settle, like a thumb.
    const wob = Math.sin(k * Math.PI) * 0.06 * (this.target.angle > this.from ? 1 : -1);
    this.aim = this.from + (this.target.angle - this.from) * e + wob * (1 - k);
    if (this.t >= this.dur) {
      this.aim = this.target.angle;
      run.fire(this.aim);
      this.target = null;
      this.aiming = false;
      this.rest = 0.35;
      return true;
    }
    return false;
  }
}

export const isSpecial = (k: number): boolean => k === WILD || k === BOMB;
export const isInk = (k: number): boolean => k >= 0 && k < INKS;
