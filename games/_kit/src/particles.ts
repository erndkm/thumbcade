/** Pooled 2D particles for canvas games. Thousands per frame without allocation. */

export type ParticleShape = "square" | "circle" | "spark" | "ring" | "heart";

export interface EmitOptions {
  count: number;
  /** Speed range in px/s. */
  speed: [number, number];
  /** Direction range in radians (default: full circle). */
  angle?: [number, number];
  /** Lifetime range in seconds. */
  life: [number, number];
  /** Size range in px. */
  size: [number, number];
  colors: readonly string[];
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  shape?: ParticleShape;
  /** Spawn jitter radius. */
  spread?: number;
  /** Size multiplier at end of life (default 0 = shrink to nothing). */
  endScale?: number;
  /** Initial spin range (rad/s). */
  spin?: [number, number];
  /** Inherit this velocity. */
  vx?: number;
  vy?: number;
}

export class Particles {
  private n = 0;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly rot: Float32Array;
  private readonly vr: Float32Array;
  private readonly endScale: Float32Array;
  private readonly color: string[];
  private readonly shape: ParticleShape[];

  constructor(readonly capacity = 800) {
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.life = f();
    this.max = f();
    this.size = f();
    this.grav = f();
    this.drag = f();
    this.rot = f();
    this.vr = f();
    this.endScale = f();
    this.color = new Array<string>(capacity).fill("#fff");
    this.shape = new Array<ParticleShape>(capacity).fill("square");
  }

  get count(): number {
    return this.n;
  }

  emit(x: number, y: number, o: EmitOptions): void {
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    for (let k = 0; k < o.count; k++) {
      // When full, overwrite the oldest-ish slot instead of dropping the effect.
      const i = this.n < this.capacity ? this.n++ : Math.floor(Math.random() * this.capacity);
      const a = o.angle ? r(o.angle) : Math.random() * Math.PI * 2;
      const s = r(o.speed);
      const j = o.spread ? Math.random() * o.spread : 0;
      const ja = Math.random() * Math.PI * 2;
      this.x[i] = x + Math.cos(ja) * j;
      this.y[i] = y + Math.sin(ja) * j;
      this.vx[i] = Math.cos(a) * s + (o.vx ?? 0);
      this.vy[i] = Math.sin(a) * s + (o.vy ?? 0);
      this.life[i] = this.max[i] = r(o.life);
      this.size[i] = r(o.size);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.rot[i] = Math.random() * Math.PI * 2;
      this.vr[i] = o.spin ? r(o.spin) : 0;
      this.endScale[i] = o.endScale ?? 0;
      this.color[i] = o.colors[Math.floor(Math.random() * o.colors.length)] ?? "#fff";
      this.shape[i] = o.shape ?? "square";
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.swapRemove(i);
        continue;
      }
      const d = this.drag[i]! > 0 ? Math.exp(-this.drag[i]! * dt) : 1;
      this.vx[i]! *= d;
      this.vy[i] = this.vy[i]! * d + this.grav[i]! * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.vr[i]! * dt;
      i++;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < this.n; i++) {
      const t = this.life[i]! / this.max[i]!;
      const s = this.size[i]! * (this.endScale[i]! + (1 - this.endScale[i]!) * t);
      if (s <= 0.2) continue;
      ctx.globalAlpha = Math.min(1, t * 2.2);
      const c = this.color[i]!;
      const x = this.x[i]!;
      const y = this.y[i]!;
      switch (this.shape[i]) {
        case "circle":
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(x, y, s / 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "ring":
          ctx.strokeStyle = c;
          ctx.lineWidth = Math.max(1, s * 0.18);
          ctx.beginPath();
          ctx.arc(x, y, s / 2, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case "spark": {
          const vx = this.vx[i]!;
          const vy = this.vy[i]!;
          const len = Math.min(40, Math.hypot(vx, vy) * 0.04) + s;
          const a = Math.atan2(vy, vx);
          ctx.strokeStyle = c;
          ctx.lineWidth = Math.max(1, s * 0.45);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
          ctx.stroke();
          break;
        }
        case "heart": {
          // 5x4 pixel heart.
          const p = s / 5;
          ctx.fillStyle = c;
          const rows = ["01010", "11111", "01110", "00100"];
          for (let ry = 0; ry < 4; ry++)
            for (let rx = 0; rx < 5; rx++)
              if (rows[ry]![rx] === "1") ctx.fillRect(x + (rx - 2.5) * p, y + (ry - 2) * p, p + 0.3, p + 0.3);
          break;
        }
        default: {
          ctx.fillStyle = c;
          const r = this.rot[i]!;
          if (r === 0) ctx.fillRect(x - s / 2, y - s / 2, s, s);
          else {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(r);
            ctx.fillRect(-s / 2, -s / 2, s, s);
            ctx.restore();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.n = 0;
  }

  private swapRemove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.life[i] = this.life[last]!;
    this.max[i] = this.max[last]!;
    this.size[i] = this.size[last]!;
    this.grav[i] = this.grav[last]!;
    this.drag[i] = this.drag[last]!;
    this.rot[i] = this.rot[last]!;
    this.vr[i] = this.vr[last]!;
    this.endScale[i] = this.endScale[last]!;
    this.color[i] = this.color[last]!;
    this.shape[i] = this.shape[last]!;
  }
}

/** Short-lived floating text ("+10", "PERFECT"). */
export interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  size: number;
}

export class Popups {
  items: Popup[] = [];
  add(text: string, x: number, y: number, color: string, size = 22, life = 0.8): void {
    this.items.push({ text, x, y, t: 0, life, color, size });
  }
  update(dt: number): void {
    for (const p of this.items) p.t += dt;
    this.items = this.items.filter((p) => p.t < p.life);
  }
  draw(ctx: CanvasRenderingContext2D, font: string): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of this.items) {
      const k = p.t / p.life;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4);
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = `${Math.round(p.size * pop)}px ${font}`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - k * 40);
    }
    ctx.globalAlpha = 1;
  }
  clear(): void {
    this.items = [];
  }
}
