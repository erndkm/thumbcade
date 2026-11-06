/**
 * The doodles, drawn in ballpoint with the odd highlighter fill, and baked into sprites: three boil variants each
 * (the lines redraw on twos), so the frame loop only blits. Every drawing is in page units around its centre and
 * fits roughly inside its footprint radius `s`. Pen weight follows the hole size the doodle belongs to, so whatever
 * you are about to eat is drawn in the same weight on screen.
 */
import { KINDS } from "./catalog.ts";
import { begin, ellipsePts, fillBuf, ink, PAL, pt, shash } from "./ink.ts";
import { TIERS } from "./sim.ts";

export const HI = {
  yellow: "#FFE43A",
  green: "#93E85E",
  pink: "#FF9CCB",
  orange: "#FFB45C",
  blue: "#9CC8F2",
  violet: "#C9A7F2",
  paper: PAL.paper,
} as const;

export const WOOD = "#E9C99B";
export const PAINT = "#E8A13A";
export const STEEL = "#7D838D";

let c: CanvasRenderingContext2D;
let W = 1;
let J = 1;
let STEP = 0;
let SEED = 1;

interface Opt {
  closed?: boolean;
  color?: string;
  /** Line width as a multiple of the pen. */
  w?: number;
  fill?: string;
  fillA?: number;
  passes?: number;
}

function stroke(pts: number[], o: Opt = {}): void {
  begin();
  for (let i = 0; i < pts.length; i += 2) pt(pts[i]!, pts[i + 1]!);
  if (o.fill) fillBuf(c, o.fill, o.fillA ?? 1);
  ink(c, SEED++ * 13 + 1, { width: (o.w ?? 1) * W, jitter: J, step: STEP, color: o.color ?? PAL.ink, closed: o.closed, passes: o.passes });
}

function oval(cx: number, cy: number, rx: number, ry: number, o: Opt & { rot?: number } = {}): void {
  const seed = SEED++ * 13 + 5;
  ellipsePts(cx, cy, rx, ry, seed, 0.12, Math.max(9, Math.min(22, Math.round(((rx + ry) / W) * 0.9))), o.rot ?? 0);
  if (o.fill) fillBuf(c, o.fill, o.fillA ?? 1);
  ink(c, seed, { width: (o.w ?? 1) * W, jitter: J, step: STEP, color: o.color ?? PAL.ink, passes: o.passes });
}

function dot(x: number, y: number, r: number, color: string = PAL.ink): void {
  c.fillStyle = color;
  c.beginPath();
  c.arc(x + shash(SEED, 1, STEP) * J * 0.4, y + shash(SEED, 2, STEP) * J * 0.4, r, 0, Math.PI * 2);
  c.fill();
  SEED++;
}

/** Points along an arc, appended to `out`. */
function arc(out: number[], cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): number[] {
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

const TAU = Math.PI * 2;

type Draw = (s: number) => void;

const DRAW: Record<string, Draw> = {
  crumb(s) {
    oval(-s * 0.3, -s * 0.15, s * 0.5, s * 0.36, { fill: PAL.eraser, color: "#B98A84", w: 0.7, passes: 1, rot: 0.5 });
    oval(s * 0.4, s * 0.3, s * 0.36, s * 0.28, { fill: PAL.eraserGrey, color: "#9D968B", w: 0.7, passes: 1, rot: -0.3 });
  },
  dot(s) {
    oval(0, 0, s * 0.62, s * 0.55, { fill: PAL.inkDeep, color: PAL.inkDeep, w: 0.8 });
    dot(s * 0.8, -s * 0.5, s * 0.16, PAL.inkDeep);
    dot(-s * 0.75, s * 0.55, s * 0.12, PAL.inkDeep);
  },
  shaving(s) {
    // A ruffled curl of pencil wood with the painted rim and a graphite point in the middle.
    const out: number[] = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * TAU;
      const r = s * (0.86 + (i % 2 ? 0.12 : -0.04));
      out.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    stroke(out, { closed: true, fill: WOOD, color: PAINT, w: 1.1 });
    oval(0, 0, s * 0.45, s * 0.45, { color: "#B88A55", w: 0.6, passes: 1 });
    oval(s * 0.05, -s * 0.04, s * 0.17, s * 0.17, { fill: PAL.graphite, color: PAL.graphite, w: 0.6 });
  },
  staple(s) {
    stroke([-s * 0.8, s * 0.4, -s * 0.8, -s * 0.28, 0, -s * 0.3, s * 0.8, -s * 0.28, s * 0.8, s * 0.4], { color: STEEL, w: 1.6 });
    stroke([-s * 0.62, -s * 0.16, s * 0.62, -s * 0.16], { color: "#B9BEC6", w: 0.6, passes: 1 });
  },
  star(s) {
    const out: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * TAU;
      const r = i % 2 ? s * 0.42 : s;
      out.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    stroke(out, { closed: true, fill: HI.yellow, fillA: 0.75 });
  },
  heart(s) {
    const out: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * TAU;
      const x = 16 * Math.sin(t) ** 3;
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      out.push((x / 17) * s, (y / 17) * s + s * 0.05);
    }
    stroke(out, { closed: true, fill: HI.pink, fillA: 0.6, color: PAL.red });
  },
  paperclip(s) {
    const w = s * 0.34;
    const out: number[] = [];
    // Outer loop down the right, round the bottom, up the left, round the top, then the inner loop.
    out.push(w, s * 0.55);
    arc(out, 0, -s * 0.55, w, w, 0, -Math.PI, 8);
    out.push(-w, s * 0.62);
    arc(out, -w * 0.25, s * 0.62, w * 0.75, w * 0.75, Math.PI, 0, 8);
    out.push(w * 0.5, -s * 0.4);
    arc(out, w * 0.05, -s * 0.4, w * 0.45, w * 0.45, 0, -Math.PI, 6);
    out.push(-w * 0.4, s * 0.3);
    stroke(out, { color: STEEL, w: 1.15 });
  },
  button(s) {
    oval(0, 0, s * 0.95, s * 0.95, { fill: HI.blue, fillA: 0.7 });
    oval(0, 0, s * 0.68, s * 0.68, { w: 0.6, passes: 1 });
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) dot(x * s * 0.24, y * s * 0.24, s * 0.11);
    stroke([-s * 0.24, -s * 0.24, s * 0.24, s * 0.24], { w: 0.6, color: PAL.red, passes: 1 });
    stroke([s * 0.24, -s * 0.24, -s * 0.24, s * 0.24], { w: 0.6, color: PAL.red, passes: 1 });
  },
  snail(s) {
    stroke([-s * 0.95, s * 0.55, -s * 0.2, s * 0.62, s * 0.6, s * 0.6, s * 0.95, s * 0.45, s * 0.98, s * 0.1, s * 0.75, s * 0.3], { fill: HI.paper });
    stroke([s * 0.82, s * 0.2, s * 0.72, -s * 0.35]);
    stroke([s * 0.95, s * 0.2, s * 1.0, -s * 0.3]);
    dot(s * 0.72, -s * 0.38, s * 0.08);
    dot(s * 1.0, -s * 0.33, s * 0.08);
    oval(-s * 0.2, -s * 0.02, s * 0.62, s * 0.6, { fill: HI.yellow, fillA: 0.7 });
    const sp: number[] = [];
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * TAU * 2.1;
      const r = s * 0.52 * (1 - i / 32);
      sp.push(-s * 0.2 + Math.cos(-a) * r, -s * 0.02 + Math.sin(-a) * r);
    }
    stroke(sp.reverse(), { w: 0.75, passes: 1 });
  },
  flower(s) {
    stroke([0, s * 0.2, s * 0.05, s * 0.98], { color: "#3E8A3A", w: 1 });
    oval(s * 0.28, s * 0.7, s * 0.24, s * 0.1, { color: "#3E8A3A", w: 0.8, rot: -0.5, fill: HI.green, fillA: 0.7 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      oval(Math.cos(a) * s * 0.42, -s * 0.18 + Math.sin(a) * s * 0.42, s * 0.3, s * 0.2, { rot: a, fill: HI.pink, fillA: 0.65, w: 0.9 });
    }
    oval(0, -s * 0.18, s * 0.2, s * 0.2, { fill: HI.yellow });
  },
  smiley(s) {
    oval(0, 0, s * 0.95, s * 0.95, { fill: HI.yellow, fillA: 0.85 });
    oval(-s * 0.32, -s * 0.22, s * 0.09, s * 0.16, { fill: PAL.ink, w: 0.6, passes: 1 });
    oval(s * 0.32, -s * 0.22, s * 0.09, s * 0.16, { fill: PAL.ink, w: 0.6, passes: 1 });
    stroke(arc([], 0, s * 0.05, s * 0.52, s * 0.45, 0.35, Math.PI - 0.35, 8));
  },
  fish(s) {
    stroke([s * 0.95, 0, s * 0.55, -s * 0.42, -s * 0.15, -s * 0.48, -s * 0.6, -s * 0.1, -s * 0.98, -s * 0.45, -s * 0.85, 0, -s * 0.98, s * 0.45, -s * 0.6, s * 0.1, -s * 0.15, s * 0.48, s * 0.55, s * 0.42], {
      closed: true,
      fill: HI.blue,
      fillA: 0.7,
    });
    dot(s * 0.55, -s * 0.1, s * 0.09);
    stroke(arc([], s * 0.25, 0, s * 0.18, s * 0.34, -1.2, 1.2, 5), { w: 0.7, passes: 1 });
    stroke([-s * 0.05, -s * 0.15, s * 0.05, 0, -s * 0.05, s * 0.15], { w: 0.6, passes: 1 });
  },
  cat(s) {
    // Sitting, seen from the front: body, head with ears, whiskers, a curled tail.
    const tail: number[] = [];
    arc(tail, s * 0.55, s * 0.55, s * 0.4, s * 0.32, Math.PI * 0.5, -Math.PI * 0.4, 8);
    stroke(tail, { w: 1.1 });
    oval(0, s * 0.42, s * 0.55, s * 0.5, { fill: HI.orange, fillA: 0.65 });
    stroke([-s * 0.52, -s * 0.38, -s * 0.48, -s * 0.95, -s * 0.15, -s * 0.62, s * 0.15, -s * 0.62, s * 0.48, -s * 0.95, s * 0.52, -s * 0.38, s * 0.3, -s * 0.08, -s * 0.3, -s * 0.08], { closed: true, fill: HI.orange, fillA: 0.65 });
    dot(-s * 0.2, -s * 0.38, s * 0.07);
    dot(s * 0.2, -s * 0.38, s * 0.07);
    stroke([-s * 0.06, -s * 0.24, 0, -s * 0.2, s * 0.06, -s * 0.24], { w: 0.7, passes: 1 });
    for (const k of [-1, 1]) {
      stroke([k * s * 0.15, -s * 0.22, k * s * 0.62, -s * 0.3], { w: 0.5, passes: 1 });
      stroke([k * s * 0.15, -s * 0.18, k * s * 0.6, -s * 0.12], { w: 0.5, passes: 1 });
    }
    stroke([-s * 0.18, s * 0.6, -s * 0.18, s * 0.9], { w: 0.7, passes: 1 });
    stroke([s * 0.18, s * 0.6, s * 0.18, s * 0.9], { w: 0.7, passes: 1 });
  },
  cupcake(s) {
    stroke([-s * 0.62, s * 0.02, -s * 0.42, s * 0.95, s * 0.42, s * 0.95, s * 0.62, s * 0.02], { closed: true, fill: HI.blue, fillA: 0.6 });
    for (let i = -2; i <= 2; i++) stroke([i * s * 0.2, s * 0.08, i * s * 0.15, s * 0.9], { w: 0.55, passes: 1 });
    const top: number[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI + (i / 14) * Math.PI;
      const bump = 1 + 0.09 * Math.sin(i * 2.1);
      top.push(Math.cos(a) * s * 0.75 * bump, s * 0.02 + Math.sin(a) * s * 0.62 * bump);
    }
    stroke(top, { closed: true, fill: HI.pink, fillA: 0.75 });
    oval(s * 0.05, -s * 0.72, s * 0.17, s * 0.17, { fill: PAL.red, color: PAL.red });
    stroke([s * 0.1, -s * 0.85, s * 0.3, -s * 1.0], { w: 0.6, passes: 1 });
  },
  ghost(s) {
    const out: number[] = [];
    arc(out, 0, -s * 0.15, s * 0.65, s * 0.75, Math.PI, TAU, 10);
    out.push(s * 0.68, s * 0.85);
    for (let i = 0; i <= 4; i++) out.push(s * 0.68 - (i + 0.5) * s * 0.34, s * (i % 2 ? 0.95 : 0.7));
    out.push(-s * 0.68, s * 0.85);
    stroke(out, { closed: true, fill: HI.paper });
    oval(-s * 0.22, -s * 0.25, s * 0.1, s * 0.15, { fill: PAL.ink, w: 0.6, passes: 1 });
    oval(s * 0.22, -s * 0.25, s * 0.1, s * 0.15, { fill: PAL.ink, w: 0.6, passes: 1 });
    oval(0, s * 0.12, s * 0.12, s * 0.16, { w: 0.7, passes: 1 });
  },
  mushroom(s) {
    stroke([-s * 0.28, s * 0.05, -s * 0.33, s * 0.92, s * 0.33, s * 0.92, s * 0.28, s * 0.05], { closed: true, fill: HI.paper });
    const cap: number[] = [];
    arc(cap, 0, s * 0.08, s * 0.95, s * 0.85, Math.PI, TAU, 12);
    stroke(cap, { closed: true, fill: PAL.red, fillA: 0.45, color: PAL.ink });
    oval(-s * 0.4, -s * 0.3, s * 0.15, s * 0.12, { fill: HI.paper, w: 0.6, passes: 1 });
    oval(s * 0.12, -s * 0.52, s * 0.14, s * 0.12, { fill: HI.paper, w: 0.6, passes: 1 });
    oval(s * 0.55, -s * 0.18, s * 0.12, s * 0.1, { fill: HI.paper, w: 0.6, passes: 1 });
  },
  bird(s) {
    oval(-s * 0.05, s * 0.05, s * 0.68, s * 0.55, { fill: HI.yellow, fillA: 0.6 });
    stroke([s * 0.6, -s * 0.12, s * 0.98, 0, s * 0.6, s * 0.12], { fill: HI.orange, closed: true, w: 0.8 });
    dot(s * 0.32, -s * 0.15, s * 0.08);
    stroke(arc([], -s * 0.2, s * 0.05, s * 0.36, s * 0.24, 0.2, Math.PI - 0.1, 6), { w: 0.8 });
    stroke([-s * 0.65, -s * 0.05, -s * 0.98, -s * 0.3, -s * 0.9, s * 0.05], { w: 0.8 });
    stroke([-s * 0.1, s * 0.58, -s * 0.15, s * 0.9], { w: 0.6, passes: 1 });
    stroke([s * 0.12, s * 0.58, s * 0.1, s * 0.9], { w: 0.6, passes: 1 });
  },
  car(s) {
    stroke([-s * 0.98, s * 0.35, -s * 0.98, -s * 0.05, -s * 0.55, -s * 0.12, -s * 0.32, -s * 0.55, s * 0.35, -s * 0.55, s * 0.6, -s * 0.12, s * 0.98, -s * 0.02, s * 0.98, s * 0.35], {
      closed: true,
      fill: HI.yellow,
      fillA: 0.7,
    });
    stroke([-s * 0.25, -s * 0.48, -s * 0.42, -s * 0.12, s * 0.02, -s * 0.12, s * 0.02, -s * 0.48], { closed: true, fill: HI.blue, fillA: 0.6, w: 0.7 });
    stroke([s * 0.12, -s * 0.48, s * 0.12, -s * 0.12, s * 0.5, -s * 0.12, s * 0.32, -s * 0.48], { closed: true, fill: HI.blue, fillA: 0.6, w: 0.7 });
    for (const x of [-0.55, 0.55]) {
      oval(x * s, s * 0.38, s * 0.24, s * 0.24, { fill: PAL.inkDeep, fillA: 0.85 });
      oval(x * s, s * 0.38, s * 0.09, s * 0.09, { fill: HI.paper, w: 0.5, passes: 1 });
    }
    dot(s * 0.88, s * 0.08, s * 0.06, PAL.red);
  },
  bike(s) {
    for (const x of [-0.55, 0.55]) {
      oval(x * s, s * 0.35, s * 0.42, s * 0.42, { w: 0.9 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI + 0.2;
        stroke([x * s - Math.cos(a) * s * 0.38, s * 0.35 - Math.sin(a) * s * 0.38, x * s + Math.cos(a) * s * 0.38, s * 0.35 + Math.sin(a) * s * 0.38], { w: 0.4, passes: 1 });
      }
    }
    stroke([-s * 0.55, s * 0.35, -s * 0.1, -s * 0.15, s * 0.42, -s * 0.15, s * 0.05, s * 0.35, -s * 0.55, s * 0.35], { color: PAL.red, w: 1.1 });
    stroke([s * 0.55, s * 0.35, s * 0.38, -s * 0.38, s * 0.55, -s * 0.5], { color: PAL.red, w: 1.1 });
    stroke([-s * 0.25, -s * 0.3, -s * 0.02, -s * 0.3], { w: 1.4 });
    stroke([-s * 0.12, -s * 0.3, -s * 0.1, -s * 0.15], { w: 0.8 });
  },
  tree(s) {
    stroke([-s * 0.14, s * 0.98, -s * 0.12, s * 0.2, s * 0.12, s * 0.2, s * 0.16, s * 0.98], { closed: true, fill: WOOD, fillA: 0.9 });
    const top: number[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * TAU;
      const r = s * (0.62 + (i % 2 ? 0.1 : -0.02));
      top.push(Math.cos(a) * r * 1.1, -s * 0.28 + Math.sin(a) * r);
    }
    stroke(top, { closed: true, fill: HI.green, fillA: 0.75 });
    stroke(arc([], -s * 0.2, -s * 0.38, s * 0.15, s * 0.1, 0, Math.PI, 4), { w: 0.6, passes: 1 });
    stroke(arc([], s * 0.25, -s * 0.15, s * 0.15, s * 0.1, 0, Math.PI, 4), { w: 0.6, passes: 1 });
    dot(s * 0.35, -s * 0.5, s * 0.07, PAL.red);
    dot(-s * 0.4, -s * 0.12, s * 0.07, PAL.red);
  },
  robot(s) {
    stroke([0, -s * 0.62, 0, -s * 0.9], { w: 0.9 });
    dot(0, -s * 0.95, s * 0.09, PAL.red);
    stroke([-s * 0.42, -s * 0.62, s * 0.42, -s * 0.62, s * 0.42, -s * 0.12, -s * 0.42, -s * 0.12], { closed: true, fill: HI.blue, fillA: 0.6 });
    oval(-s * 0.18, -s * 0.4, s * 0.09, s * 0.09, { fill: HI.yellow, w: 0.6, passes: 1 });
    oval(s * 0.18, -s * 0.4, s * 0.09, s * 0.09, { fill: HI.yellow, w: 0.6, passes: 1 });
    stroke([-s * 0.16, -s * 0.22, s * 0.16, -s * 0.22], { w: 0.6, passes: 1 });
    stroke([-s * 0.52, -s * 0.02, 0, -s * 0.03, s * 0.52, -s * 0.02, s * 0.53, s * 0.3, s * 0.52, s * 0.62, 0, s * 0.63, -s * 0.52, s * 0.62, -s * 0.53, s * 0.3], { closed: true, fill: HI.yellow, fillA: 0.45 });
    dot(-s * 0.15, s * 0.2, s * 0.07, PAL.red);
    dot(s * 0.05, s * 0.2, s * 0.07);
    stroke([-s * 0.52, s * 0.12, -s * 0.9, s * 0.4, -s * 0.85, s * 0.55], { w: 0.9 });
    stroke([s * 0.52, s * 0.12, s * 0.9, -s * 0.15, s * 0.95, -s * 0.3], { w: 0.9 });
    stroke([-s * 0.25, s * 0.62, -s * 0.25, s * 0.95], { w: 0.9 });
    stroke([s * 0.25, s * 0.62, s * 0.25, s * 0.95], { w: 0.9 });
  },
  sailboat(s) {
    stroke([-s * 0.9, s * 0.28, -s * 0.62, s * 0.62, s * 0.62, s * 0.62, s * 0.92, s * 0.28], { closed: true, fill: PAL.red, fillA: 0.4 });
    stroke([0, s * 0.28, 0, -s * 0.95], { w: 1 });
    stroke([s * 0.04, -s * 0.9, s * 0.72, s * 0.16, s * 0.04, s * 0.16], { closed: true, fill: HI.paper });
    stroke([-s * 0.04, -s * 0.7, -s * 0.55, s * 0.16, -s * 0.04, s * 0.16], { closed: true, fill: HI.yellow, fillA: 0.6 });
    const wave: number[] = [];
    for (let i = 0; i <= 12; i++) wave.push(-s + (i / 12) * s * 2, s * 0.8 + Math.sin(i * 1.4) * s * 0.07);
    stroke(wave, { w: 0.7, passes: 1 });
  },
  house(s) {
    stroke([-s * 0.7, -s * 0.05, -s * 0.7, s * 0.9, s * 0.7, s * 0.9, s * 0.7, -s * 0.05], { closed: true, fill: HI.paper });
    stroke([s * 0.38, -s * 0.5, s * 0.38, -s * 0.85, s * 0.56, -s * 0.85, s * 0.56, -s * 0.3], { closed: true, fill: HI.paper, w: 0.9 });
    stroke([-s * 0.85, -s * 0.02, 0, -s * 0.78, s * 0.85, -s * 0.02], { closed: true, fill: PAL.red, fillA: 0.45 });
    stroke([-s * 0.15, s * 0.9, -s * 0.15, s * 0.42, s * 0.15, s * 0.42, s * 0.15, s * 0.9], { fill: WOOD, w: 0.9 });
    dot(s * 0.09, s * 0.66, s * 0.04);
    for (const x of [-0.45, 0.45]) {
      stroke([x * s - s * 0.15, s * 0.12, x * s + s * 0.15, s * 0.12, x * s + s * 0.15, s * 0.4, x * s - s * 0.15, s * 0.4], { closed: true, fill: HI.yellow, fillA: 0.7, w: 0.8 });
      stroke([x * s, s * 0.12, x * s, s * 0.4], { w: 0.5, passes: 1 });
    }
    const smoke: number[] = [];
    for (let i = 0; i <= 10; i++) smoke.push(s * 0.47 + Math.sin(i * 0.9) * s * 0.08, -s * 0.9 - i * s * 0.02);
    stroke(smoke, { w: 0.6, passes: 1, color: PAL.graphite });
  },
  rocket(s) {
    stroke([0, -s * 0.98, s * 0.3, -s * 0.55, s * 0.3, s * 0.45, -s * 0.3, s * 0.45, -s * 0.3, -s * 0.55], { closed: true, fill: HI.paper });
    stroke([-s * 0.3, s * 0.05, -s * 0.62, s * 0.55, -s * 0.3, s * 0.45], { closed: true, fill: PAL.red, fillA: 0.5 });
    stroke([s * 0.3, s * 0.05, s * 0.62, s * 0.55, s * 0.3, s * 0.45], { closed: true, fill: PAL.red, fillA: 0.5 });
    oval(0, -s * 0.25, s * 0.15, s * 0.15, { fill: HI.blue, fillA: 0.8 });
    stroke([-s * 0.18, s * 0.45, 0, s * 0.98, s * 0.18, s * 0.45], { closed: true, fill: HI.orange, color: PAL.red });
    stroke([-s * 0.07, s * 0.5, 0, s * 0.75, s * 0.07, s * 0.5], { fill: HI.yellow, color: HI.yellow, w: 0.5, passes: 1 });
  },
  dino(s) {
    stroke([-s * 0.98, s * 0.22, -s * 0.5, s * 0.1, -s * 0.2, -s * 0.15, s * 0.25, -s * 0.12, s * 0.45, -s * 0.55, s * 0.55, -s * 0.85, s * 0.85, -s * 0.85, s * 0.9, -s * 0.7, s * 0.65, -s * 0.62, s * 0.55, -s * 0.25, s * 0.55, s * 0.45, s * 0.3, s * 0.45, s * 0.25, s * 0.25, -s * 0.15, s * 0.25, -s * 0.2, s * 0.45, -s * 0.42, s * 0.45, -s * 0.45, s * 0.25], {
      closed: true,
      fill: HI.green,
      fillA: 0.7,
    });
    dot(s * 0.7, -s * 0.77, s * 0.05);
    for (const [x, y] of [[-0.05, 0.05], [0.25, 0.12], [-0.3, 0.12], [0.4, -0.3]] as const) oval(x * s, y * s, s * 0.08, s * 0.06, { fill: "#3E8A3A", color: "#3E8A3A", w: 0.4, passes: 1 });
  },
  balloon(s) {
    stroke([-s * 0.25, s * 0.6, -s * 0.2, s * 0.98, s * 0.2, s * 0.98, s * 0.25, s * 0.6], { closed: true, fill: WOOD });
    stroke([-s * 0.5, s * 0.25, -s * 0.24, s * 0.62], { w: 0.5, passes: 1 });
    stroke([s * 0.5, s * 0.25, s * 0.24, s * 0.62], { w: 0.5, passes: 1 });
    oval(0, -s * 0.28, s * 0.72, s * 0.7, { fill: HI.orange, fillA: 0.75 });
    // Meridian stripes down the envelope.
    for (const k of [-0.62, 0, 0.62]) {
      const out: number[] = [];
      for (let i = 0; i <= 8; i++) {
        const lat = -Math.PI / 2 + (i / 8) * Math.PI;
        out.push(k * s * 0.72 * Math.cos(lat), -s * 0.28 + Math.sin(lat) * s * 0.7);
      }
      stroke(out, { w: 0.6, passes: 1, color: PAL.red });
    }
  },
  castle(s) {
    const wall: number[] = [-s * 0.6, s * 0.95, -s * 0.6, -s * 0.15];
    for (let i = 0; i < 5; i++) {
      const x0 = -s * 0.6 + i * s * 0.24;
      wall.push(x0, -s * 0.28, x0 + s * 0.12, -s * 0.28, x0 + s * 0.12, -s * 0.15, x0 + s * 0.24, -s * 0.15);
    }
    wall.push(s * 0.6, s * 0.95);
    stroke(wall, { closed: true, fill: HI.paper });
    for (const x of [-0.75, 0.75]) {
      stroke([x * s - s * 0.2, s * 0.95, x * s - s * 0.2, -s * 0.45, x * s + s * 0.2, -s * 0.45, x * s + s * 0.2, s * 0.95], { closed: true, fill: HI.violet, fillA: 0.5 });
      stroke([x * s - s * 0.26, -s * 0.45, x * s, -s * 0.9, x * s + s * 0.26, -s * 0.45], { closed: true, fill: PAL.red, fillA: 0.45 });
      stroke([x * s, -s * 0.9, x * s, -s * 1.08, x * s + s * 0.18, -s * 1.02, x * s, -s * 0.97], { w: 0.7, color: PAL.red });
      stroke([x * s - s * 0.05, -s * 0.15, x * s - s * 0.05, s * 0.05, x * s + s * 0.05, s * 0.05, x * s + s * 0.05, -s * 0.15], { closed: true, fill: PAL.inkDeep, w: 0.5, passes: 1 });
    }
    stroke(arc([-s * 0.18, s * 0.95], 0, s * 0.55, s * 0.18, s * 0.2, Math.PI, TAU, 6).concat([s * 0.18, s * 0.95]), { fill: WOOD });
    for (let i = 0; i < 3; i++) stroke([-s * 0.45, s * 0.2 + i * s * 0.22, -s * 0.25, s * 0.2 + i * s * 0.22], { w: 0.4, passes: 1, color: PAL.graphite });
  },
  whale(s) {
    stroke([s * 0.95, s * 0.05, s * 0.85, -s * 0.38, s * 0.45, -s * 0.6, -s * 0.15, -s * 0.55, -s * 0.6, -s * 0.25, -s * 0.78, -s * 0.05, -s * 0.98, -s * 0.42, -s * 1.0, -s * 0.1, -s * 0.92, s * 0.15, -s * 0.6, s * 0.3, -s * 0.1, s * 0.5, s * 0.5, s * 0.48], {
      closed: true,
      fill: HI.blue,
      fillA: 0.75,
    });
    stroke([s * 0.95, s * 0.05, s * 0.55, s * 0.18, -s * 0.05, s * 0.2], { w: 0.7, passes: 1 });
    for (let i = 0; i < 4; i++) stroke([s * 0.5 - i * s * 0.15, s * 0.22, s * 0.48 - i * s * 0.15, s * 0.42], { w: 0.4, passes: 1 });
    dot(s * 0.6, -s * 0.15, s * 0.05);
    stroke([s * 0.35, -s * 0.6, s * 0.3, -s * 0.85], { w: 0.7, color: "#5A8BD0" });
    stroke(arc([], s * 0.18, -s * 0.85, s * 0.13, s * 0.1, -Math.PI, 0, 4), { w: 0.6, color: "#5A8BD0", passes: 1 });
    stroke(arc([], s * 0.44, -s * 0.85, s * 0.13, s * 0.1, -Math.PI, 0, 4), { w: 0.6, color: "#5A8BD0", passes: 1 });
  },
  ship(s) {
    stroke([-s * 0.98, -s * 0.05, -s * 0.7, s * 0.55, s * 0.72, s * 0.55, s * 0.98, -s * 0.12, s * 0.5, -s * 0.05, -s * 0.5, -s * 0.05], { closed: true, fill: WOOD });
    for (let i = 0; i < 4; i++) oval(-s * 0.5 + i * s * 0.33, s * 0.2, s * 0.06, s * 0.06, { fill: PAL.inkDeep, w: 0.4, passes: 1 });
    for (const [x, h] of [[-0.3, 0.95], [0.32, 0.8]] as const) {
      stroke([x * s, -s * 0.05, x * s, -h * s], { w: 1 });
      stroke([x * s - s * 0.3, -h * s + s * 0.12, x * s + s * 0.3, -h * s + s * 0.12, x * s + s * 0.26, -s * 0.2, x * s - s * 0.26, -s * 0.2], { closed: true, fill: HI.paper });
    }
    stroke([-s * 0.3, -s * 0.95, -s * 0.05, -s * 0.9, -s * 0.3, -s * 0.84], { fill: PAL.inkDeep, closed: true, w: 0.6 });
    oval(-s * 0.3, -s * 0.55, s * 0.08, s * 0.08, { w: 0.5, passes: 1 });
    const wave: number[] = [];
    for (let i = 0; i <= 14; i++) wave.push(-s + (i / 14) * s * 2, s * 0.68 + Math.sin(i * 1.3) * s * 0.06);
    stroke(wave, { w: 0.7, passes: 1 });
  },
  moon(s) {
    oval(0, 0, s * 0.95, s * 0.95, { fill: HI.yellow, fillA: 0.55 });
    for (const [x, y, r] of [[-0.45, -0.45, 0.16], [0.5, 0.35, 0.2], [0.35, -0.55, 0.1], [-0.55, 0.45, 0.12]] as const)
      oval(x * s, y * s, r * s, r * s * 0.85, { w: 0.6, passes: 1, color: PAL.graphite });
    stroke(arc([], -s * 0.28, -s * 0.08, s * 0.14, s * 0.08, 0.2, Math.PI - 0.2, 5), { w: 0.8 });
    stroke(arc([], s * 0.22, -s * 0.08, s * 0.14, s * 0.08, 0.2, Math.PI - 0.2, 5), { w: 0.8 });
    stroke(arc([], 0, s * 0.18, s * 0.22, s * 0.14, 0.4, Math.PI - 0.4, 6), { w: 0.8 });
    stroke([s * 0.7, -s * 0.72, s * 0.85, -s * 0.72, s * 0.7, -s * 0.6, s * 0.85, -s * 0.6], { w: 0.6, passes: 1, color: PAL.graphite });
  },
  kraken(s) {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * 0.05 + (i / 7) * Math.PI * 0.9;
      const out: number[] = [];
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        const r = s * (0.3 + t * 0.65);
        const aa = a + Math.sin(t * 5 + i) * 0.25 * t;
        out.push(Math.cos(aa) * r, s * 0.05 + Math.sin(aa) * r);
      }
      stroke(out, { w: 2.2, color: "#8E5FC9" });
      stroke(out, { w: 1, color: HI.violet, passes: 1 });
    }
    oval(0, -s * 0.25, s * 0.62, s * 0.62, { fill: HI.violet, fillA: 0.85 });
    oval(-s * 0.22, -s * 0.3, s * 0.15, s * 0.18, { fill: HI.paper });
    oval(s * 0.22, -s * 0.3, s * 0.15, s * 0.18, { fill: HI.paper });
    dot(-s * 0.2, -s * 0.27, s * 0.07);
    dot(s * 0.24, -s * 0.27, s * 0.07);
    for (const [x, y] of [[-0.3, -0.62], [0.05, -0.72], [0.35, -0.6]] as const) oval(x * s, y * s, s * 0.06, s * 0.05, { w: 0.5, passes: 1 });
  },
};

export interface Baked {
  canvas: HTMLCanvasElement;
  /** Half-size in page units (the canvas spans ±half). */
  half: number;
}

/** Pen width (page units) for doodles of a tier: about 1.8 px on screen when the hole is that size. */
export const penFor = (tier: number): number => (1.8 * TIERS[Math.min(tier, TIERS.length - 1)]!.view) / 390;

/** Draws a kind straight onto `ctx` in page units at the origin (for the results card and the icon). */
export function drawKind(ctx: CanvasRenderingContext2D, k: number, step: number, pen?: number): void {
  const kind = KINDS[k]!;
  c = ctx;
  W = pen ?? penFor(kind.tier);
  J = W * 0.5;
  STEP = step;
  SEED = k * 101 + 3;
  DRAW[kind.id]!(kind.s);
}

/** Bakes three boil variants of every kind. `pxPerUnit` is the sharpest scale they are drawn at (zoom × dpr). */
export function bakeKind(k: number, pxPerUnit: number): Baked[] {
  const kind = KINDS[k]!;
  const half = kind.s * 1.3 + penFor(kind.tier) * 2;
  const scale = Math.min(pxPerUnit, 440 / (half * 2));
  const out: Baked[] = [];
  for (let v = 0; v < 3; v++) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.max(4, Math.ceil(half * 2 * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
    drawKind(ctx, k, 900 + v);
    out.push({ canvas, half });
  }
  return out;
}
