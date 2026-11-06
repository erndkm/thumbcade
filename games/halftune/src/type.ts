/**
 * bitbybit's type: Bricolage Grotesque, two cuts. The condensed extra-bold sets titles and scores in capitals,
 * printed like a gig poster; the medium sets the few small words (prompts, "best"). Letter spacing is drawn
 * glyph by glyph, so it works on every canvas. The library fonts are subset to ASCII, so the two accented capitals
 * the set list needs (Ü, È) are drawn as their base letter plus a mark.
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

/** Accented capitals drawn as base letter + mark: [base, mark]. */
const ACCENTS: Record<string, [string, "dots" | "grave"]> = { "Ü": ["U", "dots"], "È": ["E", "grave"] };

function sizeOf(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? Number(m[1]) : 16;
}

function glyphWidth(ctx: CanvasRenderingContext2D, font: string, ch: string): number {
  const acc = ACCENTS[ch];
  if (acc) ch = acc[0];
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
    const acc = ACCENTS[ch];
    const gw = glyphWidth(ctx, font, ch);
    if (acc) {
      ctx.fillText(acc[0], cx, y);
      mark(ctx, acc[1], cx + gw / 2, y, sizeOf(font));
    } else ctx.fillText(ch, cx, y);
    cx += gw + track;
  }
  return w;
}

/** A diacritic above a capital whose baseline is y, for a font of `px`. */
function mark(ctx: CanvasRenderingContext2D, kind: "dots" | "grave", x: number, y: number, px: number): void {
  // Bricolage's capitals are about 0.72 em tall: marks sit just above them, centred on the letter.
  const top = y - px * 0.82;
  ctx.beginPath();
  if (kind === "dots") {
    const r = Math.max(1, px * 0.065);
    ctx.arc(x - px * 0.12, top, r, 0, Math.PI * 2);
    ctx.moveTo(x + px * 0.12 + r, top);
    ctx.arc(x + px * 0.12, top, r, 0, Math.PI * 2);
  } else {
    // A grave: a short stroke falling to the right.
    ctx.moveTo(x - px * 0.13, top - px * 0.12);
    ctx.lineTo(x - px * 0.03, top - px * 0.15);
    ctx.lineTo(x + px * 0.11, top + px * 0.03);
    ctx.lineTo(x + px * 0.04, top + px * 0.05);
    ctx.closePath();
  }
  ctx.fill();
}
