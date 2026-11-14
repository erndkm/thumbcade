import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, dampAngle, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { barLabel, fmtKm, gradeWord, HINT_HOLD, HINT_LET_GO, PROMPT, statLine, TAGLINE, TAGLINE_2, tierLine, TIP_MIN_PX, TIP_PX, tipFor, TITLE } from "./copy.ts";
import { Cam, drawCart, drawHeadlamp, drawItems, drawLand, drawRoad, drawSea, hash, ink, knock, makeStrip, over, region, sampleStrip, Scenery2, type CartPose } from "./draw.ts";
import { INKS, PAPER, PLATES, RED, skyAt, stageAt, SUN, TEAL, todAt, type PlateName, type Sky } from "./palette.ts";
import { DEMO, Pilot, SKILLS } from "./pilot.ts";
import { Press } from "./riso.ts";
import { GATE_M, OFF, type Lemon } from "./road.ts";
import { Run, runSeed, TIERS, type RunEvent } from "./sim.ts";
import { createSound } from "./sound.ts";
import { Teacher } from "./teach.ts";
import { fmt, light, loadType, medium, spaced, spacedWidth } from "./type.ts";

/** Design QA builds can let a pilot drive the run (`VITE_AUTOPLAY=good vite build`), to record and measure it. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;
/** With autoplay, `VITE_WARP=<s>` drives that many seconds headless before the run is shown (for later stages). */
const QA_WARP = QA_AUTOPLAY ? Number(import.meta.env.VITE_WARP ?? 0) || 0 : 0;
const TAU = Math.PI * 2;

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  plate: PlateName;
  size: number;
}
interface Banner {
  text: string;
  sub: string;
  t: number;
  life: number;
  size: number;
}
interface Tumble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  t: number;
  sea: boolean;
}
interface Skid {
  x: number[];
  y: number[];
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "saltbend", restartDelayMs: 800 }), loadType()]);
  let hintSeen = false;
  let bestM = 0;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
    bestM = (await tc.storage.get<number>("far")) ?? 0;
  } catch {
    /* guests and offline: show the hint, no best post */
  }
  const view = createCanvas({ maxDpr: 2, background: PAPER });
  const { ctx } = view;
  const press = new Press({ paper: PAPER, inks: INKS, grain: 0.4, slip: 1.2, cell: 3.9, scale: 0.8 });
  const reduced = session.reducedMotion;
  const light01 = new Photosafe(reduced);
  const sound = createSound();
  const shake = new Shake(8, 0, 2, reduced);
  const hitStop = new HitStop();
  // Particles live in world metres and are drawn through the camera (solid ink only).
  const dust = new Particles(260);
  const grit = new Particles(200);
  const juice = new Particles(220);
  const confetti = PLATES.map(() => new Particles(160));

  let W = view.width;
  let H = view.height;
  press.resize(W, H, view.dpr);
  view.onResize((w, h) => {
    W = w;
    H = h;
    press.resize(w, h, view.dpr);
  });

  // ------------------------------------------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = (session.ctx.seed ^ 0x2545f491) >>> 0;
  let run = new Run(demoSeed, { demo: true });
  let driver: Pilot | null = new Pilot(DEMO, createRng(demoSeed ^ 7));
  const teacher = new Teacher();
  const cam = new Cam();
  const strip = makeStrip();
  const scenery = new Scenery2();
  let time = 0;
  let veil = 0;
  let veilAction: (() => void) | null = null;
  let popups: Popup[] = [];
  let banners: Banner[] = [];
  let tumbles: Tumble[] = [];
  let skids: Skid[] = [];
  let skidOn = false;
  let tod = todAt(0);
  let sky: Sky = skyAt(tod);
  let shownScore = 0;
  let bestCheered = false;
  let pastBest = false;
  let endT = -1;
  let ended = false;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string; line: string } | null = null;
  let hintBends = 0;
  const prompt = { word: "", k: 0 };
  let lastPress = 0;
  let missed = new Set<Lemon>();
  let missedCount = 0;
  let load = 1;
  let crateFlash = 0;
  let tierShow = { t: 9, mult: 1 };
  let qaPilot: Pilot | null = null;
  let camInit = false;
  let crashLift = 0;
  let demoAge = 0;

  const playing = () => mode === "play" && session.phase === "playing";

  function resetFx(): void {
    popups = [];
    banners = [];
    tumbles = [];
    skids = [];
    skidOn = false;
    for (const p of [dust, grit, juice, ...confetti]) p.clear();
    scenery.clear();
    missed = new Set();
    missedCount = 0;
    load = 1;
    camInit = false;
    crashLift = 0;
  }

  function newDemo(): void {
    mode = "attract";
    demoSeed = (demoSeed * 1664525 + 1013904223) >>> 0;
    run = new Run(demoSeed, { demo: true });
    driver = new Pilot(DEMO, createRng(demoSeed ^ 7));
    demoAge = 0;
    // Every demo shows another hour of the coast.
    tod = (hash(demoSeed, 2) * 0.9 + 0.02) % 1;
    resetFx();
  }

  function startRun(): void {
    const begin = () => {
      mode = "play";
      run = new Run(runSeed(session.ctx.seed, session.runs));
      driver = null;
      qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.runs * 13 + 5)) : null;
      if (qaPilot && QA_WARP > 0) {
        for (let t = 0; t < QA_WARP && run.phase === "drive"; t += 1 / 60) {
          qaPilot.step(run, 1 / 60);
          run.step(1 / 60);
          run.events.length = 0;
        }
      }
      press.register(session.runs + 1);
      resetFx();
      shownScore = 0;
      bestCheered = false;
      pastBest = false;
      endT = -1;
      ended = false;
      summary = null;
      hintBends = 0;
      teacher.reset();
      tod = todAt(run.s);
      lastPress = time;
      sound.horn();
      syncHold();
    };
    veil = Math.max(veil, 0.01);
    veilAction = begin;
  }
  session.startOnTap(window);
  session.on("start", startRun);

  // ------------------------------------------------------------------------------------------------------------
  // Input: the first tap starts a run; after that, pressing anywhere holds.
  // ------------------------------------------------------------------------------------------------------------
  const down = new Set<number>();
  let key = false;
  function syncHold(): void {
    if (qaPilot) return;
    const on = playing() && (down.size > 0 || key);
    run.setHold(on);
  }
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Presses that began before the run never count as a hold.
    if (!playing()) return;
    down.add(e.pointerId);
    lastPress = time;
    syncHold();
  });
  const lift = (e: PointerEvent) => {
    down.delete(e.pointerId);
    syncHold();
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    e.preventDefault();
    if (!playing()) return;
    key = true;
    lastPress = time;
    syncHold();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    key = false;
    syncHold();
  });
  const drop = () => {
    down.clear();
    key = false;
    syncHold();
  };
  session.on("cancel", drop);
  session.on("pause", drop);

  // ------------------------------------------------------------------------------------------------------------
  // Events → feel
  // ------------------------------------------------------------------------------------------------------------
  const lv = () => (mode === "play" ? 1 : 0.3);
  const loud = () => mode === "play";
  const cartScreen = () => ({ x: cam.X(run.x, run.y), y: cam.Y(run.x, run.y) });
  function popup(text: string, plate: PlateName, size = 15, life = 1, dy = -38) {
    const c = cartScreen();
    const x = clamp(c.x, 70, W - 70);
    let y = c.y + dy;
    // Words that land together stack upward instead of printing over each other.
    const live = popups.filter((p) => p.t < p.life * 0.8 && Math.abs(p.x - x) < 140).sort((a, b) => b.y - a.y);
    for (const p of live) {
      const py = p.y - easeOutCubic(p.t / p.life) * 26;
      const gap = (p.size + size) * 0.75 + 6;
      if (y > py - gap && y < py + gap) y = py - gap;
    }
    popups.push({ text, x, y, t: 0, life, plate, size });
    if (popups.length > 8) popups.shift();
  }
  function banner(text: string, sub = "", size = 34, life = 1.7) {
    banners = banners.filter((b) => b.t < b.life * 0.55);
    banners.push({ text, sub, t: 0, life, size });
  }
  function jolt(px: number) {
    if (!reduced) press.jolt(px, Math.floor(time * 1000));
  }
  function burst(ps: Particles, x: number, y: number, n: number, color: string, speed: [number, number], o: { size?: [number, number]; life?: [number, number]; gravity?: number; angle?: [number, number] } = {}) {
    ps.emit(x, y, { count: n, speed, angle: o.angle, life: o.life ?? [0.4, 0.9], size: o.size ?? [0.2, 0.45], colors: [color], gravity: o.gravity ?? 0, drag: 3, shape: "circle", endScale: 0.2 });
  }
  function rear(side: number): { x: number; y: number } {
    const yaw = run.yaw;
    return { x: run.x + Math.cos(yaw) * -0.85 - Math.sin(yaw) * 0.73 * side, y: run.y + Math.sin(yaw) * -0.85 + Math.cos(yaw) * 0.73 * side };
  }
  function confettiAt(x: number, y: number, n: number) {
    PLATES.forEach((p, i) =>
      confetti[i]!.emit(x, y, { count: n, speed: [3, 9], life: [0.7, 1.4], size: [0.25, 0.5], colors: [press.solid(p)], drag: 1.6, shape: "square", spin: [-8, 8] }),
    );
  }

  function handle(e: RunEvent): void {
    switch (e.k) {
      case "press":
        sound.press(lv());
        for (const s of [-1, 1]) {
          const r = rear(s);
          burst(dust, r.x, r.y, 4, press.solid(SUN), [1, 3]);
        }
        break;
      case "release":
        sound.release(lv());
        break;
      case "bank":
        if (!loud()) break;
        sound.bank(run.mult, lv());
        popup(`+${fmt(e.points)} drift`, "teal", 13, 0.9, -58);
        break;
      case "spill":
        if (loud() && e.points > 10) popup("drift lost", "red", 12, 0.8, -58);
        break;
      case "grade": {
        if (e.grade === "scraped") break;
        sound.grade(e.grade, e.streak, lv());
        if (!loud()) break;
        if (e.grade === "wide") {
          popup("wide", "red", 13, 0.8);
          break;
        }
        hintBends++;
        if (hintBends >= 3 && !hintSeen) {
          hintSeen = true;
          tc.storage.set("hint", true).catch(() => undefined);
        }
        const big = e.grade === "paint" || e.grade === "kissed";
        popup(`${gradeWord(e.grade)} +${fmt(e.points)}`, big ? "red" : "teal", big ? 18 : 15, 1.1);
        if (big) {
          jolt(e.grade === "paint" ? 2.6 : 1.6);
          shake.add(0.08);
          if (e.grade === "paint") hitStop.freeze(0.045);
          const c = rear(-e.dir);
          burst(dust, c.x, c.y, 8, press.solid(SUN), [2, 6]);
        }
        break;
      }
      case "tier":
        if (!loud()) break;
        tierShow = { t: 0, mult: e.mult };
        banner(tierLine(e.mult), `${run.streak} clean in a row`, 36, 1.6);
        sound.tier();
        jolt(3.5);
        shake.add(0.16);
        session.feedback("success");
        confettiAt(run.x, run.y, 10);
        break;
      case "lost":
        if (!loud()) break;
        sound.lost();
        popup(`streak of ${e.streak} lost`, "red", 12, 1, -60);
        break;
      case "verge": {
        sound.verge(lv());
        shake.add(0.14);
        jolt(1);
        const r = rear(e.side);
        burst(grit, r.x, r.y, 12, press.solid(RED), [2, 6], { size: [0.15, 0.35] });
        break;
      }
      case "lemon": {
        sound.lemon(run.stats.lemons % 6, lv());
        const p = run.course.point(e.s, e.d);
        burst(juice, p.x, p.y, 12, press.solid(SUN), [2, 7], { size: [0.2, 0.5] });
        if (loud()) popup(`+${e.points}`, "teal", 12, 0.7, -20);
        break;
      }
      case "gate": {
        const st = stageAt(e.n * GATE_M + 1).stage;
        banner(st.name, `${fmtKm(e.n * GATE_M)}${e.crate ? " · a spare crate" : ""}`, 34, 2.4);
        sound.gate();
        jolt(4);
        shake.add(0.12);
        session.feedback("success");
        confettiAt(run.x, run.y, 14);
        break;
      }
      case "crate":
        crateFlash = 1;
        if (loud()) sound.crate();
        break;
      case "save": {
        sound.save();
        hitStop.freeze(0.1);
        shake.add(0.5);
        jolt(5);
        session.feedback("impact");
        banner("saved by the crate", "it went over. you didn't.", 30, 1.8);
        const r = rear(e.side);
        const p = run.course.pose(run.s);
        const out = e.side;
        tumbles.push({ x: r.x, y: r.y, vx: -Math.sin(p.a) * out * 6 + Math.cos(p.a) * 4, vy: Math.cos(p.a) * out * 6 + Math.sin(p.a) * 4, rot: 0, vr: (Math.random() - 0.5) * 12, t: 0, sea: e.side < 0 });
        burst(juice, r.x, r.y, 18, press.solid(SUN), [3, 9], { size: [0.25, 0.5] });
        break;
      }
      case "crash": {
        const sea = e.side < 0;
        sound.crash(sea);
        if (mode === "play") {
          hitStop.freeze(0.12);
          shake.add(0.6);
          jolt(7);
          endT = 0;
          banner(sea ? "over the wall" : "off the road", "", 34, 1.4);
        }
        burst(juice, run.x, run.y, 24, press.solid(SUN), [3, 10], { size: [0.25, 0.55] });
        burst(dust, run.x, run.y, 14, press.solid(SUN), [2, 6]);
        break;
      }
      case "flock":
        sound.gull(lv() * 0.8);
        break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------------------------------------------------
  function update(rawDt: number): void {
    session.tick(rawDt);
    time += rawDt;
    shake.update(rawDt);
    press.settle(rawDt);

    // The veil: a halftone wipe to paper, then whatever was waiting for it.
    if (veilAction) {
      veil = Math.min(1, veil + rawDt * 4.5);
      if (veil >= 1) {
        veilAction();
        veilAction = null;
      }
    } else veil = Math.max(0, veil - rawDt * 2.4);

    // First runs: time waits a little while the coach wants a hold the player hasn't given yet.
    const slowMo = playing() ? teacher.update(run, !hintSeen && !qaPilot, hintBends, rawDt) : 1;
    const coachWants = playing() && teacher.wants;
    const dt = hitStop.scale(rawDt) * slowMo;

    if (mode === "attract") {
      demoAge += rawDt;
      driver?.step(run, dt);
      if ((run.phase === "crashed" && run.crashedFor > 1.2) || demoAge > 70) {
        if (!veilAction) {
          veil = Math.max(veil, 0.01);
          veilAction = newDemo;
        }
      }
    } else if (playing() && qaPilot) qaPilot.step(run, dt);

    run.step(dt);
    for (const e of run.events) handle(e);
    run.events.length = 0;

    // Gulls take off once the cart comes near; lemons left behind count as missed.
    for (const f of run.course.flocks) if (f.flown >= 0) f.flown += dt;
    for (const l of run.course.lemons) {
      if (!l.taken && l.s < run.s - 2 && !missed.has(l)) {
        missed.add(l);
        missedCount++;
      }
    }

    // Skid marks from the rear wheels while the cart slides.
    const sliding = run.phase === "drive" && run.holding && Math.abs(run.slip) > 0.12;
    if (sliding) {
      if (!skidOn) {
        skids.push({ x: [], y: [] }, { x: [], y: [] });
        if (skids.length > 24) skids.splice(0, 2);
        skidOn = true;
      }
      const a = skids[skids.length - 2]!;
      const b = skids[skids.length - 1]!;
      for (const [k, s] of [[a, -1], [b, 1]] as const) {
        const r = rear(s);
        const n = k.x.length;
        if (!n || Math.hypot(r.x - k.x[n - 1]!, r.y - k.y[n - 1]!) > 0.5) {
          k.x.push(r.x);
          k.y.push(r.y);
        }
      }
      if (Math.random() < dt * 30) {
        const r = rear(Math.random() < 0.5 ? -1 : 1);
        dust.emit(r.x, r.y, { count: 1, speed: [0.3, 1.4], life: [0.4, 0.8], size: [0.35, 0.8], colors: [press.solid(SUN)], drag: 2, shape: "circle", endScale: 1.6 });
      }
    } else skidOn = false;
    if (run.onVerge && run.phase === "drive" && Math.random() < dt * 40) {
      const r = rear(Math.sign(run.d));
      grit.emit(r.x, r.y, { count: 2, speed: [1, 4], life: [0.3, 0.6], size: [0.12, 0.3], colors: [press.solid(RED)], drag: 3, shape: "circle" });
    }
    for (const p of [dust, grit, juice, ...confetti]) p.update(dt);
    for (const t of tumbles) {
      t.t += dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vx *= Math.exp(-1.5 * dt);
      t.vy *= Math.exp(-1.5 * dt);
      t.rot += t.vr * dt;
    }
    tumbles = tumbles.filter((t) => t.t < 1.6);
    for (const p of popups) p.t += rawDt;
    popups = popups.filter((p) => p.t < p.life);
    for (const b of banners) b.t += rawDt;
    banners = banners.filter((b) => b.t < b.life);
    crateFlash = Math.max(0, crateFlash - rawDt * 1.6);
    tierShow.t += rawDt;
    load = damp(load, run.phase === "crashed" ? 0.2 : 1, 2, rawDt);

    // The day moves on with the road.
    if (mode === "play") tod = damp(tod, todAt(run.s), 0.6, rawDt);
    sky = skyAt(tod);

    // Score rolls; a new best is celebrated the moment it falls; passing the best post gets a word.
    if (mode === "play") {
      const target = run.score;
      shownScore = shownScore < target ? Math.min(target, shownScore + Math.max(1, (target - shownScore) * 8 * rawDt)) : target;
      const best = session.best;
      if (!bestCheered && best !== null && best > 0 && run.score > best && session.phase === "playing") {
        bestCheered = true;
        banner("new best", fmt(run.score), 36, 2);
        sound.best();
        session.feedback("success");
        confettiAt(run.x, run.y, 16);
      }
      if (!pastBest && bestM > 60 && run.s > bestM && run.phase === "drive") {
        pastBest = true;
        popup("past your best mark", "red", 13, 1.4, -78);
        sound.bank(4, 1);
      }
    }

    // Prompts: the first-run coach, then a quiet nudge for a thumb that has gone still.
    let word = "";
    if (playing() && run.phase === "drive" && !qaPilot) {
      if (!hintSeen) {
        if (coachWants && !run.holding) word = HINT_HOLD;
        else if (!coachWants && run.holding && run.holdT > 0.25) word = HINT_LET_GO;
      } else if (time - lastPress > 5 && coachWants && !run.holding) word = HINT_HOLD;
    }
    if (word) prompt.word = word;
    prompt.k = damp(prompt.k, word ? 1 : 0, word ? 14 : 8, rawDt);

    // The camera rides the road a little toward the cart, turning with the road ahead.
    const z = clamp(((H - session.play().top) * 0.66) / (Math.max(10, run.v) * 1.6), 12, 21);
    // After a crash the view settles higher, so the cart at rest sits clear of the game-over strip.
    crashLift = damp(crashLift, run.phase === "crashed" && mode === "play" ? 1 : 0, 2, rawDt);
    const carFrac = (mode === "attract" ? 0.76 : 0.7) - crashLift * 0.32;
    if (run.phase === "drive" || !camInit) {
      const sAhead = run.s + Math.max(6, run.v * 0.55);
      const head = run.course.pose(sAhead).a;
      const base = run.course.point(run.s, run.d * 0.45);
      if (!camInit) {
        cam.x = base.x;
        cam.y = base.y;
        cam.a = head;
        cam.z = z;
        camInit = true;
      } else {
        cam.a = dampAngle(cam.a, head, 3.2, rawDt);
        cam.x = damp(cam.x, base.x, 14, rawDt);
        cam.y = damp(cam.y, base.y, 14, rawDt);
        cam.z = damp(cam.z, z, 1.1, rawDt);
      }
    } else {
      // After a crash the camera drifts over to where the cart came to rest.
      cam.x = damp(cam.x, run.x, 2.5, rawDt);
      cam.y = damp(cam.y, run.y, 2.5, rawDt);
    }
    const top = mode === "attract" ? session.preview().top : session.play().top;
    const o = shake.offset;
    cam.ax = W / 2 + o.x;
    cam.ay = top + (H - top) * carFrac + o.y;
    cam.update();

    // Sound: the engine follows the cart, tyres sing while it slides.
    const drift = run.phase === "drive" && run.holding ? clamp(Math.abs(run.slip) / 0.35) : 0;
    if (run.phase === "drive" && session.phase !== "over") sound.update(run.v, drift, run.onVerge, mode === "play" ? 1 : 0.35);
    else sound.hush();

    // Game over: report shortly after the crash.
    if (mode === "play" && endT >= 0) {
      endT += rawDt;
      if (!ended && endT >= 0.9) {
        ended = true;
        const prevBest = session.best;
        const s = run.stats;
        const res = session.end(run.score, {
          stats: { metres: run.metres, bends: s.bends, paint: s.grades.paint, streak: s.bestStreak, lemons: s.lemons, gates: s.gates },
        });
        if (run.metres > bestM) {
          bestM = run.metres;
          tc.storage.set("far", bestM).catch(() => undefined);
        }
        summary = { score: run.score, isBest: res.isBest, prevBest, tip: tipFor({ stats: s, lemonsMissed: missedCount }), line: statLine(run.metres, s) };
        shownScore = run.score;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------------------------------------------
  function drawSkids(): void {
    const z = cam.z;
    const path = (c: CanvasRenderingContext2D) => {
      for (const k of skids) {
        for (let i = 0; i < k.x.length; i++) {
          const x = cam.X(k.x[i]!, k.y[i]!);
          const y = cam.Y(k.x[i]!, k.y[i]!);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
      }
    };
    for (const p of PLATES) {
      const c = press.plate(p);
      c.lineJoin = "round";
      c.lineCap = "round";
    }
    over(press, [0.55, 0, 0.42], path, Math.max(1.4, 0.3 * z));
  }

  function drawGates(): void {
    const z = cam.z;
    for (const g of run.course.gates) {
      if (Math.abs(g.s - run.s) > 140) continue;
      const p = run.course.pose(g.s);
      const nx = -Math.sin(p.a);
      const ny = Math.cos(p.a);
      // Stone pillars on both verges, bunting strung across.
      for (const side of [-1, 1]) {
        const x = p.x + nx * side * (OFF + 0.6);
        const y = p.y + ny * side * (OFF + 0.6);
        const sx = cam.X(x, y);
        const sy = cam.Y(x, y);
        const r = 0.75 * z;
        over(press, [0.3, 0.05, 0.25], (c) => {
          c.moveTo(sx + r + 0.5 * z, sy + 0.4 * z);
          c.arc(sx + 0.5 * z, sy + 0.4 * z, r, 0, TAU);
        });
        region(press, [0.1, 0.25, 0.5], (c) => c.rect(sx - r, sy - r, r * 2, r * 2));
        region(press, [0, 0, 0], (c) => c.rect(sx - r * 0.55, sy - r * 0.55, r * 1.1, r * 1.1));
      }
      // The next stretch's name painted across the lane just past the gate, upright for the driver.
      const after = run.course.pose(g.s + 9);
      const tx = cam.X(after.x, after.y);
      const ty = cam.Y(after.x, after.y);
      const [fx, fy] = cam.dir(Math.cos(after.a), Math.sin(after.a));
      const name = stageAt(g.s + 1).stage.name;
      const sp = press.plate(SUN);
      sp.save();
      sp.translate(tx, ty);
      sp.rotate(Math.atan2(fy, fx) + Math.PI / 2);
      sp.fillStyle = press.solid(SUN);
      let size = 1.15 * z;
      while (size > 0.5 * z && spacedWidth(sp, name, medium(size), 0.12 * z) > 6.4 * z) size *= 0.92;
      spaced(sp, name, 0, size * 0.35, medium(size), 0.12 * z, 0.5);
      sp.restore();
      const ax = cam.X(p.x + nx * (OFF + 0.6), p.y + ny * (OFF + 0.6));
      const ay = cam.Y(p.x + nx * (OFF + 0.6), p.y + ny * (OFF + 0.6));
      const bx = cam.X(p.x - nx * (OFF + 0.6), p.y - ny * (OFF + 0.6));
      const by = cam.Y(p.x - nx * (OFF + 0.6), p.y - ny * (OFF + 0.6));
      ink(press, RED, 1, (c) => {
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
      }, 1.2);
      const n = 11;
      const ux = (bx - ax) / n;
      const uy = (by - ay) / n;
      const len = Math.hypot(ux, uy) || 1;
      const px = (-uy / len) * 0.7 * z;
      const py = (ux / len) * 0.7 * z;
      const sway = reduced ? 0 : Math.sin(time * 3) * 0.15;
      for (let i = 0; i < n; i++) {
        const plate = PLATES[i % 3]!;
        const x0 = ax + ux * i;
        const y0 = ay + uy * i;
        region(press, plate === TEAL ? [1, 0, 0] : plate === SUN ? [0, 1, 0] : [0, 0, 1], (c) => {
          c.moveTo(x0, y0);
          c.lineTo(x0 + ux, y0 + uy);
          c.lineTo(x0 + ux * (0.5 + sway) + px, y0 + uy * (0.5 + sway) + py);
          c.closePath();
        });
      }
    }
  }

  function drawBestPost(): void {
    if (mode !== "play" || session.phase !== "playing" || bestM < 60 || Math.abs(bestM - run.s) > 120) return;
    const z = cam.z;
    const p = run.course.pose(bestM);
    // "best" painted across the lane, and a post with a red flag on the land-side verge.
    const x = cam.X(p.x, p.y);
    const y = cam.Y(p.x, p.y);
    const [fx, fy] = cam.dir(Math.cos(p.a), Math.sin(p.a));
    const c = press.plate(SUN);
    c.save();
    c.translate(x, y);
    c.rotate(Math.atan2(fy, fx) + Math.PI / 2);
    c.fillStyle = press.solid(SUN);
    spaced(c, "best", 0, 0.5 * z, medium(1.6 * z), 0.25 * z, 0.5);
    c.restore();
    const post = run.course.point(bestM, OFF - 0.3);
    const qx = cam.X(post.x, post.y);
    const qy = cam.Y(post.x, post.y);
    region(press, [1, 0, 0.6], (g) => g.arc(qx, qy, 0.22 * z, 0, TAU));
    const wave = reduced ? 0 : Math.sin(time * 4) * 0.12 * z;
    region(press, [0, 0.2, 1], (g) => {
      g.moveTo(qx, qy);
      g.lineTo(qx + fx * -1.6 * z + wave, qy + fy * -1.6 * z);
      g.lineTo(qx + (fx * -0.8 - fy * 0.7) * z, qy + (fy * -0.8 + fx * 0.7) * z);
      g.closePath();
    });
  }

  function drawLemons(): void {
    const z = cam.z;
    const bob = (l: Lemon) => (reduced ? 0 : Math.sin(time * 4 + l.s) * 0.06 * z);
    const live = run.course.lemons.filter((l) => !l.taken && Math.abs(l.s - run.s) < 120);
    if (!live.length) return;
    const pts = live.map((l) => {
      const p = run.course.point(l.s, l.d);
      return { x: cam.X(p.x, p.y), y: cam.Y(p.x, p.y) + bob(l), l };
    });
    over(press, [0.3, 0, 0.2], (c) => {
      for (const q of pts) {
        c.moveTo(q.x + 0.42 * z + 0.25 * z, q.y + 0.25 * z);
        c.ellipse(q.x + 0.25 * z, q.y + 0.25 * z, 0.42 * z, 0.32 * z, 0, 0, TAU);
      }
    });
    region(press, [0, 1, 0.1], (c) => {
      for (const q of pts) {
        c.moveTo(q.x + 0.42 * z, q.y);
        c.ellipse(q.x, q.y, 0.42 * z, 0.32 * z, 0.4, 0, TAU);
      }
    });
    ink(press, TEAL, 1, (c) => {
      for (const q of pts) {
        c.moveTo(q.x + 0.3 * z + 0.18 * z, q.y - 0.28 * z);
        c.ellipse(q.x + 0.3 * z, q.y - 0.28 * z, 0.18 * z, 0.09 * z, -0.6, 0, TAU);
      }
    });
  }

  function drawChevrons(): void {
    // Chevron boards on the outside of every tight bend ahead: the bend's direction, printed, not just coloured.
    const z = cam.z;
    for (const g of run.course.segs) {
      if (Math.abs(g.k) < 0.04 || g.s0 + g.len < run.s - 10 || g.s0 > run.s + 110) continue;
      const dir = Math.sign(g.k);
      const n = Math.max(2, Math.min(5, Math.round(g.len / 9)));
      for (let i = 0; i < n; i++) {
        const s = g.s0 + ((i + 0.5) / n) * g.len;
        const p = run.course.pose(s);
        const q = run.course.point(s, -dir * (OFF + 0.5));
        const x = cam.X(q.x, q.y);
        const y = cam.Y(q.x, q.y);
        const [fx, fy] = cam.dir(Math.cos(p.a), Math.sin(p.a));
        // Board across the road's direction: an arrow pointing into the bend.
        const [lx, ly] = cam.dir(-Math.sin(p.a) * dir, Math.cos(p.a) * dir);
        const w = 0.55 * z;
        region(press, [0, 0, 1], (c) => {
          c.moveTo(x - fx * w - lx * w * 0.5, y - fy * w - ly * w * 0.5);
          c.lineTo(x + fx * w - lx * w * 0.5, y + fy * w - ly * w * 0.5);
          c.lineTo(x + fx * w + lx * w * 0.5, y + fy * w + ly * w * 0.5);
          c.lineTo(x - fx * w + lx * w * 0.5, y - fy * w + ly * w * 0.5);
          c.closePath();
        });
        knock(press, [RED], (c) => {
          c.moveTo(x - fx * w * 0.6 - lx * w * 0.25, y - fy * w * 0.6 - ly * w * 0.25);
          c.lineTo(x + lx * w * 0.3, y + ly * w * 0.3);
          c.lineTo(x + fx * w * 0.6 - lx * w * 0.25, y + fy * w * 0.6 - ly * w * 0.25);
        }, Math.max(1.2, 0.16 * z));
      }
    }
  }

  function drawGulls(): void {
    const z = cam.z;
    for (const f of run.course.flocks) {
      if (Math.abs(f.s - run.s) > 110 || (f.flown > 2.6 && f.flown >= 0)) continue;
      const p = run.course.pose(f.s);
      for (let i = 0; i < f.n; i++) {
        const h1 = hash(f.seed, i);
        const h2 = hash(f.seed, i + 9);
        const t = Math.max(0, f.flown - h1 * 0.25);
        const flying = f.flown >= 0 && t > 0;
        const out = Math.sign(f.d) || 1;
        const along = (h1 - 0.5) * 3 + (flying ? t * t * 6 + t * 4 : 0);
        const side = f.d + (h2 - 0.5) * 1.6 + (flying ? out * (t * 5 + t * t * 3) : 0);
        const q = run.course.point(f.s + along, side);
        const x = cam.X(q.x, q.y);
        const y = cam.Y(q.x, q.y);
        const sc = (flying ? 1 + t * 0.5 : 1) * z;
        const [fx, fy] = cam.dir(Math.cos(p.a), Math.sin(p.a));
        const lx = -fy;
        const ly = fx;
        if (flying) {
          const flap = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(time * 18 + i);
          const wing = 0.9 * sc;
          const back = (0.2 + flap * 0.35) * sc;
          const path = (c: CanvasRenderingContext2D) => {
            c.moveTo(x + fx * 0.3 * sc, y + fy * 0.3 * sc);
            c.lineTo(x + lx * wing - fx * back, y + ly * wing - fy * back);
            c.lineTo(x - fx * 0.15 * sc, y - fy * 0.15 * sc);
            c.lineTo(x - lx * wing - fx * back, y - ly * wing - fy * back);
            c.closePath();
          };
          region(press, [0, 0, 0], path);
          ink(press, TEAL, 1, path, 1);
        } else {
          const path = (c: CanvasRenderingContext2D) => {
            c.moveTo(x + 0.3 * sc, y);
            c.ellipse(x, y, 0.3 * sc, 0.2 * sc, Math.atan2(fy, fx) + h2, 0, TAU);
          };
          region(press, [0, 0, 0], path);
          ink(press, TEAL, 1, path, 1);
          region(press, [0, 1, 0.6], (c) => c.arc(x + fx * 0.32 * sc, y + fy * 0.32 * sc, Math.max(0.8, 0.07 * sc), 0, TAU));
        }
      }
    }
  }

  function cartPose(): CartPose {
    const crashed = run.phase === "crashed";
    const sea = crashed && Math.sign(run.d) < 0;
    const fall = crashed && sea ? clamp((run.crashedFor - 0.15) / 0.7) : 0;
    return {
      x: run.x,
      y: run.y,
      yaw: run.yaw,
      steer: clamp(run.kappa * 6, -0.5, 0.5) - run.slip * 0.6,
      crates: run.crates,
      bump: 0,
      scale: 1 - fall * 0.45,
      load,
      headlamp: sky.night,
    };
  }

  function wash(f: number): void {
    const levels: Array<[PlateName, number]> = [
      [TEAL, sky.washTeal * f],
      [SUN, sky.washSun * f],
      [RED, sky.washRed * f],
    ];
    for (const [p, k] of levels) {
      if (k < 0.02) continue;
      const c = press.plate(p);
      c.fillStyle = press.screen(p, k);
      c.fillRect(0, 0, W, H);
    }
  }

  function drawWorld(): void {
    const z = cam.z;
    const R = Math.hypot(W, H) / z;
    const back = Math.min(R * 0.6, 60);
    const s0 = Math.max(run.course.segs[0]!.s0 + 1, run.s - back);
    const s1 = run.s + R + 8;
    run.course.ensure(s1 + 4);
    sampleStrip(strip, run.course, cam, s0, s1, 2);
    const look = { sky, time, still: reduced };
    drawSea(press, W, H, look, cam);
    drawLand(press, strip, z);
    drawItems(press, scenery.items(run.course, s0 - 20, s1), cam, look, W, H);
    // The light of the hour over the land and the sea; the road gets less of it, so it stays the brightest thing.
    wash(1);
    drawRoad(press, strip, z, look);
    drawSkids();
    drawChevrons();
    drawBestPost();
    drawLemons();
    drawGates();
    drawGulls();
    // Tumbling crates (saves), then the cart.
    for (const t of tumbles) {
      const k = t.sea ? clamp((t.t - 0.3) / 0.9) : 0;
      const x = cam.X(t.x, t.y);
      const y = cam.Y(t.x, t.y);
      const r = 0.36 * z * (1 - k * 0.6);
      const c = Math.cos(t.rot);
      const s = Math.sin(t.rot);
      region(press, [0, 0.6, 1], (g) => {
        g.moveTo(x + (c - s) * r, y + (s + c) * r);
        g.lineTo(x + (-c - s) * r, y + (-s + c) * r);
        g.lineTo(x + (-c + s) * r, y + (-s - c) * r);
        g.lineTo(x + (c + s) * r, y + (s - c) * r);
        g.closePath();
      });
    }
    const pose = cartPose();
    if (!(run.phase === "crashed" && pose.scale < 0.6)) drawCart(press, cam, pose, sky);
    // Splash rings where the cart (or a crate) met the sea.
    const rings: Array<{ x: number; y: number; t: number }> = [];
    if (run.phase === "crashed" && Math.sign(run.d) < 0 && run.crashedFor > 0.7) {
      // Rings keep spreading on the water while the game-over strip is up.
      for (let i = 0; i < 3; i++) {
        const t = (run.crashedFor - 0.7 - i * 0.45) % 3;
        if (run.crashedFor - 0.7 - i * 0.45 > 0) rings.push({ x: run.x, y: run.y, t });
      }
    }
    for (const t of tumbles) if (t.sea && t.t > 1.0) rings.push({ x: t.x, y: t.y, t: t.t - 1.0 });
    for (const r of rings) {
      const x = cam.X(r.x, r.y);
      const y = cam.Y(r.x, r.y);
      const k = easeOutCubic(clamp(r.t / 3));
      knock(press, [TEAL, RED], (c) => {
        c.arc(x, y, (0.6 + k * 2.6) * z, 0, TAU);
        c.moveTo(x + (0.3 + k * 1.5) * z, y);
        c.arc(x, y, (0.3 + k * 1.5) * z, 0, TAU);
      }, Math.max(1, (1 - k) * 0.35 * z));
    }
    // Particles, through the camera.
    const parts: Array<[Particles, PlateName]> = [
      [dust, SUN],
      [grit, RED],
      [juice, SUN],
    ];
    for (const [ps, plate] of parts) {
      const c = press.plate(plate);
      cam.apply(press, c);
      ps.draw(c);
    }
    confetti.forEach((ps, i) => {
      const c = press.plate(PLATES[i]!);
      cam.apply(press, c);
      ps.draw(c);
    });
    for (const p of PLATES) press.plate(p);
    wash(0.35);
    if (run.phase === "drive" || run.crashedFor < 0.4) drawHeadlamp(press, cam, run.x, run.y, run.yaw, clamp((sky.night - 0.3) / 0.5));
  }

  // ------------------------------------------------------------------------------------------------------------
  // HUD and words
  // ------------------------------------------------------------------------------------------------------------
  /** A strip of bare paper with a red rule along its top: bitbybit's ticket for small type over the print. */
  function ticket(x: number, y: number, w: number, h: number, rule = true): void {
    knock(press, PLATES, (c) => c.rect(x, y, w, h));
    if (rule) ink(press, RED, 1, (c) => c.rect(x, y, w, 1.5));
  }

  function doublePrint(text: string, x: number, y: number, font: string, track: number, off: number, align = 0.5): void {
    const t = press.plate(TEAL);
    t.fillStyle = press.solid(TEAL);
    spaced(t, text, x, y, font, track, align);
    const r = press.plate(RED);
    r.fillStyle = press.solid(RED);
    spaced(r, text, x + off, y + off * 0.6, font, track, align);
  }

  /** A capsule of solid ink with the word knocked out to paper (bitbybit's prompt). */
  function capsule(plate: PlateName, word: string, x: number, y: number, u: number, k = 1): void {
    const c = press.plate(plate);
    const breathe = light01.pulse(time, 0.5, { still: 0.5 });
    const font = medium(12.5 * u);
    const track = 4.2 * u;
    const tw = spacedWidth(c, word, font, track);
    const w = (tw + 34 * u + breathe * 6 * u) * (0.85 + 0.15 * k);
    const h = 30 * u * (0.85 + 0.15 * k);
    knock(press, PLATES, (g) => g.roundRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, h / 2 + 3));
    c.fillStyle = k >= 0.98 ? press.solid(plate) : press.screen(plate, k);
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    spaced(c, word, x + track / 2, y + 4.5 * u, font, track);
    c.globalCompositeOperation = "source-over";
  }

  function regMark(x: number, y: number, r: number): void {
    for (const p of PLATES) {
      const c = press.plate(p);
      c.strokeStyle = press.solid(p);
      c.lineWidth = 0.9;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.moveTo(x - r * 1.7, y);
      c.lineTo(x + r * 1.7, y);
      c.moveTo(x, y - r * 1.7);
      c.lineTo(x, y + r * 1.7);
      c.stroke();
    }
  }

  function drawHud(): void {
    if (mode !== "play") return;
    const top = session.play().top;
    const sc = fmt(shownScore);
    const t = press.plate(TEAL);
    const font = light(28);
    const sw = spacedWidth(t, sc, font, 1.2);
    const mult = run.mult;
    const mw = mult > 1 ? spacedWidth(t, `×${mult}`, medium(15), 1) + 10 : 0;
    const lx = 12;
    const ly = top + 8;
    ticket(lx, ly, Math.max(92, sw + mw + 24), 50);
    doublePrint(sc, lx + 12, ly + 33, font, 1.2, 1.3, 0);
    if (mult > 1) {
      const pop = tierShow.mult === mult ? 1 + (1 - easeOutCubic(clamp(tierShow.t / 0.25))) * 0.6 : 1;
      const r = press.plate(RED);
      r.fillStyle = press.solid(RED);
      spaced(r, `×${mult}`, lx + 12 + sw + 8, ly + 32, medium(15 * pop), 1, 0);
    }
    // Streak pips toward the next tier.
    const next = TIERS.find((x) => x > run.streak);
    const prev = [...TIERS].reverse().find((x) => x <= run.streak) ?? 0;
    if (next !== undefined) {
      const n = next - prev;
      const have = run.streak - prev;
      const r = press.plate(RED);
      for (let i = 0; i < n; i++) {
        r.fillStyle = i < have ? press.solid(RED) : press.screen(RED, 0.35);
        r.beginPath();
        r.arc(lx + 15 + i * 9, ly + 43, 2.6, 0, TAU);
        r.fill();
      }
    }
    // Right: distance, the best distance, the spare crate.
    const dist = fmtKm(run.metres);
    const df = medium(14);
    const dw = spacedWidth(t, dist, df, 1.4);
    const bestLine = bestM > 0 ? `best ${fmtKm(Math.max(bestM, pastBest ? run.metres : 0))}` : "";
    const bw = bestLine ? spacedWidth(t, bestLine, medium(10), 1.6) : 0;
    const rw = Math.max(dw, bw, 60) + 22;
    const rx = W - 12 - rw;
    ticket(rx, ly, rw, 50);
    t.fillStyle = press.solid(TEAL);
    spaced(t, dist, rx + rw - 11, ly + 22, df, 1.4, 1);
    if (bestLine) spaced(t, bestLine, rx + rw - 11, ly + 38, medium(10), 1.6, 1);
    // The spare crate, as a little red box with lemons in it.
    if (run.crates > 0) {
      const k = 1 + crateFlash * 0.5;
      const s = 9 * k;
      const bx = rx + 10;
      const by = ly + 34;
      region(press, [0, 0.6, 1], (c) => c.rect(bx, by - s / 2, s * 1.4, s));
      region(press, [0, 1, 0], (c) => c.arc(bx + s * 0.7, by, s * 0.32, 0, TAU));
      if (!bestLine) {
        const r = press.plate(RED);
        r.fillStyle = press.solid(RED);
        spaced(r, "spare", rx + rw - 11, ly + 38, medium(10), 1.6, 1);
      }
    }
  }

  function drawPopups(): void {
    for (const p of popups) {
      const k = p.t / p.life;
      const pop = k < 0.14 ? 0.6 + (k / 0.14) * 0.55 : 1.15 - Math.min(0.15, (k - 0.14) * 0.5);
      const font = medium(p.size * pop);
      const y = p.y - easeOutCubic(k) * 26;
      const c = press.plate(p.plate);
      const w = spacedWidth(c, p.text, font, 1.2);
      knock(press, PLATES, (g) => g.roundRect(p.x - w / 2 - 7, y - p.size * pop * 0.95, w + 14, p.size * pop * 1.35, 4));
      c.fillStyle = k > 0.7 ? press.screen(p.plate, 1 - (k - 0.7) / 0.3) : press.solid(p.plate);
      spaced(c, p.text, p.x, y, font, 1.2, 0.5);
    }
  }

  function drawBanners(): void {
    for (const b of banners) {
      const k = b.t / b.life;
      const out = k > 0.8 ? easeOutCubic((k - 0.8) / 0.2) : 0;
      const stamp = (k < 0.1 ? 1.4 - easeOutCubic(k / 0.1) * 0.4 : 1) * (1 - out * 0.2);
      const size = b.size * stamp * Math.min(1, W / 390);
      const track = size * 0.08;
      const cx = W / 2;
      const cy = session.play().top + (H - session.play().top) * 0.3 - out * 14;
      const t = press.plate(TEAL);
      const tw = spacedWidth(t, b.text, light(size), track);
      const sw = b.sub ? spacedWidth(t, b.sub, medium(13), 2.4) : 0;
      const w = Math.max(tw, sw) + 36;
      const h = size + (b.sub ? 30 : 16);
      if (out < 0.95) ticket(cx - w / 2, cy - size * 0.95, w, h);
      doublePrint(b.text, cx, cy, light(size), track, 1.8);
      if (b.sub) {
        t.fillStyle = press.solid(TEAL);
        spaced(t, b.sub, cx, cy + 22, medium(13), 2.4);
      }
    }
  }

  function drawAttract(): void {
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const u = clamp(Math.min(W / 390, H / 760), 0.85, 1.4);
    const k = clamp(time / 1.0);
    const avail = W - r.left - r.right - 28;
    const size = Math.min(54 * u, avail / 5.2);
    const cw = Math.min(avail, size * 5.6);
    const hasBest = session.best !== null && session.best > 0;
    const ch = (hasBest ? 150 : 132) * u;
    const top = Math.max(r.top + 22, (H - r.bottom - r.top) * 0.18 + r.top) + (1 - easeOutCubic(k)) * 8;
    ticket(cx - cw / 2, top, cw, ch);
    ink(press, RED, 1, (c) => c.rect(cx - cw / 2, top + ch - 1.5, cw, 1.5));
    regMark(cx - cw / 2 + 12, top + 14, 4);
    regMark(cx + cw / 2 - 12, top + 14, 4);
    doublePrint(TITLE, cx, top + 24 * u + size * 0.85, light(size), size * 0.1, 2.2);
    const t = press.plate(TEAL);
    t.fillStyle = press.solid(TEAL);
    const ty = top + 24 * u + size * 0.85 + 26 * u;
    spaced(t, TAGLINE, cx, ty, medium(11 * u), 2 * u);
    spaced(t, TAGLINE_2, cx, ty + 16 * u, medium(11 * u), 2 * u);
    if (hasBest) {
      const rr = press.plate(RED);
      rr.fillStyle = press.solid(RED);
      spaced(rr, `best ${fmt(session.best!)}${bestM > 0 ? ` · ${fmtKm(bestM)}` : ""}`, cx, ty + 36 * u, medium(10.5 * u), 3.4 * u);
    }
    capsule(RED, PROMPT, cx, top + ch + 30 * u, u);
  }

  function drawPrompt(): void {
    if (prompt.k < 0.03 || !prompt.word) return;
    const c = cartScreen();
    const y = clamp(c.y - 150, session.play().top + 90, H - 60);
    capsule(prompt.word === HINT_HOLD ? TEAL : RED, prompt.word, W / 2, y, 1, prompt.k);
    // The bend's direction as an arrow beside the capsule.
    if (prompt.word === HINT_HOLD) {
      const dir = run.holding ? run.dir : run.course.bendAhead(run.s, run.v * 0.28);
      const ax = W / 2 - dir * 70;
      const t = press.plate(TEAL);
      t.strokeStyle = prompt.k > 0.98 ? press.solid(TEAL) : press.screen(TEAL, prompt.k);
      t.lineWidth = 3;
      t.lineCap = "round";
      t.beginPath();
      t.moveTo(ax + dir * 12, y + 10);
      t.quadraticCurveTo(ax + dir * 12, y - 8, ax - dir * 8, y - 8);
      t.moveTo(ax - dir * 2, y - 15);
      t.lineTo(ax - dir * 9, y - 8);
      t.lineTo(ax - dir * 2, y - 1);
      t.stroke();
    }
  }

  /**
   * What the run did, against the best, and one tip. In the feed the shell's result card covers the middle and the
   * caption the bottom, so this is a strip just above the caption; a bare tab gets the score and a prompt too.
   */
  function drawSummary(): void {
    const sm = summary;
    if (!sm || session.phaseTime < 0.4) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 18 : pv.left + 14;
    const right = W - (solo ? 18 : pv.right + 8);
    const w = right - left;
    const h = 98;
    const top = solo ? Math.round(H * 0.5) : H - pv.bottom - h - 8;
    const k = easeOutCubic(clamp((session.phaseTime - 0.4) / 0.5));
    const lift = (1 - k) * 14;
    knock(press, PLATES, (c) => c.rect(left - 6, top + lift - 6, w + 12, h + 12));
    const t = press.plate(TEAL);
    const r = press.plate(RED);
    r.fillStyle = press.solid(RED);
    r.fillRect(left, top + lift, w * k, 2);
    t.fillStyle = press.solid(TEAL);
    t.fillRect(left + w * (1 - k), top + lift + h, w * k, 1);
    t.fillStyle = press.solid(TEAL);
    let sz = 12;
    while (sz > 10 && spacedWidth(t, sm.line, medium(sz), 1.6) > w - 24) sz -= 0.5;
    spaced(t, sm.line, left + 12, top + lift + 24, medium(sz), 1.6, 0);
    const barY = top + lift + 36;
    const bw = w - 24;
    t.fillStyle = press.screen(TEAL, 0.3);
    t.fillRect(left + 12, barY, bw, 10);
    const frac = sm.isBest || !sm.prevBest ? 1 : clamp(sm.score / sm.prevBest);
    const grow = clamp((session.phaseTime - 0.5) / 0.8);
    r.fillStyle = press.solid(RED);
    r.fillRect(left + 12, barY, Math.max(4, bw * frac * grow), 10);
    t.fillStyle = press.solid(TEAL);
    spaced(t, barLabel(sm.isBest, sm.score, sm.prevBest, frac, fmt), left + 12, barY + 27, light(14), 1.2, 0);
    let size = TIP_PX;
    while (size > TIP_MIN_PX && spacedWidth(t, sm.tip, light(size), 0.6) > bw) size -= 0.5;
    spaced(t, sm.tip, left + 12, top + lift + h - 12, light(size), 0.6, 0);
    if (solo && session.phaseTime > 0.8) {
      knock(press, PLATES, (c) => c.rect(W / 2 - 120, top - 140, 240, 100));
      doublePrint(fmt(sm.score), W / 2, top - 82, light(60), 3, 2.4);
      if (session.best !== null) {
        t.fillStyle = press.solid(TEAL);
        spaced(t, `best ${fmt(session.best)}`, W / 2, top - 56, medium(11), 4.5);
      }
      capsule(RED, PROMPT, W / 2, top + h + 46, 1);
    }
  }

  function render(): void {
    press.begin();
    drawWorld();
    if (mode === "attract") drawAttract();
    else {
      drawHud();
      drawPopups();
      drawBanners();
      if (session.phase === "playing") drawPrompt();
      if (session.phase === "over") drawSummary();
    }
    press.print(ctx);
    if (veil > 0) drawVeil(Math.min(1, veil));
  }

  /** A halftone dissolve to paper. */
  const veilPatterns = new Map<number, CanvasPattern>();
  let veilDpr = 0;
  function drawVeil(k: number): void {
    const q = Math.round(k * 12);
    if (q <= 0) return;
    view.begin();
    if (q >= 12) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const dpr = view.dpr;
    if (dpr !== veilDpr) {
      veilPatterns.clear();
      veilDpr = dpr;
    }
    let pat = veilPatterns.get(q);
    if (!pat) {
      // Drawn in device pixels and mapped 1:1 onto the screen: WebKit fills a scaled pattern on a very slow path.
      const s = 6 * dpr;
      const c = document.createElement("canvas");
      c.width = c.height = Math.round(s * 2);
      const g = c.getContext("2d")!;
      g.fillStyle = PAPER;
      g.beginPath();
      g.arc(c.width / 2, c.width / 2, Math.sqrt(((q / 12) * 4 * s * s) / Math.PI) * 1.02, 0, TAU);
      g.fill();
      pat = ctx.createPattern(c, "repeat")!;
      pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
      veilPatterns.set(q, pat);
    }
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }

  newDemo();
  update(0);
  render();
  let readySent = false;
  tc.loop((dt) => {
    // Autoplay QA builds step by frames, so a recorded run plays out the same whatever the harness timing.
    update(QA_AUTOPLAY ? 1 / 60 : Math.min(dt, 1 / 20));
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
