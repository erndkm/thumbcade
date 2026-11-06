import {
  BackSide,
  BufferAttribute,
  Color,
  DataTexture,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Cel shading for juicefactory's 3D: MeshToonMaterial on a two-step gradient (one hard shadow tone), and
 * inverted-hull outlines (back faces pushed out along smoothed normals, a constant number of screen pixels thick).
 */

/** Two tones, shadow and lit; the lit band covers two thirds of the N·L range so shadows stay a narrow cel band. */
export const GRADIENT = (() => {
  const t = new DataTexture(new Uint8Array([70, 255, 255]), 3, 1, RedFormat);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

const toonCache = new Map<string, MeshToonMaterial>();
export function toon(hex: string): MeshToonMaterial {
  let m = toonCache.get(hex);
  if (!m) {
    m = new MeshToonMaterial({ color: new Color(hex), gradientMap: GRADIENT });
    toonCache.set(hex, m);
  }
  return m;
}

const flatCache = new Map<string, MeshBasicMaterial>();
/** Unlit flat color (pupils, shine marks, hole interiors). */
export function flat(hex: string): MeshBasicMaterial {
  let m = flatCache.get(hex);
  if (!m) {
    m = new MeshBasicMaterial({ color: new Color(hex) });
    flatCache.set(hex, m);
  }
  return m;
}

/** Shared uniforms: thickness in CSS px and the px -> view-space factor (2·tan(fov/2) / viewport height). */
export const outlineUniforms = {
  uPx: { value: 5 },
  uK: { value: 0.002 },
  uColor: { value: new Color("#16121C") },
};

export const outlineMaterial = new ShaderMaterial({
  uniforms: outlineUniforms,
  side: BackSide,
  vertexShader: /* glsl */ `
    attribute float outline;
    uniform float uPx;
    uniform float uK;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      mv.xyz += n * (uPx * uK * -mv.z * outline);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    void main() { gl_FragColor = vec4(uColor, 1.0); }
  `,
});

/** Geometry for a hull: welded seams, smooth normals, an `outline` scale per vertex, transformed by `m`. */
function hullOf(geo: BufferGeometry, m: Matrix4, scale: number): BufferGeometry {
  let g = geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
  g = mergeVertices(g, 1e-3);
  g.applyMatrix4(m);
  g.computeVertexNormals();
  const n = g.getAttribute("position").count;
  g.setAttribute("outline", new BufferAttribute(new Float32Array(n).fill(scale), 1));
  return g;
}

function solidOf(geo: BufferGeometry, m: Matrix4): BufferGeometry {
  let g = geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
  if (!g.index) g = mergeVertices(g, 1e-6);
  g.applyMatrix4(m);
  return g;
}

export interface Model {
  parts: Array<{ geo: BufferGeometry; mat: Material }>;
  hull: BufferGeometry | null;
}

/**
 * Collects primitives per material, then merges them: one mesh per material plus one outline hull.
 * Build once per model type; `instance()` makes cheap meshes that share the geometry.
 */
export class Builder {
  private byMat = new Map<Material, BufferGeometry[]>();
  private hulls: BufferGeometry[] = [];

  /** `outline`: hull thickness multiplier (0 = no outline for this primitive). */
  add(geo: BufferGeometry, mat: Material, m: Matrix4, outline = 1): this {
    let list = this.byMat.get(mat);
    if (!list) this.byMat.set(mat, (list = []));
    list.push(solidOf(geo, m));
    if (outline > 0) this.hulls.push(hullOf(geo, m, outline));
    return this;
  }

  /** Outline only (the solid is drawn by a mesh of its own, e.g. one that needs UVs). */
  outlineOnly(geo: BufferGeometry, m: Matrix4, outline = 1): this {
    this.hulls.push(hullOf(geo, m, outline));
    return this;
  }

  build(): Model {
    const parts = [...this.byMat.entries()].map(([mat, geos]) => ({ mat, geo: mergeGeometries(geos)! }));
    const hull = this.hulls.length ? mergeGeometries(this.hulls)! : null;
    return { parts, hull };
  }
}

export function instance(model: Model): Group {
  const g = new Group();
  for (const p of model.parts) g.add(new Mesh(p.geo, p.mat));
  if (model.hull) g.add(new Mesh(model.hull, outlineMaterial));
  return g;
}

/** Matrix helper: translate, rotate (XYZ euler) and scale. */
const tmp = new Matrix4();
const euler = new Euler();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Matrix4 {
  const m = new Matrix4().makeScale(sx, sy, sz);
  if (rx || ry || rz) {
    tmp.makeRotationFromEuler(euler.set(rx, ry, rz));
    m.premultiply(tmp);
  }
  m.setPosition(x, y, z);
  return m;
}
