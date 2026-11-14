/**
 * Draws art/icon.svg (the build renders it to the 1024² icon): a galley slip on quietmoves' paper with two lines set
 * in Instrument Serif and marked up the game's way (FLOOR: rings for the right places, underlines for elsewhere, a
 * stroke for not in it; then PROOF, all rings), and the creator's qm seal. Glyphs are turned into paths, so the SVG
 * needs no fonts.
 *
 *   pnpm --filter @thumbcade-games/galley-proof icon
 */
import { writeFileSync } from "node:fs";
import { RING, RULE, STRUCK, markLine, type Mark } from "../src/marks.ts";
import { loadFont } from "./fonts.ts";

const PAPER = "#F2EBDD";
const INK = "#1E1A17";
const GRAPHITE = "#6F6961";
const PENCIL = "#A79F93";
const SEAL = "#B9432C";
const WALNUT = "#8F6A2F";
const CARD = "#FBF7EE";
const EDGE = "#D9CEB8";

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
  for (let i = 0; i < 150; i++) {
    const x = rand() * 1024;
    const y = rand() * 1024;
    const len = 14 + rand() * 40;
    const a = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * 0.9;
    const mx = x + Math.cos(a) * len * 0.5 + Math.cos(a + Math.PI / 2) * len * bend * 0.3;
    const my = y + Math.sin(a) * len * 0.5 + Math.sin(a + Math.PI / 2) * len * bend * 0.3;
    const light = rand() < 0.6;
    out.push(
      `<path d="M${f1(x)} ${f1(y)} Q${f1(mx)} ${f1(my)} ${f1(x + Math.cos(a) * len)} ${f1(y + Math.sin(a) * len)}" stroke="${light ? "#FFFCF4" : "#60503C"}" stroke-opacity="${(light ? 0.4 + rand() * 0.3 : 0.05 + rand() * 0.05).toFixed(2)}" stroke-width="${f1(1 + rand() * 1.5)}" fill="none" stroke-linecap="round"/>`,
    );
  }
  return out.join("");
}

/** A hand-drawn ring, a little irregular, overshooting its start (like the game's handRing). */
function ring(x: number, y: number, r: number, seed: number): string {
  const a0 = -Math.PI * 0.65 + seed * 1.7;
  const sweep = Math.PI * 2 * 1.07;
  const n = 40;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    const rr = r * (1 + 0.05 * Math.sin(a * 2 + seed * 5) + 0.035 * (i / n));
    pts.push(`${i ? "L" : "M"}${f1(x + Math.cos(a) * rr)} ${f1(y + Math.sin(a) * rr * 0.97)}`);
  }
  const d = pts.join(" ");
  return `<path d="${d}" stroke="${SEAL}" stroke-opacity="0.08" stroke-width="30" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="${SEAL}" stroke-opacity="0.9" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A tapered brush stroke along a quadratic curve (like the game's brushCurve). */
function brush(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, w: number, color: string, alpha: number): string {
  const steps = 24;
  const L: string[] = [];
  const R: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const px = u * u * ax + 2 * u * t * cx + t * t * bx;
    const py = u * u * ay + 2 * u * t * cy + t * t * by;
    let dx = 2 * u * (cx - ax) + 2 * t * (bx - cx);
    let dy = 2 * u * (cy - ay) + 2 * t * (by - cy);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const hw = (w * (0.3 + 0.7 * Math.sin(Math.PI * t) ** 0.65)) / 2;
    L.push(`${f1(px - dy * hw)} ${f1(py + dx * hw)}`);
    R.push(`${f1(px + dy * hw)} ${f1(py - dx * hw)}`);
  }
  return `<path d="M${L.join(" L")} L${R.reverse().join(" L")} Z" fill="${color}" fill-opacity="${alpha}"/>`;
}

/** A slightly wavy hand-ruled line (like handRule). */
function rule(x0: number, x1: number, y: number, w: number, color: string, alpha: number, seed: number): string {
  const n = Math.ceil((x1 - x0) / 10);
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pts.push(`${i ? "L" : "M"}${f1(x)} ${f1(y + Math.sin(x * 0.03 + seed) * 1.6 + Math.sin(x * 0.09 + seed * 3) * 0.7)}`);
  }
  const d = pts.join(" ");
  return `<path d="${d}" stroke="${color}" stroke-opacity="${(0.08 * alpha).toFixed(3)}" stroke-width="${f1(w * 2.2)}" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${color}" stroke-opacity="${(0.88 * alpha).toFixed(3)}" stroke-width="${f1(w)}" fill="none" stroke-linecap="round"/>`;
}

async function main() {
  const regular = await loadFont("regular");
  const italic = await loadFont("italic");
  const rand = mulberry(31);
  const parts: string[] = [`<rect width="1024" height="1024" fill="${PAPER}"/>`, fibres(rand)];

  // The slip, tilted a little, as if just laid on the desk.
  const W = 780;
  const H = 540;
  const x0 = 512 - W / 2;
  const y0 = 470 - H / 2;
  const slip: string[] = [];
  slip.push(`<rect x="${x0 + 6}" y="${y0 + 12}" width="${W}" height="${H}" rx="16" fill="${EDGE}"/>`);
  slip.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="16" fill="${CARD}" stroke="${INK}" stroke-opacity="0.22" stroke-width="3"/>`);
  slip.push(rule(x0 + 40, x0 + W - 40, y0 + 92, 3, INK, 0.45, 2));
  const answer = "proof";
  const lines = ["floor", "proof"];
  const cell = 138;
  const size = 140;
  const cx0 = 512 - cell * 2 + 24;
  lines.forEach((word, k) => {
    const base = y0 + 238 + k * 205;
    const marks: Mark[] = markLine(word, answer);
    // The line's number in the margin, in pencil.
    slip.push(`<path d="${italic.getPath(["i", "ii"][k]!, x0 + 30, base - 4, 46).toPathData(1)}" fill="${PENCIL}"/>`);
    for (let i = 0; i < 5; i++) {
      const x = cx0 + i * cell;
      const ch = word[i]!.toUpperCase();
      const adv = regular.getAdvanceWidth(ch, size);
      const m = marks[i]!;
      slip.push(`<path d="${regular.getPath(ch, x - adv / 2, base, size).toPathData(1)}" fill="${INK}" fill-opacity="${m === STRUCK ? 0.42 : 1}"/>`);
      const mid = base - size * 0.34;
      if (m === RING) slip.push(ring(x, mid, 61, k * 5 + i));
      else if (m === RULE) slip.push(rule(x - 40, x + 40, base + 28, 12, WALNUT, 1, i));
      else slip.push(brush(x - 52, mid + 6, x, mid - 1, x + 52, mid - 7, 11, GRAPHITE, 0.85));
    }
  });
  parts.push(`<g transform="rotate(-4 512 470)">${slip.join("")}</g>`);

  // The qm seal, pressed over the slip's corner: a rough vermilion square with the border and "qm" knocked out.
  const sr = mulberry(9);
  const S = 210;
  const sx = 790 - S / 2;
  const sy = 800 - S / 2;
  const pts: string[] = [];
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const j = (sr() - 0.5) * S * 0.03;
      const nx = -(by - ay) / S;
      const ny = (bx - ax) / S;
      pts.push(`${f1(ax + (bx - ax) * t + nx * j)} ${f1(ay + (by - ay) * t + ny * j)}`);
    }
  };
  const r = S * 0.05;
  edge(sx + r, sy, sx + S - r, sy);
  edge(sx + S, sy + r, sx + S, sy + S - r);
  edge(sx + S - r, sy + S, sx + r, sy + S);
  edge(sx, sy + S - r, sx, sy + r);
  const inset = S * 0.11;
  const qmSize = S * 0.6;
  const qmAdv = italic.getAdvanceWidth("qm", qmSize);
  const knock: string[] = [
    `<rect x="${f1(sx + inset)}" y="${f1(sy + inset)}" width="${f1(S - inset * 2)}" height="${f1(S - inset * 2)}" fill="none" stroke="black" stroke-width="${f1(S * 0.035)}"/>`,
    `<path d="${italic.getPath("qm", sx + S / 2 - qmAdv / 2, sy + S / 2 + qmSize * 0.18, qmSize).toPathData(1)}" fill="black"/>`,
  ];
  for (let i = 0; i < 80; i++) knock.push(`<circle cx="${f1(sx + sr() * S)}" cy="${f1(sy + sr() * S)}" r="${f1(S * (0.003 + sr() * 0.011))}" fill="black" opacity="${(0.3 + sr() * 0.6).toFixed(2)}"/>`);
  for (let i = 0; i < 4; i++) knock.push(`<circle cx="${f1(sx + sr() * S)}" cy="${f1(sy + sr() * S)}" r="${f1(S * (0.12 + sr() * 0.15))}" fill="black" opacity="0.09"/>`);
  parts.push(
    `<mask id="sealmask" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="white"/>${knock.join("")}</mask>`,
    `<g transform="rotate(-6 790 800)"><path d="M${pts.join(" L")} Z" fill="${SEAL}" opacity="0.94" mask="url(#sealmask)"/></g>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n${parts.join("\n")}\n</svg>\n`;
  writeFileSync(new URL("../art/icon.svg", import.meta.url), svg);
  console.log(`art/icon.svg: ${(svg.length / 1024).toFixed(0)} KB`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
