import { clamp, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { onKeys } from "@thumbcade-games/kit/input";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { CRITTERS, PILOTS, type Critter } from "./ai.ts";
import * as ART from "./art.ts";
import { chunkyTitle, drawText, textWidth } from "./font.ts";
import { Nudge, PixelParticles, RAMP } from "./fx.ts";
import { PAL } from "./palette.ts";
import { CAT, clampMallet, CORNER, CRITTER, GOAL, GX0, GX1, L, MALLET_R, PUCK_R, W as RW } from "./physics.ts";
import { blit, createPixelScreen, dither, fill, Painter } from "./pixel.ts";
import { pilotCat, Run, RULES, type RunEvent } from "./run.ts";
import { overLines, PANEL_TEXT } from "./copy.ts";
import { BADGE, hudLanes, MOON_W, PIP } from "./layout.ts";
import { createSound, type Sfx } from "./sound.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = (Object.keys(PILOTS) as Array<keyof typeof PILOTS>).find((k) => k === import.meta.env.VITE_AUTOPLAY) ?? null;
/** Thumb travel (CSS px) to mallet travel: a little more than one to one, so a short stroke covers the half. */
const GAIN = 1.3;
/** Lanes on the ice (field y): banners sit in the critter's half under its den, first-run hints just below the centre
 * line, above where the stone is dropped for the cat. Neither ever covers the HUD or the other. */
const BANNER_Y = 66;
/** Attract: the prompt plate spans field y PROMPT_Y to PROMPT_Y + 22, and the demo cat keeps below it. */
const PROMPT_Y = L / 2 + 4;
const ATTRACT_CAT_Y = PROMPT_Y + 22 + 3 + MALLET_R + 4;
/** Attract: the demo critter keeps below the title sign (which ends about 22 px into the rink, posts included). */
const ATTRACT_CRITTER_Y = 36;

type Mode = "attract" | "play" | "over";
type Species = ART.Species;

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  /** -1 floats up, 1 sinks. */
  dir: number;
  /** Rides beside this mallet (on the side toward centre ice) instead of floating where it was made. */
  follow?: 0 | 1;
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

const speciesOf = (c: Critter): Species => c.id;
const voiceOf = (c: Critter): Sfx => c.id;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  const session = await createSession({ id: "frostwhisk" });
  const reduced = session.reducedMotion;
  const scr = createPixelScreen();
  const { ctx } = scr;
  const sfx = createSound();
  const fx = new PixelParticles(520);
  const nudge = new Nudge(reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.16, decay: 0.45 });
  const spr = ART.sprites();
  const titleImg = chunkyTitle("frostwhisk", { fill: "f", light: "c", dark: "i", outline: "k", shadow: "n", gap: 1 });
  const bigText = new Map<string, HTMLCanvasElement>();
  const chunky = (text: string, fillKey = "y") => {
    const key = `${text}|${fillKey}`;
    let c = bigText.get(key);
    if (!c) {
      const dark = fillKey === "y" ? "o" : fillKey === "f" ? "i" : fillKey === "r" ? "d" : fillKey === "s" ? "m" : "e";
      c = chunkyTitle(text, { fill: fillKey, light: "c", dark, outline: "k", shadow: "n" });
      bigText.set(key, c);
    }
    return c;
  };

  let taught = false;
  try {
    taught = (await tc.storage.get<number>("hint")) === 1;
  } catch {
    /* guest or offline */
  }

  // ---- layout ----------------------------------------------------------------------------------
  let SW = scr.w;
  let SH = scr.h;
  let top = 0;
  let ox = 5;
  let oy = 38;
  let backdrop: HTMLCanvasElement | null = null;
  const stars: Array<{ x: number; y: number; ph: number }> = [];
  const flakes: Array<{ x: number; y: number; v: number; ph: number }> = [];

  function layout() {
    SW = scr.w;
    SH = scr.h;
    top = scr.safe(session.play()).y0;
    ox = Math.floor((SW - RW) / 2);
    const minTop = top + 22;
    const spare = SH - minTop - L - 8;
    oy = minTop + Math.max(0, Math.floor(spare * 0.35));
    const r = createRng(41);
    stars.length = 0;
    for (let i = 0; i < 26; i++) stars.push({ x: r.int(1, SW - 2), y: r.int(1, Math.max(2, oy - 14)), ph: r.range(0, 6) });
    flakes.length = 0;
    for (let i = 0; i < 18; i++) flakes.push({ x: r.range(0, SW), y: r.range(0, SH), v: r.range(4, 9), ph: r.range(0, 6) });
    backdrop = paintBackdrop();
  }

  /** Signed distance (field units) from the rounded boards: negative on the ice, positive in the snow. */
  function boardDist(x: number, y: number): number {
    const dx = Math.abs(x - RW / 2) - (RW / 2 - CORNER);
    const dy = Math.abs(y - L / 2) - (L / 2 - CORNER);
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - CORNER;
  }

  function paintBackdrop(): HTMLCanvasElement {
    const P = new Painter(SW, SH);
    const r = createRng(7);
    // Night sky over the treeline, snow all round the pond.
    const skyEnd = oy - 9;
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        if (y < skyEnd) {
          const t = y / Math.max(1, skyEnd);
          P.set(x, y, dither(x, y, t * 0.9) ? PAL.night : PAL.ink);
        } else {
          const n = Math.sin(x * 0.31 + y * 0.07) + Math.sin(x * 0.11 - y * 0.23) * 0.8;
          P.set(x, y, n > 1.1 ? PAL.cream : dither(x, y, 0.18 + 0.1 * Math.sin(y * 0.2)) ? PAL.mist : PAL.frost);
        }
      }
    }
    // Pines along the far bank, behind the critter's den, and a few down the sides.
    const pine = ART.PINE;
    const plant = (px: number, py: number) => {
      pine.forEach((row, j) => [...row].forEach((ch, i) => ch !== "." && P.set(px + i, py + j, ch === "c" ? PAL.cream : ch === "t" ? PAL.teal : ch === "p" ? PAL.pond : PAL.wood)));
    };
    for (let x = -3; x < SW; x += 8 + r.int(0, 4)) {
      const inDen = x + 7 > ox + GX0 - 10 && x < ox + GX1 + 10;
      if (!inDen) plant(x, Math.max(top + 13, skyEnd - 10 + r.int(-2, 1)));
    }
    // The ice.
    for (let y = -8; y < L + 8; y++) {
      for (let x = -8; x < RW + 8; x++) {
        const d = boardDist(x + 0.5, y + 0.5);
        const ax = ox + x;
        const ay = oy + y;
        if (d < 0) {
          // Blue-black ice with lighter streaks where the moon catches it, a reflected moon path down the middle.
          const streak = Math.sin(x * 0.09 + y * 0.045) * Math.sin(y * 0.031 - x * 0.02) + Math.sin((x - y) * 0.05) * 0.4;
          const moonPath = Math.max(0, 1 - Math.abs(x - RW * 0.62 + y * 0.05) / 9) * Math.max(0, 1 - y / (L * 0.55));
          let c: string = PAL.pond;
          if (dither(ax, ay, clamp(streak * 0.5 - 0.15, 0, 0.5))) c = PAL.glacier;
          if (dither(ax, ay, moonPath * 0.55)) c = moonPath > 0.7 && dither(ax + 1, ay, 0.3) ? PAL.frost : PAL.glacier;
          if (d > -1.2) c = PAL.ink;
          else if (d > -2.2 && y < L / 2) c = PAL.night;
          P.set(ax, ay, c);
        } else if (d < 4.5) {
          const inMouth = x > GX0 && x < GX1 && (y < 2 || y > L - 2);
          if (inMouth) continue;
          // Snowbank boards: shaded face, frost top, cream lip.
          P.set(ax, ay, d < 1.2 ? PAL.mist : d < 3.2 ? PAL.frost : y < L / 2 ? PAL.cream : PAL.frost);
        } else if (d < 5.5) {
          P.set(ax, ay, PAL.mist);
        }
      }
    }
    // The dens behind each mouth.
    for (const [gy, dir] of [[0, -1], [L, 1]] as const) {
      for (let j = 0; j < 7; j++) {
        for (let x = GX0 + 1; x < GX1; x++) {
          const edge = x === GX0 + 1 || x === GX1 - 1 || j === 6;
          const yy = oy + gy + dir * (j + 1) - (dir < 0 ? 0 : 1);
          P.set(ox + x, yy, edge ? PAL.ink : j > 3 ? PAL.ink : PAL.night);
        }
      }
    }
    // Markings frozen into the ice: centre line and circle, creases in front of the dens.
    for (let x = 3; x < RW - 3; x += 2) P.set(ox + x, oy + L / 2, x % 4 === 1 ? PAL.mist : PAL.glacier);
    const ring = (cx: number, cy: number, rr: number, from: number, to: number, step: number, col: string) => {
      for (let a = from; a <= to; a += step) {
        const x = Math.round(cx + Math.cos(a) * rr);
        const y = Math.round(cy + Math.sin(a) * rr);
        if (boardDist(x, y) < -2) P.set(ox + x, oy + y, col);
      }
    };
    ring(RW / 2, L / 2, 16, 0, Math.PI * 2, 0.13, PAL.glacier);
    ring(RW / 2, 0, GOAL / 2 + 6, 0.1, Math.PI - 0.1, 0.09, PAL.glacier);
    ring(RW / 2, L, GOAL / 2 + 6, Math.PI + 0.1, Math.PI * 2 - 0.1, 0.09, PAL.glacier);
    for (const [fx2, fy2] of [[RW / 2, L / 2], [30, 52], [RW - 30, 52], [30, L - 52], [RW - 30, L - 52]] as const) {
      P.set(ox + fx2, oy + fy2, PAL.mist);
      P.set(ox + fx2 - 1, oy + fy2, PAL.glacier);
      P.set(ox + fx2 + 1, oy + fy2, PAL.glacier);
    }
    // Frozen-in bits: bubbles, a leaf, hairline cracks.
    for (let i = 0; i < 9; i++) {
      const bx = r.int(10, RW - 10);
      const by = r.int(14, L - 14);
      if (Math.abs(by - L / 2) < 20) continue;
      P.set(ox + bx, oy + by, PAL.glacier);
      P.set(ox + bx + 1, oy + by - 1, PAL.mist);
    }
    for (const [lx, ly] of [[22, 136], [96, 70]] as const) {
      P.set(ox + lx, oy + ly, PAL.ember);
      P.set(ox + lx + 1, oy + ly, PAL.wood);
      P.set(ox + lx, oy + ly + 1, PAL.wood);
    }
    for (let c = 0; c < 3; c++) {
      let x = r.int(15, RW - 15);
      let y = r.int(20, L - 20);
      for (let k = 0; k < 14; k++) {
        if (boardDist(x, y) < -3 && Math.abs(y - L / 2) > 3) P.set(ox + x, oy + y, PAL.glacier);
        x += r.int(-1, 1) || 1;
        y += r.int(0, 1);
      }
    }
    return P.toCanvas();
  }

  layout();
  scr.onResize(layout);
  session.on("insets", layout);

  // ---- state -----------------------------------------------------------------------------------
  let mode: Mode = "attract";
  let time = 0;
  let demo = newDemo(0);
  let run: Run | null = null;
  let qaPilot: ReturnType<typeof pilotCat> | null = null;
  let popups: Popup[] = [];
  let banner: Banner | null = null;
  const bannerQueue: Banner[] = [];
  let shownScore = 0;
  let scoreBump = 0;
  let clockBump = 0;
  let endAt = -1;
  let ended = false;
  let isBest = false;
  let bestShown = false;
  let overInfo: { champion: boolean; lines: [string, string, string]; best: boolean } | null = null;
  const moods: Array<{ mood: ART.Mood; until: number }> = [
    { mood: "look", until: 0 },
    { mood: "look", until: 0 },
  ];
  const bump = [
    { x: 0, y: 0, t: 0 },
    { x: 0, y: 0, t: 0 },
  ];
  let trail: Array<{ x: number; y: number }> = [];
  let denGlow = [0, 0];
  let ko: { from: number; t: number } | null = null;
  let entering: { critter: number; t: number } | null = null;
  let dragDist = 0;
  let hintStage = 0;
  let hintT = 0;
  let lastTick = -1;

  function newDemo(seed: number): { run: Run; drive: (r: Run, dt: number) => void } {
    const r = new Run((session.ctx.seed ^ 0xde70 ^ seed) >>> 0);
    const cat = pilotCat(PILOTS.good, seed + 11);
    // The demo cat plays below the "tap to play" plate, so the plate never covers it.
    const drive = (run: Run, dt: number) => {
      cat.drive(run, dt);
      const m = run.table.mallets[CAT];
      m.ty = Math.max(m.ty, ATTRACT_CAT_Y);
    };
    r.critterFloor = ATTRACT_CRITTER_Y;
    // Pre-roll so the first frame is mid-rally.
    for (let i = 0; i < 150; i++) {
      r.update(1 / 60, drive);
      r.drain();
      r.clock = 30;
    }
    return { run: r, drive };
  }

  /** The run being shown. */
  const shown = (): Run => (mode === "attract" || !run ? demo.run : run);

  // ---- input -----------------------------------------------------------------------------------
  let drag: { id: number; x: number; y: number } | null = null;
  const canDrive = () => mode === "play" && run !== null && !run.over && !QA_AUTOPLAY;
  window.addEventListener("pointerdown", (e) => {
    if (!canDrive() || drag) return;
    sfx.unlock();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const m = run!.table.mallets[CAT];
    m.tx = m.x;
    m.ty = m.y;
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id || !canDrive()) return;
    const dx = scr.artLen(e.clientX - drag.x) * GAIN;
    const dy = scr.artLen(e.clientY - drag.y) * GAIN;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const m = run!.table.mallets[CAT];
    const c = clampMallet(CAT, m.tx + dx, m.ty + dy);
    m.tx = c.x;
    m.ty = c.y;
    dragDist += Math.hypot(dx, dy);
  });
  const release = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  session.on("cancel", () => (drag = null));
  const keyMove = (dx: number, dy: number) => () => {
    if (!canDrive()) return;
    const m = run!.table.mallets[CAT];
    const c = clampMallet(CAT, m.tx + dx, m.ty + dy);
    m.tx = c.x;
    m.ty = c.y;
    dragDist += 14;
  };
  onKeys({ left: keyMove(-14, 0), right: keyMove(14, 0), up: keyMove(0, -14), down: keyMove(0, 14) });
  session.startOnTap(window);

  session.on("start", () => {
    sfx.unlock();
    run = new Run((session.ctx.seed + session.runs * 7919) >>> 0);
    qaPilot = QA_AUTOPLAY ? pilotCat(PILOTS[QA_AUTOPLAY], session.runs + 5) : null;
    mode = "play";
    popups = [];
    banner = null;
    bannerQueue.length = 0;
    shownScore = 0;
    endAt = -1;
    ended = false;
    isBest = false;
    bestShown = false;
    overInfo = null;
    ko = null;
    entering = { critter: 0, t: 0 };
    trail = [];
    dragDist = 0;
    hintStage = taught || QA_AUTOPLAY ? 3 : 0;
    hintT = 0;
    fx.clear();
    sfx.play("start");
    sfx.play("frog", 0, 0.8);
    sfx.music("waltz");
    say([{ text: "pip the frog", color: PAL.cream }, { text: "first to 2 goals", color: PAL.mist }], PAL.mist, 1.6);
  });

  // ---- feedback helpers --------------------------------------------------------------------------
  const A = (x: number) => ox + x;
  const B = (y: number) => oy + y;

  function pop(text: string, x: number, y: number, color: string, life = 0.9, dir = -1, follow?: 0 | 1) {
    popups = popups.filter((p) => p.text !== text);
    popups.push({ text, x, y, t: 0, life, color, dir, ...(follow === undefined ? {} : { follow }) });
    if (popups.length > 5) popups.shift();
  }

  function say(lines: BannerLine[], rim: string = PAL.butter, life = 1.1) {
    const b = { lines, t: 0, life, rim };
    if (!banner) banner = b;
    else if (bannerQueue.length < 3) bannerQueue.push(b);
  }

  function setMood(who: 0 | 1, mood: ART.Mood, secs: number) {
    moods[who] = { mood, until: time + secs };
  }

  function burst(x: number, y: number, n: number, ramp: readonly string[], speed: [number, number] = [20, 60], shape: "dot" | "big" | "spark" | "plus" = "dot", gravity = 0) {
    if (reduced) n = Math.ceil(n / 2);
    fx.emit(x, y, { count: n, speed, life: [0.25, 0.7], ramp, shape, drag: 3, gravity });
  }

  function react(e: RunEvent, live: boolean) {
    const r = shown();
    const vol = live ? 1 : 0.35;
    switch (e.type) {
      case "hit": {
        const k = clamp(e.impact / 320, 0, 1);
        sfx.play("clack", k * 5 - 2, (0.45 + 0.55 * k) * vol);
        if (k > 0.35) sfx.play("clackTop", 0, k * vol);
        const m = r.table.mallets[e.who];
        const nx = e.x - m.x;
        const ny = e.y - m.y;
        const d = Math.hypot(nx, ny) || 1;
        bump[e.who] = { x: Math.round((-nx / d) * (k > 0.3 ? 1 : 0)), y: Math.round((-ny / d) * (k > 0.3 ? 1 : 0)), t: 0.08 };
        burst(A(e.x - (nx / d) * PUCK_R), B(e.y - (ny / d) * PUCK_R), 2 + Math.round(k * 7), RAMP.frost, [15, 40 + 70 * k]);
        if (e.who === CRITTER && e.impact > 60) setMood(1, "swing", 0.25);
        if (e.who === CAT && e.impact > 60) setMood(0, "swing", 0.2);
        if (live && e.who === CAT && k > 0.55) nudge.kick(1, 0.08);
        break;
      }
      case "rail": {
        const k = clamp(e.speed / 300, 0, 1);
        if (e.post) {
          sfx.play("tink", 0, (0.5 + k * 0.5) * vol);
          burst(A(e.x), B(e.y), 3, RAMP.spark, [10, 40], "spark");
        } else {
          sfx.play("snow", k * 3, (0.3 + 0.7 * k) * vol);
          // Snow spray off the bank, thrown back onto the ice.
          const sx = e.x < 8 ? 1 : e.x > RW - 8 ? -1 : 0;
          const sy = e.y < 8 ? 1 : e.y > L - 8 ? -1 : 0;
          const a = Math.atan2(sy, sx || 0.0001);
          if (k > 0.15) fx.emit(A(e.x - sx * PUCK_R), B(e.y - sy * PUCK_R), { count: reduced ? 2 : 2 + Math.round(k * 6), speed: [15, 50 * k + 15], angle: [a - 0.9, a + 0.9], life: [0.3, 0.6], ramp: RAMP.frost, drag: 3 });
        }
        break;
      }
      case "block":
        if (!live) break;
        sfx.play("block");
        sfx.play("blockWhoosh");
        hitStop.freeze(0.05);
        // Rides beside the cat, never over it or the stone (which flies off upward).
        pop(`block! +${e.points}`, 0, 0, PAL.mist, 0.9, 0, CAT);
        burst(A(e.x), B(e.y), 8, RAMP.mist, [30, 70], "spark");
        setMood(0, "cheer", 0.45);
        session.feedback("tap");
        break;
      case "saved":
        if (!live) break;
        sfx.play("nope");
        pop("nope!", 0, 0, PAL.blush, 0.75, 0, CRITTER);
        setMood(1, "cheer", 0.4);
        break;
      case "goal": {
        // A touch that didn't stop it wasn't a save after all.
        popups = popups.filter((p) => !(e.by === CAT ? p.text === "nope!" : p.text.startsWith("block!")));
        if (e.by === CAT) {
          denGlow[1] = 1;
          const pts = `+${fmt(e.points)}`;
          const title = e.buzzer ? "buzzer!" : e.bank && e.zinger ? "moonshot!" : e.bank ? "bank shot!" : e.zinger ? "zinger!" : e.own ? "oops in!" : "goal!";
          if (!live) {
            sfx.play("plink", 0, 0.4);
            burst(A(e.x), B(0) + 3, 6, RAMP.moon, [20, 60], "spark");
            break;
          }
          sfx.play("goal", e.frenzy ? 2 : 0);
          sfx.play("goalBell", e.mult - 1);
          window.setTimeout(() => sfx.play(voiceOf(r.current), -2, 0.9), 250);
          hitStop.freeze(e.zinger ? 0.16 : 0.12);
          nudge.kick(2, 0.22);
          flash.trigger(PAL.cream, e.bank || e.zinger ? 1 : 0.7);
          burst(A(e.x), B(0) + 2, 22, RAMP.moon, [30, 110], "spark", 30);
          burst(A(e.x), B(0) + 2, 14, RAMP.frost, [20, 70], "big", 40);
          setMood(1, "shock", 1.1);
          setMood(0, "cheer", 1.1);
          scoreBump = 1;
          if (e.time > 0) clockBump = 1;
          const lines: BannerLine[] = [{ text: title, big: true, color: e.bank || e.zinger || e.buzzer ? "f" : "y" }, { text: `${pts}${e.time > 0 ? `   +${e.time}s` : ""}`, color: PAL.butter }];
          if (e.mult > 1 || e.frenzy) lines.push({ text: [e.mult > 1 ? `x${e.mult} streak` : "", e.frenzy ? "x2 late" : ""].filter(Boolean).join(" · "), color: PAL.blush });
          say(lines, PAL.butter, 1.05);
          session.feedback("impact");
        } else {
          denGlow[0] = 1;
          if (!live) {
            sfx.play("plink", -5, 0.4);
            break;
          }
          sfx.play("aww");
          window.setTimeout(() => sfx.play(voiceOf(r.current), 3, 1), 150);
          nudge.kick(1, 0.16);
          burst(A(e.x), B(L) - 2, 12, RAMP.dust, [20, 60], "big", 30);
          setMood(1, "cheer", 1.0);
          setMood(0, "shock", 1.0);
          say([{ text: `${r.current.brain.name} scores`, color: PAL.blush }, { text: r.them < r.boutTo ? `${r.me} - ${r.them}` : "", color: PAL.cream }], PAL.rose, 0.9);
        }
        break;
      }
      case "tier":
        if (live) sfx.play("tier", e.mult * 2);
        break;
      case "ko": {
        if (!live) break;
        const c = CRITTERS[e.critter]!;
        ko = { from: e.critter, t: 0 };
        sfx.play("ko");
        sfx.play("tumble");
        hitStop.freeze(0.2);
        nudge.kick(3, 0.3);
        flash.trigger(PAL.butter, 1);
        burst(A(RW / 2), B(28), 30, RAMP.spark, [40, 130], "spark", 40);
        burst(A(RW / 2), B(28), 20, RAMP.moon, [30, 90], "plus", 50);
        const lines: BannerLine[] = [{ text: "knockout!", big: true, color: "y" }, { text: `${c.brain.name} is out! +${fmt(e.points)}`, color: PAL.butter }];
        if (e.comeback) lines.push({ text: "what a comeback!", color: PAL.blush });
        else if (e.shutout) lines.push({ text: "a clean sheet!", color: PAL.mist });
        if (e.time > 0) lines.push({ text: `+${e.time}s on the moon`, color: PAL.frost });
        say(lines, PAL.butter, 1.6);
        session.feedback("success");
        break;
      }
      case "next": {
        if (!live) break;
        const c = CRITTERS[e.critter]!;
        entering = { critter: e.critter, t: 0 };
        ko = null;
        sfx.play(voiceOf(c));
        say([{ text: c.label, color: PAL.cream }, { text: c.quip, color: PAL.mist }], PAL.mist, 1.5);
        break;
      }
      case "lostBout": {
        if (!live) break;
        sfx.play("aww", -3);
        say([{ text: `${r.current.brain.name} wins`, big: false, color: PAL.blush }, { text: e.time > 0 ? `-${e.time}s · go again` : "go again", color: PAL.cream }], PAL.rose, 1.4);
        break;
      }
      case "drop":
        sfx.play("plink", 0, 0.6 * vol);
        burst(A(e.x), B(e.y), 5, RAMP.frost, [10, 25]);
        break;
      case "frenzy":
        if (!live) break;
        sfx.play("frenzy");
        sfx.music("rush");
        say([{ text: "final seconds!", big: false, color: PAL.butter }, { text: "points count double", color: PAL.cream }], PAL.candle, 1.2);
        break;
      case "drift":
        sfx.play("gust", 0, vol);
        burst(A(r.table.puck.x), B(r.table.puck.y), 6, RAMP.steam, [10, 30]);
        break;
      case "lastShot":
        if (live) pop("on the line...", A(RW / 2), B(L / 2), PAL.butter, 1.3);
        break;
      case "over":
        if (live) finish(e.champion, e.bonus);
        break;
    }
  }

  function finish(champion: boolean, bonus: number) {
    const r = run!;
    mode = "over";
    drag = null;
    endAt = time + 0.85;
    sfx.music("off");
    sfx.play(champion ? "champion" : "moonset");
    const s = r.stats;
    const best = session.best;
    isBest = r.score > 0 && (best === null || r.score > best);
    overInfo = { champion, lines: overLines(s, r.critter, r.score, best, champion, bonus), best: isBest };
    if (champion) {
      flash.trigger(PAL.cream, 1);
      for (let i = 0; i < 5; i++) burst(A(10 + i * 25), B(L / 2), 14, RAMP.moon, [40, 120], "spark", 60);
      say([{ text: "champion!", big: true, color: "y" }, { text: "all five beaten!", color: PAL.cream }], PAL.butter, 2.2);
    } else {
      say([{ text: "moonset", big: true, color: "f" }, { text: `${fmt(r.score)} points`, color: PAL.butter }], PAL.mist, 1.6);
    }
    setMood(0, champion ? "cheer" : "dizzy", 3);
    setMood(1, champion ? "dizzy" : "cheer", 3);
  }

  // ---- update ----------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(Math.min(rawDt, 0.1));
    time += rawDt;
    fx.update(dt);
    nudge.update(rawDt);
    flash.update(rawDt);
    for (const b of bump) b.t = Math.max(0, b.t - rawDt);
    denGlow = denGlow.map((g) => Math.max(0, g - rawDt * 1.4));
    scoreBump = Math.max(0, scoreBump - rawDt * 3);
    clockBump = Math.max(0, clockBump - rawDt * 2.5);
    if (banner) {
      banner.t += rawDt;
      if (banner.t >= banner.life) banner = bannerQueue.shift() ?? null;
    }
    for (const p of popups) p.t += rawDt;
    popups = popups.filter((p) => p.t < p.life);
    if (ko) ko.t += rawDt;
    if (entering) {
      entering.t += rawDt;
      if (entering.t > 1.2) entering = null;
    }
    for (const f of flakes) {
      f.y += f.v * rawDt;
      f.x += Math.sin(time * 0.7 + f.ph) * 3 * rawDt;
      if (f.y > SH) {
        f.y = -2;
        f.x = Math.random() * SW;
      }
    }

    if (mode === "attract") {
      demo.run.update(dt, demo.drive);
      demo.run.clock = 30;
      for (const e of demo.run.drain()) react(e, false);
      if (demo.run.t > 70 || demo.run.critter > 1) demo = newDemo(Math.floor(time));
    } else if (run) {
      if (mode === "play") {
        run.update(dt, qaPilot?.drive);
        if (!qaPilot) {
          const m = run.table.mallets[CAT];
          if (Math.hypot(m.vx, m.vy) > 20) run.stats.moved += dt;
        }
        for (const e of run.drain()) react(e, true);
        // Ticking in the last five seconds.
        if (run.ticking && run.clock <= 5) {
          const s = Math.ceil(run.clock);
          if (s !== lastTick) {
            lastTick = s;
            sfx.play("tick", 0, 1);
          }
        }
        // A new best, the moment the score passes it.
        const best = session.best;
        if (!bestShown && best !== null && best > 0 && run.score > best) {
          bestShown = true;
          sfx.play("best");
          say([{ text: "new best!", big: true, color: "s" }, { text: `past ${fmt(best)}`, color: PAL.cream }], PAL.sage, 1.2);
          burst(A(RW / 2), B(L / 2), 24, RAMP.spark, [40, 120], "spark", 40);
          session.feedback("success");
        }
        // First run: teach the drag, then the goal.
        if (hintStage === 0 && dragDist > 40) {
          hintStage = 1;
          hintT = 0;
        }
        if (hintStage === 1) {
          hintT += rawDt;
          if (run.stats.goals > 0 || hintT > 6) {
            hintStage = 3;
            taught = true;
            tc.storage.set("hint", 1).catch(() => undefined);
          }
        }
      } else {
        // Over: keep the ice alive (the puck's off), let the critter gloat.
        run.update(dt);
        run.drain();
        if (!ended && endAt > 0 && time >= endAt) {
          ended = true;
          const s = run.stats;
          session.end(run.score, { outcome: s.champion ? "win" : "lose", stats: { goals: s.goals, against: s.against, critters: s.kos, streak: s.bestStreak, banks: s.banks } });
        }
      }
    }
    // Score roll and the stone's trail.
    const r = shown();
    const target = mode === "attract" ? 0 : r.score;
    shownScore = Math.abs(target - shownScore) < 1 ? target : shownScore + (target - shownScore) * (1 - Math.exp(-10 * rawDt));
    const p = r.table.puck;
    const sp = Math.hypot(p.vx, p.vy);
    if (r.table.live && sp > 60) {
      trail.push({ x: p.x, y: p.y });
      if (trail.length > (sp > 220 ? 7 : 5)) trail.shift();
    } else if (trail.length) trail.shift();
  }

  // ---- drawing ---------------------------------------------------------------------------------
  function plate(x: number, y: number, w: number, h: number, rim: string) {
    fill(ctx, x - 1, y - 1, w + 2, h + 2, PAL.ink);
    fill(ctx, x, y, w, h, PAL.night);
    fill(ctx, x, y, w, 1, rim);
    fill(ctx, x, y + h - 1, w, 1, PAL.dusk);
  }

  function drawWorld() {
    const r = shown();
    if (backdrop) ctx.drawImage(backdrop, 0, 0);
    // Stars twinkle (slowly, never strobing).
    for (const s of stars) {
      if (s.y >= oy - 12) continue;
      const tw = light.pulse(time, 0.35, { phase: s.ph, still: 0.6 });
      fill(ctx, s.x, s.y, 1, 1, tw > 0.75 ? PAL.cream : tw > 0.4 ? PAL.mauve : PAL.dusk);
    }
    // Den glows after a goal.
    for (const [i, gy, dir] of [[1, 0, -1], [0, L, 1]] as const) {
      const g = denGlow[i]!;
      if (g <= 0) continue;
      for (let j = 0; j < 5; j++) {
        for (let x = GX0 + 2; x < GX1 - 1; x++) {
          if (dither(x, j, g * (1 - j / 6))) fill(ctx, A(x), B(gy) + dir * (j + 1) - (dir < 0 ? 0 : 1), 1, 1, i === 1 ? PAL.butter : PAL.dusk);
        }
      }
    }
    // Lanterns by every post, flickering gently.
    for (const [gx, gy] of [[GX0, 0], [GX1, 0], [GX0, L], [GX1, L]] as const) {
      const f = light.flicker(time, gx * 3 + gy, { depth: 0.5, chance: 0.3, rate: 1.5 });
      const img = spr.lantern[f < 0.85 ? 1 : 0]!;
      const lx = A(gx) + (gx < RW / 2 ? -7 : 2);
      const ly = gy === 0 ? B(0) - 10 : B(L) - 2;
      blit(ctx, img, lx, ly);
    }
    // The stone's trail: frost pixels fading behind it.
    const live = r.table.live;
    if (live) {
      trail.forEach((t, i) => {
        const k = i / Math.max(1, trail.length);
        const c = k > 0.66 ? PAL.frost : k > 0.33 ? PAL.mist : PAL.glacier;
        const s = k > 0.5 ? 3 : 2;
        fill(ctx, A(t.x) - Math.floor(s / 2), B(t.y) - Math.floor(s / 2), s, s, run && run.frenzy && mode === "play" ? (k > 0.5 ? PAL.butter : PAL.candle) : c);
      });
    }
    drawMallets(r);
    if (mode === "attract") {
      // A ghost paw under the demo cat: the mallet follows a thumb.
      const m = r.table.mallets[CAT];
      blit(ctx, spr.paw, A(m.x) + 9, B(m.y) + 9, true);
    }
    // The stone.
    const a = r.alpha;
    const pv = r.table.prev;
    const p = r.table.puck;
    if (live || r.phase === "goal") {
      const px = live ? lerp(pv.px, p.x, a) : p.x;
      const py = live ? lerp(pv.py, p.y, a) : p.y;
      if (live) {
        const frame = ((Math.floor(p.spin * 2) % 4) + 4) % 4;
        // A soft shadow and the stone itself.
        fill(ctx, Math.round(A(px)) - 4, Math.round(B(py)) + 5, 9, 1, PAL.ink);
        blit(ctx, spr.stone[frame]!, A(px), B(py), true);
      }
    }
  }

  function drawMallets(r: Run) {
    const a = r.alpha;
    const pv = r.table.prev;
    const p = r.table.puck;
    for (const who of [CRITTER, CAT] as const) {
      const m = r.table.mallets[who];
      let x = lerp(pv.mx[who]!, m.x, a);
      let y = lerp(pv.my[who]!, m.y, a);
      let sp: Species = who === CAT ? "cat" : speciesOf(r.current);
      let mood: ART.Mood = moods[who]!.until > time ? moods[who]!.mood : "look";
      // Knockouts and entrances take the critter off and onto the ice.
      if (who === CRITTER && mode !== "attract") {
        if (ko && ko.t < 1.2) {
          const k = ko.t / 1.2;
          sp = speciesOf(CRITTERS[ko.from]!);
          mood = "dizzy";
          y = lerp(m.y, -40, easeOutCubic(k) * k);
          x += Math.sin(k * 12) * 6 * (1 - k);
        } else if (ko && run && run.phase === "ko") {
          // Gap between the two: the next one waits off the ice.
          const next = CRITTERS[ko.from + 1];
          if (!next) continue;
          sp = speciesOf(next);
          const k = clamp((ko.t - 1.2) / 1.1, 0, 1);
          y = lerp(-30, m.y, easeOutBack(k));
          mood = "look";
        } else if (entering && entering.t < 0.5 && entering.critter === 0) {
          y = lerp(-30, m.y, easeOutBack(entering.t / 0.5));
        }
      }
      if (mood === "look" && Math.sin(time * 1.3 + who * 2) > 0.985) mood = "blink";
      const lx = clamp(Math.round((p.x - x) / 30), -1, 1);
      const ly = clamp(Math.round((p.y - y) / 40), -1, 1);
      const img = ART.head(sp, mood, lx, ly);
      const b = bump[who]!;
      const bx = b.t > 0 ? b.x : 0;
      const by = b.t > 0 ? b.y : 0;
      // The critter tumbles off and skates on through its den, never over the HUD.
      ctx.save();
      if (who === CRITTER) {
        ctx.beginPath();
        ctx.rect(0, B(0) - 7, SW, SH);
        ctx.clip();
      }
      // Contact shadow on the ice.
      fill(ctx, Math.round(A(x)) - 6, Math.round(B(y)) + MALLET_R, 13, 1, PAL.ink);
      ctx.drawImage(img, Math.round(A(x)) - ART.CX - 1 + bx, Math.round(B(y)) - ART.CY - 1 + by);
      ctx.restore();
    }
  }

  /**
   * Moves a box (art px, outline included) toward centre ice until all four corners are on the ice, at least 2 px in
   * from the boards and the rounded corners.
   */
  function onIce(x: number, y: number, w: number, h: number): { x: number; y: number } {
    for (let i = 0; i < 80; i++) {
      const ok = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].every(([px, py]) => boardDist(px! - ox, py! - oy) <= -2);
      if (ok) break;
      x += Math.sign(A(RW / 2) - (x + w / 2));
      y += Math.sign(B(L / 2) - (y + h / 2));
    }
    return { x, y };
  }

  function drawPopups() {
    const r = shown();
    for (const p of popups) {
      const rise = Math.floor(Math.min(p.t, 0.4) * 18) * -p.dir;
      const w = textWidth(p.text);
      let px = p.x;
      let py = p.y - rise;
      if (p.follow !== undefined) {
        const m = r.table.mallets[p.follow];
        const side = m.x < RW / 2 ? 1 : -1;
        px = A(m.x) + side * (MALLET_R + 8 + w / 2);
        py = B(m.y) - 4;
      }
      // The plate is the text plus 2 px padding and a 1 px outline; the whole plate stays on the ice.
      const box = onIce(Math.round(px - w / 2) - 3, Math.round(py) - 2, w + 6, 12);
      if (p.t > p.life - 0.15 && Math.floor(p.t * 12) % 2 === 1 && !reduced) continue;
      plate(box.x + 1, box.y + 1, w + 4, 10, p.color);
      drawText(ctx, p.text, box.x + 3, box.y + 2, p.color);
    }
  }

  /** Margin (art px) a panel keeps from the edge of the area it sits in, and from the rink's boards. */
  const PANEL_MARGIN = 4;

  /**
   * The one place panels are laid out. During play (no feed overlay) they centre on the rink. In attract and at game
   * over the feed's overlay is up and `insets.preview` reserves the action rail on the right (spec §5), so they centre
   * in the preview-safe area left of it. Either way they keep PANEL_MARGIN from that area's edges and from the boards.
   * Returns the plate's left edge, its width and its centre.
   */
  function panel(innerW: number, pad: number): { x: number; w: number; cx: number } {
    // Even widths, so the plate's middle falls exactly on the centre line it is laid out on.
    const w = innerW + pad * 2 + ((innerW + pad * 2) % 2);
    let lo = A(0) + PANEL_MARGIN;
    let hi = A(RW) - PANEL_MARGIN;
    let centre = A(RW / 2);
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
    const box = panel(Math.min(RW - 18, Math.max(...widths)), 5);
    const { x, cx } = box;
    const h = heights.reduce((s, x) => s + x, 0) + 6;
    const cy = B(BANNER_Y);
    const y = Math.round(cy - h / 2 + (1 - k) * 8 - (1 - out) * 6);
    if (out < 0.4 && Math.floor(b.t * 20) % 2 === 1 && !reduced) return;
    plate(x, y, box.w, h, b.rim);
    let yy = y + 3;
    b.lines.forEach((l, i) => {
      if (imgs[i]) {
        ctx.drawImage(imgs[i]!, Math.round(cx - imgs[i]!.width / 2), yy);
      } else if (l.text) {
        drawText(ctx, l.text, cx, yy, l.color ?? PAL.cream, { align: "center" });
      }
      yy += heights[i]!;
    });
  }

  function drawHud() {
    const r = run;
    if (!r || mode === "attract") return;
    const y = top + 2;
    const { scoreEnd, pipsX, clockX } = hudLanes(SW);
    // Score lane: the score, and the streak multiplier while it still fits the lane.
    const scoreText = fmt(shownScore);
    drawText(ctx, scoreText, 3, y - (scoreBump > 0.5 ? 1 : 0), PAL.butter, { outline: PAL.ink });
    const mult = r.over ? 1 : r.mult * (r.frenzy ? 2 : 1);
    const mx = 3 + textWidth(scoreText) + 3;
    if (mult > 1 && mx + textWidth(`x${mult}`) + 1 <= scoreEnd) drawText(ctx, `x${mult}`, mx, y, r.frenzy ? PAL.candle : PAL.blush, { outline: PAL.ink });
    // Pips lane: the cat and its goals, then the critter and its goals, at fixed places.
    let px = pipsX;
    const pips = (count: number, on: string) => {
      for (let i = 0; i < r.boutTo; i++) {
        fill(ctx, px + i * PIP, y + 1, 5, 5, PAL.ink);
        fill(ctx, px + i * PIP + 1, y + 2, 3, 3, i < count ? on : PAL.dusk);
      }
      px += 3 * PIP + 1;
    };
    ctx.drawImage(spr.badges.cat, px, y + 1);
    px += BADGE + 1;
    pips(r.me, PAL.butter);
    px += 3;
    ctx.drawImage(spr.badges[speciesOf(r.current)], px, y + 1);
    px += BADGE + 1;
    pips(r.them, PAL.rose);
    // Clock lane: the moon and the time, centred between the other two.
    const secs = Math.ceil(r.clock);
    const low = r.clock <= RULES.frenzy && r.phase !== "over";
    const pulse = low ? light.pulse(time, 2, { still: 1 }) : 0;
    const clockText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    blit(ctx, spr.moon, clockX, y - 1);
    drawText(ctx, clockText, clockX + MOON_W - 1, y - (clockBump > 0.5 ? 1 : 0), low ? (pulse > 0.5 ? PAL.rose : PAL.blush) : clockBump > 0 ? PAL.butter : PAL.frost, { outline: PAL.ink });
  }

  function drawSign() {
    if (mode !== "attract" && !(mode === "over" && session.standalone && overInfo && time > endAt + 0.6)) return;
    const safe = scr.safe(session.preview());
    if (mode === "attract") {
      const { x, w } = panel(titleImg.width, 4);
      const h = titleImg.height + 6;
      const y = safe.y0 + 3;
      // A wooden sign on two posts stuck in the snow.
      fill(ctx, x + 6, y + h, 2, 6, PAL.wood);
      fill(ctx, x + w - 8, y + h, 2, 6, PAL.wood);
      fill(ctx, x, y, w, h, PAL.ink);
      for (let j = 1; j < h - 1; j++) fill(ctx, x + 1, y + j, w - 2, 1, j === 1 ? PAL.ember : j === Math.floor(h / 2) ? PAL.night : j >= h - 3 ? PAL.night : PAL.wood);
      // Snow on top.
      fill(ctx, x + 1, y - 1, w - 2, 2, PAL.cream);
      for (let i = 2; i < w - 2; i += 5) fill(ctx, x + i, y + 1, 2, 1, PAL.frost);
      blit(ctx, titleImg, x + 4, y + 3);
      blit(ctx, spr.sparkle[Math.floor(time * 1.5) % 2]!, x + w - 2, y - 1, true);
    }
    const prompt = "~ tap to play ~";
    const py = mode === "over" ? overStripY() - 14 : B(PROMPT_Y) + 2;
    const soft = !reduced && time % 1.4 > 0.95;
    const sub = mode === "attract" ? (session.best !== null && session.best > 0 ? `best ${fmt(session.best)}` : "pond hockey") : "";
    const pw = Math.max(textWidth(prompt), sub ? textWidth(sub) : 0);
    const { x, w, cx } = panel(pw, 4);
    plate(x, py - 2, w, sub ? 22 : 12, PAL.butter);
    drawText(ctx, prompt, cx, py, soft ? PAL.blush : PAL.cream, { align: "center" });
    if (sub) drawText(ctx, sub, cx, py + 10, PAL.mist, { align: "center" });
  }

  function overStripY(): number {
    const ins = scr.safe(session.preview());
    return session.standalone ? SH - 40 : ins.y1 - 34;
  }

  function drawOver() {
    if (mode !== "over" || !overInfo || !run) return;
    if (time < endAt - 0.2) return;
    // A fixed-width panel (every line fits PANEL_TEXT, see copy.ts), three centred lines.
    const { x, w, cx } = panel(PANEL_TEXT, 2);
    const y = overStripY();
    plate(x, y, w, 32, overInfo.champion ? PAL.butter : PAL.mist);
    const [l1, l2, l3] = overInfo.lines;
    drawText(ctx, l1, cx, y + 2, PAL.cream, { align: "center" });
    drawText(ctx, l2, cx, y + 11, overInfo.best ? PAL.sage : PAL.butter, { align: "center" });
    drawText(ctx, l3, cx, y + 21, PAL.mist, { align: "center" });
    if (session.standalone) drawText(ctx, `${fmt(run.score)} points`, cx, y - 28, PAL.butter, { align: "center", outline: PAL.ink });
  }

  function drawHint() {
    if (mode !== "play" || !run || hintStage > 1 || run.over) return;
    const m = run.table.mallets[CAT];
    if (hintStage === 0) {
      // A ghost paw sliding under the cat, and the one instruction that matters.
      const k = Math.sin(time * 2.4);
      const px = A(m.x) + Math.round(k * 22);
      const py = B(m.y) + 10;
      if (!reduced || Math.floor(time) % 2 === 0) blit(ctx, spr.paw, px, py, true);
      hintPlate(["drag anywhere", "to move the cat ~"], PAL.butter);
    } else if (hintStage === 1 && run.phase === "play") {
      hintPlate(["now knock it into", `${run.current.brain.name}'s den!`], PAL.mist);
    }
  }

  /** First-run hints: a plate between the centre line and where the stone is dropped, never over either. */
  function hintPlate(lines: string[], rim: string) {
    const box = panel(Math.max(...lines.map((l) => textWidth(l))), 4);
    const y = B(L / 2) + 6;
    plate(box.x, y - 2, box.w, lines.length * 10 + 2, rim);
    lines.forEach((l, i) => drawText(ctx, l, box.cx, y + i * 10, PAL.cream, { align: "center" }));
  }

  function drawSnow() {
    for (const f of flakes) fill(ctx, Math.round(f.x), Math.round(f.y), 1, 1, f.ph > 3 ? PAL.cream : PAL.frost);
  }

  function render() {
    const o = nudge.offset(time);
    ctx.save();
    ctx.translate(o.x, o.y);
    drawWorld();
    fx.draw(ctx);
    drawSnow();
    drawPopups();
    ctx.restore();
    drawBanner();
    drawHud();
    drawHint();
    drawSign();
    drawOver();
    flash.draw(ctx, SW, SH);
    scr.present();
  }

  if (QA_AUTOPLAY) session.on("end", (e) => ((window as unknown as { __fwEnd: unknown }).__fwEnd = { score: e.score }));

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
