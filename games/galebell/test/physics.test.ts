import { createRng } from "@thumbcade-games/kit/rng";
import { describe, expect, it } from "vitest";
import { BALL_R, BUMPER_KICK, EvKind, MAX_SPEED, sdfFlipper, SLING_KICK, SUBSTEP, World } from "../src/physics.ts";
import { cradleSpot } from "../src/pilot.ts";
import { buildTable, DRAIN_Y, Sensor, Tag } from "../src/table.ts";

const def = buildTable();

/** Clearance of a ball centre at (x, y) from every static wall (negative = inside one). */
function clearance(w: World, x: number, y: number): number {
  let best = Infinity;
  for (const s of w.segs) {
    if (!s.enabled) continue;
    const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.ux + (y - s.ay) * s.uy));
    best = Math.min(best, Math.hypot(x - s.ax - s.ux * t, y - s.ay - s.uy * t) - s.R);
  }
  for (const c of w.circs) best = Math.min(best, Math.hypot(x - c.x, y - c.y) - c.R);
  for (const a of w.arcs) {
    let d = Math.atan2(y - a.y, x - a.x) - a.start;
    d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (d > a.sweep) continue;
    const r = Math.hypot(x - a.x, y - a.y);
    const mid = (a.Rin + a.Rout) / 2;
    if (a.inner && (!a.outer || r < mid)) best = Math.min(best, a.Rin - r);
    if (a.outer && (!a.inner || r > mid)) best = Math.min(best, r - a.Rout);
  }
  return best;
}

/** Does the centre's path cross a wall's centreline (which a ball can only do by tunnelling)? */
function crossesWall(w: World, x0: number, y0: number, x1: number, y1: number): string | null {
  const cross = (ax: number, ay: number, bx: number, by: number) => {
    const rx = x1 - x0;
    const ry = y1 - y0;
    const sx = bx - ax;
    const sy = by - ay;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return false;
    const t = ((ax - x0) * sy - (ay - y0) * sx) / den;
    const u = ((ax - x0) * ry - (ay - y0) * rx) / den;
    return t > 0 && t <= 1 && u >= 0 && u <= 1;
  };
  for (const s of w.segs) {
    if (!s.enabled) continue;
    if (s.block) {
      // The gate only stops a ball coming from its blocking side.
      if ((x0 - s.ax) * s.bnx + (y0 - s.ay) * s.bny <= 0) continue;
    }
    if (cross(s.ax, s.ay, s.bx, s.by)) return `wall ${s.tag} at ${s.ax.toFixed(0)},${s.ay.toFixed(0)}`;
  }
  for (const a of w.arcs) {
    const R = (a.Rin + a.Rout) / 2;
    const r0 = Math.hypot(x0 - a.x, y0 - a.y);
    const r1 = Math.hypot(x1 - a.x, y1 - a.y);
    if ((r0 - R) * (r1 - R) < 0) {
      const ang = Math.atan2((y0 + y1) / 2 - a.y, (x0 + x1) / 2 - a.x) - a.start;
      const d = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (d <= a.sweep) return `arc at ${a.x},${a.y} R ${R}`;
    }
  }
  return null;
}

function flipperDepth(w: World, x: number, y: number): number {
  let worst = Infinity;
  for (const f of w.flippers) {
    const d = f.def;
    const c = Math.cos(f.angle);
    const s = Math.sin(f.angle);
    const qx = (x - d.x) * c + (y - d.y) * s;
    const qy = -(x - d.x) * s + (y - d.y) * c;
    worst = Math.min(worst, sdfFlipper(qx, qy, d) - BALL_R);
  }
  return worst;
}

/** Open places a ball can be: flood-filled from the middle of the playfield on a 4-unit grid, clear of the flippers. */
function openSpots(): Array<[number, number]> {
  const w = new World(def);
  const step = 4;
  const cols = 92;
  const rows = 166;
  const open = new Uint8Array(cols * rows);
  const seen = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = i * step;
      const y = j * step;
      const nearFlipper = def.flippers.some((f) => Math.hypot(x - f.x, y - f.y) < f.len + 24);
      if (y < DRAIN_Y - 100 && !nearFlipper && clearance(w, x, y) > 1) open[j * cols + i] = 1;
    }
  const q = [Math.round(380 / step) * cols + Math.round(169 / step)];
  const out: Array<[number, number]> = [];
  while (q.length) {
    const k = q.pop()!;
    if (seen[k] || !open[k]) continue;
    seen[k] = 1;
    const i = k % cols;
    const j = Math.floor(k / cols);
    out.push([i * step, j * step]);
    if (i > 0) q.push(k - 1);
    if (i < cols - 1) q.push(k + 1);
    if (j > 0) q.push(k - cols);
    if (j < rows - 1) q.push(k + cols);
  }
  return out;
}

const SPOTS = openSpots();

describe("the table", () => {
  it("has room to play: the open playfield is one connected region, shooter lane excluded", () => {
    expect(SPOTS.length).toBeGreaterThan(3000);
    // The shooter lane is walled off from the playfield (the gate only lets balls out).
    expect(SPOTS.some(([x, y]) => x > 328 && y > 220)).toBe(false);
  });

  it("keeps a full-speed ball on the table: it never crosses a wall or enters a flipper (1,500 shots, two step sizes)", () => {
    const rng = createRng(42);
    let drained = 0;
    let steps = 0;
    for (let n = 0; n < 1500; n++) {
      const w = new World(def);
      const [sx, sy] = SPOTS[rng.int(0, SPOTS.length - 1)]!;
      const a = rng() * Math.PI * 2;
      const b = w.addBall(sx, sy, Math.cos(a) * MAX_SPEED, Math.sin(a) * MAX_SPEED);
      // The game's 1/480 s substep with the flippers swinging; and 1/60 s (a step of 53 units at full speed, over
      // three ball widths) with the flippers parked up or down, where only the sweep can catch a wall.
      const big = n % 3 === 0;
      const h = big ? 1 / 60 : SUBSTEP;
      const swing = !big;
      if (!swing) {
        for (const f of w.flippers) {
          f.pressed = rng() < 0.5;
          f.angle = f.pressed ? f.def.up : f.def.rest;
        }
      }
      for (let s = 0; s < 1.6 / h; s++) {
        if (swing && s % Math.max(1, Math.round(0.07 / h)) === 0) {
          w.flippers[0].pressed = rng() < 0.5;
          w.flippers[1].pressed = rng() < 0.5;
        }
        const x0 = b.x;
        const y0 = b.y;
        w.substep(h);
        steps++;
        const why = crossesWall(w, x0, y0, b.x, b.y);
        expect(why, `shot ${n} step ${s}: ${why}`).toBeNull();
        expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
        if (!b.live) {
          drained++;
          break;
        }
        // Above the flippers the cabinet walls hold it; below them it's on its way down the drain.
        if (b.y < 566) {
          expect(b.x, `shot ${n}`).toBeGreaterThan(12);
          expect(b.x, `shot ${n}`).toBeLessThan(348);
        }
        expect(clearance(w, b.x, b.y), `shot ${n} step ${s} at ${b.x.toFixed(1)},${b.y.toFixed(1)}`).toBeGreaterThan(-0.3);
        expect(flipperDepth(w, b.x, b.y), `shot ${n} step ${s}`).toBeGreaterThan(-0.3);
      }
      // The sweep alone kept it out of every wall: the safety net never had to act.
      expect(w.corrections, `shot ${n}`).toBe(0);
    }
    expect(drained).toBeGreaterThan(200);
    expect(steps).toBeGreaterThan(100000);
  }, 60_000);

  it("never lets a full-speed ball through a swinging flipper", () => {
    const rng = createRng(7);
    let tried = 0;
    for (let n = 0; n < 900; n++) {
      const w = new World(def);
      const side = n % 2;
      const f = w.flippers[side]!;
      const d = f.def;
      // Any angle in its stroke, rising, falling or still.
      f.angle = d.rest + (d.up - d.rest) * rng();
      f.pressed = rng() < 0.5;
      const lx = rng.range(8, d.len);
      const above = rng() < 0.5 ? 1 : -1;
      // Start 40 units off the rubber on one side, aimed straight at it at full speed.
      const nx = -Math.sin(f.angle) * above * f.dir;
      const ny = Math.cos(f.angle) * above * f.dir;
      const px = d.x + Math.cos(f.angle) * lx - nx * 40;
      const py = d.y + Math.sin(f.angle) * lx - ny * 40;
      // Only shots with a clear run at the rubber (no wall in the way).
      let clear = true;
      for (let k = 0; k <= 10; k++) if (clearance(w, px + nx * 3 * k, py + ny * 3 * k) < 0.5) clear = false;
      if (!clear) continue;
      tried++;
      const b = w.addBall(px, py, nx * MAX_SPEED, ny * MAX_SPEED);
      const side0 = Math.sign((b.x - d.x) * -Math.sin(f.angle) + (b.y - d.y) * Math.cos(f.angle));
      let touched = false;
      for (let s = 0; s < 40; s++) {
        w.evCount = 0;
        w.substep(SUBSTEP);
        for (let i = 0; i < w.evCount; i++) if (w.events[i]!.kind === EvKind.Contact && (w.events[i]!.a === Tag.FlipperL || w.events[i]!.a === Tag.FlipperR)) touched = true;
        expect(flipperDepth(w, b.x, b.y), `shot ${n}`).toBeGreaterThan(-0.3);
        if (touched) break;
      }
      expect(touched, `shot ${n}`).toBe(true);
      // Still on the side it came from, against the rubber's current line.
      const lxNow = (b.x - d.x) * Math.cos(f.angle) + (b.y - d.y) * Math.sin(f.angle);
      if (lxNow > 0 && lxNow < d.len) {
        const sideNow = Math.sign((b.x - d.x) * -Math.sin(f.angle) + (b.y - d.y) * Math.cos(f.angle));
        expect(sideNow, `shot ${n}`).toBe(side0);
      }
      expect(w.corrections).toBe(0);
    }
    expect(tried).toBeGreaterThan(400);
  });

  it("a ball riding a swinging rubber only ever drifts into it by a hair (second order), and is put back on it", () => {
    let worst = 0;
    for (const lx of [12, 20, 30, 40, 50]) {
      const w = new World(def);
      const f = w.flippers[0];
      const d = f.def;
      const r = d.r0 - ((d.r0 - d.r1) * lx) / d.len;
      const off = r + BALL_R + 0.01;
      const b = w.addBall(d.x + lx * Math.cos(d.rest) + off * Math.sin(d.rest), d.y + lx * Math.sin(d.rest) - off * Math.cos(d.rest));
      f.pressed = true;
      let rose = 0;
      for (let s = 0; s < 40; s++) {
        w.substep(SUBSTEP);
        rose = Math.min(rose, b.vy);
      }
      worst = Math.max(worst, w.rideMax);
      expect(w.corrections).toBe(0);
      expect(rose).toBeLessThan(-400);
    }
    expect(worst).toBeLessThan(0.15);
  });
});

describe("flippers", () => {
  /** A ball falling onto the lowered left rubber at `lx`, met by a flip: its speed just after. */
  const flipAt = (lx: number) => {
    const w = new World(def);
    const f = w.flippers[0];
    const d = f.def;
    const x = d.x + lx * Math.cos(d.rest);
    const y = d.y + lx * Math.sin(d.rest) - 40;
    const b = w.addBall(x, y, 0, 700);
    // Flip when it is about to land.
    for (let s = 0; s < 480 && b.y < y + 9; s++) w.substep(SUBSTEP);
    f.pressed = true;
    let best = 0;
    for (let s = 0; s < 60; s++) {
      w.substep(SUBSTEP);
      if (b.vy < 0) best = Math.max(best, Math.hypot(b.vx, b.vy));
    }
    return best;
  };

  it("a ball met nearer the tip leaves faster (the rubber's lever)", () => {
    const base = flipAt(16);
    const mid = flipAt(30);
    const tip = flipAt(46);
    expect(mid).toBeGreaterThan(base * 1.2);
    expect(tip).toBeGreaterThan(mid * 1.1);
    expect(tip).toBeGreaterThan(1600);
  });

  it("a flip from rest sends the ball up the table, past the flags", () => {
    const w = new World(def);
    const f = w.flippers[0];
    const d = f.def;
    const lx = 34;
    const r = d.r0 - ((d.r0 - d.r1) * lx) / d.len;
    const off = r + BALL_R + 0.01;
    const b = w.addBall(d.x + lx * Math.cos(d.rest) + off * Math.sin(d.rest), d.y + lx * Math.sin(d.rest) - off * Math.cos(d.rest));
    f.pressed = true;
    let top = b.y;
    let fastest = 0;
    for (let s = 0; s < 480 && b.live; s++) {
      w.substep(SUBSTEP);
      top = Math.min(top, b.y);
      fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
    }
    expect(fastest).toBeGreaterThan(1300);
    expect(top).toBeLessThan(330);
  });

  it("cradles: a ball rolled down the inlane onto a raised flipper comes to rest and stays", () => {
    for (const side of [0, 1] as const) {
      const w = new World(def);
      const f = w.flippers[side];
      f.pressed = true;
      const b = w.addBall(side ? 2 * 169 - 30 : 30, 400);
      for (let s = 0; s < 480 * 2.5; s++) w.substep(SUBSTEP);
      const x = b.x;
      const y = b.y;
      for (let s = 0; s < 480 * 3; s++) w.substep(SUBSTEP);
      expect(Math.hypot(b.x - x, b.y - y), `side ${side}`).toBeLessThan(0.5);
      expect(Math.hypot(b.vx, b.vy)).toBeLessThan(2);
      expect(b.live).toBe(true);
      // Let go: it rolls down the rubber toward the tip.
      f.pressed = false;
      for (let s = 0; s < 480 * 0.25; s++) w.substep(SUBSTEP);
      const lx = (b.x - f.def.x) * Math.cos(f.angle) + (b.y - f.def.y) * Math.sin(f.angle);
      expect(lx, `side ${side}`).toBeGreaterThan(18);
    }
  });

  it("a short tap from a cradle passes the ball across to the other flipper", () => {
    let passes = 0;
    for (let tap = 0.01; tap <= 0.04; tap += 0.005) {
      for (let wait = 0.1; wait <= 0.24; wait += 0.01) {
        const w = new World(def);
        const spot = cradleSpot(def, 0);
        const fl = w.flippers[0];
        fl.pressed = true;
        fl.angle = fl.def.up;
        w.flippers[1].pressed = false;
        const b = w.addBall(spot.x, spot.y);
        w.step(0.05);
        fl.pressed = false;
        w.step(wait);
        fl.pressed = true;
        w.step(tap);
        fl.pressed = false;
        // The other side catches it on a raised flipper.
        w.flippers[1].pressed = true;
        w.step(2);
        if (b.live && b.x > 169 && Math.hypot(b.vx, b.vy) < 5) passes++;
      }
    }
    expect(passes).toBeGreaterThanOrEqual(2);
  });
});

describe("the rest of the table", () => {
  it("has no dead spots: a ball dropped anywhere (flippers down) drains, or sinks in the harbour, within 20 s", () => {
    const rng = createRng(3);
    for (let n = 0; n < 400; n++) {
      const w = new World(def);
      const [sx, sy] = SPOTS[rng.int(0, SPOTS.length - 1)]!;
      const b = w.addBall(sx, sy, rng.range(-500, 500), rng.range(-500, 300));
      let t = 0;
      let still = 0;
      while (b.live && t < 20) {
        w.substep(SUBSTEP);
        t += SUBSTEP;
        still = Math.hypot(b.vx, b.vy) < 5 ? still + SUBSTEP : 0;
        expect(still, `drop ${n} stuck at ${b.x.toFixed(1)},${b.y.toFixed(1)}`).toBeLessThan(1.5);
      }
      expect(b.live, `drop ${n} from ${sx},${sy}`).toBe(false);
      expect(w.corrections).toBe(0);
    }
  }, 30_000);

  it("the plunger always sends the ball out of the shooter lane, and the gate never lets one back in", () => {
    const rng = createRng(11);
    for (let n = 0; n < 60; n++) {
      const w = new World(def);
      const b = w.addBall(def.plunger.x, def.plunger.y, 0, -(2250 + rng.range(-35, 35)));
      let out = false;
      let inLane = false;
      for (let s = 0; s < 480 * 4 && b.live; s++) {
        w.evCount = 0;
        w.substep(SUBSTEP);
        for (let i = 0; i < w.evCount; i++) {
          const e = w.events[i]!;
          if (e.kind === EvKind.Sensor && e.a === Sensor.ShooterExit) {
            if (e.s > 0) out = true;
            else inLane = true;
          }
        }
      }
      expect(out).toBe(true);
      expect(inLane).toBe(false);
    }
    // Balls coming round the arch the other way bounce off the gate into the right orbit lane.
    for (let n = 0; n < 60; n++) {
      const w = new World(def);
      const sp = rng.range(500, 2500);
      const b = w.addBall(170, 24, sp, 0);
      for (let s = 0; s < 480 * 3 && b.live; s++) {
        w.substep(SUBSTEP);
        expect(b.x > 328 && b.y > 220, `round the arch at ${sp.toFixed(0)}`).toBe(false);
      }
    }
  });

  it("buoys and breakwaters kick: the ball always leaves faster than their kick", () => {
    for (const [tag, kick] of [
      [Tag.Bumper0, BUMPER_KICK],
      [Tag.SlingL, SLING_KICK],
    ] as const) {
      for (let n = 0; n < 20; n++) {
        const w = new World(def);
        let b;
        if (tag === Tag.Bumper0) {
          const bp = def.bumpers[0]!;
          const a = (n / 20) * Math.PI * 2;
          b = w.addBall(bp.x + Math.cos(a) * (bp.R + 30), bp.y + Math.sin(a) * (bp.R + 30), -Math.cos(a) * 300, -Math.sin(a) * 300);
        } else {
          const [tx, ty, kx, ky] = def.slings[0]!.face;
          const u = 0.3 + (n / 20) * 0.4;
          const fx = tx + (kx - tx) * u;
          const fy = ty + (ky - ty) * u;
          b = w.addBall(fx + 30, fy - 10, -400, 80);
        }
        let kicked = false;
        for (let s = 0; s < 240; s++) {
          w.evCount = 0;
          w.substep(SUBSTEP);
          for (let i = 0; i < w.evCount; i++) if (w.events[i]!.kind === EvKind.Contact && w.events[i]!.a === tag) kicked = true;
          if (kicked) break;
        }
        expect(kicked).toBe(true);
        expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(kick - 30);
      }
    }
  });

  it("is deterministic: the same shot and the same thumbs give the same ball, to the bit", () => {
    const run = () => {
      const w = new World(def);
      const b = w.addBall(200, 300, -700, 900);
      for (let s = 0; s < 480 * 6; s++) {
        w.flippers[0].pressed = s % 300 < 90;
        w.flippers[1].pressed = s % 420 < 120;
        w.substep(SUBSTEP);
      }
      return [b.x, b.y, b.vx, b.vy, b.live];
    };
    expect(run()).toEqual(run());
  });
});
