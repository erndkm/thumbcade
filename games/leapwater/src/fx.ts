/**
 * Spray, bubbles, ripples, leaves and little bonus numbers, printed like everything else: each dot is one ink,
 * or paper knocked out of every plate (white water).
 */
import { display, spaced } from "./type.ts";
import { maple, PLATES, type Plate, type View } from "./draw.ts";

type Ink = Plate | "paper";

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  ink: Ink;
  g: number;
  drag: number;
  /** Bubbles rise until they reach this y (a surface), then pop. */
  until: number;
}

interface Ripple {
  x: number;
  y: number;
  t: number;
  max: number;
  w: number;
}

interface Pop {
  x: number;
  y: number;
  t: number;
  text: string;
}

interface Leaf {
  x: number;
  y: number;
  vx: number;
  rot: number;
  spin: number;
  ph: number;
  r: number;
}

const MAX = 420;

export class Fx {
  private dots: Dot[] = [];
  private ripples: Ripple[] = [];
  private pops: Pop[] = [];
  /** Screen-space maple leaves drifting down across the page. */
  private leaves: Leaf[] = [];
  private leafWait = 1;

  clear(): void {
    this.dots.length = 0;
    this.ripples.length = 0;
    this.pops.length = 0;
  }

  spray(x: number, y: number, n: number, speed: number, angle: number, spread: number, inks: Ink[] = ["paper", "paper", "teal"]): void {
    for (let i = 0; i < n && this.dots.length < MAX; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.dots.push({
        x: x + (Math.random() - 0.5) * 8,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: 0.4 + Math.random() * 0.5,
        r: 0.8 + Math.random() * 2.2,
        ink: inks[i % inks.length]!,
        g: 700,
        drag: 1.2,
        until: Infinity,
      });
    }
  }

  bubbles(x: number, y: number, n: number, surface: number): void {
    for (let i = 0; i < n && this.dots.length < MAX; i++) {
      this.dots.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 20,
        vy: -30 - Math.random() * 50,
        life: 0,
        max: 1.4 + Math.random(),
        r: 0.8 + Math.random() * 1.8,
        ink: "paper",
        g: -60,
        drag: 0.8,
        until: surface,
      });
    }
  }

  ripple(x: number, y: number, w: number, max = 0.9): void {
    this.ripples.push({ x, y, t: 0, max, w });
  }

  pop(x: number, y: number, text: string): void {
    this.pops.push({ x, y, t: 0, text });
  }

  update(dt: number, W: number, H: number, reduced: boolean): void {
    for (const d of this.dots) {
      d.life += dt;
      d.vy += d.g * dt;
      const k = Math.exp(-d.drag * dt);
      d.vx *= k;
      d.vy *= k;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y < d.until) d.life = d.max;
    }
    this.dots = this.dots.filter((d) => d.life < d.max);
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < r.max);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < 1.1);
    // Leaves.
    this.leafWait -= dt;
    if (this.leafWait <= 0 && this.leaves.length < 7) {
      this.leafWait = 0.9 + Math.random() * 2.2;
      this.leaves.push({ x: Math.random() * W * 1.2, y: -12, vx: -8 - Math.random() * 14, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 2, ph: Math.random() * 6, r: 4 + Math.random() * 3 });
    }
    for (const l of this.leaves) {
      l.y += dt * (18 + l.r * 2);
      l.x += dt * (l.vx + (reduced ? 0 : Math.sin(l.y * 0.03 + l.ph) * 16));
      l.rot += dt * l.spin;
    }
    this.leaves = this.leaves.filter((l) => l.y < H + 20 && l.x > -30);
  }

  /** World-space effects; plates are already in world units. */
  draw(v: View, pl: Record<Plate, CanvasRenderingContext2D>): void {
    const { press } = v;
    for (const p of PLATES) {
      const c = pl[p];
      c.beginPath();
      let any = false;
      for (const d of this.dots) {
        if (d.ink !== p) continue;
        const r = d.r * (1 - (d.life / d.max) ** 2);
        c.moveTo(d.x + r, d.y);
        c.arc(d.x, d.y, r, 0, Math.PI * 2);
        any = true;
      }
      if (any) {
        c.fillStyle = press.solid(p);
        c.fill();
      }
    }
    // Paper: knocked out of every plate.
    for (const p of PLATES) {
      const c = pl[p];
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.beginPath();
      for (const d of this.dots) {
        if (d.ink !== "paper") continue;
        const r = d.r * (1 - (d.life / d.max) ** 2);
        c.moveTo(d.x + r, d.y);
        c.arc(d.x, d.y, r, 0, Math.PI * 2);
      }
      c.fill();
      // Ripples: paper rings flattened onto the surface.
      c.lineWidth = 1.3;
      c.strokeStyle = "#000";
      c.beginPath();
      for (const r of this.ripples) {
        const k = r.t / r.max;
        const rx = r.w * (0.4 + k * 1.6);
        c.moveTo(r.x + rx, r.y + 2);
        c.ellipse(r.x, r.y + 2, rx, rx * 0.12, 0, 0, Math.PI * 2);
      }
      c.stroke();
      c.globalCompositeOperation = "source-over";
    }
    // Bonus numbers, printed twice off register.
    for (const p of this.pops) {
      const k = p.t / 1.1;
      const y = p.y - 20 - k * 26;
      const size = 15 * (1 - Math.max(0, k - 0.75) * 2.5);
      if (size <= 1) continue;
      pl.pink.fillStyle = press.solid("pink");
      spaced(pl.pink, p.text, p.x, y, display(size), 1);
      pl.yellow.fillStyle = press.solid("yellow");
      spaced(pl.yellow, p.text, p.x + 1.2, y + 1, display(size), 1);
    }
  }

  /** Screen-space leaves: plates in CSS px. */
  drawLeaves(v: View): void {
    const { press } = v;
    const pink = press.plate("pink");
    const yellow = press.plate("yellow");
    for (const l of this.leaves) {
      const tumble = Math.cos(l.rot * 1.7 + l.ph);
      maple(pink, press.screen("pink", 0.85), l.x, l.y, l.r, l.rot, tumble);
      maple(yellow, press.solid("yellow"), l.x, l.y, l.r, l.rot, tumble);
    }
  }
}
