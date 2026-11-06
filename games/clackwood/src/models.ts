/**
 * Clackwood's voxel models: the log table with its knot-hole pockets, the meadow it stands on, the balls (chunky
 * voxel spheres in their own colours with a number cap), the cue, the stump blockers and the spectators.
 * Everything is a pile of vertex-coloured boxes (one draw call per model) in lowpolyfox's daylight palette.
 */
import { BufferAttribute, CanvasTexture, Group, IcosahedronGeometry, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type BufferGeometry, type Material } from "three";
import { createRng } from "@thumbcade-games/kit/rng";
import { FONT } from "./toybox/fonts.ts";
import { P } from "./toybox/palette.ts";
import { col, NO_BOTTOM, tone, Vox } from "./toybox/vox.ts";
import { HL, HW, POCKETS, R } from "./sim.ts";

/** Object ball colours by number (1-12). Every one also carries its number, so colour is never the only cue. */
export const BALL_COLORS = [
  "#F4C964", // 1 butter
  "#6EB5E0", // 2 sky
  "#F27C6B", // 3 coral
  "#A592E0", // 4 lilac
  "#F2A07C", // 5 peach
  "#56B07F", // 6 leaf
  "#9C7059", // 7 bark
  "#EE93AF", // 8 blossom
  "#5E6AB8", // 9 dusk
  "#7ED6B0", // 10 mint
  "#E0B04A", // 11 honey
  "#C96B8E", // 12 plum
] as const;
export const CUE_COLOR = P.cream;
export const FELT = "#D2C3F3";
const FELT_DEEP = "#C3B1EE";
const CUSHION = "#B7A3E8";
export const RAIL_TOP = 0.2;
const RAIL_W = 0.46;

// ---------------------------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------------------------
export function tableGeometry(): BufferGeometry {
  const v = new Vox();
  // Felt in soft voxel tiles: two lilacs in a checker, so motion reads against it.
  const T = 0.5;
  for (let x = -HW; x < HW - 1e-6; x += T) {
    for (let z = -HL; z < HL - 1e-6; z += T) {
      const k = (Math.round((x + HW) / T) + Math.round((z + HL) / T)) % 2;
      v.box(x + T / 2, -0.03, z + T / 2, T, 0.06, T, k ? FELT : FELT_DEEP, NO_BOTTOM);
    }
  }
  // Head string and foot spot, painted.
  v.box(0, 0.002, HL * 0.5, 2 * HW - 0.2, 0.004, 0.035, tone(FELT, 0.35), NO_BOTTOM);
  v.box(0, 0.002, -HL * 0.5, 0.07, 0.004, 0.07, tone(FELT, 0.22), NO_BOTTOM);
  // Under the felt: the table body (darker wood), then the log rails around.
  v.span(-HW - RAIL_W, -0.5, -HL - RAIL_W, HW + RAIL_W, -0.06, HL + RAIL_W, P.woodDeep);
  const m = 0.5;
  const s = 0.38;
  const cushion = (x0: number, z0: number, x1: number, z1: number) => v.span(x0, -0.06, z0, x1, 0.09, z1, CUSHION, NO_BOTTOM);
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    v.span(x0, -0.06, z0, x1, RAIL_TOP, z1, P.wood, NO_BOTTOM);
    // Bark stripes along the log's top.
    const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const n = Math.floor((along ? x1 - x0 : z1 - z0) / 0.55);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      if (along) v.box(x0 + (x1 - x0) * u, RAIL_TOP + 0.005, (z0 + z1) / 2 + (i % 2 ? 0.06 : -0.06), 0.18, 0.01, 0.05, P.bark, NO_BOTTOM);
      else v.box((x0 + x1) / 2 + (i % 2 ? 0.06 : -0.06), RAIL_TOP + 0.005, z0 + (z1 - z0) * u, 0.05, 0.01, 0.18, P.bark, NO_BOTTOM);
    }
  };
  const C = 0.1; // cushion strip width
  for (const sx of [-1, 1]) {
    for (const [z0, z1] of [
      [-(HL - m), -s],
      [s, HL - m],
    ] as const) {
      cushion(sx > 0 ? HW - 0.02 : -HW - C + 0.02, z0, sx > 0 ? HW + C - 0.02 : -HW + 0.02, z1);
      rail(sx > 0 ? HW + C : -HW - RAIL_W, z0 - 0.25, sx > 0 ? HW + RAIL_W : -HW - C, z1 + 0.25);
    }
  }
  for (const sz of [-1, 1]) {
    cushion(-(HW - m), sz > 0 ? HL - 0.02 : -HL - C + 0.02, HW - m, sz > 0 ? HL + C - 0.02 : -HL + 0.02);
    rail(-(HW - m) - 0.25, sz > 0 ? HL + C : -HL - RAIL_W, HW - m + 0.25, sz > 0 ? HL + RAIL_W : -HL - C);
  }
  // Pockets: knot-holes in the wood, a dark well with a stepped rim and a leaf.
  POCKETS.forEach((p, i) => {
    const r = p.corner ? 0.36 : 0.33;
    // Stacked from the rim inward, each a little higher, so from above it reads as a dark hole with a wooden lip.
    const rings: Array<[number, string]> = [
      [r, P.bark],
      [r - 0.07, "#5B4759"],
      [r - 0.14, "#3A2F45"],
      [r - 0.2, "#2A2133"],
    ];
    rings.forEach(([rr, c], k) => v.box(p.x, -0.04 + k * 0.012, p.z, rr * 2, 0.04, rr * 2, c, NO_BOTTOM));
    // Corner posts: log ends with rings.
    if (p.corner) {
      const cx = p.x + Math.sign(p.x) * 0.28;
      const cz = p.z + Math.sign(p.z) * 0.28;
      v.box(cx, 0.06, cz, 0.36, 0.34, 0.36, P.bark, NO_BOTTOM);
      v.box(cx, 0.235, cz, 0.3, 0.01, 0.3, P.foxCream, NO_BOTTOM);
      v.box(cx, 0.242, cz, 0.16, 0.01, 0.16, P.wood, NO_BOTTOM);
    }
    const leaf = i % 2 ? P.leaf : P.mint;
    v.box(p.x + Math.sign(p.x) * 0.05, 0.005, p.z + (p.z === 0 ? 0.32 : Math.sign(p.z) * 0.02), 0.14, 0.02, 0.08, leaf, NO_BOTTOM);
  });
  // Legs: thick log stumps.
  for (const [x, z] of [
    [-HW, -HL + 0.6],
    [HW, -HL + 0.6],
    [-HW, HL - 0.6],
    [HW, HL - 0.6],
  ] as const)
    v.box(x * 0.92, -0.95, z, 0.55, 0.9, 0.55, P.bark, NO_BOTTOM);
  return v.build();
}

/** The meadow the table stands on: a big grass slab with soil sides, flowers, tufts, a few trees and stumps. */
export function meadowGeometry(seed = 7): BufferGeometry {
  const v = new Vox();
  const rng = createRng(seed);
  const Y = -1.4;
  const W = 10;
  const L = 17;
  for (let x = -W; x < W; x += 1) {
    for (let z = -L; z < L; z += 1) {
      const k = (Math.floor(x) + Math.floor(z)) & 1;
      v.box(x + 0.5, Y - 0.15, z + 0.5, 1, 0.3, 1, k ? P.mint : tone(P.mint, 0.12), NO_BOTTOM);
    }
  }
  v.span(-W, Y - 1.4, -L, W, Y - 0.3, L, P.soil);
  const clearX = HW + 0.8;
  const clearZ = HL + 0.8;
  const bloom = [P.blossom, P.butter, P.lilac, P.cream, P.peach];
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-W + 0.5, W - 0.5);
    const z = rng.range(-L + 0.5, L - 0.5);
    if (Math.abs(x) < clearX && Math.abs(z) < clearZ) continue;
    if (rng.chance(0.5)) {
      v.box(x, Y + 0.08, z, 0.06, 0.16, 0.06, P.leafDeep);
      v.box(x, Y + 0.2, z, 0.16, 0.1, 0.16, bloom[i % bloom.length]!);
    } else v.box(x, Y + 0.05, z, 0.22, 0.1, 0.1, P.leaf);
  }
  // Trees round the clearing (they show at the screen's edges).
  const trees: Array<[number, number, number]> = [
    [-4.4, -6.4, 1.2],
    [4.6, -5.2, 1],
    [-4.8, 1.2, 0.9],
    [4.5, 3.4, 1.15],
    [-4.2, 7.4, 1],
    [4.9, 8.6, 0.9],
    [-1.8, -8.8, 1.1],
    [2.6, -9.6, 1],
  ];
  trees.forEach(([x, z, k], i) => {
    v.box(x, Y + 0.6 * k, z, 0.35 * k, 1.2 * k, 0.35 * k, P.bark);
    const crown = i % 3 === 0 ? P.blossom : i % 3 === 1 ? P.leaf : P.mintDeep;
    v.box(x, Y + 1.55 * k, z, 1.5 * k, 1.0 * k, 1.5 * k, crown);
    v.box(x + 0.1 * k, Y + 2.25 * k, z - 0.1 * k, 0.9 * k, 0.5 * k, 0.9 * k, tone(crown, 0.12));
  });
  return v.build();
}

/** A stump to sit on. */
export function stumpGeometry(): BufferGeometry {
  return new Vox()
    .box(0, 0.22, 0, 0.62, 0.44, 0.62, P.bark)
    .box(0, 0.445, 0, 0.54, 0.01, 0.54, P.foxCream, NO_BOTTOM)
    .box(0, 0.452, 0, 0.26, 0.01, 0.26, P.wood, NO_BOTTOM)
    .box(0.36, 0.06, 0.1, 0.16, 0.12, 0.22, P.bark)
    .build();
}

/** A blocker on the cloth: a mossy stump with a mushroom, radius ~0.24. */
export function blockerGeometry(): BufferGeometry {
  return new Vox()
    .box(0, 0.16, 0, 0.42, 0.32, 0.42, P.bark)
    .box(0, 0.325, 0, 0.36, 0.01, 0.36, P.foxCream, NO_BOTTOM)
    .box(0, 0.33, 0, 0.16, 0.01, 0.16, P.wood, NO_BOTTOM)
    .box(0.12, 0.42, 0.06, 0.06, 0.18, 0.06, P.cream)
    .box(0.12, 0.54, 0.06, 0.24, 0.08, 0.24, P.berry)
    .box(0.06, 0.585, 0.02, 0.06, 0.01, 0.06, P.cream, NO_BOTTOM)
    .box(-0.14, 0.33, -0.1, 0.18, 0.04, 0.14, P.leafDeep)
    .build();
}

// ---------------------------------------------------------------------------------------------------------------
// Balls, number caps, the cue, the guide dots
// ---------------------------------------------------------------------------------------------------------------
/**
 * A ball of radius R: a flat-shaded low-poly icosphere in vertex colours (voxel cubes don't read as rolling), with a
 * cream spot at one pole so its roll shows.
 */
export function ballGeometry(color: string, spot: string = P.cream): BufferGeometry {
  const g = new IcosahedronGeometry(R, 1);
  const pos = g.attributes.position!;
  const cols = new Float32Array(pos.count * 3);
  const base = col(color);
  const hi = tone(color, 0.1);
  const sp = col(spot);
  for (let f = 0; f < pos.count; f += 3) {
    const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const cx = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
    const c = cy > R * 0.72 ? sp : (f / 3) % 4 === 0 || cx > R * 0.6 ? hi : base;
    for (let k = 0; k < 3; k++) {
      cols[(f + k) * 3] = c.r;
      cols[(f + k) * 3 + 1] = c.g;
      cols[(f + k) * 3 + 2] = c.b;
    }
  }
  g.setAttribute("color", new BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

/** One canvas with a cream disc and the number for every object ball; each cap plane picks its cell by UV. */
export function capAtlas(): CanvasTexture {
  const C = 128;
  const c = document.createElement("canvas");
  c.width = C * 4;
  c.height = C * 4;
  const g = c.getContext("2d")!;
  for (let n = 1; n <= 12; n++) {
    const cx = ((n - 1) % 4) * C + C / 2;
    const cy = Math.floor((n - 1) / 4) * C + C / 2;
    g.fillStyle = P.cream;
    g.beginPath();
    g.arc(cx, cy, C * 0.44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = P.ink;
    g.font = `900 ${n >= 10 ? 62 : 74}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(n), cx, cy + 5);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

export function capGeometry(n: number): BufferGeometry {
  const g = new PlaneGeometry(R * 1.25, R * 1.25);
  g.rotateX(-Math.PI / 2);
  const u0 = ((n - 1) % 4) / 4;
  const v0 = 1 - (Math.floor((n - 1) / 4) + 1) / 4;
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / 4, v0 + uv.getY(i) / 4);
  uv.needsUpdate = true;
  return g;
}

export function capMaterial(tex: CanvasTexture): Material {
  return new MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false });
}

/** The cue: along local +X from the tip (at the origin) back to the butt. */
export function cueGeometry(): BufferGeometry {
  const L = 3.4;
  return new Vox()
    .box(0.06, 0, 0, 0.12, 0.07, 0.07, P.sky)
    .box(0.16, 0, 0, 0.08, 0.075, 0.075, P.cream)
    .box(L * 0.45, 0, 0, L * 0.6, 0.085, 0.085, P.wood)
    .box(L * 0.85, 0, 0, L * 0.3, 0.11, 0.11, P.bark)
    .box(L * 0.72, 0, 0, 0.08, 0.115, 0.115, P.butter)
    .build();
}

// ---------------------------------------------------------------------------------------------------------------
// Spectators: a beaver and a rabbit (the fox comes from the toybox)
// ---------------------------------------------------------------------------------------------------------------
export interface Critter {
  root: Group;
  body: Group;
  head: Group;
}

export function createBeaver(mat: Material, scale = 0.05): Critter {
  const root = new Group();
  const body = new Group();
  root.add(body);
  root.scale.setScalar(scale);
  const brown = "#A9765A";
  const brownDeep = "#8A5C45";
  body.add(
    new Mesh(
      new Vox()
        .box(0, 3.6, -0.4, 5.6, 5.2, 5.4, brown)
        .box(0, 3.2, 2.4, 3.6, 3.6, 0.6, "#D9B48F")
        .box(0, 0.4, -4.6, 3.6, 0.8, 4.4, "#6B5A6E")
        .box(0, 0.85, -4.6, 2.8, 0.1, 3.6, "#80708A")
        .box(2.2, 0.6, 1.4, 1.4, 1.2, 1.8, brownDeep)
        .box(-2.2, 0.6, 1.4, 1.4, 1.2, 1.8, brownDeep)
        .box(1.8, 4.2, 2.6, 1.0, 1.0, 1.6, brownDeep)
        .box(-1.8, 4.2, 2.6, 1.0, 1.0, 1.6, brownDeep)
        .build(),
      mat,
    ),
  );
  const head = new Group();
  head.position.set(0, 6.4, 0.6);
  head.add(
    new Mesh(
      new Vox()
        .box(0, 1.4, 0.6, 4.6, 3.6, 4.2, brown)
        .box(0, 0.7, 3.0, 2.6, 1.8, 1.4, "#D9B48F")
        .box(0, 1.3, 3.75, 1.0, 0.7, 0.4, P.foxDark)
        .box(0, -0.2, 3.5, 1.2, 1.0, 0.4, P.cream)
        .box(0, -0.2, 3.72, 0.1, 1.0, 0.04, P.stoneDeep)
        .box(1.2, 2.2, 2.75, 0.7, 0.9, 0.3, P.foxDark)
        .box(-1.2, 2.2, 2.75, 0.7, 0.9, 0.3, P.foxDark)
        .box(2.1, 3.3, 0.2, 0.9, 0.9, 0.9, brownDeep)
        .box(-2.1, 3.3, 0.2, 0.9, 0.9, 0.9, brownDeep)
        .build(),
      mat,
    ),
  );
  body.add(head);
  root.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  return { root, body, head };
}

export function createRabbit(mat: Material, scale = 0.05): Critter {
  const root = new Group();
  const body = new Group();
  root.add(body);
  root.scale.setScalar(scale);
  const fur = P.cream;
  const furDeep = "#E9DCCB";
  body.add(
    new Mesh(
      new Vox()
        .box(0, 2.8, -0.4, 4.4, 4.4, 4.8, fur)
        .box(0, 2.4, 1.9, 2.8, 2.6, 0.5, "#FFFDF7")
        .box(1.6, 0.5, 1.6, 1.2, 1.0, 2.2, furDeep)
        .box(-1.6, 0.5, 1.6, 1.2, 1.0, 2.2, furDeep)
        .box(0, 2.0, -3.1, 1.8, 1.8, 1.2, "#FFFDF7")
        .build(),
      mat,
    ),
  );
  const head = new Group();
  head.position.set(0, 5.2, 0.6);
  head.add(
    new Mesh(
      new Vox()
        .box(0, 1.3, 0.6, 3.8, 3.2, 3.6, fur)
        .box(0, 0.5, 2.5, 1.8, 1.2, 0.6, "#FFFDF7")
        .box(0, 0.9, 2.85, 0.6, 0.45, 0.2, P.blossomDeep)
        .box(1.05, 1.7, 2.45, 0.6, 0.8, 0.2, P.foxDark)
        .box(-1.05, 1.7, 2.45, 0.6, 0.8, 0.2, P.foxDark)
        .box(1.0, 5.0, 0.2, 1.1, 4.4, 0.8, fur)
        .box(-1.0, 5.0, 0.2, 1.1, 4.4, 0.8, fur)
        .box(1.0, 5.0, 0.62, 0.6, 3.6, 0.1, P.blossom)
        .box(-1.0, 5.0, 0.62, 0.6, 3.6, 0.1, P.blossom)
        .build(),
      mat,
    ),
  );
  body.add(head);
  root.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  return { root, body, head };
}
