import type { ScoreConfig } from "./manifest.ts";

/** 999 -> "999", 1234 -> "1.2K", 3_400_000 -> "3.4M". */
export function formatCount(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (v: number, suffix: string) => {
    const s = v >= 100 ? Math.floor(v).toString() : (Math.floor(v * 10) / 10).toString();
    return `${sign}${s.replace(/\.0$/, "")}${suffix}`;
  };
  if (abs < 1000) return `${n}`;
  if (abs < 1_000_000) return fmt(abs / 1000, "K");
  if (abs < 1_000_000_000) return fmt(abs / 1_000_000, "M");
  return fmt(abs / 1_000_000_000, "B");
}

/** Renders a score according to the game's score config. */
export function formatScore(score: number, config?: Pick<ScoreConfig, "format" | "unit">): string {
  if (config?.format === "ms") {
    const s = score / 1000;
    return s < 60 ? `${s.toFixed(2)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  }
  const grouped = Math.round(score).toLocaleString("en-US");
  return config?.unit ? `${grouped}${config.unit}` : grouped;
}

/**
 * A playtime for humans: "8.4 s", "12 min", "3.5 h", "1.2K h". Never rounds up past the truth: the parts
 * are floored, so "1 min" means at least a minute.
 */
export function formatPlaytime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s < 10 ? (Math.floor(s * 10) / 10).toString() : Math.floor(s)} s`;
  const min = s / 60;
  if (min < 60) {
    const whole = Math.floor(min);
    const rest = Math.floor(s - whole * 60);
    return whole < 10 && rest > 0 ? `${whole} min ${rest} s` : `${whole} min`;
  }
  const h = min / 60;
  if (h < 100) return `${(Math.floor(h * 10) / 10).toString()} h`;
  return `${formatCount(Math.floor(h))} h`;
}

/** "now", "3m", "2h", "5d", "3w", then a short date. */
export function formatRelative(date: Date | string | number, now: number = Date.now()): string {
  const t = typeof date === "object" ? date.getTime() : new Date(date).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Parses a #RRGGBB color into [r, g, b] 0-255. */
export function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent to use for a game's UI tints on ink: the game's own accent when it reaches 3:1
 * against the backdrop, otherwise the fallback (paper).
 */
export function safeAccent(accent: string, background = "#0D0D10", fallback = "#F3F0E8"): string {
  return /^#[0-9A-Fa-f]{6}$/.test(accent) && contrastRatio(accent, background) >= 3 ? accent : fallback;
}

/** Deterministic 32-bit hash (FNV-1a) — used for avatar seeds and daily seeds. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Same value for every player on a given UTC day. */
export function dailySeedFor(date: Date = new Date()): number {
  return hash32(date.toISOString().slice(0, 10));
}
