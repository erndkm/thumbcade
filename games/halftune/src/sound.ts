/**
 * The instrument: every tile you play sounds its note, so the tune only exists as fast and as well as you play it.
 * A music-box voice (sine and triangle with a bright octave partial and a felt-hammer click) for the melody, a soft
 * plucked bass and a quiet triad on chord changes. Long notes sustain while held. All synthesized; the kit's audio
 * context suspends itself on pause and mute.
 */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";
import type { Judge } from "./sim.ts";

const CLICK: SfxParams = { wave: "noise", freq: 3200, freqEnd: 1800, attack: 0.001, duration: 0.025, volume: 0.05, highpass: 1500 };
const THUD: SfxParams = { wave: "sine", freq: 150, freqEnd: 60, attack: 0.002, duration: 0.2, volume: 0.32, punch: 2.4, lowpass: 700 };
const SMUDGE: SfxParams = { wave: "noise", freq: 900, freqEnd: 300, attack: 0.004, duration: 0.18, volume: 0.16, punch: 2, lowpass: 1600 };
const CLAP: SfxParams = { wave: "noise", freq: 1800, attack: 0.001, duration: 0.05, volume: 0.07, highpass: 900, punch: 3 };
const DRUM: SfxParams = { wave: "sine", freq: 110, freqEnd: 48, attack: 0.002, duration: 0.3, volume: 0.42, punch: 2.2, lowpass: 500 };
const SHEET: SfxParams = { wave: "noise", freq: 2400, freqEnd: 5200, attack: 0.03, duration: 0.22, volume: 0.06, highpass: 1500 };
const END: SfxParams = { wave: "sine", freq: 196, freqEnd: 82, attack: 0.02, duration: 1.1, volume: 0.24, punch: 1.3, lowpass: 900 };

export interface Voice {
  stop(full: boolean): void;
}

export interface Sound {
  readonly audio: Audio;
  /** A tile played. Returns a handle for a held note. `level` < 1 in attract mode. */
  note(midi: number, chord: number[] | null, judge: Judge, hold: boolean, level: number): Voice | null;
  wrong(): void;
  miss(): void;
  mult(m: number): void;
  clear(clean: boolean): void;
  encore(): void;
  start(): void;
  card(): void;
  best(): void;
  end(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.8 });

  function live(): { c: AudioContext; bus: GainNode } | null {
    const c = audio.ctx;
    const bus = audio.bus;
    if (!c || !bus || c.state !== "running" || audio.muted) return null;
    return { c, bus };
  }

  /** One music-box voice. Sustains at `sustain` until stopped (or decays on its own when sustain is 0). */
  function voice(f: number, peak: number, sustain: number, tau: number, bright: number): Voice | null {
    const a = live();
    if (!a) return null;
    const { c, bus } = a;
    const t0 = c.currentTime + 0.003;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    env.gain.setTargetAtTime(peak * sustain, t0 + 0.004, tau);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(Math.min(9000, f * 7), t0);
    lp.frequency.setTargetAtTime(Math.min(5000, f * 3.5), t0 + 0.01, 0.25);
    env.connect(lp).connect(bus);
    const oscs: OscillatorNode[] = [];
    const partial = (type: OscillatorType, mul: number, gain: number, detune = 0) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = gain;
      o.connect(g).connect(env);
      o.start(t0);
      oscs.push(o);
    };
    partial("sine", 1, 0.7);
    partial("triangle", 1, 0.35, 4);
    partial("sine", 2, 0.22 * bright);
    partial("sine", 3.01, 0.06 * bright);
    const life = sustain > 0 ? 12 : tau * 6 + 0.1;
    for (const o of oscs) o.stop(t0 + life);
    let stopped = false;
    return {
      stop(full: boolean) {
        if (stopped) return;
        stopped = true;
        const now = c.currentTime;
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
        env.gain.setTargetAtTime(0.0001, now, full ? 0.22 : 0.07);
        for (const o of oscs) {
          try {
            o.stop(now + (full ? 1.4 : 0.5));
          } catch {
            /* already stopped */
          }
        }
      },
    };
  }

  function chord(tones: number[], level: number): void {
    tones.forEach((m, i) => {
      if (i === 0) voice(midiToFreq(m), 0.2 * level, 0, 0.42, 0.25);
      else voice(midiToFreq(m), 0.055 * level, 0, 0.5, 0.2);
    });
  }

  function arp(base: number, steps: number[], gap: number, vol: number): void {
    const a = live();
    if (!a) return;
    steps.forEach((s, i) => {
      window.setTimeout(() => voice(midiToFreq(base + s), vol, 0, 0.3, 1), i * gap * 1000);
    });
  }

  function applause(n: number, spread: number, vol: number): void {
    if (!live()) return;
    for (let i = 0; i < n; i++) {
      const at = Math.random() ** 0.7 * spread;
      window.setTimeout(() => audio.play(CLAP, { pitch: Math.random() * 6 - 3, volume: vol * (0.5 + Math.random() * 0.5), pan: Math.random() * 1.2 - 0.6 }), at * 1000);
    }
  }

  return {
    audio,
    note(midi, ch, judge, hold, level) {
      const f = midiToFreq(midi);
      audio.play(CLICK, { volume: level });
      if (ch) chord(ch, level);
      if (judge === "perfect") voice(f * 4, 0.035 * level, 0, 0.09, 0);
      return voice(f, 0.24 * level, hold ? 0.5 : 0, hold ? 0.3 : 0.32, judge === "perfect" ? 1.2 : 1);
    },
    wrong() {
      // Two neighbouring keys at once, and a smudge.
      voice(midiToFreq(50), 0.12, 0, 0.12, 0.6);
      voice(midiToFreq(51), 0.12, 0, 0.12, 0.6);
      audio.play(SMUDGE);
    },
    miss() {
      audio.play(THUD);
      audio.play(SMUDGE, { volume: 0.6 });
    },
    mult(m) {
      arp(72 + m, [0, 4, 7, 12], 0.06, 0.09);
    },
    clear(clean) {
      arp(72, clean ? [0, 4, 7, 12, 16] : [0, 7, 12], 0.08, 0.1);
      applause(clean ? 34 : 20, 1.4, 1);
    },
    encore() {
      arp(60, [0, 4, 7, 12, 16, 19, 24], 0.07, 0.11);
      applause(70, 2.6, 1.1);
    },
    start() {
      audio.play(DRUM);
    },
    card() {
      audio.play(SHEET);
    },
    best() {
      arp(84, [0, 7, 12, 19], 0.05, 0.06);
    },
    end() {
      audio.play(END);
    },
  };
}
