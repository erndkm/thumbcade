import type { SfxParams } from "@thumbcade-games/kit/audio";

/**
 * juicefactory's sound palette: cartoon boings (sine slides with vibrato), thunks (noise crack + low thud),
 * slide whistles and kazoo-ish squares. Pitch and volume vary per call so nothing repeats exactly.
 */
export const S = {
  boing: { wave: "sine", freq: 180, freqEnd: 520, duration: 0.34, volume: 0.42, vibrato: [1.6, 15], punch: 1.2 },
  boingBig: { wave: "sine", freq: 120, freqEnd: 700, duration: 0.55, volume: 0.45, vibrato: [2.2, 11], punch: 1.1 },
  crack: { wave: "noise", freq: 2600, freqEnd: 500, duration: 0.07, volume: 0.5, punch: 2.6 },
  thud: { wave: "sine", freq: 190, freqEnd: 48, duration: 0.2, volume: 0.75, punch: 2 },
  clank: { wave: "square", freq: 1320, duration: 0.22, volume: 0.13, arp: [0, 6, 1], arpStep: 0.03, highpass: 700, punch: 2.4 },
  ring: { wave: "triangle", freq: 2093, duration: 0.4, volume: 0.16, vibrato: [0.3, 18], punch: 2 },
  whistleUp: { wave: "sine", freq: 420, freqEnd: 1500, attack: 0.04, duration: 0.42, volume: 0.28, vibrato: [0.35, 7] },
  whistleDown: { wave: "sine", freq: 1500, freqEnd: 260, attack: 0.03, duration: 0.7, volume: 0.3, vibrato: [0.4, 6] },
  kazoo: { wave: "square", freq: 330, duration: 0.18, volume: 0.13, lowpass: 1700, vibrato: [0.5, 11], punch: 0.8 },
  wahwah: { wave: "square", freq: 300, freqEnd: 180, duration: 0.5, volume: 0.15, lowpass: 1200, vibrato: [0.8, 6], punch: 0.9 },
  pop: { wave: "sine", freq: 320, freqEnd: 960, duration: 0.08, volume: 0.32 },
  peek: { wave: "triangle", freq: 600, freqEnd: 820, duration: 0.06, volume: 0.12 },
  squeak: { wave: "sine", freq: 1500, freqEnd: 2300, duration: 0.14, volume: 0.22, vibrato: [1.2, 26] },
  whiff: { wave: "noise", freq: 700, freqEnd: 2400, attack: 0.03, duration: 0.16, volume: 0.22, highpass: 500 },
  ding: { wave: "triangle", freq: 988, duration: 0.42, volume: 0.26, arp: [0, 4, 7, 12, 16], arpStep: 0.05 },
  tick: { wave: "square", freq: 1800, duration: 0.025, volume: 0.07, highpass: 1200 },
  rumble: { wave: "noise", freq: 260, freqEnd: 140, duration: 0.18, volume: 0.22, lowpass: 600 },
  sproing: { wave: "sine", freq: 110, freqEnd: 980, duration: 0.62, volume: 0.42, vibrato: [3, 17], punch: 1.1 },
  crunch: { wave: "noise", freq: 2400, freqEnd: 650, duration: 0.15, volume: 0.42, punch: 1.8 },
  cherry: { wave: "triangle", freq: 1318, duration: 0.22, volume: 0.24, arp: [0, 7, 12], arpStep: 0.045 },
  ouch: { wave: "square", freq: 560, freqEnd: 240, duration: 0.42, volume: 0.15, lowpass: 1500, vibrato: [1.2, 14], punch: 0.9 },
  zap: { wave: "square", freq: 72, duration: 0.42, volume: 0.17, lowpass: 2600, vibrato: [5, 31], punch: 1.2 },
  crackle: { wave: "noise", freq: 4200, freqEnd: 1800, duration: 0.3, volume: 0.2, highpass: 1800, punch: 1.4 },
  splat: { wave: "noise", freq: 1300, freqEnd: 90, duration: 0.42, volume: 0.6, punch: 1.4 },
  creak: { wave: "square", freq: 130, freqEnd: 92, duration: 0.18, volume: 0.13, lowpass: 900, vibrato: [0.8, 32] },
  fanfare: { wave: "square", freq: 523, duration: 0.5, volume: 0.12, arp: [0, 4, 7, 12], arpStep: 0.085, lowpass: 2200, vibrato: [0.25, 7] },
} satisfies Record<string, SfxParams>;
