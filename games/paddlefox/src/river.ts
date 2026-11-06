import type { BufferGeometry } from "three";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { P } from "./toybox/palette.ts";
import { SCREEN_RIGHT as R, SCREEN_UP as F } from "./toybox/stage.ts";
import { NO_BOTTOM, tone, Vox, type ColorLike } from "./toybox/vox.ts";

/**
 * The river in "river space": s runs downstream (up the screen), u is the sideways offset from the
 * meandering centre line (positive = screen right). The world is a voxel grid of 0.5 cells that the
 * river crosses diagonally, so the banks come out as little staircases.
 */

export const CELL = 0.5;
/** Height of the first bank terrace above the water. */
export const BANK = 0.45;
/** How far a waterfall drops the river. */
export const DROP = 1;
/** Sideways extent of generated terrain around the centre line (covers the screen with margin). */
const U_MAX = 9;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Difficulty by distance: 0 at the start, 1 at 520 m. */
export const level01 = (s: number) => clamp01(s / 520);

export class River {
  private readonly a1: number;
  private readonly a2: number;
  private readonly p1: number;
  private readonly p2: number;
  readonly falls: number[] = [];
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
    this.a1 = this.rng.range(1.3, 1.8);
    this.a2 = this.rng.range(1.8, 2.6);
    this.p1 = this.rng.range(0, 6.28);
    this.p2 = this.rng.range(0, 6.28);
  }

  /** Centre-line offset (along screen-right) at s. Straight for the first few metres. */
  center(s: number): number {
    const ease = clamp01((s - 4) / 16);
    return ease * (this.a1 * Math.sin(s / 8.5 + this.p1) + this.a2 * Math.sin(s / 21 + this.p2) - this.a1 * Math.sin(this.p1) - this.a2 * Math.sin(this.p2));
  }

  slope(s: number): number {
    return (this.center(s + 0.05) - this.center(s - 0.05)) / 0.1;
  }

  /** Half the river's width: it narrows over the run. */
  half(s: number): number {
    const k = level01(s);
    return 2.55 - 1.05 * k + 0.18 * Math.sin(s / 6.3);
  }

  /** Make sure waterfalls are decided at least up to sMax. */
  ensureFalls(sMax: number): void {
    let last = this.falls[this.falls.length - 1] ?? -40;
    while (last < sMax) {
      last = last < 0 ? 95 : last + this.rng.range(95, 140);
      this.falls.push(last);
    }
  }

  /** Water level at s (each fall drops it by DROP). */
  level(s: number): number {
    let n = 0;
    for (const f of this.falls) if (f <= s) n++;
    return -n * DROP;
  }

  /** The next fall at or after s (Infinity if none decided). */
  nextFall(s: number): number {
    for (const f of this.falls) if (f >= s) return f;
    return Infinity;
  }

  /** River-space coordinates of a world point. */
  toRiver(x: number, z: number): { s: number; u: number } {
    const s = x * F.x + z * F.z;
    return { s, u: x * R.x + z * R.z - this.center(s) };
  }

  /** World x/z of a river-space point. */
  worldX(s: number, u: number): number {
    return F.x * s + R.x * (this.center(s) + u);
  }
  worldZ(s: number, u: number): number {
    return F.z * s + R.z * (this.center(s) + u);
  }

  /** Terrain at a grid cell centre: water or bank, and its top height. */
  cell(x: number, z: number): { water: boolean; top: number; s: number; u: number; edge: number } {
    const { s, u } = this.toRiver(x, z);
    const hw = this.half(s);
    const L = this.level(s);
    const d = Math.abs(u) - hw;
    if (d < 0) return { water: true, top: L, s, u, edge: -d };
    const terrace = d > 5.2 ? 2 : d > 3 ? 1 : 0;
    return { water: false, top: L + BANK + terrace * 0.5, s, u, edge: d };
  }
}

const grassA = tone(P.mint, 0.02);
const grassB = tone(P.mint, -0.04);
const waterA = tone(P.water, 0.02);
const waterB = tone(P.water, -0.025);
const shallow = tone(P.water, 0.16);

/**
 * Builds one stretch of terrain (s in [s0, s1)) as a single voxel mesh: grass banks with soil sides,
 * flat water cells, waterfall lips in foam, and bank props (trees, bushes, flowers, reeds, rocks).
 */
export function buildChunk(river: River, s0: number, s1: number, seed: number): BufferGeometry {
  const v = new Vox();
  const rng = createRng(seed);
  // Bounding box of the stretch in world space.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let s = s0; s <= s1; s += 1)
    for (const u of [-U_MAX, U_MAX]) {
      const x = river.worldX(s, u);
      const z = river.worldZ(s, u);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  const i0 = Math.floor(minX / CELL) - 1;
  const i1 = Math.ceil(maxX / CELL) + 1;
  const j0 = Math.floor(minZ / CELL) - 1;
  const j1 = Math.ceil(maxZ / CELL) + 1;
  const DIRS = [
    [1, 0, 1],
    [-1, 0, 2],
    [0, 1, 16],
    [0, -1, 32],
  ] as const;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const x = (i + 0.5) * CELL;
      const z = (j + 0.5) * CELL;
      const c = river.cell(x, z);
      if (c.s < s0 || c.s >= s1 || Math.abs(c.u) > U_MAX + river.half(c.s)) continue;
      const checker = (i + j) & 1;
      if (c.water) {
        // Foam on the lip of a fall, lighter water in the shallows.
        const toFall = river.nextFall(c.s) - c.s;
        const col: ColorLike = toFall < 0.45 ? P.foam : toFall < 0.9 && rng() < 0.6 ? tone(P.foam, -0.05) : c.edge < 0.45 ? shallow : checker ? waterA : waterB;
        v.box(x, c.top - 0.05, z, CELL, 0.1, CELL, col, 4);
      } else {
        const grass = rng() < 0.08 ? tone(P.leaf, 0.1) : checker ? grassA : grassB;
        v.box(x, c.top - 0.04, z, CELL, 0.08, CELL, grass, 4);
      }
      // Side faces only where the neighbour is lower: grass lip over soil (or a foam curtain for water).
      for (const [dx, dz, bit] of DIRS) {
        const nb = river.cell(x + dx * CELL, z + dz * CELL).top;
        if (nb >= c.top - 0.01) continue;
        if (c.water) {
          v.box(x, (c.top + nb) / 2, z, CELL, c.top - nb, CELL, tone(P.foam, -0.06), bit);
          continue;
        }
        const lip = Math.min(0.1, c.top - nb);
        v.box(x, c.top - lip / 2, z, CELL, lip, CELL, P.mintDeep, bit);
        if (c.top - lip > nb) v.box(x, (c.top - lip + nb) / 2, z, CELL, c.top - lip - nb, CELL, P.soil, bit);
      }
      if (c.water) continue;

      // Props on the banks.
      const r = rng();
      if (c.edge < 0.6) {
        if (r < 0.12) reeds(v, x, c.top, z, rng);
        continue;
      }
      if (c.edge > 1.0 && r < 0.035) tree(v, x, c.top, z, rng);
      else if (r < 0.06) bush(v, x, c.top, z, rng);
      else if (r < 0.13) flower(v, x, c.top, z, rng);
      else if (r < 0.145) pebble(v, x, c.top, z);
    }
  return v.build();
}

function reeds(v: Vox, x: number, y: number, z: number, rng: Rng) {
  for (let k = 0; k < 3; k++) {
    const hh = rng.range(0.35, 0.6);
    const ox = rng.range(-0.18, 0.18);
    const oz = rng.range(-0.18, 0.18);
    v.box(x + ox, y + hh / 2, z + oz, 0.05, hh, 0.05, P.leafDeep, NO_BOTTOM);
    if (k === 0) v.box(x + ox, y + hh, z + oz, 0.08, 0.14, 0.08, P.bark, NO_BOTTOM);
  }
}

const CANOPIES = [P.leaf, P.leaf, P.mintDeep, P.blossom, P.butterDeep];
function tree(v: Vox, x: number, y: number, z: number, rng: Rng) {
  const c = rng.pick(CANOPIES);
  const tall = rng.range(0.5, 0.9);
  v.box(x, y + tall / 2, z, 0.16, tall, 0.16, P.bark, NO_BOTTOM);
  v.box(x, y + tall + 0.25, z, 0.8, 0.55, 0.8, c);
  v.box(x + 0.04, y + tall + 0.66, z - 0.04, 0.5, 0.3, 0.5, tone(c, 0.15), NO_BOTTOM);
  if (rng() < 0.5) v.box(x - 0.32, y + tall + 0.1, z + 0.3, 0.26, 0.24, 0.26, tone(c, -0.1));
}

function bush(v: Vox, x: number, y: number, z: number, rng: Rng) {
  const s = rng.range(0.28, 0.42);
  v.box(x, y + s / 2, z, s, s, s, P.leafDeep, NO_BOTTOM);
  v.box(x, y + s + 0.02, z, s * 0.75, 0.05, s * 0.75, P.leaf, NO_BOTTOM);
  if (rng() < 0.4) v.box(x + s * 0.3, y + s + 0.05, z + s * 0.2, 0.08, 0.08, 0.08, P.berry, NO_BOTTOM);
}

const PETALS = [P.blossom, P.butter, P.lilac, P.coral, P.cream];
function flower(v: Vox, x: number, y: number, z: number, rng: Rng) {
  const ox = rng.range(-0.15, 0.15);
  const oz = rng.range(-0.15, 0.15);
  v.box(x + ox, y + 0.07, z + oz, 0.04, 0.14, 0.04, P.leafDeep, NO_BOTTOM);
  v.box(x + ox, y + 0.17, z + oz, 0.11, 0.07, 0.11, rng.pick(PETALS), NO_BOTTOM);
}

function pebble(v: Vox, x: number, y: number, z: number) {
  v.box(x, y + 0.1, z, 0.3, 0.2, 0.26, P.stoneDeep, NO_BOTTOM);
  v.box(x + 0.08, y + 0.18, z - 0.05, 0.16, 0.12, 0.14, P.stone, NO_BOTTOM);
}
