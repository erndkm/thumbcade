/**
 * Ringblot's print shop, all synthesized through the kit's audio engine (which suspends itself on pause and mute):
 * a soft step for every turn, the wet squeak of a line leaving the print, the press coming down on a loop (a pluck
 * that climbs a pentatonic with the loop's size, a roller behind the big ones), paper tearing for a smudge, and a
 * quiet two-bar bed in the press's rhythm that quickens when the ink is nearly dry and rises a tone with each sheet.
 */
import { createAudio, createMusic, type Audio } from "@thumbcade-games/kit/audio";
import type { Bed } from "./cues.ts";
import { HURRY, S, WALK, type SoundName } from "./sfx.ts";

export interface Sound {
  readonly audio: Audio;
  play(name: SoundName, pitch?: number, level?: number): void;
  /** Sets the bed (and its key, in semitones). Safe to call every frame. */
  bed(bed: Bed, key: number): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.75 });
  const walk = createMusic(audio, { bpm: 104, wave: "triangle", volume: 0.038, steps: WALK });
  const hurry = createMusic(audio, { bpm: 138, wave: "triangle", volume: 0.045, steps: HURRY });
  let now: Bed = "off";
  let keyNow = -1;
  return {
    audio,
    play(name, pitch = 0, level = 1) {
      audio.play(S[name], { pitch, volume: level });
    },
    bed(bed, key) {
      if (key !== keyNow) {
        keyNow = key;
        walk.setSteps(WALK.map((n) => (n === null ? null : n + key)));
        hurry.setSteps(HURRY.map((n) => (n === null ? null : n + key)));
      }
      if (bed === now) return;
      now = bed;
      walk.stop();
      hurry.stop();
      if (bed === "walk") walk.start();
      else if (bed === "hurry") hurry.start();
    },
  };
}
