import { SNAP_SPRING } from "@thumbcade/swipe-contract";

/**
 * A 1-D spring animator (the web twin of Reanimated's withSpring) driven by rAF.
 * Units are whatever you pass (px here); velocity in units/s.
 */
export class SpringValue {
  value: number;
  velocity = 0;
  target: number;
  private raf = 0;
  private last = 0;
  private onSettle: (() => void) | null = null;

  constructor(
    value: number,
    private readonly onChange: (v: number) => void,
    private readonly config: { stiffness: number; damping: number; mass: number } = SNAP_SPRING,
  ) {
    this.value = value;
    this.target = value;
  }

  /** Jump without animation. */
  set(v: number): void {
    this.stop();
    this.value = this.target = v;
    this.velocity = 0;
    this.onChange(v);
  }

  animateTo(target: number, velocity = this.velocity, onSettle?: () => void): void {
    this.target = target;
    this.velocity = velocity;
    this.onSettle = onSettle ?? null;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get animating(): boolean {
    return this.raf !== 0;
  }

  private step = (now: number) => {
    const dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    const { stiffness, damping, mass } = this.config;
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const force = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += (force / mass) * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < 0.4 && Math.abs(this.velocity) < 8) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = 0;
      this.onChange(this.value);
      const cb = this.onSettle;
      this.onSettle = null;
      cb?.();
      return;
    }
    this.onChange(this.value);
    this.raf = requestAnimationFrame(this.step);
  };
}
