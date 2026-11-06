import type { SfxParams } from "@thumbcade-games/kit/audio";

/**
 * juicefactory's sound palette (boings, thunks, slide whistles, kazoo squares), plus Brinebop's water: bubble
 * blubs that climb a scale with the chain, squirts, a sploosh, the conch's honk and the cash-out register.
 */
export const S = {
  whoop: { wave: "sine", freq: 340, freqEnd: 720, duration: 0.09, volume: 0.26 },
  boop: { wave: "triangle", freq: 300, duration: 0.2, volume: 0.2, arp: [0, -4], arpStep: 0.09, lowpass: 1800 },
  plip: { wave: "sine", freq: 1100, freqEnd: 620, duration: 0.035, volume: 0.07 },
  lift: { wave: "triangle", freq: 620, freqEnd: 820, duration: 0.05, volume: 0.1 },
  blub: { wave: "sine", freq: 420, freqEnd: 980, duration: 0.1, volume: 0.32, punch: 1.6 },
  pop: { wave: "sine", freq: 320, freqEnd: 960, duration: 0.08, volume: 0.3 },
  sproing: { wave: "sine", freq: 140, freqEnd: 900, duration: 0.42, volume: 0.32, vibrato: [2.6, 16], punch: 1.1 },
  ding: { wave: "triangle", freq: 988, duration: 0.36, volume: 0.22, arp: [0, 4, 7, 12], arpStep: 0.05 },
  squirt: { wave: "noise", freq: 900, freqEnd: 4200, attack: 0.02, duration: 0.3, volume: 0.32, highpass: 600 },
  sploosh: { wave: "noise", freq: 1400, freqEnd: 120, duration: 0.5, volume: 0.5, punch: 1.6 },
  thud: { wave: "sine", freq: 180, freqEnd: 46, duration: 0.24, volume: 0.7, punch: 2 },
  crack: { wave: "noise", freq: 2600, freqEnd: 500, duration: 0.07, volume: 0.42, punch: 2.6 },
  honk: { wave: "square", freq: 196, duration: 0.42, volume: 0.16, lowpass: 1400, vibrato: [0.6, 9], punch: 0.8 },
  honkHi: { wave: "square", freq: 294, duration: 0.3, volume: 0.13, lowpass: 1700, vibrato: [0.6, 9], punch: 0.8 },
  whistleUp: { wave: "sine", freq: 420, freqEnd: 1600, attack: 0.04, duration: 0.45, volume: 0.26, vibrato: [0.35, 7] },
  whistleDown: { wave: "sine", freq: 1400, freqEnd: 300, attack: 0.03, duration: 0.55, volume: 0.24, vibrato: [0.4, 6] },
  swirl: { wave: "sine", freq: 300, freqEnd: 1200, attack: 0.05, duration: 0.5, volume: 0.18, vibrato: [3, 9] },
  tick: { wave: "square", freq: 1800, duration: 0.025, volume: 0.07, highpass: 1200 },
  tock: { wave: "square", freq: 1200, duration: 0.03, volume: 0.09, highpass: 900 },
  buzzer: { wave: "square", freq: 150, duration: 0.55, volume: 0.15, lowpass: 900, arp: [0, -2], arpStep: 0.27, punch: 0.6 },
  chaChing: { wave: "triangle", freq: 1047, duration: 0.3, volume: 0.22, arp: [0, 7, 12, 16], arpStep: 0.045 },
  fanfare: { wave: "square", freq: 523, duration: 0.6, volume: 0.12, arp: [0, 4, 7, 12, 16], arpStep: 0.09, lowpass: 2400, vibrato: [0.25, 7] },
  kazoo: { wave: "square", freq: 330, duration: 0.18, volume: 0.12, lowpass: 1700, vibrato: [0.5, 11], punch: 0.8 },
} satisfies Record<string, SfxParams>;
