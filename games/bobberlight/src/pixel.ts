import type { Insets } from "@thumbcade/sdk";
import { KEY, PAL } from "./palette.ts";

/**
 * The pixel screen: every frame is drawn into a small canvas (about 130 px wide) and blown up with
 * nearest-neighbour at a whole-number scale, so one art pixel is always a crisp square on the phone.
 */
export interface PixelScreen {
  /** The low-res canvas everything is drawn into. */
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Low-res size in art pixels. */
  readonly w: number;
  readonly h: number;
  /** Device pixels per art pixel. */
  readonly scale: number;
  /** Copies the art canvas to the screen. */
  present(): void;
  /** Client (CSS px) coordinates to art pixels. */
  toArt(x: number, y: number): { x: number; y: number };
  /** CSS px length to art px. */
  artLen(css: number): number;
  /** The rectangle (art px) left free by a set of CSS-px insets. */
  safe(insets: Insets): { x0: number; y0: number; x1: number; y1: number };
  onResize(cb: () => void): void;
}

export function createPixelScreen(opts: { targetWidth?: number; pad?: string } = {}): PixelScreen {
  const target = opts.targetWidth ?? 132;
  const display = document.createElement("canvas");
  display.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;image-rendering:pixelated";
  document.body.appendChild(display);
  const dctx = display.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
  const art = document.createElement("canvas");
  const actx = art.getContext("2d") as CanvasRenderingContext2D;
  const listeners: Array<() => void> = [];
  let dpr = 1;
  let devW = 1;
  let devH = 1;
  let x0 = 0;
  let colX = 0;
  let colW = 1;

  const screen = {
    canvas: art,
    ctx: actx,
    w: 1,
    h: 1,
    scale: 1,
    present() {
      dctx.imageSmoothingEnabled = false;
      if (colW < devW) {
        // A portrait column in a wide window: plain night bars, one-pixel seam.
        dctx.fillStyle = PAL.ink;
        dctx.fillRect(0, 0, devW, devH);
      }
      dctx.drawImage(art, 0, 0, screen.w, screen.h, x0, 0, screen.w * screen.scale, screen.h * screen.scale);
      if (colW < devW) {
        dctx.fillStyle = PAL.ink;
        dctx.fillRect(0, 0, colX, devH);
        dctx.fillRect(colX + colW, 0, devW - colX - colW, devH);
        dctx.fillStyle = PAL.night;
        dctx.fillRect(colX - screen.scale, 0, Math.max(1, Math.floor(screen.scale / 2)), devH);
        dctx.fillRect(colX + colW + Math.ceil(screen.scale / 2), 0, Math.max(1, Math.floor(screen.scale / 2)), devH);
      }
    },
    toArt(x: number, y: number) {
      return { x: (x * dpr - x0) / screen.scale, y: (y * dpr) / screen.scale };
    },
    artLen(css: number) {
      return (css * dpr) / screen.scale;
    },
    safe(i: Insets) {
      const left = Math.max(0, Math.ceil((i.left * dpr - x0) / screen.scale));
      const right = Math.min(screen.w, Math.floor((devW - i.right * dpr - x0) / screen.scale));
      return { x0: left, y0: Math.ceil((i.top * dpr) / screen.scale), x1: right, y1: Math.floor((devH - i.bottom * dpr) / screen.scale) };
    },
    onResize(cb: () => void) {
      listeners.push(cb);
    },
  };

  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    const nW = Math.max(1, Math.round(window.innerWidth * dpr));
    const nH = Math.max(1, Math.round(window.innerHeight * dpr));
    if (nW === devW && nH === devH && display.width === nW) return;
    devW = nW;
    devH = nH;
    display.width = devW;
    display.height = devH;
    // Portrait column: never wider than 3:4.
    colW = Math.min(devW, Math.floor(devH * 0.75));
    colX = Math.floor((devW - colW) / 2);
    const s = Math.max(1, Math.round(colW / target));
    screen.scale = s;
    screen.w = Math.ceil(colW / s);
    screen.h = Math.ceil(devH / s);
    x0 = colX + Math.floor((colW - screen.w * s) / 2);
    art.width = screen.w;
    art.height = screen.h;
    actx.imageSmoothingEnabled = false;
    listeners.forEach((l) => l());
  };
  resize();
  window.addEventListener("resize", resize);
  return screen;
}

// ---------------------------------------------------------------------------------------------
// Sprites: hand-placed pixel maps, one letter per pixel (see palette.ts), `.` transparent.
// ---------------------------------------------------------------------------------------------

const rgbCache = new Map<string, [number, number, number]>();
export function rgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    rgbCache.set(hex, c);
  }
  return c;
}

/** Turns a sprite map into a canvas. `swap` recolors keys (e.g. { r: "t" }). */
export function sprite(rows: readonly string[], swap: Record<string, string> = {}): HTMLCanvasElement {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(c.width, c.height);
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      let ch = row[x]!;
      if (ch === "." || ch === " ") continue;
      ch = swap[ch] ?? ch;
      const hex = KEY[ch];
      if (!hex) continue;
      const [r, gg, b] = rgb(hex);
      const o = (y * c.width + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export const flipRows = (rows: readonly string[]): string[] => rows.map((r) => [...r].reverse().join(""));

/** Exact quarter turn clockwise (square-ish maps stay on the grid). */
export function rotRows(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out: string[] = [];
  for (let x = 0; x < w; x++) {
    let line = "";
    for (let y = h - 1; y >= 0; y--) line += rows[y]![x] ?? ".";
    out.push(line);
  }
  return out;
}

/** Adds a one-pixel outline (key `k` by default) around every opaque pixel. Grows the map by 1 on each side. */
export function outlineRows(rows: readonly string[], key = "k", diagonal = false): string[] {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const at = (x: number, y: number) => {
    const ch = rows[y]?.[x];
    return ch !== undefined && ch !== "." && ch !== " ";
  };
  const out: string[] = [];
  for (let y = -1; y <= h; y++) {
    let line = "";
    for (let x = -1; x <= w; x++) {
      if (at(x, y)) line += rows[y]![x]!;
      else {
        let near = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
        if (diagonal) near ||= at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
        line += near ? key : ".";
      }
    }
    out.push(line);
  }
  return out;
}

/** Draws a canvas at whole-pixel coordinates (centered when asked). */
export function blit(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, center = false): void {
  const dx = center ? Math.round(x - img.width / 2) : Math.round(x);
  const dy = center ? Math.round(y - img.height / 2) : Math.round(y);
  ctx.drawImage(img, dx, dy);
}

/** Bayer 4×4 thresholds (0..15) for ordered dithering. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** True when pixel (x, y) should take the second color at mix level t (0..1). */
export const dither = (x: number, y: number, t: number): boolean => BAYER[(y & 3) * 4 + (x & 3)]! < Math.round(t * 16);

/** A per-pixel painter for backgrounds (writes straight into ImageData). */
export class Painter {
  readonly img: ImageData;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.img = new ImageData(Math.max(1, w), Math.max(1, h));
  }
  set(x: number, y: number, hex: string): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = rgb(hex);
    const o = (y * this.w + x) * 4;
    const d = this.img.data;
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
    d[o + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, hex: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, hex);
  }
  /** Vertical band of two colors mixed by ordered dithering, t going 0→1 from top to bottom. */
  ditherBand(x: number, y: number, w: number, h: number, a: string, b: string, t0 = 0, t1 = 1): void {
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? t1 : t0 + ((t1 - t0) * j) / (h - 1);
      for (let i = 0; i < w; i++) this.set(x + i, y + j, dither(x + i, y + j, t) ? b : a);
    }
  }
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    (c.getContext("2d") as CanvasRenderingContext2D).putImageData(this.img, 0, 0);
    return c;
  }
}

/** Whole-pixel rectangle. */
export function fill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** One-pixel Bresenham line. */
export function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 2000; guard++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** A pixel ellipse outline (midpoint-ish), for ripples. */
export function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string): void {
  cx = Math.round(cx);
  cy = Math.round(cy);
  rx = Math.max(1, Math.round(rx));
  ry = Math.max(1, Math.round(ry));
  ctx.fillStyle = color;
  let lastY = ry;
  for (let x = 0; x <= rx; x++) {
    const y = Math.round(ry * Math.sqrt(Math.max(0, 1 - (x * x) / (rx * rx))));
    for (let yy = y; yy <= Math.max(y, lastY - 1); yy++) {
      ctx.fillRect(cx + x, cy + yy, 1, 1);
      ctx.fillRect(cx - x, cy + yy, 1, 1);
      ctx.fillRect(cx + x, cy - yy, 1, 1);
      ctx.fillRect(cx - x, cy - yy, 1, 1);
    }
    lastY = y;
  }
}
