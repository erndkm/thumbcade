/**
 * A small, deterministic circle solver for the tin: position-based dynamics with substeps (Müller et al., "Small
 * Steps in Physics Simulation"). Clay doesn't bounce, so contacts are fully inelastic; friction is positional
 * (static below a threshold, kinetic above it), which keeps piles still instead of creeping. Pure: no DOM, no
 * Math.random, no allocation while stepping. Units are tin units, y points up, the floor is the dough's surface.
 */

/** Most bodies the tin can hold (a full tin of the smallest bakes is about 90). */
export const MAX_BODIES = 120;
/** Fixed step and substeps: 1/120 s, four substeps of 1/480 s. */
export const STEP = 1 / 120;
export const SUBSTEPS = 4;
export const GRAVITY = -38;
/** Static and kinetic friction between clay pieces (relative to the penetration depth each substep). */
const MU_S = 0.45;
const MU_K = 0.3;
/** Pre-existing overlap eased out per substep: a fixed bit (about 5 units a second) plus a share of the rest. */
const SOFT_MAX = 0.01;
const SOFT_RATE = 0.08;
/** Seconds of stillness after which a contact holds fully (no creep down shallow slopes). */
const LOCK_T = 0.35;
/** After this long at rest a piece sleeps: sideways moves under SLEEP_DX a substep (0.2 units a second) are held. */
const SLEEP_T = 0.5;
const SLEEP_DX = 0.0004;
/** Leftover overlap above this (about a third of a pixel) is eased; below it, resolved in full. */
const SOFT_MIN = 0.01;
/** Against the dough (a little sticky) and the parchment walls (slippery). */
const MU_FLOOR = 0.5;
const MU_WALL = 0.15;
const MAX_SPEED = 28;
/** Fraction of velocity kept per second in free flight. */
const AIR_DRAG = 0.4;

export class World {
  readonly width: number;
  /** Height of the dough's surface. Bodies rest on it. */
  floor = 0;
  n = 0;
  private nextId = 1;
  readonly id = new Int32Array(MAX_BODIES);
  readonly tier = new Int8Array(MAX_BODIES);
  readonly x = new Float64Array(MAX_BODIES);
  readonly y = new Float64Array(MAX_BODIES);
  readonly vx = new Float64Array(MAX_BODIES);
  readonly vy = new Float64Array(MAX_BODIES);
  /** Start of the current substep (velocity is derived from it). */
  private readonly px = new Float64Array(MAX_BODIES);
  private readonly py = new Float64Array(MAX_BODIES);
  /** How far eased corrections moved each body this substep. */
  private readonly sx = new Float64Array(MAX_BODIES);
  private readonly sy = new Float64Array(MAX_BODIES);
  /** Start of the current step, for drawing between steps. */
  readonly ox = new Float64Array(MAX_BODIES);
  readonly oy = new Float64Array(MAX_BODIES);
  readonly oa = new Float64Array(MAX_BODIES);
  /** Radius now and the radius it grows to (a fresh merge swells into place instead of shoving its neighbours). */
  readonly r = new Float64Array(MAX_BODIES);
  readonly rT = new Float64Array(MAX_BODIES);
  readonly grow = new Float64Array(MAX_BODIES);
  /** Seconds since the body appeared. */
  readonly age = new Float64Array(MAX_BODIES);
  /** Chain depth that made this body (0 = dropped by the player). */
  readonly chain = new Int16Array(MAX_BODIES);
  /** 1 once the body has touched the dough or another piece. */
  readonly landed = new Uint8Array(MAX_BODIES);
  /** 1 while something holds it up (rolling), refreshed every step. */
  readonly support = new Uint8Array(MAX_BODIES);
  /** Seconds it has been nearly still. */
  readonly rest = new Float64Array(MAX_BODIES);
  readonly angle = new Float64Array(MAX_BODIES);
  readonly spin = new Float64Array(MAX_BODIES);
  /** Hardest impact this step: closing speed and its direction (from the body toward what it hit). */
  readonly hit = new Float64Array(MAX_BODIES);
  readonly hnx = new Float64Array(MAX_BODIES);
  readonly hny = new Float64Array(MAX_BODIES);
  /** Free slots for whoever draws the body (squash springs, blink timers); they move with the body. */
  readonly u0 = new Float64Array(MAX_BODIES);
  readonly u1 = new Float64Array(MAX_BODIES);
  readonly u2 = new Float64Array(MAX_BODIES);
  readonly u3 = new Float64Array(MAX_BODIES);
  readonly u4 = new Float64Array(MAX_BODIES);

  /** Every per-body float column, so a removal moves them all. */
  private readonly floats: Float64Array[];

  constructor(width: number) {
    this.width = width;
    this.floats = [this.x, this.y, this.vx, this.vy, this.px, this.py, this.ox, this.oy, this.oa, this.r, this.rT, this.grow, this.age, this.rest, this.angle, this.spin, this.hit, this.hnx, this.hny, this.u0, this.u1, this.u2, this.u3, this.u4];
  }

  /** Adds a body; returns its index, or -1 when the tin is full. */
  add(tier: number, x: number, y: number, r: number, rTarget = r, growSeconds = 0): number {
    if (this.n >= MAX_BODIES) return -1;
    const i = this.n++;
    this.id[i] = this.nextId++;
    this.tier[i] = tier;
    this.x[i] = this.ox[i] = this.px[i] = x;
    this.y[i] = this.oy[i] = this.py[i] = y;
    this.vx[i] = this.vy[i] = 0;
    this.r[i] = r;
    this.rT[i] = rTarget;
    this.grow[i] = growSeconds > 0 ? (rTarget - r) / growSeconds : 0;
    if (growSeconds <= 0) this.r[i] = rTarget;
    this.age[i] = 0;
    this.chain[i] = 0;
    this.landed[i] = 0;
    this.support[i] = 0;
    this.rest[i] = 0;
    this.angle[i] = this.oa[i] = 0;
    this.spin[i] = 0;
    this.hit[i] = this.hnx[i] = this.hny[i] = 0;
    this.u0[i] = this.u1[i] = this.u2[i] = this.u3[i] = this.u4[i] = 0;
    return i;
  }

  /** Removes body i by moving the last body into its slot. */
  remove(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.id[i] = this.id[j]!;
    this.tier[i] = this.tier[j]!;
    for (const a of this.floats) a[i] = a[j]!;
    this.chain[i] = this.chain[j]!;
    this.landed[i] = this.landed[j]!;
    this.support[i] = this.support[j]!;
  }

  indexOf(id: number): number {
    for (let i = 0; i < this.n; i++) if (this.id[i] === id) return i;
    return -1;
  }

  clear(): void {
    this.n = 0;
  }

  /** Advances one fixed step. `floorTo` is where the dough's surface is at the end of the step. */
  step(floorTo: number = this.floor): void {
    const n = this.n;
    const h = STEP / SUBSTEPS;
    const floor0 = this.floor;
    const drag = 1 - AIR_DRAG * h;
    for (let i = 0; i < n; i++) {
      this.ox[i] = this.x[i]!;
      this.oy[i] = this.y[i]!;
      this.oa[i] = this.angle[i]!;
      this.hit[i] = 0;
      this.support[i] = 0;
    }
    for (let s = 1; s <= SUBSTEPS; s++) {
      this.floor = floor0 + (floorTo - floor0) * (s / SUBSTEPS);
      for (let i = 0; i < n; i++) {
        if (this.grow[i]! > 0) {
          const r = this.r[i]! + this.grow[i]! * h;
          if (r >= this.rT[i]!) {
            this.r[i] = this.rT[i]!;
            this.grow[i] = 0;
          } else this.r[i] = r;
        }
        this.vy[i] = (this.vy[i]! + GRAVITY * h) * drag;
        this.vx[i] = this.vx[i]! * drag;
        this.px[i] = this.x[i]!;
        this.py[i] = this.y[i]!;
        this.sx[i] = this.sy[i] = 0;
        this.x[i] = this.x[i]! + this.vx[i]! * h;
        this.y[i] = this.y[i]! + this.vy[i]! * h;
      }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) this.collide(i, j);
      for (let i = 0; i < n; i++) this.bounds(i);
      for (let i = 0; i < n; i++) {
        // Asleep: a piece at rest keeps its place sideways unless something really moves it.
        if (this.rest[i]! > SLEEP_T) {
          const dx = this.x[i]! - this.px[i]!;
          if (dx < SLEEP_DX && dx > -SLEEP_DX) this.x[i] = this.px[i]!;
        }
        let vx = (this.x[i]! - this.px[i]!) / h;
        let vy = (this.y[i]! - this.py[i]!) / h;
        const sp = vx * vx + vy * vy;
        if (sp > MAX_SPEED * MAX_SPEED) {
          const k = MAX_SPEED / Math.sqrt(sp);
          vx *= k;
          vy *= k;
        }
        this.vx[i] = vx;
        this.vy[i] = vy;
      }
    }
    this.floor = floorTo;
    for (let i = 0; i < n; i++) {
      this.age[i] = this.age[i]! + STEP;
      const vx = this.vx[i]!;
      // Still means it moved less than 0.2 units a second over the whole step (the substep estimate wobbles inside
      // a stack), relative to the dough, which carries the pile up as it rises.
      const mx = this.x[i]! - this.ox[i]!;
      const my = this.y[i]! - this.oy[i]! - (floorTo - floor0);
      const still = mx * mx + my * my < (0.2 * STEP) ** 2;
      this.rest[i] = still ? this.rest[i]! + STEP : 0;
      // Rolling, for the eye only: a supported piece turns with its sideways speed, a falling one keeps spinning.
      const r = this.r[i]!;
      const target = -vx / r;
      this.spin[i] = this.support[i] ? this.spin[i]! + (target - this.spin[i]!) * 0.12 : this.spin[i]! * 0.995;
      this.angle[i] = this.angle[i]! + this.spin[i]! * STEP;
    }
  }

  private collide(i: number, j: number): void {
    const dx = this.x[j]! - this.x[i]!;
    const dy = this.y[j]! - this.y[i]!;
    const rr = this.r[i]! + this.r[j]!;
    if (dx >= rr || dx <= -rr || dy >= rr || dy <= -rr) return;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    let nx = 1;
    let ny = 0;
    let d = 0;
    if (d2 > 1e-18) {
      d = Math.sqrt(d2);
      nx = dx / d;
      ny = dy / d;
    }
    const pen = rr - d;
    // Heavier (bigger) pieces move less: mass goes with area.
    const wi = 1 / (this.r[i]! * this.r[i]!);
    const wj = 1 / (this.r[j]! * this.r[j]!);
    const ki = wi / (wi + wj);
    const kj = wj / (wi + wj);
    // How fast they were closing, for squash and sound.
    const close = (this.vx[i]! - this.vx[j]!) * nx + (this.vy[i]! - this.vy[j]!) * ny;
    // Split the correction: what this substep's motion closed is undone outright (that stops an impact), while
    // overlap that was already there (a fresh merge swelling into its neighbours, a piece squeezed between them) is
    // eased out a little per substep and moves the start point too, so it adds no speed: a merge never throws the
    // pile. Hairline leftovers inside a resting stack are resolved in full instead, or easing them along their
    // slopes would let the pile creep.
    const closed = (this.x[i]! - this.px[i]! - (this.x[j]! - this.px[j]!)) * nx + (this.y[i]! - this.py[i]! - (this.y[j]! - this.py[j]!)) * ny;
    const moved = Math.min(pen, Math.max(0, closed));
    const extra = pen - moved;
    const ease = extra > SOFT_MIN;
    const hard = ease ? moved : pen;
    const soft = ease ? Math.min(extra, SOFT_MAX + extra * SOFT_RATE) : 0;
    const c = hard + soft;
    this.x[i] = this.x[i]! - nx * c * ki;
    this.y[i] = this.y[i]! - ny * c * ki;
    this.x[j] = this.x[j]! + nx * c * kj;
    this.y[j] = this.y[j]! + ny * c * kj;
    if (soft > 0) {
      this.px[i] = this.px[i]! - nx * soft * ki;
      this.py[i] = this.py[i]! - ny * soft * ki;
      this.px[j] = this.px[j]! + nx * soft * kj;
      this.py[j] = this.py[j]! + ny * soft * kj;
      this.sx[i] = this.sx[i]! - nx * soft * ki;
      this.sy[i] = this.sy[i]! - ny * soft * ki;
      this.sx[j] = this.sx[j]! + nx * soft * kj;
      this.sy[j] = this.sy[j]! + ny * soft * kj;
    }
    // Positional friction on the relative sideways slip during this substep.
    const rdx = this.x[i]! - this.px[i]! - (this.x[j]! - this.px[j]!);
    const rdy = this.y[i]! - this.py[i]! - (this.y[j]! - this.py[j]!);
    const dn = rdx * nx + rdy * ny;
    const tx = rdx - dn * nx;
    const ty = rdy - dn * ny;
    const tl = Math.sqrt(tx * tx + ty * ty);
    if (tl > 1e-12) {
      const held = this.rest[i]! > LOCK_T && this.rest[j]! > LOCK_T;
      const k = held || tl < MU_S * c ? 1 : Math.min(1, (MU_K * c) / tl);
      this.x[i] = this.x[i]! - tx * k * ki;
      this.y[i] = this.y[i]! - ty * k * ki;
      this.x[j] = this.x[j]! + tx * k * kj;
      this.y[j] = this.y[j]! + ty * k * kj;
    }
    this.landed[i] = this.landed[j] = 1;
    if (ny > 0.3) this.support[j] = 1;
    else if (ny < -0.3) this.support[i] = 1;
    if (close > this.hit[i]!) {
      this.hit[i] = close;
      this.hnx[i] = nx;
      this.hny[i] = ny;
    }
    if (close > this.hit[j]!) {
      this.hit[j] = close;
      this.hnx[j] = -nx;
      this.hny[j] = -ny;
    }
  }

  private bounds(i: number): void {
    const r = this.r[i]!;
    const pen = this.floor + r - this.y[i]!;
    if (pen > 0) {
      const close = -this.vy[i]!;
      this.y[i] = this.y[i]! + pen;
      // Whatever an eased push shoved into the dough, or a swelling piece grew into it, comes back without speed.
      const eased = Math.max(0, -this.sy[i]!) + this.grow[i]! * (STEP / SUBSTEPS);
      if (eased > 0) this.py[i] = this.py[i]! + Math.min(pen, eased);
      const slip = this.x[i]! - this.px[i]!;
      if (this.rest[i]! > LOCK_T || (slip < MU_FLOOR * pen && slip > -MU_FLOOR * pen)) this.x[i] = this.px[i]!;
      else this.x[i] = this.x[i]! - Math.sign(slip) * MU_FLOOR * 0.6 * pen;
      this.landed[i] = 1;
      this.support[i] = 1;
      if (close > this.hit[i]!) {
        this.hit[i] = close;
        this.hnx[i] = 0;
        this.hny[i] = -1;
      }
    }
    const left = r - this.x[i]!;
    const right = this.x[i]! + r - this.width;
    const wall = left > 0 ? left : right > 0 ? -right : 0;
    if (wall !== 0) {
      const close = wall > 0 ? -this.vx[i]! : this.vx[i]!;
      this.x[i] = this.x[i]! + wall;
      const g = this.grow[i]! * (STEP / SUBSTEPS);
      if (wall > 0) this.px[i] = this.px[i]! + Math.min(wall, Math.max(0, -this.sx[i]!) + g);
      else this.px[i] = this.px[i]! - Math.min(-wall, Math.max(0, this.sx[i]!) + g);
      const slip = this.y[i]! - this.py[i]!;
      const p = Math.abs(wall);
      if ((this.rest[i]! > LOCK_T && slip < 0.01 && slip > -0.01) || (slip < MU_WALL * p && slip > -MU_WALL * p)) this.y[i] = this.py[i]!;
      else this.y[i] = this.y[i]! - Math.sign(slip) * MU_WALL * p;
      if (close > this.hit[i]!) {
        this.hit[i] = close;
        this.hnx[i] = wall > 0 ? -1 : 1;
        this.hny[i] = 0;
      }
    }
  }

  /** Total kinetic energy per body, a stillness measure for tests and the pilot. */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.n; i++) e += this.vx[i]! * this.vx[i]! + this.vy[i]! * this.vy[i]!;
    return this.n ? e / this.n : 0;
  }
}
