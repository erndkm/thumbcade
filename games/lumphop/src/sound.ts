/**
 * softbake's sound box (wooden toks, clay plaps, squelches, a little marimba, a slide whistle; copied from Pinchbake),
 * plus Lumphop's: the suck of a lump pulled off its stack, plops that climb the scale as a pot fills, the pat-pat and
 * the stamp's tok when a pot is full, a squeak when a covered lump shows itself, and a tape-rewind zip for the grace.
 */
import { createAudio, midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

const PLIP: SfxParams = { wave: "sine", freq: 760, freqEnd: 420, duration: 0.06, volume: 0.28, punch: 2.6 };
const PLAP: SfxParams = { wave: "sine", freq: 230, freqEnd: 100, duration: 0.1, volume: 0.45, punch: 2.4, lowpass: 900 };
const PLAP_MUSH: SfxParams = { wave: "noise", freq: 520, freqEnd: 200, duration: 0.07, volume: 0.2, lowpass: 1300, punch: 2 };
const SUCK: SfxParams = { wave: "sine", freq: 180, freqEnd: 520, duration: 0.12, volume: 0.32, vibrato: [1.6, 30], punch: 1.6 };
const SUCK_MUSH: SfxParams = { wave: "noise", freq: 400, freqEnd: 1400, duration: 0.08, volume: 0.14, lowpass: 2200, punch: 2 };
const PAT: SfxParams = { wave: "sine", freq: 150, freqEnd: 70, duration: 0.11, volume: 0.55, punch: 2.2, lowpass: 700 };
const PAT_MUSH: SfxParams = { wave: "noise", freq: 900, freqEnd: 300, duration: 0.06, volume: 0.24, lowpass: 1800, punch: 2.4 };
const TOK: SfxParams = { wave: "sine", freq: 980, freqEnd: 640, duration: 0.07, volume: 0.3, punch: 3.2 };
const TICK: SfxParams = { wave: "triangle", freq: 1500, duration: 0.04, volume: 0.16, punch: 3 };
const NOPE: SfxParams = { wave: "sine", freq: 420, freqEnd: 260, duration: 0.16, volume: 0.24, vibrato: [1.4, 18], punch: 1.6 };
const UHOH: SfxParams = { wave: "sine", freq: 520, freqEnd: 360, duration: 0.3, volume: 0.22, vibrato: [0.6, 7], punch: 1.2 };
const ZIP: SfxParams = { wave: "sawtooth", freq: 300, freqEnd: 1400, duration: 0.32, volume: 0.07, lowpass: 2400, vibrato: [0.8, 26], punch: 1.2 };
const SQUEAK: SfxParams = { wave: "sine", freq: 900, freqEnd: 1500, duration: 0.12, volume: 0.18, vibrato: [1.2, 22], punch: 1.4 };
const SLIDE_DOWN: SfxParams = { wave: "sine", freq: 1050, freqEnd: 220, duration: 0.7, volume: 0.26, vibrato: [0.5, 6], attack: 0.03, punch: 1.1 };
const BOING: SfxParams = { wave: "sine", freq: 300, freqEnd: 620, duration: 0.22, volume: 0.3, vibrato: [1.2, 16], punch: 1.6 };
const PUFF: SfxParams = { wave: "noise", freq: 1500, freqEnd: 500, attack: 0.02, duration: 0.32, volume: 0.24, highpass: 300, punch: 1.6 };
const BELL: SfxParams = { wave: "triangle", freq: 1568, duration: 0.6, volume: 0.22, punch: 1.2 };

export interface Sounds {
  audio: Audio;
  lift(n: number, quiet: boolean): void;
  land(height: number, quiet: boolean): void;
  putBack(): void;
  nope(): void;
  pat(second: boolean): void;
  stamp(mult: number): void;
  tier(mult: number): void;
  reveal(): void;
  clear(level: number): void;
  deal(): void;
  stuck(): void;
  rewind(): void;
  spare(): void;
  tick(left: number): void;
  over(): void;
  best(): void;
  tok(): void;
}

export function createSounds(): Sounds {
  const audio = createAudio({ volume: 0.75 });

  /** A soft wooden bar: a sine with a quick decay plus a faint, short overtone. */
  function marimba(notes: number[], step: number, vol = 0.3): void {
    const c = audio.ctx;
    const bus = audio.bus;
    if (!c || !bus || !audio.running) return;
    const t0 = c.currentTime + 0.02;
    notes.forEach((n, i) => {
      const t = t0 + i * step;
      const f = midiToFreq(n);
      for (const [mul, v, len] of [
        [1, vol, 0.42],
        [4, vol * 0.18, 0.07],
      ] as const) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.value = f * mul;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + len + 0.02);
      }
    });
  }

  const step = (k: number) => PENTATONIC[Math.min(PENTATONIC.length - 1, Math.max(0, k))]!;

  return {
    audio,
    lift(n, quiet) {
      const v = quiet ? 0.35 : 1;
      audio.play(SUCK, { volume: v, pitch: (Math.random() - 0.5) * 2 });
      audio.play(SUCK_MUSH, { volume: v });
      for (let i = 1; i < n; i++) window.setTimeout(() => audio.play(PLIP, { pitch: 4 + i * 3, volume: 0.5 * v }), i * 35);
    },
    land(height, quiet) {
      const v = quiet ? 0.3 : 1;
      audio.play(PLAP, { volume: 0.7 * v, pitch: 3 - height * 1.2 + (Math.random() - 0.5) * 1.5 });
      audio.play(PLAP_MUSH, { volume: 0.7 * v });
      marimba([64 + step(height * 2)], 0, 0.18 * v);
    },
    putBack() {
      audio.play(PLAP, { volume: 0.4, pitch: -2 });
    },
    nope() {
      audio.play(NOPE);
    },
    pat(second) {
      audio.play(PAT, { volume: second ? 0.7 : 1, pitch: second ? 2 : 0 });
      audio.play(PAT_MUSH, { volume: second ? 0.6 : 0.9 });
    },
    stamp(mult) {
      audio.play(TOK, { pitch: mult - 1 });
      marimba([67 + step(mult), 71 + step(mult), 74 + step(mult)], 0.05, 0.24);
    },
    tier(mult) {
      marimba([72, 76, 79, 84, 88].slice(0, 2 + mult).map((n) => n + mult), 0.06, 0.26);
      audio.play(BOING, { pitch: mult * 1.5 });
    },
    reveal() {
      audio.play(SQUEAK);
      audio.play(PLIP, { pitch: 7, volume: 0.6 });
    },
    clear(level) {
      audio.play(BELL);
      window.setTimeout(() => audio.play(BELL, { pitch: 4 }), 150);
      marimba([72, 76, 79, 84, 88, 91].map((n) => n + Math.min(4, level - 1)), 0.07, 0.3);
      audio.play(PUFF, { volume: 0.6 });
    },
    deal() {
      audio.play(TOK, { pitch: -3, volume: 0.6 });
    },
    stuck() {
      audio.play(UHOH);
    },
    rewind() {
      audio.play(ZIP);
      window.setTimeout(() => audio.play(ZIP, { pitch: 3, volume: 0.8 }), 140);
    },
    spare() {
      audio.play(BOING);
      window.setTimeout(() => audio.play(TOK), 120);
    },
    tick(left) {
      audio.play(TICK, { pitch: (5 - left) * 2 });
    },
    over() {
      audio.play(SLIDE_DOWN);
      audio.play(PUFF, { volume: 0.7 });
    },
    best() {
      marimba([79, 84, 88, 91, 96], 0.08, 0.3);
      audio.play(BELL, { pitch: 7 });
    },
    tok() {
      audio.play(TOK);
    },
  };
}
