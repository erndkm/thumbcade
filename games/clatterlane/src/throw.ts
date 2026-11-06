/**
 * From a thumb to a throw: reading the flick (direction, speed, bow), mapping it onto the lane through the aiming
 * camera, and the invisible assist that pulls a near miss toward the pocket (or the spare's key pin).
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { BALL_D0, BALL_R, D_HEAD, LANE_HALF, PIN_R, POCKET_X, project, SPOTS, unproject, type View } from "./lane.ts";
import { ballLine, type ThrowInput } from "./pins.ts";

export interface Sample {
  x: number;
  y: number;
  t: number;
}

export interface Flick {
  kind: "none" | "soft" | "throw";
  dx: number;
  dy: number;
  /** px/s */
  speed: number;
  /** Signed sideways bulge of the path over its chord (+ = bulges to the right). */
  bow: number;
}

const NONE: Flick = { kind: "none", dx: 0, dy: 0, speed: 0, bow: 0 };
/** Flick speeds (px/s) that map onto the ball's speed range. */
export const FLICK_SLOW = 420;
export const FLICK_FAST = 2600;
export const V_MIN = 7.6;
export const V_MAX = 13.2;
/** Bow (bulge / chord) under which a flick is straight, and at which it hooks fully. */
export const BOW_DEAD = 0.03;
export const BOW_FULL = 0.19;
/** The flick's sideways angle is calmed a little: lanes are narrow on screen. */
export const AIM_GAIN = 0.72;
/** Beyond this the ball is in the gutter long before the pins anyway. */
const MAX_HEADING = 0.1;

/** Turns the finger's path into a flick. `n` samples of `pts` are used (the game reuses one buffer). */
export function readFlick(pts: readonly Sample[], n = pts.length): Flick {
  if (n < 2) return NONE;
  const a = pts[0]!;
  // The flick starts where the finger begins to move (resting a thumb first is fine).
  let s = 0;
  for (let i = 1; i < n; i++) {
    if (Math.hypot(pts[i]!.x - a.x, pts[i]!.y - a.y) > 6) {
      s = i - 1;
      break;
    }
  }
  const p0 = pts[s]!;
  const p1 = pts[n - 1]!;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 26) return NONE;
  // Up, or up and across, but not sideways or down.
  if (dy > -0.5 * Math.abs(dx) || dy > -18) return NONE;
  const dur = Math.max(0.045, (p1.t - p0.t) / 1000);
  let speed = len / dur;
  // A flick that whips through its end counts its release speed too.
  for (let i = n - 2; i >= s; i--) {
    const q = pts[i]!;
    if (p1.t - q.t >= 70) {
      const late = Math.hypot(p1.x - q.x, p1.y - q.y) / Math.max(0.045, (p1.t - q.t) / 1000);
      speed = Math.max(speed, late * 0.85);
      break;
    }
  }
  // Signed perpendicular bulge: the sample farthest from the chord (nx/nd points to the right of an upward chord).
  const nx = -dy / len;
  const ny = dx / len;
  let bow = 0;
  for (let i = s + 1; i < n - 1; i++) {
    const q = pts[i]!;
    const d = (q.x - p0.x) * nx + (q.y - p0.y) * ny;
    if (Math.abs(d) > Math.abs(bow)) bow = d;
  }
  bow = clamp(bow / len, -0.5, 0.5);
  if (len < 60 || speed < FLICK_SLOW * 0.85) return { kind: "soft", dx, dy, speed, bow };
  return { kind: "throw", dx, dy, speed, bow };
}

export const powerOf = (speed: number): number => clamp((speed - FLICK_SLOW) / (FLICK_FAST - FLICK_SLOW));
export const ballSpeed = (flickSpeed: number): number => lerp(V_MIN, V_MAX, powerOf(flickSpeed) ** 0.85);
export function flickSpeedFor(v: number): number {
  const p = clamp((v - V_MIN) / (V_MAX - V_MIN)) ** (1 / 0.85);
  return FLICK_SLOW + p * (FLICK_FAST - FLICK_SLOW);
}

/** The swipe's end turns away from its bulge, and the ball follows: a path bulging right hooks left. */
export function hookOf(bow: number): number {
  const a = Math.abs(bow);
  if (a < BOW_DEAD) return 0;
  return clamp((-Math.sign(bow) * (a - BOW_DEAD)) / (BOW_FULL - BOW_DEAD), -1, 1);
}
export function bowFor(hook: number): number {
  const a = Math.abs(hook);
  if (a < 1e-3) return 0;
  return -Math.sign(hook) * (BOW_DEAD + a * (BOW_FULL - BOW_DEAD));
}

/** The flick's direction from the ball, followed onto the lane: the heading the ball leaves on (before the assist). */
export function headingOf(v: View, dx: number, dy: number): number {
  const b = project(v, 0, BALL_R, BALL_D0);
  const l = Math.hypot(dx, dy) || 1;
  const q = unproject(v, b.x + (dx / l) * 180, b.y + (dy / l) * 180, BALL_R);
  const g = unproject(v, b.x, b.y, BALL_R);
  if (!q || !g) return 0;
  return clamp(Math.atan2(q.x - g.x, q.d - g.d) * AIM_GAIN, -MAX_HEADING, MAX_HEADING);
}

/** The inverse: a screen direction (unit dx, dy) that makes `heading`. */
export function directionFor(v: View, heading: number): { dx: number; dy: number } {
  const h = heading / AIM_GAIN;
  const b = project(v, 0, BALL_R, BALL_D0);
  const p = project(v, Math.tan(h) * 4, BALL_R, BALL_D0 + 4);
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const l = Math.hypot(dx, dy) || 1;
  return { dx: dx / l, dy: dy / l };
}

// ---------------------------------------------------------------------------------------------------------------
// Targets and the assist
// ---------------------------------------------------------------------------------------------------------------
export interface Target {
  x: number;
  d: number;
}

/** The pocket a ball should find on a full rack, given which way it hooks and where it is heading. */
export function pocketFor(hook: number, predictedX: number): Target {
  // Pins carry from either side of the head pin; a ball bending in from one side has its sweet spot a little wider on
  // the far side (the "Brooklyn" hit) and a touch tighter on its own side.
  const side = Math.abs(hook) < 0.08 ? 0 : Math.sign(hook);
  const right = side < 0 ? POCKET_X : side > 0 ? 0.08 : POCKET_X;
  const left = side > 0 ? -POCKET_X : side < 0 ? -0.08 : -POCKET_X;
  return { x: predictedX >= 0 ? right : left, d: D_HEAD };
}

/**
 * Where to send the ball at a leave: the line that touches the most standing pins, hitting the front one of them
 * (ties go to the line closest to the middle of the group). A single pin is hit dead on.
 */
export function spareTarget(standing: readonly boolean[]): Target {
  const idx: number[] = [];
  standing.forEach((s, i) => s && idx.push(i));
  if (!idx.length) return { x: 0, d: D_HEAD };
  if (idx.length === 1) return { x: SPOTS[idx[0]!]!.x, d: SPOTS[idx[0]!]!.d };
  const reach = (BALL_R + PIN_R) * 0.92;
  let best = { x: 0, d: D_HEAD, n: -1, off: Infinity };
  const mid = idx.reduce((a, i) => a + SPOTS[i]!.x, 0) / idx.length;
  const cands: number[] = [];
  for (const i of idx) for (const o of [-0.1, -0.05, 0, 0.05, 0.1]) cands.push(SPOTS[i]!.x + o);
  for (const x of cands) {
    let n = 0;
    let front = Infinity;
    for (const i of idx) {
      if (Math.abs(SPOTS[i]!.x - x) < reach) {
        n++;
        front = Math.min(front, SPOTS[i]!.d);
      }
    }
    // A pin hit from the side flies across: pins beside the line, one spot away, often go too.
    for (const i of idx) if (Math.abs(SPOTS[i]!.x - x) >= reach && Math.abs(SPOTS[i]!.x - x) < 0.34) n += 0.35;
    const off = Math.abs(x - mid);
    if (n > best.n + 1e-6 || (Math.abs(n - best.n) < 1e-6 && off < best.off)) best = { x, d: front === Infinity ? D_HEAD : front, n, off };
  }
  return { x: clamp(best.x, -LANE_HALF + 0.12, LANE_HALF - 0.12), d: best.d };
}

/**
 * The invisible assist: an error `e` inside the window is shrunk by `a`; beyond it the pull fades out over one more
 * window, so a wild throw stays wild. Monotonic in `e`.
 */
export function assistCurve(e: number, win: number, a: number): number {
  const u = Math.abs(e) / win;
  const k = u <= 1 ? 1 : u >= 2 ? 0 : 1 - (u - 1) * (u - 1) * (3 - 2 * (u - 1));
  return e * (1 - a * k);
}

/** How generous the assist is at rack n (0-based): pull share and window (m). */
export function assistFor(rack: number, spare = false): { pull: number; win: number } {
  const k = clamp(rack / 9);
  const pull = lerp(0.62, 0.3, k) * (spare ? 0.6 : 1);
  return { pull, win: lerp(0.22, 0.13, k) };
}

export interface Aim {
  input: ThrowInput;
  /** Where the flick pointed (x at the target's row) before and after the assist. */
  rawX: number;
  assistedX: number;
  target: Target;
}

/** Solves the heading that sends this ball (speed, hook) through x at row d. */
export function headingThrough(x: number, d: number, speed: number, hook: number, h0 = 0): number {
  let h = h0 || Math.atan2(x, d - BALL_D0);
  for (let i = 0; i < 5; i++) {
    const r = ballLine(0, h, speed, hook, d);
    const err = r.x - x;
    if (Math.abs(err) < 2e-4) break;
    h -= err / (d - BALL_D0);
  }
  return clamp(h, -MAX_HEADING, MAX_HEADING);
}

/** A flick, read through the aiming view, becomes a throw at `standing` pins in rack `rack`. */
export function aimFor(v: View, f: Flick, standing: readonly boolean[], rack: number, bumpers: boolean): Aim {
  const speed = ballSpeed(f.speed);
  const hook = hookOf(f.bow);
  const heading = headingOf(v, f.dx, f.dy);
  const full = standing.every((s) => s);
  const probe = ballLine(0, heading, speed, hook);
  const target = full ? pocketFor(hook, probe.x) : spareTarget(standing);
  const raw = target.d === D_HEAD ? probe : ballLine(0, heading, speed, hook, target.d);
  const { pull, win } = assistFor(rack, !full);
  const ax = target.x + assistCurve(raw.x - target.x, win, pull);
  const h = Math.abs(ax - raw.x) < 1e-4 ? heading : headingThrough(ax, target.d, speed, hook, heading);
  return { input: { x0: 0, heading: h, speed, hook, bumpers }, rawX: raw.x, assistedX: ax, target };
}

/** The flick (screen px) that throws `heading` at `speed` with `hook`, `len` px long. For the pilot and the ghost finger. */
export function flickFor(v: View, heading: number, speed: number, hook: number, len: number): Flick {
  const dir = directionFor(v, heading);
  return { kind: "throw", dx: dir.dx * len, dy: dir.dy * len, speed: flickSpeedFor(speed), bow: bowFor(hook) };
}

/**
 * A finger path for a flick (screen px, ms), for the ghost finger: a slight ease-in, bulging by its bow, over a
 * duration that matches its speed.
 */
export function flickPath(f: Flick, x0: number, y0: number, out: Sample[], n = 16): number {
  const len = Math.hypot(f.dx, f.dy) || 1;
  const dur = (len / Math.max(200, f.speed)) * 1000;
  const nx = -f.dy / len;
  const ny = f.dx / len;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const e = u * u * (1.6 - 0.6 * u);
    const bulge = Math.sin(e * Math.PI) * f.bow * len;
    const p = out[i] ?? (out[i] = { x: 0, y: 0, t: 0 });
    p.x = x0 + f.dx * e + nx * bulge;
    p.y = y0 + f.dy * e + ny * bulge;
    p.t = dur * u;
  }
  return n;
}
