/** Easing, interpolation and smoothing helpers. Pure functions, no allocation. */

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number =>
  lerp(b0, b1, clamp(invLerp(a0, a1, v)));

/** Frame-rate independent exponential smoothing toward `target` (`lambda` ~ 1/s responsiveness). */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Shortest-path angle damping. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
}

export const smoothstep = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

export const easeInQuad = (t: number) => t * t;
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeOutBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
export const easeOutElastic = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

/** A damped spring you can step every frame. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  constructor(
    value = 0,
    public stiffness = 260,
    public damping = 22,
  ) {
    this.value = value;
    this.target = value;
  }
  update(dt: number): number {
    // Semi-implicit Euler with sub-steps keeps stiff springs stable at low frame rates.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  kick(velocity: number): void {
    this.velocity += velocity;
  }
  snap(value: number): void {
    this.value = this.target = value;
    this.velocity = 0;
  }
  get settled(): boolean {
    return Math.abs(this.value - this.target) < 1e-3 && Math.abs(this.velocity) < 1e-3;
  }
}

/** A one-shot tween you advance manually. */
export class Tween {
  t = 0;
  constructor(
    public duration: number,
    public ease: (t: number) => number = easeOutCubic,
  ) {}
  update(dt: number): number {
    this.t = Math.min(this.duration, this.t + dt);
    return this.value;
  }
  get value(): number {
    return this.ease(this.duration <= 0 ? 1 : this.t / this.duration);
  }
  get done(): boolean {
    return this.t >= this.duration;
  }
  reset(): void {
    this.t = 0;
  }
}
