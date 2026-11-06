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
  easeOutCubic,
  FONT_DISPLAY,
  HitStop,
  lerp,
  loadFonts,
  onKeys,
  onPress,
  Particles,
  PENTATONIC,
  Photosafe,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Scene,
  SpotLight,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import {
  beamTexture,
  dartGeometry,
  DART_LEN,
  edgeTexture,
  EMBED,
  FACE_BOSS,
  FACE_HOUSE,
  faceTexture,
  HUB_R,
  K,
  OUT,
  R,
  rimArcGeometry,
  softDisc,
  STEP,
  THICK,
  wallTexture,
  wedgeGeometry,
} from "./disc.ts";
import { angleAt, stageSpec, type StageSpec } from "./stages.ts";
import { createStage } from "./stage.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const ACCENT = "#EE55FF";
const GOLD = "#FFD45C";
const LIT_HOT = new Color("#FFF4C8");
const PAPER = "#F3F0E8";
const HEAT = "#FF4A3D";
const BG = "#0B0814";
const DISC_Y = 1.9;
/** Tip of the loaded dart. */
const LAUNCH_Y = -3.9;
const DART_SPEED = 30;
/** Darts closer than this (rad) on the rim collide. */
const GAP = 0.15;
/** Half-width (rad) of a lit cell. */
const LIT_HALF = 0.19;
const LIT_POINTS = 3;
const BOSS_POINTS = 5;
const RELOAD = 0.13;
const WALL_Z = -2.6;
/** Where a thrown dart's tip meets the rim, and where it starts to meet darts already stuck. */
const CONTACT_Y = DISC_Y - R + EMBED;
const ZONE_Y = DISC_Y - R - OUT + 0.12;
const TAU = Math.PI * 2;
const wrap = (a: number) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};

const WHOOSH: SfxParams = { wave: "noise", freq: 900, freqEnd: 3200, attack: 0.01, duration: 0.13, volume: 0.22, highpass: 700 };
const THUNK: SfxParams = { wave: "sine", freq: 200, freqEnd: 70, duration: 0.11, volume: 0.6, punch: 2.4 };
const TINK: SfxParams = { wave: "square", freq: 2600, duration: 0.025, volume: 0.08, highpass: 1500 };
const CLANG_A: SfxParams = { wave: "square", freq: 1240, freqEnd: 1170, duration: 0.55, volume: 0.16, lowpass: 5200, vibrato: [0.25, 23], punch: 1.6 };
const CLANG_B: SfxParams = { wave: "triangle", freq: 1870, duration: 0.42, volume: 0.22, vibrato: [0.2, 17], punch: 1.8 };

interface Dart {
  mesh: Mesh;
  /** Local angle on the disc (once stuck). */
  a: number;
  shadow: Mesh | null;
}

interface Flying {
  mesh: Mesh;
  tipY: number;
  auto: boolean;
}

interface Debris {
  obj: Object3D;
  vel: Vector3;
  spin: Vector3;
  life: number;
  max: number;
  gravity: number;
}

interface Lit {
  a: number;
  mesh: Mesh;
  taken: number;
}

/** The kit's popups with a dark drop shadow under each one, so they read over bright blocks too. */
function drawPopupsShadowed(ctx: CanvasRenderingContext2D, popups: Popups, font: string, shadow: string): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of popups.items) {
    const k = p.t / p.life;
    const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4);
    const size = Math.round(p.size * pop);
    const y = p.y - k * 40;
    ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = shadow;
    ctx.fillText(p.text, p.x, y + Math.max(2, size * 0.09));
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "spindart" }), loadFonts()]);
  const stage = createStage({ clear: new Color(BG).getHex() });
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;

  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.03, 1.8, session.reducedMotion);
  // Flashes, flicker and pulses go through Photosafe: capped at 2 Hz, steady/faint under reduced motion.
  const light = new Photosafe(session.reducedMotion);
  const flash = light.flash({ alpha: 0.22, decay: 0.35 });
  const hitStop = new HitStop();
  const fx = new Particles(700);
  const popups = new Popups();
  const counter = new Counter(0, 16);
  const layoutT = new Spring(0, 150, 22);

  // ---------------------------------------------------------------------------
  // Scene: a dark arcade booth, a spotlight, the target disc in front of a slatted wall
  // ---------------------------------------------------------------------------
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, W / H, 0.5, 120);

  scene.add(new HemisphereLight("#9C8CFF", "#120A1C", 0.9));
  const key = new DirectionalLight("#FFF1E6", 1.5);
  key.position.set(-4, 7, 9);
  scene.add(key);
  const spot = new SpotLight("#FFE9D6", 4.2, 0, 0.42, 0.65, 0);
  spot.position.set(-1.5, 12, 6);
  spot.target.position.set(0, DISC_Y - 0.6, WALL_Z);
  scene.add(spot, spot.target);
  const neon = new PointLight(ACCENT, 2.4, 7, 0);
  neon.position.set(0, DISC_Y - 1.2, 1.6);
  scene.add(neon);

  const wallTex = wallTexture();
  wallTex.repeat.set(9, 9);
  const wall = new Mesh(new PlaneGeometry(48, 48), new MeshLambertMaterial({ map: wallTex }));
  wall.position.set(0, 2, WALL_Z);
  scene.add(wall);
  // Neon spill on the wall behind the disc.
  const spill = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ map: softDisc(), color: ACCENT, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false }));
  spill.position.set(0.2, DISC_Y - 0.2, WALL_Z + 0.02);
  scene.add(spill);
  // The light shaft from above.
  const beam = new Mesh(
    new CylinderGeometry(0.6, 4.2, 15, 28, 1, true),
    new MeshBasicMaterial({ map: beamTexture(), color: "#FFE9D6", transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  beam.position.set(-0.6, DISC_Y + 5.6, -0.6);
  beam.rotation.z = -0.12;
  scene.add(beam);

  // Shared disc parts.
  const wedgeGeo = wedgeGeometry();
  const rimGeo = rimArcGeometry();
  const edgeTex = edgeTexture();
  edgeTex.repeat.set(1.4, 2);
  const edgeMat = new MeshLambertMaterial({ map: edgeTex });
  const faceHouse = new MeshLambertMaterial({ map: faceTexture(FACE_HOUSE) });
  const faceBoss = new MeshLambertMaterial({ map: faceTexture(FACE_BOSS) });
  const rimMat = new MeshBasicMaterial({ color: ACCENT });
  const rimBossMat = new MeshBasicMaterial({ color: "#FF8AF6" });
  const hubGeo = new CylinderGeometry(HUB_R + 0.02, HUB_R + 0.02, THICK + 0.16, 6);
  hubGeo.rotateX(Math.PI / 2);
  const hubMat = new MeshPhongMaterial({ color: "#5C566B", specular: "#AAA4BC", shininess: 50, flatShading: true });
  const coreGeo = new CylinderGeometry(0.17, 0.2, 0.06, 18);
  coreGeo.rotateX(Math.PI / 2);
  coreGeo.translate(0, 0, THICK / 2 + 0.1);
  const coreMat = new MeshBasicMaterial({ color: ACCENT });
  const haloGeo = new PlaneGeometry((R + 1.1) * 2, (R + 1.1) * 2);
  const haloMat = new MeshBasicMaterial({
    map: softDisc(0, [
      [0, 0],
      [0.56, 0],
      [0.66, 0.85],
      [0.76, 0.25],
      [1, 0],
    ]),
    color: ACCENT,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const playerDart = dartGeometry(ACCENT, "#D9D4E6", "#A69FBA");
  const oldDart = dartGeometry("#5F566E", "#8C869C", "#6B6580");
  const dartMat = new MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: "#9A94AA" });
  const shadowTex = softDisc(0, [
    [0, 0.85],
    [0.8, 0.75],
    [1, 0],
  ]);
  const discShadowMat = new MeshBasicMaterial({ color: 0x000000, map: shadowTex, transparent: true, opacity: 0.55, depthWrite: false });
  const dartShadowGeo = new PlaneGeometry(0.2, OUT * 0.95);
  const dartShadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  const litMat = new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 1, depthWrite: false });
  const litGlowMat = new MeshBasicMaterial({
    map: softDisc(0, [
      [0, 0],
      [0.55, 0],
      [0.82, 0.9],
      [1, 0],
    ]),
    color: GOLD,
    transparent: true,
    opacity: 0.8,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const launchPad = new Mesh(
    new RingGeometry(0.16, 0.36, 28),
    new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  launchPad.rotation.x = -Math.PI / 2;
  launchPad.position.set(0, LAUNCH_Y - DART_LEN - 0.05, 0);
  scene.add(launchPad);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let titleIn = 0;
  let score = 0;
  let stageN = 1;
  let spec: StageSpec = stageSpec(1, rng);
  /** Stage time: drives the disc's motion. */
  let st = 0;
  let theta = 0;
  /** 0 → 1 while a new disc flies in. */
  let arrive = 0;
  let darts: Dart[] = [];
  let lits: Lit[] = [];
  let flying: Flying[] = [];
  let debris: Debris[] = [];
  let thrown = 0;
  let stuckNow = 0;
  let loaded = true;
  let reload = 0;
  let grip = 0;
  let clearT = -1;
  let deadT = -1;
  let endSent = false;
  let aiWait = 0.9;
  let totalStuck = 0;
  let litTaken = 0;
  let wobble = 0;
  let punch = 0;
  let waiting: Mesh | null = null;
  /** Seconds since the current dart was loaded (it slides up into place). */
  let loadT = 1;
  /** Attract: restart the demo after a miss. */
  let demoReset = -1;
  const tmp = new Vector3();

  const discRoot = new Group();
  discRoot.position.set(0, DISC_Y, 0);
  scene.add(discRoot);
  let spin = new Group();
  discRoot.add(spin);
  const halo = new Mesh(haloGeo, haloMat);
  halo.position.z = -THICK / 2 - 0.08;
  discRoot.add(halo);
  const shadowRoot = new Group();
  shadowRoot.position.set(0.5, DISC_Y - 0.62, WALL_Z + 0.03);
  scene.add(shadowRoot);
  const discShadow = new Mesh(new PlaneGeometry(R * 2.25, R * 2.25), discShadowMat);
  shadowRoot.add(discShadow);
  let shadowSpin = new Group();
  shadowRoot.add(shadowSpin);

  /** Frees the per-disc geometry and materials (lit cells); everything else is shared. */
  function disposeOwned(root: Object3D) {
    root.traverse((o) => {
      if (!o.userData.own) return;
      const m = o as Mesh;
      m.geometry.dispose();
      (m.material as Material).dispose();
    });
  }

  function dartMesh(old: boolean): Mesh {
    return new Mesh(old ? oldDart : playerDart, dartMat);
  }

  function stickDart(a: number, old: boolean, mesh?: Mesh): Dart {
    const m = mesh ?? dartMesh(old);
    m.position.set(Math.cos(a) * (R - EMBED), Math.sin(a) * (R - EMBED), 0);
    m.rotation.set(0, 0, a + Math.PI / 2);
    spin.add(m);
    const sh = new Mesh(dartShadowGeo, dartShadowMat);
    const rr = R + OUT * 0.5 - 0.05;
    sh.position.set(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    sh.rotation.z = a + Math.PI / 2;
    shadowSpin.add(sh);
    const d = { mesh: m, a, shadow: sh };
    darts.push(d);
    return d;
  }

  /** Builds a fresh disc for `spec` (chunks, hub, lit cells, pre-stuck darts). */
  function buildDisc() {
    disposeOwned(spin);
    spin.removeFromParent();
    shadowSpin.removeFromParent();
    spin = new Group();
    shadowSpin = new Group();
    discRoot.add(spin);
    shadowRoot.add(shadowSpin);
    darts = [];
    lits = [];
    const boss = !!spec.boss;
    const faceMats: Material[] = [boss ? faceBoss : faceHouse, edgeMat];
    for (let i = 0; i < K; i++) {
      const chunk = new Group();
      chunk.rotation.z = i * STEP;
      chunk.add(new Mesh(wedgeGeo, faceMats));
      chunk.add(new Mesh(rimGeo, boss ? rimBossMat : rimMat));
      chunk.userData.chunk = true;
      spin.add(chunk);
    }
    const hub = new Mesh(hubGeo, hubMat);
    hub.userData.chunk = true;
    spin.add(hub);
    const core = new Mesh(coreGeo, coreMat);
    core.userData.chunk = true;
    spin.add(core);
    // Pre-stuck darts, spread out so there is always room.
    const taken: number[] = [];
    const free = (a: number, gap: number) => taken.every((b) => Math.abs(wrap(a - b)) > gap);
    for (let i = 0; i < spec.stuck; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const a = rng.range(-Math.PI, Math.PI);
        if (!free(a, GAP * 2.6)) continue;
        taken.push(a);
        stickDart(a, true);
        break;
      }
    }
    for (let i = 0; i < spec.lit; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const a = rng.range(-Math.PI, Math.PI);
        if (!free(a, LIT_HALF + GAP * 1.5)) continue;
        taken.push(a);
        // A lit cell: a gold plate on the outer ring with a glow spilling past the rim.
        const mesh = new Mesh(new RingGeometry(R * 0.73, R * 0.96, 10, 1, a - LIT_HALF, LIT_HALF * 2), litMat.clone());
        mesh.position.z = THICK / 2 + 0.045;
        const glow = new Mesh(new RingGeometry(R * 0.6, R + 0.55, 12, 1, a - LIT_HALF * 1.3, LIT_HALF * 2.6), litGlowMat.clone());
        glow.position.z = 0.02;
        mesh.userData.own = true;
        glow.userData.own = true;
        mesh.add(glow);
        spin.add(mesh);
        lits.push({ a, mesh, taken: -1 });
        break;
      }
    }
  }

  function startStage(n: number) {
    stageN = n;
    spec = stageSpec(n, rng);
    st = 0;
    thrown = 0;
    stuckNow = 0;
    grip = 0;
    arrive = 0;
    clearT = -1;
    buildDisc();
    if (mode === "play") {
      const label = spec.boss ? `BOSS · ${spec.boss}` : `STAGE ${n}`;
      popups.add(label, W / 2, laneY(), spec.boss ? GOLD : PAPER, spec.boss ? 28 : 26, 1.3);
      audio.play(spec.boss ? "powerup" : "select", { volume: 0.7 });
    }
  }

  function loadDart() {
    if (waiting) return;
    waiting = dartMesh(false);
    waiting.position.set(0, LAUNCH_Y, 0);
    scene.add(waiting);
    loaded = true;
    grip = 0;
    loadT = 0;
  }

  function clearDebris() {
    for (const d of debris) {
      disposeOwned(d.obj);
      d.obj.removeFromParent();
    }
    debris = [];
    for (const f of flying) f.mesh.removeFromParent();
    flying = [];
  }

  function reset(m: "attract" | "play") {
    mode = m;
    demoReset = -1;
    if (m === "attract") clearDebris();
    score = 0;
    totalStuck = 0;
    litTaken = 0;
    deadT = -1;
    endSent = false;
    counter.snap(0);
    if (waiting) {
      waiting.removeFromParent();
      waiting = null;
    }
    startStage(1);
    loadDart();
    aiWait = 0.9;
  }

  // ---------------------------------------------------------------------------
  // Camera: frames disc + darts + launcher; attract pans into the preview safe area
  // ---------------------------------------------------------------------------
  /**
   * Screen-space framing. Play: the top darts sit just under the HUD and the launcher's flights at the bottom
   * edge. Attract: the disc and its darts fill the gap between the title block and the start prompt.
   */
  function framing(which: "attract" | "play"): { ppu: number; lookY: number; cx: number } {
    const reach = R + OUT + 0.2;
    if (which === "play") {
      const top = session.play().top + 124;
      const bottom = H - 10;
      const yTop = DISC_Y + reach;
      const yBot = LAUNCH_Y - DART_LEN - 0.2;
      let ppu = (bottom - top) / (yTop - yBot);
      ppu = Math.min(ppu, W / 2 / (reach + 0.15));
      return { ppu, lookY: yTop - (H / 2 - top) / ppu, cx: W / 2 };
    }
    const r = safeRect(session.preview(), W, H);
    const top = r.y + 122;
    const bottom = r.y + r.h - 48;
    let ppu = (bottom - top) / (2 * reach);
    ppu = Math.min(ppu, r.w / 2 / reach);
    const mid = (top + bottom) / 2;
    return { ppu, lookY: DISC_Y - (H / 2 - mid) / ppu, cx: r.x + r.w / 2 };
  }

  function frameCamera() {
    const k = clamp(layoutT.value, 0, 1.05);
    camera.aspect = W / H;
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const a = framing("attract");
    const p = framing("play");
    const ppu = lerp(a.ppu, p.ppu, k);
    const lookY = lerp(a.lookY, p.lookY, k);
    const cx = lerp(a.cx, p.cx, k);
    const dist = H / 2 / ppu / tanH;
    const o = shake.offset;
    const pu = punch * (session.reducedMotion ? 0.2 : 1);
    // Slightly below and to the right of the disc, looking up at it: the rim's depth and the darts read in 3D.
    camera.position.set(1.15 + o.x * 0.012, lookY - 2.0 + o.y * 0.012, dist - pu * 1.4);
    camera.lookAt(0, lookY, 0);
    camera.rotation.z += o.angle;
    camera.zoom = 1;
    camera.setViewOffset(W, H, W / 2 - cx, 0, W, H);
    camera.updateProjectionMatrix();
  }

  function toScreen(x: number, y: number, z: number) {
    tmp.set(x, y, z).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
  }

  stage.onResize((w, h) => {
    W = w;
    H = h;
  });

  // ---------------------------------------------------------------------------
  // Throwing
  // ---------------------------------------------------------------------------
  const live = () => arrive >= 0.6 && clearT < 0 && deadT < 0;
  /** Screen y of the throw lane between the disc and the launcher: banners and verdicts go here. */
  const laneY = () => (toScreen(0, DISC_Y - R - OUT, 0).y + toScreen(0, LAUNCH_Y, 0).y) / 2;

  function throwDart(auto: boolean) {
    if (!loaded || !waiting || !live() || thrown >= spec.darts) return;
    flying.push({ mesh: waiting, tipY: LAUNCH_Y, auto });
    waiting.rotation.set(0, 0, 0);
    waiting.position.x = 0;
    waiting = null;
    loaded = false;
    reload = RELOAD;
    thrown++;
    grip = 0;
    audio.play(WHOOSH, { pitch: rng.range(-1, 2), volume: mode === "play" ? 1 : 0.6 });
    if (mode === "play") session.feedback("tap");
    if (auto && mode === "play") audio.play("error", { volume: 0.4 });
  }

  function onStick(f: Flying) {
    const a = wrap(-Math.PI / 2 - theta);
    f.mesh.removeFromParent();
    stickDart(a, false, f.mesh);
    stuckNow++;
    wobble = 1;
    const p = toScreen(0, DISC_Y - R, 0);
    fx.emit(p.x, p.y, { count: 9, speed: [60, 220], angle: [Math.PI * 0.15, Math.PI * 0.85], life: [0.18, 0.4], size: [2, 4], colors: ["#B79CFF", PAPER, ACCENT], gravity: 500, drag: 2 });
    const note = PENTATONIC[Math.min(PENTATONIC.length - 1, stuckNow - 1)]!;
    audio.play(THUNK, { pitch: rng.range(-1, 1), volume: mode === "play" ? 1 : 0.6 });
    audio.play(TINK, { pitch: note });
    if (mode === "play") {
      score += 1;
      totalStuck++;
      session.feedback("impact");
      shake.add(0.07);
    }
    for (const l of lits) {
      if (l.taken >= 0 || Math.abs(wrap(a - l.a)) > LIT_HALF + 0.03) continue;
      l.taken = time;
      audio.play("coin");
      fx.emit(p.x, p.y - 6, { count: 22, speed: [80, 300], life: [0.3, 0.7], size: [2, 5], colors: [GOLD, "#FFF3C4", PAPER], drag: 2.5, shape: "spark" });
      if (mode === "play") {
        score += LIT_POINTS;
        litTaken++;
        popups.add(`+${LIT_POINTS}`, p.x + 46, p.y - 18, GOLD, 26, 0.9);
        session.feedback("success");
      }
    }
    if (stuckNow >= spec.darts) {
      clearT = 0;
      hitStop.freeze(0.09);
    }
  }

  /** The stage is cleared: the disc bursts into chunks and every dart flies loose. */
  function shatter(quiet = false) {
    const center = toScreen(0, DISC_Y, 0);
    const kids = [...spin.children];
    for (const obj of kids) {
      scene.attach(obj);
      obj.getWorldPosition(tmp);
      const out = new Vector3(tmp.x, tmp.y - DISC_Y, 0);
      // Chunks fly out along their middle; darts along their own radius.
      if (obj.userData.chunk && obj.type === "Group") {
        const a = (obj as Group).rotation.z + STEP / 2;
        out.set(Math.cos(a), Math.sin(a), 0);
      } else if (out.lengthSq() < 0.01) out.set(rng.range(-0.3, 0.3), 1, 0);
      out.normalize();
      const speed = obj.userData.chunk ? rng.range(5, 8.5) : rng.range(6, 10);
      debris.push({
        obj,
        vel: out.multiplyScalar(speed).add(new Vector3(0, rng.range(1, 3), rng.range(1.5, 4))),
        spin: new Vector3(rng.range(-6, 6), rng.range(-6, 6), rng.range(-9, 9)),
        life: 1.3,
        max: 1.3,
        gravity: 16,
      });
    }
    for (const c of [...shadowSpin.children]) c.removeFromParent();
    darts = [];
    lits = [];
    audio.play("explode", { volume: quiet ? 0.4 : 0.7 });
    if (quiet) return;
    audio.play("win", { volume: 0.8 });
    shake.add(0.45);
    punch = 1;
    flash.trigger(PAPER, 0.8);
    fx.emit(center.x, center.y, { count: 46, speed: [140, 520], life: [0.4, 1], size: [2, 6], colors: [ACCENT, PAPER, "#B79CFF", GOLD], drag: 1.8, shape: "spark" });
    fx.emit(center.x, center.y, { count: 22, speed: [60, 280], life: [0.4, 0.9], size: [4, 9], colors: ["#2B1F45", "#4A4458", "#241A3A"], gravity: 700, drag: 1, spin: [-9, 9] });
    if (mode === "play") {
      tc.analytics.track("level_complete", { level: stageN });
      if (spec.boss) {
        score += BOSS_POINTS;
        popups.add(`BOSS DOWN +${BOSS_POINTS}`, W / 2, center.y, GOLD, 24, 1.2);
      } else popups.add("CLEAR", W / 2, center.y, PAPER, 30, 0.9);
      session.feedback("success");
    }
  }

  /** A dart hit steel: it bounces off and the run is over. */
  function clang(f: Flying) {
    const p = toScreen(0, f.tipY, 0);
    flying = flying.filter((x) => x !== f);
    debris.push({
      obj: f.mesh,
      vel: new Vector3(rng.chance(0.5) ? -3.2 : 3.2, -7.5, 2.6),
      spin: new Vector3(rng.range(-3, 3), rng.range(-2, 2), rng.range(10, 16) * (rng.chance(0.5) ? 1 : -1)),
      life: 1.6,
      max: 1.6,
      gravity: 22,
    });
    audio.play(CLANG_A);
    audio.play(CLANG_B);
    audio.play("hit", { volume: 0.6 });
    fx.emit(p.x, p.y, { count: 30, speed: [160, 520], life: [0.2, 0.55], size: [2, 4], colors: [PAPER, GOLD, "#FFFFFF", ACCENT], drag: 2.2, shape: "spark" });
    shake.add(0.65);
    hitStop.freeze(0.14);
    wobble = 2.2;
    if (mode === "play") {
      deadT = 0;
      flash.trigger(PAPER, 0.9);
      tc.feedback("impact");
      audio.play("lose", { volume: 0.7 });
      popups.add("STEEL", W / 2, laneY() + 20, HEAT, 44, 1.6);
      tc.analytics.track("level_fail", { level: stageN });
    } else demoReset = 0.8;
  }

  // Input: a tap starts a run (on release); during a run every press throws instantly.
  session.startOnTap(window);
  onPress(window, () => {
    if (session.phase === "playing" && mode === "play" && deadT < 0) throwDart(false);
  });
  onKeys({ action: () => session.phase === "playing" && mode === "play" && deadT < 0 && throwDart(false) });
  session.on("start", () => {
    // The demo's disc bursts out of the way and the first stage flies in.
    clearDebris();
    shatter(true);
    reset("play");
    layoutT.target = 1;
  });
  session.on("cancel", () => {
    /* a press is instantaneous; nothing to undo */
  });

  // ---------------------------------------------------------------------------
  // The demo thrower: looks ahead along the closed-form spin and only throws into clear rim.
  // ---------------------------------------------------------------------------
  function demoSafe(): boolean {
    const tZone = (ZONE_Y - LAUNCH_Y) / DART_SPEED;
    const tHit = (CONTACT_Y - LAUNCH_Y) / DART_SPEED;
    const occupied = darts.map((d) => d.a);
    // Darts still in the air will land where the disc is when they arrive.
    for (const f of flying) occupied.push(wrap(-Math.PI / 2 - angleAt(spec, st + (CONTACT_Y - f.tipY) / DART_SPEED)));
    for (const t of [tZone, (tZone + tHit) / 2, tHit]) {
      const a = wrap(-Math.PI / 2 - angleAt(spec, st + t));
      if (occupied.some((b) => Math.abs(wrap(a - b)) < GAP + 0.14)) return false;
    }
    return true;
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
    flash.update(rawDt);
    fx.update(rawDt);
    popups.update(rawDt);
    layoutT.update(rawDt);
    counter.set(score);
    counter.update(rawDt);
    wobble = damp(wobble, 0, 7, rawDt);
    punch = damp(punch, 0, 5, rawDt);

    // Disc motion. It spins only once it has arrived; a clang stops it dead.
    arrive = Math.min(1, arrive + dt / 0.55);
    if (deadT < 0 && clearT < 0 && arrive >= 0.6) st += dt;
    theta = angleAt(spec, st);
    spin.rotation.z = theta;
    shadowSpin.rotation.z = theta;
    const ak = easeOutBack(clamp(arrive), 1.9);
    const s = clearT >= 0 ? 1 : Math.max(0.001, ak);
    discRoot.scale.setScalar(s);
    discRoot.position.y = DISC_Y + (1 - clamp(arrive * 1.4)) * 2.2;
    discRoot.rotation.x = Math.sin(time * 26) * 0.03 * wobble;
    discRoot.rotation.y = Math.sin(time * 21 + 1) * 0.02 * wobble;
    halo.material.opacity = clearT >= 0 ? 0 : 0.75 + 0.2 * light.pulse(time, 0.6, { still: 0.5 });
    shadowRoot.scale.setScalar(s);
    shadowRoot.visible = clearT < 0;
    for (const l of lits) {
      const m = l.mesh.material as MeshBasicMaterial;
      const gm = (l.mesh.children[0] as Mesh).material as MeshBasicMaterial;
      if (l.taken >= 0) {
        const k = clamp((time - l.taken) / 0.35);
        m.opacity = 1 - k;
        gm.opacity = 0.9 * (1 - k);
        l.mesh.scale.setScalar(1 + 0.2 * k);
      } else {
        const pulse = light.pulse(time, 1.2, { still: 0.7 });
        m.color.set(GOLD).lerp(LIT_HOT, pulse * 0.45);
        gm.opacity = 0.45 + 0.4 * pulse;
      }
    }

    // Stage cleared: burst after the hit-stop beat, then bring the next disc in.
    if (clearT >= 0) {
      const before = clearT;
      clearT += dt;
      if (before === 0 && clearT > 0) shatter();
      // The demo loops through the first five discs (boss included) and starts over.
      if (clearT > 0.85) startStage(mode === "attract" && stageN >= 5 ? 1 : stageN + 1);
    }

    // Reload and grip.
    if (!loaded) {
      reload -= dt;
      if (reload <= 0 && thrown < spec.darts && deadT < 0) loadDart();
    }
    if (waiting) {
      // The loaded dart slides up into place; it trembles when it's about to throw itself.
      loadT += rawDt;
      const shakeAmt = mode === "play" && live() ? clamp((grip / spec.grip - 0.55) / 0.45) : 0;
      waiting.position.y = LAUNCH_Y - (1 - easeOutCubic(clamp(loadT / 0.12))) * 0.5;
      waiting.position.x = Math.sin(time * 70) * 0.025 * shakeAmt;
      waiting.rotation.z = Math.sin(time * 53) * 0.04 * shakeAmt;
      waiting.visible = thrown < spec.darts;
      if (mode === "play" && live() && thrown < spec.darts) {
        grip += dt;
        if (shakeAmt > 0 && Math.floor((grip - dt) * 4) !== Math.floor(grip * 4)) audio.play("tick", { pitch: 6 + shakeAmt * 8 });
        if (grip >= spec.grip) throwDart(true);
      }
    }
    if (mode === "attract" && waiting && live()) {
      aiWait -= dt;
      if (aiWait <= 0 && demoSafe()) {
        throwDart(false);
        aiWait = rng.range(0.28, 0.75);
      }
    }

    // Darts in the air.
    for (const f of [...flying]) {
      f.tipY += DART_SPEED * dt;
      f.mesh.position.set(0, f.tipY, 0);
      if (f.tipY >= ZONE_Y) {
        const hit = darts.some((d) => Math.abs(wrap(d.a + theta + Math.PI / 2)) < GAP);
        if (hit) {
          clang(f);
          continue;
        }
      }
      if (f.tipY >= CONTACT_Y) {
        flying = flying.filter((x) => x !== f);
        onStick(f);
      }
    }

    for (const d of debris) {
      d.vel.y -= d.gravity * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      d.life -= dt;
      const k = d.life / d.max;
      if (k < 0.35) d.obj.scale.setScalar(Math.max(0.01, k / 0.35));
    }
    debris = debris.filter((d) => {
      if (d.life > 0) return true;
      disposeOwned(d.obj);
      d.obj.removeFromParent();
      return false;
    });

    if (deadT >= 0) {
      deadT += rawDt;
      if (!endSent && deadT > 0.55) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { stage: stageN, darts: totalStuck, lit: litTaken } });
      }
    }

    // Attract: start over if the demo ever hits steel.
    if (demoReset >= 0) {
      demoReset -= rawDt;
      if (demoReset < 0 && mode === "attract") reset("attract");
    }

    neon.intensity = 2.4 * (clearT >= 0 ? 0.2 : 1);
    launchPad.material.opacity = 0.35 + 0.3 * (loaded ? 1 : 0);
    frameCamera();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  function promptPill(g: CanvasRenderingContext2D, x: number, y: number, w = 200) {
    g.fillStyle = "rgba(13,13,16,0.62)";
    roundRect(g, x - w / 2, y - 17, w, 34, 17);
    g.fill();
  }

  /** Darts for this stage: one notch per dart, lit as they stick. */
  function drawNotches(g: CanvasRenderingContext2D, cx: number, y: number) {
    const n = spec.darts;
    const w = 12;
    const gap = 6;
    const total = n * w + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const x = cx - total / 2 + i * (w + gap);
      const done = i < stuckNow;
      const air = !done && i < thrown;
      g.fillStyle = done ? ACCENT : air ? rgba(PAPER, 0.6) : rgba(PAPER, 0.18);
      roundRect(g, x, y - 3, w, 6, 3);
      g.fill();
    }
  }

  /** The grip ring around the launcher: when it runs out, the dart throws itself. */
  function drawGrip(g: CanvasRenderingContext2D) {
    if (mode !== "play" || !waiting || !live() || thrown >= spec.darts) return;
    const p = toScreen(0, LAUNCH_Y - 0.62, 0);
    const f = clamp(1 - grip / spec.grip);
    const hot = f < 0.45;
    const rr = 30;
    g.lineWidth = 3;
    g.lineCap = "round";
    g.strokeStyle = rgba(PAPER, 0.1);
    g.beginPath();
    g.arc(p.x, p.y, rr, 0, TAU);
    g.stroke();
    g.strokeStyle = hot ? HEAT : rgba(PAPER, 0.55);
    g.beginPath();
    g.arc(p.x, p.y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * f);
    g.stroke();
  }

  /** Speed streaks behind darts in the air. */
  function drawTrails(g: CanvasRenderingContext2D) {
    for (const f of flying) {
      const head = toScreen(0, f.tipY - DART_LEN * 0.9, 0);
      const tail = toScreen(0, Math.max(LAUNCH_Y - DART_LEN, f.tipY - DART_LEN - 2.2), 0);
      const grad = g.createLinearGradient(0, tail.y, 0, head.y);
      grad.addColorStop(0, rgba(ACCENT, 0));
      grad.addColorStop(1, rgba(ACCENT, 0.55));
      g.fillStyle = grad;
      for (const dx of [-9, 0, 9]) g.fillRect(head.x + dx - 1.5, head.y, 3, tail.y - head.y);
    }
  }

  function drawHud() {
    stage.beginHud();
    const g = hud;
    drawTrails(g);
    fx.draw(g);
    drawPopupsShadowed(g, popups, FONT_DISPLAY, "#06040B");
    flash.draw(g, W, H);
    if (mode === "play") {
      if (session.phase === "playing") {
        const top = session.play().top;
        drawNumber(g, Math.round(counter.shown), W / 2, top + 48, 52, PAPER);
        drawLabel(g, spec.boss ? `BOSS · ${spec.boss}` : `STAGE ${stageN}`, W / 2, top + 84, spec.boss ? GOLD : rgba(PAPER, 0.62), 11);
        drawNotches(g, W / 2, top + 103);
        drawGrip(g);
      } else if (session.standalone && session.phaseTime > 0.7) {
        // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
        const r = safeRect(session.preview(), W, H);
        drawNumber(g, score, r.x + r.w / 2, r.y + 64, 56, PAPER);
        drawLabel(g, `STAGE ${stageN}`, r.x + r.w / 2, r.y + 100, rgba(PAPER, 0.7), 11);
        promptPill(g, r.x + r.w / 2, r.y + r.h - 20, 248);
        drawTapPrompt(g, r.x + r.w / 2, r.y + r.h - 20, time, PAPER, "TAP TO THROW AGAIN");
      }
      return;
    }
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const ty = r.y + 62;
    const k = easeOutBack(titleIn);
    g.save();
    g.translate(cx, ty);
    g.scale(k, k);
    drawTitle(g, "SPINDART", 0, 0, r.w - 6, PAPER, 58, rgba(ACCENT, 0.95));
    g.restore();
    drawLabel(g, "TAP TO THROW · NEVER HIT STEEL", cx, ty + 28, rgba(PAPER, 0.8), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 50, ACCENT, 13);
    promptPill(g, cx, r.y + r.h - 20);
    drawTapPrompt(g, cx, r.y + r.h - 20, time, PAPER);
  }

  // ---------------------------------------------------------------------------
  // Boot: compile every material up front (disc, boss disc, darts, lit cells, debris) so no frame stalls.
  // ---------------------------------------------------------------------------
  reset("attract");
  arrive = 1;
  frameCamera();
  const warm = new Group();
  for (const m of [faceBoss, rimBossMat]) warm.add(new Mesh(wedgeGeo, [m, edgeMat]));
  warm.add(new Mesh(oldDart, dartMat));
  warm.position.set(0, -40, 0);
  scene.add(warm);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  warm.removeFromParent();
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
