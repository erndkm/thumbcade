/**
 * Player models. A pilot sees what a player sees (the meter, the falling piece), picks a resting place for the
 * piece, and then plays it through the same commands a finger sends: turns, slides one band at a time, a slam or a
 * wait. Skills differ in how long they look, how fast their thumb is, how often they misjudge, and whether they
 * slam.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { COLS, ROWS } from "./pieces.ts";
import type { Run } from "./run.ts";
import { collides, dropRow, fullRows, heights, holes, place, removeRows, type Well } from "./well.ts";

export interface Skill {
  name: string;
  /** Seconds looking at a new piece before the first move. */
  look: [number, number];
  /** Seconds per band slid and per quarter turn. */
  slide: number;
  turn: number;
  /** Seconds between the last move and the slam. */
  settle: number;
  /** Chance to slam a piece home; otherwise it is pulled down or left to fall. */
  slams: number;
  /** Chance to pull down (soft drop) when not slamming. */
  pulls: number;
  /** Chance a piece goes somewhere picked without thought. */
  blunder: number;
  /** Noise added to the judgement of each resting place (0 = always the best one). */
  haze: number;
}

export const SKILLS: Record<string, Skill> = {
  novice: { name: "novice", look: [0.7, 1.3], slide: 0.24, turn: 0.36, settle: 0.4, slams: 0.35, pulls: 0.6, blunder: 0.14, haze: 1.8 },
  casual: { name: "casual", look: [0.5, 0.9], slide: 0.17, turn: 0.26, settle: 0.28, slams: 0.75, pulls: 0.7, blunder: 0.07, haze: 1.2 },
  good: { name: "good", look: [0.34, 0.62], slide: 0.12, turn: 0.2, settle: 0.2, slams: 0.96, pulls: 0.9, blunder: 0.035, haze: 0.7 },
  expert: { name: "expert", look: [0.2, 0.36], slide: 0.075, turn: 0.13, settle: 0.12, slams: 1, pulls: 1, blunder: 0.008, haze: 0.2 },
};

/** The attract-mode player: unhurried and tidy, so the demo reads. */
export const DEMO: Skill = { name: "demo", look: [0.4, 0.7], slide: 0.13, turn: 0.24, settle: 0.26, slams: 1, pulls: 1, blunder: 0, haze: 0.15 };

export const skillByName = (name: string): Skill | undefined => SKILLS[name];

export interface Spot {
  rot: number;
  x: number;
  y: number;
  value: number;
}

/** How good the meter looks: low, flat and without covered gaps. */
export function judge(w: Well): number {
  const h = heights(w);
  let total = 0;
  let bumps = 0;
  let top = 0;
  for (let x = 0; x < COLS; x++) {
    total += h[x]!;
    if (h[x]! > top) top = h[x]!;
    if (x > 0) bumps += Math.abs(h[x]! - h[x - 1]!);
  }
  return -0.51 * total - 0.36 * 2 * holes(w) - 0.18 * bumps - 1.5 * Math.max(0, top - (ROWS - 7));
}

/** Every place the piece can be slid to at its current height and dropped, with a value for each. */
export function spots(run: Run): Spot[] {
  const a = run.active;
  if (!a) return [];
  const out: Spot[] = [];
  const scratch = new Uint8Array(run.well.length);
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < COLS; x++) {
      // Reachable: the turned piece fits at every band between here and there at this height.
      let ok = true;
      const step = x >= a.x ? 1 : -1;
      for (let cx = a.x; ; cx += step) {
        if (collides(run.well, a.kind, rot, cx, a.y)) {
          ok = false;
          break;
        }
        if (cx === x) break;
      }
      if (!ok) continue;
      const y = dropRow(run.well, a.kind, rot, x, a.y);
      scratch.set(run.well);
      if (!place(scratch, a.kind, rot, x, y)) continue;
      const rows = fullRows(scratch);
      removeRows(scratch, rows);
      out.push({ rot, x, y, value: judge(scratch) + 0.76 * 2.2 * rows.length });
    }
  }
  return out;
}

export class Pilot {
  private piece = -1;
  private target: Spot | null = null;
  private wait = 0;
  private finish: "slam" | "pull" | "fall" = "slam";
  private settled = false;

  constructor(readonly skill: Skill, private readonly rng: Rng) {}

  reset(): void {
    this.piece = -1;
    this.target = null;
    this.wait = 0;
  }

  /** The resting place the pilot is heading for, for the demo's ghost. */
  get aim(): Spot | null {
    return this.target;
  }

  private choose(run: Run): void {
    const all = spots(run);
    const s = this.skill;
    if (all.length === 0) {
      this.target = null;
      return;
    }
    if (this.rng.chance(s.blunder)) this.target = this.rng.pick(all);
    else {
      let best = all[0]!;
      let bestV = -Infinity;
      for (const sp of all) {
        const v = sp.value + this.rng.range(-s.haze, s.haze);
        if (v > bestV) {
          bestV = v;
          best = sp;
        }
      }
      this.target = best;
    }
    this.finish = this.rng.chance(s.slams) ? "slam" : this.rng.chance(s.pulls) ? "pull" : "fall";
    this.settled = false;
    this.wait = this.rng.range(s.look[0], s.look[1]);
  }

  /** Advances the pilot by `dt` and sends at most one command to the run. */
  update(run: Run, dt: number): void {
    const a = run.active;
    if (!a || run.over) return;
    if (run.pieceCount !== this.piece) {
      this.piece = run.pieceCount;
      this.choose(run);
    }
    const t = this.target;
    if (!t) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    const s = this.skill;
    if (a.rot !== t.rot) {
      // A turn that can't be made here: give up on this plan and drop where it is.
      if (!run.rotate()) t.rot = a.rot;
      this.wait = s.turn;
      return;
    }
    if (a.x !== t.x) {
      if (run.shift(t.x > a.x ? 1 : -1) === 0) t.x = a.x;
      this.wait = s.slide;
      return;
    }
    if (!this.settled) {
      this.settled = true;
      this.wait = s.settle;
      return;
    }
    if (this.finish === "slam") run.slam();
    else if (this.finish === "pull") run.setSoft(true);
    // "fall": leave it to gravity (and keep looking at it, so it is not an idle run).
    else run.poke();
  }
}

/** Plays a whole run with a pilot at 60 steps a second. */
export function playRun(run: Run, pilot: Pilot, maxSeconds = 300): Run {
  const dt = 1 / 60;
  if (!run.started) run.start();
  while (!run.over && run.time < maxSeconds) {
    pilot.update(run, dt);
    run.step(dt);
  }
  return run;
}
