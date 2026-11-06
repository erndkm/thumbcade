import { clamp, damp, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { onDrag, onKeys } from "@thumbcade-games/kit/input";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import * as ART from "./art.ts";
import { type Kind, KINDS, TINT } from "./art.ts";
import { chunkyTitle, drawText, textWidth } from "./font.ts";
import { Nudge, PixelParticles, RAMP } from "./fx.ts";
import { KEY, PAL } from "./palette.ts";
import { blit, createPixelScreen, dither, fill, flipRows, Painter, rotRows, sprite } from "./pixel.ts";
import { createSound } from "./sound.ts";

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------
const HEARTS = 3;
const BOT = !!import.meta.env.VITE_PW_BOT;
let botT = 0;
const POT_W = 26;
const POT_H = 22;
/** Half-width of the pot mouth (catches) and of the whole rim (bounces). */
const MOUTH = 9;
const RIM = 14;

function tuning(time: number, recipes: number) {
  const d = clamp(time / 85 + recipes * 0.015);
  return {
    d,
    interval: lerp(0.8, 0.36, d),
    wobble: lerp(0.45, 0.26, d),
    gravity: lerp(170, 260, d),
    maxFall: lerp(92, 150, d),
    need: lerp(0.42, 0.3, d),
    double: d > 0.35 ? (d - 0.35) * 0.6 : 0,
    pool: Math.min(KINDS.length, 4 + Math.floor(recipes / 2)),
    length: recipes < 2 ? 3 : 4,
    perStep: lerp(4.6, 3.2, d),
  };
}

type ItemState = "wobble" | "fall" | "floor";
interface Item {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  rotT: number;
  state: ItemState;
  t: number;
  wobble: number;
  bounced: boolean;
}

interface Recipe {
  kinds: Kind[];
  step: number;
  time: number;
  limit: number;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
}

interface Flying {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  tint: [string, string];
}

async function main() {
  const session = await createSession({ id: "stirabout" });
  const scr = createPixelScreen();
  const { ctx } = scr;
  const sfx = createSound();
  const fx = new PixelParticles(500);
  const nudge = new Nudge(session.reducedMotion);
  let rng = createRng(session.ctx.seed);

  // ---- sprites ---------------------------------------------------------------------------------
  const ING = Object.fromEntries(
    KINDS.map((k) => {
      const m = ART.INGREDIENTS[k] as readonly string[];
      const r1 = rotRows(m);
      const r2 = rotRows(r1);
      const r3 = rotRows(r2);
      return [k, [sprite(m), sprite(r1), sprite(r2), sprite(r3)]];
    }),
  ) as Record<Kind, HTMLCanvasElement[]>;
  const tintId = (t: [string, string]) => t.join("");
  const potCache = new Map<string, HTMLCanvasElement>();
  const foamCache = new Map<string, HTMLCanvasElement[]>();
  const bottleCache = new Map<string, HTMLCanvasElement>();
  const pot = (t: [string, string]) => {
    let c = potCache.get(tintId(t));
    if (!c) potCache.set(tintId(t), (c = sprite(ART.CAULDRON, { L: t[0], H: t[1] })));
    return c;
  };
  const foam = (t: [string, string]) => {
    let c = foamCache.get(tintId(t));
    if (!c) foamCache.set(tintId(t), (c = ART.FOAM.map((f) => sprite(f, { L: t[0], H: t[1] }))));
    return c;
  };
  const bottle = (t: [string, string]) => {
    let c = bottleCache.get(tintId(t));
    if (!c) bottleCache.set(tintId(t), (c = sprite(ART.BOTTLE, { L: t[0], H: t[1] })));
    return c;
  };
  const MURKY: [string, string] = ["m", "s"];
  const fire = ART.FIRE.map((f) => sprite(f));
  const heart = sprite(ART.HEART);
  const heartEmpty = sprite(ART.HEART_EMPTY);
  const cat = {
    sit: sprite(ART.CAT.sit),
    blink: sprite(ART.CAT.blink),
    swish: sprite(ART.CAT.swish),
    swatL: sprite(ART.CAT.swat),
    swatR: sprite(flipRows(ART.CAT.swat)),
    crouch: sprite(ART.CAT.crouch),
  };
  const candleWax = sprite(ART.CANDLE.wax);
  const flames = ART.CANDLE.flame.map((f) => sprite(f));
  const jars = ART.JARS.map((j) => sprite(j));
  const herbs = sprite(ART.HERBS);
  const windowImg = sprite(ART.WINDOW);
  const broom = sprite(ART.BROOM);
  const book = sprite(ART.BOOK);
  const check = sprite(ART.CHECK);
  const portrait = sprite(ART.PORTRAIT);
  const sparkle = ART.SPARKLE.map((s) => sprite(s));
  const title = chunkyTitle("stirabout", { fill: "y", light: "c", dark: "o", outline: "k", shadow: "n" });

  // ---- layout ----------------------------------------------------------------------------------
  let W = scr.w;
  let H = scr.h;
  let top = 0;
  let shelfY = 46;
  let floorY = 200;
  let bg: HTMLCanvasElement | null = null;
  const candles: number[] = [];
  const decor: Array<{ img: HTMLCanvasElement; x: number }> = [];

  function layout() {
    W = scr.w;
    H = scr.h;
    const play = scr.safe(session.play());
    top = play.y0;
    shelfY = Math.max(34, top + 30);
    floorY = H - clamp(Math.round(H * 0.18), 34, 56);
    candles.length = 0;
    candles.push(7, W - 13);
    decor.length = 0;
    const spots = [0.24, 0.47, 0.68, 0.86];
    spots.forEach((f, i) => decor.push({ img: jars[i % jars.length]!, x: Math.round(W * f) }));
    bg = paintBackground();
  }

  /** The cottage: candlelit plank wall, beam, herbs, window, shelves, floorboards and a rug. Painted once per layout. */
  function paintBackground(): HTMLCanvasElement {
    const p = new Painter(W, H);
    const wall = [PAL.ink, PAL.night, PAL.dusk, PAL.wood, PAL.ember];
    const lights = [
      { x: candles[0]! + 2, y: shelfY - 12, r: 30, k: 0.5 },
      { x: candles[1]! + 2, y: shelfY - 12, r: 30, k: 0.5 },
      { x: W / 2, y: floorY + 14, r: 46, k: 0.42 },
    ];
    const band = (ramp: readonly string[], level: number, x: number, y: number) => {
      const l = clamp(level, 0, ramp.length - 1.001);
      const i = Math.floor(l);
      const f = clamp((l - i - 0.38) / 0.3);
      return dither(x, y, f) ? ramp[i + 1]! : ramp[i]!;
    };
    // Plank widths, hand-picked so the wall doesn't look like a grid.
    const widths = [11, 9, 12, 10, 8, 11, 13, 9, 10, 12, 9, 11, 10];
    const seams = new Set<number>();
    const grain: Array<[number, number, number]> = [];
    let gx = -3;
    let gi = 0;
    const grng = createRng(77);
    while (gx < W) {
      seams.add(gx);
      const w = widths[gi++ % widths.length]!;
      for (let k = 0; k < 2; k++) grain.push([gx + 2 + grng.int(0, w - 4), grng.int(0, floorY), grng.int(6, 22)]);
      gx += w;
    }
    const grainAt = new Set<number>();
    for (const [x, y0, len] of grain) for (let y = y0; y < y0 + len; y++) grainAt.add(y * 4096 + x);
    for (let y = 0; y < floorY; y++) {
      for (let x = 0; x < W; x++) {
        let L = 0.5;
        for (const l of lights) L += l.k * Math.exp(-((x - l.x) ** 2 + (y - l.y) ** 2) / (2 * l.r * l.r));
        L *= lerp(0.45, 1, clamp(y / (H * 0.3)));
        L *= lerp(0.6, 1, clamp(Math.min(x, W - x) / 26));
        let level = 1.3 + L * 2.5;
        if (seams.has(x)) level -= 1.2;
        else if (seams.has(x - 1)) level += 0.25;
        if (grainAt.has(y * 4096 + x)) level -= 0.45;
        p.set(x, y, band(wall, level, x, y));
      }
    }
    // Ceiling beam.
    for (let y = 0; y < 7; y++) for (let x = 0; x < W; x++) p.set(x, y, y === 6 ? PAL.ink : y === 5 ? PAL.night : y === 0 ? PAL.ink : (x + y * 3) % 17 === 0 ? PAL.night : PAL.dusk);
    // Main shelf board with brackets.
    shelfBoard(p, 0, shelfY, W);
    // Trophy shelves.
    const ty = trophyY();
    shelfBoard(p, 1, ty, 36);
    shelfBoard(p, W - 37, ty, 36);
    // Floor: baseboard + boards lit by the fire.
    const floorRamp = [PAL.ink, PAL.night, PAL.dusk, PAL.wood, PAL.ember];
    for (let y = floorY; y < H; y++) {
      const row = y - floorY;
      for (let x = 0; x < W; x++) {
        if (row === 0) {
          p.set(x, y, PAL.ink);
          continue;
        }
        if (row === 1 || row === 2) {
          p.set(x, y, row === 1 ? PAL.dusk : PAL.night);
          continue;
        }
        const boardRow = Math.floor((row - 3) / 6);
        const inBoard = (row - 3) % 6;
        const off = (boardRow * 23) % 31;
        const seamX = (x + off) % 31 === 0;
        let L = 0.55 + 0.7 * Math.exp(-((x - W / 2) ** 2) / (2 * 50 * 50) - (row * row) / (2 * 30 * 30));
        L *= lerp(1, 0.65, clamp(row / (H - floorY)));
        let level = L * 3;
        if (inBoard === 5 || seamX) level -= 1.3;
        else if (inBoard === 0) level += 0.3;
        p.set(x, y, band(floorRamp, level, x, y));
      }
    }
    // Rug: an oval in rose with a blush border and a candle stitch.
    const rx = Math.round(W * 0.38);
    const ry = Math.round((H - floorY - 8) / 2);
    const rcx = Math.round(W / 2);
    const rcy = floorY + 6 + ry;
    for (let y = rcy - ry - 1; y <= rcy + ry + 1; y++) {
      for (let x = rcx - rx - 1; x <= rcx + rx + 1; x++) {
        const e = ((x - rcx) / rx) ** 2 + ((y - rcy) / ry) ** 2;
        if (e > 1.08) continue;
        let c: string;
        if (e > 0.92) c = PAL.ink;
        else if (e > 0.8) c = PAL.blush;
        else if (e > 0.72) c = PAL.rose;
        else if (e > 0.62) c = (x + 2 * y) % 4 < 2 ? PAL.candle : PAL.ember;
        else c = (x - rcx + 2 * (y - rcy) + 400) % 11 === 0 && (x + y) % 2 === 0 ? PAL.blush : PAL.rose;
        p.set(x, y, c);
      }
    }
    // A blush sparkle stitched into the middle of the rug.
    for (let i = -4; i <= 4; i++) {
      const a = 4 - Math.abs(i);
      p.set(rcx + i * 2, rcy, PAL.blush);
      p.set(rcx + i * 2 + 1, rcy, Math.abs(i) < 4 ? PAL.blush : PAL.rose);
      if (Math.abs(i) <= 2) p.set(rcx, rcy + i, PAL.blush);
      if (a >= 3) p.set(rcx + i, rcy, PAL.cream);
    }
    p.set(rcx, rcy, PAL.butter);
    const canvas = p.toCanvas();
    const g = canvas.getContext("2d") as CanvasRenderingContext2D;
    g.imageSmoothingEnabled = false;
    // Herbs hanging from the beam, window, decor.
    for (const fx0 of [0.3, 0.55, 0.8]) blit(g, herbs, Math.round(W * fx0) - 3, 6);
    blit(g, windowImg, W - 34, shelfY + 26);
    // The cat's portrait on its nail.
    const px = 9;
    const py = shelfY + 58;
    for (let i = 1; i < 6; i++) {
      fill(g, px + 7 - i, py - 6 + i, 1, 1, PAL.butter);
      fill(g, px + 6 + i, py - 6 + i, 1, 1, PAL.butter);
    }
    fill(g, px + 6, py - 7, 2, 2, PAL.ink);
    blit(g, portrait, px, py);
    blit(g, broom, 3, floorY - broom.height + 1);
    blit(g, book, W - 15, floorY - book.height + 1);
    for (const d of decor) blit(g, d.img, d.x - Math.floor(d.img.width / 2), shelfY - d.img.height);
    for (const c of candles) blit(g, candleWax, c, shelfY - candleWax.height);
    return canvas;
  }

  function shelfBoard(p: Painter, x: number, y: number, w: number) {
    for (let i = 0; i < w; i++) {
      p.set(x + i, y, PAL.ink);
      p.set(x + i, y + 1, PAL.ember);
      p.set(x + i, y + 2, PAL.wood);
      p.set(x + i, y + 3, PAL.ink);
    }
    for (const bx of [x + 3, x + w - 6]) {
      for (let j = 0; j < 5; j++) {
        p.set(bx, y + 4 + j, PAL.ink);
        p.set(bx + 1, y + 4 + j, j < 4 - j ? PAL.wood : PAL.ink);
        if (j < 3) p.set(bx + 2, y + 4 + j, j < 2 ? PAL.wood : PAL.ink);
        if (j < 1) p.set(bx + 3, y + 4, PAL.ink);
      }
    }
  }

  const trophyY = () => floorY - 36;

  layout();
  scr.onResize(layout);
  session.on("insets", layout);

  // ---- world state -----------------------------------------------------------------------------
  let mode: "attract" | "play" | "over" = "attract";
  let time = 0;
  let runTime = 0;
  let score = 0;
  let hearts = HEARTS;
  let recipes = 0;
  let caught = 0;
  let items: Item[] = [];
  let spawnT = 0.6;
  let sinceNeed = 0;
  let recipe: Recipe = newRecipe();
  let cardIn = 1;
  let tint: [string, string] = MURKY;
  let potX = W / 2;
  let potTarget = W / 2;
  let potVel = 0;
  let squash = 0;
  let boilT = 0;
  let dyingT = -1;
  let signDown = 1;
  let scorePop = 0;
  let heartPop = -1;
  const popups: Popup[] = [];
  const potions: Array<[string, string]> = [];
  const flying: Flying[] = [];
  const catState = { x: Math.round(W * 0.62), mode: "sit" as "sit" | "crouch" | "hop" | "swat", t: 0, from: 0, to: 0, dir: -1, next: 3, blink: 2.2, swish: 0 };

  function difficulty() {
    return tuning(mode === "attract" ? 14 : runTime, mode === "attract" ? 2 : recipes);
  }

  function newRecipe(): Recipe {
    const tn = tuning(runTime, recipes);
    const pool = KINDS.slice(0, tn.pool);
    const kinds: Kind[] = [];
    for (let i = 0; i < tn.length; i++) {
      let k = rng.pick(pool);
      for (let guard = 0; guard < 8 && (k === kinds[i - 1] || kinds.filter((x) => x === k).length >= 2); guard++) k = rng.pick(pool);
      kinds.push(k);
    }
    return { kinds, step: 0, time: 0, limit: tn.length * tn.perStep };
  }

  function needed(): Kind | null {
    return recipe.kinds[recipe.step] ?? null;
  }

  function resetWorld(next: "attract" | "play") {
    mode = next;
    items = [];
    runTime = 0;
    score = 0;
    hearts = HEARTS;
    recipes = 0;
    caught = 0;
    spawnT = next === "play" ? 0.5 : 0.3;
    sinceNeed = 0;
    tint = MURKY;
    boilT = 0;
    dyingT = -1;
    potions.length = 0;
    flying.length = 0;
    popups.length = 0;
    fx.clear();
    recipe = newRecipe();
    cardIn = next === "play" ? 0 : 1;
  }

  // ---- spawning --------------------------------------------------------------------------------
  function spawnItem(kind: Kind, x: number, fromCat = false, dir = 0) {
    const tn = difficulty();
    items.push({
      kind,
      x,
      y: shelfY - 5,
      vx: fromCat ? dir * rng.range(18, 30) : rng.range(-10, 10),
      vy: fromCat ? -38 : -18,
      rot: 0,
      rotT: 0,
      state: fromCat ? "fall" : "wobble",
      t: 0,
      wobble: tn.wobble,
      bounced: false,
    });
  }

  function pickKind(): Kind {
    const tn = difficulty();
    const need = needed();
    const pool = KINDS.slice(0, tn.pool);
    if (need && (sinceNeed >= 2 || rng.chance(tn.need))) {
      sinceNeed = 0;
      return need;
    }
    sinceNeed++;
    const others = pool.filter((k) => k !== need);
    return rng.pick(others.length ? others : pool);
  }

  function freeX(): number {
    for (let guard = 0; guard < 12; guard++) {
      const x = Math.round(rng.range(9, W - 9));
      if (Math.abs(x - catState.x) < 10) continue;
      if (items.some((it) => it.state === "wobble" && Math.abs(it.x - x) < 11)) continue;
      return x;
    }
    return Math.round(rng.range(9, W - 9));
  }

  // ---- catching --------------------------------------------------------------------------------
  const potTop = () => floorY - POT_H;
  const rimY = () => potTop() + 3;

  function catchItem(it: Item) {
    const need = needed();
    const cx = Math.round(potX);
    const y = rimY();
    if (it.kind === need) {
      recipe.step++;
      caught++;
      tint = TINT[it.kind];
      squash = 1;
      const pts = 10;
      if (mode === "play") {
        score += pts;
        scorePop = 0.15;
        popups.push({ text: `+${pts}`, x: cx, y: y - 10, t: 0, life: 0.7, color: PAL.butter });
        session.feedback("tap");
      }
      sfx.play("plink", recipe.step * 2);
      sfx.play("blub", rng.range(-2, 4), 0.7);
      fx.emit(cx, y, { count: 8, speed: [16, 40], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.9], ramp: [KEY[tint[1]]!, KEY[tint[0]]!], shape: "bubble", gravity: -10, drag: 2, spread: 6 });
      fx.emit(cx, y, { count: 6, speed: [30, 60], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [0.3, 0.55], ramp: RAMP.spark, shape: "spark", gravity: 60, drag: 1.5, spread: 4 });
      if (recipe.step >= recipe.kinds.length) finishRecipe();
    } else {
      // Boil over.
      boilT = 0.9;
      squash = -1;
      sfx.play("sputter");
      sfx.play("hiss");
      nudge.kick(2, 0.22);
      fx.emit(cx, y - 2, { count: 10, speed: [20, 45], angle: [-Math.PI, 0], life: [0.6, 1.1], ramp: RAMP.steam, shape: "steam", gravity: -18, drag: 1.2, spread: 8 });
      fx.emit(cx, y, { count: 10, speed: [25, 55], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.35, 0.7], ramp: [KEY[tint[1]]!, KEY[tint[0]]!, PAL.dusk], shape: "big", gravity: 140, spread: 8 });
      if (mode === "play") {
        loseHeart(rng.pick(["blech!", "not that!", "oh no!", "eww!"]));
        session.feedback("fail");
      }
      catState.mode = "crouch";
      catState.to = catState.x;
      catState.t = 0;
    }
  }

  function finishRecipe() {
    const cx = Math.round(potX);
    const left = Math.max(0, recipe.limit - recipe.time);
    const bonus = 50 + recipes * 10 + Math.round(left * 5);
    recipes++;
    const t: [string, string] = [...tint];
    flying.push({ x0: cx, y0: rimY() - 4, ...trophySlot(potions.length + flying.length), t: 0, tint: t });
    if (mode === "play") {
      score += bonus;
      scorePop = 0.2;
      popups.push({ text: `potion! +${bonus}`, x: cx, y: rimY() - 20, t: 0, life: 1.1, color: PAL.cream });
      session.feedback("success");
    }
    sfx.play("chime");
    nudge.kick(1, 0.1);
    fx.emit(cx, rimY() - 4, { count: 14, speed: [30, 80], angle: [-Math.PI, 0], life: [0.5, 0.9], ramp: RAMP.spark, shape: "spark", gravity: 70, drag: 1.2, spread: 6 });
    fx.emit(catState.x, shelfY - 16, { count: 3, speed: [8, 16], angle: [-Math.PI * 0.75, -Math.PI * 0.25], life: [0.9, 1.3], ramp: RAMP.heart, shape: "heart", gravity: -6 });
    sfx.play("mrrp", 2);
    tint = MURKY;
    recipe = newRecipe();
    cardIn = 0;
  }

  function trophySlot(i: number): { x1: number; y1: number } {
    const n = i % 8;
    const left = n < 4;
    const k = n % 4;
    return { x1: left ? 5 + k * 8 : W - 34 + k * 8, y1: trophyY() - 9 };
  }

  function loseHeart(msg: string) {
    hearts = Math.max(0, hearts - 1);
    heartPop = hearts;
    popups.push({ text: msg, x: Math.round(potX), y: rimY() - 16, t: 0, life: 1, color: PAL.blush });
    const hx = heartX(hearts);
    fx.emit(hx + 3, top + 5, { count: 8, speed: [15, 40], life: [0.4, 0.7], ramp: RAMP.heart, shape: "big", gravity: 80 });
    if (hearts <= 0 && dyingT < 0) {
      dyingT = 0;
      boilT = 1.6;
      sfx.play("sigh");
    }
  }

  const heartX = (i: number) => scr.safe(session.play()).x1 - 3 - HEARTS * 8 + i * 8 + 1;

  // ---- input -----------------------------------------------------------------------------------
  let grab: { potX: number; fingerX: number } | null = null;
  session.startOnTap(window);
  onDrag(window, {
    start(x) {
      if (mode !== "play") return;
      grab = { potX: potTarget, fingerX: scr.toArt(x, 0).x };
    },
    move(x) {
      if (!grab || mode !== "play") return;
      const fx0 = scr.toArt(x, 0).x;
      potTarget = clamp(grab.potX + (fx0 - grab.fingerX) * 1.3, 14, W - 14);
    },
    end() {
      grab = null;
    },
  });
  onKeys({
    left: () => {
      if (mode === "play") potTarget = clamp(potTarget - 10, 14, W - 14);
    },
    right: () => {
      if (mode === "play") potTarget = clamp(potTarget + 10, 14, W - 14);
    },
  });
  session.on("cancel", () => {
    grab = null;
  });
  session.on("start", () => {
    rng = createRng((session.ctx.seed + session.runs * 7919) >>> 0);
    resetWorld("play");
    catState.x = clamp(catState.x, cardRect().x + cardRect().w + 2, W - 36);
    potX = potTarget = Math.round(W / 2);
    sfx.play("start");
    sfx.music(true);
  });
  session.on("end", () => {
    sfx.music(false);
  });

  resetWorld("attract");

  // ---- update ----------------------------------------------------------------------------------
  function update(dt: number) {
    session.tick(dt);
    time += dt;
    nudge.update(dt);
    fx.update(dt);
    if (mode === "play" && session.phase === "playing") runTime += dt;
    const tn = difficulty();

    // Sign: hoisted away during a run, lowered in attract (and after a standalone run).
    const wantSign = mode === "attract" || (mode === "over" && session.standalone && session.phaseTime > 0.9);
    signDown = clamp(signDown + (wantSign ? dt * 2.2 : -dt * 3));
    cardIn = Math.min(1, cardIn + dt * 3.5);
    scorePop = Math.max(0, scorePop - dt);
    boilT = Math.max(0, boilT - dt);
    squash = damp(squash, 0, 14, dt);

    // Recipe candle.
    if (mode === "play" && dyingT < 0) {
      recipe.time += dt;
      if (recipe.time >= recipe.limit) {
        sfx.play("fizzle");
        fx.emit(cardRect().x + cardRect().w - 5, top + 4, { count: 5, speed: [6, 14], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.6, 1], ramp: RAMP.steam, shape: "steam", gravity: -10 });
        loseHeart("too slow...");
        session.feedback("fail");
        tint = MURKY;
        recipe = newRecipe();
        cardIn = 0;
      }
    } else if (mode === "attract") {
      recipe.time = Math.min(recipe.time + dt * 0.5, recipe.limit * 0.6);
    }

    // Spawning (not while dying or after a run).
    const spawning = mode === "attract" || (mode === "play" && dyingT < 0);
    if (spawning) {
      spawnT -= dt;
      if (spawnT <= 0) {
        spawnT = tn.interval * rng.range(0.8, 1.2);
        spawnItem(pickKind(), freeX());
        if (rng.chance(tn.double)) spawnItem(pickKind(), freeX());
      }
    }

    // Items.
    const ry = rimY();
    for (const it of items) {
      it.t += dt;
      if (it.state === "wobble") {
        if (it.t >= it.wobble) {
          it.state = "fall";
          it.t = 0;
        }
        continue;
      }
      if (it.state === "floor") continue;
      const prevY = it.y;
      it.vy = Math.min(tn.maxFall, it.vy + tn.gravity * dt);
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      if (it.x < 5 || it.x > W - 5) {
        it.vx = -it.vx * 0.6;
        it.x = clamp(it.x, 5, W - 5);
      }
      it.rotT += dt;
      if (it.rotT > 0.13) {
        it.rotT = 0;
        it.rot = (it.rot + (it.vx < 0 ? 3 : 1)) % 4;
      }
      const dx = it.x - potX;
      if (!it.bounced && prevY < ry && it.y >= ry && it.vy > 0 && dyingT < 0 && mode !== "over") {
        if (Math.abs(dx) <= MOUTH) {
          it.state = "floor";
          it.t = 99;
          catchItem(it);
          continue;
        }
        if (Math.abs(dx) <= RIM) {
          it.bounced = true;
          it.vx = Math.sign(dx || 1) * rng.range(30, 45);
          it.vy = -rng.range(35, 50);
          sfx.play("bonk", 7, 0.5);
        }
      }
      if (it.y >= floorY - 3) {
        it.y = floorY - 3;
        it.state = "floor";
        it.t = 0;
        sfx.play("bonk", rng.range(-2, 2), 0.6);
        fx.emit(it.x, floorY - 1, { count: 5, speed: [10, 26], angle: [-Math.PI, 0], life: [0.25, 0.45], ramp: RAMP.dust, shape: "dot", gravity: 60 });
      }
    }
    items = items.filter((it) => !(it.state === "floor" && it.t > 0.45));

    // The pot: follows the finger (or the attract-mode witch's ghost hand).
    if (mode === "attract") potTarget = attractTarget();
    else if (BOT && mode === "play") {
      // Playtest bot (VITE_PW_BOT builds only): the attract pilot with human-ish lag and wobble.
      botT -= dt;
      if (botT <= 0) {
        botT = rng.range(0.18, 0.32);
        potTarget = clamp(attractTarget() + rng.range(-5, 5), 14, W - 14);
      }
      (window as unknown as { __pw: unknown }).__pw = { mode, runTime, score, recipes, hearts };
    }
    const prev = potX;
    potX = damp(potX, potTarget, mode === "attract" ? 5 : 26, dt);
    potVel = (potX - prev) / Math.max(dt, 1e-4);

    // Brew bubbles and steam.
    if (rng.chance(dt * 3.5)) fx.emit(potX + rng.range(-7, 7), rimY() + 1, { count: 1, speed: [4, 8], angle: [-Math.PI / 2, -Math.PI / 2], life: [0.6, 1], ramp: [KEY[tint[1]]!, KEY[tint[0]]!], shape: "bubble", gravity: -4 });
    if (rng.chance(dt * (boilT > 0 ? 14 : 4))) fx.emit(potX + rng.range(-8, 8), rimY() - 2, { count: 1, speed: [6, 12], angle: [-Math.PI * 0.6, -Math.PI * 0.4], life: [1, 1.8], ramp: RAMP.steam, shape: "steam", gravity: -4, vx: -potVel * 0.15 });

    // Bottles flying to the trophy shelf.
    for (const f of flying) {
      f.t += dt / 0.7;
      if (f.t >= 1) {
        potions.push(f.tint);
        if (potions.length > 8) potions.shift();
        sfx.play("cork", rng.range(-1, 2));
        fx.emit(f.x1 + 3, f.y1 + 2, { count: 5, speed: [10, 25], life: [0.3, 0.6], ramp: RAMP.gold, shape: "plus", gravity: 30 });
      }
    }
    for (let i = flying.length - 1; i >= 0; i--) if (flying[i]!.t >= 1) flying.splice(i, 1);

    updateCat(dt);

    for (const p of popups) p.t += dt;
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i]!.t >= popups[i]!.life) popups.splice(i, 1);

    // Game over: the last heart boils away, then the shell gets the score.
    if (dyingT >= 0 && mode === "play") {
      dyingT += dt;
      if (dyingT > 0.85) {
        mode = "over";
        session.end(score, { outcome: "lose", stats: { potions: recipes, catches: caught } });
      }
    }
  }

  /** Attract mode: steer under the next ingredient the card asks for and away from everything else. */
  function attractTarget(): number {
    const need = needed();
    const ry = rimY();
    const predict = (it: Item) => {
      if (it.state === "wobble") return { x: it.x, t: 1.5 + it.wobble - it.t };
      const dy = Math.max(0, ry - it.y);
      const v = Math.max(20, it.vy);
      const t = dy / v;
      return { x: clamp(it.x + it.vx * t, 5, W - 5), t };
    };
    let goal = W / 2 + Math.sin(time * 0.6) * W * 0.25;
    let best = Infinity;
    for (const it of items) {
      if (it.state === "floor" || it.kind !== need || it.y > ry) continue;
      const p = predict(it);
      if (p.t < best) {
        best = p.t;
        goal = p.x;
      }
    }
    for (const it of items) {
      if (it.state === "floor" || it.kind === need || it.y > ry) continue;
      const p = predict(it);
      if (p.t < 0.9 && Math.abs(p.x - goal) < RIM + 3) goal = p.x + (p.x > W / 2 ? -1 : 1) * (RIM + 6);
    }
    return clamp(goal, 14, W - 14);
  }

  function updateCat(dt: number) {
    const c = catState;
    c.t += dt;
    c.blink -= dt;
    if (c.blink < -0.13) c.blink = rng.range(1.8, 4.2);
    c.swish = (c.swish + dt) % 1.6;
    if (c.mode === "sit") {
      c.next -= dt;
      if (c.next <= 0 && (mode !== "play" || dyingT < 0)) {
        const tn = difficulty();
        const swatChance = mode === "play" ? 0.35 + tn.d * 0.4 : 0.5;
        if (mode !== "over" && rng.chance(swatChance)) {
          c.mode = "swat";
          c.dir = c.x > W / 2 ? -1 : 1;
        } else {
          c.mode = "crouch";
          c.from = c.x;
          // During a run the cat keeps clear of the recipe card and the hearts.
          const lo = mode === "play" ? cardRect().x + cardRect().w + 2 : 8;
          const hi = mode === "play" ? W - 36 : W - 22;
          let to = c.x;
          for (let g = 0; g < 8 && Math.abs(to - c.x) < 20; g++) to = Math.round(rng.range(lo, Math.max(lo + 1, hi)));
          c.to = to;
        }
        c.t = 0;
        c.next = mode === "play" ? lerp(6, 3.5, tn.d) * rng.range(0.8, 1.3) : rng.range(3, 5);
      }
    } else if (c.mode === "crouch") {
      if (c.t > 0.3) {
        if (c.to !== c.x && Math.abs(c.to - c.x) > 2) {
          c.mode = "hop";
          c.from = c.x;
        } else c.mode = "sit";
        c.t = 0;
      }
    } else if (c.mode === "hop") {
      const k = Math.min(1, c.t / 0.5);
      c.x = Math.round(lerp(c.from, c.to, k));
      if (k >= 1) {
        c.mode = "sit";
        c.t = 0;
        fx.emit(c.x + 5, shelfY - 1, { count: 4, speed: [8, 18], angle: [-Math.PI, 0], life: [0.25, 0.4], ramp: RAMP.dust, gravity: 40 });
      }
    } else if (c.mode === "swat") {
      if (c.t > 0.22 && c.t - dt <= 0.22) {
        spawnItem(mode === "attract" ? pickKind() : rng.chance(0.3) && needed() ? needed()! : rng.pick(KINDS.slice(0, difficulty().pool)), c.x + 5 + c.dir * 9, true, c.dir);
        sfx.play("mrrp");
        sfx.play("tick", 0, 0.8);
      }
      if (c.t > 0.5) {
        c.mode = "sit";
        c.t = 0;
      }
    }
  }

  // ---- drawing ---------------------------------------------------------------------------------
  function cardRect() {
    const n = recipe.kinds.length;
    const w = 6 + n * 11 + 6;
    const x = scr.safe(session.play()).x0 + 2;
    const y = top + 2 - Math.round((1 - easeOutCubic(cardIn)) * 24);
    return { x, y, w, h: 15 };
  }

  function drawCard() {
    const r = cardRect();
    // Parchment with a dog-eared corner and a pin.
    fill(ctx, r.x, r.y, r.w, r.h, PAL.ink);
    fill(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, PAL.cream);
    fill(ctx, r.x + 1, r.y + r.h - 2, r.w - 2, 1, PAL.blush);
    fill(ctx, r.x + r.w - 2, r.y + 1, 1, r.h - 2, PAL.blush);
    fill(ctx, r.x + r.w - 3, r.y + r.h - 3, 2, 2, PAL.ink);
    fill(ctx, r.x + r.w - 2, r.y + r.h - 2, 1, 1, PAL.night);
    fill(ctx, r.x + 3, r.y - 1, 2, 2, PAL.rose);
    fill(ctx, r.x + 3, r.y - 1, 1, 1, PAL.blush);
    recipe.kinds.forEach((k, i) => {
      const ix = r.x + 3 + i * 11;
      const iy = r.y + 3;
      if (i === recipe.step) {
        // Current: a candle-colored bracket and a little bounce.
        const b = Math.floor(time * 4) % 2;
        fill(ctx, ix - 1, iy - 1, 3, 1, PAL.candle);
        fill(ctx, ix - 1, iy - 1, 1, 3, PAL.candle);
        fill(ctx, ix + 8, iy - 1, 3, 1, PAL.candle);
        fill(ctx, ix + 10, iy - 1, 1, 3, PAL.candle);
        fill(ctx, ix - 1, iy + 9, 3, 1, PAL.candle);
        fill(ctx, ix - 1, iy + 7, 1, 3, PAL.candle);
        fill(ctx, ix + 8, iy + 9, 3, 1, PAL.candle);
        fill(ctx, ix + 10, iy + 7, 1, 3, PAL.candle);
        blit(ctx, ING[k][0]!, ix, iy - b);
      } else {
        blit(ctx, ING[k][0]!, ix, iy);
        if (i < recipe.step) blit(ctx, check, ix + 5, iy + 4);
        else fill(ctx, ix + 4, iy + 10, 1, 1, PAL.blush);
      }
    });
    // The candle that times the recipe.
    const left = clamp(1 - recipe.time / recipe.limit);
    const cx = r.x + r.w - 7;
    const wax = Math.max(1, Math.round(left * 8));
    const base = r.y + r.h - 3;
    fill(ctx, cx, base - wax, 3, wax, PAL.ink);
    fill(ctx, cx + 1, base - wax + 1, 1, wax - 1, left < 0.25 ? PAL.rose : PAL.butter);
    fill(ctx, cx, base, 3, 1, PAL.wood);
    const low = left < 0.25;
    const fr = Math.floor(time * (low ? 4 : 7)) % 3;
    const fl = flames[fr]!;
    if (!(low && Math.floor(time * 4) % 4 === 3)) blit(ctx, fl, cx - 1, base - wax - 4);
  }

  function drawHud() {
    drawCard();
    const sr = scr.safe(session.play());
    for (let i = 0; i < HEARTS; i++) {
      const x = heartX(i);
      const pop = heartPop === i && boilT > 0.5 ? -1 : 0;
      blit(ctx, i < hearts ? heart : heartEmpty, x, top + 2 + pop);
    }
    const lift = scorePop > 0 ? 1 : 0;
    drawText(ctx, `${score}`, sr.x1 - 3, top + 11 - lift, PAL.butter, { align: "right", outline: PAL.ink });
  }

  function drawSign() {
    if (signDown <= 0) return;
    const safe = scr.safe(session.preview());
    const k = easeOutCubic(signDown);
    const w = title.width + 10;
    const h = title.height + 8;
    const cx = Math.round((safe.x0 + safe.x1) / 2);
    const x = cx - Math.floor(w / 2);
    const hang = shelfY + 4;
    const y = Math.round(lerp(shelfY - h - 30, hang + 6, k));
    // Ropes up to the shelf.
    for (const rx of [x + 6, x + w - 7]) {
      for (let yy = Math.max(hang, top); yy < y + 2; yy++) fill(ctx, rx, yy, 1, 1, (yy & 1) === 0 ? PAL.butter : PAL.candle);
    }
    // Planks.
    fill(ctx, x, y, w, h, PAL.ink);
    for (let j = 1; j < h - 1; j++) {
      const plankEdge = j === Math.floor(h / 2);
      fill(ctx, x + 1, y + j, w - 2, 1, plankEdge ? PAL.night : j === 1 || j === Math.floor(h / 2) + 1 ? PAL.ember : j >= h - 3 ? PAL.dusk : PAL.wood);
    }
    for (const [nx, ny] of [
      [x + 2, y + 2],
      [x + w - 3, y + 2],
      [x + 2, y + h - 3],
      [x + w - 3, y + h - 3],
    ] as const)
      fill(ctx, nx, ny, 1, 1, PAL.mauve);
    blit(ctx, title, x + 5, y + 3);
    // Best on a little paper tag.
    let below = y + h;
    const tagText = mode === "over" ? `you got ${score}` : session.best !== null ? `best ${session.best}` : "";
    if (tagText) {
      const tw = textWidth(tagText) + 6;
      const tx = cx - Math.floor(tw / 2);
      const ty = y + h + 3;
      fill(ctx, cx, y + h, 1, 3, PAL.butter);
      fill(ctx, tx, ty, tw, 11, PAL.ink);
      fill(ctx, tx + 1, ty + 1, tw - 2, 9, PAL.cream);
      fill(ctx, tx + 1, ty + 9, tw - 2, 1, PAL.blush);
      drawText(ctx, tagText, tx + 3, ty + 1, PAL.wood);
      below = ty + 11;
    }
    if (signDown < 1) return;
    // The prompt: blinks gently (under 2 Hz), with a twinkling sparkle and a heart.
    const prompt = mode === "over" ? "~ tap to stir again ~" : "~ tap to stir ~";
    const py = Math.round(lerp(below, potTop(), 0.45));
    // Breathes between cream and blush (under 1 Hz) instead of vanishing, so it always reads.
    const soft = !session.reducedMotion && time % 1.4 > 0.95;
    drawText(ctx, prompt, cx, py, soft ? PAL.blush : PAL.cream, { align: "center", outline: PAL.ink });
    const tw = textWidth(prompt);
    blit(ctx, sparkle[Math.floor(time * 1.5) % 2]!, cx + Math.ceil(tw / 2) + 5, py + 4, true);
    drawText(ctx, "♥", cx - Math.ceil(tw / 2) - 8, py + 1 - (soft ? 1 : 0), PAL.rose, { outline: PAL.ink });
  }

  function drawCat() {
    const c = catState;
    let img = cat.sit;
    let yOff = 0;
    if (c.mode === "crouch") img = cat.crouch;
    else if (c.mode === "hop") {
      const k = Math.min(1, c.t / 0.5);
      yOff = -Math.round(Math.sin(k * Math.PI) * 6);
      img = cat.crouch;
    } else if (c.mode === "swat") img = c.dir < 0 ? cat.swatL : cat.swatR;
    else if (c.blink < 0) img = cat.blink;
    else if (c.swish > 1.2) img = cat.swish;
    const dx = c.mode === "swat" ? -2 : 0;
    blit(ctx, img, c.x + dx, shelfY - img.height + yOff);
  }

  function drawItem(it: Item) {
    let x = it.x;
    let img = ING[it.kind][it.rot]!;
    if (it.state === "wobble") {
      img = ING[it.kind][0]!;
      x += Math.floor(it.t * 14) % 2 === 0 ? 0 : it.t > it.wobble * 0.5 ? 1 : 0;
    }
    // Landed ones blink out (a short pixel fade, not a flash).
    if (it.state === "floor" && Math.floor(it.t * 8) % 2 === 1) return;
    blit(ctx, img, x, it.y, true);
  }

  function drawPot() {
    const cx = Math.round(potX);
    const x = cx - POT_W / 2;
    const y = potTop();
    // Fire between the legs.
    blit(ctx, fire[Math.floor(time * 8) % fire.length]!, cx - 7, floorY - 7);
    const img = pot(tint);
    if (squash > 0.35) ctx.drawImage(img, x - 1, y + 1, POT_W + 2, POT_H - 1);
    else if (squash < -0.35) ctx.drawImage(img, x + 1, y - 1, POT_W - 2, POT_H + 1);
    else ctx.drawImage(img, x, y);
    if (boilT > 0) {
      const frames = foam(tint);
      blit(ctx, frames[Math.floor(time * 6) % frames.length]!, x, y - 1);
    }
  }

  function drawPotions() {
    potions.forEach((t, i) => {
      const s = trophySlot(i);
      blit(ctx, bottle(t), s.x1, s.y1);
    });
    for (const f of flying) {
      const k = easeOutCubic(Math.min(1, f.t));
      const x = lerp(f.x0, f.x1, k);
      const y = lerp(f.y0, f.y1, k) - Math.sin(k * Math.PI) * 30;
      blit(ctx, bottle(f.tint), x, y);
    }
  }

  function drawPopups() {
    for (const p of popups) {
      const rise = Math.floor(Math.min(p.t, 0.5) * 20);
      if (p.t > p.life - 0.2 && Math.floor(p.t * 10) % 2 === 1) continue;
      drawText(ctx, p.text, clamp(p.x, textWidth(p.text) / 2 + 2, W - textWidth(p.text) / 2 - 2), p.y - rise, p.color, { align: "center", outline: PAL.ink });
    }
  }

  function render() {
    const o = nudge.offset(time);
    ctx.save();
    ctx.translate(o.x, o.y);
    if (bg) ctx.drawImage(bg, 0, 0);
    // Candle flames on the shelf.
    candles.forEach((c, i) => blit(ctx, flames[(Math.floor(time * 6) + i) % 3]!, c, shelfY - candleWax.height - 4));
    drawPotions();
    for (const it of items) if (it.state === "wobble") drawItem(it);
    drawCat();
    drawPot();
    for (const it of items) if (it.state !== "wobble") drawItem(it);
    fx.draw(ctx);
    drawPopups();
    ctx.restore();
    if (mode === "play" || (mode === "over" && !session.standalone)) drawHud();
    drawSign();
    scr.present();
  }

  if (BOT) session.on("end", (e) => ((window as unknown as { __pwEnd: unknown }).__pwEnd = { score: e.score, runTime, recipes }));

  let readySent = false;
  tc.loop((dt) => {
    update(dt);
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
