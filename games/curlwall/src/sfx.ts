import type { Audio, SfxParams } from "@thumbcade-games/kit/audio";

/**
 * Curlwall's sounds, all synthesized: the boot on the ball, the net, the woodwork, the keeper's gloves, a whistle,
 * and a crowd made of filtered noise (a murmur loop that swells and groans).
 */
export const S = {
  kick: { wave: "sine", freq: 150, freqEnd: 52, duration: 0.16, volume: 0.75, punch: 2.2 },
  kickSnap: { wave: "noise", freq: 3200, freqEnd: 900, duration: 0.05, volume: 0.45, punch: 3 },
  swish: { wave: "noise", freq: 2400, freqEnd: 5200, attack: 0.02, duration: 0.32, volume: 0.32, highpass: 1500, punch: 1.2 },
  netThump: { wave: "sine", freq: 95, freqEnd: 60, duration: 0.18, volume: 0.35, punch: 2 },
  post: { wave: "triangle", freq: 1250, duration: 0.7, volume: 0.22, arp: [0, 7, -5, 3], arpStep: 0.018, vibrato: [0.25, 23], punch: 1.6 },
  postThud: { wave: "square", freq: 220, freqEnd: 120, duration: 0.12, volume: 0.18, lowpass: 900, punch: 2.4 },
  glove: { wave: "noise", freq: 1500, freqEnd: 400, duration: 0.11, volume: 0.5, punch: 2.6 },
  wallThud: { wave: "sine", freq: 180, freqEnd: 70, duration: 0.14, volume: 0.5, punch: 2.4 },
  bounce: { wave: "sine", freq: 120, freqEnd: 70, duration: 0.09, volume: 0.25, punch: 2 },
  whistle: { wave: "sine", freq: 2550, duration: 0.32, volume: 0.13, vibrato: [0.6, 34], attack: 0.01, punch: 0.7 },
  ring: { wave: "triangle", freq: 1046, duration: 0.55, volume: 0.24, arp: [0, 4, 7, 12, 16], arpStep: 0.05 },
  tier: { wave: "square", freq: 523, duration: 0.42, volume: 0.1, arp: [0, 4, 7, 12], arpStep: 0.07, lowpass: 2600 },
  tick: { wave: "square", freq: 1900, duration: 0.02, volume: 0.06, highpass: 1200 },
  soft: { wave: "sine", freq: 300, freqEnd: 240, duration: 0.12, volume: 0.2 },
  ballBack: { wave: "triangle", freq: 660, freqEnd: 880, duration: 0.08, volume: 0.16 },
  ballLost: { wave: "triangle", freq: 440, freqEnd: 300, duration: 0.18, volume: 0.14 },
  best: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.26, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.08 },
} satisfies Record<string, SfxParams>;

/**
 * The crowd: a looping noise bed through a band-pass, murmuring quietly; `swell` (cheers) and `groan` (misses)
 * ride its gain and filter. It lives on the kit's audio bus, so pause and mute silence it with everything else.
 */
export function createCrowd(audio: Audio) {
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let built = false;
  const ensure = () => {
    const c = audio.ctx;
    const bus = audio.bus;
    if (built || !c || !bus) return !!gain;
    built = true;
    const len = Math.floor(c.sampleRate * 2.5);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    // Brown-ish noise with slow lumps: a stand full of people, not static.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
      d[i] = last * 6 * (0.75 + 0.25 * Math.sin((i / c.sampleRate) * 2.1));
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.6;
    gain = c.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(bus);
    src.start();
    return true;
  };
  return {
    /** Call every frame: keeps the bed alive once the audio context exists. */
    tick() {
      ensure();
    },
    swell(amount: number) {
      if (!ensure() || !gain || !filter || !audio.ctx) return;
      const t = audio.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0.05 + 0.32 * amount, t + 0.25);
      gain.gain.linearRampToValueAtTime(0.05 + 0.18 * amount, t + 1.3);
      gain.gain.linearRampToValueAtTime(0.05, t + 3);
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(filter.frequency.value, t);
      filter.frequency.linearRampToValueAtTime(950 + 500 * amount, t + 0.3);
      filter.frequency.linearRampToValueAtTime(520, t + 2.8);
    },
    groan() {
      if (!ensure() || !gain || !filter || !audio.ctx) return;
      const t = audio.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.15);
      gain.gain.linearRampToValueAtTime(0.05, t + 1.2);
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(filter.frequency.value, t);
      filter.frequency.linearRampToValueAtTime(330, t + 0.25);
      filter.frequency.linearRampToValueAtTime(520, t + 1.4);
    },
    /** A sharp intake of breath as the ball goes up. */
    hush() {
      if (!ensure() || !gain || !audio.ctx) return;
      const t = audio.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.2);
    },
  };
}
