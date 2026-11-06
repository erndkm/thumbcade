/** Everything in the world, drawn in juicefactory's ink-and-flat-colour sticker style. World units, y down. */
import { hash, inkFill, PAL, roundRectPath, shine, starPath } from "./comic.ts";

const TAU = Math.PI * 2;
export const PH = 14;
const INK = PAL.ink;

export interface PlankStyle {
  body: string;
  shade: string;
  stripe: string;
}

export const PLANK: PlankStyle = { body: PAL.cobalt, shade: PAL.cobaltShade, stripe: PAL.cobaltHi };
export const MOVER: PlankStyle = { body: PAL.tomato, shade: PAL.tomatoShade, stripe: PAL.white };

/** A candy-striped plank: x = centre, y = top. `wear` 0 fresh, 1 cracked. */
export function drawPlank(g: CanvasRenderingContext2D, x: number, y: number, w: number, s: PlankStyle, wear: number, seed: number): void {
  const x0 = x - w / 2;
  roundRectPath(g, x0 + 3, y + 5, w, PH, PH / 2);
  g.fillStyle = INK;
  g.fill();
  roundRectPath(g, x0, y, w, PH, PH / 2);
  g.save();
  g.clip();
  g.fillStyle = s.body;
  g.fillRect(x0, y, w, PH);
  g.fillStyle = s.stripe;
  for (let sx = x0 - PH; sx < x0 + w + PH; sx += 15) {
    g.beginPath();
    g.moveTo(sx, y + PH);
    g.lineTo(sx + 7, y + PH);
    g.lineTo(sx + 7 + PH, y);
    g.lineTo(sx + PH, y);
    g.closePath();
    g.fill();
  }
  g.fillStyle = s.shade;
  g.fillRect(x0, y + PH - 4.5, w, 5);
  g.restore();
  roundRectPath(g, x0, y, w, PH, PH / 2);
  g.lineWidth = 3.6;
  g.strokeStyle = INK;
  g.lineJoin = "round";
  g.stroke();
  // Shine tick.
  g.strokeStyle = PAL.white;
  g.lineWidth = 2.6;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0 + 7, y + 4);
  g.lineTo(x0 + Math.min(20, w * 0.25), y + 4);
  g.stroke();
  if (wear > 0) {
    g.strokeStyle = INK;
    g.lineWidth = 2.4;
    g.beginPath();
    const cx = x + (hash(seed, 1) - 0.5) * w * 0.4;
    g.moveTo(cx - 3, y - 0.5);
    g.lineTo(cx + 3, y + 4);
    g.lineTo(cx - 2, y + 8);
    g.lineTo(cx + 4, y + PH + 0.5);
    g.moveTo(cx + 3, y + 4);
    g.lineTo(cx + 10, y + 6);
    g.stroke();
  }
}

/** A coil spring standing on a plank: x = centre, y = plank top, squish 0..1. */
export function drawSpring(g: CanvasRenderingContext2D, x: number, y: number, squish: number): void {
  const h = 17 * (1 - squish * 0.6);
  const top = y - h;
  g.lineCap = "round";
  g.lineJoin = "round";
  const coil = () => {
    g.beginPath();
    g.moveTo(x - 7, y);
    const turns = 4;
    for (let i = 1; i <= turns * 2; i++) g.lineTo(x + (i % 2 ? 8 : -8), y - (h * i) / (turns * 2));
  };
  coil();
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.stroke();
  coil();
  g.strokeStyle = PAL.white;
  g.lineWidth = 2.2;
  g.stroke();
  roundRectPath(g, x - 15, top - 7, 30, 8, 4);
  inkFill(g, PAL.banana, 3, 2.5);
  g.fillStyle = PAL.white;
  g.fillRect(x - 10, top - 5, 6, 2);
}

/** A crumbly chocolate-chip cookie platform seen a little from above: x = centre, y = top. */
export function drawCookie(g: CanvasRenderingContext2D, x: number, y: number, w: number, seed: number): void {
  const rx = w / 2;
  const ry = 7.5;
  const thick = 7;
  const pts = 24;
  const rim = (i: number) => 1 + (hash(i, seed) - 0.5) * 0.1;
  // Silhouette: the top ellipse's upper half, then down the sides and around the bottom rim.
  const outline = (ox: number, oy: number) => {
    g.beginPath();
    for (let i = 0; i <= pts / 2; i++) {
      const a = Math.PI + (i / (pts / 2)) * Math.PI;
      const k = rim(i);
      const px = x + ox + Math.cos(a) * rx * k;
      const py = y + ry + oy + Math.sin(a) * ry * k;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    for (let i = 0; i <= pts / 2; i++) {
      const a = (i / (pts / 2)) * Math.PI;
      const k = rim(i + 40);
      g.lineTo(x + ox + Math.cos(a) * rx * k, y + ry + thick + oy + Math.sin(a) * ry * k);
    }
    g.closePath();
  };
  const top = (ox: number, oy: number) => {
    g.beginPath();
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TAU;
      const k = rim(i < pts / 2 ? i + 40 : i - pts / 2);
      const px = x + ox + Math.cos(a) * rx * k;
      const py = y + ry + oy + Math.sin(a) * ry * k;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  };
  outline(3, 5);
  g.fillStyle = INK;
  g.fill();
  outline(0, 0);
  g.fillStyle = "#B8702A";
  g.fill();
  top(0, 0);
  g.fillStyle = "#F0B463";
  g.fill();
  g.lineWidth = 2.2;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = "#4A2A14";
  for (let i = 0; i < 6; i++) {
    const px = x + (hash(i, seed + 11) - 0.5) * w * 0.72;
    const py = y + ry + (hash(i, seed + 23) - 0.5) * ry * 1.1;
    g.beginPath();
    g.ellipse(px, py, 3.4, 2.4, hash(i, seed) * 3, 0, TAU);
    g.fill();
  }
  g.strokeStyle = PAL.white;
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x - rx * 0.55, y + ry * 0.45);
  g.lineTo(x - rx * 0.3, y + ry * 0.2);
  g.stroke();
  outline(0, 0);
  g.lineWidth = 3.4;
  g.strokeStyle = INK;
  g.lineJoin = "round";
  g.stroke();
}

/** A spiky urchin with an angry face. */
export function drawUrchin(g: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, t: number): void {
  const spikes = 11;
  g.save();
  g.translate(x, y);
  // Spikes (ink-outlined triangles), then the body over their roots.
  const spikePath = (ox: number, oy: number) => {
    g.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a = spin + (i / spikes) * TAU;
      const a0 = a - 0.2;
      const a1 = a + 0.2;
      const len = r * (1.62 + 0.08 * Math.sin(t * 4 + i));
      g.moveTo(ox + Math.cos(a0) * r * 0.8, oy + Math.sin(a0) * r * 0.8);
      g.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len);
      g.lineTo(ox + Math.cos(a1) * r * 0.8, oy + Math.sin(a1) * r * 0.8);
      g.closePath();
    }
  };
  spikePath(3, 4);
  g.fillStyle = INK;
  g.fill();
  spikePath(0, 0);
  g.fillStyle = PAL.white;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.lineJoin = "round";
  g.stroke();
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.save();
  g.clip();
  g.fillStyle = PAL.cobaltShade;
  g.fillRect(-r, -r, r * 2, r * 2);
  g.fillStyle = "#5A3FD8";
  g.beginPath();
  g.arc(-r * 0.18, -r * 0.22, r, 0, TAU);
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.lineWidth = 3.4;
  g.stroke();
  shine(g, -r * 0.45, -r * 0.5, r * 0.18, -0.8);
  // Angry face.
  for (const s of [-1, 1]) {
    g.fillStyle = PAL.white;
    g.beginPath();
    g.ellipse(s * r * 0.36, r * 0.02, r * 0.24, r * 0.26, 0, 0, TAU);
    g.fill();
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(s * r * 0.3, r * 0.08, r * 0.11, 0, TAU);
    g.fill();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(s * r * 0.62, -r * 0.3);
    g.lineTo(s * r * 0.12, -r * 0.12);
    g.stroke();
  }
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(-r * 0.25, r * 0.5);
  g.quadraticCurveTo(0, r * 0.32, r * 0.25, r * 0.5);
  g.stroke();
  g.restore();
}

/** A pair of cherries on a lime stem. */
export function drawCherry(g: CanvasRenderingContext2D, x: number, y: number, t: number, scale = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.rotate(Math.sin(t * 3) * 0.12);
  g.lineCap = "round";
  g.lineJoin = "round";
  // Stems.
  const stems = () => {
    g.beginPath();
    g.moveTo(-6, 2);
    g.quadraticCurveTo(-4, -10, 2, -14);
    g.moveTo(6, 4);
    g.quadraticCurveTo(5, -8, 2, -14);
  };
  stems();
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.stroke();
  stems();
  g.strokeStyle = PAL.lime;
  g.lineWidth = 2;
  g.stroke();
  // Leaf.
  g.beginPath();
  g.ellipse(7, -15, 6, 3, -0.4, 0, TAU);
  inkFill(g, PAL.lime, 2.4, 0);
  for (const [cx, cy] of [
    [-6, 5],
    [6, 7],
  ] as const) {
    g.beginPath();
    g.arc(cx, cy, 7.5, 0, TAU);
    inkFill(g, PAL.tomato, 3, 2.5);
    g.fillStyle = PAL.white;
    g.beginPath();
    g.ellipse(cx - 2.6, cy - 2.6, 2.2, 1.4, -0.7, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Puffs of a cloud as [dx, dy, r] relative to its centre. */
const PUFFS: Array<[number, number, number]> = [
  [-30, 6, 18],
  [-12, -8, 22],
  [12, -12, 24],
  [32, 2, 18],
  [0, 10, 20],
  [-20, 14, 14],
  [20, 14, 15],
];

function puffs(g: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  g.beginPath();
  for (const [dx, dy, r] of PUFFS) {
    g.moveTo(x + dx * k + r * k, y + dy * k);
    g.arc(x + dx * k, y + dy * k, r * k, 0, TAU);
  }
}

/** The grumpy cloud. `charge` 0..1 = how close it is to zapping (it darkens and trembles). */
export function drawGrumpyCloud(g: CanvasRenderingContext2D, x: number, y: number, charge: number, t: number, reduced: boolean): void {
  const tremble = reduced ? 0 : charge * 2.2;
  const jx = x + Math.sin(t * 47) * tremble;
  const jy = y + Math.cos(t * 39) * tremble;
  const body = charge > 0 ? mixHex("#F4F2FF", "#B8B0E2", charge) : "#F4F2FF";
  g.lineJoin = "round";
  puffs(g, jx + 3, jy + 5, 1);
  g.fillStyle = INK;
  g.fill();
  puffs(g, jx, jy, 1);
  g.lineWidth = 7;
  g.strokeStyle = INK;
  g.stroke();
  g.save();
  puffs(g, jx, jy, 1);
  g.clip();
  g.fillStyle = mixHex("#CFC8F0", "#8F86C4", charge);
  g.fillRect(jx - 60, jy - 50, 120, 100);
  puffs(g, jx - 3, jy - 5, 1);
  g.fillStyle = body;
  g.fill();
  g.restore();
  shine(g, jx - 18, jy - 16, 6, -0.5);
  // Grumpy face: furrowed brows, side-eye, a big frown.
  g.strokeStyle = INK;
  g.lineCap = "round";
  for (const s of [-1, 1]) {
    g.fillStyle = PAL.white;
    g.beginPath();
    g.ellipse(jx + s * 11, jy + 2, 6, 5, 0, 0, TAU);
    g.fill();
    g.lineWidth = 2.4;
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(jx + s * 11 + 1.5, jy + 3.5, 2.6, 0, TAU);
    g.fill();
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(jx + s * 19, jy - 7 - charge * 2);
    g.lineTo(jx + s * 5, jy - 3);
    g.stroke();
  }
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(jx - 9, jy + 17);
  g.quadraticCurveTo(jx, jy + 9, jx + 9, jy + 17);
  g.stroke();
}

/** A zig-zag lightning bolt hanging down from (x, y) for `len` units. */
export function drawBolt(g: CanvasRenderingContext2D, x: number, y: number, len: number, seed: number): void {
  const n = 7;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) pts.push([x + (i === 0 || i === n ? 0 : (hash(i, seed) - 0.5) * 22), y + (len * i) / n]);
  g.lineJoin = "miter";
  g.lineCap = "round";
  const line = () => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  };
  line();
  g.strokeStyle = INK;
  g.lineWidth = 11;
  g.stroke();
  line();
  g.strokeStyle = PAL.banana;
  g.lineWidth = 5.5;
  g.stroke();
  line();
  g.strokeStyle = PAL.white;
  g.lineWidth = 1.6;
  g.stroke();
}

/** A soft white backdrop cloud with an ink outline, pre-rendered once. */
export function makeBackdropCloud(scale: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const w = 140 * scale;
  const h = 90 * scale;
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  const x = w / 2;
  const y = h / 2;
  g.lineJoin = "round";
  puffs(g, x, y, scale);
  g.lineWidth = 11 * scale;
  g.strokeStyle = INK;
  g.stroke();
  g.save();
  puffs(g, x, y, scale);
  g.clip();
  g.fillStyle = "#BFCDF6";
  g.fillRect(0, 0, w, h);
  puffs(g, x - 5 * scale, y - 9 * scale, scale);
  g.fillStyle = PAL.white;
  g.fill();
  g.restore();
  return c;
}

/** A spinning star for milestone sparkle. */
export function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, fill: string): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  starPath(g, r);
  inkFill(g, fill, 3, 2.5);
  g.restore();
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (v: number, s: number) => (v >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * Math.max(0, Math.min(1, t)));
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}
