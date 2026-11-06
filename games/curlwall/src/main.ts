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
import { flickPath, pilotFlick, SKILLS } from "./pilot.ts";
import { ACCENT, buildWorld, KEEPER_SUIT, poseKeeper } from "./scene.ts";
import { createCrowd, S } from "./sfx.ts";
import {
  aimFor,
  BALL_R,
  distanceOf,
  GOAL_H,
  GOAL_HOLD,
  KEEPER_Y,
  KEEPER_Z,
  MAX_BALLS,
  MISS_HOLD,
  newFrames,
  project,
  readFlick,
  Run,
  sampleShot,
  SETUP_T,
  setupFor,
  simulateShot,
  solveKick,
  viewFor,
  type Award,
  type Flick,
  type Outcome,
  type Sample,
  type Setup,
  type Shot,
  type View,
} from "./sim.ts";
import { createStage } from "./stage.ts";

const PAPER = "#F3F0E8";
const INK = "#0D0D10";
const DIM = "#A7A3AE";
const FLICK_MAX = 160;
/** The attract demo plays like a good player, weighing fewer options so lining up a kick costs next to nothing. */
const DEMO = { ...SKILLS.good, candidates: 16 };
/** The finger has to start in the lower part of the screen (where the ball is), but anywhere across it. */
const FLICK_ZONE = 0.38;

const MISS_LABEL: Record<Exclude<Outcome, "goal">, string> = {
  saved: "SAVED",
  blocked: "OFF THE WALL",
  wide: "WIDE",
  over: "OVER THE BAR",
  post: "OFF THE POST",
  short: "TOO SOFT",
};

type Stage = "setup" | "aim" | "flight" | "result" | "over";

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
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "curlwall" }), loadFonts()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<number>("hint")) === 1;
  } catch {
    /* storage unavailable: show the hint */
  }

  const stage = createStage();
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;
  const world = buildWorld(Math.min(4, renderer.capabilities.getMaxAnisotropy()));
  const { scene } = world;
  const camera = new PerspectiveCamera(48, W / H, 0.1, 260);
  stage.onResize((w, h) => {
    W = w;
    H = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  const audio = createAudio();
  const crowdSnd = createCrowd(audio);
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.02, 1.8, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.14, decay: 0.45 });
  const fx = new Particles(500);
  const counter = new Counter(0, 12);
  const scorePop = new Spring(1, 420, 14);
  const titlePop = new Spring(0, 160, 12);
  const ballPops = [0, 1, 2, 3, 4].map(() => new Spring(1, 380, 13));

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let phase: Stage = "setup";
  let phaseT = 0;
  let time = 0;
  let run = new Run();
  let kickN = 0;
  let setup: Setup = setupFor(0, rng);
  let view: View = viewFor(setup.spot, W, H);
  const frames = newFrames();
  let shot: Shot | null = null;
  let shotT = 0;
  let evIdx = 0;
  let decidedDone = false;
  let award: Award | null = null;
  let timeScale = 1;
  let goalGlow = 0;
  let swell = 0;
  let ringBurst = 0;
  let ringBurstI = -1;
  let banners: Banner[] = [];
  let flies: Fly[] = [];
  let shownScore = 0;
  let celebratedBest = false;
  let endSent = false;
  let endInfo: { score: number; best: number | null; isBest: boolean; prevBest: number | null } | null = null;
  let toast: { text: string; t: number } | null = null;
  // Attract pilot.
  let demoFlick: Flick | null = null;
  const demoPath: Sample[] = [];
  let demoQueue: number[] = [];
  // Camera: from where it was to the new spot's view.
  const camFrom = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 48 };
  const camNow = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 48 };
  const look = new Vector3();
  const sample = { bx: 0, by: 0, bz: 0, kx: 0, ky: 0, lift: 0 };
  const scr = { x: 0, y: 0, depth: 0 };
  const pt = { x: 0, y: 0, z: 0 };
  const keeperHands = { x: 0, y: KEEPER_Y };
  const STILL = { still: 0.5 };
  // Ball spin (visual, rad) and rest.
  let spinX = 0;
  let spinY = 0;
  let wSpinX = 0;
  let wSpinY = 0;
  // Input.
  const pts: Sample[] = Array.from({ length: FLICK_MAX }, () => ({ x: 0, y: 0, t: 0 }));
  let nPts = 0;
  let touching = false;
  let touchId = -1;
  let dribble = 0;

  const accent = ACCENT;
  const totalBalls = () => MAX_BALLS;

  function snapCam(v: View) {
    camNow.x = v.cam.x;
    camNow.y = v.cam.y;
    camNow.z = v.cam.z;
    camNow.lx = v.look.x;
    camNow.ly = v.look.y;
    camNow.lz = v.look.z;
    camNow.fov = v.fov;
  }

  function startSetup(n: number) {
    camFrom.x = camNow.x;
    camFrom.y = camNow.y;
    camFrom.z = camNow.z;
    camFrom.lx = camNow.lx;
    camFrom.ly = camNow.ly;
    camFrom.lz = camNow.lz;
    camFrom.fov = camNow.fov;
    kickN = n;
    setup = mode === "attract" ? setupFor(demoN(), rng) : setupFor(n, rng);
    view = viewFor(setup.spot, W, H);
    phase = "setup";
    phaseT = 0;
    shot = null;
    shotT = 0;
    evIdx = 0;
    decidedDone = false;
    award = null;
    timeScale = 1;
    nPts = 0;
    touching = false;
    dribble = 0;
    world.trail.reset();
    world.setSpray(setup.spot.x, setup.spot.z, setup.wall);
    spinX = spinY = 0;
    wSpinX = wSpinY = 0;
    keeperHands.x = setup.keeperX;
    keeperHands.y = KEEPER_Y;
    if (mode === "attract") {
      demoFlick = pilotFlick(setup, view, DEMO, rng);
      const b = project(view, { x: setup.spot.x, y: BALL_R, z: setup.spot.z }, scr);
      flickPath(demoFlick, b.x, b.y + 26, demoPath, 16);
    } else if (n > 0) {
      audio.play(S.whistle, { volume: 0.8 });
    }
  }

  /** Attract cycles through a few mid-run setups so the demo shows walls, curl and the keeper at work. */
  function demoN(): number {
    if (!demoQueue.length) demoQueue = rng.shuffle([2, 3, 4, 5, 6, 7, 8]);
    return demoQueue.pop()!;
  }

  function resetRun(m: "attract" | "play") {
    mode = m;
    run = new Run();
    counter.snap(0);
    shownScore = 0;
    banners = [];
    flies = [];
    fx.clear();
    celebratedBest = false;
    endSent = false;
    endInfo = null;
    toast = null;
    goalGlow = 0;
    swell = 0;
    startSetup(0);
    if (m === "attract") {
      phaseT = SETUP_T;
      snapCam(view);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Kicking
  // -------------------------------------------------------------------------------------------------------------
  function kick(f: Flick) {
    if (phase !== "aim" && !(phase === "setup" && phaseT > SETUP_T * 0.55)) return;
    if (f.kind === "none") return;
    if (f.kind === "soft") {
      // Too lazy to count: the ball rolls a step and comes back. Nothing lost.
      dribble = 0.0001;
      run.softs++;
      toast = { text: "FLICK FASTER", t: 0 };
      audio.play(S.soft);
      return;
    }
    snapCam(view);
    const aim = aimFor(view, setup.spot, f, setup.rings);
    const launch = solveKick(setup.spot, aim, aim.speed, aim.curl);
    shot = simulateShot(setup, launch, frames);
    shotT = 0;
    evIdx = 0;
    decidedDone = false;
    phase = "flight";
    phaseT = 0;
    wSpinX = launch.wx;
    wSpinY = launch.wy;
    world.trail.reset();
    const loud = mode === "play";
    if (loud) {
      const free = run.free;
      run.take();
      if (!free) ballPops[run.balls]?.kick(-6);
      session.feedback("tap");
    }
    const p = clamp((aim.speed - 15) / 16);
    audio.play(S.kick, { volume: loud ? 0.6 + p * 0.4 : 0.35, pitch: p * 3 });
    audio.play(S.kickSnap, { volume: loud ? 0.5 + p * 0.5 : 0.25 });
    if (loud) crowdSnd.hush();
    const b = project(view, { x: setup.spot.x, y: BALL_R, z: setup.spot.z }, scr);
    fx.emit(b.x, b.y + 8, { count: 10, speed: [60, 200], angle: [Math.PI * 1.1, Math.PI * 1.9], life: [0.25, 0.5], size: [2, 4], colors: ["#2E6B3F", "#4F8F5A", PAPER], gravity: 500, drag: 2 });
    shake.add(0.08 + p * 0.1);
  }

  function onEvent(kind: string, x: number, y: number, z: number) {
    const loud = mode === "play";
    const vol = loud ? 1 : 0.45;
    const s = project(camView(), { x, y, z }, scr);
    switch (kind) {
      case "wall":
        audio.play(S.wallThud, { volume: vol });
        shake.add(0.22);
        fx.emit(s.x, s.y, { count: 12, speed: [80, 220], life: [0.25, 0.5], size: [2, 4], colors: [PAPER, accent], drag: 3 });
        if (loud) session.feedback("impact");
        break;
      case "post":
      case "bar":
        audio.play(S.post, { volume: vol });
        audio.play(S.postThud, { volume: vol });
        shake.add(0.4);
        hitStop.freeze(reduced ? 0 : 0.05);
        fx.emit(s.x, s.y, { count: 16, speed: [120, 320], life: [0.25, 0.55], size: [2, 3.5], colors: [PAPER, "#FFE9A8"], drag: 3, shape: "spark" });
        if (loud) session.feedback("impact");
        break;
      case "save":
        audio.play(S.glove, { volume: vol });
        shake.add(0.28);
        fx.emit(s.x, s.y, { count: 14, speed: [80, 240], life: [0.25, 0.5], size: [2, 4], colors: [PAPER, KEEPER_SUIT], drag: 3 });
        if (loud) session.feedback("impact");
        break;
      case "net":
        world.net.hit(x, y, z, shot ? shot.speed : 20);
        audio.play(S.netThump, { volume: vol * 0.8 });
        break;
      case "goal":
        audio.play(S.swish, { volume: vol });
        break;
      case "bounce":
        if (z > 1) audio.play(S.bounce, { volume: vol * 0.6 });
        break;
    }
  }

  /** The moment the shot is decided: score it, celebrate or commiserate. */
  function decide(s: Shot) {
    decidedDone = true;
    const loud = mode === "play";
    if (s.outcome === "goal") {
      const cx = s.cross ? s.cross.x : 0;
      const cy = s.cross ? s.cross.y : 1;
      const p = project(camView(), { x: cx, y: cy, z: 0 }, scr);
      const px = p.x;
      const py = p.y;
      goalGlow = 1;
      swell = 1;
      const corner = s.corner >= 0;
      if (corner) {
        ringBurst = 0.0001;
        ringBurstI = s.corner;
        audio.play(S.ring, { volume: loud ? 1 : 0.4 });
      }
      crowdSnd.swell(corner ? 1 : 0.75);
      flash.trigger(accent, corner ? 0.9 : 0.55);
      hitStop.freeze(reduced ? 0 : corner ? 0.09 : 0.05);
      shake.add(corner ? 0.45 : 0.3);
      fx.emit(px, py, { count: corner ? 70 : 40, speed: [140, 460], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.7, 1.3], size: [3, 7], colors: [accent, PAPER, KEEPER_SUIT, "#7CC4FF"], gravity: 520, drag: 1.4, spin: [-8, 8] });
      if (loud) {
        award = run.settle(s, distanceOf(setup));
        const a = award;
        const note = PENTATONIC[Math.min(run.streak - 1, PENTATONIC.length - 1)]!;
        audio.note(midiToFreq(67 + note), 0.3, "triangle", 0.22);
        if (a.tierUp) window.setTimeout(() => audio.play(S.tier), 160);
        flies.push({ value: a.points, x: px, y: py - 20, t: 0, label: `+${a.points}` });
        const tags = a.tags.slice(0, 2).join(" · ");
        banners = [{ text: corner && s.bend >= 1 ? "WHAT A HIT" : "GOAL", sub: tags + (a.mult > 1 ? `${tags ? "  " : ""}×${a.mult}` : ""), color: accent, t: 0, life: GOAL_HOLD + 0.2, big: true }];
        for (let i = 0; i < a.refund; i++) ballPops[Math.max(0, run.balls - 1 - i)]?.kick(8);
        if (corner) audio.play(S.ballBack, { pitch: 5 });
        session.feedback("success");
        if (!hintSeen) {
          hintSeen = true;
          tc.storage.set("hint", 1).catch(() => undefined);
        }
        const best = session.best;
        if (!celebratedBest && best !== null && best > 0 && run.score > best) {
          celebratedBest = true;
          window.setTimeout(() => {
            if (mode !== "play") return;
            banners.push({ text: "NEW BEST", sub: "KEEP GOING", color: accent, t: 0, life: 1.4, big: false });
            audio.play(S.best);
            fx.emit(W * 0.2, H * 0.3, { count: 30, speed: [200, 480], angle: [-Math.PI * 0.45, -Math.PI * 0.05], life: [0.8, 1.4], size: [3, 6], colors: [accent, PAPER], gravity: 600, drag: 1.4 });
            fx.emit(W * 0.8, H * 0.3, { count: 30, speed: [200, 480], angle: [-Math.PI * 0.95, -Math.PI * 0.55], life: [0.8, 1.4], size: [3, 6], colors: [accent, PAPER], gravity: 600, drag: 1.4 });
          }, 700);
        }
      } else {
        banners = [{ text: "GOAL", sub: "", color: accent, t: 0, life: GOAL_HOLD, big: true }];
      }
    } else {
      crowdSnd.groan();
      if (loud) {
        run.settle(s, distanceOf(setup));
        const freeKick = run.lastWasFree;
        banners = [{ text: MISS_LABEL[s.outcome], sub: freeKick ? "THAT ONE WAS ON THE HOUSE" : run.balls === 1 ? "LAST BALL" : run.balls === 0 ? "" : `${run.balls} BALLS LEFT`, color: PAPER, t: 0, life: MISS_HOLD + 0.1, big: false }];
        if (!freeKick) audio.play(S.ballLost);
      } else {
        banners = [{ text: MISS_LABEL[s.outcome], sub: "", color: PAPER, t: 0, life: MISS_HOLD, big: false }];
      }
    }
  }

  function endRun() {
    if (endSent) return;
    endSent = true;
    const prevBest = session.best;
    const r = session.end(run.score, { outcome: "lose", stats: { goals: run.goals, kicks: run.kicks, corners: run.corners, streak: run.bestStreak } });
    endInfo = { score: run.score, best: r.best, isBest: r.isBest, prevBest };
    phase = "over";
    phaseT = 0;
    if (r.isBest && run.score > 0) {
      audio.play(S.best);
      fx.emit(W * 0.15, H * 0.62, { count: 40, speed: [220, 520], angle: [-Math.PI * 0.45, -Math.PI * 0.1], life: [0.9, 1.6], size: [3, 7], colors: [accent, PAPER, KEEPER_SUIT], gravity: 600, drag: 1.3 });
      fx.emit(W * 0.85, H * 0.62, { count: 40, speed: [220, 520], angle: [-Math.PI * 0.9, -Math.PI * 0.55], life: [0.9, 1.6], size: [3, 7], colors: [accent, PAPER, KEEPER_SUIT], gravity: 600, drag: 1.3 });
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: a tap starts a run; during a run, an upward flick from the lower part of the screen kicks.
  // -------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  const canAim = () => mode === "play" && session.phase === "playing" && (phase === "aim" || (phase === "setup" && phaseT > SETUP_T * 0.55));
  window.addEventListener("pointerdown", (e) => {
    if (!canAim() || touching) return;
    if (e.clientY < H * FLICK_ZONE) return;
    touching = true;
    touchId = e.pointerId;
    nPts = 0;
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
    if (canAim()) kick(readFlick(pts, nPts));
    nPts = 0;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== touchId) return;
    touching = false;
    nPts = 0;
  });
  session.on("cancel", () => {
    touching = false;
    nPts = 0;
  });
  function addPt(x: number, y: number, t: number) {
    if (nPts >= FLICK_MAX) {
      // Very long drags: keep every other sample.
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
  // Desktop testing: arrow keys take a stock kick (up = straight at the top corner, left/right = bent).
  const keyKick = (bow: number, dx: number) => {
    if (!canAim()) return;
    kick({ kind: "kick", dx, dy: -260, speed: 1900, bow });
  };
  onKeys({ up: () => keyKick(0, 70), left: () => keyKick(0.12, -40), right: () => keyKick(-0.12, 40) });

  session.on("start", () => resetRun("play"));
  session.on("attract", () => resetRun("attract"));
  resetRun("attract");

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  function camView(): View {
    // The current camera as a View (for projecting effects); aim maths always uses the kick's exact view.
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
  const tmpView: View = { cam: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 48, aspect: 1, width: 1, height: 1 };

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    const hs = hitStop.scale(rawDt);
    // Slow motion around post rattles and fingertip near misses.
    let want = 1;
    if (shot && phase === "flight")
      for (let i = 0; i < shot.slow.length; i++) {
        const w = shot.slow[i]!;
        if (shotT >= w[0] && shotT <= w[1]) want = reduced ? 0.5 : 0.28;
      }
    timeScale = damp(timeScale, want, want < timeScale ? 30 : 9, rawDt);
    const dt = hs * timeScale;
    phaseT += rawDt;
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(rawDt);
    counter.update(rawDt);
    scorePop.update(rawDt);
    titlePop.update(rawDt);
    for (const b of ballPops) b.update(rawDt);
    goalGlow = Math.max(0, goalGlow - rawDt * 0.45);
    swell = Math.max(0, swell - rawDt * 0.42);
    if (ringBurst > 0) ringBurst = ringBurst + rawDt * 1.6 >= 1 ? 0 : ringBurst + rawDt * 1.6;
    for (const b of banners) b.t += rawDt;
    if (banners.length && banners.some((b) => b.t > b.life)) banners = banners.filter((b) => b.t <= b.life);
    if (toast) {
      toast.t += rawDt;
      if (toast.t > 1.3) toast = null;
    }
    crowdSnd.tick();
    // Points fly into the counter, which ticks up when they land.
    for (const f of flies) {
      f.t += rawDt;
      if (f.t >= 0.62 && f.value) {
        shownScore += f.value;
        counter.set(shownScore);
        scorePop.kick(7);
        audio.play(S.tick, { pitch: 7 });
        f.value = 0;
      }
    }
    if (flies.length && flies.every((f) => f.t > 0.8)) flies = [];

    switch (phase) {
      case "setup": {
        const k = clamp(phaseT / SETUP_T);
        const e = reduced ? (k < 0.5 ? 0 : 1) : easeInOutCubic(k);
        camNow.x = lerp(camFrom.x, view.cam.x, e);
        camNow.y = lerp(camFrom.y, view.cam.y, e);
        camNow.z = lerp(camFrom.z, view.cam.z, e);
        camNow.lx = lerp(camFrom.lx, view.look.x, e);
        camNow.ly = lerp(camFrom.ly, view.look.y, e);
        camNow.lz = lerp(camFrom.lz, view.look.z, e);
        camNow.fov = lerp(camFrom.fov, view.fov, e);
        if (phaseT >= SETUP_T) {
          phase = "aim";
          phaseT = 0;
          snapCam(view);
        }
        placeIdle();
        break;
      }
      case "aim": {
        snapCam(view);
        placeIdle();
        if (mode === "attract" && demoFlick && phaseT > 0.55 + demoDur()) kick(demoFlick);
        break;
      }
      case "flight":
      case "result": {
        const s = shot!;
        shotT = Math.min(s.end, shotT + dt);
        while (evIdx < s.events.length && s.events[evIdx]!.t <= shotT) {
          const ev = s.events[evIdx++]!;
          onEvent(ev.kind, ev.x, ev.y, ev.z);
        }
        if (!decidedDone && shotT >= s.decided) {
          decide(s);
          phase = "result";
          phaseT = 0;
        }
        placeShot(s, dt);
        if (phase === "result") {
          const hold = s.outcome === "goal" ? GOAL_HOLD : MISS_HOLD;
          // The last ball: end quickly (gameplay.end within a second of game over).
          if (mode === "play" && run.over && phaseT > 0.6) endRun();
          else if (phaseT >= hold) {
            if (mode === "play") startSetup(kickN + 1);
            else startSetup(0);
          }
        }
        break;
      }
      case "over":
        placeShot(shot!, dt);
        break;
    }
    if (dribble > 0) {
      dribble += rawDt;
      if (dribble > 0.7) dribble = 0;
    }

    // Camera: shake as a small offset, then aim.
    const o = shake.offset;
    camera.position.set(camNow.x + o.x * 0.012, camNow.y + o.y * 0.012, camNow.z);
    look.set(camNow.lx + o.x * 0.01, camNow.ly + o.y * 0.01, camNow.lz);
    camera.lookAt(look);
    camera.rotateZ(o.angle);
    if (camera.fov !== camNow.fov) {
      camera.fov = camNow.fov;
      camera.updateProjectionMatrix();
    }

    // Ambient pieces.
    world.crowd.set(time, swell, goalGlow);
    world.setBoards(rawDt, goalGlow > 0.25, light.pulse(time, 1.2) * goalGlow);
    world.setRings(setup.rings, light.pulse(time, 0.6, STILL), ringBurst, ringBurstI);
    world.net.update(dt);
    world.trail.update(camera, phase === "flight" || phase === "result" ? clamp(1 - (shotT - (shot?.decided ?? 0)) * 1.2) : 0);
  }

  function demoDur(): number {
    if (!demoFlick) return 0;
    return Math.hypot(demoFlick.dx, demoFlick.dy) / Math.max(200, demoFlick.speed);
  }

  /** Waiting for the kick: ball on the spot, keeper on his toes, the wall shuffling. */
  function placeIdle() {
    const roll = dribble > 0 ? Math.sin(clamp(dribble / 0.7) * Math.PI) * 0.45 : 0;
    world.ball.position.set(setup.spot.x - (setup.spot.x / Math.hypot(setup.spot.x, setup.spot.z)) * roll, BALL_R, setup.spot.z - roll);
    world.ball.rotation.set(-roll * 4, 0, 0);
    world.setShadow(world.ballShadow, world.ball.position.x, world.ball.position.z, 0.42, 1);
    const sway = Math.sin(time * 1.6) * 0.06;
    poseKeeper(world.keeper, setup.keeperX + sway, KEEPER_Y, setup.keeperX, time, 1);
    world.setShadow(world.keeperShadow, world.keeper.root.position.x, 0.3, 1.1, 1);
    world.setWall(setup.wall, 0, time);
  }

  function placeShot(s: Shot, dt: number) {
    sampleShot(s, shotT, sample);
    world.ball.position.set(sample.bx, sample.by, sample.bz);
    // Visible spin: a fraction of the real rate so the chevrons read instead of strobing.
    const k = Math.exp(-0.45 * shotT);
    spinX += wSpinX * k * dt * 0.35;
    spinY += wSpinY * k * dt * 0.35;
    world.ball.rotation.set(spinX, spinY, 0);
    world.setShadow(world.ballShadow, sample.bx, sample.bz, 0.42 + sample.by * 0.12, 1);
    if (phase === "flight") world.trail.push(sample.bx, sample.by, sample.bz);
    // His gloves go to the ball as it arrives (the save itself is decided in the sim by the same distance).
    let hx = sample.kx;
    let hy = sample.ky;
    const near = clamp(1 - (sample.bz - KEEPER_Z) / 4) * clamp(1 - Math.hypot(sample.bx - sample.kx, sample.by - sample.ky) / 1.6);
    if (near > 0 && phase === "flight" && sample.bz > KEEPER_Z - 0.2) {
      const k = near * near * 0.9;
      hx += (sample.bx - hx) * k;
      hy += (sample.by - hy) * k;
    }
    keeperHands.x = damp(keeperHands.x, hx, 30, dt || 1 / 60);
    keeperHands.y = damp(keeperHands.y, hy, 30, dt || 1 / 60);
    poseKeeper(world.keeper, keeperHands.x, keeperHands.y, setup.keeperX, time, shotT < setup.keeper.react ? 1 : 0);
    world.setShadow(world.keeperShadow, world.keeper.root.position.x, 0.3, 1.2, 1);
    world.setWall(setup.wall, sample.lift, time);
    // Camera: pans with the ball and creeps in a little; settles once it's decided.
    if (phase !== "over") {
      const follow = reduced ? 0.12 : 0.32;
      const lx = view.look.x + (sample.bx - view.look.x) * follow;
      const ly = view.look.y + (clamp(sample.by, 0, GOAL_H + 1) - view.look.y) * follow * 0.6;
      const creep = reduced ? 0 : Math.min(1, shotT / 1.2) * 1.6;
      const dl = Math.hypot(setup.spot.x, setup.spot.z) || 1;
      camNow.lx = damp(camNow.lx, lx, 6, dt || 1 / 60);
      camNow.ly = damp(camNow.ly, ly, 6, dt || 1 / 60);
      camNow.lz = view.look.z;
      camNow.x = view.cam.x - (setup.spot.x / dl) * creep;
      camNow.z = view.cam.z - (setup.spot.z / dl) * creep;
      camNow.y = view.cam.y;
      camNow.fov = view.fov;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------------------------------------------
  function drawBall(g: CanvasRenderingContext2D, x: number, y: number, r: number, full: boolean, s = 1) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    if (full) {
      g.fillStyle = PAPER;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK;
      g.beginPath();
      g.moveTo(-r * 0.45, -r * 0.2);
      g.lineTo(r * 0.1, -r * 0.55);
      g.lineTo(r * 0.5, -r * 0.05);
      g.lineTo(-r * 0.05, r * 0.3);
      g.closePath();
      g.fill();
      g.fillStyle = accent;
      g.fillRect(-r, r * 0.38, r * 2, r * 0.2);
    } else {
      g.strokeStyle = rgba(PAPER, 0.35);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(0, 0, r - 1, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  function spaced(g: CanvasRenderingContext2D, px: number) {
    (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  }

  function drawGhost(g: CanvasRenderingContext2D, path: Sample[], n: number, u: number, alpha: number) {
    if (n < 2 || alpha <= 0) return;
    const last = Math.min(n - 1, Math.floor(u * (n - 1)));
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = accent;
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

  function drawHud() {
    stage.beginHud();
    const g = hud;
    fx.draw(g);
    pt.x = world.ball.position.x;
    pt.y = BALL_R;
    pt.z = world.ball.position.z;
    const ball = project(camView(), pt, scr);
    const bx = ball.x;
    const by = ball.y;

    // Live touch: the finger's path, drawn the same frame it moves.
    if (touching && nPts > 1) {
      g.save();
      g.strokeStyle = rgba(accent, 0.75);
      g.lineWidth = 6;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < nPts; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
      g.stroke();
      g.restore();
    }
    if (touching && nPts > 0) {
      const p = pts[nPts - 1]!;
      g.strokeStyle = rgba(PAPER, 0.8);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, 22, 0, Math.PI * 2);
      g.stroke();
    }

    if (mode === "attract") {
      drawAttract(g, bx, by);
    } else {
      drawPlay(g, bx, by);
    }

    // Banners.
    for (const b of banners) {
      const k = b.t / b.life;
      const pop = b.t < 0.18 ? easeOutBack(b.t / 0.18) : 1;
      const a = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      const y = (mode === "attract" ? H * 0.62 : H * 0.235) - (reduced ? 0 : (1 - pop) * 14);
      g.save();
      g.globalAlpha = a;
      g.translate(W / 2, y);
      g.scale(pop, pop);
      const size = mode === "attract" ? (b.big ? 34 : 24) : b.big ? 54 : 30;
      // An ink plate behind the word so it reads over floodlights and stands.
      g.font = `900 ${size}px ${FONT_DISPLAY}`;
      spaced(g, -size * 0.02);
      const tw = Math.min(W - 40, g.measureText(b.text).width);
      g.fillStyle = rgba(INK, 0.8);
      roundRect(g, -tw / 2 - 18, -size * 0.8, tw + 36, size * 1.08 + (b.sub ? 30 : 0), 10);
      g.fill();
      drawTitle(g, b.text, 0, 0, W - 50, b.color, size, b.big ? rgba(INK, 0.9) : undefined);
      if (b.sub) drawLabel(g, b.sub, 0, size * 0.28 + 6, b.big ? PAPER : DIM, 12);
      g.restore();
    }
    // Points flying to the score.
    for (const f of flies) {
      if (f.t > 0.8) continue;
      const u = clamp(f.t / 0.62);
      const e = u * u * (3 - 2 * u);
      const tx = W / 2;
      const ty = session.play().top + 40;
      const x = lerp(f.x, tx, e);
      const y = lerp(f.y, ty, e) - Math.sin(u * Math.PI) * 60;
      g.save();
      g.globalAlpha = u >= 1 ? clamp(1 - (f.t - 0.62) / 0.18) : 1;
      g.font = `${Math.round(lerp(30, 18, e))}px ${FONT_MONO}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = INK;
      g.fillText(f.label, x + 2, y + 2);
      g.fillStyle = accent;
      g.fillText(f.label, x, y);
      g.restore();
    }
    flash.draw(g, W, H);
  }

  function drawAttract(g: CanvasRenderingContext2D, bx: number, by: number) {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(clamp(titlePop.value));
    g.save();
    g.translate(cx, r.y + 52);
    g.scale(k, k);
    drawTitle(g, "CURLWALL", 0, 0, r.w - 8, PAPER, 50, rgba(accent, 0.9));
    g.restore();
    drawLabel(g, "BEND IT ROUND THE WALL", cx, r.y + 78, rgba(PAPER, 0.8), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 98, accent, 13);
    // The demo's ghost finger shows the verb.
    if (demoFlick && phase === "aim") {
      const u = clamp((phaseT - 0.55) / Math.max(0.05, demoDur()));
      drawGhost(g, demoPath, 16, u, phaseT < 0.55 ? clamp(phaseT / 0.3) * 0.9 : 0.9);
    }
    void bx;
    void by;
    const py = Math.min(r.y + r.h - 22, H * 0.74);
    g.fillStyle = rgba(INK, 0.62);
    roundRect(g, cx - 100, py - 17, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, py, time, PAPER);
  }

  function drawPlay(g: CanvasRenderingContext2D, bx: number, by: number) {
    const ins = session.play();
    const top = ins.top + 14;
    const playing = session.phase === "playing";
    if (playing) {
      // A soft ink fade behind the HUD row so it reads over the floodlit stand.
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
      // Streak: multiplier chip plus pips toward the next tier.
      const m = run.mult;
      if (run.streak > 1) {
        const label = m > 1 ? `×${m} STREAK ${run.streak}` : `STREAK ${run.streak}`;
        drawLabel(g, label, W / 2, top + 58, m > 1 ? accent : rgba(PAPER, 0.7), 11);
      }
      // Balls (top left).
      const free = phase === "flight" || phase === "result" ? run.lastWasFree : run.free;
      for (let i = 0; i < totalBalls(); i++) {
        const full = i < run.balls;
        drawBall(g, 26 + i * 26, top + 22, 9, full, ballPops[i]!.value);
      }
      if (free) drawLabel(g, "FREE BALL", 16, top + 46, accent, 10, "left");
      // Distance and wind (top right).
      const dist = Math.round(distanceOf(setup));
      drawLabel(g, `${dist} M`, W - 16, top + 18, PAPER, 13, "right");
      if (setup.wind !== 0) {
        const w = setup.wind;
        const n = Math.min(3, Math.max(1, Math.round(Math.abs(w) / 0.8)));
        const arrow = w > 0 ? ">".repeat(n) : "<".repeat(n);
        drawLabel(g, `WIND ${w > 0 ? "" : arrow + " "}${Math.abs(w).toFixed(1)}${w > 0 ? " " + arrow : ""}`, W - 16, top + 38, rgba(PAPER, 0.75), 11, "right");
      }
      // First-run hint: a ghost finger flicking from the ball, until the first goal.
      if (!hintSeen && phase === "aim" && !touching) {
        const cyc = 2.1;
        const t = phaseT % cyc;
        const f: Flick = { kind: "kick", dx: 64, dy: -250, speed: 1500, bow: -0.08 };
        const n = flickPath(f, bx - 10, by + 30, hintPath, 16);
        const u = clamp((t - 0.35) / 0.55);
        const a = t < 0.25 ? t / 0.25 : t > cyc - 0.35 ? (cyc - t) / 0.35 : 1;
        drawGhost(g, hintPath, n, u, 0.85 * a);
        drawLabel(g, "FLICK UP TO SHOOT", W / 2, Math.min(H - 34, by + 44), PAPER, 13);
        drawLabel(g, "BOW YOUR SWIPE TO BEND IT", W / 2, Math.min(H - 16, by + 62), rgba(PAPER, 0.72), 11);
      }
      if (toast) {
        const a = toast.t > 1 ? 1 - (toast.t - 1) / 0.3 : 1;
        g.save();
        g.globalAlpha = a;
        drawLabel(g, toast.text, W / 2, Math.min(H - 60, by + 60), accent, 14);
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
    grad.addColorStop(0.6, rgba(INK, 0.38));
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
    // In the feed the result card covers the top ~58% of the screen; sit below it, above the caption.
    const bottom = H - (standalone ? 40 : ins.bottom + 10);
    const h = 156;
    const y0 = standalone ? H * 0.5 : Math.max(H * 0.585, bottom - h);
    g.save();
    g.globalAlpha = a;
    g.fillStyle = rgba(INK, 0.82);
    roundRect(g, left, y0, w, h, 14);
    g.fill();
    g.fillStyle = accent;
    g.fillRect(left, y0, w, 3);
    const best = run.best;
    const x = left + 16;
    drawLabel(g, "BEST GOAL", x, y0 + 22, DIM, 10, "left");
    drawLabel(g, best ? `${best.points.toLocaleString("en-US")}${best.tags.length ? "  " + best.tags[0] : ""}` : "NONE YET", x, y0 + 40, best ? PAPER : DIM, 13, "left");
    const mid = left + w * 0.62;
    drawLabel(g, "STREAK", mid, y0 + 22, DIM, 10, "left");
    drawLabel(g, `${run.bestStreak}`, mid, y0 + 40, PAPER, 13, "left");
    drawLabel(g, "GOALS", mid + 56, y0 + 22, DIM, 10, "left");
    drawLabel(g, `${run.goals}/${run.kicks}`, mid + 56, y0 + 40, PAPER, 13, "left");
    // Progress against your best.
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
      g.fillStyle = accent;
      roundRect(g, x, barY, Math.max(8, bw * frac * easeInOutCubic(grow)), 8, 4);
      g.fill();
    }
    const line = !scored
      ? "NO GOALS YET. IT ONLY TAKES ONE."
      : info.isBest
        ? prev
          ? `NEW BEST, +${(info.score - prev).toLocaleString("en-US")} ON YOUR OLD ONE`
          : "FIRST SCORE ON THE BOARD"
        : `${Math.round(frac * 100)}% OF YOUR BEST (${(prev ?? 0).toLocaleString("en-US")})`;
    drawLabel(g, line, x, barY + 22, info.isBest && scored ? accent : PAPER, 11, "left");
    // One concrete thing to try.
    g.font = `11px ${FONT_MONO}`;
    const hint = run.hint();
    wrapLabel(g, `NEXT TIME: ${hint}`, x, barY + 46, bw, rgba(PAPER, 0.78));
    g.restore();
    if (standalone && t > 0.8) {
      drawTitle(g, info.score.toLocaleString("en-US"), W / 2, H * 0.36, W - 60, PAPER, 56, rgba(accent, 0.9));
      if (info.isBest && info.score > 0) drawLabel(g, "NEW BEST", W / 2, H * 0.36 + 26, accent, 13);
      g.fillStyle = rgba(INK, 0.62);
      roundRect(g, W / 2 - 110, H * 0.5 + h + 18, 220, 34, 17);
      g.fill();
      drawTapPrompt(g, W / 2, H * 0.5 + h + 35, time, PAPER, "TAP TO GO AGAIN");
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

  // Compile every shader variant up front so no frame after ready() stalls.
  update(0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
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
