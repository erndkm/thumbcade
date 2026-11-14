/**
 * Scribbledelve's sounds, all synthesized on the kit's audio engine (so pause and mute silence them): a pencil tick
 * for every coin that climbs a marimba scale with the streak, the knight's footfall when he turns, a bump against a
 * pen line, the sword's ring, a scribble being drawn, the poof when one is crossed out, the squeak when he's caught,
 * a chord for a cleared floor and the page being rubbed out for the next one.
 */
import { midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

export const S = {
  step: { wave: "square", freq: 1500, duration: 0.016, volume: 0.045, highpass: 900 },
  bump: { wave: "sine", freq: 150, freqEnd: 90, duration: 0.09, volume: 0.22, punch: 2 },
  sword: { wave: "triangle", freq: 1175, duration: 0.5, volume: 0.2, arp: [0, 7, 12, 19], arpStep: 0.05 },
  shing: { wave: "noise", freq: 5200, freqEnd: 7000, attack: 0.01, duration: 0.3, volume: 0.1, highpass: 3200 },
  braveEnd: { wave: "triangle", freq: 660, freqEnd: 330, duration: 0.3, volume: 0.14 },
  scribble: { wave: "noise", freq: 3600, freqEnd: 4800, duration: 0.2, volume: 0.07, highpass: 2400 },
  poof: { wave: "noise", freq: 1800, freqEnd: 600, attack: 0.01, duration: 0.26, volume: 0.24, highpass: 500 },
  pop: { wave: "sine", freq: 520, freqEnd: 1100, duration: 0.07, volume: 0.22 },
  eep: { wave: "sine", freq: 980, freqEnd: 420, duration: 0.26, volume: 0.16, vibrato: [1.2, 26] },
  crumple: { wave: "noise", freq: 2600, freqEnd: 900, attack: 0.02, duration: 0.3, volume: 0.22, highpass: 900 },
  phew: { wave: "noise", freq: 900, freqEnd: 2400, attack: 0.04, duration: 0.2, volume: 0.1, highpass: 600 },
  star: { wave: "triangle", freq: 1047, duration: 0.5, volume: 0.17, arp: [0, 4, 7, 12, 16], arpStep: 0.05 },
  tier: { wave: "triangle", freq: 784, duration: 0.3, volume: 0.15, arp: [0, 5, 9], arpStep: 0.06 },
  lost: { wave: "sine", freq: 300, freqEnd: 180, duration: 0.2, volume: 0.1 },
  clear: { wave: "triangle", freq: 523, duration: 0.8, volume: 0.24, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.07 },
  heart: { wave: "triangle", freq: 659, duration: 0.4, volume: 0.18, arp: [0, 5, 9, 12], arpStep: 0.07 },
  rub: { wave: "noise", freq: 1200, freqEnd: 2600, attack: 0.08, duration: 0.5, volume: 0.14, highpass: 600 },
  out: { wave: "triangle", freq: 392, freqEnd: 196, duration: 0.7, volume: 0.18, vibrato: [0.4, 6] },
  best: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.24, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.08 },
} satisfies Record<string, SfxParams>;

/** A coin's note: up the pentatonic scale as the streak grows, an octave higher for every multiplier. */
export function coinNote(audio: Audio, streak: number, mult: number, volume = 1): void {
  const step = PENTATONIC[(streak - 1) % 6]!;
  audio.note(midiToFreq(72 + step + (mult - 1) * 5), 0.07, "triangle", 0.11 * volume);
}
