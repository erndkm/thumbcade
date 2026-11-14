import { clamp, easeOutBack, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import { catSprite, HEARTH_W, makeSprites, paintFloor, paintGlow, paintRug, type Pose } from "./art.ts";
import { DX, DY, EMPTY, occupancy, squares, wayOf, type Board, type Cat } from "./board.ts";
import { BANNER_TEXT, LINES, overLines, PANEL_TEXT, TEACH, TITLE } from "./copy.ts";
import { chunkyTitle, drawText, textWidth } from "./font.ts";
import { Nudge, PixelParticles, RAMP } from "./fx.ts";
import { attractBoard, CELL, hud, playBoard } from "./layout.ts";
import { PAL } from "./palette.ts";
import { DEMO, Pilot, skillByName } from "./pilot.ts";
import { blit, createPixelScreen, fill } from "./pixel.ts";
import { PURR_NAMES, Run, TUNE, type RunListener } from "./run.ts";
import { createSound } from "./sound.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;
/** A press that wanders further than this (CSS px) is not a tap. */
const TAP_SLOP = 24;
/** A tap this close to a cat (art px) still counts as on it. */
const REACH = 7;
const PANEL_MARGIN = 3;
/** Rugs the attract demo plays before it starts over. */
const DEMO_RUGS = 3;

interface Popup {
  /** No outline (a sleeper's z). */
  plain?: boolean;
  text: string;
  x: number;
  y: number;
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

interface Leaving {
  cat: Cat;
  t0: number;
  ox: number;
  oy: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
/** A major pentatonic for the chirps, so a streak climbs a tune. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

async function main() {
  const session = await createSession({ id: "scootpurr" });
  const reduced = session.reducedMotion;
  const scr = createPixelScreen();
  const { ctx } = scr;
  const sfx = createSound();
  const fx = new PixelParticles(420);
  const nudge = new Nudge(reduced);
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.14, decay: 0.5 });
  const spr = makeSprites();
  const titleImg = chunkyTitle(TITLE, { fill: "y", light: "c", dark: "o", outline: "k", shadow: "n", gap: 1 });
  const bigText = new Map<string, HTMLCanvasElement>();
  const chunky = (text: string, fillKey = "y") => {
    const key = `${text}|${fillKey}`;
    let c = bigText.get(key);
    if (!c) {
      c = chunkyTitle(text, { fill: fillKey, light: "c", dark: fillKey === "y" ? "o" : fillKey === "r" ? "u" : "e", outline: "k", shadow: "n", gap: 1 });
      bigText.set(key, c);
    }
    return c;
  };
  const fxRng = createRng(session.ctx.seed ^ 0x5c07);

  // Player memory: how far the first-run plates got (0 nothing, 1 a cat is out, 2 a rug is clear).
  let taught = 0;
  try {
    const v = await tc.storage.get<number>("taught");
    if (typeof v === "number") taught = clamp(Math.floor(v), 0, 2);
  } catch {
    /* guest or offline: teach again */
  }

  // ---- layout ----------------------------------------------------------------------------------
  let SW = scr.w;
  let SH = scr.h;
  let top = 0;
  let floor: HTMLCanvasElement | null = null;
  let glow: HTMLCanvasElement | null = null;
  const rugs = new Map<string, ReturnType<typeof paintRug>>();
  function layout() {
    SW = scr.w;
    SH = scr.h;
    top = scr.safe(session.play()).y0;
    floor = paintFloor(SW, SH);
    glow = paintGlow(Math.min(SW - 8, 96));
  }
  layout();
  scr.onResize(layout);
  session.on("insets", layout);

  // ---- state -----------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let over: { t: number; isBest: boolean; ended: boolean; prev: number; lines: [string, string, string]; frac: number } | null = null;
  let passedBest = false;
  let popups: Popup[] = [];
  let banner: Banner | null = null;
  let leaving: Leaving[] = [];
  const bumps = new Map<number, { t0: number; free: number }>();
  const grump = new Map<number, number>();
  const plopAt = new Map<number, number>();
  let pressed: { id: number; x: number; y: number } | null = null;
  let scoreShown = 0;
  let candleShown: number = TUNE.clock;
  let lastInput = 0;
  let lastTick = 0;
  let lastZ = 0;
  let music: "off" | "lullaby" | "hurry" = "off";
  let demoRugs = 0;
  let demoSeed = session.ctx.seed;
  const later: { at: number; fn: () => void }[] = [];
  const schedule = (delay: number, fn: () => void) => later.push({ at: time + delay, fn });

  const demo = new Pilot(DEMO, createRng(session.ctx.seed ^ 0xd3));
  const qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;
  const vol = () => (mode === "attract" ? 0.35 : 1);

  /** Where the rug's squares start on screen. */
  function origin(b: Board): { x: number; y: number } {
    return mode === "attract" ? attractBoard(scr.safe(session.preview()), b.cols, b.rows) : playBoard(SW, SH, top, b.cols, b.rows);
  }
  /** The middle of a cat, relative to the rug's origin. */
  function centre(c: Cat): { x: number; y: number } {
    const sq = squares(c);
    const xs = sq.map((s) => s[0]);
    const ys = sq.map((s) => s[1]);
    return { x: ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * CELL, y: ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * CELL };
  }

  function say(lines: BannerLine[], rim: string = PAL.butter, life = 1.2) {
    banner = { lines, t: 0, life, rim };
  }
  function pop(text: string, x: number, y: number, color: string, life = 0.8, plain = false) {
    popups.push({ text, x, y, t: 0, life, color, plain });
  }
  function burst(x: number, y: number, n: number, ramp: readonly string[], speed: [number, number] = [18, 55], shape: "dot" | "big" | "spark" | "plus" | "heart" = "dot", gravity = 0) {
    if (reduced) n = Math.ceil(n / 3);
    fx.emit(x, y, { count: n, speed, life: [0.3, 0.7], ramp, shape, gravity, drag: 1.5 });
  }
  function setMusic(m: typeof music) {
    if (m === music) return;
    music = m;
    sfx.music(m);
  }

  const listener: RunListener = {
    laid(board) {
      plopAt.clear();
      bumps.clear();
      grump.clear();
      // Set down one by one, the witch's cat first.
      board.cats.forEach((c, i) => {
        const at = time + 0.05 + i * 0.045;
        plopAt.set(c.id, at);
        if (i % 2 === 0) schedule(at - time, () => sfx.play("plop", (i % 5) * 2, 0.7 * vol()));
      });
    },
    cleared(e) {
      const o = origin(run.board);
      const cx = o.x + (run.board.cols * CELL) / 2;
      const cy = o.y + (run.board.rows * CELL) / 2;
      const lines: BannerLine[] = [{ text: LINES.clear, big: true }, { text: `+${fmt(e.points)}`, color: PAL.butter }];
      if (e.clean) lines.push({ text: `${LINES.clean} ~`, color: PAL.mist });
      if (e.last) lines.push({ text: `${LINES.last} ~`, color: PAL.rose });
      if (mode === "play") lines.push({ text: `+${e.refund.toFixed(1).replace(".0", "")}s of candle`, color: PAL.cream });
      say(lines, PAL.butter, TUNE.cheer + 0.2);
      sfx.play("clear", 0, vol());
      if (e.last) schedule(0.3, () => sfx.play("last", 0, vol()));
      flash.trigger(PAL.butter, 0.8);
      burst(cx, cy, 26, RAMP.gold, [25, 80], "spark");
      burst(cx, cy, 10, RAMP.heart, [20, 60], "heart", 20);
      session.feedback("success");
      if (mode === "play") {
        tc.analytics.track("level_complete", { level: e.level + 1 });
        if (taught < 2) {
          taught = 2;
          tc.storage.set("taught", 2).catch(() => undefined);
          tc.analytics.track("tutorial_complete");
        }
      }
    },
    tier(purr) {
      if (mode !== "play") return;
      const h = hud(SW, top);
      pop(`${PURR_NAMES[purr - 1]} x${purr}`, Math.max(2, h.scoreX), h.rowY + 22, PAL.rose, 1.4);
      sfx.play("tier", (purr - 2) * 2);
      session.feedback("success");
    },
  };

  let run = new Run(demoSeed, listener).start();

  function newRun(seed: number) {
    leaving = [];
    popups = [];
    banner = null;
    pressed = null;
    later.length = 0;
    fx.clear();
    demo.reset();
    qaPilot?.reset();
    run = new Run(seed >>> 0, listener).start();
  }

  /** A tap on a cat, from a finger or a pilot. */
  function tapCat(id: number) {
    const o = origin(run.board);
    const r = run.tap(id);
    lastInput = time;
    if (r.kind === "out") {
      const c = centre(r.cat);
      leaving.push({ cat: r.cat, t0: time, ox: o.x, oy: o.y });
      sfx.play("scoot", Math.min(10, r.streak * 0.5), vol());
      sfx.play("chirp", SCALE[Math.min(SCALE.length - 1, (r.streak - 1) % SCALE.length)]!, vol());
      if (r.purr > 1) sfx.play("purr", -(r.purr - 2) * 2, (0.5 + r.purr * 0.2) * vol());
      pop(`+${r.points}`, o.x + c.x, o.y + c.y - 8, r.purr > 1 ? PAL.butter : PAL.cream);
      burst(o.x + c.x, o.y + c.y, 4, RAMP.dust, [10, 30]);
      if (mode === "play" && taught === 0) {
        taught = 1;
        tc.storage.set("taught", 1).catch(() => undefined);
      }
    } else if (r.kind === "bump") {
      bumps.set(id, { t0: time, free: r.free });
      grump.set(id, time + 0.9);
      if (r.by >= 0) grump.set(r.by, time + 0.9);
      sfx.play("bonk", 0, vol());
      schedule(0.1, () => sfx.play("huff", 0, vol()));
      nudge.kick(1);
      const c = centre(r.cat);
      const nx = o.x + c.x + DX[r.cat.dir] * ((r.cat.len / 2 + r.free) * CELL + 2);
      const ny = o.y + c.y + DY[r.cat.dir] * ((r.cat.len / 2 + r.free) * CELL + 2);
      schedule(0.1, () => {
        burst(nx, ny, 5, RAMP.spark, [20, 55], "spark");
        pop(LINES.bump, nx, ny - 9, PAL.cream, 0.7);
      });
      if (r.cost > 0 && mode === "play") {
        const h = hud(SW, top);
        pop(`-${r.cost}s`, h.candleX + Math.round(h.candleW * clamp(run.clock / TUNE.max)) - 6, h.candleY + 6, PAL.candle, 0.9);
        session.feedback("impact");
      }
    }
  }

  // ---- input -----------------------------------------------------------------------------------
  const playing = () => session.phase === "playing" && mode === "play" && !over && !session.paused;

  /** The cat under (or nearest to) a point on screen, in art pixels. */
  function catAt(ax: number, ay: number): number {
    const b = run.board;
    const o = origin(b);
    let best = -1;
    let bestD = REACH;
    for (const c of b.cats) {
      if (c.out) continue;
      for (const [sx, sy] of squares(c)) {
        const x0 = o.x + sx * CELL;
        const y0 = o.y + sy * CELL;
        const d = Math.hypot(Math.max(x0 - ax, 0, ax - (x0 + CELL)), Math.max(y0 - ay, 0, ay - (y0 + CELL)));
        if (d < bestD) {
          bestD = d;
          best = c.id;
        }
      }
    }
    return best;
  }

  window.addEventListener("pointerdown", (e) => {
    sfx.unlock();
    if (!playing() || qaPilot || pressed) return;
    const a = scr.toArt(e.clientX, e.clientY);
    const id = catAt(a.x, a.y);
    lastInput = time;
    if (id < 0) {
      run.miss();
      return;
    }
    pressed = { id, x: e.clientX, y: e.clientY };
    sfx.play("perk");
  });
  window.addEventListener("pointermove", (e) => {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > TAP_SLOP) pressed = null;
  });
  window.addEventListener("pointerup", () => {
    const p = pressed;
    pressed = null;
    if (p && playing()) tapCat(p.id);
  });
  window.addEventListener("pointercancel", () => (pressed = null));
  session.on("cancel", () => (pressed = null));
  session.on("pause", () => (pressed = null));
  session.startOnTap(window);

  session.on("start", () => {
    sfx.unlock();
    mode = "play";
    over = null;
    passedBest = false;
    scoreShown = 0;
    candleShown = TUNE.clock;
    lastInput = time;
    newRun((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    sfx.play("start");
    setMusic("lullaby");
  });

  // ---- frame -----------------------------------------------------------------------------------
  function endRun() {
    if (over) return;
    const best = session.best;
    const isBest = run.score > 0 && (best === null || run.score > best);
    const prev = best ?? 0;
    over = { t: 0, isBest, ended: false, prev, lines: overLines(run.score, best, run.stats), frac: clamp(run.score / Math.max(run.score, prev, 1)) };
    pressed = null;
    setMusic("off");
    sfx.play("snuff");
    schedule(0.35, () => sfx.play("yawn"));
    const h = hud(SW, top);
    fx.emit(h.candleX + 2, h.candleY - 2, { count: reduced ? 3 : 9, speed: [6, 16], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.6, 1.3], ramp: RAMP.steam, shape: "steam", gravity: -8, drag: 0.6 });
    say([{ text: LINES.out, color: PAL.cream }], PAL.mauve, 1.6);
    if (isBest) {
      schedule(0.5, () => {
        sfx.play("best");
        flash.trigger(PAL.butter, 1);
        burst(SW / 2, top + 40, 30, RAMP.gold, [30, 90], "spark", 30);
        say([{ text: LINES.best, big: true }], PAL.butter, 1.8);
      });
    }
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = rawDt;
    time += dt;
    nudge.update(dt);
    flash.update(dt);
    fx.update(dt);
    scoreShown += (run.score - scoreShown) * (1 - Math.exp(-14 * dt));
    if (Math.abs(run.score - scoreShown) < 0.5) scoreShown = run.score;

    if (mode === "attract") {
      run.clock = TUNE.max;
      const id = demo.update(run, dt);
      if (id >= 0) tapCat(id);
      const before = run.level;
      run.step(dt);
      if (run.level !== before) {
        demoRugs++;
        if (demoRugs >= DEMO_RUGS) {
          demoRugs = 0;
          demoSeed = (demoSeed + 0x9e37) >>> 0;
          newRun(demoSeed);
        }
      }
    } else if (!over) {
      if (qaPilot) {
        const id = qaPilot.update(run, dt);
        if (id >= 0) tapCat(id);
      }
      run.step(dt);
      if (run.over) endRun();
      const best = session.best;
      if (!passedBest && !run.over && best !== null && best > 0 && run.score > best) {
        passedBest = true;
        say([{ text: LINES.past, color: PAL.butter }], PAL.butter, 1.6);
        sfx.play("best", 0, 0.8);
        session.feedback("success");
        burst(SW / 2, top + 8, 16, RAMP.gold, [25, 70], "spark");
      }
      // The candle is low: a tick a second and a quicker tune.
      if (!run.over && run.phase !== "cheer") {
        if (run.clock < 6) {
          setMusic("hurry");
          if (time - lastTick > 1) {
            lastTick = time;
            sfx.play("tick", Math.round(6 - run.clock));
            if (run.clock < 5.5 && run.clock > 4.4) say([{ text: LINES.hurry, color: PAL.candle }], PAL.candle, 1.1);
          }
        } else if (run.clock > 9) setMusic("lullaby");
      }
    }
    candleShown += (run.clock - candleShown) * (1 - Math.exp(-10 * dt));

    // Napping cats breathe out a z now and then.
    if (!reduced && !over && time - lastZ > 0.9) {
      lastZ = time;
      const asleep = run.board.cats.filter((c) => !c.out && (plopAt.get(c.id) ?? 0) + 0.6 < time && (grump.get(c.id) ?? 0) < time);
      if (asleep.length) {
        const c = fxRng.pick(asleep);
        const o = origin(run.board);
        pop("z", o.x + c.x * CELL + CELL / 2 + 3, o.y + c.y * CELL + 1, PAL.cream, 1.1, true);
      }
    }

    const due = later.filter((l) => l.at <= time);
    if (due.length) {
      for (const l of due) later.splice(later.indexOf(l), 1);
      for (const l of due) l.fn();
    }
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < p.life);
    if (banner) {
      banner.t += dt;
      if (banner.t >= banner.life) banner = null;
    }
    leaving = leaving.filter((l) => time - l.t0 < 1.3);
    for (const [id, b] of bumps) if (time - b.t0 > 0.4) bumps.delete(id);

    if (over) {
      over.t += dt;
      if (!over.ended && over.t > 0.6) {
        over.ended = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { rugs: s.rugs, cats: s.cats, bumps: s.bumps, streak: s.bestStreak, seconds: Math.round(s.seconds) } });
      }
    }
  }

  // ---- drawing ---------------------------------------------------------------------------------
  function plate(x: number, y: number, w: number, h: number, rim: string) {
    fill(ctx, x - 1, y - 1, w + 2, h + 2, PAL.ink);
    fill(ctx, x, y, w, h, PAL.night);
    fill(ctx, x, y, w, 1, rim);
    fill(ctx, x, y + h - 1, w, 1, PAL.dusk);
  }

  /** A plate wide enough for `innerW`, centred on the screen, or in what the feed leaves free outside a run. */
  function panel(innerW: number, pad: number): { x: number; w: number; cx: number } {
    const w = innerW + pad * 2 + ((innerW + pad * 2) % 2);
    let lo = PANEL_MARGIN;
    let hi = SW - PANEL_MARGIN;
    let mid = SW / 2;
    if (mode !== "play" || over) {
      const safe = scr.safe(session.preview());
      lo = Math.max(lo, safe.x0 + PANEL_MARGIN);
      hi = Math.min(hi, safe.x1 - PANEL_MARGIN);
      mid = (safe.x0 + safe.x1) / 2;
    }
    const x = Math.max(lo, Math.min(hi - w, Math.round(mid - w / 2)));
    return { x, w, cx: x + w / 2 };
  }

  function poseOf(c: Cat): Pose {
    if ((grump.get(c.id) ?? 0) > time) return "grump";
    if (over) return "nap";
    if (pressed?.id === c.id) return "awake";
    if (time < (plopAt.get(c.id) ?? 0) + 0.3) return "awake";
    if (hintCat === c.id && Math.floor(time * 2) % 2 === 0) return "awake";
    return "nap";
  }

  let hintCat = -1;

  /** The hearth under the HUD (a run only: the attract sign hangs there), its embers and the light they throw. */
  function drawHearth() {
    if (mode !== "play") return;
    const x = Math.round((SW - HEARTH_W) / 2);
    const y = top + 27;
    if (glow && !over) ctx.drawImage(glow, Math.round((SW - glow.width) / 2), y + spr.hearth.height - 1);
    ctx.drawImage(spr.hearth, x, y);
    if (!over) blit(ctx, spr.embers[reduced ? 0 : Math.floor(time * 1.6) % 2]!, x + 11, y + spr.hearth.height - 10);
  }

  function drawRug(b: Board, o: { x: number; y: number }) {
    const key = `${b.cols}x${b.rows}`;
    let rug = rugs.get(key);
    if (!rug) rugs.set(key, (rug = paintRug(b.cols, b.rows)));
    // A soft shadow under the rug, then the rug.
    fill(ctx, o.x + rug.ox + 2, o.y + rug.oy + 5, rug.img.width, rug.img.height - 4, PAL.ink);
    ctx.drawImage(rug.img, o.x + rug.ox, o.y + rug.oy);
    for (const i of b.baskets) blit(ctx, spr.basket, o.x + (i % b.cols) * CELL + CELL / 2, o.y + Math.floor(i / b.cols) * CELL + CELL / 2, true);
  }

  function drawCats(b: Board, o: { x: number; y: number }) {
    for (const c of b.cats) {
      if (c.out) continue;
      const at = plopAt.get(c.id) ?? 0;
      if (time < at) continue;
      const m = centre(c);
      let dx = 0;
      let dy = 0;
      // Set down with a little drop.
      const k = (time - at) / 0.12;
      if (k < 1 && !reduced) dy -= Math.round(3 * (1 - k));
      const bump = bumps.get(c.id);
      if (bump) {
        // Nose forward into whatever is ahead, then back.
        const t = time - bump.t0;
        const reach = bump.free * CELL + 3;
        const d = t < 0.1 ? reach * easeOutCubic(t / 0.1) : reach * (1 - easeOutBack(clamp((t - 0.1) / 0.26), 1.4));
        dx += Math.round(DX[c.dir] * d);
        dy += Math.round(DY[c.dir] * d);
      } else if ((grump.get(c.id) ?? 0) - 0.65 > time && !reduced) {
        dx += Math.floor(time * 30) % 2 ? 1 : -1;
      }
      blit(ctx, catSprite(c.len, c.coat, c.dir, poseOf(c)), o.x + m.x + dx, o.y + m.y + dy, true);
    }
  }

  function drawLeaving() {
    for (const l of leaving) {
      const t = time - l.t0;
      const d = (5 * t + 22 * t * t) * CELL;
      const m = centre(l.cat);
      const x = l.ox + m.x + DX[l.cat.dir] * d;
      const y = l.oy + m.y + DY[l.cat.dir] * d;
      if (x < -60 || y < -60 || x > SW + 60 || y > SH + 60) continue;
      blit(ctx, catSprite(l.cat.len, l.cat.coat, l.cat.dir, Math.floor(t / 0.07) % 2 ? "scootA" : "scootB"), x, y, true);
    }
  }

  function drawPopups() {
    for (const p of popups) {
      const k = p.t / p.life;
      if (k > 0.8 && Math.floor(p.t * 30) % 2) continue;
      const x = clamp(Math.round(p.x), 2 + textWidth(p.text) / 2, SW - 2 - textWidth(p.text) / 2);
      drawText(ctx, p.text, x, Math.round(p.y - k * 9), p.color, p.plain ? { align: "center", shadow: PAL.ink } : { align: "center", outline: PAL.ink });
    }
  }

  function drawBanner() {
    const b = banner;
    if (!b) return;
    const k = reduced ? 1 : easeOutBack(clamp(b.t / 0.22));
    const out = clamp((b.life - b.t) / 0.18);
    const imgs = b.lines.map((l) => (l.big ? chunky(l.text) : null));
    const widths = b.lines.map((l, i) => (imgs[i] ? imgs[i]!.width : textWidth(l.text)));
    const heights = b.lines.map((_, i) => (imgs[i] ? imgs[i]!.height + 1 : 10));
    const box = panel(Math.min(BANNER_TEXT, Math.max(...widths)), 5);
    const h = heights.reduce((s, v) => s + v, 0) + 5;
    const base = mode === "attract" || over ? scr.safe(session.preview()).y0 + 30 : hud(SW, top).laneY + 16;
    const y = Math.round(base + (1 - k) * 8 - (1 - out) * 6);
    plate(box.x, y, box.w, h, b.rim);
    let yy = y + 3;
    b.lines.forEach((l, i) => {
      if (imgs[i]) ctx.drawImage(imgs[i]!, Math.round(box.cx - imgs[i]!.width / 2), yy);
      else drawText(ctx, l.text, box.cx, yy, l.color ?? PAL.cream, { align: "center" });
      yy += heights[i]!;
    });
  }

  function drawHud() {
    // The wall above the floor: ink, with the skirting board's line.
    const band = top + 25;
    fill(ctx, 0, 0, SW, band, PAL.ink);
    fill(ctx, 0, band, SW, 1, PAL.dusk);
    fill(ctx, 0, band + 1, SW, 1, PAL.ink);
    if (mode !== "play") return;
    const h = hud(SW, top);
    drawText(ctx, fmt(scoreShown), h.scoreX, h.rowY, PAL.butter);
    if (run.purr > 1) drawText(ctx, `x${run.purr}`, h.scoreX + textWidth(fmt(scoreShown)) + 4, h.rowY, PAL.rose);
    drawText(ctx, `rug ${run.level + 1}`, h.rugX, h.rowY, PAL.mist, { align: "right" });
    // The candle lies along the sill: wax as long as the time left, the flame at its end.
    const low = run.clock < 6 && !over;
    const w = Math.max(0, Math.round(h.candleW * clamp(candleShown / TUNE.max)));
    fill(ctx, h.candleX - 1, h.candleY - 1, h.candleW + 2, 5, PAL.night);
    fill(ctx, h.candleX, h.candleY, w, 3, low ? PAL.blush : PAL.cream);
    fill(ctx, h.candleX, h.candleY + 2, w, 1, low ? PAL.ember : PAL.blush);
    if (!over) {
      const gutter = low && light.pulse(time, 2, { still: 1 }) > 0.5;
      const frame = gutter ? 2 : Math.floor(time * 6) % 2;
      blit(ctx, spr.flame[reduced ? 0 : frame]!, h.candleX + w - 1, h.candleY - 5);
    }
  }

  function drawSign() {
    if (mode !== "attract") return;
    const safe = scr.safe(session.preview());
    // The title lies on a little rug of its own.
    const { x, w } = panel(titleImg.width, 5);
    const h = titleImg.height + 6;
    const y = safe.y0 + 3;
    fill(ctx, x - 1, y - 1, w + 2, h + 2, PAL.ink);
    fill(ctx, x, y, w, h, PAL.plum);
    fill(ctx, x + 1, y + 1, w - 2, 1, PAL.rose);
    fill(ctx, x + 1, y + h - 2, w - 2, 1, PAL.rose);
    for (let j = 0; j < h; j += 2) {
      fill(ctx, x - 3, y + j, 2, 1, PAL.cream);
      fill(ctx, x + w + 1, y + j, 2, 1, PAL.cream);
    }
    blit(ctx, titleImg, x + 5, y + 3);
    blit(ctx, spr.sparkle[Math.floor(time * 1.5) % 2]!, x + w - 1, y, true);
    const prompt = "~ tap to play ~";
    const sub = session.best !== null && session.best > 0 ? `best ${fmt(session.best)}` : "clear the rug";
    const py = safe.y1 - 24;
    const soft = !reduced && time % 1.4 > 0.95;
    const box = panel(Math.max(textWidth(prompt), Math.min(PANEL_TEXT, textWidth(sub))), 4);
    plate(box.x, py - 2, box.w, 22, PAL.plum);
    drawText(ctx, prompt, box.cx, py, soft ? PAL.blush : PAL.cream, { align: "center" });
    drawText(ctx, sub, box.cx, py + 10, PAL.mist, { align: "center" });
  }

  function overStripY(): number {
    return session.standalone ? SH - 58 : scr.safe(session.preview()).y1 - 40;
  }

  function drawOver() {
    if (!over || over.t < 0.5) return;
    const { x, w, cx } = panel(PANEL_TEXT, 2);
    const y = overStripY();
    plate(x, y, w, 38, over.isBest ? PAL.butter : PAL.plum);
    const [l1, l2, l3] = over.lines;
    drawText(ctx, l1, cx, y + 2, over.isBest ? PAL.butter : PAL.cream, { align: "center" });
    const bw = PANEL_TEXT - 6;
    const bx = Math.round(cx - bw / 2);
    fill(ctx, bx - 1, y + 12, bw + 2, 4, PAL.ink);
    fill(ctx, bx, y + 13, Math.round(bw * clamp((over.t - 0.5) / 0.5) * over.frac), 2, over.isBest ? PAL.butter : PAL.rose);
    if (!over.isBest && over.prev > 0) fill(ctx, bx + bw - 1, y + 11, 1, 6, PAL.cream);
    drawText(ctx, l2, cx, y + 17, PAL.mist, { align: "center" });
    drawText(ctx, l3, cx, y + 27, PAL.blush, { align: "center" });
    if (session.standalone) {
      drawText(ctx, `${fmt(run.score)} points`, cx, y - 12, PAL.butter, { align: "center", outline: PAL.ink });
      if (session.phaseTime > 0.8) drawText(ctx, "~ tap to play again ~", cx, y + 44, PAL.cream, { align: "center", outline: PAL.ink });
    }
  }

  /** First-run plates and the idle nudge: a paw taps a cat whose way is clear. */
  function drawHint() {
    hintCat = -1;
    if (mode !== "play" || over || qaPilot || run.phase === "cheer") return;
    const teaching = taught < 2;
    if (!teaching && time - lastInput < 4) return;
    const b = run.board;
    const occ = occupancy(b);
    // The cat nearest the middle of the rug's edge that can go.
    const free = b.cats.filter((c) => !c.out && (plopAt.get(c.id) ?? 0) + 0.3 < time && wayOf(b, c, occ).by === EMPTY);
    if (free.length === 0) return;
    const c = free.find((f) => f.coat !== 0) ?? free[0]!;
    hintCat = c.id;
    const o = origin(b);
    const m = centre(c);
    const down = Math.floor(time * 2) % 2 === 0;
    if (!reduced || down) blit(ctx, spr.paw, o.x + m.x + 2 + (down ? 0 : 1), o.y + m.y + 3 + (down ? 1 : 0), true);
    if (!teaching) return;
    const lines = TEACH[taught === 0 ? 0 : 1];
    const box = panel(Math.max(...lines.map((l) => textWidth(l))), 4);
    const y = Math.min(SH - lines.length * 10 - 6, o.y + b.rows * CELL + 12);
    plate(box.x, y - 2, box.w, lines.length * 10 + 2, PAL.plum);
    lines.forEach((l, i) => drawText(ctx, l, box.cx, y + i * 10, PAL.cream, { align: "center" }));
  }

  function render() {
    const n = nudge.offset(time);
    const b = run.board;
    const o = origin(b);
    ctx.save();
    ctx.translate(n.x, n.y);
    if (floor) ctx.drawImage(floor, 0, 0);
    drawHearth();
    drawRug(b, o);
    drawCats(b, o);
    drawLeaving();
    fx.draw(ctx);
    ctx.restore();
    if (over) {
      // The room goes dark with the candle.
      ctx.globalAlpha = 0.5 * clamp(over.t / 0.6);
      fill(ctx, 0, 0, SW, SH, PAL.ink);
      ctx.globalAlpha = 1;
    }
    drawHud();
    drawPopups();
    drawHint();
    drawBanner();
    drawSign();
    drawOver();
    flash.draw(ctx, SW, SH);
    scr.present();
  }

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
