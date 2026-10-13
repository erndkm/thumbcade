import {
  clamp,
  Counter,
  createAudio,
  createRng,
  createSession,
  damp,
  dampAngle,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  FONT_MONO,
  HitStop,
  loadFonts,
  midiToFreq,
  mix,
  onDrag,
  onKeys,
  Particles,
  PENTATONIC,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createStage } from "./stage.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const ACCENT = "#FFE14D";
const HAZARD = "#FF3B30";
const SEGMENTS = 12;
const STEP = (Math.PI * 2) / SEGMENTS;
const R_IN = 0.5;
const R_OUT = 2.3;
const THICK = 0.34;
const SPACING = 2.7;
const BALL_R = 0.26;
const BALL_Z = 1.5;
const GRAVITY = 19;
const BOUNCE = 6.6;
const SMASH_STREAK = 3;
const ZONES = ["#2EC4B6", "#FF7A59", "#8FD3FF", "#B5E655", "#F7A8C6", "#FFB86B"];
const DRAG_K = 0.0115;
/** The heat front descends from above; it starts lenient and speeds up with progress. */
const heatSpeed = (passed: number) => 1.05 + 1.55 * clamp(passed / 45);

type Kind = "solid" | "gap" | "hazard";

interface Ring {
  index: number;
  y: number;
  group: Group;
  kinds: Kind[];
  /** Extra rotation of this ring (some rings drift on their own later on). */
  own: number;
  drift: number;
  wedges: Array<Mesh | null>;
  broken: boolean;
}

interface Shard {
  mesh: Mesh;
  vel: Vector3;
  spin: number;
  life: number;
}

/** One wedge geometry spanning φ ∈ [0, STEP) (φ = atan2(x, z)), with a hairline gap between wedges. */
function wedgeGeometry(): ExtrudeGeometry {
  const pad = 0.012;
  const shape = new Shape();
  shape.absarc(0, 0, R_OUT, pad, STEP - pad, false);
  shape.absarc(0, 0, R_IN, STEP - pad, pad, true);
  const g = new ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  g.rotateY(-Math.PI / 2);
  g.translate(0, -THICK / 2, 0);
  return g;
}

function stripeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3A3F4D";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#4C5263";
  for (let i = -64; i < 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 64);
    g.lineTo(i + 8, 64);
    g.lineTo(i + 72, 0);
    g.lineTo(i + 64, 0);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(3, 60);
  t.colorSpace = SRGBColorSpace;
  return t;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "helix-fall" }), loadFonts()]);

  const bg = document.createElement("canvas");
  bg.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block";
  document.body.appendChild(bg);
  const bgx = bg.getContext("2d", { alpha: false })!;
  const stage = createStage({ alpha: true, clear: 0x000000 });
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;
  const sizeBg = () => {
    bg.width = Math.round(W);
    bg.height = Math.round(H);
  };
  sizeBg();

  const scene = new Scene();
  const camera = new PerspectiveCamera(56, W / H, 0.1, 200);
  stage.onResize((w, h) => {
    W = w;
    H = h;
    sizeBg();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  scene.add(new HemisphereLight("#FFF4E0", "#1B1530", 2));
  const key = new DirectionalLight("#FFFFFF", 1.4);
  key.position.set(3, 8, 6);
  scene.add(key);

  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.03, 1.8, session.reducedMotion);
  const hitStop = new HitStop();
  const fx = new Particles(600);
  const popups = new Popups();
  const counter = new Counter(0, 18);

  // Tower.
  const tower = new Group();
  scene.add(tower);
  const pillar = new Mesh(new CylinderGeometry(R_IN - 0.06, R_IN - 0.06, 400, 24, 1, true), new MeshLambertMaterial({ map: stripeTexture() }));
  tower.add(pillar);
  const wedgeGeo = wedgeGeometry();
  // Two tones per zone so stacked rings read apart.
  const zoneMats = ZONES.map((c) => [new MeshLambertMaterial({ color: c }), new MeshLambertMaterial({ color: new Color(c).offsetHSL(0, -0.05, -0.07) })] as const);
  const hazardMat = new MeshLambertMaterial({ color: HAZARD, emissive: new Color(HAZARD), emissiveIntensity: 0.55 });

  // Ball.
  const ballMat = new MeshLambertMaterial({ color: ACCENT, emissive: new Color(ACCENT), emissiveIntensity: 0.25 });
  const ball = new Mesh(new SphereGeometry(BALL_R, 24, 16), ballMat);
  scene.add(ball);
  // Heat front: a glowing disc with a fading column of heat above it.
  const heat = new Group();
  const heatDisc = new Mesh(new CircleGeometry(3.4, 40), new MeshBasicMaterial({ color: "#FF4A3D", transparent: true, opacity: 0.88, depthWrite: false }));
  heatDisc.rotation.x = -Math.PI / 2;
  heat.add(heatDisc);
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 128;
    const g = c.getContext("2d")!;
    const lg = g.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0, "rgba(255,74,61,0)");
    lg.addColorStop(1, "rgba(255,120,61,0.75)");
    g.fillStyle = lg;
    g.fillRect(0, 0, 4, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const heatColumn = new Mesh(new CylinderGeometry(3.4, 3.4, 6, 40, 1, true), new MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, side: DoubleSide }));
  heatColumn.position.y = 3;
  heat.add(heatColumn);
  heat.visible = false;
  scene.add(heat);
  const splatGeo = new CircleGeometry(0.22, 14);
  splatGeo.rotateX(-Math.PI / 2);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let rings: Ring[] = [];
  let shards: Shard[] = [];
  let splats: Array<{ mesh: Mesh; life: number }> = [];
  let towerRot = 0;
  let ballY = 0;
  let vy = 0;
  let squash = 0;
  let streak = 0;
  let score = 0;
  let passed = 0;
  let deadT = -1;
  let endSent = false;
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let camY = 0;
  let titleIn = 0;
  let nextIndex = 0;
  let dragFrom: number | null = null;
  let heatY = Infinity;

  const zoneOf = (i: number) => Math.floor(i / 10) % ZONES.length;

  function makeRing(index: number): Ring {
    const kinds: Kind[] = new Array<Kind>(SEGMENTS).fill("solid");
    const n = mode === "attract" ? 6 + (index % 10) : index;
    {
      const gapLen = n < 8 ? 3 : n < 22 ? (rng.chance(0.5) ? 2 : 3) : rng.chance(0.65) ? 1 : 2;
      // The first ring keeps solid ground under the ball (segment 0) so a run never starts mid-air.
      const gapAt = index === 0 ? 5 : rng.int(0, SEGMENTS - 1);
      for (let k = 0; k < gapLen; k++) kinds[(gapAt + k) % SEGMENTS] = "gap";
      const hazards = index === 0 ? 0 : Math.min(5, Math.max(0, Math.floor((n - 1) / 4)));
      for (let k = 0; k < hazards; k++) {
        const at = rng.int(0, SEGMENTS - 1);
        if (kinds[at] === "solid") kinds[at] = "hazard";
      }
    }
    const group = new Group();
    const mat = zoneMats[zoneOf(index)]![index % 2]!;
    const wedges: Array<Mesh | null> = kinds.map((k, i) => {
      if (k === "gap") return null;
      const m = new Mesh(wedgeGeo, k === "hazard" ? hazardMat : mat);
      m.rotation.y = i * STEP;
      group.add(m);
      return m;
    });
    const y = -index * SPACING;
    group.position.y = y;
    tower.add(group);
    const drift = n > 26 && rng.chance(0.35) ? rng.range(0.25, 0.6) * (rng.chance(0.5) ? 1 : -1) : 0;
    return { index, y, group, kinds, own: rng.range(0, Math.PI * 2), drift, wedges, broken: false };
  }

  function disposeRing(r: Ring) {
    r.group.removeFromParent();
  }

  function reset(m: "attract" | "play") {
    mode = m;
    for (const r of rings) disposeRing(r);
    for (const s of shards) s.mesh.removeFromParent();
    for (const s of splats) s.mesh.removeFromParent();
    rings = [];
    shards = [];
    splats = [];
    nextIndex = 0;
    while (nextIndex < 9) rings.push(makeRing(nextIndex++));
    // The first ring is solid all round; make sure the ball doesn't start over its seam.
    rings[0]!.own = 0;
    towerRot = 0;
    ballY = rings[0]!.y + THICK / 2 + BALL_R + 0.6;
    vy = 0;
    streak = 0;
    score = 0;
    passed = 0;
    deadT = -1;
    endSent = false;
    counter.snap(0);
    camY = ballY;
    ballMat.emissive.set(ACCENT);
    ball.visible = true;
    heatY = m === "play" ? ballY + SPACING * 3 : Infinity;
    heat.visible = m === "play";
  }

  /** The segment of `ring` currently under the ball (the ball sits at φ = 0). */
  function segmentUnderBall(r: Ring): number {
    let local = -(towerRot + r.own);
    local = ((local % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(local / STEP) % SEGMENTS;
  }

  const tmp = new Vector3();
  function toScreen(x: number, y: number, z: number) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
  }

  function shatter(r: Ring, strong: boolean) {
    r.broken = true;
    r.wedges.forEach((w, i) => {
      if (!w) return;
      const ang = i * STEP + STEP / 2 + towerRot + r.own;
      w.removeFromParent();
      w.position.set(0, r.y, 0);
      w.rotation.y = i * STEP + towerRot + r.own;
      scene.add(w);
      const out = new Vector3(Math.sin(ang), 0, Math.cos(ang));
      shards.push({ mesh: w, vel: out.multiplyScalar(strong ? rng.range(5, 9) : rng.range(2.5, 5)).setY(rng.range(1, 4)), spin: rng.range(-3, 3), life: 1.1 });
    });
    r.wedges = [];
  }

  function die(burnt = false) {
    deadT = 0;
    if (burnt) audio.play("explode", { volume: 0.7 });
    hitStop.freeze(0.1);
    shake.add(0.65);
    audio.play("hit");
    audio.play("lose");
    tc.feedback("impact");
    ball.visible = false;
    const p = toScreen(0, ballY, BALL_Z);
    fx.emit(p.x, p.y, { count: 40, speed: [120, 460], life: [0.4, 1], size: [3, 8], colors: [ACCENT, "#FFFFFF", HAZARD], gravity: 700, drag: 1.4, shape: "circle" });
  }

  // Input: a tap starts a run; dragging sideways spins the tower.
  session.startOnTap(window);
  onDrag(window, {
    start: () => {
      dragFrom = session.phase === "playing" ? towerRot : null;
    },
    move: (_x, _y, dx) => {
      if (dragFrom !== null && session.phase === "playing" && deadT < 0) towerRot = dragFrom + dx * DRAG_K;
    },
    end: () => {
      dragFrom = null;
    },
  });
  onKeys({
    left: () => session.phase === "playing" && (towerRot -= STEP),
    right: () => session.phase === "playing" && (towerRot += STEP),
  });
  session.on("start", () => reset("play"));
  session.on("cancel", () => {
    dragFrom = null;
  });

  // Attract pilot: turns the tower so the nearest gap below slides under the ball, steering around hazards.
  function pilot(dt: number) {
    const next = rings.find((r) => !r.broken && r.y < ballY - BALL_R);
    if (!next) return;
    let best = -1;
    let bestDist = Infinity;
    const cur = segmentUnderBall(next);
    next.kinds.forEach((k, i) => {
      if (k !== "gap") return;
      const d = Math.min((i - cur + SEGMENTS) % SEGMENTS, (cur - i + SEGMENTS) % SEGMENTS);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    if (best < 0) return;
    const target = -((best + 0.5) * STEP) - next.own;
    towerRot = dampAngle(towerRot, target, 4.2, dt);
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
    counter.set(score);
    counter.update(rawDt);

    if (mode === "attract") pilot(dt);
    for (const r of rings) {
      if (r.drift) r.own += r.drift * dt;
      r.group.rotation.y = r.own;
    }
    tower.rotation.y = towerRot;
    hazardMat.emissiveIntensity = 0.45 + 0.25 * Math.sin(time * 8);

    if (deadT < 0) {
      const prevBottom = ballY - BALL_R;
      vy -= GRAVITY * dt;
      ballY += vy * dt;
      const bottom = ballY - BALL_R;
      for (const r of rings) {
        if (r.broken) continue;
        const top = r.y + THICK / 2;
        if (!(prevBottom >= top && bottom < top)) continue;
        const seg = segmentUnderBall(r);
        const kind = r.kinds[seg]!;
        if (kind === "gap") {
          // Through the gap.
          streak++;
          passed++;
          shatter(r, false);
          if (mode === "play") {
            score += streak;
            audio.note(midiToFreq(67 + PENTATONIC[Math.min(streak - 1, PENTATONIC.length - 1)]!), 0.18, "triangle", 0.28);
            const p = toScreen(0, top, BALL_Z);
            popups.add(`+${streak}`, p.x + 34, p.y - 12, streak >= SMASH_STREAK ? ACCENT : "#F3F0E8", 18 + Math.min(10, streak * 2));
            if (streak === SMASH_STREAK) {
              audio.play("powerup");
              tc.feedback("success");
            }
          }
          continue;
        }
        if (streak >= SMASH_STREAK) {
          // Smash straight through whatever is there, hazards included.
          shatter(r, true);
          passed++;
          shake.add(0.35);
          hitStop.freeze(0.04);
          if (mode === "play") {
            score += streak * 2;
            audio.play("explode", { volume: 0.6 });
            tc.feedback("impact");
            const p = toScreen(0, top, BALL_Z);
            popups.add("SMASH", p.x, p.y - 30, ACCENT, 24, 0.9);
            fx.emit(p.x, p.y, { count: 30, speed: [160, 420], life: [0.3, 0.7], size: [3, 7], colors: [ACCENT, ZONES[zoneOf(r.index)]!, "#FFFFFF"], drag: 2 });
          }
          streak = 0;
          vy = BOUNCE * 0.6;
          continue;
        }
        if (kind === "hazard") {
          ballY = top + BALL_R;
          if (mode === "play") die();
          else reset("attract");
          break;
        }
        // Solid: bounce, leave a splat.
        ballY = top + BALL_R;
        vy = BOUNCE;
        squash = 1;
        streak = 0;
        const w = r.wedges[seg];
        if (w) {
          const splat = new Mesh(splatGeo, new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }));
          // Place in the wedge's local frame at the ball's angle.
          const local = -(towerRot + r.own) - seg * STEP;
          splat.position.set(Math.sin(local) * BALL_Z, THICK / 2 + 0.005, Math.cos(local) * BALL_Z);
          splat.scale.setScalar(rng.range(0.8, 1.25));
          w.add(splat);
          splats.push({ mesh: splat, life: 1.6 });
        }
        if (mode === "play") {
          audio.play("pop", { pitch: rng.range(-2, 2) });
          tc.feedback("tap");
        }
        break;
      }
      if (mode === "play" && deadT < 0) {
        heatY = Math.min(heatY - heatSpeed(passed) * dt, ballY + SPACING * 3.2);
        if (heatY <= ballY + BALL_R) die(true);
      }
    } else {
      deadT += rawDt;
      if (!endSent && deadT > 0.45) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { rings: passed } });
      }
    }

    // Spawn below, recycle above.
    const lowest = rings[rings.length - 1];
    if (lowest && lowest.y > ballY - SPACING * 7) rings.push(makeRing(nextIndex++));
    rings = rings.filter((r) => {
      if (r.y < ballY + SPACING * 3) return true;
      disposeRing(r);
      return false;
    });
    for (const s of shards) {
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.y += s.spin * dt;
      s.mesh.rotation.x += s.spin * 0.6 * dt;
      s.life -= rawDt;
      s.mesh.scale.setScalar(Math.max(0.01, s.life / 1.1));
    }
    shards = shards.filter((s) => {
      if (s.life > 0) return true;
      s.mesh.removeFromParent();
      return false;
    });
    for (const s of splats) {
      s.life -= rawDt;
      (s.mesh.material as MeshBasicMaterial).opacity = clamp(s.life / 0.6) * 0.9;
    }
    splats = splats.filter((s) => {
      if (s.life > 0) return true;
      s.mesh.removeFromParent();
      (s.mesh.material as MeshBasicMaterial).dispose();
      return false;
    });

    // Ball: squash on bounce, glow while on a streak.
    squash = damp(squash, 0, 12, rawDt);
    const stretch = clamp(Math.abs(vy) / 16) * 0.25;
    ball.position.set(0, ballY, BALL_Z);
    ball.scale.set(1 + squash * 0.3 - stretch * 0.4, 1 - squash * 0.35 + stretch, 1 + squash * 0.3 - stretch * 0.4);
    const hot = streak >= SMASH_STREAK;
    ballMat.emissiveIntensity = hot ? 0.9 + 0.3 * Math.sin(time * 30) : 0.25;
    ballMat.emissive.set(hot ? "#FFFFFF" : ACCENT);
    if (hot && deadT < 0) {
      const p = toScreen(0, ballY, BALL_Z);
      fx.emit(p.x, p.y - 4, { count: 2, speed: [20, 80], angle: [-Math.PI * 0.75, -Math.PI * 0.25], life: [0.2, 0.45], size: [3, 6], colors: [ACCENT, "#FFFFFF", "#FFB86B"], drag: 2, shape: "circle" });
    }

    if (heat.visible) {
      heat.position.y = heatY;
      heat.rotation.y = time * 0.6;
      (heatDisc.material as MeshBasicMaterial).opacity = 0.75 + 0.15 * Math.sin(time * 9);
      if (deadT < 0 && rng.chance(0.5)) {
        const p = toScreen(rng.range(-2.6, 2.6), heatY, rng.range(-1, 2.6));
        if (p.y > 0 && p.y < H) fx.emit(p.x, p.y, { count: 1, speed: [20, 70], angle: [Math.PI * 0.35, Math.PI * 0.65], life: [0.4, 0.9], size: [2, 4], colors: ["#FF4A3D", "#FFB86B", ACCENT], gravity: 120 });
      }
    }

    // Camera follows the ball down (never up, so bounces read).
    camY = Math.min(damp(camY, ballY, 5, rawDt), camY);
    if (ballY < camY - 0.5) camY = damp(camY, ballY, 10, rawDt);
    const o = shake.offset;
    const lift = mode === "attract" ? 1.2 : 0;
    camera.position.set(o.x * 0.01, camY + 4.6 + lift, 9.6);
    camera.lookAt(0, camY - 0.9 + lift, 0);
    camera.rotation.z += o.angle;
  }

  function drawBackground() {
    const zone = ZONES[zoneOf(Math.max(0, Math.floor(-camY / SPACING)))]!;
    const g = bgx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0E0B1A");
    g.addColorStop(1, mix("#0E0B1A", zone, 0.22));
    bgx.fillStyle = g;
    bgx.fillRect(0, 0, W, H);
    // Motes rising past as you fall.
    const motes = createRng(3);
    for (let i = 0; i < 46; i++) {
      const x = motes() * W;
      const speed = 18 + motes() * 40;
      const y = (((motes() * H - camY * speed) % H) + H) % H;
      bgx.globalAlpha = 0.12 + motes() * 0.25;
      bgx.fillStyle = motes() < 0.3 ? zone : "#F3F0E8";
      const s = motes() < 0.2 ? 3 : 2;
      bgx.fillRect(x, y, s, s);
    }
    bgx.globalAlpha = 1;
  }

  function drawHud() {
    stage.beginHud();
    const g = hud;
    fx.draw(g);
    popups.draw(g, FONT_MONO);
    if (mode === "play") {
      const near = clamp(1 - (heatY - ballY) / (SPACING * 2.2));
      if (near > 0 && deadT < 0) {
        const v = g.createLinearGradient(0, 0, 0, H * 0.45);
        v.addColorStop(0, `rgba(255,74,61,${0.55 * near * (0.8 + 0.2 * Math.sin(time * 12))})`);
        v.addColorStop(1, "rgba(255,74,61,0)");
        g.fillStyle = v;
        g.fillRect(0, 0, W, H * 0.45);
      }
      if (session.phase === "playing") {
        const top = session.play().top;
        drawNumber(g, Math.round(counter.shown), W / 2, top + 46, 46, "#F3F0E8");
        // Streak meter: three pips, the third lights the smash.
        for (let i = 0; i < SMASH_STREAK; i++) {
          const on = Math.min(streak, SMASH_STREAK) > i;
          g.fillStyle = on ? ACCENT : "rgba(243,240,232,0.22)";
          g.fillRect(W / 2 - 26 + i * 20, top + 80, 12, 5);
        }
      } else if (session.standalone && session.phaseTime > 0.7) {
        // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
        const r = safeRect(session.preview(), W, H);
        drawNumber(g, score, r.x + r.w / 2, r.y + 64, 56, "#F3F0E8");
        g.fillStyle = "rgba(13,13,16,0.62)";
        roundRect(g, r.x + r.w / 2 - 118, r.y + r.h - 37, 236, 34, 17);
        g.fill();
        drawTapPrompt(g, r.x + r.w / 2, r.y + r.h - 20, time, "#F3F0E8", "TAP TO DROP AGAIN");
      }
      return;
    }
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const ty = r.y + 64;
    const k = easeOutBack(titleIn);
    g.save();
    g.translate(cx, ty);
    g.scale(k, k);
    g.rotate(-0.04);
    drawTitle(g, "HELIX FALL", 0, 0, r.w - 6, "#F3F0E8", 52, ACCENT);
    g.restore();
    drawLabel(g, "DRAG TO SPIN. MIND THE RED.", cx, ty + 30, rgba("#F3F0E8", 0.85), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 52, ACCENT, 13);
    g.fillStyle = "rgba(13,13,16,0.6)";
    roundRect(g, cx - 100, r.y + r.h - 37, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, r.y + r.h - 20, time, "#F3F0E8");
  }

  reset("attract");
  // Compile every shader variant up front (splat, heat front, hazard) so no frame after ready() stalls.
  const warmSplat = new Mesh(splatGeo, new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }));
  warmSplat.position.set(0, ballY, 0);
  scene.add(warmSplat);
  update(0);
  heat.visible = true;
  heat.position.y = ballY - SPACING;
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  heat.visible = false;
  warmSplat.removeFromParent();
  (warmSplat.material as MeshBasicMaterial).dispose();
  let frames = 0;
  tc.loop((dt) => {
    update(dt);
    drawBackground();
    renderer.render(scene, camera);
    drawHud();
    // ready() on the second frame: the first one pays for GPU uploads.
    if (++frames === 2) session.ready();
  });
}

void main();
