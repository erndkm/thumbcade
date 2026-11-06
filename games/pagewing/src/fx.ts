import { begin, ellipse, ink, line, PAL, pt, shash, write, bold } from "./ink.ts";

/** Little bits that fly and fall: eraser crumbs, paper scraps, balloon rubber, star confetti, ink dots. */
type BitKind = "crumb" | "scrap" | "rubber" | "star" | "dot";

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
  seed: number;
}

/** One-off doodles that draw on and fade: comic bursts, rings, whoosh curls, eraser smudges. */
type MarkKind = "burst" | "ring" | "whoosh" | "smudge" | "check" | "cross";

interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
  r: number;
  rot: number;
  t: number;
  life: number;
  color: string;
  seed: number;
}

interface Note {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  size: number;
  rot: number;
  seed: number;
  rise: number;
}

let seedCounter = 1;
const nextSeed = () => (seedCounter = (seedCounter * 1103515245 + 12345) & 0x7fffffff);

export class Fx {
  bits: Bit[] = [];
  marks: Mark[] = [];
  notes: Note[] = [];

  bit(kind: BitKind, x: number, y: number, o: { speed: [number, number]; angle?: [number, number]; life: [number, number]; size: [number, number]; color: string; grav?: number; count: number }): void {
    for (let i = 0; i < o.count; i++) {
      if (this.bits.length > 260) this.bits.shift();
      const a = o.angle ? o.angle[0] + Math.random() * (o.angle[1] - o.angle[0]) : Math.random() * Math.PI * 2;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.bits.push({
        kind,
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        life,
        max: life,
        size: o.size[0] + Math.random() * (o.size[1] - o.size[0]),
        color: o.color,
        grav: o.grav ?? 700,
        seed: nextSeed(),
      });
    }
  }

  /** Eraser crumbs over an area (x, y, radius). */
  crumbs(x: number, y: number, r: number, count = 10): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.bit("crumb", x + Math.cos(a) * d, y + Math.sin(a) * d, {
        count: 1,
        speed: [20, 110],
        angle: [-Math.PI * 0.95, -Math.PI * 0.05],
        life: [0.6, 1.1],
        size: [3, 6.5],
        color: Math.random() < 0.6 ? PAL.eraser : PAL.eraserGrey,
        grav: 900,
      });
    }
    this.mark("smudge", x, y, r, PAL.graphite, 0.7);
  }

  mark(kind: MarkKind, x: number, y: number, r: number, color: string, life: number, rot = 0): void {
    if (this.marks.length > 40) this.marks.shift();
    this.marks.push({ kind, x, y, r, rot, t: 0, life, color, seed: nextSeed() });
  }

  note(text: string, x: number, y: number, color: string, size = 28, life = 1, rot = 0, rise = 34): void {
    if (this.notes.length > 14) this.notes.shift();
    this.notes.push({ text, x, y, t: 0, life, color, size, rot: rot + (Math.random() - 0.5) * 0.12, seed: nextSeed(), rise });
  }

  clear(): void {
    this.bits.length = 0;
    this.marks.length = 0;
    this.notes.length = 0;
  }

  update(dt: number): void {
    for (const b of this.bits) {
      b.life -= dt;
      b.vy += b.grav * dt;
      const drag = b.kind === "scrap" || b.kind === "star" ? Math.exp(-2.2 * dt) : Math.exp(-0.6 * dt);
      b.vx *= drag;
      b.vy *= b.kind === "scrap" ? Math.exp(-2.4 * dt) : 1;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    for (const m of this.marks) m.t += dt;
    this.marks = this.marks.filter((m) => m.t < m.life);
    for (const n of this.notes) n.t += dt;
    this.notes = this.notes.filter((n) => n.t < n.life);
  }

  drawBits(ctx: CanvasRenderingContext2D): void {
    for (const b of this.bits) {
      const k = b.life / b.max;
      const a = Math.min(1, k * 3);
      const c = Math.cos(b.rot);
      const s = Math.sin(b.rot);
      const z = b.size;
      switch (b.kind) {
        case "crumb": {
          // A rolled eraser crumb: a fat little capsule with a darker edge.
          ctx.globalAlpha = a;
          ctx.strokeStyle = b.color;
          ctx.lineCap = "round";
          ctx.lineWidth = z * 0.55;
          ctx.beginPath();
          ctx.moveTo(b.x - c * z * 0.5, b.y - s * z * 0.5);
          ctx.quadraticCurveTo(b.x + s * z * 0.2, b.y - c * z * 0.2, b.x + c * z * 0.5, b.y + s * z * 0.5);
          ctx.stroke();
          ctx.strokeStyle = "rgba(90,70,60,0.35)";
          ctx.lineWidth = 0.7;
          ctx.stroke();
          break;
        }
        case "scrap": {
          ctx.globalAlpha = a;
          ctx.fillStyle = PAL.paper;
          ctx.strokeStyle = PAL.ink;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(b.x + c * z, b.y + s * z);
          ctx.lineTo(b.x - c * z * 0.6 + s * z * 0.7, b.y - s * z * 0.6 - c * z * 0.7);
          ctx.lineTo(b.x - c * z * 0.5 - s * z * 0.6, b.y - s * z * 0.5 + c * z * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "rubber": {
          ctx.globalAlpha = a;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1.8;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(b.x - c * z, b.y - s * z);
          ctx.quadraticCurveTo(b.x + s * z, b.y - c * z, b.x + c * z, b.y + s * z);
          ctx.stroke();
          break;
        }
        case "star": {
          ctx.globalAlpha = a;
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 1.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const aa = b.rot + (i / 3) * Math.PI;
            ctx.moveTo(b.x - Math.cos(aa) * z, b.y - Math.sin(aa) * z);
            ctx.lineTo(b.x + Math.cos(aa) * z, b.y + Math.sin(aa) * z);
          }
          ctx.stroke();
          break;
        }
        default: {
          ctx.globalAlpha = a;
          ctx.fillStyle = b.color;
          ctx.beginPath();
          ctx.arc(b.x, b.y, z * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  drawMarks(ctx: CanvasRenderingContext2D): void {
    for (const m of this.marks) {
      const k = m.t / m.life;
      switch (m.kind) {
        case "burst": {
          // A comic "pop" star: jagged spokes that snap out and fade.
          const grow = Math.min(1, k * 6);
          const alpha = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
          const spokes = 9;
          for (let i = 0; i < spokes; i++) {
            const a = m.rot + (i / spokes) * Math.PI * 2 + shash(m.seed, i) * 0.2;
            const r0 = m.r * (0.45 + 0.1 * grow);
            const r1 = m.r * (0.75 + 0.55 * grow) * (i % 2 ? 0.75 : 1);
            line(ctx, m.x + Math.cos(a) * r0, m.y + Math.sin(a) * r0, m.x + Math.cos(a) * r1, m.y + Math.sin(a) * r1, m.seed + i, {
              color: m.color,
              width: 1.8,
              passes: 1,
              alpha,
              jitter: 0.6,
            });
          }
          break;
        }
        case "ring": {
          const alpha = 1 - k;
          ellipse(ctx, m.x, m.y, m.r * (0.6 + k * 0.9), m.r * (0.6 + k * 0.9), m.seed, { color: m.color, width: 1.6, passes: 1, alpha });
          break;
        }
        case "whoosh": {
          // A little curl and two speed dashes behind something that just left.
          const alpha = 1 - k;
          const c = Math.cos(m.rot);
          const s = Math.sin(m.rot);
          begin();
          for (let i = 0; i <= 7; i++) {
            const a = i * 0.9;
            const r = m.r * 0.35 * (1 - i / 9);
            pt(m.x - c * (i * 2.4) + Math.cos(a) * r, m.y - s * (i * 2.4) + Math.sin(a) * r);
          }
          ink(ctx, m.seed, { color: PAL.graphite, width: 1.2, passes: 1, alpha, jitter: 0.4 });
          for (let j = -1; j <= 1; j += 2) {
            const ox = m.x - s * j * 7;
            const oy = m.y + c * j * 7;
            line(ctx, ox - c * 6, oy - s * 6, ox - c * (6 + m.r), oy - s * (6 + m.r), m.seed + j + 5, { color: PAL.graphite, width: 1.1, passes: 1, alpha });
          }
          break;
        }
        case "smudge": {
          // What an eraser leaves: a faint grey zig-zag that fades.
          const alpha = 0.16 * (1 - k) * (1 - k);
          begin();
          for (let i = 0; i <= 6; i++) pt(m.x - m.r + (i / 6) * m.r * 2, m.y + (i % 2 ? -m.r * 0.35 : m.r * 0.35));
          ink(ctx, m.seed, { color: m.color, width: m.r * 0.32, passes: 1, alpha, jitter: 1 });
          break;
        }
        case "check": {
          // A teacher's red tick, drawn on quickly.
          const p = Math.min(1, k * 5);
          const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
          const r = m.r;
          begin();
          pt(m.x - r * 0.6, m.y - r * 0.05);
          pt(m.x - r * 0.2, m.y + r * 0.4);
          if (p > 0.4) pt(m.x - r * 0.2 + (r * 1.1 * (p - 0.4)) / 0.6, m.y + r * 0.4 - (r * 1.1 * (p - 0.4)) / 0.6);
          ink(ctx, m.seed, { color: m.color, width: 2.6, alpha, jitter: 0.6 });
          break;
        }
        case "cross": {
          const alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
          line(ctx, m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r, m.seed, { color: m.color, width: 2.2, alpha });
          if (k > 0.08) line(ctx, m.x + m.r, m.y - m.r, m.x - m.r, m.y + m.r, m.seed + 1, { color: m.color, width: 2.2, alpha });
          break;
        }
      }
    }
  }

  drawNotes(ctx: CanvasRenderingContext2D): void {
    for (const n of this.notes) {
      const k = n.t / n.life;
      // Snappy: overshoots in, holds, drifts up and fades.
      const pop = k < 0.12 ? 0.5 + (k / 0.12) * 0.62 : k < 0.2 ? 1.12 - ((k - 0.12) / 0.08) * 0.12 : 1;
      const alpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      const y = n.y - n.rise * Math.min(1, k * 1.6);
      write(ctx, n.text, n.x, y, bold(n.size * pop), n.color, n.seed, { align: "center", rot: n.rot, alpha });
    }
  }
}
