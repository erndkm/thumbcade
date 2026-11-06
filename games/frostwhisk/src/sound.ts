import { createAudio, createMusic, type SfxParams } from "@thumbcade-games/kit/audio";

/** Frostwhisk's chiptune kit: wooden clacks on ice, soft snow thumps, lantern tinks and a little skating waltz. */
const S = {
  /** Mallet meets moonstone. Pitched and loudened by how hard. */
  clack: { wave: "triangle", freq: 620, freqEnd: 380, duration: 0.06, volume: 0.26, punch: 2.6 },
  clackTop: { wave: "noise", freq: 3200, freqEnd: 1400, duration: 0.03, volume: 0.1, highpass: 1200 },
  /** Into the snowbank. */
  snow: { wave: "noise", freq: 900, freqEnd: 300, duration: 0.09, volume: 0.14, lowpass: 1400, punch: 2 },
  /** Off a lantern post. */
  tink: { wave: "square", freq: 1568, duration: 0.08, volume: 0.07, arp: [0, 7], arpStep: 0.03, lowpass: 4200 },
  /** The stone slides home. */
  goal: { wave: "square", freq: 523, duration: 0.5, volume: 0.12, arp: [0, 4, 7, 12, 16], arpStep: 0.06, lowpass: 3800 },
  goalBell: { wave: "triangle", freq: 1047, duration: 0.7, volume: 0.16, arp: [0, 7, 12], arpStep: 0.09 },
  /** Conceded. */
  aww: { wave: "triangle", freq: 440, duration: 0.42, volume: 0.18, arp: [0, -3, -7], arpStep: 0.12 },
  /** A save. */
  block: { wave: "square", freq: 988, freqEnd: 1480, duration: 0.09, volume: 0.09, lowpass: 3600 },
  blockWhoosh: { wave: "noise", freq: 2600, freqEnd: 900, duration: 0.14, volume: 0.09, highpass: 700 },
  /** The critter got a mallet on your shot. */
  nope: { wave: "square", freq: 330, freqEnd: 247, duration: 0.12, volume: 0.06, lowpass: 1600 },
  /** Knocked off the ice. */
  ko: { wave: "square", freq: 392, duration: 1.0, volume: 0.11, arp: [0, 4, 7, 12, 7, 12, 16, 19], arpStep: 0.08, lowpass: 4200 },
  tumble: { wave: "triangle", freq: 700, freqEnd: 120, duration: 0.5, volume: 0.16, vibrato: [1.5, 12] },
  /** Streak tier. */
  tier: { wave: "triangle", freq: 659, duration: 0.32, volume: 0.17, arp: [0, 4, 7, 12], arpStep: 0.05 },
  /** The puck is put down. */
  plink: { wave: "triangle", freq: 1175, freqEnd: 880, duration: 0.07, volume: 0.12 },
  /** A puck sitting still gets a nudge from the wind. */
  gust: { wave: "noise", freq: 500, freqEnd: 1600, attack: 0.08, duration: 0.4, volume: 0.06, highpass: 300 },
  tick: { wave: "square", freq: 1760, duration: 0.025, volume: 0.035, highpass: 800 },
  /** Final seconds. */
  frenzy: { wave: "square", freq: 523, duration: 0.42, volume: 0.1, arp: [0, 12, 0, 12, 7, 19], arpStep: 0.05, lowpass: 4000 },
  start: { wave: "triangle", freq: 392, duration: 0.3, volume: 0.2, arp: [0, 7, 12], arpStep: 0.07 },
  moonset: { wave: "triangle", freq: 784, duration: 1.1, volume: 0.18, arp: [12, 7, 4, 0, -5], arpStep: 0.16 },
  best: { wave: "square", freq: 523, duration: 0.9, volume: 0.1, arp: [0, 4, 7, 11, 12, 16, 19, 24], arpStep: 0.07, lowpass: 4200 },
  champion: { wave: "triangle", freq: 523, duration: 1.6, volume: 0.2, arp: [0, 4, 7, 12, 16, 19, 24, 19, 24], arpStep: 0.11 },
  // The critters' voices.
  frog: { wave: "square", freq: 196, duration: 0.22, volume: 0.08, arp: [0, 5, 0], arpStep: 0.07, vibrato: [1.4, 26], lowpass: 1400 },
  hedgehog: { wave: "noise", freq: 1800, freqEnd: 600, duration: 0.16, volume: 0.09, lowpass: 2400, punch: 1.8 },
  owl: { wave: "sine", freq: 392, freqEnd: 330, attack: 0.04, duration: 0.42, volume: 0.16, vibrato: [0.3, 5] },
  fox: { wave: "square", freq: 660, freqEnd: 990, duration: 0.11, volume: 0.07, lowpass: 2600 },
  raccoon: { wave: "square", freq: 880, duration: 0.24, volume: 0.06, arp: [0, 3, 0, 5, 0], arpStep: 0.04, lowpass: 2800 },
  cat: { wave: "square", freq: 494, duration: 0.2, volume: 0.06, arp: [0, 5, 2], arpStep: 0.05, vibrato: [0.6, 14], lowpass: 1500 },
} satisfies Record<string, SfxParams>;

export type Sfx = keyof typeof S;

export function createSound() {
  const audio = createAudio({ volume: 0.65 });
  // A skating waltz, triangle, very quiet; a quicker one for the final seconds.
  const waltz = createMusic(audio, { bpm: 132, stepsPerBeat: 1, wave: "triangle", volume: 0.04, steps: [67, 71, 74, 72, 69, 72, 71, 67, 71, 69, 66, 69, 67, null, null, 62, 66, 69, 67, 71, 74, 76, 74, 71] });
  const rush = createMusic(audio, { bpm: 176, stepsPerBeat: 2, wave: "triangle", volume: 0.045, steps: [67, 74, 71, 74, 69, 76, 72, 76, 71, 78, 74, 78, 72, 79, 76, 79] });
  return {
    play(name: Sfx, pitch = 0, volume = 1) {
      audio.play(S[name], { pitch, volume });
    },
    music(mode: "off" | "waltz" | "rush") {
      if (mode === "waltz") {
        rush.stop();
        waltz.start();
      } else if (mode === "rush") {
        waltz.stop();
        rush.start();
      } else {
        waltz.stop();
        rush.stop();
      }
    },
    unlock() {
      audio.unlock();
    },
  };
}
