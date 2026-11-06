/**
 * The lane, in metres. `x` runs across the lane (+ is to the right on screen), `d` runs down it from the foul line,
 * `y` is up. Three.js gets z = -d, so the camera looks down -z and screen-right stays +x.
 *
 * It is an arcade lane: real width, real gutters and a real pin triangle, but 12 m from the foul line to the head
 * pin instead of 18.3, so a ball reaches the pins in about a second and a run fits in a feed.
 */

export const LANE_HALF = 0.527;
export const GUTTER_W = 0.235;
/** The side walls of the pin deck (kickbacks) that throw pins back in. */
export const KICK_X = LANE_HALF + GUTTER_W + 0.03;
export const D_HEAD = 12;
export const PIN_SPACING = 0.3048;
export const ROW_GAP = (PIN_SPACING * Math.sqrt(3)) / 2;
/** The pin deck starts a little in front of the head pin. */
export const D_DECK = D_HEAD - 0.42;
/** Past the last row and a little more: the pit. */
export const D_PIT = D_HEAD + 3 * ROW_GAP + 0.62;
/** The curtain at the back of the pit. */
export const D_BACK = D_PIT + 0.7;

export const BALL_R = 0.109;
export const BALL_M = 6.4;
/** Where the ball sits before a throw. */
export const BALL_D0 = 0.32;

export const PIN_H = 0.381;
/** Collision radius of a pin's body (its belly is 0.06; the neck is thinner, the base a touch narrower). */
export const PIN_R = 0.06;
export const PIN_M = 1.55;
/** Height of a pin's centre of mass above its base, and its base radius (the critical tipping angle follows). */
export const PIN_COM = 0.145;
export const PIN_BASE_R = 0.026;

export const PIN_COUNT = 10;
/** Pin spots, head pin first: 1; 2 3; 4 5 6; 7 8 9 10, numbered from the bowler's side, left to right. */
export const SPOTS: ReadonlyArray<{ x: number; d: number; row: number }> = (() => {
  const out: Array<{ x: number; d: number; row: number }> = [];
  for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) out.push({ x: (i - r / 2) * PIN_SPACING, d: D_HEAD + r * ROW_GAP, row: r });
  return out;
})();
/** The two pockets: the ball's centre just to either side of the head pin. */
export const POCKET_X = 0.06;

export interface Vec3 {
  x: number;
  y: number;
  d: number;
}

// ---------------------------------------------------------------------------------------------------------------
// The camera, as pure maths (the pilot, the tests and the HUD all use it; the scene copies it into Three.js)
// ---------------------------------------------------------------------------------------------------------------
export interface View {
  cam: Vec3;
  look: Vec3;
  /** Vertical field of view, degrees (as Three.js). */
  fov: number;
  width: number;
  height: number;
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
  aspect: number;
}

function basis(v: View): Basis {
  // World z = -d.
  let fx = v.look.x - v.cam.x;
  let fy = v.look.y - v.cam.y;
  let fz = -(v.look.d - v.cam.d);
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = f × up(0,1,0)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up = r × f
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  return { fx, fy, fz, rx, rz, ux, uy, uz, tan: Math.tan((v.fov * Math.PI) / 360), aspect: v.width / v.height };
}

/** World point -> screen px (and depth along the view; ≤ 0 means behind the camera). */
export function project(v: View, x: number, y: number, d: number, out: { x: number; y: number; depth: number } = { x: 0, y: 0, depth: 0 }) {
  const b = basis(v);
  const dx = x - v.cam.x;
  const dy = y - v.cam.y;
  const dz = -(d - v.cam.d);
  const zc = dx * b.fx + dy * b.fy + dz * b.fz;
  const xc = dx * b.rx + dz * b.rz;
  const yc = dx * b.ux + dy * b.uy + dz * b.uz;
  const z = Math.max(1e-4, zc);
  out.x = ((xc / (z * b.tan * b.aspect)) * 0.5 + 0.5) * v.width;
  out.y = (0.5 - (yc / (z * b.tan)) * 0.5) * v.height;
  out.depth = zc;
  return out;
}

/** Screen px -> where that pixel's ray meets the horizontal plane at height `y` (null above the horizon). */
export function unproject(v: View, sx: number, sy: number, y = 0): { x: number; d: number } | null {
  const b = basis(v);
  const nx = (sx / v.width) * 2 - 1;
  const ny = 1 - (sy / v.height) * 2;
  const rx = b.fx + b.rx * nx * b.tan * b.aspect + b.ux * ny * b.tan;
  const ry = b.fy + b.uy * ny * b.tan;
  const rz = b.fz + b.rz * nx * b.tan * b.aspect + b.uz * ny * b.tan;
  if (Math.abs(ry) < 1e-6) return null;
  const t = (y - v.cam.y) / ry;
  if (t <= 0) return null;
  return { x: v.cam.x + rx * t, d: v.cam.d - rz * t };
}

/** Where the ball sits on screen in the aiming view, and where the head pin's row is (shares of the height). */
export const BALL_SCREEN = 0.8;
export const PINS_SCREEN = 0.33;

/**
 * The aiming view: behind and above the ball, looking down the lane, framed so the ball sits at BALL_SCREEN and the
 * head pin at PINS_SCREEN of the height whatever the screen's shape. Narrow screens pull the camera back a little so
 * the lane's width still fits with room for the gutters.
 */
export function aimView(width: number, height: number): View {
  const aspect = width / height;
  const fov = aspect < 0.5 ? 28 : 25;
  const v: View = { cam: { x: 0, y: 1.62, d: -2.5 }, look: { x: 0, y: 0, d: 6.5 }, fov, width, height };
  const ballY = () => project(v, 0, BALL_R, BALL_D0).y / height;
  const pinsY = () => project(v, 0, 0.2, D_HEAD).y / height;
  // Inner: tilt (the look point's height) puts the ball on its row; outer: the camera's distance puts the pins on theirs.
  const fitTilt = () => {
    let lo = -4;
    let hi = 4;
    for (let i = 0; i < 40; i++) {
      v.look.y = (lo + hi) / 2;
      if (ballY() < BALL_SCREEN) lo = v.look.y;
      else hi = v.look.y;
    }
  };
  let near = -0.8;
  let far = -9;
  for (let i = 0; i < 32; i++) {
    v.cam.d = (near + far) / 2;
    fitTilt();
    if (pinsY() < PINS_SCREEN) near = v.cam.d;
    else far = v.cam.d;
  }
  fitTilt();
  return v;
}

/** The camera chasing a ball at `bd` down the lane (0 = aiming view, then closer to the pins). */
export function chaseView(base: View, bd: number, bx: number, k: number): View {
  const end = D_HEAD - 3.9;
  const u = Math.min(1, Math.max(0, k));
  const camD = base.cam.d + (Math.min(end, bd - 3.1) - base.cam.d) * u;
  return {
    cam: { x: bx * 0.25 * u, y: base.cam.y + (1.12 - base.cam.y) * u, d: Math.max(base.cam.d, camD) },
    look: { x: bx * 0.18 * u, y: base.look.y + (0.12 - base.look.y) * u, d: base.look.d + (D_HEAD + 0.5 - base.look.d) * u },
    fov: base.fov + (30 - base.fov) * u,
    width: base.width,
    height: base.height,
  };
}
