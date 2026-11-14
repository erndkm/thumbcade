import fredokaBold from "@thumbcade-games/kit/assets/fonts/library/fredoka/Fredoka-Bold.woff2?url";
import fredokaSemi from "@thumbcade-games/kit/assets/fonts/library/fredoka/Fredoka-SemiBold.woff2?url";
import { createMusic } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, easeInCubic, easeOutBack, lerp } from "@thumbcade-games/kit/ease";
import { loadFontFaces } from "@thumbcade-games/kit/font-faces";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { clayText, dimple, drawFace, drawShelf, font, hash, makeHand, makeLumps, makePotBack, makePotFront, makePuff, makeSeal, makeStage, PAL, plaque, type Look, type Mood, type PotStyle, type Sprite } from "./art.ts";
import { KINDS, kindColor, kindDeep } from "./kinds.ts";
import { attractBoard, boardGeo, LIFT, lumpY, playFrame, potAt, UNIT_H, type Box, type Geo } from "./layout.ts";
import { act, Pilot, skillByName, SKILLS } from "./pilot.ts";
import { FULL, isSealed, moveCount, runLength, type Move } from "./rules.ts";
import { multiplier, Run, runSeed, TUNE, type RunEvent } from "./run.ts";
import { COPY, levelLine, newLump, partyLine, rewound, tierLine, wrap } from "./copy.ts";
import { createSounds } from "./sound.ts";
import { hintFor, tipFor } from "./tips.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;

/** Lumps are sculpted once at this width (CSS px) and drawn scaled. */
const ART = 64;
/** Stop-motion poses, one per 1/12 s (softbake's 12 fps): a pop-in, a landing (x, y scale) and a lift. */
const SQUISH = [0.35, 1.18, 0.92, 1.04, 1];
const LAND: ReadonlyArray<[number, number]> = [
  [1.3, 0.7],
  [0.88, 1.14],
  [1.07, 0.95],
  [0.98, 1.02],
];
const LIFTP: ReadonlyArray<[number, number]> = [
  [0.84, 1.22],
  [1.08, 0.93],
  [0.97, 1.03],
];

interface Flight {
  x0: number;
  y0: number;
  t: number;
  dur: number;
  arc: number;
}

interface Body {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pot: number;
  index: number;
  fly: Flight | null;
  landT: number;
  liftT: number;
  lifted: boolean;
  covered: boolean;
  revealT: number;
  /** Squash spring: + wide, - tall. */
  sq: number;
  sqv: number;
  born: number;
}

interface PotVis {
  x: number;
  y: number;
  vx: number;
  vy: number;
  sq: number;
  sqv: number;
  wig: number;
  born: number;
  style: PotStyle;
  cap: number;
  sealT: number;
  sealKind: number;
  hopT: number;
}

interface Leaving {
  kind: number;
  covered: boolean;
  x: number;
  y: number;
  t: number;
  pot: boolean;
  style: PotStyle;
  cap: number;
  sealKind: number;
}

interface SealFx {
  pot: number;
  kind: number;
  t: number;
  points: number;
  mult: number;
  stamped: boolean;
  patted: number;
}

interface Flyer {
  text: string;
  x: number;
  y: number;
  t: number;
  size: number;
  to: "score" | "clock";
  pts: number;
  fill: string;
}

interface Msg {
  text: string;
  fill: string;
  deep: string;
  hi: string;
  ink: string;
  t: number;
  life: number;
  kind: number;
}

const MSG = {
  cream: [PAL.cream, PAL.creamDeep, "#FFFDF6", PAL.chocDeep],
  butter: [PAL.butter, PAL.butterDeep, "#FFF0BF", PAL.chocDeep],
  sage: [PAL.sage, PAL.sageDeep, "#D4EBC7", PAL.chocDeep],
  salmon: [PAL.salmon, PAL.salmonDeep, "#FBC3B4", PAL.chocDeep],
  lavender: [PAL.lavender, PAL.lavenderDeep, "#E8DEFA", PAL.chocDeep],
  danger: [PAL.danger, PAL.dangerDeep, "#F6A08C", PAL.cream],
} as const;
type MsgColor = keyof typeof MSG;

async function main() {
  const [session] = await Promise.all([
    createSession({ id: "lumphop" }),
    loadFontFaces([
      { family: "Fredoka", url: fredokaBold, descriptors: { weight: "700" } },
      { family: "Fredoka", url: fredokaSemi, descriptors: { weight: "600" } },
    ]),
  ]);
  const reduced = session.reducedMotion;
  /** First-run teaching: 0 = never played, 1 = lifted and dropped, 2 = sealed a pot (done). */
  let taught = 0;
  try {
    const v = await tc.storage.get<number>("taught");
    if (typeof v === "number") taught = v;
  } catch {
    /* guests and offline: teach */
  }

  const view = createCanvas({ maxDpr: 2.5, background: PAL.wall });
  const g = view.ctx;
  let W = view.width;
  let H = view.height;
  let D = view.dpr;
  let stage: HTMLCanvasElement | null = null;
  let lumps: Sprite[][] = [];
  const potFront = new Map<string, Sprite>();
  const potBack = new Map<string, Sprite>();
  let seals: Sprite[] = [];
  let hand: Sprite | null = null;
  let puffSpr: Sprite | null = null;

  const frameNow = () => playFrame(W, H, session.play());
  function layout() {
    W = view.width;
    H = view.height;
    D = view.dpr;
    const k = Math.min(3, D);
    const f = frameNow();
    stage = makeStage(W, H, f.hud.y + f.hud.h + 6, H - 60, D);
    lumps = makeLumps(ART, k);
    potFront.clear();
    potBack.clear();
    for (const style of ["clay", "little", "spare"] as const) {
      potBack.set(style, makePotBack(ART, style, k));
      for (const cap of [2, 3, 4]) potFront.set(`${style}${cap}`, makePotFront(ART, style, cap, k));
    }
    seals = KINDS.map((_, i) => makeSeal(ART, kindColor(i), kindDeep(i), k));
    hand = makeHand(ART * 0.56, ART * 13, k);
    puffSpr = makePuff(k);
  }
  layout();
  view.onResize(layout);
  let playTop = session.play().top;
  session.on("insets", () => {
    if (session.play().top !== playTop) {
      playTop = session.play().top;
      layout();
    }
  });

  const snd = createSounds();
  const music = createMusic(snd.audio, { bpm: 96, wave: "triangle", volume: 0.028, steps: [57, null, 64, null, 60, null, 64, 67, 55, null, 62, null, 59, null, 62, 64] });
  const shake = new Shake(8, 0.016, 1.8, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2, decay: 0.45 });
  const crumbs = new Particles(500);
  const confetti = new Particles(260);
  const look: Look = { x: 0, y: 0, blink: 0, mood: "plain" };

  // ---------------------------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = session.ctx.dailySeed >>> 0;
  let demo = new Run(demoSeed, { demo: true, loopAfter: 3 });
  const demoSkill = { ...SKILLS[2]!, think: [0.55, 0.95] as [number, number], aim: [0.32, 0.5] as [number, number], careless: 0, slip: 0, plan: 0.7 };
  let demoPilot = new Pilot(demoSkill, createRng(demoSeed ^ 0x51));
  let run: Run = demo;
  let qaPilot: Pilot | null = null;
  let time = 0;
  let titleAge = 0;
  let stepN = 0;
  let stepAcc = 0;
  let bodies = new Map<number, Body>();
  let pots: PotVis[] = [];
  let leaving: Leaving[] = [];
  let sealFx: SealFx[] = [];
  let flyers: Flyer[] = [];
  let msgs: Msg[] = [];
  let banked = 0;
  let shown = 0;
  let scorePop = 0;
  let scorePopV = 0;
  let clockPop = 0;
  let clockPopV = 0;
  let streakPop = 0;
  let streakPopV = 0;
  let party: { t: number; level: number; points: number; time: number; spare: boolean } | null = null;
  let stuckT = -1;
  let lastInput = 0;
  let lastTap = { x: W / 2, y: H / 2 };
  let press: { id: number; x: number; y: number; t: number; pot: number; spare: boolean; playing: boolean } | null = null;
  let overT = -1;
  let endSent = false;
  let bestCheered = false;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string; levels: number; seals: number; streak: number } | null = null;
  let lastWhole = 99;
  let ghostMove: Move | null = null;
  let ghostKey = "";
  let ghostT = 0;
  let hintMove: Move | null = null;
  let hintKey = "";
  let geo: Geo = boardGeo(3, { x: 0, y: 0, w: W, h: H });
  let spareHeldT = 0;

  const playing = () => mode === "play" && session.phase === "playing" && overT < 0;
  const loud = () => mode === "play";

  function say(text: string, color: MsgColor = "cream", life = 1.5, kind = -1) {
    const [fill, deep, hi, ink] = MSG[color];
    // One at a time: a newer message takes over after a short beat.
    const cur = msgs[msgs.length - 1];
    if (cur && cur.text === text) {
      cur.t = Math.min(cur.t, 0.3);
      return;
    }
    msgs.push({ text, fill, deep, hi, ink, t: 0, life, kind });
    if (msgs.length > 3) msgs.shift();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Layout of the board for the run on screen
  // ---------------------------------------------------------------------------------------------------------------
  function titleBottom(): number {
    return session.preview().top + 8 + 64 + 12 + 62;
  }

  function boardBox(): Box {
    if (mode === "attract") return attractBoard(W, H, session.preview(), titleBottom());
    return frameNow().board;
  }

  function computeGeo() {
    geo = boardGeo(run.board.length, boardBox());
  }

  function potStyle(i: number): PotStyle {
    const p = run.board[i]!;
    return p.spare ? "spare" : p.cap < FULL ? "little" : "clay";
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------------------------------------------
  function clearVisuals(keepLeaving: boolean) {
    if (keepLeaving) {
      for (const b of bodies.values()) leaving.push({ kind: b.kind, covered: b.covered, x: b.x, y: b.y, t: -hash(b.id, 4) * 0.12, pot: false, style: "clay", cap: 4, sealKind: -1 });
      pots.forEach((p, i) => leaving.push({ kind: -1, covered: false, x: p.x, y: p.y, t: -0.05 - i * 0.03, pot: true, style: p.style, cap: p.cap, sealKind: p.sealT >= 0 ? p.sealKind : -1 }));
    } else leaving = [];
    bodies = new Map();
    pots = [];
    sealFx = [];
  }

  function newAttract() {
    mode = "attract";
    demoSeed = (Math.imul(demoSeed, 1664525) + 1013904223) >>> 0;
    demo = new Run(demoSeed, { demo: true, loopAfter: 3 });
    demoPilot = new Pilot(demoSkill, createRng(demoSeed ^ 0x51));
    run = demo;
    clearVisuals(false);
    computeGeo();
  }

  function startRun() {
    clearVisuals(true);
    mode = "play";
    run = new Run(runSeed(session.ctx.seed, session.runs));
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;
    computeGeo();
    flyers = [];
    msgs = [];
    party = null;
    stuckT = -1;
    banked = shown = 0;
    overT = -1;
    endSent = false;
    bestCheered = false;
    summary = null;
    lastWhole = 99;
    lastInput = time;
    ghostT = 0;
    spareHeldT = 0;
    crumbs.clear();
    confetti.clear();
    music.start();
    snd.deal();
    if (taught < 1) say(COPY.teachLift, "cream", 99);
  }

  session.startOnTap(window);
  session.on("start", startRun);
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (playing()) music.start();
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Input: a pot is pressed at once and acted on at release, so a swipe the feed claims never moves a lump. The
  // whole column above a pot is its tap area, and a near miss still counts.
  // ---------------------------------------------------------------------------------------------------------------
  function spareBox(): Box {
    const s = frameNow().strip;
    return { x: s.x + s.w - 146, y: s.y + 4, w: 146, h: s.h - 8 };
  }
  const inBox = (b: Box, x: number, y: number, pad = 6) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

  function tapPot(i: number) {
    lastInput = time;
    const evs = i === -2 ? run.useSpare() : i < 0 ? run.tapAway() : run.tap(i);
    for (const e of evs) handle(e);
  }

  view.canvas.addEventListener("pointerdown", (e) => {
    if (press) return;
    const x = e.clientX;
    const y = e.clientY;
    const isPlaying = playing();
    const spare = isPlaying && inBox(spareBox(), x, y);
    const pot = isPlaying && !spare ? potAt(geo, x, y) : -1;
    press = { id: e.pointerId, x, y, t: time, pot, spare, playing: isPlaying };
    lastTap = { x, y };
    snd.audio.unlock();
    // The press shows on the next frame: the pot gives a little under the thumb.
    if (pot >= 0 && pots[pot]) pots[pot]!.sqv += 2.2;
  });
  window.addEventListener("pointerup", (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    if (!p.playing || !playing()) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 26 || time - p.t > 0.7) return;
    if (p.spare) tapPot(-2);
    else tapPot(p.pot);
  });
  const cancel = () => {
    press = null;
  };
  window.addEventListener("pointercancel", cancel);
  session.on("cancel", cancel);

  // ---------------------------------------------------------------------------------------------------------------
  // Events -> juice
  // ---------------------------------------------------------------------------------------------------------------
  function potTop(i: number): number {
    const p = pots[i];
    if (!p) return H / 2;
    const n = run.board[i]?.units.length ?? 0;
    return lumpY(p.y, geo.U, Math.max(0, n - 1)) - geo.U * UNIT_H * 0.5;
  }

  function addFlyer(text: string, x: number, y: number, to: Flyer["to"], pts: number, size = 20, fill: string = PAL.butter) {
    for (let k = 0; k < 4 && flyers.some((f) => f.t < 0.4 && Math.abs(f.x - x) < 50 && Math.abs(f.y - y) < 22); k++) y -= 24;
    flyers.push({ text, x, y, t: 0, size, to, pts, fill });
  }

  function handle(e: RunEvent) {
    switch (e.type) {
      case "lift": {
        snd.lift(e.n, !loud());
        const p = pots[e.pot];
        if (p) p.sqv -= 3;
        if (loud() && taught < 1) say(COPY.teachDrop, "cream", 99);
        break;
      }
      case "retarget":
        snd.lift(e.n, !loud());
        snd.putBack();
        break;
      case "putBack":
        snd.putBack();
        break;
      case "nope": {
        const p = pots[e.pot];
        if (p) p.wig = time;
        snd.nope();
        if (loud() && e.why === "sealed") say(COPY.sealed, "cream", 1.1);
        if (loud() && e.why === "busy") say(COPY.busy, "cream", 1.3);
        break;
      }
      case "move":
        if (loud() && taught < 1) {
          taught = 1;
          tc.storage.set("taught", taught).catch(() => undefined);
          msgs = msgs.filter((m) => m.life < 50);
          say(COPY.teachSeal, "cream", 99);
        }
        break;
      case "reveal": {
        const b = bodies.get(e.id);
        if (b) b.revealT = time + 0.08;
        window.setTimeout(() => snd.reveal(), 80);
        break;
      }
      case "seal":
        sealFx.push({ pot: e.pot, kind: e.kind, t: -0.32, points: e.points, mult: e.mult, stamped: false, patted: 0 });
        if (loud() && e.tierUp) {
          streakPopV += 9;
          const f = frameNow();
          if (!reduced) confetti.emit(f.hud.x + 140, f.hud.y + 24, { count: 8 + e.mult * 4, speed: [120, 300], angle: [Math.PI * 0.05, Math.PI * 0.95], life: [0.5, 0.9], size: [3, 6], colors: [PAL.butter, PAL.salmon, PAL.lavender, PAL.cream], shape: "square", gravity: 500, drag: 1.4, spin: [-8, 8] });
          say(tierLine(e.mult), e.mult >= 4 ? "salmon" : e.mult >= 3 ? "lavender" : "butter", 1.4);
          window.setTimeout(() => snd.tier(e.mult), 380);
          session.feedback(e.mult >= 3 ? "success" : "tap");
        }
        if (loud() && taught < 2) {
          taught = 2;
          tc.storage.set("taught", taught).catch(() => undefined);
          msgs = msgs.filter((m) => m.life < 50);
        }
        break;
      case "clear":
        party = { t: -0.62, level: e.level, points: e.points, time: e.time, spare: e.spare };
        stuckT = -1;
        break;
      case "deal": {
        clearVisuals(true);
        computeGeo();
        snd.deal();
        if (loud()) {
          const fresh = e.fresh.filter((k) => e.level > 1 || k > 1);
          if (fresh.length) {
            say(newLump(fresh[0]!), "lavender", 1.6, fresh[0]!);
          } else say(levelLine(e.level), "cream", 1.1);
          if (run.board.some((p) => p.covered.some(Boolean)) && !seenCovered) {
            seenCovered = true;
            window.setTimeout(() => say(COPY.covered, "cream", 2.2), 1700);
          }
          if (run.board.some((p) => p.cap < FULL) && !seenLittle) {
            seenLittle = true;
            window.setTimeout(() => say(COPY.little, "cream", 2.4), 1700);
          }
        }
        break;
      }
      case "stuck":
        stuckT = time;
        snd.stuck();
        if (loud()) say(COPY.stuck, "danger", 1.2);
        break;
      case "help":
        stuckT = -1;
        if (e.how === "spare") {
          snd.spare();
          if (loud()) say(COPY.helpSpare, "sage", 1.6);
        } else {
          snd.rewind();
          if (loud()) say(e.how === "grace" ? COPY.grace : rewound(e.cost), e.how === "grace" ? "sage" : "salmon", 1.7);
          if (e.cost > 0) clockPopV -= 6;
        }
        if (loud()) session.feedback("tap");
        computeGeo();
        break;
      case "spare":
        snd.spare();
        computeGeo();
        if (loud()) say(COPY.spare, "sage", 1.4);
        break;
      case "over":
        overT = 0;
        snd.over();
        music.stop();
        say(COPY.over, "salmon", 99);
        shake.add(0.25);
        break;
    }
  }
  let seenCovered = false;
  let seenLittle = false;

  // ---------------------------------------------------------------------------------------------------------------
  // Visual sync: every lump follows its spot on the board; a lump that changed pots flies there on an arc.
  // ---------------------------------------------------------------------------------------------------------------
  function sync(dt: number) {
    const U = geo.U;
    const b = run.board;
    // Pots.
    while (pots.length < b.length) {
      const i = pots.length;
      const s = geo.spots[i]!;
      pots.push({ x: s.x, y: s.rim, vx: 0, vy: 0, sq: 0, sqv: 0, wig: -9, born: time + i * 0.04, style: potStyle(i), cap: b[i]!.cap, sealT: -1, sealKind: -1, hopT: -9 });
    }
    pots.length = b.length;
    for (let i = 0; i < pots.length; i++) {
      const p = pots[i]!;
      const s = geo.spots[i]!;
      p.vx += (-260 * (p.x - s.x) - 24 * p.vx) * dt;
      p.vy += (-260 * (p.y - s.rim) - 24 * p.vy) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.sqv += (-320 * p.sq - 16 * p.sqv) * dt;
      p.sq += p.sqv * dt;
      if (!isSealed(b[i]!) && p.sealT >= 0) p.sealT = -1;
    }
    // Lumps.
    const seen = new Set<number>();
    const heldRun = run.held >= 0 ? runLength(b[run.held]!) : 0;
    for (let pi = 0; pi < b.length; pi++) {
      const pot = b[pi]!;
      const pv = pots[pi]!;
      const ids = pot.ids ?? [];
      let moved = -1;
      for (let i = 0; i < pot.units.length; i++) {
        const id = ids[i]!;
        seen.add(id);
        const lifted = pi === run.held && i >= pot.units.length - heldRun;
        const tx = pv.x;
        let ty = lumpY(pv.y, U, i);
        if (lifted) ty -= LIFT * U + (reduced ? 0 : (stepN + i) % 4 < 2 ? 0 : 1.6);
        else if (press && press.pot === pi && run.held < 0 && i >= pot.units.length - runLength(pot)) ty -= U * 0.12;
        let body = bodies.get(id);
        if (!body) {
          // A lump dealt in: it drops into its pot from above.
          const delay = 0.12 + pi * 0.05 + i * 0.06;
          body = { id, kind: pot.units[i]!, x: tx, y: ty - U * 3.2 - i * U * 0.4, vx: 0, vy: 0, pot: pi, index: i, fly: null, landT: -9, liftT: -9, lifted: false, covered: pot.covered[i]!, revealT: -9, sq: 0, sqv: 0, born: time + delay };
          body.fly = { x0: body.x, y0: body.y, t: -delay, dur: 0.26, arc: 0 };
          bodies.set(id, body);
        } else if (body.pot !== pi) {
          // Moved: fly the whole run together, the lowest first.
          if (moved < 0) moved = i;
          const delay = (i - moved) * 0.04;
          const dist = Math.hypot(tx - body.x, ty - body.y);
          body.fly = { x0: body.x, y0: body.y, t: -delay, dur: clamp(0.17 + dist / 1500, 0.18, 0.34), arc: U * 0.55 + dist * 0.18 };
          body.pot = pi;
        }
        body.index = i;
        body.kind = pot.units[i]!;
        if (pot.covered[i] && !body.covered) {
          // A rewind can cover a lump again: show it the way the rules see it.
          body.covered = true;
          body.revealT = -9;
        }
        if (!pot.covered[i] && body.covered && body.revealT < 0) body.revealT = time;
        if (!pot.covered[i] && body.covered && time >= body.revealT) body.covered = false;
        if (lifted && !body.lifted) {
          body.liftT = time;
          body.vy -= 220;
        }
        body.lifted = lifted;
        if (body.fly) {
          const f = body.fly;
          f.t += dt;
          if (f.t < 0) continue;
          const u = clamp(f.t / f.dur);
          const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
          body.x = lerp(f.x0, tx, e);
          body.y = lerp(f.y0, ty, u * u * (f.arc > 0 ? 0.35 : 1) + (f.arc > 0 ? 0.65 * e : 0)) - f.arc * 4 * u * (1 - u);
          if (u >= 1) {
            body.fly = null;
            body.x = tx;
            body.y = ty;
            body.vx = body.vy = 0;
            if (!lifted) land(body, pi, i);
          }
          continue;
        }
        body.vx += (-420 * (body.x - tx) - 26 * body.vx) * dt;
        body.vy += (-420 * (body.y - ty) - 24 * body.vy) * dt;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.sqv += (-300 * body.sq - 14 * body.sqv) * dt;
        body.sq += body.sqv * dt;
      }
    }
    for (const [id] of bodies) if (!seen.has(id)) bodies.delete(id);
  }

  function land(body: Body, pi: number, i: number) {
    const U = geo.U;
    body.landT = time;
    const p = pots[pi];
    if (p) p.sqv += 2.5 + i * 0.3;
    // The lump below gives a little.
    const below = run.board[pi]?.ids?.[i - 1];
    if (below !== undefined) {
      const bb = bodies.get(below);
      if (bb) bb.sqv += 3;
    }
    snd.land(i, !loud() || time - body.born < 0.6);
    const col = kindColor(body.kind);
    crumbs.emit(body.x, body.y + U * 0.25, { count: reduced ? 2 : 5, speed: [40, 120], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.25, 0.55], size: [2, 3.5], colors: [col, kindDeep(body.kind), PAL.flour], shape: "circle", gravity: 520, drag: 1.5, spread: U * 0.25 });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The attract demo: the pilot plays the first levels under the title, through the same taps.
  // ---------------------------------------------------------------------------------------------------------------
  function stepDemo(dt: number) {
    const evs = demo.step(dt);
    for (const e of evs) handle(e);
    const pot = demoPilot.next(demo, dt);
    if (pot !== null) for (const e of act(demo, pot)) handle(e);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------------------------------------------
  function boardKey(): string {
    return run.board.map((p) => p.units.join("") + "/" + p.covered.map((c) => (c ? 1 : 0)).join("")).join("|") + `#${run.held}`;
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    titleAge += rawDt;
    stepAcc += rawDt;
    while (stepAcc >= 1 / 12) {
      stepAcc -= 1 / 12;
      stepN++;
    }
    const dt = hitStop.scale(rawDt);
    shake.update(rawDt);
    flash.update(rawDt);
    crumbs.update(dt);
    confetti.update(rawDt);

    if (dt > 0) {
      if (mode === "attract") stepDemo(dt);
      else if (playing()) {
        for (const e of run.step(dt)) handle(e);
        if (qaPilot && playing()) {
          const pot = qaPilot.next(run, dt);
          if (pot !== null) tapPot(pot);
        }
      } else if (mode === "play" && overT >= 0) {
        /* the run is over: nothing moves on the board but the faces */
      }
    }
    sync(Math.min(dt, 1 / 30));

    // Seal sequences: the hand comes down, pats twice, the stamp goes on.
    for (const s of sealFx) {
      const prev = s.t;
      s.t += rawDt;
      const p = pots[s.pot];
      if (!p) continue;
      const patAt = [2 / 12, 4 / 12];
      for (let k = 0; k < 2; k++) {
        if (prev < patAt[k]! && s.t >= patAt[k]!) {
          s.patted++;
          snd.pat(k === 1);
          const ids = run.board[s.pot]?.ids ?? [];
          ids.forEach((id, n) => {
            const bb = bodies.get(id);
            if (bb) bb.sqv += (k ? 5 : 8) * (0.6 + n * 0.15);
          });
          p.sqv += k ? 3 : 5;
          if (puffSpr && !reduced) puff(p.x, potTop(s.pot) - geo.U * 0.1, 3, geo.U * 0.3, 40);
        }
      }
      if (!s.stamped && s.t >= 0.4) {
        s.stamped = true;
        p.sealT = time;
        p.sealKind = s.kind;
        snd.stamp(s.mult);
        shake.add(0.06 + s.mult * 0.03);
        const col = kindColor(s.kind);
        crumbs.emit(p.x, p.y + geo.U * 0.3, { count: reduced ? 4 : 10 + s.mult * 3, speed: [80, 220], life: [0.4, 0.8], size: [2.5, 4.5], colors: [col, kindDeep(s.kind), PAL.cream, PAL.butter], shape: "circle", gravity: 500, drag: 1.4, spread: geo.U * 0.2 });
        if (loud()) {
          addFlyer(`+${s.points}`, p.x, potTop(s.pot) - geo.U * 0.5, "score", s.points, Math.min(28, 17 + s.mult * 2));
          addFlyer(`+${TUNE.sealTime}s`, p.x, potTop(s.pot) - geo.U * 0.05, "clock", 0, 15, PAL.sage);
          clockPopV += 4;
        }
      }
    }
    sealFx = sealFx.filter((s) => s.t < 7 / 12);

    // The level party.
    if (party) {
      const prev = party.t;
      party.t += rawDt;
      if (prev < 0 && party.t >= 0) {
        snd.clear(party.level);
        hitStop.freeze(reduced ? 0.03 : 0.12);
        shake.add(0.3);
        flash.trigger(PAL.flour, 0.8);
        if (loud()) {
          session.feedback("impact");
          addFlyer(`+${party.points}`, W / 2, frameNow().lane.y + 90, "score", party.points, 30);
          addFlyer(`+${party.time.toFixed(party.time % 1 ? 1 : 0)}s`, W / 2, frameNow().lane.y + 122, "clock", 0, 18, PAL.sage);
          clockPopV += 7;
        }
        pots.forEach((p, i) => {
          p.hopT = time + i * 0.07;
          if (!reduced) confetti.emit(p.x, p.y - geo.U, { count: loud() ? 12 : 5, speed: [160, 380], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [0.8, 1.4], size: [4, 7], colors: [PAL.butter, PAL.salmon, PAL.powder, PAL.lavender, PAL.sage, PAL.cream], shape: "square", gravity: 620, drag: 1.1, spin: [-8, 8] });
        });
      }
      if (party.t > 1.6) party = null;
    }

    // Leaving pieces pop away.
    for (const l of leaving) l.t += rawDt;
    if (leaving.length && leaving.every((l) => l.t > 0.3)) leaving = [];
    for (const f of flyers) f.t += rawDt;
    if (flyers.some((f) => f.t >= 0.75)) {
      flyers = flyers.filter((f) => {
        if (f.t < 0.75) return true;
        if (f.to === "score") {
          banked += f.pts;
          scorePopV += Math.min(9, 3 + f.pts / 80);
        } else clockPopV += 3;
        return false;
      });
    }
    if (mode === "play") {
      // Points without a flyer (a lump waking up) land at once; the rest when their flyer arrives.
      if (!flyers.some((f) => f.to === "score")) banked = run.score;
    }
    shown = shown < banked ? Math.min(banked, shown + Math.max(1, (banked - shown) * (1 - Math.exp(-9 * rawDt)))) : banked;
    scorePopV += (-300 * scorePop - 16 * scorePopV) * rawDt;
    scorePop += scorePopV * rawDt;
    clockPopV += (-300 * clockPop - 16 * clockPopV) * rawDt;
    clockPop += clockPopV * rawDt;
    streakPopV += (-300 * streakPop - 14 * streakPopV) * rawDt;
    streakPop += streakPopV * rawDt;
    for (const m of msgs) m.t += rawDt;
    msgs = msgs.filter((m) => m.t < m.life);

    if (mode === "play") {
      // New best, mid-run.
      const best = session.best;
      if (!bestCheered && best !== null && best > 0 && banked > best && overT < 0) {
        bestCheered = true;
        say(COPY.best, "butter", 1.8);
        snd.best();
        flash.trigger(PAL.butter, 0.6);
        session.feedback("success");
        if (!reduced) for (const side of [-1, 1]) confetti.emit(W / 2 + side * W * 0.42, H * 0.5, { count: 24, speed: [300, 600], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.5], size: [5, 8], colors: [PAL.butter, PAL.salmon, PAL.powder, PAL.lavender, PAL.sage], shape: "square", gravity: 700, drag: 1.2, spin: [-8, 8] });
      }
      // The last seconds tick.
      const whole = Math.ceil(run.clock);
      if (playing() && run.pause <= 0 && whole < lastWhole && whole <= 5 && whole > 0) snd.tick(whole);
      lastWhole = whole;
      if (run.spares > 0 && !run.spareOnBoard) spareHeldT += rawDt;
      else spareHeldT = 0;
      ghostT += rawDt;
      // The end: the faces squeeze shut, then the shell gets the score.
      if (overT >= 0 && !endSent) {
        overT += rawDt;
        if (overT > 0.6) {
          endSent = true;
          banked = run.score;
          flyers = [];
          const prevBest = session.best;
          const s = run.stats;
          const res = session.end(run.score, { stats: { levels: s.levels, seals: s.seals, streak: s.bestStreak, moves: s.moves, seconds: Math.round(s.seconds) } });
          summary = { score: run.score, isBest: res.isBest && run.score > 0, prevBest, tip: tipFor(s, run.spares), levels: s.levels, seals: s.seals, streak: s.bestStreak };
        }
      }
    }
    // Hints: the first run's ghost thumb, and the idle bob after that.
    const key = boardKey();
    if (mode === "play" && playing() && run.pause <= 0) {
      if (taught < 2 && key !== ghostKey) {
        ghostKey = key;
        ghostMove = run.held >= 0 ? hintFor(run, run.held) : run.hint();
        ghostT = 0;
      }
      if (taught >= 2 && time - lastInput > 3.4 && key !== hintKey) {
        hintKey = key;
        hintMove = run.held >= 0 ? hintFor(run, run.held) : run.hint();
      }
    }
    if (time - lastInput < 3.4) hintKey = "";
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------------------------
  let camX = 0;
  let camY = 0;

  function puff(x: number, y: number, n: number, size: number, speed: number) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      crumbs.emit(x, y, { count: 1, speed: [speed * 0.4, speed], angle: [a, a], life: [0.3, 0.5], size: [size * 0.6, size], colors: ["rgba(255,250,240,0.8)"], shape: "circle", drag: 3, gravity: -30 });
    }
  }

  /** A sprite at (x, y) with a tilt, a squash (sx, sy) and a scale; the bottom stays put when squashed. */
  function put(x: number, y: number, tilt: number, sx: number, sy: number, k: number) {
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    g.setTransform(D * k * sx * c, D * k * sx * s, -D * k * sy * s, D * k * sy * c, D * (x + camX), D * (y + camY));
  }
  function blit(s: Sprite) {
    g.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  }

  function drawPots(front: boolean) {
    const U = geo.U;
    const k = U / ART;
    for (let i = 0; i < pots.length; i++) {
      const p = pots[i]!;
      const pot = run.board[i];
      if (!pot) continue;
      const age = time - p.born;
      if (age < 0) continue;
      const n = Math.min(SQUISH.length - 1, Math.floor(age * 12));
      let pop = reduced || age > 0.42 ? 1 : SQUISH[n]!;
      const hop = time - p.hopT;
      let hy = 0;
      if (hop >= 0 && hop < 0.42 && !reduced) {
        const hn = Math.floor(hop * 12);
        hy = [0, -0.35, -0.5, -0.3, 0][Math.min(4, hn)]! * U;
        pop *= [1, 0.95, 1.04, 1, 1][Math.min(4, hn)]!;
      }
      const wig = time - p.wig < 0.35 && !reduced ? Math.sin((time - p.wig) * 40) * (1 - (time - p.wig) / 0.35) * U * 0.06 : 0;
      const sq = clamp(p.sq, -0.15, 0.15);
      const style = p.style;
      if (!front) {
        put(p.x + wig, p.y + hy, 0, pop * (1 + sq * 0.5), pop * (1 - sq), k);
        blit(potBack.get(style)!);
        continue;
      }
      put(p.x + wig, p.y + hy, wig * 0.01, pop * (1 + sq * 0.5), pop * (1 - sq), k);
      blit(potFront.get(`${style}${p.cap}`)!);
      // Filled dimples: one per lump inside, in the lumps' own colours.
      const sealed = p.sealT >= 0;
      if (!sealed) {
        for (let d = 0; d < p.cap; d++) {
          const [dx, dy] = dimple(ART, p.cap, d);
          if (d < pot.units.length) {
            g.fillStyle = pot.covered[d] ? "#CDBFAE" : kindColor(pot.units[d]!);
            g.beginPath();
            g.arc(dx, dy, ART * 0.036, 0, Math.PI * 2);
            g.fill();
          }
        }
      } else {
        const sa = time - p.sealT;
        const sn = Math.min(SQUISH.length - 1, Math.floor(sa * 12));
        const sk = reduced || sa > 0.42 ? 1 : SQUISH[sn]!;
        g.save();
        g.translate(0, ART * 0.34);
        g.scale(sk, sk);
        g.rotate(-0.08 + hash(i, 3) * 0.16);
        blit(seals[p.sealKind]!);
        // The kind's shape pressed into the seal, so it reads without colour.
        g.scale(0.36, 0.36);
        blit(lumps[p.sealKind + 1]![0]!);
        g.restore();
      }
    }
  }

  function moodFor(b: Body, sealedPot: boolean): Mood {
    if (b.covered) return "sleep";
    if (mode === "play" && overT >= 0) return "squeeze";
    if (sealedPot) return "happy";
    if (b.fly || b.lifted) return "wide";
    if (stuckT >= 0 || (mode === "play" && playing() && run.clock < 5)) return "worried";
    return "plain";
  }

  function drawLumps() {
    const U = geo.U;
    const k = U / ART;
    const half = (UNIT_H * U) / 2;
    const heldPot = run.held;
    const hx = heldPot >= 0 && pots[heldPot] ? pots[heldPot]!.x : lastTap.x;
    const hy = heldPot >= 0 && pots[heldPot] ? pots[heldPot]!.y - U * 2.2 : lastTap.y;
    // Draw bottom-up per pot so upper lumps sit on lower ones; flying lumps last.
    const order: Body[] = [];
    for (let pi = 0; pi < run.board.length; pi++) for (const id of run.board[pi]!.ids ?? []) {
      const b = bodies.get(id);
      if (b && !b.fly) order.push(b);
    }
    for (const b of bodies.values()) if (b.fly) order.push(b);
    for (const b of order) {
      if (b.fly && b.fly.t < 0) continue;
      const pv = pots[b.pot];
      const sealedPot = !!pv && pv.sealT >= 0 && !b.fly;
      // Squash: a stop-motion pose after a landing or a lift, then the spring.
      let sx = 1 + clamp(b.sq, -0.25, 0.3) * 0.6;
      let sy = 1 - clamp(b.sq, -0.25, 0.3);
      const la = time - b.landT;
      const li = time - b.liftT;
      if (!reduced && la >= 0 && la < LAND.length / 12) [sx, sy] = LAND[Math.floor(la * 12)]!;
      else if (!reduced && li >= 0 && li < LIFTP.length / 12) [sx, sy] = LIFTP[Math.floor(li * 12)]!;
      if (b.fly && !reduced) {
        const u = clamp(b.fly.t / b.fly.dur);
        sx *= 1 - 0.1 * Math.sin(u * Math.PI);
        sy *= 1 + 0.14 * Math.sin(u * Math.PI);
      }
      // Hand-animated jitter at 12 fps, and a second sculpt for the clay boil.
      const j = reduced ? 0 : 0.5;
      const jx = (hash(stepN, b.id) - 0.5) * j;
      const tilt = b.lifted && !reduced ? ((stepN + b.id) % 4 < 2 ? -0.035 : 0.035) : (hash(stepN >> 1, b.id * 3) - 0.5) * (reduced ? 0 : 0.025);
      const variant = reduced ? 0 : ((stepN >> 1) + b.id) & 1;
      const ra = time - b.revealT;
      const showPutty = b.covered || (ra >= 0 && ra < 0.08);
      let pop = 1;
      if (!reduced && ra >= 0 && ra < 0.42) pop = SQUISH[Math.min(SQUISH.length - 1, Math.floor(ra * 12))]!;
      const spr = lumps[showPutty ? 0 : b.kind + 1]![variant]!;
      const x = b.x + jx;
      const y = b.y + (1 - sy) * half;
      // Seal pats squash the stack from above.
      put(x, y, tilt, sx * pop, sy * pop, k);
      blit(spr);
      const dx = hx - b.x;
      const dy = hy - b.y;
      const d = Math.max(40, Math.hypot(dx, dy));
      look.x = b.lifted ? 0 : clamp(dx / d, -1, 1);
      look.y = b.lifted ? 0.8 : clamp(dy / d, -1, 1);
      const period = 2.6 + hash(b.id, 2) * 3.5;
      const ph = (time + hash(b.id, 5) * 9) % period;
      look.blink = ph < 0.12 ? Math.sin((ph / 0.12) * Math.PI) : 0;
      look.mood = moodFor(b, sealedPot);
      drawFace(g, showPutty ? -1 : b.kind, ART / 2, look);
    }
    // Lumps and pots of the last level popping away.
    for (const l of leaving) {
      if (l.t < 0) continue;
      const u = clamp(l.t / 0.2);
      if (u >= 1) continue;
      const s = (1 - u) * (1 + 0.3 * Math.sin(u * Math.PI));
      if (s <= 0.02) continue;
      put(l.x, l.y - u * 8, 0, s, s, k);
      if (l.pot) {
        blit(potBack.get(l.style)!);
        blit(potFront.get(`${l.style}${l.cap}`)!);
      } else blit(lumps[l.covered ? 0 : l.kind + 1]![0]!);
    }
  }

  function drawGlows() {
    // While a run is lifted, every pot that can take it glows at the rim.
    const U = geo.U;
    if (run.held < 0 || !run.accepting) return;
    const a = 0.45 + 0.3 * light.pulse(time, 1.4, { still: 0.6 });
    for (let i = 0; i < pots.length; i++) {
      if (i === run.held || moveCount(run.board, run.held, i) === 0) continue;
      const p = pots[i]!;
      g.setTransform(D, 0, 0, D, D * camX, D * camY);
      g.globalAlpha = a;
      g.strokeStyle = PAL.butter;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(p.x, p.y + U * 0.03, U * 0.62, U * 0.16, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = a * 0.5;
      g.setLineDash([3, 6]);
      g.beginPath();
      const top = run.board[i]!.units.length;
      const y = lumpY(p.y, U, top) - U * 0.1;
      g.moveTo(p.x, y - U * 0.25);
      g.lineTo(p.x, y + U * 0.15);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }

  function drawHands() {
    if (!hand) return;
    const U = geo.U;
    const k = U / ART;
    for (const s of sealFx) {
      if (s.t < 0) continue;
      const p = pots[s.pot];
      if (!p) continue;
      // Stop-motion: the hand moves in 1/12 s poses. Down, pat, up a little, pat, then away.
      const n = Math.floor(s.t * 12);
      const lift = [2.4, 0.9, 0, 0.45, 0, 0.7, 2.4][Math.min(6, n)]!;
      const top = potTop(s.pot);
      put(p.x + 2, top - lift * U, -0.06, 1, 1, k);
      blit(hand);
    }
  }

  function drawShelves() {
    g.setTransform(D, 0, 0, D, D * camX, D * camY);
    for (const sh of geo.shelves) drawShelf(g, sh.x0, sh.x1, sh.y, geo.U);
  }

  function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
  }

  function drawTimer(cx: number, cy: number) {
    const left = run.clock;
    const low = left < 6 && overT < 0;
    const pulse = low ? 0.5 + 0.5 * light.pulse(time, 2, { still: 1 }) : 0;
    const R = 25;
    g.save();
    g.translate(cx, cy);
    const pk = 1 + clamp(clockPop, -0.2, 0.3) * 0.25;
    g.scale(pk, pk);
    g.rotate(0.04);
    g.fillStyle = low ? PAL.dangerDeep : PAL.salmonDeep;
    g.beginPath();
    g.arc(0, 3, R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAL.cream;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    // The knob on top, as on a kitchen timer.
    g.fillStyle = low ? PAL.danger : PAL.salmon;
    g.beginPath();
    g.roundRect(-6, -R - 6, 12, 8, 3);
    g.fill();
    g.strokeStyle = "rgba(201,81,59,0.2)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, R - 6, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = low ? PAL.danger : PAL.sageDeep;
    g.lineCap = "round";
    g.globalAlpha = 1 - pulse * 0.4;
    g.beginPath();
    g.arc(0, 0, R - 6, -Math.PI / 2, -Math.PI / 2 + clamp(left / TUNE.clockMax) * Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    clayText(g, String(Math.max(0, Math.ceil(left))), 0, 0.5, 21, { fill: low ? PAL.dangerDeep : PAL.chocDeep, lip: "rgba(255,255,255,0.8)", lipY: 1.5 });
    g.restore();
  }

  function drawHud() {
    g.setTransform(D, 0, 0, D, 0, 0);
    if (mode !== "play") return;
    const f = frameNow();
    // Score.
    const sx = f.hud.x;
    const sy = f.hud.y;
    g.save();
    g.translate(sx + 58, sy + 24);
    const pop = 1 + clamp(scorePop, -0.2, 0.3) * 0.3;
    g.scale(pop, pop);
    g.rotate(-0.025);
    plaque(g, -58, -24, 116, 46, PAL.cream, PAL.creamDeep, "#FFFDF6", 16);
    clayText(g, fmt(shown), 0, -5, 23, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.7)", lipY: 1.5 });
    g.font = font(11, 600);
    g.fillStyle = PAL.choc;
    g.textAlign = "center";
    g.fillText(session.best !== null && session.best > 0 ? `best ${fmt(session.best)}` : "points", 0, 14);
    g.restore();
    // The streak: a bubble with the multiplier and a ring that runs out with the window.
    const since = run.t - run.lastSeal;
    if (run.streak >= 1 && since <= TUNE.streakWindow && overT < 0) {
      const m = multiplier(run.streak);
      const nextAt = TUNE.tiers.find((t) => t > run.streak);
      const bx = sx + 140;
      const by = sy + 24;
      g.save();
      g.translate(bx, by);
      g.rotate(0.05);
      const sp = 1 + clamp(streakPop, -0.2, 0.4) * 0.35;
      g.scale(sp, sp);
      g.fillStyle = PAL.butterDeep;
      g.beginPath();
      g.arc(0, 2.5, 19, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PAL.butter;
      g.beginPath();
      g.arc(0, 0, 19, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = PAL.chocDeep;
      g.lineWidth = 3;
      g.lineCap = "round";
      g.beginPath();
      g.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + (1 - since / TUNE.streakWindow) * Math.PI * 2);
      g.stroke();
      clayText(g, `×${m}`, 0, 0, 17, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.7)", lipY: 1.2 });
      g.restore();
      if (nextAt !== undefined) {
        g.font = font(11, 600);
        g.fillStyle = PAL.chocDeep;
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(`${nextAt - run.streak} more`, bx + 26, by - 6);
        g.fillText(`for ×${m + 1}`, bx + 26, by + 8);
      }
    }
    // Level, and the timer.
    const tx = f.hud.x + f.hud.w - 30;
    drawTimer(tx, sy + 27);
    g.save();
    g.translate(tx - 72, sy + 24);
    g.rotate(0.03);
    plaque(g, -38, -20, 76, 40, PAL.lavender, PAL.lavenderDeep, "#E8DEFA", 14);
    g.font = font(10, 600);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("level", 0, -8);
    clayText(g, String(run.level), 0, 7, 18, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.7)", lipY: 1.2 });
    g.restore();
    drawStrip();
    drawFlyers();
    confetti.draw(g);
    drawMsgs();
    drawParty();
    drawGhost();
    if (session.phase === "over") drawSummary();
  }

  /** The counter strip: every kind met this run (the rest wait as shadows), and the spare pots. */
  function drawStrip() {
    const f = frameNow();
    const y = f.strip.y + f.strip.h / 2;
    const n = KINDS.length;
    const sb = spareBox();
    const gap = Math.min(30, (sb.x - f.strip.x - 12) / n);
    for (let kd = 0; kd < n; kd++) {
      const got = run.seen.has(kd);
      const x = f.strip.x + 12 + gap * (kd + 0.5);
      const s = (gap * 0.82) / ART;
      g.setTransform(D * s, 0, 0, D * s, D * x, D * y);
      g.globalAlpha = got ? 1 : 0.22;
      blit(lumps[got ? kd + 1 : 0]![0]!);
      g.globalAlpha = 1;
    }
    g.setTransform(D, 0, 0, D, 0, 0);
    // Spare pots.
    const has = run.spares > 0 && !run.spareOnBoard;
    const nudge = has && spareHeldT > 6 && !reduced ? (stepN % 12 < 6 ? 0 : -2) : 0;
    g.save();
    g.translate(sb.x + sb.w / 2, sb.y + sb.h / 2 + nudge);
    g.globalAlpha = has ? 1 : 0.55;
    plaque(g, -sb.w / 2, -sb.h / 2, sb.w, sb.h, has ? PAL.sage : PAL.creamDeep, has ? PAL.sageDeep : "#D5BF9A", has ? "#D4EBC7" : PAL.cream, 16);
    const k = 26 / ART;
    g.save();
    g.translate(-sb.w / 2 + 24, 4);
    g.scale(k, k);
    blit(potBack.get("spare")!);
    blit(potFront.get("spare4")!);
    g.restore();
    g.font = font(14, 700);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(has ? `spare pot ×${run.spares}` : run.spareOnBoard ? "spare in use" : "no spare pot", -sb.w / 2 + 44, -6);
    g.font = font(10.5, 600);
    g.fillStyle = PAL.choc;
    g.fillText(has ? "tap for more room" : run.spareOnBoard ? "for this level" : "tidy a level for one", -sb.w / 2 + 44, 10);
    g.restore();
  }

  function drawFlyers() {
    const f = frameNow();
    for (const fl of flyers) {
      const hang = 0.35;
      let x = fl.x;
      let y = fl.y - Math.min(1, fl.t / hang) * 14;
      let s: number;
      if (fl.t > hang) {
        const u = easeInCubic(Math.min(1, (fl.t - hang) / 0.38));
        const toX = fl.to === "score" ? f.hud.x + 58 : f.hud.x + f.hud.w - 30;
        const toY = f.hud.y + 22;
        x = lerp(x, toX, u);
        y = lerp(y, toY, u) - Math.sin(u * Math.PI) * 28;
        s = 1 - u * 0.4;
      } else s = fl.t < 0.08 ? 0.5 + fl.t * 6 : 1;
      g.save();
      g.translate(x, y);
      g.scale(s, s);
      clayText(g, fl.text, 0, 0, fl.size, { fill: fl.fill, lip: PAL.chocDeep, outline: true });
      g.restore();
    }
  }

  function drawMsgs() {
    const m = msgs[msgs.length - 1];
    if (!m) return;
    const lane = frameNow().lane;
    const n = Math.floor(m.t * 12);
    const out = m.t > m.life - 0.25 ? Math.max(0, (m.life - m.t) / 0.25) : 1;
    const k = (reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n)]!) * out;
    if (k <= 0.02) return;
    let size = 15;
    g.font = font(size, 700);
    const iconW = m.kind >= 0 ? 30 : 0;
    const maxW = lane.w - 24 - iconW;
    while (size > 11 && g.measureText(m.text).width > maxW) g.font = font(--size, 700);
    const w = Math.min(lane.w, g.measureText(m.text).width + 30 + iconW);
    g.save();
    g.translate(lane.x + lane.w / 2 + (((stepN * 7) % 3) - 1) * (reduced ? 0 : 0.5), lane.y + lane.h / 2);
    g.scale(k, k);
    g.rotate(-0.015 + (((stepN * 5) % 3) - 1) * (reduced ? 0 : 0.006));
    plaque(g, -w / 2, -lane.h / 2 + 2, w, lane.h - 4, m.fill, m.deep, m.hi, 14);
    g.fillStyle = m.ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(m.text, iconW / 2, 0.5);
    if (m.kind >= 0) {
      const s = 26 / ART;
      g.translate(-w / 2 + 22, 1);
      g.scale(s, s);
      blit(lumps[m.kind + 1]![0]!);
    }
    g.restore();
  }

  function drawParty() {
    if (!party || party.t < 0 || !loud()) return;
    const t = party.t;
    const n = Math.floor(t * 12);
    const out = t > 1.35 ? Math.max(0, (1.6 - t) / 0.25) : 1;
    const k = (reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n)]!) * out;
    if (k <= 0.02) return;
    const lane = frameNow().lane;
    const cx = W / 2;
    const cy = lane.y + lane.h + 56;
    g.save();
    g.translate(cx, cy);
    g.scale(k, k);
    g.rotate(-0.03 + (((stepN * 5) % 3) - 1) * (reduced ? 0 : 0.008));
    plaque(g, -116, -42, 232, 84, PAL.butter, PAL.butterDeep, "#FFF4CC", 26);
    clayText(g, COPY.party, 0, -12, 32, { fill: PAL.cream, lip: PAL.chocDeep, lipY: 3 });
    g.font = font(14, 600);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "center";
    g.fillText(partyLine(party.level, party.spare), 0, 24);
    g.restore();
  }

  /** First run: a ghost thumb taps the pot to lift, then the pot to drop on, until the first seal. */
  function drawGhost() {
    if (taught >= 2 || !ghostMove || !playing() || run.pause > 0) return;
    const m = ghostMove;
    const target = run.held >= 0 ? m.to : m.from;
    const p = pots[target];
    if (!p) return;
    const cyc = 1.3;
    const u = (ghostT % cyc) / cyc;
    if (ghostT < 0.5) return;
    const x = p.x + 6;
    const y = potTop(target) + geo.U * 0.2;
    const press = u > 0.3 && u < 0.5;
    const lift = u > 0.5 ? clamp((u - 0.5) / 0.3) : 0;
    g.setTransform(D, 0, 0, D, 0, 0);
    g.save();
    g.globalAlpha = 0.9 * (u > 0.85 ? (1 - u) / 0.15 : 1);
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, press ? 18 : 14 + lift * 14, 0, Math.PI * 2);
    g.stroke();
    if (lift > 0) {
      g.globalAlpha *= 1 - lift;
      g.beginPath();
      g.arc(x, y, 20 + lift * 30, 0, Math.PI * 2);
      g.stroke();
    }
    // A clay fingertip coming in from the lower right, pressing on the beat.
    const fx = x + (press ? 4 : 10);
    const fy = y + (press ? 4 : 12) + lift * 8;
    g.globalAlpha = 0.92 * (u > 0.85 ? (1 - u) / 0.15 : 1);
    g.lineCap = "round";
    g.strokeStyle = PAL.skinDeep;
    g.lineWidth = 25;
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(fx + 46, fy + 62);
    g.stroke();
    g.strokeStyle = PAL.skin;
    g.lineWidth = 21;
    g.stroke();
    g.strokeStyle = "rgba(255,232,214,0.85)";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(fx - 4, fy + 4);
    g.lineTo(fx + 38, fy + 60);
    g.stroke();
    g.fillStyle = "rgba(255,238,230,0.95)";
    g.beginPath();
    g.ellipse(fx + 4, fy + 5, 7, 5, 0.93, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** The idle nudge: after a few quiet seconds the lump that should move next bobs. */
  function hintBob(id: number): number {
    if (reduced || taught < 2 || !hintMove || !playing() || time - lastInput < 3.4) return 0;
    const src = run.held >= 0 ? -1 : hintMove.from;
    if (src < 0) return 0;
    const ids = run.board[src]?.ids ?? [];
    const n = runLength(run.board[src]!);
    if (!ids.slice(ids.length - n).includes(id)) return 0;
    return stepN % 8 < 4 ? -geo.U * 0.12 : 0;
  }

  /**
   * What the run made, how it compares with the best, and one tip. In the feed the shell's result card covers the
   * middle and the caption the bottom, so this is a strip just above the caption.
   */
  function drawSummary() {
    const sm = summary;
    if (!sm || session.phaseTime < 0.35) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 16 : pv.left + 12;
    const right = W - (solo ? 16 : pv.right + 6);
    const w = right - left;
    const ph = 124;
    const topY = solo ? Math.round(H * 0.52) : H - pv.bottom - ph - 8;
    const k = easeOutBack(clamp((session.phaseTime - 0.35) / 0.4), 1.5);
    g.setTransform(D, 0, 0, D, 0, 0);
    g.save();
    g.translate(left + w / 2, topY + ph / 2);
    g.scale(k, k);
    g.rotate(-0.012);
    plaque(g, -w / 2, -ph / 2, w, ph, PAL.cream, PAL.creamDeep, "#FFFDF6", 20);
    const x0 = -w / 2 + 14;
    const cols = [
      ["levels", String(sm.levels)],
      ["pots sealed", String(sm.seals)],
      ["best streak", `×${multiplier(sm.streak)}`],
    ] as const;
    cols.forEach(([label, value], i) => {
      const cx = x0 + ((w - 28) * (i + 0.5)) / 3;
      g.font = font(11.5, 600);
      g.fillStyle = PAL.choc;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(label, cx, -ph / 2 + 16);
      g.font = font(18, 700);
      g.fillStyle = PAL.chocDeep;
      g.fillText(value, cx, -ph / 2 + 34);
    });
    const y0 = -ph / 2 + 52;
    const bw = w - 28;
    g.fillStyle = PAL.creamDeep;
    g.beginPath();
    g.roundRect(x0, y0, bw, 22, 11);
    g.fill();
    const prev = sm.prevBest;
    const frac = sm.score <= 0 ? 0 : sm.isBest || !prev ? 1 : clamp(sm.score / prev);
    const grow = Math.min(1, (session.phaseTime - 0.35) / 0.8);
    if (frac > 0.02) {
      g.fillStyle = sm.isBest ? PAL.sageDeep : "#C98160";
      g.beginPath();
      g.roundRect(x0 + 3, y0 + 3, Math.max(16, (bw - 6) * frac * grow), 16, 8);
      g.fill();
    }
    const label = sm.score <= 0 ? COPY.noScore : sm.isBest ? (prev ? `new best! +${fmt(sm.score - prev)}` : COPY.firstBest) : `${Math.round(frac * 100)}% of your best`;
    clayText(g, label, 0, y0 + 11, 13, { fill: PAL.cream, lip: PAL.chocDeep, lipY: 1.2 });
    // One tip for next time, on up to two lines.
    let size = 13;
    g.font = font(size, 600);
    const lines = wrap(sm.tip, 34);
    while (size > 10 && lines.some((l) => g.measureText(l).width > bw)) g.font = font(--size, 600);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "center";
    lines.forEach((l, i) => g.fillText(l, 0, ph / 2 - (lines.length === 1 ? 22 : 31) + i * 16));
    g.restore();
    if (solo && session.phaseTime > 0.8) {
      g.save();
      g.translate(W / 2, topY - 64);
      g.rotate(-0.04);
      clayText(g, fmt(sm.score), 0, 0, 52, { fill: PAL.butter, lip: PAL.chocDeep, lipY: 4 });
      g.restore();
      const n = stepN % 16 < 8 ? 0 : -3;
      g.save();
      g.translate(W / 2, topY + ph + 46 + (reduced ? 0 : n));
      plaque(g, -110, -24, 220, 48, PAL.salmon, PAL.salmonDeep, "#FBC3B4", 22);
      clayText(g, COPY.again, 0, -2, 21, { fill: PAL.cream, lip: PAL.chocDeep });
      g.restore();
    }
  }

  /** Attract: the title plaque with letters stuck on one by one, "tap to play!", the best, all inside the insets. */
  function drawAttract() {
    const ins = session.preview();
    const right = W - ins.right - 10;
    const aw = right - (ins.left + 14);
    const k = Math.min(1, aw / 280);
    const topY = ins.top + 8;
    const left = ins.left + 14 + (aw - 270 * k) / 2;
    const n = Math.min(SQUISH.length - 1, Math.floor(titleAge * 12));
    const sq = reduced ? 1 : SQUISH[n]!;
    const j = reduced ? 0.3 : 1;
    const wob = (s: number) => (hash(stepN, s) - 0.5) * 2 * j;
    g.setTransform(D, 0, 0, D, 0, 0);
    g.save();
    g.translate(left + wob(1), topY + wob(2));
    g.scale(k * sq, k * sq);
    g.rotate(-0.04 + wob(3) * 0.01);
    plaque(g, 0, 0, 270, 64, PAL.salmon, PAL.salmonDeep, "#F9C1B2", 24);
    const word = "Lumphop";
    g.font = font(44, 700);
    let total = 0;
    for (const ch of word) total += g.measureText(ch).width - 0.5;
    let x = (270 - total) / 2;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]!;
      const cw = g.measureText(ch).width;
      const bob = (stepN + i * 2) % 12 < 6 ? 0 : -1.5 * j;
      g.save();
      g.translate(x + cw / 2 + wob(10 + i) * 0.8, 33 + bob + wob(20 + i) * 0.8);
      g.rotate(((i % 3) - 1) * 0.05 + wob(30 + i) * 0.05);
      // "Lump" in cream, "hop" in butter, so the word reads as two.
      clayText(g, ch, 0, 0, 44, { fill: i < 4 ? PAL.cream : PAL.butter, lip: PAL.chocDeep, lipY: 3 });
      g.restore();
      x += cw - 0.5;
    }
    g.restore();
    if (session.best !== null && session.best > 0) {
      g.save();
      g.translate(left + 190 * k + wob(6), topY + 52 * k + wob(7));
      g.scale(k, k);
      g.rotate(-0.05);
      plaque(g, 0, 0, 86, 26, PAL.butter, PAL.butterDeep, "#FFF0BF", 12);
      g.font = font(12, 700);
      g.fillStyle = PAL.chocDeep;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`best ${fmt(session.best)}`, 43, 13);
      g.restore();
    }
    const by = topY + 64 * k + 12 + 31;
    const bounce = stepN % 16 < 8 ? 0 : -3 * j;
    g.save();
    g.translate(left + 135 * k + wob(8), by + bounce + wob(9));
    g.scale(k, k);
    g.rotate(0.02 + wob(11) * 0.02);
    plaque(g, -122, -31, 244, 62, PAL.cream, PAL.creamDeep, "#FFFDF6", 24);
    clayText(g, COPY.attractTap, 0, -9, 24, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.8)", lipY: 1.5 });
    g.font = font(13, 600);
    g.fillStyle = PAL.choc;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(COPY.attractSub, 0, 15);
    g.restore();
  }

  function render() {
    view.begin();
    if (stage) g.drawImage(stage, 0, 0, W, H);
    const o = shake.offset;
    camX = o.x;
    camY = o.y;
    drawShelves();
    drawPots(false);
    // Idle hint bobs are applied as a temporary offset.
    const bobbed: Array<[Body, number]> = [];
    for (const b of bodies.values()) {
      const dy = hintBob(b.id);
      if (dy) {
        b.y += dy;
        bobbed.push([b, dy]);
      }
    }
    drawLumps();
    for (const [b, dy] of bobbed) b.y -= dy;
    drawPots(true);
    drawGlows();
    g.setTransform(D, 0, 0, D, D * camX, D * camY);
    crumbs.draw(g);
    drawHands();
    g.setTransform(D, 0, 0, D, 0, 0);
    if (mode !== "play") drawAttract();
    drawHud();
    g.setTransform(D, 0, 0, D, 0, 0);
    flash.draw(g, W, H);
  }

  newAttract();
  view.onResize(() => computeGeo());
  session.on("insets", () => computeGeo());
  // Warm the demo so the first frame already shows a level in play.
  for (let t = 0; t < 2.6; t += 1 / 60) {
    stepDemo(1 / 60);
    sync(1 / 60);
  }
  update(0);
  render();
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (++frames === 2) session.ready();
  });
  session.on("attract", newAttract);
}

void main();
