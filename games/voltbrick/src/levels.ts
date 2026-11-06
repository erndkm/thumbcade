/**
 * Brick layouts, 9 columns. Digits 1-5 = brick tier (color + points), A = armored (2 hits),
 * B = reinforced (3 hits), "." = empty. After the last layout the set repeats, faster.
 */
export const COLS = 9;

export const LEVELS: string[][] = [
  ["111111111", "222222222", "333333333", "444444444", "555555555"],
  ["....1....", "...222...", "..33333..", ".4444444.", "555555555", "A.A.A.A.A"],
  ["1.2.3.4.5", "1.2.3.4.5", "A.A.A.A.A", "5.4.3.2.1", "5.4.3.2.1"],
  ["....A....", "...121...", "..23432..", ".3455543.", "..23432..", "...121...", "....A...."],
  ["BBBBBBBBB", "B1111111B", "B2222222B", "B3333333B", "AAAAAAAAA"],
  ["55.444.55", "5..4.4..5", "..33333..", "2.2.2.2.2", "111111111", "A..AAA..A"],
  ["A1A1A1A1A", "2B2B2B2B2", "3A3A3A3A3", "4B4B4B4B4", "5A5A5A5A5"],
];

export interface BrickSpec {
  col: number;
  row: number;
  tier: number;
  hp: number;
}

export function parseLevel(index: number): BrickSpec[] {
  const layout = LEVELS[index % LEVELS.length]!;
  const out: BrickSpec[] = [];
  layout.forEach((line, row) => {
    for (let col = 0; col < COLS; col++) {
      const ch = line[col] ?? ".";
      if (ch === ".") continue;
      if (ch === "A") out.push({ col, row, tier: 6, hp: 2 });
      else if (ch === "B") out.push({ col, row, tier: 7, hp: 3 });
      else out.push({ col, row, tier: Number(ch), hp: 1 });
    }
  });
  return out;
}

/** Colors per tier (1-5 bright, 6 armored and 7 reinforced: smoked glass). */
export const TIER_COLORS: Record<number, string> = {
  1: "#4DF0FF",
  2: "#4D8DFF",
  3: "#9B7BFF",
  4: "#FF5FC8",
  5: "#FFB547",
  6: "#5E6889",
  7: "#434B69",
};

export const TIER_POINTS: Record<number, number> = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 6: 60, 7: 90 };
