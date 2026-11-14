import type { SfxParams } from "@thumbcade-games/kit/audio";

/**
 * juicefactory's sound palette (boings, thunks, slide whistles, kazoo squares), plus Platterbang's kitchen: the
 * squeak of a peg twisting out and the pop as it comes free, the clink into a jar, the bonk of a peg that's stuck,
 * a dish's creak as it swings, the crash and the tinkle of shards, a lid slamming and a jar zooming off.
 */
export const S = {
  press: { wave: "triangle", freq: 520, freqEnd: 600, duration: 0.03, volume: 0.08 },
  squeak: { wave: "sine", freq: 640, freqEnd: 1500, attack: 0.01, duration: 0.15, volume: 0.13, vibrato: [1.2, 32] },
  pop: { wave: "sine", freq: 380, freqEnd: 1250, duration: 0.07, volume: 0.32 },
  clink: { wave: "triangle", freq: 1760, freqEnd: 1500, duration: 0.09, volume: 0.16, arp: [0, 12], arpStep: 0.025 },
  tok: { wave: "triangle", freq: 700, freqEnd: 480, duration: 0.05, volume: 0.14, lowpass: 2400 },
  bonk: { wave: "triangle", freq: 220, freqEnd: 150, duration: 0.14, volume: 0.24, lowpass: 1500, punch: 1.6 },
  creak: { wave: "sawtooth", freq: 150, freqEnd: 230, attack: 0.04, duration: 0.3, volume: 0.035, lowpass: 900, vibrato: [1.5, 23] },
  whee: { wave: "sine", freq: 1300, freqEnd: 360, attack: 0.02, duration: 0.42, volume: 0.13, vibrato: [0.4, 7] },
  crash: { wave: "noise", freq: 3400, freqEnd: 700, duration: 0.32, volume: 0.42, punch: 2.2 },
  thud: { wave: "sine", freq: 170, freqEnd: 48, duration: 0.2, volume: 0.6, punch: 2 },
  tinkle: { wave: "triangle", freq: 2093, duration: 0.24, volume: 0.07, arp: [0, 5, 3, 9, 7], arpStep: 0.035 },
  slam: { wave: "noise", freq: 900, freqEnd: 260, duration: 0.11, volume: 0.36, punch: 2.6 },
  zoom: { wave: "noise", freq: 700, freqEnd: 3200, attack: 0.03, duration: 0.26, volume: 0.17, highpass: 500 },
  boing: { wave: "sine", freq: 520, freqEnd: 170, duration: 0.26, volume: 0.24, vibrato: [1.6, 14], punch: 1.2 },
  hop: { wave: "sine", freq: 330, freqEnd: 760, duration: 0.08, volume: 0.16 },
  ding: { wave: "triangle", freq: 1319, duration: 0.42, volume: 0.2, arp: [0, 7], arpStep: 0.08 },
  bell: { wave: "triangle", freq: 1568, duration: 0.7, volume: 0.16, arp: [0, 4, 7, 12], arpStep: 0.06 },
  tier: { wave: "square", freq: 659, duration: 0.3, volume: 0.1, arp: [0, 4, 7, 12], arpStep: 0.06, lowpass: 3000 },
  fanfare: { wave: "square", freq: 523, duration: 0.6, volume: 0.12, arp: [0, 4, 7, 12, 16], arpStep: 0.09, lowpass: 2400, vibrato: [0.25, 7] },
  sproing: { wave: "sine", freq: 140, freqEnd: 900, duration: 0.42, volume: 0.28, vibrato: [2.6, 16], punch: 1.1 },
  whistleUp: { wave: "sine", freq: 420, freqEnd: 1600, attack: 0.04, duration: 0.42, volume: 0.22, vibrato: [0.35, 7] },
  kazoo: { wave: "square", freq: 196, duration: 0.34, volume: 0.13, lowpass: 1500, vibrato: [0.6, 10], punch: 0.8 },
  kazooHi: { wave: "square", freq: 262, duration: 0.3, volume: 0.12, lowpass: 1700, vibrato: [0.6, 10], punch: 0.8 },
  magnet: { wave: "sawtooth", freq: 180, freqEnd: 720, attack: 0.05, duration: 0.45, volume: 0.07, lowpass: 2000, vibrato: [0.8, 18] },
  warn: { wave: "square", freq: 440, duration: 0.18, volume: 0.08, arp: [0, -3], arpStep: 0.09, lowpass: 1800 },
  tick: { wave: "square", freq: 1800, duration: 0.025, volume: 0.07, highpass: 1200 },
  tock: { wave: "square", freq: 1200, duration: 0.03, volume: 0.09, highpass: 900 },
  buzzer: { wave: "square", freq: 150, duration: 0.55, volume: 0.15, lowpass: 900, arp: [0, -2], arpStep: 0.27, punch: 0.6 },
} satisfies Record<string, SfxParams>;
