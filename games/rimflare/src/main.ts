import {
  clamp,
  Counter,
  createAudio,
  createRng,
  createSession,
  damp,
  drawLabel,
  drawTapPrompt,
  drawTitle,
  easeInOutCubic,
  easeOutBack,
  FONT_DISPLAY,
  FONT_MONO,
  HitStop,
  lerp,
  loadFonts,
  midiToFreq,
  onKeys,
  Particles,
  PENTATONIC,
  Photosafe,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { PerspectiveCamera, Vector3 } from "three";
import { flickPath, gauss, pilotFlick, SKILLS, type Skill } from "./pilot.ts";
import { FIRST_BALL_T, motionFor } from "./runs.ts";
import { ACCENT, BALL_POOL, buildWorld, INK, PAPER } from "./scene.ts";
import { createCity, S } from "./sfx.ts";
import {
  aimFor,
  BALL_R,
  BALL_Y,
  BOARD_BOTTOM,
  BOARD_H,
  BOARD_Z,
  FRENZY_T,
  HEAT_NAMES,
  hoopX,
  launchFor,
  MAX_CLOCK,
  MAX_IN_AIR,
  multFor,
  newFrames,
  project,
  readFlick,
  RELOAD_T,
  RIM_Y,
  Run,
  sampleShot,
  simulateShot,
  STAGE_T,
  stageFor,
  STILL,
  viewFor,
  type Award,
  type Flick,
  type MissKind,
  type Motion,
  type Sample,
  type Shot,
  type Stage,
  type Vec3,
  type View,
} from "./sim.ts";
import { createStage } from "./stage.ts";

const DIM = "#A7A3AE";
const FLAME = ["#FFF4C8", "#FFD36B", "#FFA53A", "#FF7A1F"] as const;
const MAGENTA_FLAME = ["#FFF4C8", "#FFC2DE", "#FF5AA8", ACCENT] as const;
const FLICK_MAX = 160;
/** The finger has to start below this share of the screen (where the ball is), but anywhere across it. */
const FLICK_ZONE = 0.42;
/** The attract demo shoots like a good player who never botches one. */
const DEMO: Skill = { ...SKILLS.good, blunder: 0, rapid: 0.55, think: [0.45, 0.9] };
const DEMO_STAGES = [0, 2, 1, 3, 4, 5];
const DEMO_SHOTS = 5;
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good`); a normal build has none. */
const QA_AUTOPLAY: Skill | null = (SKILLS as Record<string, Skill>)[import.meta.env.VITE_AUTOPLAY ?? ""] ?? null;

const MISS_LABEL: Record<MissKind, string> = {
  short: "SHORT",
  long: "LONG",
  wide: "WIDE",
  rim: "OFF THE RIM",
  board: "OFF THE GLASS",
  inout: "IN AND OUT",
};

type Phase = "ready" | "stage" | "over";

interface Ball {
  slot: number;
  shot: Shot;
  t: number;
  bonus: boolean;
  settled: boolean;
  evIdx: number;
  spin: number;
  /** Spin axis (horizontal, across the flight). */
  ax: number;
  az: number;
  /** Fades out after it has come down. */
  fade: number;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  t: number;
  life: number;
  big: boolean;
}

interface Fly {
  value: number;
  x: number;
  y: number;
  t: number;
  label: string;
  to: "score" | "clock";
  /** Stacked popups never share a row. */
  lane: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "rimflare" }), loadFonts()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<number>("hint")) === 1;
  } catch {
    /* storage unavailable: show the hint */
  }

  const stageGfx = createStage();
  const { renderer, hud } = stageGfx;
  let W = stageGfx.width;
  let H = stageGfx.height;
  const world = buildWorld(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const { scene } = world;
  const camera = new PerspectiveCamera(48, W / H, 0.1, 400);

  const audio = createAudio();
  const city = createCity(audio);
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.02, 1.9, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.14, decay: 0.45 });
  const fx = new Particles(900);
  /** Flames get their own pool, drawn additively so they glow instead of piling up as blobs. */
  const fire = new Particles(900);
  const counter = new Counter(0, 12);
  const scorePop = new Spring(1, 420, 14);
  const clockPop = new Spring(1, 420, 14);
  const titlePop = new Spring(0, 160, 12);
  const handPop = new Spring(1, 300, 14);
  const rimWob = new Spring(0, 520, 9);

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let phase: Phase = "ready";
  let phaseT = 0;
  let time = 0;
  /** Run time: the hoop's motion and every shot are timed on this. */
  let gt = 0;
  let run = new Run();
  let stage: Stage = stageFor(0);
  let motion: Motion = STILL;
  let view: View = viewFor(stage.spot, W, H);
  let balls: Ball[] = [];
  const frames = Array.from({ length: BALL_POOL }, () => newFrames());
  let handAt = 0;
  let handSlot = -1;
  let handBonus = false;
  let hoopFrom = 0;
  let banners: Banner[] = [];
  let fly: Fly[] = [];
  let shownScore = 0;
  let shownClock = 0;
  let celebratedBest = false;
  let endSent = false;
  let endInfo: { score: number; best: number | null; isBest: boolean; prevBest: number | null } | null = null;
  let toast: { text: string; t: number } | null = null;
  let lit = 0.5;
  let glass = 0;
  let heat = 0;
  let lastTick = -1;
  let buzzerT = -1;
  // Attract pilot.
  let demoIdx = 0;
  let demoShots = 0;
  let demoBias = 0;
  let demoFlick: Flick | null = null;
  let qaAt = 0;
  let demoAt = 0;
  const demoPath: Sample[] = [];
  // Camera: from where it was to the new spot's view.
  const camFrom = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 48 };
  const camNow = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 48 };
  const look = new Vector3();
  const pos: Vec3 = { x: 0, y: 0, z: 0 };
  const scr = { x: 0, y: 0, depth: 0 };
  // Input.
  const pts: Sample[] = Array.from({ length: FLICK_MAX }, () => ({ x: 0, y: 0, t: 0 }));
  let nPts = 0;
  let touching = false;
  let touchId = -1;

  stageGfx.onResize((w, h) => {
    W = w;
    H = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    view = viewFor(stage.spot, W, H);
    if (phase !== "stage") snapCam(view);
  });

  function snapCam(v: View) {
    camNow.x = v.cam.x;
    camNow.y = v.cam.y;
    camNow.z = v.cam.z;
    camNow.lx = v.look.x;
    camNow.ly = v.look.y;
    camNow.lz = v.look.z;
    camNow.fov = v.fov;
  }

  const undecided = () => {
    let n = 0;
    for (const b of balls) if (!b.settled) n++;
    return n;
  };

  function freeSlot(): number {
    const used = new Set(balls.map((b) => b.slot));
    if (handSlot >= 0) used.add(handSlot);
    for (let i = 0; i < BALL_POOL; i++) if (!used.has(i)) return i;
    // Every slot busy: recycle the oldest ball that has already come down.
    const old = balls.find((b) => b.settled);
    if (old) {
      balls = balls.filter((b) => b !== old);
      hideBall(old.slot);
      return old.slot;
    }
    return 0;
  }

  function hideBall(slot: number) {
    const b = world.balls[slot]!;
    b.mesh.visible = false;
    b.shadow.visible = false;
    b.glow.visible = false;
  }

  function startStage(st: Stage, instant = false) {
    camFrom.x = camNow.x;
    camFrom.y = camNow.y;
    camFrom.z = camNow.z;
    camFrom.lx = camNow.lx;
    camFrom.ly = camNow.ly;
    camFrom.lz = camNow.lz;
    camFrom.fov = camNow.fov;
    hoopFrom = hoopX(motion, gt);
    stage = st;
    view = viewFor(st.spot, W, H);
    motion = motionFor(st, gt + (instant ? 0 : STAGE_T));
    if (instant) {
      snapCam(view);
      phase = "ready";
      hoopFrom = 0;
    } else {
      phase = "stage";
      phaseT = 0;
      if (handSlot >= 0) hideBall(handSlot);
      handSlot = -1;
      handAt = gt + STAGE_T;
    }
    demoFlick = null;
  }

  function resetRun(m: "attract" | "play") {
    mode = m;
    run = new Run();
    for (let i = 0; i < BALL_POOL; i++) hideBall(i);
    balls = [];
    handSlot = -1;
    counter.snap(0);
    shownScore = 0;
    banners = [];
    fly = [];
    fx.clear();
    fire.clear();
    celebratedBest = false;
    endSent = false;
    endInfo = null;
    toast = null;
    buzzerT = -1;
    lastTick = -1;
    gt = 0;
    motion = STILL;
    world.net.reset();
    if (m === "attract") {
      demoIdx = 0;
      demoShots = 0;
      demoBias = 0;
      startStage(stageFor(DEMO_STAGES[0]!), true);
      handAt = 0.3;
    } else {
      startStage(stageFor(0), true);
      handAt = FIRST_BALL_T;
      shownClock = run.clock;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Shooting
  // -------------------------------------------------------------------------------------------------------------
  const canShoot = () =>
    phase === "ready" && handSlot >= 0 && !run.buzzer && !run.pendingStage && undecided() < MAX_IN_AIR && (mode === "attract" || session.phase === "playing");

  function shoot(f: Flick) {
    if (!canShoot()) return;
    if (f.kind === "none") return;
    if (f.kind === "soft") {
      run.softs++;
      toast = { text: "FLICK A LITTLE LONGER", t: 0 };
      audio.play(S.soft);
      handPop.kick(-3);
      return;
    }
    const loud = mode === "play";
    const bonus = loud ? run.take() : handBonus;
    if (!loud) demoShots++;
    const aim = aimFor(view, stage, motion, gt, f);
    const vel = launchFor(stage.spot, aim.target);
    const slot = handSlot;
    handSlot = -1;
    const shot = simulateShot(stage.spot, vel, motion, gt, frames[slot]!);
    const hl = Math.hypot(vel.x, vel.z) || 1;
    balls.push({ slot, shot, t: 0, bonus, settled: false, evIdx: 0, spin: 0, ax: -vel.z / hl, az: vel.x / hl, fade: 1 });
    handAt = gt + RELOAD_T;
    audio.play(S.release, { volume: loud ? 1 : 0.4 });
    audio.play(S.spin, { volume: loud ? 1 : 0.4, pitch: rng.range(-2, 2) });
    if (loud) session.feedback("tap");
    shake.add(0.04);
  }

  function rimScreen(): { x: number; y: number } {
    pos.x = hoopX(motion, gt);
    pos.y = RIM_Y;
    pos.z = 0;
    return project(camView(), pos, scr);
  }

  function onEvent(b: Ball, kind: string, x: number, y: number, z: number, power: number) {
    const loud = mode === "play";
    const vol = loud ? 1 : 0.4;
    pos.x = x;
    pos.y = y;
    pos.z = z;
    const s = project(camView(), pos, scr);
    const sx = s.x;
    const sy = s.y;
    switch (kind) {
      case "rim": {
        const p = clamp(power / 5);
        audio.play(S.clank, { volume: vol * (0.45 + p * 0.55), pitch: rng.range(-1.5, 1.5) });
        audio.play(S.clankLow, { volume: vol * (0.4 + p * 0.6) });
        rimWob.kick(4 + p * 10);
        shake.add(0.06 + p * 0.12);
        fx.emit(sx, sy, { count: 6 + Math.round(p * 8), speed: [60, 220], life: [0.18, 0.4], size: [1.5, 3], colors: [PAPER, "#FFE0A8"], drag: 3, shape: "spark" });
        if (loud && p > 0.45) session.feedback("impact");
        break;
      }
      case "board": {
        const p = clamp(power / 6);
        audio.play(S.board, { volume: vol * (0.45 + p * 0.55) });
        audio.play(S.boardRattle, { volume: vol * p });
        glass = Math.max(glass, 0.5 + p * 0.5);
        shake.add(0.05 + p * 0.1);
        break;
      }
      case "net":
        if (b.shot.outcome !== "miss") {
          const clean = b.shot.outcome === "swish";
          audio.play(S.swish, { volume: vol * (clean ? 1 : 0.7) });
          audio.play(S.swishBody, { volume: vol * (clean ? 1 : 0.6) });
          world.net.whip(clean ? 0.9 : 0.5);
        }
        break;
      case "floor": {
        const p = clamp(power / 6);
        if (p > 0.08) {
          audio.play(S.bounce, { volume: vol * (0.25 + p * 0.75), pitch: rng.range(-1, 1) });
          audio.play(S.bounceSlap, { volume: vol * p });
        }
        break;
      }
    }
  }

  /** A ball has come down: score it, celebrate or shrug. */
  function decide(b: Ball) {
    b.settled = true;
    const s = b.shot;
    const loud = mode === "play";
    const rim = rimScreen();
    const rx = rim.x;
    const ry = rim.y;
    const wasHot = run.streak >= 3;
    const afterBuzzer = run.buzzer;
    const award: Award = run.settle(s, stage.dist, b.bonus, afterBuzzer);
    if (!loud) run.pendingStage = false;
    if (s.outcome === "miss") {
      banners = banners.filter((x) => x.big);
      banners.push({ text: MISS_LABEL[s.miss ?? "short"], sub: wasHot ? "THE FIRE'S OUT" : "", color: PAPER, t: 0, life: 0.85, big: false });
      if (wasHot) {
        audio.play(S.fizzle, { volume: loud ? 1 : 0.4 });
        for (const o of balls) if (!o.settled) emitSmoke(o);
        if (handSlot >= 0) emitSmokeAt(handSlot);
      }
      if (afterBuzzer || run.buzzer) maybeEnd();
      return;
    }
    // A make.
    const clean = s.outcome === "swish";
    const tier = award.mult;
    const note = PENTATONIC[Math.min(run.streak - 1, PENTATONIC.length - 1)]!;
    audio.note(midiToFreq(64 + note), 0.28, "triangle", loud ? 0.24 : 0.1);
    audio.play(S.score, { volume: loud ? 0.8 : 0.3, pitch: note * 0.25 });
    if (award.tierUp) {
      window.setTimeout(() => audio.play(S.tier, { volume: loud ? 1 : 0.4 }), 140);
      audio.play(S.ignite, { volume: loud ? 1 : 0.4 });
      audio.play(S.igniteLow, { volume: loud ? 1 : 0.4 });
    }
    flash.trigger(clean || award.tierUp ? ACCENT : PAPER, award.tierUp ? 0.9 : clean ? 0.5 : 0.25);
    hitStop.freeze(reduced ? 0 : award.tierUp ? 0.08 : clean ? 0.045 : 0.02);
    shake.add(award.tierUp ? 0.32 : clean ? 0.2 : 0.12);
    const colors = tier >= 4 ? MAGENTA_FLAME : tier >= 2 ? FLAME : [PAPER, ACCENT, "#FFD36B"];
    fx.emit(rx, ry + 18, { count: clean ? 34 : 20, speed: [80, 320], angle: [Math.PI * 0.15, Math.PI * 0.85], life: [0.4, 0.9], size: [2.5, 5], colors, gravity: 420, drag: 1.6, spin: [-6, 6] });
    if (clean) fx.emit(rx, ry + 30, { count: 10, speed: [40, 120], angle: [Math.PI * 0.35, Math.PI * 0.65], life: [0.3, 0.6], size: [10, 18], colors: [rgba(PAPER, 0.5)], drag: 3, shape: "ring" });
    if (loud) {
      session.feedback("success");
      const head = award.buzzer ? "BUZZER BEATER" : clean ? "SWISH" : s.outcome === "bank" ? "OFF THE GLASS" : award.tags[0] === "ROLLED IN" ? "ROLLED IN" : "BUCKET";
      const subs = award.tags.filter((t) => t !== head && t !== "SWISH" && t !== "OFF THE GLASS" && t !== "RIM AND IN" && t !== "ROLLED IN");
      if (award.mult > 1) subs.push(`×${award.mult}`);
      const big = clean || award.tierUp || award.buzzer || s.outcome === "bank";
      banners = banners.filter((x) => x.t < 0.25 && x.big);
      banners.push({ text: award.tierUp ? HEAT_NAMES[award.mult]! : head, sub: award.tierUp ? `${head} · ×${award.mult} POINTS` : subs.join(" · "), color: award.tierUp || clean ? ACCENT : PAPER, t: 0, life: big ? 1.15 : 0.85, big });
      const lane = (to: Fly["to"]) => {
        const busy = new Set(fly.filter((f) => f.to === to && f.t < 0.8).map((f) => f.lane));
        let l = 0;
        while (busy.has(l)) l++;
        return l;
      };
      fly.push({ value: award.points, x: rx, y: ry, t: 0, label: `+${award.points.toLocaleString("en-US")}`, to: "score", lane: lane("score") });
      if (award.refill > 0.05) fly.push({ value: award.refill, x: 18, y: 0, t: 0, label: `+${award.refill.toFixed(1)}S`, to: "clock", lane: lane("clock") });
      if (award.stageUp) {
        window.setTimeout(() => {
          if (mode === "play") banners.push({ text: "STAGE CLEAR", sub: "", color: ACCENT, t: 0, life: 0.9, big: false });
        }, 380);
      }
      if (!hintSeen) {
        hintSeen = true;
        tc.storage.set("hint", 1).catch(() => undefined);
      }
      const best = session.best;
      if (!celebratedBest && best !== null && best > 0 && run.score > best) {
        celebratedBest = true;
        window.setTimeout(() => {
          if (mode !== "play") return;
          banners.push({ text: "NEW BEST", sub: "KEEP SHOOTING", color: ACCENT, t: 0, life: 1.3, big: false });
          audio.play(S.best);
          confetti(0.32);
        }, 650);
      }
      if (afterBuzzer || run.buzzer) maybeEnd();
    } else if (award.tierUp) {
      banners.push({ text: HEAT_NAMES[award.mult]!, sub: "", color: ACCENT, t: 0, life: 1, big: true });
    }
  }

  function confetti(y: number) {
    const c = [ACCENT, PAPER, "#FFD36B", "#FF7A1F"];
    fx.emit(W * 0.15, H * y, { count: 36, speed: [220, 520], angle: [-Math.PI * 0.45, -Math.PI * 0.1], life: [0.9, 1.6], size: [3, 7], colors: c, gravity: 600, drag: 1.3, spin: [-8, 8] });
    fx.emit(W * 0.85, H * y, { count: 36, speed: [220, 520], angle: [-Math.PI * 0.9, -Math.PI * 0.55], life: [0.9, 1.6], size: [3, 7], colors: c, gravity: 600, drag: 1.3, spin: [-8, 8] });
  }

  function emitSmokeAt(slot: number) {
    const m = world.balls[slot]!.mesh;
    pos.x = m.position.x;
    pos.y = m.position.y;
    pos.z = m.position.z;
    const s = project(camView(), pos, scr);
    fx.emit(s.x, s.y, { count: 10, speed: [20, 70], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.5, 0.9], size: [6, 12], colors: ["#3A3946", "#55536A"], gravity: -60, drag: 2, endScale: 1.6, shape: "circle" });
  }
  function emitSmoke(b: Ball) {
    emitSmokeAt(b.slot);
  }

  function maybeEnd() {
    if (mode !== "play" || endSent || !run.buzzer || undecided() > 0) return;
    endRun();
  }

  function endRun() {
    if (endSent) return;
    endSent = true;
    const prevBest = session.best;
    const r = session.end(run.score, {
      outcome: "lose",
      stats: { makes: run.makes, shots: run.shots, swishes: run.swishes, streak: run.bestStreak, stage: run.stage + 1 },
    });
    endInfo = { score: run.score, best: r.best, isBest: r.isBest, prevBest };
    phase = "over";
    phaseT = 0;
    if (handSlot >= 0) hideBall(handSlot);
    handSlot = -1;
    if (r.isBest && run.score > 0) {
      audio.play(S.best);
      confetti(0.62);
    }
  }

  function onBuzzer() {
    buzzerT = 0;
    audio.play(S.buzzer);
    audio.play(S.buzzerHi);
    shake.add(0.25);
    session.feedback("impact");
    if (handSlot >= 0) hideBall(handSlot);
    handSlot = -1;
    banners = [{ text: "TIME", sub: undecided() ? "STILL IN THE AIR..." : "", color: PAPER, t: 0, life: 1.1, big: true }];
    maybeEnd();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: a tap starts a run; during a run, an upward flick from the lower part of the screen shoots.
  // -------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  const canAim = () => mode === "play" && session.phase === "playing";
  window.addEventListener("pointerdown", (e) => {
    if (!canAim() || touching) return;
    if (e.clientY < H * FLICK_ZONE) return;
    touching = true;
    touchId = e.pointerId;
    pts[0]!.x = e.clientX;
    pts[0]!.y = e.clientY;
    pts[0]!.t = e.timeStamp;
    nPts = 1;
  });
  window.addEventListener("pointermove", (e) => {
    if (!touching || e.pointerId !== touchId) return;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
    if (events && events.length) for (const c of events) addPt(c.clientX, c.clientY, c.timeStamp);
    else addPt(e.clientX, e.clientY, e.timeStamp);
  });
  const release = (e: PointerEvent) => {
    if (!touching || e.pointerId !== touchId) return;
    touching = false;
    addPt(e.clientX, e.clientY, e.timeStamp);
    if (canAim()) {
      const f = readFlick(pts, nPts);
      // A flick while the next ball is still coming up waits for it (up to the reload), so fast hands never lose a shot.
      if (f.kind === "shot" && !canShoot() && phase === "ready" && !run.buzzer && handAt - gt < RELOAD_T) queued = { f, at: gt };
      else shoot(f);
    }
    nPts = 0;
  };
  let queued: { f: Flick; at: number } | null = null;
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== touchId) return;
    touching = false;
    nPts = 0;
  });
  session.on("cancel", () => {
    touching = false;
    nPts = 0;
    queued = null;
  });
  function addPt(x: number, y: number, t: number) {
    if (nPts >= FLICK_MAX) {
      for (let i = 1; i < FLICK_MAX / 2; i++) {
        pts[i]!.x = pts[i * 2]!.x;
        pts[i]!.y = pts[i * 2]!.y;
        pts[i]!.t = pts[i * 2]!.t;
      }
      nPts = FLICK_MAX / 2;
    }
    const p = pts[nPts++]!;
    p.x = x;
    p.y = y;
    p.t = t;
  }
  // Desktop testing: up = a clean shot at the hoop, left/right = a little off to that side.
  const keyShot = (side: number) => {
    if (!canAim()) return;
    const f = pilotFlick(view, stage, motion, gt, SKILLS.expert, rng, 0);
    shoot({ ...f, dx: f.dx + side * 18 });
  };
  onKeys({ up: () => keyShot(0), action: () => keyShot(0), left: () => keyShot(-1), right: () => keyShot(1) });

  session.on("start", () => resetRun("play"));
  session.on("attract", () => resetRun("attract"));
  resetRun("attract");

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  const tmpView: View = { cam: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 48, aspect: 1, width: 1, height: 1 };
  function camView(): View {
    tmpView.cam.x = camNow.x;
    tmpView.cam.y = camNow.y;
    tmpView.cam.z = camNow.z;
    tmpView.look.x = camNow.lx;
    tmpView.look.y = camNow.ly;
    tmpView.look.z = camNow.lz;
    tmpView.fov = camNow.fov;
    tmpView.aspect = W / H;
    tmpView.width = W;
    tmpView.height = H;
    return tmpView;
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    const dt = hitStop.scale(rawDt);
    phaseT += rawDt;
    gt += dt;
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(rawDt);
    fire.update(rawDt);
    counter.update(rawDt);
    scorePop.update(rawDt);
    clockPop.update(rawDt);
    titlePop.update(rawDt);
    handPop.update(rawDt);
    rimWob.update(rawDt);
    glass = Math.max(0, glass - rawDt * 1.6);
    for (const b of banners) b.t += rawDt;
    if (banners.some((b) => b.t > b.life)) banners = banners.filter((b) => b.t <= b.life);
    if (toast) {
      toast.t += rawDt;
      if (toast.t > 1.2) toast = null;
    }
    if (buzzerT >= 0) buzzerT += rawDt;
    city.tick();

    // Points and seconds fly into their counters, which tick up when they land.
    for (const f of fly) {
      f.t += rawDt;
      if (f.t >= (f.to === "score" ? 0.28 : 0.05) && f.value) {
        if (f.to === "score") {
          shownScore += f.value;
          counter.set(shownScore);
          scorePop.kick(7);
          audio.play(S.tick, { pitch: 7 });
        } else {
          clockPop.kick(8);
          audio.play(S.refill);
        }
        f.value = 0;
      }
    }
    if (fly.length && fly.every((f) => f.t > 0.8)) fly = [];

    // The clock.
    if (mode === "play" && session.phase === "playing") {
      const frozen = phase === "stage" || gt < FIRST_BALL_T;
      if (run.tick(dt, frozen)) onBuzzer();
      const sec = Math.ceil(run.clock);
      if (run.clock <= FRENZY_T && sec !== lastTick && !run.buzzer) {
        lastTick = sec;
        audio.play(S.countdown, { pitch: (FRENZY_T - sec) * 2 });
      }
    }
    shownClock = damp(shownClock, run.clock, 14, rawDt);

    // Stage changes once every ball is down.
    if (phase === "ready" && undecided() === 0) {
      if (mode === "play" && run.pendingStage && !run.buzzer) {
        const st = run.advance();
        startStage(st);
        audio.play(S.stage);
        audio.play(S.whoosh);
        banners = [{ text: `STAGE ${st.n + 1}`, sub: st.label, color: ACCENT, t: 0, life: 1.3, big: true }];
      } else if (mode === "attract" && demoShots >= DEMO_SHOTS) {
        demoShots = 0;
        demoIdx = (demoIdx + 1) % DEMO_STAGES.length;
        startStage(stageFor(DEMO_STAGES[demoIdx]!));
        demoBias = gauss(rng) * DEMO.bias;
      }
    }
    if (phase === "stage") {
      const k = clamp(phaseT / STAGE_T);
      const e = reduced ? (k < 0.5 ? 0 : 1) : easeInOutCubic(k);
      camNow.x = lerp(camFrom.x, view.cam.x, e);
      camNow.y = lerp(camFrom.y, view.cam.y, e);
      camNow.z = lerp(camFrom.z, view.cam.z, e);
      camNow.lx = lerp(camFrom.lx, view.look.x, e);
      camNow.ly = lerp(camFrom.ly, view.look.y, e);
      camNow.lz = lerp(camFrom.lz, view.look.z, e);
      camNow.fov = lerp(camFrom.fov, view.fov, e);
      if (k >= 1) {
        phase = "ready";
        snapCam(view);
      }
    }

    // A new ball in your hands.
    if (phase === "ready" && handSlot < 0 && gt >= handAt && !run.buzzer && !run.pendingStage && undecided() < MAX_IN_AIR && (mode === "attract" || session.phase === "playing")) {
      handSlot = freeSlot();
      handBonus = mode === "play" ? run.nextIsBonus() : (demoShots + demoIdx * 3) % 6 === 5;
      handPop.value = 0.2;
      handPop.velocity = 0;
      handPop.target = 1;
      const bm = world.balls[handSlot]!;
      bm.mat.map = handBonus ? world.bonusTex : world.normalTex;
      bm.mat.needsUpdate = true;
      bm.mesh.rotation.set(rng.range(0, 6), rng.range(0, 6), 0);
      if (mode === "attract") {
        demoFlick = pilotFlick(view, stage, motion, gt + 0.55, DEMO, rng, demoBias);
        demoAt = gt + rng.range(DEMO.think[0], DEMO.think[1]) + 0.2;
        demoBias *= 0.8;
        const b = project(view, { x: stage.spot.x, y: BALL_Y, z: stage.spot.z }, scr);
        flickPath(demoFlick, b.x, b.y + 12, demoPath, 16);
      }
      if (queued && gt - queued.at < 0.5) {
        const q = queued.f;
        queued = null;
        shoot(q);
      }
      queued = null;
    }
    if (QA_AUTOPLAY && mode === "play" && handSlot >= 0 && session.phase === "playing" && gt >= qaAt) {
      qaAt = gt + RELOAD_T + rng.range(QA_AUTOPLAY.think[0], QA_AUTOPLAY.think[1]);
      shoot(pilotFlick(view, stage, motion, gt, QA_AUTOPLAY, rng, 0));
    }
    if (mode === "attract" && demoFlick && handSlot >= 0 && gt >= demoAt) {
      // Re-aim at the moment of release (the hoop may have moved while it lined up).
      const f = pilotFlick(view, stage, motion, gt, DEMO, rng, demoBias);
      demoFlick = null;
      shoot(f);
    }

    // Balls in the air.
    for (const b of balls) {
      b.t += dt;
      const s = b.shot;
      while (b.evIdx < s.events.length && s.events[b.evIdx]!.t <= b.t) {
        const ev = s.events[b.evIdx++]!;
        onEvent(b, ev.kind, ev.x, ev.y, ev.z, ev.power);
      }
      if (!b.settled && b.t >= s.decided) decide(b);
      if (b.settled && b.t > s.decided + 0.9) b.fade = Math.max(0, b.fade - rawDt * 2.2);
    }
    const gone = balls.filter((b) => b.fade <= 0 || b.t >= b.shot.end);
    if (gone.length) {
      for (const b of gone) hideBall(b.slot);
      balls = balls.filter((b) => !gone.includes(b));
    }
    maybeEnd();

    placeHoop(dt);
    placeBalls(dt);
    placeCamera();

    // The city wakes up as you score; the rim glows while you're hot.
    const tier = multFor(run.streak);
    const target = mode === "attract" ? 0.5 : Math.min(0.96, 0.16 + run.makes * 0.012 + (tier - 1) * 0.05);
    lit = damp(lit, target, 1.6, rawDt);
    world.city.material.uniforms.uLit!.value = lit;
    heat = damp(heat, tier > 1 ? (tier - 1) / 3 : 0, 3, rawDt);
    city.setHeat(mode === "play" ? heat : 0);
    world.rimMat.emissiveIntensity = heat * 0.9;
    world.rimGlow.material.opacity = heat * (0.45 + 0.25 * light.pulse(time, 1, { still: 0.5 }));
    world.setGlass(glass);
    if (mode === "play") world.face.set(run.buzzer ? "0" : String(Math.ceil(run.clock)), run.clock <= FRENZY_T);
    else world.face.set("24", false);
  }

  function placeHoop(dt: number) {
    let hx = hoopX(motion, gt);
    if (phase === "stage") hx = lerp(hoopFrom, hx, easeInOutCubic(clamp(phaseT / STAGE_T)));
    world.hoop.position.x = hx;
    world.rim.position.y = RIM_Y - rimWob.value * 0.004;
    world.rim.rotation.x = rimWob.value * 0.006;
    // Balls passing through push the net's knots aside.
    for (const b of balls) {
      if (b.t > b.shot.decided + 0.6) continue;
      const m = world.balls[b.slot]!.mesh.position;
      const ly = m.y - (RIM_Y - 0.012);
      if (ly < 0.15 && ly > -0.6 && Math.hypot(m.x - hx, m.z) < 0.4) world.net.push(m.x - hx, ly, m.z, -2);
    }
    world.net.update(dt);
  }

  function placeBalls(dt: number) {
    const hot = run.streak >= 3;
    const tier = multFor(run.streak);
    const cv = camView();
    for (const b of balls) {
      const bm = world.balls[b.slot]!;
      sampleShot(b.shot, b.t, pos);
      bm.mesh.visible = true;
      bm.mesh.position.set(pos.x, pos.y, pos.z);
      // Backspin, a visible fraction of the real rate.
      b.spin += dt * 9 * Math.exp(-0.6 * b.t);
      bm.mesh.rotation.set(b.ax * b.spin, 0, b.az * b.spin);
      const s = 0.4 + 0.6 * b.fade;
      bm.mesh.scale.setScalar(s);
      bm.shadow.visible = true;
      bm.shadow.position.set(pos.x, 0.012, pos.z);
      const sh = BALL_R * (1.1 + pos.y * 0.25);
      bm.shadow.scale.set(sh, sh, 1);
      (bm.shadow.material as { opacity: number }).opacity = clamp(1 - pos.y / 6) * 0.8 * b.fade;
      const onFire = hot && !b.settled;
      bm.mat.emissiveIntensity = onFire ? 0.35 + 0.15 * (tier - 2) : 0;
      bm.glow.visible = onFire;
      if (onFire) {
        bm.glow.position.copy(bm.mesh.position);
        bm.glow.scale.setScalar(0.75 + tier * 0.1);
        bm.glow.material.opacity = 0.55;
        flames(pos, cv, tier, 2);
      }
    }
    if (handSlot >= 0) {
      const bm = world.balls[handSlot]!;
      const k = handPop.value;
      const lift = touching && nPts > 1 ? clamp((pts[0]!.y - pts[nPts - 1]!.y) / H) * 0.25 : 0;
      const bob = reduced ? 0 : Math.sin(time * 2.4) * 0.012;
      bm.mesh.visible = true;
      bm.mesh.position.set(stage.spot.x, BALL_Y - (1 - k) * 0.45 + bob + lift, stage.spot.z);
      bm.mesh.scale.setScalar(clamp(0.6 + k * 0.4, 0.6, 1.15));
      bm.mesh.rotation.y += dt * 0.6;
      bm.shadow.visible = true;
      bm.shadow.position.set(stage.spot.x, 0.012, stage.spot.z);
      bm.shadow.scale.set(BALL_R * 1.4, BALL_R * 1.4, 1);
      (bm.shadow.material as { opacity: number }).opacity = 0.5;
      bm.mat.emissiveIntensity = hot ? 0.35 + 0.15 * (tier - 2) : 0;
      bm.glow.visible = hot;
      if (hot) {
        bm.glow.position.copy(bm.mesh.position);
        bm.glow.scale.setScalar(0.7 + tier * 0.1);
        bm.glow.material.opacity = 0.5;
        pos.x = bm.mesh.position.x;
        pos.y = bm.mesh.position.y;
        pos.z = bm.mesh.position.z;
        flames(pos, cv, tier, 1);
      }
    }
  }

  /** Flames on a ball, drawn on the HUD at its screen position and size: small tongues licking up off its top half. */
  function flames(p: Vec3, cv: View, tier: number, n: number) {
    const s = project(cv, p, scr);
    if (s.depth <= 0.1) return;
    const r = (BALL_R / (s.depth * Math.tan((cv.fov * Math.PI) / 360))) * (H / 2);
    const count = reduced ? 1 : n + (tier >= 3 ? 3 : 2);
    const colors = tier >= 4 ? MAGENTA_FLAME : FLAME;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      fire.emit(s.x + Math.cos(a) * r * 0.8, s.y + Math.sin(a) * r * 0.8, {
        count: 1,
        speed: [r * 1.6, r * 4.2],
        angle: [-Math.PI * 0.62, -Math.PI * 0.38],
        life: [0.2, 0.42],
        size: [r * 0.3, r * 0.68],
        colors,
        gravity: -r * 10,
        drag: 1.5,
        shape: "circle",
      });
    }
  }

  function placeCamera() {
    const o = shake.offset;
    camera.position.set(camNow.x + o.x * 0.006, camNow.y + o.y * 0.006, camNow.z);
    look.set(camNow.lx + o.x * 0.004, camNow.ly + o.y * 0.004, camNow.lz);
    camera.lookAt(look);
    camera.rotateZ(o.angle);
    if (camera.fov !== camNow.fov) {
      camera.fov = camNow.fov;
      camera.updateProjectionMatrix();
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------------------------------------------
  function spaced(g: CanvasRenderingContext2D, px: number) {
    (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  }

  function drawGhost(g: CanvasRenderingContext2D, path: Sample[], n: number, u: number, alpha: number) {
    if (n < 2 || alpha <= 0) return;
    const last = Math.min(n - 1, Math.floor(u * (n - 1)));
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = ACCENT;
    g.lineWidth = 5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(path[0]!.x, path[0]!.y);
    for (let i = 1; i <= last; i++) g.lineTo(path[i]!.x, path[i]!.y);
    g.stroke();
    const p = path[last]!;
    g.fillStyle = rgba(PAPER, 0.85);
    g.beginPath();
    g.arc(p.x, p.y, 17, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(INK, 0.5);
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  function handScreen() {
    pos.x = stage.spot.x;
    pos.y = BALL_Y;
    pos.z = stage.spot.z;
    return project(camView(), pos, scr);
  }

  function drawHud() {
    stageGfx.beginHud();
    const g = hud;
    g.globalCompositeOperation = "lighter";
    fire.draw(g);
    g.globalCompositeOperation = "source-over";
    fx.draw(g);

    // Live touch: the finger's path, drawn the same frame it moves.
    if (touching && nPts > 1) {
      g.save();
      g.strokeStyle = rgba(ACCENT, 0.75);
      g.lineWidth = 6;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < nPts; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      g.stroke();
      g.restore();
      const p = pts[nPts - 1]!;
      g.strokeStyle = rgba(PAPER, 0.8);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, 22, 0, Math.PI * 2);
      g.stroke();
    }

    if (mode === "attract") drawAttract(g);
    else drawPlay(g);

    // Banners: in play they sit in their own band, below the score's streak line and above the shot clock on the board,
    // on a near-opaque plate, so neither shows through.
    const insTop = mode === "play" ? session.play().top : session.preview().top;
    pos.x = hoopX(motion, gt);
    pos.y = BOARD_BOTTOM + BOARD_H + 0.36;
    pos.z = BOARD_Z;
    const clockTop = project(camView(), pos, scr).y;
    const bandTop = insTop + 12 + 70;
    for (const b of banners) {
      const k = b.t / b.life;
      const pop = b.t < 0.16 ? easeOutBack(b.t / 0.16) : 1;
      const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      let size = mode === "attract" ? (b.big ? 30 : 20) : b.big ? 44 : 26;
      const plateH = (sz: number) => sz * 1.1 + (b.sub ? 26 : 0);
      let y: number;
      if (mode === "attract") y = H * 0.56;
      else {
        const band = Math.max(40, clockTop - 6 - bandTop);
        if (plateH(size) > band) size = Math.max(18, size * (band / plateH(size)));
        y = Math.max(bandTop + 0.82 * size, clockTop - 6 - plateH(size) + 0.82 * size);
      }
      y -= reduced ? 0 : (1 - pop) * 10;
      g.save();
      g.globalAlpha = a;
      g.translate(W / 2, y);
      g.scale(pop, pop);
      g.font = `900 ${size}px ${FONT_DISPLAY}`;
      spaced(g, -size * 0.02);
      const tw = Math.min(W - 40, g.measureText(b.text).width);
      g.fillStyle = rgba(INK, 0.92);
      roundRect(g, -tw / 2 - 16, -size * 0.82, tw + 32, plateH(size), 10);
      g.fill();
      drawTitle(g, b.text, 0, 0, W - 50, b.color, size, b.big ? rgba(INK, 0.9) : undefined);
      if (b.sub) drawLabel(g, b.sub, 0, size * 0.3 + 6, b.big ? PAPER : DIM, 11);
      g.restore();
    }
    // Points rise from the rim in their own stacked rows; seconds back appear in the clock's column.
    const ins = session.play();
    for (const f of fly) {
      if (f.t > 0.8 || f.t < 0) continue;
      const u = clamp(f.t / 0.8);
      const rise = 1 - (1 - u) ** 3;
      const alpha = f.t < 0.08 ? f.t / 0.08 : clamp(1 - (f.t - 0.55) / 0.25);
      g.save();
      g.globalAlpha = alpha;
      g.textBaseline = "middle";
      if (f.to === "score") {
        const x = clamp(f.x, 70, W - 70);
        const y = Math.max(clockTop + 18, f.y - 40 - f.lane * 30 - rise * 18);
        g.font = `24px ${FONT_MONO}`;
        g.textAlign = "center";
        const w = g.measureText(f.label).width;
        g.fillStyle = rgba(INK, 0.72);
        roundRect(g, x - w / 2 - 8, y - 15, w + 16, 30, 8);
        g.fill();
        g.fillStyle = ACCENT;
        g.fillText(f.label, x, y);
      } else {
        const y = ins.top + 12 + (run.frenzy ? 76 : 62) + f.lane * 18 - rise * 4;
        g.font = `14px ${FONT_MONO}`;
        g.textAlign = "left";
        g.fillStyle = rgba(INK, 0.6);
        g.fillText(f.label, f.x + 1, y + 1);
        g.fillStyle = PAPER;
        g.fillText(f.label, f.x, y);
      }
      g.restore();
    }
    flash.draw(g, W, H);
  }

  function drawAttract(g: CanvasRenderingContext2D) {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(clamp(titlePop.value));
    g.drawImage(topShade(), 0, 0, W, r.y + 150);
    g.save();
    g.translate(cx, r.y + 52);
    g.scale(k, k);
    drawTitle(g, "RIMFLARE", 0, 0, r.w - 8, PAPER, 50, rgba(ACCENT, 0.95));
    g.restore();
    g.fillStyle = rgba(INK, 0.66);
    roundRect(g, cx - 118, r.y + 67, 236, 22, 11);
    g.fill();
    drawLabel(g, "ROOFTOP HOOPS AFTER DARK", cx, r.y + 78, rgba(PAPER, 0.85), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 98, ACCENT, 13);
    // The demo's ghost finger shows the verb.
    if (demoFlick && handSlot >= 0) {
      const lead = 0.32;
      const u = clamp(1 - (demoAt - gt) / lead);
      const a = clamp((gt - (demoAt - lead - 0.3)) / 0.25) * 0.9;
      drawGhost(g, demoPath, 16, u, a);
    }
    const py = Math.min(r.y + r.h - 22, H * 0.66);
    g.fillStyle = rgba(INK, 0.62);
    roundRect(g, cx - 100, py - 17, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, py, time, PAPER);
  }

  function drawPlay(g: CanvasRenderingContext2D) {
    const ins = session.play();
    const top = ins.top + 12;
    const playing = session.phase === "playing";
    if (playing) {
      g.drawImage(topShade(), 0, 0, W, top + 96);
      // Score.
      const s = scorePop.value;
      g.save();
      g.translate(W / 2, top + 26);
      g.scale(s, s);
      g.font = `40px ${FONT_MONO}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = rgba(INK, 0.55);
      const txt = scoreText(Math.round(counter.shown));
      g.fillText(txt, 2, 2);
      g.fillStyle = PAPER;
      g.fillText(txt, 0, 0);
      g.restore();
      // Streak / heat chip.
      const m = run.mult;
      if (run.streak >= 2) {
        const label = m > 1 ? `×${m} ${HEAT_NAMES[m]} · ${run.streak}` : `${run.streak} IN A ROW`;
        drawLabel(g, label, W / 2, top + 58, m > 1 ? ACCENT : rgba(PAPER, 0.7), 11);
      }
      // Clock (top left): seconds, a bar, and the final-seconds warning.
      const frenzy = run.frenzy;
      const pulse = frenzy ? light.pulse(time, 2, { still: 1 }) : 0;
      g.save();
      g.translate(18, top + 22);
      const cs = clockPop.value;
      g.scale(cs, cs);
      g.font = `30px ${FONT_MONO}`;
      g.textAlign = "left";
      g.textBaseline = "middle";
      const ct = run.buzzer ? "0.0" : shownClock.toFixed(1);
      g.fillStyle = rgba(INK, 0.55);
      g.fillText(ct, 2, 2);
      g.fillStyle = frenzy ? (pulse > 0.5 ? ACCENT : PAPER) : PAPER;
      g.fillText(ct, 0, 0);
      g.restore();
      const bw = 74;
      g.fillStyle = rgba(PAPER, 0.16);
      g.fillRect(18, top + 44, bw, 4);
      g.fillStyle = frenzy ? ACCENT : PAPER;
      g.fillRect(18, top + 44, bw * clamp(shownClock / MAX_CLOCK), 4);
      if (frenzy) drawLabel(g, "MAKES ×2", 18, top + 60, ACCENT, 10, "left");
      // Stage (top right): number, distance, makes to go.
      drawLabel(g, `STAGE ${run.stage + 1}`, W - 16, top + 16, PAPER, 12, "right");
      drawLabel(g, `${stage.dist.toFixed(1)} M`, W - 16, top + 34, rgba(PAPER, 0.7), 11, "right");
      const need = stage.makes;
      const got = Math.min(need, run.stageMakes);
      for (let i = 0; i < need; i++) {
        const x = W - 16 - (need - 1 - i) * 10 - 3;
        g.fillStyle = i < got ? ACCENT : rgba(PAPER, 0.22);
        g.fillRect(x - 3, top + 48, 6, 6);
      }
      const hs = handSlot >= 0 ? handScreen() : null;
      // Bonus ball.
      if (hs && handBonus) drawLabel(g, "BONUS BALL · ×2 POINTS", W / 2, Math.min(H - 20, hs.y + 52), ACCENT, 12);
      // First run: a ghost finger flicking from the ball, until the first make.
      if (!hintSeen && hs && !touching && phase === "ready") {
        const cyc = 1.9;
        const t = (phaseT + time) % cyc;
        const f: Flick = { kind: "shot", dx: 0, dy: -H * 0.27, speed: 1500 };
        const n = flickPath(f, hs.x, hs.y + 20, hintPath, 16);
        const u = clamp((t - 0.35) / 0.4);
        const a = t < 0.25 ? t / 0.25 : t > cyc - 0.35 ? (cyc - t) / 0.35 : 1;
        drawGhost(g, hintPath, n, u, 0.85 * a);
        // A plate under the two lines so the court markings never run through them.
        const hy = Math.min(H - 40, hs.y + 58);
        g.fillStyle = rgba(INK, 0.72);
        roundRect(g, W / 2 - 132, hy - 14, 264, 46, 12);
        g.fill();
        drawLabel(g, "FLICK UP TO SHOOT", W / 2, hy, PAPER, 13);
        drawLabel(g, "LONGER FLICK, FARTHER SHOT", W / 2, hy + 18, rgba(PAPER, 0.8), 11);
      }
      if (toast && hs) {
        const a = toast.t > 0.9 ? 1 - (toast.t - 0.9) / 0.3 : 1;
        g.save();
        g.globalAlpha = a;
        drawLabel(g, toast.text, W / 2, Math.min(H - 60, hs.y - 70), ACCENT, 13);
        g.restore();
      }
    }
    if (session.phase === "over" && endInfo) drawSummary(g);
  }
  const hintPath: Sample[] = [];
  let scoreN = -1;
  let scoreS = "0";
  const scoreText = (n: number) => {
    if (n !== scoreN) {
      scoreN = n;
      scoreS = n.toLocaleString("en-US");
    }
    return scoreS;
  };
  let shade: HTMLCanvasElement | null = null;
  function topShade(): HTMLCanvasElement {
    if (shade) return shade;
    shade = document.createElement("canvas");
    shade.width = 2;
    shade.height = 64;
    const sg = shade.getContext("2d")!;
    const grad = sg.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, rgba(INK, 0.7));
    grad.addColorStop(0.6, rgba(INK, 0.36));
    grad.addColorStop(1, rgba(INK, 0));
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 2, 64);
    return shade;
  }

  /** Game over: what you did, against your best, and one thing to try. Kept clear of the shell's result card. */
  function drawSummary(g: CanvasRenderingContext2D) {
    const t = session.phaseTime;
    const a = clamp((t - 0.35) / 0.3);
    if (a <= 0) return;
    const info = endInfo!;
    const standalone = session.standalone;
    const ins = session.preview();
    const left = 16;
    const right = W - (standalone ? 16 : Math.max(16, ins.right + 8));
    const w = right - left;
    const bottom = H - (standalone ? 40 : ins.bottom + 10);
    const h = 156;
    const y0 = standalone ? H * 0.5 : Math.max(H * 0.585, bottom - h);
    g.save();
    g.globalAlpha = a;
    g.fillStyle = rgba(INK, 0.84);
    roundRect(g, left, y0, w, h, 14);
    g.fill();
    g.fillStyle = ACCENT;
    g.fillRect(left, y0, w, 3);
    const x = left + 16;
    const best = run.best;
    drawLabel(g, "BEST SHOT", x, y0 + 22, DIM, 10, "left");
    drawLabel(g, best ? `${best.points.toLocaleString("en-US")}  ${best.tags[0] ?? ""}` : "NONE YET", x, y0 + 40, best ? PAPER : DIM, 13, "left");
    const mid = left + w * 0.6;
    drawLabel(g, "STREAK", mid, y0 + 22, DIM, 10, "left");
    drawLabel(g, `${run.bestStreak}`, mid, y0 + 40, PAPER, 13, "left");
    drawLabel(g, "MAKES", mid + 60, y0 + 22, DIM, 10, "left");
    drawLabel(g, `${run.makes}/${run.shots}`, mid + 60, y0 + 40, PAPER, 13, "left");
    const prev = info.prevBest;
    const barY = y0 + 66;
    const bw = w - 32;
    g.fillStyle = rgba(PAPER, 0.12);
    roundRect(g, x, barY, bw, 8, 4);
    g.fill();
    const scored = info.score > 0;
    const frac = !scored ? 0 : info.isBest ? 1 : prev ? clamp(info.score / prev) : 1;
    const grow = clamp((t - 0.5) / 0.7);
    if (frac > 0) {
      g.fillStyle = ACCENT;
      roundRect(g, x, barY, Math.max(8, bw * frac * easeInOutCubic(grow)), 8, 4);
      g.fill();
    }
    const line = !scored
      ? "NO BUCKETS YET. ONE FLICK DOES IT."
      : info.isBest
        ? prev
          ? `NEW BEST, +${(info.score - prev).toLocaleString("en-US")} ON YOUR OLD ONE`
          : "FIRST SCORE ON THE BOARD"
        : `${Math.round(frac * 100)}% OF YOUR BEST (${(prev ?? 0).toLocaleString("en-US")})`;
    // Never wider than the panel (it stops short of the shell's action rail).
    g.font = `11px ${FONT_MONO}`;
    spaced(g, 0.9);
    const lw = g.measureText(line).width;
    spaced(g, 0);
    drawLabel(g, line, x, barY + 22, info.isBest && scored ? ACCENT : PAPER, lw > bw ? 10 : 11, "left");
    wrapLabel(g, `NEXT TIME: ${run.hint()}`, x, barY + 46, bw, rgba(PAPER, 0.78));
    g.restore();
    if (standalone && t > 0.8) {
      drawTitle(g, info.score.toLocaleString("en-US"), W / 2, H * 0.36, W - 60, PAPER, 56, rgba(ACCENT, 0.9));
      if (info.isBest && info.score > 0) drawLabel(g, "NEW BEST", W / 2, H * 0.36 + 26, ACCENT, 13);
      g.fillStyle = rgba(INK, 0.62);
      roundRect(g, W / 2 - 110, H * 0.5 + h + 18, 220, 34, 17);
      g.fill();
      drawTapPrompt(g, W / 2, H * 0.5 + h + 35, time, PAPER, "TAP TO SHOOT AGAIN");
    }
  }

  function wrapLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, color: string) {
    const words = text.split(" ");
    let lineText = "";
    let yy = y;
    g.font = `11px ${FONT_MONO}`;
    spaced(g, 0.9);
    for (const word of words) {
      const next = lineText ? `${lineText} ${word}` : word;
      if (g.measureText(next).width > maxW && lineText) {
        drawLabel(g, lineText, x, yy, color, 11, "left");
        lineText = word;
        yy += 16;
      } else lineText = next;
    }
    if (lineText) drawLabel(g, lineText, x, yy, color, 11, "left");
    spaced(g, 0);
  }

  // Compile every shader variant up front so no frame after ready() stalls: light every ball and the rim once.
  update(0);
  for (const b of world.balls) {
    b.mesh.visible = true;
    b.glow.visible = true;
    b.shadow.visible = true;
  }
  world.rimMat.emissiveIntensity = 0.5;
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  for (let i = 0; i < BALL_POOL; i++) if (i !== handSlot) hideBall(i);
  let frames0 = 0;
  titlePop.target = 1;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    renderer.render(scene, camera);
    drawHud();
    if (++frames0 === 2) session.ready();
  });
  session.on("insets", () => titlePop.kick(3));
  session.on("end", () => scorePop.kick(4));
}

void main();
