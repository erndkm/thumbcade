/**
 * The time of day as ink coverage: how much of each plate the sky, the hills and the water take. The day turns
 * with the height climbed: morning, a long golden afternoon, a pink dusk, a deep teal night, and dawn again.
 */

export interface Sky {
  /** Teal screen over the whole sky (0 by day, dense at night). */
  tealSky: number;
  /** Bands at the horizon: yellow and pink coverage. */
  yellowBand: number;
  pinkBand: number;
  /** Sun: height above the horizon (0..1) and how much yellow overprints it. Below 0 it has set. */
  sun: number;
  sunGold: number;
  moon: number;
  stars: number;
  /** Extra teal over water and hills (dusk and night). */
  dark: number;
  /** 0 by day, 1 at night: text turns to paper. */
  night: number;
}

interface Key extends Sky {
  t: number;
}

const KEYS: Key[] = [
  { t: 0.0, tealSky: 0.0, yellowBand: 0.18, pinkBand: 0.12, sun: 0.55, sunGold: 0.0, moon: 0, stars: 0, dark: 0, night: 0 },
  { t: 0.18, tealSky: 0.0, yellowBand: 0.12, pinkBand: 0.0, sun: 0.85, sunGold: 0.0, moon: 0, stars: 0, dark: 0, night: 0 },
  { t: 0.34, tealSky: 0.0, yellowBand: 0.32, pinkBand: 0.05, sun: 0.55, sunGold: 0.35, moon: 0, stars: 0, dark: 0.03, night: 0 },
  { t: 0.46, tealSky: 0.08, yellowBand: 0.4, pinkBand: 0.3, sun: 0.18, sunGold: 0.6, moon: 0, stars: 0, dark: 0.1, night: 0.1 },
  { t: 0.54, tealSky: 0.35, yellowBand: 0.15, pinkBand: 0.35, sun: -0.15, sunGold: 0.3, moon: 0.2, stars: 0.3, dark: 0.22, night: 0.6 },
  { t: 0.62, tealSky: 0.62, yellowBand: 0.0, pinkBand: 0.06, sun: -0.4, sunGold: 0, moon: 1, stars: 1, dark: 0.32, night: 1 },
  { t: 0.86, tealSky: 0.62, yellowBand: 0.0, pinkBand: 0.06, sun: -0.4, sunGold: 0, moon: 1, stars: 1, dark: 0.32, night: 1 },
  { t: 0.94, tealSky: 0.2, yellowBand: 0.1, pinkBand: 0.3, sun: -0.05, sunGold: 0.1, moon: 0.2, stars: 0.2, dark: 0.12, night: 0.4 },
  { t: 1.0, tealSky: 0.0, yellowBand: 0.18, pinkBand: 0.12, sun: 0.55, sunGold: 0.0, moon: 0, stars: 0, dark: 0, night: 0 },
];

const smooth = (t: number) => t * t * (3 - 2 * t);

export function skyAt(tod: number): Sky {
  const t = ((tod % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.t <= t) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const k = smooth((t - a.t) / (b.t - a.t));
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    tealSky: m(a.tealSky, b.tealSky),
    yellowBand: m(a.yellowBand, b.yellowBand),
    pinkBand: m(a.pinkBand, b.pinkBand),
    sun: m(a.sun, b.sun),
    sunGold: m(a.sunGold, b.sunGold),
    moon: m(a.moon, b.moon),
    stars: m(a.stars, b.stars),
    dark: m(a.dark, b.dark),
    night: m(a.night, b.night),
  };
}
