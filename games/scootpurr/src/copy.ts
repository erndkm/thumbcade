import { textWidth } from "./font.ts";
import { TUNE, type Stats } from "./run.ts";

/**
 * Every line the game writes. The attract and game-over panels centre in the preview-safe area left of the action
 * rail (106 of 130 art px on a phone) with a margin, so a fixed 80 px panel fits; with its padding every line must
 * fit in PANEL_TEXT. Banners and hint plates centre on the screen during play.
 */
export const PANEL_TEXT = 74;
export const BANNER_TEXT = 104;

export const TITLE = "scootpurr";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The first candidate that fits. */
export function fit(cands: string[], width = PANEL_TEXT): string {
  return cands.find((c) => textWidth(c) <= width) ?? cands[cands.length - 1]!;
}

/** The first-run plates: what a tap does, then which way a cat goes. */
export const TEACH = [
  ["tap a cat whose", "way is clear ~"],
  ["a cat scoots the", "way its nose points"],
] as const;

export const LINES = {
  clear: "rug clear!",
  clean: "not one bump",
  last: "witch's cat last",
  bump: "pff!",
  out: "the candle's out",
  best: "new best!",
  past: "past your best ~",
  hurry: "the candle's low!",
} as const;

/** Every tip the game-over panel can give, so the tests can measure them all. */
export const HINTS = {
  none: "tap a cat!",
  noRug: "free cats first",
  bumps: "mind the noses",
  slow: "edge cats first",
  last: "black cat last",
  streak: `${TUNE.tiers[1]} in a row: x3`,
  deep: "bumps cost purr",
} as const;

/** One tip, picked from how the run actually went. */
export function hintFor(s: Stats): string {
  if (s.cats === 0) return HINTS.none;
  if (s.rugs === 0) return HINTS.noRug;
  if (s.bumps >= 4 && s.bumps * 5 >= s.cats) return HINTS.bumps;
  if (s.cats / Math.max(1, s.seconds) < 0.45) return HINTS.slow;
  if (s.lastOut * 2 < s.rugs) return HINTS.last;
  if (s.bestStreak < TUNE.tiers[1]!) return HINTS.streak;
  return HINTS.deep;
}

/** The three lines of the game-over panel: against the best, what the run did, the tip. */
export function overLines(score: number, best: number | null, s: Stats): [string, string, string] {
  const prev = best ?? 0;
  const head =
    score > prev && score > 0
      ? fit(prev > 0 ? [`new best! +${fmt(score - prev)}`, "new best!"] : [`first best: ${fmt(score)}`, "first best!"])
      : prev <= 0
        ? "no cats out yet"
        : fit([`${fmt(prev - score)} short of best`, `${fmt(prev - score)} off best`, `best ${fmt(prev)}`]);
  const rugs = s.rugs === 1 ? "1 rug" : `${s.rugs} rugs`;
  const mid = fit([`${rugs} ~ ${s.cats} cats out`, `${rugs} ~ ${s.cats} cats`, `${rugs}, ${s.cats} cats`, `${s.cats} cats out`]);
  return [head, mid, hintFor(s)];
}
