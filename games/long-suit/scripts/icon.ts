/**
 * Draws art/icon.svg (the build renders it to the 1024² icon): three cards laid the game's way on quietmoves'
 * paper (a red seven on a black eight, a black six on the seven), a face-down card under them, and the creator's
 * qm seal. Ranks are Instrument Serif glyphs turned into paths, so the SVG needs no fonts.
 *
 *   pnpm --filter @thumbcade-games/long-suit icon
 */
import { writeFileSync } from "node:fs";
import { CLUB_LOBE_R, CLUB_LOBES, PIP_PATHS } from "../src/art.ts";
import { RANK_NAMES } from "../src/cards.ts";
import { loadFont } from "./fonts.ts";

const PAPER = "#F2EBDD";
const INK = "#1E1A17";
const SEAL = "#B9432C";
const BAIZE = "#5C7F67";
const CARD = "#FBF6EA";
const BACK = "#EEE7D6";

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (n: number) => n.toFixed(1);

/** Paper fibres, light and dark, like the game's paper tile. */
function fibres(rand: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < 120; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const len = 14 + rand() * 40;
    const a = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * 14;
    const x1 = x + Math.cos(a) * len;
    const y1 = y + Math.sin(a) * len;
    const light = rand() < 0.6;
    out.push(
      `<path d="M${f1(x)} ${f1(y)} Q${f1((x + x1) / 2 + bend)} ${f1((y + y1) / 2 - bend)} ${f1(x1)} ${f1(y1)}" stroke="${light ? "#FFFCF4" : "#60503C"}" stroke-opacity="${(light ? 0.4 + rand() * 0.25 : 0.06 + rand() * 0.05).toFixed(2)}" stroke-width="${f1(1 + rand() * 1.6)}" fill="none" stroke-linecap="round"/>`,
    );
  }
  return out.join("");
}

const pip = (suit: number, x: number, y: number, size: number, color: string): string => {
  const lobes = suit === 3 ? CLUB_LOBES.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="${CLUB_LOBE_R}"/>`).join("") : "";
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${f1(size)})" fill="${color}">${lobes}<path d="${PIP_PATHS[suit]}"/></g>`;
};

const W = 336;
const HGT = Math.round(W * 1.38);

async function face(suit: number, rank: number): Promise<string> {
  const font = await loadFont("regular");
  const color = suit === 1 || suit === 2 ? SEAL : INK;
  const px = W * 0.4;
  const glyph = font.getPath(RANK_NAMES[rank]!, W * 0.1, px * 0.8 + 6, px).toPathData(3);
  return (
    `<rect x="6" y="12" width="${W}" height="${HGT}" rx="34" fill="${INK}" fill-opacity="0.14"/>` +
    `<rect width="${W}" height="${HGT}" rx="34" fill="${CARD}" stroke="${INK}" stroke-opacity="0.55" stroke-width="4"/>` +
    `<path d="${glyph}" fill="${color}" fill-rule="evenodd"/>` +
    pip(suit, W - W * 0.2, px * 0.47 + 6, W * 0.26, color) +
    pip(suit, W / 2, HGT * 0.63, W * 0.44, color)
  );
}

function back(): string {
  const m = 34;
  let hatch = "";
  for (let d = -HGT; d < W + HGT; d += 38) hatch += `M${d} 0 L${d + HGT} ${HGT} M${d + HGT} 0 L${d} ${HGT} `;
  return (
    `<rect x="6" y="12" width="${W}" height="${HGT}" rx="34" fill="${INK}" fill-opacity="0.14"/>` +
    `<rect width="${W}" height="${HGT}" rx="34" fill="${BACK}" stroke="${INK}" stroke-opacity="0.55" stroke-width="4"/>` +
    `<clipPath id="in"><rect x="${m}" y="${m}" width="${W - 2 * m}" height="${HGT - 2 * m}" rx="18"/></clipPath>` +
    `<path d="${hatch}" stroke="${BAIZE}" stroke-opacity="0.8" stroke-width="4" fill="none" clip-path="url(#in)"/>` +
    `<rect x="${m}" y="${m}" width="${W - 2 * m}" height="${HGT - 2 * m}" rx="18" fill="none" stroke="${BAIZE}" stroke-width="5"/>`
  );
}

async function main() {
  const italic = await loadFont("italic");
  const rand = mulberry(11);
  const qm = italic.getPath("qm", 0, 0, 96).toPathData(1);
  const at = (x: number, y: number, deg: number, body: string) => `<g transform="translate(${x} ${y}) rotate(${deg})">${body}</g>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n` +
    `<rect width="1024" height="1024" fill="${PAPER}"/>\n${fibres(rand)}\n` +
    at(372, 74, -4, back()) +
    at(364, 150, -2, await face(0, 7)) +
    at(380, 288, 1.5, await face(1, 6)) +
    at(392, 426, 4, await face(3, 5)) +
    // The seal: a vermilion chop, a little askew, the letters left as paper.
    `<g transform="translate(196 800) rotate(-7)"><rect x="-86" y="-86" width="172" height="172" rx="20" fill="${SEAL}"/><path transform="translate(-74 30)" d="${qm}" fill="${PAPER}"/></g>\n` +
    `</svg>\n`;
  writeFileSync(new URL("../art/icon.svg", import.meta.url), svg);
  console.log(`art/icon.svg: ${(svg.length / 1024).toFixed(1)} KB`);
}

void main();
