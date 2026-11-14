import { createAudio, createMusic, midiToFreq, PENTATONIC } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, easeInCubic, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  CHERRY,
  dishPath,
  drawFace,
  faceSpot,
  INK,
  JADE,
  JADE_RAY,
  makeDish,
  makeGhost,
  makeGlove,
  makeJarGlass,
  makeLid,
  makeMagnet,
  makePeg,
  makeShelf,
  makeWallPanel,
  PAINTS,
  PEGS,
  type DishArt,
  type Mood,
} from "./art.ts";
import { WALL_H, WALL_W, type Wall } from "./board.ts";
import { Bits, burstSticker, drawSprite, font, hash, loadComicFont, makeHalftone, PAL, Pows, roundRectPath, setSpriteScale, sticker, stickerWord, textWidth, Wobble, type Sprite } from "./comic.ts";
import { DOCKS } from "./deal.ts";
import { PEG_R, toWorld, type Pose } from "./geom.ts";
import { attractFrame, blendFrames, playFrame, shelfSlot, toScreen, type Frame } from "./layout.ts";
import { lerpPose } from "./physics.ts";
import { apply, Pilot, skillByName, SKILLS, value, type Choice } from "./pilot.ts";
import { fitSize, tipFor } from "./copy.ts";
import { Run, runSeed, TIER_LINES, TUNE, type RunEvent } from "./run.ts";
import { S as SND } from "./sfx.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;
const TAU = Math.PI * 2;
/** Seconds a pulled peg spins in its hole before it flies, and the flight. */
const SPIN_T = 0.16;
const FLY_T = 0.3;
/** Near-miss reach of a tap, in wall units: a free peg this close is taken. */
const REACH = 0.62;
/** Seconds without a tap before the best peg bobs. */
const HINT_AFTER = 3;
const SMASH_WORDS = ["SMASH!", "KA-RASH!", "CRUNCH!", "KER-PLINK!", "BUSTED!", "SMITHEREENS!"];
const SHIP_WORDS = ["ORDER UP!", "TO GO!", "DING!", "SOLD!"];
const CLEAR_WORDS = ["WALL CLEAR!", "SPOTLESS!", "SQUEAKY CLEAN!", "CLEAN SWEEP!"];

interface VPeg {
  id: number;
  color: number;
  state: "wall" | "spin" | "fly" | "wait" | "shelf" | "jar";
  x: number;
  y: number;
  t: number;
  rot: number;
  fx: number;
  fy: number;
  /** Jar id it is headed for, or -1 for the shelf. */
  jar: number;
}

interface VJar {
  id: number;
  color: number;
  spot: number;
  rush: boolean;
  state: "wait" | "arrive" | "open" | "slam" | "leave";
  t: number;
  pegs: number[];
  shipped: boolean;
  squash: Wobble;
}

interface Shard {
  pts: Array<[number, number]>;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  w: number;
  t: number;
  color: string;
  floor: number;
  bounced: boolean;
}

interface Flyer {
  text: string;
  x: number;
  y: number;
  t: number;
  to: "score" | "clock";
  color: string;
  size: number;
}

interface Hand {
  phase: "idle" | "reach" | "press" | "lift";
  t: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  peg: number;
  choice: Choice | null;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "platterbang" }), loadComicFont()]);
  const reduced = session.reducedMotion;
  let taught = false;
  try {
    taught = (await tc.storage.get<boolean>("taught")) === true;
  } catch {
    /* guests and offline: teach */
  }

  const view = createCanvas({ maxDpr: 2.5, background: JADE });
  const g = view.ctx;
  let W = view.width;
  let H = view.height;
  let D = view.dpr;

  const audio = createAudio();
  const BASS = [43, null, 50, null, 55, 50, 52, null, 45, null, 52, null, 57, 52, 55, null, 41, null, 48, null, 53, 48, 50, null, 43, null, 50, 55, 47, null, 50, null];
  const HOT_BASS = [55, 62, 55, 62, 57, 64, 57, 64, 53, 60, 53, 60, 55, 62, 59, 66];
  const music = createMusic(audio, { bpm: 126, wave: "triangle", volume: 0.04, steps: BASS });
  const shake = new Shake(10, 0.022, 1.9, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.16, decay: 0.45 });
  const dust = new Particles(420);
  const bits = new Bits(220);
  const pows = new Pows(reduced);
  const hudPows = new Pows(reduced);
  const scorePop = new Wobble(300, 11);
  const clockPop = new Wobble(320, 10);
  const titlePop = new Wobble(200, 9);
  const multPop = new Wobble(300, 10);
  const magnetPop = new Wobble(280, 9);

  // -------------------------------------------------------------------------------------------------------------
  // Layout and sprites
  // -------------------------------------------------------------------------------------------------------------
  const TITLE_H = 120;
  let fPlay: Frame = playFrame(W, H, session.play());
  let fAttract: Frame = attractFrame(W, H, session.preview(), TITLE_H);
  let F: Frame = fAttract;
  let layoutK = 0;
  let layoutTarget = 0;
  let U = fPlay.u;
  let pegSpr: Sprite[] = [];
  let ghostSpr: Sprite[] = [];
  let lidSpr: Sprite[] = [];
  let glassSpr: Sprite | null = null;
  let shelfSpr: Sprite | null = null;
  let shelfSlots = 0;
  let magnetOn: Sprite | null = null;
  let magnetOff: Sprite | null = null;
  let glove: Sprite | null = null;
  let panel: { spr: Sprite; u: number } | null = null;
  let halftone: HTMLCanvasElement | null = null;
  let dishArt: Map<number, DishArt> = new Map();
  /** Pegs on lower layers that sit under a dish's face (its face hides while one of them is still there). */
  let faceBlock: Map<number, number[]> = new Map();
  let artWall: Wall | null = null;

  function layout() {
    W = view.width;
    H = view.height;
    D = view.dpr;
    setSpriteScale(D);
    fPlay = playFrame(W, H, session.play());
    fAttract = attractFrame(W, H, session.preview(), TITLE_H);
    U = fPlay.u;
    const k = Math.min(3, D * 1.1);
    pegSpr = PEGS.map((_, i) => makePeg(i, PEG_R * U, k));
    ghostSpr = PEGS.map((_, i) => makeGhost(i, PEG_R * U, k));
    lidSpr = PEGS.map((_, i) => makeLid(i, fPlay.jars[0]!.w, k));
    glassSpr = makeJarGlass(fPlay.jars[0]!.w, fPlay.jars[0]!.h, k);
    shelfSpr = null;
    magnetOn = makeMagnet(36, k, true);
    magnetOff = makeMagnet(36, k, false);
    glove = makeGlove(U * 0.78, k);
    panel = { spr: makeWallPanel(WALL_W * U, (WALL_H + 0.66) * U, U, (WALL_H + 0.34) * U, Math.min(2, D)), u: U };
    const hd = Math.min(D, 1.5);
    halftone = makeHalftone(W * hd, H * hd, 15 * hd, PAL.white, (x, y) => clamp(0.06 + y * y * 0.6 + Math.abs(x - 0.5) * 0.35, 0, 0.85));
    artWall = null;
  }
  layout();
  view.onResize(layout);
  let insetKey = "";
  session.on("insets", () => {
    const key = JSON.stringify([session.play(), session.preview()]);
    if (key !== insetKey) {
      insetKey = key;
      layout();
    }
  });

  function ensureDishArt(wall: Wall) {
    if (artWall === wall) return;
    artWall = wall;
    dishArt = new Map();
    const k = Math.min(2.5, D);
    faceBlock = new Map();
    for (const d of wall.dishes) {
      const holes = d.pegs.map((id) => [wall.pegs[id]!.lx, wall.pegs[id]!.ly] as const);
      dishArt.set(d.id, makeDish(d, holes, U, k));
      if (!d.face) continue;
      const f = faceSpot(d.shape);
      const [fx, fy] = toWorld(d.base, f.x, f.y);
      faceBlock.set(
        d.id,
        wall.pegs.filter((p) => wall.dishes[p.dish]!.layer < d.layer && Math.hypot(p.x - fx, p.y - fy) < f.r + PEG_R).map((p) => p.id),
      );
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = session.ctx.dailySeed >>> 0;
  let demo = new Run(demoSeed ^ 0x0d15);
  let demoPilot = new Pilot({ ...SKILLS[2]!, name: "demo", think: [0.75, 1.15], careless: 0, fumble: 0 }, createRng(demoSeed ^ 0xbead));
  let run: Run | null = null;
  let qaPilot: Pilot | null = null;
  let time = 0;
  let titleIn = 0;
  let vpegs = new Map<number, VPeg>();
  let vjars: VJar[] = [];
  let shards: Shard[] = [];
  let flyers: Flyer[] = [];
  let falling: Array<{ run: Run; until: number }> = [];
  let dealAt = new Float32Array(32);
  let pegAt = new Float32Array(64);
  let wiggleAt = new Float32Array(64).fill(-10);
  let bumpAt = new Float32Array(32).fill(-10);
  let shownScore = 0;
  let lastInput = 0;
  let ended = false;
  let endT = 0;
  let endSent = false;
  let isBest = false;
  let passedBest = false;
  let summary: { score: number; prevBest: number | null; isBest: boolean; tip: string } | null = null;
  let lastWhole = 99;
  let msg: { text: string; t: number; life: number; fill: string } | null = null;
  let press: { pointer: number; peg: number; x: number; y: number; t: number } | null = null;
  let finger: { x: number; y: number } | null = null;
  let teach = { pulled: false, shelf: false, swing: false, drop: false };
  let ghostT = 0;
  let overWord = "";
  let dangerSaid = 0;
  const hand: Hand = { phase: "idle", t: 0, x: 0, y: 0, sx: 0, sy: 0, peg: -1, choice: null };
  const poseTmp: Pose = { x: 0, y: 0, th: 0 };

  const shown = (): Run => (mode === "play" && run ? run : demo);
  const inPlay = () => mode === "play" && session.phase === "playing" && run !== null && run.live && !ended;
  const loud = (r: Run) => r === run && mode === "play";

  function say(text: string, fill: string = PAL.white, life = 1.6) {
    msg = { text, t: 0, life, fill };
  }

  /** Resets the drawn pieces for the wall that `r` has up now. */
  function resetShow(r: Run, delay: number) {
    const wall = r.wall;
    ensureDishArt(wall);
    vpegs = new Map();
    for (const p of wall.pegs) vpegs.set(p.id, { id: p.id, color: p.color, state: "wall", x: 0, y: 0, t: 0, rot: 0, fx: 0, fy: 0, jar: -1 });
    vjars = [];
    dealAt = new Float32Array(Math.max(32, wall.dishes.length));
    pegAt = new Float32Array(Math.max(64, wall.pegs.length));
    wiggleAt = new Float32Array(Math.max(64, wall.pegs.length)).fill(-10);
    bumpAt = new Float32Array(Math.max(32, wall.dishes.length)).fill(-10);
    const order = [...wall.dishes].sort((a, b) => a.layer - b.layer || a.base.y - b.base.y);
    order.forEach((d, i) => {
      dealAt[d.id] = time + delay + (reduced ? 0 : i * 0.05 + d.layer * 0.08);
      d.pegs.forEach((id, k) => (pegAt[id] = dealAt[d.id]! + 0.22 + k * 0.05));
    });
    r.docks.forEach((j, slot) => {
      if (j) vjars.push({ id: j.id, color: j.color, spot: slot, rush: false, state: "arrive", t: -delay - slot * 0.1, pegs: [], shipped: false, squash: new Wobble(320, 10) });
    });
  }

  function newDemo() {
    demoSeed = (demoSeed * 1664525 + 1013904223) >>> 0;
    demo = new Run(demoSeed ^ 0x0d15);
    demoPilot = new Pilot({ ...SKILLS[2]!, name: "demo", think: [0.75, 1.15], careless: 0, fumble: 0 }, createRng(demoSeed ^ 0xbead));
    hand.phase = "idle";
    if (mode === "attract") resetShow(demo, 0.1);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: a peg squishes under the finger at once and spins out on release (so a swipe the feed takes never pulls
  // one). A tap that just misses a free peg still takes it.
  // -------------------------------------------------------------------------------------------------------------
  function pegAtPoint(r: Run, x: number, y: number): number {
    const wx = (x - F.wx) / F.u;
    const wy = (y - F.wy) / F.u;
    let best = -1;
    let bd = REACH;
    let cover = -1;
    let cd = 0.5;
    for (const p of r.wall.pegs) {
      if (!r.left[p.id]) continue;
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bd && r.isFree(p.id)) {
        bd = d;
        best = p.id;
      } else if (d < cd) {
        cd = d;
        cover = p.id;
      }
    }
    // A covered peg right under the finger only wins over a free one that's clearly farther away.
    if (best >= 0 && cover >= 0 && cd < PEG_R && bd > PEG_R * 2.2) return cover;
    return best >= 0 ? best : cover;
  }

  const within = (b: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;

  window.addEventListener("pointerdown", (e) => {
    finger = { x: e.clientX, y: e.clientY };
    if (!inPlay() || !run || press) return;
    lastInput = time;
    const peg = within(F.magnet, e.clientX, e.clientY) ? -2 : pegAtPoint(run, e.clientX, e.clientY);
    press = { pointer: e.pointerId, peg, x: e.clientX, y: e.clientY, t: time };
    if (peg >= 0) audio.play(SND.press, { volume: 0.8 });
  });
  window.addEventListener("pointermove", (e) => {
    if (finger) finger = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", (e) => {
    finger = null;
    if (!press || e.pointerId !== press.pointer) return;
    const p = press;
    press = null;
    if (!inPlay() || !run) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 26) return;
    lastInput = time;
    if (p.peg === -2) useMagnet();
    else if (p.peg >= 0) run.tap(p.peg);
  });
  const cancel = () => {
    press = null;
    finger = null;
  };
  window.addEventListener("pointercancel", cancel);
  session.on("cancel", cancel);
  session.startOnTap(window);
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (inPlay()) music.start();
  });

  function useMagnet() {
    if (!run) return;
    if (run.magnets <= 0) {
      say("CLEAR A WALL FOR A MAGNET!", PAL.bananaHi, 1.6);
      audio.play(SND.bonk, { volume: 0.6 });
      magnetPop.kick(3);
      return;
    }
    if (run.shelf.length === 0) {
      say("THE SHELF IS EMPTY!", PAL.white, 1.3);
      magnetPop.kick(2);
      return;
    }
    run.useMagnet();
  }

  // -------------------------------------------------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------------------------------------------------
  session.on("start", () => {
    // The demo's dishes drop off the wall as the run's are hung.
    for (const d of demo.wall.dishes) {
      const b = demo.phys.bodies[d.id]!;
      if (b.state === "pinned" || b.state === "hanging") demo.phys.drop(d);
    }
    falling.push({ run: demo, until: time + 1.2 });
    mode = "play";
    layoutTarget = 1;
    run = new Run(runSeed(session.ctx.seed, session.runs));
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;
    resetShow(run, 0.35);
    shownScore = 0;
    ended = false;
    endT = 0;
    endSent = false;
    isBest = false;
    passedBest = false;
    summary = null;
    lastWhole = 99;
    msg = null;
    flyers = [];
    lastInput = time;
    dangerSaid = 0;
    teach = { pulled: taught, shelf: taught, swing: taught, drop: taught };
    ghostT = -0.6;
    music.setSteps(BASS);
    music.start();
    audio.play(SND.whistleUp, { volume: 0.7 });
    if (!taught) say("TAP A PEG!", PAL.bananaHi, 99);
  });

  function finish(r: Run) {
    ended = true;
    endT = 0;
    press = null;
    music.stop();
    const best = session.best;
    isBest = r.score > 0 && (best === null || r.score > best);
    overWord = r.over === "full" ? "SHELF'S FULL!" : "CLOSING TIME!";
    hudPows.burst(overWord, W / 2, F.wy + F.u * 2.6, { size: fitSize(overWord, 34, W - 96), fill: PAL.tomato, life: 1.5 });
    audio.play(r.over === "full" ? SND.warn : SND.buzzer);
    window.setTimeout(() => audio.play(SND.bell, { pitch: -5 }), 260);
    shake.add(0.3);
    // Whatever is still on the wall comes down, one dish after another.
    const left = r.wall.dishes.filter((d) => r.phys.bodies[d.id]!.state !== "gone" && r.phys.bodies[d.id]!.state !== "falling");
    left.sort((a, b) => b.layer - a.layer);
    left.forEach((d, i) => {
      window.setTimeout(() => {
        if (run !== r) return;
        const b = r.phys.bodies[d.id]!;
        if (b.state === "pinned" || b.state === "hanging") r.phys.drop(d);
      }, 380 + i * (reduced ? 40 : 90));
    });
    summary = { score: r.score, prevBest: best, isBest, tip: tipFor(r.stats, r.over ?? "time", r.magnets) };
  }

  // -------------------------------------------------------------------------------------------------------------
  // Events -> juice
  // -------------------------------------------------------------------------------------------------------------
  const pegScreen = (r: Run, id: number): [number, number] => {
    const p = r.wall.pegs[id]!;
    return toScreen(F, p.x, p.y);
  };

  function spotPos(spot: number): { x: number; y: number; w: number; h: number } {
    return F.jars[Math.min(F.jars.length - 1, spot)]!;
  }

  /** Where a jar is drawn now (bottom centre), and its scale. */
  function jarPos(j: VJar): { x: number; y: number; k: number; alpha: number } {
    const s = spotPos(j.spot);
    const k = s.w / fPlay.jars[0]!.w;
    const dir = j.rush || s.x > W / 2 ? 1 : -1;
    switch (j.state) {
      case "wait":
        return { x: s.x, y: s.y, k: k * 0.2, alpha: 0 };
      case "arrive": {
        const u = clamp(j.t / 0.32);
        if (j.rush) return { x: lerp(W + s.w, s.x, easeOutBack(u, 1.3)), y: s.y, k, alpha: 1 };
        // Pops in on its spot with a bounce (never crossing the HUD).
        return { x: s.x, y: s.y - (1 - u) * 26, k: k * (0.2 + 0.8 * easeOutBack(u, 2.2)), alpha: u > 0 ? 1 : 0 };
      }
      case "leave": {
        const u = clamp(j.t / 0.34);
        return { x: s.x + dir * easeInCubic(u) * (W * 0.7), y: s.y - Math.sin(u * Math.PI) * 18, k, alpha: 1 };
      }
      default:
        return { x: s.x, y: s.y, k, alpha: 1 };
    }
  }

  /** Where a peg sits in a jar (slot 0 at the bottom). */
  function inJar(j: VJar, slot: number): [number, number] {
    const p = jarPos(j);
    const s = spotPos(j.spot);
    return [p.x, p.y - s.h * (0.16 + slot * 0.2)];
  }

  function emitCrash(x: number, y: number, size: number, color: string) {
    dust.emit(x, y, { count: reduced ? 4 : 10 + Math.round(size * 4), speed: [40, 160], angle: [-Math.PI, 0], life: [0.4, 0.8], size: [8, 18], colors: [PAL.cream, PAL.white, "#EADFC4"], gravity: -40, drag: 2.4, shape: "circle", spread: size * 10, endScale: 1.6 });
    bits.emit(x, y, { count: reduced ? 2 : 6, speed: [120, 320], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.8], size: [5, 9], colors: [color, PAL.white], shape: "confetti", gravity: 900, drag: 1.2 });
  }

  /** Breaks a landed dish into inked shards (wedges, each split again across) that burst up off the counter. */
  function smash(r: Run, dish: number, x: number) {
    const d = r.wall.dishes[dish]!;
    const b = r.phys.bodies[dish]!;
    const n = reduced ? 4 : 9;
    const out = d.out;
    const per = Math.max(1, Math.floor(out.length / n));
    const paint = d.fancy ? "#FFFFFF" : PAINTS[d.paint % PAINTS.length]!.body;
    const rim = d.fancy ? PAL.banana : PAINTS[d.paint % PAINTS.length]!.well;
    const cx = d.mass.cx;
    const cy = d.mass.cy;
    for (let k = 0; k < n; k++) {
      const arc: Array<[number, number]> = [];
      for (let i = k * per; i <= (k + 1) * per; i++) arc.push(out[i % out.length]!);
      // Split the wedge at 55 % of its radius: an inner piece and an outer (rim) piece.
      const mid = arc.map(([px, py]) => [cx + (px - cx) * 0.55, cy + (py - cy) * 0.55] as [number, number]);
      const pieces: Array<{ pts: Array<[number, number]>; color: string }> = [
        { pts: [[cx, cy], ...mid], color: paint },
        { pts: [...mid, ...arc.slice().reverse()], color: k % 2 ? rim : paint },
      ];
      for (const [pi, pc] of pieces.entries()) {
        if (reduced && pi === 0) continue;
        const wpts = pc.pts.map(([lx, ly]) => toWorld(b.pose, lx, ly));
        let mx = 0;
        let my = 0;
        for (const [px, py] of wpts) {
          mx += px;
          my += py;
        }
        mx /= wpts.length;
        my /= wpts.length;
        const [sx, sy] = toScreen(F, mx, my);
        const local = wpts.map(([px, py]) => [(px - mx) * F.u, (py - my) * F.u] as [number, number]);
        const a = ((k + 0.5) / n) * TAU + b.pose.th;
        const sp = 160 + hash(k * 2 + pi, dish) * 260;
        shards.push({
          pts: local,
          x: sx,
          y: Math.min(sy, F.floor - 4),
          vx: Math.cos(a) * sp * 0.9,
          vy: -Math.abs(Math.sin(a)) * sp * 0.5 - 220 - hash(k + 9, dish) * 240,
          rot: 0,
          w: (hash(k, dish + 3 + pi) - 0.5) * 22,
          t: 0,
          color: pc.color,
          floor: F.floor,
          bounced: false,
        });
      }
    }
    if (shards.length > 90) shards.splice(0, shards.length - 90);
    const size = Math.min(1.6, (d.mass.area / 3) ** 0.5);
    emitCrash(x, F.floor, size, paint);
    const lv = loud(r) ? 1 : 0.35;
    audio.play(SND.crash, { volume: lv * (0.7 + size * 0.25), pitch: (hash(dish, 5) - 0.5) * 4 - size * 2 });
    audio.play(SND.tinkle, { volume: lv, pitch: (hash(dish, 7) - 0.5) * 5 });
    audio.play(SND.thud, { volume: lv * 0.7 });
    if (loud(r)) {
      shake.add(0.14 + size * 0.08 + (d.fancy ? 0.15 : 0));
      if (size > 1.1 || d.fancy) hitStop.freeze(reduced ? 0 : 0.045);
      const word = d.fancy ? "THE GOOD CHINA!" : SMASH_WORDS[Math.min(SMASH_WORDS.length - 1, Math.max(0, r.mult - 1 + (hash(dish, 2) < 0.4 ? 1 : 0)))]!;
      pows.burst(word, clamp(x, F.L + 70, F.R - 70), F.floor - F.u * 0.9, { size: d.fancy ? 18 : 15 + Math.min(6, r.mult * 1.5), fill: d.fancy ? PAL.banana : [PAL.white, PAL.bananaHi, PAL.bubblegumHi, PAL.limeHi][dish % 4]!, life: 0.7 });
    }
  }

  function onEvents(r: Run) {
    const evs = r.events;
    const lv = loud(r) ? 1 : 0.35;
    for (const e of evs) handle(r, e, lv);
    evs.length = 0;
  }

  function handle(r: Run, e: RunEvent, lv: number) {
    const play = loud(r);
    switch (e.type) {
      case "pull": {
        const v = vpegs.get(e.peg);
        if (!v) break;
        const [x, y] = pegScreen(r, e.peg);
        v.state = "spin";
        v.t = 0;
        v.x = x;
        v.y = y;
        v.jar = e.dest.to === "jar" ? e.dest.jar : -1;
        audio.play(SND.squeak, { volume: lv, pitch: (hash(e.peg, 3) - 0.5) * 3 });
        dust.emit(x, y, { count: reduced ? 2 : 6, speed: [30, 110], life: [0.25, 0.5], size: [4, 8], colors: [PAL.cream, PAL.white], drag: 3, shape: "circle", endScale: 1.4 });
        if (play) {
          lastInput = time;
          if (!teach.pulled) {
            teach.pulled = true;
            say(e.dest.to === "jar" ? "INTO THE MATCHING JAR!" : "NO JAR? IT WAITS ON THE SHELF!", PAL.bananaHi, 2.2);
            if (e.dest.to === "shelf") teach.shelf = true;
          } else if (!teach.shelf && e.dest.to === "shelf") {
            teach.shelf = true;
            say("NO JAR? IT WAITS ON THE SHELF!", PAL.bananaHi, 2.2);
          }
          if (e.dest.to === "shelf") {
            const n = r.shelf.length;
            if (n >= r.shelfCap && dangerSaid < 2) {
              dangerSaid = 2;
              say("SHELF'S FULL! PICK A JAR COLOUR!", PAL.tomato, 2);
              audio.play(SND.warn);
            } else if (n === r.shelfCap - 1 && dangerSaid < 1) {
              dangerSaid = 1;
              say("ALMOST FULL!", PAL.bananaHi, 1.4);
            }
          } else if (r.shelf.length < r.shelfCap - 1) dangerSaid = 0;
        }
        break;
      }
      case "covered": {
        wiggleAt[e.peg] = time;
        for (const d of e.by) bumpAt[d] = time;
        audio.play(SND.bonk, { volume: lv });
        if (play) {
          const [x, y] = pegScreen(r, e.peg);
          pows.float("STUCK!", x, y - 18, { size: 14, textFill: PAL.white, life: 0.6 });
          if (r.stats.coveredTaps === 1 || r.stats.coveredTaps % 4 === 0) say("A DISH IS ON TOP OF IT!", PAL.white, 1.4);
        }
        break;
      }
      case "swing":
        audio.play(SND.creak, { volume: lv, pitch: (hash(e.dish, 1) - 0.5) * 6 });
        if (play && !teach.swing) {
          teach.swing = true;
          say("ONE PEG LEFT: IT SWINGS!", PAL.white, 1.8);
        }
        break;
      case "drop": {
        audio.play(SND.whee, { volume: lv * 0.8, pitch: (hash(e.dish, 4) - 0.5) * 4 });
        if (play) {
          const b = r.phys.bodies[e.dish]!;
          const [x, y] = toScreen(F, b.cx, b.cy);
          flyers.push({ text: `+${e.points}`, x, y, t: 0, to: "score", color: e.fancy ? PAL.banana : PAL.white, size: e.fancy ? 22 : 17 });
          flyers.push({ text: `+${TUNE.dropTime}s`, x: x + 24, y: y + 20, t: -0.08, to: "clock", color: PAL.limeHi, size: 13 });
          if (!teach.drop) {
            teach.drop = true;
            say("NO PEGS LEFT: SMASH!", PAL.bananaHi, 1.8);
          }
        }
        break;
      }
      case "land":
        smash(r, e.dish, F.wx + e.x * F.u);
        break;
      case "ship": {
        const j = vjars.find((v) => v.id === e.jar);
        if (j) j.shipped = true;
        if (play) {
          const s = spotPos(j?.spot ?? 0);
          flyers.push({ text: `+${e.points}`, x: s.x, y: s.y - s.h - 6, t: 0.05, to: "score", color: PAL.bananaHi, size: 18 });
          flyers.push({ text: `+${TUNE.shipTime}s`, x: s.x, y: s.y - s.h + 16, t: -0.05, to: "clock", color: PAL.limeHi, size: 14 });
          if (!taught) {
            taught = true;
            tc.storage.set("taught", true).catch(() => undefined);
            tc.analytics.track("tutorial_complete");
            window.setTimeout(() => say("THREE FILL A JAR. KEEP 'EM COMING!", PAL.limeHi, 2.2), 500);
          }
        }
        break;
      }
      case "dock": {
        const spot = e.slot < DOCKS ? e.slot : e.rush ? rushSpot() : e.slot;
        vjars.push({ id: e.jar, color: e.color, spot, rush: e.rush, state: "wait", t: 0, pegs: [], shipped: false, squash: new Wobble(320, 10) });
        break;
      }
      case "jump": {
        const v = vpegs.get(e.peg);
        if (!v) break;
        v.state = "fly";
        v.t = 0;
        v.fx = v.x;
        v.fy = v.y;
        v.jar = e.jar;
        audio.play(SND.hop, { volume: lv, pitch: 3 });
        break;
      }
      case "tier": {
        multPop.kick(5);
        if (!play) break;
        const line = TIER_LINES[Math.min(TIER_LINES.length - 1, e.mult)] ?? "";
        hudPows.burst(`×${e.mult} ${line}`, W / 2, F.wy + F.u * 1.6, { size: fitSize(`×${e.mult} ${line}`, 24, W - 72), fill: [PAL.banana, PAL.bubblegum, PAL.lime, PAL.tomato, PAL.cobaltHi][e.mult % 5]!, life: 1.2 });
        audio.play(SND.tier, { pitch: (e.mult - 2) * 2 });
        audio.play(SND.kazoo, { pitch: (e.mult - 2) * 2, volume: 0.8 });
        session.feedback("success");
        shake.add(0.18);
        if (e.mult >= 3) music.setSteps(HOT_BASS);
        if (!reduced) bits.emit(W / 2, F.wy + F.u * 1.6, { count: 18 + e.mult * 3, speed: [200, 460], life: [0.7, 1.2], size: [7, 12], colors: [PAL.banana, PAL.bubblegum, PAL.lime, PAL.white, PAL.cobalt], shape: "confetti", gravity: 700, drag: 1.3 });
        break;
      }
      case "save": {
        if (!play) break;
        const word = e.why === "magnet" || e.why === "hand" ? "MAGNET!" : "ON THE HOUSE!";
        hudPows.burst(word, W / 2, F.shelf.y - 40, { size: fitSize(word, 26, W - 96), fill: e.why === "magnet" || e.why === "hand" ? PAL.tomato : PAL.limeHi, life: 1.2 });
        audio.play(SND.magnet, { volume: 0.9 });
        window.setTimeout(() => audio.play(SND.zoom, { pitch: 3 }), 120);
        session.feedback("impact");
        magnetPop.kick(4);
        shake.add(0.2);
        if (e.why === "grace" || e.why === "safe") window.setTimeout(() => say("A JAR RUSHED IN TO SAVE YOU!", PAL.limeHi, 2), 500);
        else if (e.why === "magnet") window.setTimeout(() => say("THE MAGNET YANKED IN A JAR!", PAL.white, 1.8), 500);
        break;
      }
      case "earn":
        if (!play) break;
        window.setTimeout(() => {
          if (e.what === "magnet") {
            say("+1 MAGNET! TAP IT WHEN THE SHELF FILLS!", PAL.white, 2.2);
            magnetPop.kick(6);
          } else {
            say("×4! THE SHELF GROWS A SLOT!", PAL.limeHi, 2.2);
            shelfSpr = null;
          }
          audio.play(SND.sproing, { volume: 0.8 });
        }, 650);
        break;
      case "clear": {
        if (!play) break;
        const word = CLEAR_WORDS[(e.wall - 1) % CLEAR_WORDS.length]!;
        hudPows.burst(word, W / 2, F.wy + F.u * 3.2, { size: fitSize(word, 36, W - 96), fill: PAL.banana, life: 1.5 });
        window.setTimeout(() => hudPows.burst(`+${e.points.toLocaleString("en-US")}`, W / 2, F.wy + F.u * 4.3, { size: 24, fill: PAL.white, life: 1.1 }), 260);
        flyers.push({ text: `+${e.time}s`, x: W / 2, y: F.wy + F.u * 5, t: -0.3, to: "clock", color: PAL.limeHi, size: 22 });
        audio.play(SND.bell);
        window.setTimeout(() => audio.play(SND.fanfare), 160);
        hitStop.freeze(reduced ? 0 : 0.12);
        shake.add(0.4);
        flash.trigger(PAL.cream, 0.8);
        session.feedback("success");
        if (!reduced)
          for (const side of [-1, 1])
            bits.emit(W / 2 + side * W * 0.44, F.floor, { count: 26, speed: [320, 680], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.2] : [-Math.PI * 0.8, -Math.PI * 0.55], life: [0.9, 1.6], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.banana], shape: "confetti", gravity: 700, drag: 1.2 });
        scorePop.kick(4);
        break;
      }
      case "deal":
        resetShow(r, 0.05);
        if (play) {
          say(`WALL ${e.wall}!`, PAL.white, 1.2);
          audio.play(SND.whistleUp, { pitch: 2, volume: 0.6 });
        }
        break;
      case "over":
        break;
    }
  }

  function rushSpot(): number {
    const used = new Set(vjars.filter((j) => j.rush).map((j) => j.spot));
    return used.has(DOCKS) ? DOCKS + 1 : DOCKS;
  }

  // -------------------------------------------------------------------------------------------------------------
  // The demo hand (attract mode)
  // -------------------------------------------------------------------------------------------------------------
  function stepDemo(dt: number) {
    demo.clock = TUNE.clockMax;
    const h = hand;
    h.t += dt;
    switch (h.phase) {
      case "idle": {
        const c = demoPilot.next(demo, dt);
        if (c && c.kind === "tap") {
          h.choice = c;
          h.peg = c.id;
          h.phase = "reach";
          h.t = 0;
          h.sx = h.x || F.R - 20;
          h.sy = h.y || F.floor;
        }
        break;
      }
      case "reach":
        if (h.t >= 0.28) {
          h.phase = "press";
          h.t = 0;
        }
        break;
      case "press":
        if (h.t >= 0.1) {
          if (h.choice && demo.left[h.peg]) apply(demo, h.choice);
          h.phase = "lift";
          h.t = 0;
        }
        break;
      case "lift":
        if (h.t >= 0.25) {
          h.phase = "idle";
          h.t = 0;
        }
        break;
    }
    if (!demo.live || demo.wallNo > 3) newDemo();
  }

  function handPos(): { x: number; y: number; press: number } {
    const h = hand;
    if (h.peg < 0 || !demo.wall.pegs[h.peg]) return { x: h.x, y: h.y, press: 0 };
    const [px, py] = pegScreen(demo, h.peg);
    switch (h.phase) {
      case "reach": {
        const k = easeOutBack(Math.min(1, h.t / 0.28), 1.2);
        return { x: lerp(h.sx, px, k), y: lerp(h.sy, py, k), press: 0 };
      }
      case "press":
        return { x: px, y: py, press: Math.min(1, h.t / 0.1) };
      case "lift": {
        const k = Math.min(1, h.t / 0.25);
        h.x = px;
        h.y = py + k * F.u * 0.5;
        return { x: px, y: h.y, press: 1 - k };
      }
      default:
        return { x: h.x, y: h.y, press: 0 };
    }
  }

  function drawGloveAt(x: number, y: number, press: number, alpha = 1) {
    if (!glove) return;
    const s = U * 0.78;
    const k = (1 - press * 0.1) * (F.u / U);
    g.save();
    g.globalAlpha = alpha;
    drawSprite(g, glove, x - s * 0.2 * k, y + s * 0.06 * k + press * 3, -0.18, k, k);
    g.restore();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------------------------
  function updateShow(r: Run, dt: number) {
    for (const v of vpegs.values()) {
      v.t += dt;
      if (v.state === "spin") {
        v.rot += dt * 30;
        if (v.t >= SPIN_T) {
          v.state = "fly";
          v.t = 0;
          v.fx = v.x;
          v.fy = v.y;
          audio.play(SND.pop, { volume: loud(r) ? 1 : 0.35, pitch: (hash(v.id, 2) - 0.5) * 4 });
        }
      } else if (v.state === "fly" || v.state === "wait") {
        v.rot += dt * 14;
        const [tx, ty] = targetOf(r, v);
        if (v.state === "fly") {
          const u = Math.min(1, v.t / FLY_T);
          const e = easeOutCubic(u);
          v.x = lerp(v.fx, tx, e);
          v.y = lerp(v.fy, ty, e) - Math.sin(u * Math.PI) * 46;
          if (u >= 1) land(r, v);
        } else {
          v.x = tx;
          v.y = ty - 10 - Math.sin(time * 9) * 3;
          land(r, v);
        }
      } else if (v.state === "shelf") {
        const i = r.shelf.findIndex((s) => s.peg === v.id);
        if (i >= 0) {
          const [tx, ty] = shelfSlot(F, i);
          v.x += (tx - v.x) * (1 - Math.exp(-18 * dt));
          v.y += (ty - v.y) * (1 - Math.exp(-18 * dt));
        }
        v.rot *= Math.exp(-10 * dt);
      }
    }
    for (const j of vjars) {
      j.t += dt;
      j.squash.update(dt);
      if (j.state === "arrive" && j.t >= 0.32) {
        j.state = "open";
        j.t = 0;
      } else if (j.state === "open" && j.shipped && j.pegs.length >= 3) {
        j.state = "slam";
        j.t = 0;
        audio.play(SND.slam, { volume: loud(r) ? 1 : 0.35 });
        if (loud(r)) {
          const p = jarPos(j);
          const s = spotPos(j.spot);
          pows.burst(SHIP_WORDS[j.id % SHIP_WORDS.length]!, p.x, p.y - s.h - 26, { size: 14, fill: PEGS[j.color]!.fill, life: 0.7 });
          bits.emit(p.x, p.y - s.h, { count: reduced ? 2 : 8, speed: [120, 300], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.4, 0.7], size: [6, 10], colors: [PAL.banana, PAL.white, PEGS[j.color]!.fill], shape: "star", gravity: 600, drag: 1.6 });
          shake.add(0.1);
        }
        j.squash.kick(-6);
      } else if (j.state === "slam" && j.t >= 0.2) {
        j.state = "leave";
        j.t = 0;
        audio.play(SND.zoom, { volume: loud(r) ? 0.9 : 0.3 });
        const next = vjars.find((o) => o.spot === j.spot && o.state === "wait");
        if (next) {
          next.state = "arrive";
          next.t = -0.08;
        }
      }
      if (j.state === "wait" && !vjars.some((o) => o !== j && o.spot === j.spot && o.state !== "wait" && o.state !== "leave")) {
        if (!vjars.some((o) => o !== j && o.spot === j.spot && o.state === "wait" && vjars.indexOf(o) < vjars.indexOf(j))) {
          j.state = "arrive";
          j.t = 0;
          audio.play(j.rush ? SND.zoom : SND.boing, { volume: loud(r) ? 0.8 : 0.25, pitch: j.rush ? 5 : 0 });
        }
      }
    }
    vjars = vjars.filter((j) => !(j.state === "leave" && j.t > 0.36));
    // Shards: fly, bounce once on the counter, fade.
    for (const s of shards) {
      s.t += dt;
      s.vy += 1400 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.w * dt;
      if (!s.bounced && s.y > s.floor - 4 && s.vy > 0) {
        s.bounced = true;
        s.vy *= -0.32;
        s.vx *= 0.6;
        s.w *= 0.5;
      }
    }
    shards = shards.filter((s) => s.t < 1.3 && s.y < H + 80);
  }

  function targetOf(r: Run, v: VPeg): [number, number] {
    if (v.jar >= 0) {
      const j = vjars.find((o) => o.id === v.jar && o.state !== "leave");
      if (j) return inJar(j, Math.min(2, j.pegs.length));
      return [W / 2, F.jars[0]!.y - 40];
    }
    const i = r.shelf.findIndex((s) => s.peg === v.id);
    return shelfSlot(F, Math.max(0, i));
  }

  function land(r: Run, v: VPeg) {
    if (v.jar >= 0) {
      const j = vjars.find((o) => o.id === v.jar && o.state !== "leave");
      if (!j || (j.state !== "open" && !(j.state === "arrive" && j.t > 0.2))) {
        v.state = "wait";
        return;
      }
      v.state = "jar";
      j.pegs.push(v.id);
      j.squash.kick(4);
      const n = j.pegs.length;
      audio.play(SND.clink, { volume: loud(r) ? 1 : 0.35, pitch: n * 2 });
      audio.note(midiToFreq(67 + PENTATONIC[Math.min(PENTATONIC.length - 1, n + (r.mult - 1) * 2)]!), 0.12, "triangle", loud(r) ? 0.14 : 0.05);
    } else {
      v.state = "shelf";
      audio.play(SND.tok, { volume: loud(r) ? 1 : 0.35 });
    }
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += rawDt;
    titleIn = Math.min(1, titleIn + rawDt * 1.6);
    shake.update(rawDt);
    flash.update(rawDt);
    dust.update(rawDt);
    bits.update(rawDt);
    pows.update(rawDt);
    hudPows.update(rawDt);
    scorePop.update(rawDt);
    clockPop.update(rawDt);
    titlePop.update(rawDt);
    multPop.update(rawDt);
    magnetPop.update(rawDt);
    if (msg) {
      msg.t += rawDt;
      if (msg.t > msg.life) msg = null;
    }
    const lk = reduced ? 4 : 2.4;
    layoutK = layoutTarget > layoutK ? Math.min(layoutTarget, layoutK + rawDt * lk) : Math.max(layoutTarget, layoutK - rawDt * lk);
    F = blendFrames(fAttract, fPlay, easeOutCubic(layoutK));

    for (const f of falling) f.run.step(dt);
    falling = falling.filter((f) => time < f.until);
    if (mode === "attract") {
      stepDemo(dt);
      demo.step(dt);
      onEvents(demo);
    } else if (run) {
      if (session.phase === "playing" && !ended) {
        if (run.pause <= 0) run.prepare(3);
        if (qaPilot && run.live) {
          const c = qaPilot.next(run, dt);
          if (c) {
            lastInput = time;
            if (c.kind === "tap") run.tap(c.id);
            else useMagnet();
          }
        }
      }
      run.step(dt);
      onEvents(run);
      if (!ended && !run.live) finish(run);
      if (ended) {
        endT += rawDt;
        if (!endSent && endT >= 0.7) {
          endSent = true;
          const s = run.stats;
          session.end(run.score, { outcome: "lose", stats: { walls: s.walls, jars: s.ships, smashes: s.drops, mult: s.bestMult, seconds: Math.round(s.seconds) } });
          if (isBest && summary?.prevBest !== null) hudPows.burst("NEW BEST!", W / 2, H * 0.34, { size: 38, fill: PAL.banana, life: 1.6 });
        }
      } else if (session.phase === "playing") {
        // The last five seconds tick.
        const whole = Math.ceil(run.clock);
        if (whole < lastWhole && whole <= 5 && whole > 0 && run.pause <= 0) {
          audio.play(whole <= 3 ? SND.tock : SND.tick, { pitch: (5 - whole) * 0.8 });
          clockPop.kick(whole <= 3 ? 3 : 1.5);
          if (whole === 5) say("LAST ORDERS!", PAL.tomato, 1.4);
        }
        lastWhole = whole;
        const best = session.best;
        if (!passedBest && best !== null && best > 0 && run.score > best) {
          passedBest = true;
          hudPows.burst("NEW BEST!", W / 2, F.wy + F.u * 2.2, { size: 32, fill: PAL.banana, life: 1.4 });
          audio.play(SND.fanfare);
          flash.trigger(PAL.banana, 0.6);
          session.feedback("success");
          if (!reduced)
            for (const side of [-1, 1])
              bits.emit(W / 2 + side * W * 0.42, H * 0.55, { count: 26, speed: [300, 640], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.5], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.banana], shape: "confetti", gravity: 700, drag: 1.2 });
        }
        if (!taught && !teach.pulled) ghostT += rawDt;
      }
    }
    const r = shown();
    updateShow(r, dt);
    // Flyers: hang a beat, then fly into the score or the timer.
    for (const f of flyers) f.t += rawDt;
    flyers = flyers.filter((f) => {
      if (f.t < 0.75) return true;
      if (f.to === "score") scorePop.kick(1.5);
      else clockPop.kick(3);
      return false;
    });
    const target = r.score;
    shownScore = shownScore < target ? Math.min(target, shownScore + Math.max(1, (target - shownScore) * (1 - Math.exp(-9 * rawDt)))) : target;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Draw
  // -------------------------------------------------------------------------------------------------------------
  function drawBackdrop() {
    g.fillStyle = JADE;
    g.fillRect(0, 0, W, H);
    const cx = W * 0.5;
    const cy = F.wy + F.u * 3;
    const rad = Math.hypot(W, H);
    const hot = mode === "play" && run !== null && run.mult >= 3 && !ended;
    const rot = reduced ? 0.12 : time * (hot ? 0.2 : 0.045);
    const rays = 18;
    g.fillStyle = hot ? "#3FD3A2" : JADE_RAY;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a0 = rot + (i / rays) * TAU;
      const a1 = rot + ((i + 0.5) / rays) * TAU;
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
      g.lineTo(cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad);
      g.closePath();
    }
    g.fill();
    if (halftone) {
      g.globalAlpha = 0.32;
      g.drawImage(halftone, 0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  function drawPanel(ox: number, oy: number) {
    if (!panel) return;
    const k = F.u / panel.u;
    const s = panel.spr;
    g.drawImage(s.c, F.wx + ox - s.ox * k, F.wy + oy - s.oy * k, s.w * k, s.h * k);
  }

  /** Pose drawn now: between physics steps, and dropping in when a wall is dealt. */
  function dishScreen(r: Run, id: number): { x: number; y: number; th: number; k: number; alpha: number } {
    const b = r.phys.bodies[id]!;
    lerpPose(b, Math.min(1, r.alpha), poseTmp);
    const [x, y0] = toScreen(F, poseTmp.x, poseTmp.y);
    let y = y0;
    let k = F.u / U;
    let alpha = 1;
    const dt = time - (dealAt[id] ?? 0);
    if (r === shown() && dt < 0.4) {
      const u = clamp(dt / 0.4);
      alpha = u > 0 ? 1 : 0;
      y -= (1 - easeOutBack(u, 1.4)) * F.u * 1.4;
      k *= u < 1 ? 0.85 + 0.15 * easeOutBack(u, 2) : 1;
    }
    const bt = time - (bumpAt[id] ?? -10);
    if (bt < 0.4) k *= 1 + 0.05 * Math.sin((bt / 0.4) * Math.PI) * (1 - bt / 0.4);
    return { x, y, th: poseTmp.th, k, alpha };
  }

  function drawDish(r: Run, id: number, ox: number, oy: number) {
    const d = r.wall.dishes[id]!;
    const art = dishArt.get(id);
    if (!art) return;
    const p = dishScreen(r, id);
    if (p.alpha <= 0) return;
    const c = Math.cos(p.th) * p.k;
    const s = Math.sin(p.th) * p.k;
    const b = r.phys.bodies[id]!;
    const lift = b.state === "falling" ? 2.2 : 1 + d.layer * 0.55;
    // Shadow on the wall below and right.
    g.globalAlpha = 0.2;
    g.setTransform(D * c, D * s, -D * s, D * c, D * (p.x + ox + F.u * 0.05 * lift), D * (p.y + oy + F.u * 0.08 * lift));
    g.drawImage(art.shadow.c, -art.shadow.ox, -art.shadow.oy, art.shadow.w, art.shadow.h);
    g.globalAlpha = 1;
    g.setTransform(D * c, D * s, -D * s, D * c, D * (p.x + ox), D * (p.y + oy));
    g.drawImage(art.body.c, -art.body.ox, -art.body.oy, art.body.w, art.body.h);
    // Highlight the dish that sits on a tapped peg.
    const bt = time - (bumpAt[id] ?? -10);
    if (bt < 0.6) {
      g.globalAlpha = 1 - bt / 0.6;
      dishPath(g, d.shape, U);
      g.lineWidth = 5;
      g.strokeStyle = PAL.white;
      g.setLineDash([9, 7]);
      g.lineDashOffset = -time * 40;
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    if (d.face && b.state !== "pinned" ? true : d.face && !(faceBlock.get(id) ?? []).some((p) => r.left[p])) {
      const f = faceSpot(d.shape);
      g.translate(f.x * U, f.y * U);
      // Upright while pinned (a plate's turn doesn't show), then it swings and tumbles with the dish.
      g.rotate(-d.base.th);
      const mood: Mood = b.state === "falling" ? "scream" : b.state === "hanging" && !b.settled ? "worried" : r.count[id]! === 1 ? "worried" : "calm";
      let lx = Math.sin(time * 0.7 + id * 2.1) * 0.5;
      let ly = Math.cos(time * 0.5 + id) * 0.3;
      if (finger && mode === "play") {
        const dx = finger.x - p.x;
        const dy = finger.y - p.y;
        const dd = Math.max(40, Math.hypot(dx, dy));
        lx = dx / dd;
        ly = dy / dd;
      } else if (b.state === "hanging" && !b.settled) {
        lx = clamp(b.w * 0.3, -1, 1);
        ly = 0.4;
      }
      const period = 3 + hash(id, 2) * 4;
      const ph = (time + hash(id, 5) * 9) % period;
      const blink = ph < 0.14 ? Math.sin((ph / 0.14) * Math.PI) : 0;
      drawFace(g, f.r * U, lx, ly, mood, blink);
    }
    g.setTransform(D, 0, 0, D, 0, 0);
  }

  function drawPeg(r: Run, id: number, ox: number, oy: number) {
    const v = vpegs.get(id);
    if (!v || v.state !== "wall" || !r.left[id]) return;
    const p = r.wall.pegs[id]!;
    const [x, y] = toScreen(F, p.x, p.y);
    const k = F.u / U;
    let s = 1;
    let rot = 0;
    const at = time - (pegAt[id] ?? 0);
    if (r === shown() && at < 0.35) {
      if (at < 0) return;
      const u = at / 0.35;
      s = easeOutBack(u, 2.2);
      rot = (1 - u) * -2.5;
    }
    if (press && press.peg === id) {
      s *= 0.86;
      rot += 0.25;
    }
    const wt = time - wiggleAt[id]!;
    if (wt < 0.4) rot += Math.sin(wt * 40) * 0.35 * (1 - wt / 0.4);
    // Idle hint: the best peg bobs.
    if (mode === "play" && taught && hintPeg === id) {
      const ph = (time % 1.1) / 1.1;
      s *= 1 + (ph < 0.4 ? Math.sin((ph / 0.4) * Math.PI) * 0.18 : 0);
    }
    drawSprite(g, pegSpr[p.color]!, x + ox, y + oy, rot, s * k, s * k);
  }

  let hintPeg = -1;
  let hintLook = 0;

  function drawWall(r: Run, ox: number, oy: number) {
    const wall = r.wall;
    const order = [...wall.dishes].sort((a, b) => a.layer - b.layer || a.id - b.id);
    for (const d of order) {
      const b = r.phys.bodies[d.id]!;
      if (b.state === "gone" || b.state === "falling") continue;
      drawDish(r, d.id, ox, oy);
      for (const id of d.pegs) drawPeg(r, id, ox, oy);
    }
    // Pegs hidden under a dish show through faintly, so the wall can be read ahead.
    const k = F.u / U;
    for (const p of wall.pegs) {
      if (!r.left[p.id] || vpegs.get(p.id)?.state !== "wall") continue;
      if (time < (pegAt[p.id] ?? 0) + 0.3) continue;
      if (r.isFree(p.id)) continue;
      const [x, y] = toScreen(F, p.x, p.y);
      let rot = 0;
      const wt = time - wiggleAt[p.id]!;
      if (wt < 0.4) rot = Math.sin(wt * 40) * 0.35 * (1 - wt / 0.4);
      g.globalAlpha = wt < 0.6 ? 0.85 : 0.5;
      drawSprite(g, ghostSpr[p.color]!, x + ox, y + oy, rot, k, k);
      g.globalAlpha = 1;
    }
  }

  function drawFalling(r: Run, ox: number, oy: number) {
    for (const d of r.wall.dishes) if (r.phys.bodies[d.id]!.state === "falling") drawDish(r, d.id, ox, oy);
  }

  function drawShards(ox: number, oy: number) {
    g.lineJoin = "round";
    for (const s of shards) {
      const a = s.t > 0.9 ? 1 - (s.t - 0.9) / 0.4 : 1;
      if (a <= 0) continue;
      g.save();
      g.globalAlpha = a;
      g.translate(s.x + ox, s.y + oy);
      g.rotate(s.rot);
      const k = 0.82 * (s.t < 0.45 ? 1 : Math.max(0.25, 1 - (s.t - 0.45) * 0.9));
      g.scale(k, k);
      g.beginPath();
      s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = s.color;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
    }
  }

  function drawJars(r: Run) {
    if (!glassSpr) return;
    for (const j of vjars) {
      if (j.state === "wait") continue;
      const p = jarPos(j);
      const s = spotPos(j.spot);
      const sq = clamp(j.squash.v - 1, -0.25, 0.25);
      const kx = p.k * (1 + sq * 0.6);
      const ky = p.k * (1 - sq);
      g.globalAlpha = p.alpha;
      if (j.rush && j.state !== "leave") burstSticker(g, "RUSH!", p.x, p.y - s.h - 22, { size: 11, fill: PAL.tomato, rx: 30, ry: 12, seed: 3, rot: -0.1 });
      drawSprite(g, glassSpr, p.x, p.y, 0, kx, ky);
      // Pegs inside, bottom up.
      j.pegs.forEach((id, i) => {
        const v = vpegs.get(id);
        if (!v) return;
        const [x, y] = inJar(j, i);
        drawSprite(g, pegSpr[v.color]!, x, y + (1 - ky / p.k) * s.h * 0.3, i * 0.6, p.k * 0.8, p.k * 0.8);
      });
      // Empty slots show what it still wants.
      for (let i = j.pegs.length; i < 3; i++) {
        const [x, y] = inJar(j, i);
        g.beginPath();
        g.arc(x, y, PEG_R * U * 0.62 * p.k, 0, TAU);
        g.setLineDash([3, 3]);
        g.lineWidth = 1.8;
        g.strokeStyle = "rgba(22,18,28,0.35)";
        g.stroke();
        g.setLineDash([]);
      }
      // Googly eyes on the glass, watching the incoming pegs.
      const ey = p.y - s.h * 0.74 * ky / p.k;
      const look = j.pegs.length >= 3 ? 0 : -0.3;
      drawFaceSmall(p.x, ey, s.w * 0.2, j.state === "slam" || j.state === "leave" ? "happy" : "calm", look);
      // The lid: hovering open above the jar, slammed on when it's full.
      const lid = lidSpr[j.color]!;
      let ly = p.y - s.h * 0.86 * (ky / p.k) * (p.k / (s.w / fPlay.jars[0]!.w)) - s.h * 0.06;
      let lx = p.x;
      let lrot = 0;
      if (j.state === "arrive" || j.state === "open") {
        // Open: tipped back on the jar's shoulder, bobbing a little.
        const bob = reduced ? 0 : Math.sin(time * 3 + j.id) * 1.5;
        ly -= s.h * 0.07 + bob;
        lx -= s.w * 0.12;
        lrot = -0.42;
      } else if (j.state === "slam") {
        const u = clamp(j.t / 0.08);
        ly -= s.h * 0.07 * (1 - u);
        lx -= s.w * 0.12 * (1 - u);
        lrot = -0.42 * (1 - u);
      }
      drawSprite(g, lid, lx, ly, lrot, p.k, p.k);
      g.globalAlpha = 1;
    }
    // The next jar in line peeks in.
    const nx = r.upcoming(0);
    if (nx !== null) {
      const k = F.next.s * 0.55;
      drawSprite(g, lidSpr[nx]!, F.next.x + 8, F.next.y, -0.12, k, k);
      sticker(g, "NEXT", F.next.x + 8, F.next.y - 22 * F.next.s, { size: Math.round(11 * F.next.s + 1), fill: PAL.white, shadow: 1.5 });
    }
  }

  function drawFaceSmall(x: number, y: number, r: number, mood: Mood, look: number) {
    g.save();
    g.translate(x, y);
    drawFace(g, r, 0, look, mood, 0);
    g.restore();
  }

  function drawShelf(r: Run) {
    if (!shelfSpr || shelfSlots !== r.shelfCap) {
      shelfSlots = r.shelfCap;
      shelfSpr = makeShelf(r.shelfCap, fPlay.slot, fPlay.pitch, Math.min(2.5, D));
    }
    const k = F.slot / fPlay.slot;
    const n = r.shelf.length;
    const danger = n >= r.shelfCap ? 2 : n >= r.shelfCap - 1 ? 1 : 0;
    const wob = danger === 2 && !reduced ? Math.sin(time * 26) * 0.006 : 0;
    drawSprite(g, shelfSpr, F.shelf.x - 2 * k, F.shelf.y - 2 * k, wob, k, k);
    if (danger) {
      const a = danger === 2 ? 0.45 + 0.4 * light.pulse(time, 1.6, { still: 0.8 }) : 0.35;
      roundRectPath(g, F.shelf.x - 5, F.shelf.y - 5, (fPlay.pitch * r.shelfCap + 16) * k + 10, F.shelf.h + 10, 18);
      g.lineWidth = 4;
      g.strokeStyle = danger === 2 ? PAL.tomato : PAL.banana;
      g.globalAlpha = a;
      g.stroke();
      g.globalAlpha = 1;
      sticker(g, danger === 2 ? "FULL!" : "ALMOST FULL!", F.shelf.x + 8, F.shelf.y - 12, { size: 12, align: "left", fill: danger === 2 ? PAL.tomato : PAL.banana, shadow: 1.5, rot: -0.04 });
    }
    for (const v of vpegs.values()) if (v.state === "shelf") drawSprite(g, pegSpr[v.color]!, v.x, v.y, v.rot, (F.u / U) * 0.95, (F.u / U) * 0.95);
  }

  function drawMagnet(r: Run) {
    if (!magnetOn || !magnetOff) return;
    const b = F.magnet;
    const lit = r.magnets > 0;
    const s = magnetPop.v;
    const tight = lit && r.shelf.length >= r.shelfCap - 1;
    const bob = tight && !reduced ? Math.sin(time * 8) * 0.12 : 0;
    drawSprite(g, lit ? magnetOn : magnetOff, b.x + b.w / 2, b.y + b.h / 2 - 2, bob, s * (F.slot / fPlay.slot), s * (F.slot / fPlay.slot));
    sticker(g, `×${r.magnets}`, b.x + b.w - 6, b.y + b.h - 6, { size: 13, fill: lit ? PAL.white : "#CFC6D8", shadow: 1.5 });
  }

  function drawHud(r: Run) {
    // Score, best, multiplier.
    const sp = F.score;
    g.save();
    g.translate(sp.x, sp.y);
    g.rotate(-0.05);
    g.scale(scorePop.v, scorePop.v);
    sticker(g, Math.round(shownScore).toLocaleString("en-US"), 0, 0, { size: 34, align: "left", fill: PAL.white, shadow: 4 });
    g.restore();
    if (session.best) sticker(g, `BEST ${session.best.toLocaleString("en-US")}`, sp.x + 2, sp.y + 32, { size: 12, align: "left", fill: PAL.banana, shadow: 2, rot: -0.04 });
    if (r.mult > 1 && !ended) {
      const mx = sp.x + Math.max(118, textWidth(g, Math.round(shownScore).toLocaleString("en-US"), 34) + 38);
      const wob = reduced ? 0 : Math.sin(time * 7) * 0.05;
      burstSticker(g, `×${r.mult}`, mx, sp.y - 4, { size: 17, fill: [PAL.banana, PAL.banana, PAL.banana, PAL.bubblegum, PAL.lime, PAL.tomato, PAL.cobaltHi][r.mult]!, rx: 29, ry: 17, seed: r.mult, rot: -0.08 + wob, scale: Math.min(1.25, multPop.v) });
      // The streak window draining beside it.
      const left = clamp(1 - r.sinceHit / TUNE.streakWindow);
      roundRectPath(g, mx + 30, sp.y - 8, 34, 7, 3.5);
      g.fillStyle = INK;
      g.fill();
      if (left > 0) {
        roundRectPath(g, mx + 31, sp.y - 7, 32 * left, 5, 2.5);
        g.fillStyle = PAL.white;
        g.fill();
      }
    }
    // The kitchen timer: a cream dial, a tomato wedge that drains, a knob on top.
    const cp = F.clock;
    const hot = !ended && r.clock <= 5 && r.pause <= 0;
    g.save();
    g.translate(cp.x, cp.y);
    g.scale(clockPop.v, clockPop.v);
    g.rotate(0.05);
    roundRectPath(g, -7, -cp.r - 9, 14, 11, 3);
    inkFillLocal(PAL.tomato, 3, 2.5);
    g.beginPath();
    g.arc(0, 0, cp.r, 0, TAU);
    inkFillLocal(PAL.cream, 4, 4);
    const frac = clamp(r.clock / TUNE.clockMax);
    if (frac > 0) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, cp.r - 6, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      g.closePath();
      g.fillStyle = hot ? (light.pulse(time, 2, { still: 1 }) > 0.5 ? PAL.tomato : CHERRY) : PAL.tomato;
      g.fill();
    }
    g.restore();
    const secs = Math.ceil(r.clock);
    sticker(g, `${secs}`, cp.x, cp.y + 1, { size: secs >= 100 ? 17 : 21, fill: hot ? PAL.banana : PAL.white, shadow: 2.5, sx: clockPop.v, sy: clockPop.v });
    sticker(g, `WALL ${r.wallNo}`, cp.x, cp.y + cp.r + 13, { size: 11, fill: PAL.white, shadow: 1.5, rot: 0.03 });
  }

  function inkFillLocal(fill: string, lw: number, sh: number) {
    g.save();
    g.translate(sh, sh);
    g.fillStyle = INK;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
    g.restore();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
  }

  function drawFlyers() {
    for (const f of flyers) {
      if (f.t < 0) continue;
      const hang = 0.4;
      let x = f.x;
      let y = f.y - Math.min(1, f.t / hang) * 16;
      let s = f.t < 0.1 ? 0.5 + f.t * 5 : 1;
      if (f.t > hang) {
        const u = easeInCubic(Math.min(1, (f.t - hang) / 0.35));
        const tx = f.to === "score" ? F.score.x + 50 : F.clock.x;
        const ty = f.to === "score" ? F.score.y : F.clock.y;
        x = lerp(x, tx, u);
        y = lerp(y, ty, u) - Math.sin(u * Math.PI) * 26;
        s = 1 - u * 0.45;
      }
      sticker(g, f.text, x, y, { size: f.size, fill: f.color, sx: s, sy: s, shadow: 2.5 });
    }
  }

  function drawMsg() {
    if (!msg) return;
    const k = msg.t < 0.18 ? easeOutBack(msg.t / 0.18, 1.8) : msg.t > msg.life - 0.2 ? Math.max(0, (msg.life - msg.t) / 0.2) : 1;
    if (k <= 0.02) return;
    const size = fitSize(msg.text, 15, F.R - F.L - 30, 10);
    const w = textWidth(g, msg.text, size) + 26;
    g.save();
    g.translate(F.lane.x, F.lane.y);
    g.scale(k, k);
    g.rotate(-0.02);
    roundRectPath(g, -w / 2, -15, w, 30, 15);
    inkFillLocal(INK, 3, 3);
    g.restore();
    sticker(g, msg.text, F.lane.x, F.lane.y, { size, fill: msg.fill, shadow: 0, sx: k, sy: k, rot: -0.02, stroke: 0.18 });
  }

  /** First run: a ghost glove taps the best peg until the player pulls one. */
  function drawTeach(r: Run) {
    if (taught || teach.pulled || ghostT < 0) return;
    const free = r.freePegs();
    if (!free.length) return;
    let best = free[0]!;
    let bv = -Infinity;
    for (const id of free) {
      const v = value(r, id, 0.5);
      if (v > bv) {
        bv = v;
        best = id;
      }
    }
    const [x, y] = pegScreen(r, best);
    const ph = (ghostT % 1.3) / 1.3;
    const press = ph > 0.35 && ph < 0.6 ? 1 : 0;
    const lift = ph < 0.35 ? (1 - ph / 0.35) * 24 : ph > 0.6 ? ((ph - 0.6) / 0.4) * 18 : 0;
    g.save();
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(x, y, PEG_R * F.u * (1.4 + (press ? 0.5 * (1 - (ph - 0.35) / 0.25) : 0)), 0, TAU);
    g.lineWidth = 3;
    g.strokeStyle = PAL.white;
    g.stroke();
    g.restore();
    drawGloveAt(x, y + lift, press, 0.85);
  }

  function drawSummary(r: Run) {
    const sm = summary;
    if (!sm || session.phase !== "over" || session.phaseTime < 0.35) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 16 : pv.left + 12;
    const right = W - (solo ? 16 : pv.right + 6);
    const w = right - left;
    const ph = 116;
    const topY = solo ? Math.round(H * 0.5) : H - pv.bottom - ph - 6;
    const k = easeOutBack(clamp((session.phaseTime - 0.35) / 0.4), 1.5);
    const s = r.stats;
    g.save();
    g.translate(left + w / 2, topY + ph / 2);
    g.scale(k, k);
    g.rotate(-0.012);
    roundRectPath(g, -w / 2, -ph / 2, w, ph, 16);
    inkFillLocal(PAL.cream, 4, 5);
    const x0 = -w / 2 + 14;
    sticker(g, `WALLS ${s.walls}  JARS ${s.ships}`, x0, -ph / 2 + 20, { size: 13, align: "left", fill: PAL.banana, shadow: 2 });
    sticker(g, `SMASHES ${s.drops}  BEST ×${s.bestMult}`, w / 2 - 14, -ph / 2 + 42, { size: 13, align: "right", fill: PAL.bubblegumHi, shadow: 2 });
    const y0 = -ph / 2 + 58;
    const bw = w - 28;
    roundRectPath(g, x0, y0, bw, 22, 11);
    g.fillStyle = PAL.white;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();
    const prev = sm.prevBest;
    const frac = sm.score <= 0 ? 0 : sm.isBest || !prev ? 1 : clamp(sm.score / prev);
    const grow = Math.min(1, (session.phaseTime - 0.35) / 0.8);
    if (frac > 0.02) {
      roundRectPath(g, x0 + 3, y0 + 3, Math.max(16, (bw - 6) * frac * grow), 16, 8);
      g.fillStyle = sm.isBest ? PAL.lime : JADE;
      g.fill();
    }
    const label = sm.score <= 0 ? "PULL A PEG TO SCORE!" : sm.isBest ? (prev ? `NEW BEST! +${(sm.score - prev).toLocaleString("en-US")}` : "FIRST SCORE ON THE BOARD!") : `${Math.round(frac * 100)}% OF YOUR BEST`;
    sticker(g, label, 0, y0 + 11, { size: 13, fill: PAL.white, shadow: 1.5 });
    g.fillStyle = INK;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const tip = `TIP: ${sm.tip}`;
    let size = 12;
    g.font = font(size);
    while (size > 9 && g.measureText(tip).width > bw) g.font = font(--size);
    g.fillText(tip, x0, ph / 2 - 20);
    g.restore();
    if (solo && session.phaseTime > 0.8) {
      sticker(g, sm.score.toLocaleString("en-US"), W / 2, topY - 70, { size: 52, fill: PAL.banana, cut: 5, shadow: 5, rot: -0.05 });
      burstSticker(g, "TAP TO SMASH AGAIN!", W / 2, topY + ph + 54, { size: 19, fill: PAL.tomato, rx: 160, ry: 34, seed: 31, rot: -0.04 + (reduced ? 0 : Math.sin(time * 5) * 0.05) });
    }
  }

  function drawAttract() {
    const ins = session.preview();
    const left = ins.left + 12;
    const right = W - ins.right - 12;
    const topY = ins.top + 4;
    const bottomY = H - ins.bottom - 10;
    const aw = right - left;
    const k = Math.min(1, aw / 300);
    const pop = titleIn < 1 ? 0.4 + 0.6 * (1 - (1 - titleIn) ** 3) + Math.sin(titleIn * 9) * 0.08 * (1 - titleIn) : 1;
    const amp = reduced ? 2 : 8;
    const letter = (i: number, fill: string) => {
      const ph = (((time * (reduced ? 0.5 : 1.25) - i * 0.07) % 1) + 1) % 1;
      const hop = 4 * ph * (1 - ph);
      return { dx: 0, dy: -hop * amp, rot: Math.sin(time * 2 + i) * 0.05, sx: 1, sy: 1, fill };
    };
    g.save();
    g.translate(left + aw / 2, topY + 38 * k);
    g.scale(pop * k * titlePop.v, pop * k * titlePop.v);
    stickerWord(g, "PLATTER", -16, 0, { size: 46, rot: -0.07, cut: 6, shadow: 6 }, (i) => letter(i, i % 2 ? PAL.banana : PAL.bananaHi));
    g.restore();
    const wob = reduced ? 0 : Math.sin(time * 4.4) * 0.05;
    burstSticker(g, "BANG!", left + aw * 0.7, topY + 84 * k, { size: 32 * k, fill: PAL.tomato, rx: 78 * k, ry: 30 * k, seed: 7, rot: 0.08 + wob, scale: pop });
    if (session.best) sticker(g, `BEST ${session.best.toLocaleString("en-US")}`, left + 58 * k, topY + 86 * k, { size: 14 * Math.max(0.85, k), rot: -0.06, fill: PAL.white, shadow: 2.5 });
    const py = bottomY - 30;
    const sc = 1 + (reduced ? 0 : Math.sin(time * 7.3) * 0.045);
    burstSticker(g, "TAP TO SMASH!", left + aw / 2, py, { size: 24, fill: PAL.tomato, rx: 132, ry: 36, seed: 42, rot: -0.05 + (reduced ? 0 : Math.sin(time * 5.2) * 0.06), scale: sc * k });
    if (hand.phase !== "idle") {
      const hp = handPos();
      drawGloveAt(hp.x, hp.y, hp.press);
    }
  }

  function render() {
    const r = shown();
    view.begin();
    drawBackdrop();
    const o = shake.offset;
    drawPanel(o.x, o.y);
    ensureDishArt(r.wall);
    {
      drawWall(r, o.x, o.y);
      for (const f of falling) if (f.run !== r) drawFalling(f.run, o.x, o.y);
      drawFalling(r, o.x, o.y);
    }
    drawShards(o.x, o.y);
    dust.draw(g);
    drawShelf(r);
    if (mode === "play") drawMagnet(r);
    drawJars(r);
    // Pegs in flight, over everything on the wall.
    for (const v of vpegs.values()) {
      if (v.state !== "spin" && v.state !== "fly" && v.state !== "wait") continue;
      const sc = (F.u / U) * (v.state === "spin" ? 1 + (v.t / SPIN_T) * 0.4 : 1.3 - Math.min(1, v.t / FLY_T) * 0.45);
      drawSprite(g, pegSpr[v.color]!, v.x, v.y - (v.state === "spin" ? (v.t / SPIN_T) * 8 : 0), v.rot, sc, sc);
    }
    bits.draw(g);
    pows.draw(g);
    if (mode === "play") {
      drawHud(r);
      drawMsg();
      if (session.phase === "playing") drawTeach(r);
      drawFlyers();
    }
    hudPows.draw(g);
    if (mode === "attract") drawAttract();
    else if (session.phase === "over") {
      g.fillStyle = "rgba(22,18,28,0.18)";
      g.fillRect(0, 0, W, H);
      drawSummary(r);
    }
    flash.draw(g, W, H);
  }

  // The idle hint: after a few quiet seconds the best peg bobs.
  function updateHint(dt: number) {
    hintLook -= dt;
    if (!run || !inPlay() || time - lastInput < HINT_AFTER) {
      hintPeg = -1;
      return;
    }
    if (hintLook > 0 && hintPeg >= 0 && run.isFree(hintPeg)) return;
    hintLook = 0.4;
    let best = -1;
    let bv = -Infinity;
    for (const id of run.freePegs()) {
      const v = value(run, id, 0.8);
      if (v > bv) {
        bv = v;
        best = id;
      }
    }
    hintPeg = best;
  }

  resetShow(demo, 0.2);
  update(0);
  render();
  let frames = 0;
  tc.loop((dt) => {
    const step = Math.min(dt, 1 / 20);
    update(step);
    updateHint(step);
    render();
    if (++frames === 2) session.ready();
  });
  void D;
}

void main();
