/**
 * A simulated player. It reads the table the way a person does (which ball, which pocket, how thin a cut), picks a
 * shot, and then plays it with human-sized errors in aim and power: the same angle and speed a thumb would set with
 * the drag. Better players check a few shots on the real physics before committing. It drives the attract demo, the
 * tests and the headless run-length numbers.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { E_BALL, POCKET_AIM, R, ROLL_A, simulateShot, V_MAX, V_MIN, type Table, type Vec } from "./sim.ts";

export interface Skill {
  name: string;
  /** Aim noise (radians) and power noise (fraction), widened a little each rack as the guide gets shorter. */
  angle: number;
  power: number;
  /** Seconds to line up a shot once the balls stop. */
  think: [number, number];
  /** It picks among this many of the easiest-looking shots. */
  picks: number;
  /** It checks this many candidates on the real physics first (0 = goes by eye). */
  check: number;
  /** Chance of a botched shot (way off, or far too hard). */
  blunder: number;
}

export const SKILLS = {
  novice: { name: "novice", angle: 0.034, power: 0.26, think: [1.7, 3.1], picks: 4, check: 0, blunder: 0.1 },
  casual: { name: "casual", angle: 0.021, power: 0.18, think: [1.3, 2.5], picks: 3, check: 0, blunder: 0.05 },
  good: { name: "good", angle: 0.012, power: 0.12, think: [1.0, 1.9], picks: 2, check: 4, blunder: 0.02 },
  expert: { name: "expert", angle: 0.0065, power: 0.08, think: [0.75, 1.45], picks: 1, check: 8, blunder: 0 },
} satisfies Record<string, Skill>;

export interface Plan {
  angle: number;
  speed: number;
  ball: number;
  pocket: number;
  /** Higher is easier. */
  ease: number;
}

export function gauss(rng: Rng): number {
  return (rng() + rng() + rng() - 1.5) * 1.41;
}

/** Is the straight path from a to b (a ball travelling it) clear of every ball but `skip`, and of the blockers? */
function clear(t: Table, a: Vec, b: Vec, skip: number[]): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  for (let i = 0; i < t.balls.length; i++) {
    if (skip.includes(i)) continue;
    const o = t.balls[i]!;
    if (o.pocket >= 0) continue;
    const u = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / l2));
    if (Math.hypot(a.x + dx * u - o.x, a.z + dz * u - o.z) < 2 * R - 0.01) return false;
  }
  for (const k of t.blockers) {
    const u = Math.max(0, Math.min(1, ((k.x - a.x) * dx + (k.z - a.z) * dz) / l2));
    if (Math.hypot(a.x + dx * u - k.x, a.z + dz * u - k.z) < R + k.r) return false;
  }
  return true;
}

/** Every straight pot on the table, easiest first. */
export function plans(t: Table): Plan[] {
  const cue = t.balls[0]!;
  const out: Plan[] = [];
  t.balls.forEach((b, i) => {
    if (i === 0 || b.pocket >= 0) return;
    POCKET_AIM.forEach((aim, p) => {
      const ax = aim.x - b.x;
      const az = aim.z - b.z;
      const d2 = Math.hypot(ax, az);
      if (d2 < 1e-3) return;
      const ox = ax / d2;
      const oz = az / d2;
      const ghost = { x: b.x - ox * 2 * R, z: b.z - oz * 2 * R };
      const cx = ghost.x - cue.x;
      const cz = ghost.z - cue.z;
      const d1 = Math.hypot(cx, cz);
      if (d1 < 1e-3) return;
      const cut = (cx * ox + cz * oz) / d1;
      if (cut < 0.26) return;
      // Side pockets only take balls coming in from the front.
      if (p === 2 || p === 3) {
        if (Math.abs(ox) < 0.45) return;
      }
      if (!clear(t, cue, ghost, [0, i]) || !clear(t, b, aim, [0, i])) return;
      const vObj = Math.sqrt(2 * ROLL_A * (d2 + 0.35)) + 0.7;
      const vHit = vObj / (cut * ((1 + E_BALL) / 2));
      const speed = Math.min(V_MAX, Math.max(V_MIN + 0.4, Math.sqrt(vHit * vHit + 2 * ROLL_A * d1) * 1.06));
      const ease = (cut * cut) / (1 + 0.13 * d1 + 0.22 * d2);
      out.push({ angle: Math.atan2(cz, cx), speed, ball: i, pocket: p, ease });
    });
  });
  out.sort((a, b) => b.ease - a.ease);
  return out;
}

/** When nothing goes: a firm hit on the nearest ball to stir things up. */
function fallback(t: Table): Plan {
  const cue = t.balls[0]!;
  let best = -1;
  let bd = Infinity;
  t.balls.forEach((b, i) => {
    if (i === 0 || b.pocket >= 0) return;
    const d = Math.hypot(b.x - cue.x, b.z - cue.z);
    if (d < bd && clear(t, cue, b, [0, i])) {
      bd = d;
      best = i;
    }
  });
  if (best < 0)
    t.balls.forEach((b, i) => {
      if (i === 0 || b.pocket >= 0) return;
      const d = Math.hypot(b.x - cue.x, b.z - cue.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
  const b = t.balls[Math.max(1, best)] ?? t.balls[0]!;
  return { angle: Math.atan2(b.z - cue.z, b.x - cue.x), speed: 6.5, ball: best, pocket: -1, ease: 0 };
}

/** What this player decides to play (before execution errors). */
export function choose(t: Table, skill: Skill, rng: Rng): Plan {
  const list = plans(t);
  if (!list.length) return fallback(t);
  const pool = list.slice(0, Math.max(1, skill.picks));
  if (skill.check > 0) {
    // Try the best-looking few on the real physics and keep one that pots without scratching.
    let pick: Plan | null = null;
    let pickScore = -Infinity;
    for (const c of list.slice(0, skill.check)) {
      const s = simulateShot(t, c.angle, c.speed);
      const score = s.pots.length * 2 - (s.scratch ? 3 : 0) + c.ease * 0.5;
      if (score > pickScore) {
        pickScore = score;
        pick = c;
      }
    }
    if (pick) return pick;
  }
  return pool[Math.min(pool.length - 1, Math.floor(rng() * rng() * pool.length))]!;
}

/** The shot as played: the plan plus this player's aim and power errors. */
export function execute(plan: Plan, skill: Skill, rack: number, rng: Rng): { angle: number; speed: number } {
  const widen = 1 + Math.min(0.8, rack * 0.12);
  let angle = plan.angle + gauss(rng) * skill.angle * widen;
  let speed = plan.speed * (1 + gauss(rng) * skill.power);
  if (rng.chance(skill.blunder)) {
    if (rng.chance(0.5)) angle += (rng.chance(0.5) ? 1 : -1) * rng.range(0.08, 0.2);
    else speed *= rng.range(1.5, 2);
  }
  return { angle, speed: Math.max(V_MIN, Math.min(V_MAX, speed)) };
}
