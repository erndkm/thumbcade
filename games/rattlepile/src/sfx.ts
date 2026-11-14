import type { SfxParams } from "@thumbcade-games/kit/audio";

/**
 * juicefactory's sound palette (boings, thunks, slide whistles, kazoo squares), plus Rattlepile's playroom: the
 * cannon's pock for every marble, glass on wood (a tok that climbs a scale as the volley rattles on), a block
 * bursting, the +1 ring, the zapper, the pile thumping down a row and the crunch when it reaches the floor.
 */
export const S = {
  pock: { wave: "sine", freq: 420, freqEnd: 820, duration: 0.05, volume: 0.16 },
  tok: { wave: "triangle", freq: 620, freqEnd: 470, duration: 0.04, volume: 0.13, lowpass: 2600 },
  tick: { wave: "square", freq: 1900, duration: 0.014, volume: 0.035, highpass: 900 },
  pop: { wave: "sine", freq: 340, freqEnd: 1000, duration: 0.08, volume: 0.26 },
  crack: { wave: "noise", freq: 2200, freqEnd: 400, duration: 0.09, volume: 0.24, punch: 2.6 },
  ding: { wave: "triangle", freq: 988, duration: 0.36, volume: 0.22, arp: [0, 4, 7, 12], arpStep: 0.05 },
  zap: { wave: "sawtooth", freq: 1500, freqEnd: 300, duration: 0.16, volume: 0.07, lowpass: 3400 },
  roll: { wave: "sine", freq: 150, freqEnd: 110, duration: 0.07, volume: 0.16, punch: 2 },
  clunk: { wave: "sine", freq: 150, freqEnd: 60, duration: 0.18, volume: 0.5, punch: 2 },
  boom: { wave: "noise", freq: 900, freqEnd: 70, duration: 0.55, volume: 0.5, punch: 2.2 },
  thud: { wave: "sine", freq: 170, freqEnd: 42, duration: 0.26, volume: 0.7, punch: 2 },
  sproing: { wave: "sine", freq: 140, freqEnd: 900, duration: 0.42, volume: 0.3, vibrato: [2.6, 16], punch: 1.1 },
  boing: { wave: "sine", freq: 520, freqEnd: 160, duration: 0.3, volume: 0.32, vibrato: [1.6, 14], punch: 1.2 },
  buzz: { wave: "square", freq: 110, duration: 0.3, volume: 0.13, lowpass: 900, arp: [0, -1], arpStep: 0.12, punch: 0.8 },
  whistleUp: { wave: "sine", freq: 420, freqEnd: 1600, attack: 0.04, duration: 0.42, volume: 0.24, vibrato: [0.35, 7] },
  whistleDown: { wave: "sine", freq: 1400, freqEnd: 300, attack: 0.03, duration: 0.55, volume: 0.22, vibrato: [0.4, 6] },
  boop: { wave: "triangle", freq: 300, duration: 0.22, volume: 0.18, arp: [0, -4], arpStep: 0.1, lowpass: 1800 },
  chaChing: { wave: "triangle", freq: 1047, duration: 0.32, volume: 0.22, arp: [0, 7, 12, 16], arpStep: 0.045 },
  fanfare: { wave: "square", freq: 523, duration: 0.6, volume: 0.12, arp: [0, 4, 7, 12, 16], arpStep: 0.09, lowpass: 2400, vibrato: [0.25, 7] },
  kazoo: { wave: "square", freq: 196, duration: 0.34, volume: 0.13, lowpass: 1500, vibrato: [0.6, 10], punch: 0.8 },
  kazooHi: { wave: "square", freq: 262, duration: 0.3, volume: 0.12, lowpass: 1700, vibrato: [0.6, 10], punch: 0.8 },
  tier: { wave: "square", freq: 659, duration: 0.3, volume: 0.1, arp: [0, 4, 7, 12], arpStep: 0.06, lowpass: 3000 },
  fast: { wave: "triangle", freq: 880, duration: 0.14, volume: 0.1, arp: [0, 5], arpStep: 0.05 },
} satisfies Record<string, SfxParams>;
