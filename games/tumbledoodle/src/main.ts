/**
 * Tumbledoodle: a hole tore open in marginalia's homework and it eats the doodles. Drag anywhere to steer it (relative
 * movement, so the thumb never covers it), swallow what's smaller, grow tier by tier, keep away from the eraser until
 * you can eat it, and finish with the final gulp.
 */
import { createAudio } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeInOutCubic, easeOutBack, easeOutCubic, lerp, Spring } from "@thumbcade-games/kit/ease";
import { onKeys } from "@thumbcade-games/kit/input";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { ERASERS, KINDS } from "./catalog.ts";
import { bakeKind, drawKind, type Baked } from "./doodles.ts";
import { drawEraser } from "./eraser.ts";
import { Fx } from "./fx.ts";
import { drawHole, type HoleLook } from "./hole.ts";
import { begin, bold, boil, doodleArrow, ellipsePts, fillBuf, hand, highlight, ink, line, PAL, pt, updateBoil, write } from "./ink.ts";
import { drawPage, drawPencilNotes, RULE_GAP, RULE_TOP, type ViewBox } from "./page.ts";
import { Pilot, SKILLS, type Skill } from "./pilot.ts";
import {
  DRAW_T,
  DRAWING,
  FALL_T,
  FEAST_NAMES,
  FIT,
  Game,
  gainOf,
  HINTS,
  LAST_BITES,
  PAGE_H,
  PAGE_W,
  REST,
  STEP,
  TOP,
  type Doodle,
  type Ev,
} from "./sim.ts";
import { comboNote, S } from "./sound.ts";
import { fmt, loadType } from "./type.ts";

const ACCENT = "#54BF66";
const INK = PAL.ink;
const RED = PAL.red;
/** Thumb travel to hole travel: a little more than 1:1 on screen, so a short drag goes a long way. */
const DRAG_GAIN = 1.5;
/** The camera frames a little tighter than the world's view (which sets every speed), so the hole reads big. */
const CAM_K = 0.72;
/** The attract demo: a good player who never lifts their thumb. */
const DEMO: Skill = { ...SKILLS.good, name: "demo", lift: 0, aware: 1, hunt: 1 };
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good`); a normal build has none. */
const QA_AUTOPLAY: Skill | null = (SKILLS as Record<string, Skill>)[import.meta.env.VITE_AUTOPLAY ?? ""] ?? null;
/** QA builds can put the longest hint on every game-over card (`VITE_QA_HINT=longest`); a normal build has none. */
const QA_HINT: string | null = import.meta.env.VITE_QA_HINT === "longest" ? Object.values(HINTS).reduce((p, q) => (q.length > p.length ? q : p)) : null;
/** Scraps: how far the outline rounds off at a corner, how far its edge wobbles, and the inset that clears both. */
const SCRAP_CORNER = 6;
const SCRAP_WOBBLE = 2;
const SCRAP_PAD = SCRAP_CORNER + SCRAP_WOBBLE + 8;

const MENU = [
  "",
  "paperclips, buttons, snails and fish",
  "cats, cupcakes, ghosts and birds",
  "cars, bikes, trees and robots",
  "houses, rockets and dinosaurs",
  "castles, whales and pirate ships",
  "the moon. the kraken. everything.",
];

interface Banner {
  text: string;
  sub: string;
  t: number;
  life: number;
  big: boolean;
  color: string;
  seed: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "tumbledoodle" }), loadType()]);
  const reduced = session.reducedMotion;
  let hintSeen = 0;
  try {
    const v = await tc.storage.get<number>("hint");
    if (typeof v === "number") hintSeen = v;
  } catch {
    /* storage unavailable: show the hints */
  }

  const cv = createCanvas({ background: PAL.paper });
  const ctx = cv.ctx;
  let W = cv.width;
  let H = cv.height;
  let dpr = cv.dpr;
  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(9, 0.012, 1.8, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.12, decay: 0.5 });
  const under = new Fx(160);
  const over = new Fx(360);
  const ui = new Fx(200);
  const camView = new Spring(240, 38, 11.5);
  const rimKick = new Spring(0, 320, 13);
  const scorePop = new Spring(1, 420, 14);
  const clockPop = new Spring(1, 420, 14);
  const titlePop = new Spring(0, 150, 12);

  // Sprites: three boil variants per kind, baked at the sharpest zoom they're shown at.
  const zMax = () => Math.min(4, (W / 240) * dpr);
  let sprites: Baked[][] = KINDS.map((_, k) => bakeKind(k, zMax()));
  let bakedAt = zMax();
  cv.onResize((w, h) => {
    W = w;
    H = h;
    dpr = cv.dpr;
    if (zMax() > bakedAt * 1.25) {
      sprites = KINDS.map((_, k) => bakeKind(k, zMax()));
      bakedAt = zMax();
    }
  });

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let game = new Game(rng.int(1, 1e9), { mode: "attract", startTier: 1 });
  let pilot = new Pilot(DEMO, createRng(rng.int(1, 1e9)), game);
  let qa: Pilot | null = null;
  const target = { x: game.hole.x, y: game.hole.y };
  let acc = 0;
  let time = 0;
  let alpha = 0;
  // Camera (page units) and the last drawn zoom.
  let camX = game.hole.x;
  let camY = game.hole.y;
  let z = W / camView.value;
  // Run presentation.
  let banners: Banner[] = [];
  /** Ink rings that ripple out from the rim and follow the hole. */
  let rings: Array<{ t: number; life: number; k: number; color: string; seed: number }> = [];
  let comboShown = 0;
  let comboPts = 0;
  let comboMult = 1;
  let comboFade = 0;
  let burpT = -1;
  let callName: { text: string; t: number } | null = null;
  let clockFly: { text: string; color: string; t: number } | null = null;
  let shownScore = 0;
  let shownClock = 0;
  let lastTick = -1;
  let celebratedBest = false;
  let endInfo: { score: number; best: number | null; isBest: boolean; prevBest: number | null } | null = null;
  let closeT = -1;
  let blinkT = 2;
  let blink = 0;
  let wobbleNotes = 0;
  let lastBoing = -9;
  let lastRub = -9;
  let lastScribble = -9;
  let demoAge = 0;
  let fade = 0;
  let dragTravel = 0;
  let firstEraserSeen = (hintSeen & 2) !== 0;
  let fleeSaid = false;
  // Input.
  let dragging = false;
  let dragId = -1;
  let lastX = 0;
  let lastY = 0;
  const keys = { x: 0, y: 0 };

  function resetRun(m: "attract" | "play") {
    mode = m;
    game = m === "attract" ? new Game(rng.int(1, 1e9), { mode: "attract", startTier: 1 }) : new Game(rng.int(1, 1e9));
    pilot = new Pilot(DEMO, createRng(rng.int(1, 1e9)), game);
    qa = m === "play" && QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(rng.int(1, 1e9)), game) : null;
    target.x = game.hole.x;
    target.y = game.hole.y;
    camX = game.hole.x;
    camY = game.hole.y;
    camView.snap(game.view * CAM_K);
    under.clear();
    over.clear();
    ui.clear();
    banners = [];
    rings = [];
    comboShown = 0;
    comboPts = 0;
    comboFade = 0;
    burpT = -1;
    callName = null;
    clockFly = null;
    shownScore = 0;
    shownClock = game.clock;
    lastTick = -1;
    celebratedBest = false;
    endInfo = null;
    closeT = -1;
    wobbleNotes = 0;
    demoAge = 0;
    dragging = false;
    acc = 0;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: a tap starts a run; during it, drag anywhere and the hole follows the thumb's travel.
  // -------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  const canSteer = () => mode === "play" && session.phase === "playing" && game.phase === "play" && !qa;
  window.addEventListener("pointerdown", (e) => {
    if (!canSteer() || dragging) return;
    dragging = true;
    dragId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    target.x = game.hole.x;
    target.y = game.hole.y;
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragId) return;
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const x = evs.length ? evs[evs.length - 1]!.clientX : e.clientX;
    const y = evs.length ? evs[evs.length - 1]!.clientY : e.clientY;
    if (!canSteer()) {
      lastX = x;
      lastY = y;
      return;
    }
    const k = (DRAG_GAIN * gainOf(game.hole.tier)) / z;
    target.x += (x - lastX) * k;
    target.y += (y - lastY) * k;
    dragTravel += Math.hypot(x - lastX, y - lastY);
    game.clampTarget(target);
    lastX = x;
    lastY = y;
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragging = false;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  session.on("cancel", () => {
    dragging = false;
    target.x = game.hole.x;
    target.y = game.hole.y;
  });
  // Desktop testing: arrows / WASD steer.
  const held = new Set<string>();
  window.addEventListener("keydown", (e) => held.add(e.code));
  window.addEventListener("keyup", (e) => held.delete(e.code));
  onKeys({});

  session.on("start", () => {
    resetRun("play");
    audio.play(S.click);
  });
  session.on("resume", () => {
    acc = 0;
  });

  // -------------------------------------------------------------------------------------------------------------
  // Events from the world
  // -------------------------------------------------------------------------------------------------------------
  const loud = () => mode === "play";
  const vol = () => (mode === "play" ? 1 : 0.35);
  const hx = () => lerp(game.hole.px, game.hole.x, alpha);
  const hy = () => lerp(game.hole.py, game.hole.y, alpha);
  const unit = () => 1 / z;

  function banner(text: string, sub: string, big: boolean, color: string = INK, life = big ? 1.5 : 1.15) {
    // One banner at a time in its lane: a big one replaces whatever is showing; a small one waits its turn behind a big one.
    if (!big && banners.some((b) => b.big && b.t < b.life * 0.6)) {
      banners.push({ text, sub, t: -0.6, life, big, color, seed: rng.int(1, 9999) });
      return;
    }
    banners = banners.filter((b) => b.t < 0);
    banners.unshift({ text, sub, t: 0, life, big, color, seed: rng.int(1, 9999) });
  }

  function confetti(y: number) {
    const cols = [ACCENT, PAL.hiYellow, "#FF9CCB", "#9CC8F2"];
    ui.bit("star", W * 0.12, H * y, { count: 16, speed: [220, 480], angle: [-Math.PI * 0.45, -Math.PI * 0.1], life: [0.9, 1.5], size: [5, 9], colors: cols, grav: 620, drag: 1.4 });
    ui.bit("star", W * 0.88, H * y, { count: 16, speed: [220, 480], angle: [-Math.PI * 0.9, -Math.PI * 0.55], life: [0.9, 1.5], size: [5, 9], colors: cols, grav: 620, drag: 1.4 });
  }

  function onEvent(ev: Ev) {
    const h = game.hole;
    const u = game.view / 390;
    switch (ev.t) {
      case "swallow": {
        const d = ev.d;
        const kind = KINDS[d.k]!;
        const big = d.s / h.r;
        rimKick.kick(Math.min(2.4, 0.5 + big * 1.6));
        audio.play(S.gulp, { pitch: -kind.tier * 2 + (rng() - 0.5) * 2, volume: vol() * (0.5 + big * 0.6) });
        audio.play(S.plop, { volume: vol() * 0.6 });
        if (ev.combo >= 2) comboNote(audio, ev.combo, game.feast, vol());
        const ax = d.x - h.x;
        const ay = d.y - h.y;
        const al = Math.hypot(ax, ay) || 1;
        over.bit("scrap", h.x + (ax / al) * h.r, h.y + (ay / al) * h.r, { count: big > 0.5 ? 4 : 2, speed: [40 * u, 120 * u], life: [0.3, 0.6], size: [2.5 * u, 4.5 * u], colors: [PAL.paper], drag: 5 });
        if (big > 0.55) {
          rings.push({ t: 0, life: 0.4, k: 1.15, color: INK, seed: rng.int(1, 9999) });
          shake.add(0.06 + big * 0.06);
        }
        if (loud()) {
          comboPts = ev.combo >= 2 ? comboPts + ev.pts : ev.pts;
          comboMult = ev.mult;
          comboShown = ev.combo;
          comboFade = 1;
          burpT = -1;
          if (kind.tier >= 3 && (game.stats.tally[d.k] === 1 || big > 0.72)) callName = { text: kind.name, t: 0 };
          if (!(hintSeen & 1) && game.stats.eaten >= 6 && dragTravel > 120) {
            hintSeen |= 1;
            tc.storage.set("hint", hintSeen).catch(() => undefined);
          }
          const best = session.best;
          if (!celebratedBest && best !== null && best > 0 && game.score > best) {
            celebratedBest = true;
            banner("new best!", "keep eating", false, RED);
            audio.play(S.best);
            confetti(0.3);
            session.feedback("success");
          }
        }
        break;
      }
      case "tier": {
        audio.play(S.rip, { volume: vol() });
        audio.play(S.ripLow, { volume: vol() });
        audio.play(S.tier, { volume: vol() * 0.9 });
        rimKick.kick(6);
        hitStop.freeze(reduced ? 0 : 0.06);
        shake.add(0.3);
        flash.trigger(ACCENT, 0.7);
        rings.push({ t: 0, life: 0.6, k: 1.5, color: INK, seed: rng.int(1, 9999) });
        rings.push({ t: -0.12, life: 0.6, k: 1.9, color: ACCENT, seed: rng.int(1, 9999) });
        over.mark("burst", h.x, h.y, h.r * 1.25, INK, 0.5);
        over.bit("scrap", h.x, h.y, { count: 16, speed: [h.r * 2, h.r * 5], life: [0.5, 0.9], size: [h.r * 0.12, h.r * 0.22], colors: [PAL.paper], drag: 3.5, spread: h.r });
        if (loud()) {
          banner("bigger!", ev.tier >= TOP ? MENU[TOP]! : `now on the menu: ${MENU[ev.tier]}`, true, INK);
          clockFly = { text: ev.bonus > 0 ? `+${ev.bonus} s` : "", color: "#2E8B3E", t: 0 };
          clockPop.kick(6);
          session.feedback("success");
        }
        break;
      }
      case "feast": {
        audio.play(S.feast, { volume: vol(), pitch: (ev.level - 1) * 3 });
        if (loud()) {
          banner(FEAST_NAMES[ev.level]!, `${ev.combo} in a row · ×${ev.level + 1} points`, ev.level >= 2, INK);
          if (ev.level === 1) session.feedback("tap");
        }
        rimKick.kick(3);
        over.mark("burst", h.x, h.y, h.r * 1.3, RED, 0.45);
        break;
      }
      case "burp":
        audio.play(S.burp, { volume: vol() });
        over.mark("puff", h.x + h.r * 0.7, h.y - h.r * 0.9, h.r * 0.35, INK, 0.7);
        burpT = 0;
        break;
      case "wobble": {
        if (time - lastBoing > 0.25) {
          lastBoing = time;
          audio.play(S.boing, { volume: vol() * 0.8, pitch: -KINDS[ev.d.k]!.tier });
        }
        if (loud() && wobbleNotes < 2 && game.time > 1) {
          wobbleNotes++;
          callName = { text: "too big (for now)", t: 0 };
        }
        break;
      }
      case "eraserIn": {
        audio.play(S.squeak, { volume: vol() });
        const e0 = game.eraser;
        if (loud() && e0 && e0.s <= h.r * FIT) {
          // Already big enough: no warning, just dinner.
          fleeSaid = true;
          banner(`here comes ${ERASERS[ev.level]!.name}`, "you're bigger. eat it for +4 s", false, INK);
        } else if (loud()) {
          fleeSaid = false;
          const first = !firstEraserSeen;
          firstEraserSeen = true;
          if (first) {
            hintSeen |= 2;
            tc.storage.set("hint", hintSeen).catch(() => undefined);
          }
          banner(`uh oh: ${ERASERS[ev.level]!.name}`, first ? "it rubs you smaller. keep away till you can eat it" : "keep away till you're bigger than it", true, RED);
        }
        break;
      }
      case "scrub": {
        audio.play(S.rub, { volume: vol() });
        audio.play(S.scrub, { volume: vol() });
        shake.add(0.38);
        hitStop.freeze(reduced ? 0 : 0.05);
        under.mark("smudge", ev.x, ev.y, h.r * 1.1, PAL.graphite, 3);
        over.bit("crumb", ev.x, ev.y, { count: 14, speed: [h.r * 1.5, h.r * 4], life: [0.4, 0.8], size: [h.r * 0.06, h.r * 0.12], colors: [PAL.eraser, PAL.eraserGrey], drag: 4 });
        if (loud()) {
          clockFly = { text: "-2 s", color: RED, t: 0 };
          clockPop.kick(-5);
          callName = { text: "scrubbed!", t: 0 };
          session.feedback("impact");
        }
        break;
      }
      case "flee":
        audio.play(S.scared, { volume: vol() });
        if (loud() && !fleeSaid) banner("it's scared of you now!", "eat the eraser: +4 s", false, INK);
        fleeSaid = true;
        break;
      case "eraserEaten": {
        audio.play(S.bigGulp, { volume: vol() });
        audio.play(S.eaten, { volume: vol() });
        hitStop.freeze(reduced ? 0 : 0.08);
        shake.add(0.42);
        flash.trigger(ACCENT, 0.9);
        rimKick.kick(5);
        over.mark("burst", h.x, h.y, h.r * 1.4, RED, 0.6);
        over.bit("crumb", h.x, h.y, { count: 26, speed: [h.r * 2, h.r * 6], life: [0.5, 1], size: [h.r * 0.06, h.r * 0.13], colors: [PAL.eraser, PAL.eraserGrey, "#9CC8F2"], drag: 3, spread: h.r * 0.6 });
        if (loud()) {
          banner("erased the eraser!", `+4 s · +${fmt(ev.pts)}`, true, RED);
          clockFly = { text: "+4 s", color: "#2E8B3E", t: 0 };
          clockPop.kick(6);
          confetti(0.36);
          session.feedback("success");
        }
        break;
      }
      case "erase": {
        const d = ev.d;
        under.mark("smudge", d.x, d.y, d.s * 1.2, PAL.graphite, 2.4);
        over.bit("crumb", d.x, d.y, { count: 4, speed: [10 * u, 50 * u], life: [0.3, 0.6], size: [1.5 * u, 3 * u], colors: [PAL.eraser, PAL.eraserGrey], drag: 4 });
        if (time - lastRub > 0.18) {
          lastRub = time;
          audio.play(S.rubSoft, { volume: vol() });
        }
        break;
      }
      case "spawn":
        if (time - lastScribble > 0.3 && Math.hypot(ev.d.x - h.x, ev.d.y - h.y) < game.view * 0.6) {
          lastScribble = time;
          audio.play(S.scribble, { volume: vol() });
        }
        break;
      case "lastBites":
        audio.play(S.lastBites, { volume: vol() });
        if (loud()) banner("last bites!", "everything counts double", true, RED);
        break;
      case "gulp":
        audio.play(S.finalGulp, { volume: vol() });
        audio.play(S.rumble, { volume: vol() });
        shake.add(0.45);
        flash.trigger(ACCENT, 0.6);
        rimKick.kick(4);
        if (loud()) banner("GULP.", "the final gulp", true, INK, 1.6);
        break;
      case "done":
        if (loud()) endRun();
        break;
    }
  }

  function endRun() {
    const prevBest = session.best;
    const st = game.stats;
    const r = session.end(game.score, {
      stats: { eaten: st.eaten, size: game.hole.tier + 1, combo: st.bestCombo, erasers: st.erasersEaten, scrubs: st.scrubs },
    });
    endInfo = { score: game.score, best: r.best, isBest: r.isBest, prevBest };
    closeT = 0;
    dragging = false;
    for (let i = 0; i < 5; i++) window.setTimeout(() => audio.play(S.stitch, { pitch: i * 2 }), 380 + i * 90);
    if (r.isBest && game.score > 0) {
      audio.play(S.best);
      confetti(0.55);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // The fixed step
  // -------------------------------------------------------------------------------------------------------------
  function stepOnce() {
    if (mode === "attract") {
      pilot.control(game);
      game.step(pilot.x, pilot.y);
    } else if (session.phase === "playing" && game.phase !== "done") {
      if (qa) {
        qa.control(game);
        target.x = qa.x;
        target.y = qa.y;
      } else if (keys.x || keys.y) {
        const v = game.view * 1.1 * gainOf(game.hole.tier) * STEP;
        target.x += keys.x * v;
        target.y += keys.y * v;
        game.clampTarget(target);
      }
      game.step(target.x, target.y);
    } else return;
    for (const ev of game.events) onEvent(ev);
    game.events.length = 0;
  }

  function update(rawDt: number) {
    time += rawDt;
    session.tick(rawDt);
    updateBoil(time, reduced);
    keys.x = (held.has("ArrowRight") || held.has("KeyD") ? 1 : 0) - (held.has("ArrowLeft") || held.has("KeyA") ? 1 : 0);
    keys.y = (held.has("ArrowDown") || held.has("KeyS") ? 1 : 0) - (held.has("ArrowUp") || held.has("KeyW") ? 1 : 0);
    const dt = hitStop.scale(rawDt);
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 4) {
      stepOnce();
      acc -= STEP;
      n++;
    }
    if (n === 4) acc = 0;
    alpha = clamp(acc / STEP);
    if (game.time % 1 < STEP) game.compact();

    shake.update(rawDt);
    flash.update(rawDt);
    under.update(rawDt);
    over.update(rawDt);
    ui.update(rawDt);
    rimKick.update(rawDt);
    for (const g2 of rings) g2.t += rawDt;
    if (rings.some((g2) => g2.t > g2.life)) rings = rings.filter((g2) => g2.t <= g2.life);
    scorePop.update(rawDt);
    clockPop.update(rawDt);
    titlePop.update(rawDt);
    for (const b of banners) b.t += rawDt;
    if (banners.some((b) => b.t > b.life)) banners = banners.filter((b) => b.t <= b.life);
    if (banners.length > 1 && banners[0]!.t > banners[0]!.life * 0.6 && banners[1]!.t < 0) banners[1]!.t = 0;
    if (callName) {
      callName.t += rawDt;
      if (callName.t > 1.3) callName = null;
    }
    if (clockFly) {
      clockFly.t += rawDt;
      if (clockFly.t > 1.1) clockFly = null;
    }
    if (burpT >= 0) burpT += rawDt;
    if (game.combo === 0) comboFade = Math.max(0, comboFade - rawDt * (burpT >= 0 ? 1.2 : 2.2));
    if (closeT >= 0) closeT += rawDt;

    // The score ticks up toward the real one; the clock follows smoothly.
    const sd = game.score - shownScore;
    if (sd > 0) {
      shownScore += Math.max(1, sd * (1 - Math.exp(-12 * rawDt)));
      if (shownScore > game.score) shownScore = game.score;
    } else shownScore = game.score;
    shownClock = damp(shownClock, game.clock, 16, rawDt);
    if (mode === "play" && game.lastBites && game.phase === "play") {
      const sec = Math.ceil(game.clock);
      if (sec !== lastTick) {
        lastTick = sec;
        audio.play(S.tick, { pitch: (LAST_BITES - sec) * 2 });
        clockPop.kick(4);
      }
    }

    // Blinks.
    blinkT -= rawDt;
    if (blinkT <= 0) {
      blink = 1;
      blinkT = 2.4 + rng() * 2.8;
    }
    blink = Math.max(0, blink - rawDt * 7);

    // Camera: follow the hole, pull back as it grows (a spring, so a tier-up reads as the camera easing back).
    const want = game.view * CAM_K * (game.phase === "gulp" || closeT >= 0 ? 1.12 : 1) * (mode === "attract" ? 1.05 : 1);
    camView.target = want;
    camView.update(rawDt);
    z = W / camView.value;
    const fy = mode === "attract" ? 0.1 : 0.03;
    camX = damp(camX, hx(), 7, rawDt);
    camY = damp(camY, hy() - (H / z) * fy, 7, rawDt);

    // Attract: start over with a fresh page now and then.
    if (mode === "attract") {
      demoAge += rawDt;
      if ((demoAge > 26 || game.hole.tier >= 4) && fade <= 0) fade = 0.0001;
    }
    if (fade > 0) {
      fade += rawDt;
      if (fade >= 0.45 && mode === "attract" && demoAge > 1) resetRun("attract");
      if (fade >= 0.9) fade = 0;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Drawing the world
  // -------------------------------------------------------------------------------------------------------------
  const vis: Doodle[] = [];
  const box: ViewBox = { x0: 0, y0: 0, x1: 0, y1: 0, z: 1 };
  let camA = 1;
  let camE = 0;
  let camF = 0;

  function camera() {
    const vw = W / z;
    const vh = H / z;
    let cx = camX;
    let cy = camY;
    // Keep the page in view where it can be, but never let the hole slip under the HUD strip or off the bottom:
    // near the top edge the camera runs on past the page, over the desk.
    // The HUD strip and the banner lane under it.
    const hudPx = mode === "play" && session.phase === "playing" ? session.play().top + 8 + 56 + 12 + 74 + 10 : 0;
    const topRoom = (hudPx + game.hole.r * z * 1.2) / z;
    if (vw < PAGE_W) cx = clamp(cx, vw / 2, PAGE_W - vw / 2);
    else cx = PAGE_W / 2;
    if (vh < PAGE_H) cy = clamp(cy, Math.min(vh / 2, hy() - topRoom + vh / 2), PAGE_H - vh / 2);
    else cy = PAGE_H / 2;
    const o = shake.offset;
    camA = dpr * z;
    camE = dpr * (W / 2 - cx * z + o.x);
    camF = dpr * (H / 2 - cy * z + o.y);
    box.x0 = cx - vw / 2;
    box.x1 = cx + vw / 2;
    box.y0 = cy - vh / 2;
    box.y1 = cy + vh / 2;
    box.z = z;
  }
  const worldT = () => ctx.setTransform(camA, 0, 0, camA, camE, camF);
  const toSX = (x: number) => (x * camA + camE) / dpr;
  const toSY = (y: number) => (y * camA + camF) / dpr;

  /** Blits a doodle's sprite at (x, y), rotated, scaled, and squashed toward (qx, qy) by q (1 = none). */
  function blitDoodle(d: Doodle, x: number, y: number, k: number, rot: number, alphaV: number, q = 1, qa2 = 0) {
    const b = sprites[d.k]![(boil.step + d.seed) % 3]!;
    let m11 = Math.cos(rot) * k;
    let m12 = Math.sin(rot) * k;
    let m21 = -Math.sin(rot) * k;
    let m22 = Math.cos(rot) * k;
    if (q !== 1) {
      const c = Math.cos(qa2);
      const s = Math.sin(qa2);
      const a11 = c * c * q + s * s;
      const a12 = c * s * (q - 1);
      const a22 = s * s * q + c * c;
      const n11 = a11 * m11 + a12 * m12;
      const n12 = a12 * m11 + a22 * m12;
      const n21 = a11 * m21 + a12 * m22;
      const n22 = a12 * m21 + a22 * m22;
      m11 = n11;
      m12 = n12;
      m21 = n21;
      m22 = n22;
    }
    ctx.setTransform(camA * m11, camA * m12, camA * m21, camA * m22, camA * x + camE, camA * y + camF);
    ctx.globalAlpha = alphaV;
    ctx.drawImage(b.canvas, -b.half, -b.half, b.half * 2, b.half * 2);
    ctx.globalAlpha = 1;
  }

  function drawWorld() {
    camera();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    worldT();
    drawPage(ctx, box, { a: camA, e: camE, f: camF });
    drawPencilNotes(ctx, box);
    under.drawMarks(ctx, unit(), boil.step);
    under.drawBits(ctx, unit());
    const h = game.hole;
    const x = hx();
    const y = hy();
    const closing = closeT >= 0 ? clamp(closeT / 0.55) : 0;
    const r = h.r * (1 + rimKick.value * 0.025) * (1 - easeInOutCubic(closing));
    // The doodles on the page, smallest first, so big ones lie on top.
    vis.length = 0;
    const pad = 130;
    game.query((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2 + pad, (d) => {
      if (d.x + d.s < box.x0 || d.x - d.s > box.x1 || d.y + d.s < box.y0 || d.y - d.s > box.y1) return;
      vis.push(d);
    });
    vis.sort((a, b) => a.s - b.s);
    const e = game.eraser;
    const scared = !!e && e.state === "chase" && Math.hypot(e.x - h.x, e.y - h.y) < game.view * 0.35;
    if (r > 0.5) {
      const look: HoleLook = {
        x,
        y,
        r,
        step: boil.step,
        lookX: clamp(h.vx / (game.view * 0.8)),
        lookY: clamp(h.vy / (game.view * 0.8)),
        mood: game.phase !== "play" && mode === "play" ? "gulp" : h.invuln > 0 ? "dizzy" : game.feast > 0 ? "happy" : scared ? "scared" : "idle",
        blink,
        z,
        rule0: RULE_TOP,
        ruleGap: RULE_GAP,
        accent: ACCENT,
        glow: mode === "play" && game.lastBites ? 0.45 + 0.35 * light.pulse(time, 1.5, { still: 0.6 }) : 0,
      };
      drawHole(ctx, look, () => {
        for (const d of game.falling) {
          const u = clamp(d.t / FALL_T);
          const ee = u * u;
          const k = 1 - 0.82 * ee;
          blitDoodle(d, x + d.fx * (1 - ee * 0.92), y + d.fy * (1 - ee * 0.92), k, d.rot + d.spin * u, 1 - 0.85 * ee);
        }
        if (e && e.state === "fall") {
          const u = clamp(e.t / (FALL_T * 1.6));
          const ee = u * u;
          worldT();
          ctx.translate(x + e.fx * (1 - ee), y + e.fy * (1 - ee));
          ctx.rotate(e.ang + u * 5);
          ctx.scale(1 - 0.85 * ee, 1 - 0.85 * ee);
          ctx.globalAlpha = 1 - 0.8 * ee;
          drawEraser(ctx, e.level, e.s, "fall", time, 2 / z, boil.step);
          ctx.globalAlpha = 1;
        }
        worldT();
      });
      worldT();
    }
    if (closing > 0) drawStitches(x, y, h.r, closing);
    for (const g2 of rings) {
      if (g2.t < 0) continue;
      const k = g2.t / g2.life;
      const rr = h.r * (1 + (g2.k - 1) * (1 - (1 - k) ** 3));
      ellipsePts(x, y, rr, rr, g2.seed, 0.1, 18);
      ink(ctx, g2.seed, { width: (2.4 * (1 - k * 0.6)) / z, jitter: 1 / z, step: boil.step, color: g2.color, alpha: 1 - k, passes: 1 });
    }
    for (const d of vis) {
      if (d.state === REST) {
        let rot = d.rot + d.wob;
        let q = 1;
        let qa2 = 0;
        if (d.moving) {
          // Tipping over the rim: lean and foreshorten toward the hole.
          const dx = x - d.x;
          const dy = y - d.y;
          const dist = Math.hypot(dx, dy);
          const tip = clamp(1 - (dist - (h.r - d.s * 0.35)) / (d.s * 1.05 + 1));
          q = 1 - 0.3 * tip;
          qa2 = Math.atan2(dy, dx);
          rot += Math.sin(qa2) * 0.15 * tip;
        }
        blitDoodle(d, d.x, d.y, 1, rot, 1, q, qa2);
      } else if (d.state === DRAWING) drawDrawing(d);
    }
    worldT();
    if (e && e.state !== "fall") {
      ctx.save();
      ctx.translate(lerp(e.px, e.x, alpha), lerp(e.py, e.y, alpha));
      ctx.fillStyle = "rgba(60,50,40,0.12)";
      ctx.beginPath();
      ctx.ellipse(e.s * 0.12, e.s * 0.18, e.s * 1.05, e.s * 0.75, e.ang, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(e.ang);
      drawEraser(ctx, e.level, e.s, e.state, time, 2 / z, boil.step);
      ctx.restore();
      if (e.state === "stun") {
        for (let i = 0; i < 3; i++) {
          const a = time * 4 + (i / 3) * Math.PI * 2;
          drawStar(e.x + Math.cos(a) * e.s * 0.9, e.y + Math.sin(a) * e.s * 0.45 - e.s * 0.9, e.s * 0.14);
        }
      }
    }
    over.drawMarks(ctx, unit(), boil.step);
    over.drawBits(ctx, unit());
  }

  function drawStar(x: number, y: number, r: number) {
    begin();
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? r * 0.45 : r;
      pt(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    fillBuf(ctx, PAL.hiYellow);
    ink(ctx, 977, { width: 1.4 / z, jitter: 0.5 / z, step: boil.step, color: INK, passes: 1, closed: true });
  }

  /** A doodle drawing itself in: a sweep that goes round like a pen, with the pen's nib at the front. */
  function drawDrawing(d: Doodle) {
    const u = clamp(d.t / DRAW_T);
    if (u <= 0) return;
    const b = sprites[d.k]![(boil.step + d.seed) % 3]!;
    const a0 = (d.seed % 628) / 100;
    const a1 = a0 + u * Math.PI * 2;
    worldT();
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.arc(d.x, d.y, b.half * 1.5, a0, a1);
    ctx.closePath();
    ctx.clip();
    blitDoodle(d, d.x, d.y, 1, d.rot, 1);
    ctx.restore();
    worldT();
    if (u < 1) {
      const px = d.x + Math.cos(a1) * d.s * 0.7;
      const py = d.y + Math.sin(a1) * d.s * 0.7;
      drawPen(px, py, Math.max(d.s * 0.5, 9 / z));
    }
  }

  function drawPen(x: number, y: number, l: number) {
    // A ballpoint, nib down-left, held at an angle.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.75);
    ctx.fillStyle = "#3B4E9C";
    ctx.fillRect(0, -l * 0.09, l * 1.6, l * 0.18);
    ctx.fillStyle = "#C7CBD4";
    ctx.beginPath();
    ctx.moveTo(0, -l * 0.09);
    ctx.lineTo(-l * 0.28, 0);
    ctx.lineTo(0, l * 0.09);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(-l * 0.28, 0, l * 0.035, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawStitches(x: number, y: number, r: number, k: number) {
    // The tear sewn shut: a wavy seam with red cross-stitches, one after another.
    const n = 5;
    const w = r * 1.5;
    begin();
    for (let i = 0; i <= 8; i++) pt(x - w / 2 + (i / 8) * w, y + Math.sin(i * 1.7) * r * 0.05);
    ink(ctx, 991, { width: 2.2 / z, jitter: 1 / z, step: boil.step, color: INK });
    const shown = Math.floor(k * (n + 1));
    for (let i = 0; i < Math.min(n, shown); i++) {
      const sx = x - w / 2 + ((i + 0.5) / n) * w;
      const a = r * 0.11;
      line(ctx, sx - a, y - a * 1.3, sx + a, y + a * 1.3, 992 + i, { width: 2.2 / z, jitter: 0.6 / z, color: RED, passes: 1 });
      line(ctx, sx + a, y - a * 1.3, sx - a, y + a * 1.3, 997 + i, { width: 2.2 / z, jitter: 0.6 / z, color: RED, passes: 1 });
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD (CSS px)
  // -------------------------------------------------------------------------------------------------------------
  const hudT = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /**
   * A scrap of paper with a ballpoint edge and a strip of tape, as a backing for text. Its corners round off by
   * SCRAP_CORNER and its edge wobbles by up to SCRAP_WOBBLE, so text kept SCRAP_PAD inside never touches the border.
   */
  function scrap(x: number, y: number, w: number, h: number, seed: number, tape = true, alphaV = 0.96) {
    ctx.globalAlpha = alphaV;
    const j = (i: number) => ((((seed * 13 + i * 7) % 5) - 2) * SCRAP_WOBBLE) / 2;
    // The corners are control points between two points a corner-length either side, so the outline rounds off
    // within SCRAP_CORNER of each corner and runs straight (wobbling a little) everywhere else.
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

  /** The largest size (down to `min`) at which `text` fits `maxW` in `font(size)`. */
  function fitSize(text: string, font: (px: number) => string, size: number, maxW: number, min = 12): number {
    while (size > min && textW(text, font(size)) > maxW) size--;
    return size;
  }

  function textW(text: string, font: string) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  function drawHud() {
    hudT();
    const playing = mode === "play" && session.phase === "playing";
    const ins = mode === "play" ? session.play() : session.preview();
    const top = ins.top + 8;
    const stripH = 56;
    const laneTop = top + stripH + 12;
    const laneBottom = laneTop + 74;
    if (mode === "play" && (playing || game.phase !== "done")) drawStrip(top, stripH);
    if (mode === "attract") drawAttract();
    if (mode === "play" && playing) {
      const hintTop = hintShowing() ? H * 0.8 - 104 : H;
      drawCallout(laneBottom + 8, hintTop - 8);
      drawHint();
      drawEraserPointer(laneBottom + 8);
    }
    drawBanners(mode === "attract" ? Math.max(H * 0.5, session.preview().top + 190) : laneTop, mode === "attract");
    if (mode === "play" && session.phase === "over" && endInfo) drawSummary();
    ui.drawBits(ctx, 1);
    hudT();
    flash.draw(ctx, W, H);
    if (fade > 0) {
      ctx.globalAlpha = Math.sin(clamp(fade / 0.9) * Math.PI) * 0.92;
      ctx.fillStyle = PAL.paper;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function drawStrip(top: number, h: number) {
    scrap(10, top, W - 20, h, 31, false, 0.94);
    // Clock: a doodled stopwatch and the seconds.
    const last = game.lastBites && game.phase === "play";
    const pulse = last ? light.pulse(time, 2, { still: 1 }) : 0;
    const cx = 34;
    const cy = top + h / 2 + 1;
    ellipsePts(cx, cy + 2, 11, 11, 71, 0.1, 12);
    fillBuf(ctx, last ? "#FFD7D2" : "#FFFDF7");
    ink(ctx, 71, { width: 1.8, jitter: 0.6, color: last ? RED : INK });
    line(ctx, cx, cy - 9, cx, cy - 13, 72, { width: 2, color: last ? RED : INK, passes: 1 });
    line(ctx, cx, cy + 2, cx + Math.sin(game.clock) * 6, cy + 2 - Math.cos(game.clock) * 6, 73, { width: 1.6, color: last ? RED : INK, passes: 1 });
    const cs = clockPop.value;
    ctx.save();
    ctx.translate(52, cy + 12);
    ctx.scale(cs, cs);
    const secs = game.phase === "play" ? Math.ceil(shownClock - 0.05) : 0;
    write(ctx, `${Math.max(0, secs)}`, 0, 0, bold(34), last && pulse > 0.5 ? RED : last ? "#B0302C" : INK, 81);
    ctx.restore();
    if (clockFly) {
      const k = clockFly.t / 1.1;
      ctx.globalAlpha = k < 0.1 ? k / 0.1 : 1 - Math.max(0, (k - 0.6) / 0.4);
      write(ctx, clockFly.text, 98, cy + 10 - k * 6, bold(22), clockFly.color, 82);
      ctx.globalAlpha = 1;
    }
    // Score.
    const sc = scorePop.value;
    ctx.save();
    ctx.translate(W / 2, cy + 13);
    ctx.scale(sc, sc);
    write(ctx, fmt(shownScore), 0, 0, bold(38), INK, 83, { align: "center" });
    ctx.restore();
    // Size: seven dots (one per tier) and a highlighter bar toward the next.
    const rx = W - 24;
    const n = TOP + 1;
    const gap = 11;
    const x0 = rx - (n - 1) * gap;
    write(ctx, "size", x0 - 4, cy - 8, hand(16), PAL.graphite, 84);
    for (let i = 0; i < n; i++) {
      const dx = x0 + i * gap;
      const r = 2.6 + i * 0.35;
      ctx.fillStyle = i <= game.hole.tier ? INK : "rgba(36,65,154,0.2)";
      ctx.beginPath();
      ctx.arc(dx, cy + 3, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const bw = (n - 1) * gap + 8;
    const bx = x0 - 4;
    const by = cy + 13;
    ctx.fillStyle = "rgba(36,65,154,0.12)";
    ctx.fillRect(bx, by, bw, 5);
    const m = game.hole.tier >= TOP ? 1 : game.meter;
    highlight(ctx, bx, by - 1, Math.max(2, bw * m), 7, 85, ACCENT, 0.9);
    // Feast / last-bites multiplier, under the score.
    const mult = game.mult;
    if (mult > 1 && game.phase === "play") write(ctx, `×${mult}`, W / 2 + textW(fmt(shownScore), bold(38)) / 2 + 8, cy + 6, bold(20), RED, 86);
  }

  function drawBanners(y0: number, attract: boolean) {
    const b = banners[0];
    if (!b || b.t < 0) return;
    const k = b.t / b.life;
    const pop = b.t < 0.18 ? easeOutBack(b.t / 0.18) : 1;
    const a = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
    const size = attract ? (b.big ? 30 : 26) : b.big ? 40 : 32;
    const tw = Math.min(W - 60, textW(b.text, bold(size)));
    const sw = b.sub ? Math.min(W - 60, textW(b.sub, hand(18))) : 0;
    const w = Math.max(tw, sw) + 36;
    const h = size * 1.05 + (b.sub ? 26 : 10);
    const x = W / 2 - w / 2;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, y0 + h / 2);
    ctx.scale(pop, pop);
    ctx.rotate(((b.seed % 5) - 2) * 0.008);
    ctx.translate(-W / 2, -(y0 + h / 2));
    scrap(x, y0, w, h, b.seed, true, 0.96 * a);
    highlight(ctx, W / 2 - tw / 2 - 6, y0 + 8, tw + 12, size * 0.72, b.seed, b.color === RED ? "#FFB4AE" : ACCENT, 0.55);
    ctx.globalAlpha = a;
    write(ctx, b.text, W / 2, y0 + size * 0.86, bold(size), b.color, b.seed, { align: "center" });
    if (b.sub) write(ctx, b.sub, W / 2, y0 + size * 0.86 + 22, hand(18), PAL.inkDeep, b.seed + 1, { align: "center" });
    ctx.restore();
  }

  /** The combo and what just went in, on a scrap under the hole (or over it near the bottom). */
  function drawCallout(minY: number, maxY: number) {
    const showCombo = comboFade > 0 && comboShown >= 2;
    if (!showCombo && !callName) return;
    const rPx = game.hole.r * z;
    const sx = toSX(hx());
    const sy = toSY(hy());
    const lines: Array<{ text: string; font: string; color: string }> = [];
    if (showCombo) {
      const label = burpT >= 0 && game.combo === 0 ? `${comboShown} in a row · burp.` : `×${comboShown}  +${fmt(comboPts)}`;
      lines.push({ text: label, font: bold(24), color: comboMult > 1 ? RED : INK });
    }
    if (callName) lines.push({ text: callName.text, font: hand(20), color: PAL.inkDeep });
    let w = 0;
    for (const l of lines) w = Math.max(w, textW(l.text, l.font));
    w += 24;
    const h = 12 + lines.length * 24;
    // Under the hole; over it when there's no room below (above the hint, if it's up); never in the banner lane.
    let y = sy + rPx + 14;
    if (y + h > maxY) y = sy - rPx - 14 - h;
    y = clamp(y, minY, Math.max(minY, maxY - h));
    const x = clamp(sx - w / 2, 10, W - w - 10);
    const a = showCombo ? Math.min(1, comboFade * 2) : 1 - clamp((callName!.t - 1) / 0.3);
    ctx.globalAlpha = a;
    scrap(x, y, w, h, 61, false, 0.95 * a);
    let ly = y + 26;
    ctx.globalAlpha = a;
    for (const l of lines) {
      write(ctx, l.text, x + w / 2, ly - 2, l.font, l.color, 62, { align: "center", alpha: a });
      ly += 24;
    }
    ctx.globalAlpha = 1;
  }

  /** An arrow at the screen edge toward an eraser you can't see. */
  function drawEraserPointer(minY: number) {
    const e = game.eraser;
    if (!e || e.state === "fall") return;
    const sx = toSX(e.x);
    const sy = toSY(e.y);
    const m = 26;
    if (sx > -e.s * z && sx < W + e.s * z && sy > minY - 40 && sy < H + e.s * z) return;
    const cx = W / 2;
    const cy = (minY + H) / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const px = clamp(cx + Math.cos(ang) * W, m, W - m);
    const py = clamp(cy + Math.sin(ang) * H, minY + m, H - m);
    const edible = e.state === "flee";
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = edible ? "#E9F7EA" : "#FFE5E1";
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(ang);
    ctx.strokeStyle = edible ? "#2E8B3E" : RED;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(9, 0);
    ctx.moveTo(3, -6);
    ctx.lineTo(9, 0);
    ctx.lineTo(3, 6);
    ctx.stroke();
    ctx.restore();
  }

  const hintShowing = () => !(hintSeen & 1) && game.phase === "play" && !qa;

  function drawHint() {
    if (!hintShowing()) return;
    const cyc = 2.2;
    const t = time % cyc;
    const bx = W * 0.5;
    const by = H * 0.8;
    const u = Math.sin((t / cyc) * Math.PI * 2);
    const tx = bx + u * 46;
    const ty = by - Math.abs(Math.sin((t / cyc) * Math.PI * 2)) * 6;
    scrap(W / 2 - 128, by - 98, 256, 56, 51, true, 0.95);
    write(ctx, "drag anywhere to steer", W / 2, by - 72, bold(24), INK, 52, { align: "center" });
    write(ctx, "eat what's smaller than you", W / 2, by - 50, hand(18), PAL.inkDeep, 53, { align: "center" });
    // A ghost fingertip sliding side to side, with doodled arrows.
    drawFingertip(tx, ty + 14, 0.85);
    doodleArrow(ctx, bx - 34, by + 14, bx - 96, by + 14, -6, 55, { width: 2, color: "rgba(36,65,154,0.6)", head: 9, passes: 1 });
    doodleArrow(ctx, bx + 34, by + 14, bx + 96, by + 14, 6, 56, { width: 2, color: "rgba(36,65,154,0.6)", head: 9, passes: 1 });
  }

  /** A ghost fingertip seen from above: pad, nail and a crease. */
  function drawFingertip(x: number, y: number, a: number) {
    ctx.globalAlpha = a;
    ctx.fillStyle = "#FFF6EC";
    ctx.beginPath();
    ctx.ellipse(x, y, 18, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ellipsePts(x, y, 18, 24, 57, 0.1, 14);
    ink(ctx, 57, { width: 1.6, jitter: 0.6, color: "rgba(36,65,154,0.7)", passes: 1, alpha: a });
    ellipsePts(x, y - 9, 10, 9, 58, 0.06, 10);
    ink(ctx, 58, { width: 1.3, jitter: 0.4, color: "rgba(36,65,154,0.5)", passes: 1, alpha: a });
    line(ctx, x - 9, y + 12, x + 9, y + 12, 59, { width: 1.1, color: "rgba(36,65,154,0.35)", passes: 1, alpha: a });
  }

  function drawAttract() {
    const r = session.preview();
    const left = r.left + 18;
    const right = W - r.right - 18;
    const cx = (left + right) / 2;
    const ty = r.top + 70;
    const k = easeOutBack(clamp(titlePop.value));
    scrap(cx - 150, ty - 52, 300, 116, 17, true, 0.95);
    ctx.save();
    ctx.translate(cx, ty);
    ctx.scale(k, k);
    let size = 58;
    while (size > 30 && textW("Tumbledoodle", bold(size)) > Math.min(280, right - left - 20)) size -= 2;
    write(ctx, "Tumbledoodle", 0, 4, bold(size), INK, 18, { align: "center", rot: -0.025 });
    const tw = textW("Tumbledoodle", bold(size));
    begin();
    for (let i = 0; i <= 10; i++) pt(-tw / 2 + (i / 10) * tw, 16 + Math.sin(i * 0.9) * 2 - i * 0.6);
    ink(ctx, 19, { width: 2.6, jitter: 0.8, color: RED });
    ctx.restore();
    write(ctx, "a hole tore open in my homework", cx, ty + 44, hand(20), PAL.inkDeep, 20, { align: "center" });
    if (session.best !== null && session.best > 0) write(ctx, `best ${fmt(session.best)}`, cx, ty + 82, bold(22), RED, 21, { align: "center" });
    // Tap to play, on a scrap, clear of the caption and the rail.
    const py = Math.min(H - r.bottom - 40, H * 0.72);
    const pw = 176;
    scrap(cx - pw / 2, py - 24, pw, 46, 22, false, 0.96);
    const breathe = 0.5 + 0.5 * Math.sin(time * 3.6);
    highlight(ctx, cx - 62, py - 11, 124, 22, 23, ACCENT, 0.4 + 0.25 * breathe);
    write(ctx, "tap to play", cx, py + 9, bold(28), INK, 24, { align: "center" });
    // The demo's thumb: a ghost under the hole, sliding the way the pilot drags.
    if (pilot.dragging) {
      // Off to the side and below, moving with the hole: the thumb never sits on it.
      const side = toSX(hx()) > (left + right) / 2 ? -1 : 1;
      const sx = clamp(toSX(hx()) + side * (game.hole.r * z + 58), left + 24, right - 24);
      const sy = clamp(toSY(hy()) + game.hole.r * z + 34, ty + 110, py - 50);
      drawFingertip(sx, sy, 0.75);
    }
  }

  /**
   * Game over: what you ate, against your best, and one thing to try. Clear of the shell's result card (which shows
   * the score and the best). Laid out top to bottom from the card's inner safe rect, and the card grows to fit the
   * wrapped hint, so no text reaches the border; every icon is scaled into a fixed box with its count below it.
   */
  function drawSummary() {
    const t = session.phaseTime;
    const a = clamp((t - 0.6) / 0.35);
    if (a <= 0 || !endInfo) return;
    const info = endInfo;
    const standalone = session.standalone;
    const ins = session.preview();
    const left = 12;
    const right = W - (standalone ? 12 : Math.max(12, ins.right + 6));
    const w = right - left;
    const inner = w - SCRAP_PAD * 2;
    const bottom = H - (standalone ? 36 : ins.bottom + 8);
    const hintText = QA_HINT ? QA_HINT : game.hint();
    const hintLines = wrapLines(`next time: ${hintText}`, inner, hand(17));
    // Rows, as offsets from the card's top (baselines for text).
    const ICON = 36;
    const titleY = SCRAP_PAD + 20;
    const iconTop = titleY + 12;
    const countY = iconTop + ICON + 6 + 14;
    const barY = countY + 14;
    const bestY = barY + 27;
    const hintY = bestY + 23;
    const LINE = 19;
    const h = hintY + (hintLines.length - 1) * LINE + 5 + SCRAP_PAD;
    const y0 = standalone ? H * 0.46 : Math.max(H * 0.42, Math.min(H * 0.5, bottom - h));
    const x0 = left + SCRAP_PAD;
    ctx.globalAlpha = a;
    scrap(left, y0, w, h, 91, true, 0.97 * a);
    ctx.globalAlpha = a;
    const st = game.stats;
    write(ctx, "what I ate:", x0, y0 + titleY, bold(24), INK, 92, { alpha: a });
    const room = inner - textW("what I ate:", bold(24)) - 12;
    let tally = `${st.eaten} doodles${st.erasersEaten ? ` + ${st.erasersEaten} eraser${st.erasersEaten > 1 ? "s" : ""}` : ""}`;
    if (textW(tally, hand(15)) > room) tally = `${st.eaten + st.erasersEaten} eaten`;
    write(ctx, tally, right - SCRAP_PAD, y0 + titleY, hand(fitSize(tally, hand, 18, room, 14)), PAL.inkDeep, 93, { align: "right", alpha: a });
    // The menu: biggest kinds first, up to six, each scaled into the same box, its count underneath.
    const kinds = KINDS.map((k, i) => ({ i, n: st.tally[i]!, tier: k.tier })).filter((e) => e.n > 0);
    kinds.sort((p, q) => q.tier - p.tier || q.n - p.n);
    const shown = kinds.slice(0, Math.max(1, Math.min(6, Math.floor(inner / 52))));
    const cell = inner / Math.max(4, shown.length);
    shown.forEach((e, j) => {
      const cx = x0 + cell * (j + 0.5);
      const top = y0 + iconTop;
      ctx.globalAlpha = a;
      ctx.drawImage(cardIcon(e.i, ICON), cx - ICON / 2, top, ICON, ICON);
      ctx.globalAlpha = 1;
      write(ctx, `×${e.n}`, cx, y0 + countY, bold(17), INK, 94 + j, { align: "center", alpha: a, wobble: 0.4 });
    });
    const prev = info.prevBest;
    ctx.fillStyle = "rgba(36,65,154,0.12)";
    ctx.fillRect(x0, y0 + barY, inner, 6);
    const scored = info.score > 0;
    const frac = !scored ? 0 : info.isBest ? 1 : prev ? clamp(info.score / prev) : 1;
    const grow = easeOutCubic(clamp((t - 0.8) / 0.8));
    if (frac > 0) highlight(ctx, x0, y0 + barY - 2, Math.max(4, inner * frac * grow), 10, 95, info.isBest ? ACCENT : "#9CC8F2", 0.9);
    ctx.globalAlpha = a;
    const lineText = !scored
      ? "nothing yet. drag to steer the hole"
      : info.isBest
        ? prev
          ? `new best! +${fmt(info.score - prev)} on your old one`
          : "first score on the page"
        : `${Math.round(frac * 100)}% of your best (${fmt(prev ?? 0)})`;
    write(ctx, lineText, x0, y0 + bestY, bold(fitSize(lineText, bold, 19, inner, 14)), info.isBest && scored ? RED : INK, 96, { alpha: a, wobble: 0.4 });
    hintLines.forEach((l, i) => write(ctx, l, x0, y0 + hintY + i * LINE, hand(17), PAL.inkDeep, 120 + i, { alpha: a, wobble: 0.4 }));
    ctx.globalAlpha = 1;
    if (standalone && t > 1) {
      write(ctx, fmt(info.score), W / 2, H * 0.32, bold(64), INK, 97, { align: "center" });
      if (info.isBest && info.score > 0) write(ctx, "new best!", W / 2, H * 0.32 + 34, bold(26), RED, 98, { align: "center" });
      const py = Math.min(H - 30, y0 + h + 34);
      scrap(W / 2 - 110, py - 24, 220, 44, 99, false, 0.96);
      highlight(ctx, W / 2 - 86, py - 11, 172, 22, 100, ACCENT, 0.5);
      write(ctx, "tap to doodle again", W / 2, py + 8, bold(26), INK, 101, { align: "center" });
    }
  }

  /**
   * A doodle for the results card, drawn once in ink at the card's exact scale (a 1.6 px pen), so even a crumb is
   * crisp; scaled so its reach (about 1.1 radii with flags, tentacles and smoke) fits the box, and clipped to it.
   */
  const icons = new Map<string, HTMLCanvasElement>();
  function cardIcon(k: number, box: number): HTMLCanvasElement {
    const key = `${k}:${box}:${dpr}`;
    let c = icons.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = Math.ceil(box * dpr);
    const g = c.getContext("2d")!;
    const sz = box / 2 / (KINDS[k]!.s * 1.12);
    g.setTransform(dpr * sz, 0, 0, dpr * sz, c.width / 2, c.height / 2);
    drawKind(g, k, 900, 1.6 / sz);
    icons.set(key, c);
    return c;
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

  // -------------------------------------------------------------------------------------------------------------
  // Go
  // -------------------------------------------------------------------------------------------------------------
  resetRun("attract");
  // Let the demo get going before the first frame, so attract opens mid-meal.
  for (let i = 0; i < 90; i++) stepOnce();
  camX = game.hole.x;
  camY = game.hole.y;
  camView.snap(game.view * CAM_K * 1.05);
  let frames = 0;
  titlePop.target = 1;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    drawWorld();
    drawHud();
    if (++frames === 2) session.ready();
  });
  session.on("insets", () => titlePop.kick(3));
}

void main();
