/**
 * Plasticine: procedural thumbprint normal maps, felt and sand textures, matte clay materials and lumpy,
 * hand-squished geometry. Everything is generated at startup; nothing is loaded.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import type {
  BufferGeometry} from "three";
import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  type Texture,
} from "three";

// ---------------------------------------------------------------------------
// Height fields -> normal maps
// ---------------------------------------------------------------------------

/** Tileable value noise added into `h` (size must be a multiple of `period`). */
function addNoise(h: Float32Array, size: number, period: number, amp: number, rng: Rng): void {
  const cells = size / period;
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng() * 2 - 1;
  for (let y = 0; y < size; y++) {
    const gy = y / period;
    const y0 = Math.floor(gy);
    const ty = gy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cells) * cells;
    const r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const gx = x / period;
      const x0 = Math.floor(gx);
      const tx = gx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cells;
      const c1 = (x0 + 1) % cells;
      const a = grid[r0 + c0]! + (grid[r0 + c1]! - grid[r0 + c0]!) * sx;
      const b = grid[r1 + c0]! + (grid[r1 + c1]! - grid[r1 + c0]!) * sx;
      h[y * size + x]! += (a + (b - a) * sy) * amp;
    }
  }
}

/** A thumb pressed into clay: a shallow dent with whorled ridges, wrapped around the tile edges. */
function addThumbprint(h: Float32Array, size: number, rng: Rng, radius: number, depth: number): void {
  const cx = rng() * size;
  const cy = rng() * size;
  const rot = rng() * Math.PI;
  const squash = 0.62 + rng() * 0.2;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const ridge = (Math.PI * 2) / (radius * (0.075 + rng() * 0.02));
  const twist = rng() * 6.28;
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const u = (dx * cos + dy * sin) / squash;
      const v = -dx * sin + dy * cos;
      const e = Math.hypot(u, v);
      if (e >= radius) continue;
      const k = 1 - (e / radius) ** 2;
      const fall = k * k;
      const ang = Math.atan2(v, u);
      const rid = Math.sin(e * ridge + 1.3 * Math.sin(ang * 2 + twist) + 0.6 * Math.sin(ang * 3));
      const x = (((Math.round(cx) + dx) % size) + size) % size;
      const y = (((Math.round(cy) + dy) % size) + size) % size;
      h[y * size + x]! += fall * (0.32 * rid * Math.min(1, (1 - e / radius) * 3) - depth);
    }
  }
}

function addPock(h: Float32Array, size: number, rng: Rng, radius: number, depth: number): void {
  const cx = Math.round(rng() * size);
  const cy = Math.round(rng() * size);
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / radius;
      if (d >= 1) continue;
      const k = 1 - d * d;
      const x = (((cx + dx) % size) + size) % size;
      const y = (((cy + dy) % size) + size) % size;
      h[y * size + x]! -= depth * k * k;
    }
  }
}

function normalTexture(h: Float32Array, size: number, strength: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const sx = (h[y * size + xp]! - h[y * size + xm]!) * strength;
      const sy = (h[yp + x]! - h[ym + x]!) * strength;
      const inv = 1 / Math.hypot(sx, sy, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round((-sx * inv * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((sy * inv * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

export interface ClayKit {
  /** Fingerprints, dents and lumps: the normal map on every clay surface. */
  thumb: Texture;
  /** The green: clay poked all over with a toothpick, plus a few thumbprints. */
  stipple: Texture;
  felt: Texture;
  feltNormal: Texture;
  sand: Texture;
  water: Texture;
  /** A soft dark blob for contact shadows (alpha in the map). */
  blob: Texture;
  cupTex: Texture;
  /** A matte clay material (cached per color/variant). */
  clay(color: string, variant?: "matte" | "glossy" | "vertex"): MeshStandardMaterial;
  shadowMat: MeshBasicMaterial;
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function createClayKit(rng: Rng): ClayKit {
  // Clay: soft lumps, a few big thumbprints and plenty of little dents.
  const S = 256;
  const hClay = new Float32Array(S * S);
  addNoise(hClay, S, 32, 0.9, rng);
  addNoise(hClay, S, 16, 0.4, rng);
  addNoise(hClay, S, 8, 0.12, rng);
  for (let i = 0; i < 4; i++) addThumbprint(hClay, S, rng, 34 + rng() * 22, 0.55 + rng() * 0.4);
  for (let i = 0; i < 46; i++) addPock(hClay, S, rng, 2 + rng() * 6, 0.25 + rng() * 0.6);
  const thumb = normalTexture(hClay, S, 1.6);

  const G2 = 512;
  const hGreen = new Float32Array(G2 * G2);
  addNoise(hGreen, G2, 64, 0.9, rng);
  addNoise(hGreen, G2, 16, 0.12, rng);
  for (let i = 0; i < 7; i++) addThumbprint(hGreen, G2, rng, 44 + rng() * 26, 0.45 + rng() * 0.3);
  for (let i = 0; i < 2200; i++) addPock(hGreen, G2, rng, 1.6 + rng() * 1.8, 0.3 + rng() * 0.35);
  const stipple = normalTexture(hGreen, G2, 1.5);

  // Felt: fine fuzz.
  const F = 128;
  const hFelt = new Float32Array(F * F);
  addNoise(hFelt, F, 4, 0.5, rng);
  addNoise(hFelt, F, 2, 0.35, rng);
  addNoise(hFelt, F, 16, 0.6, rng);
  const feltNormal = normalTexture(hFelt, F, 0.55);
  const felt = canvasTex(128, (g, s) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const a = rng() * Math.PI;
      const l = 2 + rng() * 5;
      g.strokeStyle = rng() < 0.5 ? "rgba(150,110,80,0.06)" : "rgba(255,255,255,0.35)";
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  });

  const sand = canvasTex(128, (g, s) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const r = 0.5 + rng() * 1.3;
      g.fillStyle = rng() < 0.55 ? `rgba(160,110,50,${0.12 + rng() * 0.2})` : `rgba(255,250,235,${0.4 + rng() * 0.4})`;
      g.beginPath();
      g.arc(rng() * s, rng() * s, r, 0, Math.PI * 2);
      g.fill();
    }
  });

  // Water is clay too: smeared pale swirls on blue.
  const water = canvasTex(256, (g, s) => {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, s, s);
    g.lineCap = "round";
    for (let i = 0; i < 22; i++) {
      const x = rng() * s;
      const y = rng() * s;
      const w = 20 + rng() * 50;
      g.strokeStyle = rng() < 0.6 ? "rgba(255,255,255,0.75)" : "rgba(90,130,190,0.18)";
      g.lineWidth = 3 + rng() * 4;
      for (const ox of [-s, 0, s]) {
        for (const oy of [-s, 0, s]) {
          g.beginPath();
          g.moveTo(x + ox - w / 2, y + oy);
          g.quadraticCurveTo(x + ox, y + oy - 6 - rng() * 4, x + ox + w / 2, y + oy);
          g.stroke();
        }
      }
    }
  });

  const blob = canvasTex(
    64,
    (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.45, "rgba(255,255,255,0.55)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
    },
    false,
  );
  blob.wrapS = blob.wrapT = 1001; // ClampToEdgeWrapping

  // The cup, seen from above: a dark well with light catching its far inner wall.
  const cupTex = canvasTex(128, (g, s) => {
    const c = s / 2;
    const gr = g.createRadialGradient(c, c * 1.12, s * 0.05, c, c, c);
    gr.addColorStop(0, "#1E120D");
    gr.addColorStop(0.65, "#2E1C14");
    gr.addColorStop(1, "#4C2E22");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(120,80,60,0.75)";
    g.beginPath();
    g.ellipse(c, c * 0.58, c * 0.78, c * 0.36, 0, Math.PI, Math.PI * 2);
    g.ellipse(c, c * 0.62, c * 0.7, c * 0.22, 0, Math.PI * 2, Math.PI, true);
    g.fill();
  });
  cupTex.wrapS = cupTex.wrapT = 1001;

  const cache = new Map<string, MeshStandardMaterial>();
  const normalScale = new Vector2(0.55, 0.55);
  const kit: ClayKit = {
    thumb,
    stipple,
    felt,
    feltNormal,
    sand,
    water,
    blob,
    cupTex,
    clay(color, variant = "matte") {
      const key = `${color}|${variant}`;
      let m = cache.get(key);
      if (!m) {
        m = new MeshStandardMaterial({
          color: new Color(color),
          roughness: variant === "glossy" ? 0.5 : 0.8,
          metalness: 0,
          normalMap: thumb,
          normalScale,
          vertexColors: variant === "vertex",
        });
        cache.set(key, m);
      }
      return m;
    },
    shadowMat: new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, color: new Color("#5A3424"), opacity: 0.38 }),
  };
  return kit;
}

// ---------------------------------------------------------------------------
// Lumpy geometry
// ---------------------------------------------------------------------------

/** Pushes vertices along their normals by smooth noise so a primitive looks hand-rolled. */
export function lumpify<T extends BufferGeometry>(geo: T, amount: number, freq = 3, seed = 0): T {
  const pos = geo.attributes.position!;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nor = geo.attributes.normal!;
  const s1 = seed * 1.7 + 0.3;
  const s2 = seed * 2.3 + 1.1;
  const s3 = seed * 0.9 + 2.7;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n =
      Math.sin(x * freq + s1) * Math.sin(y * freq * 1.3 + s2) * 0.5 +
      Math.sin(z * freq * 1.1 + s3) * Math.sin(x * freq * 0.7 + s1 * 2) * 0.35 +
      Math.sin((x + y + z) * freq * 2.1 + s2) * 0.15;
    pos.setXYZ(i, x + nor.getX(i) * n * amount, y + nor.getY(i) * n * amount, z + nor.getZ(i) * n * amount);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  smoothSeams(geo);
  return geo;
}

/** Averages normals of vertices that share a position (UV seams), so lumps never show a crease. */
export function smoothSeams(geo: BufferGeometry): void {
  const pos = geo.attributes.position!;
  const nor = geo.attributes.normal!;
  const acc = new Map<string, [number, number, number, number[]]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = [0, 0, 0, []]));
    a[0] += nor.getX(i);
    a[1] += nor.getY(i);
    a[2] += nor.getZ(i);
    a[3].push(i);
  }
  for (const [x, y, z, ids] of acc.values()) {
    if (ids.length < 2) continue;
    const l = Math.hypot(x, y, z) || 1;
    for (const i of ids) nor.setXYZ(i, x / l, y / l, z / l);
  }
  nor.needsUpdate = true;
}

const shared = new Map<string, BufferGeometry>();

/** A geometry built once and reused by every hole (never disposed with a hole). */
export function sharedGeo<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = shared.get(key) as T | undefined;
  if (!g) {
    g = make();
    g.userData.shared = true;
    shared.set(key, g);
  }
  return g;
}
