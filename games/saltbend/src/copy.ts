/**
 * Every word Saltbend prints, in bitbybit's voice (lowercase, short, calm), and the one tip the game-over strip picks
 * from what actually happened in the run. Pure, so the tests can check that each line fits its plate.
 */
import { GRADE_WORDS, TIER_NAMES, type Grade, type RunStats } from "./sim.ts";

export const TITLE = "saltbend";
export const TAGLINE = "hold to swing into the bend";
export const TAGLINE_2 = "let go to straighten up";
export const PROMPT = "tap";
export const HINT_HOLD = "hold";
export const HINT_LET_GO = "let go";

/** The narrowest screen we lay out for (CSS px), and the plates measured against it. */
export const MIN_W = 360;
/** Text width inside the game-over strip on the narrowest screen in the feed (the action rail takes 72 px). */
export const STRIP_TEXT = MIN_W - 72 - 14 - 8 - 24;
/** Width a banner may take on the narrowest screen. */
export const BANNER_W = MIN_W - 36;
/** Sizes the strip and the banners are set in. */
export const TIP_PX = 12;
export const TIP_MIN_PX = 10.5;
export const STAT_PX = 12;
export const BANNER_PX = 34;
export const BANNER_SUB_PX = 13;

export const gradeWord = (g: Grade): string => GRADE_WORDS[g];
export const tierLine = (mult: number): string => `×${mult} · ${TIER_NAMES[mult - 1] ?? ""}`;
export const fmtKm = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** The best line the run drew. */
export function bestLine(st: RunStats): Grade | null {
  for (const g of ["paint", "kissed", "tight", "clean"] as const) if (st.grades[g] > 0) return g;
  return null;
}

export interface TipContext {
  stats: RunStats;
  /** Lemons the cart drove past without picking up. */
  lemonsMissed: number;
}

/** One tip, chosen from what happened: how the run ended first, then the habit that cost the most. */
export function tipFor({ stats: s, lemonsMissed }: TipContext): string {
  const graded = s.bends;
  const wide = s.grades.wide;
  if (s.end === "inside") return "let go sooner: a long hold cuts the inside.";
  if (s.end === "wide" && s.presses < Math.max(2, graded * 0.6)) return "press as each bend starts: one hold a bend.";
  if (s.end === "wide") return "hold a moment longer: the cart ran wide.";
  if (s.scrapes >= 3) return "the gravel slows you and ends the streak.";
  if (graded >= 4 && wide >= graded / 2) return "press a little earlier to tuck in.";
  if (graded >= 4 && s.grades.paint === 0) return "tuck right in: the painted edge pays most.";
  if (lemonsMissed >= 3) return "lemons lie on the inside line. hug it.";
  if (s.saves === 0 && s.gates >= 1) return "a clean line before a gate earns a crate.";
  return "each gate moves the day on. how far is night?";
}

/** Every tip the game can show (for the tests). */
export const ALL_TIPS = [
  "let go sooner: a long hold cuts the inside.",
  "press as each bend starts: one hold a bend.",
  "hold a moment longer: the cart ran wide.",
  "the gravel slows you and ends the streak.",
  "press a little earlier to tuck in.",
  "tuck right in: the painted edge pays most.",
  "lemons lie on the inside line. hug it.",
  "a clean line before a gate earns a crate.",
  "each gate moves the day on. how far is night?",
];

/** The strip's first line: distance, bends and the best line drawn. */
export function statLine(metres: number, st: RunStats): string {
  const b = bestLine(st);
  return `${fmtKm(metres)} · ${st.bends} bends${b ? ` · best ${gradeWord(b)}` : ""}`;
}

/** Under the bar. */
export function barLabel(isBest: boolean, score: number, prevBest: number | null, frac: number, fmt: (n: number) => string): string {
  if (isBest) return prevBest ? `new best · +${fmt(score - prevBest)}` : "first run on the coast";
  return `${Math.round(frac * 100)}% of your best`;
}
