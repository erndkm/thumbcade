/**
 * Procedural sound (no samples), built on the kit's WebAudio engine. The gun ticks quietly and gets a deeper body
 * with each level; kills crunch higher as the multiplier climbs; grazes hiss a rising tick; crystals plink up a
 * pentatonic scale; the Loom gets a low siren on arrival and a long collapse when it falls.
 */
import { createMusic, midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

const S = {
  shot: { wave: "square", freq: 1250, freqEnd: 620, duration: 0.045, volume: 0.035, lowpass: 3800 },
  shotBody: { wave: "triangle", freq: 220, freqEnd: 120, duration: 0.06, volume: 0.06 },
  hit: { wave: "square", freq: 2300, duration: 0.02, volume: 0.03, highpass: 1500 },
  deflect: { wave: "triangle", freq: 3100, freqEnd: 2600, duration: 0.05, volume: 0.05 },
  pop: { wave: "noise", freq: 1800, freqEnd: 400, duration: 0.14, volume: 0.32, punch: 2.6 },
  popTone: { wave: "square", freq: 660, freqEnd: 330, duration: 0.08, volume: 0.07, lowpass: 2600 },
  boom: { wave: "noise", freq: 900, freqEnd: 70, duration: 0.55, volume: 0.5, punch: 2.2 },
  thud: { wave: "sine", freq: 140, freqEnd: 42, duration: 0.3, volume: 0.6, punch: 1.8 },
  graze: { wave: "noise", freq: 6400, freqEnd: 4200, duration: 0.05, volume: 0.12, highpass: 3000 },
  grazeTick: { wave: "sine", freq: 1800, duration: 0.035, volume: 0.07 },
  crystal: { wave: "triangle", freq: 1320, duration: 0.07, volume: 0.07 },
  pickup: { wave: "square", freq: 523, duration: 0.3, volume: 0.13, arp: [0, 7, 12, 19], arpStep: 0.055, lowpass: 5200 },
  level: { wave: "sawtooth", freq: 262, duration: 0.5, volume: 0.1, arp: [0, 4, 7, 12, 16], arpStep: 0.07, lowpass: 3600 },
  shield: { wave: "triangle", freq: 392, freqEnd: 784, duration: 0.3, volume: 0.22, vibrato: [0.3, 7] },
  shieldHit: { wave: "sawtooth", freq: 420, freqEnd: 90, duration: 0.42, volume: 0.22, lowpass: 2200 },
  alarm: { wave: "square", freq: 440, duration: 0.5, volume: 0.09, arp: [0, -5, 0, -5], arpStep: 0.12, lowpass: 2000 },
  multUp: { wave: "triangle", freq: 523, duration: 0.24, volume: 0.15, arp: [0, 4, 7], arpStep: 0.045 },
  multDown: { wave: "triangle", freq: 392, freqEnd: 260, duration: 0.2, volume: 0.1 },
  formation: { wave: "square", freq: 784, duration: 0.34, volume: 0.1, arp: [0, 5, 7, 12], arpStep: 0.06, lowpass: 4800 },
  siren: { wave: "sawtooth", freq: 180, freqEnd: 120, duration: 1.4, volume: 0.13, lowpass: 900, vibrato: [1.6, 1.8] },
  nova: { wave: "noise", freq: 300, freqEnd: 3800, attack: 0.04, duration: 0.7, volume: 0.32, highpass: 200 },
  win: { wave: "triangle", freq: 523, duration: 0.9, volume: 0.24, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.09 },
  death: { wave: "sawtooth", freq: 330, freqEnd: 55, duration: 0.9, volume: 0.22, lowpass: 1600, vibrato: [0.5, 6] },
  lost: { wave: "triangle", freq: 330, freqEnd: 220, duration: 0.18, volume: 0.08 },
} satisfies Record<string, SfxParams>;

export type Sfx = ReturnType<typeof createSfx>;

export function createSfx(audio: Audio) {
  let crystalStep = 0;
  let crystalT = 0;
  let shotN = 0;
  let lastHit = 0;
  let lastPop = 0;
  // A driving, quiet bass line (A minor), and a second voice that joins with the multiplier.
  const bass = createMusic(audio, {
    bpm: 132,
    stepsPerBeat: 2,
    wave: "triangle",
    volume: 0.06,
    steps: [45, null, 45, 57, 45, null, 43, 55, 41, null, 41, 53, 43, null, 43, 55],
  });
  const lead = createMusic(audio, {
    bpm: 132,
    stepsPerBeat: 4,
    wave: "square",
    volume: 0.012,
    steps: [69, null, 72, null, 76, null, 72, null, 69, null, 72, null, 74, null, 71, null],
  });
  let leadOn = false;

  return {
    shot(level: number, now: number) {
      // Every other volley ticks, so the stream reads as a buzz, not a machine gun.
      if (shotN++ % 2) return;
      audio.play(S.shot, { pitch: (level - 1) * 1.5 + Math.sin(now * 9) * 0.3 });
      if (level >= 3) audio.play(S.shotBody, { volume: 0.4 + 0.15 * level });
    },
    hit(now: number) {
      if (now - lastHit < 0.05) return;
      lastHit = now;
      audio.play(S.hit, { pitch: Math.random() * 3 });
    },
    deflect() {
      audio.play(S.deflect, { pitch: Math.random() * 2 });
    },
    kill(size: number, mult: number, now: number) {
      if (size <= 1 && now - lastPop < 0.03) return;
      lastPop = now;
      const step = PENTATONIC[Math.min(PENTATONIC.length - 1, mult - 1)] ?? 0;
      audio.play(S.pop, { pitch: step * 0.5 - size * 2, volume: Math.min(1, 0.6 + size * 0.2) });
      audio.play(S.popTone, { pitch: step });
      if (size >= 2) {
        audio.play(S.boom, { pitch: -size, volume: Math.min(1.2, 0.5 + size * 0.2) });
        audio.play(S.thud, { pitch: -size });
      }
    },
    graze(run: number) {
      audio.play(S.graze, { volume: 0.8 });
      audio.play(S.grazeTick, { pitch: Math.min(24, run * 1.5) });
    },
    crystal(now: number) {
      if (now - crystalT > 0.35) crystalStep = 0;
      crystalT = now;
      const semi = PENTATONIC[crystalStep % PENTATONIC.length]! + 12 * Math.floor(crystalStep / PENTATONIC.length);
      crystalStep = Math.min(crystalStep + 1, 16);
      audio.note(midiToFreq(76 + semi), 0.06, "triangle", 0.06);
    },
    pickup() {
      audio.play(S.pickup);
    },
    level(level: number) {
      audio.play(S.level, { pitch: (level - 2) * 2 });
    },
    shield() {
      audio.play(S.shield);
    },
    shieldHit(left: number) {
      audio.play(S.shieldHit);
      audio.play(S.thud, { volume: 1.2 });
      if (left === 1) audio.play(S.alarm);
    },
    multUp(mult: number) {
      audio.play(S.multUp, { pitch: (PENTATONIC[Math.min(PENTATONIC.length - 1, mult - 1)] ?? 0) });
      if (mult >= 4 && !leadOn) {
        leadOn = true;
        lead.start();
      }
    },
    multDown(mult: number) {
      audio.play(S.multDown);
      if (mult < 4 && leadOn) {
        leadOn = false;
        lead.stop();
      }
    },
    formation() {
      audio.play(S.formation);
    },
    siren() {
      audio.play(S.siren);
    },
    nova() {
      audio.play(S.nova);
      audio.play(S.boom, { volume: 0.8, pitch: -4 });
    },
    bossBoom(k: number) {
      audio.play(S.boom, { pitch: -2 - k * 3, volume: 0.7 });
    },
    win() {
      audio.play(S.win);
      audio.play(S.boom, { pitch: -6, volume: 1.2 });
      audio.play(S.thud, { pitch: -5, volume: 1.4 });
    },
    death() {
      audio.play(S.death);
      audio.play(S.boom, { pitch: -3, volume: 1.1 });
    },
    lost() {
      audio.play(S.lost);
    },
    music(on: boolean) {
      if (on) bass.start();
      else {
        bass.stop();
        lead.stop();
        leadOn = false;
      }
    },
  };
}
