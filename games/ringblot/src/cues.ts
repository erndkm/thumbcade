/**
 * What the player hears and feels for everything that happens, as plain data: each event of the run maps to the
 * sounds it triggers and, for the player's own actions, a haptic. The game plays what this returns and nothing
 * else, so the tests can check that every action and every reward has its cue without an audio device.
 */
import type { FeedbackKind } from "@thumbcade/sdk";
import { HERO, INK_LOW, type Phase, type SimEvent } from "./sim.ts";
import type { SoundName } from "./sfx.ts";

export interface Cue {
  sounds: SoundName[];
  haptic?: FeedbackKind;
  /** Semitones to shift the first sound by (the scale a run of prints climbs). */
  pitch?: number;
}

/** The pentatonic steps a print's note climbs with its size. */
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export function cueFor(e: SimEvent): Cue {
  switch (e.k) {
    case "turn":
      return { sounds: ["step"] };
    case "bonk":
      return { sounds: ["bonk"] };
    case "out":
      return e.id === HERO ? { sounds: ["wet"] } : { sounds: [] };
    case "print":
      if (e.id !== HERO) return { sounds: ["rivalPrint"] };
      return { sounds: e.tier >= 3 ? ["print", "pull", "roll"] : e.tier === 2 ? ["print", "pull"] : ["print"], haptic: e.tier >= 2 ? "success" : "tap", pitch: STEPS[Math.min(STEPS.length - 1, Math.floor(e.squares / 6))]! };
    case "shave":
      return { sounds: ["shave"] };
    case "smudge":
      return e.by === HERO ? { sounds: ["smudge", "bell"], haptic: "impact" } : { sounds: ["smudge"] };
    case "smudged":
      return { sounds: e.by === 0 ? ["boxed", "lost"] : ["smudge", "lost"], haptic: "fail" };
    case "crawl":
      return { sounds: ["crawl"] };
    case "low":
      return { sounds: ["low"] };
    case "tick":
      return { sounds: ["tick"], pitch: Math.max(0, INK_LOW - e.left) };
    case "sheet":
      return { sounds: e.clean ? ["sheet", "bell"] : ["sheet"], haptic: "success" };
    case "fresh":
      return { sounds: ["fresh"] };
    case "over":
      return { sounds: ["dry"] };
  }
}

export type Bed = "off" | "walk" | "hurry";

/** The rhythmic bed under a run: the press's steady walk, a quicker one when the ink is nearly dry, nothing between sheets. */
export function bedFor(phase: Phase, ink: number, playing: boolean): Bed {
  if (!playing || phase !== "play") return "off";
  return ink <= INK_LOW ? "hurry" : "walk";
}

/** The bed's key rises a tone with every sheet (and comes back down after six). */
export const bedKey = (sheet: number): number => ((sheet - 1) % 6) * 2;
