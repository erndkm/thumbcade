/**
 * Galebell's ball physics: pure, deterministic and allocation-free while stepping.
 *
 * Every substep the flippers turn first, then each ball is swept from where it is to where it would be: the earliest
 * time of impact against the static walls (capsule segments, circles, inside and outside faces of arcs) and against
 * both flippers is found, the ball is moved there, its velocity is resolved, and the rest of the substep continues,
 * up to eight contacts a substep. A flipper is swept in its own turning frame (the ball's path relative to the rubber,
 * found by conservative advancement against the tapered capsule's distance field), and the rubber's surface velocity
 * at the contact point (angular velocity × lever arm) goes into the impulse, so a ball met near the tip by a flipper in
 * full swing leaves fast, and one met at the base leaves soft. A safety net that would push a stray ball back out of a
 * wall counts its corrections; the tests check that it never has to act.
 */
import { BALL_R, DRAIN_Y, Sensor, Tag, type FlipperDef, type TableDef } from "./table.ts";

export { BALL_R } from "./table.ts";

export const GRAVITY = 1150;
export const MAX_SPEED = 3200;
/** The fixed substep the game runs at. */
export const SUBSTEP = 1 / 480;
/** Below this approach speed a contact doesn't bounce (rest, roll, cradle). */
const REST_SPEED = 60;
/** Rolling loss per second on the playfield. */
const ROLL_DAMP = 0.06;
const MAX_CONTACTS = 8;
const EPS = 1e-4;
/** The safety net only counts a penetration deeper than this. */
const SAFETY_TOL = 0.25;

export const BUMPER_KICK = 960;
export const SLING_KICK = 860;
/** A drop target goes down when the ball meets its face at least this fast. */
export const TARGET_DROP_SPEED = 110;

/** Flipper motion. */
export const FLIP_UP_SPEED = 27;
const FLIP_UP_ACCEL = 3200;
const FLIP_DOWN_SPEED = 17;
const FLIP_DOWN_ACCEL = 1100;
const FLIP_E = 0.55;
const FLIP_F = 0.12;

interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  len: number;
  R: number;
  e: number;
  f: number;
  tag: Tag;
  block: boolean;
  bnx: number;
  bny: number;
  enabled: boolean;
}

interface Circ {
  x: number;
  y: number;
  R: number;
  e: number;
  f: number;
  tag: Tag;
  enabled: boolean;
}

interface Arc {
  x: number;
  y: number;
  Rin: number;
  Rout: number;
  start: number;
  sweep: number;
  inner: boolean;
  outer: boolean;
  e: number;
  f: number;
  tag: Tag;
}

export interface Flipper {
  readonly def: FlipperDef;
  angle: number;
  omega: number;
  /** Angle at the start of the substep (for the sweep). */
  angle0: number;
  pressed: boolean;
  /** Held down (the cradle limit) until this time, whatever the button says. */
  forcedDownUntil: number;
  /** -1 or +1: the way the rubber turns when raised. */
  readonly dir: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** In play (physics runs), or parked (in the shooter lane before launch counts as in play). */
  live: boolean;
  /** Seconds a fresh kickout ignores the harbour. */
  harbourImmune: number;
  /** Visual roll angle. */
  roll: number;
  /** Seconds since this ball last touched a flipper while nearly still (cradle timer input). */
  restOn: number;
  restSide: number;
}

export const EvKind = {
  Contact: 0,
  Sensor: 1,
  Harbour: 2,
  Drain: 3,
  TargetDown: 4,
  BallBall: 5,
} as const;
export type EvKind = (typeof EvKind)[keyof typeof EvKind];

/** One physics event. `a` is a tag or sensor id, `s` an impact speed or crossing direction. */
export interface PhysEvent {
  kind: EvKind;
  ball: number;
  a: number;
  s: number;
  x: number;
  y: number;
}

const TAU = Math.PI * 2;
const GRID = 32;
const GX0 = -40;
const GY0 = -40;
const GW = 14;
const GH = 24;

export class World {
  readonly def: TableDef;
  readonly segs: Seg[] = [];
  readonly circs: Circ[] = [];
  readonly arcs: Arc[] = [];
  readonly flippers: [Flipper, Flipper];
  balls: Ball[] = [];
  /** Sim time in seconds. */
  t = 0;
  /** Events since the last drain; read `events` up to `evCount`. */
  readonly events: PhysEvent[] = [];
  evCount = 0;
  /** Penetrations the safety net had to fix (should stay 0). */
  corrections = 0;
  /** The deepest second-order drift into a turning flipper that `ride` took back (units). */
  rideMax = 0;
  /** Spinner angle and speed (rad, rad/s). */
  spin = 0;
  spinV = 0;
  private nextId = 1;
  // Broadphase: per cell, indices into a flat list of [type, index].
  private readonly cells: Int32Array[] = [];
  private readonly stamp: Int32Array;
  private stampN = 1;
  private readonly cand = new Int32Array(256);
  private candN = 0;
  // Scratch for the earliest hit.
  private hT = 0;
  private hNx = 0;
  private hNy = 0;
  private hKind = 0;
  private hIdx = 0;
  private hVsx = 0;
  private hVsy = 0;
  private hPx = 0;
  private hPy = 0;

  constructor(def: TableDef) {
    this.def = def;
    for (const s of def.segs) {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const len = Math.hypot(dx, dy);
      const ux = dx / len;
      const uy = dy / len;
      this.segs.push({
        ax: s.ax,
        ay: s.ay,
        bx: s.bx,
        by: s.by,
        ux,
        uy,
        nx: -uy,
        ny: ux,
        len,
        R: s.r + BALL_R,
        e: s.e,
        f: s.f,
        tag: s.tag,
        block: !!s.block,
        bnx: s.block?.[0] ?? 0,
        bny: s.block?.[1] ?? 0,
        enabled: true,
      });
    }
    for (const c of def.circles) this.circs.push({ x: c.x, y: c.y, R: c.R + BALL_R, e: c.e, f: c.f, tag: c.tag, enabled: true });
    for (const a of def.arcs) {
      this.arcs.push({
        x: a.x,
        y: a.y,
        Rin: a.R - a.r - BALL_R,
        Rout: a.R + a.r + BALL_R,
        start: a.start,
        sweep: a.sweep,
        inner: (a.sides & 1) !== 0,
        outer: (a.sides & 2) !== 0,
        e: a.e,
        f: a.f,
        tag: a.tag,
      });
    }
    const mk = (d: FlipperDef): Flipper => ({ def: d, angle: d.rest, omega: 0, angle0: d.rest, pressed: false, forcedDownUntil: 0, dir: Math.sign(d.up - d.rest) });
    this.flippers = [mk(def.flippers[0]), mk(def.flippers[1])];
    for (let i = 0; i < 256; i++) this.events.push({ kind: EvKind.Contact, ball: 0, a: 0, s: 0, x: 0, y: 0 });
    // Broadphase grid over static colliders (encoded as type * 4096 + index).
    const lists: number[][] = [];
    for (let i = 0; i < GW * GH; i++) lists.push([]);
    const add = (code: number, x0: number, y0: number, x1: number, y1: number) => {
      const cx0 = Math.max(0, Math.floor((x0 - GX0) / GRID));
      const cy0 = Math.max(0, Math.floor((y0 - GY0) / GRID));
      const cx1 = Math.min(GW - 1, Math.floor((x1 - GX0) / GRID));
      const cy1 = Math.min(GH - 1, Math.floor((y1 - GY0) / GRID));
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) lists[cy * GW + cx]!.push(code);
    };
    this.segs.forEach((s, i) => add(i, Math.min(s.ax, s.bx) - s.R, Math.min(s.ay, s.by) - s.R, Math.max(s.ax, s.bx) + s.R, Math.max(s.ay, s.by) + s.R));
    this.circs.forEach((c, i) => add(4096 + i, c.x - c.R, c.y - c.R, c.x + c.R, c.y + c.R));
    this.arcs.forEach((a, i) => {
      // Bound the arc by its sampled points.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let k = 0; k <= 32; k++) {
        const ang = a.start + (a.sweep * k) / 32;
        for (const R of [a.Rin, a.Rout]) {
          const px = a.x + Math.cos(ang) * R;
          const py = a.y + Math.sin(ang) * R;
          x0 = Math.min(x0, px);
          y0 = Math.min(y0, py);
          x1 = Math.max(x1, px);
          y1 = Math.max(y1, py);
        }
      }
      add(8192 + i, x0 - 2, y0 - 2, x1 + 2, y1 + 2);
    });
    for (const l of lists) this.cells.push(Int32Array.from(l));
    this.stamp = new Int32Array(this.segs.length + this.circs.length + this.arcs.length + 8);
  }

  // --- balls -----------------------------------------------------------------------------------------------------

  addBall(x: number, y: number, vx = 0, vy = 0): Ball {
    const b: Ball = { id: this.nextId++, x, y, vx, vy, live: true, harbourImmune: 0, roll: 0, restOn: 0, restSide: -1 };
    this.balls.push(b);
    return b;
  }

  removeBall(b: Ball): void {
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }

  setTarget(i: number, up: boolean): void {
    for (const s of this.segs) if (s.tag === Tag.Target0 + i) s.enabled = up;
  }

  targetUp(i: number): boolean {
    for (const s of this.segs) if (s.tag === Tag.Target0 + i) return s.enabled;
    return false;
  }

  private emit(kind: EvKind, ball: number, a: number, s: number, x: number, y: number): void {
    if (this.evCount >= this.events.length) return;
    const e = this.events[this.evCount++]!;
    e.kind = kind;
    e.ball = ball;
    e.a = a;
    e.s = s;
    e.x = x;
    e.y = y;
  }

  // --- stepping ----------------------------------------------------------------------------------------------------

  /** Advances `dt` seconds in equal substeps no longer than SUBSTEP. */
  step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
  }

  /** One substep of exactly `h` seconds (tests call this directly with long steps). */
  substep(h: number): void {
    this.t += h;
    for (const f of this.flippers) this.turnFlipper(f, h);
    const damp = 1 - ROLL_DAMP * h;
    for (const b of this.balls) {
      if (!b.live) continue;
      b.vy += GRAVITY * h;
      b.vx *= damp;
      b.vy *= damp;
    }
    if (this.balls.length > 1) this.ballPairs(h);
    for (const b of this.balls) {
      if (!b.live) continue;
      const px = b.x;
      const py = b.y;
      this.sweep(b, h);
      this.clampSpeed(b);
      this.safety(b);
      this.sensors(b, px, py);
      const sp = Math.hypot(b.vx, b.vy);
      b.roll += (sp * h) / BALL_R;
      if (b.harbourImmune > 0) b.harbourImmune -= h;
      // Harbour: a ball whose centre drops into the saucer is held.
      const hb = this.def.harbour;
      if (b.harbourImmune <= 0 && (b.x - hb.x) ** 2 + (b.y - hb.y) ** 2 < hb.capture * hb.capture) {
        b.live = false;
        this.emit(EvKind.Harbour, b.id, 0, sp, b.x, b.y);
      }
      if (b.y > DRAIN_Y) {
        b.live = false;
        this.emit(EvKind.Drain, b.id, 0, sp, b.x, b.y);
      }
    }
    // The vane spins down.
    this.spin += this.spinV * h;
    this.spinV *= Math.exp(-1.6 * h);
    if (Math.abs(this.spinV) < 0.5) this.spinV = 0;
  }

  private turnFlipper(f: Flipper, h: number): void {
    f.angle0 = f.angle;
    const d = f.def;
    const up = f.pressed && this.t >= f.forcedDownUntil;
    if (up) {
      f.omega = f.dir * Math.min(FLIP_UP_SPEED, Math.max(0, f.omega * f.dir) + FLIP_UP_ACCEL * h);
    } else {
      f.omega = -f.dir * Math.min(FLIP_DOWN_SPEED, Math.max(0, -f.omega * f.dir) + FLIP_DOWN_ACCEL * h);
    }
    f.angle += f.omega * h;
    // Stops at both ends.
    const lo = Math.min(d.rest, d.up);
    const hi = Math.max(d.rest, d.up);
    if (f.angle <= lo) {
      f.angle = lo;
      if (f.omega < 0) f.omega = 0;
    } else if (f.angle >= hi) {
      f.angle = hi;
      if (f.omega > 0) f.omega = 0;
    }
  }

  private clampSpeed(b: Ball): void {
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(sp2);
      b.vx *= k;
      b.vy *= k;
    }
  }

  /** Collects the static colliders near the swept box. */
  private gather(x0: number, y0: number, x1: number, y1: number): void {
    this.candN = 0;
    this.stampN++;
    const cx0 = Math.max(0, Math.floor((Math.min(x0, x1) - GX0) / GRID));
    const cy0 = Math.max(0, Math.floor((Math.min(y0, y1) - GY0) / GRID));
    const cx1 = Math.min(GW - 1, Math.floor((Math.max(x0, x1) - GX0) / GRID));
    const cy1 = Math.min(GH - 1, Math.floor((Math.max(y0, y1) - GY0) / GRID));
    const ns = this.segs.length;
    const nc = this.circs.length;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const l = this.cells[cy * GW + cx]!;
        for (let k = 0; k < l.length; k++) {
          const code = l[k]!;
          const flat = code < 4096 ? code : code < 8192 ? ns + code - 4096 : ns + nc + code - 8192;
          if (this.stamp[flat] === this.stampN) continue;
          this.stamp[flat] = this.stampN;
          if (this.candN < this.cand.length) this.cand[this.candN++] = code;
        }
      }
    }
  }

  private sweep(b: Ball, h: number): void {
    let left = h;
    for (let iter = 0; iter < MAX_CONTACTS && left > 1e-9; iter++) {
      const dx = b.vx * left;
      const dy = b.vy * left;
      this.gather(b.x - 1, b.y - 1, b.x + dx + 1, b.y + dy + 1);
      this.hT = 2;
      for (let k = 0; k < this.candN; k++) {
        const code = this.cand[k]!;
        if (code < 4096) this.hitSeg(b, code, dx, dy);
        else if (code < 8192) this.hitCirc(b, code - 4096, dx, dy);
        else this.hitArc(b, code - 8192, dx, dy);
      }
      for (let i = 0; i < 2; i++) this.hitFlipper(b, i, left, h);
      if (this.hT > 1) {
        b.x += dx;
        b.y += dy;
        this.ride(b, h);
        return;
      }
      const t = this.hT;
      if (this.hKind === 3) {
        // Flipper contacts already computed the contact position.
        b.x = this.hPx;
        b.y = this.hPy;
      } else {
        b.x += dx * t;
        b.y += dy * t;
      }
      if (this.hKind === 2) {
        // A ball running along a curved wall drifts off its circle by s²/2R a substep; keep it on the circle.
        const a = this.arcs[this.hIdx]!;
        const qx = b.x - a.x;
        const qy = b.y - a.y;
        const r = Math.hypot(qx, qy) || 1;
        const inner = qx * this.hNx + qy * this.hNy < 0;
        const want = inner ? Math.min(r, a.Rin) : Math.max(r, a.Rout);
        b.x = a.x + (qx / r) * want;
        b.y = a.y + (qy / r) * want;
      }
      // Back off a hair along the normal so the next ray starts outside.
      b.x += this.hNx * EPS;
      b.y += this.hNy * EPS;
      this.resolve(b);
      left *= 1 - t;
    }
  }

  /**
   * A ball riding a turning flipper drifts into it by second order (the rubber's frame turns under the ball's
   * straight path: ω × the ball's speed along the rubber × h², about 0.05 units a substep at full swing). Keep it on
   * the surface and moving with it. Only ever shallow: `rideMax` records the deepest drift for the tests.
   */
  private ride(b: Ball, h: number): void {
    // A ball running along a curved wall cuts a chord of it in a straight step (s²/2R: 0.05 units at the game's
    // step, several at 1/60 s): put it back on the circle and turn it with the wall.
    for (let k = 0; k < this.candN; k++) {
      const code = this.cand[k]!;
      if (code < 8192) continue;
      const a = this.arcs[code - 8192]!;
      const qx = b.x - a.x;
      const qy = b.y - a.y;
      const r = Math.hypot(qx, qy);
      if (r < 1e-9 || !this.inArc(a, b.x, b.y)) continue;
      const mid = (a.Rin + a.Rout) / 2;
      let want = r;
      if (a.inner && r > a.Rin && (!a.outer || r < mid)) want = a.Rin - EPS;
      else if (a.outer && r < a.Rout && (!a.inner || r > mid)) want = a.Rout + EPS;
      if (want === r) continue;
      b.x = a.x + (qx / r) * want;
      b.y = a.y + (qy / r) * want;
      const nx = qx / r;
      const ny = qy / r;
      const vr = b.vx * nx + b.vy * ny;
      // Keep the speed, lose the part that would leave the circle (inner face: outward; outer face: inward).
      const leaving = want < r ? vr > 0 : vr < 0;
      if (leaving) {
        const sp = Math.hypot(b.vx, b.vy);
        const tx = b.vx - vr * nx;
        const ty = b.vy - vr * ny;
        const tl = Math.hypot(tx, ty) || 1;
        b.vx = (tx / tl) * sp;
        b.vy = (ty / tl) * sp;
      }
    }
    for (const f of this.flippers) {
      const d = f.def;
      const c = Math.cos(f.angle);
      const s = Math.sin(f.angle);
      const qx = (b.x - d.x) * c + (b.y - d.y) * s;
      const qy = -(b.x - d.x) * s + (b.y - d.y) * c;
      const dist = sdfFlipper(qx, qy, d) - BALL_R;
      if (dist >= 0 || dist < -SAFETY_TOL) continue;
      this.rideMax = Math.max(this.rideMax, -dist);
      sdfNormal(qx, qy, d);
      const nx = SN.x * c - SN.y * s;
      const ny = SN.x * s + SN.y * c;
      b.x -= nx * (dist - EPS);
      b.y -= ny * (dist - EPS);
      const w = h > 0 ? (f.angle - f.angle0) / h : 0;
      const cx = b.x - nx * BALL_R;
      const cy = b.y - ny * BALL_R;
      const vsx = -w * (cy - d.y);
      const vsy = w * (cx - d.x);
      const vn = (b.vx - vsx) * nx + (b.vy - vsy) * ny;
      if (vn < 0) {
        b.vx -= vn * nx;
        b.vy -= vn * ny;
      }
    }
  }

  // --- time of impact ------------------------------------------------------------------------------------------------

  private consider(t: number, nx: number, ny: number, kind: number, idx: number): void {
    if (t < this.hT) {
      this.hT = t;
      this.hNx = nx;
      this.hNy = ny;
      this.hKind = kind;
      this.hIdx = idx;
    }
  }

  private hitSeg(b: Ball, i: number, dx: number, dy: number): void {
    const s = this.segs[i]!;
    if (!s.enabled) return;
    const R = s.R;
    const rx = b.x - s.ax;
    const ry = b.y - s.ay;
    const s0 = rx * s.nx + ry * s.ny;
    const ds = dx * s.nx + dy * s.ny;
    const proj0 = rx * s.ux + ry * s.uy;
    const dp = dx * s.ux + dy * s.uy;
    // Faces.
    const side = s0 >= 0 ? 1 : -1;
    const nx = s.nx * side;
    const ny = s.ny * side;
    const dist = s0 * side;
    const dn = ds * side;
    if (!s.block || nx * s.bnx + ny * s.bny > 0) {
      if (dn < -1e-9) {
        let t: number;
        if (dist >= R) t = (R - dist) / dn;
        else t = dist > R - 2 ? 0 : -1; // inside the slab: only a shallow touch counts (deeper is the net's job)
        if (t >= 0 && t <= 1) {
          const p = proj0 + dp * t;
          if (p >= 0 && p <= s.len) {
            this.consider(t, nx, ny, 0, i);
            return;
          }
        }
      }
    }
    // Ends (rounded caps).
    if (!s.block) {
      this.capHit(b.x - s.ax, b.y - s.ay, dx, dy, R, 0, i);
      this.capHit(b.x - s.bx, b.y - s.by, dx, dy, R, 0, i);
    }
  }

  /** Ray from offset (mx, my) relative to a circle of radius R at the origin; enters from outside. */
  private capHit(mx: number, my: number, dx: number, dy: number, R: number, kind: number, idx: number): void {
    const b = mx * dx + my * dy;
    if (b >= -1e-9) return; // moving away (or sliding past)
    const cc = mx * mx + my * my - R * R;
    const a = dx * dx + dy * dy;
    if (a < 1e-14) return;
    let t: number;
    if (cc <= 0) {
      // Touching or inside: count a shallow touch now.
      if (cc < -4 * R) return;
      t = 0;
    } else {
      const disc = b * b - a * cc;
      if (disc < 0) return;
      t = (-b - Math.sqrt(disc)) / a;
      if (t < 0 || t > 1) return;
    }
    const px = mx + dx * t;
    const py = my + dy * t;
    const l = Math.hypot(px, py) || 1;
    this.consider(t, px / l, py / l, kind, idx);
  }

  private hitCirc(b: Ball, i: number, dx: number, dy: number): void {
    const c = this.circs[i]!;
    if (!c.enabled) return;
    this.capHit(b.x - c.x, b.y - c.y, dx, dy, c.R, 1, i);
  }

  private inArc(a: Arc, x: number, y: number): boolean {
    let d = Math.atan2(y - a.y, x - a.x) - a.start;
    d = ((d % TAU) + TAU) % TAU;
    return d <= a.sweep;
  }

  private hitArc(b: Ball, i: number, dx: number, dy: number): void {
    const a = this.arcs[i]!;
    const mx = b.x - a.x;
    const my = b.y - a.y;
    const bb = mx * dx + my * dy;
    const aa = dx * dx + dy * dy;
    if (aa < 1e-14) return;
    const m2 = mx * mx + my * my;
    // A ball between a face and the wall's centreline has cut a chord across the curve within one step (s²/2R:
    // 0.05 units at the game's step, a few at 1/60 s). That is still this face's contact: t = 0, and the sweep puts
    // the ball back on the circle. A straight ray can't reach the centreline from the far side of a face.
    const mid = (a.Rin + a.Rout) / 2;
    const r = Math.sqrt(m2);
    // Inner face: the ball runs inside radius Rin and hits it moving outward.
    if (a.inner && (!a.outer || r < mid)) {
      let t = -1;
      if (r >= a.Rin) {
        if (r < mid) t = 0;
      } else if (bb > 1e-9) {
        const disc = bb * bb - aa * (m2 - a.Rin * a.Rin);
        t = (-bb + Math.sqrt(Math.max(0, disc))) / aa;
      }
      if (t >= 0 && t <= 1) {
        const px = b.x + dx * t;
        const py = b.y + dy * t;
        if (this.inArc(a, px, py)) {
          const l = Math.hypot(px - a.x, py - a.y) || 1;
          this.consider(t, -(px - a.x) / l, -(py - a.y) / l, 2, i);
        }
      }
    }
    // Outer face: the ball comes from outside radius Rout moving inward.
    if (a.outer && (!a.inner || r > mid)) {
      let t = -1;
      if (r <= a.Rout) {
        if (r > mid) t = 0;
      } else if (bb < -1e-9) {
        const disc = bb * bb - aa * (m2 - a.Rout * a.Rout);
        if (disc >= 0) t = (-bb - Math.sqrt(disc)) / aa;
      }
      if (t >= 0 && t <= 1) {
        const px = b.x + dx * t;
        const py = b.y + dy * t;
        if (this.inArc(a, px, py)) {
          const l = Math.hypot(px - a.x, py - a.y) || 1;
          this.consider(t, (px - a.x) / l, (py - a.y) / l, 2, i);
        }
      }
    }
  }

  /**
   * The flipper in its own frame: the rubber is still and the ball moves from q0 (where it is, against the rubber's
   * angle at the start of what's left of the substep) to q1 (where it would end up, against the angle at the end).
   * Conservative advancement along that path against the tapered capsule's distance field finds the contact.
   */
  private hitFlipper(b: Ball, i: number, left: number, h: number): void {
    const f = this.flippers[i]!;
    const d = f.def;
    // Angles over what's left of this substep (the flipper turned linearly through it).
    const frac0 = 1 - left / h;
    const a0 = f.angle0 + (f.angle - f.angle0) * frac0;
    const a1 = f.angle;
    const w = h > 0 ? (f.angle - f.angle0) / h : 0;
    // Quick reject: far from the pivot.
    const ex = b.x + b.vx * left;
    const ey = b.y + b.vy * left;
    const reach = d.len + d.r0 + BALL_R + 2;
    if (Math.min(Math.hypot(b.x - d.x, b.y - d.y), Math.hypot(ex - d.x, ey - d.y)) > reach + Math.hypot(ex - b.x, ey - b.y)) return;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const q0x = (b.x - d.x) * c0 + (b.y - d.y) * s0;
    const q0y = -(b.x - d.x) * s0 + (b.y - d.y) * c0;
    const q1x = (ex - d.x) * c1 + (ey - d.y) * s1;
    const q1y = -(ex - d.x) * s1 + (ey - d.y) * c1;
    const dqx = q1x - q0x;
    const dqy = q1y - q0y;
    const dl = Math.hypot(dqx, dqy);
    let t = 0;
    let dist = sdfFlipper(q0x, q0y, d) - BALL_R;
    if (dist < 0.02) {
      // Touching at the start: a contact only if the ball is closing on the rubber.
      if (dist < -3) return; // deep inside: leave it to the net
      sdfNormal(q0x, q0y, d);
      const nx = SN.x * c0 - SN.y * s0;
      const ny = SN.x * s0 + SN.y * c0;
      const cx = b.x - nx * BALL_R;
      const cy = b.y - ny * BALL_R;
      const vsx = -w * (cy - d.y);
      const vsy = w * (cx - d.x);
      // (A hair of tolerance: after a resolve the normal speed is zero up to rounding, and rounding must not count.)
      if ((b.vx - vsx) * nx + (b.vy - vsy) * ny >= -1e-3) return;
      this.flipHit(0, nx, ny, i, b.x, b.y, vsx, vsy);
      return;
    }
    if (dl < 1e-9) return;
    for (let k = 0; k < 40; k++) {
      t += dist / dl;
      if (t > 1) return;
      dist = sdfFlipper(q0x + dqx * t, q0y + dqy * t, d) - BALL_R;
      if (dist < 0.01) break;
    }
    if (dist >= 0.01) return;
    const qx = q0x + dqx * t;
    const qy = q0y + dqy * t;
    sdfNormal(qx, qy, d);
    const at = a0 + (a1 - a0) * t;
    const c = Math.cos(at);
    const s = Math.sin(at);
    const nx = SN.x * c - SN.y * s;
    const ny = SN.x * s + SN.y * c;
    const px = d.x + qx * c - qy * s;
    const py = d.y + qx * s + qy * c;
    const cx = px - nx * BALL_R;
    const cy = py - ny * BALL_R;
    const vsx = -w * (cy - d.y);
    const vsy = w * (cx - d.x);
    if ((b.vx - vsx) * nx + (b.vy - vsy) * ny >= 0) return;
    this.flipHit(t, nx, ny, i, px, py, vsx, vsy);
  }

  private flipHit(t: number, nx: number, ny: number, i: number, px: number, py: number, vsx: number, vsy: number): void {
    if (t < this.hT) {
      this.hT = t;
      this.hNx = nx;
      this.hNy = ny;
      this.hKind = 3;
      this.hIdx = i;
      this.hPx = px;
      this.hPy = py;
      this.hVsx = vsx;
      this.hVsy = vsy;
    }
  }

  // --- response --------------------------------------------------------------------------------------------------

  private resolve(b: Ball): void {
    const nx = this.hNx;
    const ny = this.hNy;
    let e: number;
    let f: number;
    let vsx = 0;
    let vsy = 0;
    let tag: number;
    let curved = false;
    if (this.hKind === 0) {
      const s = this.segs[this.hIdx]!;
      e = s.e;
      f = s.f;
      tag = s.tag;
    } else if (this.hKind === 1) {
      const c = this.circs[this.hIdx]!;
      e = c.e;
      f = c.f;
      tag = c.tag;
    } else if (this.hKind === 2) {
      const a = this.arcs[this.hIdx]!;
      e = a.e;
      f = a.f;
      tag = a.tag;
      curved = true;
    } else {
      e = FLIP_E;
      f = FLIP_F;
      vsx = this.hVsx;
      vsy = this.hVsy;
      tag = this.hIdx === 0 ? Tag.FlipperL : Tag.FlipperR;
    }
    const rvx = b.vx - vsx;
    const rvy = b.vy - vsy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= -1e-6) return;
    const tx = rvx - vn * nx;
    const ty = rvy - vn * ny;
    const vt = Math.hypot(tx, ty);
    const approach = -vn;
    if (curved && approach < 0.3 * vt && approach < 260) {
      // Running along a curved wall: the wall turns the ball, it doesn't stop it.
      const sp = Math.hypot(rvx, rvy) * (1 - 0.0015);
      b.vx = vsx + (tx / (vt || 1)) * sp;
      b.vy = vsy + (ty / (vt || 1)) * sp;
    } else {
      const ee = approach < REST_SPEED ? 0 : e;
      // Friction only bites on real impacts: a resting or rolling ball rolls (it doesn't stick on a gentle slope).
      const jn = approach < REST_SPEED ? 0 : (1 + ee) * approach;
      const fr = vt > 1e-6 ? Math.min(1, (f * jn) / vt) : 0;
      b.vx = vsx + tx * (1 - fr) + ee * approach * nx;
      b.vy = vsy + ty * (1 - fr) + ee * approach * ny;
    }
    // Kickers.
    if (tag >= Tag.Bumper0 && tag <= Tag.Bumper2) {
      const out = b.vx * nx + b.vy * ny;
      if (out < BUMPER_KICK) {
        b.vx += (BUMPER_KICK - out) * nx;
        b.vy += (BUMPER_KICK - out) * ny;
      }
    } else if ((tag === Tag.SlingL || tag === Tag.SlingR) && approach > 70) {
      const out = b.vx * nx + b.vy * ny;
      if (out < SLING_KICK) {
        b.vx += (SLING_KICK - out) * nx;
        b.vy += (SLING_KICK - out) * ny;
      }
    } else if (tag >= Tag.Target0 && tag <= Tag.Target3 && approach > TARGET_DROP_SPEED) {
      const tg = this.def.targets[tag - Tag.Target0]!;
      if (nx * tg.nx + ny * tg.ny > 0.3) {
        this.setTarget(tag - Tag.Target0, false);
        this.emit(EvKind.TargetDown, b.id, tag - Tag.Target0, approach, b.x, b.y);
      }
    }
    this.clampSpeed(b);
    if (approach > 25 || tag === Tag.FlipperL || tag === Tag.FlipperR) this.emit(EvKind.Contact, b.id, tag, approach, b.x - nx * BALL_R, b.y - ny * BALL_R);
  }

  /** Pushes a ball out of anything it has sunk into (should never be needed). */
  private safety(b: Ball): void {
    this.gather(b.x - 1, b.y - 1, b.x + 1, b.y + 1);
    for (let k = 0; k < this.candN; k++) {
      const code = this.cand[k]!;
      if (code < 4096) {
        const s = this.segs[code]!;
        if (!s.enabled || s.block) continue;
        const rx = b.x - s.ax;
        const ry = b.y - s.ay;
        const p = Math.max(0, Math.min(s.len, rx * s.ux + ry * s.uy));
        const qx = b.x - (s.ax + s.ux * p);
        const qy = b.y - (s.ay + s.uy * p);
        const dist = Math.hypot(qx, qy);
        if (dist < s.R - SAFETY_TOL) this.pushOut(b, qx / (dist || 1), qy / (dist || 1), s.R - dist);
      } else if (code < 8192) {
        const c = this.circs[code - 4096]!;
        if (!c.enabled) continue;
        const qx = b.x - c.x;
        const qy = b.y - c.y;
        const dist = Math.hypot(qx, qy);
        if (dist < c.R - SAFETY_TOL) this.pushOut(b, qx / (dist || 1), qy / (dist || 1), c.R - dist);
      } else {
        const a = this.arcs[code - 8192]!;
        const qx = b.x - a.x;
        const qy = b.y - a.y;
        const dist = Math.hypot(qx, qy);
        if (!this.inArc(a, b.x, b.y)) continue;
        const mid = (a.Rin + a.Rout) / 2;
        if (a.inner && dist > a.Rin + SAFETY_TOL && (!a.outer || dist < mid)) this.pushOut(b, -qx / dist, -qy / dist, dist - a.Rin);
        else if (a.outer && dist < a.Rout - SAFETY_TOL && (!a.inner || dist > mid)) this.pushOut(b, qx / dist, qy / dist, a.Rout - dist);
      }
    }
    for (const f of this.flippers) {
      const d = f.def;
      const c = Math.cos(f.angle);
      const s = Math.sin(f.angle);
      const qx = (b.x - d.x) * c + (b.y - d.y) * s;
      const qy = -(b.x - d.x) * s + (b.y - d.y) * c;
      const dist = sdfFlipper(qx, qy, d) - BALL_R;
      if (dist < -SAFETY_TOL) {
        sdfNormal(qx, qy, d);
        this.pushOut(b, SN.x * c - SN.y * s, SN.x * s + SN.y * c, -dist);
      }
    }
  }

  private pushOut(b: Ball, nx: number, ny: number, depth: number): void {
    this.corrections++;
    b.x += nx * (depth + EPS);
    b.y += ny * (depth + EPS);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= vn * nx;
      b.vy -= vn * ny;
    }
  }

  private sensors(b: Ball, px: number, py: number): void {
    for (const s of this.def.sensors) {
      // Segment-segment crossing between the ball's path and the sensor line.
      const rx = b.x - px;
      const ry = b.y - py;
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const qx = s.ax - px;
      const qy = s.ay - py;
      const t = (qx * sy - qy * sx) / den;
      const u = (qx * ry - qy * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      // Direction: +1 when crossing toward the sensor's left normal (up for left-to-right lines).
      const dir = den > 0 ? 1 : -1;
      this.emit(EvKind.Sensor, b.id, s.id, dir, px + rx * t, py + ry * t);
      if (s.id === Sensor.Spinner) {
        const sp = Math.hypot(b.vx, b.vy);
        this.spinV = Math.min(70, sp * 0.03) * (b.vy < 0 ? 1 : -1);
        b.vx *= 0.97;
        b.vy *= 0.97;
      }
    }
  }

  /**
   * Balls against each other, by velocity only (speculative contacts): a pair that would close the gap between them
   * within this substep gets just enough impulse not to, plus a bounce if they were really colliding. Nothing is
   * moved, so one ball can never shove another through a wall or a flipper.
   */
  private ballPairs(h: number): void {
    const n = this.balls.length;
    const min = 2 * BALL_R;
    for (let i = 0; i < n; i++) {
      const a = this.balls[i]!;
      if (!a.live) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.balls[j]!;
        if (!b.live) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > min + MAX_SPEED * 2 * h || d < 1e-9) continue;
        const nx = dx / d;
        const ny = dy / d;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        const gap = d - min;
        // The closing speed this substep may use up: the gap (or, if they overlap, a gentle push apart).
        const allowed = gap >= 0 ? -gap / h : Math.min(-gap / h, 120);
        if (rel >= allowed) continue;
        const hit = gap < -rel * h * 1.0001 && rel < -REST_SPEED;
        const target = hit ? Math.max(allowed, -0.9 * rel) : allowed;
        const j2 = (target - rel) / 2;
        a.vx -= j2 * nx;
        a.vy -= j2 * ny;
        b.vx += j2 * nx;
        b.vy += j2 * ny;
        if (hit) this.emit(EvKind.BallBall, a.id, b.id, -rel, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    }
  }

  /** The flipper's tip in table units (for drawing and the pilot). */
  tip(i: number): { x: number; y: number } {
    const f = this.flippers[i]!;
    return { x: f.def.x + Math.cos(f.angle) * f.def.len, y: f.def.y + Math.sin(f.angle) * f.def.len };
  }
}

/** Signed distance from local point (x, y) to the tapered capsule: base radius r0 at the pivot, r1 at (len, 0). */
export function sdfFlipper(x: number, y: number, d: FlipperDef): number {
  const ay = Math.abs(y);
  const bb = (d.r0 - d.r1) / d.len;
  const aa = Math.sqrt(1 - bb * bb);
  const k = -bb * ay + aa * x;
  if (k < 0) return Math.hypot(x, y) - d.r0;
  if (k > aa * d.len) return Math.hypot(x - d.len, y) - d.r1;
  return aa * ay + bb * x - d.r0;
}

const SN = { x: 0, y: 0 };

/** Outward normal of the tapered capsule at local point (x, y), written to SN. */
function sdfNormal(x: number, y: number, d: FlipperDef): void {
  const ay = Math.abs(y);
  const bb = (d.r0 - d.r1) / d.len;
  const aa = Math.sqrt(1 - bb * bb);
  const k = -bb * ay + aa * x;
  if (k < 0) {
    const l = Math.hypot(x, y) || 1;
    SN.x = x / l;
    SN.y = y / l;
  } else if (k > aa * d.len) {
    const l = Math.hypot(x - d.len, y) || 1;
    SN.x = (x - d.len) / l;
    SN.y = y / l;
  } else {
    SN.x = bb;
    SN.y = y >= 0 ? aa : -aa;
  }
}
