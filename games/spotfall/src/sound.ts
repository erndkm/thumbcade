/**
 * Spotfall's print shop, all synthesized through the kit's audio engine (which suspends itself on pause and mute):
 * a soft "fwip" for each shot, plucked notes up a major pentatonic as a group pops, glassy plinks that climb as dropped
 * dots land in the ink pot, the press's ka-chunk, and a low hum when the sheet nears the line.
 */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

/** Major pentatonic from D: bright and open, never sour however fast the notes come. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
const ROOT = 62;

const FWIP: SfxParams = { wave: "noise", freq: 900, freqEnd: 3400, attack: 0.006, duration: 0.12, volume: 0.16, highpass: 700, punch: 1.8 };
const PUFF: SfxParams = { wave: "sine", freq: 330, freqEnd: 520, attack: 0.003, duration: 0.08, volume: 0.12 };
const TICK: SfxParams = { wave: "triangle", freq: 2100, attack: 0.001, duration: 0.03, volume: 0.09, punch: 3 };
const TOK: SfxParams = { wave: "sine", freq: 340, freqEnd: 210, attack: 0.002, duration: 0.09, volume: 0.2, punch: 2.2 };
const PAPER: SfxParams = { wave: "noise", freq: 3200, freqEnd: 1800, attack: 0.002, duration: 0.05, volume: 0.07, highpass: 1500, punch: 2 };
const PLUCK: SfxParams = { wave: "triangle", freq: 440, attack: 0.002, duration: 0.42, volume: 0.17, punch: 3, lowpass: 3600 };
const PLINK: SfxParams = { wave: "sine", freq: 880, attack: 0.002, duration: 0.5, volume: 0.12, punch: 2.6 };
const PLINK_AIR: SfxParams = { wave: "triangle", freq: 1760, attack: 0.002, duration: 0.22, volume: 0.035, punch: 3 };
const SPLASH: SfxParams = { wave: "noise", freq: 1300, freqEnd: 420, attack: 0.003, duration: 0.16, volume: 0.08, lowpass: 2600, punch: 2 };
const CHUNK: SfxParams = { wave: "sine", freq: 150, freqEnd: 58, attack: 0.003, duration: 0.22, volume: 0.42, punch: 2.2, lowpass: 700 };
const CLACK: SfxParams = { wave: "noise", freq: 1800, freqEnd: 700, attack: 0.002, duration: 0.07, volume: 0.16, punch: 2.4 };
const SWAP: SfxParams = { wave: "sine", freq: 520, freqEnd: 780, attack: 0.004, duration: 0.09, volume: 0.13 };
const SWAP_BACK: SfxParams = { wave: "sine", freq: 780, freqEnd: 560, attack: 0.004, duration: 0.08, volume: 0.09 };
const EARN: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 24), attack: 0.003, duration: 0.6, volume: 0.13, arp: [0, 4, 7, 12, 16], arpStep: 0.06, punch: 2 };
const BLOT: SfxParams = { wave: "noise", freq: 700, freqEnd: 90, attack: 0.004, duration: 0.5, volume: 0.4, punch: 1.8, lowpass: 1800 };
const BLOT_LOW: SfxParams = { wave: "sine", freq: 110, freqEnd: 40, attack: 0.003, duration: 0.4, volume: 0.42, punch: 2 };
const CLEAN: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 12), attack: 0.003, duration: 1.1, volume: 0.16, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.085, punch: 1.6 };
const BEST: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 7), attack: 0.003, duration: 0.9, volume: 0.15, arp: [0, 5, 9, 12, 17, 21, 24], arpStep: 0.07, punch: 1.6 };
const JAM: SfxParams = { wave: "sine", freq: 196, freqEnd: 52, attack: 0.01, duration: 1.1, volume: 0.34, punch: 1.3, lowpass: 600 };
const CRUMPLE: SfxParams = { wave: "noise", freq: 2600, freqEnd: 500, attack: 0.01, duration: 0.5, volume: 0.2, highpass: 600, punch: 1.2 };
const HEART: SfxParams = { wave: "sine", freq: 70, freqEnd: 52, attack: 0.004, duration: 0.15, volume: 0.24, punch: 2.6 };
const HURRY: SfxParams = { wave: "triangle", freq: 1320, attack: 0.001, duration: 0.04, volume: 0.06, punch: 3 };
const START: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 12), attack: 0.003, duration: 0.45, volume: 0.13, arp: [0, 7, 12], arpStep: 0.07, punch: 2 };

export interface Sound {
  readonly audio: Audio;
  fire(level: number): void;
  bounce(level: number): void;
  land(level: number): void;
  /** The i-th dot of a popping group; `combo` lifts the whole phrase. */
  pop(i: number, combo: number, level: number): void;
  /** The i-th dropped dot landing in the pot. */
  plink(i: number, level: number): void;
  feed(level: number): void;
  swap(back: boolean): void;
  earn(): void;
  blot(): void;
  clean(): void;
  best(): void;
  jam(): void;
  heart(): void;
  hurry(): void;
  start(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.8 });
  const note = (step: number) => midiToFreq(ROOT + (SCALE[Math.max(0, Math.min(SCALE.length - 1, step))] ?? 0)) / 440;
  const semis = (ratio: number) => 12 * Math.log2(ratio);
  return {
    audio,
    fire(level) {
      audio.play(FWIP, { volume: level });
      audio.play(PUFF, { volume: level, pitch: (Math.random() - 0.5) * 2 });
    },
    bounce(level) {
      audio.play(TICK, { volume: level, pitch: (Math.random() - 0.5) * 3 });
    },
    land(level) {
      audio.play(TOK, { volume: level, pitch: (Math.random() - 0.5) * 2 });
      audio.play(PAPER, { volume: level });
    },
    pop(i, combo, level) {
      const step = Math.min(i, 8) + Math.min(combo - 1, 6);
      audio.play(PLUCK, { volume: level * (i === 0 ? 1.1 : 0.85), pitch: semis(note(step)), pan: ((i % 5) - 2) * 0.12 });
    },
    plink(i, level) {
      const p = semis(note(Math.min(i, SCALE.length - 1))) + 12;
      audio.play(PLINK, { volume: level, pitch: p - 12 });
      audio.play(PLINK_AIR, { volume: level, pitch: p - 12 });
      audio.play(SPLASH, { volume: level * 0.8, pitch: (Math.random() - 0.5) * 4 });
    },
    feed(level) {
      audio.play(CHUNK, { volume: level });
      audio.play(CLACK, { volume: level });
    },
    swap(back) {
      audio.play(back ? SWAP_BACK : SWAP);
    },
    earn() {
      audio.play(EARN);
    },
    blot() {
      audio.play(BLOT);
      audio.play(BLOT_LOW);
    },
    clean() {
      audio.play(CLEAN);
    },
    best() {
      audio.play(BEST);
    },
    jam() {
      audio.play(JAM);
      audio.play(CRUMPLE);
    },
    heart() {
      audio.play(HEART);
    },
    hurry() {
      audio.play(HURRY);
    },
    start() {
      audio.play(START);
    },
  };
}
