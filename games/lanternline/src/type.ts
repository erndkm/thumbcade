/** Quiet, widely spaced lowercase type in Jost. Letter spacing is drawn glyph by glyph (works on every canvas). */
import lightUrl from "@thumbcade-games/kit/assets/fonts/library/jost/Jost-Light.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/jost/Jost-Medium.woff2?url";

export const FAMILY = '"Jost", "Avenir Next", "Helvetica Neue", sans-serif';

/**
 * Loads both Jost faces (bundled, same origin). Resolves after at most `timeoutMs` either way.
 * (Kept local: importing the kit's font module would also pull the house fonts into the bundle.)
 */
export async function loadType(timeoutMs = 1500): Promise<void> {
  const faces = [new FontFace("Jost", `url(${lightUrl})`, { weight: "300" }), new FontFace("Jost", `url(${mediumUrl})`, { weight: "500" })];
  const all = Promise.all(
    faces.map(async (f) => {
      try {
        document.fonts.add(await f.load());
      } catch {
        /* fall back to system fonts */
      }
    }),
  ).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

export const light = (px: number) => `300 ${px}px ${FAMILY}`;
export const medium = (px: number) => `500 ${px}px ${FAMILY}`;

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

/** Draws spaced text. `align` 0 = left, 0.5 = centered, 1 = right; y is the alphabetic baseline. */
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
