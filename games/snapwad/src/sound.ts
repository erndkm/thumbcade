/**
 * Snapwad's sounds, all synthesized on the kit's audio engine (so pause and mute silence them): the band creaking
 * as it stretches and twanging when it lets go, the wad's whoosh and paper thump, a knock for every material (wood
 * for pencils, a rubbery boing for erasers, a plastic clack for the ruler, a papery flap for sticky notes and cups),
 * a pencil snapping, a doodle's squeak when it's knocked out and the red pen scribbling it away, a marimba that
 * climbs the chain, a chord for a cleared page and the page turning.
 */
import { midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";
import type { Kind } from "./pieces.ts";

export const S = {
  creak: { wave: "sine", freq: 260, freqEnd: 330, duration: 0.07, volume: 0.07, vibrato: [1.5, 38] },
  twang: { wave: "triangle", freq: 196, freqEnd: 120, duration: 0.28, volume: 0.3, vibrato: [0.8, 22], punch: 1.8 },
  twangHi: { wave: "sawtooth", freq: 392, freqEnd: 240, duration: 0.12, volume: 0.06, lowpass: 1800 },
  whoosh: { wave: "noise", freq: 700, freqEnd: 2200, attack: 0.03, duration: 0.22, volume: 0.12, highpass: 500 },
  thump: { wave: "noise", freq: 900, freqEnd: 300, duration: 0.09, volume: 0.22, punch: 2.4 },
  wood: { wave: "square", freq: 420, freqEnd: 260, duration: 0.06, volume: 0.13, lowpass: 1600, punch: 2.6 },
  boing: { wave: "sine", freq: 150, freqEnd: 230, duration: 0.16, volume: 0.22, vibrato: [1.5, 18], punch: 1.6 },
  clack: { wave: "square", freq: 1300, freqEnd: 900, duration: 0.035, volume: 0.1, highpass: 700 },
  paper: { wave: "noise", freq: 2400, freqEnd: 1200, duration: 0.08, volume: 0.14, highpass: 900 },
  book: { wave: "sine", freq: 130, freqEnd: 70, duration: 0.14, volume: 0.28, punch: 2 },
  snap: { wave: "noise", freq: 3600, freqEnd: 900, duration: 0.11, volume: 0.34, highpass: 1200, punch: 2.8 },
  snapLow: { wave: "square", freq: 220, freqEnd: 90, duration: 0.08, volume: 0.1, lowpass: 900 },
  burst: { wave: "noise", freq: 1800, freqEnd: 700, attack: 0.01, duration: 0.3, volume: 0.24, highpass: 500 },
  crumple: { wave: "noise", freq: 2600, freqEnd: 900, attack: 0.02, duration: 0.24, volume: 0.22, highpass: 900 },
  eep: { wave: "sine", freq: 880, freqEnd: 1500, duration: 0.12, volume: 0.13, vibrato: [1, 30] },
  scribble: { wave: "noise", freq: 3800, freqEnd: 4800, duration: 0.18, volume: 0.07, highpass: 2400 },
  pop: { wave: "sine", freq: 520, freqEnd: 1100, duration: 0.07, volume: 0.2 },
  refund: { wave: "triangle", freq: 659, duration: 0.2, volume: 0.16, arp: [0, 7], arpStep: 0.06 },
  chain: { wave: "triangle", freq: 523, duration: 0.42, volume: 0.2, arp: [0, 4, 7, 12], arpStep: 0.06 },
  topple: { wave: "noise", freq: 260, freqEnd: 90, attack: 0.05, duration: 0.6, volume: 0.24, lowpass: 600, punch: 1.2 },
  clear: { wave: "triangle", freq: 523, duration: 0.8, volume: 0.24, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.07 },
  oneShot: { wave: "triangle", freq: 659, duration: 0.9, volume: 0.24, arp: [0, 5, 9, 12, 17, 21, 24], arpStep: 0.07 },
  turn: { wave: "noise", freq: 1200, freqEnd: 3400, attack: 0.08, duration: 0.45, volume: 0.18, highpass: 600 },
  pen: { wave: "noise", freq: 4200, freqEnd: 5200, duration: 0.05, volume: 0.035, highpass: 2600 },
  star: { wave: "triangle", freq: 1047, duration: 0.5, volume: 0.17, arp: [0, 4, 7, 12, 16], arpStep: 0.05 },
  tape: { wave: "sine", freq: 220, freqEnd: 110, duration: 0.3, volume: 0.32, punch: 1.6 },
  drain: { wave: "noise", freq: 1500, freqEnd: 700, attack: 0.05, duration: 0.4, volume: 0.13, highpass: 400 },
  slow: { wave: "sine", freq: 300, freqEnd: 140, attack: 0.05, duration: 0.7, volume: 0.14 },
  out: { wave: "triangle", freq: 392, freqEnd: 196, duration: 0.7, volume: 0.18, vibrato: [0.4, 6] },
  best: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.24, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.08 },
  click: { wave: "square", freq: 2400, duration: 0.02, volume: 0.07, highpass: 900 },
  news: { wave: "triangle", freq: 784, duration: 0.3, volume: 0.13, arp: [0, 5, 9], arpStep: 0.07 },
} satisfies Record<string, SfxParams>;

/** The knock a material makes when something hits it. */
export function knockOf(k: Kind | null): SfxParams {
  switch (k) {
    case "pencil":
    case "pencilTip":
    case "pencilEnd":
      return S.wood;
    case "eraser":
      return S.boing;
    case "ruler":
      return S.clack;
    case "pad":
    case "cup":
      return S.paper;
    case "wad":
      return S.thump;
    case "tape":
      return S.tape;
    case null:
      return S.book;
    default:
      return S.pop;
  }
}

/** The chain's note: up the pentatonic scale with every doodle the same wad knocks out. */
export function chainNote(audio: Audio, n: number, volume = 1): void {
  const step = PENTATONIC[Math.min(n - 1, PENTATONIC.length - 1)]!;
  audio.note(midiToFreq(67 + step), 0.18, "triangle", 0.16 * volume);
}
