/**
 * Hand-drawn primitives: every stroke is a wobbly, slightly doubled ballpoint / pencil line.
 *
 * Lines "boil": control points are re-jittered a few times per second (on a fixed step, not per frame), the way
 * hand-drawn animation redraws every line on twos. Jitter is a pure hash of (seed, point, step), so the same step
 * always looks the same and nothing flickers randomly.
 */

export const PAL = {
  paper: "#FBF8EF",
  paperBack: "#E9E2D2",
  rule: "rgba(112,156,214,0.42)",
  margin: "rgba(222,84,84,0.6)",
  ink: "#24419A",
  inkDeep: "#1B2F74",
  graphite: "#62666E",
  red: "#D2332F",
  hiYellow: "#FFE43A",
  hiGreen: "#93E85E",
  eraser: "#E8B4AC",
  eraserGrey: "#C9C2B6",
  coffee: "#8C5C2D",
} as const;

export const FAMILY = "Caveat";
/** Caveat Bold: headings and numbers. */
export const bold = (px: number): string => `700 ${Math.round(px)}px ${FAMILY}, cursive`;
/** Caveat Medium: notes. */
export const hand = (px: number): string => `500 ${Math.round(px)}px ${FAMILY}, cursive`;

/** Deterministic hash of three ints → [0, 1). */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((c | 0) + 0x1b873593, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
/** Signed hash → [-1, 1). */
export const shash = (a: number, b = 0, c = 0): number => hash(a, b, c) * 2 - 1;

/** The global boil clock. `step` advances `fps` times a second; `amp` scales every jitter. */
export const boil = { step: 0, fps: 10, amp: 1 };

export function updateBoil(time: number, reduced: boolean): void {
  boil.fps = reduced ? 4 : 10;
  boil.amp = reduced ? 0.45 : 1;
  boil.step = Math.floor(time * boil.fps);
}

export interface InkOpts {
  color?: string;
  width?: number;
  /** Max point displacement in px. */
  jitter?: number;
  /** 2 = a second, fainter pass (ballpoint going over a line twice). */
  passes?: number;
  alpha?: number;
  closed?: boolean;
  /** Override the boil step (sprites bake one variant per step). */
  step?: number;
}

// One shared point buffer: shapes push points, then ink() draws them. No allocation per frame.
const BUF = new Float32Array(4096);
let n = 0;

export function begin(): void {
  n = 0;
}
export function pt(x: number, y: number): void {
  if (n < BUF.length - 1) {
    BUF[n++] = x;
    BUF[n++] = y;
  }
}

/** Traces the buffered points as a smooth curve through jittered control points. */
function trace(ctx: CanvasRenderingContext2D, seed: number, jitter: number, step: number, closed: boolean): void {
  const count = n >> 1;
  if (count < 2) return;
  const jx = (i: number) => BUF[i * 2]! + shash(seed, i * 2, step) * jitter;
  const jy = (i: number) => BUF[i * 2 + 1]! + shash(seed, i * 2 + 1, step) * jitter;
  ctx.beginPath();
  if (count === 2) {
    ctx.moveTo(jx(0), jy(0));
    ctx.lineTo(jx(1), jy(1));
    return;
  }
  ctx.moveTo(jx(0), jy(0));
  for (let i = 1; i < count - 1; i++) {
    const x = jx(i);
    const y = jy(i);
    const nx = jx(i + 1);
    const ny = jy(i + 1);
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  ctx.lineTo(jx(count - 1), jy(count - 1));
  if (closed) ctx.closePath();
}

/** Strokes the buffered points as ink. */
export function ink(ctx: CanvasRenderingContext2D, seed: number, o: InkOpts = {}): void {
  const step = o.step ?? boil.step;
  const jitter = (o.jitter ?? 1.1) * boil.amp;
  const width = o.width ?? 2;
  ctx.strokeStyle = o.color ?? PAL.ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const a0 = o.alpha ?? 1;
  ctx.globalAlpha = a0 * 0.92;
  ctx.lineWidth = width;
  trace(ctx, seed, jitter, step, !!o.closed);
  ctx.stroke();
  if ((o.passes ?? 2) > 1) {
    ctx.globalAlpha = a0 * 0.42;
    ctx.lineWidth = width * 0.7;
    trace(ctx, seed + 7919, jitter * 1.5, step, !!o.closed);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Fills the buffered points (no jitter on the fill so it never leaks past the outline much). */
export function fillBuf(ctx: CanvasRenderingContext2D, color: string, alpha = 1): void {
  const count = n >> 1;
  if (count < 3) return;
  ctx.beginPath();
  ctx.moveTo(BUF[0]!, BUF[1]!);
  for (let i = 1; i < count; i++) ctx.lineTo(BUF[i * 2]!, BUF[i * 2 + 1]!);
  ctx.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A hand-drawn straight line: bowed a little, with a mid point that wobbles. */
export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, seed: number, o: InkOpts = {}): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = shash(seed, 99) * Math.min(3, len * 0.03);
  const segs = len > 60 ? 4 : len > 20 ? 3 : 2;
  begin();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const b = Math.sin(t * Math.PI) * bow;
    pt(x1 + dx * t + nx * b, y1 + dy * t + ny * b);
  }
  ink(ctx, seed, o);
}

/**
 * A hand-drawn ellipse: a slightly lumpy loop that overshoots its start (the pen never lands exactly where it
 * began).
 */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, seed: number, overshoot = 0.12, points = 12, rot = 0): void {
  begin();
  const a0 = hash(seed, 3) * Math.PI * 2;
  const total = Math.PI * 2 * (1 + overshoot);
  const steps = Math.max(6, Math.round(points * (1 + overshoot)));
  const ph1 = hash(seed, 5) * 6.28;
  const ph2 = hash(seed, 6) * 6.28;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = a0 + total * t;
    // Lumps + a slight spiral so the end sits just outside the start.
    const k = 1 + 0.035 * Math.sin(a * 2 + ph1) + 0.025 * Math.sin(a * 3 + ph2) + (t - 0.5) * 0.06 * overshoot * 6;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    pt(cx + x * cr - y * sr, cy + x * sr + y * cr);
  }
}

export function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed: number, o: InkOpts = {}): void {
  ellipsePts(cx, cy, rx, ry, seed, 0.14, Math.max(9, Math.min(20, Math.round((rx + ry) / 3.2))));
  ink(ctx, seed, o);
}

/**
 * Partial ellipse for draw-on animations (`progress` 0-1 of the loop). Used by the red-pen score circle.
 */
export function ellipseProgress(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  progress: number,
  o: InkOpts = {},
): void {
  ellipsePts(cx, cy, rx, ry, seed, 0.22, 18, shash(seed, 8) * 0.12);
  const keep = Math.max(2, Math.round((n >> 1) * Math.min(1, progress)));
  n = keep * 2;
  ink(ctx, seed, o);
}

/**
 * Hatching: parallel strokes at `angle`, `gap` px apart, clipped to the current path set by `clip`.
 * Each stroke is a slightly wobbly line; ends overshoot the shape the way quick hatching does (the clip trims them).
 */
export function hatch(
  ctx: CanvasRenderingContext2D,
  clip: () => void,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  angle: number,
  gap: number,
  seed: number,
  o: InkOpts = {},
): void {
  ctx.save();
  clip();
  ctx.clip();
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const r = Math.hypot(bw, bh) / 2 + 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let i = 0;
  for (let d = -r; d <= r; d += gap) {
    const jj = shash(seed, i, 1) * gap * 0.25;
    const ox = cx - s * (d + jj);
    const oy = cy + c * (d + jj);
    line(ctx, ox - c * r, oy - s * r, ox + c * r, oy + s * r, seed + i * 31, { passes: 1, jitter: 0.6, width: 1, ...o });
    i++;
  }
  ctx.restore();
}

/**
 * A highlighter scribble across a box: three or four broad, flat, translucent zig-zag strokes, multiply-blended so
 * the ink and the rules show through.
 */
export function highlight(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, color: string, alpha = 0.55): void {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  const rows = Math.max(1, Math.round(h / 12));
  ctx.lineWidth = (h / rows) * 1.25;
  ctx.beginPath();
  for (let i = 0; i < rows; i++) {
    const yy = y + (i + 0.5) * (h / rows) + shash(seed, i) * 1.5;
    const xa = x + shash(seed, i, 2) * 3;
    const xb = x + w + shash(seed, i, 3) * 4;
    if (i % 2 === 0) {
      ctx.moveTo(xa, yy);
      ctx.lineTo(xb, yy + shash(seed, i, 4) * 2);
    } else {
      ctx.moveTo(xb, yy);
      ctx.lineTo(xa, yy + shash(seed, i, 4) * 2);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

/** Handwritten text: each boil step tilts and nudges it a hair. */
export function write(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  seed: number,
  o: { align?: CanvasTextAlign; rot?: number; alpha?: number; wobble?: number; step?: number } = {},
): void {
  const step = o.step ?? boil.step;
  const wob = (o.wobble ?? 1) * boil.amp;
  ctx.save();
  ctx.translate(x + shash(seed, 1, step) * 0.7 * wob, y + shash(seed, 2, step) * 0.7 * wob);
  ctx.rotate((o.rot ?? 0) + shash(seed, 3, step) * 0.012 * wob);
  ctx.font = font;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** A doodled arrow (shaft + two head strokes) from (x1,y1) to (x2,y2), optionally curved by `bend` px. */
export function doodleArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bend: number,
  seed: number,
  o: InkOpts & { head?: number; progress?: number } = {},
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const progress = o.progress ?? 1;
  const segs = 8;
  begin();
  let ex = x1;
  let ey = y1;
  let px = x1;
  let py = y1;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * progress;
    const b = Math.sin(t * Math.PI) * bend;
    px = ex;
    py = ey;
    ex = x1 + dx * t + nx * b;
    ey = y1 + dy * t + ny * b;
    pt(ex, ey);
  }
  ink(ctx, seed, o);
  if (progress < 0.98) return;
  const a = Math.atan2(ey - py, ex - px);
  const h = o.head ?? 12;
  line(ctx, ex, ey, ex - Math.cos(a - 0.5) * h, ey - Math.sin(a - 0.5) * h, seed + 3, { ...o, passes: 1 });
  line(ctx, ex, ey, ex - Math.cos(a + 0.5) * h, ey - Math.sin(a + 0.5) * h, seed + 5, { ...o, passes: 1 });
}

/** A prerendered drawing: `canvas` at `scale` device px per CSS px, anchored at its center. */
export interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  scale: number;
}

export function makeSprite(w: number, h: number, scale: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(scale, 0, 0, scale, (w * scale) / 2, (h * scale) / 2);
  draw(ctx);
  return { canvas, w, h, scale };
}

/** Draws a sprite centered at (x, y), scaled by `k`, rotated by `rot`. */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, k = 1, rot = 0, alpha = 1): void {
  ctx.globalAlpha = alpha;
  if (rot === 0) {
    ctx.drawImage(s.canvas, x - (s.w * k) / 2, y - (s.h * k) / 2, s.w * k, s.h * k);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(s.canvas, (-s.w * k) / 2, (-s.h * k) / 2, s.w * k, s.h * k);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
