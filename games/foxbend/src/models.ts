import type { BufferGeometry } from "three";
import { P } from "./toybox/palette.ts";
import { SCREEN_UP } from "./toybox/stage.ts";
import { col, NO_BOTTOM, tone, Vox } from "./toybox/vox.ts";

/** Tops of the walkable pieces (the pond surface is y = 0). */
export const STONE_TOP = 0.2;
export const PLANK_TOP = 0.22;

/** A chunky stepping stone (local top at y = 0): three tiers read as a rounded pebble, with a wet ring at the waterline. */
export function stoneGeometry(mossy: boolean): BufferGeometry {
  const v = new Vox()
    .span(-0.4, -0.42, -0.4, 0.4, -0.1, 0.4, tone(P.stoneDeep, 0.25), NO_BOTTOM)
    .span(-0.42, -0.24, -0.42, 0.42, -0.13, 0.42, "#A3CBD2", NO_BOTTOM)
    .span(-0.36, -0.1, -0.36, 0.36, -0.03, 0.36, P.stone, NO_BOTTOM)
    .span(-0.29, -0.03, -0.29, 0.29, 0, 0.29, tone(P.stone, 0.28), NO_BOTTOM);
  if (mossy) {
    v.span(-0.37, -0.04, -0.37, -0.08, 0.01, -0.12, P.mintDeep, NO_BOTTOM)
      .span(-0.41, -0.16, -0.36, -0.36, -0.05, -0.18, P.leafDeep, NO_BOTTOM)
      .span(0.14, -0.02, 0.16, 0.26, 0.04, 0.27, P.pebble, NO_BOTTOM);
  }
  return v.build();
}

/** A boardwalk square for the narrow stretches: slats across, two runners, posts into the pond. */
export function plankGeometry(): BufferGeometry {
  const v = new Vox();
  for (const [z, c] of [
    [-0.31, P.wood],
    [0, tone(P.wood, 0.08)],
    [0.31, P.wood],
  ] as const)
    v.box(0, -0.05, z, 0.96, 0.1, 0.27, c, NO_BOTTOM);
  v.box(0.3, -0.16, 0, 0.12, 0.12, 1, P.woodDeep, NO_BOTTOM).box(-0.3, -0.16, 0, 0.12, 0.12, 1, P.woodDeep, NO_BOTTOM);
  for (const x of [-0.42, 0.42]) for (const z of [-0.42, 0.42]) v.box(x, -0.2, z, 0.12, 0.52, 0.12, P.bark, NO_BOTTOM);
  return v.build();
}

/** Three berries and a leaf, sitting on a stone. */
export function berryGeometry(): BufferGeometry {
  return new Vox()
    .box(-0.09, 0.09, 0.05, 0.17, 0.17, 0.17, P.berry)
    .box(0.1, 0.09, -0.04, 0.17, 0.17, 0.17, P.berryDeep)
    .box(0.01, 0.24, 0.0, 0.16, 0.16, 0.16, P.berry)
    .box(0.01, 0.36, 0.0, 0.04, 0.1, 0.04, P.leafDeep)
    .box(0.09, 0.4, 0.0, 0.16, 0.04, 0.09, P.leaf)
    .box(0.04, 0.29, 0.06, 0.05, 0.05, 0.05, tone(P.berry, 0.5))
    .build();
}

/** The pond: a big square that follows the camera, lighter toward the top of the screen. */
export function waterGeometry(size = 64, n = 16): BufferGeometry {
  const v = new Vox();
  const step = size / n;
  const deep = col(P.waterDeep);
  const mid = col(P.water);
  const far = col("#BFE6EF");
  const colorAt = (x: number, z: number) => {
    const t = Math.max(0, Math.min(1, (x * SCREEN_UP.x + z * SCREEN_UP.z) / (size * 0.45) * 0.5 + 0.5));
    return t < 0.5 ? deep.clone().lerp(mid, t / 0.5) : mid.clone().lerp(far, (t - 0.5) / 0.5);
  };
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      const x0 = -size / 2 + a * step;
      const z0 = -size / 2 + b * step;
      v.quad(x0, z0, x0 + step, z0 + step, 0, colorAt(x0, z0), colorAt(x0 + step, z0), colorAt(x0 + step, z0 + step), colorAt(x0, z0 + step));
    }
  return v.build();
}

/** A square ripple outline (unit size), scaled up and faded by the game. */
export function rippleGeometry(): BufferGeometry {
  const t = 0.06;
  return new Vox()
    .box(0, 0, -0.5, 1 + t, 0.01, t, P.foam)
    .box(0, 0, 0.5, 1 + t, 0.01, t, P.foam)
    .box(-0.5, 0, 0, t, 0.01, 1 - t, P.foam)
    .box(0.5, 0, 0, t, 0.01, 1 - t, P.foam)
    .build();
}

export type DecorKind = "lily" | "lilyFlower" | "reeds" | "rock" | "hedge" | "tree";

export interface DecorModel {
  geo: BufferGeometry;
  /** Footprint in cells (1 or 2). */
  size: 1 | 2;
}

function lily(flower: boolean): BufferGeometry {
  const v = new Vox()
    .box(0, 0.02, 0, 0.66, 0.04, 0.46, P.leaf, NO_BOTTOM)
    .box(0, 0.02, 0, 0.46, 0.04, 0.66, P.leaf, NO_BOTTOM)
    .box(0.2, 0.045, 0.12, 0.14, 0.01, 0.2, P.mint, NO_BOTTOM);
  if (flower) {
    v.box(0, 0.09, 0, 0.12, 0.1, 0.12, P.butter)
      .box(0.1, 0.07, 0, 0.1, 0.07, 0.1, P.blossom)
      .box(-0.1, 0.07, 0, 0.1, 0.07, 0.1, P.blossom)
      .box(0, 0.07, 0.1, 0.1, 0.07, 0.1, P.blossomDeep)
      .box(0, 0.07, -0.1, 0.1, 0.07, 0.1, P.blossom);
  }
  return v.build();
}

function reeds(): BufferGeometry {
  const v = new Vox();
  const stalks: Array<[number, number, number, boolean]> = [
    [-0.15, -0.1, 0.75, true],
    [0.05, 0.12, 0.95, true],
    [0.18, -0.15, 0.6, false],
    [-0.05, 0.25, 0.5, false],
  ];
  for (const [x, z, h, top] of stalks) {
    v.box(x, h / 2, z, 0.06, h, 0.06, P.leafDeep, NO_BOTTOM);
    if (top) v.box(x, h - 0.05, z, 0.1, 0.2, 0.1, P.bark, NO_BOTTOM);
    else v.box(x + 0.06, h * 0.7, z, 0.1, 0.03, 0.04, P.leaf, NO_BOTTOM);
  }
  return v.build();
}

function rock(): BufferGeometry {
  return new Vox()
    .box(0, 0.08, 0, 0.56, 0.3, 0.48, tone(P.stoneDeep, -0.05), NO_BOTTOM)
    .box(0.14, 0.18, 0.1, 0.32, 0.26, 0.3, P.stoneDeep, NO_BOTTOM)
    .box(-0.05, 0.245, -0.02, 0.36, 0.03, 0.28, P.mintDeep, NO_BOTTOM)
    .box(-0.32, 0.0, 0.2, 0.18, 0.12, 0.18, P.stone, NO_BOTTOM)
    .build();
}

function islet(v: Vox): Vox {
  // Grass over soil, rising out of the pond; footprint 2x2 cells centered on (0, 0).
  return v
    .box(0, 0.14, 0, 1.76, 0.28, 1.76, P.mint, NO_BOTTOM)
    .box(0, -0.25, 0, 1.76, 0.5, 1.76, P.soil, NO_BOTTOM)
    .box(0, 0.005, 0, 1.78, 0.03, 1.78, P.mintDeep, NO_BOTTOM);
}

function flowers(v: Vox, spots: Array<[number, number, string]>): Vox {
  for (const [x, z, c] of spots) v.box(x, 0.36, z, 0.05, 0.16, 0.05, P.leafDeep, NO_BOTTOM).box(x, 0.47, z, 0.15, 0.1, 0.15, c, NO_BOTTOM);
  return v;
}

function hedge(): BufferGeometry {
  const v = islet(new Vox());
  v.box(-0.35, 0.55, -0.3, 0.8, 0.56, 0.8, P.leafDeep, NO_BOTTOM)
    .box(-0.35, 0.86, -0.3, 0.66, 0.08, 0.66, P.leaf, NO_BOTTOM)
    .box(0.42, 0.45, -0.45, 0.5, 0.36, 0.5, P.leafDeep, NO_BOTTOM)
    .box(0.42, 0.65, -0.45, 0.4, 0.06, 0.4, P.leaf, NO_BOTTOM)
    .box(-0.1, 0.83, -0.05, 0.12, 0.1, 0.12, P.blossom, NO_BOTTOM)
    .box(-0.55, 0.75, -0.62, 0.1, 0.1, 0.1, P.butter, NO_BOTTOM);
  return flowers(v, [
    [0.45, 0.45, P.blossom],
    [0.15, 0.6, P.butter],
    [-0.5, 0.5, P.lilac],
    [0.65, 0.05, P.coral],
  ]).build();
}

function tree(): BufferGeometry {
  const v = islet(new Vox());
  v.box(0, 0.75, 0, 0.2, 0.95, 0.2, P.bark, NO_BOTTOM)
    .box(0, 1.35, 0, 1.0, 0.5, 1.0, P.blossom)
    .box(0.05, 1.72, -0.05, 0.66, 0.3, 0.66, tone(P.blossom, 0.2), NO_BOTTOM)
    .box(-0.38, 1.2, 0.36, 0.34, 0.3, 0.34, P.blossomDeep)
    .box(0.42, 1.25, -0.3, 0.3, 0.28, 0.3, P.blossomDeep)
    .box(0.12, 0.31, 0.55, 0.3, 0.06, 0.24, P.blossom, NO_BOTTOM)
    .box(-0.5, 0.31, -0.4, 0.2, 0.06, 0.2, P.blossom, NO_BOTTOM);
  return flowers(v, [
    [0.6, 0.55, P.butter],
    [-0.6, 0.1, P.lilac],
  ]).build();
}

/** The fox's home islet behind the start: a 3x3 lawn with a tiny den. */
export function homeGeometry(): BufferGeometry {
  const v = new Vox()
    .box(0, 0.14, 0, 2.8, 0.28, 2.8, P.mint, NO_BOTTOM)
    .box(0, -0.25, 0, 2.8, 0.5, 2.8, P.soil, NO_BOTTOM)
    .box(0, 0.005, 0, 2.82, 0.03, 2.82, P.mintDeep, NO_BOTTOM);
  // Den: a hedge hump with a round-ish door.
  v.box(-0.4, 0.62, 0.55, 1.6, 0.7, 1.2, P.leafDeep, NO_BOTTOM)
    .box(-0.4, 1.02, 0.55, 1.2, 0.16, 0.9, P.leaf, NO_BOTTOM)
    .box(-0.4, 0.55, -0.06, 0.5, 0.5, 0.04, P.foxDark, NO_BOTTOM)
    .box(-0.4, 0.83, -0.06, 0.34, 0.08, 0.04, P.foxDark, NO_BOTTOM);
  // A little mailbox post.
  v.box(0.95, 0.55, -0.7, 0.1, 0.55, 0.1, P.woodDeep, NO_BOTTOM).box(0.95, 0.9, -0.7, 0.3, 0.2, 0.22, P.coral).box(1.02, 1.02, -0.7, 0.04, 0.12, 0.04, P.butterDeep);
  return flowers(v, [
    [0.8, 0.9, P.blossom],
    [0.5, 1.15, P.butter],
    [1.1, 0.35, P.lilac],
    [-1.15, -0.9, P.butter],
    [0.2, -1.1, P.blossom],
  ]).build();
}

export function decorModels(): Record<DecorKind, DecorModel> {
  return {
    lily: { geo: lily(false), size: 1 },
    lilyFlower: { geo: lily(true), size: 1 },
    reeds: { geo: reeds(), size: 1 },
    rock: { geo: rock(), size: 1 },
    hedge: { geo: hedge(), size: 2 },
    tree: { geo: tree(), size: 2 },
  };
}
