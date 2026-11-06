/**
 * Warm, dry sound: wind that grows with speed, a soft thump on every landing, a tendon "tension" tone that rises
 * through the squat and tops out at its bottom (the ear can time the release), a round pluck for the spring,
 * a bell that climbs the scale with a run of perfect hops, birds by day and crickets by night, a quiet pad.
 * All synthesized; the kit's audio context suspends itself on pause and mute, which silences all of it.
 */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";
import type { HopKind, Surface } from "./sim.ts";

// A major pentatonic, from A3.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

const THUMP: SfxParams = { wave: "sine", freq: 120, freqEnd: 48, attack: 0.004, duration: 0.2, volume: 0.42, punch: 2.2, lowpass: 700 };
const DUST: SfxParams = { wave: "noise", freq: 700, freqEnd: 260, attack: 0.004, duration: 0.16, volume: 0.1, punch: 2 };
const SAND: SfxParams = { wave: "noise", freq: 1800, freqEnd: 500, attack: 0.01, duration: 0.26, volume: 0.1, punch: 1.4, highpass: 300 };
const SALT: SfxParams = { wave: "noise", freq: 4200, freqEnd: 2600, attack: 0.002, duration: 0.09, volume: 0.07, punch: 2.6, highpass: 1500 };
const PLUCK: SfxParams = { wave: "triangle", freq: 150, freqEnd: 230, attack: 0.004, duration: 0.24, volume: 0.24, punch: 2.4, lowpass: 1400 };
const AIR: SfxParams = { wave: "noise", freq: 900, freqEnd: 2400, attack: 0.03, duration: 0.3, volume: 0.06, highpass: 600, punch: 1.6 };
const BELL: SfxParams = { wave: "sine", freq: midiToFreq(57), attack: 0.006, duration: 0.9, volume: 0.09, punch: 2.4 };
const PEA: SfxParams = { wave: "sine", freq: midiToFreq(81), attack: 0.004, duration: 0.5, volume: 0.1, punch: 2.6 };
const CRASH: SfxParams = { wave: "sine", freq: 90, freqEnd: 38, attack: 0.004, duration: 0.5, volume: 0.5, punch: 1.8, lowpass: 500 };
const SCRAPE: SfxParams = { wave: "noise", freq: 1200, freqEnd: 200, attack: 0.01, duration: 0.5, volume: 0.16, punch: 1.6 };
const FALL: SfxParams = { wave: "sine", freq: 520, freqEnd: 110, attack: 0.03, duration: 1.0, volume: 0.08, punch: 1, lowpass: 1200 };
const FAR_THUD: SfxParams = { wave: "sine", freq: 70, freqEnd: 40, attack: 0.01, duration: 0.4, volume: 0.22, punch: 2, lowpass: 300 };
const NEAR: SfxParams = { wave: "noise", freq: 400, freqEnd: 1900, attack: 0.07, duration: 0.45, volume: 0.09, punch: 1.2 };
const SWIRL: SfxParams = { wave: "noise", freq: 300, freqEnd: 1300, attack: 0.15, duration: 0.9, volume: 0.1, punch: 1, vibrato: [3, 7] };

export interface Sound {
  readonly audio: Audio;
  /** Every frame: wind follows speed, ambience follows the hour. `level` scales everything (quieter attract). */
  update(speed: number, night: number, level: number, dt: number): void;
  land(surface: Surface, impact: number, loaded: boolean, bottom: number, level: number): void;
  hop(kind: HopKind, power: number, flow: number, level: number): void;
  pea(chain: number): void;
  crash(): void;
  fall(): void;
  near(): void;
  devil(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.72 });
  let wind: { lp: BiquadFilterNode; gain: GainNode } | null = null;
  let pad: GainNode | null = null;
  let tension: { osc: OscillatorNode; gain: GainNode } | null = null;
  let nextChord = 0;
  let chordIdx = 0;
  let level = 1;
  let ambT = 2;

  function live(): AudioContext | null {
    const c = audio.ctx;
    return c && audio.bus && c.state === "running" ? c : null;
  }

  function ensureGraph(): void {
    const c = live();
    if (!c || !audio.bus) return;
    if (!wind) {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03;
        d[i] = last * 3.4;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 300;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(gain).connect(audio.bus);
      src.start();
      wind = { lp, gain };
    }
    if (!pad) {
      pad = c.createGain();
      pad.gain.value = 1;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      pad.connect(lp).connect(audio.bus);
      nextChord = c.currentTime + 0.4;
    }
  }

  // Amaj9 → F#m7 → Dmaj7 → Esus2, slow and low.
  const CHORDS = [
    [45, 52, 59, 61, 64],
    [42, 49, 57, 61, 64],
    [38, 45, 54, 57, 61],
    [40, 47, 54, 59, 64],
  ];

  function schedulePad(): void {
    const c = live();
    if (!c || !pad) return;
    if (nextChord < c.currentTime) nextChord = c.currentTime + 0.1;
    while (nextChord < c.currentTime + 0.6) {
      const notes = CHORDS[chordIdx % CHORDS.length]!;
      chordIdx++;
      const t0 = nextChord;
      const dur = 10;
      for (const n of notes) {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = midiToFreq(n);
        osc.detune.value = (Math.random() - 0.5) * 8;
        const g = c.createGain();
        const v = 0.009 * level;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(v, t0 + 3.5);
        g.gain.setValueAtTime(v, t0 + dur - 4);
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(pad);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      }
      nextChord += 8;
    }
  }

  /** A bird by day (a soft two-note whistle) or a cricket's chirp train by night. */
  function ambience(night: number, lv: number): void {
    if (night > 0.5) {
      const base = 4000 + Math.random() * 600;
      for (let k = 0; k < 3; k++) {
        const t = k * 0.06;
        setTimeout(() => audio.play({ wave: "sine", freq: base, attack: 0.004, duration: 0.035, volume: 0.018 * lv, punch: 1.5 }, { pan: 0.4 }), t * 1000);
      }
    } else {
      const f = 1500 + Math.random() * 700;
      audio.play({ wave: "sine", freq: f, freqEnd: f * 1.32, attack: 0.02, duration: 0.18, volume: 0.025 * lv, punch: 1.2 }, { pan: -0.3 });
      setTimeout(() => audio.play({ wave: "sine", freq: f * 1.32, freqEnd: f * 1.12, attack: 0.02, duration: 0.24, volume: 0.02 * lv, punch: 1.2 }, { pan: -0.3 }), 230);
    }
  }

  function stopTension(): void {
    const c = audio.ctx;
    if (!tension || !c) return;
    const now = c.currentTime;
    tension.gain.gain.cancelScheduledValues(now);
    tension.gain.gain.setTargetAtTime(0.0001, now, 0.015);
    tension.osc.stop(now + 0.1);
    tension = null;
  }

  return {
    audio,
    update(speed, night, lv, dt) {
      level = lv;
      ensureGraph();
      const c = live();
      if (!c || !wind) return;
      const k = Math.min(1, speed / 600);
      const now = c.currentTime;
      wind.gain.gain.setTargetAtTime((0.04 + k * k * 0.32) * lv, now, 0.3);
      wind.lp.frequency.setTargetAtTime(240 + k * 1100, now, 0.3);
      schedulePad();
      ambT -= dt;
      if (ambT <= 0) {
        ambT = night > 0.5 ? 0.9 + Math.random() * 1.6 : 3 + Math.random() * 5;
        ambience(night, lv);
      }
    },
    land(surface, impact, loaded, bottom, lv) {
      const v = Math.min(1, 0.45 + impact / 1400) * lv;
      audio.play(THUMP, { volume: v });
      audio.play(surface === "sand" ? SAND : surface === "salt" ? SALT : DUST, { volume: lv });
      stopTension();
      const c = live();
      if (!loaded || !c || !audio.bus) return;
      // The tendon loads: a quiet tone sliding up to its peak exactly at the bottom of the squat.
      const osc = c.createOscillator();
      osc.type = "triangle";
      const g = c.createGain();
      const t0 = c.currentTime;
      osc.frequency.setValueAtTime(midiToFreq(50), t0);
      osc.frequency.exponentialRampToValueAtTime(midiToFreq(57), t0 + bottom);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.05 * lv, t0 + bottom);
      g.gain.setTargetAtTime(0.012 * lv, t0 + bottom + 0.03, 0.12);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      osc.connect(lp).connect(g).connect(audio.bus);
      osc.start(t0);
      osc.stop(t0 + 2.2);
      tension = { osc, gain: g };
    },
    hop(kind, power, flow, lv) {
      stopTension();
      audio.play(PLUCK, { pitch: (power - 0.5) * 8, volume: (0.5 + power * 0.5) * lv });
      audio.play(AIR, { volume: (0.4 + power * 0.6) * lv });
      if (kind === "perfect") {
        const step = SCALE[Math.min(SCALE.length - 1, flow)]!;
        audio.play(BELL, { pitch: step, volume: lv });
        audio.play({ ...BELL, wave: "triangle", volume: 0.025 }, { pitch: step + 12, volume: lv });
      }
    },
    pea(chain) {
      const s = SCALE[Math.min(SCALE.length - 1, chain + 1)]!;
      audio.play(PEA, { pitch: s - 12 });
      setTimeout(() => audio.play(PEA, { pitch: s - 5, volume: 0.7 }), 70);
    },
    crash() {
      stopTension();
      audio.play(CRASH);
      audio.play(SCRAPE);
    },
    fall() {
      stopTension();
      audio.play(FALL);
      setTimeout(() => audio.play(FAR_THUD), 750);
    },
    near() {
      audio.play(NEAR);
    },
    devil() {
      audio.play(SWIRL);
    },
  };
}
