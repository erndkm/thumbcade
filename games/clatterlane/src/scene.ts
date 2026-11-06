/**
 * The alley at night: a glossy midnight-blue lane that mirrors the pins faintly, gutters with a strip of lane lights
 * along each lip (they chase the ball and change colour as a strike chain grows), dim neighbouring lanes, a masking
 * unit over the pin deck with an LED panel, the sweep bar, lathe-turned pins with an accent neck band, and a marbled
 * ball. Static pieces are merged; pins, lights and shadows are instanced. Nothing here allocates per frame.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRng } from "@thumbcade-games/kit/rng";
import { BALL_R, D_BACK, D_HEAD, D_PIT, GUTTER_W, KICK_X, LANE_HALF, PIN_COUNT, PIN_H, SPOTS } from "./lane.ts";

export const ACCENT = "#08A0F0";
export const INK = "#0D0D10";
export const PAPER = "#F3F0E8";
export const SKY = "#04050A";
/** Lane-light colours by strike chain: none, strike, double, turkey, hambone, five-bagger. */
export const HEAT = ["#08A0F0", "#08A0F0", "#62D2FF", "#FF5CCB", "#FFC23D", "#FFF4D6"] as const;

const LANE_LEN = D_BACK + 3.5;
const LANE_FRONT = -3.2;
const SIDE_LANES = [-2.25, 2.25, -4.5, 4.5];
const LIGHTS_PER_SIDE = 56;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}
function tex(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
function paint(geo: BufferGeometry, color: string): BufferGeometry {
  const c = new Color(color);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g;
}
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

// ---------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------

/** The lane: 39 boards of midnight-stained maple, the foul line, the dots and arrows, the pin deck's spots. */
function laneTexture(dim: boolean): CanvasTexture {
  const W = 256;
  const H = 2048;
  const [c, g] = canvas(W, H);
  const rng = createRng(dim ? 71 : 7);
  const len = LANE_LEN - LANE_FRONT;
  const toY = (d: number) => H - ((d - LANE_FRONT) / len) * H;
  // Boards.
  for (let i = 0; i < 39; i++) {
    const x0 = (i / 39) * W;
    const k = 0.9 + rng() * 0.2;
    g.fillStyle = `rgb(${Math.round(17 * k)},${Math.round(22 * k)},${Math.round(40 * k)})`;
    g.fillRect(x0, 0, W / 39 + 0.5, H);
    // Grain: long faint streaks.
    for (let s = 0; s < 22; s++) {
      g.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.12)";
      const y = rng() * H;
      g.fillRect(x0 + rng() * (W / 39), y, 0.8, 30 + rng() * 260);
    }
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(x0, 0, 0.7, H);
  }
  // The approach (before the foul line) is a shade darker.
  g.fillStyle = "rgba(0,0,0,0.32)";
  g.fillRect(0, toY(0), W, H - toY(0));
  const accent = dim ? "rgba(8,160,240,0.35)" : ACCENT;
  // Foul line.
  g.fillStyle = accent;
  g.fillRect(0, toY(0) - 3, W, 6);
  // Dots at 2 m, arrows at 4.6 m.
  const boardX = (b: number) => W - (b - 0.5) * (W / 39);
  g.fillStyle = dim ? "rgba(243,240,232,0.25)" : "rgba(243,240,232,0.7)";
  for (const b of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
    g.beginPath();
    g.arc(boardX(b), toY(2.1), 2.4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = accent;
  for (const [b, dd] of [
    [5, 4.15],
    [10, 4.35],
    [15, 4.55],
    [20, 4.75],
    [25, 4.55],
    [30, 4.35],
    [35, 4.15],
  ] as const) {
    const x = boardX(b);
    const y = toY(dd);
    g.beginPath();
    g.moveTo(x, y - 34);
    g.lineTo(x + 5, y);
    g.lineTo(x - 5, y);
    g.closePath();
    g.fill();
  }
  // Pin deck: a slightly lighter panel with the ten spots.
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.fillRect(0, toY(D_PIT), W, toY(D_HEAD - 0.45) - toY(D_PIT));
  g.fillStyle = dim ? "rgba(243,240,232,0.12)" : "rgba(243,240,232,0.32)";
  for (const s of SPOTS) {
    g.beginPath();
    g.arc(W / 2 + (s.x / (LANE_HALF * 2)) * W, toY(s.d), 3.2, 0, Math.PI * 2);
    g.fill();
  }
  // The pit beyond: black.
  g.fillStyle = "#020205";
  g.fillRect(0, 0, W, toY(D_PIT));
  return tex(c);
}

/** The ball: deep blue with an accent marble swirl and three finger holes. */
function ballTexture(): CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0A2F6B");
  grad.addColorStop(0.5, "#0B1D49");
  grad.addColorStop(1, "#0A2F6B");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const rng = createRng(23);
  // Marbling: long soft swirls in the accent and a paler blue.
  for (let k = 0; k < 26; k++) {
    g.strokeStyle = k % 3 === 0 ? "rgba(140,220,255,0.35)" : "rgba(8,160,240,0.55)";
    g.lineWidth = 3 + rng() * 9;
    g.beginPath();
    let x = rng() * W;
    let y = rng() * H;
    g.moveTo(x, y);
    for (let i = 0; i < 8; i++) {
      x += (rng() - 0.3) * 90;
      y += (rng() - 0.5) * 50;
      g.quadraticCurveTo(x + (rng() - 0.5) * 60, y + (rng() - 0.5) * 60, x, y);
    }
    g.stroke();
  }
  // Finger holes, near the top of the texture's middle.
  g.fillStyle = "#03060E";
  for (const [hx, hy, r] of [
    [W * 0.5 - 18, H * 0.3, 11],
    [W * 0.5 + 18, H * 0.3, 11],
    [W * 0.5, H * 0.46, 13],
  ] as const) {
    g.beginPath();
    g.ellipse(hx, hy, r, r * 0.9, 0, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** A soft round glow (for reflections of lights and the ball's halo). */
function glowTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.35, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

function shadowTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(0,0,0,0.85)");
  r.addColorStop(0.6, "rgba(0,0,0,0.35)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------

/** A tenpin's outline, base to crown (radius, height), with doubled rings at the neck band's edges. */
const PROFILE: Array<[number, number]> = [
  [0, 0],
  [0.026, 0],
  [0.035, 0.009],
  [0.047, 0.04],
  [0.056, 0.078],
  [0.0605, 0.115],
  [0.0585, 0.152],
  [0.05, 0.188],
  [0.037, 0.22],
  [0.0285, 0.236],
  [0.0285, 0.236],
  [0.0255, 0.248],
  [0.0255, 0.248],
  [0.0238, 0.256],
  [0.0238, 0.256],
  [0.0232, 0.267],
  [0.0232, 0.267],
  [0.0255, 0.29],
  [0.031, 0.322],
  [0.0322, 0.342],
  [0.0292, 0.362],
  [0.02, 0.375],
  [0.008, 0.3805],
  [0, PIN_H],
];

function pinGeometry(): BufferGeometry {
  const pts = PROFILE.map(([r, y]) => new Vector2(r, y));
  const geo = new LatheGeometry(pts, 22);
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const white = new Color(PAPER);
  const band = new Color(ACCENT);
  // Lathe vertices go profile point by profile point within each segment column.
  const per = pts.length;
  for (let i = 0; i < pos.count; i++) {
    const k = i % per;
    // Bands between the doubled rings: [9..12) and [13..16): ring pairs 10-11 and 14-15.
    const inBand = (k >= 10 && k <= 11) || (k >= 14 && k <= 15);
    const c = inBand ? band : white;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function gutterGeometry(side: number): BufferGeometry {
  // A half pipe along the lane, its lips at lane height.
  const r = GUTTER_W / 2;
  const g = new CylinderGeometry(r, r, LANE_LEN - LANE_FRONT, 14, 1, true, Math.PI / 2, Math.PI);
  g.rotateX(Math.PI / 2);
  g.translate(side * (LANE_HALF + r), 0, -(LANE_FRONT + LANE_LEN) / 2);
  return paint(g, "#0A0C16");
}

export interface PinVisual {
  x: number;
  y: number;
  d: number;
  ux: number;
  ud: number;
  th: number;
  /** Extra lift (pinsetter) and fade. */
  lift: number;
  hidden: boolean;
}

export function buildWorld(anisotropy: number) {
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog(SKY, 16, 42);

  scene.add(new HemisphereLight("#7F95E8", "#05050A", 1.05));
  const key = new DirectionalLight("#E8EEFF", 1.1);
  key.position.set(1.5, 6, 4);
  scene.add(key);
  // The pin light over the deck makes the rack pop.
  const pinLight = new PointLight("#F6F1FF", 4.2, 7, 1.4);
  pinLight.position.set(0, 2.1, -(D_HEAD + 0.45));
  scene.add(pinLight);
  // A light that rides with the ball, tinted with the heat colour.
  const ballLight = new PointLight(ACCENT, 0.9, 2.2, 2);
  scene.add(ballLight);

  // --- the lane and its neighbours ---------------------------------------------------------------------------
  const laneTex = laneTexture(false);
  laneTex.anisotropy = anisotropy;
  const laneGeo = new PlaneGeometry(LANE_HALF * 2, LANE_LEN - LANE_FRONT);
  laneGeo.rotateX(-Math.PI / 2);
  laneGeo.translate(0, 0, -(LANE_FRONT + LANE_LEN) / 2);
  // Slightly see-through, over mirrored pins: a polished lane.
  // Matte, so lights never smear across it; the shine comes from the pins mirrored underneath.
  const laneMat = new MeshLambertMaterial({ map: laneTex, transparent: true, opacity: 0.86 });
  const lane = new Mesh(laneGeo, laneMat);
  lane.renderOrder = 1;
  scene.add(lane);

  const sideTex = laneTexture(true);
  sideTex.anisotropy = anisotropy;
  const sideGeos = SIDE_LANES.map((x) => {
    const g = new PlaneGeometry(LANE_HALF * 2, LANE_LEN - LANE_FRONT);
    g.rotateX(-Math.PI / 2);
    g.translate(x, 0, -(LANE_FRONT + LANE_LEN) / 2);
    return g;
  });
  const sides = new Mesh(mergeGeometries(sideGeos), new MeshLambertMaterial({ map: sideTex, color: "#7A86A8" }));
  scene.add(sides);

  // Gutters, capping between lanes, kickbacks, the back of the pit, ceiling beams: one vertex-coloured mesh.
  const parts: BufferGeometry[] = [gutterGeometry(-1), gutterGeometry(1)];
  for (const x of [0, ...SIDE_LANES]) {
    for (const s of [-1, 1]) {
      const cx = x + s * (LANE_HALF + GUTTER_W + 0.16);
      parts.push(box(0.3, 0.06, LANE_LEN - LANE_FRONT, cx, -0.02, -(LANE_FRONT + LANE_LEN) / 2, "#0B0D18"));
      if (x !== 0) parts.push(paint(gutterGeometry(s).clone().translate(x, 0, 0), "#07080F"));
    }
  }
  // Kickbacks: the dark side walls of the pin deck.
  for (const s of [-1, 1]) parts.push(box(0.05, 0.62, D_PIT - D_HEAD + 1.4, s * (KICK_X + 0.03), 0.31, -(D_HEAD + D_PIT) / 2 - 0.2, "#0E1020"));
  // The pit's back wall and the floor of the pit.
  parts.push(box(12, 1.6, 0.1, 0, 0.5, -(D_BACK + 0.15), "#06070D"));
  parts.push(box(LANE_HALF * 2 + GUTTER_W * 2, 0.05, D_BACK - D_PIT + 0.2, 0, -0.34, -(D_PIT + D_BACK) / 2, "#020205"));
  const fixtures = new Mesh(mergeGeometries(parts), new MeshLambertMaterial({ vertexColors: true }));
  scene.add(fixtures);

  // The masking unit over the pins, across all lanes, with our LED panel in the middle.
  // Hung high enough that the chasing camera, low over the deck, never has it behind the HUD.
  const MASK_Y = 1.95;
  // Plain and dark on purpose: it sits behind the HUD in the aiming view, so nothing on it may glow or read as text.
  const mask = new Mesh(box(12, 0.62, 0.12, 0, MASK_Y, -(D_HEAD - 0.85), SKY), new MeshBasicMaterial({ vertexColors: true, fog: false }));
  scene.add(mask);

  // --- lane lights: a strip along each gutter lip --------------------------------------------------------------
  const lightCount = LIGHTS_PER_SIDE * 2;
  const lights = new InstancedMesh(new BoxGeometry(0.026, 0.014, 0.13), new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), lightCount);
  const lightD = new Float32Array(lightCount);
  {
    const o = new Object3D();
    for (let i = 0; i < lightCount; i++) {
      const side = i < LIGHTS_PER_SIDE ? -1 : 1;
      const k = i % LIGHTS_PER_SIDE;
      const d = 0.2 + (k / (LIGHTS_PER_SIDE - 1)) * (D_HEAD - 0.6);
      lightD[i] = d;
      o.position.set(side * (LANE_HALF + 0.012), 0.008, -d);
      o.updateMatrix();
      lights.setMatrixAt(i, o.matrix);
      lights.setColorAt(i, new Color(ACCENT));
    }
  }
  lights.instanceColor!.setUsage(DynamicDrawUsage);
  scene.add(lights);

  // --- pins ---------------------------------------------------------------------------------------------------
  const pinGeo = pinGeometry();
  const pinMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0, emissive: "#20263A", emissiveIntensity: 0.6 });
  const pins = new InstancedMesh(pinGeo, pinMat, PIN_COUNT);
  pins.instanceMatrix.setUsage(DynamicDrawUsage);
  pins.frustumCulled = false;
  scene.add(pins);
  const mirrorMat = new MeshBasicMaterial({ vertexColors: true, color: "#5B6690", side: DoubleSide, fog: true });
  const mirror = new InstancedMesh(pinGeo, mirrorMat, PIN_COUNT);
  mirror.instanceMatrix.setUsage(DynamicDrawUsage);
  mirror.frustumCulled = false;
  scene.add(mirror);
  // The neighbours' racks, static.
  const sidePins = new InstancedMesh(pinGeo, new MeshLambertMaterial({ vertexColors: true, color: "#8D95B4" }), SIDE_LANES.length * PIN_COUNT);
  {
    const o = new Object3D();
    let n = 0;
    for (const x of SIDE_LANES) {
      for (const s of SPOTS) {
        o.position.set(x + s.x, 0, -s.d);
        o.updateMatrix();
        sidePins.setMatrixAt(n++, o.matrix);
      }
    }
  }
  scene.add(sidePins);

  const shadowTex = shadowTexture();
  const shadowGeo = new CircleGeometry(1, 18);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadows = new InstancedMesh(shadowGeo, new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }), PIN_COUNT + 1);
  shadows.instanceMatrix.setUsage(DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.renderOrder = 2;
  scene.add(shadows);

  // A pool of light on the pin deck under the rack, and a faint sheen down the middle of the lane: the gloss of an
  // oiled lane without a specular highlight that smears.
  const glowTex = glowTexture();
  const poolGeo = new PlaneGeometry(2.1, 2.4);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new Mesh(poolGeo, new MeshBasicMaterial({ map: glowTex, color: "#9FB8FF", transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.32, toneMapped: false }));
  pool.position.set(0, 0.003, -(D_HEAD + 0.42));
  pool.renderOrder = 2;
  scene.add(pool);
  const sheenGeo = new PlaneGeometry(LANE_HALF * 1.5, D_HEAD * 1.1);
  sheenGeo.rotateX(-Math.PI / 2);
  const sheen = new Mesh(sheenGeo, new MeshBasicMaterial({ map: glowTex, color: "#3D63B8", transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.22, toneMapped: false }));
  sheen.position.set(0, 0.002, -(D_HEAD * 0.62));
  sheen.renderOrder = 2;
  scene.add(sheen);

  // --- the ball ------------------------------------------------------------------------------------------------
  const ballTex = ballTexture();
  ballTex.wrapS = RepeatWrapping;
  const ballMat = new MeshStandardMaterial({ map: ballTex, roughness: 0.2, metalness: 0.15, emissive: ACCENT, emissiveIntensity: 0.05 });
  const ballGeo = new SphereGeometry(BALL_R, 40, 24);
  const ball = new Mesh(ballGeo, ballMat);
  scene.add(ball);
  const ballMirror = new Mesh(ballGeo, new MeshBasicMaterial({ map: ballTex, color: "#3A4B78", fog: true }));
  scene.add(ballMirror);
  const halo = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: glowTex, color: ACCENT, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 }));
  halo.rotateX(-Math.PI / 2);
  halo.renderOrder = 3;
  scene.add(halo);

  // --- the ball's light trail ----------------------------------------------------------------------------------
  const TRAIL = 96;
  const trailPos = new Float32Array(TRAIL * 2 * 3);
  const trailAlpha = new Float32Array(TRAIL * 2);
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute("position", new BufferAttribute(trailPos, 3).setUsage(DynamicDrawUsage));
  trailGeo.setAttribute("alpha", new BufferAttribute(trailAlpha, 1).setUsage(DynamicDrawUsage));
  const idx: number[] = [];
  for (let i = 0; i < TRAIL - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  trailGeo.setIndex(idx);
  const trailMat = new MeshBasicMaterial({ color: ACCENT, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.5, toneMapped: false });
  trailMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float alpha;\nvarying float vAlpha;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvAlpha = alpha;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAlpha;")
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\ngl_FragColor.a *= vAlpha;");
  };
  const trail = new Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.renderOrder = 2;
  scene.add(trail);
  let trailN = 0;

  // --- the sweep bar -------------------------------------------------------------------------------------------
  const sweep = new Mesh(box(LANE_HALF * 2 + GUTTER_W * 2 + 0.1, 0.09, 0.04, 0, 0, 0, "#1A2038"), new MeshLambertMaterial({ vertexColors: true, emissive: "#0A1A30" }));
  const sweepEdge = new Mesh(new BoxGeometry(LANE_HALF * 2 + GUTTER_W * 2 + 0.1, 0.012, 0.045), new MeshBasicMaterial({ color: ACCENT, toneMapped: false }));
  sweepEdge.position.y = -0.04;
  sweep.add(sweepEdge);
  sweep.visible = false;
  scene.add(sweep);

  // --- bumper rails over the gutters (the first racks) ---------------------------------------------------------
  const railGeo = new BoxGeometry(0.035, 0.07, D_HEAD - 0.6);
  const railMat = new MeshStandardMaterial({ color: "#0B2A44", emissive: ACCENT, emissiveIntensity: 0.55, roughness: 0.4 });
  const rails = [-1, 1].map((sd) => {
    const r = new Mesh(railGeo, railMat);
    r.position.set(sd * (LANE_HALF + 0.03), 0.035, -(D_HEAD - 0.6) / 2 - 0.2);
    scene.add(r);
    return r;
  });

  // --- per-frame updates ---------------------------------------------------------------------------------------
  const m4 = new Matrix4();
  const mirrorM = new Matrix4().makeScale(1, -1, 1);
  const q = new Quaternion();
  const axis = new Vector3();
  const p3 = new Vector3();
  const one = new Vector3(1, 1, 1);
  const UP = new Vector3(0, 1, 0);
  const zero = new Matrix4().makeScale(0, 0, 0);
  const col = new Color();
  const heatCol = new Color(ACCENT);
  const dimCol = new Color("#06101F");

  function setPins(vis: readonly PinVisual[]) {
    for (let i = 0; i < PIN_COUNT; i++) {
      const v = vis[i]!;
      if (v.hidden) {
        pins.setMatrixAt(i, zero);
        mirror.setMatrixAt(i, zero);
        shadows.setMatrixAt(i, zero);
        continue;
      }
      // Tilt the up axis toward (ux, 0, -ud) by th.
      axis.set(-v.ud, 0, -v.ux);
      const al = axis.length();
      if (al > 1e-6 && v.th !== 0) q.setFromAxisAngle(axis.multiplyScalar(1 / al), v.th);
      else q.identity();
      p3.set(v.x, v.y + v.lift, -v.d);
      m4.compose(p3, q, one);
      pins.setMatrixAt(i, m4);
      if (v.y > -0.05 && v.d < D_PIT) {
        mirror.setMatrixAt(i, m4.premultiply(mirrorM));
        // Shadow: under the pin's middle, softer and smaller as it lifts.
        const s = Math.sin(v.th);
        const sx = v.x + v.ux * 0.17 * s;
        const sd = v.d + v.ud * 0.17 * s;
        const h = Math.max(0, v.y + v.lift);
        const r = (0.075 + 0.1 * s) * (1 + h * 1.5);
        p3.set(sx, 0.003, -sd);
        q.setFromAxisAngle(UP, Math.atan2(v.ux, -v.ud));
        m4.compose(p3, q, axis.set(r, 1, r * (1 + s * 0.6)));
        shadows.setMatrixAt(i, h > 0.6 ? zero : m4);
      } else {
        mirror.setMatrixAt(i, zero);
        shadows.setMatrixAt(i, zero);
      }
    }
    pins.instanceMatrix.needsUpdate = true;
    mirror.instanceMatrix.needsUpdate = true;
    shadows.instanceMatrix.needsUpdate = true;
  }

  function setBall(x: number, y: number, d: number, spin: number, heading: number, visible: boolean, heat: number) {
    ball.visible = visible;
    const onLane = y > 0.02 && d < D_PIT;
    ballMirror.visible = visible && onLane;
    halo.visible = visible && onLane && heat > 0.02;
    ballLight.visible = visible && onLane;
    if (!visible) {
      shadows.setMatrixAt(PIN_COUNT, zero);
      return;
    }
    ball.position.set(x, y, -d);
    // Rolling: about the horizontal axis across its heading.
    axis.set(Math.cos(heading), 0, Math.sin(heading));
    ball.quaternion.setFromAxisAngle(axis, -spin);
    ballMirror.position.set(x, -y, -d);
    ballMirror.quaternion.copy(ball.quaternion);
    halo.position.set(x, 0.004, -d);
    halo.scale.setScalar(0.55 + heat * 0.35);
    (halo.material as MeshBasicMaterial).opacity = 0.18 + heat * 0.5;
    ballLight.position.set(x, 0.35, -d);
    ballLight.intensity = 0.15 + heat * 0.9;
    p3.set(x, 0.002, -d);
    q.identity();
    const r = BALL_R * 1.25;
    m4.compose(p3, q, axis.set(r, 1, r));
    shadows.setMatrixAt(PIN_COUNT, y > -0.02 ? m4 : zero);
    shadows.instanceMatrix.needsUpdate = true;
  }

  /** Lane lights: `chase` is where the ball is (or -1), `heat` 0-5, `level` 0-1 overall brightness, `t` time. */
  function setLights(chase: number, heat: number, level: number, t: number, pulse: number) {
    heatCol.set(HEAT[Math.max(0, Math.min(5, heat))]!);
    for (let i = 0; i < lightCount; i++) {
      const d = lightD[i]!;
      // A soft pool of light behind the ball, a slow drift toward the pins otherwise.
      let k = 0.22 + level * (0.5 + 0.18 * Math.sin(d * 1.3 - t * 2.4));
      if (chase >= 0) {
        const behind = chase - d;
        k += behind >= 0 ? Math.exp(-behind * 0.9) * 0.9 : Math.exp(behind * 6) * 0.9;
      }
      k = Math.min(1.25, k + pulse * 0.6);
      col.copy(dimCol).lerp(heatCol, Math.min(1, k));
      if (k > 1) col.lerp(new Color(PAPER), (k - 1) * 0.8);
      lights.setColorAt(i, col);
    }
    lights.instanceColor!.needsUpdate = true;
    (halo.material as MeshBasicMaterial).color.copy(heatCol);
    ballLight.color.copy(heatCol);
  }

  function clearTrail() {
    trailN = 0;
    trailAlpha.fill(0);
    (trailGeo.getAttribute("alpha") as BufferAttribute).needsUpdate = true;
  }
  /** Adds the ball's current position to the trail (call while it rolls). */
  function pushTrail(x: number, d: number) {
    if (trailN > 0) {
      const o = (trailN - 1) * 6;
      const lx = trailPos[o]! + (trailPos[o + 3]! - trailPos[o]!) / 2;
      const ld = -(trailPos[o + 2]! + (trailPos[o + 5]! - trailPos[o + 2]!) / 2);
      if (Math.hypot(lx - x, ld - d) < 0.12) return;
    }
    if (trailN >= TRAIL) {
      trailPos.copyWithin(0, 6);
      trailAlpha.copyWithin(0, 2);
      trailN = TRAIL - 1;
    }
    const w = 0.013;
    const o = trailN * 6;
    trailPos[o] = x - w;
    trailPos[o + 1] = 0.004;
    trailPos[o + 2] = -d;
    trailPos[o + 3] = x + w;
    trailPos[o + 4] = 0.004;
    trailPos[o + 5] = -d;
    trailN++;
    (trailGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
  }
  /** Fades the trail: newest points brightest, everything by `fade`. */
  function fadeTrail(fade: number) {
    for (let i = 0; i < TRAIL; i++) {
      const a = i < trailN ? fade * (i / Math.max(1, trailN - 1)) ** 2 : 0;
      trailAlpha[i * 2] = a;
      trailAlpha[i * 2 + 1] = a;
    }
    (trailGeo.getAttribute("alpha") as BufferAttribute).needsUpdate = true;
  }

  /** Bumper rails: 1 = up, 0 = down in the gutters (hidden). */
  function setBumpers(h: number) {
    for (const r of rails) {
      r.visible = h > 0.01;
      r.position.y = 0.035 - (1 - h) * 0.12;
    }
  }

  function setSweep(visible: boolean, y: number, d: number) {
    // Only ever seen low over the deck: higher up it would sit behind the HUD in the chase view.
    sweep.visible = visible && y < 0.45;
    sweep.position.set(0, y, -d);
  }

  return {
    scene,
    lane,
    laneMat,
    pins,
    pinMat,
    ball,
    pinLight,
    pool,
    setPins,
    setBall,
    setLights,
    clearTrail,
    pushTrail,
    fadeTrail,
    setSweep,
    setBumpers,
    /** Makes every material compile once before ready(). */
    warm() {
      halo.visible = true;
      sweep.visible = true;
      ball.visible = true;
      ballMirror.visible = true;
    },
  };
}

export type World = ReturnType<typeof buildWorld>;
