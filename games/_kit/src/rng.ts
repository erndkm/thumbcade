/** Seeded randomness (mulberry32). Use `ctx.seed` for runs and `ctx.dailySeed` for daily challenges. */
export interface Rng {
  /** [0, 1) */
  (): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  pick<T>(list: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(list: T[]): T[];
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.range = (min, max) => min + (max - min) * next();
  next.int = (min, max) => Math.floor(min + (max - min + 1) * next());
  next.pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] as T;
  next.chance = (p) => next() < p;
  next.shuffle = <T>(list: T[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [list[i], list[j]] = [list[j] as T, list[i] as T];
    }
    return list;
  };
  return next;
}
