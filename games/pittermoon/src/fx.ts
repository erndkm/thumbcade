import { PAL } from "./palette.ts";

/**
 * Chunky pixel particles: whole-pixel positions, no alpha. They fade by stepping down a color ramp.
 */
export type Shape = "dot" | "big" | "plus" | "bubble" | "heart" | "steam" | "spark";

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  g: number;
  drag: number;
  shape: Shape;
  ramp: readonly string[];
}

export interface Burst {
  count: number;
  speed: [number, number];
  angle?: [number, number];
  life: [number, number];
  ramp: readonly string[];
  shape?: Shape;
  gravity?: number;
  drag?: number;
  spread?: number;
  vx?: number;
  vy?: number;
}

// prettier-ignore
const HEART_PX = [
  [0, 0], [2, 0],
  [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1],
  [0, 2], [1, 2], [2, 2],
  [1, 3],
] as const;

export class PixelParticles {
  private items: P[] = [];
  private pool: P[] = [];
  constructor(private readonly cap = 400) {}

  get count(): number {
    return this.items.length;
  }

  emit(x: number, y: number, o: Burst): void {
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    for (let i = 0; i < o.count; i++) {
      if (this.items.length >= this.cap) this.pool.push(this.items.shift()!);
      const p = this.pool.pop() ?? ({} as P);
      const a = o.angle ? r(o.angle) : Math.random() * Math.PI * 2;
      const s = r(o.speed);
      const j = o.spread ? (Math.random() * 2 - 1) * o.spread : 0;
      p.x = x + j;
      p.y = y + (o.spread ? (Math.random() * 2 - 1) * o.spread * 0.4 : 0);
      p.vx = Math.cos(a) * s + (o.vx ?? 0);
      p.vy = Math.sin(a) * s + (o.vy ?? 0);
      p.life = p.max = r(o.life);
      p.g = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.shape = o.shape ?? "dot";
      p.ramp = o.ramp;
      this.items.push(p);
    }
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.push(p);
        continue;
      }
      const d = p.drag > 0 ? Math.exp(-p.drag * dt) : 1;
      p.vx *= d;
      p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.items[w++] = p;
    }
    this.items.length = w;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const k = 1 - p.life / p.max;
      const idx = Math.min(p.ramp.length - 1, Math.floor(k * p.ramp.length));
      ctx.fillStyle = p.ramp[idx]!;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      switch (p.shape) {
        case "big":
          ctx.fillRect(x, y, k > 0.6 ? 1 : 2, k > 0.6 ? 1 : 2);
          break;
        case "plus":
          ctx.fillRect(x, y, 1, 1);
          if (k < 0.7) {
            ctx.fillRect(x - 1, y, 3, 1);
            ctx.fillRect(x, y - 1, 1, 3);
          }
          break;
        case "spark":
          // A four-point twinkle that shrinks to a dot.
          ctx.fillRect(x, y, 1, 1);
          if (k < 0.5) {
            ctx.fillRect(x - 2, y, 5, 1);
            ctx.fillRect(x, y - 2, 1, 5);
          } else if (k < 0.8) {
            ctx.fillRect(x - 1, y, 3, 1);
            ctx.fillRect(x, y - 1, 1, 3);
          }
          break;
        case "bubble":
          if (k < 0.85) {
            ctx.fillRect(x, y - 1, 1, 1);
            ctx.fillRect(x - 1, y, 1, 1);
            ctx.fillRect(x + 1, y, 1, 1);
            ctx.fillRect(x, y + 1, 1, 1);
          } else {
            // pop!
            ctx.fillRect(x - 2, y, 1, 1);
            ctx.fillRect(x + 2, y, 1, 1);
            ctx.fillRect(x, y - 2, 1, 1);
            ctx.fillRect(x, y + 2, 1, 1);
          }
          break;
        case "heart":
          for (const [hx, hy] of HEART_PX) ctx.fillRect(x + hx, y + hy, 1, 1);
          break;
        case "steam": {
          const s = k < 0.3 ? 1 : k < 0.75 ? 2 : 3;
          if (s === 1) ctx.fillRect(x, y, 2, 1);
          else if (s === 2) {
            ctx.fillRect(x, y, 2, 2);
            ctx.fillRect(x - 1, y + 1, 1, 1);
          } else {
            ctx.fillRect(x - 1, y, 1, 1);
            ctx.fillRect(x + 2, y + 1, 1, 1);
            ctx.fillRect(x, y - 1, 1, 1);
          }
          break;
        }
        default:
          ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  clear(): void {
    this.pool.push(...this.items);
    this.items.length = 0;
  }
}

/** Ramps (bright → dim) for fading pixels without alpha. */
export const RAMP = {
  steam: [PAL.cream, PAL.mist, PAL.mauve, PAL.dusk],
  spark: [PAL.cream, PAL.butter, PAL.candle, PAL.ember],
  gold: [PAL.butter, PAL.butter, PAL.candle],
  heart: [PAL.rose, PAL.rose, PAL.rose, PAL.dusk],
  mist: [PAL.cream, PAL.mist, PAL.teal],
  dust: [PAL.mauve, PAL.dusk, PAL.night],
  water: [PAL.cream, PAL.mist, PAL.teal, PAL.pond],
  /** Splashes on the brook. */
  splash: [PAL.cream, PAL.frost, PAL.mist, PAL.glacier],
  /** Moon sparkle: whisker-close, fish, the broom's trail. */
  moon: [PAL.cream, PAL.butter, PAL.frost, PAL.mist],
  ember: [PAL.butter, PAL.candle, PAL.ember, PAL.wood],
  /** First light, and the best-row ribbon. */
  dawn: [PAL.cream, PAL.dawn, PAL.blush, PAL.rose],
  /** Bog bubbles and toadstool spores. */
  bog: [PAL.sage, PAL.moss, PAL.teal, PAL.pond],
  /** Pumpkin bits. */
  pumpkin: [PAL.butter, PAL.candle, PAL.ember, PAL.wood],
  /** A will-o'-wisp's glow. */
  wisp: [PAL.cream, PAL.frost, PAL.mist, PAL.teal],
} as const;

/** Whole-pixel screen nudges (never a big shake). */
export class Nudge {
  private t = 0;
  private amp = 0;
  constructor(private readonly reduced: boolean) {}
  kick(px: number, seconds = 0.18): void {
    if (this.reduced) return;
    this.amp = Math.max(this.amp, px);
    this.t = Math.max(this.t, seconds);
  }
  update(dt: number): void {
    this.t = Math.max(0, this.t - dt);
    if (this.t === 0) this.amp = 0;
  }
  /** Current offset in whole pixels: alternates every ~1/30 s. */
  offset(time: number): { x: number; y: number } {
    if (this.t <= 0 || this.amp <= 0) return { x: 0, y: 0 };
    const a = Math.max(1, Math.round(this.amp * Math.min(1, this.t / 0.12)));
    const step = Math.floor(time * 30) % 4;
    return { x: step === 0 ? a : step === 2 ? -a : 0, y: step === 1 ? -Math.min(1, a) : 0 };
  }
}
