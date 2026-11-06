import { BufferGeometry, Color, Float32BufferAttribute } from "three";

/**
 * Merged voxel geometry with per-vertex colors. Every model in a lowpolyfox game is a pile of boxes:
 * one draw call per model, crisp flat facets (box normals are per face), lit by the scene's sun.
 */

export type ColorLike = string | number | Color;

export const PX = 1;
export const NX = 2;
export const PY = 4;
export const NY = 8;
export const PZ = 16;
export const NZ = 32;
export const ALL = 63;
/** Everything but the bottom: most things sit on something. */
export const NO_BOTTOM = ALL & ~NY;

// Corner signs per face, counter-clockwise seen from outside.
const FACES: Array<{ bit: number; n: [number, number, number]; c: Array<[number, number, number]> }> = [
  { bit: PX, n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { bit: NX, n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { bit: PY, n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { bit: NY, n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { bit: PZ, n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { bit: NZ, n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

const tmp = new Color();
const cache = new Map<string | number, Color>();
/** Linear-space color for a hex/name (three converts sRGB on set). */
export function col(c: ColorLike): Color {
  if (c instanceof Color) return c;
  let hit = cache.get(c);
  if (!hit) {
    hit = new Color(c);
    cache.set(c, hit);
  }
  return hit;
}

/** Lighter (amt > 0) or darker (amt < 0) in sRGB-ish terms, returned as a new Color. */
export function tone(c: ColorLike, amt: number): Color {
  const out = col(c).clone();
  return amt >= 0 ? out.lerp(tmp.setRGB(1, 1, 1), amt) : out.multiplyScalar(1 + amt);
}

export class Vox {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly c: number[] = [];
  private readonly i: number[] = [];

  get vertices(): number {
    return this.p.length / 3;
  }

  /** A box centred at (x, y, z) with size (w, h, d). `yaw` rotates it about its own vertical axis. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: ColorLike, faces = ALL, yaw = 0): this {
    const k = col(color);
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const f of FACES) {
      if (!(faces & f.bit)) continue;
      const base = this.p.length / 3;
      const nx = f.n[0] * cs + f.n[2] * sn;
      const nz = -f.n[0] * sn + f.n[2] * cs;
      for (const [sx, sy, sz] of f.c) {
        const lx = sx * hx;
        const lz = sz * hz;
        this.p.push(x + lx * cs + lz * sn, y + sy * hy, z - lx * sn + lz * cs);
        this.n.push(nx, f.n[1], nz);
        this.c.push(k.r, k.g, k.b);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** Box from min corner (x0, y0, z0) to max corner (x1, y1, z1). */
  span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: ColorLike, faces = ALL): this {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, faces);
  }

  /** A flat horizontal quad (top-facing) with its own corner colors, for gradients. */
  quad(x0: number, z0: number, x1: number, z1: number, y: number, c00: ColorLike, c10: ColorLike, c11: ColorLike, c01: ColorLike): this {
    const base = this.p.length / 3;
    const cols = [col(c01), col(c11), col(c10), col(c00)];
    const pts: Array<[number, number]> = [
      [x0, z1],
      [x1, z1],
      [x1, z0],
      [x0, z0],
    ];
    pts.forEach(([x, z], k) => {
      this.p.push(x, y, z);
      this.n.push(0, 1, 0);
      const cc = cols[k]!;
      this.c.push(cc.r, cc.g, cc.b);
    });
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
