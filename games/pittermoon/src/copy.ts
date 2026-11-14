import { textWidth } from "./font.ts";
import type { RunStats } from "./run.ts";

/**
 * Text for the attract and game-over panels. They centre in the preview-safe area left of the action rail (106 of 130
 * art px on a phone) with a margin, so a fixed 80 px panel fits; with its padding every line must fit in PANEL_TEXT.
 */
export const PANEL_TEXT = 74;
/** Banners centre on the screen during play: lines up to this wide. */
export const BANNER_TEXT = 104;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The first candidate that fits. */
export function fit(cands: string[], width = PANEL_TEXT): string {
  return cands.find((c) => textWidth(c) <= width) ?? cands[cands.length - 1]!;
}

export interface OverRun {
  rows: number;
  score: number;
  stats: RunStats;
}

const bonked = (s: RunStats) => s.bonks.broom + s.bonks.pumpkin + s.bonks.yarn + s.bonks.wisp;

/** One tip for the game-over panel, picked from how the run actually went. */
export function overHint(r: OverRun): string {
  const s = r.stats;
  if (s.taps + s.swipes === 0) return "tap to pad up!";
  if (s.swipes === 0 && (s.bumps >= 2 || bonked(s) >= 2)) return "swipe sideways!";
  if (s.splashes >= 2 && s.edges >= 1) return "boats drift off!";
  if (s.splashes >= 2) return "ride the boats";
  if (s.sinks >= 2) return "toadstools sink!";
  if (s.bonks.broom >= 3) return "wait for a gap";
  if (s.bonks.pumpkin >= 3) return "pumpkins roll on";
  if (s.bonks.yarn >= 2) return "yarn is quick!";
  if (s.bonks.wisp >= 2) return "wisps wobble!";
  if (s.caughtWaiting) return "keep padding on";
  if (s.maxTier < 1) return "6 quick hops: x2";
  if (s.fish === 0) return "fish are worth it";
  if (s.lifts === 0 && s.fish >= 2) return "5 fish: a lift!";
  if (s.maxTier < 3) return "x4 at 30 hops";
  if (s.whiskers < 3) return "close calls pay";
  return "the hill goes on";
}

/** The three lines of the game-over panel: the climb, the best in words (the bar shows it too), and a tip. */
export function overLines(r: OverRun, best: number | null): [string, string, string] {
  const fish = r.stats.fish;
  const line1 = fit([`row ${r.rows} · ${fish} fish`, `row ${r.rows}`]);
  const isBest = r.score > 0 && (best === null || r.score > best);
  const line2 = isBest
    ? best && best > 0
      ? fit([`new best! +${fmt(r.score - best)}`, "new best!"])
      : "first best!"
    : best && best > 0
      ? r.score === best
        ? "level with best"
        : `${Math.min(99, Math.round((r.score / best) * 100))}% of your best`
      : "no rows yet";
  return [line1, line2, fit([overHint(r)])];
}

/** The banner for a zoomies tier. */
export const TIER_LINES = ["", "pitter-pat!", "scamper!", "zoomies!"] as const;
export const TIER_SUBS = ["", "quick hops x2", "quick hops x3", "quick hops x4"] as const;
