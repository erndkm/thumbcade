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
  easeOutCubic,
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
import type { Rng } from "@thumbcade-games/kit/rng";
import { thumbcade as tc } from "@thumbcade/sdk";
import { PerspectiveCamera, Vector3 } from "three";
import { aimView, BALL_D0, BALL_R, chaseView, D_HEAD, D_PIT, PIN_COUNT, project, SPOTS, type View } from "./lane.ts";
import { newHabit, pilotFlick, SKILLS, type Habit, type Skill } from "./pilot.ts";
import { FRAME_STRIDE, isSplit, newFrames, PIN_F, BALL_F, sampleThrow, simulateThrow, type PinEvent, type Throw } from "./pins.ts";
import { BUMPER_RACKS, chainName, CLUTCH_T, FIRST_BALL_T, HOLD_T, MAX_CLOCK, Run, RESET_T } from "./run.ts";
import { ACCENT, buildWorld, HEAT, INK, PAPER, type PinVisual } from "./scene.ts";
import { createRumble, S } from "./sfx.ts";
import { createStage } from "./stage.ts";
import { aimFor, flickFor, flickPath, headingThrough, pocketFor, readFlick, spareTarget, type Flick, type Sample } from "./throw.ts";

const DIM = "#A7A3AE";
const FLICK_MAX = 160;
/** The finger has to start in the lower part of the screen (where the ball is), but anywhere across it. */
const FLICK_ZONE = 0.38;
/** The attract demo bowls like a good player who never botches one. */
const DEMO: Skill = { ...SKILLS.good, blunder: 0, think: [0.55, 0.95] };
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good`); a normal build has none. */
const QA_AUTOPLAY: Skill | null = (SKILLS as Record<string, Skill>)[import.meta.env.VITE_AUTOPLAY ?? ""] ?? null;
const SLOWMO = 0.35;
const SLOWMO_T = 0.5;

type Phase = "intro" | "aim" | "roll" | "reset" | "over";

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
  label: string;
  x: number;
  t: number;
  lane: number;
  to: "score" | "clock";
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "clatterlane" }), loadFonts()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<number>("hint")) === 1;
  } catch {
    /* storage unavailable: show the hint */
  }

  const stageGfx = createStage({ clear: 0x04050a });
  const { renderer, hud } = stageGfx;
  let W = stageGfx.width;
  let H = stageGfx.height;
  const world = buildWorld(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const { scene } = world;
  const camera = new PerspectiveCamera(34, W / H, 0.05, 80);
  let base: View = aimView(W, H);

  const audio = createAudio();
  const rumble = createRumble(audio);
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.02, 2.0, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.14, decay: 0.45 });
  const fx = new Particles(700);
  const counter = new Counter(0, 12);
  const scorePop = new Spring(1, 420, 14);
  const clockPop = new Spring(1, 420, 14);
  const titlePop = new Spring(0, 160, 12);
  const ballPop = new Spring(1, 320, 14);

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let phase: Phase = "intro";
  let phaseT = 0;
  let time = 0;
  let run = new Run(rng);
  let habit: Habit = newHabit(DEMO, rng);
  const frames = newFrames();
  const sample = new Float32Array(FRAME_STRIDE);
  let th: Throw | null = null;
  let pt = 0;
  let evIdx = 0;
  let decided = false;
  let holdT = 0;
  let slowT = -1;
  let buzzerRoll = false;
  let banners: Banner[] = [];
  let fly: Fly[] = [];
  let shownScore = 0;
  let shownClock = 0;
  let celebratedBest = false;
  let endSent = false;
  let endInfo: { score: number; best: number | null; isBest: boolean; prevBest: number | null } | null = null;
  let toast: { text: string; t: number; color: string } | null = null;
  let heat = 0;
  let pulse = 0;
  let camK = 0;
  let camFromK = 0;
  let lastTick = -1;
  let bumperH = 1;
  let endAt = -1;
  /** Pins as drawn (from the playback, the reset animation, or the rack). */
  const vis: PinVisual[] = Array.from({ length: PIN_COUNT }, (_, i) => ({ x: SPOTS[i]!.x, y: 0, d: SPOTS[i]!.d, ux: 0, ud: 1, th: 0, lift: 0, hidden: false }));
  const lastPins: PinVisual[] = vis.map((v) => ({ ...v }));
  let resetFull = true;
  let resetStanding: boolean[] = [];
  let sweepSound = false;
  let rackSound = false;
  // Attract pilot.
  let demoFlick: Flick | null = null;
  let demoAt = 0;
  const demoPath: Sample[] = [];
  let qaAt = 0;
  // Input.
  const pts: Sample[] = Array.from({ length: FLICK_MAX }, () => ({ x: 0, y: 0, t: 0 }));
  let nPts = 0;
  let touching = false;
  let touchId = -1;
  let queued: { f: Flick; at: number } | null = null;
  const scr = { x: 0, y: 0, depth: 0 };
  let viewNow: View = base;
  const lastBall = { x: 0, d: BALL_D0 };
  const look = new Vector3();

  stageGfx.onResize((w, h) => {
    W = w;
    H = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    base = aimView(W, H);
  });

  // -------------------------------------------------------------------------------------------------------------
  // Rack and run setup
  // -------------------------------------------------------------------------------------------------------------
  function rackPins(standing: readonly boolean[]) {
    for (let i = 0; i < PIN_COUNT; i++) {
      const v = vis[i]!;
      v.x = SPOTS[i]!.x + run.jitter[i * 2]! * 0.004;
      v.y = 0;
      v.d = SPOTS[i]!.d + run.jitter[i * 2 + 1]! * 0.004;
      v.ux = 0;
      v.ud = 1;
      v.th = 0;
      v.lift = 0;
      v.hidden = !standing[i];
    }
  }

  /** Each run's racks (and a QA pilot's flicks) come from its own seed, so a run replays the same whatever the demo did. */
  let runRng: Rng = rng;
  function resetRun(m: "attract" | "play") {
    mode = m;
    runRng = m === "play" ? createRng(((session.ctx.seed ^ 0x5bd1e995) >>> 0) + session.runs * 7919) : rng;
    run = new Run(runRng);
    habit = newHabit(m === "attract" ? DEMO : (QA_AUTOPLAY ?? DEMO), runRng);
    th = null;
    decided = false;
    banners = [];
    fly = [];
    fx.clear();
    counter.snap(0);
    shownScore = 0;
    shownClock = run.clock;
    celebratedBest = false;
    endSent = false;
    endInfo = null;
    toast = null;
    lastTick = -1;
    buzzerRoll = false;
    queued = null;
    endAt = -1;
    demoFlick = null;
    heat = 0;
    camK = 0;
    bumperH = m === "play" ? 1 : 0;
    world.clearTrail();
    rackPins(run.standing);
    phase = m === "play" ? "intro" : "aim";
    phaseT = 0;
    ballPop.value = 0.3;
    ballPop.velocity = 0;
    ballPop.target = 1;
    if (m === "attract") planDemo();
  }

  // -------------------------------------------------------------------------------------------------------------
  // Throwing
  // -------------------------------------------------------------------------------------------------------------
  const canThrow = () => phase === "aim" && !run.buzzer && (mode === "attract" || session.phase === "playing");

  function bowl(f: Flick) {
    if (!canThrow() || f.kind === "none") return;
    if (f.kind === "soft") {
      toast = { text: "FLICK A LITTLE FASTER", t: 0, color: ACCENT };
      audio.play(S.soft);
      ballPop.kick(-3);
      return;
    }
    const loud = mode === "play";
    const aim = aimFor(base, f, run.standing, run.rack, run.bumpers && loud);
    th = simulateThrow(aim.input, run.standing, frames, run.jitter);
    pt = 0;
    evIdx = 0;
    decided = false;
    slowT = -1;
    phase = "roll";
    phaseT = 0;
    world.clearTrail();
    demoFlick = null;
    audio.play(S.release, { volume: loud ? 1 : 0.35 });
    audio.play(S.drop, { volume: loud ? 0.8 : 0.3 });
    if (loud) session.feedback("tap");
    shake.add(0.05);
  }

  function screenOf(x: number, y: number, d: number) {
    return project(camView(), x, y, d, scr);
  }

  function onPinEvent(e: PinEvent) {
    const loud = mode === "play";
    const vol = loud ? 1 : 0.35;
    const p = clamp(e.power / 6);
    switch (e.kind) {
      case "ball": {
        const first = e.n <= 1;
        if (first) {
          audio.play(S.crash, { volume: vol * (0.6 + p * 0.4) });
          audio.play(S.crashLow, { volume: vol });
          shake.add(0.16 + p * 0.22);
          hitStop.freeze(reduced ? 0 : 0.035 + p * 0.03);
          if (loud && p > 0.3) session.feedback("impact");
        }
        // The clatter climbs with every impact in the throw.
        audio.play(S.tok, { volume: vol * (0.5 + p * 0.5), pitch: Math.min(12, e.n * 0.7) + rng.range(-1.5, 1.5) });
        audio.play(S.tokClick, { volume: vol * (0.4 + p * 0.6) });
        const s = screenOf(e.x, 0.15, e.d);
        fx.emit(s.x, s.y, { count: 5 + Math.round(p * 8), speed: [60, 240], life: [0.2, 0.45], size: [1.5, 3.2], colors: [PAPER, HEAT[Math.min(5, run.chain)]!], drag: 3, shape: "spark" });
        break;
      }
      case "pin": {
        audio.play(S.tok, { volume: vol * (0.25 + p * 0.6), pitch: Math.min(14, e.n * 0.7) + rng.range(-2, 2), pan: clamp(e.x * 1.5, -0.8, 0.8) });
        if (p > 0.3) audio.play(S.tokClick, { volume: vol * p });
        break;
      }
      case "deck":
        audio.play(S.deck, { volume: vol * (0.3 + p * 0.7), pitch: rng.range(-3, 3), pan: clamp(e.x * 1.5, -0.8, 0.8) });
        if (p > 0.4) audio.play(S.deckRattle, { volume: vol * p });
        break;
      case "wall":
        audio.play(S.wall, { volume: vol * (0.3 + p * 0.7) });
        break;
      case "gutter":
        if (e.pin < 0) {
          audio.play(S.gutter, { volume: vol });
          rumble.set(loud ? 0.5 : 0.18, 4);
        } else audio.play(S.deck, { volume: vol * 0.5, pitch: -5 });
        break;
      case "bumper":
        audio.play(S.bumper, { volume: vol });
        shake.add(0.05);
        break;
      case "pit":
        if (e.pin < 0) audio.play(S.pit, { volume: vol * 0.7 });
        break;
      case "fall":
      case "curtain":
        break;
    }
  }

  /** The pins are down (or not): score it, celebrate it, or shrug it off kindly. */
  function decide() {
    if (!th) return;
    decided = true;
    const loud = mode === "play";
    const wasChain = run.chain;
    const a = run.settle(th, buzzerRoll || run.buzzer);
    holdT = a.kind === "strike" ? HOLD_T.strike : a.kind === "spare" ? HOLD_T.spare : HOLD_T.other;
    if (a.kind === "strike" || a.kind === "spare") pulse = 1;
    const pinsAt = screenOf(0, 0.25, D_HEAD + 0.4);
    if (loud && !hintSeen && a.pins > 0) {
      hintSeen = true;
      tc.storage.set("hint", 1).catch(() => undefined);
    }
    const head = (text: string, sub: string, color: string, life: number, big: boolean) => {
      banners = banners.filter((b) => b.t < 0.2 && b.big && big);
      banners.push({ text, sub, color, t: 0, life, big });
    };
    switch (a.kind) {
      case "strike": {
        const col = HEAT[Math.min(5, a.chain)]!;
        const note = PENTATONIC[Math.min(a.chain + 3, PENTATONIC.length - 1)]!;
        audio.play(S.strike, { volume: loud ? 1 : 0.35, pitch: Math.min(7, (a.chain - 1) * 2) });
        audio.note(midiToFreq(64 + note), 0.4, "triangle", loud ? 0.2 : 0.08);
        if (a.tierUp) window.setTimeout(() => audio.play(S.tier, { volume: loud ? 1 : 0.35 }), 150);
        flash.trigger(a.tierUp ? col : ACCENT, a.tierUp ? 0.9 : 0.55);
        shake.add(a.tierUp ? 0.3 : 0.2);
        burst(pinsAt.x, pinsAt.y, a.chain >= 3 ? 46 : 30, col);
        if (loud) {
          session.feedback("success");
          const sub = [a.chain >= 2 ? `×${a.mult} POINTS` : "", a.glow ? "GLOW RACK" : "", a.clutch ? "CLUTCH ×2" : ""].filter(Boolean).join(" · ");
          head(chainName(a.chain), sub, a.chain >= 2 ? col : ACCENT, a.chain >= 3 ? 1.35 : 1.1, true);
        } else head(chainName(a.chain), "", ACCENT, 1, true);
        break;
      }
      case "spare": {
        audio.play(a.converted ? S.split : S.spare, { volume: loud ? 1 : 0.35 });
        flash.trigger(a.converted ? HEAT[3] : PAPER, a.converted ? 1 : 0.3);
        shake.add(a.converted ? 0.3 : 0.12);
        burst(pinsAt.x, pinsAt.y, a.converted ? 60 : 18, a.converted ? HEAT[4] : PAPER);
        if (a.converted) {
          confetti(0.42);
          if (loud) session.feedback("success");
        }
        if (loud) head(a.tags[0] ?? "SPARE", a.converted ? "WHAT A PICK-UP" : wasChain ? "STRIKE CHAIN RESETS" : "", a.converted ? HEAT[4] : PAPER, a.converted ? 1.5 : 0.95, a.converted);
        else head(a.tags[0] ?? "SPARE", "", PAPER, 0.9, false);
        break;
      }
      case "leave": {
        if (a.split) {
          audio.play(S.open, { volume: loud ? 1 : 0.35, pitch: -2 });
          if (loud) head(`${a.leave} SPLIT`, "CONVERT IT FOR +500", PAPER, 1.1, false);
        } else if (loud) {
          const left = run.standing.filter(Boolean).length;
          head(`${a.pins} DOWN`, left === 1 ? `ONE LEFT · THE ${a.leave} PIN` : `${left} LEFT TO PICK UP`, PAPER, 0.9, false);
        }
        if (th.wobblers > 0 && loud) toast = { text: "IT WOBBLED... AND STAYED", t: 0, color: PAPER };
        break;
      }
      case "open":
        audio.play(S.open, { volume: loud ? 0.8 : 0.3 });
        if (loud) head(a.left === 1 ? "SO CLOSE" : `${a.pins} MORE`, a.left === 1 ? "ONE PIN STOOD ITS GROUND" : "NEXT RACK, FRESH START", PAPER, 0.9, false);
        break;
      case "gutter":
        audio.play(S.open, { volume: loud ? 0.6 : 0.2, pitch: -4 });
        if (loud) head("GUTTER", "SHAKE IT OFF", DIM, 0.95, false);
        break;
      case "mulligan":
        if (loud) head("FREE RE-ROLL", "ONE GUTTER ON THE HOUSE", ACCENT, 1.2, false);
        break;
    }
    if (loud) {
      const lane = (to: Fly["to"]) => {
        const busy = new Set(fly.filter((f) => f.to === to && f.t < 0.9).map((f) => f.lane));
        let l = 0;
        while (busy.has(l)) l++;
        return l;
      };
      if (a.points > 0) fly.push({ value: a.points, label: `+${a.points.toLocaleString("en-US")}`, x: pinsAt.x, t: 0, lane: lane("score"), to: "score" });
      if (a.refill > 0.05 && !a.buzzer) fly.push({ value: a.refill, label: `+${a.refill.toFixed(1)}S`, x: 0, t: 0, lane: lane("clock"), to: "clock" });
      const best = session.best;
      if (!celebratedBest && best !== null && best > 0 && run.score > best) {
        celebratedBest = true;
        window.setTimeout(() => {
          if (mode !== "play" || endSent) return;
          banners.push({ text: "NEW BEST", sub: "KEEP ROLLING", color: ACCENT, t: 0, life: 1.3, big: false });
          audio.play(S.best);
          confetti(0.3);
        }, 700);
      }
      if (a.buzzer) endAt = phaseT + 0.45;
    }
  }

  function burst(x: number, y: number, n: number, color: string) {
    fx.emit(x, y, { count: n, speed: [90, 360], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.45, 1.0], size: [2.5, 5], colors: [color, PAPER, ACCENT], gravity: 520, drag: 1.5, spin: [-6, 6] });
  }
  function confetti(y: number) {
    const c = [ACCENT, PAPER, HEAT[3], HEAT[4]];
    fx.emit(W * 0.12, H * y, { count: 36, speed: [220, 520], angle: [-Math.PI * 0.45, -Math.PI * 0.1], life: [0.9, 1.6], size: [3, 7], colors: c, gravity: 600, drag: 1.3, spin: [-8, 8] });
    fx.emit(W * 0.88, H * y, { count: 36, speed: [220, 520], angle: [-Math.PI * 0.9, -Math.PI * 0.55], life: [0.9, 1.6], size: [3, 7], colors: c, gravity: 600, drag: 1.3, spin: [-8, 8] });
  }

  function startReset() {
    // Remember where every pin ended, for the sweep.
    for (let i = 0; i < PIN_COUNT; i++) Object.assign(lastPins[i]!, vis[i]!);
    resetFull = run.ball === 1;
    resetStanding = [...run.standing];
    phase = "reset";
    phaseT = 0;
    sweepSound = false;
    rackSound = false;
    camFromK = camK;
    rumble.set(0, 0);
    if (mode === "play" && run.rack === BUMPER_RACKS && run.ball === 1 && bumperH > 0.5) {
      toast = { text: "BUMPERS DOWN · MIND THE GUTTERS", t: 0, color: ACCENT };
      audio.play(S.bumpersDown);
    }
    if (mode === "play" && run.glow && run.ball === 1) {
      window.setTimeout(() => {
        if (mode === "play" && !endSent) banners.push({ text: "GLOW RACK", sub: "DOUBLE POINTS · STRIKES BUY MORE TIME", color: HEAT[3], t: 0, life: 1.2, big: false });
      }, 380);
    }
  }

  function endRun() {
    if (endSent) return;
    endSent = true;
    const prevBest = session.best;
    const r = session.end(run.score, {
      outcome: "lose",
      stats: { strikes: run.strikes, spares: run.spares, chain: run.bestChain, racks: run.rack, splits: run.converted },
    });
    endInfo = { score: run.score, best: r.best, isBest: r.isBest, prevBest };
    phase = "over";
    phaseT = 0;
    rumble.set(0, 0);
    if (r.isBest && run.score > 0) {
      audio.play(S.best);
      confetti(0.62);
    }
  }

  function onBuzzer() {
    audio.play(S.buzzer);
    audio.play(S.buzzerHi);
    shake.add(0.25);
    session.feedback("impact");
    if (phase === "roll" && !decided) {
      buzzerRoll = true;
      banners = [{ text: "TIME", sub: "LAST BALL STILL COUNTS", color: PAPER, t: 0, life: 1.2, big: true }];
    } else {
      banners = [{ text: "TIME", sub: "", color: PAPER, t: 0, life: 1.2, big: true }];
      endRun();
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Attract demo
  // -------------------------------------------------------------------------------------------------------------
  function planDemo() {
    demoFlick = pilotFlick(base, run.standing, DEMO, rng, habit);
    demoAt = time + rng.range(DEMO.think[0], DEMO.think[1]) + 0.25;
    const b = screenOf(0, BALL_R, BALL_D0);
    flickPath(demoFlick, b.x, b.y + 28, demoPath, 16);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: a tap starts a run; during a run, an upward flick from the lower part of the screen bowls.
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
  window.addEventListener("pointerup", (e) => {
    if (!touching || e.pointerId !== touchId) return;
    touching = false;
    addPt(e.clientX, e.clientY, e.timeStamp);
    if (canAim()) {
      const f = readFlick(pts, nPts);
      // A flick while the rack is still being set waits for it, so fast hands never lose a ball.
      if (f.kind === "throw" && !canThrow() && (phase === "reset" || phase === "intro")) queued = { f, at: time };
      else bowl(f);
    }
    nPts = 0;
  });
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
  // Desktop testing: up = a clean hooked ball at the pocket (or the leave), left/right = a little off to that side.
  const keyBowl = (side: number) => {
    if (!canAim()) return;
    const full = run.standing.every((s) => s);
    const hook = full ? -0.7 : 0;
    const target = full ? pocketFor(hook, 0.06) : spareTarget(run.standing);
    const f = flickFor(base, headingThrough(target.x + side * 0.08, target.d, 10.4, hook), 10.4, hook, H * 0.3);
    bowl(f);
  };
  onKeys({ up: () => keyBowl(0), action: () => keyBowl(0), left: () => keyBowl(-1), right: () => keyBowl(1) });

  session.on("start", () => resetRun("play"));
  session.on("attract", () => resetRun("attract"));
  resetRun("attract");

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  function camView(): View {
    return viewNow;
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    phaseT += rawDt;
    let dt = hitStop.scale(rawDt);
    // Strike slow motion: from just before the ball meets the head pin, for half a second of real time.
    if (slowT >= 0) {
      slowT += rawDt;
      const k = slowT / SLOWMO_T;
      dt *= k >= 1 ? 1 : lerp(SLOWMO, 1, easeInOutCubic(clamp((k - 0.55) / 0.45)));
      if (k >= 1) slowT = -1;
    }
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(rawDt);
    counter.update(rawDt);
    scorePop.update(rawDt);
    clockPop.update(rawDt);
    titlePop.update(rawDt);
    ballPop.update(rawDt);
    rumble.tick();
    pulse = Math.max(0, pulse - rawDt * 1.6);
    for (const b of banners) b.t += rawDt;
    if (banners.some((b) => b.t > b.life)) banners = banners.filter((b) => b.t <= b.life);
    if (toast) {
      toast.t += rawDt;
      if (toast.t > 1.6) toast = null;
    }
    // Points and seconds fly into their counters, which tick up when they land.
    for (const f of fly) {
      f.t += rawDt;
      if (f.t >= (f.to === "score" ? 0.32 : 0.05) && f.value) {
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
    if (fly.length && fly.every((f) => f.t > 1)) fly = [];

    // The clock: runs while you aim, while the ball rolls and while the pins come down; waits for the sweep.
    const playing = mode === "play" && session.phase === "playing";
    if (playing && !endSent) {
      const frozen = phase === "intro" || phase === "reset";
      if (run.tick(dt, frozen)) onBuzzer();
      const sec = Math.ceil(run.clock);
      if (run.clock <= CLUTCH_T && sec !== lastTick && !run.buzzer) {
        lastTick = sec;
        audio.play(S.countdown, { pitch: (CLUTCH_T - sec) * 2 });
      }
    }
    shownClock = damp(shownClock, run.clock, 14, rawDt);
    if (endAt >= 0 && phaseT >= endAt && !endSent) endRun();

    // Phases.
    if (phase === "intro" && phaseT >= FIRST_BALL_T) {
      phase = "aim";
      phaseT = 0;
    }
    if (phase === "aim") {
      if (queued && time - queued.at < 0.6) {
        const q = queued.f;
        queued = null;
        bowl(q);
      }
      queued = null;
      if (mode === "attract" && demoFlick && time >= demoAt) bowl(demoFlick);
      if (QA_AUTOPLAY && playing && !endSent && time >= qaAt) {
        qaAt = time + rng.range(QA_AUTOPLAY.think[0], QA_AUTOPLAY.think[1]);
        bowl(pilotFlick(base, run.standing, QA_AUTOPLAY, runRng, habit));
      }
    }
    if (phase === "roll" && th) {
      // Slow motion for a strike, and for a split about to be picked up.
      const clears = th.knocked > 0 && th.knocked === th.before.filter(Boolean).length;
      const bigComing = clears && (th.before.every((s) => s) || isSplit(th.before));
      if (slowT < 0 && !reduced && bigComing && pt < th.impact && pt + dt >= th.impact - 0.05) slowT = 0;
      pt += dt;
      while (evIdx < th.events.length && th.events[evIdx]!.t <= pt) onPinEvent(th.events[evIdx++]!);
      if (!decided && pt >= th.decided) decide();
      if (decided && pt >= th.decided + holdT && !endSent && endAt < 0) startReset();
    }
    if (phase === "reset") {
      if (phaseT >= RESET_T) {
        phase = "aim";
        phaseT = 0;
        rackPins(run.standing);
        world.clearTrail();
        ballPop.value = 0.3;
        ballPop.velocity = 0;
        ballPop.target = 1;
        th = null;
        if (mode === "attract") {
          // The demo keeps bowling; every so often it starts a fresh game.
          if (run.rack >= 6 && run.ball === 1) {
            run = new Run(rng);
            rackPins(run.standing);
          }
          planDemo();
        } else if (QA_AUTOPLAY) qaAt = time + rng.range(QA_AUTOPLAY.think[0], QA_AUTOPLAY.think[1]);
      }
    }
    if (phase === "over" && mode === "play" && session.phase !== "over") {
      // The shell went back to attract without a replay.
    }

    placeWorld(dt);
  }

  function placeWorld(dt: number) {
    // Pins and ball.
    let bx = 0;
    let by = BALL_R;
    let bd = BALL_D0;
    let spin = 0;
    let heading = 0;
    let ballVisible: boolean;
    if ((phase === "roll" || (phase === "over" && th)) && th) {
      sampleThrow(frames, th, pt, sample);
      bx = sample[0]!;
      by = sample[1]!;
      bd = sample[2]!;
      spin = sample[3]!;
      heading = sample[4]!;
      ballVisible = by > -0.3;
      for (let i = 0; i < PIN_COUNT; i++) {
        const o = BALL_F + i * PIN_F;
        const v = vis[i]!;
        v.hidden = !th.before[i];
        v.x = sample[o]!;
        v.y = sample[o + 1]!;
        v.d = sample[o + 2]!;
        v.ux = sample[o + 3]!;
        v.ud = sample[o + 4]!;
        v.th = sample[o + 5]!;
        v.lift = 0;
        if (v.y < -0.6) v.hidden = true;
      }
      if (bd < D_HEAD + 0.2 && by > 0) world.pushTrail(bx, bd);
      world.fadeTrail(clamp(1 - Math.max(0, pt - th.decided) / 0.8));
      const v = Math.hypot(bx - lastBall.x, bd - lastBall.d) / Math.max(1e-3, dt);
      lastBall.x = bx;
      lastBall.d = bd;
      if (phase === "roll") rumble.set(by > 0.05 && bd < D_PIT ? (mode === "play" ? 1 : 0.3) * clamp(v / 9) : 0, v);
    } else if (phase === "reset") {
      const u = clamp(phaseT / RESET_T);
      ballVisible = false;
      // The sweep bar drops in front of the deck and rakes the fallen pins into the pit.
      const barDrop = easeOutCubic(clamp(u / 0.18));
      const barRake = easeInOutCubic(clamp((u - 0.15) / 0.5));
      const barD = lerp(D_HEAD - 0.32, D_PIT + 0.2, barRake);
      const barY = lerp(0.5, 0.06, barDrop) + (u > 0.7 ? (u - 0.7) * 1.6 : 0);
      world.setSweep(u < 0.98, barY, u > 0.7 ? lerp(D_PIT + 0.2, D_HEAD - 0.32, (u - 0.7) / 0.3) : barD);
      if (!sweepSound) {
        sweepSound = true;
        audio.play(S.sweep, { volume: mode === "play" ? 1 : 0.35 });
      }
      for (let i = 0; i < PIN_COUNT; i++) {
        const v = vis[i]!;
        const l = lastPins[i]!;
        const keep = !resetFull && resetStanding[i];
        if (keep) {
          // The pinsetter lifts it and sets it back on its spot.
          const k = Math.sin(Math.PI * clamp(u / 0.85));
          v.hidden = false;
          v.x = lerp(l.x, SPOTS[i]!.x, clamp(u / 0.5));
          v.d = lerp(l.d, SPOTS[i]!.d, clamp(u / 0.5));
          v.y = 0;
          v.th = l.th * (1 - clamp(u / 0.3));
          v.lift = k * 0.32;
        } else if (resetFull && u > 0.62) {
          // A fresh rack drops into place.
          const k = clamp((u - 0.62) / 0.34);
          v.hidden = false;
          v.x = SPOTS[i]!.x;
          v.d = SPOTS[i]!.d;
          v.y = 0;
          v.ux = 0;
          v.ud = 1;
          v.th = 0;
          v.lift = (1 - easeOutBack(k)) * 0.4 + (k < 1 ? 0 : 0);
          if (k >= 1 && !rackSound) {
            rackSound = true;
            audio.play(S.rack, { volume: mode === "play" ? 1 : 0.35 });
          }
        } else {
          // Raked back with the bar, then gone.
          v.hidden = l.hidden || l.d > D_PIT + 0.15;
          v.x = l.x;
          v.y = l.y;
          v.th = l.th;
          v.ux = l.ux;
          v.ud = l.ud;
          v.lift = 0;
          v.d = l.d < barD - 0.05 && barY < 0.4 ? Math.max(l.d, barD - 0.05) : l.d;
          if (v.d > D_PIT + 0.1) v.hidden = true;
        }
      }
    } else {
      world.setSweep(false, 0, 0);
      ballVisible = phase !== "over" || !th;
      by = BALL_R + (reduced ? 0 : Math.sin(time * 2.2) * 0.004);
      lastBall.x = 0;
      lastBall.d = BALL_D0;
    }
    if (phase !== "reset") world.setSweep(false, 0, 0);
    const k = clamp(ballPop.value, 0.3, 1.15);
    world.setPins(vis);
    world.setBall(bx, phase === "aim" ? by * k + (1 - k) * -0.05 : by, bd, spin, heading, ballVisible, heat);
    world.ball.scale.setScalar(phase === "aim" ? clamp(0.6 + k * 0.4, 0.6, 1.1) : 1);

    // Camera: chases the ball to the pins, holds while they fall, glides back for the next ball.
    if (phase === "roll" && th) camK = damp(camK, clamp((bd - 1.2) / 7.2), 6, dt);
    else if (phase === "reset") camK = camFromK * (1 - easeInOutCubic(clamp(phaseT / (RESET_T * 0.9))));
    else if (phase === "aim" || phase === "intro") camK = damp(camK, 0, 8, dt);
    viewNow = chaseView(base, Math.max(bd, BALL_D0), phase === "roll" ? bx : 0, reduced ? (camK > 0.5 ? 1 : 0) * clamp(camK * 2) : easeInOutCubic(camK));
    placeCamera(viewNow);

    // Heat: the lane lights follow the chain; they chase the ball while it rolls.
    const chain = Math.min(5, run.chain);
    heat = damp(heat, mode === "play" ? chain / 5 : 0.2, 3, dt);
    const lit = mode === "play" ? 0.35 + chain * 0.12 + (run.clutch ? 0.2 * light.pulse(time, 2, { still: 0.5 }) : 0) : 0.45;
    world.setLights(phase === "roll" && bd < D_HEAD ? bd : -1, chain, lit, reduced ? 0 : time, pulse);
    world.pinMat.emissive.set(run.glow && mode === "play" ? HEAT[3] : "#20263A");
    world.pinMat.emissiveIntensity = run.glow && mode === "play" ? 0.35 + 0.15 * light.pulse(time, 1, { still: 0.5 }) : 0.6;
    bumperH = damp(bumperH, mode === "play" && run.bumpers ? 1 : 0, 6, dt);
    world.setBumpers(bumperH);
  }

  function placeCamera(v: View) {
    const o = shake.offset;
    camera.position.set(v.cam.x + o.x * 0.004, v.cam.y + o.y * 0.004, -v.cam.d);
    look.set(v.look.x + o.x * 0.003, v.look.y + o.y * 0.003, -v.look.d);
    camera.lookAt(look);
    camera.rotateZ(o.angle);
    if (camera.fov !== v.fov) {
      camera.fov = v.fov;
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

  function drawHud() {
    stageGfx.beginHud();
    const g = hud;
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
    drawBanners(g);
    flash.draw(g, W, H);
  }

  /** Banners sit in their own band under the HUD on a near-opaque plate; nothing else is ever drawn there. */
  function bandTop(): number {
    return mode === "play" ? session.play().top + 12 + 74 : H * 0.5;
  }

  function drawBanners(g: CanvasRenderingContext2D) {
    const top = bandTop();
    for (const b of banners) {
      const k = b.t / b.life;
      const pop = b.t < 0.16 ? easeOutBack(b.t / 0.16) : 1;
      const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      let size = mode === "attract" ? (b.big ? 28 : 20) : b.big ? 42 : 26;
      g.font = `900 ${size}px ${FONT_DISPLAY}`;
      spaced(g, -size * 0.02);
      let tw = g.measureText(b.text).width;
      if (tw > W - 72) {
        size = Math.max(16, Math.floor((size * (W - 72)) / tw));
        g.font = `900 ${size}px ${FONT_DISPLAY}`;
        tw = g.measureText(b.text).width;
      }
      g.font = `11px ${FONT_MONO}`;
      spaced(g, 0.9);
      const sw = b.sub ? g.measureText(b.sub).width : 0;
      spaced(g, 0);
      const pw = Math.min(W - 32, Math.max(tw, sw) + 32);
      const ph = size * 1.1 + (b.sub ? 24 : 0);
      const y = top + size * 0.86 - (reduced ? 0 : (1 - pop) * 10);
      g.save();
      g.globalAlpha = a;
      g.translate(W / 2, y);
      g.scale(pop, pop);
      g.fillStyle = rgba(INK, 0.9);
      roundRect(g, -pw / 2, -size * 0.86, pw, ph, 10);
      g.fill();
      drawTitle(g, b.text, 0, 0, W - 72, b.color, size, b.big ? rgba(INK, 0.9) : undefined);
      if (b.sub) drawLabel(g, b.sub, 0, size * 0.3 + 7, b.big ? PAPER : DIM, 11);
      g.restore();
    }
    if (mode !== "play") return;
    // Points rise from the pins into their own rows, below the banner band; seconds back appear beside the clock.
    const rowTop = top + 92;
    for (const f of fly) {
      if (f.t > 0.9 || f.t < 0 || f.to !== "score") continue;
      const u = clamp(f.t / 0.9);
      const rise = 1 - (1 - u) ** 3;
      const alpha = f.t < 0.08 ? f.t / 0.08 : clamp(1 - (f.t - 0.6) / 0.3);
      g.save();
      g.globalAlpha = alpha;
      g.textBaseline = "middle";
      if (f.to === "score") {
        const x = clamp(f.x, 80, W - 80);
        const y = rowTop + 14 + f.lane * 34 - rise * 8;
        g.font = `24px ${FONT_MONO}`;
        g.textAlign = "center";
        const w = g.measureText(f.label).width;
        g.fillStyle = rgba(INK, 0.78);
        roundRect(g, x - w / 2 - 9, y - 15, w + 18, 30, 8);
        g.fill();
        g.fillStyle = ACCENT;
        g.fillText(f.label, x, y);
      }
      g.restore();
    }
  }

  function drawAttract(g: CanvasRenderingContext2D) {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(clamp(titlePop.value));
    g.drawImage(topShade(), 0, 0, W, r.y + 150);
    g.save();
    g.translate(cx, r.y + 50);
    g.scale(k, k);
    drawTitle(g, "CLATTERLANE", 0, 0, r.w - 8, PAPER, 46, rgba(ACCENT, 0.95));
    g.restore();
    g.fillStyle = rgba(INK, 0.7);
    roundRect(g, cx - 128, r.y + 64, 256, 22, 11);
    g.fill();
    drawLabel(g, "GLOW BOWLING AGAINST THE CLOCK", cx, r.y + 75, rgba(PAPER, 0.88), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 96, ACCENT, 13);
    // The demo's ghost finger shows the verb.
    if (demoFlick && phase === "aim") {
      const lead = 0.34;
      const u = clamp(1 - (demoAt - time) / lead);
      const a = clamp((time - (demoAt - lead - 0.3)) / 0.25) * 0.9;
      drawGhost(g, demoPath, 16, u, a);
    }
    const py = Math.min(r.y + r.h - 22, H * 0.68);
    g.fillStyle = rgba(INK, 0.66);
    roundRect(g, cx - 100, py - 17, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, py, time, PAPER);
  }

  function drawPinDiagram(g: CanvasRenderingContext2D, x: number, y: number, standing: readonly boolean[], color: string) {
    // Back row on top, the head pin at the bottom, as seen from the bowler.
    for (let i = 0; i < PIN_COUNT; i++) {
      const s = SPOTS[i]!;
      const px = x + (s.x / 0.3048) * 9;
      const py = y + (3 - s.row) * 7.5;
      g.fillStyle = standing[i] ? color : rgba(PAPER, 0.16);
      g.beginPath();
      g.arc(px, py, 2.7, 0, Math.PI * 2);
      g.fill();
    }
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
      const txt = scoreText(Math.round(counter.shown));
      g.fillStyle = rgba(INK, 0.55);
      g.fillText(txt, 2, 2);
      g.fillStyle = PAPER;
      g.fillText(txt, 0, 0);
      g.restore();
      // Chain chip.
      if (run.chain >= 1) {
        const c = HEAT[Math.min(5, run.chain)]!;
        drawLabel(g, run.chain >= 2 ? `×${run.mult} ${chainName(run.chain)}` : "NEXT STRIKE ×2", W / 2, top + 58, run.chain >= 2 ? c : rgba(PAPER, 0.75), 11);
      } else if (run.ball === 2 && !run.buzzer) drawLabel(g, "SPARE BALL", W / 2, top + 58, rgba(PAPER, 0.7), 11);
      // Clock (top left): seconds, a bar, and the clutch warning.
      const clutch = run.clutch;
      const pl = clutch ? light.pulse(time, 2, { still: 1 }) : 0;
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
      g.fillStyle = clutch ? (pl > 0.5 ? ACCENT : PAPER) : PAPER;
      g.fillText(ct, 0, 0);
      g.restore();
      const bw = 74;
      g.fillStyle = rgba(PAPER, 0.16);
      g.fillRect(18, top + 44, bw, 4);
      g.fillStyle = clutch ? ACCENT : PAPER;
      g.fillRect(18, top + 44, bw * clamp(shownClock / MAX_CLOCK), 4);
      // The clock column's own row: seconds back while they land, otherwise what the clock is doing.
      const refill = fly.find((f) => f.to === "clock" && f.t < 0.9);
      if (refill) {
        const a = refill.t < 0.08 ? refill.t / 0.08 : clamp(1 - (refill.t - 0.6) / 0.3);
        g.save();
        g.globalAlpha = a;
        drawLabel(g, `${refill.label} BACK`, 18, top + 60, PAPER, 11, "left");
        g.restore();
      } else if (clutch) drawLabel(g, "PINS ×2", 18, top + 60, ACCENT, 10, "left");
      else if (run.bumpers) drawLabel(g, "BUMPERS UP", 18, top + 60, rgba(PAPER, 0.6), 10, "left");
      // Rack (top right): number, the pins standing, which ball.
      drawLabel(g, `RACK ${run.rack + 1}`, W - 16, top + 12, run.glow ? HEAT[3] : PAPER, 12, "right");
      drawPinDiagram(g, W - 16 - 14 * 1.5 - 6, top + 26, phase === "roll" || phase === "over" ? (th ? th.before : run.standing) : run.standing, run.glow ? HEAT[3] : PAPER);
      drawLabel(g, run.glow ? "GLOW ×2" : `BALL ${run.ball}`, W - 16, top + 62, run.glow ? HEAT[3] : rgba(PAPER, 0.7), 10, "right");
      // First run: a ghost finger flicking up from the ball until the first pins fall.
      const b = screenOf(0, BALL_R, BALL_D0);
      if (!hintSeen && phase === "aim" && !touching) {
        const cyc = 2.1;
        const t = (phaseT + time) % cyc;
        const f: Flick = { kind: "throw", dx: 0, dy: -H * 0.27, speed: 1500, bow: 0.1 };
        const n = flickPath(f, b.x, b.y + 30, hintPath, 16);
        const u = clamp((t - 0.35) / 0.45);
        const a = t < 0.25 ? t / 0.25 : t > cyc - 0.35 ? (cyc - t) / 0.35 : 1;
        drawGhost(g, hintPath, n, u, 0.85 * a);
        const hy = Math.min(H - 44, b.y + 64);
        g.fillStyle = rgba(INK, 0.78);
        roundRect(g, W / 2 - 138, hy - 15, 276, 48, 12);
        g.fill();
        drawLabel(g, "FLICK UP THE LANE TO BOWL", W / 2, hy, PAPER, 13);
        drawLabel(g, "CURVE YOUR SWIPE TO HOOK IT", W / 2, hy + 19, rgba(PAPER, 0.82), 11);
      }
      if (toast) {
        const a = toast.t > 1.2 ? 1 - (toast.t - 1.2) / 0.4 : 1;
        const ty = Math.min(H - 40, b.y + 64);
        g.save();
        g.globalAlpha = a;
        g.font = `13px ${FONT_MONO}`;
        spaced(g, 1);
        const w = g.measureText(toast.text).width;
        spaced(g, 0);
        g.fillStyle = rgba(INK, 0.78);
        roundRect(g, W / 2 - w / 2 - 14, ty - 14, w + 28, 28, 14);
        g.fill();
        drawLabel(g, toast.text, W / 2, ty, toast.color, 13);
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
    grad.addColorStop(0, rgba(INK, 0.75));
    grad.addColorStop(0.6, rgba(INK, 0.4));
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
    g.fillStyle = rgba(INK, 0.86);
    roundRect(g, left, y0, w, h, 14);
    g.fill();
    g.fillStyle = ACCENT;
    g.fillRect(left, y0, w, 3);
    const x = left + 16;
    const col = (w - 32) / 4;
    const stat = (i: number, label: string, value: string, color = PAPER) => {
      drawLabel(g, label, x + col * i, y0 + 22, DIM, 10, "left");
      drawLabel(g, value, x + col * i, y0 + 40, color, 13, "left");
    };
    stat(0, "STRIKES", `${run.strikes}`);
    stat(1, "SPARES", `${run.spares}`);
    stat(2, "CHAIN", run.bestChain >= 2 ? `×${Math.min(5, run.bestChain)}` : `${run.bestChain}`, run.bestChain >= 3 ? HEAT[3] : PAPER);
    stat(3, "RACKS", `${run.rack}`);
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
      ? "NO PINS YET. ONE FLICK DOES IT."
      : info.isBest
        ? prev
          ? `NEW BEST, +${(info.score - prev).toLocaleString("en-US")} ON YOUR OLD ONE`
          : "FIRST SCORE ON THE BOARD"
        : `${Math.round(frac * 100)}% OF YOUR BEST (${(prev ?? 0).toLocaleString("en-US")})`;
    g.font = `11px ${FONT_MONO}`;
    spaced(g, 0.9);
    const lw = g.measureText(line).width;
    spaced(g, 0);
    drawLabel(g, line, x, barY + 22, info.isBest && scored ? ACCENT : PAPER, lw > bw ? 10 : 11, "left");
    wrapLabel(g, `NEXT TIME: ${run.hint()}`, x, barY + 46, bw, rgba(PAPER, 0.8));
    g.restore();
    if (standalone && t > 0.8) {
      drawTitle(g, info.score.toLocaleString("en-US"), W / 2, H * 0.36, W - 60, PAPER, 56, rgba(ACCENT, 0.9));
      if (info.isBest && info.score > 0) drawLabel(g, "NEW BEST", W / 2, H * 0.36 + 26, ACCENT, 13);
      g.fillStyle = rgba(INK, 0.66);
      roundRect(g, W / 2 - 110, H * 0.5 + h + 18, 220, 34, 17);
      g.fill();
      drawTapPrompt(g, W / 2, H * 0.5 + h + 35, time, PAPER, "TAP TO BOWL AGAIN");
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
  world.warm();
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
