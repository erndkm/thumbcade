import {
  type BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Target disc and dart geometry, built once at boot and shared by every disc. */

export const R = 1.9;
export const THICK = 0.56;
export const HUB_R = 0.44;
/** Chunks the disc is built from (and shatters into). */
export const K = 12;
export const STEP = (Math.PI * 2) / K;
/** How deep a dart's needle sinks into the rim. */
export const EMBED = 0.26;
/** Dart length from tip to the end of the flights. */
export const DART_LEN = 1.42;
/** How far a stuck dart sticks out past the rim. */
export const OUT = DART_LEN - EMBED;

/**
 * One chunk of the disc: an annular sector spanning [0, STEP) in the XY plane, extruded along +Z and centered
 * on z = 0. Caps (group 0) carry the face texture, mapped so the whole disc shares one image.
 */
export function wedgeGeometry(): ExtrudeGeometry {
  const pad = 0.006;
  const s = new Shape();
  s.absarc(0, 0, R, pad, STEP - pad, false);
  s.absarc(0, 0, HUB_R, STEP - pad, pad, true);
  const g = new ExtrudeGeometry(s, { depth: THICK, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -THICK / 2);
  // Face UVs: the default generator uses x/y directly; remap [-R, R] to [0, 1].
  const uv = g.getAttribute("uv");
  const pos = g.getAttribute("position");
  const normal = g.getAttribute("normal");
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(normal.getZ(i)) > 0.5) uv.setXY(i, pos.getX(i) / (2 * R) + 0.5, pos.getY(i) / (2 * R) + 0.5);
  }
  uv.needsUpdate = true;
  return g;
}

/** The neon tube along the front edge of one chunk. */
export function rimArcGeometry(): TorusGeometry {
  const g = new TorusGeometry(R + 0.02, 0.055, 6, 10, STEP - 0.012);
  g.translate(0, 0, THICK / 2 + 0.01);
  return g;
}

function paint(geo: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex);
  const n = geo.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geo;
}

/**
 * A steel-tip dart pointing along +Y with its tip at the origin: needle, knurled barrel, shaft, four flights.
 * One geometry with vertex colors = one draw call per dart.
 */
export function dartGeometry(flight: string, barrel: string, band: string): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const at = (g: BufferGeometry, y: number) => {
    g.translate(0, y, 0);
    return g;
  };
  parts.push(paint(at(new ConeGeometry(0.03, 0.1, 8), -0.05), "#E9E6F2"));
  parts.push(paint(at(new CylinderGeometry(0.026, 0.026, 0.34, 8), -0.27), "#B9B4C8"));
  // Barrel: three knurled bands with dark grooves between them.
  const bands = [
    [-0.47, barrel],
    [-0.6, band],
    [-0.73, barrel],
  ] as const;
  parts.push(paint(at(new CylinderGeometry(0.05, 0.075, 0.06, 12), -0.42), barrel));
  for (const [y, col] of bands) parts.push(paint(at(new CylinderGeometry(0.078, 0.078, 0.11, 12), y), col));
  parts.push(paint(at(new CylinderGeometry(0.066, 0.066, 0.4, 12), -0.6), "#2A2438"));
  parts.push(paint(at(new CylinderGeometry(0.072, 0.04, 0.08, 12), -0.83), barrel));
  parts.push(paint(at(new CylinderGeometry(0.03, 0.03, 0.3, 8), -1.0), "#1E1A28"));
  // Four swept-back flights.
  const fin = new Shape();
  fin.moveTo(0.025, -0.98);
  fin.lineTo(0.2, -1.12);
  fin.lineTo(0.235, -1.4);
  fin.lineTo(0.025, -1.34);
  fin.closePath();
  for (let i = 0; i < 4; i++) {
    const f = new ExtrudeGeometry(fin, { depth: 0.014, bevelEnabled: false });
    f.translate(0, 0, -0.007);
    f.rotateY((i * Math.PI) / 2 + Math.PI / 4);
    parts.push(paint(f, flight));
  }
  // mergeGeometries wants matching attribute sets: drop uvs everywhere (the dart is untextured).
  for (const p of parts) p.deleteAttribute("uv");
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  merged.computeBoundingSphere();
  return merged;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface FaceStyle {
  bands: [string, string, string];
  divider: string;
  ticks: string;
  hazard?: string;
}

export const FACE_HOUSE: FaceStyle = { bands: ["#3A2A5E", "#21183A", "#30244F"], divider: "#0C0816", ticks: "#EE55FF" };
export const FACE_BOSS: FaceStyle = { bands: ["#3A3446", "#221E2C", "#2E2938"], divider: "#0E0C14", ticks: "#FFD45C", hazard: "#EE55FF" };

/**
 * The arcade target's face: three rings of cells split by dark dividers, tick marks on the outer ring,
 * and a hazard ring on boss discs. Drawn once per style at 512².
 */
export function faceTexture(style: FaceStyle): CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const cx = S / 2;
  const k = S / 2 / R;
  g.fillStyle = style.divider;
  g.fillRect(0, 0, S, S);
  const rings = [
    [R * 0.97, R * 0.72, style.bands[0], 12, 0],
    [R * 0.7, R * 0.47, style.bands[1], 12, 0.5],
    [R * 0.45, HUB_R, style.bands[2], 6, 0],
  ] as const;
  for (const [ro, ri, col, cells, off] of rings) {
    for (let i = 0; i < cells; i++) {
      const a0 = ((i + off) / cells) * Math.PI * 2 + 0.018;
      const a1 = ((i + 1 + off) / cells) * Math.PI * 2 - 0.018;
      g.beginPath();
      g.arc(cx, cx, ro * k, a0, a1);
      g.arc(cx, cx, ri * k, a1, a0, true);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      // A soft top-left sheen per cell, for a molded-plastic feel.
      g.save();
      g.clip();
      const grad = g.createLinearGradient(0, 0, S, S);
      grad.addColorStop(0, "rgba(255,255,255,0.10)");
      grad.addColorStop(0.6, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      g.restore();
    }
  }
  if (style.hazard) {
    // Boss discs: chevrons on the outer ring.
    g.save();
    g.beginPath();
    g.arc(cx, cx, R * 0.97 * k, 0, Math.PI * 2);
    g.arc(cx, cx, R * 0.8 * k, Math.PI * 2, 0, true);
    g.clip();
    g.translate(cx, cx);
    for (let i = 0; i < 36; i++) {
      g.rotate((Math.PI * 2) / 36);
      g.fillStyle = i % 2 ? style.hazard : "#15111D";
      g.globalAlpha = i % 2 ? 0.55 : 0.9;
      g.beginPath();
      g.moveTo(R * 0.8 * k, -8);
      g.lineTo(R * 0.97 * k, 4);
      g.lineTo(R * 0.97 * k, 18);
      g.lineTo(R * 0.8 * k, 6);
      g.fill();
    }
    g.restore();
  }
  // Tick marks around the outer edge.
  g.strokeStyle = style.ticks;
  g.globalAlpha = 0.55;
  g.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r0 = R * (i % 4 === 0 ? 0.88 : 0.93) * k;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * R * 0.97 * k, cx + Math.sin(a) * R * 0.97 * k);
    g.stroke();
  }
  g.globalAlpha = 1;
  return texture(c);
}

/** Brushed steel with rivets for the disc's edge. */
export function edgeTexture(): CanvasTexture {
  const [c, g] = canvas(256, 32);
  g.fillStyle = "#4A4458";
  g.fillRect(0, 0, 256, 32);
  for (let y = 0; y < 32; y += 2) {
    g.fillStyle = `rgba(255,255,255,${0.03 + ((y * 37) % 7) * 0.008})`;
    g.fillRect(0, y, 256, 1);
  }
  g.fillStyle = "#2A2534";
  g.fillRect(0, 0, 256, 3);
  g.fillRect(0, 29, 256, 3);
  for (let x = 10; x < 256; x += 32) {
    g.fillStyle = "#1E1A26";
    g.beginPath();
    g.arc(x, 16, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#8C86A0";
    g.beginPath();
    g.arc(x - 1, 15, 2, 0, Math.PI * 2);
    g.fill();
  }
  const t = texture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/** Radial falloff: white center to transparent edge (halos, shadows, light pools). */
export function softDisc(inner = 0.0, stops: Array<[number, number]> = [[0, 1], [1, 0]]): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, inner * 64, 64, 64, 64);
  for (const [o, a] of stops) r.addColorStop(o, `rgba(255,255,255,${a})`);
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** The back wall: dark lacquered slats. */
export function wallTexture(): CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#161026";
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = "#0B0814";
    g.fillRect(x, 0, 3, 256);
    g.fillStyle = "rgba(255,255,255,0.035)";
    g.fillRect(x + 4, 0, 2, 256);
  }
  const t = texture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}

/** A vertical gradient strip for the light shaft (bright at the top). */
export function beamTexture(): CanvasTexture {
  const [c, g] = canvas(4, 128);
  const lg = g.createLinearGradient(0, 0, 0, 128);
  lg.addColorStop(0, "rgba(255,255,255,0.55)");
  lg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = lg;
  g.fillRect(0, 0, 4, 128);
  return texture(c);
}
