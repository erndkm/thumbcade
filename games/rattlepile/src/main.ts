import { createAudio, createMusic, PENTATONIC } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { aimOf, moveDrag, startDrag, type Drag } from "./aim.ts";
import { C, eye, FRAME, makeArt, MARBLES, MAT_H, tierOf, TIERS, type Art } from "./art.ts";
import { Bits, burstSticker, drawSprite, font, hash, inkFill, loadComicFont, makeHalftone, PAL, Pows, roundRectPath, setSpriteScale, sticker, stickerWord, Wobble } from "./comic.ts";
import { DEMO, Pilot, SKILLS } from "./pilot.ts";
import { QA_PILOT_SEED, runSeed } from "./runs.ts";
import { S as SND } from "./sfx.ts";
import { ADVANCE_TICKS, BLOCK, CELL, clampAim, COLS, FLOOR, HZ, PILE_H, PLUS, R, ROWS, Sim, STREAK_TIERS, W as FW, ZAP, type SimEvent } from "./sim.ts";

// ---------------------------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------------------------
/** Seconds between the pile reaching the floor and gameplay.end, well inside the 1 s rule. */
const END_AFTER = 0.85;
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=expert vite build`); a normal build can't. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

const PANEL_W = FW + FRAME * 2;
const PANEL_H = MAT_H + FRAME * 2;
const SMASH_WORDS = ["TOK!", "CRACK!", "POP!", "CLONK!", "BAM!", "KER-TOK!"];
const CHAIN_WORDS: Record<number, string> = { 4: "COMBO!", 7: "MEGA RATTLE!", 10: "BONKERS!" };
const TIER_WORDS = ["", "", "×2 HOT STREAK!", "×3 ON A ROLL!", "×4 UNSTOPPABLE!"];
const CONFETTI = [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.banana];

interface Chunk {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
  max: number;
  seed: number;
}
interface Beam {
  c: number;
  r: number;
  t: number;
}
interface Roller {
  x: number;
  hue: number;
}
interface Later {
  t: number;
  run: () => void;
}
async function main() {
  const [session] = await Promise.all([createSession({ id: "rattlepile", restartDelayMs: 900 }), loadComicFont()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
  } catch {
    /* guests and offline: show the hint */
  }

  const view = createCanvas({ maxDpr: 2, background: C.sky });
  const g = view.ctx;
  let W = view.width;
  let H = view.height;
  let D = view.dpr;
  /** HUD unit: 1 on a 390 pt phone. */
  let U = 1;
  /** The mat's scale and origin in play and in attract, and the blend between them (0 attract, 1 play). */
  let Sp = 1;
  let fxP = 0;
  let fyP = 0;
  let Sa = 1;
  let fxA = 0;
  let fyA = 0;
  let modeK = 0;
  let S = 1;
  let fx = 0;
  let fy = 0;
  let art: Art | null = null;
  let halftone: HTMLCanvasElement | null = null;

  // -------------------------------------------------------------------------------------------------------------
  // Audio and juice
  // -------------------------------------------------------------------------------------------------------------
  const audio = createAudio();
  const BASS = [48, null, 55, null, 52, 55, null, 48, 53, null, 60, null, 57, 60, null, 53, 50, null, 57, null, 53, 57, null, 50, 55, null, 62, 59, 55, null, 59, 62];
  const music = createMusic(audio, { bpm: 124, wave: "triangle", volume: 0.04, steps: BASS });
  const shake = new Shake(9, 0.02, 2.2, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.16, decay: 0.4 });
  const puffs = new Particles(300);
  const bits = new Bits(280);
  const hudBits = new Bits(140);
  const pows = new Pows(reduced);
  const hudPows = new Pows(reduced);
  const scorePop = new Wobble(300, 11);
  const marblePop = new Wobble(300, 10);
  const multPop = new Wobble(320, 10);
  const titlePop = new Wobble(200, 9);

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = (session.ctx.seed >>> 0) ^ 0x7a11;
  let sim = new Sim({ seed: demoSeed, demo: true });
  let pilot: Pilot | null = new Pilot(DEMO, createRng(demoSeed ^ 99));
  let qaPilot: Pilot | null = null;
  let qaAcc = 0;
  let time = 0;
  let shown = 0;
  let overT = -1;
  let endSent = false;
  let bestCheered = false;
  let bestAtStart: number | null = null;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string } | null = null;
  let chunks: Chunk[] = [];
  let beams: Beam[] = [];
  let rollers: Roller[] = [];
  let later: Later[] = [];
  let aim: Drag | null = null;
  let queued: [number, number] | null = null;
  let cannonX = FW / 2;
  let cannonA = 0;
  let recoil = 0;
  let blinkT = 2;
  let tokAt = 0;
  let tickAt = 0;
  let smashStopAt = -1;
  let buzzAt = -1;
  let nudgeT = 0;
  let fastT = 0;
  let dangerK = 0;
  let overCols: number[] = [];
  let demoOverT = 0;
  let hurryShown = false;

  // -------------------------------------------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------------------------------------------
  const titleK = () => Math.min(1.2, (W - session.preview().left - session.preview().right - 24) / 300);

  function layout() {
    W = view.width;
    H = view.height;
    D = view.dpr;
    setSpriteScale(D);
    U = clamp(Math.min(W / 390, H / 700), 0.85, 1.3);
    const top = session.play().top;
    const hud = 80 * U;
    const below = Math.min(92, H * 0.12);
    Sp = clamp(Math.min((W - 14) / PANEL_W, (H - top - hud - below) / PANEL_H), 0.5, 1.5);
    fxP = (W - FW * Sp) / 2;
    fyP = top + hud + FRAME * Sp;
    const aTop = session.preview().top + 142 * titleK();
    Sa = clamp(Math.min(Sp, (H - aTop - 8) / PANEL_H), 0.4, 1.5);
    fxA = (W - FW * Sa) / 2;
    fyA = aTop + FRAME * Sa;
    const k = Math.min(3, Sp * D * 1.05);
    if (!art || Math.abs(art.k - k) > 0.01) art = makeArt(k);
    const hd = Math.min(D, 1.5);
    halftone = makeHalftone(W * hd, H * hd, 15 * hd, PAL.white, (x, y) => clamp(0.05 + y * y * 0.5 + Math.abs(x - 0.5) * 0.2, 0, 0.75));
    blend();
  }
  function blend() {
    S = lerp(Sa, Sp, modeK);
    fx = lerp(fxA, fxP, modeK);
    fy = lerp(fyA, fyP, modeK);
  }
  layout();
  view.onResize(layout);
  session.on("insets", layout);

  /** Logical mat px → screen px. */
  const sx = (x: number) => fx + x * S;
  const sy = (y: number) => fy + y * S;

  // -------------------------------------------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------------------------------------------
  function resetFx() {
    puffs.clear();
    bits.clear();
    hudBits.clear();
    pows.clear();
    hudPows.clear();
    chunks = [];
    beams = [];
    rollers = [];
    later = [];
    aim = null;
    queued = null;
    overCols = [];
    smashStopAt = -1;
    fastT = 0;
    dangerK = 0;
    recoil = 0;
    hurryShown = false;
    cannonX = sim.launcherX;
    cannonA = 0;
  }

  function newAttract() {
    mode = "attract";
    demoSeed = (demoSeed * 1664525 + 1013904223) >>> 0;
    sim = new Sim({ seed: demoSeed, demo: true });
    pilot = new Pilot(DEMO, createRng(demoSeed ^ 99));
    demoOverT = 0;
    resetFx();
  }

  function startRun() {
    mode = "play";
    sim = new Sim({ seed: runSeed(session.ctx.seed, session.runs) });
    pilot = null;
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(QA_PILOT_SEED)) : null;
    qaAcc = 0;
    resetFx();
    shown = 0;
    overT = -1;
    endSent = false;
    bestCheered = false;
    bestAtStart = session.best;
    summary = null;
    nudgeT = 0;
    music.start();
    audio.play(SND.whistleUp, { volume: 0.5, pitch: 2 });
    audio.play(SND.sproing, { volume: 0.6 });
    hudPows.burst("RATTLE 'EM!", W / 2, H * 0.4, { size: 30, fill: PAL.tomato, life: 0.9 });
  }

  session.startOnTap(window);
  session.on("start", startRun);

  // -------------------------------------------------------------------------------------------------------------
  // Input: drag anywhere. Pull back like a slingshot or point where you want it: either way, let go to fire.
  // -------------------------------------------------------------------------------------------------------------
  const playing = () => mode === "play" && session.phase === "playing" && !session.paused && !sim.over;
  const canGuide = () => sim.phase === "aim" || sim.phase === "advance" || sim.phase === "settle";

  function fireNow(d: [number, number]) {
    if (!sim.fire(d[0], d[1])) return;
    recoil = 1;
    if (!hintSeen) {
      hintSeen = true;
      tc.storage.set("hint", true).catch(() => undefined);
    }
  }

  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (aim || !playing() || qaPilot) return;
    aim = startDrag(e.pointerId, e.clientX, e.clientY);
  });
  window.addEventListener("pointermove", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    if (moveDrag(aim, e.clientX, e.clientY) && canGuide() && playing()) audio.play(SND.tick, { volume: 2 });
  });
  window.addEventListener("pointerup", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    const a = aim;
    aim = null;
    if (!playing()) return;
    const d = aimOf(a);
    if (d) {
      if (sim.phase === "aim") fireNow(d);
      else if (sim.phase === "settle" || sim.phase === "advance") queued = d;
    } else if (sim.phase === "aim" && session.phaseTime > 0.5) {
      // A tap fires nothing: say how.
      nudgeT = 1.6;
      audio.play(SND.boop, { volume: 0.5 });
    }
  });
  window.addEventListener("pointercancel", (e) => {
    if (aim && e.pointerId === aim.id) aim = null;
  });
  session.on("cancel", () => (aim = null));
  session.on("pause", () => {
    music.stop();
    aim = null;
    queued = null;
  });
  session.on("resume", () => {
    if (mode === "play" && session.phase === "playing") music.start();
  });

  // -------------------------------------------------------------------------------------------------------------
  // Juice helpers
  // -------------------------------------------------------------------------------------------------------------
  const loud = () => mode === "play";
  const vol = () => (mode === "play" ? 1 : 0.3);

  function emitChunks(x: number, y: number, colors: readonly string[], n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.7);
      chunks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, size: 5 + Math.random() * 5, color: colors[i % colors.length]!, life: 0, max: 0.5 + Math.random() * 0.4, seed: Math.floor(Math.random() * 1000) });
    }
    if (chunks.length > 80) chunks.splice(0, chunks.length - 80);
  }

  function cheerBest() {
    bestCheered = true;
    hudPows.burst("NEW BEST!", W / 2, H * 0.3, { size: 34, fill: PAL.banana, life: 1.4 });
    audio.play(SND.fanfare);
    flash.trigger(PAL.banana, 0.6);
    session.feedback("success");
    confettiCannons();
  }

  function confettiCannons() {
    for (const side of [-1, 1])
      hudBits.emit(W / 2 + side * W * 0.44, H * 0.62, { count: 24, speed: [320, 640], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.6], size: [8, 13], colors: CONFETTI, shape: "confetti", gravity: 700, drag: 1.2 });
  }

  function handle(e: SimEvent) {
    switch (e.k) {
      case "fire":
        recoil = Math.max(recoil, 0.7);
        puffs.emit(cannonX + sim.aimX * 30, FLOOR - 8 + sim.aimY * 30, { count: 2, speed: [20, 70], life: [0.12, 0.22], size: [5, 9], colors: [PAL.white], shape: "circle", endScale: 1.6 });
        audio.play(SND.pock, { volume: vol(), pitch: PENTATONIC[e.n % PENTATONIC.length]! - 5 });
        break;
      case "wall":
        if (loud() && time - tickAt > 0.05) {
          tickAt = time;
          audio.play(SND.tick, { pitch: Math.random() * 3 });
        }
        break;
      case "hit": {
        const t = TIERS[tierOf(e.hp + 1)]!;
        bits.emit(e.x, e.y, { count: 2, speed: [60, 150], life: [0.14, 0.26], size: [3.5, 5.5], colors: [t.fill, PAL.white], shape: "dot" });
        if (time - tokAt > 0.032) {
          tokAt = time;
          const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.floor(sim.volleyHits / 4))]!;
          audio.play(SND.tok, { volume: vol(), pitch: step + (e.zap ? 7 : 0) });
        }
        break;
      }
      case "smash": {
        const t = TIERS[tierOf(e.max)]!;
        const colors = [t.fill, t.hi, PAL.white];
        bits.emit(e.x, e.y, { count: 12, speed: [120, 330], life: [0.35, 0.65], size: [6, 10], colors, shape: "confetti", gravity: 520, drag: 1.4 });
        puffs.emit(e.x, e.y, { count: 5, speed: [20, 90], life: [0.2, 0.36], size: [10, 18], colors: [PAL.white], shape: "circle", endScale: 1.5 });
        emitChunks(e.x, e.y, [t.fill, t.shade], 5, 260);
        const big = e.chain >= 4;
        pows.float(`+${e.pts}`, e.x, Math.max(18, e.y - 6), { size: Math.min(26, 14 + e.chain * 1.2), textFill: e.chain >= 7 ? PAL.banana : e.chain >= 4 ? PAL.bananaHi : PAL.white, life: 0.7 });
        const word = CHAIN_WORDS[e.chain];
        if (word) {
          hudPows.burst(word, W / 2, sy(PILE_H * 0.42), { size: e.chain >= 10 ? 30 : 24, fill: e.chain >= 10 ? PAL.tomato : PAL.banana, life: 0.8 });
          if (loud()) session.feedback("success");
        } else if (e.close) {
          pows.burst("CLOSE CALL!", clamp(e.x, 80, FW - 80), e.y - 34, { size: 16, fill: PAL.lime, life: 0.7 });
        } else if (e.chain % 3 === 1 && e.max >= 4) {
          pows.burst(SMASH_WORDS[(e.chain + e.c) % SMASH_WORDS.length]!, clamp(e.x, 50, FW - 50), Math.max(30, e.y - 26), { size: 14, fill: PAL.bubblegum, life: 0.45 });
        }
        shake.add(big ? 0.2 : 0.1);
        if (time - smashStopAt > 0.2) {
          smashStopAt = time;
          hitStop.freeze(big ? 0.045 : 0.025);
          if (loud()) session.feedback("impact");
        }
        scorePop.kick(1.2);
        audio.play(SND.pop, { volume: vol(), pitch: Math.min(14, e.chain * 1.5) });
        if (loud()) audio.play(SND.crack, { volume: 0.7, pitch: Math.min(10, e.chain) });
        break;
      }
      case "plus": {
        pows.float("+1", clamp(e.x, 20, FW - 20), e.y - 10, { size: 21, textFill: PAL.limeHi, life: 0.8 });
        bits.emit(e.x, e.y, { count: 8, speed: [80, 200], life: [0.25, 0.45], size: [5, 8], colors: [PAL.lime, PAL.white], shape: "star" });
        marblePop.kick(5);
        audio.play(SND.ding, { volume: vol() });
        if (loud()) session.feedback("tap");
        break;
      }
      case "zap":
        beams.push({ c: e.c, r: e.r, t: 0 });
        if (beams.length > 6) beams.shift();
        pows.burst("ZAP!", clamp(e.x, 50, FW - 50), e.y - 30, { size: 18, fill: PAL.bubblegum, life: 0.5 });
        shake.add(0.16);
        audio.play(SND.zap, { volume: vol() });
        break;
      case "land":
        if (e.first) {
          puffs.emit(e.x, FLOOR, { count: 4, speed: [30, 90], angle: [-Math.PI, 0], life: [0.2, 0.35], size: [6, 10], colors: [PAL.white], shape: "circle", endScale: 1.5 });
          audio.play(SND.roll, { volume: vol() });
        } else if (rollers.length < 40) {
          rollers.push({ x: e.x, hue: rollers.length % MARBLES.length });
        }
        break;
      case "speed":
        fastT = 1.2;
        if (loud()) audio.play(SND.fast, { pitch: e.scale > 2 ? 4 : 0 });
        break;
      case "recall":
        hudPows.burst("COME HOME!", W / 2, sy(PILE_H * 0.5), { size: 22, fill: PAL.cobalt, life: 0.8 });
        audio.play(SND.whistleDown, { volume: vol() * 0.7 });
        break;
      case "volleyEnd":
        if (e.gained > 0) {
          marblePop.kick(7);
          hudPows.float(`+${e.gained}`, W - session.play().right - 44 * U, session.play().top + 62 * U, { size: 18, textFill: PAL.limeHi, life: 0.9 });
        }
        if (e.smashes === 0 && loud()) audio.play(SND.boop, { volume: 0.5 });
        break;
      case "sweep":
        hudPows.burst("CLEAN SWEEP!", W / 2, sy(PILE_H * 0.36), { size: 30, fill: PAL.lime, life: 1.3 });
        later.push({ t: 0.35, run: () => hudPows.float(`+${e.pts}  +1 MARBLE`, W / 2, sy(PILE_H * 0.36) + 58, { size: 18, textFill: PAL.banana, life: 1 }) });
        confettiCannons();
        flash.trigger(PAL.lime, 0.5);
        shake.add(0.25);
        audio.play(SND.fanfare, { volume: vol() });
        later.push({ t: 0.3, run: () => audio.play(SND.chaChing, { volume: vol() }) });
        if (loud()) session.feedback("success");
        break;
      case "streak":
        if (e.up) {
          multPop.kick(8);
          hudPows.burst(TIER_WORDS[e.mult] ?? `×${e.mult}!`, W / 2, session.play().top + 150 * U, { size: 20, fill: e.mult >= 4 ? PAL.tomato : PAL.banana, life: 0.9 });
          audio.play(SND.tier, { volume: vol(), pitch: (e.mult - 2) * 2 });
          if (loud()) session.feedback("tap");
        } else multPop.kick(2.5);
        break;
      case "streakLost":
        if (loud()) {
          hudPows.float(`×${e.mult} STREAK COOLED`, W / 2, session.play().top + 96 * U, { size: 14, textFill: PAL.white, life: 0.9 });
          audio.play(SND.boop, { volume: 0.6 });
        }
        break;
      case "advance":
        later.push({ t: 0.2, run: () => {
          shake.add(e.creep ? 0.3 : 0.14);
          audio.play(SND.clunk, { volume: vol() * (e.creep ? 1 : 0.7) });
        } });
        if (e.creep && loud()) {
          hudPows.burst(hurryShown ? "TICK TOCK!" : "TOO SLOW!", W / 2, sy(PILE_H * 0.5), { size: 26, fill: PAL.tomato, life: 0.8 });
          hurryShown = true;
          if (time - buzzAt > 0.5) {
            buzzAt = time;
            audio.play(SND.buzz);
            session.feedback("fail");
          }
        }
        break;
      case "danger":
        if (loud()) {
          later.push({ t: 0.3, run: () => {
            pows.burst(e.level === 2 ? "LAST ROW!" : "GETTING CLOSE!", FW / 2, PILE_H - (e.level === 2 ? 76 : 126), { size: e.level === 2 ? 22 : 17, fill: e.level === 2 ? PAL.tomato : C.orange, life: 0.9 });
            audio.play(e.level === 2 ? SND.kazooHi : SND.kazoo, { volume: 0.8 });
          } });
        }
        break;
      case "over":
        overCols = e.cols;
        overT = 0;
        hitStop.freeze(0.12);
        shake.add(0.8);
        for (const c of e.cols) {
          const x = (c + 0.5) * CELL;
          puffs.emit(x, FLOOR - 6, { count: 8, speed: [40, 180], angle: [-Math.PI, 0], life: [0.3, 0.6], size: [10, 22], colors: [PAL.white], shape: "circle", endScale: 1.5 });
          bits.emit(x, FLOOR - 14, { count: 10, speed: [140, 360], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.8], size: [6, 10], colors: [PAL.tomato, PAL.white, PAL.banana], shape: "star", gravity: 500 });
        }
        if (loud()) {
          hudPows.burst("PILE-UP!", W / 2, sy(PILE_H * 0.5), { size: 34, fill: PAL.tomato, life: 1.3 });
          flash.trigger(PAL.tomato, 0.5);
          audio.play(SND.whistleDown);
          audio.play(SND.boom, { volume: 0.8 });
          audio.play(SND.thud);
          session.feedback("impact");
          music.stop();
        }
        break;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD positions and the game-over tip
  // -------------------------------------------------------------------------------------------------------------
  const scorePos = () => ({ x: session.play().left + 16, y: session.play().top + 30 * U });

  function tipFor(): string {
    const s = sim.stats;
    if (s.volleys === 0) return "DRAG BACK, AIM, LET GO: THE WHOLE BAG FLIES!";
    if (s.creeps >= 2) return "DON'T DAWDLE: THE PILE CREEPS WHILE YOU WAIT!";
    if (s.plus < (s.plus + s.plusMissed) * 0.6) return "GRAB THE +1 RINGS: MORE MARBLES, MORE RATTLE!";
    if (s.elevSum / s.volleys > 1.15) return "AIM LOW OFF A WALL: MARBLES RATTLE BETWEEN ROWS!";
    if (s.maxChain < 5) return "GET MARBLES ABOVE THE PILE: THEY SMASH THEIR WAY DOWN!";
    if (s.duds >= 3) return "PICK ON THE SMALL NUMBERS FIRST!";
    if (s.maxMult < 3) return "SMASH A BLOCK EVERY VOLLEY TO BUILD A STREAK!";
    return "THE LOWEST ROW FIRST: IT'S THE ONE THAT ENDS YOU!";
  }

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    // QA runs skip hit-stop, so the run's clock is the wall clock and its screenshots can be planned.
    const dt = QA_AUTOPLAY ? rawDt : hitStop.scale(rawDt);
    modeK = damp(modeK, mode === "play" ? 1 : 0, reduced ? 30 : 9, rawDt);
    if (Math.abs(modeK - (mode === "play" ? 1 : 0)) < 0.002) modeK = mode === "play" ? 1 : 0;
    blend();
    shake.update(rawDt);
    flash.update(rawDt);
    puffs.update(rawDt);
    bits.update(rawDt);
    hudBits.update(rawDt);
    pows.update(rawDt);
    hudPows.update(rawDt);
    scorePop.update(rawDt);
    marblePop.update(rawDt);
    multPop.update(rawDt);
    titlePop.update(rawDt);
    recoil = Math.max(0, recoil - rawDt * 7);
    nudgeT = Math.max(0, nudgeT - rawDt);
    fastT = Math.max(0, fastT - rawDt);
    blinkT -= rawDt;
    if (blinkT < -0.12) blinkT = 1.5 + Math.random() * 2.5;
    for (const l of later) l.t -= rawDt;
    if (later.some((l) => l.t <= 0)) {
      const due = later.filter((l) => l.t <= 0);
      later = later.filter((l) => l.t > 0);
      for (const l of due) l.run();
    }
    for (const c of chunks) {
      c.life += rawDt;
      c.vy += 700 * rawDt;
      c.x += c.vx * rawDt;
      c.y += c.vy * rawDt;
      c.rot += c.vr * rawDt;
    }
    if (chunks.some((c) => c.life > c.max)) chunks = chunks.filter((c) => c.life <= c.max);
    for (const b of beams) b.t += rawDt;
    if (beams.some((b) => b.t > 0.3)) beams = beams.filter((b) => b.t <= 0.3);

    if (dt > 0) {
      if (mode === "attract") {
        pilot?.step(sim, dt);
      } else if (playing()) {
        if (qaPilot) {
          // In lockstep, sixty looks a second: the same run scripts/shoot-plan.ts replays headless.
          qaAcc += dt;
          while (qaAcc >= 1 / 60 - 1e-9 && !sim.over) {
            qaAcc -= 1 / 60;
            qaPilot.step(sim, 1 / 60);
            sim.step(1 / 60);
          }
        } else if (queued && sim.phase === "aim") {
          const q = queued;
          queued = null;
          fireNow(q);
        }
      }
      if (mode === "attract" || (session.phase === "playing" && !qaPilot)) sim.step(dt);
      for (const e of sim.events) handle(e);
      sim.events.length = 0;
      if (mode === "attract" && (sim.over || sim.t > 70)) {
        demoOverT += dt;
        if (demoOverT > 1.4) newAttract();
      }
    }

    // The cannon: rolls to where the first marble landed, and turns to the shot being lined up.
    cannonX = damp(cannonX, sim.launcherX, 12, rawDt);
    let want: [number, number] | null = null;
    if (mode === "attract" && pilot?.target) want = pilot.target;
    else if (aim && playing() && canGuide()) want = aimOf(aim);
    else if (queued) want = queued;
    else if (sim.phase === "volley") want = [sim.aimX, sim.aimY];
    if (want) cannonA = damp(cannonA, Math.atan2(want[0], -want[1]), 22, rawDt);
    for (const r of rollers) r.x = r.x + clamp(cannonX - r.x, -520 * rawDt, 520 * rawDt);
    if (rollers.length && sim.phase !== "volley") rollers = rollers.filter((r) => Math.abs(r.x - cannonX) > 6);

    const low = sim.lowestRow;
    dangerK = damp(dangerK, low >= ROWS - 1 ? 1 : low === ROWS - 2 ? 0.45 : 0, 5, rawDt);

    // The counter rolls up to the score.
    const target = sim.score;
    shown = shown < target ? Math.min(target, damp(shown, target, 10, rawDt) + 1) : target;
    if (mode === "play" && !bestCheered && bestAtStart !== null && bestAtStart > 0 && shown > bestAtStart && session.phase === "playing") cheerBest();

    if (mode === "play" && overT >= 0 && !endSent) {
      overT += rawDt;
      if (overT >= END_AFTER) {
        endSent = true;
        const prevBest = session.best;
        const s = sim.stats;
        const res = session.end(sim.score, { stats: { rows: sim.turn, marbles: sim.marbles, smashes: s.smashes, maxChain: s.maxChain, sweeps: s.sweeps, maxMult: s.maxMult } });
        summary = { score: sim.score, isBest: res.isBest, prevBest, tip: tipFor() };
        if (res.isBest && prevBest !== null && !bestCheered) hudPows.burst("NEW BEST!", W / 2, H * 0.3, { size: 36, fill: PAL.banana, life: 1.6 });
      }
    } else if (overT >= 0) overT += rawDt;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------------------------
  function drawBackdrop() {
    g.fillStyle = C.sky;
    g.fillRect(0, 0, W, H);
    const cx = W * 0.5;
    const cy = H * 0.4;
    const rad = Math.hypot(W, H);
    const rot = reduced ? 0.12 : time * 0.05;
    const rays = 16;
    g.fillStyle = C.skyRay;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a0 = rot + (i / rays) * Math.PI * 2;
      const a1 = rot + ((i + 0.5) / rays) * Math.PI * 2;
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
      g.lineTo(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad);
      g.closePath();
    }
    g.fill();
    if (halftone) {
      g.globalAlpha = 0.22;
      g.drawImage(halftone, 0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  function drawMat(a: Art) {
    drawSprite(g, a.mat, 0, 0);
    // The last row glows when the pile is close.
    if (dangerK > 0.02) {
      g.globalAlpha = dangerK * (0.16 + 0.2 * light.pulse(time, 1.4, { still: 0.5 }));
      g.fillStyle = PAL.tomato;
      g.fillRect(1.6, PILE_H - CELL, FW - 3.2, CELL);
      g.globalAlpha = 1;
    }
    // The creep fuse along the top edge: it fills while the thumb dawdles.
    const cf = sim.creepFrac;
    if (cf > 0.3 && mode === "play") {
      const k = (cf - 0.3) / 0.7;
      roundRectPath(g, 8, 5, FW - 16, 7, 3.5);
      g.fillStyle = "rgba(22,18,28,0.18)";
      g.fill();
      roundRectPath(g, 8, 5, Math.max(7, (FW - 16) * k), 7, 3.5);
      g.fillStyle = k > 0.7 ? PAL.tomato : C.orange;
      g.fill();
    }
  }

  function drawBeams() {
    for (const b of beams) {
      const k = 1 - b.t / 0.3;
      g.globalAlpha = k;
      g.fillStyle = PAL.bubblegumHi;
      const wv = 16 * k;
      g.fillRect(0, (b.r + 0.5) * CELL - wv / 2, FW, wv);
      g.fillRect((b.c + 0.5) * CELL - wv / 2, 0, wv, PILE_H);
      g.fillStyle = PAL.white;
      g.fillRect(0, (b.r + 0.5) * CELL - wv / 6, FW, wv / 3);
      g.fillRect((b.c + 0.5) * CELL - wv / 6, 0, wv / 3, PILE_H);
      g.globalAlpha = 1;
    }
  }

  function drawPile(a: Art) {
    const adv = sim.phase === "advance" ? 1 - easeOutBack(clamp(sim.pt / ADVANCE_TICKS), 1.3) : 0;
    const cf = mode === "play" ? sim.creepFrac : 0;
    const rumble = cf > 0.55 && !reduced ? Math.sin(time * 38) * (cf - 0.55) * 2.6 : 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const kind = sim.kind[i]!;
        if (!kind) continue;
        const x = (c + 0.5) * CELL + rumble * (r % 2 ? 1 : -1);
        // A fresh row slides in from above the mat; the rest step down one square.
        let y = (r + 0.5) * CELL - adv * CELL * (r === 1 ? 2 : 1);
        if (kind === BLOCK) {
          const hp = sim.hp[i]!;
          const age = (sim.tick - sim.hitAt[i]!) / HZ;
          const wob = age < 0.5 ? 1 + 0.17 * Math.exp(-age * 13) * Math.cos(age * 36) : 1;
          let rot = 0;
          if (overT >= 0 && r === ROWS - 1 && overCols.includes(c)) {
            // The block that reached the floor drops onto it.
            const k = clamp(overT / 0.22);
            y += k * k * (FLOOR - PILE_H - 2);
            rot = (c % 2 ? 1 : -1) * 0.12 * k;
          }
          drawSprite(g, a.blocks[tierOf(hp)]!, x, y, rot, wob, wob);
          sticker(g, String(hp), x - 0.5, y - 1, { size: hp >= 100 ? 17 : hp >= 10 ? 21 : 25, fill: PAL.white, shadow: 2, stroke: 0.22, rot, sx: wob, sy: wob });
        } else if (kind === PLUS) {
          const k = 1 + 0.08 * Math.sin(time * 4 + c);
          drawSprite(g, a.plus, x, y, 0, k, k);
        } else if (kind === ZAP) {
          const k = 1 + 0.07 * Math.sin(time * 5 + c);
          drawSprite(g, a.zap, x, y, reduced ? 0 : time * 0.8, k, k);
        }
      }
    }
  }

  /** Dots marching along the first marble's path. */
  function drawGuide(d: [number, number], alpha: number) {
    if (alpha <= 0.01) return;
    const pts = sim.trace(d[0], d[1], 2, 640);
    const gap = 15;
    let dist = 30 + (reduced ? 0 : (time * 46) % gap);
    let total = 0;
    g.lineWidth = 2;
    g.strokeStyle = PAL.ink;
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]!;
      const p1 = pts[i]!;
      const seg = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      while (dist < total + seg) {
        const t = (dist - total) / seg;
        const fade = 1 - Math.min(1, dist / 640) * 0.65;
        g.globalAlpha = alpha * fade;
        g.beginPath();
        g.arc(lerp(p0.x, p1.x, t), lerp(p0.y, p1.y, t), i === 1 ? 4 : 3, 0, Math.PI * 2);
        g.fillStyle = i === 1 ? PAL.white : PAL.bananaHi;
        g.fill();
        g.stroke();
        dist += gap;
        if (++n > 60) break;
      }
      total += seg;
    }
    const end = pts[pts.length - 1]!;
    g.globalAlpha = alpha * 0.8;
    g.beginPath();
    g.arc(end.x, end.y, R + 1, 0, Math.PI * 2);
    g.lineWidth = 2.4;
    g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  function drawMarbles(a: Art) {
    for (const r of rollers) drawSprite(g, a.marbles[r.hue]!, r.x, FLOOR - R + 1, r.x * 0.14);
    for (const b of sim.balls) {
      if (b.ghost) g.globalAlpha = 0.55;
      drawSprite(g, a.marbles[b.id % a.marbles.length]!, b.x, b.y, (b.x + b.y) * 0.05);
      g.globalAlpha = 1;
    }
  }

  function drawCannon(a: Art) {
    const x = cannonX;
    drawSprite(g, a.cart, x, FLOOR - 2);
    g.save();
    g.translate(x, FLOOR - 9);
    g.rotate(cannonA);
    g.translate(0, recoil * recoil * 7);
    g.scale(0.94 * (1 + recoil * 0.1), 0.94 * (1 - recoil * 0.12));
    drawSprite(g, a.barrel, 0, 0);
    if (blinkT < 0 || recoil > 0.5) {
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.4;
      g.lineCap = "round";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 6 - 3.5, -15);
        g.lineTo(s * 6 + 3.5, -15);
        g.stroke();
      }
    } else {
      const wob = Math.sin(time * 1.7) * 0.25;
      eye(g, -6, -15, 5.4, wob, -0.9, 1.8);
      eye(g, 6, -15, 5.4, wob, -0.9, 1.8);
    }
    g.restore();
  }

  function drawChunks() {
    g.lineJoin = "round";
    for (const c of chunks) {
      const k = c.life / c.max;
      const s = c.size * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      if (s < 1) continue;
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.rot);
      g.beginPath();
      const n = 3 + (c.seed % 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = s * (0.6 + hash(c.seed, i) * 0.5);
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      inkFill(g, c.color, 2, 0);
      g.restore();
    }
  }

  function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
  }

  function drawHud(a: Art) {
    hudBits.draw(g);
    hudPows.draw(g);
    if (mode !== "play") {
      drawAttract();
      return;
    }
    const k = U;
    const top = session.play().top;
    const sp = scorePos();
    g.save();
    g.translate(sp.x, sp.y);
    g.rotate(-0.05);
    g.scale(scorePop.v, scorePop.v);
    sticker(g, fmt(shown), 0, 0, { size: Math.round(32 * k), align: "left", fill: PAL.white, shadow: 4 });
    g.restore();
    if (bestAtStart !== null && bestAtStart > 0) sticker(g, bestCheered ? "NEW BEST!" : `BEST ${fmt(bestAtStart)}`, sp.x + 2, sp.y + 30 * k, { size: Math.round(12 * k), align: "left", fill: PAL.banana, shadow: 2, rot: -0.04 });

    // The bag: marbles in the stream, and the row the pile is on.
    const rx = W - session.play().right - 16;
    const bag = sim.marbles;
    sticker(g, `×${bag}`, rx, top + 28 * k, { size: Math.round(26 * k), align: "right", fill: PAL.white, shadow: 3, sx: marblePop.v, sy: marblePop.v });
    const tw = `×${bag}`.length * 17 * k;
    drawSprite(g, a.marbles[0]!, rx - tw - 16 * k, top + 28 * k, 0, 1.5 * k * marblePop.v, 1.5 * k * marblePop.v);
    sticker(g, `ROW ${sim.turn}`, rx, top + 56 * k, { size: Math.round(12 * k), align: "right", fill: PAL.cream, shadow: 2 });

    // The streak: volleys in a row that smashed something, and the multiplier they've earned.
    const m = sim.mult;
    const cx = W / 2 + 14 * k;
    if (sim.streak > 0) {
      const next = STREAK_TIERS[m - 1] ?? null;
      const fill = m >= 4 ? PAL.tomato : m >= 2 ? PAL.banana : PAL.white;
      sticker(g, `×${m}`, cx, top + 30 * k, { size: Math.round((m >= 2 ? 26 : 20) * k), fill, shadow: 3, sx: multPop.v, sy: multPop.v, rot: -0.06 });
      const pips = next ?? STREAK_TIERS[STREAK_TIERS.length - 1]!;
      const from = m >= 2 ? STREAK_TIERS[m - 2]! : 0;
      const n = Math.min(5, pips - from);
      const have = next === null ? n : Math.min(n, Math.round(((sim.streak - from) / (pips - from)) * n));
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.arc(cx + (i - (n - 1) / 2) * 11 * k, top + 54 * k, 3.6 * k, 0, Math.PI * 2);
        g.fillStyle = i < have ? fill : "rgba(22,18,28,0.35)";
        g.fill();
        g.lineWidth = 1.6;
        g.strokeStyle = PAL.ink;
        g.stroke();
      }
    }

    // Under the mat: fast-forward, the nudge and the first-run hint.
    const by = Math.min(H - 20, sy(MAT_H) + FRAME * S + 30);
    if (sim.scale > 1 || fastT > 0) sticker(g, sim.scale > 2 ? "▶▶▶ FASTER!" : "▶▶ FAST FORWARD", W / 2, by, { size: 15, fill: PAL.banana, shadow: 2, rot: -0.03, alpha: clamp(fastT * 3 + (sim.scale > 1 ? 1 : 0)) });
    else if (nudgeT > 0) sticker(g, "DRAG TO AIM, LET GO TO FIRE!", W / 2, by, { size: 15, fill: PAL.banana, shadow: 2, rot: -0.03, alpha: clamp(nudgeT * 3) });
    else if (!hintSeen && sim.phase === "aim" && !aim?.mode && session.phase === "playing") drawHint(a, by);
    else if (aim?.mode && canGuide() && session.phase === "playing") sticker(g, "LET GO!", W / 2, by, { size: 15, fill: PAL.white, shadow: 2, rot: -0.03, alpha: 0.9 });
    else if (sim.creepFrac > 0.6 && session.phase === "playing") sticker(g, "HURRY UP!", W / 2, by, { size: 17, fill: PAL.tomato, shadow: 2.5, rot: -0.04 + (reduced ? 0 : Math.sin(time * 9) * 0.04) });
    if (session.phase === "over") drawSummary();
  }

  /** First run: a glove drags back from the cannon and the dots show where the bag will go. */
  function drawHint(a: Art, by: number) {
    const ph = (time * 0.55) % 1;
    const pull = ph < 0.6 ? easeOutCubic(ph / 0.6) : 1;
    const fade = ph > 0.85 ? 1 - (ph - 0.85) / 0.15 : Math.min(1, ph * 6);
    const d = clampAim(0.42, -1);
    g.save();
    g.translate(fx, fy);
    g.scale(S, S);
    drawGuide(d, 0.9 * fade * pull);
    g.restore();
    const x0 = sx(cannonX);
    const y0 = sy(FLOOR) + 26;
    drawSprite(g, a.glove, x0 - d[0] * 60 * pull, y0 + 60 * pull * -d[1] * 0.9, -0.2, 1, 1);
    sticker(g, "DRAG BACK, AIM, LET GO!", W / 2, Math.max(by, y0 + 40), { size: 16, fill: PAL.banana, shadow: 2.5, rot: -0.03 });
  }

  /**
   * What the run achieved, how it compares with the best, and one tip. In the feed the shell's result card covers
   * the middle and the caption the bottom, so this is a compact strip just above the caption.
   */
  function drawSummary() {
    const sm = summary;
    if (!sm || session.phaseTime < 0.35) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 16 : pv.left + 12;
    const right = W - (solo ? 16 : pv.right + 6);
    const w = right - left;
    const ph = 112;
    const topY = solo ? Math.round(H * 0.5) : H - pv.bottom - ph - 6;
    const k = easeOutBack(clamp((session.phaseTime - 0.35) / 0.4), 1.5);
    g.save();
    g.translate(left + w / 2, topY + ph / 2);
    g.scale(k, k);
    g.rotate(-0.012);
    roundRectPath(g, -w / 2, -ph / 2, w, ph, 16);
    inkFill(g, PAL.cream, 4, 5);
    const x0 = -w / 2 + 14;
    const s = sim.stats;
    sticker(g, `ROW ${sim.turn} · ${s.smashes} SMASHED`, x0, -ph / 2 + 20, { size: 14, align: "left", fill: PAL.banana, shadow: 2 });
    sticker(g, `CHAIN ×${s.maxChain}`, w / 2 - 14, -ph / 2 + 20, { size: 14, align: "right", fill: PAL.bubblegumHi, shadow: 2 });
    const y0 = -ph / 2 + 40;
    const bw = w - 28;
    roundRectPath(g, x0, y0, bw, 22, 11);
    inkFill(g, PAL.white, 3, 0);
    const prev = sm.prevBest;
    const frac = sm.isBest || !prev ? 1 : clamp(sm.score / prev);
    const grow = Math.min(1, (session.phaseTime - 0.35) / 0.8);
    if (frac > 0.02 && sm.score > 0) {
      roundRectPath(g, x0 + 3, y0 + 3, Math.max(16, (bw - 6) * frac * grow), 16, 8);
      g.fillStyle = sm.isBest ? PAL.lime : C.sky;
      g.fill();
    }
    const label = sm.score <= 0 ? "NOTHING SMASHED. YET!" : sm.isBest ? (prev ? `NEW BEST! +${fmt(sm.score - prev)}` : "FIRST SCORE ON THE BOARD!") : `${Math.round(frac * 100)}% OF YOUR BEST`;
    sticker(g, label, 0, y0 + 11, { size: 13, fill: PAL.white, shadow: 1.5 });
    g.fillStyle = PAL.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const tip = `TIP: ${sm.tip}`;
    let size = 12;
    g.font = font(size);
    while (size > 8 && g.measureText(tip).width > bw) g.font = font(--size);
    g.fillText(tip, x0, ph / 2 - 24);
    g.restore();
    if (solo && session.phaseTime > 0.8) {
      sticker(g, fmt(sm.score), W / 2, topY - 70, { size: 52, fill: PAL.banana, cut: 5, shadow: 5, rot: -0.05, sx: scorePop.v, sy: scorePop.v });
      burstSticker(g, "TAP TO RATTLE AGAIN!", W / 2, topY + ph + 54, { size: 18, fill: PAL.tomato, rx: 168, ry: 34, seed: 31, rot: -0.04 + (reduced ? 0 : Math.sin(time * 5) * 0.05) });
    }
  }

  function drawAttract() {
    const ins = session.preview();
    const left = ins.left + 12;
    const right = W - ins.right - 12;
    const topY = ins.top + 6;
    const bottomY = H - ins.bottom - 10;
    const aw = right - left;
    const cxx = left + aw / 2;
    const k = titleK();
    const titleIn = clamp(time * 1.6);
    const pop = titleIn < 1 ? 0.4 + 0.6 * easeOutCubic(titleIn) + Math.sin(titleIn * 9) * 0.08 * (1 - titleIn) : 1;
    const amp = reduced ? 2 : 8;
    const letter = (i: number, fill: string) => {
      const ph = (((time * (reduced ? 0.5 : 1.3) - i * 0.08) % 1) + 1) % 1;
      const hop = 4 * ph * (1 - ph);
      return { dx: 0, dy: -hop * amp, rot: Math.sin(time * 2 + i) * 0.05, sx: 1, sy: 1, fill };
    };
    g.save();
    g.translate(cxx, topY + 40 * k);
    g.scale(pop * k * titlePop.v, pop * k * titlePop.v);
    stickerWord(g, "RATTLE", -14, 0, { size: 50, rot: -0.06, cut: 6, shadow: 6 }, (i) => letter(i, i % 2 ? PAL.white : PAL.cream));
    stickerWord(g, "PILE!", 34, 54, { size: 54, rot: 0.05, cut: 6, shadow: 7 }, (i) => letter(i + 6, i % 2 ? PAL.banana : PAL.bananaHi));
    g.restore();
    if (session.best !== null && session.best > 0) sticker(g, `BEST ${fmt(session.best)}`, left + 58 * k, topY + 112 * k, { size: 15 * Math.max(0.85, k), rot: -0.08, fill: PAL.white, shadow: 2.5 });
    const py = bottomY - 34;
    const wob = reduced ? 0 : Math.sin(time * 5.2) * 0.07;
    const sc = 1 + (reduced ? 0 : Math.sin(time * 7.3) * 0.045);
    burstSticker(g, "TAP TO RATTLE!", cxx + 2, py, { size: 25, fill: PAL.tomato, rx: 142, ry: 40, seed: 42, rot: -0.06 + wob, scale: sc * Math.min(1, k) });
  }

  function render() {
    const a = art!;
    view.begin();
    drawBackdrop();
    const o = shake.offset;
    g.save();
    g.translate(o.x, o.y);
    if (o.angle) {
      g.translate(W / 2, H / 2);
      g.rotate(o.angle);
      g.translate(-W / 2, -H / 2);
    }
    g.translate(fx, fy);
    g.scale(S, S);
    drawMat(a);
    g.save();
    g.beginPath();
    g.rect(0, 0, FW, MAT_H);
    g.clip();
    drawBeams();
    drawPile(a);
    g.restore();
    // The guide: the demo's shot being lined up, or the player's.
    if (mode === "attract") {
      if (pilot?.target && sim.phase === "aim") drawGuide(pilot.target, clamp(pilot.progress * 3));
    } else if (session.phase === "playing" && canGuide() && !sim.over) {
      const d = aim ? aimOf(aim) : queued;
      if (d) drawGuide(d, sim.phase === "aim" ? 1 : 0.55);
    }
    puffs.draw(g);
    drawMarbles(a);
    drawCannon(a);
    drawChunks();
    bits.draw(g);
    pows.draw(g);
    g.restore();
    if (mode === "play" && session.phase === "over") {
      g.fillStyle = "rgba(22,18,28,0.22)";
      g.fillRect(0, 0, W, H);
    }
    drawHud(a);
    flash.draw(g, W, H);
  }

  newAttract();
  update(0);
  render();
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (++frames === 2) session.ready();
  });
}

void main();
