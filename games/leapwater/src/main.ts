import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, dampAngle, easeInOutCubic, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import { drawBranch, drawCascade, drawFly, drawHeron, drawKoi, koiTarget, visibleX, worldPlates, type KoiPose, type View } from "./draw.ts";
import { Fx } from "./fx.ts";
import { createBackdrop, type Cam } from "./land.ts";
import { PAPER, Press, RISO } from "./riso.ts";
import { createPilot, G, KISS, pilot, PERFECT, World, WU_PER_M, type Pilot } from "./sim.ts";
import { skyAt, type Sky } from "./sky.ts";
import { createSound } from "./sound.ts";
import { display, loadType, small, spaced, spacedWidth } from "./type.ts";

/** Meters climbed per full turn of the day. */
const DAY_M = 220;
const DEMO_SEED = 20261023;

async function main() {
  const [session] = await Promise.all([createSession({ id: "leapwater", restartDelayMs: 800 }), loadType()]);
  const view = createCanvas({ maxDpr: 2, background: PAPER });
  const press = new Press({
    paper: PAPER,
    inks: [
      { name: "teal", color: RISO.teal, angle: 0.26 },
      { name: "pink", color: RISO.fluoPink, angle: 1.31 },
      { name: "yellow", color: RISO.yellow, angle: 0.79 },
    ],
  });
  const { ctx } = view;
  const reduced = session.reducedMotion;
  const light = new Photosafe(reduced);
  const sound = createSound();
  const backdrop = createBackdrop();
  const fx = new Fx();

  let W = view.width;
  let H = view.height;
  press.resize(W, H, view.dpr);
  view.onResize((w, h) => {
    W = w;
    H = h;
    press.resize(w, h, view.dpr);
  });

  // --- world, pilot, camera --------------------------------------------------------------------
  let mode: "attract" | "run" = "attract";
  let world = new World({ seed: DEMO_SEED, demo: true });
  let demoPilot: Pilot = createPilot(7);
  /** A perfect player shadowing the real one on the first runs, to say when to hold and let go. */
  let coach: Pilot = createPilot(11);
  const baseZ = () => Math.min(W / 450, H / 880);
  const cam: Cam = { x: 0, y: 0, z: baseZ() };
  const pose: KoiPose = { x: 0, y: 0, rot: 0, face: 1, beat: 0, amp: 1, wet: 1, roll: 0 };
  let time = 0;
  let tod = 0.06;
  let skyNow: Sky = skyAt(tod);
  let slowT = 0;
  let slowDepth = 0;
  let slowLeap = -1;
  let veil = 0;
  let deadReal = -1;
  let ended = false;
  let firstPress = false;
  let hintDone = false;
  let shownScore = 0;
  let bubbleT = 0;
  let heartT = 0;
  let bestAtStart = 0;
  let scorePunch = 0;
  let demoAge = 0;
  // Dev only (stripped from builds): let the pilot play a run, for looking at later water.
  let autopilot: Pilot | null = null;
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__leapwater = {
      autopilot: (on: boolean) => (autopilot = on ? createPilot(3) : null),
    };
  }

  function camTarget(): { x: number; y: number } {
    const k = world.koi;
    const p = world.pool;
    const z = cam.z;
    const visW = W / z;
    const visH = H / z;
    // The koi a quarter in from the left, the wall it's climbing in frame, the staircase rising beyond.
    let tx = k.x + visW * 0.24;
    tx = clamp(tx, p.x1 - visW * 0.26, p.x1 + visW * 0.1);
    tx = clamp(tx, k.x - visW * 0.1, k.x + visW * 0.4);
    // The pool's bed sits low on the screen, leaving the falls above in view.
    let ty = p.s + p.depth - visH * (mode === "attract" ? 0.2 : 0.26);
    ty = clamp(ty, k.y - visH * 0.32, k.y + visH * 0.36);
    return { x: tx, y: ty };
  }

  function snapCamera(): void {
    cam.z = baseZ() * (mode === "attract" ? 0.92 : 1);
    const t = camTarget();
    cam.x = t.x;
    cam.y = t.y;
  }

  function resetPose(): void {
    const k = world.koi;
    pose.x = k.x;
    pose.y = k.y;
    pose.rot = 0;
    pose.face = 1;
    pose.roll = 0;
    pose.wet = 1;
    fx.clear();
    slowT = 0;
    slowLeap = -1;
  }

  function newDemo(): void {
    mode = "attract";
    world = new World({ seed: DEMO_SEED + Math.floor(Math.random() * 1000), demo: true });
    demoPilot = createPilot(Math.floor(Math.random() * 1e6));
    demoAge = 0;
    resetPose();
    snapCamera();
  }

  function newRun(): void {
    mode = "run";
    bestAtStart = session.best ?? 0;
    world = new World({ seed: (session.ctx.seed ^ (session.runs * 7919)) >>> 0 });
    coach = createPilot(11);
    press.register(session.runs + 1);
    deadReal = -1;
    ended = false;
    firstPress = false;
    hintDone = !tutorial();
    shownScore = 0;
    tod = 0.06;
    resetPose();
    snapCamera();
    veil = Math.max(veil, 0.6);
    syncHold();
  }

  // --- input: the first tap starts a run, then pressing anywhere holds -------------------------------
  const down = new Set<number>();
  let key = false;
  const holding = () => down.size > 0 || key;
  function syncHold(): void {
    const on = mode === "run" && session.phase === "playing" && holding();
    world.setHold(on);
    if (on) firstPress = true;
  }
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Presses that began before the run never count as a hold.
    if (session.phase === "playing") down.add(e.pointerId);
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
    if (session.phase === "playing") key = true;
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
  session.startOnTap(window);
  session.on("start", () => newRun());

  /** First runs get a word or two and a little patience from time itself. */
  const tutorial = () => session.runs <= 2 && bestAtStart < 30;

  function slow(depth: number, seconds: number): void {
    slowDepth = Math.max(slowT > 0 ? slowDepth : 0, depth * (reduced ? 0.45 : 1));
    slowT = Math.max(slowT, seconds);
  }

  // --- events → sound, fx --------------------------------------------------------------------
  function handleEvents(): void {
    const lv = mode === "run" ? 1 : 0.4;
    const run = mode === "run";
    for (const e of world.drain()) {
      switch (e.k) {
        case "breach":
          sound.breach(e.speed, lv);
          fx.spray(e.x, e.y, 16, e.speed * 0.45, -Math.PI / 2, 1.3);
          fx.ripple(e.x, world.pool.s, 16);
          break;
        case "land": {
          const kiss = e.clearance < KISS;
          sound.land(e.clean, e.flow, kiss, lv);
          fx.spray(e.x, world.pool.s, 22, 220 + e.speed * 0.3, -Math.PI / 2, 1.6);
          fx.ripple(e.x, world.pool.s, 24, 1.1);
          fx.bubbles(e.x, e.y + 20, 10, world.pool.s);
          if (run) {
            session.feedback("tap");
            scorePunch = 1;
            if (e.clean) fx.pop(e.x - 10, world.pool.s - 16, `+${Math.min(e.flow, 5) + (kiss ? 2 : 0)}`);
            if (world.falls >= 2) hintDone = true;
          }
          break;
        }
        case "fail":
          if (e.why !== "short") {
            if (run) {
              sound.fail();
              session.feedback("impact");
            }
            fx.spray(e.x, e.y, 14, 160, Math.PI, 1.8);
          }
          break;
        case "splash":
          sound.splash(e.speed, lv);
          fx.spray(e.x, world.pool.s, 12, 120 + e.speed * 0.25, -Math.PI / 2, 1.4);
          fx.ripple(e.x, world.pool.s, 18);
          break;
        case "bonk":
          if (run) sound.bonk();
          fx.bubbles(e.x, e.y, 6, world.pool.s);
          break;
        case "scrape":
          if (run) sound.scrape();
          fx.spray(e.x, e.y + 5, 6, 40, -Math.PI / 2, 2, ["pink", "teal"]);
          break;
        case "near":
          break;
        case "fly":
          if (run) sound.fly(e.n);
          fx.spray(e.x, e.y, 12, 120, 0, Math.PI * 2, ["yellow", "yellow", "paper"]);
          if (run) fx.pop(e.x, e.y - 6, "+2");
          break;
        case "cock":
          if (run) sound.cock();
          break;
        case "strike":
          if (run) sound.strike(e.hit);
          fx.spray(e.heron.aimX, world.poolById(world.koi.pool)?.s ?? e.heron.aimY, 10, 130, -Math.PI / 2, 1.4);
          break;
        case "low":
          break;
        case "die":
          if (run) {
            sound.end();
            session.feedback("impact");
            slow(0.6, 0.8);
          }
          break;
      }
    }
  }

  // --- update ----------------------------------------------------------------------------------
  function update(dt: number): void {
    session.tick(dt);
    time += dt;
    veil = Math.max(0, veil - dt * 1.5);
    let scale = 1;
    if (slowT > 0) {
      slowT = Math.max(0, slowT - dt);
      scale = 1 - slowDepth * easeInOutCubic(Math.min(1, slowT / 0.4));
    }
    const k = world.koi;
    const run = mode === "run";

    if (mode === "attract") {
      demoAge += dt;
      world.setHold(pilot(world, demoPilot, dt * scale, PERFECT));
      // Fresh water every so often, with a halftone wipe.
      if (demoAge > 40 && k.water && world.koi.dir > 0) {
        veil = Math.min(1, veil + dt * 4);
        if (veil >= 0.98) newDemo();
      }
    } else if (import.meta.env.DEV && autopilot) {
      world.setHold(pilot(world, autopilot, dt * scale, PERFECT));
    } else if (tutorial() && !hintDone && world.alive) {
      // The coach plays along; time waits a little at the moment to press.
      pilot(world, coach, dt * scale, PERFECT);
      if (!firstPress && coach.hold && k.water) scale = Math.min(scale, 0.4);
    }

    // Tension: a leap about to graze the lip slows the world for a breath.
    if (!k.water && world.alive && slowLeap !== world.falls * 1000 + world.fails) {
      const p = world.pool;
      const up = p.s - p.hFall;
      const t = (p.x1 - k.x) / Math.max(1, k.vx);
      if (t > 0 && t < 0.2) {
        const yAt = k.y + k.vy * t + 0.5 * G * t * t;
        const clear = up - yAt;
        if (clear > -10 && clear < 20) {
          slowLeap = world.falls * 1000 + world.fails;
          if (run) slow(0.62, 0.55);
        }
      }
    }

    world.update(dt * scale);
    handleEvents();

    if (run && !world.alive) {
      if (deadReal < 0) deadReal = 0;
      deadReal += dt;
      if (!ended && deadReal >= 0.75) {
        ended = true;
        session.end(world.meters, {
          outcome: "lose",
          stats: { meters: Math.floor(world.climbed / WU_PER_M), falls: world.falls, clean: world.cleanLeaps, dragonflies: world.fliesTaken },
        });
      }
    }

    // The day turns with the height climbed.
    const want = mode === "attract" ? 0.06 + Math.sin(time * 0.03) * 0.03 : 0.06 + world.climbed / WU_PER_M / DAY_M;
    tod = mode === "attract" ? want : damp(tod, want, 0.6, dt);
    skyNow = skyAt(tod);

    // Camera.
    const z0 = baseZ() * (mode === "attract" ? 0.92 : 1);
    cam.z = damp(cam.z, z0, 3, dt);
    const ct = camTarget();
    cam.x = damp(cam.x, ct.x, 2.4, dt);
    cam.y = damp(cam.y, ct.y, 2.1, dt);

    // Pose.
    pose.x = k.x;
    pose.y = k.y;
    const tgt = koiTarget(k);
    pose.rot = dampAngle(pose.rot, tgt.rot, k.water ? 10 : 18, dt);
    pose.face = damp(pose.face, tgt.face, 9, dt);
    const speed = Math.hypot(k.vx, k.vy);
    if (k.water) {
      pose.beat += dt * scale * (5 + speed / 45);
      pose.amp = damp(pose.amp, 0.9 + Math.min(1.6, speed / 300), 4, dt);
    } else {
      // Thrashing in the air.
      pose.beat += dt * scale * 16;
      pose.amp = damp(pose.amp, 2.4, 6, dt);
    }
    pose.wet = k.water ? 1 : 0;
    pose.roll = !world.alive && world.deathHow === "spent" ? Math.min(1, pose.roll + dt * 0.9) : 0;

    // Bubbles off a diving koi, a heartbeat when it's spent.
    bubbleT -= dt;
    if (k.water && world.holding && world.alive && bubbleT <= 0) {
      bubbleT = 0.12;
      fx.bubbles(k.x - Math.cos(k.head) * 12, k.y - Math.sin(k.head) * 12, 1, world.pool.s);
      if (run && Math.random() < 0.35) sound.bubble(1);
    }
    heartT -= dt;
    if (run && world.alive && world.vigor < 0.25 && heartT <= 0) {
      heartT = 0.5 + world.vigor * 3;
      sound.heart();
    }
    fx.update(dt * scale, W, H, reduced);

    if (run && session.phase === "playing") shownScore = world.meters;
    scorePunch = Math.max(0, scorePunch - dt * 3);
    const p = world.pool;
    const fall = clamp(1 - Math.abs(p.x1 - k.x) / 420) * clamp(p.hFall / 160, 0.4, 1);
    sound.update(k.water ? 1 : 0, fall, run ? 1 : 0.45);
  }

  // --- render ----------------------------------------------------------------------------------
  function render(): void {
    const sky = skyNow;
    const v: View = { press, W, H, cam, sky, time, reduced };
    press.begin();
    backdrop.draw(press, W, H, cam, sky, time, reduced);
    fx.drawLeaves(v);
    const pl = worldPlates(v);
    drawCascade(v, world, pl);
    const [x0, x1] = visibleX(v, 80);
    for (const p of world.pools) {
      if (p.x1 < x0 - 100 || p.x0 > x1 + 100) continue;
      if (p.heron) drawHeron(v, p.heron, p, pl);
    }
    drawKoi(v, pose, pl);
    for (const p of world.pools) {
      if (p.x1 < x0 - 100 || p.x0 > x1 + 100) continue;
      if (p.branch) drawBranch(v, p.branch, p, pl);
      for (const f of p.flies) drawFly(v, f, pl);
    }
    fx.draw(v, pl);
    drawUi(sky);
    press.print(ctx);
    if (veil > 0) drawVeil(easeInOutCubic(Math.min(1, veil)));
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
      g.arc(c.width / 2, c.width / 2, Math.sqrt((q / 12) * 4 * s * s / Math.PI) * 1.02, 0, Math.PI * 2);
      g.fill();
      pat = ctx.createPattern(c, "repeat")!;
      pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
      veilPatterns.set(q, pat);
    }
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }

  /** The prompt: a capsule of solid ink with the word knocked out, breathing slowly. */
  function capsule(ink: "pink" | "teal", word: string, x: number, y: number, u: number): void {
    const c = press.plate(ink);
    const breathe = light.pulse(time, 0.5, { still: 0.5 });
    const font = small(12.5 * u);
    const track = 4.2 * u;
    const tw = spacedWidth(c, word, font, track);
    const w = tw + 34 * u + breathe * 6 * u;
    const h = 30 * u;
    // Clear every plate under it, print the capsule, knock the word out to bare paper.
    for (const p of ["teal", "pink", "yellow"] as const) {
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

  /** A word printed twice, the second plate a hair off. */
  function doublePrint(text: string, x: number, y: number, font: string, track: number, a: "teal" | "pink", b: "pink" | "yellow" | "teal", off: number): void {
    const ca = press.plate(a);
    ca.fillStyle = press.solid(a);
    spaced(ca, text, x, y, font, track);
    const cb = press.plate(b);
    cb.fillStyle = press.solid(b);
    spaced(cb, text, x + off, y + off * 0.6, font, track);
  }

  function registrationMark(x: number, y: number, r: number): void {
    for (const ink of ["teal", "pink", "yellow"] as const) {
      const c = press.plate(ink);
      c.strokeStyle = press.solid(ink);
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.moveTo(x - r * 1.6, y);
      c.lineTo(x + r * 1.6, y);
      c.moveTo(x, y - r * 1.6);
      c.lineTo(x, y + r * 1.6);
      c.stroke();
    }
  }

  function drawUi(sky: Sky): void {
    const u = clamp(Math.min(W / 390, H / 760), 0.85, 1.5);
    const phase = session.phase;
    const ink: "teal" | "pink" = "teal";
    const night = sky.night > 0.5;
    if (mode === "run") {
      if (phase === "playing") {
        const top = session.play().top;
        const y = top + 54 * u;
        const punch = 1 + easeOutCubic(scorePunch) * 0.12;
        // At night the score is knocked out of the teal sky instead.
        const sc = String(shownScore);
        const font = display(40 * u * punch);
        if (night) {
          const c = press.plate("teal");
          c.globalCompositeOperation = "destination-out";
          spaced(c, sc, W / 2, y, font, 2 * u);
          c.globalCompositeOperation = "source-over";
          const p = press.plate("pink");
          p.fillStyle = press.solid("pink");
          spaced(p, sc, W / 2 + 1.5, y + 1, font, 2 * u);
        } else doublePrint(sc, W / 2, y, font, 2 * u, ink, "pink", 1.6);
        // Strength: a short rule under the score, pink on a teal screen.
        const bw = 86 * u;
        const by = y + 12 * u;
        const tc0 = press.plate("teal");
        tc0.fillStyle = press.screen("teal", 0.3);
        tc0.fillRect(W / 2 - bw / 2, by, bw, 4 * u);
        const pc = press.plate("pink");
        const low = world.vigor < 0.25 ? light.pulse(time, 1.6) : 1;
        pc.fillStyle = press.screen("pink", 0.55 + 0.45 * low);
        pc.fillRect(W / 2 - bw / 2, by, bw * clamp(world.vigor), 4 * u);
        // The chain: one dot per clean leap in a row.
        const n = Math.min(world.flow, 8);
        if (n > 0) {
          const yc = press.plate("yellow");
          const pk = press.plate("pink");
          for (let i = 0; i < n; i++) {
            const dx = W / 2 + (i - (n - 1) / 2) * 9 * u;
            yc.fillStyle = press.solid("yellow");
            yc.beginPath();
            yc.arc(dx, by + 14 * u, 2.6 * u, 0, Math.PI * 2);
            yc.fill();
            pk.fillStyle = press.screen("pink", 0.5);
            pk.beginPath();
            pk.arc(dx, by + 14 * u, 2.6 * u, 0, Math.PI * 2);
            pk.fill();
          }
        }
        // First runs: a word, then silence.
        if (tutorial() && !hintDone && world.alive && world.koi.water) {
          const hy = by + 54 * u;
          if (coach.hold && !world.holding) capsule("pink", "HOLD", W / 2, hy, u);
          else if (!coach.hold && world.holding && world.koi.charged) capsule("pink", "LET GO", W / 2, hy, u);
        }
      } else if (phase === "over" && session.standalone && session.phaseTime > 0.8) {
        // A bare tab has no result card: the result sits in the open sky, the prompt under it.
        const r = session.preview();
        const cx = r.left + (W - r.left - r.right) / 2;
        const top = Math.max(r.top + 80 * u, H * 0.17);
        doublePrint(String(world.meters), cx, top, display(76 * u), 3 * u, "teal", "pink", 2.2);
        const c = press.plate("teal");
        c.fillStyle = press.solid("teal");
        spaced(c, "METERS", cx + 3 * u, top + 24 * u, small(11 * u), 6 * u);
        if (session.best !== null) spaced(c, `BEST ${session.best}`, cx + 3 * u, top + 44 * u, small(11 * u), 6 * u);
        capsule("pink", "TAP", cx, top + 96 * u, u);
      }
      return;
    }
    // Attract: a poster. Title at the top of the sheet, the prompt under it, registration marks in the corners.
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const k = clamp(time / 1.0);
    const titleY = Math.max(r.top + 74 * u, H * 0.13);
    const size = Math.min(64 * u, ((W - r.left - r.right) * 0.86) / 5.3);
    doublePrint("LEAPWATER", cx, titleY + (1 - easeOutCubic(k)) * 8, display(size), 1.5 * u, "teal", "pink", 2.4);
    if (session.best !== null && session.best > 0) {
      const c = press.plate("teal");
      c.fillStyle = press.solid("teal");
      spaced(c, `BEST ${session.best} M`, cx + 2.5 * u, titleY + 24 * u, small(10.5 * u), 5 * u);
    }
    capsule("pink", "TAP", cx, titleY + 70 * u, u);
    const m = 16 * u;
    registrationMark(r.left + m, r.top + m + 6, 5 * u);
    registrationMark(W - r.right - m, r.top + m + 6, 5 * u);
  }

  newDemo();
  veil = 0;
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
