import { FONT_DISPLAY, roundRect } from "@thumbcade-games/kit";
import { label, rankOf, suitOf } from "./cards.ts";
import { CARD_ASPECT } from "./layout.ts";

export const PAL = {
  bg: "#0B0D18",
  bgDeep: "#05060C",
  felt: "#121528",
  line: "#1F2440",
  accent: "#7A86FF",
  accentDeep: "#343C8F",
  accentHot: "#B7BEFF",
  heat: "#FF4A3D",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
  face: "#F4F1E9",
  faceLip: "#B9B3A6",
  faceEdge: "#DCD6C8",
  red: "#D33A2C",
  ink: "#17161D",
  back: "#1A1F45",
  backLine: "#2A3170",
} as const;

/** Suits 0-3: spade, heart, club, diamond. Red suits are hearts and diamonds; the shape always tells them apart. */
export const SUIT_NAME = ["spades", "hearts", "clubs", "diamonds"] as const;
export const isRed = (card: number): boolean => suitOf(card) % 2 === 1;
export const suitColor = (card: number): string => (isRed(card) ? PAL.red : PAL.ink);

// Our own suit marks, built from circles and straight cuts in a 100 × 100 box (centre 50, 50): chunky enough to
// read at 14 px.
let SUITS: Path2D[] | null = null;
function suits(): Path2D[] {
  if (SUITS) return SUITS;
  const heart = new Path2D();
  heart.arc(30, 36, 22, Math.PI * 0.75, Math.PI * 1.95);
  heart.arc(70, 36, 22, Math.PI * 1.05, Math.PI * 0.25);
  heart.lineTo(50, 92);
  heart.closePath();

  const spade = new Path2D();
  spade.moveTo(50, 6);
  spade.lineTo(82, 44);
  spade.arc(68, 58, 20, -Math.PI * 0.3, Math.PI * 0.75);
  spade.lineTo(56, 70);
  spade.lineTo(66, 94);
  spade.lineTo(34, 94);
  spade.lineTo(44, 70);
  spade.arc(32, 58, 20, Math.PI * 0.25, Math.PI * 1.3);
  spade.closePath();

  const club = new Path2D();
  club.arc(50, 28, 19, 0, Math.PI * 2);
  club.moveTo(47, 56);
  club.arc(28, 58, 19, 0, Math.PI * 2);
  club.moveTo(91, 58);
  club.arc(72, 58, 19, 0, Math.PI * 2);
  club.moveTo(44, 50);
  club.lineTo(56, 50);
  club.lineTo(66, 94);
  club.lineTo(34, 94);
  club.closePath();

  const diamond = new Path2D();
  diamond.moveTo(50, 4);
  diamond.lineTo(86, 50);
  diamond.lineTo(50, 96);
  diamond.lineTo(14, 50);
  diamond.closePath();

  SUITS = [spade, heart, club, diamond];
  return SUITS;
}

/** Draws suit `s` centred at (x, y), `size` px tall. */
export function drawSuit(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, size: number, color: string): void {
  const k = size / 100;
  ctx.save();
  ctx.translate(x - 50 * k, y - 50 * k);
  ctx.scale(k, k);
  ctx.fillStyle = color;
  ctx.fill(suits()[s]!, "nonzero");
  ctx.restore();
}

export { CARD_ASPECT } from "./layout.ts";
/** Share of a card's height that stays visible when the next card in its column covers it. */
export const BAND = 0.4;

/** Card face with its top-left at (0, 0), w × h. */
export function drawFace(g: CanvasRenderingContext2D, card: number, w: number, h: number): void {
  const r = w * 0.12;
  const lip = Math.max(2, h * 0.04);
  g.fillStyle = PAL.faceLip;
  roundRect(g, 0, lip, w, h - lip, r);
  g.fill();
  g.fillStyle = PAL.face;
  roundRect(g, 0, 0, w, h - lip, r);
  g.fill();
  g.strokeStyle = PAL.faceEdge;
  g.lineWidth = Math.max(1, w * 0.015);
  roundRect(g, w * 0.04, w * 0.04, w * 0.92, h - lip - w * 0.08, r * 0.7);
  g.stroke();
  const color = suitColor(card);
  const text = label(card);
  // The rank is the whole game: as big as the band allows, top-left.
  let size = w * (text.length > 1 ? 0.44 : 0.52);
  g.font = `900 ${size}px ${FONT_DISPLAY}`;
  const maxW = w * 0.56;
  const tw = g.measureText(text).width;
  if (tw > maxW) {
    size *= maxW / tw;
    g.font = `900 ${size}px ${FONT_DISPLAY}`;
  }
  g.fillStyle = color;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  (g as unknown as { letterSpacing: string }).letterSpacing = `${-size * 0.04}px`;
  g.fillText(text, w * 0.1, h * BAND * 0.86);
  drawSuit(g, suitOf(card), w * 0.79, h * BAND * 0.5, w * 0.27, color);
  // The body: one big mark, plus a small tag for picture cards so a column of them doesn't read as a wall of letters.
  // Low enough that a covered card (up to 58 % showing, src/layout.ts) shows only its rank and corner suit.
  drawSuit(g, suitOf(card), w * 0.5, h * 0.755, w * 0.44, color);
  if (rankOf(card) >= 10) {
    g.fillStyle = PAL.face;
    g.font = `900 ${w * 0.18}px ${FONT_DISPLAY}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w * 0.5, h * 0.78);
  }
}

/** The back: our own emblem, an up chevron over a down chevron, on navy with accent pinstripes. */
export function drawBack(g: CanvasRenderingContext2D, w: number, h: number): void {
  const r = w * 0.12;
  const lip = Math.max(2, h * 0.04);
  g.fillStyle = "#0E1130";
  roundRect(g, 0, lip, w, h - lip, r);
  g.fill();
  g.fillStyle = PAL.back;
  roundRect(g, 0, 0, w, h - lip, r);
  g.fill();
  g.save();
  roundRect(g, w * 0.07, w * 0.07, w * 0.86, h - lip - w * 0.14, r * 0.6);
  g.clip();
  g.strokeStyle = PAL.backLine;
  g.lineWidth = Math.max(1, w * 0.035);
  for (let x = -h; x < w + h; x += w * 0.16) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + h, h);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = PAL.accent;
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(1, w * 0.025);
  roundRect(g, w * 0.07, w * 0.07, w * 0.86, h - lip - w * 0.14, r * 0.6);
  g.stroke();
  g.globalAlpha = 1;
  const cx = w / 2;
  const cy = (h - lip) / 2;
  const s = w * 0.2;
  g.fillStyle = PAL.accent;
  g.lineJoin = "round";
  for (const dir of [-1, 1]) {
    g.beginPath();
    const y0 = cy + dir * s * 0.75;
    g.moveTo(cx - s, y0 + dir * s * 0.5);
    g.lineTo(cx, y0 - dir * s * 0.5);
    g.lineTo(cx + s, y0 + dir * s * 0.5);
    g.lineTo(cx + s * 0.62, y0 + dir * s * 0.82);
    g.lineTo(cx, y0 - dir * s * 0.02);
    g.lineTo(cx - s * 0.62, y0 + dir * s * 0.82);
    g.closePath();
    g.fill();
  }
}

/**
 * Pre-rendered faces and backs per pixel size, so a full table is a few dozen drawImage calls.
 * Sizes are bucketed to whole CSS px; the cache is dropped when it grows past a few sizes.
 */
export class CardSprites {
  private cache = new Map<string, HTMLCanvasElement>();
  constructor(private dpr: number) {}

  setDpr(dpr: number): void {
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.cache.clear();
    }
  }

  get(card: number, w: number): HTMLCanvasElement {
    const cw = Math.max(8, Math.round(w));
    const key = `${card}:${cw}`;
    let c = this.cache.get(key);
    if (!c) {
      const ch = Math.round(cw * CARD_ASPECT);
      c = document.createElement("canvas");
      c.width = Math.ceil(cw * this.dpr);
      c.height = Math.ceil(ch * this.dpr);
      const g = c.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      if (card < 0) drawBack(g, cw, ch);
      else drawFace(g, card, cw, ch);
      if (this.cache.size > 53 * 4) this.cache.clear();
      this.cache.set(key, c);
    }
    return c;
  }

  /** Draws a card (or the back, card = -1) with its centre at (x, y), width w, rotated by `angle`. */
  draw(ctx: CanvasRenderingContext2D, card: number, x: number, y: number, w: number, angle = 0, alpha = 1): void {
    if (w <= 2 || alpha <= 0) return;
    // Sprites are cached per size; while a card scales in flight, draw the nearest cached width scaled.
    const bucket = w > 40 ? Math.round(w / 6) * 6 : Math.round(w);
    const img = this.get(card, bucket);
    const h = w * CARD_ASPECT;
    ctx.globalAlpha = alpha;
    if (angle) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    ctx.globalAlpha = 1;
  }
}
