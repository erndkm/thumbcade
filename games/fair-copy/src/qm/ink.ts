import { GRAPHITE, INK, PAPER, rgba, SEAL, serif, italic } from "./palette.ts";

/**
 * Pen and ink. Every line is laid twice: a wide, faint bleed into the paper, then the core stroke, so
 * edges read soft at any size without blur filters.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Point on a quadratic curve. */
export function quad(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
}

const TAPER_STEPS = 18;
const lx = new Float32Array(TAPER_STEPS + 1);
const ly = new Float32Array(TAPER_STEPS + 1);
const rx = new Float32Array(TAPER_STEPS + 1);
const ry = new Float32Array(TAPER_STEPS + 1);

function taperPath(ctx: CanvasRenderingContext2D, ax: number, ay: number, cx: number, cy: number, bx: number, by: number, upto: number, w: number): void {
  for (let i = 0; i <= TAPER_STEPS; i++) {
    const t = (upto * i) / TAPER_STEPS;
    const [px, py] = quad(ax, ay, cx, cy, bx, by, t);
    let dx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx);
    let dy = 2 * (1 - t) * (cy - ay) + 2 * t * (by - cy);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // A brush stroke: thin where the pen lands and lifts, full in the middle of the jump.
    const hw = (w * (0.3 + 0.7 * Math.sin(Math.PI * t) ** 0.65)) / 2;
    lx[i] = px - dy * hw;
    ly[i] = py + dx * hw;
    rx[i] = px + dy * hw;
    ry[i] = py - dx * hw;
  }
  ctx.beginPath();
  ctx.moveTo(lx[0]!, ly[0]!);
  for (let i = 1; i <= TAPER_STEPS; i++) ctx.lineTo(lx[i]!, ly[i]!);
  for (let i = TAPER_STEPS; i >= 0; i--) ctx.lineTo(rx[i]!, ry[i]!);
  ctx.closePath();
}

/** A tapered brush stroke along a quadratic curve, drawn from t = 0 to `upto`. */
export function brushCurve(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, cx: number, cy: number, bx: number, by: number,
  upto: number, w: number, color = INK, alpha = 1,
): void {
  if (upto <= 0) return;
  ctx.fillStyle = rgba(color, 0.07 * alpha);
  taperPath(ctx, ax, ay, cx, cy, bx, by, upto, w * 2.6);
  ctx.fill();
  ctx.fillStyle = rgba(color, 0.9 * alpha);
  taperPath(ctx, ax, ay, cx, cy, bx, by, upto, w);
  ctx.fill();
}

/** Strokes the current path as ink: bleed, then core. */
export function inkStroke(ctx: CanvasRenderingContext2D, w: number, color = INK, alpha = 1): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(color, 0.07 * alpha);
  ctx.lineWidth = w + Math.min(w * 1.1, 2.6);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, 0.88 * alpha);
  ctx.lineWidth = w;
  ctx.stroke();
}

/** A hand-drawn ring that draws itself: progress 0..1, slightly irregular, a little overshoot. */
export function handRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, progress: number, seed: number, w = 1.2, color = INK, alpha = 1): void {
  const p = clamp01(progress);
  if (p <= 0) return;
  const a0 = -Math.PI * 0.65 + seed * 1.7;
  const sweep = Math.PI * 2 * 1.07 * p;
  const n = Math.max(6, Math.ceil(28 * p));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    const rr = r * (1 + 0.05 * Math.sin(a * 2 + seed * 5) + 0.035 * (i / n));
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr * 0.97;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  inkStroke(ctx, w, color, alpha);
}

/** A slightly wavy hand-ruled line from (x0, y) to (x1, y), drawn up to `progress`. */
export function handRule(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, progress: number, w = 0.9, color = INK, alpha = 1, seed = 0): void {
  const p = clamp01(progress);
  if (p <= 0) return;
  const len = (x1 - x0) * p;
  const n = Math.max(2, Math.ceil(len / 8));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = x0 + (len * i) / n;
    const yy = y + Math.sin(x * 0.045 + seed) * 0.45 + Math.sin(x * 0.13 + seed * 3) * 0.2;
    if (i === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  inkStroke(ctx, w, color, alpha);
}

// ---------------------------------------------------------------------------
// Smudges: a mistake leaves a soft ink blot that spreads and fades. Never a flash.
// ---------------------------------------------------------------------------

interface Smudge {
  x: number;
  y: number;
  r: number;
  t: number;
  blobs: Array<[number, number, number]>;
}

export class Smudges {
  private list: Smudge[] = [];
  add(x: number, y: number, r: number): void {
    const blobs: Array<[number, number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 0.45;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d, 0.35 + Math.random() * 0.4]);
    }
    blobs.push([0, 0, 0.5]);
    this.list.push({ x, y, r, t: 0, blobs });
    if (this.list.length > 6) this.list.shift();
  }
  update(dt: number): void {
    for (const s of this.list) s.t += dt;
    this.list = this.list.filter((s) => s.t < 1.8);
  }
  clear(): void {
    this.list = [];
  }
  draw(ctx: CanvasRenderingContext2D): void {
    for (const s of this.list) {
      const fade = Math.min(1, s.t / 0.08) * (1 - clamp01((s.t - 0.25) / 1.55)) ** 1.4;
      const spread = 0.75 + 0.35 * easeOut(s.t / 0.9);
      ctx.fillStyle = rgba(INK, 0.075 * fade);
      for (const [bx, by, br] of s.blobs) {
        ctx.beginPath();
        ctx.arc(s.x + bx * s.r * spread, s.y + by * s.r * spread, br * s.r * spread, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The seal: a vermilion chop with a rough edge and starved ink, pressed in on completion.
// ---------------------------------------------------------------------------

export interface Seal {
  canvas: HTMLCanvasElement;
  /** Drawn size of the canvas relative to the stamp's square (the canvas has a margin). */
  box: number;
}

export function makeSeal(text: string, cssSize: number, dpr: number, seed = 3): Seal {
  const pad = 4;
  const size = Math.ceil((cssSize + pad * 2) * dpr);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.scale(dpr, dpr);
  let s = seed * 9301 + 49297;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const S = cssSize;
  // Rough square: each edge wanders a little, corners slightly worn.
  g.beginPath();
  const pts: Array<[number, number]> = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      const j = (rand() - 0.5) * S * 0.022;
      const nx = -(y1 - y0) / S;
      const ny = (x1 - x0) / S;
      pts.push([x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j]);
    }
  };
  const r = S * 0.05;
  edge(pad + r, pad, pad + S - r, pad);
  edge(pad + S, pad + r, pad + S, pad + S - r);
  edge(pad + S - r, pad + S, pad + r, pad + S);
  edge(pad, pad + S - r, pad, pad + r);
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = SEAL;
  g.fill();
  // Knock out an inner border and the text: paper shows through.
  g.globalCompositeOperation = "destination-out";
  g.strokeStyle = "#000";
  g.lineWidth = Math.max(1, S * 0.035);
  const inset = S * 0.11;
  g.strokeRect(pad + inset, pad + inset, S - inset * 2, S - inset * 2);
  g.fillStyle = "#000";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const fs = text.length <= 2 ? S * 0.6 : text.length === 3 ? S * 0.46 : S * 0.38;
  g.font = text === "qm" ? italic(fs * 1.05) : serif(fs);
  g.fillText(text, pad + S / 2, pad + S / 2 + fs * 0.3);
  // Starved ink: specks and a couple of dry streaks.
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.25 + rand() * 0.6;
    g.beginPath();
    g.arc(pad + rand() * S, pad + rand() * S, S * (0.004 + rand() * 0.012), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.18;
  for (let i = 0; i < 3; i++) {
    const y = pad + S * (0.2 + rand() * 0.6);
    g.fillRect(pad + S * rand() * 0.3, y, S * (0.3 + rand() * 0.5), S * 0.012);
  }
  g.globalAlpha = 0.1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(pad + rand() * S, pad + rand() * S, S * (0.12 + rand() * 0.15), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  return { canvas: c, box: (cssSize + pad * 2) / cssSize };
}

/**
 * Draws a seal pressed at (x, y) (its centre). `t` = seconds since the press began. It arrives a little
 * large and pale, settles with weight, and keeps a slight tilt, the way a hand stamps.
 */
export function drawSeal(ctx: CanvasRenderingContext2D, seal: Seal, x: number, y: number, size: number, t: number, reduced: boolean, tilt = -0.07, alpha = 1): void {
  if (t < 0) return;
  const k = reduced ? 1 : easeOut(t / 0.32);
  const scale = reduced ? 1 : 1.32 - 0.32 * k + 0.025 * Math.sin(clamp01((t - 0.32) / 0.22) * Math.PI);
  const a = (reduced ? clamp01(t / 0.4) : clamp01(t / 0.18)) * 0.93 * alpha;
  const box = size * seal.box;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);
  ctx.globalAlpha = a;
  ctx.drawImage(seal.canvas, -box / 2, -box / 2, box, box);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Typography: the title block and the prompt.
// ---------------------------------------------------------------------------

export interface TitleBlock {
  title: string;
  kicker: string;
  dek: string;
}

/** Title size that fits `width` (at most 58 px). */
export function titlePx(ctx: CanvasRenderingContext2D, title: string, width: number): number {
  ctx.font = italic(58);
  const w = ctx.measureText(title).width;
  return Math.max(32, Math.min(58, (58 * width * 0.98) / Math.max(1, w)));
}

/** Height of the title block for a given title size. */
export const titleBlockHeight = (px: number): number => 14 + px * 0.98 + 15 + 35;

/**
 * A puzzle column's head, left-aligned: a small italic kicker, the title in italic, a hairline rule
 * that rules itself in, and a one-line dek. `t` = seconds since it appeared. Returns the y below it.
 */
export function drawTitleBlock(ctx: CanvasRenderingContext2D, b: TitleBlock, x: number, y: number, width: number, t: number, alpha = 1, reduced = false): number {
  const px = titlePx(ctx, b.title, width);
  const fade = (start: number, dur: number) => (reduced ? 1 : easeOut((t - start) / dur)) * alpha;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = rgba(GRAPHITE, fade(0, 0.8));
  ctx.font = italic(15);
  ctx.fillText(b.kicker, x + 1, y + 14);
  const ty = y + 14 + px * 0.98;
  ctx.fillStyle = rgba(INK, fade(0.1, 0.9));
  ctx.font = italic(px);
  ctx.fillText(b.title, x - px * 0.03, ty + (reduced ? 0 : 5 * (1 - easeOut(t / 0.9))));
  const ry = ty + 15;
  handRule(ctx, x, x + width, ry, reduced ? 1 : easeInOut((t - 0.25) / 1.1), 0.8, INK, 0.85 * alpha, 1.3);
  ctx.fillStyle = rgba(GRAPHITE, fade(0.7, 0.9));
  let dek = 17;
  ctx.font = italic(dek);
  const dw = ctx.measureText(b.dek).width;
  if (dw > width) {
    dek = Math.max(13, (dek * width) / dw);
    ctx.font = italic(dek);
  }
  ctx.fillText(b.dek, x + 1, ry + 27);
  return ry + 35;
}

/** "tap to begin", small italic, with a thin ink underline that draws itself, rests, lifts and redraws. */
export function drawPrompt(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, t: number, reduced: boolean, alpha = 1, px = 20): void {
  ctx.font = italic(px);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = rgba(INK, alpha);
  ctx.fillText(text, x, y);
  const w = ctx.measureText(text).width;
  const cycle = 4.6;
  const c = ((t % cycle) + cycle) % cycle;
  let p = 1;
  let a = 1;
  if (!reduced) {
    p = easeInOut(c / 1.2);
    a = c > 3.8 ? 1 - (c - 3.8) / 0.6 : 1;
    if (c > 4.4) a = 0;
  }
  handRule(ctx, x, x + w + 4, y + 7, p, 1.05, INK, a * alpha, 2.1);
}

export { PAPER };

/**
 * Draws runs of text in different faces on one baseline (e.g. italic prose with a roman "b1", whose
 * italic "1" would read as an "l"). Returns the total width.
 */
export function drawRuns(ctx: CanvasRenderingContext2D, runs: Array<[text: string, font: string]>, x: number, y: number, align: "left" | "right" = "left"): number {
  let total = 0;
  const widths = runs.map(([t, f]) => {
    ctx.font = f;
    const w = ctx.measureText(t).width;
    total += w;
    return w;
  });
  let cx = align === "right" ? x - total : x;
  ctx.textAlign = "left";
  runs.forEach(([t, f], i) => {
    ctx.font = f;
    ctx.fillText(t, cx, y);
    cx += widths[i]!;
  });
  return total;
}

/** Italic text at up to `px`, shrunk until it fits `maxWidth`. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, px: number): void {
  ctx.font = italic(px);
  const w = ctx.measureText(text).width;
  if (w > maxWidth) ctx.font = italic(Math.max(11, (px * maxWidth) / w));
  ctx.fillText(text, x, y);
}
