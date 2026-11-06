/**
 * Tumbledoodle's sounds, all synthesized on the kit's audio engine (so pause and mute silence them): gulps pitched by
 * size, a marimba note that climbs the combo, a paper rip when the tear grows, boings off the rim, the eraser's
 * squeak and rub, a burp when a feast ends, the clock's last ticks and the final gulp.
 */
import { midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

export const S = {
  gulp: { wave: "sine", freq: 560, freqEnd: 150, duration: 0.12, volume: 0.3, punch: 1.6 },
  plop: { wave: "noise", freq: 1100, freqEnd: 260, duration: 0.07, volume: 0.14, punch: 2.4 },
  bigGulp: { wave: "sine", freq: 300, freqEnd: 55, duration: 0.5, volume: 0.42, punch: 1.2 },
  feast: { wave: "triangle", freq: 523, duration: 0.42, volume: 0.2, arp: [0, 4, 7, 12], arpStep: 0.06 },
  burp: { wave: "square", freq: 118, freqEnd: 76, duration: 0.26, volume: 0.1, lowpass: 700, vibrato: [1.6, 24] },
  rip: { wave: "noise", freq: 2600, freqEnd: 700, attack: 0.02, duration: 0.42, volume: 0.32, highpass: 400, punch: 1 },
  ripLow: { wave: "sawtooth", freq: 140, freqEnd: 70, duration: 0.3, volume: 0.07, lowpass: 900 },
  tier: { wave: "triangle", freq: 392, duration: 0.6, volume: 0.22, arp: [0, 4, 7, 12, 16], arpStep: 0.07 },
  boing: { wave: "sine", freq: 250, freqEnd: 330, duration: 0.22, volume: 0.14, vibrato: [2.5, 16] },
  squeak: { wave: "sine", freq: 1500, freqEnd: 1900, duration: 0.16, volume: 0.09, vibrato: [1.2, 32] },
  rub: { wave: "noise", freq: 600, freqEnd: 420, attack: 0.03, duration: 0.3, volume: 0.3, lowpass: 1500 },
  rubSoft: { wave: "noise", freq: 900, freqEnd: 700, attack: 0.02, duration: 0.12, volume: 0.07, lowpass: 1800 },
  scrub: { wave: "square", freq: 220, freqEnd: 110, duration: 0.2, volume: 0.1, lowpass: 900 },
  scared: { wave: "sine", freq: 900, freqEnd: 1400, duration: 0.18, volume: 0.08, vibrato: [2, 20] },
  eaten: { wave: "triangle", freq: 523, duration: 0.8, volume: 0.24, arp: [0, 7, 12, 16, 19, 24], arpStep: 0.07 },
  scribble: { wave: "noise", freq: 3800, freqEnd: 4800, duration: 0.09, volume: 0.03, highpass: 2400 },
  tick: { wave: "square", freq: 1046, duration: 0.045, volume: 0.07, lowpass: 3000 },
  lastBites: { wave: "triangle", freq: 659, duration: 0.36, volume: 0.18, arp: [0, 5, 7, 12], arpStep: 0.05 },
  finalGulp: { wave: "sine", freq: 220, freqEnd: 38, duration: 1.1, volume: 0.5, punch: 0.9 },
  rumble: { wave: "noise", freq: 260, freqEnd: 90, attack: 0.1, duration: 1.0, volume: 0.26, lowpass: 500, punch: 1 },
  stitch: { wave: "square", freq: 1900, duration: 0.02, volume: 0.06, highpass: 1200 },
  best: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.24, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.08 },
  click: { wave: "square", freq: 2400, duration: 0.02, volume: 0.07, highpass: 900 },
} satisfies Record<string, SfxParams>;

/** The combo's note: up the pentatonic scale, an octave higher once it's a feast. */
export function comboNote(audio: Audio, combo: number, feast: number, volume = 1): void {
  const step = PENTATONIC[Math.min(combo - 1, PENTATONIC.length - 1)]!;
  audio.note(midiToFreq(62 + step + (feast >= 2 ? 12 : 0)), 0.16, "triangle", 0.14 * volume);
}
