/**
 * How the dishes move. A dish with two or more pegs is pinned: it never moves, not by a hair. Down to one peg it is a
 * rigid pendulum on that peg (gravity's torque about the pivot over the moment of inertia about it, a little air
 * damping) and, once it has nearly stopped, it eases into its resting pose and sleeps there exactly, so it neither
 * jitters nor creeps. With no peg left it falls free, keeping the spin and the speed the swing gave it, until it hits
 * the counter below the wall. Falling dishes don't collide with anything. Fixed steps, no randomness: deterministic.
 */
import type { Dish, Wall } from "./board.ts";
import { WALL_H } from "./board.ts";
import { hangPose, type Pose, toWorld, wrap } from "./geom.ts";

/** Gravity in wall units per second squared (a wall unit is a dinner plate's radius, about 20 cm). */
export const GRAVITY = 46;
/** Physics step and substeps. */
export const STEP = 1 / 120;
const SUB = 2;
/** Angular damping per second while swinging. */
export const SWING_DAMP = 2.4;
/** The counter top the dishes land on, in wall units below the wall's top. */
export const FLOOR = WALL_H + 0.34;
/** Once this slow and this close to rest, a swing eases in and sleeps. */
const SETTLE_PHI = 0.05;
const SETTLE_W = 0.35;
const SETTLE_RATE = 14;
/** A falling dish that somehow never lands is dropped after this long. */
const FALL_MAX = 3;

export type BodyState = "pinned" | "hanging" | "falling" | "gone";

export interface Body {
  state: BodyState;
  /** Current pose and the one a step ago (for drawing between steps). */
  pose: Pose;
  prev: Pose;
  /** Hanging: the pivot on the wall, the pivot in local units, the angle, spin, rest angle and whether it sleeps. */
  px: number;
  py: number;
  qx: number;
  qy: number;
  w: number;
  rest: number;
  settling: boolean;
  settled: boolean;
  /** Which peg (index in the dish's list) it hangs from. */
  hangIdx: number;
  /** Falling: centre of mass on the wall and its velocity. */
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  fallT: number;
  /** Seconds since it started swinging or falling (for faces and sounds). */
  age: number;
}

export type PhysEvent = { type: "land"; dish: number; x: number; y: number; speed: number; spin: number };

const rot = (th: number, x: number, y: number): [number, number] => {
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [c * x - s * y, s * x + c * y];
};

export class Physics {
  readonly bodies: Body[];
  /** Outlines sampled for the landing test. */
  private readonly feet: Array<Array<[number, number]>>;

  constructor(readonly wall: Wall) {
    this.bodies = wall.dishes.map((d) => ({
      state: "pinned",
      pose: { ...d.base },
      prev: { ...d.base },
      px: 0,
      py: 0,
      qx: 0,
      qy: 0,
      w: 0,
      rest: 0,
      settling: false,
      settled: true,
      hangIdx: -1,
      cx: 0,
      cy: 0,
      vx: 0,
      vy: 0,
      fallT: 0,
      age: 0,
    }));
    this.feet = wall.dishes.map((d) => d.out.filter((_, i) => i % 2 === 0));
  }

  /** True while any dish swings or falls. */
  get busy(): boolean {
    return this.bodies.some((b) => (b.state === "hanging" && !b.settled) || b.state === "falling");
  }

  /** The dish lost a peg and now hangs from its peg number `k` (index into `dish.pegs`). */
  hang(dish: Dish, k: number): void {
    const b = this.bodies[dish.id]!;
    const peg = this.wall.pegs[dish.pegs[k]!]!;
    b.state = "hanging";
    b.px = peg.x;
    b.py = peg.y;
    b.qx = peg.lx;
    b.qy = peg.ly;
    b.hangIdx = k;
    b.settled = false;
    b.settling = false;
    b.age = 0;
    const dx = dish.mass.cx - peg.lx;
    const dy = dish.mass.cy - peg.ly;
    b.rest = Math.PI / 2 - Math.atan2(dy, dx);
    const phi = wrap(b.pose.th - b.rest);
    // A dish that already hangs nearly plumb still gives a little wobble when its other peg goes.
    b.w = Math.abs(phi) < 0.25 ? (peg.lx >= dish.mass.cx ? -1.1 : 1.1) : 0;
  }

  /** The dish lost its last peg: it drops, keeping its swing. */
  drop(dish: Dish): void {
    const b = this.bodies[dish.id]!;
    const m = dish.mass;
    const [rx, ry] = rot(b.pose.th, m.cx, m.cy);
    b.cx = b.pose.x + rx;
    b.cy = b.pose.y + ry;
    if (b.state === "hanging") {
      // Velocity of the centre of mass while turning about the pivot.
      const ox = b.cx - b.px;
      const oy = b.cy - b.py;
      b.vx = -b.w * oy;
      b.vy = b.w * ox;
    } else {
      b.vx = 0;
      b.vy = 0;
    }
    // A cartoon hop off the peg.
    b.vy -= 1.3;
    b.w += b.w >= 0 ? 0.9 : -0.9;
    b.state = "falling";
    b.fallT = 0;
    b.age = 0;
  }

  step(): PhysEvent[] {
    const out: PhysEvent[] = [];
    const h = STEP / SUB;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      b.prev.x = b.pose.x;
      b.prev.y = b.pose.y;
      b.prev.th = b.pose.th;
      if (b.state === "pinned" || b.state === "gone") continue;
      b.age += STEP;
      const d = this.wall.dishes[i]!;
      if (b.state === "hanging") {
        if (b.settled) continue;
        for (let s = 0; s < SUB && !b.settled; s++) this.swing(b, d, h);
      } else {
        for (let s = 0; s < SUB; s++) {
          b.vy += GRAVITY * h;
          b.cx += b.vx * h;
          b.cy += b.vy * h;
          b.pose.th += b.w * h;
          b.w *= Math.exp(-0.25 * h);
        }
        const [rx, ry] = rot(b.pose.th, d.mass.cx, d.mass.cy);
        b.pose.x = b.cx - rx;
        b.pose.y = b.cy - ry;
        b.fallT += STEP;
        let low = -Infinity;
        let lx = b.cx;
        for (const [x, y] of this.feet[i]!) {
          const [wx, wy] = toWorld(b.pose, x, y);
          if (wy > low) {
            low = wy;
            lx = wx;
          }
        }
        if ((low >= FLOOR && b.vy > 0) || b.fallT > FALL_MAX) {
          b.state = "gone";
          out.push({ type: "land", dish: i, x: lx, y: FLOOR, speed: b.vy, spin: b.w });
        }
      }
    }
    return out;
  }

  private swing(b: Body, d: Dish, h: number): void {
    const m = d.mass;
    const dx = m.cx - b.qx;
    const dy = m.cy - b.qy;
    const phi = wrap(b.pose.th - b.rest);
    if (!b.settling && Math.abs(phi) < SETTLE_PHI && Math.abs(b.w) < SETTLE_W) b.settling = true;
    if (b.settling) {
      const next = phi * Math.exp(-SETTLE_RATE * h);
      b.w = (next - phi) / h;
      b.pose.th = b.rest + next;
      if (Math.abs(next) < 1e-4) {
        // Asleep in exactly the pose the dealer and the solver use.
        const p = hangPose(m, [b.qx, b.qy], [b.px, b.py]);
        b.pose.x = p.x;
        b.pose.y = p.y;
        b.pose.th = p.th;
        b.w = 0;
        b.settled = true;
        return;
      }
    } else {
      // Balanced on top: tip it over.
      if (Math.abs(phi) > Math.PI - 0.05 && Math.abs(b.w) < 0.05) b.w += b.qx >= m.cx ? -0.8 : 0.8;
      const [rx] = rot(b.pose.th, dx, dy);
      const ip = m.inertia + m.area * (dx * dx + dy * dy);
      b.w += ((GRAVITY * m.area * rx) / ip) * h;
      b.w *= Math.exp(-SWING_DAMP * h);
      b.pose.th += b.w * h;
    }
    const [qx, qy] = rot(b.pose.th, b.qx, b.qy);
    b.pose.x = b.px - qx;
    b.pose.y = b.py - qy;
  }
}

/** A pose between the last step and this one. */
export function lerpPose(b: Body, k: number, out: Pose): Pose {
  out.x = b.prev.x + (b.pose.x - b.prev.x) * k;
  out.y = b.prev.y + (b.pose.y - b.prev.y) * k;
  let dth = b.pose.th - b.prev.th;
  if (dth > Math.PI) dth -= Math.PI * 2;
  else if (dth < -Math.PI) dth += Math.PI * 2;
  out.th = b.prev.th + dth * k;
  return out;
}
