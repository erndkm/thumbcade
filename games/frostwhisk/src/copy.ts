import { textWidth } from "./font.ts";

/**
 * Text for the attract and game-over panels. They centre in the preview-safe area left of the action rail (106 of 130
 * art px on a phone) and keep a margin from it and from the rink's boards, so a fixed 78 px panel fits with room to
 * spare; with its padding and outline every line must fit in PANEL_TEXT.
 */
export const PANEL_TEXT = 74;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The first candidate that fits the panel. */
export function fit(cands: string[], width = PANEL_TEXT): string {
  return cands.find((c) => textWidth(c) <= width) ?? cands[cands.length - 1]!;
}

export interface OverStats {
  moved: number;
  goals: number;
  against: number;
  banks: number;
  zingers: number;
  bestStreak: number;
  kos: number;
}

/** One tip for the game-over panel, picked from how the run went. */
export function overHint(s: Omit<OverStats, "kos"> & { kos?: number }, critter: number): string {
  if (s.moved < 2) return "drag to move!";
  if (s.goals === 0) return "swing through it";
  if (s.against >= s.goals + 2) return "guard your den";
  if (s.banks === 0) return "try a bank shot";
  if (s.zingers === 0) return "swing harder!";
  if (critter === 1) return "aim past bramble";
  if (critter >= 3) return "bank past ember";
  return "six in a row: x4";
}

/**
 * The three lines of the game-over panel: what you did, how it compares with your best (in words; there is no bar to
 * decode), and a tip.
 */
export function overLines(s: OverStats, critter: number, score: number, best: number | null, champion: boolean, bonus: number): [string, string, string] {
  const line1 = champion
    ? fit([`champion! +${fmt(bonus)}`, "pond champion!"])
    : s.kos > 0
      ? fit([`beat ${s.kos} · streak ${s.bestStreak}`, `beat ${s.kos} · ${plural(s.goals, "goal")}`, `beat ${plural(s.kos, "critter")}`])
      : fit([`${plural(s.goals, "goal")} · streak ${s.bestStreak}`, plural(s.goals, "goal")]);
  const isBest = score > 0 && (best === null || score > best);
  const line2 = isBest
    ? best && best > 0
      ? fit([`new best! +${fmt(score - best)}`, "new best!"])
      : "first best!"
    : best && best > 0
      ? score === best
        ? "level with best"
        : `${Math.min(99, Math.round((score / best) * 100))}% of your best`
      : "no goals yet";
  return [line1, line2, fit([overHint(s, critter)])];
}
