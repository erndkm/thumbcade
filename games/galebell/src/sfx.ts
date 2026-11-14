/**
 * Procedural sound on the kit's WebAudio engine (no samples). The buoys ring bells (each its own note of a triad,
 * pitched up with the storm), flippers clack with a thump, breakwaters slap, flags chunk down, lamp lanes tick up a
 * pentatonic step, the vane whirrs faster with its spin, the harbour clunks and kicks, a gale bass line runs under
 * the play and gains a voice with each tier, and high tide doubles it.
 */
import { createMusic, midiToFreq, PENTATONIC, type Audio, type SfxParams } from "@thumbcade-games/kit/audio";

const S = {
  flip: { wave: "noise", freq: 2600, freqEnd: 900, duration: 0.045, volume: 0.16, highpass: 600, punch: 3 },
  flipThump: { wave: "sine", freq: 150, freqEnd: 70, duration: 0.07, volume: 0.32, punch: 2 },
  flipHit: { wave: "triangle", freq: 420, freqEnd: 200, duration: 0.06, volume: 0.18 },
  bell: { wave: "sine", freq: 880, duration: 0.5, volume: 0.2, punch: 1.6 },
  bellOver: { wave: "triangle", freq: 2200, duration: 0.18, volume: 0.05, punch: 2 },
  bellClank: { wave: "noise", freq: 3200, freqEnd: 1600, duration: 0.05, volume: 0.12, highpass: 1500, punch: 3 },
  sling: { wave: "noise", freq: 1400, freqEnd: 500, duration: 0.09, volume: 0.3, punch: 2.5 },
  slingTone: { wave: "square", freq: 330, freqEnd: 240, duration: 0.06, volume: 0.06, lowpass: 2000 },
  wall: { wave: "noise", freq: 900, freqEnd: 400, duration: 0.05, volume: 0.14, punch: 3 },
  flag: { wave: "square", freq: 220, freqEnd: 110, duration: 0.1, volume: 0.12, lowpass: 1400 },
  flagThud: { wave: "noise", freq: 600, freqEnd: 200, duration: 0.08, volume: 0.25, punch: 2 },
  flags: { wave: "triangle", freq: 392, duration: 0.42, volume: 0.22, arp: [0, 4, 7, 12], arpStep: 0.06 },
  reset: { wave: "square", freq: 180, freqEnd: 360, duration: 0.12, volume: 0.06, lowpass: 1500 },
  lane: { wave: "triangle", freq: 990, duration: 0.09, volume: 0.16 },
  lamps: { wave: "square", freq: 523, duration: 0.5, volume: 0.12, arp: [0, 7, 12, 16, 19], arpStep: 0.06, lowpass: 4800 },
  spin: { wave: "square", freq: 1800, duration: 0.02, volume: 0.05, highpass: 1200 },
  whirl: { wave: "sawtooth", freq: 300, freqEnd: 1200, duration: 0.35, volume: 0.08, lowpass: 3000 },
  orbit: { wave: "noise", freq: 500, freqEnd: 3000, attack: 0.04, duration: 0.3, volume: 0.22, highpass: 300 },
  orbitTone: { wave: "triangle", freq: 659, duration: 0.24, volume: 0.16, arp: [0, 5, 12], arpStep: 0.06 },
  harbour: { wave: "sine", freq: 140, freqEnd: 60, duration: 0.25, volume: 0.45, punch: 2 },
  harbourClunk: { wave: "noise", freq: 700, freqEnd: 180, duration: 0.12, volume: 0.3, punch: 2.5 },
  kick: { wave: "noise", freq: 900, freqEnd: 2400, duration: 0.12, volume: 0.2, punch: 2 },
  kickThump: { wave: "sine", freq: 120, freqEnd: 220, duration: 0.08, volume: 0.35 },
  lock: { wave: "triangle", freq: 330, duration: 0.6, volume: 0.24, arp: [0, 7, 12, 7, 12, 19], arpStep: 0.08 },
  horn: { wave: "sawtooth", freq: 147, duration: 0.9, volume: 0.12, lowpass: 900, vibrato: [0.2, 5] },
  hornHi: { wave: "sawtooth", freq: 220, duration: 0.9, volume: 0.08, lowpass: 1100, vibrato: [0.2, 5] },
  jackpot: { wave: "square", freq: 523, duration: 0.8, volume: 0.13, arp: [0, 4, 7, 12, 16, 19, 24], arpStep: 0.07, lowpass: 5000 },
  boom: { wave: "noise", freq: 900, freqEnd: 70, duration: 0.6, volume: 0.45, punch: 2.2 },
  thud: { wave: "sine", freq: 120, freqEnd: 40, duration: 0.3, volume: 0.6, punch: 1.8 },
  tier: { wave: "sawtooth", freq: 262, duration: 0.7, volume: 0.1, arp: [0, 4, 7, 12, 16, 19], arpStep: 0.08, lowpass: 3600 },
  combo: { wave: "triangle", freq: 784, duration: 0.2, volume: 0.15, arp: [0, 7], arpStep: 0.05 },
  extra: { wave: "triangle", freq: 523, duration: 1.1, volume: 0.25, arp: [0, 4, 7, 12, 7, 12, 16, 19, 24], arpStep: 0.09 },
  launch: { wave: "noise", freq: 400, freqEnd: 2200, attack: 0.02, duration: 0.25, volume: 0.25, highpass: 200 },
  spring: { wave: "square", freq: 90, freqEnd: 260, duration: 0.12, volume: 0.1, lowpass: 900 },
  save: { wave: "triangle", freq: 392, freqEnd: 784, duration: 0.35, volume: 0.2, vibrato: [0.3, 6] },
  drain: { wave: "sawtooth", freq: 220, freqEnd: 55, duration: 0.8, volume: 0.16, lowpass: 1200, vibrato: [0.4, 5] },
  splash: { wave: "noise", freq: 1600, freqEnd: 200, duration: 0.45, volume: 0.25, punch: 1.6 },
  bonusTick: { wave: "sine", freq: 1320, duration: 0.03, volume: 0.07 },
  slip: { wave: "triangle", freq: 500, freqEnd: 250, duration: 0.2, volume: 0.12 },
  gold: { wave: "triangle", freq: 1047, duration: 0.5, volume: 0.15, arp: [0, 4, 7, 12], arpStep: 0.05 },
  over: { wave: "triangle", freq: 330, freqEnd: 110, duration: 1.0, volume: 0.18, vibrato: [0.3, 4] },
  click: { wave: "square", freq: 2400, duration: 0.018, volume: 0.06, highpass: 900 },
} satisfies Record<string, SfxParams>;

/** A triad for the three buoys (A minor), up a fourth per storm tier. */
const BELLS = [69, 72, 76];

export type Sfx = ReturnType<typeof createSfx>;

export function createSfx(audio: Audio) {
  let lastWall = 0;
  let lastSpin = 0;
  let laneStep = 0;
  // A quiet gale bass (D minor) and voices that join as the storm climbs.
  const bass = createMusic(audio, {
    bpm: 116,
    stepsPerBeat: 2,
    wave: "triangle",
    volume: 0.05,
    steps: [38, null, 38, 50, 41, null, 36, 48, 38, null, 38, 50, 43, null, 41, 40],
  });
  const lead = createMusic(audio, {
    bpm: 116,
    stepsPerBeat: 4,
    wave: "square",
    volume: 0.01,
    steps: [74, null, 77, null, 81, null, 77, null, 74, null, 72, null, 69, null, 72, null],
  });
  const tide = createMusic(audio, {
    bpm: 116,
    stepsPerBeat: 4,
    wave: "triangle",
    volume: 0.035,
    steps: [62, 69, 74, 69, 65, 72, 77, 72, 60, 67, 72, 67, 64, 69, 76, 69],
  });
  let leadOn = false;
  let tideOn = false;
  return {
    flip(side: number) {
      audio.play(S.flip, { pan: side ? 0.35 : -0.35 });
      audio.play(S.flipThump, { pan: side ? 0.35 : -0.35 });
    },
    flipperHit(speed: number, side: number) {
      audio.play(S.flipHit, { volume: Math.min(1.3, speed / 1200), pan: side ? 0.3 : -0.3 });
    },
    bell(i: number, tier: number, speed: number) {
      const n = BELLS[i]! + (tier - 1) * 2;
      audio.play(S.bell, { pitch: n - 81, volume: Math.min(1.2, 0.6 + speed / 2000) });
      audio.play(S.bellOver, { pitch: n - 81 });
      audio.play(S.bellClank, { volume: 0.7 });
    },
    gold() {
      audio.play(S.gold);
    },
    sling(side: number) {
      audio.play(S.sling, { pan: side ? 0.4 : -0.4 });
      audio.play(S.slingTone, { pitch: Math.random() * 2 });
    },
    wall(speed: number, now: number) {
      if (now - lastWall < 0.04) return;
      lastWall = now;
      audio.play(S.wall, { volume: Math.min(1, speed / 1600), pitch: Math.random() * 3 - 1.5 });
    },
    flag(i: number) {
      audio.play(S.flag, { pitch: i * 2 });
      audio.play(S.flagThud);
    },
    flags() {
      audio.play(S.flags);
    },
    flagsReset() {
      audio.play(S.reset);
    },
    lane(now: number) {
      laneStep = now - lastSpin < 2 ? laneStep + 1 : 0;
      audio.play(S.lane, { pitch: PENTATONIC[laneStep % PENTATONIC.length] ?? 0 });
    },
    lamps() {
      audio.play(S.lamps);
    },
    spin(speed: number, now: number) {
      if (now - lastSpin < 0.03) return;
      lastSpin = now;
      audio.play(S.spin, { pitch: Math.min(12, speed / 6) });
    },
    whirl() {
      audio.play(S.whirl);
    },
    orbit() {
      audio.play(S.orbit);
      audio.play(S.orbitTone);
    },
    harbour() {
      audio.play(S.harbour);
      audio.play(S.harbourClunk);
    },
    kickout() {
      audio.play(S.kick);
      audio.play(S.kickThump);
    },
    lock() {
      audio.play(S.lock);
      audio.play(S.horn);
    },
    multiball() {
      audio.play(S.horn);
      audio.play(S.hornHi);
      audio.play(S.jackpot, { pitch: -5 });
      if (!tideOn) {
        tideOn = true;
        tide.start();
      }
    },
    multiballEnd() {
      if (tideOn) {
        tideOn = false;
        tide.stop();
      }
    },
    jackpot(n: number) {
      audio.play(S.jackpot, { pitch: Math.min(7, (n - 1) * 2) });
      audio.play(S.boom, { volume: 0.7, pitch: -4 });
    },
    super() {
      audio.play(S.extra);
      audio.play(S.boom, { volume: 1.1, pitch: -6 });
      audio.play(S.thud, { volume: 1.2 });
    },
    tier(tier: number) {
      audio.play(S.tier, { pitch: (tier - 2) * 2 });
      audio.play(S.thud, { volume: 0.8, pitch: -2 });
      if (tier >= 3 && !leadOn) {
        leadOn = true;
        lead.start();
      }
    },
    combo(n: number) {
      audio.play(S.combo, { pitch: PENTATONIC[Math.min(PENTATONIC.length - 1, n)] ?? 0 });
    },
    extra() {
      audio.play(S.extra);
      audio.play(S.horn);
    },
    launch() {
      audio.play(S.launch);
      audio.play(S.spring);
    },
    save() {
      audio.play(S.save);
    },
    drain() {
      audio.play(S.splash);
      audio.play(S.drain);
    },
    bonusTick(i: number) {
      audio.play(S.bonusTick, { pitch: i });
    },
    slip() {
      audio.play(S.slip);
    },
    over() {
      audio.play(S.over);
    },
    note(m: number) {
      audio.note(midiToFreq(m), 0.12, "triangle", 0.12);
    },
    click() {
      audio.play(S.click);
    },
    music(on: boolean) {
      if (on) bass.start();
      else {
        bass.stop();
        lead.stop();
        tide.stop();
        leadOn = false;
        tideOn = false;
      }
    },
  };
}
