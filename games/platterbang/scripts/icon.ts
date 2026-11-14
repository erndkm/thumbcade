/**
 * Writes art/icon.svg (1024²): `pnpm --filter @thumbcade-games/platterbang icon`.
 * juicefactory's icon family: a sunburst in the game's accent, a halftone dot field, the hero as a die-cut sticker
 * (white border, hard ink shadow). Here: a polka-dot dinner plate hanging from its last peg, eyes wide, mouth open,
 * while the star peg it lost spins away, and a crack is already running through it.
 */
import { writeFileSync } from "node:fs";

const INK = "#16121C";
const JADE = "#14A87D";
const RAY = "#2CC295";
const WHITE = "#FFFFFF";
const BODY = "#FFD3B3";
const WELL = "#FFBC8E";
const TOMATO = "#FF4A38";
const TOMATO_SHADE = "#C9281E";
const BANANA = "#FFD83A";
const BANANA_SHADE = "#F4A51C";

const f = (n: number) => n.toFixed(1);
const out: string[] = [];
const cx = 512;
const cy = 560;

const rays: string[] = [];
for (let i = 0; i < 18; i++) {
  const a0 = (i / 18) * Math.PI * 2 + 0.06;
  const a1 = ((i + 0.5) / 18) * Math.PI * 2 + 0.06;
  rays.push(`<path d="M${cx} ${cy} L${f(cx + Math.cos(a0) * 1300)} ${f(cy + Math.sin(a0) * 1300)} L${f(cx + Math.cos(a1) * 1300)} ${f(cy + Math.sin(a1) * 1300)} Z"/>`);
}
const dots: string[] = [];
for (let row = 0, y = 0; y <= 1044; row++, y = row * 20) {
  for (let x = row % 2 ? 20 : 0; x <= 1044; x += 40) {
    const d = Math.hypot(x - cx, y - cy) / 720;
    const r = Math.max(0, (d - 0.38) * 22);
    if (r > 1.2) dots.push(`<circle cx="${x}" cy="${y}" r="${f(Math.min(16, r))}"/>`);
  }
}

// The plate, hanging a little askew from the peg at its top.
const px = 488;
const py = 590;
const R = 284;
const tilt = -14;
const polka: string[] = [];
for (let y = -R; y <= R; y += 66)
  for (let x = -R + (Math.round(y / 66) % 2 ? 33 : 0); x <= R; x += 66) {
    const d = Math.hypot(x, y);
    if (d > R - 26 || d < 232) continue;
    polka.push(`<circle cx="${f(x)}" cy="${f(y)}" r="11"/>`);
  }
const half: string[] = [];
for (let y = -R; y <= R; y += 18)
  for (let x = -R + (Math.round(y / 18) % 2 ? 9 : 0); x <= R; x += 18) {
    const k = (x + y) / (R * 1.3) - 0.1;
    if (k <= 0 || Math.hypot(x, y) > R) continue;
    half.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(Math.min(7, k * 10))}"/>`);
  }
const crack = "M120 120 L170 150 L150 196 L214 222 L196 268";

// Peg heads.
const star = (r: number) => {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const k = i % 2 === 0 ? r * 1.2 : r * 0.58;
    p.push(`${i ? "L" : "M"}${f(Math.cos(a) * k)} ${f(Math.sin(a) * k)}`);
  }
  return `${p.join(" ")} Z`;
};

out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">`);
out.push(`<defs><clipPath id="plate"><circle cx="0" cy="0" r="${R}"/></clipPath></defs>`);
out.push(`<rect width="1024" height="1024" fill="${JADE}"/>`);
out.push(`<g fill="${RAY}">${rays.join("")}</g>`);
out.push(`<g fill="${WHITE}" opacity="0.35">${dots.join("")}</g>`);

// Swing lines beside the plate.
out.push(`<g fill="none" stroke-linecap="round">`);
for (const [r, a0, a1] of [
  [R + 70, 198, 232],
  [R + 112, 204, 226],
]) {
  const p = (a: number) => `${f(px + Math.cos((a * Math.PI) / 180) * r!)} ${f(py + Math.sin((a * Math.PI) / 180) * r!)}`;
  out.push(`<path d="M${p(a0!)} A${r} ${r} 0 0 1 ${p(a1!)}" stroke="${INK}" stroke-width="34"/><path d="M${p(a0!)} A${r} ${r} 0 0 1 ${p(a1!)}" stroke="${WHITE}" stroke-width="16"/>`);
}
out.push(`</g>`);

out.push(`<g transform="translate(${px} ${py}) rotate(${tilt})">`);
// Hard shadow and die-cut border.
out.push(`<circle cx="22" cy="30" r="${R + 30}" fill="${INK}"/>`);
out.push(`<circle cx="0" cy="0" r="${R + 30}" fill="${WHITE}" stroke="${INK}" stroke-width="14"/>`);
out.push(`<circle cx="0" cy="0" r="${R}" fill="${BODY}" stroke="${INK}" stroke-width="16"/>`);
out.push(`<g clip-path="url(#plate)">`);
out.push(`<circle cx="0" cy="0" r="${R - 72}" fill="${WELL}" stroke="${INK}" stroke-opacity="0.3" stroke-width="8"/>`);
out.push(`<g fill="${WHITE}">${polka.join("")}</g>`);
out.push(`<g fill="${INK}" opacity="0.12">${half.join("")}</g>`);
out.push(`</g>`);
// The crack, inked with a white edge.
out.push(`<path d="${crack}" fill="none" stroke="${WHITE}" stroke-width="22" stroke-linejoin="round" stroke-linecap="round"/><path d="${crack}" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>`);
// Face: eyes wide and looking up at the peg that left, mouth open.
for (const sx of [-1, 1]) {
  const ex = sx * 92;
  out.push(`<ellipse cx="${ex}" cy="-28" rx="62" ry="70" fill="${WHITE}" stroke="${INK}" stroke-width="14"/>`);
  out.push(`<circle cx="${ex + 14}" cy="-50" r="27" fill="${INK}"/><circle cx="${ex + 4}" cy="-61" r="9" fill="${WHITE}"/>`);
  out.push(`<path d="M${ex - sx * 44} -142 L${ex + sx * 34} -118" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>`);
}
out.push(`<ellipse cx="0" cy="96" rx="44" ry="56" fill="#5A1E2A" stroke="${INK}" stroke-width="14"/>`);
out.push(`<ellipse cx="0" cy="124" rx="24" ry="16" fill="#FF7C8C"/>`);
// Its last peg: a red ball at the rim, the pivot.
out.push(`<g transform="translate(-12 ${-R + 64})"><circle cx="8" cy="12" r="50" fill="${INK}"/><circle r="50" fill="${TOMATO}" stroke="${INK}" stroke-width="14"/><circle cx="12" cy="14" r="30" fill="${TOMATO_SHADE}" opacity="0.6"/><circle cx="-4" cy="-4" r="38" fill="${TOMATO}"/><ellipse cx="-18" cy="-20" rx="15" ry="7" transform="rotate(-40 -18 -20)" fill="${WHITE}"/></g>`);
out.push(`</g>`);

// The star peg spinning away, top right, with spin marks.
out.push(`<g transform="translate(818 214) rotate(18)">`);
out.push(`<g fill="none" stroke-linecap="round"><path d="M-118 66 Q-86 30 -76 -12" stroke="${INK}" stroke-width="30"/><path d="M-118 66 Q-86 30 -76 -12" stroke="${WHITE}" stroke-width="13"/>`);
out.push(`<path d="M-62 108 Q-20 92 4 62" stroke="${INK}" stroke-width="30"/><path d="M-62 108 Q-20 92 4 62" stroke="${WHITE}" stroke-width="13"/></g>`);
out.push(`<path d="${star(74)}" transform="translate(12 16)" fill="${INK}"/>`);
out.push(`<path d="${star(74)}" fill="${WHITE}" stroke="${INK}" stroke-width="46" stroke-linejoin="round"/>`);
out.push(`<path d="${star(74)}" fill="${BANANA}" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>`);
out.push(`<path d="${star(40)}" transform="translate(12 14)" fill="${BANANA_SHADE}" opacity="0.6"/>`);
out.push(`<ellipse cx="-22" cy="-30" rx="16" ry="8" transform="rotate(-40 -22 -30)" fill="${WHITE}"/>`);
out.push(`</g>`);
// Little sparks.
for (const [x, y, r] of [
  [690, 120, 20],
  [930, 360, 16],
  [140, 250, 18],
]) {
  out.push(`<path d="${star(r!)}" transform="translate(${x} ${y})" fill="${WHITE}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`);
}
out.push(`</svg>`);
writeFileSync(new URL("../art/icon.svg", import.meta.url), `${out.join("\n")}\n`);
console.log("art/icon.svg written");
