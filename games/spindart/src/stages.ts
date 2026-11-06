import type { Rng } from "@thumbcade-games/kit";

/**
 * Stage schedule and the disc's motion. Every motion is a closed-form angle θ(t), so the demo player can look
 * ahead exactly and a dart's flight never has to be simulated against the spin.
 */

export type Motion = "steady" | "surge" | "swing" | "stutter" | "lurch";

export interface StageSpec {
  /** 1-based. */
  n: number;
  darts: number;
  /** Darts already stuck in the disc when it arrives. */
  stuck: number;
  /** Lit cells (bonus) on the rim. */
  lit: number;
  motion: Motion;
  dir: 1 | -1;
  /** Base angular speed (rad/s). */
  speed: number;
  boss: string | null;
  /** Seconds a loaded dart waits before it throws itself. */
  grip: number;
  /** Per-stage phase so two stages with the same motion don't look identical. */
  phase: number;
}

const BOSSES = ["DEADBOLT", "GRINDER", "VAULT", "OVERDRIVE", "MAINSPRING"];
const CYCLE: Motion[] = ["steady", "steady", "surge", "swing"];

export function stageSpec(n: number, rng: Rng): StageSpec {
  const cycle = Math.floor((n - 1) / 5);
  const slot = (n - 1) % 5;
  const boss = slot === 4;
  const heat = Math.min(1, (n - 1) / 14);
  const motion: Motion = boss ? (cycle % 2 === 0 ? "stutter" : "lurch") : n <= 2 ? "steady" : CYCLE[(slot + cycle) % CYCLE.length]!;
  const speed = (boss ? 1.9 : 1.45 + slot * 0.22) * (1 + cycle * 0.14);
  return {
    n,
    darts: Math.min(11, (boss ? 8 : 6 + Math.floor(slot / 2)) + cycle),
    stuck: Math.min(6, (n === 1 ? 0 : boss ? 3 : Math.min(2, slot)) + cycle),
    lit: boss ? 1 : n === 1 ? 1 : 1 + (slot % 2),
    motion,
    dir: n % 2 === 0 ? -1 : 1,
    speed,
    boss: boss ? BOSSES[cycle % BOSSES.length]! : null,
    grip: 3.6 - heat * 1.2,
    phase: rng.range(0, Math.PI * 2),
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Disc angle (rad) at stage time t. */
export function angleAt(s: StageSpec, t: number): number {
  const w = s.speed;
  switch (s.motion) {
    case "steady":
      return s.dir * w * t;
    case "surge":
      // Speed breathes between ~0.35× and ~1.65× without ever stopping.
      return s.dir * (w * t + ((0.65 * w) / 1.7) * Math.sin(1.7 * t + s.phase));
    case "swing": {
      // Slow drift plus a big pendulum: it stops and reverses every couple of seconds.
      const A = 2.4;
      const k = 1.25;
      return s.dir * (0.35 * w * t) + A * Math.sin(k * t + s.phase);
    }
    case "stutter": {
      // Tick, hold, tick: a quick jump of one step, then a pause.
      const period = 0.62;
      const step = w * period * 1.15;
      const f = t / period;
      const n = Math.floor(f);
      const p = Math.min(1, (f - n) / 0.45);
      return s.dir * step * (n + smooth(p));
    }
    case "lurch": {
      // Steady spin that slams into reverse for a beat every 2.2 s.
      const period = 2.2;
      const f = t / period;
      const n = Math.floor(f);
      const x = (f - n) * period;
      const back = Math.min(x, 0.7);
      const fwd = Math.max(0, x - 0.7);
      return s.dir * w * (n * (period - 1.4) + fwd - back * 1);
    }
  }
}
