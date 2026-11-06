/**
 * A simulated bowler. It plays through exactly the same input path as a thumb (a flick read by `aimFor`, assist
 * included), so it drives the attract demo, the fairness tests and the headless run-length numbers.
 *
 * It picks a line (the pocket on a full rack, the key pin of a leave), a pace it likes and a hook, works out the flick
 * for it, and then flicks with human-sized errors in flick space: the swipe's angle, its speed and its bow, plus a
 * per-run habit of pulling to one side that it unlearns as it watches its balls.
 */
import { lerp } from "@thumbcade-games/kit/ease";
import type { Rng } from "@thumbcade-games/kit/rng";
import { POCKET_X, type View } from "./lane.ts";
import { flickFor, headingThrough, pocketFor, spareTarget, type Flick } from "./throw.ts";

export interface Skill {
  name: string;
  /** Execution noise: swipe angle (rad), speed (fraction), bow (bulge / chord). */
  angle: number;
  speed: number;
  bow: number;
  /** A per-run pull to one side (rad), drawn per run and unlearned ball by ball. */
  bias: number;
  /** Seconds from the ball arriving to the flick. */
  think: [number, number];
  /** The ball speeds it likes (m/s). */
  pace: [number, number];
  /** How much it hooks a full rack, and a spare. */
  hook: number;
  spareHook: number;
  /** Chance of a botched flick (way off line). */
  blunder: number;
}

export const SKILLS = {
  novice: { name: "novice", angle: 0.078, speed: 0.24, bow: 0.06, bias: 0.035, think: [1.0, 1.9], pace: [8.5, 12.8], hook: 0.15, spareHook: 0.15, blunder: 0.08 },
  casual: { name: "casual", angle: 0.052, speed: 0.17, bow: 0.045, bias: 0.022, think: [0.8, 1.5], pace: [9, 12.2], hook: 0.4, spareHook: 0.3, blunder: 0.04 },
  good: { name: "good", angle: 0.028, speed: 0.11, bow: 0.03, bias: 0.012, think: [0.6, 1.1], pace: [9.4, 11.6], hook: 0.62, spareHook: 0.15, blunder: 0.015 },
  expert: { name: "expert", angle: 0.018, speed: 0.08, bow: 0.022, bias: 0.006, think: [0.45, 0.85], pace: [9.6, 11.4], hook: 0.75, spareHook: 0, blunder: 0 },
} satisfies Record<string, Skill>;

/** Roughly normal, cheap and seeded. */
export function gauss(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 1.41;
}

export interface Habit {
  /** -1 hooks left (most players), +1 hooks right. */
  hand: number;
  /** Current pull to one side (rad). */
  bias: number;
}

export function newHabit(skill: Skill, rng: Rng): Habit {
  return { hand: rng.chance(0.78) ? -1 : 1, bias: gauss(rng) * skill.bias };
}

/** The flick this bowler makes at `standing` pins, seen through `view`. Unlearns a little of its habit each time. */
export function pilotFlick(v: View, standing: readonly boolean[], skill: Skill, rng: Rng, habit: Habit): Flick {
  const full = standing.every((s) => s);
  const speed = lerp(skill.pace[0], skill.pace[1], rng());
  const hook = habit.hand * (full ? skill.hook : skill.spareHook) * (1 + gauss(rng) * 0.08);
  const target = full ? pocketFor(hook, habit.hand < 0 ? POCKET_X : -POCKET_X) : spareTarget(standing);
  const heading = headingThrough(target.x, target.d, speed, hook);
  const len = v.height * lerp(0.22, 0.34, rng());
  const f = flickFor(v, heading, speed, hook, len);
  let ang = Math.atan2(f.dy, f.dx) + gauss(rng) * skill.angle + habit.bias;
  if (rng.chance(skill.blunder)) ang += (rng.chance(0.5) ? 1 : -1) * rng.range(0.08, 0.16);
  habit.bias *= 0.8;
  const l = Math.hypot(f.dx, f.dy);
  return {
    kind: "throw",
    dx: Math.cos(ang) * l,
    dy: Math.sin(ang) * l,
    speed: Math.max(500, f.speed * (1 + gauss(rng) * skill.speed)),
    bow: f.bow + gauss(rng) * skill.bow,
  };
}
