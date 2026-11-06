/**
 * Photosensitivity-safe flashes, flicker and pulses.
 *
 * Every launch game routes its "light" effects through here so none of them can strobe:
 *
 * - Always (WCAG 2.3.1, "Three Flashes or Below Threshold"): repeating effects (flicker, pulses) are capped at
 *   2 Hz, full-screen flashes are rate-limited to one per 0.5 s with a capped peak alpha, red-dominant flashes
 *   get a lower cap, and saturated red (R / (R+G+B) >= 0.8) is desaturated before it can cover the screen.
 * - Under reduced motion (`session.reducedMotion`): flicker is steady, pulses slow to 0.5 Hz (or hold still),
 *   and full-screen flashes become a faint, slow tint at most once per second (or are dropped).
 */
import { clamp } from "./ease.ts";
import { hexToRgb, mix } from "./color.ts";

/** WCAG 2.3.1: never more than three flashes in any one second. */
export const WCAG_MAX_FLASHES_PER_SECOND = 3;
/** Cap for anything that repeats (flicker, pulses, blinking warnings), comfortably under WCAG. */
export const MAX_REPEAT_HZ = 2;
/** Under reduced motion, repeating effects slow down to this. */
export const REDUCED_REPEAT_HZ = 0.5;
/** Peak alpha of a full-screen overlay flash. Over a dark scene a 25% white overlay stays under a 10% luminance change. */
export const FLASH_MAX_ALPHA = 0.25;
/** Peak alpha for red-dominant flash colors (R is at least half of R+G+B). */
export const RED_FLASH_MAX_ALPHA = 0.18;
/** Peak alpha of a full-screen flash under reduced motion: a tint, not a flash. */
export const REDUCED_FLASH_MAX_ALPHA = 0.08;
/** Shortest gap between two full-screen flashes (default / reduced motion), in seconds. */
export const FLASH_MIN_INTERVAL = 1 / MAX_REPEAT_HZ;
export const REDUCED_FLASH_MIN_INTERVAL = 1;

const TAU = Math.PI * 2;

/** R / (R + G + B) of a #RRGGBB color (0 for black). WCAG treats >= 0.8 as saturated red. */
export function redness(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const sum = r + g + b;
  return sum === 0 ? 0 : r / sum;
}

export const isSaturatedRed = (hex: string): boolean => redness(hex) >= 0.8;

/** Mixes saturated red toward white until it no longer counts as saturated red; other colors pass through. */
export function desaturateRed(hex: string): string {
  if (!isSaturatedRed(hex)) return hex;
  for (let t = 0.05; t < 1; t += 0.05) {
    const c = mix(hex, "#ffffff", t);
    if (redness(c) < 0.7) return c;
  }
  return "#ffffff";
}

/** WCAG relative luminance (0-1) of an sRGB color given as 0-255 channels. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * The most flashes in any one-second window of a luminance series sampled at `sampleHz`, per WCAG: a flash is a
 * pair of opposing changes of at least `threshold` (default 0.1) where the darker side is below 0.8.
 * Used by the kit's tests and by frame-sampling probes.
 */
export function maxFlashesPerSecond(lum: ArrayLike<number>, sampleHz: number, threshold = 0.1): number {
  const n = lum.length;
  if (n < 2) return 0;
  const at: number[] = [];
  const leg = (from: number, to: number, i: number) => {
    if (Math.abs(to - from) >= threshold && Math.min(from, to) < 0.8) at.push(i);
  };
  // Zig-zag through the series: a turning point counts once the signal has come back by `threshold`.
  let lo = lum[0]!;
  let hi = lum[0]!;
  let dir = 0;
  let ref = lum[0]!;
  let ext = lum[0]!;
  let extI = 0;
  for (let i = 1; i < n; i++) {
    const v = lum[i]!;
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= threshold) [dir, ref, ext, extI] = [1, lo, v, i];
      else if (hi - v >= threshold) [dir, ref, ext, extI] = [-1, hi, v, i];
    } else if (dir > 0 ? v > ext : v < ext) {
      ext = v;
      extI = i;
    } else if (Math.abs(ext - v) >= threshold) {
      leg(ref, ext, extI);
      [dir, ref, ext, extI] = [-dir, ext, v, i];
    }
  }
  if (dir !== 0) leg(ref, ext, extI);
  let best = 0;
  for (let a = 0, b = 0; a < at.length; a++) {
    while (b < at.length && at[b]! - at[a]! < sampleHz) b++;
    best = Math.max(best, Math.floor((b - a) / 2));
  }
  return best;
}

/** Small integer hash -> [0, 1). Deterministic, no allocation. */
function hash01(n: number, seed: number): number {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(Math.round(seed * 997) | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export interface PulseOptions {
  /** Phase offset in radians. */
  phase?: number;
  /** Under reduced motion, hold this value (0-1) instead of pulsing slowly. */
  still?: number;
}

export interface FlickerOptions {
  /** How far a dip dims (0-1, default 0.4). The result never goes below 1 - depth. */
  depth?: number;
  /** Chance that a given slot holds a dip (default 0.25). */
  chance?: number;
  /** Dip slots per second, capped at MAX_REPEAT_HZ (default 2). */
  rate?: number;
}

export interface FlashOptions {
  /** Peak alpha at strength 1. Clamped to FLASH_MAX_ALPHA (RED_FLASH_MAX_ALPHA for red-dominant colors). */
  alpha?: number;
  /** Seconds to fade out (default 0.3). */
  decay?: number;
  /** Under reduced motion: "fade" (default) = a faint, slow tint; "off" = no flash at all. */
  reduced?: "fade" | "off";
}

/**
 * A full-screen (or large-area) flash: `trigger()` on the event, `update(dt)` every frame, `draw()` last.
 * Triggers closer together than the minimum interval are folded into the flash already showing, so a burst of
 * events can never strobe.
 */
export class Flash {
  private age = Infinity;
  private clock = 0;
  private lastStart = -Infinity;
  private peak = 0;
  private hex = "#ffffff";
  private readonly cap: number;
  private readonly attack: number;
  private readonly decay: number;
  private readonly minInterval: number;
  private readonly off: boolean;

  constructor(
    readonly reduced = false,
    o: FlashOptions = {},
  ) {
    const decay = Math.max(0.05, o.decay ?? 0.3);
    this.off = reduced && o.reduced === "off";
    this.cap = clamp(o.alpha ?? FLASH_MAX_ALPHA, 0, reduced ? REDUCED_FLASH_MAX_ALPHA : FLASH_MAX_ALPHA);
    this.attack = reduced ? 0.15 : 0.03;
    this.decay = reduced ? Math.max(0.6, decay * 2) : decay;
    this.minInterval = reduced ? REDUCED_FLASH_MIN_INTERVAL : FLASH_MIN_INTERVAL;
  }

  /** Starts a flash of `color` (#RRGGBB) at `strength` (0-1). Returns false if it was folded or suppressed. */
  trigger(color: string, strength = 1): boolean {
    if (this.off) return false;
    const safe = desaturateRed(color);
    const cap = redness(safe) >= 0.5 ? Math.min(this.cap, RED_FLASH_MAX_ALPHA) : this.cap;
    const peak = cap * clamp(strength);
    if (peak <= 0) return false;
    if (this.clock - this.lastStart < this.minInterval) {
      // Still rising: let the stronger event win without a second on/off cycle.
      if (this.age < this.attack && peak > this.peak) this.peak = peak;
      return false;
    }
    this.hex = safe;
    this.peak = peak;
    this.age = 0;
    this.lastStart = this.clock;
    return true;
  }

  update(dt: number): void {
    this.clock += dt;
    this.age += dt;
  }

  /** Current overlay alpha (0 when idle). */
  get alpha(): number {
    const a = this.age;
    if (a < this.attack) return this.peak * (a / this.attack);
    const k = (a - this.attack) / this.decay;
    if (k >= 1) return 0;
    return this.peak * (1 - k) * (1 - k);
  }

  /** The (red-safe) color of the current flash. */
  get color(): string {
    return this.hex;
  }

  get active(): boolean {
    return this.alpha > 0;
  }

  /** Fills x, y, w, h (default: the whole w×h canvas from the origin) with the current flash. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, x = 0, y = 0): void {
    const a = this.alpha;
    if (a <= 0.002) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = a;
    ctx.fillStyle = this.hex;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = prev;
  }

  reset(): void {
    this.age = Infinity;
    this.peak = 0;
  }
}

/**
 * One place per game for anything that blinks, flickers or pulses. Build it from `session.reducedMotion`.
 *
 *   const light = new Photosafe(session.reducedMotion);
 *   ctx.globalAlpha = 0.55 * light.flicker(time, i);           // neon sign
 *   const k = light.pulse(time, 1.5);                           // warning glow, 0-1
 *   const flash = light.flash({ alpha: 0.22 }); flash.trigger(PAL.paper); ... flash.draw(ctx, W, H);
 */
export class Photosafe {
  constructor(readonly reduced = false) {}

  /** `hz` capped for this player (2 Hz, or 0.5 Hz under reduced motion). */
  hz(hz: number): number {
    return Math.min(Math.abs(hz), this.reduced ? REDUCED_REPEAT_HZ : MAX_REPEAT_HZ);
  }

  /** 0-1 sine pulse at `hz` (capped). Under reduced motion it is slow, or holds `still`. */
  pulse(t: number, hz: number, o: PulseOptions = {}): number {
    if (this.reduced && o.still !== undefined) return clamp(o.still);
    return 0.5 + 0.5 * Math.sin(t * this.hz(hz) * TAU + (o.phase ?? 0));
  }

  /**
   * Neon-style flicker as a brightness multiplier in [1 - depth, 1]: occasional smooth dips, at most two a
   * second. `seed` decorrelates lights from each other. Steady (always 1) under reduced motion.
   */
  flicker(t: number, seed = 0, o: FlickerOptions = {}): number {
    if (this.reduced) return 1;
    const rate = Math.min(Math.max(0.01, o.rate ?? MAX_REPEAT_HZ), MAX_REPEAT_HZ);
    const x = t * rate + hash01(7, seed);
    const slot = Math.floor(x);
    if (hash01(slot, seed) >= (o.chance ?? 0.25)) return 1;
    // A raised-cosine dip over the middle 40% of the slot: one smooth off/on, never two.
    const d = (x - slot - 0.3) / 0.4;
    if (d <= 0 || d >= 1) return 1;
    const depth = clamp(o.depth ?? 0.4) * (0.6 + 0.4 * hash01(slot, seed + 101));
    return 1 - depth * (0.5 - 0.5 * Math.cos(d * TAU));
  }

  /** A full-screen flash that follows these rules. */
  flash(o: FlashOptions = {}): Flash {
    return new Flash(this.reduced, o);
  }
}
