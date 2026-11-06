/** Deterministic randomness and score distributions for the seed (pure; unit-tested). */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!;
}

export function sample<T>(rng: Rng, list: readonly T[], n: number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

export function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export interface ScoreShape {
  order: "asc" | "desc";
  max: number;
  format: "integer" | "ms";
}

/** Typical medians for the launch games ("points" for desc games, milliseconds for asc/ms games). */
const DESC_MEDIANS: Record<string, number> = {
  flapjack: 18,
  stackd: 24,
  duskrail: 1400,
  kingsnare: 9,
  pairs: 1200,
  shortwick: 3200,
  snek: 22,
  "neon-chop": 160,
  voltbrick: 3800,
  heatfall: 60,
  kneejerk: 14,
  mines: 900,
  clearcut: 300,
  spindart: 40,
  "six-seven": 80,
  lanternline: 240,
  doodlebow: 450,
  pagewing: 170,
  leapwater: 45,
  longhop: 260,
  squishputt: 800,
  "every-square": 41,
  unbroken: 90,
  foxbend: 140,
  paddlefox: 260,
  stirabout: 450,
  bobberlight: 3000,
  thunkfest: 110,
  "wobble-up": 450,
  "fixture-tap": 40,
  "fixture-swipe": 900,
};
const ASC_MEDIANS_MS: Record<string, number> = {
  kneejerk: 260,
  mines: 75_000,
  pairs: 38_000,
  kingsnare: 45_000,
};

/**
 * A plausible best score for a player of the given skill (0..1, higher is better) on a game.
 * Log-normal around a per-game median; respects score order and the manifest max.
 */
export function plausibleScore(rng: Rng, slug: string, shape: ScoreShape, skill: number): number {
  const z = gaussian(rng) * 0.35 + (skill - 0.5) * 1.6;
  if (shape.order === "asc") {
    let median = ASC_MEDIANS_MS[slug] ?? shape.max * 0.25;
    if (median > shape.max * 0.6) median = shape.max * 0.25;
    const v = median * Math.exp(-z * 0.45);
    return clampScore(v, shape);
  }
  let median = DESC_MEDIANS[slug] ?? Math.min(5000, Math.max(20, shape.max / 1000));
  if (median > shape.max * 0.3) median = Math.max(1, shape.max * 0.02);
  const v = median * Math.exp(z * 0.7);
  return clampScore(v, shape);
}

/** A worse run than `best` (a session that did not set the record). */
export function worseScore(rng: Rng, best: number, shape: ScoreShape): number {
  const f = 0.35 + rng() * 0.6;
  const v = shape.order === "asc" ? best / f : best * f;
  return clampScore(v, shape);
}

export function clampScore(v: number, shape: ScoreShape): number {
  const r = Math.round(v);
  return Math.max(shape.order === "asc" ? 1 : 0, Math.min(shape.max, r));
}

export function formatSeedScore(score: number, shape: ScoreShape): string {
  if (shape.format === "ms") {
    const s = score / 1000;
    return s < 60 ? `${s.toFixed(2)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  }
  return Math.round(score).toLocaleString("en-US");
}
