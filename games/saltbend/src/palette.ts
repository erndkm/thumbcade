/**
 * Saltbend's three inks and its day. Teal is the sea and the key plate, sunflower the sun, the sand and the lemons,
 * red the terracotta: roofs, gravel, the cart's stripes. The day never changes an ink; it changes how much of each the
 * printer lays down. Morning prints light, the golden hour washes everything in sunflower, sunset adds red, and the
 * night prints teal and red heavy over everything, so the only paper left is what the lamps light.
 *
 * Pure, so the tests and the pilot can read the stages too.
 */
import { lerp } from "@thumbcade-games/kit/ease";
import { GATE_M } from "./road.ts";
import { PAPER, RISO, type Ink } from "./riso.ts";

export { PAPER };
export const TEAL = "teal";
export const SUN = "sun";
export const RED = "red";
export const PLATES = [TEAL, SUN, RED] as const;
export type PlateName = (typeof PLATES)[number];

export const INKS: Ink[] = [
  { name: TEAL, color: RISO.teal, angle: 0.26 },
  { name: SUN, color: RISO.sunflower, angle: 0.79 },
  { name: RED, color: RISO.red, angle: 1.31 },
];

export interface Sky {
  /** Sea coverage: teal, and red for depth at dusk and night. */
  sea: number;
  seaRed: number;
  /** A wash over the whole print, per plate (golden hour, sunset, night). */
  washTeal: number;
  washSun: number;
  washRed: number;
  /** Shadow strength and length (m per m of height), and the sun's bearing on the map (rad). */
  shade: number;
  shadowLen: number;
  sunBearing: number;
  /** 0 day … 1 night: headlamp, cat's eyes, lit windows, stars on the sea. */
  night: number;
  /** Glitter on the water toward the sun. */
  glitter: number;
}

interface Key extends Sky {
  t: number;
}

const KEYS: Key[] = [
  { t: 0.0, sea: 0.42, seaRed: 0, washTeal: 0, washSun: 0.02, washRed: 0, shade: 0.28, shadowLen: 1.0, sunBearing: 0.4, night: 0, glitter: 0.3 },
  { t: 0.18, sea: 0.48, seaRed: 0, washTeal: 0, washSun: 0, washRed: 0, shade: 0.3, shadowLen: 0.45, sunBearing: 1.2, night: 0, glitter: 0.15 },
  { t: 0.36, sea: 0.5, seaRed: 0.02, washTeal: 0, washSun: 0.05, washRed: 0, shade: 0.3, shadowLen: 0.8, sunBearing: 2.0, night: 0, glitter: 0.25 },
  { t: 0.5, sea: 0.5, seaRed: 0.08, washTeal: 0, washSun: 0.15, washRed: 0.03, shade: 0.32, shadowLen: 1.5, sunBearing: 2.5, night: 0, glitter: 0.8 },
  { t: 0.62, sea: 0.54, seaRed: 0.2, washTeal: 0.02, washSun: 0.16, washRed: 0.13, shade: 0.34, shadowLen: 2.3, sunBearing: 2.8, night: 0.12, glitter: 1 },
  { t: 0.71, sea: 0.66, seaRed: 0.3, washTeal: 0.22, washSun: 0.04, washRed: 0.14, shade: 0.2, shadowLen: 1.5, sunBearing: 3.0, night: 0.6, glitter: 0.2 },
  { t: 0.8, sea: 0.9, seaRed: 0.36, washTeal: 0.6, washSun: 0, washRed: 0.26, shade: 0.12, shadowLen: 0.6, sunBearing: 3.6, night: 1, glitter: 0 },
  { t: 0.9, sea: 0.84, seaRed: 0.28, washTeal: 0.5, washSun: 0.02, washRed: 0.2, shade: 0.14, shadowLen: 0.6, sunBearing: 4.2, night: 0.9, glitter: 0 },
  { t: 0.96, sea: 0.5, seaRed: 0.12, washTeal: 0.08, washSun: 0.1, washRed: 0.08, shade: 0.24, shadowLen: 1.6, sunBearing: 0.2, night: 0.25, glitter: 0.6 },
  { t: 1.0, sea: 0.42, seaRed: 0, washTeal: 0, washSun: 0.02, washRed: 0, shade: 0.28, shadowLen: 1.0, sunBearing: 0.4, night: 0, glitter: 0.3 },
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
  return {
    sea: m("sea"),
    seaRed: m("seaRed"),
    washTeal: m("washTeal"),
    washSun: m("washSun"),
    washRed: m("washRed"),
    shade: m("shade"),
    shadowLen: m("shadowLen"),
    sunBearing: m("sunBearing"),
    night: m("night"),
    glitter: m("glitter"),
  };
}

/** The time of day a cart reaches at `s` metres: every gate moves the day on by DAY_PER_GATE. */
export const DAY_START = 0.04;
export const DAY_PER_GATE = 0.13;
export const todAt = (s: number): number => DAY_START + (Math.max(0, s) / GATE_M) * DAY_PER_GATE;

export type Scenery = "terraces" | "pines" | "salt" | "cape" | "harbour" | "cypress";

export interface Stage {
  name: string;
  /** What grows on the land side, and how wide the land is (m) before the sea comes back. */
  scenery: Scenery;
  land: number;
  /** The rocky strip on the sea side (m). */
  cliff: number;
}

/** The stretch after gate n − 1 (stage 0 is the harbour start). Names are lowercase, like everything bitbybit sets. */
export const STAGES: Stage[] = [
  { name: "the harbour", scenery: "harbour", land: 30, cliff: 3.2 },
  { name: "lemon terraces", scenery: "terraces", land: 34, cliff: 2.6 },
  { name: "pine point", scenery: "pines", land: 30, cliff: 4 },
  { name: "the salt pans", scenery: "salt", land: 9, cliff: 1.6 },
  { name: "lighthouse cape", scenery: "cape", land: 26, cliff: 5 },
  { name: "cypress row", scenery: "cypress", land: 32, cliff: 2.4 },
  { name: "moon harbour", scenery: "harbour", land: 30, cliff: 3 },
  { name: "the long horizon", scenery: "salt", land: 8, cliff: 1.4 },
];

/** The stage at `s` metres: the harbour until gate 1, then one per gate, looping after the long horizon. */
export function stageAt(s: number): { index: number; stage: Stage } {
  const g = Math.floor(Math.max(0, s) / GATE_M);
  const index = g === 0 ? 0 : ((g - 1) % (STAGES.length - 1)) + 1;
  return { index, stage: STAGES[index]! };
}
