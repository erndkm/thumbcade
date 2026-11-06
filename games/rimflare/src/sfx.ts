import type { Audio, SfxParams } from "@thumbcade-games/kit/audio";

/**
 * Rimflare's sounds, all synthesized: the release, the net, the iron, the glass, the ball on tar, the fire, a buzzer,
 * and a quiet city bed (filtered noise) that swells when you're hot.
 */
export const S = {
  release: { wave: "noise", freq: 700, freqEnd: 2600, attack: 0.02, duration: 0.18, volume: 0.2, highpass: 500 },
  spin: { wave: "sine", freq: 240, freqEnd: 300, duration: 0.07, volume: 0.12 },
  swish: { wave: "noise", freq: 5200, freqEnd: 1700, attack: 0.012, duration: 0.26, volume: 0.42, highpass: 1300, punch: 1.3 },
  swishBody: { wave: "noise", freq: 1500, freqEnd: 700, attack: 0.01, duration: 0.16, volume: 0.18, punch: 1.6 },
  clank: { wave: "triangle", freq: 1180, duration: 0.42, volume: 0.2, arp: [0, 6, -5, 2], arpStep: 0.016, vibrato: [0.3, 27], punch: 1.8 },
  clankLow: { wave: "square", freq: 330, freqEnd: 190, duration: 0.1, volume: 0.15, lowpass: 1100, punch: 2.6 },
  board: { wave: "sine", freq: 128, freqEnd: 68, duration: 0.16, volume: 0.6, punch: 2.2 },
  boardRattle: { wave: "noise", freq: 900, freqEnd: 260, duration: 0.1, volume: 0.25, lowpass: 2000, punch: 2.4 },
  bounce: { wave: "sine", freq: 205, freqEnd: 150, duration: 0.11, volume: 0.42, punch: 2.2 },
  bounceSlap: { wave: "noise", freq: 1800, freqEnd: 700, duration: 0.03, volume: 0.18, punch: 3 },
  score: { wave: "triangle", freq: 784, duration: 0.22, volume: 0.22, arp: [0, 7, 12], arpStep: 0.05 },
  tier: { wave: "square", freq: 523, duration: 0.46, volume: 0.1, arp: [0, 4, 7, 12, 16], arpStep: 0.06, lowpass: 2800 },
  ignite: { wave: "noise", freq: 320, freqEnd: 2800, attack: 0.05, duration: 0.42, volume: 0.32, punch: 1.2 },
  igniteLow: { wave: "sine", freq: 70, freqEnd: 110, attack: 0.04, duration: 0.4, volume: 0.35, punch: 1.4 },
  fizzle: { wave: "noise", freq: 2400, freqEnd: 500, attack: 0.01, duration: 0.36, volume: 0.22, highpass: 600, punch: 1.1 },
  tick: { wave: "square", freq: 1900, duration: 0.02, volume: 0.06, highpass: 1200 },
  refill: { wave: "triangle", freq: 1320, freqEnd: 1760, duration: 0.08, volume: 0.1 },
  countdown: { wave: "square", freq: 1046, duration: 0.05, volume: 0.09, lowpass: 3000 },
  buzzer: { wave: "square", freq: 196, duration: 0.75, volume: 0.2, lowpass: 1500, vibrato: [0.15, 6], attack: 0.01, punch: 0.6 },
  buzzerHi: { wave: "square", freq: 247, duration: 0.75, volume: 0.14, lowpass: 1500, attack: 0.01, punch: 0.6 },
  stage: { wave: "triangle", freq: 392, duration: 0.6, volume: 0.24, arp: [0, 5, 9, 12, 17], arpStep: 0.07 },
  best: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.26, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.08 },
  soft: { wave: "sine", freq: 300, freqEnd: 240, duration: 0.12, volume: 0.2 },
  whoosh: { wave: "noise", freq: 400, freqEnd: 1400, attack: 0.08, duration: 0.5, volume: 0.12, highpass: 300 },
} satisfies Record<string, SfxParams>;

/**
 * The city at night: a looping noise bed through a band-pass, barely there; `heat` (0-1) opens the filter and lifts
 * it a little while you're on fire. It lives on the kit's audio bus, so pause and mute silence it with everything else.
 */
export function createCity(audio: Audio) {
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let built = false;
  let heat = 0;
  const ensure = () => {
    const c = audio.ctx;
    const bus = audio.bus;
    if (built || !c || !bus) return !!gain;
    built = true;
    const len = Math.floor(c.sampleRate * 3);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
      d[i] = last * 7 * (0.8 + 0.2 * Math.sin((i / c.sampleRate) * 1.3));
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 260;
    filter.Q.value = 0.5;
    gain = c.createGain();
    gain.gain.value = 0.035;
    src.connect(filter).connect(gain).connect(bus);
    src.start();
    return true;
  };
  return {
    tick() {
      ensure();
    },
    setHeat(h: number) {
      if (Math.abs(h - heat) < 0.05 || !ensure() || !gain || !filter || !audio.ctx) return;
      heat = h;
      const t = audio.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0.035 + h * 0.06, t + 0.6);
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(filter.frequency.value, t);
      filter.frequency.linearRampToValueAtTime(260 + h * 520, t + 0.6);
    },
  };
}
