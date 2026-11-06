import { createAudio, type SfxParams } from "@thumbcade-games/kit/audio";

/**
 * A small, quiet sound palette: woody marimba plucks, a muted bell, paper rustle, a soft wooden "tok"
 * for a smudge, and a faint clock tick. All synthesized; nothing louder than a page turning.
 */

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Major pentatonic: nothing ever clashes. */
const PENTA = [0, 2, 4, 7, 9];

export function scaleNote(step: number, base = 62): number {
  const o = Math.floor(step / 5);
  return base + o * 12 + PENTA[((step % 5) + 5) % 5]!;
}

export interface Sound {
  pluck(midi: number, vol?: number): void;
  bell(midi?: number): void;
  rustle(vol?: number): void;
  smudge(): void;
  tick(): void;
  /** A rubber stamp pressed into the page: a soft wooden thump with a little paper in it. */
  stamp(vol?: number): void;
  /** A slip set down on wood: short, dry, pitched a little by where it lands. */
  tok(vol?: number, pitch?: number): void;
  /** A slip turning face up: a light paper flick. */
  flip(vol?: number): void;
  /** Three plucks of a chord, quick, rising from `step` on the scale. */
  chord(step: number, vol?: number): void;
  unlock(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.5 });
  const play = (p: SfxParams) => audio.play(p);
  return {
    pluck(midi, vol = 1) {
      const f = hz(midi);
      // Fundamental with a fast woody decay, the bar's bright 4th partial, and a tiny mallet tick.
      play({ wave: "sine", freq: f, duration: 0.5, volume: 0.2 * vol, attack: 0.002, punch: 2.8 });
      play({ wave: "sine", freq: f * 3.93, duration: 0.11, volume: 0.04 * vol, attack: 0.001, punch: 3.5 });
      play({ wave: "triangle", freq: f * 9.2, duration: 0.02, volume: 0.016 * vol, lowpass: 5200 });
    },
    bell(midi = 81) {
      const f = hz(midi);
      play({ wave: "sine", freq: f, duration: 2.2, volume: 0.12, attack: 0.004, punch: 1.25, lowpass: 2600 });
      play({ wave: "sine", freq: f * 2.76, duration: 1.1, volume: 0.035, attack: 0.003, punch: 1.6 });
      play({ wave: "sine", freq: f * 5.4, duration: 0.45, volume: 0.016, attack: 0.002, punch: 2 });
      play({ wave: "sine", freq: f * 0.5, duration: 1.6, volume: 0.05, attack: 0.01, punch: 1.4 });
    },
    rustle(vol = 1) {
      play({ wave: "noise", freq: 3400, freqEnd: 1700, attack: 0.035, duration: 0.24, volume: 0.06 * vol, highpass: 900, punch: 1.6 });
    },
    smudge() {
      play({ wave: "sine", freq: 196, freqEnd: 146, duration: 0.16, volume: 0.13, attack: 0.003, punch: 2.4 });
      play({ wave: "noise", freq: 700, freqEnd: 260, duration: 0.12, volume: 0.05, lowpass: 900, punch: 2 });
    },
    tick() {
      play({ wave: "triangle", freq: 1320, duration: 0.035, volume: 0.03, lowpass: 3000, punch: 3 });
    },
    stamp(vol = 1) {
      play({ wave: "sine", freq: 150, freqEnd: 92, duration: 0.14, volume: 0.22 * vol, attack: 0.002, punch: 2.6 });
      play({ wave: "noise", freq: 1200, freqEnd: 420, duration: 0.07, volume: 0.07 * vol, lowpass: 1800, punch: 2.2 });
    },
    tok(vol = 1, pitch = 0) {
      const f = 520 * 2 ** (pitch / 12);
      play({ wave: "triangle", freq: f, freqEnd: f * 0.7, duration: 0.05, volume: 0.09 * vol, attack: 0.001, punch: 3, lowpass: 2600 });
      play({ wave: "noise", freq: 2400, freqEnd: 900, duration: 0.035, volume: 0.035 * vol, highpass: 700, punch: 2.5 });
    },
    flip(vol = 1) {
      play({ wave: "noise", freq: 5200, freqEnd: 2600, attack: 0.004, duration: 0.07, volume: 0.04 * vol, highpass: 1800, punch: 2 });
      play({ wave: "sine", freq: 1760, freqEnd: 2200, duration: 0.04, volume: 0.025 * vol, punch: 3 });
    },
    chord(step, vol = 1) {
      [0, 2, 4].forEach((k, i) => window.setTimeout(() => this.pluck(scaleNote(step + k, 62), (0.75 - i * 0.08) * vol), i * 55));
    },
    unlock() {
      audio.unlock();
    },
  };
}
