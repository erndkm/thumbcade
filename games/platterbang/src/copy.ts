/**
 * Copy picked from what happened in a run, in juicefactory's all-caps voice. Pure, so the tests can check that every
 * line fits the plate it is printed on.
 */
import { bungeeWidth } from "./metrics.ts";
import type { Ending, RunStats } from "./run.ts";

export const TIPS = {
  magnet: "TAP THE MAGNET BEFORE IT FILLS!",
  match: "PULL PEGS THAT MATCH A JAR FIRST!",
  covered: "PEGS UNDER A DISH WON'T BUDGE!",
  wall: "CLEAR THE WALL FOR BONUS TIME!",
  streak: "SHIP AND SMASH FAST FOR ×3!",
  next: "WATCH THE NEXT JAR: SAVE ITS PEGS!",
  smash: "LAST PEG OUT DROPS THE DISH!",
} as const;

/** One tip for next time, from how the run went. */
export function tipFor(s: RunStats, why: Ending, magnetsHeld: number): string {
  if (why === "full" && magnetsHeld > 0) return TIPS.magnet;
  if (why === "full") return TIPS.match;
  if (s.coveredTaps >= 3) return TIPS.covered;
  if (s.walls === 0) return TIPS.wall;
  if (s.bestMult < 3) return TIPS.streak;
  if (s.peakShelf >= 4) return TIPS.next;
  return TIPS.smash;
}

/** The largest size up to `size` at which `text` fits `width` px (never below `min`). */
export function fitSize(text: string, size: number, width: number, min = 10): number {
  const w = bungeeWidth(text, size);
  return w <= width ? size : Math.max(min, Math.floor((size * width) / w));
}

/** Width a burst sticker needs around text `w` px wide at `size` (the jagged edge included). */
export const burstWidth = (w: number, size: number): number => w + size * 2;
