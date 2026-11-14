/**
 * The words on the summary slip, as pure functions of the run, so the tests can check every line fits its plate.
 * The slip sits in the band between the shell's result card and the caption, about 270 pt wide on the narrowest
 * phone, so every line is short.
 */
import { words } from "./qm/type.ts";
import { multiplier, type RunStats, type Slip, TUNE } from "./run.ts";

/** One thing to try next time, picked from what actually happened in the run. */
export function hintFor(s: RunStats, last: Slip): string {
  if (s.unknown >= 3 && s.words === 0) return "only real words are written down.";
  if (s.struckReuse >= 4) return "struck keys are out of it. leave them.";
  if (s.samePlace >= 2) return "move an underlined letter along.";
  if (s.shortWrites >= 3) return "write once all five places are set.";
  if (s.pencilIdleLines >= 4 && s.pencilsUsed === 0) return "the pencil writes a right letter in.";
  if (s.words === 0 && last.lines.length >= 3) return "the rings stay put. build round them.";
  if (s.words === 0) return "a solve buys time back. the quick most.";
  if (s.misses > 0) return "a sixth line that misses costs time.";
  if (s.words >= 2 && s.bestStreak < 2) return `two solves in ${words(TUNE.cleanLines)} or fewer: ×2.`;
  if (s.solvedLines / Math.max(1, s.words) > 4.2) return "open with five common letters.";
  if (s.pencilsEarned === 0) return `solve in ${words(TUNE.pencilAt)} lines for a pencil.`;
  return "each slip gives a little less back.";
}

/** Points against the best. */
export function pointsLine(score: number, best: number | null, isBest: boolean): string {
  const pts = score.toLocaleString("en-US");
  if (score <= 0) return "no points yet. a ring is a start.";
  if (isBest) return best === null || best <= 0 ? `${pts} points. the first on file.` : `${pts} points. a best, by ${(score - best).toLocaleString("en-US")}.`;
  if (best !== null && score === best) return `${pts} points. level with your best.`;
  return `${pts} points. ${((best ?? 0) - score).toLocaleString("en-US")} shy of your best.`;
}

/** How the slips went. */
export function statsLine(s: RunStats): string {
  if (s.words === 0) return `lines written: ${words(s.linesWritten)}`;
  const m = multiplier(s.bestStreak);
  return `${words(s.words)} solved · best in ${words(s.fewest)}${m > 1 ? ` · ×${m}` : ""}`;
}

/** Today's slip, and the line that sends its marks. */
export function dailyLine(lines: number, shared: "no" | "asking" | "yes"): [label: string, send: string] {
  const label = lines ? `today: ${words(lines)} ${lines === 1 ? "line" : "lines"} · ` : "today: unsolved · ";
  return [label, shared === "yes" ? "sent" : shared === "asking" ? "opening…" : "send ›"];
}
