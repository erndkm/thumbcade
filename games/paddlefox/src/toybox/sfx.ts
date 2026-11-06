import type { Audio, SfxParams } from "@thumbcade-games/kit/audio";

/** lowpolyfox's sound box: wooden toks, bubbly hops, kalimba plinks, soft water. */
export const S = {
  tok: { wave: "triangle", freq: 760, freqEnd: 520, duration: 0.07, volume: 0.34, lowpass: 2600, punch: 3 },
  tokLow: { wave: "triangle", freq: 420, freqEnd: 300, duration: 0.08, volume: 0.36, lowpass: 1800, punch: 3 },
  hop: { wave: "sine", freq: 300, freqEnd: 780, duration: 0.12, volume: 0.26, punch: 1.6 },
  bubble: { wave: "sine", freq: 520, freqEnd: 1200, duration: 0.06, volume: 0.18, punch: 2 },
  plop: { wave: "sine", freq: 900, freqEnd: 240, duration: 0.09, volume: 0.16, punch: 2 },
  splash: { wave: "noise", freq: 2400, freqEnd: 500, duration: 0.42, volume: 0.36, lowpass: 4200, punch: 2.2 },
  sploosh: { wave: "noise", freq: 1200, freqEnd: 260, duration: 0.6, volume: 0.42, lowpass: 2600, punch: 1.8 },
  swish: { wave: "noise", freq: 900, freqEnd: 2000, attack: 0.03, duration: 0.16, volume: 0.1, highpass: 600 },
  rustle: { wave: "noise", freq: 3200, freqEnd: 1800, duration: 0.12, volume: 0.08, highpass: 1500 },
  bonk: { wave: "triangle", freq: 240, freqEnd: 90, duration: 0.22, volume: 0.42, lowpass: 1400, punch: 2.4 },
  sad: { wave: "triangle", freq: 523, freqEnd: 262, duration: 0.55, volume: 0.18, vibrato: [0.3, 6], lowpass: 2200 },
} satisfies Record<string, SfxParams>;

/** Major pentatonic, two octaves: everything sounds friendly. */
export const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A kalimba-ish plink: a sine with a quick decay plus a faint metallic partial. */
export function plink(audio: Audio, midi: number, volume = 1): void {
  const f = hz(midi);
  audio.play({ wave: "sine", freq: f, duration: 0.5, volume: 0.22 * volume, punch: 3.4 });
  audio.play({ wave: "triangle", freq: f * 4.02, duration: 0.09, volume: 0.035 * volume, punch: 3 });
}

/** Rising plinks for streaks: step 0, 1, 2... climbs the pentatonic scale. */
export function streak(audio: Audio, step: number, root = 72): void {
  plink(audio, root + PENTA[Math.min(step, PENTA.length - 1)]!);
}

/** A three-note kalimba flourish (new best, big catches). */
export function flourish(audio: Audio, root = 72): void {
  const c = audio.ctx;
  if (!c) return;
  [0, 4, 7].forEach((n, i) => window.setTimeout(() => plink(audio, root + n, 0.9), i * 85));
}
