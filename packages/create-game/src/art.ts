import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import sharp from "sharp";
import { backgroundFor } from "./options.ts";

const fontDir = (file: string) => fileURLToPath(new URL(`../assets/fonts/${file}`, import.meta.url));
let fonts: { display: opentype.Font; mono: opentype.Font } | null = null;
function loadFonts() {
  const parse = (file: string) => {
    const buf = readFileSync(fontDir(file));
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };
  fonts ??= { display: parse("MonaSansDisplayExpanded-Black.ttf"), mono: parse("DepartureMono-Regular.otf") };
  return fonts;
}

/** Text as an SVG path, centered on (cx, baseline), shrunk to fit maxWidth. */
function textPath(font: opentype.Font, text: string, cx: number, baseline: number, size: number, maxWidth: number, tracking = 0): string {
  let s = size;
  const width = (sz: number) => font.getAdvanceWidth(text, sz) + tracking * sz * (text.length - 1);
  while (width(s) > maxWidth && s > 12) s -= 2;
  let x = cx - width(s) / 2;
  let d = "";
  for (const ch of text) {
    d += font.getPath(ch, x, baseline, s).toPathData(2);
    x += font.getAdvanceWidth(ch, s) + tracking * s;
  }
  return d;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "G").slice(0, 1);
  return letters.toUpperCase();
}

/** A 1024×1024 icon: bold accent disc, the game's initials, a dark tone of the accent. Squircle-safe. */
export async function renderIcon(name: string, accent: string): Promise<Buffer> {
  const { display } = loadFonts();
  const bg = backgroundFor(accent);
  const ini = initials(name);
  const letters = textPath(display, ini, 512, ini.length > 1 ? 640 : 680, ini.length > 1 ? 330 : 440, 560);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${bg}"/>
  <g fill="${accent}" opacity="0.10">${Array.from({ length: 8 }, (_, i) => `<circle cx="512" cy="512" r="${120 + i * 70}" fill="none" stroke="${accent}" stroke-width="10"/>`).join("")}</g>
  <circle cx="540" cy="540" r="330" fill="#000000" opacity="0.35"/>
  <circle cx="512" cy="512" r="330" fill="${accent}"/>
  <path d="${letters}" fill="#0D0D10"/>
</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** A 1080×1920 poster: the name big, an accent shape, "tap to play". */
export async function renderPoster(name: string, accent: string): Promise<Buffer> {
  const { display, mono } = loadFonts();
  const bg = backgroundFor(accent);
  const title = textPath(display, name.toUpperCase(), 540, 760, 150, 900, -0.02);
  const prompt = textPath(mono, "TAP TO PLAY", 540, 1480, 46, 700, 0.18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="${bg}"/>
  <circle cx="860" cy="1260" r="520" fill="${accent}" opacity="0.16"/>
  <circle cx="860" cy="1260" r="330" fill="${accent}" opacity="0.9"/>
  <g fill="${accent}" opacity="0.35">${Array.from({ length: 6 }, (_, i) => `<rect x="${120}" y="${980 + i * 40}" width="${260 - i * 36}" height="14" rx="7"/>`).join("")}</g>
  <path d="${title}" fill="${accent}" transform="translate(0 10)" opacity="0.35"/>
  <path d="${title}" fill="#F3F0E8"/>
  <path d="${prompt}" fill="#F3F0E8" opacity="0.75"/>
</svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
