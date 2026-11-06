import { createAudio, createMusic, type SfxParams } from "@thumbcade-games/kit/audio";

/** Bobberlight's chiptune kit: square and triangle blips, a little night waltz. */
const S = {
  /** The rod whips forward. */
  swish: { wave: "noise", freq: 900, freqEnd: 3600, attack: 0.03, duration: 0.18, volume: 0.12, highpass: 700 },
  /** Bobber lands. */
  plip: { wave: "triangle", freq: 880, freqEnd: 420, duration: 0.09, volume: 0.24 },
  splash: { wave: "noise", freq: 2400, freqEnd: 700, duration: 0.22, volume: 0.13, highpass: 500, punch: 2 },
  /** A fish is curious. */
  nibble: { wave: "triangle", freq: 660, duration: 0.04, volume: 0.12 },
  /** It bites: a bright little bell. */
  bite: { wave: "square", freq: 784, duration: 0.16, volume: 0.12, arp: [0, 12], arpStep: 0.05, lowpass: 3600 },
  hooked: { wave: "square", freq: 523, duration: 0.18, volume: 0.12, arp: [0, 4, 7], arpStep: 0.05, lowpass: 3200 },
  /** One turn of the reel. */
  click: { wave: "square", freq: 1500, duration: 0.025, volume: 0.06, highpass: 900 },
  /** The line complains. */
  creak: { wave: "square", freq: 140, duration: 0.12, volume: 0.07, vibrato: [1.2, 18], lowpass: 900 },
  snap: { wave: "square", freq: 600, freqEnd: 90, duration: 0.3, volume: 0.14, lowpass: 1800, punch: 2.5 },
  twang: { wave: "noise", freq: 5000, freqEnd: 1200, duration: 0.12, volume: 0.16, highpass: 1500 },
  /** It got away. */
  aww: { wave: "triangle", freq: 440, duration: 0.42, volume: 0.2, arp: [0, -2, -5], arpStep: 0.12 },
  /** Landed! */
  landed: { wave: "triangle", freq: 523, duration: 0.46, volume: 0.24, arp: [0, 4, 7, 12, 16], arpStep: 0.06 },
  golden: { wave: "square", freq: 523, duration: 0.8, volume: 0.11, arp: [0, 4, 7, 11, 12, 16, 19, 24], arpStep: 0.07, lowpass: 4200 },
  flop: { wave: "triangle", freq: 240, freqEnd: 120, duration: 0.06, volume: 0.2, punch: 2 },
  /** The cat. */
  mrrp: { wave: "square", freq: 494, duration: 0.2, volume: 0.06, arp: [0, 5, 2], arpStep: 0.05, vibrato: [0.6, 14], lowpass: 1500 },
  tick: { wave: "square", freq: 1760, duration: 0.025, volume: 0.035, highpass: 800 },
  start: { wave: "triangle", freq: 392, duration: 0.3, volume: 0.22, arp: [0, 7, 12], arpStep: 0.07 },
  dawn: { wave: "triangle", freq: 659, duration: 0.9, volume: 0.22, arp: [0, 4, 7, 12, 7, 4, 0], arpStep: 0.12 },
} satisfies Record<string, SfxParams>;

export type Sfx = keyof typeof S;

export function createSound() {
  const audio = createAudio({ volume: 0.65 });
  // A slow night waltz in four notes, triangle, very quiet.
  const melody = createMusic(audio, { bpm: 76, stepsPerBeat: 2, wave: "triangle", volume: 0.045, steps: [64, null, null, 67, null, null, 71, null, null, 69, null, null, 64, null, null, 67, null, null, 72, null, null, 71, null, null] });
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
