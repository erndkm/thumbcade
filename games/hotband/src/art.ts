/**
 * Hotband's look: the level meter of a hi-fi separate at midnight. A brushed-aluminium bezel round a dark
 * panel of LED slots, eight bands wide. Segments are wide bars, not bricks, and they are coloured by how high
 * they sit (green, amber, then the red), never by the piece they came from; pieces read by shape alone.
 */
import { FONT_DISPLAY, FONT_MONO, mix, rgba, roundRect } from "@thumbcade-games/kit";
import { cellsOf, extent } from "./pieces.ts";

export const PAL = {
  bg: "#0B0C0E",
  bgDeep: "#060709",
  panel: "#111317",
  slot: "#181B20",
  slotLine: "#1F232A",
  /** Brushed aluminium: the accent. */
  accent: "#C9C4B8",
  accentHot: "#F4F1E8",
  accentDeep: "#5E5B54",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
  ink: "#0D0D10",
  green: "#3BD88A",
  amber: "#FFB534",
  red: "#FF5345",
  noise: "#474A56",
  noiseDark: "#2C2E37",
} as const;

export const ZONE = [PAL.green, PAL.amber, PAL.red] as const;

export const monoFont = (px: number) => `${Math.round(px)}px ${FONT_MONO}`;
export const displayFont = (px: number) => `900 ${Math.round(px)}px ${FONT_DISPLAY}`;

/** The bar inside a slot. */
export function barRect(x: number, y: number, cw: number, ch: number): { x: number; y: number; w: number; h: number; r: number } {
  const gx = Math.max(1.5, cw * 0.06);
  const gy = Math.max(1.5, ch * 0.16);
  const h = ch - gy * 2;
  return { x: x + gx, y: y + gy, w: cw - gx * 2, h, r: Math.min(5, h * 0.3) };
}

/** A dark LED slot. */
export function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number): void {
  const b = barRect(x, y, cw, ch);
  ctx.fillStyle = PAL.slot;
  roundRect(ctx, b.x, b.y, b.w, b.h, b.r);
  ctx.fill();
}

export interface SegLook {
  color: string;
  /** 0-1 white-hot (just locked, being cut). */
  hot?: number;
  alpha?: number;
  /** Horizontal squeeze about the centre (a cut row closing). */
  sx?: number;
  /** Vertical squash from the bottom (a landing). */
  sy?: number;
}

/** A lit segment: a bar with a sheen along its top edge. */
export function drawSeg(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number, k: SegLook): void {
  const alpha = k.alpha ?? 1;
  const sx = k.sx ?? 1;
  if (alpha <= 0.01 || sx <= 0.02) return;
  const b = barRect(x, y, cw, ch);
  const w = b.w * sx;
  const h = b.h * (k.sy ?? 1);
  const bx = b.x + (b.w - w) / 2;
  const by = b.y + (b.h - h);
  const color = k.hot ? mix(k.color, PAL.accentHot, Math.min(1, k.hot)) : k.color;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  roundRect(ctx, bx, by, w, h, b.r);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.26)";
  roundRect(ctx, bx + 2, by + 1.5, Math.max(0, w - 4), Math.max(1.5, h * 0.22), Math.min(b.r, 2));
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A noise segment: grey, with a broken dash across it so it reads without colour. */
export function drawNoise(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number, alpha = 1, seed = 0): void {
  const b = barRect(x, y, cw, ch);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = PAL.noise;
  roundRect(ctx, b.x, b.y, b.w, b.h, b.r);
  ctx.fill();
  ctx.fillStyle = PAL.noiseDark;
  const dash = b.w / 7;
  const my = b.y + b.h / 2 - 1;
  for (let i = 0; i < 3; i++) ctx.fillRect(b.x + dash * (1 + i * 2) + ((seed + i) % 2) * 1.5, my + (((seed >> i) & 1) ? -2 : 1), dash * 0.9, 2);
  ctx.globalAlpha = 1;
}

/** The outline where a piece would land. */
export function drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number, alpha: number): void {
  const b = barRect(x, y, cw, ch);
  ctx.strokeStyle = rgba(PAL.accent, alpha);
  ctx.lineWidth = 1.5;
  roundRect(ctx, b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5, b.r);
  ctx.stroke();
}

/** A small piece centred in a box (the NEXT window, the icon). */
export function drawMini(ctx: CanvasRenderingContext2D, kind: number, cx: number, cy: number, cw: number, ch: number, color: string): void {
  const e = extent(kind, 0);
  const w = (e.x1 - e.x0 + 1) * cw;
  const h = (e.y1 - e.y0 + 1) * ch;
  for (const [x, y] of cellsOf(kind, 0)) {
    drawSeg(ctx, cx - w / 2 + (x - e.x0) * cw, cy - h / 2 + (y - e.y0) * ch, cw, ch, { color });
  }
}

/** A fingertip for the first-run coach. */
export function drawFinger(ctx: CanvasRenderingContext2D, x: number, y: number, pressed: number, alpha: number): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const r = 15 - pressed * 2.5;
  ctx.fillStyle = rgba(PAL.accentHot, 0.2 + pressed * 0.25);
  ctx.beginPath();
  ctx.arc(x, y, r + 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(PAL.accentHot, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
