import { loadFontFaces } from "@thumbcade-games/kit/font-faces";
import italicUrl from "@thumbcade-games/kit/assets/fonts/library/instrument-serif/InstrumentSerif-Italic.woff2?url";
import regularUrl from "@thumbcade-games/kit/assets/fonts/library/instrument-serif/InstrumentSerif-Regular.woff2?url";

/** Loads Instrument Serif as "QM Serif" (regular + italic). Resolves after at most `timeoutMs` either way. */
export function loadSerif(timeoutMs = 1500): Promise<void> {
  return loadFontFaces(
    [
      { family: "QM Serif", url: regularUrl, descriptors: { style: "normal", weight: "400" } },
      { family: "QM Serif", url: italicUrl, descriptors: { style: "italic", weight: "400" } },
    ],
    timeoutMs,
  );
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 41 → "forty-one", 154 → "a hundred and fifty-four". Numbers past 999 stay numerals. */
export function words(n: number): string {
  n = Math.max(0, Math.floor(n));
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)]!;
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const head = h === 1 ? "a hundred" : `${ONES[h]} hundred`;
    return n % 100 ? `${head} and ${words(n % 100)}` : head;
  }
  return n.toLocaleString("en-US");
}

const ROMAN: Array<[number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

/** Lowercase roman numerals, the way a book numbers its chapters. */
export function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** Day of the year (1-366, UTC): the column's issue number. */
export function issueNumber(date = new Date()): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}
