import { thumbcade as tc } from "@thumbcade/sdk";

/**
 * Procedural sound effects (jsfxr-style, no samples) and a tiny step sequencer.
 *
 * The AudioContext is created on the first user gesture and runs only while the game is unmuted
 * AND not paused; otherwise it is suspended, so `pause` always silences everything (Swipe Contract
 * rule 5) and a muted preview costs no CPU.
 */

export type Wave = "square" | "sine" | "triangle" | "sawtooth" | "noise";

export interface SfxParams {
  wave: Wave;
  /** Start frequency (Hz). For noise it drives the filter. */
  freq: number;
  /** End frequency for a pitch slide. */
  freqEnd?: number;
  /** Seconds. */
  attack?: number;
  /** Total length in seconds (attack + body + release). */
  duration: number;
  /** Peak gain 0-1. */
  volume?: number;
  /** Semitone offsets played in sequence (arpeggio) every `arpStep` seconds. */
  arp?: number[];
  arpStep?: number;
  /** Vibrato depth (semitones) and rate (Hz). */
  vibrato?: [number, number];
  lowpass?: number;
  highpass?: number;
  /** Curve of the volume decay (1 linear, 2+ snappier). */
  punch?: number;
}

export const SFX = {
  blip: { wave: "square", freq: 880, duration: 0.07, volume: 0.25 },
  tick: { wave: "sine", freq: 1600, duration: 0.03, volume: 0.18 },
  select: { wave: "triangle", freq: 660, freqEnd: 990, duration: 0.08, volume: 0.3 },
  jump: { wave: "square", freq: 280, freqEnd: 720, duration: 0.14, volume: 0.22, lowpass: 3200 },
  flap: { wave: "triangle", freq: 420, freqEnd: 760, duration: 0.09, volume: 0.32 },
  coin: { wave: "square", freq: 988, duration: 0.2, volume: 0.2, arp: [0, 5], arpStep: 0.06, lowpass: 5000 },
  score: { wave: "triangle", freq: 784, duration: 0.16, volume: 0.32, arp: [0, 7], arpStep: 0.05 },
  powerup: { wave: "square", freq: 392, duration: 0.36, volume: 0.18, arp: [0, 4, 7, 12], arpStep: 0.07, lowpass: 4200 },
  hit: { wave: "noise", freq: 1400, freqEnd: 300, duration: 0.2, volume: 0.5, punch: 3 },
  thud: { wave: "sine", freq: 170, freqEnd: 55, duration: 0.16, volume: 0.6, punch: 2 },
  explode: { wave: "noise", freq: 900, freqEnd: 80, duration: 0.6, volume: 0.55, punch: 2.5 },
  laser: { wave: "sawtooth", freq: 1400, freqEnd: 220, duration: 0.14, volume: 0.14, lowpass: 3800 },
  whoosh: { wave: "noise", freq: 600, freqEnd: 2600, attack: 0.05, duration: 0.24, volume: 0.22, highpass: 400 },
  slice: { wave: "noise", freq: 5000, freqEnd: 1800, duration: 0.12, volume: 0.32, highpass: 1500, punch: 2 },
  win: { wave: "triangle", freq: 523, duration: 0.5, volume: 0.3, arp: [0, 4, 7, 12], arpStep: 0.09 },
  lose: { wave: "square", freq: 330, freqEnd: 82, duration: 0.55, volume: 0.18, lowpass: 1800, vibrato: [0.4, 9] },
  error: { wave: "square", freq: 160, duration: 0.14, volume: 0.18, lowpass: 1200, arp: [0, -1], arpStep: 0.06 },
  pop: { wave: "sine", freq: 520, freqEnd: 1100, duration: 0.07, volume: 0.35 },
  click: { wave: "square", freq: 2400, duration: 0.018, volume: 0.12, highpass: 900 },
} satisfies Record<string, SfxParams>;

export type SfxName = keyof typeof SFX;

export interface PlayOptions {
  /** Pitch shift in semitones. */
  pitch?: number;
  /** Volume multiplier. */
  volume?: number;
  /** Stereo pan -1..1. */
  pan?: number;
}

export interface Audio {
  play(sfx: SfxName | SfxParams, opts?: PlayOptions): void;
  /** Plays a plain tone (Hz) — handy for musical feedback. */
  note(freq: number, duration?: number, wave?: Exclude<Wave, "noise">, volume?: number): void;
  readonly muted: boolean;
  readonly running: boolean;
  /** The context (null until the first gesture). */
  readonly ctx: AudioContext | null;
  /** Destination for custom graphs (music). */
  readonly bus: GainNode | null;
  /** Call from a pointer handler if you create sounds before the first gesture listener fires. */
  unlock(): void;
}

export function createAudio(opts: { volume?: number; startMuted?: boolean } = {}): Audio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = opts.startMuted ?? tc.context?.audio.muted ?? true;
  let paused = tc.paused;

  const wantRunning = () => !muted && !paused;

  function sync(): void {
    if (!ctx) return;
    if (wantRunning() && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    else if (!wantRunning() && ctx.state === "running") void ctx.suspend().catch(() => undefined);
  }

  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = opts.volume ?? 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    sync();
    return ctx;
  }

  const unlock = () => {
    if (!wantRunning()) return;
    ensure();
    sync();
  };
  // The first gesture creates/resumes the context (autoplay policies need a user gesture).
  for (const type of ["pointerdown", "pointerup", "keydown"]) window.addEventListener(type, unlock, { capture: true });

  tc.on("mute", () => {
    muted = true;
    sync();
  });
  tc.on("unmute", () => {
    muted = false;
    ensure();
    sync();
  });
  tc.on("pause", () => {
    paused = true;
    sync();
  });
  tc.on("resume", () => {
    paused = false;
    sync();
  });
  // Creating an AudioContext costs ~50-150 ms on phones. Do it while the game boots (before ready())
  // when it launches unmuted, so the first tap only resumes it instead of causing a long task.
  void tc.init().then((c) => {
    if (opts.startMuted === undefined) muted = c.audio.muted;
    if (!muted) ensure();
    sync();
  });

  function play(sfx: SfxName | SfxParams, o: PlayOptions = {}): void {
    if (!wantRunning()) return;
    const c = ensure();
    if (!c || !master || c.state !== "running") return;
    const p: SfxParams = typeof sfx === "string" ? SFX[sfx] : sfx;
    const t0 = c.currentTime + 0.005;
    const dur = p.duration;
    const pitch = 2 ** ((o.pitch ?? 0) / 12);
    const env = c.createGain();
    const peak = (p.volume ?? 0.3) * (o.volume ?? 1);
    const attack = Math.min(p.attack ?? 0.004, dur * 0.5);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + attack);
    // Shaped decay via a short curve: punchier sounds drop faster.
    const steps = 16;
    const curve = new Float32Array(steps);
    const k = p.punch ?? 1.4;
    for (let i = 0; i < steps; i++) curve[i] = Math.max(0.0001, peak * (1 - i / (steps - 1)) ** k);
    env.gain.setValueCurveAtTime(curve, t0 + attack, Math.max(0.01, dur - attack));

    let node: AudioNode = env;
    if (p.lowpass) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = p.lowpass;
      env.connect(f);
      node = f;
    }
    if (p.highpass) {
      const f = c.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = p.highpass;
      node.connect(f);
      node = f;
    }
    if (o.pan) {
      const pan = c.createStereoPanner();
      pan.pan.value = o.pan;
      node.connect(pan);
      node = pan;
    }
    node.connect(master);

    const end = t0 + dur + 0.02;
    if (p.wave === "noise") {
      const src = c.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(p.freq * pitch, t0);
      if (p.freqEnd) bp.frequency.exponentialRampToValueAtTime(Math.max(20, p.freqEnd * pitch), t0 + dur);
      src.connect(bp).connect(env);
      src.start(t0, Math.random() * 0.5);
      src.stop(end);
      return;
    }
    const osc = c.createOscillator();
    osc.type = p.wave;
    const f0 = p.freq * pitch;
    osc.frequency.setValueAtTime(f0, t0);
    if (p.arp?.length) {
      const step = p.arpStep ?? 0.06;
      p.arp.forEach((semi, i) => osc.frequency.setValueAtTime(f0 * 2 ** (semi / 12), t0 + i * step));
    } else if (p.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.freqEnd * pitch), t0 + dur);
    }
    if (p.vibrato) {
      const lfo = c.createOscillator();
      const depth = c.createGain();
      lfo.frequency.value = p.vibrato[1];
      depth.gain.value = f0 * (2 ** (p.vibrato[0] / 12) - 1);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(end);
    }
    osc.connect(env);
    osc.start(t0);
    osc.stop(end);
  }

  return {
    play,
    note(freq, duration = 0.15, wave = "triangle", volume = 0.25) {
      play({ wave, freq, duration, volume });
    },
    get muted() {
      return muted;
    },
    get running() {
      return !!ctx && ctx.state === "running";
    },
    get ctx() {
      return ctx;
    },
    get bus() {
      return master;
    },
    unlock,
  };
}

/** Musical helpers. */
export const midiToFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);
/** Pentatonic minor steps — always sounds fine for combo pitches. */
export const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

/**
 * A quiet looping step sequencer. Steps are MIDI notes (null = rest). Scheduling uses the audio
 * clock, so it stops exactly when the context is suspended (pause / mute).
 */
export function createMusic(
  audio: Audio,
  opts: { bpm: number; steps: Array<number | null>; wave?: Exclude<Wave, "noise">; volume?: number; stepsPerBeat?: number },
): { start(): void; stop(): void; setSteps(steps: Array<number | null>): void } {
  let steps = opts.steps;
  let timer = 0;
  let next = 0;
  let i = 0;
  const stepDur = 60 / opts.bpm / (opts.stepsPerBeat ?? 2);
  const tickFn = () => {
    const c = audio.ctx;
    const bus = audio.bus;
    if (!c || !bus || c.state !== "running") return;
    if (next < c.currentTime) next = c.currentTime + 0.05;
    while (next < c.currentTime + 0.2) {
      const n = steps[i % steps.length];
      i++;
      if (n !== null && n !== undefined) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = opts.wave ?? "triangle";
        osc.frequency.value = midiToFreq(n);
        g.gain.setValueAtTime(0.0001, next);
        g.gain.linearRampToValueAtTime(opts.volume ?? 0.05, next + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, next + stepDur * 0.95);
        osc.connect(g).connect(bus);
        osc.start(next);
        osc.stop(next + stepDur);
      }
      next += stepDur;
    }
  };
  return {
    start() {
      if (timer) return;
      timer = window.setInterval(tickFn, 50);
      tickFn();
    },
    stop() {
      window.clearInterval(timer);
      timer = 0;
    },
    setSteps(s) {
      steps = s;
    },
  };
}
