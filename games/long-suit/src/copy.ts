/**
 * Every line the game writes. Kept pure so the tests can set each one in Instrument Serif's own widths and check
 * it fits where it goes.
 */
import { RANK_WORDS } from "./cards.ts";
import { roman, words } from "./qm/type.ts";
import { TUNE, type Stats } from "./run.ts";

export const TITLE = "Long Suit";
export const DEK = "red on black, one lower. send every suit home.";
export const kicker = (issue: number): string => `no. ${issue} · patience`;
export const PROMPT = "tap to begin";

const n = (v: number) => Math.round(v).toLocaleString("en-US");

/** The first-run plates, in order: what a tap does, how a column is built, where the cards are going. */
export const TEACH = ["tap a card: it goes where it fits", "red on black, one lower", "aces go home, then up in suit"] as const;

export const LINES = {
  dead: "no way home from here. dealt afresh.",
  turned: "the pack is turned",
  time: "time",
  past: "past your best",
  best: "a new best",
} as const;

/** How a deal is announced: its number and the pack it uses. */
export function dealLine(level: number, ranks: number): string {
  return `deal ${roman(level + 1)} · ace to ${RANK_WORDS[ranks - 1]}`;
}

/** A new multiplier. */
export function tierLine(chain: number, mult: number): string {
  return `${words(chain)} home in a row · ×${mult}`;
}

export function clearLine(points: number, refund: number): string {
  return `all home · +${n(points)} · +${refund.toFixed(1).replace(".0", "")}s`;
}

/** Every tip the game-over slip can give, so the tests can measure and reach them all. */
export const HINTS = {
  noTap: "tap a card and it goes where it fits",
  noHome: "aces go home first, then up in suit",
  duds: "red on black, and one lower",
  pack: "nothing fits? tap the pack for a card",
  hidden: "move a run to turn up what's under it",
  slow: "a card home wins a little time back",
  chain: `${words(TUNE.tiers[1]!)} home in a row pays ×3`,
  deep: "free the long columns first",
} as const;

/** One tip, picked from how the run actually went. */
export function hintFor(s: Stats): string {
  if (s.taps === 0) return HINTS.noTap;
  if (s.home === 0) return HINTS.noHome;
  if (s.duds >= 5 && s.duds * 4 >= s.taps) return HINTS.duds;
  if (s.draws === 0 && s.deals === 0) return HINTS.pack;
  if (s.deals === 0 && s.flips < 4) return HINTS.hidden;
  if (s.deals === 0) return HINTS.slow;
  if (s.bestMult < 3) return HINTS.chain;
  return HINTS.deep;
}

/** The three lines of the game-over slip: against the best, what the run did, the tip. */
export function summaryLines(score: number, best: number | null, s: Stats): [string, string, string] {
  const prev = best ?? 0;
  const head =
    score > prev && score > 0
      ? prev > 0
        ? `${n(score)} · a new best by ${n(score - prev)}`
        : `${n(score)} · a first best`
      : prev <= 0
        ? "no cards home yet"
        : score === prev
          ? `${n(score)} · level with your best`
          : `${n(score)} · ${n(prev - score)} short of your best`;
  const deals = s.deals === 1 ? "one deal" : `${words(s.deals)} deals`;
  return [head, `${deals} · ${n(s.home)} home · ${s.bestChain} in a row`, hintFor(s)];
}
