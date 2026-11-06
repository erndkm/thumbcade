/**
 * The rink, the moonstone and the two mallets: a small deterministic solver.
 *
 * Units are art pixels of the rink (the screen draws one unit per art pixel), y grows down. The critter defends the
 * top goal (y = 0), the cat the bottom one (y = L). Everything steps at a fixed 240 Hz; the puck's motion inside a step
 * is swept against the boards, the corner arcs, the goal posts and both mallets (moving circles), so it can't tunnel
 * through anything at any speed or step size. Nothing here touches the DOM or Math.random.
 */

export const W = 120;
export const L = 200;
/** Radius of the rounded corners of the boards. */
export const CORNER = 20;
/** Width of each goal mouth. */
export const GOAL = 60;
export const GX0 = (W - GOAL) / 2;
export const GX1 = (W + GOAL) / 2;
export const PUCK_R = 5;
export const MALLET_R = 8;
/** Fixed step. */
export const DT = 1 / 240;
/** The moonstone never goes faster than this (px/s). */
export const MAX_PUCK = 360;
/** Below this a puck is called still. */
export const STILL = 10;

const WALL_E = 0.84;
const WALL_SLIP = 0.97;
const MALLET_E = 0.62;
/** Ice: the puck keeps 82 % of its speed per second, a little less when crawling so it comes to rest. */
const FRICTION = 0.2;
const CRAWL_FRICTION = 0.9;

export type Side = 0 | 1;
/** 0 = the cat (bottom, the player), 1 = the critter (top). */
export const CAT: Side = 0;
export const CRITTER: Side = 1;

export interface Vec {
  x: number;
  y: number;
}

export interface Mallet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where the hand wants it. */
  tx: number;
  ty: number;
  /** px/s. */
  maxSpeed: number;
  /** px/s²; Infinity = goes straight to the target (a thumb). */
  accel: number;
}

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Spin angle, for drawing. */
  spin: number;
}

export type Hit =
  | { kind: "rail"; side: "left" | "right" | "top" | "bottom" | "corner"; speed: number; x: number; y: number }
  | { kind: "post"; speed: number; x: number; y: number }
  | { kind: "mallet"; who: Side; speed: number; impact: number; x: number; y: number }
  | { kind: "goal"; into: Side; speed: number; x: number };

interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Inward normal. */
  nx: number;
  ny: number;
  side: "left" | "right" | "top" | "bottom";
}

/** The real boundary: straight boards (the goal mouths are gaps) and four quarter arcs. */
export const SEGMENTS: readonly Segment[] = [
  { ax: 0, ay: CORNER, bx: 0, by: L - CORNER, nx: 1, ny: 0, side: "left" },
  { ax: W, ay: CORNER, bx: W, by: L - CORNER, nx: -1, ny: 0, side: "right" },
  { ax: CORNER, ay: 0, bx: GX0, by: 0, nx: 0, ny: 1, side: "top" },
  { ax: GX1, ay: 0, bx: W - CORNER, by: 0, nx: 0, ny: 1, side: "top" },
  { ax: CORNER, ay: L, bx: GX0, by: L, nx: 0, ny: -1, side: "bottom" },
  { ax: GX1, ay: L, bx: W - CORNER, by: L, nx: 0, ny: -1, side: "bottom" },
];

/** Corner arc centres and the quadrant each one rules (sign of x and y relative to the centre). */
export const CORNERS: ReadonlyArray<{ cx: number; cy: number; sx: -1 | 1; sy: -1 | 1 }> = [
  { cx: CORNER, cy: CORNER, sx: -1, sy: -1 },
  { cx: W - CORNER, cy: CORNER, sx: 1, sy: -1 },
  { cx: CORNER, cy: L - CORNER, sx: -1, sy: 1 },
  { cx: W - CORNER, cy: L - CORNER, sx: 1, sy: 1 },
];

/** The goal posts: the ends of the boards beside each mouth. */
export const POSTS: readonly Vec[] = [
  { x: GX0, y: 0 },
  { x: GX1, y: 0 },
  { x: GX0, y: L },
  { x: GX1, y: L },
];

/** The box a mallet's centre may use: its own half, inside the boards. */
export function malletBounds(who: Side): { x0: number; x1: number; y0: number; y1: number } {
  return who === CAT
    ? { x0: MALLET_R, x1: W - MALLET_R, y0: L / 2 + 2, y1: L - MALLET_R }
    : { x0: MALLET_R, x1: W - MALLET_R, y0: MALLET_R, y1: L / 2 - 2 };
}

/** Keeps a mallet centre inside its half and off the corner arcs. */
export function clampMallet(who: Side, x: number, y: number): Vec {
  const b = malletBounds(who);
  x = Math.min(b.x1, Math.max(b.x0, x));
  y = Math.min(b.y1, Math.max(b.y0, y));
  for (const c of CORNERS) {
    const dx = x - c.cx;
    const dy = y - c.cy;
    if (dx * c.sx <= 0 || dy * c.sy <= 0) continue;
    const d = Math.hypot(dx, dy);
    const rho = CORNER - MALLET_R;
    if (d > rho) {
      x = c.cx + (dx / d) * rho;
      y = c.cy + (dy / d) * rho;
    }
  }
  return { x, y };
}

export function newMallet(who: Side, maxSpeed: number, accel = Infinity): Mallet {
  const y = who === CAT ? L - 30 : 30;
  return { x: W / 2, y, vx: 0, vy: 0, tx: W / 2, ty: y, maxSpeed, accel };
}

const EPS = 1e-7;

/** Earliest root t in [0, max] of |p + v t - c|² = r² while approaching from outside; 0 if already inside and closing. */
function circleIn(px: number, py: number, vx: number, vy: number, cx: number, cy: number, r: number, max: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const a = vx * vx + vy * vy;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy - r * r;
  if (c <= 0) return b < 0 ? 0 : -1;
  if (a < EPS || b >= 0) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= max ? t : -1;
}

interface Contact {
  t: number;
  nx: number;
  ny: number;
  kind: "seg" | "arc" | "post" | "mallet" | "goal";
  side?: Segment["side"] | "corner";
  who?: Side;
  into?: Side;
}

/**
 * The table. `step()` advances one fixed step and returns what happened in it. The mallets follow their targets
 * (capped speed, and for the critter capped acceleration), then the puck is swept through the step.
 */
export class Table {
  puck: Puck = { x: W / 2, y: L / 2, vx: 0, vy: 0, spin: 0 };
  mallets: [Mallet, Mallet];
  /** Puck is in play (false while a goal is being celebrated or the puck is being dropped). */
  live = true;
  /** Seconds the puck has been near still. */
  stillFor = 0;
  /** Positions at the start of the last step, for drawing between steps. */
  readonly prev = { px: W / 2, py: L / 2, mx: [W / 2, W / 2], my: [L - 30, 30] };

  constructor(catSpeed = 330, critterSpeed = 260, critterAccel = 1800) {
    this.mallets = [newMallet(CAT, catSpeed), newMallet(CRITTER, critterSpeed, critterAccel)];
  }

  /** Moves a mallet toward its target for one step; returns its velocity over the step. */
  private moveMallet(who: Side, dt: number): void {
    const m = this.mallets[who];
    const want = clampMallet(who, m.tx, m.ty);
    const dx = want.x - m.x;
    const dy = want.y - m.y;
    const dist = Math.hypot(dx, dy);
    let nx: number;
    let ny: number;
    if (m.accel === Infinity) {
      const maxStep = m.maxSpeed * dt;
      const k = dist > maxStep ? maxStep / dist : 1;
      nx = m.x + dx * k;
      ny = m.y + dy * k;
    } else {
      // Arrive: never faster than it can still brake for.
      const sp = Math.min(m.maxSpeed, Math.sqrt(2 * m.accel * dist) * 0.92);
      const dvx = (dist > EPS ? (dx / dist) * sp : 0) - m.vx;
      const dvy = (dist > EPS ? (dy / dist) * sp : 0) - m.vy;
      const dv = Math.hypot(dvx, dvy);
      const cap = m.accel * dt;
      const k = dv > cap ? cap / dv : 1;
      const vx = m.vx + dvx * k;
      const vy = m.vy + dvy * k;
      nx = m.x + vx * dt;
      ny = m.y + vy * dt;
      // Don't sail past the target.
      if ((want.x - nx) * dx + (want.y - ny) * dy < 0 && dist < Math.hypot(vx, vy) * dt * 1.5) {
        nx = want.x;
        ny = want.y;
      }
    }
    const c = clampMallet(who, nx, ny);
    m.vx = (c.x - m.x) / dt;
    m.vy = (c.y - m.y) / dt;
    m.x = c.x;
    m.y = c.y;
  }

  step(dt = DT): Hit[] {
    const hits: Hit[] = [];
    this.snapshot();
    const m0 = this.mallets.map((m) => ({ x: m.x, y: m.y }));
    this.moveMallet(CAT, dt);
    this.moveMallet(CRITTER, dt);
    if (!this.live) return hits;
    const p = this.puck;
    // Mallet paths over this step (linear): m(τ) = start + v τ.
    const mv = this.mallets.map((m, i) => ({ x0: m0[i]!.x, y0: m0[i]!.y, vx: m.vx, vy: m.vy }));
    let tau = 0;
    for (let iter = 0; iter < 8 && tau < dt - EPS; iter++) {
      const rem = dt - tau;
      const c = this.earliest(p, mv, tau, rem);
      if (!c) {
        p.x += p.vx * rem;
        p.y += p.vy * rem;
        break;
      }
      p.x += p.vx * c.t;
      p.y += p.vy * c.t;
      tau += c.t;
      if (c.kind === "goal") {
        hits.push({ kind: "goal", into: c.into!, speed: Math.hypot(p.vx, p.vy), x: p.x });
        this.live = false;
        p.vx = 0;
        p.vy = 0;
        return hits;
      }
      const speed = Math.hypot(p.vx, p.vy);
      if (c.kind === "mallet") {
        const who = c.who!;
        const m = mv[who]!;
        const mx = m.x0 + m.vx * tau;
        const my = m.y0 + m.vy * tau;
        let nx = p.x - mx;
        let ny = p.y - my;
        const d = Math.hypot(nx, ny) || 1;
        nx /= d;
        ny /= d;
        // Already overlapping (the mallet was put on the puck): push the puck out to touching first.
        const R = PUCK_R + MALLET_R;
        if (d < R) {
          p.x = mx + nx * (R + 1e-4);
          p.y = my + ny * (R + 1e-4);
        }
        const rvx = p.vx - m.vx;
        const rvy = p.vy - m.vy;
        const vn = rvx * nx + rvy * ny;
        let impact = 0;
        if (vn < 0) {
          impact = -vn;
          p.vx -= (1 + MALLET_E) * vn * nx;
          p.vy -= (1 + MALLET_E) * vn * ny;
          // A mallet pushing into the puck always sends it on at least at the mallet's own speed along the normal.
          const mn = m.vx * nx + m.vy * ny;
          const pn = p.vx * nx + p.vy * ny;
          if (mn > 0 && pn < mn) {
            p.vx += (mn - pn) * nx;
            p.vy += (mn - pn) * ny;
          }
          p.spin += (rvx * -ny + rvy * nx) * 0.002;
        }
        this.cap();
        hits.push({ kind: "mallet", who, speed: Math.hypot(p.vx, p.vy), impact, x: p.x, y: p.y });
      } else {
        const vn = p.vx * c.nx + p.vy * c.ny;
        if (vn < 0) {
          p.vx -= (1 + WALL_E) * vn * c.nx;
          p.vy -= (1 + WALL_E) * vn * c.ny;
          // Lose a little of the sliding speed along the board.
          const tx = -c.ny;
          const ty = c.nx;
          const vt = p.vx * tx + p.vy * ty;
          p.vx -= vt * (1 - WALL_SLIP) * tx;
          p.vy -= vt * (1 - WALL_SLIP) * ty;
          p.spin += vt * 0.004;
        }
        if (c.kind === "post") hits.push({ kind: "post", speed, x: p.x, y: p.y });
        else hits.push({ kind: "rail", side: c.side ?? "corner", speed, x: p.x, y: p.y });
      }
      // Tiny nudge off the contact so the next sweep doesn't find it again at t = 0.
      p.x += c.nx * 1e-5;
      p.y += c.ny * 1e-5;
    }
    this.keepInside();
    this.unpin();
    // Ice friction.
    const sp = Math.hypot(p.vx, p.vy);
    const k = Math.exp(-(sp < 20 ? CRAWL_FRICTION : FRICTION) * dt);
    p.vx *= k;
    p.vy *= k;
    if (sp < 1.5) {
      p.vx = 0;
      p.vy = 0;
    }
    p.spin += sp * dt * 0.05 * Math.sign(p.spin || 1);
    this.stillFor = sp < STILL ? this.stillFor + dt : 0;
    return hits;
  }

  private cap(): void {
    const p = this.puck;
    const s = Math.hypot(p.vx, p.vy);
    if (s > MAX_PUCK) {
      p.vx *= MAX_PUCK / s;
      p.vy *= MAX_PUCK / s;
    }
  }

  /** The first thing the puck touches within `rem` seconds from sub-step time `tau`. */
  private earliest(p: Puck, mv: Array<{ x0: number; y0: number; vx: number; vy: number }>, tau: number, rem: number): Contact | null {
    let best: Contact | null = null;
    const take = (c: Contact) => {
      if (c.t >= 0 && c.t <= rem && (!best || c.t < best.t)) best = c;
    };
    const { x, y, vx, vy } = p;
    // Boards.
    for (const s of SEGMENTS) {
      const d0 = (x - s.ax) * s.nx + (y - s.ay) * s.ny;
      const vn = vx * s.nx + vy * s.ny;
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
      const ux = (s.bx - s.ax) / len;
      const uy = (s.by - s.ay) / len;
      let t = -1;
      if (d0 < PUCK_R && d0 > -PUCK_R) {
        if (vn < 0) t = 0;
      } else if (d0 >= PUCK_R && vn < -EPS) {
        t = (PUCK_R - d0) / vn;
      }
      if (t < 0 || t > rem) continue;
      const qx = x + vx * t;
      const qy = y + vy * t;
      const along = (qx - s.ax) * ux + (qy - s.ay) * uy;
      if (along < 0 || along > len) continue;
      take({ t, nx: s.nx, ny: s.ny, kind: "seg", side: s.side });
    }
    // Corner arcs (containment): the centre must stay within CORNER - PUCK_R of the arc centre in its quadrant.
    const rho = CORNER - PUCK_R;
    for (const c of CORNERS) {
      const dx = x - c.cx;
      const dy = y - c.cy;
      const inQuad = (qx: number, qy: number) => (qx - c.cx) * c.sx > 0 && (qy - c.cy) * c.sy > 0;
      const a = vx * vx + vy * vy;
      const b = 2 * (dx * vx + dy * vy);
      const cc = dx * dx + dy * dy - rho * rho;
      let t = -1;
      if (cc >= 0 && inQuad(x, y)) {
        if (b > 0) t = 0;
      } else if (a > EPS) {
        const disc = b * b - 4 * a * cc;
        if (disc >= 0) {
          const t2 = (-b + Math.sqrt(disc)) / (2 * a);
          if (t2 > 0 && t2 <= rem && inQuad(x + vx * t2, y + vy * t2)) t = t2;
        }
      }
      if (t < 0) continue;
      const qx = x + vx * t;
      const qy = y + vy * t;
      const d = Math.hypot(c.cx - qx, c.cy - qy) || 1;
      take({ t, nx: (c.cx - qx) / d, ny: (c.cy - qy) / d, kind: "arc", side: "corner" });
    }
    // Goal posts.
    for (const e of POSTS) {
      const t = circleIn(x, y, vx, vy, e.x, e.y, PUCK_R, rem);
      if (t < 0) continue;
      const qx = x + vx * t;
      const qy = y + vy * t;
      const d = Math.hypot(qx - e.x, qy - e.y) || 1;
      take({ t, nx: (qx - e.x) / d, ny: (qy - e.y) / d, kind: "post" });
    }
    // Goal lines: the centre crossing a mouth.
    if (vy < -EPS && y >= 0) {
      const t = -y / vy;
      const gx = x + vx * t;
      if (t <= rem && gx > GX0 && gx < GX1) take({ t, nx: 0, ny: 1, kind: "goal", into: CRITTER });
    } else if (vy > EPS && y <= L) {
      const t = (L - y) / vy;
      const gx = x + vx * t;
      if (t <= rem && gx > GX0 && gx < GX1) take({ t, nx: 0, ny: -1, kind: "goal", into: CAT });
    }
    // Mallets: moving circles.
    const R = PUCK_R + MALLET_R;
    for (let i = 0; i < 2; i++) {
      const m = mv[i]!;
      const mx = m.x0 + m.vx * tau;
      const my = m.y0 + m.vy * tau;
      const t = circleIn(x, y, vx - m.vx, vy - m.vy, mx, my, R, rem);
      if (t < 0) {
        // Overlapping but not closing (a mallet set down on a resting puck): resolve now anyway.
        if (Math.hypot(x - mx, y - my) < R - 1e-3) take({ t: 0, nx: 0, ny: 0, kind: "mallet", who: i as Side });
        continue;
      }
      take({ t, nx: 0, ny: 0, kind: "mallet", who: i as Side });
    }
    return best;
  }

  /** How often the safety net below had to move the puck by more than a hair (the sweep should leave it nothing). */
  corrections = 0;

  /** Safety net: a puck centre is never outside the rink (except in a goal mouth on its way in). */
  private keepInside(): void {
    const p = this.puck;
    const x0 = p.x;
    const y0 = p.y;
    const inMouth = p.x > GX0 && p.x < GX1;
    if (p.x < PUCK_R) {
      p.x = PUCK_R;
      if (p.vx < 0) p.vx = -p.vx * WALL_E;
    } else if (p.x > W - PUCK_R) {
      p.x = W - PUCK_R;
      if (p.vx > 0) p.vx = -p.vx * WALL_E;
    }
    if (!inMouth) {
      if (p.y < PUCK_R) {
        p.y = PUCK_R;
        if (p.vy < 0) p.vy = -p.vy * WALL_E;
      } else if (p.y > L - PUCK_R) {
        p.y = L - PUCK_R;
        if (p.vy > 0) p.vy = -p.vy * WALL_E;
      }
    }
    const rho = CORNER - PUCK_R;
    for (const c of CORNERS) {
      const dx = p.x - c.cx;
      const dy = p.y - c.cy;
      if (dx * c.sx <= 0 || dy * c.sy <= 0) continue;
      const d = Math.hypot(dx, dy);
      if (d > rho) {
        p.x = c.cx + (dx / d) * rho;
        p.y = c.cy + (dy / d) * rho;
        const nx = -dx / d;
        const ny = -dy / d;
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) {
          p.vx -= (1 + WALL_E) * vn * nx;
          p.vy -= (1 + WALL_E) * vn * ny;
        }
      }
    }
    if (Math.hypot(p.x - x0, p.y - y0) > 1e-3) this.corrections++;
  }

  /** A puck squeezed between a mallet and the boards: the mallet gives way, never the boards. */
  private unpin(): void {
    const p = this.puck;
    const R = PUCK_R + MALLET_R;
    for (let i = 0; i < 2; i++) {
      const m = this.mallets[i]!;
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d >= R - 1e-3) continue;
      const nx = d > EPS ? dx / d : 0;
      const ny = d > EPS ? dy / d : i === CAT ? 1 : -1;
      const c = clampMallet(i as Side, p.x + nx * (R + 0.01), p.y + ny * (R + 0.01));
      m.x = c.x;
      m.y = c.y;
    }
  }

  /** Puts the puck down at rest. */
  drop(x: number, y: number): void {
    this.puck.x = x;
    this.puck.y = y;
    this.puck.vx = 0;
    this.puck.vy = 0;
    this.live = true;
    this.stillFor = 0;
    this.snapshot();
  }

  snapshot(): void {
    const v = this.prev;
    v.px = this.puck.x;
    v.py = this.puck.y;
    for (let i = 0; i < 2; i++) {
      v.mx[i] = this.mallets[i]!.x;
      v.my[i] = this.mallets[i]!.y;
    }
  }
}

/** Straight-line path of a puck with side-board reflections (no friction): where it crosses `lineY`, or null. */
export function crossAt(x: number, y: number, vx: number, vy: number, lineY: number, horizon = 3): { x: number; t: number } | null {
  if (Math.abs(vy) < EPS) return null;
  const t = (lineY - y) / vy;
  if (t < 0 || t > horizon) return null;
  return { x: reflectX(x + vx * t), t };
}

/** Folds an x coordinate back inside the side boards (mirror images), for predicting banks. */
export function reflectX(x: number): number {
  const lo = PUCK_R;
  const hi = W - PUCK_R;
  const span = hi - lo;
  let u = (x - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}
