import type { Rng } from "@thumbcade-games/kit/rng";

/**
 * The run's rules, kept pure so they can be simulated.
 *
 * Hype (0-1) drains all the time and every press on the expected side (six, then seven, then six…) adds GAIN. The drain asks for `need(t)` presses
 * per second, `t` seconds into the run (teacher stops don't count), so every player eventually falls behind:
 * about 25 s at 3.5 presses/s, 35 s at 5, 55 s at 8.
 */

export type Side = "six" | "seven";

export const GAIN = 0.05;
export const FUMBLE = 0.05;
export const CAUGHT = 0.3;
/** Presses already in flight when the teacher turns around don't count. */
export const CAUGHT_GRACE = 0.06;

export const need = (t: number): number => 2 + 0.16 * t;
export const drainPerSecond = (t: number): number => need(t) * GAIN;

/** Combo tiers (six-sevens in a row without a fumble): the kid gets louder at each. */
export const TIERS = [0, 10, 30, 60] as const;
export const TIER_NAMES = ["", "HYPED", "AURA", "MAX AURA"] as const;
export function tierOf(combo: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) if (combo >= TIERS[i]!) t = i;
  return t;
}

export interface TeacherVisit {
  /** Run time the warning starts. */
  at: number;
  /** Seconds of warning (footsteps, peek) before the teacher looks. */
  warn: number;
  /** Seconds the teacher watches. */
  watch: number;
}

const LEAVE = 0.3;

/** The next visit after one that started at `prev` (or the first, when `prev` is null). `t` is run time. */
export function nextVisit(rng: Rng, prev: TeacherVisit | null): TeacherVisit {
  if (!prev) return { at: 6.5, warn: 0.85, watch: 1.1 };
  const after = prev.at + prev.warn + prev.watch + LEAVE;
  const pressure = Math.min(1, after / 60);
  return {
    at: after + rng.range(4.5, 8) * (1 - 0.4 * pressure),
    warn: 0.8 - 0.3 * pressure,
    watch: rng.range(0.9, 1.5),
  };
}

export type TeacherPhase = "away" | "warn" | "watch" | "leave";

export function teacherPhase(v: TeacherVisit, t: number): { phase: TeacherPhase; k: number } {
  const d = t - v.at;
  if (d < 0) return { phase: "away", k: 0 };
  if (d < v.warn) return { phase: "warn", k: d / v.warn };
  if (d < v.warn + v.watch) return { phase: "watch", k: (d - v.warn) / v.watch };
  if (d < v.warn + v.watch + LEAVE) return { phase: "leave", k: (d - v.warn - v.watch) / LEAVE };
  return { phase: "away", k: 1 };
}

export const visitOver = (v: TeacherVisit, t: number): boolean => t >= v.at + v.warn + v.watch + LEAVE;
