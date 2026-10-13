import type { Insets } from "@thumbcade/sdk";
import { FONT_DISPLAY, FONT_MONO } from "./fonts.ts";

/** Canvas UI pieces shared by the launch games (title, prompt, score, best). */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of a w×h viewport not covered by the feed chrome (plus a margin). */
export function safeRect(insets: Insets, w: number, h: number, margin = 16): Rect {
  const x = insets.left + margin;
  const y = insets.top + margin;
  return { x, y, w: Math.max(0, w - insets.right - margin - x), h: Math.max(0, h - insets.bottom - margin - y) };
}

function spaced(ctx: CanvasRenderingContext2D, px: number): void {
  // letterSpacing is widely supported (Chromium 99+, Safari 17.4+); harmless elsewhere.
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** "TAP TO PLAY" with a breathing pulse and a little bouncing caret. */
export function drawTapPrompt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  color: string,
  label = "TAP TO PLAY",
  size = 14,
): void {
  ctx.save();
  ctx.font = `${size}px ${FONT_MONO}`;
  spaced(ctx, size * 0.18);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const a = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 4.2));
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
  const w = ctx.measureText(label).width;
  const bob = Math.sin(t * 4.2) * 2.5;
  // Two small square "pixels" either side, arcade style.
  const s = Math.max(3, Math.round(size * 0.3));
  ctx.fillRect(x - w / 2 - s * 3 - bob, y - s / 2, s, s);
  ctx.fillRect(x + w / 2 + s * 2 + bob, y - s / 2, s, s);
  ctx.restore();
}

/** Big title in the display face, fit to `maxWidth`. Returns the font size used. */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  color: string,
  maxSize = 56,
  shadow?: string,
): number {
  ctx.save();
  let size = maxSize;
  ctx.font = `900 ${size}px ${FONT_DISPLAY}`;
  spaced(ctx, -size * 0.02);
  const w = ctx.measureText(text).width;
  if (w > maxWidth) {
    size = Math.max(12, Math.floor((size * maxWidth) / w));
    ctx.font = `900 ${size}px ${FONT_DISPLAY}`;
    spaced(ctx, -size * 0.02);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(text, x, y + Math.max(3, size * 0.07));
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  return size;
}

/** Monospace number (score, timer). */
export function drawNumber(
  ctx: CanvasRenderingContext2D,
  value: string | number,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
): void {
  ctx.save();
  ctx.font = `${size}px ${FONT_MONO}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(typeof value === "number" ? value.toLocaleString("en-US") : value, x, y);
  ctx.restore();
}

/** Small uppercase mono label ("BEST 1,204"). */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size = 11,
  align: CanvasTextAlign = "center",
): void {
  ctx.save();
  ctx.font = `${size}px ${FONT_MONO}`;
  spaced(ctx, size * 0.08);
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.restore();
}

/** Rounded rectangle path. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** An odometer-style rolling counter: call `update(dt)` each frame and read `.shown`. */
export class Counter {
  shown = 0;
  constructor(public target = 0, public speed = 14) {}
  set(v: number): void {
    this.target = v;
  }
  snap(v: number): void {
    this.target = this.shown = v;
  }
  update(dt: number): number {
    const d = this.target - this.shown;
    if (Math.abs(d) < 0.5) this.shown = this.target;
    else this.shown += d * (1 - Math.exp(-this.speed * dt));
    return Math.round(this.shown);
  }
}
