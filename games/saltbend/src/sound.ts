/**
 * Saltbend's coast, all synthesized through the kit's audio engine (which suspends itself on pause and mute): a
 * two-stroke putter that climbs with speed, tyres that sing while you hold, gravel, the sea underneath it all, and a
 * marimba-ish pluck for every line, pitched up a pentatonic as the streak grows. The horn goes meep-meep at the start.
 */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";
import type { Grade } from "./sim.ts";

/** Major pentatonic from F: open and sunny. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
const ROOT = 65;

const PLUCK: SfxParams = { wave: "triangle", freq: 440, attack: 0.002, duration: 0.45, volume: 0.16, punch: 3, lowpass: 3400 };
const PLUCK_AIR: SfxParams = { wave: "sine", freq: 880, attack: 0.002, duration: 0.3, volume: 0.05, punch: 3 };
const CHIRP: SfxParams = { wave: "noise", freq: 2600, freqEnd: 1900, attack: 0.01, duration: 0.16, volume: 0.07, highpass: 1400, punch: 1.6 };
const CATCH: SfxParams = { wave: "noise", freq: 900, freqEnd: 500, attack: 0.003, duration: 0.07, volume: 0.06, punch: 2.4 };
const BANK: SfxParams = { wave: "triangle", freq: 660, attack: 0.003, duration: 0.32, volume: 0.11, arp: [0, 7], arpStep: 0.06, punch: 2 };
const GRAVEL: SfxParams = { wave: "noise", freq: 500, freqEnd: 260, attack: 0.004, duration: 0.28, volume: 0.3, lowpass: 1200, punch: 1.6 };
const THUNK: SfxParams = { wave: "sine", freq: 130, freqEnd: 70, attack: 0.003, duration: 0.16, volume: 0.32, punch: 2.4 };
const LOST: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 7), freqEnd: midiToFreq(ROOT), attack: 0.004, duration: 0.3, volume: 0.08, punch: 1.6 };
const PLINK: SfxParams = { wave: "sine", freq: 1320, attack: 0.002, duration: 0.25, volume: 0.12, punch: 2.6, arp: [0, 5], arpStep: 0.05 };
const TIER: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 12), attack: 0.003, duration: 0.8, volume: 0.15, arp: [0, 4, 7, 12, 16], arpStep: 0.07, punch: 1.8 };
const BELL: SfxParams = { wave: "sine", freq: midiToFreq(ROOT + 24), attack: 0.002, duration: 1.2, volume: 0.09, punch: 1.4, vibrato: [0.1, 5] };
const GATE: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 7), attack: 0.004, duration: 1.1, volume: 0.15, arp: [0, 5, 9, 12, 16, 19], arpStep: 0.09, punch: 1.5 };
const CRATE: SfxParams = { wave: "noise", freq: 1600, freqEnd: 600, attack: 0.002, duration: 0.09, volume: 0.15, punch: 2.6 };
const CRATE_LOW: SfxParams = { wave: "sine", freq: 220, freqEnd: 140, attack: 0.002, duration: 0.12, volume: 0.2, punch: 2.6 };
const CRASH: SfxParams = { wave: "noise", freq: 1200, freqEnd: 120, attack: 0.004, duration: 0.7, volume: 0.42, punch: 1.6, lowpass: 2400 };
const CRASH_LOW: SfxParams = { wave: "sine", freq: 150, freqEnd: 40, attack: 0.003, duration: 0.6, volume: 0.42, punch: 1.8 };
const SPLASH: SfxParams = { wave: "noise", freq: 2600, freqEnd: 400, attack: 0.02, duration: 0.9, volume: 0.3, highpass: 300, punch: 1.2 };
const BEST: SfxParams = { wave: "triangle", freq: midiToFreq(ROOT + 7), attack: 0.003, duration: 0.9, volume: 0.15, arp: [0, 5, 9, 12, 17, 21, 24], arpStep: 0.07, punch: 1.6 };
const HORN: SfxParams = { wave: "square", freq: 523, attack: 0.008, duration: 0.11, volume: 0.07, lowpass: 2000, punch: 1 };
const GULL: SfxParams = { wave: "sine", freq: 1900, freqEnd: 1300, attack: 0.01, duration: 0.18, volume: 0.04, vibrato: [0.6, 22], punch: 1.2 };

export interface Sound {
  readonly audio: Audio;
  /** Continuous layers: engine by speed, tyres by drift, gravel, the sea. `level` is 1 in a run, quieter in attract. */
  update(speed: number, drift: number, gravel: boolean, level: number): void;
  press(level: number): void;
  release(level: number): void;
  bank(mult: number, level: number): void;
  grade(g: Grade, streak: number, level: number): void;
  tier(): void;
  lost(): void;
  verge(level: number): void;
  lemon(i: number, level: number): void;
  gate(): void;
  crate(): void;
  save(): void;
  crash(sea: boolean): void;
  best(): void;
  horn(): void;
  gull(level: number): void;
  /** Silences the continuous layers (game over, attract between demos). */
  hush(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.75 });
  const step = (i: number) => SCALE[Math.max(0, Math.min(SCALE.length - 1, i))]!;
  let engine: { osc: OscillatorNode; sub: OscillatorNode; lp: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode } | null = null;
  let tyres: { bp: BiquadFilterNode; gain: GainNode } | null = null;
  let grit: { gain: GainNode } | null = null;
  let sea: { gain: GainNode; lp: BiquadFilterNode } | null = null;
  let t0 = 0;

  function live(): AudioContext | null {
    const c = audio.ctx;
    return c && audio.bus && c.state === "running" ? c : null;
  }

  function noiseSource(c: AudioContext, seconds: number, brown: boolean): AudioBufferSourceNode {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  function ensure(): AudioContext | null {
    const c = live();
    if (!c || !audio.bus) return null;
    if (!engine) {
      // A little two-stroke: a buzzy saw an octave over a sine, through a lowpass, pulsed by a square "putt".
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      const sub = c.createOscillator();
      sub.type = "sine";
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      lp.Q.value = 2;
      const gain = c.createGain();
      gain.gain.value = 0;
      const lfo = c.createOscillator();
      lfo.type = "square";
      const lfoGain = c.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(lp);
      sub.connect(lp);
      lp.connect(gain).connect(audio.bus);
      osc.start();
      sub.start();
      lfo.start();
      engine = { osc, sub, lp, gain, lfo, lfoGain };
    }
    if (!tyres) {
      const src = noiseSource(c, 1.5, false);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2100;
      bp.Q.value = 7;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(bp).connect(gain).connect(audio.bus);
      src.start();
      tyres = { bp, gain };
    }
    if (!grit) {
      const src = noiseSource(c, 1.2, false);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(audio.bus);
      src.start();
      grit = { gain };
    }
    if (!sea) {
      const src = noiseSource(c, 3, true);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(audio.bus);
      src.start();
      sea = { gain, lp };
    }
    return c;
  }

  const pluck = (semi: number, level: number, delay = 0) => {
    const f = () => {
      audio.play(PLUCK, { pitch: semi, volume: level });
      audio.play(PLUCK_AIR, { pitch: semi, volume: level });
    };
    if (delay > 0) setTimeout(f, delay * 1000);
    else f();
  };

  return {
    audio,
    update(speed, drift, gravel, level) {
      const c = ensure();
      if (!c || !engine || !tyres || !grit || !sea) return;
      const now = c.currentTime;
      t0 += 1 / 60;
      const k = Math.max(0, Math.min(1, (speed - 6) / 26));
      const f = 62 + k * 70;
      engine.osc.frequency.setTargetAtTime(f, now, 0.08);
      engine.sub.frequency.setTargetAtTime(f / 2, now, 0.08);
      engine.lfo.frequency.setTargetAtTime(f / 4, now, 0.08);
      engine.lp.frequency.setTargetAtTime(500 + k * 900, now, 0.1);
      const v = speed > 0.5 ? (0.05 + k * 0.035) * level : 0;
      engine.gain.gain.setTargetAtTime(v * 0.6, now, 0.06);
      engine.lfoGain.gain.setTargetAtTime(v * 0.4, now, 0.06);
      tyres.gain.gain.setTargetAtTime(Math.min(1, drift) * 0.05 * level, now, 0.05);
      tyres.bp.frequency.setTargetAtTime(1700 + drift * 700 + Math.sin(t0 * 9) * 120, now, 0.05);
      grit.gain.gain.setTargetAtTime(gravel ? 0.22 * level : 0, now, 0.03);
      const swell = 0.5 + 0.5 * Math.sin(t0 * 0.7);
      sea.gain.gain.setTargetAtTime((0.035 + swell * 0.03) * Math.max(0.5, level), now, 0.4);
    },
    press(level) {
      audio.play(CHIRP, { volume: level, pitch: (Math.random() - 0.5) * 2 });
    },
    release(level) {
      audio.play(CATCH, { volume: level });
    },
    bank(mult, level) {
      audio.play(BANK, { volume: level, pitch: step(mult + 1) });
    },
    grade(g, streak, level) {
      const base = Math.min(streak, 7);
      const n = g === "paint" ? 4 : g === "kissed" ? 3 : g === "tight" ? 2 : g === "clean" ? 1 : 0;
      for (let i = 0; i < n; i++) pluck(step(base + i * 2), level * (1 - i * 0.12), i * 0.07);
      if (g === "wide") audio.play(LOST, { volume: level * 0.6 });
    },
    tier() {
      audio.play(TIER);
      audio.play(BELL);
    },
    lost() {
      audio.play(LOST);
    },
    verge(level) {
      audio.play(GRAVEL, { volume: level });
      audio.play(THUNK, { volume: level });
    },
    lemon(i, level) {
      audio.play(PLINK, { volume: level, pitch: step(i + 4) - 12 });
    },
    gate() {
      audio.play(GATE);
      setTimeout(() => audio.play(BELL, { pitch: 7 }), 380);
    },
    crate() {
      audio.play(CRATE);
      audio.play(CRATE_LOW);
    },
    save() {
      audio.play(CRASH, { volume: 0.6 });
      audio.play(CRATE);
      setTimeout(() => audio.play(SPLASH, { volume: 0.6 }), 260);
    },
    crash(sea) {
      audio.play(CRASH);
      audio.play(CRASH_LOW);
      if (sea) setTimeout(() => audio.play(SPLASH), 420);
    },
    best() {
      audio.play(BEST);
    },
    horn() {
      audio.play(HORN);
      setTimeout(() => audio.play(HORN, { pitch: 0 }), 170);
    },
    gull(level) {
      audio.play(GULL, { volume: level, pitch: (Math.random() - 0.5) * 3, pan: (Math.random() - 0.5) * 0.8 });
      setTimeout(() => audio.play(GULL, { volume: level * 0.8, pitch: 2 + Math.random() * 2 }), 140);
    },
    hush() {
      const c = audio.ctx;
      if (!c || !engine || !tyres || !grit) return;
      const now = c.currentTime;
      engine.gain.gain.setTargetAtTime(0, now, 0.05);
      engine.lfoGain.gain.setTargetAtTime(0, now, 0.05);
      tyres.gain.gain.setTargetAtTime(0, now, 0.05);
      grit.gain.gain.setTargetAtTime(0, now, 0.05);
    },
  };
}
