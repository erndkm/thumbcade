import {
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { PAL } from "./comic.ts";
import { Builder, flat, GRADIENT, instance, mat, toon, type Model } from "./toon.ts";

/** World layout. Holes sit on a 3×3 grid; rows are spaced wider so the grid reads square from the high camera. */
export const COL = 2.35;
export const ROW = 3.05;
export const BOARD_W = 8.1;
export const BOARD_D = 10.4;
export const GRASS_T = 0.3;
export const DIRT_T = 2.3;
export const HOLE_R = 0.76;

export const HOLES: Vector3[] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) HOLES.push(new Vector3((c - 1) * COL, 0, (r - 1) * ROW));

export const FUR = "#D9803A";
export const FUR_GOLD = "#FFC21F";
export const CREAM = "#FFE3AE";
export const DIRT = "#C2652C";
export const DIRT_DARK = "#8E4220";
export const HOLE = "#2B140B";
export const WOOD = "#F0B567";

const sphere = (r: number, w = 18, h = 12) => new SphereGeometry(r, w, h);

function roundRect(w: number, d: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Board: a floating lawn diorama with mowed stripes, a cake-slab of dirt, nine holes with mounds, and props
// ---------------------------------------------------------------------------------------------------------------

function stripeTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 2;
  const g = c.getContext("2d")!;
  g.fillStyle = PAL.lime;
  g.fillRect(0, 0, 1, 1);
  g.fillStyle = "#AEEB55";
  g.fillRect(0, 1, 1, 1);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = SRGBColorSpace;
  // Shape UVs are world units: one stripe per hole row.
  t.repeat.set(1, 1 / (2 * ROW));
  t.offset.set(0, 0.25);
  return t;
}

export function buildBoard(): Group {
  const root = new Group();

  // Grass cap.
  const grassGeo = new ExtrudeGeometry(roundRect(BOARD_W, BOARD_D, 1.1), {
    depth: GRASS_T,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.14,
    bevelSegments: 2,
    curveSegments: 6,
  });
  grassGeo.rotateX(-Math.PI / 2);
  grassGeo.translate(0, -GRASS_T - 0.14, 0);
  const grassMat = new MeshToonMaterial({ color: "#FFFFFF", map: stripeTexture(), gradientMap: GRADIENT });
  const grass = new Mesh(grassGeo, grassMat);
  root.add(grass);

  // Dirt slab (slightly inset so the grass overhangs it like frosting).
  const dirtGeo = new ExtrudeGeometry(roundRect(BOARD_W - 0.35, BOARD_D - 0.35, 1.0), {
    depth: DIRT_T,
    bevelEnabled: false,
    curveSegments: 6,
  });
  dirtGeo.rotateX(-Math.PI / 2);
  dirtGeo.translate(0, -GRASS_T - DIRT_T, 0);

  const b = new Builder();
  b.outlineOnly(grassGeo, mat(), 1.15);
  b.add(dirtGeo, toon(DIRT), mat(), 1.15);

  // Pebbles, a bone and a worm in the dirt walls.
  const pebble = sphere(0.22, 10, 8);
  const front = BOARD_D / 2 - 0.17;
  const side = BOARD_W / 2 - 0.17;
  const pebbles: Array<[number, number, number, number]> = [
    [-2.9, -1.1, front, 1],
    [-1.2, -1.9, front, 0.8],
    [0.9, -0.9, front, 1.1],
    [2.6, -1.7, front, 0.9],
    [-3.4, -2.1, front, 0.7],
    [3.3, -0.8, front, 0.6],
  ];
  for (const [x, y, z, s] of pebbles) b.add(pebble, toon(PAL.cream), mat(x, y, z, 0, 0, 0, s * 1.2, s * 0.8, s * 0.6), 0.6);
  for (const [z, y, s] of [
    [2.8, -1.4, 1],
    [0.2, -2.0, 0.8],
    [-2.4, -1.0, 0.9],
  ] as const) {
    b.add(pebble, toon(PAL.cream), mat(side, y, z, 0, 0, 0, 0.6 * s, 0.8 * s, 1.2 * s), 0.6);
    b.add(pebble, toon(PAL.cream), mat(-side, y + 0.3, -z, 0, 0, 0, 0.6 * s, 0.8 * s, 1.2 * s), 0.6);
  }
  // Bone.
  b.add(new CapsuleGeometry(0.09, 0.7, 3, 8), toon(PAL.white), mat(-0.4, -1.45, front + 0.02, 0, 0, Math.PI / 2 + 0.3), 0.5);
  for (const [dx, dy] of [
    [-0.36, -0.08],
    [-0.31, 0.12],
    [0.36, 0.06],
    [0.3, -0.13],
  ] as const) {
    const a = 0.3;
    b.add(sphere(0.12, 8, 6), toon(PAL.white), mat(-0.4 + dx * Math.cos(a) - dy * Math.sin(a), -1.45 + dx * Math.sin(a) + dy * Math.cos(a), front + 0.02, 0, 0, 0, 1, 1, 0.6), 0.5);
  }
  // Worm.
  for (let i = 0; i < 5; i++) {
    b.add(sphere(0.15, 10, 8), toon(PAL.bubblegum), mat(1.7 + i * 0.2, -2.15 + Math.sin(i * 1.4) * 0.12, front + 0.05, 0, 0, 0, 1, 1, 0.6), 0.5);
  }

  // Holes: dark pit, a crescent of back wall, and a lumpy dirt mound.
  // The far inner wall shows as a lighter crescent: a dark-dirt disc with the black pit shifted toward the camera.
  const wall = new CircleGeometry(HOLE_R, 28).rotateX(-Math.PI / 2);
  const pit = new CircleGeometry(HOLE_R * 0.8, 28).rotateX(-Math.PI / 2);
  const mound = new TorusGeometry(HOLE_R + 0.08, 0.17, 10, 30).rotateX(-Math.PI / 2);
  const clod = sphere(0.15, 8, 6);
  HOLES.forEach((h, i) => {
    b.add(wall, flat(DIRT_DARK), mat(h.x, 0.012, h.z), 0);
    b.add(pit, flat(HOLE), mat(h.x, 0.018, h.z + HOLE_R * 0.17), 0);
    b.add(mound, toon(DIRT), mat(h.x, 0.04, h.z, 0, 0, 0, 1, 0.8, 1), 0.8);
    for (let k = 0; k < 2; k++) {
      const a = i * 1.7 + k * 2.9;
      b.add(clod, toon(DIRT), mat(h.x + Math.cos(a) * (HOLE_R + 0.3), 0.06, h.z + Math.sin(a) * (HOLE_R + 0.3), 0, 0, 0, 1, 0.7, 1), 0.6);
    }
  });

  // Grass tufts and flowers between the holes.
  const blade = new ConeGeometry(0.09, 0.42, 5);
  const tufts: Array<[number, number]> = [
    [-3.4, -0.3],
    [3.45, 1.55],
    [-1.2, 1.55],
    [1.15, -1.55],
    [-3.1, 4.5],
    [3.0, -4.5],
    [0.1, 4.6],
    [-1.25, -4.6],
  ];
  for (const [x, z] of tufts) {
    for (let k = -1; k <= 1; k++) b.add(blade, toon(PAL.limeShade), mat(x + k * 0.12, 0.18, z, 0, 0, k * 0.35), 0.55);
  }
  const petal = sphere(0.13, 8, 6);
  const flowers: Array<[number, number, string]> = [
    [-3.4, 1.5, PAL.white],
    [3.4, -1.5, PAL.bubblegum],
    [1.2, 1.55, PAL.white],
    [-1.15, -1.55, PAL.bubblegum],
    [3.45, 4.55, PAL.white],
  ];
  for (const [x, z, c] of flowers) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      b.add(petal, toon(c), mat(x + Math.cos(a) * 0.15, 0.1, z + Math.sin(a) * 0.15, 0, 0, 0, 1, 0.45, 1), 0.45);
    }
    b.add(sphere(0.1, 8, 6), toon(PAL.banana), mat(x, 0.16, z, 0, 0, 0, 1, 0.6, 1), 0.4);
  }

  // Traffic cones (it is a work site, after all).
  const cone = new ConeGeometry(0.3, 1.2, 18);
  const band = new CylinderGeometry(0.17, 0.23, 0.24, 18);
  const base = new BoxGeometry(0.66, 0.12, 0.66);
  for (const [x, z, ry] of [
    [-3.2, -4.45, 0.3],
    [3.25, 4.5, -0.4],
  ] as const) {
    b.add(base, toon(PAL.tomato), mat(x, 0.06, z, 0, ry, 0), 0.8);
    b.add(cone, toon(PAL.tomato), mat(x, 0.7, z), 0.9);
    b.add(band, toon(PAL.white), mat(x, 0.66, z), 0);
  }

  root.add(instance(b.build()));

  // A hard cartoon drop shadow on the backdrop, offset away from the light.
  const shadow = new Mesh(new CircleGeometry(0.5, 40), new MeshBasicMaterial({ color: PAL.ink, transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(BOARD_W * 1.12, BOARD_D * 1.05, 1);
  shadow.position.set(0.9, -GRASS_T - DIRT_T - 1.6, 0.9);
  shadow.renderOrder = -1;
  root.add(shadow);
  return root;
}

// ---------------------------------------------------------------------------------------------------------------
// Critters. Origin at ground level; popped up = y 0. Body, eyes and headgear are separate so they can animate.
// ---------------------------------------------------------------------------------------------------------------

export type Kind = "gopher" | "helmet" | "golden" | "bunny";

/** Height of the headgear pivot above a critter's origin. */
export const HAT_PIVOT = 1.62;
/** Critters are drawn a touch larger than life so they own their holes. */
export const CRITTER_SCALE = 1.12;
const HAT_SCALE = 0.92;

export interface CritterRig {
  kind: Kind;
  root: Group;
  /** Squash/stretch pivot (child of root). */
  body: Group;
  eyes: Group;
  /** Knocked-silly eyes (whites with ink crosses), shown instead of `eyes` after a thunk. */
  xEyes: Group | null;
  hat: Group | null;
  /** Height of the top of the head(gear) when up. */
  top: number;
}

function gopherBody(fur: string, belly: string): Model {
  const b = new Builder();
  b.add(new CapsuleGeometry(0.6, 1.1, 6, 18), toon(fur), mat(0, -0.25, 0), 1);
  b.add(sphere(0.64, 22, 16), toon(fur), mat(0, 1.22, 0.02), 1);
  b.add(sphere(0.5), toon(belly), mat(0, 0.15, 0.36, 0, 0, 0, 0.95, 1.25, 0.55), 0.6);
  b.add(sphere(0.34), toon(belly), mat(0, 1.06, 0.48, 0, 0, 0, 1.3, 0.85, 0.9), 0.7);
  b.add(sphere(0.12, 12, 10), toon(PAL.bubblegum), mat(0, 1.2, 0.84), 0.6);
  // Buck teeth.
  b.add(new BoxGeometry(0.11, 0.2, 0.07), toon(PAL.white), mat(-0.062, 0.84, 0.74, -0.2), 0.5);
  b.add(new BoxGeometry(0.11, 0.2, 0.07), toon(PAL.white), mat(0.062, 0.84, 0.74, -0.2), 0.5);
  // Ears and paws on the rim.
  for (const s of [-1, 1]) {
    b.add(sphere(0.17, 12, 10), toon(fur), mat(s * 0.56, 1.62, -0.02, 0, 0, 0, 1, 1, 0.55), 0.7);
    b.add(sphere(0.09, 10, 8), toon(PAL.bubblegum), mat(s * 0.56, 1.62, 0.06, 0, 0, 0, 1, 1, 0.4), 0);
    b.add(sphere(0.2, 12, 10), toon(fur), mat(s * 0.42, 0.42, 0.5, 0, 0, 0, 1, 0.8, 1), 0.7);
  }
  // Cheek shine.
  b.add(sphere(0.08, 8, 6), flat(PAL.white), mat(-0.36, 1.48, 0.5, 0, 0, 0.6, 1.6, 0.6, 0.4), 0);
  return b.build();
}

function eyesModel(r: number, y: number, spread: number, z: number): Model {
  const b = new Builder();
  for (const s of [-1, 1]) {
    b.add(sphere(r, 14, 10), toon(PAL.white), mat(s * spread, y, z, 0, 0, 0, 1, 1.15, 0.7), 0.55);
    b.add(sphere(r * 0.52, 10, 8), flat(PAL.ink), mat(s * spread * 0.92, y - r * 0.05, z + r * 0.5, 0, 0, 0, 1, 1.2, 0.6), 0);
    b.add(sphere(r * 0.17, 6, 4), flat(PAL.white), mat(s * spread * 0.92 - r * 0.15, y + r * 0.22, z + r * 0.78), 0);
  }
  return b.build();
}

function xEyesModel(r: number, y: number, spread: number, z: number): Model {
  const b = new Builder();
  const bar = new BoxGeometry(r * 1.5, r * 0.36, r * 0.3);
  for (const s of [-1, 1]) {
    b.add(sphere(r, 14, 10), toon(PAL.white), mat(s * spread, y, z, 0, 0, 0, 1, 1.15, 0.7), 0.55);
    for (const a of [-1, 1]) b.add(bar, flat(PAL.ink), mat(s * spread * 0.95, y, z + r * 0.62, 0, 0, a * 0.8), 0);
  }
  return b.build();
}

function hardHat(color: string): Model {
  const b = new Builder();
  b.add(new SphereGeometry(0.68, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(color), mat(0, 1.62, -0.02, -0.12), 1);
  b.add(new CylinderGeometry(0.84, 0.86, 0.09, 26), toon(color), mat(0, 1.64, 0.06, -0.12), 1);
  b.add(new BoxGeometry(0.16, 0.12, 1.32), toon(color), mat(0, 2.24, -0.04, -0.12, 0, 0, 1, 1, 1), 0.6);
  b.add(new CylinderGeometry(0.16, 0.16, 0.05, 16), toon(PAL.white), mat(0, 1.92, 0.6, Math.PI / 2 - 0.55), 0.5);
  b.add(sphere(0.12, 8, 6), flat(PAL.white), mat(-0.32, 2.05, 0.3, 0, 0, 0.7, 1.7, 0.55, 0.5), 0);
  return b.build();
}

function steelHelmet(): Model {
  const b = new Builder();
  b.add(new SphereGeometry(0.74, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(PAL.cobalt), mat(0, 1.5, -0.02, -0.08, 0, 0, 1, 1.05, 1), 1);
  b.add(new CylinderGeometry(0.9, 0.92, 0.1, 26), toon(PAL.cobalt), mat(0, 1.52, 0, -0.08), 1);
  for (let k = 0; k < 5; k++) {
    const a = -1.1 + k * 0.55;
    b.add(sphere(0.07, 8, 6), toon(PAL.white), mat(Math.sin(a) * 0.72, 1.66, Math.cos(a) * 0.72), 0.4);
  }
  b.add(sphere(0.14, 8, 6), flat(PAL.white), mat(-0.34, 2.0, 0.32, 0, 0, 0.7, 1.8, 0.55, 0.5), 0);
  return b.build();
}

function bunnyBody(): Model {
  const fur = "#FFFFFF";
  const b = new Builder();
  b.add(new CapsuleGeometry(0.56, 1.0, 6, 18), toon(fur), mat(0, -0.3, 0), 1);
  b.add(sphere(0.62, 22, 16), toon(fur), mat(0, 1.15, 0.02), 1);
  for (const s of [-1, 1]) {
    b.add(new CapsuleGeometry(0.16, 0.95, 4, 12), toon(fur), mat(s * 0.27, 2.05, -0.06, -0.1, 0, -s * 0.2, 1, 1, 0.75), 1);
    b.add(new CapsuleGeometry(0.08, 0.7, 4, 10), toon(PAL.bubblegum), mat(s * 0.265, 2.02, 0.04, -0.1, 0, -s * 0.2, 1, 1, 0.5), 0);
    b.add(sphere(0.12, 10, 8), toon(PAL.bubblegumHi), mat(s * 0.38, 0.98, 0.5, 0, 0, 0, 1, 0.7, 0.5), 0);
    b.add(sphere(0.19, 12, 10), toon(fur), mat(s * 0.4, 0.38, 0.48, 0, 0, 0, 1, 0.8, 1), 0.7);
  }
  b.add(sphere(0.1, 10, 8), toon(PAL.bubblegum), mat(0, 1.08, 0.62, 0, 0, 0, 1.2, 0.9, 1), 0.5);
  b.add(new BoxGeometry(0.15, 0.17, 0.06), toon(PAL.white), mat(0, 0.86, 0.6, -0.2), 0.45);
  // Lime bow tie.
  for (const s of [-1, 1]) b.add(new ConeGeometry(0.17, 0.32, 4), toon(PAL.lime), mat(s * 0.15, 0.62, 0.52, 0, 0, s * (Math.PI / 2)), 0.6);
  b.add(sphere(0.08, 8, 6), toon(PAL.lime), mat(0, 0.62, 0.56), 0.5);
  return b.build();
}

const shared = new Map<string, Model>();
function once(key: string, f: () => Model): Model {
  let m = shared.get(key);
  if (!m) shared.set(key, (m = f()));
  return m;
}

export function buildCritter(kind: Kind): CritterRig {
  const root = new Group();
  const body = new Group();
  root.add(body);
  let hat: Group | null = null;
  let eyes: Group;
  let xEyes: Group | null = null;
  if (kind === "bunny") {
    body.add(instance(once("bunny", bunnyBody)));
    eyes = instance(once("bunnyEyes", () => eyesModel(0.2, 1.3, 0.25, 0.53)));
  } else {
    body.add(instance(once(kind === "golden" ? "goldBody" : "body", () => (kind === "golden" ? gopherBody(FUR_GOLD, PAL.bananaHi) : gopherBody(FUR, CREAM)))));
    eyes = instance(once("eyes", () => eyesModel(0.185, 1.37, 0.24, 0.56)));
    xEyes = instance(once("xEyes", () => xEyesModel(0.185, 1.37, 0.24, 0.56)));
    xEyes.visible = false;
    body.add(xEyes);
    // The headgear hangs from a pivot at brow height so a thunk can knock it askew.
    hat = new Group();
    hat.position.y = HAT_PIVOT;
    const gear = instance(once(`hat-${kind}`, () => (kind === "helmet" ? steelHelmet() : hardHat(kind === "golden" ? PAL.tomato : PAL.banana))));
    gear.position.y = -HAT_PIVOT * HAT_SCALE;
    gear.scale.setScalar(HAT_SCALE);
    hat.add(gear);
    body.add(hat);
  }
  body.add(eyes);
  root.scale.setScalar(CRITTER_SCALE);
  return { kind, root, body, eyes, xEyes, hat, top: (kind === "bunny" ? 2.95 : 2.3) * CRITTER_SCALE };
}

// ---------------------------------------------------------------------------------------------------------------
// The mallet: pivot at the grip, handle along -X, a wooden barrel head with red bands at the far end.
// ---------------------------------------------------------------------------------------------------------------

export const MALLET_REACH = 4.0;
export const HEAD_HALF = 0.95;

export interface MalletRig {
  rig: Group;
  swing: Group;
  head: Group;
}

export function buildMallet(): MalletRig {
  const handle = once("handle", () => {
    const b = new Builder();
    b.add(new CylinderGeometry(0.17, 0.2, MALLET_REACH - 0.4, 12), toon(WOOD), mat(-(MALLET_REACH - 0.4) / 2, 0, 0, 0, 0, Math.PI / 2), 1);
    b.add(new CylinderGeometry(0.25, 0.25, 0.95, 12), toon(PAL.tomato), mat(-0.2, 0, 0, 0, 0, Math.PI / 2), 1);
    b.add(sphere(0.28, 12, 8), toon(PAL.tomato), mat(0.3, 0, 0), 1);
    return b.build();
  });
  const head = once("head", () => {
    const b = new Builder();
    b.add(new CylinderGeometry(0.8, 0.8, HEAD_HALF * 2, 26), toon(WOOD), mat(0, 0, 0), 1.1);
    for (const y of [-0.62, 0.62]) b.add(new CylinderGeometry(0.85, 0.85, 0.24, 26), toon(PAL.tomato), mat(0, y, 0), 0.8);
    b.add(sphere(0.26, 10, 8), flat(PAL.white), mat(-0.3, 0.05, 0.66, 0, 0.5, 0, 0.35, 1.7, 0.4), 0);
    return b.build();
  });
  const rig = new Group();
  const swing = new Group();
  rig.add(swing);
  swing.add(instance(handle));
  const headGroup = instance(head);
  headGroup.position.set(-MALLET_REACH, 0, 0);
  swing.add(headGroup);
  // Pivot sits so that at swing 0 the head's bottom face lands on the rig origin.
  swing.position.set(MALLET_REACH, HEAD_HALF, 0);
  rig.visible = false;
  return { rig, swing, head: headGroup };
}

// ---------------------------------------------------------------------------------------------------------------
// Backdrop: a full-screen sunburst with halftone dots, drawn first.
// ---------------------------------------------------------------------------------------------------------------

export function buildBackdrop(): { mesh: Mesh; uniforms: { uTime: { value: number }; uCenter: { value: Vector2 }; uRes: { value: Vector2 }; uDpr: { value: number }; uSpin: { value: number } } } {
  const uniforms = {
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uCenter: { value: new Vector2(0.5, 0.5) },
    uRes: { value: new Vector2(1, 1) },
    uDpr: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSpin;
      uniform vec2 uCenter;
      uniform vec2 uRes;
      uniform float uDpr;
      const vec3 RAY_A = vec3(1.0, 0.847, 0.227);
      const vec3 RAY_B = vec3(1.0, 0.925, 0.541);
      const vec3 DOT = vec3(1.0, 0.486, 0.776);
      void main() {
        vec2 p = gl_FragCoord.xy / uDpr;
        vec2 res = uRes;
        vec2 c = vec2(uCenter.x, 1.0 - uCenter.y) * res;
        vec2 d = p - c;
        float a = atan(d.y, d.x) + uSpin;
        float tri = abs(fract(a / 6.2831853 * 18.0) - 0.5);
        float e = fwidth(tri) * 0.75;
        float ray = smoothstep(0.25 - e, 0.25 + e, tri);
        vec3 col = mix(RAY_A, RAY_B, ray);
        // Halftone dots on a 45-degree grid, growing toward the edges.
        float s = 13.0;
        vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p / s;
        vec2 cell = fract(q) - 0.5;
        float r = length(d / res * vec2(1.0, 0.85));
        float rad = clamp((r - 0.42) * 1.25, 0.0, 0.46);
        float dist = length(cell);
        float aa = 0.6 / s;
        float dotm = 1.0 - smoothstep(rad - aa, rad + aa, dist);
        col = mix(col, DOT, dotm * step(0.02, rad));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}
