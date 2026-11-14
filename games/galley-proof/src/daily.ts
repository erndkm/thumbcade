/**
 * Today's word: the same for every player on a UTC day.
 *
 * The shell hands every game `dailySeed`, the FNV-1a hash of today's date ("2026-11-06"). A hash alone would pick
 * words at random and repeat one within weeks, so the game finds which day the seed belongs to (today, or the day
 * either side if the device clock is off), counts days from 1 January 2026 and walks a fixed shuffle of the answer
 * list: no word comes back until every other word has had its day. A seed that matches none of the three days still
 * picks the same word for everyone who has it.
 */
import { createRng } from "@thumbcade-games/kit/rng";

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 0, 1);

/** The shell's daily seed for a date (FNV-1a over the UTC date). */
export function seedForDay(ms: number): number {
  const s = new Date(ms).toISOString().slice(0, 10);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Day number (0 = 1 Jan 2026) whose seed is `dailySeed`, searched around `now`; null if none matches. */
export function dayOf(dailySeed: number, now: number): number | null {
  const today = Math.floor(now / DAY);
  for (const d of [today, today - 1, today + 1]) if (seedForDay(d * DAY) === dailySeed >>> 0) return d - Math.floor(EPOCH / DAY);
  return null;
}

/** A fixed shuffle of 0..n-1: the order the days walk through the answers. */
export function dailyOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  return createRng(0x6a11e7).shuffle(order);
}

export interface Daily {
  /** Index into the answers. */
  index: number;
  word: string;
  /** Day number since 1 Jan 2026, or null if the seed matched no nearby day. */
  day: number | null;
}

export function dailyWord(answers: readonly string[], dailySeed: number, now = Date.now()): Daily {
  const order = dailyOrder(answers.length);
  const day = dayOf(dailySeed, now);
  const k = day !== null ? ((day % order.length) + order.length) % order.length : (dailySeed >>> 0) % order.length;
  const index = order[k]!;
  return { index, word: answers[index]!, day };
}
