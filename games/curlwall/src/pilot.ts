/**
 * A simulated free-kick taker. It plays through exactly the same input path as a thumb (a flick, read by
 * `aimFor`), so it drives the attract demo, the fairness tests and the headless run-length numbers.
 *
 * It judges candidate kicks against an average keeper (no misread), picks one of the best, and then executes it
 * with human-sized errors in flick space: the angle, the length, the speed and the bow of the swipe.
 */
import { lerp } from "@thumbcade-games/kit/ease";
import type { Rng } from "@thumbcade-games/kit/rng";
import {
  aimFor,
  flickFor,
  GOAL_H,
  GOAL_HW,
  newFrames,
  simulateShot,
  solveKick,
  type Flick,
  type Setup,
  type Vec2,
  type View,
} from "./sim.ts";

export interface Skill {
  name: string;
  /** Candidate kicks it weighs up (more = better judgement). */
  candidates: number;
  /** Execution noise: angle (rad), length (fraction), speed (fraction), bow (absolute). */
  angle: number;
  length: number;
  speed: number;
  bow: number;
  /** Chance of just hitting it at the goal without thinking. */
  naive: number;
  /** Seconds spent lining up a kick. */
  think: [number, number];
}

export const SKILLS = {
  novice: { name: "novice", candidates: 6, angle: 0.07, length: 0.28, speed: 0.28, bow: 0.06, naive: 0.55, think: [1.7, 3.2] },
  casual: { name: "casual", candidates: 14, angle: 0.05, length: 0.18, speed: 0.2, bow: 0.045, naive: 0.3, think: [1.4, 2.6] },
  good: { name: "good", candidates: 28, angle: 0.034, length: 0.11, speed: 0.13, bow: 0.032, naive: 0.1, think: [1.1, 2.1] },
  expert: { name: "expert", candidates: 48, angle: 0.022, length: 0.07, speed: 0.08, bow: 0.022, naive: 0, think: [0.9, 1.7] },
} satisfies Record<string, Skill>;

interface Candidate {
  target: Vec2;
  speed: number;
  curl: number;
  value: number;
}

const frames = newFrames();

/** Every kick a player might sensibly try at this setup, best first (judged against an average keeper). */
export function candidates(s: Setup, count: number, rng: Rng): Candidate[] {
  const out: Candidate[] = [];
  const xs = [-GOAL_HW + 0.5, -GOAL_HW + 1.2, -1.2, 0, 1.2, GOAL_HW - 1.2, GOAL_HW - 0.5];
  const ys = [0.35, 1.2, GOAL_H - 0.5];
  const speeds = [18, 22.5, 26.5, 30];
  const curls = [-1, -0.55, 0, 0.55, 1];
  for (let i = 0; i < count; i++) {
    const target = { x: rng.pick(xs) + rng.range(-0.15, 0.15), y: rng.pick(ys) + rng.range(-0.1, 0.1) };
    const speed = rng.pick(speeds);
    // Bend it back from the wall's side when there is one; otherwise anything goes.
    const curl = rng.pick(curls);
    const l = solveKick(s.spot, target, speed, curl);
    const shot = simulateShot(s, l, frames, { exact: true });
    let value = 0;
    if (shot.outcome === "goal") {
      value = 1 + (shot.corner >= 0 ? 0.7 : 0) + Math.min(0.4, Math.max(0, shot.keeperMargin)) + (shot.bend > 1.25 ? 0.15 : 0);
    } else if (shot.outcome === "post") value = 0.2;
    out.push({ target, speed, curl, value });
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}

/** The flick this player makes at setup `s`, seen through `view`. */
export function pilotFlick(s: Setup, view: View, skill: Skill, rng: Rng): Flick {
  let pick: Candidate;
  if (rng.chance(skill.naive)) {
    // Just hit it at the goal: somewhere in the top half, a bit of curl, any pace.
    pick = { target: { x: rng.range(-GOAL_HW + 0.4, GOAL_HW - 0.4), y: rng.range(1.0, GOAL_H - 0.2) }, speed: rng.range(18, 29), curl: rng.range(-0.5, 0.5), value: 0 };
  } else {
    const list = candidates(s, skill.candidates, rng);
    // Not always the very best: a person picks among the shots that look good.
    pick = list[Math.min(list.length - 1, Math.floor(rng() * rng() * 3))]!;
  }
  // Wind: a decent player leans the aim into it.
  const f = flickFor(view, s.spot, pick.target, pick.speed, pick.curl);
  const len = Math.hypot(f.dx, f.dy);
  const ang = Math.atan2(f.dy, f.dx) + gauss(rng) * skill.angle;
  const l2 = len * (1 + gauss(rng) * skill.length);
  return {
    kind: "kick",
    dx: Math.cos(ang) * l2,
    dy: Math.sin(ang) * l2,
    speed: Math.max(200, f.speed * (1 + gauss(rng) * skill.speed)),
    bow: f.bow + gauss(rng) * skill.bow,
  };
}

/** Roughly normal, cheap and seeded. */
function gauss(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 1.41;
}

/**
 * A finger path for a flick (screen px, ms), for the ghost finger in attract mode and the first-run hint: a
 * quadratic curve whose bulge matches the flick's bow, over a duration that matches its speed.
 */
export function flickPath(f: Flick, x0: number, y0: number, out: Array<{ x: number; y: number; t: number }>, n = 14): number {
  const len = Math.hypot(f.dx, f.dy) || 1;
  const nx = -f.dy / len;
  const ny = f.dx / len;
  // A quadratic Bézier bulges by half its control offset at the middle.
  const cx = x0 + f.dx / 2 + nx * f.bow * len * 2;
  const cy = y0 + f.dy / 2 + ny * f.bow * len * 2;
  const dur = (len / Math.max(200, f.speed)) * 1000;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    const p = out[i] ?? (out[i] = { x: 0, y: 0, t: 0 });
    p.x = a * x0 + b * cx + c * (x0 + f.dx);
    p.y = a * y0 + b * cy + c * (y0 + f.dy);
    p.t = lerp(0, dur, u);
  }
  return n;
}

export { aimFor };
