/**
 * Scribbledelve: I mapped a dungeon on the squared paper of my maths book. My stick knight runs it, a coin in every
 * square; the scribbles crawl out of their holes after him. Swipe to steer. A sword turns the tables.
 */
import { createAudio } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, easeOutBack, easeOutCubic, lerp, Spring } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { bakeBits, bakeMaze, CELL, drawBraveRing, drawKnight, drawScribble, INKS, PEN, renderPage, type Bits } from "./art.ts";
import { AGAIN, bestLine, CARD, floorLine, hintFor, LINES, NOTES, statLine, SUBTITLE, TAP, TITLE } from "./copy.ts";
import { Fx } from "./fx.ts";
import { begin, blit, bold, boil, doodleArrow, ellipsePts, fillBuf, hand, highlight, ink, PAL, pt, shash, updateBoil, write, type Sprite } from "./ink.ts";
import { beside, COLS, DX, DY, N, ROWS, xOf, yOf } from "./maze.ts";
import { DEMO, Pilot, SKILLS } from "./pilot.ts";
import { QA_PILOT_SEED, runSeed } from "./runs.ts";
import { CLEAR_TIME, COIN_HERE, DRAW_TIME, HEARTS, HZ, posX, posY, Sim, STREAK_TIERS, SWORD_HERE, type SimEvent } from "./sim.ts";
import { coinNote, S } from "./sound.ts";
import { readSwipe, startThumb, type Thumb } from "./swipe.ts";
import { fmt, loadType } from "./type.ts";

const ACCENT = "#E0A21B";
const BAND = "#C98A10";
const INK = PAL.ink;
const RED = PAL.red;
/** Seconds between the last heart and gameplay.end (the knight's last squeak), well inside the 1 s rule. */
const END_AFTER = 0.8;
const SCRAP_CORNER = 6;
const SCRAP_WOBBLE = 2;
const SCRAP_PAD = SCRAP_CORNER + SCRAP_WOBBLE + 8;
const BOILS = 3;
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=expert vite build`); a normal build can't. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

interface Float {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  size: number;
  seed: number;
}
interface Banner {
  text: string;
  sub: string;
  t: number;
  life: number;
  color: string;
  seed: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "scribbledelve", restartDelayMs: 900 }), loadType()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
  } catch {
    /* guests and offline: show the hint */
  }

  const view = createCanvas({ maxDpr: 2, background: PAL.paper });
  const ctx = view.ctx;
  let W = view.width;
  let H = view.height;
  let dpr = view.dpr;
  /** Px a maze square, the maze's left edge, and its top edge in play and in attract. */
  let cs = 48;
  let fx = 0;
  let fyP = 0;
  let fyA = 0;
  let fy = 0;
  let modeK = 0;
  let page: HTMLCanvasElement | null = null;
  let bits: Bits | null = null;
  let mazeArt: Sprite[] = [];
  let mazeKey = "";

  const audio = createAudio();
  const shake = new Shake(7, 0.012, 2.4, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.14, decay: 0.4 });
  const fxs = new Fx(260);
  const scorePop = new Spring(1, 420, 14);
  const titlePop = new Spring(0, 150, 12);
  const multPop = new Spring(1, 380, 13);
  const heartPop = new Spring(1, 380, 12);

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = (session.ctx.seed >>> 0) ^ 0x5d1e;
  let sim = new Sim({ seed: demoSeed });
  let pilot: Pilot | null = new Pilot(DEMO, createRng(demoSeed ^ 99));
  let qaPilot: Pilot | null = null;
  let qaAcc = 0;
  let time = 0;
  let shown = 0;
  let overT = -1;
  let endSent = false;
  let bestCheered = false;
  let bestAtStart: number | null = null;
  let endInfo: { score: number; isBest: boolean; prevBest: number | null; hint: string } | null = null;
  let floats: Float[] = [];
  let banner: Banner | null = null;
  let thumb: Thumb | null = null;
  let reveal = 0;
  let runPhase = 0;
  let flip = 1;
  let lastX = 0;
  let lastY = 0;
  let slipX = 0;
  let slipY = 0;
  let bumpT = 9;
  let bumpDir = 0;
  let stepAt = 0;
  let swipes = 0;
  let lastHeartWarned = false;

  // -------------------------------------------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------------------------------------------
  function layout() {
    W = view.width;
    H = view.height;
    dpr = view.dpr;
    const top = session.play().top;
    cs = Math.max(30, Math.min(64, Math.floor(Math.min((W - 20) / COLS, (H - top - 100 - 54) / ROWS))));
    fx = Math.round((W - COLS * cs) / 2);
    fyP = Math.round(top + 100);
    const pitch = cs / 3;
    const under = session.preview().top + 176;
    fyA = fyP + Math.max(0, Math.ceil((under - fyP) / pitch)) * pitch;
    if (fyA + ROWS * cs > H - 4) fyA = fyP + Math.max(0, Math.floor((H - 4 - ROWS * cs - fyP) / pitch)) * pitch;
    page = renderPage(W, H, dpr, fx, fyP, pitch, session.ctx.seed % 4);
    bits = bakeBits(Math.min(3, dpr * (cs / CELL) * 1.1));
    mazeKey = "";
    fy = lerp(fyA, fyP, modeK);
  }
  layout();
  view.onResize(layout);
  session.on("insets", layout);

  function bakeMazes() {
    const key = `${sim.floor}|${demoSeed}|${mode}|${session.runs}|${cs}|${dpr}`;
    if (key === mazeKey) return;
    mazeKey = key;
    mazeArt = Array.from({ length: BOILS }, (_, i) => bakeMaze(sim.maze, cs, dpr, i, 40 + sim.floor * 7));
  }

  /** Square coordinates → px inside the maze. */
  const px = (x: number) => (x + 0.5) * cs;
  const u = () => cs / CELL;

  // -------------------------------------------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------------------------------------------
  function resetFx() {
    fxs.clear();
    floats = [];
    banner = null;
    thumb = null;
    reveal = 0;
    slipX = slipY = 0;
    lastX = sim.heroX;
    lastY = sim.heroY;
    bumpT = 9;
    mazeKey = "";
  }

  function newAttract() {
    mode = "attract";
    demoSeed = (demoSeed * 1664525 + 1013904223) >>> 0;
    sim = new Sim({ seed: demoSeed });
    pilot = new Pilot(DEMO, createRng(demoSeed ^ 99));
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
    endInfo = null;
    swipes = 0;
    lastHeartWarned = false;
    audio.play(S.rub, { volume: 0.7 });
    if (!hintSeen && !qaPilot) say(LINES.hint[0], LINES.hint[1], INK, 9);
  }

  session.startOnTap(window);
  session.on("start", startRun);

  // -------------------------------------------------------------------------------------------------------------
  // Input: swipe anywhere, and keep the thumb down to steer round the next corner too
  // -------------------------------------------------------------------------------------------------------------
  const playing = () => mode === "play" && session.phase === "playing" && !session.paused;

  function steer(d: number) {
    if (!playing() || qaPilot) return;
    sim.steer(d);
    swipes++;
    if (!hintSeen && swipes >= 3) {
      hintSeen = true;
      tc.storage.set("hint", true).catch(() => undefined);
      if (banner && banner.text === LINES.hint[0]) banner.life = Math.min(banner.life, banner.t + 0.3);
    }
  }

  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (thumb || !playing()) return;
    thumb = startThumb(e.pointerId, e.clientX, e.clientY);
  });
  window.addEventListener("pointermove", (e) => {
    if (!thumb || e.pointerId !== thumb.id) return;
    const d = readSwipe(thumb, e.clientX, e.clientY);
    if (d >= 0) steer(d);
  });
  const lift = (e: PointerEvent) => {
    if (thumb && e.pointerId === thumb.id) thumb = null;
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  session.on("cancel", () => (thumb = null));
  session.on("pause", () => (thumb = null));
  window.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 }[e.code];
    if (d !== undefined) {
      e.preventDefault();
      steer(d);
    }
  });

  // -------------------------------------------------------------------------------------------------------------
  // Juice
  // -------------------------------------------------------------------------------------------------------------
  const loud = () => mode === "play";
  const vol = () => (mode === "play" ? 1 : 0.3);

  function say(text: string, sub: string, color: string = INK, life = 1.5) {
    banner = { text, sub, t: 0, life, color, seed: 200 + Math.floor(Math.random() * 400) };
  }
  function float(text: string, x: number, y: number, color: string, size = 20, life = 0.9) {
    floats.push({ text, x, y, t: 0, life, color, size, seed: 300 + floats.length * 13 });
    if (floats.length > 14) floats.shift();
  }

  function cheerBest() {
    bestCheered = true;
    say(LINES.best[0], LINES.best[1], RED, 1.6);
    audio.play(S.best);
    flash.trigger(PAL.hiYellow, 0.6);
    session.feedback("success");
  }

  function handle(e: SimEvent) {
    switch (e.k) {
      case "coin": {
        const x = px(xOf(e.cell));
        const y = px(yOf(e.cell));
        fxs.bit("dot", x, y, { count: 2, speed: [30, 80], life: [0.18, 0.3], size: [1.6, 2.6], colors: [INKS.coin, "#FFE9A8"], drag: 4 });
        coinNote(audio, e.streak, e.mult, vol());
        scorePop.velocity += 1.4;
        if (e.mult >= 2 && e.streak % 6 === 0) float(`×${e.mult}`, x, y - 10, INKS.coin, 18, 0.6);
        break;
      }
      case "tier":
        multPop.velocity += 9;
        if (loud()) {
          float(`×${e.mult}!`, px(sim.heroX), px(sim.heroY) - 26, RED, 28, 1);
          audio.play(S.tier, { pitch: (e.mult - 2) * 3 });
          session.feedback("tap");
        }
        break;
      case "streakLost":
        if (loud() && e.mult >= 2) {
          float(NOTES.streakLost, px(sim.heroX), px(sim.heroY) - 24, PAL.graphite, 17, 0.8);
          audio.play(S.lost);
        }
        break;
      case "sword": {
        const x = px(xOf(e.cell));
        const y = px(yOf(e.cell));
        fxs.mark("burst", x, y, 20 * u(), INKS.coin, 0.5);
        fxs.bit("star", x, y, { count: 7, speed: [80, 190], life: [0.35, 0.6], size: [3, 5], colors: [PAL.hiYellow], drag: 3 });
        audio.play(S.sword, { volume: vol() });
        audio.play(S.shing, { volume: vol() });
        shake.add(0.2);
        hitStop.freeze(0.06);
        if (loud()) {
          say(LINES.sword[0], LINES.sword[1], RED, 1.3);
          session.feedback("tap");
        }
        break;
      }
      case "braveEnd":
        if (loud() && sim.phase === "play") {
          float(NOTES.swordOut, px(sim.heroX), px(sim.heroY) - 26, PAL.graphite, 17, 0.8);
          audio.play(S.braveEnd);
        }
        break;
      case "poof": {
        const x = px(e.x);
        const y = px(e.y);
        fxs.mark("puff", x, y, 18 * u(), PEN[e.kind], 0.45);
        fxs.mark("burst", x, y, 22 * u(), RED, 0.4);
        fxs.bit("streak", x, y, { count: 9, speed: [120, 260], life: [0.25, 0.45], size: [7, 12], colors: [PEN[e.kind]], drag: 3 });
        float(`+${fmt(e.pts)}`, x, y - 14, RED, 24 + e.n * 2, 1);
        if (e.n === 1) float(NOTES.poof, x, y + 22, PEN[e.kind], 18, 0.7);
        audio.play(S.poof, { volume: vol() });
        audio.play(S.pop, { volume: vol(), pitch: e.n * 3 });
        shake.add(0.3);
        hitStop.freeze(0.09);
        scorePop.velocity += 3;
        if (loud()) session.feedback("impact");
        break;
      }
      case "shave":
        float(`${NOTES.phew} +${e.pts}`, px(e.x), px(e.y) - 26, INKS.felt, 19, 0.9);
        if (loud()) audio.play(S.phew);
        break;
      case "caught": {
        const x = px(e.x);
        const y = px(e.y);
        fxs.mark("burst", x, y, 26 * u(), RED, 0.6);
        fxs.mark("smudge", x, y + 8 * u(), 22 * u(), PAL.graphite, 1.2);
        fxs.bit("streak", x, y, { count: 10, speed: [100, 240], life: [0.3, 0.5], size: [6, 11], colors: [INK], drag: 3 });
        float(NOTES.ouch, x, y - 30, RED, 26, 0.9);
        heartPop.velocity += 9;
        shake.add(0.6);
        hitStop.freeze(0.14);
        audio.play(S.eep, { volume: vol() });
        audio.play(S.crumple, { volume: vol() });
        if (loud()) {
          flash.trigger(RED, 0.5);
          session.feedback("impact");
        }
        break;
      }
      case "respawn":
        fxs.mark("ring", px(sim.heroX), px(sim.heroY), 20 * u(), INK, 0.5);
        if (loud() && sim.hearts === 1 && !lastHeartWarned) {
          lastHeartWarned = true;
          say(LINES.last[0], LINES.last[1], RED, 1.4);
        }
        break;
      case "crawl":
        fxs.mark("ring", px(xOf(e.cell)), px(yOf(e.cell)), 18 * u(), PEN[e.kind], 0.4);
        if (loud()) audio.play(S.scribble, { pitch: e.kind * 2 });
        break;
      case "star":
        fxs.mark("burst", px(xOf(e.cell)), px(yOf(e.cell)), 20 * u(), INKS.coin, 0.6);
        if (loud()) {
          audio.play(S.tier, { pitch: 7 });
          say(LINES.star[0], LINES.star[1], INK, 1.2);
        }
        break;
      case "starGot": {
        const x = px(xOf(e.cell));
        const y = px(yOf(e.cell));
        fxs.bit("star", x, y, { count: 12, speed: [90, 240], life: [0.4, 0.8], size: [3, 6], colors: [PAL.hiYellow], drag: 2.5 });
        float(`+${fmt(e.pts)}`, x, y - 16, RED, 26, 1.1);
        audio.play(S.star, { volume: vol() });
        scorePop.velocity += 3;
        if (loud()) session.feedback("success");
        break;
      }
      case "starGone":
        if (loud()) float(NOTES.starGone, px(xOf(e.cell)), px(yOf(e.cell)) - 10, PAL.graphite, 17, 0.8);
        fxs.mark("puff", px(xOf(e.cell)), px(yOf(e.cell)), 12 * u(), PAL.graphite, 0.4);
        break;
      case "turn":
        if (e.late) {
          // The knight hops back to the gap he just passed: carry the difference and let it slide out.
          slipX = lastX - sim.heroX;
          slipY = lastY - sim.heroY;
        }
        if (loud() && time - stepAt > 0.06) {
          stepAt = time;
          audio.play(S.step, { pitch: Math.random() * 4 });
        }
        break;
      case "bump":
        bumpT = 0;
        bumpDir = e.dir;
        if (loud()) {
          audio.play(S.bump);
          float(NOTES.bonk, px(sim.heroX) + DX[e.dir]! * cs * 0.5, px(sim.heroY) + DY[e.dir]! * cs * 0.5 - 6, PAL.graphite, 15, 0.5);
        }
        break;
      case "clear":
        if (loud()) {
          const l = e.heart ? LINES.heart : LINES.cleared;
          say(l[0], `+${fmt(e.bonus)}${l[1] ? `  ${l[1]}` : ""}`, RED, 1.4);
          flash.trigger(PAL.hiYellow, 0.5);
          session.feedback("success");
        }
        if (e.heart) heartPop.velocity += 8;
        for (const m of sim.monsters) fxs.mark("puff", px(posX(m)), px(posY(m)), 16 * u(), PEN[m.kind], 0.5);
        for (let i = 0; i < 16; i++) fxs.bit("star", px(Math.random() * COLS - 0.5), px(Math.random() * ROWS - 0.5), { count: 1, speed: [40, 120], life: [0.5, 1], size: [3, 6], colors: [PAL.hiYellow, INKS.coin], drag: 2 });
        audio.play(S.clear, { volume: vol() });
        if (e.heart) audio.play(S.heart, { volume: vol() });
        scorePop.velocity += 4;
        break;
      case "floor":
        reveal = 0;
        mazeKey = "";
        slipX = slipY = 0;
        audio.play(S.rub, { volume: vol() * 0.7 });
        break;
      case "over":
        overT = 0;
        if (loud()) {
          float(NOTES.over, px(e.x), px(e.y) - 34, INK, 28, 1.4);
          audio.play(S.out);
        }
        break;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    updateBoil(time, reduced);
    // QA runs skip hit-stop, so the run's clock is the wall clock and its screenshots can be planned.
    const dt = QA_AUTOPLAY ? rawDt : hitStop.scale(rawDt);
    const want = mode === "play" ? 1 : 0;
    modeK += clamp(want - modeK, -rawDt * (reduced ? 30 : 4.5), rawDt * (reduced ? 30 : 4.5));
    fy = lerp(fyA, fyP, easeOutCubic(modeK));
    shake.update(rawDt);
    flash.update(rawDt);
    fxs.update(rawDt);
    scorePop.update(rawDt);
    titlePop.update(rawDt);
    multPop.update(rawDt);
    heartPop.update(rawDt);
    reveal = Math.min(1, reveal + rawDt / 0.55);
    bumpT += rawDt;
    const k = Math.exp(-22 * rawDt);
    slipX *= k;
    slipY *= k;
    for (const f of floats) f.t += rawDt;
    if (floats.some((f) => f.t >= f.life)) floats = floats.filter((f) => f.t < f.life);
    if (banner && (banner.t += rawDt) >= banner.life) banner = null;

    if (dt > 0 && (mode === "attract" || session.phase === "playing")) {
      lastX = sim.heroX;
      lastY = sim.heroY;
      if (qaPilot && mode === "play") {
        // In lockstep, sixty looks a second: the same run scripts/shoot-plan.ts replays headless.
        qaAcc += dt;
        while (qaAcc >= 1 / 60 - 1e-9 && !sim.over) {
          qaAcc -= 1 / 60;
          qaPilot.step(sim, 1 / 60);
          sim.step(1 / 60);
        }
      } else {
        if (mode === "attract") pilot?.step(sim, dt);
        sim.step(dt);
      }
      // The legs swing with the distance run.
      const moved = Math.hypot(sim.heroX - lastX, sim.heroY - lastY);
      if (moved < 0.9) runPhase += moved * 5.2;
      const face = sim.hero.dir >= 0 ? sim.hero.dir : sim.hero.face;
      if (face === 1) flip = 1;
      else if (face === 3) flip = -1;
      for (const e of sim.events) handle(e);
      sim.events.length = 0;
      if (mode === "attract" && (sim.over || sim.floor > 2 || sim.t > 75)) newAttract();
    }
    bakeMazes();

    const target = sim.score;
    shown = shown < target ? Math.min(target, shown + Math.max(1, (target - shown) * 12 * rawDt)) : target;
    if (mode === "play" && !bestCheered && bestAtStart !== null && bestAtStart > 0 && shown > bestAtStart && session.phase === "playing") cheerBest();

    if (mode === "play" && overT >= 0 && !endSent) {
      overT += rawDt;
      if (overT >= END_AFTER) {
        endSent = true;
        const prevBest = session.best;
        const s = sim.stats;
        const res = session.end(sim.score, { stats: { floor: sim.floor, coins: s.coins, poofs: s.poofs, maxStreak: s.maxStreak, stars: s.stars, shaves: s.shaves } });
        endInfo = { score: sim.score, isBest: res.isBest, prevBest, hint: hintFor(s, sim.floor) };
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Drawing: the page and the dungeon
  // -------------------------------------------------------------------------------------------------------------
  function drawWorld() {
    view.begin();
    if (page) ctx.drawImage(page, 0, 0, W, H);
    const o = shake.offset;
    ctx.save();
    ctx.translate(fx + o.x, fy + o.y);
    // A cleared floor is rubbed out; a fresh one is drawn in from the top.
    const fade = sim.phase === "clear" ? 1 - clamp((sim.pt / HZ - (CLEAR_TIME - 0.6)) / 0.5) : 1;
    const shownH = ROWS * cs * easeOutCubic(reveal) + 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-10, -10, COLS * cs + 20, shownH + 4);
    ctx.clip();
    ctx.globalAlpha = fade;
    drawTrail(fade);
    drawThings(fade);
    const art = mazeArt[boil.step % BOILS];
    if (art) blit(ctx, art, (COLS * cs) / 2, (ROWS * cs) / 2, 1, 0, fade);
    ctx.restore();
    ctx.globalAlpha = 1;
    drawScribbles();
    drawHero();
    fxs.drawMarks(ctx, 1, boil.step);
    fxs.drawBits(ctx, 1);
    for (const f of floats) {
      const k = f.t / f.life;
      const a = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      const pop = f.t < 0.12 ? 0.6 + (f.t / 0.12) * 0.4 : 1;
      write(ctx, f.text, clamp(f.x, 30, COLS * cs - 30), Math.max(f.size * 0.9, f.y - easeOutCubic(k) * 22), bold(f.size * pop), f.color, f.seed, { align: "center", alpha: a });
    }
    ctx.restore();
  }

  /** The pencil line my knight leaves through every square he has run. */
  function drawTrail(fade: number) {
    ctx.strokeStyle = PAL.graphite;
    ctx.globalAlpha = 0.34 * fade;
    ctx.lineWidth = Math.max(1.4, cs * 0.045);
    ctx.lineCap = "round";
    ctx.beginPath();
    const j = (c: number, i: number) => shash(c, i, sim.floor) * cs * 0.05;
    for (let c = 0; c < N; c++) {
      for (const d of [1, 2]) {
        if (!sim.walked[c * 4 + d]) continue;
        const n = beside(c, d);
        ctx.moveTo(px(xOf(c)) + j(c, 0), px(yOf(c)) + j(c, 1));
        ctx.lineTo(px(xOf(n)) + j(n, 0), px(yOf(n)) + j(n, 1));
      }
    }
    const h = sim.hero;
    if (h.dir >= 0 && sim.phase !== "clear") {
      ctx.moveTo(px(xOf(h.cell)) + j(h.cell, 0), px(yOf(h.cell)) + j(h.cell, 1));
      ctx.lineTo(px(sim.heroX), px(sim.heroY));
    }
    ctx.stroke();
    ctx.globalAlpha = fade;
  }

  function drawThings(fade: number) {
    const b = bits!;
    const k = u();
    for (let c = 0; c < N; c++) {
      const what = sim.things[c];
      if (what === COIN_HERE) blit(ctx, b.coin, px(xOf(c)), px(yOf(c)), k, 0, fade);
      else if (what === SWORD_HERE) {
        const x = px(xOf(c));
        const y = px(yOf(c));
        const breathe = light.pulse(time, 0.8, { still: 0.6 });
        highlight(ctx, x - 13 * k, y - 13 * k, 26 * k, 26 * k, 40 + c, PAL.hiYellow, (0.35 + 0.3 * breathe) * fade);
        blit(ctx, b.sword, x, y - 1 * k, k * 0.92, reduced ? 0.25 : 0.25 + Math.sin(time * 2.2 + c) * 0.12, fade);
      }
    }
    if (sim.star >= 0) {
      const left = sim.starTicks / HZ;
      const a = left < 2 ? 0.45 + 0.5 * light.pulse(time, 2) : 1;
      const pop = 1 + 0.08 * Math.sin(time * 5);
      blit(ctx, b.star, px(xOf(sim.star)), px(yOf(sim.star)), k * pop, reduced ? 0 : Math.sin(time * 1.6) * 0.2, a * fade);
    }
  }

  function drawScribbles() {
    const k = u();
    const hx = sim.heroX;
    const hy = sim.heroY;
    for (const m of sim.monsters) {
      if (m.state === "gone") continue;
      let drawn = 1;
      if (m.state === "drawing") {
        drawn = clamp(1 - (m.timer / HZ) / DRAW_TIME);
        if (drawn <= 0) continue;
      }
      const mx = posX(m);
      const my = posY(m);
      const dl = Math.hypot(hx - mx, hy - my) || 1;
      const ending = m.state === "scared" && sim.hero.brave < 1.2 * HZ;
      ctx.save();
      ctx.translate(px(mx), px(my) + (m.state === "hunt" ? Math.sin(time * 9 + m.id) * 1.2 * k : 0));
      ctx.scale(k * 1.18, k * 1.18);
      drawScribble(ctx, m.kind, {
        lx: ((hx - mx) / dl) * (m.state === "scared" ? -1 : 1),
        ly: ((hy - my) / dl) * (m.state === "scared" ? -1 : 1),
        // The sword is running out: they flicker back to their own pens.
        scared: m.state === "scared" && !(ending && light.pulse(time, 2) > 0.5),
        drawn,
        t: time + m.id,
        seed: 600 + m.id * 17,
      });
      ctx.restore();
    }
  }

  function drawHero() {
    const h = sim.hero;
    const k = u();
    let x = px(sim.heroX + slipX);
    let y = px(sim.heroY + slipY);
    if (bumpT < 0.18) {
      // A bonk against a pen line: lean into it and bounce back.
      const b = Math.sin((bumpT / 0.18) * Math.PI) * cs * 0.12;
      x += DX[bumpDir]! * b;
      y += DY[bumpDir]! * b;
    }
    if (sim.phase === "over" && overT > 0.6) return;
    ctx.save();
    ctx.translate(x, y + 2 * k);
    ctx.scale(k * 1.22, k * 1.22);
    if (h.brave > 0 && sim.phase === "play") drawBraveRing(ctx, sim.braveFrac);
    if (h.inv > 0 && sim.phase === "play") ctx.globalAlpha = 0.4 + 0.55 * light.pulse(time, 2, { still: 0.7 });
    const squash = sim.phase === "ouch" || sim.phase === "over" ? clamp(sim.pt / HZ / 0.25) : 0;
    drawKnight(ctx, { flip, run: h.dir >= 0 && sim.phase === "play" ? runPhase : null, brave: h.brave > 0, squash, seed: 500 });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD (CSS px)
  // -------------------------------------------------------------------------------------------------------------
  const stripTop = () => session.play().top + 8;

  function scrap(x: number, y: number, w: number, h: number, seed: number, tape = true, alphaV = 0.96) {
    ctx.globalAlpha = alphaV;
    const j = (i: number) => ((((seed * 13 + i * 7) % 5) - 2) * SCRAP_WOBBLE) / 2;
    const c = Math.min(SCRAP_CORNER * 2, w / 4, h / 4);
    const pts = [
      x + w * 0.5, y - 0.5,
      x + w - c, y + j(1) * 0.5,
      x + w, y,
      x + w + j(2) * 0.5, y + c,
      x + w + j(3) * 0.5, y + h * 0.5,
      x + w + j(4) * 0.5, y + h - c,
      x + w, y + h,
      x + w - c, y + h + j(5) * 0.5,
      x + w * 0.5, y + h + 0.5,
      x + c, y + h + j(6) * 0.5,
      x, y + h,
      x + j(7) * 0.5, y + h - c,
      x - 0.5, y + h * 0.5,
      x + j(8) * 0.5, y + c,
      x, y,
      x + c, y + j(9) * 0.5,
    ];
    begin();
    for (let i = 0; i < pts.length; i += 2) pt(pts[i]!, pts[i + 1]!);
    ctx.fillStyle = "rgba(40,30,20,0.12)";
    ctx.fillRect(x + 3, y + 4, w, h);
    fillBuf(ctx, "#FFFDF7", alphaV);
    ctx.globalAlpha = alphaV;
    ink(ctx, seed, { width: 1.3, jitter: 0.5, color: "rgba(36,65,154,0.55)", passes: 1, closed: true, alpha: alphaV });
    if (tape) {
      ctx.save();
      ctx.globalAlpha = 0.55 * alphaV;
      ctx.fillStyle = "#EFE6C8";
      ctx.translate(x + w / 2, y);
      ctx.rotate(((seed % 7) - 3) * 0.02);
      ctx.fillRect(-22, -7, 44, 14);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function textW(text: string, font: string) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  function fitSize(text: string, font: (px: number) => string, size: number, maxW: number, min = 12): number {
    while (size > min && textW(text, font(size)) > maxW) size--;
    return size;
  }
  function wrapLines(text: string, maxW: number, font: string): string[] {
    const out: string[] = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (textW(next, font) > maxW && cur) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  }

  function drawHud() {
    const inRun = mode === "play" && session.phase === "playing";
    const top = stripTop();
    const stripH = 54;
    if (mode === "play" && (inRun || !endInfo)) drawStrip(top, stripH);
    if (mode === "attract") drawAttract();
    if (inRun) drawHintThumb();
    drawBanner(mode === "attract" ? H * 0.52 : top + stripH + 44);
    if (mode === "play" && session.phase === "over" && endInfo) drawSummary();
    flash.draw(ctx, W, H);
  }

  function drawStrip(top: number, h: number) {
    scrap(10, top, W - 20, h, 31, false, 0.94);
    const cy = top + h / 2;
    // The floor, circled in red pen.
    const fl = floorLine(sim.floor);
    write(ctx, fl, 24, cy + 8, bold(24), INK, 81);
    const fw = textW(fl, bold(24));
    ellipsePts(24 + fw / 2, cy + 1, fw / 2 + 9, 17, 82, 0.15, 14);
    ink(ctx, 82, { width: 1.8, jitter: 0.7, color: RED, passes: 1 });
    // The score.
    ctx.save();
    ctx.translate(W / 2 + 4, cy + 13);
    ctx.scale(scorePop.value, scorePop.value);
    write(ctx, fmt(shown), 0, 0, bold(fitSize(fmt(shown), bold, 38, W * 0.3, 24)), INK, 83, { align: "center" });
    ctx.restore();
    // Hearts.
    const b = bits!;
    for (let i = 0; i < HEARTS; i++) {
      const full = i < sim.hearts;
      const last = sim.hearts === 1 && i === 0;
      const k = (full && i === sim.hearts - 1 ? heartPop.value : 1) * (last ? 1 + 0.1 * light.pulse(time, 1.4, { still: 0.5 }) : 1);
      blit(ctx, full ? b.heart : b.heartLost, W - 30 - (HEARTS - 1 - i) * 30, cy + 1, 1.05 * k);
    }
    // Under the strip: the coin streak (a pencil bar that runs down between coins) and the best.
    const y = top + h + 20;
    if (sim.streak >= 3 && sim.phase === "play") {
      const m = sim.mult;
      const next = STREAK_TIERS[m - 1];
      ctx.save();
      ctx.translate(26, y + 2);
      ctx.scale(multPop.value, multPop.value);
      write(ctx, `×${m}`, 0, 6, bold(m >= 2 ? 30 : 24), m >= 2 ? RED : INK, 84, { align: "center" });
      ctx.restore();
      const label = next ? `${sim.streak}/${next} ${NOTES.streak}` : `${sim.streak} ${NOTES.streak}`;
      write(ctx, label, 48, y + 2, hand(17), PAL.inkDeep, 85);
      const bw = 96;
      ctx.fillStyle = "rgba(36,65,154,0.12)";
      ctx.fillRect(48, y + 8, bw, 5);
      highlight(ctx, 48, y + 6, Math.max(3, bw * sim.streakFrac), 9, 86, m >= 2 ? "#FFB4AE" : ACCENT, 0.8);
    }
    if (bestAtStart !== null && bestAtStart > 0) write(ctx, bestCheered ? "new best!" : `best ${fmt(bestAtStart)}`, W - 20, y + 4, bold(18), bestCheered ? RED : PAL.graphite, 87, { align: "right" });
  }

  function drawBanner(y0: number) {
    const b = banner;
    if (!b) return;
    const kb = b.t / b.life;
    const pop = b.t < 0.18 ? easeOutBack(b.t / 0.18) : 1;
    const a = kb > 0.8 ? 1 - (kb - 0.8) / 0.2 : 1;
    const maxText = W - 60;
    const ts = fitSize(b.text, bold, mode === "attract" ? 28 : 32, maxText, 20);
    const subLines = b.sub ? wrapLines(b.sub, maxText, hand(18)) : [];
    const tw = textW(b.text, bold(ts));
    let sw = 0;
    for (const l of subLines) sw = Math.max(sw, textW(l, hand(18)));
    const w = Math.max(tw, sw) + 36;
    const h = ts * 1.05 + (subLines.length ? 8 + subLines.length * 21 : 10);
    const x = W / 2 - w / 2;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, y0 + h / 2);
    ctx.scale(pop, pop);
    ctx.rotate(((b.seed % 5) - 2) * 0.008);
    ctx.translate(-W / 2, -(y0 + h / 2));
    scrap(x, y0, w, h, b.seed, true, 0.96 * a);
    highlight(ctx, W / 2 - tw / 2 - 6, y0 + 8, tw + 12, ts * 0.72, b.seed, b.color === RED ? "#FFB4AE" : "#FFE08A", 0.5);
    ctx.globalAlpha = a;
    write(ctx, b.text, W / 2, y0 + ts * 0.86, bold(ts), b.color, b.seed, { align: "center" });
    subLines.forEach((l, i) => write(ctx, l, W / 2, y0 + ts * 0.86 + 22 + i * 21, hand(18), PAL.inkDeep, b.seed + 1 + i, { align: "center" }));
    ctx.restore();
  }

  /** First run: a ghost thumb swipes under the maze until the knight has been steered three times. */
  function drawHintThumb() {
    if (hintSeen || qaPilot || sim.phase !== "play") return;
    const cyc = 1.8;
    const t = time % cyc;
    const bx = W * 0.5;
    const by = Math.min(H - 44, fy + ROWS * cs + 50);
    const d = Math.floor(time / cyc) % 2 ? 1 : -1;
    const k = easeOutCubic(clamp((t - 0.2) / 0.6));
    if (t < 1.3) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#FFF6EC";
      ctx.beginPath();
      ctx.ellipse(bx + d * (k * 70 - 35), by, 16, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ellipsePts(bx + d * (k * 70 - 35), by, 16, 21, 57, 0.1, 14);
      ink(ctx, 57, { width: 1.6, jitter: 0.6, color: "rgba(36,65,154,0.7)", passes: 1, alpha: 0.85 });
    }
    doodleArrow(ctx, bx - d * 42, by - 30, bx + d * 46, by - 30, -5 * d, 55, { width: 2, color: "rgba(36,65,154,0.55)", head: 10, passes: 1 });
  }

  function drawAttract() {
    const r = session.preview();
    const left = r.left + 14;
    const right = W - r.right - 10;
    const cx = (left + right) / 2;
    const top = r.top + 8;
    const kk = easeOutBack(clamp(titlePop.value));
    const bw = Math.min(310, right - left);
    const hasBest = session.best !== null && session.best > 0;
    scrap(cx - bw / 2, top, bw, 158, 17, true, 0.96);
    ctx.save();
    ctx.translate(cx, top + 50);
    ctx.scale(kk, kk);
    const size = fitSize(TITLE, bold, 58, bw - 36, 30);
    write(ctx, TITLE, 0, 6, bold(size), INK, 18, { align: "center", rot: -0.025 });
    const tw = textW(TITLE, bold(size));
    begin();
    for (let i = 0; i <= 10; i++) pt(-tw / 2 + (i / 10) * tw, 17 + Math.sin(i * 0.9) * 2 - i * 0.5);
    ink(ctx, 19, { width: 2.6, jitter: 0.8, color: BAND });
    ctx.restore();
    write(ctx, SUBTITLE, cx, top + 92, hand(fitSize(SUBTITLE, hand, 19, bw - 24, 14)), PAL.inkDeep, 20, { align: "center" });
    const py = top + 128;
    const breathe = light.pulse(time, 0.6, { still: 0.6 });
    const pcx = hasBest ? cx - bw * 0.2 : cx;
    highlight(ctx, pcx - 58, py - 17, 116, 24, 23, ACCENT, 0.35 + 0.3 * breathe);
    write(ctx, TAP, pcx, py + 3, bold(28), INK, 24, { align: "center" });
    if (hasBest) write(ctx, `best ${fmt(session.best ?? 0)}`, cx + bw * 0.26, py + 2, bold(21), RED, 21, { align: "center", rot: -0.03 });
  }

  /** Game over: what my knight got, against your best, and one thing to try. Clear of the shell's result card. */
  function drawSummary() {
    const t = session.phaseTime;
    const a = clamp((t - 0.5) / 0.35);
    if (a <= 0 || !endInfo) return;
    const info = endInfo;
    const standalone = session.standalone;
    const ins = session.preview();
    const left = 12;
    const right = W - (standalone ? 12 : Math.max(12, ins.right + 6));
    const w = right - left;
    const inner = w - SCRAP_PAD * 2;
    const bottom = H - (standalone ? 36 : ins.bottom + 8);
    const hintLines = wrapLines(`next time: ${info.hint}`, inner, hand(17));
    const titleY = SCRAP_PAD + 20;
    const statY = titleY + 26;
    const barY = statY + 12;
    const bestY = barY + 27;
    const hintY = bestY + 23;
    const LINE = 19;
    const h = hintY + (hintLines.length - 1) * LINE + 5 + SCRAP_PAD;
    const y0 = standalone ? H * 0.46 : Math.max(H * 0.36, bottom - h);
    const x0 = left + SCRAP_PAD;
    scrap(left, y0, w, h, 91, true, 0.97 * a);
    write(ctx, CARD.title, x0, y0 + titleY, bold(fitSize(CARD.title, bold, 24, inner, 16)), INK, 92, { alpha: a });
    const stats = statLine(sim.stats, sim.floor);
    write(ctx, stats, x0, y0 + statY, hand(fitSize(stats, hand, 18, inner, 13)), PAL.inkDeep, 99, { alpha: a, wobble: 0.4 });
    const prev = info.prevBest;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(36,65,154,0.12)";
    ctx.fillRect(x0, y0 + barY, inner, 6);
    const scored = info.score > 0;
    const frac = !scored ? 0 : info.isBest ? 1 : prev ? clamp(info.score / prev) : 1;
    const grow = easeOutCubic(clamp((t - 0.7) / 0.8));
    if (frac > 0) highlight(ctx, x0, y0 + barY - 2, Math.max(4, inner * frac * grow), 10, 95, info.isBest ? ACCENT : "#9CC8F2", 0.9 * a);
    const lineText = bestLine(info.score, prev, info.isBest, fmt);
    write(ctx, lineText, x0, y0 + bestY, bold(fitSize(lineText, bold, 19, inner, 14)), info.isBest && scored ? RED : INK, 96, { alpha: a, wobble: 0.4 });
    hintLines.forEach((l, i) => write(ctx, l, x0, y0 + hintY + i * LINE, hand(17), PAL.inkDeep, 120 + i, { alpha: a, wobble: 0.4 }));
    ctx.globalAlpha = 1;
    if (standalone && t > 1) {
      write(ctx, fmt(info.score), W / 2, H * 0.3, bold(64), INK, 97, { align: "center" });
      if (info.isBest && info.score > 0) write(ctx, "new best!", W / 2, H * 0.3 + 34, bold(26), RED, 98, { align: "center" });
      const py = Math.min(H - 30, y0 + h + 34);
      scrap(W / 2 - 110, py - 24, 220, 44, 99, false, 0.96);
      highlight(ctx, W / 2 - 86, py - 11, 172, 22, 100, ACCENT, 0.5);
      write(ctx, AGAIN, W / 2, py + 8, bold(26), INK, 101, { align: "center" });
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Go
  // -------------------------------------------------------------------------------------------------------------
  newAttract();
  // Let the demo get going before the first frame, so attract opens with the knight already on the run.
  for (let i = 0; i < 200; i++) {
    pilot?.step(sim, 1 / 60);
    sim.step(1 / 60);
    sim.events.length = 0;
  }
  lastX = sim.heroX;
  lastY = sim.heroY;
  reveal = 1;
  let frames = 0;
  titlePop.target = 1;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    drawWorld();
    drawHud();
    if (++frames === 2) session.ready();
  });
  session.on("insets", () => {
    titlePop.velocity += 3;
  });
}

void main();
