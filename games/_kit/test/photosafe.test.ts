import { describe, expect, it } from "vitest";
import { hexToRgb } from "../src/color.ts";
import {
  desaturateRed,
  Flash,
  FLASH_MAX_ALPHA,
  isSaturatedRed,
  MAX_REPEAT_HZ,
  maxFlashesPerSecond,
  Photosafe,
  RED_FLASH_MAX_ALPHA,
  REDUCED_FLASH_MAX_ALPHA,
  REDUCED_REPEAT_HZ,
  redness,
  relativeLuminance,
  WCAG_MAX_FLASHES_PER_SECOND,
} from "../src/photosafe.ts";

const FPS = 60;
const DT = 1 / FPS;

/** Luminance of `hex` at `alpha` composited over a near-black scene, the worst case for a light flash. */
function overlayLum(hex: string, alpha: number, bg: [number, number, number] = [13, 13, 16]): number {
  const [r, g, b] = hexToRgb(hex);
  const c = (f: number, k: number) => k + (f - k) * alpha;
  return relativeLuminance(c(r, bg[0]), c(g, bg[1]), c(b, bg[2]));
}

/** Runs `seconds` at 60 fps, calling `each(frame)` before sampling the flash's overlay luminance. */
function runFlash(flash: Flash, seconds: number, each: (frame: number) => void): { lum: number[]; peak: number } {
  const lum: number[] = [];
  let peak = 0;
  for (let i = 0; i < seconds * FPS; i++) {
    each(i);
    flash.update(DT);
    peak = Math.max(peak, flash.alpha);
    lum.push(overlayLum(flash.color, flash.alpha));
  }
  return { lum, peak };
}

describe("flash counting (WCAG 2.3.1 definition)", () => {
  const square = (hz: number, seconds: number, lo: number, hi: number, rate = 240) =>
    Array.from({ length: seconds * rate }, (_, i) => (Math.floor((i / rate) * hz * 2) % 2 ? hi : lo));

  it("counts a pair of opposing changes as one flash", () => {
    expect(maxFlashesPerSecond(square(5, 3, 0, 0.6), 240)).toBe(5);
    expect(maxFlashesPerSecond(square(2, 3, 0, 0.6), 240)).toBe(2);
    expect(maxFlashesPerSecond([0, 0, 0.5, 0.5, 0], 60)).toBe(1);
  });

  it("ignores small swings and swings between two bright levels", () => {
    expect(maxFlashesPerSecond(square(8, 2, 0.1, 0.18), 240)).toBe(0);
    expect(maxFlashesPerSecond(square(8, 2, 0.85, 1), 240)).toBe(0);
    expect(maxFlashesPerSecond([], 60)).toBe(0);
  });
});

describe("red handling", () => {
  it("detects and desaturates saturated red", () => {
    expect(isSaturatedRed("#FF0000")).toBe(true);
    expect(isSaturatedRed("#FF4A3D")).toBe(false);
    expect(redness(desaturateRed("#FF0000"))).toBeLessThan(0.8);
    expect(desaturateRed("#FF4A3D")).toBe("#FF4A3D");
  });
});

describe("Flash", () => {
  it("a single flash is capped and fades out", () => {
    const f = new Flash(false, { alpha: 0.9 });
    expect(f.trigger("#FFFFFF")).toBe(true);
    const { peak } = runFlash(f, 1, () => undefined);
    expect(peak).toBeLessThanOrEqual(FLASH_MAX_ALPHA + 1e-9);
    expect(peak).toBeGreaterThan(FLASH_MAX_ALPHA * 0.8);
    expect(f.alpha).toBe(0);
    expect(f.active).toBe(false);
  });

  it("a white flash at the cap stays under a 10% luminance change over a dark scene", () => {
    expect(overlayLum("#FFFFFF", FLASH_MAX_ALPHA) - overlayLum("#FFFFFF", 0)).toBeLessThan(0.1);
  });

  it("triggering every frame never exceeds the repeat cap, let alone WCAG's three a second", () => {
    const f = new Flash(false);
    const { lum } = runFlash(f, 4, () => f.trigger("#FFFFFF"));
    // Count every visible flash, not just WCAG-sized ones.
    const n = maxFlashesPerSecond(lum, FPS, 0.01);
    expect(n).toBeLessThanOrEqual(MAX_REPEAT_HZ);
    expect(n).toBeLessThan(WCAG_MAX_FLASHES_PER_SECOND);
  });

  it("red-dominant colors get a lower cap and saturated red is never drawn", () => {
    const f = new Flash(false, { alpha: 1 });
    f.trigger("#FF0000");
    const { peak } = runFlash(f, 0.2, () => undefined);
    expect(peak).toBeLessThanOrEqual(RED_FLASH_MAX_ALPHA + 1e-9);
    expect(isSaturatedRed(f.color)).toBe(false);
  });

  it("a stronger event during the rise wins without a second flash", () => {
    const f = new Flash(false, { alpha: 0.2 });
    f.trigger("#FFFFFF", 0.3);
    f.update(0.01);
    expect(f.trigger("#FFFFFF", 1)).toBe(false);
    f.update(0.02);
    expect(f.alpha).toBeGreaterThan(0.2 * 0.3);
  });

  it("under reduced motion it is a faint, slow tint at most once a second", () => {
    const f = new Flash(true, { alpha: 0.25 });
    const { lum, peak } = runFlash(f, 4, () => f.trigger("#FFFFFF"));
    expect(peak).toBeLessThanOrEqual(REDUCED_FLASH_MAX_ALPHA + 1e-9);
    expect(maxFlashesPerSecond(lum, FPS, 0.005)).toBeLessThanOrEqual(1);
    // No hard edge: the tint takes several frames to arrive.
    const g = new Flash(true);
    g.trigger("#FFFFFF");
    g.update(DT);
    expect(g.alpha).toBeLessThan(REDUCED_FLASH_MAX_ALPHA * 0.25);
  });

  it("can be switched off entirely under reduced motion", () => {
    const f = new Flash(true, { reduced: "off" });
    const { peak } = runFlash(f, 1, () => f.trigger("#FFFFFF"));
    expect(peak).toBe(0);
    // ...but not at default settings.
    const g = new Flash(false, { reduced: "off" });
    expect(g.trigger("#FFFFFF")).toBe(true);
  });

  it("draws only while visible and restores globalAlpha", () => {
    const calls: Array<[number, string]> = [];
    const fake = { globalAlpha: 0.7, fillStyle: "", fillRect: () => calls.push([fake.globalAlpha, fake.fillStyle]) };
    const ctx = fake as unknown as CanvasRenderingContext2D;
    const f = new Flash(false);
    f.draw(ctx, 10, 10);
    expect(calls).toHaveLength(0);
    f.trigger("#F3F0E8");
    f.update(0.05);
    f.draw(ctx, 10, 10);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe("#F3F0E8");
    expect(ctx.globalAlpha).toBe(0.7);
  });
});

describe("Photosafe pulse and flicker", () => {
  const sample = (fn: (t: number) => number, seconds: number, rate = 240) =>
    Array.from({ length: seconds * rate }, (_, i) => fn(i / rate));

  it("caps pulse frequency at 2 Hz, or 0.5 Hz under reduced motion", () => {
    const def = new Photosafe(false);
    const red = new Photosafe(true);
    expect(def.hz(10)).toBe(MAX_REPEAT_HZ);
    expect(def.hz(1.2)).toBe(1.2);
    expect(red.hz(10)).toBe(REDUCED_REPEAT_HZ);
    expect(maxFlashesPerSecond(sample((t) => def.pulse(t, 12), 4), 240, 0.1)).toBeLessThanOrEqual(MAX_REPEAT_HZ);
    expect(maxFlashesPerSecond(sample((t) => red.pulse(t, 12), 6), 240, 0.1)).toBeLessThanOrEqual(1);
    const p = sample((t) => def.pulse(t, 1.5, { phase: 1 }), 2);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...p)).toBeLessThanOrEqual(1);
  });

  it("holds still under reduced motion when asked", () => {
    const red = new Photosafe(true);
    expect(new Set(sample((t) => red.pulse(t, 3, { still: 0.6 }), 2))).toEqual(new Set([0.6]));
    expect(new Photosafe(false).pulse(0.1, 3, { still: 0.6 })).not.toBe(0.6);
  });

  it("flicker dips at most twice a second, smoothly, within its depth", () => {
    const def = new Photosafe(false);
    for (let seed = 0; seed < 24; seed++) {
      const s = sample((t) => def.flicker(t, seed * 5, { chance: 0.9, depth: 0.6 }), 12);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(maxFlashesPerSecond(s, 240, 0.02)).toBeLessThanOrEqual(MAX_REPEAT_HZ);
      // Smooth: no frame-to-frame jump bigger than a fraction of the depth at 60 fps.
      const f = sample((t) => def.flicker(t, seed, { chance: 0.9, depth: 0.6 }), 4, FPS);
      for (let i = 1; i < f.length; i++) expect(Math.abs(f[i]! - f[i - 1]!)).toBeLessThan(0.3);
    }
    // A higher requested rate is still capped.
    const fast = sample((t) => def.flicker(t, 3, { chance: 1, rate: 30 }), 6);
    expect(maxFlashesPerSecond(fast, 240, 0.02)).toBeLessThanOrEqual(MAX_REPEAT_HZ);
  });

  it("flicker actually happens at default settings and is steady under reduced motion", () => {
    const def = sample((t) => new Photosafe(false).flicker(t, 1), 20);
    expect(Math.min(...def)).toBeLessThan(0.9);
    expect(new Set(sample((t) => new Photosafe(true).flicker(t, 1), 20))).toEqual(new Set([1]));
  });

  it("is deterministic per seed and decorrelated across seeds", () => {
    const p = new Photosafe(false);
    const a = sample((t) => p.flicker(t, 2), 10, 30);
    expect(sample((t) => p.flicker(t, 2), 10, 30)).toEqual(a);
    expect(sample((t) => p.flicker(t, 7), 10, 30)).not.toEqual(a);
  });

  it("builds flashes that inherit the reduced-motion flag", () => {
    expect(new Photosafe(true).flash().reduced).toBe(true);
    expect(new Photosafe(false).flash().reduced).toBe(false);
  });
});
