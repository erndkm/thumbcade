import { clamp, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { onKeys, onPress } from "@thumbcade-games/kit/input";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import * as ART from "./art.ts";
import { chunkyTitle, drawText, textWidth } from "./font.ts";
import { Nudge, PixelParticles, RAMP } from "./fx.ts";
import { PAL } from "./palette.ts";
import { blit, createPixelScreen, dither, ellipse, fill, flipRows, line, Painter, sprite } from "./pixel.ts";
import { createSound } from "./sound.ts";

// ---------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------
/** Seconds from moonrise to dawn. */
const NIGHT = 65;
/** A fight already on the line at dawn may finish, for at most this long. */
const GRACE = 8;
const ATTRACT_MOON = 0.24;
const BOT = !!import.meta.env.VITE_PW_BOT;

type Species = "minnow" | "perch" | "carp" | "koi";
interface Spec {
  name: string;
  grams: [number, number];
  /** Depth band: 0 = far shore, 1 = right by the dock. */
  band: [number, number];
  zone: [number, number];
  decay: number;
  surgeEvery: number;
  surge: number;
  reel: number;
  window: number;
  speed: number;
}
const SPECS: Record<Species, Spec> = {
  minnow: { name: "minnow", grams: [6, 24], band: [0.55, 1], zone: [0.2, 0.86], decay: 0.34, surgeEvery: 0, surge: 0, reel: 30, window: 0.72, speed: 9 },
  perch: { name: "perch", grams: [110, 420], band: [0.3, 0.82], zone: [0.28, 0.8], decay: 0.42, surgeEvery: 2.6, surge: 0.75, reel: 20, window: 0.62, speed: 7 },
  carp: { name: "carp", grams: [900, 2400], band: [0.04, 0.5], zone: [0.33, 0.75], decay: 0.48, surgeEvery: 1.9, surge: 0.9, reel: 14, window: 0.54, speed: 5 },
  koi: { name: "golden koi", grams: [3000, 5000], band: [0, 0.3], zone: [0.38, 0.7], decay: 0.55, surgeEvery: 1.5, surge: 1, reel: 12, window: 0.46, speed: 6 },
};

type FishState = "wander" | "approach" | "nibble" | "bite" | "hooked" | "flee" | "gone";
interface Fish {
  sp: Species;
  x: number;
  y: number;
  tx: number;
  ty: number;
  face: -1 | 1;
  state: FishState;
  t: number;
  life: number;
}

type RodState = "aim" | "cast" | "wait" | "reel" | "land" | "rest";
interface Rig {
  state: RodState;
  t: number;
  power: number;
  bx: number;
  by: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  waitT: number;
  checkT: number;
  fish: Fish | null;
  nibbles: number;
  nibT: number;
  biteT: number;
  twitch: number;
  tension: number;
  slack: number;
  dist: number;
  dist0: number;
  surgeT: number;
  surgeCd: number;
  creakT: number;
  jiggle: number;
  landed: { sp: Species; grams: number; x0: number; y0: number; t: number } | null;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
}

async function main() {
  const session = await createSession({ id: "bobberlight" });
  const scr = createPixelScreen();
  const { ctx } = scr;
  const sfx = createSound();
  const fx = new PixelParticles(500);
  const nudge = new Nudge(session.reducedMotion);
  let rng: Rng = createRng(session.ctx.seed);

  // ---- sprites ---------------------------------------------------------------------------------
  const both = (rows: readonly string[]) => [sprite(rows), sprite(flipRows(rows))] as const;
  const cat = {
    sit: sprite(ART.CAT.sit),
    blink: sprite(ART.CAT.blink),
    swish: sprite(ART.CAT.swish),
    back: sprite(ART.CAT.back),
    backSwish: sprite(ART.CAT.backSwish),
  };
  const witch = sprite(ART.WITCH);
  const shadows = Object.fromEntries((Object.keys(ART.SHADOW) as Species[]).map((k) => [k, ART.SHADOW[k].map((f) => both(f))])) as Record<Species, Array<readonly [HTMLCanvasElement, HTMLCanvasElement]>>;
  const fishImg = Object.fromEntries((Object.keys(ART.FISH) as Species[]).map((k) => [k, both(ART.FISH[k])])) as Record<Species, readonly [HTMLCanvasElement, HTMLCanvasElement]>;
  const bobberImg = sprite(ART.BOBBER);
  const bobberTop = sprite(ART.BOBBER.slice(0, 3));
  const bobberDip = sprite(ART.BOBBER.slice(0, 2));
  const moonImg = sprite(ART.MOON);
  const lantern = ART.LANTERN.map((l) => sprite(l));
  const basket = sprite(ART.BASKET);
  const lily = ART.LILY.map((l) => sprite(l));
  const flower = sprite(ART.FLOWER);
  const frog = ART.FROG.map((f) => sprite(f));
  // Lean the top of the reeds one pixel for the second sway frame.
  const lean = ART.REEDS.map((r, i) => (i < 9 ? `.${r.slice(0, -1)}` : r));
  const reeds = [both(ART.REEDS), both(lean)];
  const cottage = sprite(ART.COTTAGE);
  const sparkle = ART.SPARKLE.map((s) => sprite(s));
  const title = chunkyTitle("bobberlight", { fill: "y", light: "c", dark: "o", outline: "k", shadow: "n" });

  // ---- layout ----------------------------------------------------------------------------------
  let W = scr.w;
  let H = scr.h;
  let top = 0;
  let horizon = 100;
  let dockY = 182;
  let pierX = 47;
  let backdrop: HTMLCanvasElement | null = null;
  let backdropLevel = -1;
  let shore: HTMLCanvasElement | null = null;
  let pier: HTMLCanvasElement | null = null;
  const stars: Array<{ x: number; y: number; tw: boolean; ph: number }> = [];
  const shimmer: Array<{ x: number; y: number; len: number; ph: number }> = [];
  const flies: Array<{ x: number; y: number; ph: number; r: number }> = [];
  const pads: Array<{ x: number; y: number; img: HTMLCanvasElement }> = [];

  function layout() {
    W = scr.w;
    H = scr.h;
    top = scr.safe(session.play()).y0;
    horizon = Math.round(H * 0.4);
    dockY = H - clamp(Math.round(H * 0.28), 56, 84);
    pierX = Math.round(W * 0.36);
    stars.length = 0;
    const r = createRng(99);
    for (let i = 0; i < 30; i++) stars.push({ x: r.int(2, W - 3), y: r.int(2, horizon - 14), tw: i % 6 === 0, ph: r.range(0, 6) });
    shimmer.length = 0;
    for (let i = 0; i < 34; i++) shimmer.push({ x: r.int(0, W), y: r.int(horizon + 3, H - 4), len: r.int(2, 5), ph: r.range(0, 6) });
    flies.length = 0;
    for (let i = 0; i < 8; i++) flies.push({ x: r.range(6, W - 6), y: r.range(horizon - 16, dockY + 10), ph: r.range(0, 9), r: r.range(5, 12) });
    pads.length = 0;
    pads.push({ x: Math.round(W * 0.7), y: horizon + 22, img: lily[1]! });
    pads.push({ x: Math.round(W * 0.08), y: horizon + 40, img: lily[0]! });
    pads.push({ x: Math.round(W * 0.78), y: dockY - 10, img: lily[0]! });
    backdropLevel = -1;
    shore = paintShore();
    pier = paintPier();
  }

  /** Sky and pond for a given dawn level (0 = deep night, 10 = first light). */
  function paintBackdrop(level: number): HTMLCanvasElement {
    const k = level / 10;
    const p = new Painter(W, H);
    const skyRamp = [PAL.ink, PAL.night, PAL.dusk, PAL.mauve, PAL.rose, PAL.blush, PAL.candle];
    const band = (ramp: readonly string[], v: number, x: number, y: number) => {
      const l = clamp(v, 0, ramp.length - 1.001);
      const i = Math.floor(l);
      const f = clamp((l - i - 0.3) / 0.4);
      return dither(x, y, f) ? ramp[i + 1]! : ramp[i]!;
    };
    for (let y = 0; y < horizon; y++) {
      const u = y / horizon;
      const v = lerp(0.1, 1.5, k) + u ** 1.5 * lerp(2.9, 4.6, k);
      for (let x = 0; x < W; x++) p.set(x, y, band(skyRamp, v, x, y));
    }
    const waterRamp = [PAL.ink, PAL.night, PAL.pond, PAL.teal];
    for (let y = horizon; y < H; y++) {
      const off = y - horizon;
      const v = off / (H - horizon);
      // Near the shore every other row mirrors the sky, a shade darker: the pond holds the night's color.
      const mirror = v < 0.24 && off % 2 === 1;
      const my = Math.max(0, horizon - 1 - off * 2);
      for (let x = 0; x < W; x++) {
        if (mirror && dither(x, y, 1 - v * 3.2)) {
          const u = my / horizon;
          const sv = lerp(0.1, 1.5, k) + u ** 1.5 * lerp(2.9, 4.6, k) - 1;
          p.set(x, y, band(skyRamp, sv, x, y));
          continue;
        }
        p.set(x, y, band(waterRamp, lerp(2.35, 1.05, v ** 0.85), x, y));
      }
    }
    return p.toCanvas();
  }

  /** Far shore: a tree line with the cottage (window lit). Transparent canvas. */
  function paintShore(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = horizon + 12;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    const r = createRng(7);
    const heights = new Array<number>(W).fill(2);
    let x = 0;
    while (x < W) {
      const pine = r.chance(0.4);
      const w = pine ? r.int(5, 7) : r.int(8, 14);
      const h = pine ? r.int(9, 14) : r.int(5, 9);
      for (let i = 0; i < w && x + i < W; i++) {
        const t = (i - (w - 1) / 2) / ((w - 1) / 2 || 1);
        const hh = pine ? h - Math.abs(i - (w - 1) / 2) * 2 + 1 : h * Math.sqrt(Math.max(0, 1 - t * t)) + 1;
        heights[x + i] = Math.max(heights[x + i]!, Math.round(hh));
      }
      x += Math.round(w * 0.7);
    }
    for (let i = 0; i < W; i++) {
      const h = heights[i]!;
      fill(g, i, horizon - h, 1, h + 2, PAL.ink);
      // Moonlit rim on the crowns.
      if ((heights[i - 1] ?? 0) <= h && h > 3) fill(g, i, horizon - h, 1, 1, PAL.night);
      // Broken reflection in the water.
      for (let j = 2; j < Math.round(h * 0.6) + 2; j += 2) fill(g, i, horizon + j, 1, 1, PAL.night);
    }
    blit(g, cottage, Math.round(W * 0.12), horizon - cottage.height + 1);
    return c;
  }

  /** The dock, seen from behind the witch. Transparent canvas. */
  function paintPier(): HTMLCanvasElement {
    const p = new Painter(W, H);
    const img = p.img.data;
    img.fill(0);
    const set = (x: number, y: number, c: string) => p.set(x, y, c);
    const lantX = pierX - 15;
    let next = dockY + 3;
    let gap = 3;
    for (let y = dockY; y < H; y++) {
      const f = (y - dockY) / (H - dockY);
      const hw = Math.round(lerp(15, 27, f));
      const seam = y === next;
      if (seam) {
        gap += 0.7;
        next = Math.round(y + gap);
      }
      const plankTop = y === next - Math.round(gap) + 1;
      for (let x = pierX - hw - 2; x <= pierX + hw + 2; x++) {
        const edge = Math.abs(x - pierX);
        if (edge > hw + 2) continue;
        if (edge > hw) {
          set(x, y, edge === hw + 2 ? PAL.ink : PAL.night);
          continue;
        }
        if (y === dockY) {
          set(x, y, PAL.ink);
          continue;
        }
        const light = Math.exp(-((x - lantX) ** 2 + (y - dockY) ** 2) / (2 * 22 * 22));
        let c: string = seam ? PAL.ink : PAL.wood;
        if (!seam) {
          if (plankTop || y === dockY + 1) c = light > 0.35 ? PAL.candle : PAL.ember;
          else if (light > 0.5 && dither(x, y, (light - 0.5) * 2)) c = PAL.ember;
          else if (light < 0.18 && dither(x, y, (0.18 - light) * 4)) c = PAL.dusk;
          if ((x * 7 + Math.floor(y / 5) * 13) % 23 === 0) c = PAL.dusk;
        }
        set(x, y, c);
      }
    }
    // Mooring posts at the end.
    for (const px0 of [pierX - 16, pierX + 14]) {
      for (let j = 0; j < 7; j++) {
        set(px0, dockY - 6 + j, PAL.ink);
        set(px0 + 1, dockY - 6 + j, j === 0 ? PAL.ink : PAL.wood);
        set(px0 + 2, dockY - 6 + j, j === 0 ? PAL.ink : PAL.dusk);
        set(px0 + 3, dockY - 6 + j, PAL.ink);
      }
      set(px0 + 1, dockY - 5, PAL.ember);
    }
    const c = p.toCanvas();
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    blit(g, basket, pierX + 7, H - 24);
    return c;
  }

  layout();
  scr.onResize(layout);
  session.on("insets", layout);

  // ---- world state -----------------------------------------------------------------------------
  let mode: "attract" | "play" | "over" = "attract";
  let time = 0;
  let night = 0;
  let grace = 0;
  let total = 0;
  let caught = 0;
  let biggest = 0;
  let basketCount = 0;
  let hintReel = true;
  let hintCast = true;
  let fishes: Fish[] = [];
  const popups: Popup[] = [];
  const ripples: Array<{ x: number; y: number; t: number; big: boolean }> = [];
  let signUp = 1;
  let catHappy = 0;
  let catBlink = 2;
  let ai = { aimAt: 0.5, react: -99, lastTap: 0 };
  let dawnSaid = false;

  const rig: Rig = {
    state: "aim",
    t: 0,
    power: 0,
    bx: 0,
    by: 0,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    waitT: 0,
    checkT: 0,
    fish: null,
    nibbles: 0,
    nibT: 0,
    biteT: 0,
    twitch: 0,
    tension: 0.5,
    slack: 0,
    dist: 0,
    dist0: 1,
    surgeT: 0,
    surgeCd: 0,
    creakT: 0,
    jiggle: 0,
    landed: null,
  };

  const moonK = () => (mode === "attract" ? ATTRACT_MOON : clamp(night / NIGHT));
  const pondY = (f: number) => lerp(horizon + 8, dockY - 10, f);
  const reelPoint = () => ({ x: pierX + 12, y: dockY - 4 });

  function spawnFish(sp: Species, edge = false): Fish {
    const s = SPECS[sp];
    const y = pondY(rng.range(s.band[0], s.band[1]));
    const fromLeft = rng.chance(0.5);
    const x = edge ? (fromLeft ? -8 : W + 8) : rng.range(10, W - 10);
    const f: Fish = { sp, x, y, tx: x, ty: y, face: fromLeft ? 1 : -1, state: "wander", t: 0, life: sp === "koi" ? 26 : 1e9 };
    pickTarget(f);
    return f;
  }

  function pickTarget(f: Fish) {
    const s = SPECS[f.sp];
    f.tx = rng.range(8, W - 8);
    f.ty = pondY(rng.range(s.band[0], s.band[1]));
  }

  function resetWorld(next: "attract" | "play") {
    mode = next;
    night = 0;
    grace = 0;
    total = 0;
    caught = 0;
    biggest = 0;
    basketCount = 0;
    dawnSaid = false;
    fishes = [];
    for (const sp of ["minnow", "minnow", "minnow", "perch", "perch", "carp", "carp"] as Species[]) fishes.push(spawnFish(sp));
    popups.length = 0;
    ripples.length = 0;
    fx.clear();
    toAim();
  }

  // ---- the rig ---------------------------------------------------------------------------------
  function anglerBase(): { x: number; y: number } {
    return mode === "attract" ? { x: pierX + 3, y: dockY - 9 } : { x: pierX + 4, y: dockY - 12 };
  }

  function rodTip(): { x: number; y: number } {
    const b = anglerBase();
    let dx = 11;
    let dy = -19;
    if (rig.state === "cast" && rig.t < 0.12) {
      dx = -3;
      dy = -20;
    } else if (rig.state === "cast" || rig.state === "wait") {
      dx = 15;
      dy = -15;
    } else if (rig.state === "reel") {
      dx = 15;
      dy = -14 + Math.round(rig.tension * 7) + (rig.jiggle > 0 ? 1 : 0);
    }
    return { x: b.x + dx, y: b.y + dy };
  }

  function toAim() {
    rig.state = "aim";
    rig.t = 0;
    rig.power = 0;
    rig.fish = null;
    rig.landed = null;
    ai = { aimAt: rng.range(0.15, 0.95), react: -99, lastTap: 0 };
  }

  function castTarget(power: number): { x: number; y: number } {
    const tip = rodTip();
    return { x: clamp(tip.x + lerp(4, 30, power), 8, W - 12), y: Math.round(pondY(lerp(1, 0.02, power))) };
  }

  function act() {
    switch (rig.state) {
      case "aim": {
        const tgt = castTarget(rig.power);
        rig.state = "cast";
        rig.t = 0;
        const tip = rodTip();
        rig.fromX = tip.x;
        rig.fromY = tip.y;
        rig.toX = tgt.x + rng.range(-3, 3);
        rig.toY = tgt.y;
        hintCast = false;
        sfx.play("swish");
        break;
      }
      case "wait": {
        const f = rig.fish;
        if (f && rig.biteT > 0) {
          hook(f);
        } else if (f) {
          scare(f);
          rig.fish = null;
          rig.waitT = 0;
          say("too soon!", rig.bx, rig.by - 10, PAL.blush);
          sfx.play("aww", 5, 0.6);
        } else {
          // Nothing biting: wind the line back in and cast again.
          retrieve();
        }
        break;
      }
      case "reel": {
        rig.tension += 0.12;
        rig.jiggle = 0.06;
        const s = SPECS[rig.fish?.sp ?? "minnow"];
        if (rig.tension >= s.zone[0] && rig.tension <= s.zone[1]) rig.dist -= 1.5;
        sfx.play("click", rig.tension * 10);
        break;
      }
      default:
        break;
    }
  }

  function retrieve() {
    rig.state = "rest";
    rig.t = 0;
    rig.fish = null;
    rig.fromX = rig.bx;
    rig.fromY = rig.by;
    sfx.play("click", 4);
  }

  function hook(f: Fish) {
    const s = SPECS[f.sp];
    f.state = "hooked";
    rig.state = "reel";
    rig.t = 0;
    rig.tension = (s.zone[0] + s.zone[1]) / 2;
    rig.slack = 0;
    const rp = reelPoint();
    rig.fromX = rig.bx;
    rig.fromY = rig.by;
    rig.dist0 = rig.dist = Math.max(8, Math.hypot(rig.bx - rp.x, rig.by - rp.y));
    rig.surgeT = 0;
    rig.surgeCd = s.surgeEvery * rng.range(0.6, 1);
    sfx.play("hooked");
    nudge.kick(1, 0.1);
    say("hooked!", rig.bx, rig.by - 10, PAL.butter);
    session.feedback("impact");
    splash(rig.bx, rig.by, 6);
  }

  function lose(kind: "snap" | "slack") {
    const f = rig.fish;
    if (f) scare(f);
    rig.fish = null;
    rig.state = "rest";
    rig.t = 0;
    rig.fromX = rig.bx;
    rig.fromY = rig.by;
    if (kind === "snap") {
      sfx.play("snap");
      sfx.play("twang");
      nudge.kick(2, 0.18);
      say("snap!", rig.bx, rig.by - 10, PAL.rose);
      session.feedback("fail");
    } else {
      sfx.play("aww");
      say("it got away...", rig.bx, rig.by - 10, PAL.mist);
      session.feedback("fail");
    }
  }

  function land() {
    const f = rig.fish!;
    const s = SPECS[f.sp];
    const grams = Math.round(rng.range(s.grams[0], s.grams[1]));
    rig.state = "land";
    rig.t = 0;
    rig.landed = { sp: f.sp, grams, x0: f.x, y0: f.y, t: 0 };
    f.state = "gone";
    rig.fish = null;
    splash(f.x, f.y, 10);
    sfx.play("flop");
  }

  function landedHome() {
    const l = rig.landed!;
    const s = SPECS[l.sp];
    if (mode === "play") {
      total += l.grams;
      caught++;
      biggest = Math.max(biggest, l.grams);
      session.feedback("success");
    }
    basketCount++;
    hintReel = false;
    catHappy = 1.4;
    const bx = pierX + 12;
    const by = H - 26;
    say(`${s.name} ${l.grams} g`, pierX, dockY - 30, l.sp === "koi" ? PAL.butter : PAL.cream, 1.4);
    sfx.play(l.sp === "koi" ? "golden" : "landed");
    sfx.play("mrrp", 3);
    fx.emit(bx, by, { count: l.sp === "koi" ? 22 : 10, speed: [20, 60], angle: [-Math.PI, 0], life: [0.5, 1], ramp: RAMP.spark, shape: "spark", gravity: 50, drag: 1 });
    fx.emit(catPos().x + 5, catPos().y - 2, { count: 3, speed: [8, 16], angle: [-Math.PI * 0.75, -Math.PI * 0.25], life: [0.9, 1.3], ramp: RAMP.heart, shape: "heart", gravity: -6 });
  }

  /** A spooked fish darts away from the bobber. */
  function scare(f: Fish) {
    f.state = "flee";
    f.t = 0;
    f.face = f.x < rig.bx ? -1 : 1;
  }

  function say(text: string, x: number, y: number, color: string, life = 1) {
    // The attract demo stays wordless; the title and prompt do the talking.
    if (mode === "attract") return;
    popups.push({ text, x, y, t: 0, life, color });
  }

  function splash(x: number, y: number, n: number) {
    ripples.push({ x, y, t: 0, big: n > 6 });
    fx.emit(x, y, { count: n, speed: [15, 40], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.3, 0.6], ramp: RAMP.water, shape: "dot", gravity: 140 });
  }

  // ---- input -----------------------------------------------------------------------------------
  session.startOnTap(window);
  onPress(window, () => {
    if (mode === "play" && session.phase === "playing" && night < NIGHT) act();
    else if (mode === "play" && session.phase === "playing" && rig.state === "reel") act();
  });
  onKeys({
    action: () => {
      if (mode === "play" && session.phase === "playing") act();
    },
  });
  session.on("start", () => {
    rng = createRng((session.ctx.seed + session.runs * 7919) >>> 0);
    resetWorld("play");
    hintCast = session.runs <= 1;
    hintReel = session.runs <= 1;
    sfx.play("start");
    sfx.music(true);
  });
  session.on("end", () => sfx.music(false));

  resetWorld("attract");

  // ---- update ----------------------------------------------------------------------------------
  function update(dt: number) {
    session.tick(dt);
    time += dt;
    nudge.update(dt);
    fx.update(dt);
    if (mode === "play" && session.phase === "playing") night += dt;
    const k = moonK();
    const level = Math.min(10, Math.floor(k * 10.99));
    if (level !== backdropLevel) {
      backdrop = paintBackdrop(level);
      backdropLevel = level;
    }
    const wantSign = mode === "attract" || (mode === "over" && session.standalone && session.phaseTime > 1);
    signUp = clamp(signUp + (wantSign ? dt * 1.6 : -dt * 2.2));
    catHappy = Math.max(0, catHappy - dt);
    catBlink -= dt;
    if (catBlink < -0.13) catBlink = rng.range(1.8, 4.2);

    // Wariness grows through the night: shorter bite windows, slipperier fish.
    const wary = mode === "play" ? k : 0.2;
    updateFish(dt);
    updateRig(dt, wary);
    if (mode === "attract" || BOT) attractPilot(dt);

    for (const r of ripples) r.t += dt;
    for (let i = ripples.length - 1; i >= 0; i--) if (ripples[i]!.t > (ripples[i]!.big ? 1.2 : 0.8)) ripples.splice(i, 1);
    for (const p of popups) p.t += dt;
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i]!.t >= popups[i]!.life) popups.splice(i, 1);

    // Dawn ends the night. A fish already on the line may be landed first.
    if (mode === "play") {
      if (!dawnSaid && night > NIGHT - 10) {
        dawnSaid = true;
        say("the sky is getting light...", W / 2, horizon + 10, PAL.blush, 2.2);
      }
      if (night >= NIGHT) {
        const fighting = rig.state === "reel" || rig.state === "land";
        if (fighting && grace < GRACE) grace += dt;
        else endNight();
      }
    }
    if (BOT && mode === "play") (window as unknown as { __pw: unknown }).__pw = { night, total, caught };
  }

  function endNight() {
    if (mode !== "play") return;
    mode = "over";
    if (rig.state === "wait" || rig.state === "cast" || rig.state === "aim") retrieve();
    sfx.play("dawn");
    say("dawn ~ good night, fish", W / 2, horizon + 10, PAL.cream, 2.4);
    session.end(total, { outcome: total > 0 ? "win" : "lose", stats: { fish: caught, biggest } });
  }

  function updateFish(dt: number) {
    for (const f of fishes) {
      const s = SPECS[f.sp];
      f.t += dt;
      f.life -= dt;
      if (f.state === "wander") {
        const dx = f.tx - f.x;
        const dy = f.ty - f.y;
        const d = Math.hypot(dx, dy);
        if (d < 2) pickTarget(f);
        else {
          f.x += (dx / d) * s.speed * dt;
          f.y += (dy / d) * s.speed * 0.5 * dt;
          if (Math.abs(dx) > 1) f.face = dx > 0 ? 1 : -1;
        }
        if (f.life < 0) scare(f);
      } else if (f.state === "approach") {
        const img = shadows[f.sp][0]![0];
        const head = { x: rig.bx + (f.face < 0 ? img.width / 2 - 1 : -img.width / 2 + 1), y: rig.by + 2 };
        const dx = head.x - f.x;
        const dy = head.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d < 1.5) {
          f.state = "nibble";
          rig.nibbles = rng.int(0, 2) + (f.sp === "koi" ? 1 : 0);
          rig.nibT = rng.range(0.35, 0.7);
        } else {
          const v = Math.min(d, s.speed * 2 * dt);
          f.x += (dx / d) * v;
          f.y += (dy / d) * v;
        }
      } else if (f.state === "flee") {
        f.x += f.face * s.speed * 4 * dt;
        if (f.x < -12 || f.x > W + 12) f.state = "gone";
      }
      // Hooked fish are positioned by the rig.
    }
    const before = fishes.length;
    fishes = fishes.filter((f) => f.state !== "gone");
    // Keep the pond stocked: anything that left is replaced from the edges.
    for (let i = fishes.length; i < before; i++) {
      const counts = { minnow: 0, perch: 0, carp: 0, koi: 0 };
      for (const f of fishes) counts[f.sp]++;
      const want: Species = counts.minnow < 3 ? "minnow" : counts.perch < 2 ? "perch" : "carp";
      if (fishes.length < 8) fishes.push(spawnFish(want, true));
    }
    // A golden koi drifts in now and then, later in the night.
    const kois = fishes.some((f) => f.sp === "koi");
    const koiChance = mode === "play" ? (night > 14 ? 0.05 : 0) : 0.02;
    if (!kois && rng.chance(dt * koiChance)) {
      fishes.push(spawnFish("koi", true));
      if (mode === "play") say("something golden...", W / 2, horizon + 14, PAL.butter, 1.6);
    }
  }

  function updateRig(dt: number, wary: number) {
    rig.t += dt;
    rig.twitch = Math.max(0, rig.twitch - dt);
    rig.jiggle = Math.max(0, rig.jiggle - dt);
    const tip = rodTip();
    switch (rig.state) {
      case "aim": {
        rig.bx = tip.x;
        rig.by = tip.y + 7;
        // Ping-pong power, about 1.3 s for a full swing.
        const ph = (rig.t / 1.3) % 2;
        rig.power = ph < 1 ? ph : 2 - ph;
        if (mode === "play" && night >= NIGHT) rig.power = 0;
        break;
      }
      case "cast": {
        const k = clamp((rig.t - 0.12) / 0.55);
        if (rig.t < 0.12) {
          rig.bx = tip.x;
          rig.by = tip.y + 6;
          rig.fromX = tip.x;
          rig.fromY = tip.y;
          break;
        }
        rig.bx = lerp(rig.fromX, rig.toX, k);
        rig.by = lerp(rig.fromY, rig.toY, k) - Math.sin(k * Math.PI) * 26;
        if (k >= 1) {
          rig.state = "wait";
          rig.t = 0;
          rig.waitT = 0;
          rig.checkT = 0;
          rig.biteT = 0;
          rig.fish = null;
          sfx.play("plip");
          sfx.play("splash", 0, 0.6);
          splash(rig.bx, rig.by, 5);
        }
        break;
      }
      case "wait": {
        rig.waitT += dt;
        const f = rig.fish;
        if (!f) {
          rig.checkT -= dt;
          if (rig.checkT <= 0) {
            rig.checkT = 0.3;
            const rx = 20 + rig.waitT * 5;
            const ry = 9 + rig.waitT * 2.5;
            const near = fishes.filter((c) => c.state === "wander" && Math.abs(c.x - rig.bx) < rx && Math.abs(c.y - rig.by) < ry);
            if (near.length && rng.chance(0.4)) {
              const pick = rng.pick(near);
              pick.state = "approach";
              pick.face = pick.x > rig.bx ? -1 : 1;
              rig.fish = pick;
            }
          }
          if (rng.chance(dt * 0.6)) ripples.push({ x: rig.bx, y: rig.by + 1, t: 0, big: false });
        } else if (f.state === "nibble") {
          if (rig.biteT > 0) {
            rig.biteT -= dt;
            if (rig.biteT <= 0) {
              scare(f);
              rig.fish = null;
              rig.waitT = 0;
              say("missed...", rig.bx, rig.by - 10, PAL.mist);
              sfx.play("aww", 3, 0.7);
            }
          } else {
            rig.nibT -= dt;
            if (rig.nibT <= 0) {
              if (rig.nibbles > 0) {
                rig.nibbles--;
                rig.twitch = 0.12;
                rig.nibT = rng.range(0.4, 0.85);
                sfx.play("nibble", rng.range(-2, 2));
                ripples.push({ x: rig.bx, y: rig.by + 1, t: 0, big: false });
              } else {
                rig.biteT = SPECS[f.sp].window * lerp(1, 0.78, wary);
                sfx.play("bite");
                splash(rig.bx, rig.by, 4);
                say("!", rig.bx, rig.by - 12, PAL.butter, 0.5);
                session.feedback("impact");
              }
            }
          }
        } else if (f.state !== "approach") {
          rig.fish = null;
        }
        break;
      }
      case "reel": {
        const f = rig.fish;
        if (!f) {
          toAim();
          break;
        }
        const s = SPECS[f.sp];
        const decay = s.decay * lerp(1, 1.18, wary);
        rig.tension -= decay * dt;
        if (s.surgeEvery > 0) {
          if (rig.surgeT > 0) {
            rig.surgeT -= dt;
            rig.tension += s.surge * dt;
            if (rng.chance(dt * 10)) splash(f.x, f.y, 2);
          } else {
            rig.surgeCd -= dt;
            if (rig.surgeCd <= 0) {
              rig.surgeT = rng.range(0.5, 0.85);
              rig.surgeCd = s.surgeEvery * rng.range(0.75, 1.3);
              splash(f.x, f.y, 5);
              sfx.play("splash", 3, 0.5);
            }
          }
        }
        const [lo, hi] = s.zone;
        if (rig.tension >= 1) {
          lose("snap");
          break;
        }
        rig.tension = Math.max(0, rig.tension);
        if (rig.tension < lo) {
          rig.slack += dt;
          if (rig.slack > 1.4) {
            lose("slack");
            break;
          }
        } else rig.slack = Math.max(0, rig.slack - dt * 2);
        if (rig.tension >= lo && rig.tension <= hi) rig.dist -= s.reel * dt;
        if (rig.tension > hi) {
          rig.creakT -= dt;
          if (rig.creakT <= 0) {
            rig.creakT = 0.3;
            sfx.play("creak");
          }
        }
        const rp = reelPoint();
        const k = clamp(rig.dist / rig.dist0);
        const thrash = rig.surgeT > 0 ? Math.round(Math.sin(time * 26) * 2) : 0;
        f.x = lerp(rp.x, rig.fromX, k) + thrash;
        f.y = lerp(rp.y, rig.fromY, k);
        f.face = rig.fromX > rp.x ? 1 : -1;
        rig.bx = f.x;
        rig.by = f.y - 1;
        if (rig.dist <= 0) land();
        break;
      }
      case "land": {
        const l = rig.landed!;
        l.t += dt;
        rig.bx = tip.x;
        rig.by = tip.y + 7;
        if (l.t >= 1.05) {
          landedHome();
          if (mode === "play" && night >= NIGHT) endNight();
          toAim();
        }
        break;
      }
      case "rest": {
        // Line winding back to the rod.
        const k = clamp(rig.t / 0.4);
        rig.bx = lerp(rig.fromX, tip.x, k);
        rig.by = lerp(rig.fromY, tip.y + 7, k);
        if (k >= 1) toAim();
        break;
      }
    }
  }

  /** The cat (attract) or the playtest bot: aims, waits for the dip, reels in a rhythm. */
  function attractPilot(dt: number) {
    if (mode === "over") return;
    ai.lastTap += dt;
    if (rig.state === "aim") {
      if (rig.t > 0.6 && Math.abs(rig.power - ai.aimAt) < 0.03) act();
    } else if (rig.state === "wait") {
      if (rig.fish && rig.biteT > 0) {
        // React to the dip like a person would: a beat late, now and then too late.
        if (ai.react < -50) ai.react = rng.range(0.12, BOT ? 0.42 : 0.32);
        else {
          ai.react -= dt;
          if (ai.react <= 0) {
            ai.react = -99;
            act();
          }
        }
      } else {
        ai.react = -99;
        if (!rig.fish && rig.waitT > 9) act();
      }
    } else if (rig.state === "reel" && rig.fish) {
      const s = SPECS[rig.fish.sp];
      const mid = (s.zone[0] + s.zone[1]) / 2;
      const want = rig.surgeT > 0 ? rig.tension < s.zone[0] + 0.04 : rig.tension < mid - 0.03;
      if (want && ai.lastTap > (BOT ? 0.16 : 0.12)) {
        ai.lastTap = BOT ? -rng.range(0, 0.08) : 0;
        act();
      }
    }
  }

  // ---- drawing ---------------------------------------------------------------------------------
  function catPos(): { x: number; y: number } {
    return mode === "attract" ? { x: pierX - 4, y: dockY + 2 - 14 } : { x: pierX + 10, y: dockY + 3 - 14 };
  }

  function moonPos(): { x: number; y: number } {
    const k = moonK();
    return { x: Math.round(lerp(W - 22, 20, k)), y: Math.round(lerp(top + 16, horizon - 3, k * k)) };
  }

  function drawSky() {
    if (backdrop) ctx.drawImage(backdrop, 0, 0);
    const k = moonK();
    // Stars fade as the night thins.
    const visible = Math.round(stars.length * (1 - clamp((k - 0.55) / 0.4)));
    for (let i = 0; i < visible; i++) {
      const s = stars[i]!;
      const tw = s.tw && Math.sin(time * 1.3 + s.ph) > 0.6;
      fill(ctx, s.x, s.y, 1, 1, i % 3 === 0 ? PAL.mist : PAL.cream);
      if (tw) {
        fill(ctx, s.x - 1, s.y, 3, 1, PAL.butter);
        fill(ctx, s.x, s.y - 1, 1, 3, PAL.butter);
        fill(ctx, s.x, s.y, 1, 1, PAL.cream);
      }
    }
    const m = moonPos();
    blit(ctx, moonImg, m.x, m.y, true);
    if (shore) ctx.drawImage(shore, 0, 0);
    // Smoke from the cottage chimney.
    const chx = Math.round(W * 0.12) + 9;
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.35 + i / 4) % 1;
      fill(ctx, chx + Math.round(Math.sin(t * 5 + i) * 1.5 + t * 4), horizon - 11 - Math.round(t * 14), t < 0.5 ? 2 : 1, 1, t < 0.6 ? PAL.mauve : PAL.dusk);
    }
  }

  function drawWater() {
    // Moonlight on the water: broken streaks under the moon, wobbling three times a second.
    const m = moonPos();
    const seed = Math.floor(time * 3);
    for (let y = horizon + 2; y < dockY - 2; y += 2) {
      const v = (y - horizon) / (dockY - horizon);
      const h = ((y * 73 + seed * 151) % 97) / 97;
      if (h < 0.18) continue;
      const w = Math.max(1, Math.round(lerp(10, 3, v) * (0.45 + h * 0.7)));
      const x = m.x - Math.floor(w / 2) + Math.round((h - 0.5) * 4);
      fill(ctx, x, y, w, 1, v < 0.25 ? PAL.butter : v < 0.6 ? PAL.cream : PAL.mist);
    }
    for (const s of shimmer) {
      const x = s.x + Math.round(Math.sin(time * 0.7 + s.ph) * 2);
      fill(ctx, x, s.y, s.len, 1, (s.y + Math.floor(time + s.ph)) % 3 === 0 ? PAL.mist : PAL.teal);
    }
    for (const p of pads) blit(ctx, p.img, p.x, p.y);
    blit(ctx, flower, pads[1]!.x + 2, pads[1]!.y - 3);
    blit(ctx, frog[catBlink < 0 ? 1 : 0]!, pads[0]!.x + 1, pads[0]!.y - 3);
  }

  function drawFish() {
    for (const f of fishes) {
      if (f.state === "gone") continue;
      const frame = Math.floor(time * (f.state === "flee" || f.state === "hooked" ? 10 : 4) + f.x * 0.01) % 2;
      const img = shadows[f.sp][frame]![f.face < 0 ? 0 : 1];
      blit(ctx, img, f.x, f.y, true);
      if (f.sp === "koi" && Math.floor(time * 2 + f.y) % 3 === 0) fill(ctx, Math.round(f.x) + 2, Math.round(f.y) - 3, 1, 1, PAL.cream);
    }
  }

  function drawRipples() {
    for (const r of ripples) {
      const life = r.big ? 1.2 : 0.8;
      const k = r.t / life;
      const rad = 2 + k * (r.big ? 12 : 7);
      ellipse(ctx, r.x, r.y + 1, rad, Math.max(1, rad * 0.32), k < 0.4 ? PAL.cream : k < 0.75 ? PAL.mist : PAL.teal);
    }
  }

  function drawBobber() {
    if (rig.state === "land") return;
    const x = Math.round(rig.bx) - 2;
    const y = Math.round(rig.by);
    if (rig.state === "wait" || rig.state === "reel") {
      if (rig.biteT > 0 || rig.state === "reel") blit(ctx, bobberDip, x, y);
      else {
        const bob = Math.floor(time * 1.6) % 2 === 0 ? 0 : 1;
        blit(ctx, bobberTop, x, y - 2 + bob + (rig.twitch > 0 ? 1 : 0));
        fill(ctx, x, y + 1 + bob, 5, 1, PAL.mist);
      }
    } else blit(ctx, bobberImg, x, y - 2);
  }

  function drawLine() {
    const tip = rodTip();
    const b = anglerBase();
    // The rod.
    line(ctx, b.x, b.y, tip.x, tip.y, PAL.wood);
    line(ctx, b.x + 1, b.y, tip.x + 1, tip.y, PAL.ember);
    fill(ctx, tip.x, tip.y, 1, 1, PAL.cream);
    if (rig.state === "land") return;
    // The line: a sagging curve when slack, straight when taut, rose when it's about to go.
    const s = rig.fish ? SPECS[rig.fish.sp] : null;
    const taut = rig.state === "reel";
    const sag = taut ? Math.round((1 - rig.tension) * 6) : rig.state === "wait" ? 7 : rig.state === "cast" ? 2 : 0;
    const color = taut && s && rig.tension > s.zone[1] ? PAL.rose : taut ? PAL.cream : PAL.mist;
    const ex = rig.bx;
    const ey = rig.by - (rig.state === "aim" || rig.state === "rest" || rig.state === "cast" ? 2 : 1);
    const mx = (tip.x + ex) / 2;
    const my = (tip.y + ey) / 2 + sag;
    let px = tip.x;
    let py = tip.y;
    const n = 10;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const qx = (1 - t) * (1 - t) * tip.x + 2 * (1 - t) * t * mx + t * t * ex;
      const qy = (1 - t) * (1 - t) * tip.y + 2 * (1 - t) * t * my + t * t * ey;
      line(ctx, px, py, qx, qy, color);
      px = Math.round(qx);
      py = Math.round(qy);
    }
  }

  function drawDock() {
    if (pier) ctx.drawImage(pier, 0, 0);
    // Lantern.
    blit(ctx, lantern[Math.floor(time * 5) % 3]!, pierX - 18, dockY - 14);
    // Fish tails in the basket.
    for (let i = 0; i < Math.min(4, basketCount); i++) fill(ctx, pierX + 9 + i * 2, H - 25 - (i % 2), 1, 2, i % 2 ? PAL.sage : PAL.mist);
    const c = catPos();
    if (mode === "attract") {
      // The cat fishes alone; it turns round to show off a catch.
      const img = catHappy > 0 ? (catBlink < 0 ? cat.blink : cat.sit) : time % 3 > 2.4 ? cat.backSwish : cat.back;
      blit(ctx, img, c.x, c.y);
    } else {
      blit(ctx, witch, pierX - 7, dockY + 3 - witch.height);
      fill(ctx, anglerBase().x - 1, anglerBase().y, 2, 2, PAL.blush);
      const img = catBlink < 0 ? cat.blink : time % 3.2 > 2.6 ? cat.swish : cat.sit;
      blit(ctx, img, c.x, c.y - (catHappy > 1 ? 2 : 0));
    }
    // Landed fish: leaps from the water onto the dock, flops, then into the basket.
    const l = rig.landed;
    if (rig.state === "land" && l) {
      const img = fishImg[l.sp][Math.floor(l.t * 8) % 2]!;
      const dx = pierX - 8;
      const dy = dockY + 12;
      let x: number;
      let y: number;
      if (l.t < 0.5) {
        const k = l.t / 0.5;
        x = lerp(l.x0, dx, k);
        y = lerp(l.y0, dy, k) - Math.sin(k * Math.PI) * 22;
      } else if (l.t < 0.85) {
        x = dx;
        y = dy - (Math.floor(l.t * 10) % 2 === 0 ? 2 : 0);
      } else {
        const k = (l.t - 0.85) / 0.2;
        x = lerp(dx, pierX + 14, k);
        y = lerp(dy, H - 26, k);
      }
      blit(ctx, img, x, y, true);
    }
  }

  function drawFlies() {
    for (const f of flies) {
      const t = time * 0.5 + f.ph;
      const x = Math.round(f.x + Math.sin(t * 0.9) * f.r);
      const y = Math.round(f.y + Math.sin(t * 1.4 + 1) * f.r * 0.5);
      const cyc = (time + f.ph) % 2.4;
      if (cyc > 1.8) continue;
      const bright = cyc > 0.3 && cyc < 1.4;
      fill(ctx, x, y, 1, 1, bright ? PAL.butter : PAL.candle);
      if (bright) {
        fill(ctx, x - 1, y, 1, 1, PAL.candle);
        fill(ctx, x + 1, y, 1, 1, PAL.candle);
        fill(ctx, x, y - 1, 1, 1, PAL.candle);
        fill(ctx, x, y + 1, 1, 1, PAL.candle);
        // A dim reflection when it hovers over the water.
        if (y > horizon + 2 && y < dockY) fill(ctx, x, y + 4, 1, 1, PAL.teal);
      }
    }
  }

  function drawReeds() {
    const f = Math.floor(time * 1.2) % 2;
    blit(ctx, reeds[f]![0], -3, dockY - 6);
    blit(ctx, reeds[1 - f]![1], W - 10, dockY - 12);
    blit(ctx, reeds[f]![1], W - 18, horizon + 2);
  }

  function drawHud() {
    const sr = scr.safe(session.play());
    blit(ctx, fishImg.perch[0], sr.x0 + 3, top + 3);
    drawText(ctx, `${total} g`, sr.x0 + 18, top + 2, PAL.butter, { outline: PAL.ink });
    if (mode !== "play" || session.phase !== "playing") return;
    // Cast power, next to the angler.
    if (rig.state === "aim" && night < NIGHT) {
      const gx = pierX - 30;
      const gy = dockY - 38;
      const h = 30;
      fill(ctx, gx, gy, 6, h + 2, PAL.ink);
      fill(ctx, gx + 1, gy + 1, 4, h, PAL.night);
      const ph = Math.round(rig.power * h);
      for (let j = 0; j < ph; j++) {
        const f = j / h;
        fill(ctx, gx + 1, gy + h - j, 4, 1, f < 0.33 ? PAL.sage : f < 0.66 ? PAL.butter : PAL.candle);
      }
      fill(ctx, gx + 1, gy + h + 1 - ph, 4, 1, PAL.cream);
      // Where it will land: a faint dotted ring on the water.
      const t = castTarget(rig.power);
      if (Math.floor(time * 4) % 4 !== 3) {
        fill(ctx, t.x - 3, t.y, 1, 1, PAL.cream);
        fill(ctx, t.x + 3, t.y, 1, 1, PAL.cream);
        fill(ctx, t.x - 1, t.y - 1, 3, 1, PAL.mist);
        fill(ctx, t.x - 1, t.y + 1, 3, 1, PAL.mist);
      }
      if (hintCast) drawText(ctx, "tap to cast ~", W / 2 + 10, dockY - 52, PAL.cream, { align: "center", outline: PAL.ink });
    }
    if (rig.state === "wait" && hintReel && !rig.fish) drawText(ctx, "wait for the dip...", W / 2, dockY - 52, PAL.cream, { align: "center", outline: PAL.ink });
    // Line tension while reeling: keep the knot in the green.
    if (rig.state === "reel" && rig.fish) {
      const s = SPECS[rig.fish.sp];
      const gw = 72;
      const gx = Math.round(W / 2 - gw / 2);
      const gy = H - 16;
      fill(ctx, gx - 1, gy - 1, gw + 2, 7, PAL.ink);
      for (let i = 0; i < gw; i++) {
        const v = i / gw;
        const c = v < s.zone[0] ? PAL.dusk : v <= s.zone[1] ? PAL.sage : v > 0.9 ? PAL.rose : PAL.ember;
        fill(ctx, gx + i, gy, 1, 5, c);
        if (v >= s.zone[0] && v <= s.zone[1]) fill(ctx, gx + i, gy + 4, 1, 1, PAL.moss);
      }
      const mx = gx + Math.round(clamp(rig.tension) * (gw - 1));
      const wob = rig.surgeT > 0 ? Math.floor(time * 20) % 2 : 0;
      blit(ctx, bobberImg, mx - 2, gy - 3 + wob);
      if (hintReel) drawText(ctx, "tap tap! keep it green", W / 2, gy - 14, PAL.cream, { align: "center", outline: PAL.ink });
      else if (rig.surgeT > 0) drawText(ctx, "it's pulling!", W / 2, gy - 14, PAL.blush, { align: "center", outline: PAL.ink });
    }
  }

  function drawSign() {
    if (signUp <= 0) return;
    const safe = scr.safe(session.preview());
    const cx = Math.round((safe.x0 + safe.x1) / 2);
    const w = title.width + 10;
    const sub = mode === "over" ? `you caught ${total} g` : session.best !== null ? `best ${session.best} g` : "";
    const h = title.height + 7 + (sub ? 10 : 0);
    const water = horizon + 44;
    const x = cx - Math.floor(w / 2);
    const k = easeOutCubic(signUp);
    const y = Math.round(lerp(water + 2, water - 16 - h, k));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, water);
    ctx.clip();
    // Post.
    fill(ctx, cx - 2, y + h, 4, water - y - h + 1, PAL.ink);
    fill(ctx, cx - 1, y + h, 2, water - y - h + 1, PAL.wood);
    // Board.
    fill(ctx, x, y, w, h, PAL.ink);
    for (let j = 1; j < h - 1; j++) {
      const seam = j === Math.floor(h / 2);
      fill(ctx, x + 1, y + j, w - 2, 1, seam ? PAL.night : j === 1 || j === Math.floor(h / 2) + 1 ? PAL.ember : j >= h - 3 ? PAL.dusk : PAL.wood);
    }
    for (const [nx, ny] of [
      [x + 2, y + 2],
      [x + w - 3, y + 2],
      [x + 2, y + h - 3],
      [x + w - 3, y + h - 3],
    ] as const)
      fill(ctx, nx, ny, 1, 1, PAL.mauve);
    blit(ctx, title, x + 5, y + 3);
    if (sub) drawText(ctx, sub, cx, y + title.height + 4, PAL.cream, { align: "center", outline: PAL.ink });
    ctx.restore();
    // Ring where the post meets the water.
    ellipse(ctx, cx, water, 4, 1, PAL.mist);
    if (signUp < 1) return;
    const prompt = mode === "over" ? "~ tap to fish again ~" : "~ tap to fish ~";
    const py = Math.round(lerp(water + 6, dockY - 16, 0.4));
    const soft = !session.reducedMotion && time % 1.4 > 0.95;
    drawText(ctx, prompt, cx, py, soft ? PAL.blush : PAL.cream, { align: "center", outline: PAL.ink });
    const tw = textWidth(prompt);
    blit(ctx, sparkle[Math.floor(time * 1.5) % 2]!, cx + Math.ceil(tw / 2) + 5, py + 4, true);
    drawText(ctx, "♥", cx - Math.ceil(tw / 2) - 8, py + 1 - (soft ? 1 : 0), PAL.rose, { outline: PAL.ink });
  }

  function drawPopups() {
    for (const p of popups) {
      const rise = Math.floor(Math.min(p.t, 0.5) * 16);
      if (p.t > p.life - 0.2 && Math.floor(p.t * 10) % 2 === 1) continue;
      const tw = textWidth(p.text);
      drawText(ctx, p.text, clamp(p.x, tw / 2 + 2, W - tw / 2 - 2), p.y - rise, p.color, { align: "center", outline: PAL.ink });
    }
  }

  function render() {
    const o = nudge.offset(time);
    ctx.save();
    ctx.translate(o.x, o.y);
    drawSky();
    drawWater();
    drawFish();
    drawRipples();
    drawBobber();
    drawDock();
    drawLine();
    drawReeds();
    drawFlies();
    fx.draw(ctx);
    drawPopups();
    ctx.restore();
    if (mode !== "attract") drawHud();
    drawSign();
    scr.present();
  }

  if (BOT) session.on("end", (e) => ((window as unknown as { __pwEnd: unknown }).__pwEnd = { score: e.score, night, caught, biggest }));

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
