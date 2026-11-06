/**
 * softbake's sound box (wooden toks, clay plaps, squelches, a little marimba, a slide whistle), plus Pinchbake's
 * kitchen: the squish of a merge that climbs a pentatonic scale with the bake and the chain, the starter's whumpf
 * when it is knocked back, an oven bell for the party cake, and a timer tick while the tin is over the rim.
 */
import { createAudio, midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

const PLIP: SfxParams = { wave: "sine", freq: 760, freqEnd: 420, duration: 0.06, volume: 0.28, punch: 2.6 };
const PLAP: SfxParams = { wave: "sine", freq: 230, freqEnd: 100, duration: 0.1, volume: 0.45, punch: 2.4, lowpass: 900 };
const PLAP_MUSH: SfxParams = { wave: "noise", freq: 520, freqEnd: 200, duration: 0.07, volume: 0.2, lowpass: 1300, punch: 2 };
const SQUISH: SfxParams = { wave: "sine", freq: 200, freqEnd: 420, duration: 0.16, volume: 0.36, vibrato: [2.2, 24], punch: 1.7 };
const SQUISH_MUSH: SfxParams = { wave: "noise", freq: 700, freqEnd: 260, duration: 0.12, volume: 0.22, lowpass: 1600, punch: 2 };
const WHUMPF: SfxParams = { wave: "sine", freq: 130, freqEnd: 48, duration: 0.3, volume: 0.6, punch: 1.8 };
const PUFF: SfxParams = { wave: "noise", freq: 1500, freqEnd: 500, attack: 0.02, duration: 0.32, volume: 0.24, highpass: 300, punch: 1.6 };
const TOK: SfxParams = { wave: "sine", freq: 980, freqEnd: 640, duration: 0.07, volume: 0.3, punch: 3.2 };
const TICK: SfxParams = { wave: "triangle", freq: 1500, duration: 0.04, volume: 0.16, punch: 3 };
const UHOH: SfxParams = { wave: "sine", freq: 520, freqEnd: 360, duration: 0.3, volume: 0.22, vibrato: [0.6, 7], punch: 1.2 };
const SLIDE_DOWN: SfxParams = { wave: "sine", freq: 1050, freqEnd: 220, duration: 0.7, volume: 0.26, vibrato: [0.5, 6], attack: 0.03, punch: 1.1 };
const BOING: SfxParams = { wave: "sine", freq: 300, freqEnd: 620, duration: 0.22, volume: 0.3, vibrato: [1.2, 16], punch: 1.6 };
const BELL: SfxParams = { wave: "triangle", freq: 1568, duration: 0.6, volume: 0.22, punch: 1.2 };

export interface Sounds {
  audio: Audio;
  drop(tier: number): void;
  land(speed: number, tier: number): void;
  merge(tier: number, chain: number): void;
  knock(amount: number): void;
  newBake(tier: number): void;
  cake(): void;
  showstopper(): void;
  danger(): void;
  tick(left: number): void;
  spill(): void;
  best(): void;
  pop(pitch: number): void;
  tok(): void;
}

export function createSounds(): Sounds {
  const audio = createAudio({ volume: 0.75 });

  /** A soft wooden bar: a sine with a quick decay plus a faint, short overtone. */
  function marimba(notes: number[], step: number, vol = 0.3): void {
    const c = audio.ctx;
    const bus = audio.bus;
    if (!c || !bus || !audio.running) return;
    const t0 = c.currentTime + 0.02;
    notes.forEach((n, i) => {
      const t = t0 + i * step;
      const f = midiToFreq(n);
      for (const [mul, v, len] of [
        [1, vol, 0.42],
        [4, vol * 0.18, 0.07],
      ] as const) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.value = f * mul;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + len + 0.02);
      }
    });
  }

  const step = (k: number) => PENTATONIC[Math.min(PENTATONIC.length - 1, Math.max(0, k))]!;

  return {
    audio,
    drop(tier) {
      audio.play(PLIP, { pitch: 4 - tier * 2, volume: 0.9 });
    },
    land(speed, tier) {
      const v = Math.min(1, speed / 9);
      if (v < 0.12) return;
      audio.play(PLAP, { volume: 0.25 + v * 0.6, pitch: 5 - tier * 1.5 + (Math.random() - 0.5) * 2 });
      audio.play(PLAP_MUSH, { volume: v * 0.8 });
    },
    merge(tier, chain) {
      // Bigger bakes squish lower; each chain link climbs the scale.
      audio.play(SQUISH, { pitch: 8 - tier * 1.6 + Math.random(), volume: 0.8 + Math.min(0.4, tier * 0.05) });
      audio.play(SQUISH_MUSH, { volume: 0.6 + tier * 0.05 });
      marimba([67 + step(tier - 1 + (chain - 1) * 2)], 0, 0.26);
      if (chain >= 2) marimba([67 + step(tier + 1 + (chain - 1) * 2)], 0.06, 0.2);
    },
    knock(amount) {
      if (amount < 0.12) return;
      audio.play(WHUMPF, { volume: Math.min(1, 0.35 + amount * 0.8), pitch: -amount * 3 });
      if (amount > 0.4) audio.play(PUFF, { volume: Math.min(1, amount) });
    },
    newBake(tier) {
      marimba([72, 76, 79, 84].map((n) => n + Math.min(5, tier - 3)), 0.075, 0.28);
      audio.play(BOING, { pitch: tier * 0.5 });
    },
    cake() {
      audio.play(BELL);
      window.setTimeout(() => audio.play(BELL, { pitch: 4 }), 160);
      marimba([72, 76, 79, 84, 88, 91, 96], 0.07, 0.3);
    },
    showstopper() {
      for (let i = 0; i < 3; i++) window.setTimeout(() => audio.play(BELL, { pitch: i * 4 }), i * 150);
      marimba([72, 76, 79, 84, 88, 91, 96, 100, 103], 0.06, 0.32);
    },
    danger() {
      audio.play(UHOH);
    },
    tick(left) {
      audio.play(TICK, { pitch: (3 - left) * 3 });
    },
    spill() {
      audio.play(SLIDE_DOWN);
      audio.play(PUFF, { volume: 0.8 });
    },
    best() {
      marimba([79, 84, 88, 91, 96], 0.08, 0.3);
      audio.play(BELL, { pitch: 7 });
    },
    pop(pitch) {
      audio.play(PLIP, { pitch, volume: 0.6 });
    },
    tok() {
      audio.play(TOK);
    },
  };
}
