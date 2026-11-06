/**
 * Cards are numbers 0-51: rank = card % 13 (0 = ace … 12 = king), suit = floor(card / 13).
 * Only the rank matters to the rules; the suit is drawn so a hand looks like a hand.
 */

export const RANKS = 13;
export const DECK = 52;

export const rankOf = (card: number): number => card % RANKS;
export const suitOf = (card: number): number => Math.floor(card / RANKS);

/** What the corner of a card says. */
export const RANK_LABEL = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
/** Spoken form, for screen readers and copy. */
export const RANK_NAME = ["ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack", "queen", "king"] as const;

export const label = (card: number): string => RANK_LABEL[rankOf(card)]!;

/**
 * One rank above or below, and the ranks wrap: a king goes on an ace and an ace on a king. Wrapping keeps chains
 * alive through the ends of the deck, which is most of what makes a long run feel possible.
 */
export function adjacent(a: number, b: number): boolean {
  const d = Math.abs(rankOf(a) - rankOf(b));
  return d === 1 || d === RANKS - 1;
}

/** Signed step from rank a to rank b around the wrap: +1 (up), -1 (down), or 0 when they are not neighbours. */
export function step(a: number, b: number): -1 | 0 | 1 {
  const d = (rankOf(b) - rankOf(a) + RANKS) % RANKS;
  return d === 1 ? 1 : d === RANKS - 1 ? -1 : 0;
}

/** Fisher-Yates over a fresh deck with the given [0, 1) source. */
export function shuffledDeck(rand: () => number): number[] {
  const d = Array.from({ length: DECK }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d;
}
