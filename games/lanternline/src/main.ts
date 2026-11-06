import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, dampAngle, easeInOutCubic, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { Particles } from "@thumbcade-games/kit/particles";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import { drawChain, drawFigure, drawIsland, drawLantern, drawLine, drawSeed, drawTerrain, glow, hands, visibleX, worldTransform, type Pose, type View } from "./draw.ts";
import { createBackdrop, type Cam } from "./land.ts";
import { alpha, LAMP, LAMP_CORE, mixHex, PALE, SEED, skyAt, type Sky } from "./palette.ts";
import { G, pilot, RANGE, WEAR_MAX, World, WU_PER_M, type Anchor, type Pilot } from "./sim.ts";
import { createSound } from "./sound.ts";
import { light, loadType, medium, spaced } from "./type.ts";

/** Meters per full turn of the sky (dawn → night → dawn). */
const DAY_M = 800;
const DEMO_SEED = 20261017;
/** Stiffness of the figure's bend spring (rad/s). */
const BEND_W = 34;

interface Mote {
  x: number;
  y: number;
  d: number;
  ph: number;
  s: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "lanternline", restartDelayMs: 800 }), loadType()]);
  const view = createCanvas({ maxDpr: 2, background: "#F2C3A3" });
  const { ctx } = view;
  const sound = createSound();
  const backdrop = createBackdrop(7);
  const bursts = new Particles(400);
  const reduced = session.reducedMotion;

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
  });

  // --- world, camera, pose -------------------------------------------------------------------
  let mode: "attract" | "run" = "attract";
  let world = new World({ seed: DEMO_SEED, demo: true });
  let demoLaunchIn = 0.5;
  let demoFade = -1;
  const pil: Pilot = { hold: false, onLine: 0 };
  const baseZ = () => Math.min(H / 820, W / 400);
  const cam: Cam = { x: 0, y: -260, z: baseZ(), drop: 0 };
  let svx = 0;
  const pose: Pose = { x: 0, y: 0, rot: 0, hang: 0, tuck: 0, vx: 0, vy: 0, stand: 1, cloak: 0 };
  let flip = 0;
  let slowT = 0;
  let slowDepth = 0;
  let timeScale = 1;
  /** The first runs' wait for the first press, as a time scale. */
  let wait = 1;
  let veil = 0;
  let time = 0;
  let tod = 0.02;
  let deadReal = -1;
  let ended = false;
  let firstPressAt = -1;
  let hintDone = false;
  let lineGrabT = 9;
  let releaseHand: [number, number] = [0, 0];
  let snapped = false;
  let missT = 9;
  /**
   * Where the drawn figure trails the body after a catch. The line turns a fast fall onto the swing in one physics step;
   * drawing that corner as-is reads as a jolt, so the figure rounds it on a stiff spring (a few wu, gone in ~0.1 s).
   */
  const bend = { x: 0, y: 0, vx: 0, vy: 0 };
  let preVx = 0;
  let preVy = 0;
  let stepDt = 0;
  let shownScore = 0;
  const seedPops: Array<{ x: number; y: number; t: number }> = [];
  const target = new Map<number, number>();

  const bestLamp: Anchor = { id: -2, hx: 0, hy: 0, chain: 11, amp: 0, w: 0, ph: 0, x: 0, y: 0, lit: 1, wear: 0, island: null };
  let bestAtStart = 0;
  const startLamp: Anchor = { id: -1, hx: 0, hy: 0, chain: 13, amp: 0, w: 0, ph: 0, x: 0, y: 0, lit: 1, wear: 0, island: null };
  const motes: Mote[] = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), d: 0.25 + Math.random() * 0.75, ph: Math.random() * 6.28, s: 0.6 + Math.random() }));

  function snapCamera(): void {
    cam.z = baseZ() * (mode === "attract" ? 0.8 : 1);
    cam.x = world.x + W * 0.14 / cam.z;
    cam.y = camTargetY();
    cam.drop = mode === "attract" ? H * 0.16 : 0;
    svx = 0;
  }

  function camTargetY(): number {
    const fy = world.y;
    if (mode === "attract") return -470 + clamp(fy + 260, -80, 80) * 0.15;
    const t = clamp(fy * 0.55 + -360 * 0.45, -1100, -220);
    return !world.alive ? Math.min(t, -150) : t;
  }

  function resetPose(): void {
    pose.x = world.x;
    pose.y = world.y;
    pose.rot = 0;
    pose.hang = 0;
    pose.tuck = 0;
    pose.stand = 1;
    flip = 0;
    lineGrabT = 9;
    missT = 9;
    bend.x = bend.y = bend.vx = bend.vy = 0;
    snapped = false;
    target.clear();
    seedPops.length = 0;
  }

  function newDemo(): void {
    mode = "attract";
    world = new World({ seed: DEMO_SEED, demo: true });
    demoLaunchIn = 0.7;
    demoFade = -1;
    pil.hold = false;
    pil.onLine = 0;
    resetPose();
    snapCamera();
  }

  function newRun(): void {
    mode = "run";
    bestAtStart = session.best ?? 0;
    world = new World({ seed: (session.ctx.seed ^ (session.runs * 7919)) >>> 0 });
    world.launch();
    deadReal = -1;
    ended = false;
    firstPressAt = -1;
    shownScore = 0;
    wait = 1;
    resetPose();
    pose.stand = 0.6;
    snapCamera();
    veil = Math.max(veil, 0.55);
    syncHold();
  }

  // --- input: the first tap starts a run, then pressing anywhere holds the line ----------------
  const down = new Set<number>();
  let key = false;
  const holding = () => down.size > 0 || key;
  function syncHold(): void {
    const on = mode === "run" && session.phase === "playing" && holding();
    world.setHold(on);
    if (on && firstPressAt < 0) firstPressAt = world.time;
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

  function handleEvents(): void {
    const level = mode === "run" ? 1 : 0.45;
    for (const e of world.drain()) {
      switch (e.k) {
        case "grab": {
          lineGrabT = 0;
          bend.vx += preVx - world.vx;
          bend.vy += preVy + G * stepDt - world.vy;
          snapped = false;
          sound.grab(Math.min(10, world.flow + (e.anchor.y < -380 ? 2 : 0)), level);
          if (e.anchor.lit <= 0.02) {
            bursts.emit(e.anchor.x, e.anchor.y, { count: 10, speed: [10, 50], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.6, 1.4], size: [0.8, 1.8], colors: [LAMP, LAMP_CORE], gravity: -12, drag: 1.5, shape: "circle" });
          }
          if (e.low && mode === "run") slow(0.6, 0.6);
          if (mode === "run") session.feedback("tap");
          if (!hintDone && mode === "run") hintDone = world.grabs >= 2;
          break;
        }
        case "release": {
          releaseHand = hands(pose);
          sound.release(e.good, world.flow, level);
          if (e.good && world.flow >= 3 && !reduced && e.speed > 380 && flip === 0) flip = Math.PI * 2;
          break;
        }
        case "snap":
          snapped = true;
          releaseHand = hands(pose);
          sound.snap();
          bursts.emit(e.anchor.x, e.anchor.y + 12, { count: 6, speed: [10, 40], life: [0.4, 0.9], size: [0.6, 1.2], colors: [mixHex(skyNow.ink, LAMP, 0.4)], gravity: 60, shape: "circle" });
          break;
        case "seed": {
          sound.seed(e.chain);
          seedPops.push({ x: e.x, y: e.y, t: 0 });
          bursts.emit(e.x, e.y, { count: 9, speed: [20, 70], life: [0.5, 1.1], size: [0.8, 1.8], colors: [SEED, "#FFFFFF"], drag: 2.2, gravity: -10, shape: "circle", vx: world.vx * 0.3, vy: world.vy * 0.3 });
          break;
        }
        case "near":
          if (mode === "run") {
            slow(0.68, 0.8);
            sound.near();
          }
          break;
        case "miss":
          missT = 0;
          if (mode === "run") sound.miss();
          break;
        case "die":
          if (mode === "run") {
            sound.fall();
            slow(0.7, 0.9);
            session.feedback("impact");
          }
          bursts.emit(world.x, world.y, { count: 14, speed: [30, 120], angle: [-Math.PI, 0], life: [0.5, 1.2], size: [1, 2.6], colors: [skyNow.ink], gravity: 220, drag: 1, shape: "circle" });
          break;
      }
    }
  }

  /** New players get a word of help and a moment of slowed time on their first runs. */
  const tutorial = () => session.runs <= 2 && bestAtStart < 40;

  // --- update -----------------------------------------------------------------------------------
  let skyNow: Sky = skyAt(tod);

  function update(dt: number): void {
    session.tick(dt);
    time += dt;
    veil = Math.max(0, veil - dt * 1.6);
    // Slow motion: in fast, out slow.
    let goal = 1;
    if (slowT > 0) {
      slowT = Math.max(0, slowT - dt);
      goal = 1 - slowDepth * easeInOutCubic(Math.min(1, slowT / 0.45));
    }
    // First runs: time waits a little for the first press. It eases in over the top of the leap and back out on the press.
    const waiting = mode === "run" && tutorial() && firstPressAt < 0 && world.alive && world.time > 0.32 && world.vy > 0;
    wait = damp(wait, waiting ? 0.42 : 1, waiting ? 5 : 10, dt);
    goal = Math.min(goal, wait);
    // "Fast" is a few frames, not one: a one-frame drop in speed reads as a hitch.
    timeScale = goal < timeScale ? damp(timeScale, goal, 28, dt) : goal;
    const scale = timeScale;

    if (mode === "attract") {
      demoLaunchIn -= dt;
      if (world.standing && demoLaunchIn <= 0) world.launch();
      world.setHold(pilot(world, pil, dt * scale));
      if (!world.alive) {
        if (demoFade < 0) demoFade = 0;
        demoFade += dt;
        if (demoFade > 1.2) veil = Math.min(1, veil + dt * 4);
        if (demoFade > 1.6) newDemo();
      }
    }
    preVx = world.vx;
    preVy = world.vy;
    stepDt = dt * scale;
    world.update(stepDt);
    handleEvents();

    // Game over: report within the second.
    if (mode === "run" && !world.alive) {
      if (deadReal < 0) deadReal = 0;
      deadReal += dt;
      if (!ended && deadReal >= 0.75) {
        ended = true;
        session.end(world.meters, {
          outcome: "lose",
          stats: { meters: Math.floor(world.distanceM), lanterns: world.grabs, seeds: world.seedsTaken, clean: world.goodReleases },
        });
      }
    }

    // Sky: dawn in the demo, then the day turns with distance.
    const want = mode === "attract" ? 0.025 + Math.sin(time * 0.05) * 0.012 : 0.02 + world.distanceM / DAY_M;
    tod = mode === "attract" ? want : damp(tod, want, 0.8, dt);
    skyNow = skyAt(tod);

    // Camera: long easing, a lead in the direction of travel, a gentle zoom-out with speed.
    const z0 = baseZ();
    svx = damp(svx, world.alive ? world.vx : 0, 1.6, dt);
    const lead = (W * (mode === "attract" ? 0.13 : 0.15)) / cam.z + svx * 0.34;
    cam.x = damp(cam.x, world.x + lead, 3.6, dt);
    cam.y = damp(cam.y, camTargetY(), 2.2, dt);
    cam.drop = damp(cam.drop, mode === "attract" ? H * 0.16 : 0, 2, dt);
    const zk = reduced ? 0.04 : 0.16;
    const zBase = mode === "attract" ? z0 * 0.8 : z0;
    cam.z = damp(cam.z, zBase * (1 - zk * clamp((world.speed - 280) / 600)), mode === "attract" ? 3 : 0.9, dt);

    // Pose. The bend spring is critically damped and solved exactly, so a long frame can't make it overshoot.
    const e = Math.exp(-BEND_W * stepDt);
    const kx = (bend.vx + BEND_W * bend.x) * stepDt;
    const ky = (bend.vy + BEND_W * bend.y) * stepDt;
    bend.x = (bend.x + kx) * e;
    bend.y = (bend.y + ky) * e;
    bend.vx = (bend.vx - BEND_W * kx) * e;
    bend.vy = (bend.vy - BEND_W * ky) * e;
    pose.x = world.x + bend.x;
    pose.y = world.y + bend.y;
    pose.vx = world.vx;
    pose.vy = world.vy;
    pose.cloak += dt;
    pose.stand = world.standing ? 1 : damp(pose.stand, 0, 9, dt);
    const t = world.tether;
    if (!world.alive) {
      pose.rot += dt * (3.2 + Math.abs(world.vx) * 0.004) * (world.deadT < 1.4 ? 1 : 0.2);
      pose.hang = damp(pose.hang, 0, 8, dt);
      pose.tuck = damp(pose.tuck, 1, 5, dt);
    } else if (t) {
      flip = 0;
      pose.rot = dampAngle(pose.rot, Math.atan2(t.anchor.x - world.x, -(t.anchor.y - world.y)), 16, dt);
      pose.hang = damp(pose.hang, 1, 16, dt);
      pose.tuck = damp(pose.tuck, 0.15, 6, dt);
    } else {
      if (flip > 0) flip = Math.max(0, flip - dt * Math.PI * 2 * 1.15);
      const lean = clamp(world.vx * 0.0006, -0.4, 0.45) + clamp(world.vy * 0.0004, -0.2, 0.25);
      // A slow forward somersault after a run of clean releases.
      pose.rot = flip > 0 ? lean + (Math.PI * 2 - flip) : dampAngle(pose.rot, lean, 5, dt);
      pose.hang = damp(pose.hang, 0, 9, dt);
      pose.tuck = damp(pose.tuck, world.standing ? 0 : world.vy < 0 ? 0.85 : 0.25, 4.5, dt);
    }
    lineGrabT += dt;
    missT += dt;
    for (const p of seedPops) p.t += dt;
    while (seedPops.length && seedPops[0]!.t > 0.8) seedPops.shift();
    bursts.update(dt * scale);

    // Which lantern a press would reach right now (it wakes a little).
    const tgt = world.alive && !t && !world.standing ? world.target() : null;
    for (const a of world.anchors) {
      const k = target.get(a.id) ?? 0;
      const v = damp(k, a === tgt ? 1 : 0, 10, dt);
      if (v > 0.01 || k > 0.01) target.set(a.id, v);
    }

    if (mode === "run" && session.phase === "playing") shownScore = world.meters;
    sound.update(world.alive ? world.speed : 0, mode === "run" ? 1 : 0.5);

    // Ambient motes drift against the camera.
    for (const m of motes) {
      m.x -= (dt * (0.012 + m.d * 0.02) + (world.vx * dt * cam.z * m.d * 0.35) / W) * (world.alive ? 1 : 0.3);
      m.y += dt * (Math.sin(time * 0.4 + m.ph) * 0.006 - 0.004);
      if (m.x < -0.05) m.x += 1.1;
      if (m.y < -0.05) m.y += 1.1;
      if (m.y > 1.05) m.y -= 1.1;
    }
  }

  // --- render -----------------------------------------------------------------------------------
  function textColor(sky: Sky, a: number): string {
    return alpha(mixHex(sky.ink, PALE, sky.night), a);
  }

  /** "tap" (or another word) with a thin line under it that breathes. */
  function prompt(word: string, x: number, y: number, sky: Sky, u: number): void {
    const breathe = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * 1.6);
    ctx.fillStyle = textColor(sky, 0.82);
    spaced(ctx, word, x + 3 * u, y, light(16 * u), 7 * u);
    const lw = (14 + 26 * breathe) * u;
    ctx.fillStyle = textColor(sky, 0.4 + 0.4 * breathe);
    ctx.fillRect(x - lw / 2, y + 12 * u, lw, Math.max(1, 1.1 * u));
  }

  function render(): void {
    const sky = skyNow;
    const dpr = view.dpr;
    view.begin();
    backdrop.draw(ctx, W, H, cam, sky, tod, time);

    // Mist rising out of the depths behind the playfield.
    const gy = (0 - cam.y) * cam.z + H / 2;
    const mist = ctx.createLinearGradient(0, gy - 70 * cam.z, 0, H);
    mist.addColorStop(0, alpha(sky.fog, 0));
    mist.addColorStop(0.5, alpha(sky.fog, 0.55));
    mist.addColorStop(1, alpha(sky.fog, 0.9));
    ctx.fillStyle = mist;
    ctx.fillRect(0, gy - 70 * cam.z, W, H);

    const v: View = { W, H, cam, sky, time };
    worldTransform(ctx, dpr, W, H, cam);
    const [x0, x1] = visibleX(v, 120);

    // Best: a little lamp post planted at your farthest point.
    const best = bestAtStart;
    if (mode === "run" && best > 0) {
      const bx = best * WU_PER_M;
      if (bx > x0 && bx < x1) {
        const by = Math.min(world.groundY(bx), 60);
        ctx.fillStyle = sky.ink;
        ctx.fillRect(bx - 1, by - 120, 2, 124);
        ctx.fillRect(bx - 1, by - 120, 14, 1.6);
        bestLamp.hx = bestLamp.x = bx + 12;
        bestLamp.hy = by - 119;
        bestLamp.y = by - 108;
        drawLantern(ctx, bestLamp, v, 0, true);
      }
    }

    for (const isl of world.islands) if (isl.maxX > x0 && isl.minX < x1) drawIsland(ctx, isl, v);
    for (const a of world.anchors) {
      if (a.x < x0 || a.x > x1) continue;
      drawChain(ctx, a, v);
    }
    for (const a of world.anchors) {
      if (a.x < x0 || a.x > x1) continue;
      drawLantern(ctx, a, v, target.get(a.id) ?? 0, world.demo);
    }
    drawTerrain(ctx, world, v);
    // The lamp post the lamplighter sets out from.
    if (x0 < -40) {
      const gy0 = world.groundY(-74);
      ctx.fillStyle = sky.ink;
      ctx.fillRect(-75.2, gy0 - 78, 2.4, 80);
      ctx.fillRect(-75.2, gy0 - 78, 17, 1.8);
      ctx.fillRect(-77.5, gy0 - 2, 7, 3);
      startLamp.hx = startLamp.x = -60;
      startLamp.hy = gy0 - 77;
      startLamp.y = gy0 - 64;
      drawLantern(ctx, startLamp, v, 0, true);
    }

    for (const s of world.seeds) {
      if (s.x < x0 || s.x > x1 || s.taken) continue;
      drawSeed(ctx, s.x, s.y, time, s.ph, 1, sky);
    }
    for (const p of seedPops) glow(ctx, SEED, p.x, p.y, 14 + p.t * 50, (1 - p.t / 0.8) * 0.6);

    // The line.
    const hand = hands(pose);
    const t = world.tether;
    if (t) {
      const a = t.anchor;
      const wearLeft = world.demo ? 9 : WEAR_MAX - a.wear;
      drawLine(ctx, hand, [a.x, a.y + 9], sky, {
        reach: easeOutCubic(Math.min(1, lineGrabT / 0.08)),
        slack: 0,
        alpha: wearLeft < 1.2 ? 0.55 + 0.45 * (wearLeft / 1.2) : 1,
        tremble: wearLeft < 1.2 ? (1 - wearLeft / 1.2) * 1.4 : 0,
        time,
      });
    } else if (world.lastAnchor && world.sinceRelease < 0.45) {
      const a = world.lastAnchor;
      const k = easeOutCubic(world.sinceRelease / 0.45);
      const endX = lerp(releaseHand[0], a.x + (snapped ? 4 : 0), k);
      const endY = lerp(releaseHand[1], a.y + (snapped ? 40 : 22), k);
      drawLine(ctx, [a.x, a.y + 9], [endX, endY], sky, { reach: 1, slack: 14 * (1 - k) + (snapped ? 10 : 0), alpha: 1 - k, tremble: 0, time });
    }
    if (missT < 0.4 && world.alive) {
      const k = missT / 0.4;
      const len = RANGE * 0.42 * Math.sin(k * Math.PI);
      drawLine(ctx, hand, [hand[0] + Math.cos(-0.95) * len, hand[1] + Math.sin(-0.95) * len + k * 30], sky, { reach: 1, slack: 8 * k, alpha: 0.7 * (1 - k), tremble: 0, time });
    }

    drawFigure(ctx, pose, sky, time, world.alive ? 1 : Math.max(0, 1 - world.deadT));
    bursts.draw(ctx);

    // Screen space from here.
    view.begin();
    // Mist pooling over the foot of the near ground, so it sits in the air instead of on the screen edge.
    const foot = gy + 40 * cam.z;
    if (foot < H) {
      const pool = ctx.createLinearGradient(0, foot, 0, H);
      pool.addColorStop(0, alpha(sky.fog, 0));
      pool.addColorStop(1, alpha(sky.fog, 0.32));
      ctx.fillStyle = pool;
      ctx.fillRect(0, foot, W, H - foot);
    }
    // Pollen by day, fireflies by night.
    const night = sky.night;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i]!;
      const x = m.x * W;
      const y = m.y * H;
      if (i % 2 === 0 && night > 0.2) {
        const pulse = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(time * (0.8 + m.d) + m.ph);
        glow(ctx, "#E8F2A0", x, y + Math.sin(time * 0.9 + m.ph) * 6, 6 + m.d * 5, night * pulse * 0.8 * (y > H * 0.35 ? 1 : 0.4));
      } else if (i % 3 !== 1) {
        ctx.fillStyle = alpha(mixHex(sky.horizon, "#FFFFFF", 0.5), (1 - night * 0.8) * 0.4 * m.d);
        ctx.beginPath();
        ctx.arc(x, y + Math.sin(time * 0.7 + m.ph) * 5, 0.5 + m.s * m.d * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawUi(sky);
    if (veil > 0) {
      ctx.fillStyle = alpha(sky.horizon, easeInOutCubic(Math.min(1, veil)));
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawUi(sky: Sky): void {
    const u = clamp(Math.min(W / 390, H / 760), 0.85, 1.5);
    const phase = session.phase;
    if (mode === "run") {
      if (phase === "playing") {
        const top = session.play().top;
        ctx.fillStyle = textColor(sky, 0.85);
        spaced(ctx, String(shownScore), W / 2 + 2 * u, top + 46 * u, light(30 * u), 4 * u);
        // First runs: a word or two, then silence.
        if (tutorial() && !hintDone && world.alive) {
          const hy = top + 100 * u;
          if (!world.tether && world.time > 0.25) prompt("hold", W / 2, hy, sky, u);
          else if (world.tether && world.grabs <= 2 && world.releaseWindow().good && world.x > world.tether.anchor.x + 10) prompt("let go", W / 2, hy, sky, u);
        }
      } else if (phase === "over" && session.standalone && session.phaseTime > 0.8) {
        // A bare tab has no result card: the result sits in the open sky, the prompt under it.
        const r = session.preview();
        const cx = r.left + (W - r.left - r.right) / 2;
        const top = Math.max(r.top + 70 * u, H * 0.16);
        ctx.fillStyle = textColor(sky, 0.9);
        spaced(ctx, String(world.meters), cx + 3 * u, top, light(52 * u), 6 * u);
        ctx.fillStyle = textColor(sky, 0.6);
        spaced(ctx, "meters", cx + 3 * u, top + 26 * u, light(11 * u), 6 * u);
        if (session.best !== null) spaced(ctx, `best ${session.best}`, cx + 2.5 * u, top + 46 * u, light(11 * u), 5 * u);
        prompt("tap", cx, top + 104 * u, sky, u);
      }
      return;
    }
    // Attract: the world is the hero. A small word in the sky, a quiet prompt below.
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const k = clamp(time / 1.2);
    // Low in the open sky above the ruins; the prompt waits under it.
    const titleY = Math.max(r.top + 46 * u, H * 0.2);
    ctx.fillStyle = textColor(sky, 0.84 * k);
    spaced(ctx, "lanternline", cx + 5 * u, titleY + (1 - easeOutCubic(k)) * 6, light(25 * u), 10 * u);
    if (session.best !== null && session.best > 0) {
      ctx.fillStyle = textColor(sky, 0.55 * k);
      // The one place Jost Medium appears: tiny text needs the extra weight to hold up over the sky.
      spaced(ctx, `best ${session.best} m`, cx + 2.5 * u, titleY + 28 * u, medium(10 * u), 5 * u);
    }
    prompt("tap", cx, titleY + 78 * u, sky, u);
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
