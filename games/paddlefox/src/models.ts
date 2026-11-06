import type { BufferGeometry } from "three";
import type { Rng } from "@thumbcade-games/kit/rng";
import { CELL, type River } from "./river.ts";
import { P } from "./toybox/palette.ts";
import { NO_BOTTOM, tone, Vox } from "./toybox/vox.ts";

/** The canoe, bow toward +Z, waterline at y = 0. */
export function canoeGeometry(): BufferGeometry {
  const hull = P.coral;
  const hullDeep = tone(P.coral, -0.12);
  const v = new Vox()
    .box(0, 0.02, 0, 0.36, 0.1, 1.2, hullDeep)
    .box(0.2, 0.12, 0, 0.08, 0.24, 1.1, hull)
    .box(-0.2, 0.12, 0, 0.08, 0.24, 1.1, hull)
    .box(0, 0.12, 0.6, 0.3, 0.24, 0.12, hull)
    .box(0, 0.16, 0.7, 0.16, 0.24, 0.1, hull)
    .box(0, 0.12, -0.6, 0.3, 0.24, 0.12, hull)
    .box(0, 0.16, -0.7, 0.16, 0.24, 0.1, hull)
    .box(0, 0.08, 0, 0.32, 0.04, 1.08, P.wood, NO_BOTTOM)
    .box(0.21, 0.255, 0, 0.1, 0.03, 1.12, P.cream, NO_BOTTOM)
    .box(-0.21, 0.255, 0, 0.1, 0.03, 1.12, P.cream, NO_BOTTOM)
    .box(0, 0.2, 0.32, 0.34, 0.04, 0.08, P.woodDeep, NO_BOTTOM)
    .box(0, 0.2, -0.36, 0.34, 0.04, 0.08, P.woodDeep, NO_BOTTOM)
    .box(0, 0.3, 0.74, 0.1, 0.06, 0.06, P.butter, NO_BOTTOM);
  return v.build();
}

/** A double paddle across local X (blades at both ends). */
export function paddleGeometry(): BufferGeometry {
  return new Vox()
    .box(0, 0, 0, 1.1, 0.045, 0.045, P.woodDeep)
    .box(0.58, 0, 0, 0.2, 0.03, 0.14, P.butter)
    .box(-0.58, 0, 0, 0.2, 0.03, 0.14, P.butter)
    .build();
}

/** A floating log along local X, centred, length `len`. */
export function logGeometry(len: number): BufferGeometry {
  return new Vox()
    .box(0, 0.08, 0, len, 0.28, 0.3, P.bark)
    .box(0, 0.225, 0, len - 0.1, 0.03, 0.18, tone(P.bark, 0.15), NO_BOTTOM)
    .box(len / 2 + 0.01, 0.08, 0, 0.02, 0.24, 0.26, P.wood)
    .box(-len / 2 - 0.01, 0.08, 0, 0.02, 0.24, 0.26, P.wood)
    .box(len / 2 + 0.02, 0.08, 0, 0.02, 0.1, 0.1, P.woodDeep)
    .box(-len / 2 - 0.02, 0.08, 0, 0.02, 0.1, 0.1, P.woodDeep)
    .box(len * 0.18, 0.28, 0.05, 0.08, 0.14, 0.08, P.bark, NO_BOTTOM)
    .box(len * 0.18 + 0.06, 0.36, 0.05, 0.14, 0.04, 0.08, P.leaf, NO_BOTTOM)
    .build();
}

const FISH_COLORS = [
  [P.butter, P.butterDeep],
  [P.peach, P.peachDeep],
  [P.lilac, P.lilacDeep],
] as const;

/** A little fish facing +Z. */
export function fishGeometry(variant: number): BufferGeometry {
  const [a, b] = FISH_COLORS[variant % FISH_COLORS.length]!;
  return new Vox()
    .box(0, 0, 0.02, 0.12, 0.16, 0.3, a)
    .box(0, -0.02, 0.06, 0.13, 0.06, 0.16, P.cream)
    .box(0, 0, -0.18, 0.04, 0.16, 0.08, b)
    .box(0, 0, -0.24, 0.04, 0.22, 0.06, b)
    .box(0, 0.1, 0.02, 0.03, 0.06, 0.12, b)
    .box(0.065, 0.03, 0.12, 0.01, 0.04, 0.04, P.foxDark)
    .box(-0.065, 0.03, 0.12, 0.01, 0.04, 0.04, P.foxDark)
    .build();
}

/** Three spiral arms of foam cubes over a darker disc. Rotated by the game. */
export function whirlGeometry(): BufferGeometry {
  const v = new Vox();
  const deep = tone(P.waterDeep, -0.08);
  for (let r = 0.15; r < 1.25; r += 0.18) {
    const n = Math.max(6, Math.round(r * 18));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      v.box(Math.cos(a) * r, 0.012, Math.sin(a) * r, 0.17, 0.012, 0.17, r < 0.5 ? deep : tone(P.waterDeep, (r - 0.5) * 0.2));
    }
  }
  for (let arm = 0; arm < 3; arm++)
    for (let t = 0; t < 1; t += 0.07) {
      const r = 0.12 + t * 1.15;
      const a = arm * ((Math.PI * 2) / 3) + t * 4.2;
      v.box(Math.cos(a) * r, 0.03, Math.sin(a) * r, 0.13 - t * 0.05, 0.02, 0.13 - t * 0.05, t < 0.3 ? P.foam : tone(P.foam, -0.05));
    }
  return v.build();
}

/** Rocks: a grid-aligned boulder cluster centred on (x, z) at water level y. */
export function rockGeometry(x: number, y: number, z: number, r: number, rng: Rng): BufferGeometry {
  const v = new Vox();
  const s = r * 1.5;
  const base = "#B8AEC6";
  const top = "#D3CBDC";
  v.box(x, y + s * 0.22, z, s, s * 0.6, s * 0.86, base);
  v.box(x + s * 0.14, y + s * 0.56, z - s * 0.06, s * 0.7, s * 0.3, s * 0.62, top, NO_BOTTOM);
  v.box(x - s * 0.3, y + s * 0.1, z + s * 0.38, s * 0.42, s * 0.3, s * 0.34, tone(base, 0.08));
  v.box(x + s * 0.12, y + s * 0.725, z - s * 0.1, s * 0.46, s * 0.05, s * 0.4, rng() < 0.6 ? P.mintDeep : tone(top, 0.15), NO_BOTTOM);
  // Foam where the current breaks on it.
  v.box(x - s * 0.62, y + 0.02, z - s * 0.1, s * 0.22, 0.03, s * 0.5, P.foam, NO_BOTTOM);
  v.box(x - s * 0.1, y + 0.02, z - s * 0.6, s * 0.5, 0.03, s * 0.22, P.foam, NO_BOTTOM);
  v.box(x + s * 0.62, y + 0.015, z + s * 0.5, s * 0.3, 0.02, s * 0.18, tone(P.foam, -0.05), NO_BOTTOM);
  return v.build();
}

/**
 * A beaver dam across the river at s, with one gap [g0, g1] (in u). Built from the same 0.5 grid
 * as the banks, so it steps across the river like everything else.
 */
export function damGeometry(river: River, sd: number, g0: number, g1: number, rng: Rng): BufferGeometry {
  const v = new Vox();
  const hw = river.half(sd) + 0.6;
  const L = river.level(sd);
  const mud = "#9A7462";
  const sticks = [P.wood, tone(P.wood, -0.1), P.woodDeep, tone(P.bark, 0.12)];
  const cx = river.worldX(sd, 0);
  const cz = river.worldZ(sd, 0);
  const span = hw + 2;
  let end: { x: number; z: number; u: number } | null = null;
  for (let i = Math.floor((cx - span) / CELL); i <= Math.ceil((cx + span) / CELL); i++)
    for (let j = Math.floor((cz - span) / CELL); j <= Math.ceil((cz + span) / CELL); j++) {
      const x = (i + 0.5) * CELL;
      const z = (j + 0.5) * CELL;
      const { s, u } = river.toRiver(x, z);
      if (Math.abs(s - sd) > 0.36 || Math.abs(u) > hw || (u > g0 && u < g1)) continue;
      // A mud-and-stick heap: a low core, then sticks laid every which way on top.
      v.box(x, L + 0.1, z, CELL, 0.3, CELL, tone(mud, rng.range(-0.06, 0.06)), NO_BOTTOM);
      for (let k = 0; k < 3; k++) {
        const along = rng.chance(0.5);
        const len = rng.range(0.35, 0.7);
        const yy = L + 0.28 + k * 0.08 + rng.range(0, 0.04);
        v.box(x + rng.range(-0.12, 0.12), yy, z + rng.range(-0.12, 0.12), along ? len : 0.09, 0.08, along ? 0.09 : len, rng.pick(sticks), NO_BOTTOM);
      }
      if (rng() < 0.2) v.box(x, L + 0.5, z, 0.08, 0.3, 0.08, P.woodDeep, NO_BOTTOM);
      if (rng() < 0.18) v.box(x + 0.1, L + 0.5, z - 0.1, 0.16, 0.05, 0.12, P.leaf, NO_BOTTOM);
      if (Math.abs(u) > hw - 0.7 && (!end || Math.abs(u) > Math.abs(end.u))) end = { x, z, u };
    }
  // The builder, sitting proudly on one end.
  if (end) {
    const { x, z } = end;
    const y = L + 0.5;
    const fur = "#B07A5C";
    v.box(x, y + 0.13, z, 0.28, 0.26, 0.3, fur)
      .box(x + 0.02, y + 0.33, z + 0.08, 0.22, 0.18, 0.2, fur)
      .box(x + 0.02, y + 0.3, z + 0.19, 0.1, 0.08, 0.04, P.foxCream)
      .box(x + 0.02, y + 0.24, z + 0.2, 0.06, 0.05, 0.02, P.cream)
      .box(x - 0.06, y + 0.37, z + 0.185, 0.04, 0.04, 0.02, P.foxDark)
      .box(x + 0.1, y + 0.37, z + 0.185, 0.04, 0.04, 0.02, P.foxDark)
      .box(x + 0.02, y + 0.03, z - 0.27, 0.2, 0.05, 0.3, "#6E5466");
  }
  // Foam where the water squeezes through the gap.
  const gm = (g0 + g1) / 2;
  for (let k = 0; k < 6; k++) {
    const s = sd + 0.6 + k * 0.25;
    const u = gm + rng.range(-0.4, 0.4) * (g1 - g0) * 0.5;
    v.box(river.worldX(s, u), L + 0.015, river.worldZ(s, u), 0.2, 0.02, 0.14, P.foam, NO_BOTTOM);
  }
  return v.build();
}

/** A bank tree whose low branch reaches over the water from side `side` (±1) to uTip. */
export function branchGeometry(river: River, sb: number, side: number, uTip: number, rng: Rng): BufferGeometry {
  const v = new Vox();
  const hw = river.half(sb);
  const L = river.level(sb);
  const trunkU = side * (hw + 0.75);
  const tx = (Math.floor(river.worldX(sb, trunkU) / CELL) + 0.5) * CELL;
  const tz = (Math.floor(river.worldZ(sb, trunkU) / CELL) + 0.5) * CELL;
  const ground = L + 0.45;
  // A leaning old tree with a big canopy.
  v.box(tx, ground + 0.9, tz, 0.34, 1.8, 0.34, P.bark);
  v.box(tx, ground + 2.05, tz, 1.7, 0.75, 1.7, P.leafDeep);
  v.box(tx + 0.1, ground + 2.6, tz - 0.1, 1.1, 0.4, 1.1, P.leaf, NO_BOTTOM);
  // The limb: a 4-connected staircase of grid cells from the trunk out over the water.
  const y = L + 0.66;
  const cells: Array<[number, number]> = [];
  const seen = new Set<string>();
  const push = (i: number, j: number) => {
    const k = `${i},${j}`;
    if (seen.has(k)) return;
    seen.add(k);
    cells.push([i, j]);
  };
  const steps = Math.ceil(Math.abs(trunkU - uTip) / 0.12);
  let pi = Math.floor(tx / CELL);
  let pj = Math.floor(tz / CELL);
  for (let k = 0; k <= steps; k++) {
    const u = trunkU + ((uTip - trunkU) * k) / steps;
    const i = Math.floor(river.worldX(sb, u) / CELL);
    const j = Math.floor(river.worldZ(sb, u) / CELL);
    if (i !== pi && j !== pj) push(i, pj);
    push(i, j);
    pi = i;
    pj = j;
  }
  cells.forEach(([i, j], n) => {
    const x = (i + 0.5) * CELL;
    const z = (j + 0.5) * CELL;
    const t = n / Math.max(1, cells.length - 1);
    const thick = 0.2 - t * 0.06;
    v.box(x, y + (1 - t) * 0.12, z, CELL, thick, CELL, tone(P.bark, rng.range(-0.04, 0.08)));
    // Leaves on top and willow strands hanging toward the water.
    if (rng() < 0.75) v.box(x + rng.range(-0.08, 0.08), y + 0.2, z + rng.range(-0.08, 0.08), 0.42, 0.2, 0.42, rng.chance(0.25) ? P.blossom : P.leaf);
    for (let h = 0; h < 2; h++) {
      if (rng() < 0.55) {
        const len = rng.range(0.18, 0.4);
        v.box(x + rng.range(-0.18, 0.18), y - 0.08 - len / 2, z + rng.range(-0.18, 0.18), 0.07, len, 0.07, P.leafDeep);
      }
    }
  });
  return v.build();
}
