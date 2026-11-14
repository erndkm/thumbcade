import { createAudio, createMusic, type SfxParams } from "@thumbcade-games/kit/audio";

/** Pittermoon's chiptune kit: soft paw pats, a ribbon bell, brooms swishing past, and a tiptoe tune. */
const S = {
  /** Finger down: the cat gathers itself. */
  crouch: { wave: "triangle", freq: 330, freqEnd: 300, duration: 0.03, volume: 0.06 },
  /** Up a row: a pitter (pitched up with the zoomies). */
  pad: { wave: "triangle", freq: 740, freqEnd: 988, duration: 0.06, volume: 0.15 },
  /** Landing: a pat, and the ribbon's bell now and then. */
  pat: { wave: "noise", freq: 1800, freqEnd: 900, duration: 0.03, volume: 0.07, lowpass: 2600 },
  bell: { wave: "square", freq: 2093, duration: 0.07, volume: 0.035, lowpass: 5000 },
  /** A sidestep. */
  step: { wave: "noise", freq: 2400, freqEnd: 1200, duration: 0.05, volume: 0.08, highpass: 900 },
  /** Into something in the way. */
  boop: { wave: "square", freq: 220, freqEnd: 180, duration: 0.07, volume: 0.07, lowpass: 1200 },
  /** A broom sweeps past close by. */
  swish: { wave: "noise", freq: 900, freqEnd: 3200, attack: 0.03, duration: 0.16, volume: 0.1, highpass: 600 },
  /** Whisker-close. */
  whisker: { wave: "square", freq: 1568, duration: 0.16, volume: 0.07, arp: [0, 7, 12], arpStep: 0.04, lowpass: 5200 },
  scramble: { wave: "triangle", freq: 523, freqEnd: 784, duration: 0.09, volume: 0.12 },
  /** Fish! */
  fish: { wave: "square", freq: 988, duration: 0.16, volume: 0.09, arp: [0, 5, 12], arpStep: 0.04, lowpass: 4800 },
  gold: { wave: "triangle", freq: 784, duration: 0.5, volume: 0.17, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.06 },
  /** Bumped by something rolling or flying. */
  bonk: { wave: "square", freq: 300, freqEnd: 90, duration: 0.2, volume: 0.13, lowpass: 1800, punch: 2.2 },
  thud: { wave: "noise", freq: 700, freqEnd: 200, duration: 0.12, volume: 0.16, lowpass: 1400, punch: 2 },
  /** Into the brook, or the bog. */
  splash: { wave: "noise", freq: 2600, freqEnd: 500, duration: 0.32, volume: 0.17, lowpass: 3800, punch: 1.6 },
  glug: { wave: "sine", freq: 300, freqEnd: 140, duration: 0.24, volume: 0.17, vibrato: [3, 18] },
  /** A wisp's spook. */
  ooo: { wave: "sine", freq: 523, freqEnd: 392, attack: 0.05, duration: 0.42, volume: 0.13, vibrato: [0.6, 6] },
  /** The cat's voice. */
  mew: { wave: "square", freq: 494, duration: 0.2, volume: 0.06, arp: [0, 5, 2], arpStep: 0.05, vibrato: [0.6, 14], lowpass: 1500 },
  hiss: { wave: "noise", freq: 4000, freqEnd: 2000, duration: 0.22, volume: 0.07, highpass: 1800 },
  /** Zoomies tiers. */
  tier: { wave: "triangle", freq: 659, duration: 0.32, volume: 0.16, arp: [0, 4, 7, 12], arpStep: 0.05 },
  cool: { wave: "triangle", freq: 523, duration: 0.2, volume: 0.07, arp: [0, -5], arpStep: 0.08 },
  /** Every tenth row. */
  milestone: { wave: "triangle", freq: 1047, duration: 0.28, volume: 0.12, arp: [0, 7], arpStep: 0.09 },
  /** A new stretch of the hill. */
  stretch: { wave: "square", freq: 523, duration: 0.8, volume: 0.1, arp: [0, 4, 7, 12, 7, 12, 16], arpStep: 0.09, lowpass: 4200 },
  stretchBell: { wave: "triangle", freq: 1047, duration: 0.9, volume: 0.14, arp: [0, 7, 12], arpStep: 0.14 },
  /** Past the best row. */
  best: { wave: "square", freq: 523, duration: 0.9, volume: 0.1, arp: [0, 4, 7, 11, 12, 16, 19, 24], arpStep: 0.07, lowpass: 4200 },
  /** The witch swoops in. */
  swoop: { wave: "noise", freq: 400, freqEnd: 2600, attack: 0.12, duration: 0.5, volume: 0.12, highpass: 300 },
  lift: { wave: "triangle", freq: 659, duration: 1.0, volume: 0.17, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.1 },
  /** First light is close. */
  hurry: { wave: "square", freq: 392, duration: 0.3, volume: 0.06, arp: [0, 1, 0, 1], arpStep: 0.07, lowpass: 2200 },
  tick: { wave: "square", freq: 1760, duration: 0.025, volume: 0.03, highpass: 800 },
  start: { wave: "triangle", freq: 392, duration: 0.3, volume: 0.18, arp: [0, 7, 12], arpStep: 0.07 },
  /** The sun comes up. */
  sunrise: { wave: "triangle", freq: 784, duration: 1.3, volume: 0.17, arp: [12, 7, 4, 0, -5, -8], arpStep: 0.18 },
  yawn: { wave: "sine", freq: 520, freqEnd: 300, attack: 0.1, duration: 0.6, volume: 0.1, vibrato: [0.4, 5] },
} satisfies Record<string, SfxParams>;

export type Sfx = keyof typeof S;

export function createSound() {
  const audio = createAudio({ volume: 0.65 });
  // A tiptoe tune, plucked triangle, very quiet; a quicker one when first light is close.
  const tiptoe = createMusic(audio, {
    bpm: 112,
    stepsPerBeat: 2,
    wave: "triangle",
    volume: 0.035,
    steps: [64, null, 67, null, 69, 67, 64, null, 62, null, 64, null, 60, null, null, null, 64, null, 67, null, 69, 71, 72, null, 71, 69, 67, null, 64, null, null, null],
  });
  const hurry = createMusic(audio, { bpm: 150, stepsPerBeat: 2, wave: "triangle", volume: 0.04, steps: [64, 67, 69, 67, 64, 67, 71, 67, 62, 65, 69, 65, 64, 67, 72, 67] });
  return {
    play(name: Sfx, pitch = 0, volume = 1) {
      audio.play(S[name], { pitch, volume });
    },
    music(mode: "off" | "tiptoe" | "hurry") {
      if (mode === "tiptoe") {
        hurry.stop();
        tiptoe.start();
      } else if (mode === "hurry") {
        tiptoe.stop();
        hurry.start();
      } else {
        tiptoe.stop();
        hurry.stop();
      }
    },
    unlock() {
      audio.unlock();
    },
  };
}
