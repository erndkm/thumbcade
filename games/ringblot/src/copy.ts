/**
 * Every word Ringblot prints, in bitbybit's voice (lowercase, short, calm), the sizes they are set in, and the one
 * tip the game-over strip picks from what happened in the run. Pure, so the tests can check every line against the
 * plate it is printed on with Jost's real advance widths.
 */
import { PULLS, type Stats } from "./sim.ts";

export const TITLE = "ringblot";
export const TAGLINE = "walk a loop and come home";
export const TAGLINE_2 = "the press prints inside it";
export const PROMPT = "tap";
export const HINT = "swipe";
export const HINT_LINE = "out, round, and home again";

/** The narrowest screen we lay out for (CSS px), and the plates measured against it. */
export const MIN_W = 360;
/** Text width inside the game-over strip on the narrowest screen in the feed (the action rail takes 72 px). */
export const STRIP_TEXT = MIN_W - 72 - 14 - 8 - 24;
/** Width a banner may take on the narrowest screen. */
export const BANNER_W = MIN_W - 36;
/** Width of the two HUD tickets on the narrowest screen (they share the top row with a gap between). */
export const SCORE_W = 190;
export const SHEET_W = 124;
export const TIP_PX = 12;
export const TIP_MIN_PX = 10.5;
export const STAT_PX = 12;
export const BANNER_PX = 34;
export const BANNER_SUB_PX = 13;
export const POP_PX = 16;

export const sheetLine = (n: number): string => `sheet ${n}`;
export const shareLine = (share: number, goal: number): string => `${Math.floor(share * 100)} / ${Math.round(goal * 100)} %`;
export const goalLine = (goal: number): string => `print ${Math.round(goal * 100)} % of it`;
export const printedSub = (bonus: number, clean: boolean, fmt: (n: number) => string): string => `+${fmt(bonus)}${clean ? " · not one smudge" : ""}`;

/** What a loop is called by what it pays a square. */
export const PULL_WORDS = ["", "", "good pull", "big pull", "huge pull"] as const;
export const pullLine = (pts: number, tier: number, fmt: (n: number) => string): string => (tier >= 2 ? `${PULL_WORDS[tier]} ×${tier}  +${fmt(pts)}` : `+${fmt(pts)}`);

/** Banners: [word, line under it]. */
export const LINES = {
  smudged: ["smudged", "back to where the line began"],
  boxed: ["boxed in", "the line can't get home"],
  best: ["new best", ""],
  low: ["the ink is drying", ""],
  dry: ["dry", ""],
} as const satisfies Record<string, readonly [string, string]>;

/** Small words printed beside things as they happen. */
export const NOTES = {
  smudge: "smudged it",
  shave: "close shave",
  ink: "ink",
  back: "it's back",
} as const;

export const statLine = (sheet: number, s: Stats, fmt: (n: number) => string): string => `sheet ${sheet} · ${fmt(s.squares)} square${s.squares === 1 ? "" : "s"} · ${s.smudges} smudged`;
export const barLabel = (isBest: boolean, score: number, prev: number | null, frac: number, fmt: (n: number) => string): string =>
  score <= 0 ? "nothing printed yet" : isBest ? (prev ? `new best, by ${fmt(score - prev)}` : "first print on the wall") : `${Math.round(frac * 100)}% of your best ${fmt(prev ?? 0)}`;

/** One tip, chosen from what happened: the thing that cost the most first. */
export function tipFor(s: Stats, sheet: number, seconds: number): string {
  if (s.swipes === 0) return TIPS.swipe;
  if (s.prints === 0) return TIPS.home;
  if (s.selfCuts >= 2) return TIPS.boxed;
  if (s.smudged >= 2 && s.longestLine >= 14) return TIPS.long;
  if (s.smudged >= 2) return TIPS.near;
  if (s.stillTicks > seconds * 120 * 0.3) return TIPS.still;
  if (s.biggest < PULLS[0]) return TIPS.small;
  if (s.smudges === 0 && sheet >= 2) return TIPS.cut;
  if (s.bestTier < 3) return TIPS.bigger;
  return TIPS.corners;
}

export const TIPS = {
  swipe: "swipe any way: it walks till the paper ends.",
  home: "walk off your ink, round, and back onto it.",
  boxed: "your own wet line is a wall. leave a way home.",
  long: "a long line is easy to cut. print in shorter loops.",
  near: "come home when a rival heads for your line.",
  still: "keep walking: the ink dries while you stand.",
  small: `a loop of ${PULLS[0]} squares or more pays double.`,
  cut: "walk across a rival's wet line: its print is gone.",
  bigger: `loops of ${PULLS[1]} pay triple, ${PULLS[2]} four times.`,
  corners: "print the empty corners first, then steal.",
} as const;

/** Every tip the game can show (for the tests). */
export const ALL_TIPS: string[] = Object.values(TIPS);
