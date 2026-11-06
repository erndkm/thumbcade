/**
 * The stream: brown-noise water that closes in under the surface and opens up in the air, the hiss of the fall
 * ahead swelling as you near it, plucked chimes for clean leaps that climb with the chain, and now and then a
 * far-off note. All synthesized; the kit's audio context suspends itself on pause and mute.
 */
import { createAudio, midiToFreq, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

// A on top, major pentatonic with the fourth: bright, open, a little like a plucked zither.
const SCALE = [0, 2, 5, 7, 9, 12, 14, 17, 19, 21, 24, 26];
const ROOT = 69;

const PLUCK: SfxParams = { wave: "triangle", freq: 440, attack: 0.003, duration: 0.9, volume: 0.16, punch: 3.2, lowpass: 3200 };
const PLUCK_AIR: SfxParams = { wave: "sine", freq: 880, attack: 0.002, duration: 0.5, volume: 0.05, punch: 3 };
const SPLASH: SfxParams = { wave: "noise", freq: 1500, freqEnd: 300, attack: 0.004, duration: 0.42, volume: 0.22, punch: 2.2, lowpass: 3000 };
const PLOP: SfxParams = { wave: "sine", freq: 520, freqEnd: 180, attack: 0.003, duration: 0.14, volume: 0.16, punch: 2 };
const BREACH: SfxParams = { wave: "noise", freq: 700, freqEnd: 2600, attack: 0.03, duration: 0.36, volume: 0.13, highpass: 500, punch: 1.6 };
const BUBBLE: SfxParams = { wave: "sine", freq: 380, freqEnd: 900, attack: 0.002, duration: 0.06, volume: 0.05, punch: 2 };
const THUD: SfxParams = { wave: "sine", freq: 150, freqEnd: 70, attack: 0.002, duration: 0.18, volume: 0.36, punch: 2.4, lowpass: 600 };
const SLIDE: SfxParams = { wave: "sine", freq: 260, freqEnd: 90, attack: 0.01, duration: 0.5, volume: 0.12, punch: 1.4 };
const SCRAPE: SfxParams = { wave: "noise", freq: 2600, freqEnd: 1200, attack: 0.005, duration: 0.12, volume: 0.05, highpass: 1400 };
const FLY: SfxParams = { wave: "sine", freq: 1567.98, attack: 0.003, duration: 0.45, volume: 0.09, arp: [0, 7, 12], arpStep: 0.05, punch: 2.4 };
const COCK: SfxParams = { wave: "noise", freq: 3200, freqEnd: 2400, attack: 0.002, duration: 0.05, volume: 0.08, highpass: 2000 };
const TOK: SfxParams = { wave: "triangle", freq: 330, freqEnd: 300, attack: 0.002, duration: 0.12, volume: 0.1, punch: 3, lowpass: 1500 };
const STRIKE: SfxParams = { wave: "noise", freq: 2400, freqEnd: 600, attack: 0.003, duration: 0.16, volume: 0.16, punch: 2.6 };
const END: SfxParams = { wave: "sine", freq: 110, freqEnd: 55, attack: 0.04, duration: 1.6, volume: 0.36, punch: 1.2, lowpass: 500 };
const HEART: SfxParams = { wave: "sine", freq: 66, freqEnd: 52, attack: 0.004, duration: 0.16, volume: 0.22, punch: 2.6 };

export interface Sound {
  readonly audio: Audio;
  /** Every frame: `under` 0..1 (muffled under water), `fall` 0..1 (how loud the fall ahead is), `level` for attract. */
  update(under: number, fall: number, level: number): void;
  land(clean: boolean, flow: number, kiss: boolean, level: number): void;
  breach(speed: number, level: number): void;
  splash(speed: number, level: number): void;
  bubble(level: number): void;
  fail(): void;
  bonk(): void;
  scrape(): void;
  fly(n: number): void;
  cock(): void;
  strike(hit: boolean): void;
  heart(): void;
  end(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.75 });
  let water: { lp: BiquadFilterNode; gain: GainNode; hiss: GainNode; hissBp: BiquadFilterNode } | null = null;
  let nextNote = 0;
  let level = 1;

  function ensure(): void {
    const c = audio.ctx;
    const bus = audio.bus;
    if (!c || !bus || c.state !== "running" || water) return;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      d[i] = last * 3;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(lp).connect(gain).connect(bus);
    // The fall: white-ish noise through a band, its own gain.
    const wbuf = c.createBuffer(1, len, c.sampleRate);
    const wd = wbuf.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    const wsrc = c.createBufferSource();
    wsrc.buffer = wbuf;
    wsrc.loop = true;
    const hissBp = c.createBiquadFilter();
    hissBp.type = "bandpass";
    hissBp.frequency.value = 1400;
    hissBp.Q.value = 0.6;
    const hiss = c.createGain();
    hiss.gain.value = 0;
    wsrc.connect(hissBp).connect(hiss).connect(lp);
    src.start();
    wsrc.start();
    water = { lp, gain, hiss, hissBp };
    nextNote = c.currentTime + 2;
  }

  function farNote(): void {
    const c = audio.ctx;
    if (!c || c.state !== "running") return;
    if (c.currentTime < nextNote) return;
    nextNote = c.currentTime + 5 + Math.random() * 7;
    const semi = SCALE[Math.floor(Math.random() * 7)]! - 12;
    audio.play({ ...PLUCK, volume: 0.05, lowpass: 1600 }, { pitch: semi, volume: level });
    audio.play({ ...PLUCK, volume: 0.03, lowpass: 1400 }, { pitch: semi + 7, volume: level });
  }

  const pitch = (i: number) => SCALE[Math.max(0, Math.min(SCALE.length - 1, i))]!;

  return {
    audio,
    update(under, fall, lv) {
      level = lv;
      ensure();
      const c = audio.ctx;
      if (!c || !water || c.state !== "running") return;
      const now = c.currentTime;
      water.lp.frequency.setTargetAtTime(500 + (1 - under) * 2600, now, 0.08);
      water.gain.gain.setTargetAtTime((0.12 + under * 0.08) * lv, now, 0.2);
      water.hiss.gain.setTargetAtTime(fall * 0.09, now, 0.3);
      farNote();
    },
    land(clean, flow, kiss, lv) {
      audio.play(SPLASH, { volume: lv * 0.8 });
      if (!clean) {
        audio.play(PLUCK, { pitch: pitch(0) - 12, volume: lv * 0.7 });
        return;
      }
      const p = pitch(flow);
      audio.play(PLUCK, { pitch: p - 12, volume: lv });
      audio.play(PLUCK_AIR, { pitch: p - 12, volume: lv });
      if (kiss) audio.play({ ...PLUCK_AIR, freq: midiToFreq(ROOT + 24), volume: 0.06 }, { pitch: p, volume: lv });
    },
    breach(speed, lv) {
      audio.play(BREACH, { volume: lv * Math.min(1, speed / 600) });
      audio.play({ ...SPLASH, volume: 0.1, duration: 0.2 }, { volume: lv });
    },
    splash(speed, lv) {
      audio.play(SPLASH, { volume: lv * Math.min(1, 0.4 + speed / 900) });
      audio.play(PLOP, { volume: lv * 0.6 });
    },
    bubble(lv) {
      audio.play(BUBBLE, { pitch: Math.random() * 7, volume: lv });
    },
    fail() {
      audio.play(THUD);
      audio.play(SLIDE);
    },
    bonk() {
      audio.play({ ...THUD, volume: 0.22 });
    },
    scrape() {
      audio.play(SCRAPE);
    },
    fly(n) {
      audio.play(FLY, { pitch: (n % 4) * 2 });
    },
    cock() {
      audio.play(COCK);
      audio.play(TOK);
    },
    strike(hit) {
      audio.play(STRIKE);
      if (hit) audio.play({ ...THUD, volume: 0.3 });
    },
    heart() {
      audio.play(HEART);
    },
    end() {
      audio.play(END);
    },
  };
}
