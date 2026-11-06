import { roundRect } from "@thumbcade-games/kit";

export const PAL = {
  bg: "#0B0F17",
  bgDeep: "#06080D",
  board: "#151B27",
  boardLip: "#080B12",
  slot: "#1B2331",
  slotLine: "#232D3E",
  accent: "#A6F23D",
  accentDeep: "#4E7A14",
  heat: "#FF4A3D",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
} as const;

export interface Tone {
  fill: string;
  lip: string;
  sheen: string;
}

/** Block tones: cut-lime, chalk and a cooler sage, so the board reads as one material in three finishes. */
export const TONES: Tone[] = [
  { fill: "#A6F23D", lip: "#5F9A1A", sheen: "rgba(255,255,255,0.32)" },
  { fill: "#ECEADF", lip: "#9C9A8E", sheen: "rgba(255,255,255,0.55)" },
  { fill: "#7FD8B4", lip: "#3F8A6E", sheen: "rgba(255,255,255,0.3)" },
];

/** Draws one block with its top-left at (x, y), side `s`. */
export function drawBlock(ctx: CanvasRenderingContext2D, tone: Tone, x: number, y: number, s: number): void {
  if (s <= 1) return;
  const r = Math.max(2, s * 0.16);
  const lip = Math.max(2, s * 0.09);
  ctx.fillStyle = tone.lip;
  roundRect(ctx, x, y + lip, s, s - lip, r);
  ctx.fill();
  ctx.fillStyle = tone.fill;
  roundRect(ctx, x, y, s, s - lip, r);
  ctx.fill();
  ctx.fillStyle = tone.sheen;
  roundRect(ctx, x + s * 0.12, y + s * 0.09, s * 0.76, s * 0.13, s * 0.065);
  ctx.fill();
}

/**
 * Pre-rendered block sprites per tone and pixel size, so a full board costs 64 drawImage calls.
 * Sizes are bucketed to whole CSS px.
 */
export class BlockSprites {
  private cache = new Map<string, HTMLCanvasElement>();
  constructor(private dpr: number) {}

  setDpr(dpr: number): void {
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.cache.clear();
    }
  }

  get(tone: number, size: number): HTMLCanvasElement {
    const s = Math.max(2, Math.round(size));
    const key = `${tone}:${s}`;
    let c = this.cache.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = Math.ceil(s * this.dpr);
      const g = c.getContext("2d")!;
      g.scale(this.dpr, this.dpr);
      drawBlock(g, TONES[tone % TONES.length]!, 0, 0, s);
      if (this.cache.size > 64) this.cache.clear();
      this.cache.set(key, c);
    }
    return c;
  }

  /** Draws a block centered at (cx, cy) with side `size` (scaled from the nearest bucket). */
  draw(ctx: CanvasRenderingContext2D, tone: number, cx: number, cy: number, size: number): void {
    if (size <= 1) return;
    const img = this.get(tone, size);
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  }
}
