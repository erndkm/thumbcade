/**
 * A simulated shooter. It plays through exactly the same input path as a thumb (a flick, read by `aimFor`), so it
 * drives the attract demo, the fairness tests and the headless run-length numbers.
 *
 * It reads where the hoop is going (as well as its skill allows), picks a throw, and then flicks it with human-sized
 * errors in flick space: the angle, the length and the speed of the swipe, plus a per-run habit of throwing a little
 * short or long that it unlearns as it sees its misses.
 */
import { lerp } from "@thumbcade-games/kit/ease";
import type { Rng } from "@thumbcade-games/kit/rng";
import { flickFor, flightFor, hoopX, type Flick, type Motion, type Stage, type View } from "./sim.ts";

export interface Skill {
  name: string;
  /** Execution noise: angle (rad), length (fraction), speed (fraction). */
  angle: number;
  length: number;
  speed: number;
  /** Typical habit of throwing short/long (fraction), drawn per run and per new spot. */
  bias: number;
  /** How much of a moving hoop's travel it leads (0 = flicks at where the hoop is now). */
  lead: number;
  /** Seconds from the ball arriving to the flick. */
  think: [number, number];
  /** Its natural flick speed (px/s). */
  habit: [number, number];
  /** Chance of a botched flick (way short or long). */
  blunder: number;
  /** Chance it shoots again before the last ball has come down. */
  rapid: number;
}

export const SKILLS = {
  novice: { name: "novice", angle: 0.075, length: 0.22, speed: 0.3, bias: 0.13, lead: 0, think: [0.95, 1.8], habit: [900, 2100], blunder: 0.08, rapid: 0.15 },
  casual: { name: "casual", angle: 0.05, length: 0.15, speed: 0.22, bias: 0.08, lead: 0.4, think: [0.7, 1.35], habit: [1000, 2200], blunder: 0.04, rapid: 0.45 },
  good: { name: "good", angle: 0.034, length: 0.1, speed: 0.15, bias: 0.045, lead: 0.75, think: [0.5, 1.0], habit: [1100, 2300], blunder: 0.015, rapid: 0.75 },
  expert: { name: "expert", angle: 0.022, length: 0.065, speed: 0.1, bias: 0.02, lead: 0.95, think: [0.38, 0.78], habit: [1200, 2400], blunder: 0, rapid: 0.9 },
} satisfies Record<string, Skill>;

/** Roughly normal, cheap and seeded. */
export function gauss(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 1.41;
}

/** The flick this player makes at `stage`, seen through `view`, at run time t0. `bias` is its current short/long habit. */
export function pilotFlick(v: View, stage: Stage, motion: Motion, t0: number, skill: Skill, rng: Rng, bias = 0): Flick {
  const spot = stage.spot;
  const hx0 = hoopX(motion, t0);
  const tf = flightFor(stage.dist);
  const ahead = hoopX(motion, t0 + tf);
  // Reads the hoop's travel, imperfectly.
  const aimX = hx0 + (ahead - hx0) * skill.lead * (1 + gauss(rng) * 0.25);
  const d = Math.hypot(aimX - spot.x, spot.z) * (1 + bias);
  const speed = lerp(skill.habit[0], skill.habit[1], rng());
  const f = flickFor(v, stage, motion, t0, aimX, d, speed);
  const len = Math.hypot(f.dx, f.dy);
  const ang = Math.atan2(f.dy, f.dx) + gauss(rng) * skill.angle;
  let l2 = len * (1 + gauss(rng) * skill.length);
  if (rng.chance(skill.blunder)) l2 *= rng.chance(0.5) ? 0.62 : 1.45;
  return { kind: "shot", dx: Math.cos(ang) * l2, dy: Math.sin(ang) * l2, speed: Math.max(400, f.speed * (1 + gauss(rng) * skill.speed)) };
}

/**
 * A finger path for a flick (screen px, ms), for the ghost finger in attract mode and the first-run hint: a slight
 * ease-in so it reads as a flick, over a duration that matches its speed.
 */
export function flickPath(f: Flick, x0: number, y0: number, out: Array<{ x: number; y: number; t: number }>, n = 14): number {
  const len = Math.hypot(f.dx, f.dy) || 1;
  const dur = (len / Math.max(200, f.speed)) * 1000;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const e = u * u * (1.6 - 0.6 * u);
    const p = out[i] ?? (out[i] = { x: 0, y: 0, t: 0 });
    p.x = x0 + f.dx * e;
    p.y = y0 + f.dy * e;
    p.t = dur * u;
  }
  return n;
}
