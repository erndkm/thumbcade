/**
 * Little things that fly and fade, seen from above: paper scraps torn off the rim, eraser crumbs, ink dots, doodled
 * stars, speed streaks; and one-off doodles that draw on and fade (ink rings, comic bursts, eraser smudges, puffs).
 * Sizes and speeds are in whatever space the context is in: page units for the world, CSS px for the HUD.
 */
import { begin, ellipsePts, ink, PAL, pt, shash } from "./ink.ts";

export type BitKind = "scrap" | "crumb" | "dot" | "star" | "streak";
export type MarkKind = "ring" | "burst" | "smudge" | "puff";

interface Bit {
  kind: BitKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  max: number;
  size: number;
  color: string;
  grav: number;
  drag: number;
}

interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  color: string;
  seed: number;
  rot: number;
}

export interface BitOptions {
  count: number;
  speed: [number, number];
  angle?: [number, number];
  life: [number, number];
  size: [number, number];
  colors: readonly string[];
  grav?: number;
  drag?: number;
  spread?: number;
}

let seedN = 7;
const nextSeed = () => (seedN = (seedN * 1103515245 + 12345) & 0x7fffffff);

export class Fx {
  bits: Bit[] = [];
  marks: Mark[] = [];
  constructor(private readonly cap = 320) {}

  bit(kind: BitKind, x: number, y: number, o: BitOptions): void {
    for (let i = 0; i < o.count; i++) {
      if (this.bits.length >= this.cap) this.bits.shift();
      const a = o.angle ? o.angle[0] + Math.random() * (o.angle[1] - o.angle[0]) : Math.random() * Math.PI * 2;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      const j = (o.spread ?? 0) * Math.random();
      const ja = Math.random() * Math.PI * 2;
      this.bits.push({
        kind,
        x: x + Math.cos(ja) * j,
        y: y + Math.sin(ja) * j,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        life,
        max: life,
        size: o.size[0] + Math.random() * (o.size[1] - o.size[0]),
        color: o.colors[Math.floor(Math.random() * o.colors.length)] ?? PAL.ink,
        grav: o.grav ?? 0,
        drag: o.drag ?? 3,
      });
    }
  }

  mark(kind: MarkKind, x: number, y: number, r: number, color: string, life: number): void {
    if (this.marks.length > 48) this.marks.shift();
    this.marks.push({ kind, x, y, r, t: 0, life, color, seed: nextSeed(), rot: Math.random() * Math.PI * 2 });
  }

  clear(): void {
    this.bits.length = 0;
    this.marks.length = 0;
  }

  update(dt: number): void {
    for (const b of this.bits) {
      b.life -= dt;
      const d = Math.exp(-b.drag * dt);
      b.vx *= d;
      b.vy = b.vy * d + b.grav * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      b.vr *= d;
    }
    if (this.bits.some((b) => b.life <= 0)) this.bits = this.bits.filter((b) => b.life > 0);
    for (const m of this.marks) m.t += dt;
    if (this.marks.some((m) => m.t >= m.life)) this.marks = this.marks.filter((m) => m.t < m.life);
  }

  /** `unit` = one screen px in this context's units (line widths). */
  drawBits(ctx: CanvasRenderingContext2D, unit: number): void {
    for (const b of this.bits) {
      const k = b.life / b.max;
      ctx.globalAlpha = Math.min(1, k * 2.5);
      const s = b.size;
      const c = Math.cos(b.rot);
      const sn = Math.sin(b.rot);
      switch (b.kind) {
        case "scrap": {
          // A torn bit of paper: an uneven quad, a shade darker than the page so it reads, with a lit edge.
          ctx.fillStyle = "#E9E0CC";
          ctx.beginPath();
          ctx.moveTo(b.x + c * s - sn * s * 0.35, b.y + sn * s + c * s * 0.35);
          ctx.lineTo(b.x - c * s * 0.45 - sn * s * 0.75, b.y - sn * s * 0.45 + c * s * 0.75);
          ctx.lineTo(b.x - c * s * 0.8 + sn * s * 0.3, b.y - sn * s * 0.8 - c * s * 0.3);
          ctx.lineTo(b.x + c * s * 0.2 + sn * s * 0.7, b.y + sn * s * 0.2 - c * s * 0.7);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(255,253,246,0.9)";
          ctx.lineWidth = unit;
          ctx.stroke();
          break;
        }
        case "crumb":
        case "dot":
          ctx.fillStyle = b.color;
          ctx.beginPath();
          ctx.ellipse(b.x, b.y, s, s * 0.75, b.rot, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "star": {
          ctx.fillStyle = b.color;
          ctx.strokeStyle = PAL.ink;
          ctx.lineWidth = unit * 1.2;
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const a = b.rot + (i / 10) * Math.PI * 2;
            const r = i % 2 ? s * 0.45 : s;
            if (i === 0) ctx.moveTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
            else ctx.lineTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "streak": {
          const sp = Math.hypot(b.vx, b.vy) || 1;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = unit * 1.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - (b.vx / sp) * s, b.y - (b.vy / sp) * s);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawMarks(ctx: CanvasRenderingContext2D, unit: number, step: number): void {
    for (const m of this.marks) {
      const k = m.t / m.life;
      switch (m.kind) {
        case "ring": {
          const r = m.r * (0.55 + 0.7 * (1 - (1 - k) ** 3));
          ellipsePts(m.x, m.y, r, r, m.seed, 0.1, 16);
          ink(ctx, m.seed, { width: unit * 2 * (1 - k * 0.6), jitter: unit, step, color: m.color, alpha: 1 - k, passes: 1 });
          break;
        }
        case "burst": {
          const n = 9;
          for (let i = 0; i < n; i++) {
            const a = m.rot + (i / n) * Math.PI * 2;
            const r0 = m.r * (0.75 + 0.5 * k);
            const r1 = r0 + m.r * (0.35 + 0.2 * shash(m.seed, i)) * (1 - k * 0.5);
            begin();
            pt(m.x + Math.cos(a) * r0, m.y + Math.sin(a) * r0);
            pt(m.x + Math.cos(a) * r1, m.y + Math.sin(a) * r1);
            ink(ctx, m.seed + i, { width: unit * 2.2, jitter: unit * 0.6, step, color: m.color, alpha: 1 - k * k, passes: 1 });
          }
          break;
        }
        case "smudge": {
          ctx.globalAlpha = 0.5 * (1 - k);
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.ellipse(m.x, m.y, m.r, m.r * 0.6, m.rot, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.16 * (1 - k);
          ctx.strokeStyle = PAL.graphite;
          ctx.lineWidth = unit * 1.2;
          ctx.beginPath();
          ctx.ellipse(m.x, m.y, m.r * 0.8, m.r * 0.42, m.rot, 0.3, 2.6);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case "puff": {
          const r = m.r * (0.6 + 0.6 * k);
          begin();
          for (let i = 0; i <= 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const rr = r * (1 + 0.18 * Math.sin(a * 5 + m.seed));
            pt(m.x + Math.cos(a) * rr, m.y + Math.sin(a) * rr * 0.75);
          }
          ink(ctx, m.seed, { width: unit * 1.6, jitter: unit, step, color: m.color, alpha: 1 - k, passes: 1, closed: true });
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
