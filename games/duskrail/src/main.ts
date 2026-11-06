import {
  clamp,
  Counter,
  createAudio,
  createMusic,
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
  smoothstep,
  Spring,
  type Dir,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { PerspectiveCamera, Vector3, type Group, type Mesh } from "three";
import { ACCENT, createRunner, type Pose } from "./runner.ts";
import { createStage } from "./stage.ts";
import { buildWorld, LANE, type ObstacleKind } from "./world.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
// Snappy rise, heavier fall: the asymmetry is what makes a jump feel like it has mass.
const GRAVITY_UP = 31;
const GRAVITY_DOWN = 56;
const JUMP_VY = 11.2;
/** Swipe down in the air: drive into the deck and come out of it in a slide. */
const SLAM_VY = -24;
const SLIDE_TIME = 0.6;
/** An up-swipe this close to landing still jumps. */
const JUMP_BUFFER = 0.14;
const SPAWN_Z = -95;
const STAND_H = 1.85;
const SLIDE_H = 0.8;
const ROVER_V = 7;
/** Lateral offset (m) between runner and obstacle beyond which a hit glances off instead of stopping you. */
const SCRAPE_OFF = 0.55;
/** Clean clears in a row needed for ×2, ×3, ×4 and ×5. */
const MULT_AT = [5, 15, 30, 50];
const PIPS = 5;

const speedAt = (t: number) => lerp(14, 30, clamp(t / 85));
const gapAt = (t: number) => lerp(24, 15, clamp(t / 70));
/** Top of each obstacle: clear it and it can't touch you. */
const TOP: Record<ObstacleKind, number> = { bar: 0.78, gate: Infinity, crate: 2.15, rover: 1.55 };

const SFX_SLIDE: SfxParams = { wave: "noise", freq: 2600, freqEnd: 900, duration: 0.34, volume: 0.16, highpass: 700, punch: 1.2 };
const SFX_SCRAPE: SfxParams = { wave: "noise", freq: 4200, freqEnd: 1400, duration: 0.28, volume: 0.3, highpass: 1100, punch: 1.6 };
const SFX_HORN: SfxParams = { wave: "square", freq: 233, duration: 0.44, volume: 0.07, lowpass: 900, arp: [0, -3], arpStep: 0.22 };

interface Obstacle {
  kind: ObstacleKind;
  lane: number;
  z: number;
  /** Half length along z. */
  hz: number;
  group: Group;
  passed: boolean;
  /** Already glanced off it: it can't hurt again. */
  scraped: boolean;
  /** You left its lane with it about to hit: a near miss once it's behind you. */
  close: boolean;
  honked: boolean;
}

interface Bolt {
  lane: number;
  z: number;
  y: number;
  mesh: Mesh;
  taken: boolean;
  /** Which line it belongs to, and its place in it (the pickup sound climbs along a line). */
  line: number;
  index: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "duskrail" }), loadFonts()]);
  const reduced = session.reducedMotion;
  const stage = createStage();
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;
  const world = buildWorld(Math.min(4, renderer.capabilities.getMaxAnisotropy()));
  const { scene } = world;
  const camera = new PerspectiveCamera(66, W / H, 0.1, 500);
  stage.onResize((w, h) => {
    W = w;
    H = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  const audio = createAudio();
  const music = createMusic(audio, {
    bpm: 124,
    wave: "triangle",
    volume: 0.035,
    steps: [57, null, 57, 69, null, 57, 67, null, 53, null, 53, 65, null, 53, 64, null, 55, null, 55, 67, null, 55, 62, null, 57, null, 57, 69, null, 64, 67, 69],
  });
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.03, 1.7, reduced);
  const hitStop = new HitStop();
  const fx = new Particles(600);
  const popups = new Popups();
  const counter = new Counter(0, 20);

  const runner = createRunner();
  scene.add(runner.root);
  scene.add(runner.shadow);
  const pose: Pose = { phase: 0, air: 0, fall: 0, slide: 0, lean: 0, squash: 1, stagger: 0, dead: 0 };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let obstacles: Obstacle[] = [];
  let bolts: Bolt[] = [];
  /** Bolts left in each line, or -1 once one of them got away. */
  const lines = new Map<number, number>();
  let lineId = 0;
  let runT = 0;
  let distance = 0;
  let points = 0;
  let boltsTaken = 0;
  let streak = 0;
  let bestStreak = 0;
  let nextRowZ = -30;
  let lane = 1;
  let fromLane = 1;
  /** Lane position rides a slightly under-damped spring: quick off the mark, a hint of overshoot. */
  const xs = new Spring(0, 520, 40);
  let x = 0;
  let y = 0;
  let vy = 0;
  let airborne = false;
  let slamming = false;
  let jumpBuf = 0;
  let slideT = 0;
  let speedMul = 1;
  let stagger = 0;
  let lean = 0;
  let phase = 0;
  let step = 0;
  let deadT = -1;
  let knockZ = 0;
  let knockVz = 0;
  let crashO: Obstacle | null = null;
  let endSent = false;
  let time = 0;
  let titleIn = 0;
  let flash = 0;
  let multPop = 0;
  let speed = 0;
  let dusk = 0;
  const squash = new Spring(1, 380, 16);
  const dip = new Spring(0, 160, 13);
  let camX = 0;
  let camY = 3.7;
  let camZ = 6.4;
  let camRoll = 0;
  let speedFov = 0;
  /** Attract looks up a little so the title sits on open sky; runs look down the track. */
  let lookY = 2.6;

  const score = () => Math.floor(points);
  const mult = () => 1 + MULT_AT.filter((n) => streak >= n).length;
  /** Progress toward the next multiplier, in pips. */
  const pips = () => {
    const m = mult();
    const next = MULT_AT[m - 1];
    if (next === undefined) return PIPS;
    const prev = MULT_AT[m - 2] ?? 0;
    return Math.floor(((streak - prev) / (next - prev)) * PIPS);
  };

  function clear() {
    for (const o of obstacles) world.disposeObstacle(o.group);
    for (const b of bolts) b.mesh.removeFromParent();
    obstacles = [];
    bolts = [];
    lines.clear();
    crashO = null;
  }

  function reset(m: "attract" | "play") {
    mode = m;
    clear();
    runT = 0;
    distance = 0;
    points = 0;
    boltsTaken = 0;
    streak = 0;
    bestStreak = 0;
    nextRowZ = m === "play" ? -42 : -26;
    lane = fromLane = 1;
    xs.snap(0);
    x = y = vy = 0;
    airborne = slamming = false;
    jumpBuf = slideT = stagger = 0;
    speedMul = 1;
    deadT = -1;
    knockZ = knockVz = 0;
    endSent = false;
    squash.snap(1);
    counter.snap(0);
    while (nextRowZ > SPAWN_Z) spawnRow();
  }

  function addObstacle(kind: ObstacleKind, l: number, z: number) {
    const group = world.makeObstacle(kind, l);
    group.position.z = z;
    scene.add(group);
    const hz = kind === "crate" ? 1.7 : kind === "rover" ? 1.2 : kind === "gate" ? 0.1 : 0.11;
    obstacles.push({ kind, lane: l, z, hz, group, passed: false, scraped: false, close: false, honked: false });
  }

  function addBolts(l: number, z: number, count: number, arc: boolean) {
    const id = ++lineId;
    lines.set(id, count);
    for (let i = 0; i < count; i++) {
      const mesh = world.makeBolt();
      // Index 0 is the one you reach first.
      const bz = z - i * 1.6;
      const by = arc ? 1.1 + Math.sin((i / (count - 1)) * Math.PI) * 1.5 : 0.85;
      mesh.position.set((l - 1) * LANE, by, bz);
      scene.add(mesh);
      bolts.push({ lane: l, z: bz, y: by, mesh, taken: false, line: id, index: i });
    }
  }

  /** One row of the course. Every row leaves at least one way through. */
  function spawnRow() {
    const z = nextRowZ;
    const t = mode === "play" ? runT + -z / Math.max(1, speedAt(runT)) : 18;
    const d = clamp(t / 70);
    const v = speedAt(t);
    const lanes = [0, 1, 2];
    rng.shuffle(lanes);
    const [a, b, c] = lanes as [number, number, number];
    const special = rng();
    if (d > 0.35 && special < 0.1) {
      // Hurdle with a sign right behind it: jump, then slam down into a slide.
      for (const l of [0, 1, 2]) addObstacle("bar", l, z);
      const gz = z - v * 0.5;
      for (const l of [0, 1, 2]) addObstacle("gate", l, gz);
      addBolts(rng.int(0, 2), z + 3.2, 5, true);
      nextRowZ = gz;
    } else if (d > 0.3 && special < 0.2) {
      // Zigzag: a wall with one gap, then another wall whose gap is one lane over.
      addObstacle("crate", a, z);
      addObstacle("crate", b, z);
      const free = c === 1 ? rng.pick([0, 2]) : 1;
      const z2 = z - (3.4 + v * 0.5);
      for (const l of [0, 1, 2]) if (l !== free) addObstacle("crate", l, z2);
      addBolts(c, z + 1, 3, false);
      nextRowZ = z2;
    } else {
      const roll = rng();
      if (roll < 0.22 - d * 0.1) {
        // One obstacle, two free lanes.
        addObstacle(rng.pick(["bar", "gate", "crate"] as const), a, z);
        addBolts(b, z + 4, 5, false);
      } else if (roll < 0.42) {
        // Two crates: change lanes.
        addObstacle("crate", a, z);
        addObstacle("crate", b, z);
        addBolts(c, z + 7, 4, false);
      } else if (roll < 0.58) {
        // Full-width barrier: jump. The bolts arc over it.
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
        addBolts(c, z + 6, 4, false);
      }
    }
    nextRowZ -= gapAt(t) * rng.range(0.85, 1.2);
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  const tmp = new Vector3();
  function project(px: number, py: number, pz: number) {
    tmp.set(px, py, pz).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
  }
  const footPos = new Vector3();
  function footScreen(i: 0 | 1) {
    runner.foot(i, footPos);
    return project(footPos.x, 0.05, footPos.z);
  }
  const sfx = (name: Parameters<typeof audio.play>[0], opts?: Parameters<typeof audio.play>[1]) => {
    if (mode === "play") audio.play(name, opts);
  };

  /** Grit kicked up off the deck; it trails toward the camera like the deck does. */
  function dust(px: number, py: number, count: number, spread = 1) {
    fx.emit(px, py, {
      count,
      speed: [30 * spread, 110 * spread],
      angle: [Math.PI * 0.08, Math.PI * 0.92],
      life: [0.25, 0.5],
      size: [3, 6],
      colors: ["#B9A58E", "#8E8A92", "#D8C3A5"],
      gravity: -60,
      drag: 3,
      vy: 140,
      shape: "circle",
      spread: 4,
    });
  }

  function sparks(px: number, py: number, count: number, angle: [number, number] = [Math.PI * 0.15, Math.PI * 0.85]) {
    fx.emit(px, py, {
      count,
      speed: [140, 340],
      angle,
      life: [0.14, 0.34],
      size: [1.5, 2.6],
      colors: [ACCENT, "#FFD166", "#FFF4C2"],
      gravity: 900,
      shape: "spark",
    });
  }

  function addStreak(n: number) {
    const before = mult();
    streak += n;
    bestStreak = Math.max(bestStreak, streak);
    sfx("tick", { pitch: 4 + pips() * 2 });
    if (mult() > before) {
      multPop = 1;
      sfx("powerup", { volume: 0.7 });
      session.feedback("tap");
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function jump() {
    airborne = true;
    vy = JUMP_VY;
    slideT = 0;
    jumpBuf = 0;
    squash.kick(2.6);
    sfx("jump", { volume: 0.8 });
    const f = footScreen(0);
    dust(f.x, f.y, 5, 0.7);
  }

  function startSlide() {
    slideT = SLIDE_TIME;
    sfx(SFX_SLIDE);
    const f = footScreen(0);
    sparks(f.x, f.y, 8);
  }

  function land(impact: number) {
    const k = clamp(impact / 16);
    squash.kick(-1.4 - k * 3.2);
    if (!reduced) dip.kick(-k * 2.2);
    sfx("thud", { volume: 0.25 + k * 0.45 });
    const l = footScreen(0);
    const r = footScreen(1);
    dust((l.x + r.x) / 2, (l.y + r.y) / 2, Math.round(5 + k * 9), 0.8 + k * 0.7);
    if (slamming) {
      slamming = false;
      shake.add(0.2);
      startSlide();
    } else if (jumpBuf > 0) {
      jump();
    }
  }

  /** Mark obstacles you just swerved out from in front of. They pay out a near miss once they're behind you. */
  function markCloseCalls() {
    for (const o of obstacles) {
      if (o.lane !== lane || o.passed) continue;
      const front = o.z + o.hz;
      const eta = -front / Math.max(1, speed + (o.kind === "rover" ? ROVER_V : 0));
      if (eta < 0 || eta > 0.3) continue;
      const h = slideT > 0 ? SLIDE_H : STAND_H;
      const wouldHit = o.kind === "gate" ? y + h > 1.18 : y < TOP[o.kind];
      if (wouldHit) o.close = true;
    }
  }

  function act(dir: Dir) {
    if (deadT >= 0) return;
    if (dir === "left" || dir === "right") {
      const side = dir === "left" ? -1 : 1;
      const next = lane + side;
      if (next < 0 || next > 2) {
        // Shoulder the rail and bounce off it.
        xs.kick(side * 5);
        sfx("thud", { volume: 0.2, pitch: 7 });
        return;
      }
      markCloseCalls();
      fromLane = lane;
      lane = next;
      sfx("whoosh", { volume: 0.6, pitch: side * 2, pan: side * 0.4 });
      if (!airborne) {
        const f = footScreen(side < 0 ? 1 : 0);
        dust(f.x, f.y, 4, 0.6);
      }
    } else if (dir === "up") {
      if (!airborne) jump();
      else jumpBuf = JUMP_BUFFER;
    } else if (dir === "down") {
      if (airborne) {
        vy = Math.min(vy, SLAM_VY);
        slamming = true;
        jumpBuf = 0;
        sfx("whoosh", { volume: 0.5, pitch: -5 });
      } else {
        startSlide();
      }
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
    action: () => session.phase === "playing" && act("up"),
  });
  session.on("start", () => {
    reset("play");
    music.start();
  });
  session.on("cancel", () => {
    /* swipes fire on the threshold; a cancelled gesture never reached it */
  });

  /** Clipped the side of something: shoved back out, the streak is gone and you lose a step. */
  function scrape(o: Obstacle, ox: number) {
    o.scraped = true;
    if (o.lane === lane && fromLane !== lane) lane = fromLane;
    const away = Math.sign(x - ox) || (lane < o.lane ? -1 : 1);
    xs.velocity = away * 9;
    stagger = 1;
    speedMul = 0.7;
    streak = 0;
    hitStop.freeze(0.05);
    shake.add(0.38);
    sfx(SFX_SCRAPE);
    sfx("hit", { volume: 0.4, pitch: 6 });
    session.feedback("impact");
    const p = project((x + ox) / 2, 1.1, 0);
    sparks(p.x, p.y, 16, away < 0 ? [Math.PI * 0.6, Math.PI * 1.3] : [-Math.PI * 0.3, Math.PI * 0.4]);
    if (mode === "play") popups.add("SCRAPE", p.x, p.y - 30, "#F3F0E8", 15, 0.6);
  }

  /** Ran into it head-on. You bounce off it; it doesn't move for you. */
  function crash(o: Obstacle) {
    deadT = 0;
    crashO = o;
    knockZ = 0;
    knockVz = 2.6;
    vy = Math.max(vy * 0.3, 0) + 4.2;
    airborne = true;
    slideT = 0;
    slamming = false;
    hitStop.freeze(0.12);
    shake.add(0.75);
    if (!reduced && mode === "play") flash = 1;
    music.stop();
    sfx("hit");
    sfx("thud", { volume: 0.8, pitch: -4 });
    sfx("explode", { volume: 0.35 });
    session.feedback("impact");
    const top = o.kind === "bar" ? 0.6 : 1.3;
    const p = project(x, Math.min(top, y + 1), o.z + o.hz);
    const colors = o.kind === "rover" ? ["#F3F0E8", "#FFF4C2", ACCENT] : o.kind === "gate" ? ["#20232B", "#F3F0E8", "#FFE3A3"] : [ACCENT, "#F3F0E8", "#2B2F3A", "#FFD166"];
    fx.emit(p.x, p.y, { count: 36, speed: [140, 520], life: [0.4, 1], size: [3, 8], colors, gravity: 900, drag: 1.4 });
  }

  // Attract pilot: reads the course a few meters ahead and reacts like a decent player.
  function pilot() {
    if (deadT >= 0) return;
    let inLane: Obstacle | undefined;
    for (const o of obstacles) {
      if (o.lane !== lane || o.passed || o.scraped || o.z + o.hz < -18) continue;
      if (!inLane || o.z > inLane.z) inLane = o;
    }
    if (!inLane) return;
    const rel = speed + (inLane.kind === "rover" ? ROVER_V : 0);
    const eta = -(inLane.z + inLane.hz) / rel;
    const near = inLane.z;
    const blocked = (l: number) => obstacles.some((o) => o.lane === l && (o.kind === "crate" || o.kind === "rover") && !o.passed && Math.abs(o.z - near) < 7);
    if (inLane.kind === "crate" || inLane.kind === "rover") {
      const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !blocked(l));
      const alt = options[0] ?? (lane === 1 ? 0 : 1);
      if (eta < 0.55) act(alt < lane ? "left" : "right");
    } else if (inLane.kind === "bar") {
      if (eta < 0.22 && !airborne) act("up");
    } else if (inLane.kind === "gate") {
      if (airborne ? eta < 0.3 && !slamming : eta < 0.28 && slideT <= 0.05) act("down");
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
    flash = Math.max(0, flash - rawDt * 6);
    multPop = Math.max(0, multPop - rawDt * 3);

    const alive = deadT < 0;
    if (alive) runT += dt;
    speedMul = damp(speedMul, 1, 1.8, dt);
    // A crash stops the world dead: the obstacle never slides through you.
    speed = alive ? speedAt(mode === "attract" ? 16 : runT) * speedMul : 0;
    const dz = speed * dt;
    if (mode === "play" && alive) {
      distance += dz;
      points += dz * mult();
    }
    counter.set(score());
    counter.update(rawDt);
    dusk = damp(dusk, mode === "play" ? smoothstep(runT / 90) : 0, 2.5, rawDt);
    world.setDusk(dusk);

    world.scroll(dz);
    for (const o of obstacles) {
      if (alive) o.z += dz + (o.kind === "rover" ? ROVER_V * dt : 0);
      o.group.position.z = o.z;
      const behind = o.z - o.hz - 0.5;
      const inView = o.kind === "gate" || Math.abs((o.lane - 1) * LANE - x) < 1.2 || o.group.userData.faded === true;
      if (behind > 0 && o.kind !== "bar" && inView) {
        world.fadeObstacle(o.group, clamp(1 - behind / 2.5, 0.12, 1));
      }
      if (o.kind === "rover" && !o.honked && o.z > -55) {
        o.honked = true;
        sfx(SFX_HORN, { pan: (o.lane - 1) * 0.5 });
      }
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
      if (!b.taken) lines.set(b.line, -1);
      b.mesh.removeFromParent();
      return false;
    });

    if (mode === "attract") pilot();

    // Runner physics.
    if (alive) {
      jumpBuf = Math.max(0, jumpBuf - dt);
      if (airborne) {
        vy -= (vy > 0 ? GRAVITY_UP : GRAVITY_DOWN) * dt;
        y += vy * dt;
        if (y <= 0) {
          const impact = -vy;
          y = vy = 0;
          airborne = false;
          land(impact);
        }
      }
      slideT = Math.max(0, slideT - dt);
      stagger = Math.max(0, stagger - dt * 1.8);
      if (!airborne && slideT <= 0) {
        phase += dt * (9 + speed * 0.26);
        // A foot strikes every half turn of the cycle.
        const s = Math.floor((phase - Math.PI / 2) / Math.PI);
        if (s !== step) {
          step = s;
          if (speed > 0) {
            const f = footScreen((s & 1) as 0 | 1);
            dust(f.x, f.y, 2, 0.5);
          }
        }
      } else if (slideT > 0 && Math.random() < 0.5) {
        const f = footScreen(0);
        sparks(f.x, f.y, 1);
      }
    } else {
      deadT += dt;
      knockZ += knockVz * dt;
      knockVz *= Math.exp(-(y > 0.01 ? 1.2 : 10) * dt);
      // Floatier than a jump on purpose: the toss has to read.
      vy -= GRAVITY_UP * dt;
      y += vy * dt;
      if (y <= 0) {
        y = 0;
        if (vy < -2.5) {
          const p = project(x, 0.1, knockZ + 0.4);
          dust(p.x, p.y, 10, 1.4);
          sfx("thud", { volume: 0.5, pitch: -6 });
          shake.add(0.15);
          vy = -vy * 0.3;
        } else vy = 0;
      }
      if (crashO) {
        // The thing you hit reacts too: a hurdle topples away, a sign rocks, a box shudders.
        const g = crashO.group;
        const t = deadT;
        if (crashO.kind === "bar") g.rotation.x = -1.45 * Math.min(1, (t / 0.28) ** 2) + (t > 0.28 ? Math.sin((t - 0.28) * 30) * 0.1 * Math.exp(-(t - 0.28) * 8) : 0);
        else if (crashO.kind === "gate") g.rotation.x = -0.3 * Math.sin(t * 13) * Math.exp(-t * 3.5);
        else g.rotation.z = 0.05 * Math.sin(t * 34) * Math.exp(-t * 7);
      }
      if (!endSent && deadT > 0.55 && mode === "play") {
        endSent = true;
        session.end(score(), { outcome: "lose", stats: { distance: Math.floor(distance), bolts: boltsTaken, streak: bestStreak } });
      }
      if (mode === "attract" && deadT > 1.4) reset("attract");
    }
    xs.target = (lane - 1) * LANE;
    x = xs.update(dt);
    lean = damp(lean, clamp(xs.velocity / 12, -1, 1), 18, dt);

    // Collisions.
    if (alive) {
      const h = slideT > 0 || slamming ? SLIDE_H : STAND_H;
      for (const o of obstacles) {
        const ox = (o.lane - 1) * LANE;
        const off = Math.abs(ox - x);
        if (o.z - o.hz > 0.3) {
          if (!o.passed) {
            o.passed = true;
            if (mode === "play" && !o.scraped) {
              const p = project(ox, 2.2, 0);
              if (off < 0.6) {
                // Cleared it in your own lane: hurdled, slid under, or vaulted a rover.
                if (o.kind === "rover") {
                  points += 50 * mult();
                  popups.add(`VAULT +${50 * mult()}`, p.x, p.y, ACCENT, 17, 0.8);
                  addStreak(3);
                } else addStreak(1);
              } else if (o.close) {
                popups.add("CLOSE", p.x, p.y, "#F3F0E8", 15, 0.6);
                sfx("whoosh", { volume: 0.5, pitch: 7 });
                addStreak(1);
              }
            }
          }
          continue;
        }
        if (off > 1.05 || o.scraped || o.z + o.hz < -0.3) continue;
        const hit = o.kind === "gate" ? y + h > 1.18 : y < TOP[o.kind];
        if (!hit) continue;
        if (off > SCRAPE_OFF) {
          scrape(o, ox);
          continue;
        }
        crash(o);
        break;
      }
      for (const b of bolts) {
        if (b.taken || Math.abs(b.z) > 0.7) continue;
        if (Math.abs((b.lane - 1) * LANE - x) > 0.8 || Math.abs(b.y - (y + (slideT > 0 ? 0.45 : 0.9))) > 1.2) continue;
        b.taken = true;
        if (mode === "play") {
          boltsTaken++;
          const m = mult();
          points += 10 * m;
          sfx("coin", { pitch: b.index * 2 });
          const p = project(b.mesh.position.x, b.y, b.z);
          popups.add(`+${10 * m}`, p.x, p.y - 10, ACCENT, 16, 0.6);
          fx.emit(p.x, p.y, { count: 8, speed: [60, 180], life: [0.2, 0.45], size: [2, 4], colors: [ACCENT, "#FFD166"], drag: 3 });
          const left = (lines.get(b.line) ?? -1) - 1;
          lines.set(b.line, left < 0 ? -1 : left);
          if (left === 0) {
            points += 25 * m;
            popups.add(`LINE +${25 * m}`, p.x, p.y - 34, "#F3F0E8", 15, 0.8);
            sfx("score", { volume: 0.8 });
          }
        }
      }
    }

    // Pose.
    runner.root.position.set(x, y, knockZ);
    const lying = deadT >= 0 ? clamp(deadT / 0.42) : 0;
    const shadowK = 1 - Math.min(0.6, y * 0.25);
    runner.shadow.position.set(x, 0.02, knockZ);
    runner.shadow.scale.set(shadowK, shadowK * (1 + lying * 0.9), 1);
    pose.phase = phase;
    pose.air = damp(pose.air, airborne && alive ? 1 : 0, 16, dt);
    pose.fall = clamp(-vy / 10, -1, 1);
    pose.slide = damp(pose.slide, slideT > 0 ? 1 : 0, slideT > 0 ? 24 : 10, dt);
    pose.lean = lean;
    squash.update(dt);
    pose.squash = clamp(squash.value, 0.72, 1.25);
    pose.stagger = stagger;
    pose.dead = deadT >= 0 ? deadT + 1e-4 : 0;
    runner.pose(pose);

    // Camera: trails the lane change, rises with a jump, dips on a hard landing, widens with speed.
    camX = damp(camX, x * 0.55, 7, rawDt);
    camY = damp(camY, (mode === "attract" ? 3.7 : 3.55) + y * 0.38 + (deadT >= 0 ? 0.5 : 0), 7, rawDt);
    // Ease back on a crash so the tumble stays in frame.
    camZ = damp(camZ, deadT >= 0 ? 7.3 : 6.4, 4, rawDt);
    const d = dip.update(rawDt);
    camRoll = damp(camRoll, reduced ? 0 : -xs.velocity * 0.003, 10, rawDt);
    speedFov = damp(speedFov, (speed - 14) * 0.38, 2, rawDt);
    const o = shake.offset;
    camera.fov = 64 + speedFov;
    camera.updateProjectionMatrix();
    camera.position.set(camX + o.x * 0.01, camY + d + o.y * 0.01, camZ);
    lookY = damp(lookY, mode === "attract" ? 2.7 : 1.15 + y * 0.3, 3, rawDt);
    camera.lookAt(camX * 0.8, lookY + d * 0.4, -9);
    camera.rotation.z += o.angle + camRoll;
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

  /** Streaks flying out of the vanishing point once you're properly moving. */
  function speedLines(g: CanvasRenderingContext2D) {
    const k = clamp((speed - 18) / 12);
    if (k <= 0 || reduced || deadT >= 0) return;
    const vp = project(camX * 0.8, 1.4, -60);
    const R = Math.hypot(W, H) * 0.62;
    g.save();
    g.strokeStyle = rgba("#F3F0E8", 0.07 + 0.11 * k);
    g.lineWidth = 1.5;
    g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const cyc = time * 2.4 + i * 0.618;
      const u = cyc % 1;
      const seed = Math.floor(cyc) * 7.13 + i * 3.71;
      const a = Math.abs(Math.sin(seed) * 43758.5453) % 1;
      const ang = a * Math.PI * 2;
      // Keep clear of the runner below the vanishing point.
      if (Math.abs(ang - Math.PI / 2) < 0.55) continue;
      const r0 = R * (0.4 + u * 0.55);
      const len = R * (0.05 + 0.12 * u) * k;
      const cx = Math.cos(ang);
      const cy = Math.sin(ang);
      g.moveTo(vp.x + cx * r0, vp.y + cy * r0);
      g.lineTo(vp.x + cx * (r0 + len), vp.y + cy * (r0 + len));
    }
    g.stroke();
    g.restore();
  }

  function drawStreak(g: CanvasRenderingContext2D, cx: number, cy: number) {
    const m = mult();
    const pop = 1 + multPop * 0.35;
    g.save();
    g.translate(cx, cy);
    g.scale(pop, pop);
    g.fillStyle = "rgba(13,13,16,0.55)";
    roundRect(g, -46, -13, 92, 26, 13);
    g.fill();
    drawNumber(g, `×${m}`, -20, 1, 15, m > 1 ? ACCENT : "#F3F0E8");
    const filled = pips();
    for (let i = 0; i < PIPS; i++) {
      g.fillStyle = i < filled ? ACCENT : "rgba(243,240,232,0.25)";
      g.fillRect(2 + i * 8, -3, 5, 6);
    }
    g.restore();
  }

  function drawHud() {
    stage.beginHud();
    const g = hud;
    if (mode === "play") speedLines(g);
    fx.draw(g);
    popups.draw(g, FONT_MONO);
    if (flash > 0) {
      g.fillStyle = rgba("#F3F0E8", flash * 0.22);
      g.fillRect(0, 0, W, H);
    }
    if (mode === "play") {
      if (session.phase === "playing") {
        const top = session.play().top;
        drawNumber(g, Math.round(counter.shown), W / 2, top + 46, 44, "#F3F0E8");
        drawLabel(g, `${Math.floor(distance)} M · ${boltsTaken} ${boltsTaken === 1 ? "BOLT" : "BOLTS"}`, W / 2, top + 80, rgba("#F3F0E8", 0.8), 11);
        drawStreak(g, W / 2, top + 108);
      } else if (session.standalone && session.phaseTime > 0.7) {
        // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
        const r = safeRect(session.preview(), W, H);
        drawNumber(g, score(), r.x + r.w / 2, r.y + 64, 56, "#F3F0E8");
        drawLabel(g, `${Math.floor(distance)} M · ${boltsTaken} ${boltsTaken === 1 ? "BOLT" : "BOLTS"} · STREAK ${bestStreak}`, r.x + r.w / 2, r.y + 100, rgba("#F3F0E8", 0.8), 11);
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
    drawTitle(g, "DUSKRAIL", 0, 0, r.w - 6, "#F3F0E8", 52, ACCENT);
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
  // Compile every shader variant up front (each obstacle solid and faded, a bolt) so no frame after ready() stalls.
  const warm = (["bar", "gate", "crate", "rover", "gate", "crate", "rover"] as const).map((k, i) => {
    const g = world.makeObstacle(k, i % 3);
    g.position.z = -20;
    if (i > 3) world.fadeObstacle(g, 0.5);
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
