/**
 * bitbybit's type: Bricolage Grotesque, two cuts. The condensed extra-bold sets titles and scores in capitals,
 * printed like a gig poster; the medium sets the few small words (prompts, "best"). Letter spacing is drawn
 * glyph by glyph, so it works on every canvas.
 */
import { loadFontFaces } from "@thumbcade-games/kit/font-faces";
import condensedUrl from "@thumbcade-games/kit/assets/fonts/library/bricolage/Bricolage-CondensedExtraBold.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/bricolage/Bricolage-Medium.woff2?url";

export const FAMILY = '"Bricolage", "Avenir Next Condensed", "Helvetica Neue", sans-serif';

export function loadType(): Promise<void> {
  return loadFontFaces([
    { family: "Bricolage", url: condensedUrl, descriptors: { weight: "800" } },
    { family: "Bricolage", url: mediumUrl, descriptors: { weight: "500" } },
  ]);
}

/** Titles and numbers. */
export const display = (px: number) => `800 ${px}px ${FAMILY}`;
/** Small words. */
export const small = (px: number) => `500 ${px}px ${FAMILY}`;

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

/** Draws spaced text with the current fill. `align` 0 = left, 0.5 = centered, 1 = right; y is the alphabetic baseline. */
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
