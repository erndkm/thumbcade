import { createAudio, createMusic, PENTATONIC } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeOutBack, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { C, enemySprite, eye, makeArt, POWER_FILL, powerIcon, STRIPES, type Art } from "./art.ts";
import { Bits, burstSticker, drawSprite, font, hash, inkFill, loadComicFont, makeHalftone, PAL, Pows, roundRectPath, setSpriteScale, sticker, stickerWord, Wobble } from "./comic.ts";
import { DEMO, Pilot, SKILLS } from "./pilot.ts";
import { S as SND } from "./sfx.ts";
import { COMBO_WINDOW, HEARTS, POWER_TIME, Sim, TIERS, type BossKind, type EnemyKind, type PowerKind, type SimEvent, type WaveKind } from "./sim.ts";

// ---------------------------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------------------------
/** Thumb travel → iron travel. A touch over 1:1, so a short drag crosses the sky. */
const SENS = 1.15;
/** Seconds between the last heart and gameplay.end (the iron's big exit), well inside the 1 s rule. */
const END_AFTER = 0.85;
/** Drag this far (logical px) on the first run and the hint is done for good. */
const HINT_DONE_AT = 40;
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build can't. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

const BOSS_NAMES: Record<BossKind, string> = { king: "THE LINT KING", spin: "THE SPIN CYCLE", hamper: "THE HAMPER" };
const BOSS_ANGRY: Record<BossKind, string> = { king: "GRRRR!", spin: "FULL SPIN!", hamper: "LID'S OFF!" };
const POWER_WORDS: Record<PowerKind, string> = { spread: "TRIPLE STEAM!", rapid: "TURBO PRESS!", shield: "SOFTENER SHIELD!", magnet: "STATIC CLING!" };
const POWER_SHORT: Record<PowerKind, string> = { spread: "TRIPLE", rapid: "TURBO", shield: "SHIELD", magnet: "CLING" };
const CLEAR_WORDS: Record<WaveKind, string> = { line: "LINE CLEAR!", vee: "FLUFF FREE!", drift: "DE-LINTED!", swoop: "TEE TIME!", snake: "MITTEN MASH!", tank: "SWEATER WEATHER!" };
const KILL_WORDS = ["FWUMP!", "PFFT!", "PRESSED!", "SPLAT!", "FLATTENED!", "WHUMP!"];
const TIER_WORDS = ["", "", "×2!", "×3!", "×4 HOT!", "×5 STEAMIN'!", "×6 SCORCHIN'!", "×7 RED HOT!", "×8 MAX HEAT!"];
const ENEMY_COLORS: Record<EnemyKind, readonly string[]> = {
  sock: [PAL.white, PAL.cream],
  minisock: [PAL.white, PAL.bubblegum],
  fluff: [C.fluff, C.fluffShade, PAL.white],
  tee: [PAL.lime, PAL.limeHi, PAL.banana],
  mitten: [PAL.cobalt, PAL.cobaltHi, PAL.white],
  sweater: [PAL.banana, PAL.tomato, PAL.bananaHi],
};
const BOSS_COLORS: Record<BossKind, readonly string[]> = {
  king: [C.fluff, C.fluffShade, PAL.banana, PAL.white],
  spin: ["#F6F3EC", C.steel, C.water, PAL.tomato, PAL.banana],
  hamper: [C.wicker, C.wickerShade, PAL.tomato, PAL.cobalt, PAL.lime],
};

interface Cloud {
  x: number;
  y: number;
  i: number;
  speed: number;
}
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
interface Snap {
  y: number;
  t: number;
}
interface Later {
  t: number;
  run: () => void;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "lintstorm", restartDelayMs: 900 }), loadComicFont()]);
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
  /** CSS px per logical px, and the logical field. */
  let S = 1;
  let FW = 390;
  let FH = 754;
  let art: Art | null = null;
  let halftone: HTMLCanvasElement | null = null;

  // -------------------------------------------------------------------------------------------------------------
  // Audio and juice
  // -------------------------------------------------------------------------------------------------------------
  const audio = createAudio();
  const BASS = [45, null, 57, 45, 52, null, 55, null, 43, null, 55, 43, 50, null, 53, 55, 41, null, 53, 41, 48, null, 52, null, 43, null, 55, 43, 50, 53, 55, 59];
  const BOSS_BASS = [40, 52, 40, 52, 43, 55, 43, 55, 38, 50, 38, 50, 41, 53, 44, 56];
  const music = createMusic(audio, { bpm: 138, wave: "triangle", volume: 0.045, steps: BASS });
  const shake = new Shake(12, 0.03, 1.9, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.16, decay: 0.4 });
  const steam = new Particles(420);
  const bits = new Bits(260);
  const hudBits = new Bits(140);
  const pows = new Pows(reduced);
  const hudPows = new Pows(reduced);
  const scorePop = new Wobble(300, 11);
  const multPop = new Wobble(320, 10);
  const ironPop = new Wobble(260, 9);
  const titlePop = new Wobble(200, 9);
  const heartPop = [new Wobble(300, 10), new Wobble(300, 10), new Wobble(300, 10)];

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = (session.ctx.seed >>> 0) ^ 0x2d1;
  let sim = new Sim({ seed: demoSeed, demo: true });
  let pilot: Pilot | null = new Pilot(DEMO, createRng(demoSeed ^ 99));
  let qaPilot: Pilot | null = null;
  let time = 0;
  let shown = 0;
  let overT = -1;
  let endSent = false;
  let bestCheered = false;
  let bestAtStart: number | null = null;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string } | null = null;
  let chunks: Chunk[] = [];
  let snaps: Snap[] = [];
  let later: Later[] = [];
  const clouds: Cloud[] = [];
  const speedLines: Array<{ x: number; y: number; len: number; v: number }> = [];
  let killStopAt = -1;
  let tokAt = 0;
  let zapAt = 0;
  let puffN = 0;
  let exhaustT = 0;
  let bossTint = 0;
  let spinBoost = 0;
  let bossBanner = 0;
  let bossName = "";
  let hurtT = 9;
  let blinkT = 2;
  let dragAccum = 0;
  let ghostAlpha = 0;
  let slowT = 0;
  const stripeOf = new Map<number, number>();

  // -------------------------------------------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------------------------------------------
  function fieldFor(): { w: number; h: number; top: number } {
    if (mode === "attract") {
      // The demo plays above the caption, under the title.
      const pv = session.preview();
      return { w: FW, h: Math.max(400, (H - pv.bottom - 150) / S), top: session.play().top / S };
    }
    return { w: FW, h: FH, top: session.play().top / S };
  }

  function layout() {
    W = view.width;
    H = view.height;
    D = view.dpr;
    setSpriteScale(D);
    S = Math.min(W / 390, H / 640);
    FW = W / S;
    FH = H / S;
    const k = Math.min(3, S * D * 1.05);
    if (!art || Math.abs(art.k - k) > 0.01) art = makeArt(k);
    const hd = Math.min(D, 1.5);
    halftone = makeHalftone(W * hd, H * hd, 15 * hd, PAL.white, (x, y) => clamp(0.06 + y * y * 0.55 + Math.abs(x - 0.5) * 0.22, 0, 0.8));
    const f = fieldFor();
    sim.resize(f.w, f.h, f.top);
    if (!clouds.length) {
      for (let i = 0; i < 5; i++) clouds.push({ x: hash(i, 3) * W, y: hash(i, 4) * H, i: i % 3, speed: 26 + hash(i, 5) * 40 });
      for (let i = 0; i < 7; i++) speedLines.push({ x: hash(i, 8) * W, y: hash(i, 9) * H, len: 30 + hash(i, 10) * 50, v: 520 + hash(i, 11) * 380 });
    }
  }
  layout();
  view.onResize(layout);
  session.on("insets", layout);

  const wx = (x: number) => x * S;
  const wy = (y: number) => y * S;

  // -------------------------------------------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------------------------------------------
  function resetFx() {
    steam.clear();
    bits.clear();
    hudBits.clear();
    pows.clear();
    hudPows.clear();
    chunks = [];
    snaps = [];
    later = [];
    stripeOf.clear();
    bossTint = 0;
    bossBanner = 0;
    hurtT = 9;
    slowT = 0;
    killStopAt = -1;
  }

  function newAttract() {
    mode = "attract";
    demoSeed = (demoSeed * 1664525 + 1013904223) >>> 0;
    sim = new Sim({ seed: demoSeed, demo: true });
    const f = fieldFor();
    sim.resize(f.w, f.h, f.top);
    pilot = new Pilot(DEMO, createRng(demoSeed ^ 99));
    resetFx();
  }

  function startRun() {
    mode = "play";
    const seed = ((session.ctx.seed >>> 0) ^ Math.imul(session.runs + 1, 0x9e3779b1)) >>> 0;
    sim = new Sim({ seed });
    const f = fieldFor();
    sim.resize(f.w, f.h, f.top);
    sim.hero.y = f.h * 0.8;
    pilot = null;
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(7)) : null;
    resetFx();
    shown = 0;
    overT = -1;
    endSent = false;
    bestCheered = false;
    bestAtStart = session.best;
    summary = null;
    dragAccum = 0;
    ghostAlpha = 0;
    ironPop.kick(6);
    music.setSteps(BASS);
    music.start();
    audio.play(SND.hiss, { volume: 0.8 });
    audio.play(SND.whistleUp, { volume: 0.5, pitch: 2 });
    hudPows.burst("PRESS ON!", W / 2, H * 0.42, { size: 30, fill: PAL.tomato, life: 0.9 });
  }

  session.startOnTap(window);
  session.on("start", startRun);

  // -------------------------------------------------------------------------------------------------------------
  // Input: drag anywhere, the iron moves with the thumb (relative, so the thumb never covers it)
  // -------------------------------------------------------------------------------------------------------------
  let finger: { id: number; x: number; y: number } | null = null;
  const playing = () => mode === "play" && session.phase === "playing" && !session.paused;
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (finger) return;
    finger = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointermove", (e) => {
    if (!finger || e.pointerId !== finger.id) return;
    const dx = e.clientX - finger.x;
    const dy = e.clientY - finger.y;
    finger.x = e.clientX;
    finger.y = e.clientY;
    if (!playing() || !sim.hero.alive) return;
    const mx = (dx / S) * SENS;
    const my = (dy / S) * SENS;
    sim.moveBy(mx, my);
    dragAccum += Math.hypot(mx, my);
    if (!hintSeen && dragAccum > HINT_DONE_AT) {
      hintSeen = true;
      tc.storage.set("hint", true).catch(() => undefined);
    }
  });
  const lift = (e: PointerEvent) => {
    if (finger && e.pointerId === finger.id) finger = null;
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  session.on("cancel", () => (finger = null));
  // Arrow keys for the simulator on a desktop.
  const keys = new Set<string>();
  window.addEventListener("keydown", (e) => {
    if (e.code.startsWith("Arrow")) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  session.on("pause", () => {
    music.stop();
    finger = null;
    keys.clear();
  });
  session.on("resume", () => {
    if (mode === "play" && session.phase === "playing") music.start();
  });

  // -------------------------------------------------------------------------------------------------------------
  // Juice helpers
  // -------------------------------------------------------------------------------------------------------------
  const loud = () => mode === "play";
  const vol = () => (mode === "play" ? 1 : 0.35);

  function emitChunks(x: number, y: number, colors: readonly string[], n: number, speed: number, size: [number, number]) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
      const sp = speed * (0.45 + Math.random() * 0.7);
      chunks.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 30,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        size: size[0] + Math.random() * (size[1] - size[0]),
        color: colors[i % colors.length]!,
        life: 0,
        max: 0.9 + Math.random() * 0.7,
        seed: Math.floor(Math.random() * 1000),
      });
    }
    if (chunks.length > 90) chunks.splice(0, chunks.length - 90);
  }

  function popText(text: string, x: number, y: number, mult: number) {
    pows.float(text, x, y, { size: Math.min(34, 15 + (mult - 1) * 3.2), textFill: mult >= 5 ? PAL.banana : mult >= 3 ? PAL.bananaHi : PAL.white, life: 0.75 });
  }

  function cheerBest() {
    bestCheered = true;
    hudPows.burst("NEW BEST!", W / 2, H * 0.3, { size: 34, fill: PAL.banana, life: 1.4 });
    audio.play(SND.fanfare);
    audio.play(SND.whistleUp, { pitch: 4 });
    flash.trigger(PAL.banana, 0.6);
    session.feedback("success");
    for (const side of [-1, 1])
      hudBits.emit(W / 2 + side * W * 0.44, H * 0.6, { count: 26, speed: [320, 640], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.6], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.banana], shape: "confetti", gravity: 700, drag: 1.2 });
  }

  function handle(e: SimEvent) {
    switch (e.k) {
      case "fire": {
        const x = wx(e.x);
        const y = wy(e.y);
        steam.emit(x, y + 4, { count: 1, speed: [10, 40], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.12, 0.2], size: [6, 10], colors: [PAL.white], shape: "circle", endScale: 1.6 });
        if (loud() && ++puffN % 3 === 0) audio.play(SND.puff, { pitch: (puffN % 4) - 1 });
        break;
      }
      case "hit": {
        bits.emit(wx(e.x), wy(e.y), { count: 2, speed: [80, 180], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.15, 0.3], size: [4, 6], colors: [PAL.white, PAL.banana], shape: "dot" });
        if (loud() && time - tokAt > 0.05) {
          tokAt = time;
          audio.play(SND.tok, { pitch: Math.random() * 4 });
        }
        break;
      }
      case "kill": {
        const x = wx(e.x);
        const y = wy(e.y);
        const big = e.kind === "sweater";
        const colors = ENEMY_COLORS[e.kind];
        bits.emit(x, y, { count: big ? 22 : 10, speed: [140, big ? 460 : 320], life: [0.35, 0.7], size: [6, big ? 13 : 10], colors, shape: "confetti", gravity: 520, drag: 1.4 });
        steam.emit(x, y, { count: big ? 10 : 5, speed: [30, 120], life: [0.25, 0.45], size: [10, big ? 26 : 16], colors: [PAL.white], shape: "circle", endScale: 1.4 });
        popText(`+${e.pts}`, x, Math.max(hudBottom() - 20, y - 12), e.mult);
        if (big) {
          emitChunks(x, y, colors, 7, 380, [7, 13]);
          pows.burst(KILL_WORDS[Math.floor(Math.random() * KILL_WORDS.length)]!, clamp(x, 80, W - 80), Math.max(hudBottom(), y - 30), { size: 24, fill: PAL.banana, life: 0.6 });
          shake.add(0.28);
          hitStop.freeze(0.07);
        } else {
          shake.add(0.07);
          if (e.combo % 9 === 0 && e.mult >= 2) pows.burst(KILL_WORDS[e.combo % KILL_WORDS.length]!, clamp(x, 60, W - 60), Math.max(hudBottom(), y - 22), { size: 16, fill: PAL.bubblegum, life: 0.45 });
          if (time - killStopAt > 0.18) {
            killStopAt = time;
            hitStop.freeze(0.03);
          }
        }
        audio.play(SND.fwump, { volume: vol() * (big ? 1 : 0.7), pitch: big ? -3 : Math.random() * 3 });
        if (loud()) audio.play(SND.crack, { volume: big ? 1 : 0.5, pitch: Math.min(10, e.mult * 1.5) });
        if (big && loud()) session.feedback("impact");
        break;
      }
      case "clear": {
        const x = wx(e.x);
        const y = wy(e.y);
        pows.burst(CLEAR_WORDS[e.kind], clamp(x, 100, W - 100), clamp(y + 40, hudBottom() + 20, H * 0.6), { size: 22, fill: PAL.lime, life: 0.85 });
        popText(`+${e.bonus}`, clamp(x, 60, W - 60), y + 10, 4);
        audio.play(SND.chaChing, { volume: vol() });
        shake.add(0.16);
        if (e.kind === "line") snaps.push({ y: e.y - 30, t: 0 });
        break;
      }
      case "pickup": {
        const x = wx(e.x);
        const y = wy(e.y);
        bits.emit(x, y, { count: e.kind === "button" ? 6 : 3, speed: [60, 160], life: [0.2, 0.4], size: [4, 7], colors: e.kind === "button" ? [PAL.bubblegum, PAL.white] : [PAL.banana, PAL.white], shape: e.kind === "button" ? "star" : "dot" });
        scorePop.kick(e.kind === "button" ? 1.6 : 0.7);
        if (e.kind === "button") popText(`+${e.pts}`, x, y - 10, e.mult);
        const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.floor(e.combo / 3) % PENTATONIC.length)]!;
        audio.play(e.kind === "coin" ? SND.coin : SND.plink, { volume: vol(), pitch: step });
        break;
      }
      case "power": {
        const x = wx(e.x);
        const y = wy(e.y);
        hudPows.burst(POWER_WORDS[e.kind], clamp(x, 120, W - 120), clamp(y - 80, hudBottom() + 40, H * 0.7), { size: 20, fill: POWER_FILL[e.kind], textFill: PAL.white, life: 1.0 });
        bits.emit(x, y, { count: 18, speed: [160, 420], life: [0.4, 0.8], size: [7, 12], colors: [POWER_FILL[e.kind], PAL.white, PAL.banana], shape: "star", drag: 2 });
        ironPop.kick(9);
        shake.add(0.22);
        hitStop.freeze(0.06);
        audio.play(SND.fanfare, { volume: vol() });
        audio.play(SND.whistleUp, { volume: vol() * 0.7, pitch: e.refresh ? 5 : 0 });
        if (loud()) session.feedback("tap");
        break;
      }
      case "powerEnd":
        if (loud() && sim.hero.alive) {
          popText(`${POWER_SHORT[e.kind]} OFF`, wx(sim.hero.x), wy(sim.hero.y) - 40, 1);
          audio.play(SND.whistleDown, { volume: 0.35, pitch: 6 });
        }
        break;
      case "heart":
        hudPows.burst("+1 HEART!", clamp(wx(e.x), 100, W - 100), clamp(wy(e.y) - 60, H * 0.25, H * 0.7), { size: 22, fill: PAL.bubblegum, life: 0.9 });
        heartPop[clamp(e.hearts - 1, 0, 2)]!.kick(8);
        audio.play(SND.ding, { volume: vol() });
        break;
      case "tier": {
        multPop.kick(8);
        const word = TIER_WORDS[Math.min(TIER_WORDS.length - 1, e.mult)]!;
        hudPows.burst(word, W / 2, session.play().top + 150 * u(), { size: Math.min(26, 16 + e.mult * 1.4), fill: e.mult >= 5 ? PAL.tomato : PAL.banana, life: 0.8 });
        audio.play(SND.tier, { volume: vol(), pitch: (e.mult - 2) * 2 });
        if (e.mult >= 4) spinBoost = 1;
        if (loud() && e.mult >= 4) session.feedback("tap");
        break;
      }
      case "drop":
        if (loud() && e.mult >= 3) {
          popText(`COMBO ×${e.mult} COOLED`, multPos().x + 80, multPos().y + 30, 1);
          audio.play(SND.boop, { volume: 0.6 });
        }
        break;
      case "hurt": {
        const x = wx(e.x);
        const y = wy(e.y);
        hurtT = 0;
        pows.burst("OUCH!", clamp(x, 70, W - 70), y - 46, { size: 26, fill: PAL.tomato, life: 0.7 });
        bits.emit(x, y, { count: 16, speed: [160, 380], life: [0.4, 0.8], size: [6, 11], colors: [PAL.tomato, PAL.white, C.steel], shape: "star", gravity: 500 });
        shake.add(0.55);
        hitStop.freeze(0.14);
        ironPop.kick(-8);
        heartPop[clamp(e.hearts, 0, 2)]!.kick(10);
        hudBits.emit(heartX(e.hearts), heartY(), { count: 10, speed: [120, 260], life: [0.4, 0.7], size: [6, 10], colors: [PAL.tomato, PAL.white], shape: "confetti", gravity: 600 });
        audio.play(SND.boing, { volume: vol() });
        audio.play(SND.thud, { volume: vol() });
        if (loud()) {
          audio.play(SND.buzz);
          session.feedback("impact");
          flash.trigger(PAL.tomato, 0.5);
          if (e.lost >= 10) hudPows.float(`COMBO ${e.lost} LOST`, multPos().x + 90 * u(), multPos().y + 34 * u(), { size: 14, textFill: PAL.white, life: 0.9 });
        }
        break;
      }
      case "shield": {
        const x = wx(e.x);
        const y = wy(e.y);
        pows.burst("BLOCKED!", clamp(x, 80, W - 80), y - 48, { size: 22, fill: PAL.cobalt, life: 0.6 });
        steam.emit(x, y, { count: 14, speed: [120, 260], life: [0.25, 0.45], size: [6, 12], colors: [PAL.white, PAL.cobaltHi], shape: "ring" });
        shake.add(0.3);
        hitStop.freeze(0.08);
        audio.play(SND.bubble, { volume: vol() });
        audio.play(SND.pop, { volume: vol(), pitch: -5 });
        if (loud()) session.feedback("impact");
        break;
      }
      case "spark":
        if (loud() && time - zapAt > 0.12) {
          zapAt = time;
          audio.play(SND.zap, { pitch: Math.random() * 3 });
        }
        break;
      case "wave":
        break;
      case "bossIn":
        bossName = BOSS_NAMES[e.kind];
        bossBanner = 0.001;
        hudPows.burst("UH-OH!", W / 2, H * 0.36, { size: 30, fill: PAL.tomato, life: 0.9 });
        audio.play(SND.kazoo, { volume: vol() });
        later.push({ t: 0.32, run: () => audio.play(SND.kazooHi, { volume: vol() }) });
        shake.add(0.2);
        if (mode === "play") music.setSteps(BOSS_BASS);
        break;
      case "bossAngry": {
        const b = sim.boss;
        if (b) pows.burst(BOSS_ANGRY[e.kind], clamp(wx(b.x), 90, W - 90), wy(b.y) + 70, { size: 22, fill: PAL.tomato, life: 0.8 });
        audio.play(SND.kazooHi, { volume: vol(), pitch: 3 });
        shake.add(0.2);
        break;
      }
      case "bossHit":
        bits.emit(wx(e.x), wy(e.y), { count: 2, speed: [80, 200], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.15, 0.3], size: [4, 7], colors: BOSS_COLORS[sim.boss?.kind ?? "king"], shape: "dot" });
        if (loud() && time - tokAt > 0.06) {
          tokAt = time;
          audio.play(SND.tok, { pitch: -3 + Math.random() * 3 });
        }
        break;
      case "bossBreak": {
        const x = wx(e.x);
        const y = wy(e.y);
        const colors = BOSS_COLORS[e.kind];
        hitStop.freeze(0.3);
        shake.add(0.9);
        emitChunks(x, y, colors, 26, 620, [10, 22]);
        bits.emit(x, y, { count: 40, speed: [200, 620], life: [0.6, 1.2], size: [8, 14], colors, shape: "confetti", gravity: 520, drag: 1.1 });
        steam.emit(x, y, { count: 22, speed: [60, 260], life: [0.4, 0.8], size: [16, 36], colors: [PAL.white], shape: "circle", endScale: 1.5 });
        const words = ["KA-", "POW!", "WRINKLE", "FREE!"];
        // Staggered bursts spread around the wreck (never on top of each other, so no one spot strobes).
        [[-60, -40], [60, -10], [-30, 40]].forEach(([dx, dy], i) =>
          later.push({ t: 0.12 + i * 0.16, run: () => pows.burst(i === 0 ? "KA-POW!" : i === 1 ? "BLAM!" : "SPLOOSH!", clamp(x + dx!, 80, W - 80), y + dy!, { size: 22, fill: i === 1 ? PAL.tomato : PAL.banana, life: 0.6 }) }),
        );
        later.push({ t: 0.5, run: () => hudPows.burst(`${words[2]} ${words[3]}`, W / 2, H * 0.42, { size: 30, fill: PAL.lime, life: 1.2 }) });
        popText(`+${e.pts}`, clamp(x, 80, W - 80), y + 60, 6);
        flash.trigger(PAL.banana, 0.6);
        audio.play(SND.boom, { volume: vol() });
        audio.play(SND.sploosh, { volume: vol() });
        later.push({ t: 0.25, run: () => audio.play(SND.fanfare, { volume: vol() }) });
        later.push({ t: 0.45, run: () => audio.play(SND.chaChing, { volume: vol() }) });
        if (loud()) session.feedback("success");
        bossBanner = 0;
        if (mode === "play") music.setSteps(BASS);
        break;
      }
      case "bossLeave": {
        const b = sim.boss;
        if (b) pows.burst("BORED NOW!", clamp(wx(b.x), 90, W - 90), wy(b.y) + 60, { size: 20, fill: PAL.cobalt, life: 0.8 });
        audio.play(SND.whistleDown, { volume: vol() });
        bossBanner = 0;
        if (mode === "play") music.setSteps(BASS);
        break;
      }
      case "over": {
        const x = wx(e.x);
        const y = wy(e.y);
        overT = 0;
        slowT = 0.7;
        hitStop.freeze(0.2);
        shake.add(0.9);
        emitChunks(x, y, [PAL.tomato, C.steel, PAL.cream, PAL.tomatoShade], 16, 520, [8, 15]);
        steam.emit(x, y, { count: 24, speed: [60, 300], life: [0.5, 1], size: [14, 32], colors: [PAL.white], shape: "circle", endScale: 1.6 });
        hudPows.burst("UNPLUGGED!", W / 2, H * 0.4, { size: 32, fill: PAL.tomato, life: 1.3 });
        audio.play(SND.whistleDown);
        audio.play(SND.boom, { volume: 0.8 });
        music.stop();
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD positions
  // -------------------------------------------------------------------------------------------------------------
  const u = () => clamp(S, 0.85, 1.4);
  const scorePos = () => ({ x: session.play().left + 18, y: session.play().top + 30 * u() });
  const multPos = () => ({ x: session.play().left + 18, y: session.play().top + 74 * u() });
  const heartX = (i: number) => W - session.play().right - 26 - (HEARTS - 1 - i) * 32 * u();
  const heartY = () => session.play().top + 28 * u();
  /** Below the two HUD rows: call-outs never land on the score. */
  const hudBottom = () => session.play().top + 110 * u();

  function tipFor(): string {
    const s = sim.stats;
    if (s.travelled < 60) return "DRAG ANYWHERE: THE IRON FOLLOWS YOUR THUMB!";
    if (s.powerups === 0) return "GRAB THE STICKERS: THEY'RE POWER-UPS!";
    if (s.travelled < sim.t * 45) return "KEEP SLIDING: SPARKS AIM AT YOU!";
    if (s.hurt.body > s.hurt.spark) return "TEES DIVE AT YOU: SIDESTEP LATE!";
    if (s.maxMult < 3) return "SCOOP THE COINS TO KEEP THE COMBO!";
    if (s.bosses === 0 && sim.bossCount > 0) return "PARK UNDER THE BOSS, DODGE SIDEWAYS!";
    return "SWEEP WIDE AND SCOOP EVERYTHING!";
  }

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    let dt = hitStop.scale(rawDt);
    if (slowT > 0) {
      slowT = Math.max(0, slowT - rawDt);
      dt *= reduced ? 0.6 : 0.35;
    }
    shake.update(rawDt);
    flash.update(rawDt);
    steam.update(rawDt);
    bits.update(rawDt);
    hudBits.update(rawDt);
    pows.update(rawDt);
    hudPows.update(rawDt);
    scorePop.update(rawDt);
    multPop.update(rawDt);
    ironPop.update(rawDt);
    titlePop.update(rawDt);
    for (const h of heartPop) h.update(rawDt);
    hurtT += rawDt;
    spinBoost = Math.max(0, spinBoost - rawDt * 0.5);
    blinkT -= rawDt;
    if (blinkT < -0.12) blinkT = 1.5 + Math.random() * 2.5;
    for (const l of later) l.t -= rawDt;
    if (later.some((l) => l.t <= 0)) {
      const due = later.filter((l) => l.t <= 0);
      later = later.filter((l) => l.t > 0);
      for (const l of due) l.run();
    }
    // Chunks fall with gravity.
    for (const c of chunks) {
      c.life += rawDt;
      c.vy += 900 * rawDt;
      c.x += c.vx * rawDt;
      c.y += c.vy * rawDt;
      c.rot += c.vr * rawDt;
    }
    if (chunks.some((c) => c.life > c.max)) chunks = chunks.filter((c) => c.life <= c.max);
    for (const sn of snaps) sn.t += rawDt;
    if (snaps.some((s) => s.t > 0.8)) snaps = snaps.filter((s) => s.t <= 0.8);

    // The sky scrolls past (the iron flies up).
    const scroll = sim.boss ? 0.5 : 1;
    for (const c of clouds) {
      c.y += c.speed * scroll * rawDt * (reduced ? 0.5 : 1);
      if (c.y > H + 60) {
        c.y = -60 - Math.random() * 80;
        c.x = Math.random() * W;
      }
    }
    for (const l of speedLines) {
      l.y += l.v * scroll * rawDt * (reduced ? 0.4 : 1);
      if (l.y > H + l.len) {
        l.y = -l.len - Math.random() * H * 0.5;
        l.x = Math.random() * W;
      }
    }
    bossTint = damp(bossTint, sim.boss && sim.boss.phase !== "leave" ? 1 : 0, 1.6, rawDt);
    if (bossBanner > 0) bossBanner += rawDt;

    if (dt > 0) {
      if (mode === "attract" && pilot) {
        const [dx, dy] = pilot.step(sim, dt);
        sim.moveBy(dx, dy);
      } else if (playing() && sim.hero.alive) {
        if (qaPilot) {
          const [dx, dy] = qaPilot.step(sim, dt);
          sim.moveBy(dx, dy);
          dragAccum += Math.hypot(dx, dy);
        }
        if (keys.size) {
          const v = 420 * dt;
          sim.moveBy((keys.has("ArrowRight") ? v : 0) - (keys.has("ArrowLeft") ? v : 0), (keys.has("ArrowDown") ? v : 0) - (keys.has("ArrowUp") ? v : 0));
          dragAccum += v;
        }
      }
      sim.step(dt);
      for (const e of sim.events) handle(e);
      sim.events.length = 0;
      if (mode === "attract" && sim.t > 52 && !sim.boss) newAttract();
    }

    // Exhaust: steam puffs off the back of the iron.
    const hero = sim.hero;
    exhaustT -= rawDt;
    if (hero.alive && exhaustT <= 0) {
      exhaustT = hero.power.rapid > 0 ? 0.03 : 0.05;
      const side = Math.random() < 0.5 ? -1 : 1;
      steam.emit(wx(hero.x) + side * 16 * S, wy(hero.y) + 24 * S, {
        count: 1,
        speed: [60, 130],
        angle: side < 0 ? [Math.PI * 0.55, Math.PI * 0.75] : [Math.PI * 0.25, Math.PI * 0.45],
        life: [0.25, 0.45],
        size: [7, 13],
        colors: hero.power.rapid > 0 ? [PAL.banana, PAL.white] : [PAL.white],
        shape: "circle",
        endScale: 1.8,
      });
    }

    // The counter rolls up to the score.
    const target = sim.score;
    shown = shown < target ? Math.min(target, damp(shown, target, 9, rawDt) + 1) : target;
    if (mode === "play" && !bestCheered && bestAtStart !== null && bestAtStart > 0 && shown > bestAtStart && session.phase === "playing") cheerBest();

    // The first-run ghost.
    const wantGhost = mode === "play" && session.phase === "playing" && !hintSeen && hero.alive && dragAccum < HINT_DONE_AT;
    ghostAlpha = clamp(ghostAlpha + (wantGhost ? rawDt * 2.5 : -rawDt * 3), 0, 0.9);

    if (mode === "play" && overT >= 0 && !endSent) {
      overT += rawDt;
      if (overT >= END_AFTER) {
        endSent = true;
        const prevBest = session.best;
        const s = sim.stats;
        const res = session.end(sim.score, {
          stats: { kills: s.kills, bosses: s.bosses, maxMult: s.maxMult, maxCombo: s.maxCombo, coins: s.coins, powerups: s.powerups },
        });
        summary = { score: sim.score, isBest: res.isBest, prevBest, tip: tipFor() };
        if (res.isBest && prevBest !== null && !bestCheered) hudPows.burst("NEW BEST!", W / 2, H * 0.3, { size: 36, fill: PAL.banana, life: 1.6 });
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------------------------
  function drawBackdrop() {
    const t = bossTint;
    g.fillStyle = t > 0.5 ? C.skyBoss : C.sky;
    g.fillRect(0, 0, W, H);
    const cxs = W * 0.5;
    const cys = H * 0.34;
    const rad = Math.hypot(W, H);
    const rot = reduced ? 0.12 : time * (0.06 + spinBoost * 0.25);
    const rays = 16;
    g.fillStyle = t > 0.5 ? C.skyBossRay : C.skyRay;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a0 = rot + (i / rays) * Math.PI * 2;
      const a1 = rot + ((i + 0.5) / rays) * Math.PI * 2;
      g.moveTo(cxs, cys);
      g.lineTo(cxs + Math.cos(a0) * rad, cys + Math.sin(a0) * rad);
      g.lineTo(cxs + Math.cos(a1) * rad, cys + Math.sin(a1) * rad);
      g.closePath();
    }
    g.fill();
    if (halftone) {
      g.globalAlpha = 0.28;
      g.drawImage(halftone, 0, 0, W, H);
      g.globalAlpha = 1;
    }
    // Speed lines and clouds drifting down past the iron.
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.beginPath();
    for (const l of speedLines) {
      g.moveTo(l.x, l.y);
      g.lineTo(l.x, l.y - l.len);
    }
    g.stroke();
    if (art) for (const c of clouds) drawSprite(g, art.clouds[c.i]!, c.x, c.y, 0, S, S);
  }

  function ropeY(gr: { y: number; sway: number; x0: number; x1: number }, x: number): number {
    const slot = clamp((x - gr.sway - gr.x0) / (gr.x1 - gr.x0), 0, 1);
    return gr.y + Math.sin(slot * Math.PI) * 26;
  }

  function drawRopes() {
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const gr of sim.groups) {
      if (gr.kind !== "line" || gr.rope === "snap") continue;
      if (sim.members(gr) === 0) continue;
      g.beginPath();
      for (let x = -10; x <= sim.w + 10; x += 12) {
        const y = ropeY(gr, x);
        if (x === -10) g.moveTo(wx(x), wy(y));
        else g.lineTo(wx(x), wy(y));
      }
      g.lineWidth = 5 * S;
      g.strokeStyle = PAL.ink;
      g.stroke();
      g.lineWidth = 2.2 * S;
      g.strokeStyle = C.rope;
      g.stroke();
    }
  }

  function drawPickups(a: Art) {
    for (const p of sim.pickups) {
      const x = wx(p.x);
      const y = wy(p.y);
      const pop = p.t < 0.15 ? 0.5 + (p.t / 0.15) * 0.5 : 1;
      switch (p.kind) {
        case "coin": {
          const sx = Math.max(0.25, Math.abs(Math.cos(p.t * 7 + p.id)));
          drawSprite(g, a.coin, x, y, 0, sx * pop * S, pop * S);
          break;
        }
        case "button":
          drawSprite(g, a.buttons[p.id % a.buttons.length]!, x, y, p.t * 3, pop * S, pop * S);
          break;
        case "heart": {
          const k = (1 + 0.12 * light.pulse(time, 1.6)) * pop * S;
          drawSprite(g, a.heart, x, y, Math.sin(p.t * 3) * 0.15, k * 1.2, k * 1.2);
          break;
        }
        default: {
          const k = (1 + 0.1 * light.pulse(time + p.id, 1.8)) * pop * S;
          drawSprite(g, a.power[p.kind], x, y, Math.sin(p.t * 2.4) * 0.18, k, k);
        }
      }
    }
  }

  function drawEnemies(a: Art) {
    for (const e of sim.enemies) {
      if (e.y < -70) continue;
      const hit = e.hitT < 0.08;
      const stripe = stripeFor(e.group);
      const spr = enemySprite(a, e.kind, stripe, hit, e.t);
      const wob = 1 + 0.16 * Math.exp(-e.hitT * 12) * Math.cos(e.hitT * 40);
      let rot = 0;
      let x = wx(e.x);
      let y = wy(e.y);
      switch (e.kind) {
        case "sock":
          rot = Math.sin(e.t * 2.1 + e.id) * 0.12;
          y = wy(e.y - 24);
          break;
        case "minisock":
          rot = e.t * 6 * (e.vx > 0 ? 1 : -1);
          break;
        case "fluff":
          rot = Math.sin(e.t * 3 + e.id) * 0.15;
          break;
        case "tee":
          rot = clamp(e.vx / 900, -0.4, 0.4);
          break;
        case "mitten":
          rot = Math.sin(e.t * 4 + e.id) * 0.25;
          break;
        case "sweater":
          y += Math.sin(e.t * 2.4) * 2 * S;
          break;
      }
      const sx = (e.kind === "sock" || e.kind === "tee" ? e.face : 1) * wob * S;
      drawSprite(g, spr, x, y, rot, sx, wob * S);
      if (e.kind === "sweater" && e.hp < e.max) {
        // A little health bar under a sweater.
        const bw = 44 * S;
        x -= bw / 2;
        y += 38 * S;
        roundRectPath(g, x, y, bw, 7 * S, 3.5 * S);
        g.fillStyle = PAL.ink;
        g.fill();
        roundRectPath(g, x + 1.5 * S, y + 1.5 * S, Math.max(0, (bw - 3 * S) * (e.hp / e.max)), 4 * S, 2 * S);
        g.fillStyle = PAL.lime;
        g.fill();
      }
    }
  }

  function stripeFor(group: number): number {
    let s = stripeOf.get(group);
    if (s === undefined) {
      s = stripeOf.size % STRIPES.length;
      stripeOf.set(group, s);
    }
    return s;
  }

  function lookAtHero(x: number, y: number): [number, number] {
    const dx = sim.hero.x - x;
    const dy = sim.hero.y - y;
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }

  function drawBoss(a: Art) {
    const b = sim.boss;
    if (!b) return;
    const x = wx(b.x);
    const y = wy(b.y);
    const wob = 1 + 0.05 * Math.exp(-b.hitT * 10) * Math.cos(b.hitT * 36);
    const breathe = 1 + Math.sin(b.t * 2.6) * 0.02;
    const [lx, ly] = lookAtHero(b.x, b.y);
    g.save();
    g.translate(x, y);
    g.scale(S * wob, S * wob * breathe);
    switch (b.kind) {
      case "king": {
        drawSprite(g, a.king, 0, 0, Math.sin(b.t * 1.2) * 0.04, 1, 1);
        eye(g, -24, -8, 15, lx, ly, 3);
        eye(g, 24, -8, 15, lx, ly, 3);
        if (b.angry) {
          g.strokeStyle = PAL.ink;
          g.lineWidth = 5;
          g.lineCap = "round";
          for (const s of [-1, 1]) {
            g.beginPath();
            g.moveTo(s * 40, -32);
            g.lineTo(s * 10, -22);
            g.stroke();
          }
        }
        const m = 4 + b.mouth * 14;
        g.beginPath();
        g.ellipse(0, 28, 20, m, 0, 0, Math.PI * 2);
        g.fillStyle = "#5A1030";
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = PAL.ink;
        g.stroke();
        break;
      }
      case "spin": {
        drawSprite(g, a.spin, 0, 0, 0, 1, 1);
        // Inside the porthole: churning water, tumbling socks, and one big angry eye.
        g.save();
        g.beginPath();
        g.arc(0, 14, 38, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = C.water;
        g.fillRect(-40, -26, 80, 80);
        const spin = b.t * (b.angry ? 7 : 3.5) * b.spin;
        g.strokeStyle = C.waterHi;
        g.lineWidth = 5;
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.arc(0, 14, 14 + i * 9, spin + i * 2, spin + i * 2 + 2.2);
          g.stroke();
        }
        for (let i = 0; i < 3; i++) {
          const ang = spin * 0.8 + (i / 3) * Math.PI * 2;
          g.beginPath();
          g.ellipse(Math.cos(ang) * 26, 14 + Math.sin(ang) * 26, 7, 4, ang, 0, Math.PI * 2);
          inkFill(g, [PAL.tomato, PAL.lime, PAL.bubblegum][i]!, 2, 0);
        }
        g.restore();
        eye(g, 0, 14, 19, lx, ly, 3.5);
        if (b.angry) {
          g.strokeStyle = PAL.ink;
          g.lineWidth = 6;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(-26, -14);
          g.lineTo(0, -4);
          g.lineTo(26, -14);
          g.stroke();
        }
        break;
      }
      case "hamper": {
        // Eyes peeking from under the lid, then the lid over them.
        eye(g, -18, -36, 12, lx, ly, 3);
        eye(g, 18, -36, 12, lx, ly, 3);
        drawSprite(g, a.hamper, 0, 0, 0, 1, 1);
        const open = 0.16 + b.mouth * 0.55 + (b.angry ? 0.1 : 0) + Math.sin(b.t * 5) * 0.03;
        drawSprite(g, a.hamperLid, -68, -32, -open, 1, 1);
        break;
      }
    }
    g.restore();
  }

  function drawSparksAndShots(a: Art) {
    for (const s of sim.shots) {
      const rot = Math.atan2(s.vx, -s.vy);
      drawSprite(g, a.steam, wx(s.x), wy(s.y), rot, S, S);
    }
    for (const s of sim.sparks) {
      const k = (1 + 0.08 * Math.sin(s.t * 12 + s.id)) * S;
      drawSprite(g, a.spark, wx(s.x), wy(s.y), s.t * 5 + s.id, k, k);
    }
  }

  function drawIron(a: Art) {
    const h = sim.hero;
    if (!h.alive) return;
    const x = wx(h.x);
    const y = wy(h.y);
    const tilt = clamp(h.vx / 1100, -0.32, 0.32);
    const pop = ironPop.v;
    let alpha = 1;
    if (h.inv > 0 && h.power.shield <= 0) alpha = 0.45 + 0.5 * light.pulse(time, 2);
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(tilt);
    const big = 1.18;
    g.scale(big * (S * (2 - pop) * 0.5 + S * 0.5), big * S * pop);
    drawCord(h.vx, h.vy);
    drawSprite(g, a.iron, 0, 0, 0, 1, 1);
    // Eyes on the shell: look at whatever is nearest above, blink now and then.
    let lx = 0;
    let ly = -1;
    let best = 1e9;
    for (const e of sim.enemies) {
      const dy = e.y - h.y;
      if (dy > -30) continue;
      const d = Math.abs(e.x - h.x) + -dy * 0.3;
      if (d < best) {
        best = d;
        const l = Math.hypot(e.x - h.x, dy) || 1;
        lx = (e.x - h.x) / l;
        ly = dy / l;
      }
    }
    if (blinkT < 0) {
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.4;
      g.lineCap = "round";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 8 - 5, -13);
        g.lineTo(s * 8 + 5, -13);
        g.stroke();
      }
    } else if (hurtT < 0.5) {
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.4;
      g.lineCap = "round";
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 8 - 4, -17);
        g.lineTo(s * 8 + 4, -9);
        g.moveTo(s * 8 + 4, -17);
        g.lineTo(s * 8 - 4, -9);
        g.stroke();
      }
    } else {
      eye(g, -8, -13, 6.2, lx, ly, 2);
      eye(g, 8, -13, 6.2, lx, ly, 2);
    }
    g.restore();
    // Shield bubble.
    if (h.power.shield > 0) {
      const r = (32 + Math.sin(time * 4) * 1.5) * S;
      const ending = h.power.shield < 2 ? 0.5 + 0.5 * light.pulse(time, 2) : 1;
      g.save();
      g.globalAlpha = ending;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = "rgba(127,164,255,0.22)";
      g.fill();
      g.lineWidth = 3.5 * S;
      g.strokeStyle = PAL.white;
      g.stroke();
      g.beginPath();
      g.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.45);
      g.lineWidth = 5 * S;
      g.stroke();
      g.restore();
    }
    // Static cling: little crackles round the iron.
    if (h.power.magnet > 0) {
      g.strokeStyle = PAL.banana;
      g.lineWidth = 2.5 * S;
      g.lineCap = "round";
      const n = 3;
      for (let i = 0; i < n; i++) {
        const ang = time * 2 + (i / n) * Math.PI * 2;
        const r0 = 30 * S;
        g.beginPath();
        g.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0);
        g.lineTo(x + Math.cos(ang + 0.15) * (r0 + 7 * S), y + Math.sin(ang + 0.15) * (r0 + 7 * S));
        g.lineTo(x + Math.cos(ang + 0.05) * (r0 + 12 * S), y + Math.sin(ang + 0.05) * (r0 + 12 * S));
        g.stroke();
      }
    }
  }

  /** The iron's cord, trailing behind it and swinging with its motion, plug and all. */
  function drawCord(vx: number, vy: number) {
    const lag = clamp(-vx * 0.035, -28, 28);
    const stretch = clamp(vy * 0.02, -10, 18);
    const wig = Math.sin(time * 7) * 5;
    const ex = lag * 1.2 + Math.sin(time * 3.1) * 4;
    const ey = 74 + stretch;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, 24);
    g.bezierCurveTo(-14 + wig + lag * 0.3, 40, 14 - wig + lag * 0.8, 56, ex, ey);
    g.lineWidth = 6.5;
    g.strokeStyle = PAL.ink;
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = PAL.cream;
    g.stroke();
    g.save();
    g.translate(ex, ey);
    g.rotate(clamp(lag * 0.02, -0.5, 0.5));
    for (const px of [-3.5, 3.5]) {
      g.beginPath();
      g.moveTo(px, 10);
      g.lineTo(px, 17);
      g.lineWidth = 2.6;
      g.strokeStyle = PAL.ink;
      g.stroke();
    }
    roundRectPath(g, -7, -2, 14, 13, 3);
    inkFill(g, PAL.banana, 2.2, 0);
    g.restore();
  }

  function drawChunks() {
    g.lineJoin = "round";
    for (const c of chunks) {
      const k = c.life / c.max;
      const s = c.size * (k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1);
      if (s < 1) continue;
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.rot);
      g.beginPath();
      const n = 3 + (c.seed % 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = s * (0.6 + hash(c.seed, i) * 0.5);
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      inkFill(g, c.color, 2.4, 0);
      g.restore();
    }
  }

  function drawSnaps() {
    for (const sn of snaps) {
      // The two halves of a pressed clothesline drop away from where it was tied.
      const k = sn.t / 0.8;
      g.globalAlpha = 1 - k;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 4;
      const y0 = wy(sn.y);
      for (const s of [-1, 1]) {
        const ex = s < 0 ? 0 : W;
        g.beginPath();
        g.moveTo(ex, y0);
        g.lineTo(ex + -s * W * 0.25 * (1 - k * 0.7), y0 + k * H * 0.3 + 20);
        g.stroke();
      }
      g.globalAlpha = 1;
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
    const k = u();
    const sp = scorePos();
    g.save();
    g.translate(sp.x, sp.y);
    g.rotate(-0.05);
    g.scale(scorePop.v, scorePop.v);
    sticker(g, fmt(shown), 0, 0, { size: Math.round(32 * k), align: "left", fill: PAL.white, shadow: 4 });
    g.restore();
    if (bestAtStart !== null && bestAtStart > 0) sticker(g, bestCheered ? "NEW BEST!" : `BEST ${fmt(bestAtStart)}`, sp.x + 2, sp.y + 30 * k, { size: Math.round(12 * k), align: "left", fill: PAL.banana, shadow: 2, rot: -0.04 });
    // Combo multiplier and the window draining under it.
    if (sim.combo > 0) {
      const mp = multPos();
      const m = sim.mult;
      const fill = m >= 5 ? PAL.tomato : m >= 2 ? PAL.banana : PAL.white;
      sticker(g, `×${m}`, mp.x, mp.y, { size: Math.round((m >= 2 ? 26 : 20) * k), align: "left", fill, shadow: 3, sx: multPop.v, sy: multPop.v, rot: -0.06 });
      const next = TIERS[m] ?? null;
      const label = next !== null ? `${sim.combo}/${next}` : `${sim.combo}`;
      sticker(g, label, mp.x + 52 * k, mp.y - 6 * k, { size: Math.round(11 * k), align: "left", fill: PAL.white, shadow: 1.5 });
      const bw = 64 * k;
      const by = mp.y + 6 * k;
      roundRectPath(g, mp.x + 52 * k, by, bw, 7 * k, 3.5 * k);
      g.fillStyle = PAL.ink;
      g.fill();
      const frac = clamp(sim.comboT / COMBO_WINDOW);
      if (frac > 0.02) {
        roundRectPath(g, mp.x + 53.5 * k, by + 1.5 * k, (bw - 3 * k) * frac, 4 * k, 2 * k);
        g.fillStyle = fill;
        g.fill();
      }
    }
    // Hearts.
    for (let i = 0; i < HEARTS; i++) {
      const full = i < sim.hero.hearts;
      const p = heartPop[i]!.v;
      const last = sim.hero.hearts === 1 && i === 0 && sim.hero.alive;
      const beat = last ? 1 + 0.12 * light.pulse(time, 1.5) : 1;
      drawSprite(g, full ? a.heart : a.heartEmpty, heartX(i), heartY(), (i - 1) * 0.08, p * beat * k, p * beat * k);
    }
    // Active power-ups: a badge each with its timer running out round the edge.
    let px = W - session.play().right - 22 * k;
    const py = session.play().top + 72 * k;
    for (const kind of ["spread", "rapid", "magnet", "shield"] as const) {
      const left = sim.hero.power[kind];
      if (left <= 0) continue;
      const frac = clamp(left / (kind === "shield" ? POWER_TIME.shield : POWER_TIME[kind]));
      const ending = left < 2 ? 0.55 + 0.45 * light.pulse(time, 2) : 1;
      g.save();
      g.translate(px, py);
      g.globalAlpha = ending;
      g.beginPath();
      g.arc(0, 0, 12.5 * k, 0, Math.PI * 2);
      inkFill(g, POWER_FILL[kind], 2.4, 2);
      g.beginPath();
      g.arc(0, 0, 15.5 * k, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * Math.PI * 2);
      g.lineWidth = 3 * k;
      g.strokeStyle = PAL.white;
      g.lineCap = "round";
      g.stroke();
      powerIcon(g, kind, 0.6 * k);
      g.restore();
      px -= 36 * k;
    }
    // The boss: name and health, between the combo meter and the power-ups.
    const b = sim.boss;
    if (b && b.phase !== "leave") {
      const appear = easeOutBack(clamp(bossBanner / 0.4), 1.6);
      const x0 = session.play().left + 150 * k;
      const x1 = px + 12 * k;
      const bw = Math.max(80, x1 - x0);
      const bx = x0;
      const by = session.play().top + 60 * k;
      g.save();
      g.translate(bx + bw / 2, by);
      g.scale(appear, appear);
      g.translate(-(bx + bw / 2), -by);
      sticker(g, bossName, bx + bw / 2, by - 4 * k, { size: Math.round(12 * k), fill: PAL.white, shadow: 2 });
      roundRectPath(g, bx, by + 7 * k, bw, 11 * k, 5.5 * k);
      inkFill(g, PAL.ink, 2, 2);
      const frac = clamp(b.hp / b.max);
      if (frac > 0.01) {
        roundRectPath(g, bx + 2 * k, by + 9 * k, (bw - 4 * k) * frac, 7 * k, 3.5 * k);
        g.fillStyle = b.angry ? PAL.tomato : PAL.lime;
        g.fill();
      }
      g.restore();
    }
    drawGhost(a);
    if (session.phase === "over") drawSummary();
  }

  /** First run: a ghost glove sweeping side to side under the iron until the thumb drags for real. */
  function drawGhost(a: Art) {
    if (ghostAlpha <= 0.01) return;
    const h = sim.hero;
    const sweep = Math.sin(time * 2.4);
    const x = clamp(wx(h.x) + sweep * 70, 40, W - 60);
    const y = Math.min(H - 70, wy(h.y) + 70 * S);
    g.save();
    g.globalAlpha = ghostAlpha;
    g.strokeStyle = PAL.white;
    g.lineWidth = 5;
    g.lineCap = "round";
    g.setLineDash([2, 10]);
    g.beginPath();
    g.moveTo(clamp(wx(h.x) - 70, 40, W - 60), y);
    g.lineTo(clamp(wx(h.x) + 70, 40, W - 60), y);
    g.stroke();
    g.setLineDash([]);
    drawSprite(g, a.glove, x - 9, y + 2, -0.15, S, S);
    g.restore();
    sticker(g, "DRAG ANYWHERE TO MOVE!", W / 2, Math.min(H - 24, y + 76), { size: 17, fill: PAL.banana, rot: -0.04, shadow: 2.5, alpha: ghostAlpha });
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
    sticker(g, `BEST COMBO ×${s.maxMult}`, x0, -ph / 2 + 20, { size: 14, align: "left", fill: PAL.banana, shadow: 2 });
    sticker(g, `BOSSES ${s.bosses}`, w / 2 - 14, -ph / 2 + 20, { size: 14, align: "right", fill: PAL.bubblegumHi, shadow: 2 });
    const y0 = -ph / 2 + 40;
    const bw = w - 28;
    roundRectPath(g, x0, y0, bw, 22, 11);
    inkFill(g, PAL.white, 3, 0);
    const prev = sm.prevBest;
    const frac = sm.isBest || !prev ? 1 : clamp(sm.score / prev);
    const grow = Math.min(1, (session.phaseTime - 0.35) / 0.8);
    if (frac > 0.02) {
      roundRectPath(g, x0 + 3, y0 + 3, Math.max(16, (bw - 6) * frac * grow), 16, 8);
      g.fillStyle = sm.isBest ? PAL.lime : C.sky;
      g.fill();
    }
    const label = sm.isBest ? (prev ? `NEW BEST! +${fmt(sm.score - prev)}` : "FIRST SCORE ON THE BOARD!") : `${Math.round(frac * 100)}% OF YOUR BEST`;
    sticker(g, label, 0, y0 + 11, { size: 13, fill: PAL.white, shadow: 1.5 });
    g.font = font(12);
    g.fillStyle = PAL.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const tip = `TIP: ${sm.tip}`;
    let size = 12;
    while (size > 9 && g.measureText(tip).width > bw) g.font = font(--size);
    g.fillText(tip, x0, ph / 2 - 24);
    g.restore();
    if (solo && session.phaseTime > 0.8) {
      sticker(g, fmt(sm.score), W / 2, topY - 70, { size: 52, fill: PAL.banana, cut: 5, shadow: 5, rot: -0.05, sx: scorePop.v, sy: scorePop.v });
      burstSticker(g, "TAP TO BLAST AGAIN!", W / 2, topY + ph + 54, { size: 18, fill: PAL.tomato, rx: 160, ry: 34, seed: 31, rot: -0.04 + (reduced ? 0 : Math.sin(time * 5) * 0.05) });
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
    const k = Math.min(1.2, aw / 300);
    const titleIn = clamp(time * 1.6);
    const pop = titleIn < 1 ? 0.4 + 0.6 * easeOutCubic(titleIn) + Math.sin(titleIn * 9) * 0.08 * (1 - titleIn) : 1;
    const amp = reduced ? 2 : 9;
    const letter = (i: number, fill: string) => {
      const ph = (((time * (reduced ? 0.5 : 1.3) - i * 0.08) % 1) + 1) % 1;
      const hop = 4 * ph * (1 - ph);
      return { dx: 0, dy: -hop * amp, rot: Math.sin(time * 2 + i) * 0.05, sx: 1, sy: 1, fill };
    };
    g.save();
    g.translate(cxx, topY + 46 * k);
    g.scale(pop * k * titlePop.v, pop * k * titlePop.v);
    stickerWord(g, "LINT", -30, 0, { size: 56, rot: -0.07, cut: 6, shadow: 6 }, (i) => letter(i, i % 2 ? PAL.white : PAL.cream));
    stickerWord(g, "STORM!", 26, 58, { size: 54, rot: 0.05, cut: 6, shadow: 7 }, (i) => letter(i + 4, i % 2 ? PAL.banana : PAL.bananaHi));
    g.restore();
    if (session.best !== null && session.best > 0) sticker(g, `BEST ${fmt(session.best)}`, left + 60 * k, topY + 124 * k, { size: 15 * Math.max(0.85, k), rot: -0.08, fill: PAL.white, shadow: 2.5 });
    const py = bottomY - 34;
    const wob = reduced ? 0 : Math.sin(time * 5.2) * 0.07;
    const sc = 1 + (reduced ? 0 : Math.sin(time * 7.3) * 0.045);
    burstSticker(g, "TAP TO BLAST!", cxx + 2, py, { size: 25, fill: PAL.tomato, rx: 136, ry: 40, seed: 42, rot: -0.06 + wob, scale: sc * Math.min(1, k) });
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
    drawRopes();
    drawSnaps();
    drawPickups(a);
    drawEnemies(a);
    drawBoss(a);
    steam.draw(g);
    drawSparksAndShots(a);
    drawIron(a);
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
