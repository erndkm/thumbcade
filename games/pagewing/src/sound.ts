/**
 * marginalia's sound palette for a paper plane: air over a paper wing that rises with speed, a flutter when it
 * stalls, a slide whistle through loops, pencil scratches for stars, a desk bell for hoops, a page turning,
 * and a crumple at the end. All synthesized; the kit's audio context suspends on pause and mute, which silences
 * the air too.
 */
import { createAudio, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

const S = {
  /** Pencil scratch: a short bandpassed hiss. */
  scratch: { wave: "noise", freq: 3400, freqEnd: 2300, duration: 0.07, volume: 0.12, highpass: 1500, punch: 1.3 },
  scratchLow: { wave: "noise", freq: 2200, freqEnd: 1600, duration: 0.09, volume: 0.1, highpass: 900, punch: 1.2 },
  /** The throw: a paper flick and a rising whoosh. */
  flick: { wave: "noise", freq: 5200, freqEnd: 1700, duration: 0.05, volume: 0.22, highpass: 2200, punch: 3 },
  whoosh: { wave: "noise", freq: 600, freqEnd: 2400, attack: 0.04, duration: 0.3, volume: 0.12, highpass: 400 },
  /** Star: a little pencil tick and a glassy blip. */
  blip: { wave: "triangle", freq: 1175, duration: 0.16, volume: 0.1, punch: 2.2 },
  /** Hoop: a desk bell. */
  ding: { wave: "triangle", freq: 1568, duration: 0.5, volume: 0.13, arp: [0, 7], arpStep: 0.06, punch: 1.6 },
  /** Loop: a slide whistle up and over. */
  whistle: { wave: "sine", freq: 620, freqEnd: 1240, attack: 0.03, duration: 0.5, volume: 0.09, vibrato: [0.25, 7], punch: 1.2 },
  whistleBack: { wave: "sine", freq: 1240, freqEnd: 820, duration: 0.26, volume: 0.07, punch: 1.6 },
  /** Stall: paper flapping. */
  flutter: { wave: "noise", freq: 1800, freqEnd: 900, duration: 0.32, volume: 0.13, highpass: 500, vibrato: [8, 24], punch: 1.2 },
  /** Warm air: a soft rising breath. */
  lift: { wave: "noise", freq: 300, freqEnd: 900, attack: 0.12, duration: 0.6, volume: 0.08, lowpass: 1400 },
  /** A page turning. */
  page: { wave: "noise", freq: 1400, freqEnd: 4200, attack: 0.05, duration: 0.24, volume: 0.1, highpass: 900, punch: 1.4 },
  /** Crumple: three crunches. */
  crumple: { wave: "noise", freq: 2600, freqEnd: 900, duration: 0.14, volume: 0.24, punch: 1.6, highpass: 500 },
  thud: { wave: "sine", freq: 160, freqEnd: 70, duration: 0.14, volume: 0.32, punch: 2.4 },
  /** A gentle landing: a paper slide. */
  slide: { wave: "noise", freq: 900, freqEnd: 500, attack: 0.02, duration: 0.5, volume: 0.1, lowpass: 2200, punch: 1.1 },
  /** Near miss. */
  near: { wave: "noise", freq: 400, freqEnd: 1800, attack: 0.06, duration: 0.42, volume: 0.09, punch: 1.2 },
} satisfies Record<string, SfxParams>;

// C major pentatonic, for stars in a row.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export interface Sound {
  readonly audio: Audio;
  /** Every frame: the air over the wing follows speed. `level` scales everything (quieter attract). */
  update(speed: number, level: number): void;
  throw(): void;
  star(chain: number): void;
  hoop(): void;
  loop(n: number): void;
  stall(): void;
  lift(): void;
  gust(): void;
  page(): void;
  crash(soft: boolean): void;
  near(): void;
}

export function createSound(): Sound {
  const audio = createAudio({ volume: 0.75 });
  let air: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null = null;
  let level = 1;
  const play = (p: SfxParams, pitch = 0, volume = 1) => audio.play(p, { pitch, volume: volume * level });

  function ensureAir(): void {
    const c = audio.ctx;
    const bus = audio.bus;
    if (air || !c || !bus || c.state !== "running") return;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    // Pink-ish noise: the hush of air over paper.
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + w * 0.15;
      b1 = 0.6 * b1 + w * 0.4;
      d[i] = (b0 + b1) * 0.5;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(bp).connect(gain).connect(bus);
    src.start();
    air = { src, bp, gain };
  }

  return {
    audio,
    update(speed, lv) {
      level = lv;
      ensureAir();
      const c = audio.ctx;
      if (!c || !air || c.state !== "running") return;
      const k = Math.min(1, speed / 650);
      const now = c.currentTime;
      air.gain.gain.setTargetAtTime((0.03 + k * k * 0.32) * lv, now, 0.2);
      air.bp.frequency.setTargetAtTime(380 + k * 1700, now, 0.25);
    },
    throw() {
      play(S.flick);
      play(S.whoosh);
    },
    star(chain) {
      const semi = SCALE[Math.min(SCALE.length - 1, Math.max(0, chain - 1))]!;
      play(S.scratch, Math.random() * 2);
      play(S.blip, semi);
    },
    hoop() {
      play(S.ding);
      play(S.scratchLow);
    },
    loop(n) {
      play(S.whistle, Math.min(5, n - 1));
      setTimeout(() => play(S.whistleBack, Math.min(5, n - 1)), 380);
    },
    stall() {
      play(S.flutter, Math.random() * 2 - 1);
    },
    lift() {
      play(S.lift);
    },
    gust() {
      play(S.whoosh, 3, 1.2);
      play(S.flick, -2, 0.6);
    },
    page() {
      play(S.page);
    },
    crash(soft) {
      if (soft) {
        play(S.slide);
        return;
      }
      play(S.thud);
      play(S.crumple);
      setTimeout(() => play(S.crumple, -3, 0.8), 90);
      setTimeout(() => play(S.crumple, 2, 0.6), 190);
    },
    near() {
      play(S.near);
    },
  };
}
