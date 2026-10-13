import {
  clamp,
  Counter,
  createAudio,
  createRng,
  createSession,
  damp,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  FONT_MONO,
  HitStop,
  lerp,
  loadFonts,
  onKeys,
  onSwipe,
  Particles,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
  type Dir,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { PerspectiveCamera, Vector3, type Group, type Mesh } from "three";
import { ACCENT, createRunner } from "./runner.ts";
import { createStage } from "./stage.ts";
import { buildWorld, LANE, type ObstacleKind } from "./world.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const GRAVITY = 30;
const JUMP_VY = 10.2;
const SLIDE_TIME = 0.62;
const SPAWN_Z = -95;
const STAND_H = 1.85;
const SLIDE_H = 0.8;

const speedAt = (t: number) => lerp(13, 29, clamp(t / 80));
const gapAt = (t: number) => lerp(24, 15, clamp(t / 70));

interface Obstacle {
  kind: ObstacleKind;
  lane: number;
  z: number;
  /** Half length along z. */
  hz: number;
  group: Group;
  passed: boolean;
}

interface Bolt {
  lane: number;
  z: number;
  y: number;
  mesh: Mesh;
  taken: boolean;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "lane-rush" }), loadFonts()]);
  const stage = createStage();
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;
  const world = buildWorld();
  const { scene } = world;
  const camera = new PerspectiveCamera(66, W / H, 0.1, 500);
  stage.onResize((w, h) => {
    W = w;
    H = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.03, 1.7, session.reducedMotion);
  const hitStop = new HitStop();
  const fx = new Particles(500);
  const popups = new Popups();
  const counter = new Counter(0, 20);

  const runner = createRunner();
  scene.add(runner.root);
  scene.add(runner.shadow);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let obstacles: Obstacle[] = [];
  let bolts: Bolt[] = [];
  let runT = 0;
  let distance = 0;
  let boltsTaken = 0;
  let nextRowZ = -30;
  let lane = 1;
  let x = 0;
  let y = 0;
  let vy = 0;
  let slideT = 0;
  let lean = 0;
  let phase = 0;
  let deadT = -1;
  let endSent = false;
  let time = 0;
  let titleIn = 0;
  let camX = 0;
  let speedFov = 0;
  /** Attract looks up a little so the title sits on open sky; runs look down the track. */
  let lookY = 2.6;

  const score = () => Math.floor(distance) + boltsTaken * 10;

  function clear() {
    for (const o of obstacles) world.disposeObstacle(o.group);
    for (const b of bolts) b.mesh.removeFromParent();
    obstacles = [];
    bolts = [];
  }

  function reset(m: "attract" | "play") {
    mode = m;
    clear();
    runT = 0;
    distance = 0;
    boltsTaken = 0;
    nextRowZ = m === "play" ? -42 : -26;
    lane = 1;
    x = 0;
    y = 0;
    vy = 0;
    slideT = 0;
    deadT = -1;
    endSent = false;
    counter.snap(0);
    while (nextRowZ > SPAWN_Z) spawnRow();
  }

  function addObstacle(kind: ObstacleKind, l: number, z: number) {
    const group = world.makeObstacle(kind, l);
    group.position.z = z;
    scene.add(group);
    const hz = kind === "crate" ? 1.7 : kind === "rover" ? 1.2 : kind === "gate" ? 0.1 : 0.11;
    obstacles.push({ kind, lane: l, z, hz, group, passed: false });
  }

  function addBolts(l: number, z: number, count: number, arc: boolean) {
    for (let i = 0; i < count; i++) {
      const mesh = world.makeBolt();
      const bz = z + i * 1.6;
      const by = arc ? 1.1 + Math.sin((i / (count - 1)) * Math.PI) * 1.5 : 0.85;
      mesh.position.set((l - 1) * LANE, by, bz);
      scene.add(mesh);
      bolts.push({ lane: l, z: bz, y: by, mesh, taken: false });
    }
  }

  /** One row of the course. Every row leaves at least one way through. */
  function spawnRow() {
    const z = nextRowZ;
    const t = mode === "play" ? runT + (-z / Math.max(1, speedAt(runT))) : 18;
    const d = clamp(t / 70);
    const roll = rng();
    const lanes = [0, 1, 2];
    rng.shuffle(lanes);
    const [a, b, c] = lanes as [number, number, number];
    if (roll < 0.22 - d * 0.1) {
      // One obstacle, two free lanes.
      addObstacle(rng.pick(["bar", "gate", "crate"] as const), a, z);
      addBolts(b, z - 2, 5, false);
    } else if (roll < 0.42) {
      // Two crates: change lanes.
      addObstacle("crate", a, z);
      addObstacle("crate", b, z);
      addBolts(c, z + 1, 4, false);
    } else if (roll < 0.58) {
      // Full-width barrier: jump.
      for (const l of [0, 1, 2]) addObstacle("bar", l, z);
      addBolts(rng.int(0, 2), z + 3.2, 5, true);
    } else if (roll < 0.72) {
      // Full-width gate: slide.
      for (const l of [0, 1, 2]) addObstacle("gate", l, z);
    } else if (roll < 0.86) {
      // Mixed: crate + bar + gate.
      addObstacle("crate", a, z);
      addObstacle("bar", b, z);
      addObstacle("gate", c, z);
    } else {
      // A rover coming at you in one lane, a crate in another.
      if (d > 0.25) addObstacle("rover", a, z - 10);
      else addObstacle("crate", a, z);
      addObstacle(rng.chance(0.5) ? "bar" : "gate", b, z);
      addBolts(c, z, 4, false);
    }
    nextRowZ -= gapAt(t) * rng.range(0.85, 1.2);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const grounded = () => y <= 0.001;

  function act(dir: Dir) {
    if (deadT >= 0) return;
    if (dir === "left" || dir === "right") {
      const next = clamp(lane + (dir === "left" ? -1 : 1), 0, 2);
      if (next !== lane) {
        lane = next;
        if (mode === "play") audio.play("whoosh", { volume: 0.6, pitch: dir === "left" ? -2 : 2 });
      }
    } else if (dir === "up") {
      if (grounded()) {
        vy = JUMP_VY;
        slideT = 0;
        if (mode === "play") audio.play("jump");
      }
    } else if (dir === "down") {
      if (!grounded()) vy = -18;
      slideT = SLIDE_TIME;
      if (mode === "play") audio.play("slice", { volume: 0.5, pitch: -6 });
    }
  }

  session.startOnTap(window);
  onSwipe(window, (dir) => {
    if (session.phase === "playing" && mode === "play") act(dir);
  });
  onKeys({
    left: () => session.phase === "playing" && act("left"),
    right: () => session.phase === "playing" && act("right"),
    up: () => session.phase === "playing" && act("up"),
    down: () => session.phase === "playing" && act("down"),
  });
  session.on("start", () => reset("play"));
  session.on("cancel", () => {
    /* swipes fire on the threshold; a cancelled gesture never reached it */
  });

  function die(o: Obstacle) {
    deadT = 0;
    hitStop.freeze(0.1);
    shake.add(0.7);
    audio.play("hit");
    audio.play("explode", { volume: 0.5 });
    tc.feedback("impact");
    const p = project(x, y + 1, o.z);
    fx.emit(p.x, p.y, { count: 40, speed: [140, 520], life: [0.4, 1], size: [3, 8], colors: [ACCENT, "#F3F0E8", "#2B2F3A", "#FFD166"], gravity: 900, drag: 1.4 });
  }

  const tmp = new Vector3();
  function project(px: number, py: number, pz: number) {
    tmp.set(px, py, pz).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
  }

  // Attract pilot: reads the course a few meters ahead and reacts like a decent player.
  function pilot(speed: number) {
    if (deadT >= 0) return;
    const ahead = obstacles.filter((o) => o.z - o.hz < 0.5 && o.z + o.hz > -16).sort((p, q) => q.z - p.z);
    const inLane = ahead.find((o) => o.lane === lane && o.z + o.hz > -16 && o.z < 1);
    if (!inLane) return;
    const dz = -(inLane.z + inLane.hz);
    const blocked = (l: number) => ahead.some((o) => o.lane === l && (o.kind === "crate" || o.kind === "rover") && Math.abs(o.z - inLane.z) < 6);
    if (inLane.kind === "crate" || inLane.kind === "rover") {
      const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !blocked(l));
      const alt = options[0] ?? (lane === 1 ? 0 : 1);
      if (dz < 12) act(alt < lane ? "left" : "right");
    } else if (inLane.kind === "bar") {
      if (dz < speed * 0.3 && grounded()) act("up");
    } else if (inLane.kind === "gate") {
      if (dz < speed * 0.32 && slideT <= 0.05) act("down");
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += rawDt;
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    shake.update(rawDt);
    fx.update(rawDt);
    popups.update(rawDt);

    const alive = deadT < 0;
    if (alive) runT += dt;
    const speed = alive ? speedAt(mode === "attract" ? 14 : runT) : Math.max(0, speedAt(runT) * (1 - deadT * 3));
    const dz = speed * dt;
    distance += mode === "play" && alive ? dz : 0;
    counter.set(score());
    counter.update(rawDt);

    world.scroll(dz);
    for (const o of obstacles) {
      o.z += dz + (o.kind === "rover" ? 7 * dt * (alive ? 1 : 0) : 0);
      o.group.position.z = o.z;
    }
    for (const b of bolts) {
      b.z += dz;
      b.mesh.position.z = b.z;
      b.mesh.rotation.y += dt * 4;
      b.mesh.position.y = b.y + Math.sin(time * 5 + b.z) * 0.08;
    }
    nextRowZ += dz;
    while (nextRowZ > SPAWN_Z) spawnRow();
    obstacles = obstacles.filter((o) => {
      if (o.z - o.hz < 14) return true;
      world.disposeObstacle(o.group);
      return false;
    });
    bolts = bolts.filter((b) => {
      if (b.z < 8 && !b.taken) return true;
      b.mesh.removeFromParent();
      return false;
    });

    if (mode === "attract") pilot(speed);

    // Runner physics.
    if (alive) {
      vy -= GRAVITY * dt;
      y = Math.max(0, y + vy * dt);
      if (y === 0 && vy < 0) {
        if (vy < -6 && mode === "play") audio.play("thud", { volume: 0.4 });
        vy = 0;
      }
      slideT = Math.max(0, slideT - dt);
      phase += dt * speed * 0.55;
    } else {
      deadT += rawDt;
      if (!endSent && deadT > 0.45 && mode === "play") {
        endSent = true;
        session.end(score(), { outcome: "lose", stats: { distance: Math.floor(distance), bolts: boltsTaken } });
      }
      if (mode === "attract" && deadT > 1.2) reset("attract");
    }
    const targetX = (lane - 1) * LANE;
    const prevX = x;
    x = damp(x, targetX, 16, dt);
    lean = damp(lean, clamp((x - prevX) / Math.max(dt, 1e-3) / 8, -1, 1), 14, rawDt);

    // Collisions.
    if (alive) {
      const h = slideT > 0 ? SLIDE_H : STAND_H;
      for (const o of obstacles) {
        const ox = (o.lane - 1) * LANE;
        if (Math.abs(ox - x) > 1.05) continue;
        if (o.z + o.hz < -0.3 || o.z - o.hz > 0.3) {
          if (!o.passed && o.z - o.hz > 0.3) {
            o.passed = true;
            if (mode === "play" && Math.abs(ox - x) < 0.6) {
              // Cleared an obstacle in your own lane: a little reward.
              audio.play("tick", { pitch: 4 });
            }
          }
          continue;
        }
        const hit = o.kind === "bar" ? y < 0.78 : o.kind === "gate" ? y + h > 1.18 : true;
        if (hit) {
          if (mode === "play") die(o);
          else deadT = 0;
          break;
        }
      }
      for (const b of bolts) {
        if (b.taken || Math.abs(b.z) > 0.7) continue;
        if (Math.abs((b.lane - 1) * LANE - x) > 0.8 || Math.abs(b.y - (y + 0.9)) > 1.2) continue;
        b.taken = true;
        if (mode === "play") {
          boltsTaken++;
          audio.play("coin", { pitch: (boltsTaken % 5) * 2 });
          const p = project(b.mesh.position.x, b.y, b.z);
          popups.add("+10", p.x, p.y - 10, ACCENT, 16, 0.6);
          fx.emit(p.x, p.y, { count: 8, speed: [60, 180], life: [0.2, 0.45], size: [2, 4], colors: [ACCENT, "#FFD166"], drag: 3 });
        }
      }
    }

    // Pose + camera.
    runner.root.position.set(x, y, 0);
    runner.shadow.position.set(x, 0.02, 0);
    runner.shadow.scale.setScalar(1 - Math.min(0.6, y * 0.25));
    const air = clamp(y / 1.2);
    const slide = slideT > 0 ? clamp(Math.min(slideT / 0.08, (SLIDE_TIME - slideT) / 0.06 + 0.4, 1)) : 0;
    runner.pose(phase, air, slide, lean, deadT >= 0 ? clamp(deadT * 3) : 0);
    camX = damp(camX, x * 0.55, 6, rawDt);
    speedFov = damp(speedFov, (speed - 13) * 0.35, 2, rawDt);
    const o = shake.offset;
    camera.fov = 64 + speedFov;
    camera.updateProjectionMatrix();
    camera.position.set(camX + o.x * 0.01, 3.7 + o.y * 0.01, 6.4);
    lookY = damp(lookY, mode === "attract" ? 2.7 : 1.15, 3, rawDt);
    camera.lookAt(camX * 0.8, lookY, -9);
    camera.rotation.z += o.angle;
  }

  function hintArrow(g: CanvasRenderingContext2D, x0: number, y0: number, dir: Dir, t: number) {
    const k = 0.5 + 0.5 * Math.sin(t);
    const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
    const dy = dir === "up" ? -1 : dir === "down" ? 1 : 0;
    g.save();
    g.translate(x0 + dx * k * 4, y0 + dy * k * 4);
    g.rotate(Math.atan2(dy, dx));
    g.fillStyle = ACCENT;
    g.beginPath();
    g.moveTo(7, 0);
    g.lineTo(-4, -6);
    g.lineTo(-4, 6);
    g.closePath();
    g.fill();
    g.restore();
  }

  function drawHud() {
    stage.beginHud();
    const g = hud;
    fx.draw(g);
    popups.draw(g, FONT_MONO);
    if (mode === "play") {
      if (session.phase === "playing") {
        const top = session.play().top;
        drawNumber(g, Math.round(counter.shown), W / 2, top + 46, 44, "#F3F0E8");
        drawLabel(g, `${Math.floor(distance)} M · ${boltsTaken} ${boltsTaken === 1 ? "BOLT" : "BOLTS"}`, W / 2, top + 80, rgba("#F3F0E8", 0.8), 11);
      } else if (session.standalone && session.phaseTime > 0.7) {
        // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
        const r = safeRect(session.preview(), W, H);
        drawNumber(g, score(), r.x + r.w / 2, r.y + 64, 56, "#F3F0E8");
        drawLabel(g, `${Math.floor(distance)} M · ${boltsTaken} ${boltsTaken === 1 ? "BOLT" : "BOLTS"}`, r.x + r.w / 2, r.y + 100, rgba("#F3F0E8", 0.8), 11);
        g.fillStyle = "rgba(13,13,16,0.62)";
        roundRect(g, r.x + r.w / 2 - 118, r.y + r.h - 37, 236, 34, 17);
        g.fill();
        drawTapPrompt(g, r.x + r.w / 2, r.y + r.h - 20, time, "#F3F0E8", "TAP TO RUN AGAIN");
      }
      return;
    }
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const ty = r.y + 66;
    const k = easeOutBack(titleIn);
    g.save();
    g.translate(cx, ty);
    g.scale(k, k);
    g.rotate(-0.05);
    drawTitle(g, "LANE RUSH", 0, 0, r.w - 6, "#F3F0E8", 52, ACCENT);
    g.restore();
    g.save();
    g.shadowColor = "rgba(13,13,16,0.7)";
    g.shadowBlur = 6;
    drawLabel(g, "THREE LANES. ZERO CHILL.", cx, ty + 30, "#F3F0E8", 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 52, ACCENT, 13);
    g.restore();
    // Swipe hint: four arrows, tucked under the title block.
    const hy = ty + (session.best !== null ? 92 : 76);
    g.fillStyle = "rgba(13,13,16,0.55)";
    roundRect(g, cx - 98, hy - 20, 196, 40, 20);
    g.fill();
    hintArrow(g, cx - 66, hy, "left", time * 4);
    hintArrow(g, cx - 42, hy, "up", time * 4 + 1);
    drawLabel(g, "SWIPE", cx, hy, "#F3F0E8", 11);
    hintArrow(g, cx + 42, hy, "down", time * 4 + 2);
    hintArrow(g, cx + 66, hy, "right", time * 4 + 3);
    g.fillStyle = "rgba(13,13,16,0.55)";
    roundRect(g, cx - 100, r.y + r.h - 37, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, r.y + r.h - 20, time, "#F3F0E8");
  }

  reset("attract");
  // Compile every shader variant up front (one of each obstacle, a bolt) so no frame after ready() stalls.
  const warm = (["bar", "gate", "crate", "rover"] as const).map((k, i) => {
    const g = world.makeObstacle(k, i % 3);
    g.position.z = -20;
    scene.add(g);
    return g;
  });
  const warmBolt = world.makeBolt();
  scene.add(warmBolt);
  update(0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  warm.forEach((g) => world.disposeObstacle(g));
  warmBolt.removeFromParent();
  let frames = 0;
  tc.loop((dt) => {
    update(dt);
    renderer.render(scene, camera);
    drawHud();
    // ready() on the second frame: the first one pays for GPU uploads.
    if (++frames === 2) session.ready();
  });
}

void main();
