import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeInOutCubic, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createSession } from "@thumbcade-games/kit/session";
import { Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import boldUrl from "@thumbcade-games/kit/assets/fonts/library/caveat/Caveat-Bold.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/caveat/Caveat-Medium.woff2?url";
import {
  drawBird,
  drawClouds,
  drawColumnBack,
  drawColumnSmoke,
  drawGust,
  drawHoop,
  drawKite,
  drawPageBreaks,
  drawPlane,
  drawRules,
  drawSkyNotes,
  drawStar,
  drawStorm,
  drawTrail,
  drawWire,
  Ground,
  renderGrain,
  speedDashes,
  visible,
  worldTransform,
  type Cam,
  type PlanePose,
  type View,
} from "./draw.ts";
import { loadFonts } from "./fonts.ts";
import { Fx } from "./fx.ts";
import { bold, boil, doodleArrow, FAMILY, hand, highlight, line, PAL, updateBoil, write } from "./ink.ts";
import { newPilot, pilot, VT, World, type Gust, type PilotSkill } from "./sim.ts";
import { createSound } from "./sound.ts";

const DEMO_SEED = 20261023;
/** The attract demo flies a little lighter than the playtest pilot, and loops when it can afford to. */
const DEMO_SKILL: PilotSkill = { horizon: 2.4, period: 0.14, noise: 0, delay: 0, showoff: true };
const TRAIL = 110;

async function main() {
  const fonts = loadFonts([
    { family: FAMILY, url: boldUrl, descriptors: { weight: "700" } },
    { family: FAMILY, url: mediumUrl, descriptors: { weight: "500" } },
  ]);
  const [session] = await Promise.all([createSession({ id: "pagewing", restartDelayMs: 800 }), fonts]);
  const view = createCanvas({ maxDpr: 2, background: PAL.paper });
  const { ctx } = view;
  const sound = createSound();
  const fx = new Fx();
  const reduced = session.reducedMotion;
  const light = new Photosafe(reduced);
  const shake = new Shake(7, 0.016, 2.6, reduced);

  let W = view.width;
  let H = view.height;
  let grain = renderGrain(W, H, view.dpr);
  const baseZ = () => clamp(Math.min(W / 440, H / 880), 0.55, 1.4);
  const bakeScale = () => Math.min(2, view.dpr) * baseZ();
  view.onResize((w, h) => {
    W = w;
    H = h;
    grain = renderGrain(W, H, view.dpr);
  });

  // --- world, camera, pose -------------------------------------------------------------------
  let mode: "attract" | "run" = "attract";
  let world = new World({ seed: DEMO_SEED, demo: true });
  const ground = new Ground(world);
  let pil = newPilot(7);
  const cam: Cam = { x: 0, y: -260, z: baseZ() };
  const pose: PlanePose = { x: 0, y: 0, pitch: 0, flutter: 0, crumple: 0, seed: 1 };
  const trail = new Float32Array(TRAIL * 2);
  let trailHead = 0;
  let trailCount = 0;
  let trailT = 0;
  let time = 0;
  let veil = 0;
  let slowT = 0;
  let slowDepth = 0;
  let deadReal = -1;
  let ended = false;
  let demoFade = -1;
  let demoLoop = 0;
  let demoOpened = false;
  let lastGust: Gust | null = null;
  let shownScore = 0;
  let bestAtStart = 0;
  let firstPressAt = -1;
  let stallHint = 0;
  let liftHint = 0;
  let gustHint = 0;
  let runT = 0;

  function camTarget(): { x: number; y: number } {
    const b = world.body;
    const z = cam.z;
    const lead = (W * (mode === "attract" ? 0.08 : 0.17)) / z + (world.alive ? b.vx * 0.22 : 0);
    const g = world.groundY(b.x + 160);
    const alt = g - b.y;
    let y: number;
    if (alt <= 0.5 * (H / z)) y = g - 0.34 * (H / z);
    else y = b.y + 0.16 * (H / z);
    if (mode === "attract") y -= 0.04 * (H / z);
    return { x: b.x + lead, y };
  }

  function snapCamera(): void {
    cam.z = baseZ();
    const t = camTarget();
    cam.x = t.x;
    cam.y = t.y;
  }

  function resetTrail(): void {
    trailHead = 0;
    trailCount = 0;
  }

  function newDemo(): void {
    mode = "attract";
    world = new World({ seed: DEMO_SEED, demo: true });
    ground.reset(world);
    pil = newPilot(7);
    demoFade = -1;
    demoLoop = 0;
    demoOpened = false;
    lastGust = null;
    pose.crumple = 0;
    fx.clear();
    resetTrail();
    snapCamera();
  }

  function newRun(): void {
    mode = "run";
    bestAtStart = session.best ?? 0;
    world = new World({ seed: (session.ctx.seed ^ (session.runs * 7919)) >>> 0 });
    ground.reset(world);
    deadReal = -1;
    ended = false;
    shownScore = 0;
    firstPressAt = -1;
    stallHint = 0;
    liftHint = 0;
    gustHint = 0;
    runT = 0;
    pose.crumple = 0;
    fx.clear();
    resetTrail();
    snapCamera();
    veil = Math.max(veil, 0.6);
    sound.throw();
    fx.mark("whoosh", world.body.x - 20, world.body.y, 26, PAL.graphite, 0.5);
    syncHold();
  }

  // --- input: the first tap throws, then pressing anywhere pulls the nose up ------------------------
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
    // A press that began before the run (the throw tap) never counts as a hold.
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

  /** New players get words of help on their first runs. */
  const tutorial = () => session.runs <= 2 && bestAtStart < 60;

  // --- events → sound, notes, slow motion -------------------------------------------------------
  function slow(depth: number, seconds: number): void {
    slowDepth = Math.max(slowDepth * (slowT > 0 ? 1 : 0), depth * (reduced ? 0.4 : 1));
    slowT = Math.max(slowT, seconds);
  }

  function handleEvents(): void {
    const run = mode === "run";
    for (const e of world.drain()) {
      switch (e.k) {
        case "star":
          if (run) sound.star(e.chain);
          fx.mark("check", e.x + 6, e.y, 9, PAL.red, 0.7);
          fx.bit("star", e.x, e.y, { count: 5, speed: [30, 90], life: [0.4, 0.8], size: [3, 5], color: PAL.ink, grav: 120 });
          if (run) fx.note("+5", e.x, e.y - 16, PAL.red, 22, 0.9, 0, 26);
          break;
        case "hoop":
          if (run) {
            sound.hoop();
            session.feedback("tap");
            fx.note("nice!", e.x, e.y - 44, PAL.red, 30, 1.1, -0.08);
          }
          fx.mark("ring", e.x, e.y, 30, PAL.red, 0.6);
          break;
        case "loop":
          if (run) {
            sound.loop(e.count);
            if (e.pays) {
              session.feedback("tap");
              fx.note(e.hoop ? "loop the hoop!" : e.count > 1 ? `loop #${e.count}!` : "loop!", e.x, e.y - 50, PAL.ink, e.hoop ? 32 : 30, 1.2, -0.06);
              fx.note(e.hoop ? "+30" : "+15", e.x + 30, e.y - 18, PAL.red, 22, 1.1, 0.1, 24);
            }
          }
          fx.mark("whoosh", e.x, e.y, 30, PAL.graphite, 0.6, Math.atan2(world.body.vy, world.body.vx));
          break;
        case "stall":
          if (run) {
            sound.stall();
            if (stallHint < 2 && tutorial()) {
              stallHint++;
              fx.note("too slow! let go", e.x + 20, e.y + 64, PAL.red, 26, 1.8, -0.05, -10);
            } else fx.note("whoa", e.x - 10, e.y - 30, PAL.graphite, 22, 0.8, -0.1, 16);
          }
          break;
        case "lift":
          if (run) sound.lift();
          if (run && liftHint < 1 && tutorial() && !world.holding) {
            liftHint++;
            fx.note("hold to ride it up!", world.body.x + 30, world.body.y + 70, PAL.ink, 26, 2, -0.05, -10);
          }
          break;
        case "gust":
          if (run) {
            sound.gust();
            if (gustHint < 1 && tutorial() && !world.holding) {
              gustHint++;
              fx.note("now hold: loop!", world.body.x + 60, world.body.y + 64, PAL.ink, 26, 1.8, -0.05, -10);
            }
          }
          fx.mark("whoosh", world.body.x - 18, world.body.y, 30, PAL.graphite, 0.5, Math.atan2(world.body.vy, world.body.vx));
          break;
        case "near":
          if (run) {
            slow(0.62, 0.75);
            sound.near();
          }
          break;
        case "page":
          if (run) {
            sound.page();
            fx.note(`page ${e.page}!`, world.body.x + 30, world.body.y - 60, PAL.graphite, 24, 1.2, -0.05);
          }
          break;
        case "crash": {
          const b = world.body;
          pose.seed = Math.floor(Math.random() * 1e6);
          if (run) {
            sound.crash(e.soft);
            slow(e.soft ? 0.3 : 0.6, e.soft ? 0.4 : 0.8);
            session.feedback("impact");
            if (!e.soft) shake.add(0.6);
          }
          if (e.soft) {
            fx.note("landed.", b.x, b.y - 40, PAL.ink, 30, 2.4, -0.05, 14);
            fx.mark("check", b.x + 40, b.y - 50, 12, PAL.red, 2.2);
          } else {
            const word = e.how === "water" ? "splash!" : e.how === "bird" ? "sorry bird" : e.how === "wire" || e.how === "kite" ? "tangled!" : "ouch!";
            fx.note(word, b.x, b.y - 40, PAL.red, 32, 2.2, -0.08, 18);
            fx.mark("burst", b.x, b.y, 22, PAL.red, 0.45);
            fx.bit("scrap", b.x, b.y, { count: 7, speed: [60, 180], life: [0.6, 1.2], size: [3, 6], color: PAL.paper, grav: 500 });
          }
          break;
        }
      }
    }
  }

  // --- update -----------------------------------------------------------------------------------
  function update(dt: number): void {
    session.tick(dt);
    time += dt;
    updateBoil(time, reduced);
    veil = Math.max(0, veil - dt * 1.6);
    shake.update(dt);
    let scale = 1;
    if (slowT > 0) {
      slowT = Math.max(0, slowT - dt);
      scale = 1 - slowDepth * easeInOutCubic(Math.min(1, slowT / 0.45));
    }

    if (mode === "attract") {
      // The demo's party trick: fresh out of a gust with room below, it pulls a loop (through the hoop ahead).
      const g = world.inGust;
      const room = world.groundY(world.body.x) - world.body.y > 230;
      if (!g && lastGust && world.speed > VT * 1.4 && room) demoLoop = 1.3;
      // …and it opens with one: the throw is fast enough to loop.
      if (!demoOpened && world.time > 0.3 && world.speed > VT * 1.38 && room) {
        demoOpened = true;
        demoLoop = 1.3;
      }
      lastGust = g;
      if (demoLoop > 0) {
        demoLoop -= dt * scale;
        world.setHold(true);
      } else world.setHold(pilot(world, pil, dt * scale, DEMO_SKILL));
      if (!world.alive) {
        if (demoFade < 0) demoFade = 0;
        demoFade += dt;
        if (demoFade > 1.4) veil = Math.min(1, veil + dt * 4);
        if (demoFade > 1.8) newDemo();
      }
    } else if (world.alive && session.phase === "playing") runT += dt;
    world.update(dt * scale);
    handleEvents();

    // Game over: report within the second.
    if (mode === "run" && !world.alive) {
      if (deadReal < 0) deadReal = 0;
      deadReal += dt;
      if (!ended && deadReal >= 0.75) {
        ended = true;
        session.end(world.meters, {
          outcome: "lose",
          stats: { meters: Math.floor(world.distanceM), stars: world.starsTaken, loops: world.loops, hoops: world.hoops },
        });
      }
    }

    // Camera: leads the flight, eases, pulls back a little at speed.
    const b = world.body;
    const sp = world.alive ? world.speed : 0;
    const zk = reduced ? 0.04 : 0.15;
    cam.z = damp(cam.z, baseZ() * (1 - zk * clamp((sp - VT) / (VT * 1.4))), 1.2, dt);
    const t = camTarget();
    cam.x = damp(cam.x, t.x, 3.4, dt);
    cam.y = damp(cam.y, t.y, 2.4, dt);

    // Pose.
    pose.x = b.x;
    pose.y = b.y;
    pose.pitch = b.pitch;
    pose.flutter = damp(pose.flutter, b.stalled && world.alive ? 1 : 0, 10, dt);
    pose.crumple = !world.alive && !world.soft ? Math.min(1, pose.crumple + dt * 5) : pose.crumple;

    // The pencil trail.
    trailT += dt * scale;
    if (world.alive && trailT > 1 / 40) {
      trailT = 0;
      trailHead = (trailHead + 1) % TRAIL;
      trail[trailHead * 2] = b.x - Math.cos(b.pitch) * 16;
      trail[trailHead * 2 + 1] = b.y + Math.sin(b.pitch) * 16;
      trailCount = Math.min(TRAIL, trailCount + 1);
    }

    fx.update(dt * scale);
    if (mode === "run" && session.phase === "playing") shownScore = world.meters;
    sound.update(world.alive ? sp : 0, mode === "run" ? 1 : 0.45);
    ground.prepare(view_(), bakeScale(), 1);
  }

  function view_(): View {
    return { W, H, cam, time, dpr: view.dpr };
  }

  // --- render -----------------------------------------------------------------------------------
  function render(): void {
    const v = view_();
    view.begin();
    ctx.drawImage(grain, 0, 0, W, H);
    drawRules(ctx, v);
    drawPageBreaks(ctx, v, mode === "run" ? session.play().top + 8 : null);

    const o = shake.offset;
    worldTransform(ctx, v, o.x, o.y);
    const [x0, x1] = visible(v, 120);
    drawSkyNotes(ctx, v);
    drawClouds(ctx, v);
    const labelFirst = mode === "attract" || tutorial();
    for (const c of world.columns) if (c.x > x0 - 80 && c.x < x1 + 80) drawColumnBack(ctx, c, v, labelFirst && c === world.columns[0] && world.body.x < c.x + 300);
    ground.draw(ctx, v);
    for (const c of world.columns) if (c.x > x0 - 80 && c.x < x1 + 80) drawColumnSmoke(ctx, c, v, reduced);
    for (const s of world.storms) if (s.x + s.w > x0 && s.x - s.w < x1) drawStorm(ctx, s, v, reduced);
    for (const g of world.gusts) if (g.x1 > x0 && g.x0 < x1) drawGust(ctx, g, v, labelFirst && g === world.gusts[0], reduced);
    for (const w of world.wires) if (w.x1 > x0 && w.x0 < x1) drawWire(ctx, world, w);
    for (const k of world.kites) if (Math.max(k.kx, k.ax) + 40 > x0 && Math.min(k.kx, k.ax) - 40 < x1) drawKite(ctx, world, k, world.time);
    for (const b of world.birds) {
      const bx = world.birdX(b, world.time);
      if (bx > x0 && bx < x1) drawBird(ctx, world, b, world.time);
    }
    for (const s of world.stars) if (!s.taken && s.x > x0 && s.x < x1) drawStar(ctx, s, time);
    for (const h of world.hoopList) if (h.x > x0 && h.x < x1) drawHoop(ctx, h, "back");
    drawTrail(ctx, trail, trailCount, trailHead, TRAIL);
    if (world.alive) speedDashes(ctx, world.body, clamp((world.speed - VT * 1.5) / (VT * 0.8)), 4500 + (boil.step % 3));
    drawPlane(ctx, pose, time);
    for (const h of world.hoopList) if (h.x > x0 && h.x < x1) drawHoop(ctx, h, "front");
    fx.drawMarks(ctx);
    fx.drawBits(ctx);
    fx.drawNotes(ctx);

    view.begin();
    drawUi();
    if (veil > 0) {
      ctx.fillStyle = PAL.paper;
      ctx.globalAlpha = easeInOutCubic(Math.min(1, veil));
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /** A highlighted word with a doodled arrow to what it's about. */
  function promptWord(text: string, cx: number, cy: number, size: number, arrowTo: { x: number; y: number } | null): void {
    ctx.font = bold(size);
    const tw = ctx.measureText(text).width;
    const breathe = 1 + (light.pulse(time, 0.9, { still: 0.5 }) - 0.5) * 0.05;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(breathe, breathe);
    ctx.rotate(-0.05);
    highlight(ctx, -tw / 2 - 8, -size * 0.66, tw + 16, size * 0.78, 2101 + (boil.step % 3), PAL.hiYellow, 0.6);
    write(ctx, text, 0, 0, bold(size), PAL.ink, 2102, { align: "center" });
    ctx.restore();
    if (arrowTo) {
      // From the end of the word that's nearest, never across it.
      const up = arrowTo.y < cy;
      const sx = cx + (arrowTo.x < cx ? -tw / 2 - 4 : tw / 2 + 4);
      const sy = cy + (up ? -size * 0.75 : 10);
      const bend = Math.min(50, Math.hypot(arrowTo.x - sx, arrowTo.y - sy) * 0.2);
      doodleArrow(ctx, sx, sy, arrowTo.x, arrowTo.y, bend, 2103, { width: 2, head: 11 });
    }
  }

  /** Screen position of a world point. */
  function toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - cam.x) * cam.z + W / 2, y: (y - cam.y) * cam.z + H / 2 };
  }

  function drawUi(): void {
    const phase = session.phase;
    if (mode === "run") {
      if (phase === "playing") {
        const top = session.play().top;
        const right = W - 24;
        const txt = String(shownScore);
        write(ctx, txt, right - 22, top + 58, bold(50), PAL.ink, 1701, { align: "right" });
        write(ctx, "m", right, top + 58, hand(26), PAL.ink, 1702, { align: "right" });
        ctx.font = bold(50);
        const tw = ctx.measureText(txt).width;
        line(ctx, right - 22 - tw - 4, top + 68, right + 2, top + 66, 1703, { color: PAL.red, width: 2.2 });
        if (world.starsTaken > 0) write(ctx, `★ ${world.starsTaken}`, right, top + 96, bold(24), PAL.graphite, 1704, { align: "right" });
        // First runs: what to do, in pencil, next to the plane.
        if (tutorial() && world.alive) {
          const p = toScreen(world.body.x, world.body.y);
          if (firstPressAt < 0 && runT > 0.5) {
            write(ctx, "hold to pull up", p.x - 10, p.y + 70, hand(26), PAL.graphite, 1801, { align: "center" });
            doodleArrow(ctx, p.x - 40, p.y + 52, p.x - 16, p.y + 18, -8, 1802, { color: PAL.graphite, width: 1.6, passes: 1, head: 9 });
          } else if (world.holding && world.speed < VT * 0.75 && runT < 25) {
            write(ctx, "let go to glide", p.x, p.y + 64, hand(24), PAL.graphite, 1803, { align: "center" });
          }
        }
      } else if (phase === "over" && session.standalone && session.phaseTime > 0.8) {
        const r = session.preview();
        const cx = r.left + (W - r.left - r.right) / 2;
        const top = Math.max(r.top + 90, H * 0.2);
        write(ctx, world.soft ? `landed at ${world.meters} m` : `crumpled at ${world.meters} m`, cx, top, bold(40), PAL.ink, 1901, { align: "center", rot: -0.03 });
        if (session.best !== null) write(ctx, `best: ${session.best} m`, cx, top + 42, hand(26), PAL.red, 1902, { align: "center", rot: 0.02 });
        promptWord("tap to fold another", cx, top + 112, 32, null);
      }
      return;
    }
    // Attract: a notebook heading, underlined twice, and the throw prompt.
    const pv = session.preview();
    const x = Math.max(24, pv.left + 24);
    const maxW = W - pv.right - x - 12;
    ctx.font = bold(64);
    const w64 = ctx.measureText("Pagewing").width;
    const size = Math.min(64, (64 * maxW) / w64);
    const tw = (w64 * size) / 64;
    const by = Math.max(pv.top + 70, H * 0.11);
    write(ctx, "Pagewing", x, by, bold(size), PAL.ink, 2001, { rot: -0.015 });
    const u1 = easeOutCubic(clamp((time - 0.15) / 0.3));
    const u2 = easeOutCubic(clamp((time - 0.45) / 0.25));
    if (u1 > 0) line(ctx, x - 4, by + 10, x - 4 + (tw + 12) * u1, by + 8, 2002, { width: 2.4 });
    if (u2 > 0) line(ctx, x + 6, by + 17, x + 6 + (tw - 22) * u2, by + 16, 2003, { width: 2 });
    write(ctx, "my homework, airborne", x + 4, by + 46, hand(24), PAL.graphite, 2004, { rot: -0.025 });
    if (session.best !== null && session.best > 0) {
      const t = `best: ${session.best} m`;
      write(ctx, t, x + 6, by + 78, hand(24), PAL.red, 2005, { rot: 0.02 });
      ctx.font = hand(24);
      write(ctx, "✓", x + 14 + ctx.measureText(t).width, by + 79, bold(26), PAL.red, 2006);
    }
    const cx = (pv.left + W - pv.right) / 2;
    const p = toScreen(world.body.x, world.body.y);
    const py = Math.min(H - pv.bottom - 60, Math.max(by + 150, H * 0.62));
    promptWord("tap to throw!", cx, py, 34, world.alive && Math.abs(p.y - py) > 90 ? { x: p.x - 6, y: p.y + (p.y > py ? -24 : 24) } : null);
  }

  newDemo();
  let readySent = false;
  tc.loop((dt) => {
    update(dt);
    if (!readySent) ground.prepare(view_(), bakeScale(), 8);
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
