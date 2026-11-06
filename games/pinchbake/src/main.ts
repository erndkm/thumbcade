import { createMusic } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeInCubic, easeOutBack, lerp } from "@thumbcade-games/kit/ease";
import { onDrag, onKeys } from "@thumbcade-games/kit/input";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { clayText, drawEyes, drawFinger, drawFlame, font, hash, makeHand, makeIcons, makePieces, makePuff, makeShadow, makeStage, makeStarter, PAL, plaque, type Look, type PieceArt, type Sprite } from "./art.ts";
import { loadFredoka } from "./fonts.ts";
import { rimY, STRIP_H, sx, sy, tinLayout, ux, type Layout } from "./layout.ts";
import { DEMO, landing, Pilot, SKILLS } from "./pilot.ts";
import { FLOOR0, GRACE, HOLD_Y, RIM, Run, runSeed, TIN_W, type RunEvent } from "./run.ts";
import { createSounds } from "./sound.ts";
import { radius, TIERS, TOP } from "./tiers.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

const CHAIN_WORDS = ["", "", "double squish!", "triple squish!", "oh my!", "so squishy!", "unreal!", "legend!"];
/** In attract mode the starter has risen a little, so its face shows and the pile sits clear of the caption. */
const ATTRACT_FLOOR = 3.2;
/** Stop-motion squish-in, one pose per 1/12 s (softbake's 12 fps). */
const SQUISH = [0.35, 1.18, 0.92, 1.04, 1];

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  t: number;
  life: number;
}
interface Flyer {
  pts: number;
  x: number;
  y: number;
  t: number;
  size: number;
}
interface Ghost {
  tier: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  t: number;
}
interface Card {
  tier: number;
  top: string;
  title: string;
  t: number;
  life: number;
}
interface Sticker {
  text: string;
  x: number;
  y: number;
  t: number;
  size: number;
  fill: string;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "pinchbake" }), loadFredoka()]);
  const reduced = session.reducedMotion;
  /** First-run hints seen: 1 = the drag hint (gone after the first merge), 2 = the starter's word too. */
  let taught = 0;
  try {
    const v = await tc.storage.get<number>("hint");
    if (typeof v === "number") taught = v;
  } catch {
    /* guests and offline: show the hints */
  }

  const view = createCanvas({ maxDpr: 2.5, background: PAL.wall });
  const g = view.ctx;
  let L: Layout = tinLayout(view.width, view.height, session.play().top);
  let D = view.dpr;
  let stage: HTMLCanvasElement | null = null;
  let starter: Sprite[] = [];
  let art: PieceArt[] = [];
  let icons: PieceArt[] = [];
  let cardIcons: PieceArt[] = [];
  let hand: Sprite | null = null;
  let shadow: Sprite | null = null;
  let puffSpr: Sprite | null = null;

  let rimHot: CanvasGradient | null = null;
  let rimWarm: CanvasGradient | null = null;
  function layout() {
    D = view.dpr;
    L = tinLayout(view.width, view.height, session.play().top);
    const band = (rgb: string) => {
      const y = rimY(L);
      const gg = g.createLinearGradient(0, y - L.s * 0.6, 0, y + L.s * 0.6);
      gg.addColorStop(0, `rgba(${rgb},0)`);
      gg.addColorStop(0.5, `rgba(${rgb},0.35)`);
      gg.addColorStop(1, `rgba(${rgb},0)`);
      return gg;
    };
    rimHot = band("240,119,92");
    rimWarm = band("246,217,139");
    const k = Math.min(3, D);
    stage = makeStage(L, D);
    starter = [makeStarter(L, k, 0), makeStarter(L, k, 1)];
    art = makePieces(L.s, k);
    // The strip and the "next" dish use small copies, drawn crisp at their own size.
    icons = makeIcons(8.5, 0.55, k);
    cardIcons = makeIcons(20, 0.6, k);
    hand = makeHand(L.s, L.ty - (HOLD_Y + 1.6) * L.s + L.s * 2, k);
    shadow = makeShadow(k);
    puffSpr = makePuff(k);
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

  const snd = createSounds();
  const audio = snd.audio;
  const music = createMusic(audio, { bpm: 92, wave: "triangle", volume: 0.03, steps: [48, null, 55, null, 52, null, 55, 57, 45, null, 52, null, 48, null, 50, 52] });
  const shake = new Shake(9, 0.018, 1.7, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2, decay: 0.45 });
  const crumbs = new Particles(420);
  const hudCrumbs = new Particles(220);
  const puffs: Puff[] = [];
  const look: Look = { x: 0, y: 0, blink: 0, mood: "plain" };

  // ---------------------------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let seed = session.ctx.seed >>> 0;
  let run = new Run(seed, { attract: true, floor: ATTRACT_FLOOR });
  let pilot = new Pilot(DEMO, createRng(seed ^ 0x51));
  let time = 0;
  let titleAge = 0;
  let stepN = 0;
  let stepAcc = 0;
  /** The pinch: where it is (tin units), how open the fingers are, and the held piece's pop-in. */
  let pinchX = TIN_W / 2;
  let pinchOpen = 0;
  let heldAge = 1;
  let heldTier = run.held;
  let holding = false;
  /** 0-1: how hard the thumb is pinching right now (a quick spring, so a press shows on the next frame). */
  let grip = 0;
  let downPlaying = false;
  let queued = -1;
  /** The demo's aim and whether it has picked a target for the piece in hand. */
  let demoAimed = false;
  let emptying = 0;
  let qaPilot: Pilot | null = null;
  let qaAimed = false;
  /** The starter's jiggle (a spring) and its expression timers. */
  let doughWob = 0;
  let doughWobV = 0;
  let oof = 0;
  let starterSays = 0;
  let ghostT = 0;
  let ghostAlpha = 0;
  let camZ = 1;
  let camZv = 0;
  let camFx = 0;
  let camFy = 0;
  let banked = 0;
  let shown = 0;
  let scorePop = 0;
  let scorePopV = 0;
  let bestCheered = false;
  let overT = -1;
  let endSent = false;
  let lastPlap = 0;
  let dangerGlow = 0;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string; highest: number; chain: number } | null = null;
  let flyers: Flyer[] = [];
  let ghosts: Ghost[] = [];
  let cards: Card[] = [];
  let stickers: Sticker[] = [];
  let leaving: Array<{ tier: number; x: number; y: number; t: number }> = [];
  /** Tiers seen this run (dropped or made), and when each first showed up (for the strip's pop). */
  let seen: number[] = TIERS.map(() => -1);

  const playing = () => mode === "play" && session.phase === "playing";
  const loud = () => mode === "play";

  // ---------------------------------------------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------------------------------------------
  function bindRun() {
    run.afterStep = afterStep;
    heldTier = run.held;
    heldAge = 1;
  }

  function resetFx() {
    crumbs.clear();
    hudCrumbs.clear();
    puffs.length = 0;
    flyers = [];
    ghosts = [];
    cards = [];
    stickers = [];
    holding = false;
    queued = -1;
    doughWob = doughWobV = 0;
    oof = 0;
    camZ = 1;
    camZv = 0;
  }

  function newAttract() {
    mode = "attract";
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    run = new Run(seed, { attract: true, floor: ATTRACT_FLOOR });
    pilot = new Pilot(DEMO, createRng(seed ^ 0x51));
    demoAimed = false;
    emptying = 0;
    bindRun();
  }

  /** The demo pile pops away from the top while the new run's first piece pinches in. */
  function flush() {
    leaving = [];
    const w = run.world;
    let top = 0;
    for (let i = 0; i < w.n; i++) top = Math.max(top, w.y[i]!);
    for (let i = 0; i < w.n; i++) leaving.push({ tier: w.tier[i]!, x: w.x[i]!, y: w.y[i]!, t: -(top - w.y[i]!) * 0.025 - hash(i, 3) * 0.05 });
  }

  function startRun() {
    flush();
    mode = "play";
    run = new Run(runSeed(session.ctx.seed, session.runs));
    bindRun();
    resetFx();
    pinchX = run.aimX;
    banked = shown = 0;
    bestCheered = false;
    overT = -1;
    endSent = false;
    summary = null;
    dangerGlow = 0;
    seen = TIERS.map(() => -1);
    ghostT = -0.6;
    ghostAlpha = 0;
    starterSays = 0;
    qaPilot = null;
    music.start();
    snd.tok();
  }

  session.startOnTap(window);
  session.on("start", startRun);
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (playing()) music.start();
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Input: press anywhere to take the pinch, drag sideways to aim (it follows your finger's x), let go to drop.
  // A tap drops right where you tapped. A run starts on a tap's release, which never drops a piece.
  // ---------------------------------------------------------------------------------------------------------------
  function aimAt(px: number) {
    run.aim(ux(L, px));
  }

  function tryDrop() {
    if (!playing() || run.phase !== "play") return;
    if (run.canDrop) {
      run.drop();
      queued = -1;
    } else queued = time;
  }

  onDrag(window, {
    start(x, y) {
      downPlaying = playing();
      if (!downPlaying) return;
      holding = true;
      aimAt(x);
      void y;
    },
    move(x) {
      if (!holding) return;
      aimAt(x);
    },
    end(x, _y, cancelled) {
      const was = holding;
      holding = false;
      if (!was || cancelled || !downPlaying) return;
      aimAt(x);
      tryDrop();
    },
  });
  session.on("cancel", () => {
    holding = false;
  });
  onKeys({
    left: () => playing() && run.aim(run.aimX - 0.6),
    right: () => playing() && run.aim(run.aimX + 0.6),
    action: () => tryDrop(),
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Physics -> squash, wobble and plaps
  // ---------------------------------------------------------------------------------------------------------------
  function afterStep() {
    const w = run.world;
    let loudest = 0;
    let loudTier = 0;
    for (let i = 0; i < w.n; i++) {
      const v = w.hit[i]!;
      if (v > 1) {
        // Squash along the hit; harder hits squash more. Sideways bumps also tip the piece.
        const amt = Math.min(0.22, v * 0.016) * (reduced ? 0.5 : 1);
        if (amt > w.u0[i]! * 0.6) w.u4[i] = Math.atan2(-w.hny[i]!, w.hnx[i]!);
        w.u1[i] = w.u1[i]! + amt * 22;
        w.u3[i] = w.u3[i]! + w.hnx[i]! * v * 0.12 * (reduced ? 0.4 : 1);
        if (v > loudest && w.age[i]! > 0.05) {
          loudest = v;
          loudTier = w.tier[i]!;
        }
      }
    }
    if (loudest > 1.4 && time - lastPlap > 0.06) {
      lastPlap = time;
      snd.land(loudest * (loud() ? 1 : 0.35), loudTier);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Events -> juice
  // ---------------------------------------------------------------------------------------------------------------
  function puff(x: number, y: number, n: number, size: number, speed = 60) {
    for (let k = 0; k < n && puffs.length < 70; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      puffs.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 20, r: size * (0.5 + Math.random() * 0.6), grow: size * 1.2, t: 0, life: 0.5 + Math.random() * 0.45 });
    }
  }

  function addFlyer(pts: number, x: number, y: number, chain: number) {
    if (pts <= 0) return;
    for (let k = 0; k < 4 && flyers.some((f) => f.t < 0.45 && Math.abs(f.x - x) < 60 && Math.abs(f.y - y) < 24); k++) y -= 26;
    flyers.push({ pts, x, y, t: 0, size: Math.min(30, 15 + chain * 2 + Math.log10(pts) * 2.5) });
  }

  function seeTier(t: number) {
    if (seen[t]! < 0) seen[t] = time;
  }

  function handle(e: RunEvent) {
    switch (e.type) {
      case "drop": {
        pinchOpen = 1;
        heldAge = 0;
        snd.drop(e.tier);
        if (loud()) seeTier(e.tier);
        break;
      }
      case "merge": {
        const X = sx(L, e.x);
        const Y = sy(L, e.y);
        const t = TIERS[e.tier]!;
        const parent = TIERS[e.tier - 1]!;
        ghosts.push({ tier: e.tier - 1, x: sx(L, e.ax), y: sy(L, e.ay), tx: X, ty: Y, t: 0 }, { tier: e.tier - 1, x: sx(L, e.bx), y: sy(L, e.by), tx: X, ty: Y, t: 0 });
        snd.merge(e.tier, e.chain);
        snd.knock(e.knock);
        // The starter takes the knock: it slumps and jiggles.
        doughWobV += e.knock * 30 * (reduced ? 0.4 : 1);
        if (e.knock > 0.2) oof = 0.6;
        const big = e.tier >= 5;
        const rPx = t.r * L.s;
        crumbs.emit(X, Y, { count: reduced ? 3 : 6 + e.tier * 2, speed: [60, 160 + e.tier * 30], life: [0.35, 0.8], size: [2.5, 3 + rPx * 0.1], colors: [parent.body, parent.deep, t.hi], shape: "circle", gravity: 520, drag: 1.6, spread: rPx * 0.4 });
        puff(X, Y, reduced ? 2 : 2 + Math.round(e.tier * 0.8), rPx * 0.45 + 6, 40 + e.tier * 12);
        if (loud()) {
          addFlyer(e.pts, X, Y - rPx * 0.4, e.chain);
          seeTier(e.tier);
          if (taught < 1) {
            taught = 1;
            tc.storage.set("hint", taught).catch(() => undefined);
          }
          if (e.chain >= 2) {
            const word = CHAIN_WORDS[Math.min(e.chain, CHAIN_WORDS.length - 1)]!;
            stickers.push({ text: e.chain >= 4 ? `×${e.chain} ${word}` : word, x: X, y: Y - rPx - 14, t: 0, size: Math.min(30, 18 + e.chain * 2), fill: e.chain % 2 ? PAL.cream : PAL.butter });
            session.feedback(e.chain >= 3 ? "success" : "tap");
            shake.add(0.05 + Math.min(0.2, e.chain * 0.04));
          }
          if (e.first && e.tier >= 3) {
            cards.push({ tier: e.tier, top: e.tier === TOP ? "the big one!" : "new bake!", title: t.title, t: 0, life: e.tier === TOP ? 2.2 : 1.5 });
            snd.newBake(e.tier);
            if (e.tier !== TOP) session.feedback("success");
          } else if (big) session.feedback("tap");
        }
        if (big) {
          shake.add(0.1 + (e.tier - 5) * 0.08);
          hitStop.freeze(reduced ? 0.02 : 0.03 + (e.tier - 5) * 0.025);
          if (!reduced) {
            camZv += 0.3 + (e.tier - 5) * 0.12;
            camFx = X;
            camFy = Y;
          }
        }
        if (e.tier === TOP) {
          // The jackpot: two pies become the party cake.
          snd.cake();
          flash.trigger(PAL.flour, 0.9);
          shake.add(0.35);
          hitStop.freeze(reduced ? 0.04 : 0.14);
          if (loud()) session.feedback("impact");
          if (!reduced) {
            hudCrumbs.emit(X, Y, { count: 40, speed: [220, 560], life: [0.8, 1.5], size: [5, 9], colors: [PAL.butter, PAL.salmon, PAL.powder, PAL.lavender, PAL.sage, PAL.cream], shape: "square", gravity: 600, drag: 1.2, spin: [-8, 8] });
          }
          puff(X, Y, 10, rPx * 0.6, 160);
        }
        break;
      }
      case "showstopper": {
        const X = sx(L, e.x);
        const Y = sy(L, e.y);
        snd.showstopper();
        flash.trigger(PAL.flour, 1);
        shake.add(0.5);
        hitStop.freeze(reduced ? 0.05 : 0.2);
        doughWobV += 8;
        oof = 1;
        if (loud()) {
          session.feedback("impact");
          addFlyer(e.pts, X, Y, e.chain);
          cards.push({ tier: TOP, top: "showstopper!", title: "two party cakes", t: 0, life: 2.4 });
        }
        ghosts.push({ tier: TOP, x: X - L.s * 2.4, y: Y, tx: X, ty: Y - L.s * 6, t: 0 }, { tier: TOP, x: X + L.s * 2.4, y: Y, tx: X, ty: Y - L.s * 6, t: 0 });
        puff(X, Y, 16, L.s * 1.8, 220);
        if (!reduced) {
          for (const side of [-1, 1]) hudCrumbs.emit(L.W / 2 + side * L.W * 0.42, L.H * 0.6, { count: 34, speed: [320, 680], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.6], size: [5, 9], colors: [PAL.butter, PAL.salmon, PAL.powder, PAL.lavender, PAL.sage], shape: "square", gravity: 700, drag: 1.2, spin: [-8, 8] });
        }
        break;
      }
      case "danger":
        if (e.on) {
          snd.danger();
          if (loud()) session.feedback("tap");
        }
        break;
      case "grace":
        if (e.left < GRACE) snd.tick(e.left);
        break;
      case "over": {
        overT = 0;
        holding = false;
        cards.length = 0;
        cards.push({ tier: -2, top: e.reason === "dough" ? "the starter rose over!" : "the tin spilled over!", title: "oops", t: 0, life: 1.2 });
        snd.spill();
        shake.add(0.3);
        puff(L.W / 2, rimY(L), 12, L.s * 0.9, 120);
        music.stop();
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The attract demo: the pilot aims the pinch and lets go, merges happen, and the tin empties itself when full.
  // ---------------------------------------------------------------------------------------------------------------
  function stepDemo(dt: number, mayEmpty = true) {
    if (emptying > 0) {
      emptying -= dt;
      const w = run.world;
      if (w.n && emptying < 0.9) {
        let top = 0;
        for (let i = 1; i < w.n; i++) if (w.y[i]! > w.y[top]!) top = i;
        const X = sx(L, w.x[top]!);
        const Y = sy(L, w.y[top]!);
        puff(X, Y, 2, w.r[top]! * L.s * 0.5, 50);
        snd.pop(6 - w.tier[top]!);
        w.remove(top);
        emptying = 0.95;
      } else if (!w.n) {
        emptying = 0;
        run.floorTarget = ATTRACT_FLOOR;
      }
      return;
    }
    if (!run.canDrop) return;
    if (!demoAimed) {
      pilot.decide(run);
      demoAimed = true;
    }
    pinchX = damp(pinchX, pilot.target, 7, dt);
    run.aim(pinchX);
    if (Math.abs(pinchX - pilot.target) < 0.1 && pilot.tick(run, dt)) {
      run.drop();
      demoAimed = false;
    }
    if (mayEmpty && run.fullness() > 0.6 && run.world.n > 10) emptying = 1;
  }

  /** Fills the demo tin before the first frame so the poster and the first look show a living, well-stocked pile. */
  function warmDemo(full: number, pieces: number, maxSeconds: number) {
    const dt = 1 / 60;
    for (let t = 0; t < maxSeconds && (run.fullness() < full || run.world.n < pieces || !run.canDrop); t += dt) {
      stepDemo(dt, false);
      run.update(dt);
      run.events.length = 0;
    }
    // Pose the pile at rest.
    const w = run.world;
    for (let i = 0; i < w.n; i++) w.u0[i] = w.u1[i] = w.u2[i] = w.u3[i] = 0;
    pinchX = run.aimX;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------------------------------------------
  function tipFor(): string {
    const s = run.stats;
    if (s.biggestChain < 2) return "drop twins side by side: chains knock the starter down hardest";
    if (s.highest < 5) return "keep big bakes together in one corner so they can meet";
    if (s.scares >= 2) return "when the rim glows, squish something at the top right away";
    if (!s.cakes) return "peek at the next piece and leave it a twin to land on";
    return "two party cakes make a showstopper. good luck!";
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    titleAge += rawDt;
    stepAcc += rawDt;
    while (stepAcc >= 1 / 12) {
      stepAcc -= 1 / 12;
      stepN++;
    }
    const dt = hitStop.scale(rawDt);
    shake.update(rawDt);
    flash.update(rawDt);
    crumbs.update(rawDt);
    hudCrumbs.update(rawDt);

    if (dt > 0) {
      if (mode === "attract") stepDemo(dt);
      else if (QA_AUTOPLAY && playing() && run.phase === "play") {
        qaPilot ??= new Pilot(QA_AUTOPLAY, createRng(7));
        if (run.canDrop && !qaAimed) {
          qaPilot.decide(run);
          qaAimed = true;
        }
        if (qaAimed) run.aim(damp(run.aimX, qaPilot.target, 12, dt));
        if (qaAimed && qaPilot.tick(run, dt)) {
          run.aim(qaPilot.target);
          run.drop();
          qaAimed = false;
        }
      }
      if (queued >= 0 && run.canDrop && playing()) {
        if (time - queued < 0.45) run.drop();
        queued = -1;
      }
      run.update(dt);
      for (const e of run.events) handle(e);
      run.events.length = 0;
      // Squash and tilt springs.
      const w = run.world;
      for (let i = 0; i < w.n; i++) {
        w.u1[i] = w.u1[i]! + (-320 * w.u0[i]! - 15 * w.u1[i]!) * dt;
        w.u0[i] = w.u0[i]! + w.u1[i]! * dt;
        const lean = clamp(-w.vx[i]! * 0.05, -0.3, 0.3) * (w.support[i] ? 1 : 0.3);
        w.u3[i] = w.u3[i]! + (-140 * (w.u2[i]! - lean) - 11 * w.u3[i]!) * dt;
        w.u2[i] = clamp(w.u2[i]! + w.u3[i]! * dt, -0.5, 0.5);
      }
    }

    // The pinch: in play it is wherever the finger put it; in attract the demo drives it.
    if (mode === "play") pinchX = run.aimX;
    if (run.held !== heldTier && run.canDrop) {
      heldTier = run.held;
      heldAge = 0;
    }
    heldAge += rawDt;
    grip = damp(grip, holding ? 1 : 0, 22, rawDt);
    pinchOpen = run.canDrop ? Math.max(0, pinchOpen - rawDt * 6) : Math.min(1, pinchOpen + rawDt * 10);
    for (const l of leaving) l.t += rawDt;
    if (leaving.length && leaving.every((l) => l.t > 0.3)) leaving = [];

    // Camera nudge, the starter's jiggle, the score counter.
    camZv += (-120 * (camZ - 1) - 14 * camZv) * rawDt;
    camZ += camZv * rawDt;
    doughWobV += (-90 * doughWob - 7 * doughWobV) * rawDt;
    doughWob += doughWobV * rawDt;
    oof = Math.max(0, oof - rawDt);
    scorePopV += (-300 * scorePop - 16 * scorePopV) * rawDt;
    scorePop += scorePopV * rawDt;
    for (const p of puffs) {
      p.t += rawDt;
      p.x += p.vx * rawDt;
      p.y += p.vy * rawDt;
      p.vx *= 1 - 2.5 * rawDt;
      p.vy = p.vy * (1 - 2.5 * rawDt) - 12 * rawDt;
    }
    for (let k = puffs.length - 1; k >= 0; k--) if (puffs[k]!.t >= puffs[k]!.life) puffs.splice(k, 1);
    for (const gh of ghosts) gh.t += rawDt;
    if (ghosts.length && ghosts.some((gh) => gh.t > 0.14)) ghosts = ghosts.filter((gh) => gh.t <= 0.14);
    for (const c of cards) c.t += rawDt;
    if (cards.length && cards[0]!.t > cards[0]!.life) cards.shift();
    for (const s of stickers) s.t += rawDt;
    if (stickers.some((s) => s.t > 0.9)) stickers = stickers.filter((s) => s.t <= 0.9);

    // Flyers hang a beat, then fly into the counter.
    for (const f of flyers) f.t += rawDt;
    if (flyers.some((f) => f.t >= 0.7)) {
      flyers = flyers.filter((f) => {
        if (f.t < 0.7) return true;
        banked += f.pts;
        scorePopV += Math.min(9, 3 + f.pts / 80);
        if (!bestCheered && session.best !== null && session.best > 0 && banked > session.best && mode === "play") {
          bestCheered = true;
          cards.push({ tier: -1, top: "new best!", title: "your best ever", t: 0, life: 1.8 });
          snd.best();
          flash.trigger(PAL.butter, 0.6);
          session.feedback("success");
          if (!reduced)
            for (const side of [-1, 1])
              hudCrumbs.emit(L.W / 2 + side * L.W * 0.42, L.H * 0.55, { count: 26, speed: [300, 620], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.5], size: [5, 9], colors: [PAL.butter, PAL.salmon, PAL.powder, PAL.lavender, PAL.sage], shape: "square", gravity: 700, drag: 1.2, spin: [-8, 8] });
        }
        return false;
      });
    }
    shown = shown < banked ? Math.min(banked, damp(shown, banked, 9, rawDt) + 1) : banked;

    // Danger: the rim glows as the pile nears it.
    const near = clamp((run.pileTop - (RIM - 2.6)) / 2.6);
    dangerGlow = damp(dangerGlow, run.dangerOn ? 1 : near * 0.6, 6, rawDt);

    if (mode === "play") {
      // The starter speaks up once, the first time it has risen enough to notice.
      if (taught < 2 && starterSays === 0 && run.world.floor > 1.9 && run.phase === "play") starterSays = 0.001;
      if (starterSays > 0) {
        starterSays += rawDt;
        if (starterSays > 4.2) {
          starterSays = -1;
          taught = 2;
          tc.storage.set("hint", taught).catch(() => undefined);
        }
      }
      ghostT += rawDt;
      ghostAlpha = taught < 1 && run.phase === "play" && !holding ? Math.min(0.9, ghostAlpha + rawDt * 2) : Math.max(0, ghostAlpha - rawDt * 4);
      if (overT >= 0 && !endSent) {
        overT += rawDt;
        if (overT > 0.5) {
          for (const f of flyers) banked += f.pts;
          flyers = [];
          endSent = true;
          const prevBest = session.best;
          const res = session.end(run.score, {
            stats: { highest: run.stats.highest, chain: run.stats.biggestChain, merges: run.stats.merges, drops: run.stats.drops, cakes: run.stats.cakes },
          });
          summary = { score: run.score, isBest: res.isBest, prevBest, tip: tipFor(), highest: run.stats.highest, chain: run.stats.biggestChain };
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------------------------
  /** Camera: zoom about the last big merge, plus shake. Everything in the tin goes through it. */
  let camOx = 0;
  let camOy = 0;
  function camera() {
    const o = shake.offset;
    const z = camZ;
    camOx = (1 - z) * camFx + o.x;
    camOy = (1 - z) * camFy + o.y;
    g.setTransform(D * z, 0, 0, D * z, D * camOx, D * camOy);
  }

  /** Sets the transform for a sprite at screen (x, y) with tilt, squash along an axis, and scale. */
  function put(x: number, y: number, tilt: number, sq: number, axis: number, k: number) {
    const z = camZ * D;
    const ca = Math.cos(axis);
    const sa = Math.sin(axis);
    const p = 1 - sq;
    const q = 1 + sq * 0.6;
    const s11 = p * ca * ca + q * sa * sa;
    const s12 = (p - q) * ca * sa;
    const s22 = p * sa * sa + q * ca * ca;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const m11 = ct * s11 - st * s12;
    const m12 = ct * s12 - st * s22;
    const m21 = st * s11 + ct * s12;
    const m22 = st * s12 + ct * s22;
    g.setTransform(m11 * k * z, m21 * k * z, m12 * k * z, m22 * k * z, (x * camZ + camOx) * D, (y * camZ + camOy) * D);
  }

  function blit(s: Sprite) {
    g.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  }

  function drawStarter() {
    const w = run.world;
    const surf = sy(L, w.floor) + doughWob * L.s * 0.25;
    const spr = starter[(stepN >> 1) % 2]!;
    const visible = L.ty - surf + spr.oy;
    if (visible <= 0) return;
    const k = spr.c.width / spr.w;
    // Crop the sprite at the tin's bottom: the top surface rides on the dough level.
    g.drawImage(spr.c, 0, 0, spr.c.width, Math.min(spr.c.height, visible * k), L.tx, surf - spr.oy, spr.w, Math.min(spr.h, visible));
    // The starter's face, once there is room for it.
    const band = w.floor - FLOOR0;
    if (band < 0.7) return;
    const fx = L.tx + TIN_W * L.s * 0.5;
    const fy = surf + Math.min(1.25, band * 0.55) * L.s + L.s * 0.15;
    const er = L.s * 0.13;
    // The starter is the rival: it smirks when it's winning, and says "oof" when it's knocked back.
    const smug = run.dangerOn || overT >= 0 || run.fullness() > 0.75;
    const squeezed = oof > 0;
    g.fillStyle = PAL.ink;
    g.strokeStyle = PAL.ink;
    g.lineWidth = Math.max(1.5, er * 0.5);
    for (const s of [-1, 1]) {
      const x = fx + s * L.s * 0.55;
      if (squeezed) {
        g.beginPath();
        g.moveTo(x - er * s, fy - er * 0.7);
        g.lineTo(x + er * 0.6 * s, fy);
        g.lineTo(x - er * s, fy + er * 0.7);
        g.stroke();
      } else {
        const bl = (time + 1.3) % 4.2 < 0.13 ? 0.15 : 1;
        g.beginPath();
        g.ellipse(x, fy, er, er * 1.2 * bl, 0, 0, Math.PI * 2);
        g.fill();
        if (bl > 0.5) {
          g.fillStyle = "rgba(255,255,255,0.9)";
          g.beginPath();
          g.arc(x - er * 0.3, fy - er * 0.4, er * 0.34, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = PAL.ink;
        }
      }
    }
    if (smug && !squeezed) {
      // Half-lidded, pleased with itself.
      g.fillStyle = PAL.starter;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(fx + s * L.s * 0.55, fy - er * 0.7, er * 1.4, er * 0.95, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = PAL.ink;
      g.lineWidth = Math.max(1.5, er * 0.45);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(fx + s * L.s * 0.55 - er * 1.1, fy + er * 0.05);
        g.lineTo(fx + s * L.s * 0.55 + er * 1.1, fy + er * 0.05);
        g.stroke();
      }
    }
    const my = fy + L.s * 0.32;
    g.beginPath();
    if (smug && !squeezed) {
      g.moveTo(fx - L.s * 0.26, my - 3);
      g.quadraticCurveTo(fx + L.s * 0.02, my + 8, fx + L.s * 0.3, my - 6);
    } else if (squeezed) g.ellipse(fx, my + 2, L.s * 0.12, L.s * 0.1, 0, 0, Math.PI * 2);
    else {
      g.moveTo(fx - L.s * 0.2, my - 2);
      g.quadraticCurveTo(fx, my + 6, fx + L.s * 0.2, my - 2);
    }
    if (squeezed) g.fill();
    else g.stroke();
    g.fillStyle = "rgba(240,140,152,0.35)";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(fx + s * L.s * 0.9, fy + L.s * 0.22, L.s * 0.2, L.s * 0.11, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawPieces() {
    const w = run.world;
    const a = run.alpha;
    const pX = sx(L, pinchX);
    const pY = sy(L, HOLD_Y);
    const over = mode === "play" && overT >= 0;
    if (shadow) {
      for (let i = 0; i < w.n; i++) {
        const r = w.r[i]! * L.s;
        put(sx(L, lerp(w.ox[i]!, w.x[i]!, a)) + r * 0.14, sy(L, lerp(w.oy[i]!, w.y[i]!, a)) + r * 0.2, 0, 0, 0, r / 32);
        blit(shadow);
      }
    }
    for (const gh of ghosts) {
      const u = clamp(gh.t / 0.12);
      const e = u * u;
      const spr = art[gh.tier]!.body;
      put(lerp(gh.x, gh.tx, e), lerp(gh.y, gh.ty, e), 0, 0.25 * u, 0, 1 - u * 0.45);
      blit(spr);
    }
    for (let i = 0; i < w.n; i++) {
      const t = w.tier[i]!;
      const X = sx(L, lerp(w.ox[i]!, w.x[i]!, a));
      const Y = sy(L, lerp(w.oy[i]!, w.y[i]!, a));
      const base = TIERS[t]!.r;
      let k = w.r[i]! / base;
      const age = w.age[i]!;
      if (w.chain[i]! > 0 && age < 0.7 && !reduced) k *= 1 + 0.2 * Math.exp(-age * 8) * Math.sin(age * 24 + 0.4);
      const sq = clamp(w.u0[i]!, -0.18, 0.22);
      const tilt = w.u2[i]!;
      put(X, Y, tilt, sq, w.u4[i]!, k);
      blit(art[t]!.body);
      // Eyes: they watch the pinch, close happily when freshly baked, worry near the rim.
      const r = base * L.s;
      const dx = pX - X;
      const dy = pY - Y;
      const d = Math.max(40, Math.hypot(dx, dy));
      look.x = clamp(dx / d, -1, 1);
      look.y = clamp(dy / d, -1, 1);
      const id = w.id[i]!;
      const period = 2.6 + hash(id, 2) * 3.5;
      const ph = (time + hash(id, 5) * 9) % period;
      look.blink = ph < 0.12 ? Math.sin((ph / 0.12) * Math.PI) : 0;
      const topY = w.y[i]! + w.r[i]!;
      look.mood = over ? "squeeze" : w.chain[i]! > 0 && age < 0.7 ? "happy" : run.dangerOn && topY > RIM - 1.5 ? "worried" : "plain";
      put(X, Y, tilt * 0.8, sq * 0.6, w.u4[i]!, k);
      drawEyes(g, t, r, look, art[t]!.lid);
      if (t === TOP) drawFlame(g, r, Math.sin(time * 5 + id) * (reduced ? 0.2 : 1), light.pulse(time + id, 1.2));
    }
    // The old pile popping away as a run starts.
    for (const l of leaving) {
      if (l.t < 0) {
        put(sx(L, l.x), sy(L, l.y), 0, 0, 0, 1);
        blit(art[l.tier]!.body);
        continue;
      }
      const u = clamp(l.t / 0.16);
      if (u >= 1) continue;
      const k = (1 - u) * (1 + 0.35 * Math.sin(u * Math.PI));
      put(sx(L, l.x), sy(L, l.y) - u * 10, 0, 0, 0, Math.max(0.01, k));
      blit(art[l.tier]!.body);
    }
  }

  function drawRim() {
    if (dangerGlow < 0.03) return;
    const y = rimY(L);
    const hot = run.dangerOn;
    const pulse = hot ? 0.55 + 0.45 * light.pulse(time, 2, { still: 0.8 }) : 1;
    g.globalAlpha = clamp(dangerGlow * pulse);
    g.strokeStyle = hot ? PAL.danger : PAL.butter;
    g.lineWidth = 4;
    g.setLineDash([10, 8]);
    g.lineDashOffset = -time * 20;
    g.beginPath();
    g.moveTo(L.tx + 4, y);
    g.lineTo(L.tx + TIN_W * L.s - 4, y);
    g.stroke();
    g.setLineDash([]);
    // A soft glow band under the line.
    g.fillStyle = (hot ? rimHot : rimWarm) ?? PAL.butter;
    g.fillRect(L.tx, y - L.s * 0.6, TIN_W * L.s, L.s * 1.2);
    g.globalAlpha = 1;
  }

  function drawPinch() {
    if (mode === "play" && (overT >= 0 || session.phase !== "playing")) return;
    const X = sx(L, pinchX);
    const Y = sy(L, HOLD_Y);
    const ready = run.canDrop;
    const tier = run.held;
    const r = radius(tier) * L.s;
    // Drop guide: a dotted line to where the piece will land; it warms up over a twin.
    if (ready) {
      const l = landing(run.world, pinchX, radius(tier));
      const ly = sy(L, l.y);
      const twin = l.on >= 0 && run.world.tier[l.on] === tier;
      g.strokeStyle = twin ? "rgba(255,226,140,0.9)" : "rgba(255,248,236,0.55)";
      g.lineWidth = twin ? 3 : 2;
      g.setLineDash([2, 7]);
      g.beginPath();
      g.moveTo(X, Y + r + 4);
      g.lineTo(X, Math.max(Y + r + 4, ly));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = twin ? "rgba(255,226,140,0.5)" : "rgba(255,248,236,0.25)";
      g.beginPath();
      g.ellipse(X, ly + r * 0.9, r * 0.7, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      if (twin) {
        // The twin it will land on glows: an assist, never an auto-aim.
        const w = run.world;
        const j = l.on;
        const tr = w.r[j]! * L.s;
        const tx = sx(L, lerp(w.ox[j]!, w.x[j]!, run.alpha));
        const ty = sy(L, lerp(w.oy[j]!, w.y[j]!, run.alpha));
        g.strokeStyle = PAL.butter;
        g.globalAlpha = 0.55 + 0.35 * light.pulse(time, 1.6, { still: 0.8 });
        g.lineWidth = 3;
        g.beginPath();
        g.arc(tx, ty, tr + 4, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    camera();
    // The held piece pops in when it arrives.
    if (ready) {
      const n = Math.min(SQUISH.length - 1, Math.floor(heldAge * 12));
      const k = reduced ? 1 : heldAge < 0.42 ? SQUISH[n]! : 1;
      // Held under a thumb: pinched a little tighter.
      put(X, Y, Math.sin(time * 2.2) * 0.04, -grip * 0.07, 0, k);
      blit(art[tier]!.body);
      look.x = 0;
      look.y = 0.6;
      look.blink = (time % 3.1) < 0.12 ? 1 : 0;
      look.mood = "plain";
      drawEyes(g, tier, r, look, art[tier]!.lid);
      if (tier === TOP) drawFlame(g, r, Math.sin(time * 5), 1);
    }
    // The baker's hand: thumb and index finger pinch the piece; they spring open on a drop.
    if (!hand) return;
    const open = easeOutBack(pinchOpen, 2);
    const rr = ready ? r : radius(run.held) * L.s;
    // Fingertips meet the piece at its sides, just above the middle, so its face stays in view.
    const fw = clamp(rr * 0.6, L.s * 0.3, L.s * 0.48);
    const palmY = Y - rr - L.s * 1.2 - open * 5;
    const palmX = X + Math.sin(time * 1.7) * 1.2;
    put(palmX, palmY, 0, 0, 0, 1);
    blit(hand);
    camera();
    const spread = open * (rr * 0.18 + 6) - grip * 2.5;
    const tipY = Y - rr * 0.28 - open * 6;
    drawFinger(g, palmX - L.s * 0.62, palmY + L.s * 0.18, X - rr - fw * 0.38 - spread, tipY, fw * 1.08);
    drawFinger(g, palmX + L.s * 0.42, palmY + L.s * 0.45, X + rr + fw * 0.38 + spread, tipY, fw);
  }

  function drawFx() {
    camera();
    crumbs.draw(g);
    if (puffSpr) {
      for (const p of puffs) {
        const u = p.t / p.life;
        g.globalAlpha = 0.85 * (1 - u) * (1 - u);
        const s = (p.r + p.grow * u) / puffSpr.ox;
        put(p.x, p.y, 0, 0, 0, s);
        blit(puffSpr);
      }
      g.globalAlpha = 1;
    }
  }

  /** A small bake (HUD copy) at screen (x, y), with its face. */
  function icon(set: PieceArt[], t: number, x: number, y: number, scale: number, eyes = true) {
    const a = set[t];
    if (!a || scale <= 0.01) return;
    g.setTransform(D * scale, 0, 0, D * scale, D * x, D * y);
    blit(a.body);
    if (eyes) {
      look.x = 0;
      look.y = 0;
      look.blink = (time + t * 0.7) % 4 < 0.12 ? 1 : 0;
      look.mood = "plain";
      drawEyes(g, t, a.r, look, a.lid);
    }
    view.begin();
  }

  function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
  }

  const scorePos = () => ({ x: 14, y: L.top + 8 });

  function drawHud() {
    view.begin();
    if (mode !== "play") return;
    const sp = scorePos();
    // Score plaque.
    g.save();
    g.translate(sp.x + 58, sp.y + 24);
    const pop = 1 + clamp(scorePop, -0.2, 0.3) * 0.3;
    g.scale(pop, pop);
    g.rotate(-0.025);
    plaque(g, -58, -24, 116, 46, PAL.cream, PAL.creamDeep, "#FFFDF6", 16);
    clayText(g, fmt(shown), 0, -5, 24, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.7)", lipY: 1.5 });
    g.font = font(11, 600);
    g.fillStyle = PAL.choc;
    g.fillText(session.best !== null && session.best > 0 ? `best ${fmt(session.best)}` : "points", 0, 14);
    g.restore();
    // Next piece on a little dish.
    const nx = L.W - 14 - 74;
    const ny = sp.y;
    g.save();
    g.translate(nx + 37, ny + 24);
    g.rotate(0.03);
    plaque(g, -37, -24, 74, 46, PAL.lavender, PAL.lavenderDeep, "#E8DEFA", 16);
    g.font = font(11, 600);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText("next", -30, 0);
    g.restore();
    icon(icons, run.next, nx + 53, ny + 23, 1.15);
    drawStrip();
    // Flyers into the score.
    for (const f of flyers) {
      const hang = 0.35;
      let x = f.x;
      let y = f.y - Math.min(1, f.t / hang) * 16;
      let s: number;
      if (f.t > hang) {
        const u = easeInCubic(Math.min(1, (f.t - hang) / 0.35));
        x = lerp(x, sp.x + 58, u);
        y = lerp(y, sp.y + 20, u) - Math.sin(u * Math.PI) * 30;
        s = 1 - u * 0.4;
      } else s = f.t < 0.08 ? 0.5 + f.t * 6 : 1;
      g.save();
      g.translate(x, y);
      g.scale(s, s);
      clayText(g, `+${fmt(f.pts)}`, 0, 0, f.size, { fill: PAL.butter, lip: PAL.chocDeep, outline: true });
      g.restore();
    }
    for (const st of stickers) {
      const u = st.t / 0.9;
      const n = Math.min(SQUISH.length - 1, Math.floor(st.t * 12));
      const k = reduced ? 1 : SQUISH[n]!;
      g.save();
      g.globalAlpha = u > 0.75 ? (1 - u) / 0.25 : 1;
      g.translate(clamp(st.x, 80, L.W - 80), Math.max(L.top + 70, st.y - u * 18));
      g.scale(k, k);
      g.rotate(((stepN % 3) - 1) * 0.02 - 0.04);
      clayText(g, st.text, 0, 0, st.size, { fill: st.fill, lip: PAL.chocDeep, outline: true });
      g.restore();
    }
    hudCrumbs.draw(g);
    drawCards();
    drawGrace();
    drawGhost();
    drawStarterBubble();
    if (session.phase === "over") drawSummary();
  }

  /** The recipe strip on the counter: every bake, lit once you have it this run. */
  function drawStrip() {
    const n = TIERS.length;
    const gap = Math.min(38, (L.W - 40) / n);
    const x0 = L.W / 2 - (gap * (n - 1)) / 2;
    const y = L.H - STRIP_H / 2 + 2;
    for (let t = 0; t < n; t++) {
      const got = seen[t]! >= 0;
      const age = got ? time - seen[t]! : 99;
      const pop = got && age < 0.6 && !reduced ? 1 + 0.5 * Math.exp(-age * 6) * Math.sin(age * 20) : 1;
      g.globalAlpha = got ? 1 : 0.3;
      icon(icons, t, x0 + t * gap, y, pop, got);
    }
    g.globalAlpha = 1;
    view.begin();
  }

  function drawCards() {
    const c = cards[0];
    if (!c) return;
    const n = Math.floor(c.t * 12);
    const out = c.t > c.life - 0.25 ? Math.max(0, (c.life - c.t) / 0.25) : 1;
    const k = (reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n)]!) * out;
    if (k <= 0.01) return;
    const cx = L.W / 2;
    const cy = rimY(L) + L.s * 2.2;
    const w = 210;
    const h = c.tier >= 0 ? 112 : 78;
    g.save();
    g.translate(cx + (((stepN * 7) % 3) - 1) * 0.6, cy);
    g.scale(k, k);
    g.rotate(-0.03 + (((stepN * 5) % 3) - 1) * 0.008);
    const top = c.tier === TOP ? PAL.salmon : c.tier === -2 ? PAL.danger : c.tier < 0 ? PAL.sage : PAL.butter;
    const deep = c.tier === TOP ? PAL.salmonDeep : c.tier === -2 ? PAL.dangerDeep : c.tier < 0 ? PAL.sageDeep : PAL.butterDeep;
    plaque(g, -w / 2, -h / 2, w, h, top, deep, "#FFF6DA", 22);
    g.font = font(14, 600);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(c.top, 0, -h / 2 + 18);
    clayText(g, c.title, 0, c.tier >= 0 ? h / 2 - 24 : 8, 26, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.75)", lipY: 2 });
    g.restore();
    if (c.tier >= 0) {
      icon(cardIcons, c.tier, cx, cy - 6, k);
    }
  }

  /** The grace countdown sits right on the rim, where the problem is. */
  function drawGrace() {
    if (!run.dangerOn || run.phase !== "play") return;
    const left = Math.max(1, Math.ceil(run.graceLeft));
    const y = rimY(L) - L.s * 0.2;
    const x = L.W / 2;
    const frac = run.graceLeft / GRACE;
    const n = Math.floor(((GRACE - run.graceLeft) % 1) * 12);
    const k = reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n)]!;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    // A clay kitchen timer: cream face, a coral ring that runs down, a big dark digit.
    g.beginPath();
    g.arc(0, 3, 28, 0, Math.PI * 2);
    g.fillStyle = PAL.dangerDeep;
    g.fill();
    g.beginPath();
    g.arc(0, 0, 28, 0, Math.PI * 2);
    g.fillStyle = PAL.cream;
    g.fill();
    g.strokeStyle = "rgba(201,81,59,0.25)";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 22, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = PAL.danger;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    g.stroke();
    clayText(g, String(left), 0, 0, 25, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.8)", lipY: 1.5 });
    g.restore();
    g.save();
    g.translate(x, y + 44);
    g.rotate(-0.03);
    plaque(g, -54, -14, 108, 28, PAL.danger, PAL.dangerDeep, "#F6A08C", 12);
    g.font = font(15, 700);
    g.fillStyle = PAL.cream;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("too full!", 0, 0);
    g.restore();
  }

  /** First run: a ghost thumb shows the drag and the let-go, again and again, until the first merge. */
  function drawGhost() {
    if (ghostAlpha <= 0.01 || ghostT < 0) return;
    const cyc = 2.6;
    const u = (ghostT % cyc) / cyc;
    const y = rimY(L) + L.s * 3.6;
    const cx = L.W / 2;
    const span = L.s * 2.6;
    // 0-0.12 press, 0.12-0.7 drag left then right, 0.7-0.84 lift ("let go"), then rest.
    const press = u > 0.04 && u < 0.72;
    const sway = u < 0.12 ? 0 : u < 0.7 ? Math.sin(((u - 0.12) / 0.58) * Math.PI * 2) : 0;
    const x = cx + sway * span;
    const lift = u >= 0.72 ? clamp((u - 0.72) / 0.12) : 0;
    const fade = u > 0.9 ? (1 - u) / 0.1 : 1;
    g.save();
    g.globalAlpha = ghostAlpha * fade;
    // Chevrons either side while dragging.
    if (press) {
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 4;
      for (const side of [-1, 1]) {
        const ax = x + side * 40;
        g.beginPath();
        g.moveTo(ax, y - 9);
        g.lineTo(ax + side * 9, y);
        g.lineTo(ax, y + 9);
        g.stroke();
      }
    }
    // The touch: a ring, a ripple when it lets go, and a pale thumb.
    g.strokeStyle = "rgba(255,255,255,0.9)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, press ? 20 : 15 + lift * 16, 0, Math.PI * 2);
    g.stroke();
    if (lift > 0) {
      g.globalAlpha = ghostAlpha * fade * (1 - lift);
      g.beginPath();
      g.arc(x, y, 22 + lift * 34, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = ghostAlpha * fade;
    }
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect(x - 13, y - 5 - lift * 18 - (press ? 0 : 6), 26, 74, 13);
    g.fill();
    g.stroke();
    g.restore();
    g.save();
    g.globalAlpha = ghostAlpha;
    const label = u < 0.72 ? "drag to aim" : "let go to drop!";
    plaque(g, cx - 84, y + 84, 168, 34, PAL.cream, PAL.creamDeep, "#FFFDF6", 14);
    g.font = font(16, 700);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, cx, y + 100);
    g.restore();
  }

  /** Once: the starter introduces itself from the empty top of the tin, with chevrons pointing down at it. */
  function drawStarterBubble() {
    if (starterSays <= 0) return;
    const t = starterSays;
    const n = Math.floor(t * 12);
    const k = (reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n)]!) * (t > 3.9 ? Math.max(0, (4.2 - t) / 0.3) : 1);
    if (k <= 0.01) return;
    const x = L.W / 2;
    const y = rimY(L) + L.s * 1.6;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    g.rotate(0.02);
    plaque(g, -132, -28, 264, 56, PAL.starter, PAL.starterDeep, PAL.starterHi, 20);
    g.font = font(15, 700);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("the starter dough is rising!", 0, -10);
    g.fillText("squish bakes to knock it down", 0, 10);
    // Chevrons bobbing down toward the dough.
    const bob = reduced ? 0 : ((stepN % 8) / 8) * 6;
    g.strokeStyle = PAL.starterDeep;
    g.lineWidth = 5;
    g.lineCap = "round";
    for (let c = 0; c < 2; c++) {
      const cy = 44 + c * 14 + bob;
      g.beginPath();
      g.moveTo(-12, cy);
      g.lineTo(0, cy + 9);
      g.lineTo(12, cy);
      g.stroke();
    }
    g.restore();
  }

  /**
   * What the run made, how it compares with the best, and one tip. In the feed the shell's result card covers the
   * middle and the caption the bottom, so this is a compact strip just above the caption.
   */
  function drawSummary() {
    const sm = summary;
    if (!sm || session.phaseTime < 0.35) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 16 : pv.left + 12;
    const right = L.W - (solo ? 16 : pv.right + 6);
    const w = right - left;
    const ph = 118;
    const topY = solo ? Math.round(L.H * 0.5) : L.H - pv.bottom - ph - 8;
    const k = easeOutBack(clamp((session.phaseTime - 0.35) / 0.4), 1.5);
    g.save();
    g.translate(left + w / 2, topY + ph / 2);
    g.scale(k, k);
    g.rotate(-0.012);
    plaque(g, -w / 2, -ph / 2, w, ph, PAL.cream, PAL.creamDeep, "#FFFDF6", 20);
    const x0 = -w / 2 + 14;
    // Highest bake, with its picture.
    g.font = font(12, 600);
    g.fillStyle = PAL.choc;
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText("best bake", x0 + 40, -ph / 2 + 18);
    g.font = font(17, 700);
    g.fillStyle = PAL.chocDeep;
    g.fillText(TIERS[sm.highest]!.title, x0 + 40, -ph / 2 + 36);
    g.textAlign = "right";
    g.font = font(12, 600);
    g.fillStyle = PAL.choc;
    g.fillText("biggest chain", w / 2 - 14, -ph / 2 + 18);
    g.font = font(17, 700);
    g.fillStyle = PAL.chocDeep;
    g.fillText(`×${Math.max(1, sm.chain)}`, w / 2 - 14, -ph / 2 + 36);
    // Progress against the best.
    const y0 = -ph / 2 + 54;
    const bw = w - 28;
    g.fillStyle = PAL.creamDeep;
    g.beginPath();
    g.roundRect(x0, y0, bw, 22, 11);
    g.fill();
    const prev = sm.prevBest;
    const frac = sm.isBest || !prev ? 1 : clamp(sm.score / prev);
    const grow = Math.min(1, (session.phaseTime - 0.35) / 0.8);
    if (frac > 0.02) {
      g.fillStyle = sm.isBest ? PAL.sageDeep : PAL.salmon;
      g.beginPath();
      g.roundRect(x0 + 3, y0 + 3, Math.max(16, (bw - 6) * frac * grow), 16, 8);
      g.fill();
    }
    const label = sm.isBest ? (prev ? `new best! +${fmt(sm.score - prev)}` : "first bake on the board!") : `${Math.round(frac * 100)}% of your best`;
    g.textAlign = "center";
    clayText(g, label, 0, y0 + 11, 13, { fill: PAL.cream, lip: PAL.chocDeep, lipY: 1.2 });
    // One tip for next time.
    let size = 13;
    g.font = font(size, 600);
    while (size > 9 && g.measureText(sm.tip).width > bw) g.font = font(--size, 600);
    g.fillStyle = PAL.chocDeep;
    g.textAlign = "left";
    g.fillText(sm.tip, x0, ph / 2 - 20);
    g.restore();
    icon(cardIcons, sm.highest, left + 32, topY + 32, k * 0.72);
    if (solo && session.phaseTime > 0.8) {
      g.save();
      g.translate(L.W / 2, topY - 64);
      g.rotate(-0.04);
      clayText(g, fmt(sm.score), 0, 0, 52, { fill: PAL.butter, lip: PAL.chocDeep, lipY: 4 });
      g.restore();
      const n = stepN % 16 < 8 ? 0 : -3;
      g.save();
      g.translate(L.W / 2, topY + ph + 46 + (reduced ? 0 : n));
      plaque(g, -110, -24, 220, 48, PAL.salmon, PAL.salmonDeep, "#FBC3B4", 22);
      clayText(g, "tap to bake again", 0, -2, 21, { fill: PAL.cream, lip: PAL.chocDeep });
      g.restore();
    }
  }

  /**
   * Attract mode: the title plaque and "tap to play!" hang in the empty top of the tin, inside the preview insets,
   * so the baker's hand above stays in view and the pile below stays clear of the caption.
   */
  function drawAttract() {
    const ins = session.preview();
    const right = L.W - ins.right - 10;
    const aw = right - (ins.left + 16);
    const k = Math.min(1, aw / 290);
    const topY = Math.max(ins.top + 10, rimY(L) + L.s * 0.5);
    const left = ins.left + 16 + (aw - 270 * k) / 2;
    const n = Math.min(SQUISH.length - 1, Math.floor(titleAge * 12));
    const sq = reduced ? 1 : SQUISH[n]!;
    const j = reduced ? 0.3 : 1;
    const wob = (s: number) => (hash(stepN, s) - 0.5) * 2 * j;
    g.save();
    g.translate(left + wob(1), topY + wob(2));
    g.scale(k * sq, k * sq);
    g.rotate(-0.045 + wob(3) * 0.01);
    plaque(g, 0, 0, 270, 70, PAL.salmon, PAL.salmonDeep, "#F9C1B2", 26);
    // Letters stuck on one by one, each nudged on its own at 12 fps.
    const word = "Pinchbake";
    g.font = font(46, 700);
    let x = 18;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]!;
      const cw = g.measureText(ch).width;
      const bob = (stepN + i * 2) % 12 < 6 ? 0 : -1.5 * j;
      g.save();
      g.translate(x + cw / 2 + wob(10 + i) * 0.8, 36 + bob + wob(20 + i) * 0.8);
      g.rotate(((i % 3) - 1) * 0.045 + wob(30 + i) * 0.05);
      clayText(g, ch, 0, 0, 46, { fill: PAL.cream, lip: PAL.chocDeep, lipY: 3 });
      g.restore();
      x += cw - 0.5;
    }
    g.restore();
    if (session.best !== null && session.best > 0) {
      g.save();
      g.translate(left + 180 * k + wob(6), topY + 58 * k + wob(7));
      g.scale(k, k);
      g.rotate(-0.05);
      plaque(g, 0, 0, 86, 26, PAL.butter, PAL.butterDeep, "#FFF0BF", 12);
      g.font = font(12, 700);
      g.fillStyle = PAL.chocDeep;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`best ${fmt(session.best)}`, 43, 13);
      g.restore();
    }
    // "tap to play!" just under the title.
    const by = topY + 70 * k + 52;
    const bounce = stepN % 16 < 8 ? 0 : -3 * j;
    g.save();
    g.translate(left + 135 * k + wob(8), by + bounce + wob(9));
    g.rotate(0.02 + wob(11) * 0.02);
    plaque(g, -104, -34, 208, 68, PAL.cream, PAL.creamDeep, "#FFFDF6", 26);
    clayText(g, "tap to play!", 0, -10, 25, { fill: PAL.chocDeep, lip: "rgba(255,255,255,0.8)", lipY: 1.5 });
    g.font = font(13, 600);
    g.fillStyle = PAL.choc;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("pinch, drop, squish twins", 0, 16);
    g.restore();
  }

  function render() {
    view.begin();
    if (stage) g.drawImage(stage, 0, 0, L.W, L.H);
    camera();
    drawStarter();
    drawPieces();
    camera();
    drawRim();
    drawPinch();
    drawFx();
    view.begin();
    if (mode !== "play") drawAttract();
    drawHud();
    view.begin();
    flash.draw(g, L.W, L.H);
  }

  newAttract();
  warmDemo(0.42, 13, 120);
  update(0);
  render();
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (++frames === 2) session.ready();
  });
}

void main();
