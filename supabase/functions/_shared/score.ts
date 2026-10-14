/** Client-side sanity checks run before session-end hits the database. */
export function isPlausibleScore(score: number): boolean {
  return Number.isFinite(score) && score >= 0 && score <= Number.MAX_SAFE_INTEGER;
}
