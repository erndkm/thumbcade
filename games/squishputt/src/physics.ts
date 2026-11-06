/**
 * Ball physics on the course plane: one circle against segments (capsules) and circles, rolling friction,
 * sand drag, gravity from the height field, a cup that swallows slow balls and a windmill that blocks its
 * tunnel whenever a blade points down. Fixed 240 Hz steps; deterministic, so the demo can plan shots.
 */
import { closestOnSegment, type V2 } from "./geom.ts";
import { BALL_R, CUP_R, heightAt, inBlob, slopeAt, type HoleDef } from "./holes.ts";

export const MAX_SPEED = 7.4;
export const STEP = 1 / 240;
const G = 9;
const GREEN = { decel: 1.35, drag: 0.32 };
const SAND = { decel: 5.6, drag: 2.8 };
const WALL_E = 0.72;
const BUMPER_E = 1.12;
const GATE_E = 0.45;
const BOUNCE_CAP = 7.6;
/** Decorative animation runs at 12 fps; the windmill's blades collide where they are drawn. */
export const STOP_MOTION_FPS = 12;
const BLADE_BLOCK = 0.38;

export interface Ball {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface StepEvents {
  /** Impact speeds (0 = none this step). */
  wall: number;
  bumper: number;
  bumperIndex: number;
  gate: number;
  enteredSand: boolean;
  water: boolean;
  sunk: boolean;
}

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
  e: number;
}

export function bladeAngle(h: HoleDef, t: number): number {
  const w = h.windmill;
  if (!w) return 0;
  return w.phase + w.speed * (Math.floor(t * STOP_MOTION_FPS) / STOP_MOTION_FPS);
}

/** True while one of the four blades hangs in front of the tunnel. */
export function gateClosed(h: HoleDef, t: number): boolean {
  if (!h.windmill) return false;
  const q = Math.PI / 2;
  const a = bladeAngle(h, t);
  const m = ((((a + q / 2) % q) + q) % q) - q / 2;
  return Math.abs(m) < BLADE_BLOCK;
}

export class Course {
  readonly segs: Seg[] = [];
  readonly gate: Seg | null;
  constructor(readonly hole: HoleDef) {
    const o = hole.outline;
    for (let i = 0; i < o.length; i++) {
      const a = o[i]!;
      const b = o[(i + 1) % o.length]!;
      this.segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r: 0, e: WALL_E });
    }
    for (const w of hole.walls) this.segs.push({ ax: w.ax, az: w.az, bx: w.bx, bz: w.bz, r: w.r, e: WALL_E });
    const m = hole.windmill;
    // The bottom sail sweeps just in front of the door.
    this.gate = m ? { ax: m.x - m.gap - 0.2, az: m.z + 0.5, bx: m.x + m.gap + 0.2, bz: m.z + 0.5, r: 0.05, e: GATE_E } : null;
  }

  height(x: number, z: number): number {
    return heightAt(this.hole, x, z);
  }

  inSand(x: number, z: number): boolean {
    for (const s of this.hole.sand) if (inBlob(s, x, z)) return true;
    return false;
  }

  inWater(x: number, z: number): boolean {
    for (const w of this.hole.water) if (inBlob(w, x, z, 0.04)) return true;
    return false;
  }
}

const cp: V2 = { x: 0, z: 0 };
const grad: V2 = { x: 0, z: 0 };

function collide(b: Ball, s: Seg): number {
  const d2 = closestOnSegment(s.ax, s.az, s.bx, s.bz, b.x, b.z, cp);
  const rr = s.r + BALL_R;
  if (d2 >= rr * rr) return 0;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = (b.x - cp.x) / d;
  const nz = (b.z - cp.z) / d;
  b.x = cp.x + nx * rr;
  b.z = cp.z + nz * rr;
  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return 0;
  b.vx -= (1 + s.e) * vn * nx;
  b.vz -= (1 + s.e) * vn * nz;
  // A little grip along the wall: clay is not glass.
  b.vx *= 0.97;
  b.vz *= 0.97;
  return -vn;
}

export function newEvents(): StepEvents {
  return { wall: 0, bumper: 0, bumperIndex: -1, gate: 0, enteredSand: false, water: false, sunk: false };
}

export interface RollState {
  slowFor: number;
  inSand: boolean;
}

/**
 * Advances the ball one fixed step. `t` is the hole clock (drives the windmill). Returns true while the ball
 * is still rolling.
 */
export function step(c: Course, b: Ball, t: number, st: RollState, ev: StepEvents): boolean {
  const dt = STEP;
  slopeAt(c.hole, b.x, b.z, grad);
  const ax = -G * grad.x;
  const az = -G * grad.z;
  const sand = c.inSand(b.x, b.z);
  if (sand && !st.inSand) ev.enteredSand = true;
  st.inSand = sand;
  const f = sand ? SAND : GREEN;

  b.vx += ax * dt;
  b.vz += az * dt;
  let sp = Math.hypot(b.vx, b.vz);
  if (sp > 0) {
    const drop = (f.decel + f.drag * sp) * dt;
    const k = sp > drop ? (sp - drop) / sp : 0;
    b.vx *= k;
    b.vz *= k;
    sp *= k;
  }

  // The cup: a gentle funnel; slow balls drop in.
  const cdx = c.hole.cup.x - b.x;
  const cdz = c.hole.cup.z - b.z;
  const cd = Math.hypot(cdx, cdz);
  if (cd < CUP_R) {
    const pull = 11 * (1 - cd / CUP_R) + 3;
    b.vx += (cdx / (cd || 1)) * pull * dt;
    b.vz += (cdz / (cd || 1)) * pull * dt;
    const sinkSpeed = 2.1 + 1.6 * (1 - cd / CUP_R);
    if (cd < CUP_R - 0.035 && sp < sinkSpeed) {
      ev.sunk = true;
      return false;
    }
  }

  b.x += b.vx * dt;
  b.z += b.vz * dt;

  for (const s of c.segs) {
    const hit = collide(b, s);
    if (hit > ev.wall) ev.wall = hit;
  }
  const bumpers = c.hole.bumpers;
  for (let i = 0; i < bumpers.length; i++) {
    const p = bumpers[i]!;
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const rr = p.r + BALL_R;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d;
    const nz = dz / d;
    b.x = p.x + nx * rr;
    b.z = p.z + nz * rr;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) {
      b.vx -= (1 + BUMPER_E) * vn * nx;
      b.vz -= (1 + BUMPER_E) * vn * nz;
      const s2 = Math.hypot(b.vx, b.vz);
      if (s2 > BOUNCE_CAP) {
        b.vx *= BOUNCE_CAP / s2;
        b.vz *= BOUNCE_CAP / s2;
      }
      if (-vn > ev.bumper) {
        ev.bumper = -vn;
        ev.bumperIndex = i;
      }
    }
  }
  if (c.gate && gateClosed(c.hole, t)) {
    const hit = collide(b, c.gate);
    if (hit > ev.gate) ev.gate = hit;
  }

  if (c.inWater(b.x, b.z)) {
    ev.water = true;
    return false;
  }

  sp = Math.hypot(b.vx, b.vz);
  const slope = Math.hypot(ax, az);
  if (sp < 0.05) {
    if (slope < f.decel * 1.05) {
      b.vx = 0;
      b.vz = 0;
      return false;
    }
    st.slowFor += dt;
    if (st.slowFor > 0.5) {
      b.vx = 0;
      b.vz = 0;
      return false;
    }
  } else if (sp > 0.25) st.slowFor = 0;
  return true;
}

export interface ShotResult {
  sunk: boolean;
  water: boolean;
  x: number;
  z: number;
  /** Seconds until the ball rested, sank or splashed. */
  time: number;
}

/** Runs a whole shot (for the demo planner and the hole tests). */
export function simulate(c: Course, from: V2, vx: number, vz: number, t0: number, maxTime = 12): ShotResult {
  const b: Ball = { x: from.x, z: from.z, vx, vz };
  const st: RollState = { slowFor: 0, inSand: c.inSand(from.x, from.z) };
  const ev = newEvents();
  let t = 0;
  while (t < maxTime) {
    ev.sunk = false;
    ev.water = false;
    const rolling = step(c, b, t0 + t, st, ev);
    t += STEP;
    if (!rolling) break;
  }
  return { sunk: ev.sunk, water: ev.water, x: b.x, z: b.z, time: t };
}
