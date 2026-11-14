/**
 * Instrument Serif in Node, for the icon (glyphs as paths) and the copy tests (exact advance widths with kerning):
 * the same woff2 files the game ships, read from the kit's font library.
 */
import { readFileSync } from "node:fs";
import { convert } from "fontverter";
import opentype, { type Font } from "opentype.js";

const LIB = new URL("../../_kit/assets/fonts/library/instrument-serif/", import.meta.url);
const cache = new Map<string, Promise<Font>>();

export function loadFont(face: "regular" | "italic"): Promise<Font> {
  let f = cache.get(face);
  if (!f) {
    const file = face === "italic" ? "InstrumentSerif-Italic.woff2" : "InstrumentSerif-Regular.woff2";
    f = convert(readFileSync(new URL(file, LIB)), "truetype").then((ttf) => opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer));
    cache.set(face, f);
  }
  return f;
}

/** Width in CSS px of `text` set at `px` in the given face, kerned the way the canvas sets it. */
export async function measure(text: string, px: number, face: "regular" | "italic" = "italic"): Promise<number> {
  return (await loadFont(face)).getAdvanceWidth(text, px, { kerning: true });
}
