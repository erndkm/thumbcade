/**
 * The desk's physics, on planck.js (a Box2D port, MIT): sequential impulses with warm starting, sleeping islands so a
 * fort at rest is exactly still, and continuous collision for the wad (a bullet), so it never passes through a
 * pencil at full pull. This wrapper builds a page into bodies, steps a fixed 1/120 s, and turns contacts into
 * impacts (the speed change each side got), which is what breaks pencils, bursts pads, crumples cups and knocks
 * doodles out. Pure: no DOM, no Math.random; the same page and the same shots give the same result to the bit.
 */
import { Box, Circle, Polygon, World as PWorld, type Body, type Contact } from "planck";
import { BASE, CASE, type Layout } from "./pages.ts";
import { CUP, isMite, specOf, TAPE, WAD, type Kind, type MiteKind, type PieceKind } from "./pieces.ts";

export const STEP = 1 / 120;
export const GRAVITY = 18;
const VEL_ITERS = 8;
const POS_ITERS = 3;

export interface Thing {
  id: number;
  kind: Kind;
  body: Body;
  /** Where it was put (for "knocked off" and "fell"). */
  x0: number;
  y0: number;
  /** Mass (kg), cached. */
  mass: number;
  /** Size relative to its kind (doodles get smaller on later pages). */
  s: number;
  /** Seconds a doodle has been tipped past upright, and when it was knocked out (or -1). */
  tipT: number;
  out: number;
  /** Position and angle at the start of the last step, for drawing between steps. */
  px: number;
  py: number;
  pa: number;
  /** 1 once it fell off its pile. */
  off: boolean;
  /** Seconds it has been nearly still (shots and debris). */
  still: number;
  /** Seconds since it was made. */
  age: number;
  /** Free slots for whoever draws it (squash, blink, wobble). */
  u0: number;
  u1: number;
  /** Removed from the world. */
  gone: boolean;
}

export interface Impact {
  a: Thing | null;
  b: Thing | null;
  /** Speed change each side gets from this hit (m/s). Static books and the desk count as null with 0. */
  dvA: number;
  dvB: number;
  /** Closing speed and where. */
  speed: number;
  x: number;
  y: number;
  /** Contact normal, pointing from a to b. */
  nx: number;
  ny: number;
}

/** What a contact touched: a thing, or the scenery. */
type Tag = { thing: Thing } | { static: "desk" | "book" | "case" | "star" };

export class Desk {
  readonly world: PWorld;
  things: Thing[] = [];
  /** Impacts found during the last step(s), drained by the caller. */
  impacts: Impact[] = [];
  /** The star sticker was touched by a shot this step. */
  starHit: Thing | null = null;
  private nextId = 1;
  private star: Body | null = null;
  time = 0;

  constructor(layout: Layout | null) {
    this.world = new PWorld({ gravity: { x: 0, y: -GRAVITY } });
    const ground = this.world.createBody({ userData: { static: "desk" } satisfies Tag });
    ground.createFixture(new Box(30, 1, { x: 4, y: -1 }), { friction: 0.7, restitution: 0.1 });
    const pc = this.world.createBody({ userData: { static: "case" } satisfies Tag });
    const h = (CASE.top - CASE.bottom) / 2;
    pc.createFixture(new Box((CASE.x1 - CASE.x0) / 2, h, { x: (CASE.x0 + CASE.x1) / 2, y: CASE.bottom + h }), { friction: 0.7 });
    for (const b of BASE) pc.createFixture(new Box((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }), { friction: 0.75 });
    this.world.on("begin-contact", (c) => this.onContact(c));
    if (layout) this.load(layout);
  }

  load(layout: Layout): void {
    for (const pile of layout.piles) {
      for (const b of pile.books) {
        const body = this.world.createBody({ userData: { static: "book" } satisfies Tag });
        body.createFixture(new Box((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }), { friction: 0.75, restitution: 0.05 });
      }
    }
    for (const p of layout.pieces) this.add(p.kind, p.x, p.y, p.angle, false, p.s ?? 1);
    if (layout.star) {
      this.star = this.world.createBody({ position: layout.star, userData: { static: "star" } satisfies Tag });
      this.star.createFixture(new Circle(0.42), { isSensor: true });
    }
  }

  add(kind: Kind, x: number, y: number, angle = 0, bullet = false, scale = 1): Thing {
    const base = specOf(kind);
    const s = scale === 1 ? base : { ...base, hw: base.hw * scale, hh: base.hh * scale };
    const body = this.world.createBody({ type: "dynamic", position: { x, y }, angle, bullet, angularDamping: 0.05, linearDamping: 0.01 });
    const fix = { density: s.density, friction: s.friction, restitution: s.restitution };
    switch (kind) {
      case "wad":
        body.createFixture(new Circle(WAD.r), fix);
        body.setAngularDamping(1.2);
        break;
      case "tape":
        body.createFixture(new Circle(TAPE.r), fix);
        body.setAngularDamping(1.2);
        break;
      case "tick":
        body.createFixture(
          new Polygon([
            { x: -s.hw, y: -s.hh },
            { x: s.hw, y: -s.hh },
            { x: 0, y: s.hh },
          ]),
          fix,
        );
        break;
      case "cup": {
        // Upturned and hollow: the base (now the roof) and two slanted walls down to the rim.
        const t = CUP.top;
        const b = CUP.bottom;
        const h = s.hh;
        const w = CUP.wall;
        body.createFixture(new Box(t, CUP.plate / 2, { x: 0, y: h - CUP.plate / 2 }, 0), fix);
        for (const side of [-1, 1]) {
          body.createFixture(
            new Polygon([
              { x: side * b, y: -h },
              { x: side * (b - w), y: -h },
              { x: side * (t - w * 0.6), y: h - CUP.plate },
              { x: side * t, y: h - CUP.plate },
            ]),
            fix,
          );
        }
        break;
      }
      default:
        body.createFixture(new Box(s.hw, s.hh), fix);
    }
    const t: Thing = {
      id: this.nextId++,
      kind,
      body,
      x0: x,
      y0: y,
      mass: body.getMass(),
      s: scale,
      tipT: 0,
      out: -1,
      px: x,
      py: y,
      pa: angle,
      off: false,
      still: 0,
      age: 0,
      u0: 0,
      u1: 0,
      gone: false,
    };
    body.setUserData({ thing: t } satisfies Tag);
    this.things.push(t);
    return t;
  }

  /** Fires a shot (the wad or a tape ball) from (x, y) at velocity (vx, vy). */
  launch(kind: "wad" | "tape", x: number, y: number, vx: number, vy: number): Thing {
    const t = this.add(kind, x, y, 0, true);
    // No air drag on a shot: it flies the exact stepped path the preview, the pilot and the assist draw.
    t.body.setLinearDamping(0);
    t.body.setLinearVelocity({ x: vx, y: vy });
    t.body.setAngularVelocity(-vx * 1.4);
    return t;
  }

  remove(t: Thing): void {
    if (t.gone) return;
    t.gone = true;
    this.world.destroyBody(t.body);
  }

  removeStar(): void {
    if (this.star) this.world.destroyBody(this.star);
    this.star = null;
  }

  get hasStar(): boolean {
    return !!this.star;
  }

  /** Snaps a pencil in two at its middle: the halves keep its motion. Returns them. */
  snap(t: Thing): [Thing, Thing] {
    const b = t.body;
    const a = b.getAngle();
    const p = b.getPosition();
    const c = Math.cos(a);
    const s = Math.sin(a);
    const v = b.getLinearVelocity();
    const w = b.getAngularVelocity();
    const half = specOf("pencil").hw / 2;
    this.remove(t);
    const mk = (kind: "pencilTip" | "pencilEnd", side: number) => {
      const x = p.x + c * half * side;
      const y = p.y + s * half * side;
      const h = this.add(kind, x, y, a);
      // Velocity of that point of the old body, plus a little kick apart.
      h.body.setLinearVelocity({ x: v.x - w * (y - p.y) + c * side * 0.6, y: v.y + w * (x - p.x) + s * side * 0.6 });
      h.body.setAngularVelocity(w + side * 1.8);
      h.x0 = t.x0;
      h.y0 = t.y0;
      h.off = t.off;
      return h;
    };
    // The tip is at the +x end of a pencil (its local frame), the eraser end at -x.
    return [mk("pencilTip", 1), mk("pencilEnd", -1)];
  }

  step(): void {
    for (const t of this.things) {
      if (t.gone) continue;
      const p = t.body.getPosition();
      t.px = p.x;
      t.py = p.y;
      t.pa = t.body.getAngle();
    }
    this.starHit = null;
    this.world.step(STEP, VEL_ITERS, POS_ITERS);
    this.time += STEP;
    for (const t of this.things) {
      if (t.gone) continue;
      t.age += STEP;
      const v = t.body.getLinearVelocity();
      t.still = Math.hypot(v.x, v.y) < 0.12 && Math.abs(t.body.getAngularVelocity()) < 0.3 ? t.still + STEP : 0;
    }
    if (this.things.length > 80 && this.things.some((t) => t.gone)) this.things = this.things.filter((t) => !t.gone);
  }

  /** Everything that moves has stopped (sleeping, or slower than a crawl). */
  calm(): boolean {
    for (const t of this.things) {
      if (t.gone || !t.body.isAwake()) continue;
      const v = t.body.getLinearVelocity();
      if (Math.hypot(v.x, v.y) > 0.08 || Math.abs(t.body.getAngularVelocity()) > 0.2) return false;
    }
    return true;
  }

  mites(): Thing[] {
    return this.things.filter((t) => !t.gone && isMite(t.kind));
  }

  /** Doodles still standing (not knocked out). */
  live(): Thing[] {
    return this.things.filter((t) => !t.gone && isMite(t.kind) && t.out < 0);
  }

  private onContact(c: Contact): void {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const ta = fa.getBody().getUserData() as Tag | null;
    const tb = fb.getBody().getUserData() as Tag | null;
    const A = ta && "thing" in ta ? ta.thing : null;
    const B = tb && "thing" in tb ? tb.thing : null;
    if ((ta && "static" in ta && ta.static === "star") || (tb && "static" in tb && tb.static === "star")) {
      const shot = A ?? B;
      if (shot && (shot.kind === "wad" || shot.kind === "tape")) this.starHit = shot;
      return;
    }
    if (fa.isSensor() || fb.isSensor()) return;
    const wm = c.getWorldManifold(null);
    if (!wm || wm.pointCount === 0) return;
    const pt = wm.points[0]!;
    const n = wm.normal;
    const bA = fa.getBody();
    const bB = fb.getBody();
    const vA = bA.getLinearVelocityFromWorldPoint(pt);
    const vB = bB.getLinearVelocityFromWorldPoint(pt);
    const closing = -((vB.x - vA.x) * n.x + (vB.y - vA.y) * n.y);
    if (closing <= 0.05) return;
    const mA = A ? A.mass : Infinity;
    const mB = B ? B.mass : Infinity;
    // Each side's speed change from a perfectly inelastic hit, plus a share for the bounce.
    const e = 1 + Math.min(fa.getRestitution(), fb.getRestitution());
    const dvA = A ? (closing * e * (mB === Infinity ? 1 : mB / (mA + mB))) : 0;
    const dvB = B ? (closing * e * (mA === Infinity ? 1 : mA / (mA + mB))) : 0;
    this.impacts.push({ a: A, b: B, dvA, dvB, speed: closing, x: pt.x, y: pt.y, nx: n.x, ny: n.y });
  }
}

/** Every mite kind the world knows (for tests). */
export const MITE_KINDS: MiteKind[] = ["tick", "stub", "lanky"];
export type { PieceKind };
