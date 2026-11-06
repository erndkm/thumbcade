/**
 * Curlwall's rules and physics, pure (no DOM, no Three.js) so the game, the attract pilot, the tests and the
 * headless run-length script all share one source of truth.
 *
 * World: metres, x to the right, y up, z toward the kicker. The goal line is z = 0, the goal mouth spans
 * |x| < GOAL_HW, 0 < y < GOAL_H, and the net box runs back to z = -NET_D.
 *
 * A kick is simulated to the end the moment the ball leaves the boot (wall, posts, keeper and net included), at a
 * fixed 240 Hz, and sampled into a frame buffer the game plays back. That makes every shot deterministic and lets
 * the game slow time down *before* a post rattle or a fingertip near miss instead of after it.
 */
import { clamp, lerp } from "@thumbcade-games/kit/ease";
import type { Rng } from "@thumbcade-games/kit/rng";

// ---------------------------------------------------------------------------------------------------------------
// Pitch and ball
// ---------------------------------------------------------------------------------------------------------------
export const GOAL_HW = 3.66;
export const GOAL_H = 2.44;
export const POST_R = 0.06;
export const BALL_R = 0.11;
export const NET_D = 1.9;
/** The plane the keeper's hands live in, just off the line. */
export const KEEPER_Z = 0.32;
/** Real free-kick distance of the wall from the ball. */
export const WALL_DIST = 9.15;
export const MAN_R = 0.24;
export const MAN_H = 1.78;
export const G = 9.81;
/** Quadratic drag per metre (k in a = -k|v|v): a 30 m/s strike loses about a fifth of its speed over 25 m. */
const DRAG = 0.0105;
/** Magnus coefficient: full side spin at 25 m/s bends about 6 m/s², about 2.5 m of curve from 25 m out. */
const MAGNUS = 0.0038;
export const SPIN_MAX = 62;
const SPIN_DECAY = 0.45;
const STEP = 1 / 240;
export const FRAME_HZ = 120;
/** Floats per recorded frame: t, ball x y z, keeper hands x y, wall lift. */
export const FRAME_STRIDE = 7;
export const MAX_FRAMES = FRAME_HZ * 5;

export const START_BALLS = 3;
export const MAX_BALLS = 3;
/** Kicks at the start of a run that cost no ball. */
export const FREE_KICKS = 2;
/** Shot speed range (m/s) and the flick speeds (px/s) that map onto it. */
export const V_MIN = 15.5;
export const V_MAX = 31;
const FLICK_SLOW = 420;
const FLICK_FAST = 2500;
/** Bow (sideways bulge / chord) that means full curl. */
export const BOW_FULL = 0.2;

// Pacing (seconds). The game uses these too, so the headless run lengths match what a player sees.
export const SETUP_T = 0.95;
export const GOAL_HOLD = 1.45;
export const MISS_HOLD = 1.05;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Kick setups and the difficulty ramp
// ---------------------------------------------------------------------------------------------------------------
export interface KeeperSkill {
  /** Seconds before the first read of the ball. */
  react: number;
  /** Top speed of the hands (m/s) and acceleration (m/s²). */
  speed: number;
  accel: number;
  /** Std-dev-ish prediction error (m) at a long read; shrinks as the ball gets close. */
  err: number;
  /** Reach of the hands around their centre (m). */
  reach: number;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
}

export interface Setup {
  n: number;
  spot: { x: number; z: number };
  /** Mannequin positions on the ground. */
  wall: Vec2[];
  /** How high the wall jumps as the ball goes (m, 0 = flat-footed). */
  wallJump: number;
  keeper: KeeperSkill;
  /** Where the keeper's hands start (x). */
  keeperX: number;
  /** This kick's misread (m), fixed per kick so the shot stays deterministic. */
  errX: number;
  errY: number;
  /** Side wind (m/s², + pushes toward +x). */
  wind: number;
  rings: Ring[];
}

/** 0 for the opening kicks, 1 once the run is fully nasty (kick 13). */
export const difficulty = (n: number): number => clamp((n - 2) / 11);

export const RING_R = 0.42;
export const RINGS: Ring[] = [
  { x: -(GOAL_HW - 0.52), y: GOAL_H - 0.5, r: RING_R },
  { x: GOAL_HW - 0.52, y: GOAL_H - 0.5, r: RING_R },
];

export function setupFor(n: number, rng: Rng): Setup {
  const d = difficulty(n);
  /** Past the full ramp it keeps tightening slowly, so even a great run ends. */
  const late = clamp((n - 12) / 9);
  let z: number;
  let x: number;
  if (n === 0) {
    z = 17.5;
    x = 0;
  } else if (n === 1) {
    z = 18.5;
    x = rng.range(-2.2, 2.2);
  } else {
    z = lerp(18, 22.5, d) + late * 1.2 + rng.range(-0.8, 0.8);
    x = (rng.chance(0.5) ? -1 : 1) * rng.range(0.15, 1) * lerp(3.5, 7.5, d);
  }
  const count = n === 0 ? 0 : n === 1 ? 2 : n < 6 ? 3 : Math.round(lerp(3, 4.4, d));
  const wallJump = d > 0.3 ? lerp(0.1, 0.26, (d - 0.3) / 0.7) : 0;
  const keeper: KeeperSkill =
    n === 0
      ? { react: 0.75, speed: 1.8, accel: 10, err: 0.9, reach: 0.46 }
      : n === 1
        ? { react: 0.55, speed: 2.8, accel: 14, err: 0.8, reach: 0.48 }
        : { react: lerp(0.46, 0.32, d), speed: lerp(3.0, 3.5, d) + late * 0.35, accel: lerp(15, 21, d), err: lerp(0.7, 0.38, d) - late * 0.08, reach: lerp(0.48, 0.55, d) };
  const side = Math.abs(x) < 0.6 ? (rng.chance(0.5) ? 1 : -1) : Math.sign(x);
  const wall = wallFor({ x, z }, count, side);
  // The keeper shades toward the side the wall doesn't cover.
  const keeperX = count ? -side * lerp(0.3, 0.45, d) : 0;
  const tri = () => rng() + rng() - 1;
  const wind = n >= 8 ? (rng.chance(0.5) ? -1 : 1) * rng.range(0.4, 1) * lerp(0.8, 2.4, clamp((n - 8) / 10)) : 0;
  // Late in a run the rings tighten.
  const rings = late > 0 ? RINGS.map((r) => ({ ...r, r: lerp(RING_R, 0.32, late) })) : RINGS;
  return { n, spot: { x, z }, wall, wallJump, keeper, keeperX, errX: tri() * 1.3, errY: tri() * 0.8, wind, rings };
}

/** The wall stands 9.15 m out on the line to the near half of the goal, its outer man just covering the near post. */
export function wallFor(spot: { x: number; z: number }, count: number, side: number): Vec2[] {
  if (!count) return [];
  const aimX = side * GOAL_HW * 0.55;
  const dx = aimX - spot.x;
  const dz = -spot.z;
  const len = Math.hypot(dx, dz);
  const cx = spot.x + (dx / len) * WALL_DIST;
  const cz = spot.z + (dz / len) * WALL_DIST;
  // Perpendicular on the ground.
  const px = -dz / len;
  const pz = dx / len;
  const out: Vec2[] = [];
  const gap = 0.52;
  for (let i = 0; i < count; i++) {
    const o = (i - (count - 1) / 2) * gap;
    out.push({ x: cx + px * o, y: cz + pz * o });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Camera (shared by the renderer and the input mapping, so "flick where you want it" lines up exactly)
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

export const CAM_BACK = 4.7;
export const CAM_H = 1.98;

export function viewFor(spot: { x: number; z: number }, width: number, height: number): View {
  const len = Math.hypot(spot.x, spot.z) || 1;
  const dist = len;
  const back = CAM_BACK;
  return {
    cam: { x: spot.x + (spot.x / len) * back, y: CAM_H, z: spot.z + (spot.z / len) * back },
    look: { x: spot.x * 0.22, y: 1.25, z: 0 },
    fov: lerp(50, 41, clamp((dist - 17) / 12)),
    aspect: width / height,
    width,
    height,
  };
}

interface Basis {
  fx: number;
  fy: number;
  fz: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  tan: number;
}

const SCRATCH_BASIS: Basis = { fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, tan: 0 };

/** The camera's axes, written into a shared scratch object (no garbage per call). */
function basis(v: View, b: Basis = SCRATCH_BASIS): Basis {
  let fx = v.look.x - v.cam.x;
  let fy = v.look.y - v.cam.y;
  let fz = v.look.z - v.cam.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // r = f × up(0,1,0)
  let rx = -fz;
  const ry = 0;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  // u = r × f
  b.fx = fx;
  b.fy = fy;
  b.fz = fz;
  b.rx = rx;
  b.ry = ry;
  b.rz = rz;
  b.ux = ry * fz - rz * fy;
  b.uy = rz * fx - rx * fz;
  b.uz = rx * fy - ry * fx;
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
  const xc = dx * b.rx + dy * b.ry + dz * b.rz;
  const yc = dx * b.ux + dy * b.uy + dz * b.uz;
  const nx = xc / (zc * b.tan * v.aspect);
  const ny = yc / (zc * b.tan);
  out.x = (nx * 0.5 + 0.5) * v.width;
  out.y = (0.5 - ny * 0.5) * v.height;
  out.depth = zc;
  return out;
}

/** Screen px -> the point on the goal plane (z = 0) under it. */
export function toGoalPlane(v: View, sx: number, sy: number): Vec2 {
  const b = basis(v);
  const nx = (sx / v.width) * 2 - 1;
  const ny = 1 - (sy / v.height) * 2;
  const dx = b.fx + b.rx * nx * b.tan * v.aspect + b.ux * ny * b.tan;
  const dy = b.fy + b.ry * nx * b.tan * v.aspect + b.uy * ny * b.tan;
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
  /** "kick": a real shot; "soft": too slow or short to count, the ball just dribbles; "none": not a shot at all. */
  kind: "kick" | "soft" | "none";
  dx: number;
  dy: number;
  /** px/s */
  speed: number;
  /** Signed sideways bulge of the path over its chord (+ = bulges to the right). */
  bow: number;
}

const NONE: Flick = { kind: "none", dx: 0, dy: 0, speed: 0, bow: 0 };

/** Turns the finger's path into a flick. `n` samples of `pts` are used (the game reuses one buffer). */
export function readFlick(pts: readonly Sample[], n = pts.length): Flick {
  if (n < 2) return NONE;
  const a = pts[0]!;
  // The flick starts where the finger begins to move (a thumb resting on the ball first is fine).
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
  if (dy > -0.45 * Math.abs(dx) || dy > -18) return NONE;
  const dur = Math.max(0.045, (p1.t - p0.t) / 1000);
  let speed = len / dur;
  // A flick that accelerates through the end counts its release speed too.
  for (let i = n - 2; i >= s; i--) {
    const q = pts[i]!;
    if (p1.t - q.t >= 70) {
      const late = Math.hypot(p1.x - q.x, p1.y - q.y) / Math.max(0.045, (p1.t - q.t) / 1000);
      speed = Math.max(speed, late * 0.85);
      break;
    }
  }
  // Signed perpendicular bulge: the sample farthest from the chord.
  const nx = -dy / len;
  const ny = dx / len;
  let bow = 0;
  for (let i = s + 1; i < n - 1; i++) {
    const q = pts[i]!;
    const d = (q.x - p0.x) * nx + (q.y - p0.y) * ny;
    if (Math.abs(d) > Math.abs(bow)) bow = d;
  }
  // nx/ny points to the right of an upward chord, so a positive d bulges right.
  bow = clamp(bow / len, -0.5, 0.5);
  if (len < 70 || speed < FLICK_SLOW * 0.82) return { kind: "soft", dx, dy, speed, bow };
  return { kind: "kick", dx, dy, speed, bow };
}

export const powerOf = (speed: number): number => clamp((speed - FLICK_SLOW) / (FLICK_FAST - FLICK_SLOW));
export const shotSpeed = (speed: number): number => lerp(V_MIN, V_MAX, powerOf(speed) ** 0.85);
export function curlOf(bow: number): number {
  const a = Math.abs(bow);
  if (a < 0.025) return 0;
  return clamp((-Math.sign(bow) * (a - 0.025)) / (BOW_FULL - 0.025), -1, 1);
}

export interface Aim {
  /** Aim point on the goal plane, after assist. */
  x: number;
  y: number;
  /** Where the flick pointed before assist. */
  rawX: number;
  rawY: number;
  speed: number;
  curl: number;
}

/**
 * Mild aim assist: a flick that would just miss the frame is pulled a little inside, and a flick near a corner
 * ring is drawn toward its centre. Way off stays way off.
 */
export function assist(x: number, y: number, rings: readonly Ring[]): Vec2 {
  // Within 0.9 m outside a line just inside the frame, the aim is squeezed back to just inside it.
  const squeeze = (v: number, edge: number) => {
    const o = v - edge;
    if (o <= 0 || o >= 1.8) return v;
    // 0..0.9 m out squeezes to 0..8 cm, 0.9..1.8 m eases back to where it pointed.
    return edge + (o < 0.9 ? (o / 0.9) * 0.08 : 0.08 + ((o - 0.9) / 0.9) * 1.72);
  };
  const edgeX = GOAL_HW - POST_R - BALL_R - 0.12;
  const ax0 = Math.sign(x) * squeeze(Math.abs(x), edgeX);
  let ax = ax0;
  let ay = squeeze(y, GOAL_H - POST_R - BALL_R - 0.12);
  if (ay < 0.15) ay = 0.15;
  for (const r of rings) {
    const d = Math.hypot(ax - r.x, ay - r.y);
    if (d < r.r * 2.2) {
      const k = 0.5 * (1 - d / (r.r * 2.2));
      ax += (r.x - ax) * k;
      ay += (r.y - ay) * k;
    }
  }
  return { x: ax, y: ay };
}

/**
 * Flick length (as a fraction of the screen height) that aims at the foot of the goal and at the crossbar. Height
 * comes from how far you flick, direction from where you flick: a wide window, so a natural flick finds the goal.
 */
export const LEN_LOW = 0.13;
export const LEN_BAR = 0.43;
const heightFor = (len: number, h: number) => 0.15 + ((len / h - LEN_LOW) / (LEN_BAR - LEN_LOW)) * (GOAL_H - 0.15);
const lengthFor = (y: number, h: number) => (LEN_LOW + ((y - 0.15) / (GOAL_H - 0.15)) * (LEN_BAR - LEN_LOW)) * h;

export function aimFor(v: View, spot: { x: number; z: number }, f: Flick, rings: readonly Ring[]): Aim {
  const b = project(v, { x: spot.x, y: BALL_R, z: spot.z });
  const len = Math.hypot(f.dx, f.dy) || 1;
  const rawY = clamp(heightFor(len, v.height), -0.5, 6);
  // Follow the flick's direction from the ball up to the screen row of that height on the goal plane.
  const row = project(v, { x: spot.x * 0.25, y: Math.max(0, rawY), z: 0 });
  const k = (row.y - b.y) / (f.dy / len);
  const sx = b.x + (f.dx / len) * k;
  const p = toGoalPlane(v, sx, row.y);
  const rawX = clamp(p.x, -14, 14);
  const a = assist(rawX, rawY, rings);
  return { x: a.x, y: a.y, rawX, rawY, speed: shotSpeed(f.speed), curl: curlOf(f.bow) };
}

/** The inverse, for the pilot: the flick that aims at a point with a given speed and curl. */
export function flickFor(v: View, spot: { x: number; z: number }, target: Vec2, speed: number, curl: number): Flick {
  const b = project(v, { x: spot.x, y: BALL_R, z: spot.z });
  const len = lengthFor(target.y, v.height);
  // The screen point on the same row as the aim height, under the target.
  const row = project(v, { x: spot.x * 0.25, y: Math.max(0, target.y), z: 0 });
  const t = project(v, { x: target.x, y: target.y, z: 0 });
  const dx = t.x - b.x;
  const dy = row.y - b.y;
  const dl = Math.hypot(dx, dy) || 1;
  const p = clamp((speed - V_MIN) / (V_MAX - V_MIN)) ** (1 / 0.85);
  const px = FLICK_SLOW + p * (FLICK_FAST - FLICK_SLOW);
  const a = Math.abs(curl);
  const bow = a < 1e-3 ? 0 : -Math.sign(curl) * (0.025 + a * (BOW_FULL - 0.025));
  return { kind: "kick", dx: (dx / dl) * len, dy: (dy / dl) * len, speed: px, bow };
}

// ---------------------------------------------------------------------------------------------------------------
// Ball flight
// ---------------------------------------------------------------------------------------------------------------
export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin vector (rad/s). */
  wx: number;
  wy: number;
  wz: number;
}

/** One integration step of the ball in the air: gravity, drag, Magnus, wind. */
export function flyStep(b: Ball, dt: number, wind: number): void {
  const v = Math.hypot(b.vx, b.vy, b.vz);
  // a = -k|v|v + m (ω × v) + g + wind
  const ax = -DRAG * v * b.vx + MAGNUS * (b.wy * b.vz - b.wz * b.vy) + wind;
  const ay = -DRAG * v * b.vy + MAGNUS * (b.wz * b.vx - b.wx * b.vz) - G;
  const az = -DRAG * v * b.vz + MAGNUS * (b.wx * b.vy - b.wy * b.vx);
  b.vx += ax * dt;
  b.vy += ay * dt;
  b.vz += az * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  const k = Math.exp(-SPIN_DECAY * dt);
  b.wx *= k;
  b.wy *= k;
  b.wz *= k;
}

export interface Launch {
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
}

/** Topspin for dip: harder strikes dip a little more. */
const dipFor = (speed: number) => -lerp(5, 21, clamp((speed - V_MIN) / (V_MAX - V_MIN)));

function launchBall(spot: { x: number; z: number }, l: Launch, out: Ball): Ball {
  out.x = spot.x;
  out.y = BALL_R;
  out.z = spot.z;
  out.vx = l.vx;
  out.vy = l.vy;
  out.vz = l.vz;
  out.wx = l.wx;
  out.wy = l.wy;
  out.wz = 0;
  return out;
}

const scratch: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 };

/** Flies a launch with no wall, keeper or wind and returns where it crosses the goal plane (or a low guess if it lands short). */
function crossing(spot: { x: number; z: number }, l: Launch): Vec2 {
  const b = launchBall(spot, l, scratch);
  for (let i = 0; i < 240 * 4; i++) {
    const pz = b.z;
    const px = b.x;
    const py = b.y;
    flyStep(b, STEP, 0);
    if (b.z <= 0) {
      const k = pz / (pz - b.z);
      return { x: px + (b.x - px) * k, y: py + (b.y - py) * k };
    }
    if (b.y < BALL_R && b.vy < 0) return { x: b.x, y: -0.4 * b.z };
  }
  return { x: b.x, y: -5 };
}

/**
 * Finds the launch that carries the ball to `target` on the goal plane at `speed` with `curl` (-1..1, + bends to
 * the right). The curve changes the path, not the end point: a bowed flick still lands where it was aimed.
 */
export function solveKick(spot: { x: number; z: number }, target: Vec2, speed: number, curl: number): Launch {
  const dist = Math.hypot(target.x - spot.x, spot.z);
  let yaw = Math.atan2(target.x - spot.x, spot.z);
  // First guess for elevation: the straight line plus a gravity allowance.
  const tFlight = dist / (speed * 0.88);
  let pitch = Math.atan2(target.y - BALL_R + 0.5 * G * tFlight * tFlight, dist);
  const wy = -curl * SPIN_MAX;
  const wxBase = dipFor(speed);
  const l: Launch = { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0 };
  const set = () => {
    const c = Math.cos(pitch);
    l.vx = Math.sin(yaw) * c * speed;
    l.vz = -Math.cos(yaw) * c * speed;
    l.vy = Math.sin(pitch) * speed;
    // Spin axis turns with the shot so "side" stays side.
    l.wx = wxBase * Math.cos(yaw);
    l.wy = wy;
  };
  for (let it = 0; it < 9; it++) {
    set();
    const c = crossing(spot, l);
    const ex = target.x - c.x;
    const ey = target.y - c.y;
    if (Math.abs(ex) < 0.01 && Math.abs(ey) < 0.01) break;
    yaw += Math.atan2(ex, dist) * 0.95;
    pitch = clamp(pitch + Math.atan2(ey, dist) * 0.9, -0.06, 0.78);
  }
  set();
  return l;
}

// ---------------------------------------------------------------------------------------------------------------
// The whole shot: wall, posts, keeper, goal and net
// ---------------------------------------------------------------------------------------------------------------
export type Outcome = "goal" | "saved" | "blocked" | "wide" | "over" | "post" | "short";
export type EventKind = "wall" | "post" | "bar" | "save" | "goal" | "net" | "bounce";

export interface ShotEvent {
  t: number;
  kind: EventKind;
  x: number;
  y: number;
  z: number;
}

export interface Shot {
  outcome: Outcome;
  /** FRAME_STRIDE floats per frame. */
  frames: Float32Array;
  count: number;
  events: ShotEvent[];
  /** Where and when the ball crossed the goal plane (the line or its extension). */
  cross: { x: number; y: number; t: number } | null;
  /** Ring index scored through, or -1. */
  corner: number;
  postIn: boolean;
  /** Beat the keeper's fingertips by under this many metres (Infinity when he was nowhere near). */
  keeperMargin: number;
  tip: boolean;
  /** How far (m) the curve carried the ball off the straight line to where it crossed. */
  bend: number;
  speed: number;
  /** Seconds to the goal plane, or to the moment the shot was decided. */
  flight: number;
  /** When the outcome was decided (the moment the game reacts to it). */
  decided: number;
  /** When playback ends. */
  end: number;
  /** Slow-motion windows [from, to] in shot time. */
  slow: Array<[number, number]>;
  /** Did the keeper dive (vs. standing still)? -1 left, 1 right, 0 none. */
  dive: number;
  /** Spin for the renderer (rad/s at launch). */
  wx: number;
  wy: number;
}

export function newFrames(): Float32Array {
  return new Float32Array(MAX_FRAMES * FRAME_STRIDE);
}

interface KeeperState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  nextRead: number;
  moving: number;
}

export const KEEPER_Y = 1.18;

/**
 * Plays a kick to its end. `frames` is reused between kicks (no garbage per frame), and `predict` turns off the
 * keeper's misread (the pilot uses it to judge a shot against an average keeper).
 */
export function simulateShot(s: Setup, l: Launch, frames: Float32Array = newFrames(), opts: { exact?: boolean } = {}): Shot {
  const b = launchBall(s.spot, l, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 });
  const speed = Math.hypot(l.vx, l.vy, l.vz);
  const k: KeeperState = { x: s.keeperX, y: KEEPER_Y, vx: 0, vy: 0, tx: s.keeperX, ty: KEEPER_Y, nextRead: s.keeper.react, moving: 0 };
  const errX = opts.exact ? 0 : s.errX * s.keeper.err;
  const errY = opts.exact ? 0 : s.errY * s.keeper.err;
  const events: ShotEvent[] = [];
  const shot: Shot = {
    outcome: "short",
    frames,
    count: 0,
    events,
    cross: null,
    corner: -1,
    postIn: false,
    keeperMargin: Infinity,
    tip: false,
    bend: 0,
    speed,
    flight: 0,
    decided: 0,
    end: 0,
    slow: [],
    dive: 0,
    wx: l.wx,
    wy: l.wy,
  };
  const ev = (kind: EventKind, t: number) => events.push({ t, kind, x: b.x, y: b.y, z: b.z });
  let t = 0;
  let decided = false;
  let decidedAt = 0;
  let inGoal = false;
  let hitPost = false;
  let crossedKeeper = false;
  let wallHit = false;
  let saved = false;
  let nextFrame = 0;
  let wallLift = 0;
  // Straight line from the spot to where the ball crosses, for "bend": track the max sideways offset.
  const sx = s.spot.x;
  const sz = s.spot.z;
  let maxOff = 0;
  const dirx = l.vx;
  const dirz = l.vz;
  const dl = Math.hypot(dirx, dirz) || 1;
  const record = () => {
    if (shot.count >= MAX_FRAMES) return;
    const o = shot.count * FRAME_STRIDE;
    frames[o] = t;
    frames[o + 1] = b.x;
    frames[o + 2] = b.y;
    frames[o + 3] = b.z;
    frames[o + 4] = k.x;
    frames[o + 5] = k.y;
    frames[o + 6] = wallLift;
    shot.count++;
  };
  const decide = (o: Outcome) => {
    if (decided) return;
    decided = true;
    decidedAt = t;
    shot.outcome = o;
  };

  for (let i = 0; i < 240 * 5; i++) {
    if (t >= nextFrame) {
      record();
      nextFrame += 1 / FRAME_HZ;
    }
    if (decided && t - decidedAt > (shot.outcome === "goal" ? 1.25 : 0.85)) break;
    const pz = b.z;
    const px = b.x;
    const py = b.y;

    // Keeper: reads the ball from its current flight, ignoring the curve and the wind (that's how you beat him).
    if (!saved && !crossedKeeper) keeperStep(k, s, b, t, errX, errY);

    flyStep(b, STEP, inGoal ? 0 : s.wind);
    t += STEP;

    // Wall: rises as the ball goes, from 0.12 s, for half a second.
    wallLift = s.wallJump > 0 ? s.wallJump * jumpCurve(t) : 0;
    if (!wallHit && !inGoal && b.z > 0) {
      for (const m of s.wall) {
        const top = MAN_H + wallLift - MAN_R;
        const bottom = wallLift + MAN_R;
        const cy = clamp(b.y, bottom, top);
        const dx = b.x - m.x;
        const dz = b.z - m.y;
        const dy = b.y - cy;
        const d = Math.hypot(dx, dy, dz);
        if (d < MAN_R + BALL_R) {
          const nx = dx / d;
          const ny = dy / d;
          const nz = dz / d;
          bounceOff(b, nx, ny, nz, 0.3);
          b.vx += nx * 1.5;
          b.vz = Math.max(b.vz, 1.5);
          wallHit = true;
          ev("wall", t);
          decide("blocked");
          break;
        }
      }
    }

    // Keeper plane.
    if (!crossedKeeper && !inGoal && pz > KEEPER_Z && b.z <= KEEPER_Z) {
      crossedKeeper = true;
      const d = Math.hypot(b.x - k.x, b.y - k.y);
      const reach = s.keeper.reach + (Math.abs(k.x - s.keeperX) > 0.7 ? 0.1 : 0);
      const margin = d - reach - BALL_R;
      if (margin < 0 && !decided) {
        saved = true;
        // Parried: away from the hands, out and up.
        const ox = b.x - k.x;
        const oy = b.y - k.y;
        const ol = Math.hypot(ox, oy) || 1;
        b.vz = Math.abs(b.vz) * 0.22 + 1.5;
        b.vx = (ox / ol) * 5.5 + b.vx * 0.2;
        b.vy = Math.max(1.5, (oy / ol) * 4 + 2.5);
        b.wy *= 0.2;
        ev("save", t);
        decide("saved");
      } else if (!decided) {
        shot.keeperMargin = margin;
      }
    }

    // Woodwork.
    if (!saved) {
      for (let side = 0; side < 2; side++) {
        const post = side ? GOAL_HW : -GOAL_HW;
        const dx = b.x - post;
        const dz = b.z;
        const d = Math.hypot(dx, dz);
        if (b.y < GOAL_H && d < POST_R + BALL_R) {
          bounceOff(b, dx / d, 0, dz / d, 0.65);
          b.x = post + (dx / d) * (POST_R + BALL_R + 0.001);
          b.z = (dz / d) * (POST_R + BALL_R + 0.001);
          hitPost = true;
          ev("post", t);
        }
      }
      {
        const dy = b.y - GOAL_H;
        const dz = b.z;
        const d = Math.hypot(dy, dz);
        if (Math.abs(b.x) < GOAL_HW && d < POST_R + BALL_R) {
          bounceOff(b, 0, dy / d, dz / d, 0.6);
          b.y = GOAL_H + (dy / d) * (POST_R + BALL_R + 0.001);
          b.z = (dz / d) * (POST_R + BALL_R + 0.001);
          hitPost = true;
          ev("bar", t);
        }
      }
    }

    // Goal plane.
    if (!shot.cross && pz > 0 && b.z <= 0) {
      const f = pz / (pz - b.z);
      const cx = px + (b.x - px) * f;
      const cy = py + (b.y - py) * f;
      shot.cross = { x: cx, y: cy, t };
      shot.flight = t;
      const inside = Math.abs(cx) < GOAL_HW - POST_R && cy < GOAL_H - POST_R && cy > -0.05;
      if (inside && !decided) {
        inGoal = true;
        shot.postIn = hitPost;
        decide("goal");
        ev("goal", t);
        for (let r = 0; r < s.rings.length; r++) {
          const ring = s.rings[r]!;
          if (Math.hypot(cx - ring.x, cy - ring.y) < ring.r + BALL_R * 0.5) shot.corner = r;
        }
        shot.tip = shot.keeperMargin < 0.3;
      } else if (!decided) {
        decide(hitPost ? "post" : cy >= GOAL_H - POST_R ? "over" : "wide");
      }
    }

    // Track the bend while the ball is in front of the goal.
    if (b.z > 0 && !wallHit && !saved) {
      const ox = b.x - sx;
      const oz = b.z - sz;
      const off = Math.abs((ox * dirz - oz * dirx) / dl);
      if (off > maxOff) maxOff = off;
    }

    // Inside the net: soft walls that soak the ball up.
    if (inGoal) {
      if (b.z < -NET_D + BALL_R) {
        if (b.vz < -0.5) ev("net", t);
        b.z = -NET_D + BALL_R;
        b.vz = Math.abs(b.vz) * 0.08;
        b.vx *= 0.35;
        b.vy *= 0.4;
      }
      const lim = GOAL_HW - BALL_R;
      if (Math.abs(b.x) > lim) {
        if (Math.abs(b.vx) > 1) ev("net", t);
        b.x = Math.sign(b.x) * lim;
        b.vx *= -0.1;
        b.vz *= 0.6;
      }
      const roof = GOAL_H - 0.1 - BALL_R;
      if (b.y > roof) {
        b.y = roof;
        b.vy = -Math.abs(b.vy) * 0.1;
        b.vz *= 0.6;
      }
      // The net drag.
      const damp = Math.exp(-1.6 * STEP);
      b.vx *= damp;
      b.vz *= damp;
    }

    // Ground.
    if (b.y < BALL_R) {
      b.y = BALL_R;
      if (b.vy < -0.8) {
        // A bounce: loses pace and most of its spin.
        ev("bounce", t);
        b.vy = Math.abs(b.vy) * 0.48;
        b.vx *= 0.86;
        b.vz *= 0.86;
        b.wx *= 0.5;
        b.wy *= 0.7;
      } else {
        // Rolling: grass friction.
        b.vy = 0;
        const roll = Math.exp(-0.9 * STEP);
        b.vx *= roll;
        b.vz *= roll;
      }
    }

    if (!decided) {
      // Out of play past the line, or rolling to a stop short of it.
      if (b.z < -0.6) decide(hitPost ? "post" : b.y > GOAL_H ? "over" : "wide");
      const v = Math.hypot(b.vx, b.vy, b.vz);
      // Off the woodwork and back out: decided right away.
      if (hitPost && b.vz > 0.5 && b.z > 0.4) decide("post");
      if (b.y <= BALL_R + 0.01 && v < 2.2 && b.z > 0) decide(hitPost ? "post" : "short");
      if (t > 3.6) decide(hitPost ? "post" : "short");
    }
  }
  record();
  shot.decided = decidedAt;
  shot.end = Math.max(t, decidedAt + 0.3);
  if (!shot.flight) shot.flight = decidedAt;
  shot.bend = maxOff;
  shot.dive = Math.abs(k.x - s.keeperX) > 0.6 ? Math.sign(k.x - s.keeperX) : 0;
  // Slow motion: woodwork, a save at full stretch, and a ball that slips past the fingertips.
  for (const e of events) {
    if (e.kind === "post" || e.kind === "bar") shot.slow.push([e.t - 0.16, e.t + 0.32]);
  }
  if (shot.outcome === "goal" && shot.tip && shot.cross) shot.slow.push([shot.cross.t - 0.22, shot.cross.t + 0.22]);
  if (shot.outcome === "saved") {
    const sv = events.find((e) => e.kind === "save");
    if (sv && Math.abs(k.x - s.keeperX) > 1.4) shot.slow.push([sv.t - 0.16, sv.t + 0.18]);
  }
  return shot;
}

function keeperStep(k: KeeperState, s: Setup, b: Ball, t: number, errX: number, errY: number): void {
  const sk = s.keeper;
  if (t >= k.nextRead && b.vz < -0.5 && b.z > KEEPER_Z) {
    k.nextRead = t + 0.09;
    const tz = (b.z - KEEPER_Z) / -b.vz;
    // Reads get sharper as the ball gets close.
    const fuzz = clamp(tz / 0.55);
    let px = b.x + b.vx * tz + errX * fuzz;
    let py = b.y + b.vy * tz - 0.5 * G * tz * tz + errY * fuzz;
    px = clamp(px, -GOAL_HW - 0.2, GOAL_HW + 0.2);
    py = clamp(py, 0.25, 2.3);
    // Once he has launched into a dive he can only adjust a little.
    const commit = k.moving > 0.32 ? 0.22 : 1;
    k.tx += (px - k.tx) * commit;
    k.ty += (py - k.ty) * commit;
  }
  if (t < sk.react) return;
  const dx = k.tx - k.x;
  const dy = k.ty - k.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.05) k.moving += STEP;
  // Accelerate toward the target, never faster than his top speed; brake on arrival.
  const want = Math.min(sk.speed, Math.sqrt(2 * sk.accel * d));
  const wx = d > 1e-4 ? (dx / d) * want : 0;
  const wy = d > 1e-4 ? (dy / d) * want * 0.8 : 0;
  const ax = clamp((wx - k.vx) / STEP, -sk.accel, sk.accel);
  const ay = clamp((wy - k.vy) / STEP, -sk.accel, sk.accel);
  k.vx += ax * STEP;
  k.vy += ay * STEP;
  k.x += k.vx * STEP;
  k.y = clamp(k.y + k.vy * STEP, 0.3, 2.3);
}

/** The wall's jump (0..1): up from 0.12 s, peak at 0.38 s, down by 0.66 s. */
export function jumpCurve(t: number): number {
  const u = (t - 0.12) / 0.54;
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(u * Math.PI);
}

function bounceOff(b: Ball, nx: number, ny: number, nz: number, e: number): void {
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  b.vz -= (1 + e) * vn * nz;
}

/** Linear interpolation into a shot's frames at time `t`. Writes ball and keeper into `out`. */
export function sampleShot(shot: Shot, t: number, out: { bx: number; by: number; bz: number; kx: number; ky: number; lift: number }): void {
  const f = shot.frames;
  const n = shot.count;
  if (n === 0) return;
  let i = Math.floor(t * FRAME_HZ);
  if (i < 0) i = 0;
  if (i >= n - 1) i = n - 2;
  if (i < 0) i = 0;
  const a = i * FRAME_STRIDE;
  const c = Math.min(n - 1, i + 1) * FRAME_STRIDE;
  const span = f[c]! - f[a]! || 1;
  const u = clamp((t - f[a]!) / span);
  out.bx = f[a + 1]! + (f[c + 1]! - f[a + 1]!) * u;
  out.by = f[a + 2]! + (f[c + 2]! - f[a + 2]!) * u;
  out.bz = f[a + 3]! + (f[c + 3]! - f[a + 3]!) * u;
  out.kx = f[a + 4]! + (f[c + 4]! - f[a + 4]!) * u;
  out.ky = f[a + 5]! + (f[c + 5]! - f[a + 5]!) * u;
  out.lift = f[a + 6]! + (f[c + 6]! - f[a + 6]!) * u;
}

// ---------------------------------------------------------------------------------------------------------------
// The run: balls, streaks, points
// ---------------------------------------------------------------------------------------------------------------
export type Tag = "TOP CORNER" | "CURLER" | "POST AND IN" | "FINGERTIPS" | "SCREAMER" | "LONG RANGE";

export interface Award {
  points: number;
  mult: number;
  refund: number;
  tags: Tag[];
  /** The streak tier just went up. */
  tierUp: boolean;
}

/** Streak needed for ×2, ×3, ×4. */
export const MULT_AT = [3, 6, 10];
export const multFor = (streak: number): number => 1 + MULT_AT.filter((m) => streak >= m).length;
export const CURLER_BEND = 1.0;

export class Run {
  balls = START_BALLS;
  kicks = 0;
  goals = 0;
  corners = 0;
  streak = 0;
  bestStreak = 0;
  score = 0;
  best: { points: number; tags: Tag[]; distance: number } | null = null;
  misses: Record<Exclude<Outcome, "goal">, number> = { saved: 0, blocked: 0, wide: 0, over: 0, post: 0, short: 0 };
  /** Soft flicks (no cost), for the hint. */
  softs = 0;

  get over(): boolean {
    return this.balls <= 0;
  }

  get mult(): number {
    return multFor(this.streak);
  }

  /** The opening kicks are on the house: a miss there costs nothing while you find the flick. */
  get free(): boolean {
    return this.kicks < FREE_KICKS;
  }

  /** A ball leaves the bag (not for a free kick). */
  take(): void {
    this.freeNow = this.free;
    if (!this.freeNow) this.balls = Math.max(0, this.balls - 1);
    this.kicks++;
  }
  private freeNow = false;

  /** Was the kick just taken a free one? */
  get lastWasFree(): boolean {
    return this.freeNow;
  }

  settle(shot: Shot, distance: number): Award {
    if (shot.outcome !== "goal") {
      this.misses[shot.outcome]++;
      this.streak = 0;
      return { points: 0, mult: 1, refund: 0, tags: [], tierUp: false };
    }
    const before = this.mult;
    this.goals++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const tags: Tag[] = [];
    let base = 100 + Math.round(Math.max(0, distance - 16) * 6);
    if (shot.corner >= 0) {
      base += 150;
      tags.push("TOP CORNER");
      this.corners++;
    }
    if (shot.bend >= CURLER_BEND) {
      base += 60;
      tags.push("CURLER");
    }
    if (shot.postIn) {
      base += 75;
      tags.push("POST AND IN");
    }
    if (shot.tip) {
      base += 50;
      tags.push("FINGERTIPS");
    }
    if (shot.speed >= 27.5) {
      base += 40;
      tags.push("SCREAMER");
    }
    if (distance >= 26) tags.push("LONG RANGE");
    const mult = this.mult;
    const points = base * mult;
    this.score += points;
    const refund = (shot.corner >= 0 ? 2 : 1) - (this.freeNow ? 1 : 0);
    this.balls = Math.min(MAX_BALLS, this.balls + refund);
    if (!this.best || points > this.best.points) this.best = { points, tags, distance };
    return { points, mult, refund, tags, tierUp: mult > before };
  }

  /** One concrete thing to try next time, from what went wrong most. */
  hint(): string {
    const m = this.misses;
    const worst = (Object.keys(m) as Array<keyof typeof m>).reduce((a, b) => (m[b] > m[a] ? b : a), "saved");
    if (this.softs >= 2 && this.goals === 0) return "FLICK FASTER. A LAZY SWIPE JUST ROLLS IT.";
    if (m[worst] === 0) return this.corners === 0 ? "AIM FOR THE RINGS. A CORNER GIVES YOU AN EXTRA BALL." : "BEND IT MORE. CURLERS PAY EXTRA.";
    switch (worst) {
      case "blocked":
        return "FLICK A LITTLE LONGER TO LIFT IT OVER THE WALL, OR BOW IT ROUND.";
      case "saved":
        return "GO FOR THE CORNERS. HE CAN'T REACH THE RINGS IN TIME.";
      case "over":
        return "SHORTER FLICK, LOWER SHOT. IT WAS SAILING OVER.";
      case "wide":
        return "BOW YOUR SWIPE TO BEND IT BACK INSIDE THE POST.";
      case "post":
        return "SO CLOSE. AIM A BALL'S WIDTH INSIDE THE WOODWORK.";
      case "short":
        return "FLICK FASTER FOR POWER.";
    }
  }
}

/** Distance from spot to the centre of the goal line. */
export const distanceOf = (s: Setup): number => Math.hypot(s.spot.x, s.spot.z);
