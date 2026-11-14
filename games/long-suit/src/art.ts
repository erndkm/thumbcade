/**
 * The pack, drawn in quietmoves' paper and ink: cream cards with a hairline edge, ranks in Instrument Serif, the
 * black suits in ink and the red ones in the seal's vermilion, backs cross-hatched in baize green. Faces are drawn
 * once per size into small canvases and stamped from there.
 */
import { isRed, RANK_NAMES, rankOf, suitOf, type Card } from "./cards.ts";
import { BAIZE, GRAPHITE, INK, PENCIL, rgba, SEAL, serif } from "./qm/palette.ts";

export const CARD_PAPER = "#FBF6EA";
const BACK_PAPER = "#EEE7D6";

/** Suit marks in a unit box centred on the origin. */
const HEART = "M 0 0.44 C -0.52 0.06 -0.5 -0.4 -0.23 -0.4 C -0.09 -0.4 0 -0.3 0 -0.18 C 0 -0.3 0.09 -0.4 0.23 -0.4 C 0.5 -0.4 0.52 0.06 0 0.44 Z";
const DIAMOND = "M 0 -0.47 C 0.1 -0.24 0.22 -0.1 0.36 0 C 0.22 0.1 0.1 0.24 0 0.47 C -0.1 0.24 -0.22 0.1 -0.36 0 C -0.22 -0.1 -0.1 -0.24 0 -0.47 Z";
const SPADE =
  "M 0 -0.46 C 0.1 -0.22 0.47 -0.04 0.47 0.17 C 0.47 0.36 0.2 0.42 0.06 0.23 C 0.07 0.35 0.13 0.42 0.21 0.46 L -0.21 0.46 C -0.13 0.42 -0.07 0.35 -0.06 0.23 C -0.2 0.42 -0.47 0.36 -0.47 0.17 C -0.47 -0.04 -0.1 -0.22 0 -0.46 Z";
const CLUB_STEM = "M -0.05 0.08 C -0.05 0.3 -0.12 0.42 -0.2 0.46 L 0.2 0.46 C 0.12 0.42 0.05 0.3 0.05 0.08 Z";

/** The marks as path data, in suit order (the club's three lobes are circles, drawn separately). */
export const PIP_PATHS = [SPADE, HEART, DIAMOND, CLUB_STEM] as const;
export const CLUB_LOBES = [[0, -0.23], [-0.24, 0.1], [0.24, 0.1]] as const;
export const CLUB_LOBE_R = 0.225;

let paths: Path2D[] | null = null;

/** Draws a suit mark `size` px across, centred on (x, y). */
export function drawPip(ctx: CanvasRenderingContext2D, suit: number, x: number, y: number, size: number, color: string): void {
  paths ??= PIP_PATHS.map((d) => new Path2D(d));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.fillStyle = color;
  if (suit === 3) {
    for (const [cx, cy] of CLUB_LOBES) {
      ctx.beginPath();
      ctx.arc(cx, cy, CLUB_LOBE_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fill(paths[suit]!);
  ctx.restore();
}

export const suitColor = (suit: number): string => (suit === 1 || suit === 2 ? SEAL : INK);

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const cornerOf = (cw: number): number => Math.max(3, cw * 0.09);

/** Size of the rank in a card's corner: as large as the strip of a covered card shows. */
export const indexPx = (cw: number): number => Math.round(cw * 0.4);

function paintFace(ctx: CanvasRenderingContext2D, card: Card, cw: number, ch: number): void {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const color = isRed(card) ? SEAL : INK;
  rounded(ctx, 0.5, 0.5, cw - 1, ch - 1, cornerOf(cw));
  ctx.fillStyle = CARD_PAPER;
  ctx.fill();
  ctx.strokeStyle = rgba(INK, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
  // The corner: rank on the left, a small mark on the right, both inside the strip a covered card shows.
  const px = indexPx(cw);
  ctx.font = serif(px);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  const name = RANK_NAMES[rank]!;
  ctx.fillText(name, cw * (name === "10" ? 0.05 : 0.1), px * 0.8 + 1);
  drawPip(ctx, suit, cw - cw * 0.2, px * 0.47 + 1, cw * 0.26, color);
  // The middle: one large mark; court cards and the ace get a ruled ring round it.
  const cy = ch * 0.63;
  const big = rank === 0 ? cw * 0.56 : cw * 0.44;
  drawPip(ctx, suit, cw / 2, cy, big, color);
  if (rank >= 10) {
    ctx.strokeStyle = rgba(color, 0.7);
    ctx.lineWidth = 1;
    for (let i = 0; i <= rank - 10; i++) {
      ctx.beginPath();
      ctx.arc(cw / 2, cy, cw * (0.34 + i * 0.045), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function paintBack(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
  rounded(ctx, 0.5, 0.5, cw - 1, ch - 1, cornerOf(cw));
  ctx.fillStyle = BACK_PAPER;
  ctx.fill();
  ctx.strokeStyle = rgba(INK, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
  const m = Math.max(3, cw * 0.09);
  ctx.save();
  rounded(ctx, m, m, cw - 2 * m, ch - 2 * m, Math.max(1.5, cornerOf(cw) - m * 0.5));
  ctx.clip();
  ctx.strokeStyle = rgba(BAIZE, 0.8);
  ctx.lineWidth = 1;
  const step = Math.max(4, cw * 0.1);
  ctx.beginPath();
  for (let d = -ch; d < cw + ch; d += step) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + ch, ch);
    ctx.moveTo(d + ch, 0);
    ctx.lineTo(d, ch);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = rgba(BAIZE, 0.95);
  ctx.lineWidth = 1.2;
  rounded(ctx, m, m, cw - 2 * m, ch - 2 * m, Math.max(1.5, cornerOf(cw) - m * 0.5));
  ctx.stroke();
}

const cache = new Map<string, HTMLCanvasElement>();

function sprite(key: string, cw: number, ch: number, dpr: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = Math.ceil(cw * dpr);
  c.height = Math.ceil(ch * dpr);
  const ctx = c.getContext("2d")!;
  ctx.scale(dpr, dpr);
  paint(ctx);
  if (cache.size > 240) cache.clear();
  cache.set(key, c);
  return c;
}

export const faceSprite = (card: Card, cw: number, ch: number, dpr: number): HTMLCanvasElement => sprite(`f${card}|${cw}|${ch}|${dpr}`, cw, ch, dpr, (ctx) => paintFace(ctx, card, cw, ch));
export const backSprite = (cw: number, ch: number, dpr: number): HTMLCanvasElement => sprite(`b|${cw}|${ch}|${dpr}`, cw, ch, dpr, (ctx) => paintBack(ctx, cw, ch));

export interface CardLook {
  up: boolean;
  /** 0-1 through a turn: the card narrows to its edge and opens again on its other side. */
  flip?: number;
  /** Lifted: a deeper shadow. */
  lift?: number;
  alpha?: number;
  /** Sideways shake for a tap that fitted nowhere. */
  dx?: number;
}

/** Stamps a card with its top-left corner at (x, y). */
export function drawCard(ctx: CanvasRenderingContext2D, card: Card, x: number, y: number, cw: number, ch: number, dpr: number, k: CardLook): void {
  const alpha = k.alpha ?? 1;
  if (alpha <= 0.01) return;
  const f = k.flip ?? 1;
  const sx = Math.max(0.04, Math.abs(Math.cos(f * Math.PI)));
  const showUp = f >= 0.5 ? k.up : !k.up;
  const lift = k.lift ?? 0;
  const px = x + (k.dx ?? 0) + (cw * (1 - sx)) / 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(INK, 0.1 + 0.08 * lift);
  rounded(ctx, px + 0.5, y + 1.5 + lift * 3, cw * sx, ch, cornerOf(cw));
  ctx.fill();
  ctx.drawImage(showUp ? faceSprite(card, cw, ch, dpr) : backSprite(cw, ch, dpr), px, y - lift * 2, cw * sx, ch);
  ctx.globalAlpha = 1;
}

/** An empty place for a card: a home pile waiting for its suit, or a column waiting for the pack's top card. */
export function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number, o: { suit?: number; label?: string; turn?: boolean; alpha?: number } = {}): void {
  const a = o.alpha ?? 1;
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = rgba(GRAPHITE, 0.55 * a);
  ctx.lineWidth = 1;
  rounded(ctx, x + 1, y + 1, cw - 2, ch - 2, cornerOf(cw));
  ctx.stroke();
  ctx.restore();
  if (o.suit !== undefined) drawPip(ctx, o.suit, x + cw / 2, y + ch / 2, cw * 0.4, rgba(o.suit === 1 || o.suit === 2 ? SEAL : INK, 0.22 * a));
  if (o.turn) {
    // The pack has run out: an arrow coming round says a tap turns the drawn cards over.
    const r = cw * 0.17;
    const cx = x + cw / 2;
    const cy = y + ch / 2;
    ctx.strokeStyle = rgba(GRAPHITE, 0.8 * a);
    ctx.lineWidth = Math.max(1.2, cw * 0.03);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.35, Math.PI * 1.25);
    ctx.stroke();
    const ax = cx + r * Math.cos(-Math.PI * 0.35);
    const ay = cy + r * Math.sin(-Math.PI * 0.35);
    ctx.beginPath();
    ctx.moveTo(ax - r * 0.5, ay - r * 0.12);
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax + r * 0.08, ay - r * 0.55);
    ctx.stroke();
  }
  if (o.label) {
    ctx.font = serif(Math.round(cw * 0.42));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = rgba(PENCIL, 0.9 * a);
    ctx.fillText(o.label, x + cw / 2, y + ch / 2);
  }
}

/** Forgets every stamped card (the cards changed size). */
export const clearSprites = (): void => cache.clear();
