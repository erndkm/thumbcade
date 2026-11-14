/**
 * Aiming: how a pull becomes a flight, the flight as the physics steps it, what a flight touches first, and the
 * near-miss assist. Shared by the player's thumb, the pilot and the trajectory preview, so they all agree.
 */
import type { Fixture } from "planck";
import { REST } from "./pages.ts";
import { GRAVITY, STEP, type Desk, type Thing } from "./physics.ts";
import { isMite, isShot, MITES, TAPE, WAD, type MiteKind } from "./pieces.ts";

/** Launch speed at no pull and at full pull (m/s). */
export const V_MIN = 6;
export const V_MAX = 20.5;
export const ANGLE_MIN = -0.35;
export const ANGLE_MAX = 2.25;
/** Drag length (CSS px) for a full pull, and the dead zone that counts as no pull (let go there to cancel). */
export const DRAG_FULL = 150;
export const DRAG_DEAD = 14;
/** The assist nudges the aim by at most this much (radians) onto a doodle the shot would just miss. */
export const ASSIST_MAX = 0.025;
/** A near miss: the flight passes within this much (metres, edge to edge) of a doodle. */
export const ASSIST_NEAR = 0.24;

/** Launch velocity for an aim (angle in radians from +x, power 0-1). */
export function velocityOf(angle: number, power: number): { vx: number; vy: number } {
  const v = V_MIN + (V_MAX - V_MIN) * Math.max(0, Math.min(1, power));
  return { vx: Math.cos(angle) * v, vy: Math.sin(angle) * v };
}

/** A drag from where the thumb went down (screen px, y down) to an aim. Null when it's inside the dead zone. */
export function aimFromDrag(dx: number, dy: number): { angle: number; power: number } | null {
  const len = Math.hypot(dx, dy);
  if (len < DRAG_DEAD) return null;
  let angle = Math.atan2(dy, -dx);
  // Pulled the wrong way (aiming back at me or straight down): the nearer end of the allowed range.
  if (angle > ANGLE_MAX) angle = angle < (ANGLE_MAX + Math.PI * 2 + ANGLE_MIN) / 2 ? ANGLE_MAX : ANGLE_MIN;
  if (angle < ANGLE_MIN) angle = angle > (ANGLE_MIN + ANGLE_MAX - Math.PI * 2) / 2 ? ANGLE_MIN : ANGLE_MAX;
  return { angle, power: Math.min(1, (len - DRAG_DEAD) / DRAG_FULL) };
}

/** The drag that makes an aim (the inverse of aimFromDrag), for the pilot's thumb. */
export function dragFor(angle: number, power: number): { dx: number; dy: number } {
  const len = DRAG_DEAD + Math.max(0, Math.min(1, power)) * DRAG_FULL;
  return { dx: -Math.cos(angle) * len, dy: Math.sin(angle) * len };
}

/**
 * The flight of a shot as the physics steps it (semi-implicit Euler at STEP), sampled every `every` steps, until it
 * has travelled `maxLen` metres, `maxT` seconds, or left the page. Writes x, y pairs into `out`; returns the count.
 */
export function flightPath(angle: number, power: number, out: Float64Array, maxLen = Infinity, every = 1, maxT = 3): number {
  const { vx, vy: vy0 } = velocityOf(angle, power);
  let x: number = REST.x;
  let y: number = REST.y;
  let vy = vy0;
  let len = 0;
  let n = 0;
  out[n++] = x;
  out[n++] = y;
  const steps = Math.round(maxT / STEP);
  for (let i = 1; i <= steps && n < out.length - 1; i++) {
    vy -= GRAVITY * STEP;
    const nx = x + vx * STEP;
    const ny = y + vy * STEP;
    len += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
    if (len >= maxLen || y < -0.5 || x > 9 || x < -1) {
      out[n++] = x;
      out[n++] = y;
      break;
    }
    if (i % every === 0) {
      out[n++] = x;
      out[n++] = y;
    }
  }
  return n >> 1;
}

const PATH = new Float64Array(2 * 420);

/** The power that sends a shot at `angle` through x = tx at height ty (bisection on the stepped path), or null. */
export function powerFor(angle: number, tx: number, ty: number): number | null {
  if (Math.cos(angle) <= 0.02 || tx <= REST.x) return null;
  const yAt = (power: number): number => {
    const n = flightPath(angle, power, PATH, Infinity, 1, 3);
    for (let i = 1; i < n; i++) {
      const x0 = PATH[(i - 1) * 2]!;
      const x1 = PATH[i * 2]!;
      if (x1 >= tx) {
        const k = (tx - x0) / (x1 - x0 || 1);
        return PATH[(i - 1) * 2 + 1]! + (PATH[i * 2 + 1]! - PATH[(i - 1) * 2 + 1]!) * k;
      }
    }
    return -99;
  };
  if (yAt(1) < ty) return null;
  if (yAt(0) >= ty) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (yAt(mid) < ty) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface FirstHit {
  /** The thing it touches first (null: the books, the desk or my pencil case). */
  thing: Thing | null;
  x: number;
  y: number;
  /** Seconds into the flight. */
  t: number;
}

/** What a shot at this aim touches first, or null if it touches nothing on the page. */
export function firstHit(desk: Desk, angle: number, power: number, radius: number = WAD.r): FirstHit | null {
  const every = 2;
  const n = flightPath(angle, power, PATH, Infinity, every, 3);
  const world = desk.world;
  for (let i = 1; i < n; i++) {
    const ax = PATH[(i - 1) * 2]!;
    const ay = PATH[(i - 1) * 2 + 1]!;
    const bx = PATH[i * 2]!;
    const by = PATH[i * 2 + 1]!;
    let best = 2;
    let hit: Fixture | null = null;
    let hx = 0;
    let hy = 0;
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    // Three rays (the middle and either edge of the wad) so a graze counts as a touch.
    for (const side of [0, 1, -1]) {
      const ox = (-dy / l) * radius * side;
      const oy = (dx / l) * radius * side;
      world.rayCast({ x: ax + ox, y: ay + oy }, { x: bx + ox, y: by + oy }, (f, p, _n, frac) => {
        if (f.isSensor()) return -1;
        const ud = f.getBody().getUserData() as { thing?: Thing } | null;
        if (ud?.thing && (isShot(ud.thing.kind) || ud.thing.out >= 0 || ud.thing.gone)) return -1;
        if (frac < best) {
          best = frac;
          hit = f;
          hx = p.x;
          hy = p.y;
        }
        return frac;
      });
    }
    if (hit) {
      const ud = (hit as Fixture).getBody().getUserData() as { thing?: Thing } | null;
      return { thing: ud?.thing ?? null, x: hx, y: hy, t: (i - 1 + best) * every * STEP };
    }
  }
  return null;
}

/** How close (edge to edge, metres) a flight comes to a doodle before it first touches anything. */
function nearMiss(desk: Desk, angle: number, power: number, m: Thing, until: number, radius: number): number {
  const n = flightPath(angle, power, PATH, Infinity, 1, Math.min(3, until + STEP));
  const p = m.body.getPosition();
  const r = Math.hypot(MITES[m.kind as MiteKind].hw, MITES[m.kind as MiteKind].hh) * 0.8 * m.s;
  let best = Infinity;
  for (let i = 0; i < n; i++) best = Math.min(best, Math.hypot(PATH[i * 2]! - p.x, PATH[i * 2 + 1]! - p.y));
  void desk;
  return best - r - radius;
}

/**
 * The forgiving part of aiming: a shot that would pass just by a doodle (within ASSIST_NEAR, before it touches
 * anything else) is nudged, by the smallest turn up to ASSIST_MAX, onto it. A shot that already hits one, or misses
 * everything by a mile, flies as aimed.
 */
export function assist(desk: Desk, angle: number, power: number, tape = false): { angle: number; power: number } {
  const radius = tape ? TAPE.r : WAD.r;
  const h = firstHit(desk, angle, power, radius);
  if (h?.thing && isMite(h.thing.kind)) return { angle, power };
  const until = h ? h.t : 3;
  let near: Thing | null = null;
  let nd = ASSIST_NEAR;
  for (const m of desk.live()) {
    const d = nearMiss(desk, angle, power, m, until, radius);
    if (d < nd) {
      nd = d;
      near = m;
    }
  }
  if (!near) return { angle, power };
  for (let k = 1; k <= 6; k++) {
    for (const side of [1, -1]) {
      const a = angle + side * (ASSIST_MAX * k) / 6;
      const hh = firstHit(desk, a, power, radius);
      if (hh?.thing === near) return { angle: a, power };
    }
  }
  return { angle, power };
}
