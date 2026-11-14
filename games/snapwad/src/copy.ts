/**
 * Everything the page says, in my voice: lowercase, handwritten, a little smug about the rubber band. Kept in one
 * place so the copy test can check every line against the plate it's drawn on.
 */
import { TOPPLE_N } from "./game.ts";
import type { Kind } from "./pieces.ts";

export const TITLE = "Snapwad";
export const SUBTITLE = "my doodles built forts on my textbooks";
export const TAP = "tap to play";
export const AGAIN = "tap to flick again";

/** Banners: [title, line under it]. */
export const LINES = {
  chainWad: ["+1 wad", "a chain pays a wad"],
  topple: ["big topple! +1 wad", `${TOPPLE_N} pieces off the books`],
  star: ["gold star!", "you earned the ruler: the next shot shows its whole flight"],
  starAgain: ["gold star!", "the ruler: the next shot shows its whole flight"],
  tape: ["a tape ball!", "for a one-shot page. it hits like a textbook"],
  tapeAgain: ["a tape ball!", "it's next in the pile"],
  drain: ["use it or lose it", "a wad uncrumples if you wait too long"],
  best: ["new best!", "keep flicking"],
  hint: ["pull back anywhere", "and let go. the band does the rest"],
  oneShot: ["one-shot page!", ""],
} as const satisfies Record<string, readonly [string, string]>;

/** The first time a run meets a desk thing. */
export const NEWS: Partial<Record<Kind, readonly [string, string]>> = {
  eraser: ["new: erasers", "heavy and bouncy. they don't break"],
  pad: ["new: sticky notes", "a hard hit bursts the pad"],
  ruler: ["new: my ruler", "long and stiff. knock out what holds it up"],
  cup: ["new: paper cups", "something's hiding under there"],
};

/** Little notes near the launcher and over the page. */
export const NOTES = {
  nudge: "pull back, let go",
  cancel: "let go in the middle: no shot",
  lastWad: "last wad... come on...",
  lastOne: "last one...",
  wadBack: "wad back!",
  plusWad: "+1 wad",
  full: "full!",
} as const;

/** The game-over card. */
export const CARD = {
  title: "what I knocked off:",
  nobody: "nobody. yet.",
  none: "nothing yet. pull back and let go",
  first: "first score in the notebook",
} as const;

export const pagesLine = (n: number): string => (n === 1 ? "1 page" : `${n} pages`);
export const statLine = (chain: number, oneShots: number, shots: number): string =>
  `best chain ×${Math.max(1, chain)} · ${oneShots} one-shot page${oneShots === 1 ? "" : "s"} · ${shots} wads`;
export const bestLine = (score: number, prev: number | null, isBest: boolean, fmt: (n: number) => string): string =>
  score <= 0 ? CARD.none : isBest ? (prev ? `new best! +${fmt(score - prev)} on your old one` : CARD.first) : `${Math.round(Math.min(1, score / (prev || 1)) * 100)}% of your best (${fmt(prev ?? 0)})`;
