/** Sculpts a hole out of clay: rim, green, cup and flag, hazards, macaron bumpers, the mill and table props. */
import type { Rng } from "@thumbcade-games/kit/rng";
import type {
  Object3D} from "three";
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  Path,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lumpify, sharedGeo, type ClayKit } from "./clay.ts";
import { bounds, closestOnPolygon, closestOnSegment, offsetPolygon, pointInPolygon, smooth01, type V2 } from "./geom.ts";
import { blobPoints, blobRadius, CUP_R, heightAt, slopeAt, type Blob, type HoleDef } from "./holes.ts";
import { MACARON_COLORS, PAL, RIM_COLORS } from "./palette.ts";

export const TABLE_Y = -0.32;
const RIM_W = 0.32;
const RIM_TOP = 0.24;

/** Something that moves in stop-motion steps. */
export interface Puppet {
  obj: Object3D;
  kind: "sway" | "ripple" | "bob";
  seed: number;
  base: number;
}

export interface HoleView {
  group: Group;
  blades: Group | null;
  pennant: Object3D;
  bumpers: Object3D[];
  puppets: Puppet[];
  /** Points the camera keeps in frame. */
  focus: Vector3[];
  critterSpots: Array<{ x: number; z: number }>;
  dispose(): void;
}

function shadowBlob(kit: ClayKit, w: number, d: number, y: number): Mesh {
  const m = new Mesh(sharedGeo("plane", () => new PlaneGeometry(1, 1)), kit.shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  m.position.y = y;
  m.renderOrder = 1;
  return m;
}

/** Smooth-shaded copy of a non-indexed geometry with box-projected UVs (for the normal map). */
function smoothed(geo: BufferGeometry, uvScale: number): BufferGeometry {
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  const m = mergeVertices(geo, 1e-4);
  geo.dispose();
  m.computeVertexNormals();
  boxUV(m, uvScale);
  return m;
}

function boxUV(geo: BufferGeometry, k: number): void {
  const p = geo.attributes.position!;
  const n = geo.attributes.normal!;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ny = Math.abs(n.getY(i));
    const nx = Math.abs(n.getX(i));
    if (ny > 0.55) {
      uv[i * 2] = p.getX(i) * k;
      uv[i * 2 + 1] = p.getZ(i) * k;
    } else if (nx > 0.7) {
      uv[i * 2] = p.getZ(i) * k;
      uv[i * 2 + 1] = p.getY(i) * k;
    } else {
      uv[i * 2] = p.getX(i) * k;
      uv[i * 2 + 1] = p.getY(i) * k;
    }
  }
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
}

function rim(def: HoleDef, kit: ClayKit, color: string): Mesh {
  const outer = offsetPolygon(def.outline, RIM_W);
  const shape = new Shape(outer.map((p) => new Vector2(p.x, -p.z)));
  shape.holes.push(new Path(def.outline.map((p) => new Vector2(p.x, -p.z))));
  const bevel = 0.085;
  const depth = RIM_TOP - TABLE_Y - bevel;
  let geo: BufferGeometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 1, steps: 1 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, TABLE_Y, 0);
  geo = smoothed(geo, 0.9);
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > TABLE_Y + 0.3) p.setY(i, y + heightAt(def, p.getX(i), p.getZ(i)));
  }
  geo.computeVertexNormals();
  lumpify(geo, 0.018, 2.4, def.outline.length);
  const m = new Mesh(geo, kit.clay(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function floor(def: HoleDef, kit: ClayKit): Mesh {
  const b = bounds(def.outline);
  const cell = 0.12;
  const x0 = b.minX - 0.1;
  const z0 = b.minZ - 0.1;
  const nx = Math.ceil((b.maxX - b.minX + 0.2) / cell) + 1;
  const nz = Math.ceil((b.maxZ - b.minZ + 0.2) / cell) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const inside = new Uint8Array(nx * nz);
  const tmp: V2 = { x: 0, z: 0 };
  // Every hole is pressed from a different part of the slab.
  const uvOff = (def.outline.length * 0.137 + def.cup.x * 0.31) % 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      let x = x0 + i * cell;
      let z = z0 + j * cell;
      const inPoly = pointInPolygon(def.outline, x, z);
      const edge = closestOnPolygon(def.outline, x, z);
      let ao: number;
      if (inPoly) {
        inside[k] = 1;
        ao = 0.66 + 0.34 * smooth01(edge.d / 0.42);
      } else {
        // Tuck the ragged grid edge under the rim.
        const l = edge.d || 1;
        x = edge.x + ((x - edge.x) / l) * 0.06;
        z = edge.z + ((z - edge.z) / l) * 0.06;
        ao = 0.66;
      }
      for (const w of def.walls) {
        const d = Math.sqrt(closestOnSegment(w.ax, w.az, w.bx, w.bz, x, z, tmp)) - w.r;
        ao = Math.min(ao, 0.68 + 0.32 * smooth01(d / 0.32));
      }
      for (const p of def.bumpers) ao = Math.min(ao, 0.7 + 0.3 * smooth01((Math.hypot(x - p.x, z - p.z) - p.r) / 0.26));
      const y = heightAt(def, x, z);
      slopeAt(def, x, z, tmp);
      // Hand-lit slopes: faces tipped toward the warm key (front-left) brighten, the rest fall into shade.
      const lit = (-tmp.x * -0.55 + -tmp.z * 0.45) * 1.4;
      ao *= 1 + Math.max(-0.12, Math.min(0.12, y * 0.35)) + Math.max(-0.22, Math.min(0.16, lit)) - Math.min(0.12, Math.hypot(tmp.x, tmp.z) * 0.25);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
      uv[k * 2] = x * 0.32 + uvOff;
      uv[k * 2 + 1] = z * 0.32 + uvOff * 0.7;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b2 = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (inside[a] || inside[b2] || inside[c]) idx.push(a, c, b2);
      if (inside[b2] || inside[c] || inside[d]) idx.push(b2, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.setAttribute("uv", new BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new Mesh(geo, greenMat(kit));
  m.receiveShadow = true;
  return m;
}

/** A blob-shaped patch that follows the green (sand, water). */
function patch(def: HoleDef, blob: Blob, lift: number, dome: number): BufferGeometry {
  const rings = 6;
  const n = blob.radii.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  pos.push(blob.x, heightAt(def, blob.x, blob.z) + lift + dome, blob.z);
  uv.push(blob.x * 0.5, blob.z * 0.5);
  for (let r = 1; r <= rings; r++) {
    const f = r / rings;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = blobRadius(blob, a) * f;
      const x = blob.x + Math.cos(a) * rad;
      const z = blob.z + Math.sin(a) * rad;
      pos.push(x, heightAt(def, x, z) + lift + dome * (1 - f * f), z);
      uv.push(x * 0.5, z * 0.5);
    }
  }
  for (let i = 0; i < n; i++) idx.push(0, 1 + ((i + 1) % n), 1 + i);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * n;
    const b0 = 1 + r * n;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function lip(def: HoleDef, blob: Blob, radius: number, lift: number): TubeGeometry {
  const pts = blobPoints(blob, 1).map((p) => new Vector3(p.x, heightAt(def, p.x, p.z) + lift, p.z));
  return new TubeGeometry(new CatmullRomCurve3(pts, true, "centripetal"), 72, radius, 6, true);
}

function macaron(kit: ClayKit, r: number, color: string, seed: number): Group {
  const g = new Group();
  const shell = sharedGeo(`shell${Math.round(seed) % 3}`, () => lumpify(new SphereGeometry(1, 28, 12), 0.05, 2.6, seed));
  const bottom = new Mesh(shell, kit.clay(color));
  bottom.scale.set(r, 0.085, r);
  bottom.position.y = 0.075;
  const feet = new Mesh(sharedGeo("feet", () => lumpify(new TorusGeometry(1, 0.11, 8, 28), 0.04, 9, 2)), kit.clay(color));
  feet.scale.set(r * 0.9, r * 0.9, 0.3);
  feet.rotation.x = -Math.PI / 2;
  feet.position.y = 0.13;
  const fill = new Mesh(shell, kit.clay(PAL.cream));
  fill.scale.set(r * 0.88, 0.045, r * 0.88);
  fill.position.y = 0.17;
  const top = new Mesh(shell, kit.clay(color));
  top.scale.set(r * 0.98, 0.1, r * 0.98);
  top.position.y = 0.215;
  top.rotation.y = seed;
  for (const m of [bottom, feet, fill, top]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  g.add(shadowBlob(kit, r * 2.9, r * 2.9, 0.012));
  return g;
}

function windmill(def: HoleDef, kit: ClayKit, g: Group): Group {
  const w = def.windmill!;
  const house = new Group();
  house.position.set(w.x, heightAt(def, w.x, w.z), w.z);
  const body = kit.clay(PAL.lavender);
  const deep = kit.clay(PAL.lavenderDeep);
  const half = Math.abs(def.outline.reduce((m, p) => Math.max(m, Math.abs(p.x)), 0)) + 0.2;
  // Garden walls out to the rim.
  for (const s of [-1, 1]) {
    const len = half - (w.gap + 0.7);
    const wall = new Mesh(lumpify(new RoundedBoxGeometry(len + 0.2, 0.4, 0.4, 3, 0.14), 0.012, 3, s + 4), deep);
    wall.position.set(s * (w.gap + 0.7 + len / 2), 0.13, 0);
    wall.castShadow = wall.receiveShadow = true;
    house.add(wall);
    const pillar = new Mesh(lumpify(new RoundedBoxGeometry(0.5, 1.1, 0.62, 3, 0.15), 0.02, 2.5, s + 7), body);
    pillar.position.set(s * (w.gap + 0.24), 0.45, -0.05);
    pillar.castShadow = pillar.receiveShadow = true;
    house.add(pillar);
  }
  const lintel = new Mesh(lumpify(new RoundedBoxGeometry(w.gap * 2 + 0.3, 0.6, 0.62, 3, 0.15), 0.015, 3, 9), body);
  lintel.position.set(0, 0.72, -0.05);
  // A round window over the door.
  const win = new Mesh(new TorusGeometry(0.11, 0.035, 8, 20), kit.clay(PAL.cream));
  win.position.set(0, 0.78, 0.27);
  const pane = new Mesh(new CircleGeometry(0.1, 20), kit.clay(PAL.powderDeep));
  pane.position.set(0, 0.78, 0.262);
  house.add(win, pane);
  lintel.castShadow = lintel.receiveShadow = true;
  house.add(lintel);
  const tunnel = new Mesh(new RoundedBoxGeometry(w.gap * 2 + 0.06, 0.5, 0.58, 2, 0.08), kit.clay(PAL.chocDeep));
  tunnel.position.set(0, 0.16, -0.05);
  house.add(tunnel);
  // A round clay roof.
  const prof: Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push(new Vector2(Math.max(0.001, 0.64 * (1 - t) ** 1.1 + 0.05 * Math.sin(t * Math.PI)), t * 0.82));
  }
  const roof = new Mesh(lumpify(new LatheGeometry(prof, 28), 0.022, 3, 3), kit.clay(PAL.salmon));
  roof.position.set(0, 0.98, -0.12);
  roof.castShadow = true;
  house.add(roof);
  const knob = new Mesh(lumpify(new SphereGeometry(0.08, 14, 10), 0.01, 8, 2), kit.clay(PAL.butter));
  knob.position.set(0, 1.82, -0.12);
  house.add(knob);
  // Blades.
  const blades = new Group();
  // Leaned back a little so the camera sees the sails, not their edges.
  const tilt = new Group();
  tilt.position.set(0, 1.0, 0.36);
  tilt.rotation.x = -0.25;
  const paddle = lumpify(new RoundedBoxGeometry(0.26, 0.74, 0.05, 2, 0.024), 0.008, 6, 5);
  const stripe = new RoundedBoxGeometry(0.08, 0.62, 0.06, 2, 0.02);
  for (let i = 0; i < 4; i++) {
    const arm = new Group();
    arm.rotation.z = (i * Math.PI) / 2;
    const p = new Mesh(paddle, kit.clay(PAL.cream));
    p.position.y = -0.5;
    p.castShadow = true;
    const st = new Mesh(stripe, kit.clay(i % 2 ? PAL.butter : PAL.salmon));
    st.position.set(0, -0.51, 0.008);
    arm.add(p, st);
    blades.add(arm);
  }
  const hub = new Mesh(lumpify(new SphereGeometry(0.1, 16, 12), 0.012, 9, 1), kit.clay(PAL.choc));
  hub.position.z = 0.04;
  blades.add(hub);
  tilt.add(blades);
  house.add(tilt);
  house.add(shadowBlob(kit, 2.2, 1.3, 0.012));
  g.add(house);
  return blades;
}

/** A ">" pressed into the green, pointing along `ang` (radians in the course plane). */
function chevron(def: HoleDef, kit: ClayKit, x: number, z: number, ang: number): Group[] {
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const tx = x + dx * 0.08;
  const tz = z + dz * 0.08;
  return [-1, 1].map((side) => {
    const a = ang + Math.PI + side * 0.7;
    const bx = Math.cos(a);
    const bz = Math.sin(a);
    const cx = tx + bx * 0.095;
    const cz = tz + bz * 0.095;
    const arm = new Group();
    const cap = new Mesh(sharedGeo("chev", () => new CapsuleGeometry(0.035, 0.2, 3, 8)), kit.clay(PAL.cream));
    cap.rotation.z = Math.PI / 2;
    arm.add(cap);
    arm.rotation.y = -a;
    arm.scale.set(1, 0.4, 1);
    arm.position.set(cx, heightAt(def, cx, cz) + 0.004, cz);
    return arm;
  });
}

function tree(kit: ClayKit, rng: Rng): Group {
  const g = new Group();
  const h = rng.range(0.55, 0.95);
  const trunk = new Mesh(sharedGeo("trunk", () => new CapsuleGeometry(0.05, 1, 4, 8)), kit.clay(PAL.choc));
  trunk.scale.y = (h + 0.1) / 1.1;
  trunk.position.y = h / 2;
  const v = rng.int(0, 3);
  const top = new Mesh(sharedGeo(`lump${v}`, () => lumpify(new SphereGeometry(1, 18, 14), 0.1, 4, v * 2.3)), kit.clay(rng.pick([PAL.sageDeep, PAL.sage, PAL.salmon, PAL.lavender, PAL.butter])));
  const tr = rng.range(0.3, 0.42);
  top.position.y = h + 0.2;
  top.scale.set(tr, tr * 0.9, tr);
  trunk.castShadow = top.castShadow = true;
  g.add(trunk, top, shadowBlob(kit, 0.9, 0.9, 0.01));
  return g;
}

function bush(kit: ClayKit, rng: Rng): Group {
  const g = new Group();
  const c = rng.pick([PAL.sageDeep, PAL.sage]);
  for (let i = 0; i < 3; i++) {
    const v = rng.int(0, 3);
    const s = new Mesh(sharedGeo(`lump${v}`, () => lumpify(new SphereGeometry(1, 18, 14), 0.1, 4, v * 2.3)), kit.clay(c));
    const r = rng.range(0.14, 0.22);
    s.position.set(rng.range(-0.15, 0.15), 0.1, rng.range(-0.12, 0.12));
    s.scale.set(r, r * 0.85, r);
    s.castShadow = true;
    g.add(s);
  }
  g.add(shadowBlob(kit, 0.8, 0.7, 0.01));
  return g;
}

function flower(kit: ClayKit, rng: Rng): Group {
  const g = new Group();
  const h = rng.range(0.22, 0.36);
  const stem = new Mesh(sharedGeo("stem", () => new CapsuleGeometry(0.018, 1, 3, 6)), kit.clay(PAL.sageDeep));
  stem.scale.y = (h + 0.036) / 1.036;
  stem.position.y = h / 2;
  g.add(stem);
  const head = new Group();
  head.position.y = h + 0.02;
  const petal = kit.clay(rng.pick([PAL.pink, PAL.salmon, PAL.lavender, PAL.powder]));
  const pg = sharedGeo("petal", () => new SphereGeometry(0.05, 10, 8));
  for (let i = 0; i < 5; i++) {
    const p = new Mesh(pg, petal);
    const a = (i / 5) * Math.PI * 2;
    p.position.set(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06);
    p.scale.y = 0.5;
    head.add(p);
  }
  const mid = new Mesh(pg, kit.clay(PAL.butter));
  mid.scale.set(0.8, 0.6, 0.8);
  mid.position.y = 0.01;
  head.add(mid);
  head.rotation.x = 0.5;
  g.add(head, shadowBlob(kit, 0.32, 0.32, 0.01));
  return g;
}

function mushroom(kit: ClayKit, rng: Rng): Group {
  const g = new Group();
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.12, 0.24);
    const stem = new Mesh(sharedGeo("trunk", () => new CapsuleGeometry(0.05, 1, 4, 8)), kit.clay(PAL.cream));
    stem.scale.set(0.8, (h + 0.1) / 1.1, 0.8);
    const ox = i ? rng.range(-0.16, 0.16) : 0;
    const oz = i ? rng.range(-0.16, 0.16) : 0;
    stem.position.set(ox, h / 2, oz);
    const v = rng.int(0, 3);
    const cap = new Mesh(sharedGeo(`lump${v}`, () => lumpify(new SphereGeometry(1, 18, 14), 0.1, 4, v * 2.3)), kit.clay(rng.pick([PAL.salmon, PAL.salmonDeep, PAL.butterDeep])));
    const cr = rng.range(0.1, 0.15) * (i ? 0.75 : 1);
    cap.scale.set(cr, cr * 0.55, cr);
    cap.position.set(ox, h + 0.02, oz);
    stem.castShadow = cap.castShadow = true;
    g.add(stem, cap);
    const dot = new Mesh(sharedGeo("petal", () => new SphereGeometry(0.05, 10, 8)), kit.clay(PAL.cream));
    dot.scale.set(0.5, 0.3, 0.5);
    dot.position.set(ox + cr * 0.4, h + 0.02 + cr * 0.45, oz);
    g.add(dot);
  }
  g.add(shadowBlob(kit, 0.5, 0.5, 0.008));
  return g;
}

function pebble(kit: ClayKit, rng: Rng): Group {
  const g = new Group();
  const v = rng.int(0, 3);
  const p = new Mesh(sharedGeo(`lump${v}`, () => lumpify(new SphereGeometry(1, 18, 14), 0.1, 4, v * 2.3)), kit.clay(rng.pick([PAL.creamDeep, PAL.feltDeep, PAL.powder])));
  const pr = rng.range(0.08, 0.14);
  p.scale.set(pr, pr * 0.55, pr * 1.1);
  p.position.y = 0.03;
  p.castShadow = true;
  g.add(p, shadowBlob(kit, 0.36, 0.3, 0.008));
  return g;
}

export function buildHoleView(def: HoleDef, kit: ClayKit, rng: Rng, holeIndex: number, colorIndex = holeIndex): HoleView {
  const g = new Group();
  const puppets: Puppet[] = [];
  const rimColor = RIM_COLORS[colorIndex % RIM_COLORS.length]!;
  g.add(rim(def, kit, rimColor));
  g.add(floor(def, kit));
  // The course's own shadow on the felt.
  const ob = bounds(def.outline);
  const cs = shadowBlob(kit, ob.maxX - ob.minX + 1.6, ob.maxZ - ob.minZ + 1.6, TABLE_Y + 0.004);
  cs.position.set((ob.minX + ob.maxX) / 2 + 0.12, TABLE_Y + 0.004, (ob.minZ + ob.maxZ) / 2 + 0.1);
  g.add(cs);

  // Cup and flag.
  const cy = heightAt(def, def.cup.x, def.cup.z);
  const cup = new Mesh(new CircleGeometry(CUP_R, 36), new MeshBasicMaterial({ map: kit.cupTex }));
  cup.rotation.x = -Math.PI / 2;
  cup.position.set(def.cup.x, cy + 0.006, def.cup.z);
  g.add(cup);
  const ring = new Mesh(lumpify(new TorusGeometry(CUP_R + 0.012, 0.026, 8, 36), 0.006, 12, 3), kit.clay(PAL.cream));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(def.cup.x, cy + 0.01, def.cup.z);
  ring.receiveShadow = true;
  g.add(ring);
  const flag = new Group();
  flag.position.set(def.cup.x, cy, def.cup.z);
  const pole = new Mesh(new CylinderGeometry(0.028, 0.028, 1.36, 8), kit.clay(PAL.choc));
  pole.position.y = 0.58;
  pole.castShadow = true;
  const knob = new Mesh(new SphereGeometry(0.065, 12, 8), kit.clay(PAL.butter));
  knob.position.y = 1.27;
  const pennant = new Group();
  pennant.position.y = 1.22;
  const tri = new Shape([new Vector2(0, 0), new Vector2(0.62, -0.15), new Vector2(0, -0.34)]);
  const pg = new ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 2 });
  pg.translate(0.01, 0, -0.01);
  const pm = new Mesh(pg, kit.clay(PAL.salmon));
  pm.castShadow = true;
  const dot = new Mesh(new SphereGeometry(0.035, 10, 8), kit.clay(PAL.cream));
  dot.scale.z = 0.5;
  dot.position.set(0.18, -0.15, 0.022);
  dot.scale.set(1.3, 1.3, 0.5);
  pennant.add(pm, dot);
  flag.add(pole, knob, pennant);
  g.add(flag);

  // Tee mat.
  const ty = heightAt(def, def.tee.x, def.tee.z);
  const tee = new Mesh(sharedGeo("tee", () => lumpify(new SphereGeometry(1, 28, 10), 0.06, 3, 7)), kit.clay(PAL.lavender));
  tee.scale.set(0.34, 0.03, 0.28);
  tee.position.set(def.tee.x, ty + 0.004, def.tee.z);
  tee.receiveShadow = true;
  const teeDot = new Mesh(sharedGeo("teedot", () => new SphereGeometry(1, 14, 8)), kit.clay(PAL.lavenderDeep));
  teeDot.scale.set(0.06, 0.02, 0.06);
  teeDot.position.set(def.tee.x, ty + 0.03, def.tee.z);
  g.add(tee, teeDot);

  for (const s of def.sand) {
    const m = new Mesh(patch(def, s, 0.014, 0.012), sandMat(kit));
    m.receiveShadow = true;
    g.add(m);
    const l = new Mesh(lip(def, s, 0.032, 0.016), kit.clay(PAL.butterDeep));
    l.receiveShadow = true;
    g.add(l);
  }
  for (const wt of def.water) {
    const m = new Mesh(patch(def, wt, 0.012, -0.004), waterMat(kit));
    m.receiveShadow = true;
    g.add(m);
    const l = new Mesh(lip(def, wt, 0.045, 0.02), kit.clay(PAL.powderDeep));
    l.castShadow = l.receiveShadow = true;
    g.add(l);
    for (let i = 0; i < 3; i++) {
      const rp = new Group();
      const r = new Mesh(new TorusGeometry(1, 0.025, 4, 36), kit.clay(PAL.cream));
      r.rotation.x = -Math.PI / 2;
      rp.add(r);
      const a = rng() * 6.28;
      const d = rng.range(0.1, 0.45) * blobRadius(wt, a);
      const x = wt.x + Math.cos(a) * d;
      const z = wt.z + Math.sin(a) * d;
      rp.position.set(x, heightAt(def, x, z) + 0.02, z);
      g.add(rp);
      puppets.push({ obj: rp, kind: "ripple", seed: i / 3 + rng() * 0.1, base: rng.range(0.22, 0.34) });
    }
  }

  const bumpers: Object3D[] = [];
  def.bumpers.forEach((b, i) => {
    const m = macaron(kit, b.r, MACARON_COLORS[(i + holeIndex) % MACARON_COLORS.length]!, i * 3.1 + holeIndex);
    m.position.set(b.x, heightAt(def, b.x, b.z), b.z);
    g.add(m);
    bumpers.push(m);
  });

  for (const w of def.walls) {
    if (def.windmill && Math.abs(w.az - def.windmill.z) < 0.01) continue;
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
    const m = new Mesh(lumpify(new RoundedBoxGeometry(len + w.r * 2, 0.3, w.r * 2, 3, Math.min(w.r * 0.95, 0.12)), 0.012, 3, len), kit.clay(rimColor));
    const mx = (w.ax + w.bx) / 2;
    const mz = (w.az + w.bz) / 2;
    m.position.set(mx, heightAt(def, mx, mz) + 0.1, mz);
    m.rotation.y = -Math.atan2(w.bz - w.az, w.bx - w.ax);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  const blades = def.windmill ? windmill(def, kit, g) : null;

  // Pressed chevrons: downhill on a leaning green, uphill on a ramp.
  const clearOf = (x: number, z: number) =>
    def.bumpers.every((b) => Math.hypot(b.x - x, b.z - z) > b.r + 0.35) && Math.hypot(def.cup.x - x, def.cup.z - z) > 0.5 && Math.hypot(def.tee.x - x, def.tee.z - z) > 0.5;
  if (def.tilt.gx !== 0) {
    const ang = def.tilt.gx > 0 ? Math.PI : 0;
    for (const z of [2.4, 0.2, -2.0]) if (clearOf(0, z)) for (const m of chevron(def, kit, 0, z, ang)) g.add(m);
  }
  for (const r of def.ramps) {
    const ang = Math.atan2(r.z1 - r.z0, r.x1 - r.x0);
    const mx = (r.x0 + r.x1) / 2;
    const mz = (r.z0 + r.z1) / 2;
    for (const off of [-0.75, 0, 0.75]) {
      const x = mx + Math.sin(ang) * off;
      const z = mz - Math.cos(ang) * off;
      if (clearOf(x, z)) for (const m of chevron(def, kit, x, z, ang)) g.add(m);
    }
  }
  // A pale ring of pressed clay marks the top of a mound.
  for (const b of def.bumps) {
    if (b.a < 0.2) continue;
    const ring = new Mesh(sharedGeo("moundring", () => new TorusGeometry(1, 0.035, 6, 40)), kit.clay(PAL.sageDeep));
    ring.rotation.x = -Math.PI / 2;
    const rr = b.s * 0.85;
    ring.scale.set(rr, rr, 0.5);
    ring.position.set(b.x, heightAt(def, b.x + rr, b.z) + 0.004, b.z);
    g.add(ring);
  }

  // Critter spots: hug the rim from outside, spread out.
  const ring2 = offsetPolygon(def.outline, 0.8);
  const cands: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < ring2.length; i++) {
    const a = ring2[i]!;
    const b = ring2[(i + 1) % ring2.length]!;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3);
    for (let k = 0; k < n; k++) cands.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const okSpot = (p: { x: number; z: number }) => !pointInPolygon(offsetPolygon(def.outline, 0.7), p.x, p.z) && p.z > ob.minZ - 0.5 && p.z < ob.maxZ - 0.6;
  const spots: Array<{ x: number; z: number }> = [];
  const pool = cands.filter(okSpot);
  const want = [
    { x: ob.minX - 1, z: (ob.minZ + ob.maxZ) / 2 + rng.range(-1.5, 1.5) },
    { x: ob.maxX + 1, z: ob.minZ + rng.range(0.6, 2.5) },
    { x: ob.maxX + 1, z: ob.maxZ - rng.range(1.0, 2.0) },
  ];
  if (rng.chance(0.5)) for (const w of want) w.x = -w.x;
  for (const w of want) {
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const c of pool) {
      const d = Math.hypot(c.x - w.x, c.z - w.z);
      if (d < bd && spots.every((s) => Math.hypot(s.x - c.x, s.z - c.z) > 1.4)) {
        bd = d;
        best = c;
      }
    }
    if (best) spots.push(best);
  }

  // Props on the table.
  const keepOut = offsetPolygon(def.outline, 1.0);
  const placed: V2[] = spots.map((s) => ({ x: s.x, z: s.z }));
  let tries = 0;
  let count = 0;
  while (count < 34 && tries++ < 600) {
    const x = rng.range(ob.minX - 3.2, ob.maxX + 3.2);
    const z = rng.range(ob.minZ - 3.6, ob.maxZ + 1.4);
    if (pointInPolygon(keepOut, x, z) || closestOnPolygon(keepOut, x, z).d < 0.15) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 0.62)) continue;
    placed.push({ x, z });
    const r = rng();
    const near = closestOnPolygon(def.outline, x, z).d;
    const prop = r < 0.28 && near > 1.1 ? tree(kit, rng) : r < 0.5 ? bush(kit, rng) : r < 0.68 ? flower(kit, rng) : r < 0.84 ? mushroom(kit, rng) : pebble(kit, rng);
    prop.position.set(x, TABLE_Y, z);
    prop.rotation.y = rng.range(0, 6.28);
    g.add(prop);
    if (r < 0.84) puppets.push({ obj: prop, kind: "sway", seed: rng() * 100, base: prop.rotation.y });
    count++;
  }

  const outer = offsetPolygon(def.outline, RIM_W);
  const focus: Vector3[] = [];
  for (const p of outer) focus.push(new Vector3(p.x, RIM_TOP + heightAt(def, p.x, p.z), p.z), new Vector3(p.x, TABLE_Y, p.z));
  focus.push(new Vector3(def.cup.x, cy + 1.3, def.cup.z));
  if (def.windmill) focus.push(new Vector3(def.windmill.x, 1.75, def.windmill.z));

  return {
    group: g,
    blades,
    pennant,
    bumpers,
    puppets,
    focus,
    critterSpots: spots,
    dispose() {
      g.traverse((o) => {
        if (o instanceof Mesh) {
          if (!o.geometry.userData.shared) o.geometry.dispose();
          const m = o.material as Material;
          if (m instanceof MeshBasicMaterial && m.map === kit.cupTex) m.dispose();
        }
      });
    },
  };
}

let greenM: Material | null = null;
function greenMat(kit: ClayKit): Material {
  if (!greenM) {
    const m = kit.clay(PAL.sage, "vertex").clone();
    m.normalMap = kit.stipple;
    m.normalScale.set(0.7, 0.7);
    greenM = m;
  }
  return greenM;
}
let sandM: Material | null = null;
let waterM: Material | null = null;
function sandMat(kit: ClayKit): Material {
  if (!sandM) {
    const m = kit.clay(PAL.sand).clone();
    m.map = kit.sand;
    m.roughness = 0.95;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    sandM = m;
  }
  return sandM;
}
function waterMat(kit: ClayKit): Material {
  if (!waterM) {
    const m = kit.clay(PAL.powder).clone();
    m.map = kit.water;
    m.roughness = 0.42;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    waterM = m;
  }
  return waterM;
}
