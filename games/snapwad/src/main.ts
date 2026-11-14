/**
 * Snapwad: my doodles built forts on my textbooks, and I have two pencils stuck in an eraser with a rubber band
 * between them. Pull back anywhere on the page, let go, and the paper wad flies; knock every doodle out (hit it,
 * tip it over, knock it off the books) and the page turns to a harder fort. Wads come back for direct hits, every
 * two other knock-outs, chains and big topples; the run ends when they're gone.
 */
import { createAudio } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp, Spring } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { aimFromDrag, DRAG_DEAD, DRAG_FULL, firstHit, flightPath } from "./aim.ts";
import { bakePieces, box, COL, drawBook, drawCase, drawMite, drawPost, MITE_FILL, starPts, type MiteLook, type PieceSprites } from "./art.ts";
import { AGAIN, bestLine, CARD, LINES, NEWS, NOTES, pagesLine, statLine, SUBTITLE, TAP, TITLE } from "./copy.ts";
import { Fx } from "./fx.ts";
import { DRAW_T, HINTS, KO_PER_WAD, MAX_WADS, Run, STEP, TOPPLE_N, TURN_T, type Ev } from "./game.ts";
import { begin, bold, boil, doodleArrow, ellipse, ellipsePts, fillBuf, hand, highlight, ink, line, PAL, pt, updateBoil, write } from "./ink.ts";
import { BASE, CASE, POSTS, REST, VIEW_W, type Layout } from "./pages.ts";
import { renderPaper, type PageGeom } from "./paper.ts";
import type { Thing } from "./physics.ts";
import { isMite, isShot, MITES, PIECES, type MiteKind } from "./pieces.ts";
import { Pilot, SKILLS, type Skill } from "./pilot.ts";
import { chainNote, knockOf, S } from "./sound.ts";
import { fmt, loadType } from "./type.ts";

const ACCENT = "#12A4A0";
const BAND = "#0E8C88";
const INK = PAL.ink;
const RED = PAL.red;
/** The world below the desk line that the view shows (the desk's hatched edge), in metres. */
const DESK_BAND = 0.62;
/** How far the wad is drawn back at a full pull (metres). */
const PULL_LEN = 1.45;
/** The trajectory preview shows this much of the flight (metres of path). */
const PREVIEW_LEN = 2.7;
/** Slow motion on the last doodle: time scale, and how long it holds (real seconds). */
const SLOW_SCALE = 0.28;
const SLOW_HOLD = 0.95;
/** The attract demo: a good thumb that never dawdles. */
const DEMO: Skill = { ...SKILLS.good, name: "demo", think: [0.9, 1.5], bias: 0 };
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good`); a normal build has none. */
const QA_AUTOPLAY: Skill | null = (SKILLS as Record<string, Skill>)[import.meta.env.VITE_AUTOPLAY ?? ""] ?? null;
/** QA builds can put the longest hint on every game-over card (`VITE_QA_HINT=longest`); a normal build has none. */
const QA_HINT: string | null = import.meta.env.VITE_QA_HINT === "longest" ? Object.values(HINTS).reduce((p, q) => (q.length > p.length ? q : p)) : null;
const SCRAP_CORNER = 6;
const SCRAP_WOBBLE = 2;
const SCRAP_PAD = SCRAP_CORNER + SCRAP_WOBBLE + 8;


interface Banner {
  text: string;
  sub: string;
  t: number;
  life: number;
  big: boolean;
  color: string;
  seed: number;
}

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

async function main() {
  const [session] = await Promise.all([createSession({ id: "snapwad" }), loadType()]);
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
  const shake = new Shake(8, 0.01, 1.9, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.14, decay: 0.45 });
  const under = new Fx(80);
  const over = new Fx(360);
  const ui = new Fx(200);
  const band = new Spring(0, 520, 11);
  const scorePop = new Spring(1, 420, 14);
  const wadPop = new Spring(1, 420, 12);
  const titlePop = new Spring(0, 150, 12);

  // ---------------------------------------------------------------------------------------------------------------
  // Layout: the world is VIEW_W metres across; the desk line sits a hand's width above the bottom.
  // ---------------------------------------------------------------------------------------------------------------
  let k = 1;
  let ox = 0;
  let deskY = 0;
  let geom: PageGeom = { W, H, deskY, marginX: 50, rule0: 60, ruleGap: 28 };
  let sprites: PieceSprites;
  let pageLayer: HTMLCanvasElement | null = null;
  let pageLayerFor: Layout | null = null;
  function layout() {
    W = cv.width;
    H = cv.height;
    dpr = cv.dpr;
    k = Math.min(W / VIEW_W, H / 15.4);
    ox = (W - VIEW_W * k) / 2;
    deskY = Math.round(H - DESK_BAND * k);
    geom = { W, H, deskY, marginX: Math.round(clamp(W * 0.13, 40, 56)), rule0: 34, ruleGap: Math.round(k * 0.58) };
    sprites = bakePieces(k, dpr);
    pageLayer = null;
  }
  layout();
  cv.onResize(() => layout());

  const sx = (x: number) => ox + x * k;
  const sy = (y: number) => deskY - y * k;

  // ---------------------------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let run = new Run(rng.int(1, 1e9), { startPage: 2 });
  let demo = new Pilot(DEMO, createRng(rng.int(1, 1e9)));
  let qa: Pilot | null = null;
  let acc = 0;
  let alpha = 0;
  let time = 0;
  let timeScale = 1;
  let slowT = -1;
  let slowHold = SLOW_HOLD;
  let banners: Banner[] = [];
  let floats: Float[] = [];
  let shownScore = 0;
  let celebratedBest = false;
  let endInfo: { score: number; best: number | null; isBest: boolean; prevBest: number | null } | null = null;
  let tally: Record<MiteKind, number> = { tick: 0, stub: 0, lanky: 0 };
  let demoAge = 0;
  let fade = 0;
  let drainSaid = false;
  let firstTape = true;
  let firstStar = true;
  let lastKnock = -9;
  let lastFireT = -9;
  let shotsThisRun = 0;
  let cancelNote = -9;
  /** Squash springs per doodle id. */
  const squash = new Map<number, Spring>();
  const blinkAt = new Map<number, number>();
  let looking: { x: number; y: number } | null = null;

  // Aiming (a real thumb, or the pilot's).
  let aim: { id: number; x0: number; y0: number; dx: number; dy: number; max: number; notch: number } | null = null;

  function resetRun(m: "attract" | "play") {
    mode = m;
    run = m === "attract" ? new Run(rng.int(1, 1e9), { startPage: rng.int(2, 4) }) : new Run(rng.int(1, 1e9));
    demo = new Pilot(DEMO, createRng(rng.int(1, 1e9)));
    qa = m === "play" && QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(rng.int(1, 1e9))) : null;
    under.clear();
    over.clear();
    ui.clear();
    banners = [];
    floats = [];
    shownScore = 0;
    celebratedBest = false;
    endInfo = null;
    tally = { tick: 0, stub: 0, lanky: 0 };
    demoAge = 0;
    acc = 0;
    timeScale = 1;
    slowT = -1;
    aim = null;
    drainSaid = false;
    shotsThisRun = 0;
    squash.clear();
    pageLayer = null;
    for (const ev of run.events) onEvent(ev);
    run.events.length = 0;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Input: a tap starts the run; then press anywhere, pull back, let go.
  // ---------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  const canAim = () => mode === "play" && session.phase === "playing" && !qa && run.ammo > 0 && (run.phase === "play" || run.phase === "draw");
  window.addEventListener("pointerdown", (e) => {
    if (!canAim() || aim) return;
    aim = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, max: 0, notch: 0 };
  });
  window.addEventListener("pointermove", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const x = evs.length ? evs[evs.length - 1]!.clientX : e.clientX;
    const y = evs.length ? evs[evs.length - 1]!.clientY : e.clientY;
    pull(x - aim.x0, y - aim.y0);
  });
  window.addEventListener("pointerup", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    const a = aim;
    aim = null;
    if (mode === "play") letGo(a.dx, a.dy, a.max);
  });
  window.addEventListener("pointercancel", (e) => {
    if (aim && e.pointerId === aim.id) aim = null;
  });
  session.on("cancel", () => {
    aim = null;
  });
  session.on("start", () => {
    resetRun("play");
    audio.play(S.click);
  });
  session.on("resume", () => {
    acc = 0;
  });

  /** The thumb moved: stretch the band, creak a notch at a time. */
  function pull(dx: number, dy: number) {
    if (!aim) return;
    aim.dx = dx;
    aim.dy = dy;
    const len = Math.hypot(dx, dy);
    aim.max = Math.max(aim.max, len);
    const notch = Math.floor(clamp((len - DRAG_DEAD) / DRAG_FULL) * 6);
    if (notch > aim.notch) audio.play(S.creak, { pitch: notch * 1.6, volume: vol() });
    aim.notch = notch;
  }

  /** The thumb came up: fire (through the same release the pilot uses), or say it was a cancel. */
  function letGo(dx: number, dy: number, max: number) {
    const fired = run.release(dx, dy);
    if (!fired && max > DRAG_DEAD && Math.hypot(dx, dy) < DRAG_DEAD && run.ammo > 0) {
      cancelNote = time;
      audio.play(S.click, { pitch: -8 });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Events from the run
  // ---------------------------------------------------------------------------------------------------------------
  const loud = () => mode === "play";
  const vol = () => (mode === "play" ? 1 : 0.35);

  function banner(text: string, sub: string, big: boolean, color: string = INK, life = big ? 1.6 : 1.25) {
    if (!loud()) return;
    if (!big && banners.some((b) => b.big && b.t < b.life * 0.6)) {
      banners.push({ text, sub, t: -0.6, life, big, color, seed: rng.int(1, 9999) });
      return;
    }
    banners = banners.filter((b) => b.t < 0);
    banners.unshift({ text, sub, t: 0, life, big, color, seed: rng.int(1, 9999) });
  }

  function float(text: string, x: number, y: number, color: string, size = 22, life = 1.0) {
    floats.push({ text, x, y, t: 0, life, color, size, seed: rng.int(1, 9999) });
    if (floats.length > 14) floats.shift();
  }

  function confetti(y: number) {
    const cols = [ACCENT, PAL.hiYellow, "#FF9CCB", "#9CC8F2"];
    ui.bit("star", W * 0.12, H * y, { count: 14, speed: [220, 460], angle: [-Math.PI * 0.45, -Math.PI * 0.1], life: [0.9, 1.4], size: [5, 9], colors: cols, grav: 620, drag: 1.4 });
    ui.bit("star", W * 0.88, H * y, { count: 14, speed: [220, 460], angle: [-Math.PI * 0.9, -Math.PI * 0.55], life: [0.9, 1.4], size: [5, 9], colors: cols, grav: 620, drag: 1.4 });
  }

  function onEvent(ev: Ev) {
    switch (ev.t) {
      case "fire": {
        band.value = 1;
        band.velocity = 0;
        band.target = 0;
        band.kick(-12);
        audio.play(S.twang, { volume: vol() * (0.6 + ev.power * 0.5), pitch: ev.power * 3 });
        audio.play(S.twangHi, { volume: vol() });
        audio.play(S.whoosh, { volume: vol() * ev.power, pitch: ev.power * 4 });
        if (ev.kind === "tape") audio.play(S.tape, { volume: vol() });
        over.bit("scrap", sx(REST.x), sy(REST.y), { count: 3, speed: [60, 140], life: [0.3, 0.5], size: [2, 3.5], colors: [PAL.paper], drag: 4, grav: 300 });
        shake.add(0.06 + ev.power * 0.05);
        wadPop.kick(-4);
        lastFireT = time;
        if (loud()) {
          shotsThisRun++;
          if (!(hintSeen & 1) && shotsThisRun >= 2) {
            hintSeen |= 1;
            tc.storage.set("hint", hintSeen).catch(() => undefined);
          }
        }
        break;
      }
      case "impact": {
        const shot = ev.a === "wad" || ev.b === "wad" || ev.a === "tape" || ev.b === "tape";
        const other = ev.a === "wad" || ev.a === "tape" ? ev.b : ev.a;
        if (time - lastKnock > 0.035 || ev.speed > 6) {
          lastKnock = time;
          audio.play(knockOf(shot ? other : (ev.a ?? ev.b)), { volume: vol() * clamp(ev.speed / 9, 0.15, 1), pitch: (rng() - 0.5) * 3 });
        }
        if (shot && ev.speed > 3) {
          audio.play(S.thump, { volume: vol() * clamp(ev.speed / 14) });
          over.mark("burst", sx(ev.x), sy(ev.y), clamp(ev.speed * 1.6, 8, 24), INK, 0.3);
        }
        if (ev.speed > 3.5) under.mark("puff", sx(ev.x), sy(ev.y), clamp(ev.speed * 1.4, 6, 20), PAL.graphite, 0.45);
        if (shot && ev.speed > 8) {
          hitStop.freeze(reduced ? 0 : 0.04);
          shake.add(Math.min(0.3, ev.speed * 0.02));
        } else if (ev.speed > 6) shake.add(0.05);
        break;
      }
      case "ko": {
        const th = ev.th;
        const p = th.body.getPosition();
        audio.play(S.eep, { volume: vol(), pitch: (rng() - 0.5) * 4 + (th.kind === "lanky" ? -3 : th.kind === "tick" ? 3 : 0) });
        window.setTimeout(() => audio.play(S.scribble, { volume: vol() }), 140);
        if (ev.chain >= 2) chainNote(audio, ev.chain, vol());
        float(`+${fmt(ev.pts)}`, sx(p.x), sy(p.y) - 26, ev.chain >= 2 ? RED : INK, ev.chain >= 2 ? 26 : 22);
        over.bit("dot", sx(p.x), sy(p.y), { count: 8, speed: [80, 220], life: [0.3, 0.6], size: [1.5, 3], colors: [INK, MITE_FILL[th.kind as MiteKind]], drag: 3, grav: 500 });
        shake.add(0.08);
        hitStop.freeze(reduced ? 0 : 0.03);
        if (loud()) tally[th.kind as MiteKind]++;
        if (ev.last) slowHold = Math.max(slowHold, (slowT >= 0 ? slowT : 0) + 0.45);
        bestCheck();
        break;
      }
      case "erase": {
        over.mark("puff", sx(ev.x), sy(ev.y), 16, INK, 0.5);
        over.bit("dot", sx(ev.x), sy(ev.y), { count: 10, speed: [40, 140], life: [0.4, 0.8], size: [1.2, 2.6], colors: [INK, PAL.red], drag: 3, grav: 200 });
        squash.delete(ev.th.id);
        break;
      }
      case "snap": {
        audio.play(S.snap, { volume: vol() });
        audio.play(S.snapLow, { volume: vol() });
        over.bit("shaving", sx(ev.x), sy(ev.y), { count: 7, speed: [80, 240], life: [0.6, 1.1], size: [2, 4], colors: [COL.wood, COL.pencil], drag: 2, grav: 700 });
        over.bit("scrap", sx(ev.x), sy(ev.y), { count: 4, speed: [80, 200], life: [0.4, 0.8], size: [1.5, 3], colors: [COL.pencil], drag: 2, grav: 700 });
        hitStop.freeze(reduced ? 0 : 0.035);
        shake.add(0.12);
        break;
      }
      case "burst": {
        audio.play(ev.kind === "pad" ? S.burst : S.crumple, { volume: vol() });
        if (ev.kind === "pad") over.bit("note", sx(ev.x), sy(ev.y), { count: 9, speed: [120, 300], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [1.0, 1.7], size: [5, 7], colors: [COL.pad, "#FFF2A8"], drag: 2.5, grav: 260 });
        else over.bit("scrap", sx(ev.x), sy(ev.y), { count: 10, speed: [100, 260], life: [0.5, 1], size: [3, 6], colors: [PAL.paper], drag: 2.5, grav: 600 });
        shake.add(0.1);
        break;
      }
      case "refund": {
        if (ev.n > 0) {
          audio.play(S.refund, { volume: vol() });
          wadPop.kick(7);
        }
        if (loud()) {
          if (ev.why === "chain") banner(LINES.chainWad[0], LINES.chainWad[1], false, INK);
          else if (ev.why === "topple") banner(LINES.topple[0], LINES.topple[1], true, INK);
          else if (ev.why === "direct") float(ev.n > 0 ? NOTES.wadBack : NOTES.full, sx(REST.x) + 34, sy(POSTS.l.y) - 22, BAND, 19, 1);
          else float(ev.n > 0 ? NOTES.plusWad : NOTES.full, sx(REST.x) + 34, sy(POSTS.l.y) - 22, BAND, 19, 1);
        }
        break;
      }
      case "chain":
        audio.play(S.chain, { volume: vol(), pitch: (ev.n - 2) * 2 });
        if (loud()) {
          if (ev.n >= 3) banner(ev.name, `${ev.n} with one wad`, true, RED);
          else float(ev.name, W / 2, H * 0.44, RED, 30, 1.2);
          if (ev.n >= 3) session.feedback("success");
        }
        shake.add(0.06 * ev.n);
        hitStop.freeze(reduced ? 0 : 0.03 + 0.01 * ev.n);
        break;
      case "topple":
        audio.play(S.topple, { volume: vol() });
        shake.add(0.32);
        if (loud()) {
          if (ev.n > TOPPLE_N) banner(ev.name, `${ev.n} pieces off the books`, true, RED);
          session.feedback("impact");
        }
        break;
      case "star":
        audio.play(S.star, { volume: vol() });
        over.bit("star", sx(ev.x), sy(ev.y), { count: 14, speed: [120, 320], life: [0.6, 1.1], size: [3, 6], colors: ["#FFD23F", ACCENT], drag: 2.5, grav: 300 });
        if (loud()) {
          banner(LINES.star[0], (firstStar ? LINES.star : LINES.starAgain)[1], true, INK, 2);
          firstStar = false;
        }
        break;
      case "tape":
        if (loud()) {
          banner(LINES.tape[0], (firstTape ? LINES.tape : LINES.tapeAgain)[1], false, INK, 1.8);
          firstTape = false;
        }
        break;
      case "clear": {
        audio.play(ev.oneShot ? S.oneShot : S.clear, { volume: vol() });
        flash.trigger(ev.oneShot ? ACCENT : PAL.hiYellow, ev.oneShot ? 1 : 0.7);
        hitStop.freeze(reduced ? 0 : 0.08);
        shake.add(0.25);
        if (loud()) {
          banner(ev.oneShot ? LINES.oneShot[0] : `page ${ev.page} done!`, `+${fmt(ev.pts)}`, true, ev.oneShot ? RED : INK, 1.5);
          confetti(0.34);
          session.feedback("success");
        }
        bestCheck();
        break;
      }
      case "turn":
        audio.play(S.turn, { volume: vol() });
        break;
      case "page": {
            pageLayer = null;
        squash.clear();
        if (loud()) {
          for (const n of ev.news) {
            const news = NEWS[n];
            if (news) banner(news[0], news[1], false, INK, 2.1);
          }
        }
        break;
      }
      case "lastStand":
        if (slowT < 0) {
          slowT = 0;
          slowHold = SLOW_HOLD;
          audio.play(S.slow, { volume: vol() });
          looking = null;
        }
        break;
      case "drain":
        audio.play(S.drain, { volume: vol() });
        wadPop.kick(-6);
        if (loud() && !drainSaid) {
          drainSaid = true;
          banner(LINES.drain[0], LINES.drain[1], false, RED, 2);
        }
        break;
      case "spent":
        over.mark("puff", sx(ev.th.body.getPosition().x), sy(ev.th.body.getPosition().y), 10, PAL.graphite, 0.4);
        break;
      case "done":
        if (loud()) endRun();
        else attractRestart();
        break;
      case "drawn":
      case "off":
      case "meter":
        break;
    }
  }

  function bestCheck() {
    if (!loud()) return;
    const best = session.best;
    if (!celebratedBest && best !== null && best > 0 && run.score > best) {
      celebratedBest = true;
      banner(LINES.best[0], LINES.best[1], false, RED);
      audio.play(S.best);
      confetti(0.3);
      session.feedback("success");
    }
  }

  function endRun() {
    const prevBest = session.best;
    const st = run.stats;
    const r = session.end(run.score, {
      stats: { pages: st.pages, knockouts: st.kos, shots: st.shots, chain: st.bestChain, oneShots: st.oneShots },
    });
    endInfo = { score: run.score, best: r.best, isBest: r.isBest, prevBest };
    aim = null;
    audio.play(S.out, { volume: 1 });
    if (r.isBest && run.score > 0) {
      audio.play(S.best);
      confetti(0.55);
    }
  }

  function attractRestart() {
    if (fade <= 0) fade = 0.0001;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The fixed step
  // ---------------------------------------------------------------------------------------------------------------
  function stepOnce() {
    if (mode === "attract") {
      const rel = demo.update(run, STEP);
      if (rel) run.release(rel.dx, rel.dy);
    } else if (session.phase === "playing") {
      if (qa) {
        const rel = qa.update(run, STEP);
        if (rel) letGo(rel.dx, rel.dy, Math.hypot(rel.dx, rel.dy));
      }
    } else if (run.phase === "done") return;
    run.step();
    for (const ev of run.events) onEvent(ev);
    run.events.length = 0;
  }

  function update(rawDt: number) {
    time += rawDt;
    session.tick(rawDt);
    updateBoil(time, reduced);
    // Slow motion on the last doodle: in fast, hold, ease back.
    if (slowT >= 0) {
      slowT += rawDt;
      const out = slowT - slowHold;
      timeScale = out < 0 ? SLOW_SCALE : lerp(SLOW_SCALE, 1, clamp(out / 0.35));
      if (out > 0.35) {
        slowT = -1;
        timeScale = 1;
      }
    }
    const dt = hitStop.scale(rawDt) * timeScale;
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) {
      stepOnce();
      acc -= STEP;
      n++;
    }
    if (n === 6) acc = 0;
    alpha = clamp(acc / STEP);

    shake.update(rawDt);
    flash.update(rawDt);
    under.update(rawDt);
    over.update(rawDt * timeScale);
    ui.update(rawDt);
    band.update(rawDt);
    scorePop.update(rawDt);
    wadPop.update(rawDt);
    titlePop.update(rawDt);
    for (const sp of squash.values()) sp.update(rawDt * timeScale);
    for (const b of banners) b.t += rawDt;
    if (banners.some((b) => b.t > b.life)) banners = banners.filter((b) => b.t <= b.life);
    if (banners.length > 1 && banners[0]!.t > banners[0]!.life * 0.6 && banners[1]!.t < 0) banners[1]!.t = 0;
    for (const f of floats) {
      f.t += rawDt;
      f.y -= rawDt * 26;
    }
    if (floats.some((f) => f.t > f.life)) floats = floats.filter((f) => f.t <= f.life);
    const sd = run.score - shownScore;
    if (sd > 0) {
      shownScore += Math.max(1, sd * (1 - Math.exp(-12 * rawDt)));
      if (shownScore >= run.score) {
        shownScore = run.score;
        scorePop.kick(3);
      }
    } else shownScore = run.score;
    // The pilot's thumb shows its pull like a real one.
    const p = mode === "attract" ? demo : qa;
    if (p && p.down) {
      if (!aim) aim = { id: -1, x0: W * p.ax, y0: H * p.ay, dx: 0, dy: 0, max: 0, notch: 0 };
      pull(p.dx, p.dy);
    } else if (aim && aim.id === -1) aim = null;
    // Attract: start over with a fresh run now and then.
    if (mode === "attract") {
      demoAge += rawDt;
      if ((demoAge > 34 || run.page >= 6) && fade <= 0 && run.phase === "draw") attractRestart();
    }
    if (fade > 0) {
      fade += rawDt;
      if (fade >= 0.45 && mode === "attract" && demoAge > 1) resetRun("attract");
      if (fade >= 0.9) fade = 0;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Drawing the world (screen px; the world maps x -> ox + x k, y -> deskY - y k)
  // ---------------------------------------------------------------------------------------------------------------
  function bakePage(l: Layout): HTMLCanvasElement {
    const paper = renderPaper(geom, dpr, l.page + (l.seed % 5));
    const c = paper.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const pile of l.piles) {
      pile.books.forEach((b, i) => drawBook(c, b, sx(b.x0), sy(b.y1), sx(b.x1), sy(b.y0), 300 + i * 17 + Math.round(b.x0 * 10)));
    }
    BASE.forEach((b, i) => drawBook(c, b, sx(b.x0), sy(b.y1), sx(b.x1), sy(b.y0), 200 + i * 23));
    drawCase(c, sx(CASE.x0), sy(CASE.top), sx(CASE.x1), sy(CASE.bottom), 0);
    return paper;
  }

  /** World transform for a body at (x, y) with world angle a. */
  function bodyT(x: number, y: number, a: number, o: { x: number; y: number }) {
    const c = Math.cos(-a);
    const s = Math.sin(-a);
    ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * (sx(x) + o.x), dpr * (sy(y) + o.y));
  }

  function pos(th: Thing): { x: number; y: number; a: number } {
    const p = th.body.getPosition();
    let a = th.body.getAngle();
    let pa = th.pa;
    // Interpolate the shorter way round.
    while (a - pa > Math.PI) pa += Math.PI * 2;
    while (pa - a > Math.PI) pa -= Math.PI * 2;
    a = lerp(pa, a, alpha);
    return { x: lerp(th.px, p.x, alpha), y: lerp(th.py, p.y, alpha), a };
  }

  /** How far into the page's drawing-in a piece is (0 = not drawn yet, 1 = done). */
  function drawnIn(i: number, n: number): number {
    if (run.phase !== "draw") return 1;
    const t = run.phaseT;
    const t0 = (i / Math.max(1, n)) * DRAW_T * 0.72;
    return clamp((t - t0) / (DRAW_T * 0.28));
  }

  function drawWorld() {
    const o = shake.offset;
    if (!pageLayer || pageLayerFor !== run.layout) {
      pageLayer = bakePage(run.layout);
      pageLayerFor = run.layout;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(pageLayer, Math.round(o.x * dpr * 0.4), Math.round(o.y * dpr * 0.4));
    ctx.setTransform(dpr, 0, 0, dpr, o.x, o.y);
    under.drawMarks(ctx, 1, boil.step);
    // The star sticker.
    if (run.layout.star && run.desk.hasStar) drawStar(sx(run.layout.star.x) + o.x, sy(run.layout.star.y) + o.y);
    // Pieces in the order the page drew them; doodles on top; shots last.
    const things = run.desk.things;
    let n = 0;
    for (const th of things) if (!th.gone && !isShot(th.kind)) n++;
    let i = 0;
    for (const th of things) {
      if (th.gone || isShot(th.kind) || isMite(th.kind)) continue;
      const d = drawnIn(i++, n);
      if (d <= 0) continue;
      const q = pos(th);
      const sp = sprites[th.kind as keyof PieceSprites]![(boil.step + th.id) % 3]!;
      bodyT(q.x, q.y, q.a, o);
      if (d < 1) penReveal(sp.w, sp.h, d);
      ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      if (d < 1) ctx.restore();
    }
    const wad = liveShot();
    looking = wad ? { x: wad.x, y: wad.y } : null;
    for (const th of things) {
      if (th.gone || !isMite(th.kind)) continue;
      const d = drawnIn(i++, n);
      if (d <= 0) continue;
      const q = pos(th);
      bodyT(q.x, q.y, q.a, o);
      if (d < 1) penReveal(MITES[th.kind as MiteKind].hw * 2 * k + 12, MITES[th.kind as MiteKind].hh * 2 * k + 16, d);
      drawMite(ctx, th.kind as MiteKind, k, th.s, lookOf(th, q));
      if (d < 1) ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, o.x, o.y);
    drawLauncher();
    for (const th of things) {
      if (th.gone || !isShot(th.kind)) continue;
      const q = pos(th);
      const sp = sprites[th.kind as "wad" | "tape"]![(boil.step + th.id) % 3]!;
      bodyT(q.x, q.y, q.a, o);
      ctx.globalAlpha = th.age > 7 ? clamp(1 - (th.age - 7) / 1.5) : 1;
      ctx.drawImage(sp.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
      ctx.globalAlpha = 1;
      // Speed lines behind a fast shot.
      const v = th.body.getLinearVelocity();
      const sp2 = Math.hypot(v.x, v.y);
      if (sp2 > 8 && th.age < 2) {
        ctx.setTransform(dpr, 0, 0, dpr, o.x, o.y);
        const ux = v.x / sp2;
        const uy = v.y / sp2;
        for (let j = -1; j <= 1; j++) {
          const px = sx(q.x) - ux * k * 0.32 + uy * j * 5;
          const py = sy(q.y) + uy * k * 0.32 + ux * j * 5;
          line(ctx, px, py, px - ux * sp2 * 1.6, py + uy * sp2 * 1.6, 600 + j, { width: 1, passes: 1, color: "rgba(36,65,154,0.45)", jitter: 0.3 });
        }
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, o.x, o.y);
    over.drawMarks(ctx, 1, boil.step);
    over.drawBits(ctx, 1);
    for (const f of floats) {
      const kf = f.t / f.life;
      const a = kf < 0.15 ? kf / 0.15 : 1 - Math.max(0, (kf - 0.6) / 0.4);
      const pop = f.t < 0.15 ? easeOutBack(f.t / 0.15) : 1;
      ctx.save();
      ctx.translate(f.x + o.x, f.y + o.y);
      ctx.scale(pop, pop);
      ctx.globalAlpha = a;
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(251,248,239,0.9)";
      ctx.font = bold(f.size);
      ctx.textAlign = "center";
      ctx.strokeText(f.text, 0, 0);
      ctx.restore();
      write(ctx, f.text, f.x + o.x, f.y + o.y, bold(f.size * pop), f.color, f.seed, { align: "center", alpha: a });
    }
    ctx.globalAlpha = 1;
  }

  /** Clip to a pen sweep that has gone `d` of the way round a w x h box (call ctx.restore after). */
  function penReveal(w: number, h: number, d: number) {
    ctx.save();
    const r = Math.hypot(w, h) * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + d * Math.PI * 2);
    ctx.closePath();
    ctx.clip();
  }

  function liveShot(): { x: number; y: number } | null {
    for (let j = run.desk.things.length - 1; j >= 0; j--) {
      const th = run.desk.things[j]!;
      if (!th.gone && isShot(th.kind) && th.age < 2.5) {
        const p = th.body.getPosition();
        return { x: p.x, y: p.y };
      }
    }
    return null;
  }

  function lookOf(th: Thing, q: { x: number; y: number; a: number }): MiteLook {
    let sp = squash.get(th.id);
    if (!sp) {
      sp = new Spring(1, 380, 9);
      squash.set(th.id, sp);
    }
    // An impact squashes it (the run recorded the last hit on u0).
    const v = th.body.getLinearVelocity();
    const moving = Math.hypot(v.x, v.y) > 0.6 || Math.abs(th.body.getAngularVelocity()) > 1;
    if (moving && Math.abs(sp.velocity) < 0.5 && sp.value > 0.99) sp.kick(-2.5);
    let lx = 0;
    let ly = 0;
    const tgt = looking ?? (aim ? { x: REST.x, y: REST.y } : null);
    if (tgt) {
      const dx = tgt.x - q.x;
      const dy = -(tgt.y - q.y);
      const d = Math.hypot(dx, dy) || 1;
      // Into the doodle's own frame (it may be tipped).
      const c = Math.cos(q.a);
      const s = Math.sin(q.a);
      lx = (dx * c - dy * s) / d;
      ly = (dx * s + dy * c) / d;
    }
    let next = blinkAt.get(th.id) ?? time + 1 + (th.id % 7) * 0.4;
    if (time > next + 0.14) {
      next = time + 2.2 + ((th.id * 37) % 23) / 8;
      blinkAt.set(th.id, next);
    }
    const blink = time > next && time < next + 0.14 ? 1 : 0;
    const out = th.out >= 0;
    return {
      lx,
      ly,
      mood: out ? "out" : moving || (looking && Math.hypot(looking.x - q.x, looking.y - q.y) < 2.2) ? "worried" : "idle",
      blink: out ? 0 : blink,
      scribble: out ? clamp((run.desk.time - th.out - 0.08) / 0.36) : 0,
      squash: clamp(sp.value, 0.6, 1.3),
      step: boil.step,
      seed: 400 + th.id * 13,
    };
  }

  function drawStar(x: number, y: number) {
    const pulse = light.pulse(time, 0.8, { still: 0.5 });
    const r = 0.42 * k * (0.92 + 0.08 * pulse);
    starPts(x, y, r, r * 0.45, Math.sin(time * 1.3) * 0.12);
    fillBuf(ctx, "#FFD23F");
    ink(ctx, 777, { width: 1.8, jitter: 0.6, closed: true });
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    line(ctx, x + r * 0.9, y - r * 1.1, x + r * 1.25, y - r * 1.45, 778, { width: 1.4, passes: 1, color: ACCENT });
    line(ctx, x + r * 1.2, y - r * 0.75, x + r * 1.6, y - r * 0.8, 779, { width: 1.4, passes: 1, color: ACCENT });
    ctx.globalAlpha = 1;
  }

  /** The pulled-back wad position (world), if a thumb is pulling. */
  function pulled(): { x: number; y: number; power: number; angle: number } | null {
    if (!aim) return null;
    const a = aimFromDrag(aim.dx, aim.dy);
    if (!a) return null;
    return { x: REST.x - Math.cos(a.angle) * a.power * PULL_LEN, y: REST.y - Math.sin(a.angle) * a.power * PULL_LEN, power: a.power, angle: a.angle };
  }

  const PATH = new Float64Array(2 * 400);

  function drawLauncher() {
    const step = boil.step;
    // The eraser the pencils are stuck in.
    const ex0 = sx(0.8);
    const ex1 = sx(2.44);
    const ey0 = sy(CASE.top + 0.46);
    const ey1 = sy(CASE.top);
    ctx.fillStyle = COL.eraser;
    ctx.fillRect(ex0, ey0, ex1 - ex0, ey1 - ey0);
    ctx.fillStyle = COL.eraserLight;
    ctx.fillRect(ex0 + 3, ey0 + 2, ex1 - ex0 - 6, (ey1 - ey0) * 0.35);
    box(ctx, ex0, ey0, ex1 - ex0, ey1 - ey0, 801, { width: 1.7, step });
    const ph = PIECES.pencil.hh * k;
    const lT = { x: sx(POSTS.l.x), y: sy(POSTS.l.y) };
    const rT = { x: sx(POSTS.r.x), y: sy(POSTS.r.y) };
    const pl = pulled();
    const loaded = run.ammo > 0 && (run.phase === "play" || run.phase === "draw") && time - lastFireT > 0.22 && (mode === "attract" || session.phase === "playing");
    const w = pl ? { x: sx(pl.x), y: sy(pl.y) } : { x: sx(REST.x), y: sy(REST.y) + band.value * 10 };
    // Back strand of the band (behind the wad), the pencil on the far side, the wad, the near strand.
    const thick = pl ? lerp(4.2, 2.2, pl.power) : 4.2;
    const strand = (a: { x: number; y: number }, seed: number) => {
      begin();
      pt(a.x, a.y);
      pt(lerp(a.x, w.x, 0.5), lerp(a.y, w.y, 0.5) + (pl ? 0 : 3));
      pt(w.x, w.y + (loaded || pl ? 0 : 6));
      ink(ctx, seed, { color: BAND, width: thick, jitter: 0.4, passes: 1, step });
    };
    drawPost(ctx, sx(2.02), ey0 + 6, rT.x, rT.y, ph * 0.9, step, 7);
    ctx.setTransform(dpr, 0, 0, dpr, shake.offset.x, shake.offset.y);
    strand(rT, 811);
    if (loaded) {
      const kind = run.nextIsTape ? "tape" : "wad";
      const sp = sprites[kind]![(step + 1) % 3]!;
      const s = wadPop.value;
      ctx.drawImage(sp.canvas, w.x - (sp.w * s) / 2, w.y - (sp.h * s) / 2, sp.w * s, sp.h * s);
    }
    strand(lT, 812);
    drawPost(ctx, sx(1.22), ey0 + 6, lT.x, lT.y, ph * 0.9, step, 3);
    ctx.setTransform(dpr, 0, 0, dpr, shake.offset.x, shake.offset.y);
    // The ruler (earned from a star) leans on the case while it's there to use.
    if (run.ruler > 0) {
      const rx = sx(CASE.x1) - 4;
      const ry = sy(CASE.top) + 4;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(0.32);
      ctx.fillStyle = COL.ruler;
      ctx.fillRect(-4, 0, 9, (CASE.top - CASE.bottom - 0.15) * k);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1;
      ctx.strokeRect(-4, 0, 9, (CASE.top - CASE.bottom - 0.15) * k);
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(-4, (i / 8) * (CASE.top - CASE.bottom - 0.15) * k);
        ctx.lineTo(0, (i / 8) * (CASE.top - CASE.bottom - 0.15) * k);
        ctx.stroke();
      }
      ctx.restore();
      if (run.ruler > 1) write(ctx, `×${run.ruler}`, rx + 10, ry + 14, bold(15), INK, 84);
    }
    // The flight's first stretch, dotted (all of it with the ruler).
    if (pl && loaded && run.ammo > 0) {
      const ruled = run.ruler > 0;
      const n = flightPath(pl.angle, pl.power, PATH, ruled ? Infinity : PREVIEW_LEN, 3, ruled ? 2.2 : 1);
      let stopAt = n;
      if (ruled) {
        const h = firstHit(run.desk, pl.angle, pl.power);
        if (h) stopAt = Math.min(n, Math.ceil(h.t / (STEP * 3)) + 1);
      }
      let travelled = 0;
      let lastX = PATH[0]!;
      let lastY = PATH[1]!;
      let nextDot = 0.25;
      for (let j = 1; j < stopAt; j++) {
        const x = PATH[j * 2]!;
        const y = PATH[j * 2 + 1]!;
        travelled += Math.hypot(x - lastX, y - lastY);
        lastX = x;
        lastY = y;
        if (travelled < nextDot) continue;
        nextDot += ruled ? 0.3 : 0.24;
        const f = ruled ? 1 : 1 - travelled / PREVIEW_LEN;
        ctx.globalAlpha = 0.35 + 0.6 * f;
        ctx.fillStyle = ruled ? BAND : INK;
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), 1.4 + 2 * f, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // HUD (CSS px)
  // ---------------------------------------------------------------------------------------------------------------
  const hudT = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const stripTop = () => (mode === "play" ? session.play().top : session.preview().top) + 8;

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
    hudT();
    const playing = mode === "play" && session.phase === "playing";
    const top = stripTop();
    const stripH = 54;
    if (mode === "play" && (playing || !endInfo)) drawStrip(top, stripH);
    if (mode === "attract") drawAttract();
    if (playing) {
      drawHint();
      drawNudges();
    }
    drawBanners(mode === "attract" ? H * 0.5 : top + stripH + 12, mode === "attract");
    if (mode === "play" && session.phase === "over" && endInfo) drawSummary();
    drawTurn();
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

  /** The page turning: the old page lifts away to the left, the next one is underneath. */
  function drawTurn() {
    if (run.phase !== "turn") return;
    const u = clamp(run.phaseT / TURN_T);
    const e = easeInOutCubic(u);
    // The sheet's free edge sweeps from the right edge to past the left.
    const edge = W * (1 - e * 2.05);
    const x0 = u < 0.5 ? edge : 0;
    const x1 = u < 0.5 ? W : Math.max(0, W + edge);
    if (x1 <= x0) return;
    hudT();
    ctx.fillStyle = "rgba(40,30,20,0.16)";
    ctx.fillRect(x0 - 10, 0, 10, H);
    ctx.fillStyle = u < 0.5 ? PAL.paperBack : PAL.paper;
    ctx.fillRect(x0, 0, x1 - x0, H);
    ctx.fillStyle = "rgba(112,156,214,0.25)";
    for (let y = geom.rule0; y < H; y += geom.ruleGap) ctx.fillRect(x0, Math.round(y) - 0.5, x1 - x0, 1);
    const g = ctx.createLinearGradient(x0, 0, x0 + 40, 0);
    g.addColorStop(0, "rgba(60,50,30,0.18)");
    g.addColorStop(1, "rgba(60,50,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, 40, H);
    line(ctx, x0, 0, x0, H, 991, { width: 1.4, color: "rgba(36,65,154,0.5)", passes: 1 });
  }

  function drawStrip(top: number, h: number) {
    scrap(10, top, W - 20, h, 31, false, 0.94);
    const cy = top + h / 2;
    // The page number, circled in red pen.
    write(ctx, `p.${run.page}`, 22, cy + 10, bold(28), INK, 81);
    ellipsePts(46, cy + 1, 30, 19, 82, 0.15, 14);
    ink(ctx, 82, { width: 1.8, jitter: 0.7, color: RED, passes: 1 });
    // The score.
    const sc = scorePop.value;
    ctx.save();
    ctx.translate(W / 2 - 14, cy + 13);
    ctx.scale(sc, sc);
    write(ctx, fmt(shownScore), 0, 0, bold(fitSize(fmt(shownScore), bold, 38, W * 0.34, 24)), INK, 83, { align: "center" });
    ctx.restore();
    // The wads left: a row of crumpled balls, tape balls first, and the next one being drawn.
    drawWadRow(W - 22, cy + 2);
  }

  function drawWadRow(right: number, cy: number) {
    const gap = 13;
    const slots = MAX_WADS;
    const r = 5.6;
    const x0 = right - (slots - 1) * gap;
    const s = clamp(wadPop.value, 0.6, 1.4);
    for (let i = 0; i < slots; i++) {
      const x = x0 + i * gap;
      const filled = i < run.wads;
      const isTape = false;
      if (filled || isTape) {
        // A wad in hand: a blue-shaded ball of paper, so it reads on the white scrap.
        const zz = i === run.wads - 1 ? s : 1;
        ctx.fillStyle = "#C9D6F0";
        ctx.beginPath();
        ctx.arc(x, cy, r * 1.05 * zz, 0, Math.PI * 2);
        ctx.fill();
        const sp = sprites.wad[(boil.step + i) % 3]!;
        const z = ((r * 2.3) / sp.w) * zz;
        ctx.globalAlpha = 0.75;
        ctx.drawImage(sp.canvas, x - (sp.w * z) / 2, cy - (sp.h * z) / 2, sp.w * z, sp.h * z);
        ctx.globalAlpha = 1;
        ellipse(ctx, x, cy, r * zz, r * zz, 850 + i, { width: 1.5, passes: 1, color: INK, jitter: 0.3 });
      } else {
        ctx.globalAlpha = 0.3;
        ellipse(ctx, x, cy, r * 0.75, r * 0.75, 860 + i, { width: 1, passes: 1, color: INK, jitter: 0.4 });
        ctx.globalAlpha = 1;
      }
    }
    // The next wad being drawn by knock-outs (every KO_PER_WAD).
    if (run.koMeter > 0 && run.wads < MAX_WADS) {
      const x = x0 + run.wads * gap;
      ellipsePts(x, cy, r, r, 870, 0.05, 12);
      begin();
      const n = Math.round((run.koMeter / KO_PER_WAD) * 12);
      for (let i = 0; i <= n; i++) pt(x + Math.cos(-Math.PI / 2 + (i / 12) * Math.PI * 2) * r, cy + Math.sin(-Math.PI / 2 + (i / 12) * Math.PI * 2) * r);
      ink(ctx, 871, { width: 1.6, passes: 1, color: BAND, jitter: 0.3 });
    }
    // Tape balls sit in front of the row.
    for (let i = 0; i < run.tape; i++) {
      const sp = sprites.tape[(boil.step + i) % 3]!;
      const z = (r * 2.9) / sp.w;
      const x = x0 - 18 - i * 15;
      ctx.drawImage(sp.canvas, x - (sp.w * z) / 2, cy - (sp.h * z) / 2, sp.w * z, sp.h * z);
    }
  }

  function drawBanners(y0: number, attract: boolean) {
    const b = banners[0];
    if (!b || b.t < 0) return;
    const kb = b.t / b.life;
    const pop = b.t < 0.18 ? easeOutBack(b.t / 0.18) : 1;
    const a = kb > 0.78 ? 1 - (kb - 0.78) / 0.22 : 1;
    const size = attract ? (b.big ? 30 : 26) : b.big ? 38 : 30;
    const maxText = W - 60;
    const ts = fitSize(b.text, bold, size, maxText, 20);
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
    highlight(ctx, W / 2 - tw / 2 - 6, y0 + 8, tw + 12, ts * 0.72, b.seed, b.color === RED ? "#FFB4AE" : ACCENT, 0.45);
    ctx.globalAlpha = a;
    write(ctx, b.text, W / 2, y0 + ts * 0.86, bold(ts), b.color, b.seed, { align: "center" });
    subLines.forEach((l, i) => write(ctx, l, W / 2, y0 + ts * 0.86 + 22 + i * 21, hand(18), PAL.inkDeep, b.seed + 1 + i, { align: "center" }));
    ctx.restore();
  }

  const hintShowing = () => !(hintSeen & 1) && !qa && run.phase !== "done";

  /** First run: a ghost thumb presses mid-page and pulls down and left, until two shots are away. */
  function drawHint() {
    if (!hintShowing() || aim) return;
    const cyc = 2.4;
    const t = time % cyc;
    const bx = W * 0.62;
    const by = H * 0.6;
    const u = easeOutCubic(clamp((t - 0.3) / 1.1));
    const gone = t > 1.9;
    const fx = bx - u * 70;
    const fy = by + u * 86;
    const hy = stripTop() + 54 + 30;
    scrap(W / 2 - 132, hy, 264, 58, 51, true, 0.95);
    write(ctx, LINES.hint[0], W / 2, hy + 27, bold(25), INK, 52, { align: "center" });
    write(ctx, LINES.hint[1], W / 2, hy + 49, hand(18), PAL.inkDeep, 53, { align: "center" });
    if (!gone) drawFingertip(fx, fy, 0.8);
    doodleArrow(ctx, bx + 4, by - 6, bx - 62, by + 74, -8, 55, { width: 2, color: "rgba(36,65,154,0.55)", head: 10, passes: 1 });
  }

  /** Idle nudges, a cancelled pull, and a quiet "out of wads" while the last one settles. */
  function drawNudges() {
    if (run.phase === "play" && !aim && run.idle > 3.6 && run.ammo > 0 && (hintSeen & 1)) {
      const a = clamp((run.idle - 3.6) / 0.5) * (0.55 + 0.35 * light.pulse(time, 0.6, { still: 0.7 }));
      write(ctx, NOTES.nudge, sx(REST.x) + 6, sy(REST.y) - 64, hand(20), INK, 61, { align: "left", alpha: a, rot: -0.06 });
      doodleArrow(ctx, sx(REST.x) + 20, sy(REST.y) - 56, sx(REST.x) + 2, sy(REST.y) - 24, 4, 62, { width: 1.6, color: `rgba(36,65,154,${0.6 * a})`, head: 8, passes: 1 });
    }
    if (time - cancelNote < 1) {
      const a = 1 - (time - cancelNote);
      write(ctx, NOTES.cancel, W / 2, H * 0.6, hand(19), PAL.graphite, 63, { align: "center", alpha: a });
    }
    if (run.ammo === 0 && run.phase === "play") {
      write(ctx, NOTES.lastWad, sx(REST.x) + 40, sy(REST.y) - 40, hand(20), RED, 64, { alpha: 0.85, rot: -0.04 });
    }
    if (slowT >= 0 && slowT < slowHold + 0.2) {
      const a = clamp(slowT / 0.15) * clamp((slowHold + 0.2 - slowT) / 0.3);
      write(ctx, NOTES.lastOne, W / 2, stripTop() + 92, bold(26), RED, 65, { align: "center", alpha: a });
    }
  }

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
  }

  function drawAttract() {
    const r = session.preview();
    const left = r.left + 16;
    const right = W - r.right - 12;
    const cx = (left + right) / 2;
    const ty = r.top + 58;
    const kk = easeOutBack(clamp(titlePop.value));
    const bw = Math.min(300, right - left);
    scrap(cx - bw / 2, ty - 50, bw, 108, 17, true, 0.95);
    ctx.save();
    ctx.translate(cx, ty);
    ctx.scale(kk, kk);
    const size = fitSize(TITLE, bold, 62, bw - 40, 32);
    write(ctx, TITLE, 0, 6, bold(size), INK, 18, { align: "center", rot: -0.025 });
    const tw = textW(TITLE, bold(size));
    begin();
    for (let i = 0; i <= 10; i++) pt(-tw / 2 + (i / 10) * tw, 18 + Math.sin(i * 0.9) * 2 - i * 0.6);
    ink(ctx, 19, { width: 2.6, jitter: 0.8, color: BAND });
    ctx.restore();
    const sub = SUBTITLE;
    write(ctx, sub, cx, ty + 44, hand(fitSize(sub, hand, 19, bw - 24, 14)), PAL.inkDeep, 20, { align: "center" });
    // Tap to play (and the best) above my launcher on the left, clear of the forts, the rail and the caption.
    const pw = 158;
    const pcx = Math.max(left + pw / 2, Math.min(sx(REST.x) + 14, right - pw / 2));
    const py = Math.max(ty + 104, sy(POSTS.l.y) - 74);
    scrap(pcx - pw / 2, py - 24, pw, 46, 22, false, 0.96);
    const breathe = light.pulse(time, 0.6, { still: 0.6 });
    highlight(ctx, pcx - 58, py - 11, 116, 22, 23, ACCENT, 0.3 + 0.25 * breathe);
    write(ctx, TAP, pcx, py + 9, bold(fitSize(TAP, bold, 28, pw - 24, 20)), INK, 24, { align: "center" });
    if (session.best !== null && session.best > 0) write(ctx, `best ${fmt(session.best)}`, pcx, py - 34, bold(22), RED, 21, { align: "center" });
    // The demo's thumb pulling.
    if (aim && aim.id === -1) drawFingertip(aim.x0 + aim.dx, aim.y0 + aim.dy, 0.7);
  }

  /** Game over: what I knocked off, against your best, and one thing to try. Clear of the shell's result card. */
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
    const hintText = QA_HINT ? QA_HINT : run.hint();
    const hintLines = wrapLines(`next time: ${hintText}`, inner, hand(17));
    const ICON = 36;
    const titleY = SCRAP_PAD + 20;
    const iconTop = titleY + 12;
    const countY = iconTop + ICON + 6 + 14;
    const statY = countY + 22;
    const barY = statY + 12;
    const bestY = barY + 27;
    const hintY = bestY + 23;
    const LINE = 19;
    const h = hintY + (hintLines.length - 1) * LINE + 5 + SCRAP_PAD;
    const y0 = standalone ? H * 0.44 : Math.max(H * 0.36, Math.min(H * 0.5, bottom - h));
    const x0 = left + SCRAP_PAD;
    ctx.globalAlpha = a;
    scrap(left, y0, w, h, 91, true, 0.97 * a);
    ctx.globalAlpha = a;
    const st = run.stats;
    write(ctx, CARD.title, x0, y0 + titleY, bold(fitSize(CARD.title, bold, 24, inner * 0.62, 16)), INK, 92, { alpha: a });
    const pages = pagesLine(st.pages);
    write(ctx, pages, right - SCRAP_PAD, y0 + titleY, hand(18), PAL.inkDeep, 93, { align: "right", alpha: a });
    // One doodle of each kind, its count underneath.
    const kinds = (["tick", "stub", "lanky"] as MiteKind[]).filter((m) => tally[m] > 0);
    const cell = inner / 4;
    if (kinds.length === 0) write(ctx, CARD.nobody, x0, y0 + iconTop + 26, hand(20), PAL.graphite, 94, { alpha: a });
    kinds.forEach((m, j) => {
      const cxx = x0 + cell * (j + 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cxx, y0 + iconTop + ICON / 2);
      const kk = (ICON * 0.8) / (Math.max(MITES[m].hw, MITES[m].hh) * 2);
      drawMite(ctx, m, kk, 1, { lx: 0.3, ly: 0, mood: "out", blink: 0, scribble: 0, squash: 1, step: boil.step, seed: 950 + j * 11 });
      ctx.restore();
      write(ctx, `×${tally[m]}`, cxx, y0 + countY, bold(17), INK, 94 + j, { align: "center", alpha: a, wobble: 0.4 });
    });
    const stats = statLine(st.bestChain, st.oneShots, st.shots);
    write(ctx, stats, x0, y0 + statY, hand(fitSize(stats, hand, 17, inner, 13)), PAL.inkDeep, 99, { alpha: a, wobble: 0.4 });
    const prev = info.prevBest;
    ctx.fillStyle = "rgba(36,65,154,0.12)";
    ctx.fillRect(x0, y0 + barY, inner, 6);
    const scored = info.score > 0;
    const frac = !scored ? 0 : info.isBest ? 1 : prev ? clamp(info.score / prev) : 1;
    const grow = easeOutCubic(clamp((t - 0.8) / 0.8));
    if (frac > 0) highlight(ctx, x0, y0 + barY - 2, Math.max(4, inner * frac * grow), 10, 95, info.isBest ? ACCENT : "#9CC8F2", 0.9);
    ctx.globalAlpha = a;
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

  // ---------------------------------------------------------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------------------------------------------------------
  resetRun("attract");
  // Let the demo get going before the first frame, so attract opens with a shot on its way.
  for (let i = 0; i < 150; i++) stepOnce();
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
