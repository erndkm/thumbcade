/**
 * Airy, calm sound: wind that swells with speed, a soft sine thrum when the line catches, glassy seeds,
 * a low tone on the fall, and a very quiet pad underneath. All synthesized; the kit's audio context
 * suspends itself on pause and mute, which silences the wind and the pad too.
 */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

// D major pentatonic-ish, low and open.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

const CATCH: SfxParams = { wave: "sine", freq: 146.8, freqEnd: 140, attack: 0.012, duration: 0.7, volume: 0.3, punch: 1.8, lowpass: 900 };
const CATCH_AIR: SfxParams = { wave: "noise", freq: 900, freqEnd: 500, attack: 0.01, duration: 0.18, volume: 0.05, punch: 2 };
const LET_GO: SfxParams = { wave: "noise", freq: 1400, freqEnd: 2600, attack: 0.04, duration: 0.32, volume: 0.07, highpass: 700, punch: 1.4 };
const GOOD: SfxParams = { wave: "sine", freq: 880, attack: 0.02, duration: 0.9, volume: 0.07, punch: 2.2 };
const SEED_PING: SfxParams = { wave: "sine", freq: 1174.7, attack: 0.005, duration: 0.55, volume: 0.11, punch: 2.6 };
const FALL: SfxParams = { wave: "sine", freq: 98, freqEnd: 41, attack: 0.03, duration: 1.6, volume: 0.42, punch: 1.2, lowpass: 500 };
const FALL_AIR: SfxParams = { wave: "noise", freq: 700, freqEnd: 120, attack: 0.05, duration: 1.1, volume: 0.12, punch: 1.3 };
const SNAP: SfxParams = { wave: "triangle", freq: 330, freqEnd: 220, duration: 0.16, volume: 0.12, punch: 3, lowpass: 1800 };
const MISS: SfxParams = { wave: "noise", freq: 2200, freqEnd: 900, attack: 0.01, duration: 0.14, volume: 0.04, highpass: 900 };
const NEAR: SfxParams = { wave: "noise", freq: 400, freqEnd: 1800, attack: 0.08, duration: 0.5, volume: 0.1, punch: 1.2 };

export interface Sound {
  readonly audio: Audio;
  /** Called every frame: wind follows speed, the pad keeps breathing. `level` scales everything (quieter attract). */
  update(speed: number, level: number): void;
  grab(step: number, level: number): void;
  release(good: boolean, flow: number, level: number): void;
  seed(chain: number): void;
  fall(): void;
  snap(): void;
  miss(): void;
  near(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.75 });
  let wind: { src: AudioBufferSourceNode; lp: BiquadFilterNode; bp: BiquadFilterNode; gain: GainNode } | null = null;
  let pad: { gain: GainNode; lp: BiquadFilterNode } | null = null;
  let nextChord = 0;
  let chordIdx = 0;
  let level = 1;

  function ensureGraph(): void {
    const c = audio.ctx;
    const bus = audio.bus;
    if (!c || !bus || c.state !== "running") return;
    if (!wind) {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      // Brown-ish noise: softer than white.
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.035 * (Math.random() * 2 - 1)) / 1.035;
        d[i] = last * 3.2;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 380;
      const bp = c.createBiquadFilter();
      bp.type = "peaking";
      bp.frequency.value = 700;
      bp.gain.value = 4;
      bp.Q.value = 0.8;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(lp).connect(bp).connect(gain).connect(bus);
      src.start();
      wind = { src, lp, bp, gain };
    }
    if (!pad) {
      const gain = c.createGain();
      gain.gain.value = 0.9;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1100;
      gain.connect(lp).connect(bus);
      pad = { gain, lp };
      nextChord = c.currentTime + 0.5;
    }
  }

  // Slow chords: Dsus2 → Bm7 → Gmaj9 → Asus4, each voice a pair of slightly detuned sines.
  const CHORDS = [
    [50, 57, 64, 69],
    [47, 54, 62, 69],
    [43, 50, 57, 66],
    [45, 52, 59, 62],
  ];

  function schedulePad(): void {
    const c = audio.ctx;
    if (!c || !pad || c.state !== "running") return;
    if (nextChord < c.currentTime) nextChord = c.currentTime + 0.1;
    while (nextChord < c.currentTime + 0.6) {
      const notes = CHORDS[chordIdx % CHORDS.length]!;
      chordIdx++;
      const t0 = nextChord;
      const dur = 9;
      for (const n of notes) {
        for (const det of [-4, 4]) {
          const osc = c.createOscillator();
          osc.type = "sine";
          osc.frequency.value = midiToFreq(n);
          osc.detune.value = det;
          const g = c.createGain();
          const v = 0.011 * level;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(v, t0 + 3);
          g.gain.setValueAtTime(v, t0 + dur - 4);
          g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
          osc.connect(g).connect(pad.gain);
          osc.start(t0);
          osc.stop(t0 + dur + 0.05);
        }
      }
      nextChord += 7;
    }
  }

  return {
    audio,
    update(speed, lv) {
      level = lv;
      ensureGraph();
      const c = audio.ctx;
      if (!c || !wind || c.state !== "running") return;
      const k = Math.min(1, speed / 900);
      const now = c.currentTime;
      wind.gain.gain.setTargetAtTime((0.05 + k * k * 0.5) * lv, now, 0.25);
      wind.lp.frequency.setTargetAtTime(260 + k * 1500, now, 0.3);
      wind.bp.frequency.setTargetAtTime(500 + k * 900, now, 0.4);
      schedulePad();
    },
    grab(step, lv) {
      const semi = SCALE[Math.max(0, Math.min(SCALE.length - 1, step))]!;
      audio.play(CATCH, { pitch: semi, volume: lv });
      audio.play({ ...CATCH, freq: CATCH.freq * 1.5, freqEnd: CATCH.freq * 1.48, volume: 0.08 }, { pitch: semi, volume: lv });
      audio.play(CATCH_AIR, { volume: lv });
    },
    release(good, flow, lv) {
      audio.play(LET_GO, { volume: lv });
      if (good) audio.play(GOOD, { pitch: SCALE[Math.min(SCALE.length - 1, 2 + (flow % 6))]! - 12, volume: lv });
    },
    seed(chain) {
      audio.play(SEED_PING, { pitch: SCALE[Math.min(SCALE.length - 1, chain - 1)]! });
      audio.play({ ...SEED_PING, wave: "triangle", volume: 0.03 }, { pitch: SCALE[Math.min(SCALE.length - 1, chain - 1)]! + 12 });
    },
    fall() {
      audio.play(FALL);
      audio.play(FALL_AIR);
    },
    snap() {
      audio.play(SNAP);
    },
    miss() {
      audio.play(MISS);
    },
    near() {
      audio.play(NEAR);
    },
  };
}

