/** Small color utilities for canvas games. Colors are #RRGGBB strings. */

export function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** Linear mix of two colors (t = 0 -> a, 1 -> b). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`;
}

/** Lighten (amount > 0) or darken (amount < 0) toward white/black. */
export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mix(hex, "#ffffff", amount) : mix(hex, "#000000", -amount);
}

/** HSL (h in degrees, s/l 0-1) to #RRGGBB. */
export function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${toHex(f(0) * 255)}${toHex(f(8) * 255)}${toHex(f(4) * 255)}`;
}

/** Shared chrome colors (mirror @thumbcade/design-tokens) so games feel at home in the feed. */
export const INK = "#0D0D10";
export const INK0 = "#000000";
export const PAPER = "#F3F0E8";
export const PAPER_DIM = "#A7A3AE";
export const VOLT = "#D4FF3D";
export const HEAT = "#FF4A3D";
