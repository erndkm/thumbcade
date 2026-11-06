/**
 * The sky's day: time of day 0..1 (dawn → noon → golden → dusk → night → pre-dawn → dawn).
 * Warm peach and rose by day, deep teal by night. Every color in the game comes from here.
 */
import { hexToRgb } from "@thumbcade-games/kit/color";

export interface Sky {
  top: string;
  mid: string;
  horizon: string;
  /** Sun or moon disc. */
  disc: string;
  fog: string;
  /** Nearest silhouettes: the playfield. */
  ink: string;
  /** How strongly lanterns and fireflies glow (0..1). */
  glow: number;
  stars: number;
  /** 0 = pale text on light sky reads dark, 1 = text turns pale. */
  night: number;
}

interface Key {
  t: number;
  top: string;
  mid: string;
  horizon: string;
  disc: string;
  fog: string;
  ink: string;
  glow: number;
  stars: number;
  night: number;
}

const KEYS: Key[] = [
  { t: 0.0, top: "#E39F86", mid: "#F2C3A3", horizon: "#FBE3C6", disc: "#FFF4E0", fog: "#F5D4B8", ink: "#2A1A1D", glow: 0.55, stars: 0, night: 0 },
  { t: 0.1, top: "#B9C6B4", mid: "#E2D9BE", horizon: "#F8ECD4", disc: "#FFF8EA", fog: "#EDE3CC", ink: "#1E2024", glow: 0.35, stars: 0, night: 0 },
  { t: 0.2, top: "#8EC2BF", mid: "#C3DDD5", horizon: "#F0EFDD", disc: "#FFFEF6", fog: "#E0E8DA", ink: "#15232A", glow: 0.22, stars: 0, night: 0 },
  { t: 0.33, top: "#86B2AC", mid: "#DCCB9E", horizon: "#F7D79E", disc: "#FFEAB8", fog: "#EBD3A4", ink: "#1E1916", glow: 0.45, stars: 0, night: 0 },
  { t: 0.43, top: "#A85E58", mid: "#D98B78", horizon: "#F4BE90", disc: "#FFD7A2", fog: "#E5A68C", ink: "#1C0F13", glow: 0.8, stars: 0, night: 0.1 },
  { t: 0.51, top: "#173B40", mid: "#8A5A50", horizon: "#E39868", disc: "#FFC58A", fog: "#A86F5C", ink: "#120C0F", glow: 0.95, stars: 0.35, night: 0.7 },
  { t: 0.6, top: "#0A2B2F", mid: "#134147", horizon: "#2B6865", disc: "#E8F1E2", fog: "#22504F", ink: "#050D10", glow: 1, stars: 1, night: 1 },
  { t: 0.86, top: "#0B2E31", mid: "#17474B", horizon: "#33706A", disc: "#E8F1E2", fog: "#27585A", ink: "#060E11", glow: 1, stars: 1, night: 1 },
  { t: 0.94, top: "#17393B", mid: "#5D7A70", horizon: "#E8B595", disc: "#FFEBD2", fog: "#A99282", ink: "#1A1517", glow: 0.8, stars: 0.3, night: 0.6 },
  { t: 1.0, top: "#E39F86", mid: "#F2C3A3", horizon: "#FBE3C6", disc: "#FFF4E0", fog: "#F5D4B8", ink: "#2A1A1D", glow: 0.55, stars: 0, night: 0 },
];

const cache = new Map<string, [number, number, number]>();
function rgb(hex: string): [number, number, number] {
  let v = cache.get(hex);
  if (!v) cache.set(hex, (v = hexToRgb(hex)));
  return v;
}

const hx = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** Linear mix of two #RRGGBB colors. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return `#${hx(r1 + (r2 - r1) * t)}${hx(g1 + (g2 - g1) * t)}${hx(b1 + (b2 - b1) * t)}`;
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function skyAt(tod: number): Sky {
  const t = ((tod % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.t <= t) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const k = smooth((t - a.t) / (b.t - a.t));
  return {
    top: mixHex(a.top, b.top, k),
    mid: mixHex(a.mid, b.mid, k),
    horizon: mixHex(a.horizon, b.horizon, k),
    disc: mixHex(a.disc, b.disc, k),
    fog: mixHex(a.fog, b.fog, k),
    ink: mixHex(a.ink, b.ink, k),
    glow: a.glow + (b.glow - a.glow) * k,
    stars: a.stars + (b.stars - a.stars) * k,
    night: a.night + (b.night - a.night) * k,
  };
}

/** Sun (0..0.52) then moon (0.55..0.97): which disc, and how high it stands (0 = on the horizon, 1 = high). */
export function discAt(tod: number): { moon: boolean; rise: number; drift: number } {
  const t = ((tod % 1) + 1) % 1;
  if (t < 0.53) {
    // Already up at dawn (a run starts at sunrise), high at noon, gone by late dusk.
    const u = t / 0.53;
    const rise = u < 0.38 ? 0.34 + 0.66 * Math.sin((u / 0.38) * (Math.PI / 2)) : Math.cos(((u - 0.38) / 0.62) * (Math.PI / 2)) * 1.05 - 0.05;
    return { moon: false, rise, drift: u };
  }
  const u = (t - 0.55) / 0.42;
  return { moon: true, rise: u < 0 || u > 1 ? -0.3 : Math.sin(u * Math.PI), drift: Math.max(0, Math.min(1, u)) };
}

/** Lantern light, warm in every hour. */
export const LAMP = "#FFC27A";
export const LAMP_CORE = "#FFE9C4";
export const SEED = "#FFF0BE";
export const PALE = "#F4EEDF";
