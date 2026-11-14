/**
 * Ringblot's sounds as data: every effect's recipe for the kit's synth, and the two patterns of the bed. Kept apart
 * from the audio engine so the tests can check the cue table against it without an audio device.
 */
import type { SfxParams } from "@thumbcade-games/kit/audio";

export const S = {
  step: { wave: "sine", freq: 620, freqEnd: 520, attack: 0.002, duration: 0.035, volume: 0.05, punch: 2.4 },
  bonk: { wave: "sine", freq: 150, freqEnd: 95, attack: 0.003, duration: 0.1, volume: 0.2, punch: 2.2 },
  wet: { wave: "noise", freq: 2400, freqEnd: 3400, attack: 0.01, duration: 0.09, volume: 0.05, highpass: 1600, punch: 1.6 },
  print: { wave: "triangle", freq: 349, attack: 0.002, duration: 0.42, volume: 0.17, punch: 3, lowpass: 3400 },
  pull: { wave: "triangle", freq: 698, attack: 0.003, duration: 0.5, volume: 0.1, arp: [0, 4, 7, 12], arpStep: 0.06, punch: 1.8 },
  roll: { wave: "noise", freq: 500, freqEnd: 1500, attack: 0.05, duration: 0.5, volume: 0.1, lowpass: 2400, punch: 1.2 },
  rivalPrint: { wave: "sine", freq: 233, attack: 0.004, duration: 0.2, volume: 0.05, punch: 2.4 },
  shave: { wave: "noise", freq: 1100, freqEnd: 2600, attack: 0.03, duration: 0.2, volume: 0.08, highpass: 700, punch: 1.4 },
  smudge: { wave: "noise", freq: 1700, freqEnd: 420, attack: 0.004, duration: 0.3, volume: 0.24, lowpass: 3000, punch: 1.8 },
  bell: { wave: "sine", freq: 1397, attack: 0.002, duration: 0.9, volume: 0.09, punch: 1.5, vibrato: [0.1, 5] },
  boxed: { wave: "sine", freq: 196, freqEnd: 110, attack: 0.004, duration: 0.28, volume: 0.22, punch: 1.8 },
  lost: { wave: "triangle", freq: 523, freqEnd: 349, attack: 0.004, duration: 0.3, volume: 0.09, punch: 1.6 },
  crawl: { wave: "noise", freq: 3200, freqEnd: 4200, attack: 0.02, duration: 0.16, volume: 0.04, highpass: 2200, punch: 1.4 },
  low: { wave: "triangle", freq: 440, attack: 0.004, duration: 0.5, volume: 0.1, arp: [0, -3, 0, -3], arpStep: 0.11, punch: 1.2 },
  tick: { wave: "sine", freq: 880, attack: 0.002, duration: 0.06, volume: 0.09, punch: 2.6 },
  sheet: { wave: "triangle", freq: 523, attack: 0.004, duration: 1.1, volume: 0.16, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.09, punch: 1.5 },
  fresh: { wave: "noise", freq: 900, freqEnd: 2600, attack: 0.08, duration: 0.42, volume: 0.09, highpass: 500, punch: 1.2 },
  dry: { wave: "triangle", freq: 392, freqEnd: 196, attack: 0.004, duration: 0.8, volume: 0.14, vibrato: [0.3, 5], punch: 1.2 },
  best: { wave: "triangle", freq: 523, attack: 0.003, duration: 0.9, volume: 0.15, arp: [0, 5, 9, 12, 17, 21, 24], arpStep: 0.07, punch: 1.6 },
  start: { wave: "triangle", freq: 349, attack: 0.004, duration: 0.5, volume: 0.12, arp: [0, 7, 12], arpStep: 0.08, punch: 1.6 },
} satisfies Record<string, SfxParams>;

export type SoundName = keyof typeof S;

/** The bed: eight steps to the bar, a low pulse on the beat and a higher answer (MIDI notes; null rests). */
export const WALK: Array<number | null> = [41, null, 53, null, 48, null, 53, 56, 41, null, 53, null, 46, null, 53, 60];
export const HURRY: Array<number | null> = [41, 53, 48, 53, 41, 56, 48, 60, 41, 53, 46, 53, 41, 58, 48, 60];
