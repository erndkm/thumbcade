/**
 * Everything the page says, in my voice: lowercase, handwritten, very proud of the knight. Kept in one place so the
 * copy test can check every line against the scrap it is written on.
 */
import type { MonsterKind, Stats } from "./sim.ts";

export const TITLE = "Scribbledelve";
export const SUBTITLE = "my stick knight vs. the scribbles";
export const TAP = "tap to play";
export const AGAIN = "tap to delve again";

/** What I call the scribbles. */
export const NAMES: Record<MonsterKind, string> = { 0: "grumble", 1: "sneak", 2: "dither", 3: "lurk" };

/** Banners: [title, line under it]. */
export const LINES = {
  hint: ["swipe to run", "he keeps going and takes the next gap"],
  sword: ["a sword!", "now YOU chase THEM"],
  cleared: ["floor cleared!", ""],
  heart: ["floor cleared!", "and a heart back"],
  best: ["new best!", "keep delving"],
  star: ["a gold star!", "it won't stay long"],
  last: ["last heart...", "mind the red one"],
} as const satisfies Record<string, readonly [string, string]>;

/** Little notes written next to things as they happen. */
export const NOTES = {
  phew: "phew!",
  ouch: "ouch!",
  bonk: "bonk",
  poof: "poof!",
  streak: "coins in a row",
  streakLost: "streak gone",
  swordOut: "sword's blunt",
  starGone: "too slow!",
  over: "the end.",
} as const;

export const floorLine = (n: number): string => `floor ${n}`;

/** The game-over card. */
export const CARD = {
  title: "my knight's report:",
  none: "no coins yet. swipe and he runs",
  first: "first score in the maths book",
} as const;

export const statLine = (s: Stats, floor: number): string => `floor ${floor} · ${s.coins} coin${s.coins === 1 ? "" : "s"} · ${s.poofs} scribble${s.poofs === 1 ? "" : "s"} poofed`;
export const bestLine = (score: number, prev: number | null, isBest: boolean, fmt: (n: number) => string): string =>
  score <= 0 ? CARD.none : isBest ? (prev ? `new best! +${fmt(score - prev)} on your old one` : CARD.first) : `${Math.round(Math.min(1, score / (prev || 1)) * 100)}% of your best (${fmt(prev ?? 0)})`;

/** One thing to try next time, from what happened in the run. */
export function hintFor(s: Stats, floor: number): string {
  const caught = s.caughtBy.reduce((a, b) => a + b, 0);
  if (s.swipes === 0) return "swipe any way and he runs until a line stops him";
  if (s.coins < 12) return "keep him moving: the scribbles are slower than he is";
  if (s.swords > 0 && s.swordsWasted >= s.swords) return "a sword is for chasing: run AT them while it lasts";
  if (s.swords === 0 && floor <= 2) return "grab a sword when they close in: then they run from you";
  if (s.bumps > s.swipes * 0.3) return "swipe a little early: he takes the gap when he gets there";
  if (caught > 0 && s.caughtBy[1] >= caught * 0.5) return "sneak heads for where you're going: double back on it";
  if (caught > 0 && s.caughtBy[0] >= caught * 0.6) return "lead grumble round a loop, then cut the other way";
  if (s.maxMult < 3) return "sweep whole corridors: coins in a row pay double, then triple";
  return "save a sword for when two of them have you boxed in";
}
