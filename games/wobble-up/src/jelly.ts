/**
 * The jelly: a rigid gameplay centre (x, y, vx, vy) with a soft ring of spring points around it for the look.
 * Each ring point is pulled toward its rest spot around the centre (shape matching), damped relative to the
 * centre's velocity, pushed outward by an area-preserving pressure, and clamped on the floor while the jelly
 * is squished on a platform. Any sudden change of the centre's motion (landing, launch, a hard steer) leaves the
 * points behind for a moment, so every bounce squashes, stretches and wobbles.
 */
import { PAL, shine } from "./comic.ts";

export const R = 33;
const N = 16;
const TAU = Math.PI * 2;

const K_SHAPE = 820;
const DAMP = 7.5;
const K_PRESS = 5000;
const H = 1 / 180;

export type Mood = "happy" | "fall" | "squish" | "stun" | "dead" | "spring";

export class Jelly {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  readonly px = new Float32Array(N);
  readonly py = new Float32Array(N);
  readonly vxs = new Float32Array(N);
  readonly vys = new Float32Array(N);
  private readonly rx = new Float32Array(N);
  private readonly ry = new Float32Array(N);
  private readonly area0: number;
  private acc = 0;
  /** Smoothed horizontal look direction (-1..1) for the eyes. */
  look = 0;
  /** Visual spin (dead tumble). */
  spin = 0;
  mood: Mood = "happy";
  /** Target squash/stretch of the rest shape (the ring springs chase it, overshoot and wobble). */
  sx = 1;
  sy = 1;
  blink = 0;
  private blinkIn = 2;

  constructor() {
    for (let i = 0; i < N; i++) {
      // A gumdrop: a tall round dome on a wide, flat-ish bottom.
      const a = (i / N) * TAU - Math.PI / 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      this.rx[i] = c * R * (sn > 0 ? 1.1 : 1);
      this.ry[i] = sn > 0 ? sn * R * 0.74 : sn * R * 1.06;
    }
    this.area0 = this.restArea();
  }

  private restArea(): number {
    let a = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      a += this.rx[i]! * this.ry[j]! - this.rx[j]! * this.ry[i]!;
    }
    return a / 2;
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.spin = 0;
    this.mood = "happy";
    for (let i = 0; i < N; i++) {
      this.px[i] = x + this.rx[i]!;
      this.py[i] = y + this.ry[i]!;
      this.vxs[i] = this.vys[i] = 0;
    }
  }

  /** Moves the whole ring with the centre (screen wrap) without any wobble. */
  teleport(dx: number, dy: number): void {
    for (let i = 0; i < N; i++) {
      this.px[i]! += dx;
      this.py[i]! += dy;
    }
  }

  /** A velocity change of the centre: top points take more of it than bottom points, so a launch stretches. */
  impulse(dvx: number, dvy: number, lead = 0.35, base = 0.55): void {
    for (let i = 0; i < N; i++) {
      const up = (1 - this.ry[i]! / R) / 2; // 1 at the top, 0 at the bottom
      const k = base + lead * (dvy < 0 ? up : 1 - up);
      this.vxs[i]! += dvx * k;
      this.vys[i]! += dvy * k;
    }
  }

  /** Pokes the ring outward/inward (a hit, a splat). */
  poke(strength: number): void {
    for (let i = 0; i < N; i++) {
      this.vxs[i]! += (this.rx[i]! / R) * strength * (0.6 + 0.8 * ((i * 7) % 5) / 5);
      this.vys[i]! += (this.ry[i]! / R) * strength * (0.6 + 0.8 * ((i * 3) % 5) / 5);
    }
  }

  /** Steps the ring toward the centre. `floor` = world y the points can't sink below (while squished), or null. */
  step(dt: number, floor: number | null, reduced: boolean): void {
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blink = 0.12;
      this.blinkIn = 1.8 + Math.random() * 2.6;
    }
    this.blink = Math.max(0, this.blink - dt);
    this.look += (Math.max(-1, Math.min(1, this.vx / 260)) - this.look) * Math.min(1, dt * 10);

    const k = reduced ? K_SHAPE * 1.6 : K_SHAPE;
    const c = reduced ? DAMP * 2 : DAMP;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= H && steps < 8) {
      this.acc -= H;
      steps++;
      // Area of the current ring.
      let area = 0;
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        area += this.px[i]! * this.py[j]! - this.px[j]! * this.py[i]!;
      }
      area /= 2;
      const press = K_PRESS * (this.area0 / Math.max(area, this.area0 * 0.2) - 1);
      const cs = Math.cos(this.spin);
      const sn = Math.sin(this.spin);
      for (let i = 0; i < N; i++) {
        const prev = (i + N - 1) % N;
        const next = (i + 1) % N;
        const lx = this.rx[i]! * this.sx;
        const ly = this.ry[i]! * this.sy;
        const tx = this.x + lx * cs - ly * sn;
        const ty = this.y + lx * sn + ly * cs;
        // Outward normal from the neighbours (the ring runs clockwise on screen).
        let nx = this.py[next]! - this.py[prev]!;
        let ny = -(this.px[next]! - this.px[prev]!);
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        const ax = k * (tx - this.px[i]!) - c * (this.vxs[i]! - this.vx) + press * nx;
        const ay = k * (ty - this.py[i]!) - c * (this.vys[i]! - this.vy) + press * ny;
        this.vxs[i]! += ax * H;
        this.vys[i]! += ay * H;
      }
      for (let i = 0; i < N; i++) {
        this.px[i]! += this.vxs[i]! * H;
        this.py[i]! += this.vys[i]! * H;
        if (floor !== null && this.py[i]! > floor) {
          this.py[i] = floor;
          if (this.vys[i]! > 0) this.vys[i] = 0;
        }
        // Never let a point wander off (a hitch, a teleport).
        const dx = this.px[i]! - this.x;
        const dy = this.py[i]! - this.y;
        const d = Math.hypot(dx, dy);
        if (d > R * 1.5) {
          this.px[i] = this.x + (dx / d) * R * 1.5;
          this.py[i] = this.y + (dy / d) * R * 1.5;
        }
      }
    }
  }

  /** Bounding box of the ring (for the face). */
  private bbox(): [number, number, number, number] {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < N; i++) {
      x0 = Math.min(x0, this.px[i]!);
      x1 = Math.max(x1, this.px[i]!);
      y0 = Math.min(y0, this.py[i]!);
      y1 = Math.max(y1, this.py[i]!);
    }
    return [x0, y0, x1, y1];
  }

  private path(g: CanvasRenderingContext2D, ox: number, oy: number): void {
    const mx = (i: number) => (this.px[i]! + this.px[(i + 1) % N]!) / 2 + ox;
    const my = (i: number) => (this.py[i]! + this.py[(i + 1) % N]!) / 2 + oy;
    g.beginPath();
    g.moveTo(mx(N - 1), my(N - 1));
    for (let i = 0; i < N; i++) g.quadraticCurveTo(this.px[i]! + ox, this.py[i]! + oy, mx(i), my(i));
    g.closePath();
  }

  /** Draws the jelly with a world-space x offset (for the screen-wrap ghost). */
  draw(g: CanvasRenderingContext2D, ox: number, body: string = PAL.bubblegum, shade: string = PAL.bubblegumShade): void {
    // Hard sticker shadow.
    this.path(g, ox + 4, 5);
    g.fillStyle = PAL.ink;
    g.fill();
    // Cel shadow: the shade fills the body, the base colour is the same shape nudged up-left.
    this.path(g, ox, 0);
    g.save();
    g.clip();
    g.fillStyle = shade;
    g.fill();
    this.path(g, ox - R * 0.2, -R * 0.24);
    g.fillStyle = body;
    g.fill();
    g.restore();
    this.path(g, ox, 0);
    g.lineWidth = 5;
    g.lineJoin = "round";
    g.strokeStyle = PAL.ink;
    g.stroke();

    const [x0, y0, x1, y1] = this.bbox();
    const w = (x1 - x0) / (2 * R);
    const h = (y1 - y0) / (2 * R);
    const cx = (x0 + x1) / 2 + ox;
    const cy = (y0 + y1) / 2;
    // Shine marks (top-left), squashed with the body.
    g.save();
    g.translate(cx, cy);
    g.scale(w, h);
    shine(g, -R * 0.48, -R * 0.5, R * 0.2, -0.75);
    g.restore();
    this.face(g, cx, cy + R * 0.06 * h, w, h);
  }

  private face(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
    const m = this.mood;
    const q = R / 26;
    const ex = R * 0.36 * w;
    const ey = -R * 0.16 * h;
    const lookX = this.look * 3;
    const lookY = m === "fall" ? 2.2 : m === "spring" ? -2.4 : 0;
    g.lineWidth = 3;
    g.strokeStyle = PAL.ink;
    g.lineCap = "round";
    for (const s of [-1, 1]) {
      const x = cx + s * ex;
      const y = cy + ey;
      if (m === "dead" || m === "stun") {
        // X eyes (dead) or swirls (stunned).
        g.beginPath();
        if (m === "dead") {
          const r = 5;
          g.moveTo(x - r, y - r);
          g.lineTo(x + r, y + r);
          g.moveTo(x + r, y - r);
          g.lineTo(x - r, y + r);
        } else {
          for (let a = 0; a < TAU * 1.6; a += 0.4) {
            const r = 1 + a * 1.1;
            const px = x + Math.cos(a + this.y * 0.05 * s) * r;
            const py = y + Math.sin(a + this.y * 0.05 * s) * r;
            if (a === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
        }
        g.stroke();
        continue;
      }
      const rx = 7.6 * q * w;
      const ry = (this.blink > 0 || m === "squish" ? 1.8 : 9.6) * q * h;
      g.fillStyle = PAL.white;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, TAU);
      g.fill();
      g.stroke();
      if (ry > 3) {
        g.fillStyle = PAL.ink;
        g.beginPath();
        g.ellipse(x + lookX, y + lookY + 1.5, 4.2 * q * w, 5.4 * q * h, 0, 0, TAU);
        g.fill();
        g.fillStyle = PAL.white;
        g.beginPath();
        g.arc(x + lookX - 1.5, y + lookY - 1, 1.6, 0, TAU);
        g.fill();
      }
    }
    // Blush.
    g.fillStyle = PAL.bubblegumShade;
    g.globalAlpha = 0.85;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * R * 0.58 * w, cy + R * 0.16 * h, 4.6 * q * w, 2.6 * q * h, 0, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    // Mouth.
    const my = cy + R * 0.2 * h;
    g.lineWidth = 3;
    g.beginPath();
    if (m === "fall" || m === "dead") {
      g.fillStyle = PAL.ink;
      g.ellipse(cx, my + 2, 4.2 * q * w, 5.6 * q * h, 0, 0, TAU);
      g.fill();
    } else if (m === "stun") {
      for (let i = 0; i <= 6; i++) {
        const x = cx - 8 * w + (i / 6) * 16 * w;
        const y = my + (i % 2 ? -2 : 2);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    } else {
      const wide = m === "squish" ? 9.5 : m === "spring" ? 8 : 6.5;
      g.fillStyle = PAL.tomatoShade;
      g.moveTo(cx - wide * q * w, my - 1);
      g.quadraticCurveTo(cx, my + (m === "spring" ? 13 : 9) * q * h, cx + wide * q * w, my - 1);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
}
