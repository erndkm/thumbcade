import { Box3, CanvasTexture, Group, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Material } from "three";
import { Spring } from "@thumbcade-games/kit/ease";
import { FONT } from "./fonts.ts";
import { P } from "./palette.ts";
import { ISO } from "./stage.ts";
import { Vox } from "./vox.ts";

/**
 * The title signpost: a wooden board on two posts, planted on the little grass slab every lowpolyfox
 * thing stands on. Lives in the stage's UI scene (pixel units), grid-aligned like everything else, so
 * the lettering reads along the iso diagonal.
 */
export interface Sign {
  group: Group;
  /** Places the sign with its projected box's top-left at (x, y), at most `maxW` px wide. */
  layout(x: number, y: number, maxW: number, place: (o: Group, x: number, y: number, k: number) => void): void;
  show(on: boolean): void;
  update(dt: number): void;
  /** Bottom edge of the sign on screen (px) after the last layout. */
  readonly bottom: number;
  readonly left: number;
}

const L = 4.6;
const H = 1.75;

export function createSign(mat: Material, title: string): Sign {
  const group = new Group();
  const inner = new Group();
  group.add(inner);

  const v = new Vox();
  // Ground slab: grass over soil.
  v.span(-1.15, -0.32, -2.8, 1.15, 0, 2.8, P.mint);
  v.span(-1.15, -0.95, -2.8, 1.15, -0.32, 2.8, P.soil);
  v.span(-1.15, -0.34, -2.8, 1.15, -0.3, 2.8, P.mintDeep);
  // Posts.
  v.box(0, 0.75, 1.75, 0.32, 1.5, 0.32, P.woodDeep);
  v.box(0, 0.75, -1.75, 0.32, 1.5, 0.32, P.woodDeep);
  // Board with a darker rim and a little roof trim.
  v.box(0, 1.0 + H / 2, 0, 0.3, H, L, P.wood);
  v.box(0, 1.0 + H + 0.08, 0, 0.42, 0.16, L + 0.2, P.woodDeep);
  // Flowers and tufts on the slab.
  const bits: Array<[number, number, string]> = [
    [0.7, 2.3, P.blossom],
    [0.55, -2.35, P.butter],
    [-0.6, -0.4, P.lilac],
    [0.75, 0.6, P.leaf],
    [-0.75, 2.1, P.leaf],
  ];
  for (const [x, z, c] of bits) {
    v.box(x, 0.12, z, 0.12, 0.24, 0.12, P.leafDeep);
    v.box(x, 0.3, z, 0.24, 0.16, 0.24, c);
  }
  v.box(-0.55, 0.22, 1.05, 0.34, 0.44, 0.34, P.stone).box(-0.4, 0.12, 1.4, 0.24, 0.24, 0.24, P.pebble);
  const wood = new Mesh(v.build(), mat);
  inner.add(wood);

  // The painted face (unlit so the lettering stays crisp).
  const cw = 1024;
  const ch = Math.round((cw * (H - 0.3)) / (L - 0.3));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext("2d")!;
  g.fillStyle = P.cream;
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = "rgba(221,166,118,0.22)";
  for (let y = ch * 0.25; y < ch; y += ch * 0.25) g.fillRect(0, y - 2, cw, 4);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  let size = ch * 0.74;
  g.font = `900 ${size}px ${FONT}`;
  const tw = g.measureText(title).width;
  if (tw > cw * 0.86) size *= (cw * 0.86) / tw;
  g.font = `900 ${size}px ${FONT}`;
  const base = ch * 0.5 + size * 0.36;
  g.fillStyle = "rgba(75,64,96,0.16)";
  g.fillText(title, cw / 2, base + 9);
  g.fillStyle = P.ink;
  g.fillText(title, cw / 2, base);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  tex.minFilter = LinearMipmapLinearFilter;
  const face = new Mesh(new PlaneGeometry(L - 0.3, H - 0.3), new MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.rotation.y = Math.PI / 2;
  face.position.set(0.152, 1.0 + H / 2, 0);
  inner.add(face);

  // Screen-space extent at scale 1 (for layout).
  const box = new Box3().setFromObject(inner);
  const camRight = new Vector3().crossVectors(new Vector3(0, 1, 0), ISO).normalize();
  const camUp = new Vector3().crossVectors(ISO, camRight).normalize();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const c = new Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const sx = c.dot(camRight);
    const sy = -c.dot(camUp);
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }

  const drop = new Spring(1, 140, 13);
  const squash = new Spring(1, 300, 12);
  let shown = true;
  let landed = false;
  let k = 40;
  let baseY = 0;
  let bottom = 0;
  let left = 0;

  const sign: Sign = {
    group,
    layout(x, y, maxW, place) {
      k = Math.min(48, maxW / (maxX - minX));
      place(group, x - minX * k, y - minY * k, k);
      baseY = group.position.y;
      bottom = y + (maxY - minY) * k;
      left = x;
    },
    show(on) {
      if (on === shown) return;
      shown = on;
      drop.target = on ? 0 : 1;
      if (on) landed = false;
    },
    update(dt) {
      const before = drop.value;
      drop.update(dt);
      if (!landed && shown && drop.value <= 0.02 && before > drop.value) {
        landed = true;
        squash.value = 0.8;
      }
      squash.update(dt);
      // Hidden = lifted above the screen; landing gives it a little squash.
      inner.position.y = drop.value * 9;
      inner.scale.set(1 + (1 - squash.value) * 0.4, squash.value, 1 + (1 - squash.value) * 0.4);
      group.visible = drop.value < 0.98;
      group.position.y = baseY;
    },
    get bottom() {
      return bottom;
    },
    get left() {
      return left;
    },
  };
  drop.snap(1);
  drop.target = 0;
  return sign;
}
