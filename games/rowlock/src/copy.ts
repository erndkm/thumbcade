/**
 * Every line of copy the game writes from what happened: the grid's tag, the game-over lines and the one hint
 * picked from the run. Kept pure so the tests can check that each line fits its plate.
 */
import type { Puzzle } from "./gen.ts";
import type { Stats } from "./run.ts";
import { TECH } from "./solver.ts";
import { TIERS, TUNE } from "./run.ts";

/** How a grid is announced: today's warm-up, or its number, size and how hard it reads. */
export function gridTag(index: number, p: Puzzle, today: string): { text: string; daily: boolean } {
  if (index === 0) return { text: `TODAY'S GRID · ${today}`, daily: true };
  const word = p.grade >= TECH.nakedSingle ? "TRICKY" : p.grade >= TECH.hiddenLine ? "SHARP" : index === 1 ? "EASY" : index === 2 ? "STEADY" : "BRISK";
  return { text: `GRID ${index + 1} · ${p.shape.n}×${p.shape.n} · ${word}`, daily: false };
}

/** Every hint the game can give, so tests can measure them all. */
export const HINTS = {
  noGrid: "A LINE WITH ONE GAP: ITS DIGIT IS THE ONE MISSING",
  clashes: "A DIGIT ALREADY IN THE ROW CAN'T GO TWICE",
  slips: `EVERY WRONG DIGIT COSTS ${TUNE.wrong(1)}S · SURE BEATS FAST`,
  lamp: "YOU ENDED WITH A LAMP · TAP IT ON A HARD KEY",
  armed: "TAP A DIGIT FIRST, THEN EVERY KEY IT FITS",
  stuck: "STUCK? FIND A DIGIT WITH ONE HOME IN A BOX",
  combos: "SAVE THE KEY THAT CLOSES TWO LINES AT ONCE",
  streak: `${TIERS[2]} RIGHT IN A ROW IS ×3 · ${TIERS[3]} IS ×4`,
  deep: "LATE GRIDS HIDE THEIR MOVES: CHECK EACH KEY",
} as const;

/** One concrete thing to try next time, picked from how this run went. */
export function hintFor(s: Stats, lampsLeft: number): string {
  if (s.solved === 0) return HINTS.noGrid;
  if (s.wrong >= 4 && s.clashes >= 2) return HINTS.clashes;
  if (s.wrong >= 4) return HINTS.slips;
  if (lampsLeft > 0 && s.lampsUsed === 0) return HINTS.lamp;
  if (s.armed === 0 && s.digits >= 12) return HINTS.armed;
  if (s.marked > 0 || s.nudges >= 3) return HINTS.stuck;
  if (s.doubles + s.triples < 3) return HINTS.combos;
  if (s.bestStreak < TIERS[3]) return HINTS.streak;
  return HINTS.deep;
}

const n = (v: number) => v.toLocaleString("en-US");

/** The three lines of the game-over panel: against the best, what the run did, the hint. */
export function summaryLines(score: number, best: number | null, s: Stats, hint: string): [string, string, string] {
  const prev = best ?? 0;
  const head =
    score > prev && score > 0
      ? prev > 0
        ? `NEW BEST · ${n(score)} · +${n(score - prev)}`
        : `FIRST BEST · ${n(score)}`
      : prev <= 0
        ? "NO SCORE YET · ONE DIGIT PAYS"
        : score === prev
          ? `LEVEL WITH YOUR BEST · ${n(prev)}`
          : `BEST ${n(prev)} · ${n(prev - score)} TO GO`;
  const grids = s.solved === 1 ? "1 GRID" : `${s.solved} GRIDS`;
  return [head, `${grids} · ${s.locks} LOCKS · STREAK ${s.bestStreak}`, `NEXT: ${hint}`];
}

/** Departure Mono's advance in em, plus the 8 % letter spacing the kit's labels add. */
export const MONO_EM = 0.625 + 0.08;

/** How many label characters fit `width` px at `size` px. */
export const charsFit = (width: number, size: number): number => Math.floor(width / (size * MONO_EM));

/** Breaks `text` into lines of at most `max` characters, at spaces. */
export function wrapWords(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > max && line) {
      out.push(line);
      line = w;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** The game-over panel's box: above the caption, from the gutter to the action rail (the result card is above). */
export function summaryBox(W: number, H: number, ins: { left: number; right: number; bottom: number }, standalone: boolean, hintLines: number): { x: number; y: number; w: number; h: number } {
  const x = ins.left + 16;
  const w = W - ins.right - 4 - x;
  const bottom = standalone ? H - 16 : H - ins.bottom - 12;
  const h = 116 + 16 * Math.max(0, hintLines - 1);
  return { x, y: bottom - h, w, h };
}
