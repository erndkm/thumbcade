/**
 * The floodlit pitch: grass, lines, the goal and its net, the wall of training mannequins, the keeper, the stand
 * and its crowd, LED boards, floodlights, the ball and its trail. Everything static is merged into a handful of
 * meshes; nothing here allocates per frame.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Camera,
  type Material,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FONT_DISPLAY } from "@thumbcade-games/kit/fonts";
import { BALL_R, GOAL_H, GOAL_HW, KEEPER_Y, MAN_H, MAN_R, NET_D, POST_R, type Ring, type Vec2 } from "./sim.ts";

export const ACCENT = "#E4FF3A";
export const SKY = "#05070D";
export const KEEPER_SUIT = "#FF6B4A";
const INK = "#151923";
const PAPER = "#F3F0E8";
const LINE = "#B9C4B9";

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

/** Mowing stripes, 5 m bands parallel to the goal line, with a little grain. */
function grassTexture(): CanvasTexture {
  const [c, g] = canvas(64, 256);
  for (let i = 0; i < 2; i++) {
    g.fillStyle = i ? "#16402A" : "#1B4A30";
    g.fillRect(0, i * 128, 64, 128);
  }
  // Grain: tiny dark and light flecks.
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.05)";
    g.fillRect(Math.floor(r() * 64), Math.floor(r() * 256), 1, 2);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** A soft round glow (for floodlights, ring halos and blob shadows). */
function glowTexture(inner: string, outer: string): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return tex(c);
}

/** The ball: off-white with ink chevrons and an accent band, so its spin reads from behind. */
function ballTexture(): CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = INK;
  for (let i = 0; i < 6; i++) {
    const x = i * 42.6 + 8;
    g.beginPath();
    g.moveTo(x, 30);
    g.lineTo(x + 22, 44);
    g.lineTo(x, 58);
    g.lineTo(x + 8, 44);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x + 21, 72);
    g.lineTo(x + 43, 86);
    g.lineTo(x + 21, 100);
    g.lineTo(x + 29, 86);
    g.closePath();
    g.fill();
  }
  g.fillStyle = ACCENT;
  g.fillRect(0, 60, 256, 8);
  g.fillStyle = INK;
  g.fillRect(0, 0, 256, 6);
  g.fillRect(0, 122, 256, 6);
  return tex(c);
}

/** Scrolling LED board text. */
function boardTexture(text: string, fg: string, bg: string): CanvasTexture {
  const [m, mg] = canvas(8, 8);
  mg.font = `900 40px ${FONT_DISPLAY}`;
  const unit = Math.ceil(mg.measureText(text).width + 70);
  m.width = 1;
  const [c, g] = canvas(unit * 2, 64);
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, 64);
  g.font = `900 40px ${FONT_DISPLAY}`;
  g.textBaseline = "middle";
  g.fillStyle = fg;
  g.fillText(text, 20, 34);
  g.fillText(text, 20 + unit, 34);
  // LED dot mask.
  g.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, c.width, 1);
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, 64);
  const t = tex(c);
  t.wrapS = RepeatWrapping;
  return t;
}

/** Stand: dark tiers with a scatter of faint faces, the rest of the crowd is instanced in front. */
function standTexture(): CanvasTexture {
  const [c, g] = canvas(512, 256);
  g.fillStyle = "#080B14";
  g.fillRect(0, 0, 512, 256);
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Tiers of tiny heads and shoulders, a few faces caught by the lights.
  for (let row = 0; row < 16; row++) {
    const y = row * 16 + 4;
    g.fillStyle = "#0D111D";
    g.fillRect(0, y + 8, 512, 5);
    for (let x = 0; x < 512; x += 5 + r() * 3) {
      const lit = r() < 0.045;
      g.fillStyle = lit ? "rgba(243,240,232,0.5)" : r() < 0.5 ? "#161C2C" : "#121827";
      g.beginPath();
      g.arc(x, y + 2, 1.6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x - 2.2, y + 4, 4.4, 5);
    }
  }
  const t = tex(c);
  t.wrapS = RepeatWrapping;
  return t;
}

/** Head-and-shoulders silhouette for the instanced crowd (white on transparent, tinted in the shader). */
function personTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.arc(32, 17, 11, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(8, 64);
  g.quadraticCurveTo(8, 32, 32, 31);
  g.quadraticCurveTo(56, 32, 56, 64);
  g.closePath();
  g.fill();
  return tex(c);
}

/** Night sky: deep ink at the top, a hazy glow where the stand's lights spill into it. */
function skyTexture(): CanvasTexture {
  const [c, g] = canvas(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#020309");
  grad.addColorStop(0.42, "#060914");
  grad.addColorStop(0.5, "#101A33");
  grad.addColorStop(0.56, "#0A1020");
  grad.addColorStop(1, "#05070D");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return tex(c);
}

function paint(geo: BufferGeometry, color: string): BufferGeometry {
  const c = new Color(color);
  const n = geo.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(a, 3));
  return geo;
}

/** A flat quad lying on the grass between two points (a pitch line). */
function lineQuad(x0: number, z0: number, x1: number, z1: number, w = 0.12): BufferGeometry {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new PlaneGeometry(len, w);
  g.rotateX(-Math.PI / 2);
  g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
  g.translate((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
  return g;
}

function arcLines(cx: number, cz: number, r: number, a0: number, a1: number, segs: number, w = 0.12): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (let i = 0; i < segs; i++) {
    const u0 = a0 + ((a1 - a0) * i) / segs;
    const u1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    out.push(lineQuad(cx + Math.cos(u0) * r, cz + Math.sin(u0) * r, cx + Math.cos(u1) * r, cz + Math.sin(u1) * r, w));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Net: a box of grid lines whose nodes ripple outward from where the ball hits.
// ---------------------------------------------------------------------------------------------------------------
interface NetNode {
  x: number;
  y: number;
  z: number;
  /** Outward normal of the panel the node lies on. */
  nx: number;
  ny: number;
  nz: number;
}

function buildNet() {
  const nodes: NetNode[] = [];
  const segs: number[] = [];
  const BACK_H = GOAL_H - 0.25;
  const cols = 22;
  const rows = 9;
  const depth = 6;
  const id = (i: number) => i;
  // Back panel.
  const back: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    back.push([]);
    for (let c = 0; c <= cols; c++) {
      back[r]!.push(nodes.length);
      nodes.push({ x: -GOAL_HW + (c / cols) * GOAL_HW * 2, y: (r / rows) * BACK_H, z: -NET_D, nx: 0, ny: 0, nz: -1 });
    }
  }
  // Roof: from the crossbar back to the top of the back panel.
  const roof: number[][] = [];
  for (let d = 0; d <= depth; d++) {
    roof.push([]);
    for (let c = 0; c <= cols; c++) {
      const k = d / depth;
      if (d === depth) roof[d]!.push(back[rows]![c]!);
      else {
        roof[d]!.push(nodes.length);
        nodes.push({ x: -GOAL_HW + (c / cols) * GOAL_HW * 2, y: GOAL_H + (BACK_H - GOAL_H) * k, z: -NET_D * k, nx: 0, ny: 1, nz: 0 });
      }
    }
  }
  // Sides.
  const sides: number[][][] = [];
  for (const sx of [-1, 1]) {
    const side: number[][] = [];
    for (let d = 0; d <= depth; d++) {
      side.push([]);
      for (let r = 0; r <= rows; r++) {
        const k = d / depth;
        const top = GOAL_H + (BACK_H - GOAL_H) * k;
        if (d === depth) side[d]!.push(back[r]![sx < 0 ? 0 : cols]!);
        else if (r === rows) side[d]!.push(roof[d]![sx < 0 ? 0 : cols]!);
        else {
          side[d]!.push(nodes.length);
          nodes.push({ x: sx * GOAL_HW, y: (r / rows) * top, z: -NET_D * k, nx: sx, ny: 0, nz: 0 });
        }
      }
    }
    sides.push(side);
  }
  const grid = (g: number[][]) => {
    for (let a = 0; a < g.length; a++)
      for (let b = 0; b < g[a]!.length; b++) {
        if (b + 1 < g[a]!.length) segs.push(id(g[a]![b]!), id(g[a]![b + 1]!));
        if (a + 1 < g.length) segs.push(id(g[a]![b]!), id(g[a + 1]![b]!));
      }
  };
  grid(back);
  grid(roof);
  for (const s of sides) grid(s);

  const pos = new Float32Array(segs.length * 3);
  const geo = new BufferGeometry();
  const attr = new BufferAttribute(pos, 3);
  attr.setUsage(DynamicDrawUsage);
  geo.setAttribute("position", attr);
  const disp = new Float32Array(nodes.length);
  const write = () => {
    for (let i = 0; i < segs.length; i++) {
      const n = nodes[segs[i]!]!;
      const d = disp[segs[i]!]!;
      pos[i * 3] = n.x + n.nx * d;
      pos[i * 3 + 1] = n.y + n.ny * d;
      pos[i * 3 + 2] = n.z + n.nz * d;
    }
    attr.needsUpdate = true;
  };
  write();
  geo.computeBoundingSphere();
  const mat = new LineBasicMaterial({ color: "#C9D3E4", transparent: true, opacity: 0.5 });
  const mesh = new LineSegments(geo, mat);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  let amp = 0;
  let t = 99;
  let active = false;
  return {
    mesh,
    hit(x: number, y: number, z: number, strength: number) {
      hx = x;
      hy = y;
      hz = z;
      amp = Math.min(0.55, 0.18 + strength * 0.022);
      t = 0;
      active = true;
    },
    update(dt: number) {
      if (!active) return;
      t += dt;
      const env = Math.exp(-t * 3.2);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const d2 = (n.x - hx) ** 2 + (n.y - hy) ** 2 + (n.z - hz) ** 2;
        const d = Math.sqrt(d2);
        // A bulge where the ball went in, and a ring of ripples running out from it.
        disp[i] = amp * env * (Math.exp(-d2 / 0.35) * Math.cos(t * 9) + 0.45 * Math.exp(-d2 / 3) * Math.sin(t * 16 - d * 5));
      }
      write();
      if (t > 1.6) {
        active = false;
        disp.fill(0);
        write();
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Keeper: a faceless figure in a bright suit with big white gloves (the hands are what you watch).
// ---------------------------------------------------------------------------------------------------------------
function buildKeeper() {
  const suit = new MeshLambertMaterial({ color: KEEPER_SUIT });
  const dark = new MeshLambertMaterial({ color: "#1A1F2C" });
  const glove = new MeshLambertMaterial({ color: PAPER, emissive: new Color("#3A3A30") });
  const root = new Group();
  const body = new Group();
  root.add(body);
  const torso = new Mesh(new CapsuleGeometry(0.21, 0.42, 4, 10), suit);
  torso.position.y = 0.0;
  body.add(torso);
  const head = new Mesh(new SphereGeometry(0.14, 14, 10), dark);
  head.position.y = 0.48;
  body.add(head);
  const mkArm = (side: number) => {
    const pivot = new Group();
    pivot.position.set(side * 0.25, 0.28, 0);
    const arm = new Mesh(new CapsuleGeometry(0.065, 0.42, 3, 8), suit);
    arm.position.y = -0.27;
    pivot.add(arm);
    const hand = new Mesh(new SphereGeometry(0.105, 12, 8), glove);
    hand.position.y = -0.55;
    pivot.add(hand);
    body.add(pivot);
    return pivot;
  };
  const mkLeg = (side: number) => {
    const pivot = new Group();
    pivot.position.set(side * 0.11, -0.36, 0);
    const leg = new Mesh(new CapsuleGeometry(0.085, 0.55, 3, 8), dark);
    leg.position.y = -0.36;
    pivot.add(leg);
    const boot = new Mesh(new BoxGeometry(0.13, 0.08, 0.24), suit);
    boot.position.set(0, -0.7, 0.04);
    pivot.add(boot);
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  const legL = mkLeg(-1);
  const legR = mkLeg(1);
  return { root, body, armL, armR, legL, legR };
}

// ---------------------------------------------------------------------------------------------------------------
// Crowd: instanced silhouettes that bounce when the stand goes up (shader-driven, no per-frame JS).
// ---------------------------------------------------------------------------------------------------------------
function crowdMaterial(map: CanvasTexture | null, bright: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { time: { value: 0 }, swell: { value: 0 }, lift: { value: 0 }, map: { value: map } },
    vertexShader: `
      attribute float phase;
      attribute vec3 tint;
      uniform float time;
      uniform float swell;
      varying vec3 vTint;
      varying float vLit;
      varying vec2 vUv;
      void main() {
        vec4 p = instanceMatrix * vec4(position, 1.0);
        float hop = max(0.0, sin(time * 8.5 + phase * 6.2831));
        p.y += swell * hop * 0.3 + swell * 0.06;
        vTint = tint;
        vLit = swell * (0.35 + 0.65 * hop);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: bright
      ? `
      uniform float lift;
      varying vec3 vTint;
      varying float vLit;
      varying vec2 vUv;
      void main() {
        vec2 d = vUv - 0.5;
        float a = smoothstep(0.5, 0.15, length(d));
        gl_FragColor = vec4(vTint * (0.75 + vLit * 0.5) * a, a);
      }`
      : `
      uniform sampler2D map;
      uniform float lift;
      varying vec3 vTint;
      varying float vLit;
      varying vec2 vUv;
      void main() {
        float a = texture2D(map, vUv).a;
        if (a < 0.5) discard;
        gl_FragColor = vec4(vTint * (0.6 + lift * 0.35 + vLit * 0.9), 1.0);
      }`,
    transparent: bright,
    depthWrite: !bright,
    blending: bright ? AdditiveBlending : NormalBlending,
  });
}

function buildCrowd() {
  const rows = 18;
  const cols = 150;
  const count = rows * cols;
  const geo = new PlaneGeometry(0.46, 0.5);
  geo.translate(0, 0.25, 0);
  const phase = new Float32Array(count);
  const tint = new Float32Array(count * 3);
  const mesh = new InstancedMesh(geo, crowdMaterial(personTexture(), false), count);
  const LIGHTS = 140;
  const lgeo = new PlaneGeometry(0.16, 0.16);
  const lphase = new Float32Array(LIGHTS);
  const ltint = new Float32Array(LIGHTS * 3);
  const lights = new InstancedMesh(lgeo, crowdMaterial(null, true), LIGHTS);
  const m = new Matrix4();
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const palette = [
    [0.13, 0.16, 0.26],
    [0.17, 0.21, 0.33],
    [0.24, 0.2, 0.3],
    [0.1, 0.13, 0.21],
    [0.2, 0.24, 0.3],
  ];
  const glow = [new Color(PAPER), new Color(PAPER), new Color(ACCENT), new Color("#9EC8FF")];
  let i = 0;
  let li = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = -40 + (col + (row % 2) * 0.5) * (80 / cols) + (r() - 0.5) * 0.18;
      // On the rake: 0.65 m back and 0.91 m up per row.
      const z = -11.4 - row * 0.65;
      const y = 0.95 + row * 0.91 + (r() - 0.5) * 0.06;
      const sc = 0.88 + r() * 0.24;
      m.makeScale(sc, sc, 1);
      m.setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
      phase[i] = r();
      const c = palette[Math.floor(r() * palette.length)]!;
      tint[i * 3] = c[0]!;
      tint[i * 3 + 1] = c[1]!;
      tint[i * 3 + 2] = c[2]!;
      if (li < LIGHTS && r() < LIGHTS / count) {
        // Phone lights and scarves held up: steady, they brighten when the stand goes up.
        m.makeTranslation(x + 0.1, y + 0.62, z + 0.05);
        lights.setMatrixAt(li, m);
        lphase[li] = phase[i]!;
        const gc = glow[Math.floor(r() * glow.length)]!;
        ltint[li * 3] = gc.r;
        ltint[li * 3 + 1] = gc.g;
        ltint[li * 3 + 2] = gc.b;
        li++;
      }
      i++;
    }
  }
  lights.count = li;
  geo.setAttribute("phase", new InstancedBufferAttribute(phase, 1));
  geo.setAttribute("tint", new InstancedBufferAttribute(tint, 3));
  lgeo.setAttribute("phase", new InstancedBufferAttribute(lphase, 1));
  lgeo.setAttribute("tint", new InstancedBufferAttribute(ltint, 3));
  mesh.instanceMatrix.needsUpdate = true;
  lights.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  lights.frustumCulled = false;
  const mats = [mesh.material as ShaderMaterial, lights.material as ShaderMaterial];
  return {
    mesh,
    lights,
    set(time: number, swell: number, lift: number) {
      for (const mat of mats) {
        mat.uniforms.time!.value = time;
        mat.uniforms.swell!.value = swell;
        mat.uniforms.lift!.value = lift;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Ball trail: a camera-facing ribbon through the last positions, fading out.
// ---------------------------------------------------------------------------------------------------------------
const TRAIL_N = 26;

function buildTrail() {
  const pos = new Float32Array(TRAIL_N * 2 * 3);
  const col = new Float32Array(TRAIL_N * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < TRAIL_N - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new BufferGeometry();
  const pa = new BufferAttribute(pos, 3);
  pa.setUsage(DynamicDrawUsage);
  const ca = new BufferAttribute(col, 3);
  ca.setUsage(DynamicDrawUsage);
  geo.setAttribute("position", pa);
  geo.setAttribute("color", ca);
  geo.setIndex(idx);
  const mesh = new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
  mesh.frustumCulled = false;
  const pts = new Float32Array(TRAIL_N * 3);
  let n = 0;
  const accent = new Color(ACCENT);
  const right = new Vector3();
  const fwd = new Vector3();
  const tmp = new Vector3();
  return {
    mesh,
    reset() {
      n = 0;
      mesh.visible = false;
    },
    push(x: number, y: number, z: number) {
      if (n === TRAIL_N) pts.copyWithin(0, 3);
      else n++;
      const o = (n - 1) * 3;
      pts[o] = x;
      pts[o + 1] = y;
      pts[o + 2] = z;
    },
    update(camera: Camera, fade: number) {
      mesh.visible = n > 1 && fade > 0.01;
      if (!mesh.visible) return;
      camera.getWorldDirection(fwd);
      for (let i = 0; i < TRAIL_N; i++) {
        const j = Math.min(i, n - 1);
        const o = j * 3;
        const k = n > 1 ? j / (n - 1) : 0;
        // Width across the view: perpendicular to both the trail and the view direction.
        const p = Math.min(n - 1, j + 1) * 3;
        const q = Math.max(0, j - 1) * 3;
        tmp.set(pts[p]! - pts[q]!, pts[p + 1]! - pts[q + 1]!, pts[p + 2]! - pts[q + 2]!);
        right.crossVectors(tmp, fwd).normalize();
        const w = BALL_R * 0.72 * k;
        for (let s = 0; s < 2; s++) {
          const v = (i * 2 + s) * 3;
          const sg = s ? 1 : -1;
          pos[v] = pts[o]! + right.x * w * sg;
          pos[v + 1] = pts[o + 1]! + right.y * w * sg;
          pos[v + 2] = pts[o + 2]! + right.z * w * sg;
          const a = k * k * fade * 0.7;
          col[v] = accent.r * a;
          col[v + 1] = accent.g * a;
          col[v + 2] = accent.b * a;
        }
      }
      pa.needsUpdate = true;
      ca.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------------------------
export function buildWorld(anisotropy: number) {
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog("#0A1020", 34, 95);

  scene.add(new HemisphereLight("#B9C8FF", "#0E2216", 1.25));
  const key = new DirectionalLight("#FFF4E0", 1.6);
  key.position.set(-8, 18, 22);
  scene.add(key);
  const rim = new DirectionalLight("#9FB6FF", 0.7);
  rim.position.set(10, 12, -20);
  scene.add(rim);

  // Grass: 5 m stripes running across the pitch.
  const grass = grassTexture();
  grass.repeat.set(12, 70 / 10);
  grass.anisotropy = anisotropy;
  const pitch = new Mesh(new PlaneGeometry(96, 70), new MeshLambertMaterial({ map: grass }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0, 25);
  scene.add(pitch);

  // Lines: goal line, six-yard box, penalty box, spot and arc.
  const L: BufferGeometry[] = [];
  L.push(lineQuad(-34, 0, 34, 0));
  L.push(lineQuad(-9.16, 0, -9.16, 5.5), lineQuad(9.16, 0, 9.16, 5.5), lineQuad(-9.16, 5.5, 9.16, 5.5));
  L.push(lineQuad(-20.16, 0, -20.16, 16.5), lineQuad(20.16, 0, 20.16, 16.5), lineQuad(-20.16, 16.5, 20.16, 16.5));
  const spot = new CircleGeometry(0.14, 12);
  spot.rotateX(-Math.PI / 2);
  spot.translate(0, 0.012, 11);
  L.push(spot);
  // The arc: the part of the 9.15 m circle around the spot outside the box.
  const a = Math.acos(5.5 / 9.15);
  L.push(...arcLines(0, 11, 9.15, Math.PI / 2 - a, Math.PI / 2 + a, 18));
  const lines = new Mesh(mergeGeometries(L), new MeshLambertMaterial({ color: LINE, emissive: new Color("#141B17") }));
  scene.add(lines);

  // Goal frame (posts + bar, a little depth bar behind for the net to hang off).
  const frameParts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const p = new CylinderGeometry(POST_R, POST_R, GOAL_H + POST_R, 12);
    p.translate(sx * GOAL_HW, (GOAL_H + POST_R) / 2, 0);
    frameParts.push(p);
    const back = new CylinderGeometry(0.03, 0.03, NET_D, 6);
    back.rotateX(Math.PI / 2);
    back.translate(sx * GOAL_HW, 0.03, -NET_D / 2);
    frameParts.push(back);
  }
  const bar = new CylinderGeometry(POST_R, POST_R, GOAL_HW * 2 + POST_R * 2, 12);
  bar.rotateZ(Math.PI / 2);
  bar.translate(0, GOAL_H, 0);
  frameParts.push(bar);
  const frame = new Mesh(mergeGeometries(frameParts), new MeshLambertMaterial({ color: PAPER, emissive: new Color("#3B3A36") }));
  scene.add(frame);

  const net = buildNet();
  scene.add(net.mesh);

  // Corner rings: a torus with a soft halo, in the accent.
  const halo = glowTexture("rgba(228,255,58,0.55)", "rgba(228,255,58,0)");
  const ringMeshes: Array<{ torus: Mesh; glow: Mesh; disc: Mesh }> = [];
  for (let i = 0; i < 2; i++) {
    const torus = new Mesh(new TorusGeometry(1, 0.075, 8, 40), new MeshBasicMaterial({ color: ACCENT, transparent: true }));
    const glow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: halo, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    const disc = new Mesh(new CircleGeometry(1, 32), new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.08, depthWrite: false }));
    for (const m of [glow, disc, torus]) scene.add(m);
    ringMeshes.push({ torus, glow, disc });
  }

  // LED boards behind the goal and down both sides of the box.
  const boardIdle = boardTexture("CURLWALL  ·  BEND IT  ·  THUMBCADE  ·", ACCENT, "#0B0F1A");
  const boardGoal = boardTexture("GOAL  GOAL  GOAL  ·", "#0B0F1A", ACCENT);
  boardIdle.repeat.set(5, 1);
  boardGoal.repeat.set(8, 1);
  const boardMat = new MeshBasicMaterial({ map: boardIdle, fog: true });
  const boardGeo = new BoxGeometry(64, 0.9, 0.12);
  boardGeo.translate(0, 0.45, -4.2);
  const boards = new Mesh(boardGeo, boardMat);
  scene.add(boards);

  // Stand behind the boards: a raked block of tiers, with the instanced crowd on it.
  const standTex = standTexture();
  standTex.repeat.set(6, 1);
  // A steep rake from behind the boards up under the roof: (y 0.4, z -11) to (y 19.4, z -24.6).
  const standGeo = new PlaneGeometry(96, 23.4);
  standGeo.rotateX(-0.62);
  standGeo.translate(0, 9.9, -17.8);
  const stand = new Mesh(standGeo, new MeshBasicMaterial({ map: standTex, fog: true }));
  scene.add(stand);
  const roofGeo = new BoxGeometry(100, 0.9, 10);
  roofGeo.translate(0, 18.1, -21.6);
  const roof = new Mesh(roofGeo, new MeshBasicMaterial({ color: "#070A12", fog: true }));
  scene.add(roof);
  const crowd = buildCrowd();
  scene.add(crowd.mesh);
  scene.add(crowd.lights);

  // Sky and a few stars.
  const sky = new Mesh(new SphereGeometry(170, 16, 12), new MeshBasicMaterial({ map: skyTexture(), side: BackSide, fog: false, depthWrite: false }));
  sky.position.set(0, -20, 0);
  scene.add(sky);
  {
    const n = 140;
    const p = new Float32Array(n * 3);
    let st = 5;
    const r = () => ((st = (st * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const a = (r() - 0.5) * 1.6;
      const e = 0.18 + r() * 0.5;
      p[i * 3] = Math.sin(a) * 150 * Math.cos(e);
      p[i * 3 + 1] = Math.sin(e) * 150;
      p[i * 3 + 2] = -Math.cos(a) * 150 * Math.cos(e);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(p, 3));
    scene.add(new Points(g, new PointsMaterial({ color: "#C9D1E8", size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));
  }

  // Floodlights: a row of lamp banks along the front edge of the stand roof, each with a halo.
  const lampParts: BufferGeometry[] = [];
  const glowParts: BufferGeometry[] = [];
  for (let x = -38; x <= 38; x += 5.5) {
    const housing = new BoxGeometry(2.4, 0.9, 0.4);
    housing.rotateX(0.5);
    housing.translate(x, 17.35, -16.75);
    lampParts.push(paint(housing, "#141A28"));
    for (let c = 0; c < 3; c++) {
      const lamp = new PlaneGeometry(0.62, 0.5);
      lamp.rotateX(0.5);
      lamp.translate(x - 0.72 + c * 0.72, 17.27, -16.5);
      lampParts.push(paint(lamp, "#FFF8E2"));
    }
    const halo = new PlaneGeometry(7, 5);
    halo.translate(x, 17.1, -16.2);
    glowParts.push(halo);
  }
  scene.add(new Mesh(mergeGeometries(lampParts), new MeshBasicMaterial({ vertexColors: true, fog: false })));
  const flood = glowTexture("rgba(255,246,220,0.34)", "rgba(255,246,220,0)");
  const floodGlow = new Mesh(mergeGeometries(glowParts), new MeshBasicMaterial({ map: flood, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
  scene.add(floodGlow);
  const floodGlows = [floodGlow];

  // Wall of training mannequins: rounded body, head, a spring stand and an accent band at the waist.
  const body = paint(new CapsuleGeometry(MAN_R, 1.48 - MAN_R * 2, 4, 14), "#3A4254");
  body.translate(0, 0.74, 0);
  const band = paint(new CylinderGeometry(MAN_R + 0.012, MAN_R + 0.012, 0.09, 14, 1, true), ACCENT);
  band.translate(0, 0.92, 0);
  const neck = paint(new CylinderGeometry(0.06, 0.08, 0.14, 10), "#2C3242");
  neck.translate(0, 1.5, 0);
  const headG = paint(new SphereGeometry(0.135, 14, 10), "#3A4254");
  headG.translate(0, MAN_H - 0.135, 0);
  const foot = paint(new CylinderGeometry(0.2, 0.26, 0.06, 14), "#1D2230");
  foot.translate(0, 0.03, 0);
  const manGeo = mergeGeometries([body, band, neck, headG, foot]);
  const wall = new InstancedMesh(manGeo, new MeshLambertMaterial({ vertexColors: true }), 6);
  wall.count = 0;
  scene.add(wall);

  // Soft blob shadows (no shadow maps): one instanced set for the mannequins, plus keeper and ball.
  const blob = glowTexture("rgba(0,0,0,0.62)", "rgba(0,0,0,0)");
  const blobGeo = new PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false });
  const wallShadows = new InstancedMesh(blobGeo, blobMat, 6);
  wallShadows.count = 0;
  scene.add(wallShadows);
  const keeperShadow = new Mesh(blobGeo, blobMat);
  scene.add(keeperShadow);
  const ballShadow = new Mesh(blobGeo, blobMat);
  scene.add(ballShadow);

  // Spray: the referee's foam line in front of the wall and the ring round the ball.
  const sprayMat = new MeshBasicMaterial({ color: "#EEF3F0", transparent: true, opacity: 0.45, depthWrite: false });
  const spray = new Mesh(new BufferGeometry(), sprayMat);
  scene.add(spray);

  const keeper = buildKeeper();
  scene.add(keeper.root);

  const ball = new Mesh(new SphereGeometry(BALL_R, 24, 16), new MeshLambertMaterial({ map: ballTexture(), emissive: new Color("#24231F") }));
  scene.add(ball);

  const trail = buildTrail();
  scene.add(trail.mesh);

  const m4 = new Matrix4();
  const o3 = new Object3D();

  return {
    scene,
    ball,
    ballShadow,
    keeperShadow,
    trail,
    net,
    crowd,
    keeper,
    floodGlows,
    /** Places the mannequins (lift = jump height) and their shadows. */
    setWall(men: readonly Vec2[], lift: number, time: number) {
      wall.count = men.length;
      wallShadows.count = men.length;
      for (let i = 0; i < men.length; i++) {
        const m = men[i]!;
        // Each dummy rocks a little on its spring stand.
        o3.position.set(m.x, lift * (0.92 + 0.08 * Math.sin(i * 1.7)), m.y);
        o3.rotation.set(Math.sin(time * 1.3 + i * 2.1) * 0.025, 0, Math.sin(time * 1.1 + i) * 0.03);
        o3.scale.set(1, 1, 1);
        o3.updateMatrix();
        wall.setMatrixAt(i, o3.matrix);
        const s = 0.95 - lift * 0.8;
        m4.makeScale(s, 1, s * 0.8);
        m4.setPosition(m.x, 0.015, m.y);
        wallShadows.setMatrixAt(i, m4);
      }
      wall.instanceMatrix.needsUpdate = true;
      wallShadows.instanceMatrix.needsUpdate = true;
    },
    /** Foam: a dashed line across the wall's feet and a ring around the ball. */
    setSpray(spotX: number, spotZ: number, men: readonly Vec2[]) {
      const parts: BufferGeometry[] = [];
      const ring = new RingGeometry(0.33, 0.37, 28);
      ring.rotateX(-Math.PI / 2);
      ring.translate(spotX, 0.014, spotZ);
      parts.push(ring);
      if (men.length) {
        const a = men[0]!;
        const b = men[men.length - 1]!;
        const dx = b.x - a.x;
        const dz = b.y - a.y;
        const len = Math.hypot(dx, dz) || 1;
        // In front of the wall (toward the ball).
        const nx = (spotX - (a.x + b.x) / 2) / Math.hypot(spotX - (a.x + b.x) / 2, spotZ - (a.y + b.y) / 2);
        const nz = (spotZ - (a.y + b.y) / 2) / Math.hypot(spotX - (a.x + b.x) / 2, spotZ - (a.y + b.y) / 2);
        const ext = 0.55;
        const x0 = a.x - (dx / len) * ext + nx * 0.45;
        const z0 = a.y - (dz / len) * ext + nz * 0.45;
        const steps = Math.max(3, Math.round((len + ext * 2) / 0.3));
        for (let i = 0; i < steps; i += 1) {
          if (i % 3 === 2) continue;
          const u0 = i / steps;
          const u1 = (i + 1) / steps;
          const tl = len + ext * 2;
          parts.push(lineQuad(x0 + (dx / len) * tl * u0, z0 + (dz / len) * tl * u0, x0 + (dx / len) * tl * u1, z0 + (dz / len) * tl * u1, 0.1));
        }
      }
      spray.geometry.dispose();
      spray.geometry = mergeGeometries(parts);
      for (const p of parts) p.dispose();
    },
    /** Rings: position, size, a slow breath, and a burst when scored through. */
    setRings(rings: readonly Ring[], breath: number, burst: number, burstIndex: number) {
      for (let i = 0; i < ringMeshes.length; i++) {
        const rm = ringMeshes[i]!;
        const r = rings[i];
        const vis = !!r;
        rm.torus.visible = rm.glow.visible = rm.disc.visible = vis;
        if (!r) continue;
        const b = i === burstIndex ? burst : 0;
        const s = r.r * (1 + b * 0.9);
        rm.torus.position.set(r.x, r.y, 0.02);
        rm.torus.scale.set(s, s, s);
        (rm.torus.material as MeshBasicMaterial).opacity = 1 - b;
        rm.disc.position.set(r.x, r.y, 0.01);
        rm.disc.scale.setScalar(r.r);
        (rm.disc.material as MeshBasicMaterial).opacity = 0.06 + 0.06 * breath + b * 0.25;
        rm.glow.position.set(r.x, r.y, 0.005);
        rm.glow.scale.setScalar(r.r * (3.2 + breath * 0.5 + b * 3));
        (rm.glow.material as MeshBasicMaterial).opacity = 0.55 + 0.35 * breath;
      }
    },
    /** LED boards: scroll; `goal` (0..1) switches them to the goal message. */
    setBoards(dt: number, goal: boolean, glow: number) {
      const map = goal ? boardGoal : boardIdle;
      if (boardMat.map !== map) {
        boardMat.map = map;
        boardMat.needsUpdate = true;
      }
      map.offset.x = (map.offset.x + dt * (goal ? 0.12 : 0.025)) % 1;
      boardMat.color.setScalar(0.75 + glow * 0.25);
    },
    setShadow(mesh: Mesh, x: number, z: number, size: number, alpha: number) {
      mesh.position.set(x, 0.016, z);
      mesh.scale.set(size, 1, size);
      mesh.visible = alpha > 0.02;
    },
    materials(): Material[] {
      const out: Material[] = [];
      scene.traverse((o) => {
        const m = (o as Mesh).material;
        if (m) out.push(...(Array.isArray(m) ? m : [m]));
      });
      return out;
    },
  };
}

export type World = ReturnType<typeof buildWorld>;

/**
 * Poses the keeper so his gloves sit at the hands point (kx, ky), from his set position. A big offset turns into a
 * full-stretch dive (the body tips over toward the ball); a small one is a step and a reach.
 */
export function poseKeeper(k: World["keeper"], kx: number, ky: number, standX: number, time: number, ready: number): void {
  const ox = kx - standX;
  const oy = ky - KEEPER_Y;
  const reach = Math.min(1, Math.hypot(ox, oy * 1.2) / 1.1);
  // Tilt: zero standing, up to nearly flat at full stretch.
  const tilt = Math.max(-1.4, Math.min(1.4, Math.atan2(ox, 1.35 + Math.max(0, oy) * 0.8) * 1.25 * Math.min(1, Math.abs(ox) / 0.5)));
  // The body centre sits back from the gloves along the body axis (arms up for a stretch).
  const L = 0.42 + 0.62 * reach;
  let cx = kx - Math.sin(tilt) * L;
  let cy = ky - Math.cos(tilt) * L * (0.55 + 0.45 * reach) - (1 - reach) * 0.08;
  // Feet on the ground when standing, a little bounce on the toes while waiting.
  // Set: knees bent a touch, bouncing on his toes.
  const stand = 0.95 + ready * Math.abs(Math.sin(time * 5.2)) * 0.035;
  if (reach < 0.25) cy = Math.max(cy, stand);
  cy = Math.max(0.32, cy);
  cx = Math.max(-GOAL_HW - 0.4, Math.min(GOAL_HW + 0.4, cx));
  k.root.position.set(cx, cy, 0.25);
  k.body.rotation.z = -tilt;
  // Arms: out and forward when set; reaching for the hands point as he stretches. The target goes into the body's
  // own frame (it is tilted), and each arm points from its shoulder at it.
  // Aim past the gloves, along the line from the body through them, so the arms always reach outward.
  const rl = Math.hypot(kx - cx, ky - cy) || 1;
  const dx0 = kx - cx + ((kx - cx) / rl) * 1.5;
  const dy0 = ky - cy + ((ky - cy) / rl) * 1.5;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const lx = dx0 * c - dy0 * s;
  const ly = dx0 * s + dy0 * c;
  const blend = Math.min(1, Math.max(0, reach - 0.12) * 1.6);
  const aim = (sx: number, sy: number, rest: number) => {
    let a = Math.atan2(lx - sx, -(ly - sy)) - rest;
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return rest + a * blend;
  };
  k.armL.rotation.set(-0.55 * (1 - blend), 0, aim(-0.25, 0.28, -0.6));
  k.armR.rotation.set(-0.55 * (1 - blend), 0, aim(0.25, 0.28, 0.6));
  // Legs: a wide set stance, trailing together in the dive.
  const legSpread = 0.22 * (1 - reach) + 0.05;
  k.legL.rotation.z = -legSpread;
  k.legR.rotation.z = legSpread;
}
