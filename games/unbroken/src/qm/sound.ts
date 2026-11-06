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
    unlock() {
      audio.unlock();
    },
  };
}
