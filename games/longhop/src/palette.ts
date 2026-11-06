/**
 * Longhop's three inks and its day. The day never changes an ink: it changes how much of each ink the printer
 * lays down (halftone coverage). Afternoon is a pale sky over red earth, sunset floods the horizon with orange
 * and sunflower, night is federal blue printed heavy with the paper showing through as stars.
 */
import { lerp } from "@thumbcade-games/kit/ease";
import { PAPER, RISO, type Ink } from "./riso.ts";

export { PAPER };
export const BLUE = "blue";
export const ORANGE = "orange";
export const SUN = "sun";

/** Plate order matters only for registration: the blue key plate stays put. */
export const INKS: Ink[] = [
  { name: BLUE, color: RISO.federal, angle: 0.26 },
  { name: ORANGE, color: RISO.orange, angle: 1.31 },
  { name: SUN, color: RISO.sunflower, angle: 0.79 },
];

export interface Sky {
  /** Blue coverage at the top of the sky and at the horizon. */
  blueTop: number;
  blueLow: number;
  /** Orange and sunflower coverage at the horizon (they fade out going up). */
  orange: number;
  sun: number;
  /** How red the sun disc prints (orange over sunflower). */
  sunRed: number;
  /** 0 day … 1 night: stars, moon, heavier shadows. */
  night: number;
  /** Blue over the red earth. */
  shade: number;
  /** Heat shimmer at the horizon (afternoon only). */
  heat: number;
}

interface Key extends Sky {
  t: number;
}

const KEYS: Key[] = [
  { t: 0.0, blueTop: 0.3, blueLow: 0.06, orange: 0.05, sun: 0.22, sunRed: 0.08, night: 0, shade: 0.1, heat: 0.7 },
  { t: 0.14, blueTop: 0.32, blueLow: 0.05, orange: 0.16, sun: 0.4, sunRed: 0.2, night: 0, shade: 0.12, heat: 1 },
  { t: 0.26, blueTop: 0.38, blueLow: 0.07, orange: 0.36, sun: 0.6, sunRed: 0.45, night: 0, shade: 0.16, heat: 0.6 },
  { t: 0.33, blueTop: 0.52, blueLow: 0.12, orange: 0.62, sun: 0.55, sunRed: 0.75, night: 0.12, shade: 0.24, heat: 0.1 },
  { t: 0.41, blueTop: 0.74, blueLow: 0.36, orange: 0.4, sun: 0.22, sunRed: 0.8, night: 0.6, shade: 0.4, heat: 0 },
  { t: 0.5, blueTop: 0.9, blueLow: 0.68, orange: 0.1, sun: 0.05, sunRed: 0.5, night: 1, shade: 0.56, heat: 0 },
  { t: 0.82, blueTop: 0.9, blueLow: 0.7, orange: 0.08, sun: 0.04, sunRed: 0.5, night: 1, shade: 0.56, heat: 0 },
  { t: 0.92, blueTop: 0.62, blueLow: 0.26, orange: 0.46, sun: 0.36, sunRed: 0.6, night: 0.42, shade: 0.32, heat: 0 },
  { t: 1.0, blueTop: 0.3, blueLow: 0.06, orange: 0.05, sun: 0.22, sunRed: 0.08, night: 0, shade: 0.1, heat: 0.7 },
];

const smooth = (t: number) => t * t * (3 - 2 * t);

export function skyAt(tod: number): Sky {
  const t = ((tod % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.t <= t) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const k = smooth((t - a.t) / (b.t - a.t));
  const m = (f: keyof Sky) => lerp(a[f], b[f], k);
  return { blueTop: m("blueTop"), blueLow: m("blueLow"), orange: m("orange"), sun: m("sun"), sunRed: m("sunRed"), night: m("night"), shade: m("shade"), heat: m("heat") };
}

/**
 * Where the sun stands: it sets ahead of you (to the right), and after the night it comes up behind you.
 * `rise` 1 = high, 0 = sitting on the horizon, < 0 = gone. `x` is a fraction of the screen width.
 */
export function sunAt(tod: number): { rise: number; x: number } {
  const t = ((tod % 1) + 1) % 1;
  if (t < 0.4) return { rise: lerp(0.62, -0.25, smooth(t / 0.4)), x: lerp(0.5, 0.66, t / 0.4) };
  if (t > 0.9) return { rise: lerp(-0.25, 0.62, smooth((t - 0.9) / 0.1)), x: lerp(0.36, 0.5, (t - 0.9) / 0.1) };
  return { rise: -1, x: 0.5 };
}

/** The moon crosses the night sky right to left. */
export function moonAt(tod: number): { rise: number; x: number } {
  const t = ((tod % 1) + 1) % 1;
  if (t < 0.42 || t > 0.9) return { rise: -1, x: 0 };
  const u = (t - 0.42) / 0.48;
  return { rise: Math.sin(u * Math.PI) * 1.1 - 0.1, x: lerp(0.78, 0.22, u) };
}
