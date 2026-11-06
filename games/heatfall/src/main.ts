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
  Photosafe,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Path,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  Shape,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createStage } from "./stage.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const ACCENT = "#FFE14D";
/** The ember's own glow. */
const EMBER = "#FF8A3D";
/** Coolant vents: touching one quenches the ember. */
const COOLANT = "#3DE0FF";
const SEGMENTS = 12;
const STEP = (Math.PI * 2) / SEGMENTS;
const R_IN = 0.5;
const R_OUT = 2.3;
/** Gear teeth stick out this far past the rim. */
const TOOTH = 0.2;
const THICK = 0.34;
const SPACING = 2.7;
const BALL_R = 0.26;
const BALL_Z = 1.5;
const GRAVITY = 19;
const BOUNCE = 6.6;
/**
 * Charge: every gap stokes the ember (+1), every bounce bleeds one off. At full charge the ember melts through
 * the next grate it lands on, coolant included, and the blast vents the heat front back up the shaft.
 */
const CHARGE_MAX = 5;
const VENT = SPACING * 1.4;
/** Forge iron: a new alloy every ten grates. */
const ZONES = ["#5E6776", "#715F4F", "#536478", "#7A6B4E", "#655A6E", "#6C655A"];
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

/**
 * One grate segment spanning φ ∈ [0, STEP) (φ = atan2(x, z)), with a hairline gap between segments: a gear
 * tooth on the rim and two cooling slots either side of the ember's landing line.
 */
function wedgeGeometry(): ExtrudeGeometry {
  const pad = 0.012;
  const a0 = STEP * 0.3;
  const a1 = STEP * 0.7;
  const shape = new Shape();
  // Each arc starts with a straight line from the previous point, which gives the tooth its flanks.
  shape.absarc(0, 0, R_OUT, pad, a0, false);
  shape.absarc(0, 0, R_OUT + TOOTH, a0 + 0.04, a1 - 0.04, false);
  shape.absarc(0, 0, R_OUT, a1, STEP - pad, false);
  shape.absarc(0, 0, R_IN, STEP - pad, pad, true);
  const ux = Math.cos(STEP / 2);
  const uy = Math.sin(STEP / 2);
  const w = 0.05;
  for (const [r0, r1] of [
    [0.78, 1.16],
    [1.84, 2.12],
  ] as const) {
    const slot = new Path();
    slot.moveTo(r0 * ux - w * uy, r0 * uy + w * ux);
    slot.lineTo(r1 * ux - w * uy, r1 * uy + w * ux);
    slot.lineTo(r1 * ux + w * uy, r1 * uy - w * ux);
    slot.lineTo(r0 * ux + w * uy, r0 * uy - w * ux);
    slot.closePath();
    shape.holes.push(slot);
  }
  const g = new ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  g.rotateY(-Math.PI / 2);
  g.translate(0, -THICK / 2, 0);
  return g;
}

/** Coolant vents: cyan chevrons on deep teal, also used as their emissive map so they glow. */
function coolantTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#06343C";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = COOLANT;
  for (let y = -16; y < 80; y += 16) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(32, y + 10);
    g.lineTo(64, y);
    g.lineTo(64, y + 6);
    g.lineTo(32, y + 16);
    g.lineTo(0, y + 6);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(1.6, 1.6);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Soft round glow for the ember's halo. */
function glowSprite(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,0.9)");
  r.addColorStop(0.35, "rgba(255,255,255,0.35)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "heatfall" }), loadFonts()]);

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
  // Cool light from the shaft mouth above, forge glow from below.
  scene.add(new HemisphereLight("#E6EEFF", "#C2552A", 2));
  const key = new DirectionalLight("#FFFFFF", 1.4);
  key.position.set(3, 8, 6);
  scene.add(key);

  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.03, 1.8, session.reducedMotion);
  // Glows and the heat front pulse at most 2 Hz (and hold still under reduced motion): see the kit's photosafe.
  const light = new Photosafe(session.reducedMotion);
  const hitStop = new HitStop();
  const fx = new Particles(600);
  const popups = new Popups();
  const counter = new Counter(0, 18);

  // The forge: grates on a hexagonal drive shaft.
  const tower = new Group();
  scene.add(tower);
  const steel = new MeshLambertMaterial({ color: "#3E434D", flatShading: true });
  const shaft = new Mesh(new CylinderGeometry(0.2, 0.2, 400, 6, 1, true), steel);
  tower.add(shaft);
  // Every grate sits on a hex hub nut.
  const hubGeo = new CylinderGeometry(R_IN + 0.04, R_IN + 0.04, THICK + 0.1, 6);
  const wedgeGeo = wedgeGeometry();
  // Two tones per zone so stacked grates read apart.
  const zoneMats = ZONES.map((c) => [new MeshLambertMaterial({ color: c }), new MeshLambertMaterial({ color: new Color(c).offsetHSL(0, -0.05, -0.07) })] as const);
  const coolantTex = coolantTexture();
  const hazardMat = new MeshLambertMaterial({ map: coolantTex, emissive: new Color(COOLANT), emissiveMap: coolantTex, emissiveIntensity: 0.55 });

  // The ember: a faceted coal with a halo, hotter the more charge it carries.
  const ballMat = new MeshLambertMaterial({ color: "#B4521F", emissive: new Color(EMBER), emissiveIntensity: 0.4, flatShading: true });
  const ball = new Mesh(new IcosahedronGeometry(BALL_R * 1.08, 1), ballMat);
  scene.add(ball);
  const halo = new Sprite(new SpriteMaterial({ map: glowSprite(), color: EMBER, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(BALL_R * 6);
  scene.add(halo);
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

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let rings: Ring[] = [];
  let shards: Shard[] = [];
  let towerRot = 0;
  let ballY = 0;
  let vy = 0;
  let squash = 0;
  let charge = 0;
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
    group.add(new Mesh(hubGeo, steel));
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
    rings = [];
    shards = [];
    nextIndex = 0;
    while (nextIndex < 9) rings.push(makeRing(nextIndex++));
    // The first ring is solid all round; make sure the ball doesn't start over its seam.
    rings[0]!.own = 0;
    towerRot = 0;
    ballY = rings[0]!.y + THICK / 2 + BALL_R + 0.6;
    vy = 0;
    charge = 0;
    score = 0;
    passed = 0;
    deadT = -1;
    endSent = false;
    counter.snap(0);
    camY = ballY;
    ballMat.emissive.set(EMBER);
    ball.visible = true;
    halo.visible = true;
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
    halo.visible = false;
    const p = toScreen(0, ballY, BALL_Z);
    // Burnt: a shower of sparks. Quenched: steam and a few dying sparks.
    const colors = burnt ? [EMBER, ACCENT, "#FFFFFF"] : ["#E8F6FA", "#9FD8E6", COOLANT, EMBER];
    fx.emit(p.x, p.y, { count: 40, speed: [120, 460], life: [0.4, 1], size: [3, 8], colors, gravity: burnt ? 700 : -60, drag: 1.4, shape: "circle" });
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
    hazardMat.emissiveIntensity = 0.25 + 0.4 * light.pulse(time, 0.8, { still: 0.5 });

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
          // Through the gap: the drop stokes the ember. Points grow with the charge it already carries.
          const before = charge;
          const points = 1 + before;
          charge = Math.min(CHARGE_MAX, charge + 1);
          passed++;
          shatter(r, false);
          if (mode === "play") {
            score += points;
            audio.note(midiToFreq(67 + PENTATONIC[Math.min(charge - 1, PENTATONIC.length - 1)]!), 0.18, "triangle", 0.28);
            const p = toScreen(0, top, BALL_Z);
            popups.add(`+${points}`, p.x + 34, p.y - 12, charge >= CHARGE_MAX ? ACCENT : "#F3F0E8", 18 + Math.min(10, points * 2));
            if (charge === CHARGE_MAX && before < CHARGE_MAX) {
              audio.play("powerup");
              tc.feedback("success");
            }
          }
          continue;
        }
        if (charge >= CHARGE_MAX) {
          // White-hot: melt through whatever is there, coolant included. The blast vents the heat front upward.
          shatter(r, true);
          passed++;
          shake.add(0.35);
          hitStop.freeze(0.04);
          if (mode === "play") {
            score += CHARGE_MAX * 2;
            heatY = Math.min(heatY + VENT, ballY + SPACING * 3.2);
            audio.play("explode", { volume: 0.6 });
            tc.feedback("impact");
            const p = toScreen(0, top, BALL_Z);
            popups.add("MELT", p.x, p.y - 30, ACCENT, 24, 0.9);
            fx.emit(p.x, p.y, { count: 30, speed: [160, 420], life: [0.3, 0.7], size: [3, 7], colors: [ACCENT, EMBER, "#FFFFFF"], drag: 2 });
          }
          charge = 0;
          vy = BOUNCE * 0.6;
          continue;
        }
        if (kind === "hazard") {
          ballY = top + BALL_R;
          if (mode === "play") die();
          else reset("attract");
          break;
        }
        // Solid: bounce off the grate in a spray of sparks; the contact bleeds one charge.
        ballY = top + BALL_R;
        vy = BOUNCE;
        squash = 1;
        charge = Math.max(0, charge - 1);
        const p = toScreen(0, top, BALL_Z);
        fx.emit(p.x, p.y, { count: 7, speed: [60, 210], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.15, 0.35], size: [2, 3.5], colors: [EMBER, "#FFD9A0"], gravity: 520, drag: 2 });
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
    // Ember: squash on bounce, tumble as it falls, glow brighter with every charge; white-hot when full.
    squash = damp(squash, 0, 12, rawDt);
    const stretch = clamp(Math.abs(vy) / 16) * 0.25;
    ball.position.set(0, ballY, BALL_Z);
    ball.scale.set(1 + squash * 0.3 - stretch * 0.4, 1 - squash * 0.35 + stretch, 1 + squash * 0.3 - stretch * 0.4);
    ball.rotation.x += dt * 2.4;
    ball.rotation.z += dt * 1.1;
    const hot = charge >= CHARGE_MAX;
    const glow = charge / CHARGE_MAX;
    ballMat.emissive.set(hot ? "#FFF2D6" : EMBER);
    ballMat.emissiveIntensity = hot ? 0.8 + 0.3 * light.pulse(time, 1.1, { still: 0.5 }) : 0.3 + glow * 0.5;
    halo.position.set(0, ballY, BALL_Z);
    halo.material.color.set(hot ? "#FFE3A8" : EMBER);
    halo.material.opacity = hot ? 0.95 : 0.45 + glow * 0.4;
    halo.scale.setScalar(BALL_R * (5 + glow * 3));
    if (hot && deadT < 0) {
      const p = toScreen(0, ballY, BALL_Z);
      fx.emit(p.x, p.y - 4, { count: 2, speed: [20, 80], angle: [-Math.PI * 0.75, -Math.PI * 0.25], life: [0.2, 0.45], size: [3, 6], colors: [ACCENT, "#FFFFFF", EMBER], drag: 2, shape: "circle" });
    }

    if (heat.visible) {
      heat.position.y = heatY;
      heat.rotation.y = time * 0.6;
      // A gentle shimmer: the disc can fill the top of the screen, so its swing stays under a 10% luminance change.
      (heatDisc.material as MeshBasicMaterial).opacity = 0.74 + 0.12 * light.pulse(time, 1.4, { still: 0.5 });
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
    g.addColorStop(0, "#0C0E13");
    g.addColorStop(0.6, mix("#140F10", zone, 0.12));
    g.addColorStop(1, "#2C1409");
    bgx.fillStyle = g;
    bgx.fillRect(0, 0, W, H);
    // Sparks rising up the shaft (they climb faster than you fall).
    const motes = createRng(3);
    for (let i = 0; i < 46; i++) {
      const x = motes() * W;
      const speed = 18 + motes() * 40;
      const y = (((motes() * H + camY * speed - time * 30) % H) + H) % H;
      bgx.globalAlpha = 0.14 + motes() * 0.3;
      bgx.fillStyle = motes() < 0.55 ? EMBER : "#FFD9A0";
      const s = motes() < 0.2 ? 3 : 2;
      bgx.fillRect(x, y, s, s);
    }
    bgx.globalAlpha = 1;
    // The shaft: riveted iron walls with cross braces, scrolling with the drop.
    const wall = Math.max(18, W * 0.06);
    const scroll = camY * 26;
    for (const x0 of [0, W - wall]) {
      bgx.fillStyle = "#16181E";
      bgx.fillRect(x0, 0, wall, H);
      bgx.fillStyle = "rgba(255,138,61,0.16)";
      bgx.fillRect(x0 === 0 ? wall - 2 : x0, 0, 2, H);
      const brace = 132;
      for (let y = (((scroll % brace) + brace) % brace) - brace; y < H; y += brace) {
        bgx.fillStyle = "#22252D";
        bgx.fillRect(x0, y, wall, 10);
        bgx.fillStyle = "#3A3F4A";
        for (const ry of [y + 30, y + 66, y + 102]) bgx.fillRect(x0 + wall / 2 - 2, ry, 4, 4);
      }
    }
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
        // Large red area: a modest ramp with a slow, shallow throb rather than a bright strobe.
        v.addColorStop(0, `rgba(255,74,61,${(0.32 * near * (0.7 + 0.3 * light.pulse(time, 1.2, { still: 0.5 }))).toFixed(3)})`);
        v.addColorStop(1, "rgba(255,74,61,0)");
        g.fillStyle = v;
        g.fillRect(0, 0, W, H * 0.45);
      }
      if (session.phase === "playing") {
        const top = session.play().top;
        drawNumber(g, Math.round(counter.shown), W / 2, top + 46, 46, "#F3F0E8");
        // Charge gauge: five pips; a full gauge melts the next grate.
        const full = charge >= CHARGE_MAX;
        for (let i = 0; i < CHARGE_MAX; i++) {
          g.fillStyle = i < charge ? (full ? ACCENT : EMBER) : "rgba(243,240,232,0.22)";
          g.fillRect(W / 2 - 44 + i * 18, top + 80, 12, 5);
        }
        if (full) drawLabel(g, "WHITE-HOT", W / 2, top + 100, ACCENT, 10);
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
    drawTitle(g, "HEATFALL", 0, 0, r.w - 6, "#F3F0E8", 52, ACCENT);
    g.restore();
    drawLabel(g, "DRAG TO SPIN. DODGE THE COOLANT.", cx, ty + 30, rgba("#F3F0E8", 0.85), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 52, ACCENT, 13);
    g.fillStyle = "rgba(13,13,16,0.6)";
    roundRect(g, cx - 100, r.y + r.h - 37, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, r.y + r.h - 20, time, "#F3F0E8");
  }

  reset("attract");
  // Compile every shader variant up front (grates, coolant, ember halo, heat front) so no frame after ready() stalls.
  update(0);
  heat.visible = true;
  heat.position.y = ballY - SPACING;
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  heat.visible = false;
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
