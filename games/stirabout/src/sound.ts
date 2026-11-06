import { createAudio, createMusic, type SfxParams } from "@thumbcade-games/kit/audio";

/** Stirabout's chiptune kit: square and triangle blips, little arpeggios, a sleepy loop. */
const S = {
  /** A good catch: three rising square notes. */
  plink: { wave: "square", freq: 523, duration: 0.14, volume: 0.13, arp: [0, 4, 7], arpStep: 0.04, lowpass: 3400, punch: 1.8 },
  /** Bubbles popping in the pot. */
  blub: { wave: "triangle", freq: 330, freqEnd: 760, duration: 0.07, volume: 0.22 },
  /** Wrong ingredient: the brew sputters over. */
  sputter: { wave: "square", freq: 262, duration: 0.3, volume: 0.13, arp: [0, -3, -7, -8], arpStep: 0.06, lowpass: 1600 },
  hiss: { wave: "noise", freq: 3200, freqEnd: 900, duration: 0.42, volume: 0.16, highpass: 700, punch: 1.2 },
  /** A finished potion. */
  chime: { wave: "triangle", freq: 523, duration: 0.5, volume: 0.24, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.055 },
  cork: { wave: "square", freq: 1400, freqEnd: 700, duration: 0.05, volume: 0.08, lowpass: 2600 },
  /** Something lands on the floorboards. */
  bonk: { wave: "triangle", freq: 196, freqEnd: 98, duration: 0.08, volume: 0.22, punch: 2.2 },
  /** The cat. */
  mrrp: { wave: "square", freq: 494, duration: 0.2, volume: 0.06, arp: [0, 5, 2], arpStep: 0.05, vibrato: [0.6, 14], lowpass: 1500 },
  /** Shelf wobble before a drop. */
  tick: { wave: "square", freq: 1760, duration: 0.025, volume: 0.035, highpass: 800 },
  /** The candle on the card gutters out. */
  fizzle: { wave: "noise", freq: 900, freqEnd: 250, duration: 0.35, volume: 0.15, lowpass: 2000 },
  /** Last heart gone. */
  sigh: { wave: "triangle", freq: 392, duration: 0.7, volume: 0.22, arp: [7, 4, 0, -5, -8], arpStep: 0.11 },
  start: { wave: "triangle", freq: 392, duration: 0.3, volume: 0.22, arp: [0, 7, 12], arpStep: 0.07 },
} satisfies Record<string, SfxParams>;

export type Sfx = keyof typeof S;

export function createSound() {
  const audio = createAudio({ volume: 0.65 });
  // A sleepy four-note waltz, triangle, very quiet.
  const melody = createMusic(audio, { bpm: 88, stepsPerBeat: 2, wave: "triangle", volume: 0.045, steps: [67, null, null, 71, null, null, 74, null, null, 72, null, null, 67, null, null, 71, null, null, 76, null, null, 74, null, null] });
  return {
    play(name: Sfx, pitch = 0, volume = 1) {
      audio.play(S[name], { pitch, volume });
    },
    music(on: boolean) {
      if (on) melody.start();
      else melody.stop();
    },
  };
}
