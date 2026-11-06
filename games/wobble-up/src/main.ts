import { createAudio, createMusic } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { mix } from "@thumbcade-games/kit/color";
import { clamp, damp, lerp } from "@thumbcade-games/kit/ease";
import { onDrag, onKeys } from "@thumbcade-games/kit/input";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  drawBolt,
  drawCherry,
  drawCookie,
  drawGrumpyCloud,
  drawPlank,
  drawSpring,
  drawUrchin,
  makeBackdropCloud,
  MOVER,
  PLANK,
} from "./art.ts";
import { Bits, burstSticker, inkFill, loadComicFont, makeHalftone, PAL, Pows, roundRectPath, setSpriteScale, sticker, stickerWord, Wobble } from "./comic.ts";
import { Jelly, R } from "./jelly.ts";
import { S as SND } from "./sfx.ts";

// ---------------------------------------------------------------------------------------------------------------
// Tuning (world units: the column is 390 wide, y grows downward)
// ---------------------------------------------------------------------------------------------------------------
const COL = 390;
const G = 1500;
const BOUNCE = 880; // apex ≈ 258
const SPRING_V = 1520; // apex ≈ 770
const MAX_FALL = 1350;
const MAX_GAP = 222;
const FOOT = R * 0.76;
const SQUISH_T = 0.085;
const SPRING_T = 0.11;
const SPRING_H = 24;
/** Bounces a plank takes before it gives way (cracks on the one before). Nothing can be camped on forever. */
const PLANK_LIFE = 3;
const CHERRY_PTS = 10;
const STEER_SENS = 1.25;

/** Difficulty 0..1 from the height climbed. Fully nasty around 1200 (about 75-90 s for a good climber). */
const diffAt = (h: number) => clamp(h / 12000) ** 0.9;

/** Sky zones as [base, ray] colours, climbing through the palette; never dark. */
const ZONES: Array<[string, string]> = [
  [PAL.banana, PAL.bananaHi],
  ["#8FD0FF", "#C2E6FF"],
  ["#C8F57E", "#E4FCB8"],
  ["#FFB49B", "#FFD6C7"],
  [PAL.bubblegumHi, "#FFE0F1"],
];
const ZONE_H = 2600;

type PlatKind = "plank" | "mover" | "cookie";

interface Plat {
  kind: PlatKind;
  x: number;
  y: number;
  w: number;
  hits: number;
  spring: { off: number; squish: number } | null;
  baseX: number;
  amp: number;
  omega: number;
  phase: number;
  /** x change this frame (movers carry the jelly). */
  dx: number;
  dip: number;
  dipV: number;
  seed: number;
  broken: boolean;
}

interface Urchin {
  x: number;
  y: number;
  baseX: number;
  r: number;
  phase: number;
  spin: number;
}

interface Cherry {
  x: number;
  y: number;
  t: number;
}

interface Cloud {
  x: number;
  y: number;
  vx: number;
  state: "idle" | "charge" | "zap";
  t: number;
  idleFor: number;
  seed: number;
}

interface Piece {
  kind: "plank" | "mover" | "cookie";
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  side: number;
  seed: number;
  life: number;
}

const wrapDx = (a: number, b: number) => ((((a - b) % COL) + COL + COL / 2) % COL) - COL / 2;

async function main() {
  const [session] = await Promise.all([createSession({ id: "wobble-up" }), loadComicFont()]);
  const reduced = session.reducedMotion;
  const view = createCanvas({ maxDpr: 2.5, background: PAL.banana });
  const g = view.ctx;
  let W = view.width;
  let H = view.height;
  /** World -> screen scale, the column's left edge on screen, and the visible world height. */
  let SC = 1;
  let OX = 0;
  let VH = 754;
  let halftone: HTMLCanvasElement | null = null;
  const backdropClouds = [0.9, 1.15, 0.75, 1].map((s) => ({ s, img: null as HTMLCanvasElement | null }));
  const layout = () => {
    W = view.width;
    H = view.height;
    SC = Math.min(W / COL, H / 600);
    OX = (W - COL * SC) / 2;
    VH = H / SC;
    setSpriteScale(view.dpr);
    const hd = Math.min(view.dpr, 1.5);
    halftone = makeHalftone(W * hd, H * hd, 15 * hd, PAL.white, (x, y) => {
      const edge = Math.max(Math.abs(x - 0.5) * 2, 0) ** 2;
      return clamp(0.1 + y * y * 0.75 + edge * 0.35, 0, 0.92);
    });
    for (const c of backdropClouds) c.img = makeBackdropCloud(c.s * SC, Math.min(view.dpr, 2));
  };
  layout();
  view.onResize(layout);

  const audio = createAudio();
  const music = createMusic(audio, {
    bpm: 144,
    wave: "triangle",
    volume: 0.05,
    steps: [48, null, 55, null, 52, null, 55, null, 53, null, 57, null, 55, 54, 53, null, 48, null, 55, null, 52, null, 55, 57, 59, null, 55, null, 50, null, 43, null],
  });
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.03, 1.7, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2 });
  const bits = new Bits(260);
  const hudBits = new Bits(140);
  const pows = new Pows(reduced);
  const hudPows = new Pows(reduced);
  const scorePop = new Wobble(300, 10);
  const cherryPop = new Wobble(300, 10);
  const punch = new Wobble(260, 14);
  const logoPop = new Wobble(200, 9);

  // -------------------------------------------------------------------------------------------------------------
  // World state
  // -------------------------------------------------------------------------------------------------------------
  const jelly = new Jelly();
  let mode: "attract" | "play" = "attract";
  let plats: Plat[] = [];
  let urchins: Urchin[] = [];
  let cherries: Cherry[] = [];
  let clouds: Cloud[] = [];
  let pieces: Piece[] = [];
  let camY = 0;
  let nextY = 0;
  let prevPathX = COL / 2;
  let nextCloudH = 3000;
  let band = 0;
  let contact: { plat: Plat; t: number; spring: boolean; top: number } | null = null;
  let stun = 0;
  let hitCool = 0;
  let pendingDx = 0;
  let dragLast: number | null = null;
  let heightPts = 0;
  let cherryCount = 0;
  let score = 0;
  let shownScore = 0;
  let nextMilestone = 100;
  let dead: { t: number; cause: "fell" | "ouch"; off: boolean; offT: number } | null = null;
  let endSent = false;
  let time = 0;
  let runTime = 0;
  let aiTarget: Plat | null = null;
  let aiJitter = 0;
  let attractReset = -1;
  let titleIn = 0;

  function addPlat(kind: PlatKind, x: number, y: number, w: number, d: number): Plat {
    const p: Plat = {
      kind,
      x,
      y,
      w,
      hits: 0,
      spring: null,
      baseX: x,
      amp: 0,
      omega: 0,
      phase: 0,
      dx: 0,
      dip: 0,
      dipV: 0,
      seed: Math.floor(rng() * 1e6),
      broken: false,
    };
    if (kind === "mover") {
      p.amp = Math.min(rng.range(50, 125), (COL - w) / 2 - 6);
      p.baseX = clamp(x, w / 2 + p.amp + 4, COL - w / 2 - p.amp - 4);
      p.omega = lerp(48, 150, d) / p.amp;
      p.phase = rng() * Math.PI * 2;
      p.x = p.baseX + Math.sin(p.phase) * p.amp;
    }
    plats.push(p);
    return p;
  }

  function farX(from: number[], w: number, min: number): number {
    for (let tries = 0; tries < 12; tries++) {
      const x = rng.range(w / 2 + 6, COL - w / 2 - 6);
      if (from.every((f) => Math.abs(wrapDx(x, f)) > min)) return x;
    }
    return (from[0]! + COL / 2) % COL;
  }

  /** One band of the climb: a guaranteed reachable platform, maybe an extra, maybe goodies and trouble. */
  function genBand() {
    const att = mode === "attract";
    const h = -nextY;
    const d = att ? Math.min(0.25, diffAt(h) * 0.5) : diffAt(h);
    band++;
    // A scripted opening introduces the cast: boing, boing, SPROING, then a cookie and a mover.
    const gap = band === 1 ? 92 : band === 2 ? 180 : Math.min(MAX_GAP, lerp(88, 208, d) * rng.range(0.8, 1.1));
    const prevY = nextY;
    nextY -= gap;
    const y = nextY;
    // Past the full ramp it keeps tightening, so even a great run tops out.
    const late = att ? 0 : clamp((h - 12000) / 6000);
    const r = rng();
    const cookieP = h > 500 ? lerp(0.1, 0.42, d) + late * 0.16 : 0;
    const moverP = h > 900 ? lerp(0.12, 0.34, d) : 0;
    const kind: PlatKind = band <= 2 ? "plank" : band === 4 ? "cookie" : band === 6 ? "mover" : r < cookieP ? "cookie" : r < cookieP + moverP ? "mover" : "plank";
    const w = kind === "cookie" ? lerp(68, 58, d) : lerp(82, 58, d) * rng.range(0.92, 1.08);
    const x = band <= 2 ? COL / 2 : rng.range(w / 2 + 6, COL - w / 2 - 6);
    const p = addPlat(kind, x, y, w, d + late * 0.5);
    if (band === 2) p.spring = { off: 0, squish: 0 };
    else if (kind !== "cookie" && h > 300 && rng.chance(lerp(0.11, 0.07, d))) p.spring = { off: rng.range(-w / 2 + 16, w / 2 - 16), squish: 0 };
    // An extra platform in the band: plenty early, rare later.
    if (rng.chance(lerp(0.6, 0.1, d))) {
      const kind2: PlatKind = band === 3 || (h > 300 && rng.chance(lerp(0.2, 0.6, d))) ? "cookie" : "plank";
      const w2 = kind2 === "cookie" ? 64 : lerp(78, 60, d);
      // Keep the opening column clear so the first hops always reach the spring.
      addPlat(kind2, farX(band <= 4 ? [p.x, COL / 2] : [p.x], w2, 110), prevY - gap * rng.range(0.35, 0.65), w2, d);
    }
    if (rng.chance(0.3)) cherries.push({ x: clamp(p.x + rng.range(-24, 24), 16, COL - 16), y: y - rng.range(60, 130), t: rng() * 6 });
    if (!att && h > 2000 && rng.chance(lerp(0.1, 0.32, d) + late * 0.15)) {
      const ux = farX([p.x, prevPathX], 40, 105);
      urchins.push({ x: ux, y: prevY - gap * 0.5, baseX: ux, r: 15, phase: rng() * 6, spin: rng() * 6 });
    }
    if (!att && h > 3200 && h > nextCloudH && clouds.length === 0) {
      clouds.push({ x: rng.range(60, COL - 60), y: prevY - gap * 0.5 - 30, vx: (rng.chance(0.5) ? 1 : -1) * rng.range(30, 55), state: "idle", t: 0, idleFor: 1.6, seed: 1 });
      nextCloudH = h + lerp(2400, 1300, d);
    }
    prevPathX = p.x;
  }

  function resetWorld(m: "attract" | "play") {
    mode = m;
    plats = [];
    urchins = [];
    cherries = [];
    clouds = [];
    pieces = [];
    bits.clear();
    pows.clear();
    hudPows.clear();
    hudBits.clear();
    nextY = 0;
    band = 0;
    prevPathX = COL / 2;
    nextCloudH = 2800;
    const start = addPlat("plank", COL / 2, 0, 104, 0);
    start.seed = 7;
    jelly.reset(COL / 2, -FOOT);
    contact = { plat: start, t: 0, spring: false, top: 0 };
    camY = -VH * 0.76;
    stun = 0;
    hitCool = 0;
    pendingDx = 0;
    heightPts = 0;
    cherryCount = 0;
    score = 0;
    shownScore = 0;
    nextMilestone = 100;
    dead = null;
    endSent = false;
    runTime = 0;
    aiTarget = null;
    attractReset = -1;
    while (nextY > camY - 500) genBand();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------------------------
  const playing = () => mode === "play" && session.phase === "playing" && !dead;

  function land(p: Plat, onSpring: boolean, top: number) {
    contact = { plat: p, t: 0, spring: onSpring, top };
    aiTarget = null;
    jelly.vy = 0;
    jelly.mood = "squish";
    p.dipV += onSpring ? 0 : 60;
    if (onSpring && p.spring) p.spring.squish = 1;
    const loud = mode === "play";
    if (loud) {
      bits.emit(jelly.x, top, { count: 5, speed: [50, 140], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.25, 0.45], size: [4, 7], colors: [PAL.white, PAL.bubblegumHi], shape: "dot", gravity: 500, drag: 2 });
    }
  }

  function launch() {
    if (!contact) return;
    const { plat: p, spring } = contact;
    contact = null;
    const v = spring ? SPRING_V : BOUNCE;
    jelly.vy = -v;
    jelly.impulse(0, -v, spring ? 0.2 : 0.24, spring ? 0.74 : 0.62);
    jelly.mood = spring ? "spring" : "happy";
    const loud = mode === "play";
    if (spring) {
      audio.play(SND.sproing, { pitch: rng.range(-1, 1), volume: loud ? 1 : 0.5 });
      if (loud) {
        pows.burst("SPROING!", jelly.x, jelly.y - 30, { size: 24, fill: PAL.banana, rot: rng.range(-0.25, 0.25) });
        shake.add(0.28);
        if (!reduced) punch.kick(1.4);
        hitStop.freeze(0.045);
        session.feedback("success");
        bits.emit(jelly.x, jelly.y + R, { count: 14, speed: [120, 320], angle: [Math.PI * 0.15, Math.PI * 0.85], life: [0.4, 0.8], size: [6, 10], colors: [PAL.banana, PAL.white, PAL.tomato, PAL.cobalt], shape: "confetti", gravity: 600, drag: 1.5 });
      }
    } else {
      audio.play(SND.boing, { pitch: rng.range(-2, 2.5) + (p.kind === "cookie" ? -2 : 0), volume: loud ? 0.9 : 0.4 });
      if (loud) session.feedback("tap");
    }
    p.hits++;
    if (p.kind === "cookie") {
      breakPlat(p);
      audio.play(SND.crunch, { pitch: rng.range(-2, 2), volume: loud ? 1 : 0.4 });
      if (loud) {
        pows.burst("CRUNCH!", p.x + rng.range(-10, 10), p.y + 26, { size: 18, fill: PAL.bananaHi, life: 0.5 });
        shake.add(0.12);
      }
      bits.emit(p.x, p.y + 8, { count: 12, speed: [60, 200], angle: [Math.PI * 0.1, Math.PI * 0.9], life: [0.5, 0.9], size: [4, 8], colors: ["#EDAE5C", "#C47A2E", "#4A2A14"], shape: "dot", gravity: 900, drag: 0.6 });
    } else if (p.hits >= PLANK_LIFE) {
      breakPlat(p);
      audio.play(SND.crunch, { pitch: -6, volume: loud ? 0.8 : 0.3 });
      if (loud) pows.burst("KRAK!", p.x, p.y + 24, { size: 17, fill: PAL.white, life: 0.5 });
    } else if (p.hits === PLANK_LIFE - 1) {
      audio.play(SND.creak, { volume: loud ? 1 : 0.4 });
    }
  }

  function breakPlat(p: Plat) {
    p.broken = true;
    if (p.kind === "cookie") {
      for (let i = 0; i < 3; i++)
        pieces.push({ kind: "cookie", x: p.x + (i - 1) * p.w * 0.3, y: p.y, vx: (i - 1) * 60 + rng.range(-20, 20), vy: rng.range(-120, -40), rot: 0, vr: rng.range(-6, 6), w: p.w * 0.38, side: i, seed: p.seed + i, life: 1.4 });
    } else {
      for (const side of [-1, 1])
        pieces.push({ kind: p.kind === "mover" ? "mover" : "plank", x: p.x + (side * p.w) / 4, y: p.y, vx: side * 50, vy: -60, rot: 0, vr: side * 3, w: p.w / 2, side, seed: p.seed, life: 1.4 });
    }
  }

  function collectCherry(c: Cherry) {
    cherryCount++;
    cherryPop.kick(6);
    audio.play(SND.cherry, { pitch: Math.min(10, cherryCount % 12) });
    pows.float(`+${CHERRY_PTS}`, c.x, c.y - 10, { size: 22, textFill: PAL.tomato });
    bits.emit(c.x, c.y, { count: 8, speed: [80, 200], life: [0.3, 0.6], size: [6, 10], colors: [PAL.tomato, PAL.white, PAL.banana], shape: "star", drag: 3 });
    session.feedback("tap");
  }

  function knock(kind: "oof" | "zap", x: number, y: number) {
    if (hitCool > 0 || dead) return;
    hitCool = 0.9;
    contact = null;
    stun = kind === "zap" ? 0.55 : 0.3;
    jelly.vy = Math.max(jelly.vy, kind === "zap" ? 330 : 240);
    jelly.mood = "stun";
    jelly.poke(kind === "zap" ? 260 : 160);
    pendingDx = 0;
    if (kind === "zap") {
      audio.play(SND.zap);
      audio.play(SND.crackle);
      pows.burst("ZAP!", x, y, { size: 26, fill: PAL.banana, rot: rng.range(-0.3, 0.3) });
      flash.trigger(PAL.bananaHi, 0.8);
      bits.emit(jelly.x, jelly.y, { count: 12, speed: [120, 300], life: [0.25, 0.5], size: [6, 10], colors: [PAL.banana, PAL.white], shape: "star", drag: 2.5 });
    } else {
      audio.play(SND.thud, { volume: 0.7 });
      audio.play(SND.kazoo, { pitch: -5 });
      pows.burst("OOF!", x, y, { size: 22, fill: PAL.white, rot: rng.range(-0.3, 0.3) });
    }
    shake.add(0.35);
    hitStop.freeze(0.07);
    session.feedback("impact");
  }

  function die(cause: "fell" | "ouch", x: number, y: number) {
    if (dead) return;
    dead = { t: 0, cause, off: false, offT: 0 };
    contact = null;
    pendingDx = 0;
    jelly.mood = cause === "ouch" ? "dead" : "fall";
    if (cause === "ouch") {
      jelly.vy = -320;
      jelly.poke(300);
      hitStop.freeze(0.12);
      shake.add(0.55);
      flash.trigger(PAL.white, 0.9);
      audio.play(SND.ouch);
      audio.play(SND.crack);
      pows.burst("OUCH!", x, y - 10, { size: 28, fill: PAL.tomato, rot: rng.range(-0.3, 0.3), life: 0.8 });
      session.feedback("fail");
    }
  }

  function splat() {
    if (!dead || dead.off) return;
    dead.off = true;
    dead.offT = dead.t;
    music.stop();
    audio.play(SND.whistleDown);
    const sx = clamp(jelly.x, 70, COL - 70);
    const sy = camY + VH - 70;
    window.setTimeout(() => audio.play(SND.splat), 230);
    pows.burst("KER-SPLAT!", sx, sy, { size: 25, fill: PAL.bubblegum, life: 1.1, rot: rng.range(-0.15, 0.15) });
    bits.emit(sx, camY + VH, { count: 22, speed: [250, 560], angle: [Math.PI * 1.15, Math.PI * 1.85], life: [0.5, 0.9], size: [7, 13], colors: [PAL.bubblegum, PAL.bubblegumHi, PAL.white], shape: "drop", gravity: 1300, drag: 0.4 });
    shake.add(0.45);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: a tap starts a run (on release); a horizontal drag anywhere steers, relative to the finger.
  // -------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  onDrag(window, {
    start: (x) => {
      dragLast = x;
    },
    move: (x) => {
      if (dragLast === null) return;
      if (playing() && stun <= 0) pendingDx += ((x - dragLast) / SC) * STEER_SENS;
      dragLast = x;
    },
    end: () => {
      dragLast = null;
    },
  });
  onKeys({
    left: () => playing() && (pendingDx -= 34),
    right: () => playing() && (pendingDx += 34),
  });
  session.on("cancel", () => {
    dragLast = null;
    pendingDx = 0;
  });
  session.on("start", () => {
    resetWorld("play");
    music.start();
    titleIn = 0;
  });
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (playing()) music.start();
  });
  session.on("attract", () => resetWorld("attract"));
  resetWorld("attract");

  // -------------------------------------------------------------------------------------------------------------
  // Attract pilot: steer toward the highest platform it can still land on, a little sloppily.
  // -------------------------------------------------------------------------------------------------------------
  function pilot(dt: number): number {
    const apex = jelly.vy < 0 ? jelly.y - (jelly.vy * jelly.vy) / (2 * G) : jelly.y;
    if (!aiTarget || aiTarget.broken || aiTarget.y + 4 < apex + FOOT || (jelly.vy > 0 && aiTarget.y < jelly.y + FOOT - 2) || aiTarget.y > camY + VH - 30) {
      aiTarget = null;
      let best = Infinity;
      for (const p of plats) {
        if (p.broken || p.hits >= PLANK_LIFE - 1) continue;
        const top = p.y;
        if (top < apex + FOOT + 14) continue; // can't reach it
        if (jelly.vy > 0 && top < jelly.y + FOOT) continue; // already above us while falling
        if (top > jelly.y + FOOT + 260 || top > camY + VH - 30) continue;
        let score = top + Math.abs(wrapDx(p.x, jelly.x)) * 0.25 - (p.spring ? 120 : 0);
        // Keep clear of urchins near the landing spot or on the way, and of grumpy clouds overhead.
        for (const u of urchins) {
          if (Math.abs(wrapDx(u.x, p.x)) < 60 && u.y < p.y + 10 && u.y > p.y - 140) score += 900;
          // Distance from the urchin to the straight line from here to the landing spot (and up to the apex).
          const tx = wrapDx(p.x, jelly.x);
          const ux = wrapDx(u.x, jelly.x);
          const ax = 0;
          const ay = jelly.y;
          const bx = tx;
          const by = Math.min(top - FOOT, apex);
          const lx = bx - ax;
          const ly = by - ay;
          const t = clamp(((ux - ax) * lx + (u.y - ay) * ly) / (lx * lx + ly * ly || 1));
          if (Math.hypot(ux - (ax + lx * t), u.y - (ay + ly * t)) < 58) score += 700;
        }
        for (const c of clouds) if (Math.abs(wrapDx(c.x, p.x)) < 80 && c.y < p.y && c.y > p.y - 300) score += 500;
        if (p.kind === "cookie") score += 40;
        if (score < best) {
          best = score;
          aiTarget = p;
        }
      }
      aiJitter = rng.range(-12, 12);
    }
    if (!aiTarget) return 0;
    let dx = wrapDx(aiTarget.x + aiJitter, jelly.x);
    // Dodge an urchin that is right in the way.
    for (const u of urchins) {
      const ux = wrapDx(u.x, jelly.x);
      const uy = u.y - jelly.y;
      if (Math.abs(ux) < 70 && Math.abs(uy) < 110 && Math.sign(uy) === Math.sign(jelly.vy || 1)) dx = -Math.sign(ux || 1) * 80;
    }
    const maxStep = 300 * dt;
    return clamp(dx * 0.18, -maxStep, maxStep);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += rawDt;
    titleIn = Math.min(1, titleIn + rawDt * 1.8);
    shake.update(rawDt);
    flash.update(rawDt);
    bits.update(dt);
    hudBits.update(rawDt);
    pows.update(rawDt);
    hudPows.update(rawDt);
    scorePop.update(rawDt);
    cherryPop.update(rawDt);
    punch.update(rawDt);
    logoPop.update(rawDt);
    if (dt <= 0) return;
    if (playing()) runTime += dt;
    hitCool = Math.max(0, hitCool - dt);
    stun = Math.max(0, stun - dt);

    // Platforms.
    for (const p of plats) {
      if (p.kind === "mover" && !p.broken) {
        const nx = p.baseX + Math.sin(p.phase + time * p.omega) * p.amp;
        p.dx = nx - p.x;
        p.x = nx;
      } else p.dx = 0;
      p.dipV += (-220 * p.dip - 14 * p.dipV) * dt;
      p.dip += p.dipV * dt;
      if (p.spring) p.spring.squish = Math.max(0, p.spring.squish - dt * 5);
    }
    for (const u of urchins) {
      u.x = u.baseX + Math.sin(time * 0.9 + u.phase) * 16;
      u.spin += dt * 0.7;
    }
    for (const c of cherries) c.t += dt;
    for (const c of clouds) {
      c.x += c.vx * dt;
      if (c.x < -50) c.x += COL + 100;
      if (c.x > COL + 50) c.x -= COL + 100;
      c.t += dt;
      const onScreen = c.y > camY - 40 && c.y < camY + VH;
      if (c.state === "idle" && c.t > c.idleFor && onScreen) {
        c.state = "charge";
        c.t = 0;
      } else if (c.state === "charge" && c.t > 0.9) {
        c.state = "zap";
        c.t = 0;
        c.seed++;
        if (mode === "play") audio.play(SND.zap, { volume: 0.6, pitch: 5 });
      } else if (c.state === "zap" && c.t > 0.45) {
        c.state = "idle";
        c.t = 0;
        c.idleFor = rng.range(1.6, 2.6);
      }
    }
    for (const pc of pieces) {
      pc.vy += G * dt;
      pc.x += pc.vx * dt;
      pc.y += pc.vy * dt;
      pc.rot += pc.vr * dt;
      pc.life -= dt;
    }
    if (pieces.length && pieces.some((p) => p.life <= 0)) pieces = pieces.filter((p) => p.life > 0);

    // Steering.
    let move = 0;
    if (mode === "attract" && !dead && stun <= 0) move = pilot(dt);
    else if (!dead && stun <= 0) {
      move = pendingDx * (1 - Math.exp(-28 * dt));
      move = clamp(move, -1100 * dt, 1100 * dt);
      pendingDx -= move;
    } else pendingDx *= Math.exp(-20 * dt);
    jelly.x += move;
    jelly.vx = damp(jelly.vx, move / dt, 18, dt);

    // Jelly centre.
    let floor: number | null = null;
    if (contact) {
      const c = contact;
      c.t += dt;
      jelly.x += c.plat.dx;
      const T = c.spring ? SPRING_T : SQUISH_T;
      const k = Math.min(1, c.t / T);
      const depth = Math.sin(Math.PI * k);
      const top = c.spring && c.plat.spring ? c.plat.y - SPRING_H * (1 - c.plat.spring.squish * 0.6) : c.plat.y + c.plat.dip;
      jelly.y = top - FOOT + R * (c.spring ? 0.5 : 0.42) * depth;
      jelly.sx = 1 + (c.spring ? 0.55 : 0.42) * depth;
      jelly.sy = 1 - (c.spring ? 0.45 : 0.36) * depth;
      floor = top;
      if (k >= 1) launch();
    } else {
      const grav = dead?.cause === "ouch" ? G * 1.5 : G;
      const prevBottom = jelly.y + FOOT;
      jelly.vy = Math.min(MAX_FALL, jelly.vy + grav * dt);
      jelly.y += jelly.vy * dt;
      const st = clamp(Math.abs(jelly.vy) / 3800, 0, 0.16);
      jelly.sx = 1 - st * 0.6;
      jelly.sy = 1 + st;
      if (!dead && jelly.mood !== "stun" && jelly.vy > 420) jelly.mood = "fall";
      if (stun <= 0 && jelly.mood === "stun") jelly.mood = jelly.vy > 0 ? "fall" : "happy";
      if (!dead && jelly.vy > 0) {
        // One-way platforms: land on the first top crossed this frame.
        const bottom = jelly.y + FOOT;
        let hit: Plat | null = null;
        let hitTop = Infinity;
        let hitSpring = false;
        for (const p of plats) {
          if (p.broken) continue;
          const dx = wrapDx(jelly.x, p.x);
          if (p.spring && Math.abs(dx - p.spring.off) < 13 + R * 0.45) {
            // The spring catches anything that comes down onto it, even from just under its pad.
            const st2 = p.y - SPRING_H;
            if (prevBottom <= p.y + 1 && bottom >= st2 && st2 < hitTop) {
              hit = p;
              hitTop = st2;
              hitSpring = true;
            }
            continue;
          }
          if (Math.abs(dx) > p.w / 2 + R * 0.5) continue;
          if (prevBottom <= p.y + 1 && bottom >= p.y && p.y < hitTop) {
            hit = p;
            hitTop = p.y;
            hitSpring = false;
          }
        }
        if (hit) {
          jelly.y = hitTop - FOOT;
          land(hit, hitSpring, hitTop);
          floor = hitTop;
        }
      }
    }
    if (dead) jelly.spin += dt * (dead.cause === "ouch" ? 9 : 0);
    // Screen wrap.
    if (jelly.x < 0) {
      jelly.x += COL;
      jelly.teleport(COL, 0);
    } else if (jelly.x >= COL) {
      jelly.x -= COL;
      jelly.teleport(-COL, 0);
    }
    jelly.step(dt, floor, reduced);

    // Pickups and hazards.
    if (!dead) {
      for (let i = cherries.length - 1; i >= 0; i--) {
        const c = cherries[i]!;
        if (Math.hypot(wrapDx(c.x, jelly.x), c.y - jelly.y) < R + 13) {
          cherries.splice(i, 1);
          if (mode === "play") collectCherry(c);
        }
      }
      for (const u of urchins) {
        if (Math.hypot(wrapDx(u.x, jelly.x), u.y - jelly.y) < R * 0.7 + u.r * 1.1) {
          if (mode === "play") die("ouch", u.x, u.y);
          break;
        }
      }
      for (const c of clouds) {
        const dx = wrapDx(c.x, jelly.x);
        const dy = c.y - jelly.y;
        if ((dx / (40 + R * 0.6)) ** 2 + (dy / (24 + R * 0.6)) ** 2 < 1) knock("oof", jelly.x, jelly.y - 20);
        else if (c.state === "zap" && Math.abs(dx) < 15 + R * 0.6 && jelly.y > c.y + 10 && jelly.y < c.y + 30 + boltLen() + R) knock("zap", jelly.x, jelly.y - 24);
      }
    }

    // Score: height in tens of units + cherries.
    if (mode === "play" && !dead) {
      const climbed = Math.max(0, Math.floor(-(jelly.y + FOOT) / 10));
      if (climbed > heightPts) {
        if (Math.floor(climbed / 10) > Math.floor(heightPts / 10)) scorePop.kick(1.2);
        heightPts = climbed;
      }
      const ns = heightPts + cherryCount * CHERRY_PTS;
      if (ns > score) score = ns;
      if (heightPts >= nextMilestone) {
        hudPows.burst(`${nextMilestone}!`, W * 0.5 - 20, H * 0.32, { size: 40, fill: PAL.banana, life: 1, rot: rng.range(-0.2, 0.2) });
        hudBits.emit(W * 0.15, H * 0.3, { count: 26, speed: [200, 520], angle: [-Math.PI * 0.45, -Math.PI * 0.05], life: [0.9, 1.5], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.white], shape: "confetti", gravity: 700, drag: 1.4 });
        hudBits.emit(W * 0.85, H * 0.3, { count: 26, speed: [200, 520], angle: [-Math.PI * 0.95, -Math.PI * 0.55], life: [0.9, 1.5], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.white], shape: "confetti", gravity: 700, drag: 1.4 });
        audio.play(SND.fanfare);
        scorePop.kick(5);
        session.feedback("success");
        nextMilestone += 100;
      }
    }
    if (Math.round(shownScore) !== score) shownScore = score;

    // Camera follows upward only.
    if (!dead) {
      // In attract the demo jelly rides lower, between the logo and the prompt.
      const target = jelly.y - VH * (mode === "attract" ? 0.58 : 0.44);
      if (target < camY) camY = damp(camY, target, 9, dt);
      while (nextY > camY - 500) genBand();
    }
    // Falling off the bottom.
    if (!dead && jelly.y - R > camY + VH && mode === "play") die("fell", jelly.x, jelly.y);
    if (dead) {
      dead.t += rawDt;
      if (!dead.off && jelly.y - R * 1.5 > camY + VH) splat();
      if (mode === "play" && !endSent) {
        // gameplay.end within 1 s of game over, whatever the fall looks like.
        const ready = dead.off ? dead.t - dead.offT > 0.45 : dead.t > 0.7;
        if (ready) {
          endSent = true;
          if (!dead.off) splat();
          session.end(score, { outcome: "lose", stats: { height: heightPts, cherries: cherryCount, seconds: Math.round(runTime) } });
        }
      }
    }
    if (mode === "attract") {
      if (jelly.y - R > camY + VH && attractReset < 0) attractReset = 0.6;
      if (attractReset >= 0) {
        attractReset -= rawDt;
        if (attractReset < 0) resetWorld("attract");
      }
      // A long demo climb starts over so the demo never drifts into an empty sky.
      if (-jelly.y > 9000 && !contact) resetWorld("attract");
    }

    // Cull everything that fell below the screen.
    const cut = camY + VH + 160;
    if (plats.some((p) => p.y > cut)) plats = plats.filter((p) => p.y <= cut);
    if (urchins.some((u) => u.y > cut)) urchins = urchins.filter((u) => u.y <= cut);
    if (cherries.some((c) => c.y > cut)) cherries = cherries.filter((c) => c.y <= cut);
    if (clouds.some((c) => c.y > cut + 60)) clouds = clouds.filter((c) => c.y <= cut + 60);
  }

  const boltLen = () => 170;

  // -------------------------------------------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------------------------------------------
  function sky(): [string, string] {
    const h = Math.max(0, -camY - VH * 0.3);
    const z = h / ZONE_H;
    const i = Math.floor(z);
    const f = clamp((z - i - 0.75) / 0.25);
    const a = ZONES[i % ZONES.length]!;
    const b = ZONES[(i + 1) % ZONES.length]!;
    return [mix(a[0], b[0], f), mix(a[1], b[1], f)];
  }

  function drawBackdrop() {
    const [base, ray] = sky();
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    const cx = W * 0.5;
    const cy = H * 0.36;
    const rad = Math.hypot(W, H);
    const rot = reduced ? 0.2 : time * 0.06;
    const rays = 16;
    g.fillStyle = ray;
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
      g.globalAlpha = 0.42;
      g.drawImage(halftone, 0, 0, W, H);
      g.globalAlpha = 1;
    }
    // Backdrop clouds drift with a slow parallax.
    const span = H + 260;
    backdropClouds.forEach((c, i) => {
      if (!c.img) return;
      const w = c.img.width / Math.min(view.dpr, 2);
      const h = c.img.height / Math.min(view.dpr, 2);
      const x = ((i * 0.37 + 0.12) % 1) * (W + w) - w / 2 + Math.sin(time * 0.15 + i) * 12;
      const y = ((((i * 0.27 + 0.05) * span - camY * SC * 0.25) % span) + span) % span - 130;
      g.drawImage(c.img, x - w / 2, y, w, h);
    });
  }

  function drawWorld() {
    const o = shake.offset;
    const pz = 1 + (punch.v - 1) * 0.04;
    g.save();
    g.translate(W / 2 + o.x, H / 2 + o.y);
    g.rotate(o.angle);
    g.scale(pz, pz);
    g.translate(-W / 2, -H / 2);
    g.translate(OX, 0);
    g.scale(SC, SC);
    g.translate(0, -camY);
    // Clip to the column on wide screens.
    if (OX > 1) {
      g.beginPath();
      g.rect(0, camY - 50, COL, VH + 100);
      g.clip();
    }
    const top = camY - 60;
    const bottom = camY + VH + 60;
    for (const c of clouds) {
      if (c.state === "zap") drawBolt(g, c.x, c.y + 18, boltLen(), c.seed);
    }
    for (const p of plats) {
      if (p.broken || p.y < top || p.y > bottom) continue;
      if (p.kind === "cookie") drawCookie(g, p.x, p.y + p.dip, p.w, p.seed);
      else {
        if (p.spring) drawSpring(g, p.x + p.spring.off, p.y + p.dip, p.spring.squish);
        drawPlank(g, p.x, p.y + p.dip, p.w, p.kind === "mover" ? MOVER : PLANK, p.hits >= PLANK_LIFE - 1 ? 1 : 0, p.seed);
      }
    }
    for (const pc of pieces) {
      g.save();
      g.translate(pc.x, pc.y);
      g.rotate(pc.rot);
      if (pc.kind === "cookie") drawCookie(g, 0, -6, pc.w, pc.seed);
      else drawPlank(g, 0, 0, pc.w, pc.kind === "mover" ? MOVER : PLANK, 1, pc.seed + pc.side);
      g.restore();
    }
    for (const c of cherries) if (c.y > top && c.y < bottom) drawCherry(g, c.x, c.y + Math.sin(c.t * 2.4) * 4, c.t);
    for (const u of urchins) if (u.y > top && u.y < bottom) drawUrchin(g, u.x, u.y, u.r, u.spin, time);
    for (const c of clouds) {
      const charge = c.state === "charge" ? c.t / 0.9 : c.state === "zap" ? 1 : 0;
      drawGrumpyCloud(g, c.x, c.y, charge, time, reduced);
    }
    bits.draw(g);
    // The jelly, plus its ghost across the wrap seam.
    if (jelly.y - R < camY + VH + 40) {
      jelly.draw(g, 0);
      if (jelly.x < R * 1.6) jelly.draw(g, COL);
      else if (jelly.x > COL - R * 1.6) jelly.draw(g, -COL);
    }
    pows.draw(g);
    g.restore();
  }

  /** Attract-mode layout inside the preview insets (rail on the right, caption at the bottom). */
  function drawAttract() {
    const ins = session.preview();
    const left = ins.left + 14;
    const right = W - ins.right - 14;
    const topY = ins.top + 10;
    const bottomY = H - ins.bottom - 12;
    const aw = right - left;
    const cx = left + aw / 2;
    const k = Math.min(1, aw / 300);
    const pop = titleIn < 1 ? 0.4 + 0.6 * (1 - (1 - titleIn) ** 3) + Math.sin(titleIn * 9) * 0.08 * (1 - titleIn) : 1;
    const amp = reduced ? 3 : 12;
    const speed = reduced ? 0.6 : 1.5;
    const letter = (i: number, base: string) => {
      const ph = (((time * speed - i * 0.085) % 1) + 1) % 1;
      const hop = 4 * ph * (1 - ph);
      const land = ph < 0.07 || ph > 0.95;
      return { dx: 0, dy: -hop * amp, rot: Math.sin(time * 2 + i) * 0.05, sx: land && !reduced ? 1.12 : 1, sy: land && !reduced ? 0.86 : 1, fill: base };
    };
    g.save();
    g.translate(cx - 6 * k, topY + 58 * k);
    g.scale(pop * k * logoPop.v, pop * k * logoPop.v);
    stickerWord(g, "WOBBLE", 0, 0, { size: 58, rot: -0.1, cut: 6, shadow: 6 }, (i) => letter(i, i % 2 ? PAL.bubblegumHi : PAL.bubblegum));
    stickerWord(g, "UP!", 70, 62, { size: 70, rot: 0.08, cut: 6, shadow: 7 }, (i) => letter(i + 6, PAL.banana));
    g.restore();
    if (session.best !== null) sticker(g, `BEST ${session.best}`, left + 70 * k, topY + 150 * k, { size: 16 * Math.max(0.85, k), rot: -0.08, fill: PAL.white, shadow: 2.5 });
    // The prompt: a jagged burst that wobbles.
    const py = bottomY - 40;
    const wob = reduced ? 0 : Math.sin(time * 5.2) * 0.07;
    const sc = 1 + (reduced ? 0 : Math.sin(time * 7.3) * 0.045);
    burstSticker(g, "TAP TO BOING!", cx + 4, py, { size: 23, fill: PAL.tomato, rx: 142, ry: 40, seed: 42, rot: -0.06 + wob, scale: sc * k });
  }

  function drawHud() {
    hudBits.draw(g);
    hudPows.draw(g);
    if (mode !== "play") {
      drawAttract();
      return;
    }
    const ins = session.play();
    const top = ins.top + 12;
    if (session.phase === "playing" || !session.standalone) {
      const s = scorePop.v;
      g.save();
      g.translate(ins.left + 20, top + 30);
      g.rotate(-0.07);
      g.scale(s, s);
      sticker(g, `${shownScore}`, 0, 0, { size: 42, align: "left", fill: PAL.white, shadow: 4 });
      g.restore();
      // Cherries.
      const cs = cherryPop.v;
      g.save();
      g.translate(ins.left + 22, top + 82);
      g.rotate(0.05);
      g.scale(cs, cs);
      // A little banana badge: cherry + count.
      const label = `×${cherryCount}`;
      const bw = 58 + label.length * 15;
      roundRectPath(g, 0, -20, bw, 40, 20);
      inkFill(g, PAL.banana, 3.5, 3.5);
      drawCherry(g, 22, 2, 0, 1.25);
      sticker(g, label, 40, 1, { size: 23, align: "left", shadow: 2.5 });
      g.restore();
      if (session.best !== null) sticker(g, `BEST ${session.best}`, W - ins.right - 16, top + 22, { size: 14, align: "right", rot: 0.06, shadow: 2 });
    }
    if (session.phase === "over" && session.standalone && session.phaseTime > 0.7) {
      sticker(g, `${score}`, W / 2, H * 0.38, { size: 64, rot: -0.06, fill: PAL.banana, cut: 5, shadow: 6, sx: scorePop.v, sy: scorePop.v });
      burstSticker(g, "TAP TO RETRY!", W / 2, H * 0.52, { size: 23, fill: PAL.tomato, rx: 136, ry: 40, seed: 77, rot: -0.05 + (reduced ? 0 : Math.sin(time * 5) * 0.06) });
    }
  }

  function render() {
    view.begin();
    drawBackdrop();
    drawWorld();
    drawHud();
    flash.draw(g, W, H);
  }

  // First frame, then ready().
  update(0);
  render();
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (++frames === 1) session.ready();
  });
  session.on("insets", () => logoPop.kick(2));
  session.on("end", () => {
    scorePop.kick(4);
  });
}

void main();
