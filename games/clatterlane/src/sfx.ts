import type { Audio, SfxParams } from "@thumbcade-games/kit/audio";

/**
 * Clatterlane's sounds, all synthesized: the release, the ball rolling (a looping rumble that follows its speed), the
 * crash into the rack, wooden pin toks pitched up by how many impacts the throw has had so far, pins slapping the
 * deck, the gutter, the bumpers, the sweep, and the reward cues.
 */
export const S = {
  release: { wave: "noise", freq: 500, freqEnd: 1800, attack: 0.02, duration: 0.2, volume: 0.16, highpass: 300 },
  drop: { wave: "sine", freq: 120, freqEnd: 62, duration: 0.18, volume: 0.55, punch: 2.2 },
  crash: { wave: "noise", freq: 2200, freqEnd: 520, attack: 0.003, duration: 0.42, volume: 0.5, punch: 2.2 },
  crashLow: { wave: "sine", freq: 150, freqEnd: 70, duration: 0.2, volume: 0.6, punch: 2.4 },
  tok: { wave: "triangle", freq: 1050, freqEnd: 820, duration: 0.06, volume: 0.24, punch: 3.2 },
  tokClick: { wave: "noise", freq: 3600, freqEnd: 1800, duration: 0.025, volume: 0.22, highpass: 1400, punch: 3 },
  deck: { wave: "triangle", freq: 430, freqEnd: 300, duration: 0.07, volume: 0.22, punch: 2.6 },
  deckRattle: { wave: "noise", freq: 1100, freqEnd: 500, duration: 0.06, volume: 0.14, punch: 2.6 },
  wall: { wave: "sine", freq: 210, freqEnd: 130, duration: 0.09, volume: 0.25, punch: 2.4 },
  gutter: { wave: "sine", freq: 140, freqEnd: 92, attack: 0.01, duration: 0.32, volume: 0.32, punch: 1.6 },
  bumper: { wave: "sine", freq: 300, freqEnd: 420, duration: 0.12, volume: 0.24, punch: 1.8 },
  pit: { wave: "sine", freq: 95, freqEnd: 55, duration: 0.22, volume: 0.35, punch: 2 },
  sweep: { wave: "noise", freq: 300, freqEnd: 1200, attack: 0.05, duration: 0.42, volume: 0.1, highpass: 200 },
  rack: { wave: "square", freq: 180, freqEnd: 120, duration: 0.06, volume: 0.1, lowpass: 900, punch: 2.4 },
  strike: { wave: "triangle", freq: 523, duration: 0.5, volume: 0.24, arp: [0, 4, 7, 12, 16], arpStep: 0.055 },
  tier: { wave: "square", freq: 392, duration: 0.6, volume: 0.1, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.06, lowpass: 2600 },
  spare: { wave: "triangle", freq: 659, duration: 0.3, volume: 0.24, arp: [0, 5, 12], arpStep: 0.07 },
  split: { wave: "triangle", freq: 392, duration: 1.0, volume: 0.26, arp: [0, 4, 7, 12, 16, 19, 24, 28], arpStep: 0.07 },
  open: { wave: "sine", freq: 392, freqEnd: 330, duration: 0.2, volume: 0.14 },
  soft: { wave: "sine", freq: 300, freqEnd: 240, duration: 0.12, volume: 0.2 },
  wobble: { wave: "triangle", freq: 700, duration: 0.24, volume: 0.1, vibrato: [1.2, 9] },
  tick: { wave: "square", freq: 1900, duration: 0.02, volume: 0.06, highpass: 1200 },
  refill: { wave: "triangle", freq: 1320, freqEnd: 1760, duration: 0.08, volume: 0.1 },
  countdown: { wave: "square", freq: 1046, duration: 0.05, volume: 0.09, lowpass: 3000 },
  buzzer: { wave: "square", freq: 196, duration: 0.75, volume: 0.2, lowpass: 1500, vibrato: [0.15, 6], attack: 0.01, punch: 0.6 },
  buzzerHi: { wave: "square", freq: 247, duration: 0.75, volume: 0.14, lowpass: 1500, attack: 0.01, punch: 0.6 },
  best: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.26, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.08 },
  bumpersDown: { wave: "triangle", freq: 660, freqEnd: 330, duration: 0.3, volume: 0.14 },
} satisfies Record<string, SfxParams>;

/**
 * The ball rolling: a looping low noise bed through a low-pass, silent until a throw. `set(level, speed)` follows the
 * ball (louder and a little brighter when it's fast, dropping to a hollow rumble in the gutter). It lives on the kit's
 * audio bus, so pause and mute silence it with everything else.
 */
export function createRumble(audio: Audio) {
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let built = false;
  let level = 0;
  let tone = 0;
  const ensure = () => {
    const c = audio.ctx;
    const bus = audio.bus;
    if (built || !c || !bus) return !!gain;
    built = true;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.96 + (Math.random() * 2 - 1) * 0.04;
      // The seams of the lane boards: a faint periodic bump under the rumble.
      d[i] = last * 9 * (0.85 + 0.15 * Math.sin((i / c.sampleRate) * 2 * Math.PI * 23));
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    filter.Q.value = 0.8;
    gain = c.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(bus);
    src.start();
    return true;
  };
  return {
    tick() {
      ensure();
    },
    set(l: number, speed: number) {
      if ((Math.abs(l - level) < 0.02 && Math.abs(speed - tone) < 0.3) || !ensure() || !gain || !filter || !audio.ctx) return;
      level = l;
      tone = speed;
      const t = audio.ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(l * 0.32, t + 0.06);
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(filter.frequency.value, t);
      filter.frequency.linearRampToValueAtTime(140 + speed * 18, t + 0.08);
    },
  };
}
