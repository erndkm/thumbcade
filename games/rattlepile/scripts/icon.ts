/**
 * Writes art/icon.svg (1024²): `pnpm --filter @thumbcade-games/rattlepile icon`.
 * juicefactory's icon family: a sunburst in the game's accent, a halftone dot field, and the hero as a die-cut
 * sticker (white border, hard ink shadow). Here: a tilted number block cracking as a marble hits it, more marbles
 * streaking in behind.
 */
import { writeFileSync } from "node:fs";

const INK = "#16121C";
const SKY = "#2F6BFF";
const RAY = "#4A83FF";
const DOT = "#FFFFFF";
const TOMATO = "#FF4A38";
const TOMATO_HI = "#FF8A7C";
const TOMATO_SHADE = "#C9281E";
const BANANA = "#FFD83A";
const BANANA_HI = "#FFEC8A";
const LIME = "#9AE43C";
const LIME_HI = "#C8F57E";
const COBALT_HI = "#7FA4FF";
const WHITE = "#FFFFFF";

const f = (n: number) => n.toFixed(1);
const out: string[] = [];
const cx = 512;
const cy = 540;

const rays = 18;
const rayPaths: string[] = [];
for (let i = 0; i < rays; i++) {
  const a0 = (i / rays) * Math.PI * 2 + 0.08;
  const a1 = ((i + 0.5) / rays) * Math.PI * 2 + 0.08;
  const r = 1200;
  rayPaths.push(`<path d="M${cx} ${cy} L${f(cx + Math.cos(a0) * r)} ${f(cy + Math.sin(a0) * r)} L${f(cx + Math.cos(a1) * r)} ${f(cy + Math.sin(a1) * r)} Z"/>`);
}
const dots: string[] = [];
for (let row = 0, y = 0; y <= 1044; row++, y = row * 20) {
  for (let x = row % 2 ? 20 : 0; x <= 1044; x += 40) {
    const d = Math.hypot(x - cx, y - cy) / 720;
    const r = Math.max(0, (d - 0.38) * 20);
    if (r > 1.2) dots.push(`<circle cx="${x}" cy="${y}" r="${f(Math.min(15, r))}"/>`);
  }
}

out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">`);
out.push(`<rect width="1024" height="1024" fill="${SKY}"/>`);
out.push(`<g fill="${RAY}">${rayPaths.join("")}</g>`);
out.push(`<g fill="${DOT}" opacity="0.28">${dots.join("")}</g>`);

// The block: 480 across, tilted, die-cut with a hard shadow.
const B = 480;
const blockAt = `translate(470 520) rotate(-9)`;
const rect = (inset: number, r: number) => `x="${-B / 2 + inset}" y="${-B / 2 + inset}" width="${B - inset * 2}" height="${B - inset * 2}" rx="${r}"`;
out.push(`<g transform="translate(34 40)"><g transform="${blockAt}"><rect ${rect(-30, 110)} fill="${INK}"/></g></g>`);
out.push(`<g transform="${blockAt}"><rect ${rect(-30, 110)} fill="${WHITE}"/>`);
out.push(`<rect ${rect(0, 84)} fill="${TOMATO}" stroke="${INK}" stroke-width="30" stroke-linejoin="round"/>`);
out.push(`<clipPath id="half"><path d="M${-B / 2} ${-B / 2} L${B / 2} ${-B / 2} L${-B / 2} ${B / 2} Z"/></clipPath>`);
out.push(`<rect ${rect(58, 44)} fill="none" stroke="${TOMATO_SHADE}" stroke-width="26"/>`);
out.push(`<rect ${rect(58, 44)} fill="none" stroke="${TOMATO_HI}" stroke-width="26" clip-path="url(#half)"/>`);
// The number 7, hand-built so no font is needed: white with an ink outline and a hard shadow.
const seven = "M-92 -118 L96 -118 L96 -70 L4 126 L-58 126 L30 -62 L-92 -62 Z";
out.push(`<path d="${seven}" transform="translate(14 16)" fill="${INK}" stroke="${INK}" stroke-width="44" stroke-linejoin="round"/>`);
out.push(`<path d="${seven}" fill="${WHITE}" stroke="${INK}" stroke-width="44" stroke-linejoin="round" paint-order="stroke"/>`);
// Cracks from the corner the marble hit.
out.push(`<path d="M240 -150 L150 -120 L176 -62 L96 -40" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`);
out.push(`<path d="M196 -240 L150 -178 L92 -196" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`);
out.push(`<ellipse cx="-168" cy="-176" rx="34" ry="15" transform="rotate(-38 -168 -176)" fill="${WHITE}"/>`);
out.push(`</g>`);

// Impact burst at the top-right corner.
const burst: string[] = [];
const bx = 748;
const by = 300;
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2 + 0.2;
  const r = i % 2 === 0 ? 150 + (i % 4) * 14 : 84;
  burst.push(`${i === 0 ? "M" : "L"}${f(bx + Math.cos(a) * r)} ${f(by + Math.sin(a) * r)}`);
}
out.push(`<path d="${burst.join(" ")} Z" transform="translate(14 16)" fill="${INK}"/>`);
out.push(`<path d="${burst.join(" ")} Z" fill="${BANANA}" stroke="${INK}" stroke-width="24" stroke-linejoin="round"/>`);

// Marbles: one at the impact, two streaking in from below.
const marble = (x: number, y: number, r: number, fill: string, hi: string) =>
  `<circle cx="${x + 12}" cy="${y + 14}" r="${r + 12}" fill="${INK}"/>` +
  `<circle cx="${x}" cy="${y}" r="${r + 12}" fill="${WHITE}"/>` +
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="22"/>` +
  `<path d="M${x - r * 0.62} ${y + r * 0.34} Q${x} ${y - r * 0.2} ${x + r * 0.62} ${y + r * 0.42}" fill="none" stroke="${hi}" stroke-width="${f(r * 0.3)}" stroke-linecap="round"/>` +
  `<ellipse cx="${f(x - r * 0.36)}" cy="${f(y - r * 0.42)}" rx="${f(r * 0.26)}" ry="${f(r * 0.12)}" transform="rotate(-40 ${f(x - r * 0.36)} ${f(y - r * 0.42)})" fill="${WHITE}"/>`;
for (const [x1, y1, x2, y2] of [[690, 900, 800, 760], [860, 860, 920, 700]] as const) {
  out.push(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${INK}" stroke-width="40" stroke-linecap="round"/>`);
  out.push(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${WHITE}" stroke-width="18" stroke-linecap="round"/>`);
}
out.push(marble(748, 300, 74, COBALT_HI, "#DCE7FF"));
out.push(marble(812, 742, 58, LIME, LIME_HI));
out.push(marble(926, 684, 46, BANANA, BANANA_HI));
out.push(`</svg>`);

writeFileSync(new URL("../art/icon.svg", import.meta.url), out.join("\n") + "\n");
console.log("wrote art/icon.svg");
