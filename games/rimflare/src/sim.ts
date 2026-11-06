/**
 * Rimflare's rules and physics, pure (no DOM, no Three.js), so the game, the attract pilot, the tests and the
 * headless run-length script all share one source of truth.
 *
 * World: metres, x to the right, y up, z toward the shooter. The rim's centre sits at (hoopX(t), RIM_Y, 0), the
 * backboard's front face at z = BOARD_Z. The shooter's spot is somewhere out on the court at z > 0.
 *
 * Every shot is simulated to its end the moment it leaves the hand (rim, backboard, net, floor), at a fixed 480 Hz,
 * and recorded into a frame buffer the game plays back. The hoop may slide, so the simulation reads its position
 * from the same motion the renderer uses, at the same run time. That makes every shot deterministic and lets the
 * game know a swish is coming before the ball gets there.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";

// ---------------------------------------------------------------------------------------------------------------
// The hoop and the ball
// ---------------------------------------------------------------------------------------------------------------
export const G = 9.81;
export const BALL_R = 0.12;
/** Rim radius to the middle of the tube, and the tube's own radius. */
export const RIM_R = 0.229;
export const RIM_TUBE = 0.011;
export const RIM_Y = 3.05;
/** Front face of the backboard (the rim's inner edge is 15 cm off it). */
export const BOARD_Z = -(RIM_R + 0.151);
export const BOARD_W = 1.8;
export const BOARD_H = 1.05;
export const BOARD_BOTTOM = 2.9;
export const NET_DEPTH = 0.44;
/** Height the ball rests at, ready in the shooter's hands. */
export const BALL_Y = 1.2;
/** Every shot leaves at this elevation: a proper arc, steep enough to drop through the ring. */
export const ELEV = (63 * Math.PI) / 180;

const STEP = 1 / 480;
export const FRAME_HZ = 120;
/** Floats per recorded frame: t, x, y, z. */
export const FRAME_STRIDE = 4;
export const MAX_T = 2.8;
export const MAX_FRAMES = Math.ceil(FRAME_HZ * MAX_T) + 2;

const E_RIM = 0.52;
const E_BOARD = 0.6;
const E_FLOOR = 0.66;

// Pacing (seconds): the game uses these too, so headless run lengths match what a player sees.
/** After a release, the next ball is in your hands this much later. */
export const RELOAD_T = 0.42;
/** Camera move to a new spot between stages (the clock waits). */
export const STAGE_T = 0.9;
/** Most balls in the air at once. */
export const MAX_IN_AIR = 3;

export interface Vec2 {
  x: number;
  z: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A sideways slide of the hoop: x(t) = amp · ramp · sin(2π (t - t0) / period). */
export interface Motion {
  amp: number;
  period: number;
  t0: number;
}

export const STILL: Motion = { amp: 0, period: 1, t0: 0 };

/** The rim's x at run time t. The slide eases in over its first second so a new stage never jerks the hoop. */
export function hoopX(m: Motion, t: number): number {
  if (m.amp === 0) return 0;
  const u = t - m.t0;
  if (u <= 0) return 0;
  const ramp = u < 1.2 ? (u / 1.2) * (u / 1.2) * (3 - (2 * u) / 1.2) : 1;
  return m.amp * ramp * Math.sin((u * Math.PI * 2) / m.period);
}

/** The rim's sideways speed at t (numerical, for the rim's push on the ball). */
export function hoopVX(m: Motion, t: number): number {
  if (m.amp === 0) return 0;
  return (hoopX(m, t + 0.002) - hoopX(m, t - 0.002)) / 0.004;
}

// ---------------------------------------------------------------------------------------------------------------
// Stages: where you shoot from, how the hoop moves, how much the assist helps, what a make is worth in time
// ---------------------------------------------------------------------------------------------------------------
export interface Stage {
  n: number;
  /** Shooter's spot on the court. */
  spot: Vec2;
  /** Horizontal distance from the spot to the hoop's resting place. */
  dist: number;
  amp: number;
  period: number;
  /** How hard the invisible assist pulls a near miss in (0-1), and over what window (m). */
  assist: number;
  winX: number;
  winD: number;
  /** How much of a moving hoop's travel during the flight the assist leads for you (1 = all of it). */
  lead: number;
  /** Clock seconds back per make are scaled by this. */
  refill: number;
  /** Makes needed to clear this stage. */
  makes: number;
  label: string;
}

const TABLE = [
  { d: 4.2, x: 0, amp: 0, period: 1, label: "" },
  { d: 4.8, x: 1.55, amp: 0, period: 1, label: "FROM THE WING" },
  { d: 4.7, x: -1.1, amp: 0.5, period: 6.4, label: "THE HOOP IS MOVING" },
  { d: 5.3, x: 0, amp: 0.66, period: 5.6, label: "STEP BACK" },
  { d: 5.7, x: 1.5, amp: 0.74, period: 5.0, label: "WING, ON THE MOVE" },
  { d: 6.2, x: -0.9, amp: 0.8, period: 4.6, label: "DEEP" },
] as const;

export function stageFor(n: number): Stage {
  const t = TABLE[Math.min(n, TABLE.length - 1)]!;
  const late = Math.max(0, n - (TABLE.length - 1));
  const d = late ? Math.min(6.8, t.d + late * 0.12) : t.d;
  const x = late ? (late % 2 ? 1.3 : -1.3) : t.x;
  // The spot sits on the circle of radius d around the hoop.
  const sx = clamp(x, -d * 0.6, d * 0.6);
  const sz = Math.sqrt(d * d - sx * sx);
  const amp = late ? Math.min(0.9, t.amp + late * 0.03) : t.amp;
  const period = late ? Math.max(3.3, t.period - late * 0.22) : t.period;
  const k = clamp(n / 7);
  return {
    n,
    spot: { x: sx, z: sz },
    dist: d,
    amp,
    period,
    assist: n === 0 ? 0.68 : Math.max(0.36, lerp(0.8, 0.54, k) - late * 0.02),
    winX: Math.max(0.32, lerp(0.62, 0.44, k) - late * 0.01),
    winD: Math.max(0.6, lerp(1.25, 0.85, k) - late * 0.025),
    lead: amp > 0 ? Math.max(0.5, lerp(0.95, 0.7, clamp((n - 2) / 4)) - late * 0.03) : 1,
    refill: Math.max(0.55, 1 - n * 0.06),
    makes: n === 0 ? 4 : Math.min(9, 4 + Math.ceil(n / 2)),
    label: late ? (late % 3 === 1 ? "FASTER" : late % 3 === 2 ? "DEEPER" : "NO MERCY") : t.label,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Camera (shared by the renderer and the input mapping, so "flick at the hoop" lines up exactly)
// ---------------------------------------------------------------------------------------------------------------
export interface View {
  cam: Vec3;
  look: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  aspect: number;
  width: number;
  height: number;
}

export const CAM_BACK = 3.0;
export const CAM_Y = 1.8;
/** Where the ball and the rim sit on screen (fractions of the height from the top). */
export const BALL_SCREEN = 0.8;
export const RIM_SCREEN = 0.42;

/**
 * The camera stands behind the ball on the line from the hoop, then pitches and zooms so the ball lands at
 * BALL_SCREEN and the rim at RIM_SCREEN of the viewport height, whatever its shape.
 */
export function viewFor(spot: Vec2, width: number, height: number): View {
  const len = Math.hypot(spot.x, spot.z) || 1;
  const ux = spot.x / len;
  const uz = spot.z / len;
  const cam = { x: spot.x + ux * CAM_BACK, y: CAM_Y, z: spot.z + uz * CAM_BACK };
  const ab = Math.atan2(BALL_Y - CAM_Y, CAM_BACK);
  const ar = Math.atan2(RIM_Y - CAM_Y, len + CAM_BACK);
  const rb = (0.5 - BALL_SCREEN) * 2; // ndc y of the ball (negative)
  const rr = (0.5 - RIM_SCREEN) * 2;
  // Find the pitch p with tan(ar - p) / tan(ab - p) = rr / rb, then the fov from the rim.
  let lo = ab + 1e-4;
  let hi = ar - 1e-4;
  for (let i = 0; i < 50; i++) {
    const p = (lo + hi) / 2;
    const f = Math.tan(ar - p) / Math.tan(ab - p) - rr / rb;
    // f grows as p rises toward ar? tan(ar-p) shrinks to 0 and tan(ab-p) is negative: f rises toward 0 from below.
    if (f < 0) lo = p;
    else hi = p;
  }
  const p = (lo + hi) / 2;
  const tanHalf = Math.tan(ar - p) / rr;
  const fov = (Math.atan(tanHalf) * 2 * 180) / Math.PI;
  const dist = 10;
  const look = { x: cam.x - ux * Math.cos(p) * dist, y: cam.y + Math.sin(p) * dist, z: cam.z - uz * Math.cos(p) * dist };
  return { cam, look, fov, aspect: width / height, width, height };
}

interface Basis {
  fx: number;
  fy: number;
  fz: number;
  rx: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  tan: number;
}
const BASIS: Basis = { fx: 0, fy: 0, fz: 0, rx: 0, rz: 0, ux: 0, uy: 0, uz: 0, tan: 0 };

function basis(v: View): Basis {
  let fx = v.look.x - v.cam.x;
  let fy = v.look.y - v.cam.y;
  let fz = v.look.z - v.cam.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  const b = BASIS;
  b.fx = fx;
  b.fy = fy;
  b.fz = fz;
  b.rx = rx;
  b.rz = rz;
  // u = r × f with r = (rx, 0, rz)
  b.ux = -rz * fy;
  b.uy = rz * fx - rx * fz;
  b.uz = rx * fy;
  b.tan = Math.tan((v.fov * Math.PI) / 360);
  return b;
}

/** World point -> screen px (CSS), plus depth along the view axis. */
export function project(v: View, p: Vec3, out: { x: number; y: number; depth: number } = { x: 0, y: 0, depth: 0 }) {
  const b = basis(v);
  const dx = p.x - v.cam.x;
  const dy = p.y - v.cam.y;
  const dz = p.z - v.cam.z;
  const zc = dx * b.fx + dy * b.fy + dz * b.fz;
  const xc = dx * b.rx + dz * b.rz;
  const yc = dx * b.ux + dy * b.uy + dz * b.uz;
  out.x = ((xc / (zc * b.tan * v.aspect)) * 0.5 + 0.5) * v.width;
  out.y = (0.5 - (yc / (zc * b.tan)) * 0.5) * v.height;
  out.depth = zc;
  return out;
}

/** Screen px -> the world x where that pixel's ray crosses the rim's plane (z = 0) at the rim's height row. */
export function toRimPlane(v: View, sx: number, sy: number): { x: number; y: number } {
  const b = basis(v);
  const nx = (sx / v.width) * 2 - 1;
  const ny = 1 - (sy / v.height) * 2;
  const dx = b.fx + b.rx * nx * b.tan * v.aspect + b.ux * ny * b.tan;
  const dy = b.fy + b.uy * ny * b.tan;
  const dz = b.fz + b.rz * nx * b.tan * v.aspect + b.uz * ny * b.tan;
  const t = dz < -1e-6 ? -v.cam.z / dz : 1e4;
  return { x: v.cam.x + dx * t, y: v.cam.y + dy * t };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a flick
// ---------------------------------------------------------------------------------------------------------------
export interface Sample {
  x: number;
  y: number;
  /** ms */
  t: number;
}

export interface Flick {
  /** "shot": a real throw; "soft": too slow or short to count; "none": not a throw at all. */
  kind: "shot" | "soft" | "none";
  dx: number;
  dy: number;
  /** px/s */
  speed: number;
}

const NONE: Flick = { kind: "none", dx: 0, dy: 0, speed: 0 };

/** Turns the finger's path into a flick. `n` samples of `pts` are used (the game reuses one buffer). */
export function readFlick(pts: readonly Sample[], n = pts.length): Flick {
  if (n < 2) return NONE;
  const a = pts[0]!;
  // The flick starts where the finger begins to move (resting a thumb on the ball first is fine).
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
  if (len < 24) return NONE;
  // Up, or up and across, but not sideways or down.
  if (dy > -0.55 * Math.abs(dx) || dy > -16) return NONE;
  const dur = Math.max(0.04, (p1.t - p0.t) / 1000);
  let speed = len / dur;
  // A flick that whips through its end counts its release speed too.
  for (let i = n - 2; i >= s; i--) {
    const q = pts[i]!;
    if (p1.t - q.t >= 60) {
      const late = Math.hypot(p1.x - q.x, p1.y - q.y) / Math.max(0.04, (p1.t - q.t) / 1000);
      speed = Math.max(speed, late * 0.85);
      break;
    }
  }
  if (len < 56 || speed < 320) return { kind: "soft", dx, dy, speed };
  return { kind: "shot", dx, dy, speed };
}

/**
 * How far a flick throws: mostly its length (as a share of the screen height), partly its speed. A natural flick of
 * about a quarter of the screen reaches the first spot; longer or faster flicks go deeper.
 */
export const THROW_PER_PUSH = 5.15;
const LEN_REF = 0.3;
const SPEED_LO = 380;
const SPEED_SPAN = 2400;
const SPEED_REF = 0.6;
export const W_LEN = 0.72;
export const W_SPEED = 0.28;

export function pushOf(len: number, speed: number, height: number): number {
  const ln = len / height;
  const sn = clamp((speed - SPEED_LO) / SPEED_SPAN);
  return W_LEN * (ln / LEN_REF) + W_SPEED * (sn / SPEED_REF);
}

/** The flick length (px) that makes `push` at a given speed. */
export function lengthForPush(push: number, speed: number, height: number): number {
  const sn = clamp((speed - SPEED_LO) / SPEED_SPAN);
  return Math.max(40, ((push - W_SPEED * (sn / SPEED_REF)) / W_LEN) * LEN_REF * height);
}

export interface Aim {
  /** Where the flick pointed on the rim's plane (before assist) and how far it throws. */
  rawX: number;
  rawD: number;
  /** After assist: the point the ball crosses rim height on its way down. */
  target: Vec3;
  /** Horizontal throw distance after assist. */
  dist: number;
  /** Seconds to that point. */
  flight: number;
}

/** Launch speed for a throw of horizontal distance `d` that comes down through rim height. */
export function speedFor(d: number): number {
  const h = RIM_Y - BALL_Y;
  const c = Math.cos(ELEV);
  const den = 2 * c * c * (d * Math.tan(ELEV) - h);
  return den > 0 ? Math.sqrt((G * d * d) / den) : 6;
}
export const flightFor = (d: number): number => d / (speedFor(d) * Math.cos(ELEV));

/**
 * The invisible assist: an error `e` inside the window is shrunk by `a`; beyond it the pull fades out over one more
 * window, so a wild throw stays wild. Monotonic in `e`, so a longer flick never lands shorter.
 */
export function assistCurve(e: number, win: number, a: number): number {
  const u = Math.abs(e) / win;
  const k = u <= 1 ? 1 : u >= 2 ? 0 : 1 - (u - 1) * (u - 1) * (3 - 2 * (u - 1));
  return e * (1 - a * k);
}

/**
 * Maps a flick to the point the ball will cross rim height on the way down, with the stage's assist pulling a near
 * miss toward the rim's centre where the hoop will be when the ball arrives (or, for a moving hoop, partly toward it:
 * `stage.lead` of the travel is forgiven, the rest is yours to lead).
 */
export function aimFor(v: View, stage: Stage, motion: Motion, t0: number, f: Flick): Aim {
  const spot = stage.spot;
  const b = project(v, { x: spot.x, y: BALL_Y, z: spot.z });
  const hx0 = hoopX(motion, t0);
  const row = project(v, { x: hx0, y: RIM_Y, z: 0 });
  const len = Math.hypot(f.dx, f.dy) || 1;
  // Follow the flick's direction from the ball to the screen row of the rim, then onto the rim's plane.
  const k = (row.y - b.y) / Math.min(-0.2, f.dy / len);
  const sx = b.x + (f.dx / len) * k;
  const rawX = clamp(toRimPlane(v, sx, row.y).x, -12, 12);
  const rawD = pushOf(len, f.speed, v.height) * THROW_PER_PUSH;
  // Where the hoop will be: iterate the flight time once on the rim's distance.
  let tf = flightFor(stage.dist);
  let xs = hoopX(motion, t0 + tf);
  tf = flightFor(Math.hypot(xs - spot.x, spot.z));
  xs = hoopX(motion, t0 + tf);
  // Anywhere between "where it is now" (as far as the stage forgives) and "where it will be" counts as dead on, so
  // flicking at the hoop works early on and leading it properly always works.
  const xLo = hx0 + (1 - stage.lead) * (xs - hx0);
  const segLo = Math.min(xLo, xs);
  const segHi = Math.max(xLo, xs);
  const xRef = rawX < segLo ? segLo : rawX > segHi ? segHi : rawX;
  const dStar = Math.hypot(xs - spot.x, spot.z);
  const ex = assistCurve(rawX - xRef, stage.winX, stage.assist);
  const ed = assistCurve(rawD - dStar, stage.winD, stage.assist);
  const ax = xs + ex;
  const dist = clamp(dStar + ed, 1.2, 12);
  // Along the bearing from the spot to the assisted point on the rim's plane.
  const bx = ax - spot.x;
  const bz = -spot.z;
  const bl = Math.hypot(bx, bz) || 1;
  const target = { x: spot.x + (bx / bl) * dist, y: RIM_Y, z: spot.z + (bz / bl) * dist };
  return { rawX, rawD, target, dist, flight: flightFor(dist) };
}

/** The inverse, for the pilot and the ghost finger: the flick that points at world x on the rim's plane and throws `d`. */
export function flickFor(v: View, stage: Stage, motion: Motion, t0: number, x: number, d: number, speed: number): Flick {
  const spot = stage.spot;
  const b = project(v, { x: spot.x, y: BALL_Y, z: spot.z });
  const hx0 = hoopX(motion, t0);
  const row = project(v, { x: hx0, y: RIM_Y, z: 0 });
  const p = project(v, { x, y: RIM_Y, z: 0 });
  // The screen point on the rim's row under x (the row is the same for any x on the plane only approximately; use p.x).
  const dx = p.x - b.x;
  const dy = row.y - b.y;
  const dl = Math.hypot(dx, dy) || 1;
  const len = lengthForPush(d / THROW_PER_PUSH, speed, v.height);
  return { kind: "shot", dx: (dx / dl) * len, dy: (dy / dl) * len, speed };
}

// ---------------------------------------------------------------------------------------------------------------
// A shot, simulated to its end
// ---------------------------------------------------------------------------------------------------------------
export type Outcome = "swish" | "rim" | "bank" | "miss";
export type MissKind = "short" | "long" | "wide" | "rim" | "board" | "inout";

export interface ShotEvent {
  t: number;
  kind: "rim" | "board" | "net" | "score" | "floor";
  x: number;
  y: number;
  z: number;
  /** Impact speed (m/s). */
  power: number;
}

export interface Shot {
  frames: Float32Array;
  n: number;
  events: ShotEvent[];
  outcome: Outcome;
  miss: MissKind | null;
  /** Seconds after the release: when it went through (or -1), when the result is certain, end of the recording. */
  scoredAt: number;
  decided: number;
  end: number;
  rimHits: number;
  boardHit: boolean;
  /** Run time of the release (the hoop motion is read at t0 + t). */
  t0: number;
  /** Closest the ball's centre came to the rim's centre as it crossed rim height. */
  margin: number;
}

export const newFrames = (): Float32Array => new Float32Array(MAX_FRAMES * FRAME_STRIDE);

/** Launch velocity that carries the ball from the spot to `target` (at rim height, coming down). */
export function launchFor(spot: Vec2, target: Vec3): Vec3 {
  const dx = target.x - spot.x;
  const dz = target.z - spot.z;
  const d = Math.hypot(dx, dz) || 1;
  const v = speedFor(d);
  const h = v * Math.cos(ELEV);
  return { x: (dx / d) * h, y: v * Math.sin(ELEV), z: (dz / d) * h };
}

export function simulateShot(spot: Vec2, vel: Vec3, motion: Motion, t0: number, frames: Float32Array): Shot {
  let x = spot.x;
  let y = BALL_Y;
  let z = spot.z;
  let vx = vel.x;
  let vy = vel.y;
  let vz = vel.z;
  const events: ShotEvent[] = [];
  let n = 0;
  let t = 0;
  let rimHits = 0;
  let rimCool = 0;
  let boardHit = false;
  let boardBeforeScore = false;
  let scoredAt = -1;
  let decided = -1;
  let wasInside = false;
  let netIn = false;
  let floorHits = 0;
  let margin = Infinity;
  let crossZ = NaN;
  let crossX = NaN;
  let peakAboveRim = false;
  const rec = () => {
    if (n >= MAX_FRAMES) return;
    const o = n * FRAME_STRIDE;
    frames[o] = t;
    frames[o + 1] = x;
    frames[o + 2] = y;
    frames[o + 3] = z;
    n++;
  };
  rec();
  let nextFrame = 1 / FRAME_HZ;
  while (t < MAX_T) {
    const hx = hoopX(motion, t0 + t);
    const py = y;
    vy -= G * STEP;
    x += vx * STEP;
    y += vy * STEP;
    z += vz * STEP;
    t += STEP;
    rimCool -= STEP;
    if (y > RIM_Y - 0.3) peakAboveRim = true;

    // Rim: closest point on the ring's centre circle to the ball's centre.
    const qx = x - hx;
    const qz = z;
    const ql = Math.hypot(qx, qz);
    if (Math.abs(y - RIM_Y) < BALL_R + RIM_TUBE + 0.02 && ql < RIM_R + BALL_R + RIM_TUBE + 0.02) {
      const cx = ql > 1e-6 ? hx + (qx / ql) * RIM_R : hx + RIM_R;
      const cz = ql > 1e-6 ? (qz / ql) * RIM_R : 0;
      let nx = x - cx;
      let ny = y - RIM_Y;
      let nz = z - cz;
      const dl = Math.hypot(nx, ny, nz);
      const reach = BALL_R + RIM_TUBE;
      if (dl < reach && dl > 1e-6) {
        nx /= dl;
        ny /= dl;
        nz /= dl;
        x += nx * (reach - dl);
        y += ny * (reach - dl);
        z += nz * (reach - dl);
        const rvx = vx - hoopVX(motion, t0 + t);
        const vn = rvx * nx + vy * ny + vz * nz;
        if (vn < 0) {
          // Normal bounce plus a little grip on the iron.
          const jx = -(1 + E_RIM) * vn * nx;
          const jy = -(1 + E_RIM) * vn * ny;
          const jz = -(1 + E_RIM) * vn * nz;
          const tx = rvx - vn * nx;
          const ty = vy - vn * ny;
          const tz = vz - vn * nz;
          vx += jx - tx * 0.12;
          vy += jy - ty * 0.12;
          vz += jz - tz * 0.12;
          if (rimCool <= 0) {
            rimHits++;
            events.push({ t, kind: "rim", x: cx, y: RIM_Y, z: cz, power: -vn });
          }
          rimCool = 0.06;
        }
      }
    }

    // Backboard: the front face, within its edges.
    if (z - BALL_R < BOARD_Z && z > BOARD_Z - 0.12 && vz < 0 && Math.abs(x - hx) < BOARD_W / 2 + BALL_R * 0.4 && y > BOARD_BOTTOM - BALL_R * 0.4 && y < BOARD_BOTTOM + BOARD_H + BALL_R * 0.4) {
      z = BOARD_Z + BALL_R;
      const p = -vz;
      vz = -vz * E_BOARD;
      vx = vx * 0.86 + hoopVX(motion, t0 + t) * 0.14;
      vy *= 0.9;
      if (!boardHit || p > 0.8) events.push({ t, kind: "board", x, y, z: BOARD_Z, power: p });
      boardHit = true;
      if (scoredAt < 0) boardBeforeScore = true;
    }

    // Through the ring: the centre crosses just under the rim's plane, inside it, coming down.
    const r = Math.hypot(x - hx, z);
    if (py >= RIM_Y && y < RIM_Y && vy < 0) {
      margin = Math.min(margin, r);
      if (Number.isNaN(crossZ)) {
        crossZ = z;
        crossX = x - hx;
      }
    }
    if (r < RIM_R && y > RIM_Y - 0.12 && y < RIM_Y + 0.16) wasInside = true;
    if (scoredAt < 0 && py >= RIM_Y - 0.06 && y < RIM_Y - 0.06 && vy < 0 && r < RIM_R - 0.025) {
      scoredAt = t;
      events.push({ t, kind: "score", x: hx, y: RIM_Y, z: 0, power: -vy });
    }
    // The net catches the ball: it slows and funnels toward the middle.
    if (r < RIM_R + 0.02 && y < RIM_Y - 0.02 && y > RIM_Y - NET_DEPTH && vy < 0) {
      if (!netIn) {
        netIn = true;
        events.push({ t, kind: "net", x, y, z, power: Math.hypot(vx, vy, vz) });
      }
      const k = Math.exp(-3.2 * STEP);
      vx = (vx - (x - hx) * 9 * STEP) * k + hoopVX(motion, t0 + t) * (1 - k);
      vz = (vz - z * 9 * STEP) * k;
      vy *= Math.exp(-1.6 * STEP);
    }

    // Court.
    if (y < BALL_R) {
      y = BALL_R;
      if (vy < 0) {
        const p = -vy;
        vy = p > 0.5 ? p * E_FLOOR : 0;
        vx *= 0.82;
        vz *= 0.82;
        if (p > 0.5) {
          floorHits++;
          events.push({ t, kind: "floor", x, y: 0, z, power: p });
        }
      }
    }

    if (decided < 0) {
      if (scoredAt >= 0) decided = scoredAt;
      else if (t > 0.3 && vy < 0 && y < RIM_Y - 0.45 && peakAboveRim) decided = t;
      else if (floorHits > 0) decided = t;
    }
    while (t >= nextFrame && n < MAX_FRAMES) {
      rec();
      nextFrame += 1 / FRAME_HZ;
    }
    if (decided >= 0 && t > decided + 1.25 && (floorHits >= 2 || t > decided + 1.7)) break;
  }
  if (decided < 0) decided = t;

  let outcome: Outcome;
  let miss: MissKind | null = null;
  if (scoredAt >= 0) outcome = boardBeforeScore ? "bank" : rimHits > 0 ? "rim" : "swish";
  else {
    outcome = "miss";
    if (rimHits > 0) miss = wasInside && rimHits >= 2 ? "inout" : "rim";
    else if (boardHit) miss = "board";
    else if (!Number.isNaN(crossZ) && crossZ > RIM_R) miss = "short";
    else if (!Number.isNaN(crossX) && Math.abs(crossX) > RIM_R + 0.1) miss = "wide";
    else if (Number.isNaN(crossZ)) miss = "short";
    else miss = "long";
  }
  return { frames, n, events, outcome, miss, scoredAt, decided, end: t, rimHits, boardHit, t0, margin: Number.isFinite(margin) ? margin : 9 };
}

/** Ball position at time t of a recorded shot. */
export function sampleShot(s: Shot, t: number, out: Vec3): Vec3 {
  const f = s.frames;
  const i = clamp(Math.floor(t * FRAME_HZ), 0, s.n - 2);
  const o = i * FRAME_STRIDE;
  const t0 = f[o]!;
  const t1 = f[o + FRAME_STRIDE]!;
  const k = t1 > t0 ? clamp((t - t0) / (t1 - t0)) : 0;
  out.x = lerp(f[o + 1]!, f[o + FRAME_STRIDE + 1]!, k);
  out.y = lerp(f[o + 2]!, f[o + FRAME_STRIDE + 2]!, k);
  out.z = lerp(f[o + 3]!, f[o + FRAME_STRIDE + 3]!, k);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The run: the clock, points, the streak, stages
// ---------------------------------------------------------------------------------------------------------------
export const START_CLOCK = 24;
export const MAX_CLOCK = 30;
/** The last seconds on the clock: every make is worth double. */
export const FRENZY_T = 5;
/** Seconds back: the base for a make, more for a swish, extra for a bonus ball. */
export const REFILL_MAKE = 1.55;
export const REFILL_SWISH = 2.35;
export const REFILL_BONUS = 1.6;
/** A bonus ball every this many balls from stage 2 on. */
export const BONUS_EVERY = 6;

/** The clock burns faster the longer you last: 1 s/s at the tip-off, about 2 s/s a minute and a half in. */
export const drainAt = (elapsed: number): number => 1 + Math.min(1.4, (elapsed / 85) ** 1.25);

/** Streak multiplier: 3 in a row is hot, 6 on fire, 10 a rimflare. */
export function multFor(streak: number): number {
  return streak >= 10 ? 4 : streak >= 6 ? 3 : streak >= 3 ? 2 : 1;
}
export const HEAT_NAMES = ["", "", "HOT HAND", "ON FIRE", "RIMFLARE"] as const;

export interface Award {
  points: number;
  outcome: Outcome;
  tags: string[];
  refill: number;
  mult: number;
  /** The streak just reached a new multiplier. */
  tierUp: boolean;
  /** This make cleared the stage. */
  stageUp: boolean;
  bonus: boolean;
  frenzy: boolean;
  buzzer: boolean;
}

export class Run {
  clock = START_CLOCK;
  elapsed = 0;
  score = 0;
  shots = 0;
  makes = 0;
  swishes = 0;
  banks = 0;
  rims = 0;
  bonusMakes = 0;
  streak = 0;
  bestStreak = 0;
  stage = 0;
  stageMakes = 0;
  /** A stage was cleared; the next one starts once every ball in the air has come down. */
  pendingStage = false;
  /** The buzzer has gone: no more shots. */
  buzzer = false;
  best: Award | null = null;
  misses: Record<MissKind, number> = { short: 0, long: 0, wide: 0, rim: 0, board: 0, inout: 0 };
  softs = 0;
  /** Clock seconds given back over the run, and the largest single refill. */
  refilled = 0;

  get mult(): number {
    return multFor(this.streak);
  }
  get frenzy(): boolean {
    return !this.buzzer && this.clock <= FRENZY_T;
  }
  stageDef(): Stage {
    return stageFor(this.stage);
  }
  /** Is the next ball (the shot about to be taken) a bonus ball? */
  nextIsBonus(): boolean {
    return this.stage >= 1 && (this.shots + 1) % BONUS_EVERY === 0;
  }

  /** Advance the clock; `frozen` while the camera moves to a new spot. Returns true on the frame the buzzer goes. */
  tick(dt: number, frozen = false): boolean {
    if (this.buzzer) return false;
    this.elapsed += dt;
    if (frozen) return false;
    this.clock -= dt * drainAt(this.elapsed);
    if (this.clock <= 0) {
      this.clock = 0;
      this.buzzer = true;
      return true;
    }
    return false;
  }

  /** A ball leaves the hand. Returns whether it is a bonus ball. */
  take(): boolean {
    const bonus = this.nextIsBonus();
    this.shots++;
    return bonus;
  }

  /** A shot has come down. `afterBuzzer` = it was in the air when the buzzer went. */
  settle(s: Shot, dist: number, bonus: boolean, afterBuzzer: boolean): Award {
    const made = s.outcome !== "miss";
    if (!made) {
      this.streak = 0;
      this.misses[s.miss ?? "short"]++;
      return { points: 0, outcome: s.outcome, tags: [], refill: 0, mult: 1, tierUp: false, stageUp: false, bonus, frenzy: false, buzzer: false };
    }
    const before = multFor(this.streak);
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.makes++;
    const mult = multFor(this.streak);
    const tags: string[] = [];
    let base = 100;
    if (s.outcome === "swish") {
      base = 150;
      this.swishes++;
      tags.push("SWISH");
    } else if (s.outcome === "bank") {
      base = 125;
      this.banks++;
      tags.push("OFF THE GLASS");
    } else {
      this.rims++;
      if (s.rimHits >= 2) {
        base += 25;
        tags.push("ROLLED IN");
      } else tags.push("RIM AND IN");
    }
    const deep = Math.max(0, Math.round((dist - 4.2) * 40));
    if (dist >= 6) tags.push("FROM DOWNTOWN");
    const frenzy = !afterBuzzer && this.clock <= FRENZY_T;
    let pts = (base + deep) * mult * (bonus ? 2 : 1) * (frenzy ? 2 : 1);
    if (bonus) {
      this.bonusMakes++;
      tags.push("BONUS BALL");
    }
    if (frenzy) tags.push("CLUTCH");
    if (afterBuzzer) {
      pts += 250 * mult;
      tags.unshift("BUZZER BEATER");
    }
    this.score += pts;
    let refill = 0;
    let stageUp = false;
    if (!afterBuzzer && !this.buzzer) {
      const st = stageFor(this.stage);
      refill = ((s.outcome === "swish" ? REFILL_SWISH : REFILL_MAKE) + (bonus ? REFILL_BONUS : 0)) * st.refill;
      const room = MAX_CLOCK - this.clock;
      refill = Math.max(0, Math.min(refill, room));
      this.clock += refill;
      this.refilled += refill;
      this.stageMakes++;
      if (!this.pendingStage && this.stageMakes >= st.makes) {
        this.pendingStage = true;
        stageUp = true;
      }
    }
    const award: Award = { points: pts, outcome: s.outcome, tags, refill, mult, tierUp: mult > before, stageUp, bonus, frenzy, buzzer: afterBuzzer };
    if (!this.best || pts > this.best.points) this.best = award;
    return award;
  }

  /** Move on to the next stage (call once every ball is down). */
  advance(): Stage {
    this.pendingStage = false;
    this.stage++;
    this.stageMakes = 0;
    return stageFor(this.stage);
  }

  /** One concrete thing to try next time, from what went wrong most. */
  hint(): string {
    const m = this.misses;
    const total = m.short + m.long + m.wide + m.rim + m.board + m.inout;
    if (this.shots === 0) return "FLICK UP FROM THE BALL. THE CLOCK IS ALREADY RUNNING.";
    if (this.softs >= 3 && this.softs > this.shots / 2) return "A QUICK, LONGER FLICK. TINY ONES DON'T LEAVE YOUR HANDS.";
    if (total === 0) return "PERFECT SHOOTING. NOW DO IT FASTER: THE CLOCK ONLY STOPS FOR MAKES.";
    const worst = (Object.keys(m) as MissKind[]).reduce((a, b) => (m[b] > m[a] ? b : a));
    if (this.makes >= 6 && this.swishes / this.makes < 0.3) return "SWISHES GIVE BACK THE MOST TIME. AIM FOR THE MIDDLE OF THE RIM.";
    switch (worst) {
      case "short":
        return "MOSTLY SHORT. FLICK A LITTLE LONGER, ESPECIALLY FROM DEEP.";
      case "long":
        return "MOSTLY LONG. A SHORTER FLICK DROPS IT IN.";
      case "wide":
        return this.stage >= 2 ? "THE HOOP SLIDES: FLICK A LITTLE AHEAD OF IT." : "FLICK STRAIGHT AT THE RIM; THE BALL GOES WHERE YOUR THUMB POINTS.";
      case "rim":
      case "inout":
        return "CLOSE! A HAIR MORE OR LESS POWER AND THOSE RIM-OUTS DROP.";
      case "board":
        return "OFF THE GLASS AND OUT: EASE OFF THE POWER A TOUCH.";
    }
  }
}
