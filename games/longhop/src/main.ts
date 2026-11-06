import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeInOutCubic, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createSession } from "@thumbcade-games/kit/session";
import { Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { drawBranch, drawDevil, drawFlower, drawGround, drawKangaroo, drawObstacle, onWorld, visibleX, type Pose, type View } from "./draw.ts";
import { createBackdrop, layout, oval, type Cam } from "./land.ts";
import { BLUE, INKS, ORANGE, PAPER, skyAt, SUN, type Sky } from "./palette.ts";
import { Press, RISO } from "./riso.ts";
import { newPilot, pilot, World, WU_PER_M } from "./sim.ts";
import { createSound } from "./sound.ts";
import { display, loadType, small, spaced, spacedWidth } from "./type.ts";

/** Meters per full turn of the day (afternoon → sunset → night → dawn). */
const DAY_M = 1000;
const DEMO_SEED = 20261023;

async function main() {
  const [session] = await Promise.all([createSession({ id: "longhop", restartDelayMs: 800 }), loadType()]);
  const view = createCanvas({ maxDpr: 2, background: PAPER });
  const press = new Press({ paper: PAPER, inks: INKS, grain: 0.42, slip: 1.3, cell: 3.2, scale: 0.8 });
  press.resize(view.width, view.height, view.dpr);
  const sound = createSound();
  const backdrop = createBackdrop();
  const reduced = session.reducedMotion;
  const light = new Photosafe(reduced);
  const shake = new Shake(10, 0, 1.8, reduced);
  const dust = new Particles(260);
  const darkDust = new Particles(120);
  const petals = new Particles(160);
  const sparks = new Particles(120);

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
    press.resize(w, h, view.dpr);
  });

  // --- world, camera, pose -------------------------------------------------------------------
  let mode: "attract" | "run" = "attract";
  let world = new World({ seed: DEMO_SEED, demo: true });
  let pil = newPilot();
  let demoLaunchIn = 0.6;
  let demoFade = -1;
  const cam: Cam = { x: 0, y: 0, z: 1 };
  const pose: Pose = { x: 0, y: 0, footX: 0, footY: 0, stance: true, squat: 0, reach: 1, vy: 0, joey: 0.2, rot: 0, ears: 0, tail: 0, blink: 0 };
  let joeyV = 0;
  let joeyX = 0.2;
  let slowT = 0;
  let slowDepth = 0;
  let veil = 0;
  let time = 0;
  let tod = 0.2;
  let deadReal = -1;
  let ended = false;
  let bestAtStart = 0;
  let firstLandingDone = false;
  let hintDone = false;
  let blinkT = 2;
  let landKick = 0;
  let shownScore = 0;
  let runSeed = 1;

  const baseZ = () => Math.min(W / 430, H / 800);
  const groundFrac = () => (mode === "attract" ? 0.77 : 0.73);
  const kangarooFrac = () => (mode === "attract" ? 0.4 : 0.16);

  function camTarget(): { x: number; y: number; z: number } {
    const span = mode === "attract" ? 1.05 : 1 + clamp((world.vx - 280) / 220) * 0.34;
    const z = baseZ() / span;
    const ground = world.baseY(world.x + 60);
    return { z, x: world.x + (0.5 - kangarooFrac()) * (W / z), y: ground - (groundFrac() * H - H / 2) / z };
  }

  function snapCamera(): void {
    const t = camTarget();
    cam.x = t.x;
    cam.y = t.y;
    cam.z = t.z;
  }

  function newDemo(): void {
    mode = "attract";
    world = new World({ seed: DEMO_SEED, demo: true });
    pil = newPilot();
    demoLaunchIn = 0.8;
    demoFade = -1;
    pose.rot = 0;
    snapCamera();
  }

  function newRun(): void {
    mode = "run";
    bestAtStart = session.best ?? 0;
    runSeed = (session.ctx.seed ^ (session.runs * 7919)) >>> 0;
    world = new World({ seed: runSeed });
    world.launch();
    press.register(runSeed);
    deadReal = -1;
    ended = false;
    firstLandingDone = false;
    shownScore = 0;
    pose.rot = 0;
    joeyX = 0.2;
    snapCamera();
    veil = Math.max(veil, 0.6);
    syncHold();
  }

  // --- input: the first tap starts a run, then pressing anywhere holds the legs ----------------
  const down = new Set<number>();
  let key = false;
  const holding = () => down.size > 0 || key;
  function syncHold(): void {
    world.setHold(mode === "run" && session.phase === "playing" && holding());
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

  // --- events → sound, particles, slow motion -------------------------------------------------
  function slow(depth: number, seconds: number): void {
    slowDepth = Math.max(slowDepth * (slowT > 0 ? 1 : 0), depth * (reduced ? 0.45 : 1));
    slowT = Math.max(slowT, seconds);
  }

  function puff(x: number, y: number, n: number, speed: number): void {
    dust.emit(x, y - 2, { count: n, speed: [20, speed], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.35, 0.8], size: [1.2, 3.2], colors: [RISO.orange], gravity: 160, drag: 3, shape: "circle", vx: world.vx * 0.15 });
    darkDust.emit(x, y - 1, { count: Math.ceil(n / 2), speed: [10, speed * 0.7], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.3, 0.7], size: [0.8, 2], colors: [RISO.federal], gravity: 200, drag: 3, shape: "circle" });
  }

  function handleEvents(): void {
    const lv = mode === "run" ? 1 : 0.45;
    for (const e of world.drain()) {
      switch (e.k) {
        case "land": {
          sound.land(e.surface, e.speed, e.loaded, World.bottom(e.surface), lv);
          puff(e.x, e.y, e.surface === "sand" ? 14 : 8, e.surface === "sand" ? 90 : 60);
          landKick = 1;
          joeyV -= 6;
          if (mode === "run") firstLandingDone = true;
          break;
        }
        case "hop": {
          sound.hop(e.kind, e.power, e.flow, lv);
          if (e.kind === "perfect") {
            joeyV += 9;
            sparks.emit(world.footX, world.footY - 2, { count: 7 + Math.min(e.flow, 6), speed: [40, 110], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [0.3, 0.6], size: [1.6, 3], colors: [RISO.sunflower], gravity: 120, drag: 2, shape: "spark" });
            if (mode === "run") session.feedback("tap");
          }
          if (mode === "run" && !hintDone) hintDone = world.perfects >= 2;
          break;
        }
        case "flower":
          sound.pea(e.chain);
          petals.emit(e.x, e.y - 10, { count: 12, speed: [30, 110], angle: [-Math.PI, 0], life: [0.6, 1.2], size: [2, 3.6], colors: [RISO.orange, RISO.orange, RISO.sunflower], gravity: 140, drag: 1.6, shape: "circle", vx: world.vx * 0.3 });
          break;
        case "near":
          if (mode === "run") {
            slow(0.6, 0.7);
            sound.near();
          }
          break;
        case "devil":
          sound.devil();
          break;
        case "crash":
          if (mode === "run") {
            sound.crash();
            slow(0.65, 0.8);
            shake.add(0.6);
            session.feedback("impact");
          }
          puff(world.x + 10, world.y - 20, 16, 120);
          break;
        case "fall":
          if (mode === "run") {
            sound.fall();
            session.feedback("impact");
          }
          break;
      }
    }
  }

  /** New players get a word of help and a moment of slowed time on their first runs. */
  const tutorial = () => session.runs <= 2 && bestAtStart < 60;

  // --- update -----------------------------------------------------------------------------------
  let skyNow: Sky = skyAt(tod);

  function update(dt: number): void {
    session.tick(dt);
    time += dt;
    veil = Math.max(0, veil - dt * 2.2);
    let scale = 1;
    if (slowT > 0) {
      slowT = Math.max(0, slowT - dt);
      scale = 1 - slowDepth * easeInOutCubic(Math.min(1, slowT / 0.4));
    }
    // First runs: time waits a little for the first press before the first landing, and at the bottom of the squat.
    if (mode === "run" && tutorial() && world.alive && !hintDone) {
      if (!firstLandingDone && world.phase === "air" && world.vy > 0 && !world.holding) scale = Math.min(scale, 0.4);
      if (world.phase === "stance" && world.loaded && world.hops < 3) scale = Math.min(scale, 0.5);
    }

    if (mode === "attract") {
      demoLaunchIn -= dt;
      if (world.phase === "stand" && demoLaunchIn <= 0) world.launch();
      world.setHold(pilot(world, pil, 0));
      if (!world.alive) {
        if (demoFade < 0) demoFade = 0;
        demoFade += dt;
        if (demoFade > 1.1) veil = Math.min(1, veil + dt * 4);
        if (demoFade > 1.5) newDemo();
      }
    }
    world.update(dt * scale);
    handleEvents();

    if (mode === "run" && !world.alive) {
      if (deadReal < 0) deadReal = 0;
      deadReal += dt;
      if (!ended && deadReal >= 0.75) {
        ended = true;
        session.end(world.meters, {
          outcome: "lose",
          stats: { meters: Math.floor(world.distanceM), hops: world.hops, perfect: world.perfects, peas: world.flowersTaken },
        });
      }
    }

    const want = mode === "attract" ? 0.17 + Math.sin(time * 0.05) * 0.015 : 0.13 + world.distanceM / DAY_M;
    tod = mode === "attract" ? want : damp(tod, want, 0.8, dt);
    skyNow = skyAt(tod);

    // Camera: long easing; zooms out a little with speed.
    const t = camTarget();
    cam.z = damp(cam.z, t.z, 1.2, dt);
    cam.x = damp(cam.x, t.x, world.alive ? 5 : 2, dt);
    cam.y = damp(cam.y, t.y, 2.5, dt);
    shake.update(dt);

    // Pose.
    pose.x = world.x;
    pose.y = world.phase === "stance" ? world.footY : world.y;
    pose.footX = world.footX;
    pose.footY = world.footY;
    pose.stance = world.phase === "stance" || world.phase === "stand";
    pose.squat = world.phase === "stand" ? 0.15 : world.squat;
    pose.vy = world.vy;
    const descending = clamp((world.vy + 120) / 520);
    pose.reach = world.phase === "air" ? damp(pose.reach, easeOutCubic(descending), 9, dt) : 1;
    pose.ears = damp(pose.ears, clamp(-world.vy / 700, -0.4, 1) * 0.8 + landKick * 0.3, 8, dt);
    pose.tail = damp(pose.tail, world.phase === "air" ? clamp(world.vy / 900, -0.5, 0.5) : 0, 6, dt);
    landKick = Math.max(0, landKick - dt * 4);
    // The joey: a spring of its own.
    joeyV += (0.25 - joeyX) * 60 * dt;
    joeyV *= Math.exp(-6 * dt);
    joeyX += joeyV * dt;
    pose.joey = world.alive ? clamp(joeyX, -0.6, 1.2) : -1;
    blinkT -= dt;
    if (blinkT < 0) blinkT = 2.5 + Math.random() * 3;
    pose.blink = blinkT < 0.12 ? 1 : 0;
    if (!world.alive && world.deathHow !== "gully" && world.deathHow !== "wall") pose.rot += dt * (5 - Math.min(4.6, world.deadT * 4)) * (world.deadT < 1 ? 1 : 0);

    dust.update(dt * scale);
    darkDust.update(dt * scale);
    petals.update(dt * scale);
    sparks.update(dt * scale);
    if (mode === "run" && session.phase === "playing") shownScore = world.meters;
    sound.update(world.alive ? Math.hypot(world.vx, world.vy) : 0, skyNow.night, mode === "run" ? 1 : 0.5, dt);
  }

  // --- render -----------------------------------------------------------------------------------
  function capsule(word: string, cx: number, cy: number, u: number, ink: string): void {
    const breathe = light.pulse(time, 0.4, { still: 0.5 });
    const font = small(12.5 * u);
    const track = 5 * u;
    const tw = spacedWidth(press.plate(ink), word, font, track);
    const s = 1 + breathe * 0.05;
    const w = (tw + 34 * u) * s;
    const h = 30 * u * s;
    const c = press.plate(ink);
    c.fillStyle = press.solid(ink);
    c.beginPath();
    c.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    spaced(c, word, cx + track / 2, cy + 4.4 * u, font, track);
    c.globalCompositeOperation = "source-over";
  }

  function regMark(x: number, y: number, r: number): void {
    for (const ink of [BLUE, ORANGE, SUN]) {
      const c = press.plate(ink);
      c.strokeStyle = press.solid(ink);
      c.lineWidth = 0.9;
      c.beginPath();
      oval(c, x, y, r, r);
      c.moveTo(x - r * 1.7, y);
      c.lineTo(x + r * 1.7, y);
      c.moveTo(x, y - r * 1.7);
      c.lineTo(x, y + r * 1.7);
      c.stroke();
    }
  }

  /** Clears every plate in a rectangle: a strip of bare paper for small type. */
  function paperStrip(x: number, y: number, w: number, h: number): void {
    for (const ink of [BLUE, ORANGE, SUN]) {
      const c = press.plate(ink);
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.fillRect(x, y, w, h);
      c.globalCompositeOperation = "source-over";
    }
  }

  /** A title printed twice, blue then orange, the second plate a hair off. */
  function title(text: string, cx: number, y: number, px: number, track: number): void {
    const b = press.plate(BLUE);
    b.fillStyle = press.solid(BLUE);
    spaced(b, text, cx + track / 2, y, display(px), track);
    const o = press.plate(ORANGE);
    o.fillStyle = press.solid(ORANGE);
    spaced(o, text, cx + track / 2 + px * 0.045, y + px * 0.03, display(px), track);
  }

  function render(): void {
    const sky = skyNow;
    press.begin();
    const sh = shake.offset;
    const camView: Cam = { x: cam.x - sh.x / cam.z, y: cam.y - sh.y / cam.z, z: cam.z };
    const v: View = { W, H, cam: camView, sky, time, still: reduced };
    const groundScreen = (world.baseY(cam.x) - camView.y) * camView.z + H / 2;
    const L = layout(H, groundScreen);
    backdrop.draw(press, W, H, camView, L, sky, tod, time, 1 / 60, reduced);

    const [x0, x1] = visibleX(v, 80);
    for (const b of world.branches) if (b.x1 > x0 && b.x0 < x1) drawBranch(press, v, b);
    for (const d of world.devils) if (Math.abs(d.x - (x0 + x1) / 2) < (x1 - x0) / 2 + 60) drawDevil(press, world, v, d);
    drawGround(press, world, v);
    for (const o of world.obstacles) if (o.x + o.w > x0 && o.x - o.w < x1) drawObstacle(press, v, o);
    for (const f of world.flowers) if (f.x > x0 && f.x < x1) drawFlower(press, v, f);

    // Best: a little survey peg at your farthest point.
    if (mode === "run" && bestAtStart > 0) {
      const bx = bestAtStart * WU_PER_M;
      if (bx > x0 && bx < x1 && !world.gullyAt(bx)) {
        const gy = world.baseY(bx);
        const c = onWorld(press, BLUE, v);
        c.fillStyle = press.solid(BLUE);
        c.fillRect(bx - 1, gy - 46, 2, 46);
        const o = onWorld(press, ORANGE, v);
        o.fillStyle = press.solid(ORANGE);
        o.beginPath();
        o.moveTo(bx + 1, gy - 46);
        o.lineTo(bx + 15, gy - 41);
        o.lineTo(bx + 1, gy - 36);
        o.fill();
      }
    }

    const clip = !world.alive && (world.deathHow === "gully" || world.deathHow === "wall") ? world.baseY(world.x) + 50 : null;
    if (world.phase !== "dead" || clip === null || world.deadT < 2.5) drawKangaroo(press, v, pose, (x) => world.groundY(x), clip);
    onWorld(press, ORANGE, v);
    dust.draw(onWorld(press, ORANGE, v));
    petals.draw(onWorld(press, ORANGE, v));
    darkDust.draw(onWorld(press, BLUE, v));
    sparks.draw(onWorld(press, SUN, v));

    drawUi(sky);
    if (veil > 0) {
      // Un-print toward paper (a run starting, the demo looping).
      const k = easeInOutCubic(Math.min(1, veil));
      for (const ink of [BLUE, ORANGE, SUN]) {
        const c = press.plate(ink);
        c.globalAlpha = k;
        c.globalCompositeOperation = "destination-out";
        c.fillStyle = "#000";
        c.fillRect(0, 0, W, H);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
      }
    }
    press.print(view.ctx);
  }

  function drawUi(sky: Sky): void {
    const u = clamp(Math.min(W / 390, H / 760), 0.85, 1.5);
    const phase = session.phase;
    // Text over the night sky knocks out of the blue instead of printing dark on dark.
    const night = sky.night > 0.55;
    if (mode === "run") {
      if (phase === "playing") {
        const top = session.play().top;
        const c = press.plate(BLUE);
        const font = display(40 * u);
        const y = top + 52 * u;
        if (night) {
          c.globalCompositeOperation = "destination-out";
          c.fillStyle = "#000";
        } else c.fillStyle = press.solid(BLUE);
        const w = spaced(c, String(shownScore), W / 2, y, font, 1.5 * u);
        c.globalCompositeOperation = "source-over";
        const o = press.plate(ORANGE);
        o.fillStyle = press.solid(ORANGE);
        spaced(o, "M", W / 2 + w / 2 + 4 * u, y, small(12 * u), 2 * u, 0);
        // Flow: one dot per perfect hop in a row.
        const n = Math.min(world.flow, 8);
        if (n >= 2) {
          o.beginPath();
          for (let i = 0; i < n; i++) oval(o, W / 2 + (i - (n - 1) / 2) * 9 * u, y + 14 * u, 2.4 * u, 2.4 * u);
          o.fill();
        }
        if (tutorial() && !hintDone && world.alive) {
          const hy = top + 118 * u;
          if (world.phase === "air" && !world.holding && world.vy > -100) capsule("HOLD", W / 2, hy, u, ORANGE);
          else if (world.phase === "stance" && world.loaded && world.stanceT > World.bottom(world.surface) - 0.07) capsule("LET GO", W / 2, hy, u, ORANGE);
        }
      } else if (phase === "over" && session.standalone && session.phaseTime > 0.8) {
        const r = session.preview();
        const cx = r.left + (W - r.left - r.right) / 2;
        const top = Math.max(r.top + 90 * u, H * 0.17);
        title(String(world.meters), cx, top, 64 * u, 2 * u);
        const label = session.best !== null ? `METERS  ·  BEST ${session.best}` : "METERS";
        const lf = small(11 * u);
        const lw = spacedWidth(press.plate(BLUE), label, lf, 4 * u);
        paperStrip(cx - lw / 2 - 9 * u, top + 12 * u, lw + 18 * u, 18 * u);
        const c = press.plate(BLUE);
        c.fillStyle = press.solid(BLUE);
        spaced(c, label, cx, top + 25 * u, lf, 4 * u);
        capsule("TAP", cx, top + 96 * u, u, BLUE);
      }
      return;
    }
    // Attract: the land is the hero. A poster title, how to play in a line, a quiet prompt.
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const k = clamp(time / 1.0);
    const titleY = Math.max(r.top + 92 * u, H * 0.17) + (1 - easeOutCubic(k)) * 8;
    const px = Math.min(76 * u, (W - r.left - r.right - 40) / 4.2);
    title("LONGHOP", cx, titleY, px, 1.5 * u);
    const tag = "HOLD AS YOU LAND  ·  LET GO TO SPRING";
    const tagFont = small(10 * u);
    const tw = spacedWidth(press.plate(BLUE), tag, tagFont, 2.6 * u);
    paperStrip(cx - tw / 2 - 8 * u, titleY + 14 * u, tw + 16 * u, 17 * u);
    const c = press.plate(BLUE);
    c.fillStyle = press.solid(BLUE);
    spaced(c, tag, cx, titleY + 26 * u, tagFont, 2.6 * u);
    if (session.best !== null && session.best > 0) {
      const o = press.plate(ORANGE);
      o.fillStyle = press.solid(ORANGE);
      spaced(o, `BEST ${session.best} M`, cx, titleY + 46 * u, small(10.5 * u), 4 * u);
    }
    capsule("TAP", cx, titleY + 92 * u, u, BLUE);
    regMark(r.left + 20 * u, r.top + 22 * u, 5 * u);
    regMark(W - r.right - 20 * u, r.top + 22 * u, 5 * u);
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
