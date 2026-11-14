import { createAudio, createMusic, type SfxParams } from "@thumbcade-games/kit/audio";

/** Scootpurr's chiptune kit: paws on wool, chirps and purrs, a huff for a bump, and a hearthside lullaby. */
const S = {
  /** Finger down on a cat: it perks up. */
  perk: { wave: "triangle", freq: 520, freqEnd: 620, duration: 0.03, volume: 0.07 },
  /** Off it scoots (pitched up with the streak), with a chirp as it goes. */
  scoot: { wave: "noise", freq: 1500, freqEnd: 3200, attack: 0.01, duration: 0.11, volume: 0.09, highpass: 700 },
  chirp: { wave: "triangle", freq: 660, freqEnd: 990, duration: 0.07, volume: 0.15 },
  /** A purr, deeper and louder as the streak grows. */
  purr: { wave: "sawtooth", freq: 110, duration: 0.28, volume: 0.07, vibrato: [0.9, 26], lowpass: 520 },
  /** Nose into a neighbour. */
  bonk: { wave: "square", freq: 300, freqEnd: 120, duration: 0.14, volume: 0.12, lowpass: 1600, punch: 2.2 },
  huff: { wave: "noise", freq: 3600, freqEnd: 1800, duration: 0.2, volume: 0.07, highpass: 1600 },
  /** A cat is set down on a new rug. */
  plop: { wave: "triangle", freq: 392, freqEnd: 330, duration: 0.05, volume: 0.09 },
  /** The rug is clear. */
  clear: { wave: "triangle", freq: 659, duration: 0.5, volume: 0.17, arp: [0, 4, 7, 12, 16], arpStep: 0.07 },
  bell: { wave: "square", freq: 2093, duration: 0.09, volume: 0.04, lowpass: 5200 },
  /** Kept the witch's cat for last. */
  last: { wave: "square", freq: 988, duration: 0.3, volume: 0.08, arp: [0, 5, 12, 17], arpStep: 0.05, lowpass: 4800 },
  /** Purr tiers. */
  tier: { wave: "triangle", freq: 587, duration: 0.32, volume: 0.16, arp: [0, 4, 7, 12], arpStep: 0.05 },
  /** Past the best. */
  best: { wave: "square", freq: 523, duration: 0.9, volume: 0.1, arp: [0, 4, 7, 11, 12, 16, 19, 24], arpStep: 0.07, lowpass: 4200 },
  /** The candle is low. */
  tick: { wave: "square", freq: 1568, duration: 0.025, volume: 0.035, highpass: 800 },
  start: { wave: "triangle", freq: 392, duration: 0.3, volume: 0.18, arp: [0, 7, 12], arpStep: 0.07 },
  /** The candle goes out. */
  snuff: { wave: "noise", freq: 2400, freqEnd: 300, attack: 0.02, duration: 0.5, volume: 0.13, lowpass: 2600 },
  yawn: { wave: "sine", freq: 520, freqEnd: 300, attack: 0.1, duration: 0.6, volume: 0.1, vibrato: [0.4, 5] },
} satisfies Record<string, SfxParams>;

export type Sfx = keyof typeof S;

export function createSound() {
  const audio = createAudio({ volume: 0.65 });
  // A hearthside lullaby, plucked triangle, very quiet; a quicker one when the candle is low.
  const lullaby = createMusic(audio, {
    bpm: 96,
    stepsPerBeat: 2,
    wave: "triangle",
    volume: 0.035,
    steps: [60, null, 64, null, 67, null, 64, null, 65, null, 69, null, 67, null, null, null, 60, null, 64, null, 67, 69, 72, null, 71, null, 67, null, 64, null, null, null],
  });
  const hurry = createMusic(audio, { bpm: 138, stepsPerBeat: 2, wave: "triangle", volume: 0.04, steps: [60, 64, 67, 64, 62, 65, 69, 65, 60, 64, 67, 72, 71, 67, 64, 62] });
  return {
    play(name: Sfx, pitch = 0, volume = 1) {
      audio.play(S[name], { pitch, volume });
    },
    music(mode: "off" | "lullaby" | "hurry") {
      if (mode === "lullaby") {
        hurry.stop();
        lullaby.start();
      } else if (mode === "hurry") {
        lullaby.stop();
        hurry.start();
      } else {
        lullaby.stop();
        hurry.stop();
      }
    },
    unlock() {
      audio.unlock();
    },
  };
}
