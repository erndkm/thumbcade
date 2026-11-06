/**
 * The pin solver: our own, deterministic, fixed-step (1/480 s), no allocation while stepping.
 *
 * A throw is simulated to its end the moment it leaves the hand (the ball's skid and late hook, the gutters or the
 * bumpers, every ball-pin and pin-pin contact, the kickbacks and the pit), recorded at 120 Hz and played back. That
 * makes every throw reproducible for tests and pilots, and lets the game slow time down for a strike before it
 * happens.
 *
 * Collisions live in the lane plane: every pin is a capsule (its axis projected onto the deck) and the ball a disc.
 * Pins are upright bodies that tip about their base edge like an inverted pendulum (a light touch wobbles and settles,
 * a firmer one tips past the critical angle and topples slowly), and a hard hit launches them: they leave the deck,
 * tumble end over end, land, slide and spin, and keep knocking into others (messengers), off the kickbacks and into
 * the pit.
 */
import {
  BALL_D0,
  BALL_M,
  BALL_R,
  D_BACK,
  D_DECK,
  D_HEAD,
  D_PIT,
  GUTTER_W,
  KICK_X,
  LANE_HALF,
  PIN_BASE_R,
  PIN_COM,
  PIN_COUNT,
  PIN_H,
  PIN_M,
  PIN_R,
  SPOTS,
} from "./lane.ts";

export const STEP = 1 / 480;
export const FRAME_HZ = 120;
const SUB = 480 / FRAME_HZ;
export const MAX_T = 5.2;
export const MAX_FRAMES = Math.ceil(MAX_T * FRAME_HZ) + 2;
/** Floats per frame: ball (x, y, d, spin, heading) + 10 pins × (x, y, d, ux, ud, tilt, roll). */
export const BALL_F = 5;
export const PIN_F = 7;
export const FRAME_STRIDE = BALL_F + PIN_COUNT * PIN_F;
export const newFrames = (): Float32Array => new Float32Array(MAX_FRAMES * FRAME_STRIDE);

const G = 9.81;
/** Critical tipping angle (rad): past it the pin falls on its own. */
export const TIP_CRIT = Math.atan(PIN_BASE_R / PIN_COM);
/** Gravity over the effective pendulum length about the base edge. */
const G_L = G / ((0.1 * 0.1 + PIN_COM * PIN_COM) / PIN_COM);
/** Pivot inertia about the base (kg m²). */
const I_PIVOT = PIN_M * (0.1 * 0.1 + PIN_COM * PIN_COM);
const I_YAW = (PIN_M * PIN_H * PIN_H) / 12;
/**
 * Tuned constants (an object so the tuning script can sweep them; the game never changes them):
 * launch = a hit that gives the pin more than this (m/s) launches it off its base; e* = restitution of ball-pin,
 * pin-pin and pin-kickback contacts; mu* = sliding friction of loose pins and of a standing pin's base; spin = the
 * fastest a loose pin spins (rad/s) and spinDrag its spin friction; pop = how high a launched pin hops.
 */
export const PHYS = { launch: 2.3, eBall: 0.62, ePin: 0.5, eWall: 0.25, muSlide: 0.24, muBase: 0.42, spin: 12, spinDrag: 16, pop: 0.06 };
/** A pin counts as down once it tilts past this (it can't come back from there). */
export const DOWN_TILT = 0.5;

/** Late hook: lateral pull (m/s² at full hook and the reference speed) ramping in from the skid to the roll. */
export const HOOK_A = 3.3;
export const HOOK_START = 5.2;
export const HOOK_FULL = 9.6;
const V_REF = 10;
const ROLL_DECEL = 0.12;

export interface ThrowInput {
  /** Release point across the lane. */
  x0: number;
  /** Heading off straight down the lane (rad, + = to the right). */
  heading: number;
  /** m/s */
  speed: number;
  /** -1..1: + bends to the right late in the lane. */
  hook: number;
  bumpers: boolean;
}

export type EventKind = "pin" | "ball" | "fall" | "wall" | "deck" | "gutter" | "bumper" | "pit" | "curtain";

export interface PinEvent {
  t: number;
  kind: EventKind;
  x: number;
  d: number;
  power: number;
  /** Impacts so far in this throw (pitches the clatter). */
  n: number;
  pin: number;
}

export interface Throw {
  input: ThrowInput;
  /** Which pins were standing before and after. */
  before: boolean[];
  after: boolean[];
  /** Pins knocked down by this throw. */
  knocked: number;
  /** Time the ball first touched a pin (Infinity if never). */
  impact: number;
  /** The down-set is final from here, and the ball is past the pins or out of play. */
  decided: number;
  /** Everything at rest (or the cap). */
  end: number;
  frames: number;
  events: PinEvent[];
  gutter: boolean;
  /** Where the ball crossed the head pin's row (before any contact), and its angle of entry there (rad). */
  entryX: number;
  entryAngle: number;
  /** Seconds each pin first counted down (Infinity if it stayed up). */
  downAt: number[];
  /** A pin rocked but stayed up. */
  wobblers: number;
  impacts: number;
  /** The ball's path down the lane (until contact) for the trail: x at every 0.25 m of d. */
  path: Float32Array;
}

// Mode: 0 = on its base (standing or tipping), 1 = loose (flying, sliding, lying), 2 = out (gutter or pit).
interface Body {
  mode: number;
  x: number;
  d: number;
  y: number;
  vx: number;
  vd: number;
  vy: number;
  /** Axis direction in the deck plane (where the head leans to). */
  ux: number;
  ud: number;
  /** Angle of the axis from vertical, and its rate. */
  th: number;
  om: number;
  /** Spin about the vertical (loose pins). */
  wy: number;
  roll: number;
  down: boolean;
  downAt: number;
  up: boolean;
  rocked: boolean;
  inGutter: boolean;
}

const pins: Body[] = Array.from({ length: PIN_COUNT }, () => newBody());
function newBody(): Body {
  return { mode: 0, x: 0, d: 0, y: 0, vx: 0, vd: 0, vy: 0, ux: 0, ud: 1, th: 0, om: 0, wy: 0, roll: 0, down: false, downAt: Infinity, up: true, rocked: false, inGutter: false };
}

// The ball.
const ball = { x: 0, d: 0, y: BALL_R, vx: 0, vd: 0, vy: 0, spin: 0, mode: 0, touched: false, gx: 0 };

// Segment endpoints of each pin's footprint (a, b) in the plane, refreshed each step.
const segA = new Float64Array(PIN_COUNT * 2);
const segB = new Float64Array(PIN_COUNT * 2);

function footprint(i: number): void {
  const p = pins[i]!;
  const s = Math.sin(p.th);
  if (p.mode === 0) {
    segA[i * 2] = p.x;
    segA[i * 2 + 1] = p.d;
    segB[i * 2] = p.x + p.ux * PIN_H * s * 0.92;
    segB[i * 2 + 1] = p.d + p.ud * PIN_H * s * 0.92;
  } else {
    // Loose: (x, d) is the centre of mass.
    segA[i * 2] = p.x - p.ux * PIN_COM * s;
    segA[i * 2 + 1] = p.d - p.ud * PIN_COM * s;
    segB[i * 2] = p.x + p.ux * (PIN_H - PIN_COM) * s * 0.92;
    segB[i * 2 + 1] = p.d + p.ud * (PIN_H - PIN_COM) * s * 0.92;
  }
}

// Closest points between two segments (results in cp*).
let cpS = 0;
let cpT = 0;
function closestSegSeg(ax: number, ad: number, bx: number, bd: number, cx: number, cd: number, ex: number, ed: number): number {
  const d1x = bx - ax;
  const d1d = bd - ad;
  const d2x = ex - cx;
  const d2d = ed - cd;
  const rx = ax - cx;
  const rd = ad - cd;
  const a = d1x * d1x + d1d * d1d;
  const e = d2x * d2x + d2d * d2d;
  const f = d2x * rx + d2d * rd;
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) {
    s = t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1d * rd;
    if (e <= 1e-12) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1d * d2d;
      const den = a * e - b * b;
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  cpS = s;
  cpT = t;
  const px = ax + d1x * s - (cx + d2x * t);
  const pd = ad + d1d * s - (cd + d2d * t);
  return Math.hypot(px, pd);
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Velocity of a pin's footprint at parameter s (0 = base/tail, 1 = head) in the plane. */
function pinPointVel(p: Body, s: number, out: { x: number; d: number }): void {
  if (p.mode === 0) {
    const r = s * PIN_H * 0.92;
    const k = r * Math.cos(p.th) * p.om;
    out.x = p.vx + p.ux * k;
    out.d = p.vd + p.ud * k;
  } else {
    // Offset from the centre of mass along the axis, times the spin about the vertical.
    const off = -PIN_COM + s * PIN_H * 0.92;
    const r = off * Math.sin(p.th);
    out.x = p.vx - p.ud * r * p.wy;
    out.d = p.vd + p.ux * r * p.wy;
  }
}
const pv = { x: 0, d: 0 };
const qv = { x: 0, d: 0 };

/** Height (m) of a pin's footprint point at parameter s. */
function pinPointY(p: Body, s: number): number {
  if (p.mode === 0) return s * PIN_H * 0.92 * Math.cos(p.th);
  return Math.max(0.02, p.y + (-PIN_COM + s * PIN_H * 0.92) * Math.cos(p.th));
}

/** Lowest and highest point of a pin (m). */
function bottomOf(p: Body): number {
  if (p.mode === 0) return 0;
  return p.y - 0.2 * Math.abs(Math.cos(p.th)) - PIN_R * Math.abs(Math.sin(p.th));
}
function topOf(p: Body): number {
  if (p.mode === 0) return PIN_H * Math.cos(p.th) + PIN_R * Math.sin(p.th);
  return p.y + 0.24 * Math.abs(Math.cos(p.th)) + PIN_R;
}

let impacts = 0;
let tNow = 0;
let events: PinEvent[] = [];
const MAX_EVENTS = 220;
function emit(kind: EventKind, x: number, d: number, power: number, pin = -1): void {
  if (events.length >= MAX_EVENTS) return;
  events.push({ t: tNow, kind, x, d, power, n: impacts, pin });
}

/** An impulse J (N s) along (nx, nd) on pin p at footprint parameter s, delivered at height h. */
function hitPin(p: Body, nx: number, nd: number, J: number, s: number, h: number): void {
  const dv = J / PIN_M;
  if (p.mode === 0) {
    const hh = Math.max(0.03, Math.min(h, PIN_H * Math.cos(p.th) * 0.95));
    const dOm = (J * hh) / I_PIVOT;
    if (dv > PHYS.launch) {
      // Off its base: it flies, tumbling away from the hit.
      const s0 = Math.sin(p.th);
      const comX = p.x + p.ux * PIN_COM * s0;
      const comD = p.d + p.ud * PIN_COM * s0;
      p.mode = 1;
      p.x = comX;
      p.d = comD;
      p.y = PIN_COM * Math.cos(p.th);
      p.vx += nx * dv * 0.86;
      p.vd += nd * dv * 0.86;
      p.vy = Math.min(1.3, PHYS.pop * dv + 0.25);
      // The head leans the way it was knocked.
      const lean = p.th > 0.25 ? 0.3 : 1;
      const ax = p.ux * (1 - lean) + nx * lean;
      const ad = p.ud * (1 - lean) + nd * lean;
      const al = Math.hypot(ax, ad) || 1;
      p.ux = ax / al;
      p.ud = ad / al;
      p.om = Math.min(26, 4 + dOm * 0.35);
      p.wy = (s - 0.4) * dv * 2.2 * (nx * p.ud - nd * p.ux >= 0 ? 1 : -1);
      return;
    }
    // Stays on its base: some slide, mostly tip.
    p.vx += nx * dv * 0.42;
    p.vd += nd * dv * 0.42;
    if (p.th < 0.3) {
      // Early in a tip the lean can still swing round to the new push.
      const wx = p.ux * p.om + nx * dOm;
      const wd = p.ud * p.om + nd * dOm;
      const w = Math.hypot(wx, wd);
      if (w > 1e-6) {
        p.ux = wx / w;
        p.ud = wd / w;
      }
      p.om = w;
    } else {
      p.om += (nx * p.ux + nd * p.ud) * dOm;
      p.vx += nx * dv * 0.2;
      p.vd += nd * dv * 0.2;
    }
    if (p.om > 0.2) p.rocked = true;
    return;
  }
  if (p.mode === 1) {
    p.vx += nx * dv;
    p.vd += nd * dv;
    if (p.y < 0.09) p.vy = Math.max(p.vy, Math.min(1.2, dv * 0.12));
    const off = (-PIN_COM + s * PIN_H * 0.92) * Math.sin(p.th);
    p.wy += (off * J * (p.ux * nd - p.ud * nx)) / I_YAW;
    p.wy = Math.max(-PHYS.spin, Math.min(PHYS.spin, p.wy));
  }
}

function markDown(i: number): void {
  const p = pins[i]!;
  if (p.down) return;
  p.down = true;
  p.downAt = tNow;
  emit("fall", p.x, p.d, 1, i);
}

/** Hook pull at distance d (0 before the skid ends, full on the back end). */
export function hookRamp(d: number): number {
  if (d <= HOOK_START) return 0;
  if (d >= HOOK_FULL) return 1;
  const u = (d - HOOK_START) / (HOOK_FULL - HOOK_START);
  return u * u * (3 - 2 * u);
}

export function hookAccel(hook: number, speed: number, d: number): number {
  return hook * HOOK_A * (speed / V_REF) ** 0.8 * hookRamp(d);
}

/**
 * Where a ball rolls with no pins in the way: its x when its centre reaches `dTo` (the head pin's row by default),
 * and its entry angle there. Used by the assist and the pilot; the same integration as the full solver.
 */
export function ballLine(x0: number, heading: number, speed: number, hook: number, dTo = D_HEAD): { x: number; angle: number; t: number } {
  let x = x0;
  let d = BALL_D0;
  let vx = speed * Math.sin(heading);
  let vd = speed * Math.cos(heading);
  let t = 0;
  while (d < dTo && t < 4) {
    const v = Math.hypot(vx, vd);
    vx += hookAccel(hook, v, d) * STEP;
    const k = Math.max(0, v - ROLL_DECEL * STEP) / (Math.hypot(vx, vd) || 1);
    vx *= k;
    vd *= k;
    x += vx * STEP;
    d += vd * STEP;
    t += STEP;
  }
  return { x, angle: Math.atan2(vx, vd), t };
}

/**
 * Simulates a throw against the pins standing in `standing` (true = up) to its end, writing frames into `frames`.
 * `jitter` (-1..1 per pin and axis, a few millimetres) is the pinsetter's imprecision for this rack.
 */
export function simulateThrow(input: ThrowInput, standing: readonly boolean[], frames: Float32Array, jitter?: ArrayLike<number>): Throw {
  impacts = 0;
  tNow = 0;
  events = [];
  for (let i = 0; i < PIN_COUNT; i++) {
    const p = pins[i]!;
    Object.assign(p, newBody());
    const s = SPOTS[i]!;
    p.x = s.x + (jitter ? jitter[i * 2]! * 0.004 : 0);
    p.d = s.d + (jitter ? jitter[i * 2 + 1]! * 0.004 : 0);
    if (!standing[i]) {
      p.mode = 2;
      p.up = false;
      p.down = true;
      p.downAt = -1;
      p.y = -1;
    }
  }
  ball.x = input.x0;
  ball.d = BALL_D0;
  ball.y = BALL_R;
  ball.vx = input.speed * Math.sin(input.heading);
  ball.vd = input.speed * Math.cos(input.heading);
  ball.vy = 0;
  ball.spin = 0;
  ball.mode = 0;
  ball.touched = false;
  ball.gx = 0;
  const path = new Float32Array(Math.ceil(D_HEAD / 0.25) + 2);
  let pathN = 0;
  let entryX = NaN;
  let entryAngle = 0;
  let impact = Infinity;
  let gutter = false;
  let ballDone = Infinity;
  let quietSince = -1;
  let frame = 0;
  let step = 0;
  let wobblers = 0;
  const hook = Math.max(-1, Math.min(1, input.hook));

  const record = () => {
    if (frame >= MAX_FRAMES) return;
    const o = frame * FRAME_STRIDE;
    frames[o] = ball.x;
    frames[o + 1] = ball.y;
    frames[o + 2] = ball.d;
    frames[o + 3] = ball.spin;
    frames[o + 4] = Math.atan2(ball.vx, Math.max(0.01, ball.vd));
    for (let i = 0; i < PIN_COUNT; i++) {
      const p = pins[i]!;
      const q = o + BALL_F + i * PIN_F;
      // Stored as the base point: loose pins convert from their centre of mass.
      const s = Math.sin(p.th);
      const c = Math.cos(p.th);
      if (p.mode === 0) {
        frames[q] = p.x;
        frames[q + 1] = 0;
        frames[q + 2] = p.d;
      } else {
        frames[q] = p.x - p.ux * PIN_COM * s;
        frames[q + 1] = p.y - PIN_COM * c;
        frames[q + 2] = p.d - p.ud * PIN_COM * s;
      }
      frames[q + 3] = p.ux;
      frames[q + 4] = p.ud;
      frames[q + 5] = p.th;
      frames[q + 6] = p.roll;
    }
    frame++;
  };
  record();

  while (tNow < MAX_T) {
    tNow += STEP;
    step++;
    // --- the ball ----------------------------------------------------------------------------------------------
    if (ball.mode === 0) {
      const v = Math.hypot(ball.vx, ball.vd);
      if (!ball.touched) ball.vx += hookAccel(hook, v, ball.d) * STEP;
      const k = Math.max(0, v - ROLL_DECEL * STEP) / (Math.hypot(ball.vx, ball.vd) || 1);
      ball.vx *= k;
      ball.vd *= k;
      ball.x += ball.vx * STEP;
      ball.d += ball.vd * STEP;
      ball.spin += (Math.hypot(ball.vx, ball.vd) / BALL_R) * STEP;
      if (!ball.touched && ball.d < D_HEAD && pathN < path.length && ball.d >= pathN * 0.25) path[pathN++] = ball.x;
      if (Number.isNaN(entryX) && ball.d >= D_HEAD && !ball.touched) {
        entryX = ball.x;
        entryAngle = Math.atan2(ball.vx, ball.vd);
      }
      const edge = LANE_HALF - (input.bumpers ? BALL_R : 0);
      if (Math.abs(ball.x) > edge && ball.d < D_PIT) {
        if (input.bumpers && ball.d < D_DECK) {
          // A soft rail: it bounces back in, a little slower.
          ball.x = Math.sign(ball.x) * edge;
          if (ball.vx * Math.sign(ball.x) > 0) {
            emit("bumper", ball.x, ball.d, Math.abs(ball.vx));
            ball.vx = -ball.vx * 0.45;
            ball.vd *= 0.94;
          }
        } else if (!input.bumpers || Math.abs(ball.x) > LANE_HALF + 0.04) {
          ball.mode = 1;
          ball.gx = Math.sign(ball.x);
          if (!ball.touched) gutter = true;
          emit("gutter", ball.x, ball.d, Math.hypot(ball.vx, ball.vd));
        }
      }
      if (ball.d > D_PIT) {
        ball.mode = 2;
        ballDone = Math.min(ballDone, tNow);
        emit("pit", ball.x, ball.d, Math.hypot(ball.vx, ball.vd));
      }
    } else if (ball.mode === 1) {
      // In the gutter: drops in and rolls on to the pit.
      const gxTarget = ball.gx * (LANE_HALF + GUTTER_W * 0.48);
      ball.x += (gxTarget - ball.x) * Math.min(1, STEP * 14);
      ball.y += (BALL_R - 0.075 - ball.y) * Math.min(1, STEP * 12);
      ball.vd = Math.max(1.5, ball.vd - 0.25 * STEP);
      ball.vx = 0;
      ball.d += ball.vd * STEP;
      ball.spin += (ball.vd / BALL_R) * STEP;
      if (Number.isNaN(entryX) && ball.d >= D_HEAD) {
        entryX = ball.x;
        entryAngle = 0;
      }
      if (ball.d > D_PIT) {
        ball.mode = 2;
        ballDone = Math.min(ballDone, tNow);
        emit("pit", ball.x, ball.d, ball.vd);
      }
    } else if (ball.mode === 2) {
      // Into the pit, against the curtain.
      ball.d += ball.vd * STEP;
      ball.vd *= Math.exp(-STEP * 3);
      ball.vy -= G * STEP;
      ball.y = Math.max(-0.5, ball.y + ball.vy * STEP);
      if (ball.d > D_BACK) {
        ball.d = D_BACK;
        if (ball.vd > 0.5) emit("curtain", ball.x, ball.d, ball.vd);
        ball.vd = 0;
      }
    }

    // --- pins ----------------------------------------------------------------------------------------------
    for (let i = 0; i < PIN_COUNT; i++) {
      const p = pins[i]!;
      if (p.mode === 2) {
        // Out: in the gutter or the pit, sliding to a stop out of play.
        if (p.y > -0.9) {
          p.x += p.vx * STEP;
          p.d += p.vd * STEP;
          const f = Math.exp(-STEP * 3);
          p.vx *= f;
          p.vd *= f;
          if (p.d > D_PIT) {
            p.vy -= G * STEP;
            p.y = Math.max(-0.9, p.y + p.vy * STEP);
          }
          p.th += (Math.PI / 2 - p.th) * Math.min(1, STEP * 8);
        }
        continue;
      }
      if (p.mode === 0) {
        // Base sliding with friction.
        const v = Math.hypot(p.vx, p.vd);
        if (v > 0) {
          const nv = Math.max(0, v - PHYS.muBase * G * STEP);
          p.vx *= nv / v;
          p.vd *= nv / v;
        }
        p.x += p.vx * STEP;
        p.d += p.vd * STEP;
        if (p.th > 0 || p.om !== 0) {
          // Inverted pendulum about the base edge.
          p.om += G_L * Math.sin(p.th - TIP_CRIT) * STEP;
          p.th += p.om * STEP;
          if (p.th < 0) {
            // Lands back on its base and rocks to the other side, losing most of it.
            p.th = -p.th;
            p.ux = -p.ux;
            p.ud = -p.ud;
            p.om = -p.om * 0.3;
            if (Math.abs(p.om) < 0.25 && p.th < 0.02) {
              p.th = 0;
              p.om = 0;
            }
            emit("deck", p.x, p.d, 0.15, i);
          }
          if (p.th > DOWN_TILT) markDown(i);
          if (p.th >= Math.PI / 2) {
            // Slaps onto the deck: now a loose body lying down.
            const s0 = 1;
            p.mode = 1;
            p.x += p.ux * PIN_COM * s0;
            p.d += p.ud * PIN_COM * s0;
            const slap = PIN_COM * p.om * 0.35;
            p.vx += p.ux * slap;
            p.vd += p.ud * slap;
            p.y = PIN_R;
            p.vy = 0;
            p.th = Math.PI / 2;
            p.om = 0;
            emit("deck", p.x, p.d, Math.min(1, 0.4 + slap * 0.3), i);
          }
        }
      } else {
        // Loose: flying or sliding.
        p.x += p.vx * STEP;
        p.d += p.vd * STEP;
        const rest = PIN_R * Math.abs(Math.sin(p.th)) + Math.abs(Math.cos(p.th)) * 0.02;
        if (p.y > rest + 0.002 || p.vy > 0) {
          p.vy -= G * STEP;
          p.y += p.vy * STEP;
          p.th += p.om * STEP;
          if (p.y <= rest) {
            p.y = rest;
            const hard = -p.vy;
            p.vy = hard > 0.9 ? hard * 0.28 : 0;
            if (hard > 0.3) emit("deck", p.x, p.d, Math.min(1, hard / 3), i);
          }
        } else {
          p.y = PIN_R;
          p.vy = 0;
          // Settle the tumble to the nearest lying angle.
          const lying = Math.PI / 2 + Math.round((p.th - Math.PI / 2) / Math.PI) * Math.PI;
          p.th += (lying - p.th) * Math.min(1, STEP * 18);
          p.om *= Math.exp(-STEP * 10);
          const v = Math.hypot(p.vx, p.vd);
          if (v > 0) {
            const nv = Math.max(0, v - PHYS.muSlide * G * STEP);
            p.vx *= nv / v;
            p.vd *= nv / v;
            // Rolls a little when it slides sideways to its axis.
            p.roll += ((p.vx * -p.ud + p.vd * p.ux) / PIN_R) * STEP * 0.5;
          }
          const w = Math.abs(p.wy);
          if (w > 0) p.wy *= Math.max(0, w - PHYS.spinDrag * STEP) / w;
        }
        if (p.wy !== 0) {
          const a = p.wy * STEP;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const ux = p.ux * c - p.ud * s;
          const ud = p.ux * s + p.ud * c;
          p.ux = ux;
          p.ud = ud;
        }
        markDown(i);
        // Kickbacks.
        if (Math.abs(p.x) > KICK_X - PIN_R && p.d > D_DECK - 0.6) {
          p.x = Math.sign(p.x) * (KICK_X - PIN_R);
          if (p.vx * Math.sign(p.x) > 0) {
            emit("wall", p.x, p.d, Math.abs(p.vx), i);
            p.vx = -p.vx * PHYS.eWall;
            p.wy *= -0.6;
          }
        }
      }
      // Off the deck: into a gutter (out of play) or the pit.
      if (Math.abs(p.x) > LANE_HALF + PIN_R * 0.5 && p.mode !== 2) {
        if (p.mode === 0) markDown(i);
        p.mode = 2;
        p.inGutter = true;
        p.y = Math.max(-0.06, Math.min(p.y, PIN_R) - 0.06);
        p.th = Math.max(p.th, 1.2);
        markDown(i);
        emit("gutter", p.x, p.d, Math.hypot(p.vx, p.vd), i);
      } else if (p.d > D_PIT && p.mode !== 2) {
        p.mode = 2;
        p.vy = Math.min(p.vy, 0);
        markDown(i);
        emit("pit", p.x, p.d, Math.hypot(p.vx, p.vd), i);
      }
    }

    // --- contacts ------------------------------------------------------------------------------------------
    for (let i = 0; i < PIN_COUNT; i++) if (pins[i]!.mode !== 2) footprint(i);
    // Ball against pins.
    if (ball.mode === 0 && ball.d > D_DECK - 0.5) {
      for (let i = 0; i < PIN_COUNT; i++) {
        const p = pins[i]!;
        if (p.mode === 2) continue;
        if (bottomOf(p) > BALL_R * 2) continue;
        const dist = closestSegSeg(ball.x, ball.d, ball.x, ball.d, segA[i * 2]!, segA[i * 2 + 1]!, segB[i * 2]!, segB[i * 2 + 1]!);
        const minD = BALL_R + PIN_R;
        if (dist >= minD) continue;
        const s = cpT;
        const cx = segA[i * 2]! + (segB[i * 2]! - segA[i * 2]!) * s;
        const cd = segA[i * 2 + 1]! + (segB[i * 2 + 1]! - segA[i * 2 + 1]!) * s;
        let nx = cx - ball.x;
        let nd = cd - ball.d;
        const nl = Math.hypot(nx, nd);
        if (nl < 1e-9) {
          nx = 0;
          nd = 1;
        } else {
          nx /= nl;
          nd /= nl;
        }
        pinPointVel(p, s, pv);
        const vn = (pv.x - ball.vx) * nx + (pv.d - ball.vd) * nd;
        // Push apart (mostly the pin).
        const pen = minD - dist;
        const wb = 1 / BALL_M / (1 / BALL_M + 1 / PIN_M);
        ball.x -= nx * pen * wb;
        ball.d -= nd * pen * wb;
        if (p.mode === 0) {
          p.x += nx * pen * (1 - wb);
          p.d += nd * pen * (1 - wb);
        } else {
          p.x += nx * pen * (1 - wb);
          p.d += nd * pen * (1 - wb);
        }
        if (vn >= 0) continue;
        const J = (-(1 + PHYS.eBall) * vn) / (1 / BALL_M + 1 / PIN_M);
        ball.vx -= (nx * J) / BALL_M;
        ball.vd -= (nd * J) / BALL_M;
        if (!ball.touched) {
          ball.touched = true;
          impact = Math.min(impact, tNow);
          if (Number.isNaN(entryX)) {
            entryX = ball.x;
            entryAngle = Math.atan2(ball.vx, ball.vd);
          }
        }
        impacts++;
        hitPin(p, nx, nd, J, s, BALL_R);
        emit("ball", cx, cd, -vn, i);
      }
    }
    // Pin against pin.
    for (let i = 0; i < PIN_COUNT; i++) {
      const a = pins[i]!;
      if (a.mode === 2) continue;
      for (let j = i + 1; j < PIN_COUNT; j++) {
        const b = pins[j]!;
        if (b.mode === 2) continue;
        // Cheap reject.
        const ddx = a.x - b.x;
        const ddd = a.d - b.d;
        if (ddx * ddx + ddd * ddd > 0.9 * 0.9) continue;
        // Two pins resting on their bases at their spots never touch; skip the maths.
        if (a.mode === 0 && b.mode === 0 && a.th === 0 && b.th === 0 && a.vx === 0 && b.vx === 0 && a.vd === 0 && b.vd === 0) continue;
        // Height check: a pin flying high over another doesn't hit it.
        const dist = closestSegSeg(segA[i * 2]!, segA[i * 2 + 1]!, segB[i * 2]!, segB[i * 2 + 1]!, segA[j * 2]!, segA[j * 2 + 1]!, segB[j * 2]!, segB[j * 2 + 1]!);
        const minD = PIN_R * 2;
        if (dist >= minD) continue;
        const s = cpS;
        const t = cpT;
        // One flying clean over the other doesn't touch it.
        if (bottomOf(a) > topOf(b) || bottomOf(b) > topOf(a)) continue;
        const ya = pinPointY(a, s);
        const yb = pinPointY(b, t);
        const ax = segA[i * 2]! + (segB[i * 2]! - segA[i * 2]!) * s;
        const ad = segA[i * 2 + 1]! + (segB[i * 2 + 1]! - segA[i * 2 + 1]!) * s;
        const bx = segA[j * 2]! + (segB[j * 2]! - segA[j * 2]!) * t;
        const bd = segA[j * 2 + 1]! + (segB[j * 2 + 1]! - segA[j * 2 + 1]!) * t;
        let nx = bx - ax;
        let nd = bd - ad;
        const nl = Math.hypot(nx, nd);
        if (nl < 1e-9) {
          nx = a.x < b.x ? 1 : -1;
          nd = 0;
        } else {
          nx /= nl;
          nd /= nl;
        }
        const pen = minD - dist;
        a.x -= nx * pen * 0.5;
        a.d -= nd * pen * 0.5;
        b.x += nx * pen * 0.5;
        b.d += nd * pen * 0.5;
        pinPointVel(a, s, pv);
        pinPointVel(b, t, qv);
        const vn = (qv.x - pv.x) * nx + (qv.d - pv.d) * nd;
        if (vn >= 0) continue;
        const J = (-(1 + PHYS.ePin) * vn) / (2 / PIN_M);
        const h = Math.max(0.04, Math.min(ya, yb) * 0.6 + Math.max(ya, yb) * 0.4);
        hitPin(a, -nx, -nd, J, s, h);
        hitPin(b, nx, nd, J, t, h);
        if (-vn > 0.35) {
          impacts++;
          emit("pin", (ax + bx) / 2, (ad + bd) / 2, -vn, j);
        }
      }
    }

    if (step % SUB === 0) record();

    // --- done? ---------------------------------------------------------------------------------------------
    let quiet = ball.mode === 2 && ball.y < -0.3;
    if (quiet) {
      for (let i = 0; i < PIN_COUNT; i++) {
        const p = pins[i]!;
        if (p.mode === 2) {
          if (p.d > D_PIT && p.y > -0.85) {
            quiet = false;
            break;
          }
          continue;
        }
        if (p.mode === 0 && (p.th > 0.002 || Math.abs(p.om) > 0.02 || Math.abs(p.vx) + Math.abs(p.vd) > 0.01)) {
          quiet = false;
          break;
        }
        if (p.mode === 1 && (Math.abs(p.vx) + Math.abs(p.vd) > 0.03 || p.y > PIN_R + 0.004 || Math.abs(p.wy) > 0.3)) {
          quiet = false;
          break;
        }
      }
    }
    if (quiet) {
      if (quietSince < 0) quietSince = tNow;
      if (tNow - quietSince > 0.05) break;
    } else quietSince = -1;
  }
  if (frame < MAX_FRAMES) record();

  const after: boolean[] = [];
  const downAt: number[] = [];
  let knocked = 0;
  let lastDown = 0;
  for (let i = 0; i < PIN_COUNT; i++) {
    const p = pins[i]!;
    const was = standing[i]!;
    const up = was && !p.down;
    after.push(up);
    downAt.push(was && p.down ? p.downAt : Infinity);
    if (was && p.down) {
      knocked++;
      lastDown = Math.max(lastDown, p.downAt);
    }
    if (up && p.rocked) wobblers++;
  }
  if (Number.isNaN(entryX)) {
    entryX = ball.x;
    entryAngle = 0;
  }
  // The result is final once the last pin went down and the ball is past the pins (or in the gutter past them).
  const pastPins = ballDone < Infinity ? Math.min(ballDone, tNow) : tNow;
  const decided = Math.min(tNow, Math.max(lastDown + 0.12, Math.min(pastPins, impact + 0.45)));
  return {
    input,
    before: [...standing],
    after,
    knocked,
    impact,
    decided,
    end: tNow,
    frames: frame,
    events,
    gutter,
    entryX,
    entryAngle,
    downAt,
    wobblers,
    impacts,
    path: path.slice(0, pathN),
  };
}

/** Samples a recorded throw at time t into the frame buffer `out` (FRAME_STRIDE floats), interpolating. */
export function sampleThrow(frames: Float32Array, th: Throw, t: number, out: Float32Array): void {
  const f = Math.max(0, Math.min(th.frames - 1, t * FRAME_HZ));
  const i0 = Math.floor(f);
  const i1 = Math.min(th.frames - 1, i0 + 1);
  const u = f - i0;
  const a = i0 * FRAME_STRIDE;
  const b = i1 * FRAME_STRIDE;
  for (let k = 0; k < FRAME_STRIDE; k++) out[k] = frames[a + k]! + (frames[b + k]! - frames[a + k]!) * u;
}

/** Pins standing in a set, as numbers ("7-10"). */
export function leaveName(standing: readonly boolean[]): string {
  const n: number[] = [];
  standing.forEach((s, i) => s && n.push(i + 1));
  return n.join("-");
}

/**
 * A split: the head pin is down and what's left stands in two or more groups that don't touch (pins one spot apart,
 * across or diagonally, touch). 7-10, 4-6, 5-7, 2-7, 3-10 and 8-10 are splits; 2-4, 3-6-10 and 9-10 are not.
 */
export function isSplit(standing: readonly boolean[]): boolean {
  if (standing[0]) return false;
  const idx: number[] = [];
  standing.forEach((s, i) => s && idx.push(i));
  if (idx.length < 2) return false;
  const seen = new Set<number>([idx[0]!]);
  const stack = [idx[0]!];
  while (stack.length) {
    const a = stack.pop()!;
    for (const b of idx) {
      if (seen.has(b)) continue;
      const dx = SPOTS[a]!.x - SPOTS[b]!.x;
      const dd = SPOTS[a]!.d - SPOTS[b]!.d;
      if (Math.hypot(dx, dd) < 0.32) {
        seen.add(b);
        stack.push(b);
      }
    }
  }
  return seen.size < idx.length;
}

export const FULL_RACK: readonly boolean[] = Array.from({ length: PIN_COUNT }, () => true);
