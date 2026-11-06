/** softbake's sound box: wooden toks, clay plaps, macaron boings, a little marimba and a slide whistle. */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

const TOK: SfxParams = { wave: "sine", freq: 980, freqEnd: 640, duration: 0.07, volume: 0.42, punch: 3.2 };
const TOK_CLICK: SfxParams = { wave: "noise", freq: 3200, freqEnd: 1600, duration: 0.025, volume: 0.22, highpass: 1400, punch: 4 };
const PLAP: SfxParams = { wave: "sine", freq: 230, freqEnd: 110, duration: 0.1, volume: 0.45, punch: 2.4, lowpass: 900 };
const PLAP_MUSH: SfxParams = { wave: "noise", freq: 520, freqEnd: 200, duration: 0.07, volume: 0.2, lowpass: 1300, punch: 2 };
const BOING: SfxParams = { wave: "sine", freq: 300, freqEnd: 560, duration: 0.2, volume: 0.32, vibrato: [1.2, 16], punch: 1.6 };
const RATTLE: SfxParams = { wave: "triangle", freq: 520, freqEnd: 260, duration: 0.11, volume: 0.32, punch: 2.6, lowpass: 2400 };
const SLIDE_DOWN: SfxParams = { wave: "sine", freq: 1050, freqEnd: 260, duration: 0.62, volume: 0.26, vibrato: [0.5, 6], attack: 0.03, punch: 1.1 };
const BLOOP: SfxParams = { wave: "sine", freq: 260, freqEnd: 820, duration: 0.14, volume: 0.36, punch: 1.8 };
const SPLASH: SfxParams = { wave: "noise", freq: 900, freqEnd: 350, duration: 0.35, volume: 0.22, lowpass: 2200, punch: 2 };
const SHFF: SfxParams = { wave: "noise", freq: 1700, freqEnd: 900, duration: 0.16, volume: 0.12, highpass: 600, punch: 1.6 };
const SQUELCH: SfxParams = { wave: "sine", freq: 190, freqEnd: 90, duration: 0.22, volume: 0.32, vibrato: [2.5, 22], punch: 1.8 };
const POP: SfxParams = { wave: "sine", freq: 420, freqEnd: 900, duration: 0.08, volume: 0.3, punch: 2 };
const CHIRP: SfxParams = { wave: "triangle", freq: 1900, freqEnd: 2600, duration: 0.06, volume: 0.1, punch: 2 };
const CREAK: SfxParams = { wave: "sawtooth", freq: 140, freqEnd: 120, duration: 0.09, volume: 0.05, lowpass: 700, punch: 1.5 };

export interface Sounds {
  audio: Audio;
  putt(power: number): void;
  plap(speed: number): void;
  boing(speed: number): void;
  sink(kind: "ace" | "under" | "par" | "over"): void;
  miss(): void;
  splash(): void;
  sand(): void;
  squelch(): void;
  pop(pitch?: number): void;
  aimTick(power: number): void;
  chirp(): void;
  creak(): void;
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

  return {
    audio,
    putt(power) {
      audio.play(TOK, { volume: 0.55 + power * 0.5, pitch: -power * 3 });
      audio.play(TOK_CLICK, { volume: 0.5 + power * 0.5 });
    },
    plap(speed) {
      const v = Math.min(1, speed / 4);
      if (v < 0.06) return;
      audio.play(PLAP, { volume: 0.3 + v * 0.7, pitch: Math.random() * 2 - 1 });
      audio.play(PLAP_MUSH, { volume: v });
    },
    boing(speed) {
      audio.play(BOING, { volume: 0.4 + Math.min(1, speed / 5) * 0.6, pitch: Math.random() * 3 });
    },
    sink(kind) {
      audio.play(RATTLE);
      // C major pentatonic runs; the better the putt, the longer the run.
      const runs = { ace: [72, 74, 76, 79, 81, 84, 86, 88], under: [72, 76, 79, 84, 88], par: [72, 76, 79], over: [72, 74] } as const;
      marimba([...runs[kind]], kind === "ace" ? 0.07 : 0.085);
    },
    miss() {
      audio.play(SLIDE_DOWN);
    },
    splash() {
      audio.play(BLOOP);
      audio.play(SPLASH);
    },
    sand() {
      audio.play(SHFF);
    },
    squelch() {
      audio.play(SQUELCH, { pitch: Math.random() * 3 - 1.5 });
    },
    pop(pitch = 0) {
      audio.play(POP, { pitch });
    },
    aimTick(power) {
      marimba([60 + Math.round(power * 10) * 2], 0, 0.06);
    },
    chirp() {
      audio.play(CHIRP, { pitch: Math.random() * 4 });
    },
    creak() {
      audio.play(CREAK);
    },
  };
}
