import type { TextStyle } from "react-native";
import {
  colors,
  durations,
  fontFamily,
  layout,
  radius,
  space,
  springs,
  textStyles,
  type TextStyleName,
} from "@thumbcade/design-tokens";
import { safeAccent } from "@thumbcade/protocol";

/** The app is dark-only in v1. */
export const c = colors.dark;
export { durations, layout, radius, space, springs };

const cache = new Map<TextStyleName, TextStyle>();

/** RN text style for a design-token text style. */
export function type(name: TextStyleName): TextStyle {
  const hit = cache.get(name);
  if (hit) return hit;
  const t = textStyles[name];
  const style: TextStyle = {
    fontFamily: fontFamily.native[t.family],
    fontSize: t.size,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    ...("uppercase" in t && t.uppercase ? { textTransform: "uppercase" as const } : null),
  };
  cache.set(name, style);
  return style;
}

/** A game's accent, or paper when the accent falls below 3:1 on ink. */
export function accentOf(hex: string | null | undefined): string {
  return safeAccent(hex ?? "", c.surface, c.text);
}

/** Hex color with alpha (0-1). */
export function alpha(hex: string, a: number): string {
  const v = hex.replace("#", "");
  const n = Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${v.slice(0, 6)}${n}`;
}

/** Readable text color on top of an arbitrary fill. */
export function onColor(hex: string): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? c.onAccent : c.text;
}
