/**
 * The pilot: plays the cat through the same calls a thumb makes (press, release, swipe), with a reaction delay, a
 * tap that takes as long as a real one, and a little misjudgement of where everything will be. It plays attract mode,
 * the QA autoplay builds and the headless run-length checks.
 */
import { createRng } from "@thumbcade-games/kit/rng";
import { CELL, colOf, COLS, colX, moverX, type Row } from "./world.ts";
import { RULES, type Run } from "./run.ts";

export interface Skill {
  /** Seconds between looks. */
  think: readonly [number, number];
  /** From deciding to the finger going down. */
  react: number;
  /** Spread (s) of the pilot's misjudgement of timing. */
  noise: number;
  /** Extra px of room it wants around a hazard. */
  margin: number;
  /** Chance a decision is a hop up without looking. */
  lapse: number;
  /** How long a tap is held (s). */
  press: readonly [number, number];
  /** How many moves ahead it plans. */
  depth: number;
  /** How long after its plan it wants to stay safe (s). */
  horizon: number;
  /** What a fish is worth to it, in rows. */
  greed: number;
  /** How much it hurries when the dawn is close (rows of value per second waited). */
  hurry: number;
}

export const PILOTS = {
  novice: { think: [0.34, 0.55], react: 0.4, noise: 0.16, margin: 0, lapse: 0.11, press: [0.08, 0.15], depth: 1, horizon: 0.18, greed: 0, hurry: 0.4 },
  casual: { think: [0.24, 0.4], react: 0.3, noise: 0.11, margin: 0.5, lapse: 0.06, press: [0.07, 0.12], depth: 2, horizon: 0.26, greed: 0.3, hurry: 0.8 },
  good: { think: [0.17, 0.28], react: 0.23, noise: 0.065, margin: 1, lapse: 0.022, press: [0.06, 0.1], depth: 3, horizon: 0.32, greed: 0.6, hurry: 1.2 },
  expert: { think: [0.09, 0.14], react: 0.14, noise: 0.03, margin: 1.5, lapse: 0.004, press: [0.05, 0.08], depth: 4, horizon: 0.4, greed: 0.8, hurry: 1.6 },
} as const satisfies Record<string, Skill>;

export type PilotName = keyof typeof PILOTS;

/** The swipe needs this long to travel far enough to be read. */
const SWIPE_LAT = 0.07;
/** One "wait" step of the plan. */
const WAIT = 0.12;

interface Plan {
  kind: "tap" | "swipe";
  dir: -1 | 1;
  /** When the finger goes down, and when it comes up (tap) or the swipe is read. */
  down: number;
  up: number;
  pressed: boolean;
}

type Move = "up" | "left" | "right" | "wait";
const MOVES: readonly Move[] = ["up", "left", "right", "wait"];

/** Gaussian-ish noise from three uniforms. */
const gauss = (r: () => number) => (r() + r() + r() - 1.5) * 1.15;

export function pilotCat(skill: Skill, seed: number): { drive: (run: Run, dt: number) => void } {
  const rnd = createRng(seed);
  let nextLook = 0;
  let plan: Plan | null = null;

  interface Ctx {
    run: Run;
    margin: number;
    skew: number;
    horizon: number;
    row0: number;
    hurry: number;
    /** Time between one move and the next: a look, the reaction and the tap. */
    gap: number;
  }

  /** Riding speed on a row (px/s). */
  const rideOf = (row: Row) => (row.kind === "brook" ? row.dir * row.speed : 0);

  /** Safe standing (or riding) at (row, x) over [t, t + dur]? Returns the x at the end, or null. */
  function hold(c: Ctx, rowI: number, x: number, t: number, dur: number): number | null {
    if (c.run.dangerIn(rowI, x, t, dur, c.margin, c.skew) !== Infinity) return null;
    const row = c.run.row(rowI);
    const ride = rideOf(row);
    return ride === 0 ? x : Math.max(colX(0) - RULES.edge, Math.min(colX(COLS - 1) + RULES.edge, x + ride * dur));
  }

  /** Applies a move that starts at t; returns the new state or null if it gets the cat bumped. */
  function apply(c: Ctx, m: Move, rowI: number, x0: number, t0: number, first: boolean): { row: number; x: number; t: number; fish: number } | null {
    const run = c.run;
    const row = run.row(rowI);
    // A later move only starts once the pilot has looked, reacted and tapped again.
    const lag = first ? 0 : m === "wait" ? c.gap : c.gap;
    const held = lag > 0 ? hold(c, rowI, x0, t0, lag) : x0;
    if (held === null) return null;
    const x = held;
    const t = t0 + lag;
    if (m === "wait") {
      if (!first) return { row: rowI, x, t, fish: 0 };
      const nx = hold(c, rowI, x, t, WAIT);
      return nx === null ? null : { row: rowI, x: nx, t: t + WAIT, fish: 0 };
    }
    if (m === "up") {
      const next = run.row(rowI + 1);
      const col = colOf(x);
      if (next.kind === "path" && next.block[col]! >= 0) return null;
      if (hold(c, rowI, x, t, RULES.hop * 0.3) === null) return null;
      const lx = next.kind === "brook" ? x : colX(col);
      const tl = t + RULES.hop;
      if (run.dangerIn(rowI + 1, lx, t + RULES.hop * 0.7, RULES.hop * 0.3 + 0.02, c.margin, c.skew) !== Infinity) return null;
      return { row: rowI + 1, x: lx, t: tl, fish: fishAt(run, next, lx, tl) };
    }
    const dir = m === "left" ? -1 : 1;
    const ride = rideOf(row);
    let to: number;
    if (row.kind === "brook") {
      to = x + dir * CELL;
      if (to < colX(0) - RULES.edge || to > colX(COLS - 1) + RULES.edge) return null;
    } else {
      const cc = colOf(x) + dir;
      if (cc < 0 || cc >= COLS || (row.kind === "path" && row.block[cc]! >= 0)) return null;
      to = colX(cc);
    }
    const tl = t + RULES.side;
    if (hold(c, rowI, x, t, RULES.side * 0.5) === null) return null;
    const lx = to + ride * RULES.side;
    if (run.dangerIn(rowI, lx, t + RULES.side * 0.5, RULES.side * 0.5 + 0.02, c.margin, c.skew) !== Infinity) return null;
    return { row: rowI, x: lx, t: tl, fish: fishAt(run, row, lx, tl) };
  }

  function fishAt(run: Run, row: Row, x: number, t: number): number {
    const p = row.pickup;
    if (!p || run.taken.has(row.i)) return 0;
    if (p.mover >= 0) {
      const m = row.movers[p.mover]!;
      const bx = moverX(row, m, t);
      return x >= bx && x <= bx + m.len ? (p.gold ? 2 : 1) : 0;
    }
    return Math.abs(colX(p.col) - x) < 8 ? (p.gold ? 2 : 1) : 0;
  }

  /** Best value reachable from (row, x) at time t with `depth` moves left. */
  function value(c: Ctx, rowI: number, x: number, t: number, depth: number, t0: number): number {
    if (depth === 0) {
      // A plan must end somewhere the cat can stand for a while.
      // A plan must end somewhere the cat can stand long enough to react again.
      const need = skill.react + 0.15;
      const safe = c.run.dangerIn(rowI, x, t, need + c.horizon, c.margin, c.skew);
      let pen = safe === Infinity ? 0 : safe < need ? 4 : 1.5 * (1 - (safe - need) / c.horizon);
      // A boat heading for the edge of the hill is a trap a little further off.
      const row = c.run.row(rowI);
      const ride = rideOf(row);
      if (ride !== 0) {
        const edge = ride > 0 ? (colX(COLS - 1) + RULES.edge - x) / ride : (x - (colX(0) - RULES.edge)) / -ride;
        if (edge < 1.4) pen += (1.4 - edge) * 1.5;
      }
      return rowI - c.row0 - pen - (t - t0) * c.hurry * 0.5;
    }
    let best = -Infinity;
    for (const m of MOVES) {
      const s = apply(c, m, rowI, x, t, false);
      if (!s) continue;
      const v = value(c, s.row, s.x, s.t, depth - 1, t0) + s.fish * skill.greed;
      if (v > best) best = v;
    }
    if (best === -Infinity) {
      // Nothing is safe from here: how long can it hold on?
      const safe = c.run.dangerIn(rowI, x, t, 1, c.margin, c.skew);
      return rowI - c.row0 - 3 + Math.min(1, safe) - (t - t0) * c.hurry * 0.5;
    }
    return best;
  }

  function decide(run: Run): Plan | null {
    const t = run.t;
    const cat = run.cat;
    const row = run.row(cat.row);
    const press = rnd.range(skill.press[0], skill.press[1]);
    const tapAt = t + skill.react;
    const tap = (): Plan => ({ kind: "tap", dir: 1, down: tapAt, up: tapAt + press, pressed: false });
    const swipe = (dir: -1 | 1): Plan => ({ kind: "swipe", dir, down: tapAt, up: tapAt + SWIPE_LAT, pressed: false });
    if (rnd.chance(skill.lapse)) return tap();

    const close = run.gap < 2;
    const c: Ctx = {
      run,
      margin: close ? Math.max(-1, skill.margin - 2) : skill.margin,
      skew: gauss(rnd) * skill.noise,
      horizon: close ? skill.horizon * 0.6 : skill.horizon,
      row0: cat.row,
      hurry: close ? skill.hurry * 3 : skill.hurry * 0.3,
      gap: (skill.think[0] + skill.think[1]) / 2 + skill.react + (skill.press[0] + skill.press[1]) / 2,
    };
    // Where the cat is when each kind of move actually starts (the finger takes a moment).
    const ride = rideOf(row);
    let best: Move = "wait";
    let bestV = -Infinity;
    for (const m of MOVES) {
      const te = m === "up" ? tapAt + press : m === "wait" ? t : tapAt + SWIPE_LAT;
      // It has to survive until its finger gets there.
      const x0 = hold(c, cat.row, cat.x, t, te - t);
      if (x0 === null && m !== "wait") continue;
      const s = m === "wait" ? apply(c, "wait", cat.row, cat.x, t, true) : apply(c, m, cat.row, x0 ?? cat.x + ride * (te - t), te, true);
      let v: number;
      if (!s) v = m === "wait" ? -5 : -Infinity;
      else v = value(c, s.row, s.x, s.t, Math.max(0, skill.depth - 1), t) + s.fish * skill.greed;
      // A tie goes to moving on (and a plan that starts by waiting would wait forever).
      if (m === "up") v += 0.05;
      if (m === "wait") v -= 0.08;
      if (v > bestV) {
        bestV = v;
        best = m;
      }
    }
    if (best === "up") return tap();
    if (best === "left") return swipe(-1);
    if (best === "right") return swipe(1);
    return null;
  }

  return {
    drive(run: Run) {
      const t = run.t;
      if (plan) {
        if (!plan.pressed && t >= plan.down) {
          plan.pressed = true;
          run.press();
        }
        if (plan.pressed && t >= plan.up) {
          if (plan.kind === "tap") run.release();
          else run.swipe(plan.dir);
          plan = null;
          nextLook = t + rnd.range(skill.think[0], skill.think[1]) * 0.6;
        }
        return;
      }
      if (t < nextLook) return;
      nextLook = t + rnd.range(skill.think[0], skill.think[1]);
      if (!run.canAct || run.cat.stun > 0 || run.hop) return;
      plan = decide(run);
    },
  };
}

/**
 * The reviewer's scripted input, roughly: a tap somewhere every ~0.31 s, and every third action a swipe in one of
 * four directions (vertical ones do nothing here; in the feed they would leave the game).
 */
export function scripted(): { drive: (run: Run, dt: number) => void } {
  let next = 0;
  let i = 0;
  let up = -1;
  let swipeDir: -1 | 0 | 1 = 0;
  return {
    drive(run: Run) {
      if (up >= 0 && run.t >= up) {
        if (swipeDir === 0) run.release();
        else run.swipe(swipeDir);
        up = -1;
      }
      if (run.t < next) return;
      next = run.t + 0.31;
      run.press();
      if (i % 3 === 2) {
        const dirs: Array<-1 | 0 | 1> = [0, 0, -1, 1];
        const d = dirs[i % 4]!;
        swipeDir = d;
        up = run.t + 0.12;
        if (d === 0) {
          // A vertical swipe: the press never becomes a tap.
          up = -1;
          run.cancel();
        }
      } else {
        swipeDir = 0;
        up = run.t + 0.06;
      }
      i++;
    },
  };
}
