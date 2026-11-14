/**
 * Every line the game writes from what happened: the coach, the game-over lines and the one hint picked from the
 * run. Pure, so the tests can check that each line fits its plate.
 */
import { TUNE, type Stats } from "./run.ts";

export const TITLE = "HOTBAND";
export const SUB = "FILL A ROW · STAY OUT OF THE RED";

/** The first-run coach: one move at a time, until each has been made once. */
export const COACH = ["DRAG TO SLIDE IT", "TAP TO TURN IT", "FLICK DOWN TO SLAM IT"] as const;

export const HINTS = {
  noSlam: "FLICK DOWN TO SLAM A PIECE HOME",
  noTurn: "TAP ANYWHERE TO TURN A PIECE",
  noRow: "LIGHT ALL EIGHT BANDS OF A ROW TO CUT IT",
  slow: "SLAM EARLY · THE NOISE FLOOR RISES ON A CLOCK",
  gaps: "LAY PIECES FLAT · A COVERED GAP BLOCKS ITS ROW",
  chain: `CUT AGAIN WITHIN TWO PIECES TO KEEP THE GAIN`,
  doubles: "STAND A BAR IN A TWO-ROW GAP FOR A DOUBLE CUT",
  noise: "DROP INTO THE DARK BAND TO CUT A NOISE ROW",
  hot: "ROWS CUT IN THE RED PAY EXTRA · IF YOU DARE",
  deep: `GAIN ×5 TAKES ${TUNE.tiers[3]} ROWS IN ONE CHAIN`,
} as const;

/** One concrete thing to try next time, picked from how this run went. */
export function hintFor(s: Stats): string {
  if (s.pieces >= 4 && s.slams === 0) return HINTS.noSlam;
  if (s.pieces >= 6 && s.turns === 0) return HINTS.noTurn;
  if (s.rows === 0) return HINTS.noRow;
  if (s.pieces > 0 && s.seconds / s.pieces > 2.4) return HINTS.slow;
  if (s.rows > 0 && s.left / Math.max(1, s.rows) > 9) return HINTS.gaps;
  if (s.bestGain < 2) return HINTS.chain;
  if (s.doubles + s.triples === 0) return HINTS.doubles;
  if (s.noisePushed >= 4 && s.noiseCut === 0) return HINTS.noise;
  if (s.hot === 0) return HINTS.hot;
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
        ? "NO SCORE YET · CUT ONE ROW"
        : score === prev
          ? `LEVEL WITH YOUR BEST · ${n(prev)}`
          : `BEST ${n(prev)} · ${n(prev - score)} TO GO`;
  const rows = s.rows === 1 ? "1 ROW" : `${s.rows} ROWS`;
  return [head, `${rows} · CHAIN ${s.bestChain} · GAIN ×${s.bestGain}`, `NEXT: ${hint}`];
}

/** Greedy word wrap by character count (the mono face has one advance width). */
export function wrapWords(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** How many mono characters of a size fit a width (TC Mono advances 0.6 em, plus the label tracking). */
export const charsFit = (width: number, size: number): number => Math.floor(width / (size * 0.6 + size * 0.08));
