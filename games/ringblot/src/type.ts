/**
 * bitbybit's quiet type: lowercase Jost, widely spaced. Light sets the title, the score and the words; medium sets the
 * small numbers that have to read at a glance. Letter spacing is drawn glyph by glyph, so it works on every canvas.
 */
import { loadFontFaces } from "@thumbcade-games/kit/font-faces";
import lightUrl from "@thumbcade-games/kit/assets/fonts/library/jost/Jost-Light.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/jost/Jost-Medium.woff2?url";

export const FAMILY = '"Jost", "Avenir Next", "Helvetica Neue", sans-serif';

export function loadType(): Promise<void> {
  return loadFontFaces([
    { family: "Jost", url: lightUrl, descriptors: { weight: "300" } },
    { family: "Jost", url: mediumUrl, descriptors: { weight: "500" } },
  ]);
}

export const light = (px: number): string => `300 ${Math.round(px * 10) / 10}px ${FAMILY}`;
export const medium = (px: number): string => `500 ${Math.round(px * 10) / 10}px ${FAMILY}`;

const widths = new Map<string, number>();

function glyphWidth(ctx: CanvasRenderingContext2D, font: string, ch: string): number {
  const key = `${font}|${ch}`;
  let w = widths.get(key);
  if (w === undefined) {
    w = ctx.measureText(ch).width;
    // Fonts may still be loading on the first frames; only cache once they're in.
    if (document.fonts.check(font)) widths.set(key, w);
  }
  return w;
}

/** Width of `text` set in `font` with `track` px between glyphs. */
export function spacedWidth(ctx: CanvasRenderingContext2D, text: string, font: string, track: number): number {
  ctx.font = font;
  let w = 0;
  for (const ch of text) w += glyphWidth(ctx, font, ch) + track;
  return Math.max(0, w - track);
}

/** Draws spaced text with the current fill. `align` 0 = left, 0.5 = centred, 1 = right; y is the alphabetic baseline. */
export function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, track: number, align = 0.5): number {
  const w = spacedWidth(ctx, text, font, track);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let cx = x - w * align;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += glyphWidth(ctx, font, ch) + track;
  }
  return w;
}

/** Thousands grouped with a comma. */
export function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
