import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { onKeys } from "@thumbcade-games/kit/input";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import * as ART from "./art.ts";
import { BANNER_TEXT, overLines, PANEL_TEXT, TIER_LINES, TIER_SUBS } from "./copy.ts";
import { chunkyTitle, drawText, textWidth } from "./font.ts";
import { Nudge, PixelParticles, RAMP } from "./fx.ts";
import { FISH_W, hudLanes, MOON_W, PIP } from "./layout.ts";
import { PAL } from "./palette.ts";
import { pilotCat, PILOTS, type PilotName } from "./pilot.ts";
import { blit, createPixelScreen, dither, fill, Painter } from "./pixel.ts";
import { Run, RULES, type RunEvent } from "./run.ts";
import { createSound } from "./sound.ts";
import { biomeOf, BIOMES, CELL, colX, COLS, FW, moverX, toadState, type Biome, type Kind, type Row } from "./world.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = (Object.keys(PILOTS) as PilotName[]).find((k) => k === import.meta.env.VITE_AUTOPLAY) ?? null;
/** A sideways swipe is read once the finger has gone this far (CSS px) and mostly sideways. */
const SWIPE_PX = 16;
/** A press that wanders further than this (CSS px) without being a swipe is not a tap. */
const TAP_SLOP = 26;

type Mode = "attract" | "play" | "over";

interface Popup {
  text: string;
  /** World position: row (float) and field x. */
  row: number;
  x: number;
  t: number;
  life: number;
  color: string;
}

interface BannerLine {
  text: string;
  big?: boolean;
  color?: string;
}

interface Banner {
  lines: BannerLine[];
  t: number;
  life: number;
  rim: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
/** First light's steps below the front (screen-blend alpha). */
const DAWN_STEPS = [0.1, 0.16, 0.22, 0.27, 0.31, 0.35, 0.38];

async function main() {
  const session = await createSession({ id: "pittermoon" });
  const reduced = session.reducedMotion;
  const scr = createPixelScreen();
  const { ctx } = scr;
  const sfx = createSound();
  const fx = new PixelParticles(560);
  const nudge = new Nudge(reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.16, decay: 0.5 });
  const spr = ART.sprites();
  const titleImg = chunkyTitle("pittermoon", { fill: "a", light: "c", dark: "r", outline: "k", shadow: "n", gap: 1 });
  const bigText = new Map<string, HTMLCanvasElement>();
  const chunky = (text: string, fillKey = "y") => {
    const key = `${text}|${fillKey}`;
    let c = bigText.get(key);
    if (!c) {
      const dark = fillKey === "y" ? "o" : fillKey === "a" ? "r" : fillKey === "f" ? "i" : fillKey === "s" ? "m" : fillKey === "i" ? "t" : "e";
      c = chunkyTitle(text, { fill: fillKey, light: "c", dark, outline: "k", shadow: "n" });
      bigText.set(key, c);
    }
    return c;
  };

  let taught = false;
  let bestRows: number | null = null;
  try {
    taught = (await tc.storage.get<number>("hint")) === 1;
    const b = await tc.storage.get<number>("bestRow");
    if (typeof b === "number") bestRows = b;
  } catch {
    /* guest or offline */
  }

  // ---- layout ----------------------------------------------------------------------------------
  let SW = scr.w;
  let SH = scr.h;
  let top = 0;
  let ox = 9;
  const ground = new Map<string, HTMLCanvasElement>();
  const dawnTiles: HTMLCanvasElement[] = [];
  let margins: HTMLCanvasElement | null = null;
  const stars: Array<{ x: number; y: number; ph: number }> = [];
  const flies: Array<{ x: number; y: number; ph: number }> = [];

  function layout() {
    SW = scr.w;
    SH = scr.h;
    top = scr.safe(session.play()).y0;
    ox = Math.floor((SW - FW) / 2);
    const rr = createRng(41);
    stars.length = 0;
    for (let i = 0; i < 22; i++) stars.push({ x: rr.int(1, SW - 2), y: rr.int(1, top + 12), ph: rr.range(0, 6) });
    flies.length = 0;
    for (let i = 0; i < 9; i++) flies.push({ x: rr.range(0, SW), y: rr.range(top + 20, SH - 10), ph: rr.range(0, 6) });
    ground.clear();
    paintDawn();
    // Outside the eight columns it's dark: an ink screen over the margins.
    const m = document.createElement("canvas");
    m.width = SW;
    m.height = SH;
    const g = m.getContext("2d") as CanvasRenderingContext2D;
    g.fillStyle = PAL.ink;
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < ox; x++) if ((x + y) % 2 === 0) g.fillRect(x, y, 1, 1);
      for (let x = ox + FW; x < SW; x++) if ((x + y) % 2 === 0) g.fillRect(x, y, 1, 1);
    }
    margins = m;
  }

  /** The cat's feet line on screen. */
  const anchor = () => Math.round(SH * (mode === "attract" ? 0.7 : mode === "over" ? 0.5 : 0.71));

  // ---- painting the ground -------------------------------------------------------------------------

  /** A strip of ground for one row, SW wide and one cell tall, with the field's columns lined up. */
  function strip(kind: Kind, biome: Biome["id"], look: number): HTMLCanvasElement {
    const key = `${kind}|${biome}|${look}`;
    let c = ground.get(key);
    if (c) return c;
    const P = new Painter(SW, CELL);
    // Low-frequency patches (not per-pixel noise): blobs of shade, the way a hand would block them in.
    const n = (x: number, y: number) => Math.sin(x * 0.29 + y * 0.53 + look * 1.7) + Math.sin(x * 0.11 - y * 0.37 + look * 3.1) * 0.8;
    const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663) ^ (look * 83492791)) >>> 0;
    const tufts: Array<[number, number, string]> = [];
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < SW; x++) {
        const fxp = x - ox;
        const h = hash(fxp + 1000, y);
        const v = n(fxp, y);
        let col: string;
        if (kind === "path") {
          if (biome === "market") {
            // Lantern-lit flagstones, two to a cell, warm light on their tops (the street between stalls is purple).
            const half = y < 7 ? 0 : 1;
            const sx = (((fxp + (half ? 7 : 0)) % 7) + 7) % 7;
            const mortar = sx === 0 || y === 0 || y === 7;
            col = mortar ? PAL.night : PAL.wood;
            if (!mortar && (y === 1 || y === 8) && sx < 5) col = v > 0.9 ? PAL.candle : PAL.ember;
          } else if (biome === "bog") {
            col = v > 0.7 ? PAL.teal : v < -1.1 ? PAL.pond : PAL.moss;
            if (h % 53 === 0) tufts.push([x, y, PAL.sage]);
          } else {
            // Grass by moonlight: moss, cool teal patches, tufts and the odd flower placed on top.
            col = v > 0.85 ? PAL.teal : PAL.moss;
            if (h % 41 === 0) tufts.push([x, y, v > 0.85 ? PAL.moss : PAL.sage]);
            if (h % 389 === 7) tufts.push([x, y, biome === "orchard" ? "leaf" : "flower"]);
          }
        } else if (kind === "broom") {
          // A swept track: packed earth (dark cobbles in the market), sweep marks curling along it.
          col = v > 0.9 ? PAL.night : PAL.dusk;
          if ((y === 4 || y === 9) && ((((x + look * 3) >> 2) & 1) === 0)) col = PAL.mauve;
          if (biome === "market" && (((fxp % 7) + 7) % 7 === 0 || y === 7)) col = PAL.night;
        } else if (kind === "pumpkin") {
          // A furrow down the slope: soil, a lit ridge, two grooves.
          col = PAL.wood;
          if (y >= 5 && y <= 8 && v > -0.6) col = y === 5 ? PAL.ember : PAL.wood;
          if (y === 2 || y === 11) col = PAL.night;
          if ((y === 3 || y === 12) && v > 0.4) col = PAL.night;
          if (h % 97 === 0 && y > 3 && y < 11) col = PAL.ember;
        } else if (kind === "yarn") {
          // A long woven runner: plum with a diamond weave and rose selvedges.
          const d = (Math.abs((((fxp % 8) + 8) % 8) - 4) + Math.abs(y - 7)) % 6;
          col = d === 0 ? PAL.mauve : d === 3 ? PAL.dusk : PAL.night;
          if (y === 2 || y === 11) col = PAL.rose;
        } else if (kind === "wisp") {
          col = v > 0.6 ? PAL.teal : PAL.pond;
          if (h % 61 === 0) tufts.push([x, y, PAL.glacier]);
        } else if (kind === "brook") {
          col = v > 0.9 ? PAL.glacier : PAL.pond;
          if (y === 1) col = PAL.teal;
        } else {
          // Bog: murky water, scum in patches.
          col = v > 0.8 ? PAL.moss : v < -1 ? PAL.night : PAL.pond;
        }
        if (kind !== "path" && (y === 0 || y === CELL - 1)) col = PAL.ink;
        P.set(x, y, col);
      }
    }
    // Tufts and flowers go on last, so they sit on top of the patches.
    for (const [x, y, k] of tufts) {
      if (k === "flower") {
        P.set(x, y, PAL.rose);
        P.set(x - 1, y, PAL.blush);
        P.set(x + 1, y, PAL.blush);
        P.set(x, y - 1, PAL.blush);
        P.set(x, y + 1, PAL.butter);
      } else if (k === "leaf") {
        P.set(x, y, PAL.ember);
        P.set(x + 1, y, PAL.candle);
      } else {
        P.set(x, y, k);
        if (y > 0) {
          P.set(x - 1, y - 1, k);
          P.set(x + 1, y - 1, k);
        }
      }
    }
    c = P.toCanvas();
    ground.set(key, c);
    return c;
  }

  /** Screen-anchored dither tiles for first light, from faint to full (4 px tall, SW wide). */
  function paintDawn() {
    dawnTiles.length = 0;
    for (let lvl = 0; lvl <= 8; lvl++) {
      const P = new Painter(SW, 4);
      const c = P.toCanvas();
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < SW; x++) {
          if (!dither(x, y, lvl / 16)) continue;
          g.fillStyle = lvl > 6 && dither(x + 2, y + 1, 0.25) ? PAL.butter : PAL.dawn;
          g.fillRect(x, y, 1, 1);
        }
      }
      // Clear the painter's opaque fill: only the dithered pixels stay.
      const img = g.getImageData(0, 0, SW, 4);
      for (let i = 0; i < img.data.length; i += 4) {
        const isDawn = img.data[i] === 0xf2 || img.data[i] === 0xf6;
        if (!isDawn) img.data[i + 3] = 0;
      }
      g.putImageData(img, 0, 0);
      dawnTiles.push(c);
    }
  }

  layout();
  scr.onResize(layout);
  session.on("insets", layout);

  /** Paints the ground strips not yet seen, a couple per frame, so a new stretch never costs a long frame. */
  const KINDS: Kind[] = ["path", "broom", "pumpkin", "yarn", "wisp", "brook", "bog"];
  function warmGround() {
    let n = 0;
    for (const b of BIOMES) {
      for (const k of KINDS) {
        for (let look = 0; look < 4; look++) {
          if (ground.has(`${k}|${b.id}|${look}`)) continue;
          strip(k, b.id, look);
          if (++n >= 2) return;
        }
      }
    }
  }

  // ---- state -----------------------------------------------------------------------------------
  let mode: Mode = "attract";
  let time = 0;
  let demo = newDemo(0);
  let run: Run | null = null;
  let qaPilot: ReturnType<typeof pilotCat> | null = null;
  let cam: number = RULES.startRow;
  let popups: Popup[] = [];
  let banner: Banner | null = null;
  const bannerQueue: Banner[] = [];
  let shownScore = 0;
  let scoreBump = 0;
  let endAt = -1;
  let ended = false;
  let overInfo: { lines: [string, string, string]; best: boolean; frac: number; t: number } | null = null;
  let hintStage = 0;
  let hintT = 0;
  let lastInput = 0;
  let music: "off" | "tiptoe" | "hurry" = "off";
  let ribbonGone = false;
  /** Time of the last fail, and what it was (for the cat's face). */
  let failLook: { kind: "bonk" | "splash" | "sink"; until: number } | null = null;
  let landSquash = 0;

  function newDemo(seed: number): { run: Run; drive: (r: Run, dt: number) => void } {
    const r = new Run((session.ctx.seed ^ 0x5eed ^ (seed * 7919)) >>> 0);
    r.dawnOff = true;
    const p = pilotCat(PILOTS.good, seed + 11);
    // Pre-roll so the first frame is already on the move.
    for (let i = 0; i < 150; i++) {
      r.update(1 / 60, p.drive);
      r.drain();
    }
    return { run: r, drive: p.drive };
  }

  /** The run on screen. */
  const shown = (): Run => (mode === "attract" || !run ? demo.run : run);

  // ---- input -----------------------------------------------------------------------------------
  let ptr: { id: number; x0: number; y0: number; done: boolean } | null = null;
  const canDrive = () => mode === "play" && run !== null && !run.over && !QA_AUTOPLAY;
  window.addEventListener("pointerdown", (e) => {
    if (!canDrive() || ptr) return;
    sfx.unlock();
    ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, done: false };
    run!.press();
    lastInput = time;
  });
  window.addEventListener("pointermove", (e) => {
    if (!ptr || e.pointerId !== ptr.id || ptr.done || !canDrive()) return;
    const dx = e.clientX - ptr.x0;
    const dy = e.clientY - ptr.y0;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= 1.2 * Math.abs(dy)) {
      // A sidestep fires mid-swipe, the moment it's clearly sideways.
      ptr.done = true;
      run!.swipe(dx > 0 ? 1 : -1);
      lastInput = time;
    } else if (Math.abs(dy) > TAP_SLOP && Math.abs(dy) > Math.abs(dx)) {
      // Going up or down the screen: that one belongs to the feed. No hop.
      ptr.done = true;
      run!.cancel();
    }
  });
  const up = (e: PointerEvent) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr;
    ptr = null;
    if (p.done || !canDrive()) return;
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < TAP_SLOP) run!.release();
    else run!.cancel();
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    ptr = null;
    if (run) run.cancel();
  });
  session.on("cancel", () => {
    ptr = null;
    if (run) run.cancel();
  });
  const key = (dir: -1 | 0 | 1) => () => {
    if (!canDrive()) return;
    lastInput = time;
    if (dir === 0) {
      run!.press();
      run!.release();
    } else {
      run!.press();
      run!.swipe(dir);
    }
  };
  onKeys({ up: key(0), action: key(0), left: key(-1), right: key(1) });
  session.startOnTap(window);

  session.on("start", () => {
    sfx.unlock();
    run = new Run((session.ctx.seed + session.runs * 7919) >>> 0);
    run.bestRows = bestRows;
    qaPilot = QA_AUTOPLAY ? pilotCat(PILOTS[QA_AUTOPLAY], session.runs + 5) : null;
    mode = "play";
    cam = run.cat.row;
    popups = [];
    banner = null;
    bannerQueue.length = 0;
    shownScore = 0;
    endAt = -1;
    ended = false;
    overInfo = null;
    failLook = null;
    ribbonGone = false;
    hintStage = taught || QA_AUTOPLAY ? 3 : 0;
    hintT = 0;
    lastInput = time;
    fx.clear();
    sfx.play("start");
    sfx.play("mew", 0, 0.8);
    setMusic("tiptoe");
    say([{ text: BIOMES[0]!.name, color: PAL.cream }, { text: "stay ahead of the sun", color: PAL.mist }], PAL.dawn, 1.5);
  });

  function setMusic(m: typeof music) {
    if (m === music) return;
    music = m;
    sfx.music(m);
  }

  // ---- feedback helpers --------------------------------------------------------------------------
  /** Screen x of a field x, and screen y of the bottom of a (fractional) row. */
  const A = (x: number) => ox + x;
  const camPx = () => Math.round(cam * CELL);
  const rowBottom = (row: number) => anchor() - Math.round(row * CELL) + camPx();

  function pop(text: string, row: number, x: number, color: string, life = 0.9) {
    popups = popups.filter((p) => p.text !== text);
    popups.push({ text, row, x, t: 0, life, color });
    if (popups.length > 3) popups.shift();
  }

  function say(lines: BannerLine[], rim: string = PAL.butter, life = 1.1) {
    const b = { lines, t: 0, life, rim };
    if (!banner) banner = b;
    else if (bannerQueue.length < 3) bannerQueue.push(b);
  }

  function burst(x: number, y: number, n: number, ramp: readonly string[], speed: [number, number] = [20, 60], shape: "dot" | "big" | "spark" | "plus" | "heart" = "dot", gravity = 0) {
    if (reduced) n = Math.ceil(n / 2);
    fx.emit(x, y, { count: n, speed, life: [0.25, 0.7], ramp, shape, drag: 3, gravity });
  }

  /** Where the cat is drawn: field x, fractional row, and how high off the ground. */
  function catPose(r: Run): { x: number; row: number; lift: number } {
    const c = r.cat;
    const f = r.flight;
    if (f) {
      const k = clamp(f.t / f.dur);
      if (f.kind === "lift") {
        const e = easeInOutCubic(k);
        return { x: lerp(f.fromX, f.toX, e), row: lerp(f.fromRow, f.toRow, e), lift: 6 + Math.sin(k * Math.PI) * 10 };
      }
      return { x: lerp(f.fromX, f.toX, k), row: lerp(f.fromRow, f.toRow, easeOutCubic(k)), lift: Math.sin(k * Math.PI) * 9 };
    }
    const h = r.hop;
    if (h) {
      const k = clamp(h.t / h.dur);
      if (h.kind === "bump") {
        const b = Math.sin(k * Math.PI) * 0.22;
        return { x: h.fromX + h.dir * b * CELL, row: h.fromRow + (h.dir === 0 ? b : 0), lift: Math.sin(k * Math.PI) * 2 };
      }
      return { x: lerp(h.fromX, h.toX, k), row: lerp(h.fromRow, h.toRow, easeOutCubic(k)), lift: Math.sin(k * Math.PI) * (h.kind === "up" ? 5 : 3) };
    }
    return { x: c.x, row: c.row, lift: 0 };
  }

  function react(e: RunEvent, live: boolean) {
    const r = shown();
    const vol = live ? 1 : 0.3;
    switch (e.type) {
      case "press":
        if (live) {
          sfx.play("crouch", 0, 0.8);
          lastInput = time;
        }
        break;
      case "hop": {
        const pitch = Math.min(7, r.streak * 0.5);
        sfx.play(e.dir === 0 ? "pad" : "step", e.dir === 0 ? pitch : 0, vol);
        const pose = catPose(r);
        burst(A(pose.x), rowBottom(pose.row) - 1, 2, RAMP.dust, [10, 25]);
        break;
      }
      case "land":
        landSquash = 0.09;
        if (e.kind === "brook") sfx.play("pat", 4, 0.6 * vol);
        else sfx.play("pat", 0, vol);
        if (live && r.streak > 0 && r.streak % 5 === 0) sfx.play("bell", 0, 0.8);
        if (e.kind === "brook") burst(A(e.x), rowBottom(e.row) - 2, 3, RAMP.splash, [10, 30]);
        else if (e.kind === "path") burst(A(e.x), rowBottom(e.row) - 1, 2, RAMP.dust, [8, 20]);
        break;
      case "bump":
        sfx.play("boop", 0, vol);
        if (live) nudge.kick(1, 0.06);
        break;
      case "row": {
        if (!live) break;
        scoreBump = 1;
        break;
      }
      case "tier":
        if (!live) break;
        sfx.play("tier", e.tier * 2);
        say([{ text: TIER_LINES[e.tier]!.replace("!", ""), big: true, color: e.tier >= 3 ? "a" : "y" }, { text: TIER_SUBS[e.tier]!, color: PAL.blush }], PAL.dawn, 0.95);
        if (e.tier >= 2) session.feedback("success");
        {
          const p = catPose(r);
          burst(A(p.x), rowBottom(p.row) - 7, 10 + e.tier * 4, RAMP.dawn, [30, 80], "spark");
        }
        break;
      case "cool":
        if (live) {
          sfx.play("cool");
          const p = catPose(r);
          pop("zoomies off", p.row + 0.6, p.x, PAL.mauve, 0.7);
        }
        break;
      case "whisker": {
        sfx.play("whisker", 0, vol);
        if (!live) break;
        sfx.play("swish", 0, 0.7);
        hitStop.freeze(0.04);
        pop(e.escape ? `phew! +${e.points}` : `whisker! +${e.points}`, e.row + 1.1, e.x, PAL.frost, 0.8);
        burst(A(e.x), rowBottom(e.row) - 7, 9, RAMP.moon, [30, 70], "spark");
        break;
      }
      case "scramble":
        sfx.play("scramble", 0, vol);
        if (live) pop("scramble!", e.row + 1.1, e.x, PAL.mist, 0.6);
        break;
      case "fish": {
        sfx.play(e.gold ? "gold" : "fish", 0, vol);
        burst(A(e.x), rowBottom(e.row) - 6, e.gold ? 18 : 9, e.gold ? RAMP.gold : RAMP.moon, [20, 70], "spark");
        if (!live) break;
        pop(`${e.gold ? "moonfish!" : "fish"} +${e.points}`, e.row + 1.1, e.x, e.gold ? PAL.butter : PAL.frost, 0.9);
        if (e.gold) {
          hitStop.freeze(0.06);
          session.feedback("success");
        }
        break;
      }
      case "lift": {
        sfx.play("swoop", 0, vol);
        sfx.play("lift", 0, vol);
        if (!live) break;
        hitStop.freeze(0.08);
        flash.trigger(PAL.cream, 0.7);
        say([{ text: "broom ride!", big: true, color: "y" }, { text: "five fish: up we go", color: PAL.cream }], PAL.butter, 1.3);
        session.feedback("success");
        break;
      }
      case "liftRow":
        if (live) scoreBump = 1;
        break;
      case "liftEnd":
        burst(A(e.x), rowBottom(e.row) - 2, 14, RAMP.moon, [20, 70], "spark");
        sfx.play("pat", 0, vol);
        break;
      case "fail": {
        const pose = { x: e.x, row: e.row };
        failLook = { kind: e.kind, until: time + RULES.knock + RULES.stun };
        if (e.kind === "bonk") {
          sfx.play("bonk", 0, vol);
          sfx.play(e.by === "wisp" ? "ooo" : "thud", 0, vol);
          burst(A(pose.x), rowBottom(pose.row) - 9, 10, RAMP.spark, [30, 80], "spark");
          if (e.by === "pumpkin") burst(A(pose.x), rowBottom(pose.row) - 5, 6, RAMP.pumpkin, [20, 60], "big", 60);
          if (e.by === "wisp") burst(A(pose.x), rowBottom(pose.row) - 6, 12, RAMP.wisp, [20, 60], "dot");
        } else {
          sfx.play("splash", 0, vol);
          if (e.kind === "sink") sfx.play("glug", 0, vol);
          burst(A(pose.x), rowBottom(pose.row) - 3, 16, e.kind === "sink" ? RAMP.bog : RAMP.splash, [30, 80], "big", 90);
        }
        if (!live) break;
        sfx.play(e.kind === "bonk" ? "mew" : "hiss", 0, 0.8);
        hitStop.freeze(0.08);
        nudge.kick(2, 0.2);
        const what = e.kind === "splash" ? "splash!" : e.kind === "sink" ? "glug!" : e.by === "broom" ? "swept!" : e.by === "pumpkin" ? "bonk!" : e.by === "yarn" ? "tangled!" : "spooked!";
        pop(what, e.row + 1.2, e.x, PAL.blush, 0.9);
        break;
      }
      case "edge":
        if (live) pop("!", e.row + 1.3, e.x, PAL.blush, 0.6);
        break;
      case "milestone":
        if (!live) break;
        sfx.play("milestone");
        pop(`row ${e.rows}`, r.cat.row + 1.6, r.cat.x, PAL.cream, 1.0);
        break;
      case "stretch":
        if (!live) break;
        sfx.play("stretch");
        sfx.play("stretchBell");
        flash.trigger(PAL.butter, 0.7);
        hitStop.freeze(0.06);
        say([{ text: e.name, color: PAL.cream }, { text: `new stretch +${fmt(e.points)}`, color: PAL.butter }], PAL.butter, 1.5);
        for (let i = 0; i < 4; i++) burst(A(14 + i * 28), rowBottom(r.cat.row) - 14, 8, RAMP.spark, [30, 90], "spark", 30);
        session.feedback("success");
        break;
      case "bestRow":
        if (!live) break;
        ribbonGone = true;
        sfx.play("best");
        flash.trigger(PAL.dawn, 0.6);
        say([{ text: "best row!", big: true, color: "a" }, { text: `past row ${e.rows - 1}`, color: PAL.cream }], PAL.dawn, 1.2);
        for (let i = 0; i < 6; i++) burst(A(10 + i * 18), rowBottom(e.rows + RULES.startRow - 1) - 4, 6, RAMP.dawn, [30, 90], "heart", 50);
        session.feedback("success");
        break;
      case "hurry":
        if (!live) break;
        sfx.play("hurry");
        pop("hurry!", r.cat.row + 1.4, r.cat.x, PAL.dawn, 1.0);
        break;
      case "over":
        if (live) finish();
        break;
    }
  }

  function finish() {
    const r = run!;
    mode = "over";
    ptr = null;
    endAt = time + 0.9;
    setMusic("off");
    sfx.play("sunrise");
    window.setTimeout(() => sfx.play("yawn"), 500);
    flash.trigger(PAL.dawn, 1);
    const best = session.best;
    const isBest = r.score > 0 && (best === null || r.score > best);
    overInfo = { lines: overLines({ rows: r.rows, score: r.score, stats: r.stats }, best), best: isBest, frac: best && best > 0 ? clamp(r.score / best, 0, 1) : 1, t: time };
    if (bestRows === null || r.rows > bestRows) {
      bestRows = r.rows;
      tc.storage.set("bestRow", r.rows).catch(() => undefined);
    }
    say([{ text: "sunrise", big: true, color: "a" }, { text: `row ${r.rows} · ${fmt(r.score)}`, color: PAL.butter }], PAL.dawn, 1.6);
  }

  // ---- update ----------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(Math.min(rawDt, 0.1));
    time += rawDt;
    fx.update(dt);
    nudge.update(rawDt);
    flash.update(rawDt);
    scoreBump = Math.max(0, scoreBump - rawDt * 3);
    landSquash = Math.max(0, landSquash - rawDt);
    if (banner) {
      banner.t += rawDt;
      if (banner.t >= banner.life) banner = bannerQueue.shift() ?? null;
    }
    for (const p of popups) p.t += rawDt;
    popups = popups.filter((p) => p.t < p.life);

    if (mode === "attract") {
      demo.run.update(dt, demo.drive);
      for (const e of demo.run.drain()) react(e, false);
      if (demo.run.t > 75) {
        demo = newDemo(Math.floor(time));
        cam = demo.run.cat.row;
      }
    } else if (run) {
      if (mode === "play") {
        run.update(dt, qaPilot?.drive);
        for (const e of run.drain()) react(e, true);
        // Music hurries when first light is close.
        if (mode === "play") setMusic(run.gap < 2.2 ? "hurry" : run.gap > 3.4 ? "tiptoe" : music);
        // First run: teach the tap, then the sidestep.
        if (hintStage === 0 && run.stats.hops >= 3) {
          hintStage = 1;
          hintT = 0;
        }
        if (hintStage === 1) {
          hintT += rawDt;
          if (run.stats.sides > 0 || hintT > 7) {
            hintStage = 3;
            taught = true;
            tc.storage.set("hint", 1).catch(() => undefined);
          }
        }
      } else {
        run.update(dt);
        run.drain();
        if (!ended && endAt > 0 && time >= endAt) {
          ended = true;
          const s = run.stats;
          session.end(run.score, { outcome: "lose", stats: { rows: run.rows, fish: s.fish, whiskers: s.whiskers, streak: s.bestStreak, lifts: s.lifts } });
        }
      }
    }
    // The camera follows the cat up the hill (and a little way back down after a tumble).
    const r = shown();
    const pose = catPose(r);
    const target = pose.row;
    const k = 1 - Math.exp(-(target > cam ? 9 : 5) * rawDt);
    cam += (target - cam) * k;
    // Old rows below first light (and the screen) can go.
    r.world.forget(Math.floor(Math.min(r.dawn, cam) - 14));
    // Score roll.
    const goal = mode === "attract" ? 0 : r.score;
    shownScore = Math.abs(goal - shownScore) < 1 ? goal : shownScore + (goal - shownScore) * (1 - Math.exp(-10 * rawDt));
    // The broom ride leaves a trail of moon sparkle.
    if (r.flight && r.flight.kind === "lift" && Math.random() < (reduced ? 0.3 : 0.8)) {
      const p = catPose(r);
      fx.emit(A(p.x) - 10, rowBottom(p.row) - 10 - p.lift, { count: 1, speed: [5, 20], life: [0.4, 0.8], ramp: RAMP.moon, shape: "spark", drag: 2, vy: 25 });
    }
    // Ambient: dust behind brooms on screen, bubbles in the bog.
    if (!reduced && Math.random() < 0.5) ambient(r);
  }

  function ambient(r: Run) {
    const [r0, r1] = visibleRows();
    const i = r0 + Math.floor(Math.random() * (r1 - r0 + 1));
    const row = r.row(i);
    if (row.kind === "broom" && row.movers.length) {
      const m = row.movers[Math.floor(Math.random() * row.movers.length)]!;
      const x = moverX(row, m, r.t);
      const tail = row.dir > 0 ? x + 2 : x + m.len - 2;
      if (A(tail) > -4 && A(tail) < SW + 4) fx.emit(A(tail), rowBottom(i) - 3, { count: 1, speed: [5, 15], life: [0.3, 0.6], ramp: RAMP.dust, drag: 2, vx: -row.dir * 10 });
    } else if (row.kind === "bog" && Math.random() < 0.3) {
      fx.emit(A(Math.random() * FW), rowBottom(i) - 3 - Math.random() * 8, { count: 1, speed: [2, 6], angle: [-Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3], life: [0.5, 0.9], ramp: RAMP.bog, shape: "bubble" });
    }
  }

  function visibleRows(): [number, number] {
    const a = anchor();
    const r0 = Math.floor(cam - (SH - a) / CELL) - 1;
    const r1 = Math.ceil(cam + a / CELL) + 1;
    const kept = shown().world.firstKept;
    return [kept > 0 ? Math.max(kept, r0) : r0, r1];
  }

  // ---- drawing ---------------------------------------------------------------------------------
  function plate(x: number, y: number, w: number, h: number, rim: string) {
    fill(ctx, x - 1, y - 1, w + 2, h + 2, PAL.ink);
    fill(ctx, x, y, w, h, PAL.night);
    fill(ctx, x, y, w, 1, rim);
    fill(ctx, x, y + h - 1, w, 1, PAL.dusk);
  }

  function drawGround(r: Run, r0: number, r1: number) {
    for (let i = r1; i >= r0; i--) {
      const y = rowBottom(i) - CELL;
      if (y > SH || y + CELL < 0) continue;
      if (i < 0) {
        ctx.drawImage(strip("path", "garden", ((i % 4) + 4) % 4), 0, y);
        continue;
      }
      const row = r.row(i);
      ctx.drawImage(strip(row.kind, biomeOf(row).id, row.look), 0, y);
      if (row.arch) {
        // The stretch's threshold: a row of flat stepping stones.
        for (let c = 0; c < COLS; c++) {
          const sx = A(colX(c)) - 4;
          fill(ctx, sx, y + 4, 8, 6, PAL.ink);
          fill(ctx, sx + 1, y + 4, 6, 5, PAL.mauve);
          fill(ctx, sx + 1, y + 4, 6, 1, PAL.cream);
        }
      }
      if (row.kind === "brook") {
        // Ripples flowing with the current.
        const flow = row.dir * row.speed * 0.6 * r.t;
        for (let k = 0; k < 7; k++) {
          const px = ((((k * 37 + i * 11 + flow) % (SW + 20)) + SW + 20) % (SW + 20)) - 10;
          const py = y + 4 + ((k * 5 + i) % 7);
          fill(ctx, px, py, 3, 1, k % 2 ? PAL.mist : PAL.glacier);
        }
      }
    }
  }

  /** Below the doorstep: the witch's garden gate (row -1) and her cottage (rows -2 and down). */
  function drawCottage(i: number) {
    const yb = rowBottom(i);
    if (yb < -20 || yb - CELL > SH + 4) return;
    if (i === -1) {
      // A picket fence with the gate standing open where the cat set off.
      const gate = A(colX(3));
      for (let x = A(0) - 6; x < A(FW) + 6; x++) {
        if (Math.abs(x - gate) < 9) continue;
        if (x % 4 === 0) {
          fill(ctx, x, yb - 11, 2, 9, PAL.wood);
          fill(ctx, x, yb - 12, 2, 1, PAL.cream);
        }
        fill(ctx, x, yb - 9, 1, 1, PAL.wood);
        fill(ctx, x, yb - 5, 1, 1, PAL.wood);
      }
      fill(ctx, gate - 9, yb - 12, 2, 10, PAL.ember);
      fill(ctx, gate + 7, yb - 12, 2, 10, PAL.ember);
    } else if (i === -3) {
      // The cottage: plank wall, a lit window, the door ajar.
      const x0 = A(FW / 2) - 30;
      fill(ctx, x0 - 6, yb - 30, 72, 4, PAL.dusk);
      for (let k = 0; k < 72; k += 3) fill(ctx, x0 - 6 + k, yb - 30, 1, 4, PAL.night);
      fill(ctx, x0, yb - 26, 60, 24, PAL.wood);
      for (let k = 0; k < 24; k += 4) fill(ctx, x0, yb - 26 + k, 60, 1, PAL.ink);
      fill(ctx, x0 + 8, yb - 21, 10, 8, PAL.ink);
      fill(ctx, x0 + 9, yb - 20, 8, 6, light.flicker(time, 3, { depth: 0.3, chance: 0.2 }) < 0.9 ? PAL.candle : PAL.butter);
      fill(ctx, x0 + 12, yb - 20, 1, 6, PAL.ink);
      fill(ctx, x0 + 36, yb - 18, 10, 16, PAL.ink);
      fill(ctx, x0 + 37, yb - 17, 8, 15, PAL.butter);
      fill(ctx, x0 + 37, yb - 17, 4, 15, PAL.candle);
    }
  }

  function drawRow(r: Run, i: number) {
    if (i < 0) {
      drawCottage(i);
      return;
    }
    const row = r.row(i);
    const yb = rowBottom(i);
    if (yb < -20 || yb - CELL > SH + 4) return;
    const t = r.t;
    const biome = biomeOf(row).id;
    if (row.kind === "path") {
      for (let c = 0; c < COLS; c++) {
        const v = row.block[c]!;
        if (v < 0) continue;
        const img = spr.obstacles[biome]![v]!;
        // Contact shadow, then the thing itself, its feet on the row's bottom.
        fill(ctx, A(colX(c)) - 5, yb - 2, 11, 1, PAL.ink);
        blit(ctx, img, A(colX(c)) - Math.floor(img.width / 2), yb - img.height - 1);
      }
      if (row.post) {
        // Milestone lanterns either side of the field.
        const lit = r.best >= row.i;
        const f = light.flicker(time, row.i, { depth: 0.5, chance: 0.3, rate: 1.5 });
        for (const lx of [ox - 6, ox + FW + 1]) blit(ctx, spr.lantern[lit && f < 0.85 ? 1 : 0]!, lx, yb - 10);
      }
      if (row.arch) drawArch(row, yb);
    } else if (row.kind === "bog") {
      for (const toad of row.toads) {
        const st = toadState(row, toad, t);
        const x0 = A(colX(toad.col)) - 6;
        // About to sink: it trembles (two shakes a second at most, still under reduced motion).
        const wob = st.wobble && light.pulse(t, 2, { phase: toad.col, still: 0 }) > 0.5 ? 1 : 0;
        const sink = Math.round(st.sink * 9);
        // A ring on the water where it is (or will be).
        fill(ctx, x0 + 2, yb - 3, 8, 1, st.up ? PAL.moss : PAL.teal);
        if (sink < 9) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0 - 2, yb - 22, 16, 20);
          ctx.clip();
          blit(ctx, spr.toad, x0 + wob, yb - 12 + sink);
          ctx.restore();
        } else {
          fill(ctx, x0 + 4, yb - 6, 1, 1, PAL.sage);
          fill(ctx, x0 + 7, yb - 5, 1, 1, PAL.sage);
        }
      }
    } else {
      for (const m of row.movers) drawMover(r, row, m, yb, t);
    }
    // Fish (or the moonfish).
    const p = row.pickup;
    if (p && !r.taken.has(row.i)) {
      let fxp: number;
      let fy = yb - 9;
      if (p.mover >= 0) {
        const m = row.movers[p.mover]!;
        fxp = moverX(row, m, t) + m.len / 2 + 2;
        fy = yb - 11;
      } else fxp = colX(p.col);
      if (row.kind === "bog") fy -= toadUpY(row, p.col, t);
      const bob = Math.round(Math.sin(time * 3 + row.i) * 1);
      const img = p.gold ? spr.goldfish : spr.fish;
      blit(ctx, img, A(fxp) - 4, fy + bob);
      if (light.pulse(time, p.gold ? 1.6 : 0.8, { phase: row.i, still: 0 }) > 0.86) blit(ctx, spr.sparkle[0]!, A(fxp) + 2, fy + bob - 4);
    }
  }

  /** A garland of lanterns across the start of each stretch, on two posts, lit once the cat has passed under. */
  function drawArch(row: Row, yb: number) {
    const lit = shown().best >= row.i;
    const y0 = yb - CELL - 6;
    const l = A(0) - 4;
    const rgt = A(FW) + 3;
    fill(ctx, l, y0, 2, CELL + 6, PAL.wood);
    fill(ctx, rgt, y0, 2, CELL + 6, PAL.wood);
    fill(ctx, l, y0 - 1, 2, 1, PAL.ember);
    fill(ctx, rgt, y0 - 1, 2, 1, PAL.ember);
    for (let x = l + 2; x < rgt; x++) {
      const k = (x - l) / (rgt - l);
      const sag = Math.round(Math.sin(k * Math.PI) * 4);
      fill(ctx, x, y0 + sag, 1, 1, PAL.ink);
      if ((x - l) % 12 === 6) {
        const f = light.flicker(time, x, { depth: 0.45, chance: 0.25, rate: 1.2 });
        fill(ctx, x - 1, y0 + sag + 1, 3, 3, PAL.ink);
        fill(ctx, x, y0 + sag + 2, 1, 1, lit ? (f < 0.85 ? PAL.candle : PAL.butter) : PAL.dusk);
      }
    }
  }

  /** How far a toadstool's cap stands up (for things sitting on it). */
  function toadUpY(row: Row, col: number, t: number): number {
    const toad = row.toads.find((q) => q.col === col);
    if (!toad) return 0;
    return Math.round((1 - toadState(row, toad, t).sink) * 4);
  }

  function drawMover(r: Run, row: Row, m: Row["movers"][number], yb: number, t: number) {
    const x = moverX(row, m, t);
    const sx = A(x);
    if (sx > SW + 4 || sx + m.len < -4) return;
    const right = row.dir > 0;
    switch (row.kind) {
      case "broom": {
        const img = spr.broom[m.v]![right ? 0 : 1]!;
        const bob = Math.round(Math.sin(t * 5 + m.off) * 1);
        for (let k = 3; k < m.len - 3; k += 2) fill(ctx, sx + k, yb - 2, 1, 1, PAL.ink);
        blit(ctx, img, sx - 1, yb - img.height - 4 + bob);
        break;
      }
      case "pumpkin": {
        const big = m.v === 1;
        const rad = big ? 7 : 6;
        const ang = (x / rad) % (Math.PI * 2);
        const frame = ((Math.floor((ang / (Math.PI * 2)) * ART.ROLL_FRAMES) % ART.ROLL_FRAMES) + ART.ROLL_FRAMES) % ART.ROLL_FRAMES;
        const img = spr.pumpkin[big ? 1 : 0]![frame]!;
        const hop = Math.round(Math.abs(Math.sin(ang * 2)) * 1);
        fill(ctx, sx + 1, yb - 2, m.len - 2, 1, PAL.ink);
        blit(ctx, img, sx - 2, yb - img.height + 1 - hop);
        break;
      }
      case "yarn": {
        const ang = (x / 4.5) % (Math.PI * 2);
        const frame = ((Math.floor((ang / (Math.PI * 2)) * ART.ROLL_FRAMES) % ART.ROLL_FRAMES) + ART.ROLL_FRAMES) % ART.ROLL_FRAMES;
        const img = spr.yarn[m.v]![frame]!;
        // The thread trailing behind it.
        const thread = m.v === 1 ? PAL.teal : m.v === 2 ? PAL.butter : PAL.rose;
        for (let k = 1; k < 16; k++) {
          const tx = right ? sx - k : sx + m.len + k - 1;
          fill(ctx, tx, yb - 4 + Math.round(Math.sin(k * 0.8 + t * 6) * 1), 1, 1, thread);
        }
        blit(ctx, img, sx, yb - img.height - 1);
        break;
      }
      case "wisp": {
        const frame = light.pulse(time, 1.5, { phase: m.off, still: 0 }) > 0.5 ? 1 : 0;
        const img = spr.wisp[frame]!;
        const bob = Math.round(Math.sin(t * 2.2 + m.off) * 1.5);
        // A soft glow on the ground under it.
        for (let k = -2; k < m.len + 2; k++) if (dither(sx + k, yb, 0.5)) fill(ctx, sx + k, yb - 2, 1, 1, PAL.mist);
        blit(ctx, img, sx, yb - img.height - 3 + bob);
        break;
      }
      case "brook": {
        const img = spr.boat[m.v]![right ? 0 : 1]!;
        const bob = Math.round(Math.sin(t * 2 + m.off) * 0.6);
        blit(ctx, img, sx, yb - img.height - 2 + bob);
        // Wake at the stern.
        const wx = right ? sx - 3 : sx + m.len;
        fill(ctx, wx, yb - 4, 3, 1, PAL.mist);
        break;
      }
    }
    void r;
  }

  /**
   * Where the waiting cat looks: at the sunrise when it is close, else at whatever is coming at it along its row or the
   * next one, else at you, with a blink now and then.
   */
  function eyesFor(r: Run): ART.Eyes {
    if (Math.sin(time * 1.3) > 0.985) return "blink";
    if (!r.dawnOff && r.gap < 2.6) return "ahead";
    let best = 40;
    let side: ART.Eyes = "ahead";
    for (const i of [r.cat.row + 1, r.cat.row]) {
      const row = r.row(i);
      if (row.kind === "path" || row.kind === "bog") continue;
      for (const m of row.movers) {
        const mx = moverX(row, m, r.t) + m.len / 2;
        const d = mx - r.cat.x;
        // Only things heading for the cat (not already past it), and not the boat it stands on.
        if (Math.sign(d) === row.dir || Math.abs(d) < m.len / 2 + 2) continue;
        if (Math.abs(d) < best) {
          best = Math.abs(d);
          side = d < 0 ? "left" : "right";
        }
      }
    }
    return side;
  }

  function drawCat(r: Run) {
    const pose = catPose(r);
    const c = r.cat;
    const yb = rowBottom(pose.row);
    const x = A(pose.x);
    const f = r.flight;
    // A little pool of candlelight round its feet, so the black cat is easy to find among the lanes; its shadow in it.
    if (!(f && f.kind === "lift")) {
      const gy = rowBottom(Math.round(pose.row)) - 3;
      for (let dy = -3; dy <= 2; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          if ((dx / 10) ** 2 + (dy / 3.2) ** 2 > 1) continue;
          if (dither(Math.round(x) + dx, gy + dy, 0.28)) fill(ctx, Math.round(x) + dx, gy + dy, 1, 1, PAL.butter);
        }
      }
      fill(ctx, Math.round(x) - 4, yb - 2, 9, 1, PAL.ink);
    }
    let img: HTMLCanvasElement;
    let flip = false;
    if (mode === "over" && r.over) {
      img = time - (overInfo?.t ?? time) < 0.8 ? spr.cat.yawn : spr.cat.sleep;
    } else if (f && f.kind !== "lift") {
      img = f.kind === "bonk" ? spr.cat.dizzy : spr.cat.wet;
    } else if (failLook && failLook.until > time && c.stun > 0) {
      img = failLook.kind === "bonk" ? spr.cat.dizzy : spr.cat.wet;
    } else if (f) {
      img = spr.cat.front;
    } else if (r.hop && r.hop.kind !== "bump") {
      // Mid-hop it turns to go: its back, stretched long.
      flip = c.face < 0;
      img = flip ? spr.leapFlip : spr.cat.leap;
    } else if (r.pressing || landSquash > 0 || r.hop) {
      img = spr.cat.crouch;
    } else img = spr.eyes[eyesFor(r)];
    // Blinking while nothing can bump it (two blinks a second at most).
    if (c.invuln > 0 && c.state === "ok" && light.pulse(time, 2, { still: 1 }) < 0.3) return;
    const cx = flip ? img.width - 1 - ART.CAT_RIM_CX : ART.CAT_RIM_CX;
    // Its feet sit on the same line in every frame (the rim stops above them).
    const yy = yb - img.height - Math.round(pose.lift);
    if (f && f.kind === "lift") {
      // Under the witch's broom.
      blit(ctx, spr.witch, Math.round(x) - 14, yy - 15);
    }
    blit(ctx, img, Math.round(x) - cx, yy);
    if (f && f.kind === "bonk" && !reduced) {
      // Dizzy stars round its head.
      for (let s = 0; s < 3; s++) {
        const a = time * 6 + (s * Math.PI * 2) / 3;
        fill(ctx, Math.round(x + Math.cos(a) * 6), Math.round(yy - 1 + Math.sin(a) * 2), 1, 1, PAL.butter);
      }
    }
    if (mode === "over" && r.over && time - (overInfo?.t ?? time) > 0.8) {
      // z z z
      const k = ((time - (overInfo?.t ?? 0)) * 0.8) % 1;
      drawText(ctx, "z", Math.round(x) + 6 + Math.round(k * 4), yy - 2 - Math.round(k * 8), k < 0.7 ? PAL.cream : PAL.mauve);
    }
  }

  function drawWorld() {
    const r = shown();
    const [r0, r1] = visibleRows();
    drawGround(r, r0, r1);
    // The best-row ribbon (drawn on the ground).
    if (bestRows !== null && bestRows > 0 && mode !== "over" && !(mode === "play" && ribbonGone)) {
      const bi = bestRows + RULES.startRow;
      const yb = rowBottom(bi);
      if (yb > -4 && yb - CELL < SH) {
        const y = yb - CELL;
        for (let x = A(0); x < A(FW); x++) fill(ctx, x, y, 1, 1, (x >> 2) % 2 ? PAL.dawn : PAL.blush);
        blit(ctx, spr.flag, A(0) - 6, y - 8);
        drawText(ctx, "best", A(FW) - textWidth("best") - 1, y - 9, PAL.dawn, { outline: PAL.ink });
      }
    }
    const pose = catPose(r);
    const catRow = r.flight ? -1 : Math.floor(pose.row + 1e-6);
    for (let i = r1; i >= r0; i--) {
      drawRow(r, i);
      if (i === catRow) drawCat(r);
    }
    if (catRow < 0) drawCat(r);
    if (margins) ctx.drawImage(margins, 0, 0);
    drawDawn(r);
  }

  /** First light: the dawn front climbs the hill behind the cat, warm dither below it. */
  function drawDawn(r: Run) {
    if (r.dawnOff) return;
    const front = rowBottom(r.dawn + 0.5);
    if (front > SH) return;
    // Warm light in steps (3 px each), brighter further behind the front: a sunrise coming up the hill.
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "screen";
    for (let k = 0; k < DAWN_STEPS.length; k++) {
      const y0 = Math.max(0, front + k * 3);
      if (y0 >= SH) break;
      const y1 = k === DAWN_STEPS.length - 1 ? SH : Math.min(SH, front + (k + 1) * 3);
      if (y1 <= y0) continue;
      ctx.globalAlpha = DAWN_STEPS[k]!;
      ctx.fillStyle = k > 4 ? PAL.blush : PAL.dawn;
      ctx.fillRect(0, y0, SW, y1 - y0);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
    // A dither fringe just above the front, and the front itself glinting.
    if (front - 2 >= 0) ctx.drawImage(dawnTiles[2]!, 0, 0, SW, 2, 0, front - 2, SW, 2);
    if (front >= 0) for (let x = Math.floor(time * 4) % 4; x < SW; x += 4) fill(ctx, x, front, 1, 1, PAL.cream);
  }

  /**
   * Popups never cover the cat's row or the rows in front of it: they stack in a lane just behind it (below its feet,
   * rows it has already crossed), centred on it, newest on top, and slide in a couple of pixels.
   */
  function drawPopups() {
    const r = shown();
    const pose = catPose(r);
    const base = rowBottom(pose.row) + 3;
    popups.forEach((p, k) => {
      const slot = popups.length - 1 - k;
      const w = textWidth(p.text);
      const px = clamp(Math.round(A(pose.x) - w / 2), 3, SW - w - 3);
      const py = base + slot * 12 + Math.max(0, 2 - Math.floor(p.t * 20));
      if (py > SH - 10) return;
      plate(px - 2, py - 1, w + 4, 10, p.color);
      drawText(ctx, p.text, px, py, p.color);
    });
  }

  /** Margin (art px) a panel keeps from the edges of the area it sits in. */
  const PANEL_MARGIN = 3;

  /**
   * The one place panels are laid out. During play they centre on the screen; in attract and at game over the feed's
   * overlay is up and `insets.preview` reserves the action rail on the right (spec §5), so they centre in the
   * preview-safe area left of it.
   */
  function panel(innerW: number, pad: number): { x: number; w: number; cx: number } {
    const w = innerW + pad * 2 + ((innerW + pad * 2) % 2);
    let lo = PANEL_MARGIN;
    let hi = SW - PANEL_MARGIN;
    let centre = SW / 2;
    if (mode !== "play") {
      const safe = scr.safe(session.preview());
      lo = Math.max(lo, safe.x0 + PANEL_MARGIN);
      hi = Math.min(hi, safe.x1 - PANEL_MARGIN);
      centre = (safe.x0 + safe.x1) / 2;
    }
    const x = Math.max(lo, Math.min(hi - w, Math.round(centre - w / 2)));
    return { x, w, cx: x + w / 2 };
  }

  function drawBanner() {
    const b = banner;
    if (!b) return;
    const k = reduced ? 1 : easeOutBack(clamp(b.t / 0.22, 0, 1));
    const out = clamp((b.life - b.t) / 0.18, 0, 1);
    const imgs = b.lines.map((l) => (l.big ? chunky(l.text, l.color ?? "y") : null));
    const widths = b.lines.map((l, i) => (imgs[i] ? imgs[i]!.width : textWidth(l.text)));
    const heights = b.lines.map((_, i) => (imgs[i] ? imgs[i]!.height : 10));
    const box = panel(Math.min(BANNER_TEXT, Math.max(...widths)), 5);
    const { x, cx } = box;
    const h = heights.reduce((s, v) => s + v, 0) + 6;
    const base = mode === "over" ? scr.safe(session.preview()).y0 + 34 : top + 22;
    const y = Math.round(base + (1 - k) * 8 - (1 - out) * 6);
    plate(x, y, box.w, h, b.rim);
    let yy = y + 3;
    b.lines.forEach((l, i) => {
      if (imgs[i]) ctx.drawImage(imgs[i]!, Math.round(cx - imgs[i]!.width / 2), yy);
      else if (l.text) drawText(ctx, l.text, cx, yy, l.color ?? PAL.cream, { align: "center" });
      yy += heights[i]!;
    });
  }

  /** The night sky along the top edge, behind the HUD (and the feed's top tabs in attract). */
  function drawSky() {
    const h = top + 14;
    fill(ctx, 0, 0, SW, h, PAL.ink);
    for (let x = 0; x < SW; x++) {
      if (dither(x, 0, 0.5)) fill(ctx, x, h, 1, 1, PAL.ink);
      if (dither(x, 1, 0.25)) fill(ctx, x, h + 1, 1, 1, PAL.ink);
    }
    for (const s of stars) {
      if (s.y >= h - 1) continue;
      const tw = light.pulse(time, 0.35, { phase: s.ph, still: 0.6 });
      fill(ctx, s.x, s.y, 1, 1, tw > 0.75 ? PAL.cream : tw > 0.4 ? PAL.mauve : PAL.dusk);
    }
  }

  function drawFireflies() {
    for (const f of flies) {
      const x = Math.round(f.x + Math.sin(time * 0.7 + f.ph) * 6);
      const y = Math.round(f.y + Math.sin(time * 0.9 + f.ph * 2) * 4);
      const glow = light.pulse(time, 0.5, { phase: f.ph * 3, still: 0.7 });
      if (glow < 0.35) continue;
      fill(ctx, x, y, 1, 1, glow > 0.8 ? PAL.butter : PAL.candle);
    }
  }

  function drawHud() {
    const r = run;
    if (!r || mode === "attract") return;
    const y = top + 2;
    const { scoreEnd, rowsX, fishX } = hudLanes(SW);
    // Score lane: the score, the zoomies multiplier, and under it what's left of the zoomies.
    const scoreText = fmt(shownScore);
    drawText(ctx, scoreText, 3, y - (scoreBump > 0.5 ? 1 : 0), PAL.butter, { outline: PAL.ink });
    const mult = r.over ? 1 : r.mult;
    const mx = 3 + textWidth(scoreText) + 3;
    if (mult > 1 && mx + textWidth(`x${mult}`) + 1 <= scoreEnd) drawText(ctx, `x${mult}`, mx, y, mult >= 4 ? PAL.dawn : PAL.blush, { outline: PAL.ink });
    if (r.streak > 0 && !r.over) {
      const w = Math.round(r.zoomLeft * 20);
      fill(ctx, 3, y + 9, 21, 3, PAL.ink);
      fill(ctx, 4, y + 10, w, 1, mult >= 4 ? PAL.dawn : PAL.blush);
    }
    // Rows lane: the moon and the rows climbed.
    blit(ctx, spr.moon, rowsX, y - 1);
    drawText(ctx, String(r.rows), rowsX + MOON_W, y, PAL.frost, { outline: PAL.ink });
    // Fish lane: the fish and the basket (five fills it: a broom ride).
    blit(ctx, spr.fish, fishX, y + 1);
    for (let i = 0; i < RULES.liftEvery; i++) {
      const px = fishX + FISH_W + 2 + i * PIP;
      fill(ctx, px, y + 1, 4, 4, PAL.ink);
      fill(ctx, px + 1, y + 2, 2, 2, i < r.basket ? PAL.butter : PAL.dusk);
    }
  }

  function drawSign() {
    if (mode !== "attract" && !(mode === "over" && session.standalone && overInfo && time > endAt + 0.6)) return;
    const safe = scr.safe(session.preview());
    if (mode === "attract") {
      const { x, w } = panel(titleImg.width, 4);
      const h = titleImg.height + 6;
      const y = safe.y0 + 3;
      // A wooden garden sign on two posts, a lantern hung off one end.
      fill(ctx, x + 6, y + h, 2, 6, PAL.wood);
      fill(ctx, x + w - 8, y + h, 2, 6, PAL.wood);
      fill(ctx, x, y, w, h, PAL.ink);
      for (let j = 1; j < h - 1; j++) fill(ctx, x + 1, y + j, w - 2, 1, j === 1 ? PAL.ember : j === Math.floor(h / 2) ? PAL.night : j >= h - 3 ? PAL.night : PAL.wood);
      // Moss on top.
      fill(ctx, x + 1, y - 1, w - 2, 2, PAL.moss);
      for (let i = 2; i < w - 2; i += 4) fill(ctx, x + i, y - 2, 1, 1, PAL.sage);
      blit(ctx, titleImg, x + 4, y + 3);
      blit(ctx, spr.sparkle[Math.floor(time * 1.5) % 2]!, x + w - 2, y - 1, true);
      blit(ctx, spr.moon, x - 3, y + h - 2);
    }
    const prompt = "~ tap to play ~";
    const py = mode === "over" ? overStripY() - 14 : safe.y0 + 40;
    const soft = !reduced && time % 1.4 > 0.95;
    const sub = mode === "attract" ? (session.best !== null && session.best > 0 ? `best ${fmt(session.best)}` : "ahead of the sun") : "";
    const pw = Math.max(textWidth(prompt), sub ? Math.min(PANEL_TEXT, textWidth(sub)) : 0);
    const { x, w, cx } = panel(pw, 4);
    plate(x, py - 2, w, sub ? 22 : 12, PAL.dawn);
    drawText(ctx, prompt, cx, py, soft ? PAL.blush : PAL.cream, { align: "center" });
    if (sub) drawText(ctx, sub, cx, py + 10, PAL.mist, { align: "center" });
  }

  function overStripY(): number {
    const ins = scr.safe(session.preview());
    return session.standalone ? SH - 46 : ins.y1 - 40;
  }

  function drawOver() {
    if (mode !== "over" || !overInfo || !run) return;
    if (time < endAt - 0.2) return;
    const { x, w, cx } = panel(PANEL_TEXT, 2);
    const y = overStripY();
    plate(x, y, w, 38, overInfo.best ? PAL.sage : PAL.dawn);
    const [l1, l2, l3] = overInfo.lines;
    drawText(ctx, l1, cx, y + 2, PAL.cream, { align: "center" });
    // The bar against the best: this run's fill, a first-light tick where the best is.
    const bw = PANEL_TEXT - 6;
    const bx = Math.round(cx - bw / 2);
    const fillW = Math.round(bw * clamp((time - endAt + 0.2) / 0.5) * overInfo.frac);
    fill(ctx, bx - 1, y + 12, bw + 2, 4, PAL.ink);
    fill(ctx, bx, y + 13, fillW, 2, overInfo.best ? PAL.sage : PAL.butter);
    if (!overInfo.best) fill(ctx, bx + bw - 1, y + 11, 1, 6, PAL.dawn);
    drawText(ctx, l2, cx, y + 17, overInfo.best ? PAL.sage : PAL.butter, { align: "center" });
    drawText(ctx, l3, cx, y + 27, PAL.mist, { align: "center" });
    if (session.standalone) drawText(ctx, `${fmt(run.score)} points`, cx, y - 28, PAL.butter, { align: "center", outline: PAL.ink });
  }

  function drawHint() {
    if (mode !== "play" || !run || run.over) return;
    const r = run;
    const pose = catPose(r);
    const cx = A(pose.x);
    const yb = rowBottom(pose.row);
    if (hintStage === 0) {
      // A ghost paw tapping just below the cat.
      const down = Math.floor(time * 2) % 2 === 0;
      if (!reduced || Math.floor(time) % 2 === 0) blit(ctx, spr.paw, cx + (down ? 0 : 1), yb + 3 + (down ? 1 : 0), true);
      hintPlate(["tap to pad up", "a row at a time ~"], PAL.butter);
    } else if (hintStage === 1) {
      const k = Math.sin(time * 3);
      blit(ctx, spr.paw, cx + Math.round(k * 14), yb + 4, true);
      hintPlate(["swipe sideways", "to sidestep ~"], PAL.mist);
    } else if (r.canAct && time - lastInput > 2.5 && r.cat.stun <= 0) {
      // An idle nudge once taught: the paw comes back for a moment.
      if (Math.floor(time * 2) % 2 === 0) blit(ctx, spr.paw, cx, yb + 4, true);
    }
  }

  /** First-run hints: a plate in the lower part of the screen, below the cat. */
  function hintPlate(lines: string[], rim: string) {
    const box = panel(Math.max(...lines.map((l) => textWidth(l))), 4);
    const y = SH - lines.length * 10 - 6;
    plate(box.x, y - 2, box.w, lines.length * 10 + 2, rim);
    lines.forEach((l, i) => drawText(ctx, l, box.cx, y + i * 10, PAL.cream, { align: "center" }));
  }

  function render() {
    const o = nudge.offset(time);
    ctx.save();
    ctx.translate(o.x, o.y);
    drawWorld();
    drawFireflies();
    fx.draw(ctx);
    drawPopups();
    ctx.restore();
    drawSky();
    drawBanner();
    drawHud();
    drawHint();
    drawSign();
    drawOver();
    flash.draw(ctx, SW, SH);
    scr.present();
  }

  if (QA_AUTOPLAY) session.on("end", (e) => ((window as unknown as { __pmEnd: unknown }).__pmEnd = { score: e.score }));

  let readySent = false;
  tc.loop((dt) => {
    update(dt);
    render();
    if (readySent) warmGround();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
