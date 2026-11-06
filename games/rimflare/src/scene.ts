/**
 * The rooftop at night: a painted court on tar, a parapet and chain-link cage, string lights, two floodlights, the
 * hoop on its pole (glass board, shot clock, rim and a string net), and a skyline whose windows switch on one by one
 * as you score. Static pieces are merged into a handful of meshes; nothing here allocates per frame.
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
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRng } from "@thumbcade-games/kit/rng";
import { FONT_DISPLAY, FONT_MONO } from "@thumbcade-games/kit/fonts";
import { BALL_R, BOARD_BOTTOM, BOARD_H, BOARD_W, BOARD_Z, NET_DEPTH, RIM_R, RIM_Y } from "./sim.ts";

export const ACCENT = "#EC1380";
export const BALL_ORANGE = "#E8762E";
export const SKY = "#05060B";
/** Balls in the pool: three in the air, two still bouncing, one in your hands, one spare. */
export const BALL_POOL = 7;
const INK = "#0D0D10";
const PAPER = "#F3F0E8";
const FOG = "#0B0E1A";

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
  const n = geo.getAttribute("position").count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(a, 3));
  return geo.index ? geo.toNonIndexed() : geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: string): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, color);
}

// ---------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------

/** A ball, equirectangular: pebbled leather with ink seams (two great circles and the two curved panels). */
export function ballTexture(base: string, seam: string, stripe?: string): CanvasTexture {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // Pebbling: tiny light and dark dots.
  const rng = createRng(11);
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = rng() < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.07)";
    g.fillRect(rng() * W, rng() * H, 1.6, 1.6);
  }
  if (stripe) {
    g.fillStyle = stripe;
    g.fillRect(0, H / 2 - 30, W, 18);
    g.fillRect(0, H / 2 + 12, W, 18);
  }
  g.strokeStyle = seam;
  g.lineWidth = 6;
  g.lineCap = "round";
  // Equator and one meridian pair.
  g.beginPath();
  g.moveTo(0, H / 2);
  g.lineTo(W, H / 2);
  g.moveTo(W / 4, 0);
  g.lineTo(W / 4, H);
  g.moveTo((W * 3) / 4, 0);
  g.lineTo((W * 3) / 4, H);
  g.stroke();
  // Two small circles around the equator at longitude 0 and 180 (angular radius 52°).
  const r = (52 * Math.PI) / 180;
  for (const lon0 of [0, Math.PI]) {
    for (const side of [-1, 1]) {
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const lat = -r + (2 * r * i) / 40;
        const k = Math.cos(r) / Math.cos(lat);
        const dl = k >= 1 ? 0 : Math.acos(k);
        const lon = lon0 + side * dl;
        const x = (((lon / (Math.PI * 2)) % 1) + 1) % 1;
        const px = x * W;
        const py = (0.5 - lat / Math.PI) * H;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  const t = tex(c);
  t.anisotropy = 4;
  return t;
}

/** The court: tar with grit, the key painted in the accent, lines in paper. 16 m wide, 18 m deep. */
function courtTexture(): CanvasTexture {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const M = S / 18; // px per metre (depth); width uses the same scale centred
  const X = (x: number) => S / 2 + x * M;
  const Z = (z: number) => (z + 2.2) * M; // baseline region near the top of the texture
  g.fillStyle = "#17181F";
  g.fillRect(0, 0, S, S);
  const rng = createRng(5);
  for (let i = 0; i < 26000; i++) {
    const v = rng();
    g.fillStyle = v < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.25)";
    g.fillRect(rng() * S, rng() * S, 1.5, 1.5);
  }
  // Patches of newer tar.
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(0,0,0,${0.08 + rng() * 0.1})`;
    g.beginPath();
    g.ellipse(rng() * S, rng() * S, 30 + rng() * 90, 20 + rng() * 60, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const base = -1.575;
  // Key: 4.9 m wide, out to the free-throw line 4.6 m from the board.
  const ft = 4.6 + BOARD_Z;
  g.fillStyle = "rgba(236,19,128,0.16)";
  g.fillRect(X(-2.45), Z(base), 4.9 * M, (ft - base) * M);
  g.strokeStyle = "rgba(243,240,232,0.82)";
  g.lineWidth = 0.06 * M;
  g.strokeRect(X(-2.45), Z(base), 4.9 * M, (ft - base) * M);
  // Free-throw circle.
  g.beginPath();
  g.arc(X(0), Z(ft), 1.8 * M, 0, Math.PI);
  g.stroke();
  g.setLineDash([0.4 * M, 0.35 * M]);
  g.beginPath();
  g.arc(X(0), Z(ft), 1.8 * M, Math.PI, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  // Restricted arc and baseline.
  g.beginPath();
  g.arc(X(0), Z(0), 1.25 * M, 0, Math.PI);
  g.stroke();
  g.beginPath();
  g.moveTo(X(-8), Z(base));
  g.lineTo(X(8), Z(base));
  g.stroke();
  // Three-point line: 6.75 m arc, straight in the corners.
  const r3 = 6.75;
  const cx = 6.6;
  const a = Math.asin(cx / r3);
  g.beginPath();
  g.moveTo(X(-cx), Z(base));
  g.lineTo(X(-cx), Z(Math.cos(a) * r3));
  g.arc(X(0), Z(0), r3 * M, Math.PI / 2 + a, Math.PI / 2 - a, true);
  g.lineTo(X(cx), Z(base));
  g.stroke();
  // Sidelines.
  g.beginPath();
  g.moveTo(X(-7.5), Z(base));
  g.lineTo(X(-7.5), S);
  g.moveTo(X(7.5), Z(base));
  g.lineTo(X(7.5), S);
  g.stroke();
  // Scuffs on the paint.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = "rgba(23,24,31,0.5)";
    g.fillRect(rng() * S, rng() * S, 2 + rng() * 3, 1);
  }
  const t = tex(c);
  t.anisotropy = 8;
  return t;
}

/** Chain-link: a diamond lattice with alpha. */
function fenceTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(160,170,190,0.9)";
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function glowTexture(inner: string, outer: string): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return tex(c);
}

function skyTexture(): CanvasTexture {
  const [c, g] = canvas(4, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#030409");
  grad.addColorStop(0.5, "#070A14");
  grad.addColorStop(0.78, "#10142A");
  grad.addColorStop(0.9, "#1E1B30");
  grad.addColorStop(1, "#0B0E1A");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  return tex(c);
}

/** The shot clock on top of the board: amber-free LED digits in the accent on ink. */
function clockFace() {
  const [c, g] = canvas(256, 128);
  const t = tex(c);
  let shown = "";
  return {
    texture: t,
    set(text: string, hot: boolean) {
      if (text === shown) return;
      shown = text;
      g.fillStyle = "#07070A";
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = "#1A1A22";
      g.fillRect(6, 6, 244, 116);
      g.fillStyle = "#07070A";
      g.fillRect(12, 12, 232, 104);
      g.font = `${text.length > 3 ? 54 : 84}px ${FONT_MONO}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = hot ? PAPER : ACCENT;
      g.fillText(text, 128, 70);
      t.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The net: twelve strings in a diamond weave whose knots spring back after the ball goes through.
// ---------------------------------------------------------------------------------------------------------------
const NET_COLS = 12;
const NET_ROWS = 5;

function buildNet() {
  // Knot rest positions, relative to the rim centre.
  const rest: number[] = [];
  const radius = (r: number) => RIM_R - 0.005 - (RIM_R - 0.12) * (r / (NET_ROWS - 1)) ** 0.85;
  for (let r = 0; r < NET_ROWS; r++) {
    const rad = radius(r);
    const y = -(NET_DEPTH * r) / (NET_ROWS - 1);
    for (let i = 0; i < NET_COLS; i++) {
      const a = ((i + (r % 2) * 0.5) / NET_COLS) * Math.PI * 2;
      rest.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
    }
  }
  const N = rest.length / 3;
  const off = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const segs: number[] = [];
  for (let r = 0; r < NET_ROWS - 1; r++) {
    for (let i = 0; i < NET_COLS; i++) {
      const a = r * NET_COLS + i;
      const b0 = (r + 1) * NET_COLS + i;
      const b1 = (r + 1) * NET_COLS + ((i + (r % 2 ? 1 : NET_COLS - 1)) % NET_COLS);
      segs.push(a, b0, a, b1);
    }
  }
  const pos = new Float32Array(segs.length * 3);
  const geo = new BufferGeometry();
  const attr = new BufferAttribute(pos, 3);
  attr.setUsage(DynamicDrawUsage);
  geo.setAttribute("position", attr);
  const mat = new LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.88 });
  const mesh = new LineSegments(geo, mat);
  mesh.frustumCulled = false;
  const write = () => {
    for (let s = 0; s < segs.length; s++) {
      const k = segs[s]!;
      pos[s * 3] = rest[k * 3]! + off[k * 3]!;
      pos[s * 3 + 1] = rest[k * 3 + 1]! + off[k * 3 + 1]!;
      pos[s * 3 + 2] = rest[k * 3 + 2]! + off[k * 3 + 2]!;
    }
    attr.needsUpdate = true;
  };
  write();
  return {
    mesh,
    material: mat,
    /** A ball at (x, y, z) relative to the rim centre pushes the knots it touches out of the way. */
    push(x: number, y: number, z: number, vy: number) {
      for (let k = 0; k < N; k++) {
        const kx = rest[k * 3]! + off[k * 3]!;
        const ky = rest[k * 3 + 1]! + off[k * 3 + 1]!;
        const kz = rest[k * 3 + 2]! + off[k * 3 + 2]!;
        const dx = kx - x;
        const dy = ky - y;
        const dz = kz - z;
        const d = Math.hypot(dx, dy, dz);
        const reach = BALL_R + 0.03;
        if (d < reach && d > 1e-4) {
          const p = (reach - d) / d;
          off[k * 3]! += dx * p;
          off[k * 3 + 2]! += dz * p;
          off[k * 3 + 1]! += dy * p * 0.5;
          vel[k * 3 + 1]! += vy * 0.5;
        }
      }
    },
    /** A swish whips the whole net: the lower rows kick down and out. */
    whip(power: number) {
      for (let k = 0; k < N; k++) {
        const r = Math.floor(k / NET_COLS) / (NET_ROWS - 1);
        vel[k * 3 + 1]! -= power * r * 1.6;
        vel[k * 3]! += rest[k * 3]! * power * r * 3;
        vel[k * 3 + 2]! += rest[k * 3 + 2]! * power * r * 3;
      }
    },
    update(dt: number) {
      if (dt <= 0) return;
      const h = Math.min(dt, 1 / 30);
      for (let i = 0; i < N * 3; i++) {
        // A damped spring back to rest.
        vel[i] = (vel[i]! - off[i]! * 190 * h) * Math.exp(-7 * h);
        off[i]! += vel[i]! * h;
      }
      write();
    },
    reset() {
      off.fill(0);
      vel.fill(0);
      write();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The skyline: boxes and an instanced field of windows that switch on as the city "wakes up".
// ---------------------------------------------------------------------------------------------------------------
function buildCity() {
  const rng = createRng(2027);
  const towers: Array<{ x: number; z: number; w: number; d: number; top: number }> = [];
  // Four loose rows of towers well beyond the roof, mostly at or below our height: a skyline on the horizon.
  for (let row = 0; row < 4; row++) {
    const z = -52 - row * 24;
    let x = -130 + rng() * 10;
    while (x < 130) {
      const w = 8 + rng() * 14;
      const tall = row > 0 && rng() < 0.2 ? 10 + rng() * 16 : 0;
      const top = -3 + rng() * (6 + row * 3) + tall;
      towers.push({ x: x + w / 2, z: z - rng() * 10, w, d: 10 + rng() * 8, top });
      x += w + 2 + rng() * 6;
    }
  }
  const unit = new BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const bodies = new InstancedMesh(unit, new MeshBasicMaterial({ color: "#ffffff" }), towers.length);
  const o = new Object3D();
  const col = new Color();
  const BOTTOM = -60;
  towers.forEach((t, i) => {
    o.position.set(t.x, BOTTOM, t.z);
    o.scale.set(t.w, t.top - BOTTOM, t.d);
    o.updateMatrix();
    bodies.setMatrixAt(i, o.matrix);
    col.set("#0A0C16").lerp(new Color("#141A2C"), rng() * 0.7);
    bodies.setColorAt(i, col);
  });

  // Windows on the faces toward the court.
  const seeds: number[] = [];
  const kinds: number[] = [];
  const mats: number[] = [];
  const m = new Object3D();
  for (const t of towers) {
    const cols = Math.max(2, Math.floor(t.w / 2.3));
    const rows = Math.min(14, Math.floor((t.top + 8) / 3.1));
    const span = (cols - 1) * 2.3;
    const faceZ = t.z + t.d / 2 + 0.02;
    for (let r = 0; r < rows; r++) {
      const y = t.top - 2 - r * 3.1;
      if (y < -8) break;
      for (let c = 0; c < cols; c++) {
        if (rng() < 0.12) continue;
        m.position.set(t.x - span / 2 + c * 2.3, y, faceZ);
        m.scale.set(1.3, 1.8, 1);
        m.updateMatrix();
        mats.push(...m.matrix.elements);
        // Upper floors light up first: a city waking from the top down reads as "the lights are coming on".
        seeds.push(Math.min(0.99, rng() * 0.75 + (r / rows) * 0.25));
        const k = rng();
        kinds.push(k < 0.06 ? 2 : k < 0.3 ? 1 : 0);
      }
    }
  }
  const count = seeds.length;
  const winGeo = new PlaneGeometry(1, 1);
  winGeo.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(seeds), 1));
  winGeo.setAttribute("aKind", new InstancedBufferAttribute(new Float32Array(kinds), 1));
  const accent = new Color(ACCENT);
  const winMat = new ShaderMaterial({
    uniforms: { uLit: { value: 0.2 }, uFogColor: { value: new Color(FOG) }, uAccent: { value: accent } },
    vertexShader: `
      attribute float aSeed;
      attribute float aKind;
      uniform float uLit;
      uniform vec3 uAccent;
      varying vec3 vCol;
      varying float vDepth;
      void main() {
        float on = smoothstep(aSeed - 0.035, aSeed, uLit);
        vec3 warm = vec3(1.0, 0.80, 0.52);
        vec3 cool = vec3(0.72, 0.84, 1.0);
        vec3 lit = aKind > 1.5 ? uAccent : (aKind > 0.5 ? cool : warm);
        float shade = 0.7 + 0.3 * fract(aSeed * 91.7);
        vCol = mix(vec3(0.045, 0.05, 0.08), lit * shade, on);
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uFogColor;
      varying vec3 vCol;
      varying float vDepth;
      void main() {
        float f = smoothstep(60.0, 190.0, vDepth) * 0.6;
        gl_FragColor = vec4(mix(vCol, uFogColor, f), 1.0);
      }`,
  });
  const windows = new InstancedMesh(winGeo, winMat, count);
  const arr = windows.instanceMatrix.array as Float32Array;
  arr.set(mats);
  windows.instanceMatrix.needsUpdate = true;
  windows.frustumCulled = false;
  bodies.frustumCulled = false;
  return { bodies, windows, material: winMat, count };
}

// ---------------------------------------------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------------------------------------------
export function buildWorld(anisotropy: number) {
  const scene = new Scene();
  scene.background = new Color(SKY);
  scene.fog = new Fog(FOG, 50, 230);

  scene.add(new HemisphereLight("#9AA8D8", "#1A1622", 1.15));
  // The floodlights in the near corners throw a warm key light across the court.
  const key = new DirectionalLight("#FFF1DE", 1.7);
  key.position.set(-6, 14, 14);
  scene.add(key);
  const back = new DirectionalLight("#9CB4FF", 0.55);
  back.position.set(6, 9, -16);
  scene.add(back);

  // Sky: a tall gradient card behind everything, a few stars.
  const sky = new Mesh(new PlaneGeometry(420, 160), new MeshBasicMaterial({ map: skyTexture(), fog: false, depthWrite: false }));
  sky.position.set(0, 30, -150);
  scene.add(sky);
  const starPos: number[] = [];
  const srng = createRng(9);
  for (let i = 0; i < 140; i++) starPos.push((srng() - 0.5) * 360, 40 + srng() * 80, -140);
  const starGeo = new BufferGeometry();
  starGeo.setAttribute("position", new BufferAttribute(new Float32Array(starPos), 3));
  scene.add(new Points(starGeo, new PointsMaterial({ color: "#C9D2EE", size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 })));

  const city = buildCity();
  scene.add(city.bodies, city.windows);

  // Roof and court.
  const court = courtTexture();
  court.anisotropy = anisotropy;
  const floor = new Mesh(new PlaneGeometry(16, 18), new MeshLambertMaterial({ map: court }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -2.2 + 9);
  scene.add(floor);
  const roof = new Mesh(new PlaneGeometry(60, 60), new MeshLambertMaterial({ color: "#121318" }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(0, -0.01, 10);
  scene.add(roof);

  // Parapet, cage posts, a water tower on the next roof over.
  const P: BufferGeometry[] = [];
  const PZ = -4.6;
  P.push(box(20, 1.0, 0.4, 0, 0.5, PZ, "#22232C"));
  P.push(box(20.2, 0.12, 0.55, 0, 1.06, PZ, "#3A3B46"));
  for (const sx of [-1, 1]) {
    P.push(box(0.4, 1.0, 22, sx * 10, 0.5, PZ + 11, "#22232C"));
    P.push(box(0.55, 0.12, 22.2, sx * 10, 1.06, PZ + 11, "#3A3B46"));
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) P.push(box(0.08, 4.4, 0.08, sx * 10, 3.3, PZ + i * 4.5, "#4A4D5C"));
  // Water tower: barrel, cone roof, legs, on a lower roof to the left.
  const tower = new CylinderGeometry(2.1, 2.1, 4.2, 18);
  tower.translate(-17, 6.1, -24);
  P.push(paint(tower, "#191520"));
  const cone = new CylinderGeometry(0.15, 2.4, 1.6, 18);
  cone.translate(-17, 9.0, -24);
  P.push(paint(cone, "#14111A"));
  for (const [lx, lz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) P.push(box(0.18, 4, 0.18, -17 + lx, 2.0, -24 + lz, "#120F16"));
  // Floodlight masts in the far corners.
  for (const sx of [-1, 1]) {
    P.push(box(0.16, 7.2, 0.16, sx * 9.4, 3.6, PZ + 0.4, "#3A3D4A"));
    P.push(box(1.1, 0.5, 0.3, sx * 9.4, 7.3, PZ + 0.5, "#2C2E38"));
  }
  const parapet = new Mesh(mergeGeometries(P), new MeshLambertMaterial({ vertexColors: true }));
  scene.add(parapet);

  // Chain-link on the sides only, so nothing busy hangs behind the hoop.
  const fenceTex = fenceTexture();
  fenceTex.repeat.set(20 / 0.24, 4.4 / 0.24);
  const fenceMat = new MeshBasicMaterial({ map: fenceTex, transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide, color: "#8C93A8" });
  for (const sx of [-1, 1]) {
    const side = new Mesh(new PlaneGeometry(20, 4.4), fenceMat);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * 10, 3.3, PZ + 10);
    scene.add(side);
  }

  // String lights: warm bulbs sagging along both side fences and one high strand between the floodlight masts.
  const strands: Array<[number, number, number, number, number, number, number]> = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) strands.push([sx * 9.75, 4.5, PZ + i * 4.5, sx * 9.75, 4.5, PZ + (i + 1) * 4.5, 0.55]);
  for (let i = 0; i < 3; i++) strands.push([-9.4 + i * 6.27, 6.1, PZ + 0.3, -9.4 + (i + 1) * 6.27, 6.1, PZ + 0.3, 0.45]);
  const PER = 9;
  const bulbs = new InstancedMesh(new SphereGeometry(0.07, 6, 4), new MeshBasicMaterial({ color: "#FFD9A0", fog: false }), strands.length * PER);
  const bo = new Object3D();
  const wirePts: number[] = [];
  let bi = 0;
  const at = (st: (typeof strands)[number], u: number) => [st[0] + (st[3] - st[0]) * u, st[1] + (st[4] - st[1]) * u - Math.sin(u * Math.PI) * st[6], st[2] + (st[5] - st[2]) * u] as const;
  for (const st of strands) {
    for (let k = 0; k < PER; k++) {
      const [x, y, z] = at(st, (k + 0.5) / PER);
      bo.position.set(x, y - 0.06, z);
      bo.updateMatrix();
      bulbs.setMatrixAt(bi++, bo.matrix);
    }
    for (let k = 0; k < 12; k++) {
      const p0 = at(st, k / 12);
      const p1 = at(st, (k + 1) / 12);
      wirePts.push(...p0, ...p1);
    }
  }
  scene.add(bulbs);
  const wireGeo = new BufferGeometry();
  wireGeo.setAttribute("position", new BufferAttribute(new Float32Array(wirePts), 3));
  scene.add(new LineSegments(wireGeo, new LineBasicMaterial({ color: "#2A2C36" })));

  // Glows: floodlight heads, and one per ball (fire).
  const warmGlow = glowTexture("rgba(255,236,200,0.95)", "rgba(255,236,200,0)");
  for (const sx of [-1, 1]) {
    const s = new Sprite(new SpriteMaterial({ map: warmGlow, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    s.position.set(sx * 9.4, 7.3, PZ + 0.75);
    s.scale.set(3.2, 3.2, 1);
    scene.add(s);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The hoop (moves as one group along x)
  // ---------------------------------------------------------------------------------------------------------------
  const hoop = new Group();
  const H: BufferGeometry[] = [];
  const POLE_Z = -1.95;
  H.push(box(0.16, 3.5, 0.16, 0, 1.75, POLE_Z, "#2A2C36"));
  H.push(box(0.12, 0.12, POLE_Z * -1 + BOARD_Z - 0.02, 0, 3.32, (POLE_Z + BOARD_Z - 0.05) / 2, "#3B3E4C"));
  H.push(box(0.5, 0.5, 0.5, 0, 0.25, POLE_Z, "#2A2C36"));
  // Padding on the pole, dark, with one accent band at the top.
  H.push(box(0.26, 1.6, 0.26, 0, 0.5 + 0.8, POLE_Z, "#1C1D25"));
  H.push(box(0.27, 0.08, 0.27, 0, 2.1, POLE_Z, ACCENT));
  // Board frame and the shooter's square (bottom edge at rim height).
  const bz = BOARD_Z - 0.012;
  const by = BOARD_BOTTOM + BOARD_H / 2;
  const fw = 0.045;
  H.push(box(BOARD_W, fw, 0.04, 0, BOARD_BOTTOM + fw / 2, bz, PAPER));
  H.push(box(BOARD_W, fw, 0.04, 0, BOARD_BOTTOM + BOARD_H - fw / 2, bz, PAPER));
  H.push(box(fw, BOARD_H, 0.04, -BOARD_W / 2 + fw / 2, by, bz, PAPER));
  H.push(box(fw, BOARD_H, 0.04, BOARD_W / 2 - fw / 2, by, bz, PAPER));
  const sq = 0.035;
  H.push(box(0.59, sq, 0.02, 0, RIM_Y + sq / 2, bz + 0.012, PAPER));
  H.push(box(0.59, sq, 0.02, 0, RIM_Y + 0.45 - sq / 2, bz + 0.012, PAPER));
  H.push(box(sq, 0.45, 0.02, -0.295 + sq / 2, RIM_Y + 0.225, bz + 0.012, PAPER));
  H.push(box(sq, 0.45, 0.02, 0.295 - sq / 2, RIM_Y + 0.225, bz + 0.012, PAPER));
  // Padding along the board's bottom edge, the bracket, and the shot clock housing on top.
  H.push(box(BOARD_W + 0.04, 0.08, 0.08, 0, BOARD_BOTTOM - 0.02, bz, ACCENT));
  H.push(box(0.12, 0.05, Math.abs(BOARD_Z) - RIM_R + 0.02, 0, RIM_Y - 0.04, (BOARD_Z - RIM_R) / 2, "#C9C6BE"));
  H.push(box(0.56, 0.32, 0.16, 0, BOARD_BOTTOM + BOARD_H + 0.18, bz - 0.02, "#1A1B22"));
  const frame = new Mesh(mergeGeometries(H), new MeshLambertMaterial({ vertexColors: true }));
  hoop.add(frame);
  const glassMat = new MeshBasicMaterial({ color: "#BFD6FF", transparent: true, opacity: 0.12, depthWrite: false, side: DoubleSide });
  const glass = new Mesh(new PlaneGeometry(BOARD_W - 0.04, BOARD_H - 0.04), glassMat);
  glass.position.set(0, by, bz - 0.005);
  hoop.add(glass);
  const face = clockFace();
  const clockMesh = new Mesh(new PlaneGeometry(0.5, 0.25), new MeshBasicMaterial({ map: face.texture, fog: false }));
  clockMesh.position.set(0, BOARD_BOTTOM + BOARD_H + 0.18, bz + 0.065);
  hoop.add(clockMesh);
  // Rim: off-white iron that glows in the accent when you are hot.
  const rimMat = new MeshLambertMaterial({ color: "#EDE6DA", emissive: new Color(ACCENT), emissiveIntensity: 0 });
  const rimGeo = new TorusGeometry(RIM_R, 0.017, 8, 44);
  rimGeo.rotateX(Math.PI / 2);
  const rim = new Mesh(rimGeo, rimMat);
  rim.position.set(0, RIM_Y, 0);
  hoop.add(rim);
  const rimGlowMat = new SpriteMaterial({ map: glowTexture("rgba(255,110,180,0.9)", "rgba(236,19,128,0)"), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  const rimGlow = new Sprite(rimGlowMat);
  rimGlow.position.set(0, RIM_Y, 0);
  rimGlow.scale.set(1.4, 0.7, 1);
  hoop.add(rimGlow);
  const net = buildNet();
  net.mesh.position.set(0, RIM_Y - 0.012, 0);
  hoop.add(net.mesh);
  // The hoop's shadow on the court.
  const shadowTex = glowTexture("rgba(0,0,0,0.6)", "rgba(0,0,0,0)");
  const hoopShadow = new Mesh(new PlaneGeometry(2.2, 1.4), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  hoopShadow.rotation.x = -Math.PI / 2;
  hoopShadow.position.set(0, 0.01, -0.9);
  hoop.add(hoopShadow);
  scene.add(hoop);

  // ---------------------------------------------------------------------------------------------------------------
  // Balls (a small pool), their blob shadows and fire glows
  // ---------------------------------------------------------------------------------------------------------------
  const normalTex = ballTexture(BALL_ORANGE, "#1A120E");
  const bonusTex = ballTexture(ACCENT, PAPER, "#F3F0E8");
  normalTex.anisotropy = bonusTex.anisotropy = anisotropy;
  const ballGeo = new SphereGeometry(BALL_R, 28, 18);
  const fireGlowTex = glowTexture("rgba(255,190,90,0.95)", "rgba(255,110,40,0)");
  const balls: Array<{ mesh: Mesh; mat: MeshLambertMaterial; shadow: Mesh; glow: Sprite }> = [];
  for (let i = 0; i < BALL_POOL; i++) {
    const mat = new MeshLambertMaterial({ map: normalTex, emissive: new Color("#FF7A1F"), emissiveIntensity: 0 });
    const mesh = new Mesh(ballGeo, mat);
    mesh.visible = false;
    const shadow = new Mesh(new CircleGeometry(1, 20), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.visible = false;
    const glow = new Sprite(new SpriteMaterial({ map: fireGlowTex, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    glow.visible = false;
    scene.add(mesh, shadow, glow);
    balls.push({ mesh, mat, shadow, glow });
  }

  return {
    scene,
    hoop,
    rim,
    rimMat,
    rimGlow,
    net,
    glassMat,
    face,
    city,
    balls,
    normalTex,
    bonusTex,
    /** Board shimmer after a bank (0-1). */
    setGlass(k: number) {
      glassMat.opacity = 0.12 + k * 0.22;
    },
  };
}

export type World = ReturnType<typeof buildWorld>;

/** Renders the title/tag text for the HUD in the display face (re-exported so main doesn't import kit/fonts twice). */
export const FONTS = { display: FONT_DISPLAY, mono: FONT_MONO };
export { INK, PAPER };
