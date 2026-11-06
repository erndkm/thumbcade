/**
 * Ink effects, printed like everything else: dots of solid ink that fly and shrink (riso has no transparency, so
 * things leave by getting smaller or by thinning to a halftone), rings that spread from the press, words that rise
 * off the paper, and confetti for the encore. Fixed pools, nothing allocated per frame.
 */
import type { Press } from "./riso.ts";
import { small, spaced } from "./type.ts";

export type Ink = "blue" | "red" | "yellow";
const INKS: Ink[] = ["blue", "red", "yellow"];

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ink: Ink;
  life: number;
  max: number;
  g: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  w: number;
  ink: Ink;
  life: number;
  max: number;
}

interface Pop {
  text: string;
  x: number;
  y: number;
  rise: number;
  size: number;
  track: number;
  ink: Ink;
  life: number;
  max: number;
}

const MAX_DOTS = 320;
const MAX_RINGS = 28;
const MAX_POPS = 14;

export class Fx {
  private dots: Dot[] = Array.from({ length: MAX_DOTS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, ink: "red" as Ink, life: 0, max: 1, g: 0 }));
  private rings: Ring[] = Array.from({ length: MAX_RINGS }, () => ({ x: 0, y: 0, r0: 0, r1: 0, w: 0, ink: "red" as Ink, life: 0, max: 1 }));
  private pops: Pop[] = Array.from({ length: MAX_POPS }, () => ({ text: "", x: 0, y: 0, rise: 0, size: 12, track: 3, ink: "red" as Ink, life: 0, max: 1 }));
  private di = 0;
  private ri = 0;
  private pi = 0;
  reduced = false;

  clear(): void {
    for (const d of this.dots) d.life = 0;
    for (const r of this.rings) r.life = 0;
    for (const p of this.pops) p.life = 0;
  }

  dot(x: number, y: number, vx: number, vy: number, r: number, ink: Ink, life: number, g = 0): void {
    const d = this.dots[this.di]!;
    this.di = (this.di + 1) % MAX_DOTS;
    d.x = x;
    d.y = y;
    d.vx = vx;
    d.vy = vy;
    d.r = r;
    d.ink = ink;
    d.life = d.max = life;
    d.g = g;
  }

  /** A spray of ink dots from (x, y), mostly upward. */
  spray(x: number, y: number, n: number, speed: number, u: number, inks: readonly Ink[] = INKS, spread = Math.PI * 0.9): void {
    if (this.reduced) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread * 2;
      const s = speed * (0.35 + Math.random() * 0.75) * (this.reduced ? 0.5 : 1);
      this.dot(x + (Math.random() - 0.5) * 10 * u, y, Math.cos(a) * s, Math.sin(a) * s, (1.6 + Math.random() * 3.4) * u, inks[i % inks.length]!, 0.35 + Math.random() * 0.4, 900 * u);
    }
  }

  ring(x: number, y: number, r0: number, r1: number, w: number, ink: Ink, life: number): void {
    const r = this.rings[this.ri]!;
    this.ri = (this.ri + 1) % MAX_RINGS;
    r.x = x;
    r.y = y;
    r.r0 = r0;
    r.r1 = this.reduced ? r0 + (r1 - r0) * 0.5 : r1;
    r.w = w;
    r.ink = ink;
    r.life = r.max = life;
  }

  pop(text: string, x: number, y: number, size: number, ink: Ink, life = 0.6, rise = 34): void {
    const p = this.pops[this.pi]!;
    this.pi = (this.pi + 1) % MAX_POPS;
    p.text = text;
    p.x = x;
    p.y = y;
    p.rise = this.reduced ? rise * 0.3 : rise;
    p.size = size;
    p.track = size * 0.28;
    p.ink = ink;
    p.life = p.max = life;
  }

  /** Confetti: dots raining from the top of the sheet. */
  confetti(W: number, H: number, n: number, u: number): void {
    if (this.reduced) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      this.dot(Math.random() * W, -10 - Math.random() * H * 0.6, (Math.random() - 0.5) * 70 * u, (140 + Math.random() * 220) * u, (2.4 + Math.random() * 4) * u, INKS[i % 3]!, 2.2 + Math.random() * 1.4, 160 * u);
    }
  }

  update(dt: number): void {
    for (const d of this.dots) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy += d.g * dt;
      d.vx *= 1 - Math.min(1, dt * 1.5);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
    for (const r of this.rings) if (r.life > 0) r.life -= dt;
    for (const p of this.pops) if (p.life > 0) p.life -= dt;
  }

  draw(press: Press): void {
    for (const ink of INKS) {
      const c = press.plate(ink);
      c.fillStyle = press.solid(ink);
      c.beginPath();
      let any = false;
      for (const d of this.dots) {
        if (d.life <= 0 || d.ink !== ink) continue;
        const k = d.life / d.max;
        const r = d.r * Math.min(1, k * 2.2);
        if (r < 0.4) continue;
        c.moveTo(d.x + r, d.y);
        c.arc(d.x, d.y, r, 0, Math.PI * 2);
        any = true;
      }
      if (any) c.fill();
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      const k = 1 - r.life / r.max;
      const e = 1 - (1 - k) ** 3;
      const c = press.plate(r.ink);
      c.strokeStyle = press.solid(r.ink);
      c.lineWidth = Math.max(0.6, r.w * (1 - k));
      c.beginPath();
      c.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, Math.PI * 2);
      c.stroke();
    }
    for (const p of this.pops) {
      if (p.life <= 0) continue;
      const k = 1 - p.life / p.max;
      const c = press.plate(p.ink);
      // In solid ink at first, thinning to a halftone as it goes.
      c.fillStyle = k < 0.6 ? press.solid(p.ink) : press.screen(p.ink, 1 - (k - 0.6) / 0.4);
      spaced(c, p.text, p.x, p.y - p.rise * (1 - (1 - k) ** 2), small(p.size), p.track);
    }
  }
}
