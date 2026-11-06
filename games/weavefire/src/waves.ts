/**
 * The wave script. A loop is about forty seconds of formations, then a warning and the Loom. After the Loom falls the
 * script runs again, a little faster (`Sim.loop` and `Sim.d` scale bullet speed, fire rates, ring sizes and armour).
 *
 * Pacing rules the script keeps:
 * - Nothing fires before 12 s, and the opening darts (hook paths) turn back above the ship's zone, so the first ten
 *   seconds can't be lost.
 * - A supply skiff every ten seconds or so spills two pickups to choose between (or to grab both).
 * - Every group is a formation: kill all of it before any escapes for the formation bonus.
 */
import type { Sim } from "./sim.ts";

export interface ScriptEntry {
  /** Seconds into the loop. */
  at: number;
  run(sim: Sim): void;
}

const at = (t: number, run: (s: Sim) => void): ScriptEntry => ({ at: t, run });

export const LOOP: readonly ScriptEntry[] = [
  at(1.0, (s) => s.hookChain(180, 5, 60, 0.3)),
  at(3.2, (s) => s.lobChain(true, 6, 165, { lift: 30, shoot: s.loop > 0 })),
  at(5.2, (s) => s.lobChain(false, 6, 190, { lift: 30, shoot: s.loop > 0 })),
  at(6.8, (s) => s.skiff(true, 0.22, "power", "drone")),
  at(8.4, (s) => {
    s.hookChain(96, 4, 40, 0.28, { drift: 10 });
    s.hookChain(264, 4, 40, 0.28, { drift: -10 });
  }),
  at(10.4, (s) => {
    s.bloom(110, 0.2, { hold: 5.5 });
    s.bloom(250, 0.25, { hold: 5.5 });
  }),
  at(12.2, (s) => s.weaver(true, 0.3, 7)),
  at(14.4, (s) => s.swoopChain(120, 6, 70, 150, { shoot: true })),
  at(15.8, (s) => s.swoopChain(240, 6, 70, 150, { phase: Math.PI, shoot: true })),
  at(16.8, (s) => s.skiff(false, 0.2, "power", "shield")),
  at(18.4, (s) => s.bastion(180, 0.19, { drop: "power" })),
  at(20.0, (s) => {
    s.weaver(true, 0.27, 6);
    s.weaver(false, 0.42, 6);
  }),
  at(22.6, (s) => {
    s.bloom(80, 0.22, { n: 12 });
    s.bloom(180, 0.3, { n: 12, every: 2.0 });
    s.bloom(280, 0.22, { n: 12 });
  }),
  at(24.8, (s) => s.vdive(180, 9, 140, 0.32, { shoot: true })),
  at(26.8, (s) => {
    s.bastion(90, 0.18, { every: 1.7 });
    s.bastion(270, 0.24, { every: 1.7, drop: "power" });
  }),
  at(28.8, (s) => s.skiff(true, 0.2, "power", "nova")),
  at(30.4, (s) => {
    s.weaver(false, 0.28, 8);
    s.bloom(120, 0.2, { hold: 4.5 });
    s.bloom(240, 0.2, { hold: 4.5 });
  }),
  at(32.8, (s) => {
    s.swoopChain(90, 7, 60, 165, { shoot: true });
    s.swoopChain(270, 7, 60, 165, { phase: Math.PI, shoot: true });
  }),
  at(34.8, (s) => {
    s.lobChain(true, 7, 160, { lift: 30, shoot: true });
    s.lobChain(false, 7, 200, { lift: 30, shoot: true });
  }),
];

/** Seconds into a loop when the warning sounds, and when the Loom arrives. */
export const LOOP_WARN = 37;
export const LOOP_BOSS = 39.5;
/** Overdrive loops (after the first Loom) start the script here, at the first pods: no gentle opening twice. */
export const OVERDRIVE_FROM = 14;

/**
 * Attract mode: a showreel played by the pilot on a loop. It starts mid-action (the game pre-rolls it before
 * `ready()`), keeps the action below the title and above the feed caption, and shows the verb, a formation going up,
 * pickups and a heavy kill inside a few seconds.
 */
export const ATTRACT: readonly ScriptEntry[] = [
  at(0.0, (s) => {
    s.bloom(196, 0.36, { hold: 4.2, every: 1.05, n: 14 });
    s.hookChain(76, 5, 34, 0.42, { gap: 0.16, shoot: true });
    s.lobChain(true, 6, 300, { lift: 18, fall: 24, gap: 0.15, shoot: true });
  }),
  at(0.7, (s) => s.lobChain(false, 6, 236, { lift: 24, fall: 28, gap: 0.15, shoot: true })),
  at(1.2, (s) => s.skiff(true, 0.42, "power", "drone")),
  at(2.6, (s) => s.weaver(true, 0.3, 7, { amp: 30 })),
  at(3.4, (s) => s.bastion(250, 0.34, { hold: 4.5, every: 1.1 })),
  at(4.4, (s) => s.lobChain(true, 6, 210, { lift: 20, fall: 26, gap: 0.15, shoot: true })),
  at(5.6, (s) => s.bloom(100, 0.4, { hold: 4, every: 1.1, n: 12 })),
  at(7.0, (s) => s.vdive(180, 7, 120, 0.42, { shoot: true })),
  at(8.6, (s) => {
    s.bloom(96, 0.33, { hold: 4, n: 12 });
    s.bloom(264, 0.36, { hold: 4, n: 12 });
  }),
  at(10.0, (s) => s.weaver(false, 0.44, 8, { amp: 34 })),
  at(11.4, (s) => s.swoopChain(180, 6, 80, 130, { shoot: true })),
  at(12.6, (s) => s.bastion(110, 0.32, { hold: 3, every: 1.1 })),
  at(13.2, (s) => s.skiff(false, 0.4, "shield", "nova")),
  at(14.0, (s) => s.hookChain(270, 5, 34, 0.38, { gap: 0.16 })),
];

export const ATTRACT_PERIOD = 16;
