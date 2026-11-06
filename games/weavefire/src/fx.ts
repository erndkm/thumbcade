/**
 * Pooled particles for explosions, sparks, shockwaves and smoke, drawn as Pixi sprites. Two pools: additive (light:
 * sparks, glows, rings) and normal (matter: shards, smoke). Sprites are created the first time the pool grows that
 * far and are reused from then on, so a run allocates nothing once it is warm.
 *
 * Photosensitivity: a burst's large soft glow stays dim (its alpha is capped by size) and fades in over a few frames;
 * only small things (sparks, cores) get bright. So a chain of explosions never swings a big area's brightness.
 */
import { Container, Sprite, type Texture } from "pixi.js";

/** Particle behaviours. */
export const FX_GLOW = 0;
export const FX_SPARK = 1;
export const FX_SHARD = 2;
export const FX_RING = 3;
export const FX_PUFF = 4;
export const FX_DOT = 5;

class Pool {
  readonly layer = new Container();
  private readonly sprites: Sprite[] = [];
  n = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly s0: Float32Array;
  readonly s1: Float32Array;
  readonly a0: Float32Array;
  readonly rot: Float32Array;
  readonly vr: Float32Array;
  readonly drag: Float32Array;
  readonly grav: Float32Array;
  readonly attack: Float32Array;
  readonly kind: Uint8Array;
  readonly tint: Uint32Array;
  readonly tex: Array<Texture | null>;

  constructor(
    readonly capacity: number,
    add: boolean,
  ) {
    const f = () => new Float32Array(capacity);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.life = f();
    this.max = f();
    this.s0 = f();
    this.s1 = f();
    this.a0 = f();
    this.rot = f();
    this.vr = f();
    this.drag = f();
    this.grav = f();
    this.attack = f();
    this.kind = new Uint8Array(capacity);
    this.tint = new Uint32Array(capacity);
    this.tex = new Array<Texture | null>(capacity).fill(null);
    if (add) this.layer.blendMode = "add";
  }

  /** Index of a free slot (the oldest one when full). */
  take(): number {
    if (this.n < this.capacity) {
      const i = this.n++;
      if (i >= this.sprites.length) {
        const s = new Sprite();
        s.anchor.set(0.5);
        s.visible = false;
        this.sprites.push(s);
        this.layer.addChild(s);
      }
      return i;
    }
    // Full: replace the particle closest to dying.
    let best = 0;
    let bl = Infinity;
    for (let i = 0; i < this.n; i += 7) {
      if (this.life[i]! < bl) {
        bl = this.life[i]!;
        best = i;
      }
    }
    return best;
  }

  /** Grows the pool to `count` sprites now (warm-up before ready()). */
  prewarm(count: number, tex: Texture): void {
    while (this.sprites.length < Math.min(count, this.capacity)) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.visible = false;
      this.sprites.push(s);
      this.layer.addChild(s);
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.remove(i);
        continue;
      }
      const d = this.drag[i]!;
      if (d > 0) {
        const k = Math.exp(-d * dt);
        this.vx[i]! *= k;
        this.vy[i]! *= k;
      }
      this.vy[i]! += this.grav[i]! * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.vr[i]! * dt;
      i++;
    }
  }

  draw(): void {
    for (let i = 0; i < this.n; i++) {
      const s = this.sprites[i]!;
      const t = 1 - this.life[i]! / this.max[i]!;
      const tex = this.tex[i]!;
      if (s.texture !== tex) s.texture = tex;
      s.tint = this.tint[i]!;
      s.visible = true;
      s.position.set(this.x[i]!, this.y[i]!);
      const k = this.kind[i]!;
      const atk = this.attack[i]!;
      const fadeIn = atk > 0 ? Math.min(1, (t * this.max[i]!) / atk) : 1;
      let a: number;
      let sc: number;
      switch (k) {
        case FX_SPARK: {
          const vx = this.vx[i]!;
          const vy = this.vy[i]!;
          const sp = Math.sqrt(vx * vx + vy * vy);
          s.rotation = Math.atan2(vy, vx);
          sc = this.s0[i]! * (1 - t * 0.6);
          s.scale.set(sc * (0.35 + Math.min(1.6, sp / 320)), sc);
          a = this.a0[i]! * (1 - t);
          break;
        }
        case FX_RING: {
          const e = 1 - (1 - t) * (1 - t) * (1 - t);
          sc = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * e;
          s.scale.set(sc);
          s.rotation = 0;
          a = this.a0[i]! * (1 - t) * (1 - t);
          break;
        }
        case FX_GLOW: {
          const e = 1 - (1 - t) * (1 - t);
          sc = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * e;
          s.scale.set(sc);
          s.rotation = 0;
          a = this.a0[i]! * (1 - t) * (1 - t) * fadeIn;
          break;
        }
        case FX_PUFF: {
          sc = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * t;
          s.scale.set(sc);
          s.rotation = this.rot[i]!;
          a = this.a0[i]! * (1 - t) * fadeIn;
          break;
        }
        default: {
          sc = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * t;
          s.scale.set(sc);
          s.rotation = this.rot[i]!;
          a = this.a0[i]! * Math.min(1, (1 - t) * 2.5);
        }
      }
      s.alpha = a;
    }
    for (let i = this.n; i < this.sprites.length; i++) {
      const s = this.sprites[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
  }

  clear(): void {
    this.n = 0;
  }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.x[i] = this.x[l]!;
    this.y[i] = this.y[l]!;
    this.vx[i] = this.vx[l]!;
    this.vy[i] = this.vy[l]!;
    this.life[i] = this.life[l]!;
    this.max[i] = this.max[l]!;
    this.s0[i] = this.s0[l]!;
    this.s1[i] = this.s1[l]!;
    this.a0[i] = this.a0[l]!;
    this.rot[i] = this.rot[l]!;
    this.vr[i] = this.vr[l]!;
    this.drag[i] = this.drag[l]!;
    this.grav[i] = this.grav[l]!;
    this.attack[i] = this.attack[l]!;
    this.kind[i] = this.kind[l]!;
    this.tint[i] = this.tint[l]!;
    this.tex[i] = this.tex[l]!;
  }
}

export class Fx {
  readonly light = new Pool(1100, true);
  readonly matter = new Pool(420, false);
  private rnd = 1;

  /** Fast, deterministic-enough noise for effects (never the sim's RNG). */
  r(): number {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.r();
  }

  /** Low-level emit without an options object (the hot path). */
  put(add: boolean, kind: number, tex: Texture, x: number, y: number, vx: number, vy: number, life: number, s0: number, s1: number, alpha: number, tint: number, drag = 0, grav = 0, vr = 0, attack = 0): void {
    const p = add ? this.light : this.matter;
    const i = p.take();
    p.kind[i] = kind;
    p.tex[i] = tex;
    p.x[i] = x;
    p.y[i] = y;
    p.vx[i] = vx;
    p.vy[i] = vy;
    p.life[i] = p.max[i] = life;
    p.s0[i] = s0;
    p.s1[i] = s1;
    p.a0[i] = alpha;
    p.tint[i] = tint;
    p.rot[i] = this.r() * Math.PI * 2;
    p.vr[i] = vr;
    p.drag[i] = drag;
    p.grav[i] = grav;
    p.attack[i] = attack;
  }

  update(dt: number): void {
    this.light.update(dt);
    this.matter.update(dt);
  }

  draw(): void {
    this.light.draw();
    this.matter.draw();
  }

  clear(): void {
    this.light.clear();
    this.matter.clear();
    this.draw();
  }
}
