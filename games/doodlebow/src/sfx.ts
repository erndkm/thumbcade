import type { Audio, SfxParams } from "@thumbcade-games/kit/audio";

/** marginalia's sound palette: pencil, paper, a twangy string, rubber and a desk bell. All synthesized. */
const S = {
  /** Pencil scratch: a short bandpassed hiss. */
  scratch: { wave: "noise", freq: 3400, freqEnd: 2300, duration: 0.07, volume: 0.12, highpass: 1500, punch: 1.3 },
  scratchLow: { wave: "noise", freq: 2200, freqEnd: 1600, duration: 0.09, volume: 0.12, highpass: 900, punch: 1.2 },
  /** Paper flick. */
  flick: { wave: "noise", freq: 5200, freqEnd: 1700, duration: 0.05, volume: 0.24, highpass: 2200, punch: 3 },
  /** The bow string: a detuned, vibrating low note with a quick drop. */
  twang: { wave: "sawtooth", freq: 165, freqEnd: 128, duration: 0.34, volume: 0.14, lowpass: 1300, vibrato: [0.45, 14], punch: 2.4 },
  twangHi: { wave: "triangle", freq: 330, freqEnd: 262, duration: 0.24, volume: 0.1, vibrato: [0.3, 17], punch: 2 },
  /** Bow creak while drawing. */
  creak: { wave: "sawtooth", freq: 84, freqEnd: 96, duration: 0.07, volume: 0.05, lowpass: 600, punch: 1.2 },
  /** Balloon pop: a sine blip plus a puff of air. */
  pop: { wave: "sine", freq: 420, freqEnd: 1300, duration: 0.06, volume: 0.4, punch: 2 },
  popAir: { wave: "noise", freq: 2600, freqEnd: 800, duration: 0.1, volume: 0.24, highpass: 700, punch: 2.6 },
  /** Arrow into cardboard. */
  thock: { wave: "sine", freq: 230, freqEnd: 86, duration: 0.13, volume: 0.5, punch: 2.6 },
  thockGrit: { wave: "noise", freq: 900, freqEnd: 420, duration: 0.06, volume: 0.22, punch: 3 },
  /** A desk bell for the bull. */
  ding: { wave: "triangle", freq: 1175, duration: 0.42, volume: 0.17, arp: [0, 7, 12], arpStep: 0.055, punch: 1.6 },
  /** Paper crumple. */
  crumple: { wave: "noise", freq: 2600, freqEnd: 1100, duration: 0.16, volume: 0.22, punch: 1.4, highpass: 600 },
  /** Gold star. */
  sparkle: { wave: "triangle", freq: 988, duration: 0.5, volume: 0.15, arp: [0, 4, 7, 12, 16], arpStep: 0.05, punch: 1.5 },
  /** Eraser rub. */
  erase: { wave: "noise", freq: 700, freqEnd: 1150, attack: 0.03, duration: 0.18, volume: 0.2, lowpass: 2400, punch: 1.1 },
  /** Arrow into the ground. */
  thud: { wave: "noise", freq: 380, freqEnd: 140, duration: 0.1, volume: 0.3, punch: 2.5 },
  /** Out of arrows: a little sad slide. */
  sad: { wave: "triangle", freq: 392, duration: 0.62, volume: 0.17, arp: [0, -3, -7, -12], arpStep: 0.12, vibrato: [0.2, 6] },
  /** Streak multiplier up. */
  up: { wave: "triangle", freq: 659, duration: 0.24, volume: 0.15, arp: [0, 5, 12], arpStep: 0.06 },
} satisfies Record<string, SfxParams>;

export type Sound = keyof typeof S;

export function sfx(audio: Audio) {
  const play = (name: Sound, pitch = 0, volume = 1, pan = 0) => audio.play(S[name], { pitch, volume, pan });
  return {
    play,
    shoot(power: number, pan: number) {
      play("twang", (1 - power) * 3, 1, pan);
      play("twangHi", (1 - power) * 3, 0.8, pan);
      play("flick", 0, 0.9, pan);
    },
    pop(pan: number) {
      play("pop", Math.random() * 3 - 1, 1, pan);
      play("popAir", 0, 1, pan);
    },
    thock(pan: number) {
      play("thock", 0, 1, pan);
      play("thockGrit", 0, 1, pan);
    },
    scribble() {
      play("scratch", Math.random() * 2);
      play("scratchLow", Math.random() * 2, 0.8);
    },
  };
}
