import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeOutBack, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BOMB, clampAngle, COLS, EMPTY, idx, INKS as INK_COUNT, LAUNCH_X, LAUNCH_Y, LIMIT, LINE_Y, ROW_H, ROWS, WILD, type Trace } from "./board.ts";
import { blotPath, drawDrum, drawPot, drawSquid, drawThumb, INKS, mainPlate, makeDotArt, PLATE, platesOf, printDot, registrationMark, type DotArt, type PlateName, type SquidPose } from "./draw.ts";
import { POT_DY, sheetLayout } from "./layout.ts";
import { DemoPilot, plan, SKILLS, type Plan } from "./pilot.ts";
import { PAPER, Press } from "./riso.ts";
import { Run, runSeed, SPEED, type RunEvent } from "./run.ts";
import { createSound } from "./sound.ts";
import { fmt, light, loadType, medium, spaced, spacedWidth } from "./type.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`), to record and measure it. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;
/** Where the next ink waits, and the press meter, in board units from the launch point. */
const NEXT_DX = -2.15;
const SLOT_DY = 0.62;
const METER_X0 = 1.35;
const METER_X1 = 3.7;

interface Pending {
  x: number;
  y: number;
  kind: number;
  delay: number;
  i: number;
  combo: number;
  how: "match" | "wild" | "bomb";
}
interface Splat {
  x: number;
  y: number;
  r: number;
  seed: number;
  kind: number;
  t: number;
  life: number;
}
interface Faller {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  kind: number;
  delay: number;
  pts: number;
  group: number;
  quiet: boolean;
}
interface Popup {
  group: number;
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
interface Flyer {
  kind: number;
  x: number;
  y: number;
  t: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "spotfall", restartDelayMs: 800 }), loadType()]);
  let hintSeen = false;
  let swapSeen = false;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
    swapSeen = (await tc.storage.get<boolean>("swap")) === true;
  } catch {
    /* guests and offline: show the hints */
  }
  const view = createCanvas({ maxDpr: 2, background: PAPER });
  const { ctx } = view;
  const press = new Press({ paper: PAPER, inks: INKS, slip: 1.3 });
  const reduced = session.reducedMotion;
  const light01 = new Photosafe(reduced);
  const sound = createSound();
  const shake = new Shake(7, 0, 2, reduced);
  const hitStop = new HitStop();
  const sprays = PLATE.map(() => new Particles(320));

  // -------------------------------------------------------------------------------------------------------------
  // Layout: the board is 9 dots wide and the same shape on every phone; only its scale changes.
  // -------------------------------------------------------------------------------------------------------------
  let W = view.width;
  let H = view.height;
  let S = 40;
  let bx = 0;
  let by = 0;
  let art: DotArt = makeDotArt(S, 2);
  function layout() {
    W = view.width;
    H = view.height;
    press.resize(W, H, view.dpr);
    const L = sheetLayout(W, H, session.play().top);
    const changed = Math.abs(L.S - S) > 0.01 || art.s !== L.S;
    S = L.S;
    bx = L.bx;
    by = L.by;
    if (changed) art = makeDotArt(S, Math.min(3, view.dpr * 1.15));
  }
  layout();
  view.onResize(layout);
  let playTop = session.play().top;
  session.on("insets", () => {
    if (session.play().top !== playTop) {
      playTop = session.play().top;
      layout();
    }
  });

  // Per-frame world offset (screen shake), applied to everything on the sheet.
  let ox = 0;
  let oy = 0;
  const X = (u: number) => bx + ox + u * S;
  const Y = (u: number) => by + oy + u * S;
  const launchX = () => X(LAUNCH_X);
  const launchY = () => Y(LAUNCH_Y);
  const potY = () => Y(LAUNCH_Y + POT_DY);

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = (session.ctx.seed ^ 0x2545f491) >>> 0;
  let run = new Run(demoSeed, { demo: true });
  let demo = new DemoPilot(createRng(demoSeed ^ 99));
  let qaPilot: DemoPilot | null = null;
  let demoAge = 0;
  let time = 0;
  let veil = 0;
  let veilAction: (() => void) | null = null;
  let pending: Pending[] = [];
  let splats: Splat[] = [];
  let fallers: Faller[] = [];
  let ripples: Array<{ x: number; t: number; a: number }> = [];
  let popups: Popup[] = [];
  let banners: Banner[] = [];
  let flyers: Flyer[] = [];
  let groupArrivals = new Map<number, number>();
  let groupSeq = 0;
  let tally: { n: number; pts: number; t: number; group: number } | null = null;
  const jig = new Float32Array(ROWS * COLS * 4);
  let feedAnim = { t: 1, dur: 0.3, rows: 0 };
  let drumTurn = 0;
  let shownScore = 0;
  let bestCheered = false;
  let endT = -1;
  let ended = false;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string } | null = null;
  let heartT = 0;
  let hurryT = 0;
  let lastSeg = 0;
  let swapAnim = 1;
  let loadAnim = 1;
  let earnPulse = 0;
  let comboShow = { n: 0, t: 9 };
  let hintPlan: Plan | null = null;
  const hintRng = createRng(4242);
  let hintT = 0;
  let firstPop = false;
  const squid: SquidPose = { tilt: 0, recoil: 0, lookX: 0, lookY: -1, blink: 0, worry: 0, joy: 0, time: 0 };
  let blinkT = 2;

  /** The finger: aiming, or pressing the squid / next ink to swap. */
  let aim: { id: number; x0: number; y0: number; x: number; y: number; angle: number; swap: boolean; moved: boolean; cancel: boolean; hist: Array<{ t: number; a: number }> } | null = null;
  let buffered: { angle: number; t: number } | null = null;
  let keyAim: number | null = null;

  const playing = () => mode === "play" && session.phase === "playing";

  function resetFx() {
    pending = [];
    splats = [];
    fallers = [];
    ripples = [];
    popups = [];
    banners = [];
    flyers = [];
    groupArrivals = new Map();
    tally = null;
    jig.fill(0);
    feedAnim = { t: 1, dur: 0.3, rows: 0 };
    for (const p of sprays) p.clear();
    aim = null;
    buffered = null;
    lastSeg = 0;
    comboShow = { n: 0, t: 9 };
  }

  function newDemo() {
    mode = "attract";
    demoSeed = (demoSeed * 1664525 + 1013904223) >>> 0;
    run = new Run(demoSeed, { demo: true });
    demo = new DemoPilot(createRng(demoSeed ^ 99));
    demoAge = 0;
    resetFx();
  }

  function startRun() {
    const begin = () => {
      mode = "play";
      // Each run's sheet comes from the launch seed and the run number, never from how long the demo ran.
      run = new Run(runSeed(session.ctx.seed, session.runs));
      resetFx();
      press.register(session.runs + 1);
      shownScore = 0;
      bestCheered = false;
      endT = -1;
      ended = false;
      summary = null;
      firstPop = false;
      hintPlan = null;
      hintT = 0;
      qaPilot = QA_AUTOPLAY ? new DemoPilot(createRng(7), { ...QA_AUTOPLAY, noise: 0 }) : null;
    };
    // A fresh sheet comes through the press under a halftone wipe.
    veil = Math.max(veil, 0.01);
    veilAction = begin;
    sound.start();
  }
  session.startOnTap(window);
  session.on("start", startRun);

  // -------------------------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------------------------
  function angleTo(x: number, y: number): number {
    const dx = x - launchX();
    const dy = Math.max(S * 0.25, launchY() - y);
    return clampAngle(Math.atan2(dy, dx));
  }
  const inCancel = (y: number) => y > launchY() + S * 0.55;
  const nextPos = () => ({ x: X(LAUNCH_X + NEXT_DX), y: Y(LAUNCH_Y + SLOT_DY) });
  function onSquid(x: number, y: number): boolean {
    const n = nextPos();
    return Math.hypot(x - launchX(), y - (launchY() + S * 0.35)) < S * 0.95 || Math.hypot(x - n.x, y - n.y) < S * 0.85;
  }

  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Presses that began outside a run never aim (the tap that starts a run is not a shot).
    if (!playing() || aim) return;
    const x = e.clientX;
    const y = e.clientY;
    const sw = onSquid(x, y);
    aim = { id: e.pointerId, x0: x, y0: y, x, y, angle: angleTo(x, y), swap: sw, moved: false, cancel: false, hist: [] };
    aim.hist.push({ t: performance.now(), a: aim.angle });
  });
  window.addEventListener("pointermove", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    aim.x = e.clientX;
    aim.y = e.clientY;
    if (Math.hypot(aim.x - aim.x0, aim.y - aim.y0) > 12) aim.moved = true;
    if (aim.swap && aim.moved) aim.swap = false;
    aim.angle = angleTo(aim.x, aim.y);
    aim.cancel = inCancel(aim.y);
    const now = performance.now();
    aim.hist.push({ t: now, a: aim.angle });
    while (aim.hist.length > 2 && aim.hist[0]!.t < now - 250) aim.hist.shift();
  });
  window.addEventListener("pointerup", (e) => {
    if (!aim || e.pointerId !== aim.id) return;
    const a = aim;
    aim = null;
    if (!playing()) return;
    if (a.swap && !a.moved) {
      doSwap();
      return;
    }
    if (inCancel(e.clientY)) return;
    // A thumb lifting off nudges the aim: fire where the guide pointed a few frames ago.
    const now = performance.now();
    let angle = angleTo(e.clientX, e.clientY);
    for (let i = a.hist.length - 1; i >= 0; i--) {
      if (a.hist[i]!.t <= now - 55) {
        angle = a.hist[i]!.a;
        break;
      }
    }
    if (a.hist.length && a.hist[0]!.t > now - 55) angle = a.hist[0]!.a;
    shoot(angle);
  });
  window.addEventListener("pointercancel", (e) => {
    if (aim && e.pointerId === aim.id) aim = null;
  });
  session.on("cancel", () => (aim = null));
  session.on("pause", () => (aim = null));
  window.addEventListener("keydown", (e) => {
    if (!playing()) return;
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      keyAim = clampAngle((keyAim ?? Math.PI / 2) + (e.code === "ArrowLeft" ? 0.035 : -0.035));
      e.preventDefault();
    } else if (e.code === "Space" && !e.repeat) {
      shoot(keyAim ?? Math.PI / 2);
      e.preventDefault();
    } else if ((e.code === "KeyS" || e.code === "ArrowDown") && !e.repeat) {
      doSwap();
      e.preventDefault();
    }
  });

  function shoot(angle: number) {
    if (run.loaded && feedAnim.t >= feedAnim.dur) run.fire(angle);
    else buffered = { angle, t: 0.7 };
  }

  function doSwap() {
    if (run.swap()) {
      if (!swapSeen) {
        swapSeen = true;
        tc.storage.set("swap", true).catch(() => undefined);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Events → feel
  // -------------------------------------------------------------------------------------------------------------
  function emitInk(kind: number, x: number, y: number, count: number, speed: [number, number], o: { angle?: [number, number]; gravity?: number; size?: [number, number] } = {}) {
    const plates = platesOf(kind);
    for (const p of plates) {
      sprays[p]!.emit(x + (p - 1) * 1.5, y, {
        count: Math.ceil(count / plates.length),
        speed,
        angle: o.angle,
        life: [0.35, 0.8],
        size: o.size ?? [3, 7],
        colors: [press.solid(PLATE[p]!)],
        gravity: o.gravity ?? 900,
        drag: 2.2,
        shape: "circle",
        endScale: 0.2,
      });
    }
  }
  function popup(text: string, x: number, y: number, plate: PlateName, size = 15, life = 0.9, group = 0) {
    if (group) {
      // A cascade keeps only its last few numbers up, so they never pile into a smudge.
      const mine = popups.filter((p) => p.group === group);
      if (mine.length >= 3) popups.splice(popups.indexOf(mine[0]!), 1);
    }
    popups.push({ group, text, x, y, t: 0, life, plate, size });
    if (popups.length > 18) popups.shift();
  }
  function banner(text: string, sub = "", size = 44, life = 1.5) {
    banners = banners.filter((b) => b.t < b.life * 0.6);
    banners.push({ text, sub, t: 0, life, size });
  }
  function jolt(px: number) {
    if (!reduced) press.jolt(px, Math.floor(time * 1000));
  }
  const loud = () => mode === "play";
  const lv = () => (mode === "play" ? 1 : 0.35);

  function handle(e: RunEvent) {
    switch (e.k) {
      case "fire":
        sound.fire(lv());
        squid.recoil = 1;
        loadAnim = 0;
        lastSeg = 0;
        emitInk(e.kind < INK_COUNT ? e.kind : 0, launchX(), launchY() + S * 0.2, 6, [60, 160], { angle: [Math.PI * 0.15, Math.PI * 0.85], gravity: 700, size: [2, 5] });
        break;
      case "land": {
        sound.land(lv());
        shake.add(0.06);
        // The sheet gives: neighbours spring away from the dot that landed, the next ring a little.
        const lx = e.dot.x;
        const ly = e.dot.y;
        for (let r = Math.max(0, e.dot.r - 2); r <= Math.min(ROWS - 1, e.dot.r + 2); r++)
          for (let c = 0; c < COLS; c++) {
            if (!run.board.valid(r, c) || (r === e.dot.r && c === e.dot.c)) continue;
            const dx = run.board.cx(r, c) - lx;
            const dy = run.board.cy(r) - ly;
            const d = Math.hypot(dx, dy);
            if (d > 2.1 || d < 0.1) continue;
            const k = (d < 1.2 ? 1.6 : 0.6) / d;
            const j = idx(r, c) * 4;
            jig[j + 2]! += dx * k;
            jig[j + 3]! += dy * k;
          }
        break;
      }
      case "pop": {
        const order = [...e.dots].sort((a, b) => Math.hypot(a.x - e.at.x, a.y - e.at.y) - Math.hypot(b.x - e.at.x, b.y - e.at.y));
        const step = Math.min(0.045, 0.42 / Math.max(1, order.length));
        order.forEach((d, i) => pending.push({ x: d.x, y: d.y, kind: d.kind, delay: 0.02 + i * step, i, combo: e.combo, how: e.how }));
        const cx = e.dots.reduce((a, d) => a + d.x, 0) / e.dots.length;
        const cy = e.dots.reduce((a, d) => a + d.y, 0) / e.dots.length;
        popup(`+${fmt(e.points)}`, X(cx), Y(cy) - S * 0.2, mainPlate(e.dots[0]!.kind), 15 + Math.min(10, e.combo * 1.5), 1);
        if (e.combo >= 2) comboShow = { n: e.combo, t: 0 };
        if (e.how === "bomb") {
          if (loud()) sound.blot();
          shake.add(0.42);
          hitStop.freeze(0.07);
          jolt(4.5);
          session.feedback("impact");
          splats.push({ x: X(e.at.x), y: Y(e.at.y), r: S * 1.6, seed: Math.floor(time * 97), kind: BOMB, t: 0, life: 1.1 });
        } else {
          shake.add(Math.min(0.3, 0.08 + e.dots.length * 0.02));
          jolt(Math.min(3, 0.6 + e.dots.length * 0.25));
        }
        if (e.how === "wild" && loud()) sound.earn();
        if (mode === "play" && !firstPop) {
          firstPop = true;
          if (!hintSeen) {
            hintSeen = true;
            tc.storage.set("hint", true).catch(() => undefined);
          }
        }
        if (e.combo === 3 || e.combo === 6 || e.combo === 10) banner(e.combo >= 10 ? "unstoppable" : e.combo >= 6 ? "on a roll" : "combo", `×${e.combo} in a row`, 34, 1.1);
        break;
      }
      case "drop": {
        const g = ++groupSeq;
        groupArrivals.set(g, 0);
        e.dots.forEach((d, i) => {
          const side = d.x < COLS / 2 ? -1 : 1;
          fallers.push({
            x: X(d.x),
            y: Y(d.y),
            vx: (side * (30 + Math.random() * 110) + (Math.random() - 0.5) * 60) * (S / 40),
            vy: -(60 + Math.random() * 160) * (S / 40),
            rot: 0,
            vr: (Math.random() - 0.5) * 9,
            kind: d.kind,
            delay: 0.12 + (LIMIT - d.r) * 0.012 + Math.random() * 0.05,
            pts: e.points[i] ?? 0,
            group: g,
            quiet: false,
          });
        });
        tally = { n: 0, pts: 0, t: 0, group: g };
        const n = e.dots.length;
        if (n >= 4) {
          hitStop.freeze(n >= 8 ? 0.08 : 0.05);
          if (loud()) session.feedback("impact");
        }
        shake.add(Math.min(0.45, 0.1 + n * 0.03));
        jolt(Math.min(5, 1 + n * 0.3));
        squid.joy = Math.min(1, 0.4 + n * 0.08);
        if (n >= 10) banner("spotfall!", `${n} dots dropped`, 50, 1.8);
        else if (n >= 6) banner("landslide", `${n} dots dropped`, 42, 1.5);
        break;
      }
      case "miss":
        break;
      case "earn": {
        const from = fallers.length ? { x: fallers[fallers.length - 1]!.x, y: fallers[fallers.length - 1]!.y } : { x: W / 2, y: Y(LINE_Y * 0.5) };
        flyers.push({ kind: e.special, x: from.x, y: from.y, t: 0 });
        if (loud()) sound.earn();
        if (loud()) session.feedback("tap");
        popup(e.special === WILD ? (e.why === "combo" ? "wild mark · combo" : "wild mark") : "ink blot", from.x, from.y - S * 0.6, "blue", 14, 1.2);
        break;
      }
      case "feed":
        feedAnim = { t: 0, dur: e.why === "clean" ? 0.75 : 0.32, rows: e.rows };
        jig.copyWithin(COLS * 4 * e.rows, 0, (ROWS - e.rows) * COLS * 4);
        jig.fill(0, 0, COLS * 4 * e.rows);
        for (const p of pending) p.y += e.rows * ROW_H;
        sound.feed(lv());
        shake.add(0.1);
        break;
      case "clean": {
        banner("clean sheet", `+${fmt(e.bonus)}`, 46, 2);
        if (loud()) sound.clean();
        jolt(5);
        if (loud()) session.feedback("success");
        for (let i = 0; i < 6; i++) emitInk(i, W * (0.1 + 0.16 * i), Y(0), 18, [80, 260], { angle: [Math.PI * 0.1, Math.PI * 0.9], gravity: 520, size: [4, 9] });
        break;
      }
      case "swap":
        sound.swap(false);
        swapAnim = 0;
        break;
      case "danger":
        break;
      case "over":
        if (mode !== "play") break;
        endT = 0;
        sound.jam();
        shake.add(0.55);
        jolt(7);
        hitStop.freeze(0.12);
        squid.worry = 1;
        banner("jammed", "", 40, 1.1);
        break;
    }
  }

  function popNow(p: Pending) {
    const x = X(p.x);
    const y = Y(p.y);
    if (p.how !== "bomb") splats.push({ x, y, r: S * (0.55 + Math.random() * 0.12), seed: Math.floor(Math.random() * 1e6), kind: p.kind, t: 0, life: 0.95 });
    emitInk(p.kind, x, y, p.how === "bomb" ? 14 : 9, [110, 300]);
    sound.pop(p.i, p.combo, lv());
  }

  // -------------------------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------------------------
  function tipFor(): string {
    const s = run.stats;
    if (s.feedsTime > s.feedsMiss + 2 && run.time < 45) return "shoot sooner: the press speeds up while you wait.";
    if (s.dropped < 4) return "pop the dots holding others up, and all of it falls.";
    if (s.banks === 0) return "bounce a shot off the side to reach the far dots.";
    if (s.swaps === 0) return "tap the squid to swap for the next ink.";
    if (s.bestCombo < 4) return "pop on every shot and the combo multiplies.";
    return "big drops earn wild marks. keep one for a tight spot.";
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    const dt = hitStop.scale(rawDt);
    shake.update(rawDt);
    press.settle(rawDt);
    for (const p of sprays) p.update(rawDt);
    squid.time += rawDt;

    // The veil: a halftone wipe to paper, then whatever was waiting for it.
    if (veilAction) {
      veil = Math.min(1, veil + rawDt * 4.5);
      if (veil >= 1) {
        veilAction();
        veilAction = null;
      }
    } else veil = Math.max(0, veil - rawDt * 2.6);

    if (mode === "attract") {
      demoAge += rawDt;
      demo.step(run, dt);
      if ((run.phase === "over" || demoAge > 70) && !veilAction) {
        veil = Math.max(veil, 0.01);
        veilAction = newDemo;
      }
    } else if (playing() && qaPilot) {
      qaPilot.step(run, dt);
    }

    if (buffered) {
      buffered.t -= rawDt;
      if (buffered.t <= 0) buffered = null;
      else if (playing() && run.loaded && feedAnim.t >= feedAnim.dur) {
        run.fire(buffered.angle);
        buffered = null;
      }
    }

    if (dt > 0) {
      const wasShot = run.shot;
      run.step(dt);
      for (const e of run.events) handle(e);
      run.events.length = 0;
      if (wasShot && run.shot === wasShot) trackBounce(wasShot.trace, wasShot.t);
    }

    // Feed, jiggle, pending pops, splats, fallers, popups.
    feedAnim.t = Math.min(feedAnim.dur, feedAnim.t + dt);
    if (feedAnim.t < feedAnim.dur) drumTurn += dt * 3.2;
    const kSpring = 340;
    const cDamp = 16;
    for (let i = 0; i < jig.length; i += 4) {
      if (jig[i] === 0 && jig[i + 1] === 0 && jig[i + 2] === 0 && jig[i + 3] === 0) continue;
      jig[i + 2]! += (-kSpring * jig[i]! - cDamp * jig[i + 2]!) * rawDt;
      jig[i + 3]! += (-kSpring * jig[i + 1]! - cDamp * jig[i + 3]!) * rawDt;
      jig[i]! += jig[i + 2]! * rawDt;
      jig[i + 1]! += jig[i + 3]! * rawDt;
      if (Math.abs(jig[i]!) + Math.abs(jig[i + 1]!) + Math.abs(jig[i + 2]!) + Math.abs(jig[i + 3]!) < 0.002) jig.fill(0, i, i + 4);
    }
    if (dt > 0) {
      for (const p of pending) p.delay -= dt;
      if (pending.some((p) => p.delay <= 0)) {
        for (const p of pending) if (p.delay <= 0) popNow(p);
        pending = pending.filter((p) => p.delay > 0);
      }
    }
    for (const s of splats) s.t += rawDt;
    if (splats.some((s) => s.t >= s.life)) splats = splats.filter((s) => s.t < s.life);
    stepFallers(dt);
    for (const r of ripples) r.t += rawDt;
    if (ripples.some((r) => r.t > 0.9)) ripples = ripples.filter((r) => r.t <= 0.9);
    for (const p of popups) p.t += rawDt;
    if (popups.some((p) => p.t >= p.life)) popups = popups.filter((p) => p.t < p.life);
    for (const b of banners) b.t += rawDt;
    if (banners.some((b) => b.t >= b.life)) banners = banners.filter((b) => b.t < b.life);
    for (const f of flyers) f.t += rawDt;
    if (flyers.some((f) => f.t >= 0.6)) {
      flyers = flyers.filter((f) => f.t < 0.6);
      earnPulse = 1;
    }
    earnPulse = Math.max(0, earnPulse - rawDt * 2.2);
    swapAnim = Math.min(1, swapAnim + rawDt * 7);
    loadAnim = Math.min(1, loadAnim + rawDt * 5);
    comboShow.t += rawDt;
    if (tally) tally.t += rawDt;

    // The squid: tilts toward the aim, eyes follow it, blinks, worries near the line.
    const showAim = aimAngle();
    const a = showAim ?? Math.PI / 2;
    squid.tilt = damp(squid.tilt, clamp((Math.PI / 2 - a) * 0.32, -0.42, 0.42), 9, rawDt);
    squid.lookX = damp(squid.lookX, Math.cos(a), 10, rawDt);
    squid.lookY = damp(squid.lookY, -Math.sin(a), 10, rawDt);
    squid.recoil = Math.max(0, squid.recoil - rawDt * 5);
    squid.joy = Math.max(0, squid.joy - rawDt * 0.9);
    squid.worry = damp(squid.worry, run.danger || run.phase === "over" ? 1 : 0, 4, rawDt);
    blinkT -= rawDt;
    if (blinkT <= 0) {
      squid.blink = 1;
      blinkT = 2.2 + Math.random() * 3;
    }
    squid.blink = Math.max(0, squid.blink - rawDt * 7);

    // Score rolls; a new best is celebrated the moment it falls.
    if (mode === "play") {
      const target = run.score;
      shownScore = shownScore < target ? Math.min(target, shownScore + Math.max(1, (target - shownScore) * 9 * rawDt)) : target;
      const best = session.best;
      if (!bestCheered && best !== null && best > 0 && run.score > best && session.phase === "playing") {
        bestCheered = true;
        banner("new best", `${fmt(run.score)}`, 44, 2);
        sound.best();
        session.feedback("success");
        for (let i = 0; i < 6; i++) emitInk(i, W * (0.08 + 0.17 * i), H * 0.62, 14, [260, 520], { angle: [-Math.PI * 0.8, -Math.PI * 0.2], gravity: 900, size: [4, 9] });
      }
    }

    if (playing()) {
      // A heartbeat near the line; a tick while the press hurries.
      if (run.danger) {
        heartT -= rawDt;
        if (heartT <= 0) {
          heartT = 0.85;
          sound.heart();
        }
      }
      if (run.hurrying) {
        hurryT -= rawDt;
        if (hurryT <= 0) {
          hurryT = 0.5;
          sound.hurry();
        }
      }
      // First runs: the thumbprint shows a good shot until the first pop.
      if (!hintSeen && run.loaded) {
        hintT += rawDt;
        if (!hintPlan || hintT > 2.6) {
          hintPlan = plan(run, { ...SKILLS[3]!, swaps: false }, hintRng);
          hintT = 0;
        }
      }
    }

    if (mode === "play" && endT >= 0) {
      endT += rawDt;
      if (!ended && endT >= 0.6) {
        ended = true;
        const prevBest = session.best;
        const s = run.stats;
        const res = session.end(run.score, { stats: { drop: s.biggestDrop, combo: s.bestCombo, popped: s.popped, dropped: s.dropped, shots: s.shots } });
        summary = { score: run.score, isBest: res.isBest, prevBest, tip: tipFor() };
        shownScore = run.score;
        // The jammed sheet lets go: every dot left falls into the pot.
        for (const c of run.board.occupied()) {
          const k = run.board.get(c.r, c.c);
          fallers.push({ x: X(run.board.cx(c.r, c.c)), y: Y(run.board.cy(c.r)), vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 60, rot: 0, vr: (Math.random() - 0.5) * 6, kind: k, delay: (ROWS - c.r) * 0.05 + Math.random() * 0.08, pts: 0, group: 0, quiet: true });
          run.board.set(c.r, c.c, EMPTY);
        }
      }
    }
  }

  function trackBounce(tr: Trace, t: number) {
    const d = t * SPEED;
    let acc = 0;
    let seg = 0;
    for (let i = 1; i < tr.points.length; i++) {
      const a = tr.points[i - 1]!;
      const b = tr.points[i]!;
      acc += Math.hypot(b.x - a.x, b.y - a.y);
      if (d < acc) break;
      seg = i;
    }
    if (seg > lastSeg && seg < tr.points.length - 1) {
      lastSeg = seg;
      const p = tr.points[seg]!;
      sound.bounce(lv());
      emitInk(0, X(p.x), Y(p.y), 5, [60, 150], { angle: p.x < COLS / 2 ? [-0.9, 0.9] : [Math.PI - 0.9, Math.PI + 0.9], gravity: 400, size: [2, 4] });
    }
  }

  function stepFallers(dt: number) {
    if (!fallers.length) return;
    const g = 2600 * (S / 40);
    const surface = potY();
    for (const f of fallers) {
      if (f.delay > 0) {
        f.delay -= dt;
        continue;
      }
      f.vy += g * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.x < bx + S * 0.5) {
        f.x = bx + S * 0.5;
        f.vx = Math.abs(f.vx) * 0.5;
      } else if (f.x > bx + COLS * S - S * 0.5) {
        f.x = bx + COLS * S - S * 0.5;
        f.vx = -Math.abs(f.vx) * 0.5;
      }
    }
    const landed = fallers.filter((f) => f.delay <= 0 && f.y > surface + S * 0.15);
    if (!landed.length) return;
    fallers = fallers.filter((f) => !(f.delay <= 0 && f.y > surface + S * 0.15));
    for (const f of landed) {
      ripples.push({ x: f.x, t: 0, a: f.quiet ? 0.4 : 1 });
      if (ripples.length > 14) ripples.shift();
      emitInk(f.kind < INK_COUNT ? f.kind : 0, f.x, surface, f.quiet ? 3 : 7, [120, 300], { angle: [-Math.PI * 0.85, -Math.PI * 0.15], gravity: 1100, size: [2.5, 6] });
      if (f.quiet) {
        if (Math.random() < 0.3) sound.plink(Math.floor(Math.random() * 6), 0.25);
        continue;
      }
      const i = groupArrivals.get(f.group) ?? 0;
      groupArrivals.set(f.group, i + 1);
      sound.plink(i, lv());
      const px = clamp(f.x, X(0) + S * 0.7, X(COLS) - S * 0.7);
      popup(`+${fmt(f.pts)}`, px, surface - S * 0.4 - (i % 3) * 13, i % 2 ? "pink" : "blue", 12 + Math.min(9, i * 0.8), 0.7, f.group);
      if (tally && tally.group === f.group) {
        tally.n++;
        tally.pts += f.pts;
        tally.t = 0;
      }
    }
  }

  /** The angle the guide shows right now (player, keys, demo or nothing). */
  function aimAngle(): number | null {
    if (mode === "attract") return demo.aiming ? demo.aim : null;
    if (qaPilot && qaPilot.aiming) return qaPilot.aim;
    if (aim && !aim.swap && !aim.cancel) return aim.angle;
    if (keyAim !== null && playing()) return keyAim;
    return null;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------------------------
  const feedOffset = () => {
    if (feedAnim.t >= feedAnim.dur) return 0;
    const k = feedAnim.t / feedAnim.dur;
    return -(1 - easeOutCubic(k)) * feedAnim.rows * ROW_H;
  };

  function clipSheet(on: boolean) {
    for (const p of PLATE) {
      const g = press.plate(p);
      if (on) {
        g.save();
        g.beginPath();
        g.rect(0, Y(0) - 0.5, W, H);
        g.clip();
      } else g.restore();
    }
  }

  function drawFurniture() {
    const x0 = X(0);
    const x1 = X(COLS);
    const blue = press.plate("blue");
    // Side rails the shots bounce off.
    blue.fillStyle = press.screen("blue", 0.45);
    blue.fillRect(x0 - 4, Y(0), 2.5, Y(LINE_Y) - Y(0) + S * 0.6);
    blue.fillRect(x1 + 1.5, Y(0), 2.5, Y(LINE_Y) - Y(0) + S * 0.6);
    // The jam line: dashed, solid pink near the end.
    const pink = press.plate("pink");
    const ly = Y(LINE_Y);
    const danger = run.danger || run.phase === "over";
    const pulse = danger ? light01.pulse(time, 1.3, { still: 0.7 }) : 0;
    pink.fillStyle = press.solid("pink");
    const dash = S * 0.22;
    const h = danger ? 2.4 + pulse * 1.8 : 1.4;
    for (let x = x0 + dash * 0.5; x < x1; x += dash * 2.2) pink.fillRect(x, ly - h / 2, Math.min(dash, x1 - x), h);
    // Drum.
    const shudder = mode === "play" && run.phase === "play" && !run.shot && run.meter > 0.8 ? clamp((run.meter - 0.8) / 0.2) : 0;
    drawDrum(press, x0 - 6, x1 + 6, Y(0), S * 0.44, drumTurn, shudder, time, reduced);
    if (mode === "attract") {
      const r = session.preview();
      registrationMark(press, r.left + 16, r.top + 18, 4.5);
      registrationMark(press, W - r.right - 16, r.top + 18, 4.5);
    }
  }

  function drawSheet() {
    const off = feedOffset();
    clipSheet(true);
    const b = run.board;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < b.cols(r); c++) {
        const k = b.get(r, c);
        if (k === EMPTY) continue;
        const j = idx(r, c) * 4;
        printDot(press, art, k, X(b.cx(r, c) + jig[j]!), Y(b.cy(r) + off + jig[j + 1]!));
      }
    // Dots about to pop swell a touch.
    for (const p of pending) printDot(press, art, p.kind, X(p.x), Y(p.y + off), 1.08 + Math.min(0.1, (0.4 - p.delay) * 0.25));
    clipSheet(false);
  }

  function drawSplats() {
    for (const s of splats) {
      const k = s.t / s.life;
      const grow = 0.55 + 0.45 * easeOutCubic(Math.min(1, s.t / 0.12));
      const level = 0.9 * (1 - k) ** 1.4;
      const plates = platesOf(s.kind);
      for (const p of plates) {
        const g = press.plate(PLATE[p]!);
        g.fillStyle = press.screen(PLATE[p]!, level);
        blotPath(g, s.x + (p - 1) * 1.2, s.y, s.r * grow, s.seed + p * 7, 8, 0.32);
        g.fill();
        // A few flung drops around the blot.
        for (let i = 0; i < 4; i++) {
          const a = ((s.seed + i * 977 + p * 131) % 628) / 100;
          const d = s.r * (1.1 + ((s.seed >> (i + 2)) % 7) * 0.08) * grow;
          g.beginPath();
          g.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, s.r * 0.12 * (1 - k * 0.5), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  function guideKindPlates(kind: number): PlateName[] {
    return kind === WILD || kind === BOMB ? ["blue"] : platesOf(kind).map((p) => PLATE[p]!);
  }

  /** The dotted guide: the path to the first bounce and on to the sheet, and a ghost ring where the dot will settle. */
  function drawGuide(angle: number, kind: number, strength = 1) {
    const tr = run.board.trace(angle);
    const pts = tr.points;
    const showAll = tr.bounces <= 1;
    const maxLen = showAll ? tr.length : (() => {
      let l = 0;
      for (let i = 1; i <= 2 && i < pts.length; i++) l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      return l;
    })();
    const plates = guideKindPlates(kind);
    const spacing = 0.42;
    const phase = reduced ? 0 : (time * 1.6) % spacing;
    let travelled = 0;
    let d = 0.75 + phase;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      while (d < travelled + len && d < maxLen - 0.3) {
        const t = (d - travelled) / len;
        const x = X(a.x + (b.x - a.x) * t);
        const y = Y(a.y + (b.y - a.y) * t);
        const fade = 1 - (d / Math.max(1, maxLen)) * 0.55;
        for (const pn of plates) {
          const g = press.plate(pn);
          g.fillStyle = press.solid(pn);
          g.beginPath();
          g.arc(x, y, S * 0.075 * fade * strength + 0.6, 0, Math.PI * 2);
          g.fill();
        }
        d += spacing;
      }
      travelled += len;
    }
    if (showAll) {
      // The ghost: a dashed ring in the dot's ink where it will settle.
      const cx = X(run.board.cx(tr.cell.r, tr.cell.c));
      const cy = Y(run.board.cy(tr.cell.r));
      for (const pn of plates) {
        const g = press.plate(pn);
        g.strokeStyle = press.solid(pn);
        g.lineWidth = 2;
        g.setLineDash([S * 0.16, S * 0.12]);
        g.lineDashOffset = reduced ? 0 : -time * 12;
        g.beginPath();
        g.arc(cx, cy, S * 0.42, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = press.screen(pn, 0.22);
        g.fill();
      }
    }
  }

  function drawShot() {
    const s = run.shot;
    if (!s) return;
    const tr = s.trace;
    const d = Math.min(tr.length, s.t * SPEED);
    let acc = 0;
    for (let i = 1; i < tr.points.length; i++) {
      const a = tr.points[i - 1]!;
      const b = tr.points[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= acc + len || i === tr.points.length - 1) {
        const t = len > 0 ? clamp((d - acc) / len) : 1;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        // A short trail of halftone behind it.
        const ux = (b.x - a.x) / (len || 1);
        const uy = (b.y - a.y) / (len || 1);
        for (const pn of guideKindPlates(s.kind)) {
          const g = press.plate(pn);
          g.fillStyle = press.screen(pn, 0.35);
          for (let k = 1; k <= 3; k++) {
            g.beginPath();
            g.arc(X(x - ux * k * 0.32), Y(y - uy * k * 0.32), S * (0.36 - k * 0.07), 0, Math.PI * 2);
            g.fill();
          }
        }
        printDot(press, art, s.kind, X(x), Y(y), 1);
        return;
      }
      acc += len;
    }
  }

  function drawFallers() {
    for (const f of fallers) printDot(press, art, f.kind, f.x, f.y, 1, f.rot);
  }

  function drawLauncher() {
    const lx = launchX();
    const ly = launchY();
    drawSquid(press, lx, ly, S, squid, reduced);
    // Loaded dot (sliding in from the next slot after a swap or a shot).
    const n = nextPos();
    // A swap trades places; a reload slides the next ink up into the arms and grows a new one in the well.
    const swapping = swapAnim < 1;
    const k = swapping ? easeOutBack(swapAnim, 1.4) : easeOutBack(Math.min(1, loadAnim * 1.4), 1.5);
    if (run.phase === "play" || mode === "attract") {
      const bob = reduced ? 0 : Math.sin(time * 2.4) * S * 0.02;
      printDot(press, art, run.current, n.x + (lx - n.x) * k, n.y + (ly + bob - n.y) * k, 0.72 + 0.28 * k);
      // Next ink, in its well.
      const blue = press.plate("blue");
      blue.strokeStyle = press.screen("blue", 0.6);
      blue.lineWidth = 1.5;
      blue.beginPath();
      blue.arc(n.x, n.y, S * 0.44 + earnPulse * S * 0.18, 0, Math.PI * 2);
      blue.stroke();
      const grow = swapping ? 1 : easeOutBack(clamp((loadAnim - 0.25) / 0.75), 2);
      const nx = swapping ? lx + (n.x - lx) * k : n.x;
      const ny = swapping ? ly + (n.y - ly) * k : n.y;
      if (grow > 0.02) printDot(press, art, run.next, nx, ny, (0.72 + earnPulse * 0.15) * grow);
    }
    // Flyers: earned specials on their way into the next slot.
    for (const f of flyers) {
      const t = easeOutCubic(Math.min(1, f.t / 0.6));
      const x = f.x + (n.x - f.x) * t;
      const y = f.y + (n.y - f.y) * t - Math.sin(t * Math.PI) * S * 1.5;
      printDot(press, art, f.kind, x, y, 0.9 + Math.sin(t * Math.PI) * 0.3, t * 6);
    }
  }

  function drawMeter() {
    const y = Y(LAUNCH_Y + SLOT_DY);
    const x0 = X(LAUNCH_X + METER_X0);
    const x1 = X(LAUNCH_X + METER_X1);
    const blue = press.plate("blue");
    blue.fillStyle = press.solid("blue");
    blue.fillRect(x0, y + 4, x1 - x0, 1.5);
    for (let i = 0; i <= 4; i++) blue.fillRect(x0 + ((x1 - x0) * i) / 4 - 0.75, y + 1, 1.5, 7);
    const pink = press.plate("pink");
    const m = clamp(run.meter);
    const hot = run.hurrying || m > 0.8;
    pink.fillStyle = press.screen("pink", hot ? 0.55 + 0.45 * light01.pulse(time, 1.6, { still: 1 }) : 0.6);
    pink.fillRect(x0, y - 4, (x1 - x0) * m, 8);
    const word = run.hurrying ? "shoot!" : "press";
    blue.fillStyle = press.solid(run.hurrying ? "blue" : "blue");
    spaced(blue, word, x0, y - 9, medium(10), 2.6, 0);
  }

  function drawHud() {
    if (mode !== "play") return;
    const top = session.play().top;
    const yb = Math.max(top + 30, Y(0) - S * 0.44 - 12);
    const x0 = X(0) + 2;
    const sc = fmt(shownScore);
    const font = light(30);
    const blue = press.plate("blue");
    blue.fillStyle = press.solid("blue");
    spaced(blue, sc, x0, yb, font, 1.5, 0);
    const pink = press.plate("pink");
    pink.fillStyle = press.solid("pink");
    spaced(pink, sc, x0 + 1.4, yb + 0.9, font, 1.5, 0);
    // Best on the right; the combo multiplier under the score while it lasts.
    if (session.best !== null) {
      blue.fillStyle = press.solid("blue");
      spaced(blue, `best ${fmt(Math.max(session.best, bestCheered ? run.score : 0))}`, X(COLS) - 2, yb, medium(11), 2.4, 1);
    }
    if (run.combo >= 2 && run.phase === "play") {
      const k = Math.min(1, comboShow.t / 0.18);
      const s = comboShow.n === run.combo ? 1 + (1 - easeOutCubic(k)) * 0.5 : 1;
      const w = spacedWidth(pink, sc, font, 1.5);
      pink.fillStyle = press.solid("pink");
      spaced(pink, `×${run.combo}`, x0 + w + 10, yb, medium(14 * s), 1, 0);
    }
  }

  function drawPopups() {
    for (const p of popups) {
      const k = p.t / p.life;
      const pop = k < 0.14 ? 0.6 + (k / 0.14) * 0.55 : 1.15 - Math.min(0.15, (k - 0.14) * 0.5);
      const g = press.plate(p.plate);
      g.fillStyle = k > 0.65 ? press.screen(p.plate, 1 - (k - 0.65) / 0.35) : press.solid(p.plate);
      spaced(g, p.text, p.x, p.y - easeOutCubic(k) * 26, medium(p.size * pop), 1, 0.5);
    }
    // The drop tally: counts up as the dots land, swelling with each.
    if (tally && tally.n >= 2 && tally.t < 1.1) {
      const k = Math.min(1, tally.t / 0.16);
      const s = 1 + (1 - easeOutCubic(k)) * 0.25;
      const y = Y(LINE_Y + 0.92);
      const ink: PlateName = tally.t > 0.8 ? "blue" : "pink";
      const g = press.plate(ink);
      g.fillStyle = tally.t > 0.8 ? press.screen(ink, 1 - (tally.t - 0.8) / 0.3) : press.solid(ink);
      spaced(g, `${tally.n} dropped · +${fmt(tally.pts)}`, W / 2, y, medium(15 * s), 1.6, 0.5);
    }
  }

  function drawBanners() {
    for (const b of banners) {
      const k = b.t / b.life;
      // Stamped in big, then it lifts and shrinks away; the last moment prints through a fading screen.
      const out = k > 0.78 ? easeOutCubic((k - 0.78) / 0.22) : 0;
      const stamp = (k < 0.1 ? 1.45 - easeOutCubic(k / 0.1) * 0.45 : 1) * (1 - out * 0.25);
      const level = k > 0.9 ? 1 - (k - 0.9) / 0.1 : 1;
      const cx = W / 2;
      const cy = Y(LINE_Y * 0.62) - out * 18;
      const size = b.size * stamp * Math.min(1, W / 390);
      const track = size * 0.12;
      const blue = press.plate("blue");
      blue.fillStyle = level < 1 ? press.screen("blue", level) : press.solid("blue");
      spaced(blue, b.text, cx, cy, light(size), track);
      const pink = press.plate("pink");
      pink.fillStyle = level < 1 ? press.screen("pink", level) : press.solid("pink");
      spaced(pink, b.text, cx + 2.2, cy + 1.4, light(size), track);
      if (b.sub) {
        blue.fillStyle = level < 1 ? press.screen("blue", level) : press.solid("blue");
        spaced(blue, b.sub, cx, cy + size * 0.55 + 8, medium(13), 3);
      }
    }
  }

  /** A capsule of solid ink with the word knocked out to paper (bitbybit's prompt). */
  function capsule(ink: PlateName, word: string, x: number, y: number, u: number) {
    const c = press.plate(ink);
    const breathe = light01.pulse(time, 0.5, { still: 0.5 });
    const font = medium(12.5 * u);
    const track = 4.2 * u;
    const tw = spacedWidth(c, word, font, track);
    const w = tw + 34 * u + breathe * 6 * u;
    const h = 30 * u;
    for (const p of PLATE) {
      const pc = press.plate(p);
      pc.globalCompositeOperation = "destination-out";
      pc.fillStyle = "#000";
      pc.beginPath();
      pc.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
      pc.fill();
      pc.globalCompositeOperation = "source-over";
    }
    c.fillStyle = press.solid(ink);
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    spaced(c, word, x + track / 2, y + 4.5 * u, font, track);
    c.globalCompositeOperation = "source-over";
  }

  /** A word printed twice, the pink plate a hair off. */
  function doublePrint(text: string, x: number, y: number, font: string, track: number, off: number) {
    const b = press.plate("blue");
    b.fillStyle = press.solid("blue");
    spaced(b, text, x, y, font, track);
    const p = press.plate("pink");
    p.fillStyle = press.solid("pink");
    spaced(p, text, x + off, y + off * 0.6, font, track);
  }

  function drawAttract() {
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const u = clamp(Math.min(W / 390, H / 760), 0.85, 1.4);
    const k = clamp(time / 1.0);
    const titleY = Math.max(Y(LINE_Y * 0.62), H - r.bottom - 128 * u);
    const avail = W - r.left - r.right - 24;
    const size = Math.min(58 * u, avail / 5.4);
    doublePrint("spotfall", cx, titleY + (1 - easeOutCubic(k)) * 8, light(size), size * 0.16, 2.4);
    const blue = press.plate("blue");
    blue.fillStyle = press.solid("blue");
    if (session.best !== null && session.best > 0) spaced(blue, `best ${fmt(session.best)}`, cx, titleY + 24 * u, medium(11 * u), 4.5 * u);
    capsule("pink", "tap", cx, titleY + 66 * u, u);
  }

  function drawPlayHints() {
    if (!playing()) return;
    // The thumbprint shows the way until the first pop.
    if (!hintSeen && hintPlan && run.loaded && !aim && !qaPilot) {
      const k = clamp(hintT / 1.5);
      const e = easeOutCubic(k);
      // The thumb slides out from the squid along the planned line, the guide swinging round with it.
      const tr = run.board.trace(hintPlan.angle);
      const first = tr.points[1]!;
      const reach = Math.min(Math.hypot(first.x - LAUNCH_X, first.y - LAUNCH_Y) * 0.8, 6.5);
      const tx = launchX() + Math.cos(hintPlan.angle) * reach * S;
      const ty = launchY() - Math.sin(hintPlan.angle) * reach * S;
      const sx = launchX() + S * 0.6;
      const sy = launchY() - S * 0.9;
      const fx = sx + (tx - sx) * e;
      const fy = sy + (ty - sy) * e;
      if (k > 0.05) drawGuide(k >= 1 ? hintPlan.angle : angleTo(fx, fy), run.current, 0.8);
      drawThumb(press, fx, fy, S * 0.42, k < 0.1 ? 1 - k / 0.1 : 0);
      const blue = press.plate("blue");
      blue.fillStyle = press.solid("blue");
      // Just under the jam line: the one band no dot ever settles in.
      spaced(blue, "drag to aim · let go to shoot", W / 2, Y(LINE_Y + 0.72), light(16), 1.6);
    }
    if (!swapSeen && session.runs <= 2 && run.stats.shots >= 3 && run.stats.shots <= 10 && run.loaded && !aim) {
      const n = nextPos();
      const blue = press.plate("blue");
      blue.fillStyle = press.solid("blue");
      spaced(blue, "tap to swap", n.x, n.y - S * 0.62, medium(10.5), 2.2);
    }
    if (aim && aim.cancel) {
      const pink = press.plate("pink");
      pink.fillStyle = press.solid("pink");
      spaced(pink, "let go to cancel", W / 2, Y(LINE_Y) + S * 0.55, medium(12), 2.4);
    }
  }

  /**
   * What the run did, against the best, and one tip. In the feed the shell's result card covers the middle and the
   * caption the bottom, so this is a strip just above the caption; a bare tab gets the score and a prompt too.
   */
  function drawSummary() {
    const sm = summary;
    if (!sm || session.phaseTime < 0.4) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 18 : pv.left + 14;
    const right = W - (solo ? 18 : pv.right + 8);
    const w = right - left;
    const h = 96;
    const top = solo ? Math.round(H * 0.5) : H - pv.bottom - h - 8;
    const k = easeOutCubic(clamp((session.phaseTime - 0.4) / 0.5));
    const lift = (1 - k) * 14;
    const blue = press.plate("blue");
    const pink = press.plate("pink");
    // Bare paper under the strip, a pink rule along its top and a blue one along its foot.
    for (const p of PLATE) {
      const pc = press.plate(p);
      pc.globalCompositeOperation = "destination-out";
      pc.fillStyle = "#000";
      pc.fillRect(left - 6, top + lift - 6, w + 12, h + 12);
      pc.globalCompositeOperation = "source-over";
    }
    pink.fillStyle = press.solid("pink");
    pink.fillRect(left, top + lift, w * k, 2);
    blue.fillStyle = press.solid("blue");
    blue.fillRect(left + w * (1 - k), top + lift + h, w * k, 1);
    const s = run.stats;
    blue.fillStyle = press.solid("blue");
    spaced(blue, `biggest drop ${s.biggestDrop}`, left + 12, top + lift + 24, medium(12), 1.8, 0);
    spaced(blue, `best combo ×${Math.max(1, s.bestCombo)}`, right - 12, top + lift + 24, medium(12), 1.8, 1);
    // Against the best.
    const barY = top + lift + 38;
    const bw = w - 24;
    blue.fillStyle = press.screen("blue", 0.3);
    blue.fillRect(left + 12, barY, bw, 10);
    const frac = sm.isBest || !sm.prevBest ? 1 : clamp(sm.score / sm.prevBest);
    const grow = clamp((session.phaseTime - 0.5) / 0.8);
    pink.fillStyle = press.solid("pink");
    pink.fillRect(left + 12, barY, Math.max(4, bw * frac * grow), 10);
    const label = sm.isBest ? (sm.prevBest ? `new best · +${fmt(sm.score - sm.prevBest)}` : "first print on the wall") : `${Math.round(frac * 100)}% of your best`;
    blue.fillStyle = press.solid("blue");
    spaced(blue, label, left + 12, barY + 27, light(14), 1.2, 0);
    // One tip, shrunk to fit.
    let size = 13;
    while (size > 9.5 && spacedWidth(blue, sm.tip, light(size), 0.6) > bw) size -= 0.5;
    spaced(blue, sm.tip, left + 12, top + lift + h - 12, light(size), 0.6, 0);
    if (solo && session.phaseTime > 0.8) {
      doublePrint(fmt(sm.score), W / 2, top - 90, light(64), 3, 2.6);
      if (session.best !== null) {
        blue.fillStyle = press.solid("blue");
        spaced(blue, `best ${fmt(session.best)}`, W / 2, top - 62, medium(11), 4.5);
      }
      capsule("pink", "tap", W / 2, top + h + 46, 1);
    }
  }

  function render() {
    const o = shake.offset;
    ox = o.x;
    oy = o.y;
    press.begin();
    drawFurniture();
    drawSheet();
    drawSplats();
    const a = aimAngle();
    if (a !== null && (run.loaded || mode === "attract") && run.phase === "play") drawGuide(a, run.current);
    drawShot();
    drawFallers();
    drawLauncher();
    drawPot(press, W, H, potY(), time, ripples, reduced);
    if (mode === "play" && run.phase === "play") drawMeter();
    for (let p = 0; p < 3; p++) sprays[p]!.draw(press.plate(PLATE[p]!));
    ox = 0;
    oy = 0;
    drawHud();
    drawPopups();
    drawBanners();
    if (mode === "attract") drawAttract();
    else {
      drawPlayHints();
      if (session.phase === "over") drawSummary();
    }
    press.print(ctx);
    if (veil > 0) drawVeil(Math.min(1, veil));
  }

  /** A halftone dissolve to paper. */
  const veilPatterns = new Map<number, CanvasPattern>();
  let veilDpr = 0;
  function drawVeil(k: number) {
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
      g.arc(c.width / 2, c.width / 2, Math.sqrt(((q / 12) * 4 * s * s) / Math.PI) * 1.02, 0, Math.PI * 2);
      g.fill();
      pat = ctx.createPattern(c, "repeat")!;
      pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
      veilPatterns.set(q, pat);
    }
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }

  update(0);
  render();
  let readySent = false;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();

