/**
 * Trauma-based screen shake (shake = trauma²) with smooth pseudo-noise, plus hit-stop.
 * Respect reduced motion: pass `reduced` and the shake is scaled way down.
 */
export class Shake {
  trauma = 0;
  private t = 0;
  constructor(
    public maxOffset = 14,
    public maxAngle = 0.035,
    public decay = 1.6,
    public reduced = false,
  ) {}
  /** Adds trauma (0-1). Big hits ~0.5, small taps ~0.15. */
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
  }
  /** Current offset. Apply with ctx.translate(x, y) / ctx.rotate(angle). */
  get offset(): { x: number; y: number; angle: number } {
    const s = this.trauma * this.trauma * (this.reduced ? 0.15 : 1);
    if (s <= 0) return { x: 0, y: 0, angle: 0 };
    const n = (seed: number) =>
      Math.sin(this.t * 37.3 + seed) * 0.6 + Math.sin(this.t * 61.7 + seed * 2.1) * 0.4;
    return { x: this.maxOffset * s * n(1.3), y: this.maxOffset * s * n(7.9), angle: this.maxAngle * s * n(4.2) };
  }
}

/** Freezes time for a few frames on impact. Feed every dt through `scale()`. */
export class HitStop {
  private left = 0;
  freeze(seconds: number): void {
    this.left = Math.max(this.left, seconds);
  }
  scale(dt: number): number {
    if (this.left <= 0) return dt;
    this.left -= dt;
    return this.left > 0 ? 0 : -this.left;
  }
  get active(): boolean {
    return this.left > 0;
  }
}
