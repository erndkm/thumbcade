import type { AgeBand } from "./types";

/**
 * Birth year -> age band. Uses the lower bound of the possible age (birthday not yet reached this
 * year), so the boundary always errs on the protective side. The year itself is never stored.
 */
export function ageBandFor(birthYear: number, now: Date = new Date()): AgeBand | null {
  const y = now.getUTCFullYear();
  if (!Number.isInteger(birthYear) || birthYear < y - 120 || birthYear > y) return null;
  const age = y - birthYear - 1;
  if (age < 13) return "under13";
  if (age < 16) return "13to15";
  if (age < 18) return "16to17";
  return "adult";
}

export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  under13: "Under 13",
  "13to15": "13–15",
  "16to17": "16–17",
  adult: "18+",
};
