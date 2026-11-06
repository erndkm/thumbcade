/**
 * Writes art/icon.svg (1024²): `pnpm --filter @thumbcade-games/lintstorm icon`.
 * juicefactory's icon family: a sunburst in the game's accent, a halftone dot field, and the hero as a die-cut
 * sticker (white border, hard ink shadow). Here: the steam iron blasting up at a sock, cord and plug trailing.
 */
import { writeFileSync } from "node:fs";

const INK = "#16121C";
const SKY = "#B13DFF";
const RAY = "#C266FF";
const DOT = "#FFD83A";
const TOMATO = "#FF4A38";
const TOMATO_SHADE = "#C9281E";
const STEEL = "#E8EBF4";
const STEEL_SHADE = "#AEB4C8";
const CREAM = "#FFF5D8";
const BANANA = "#FFD83A";
const BANANA_SHADE = "#F4A51C";
const COBALT = "#2F5CFF";
const WHITE = "#FFFFFF";

const f = (n: number) => n.toFixed(1);
const out: string[] = [];
const cx = 512;
const cy = 560;

// Sunburst.
const rays = 18;
const rayPaths: string[] = [];
for (let i = 0; i < rays; i++) {
  const a0 = (i / rays) * Math.PI * 2 + 0.08;
  const a1 = ((i + 0.5) / rays) * Math.PI * 2 + 0.08;
  const r = 1200;
  rayPaths.push(`<path d="M${cx} ${cy} L${f(cx + Math.cos(a0) * r)} ${f(cy + Math.sin(a0) * r)} L${f(cx + Math.cos(a1) * r)} ${f(cy + Math.sin(a1) * r)} Z"/>`);
}

// Halftone: dots on a 45° grid, bigger toward the corners.
const dots: string[] = [];
for (let row = 0, y = 0; y <= 1044; row++, y = row * 20) {
  for (let x = row % 2 ? 20 : 0; x <= 1044; x += 40) {
    const d = Math.hypot(x - cx, y - cy) / 720;
    const r = Math.max(0, (d - 0.35) * 22);
    if (r > 1.2) dots.push(`<circle cx="${x}" cy="${y}" r="${f(Math.min(17, r))}"/>`);
  }
}

// The iron, in its own units (tip up, 46 × 58), placed big and tilted.
const IRON = "M0 -30 C16 -16 24 2 23 14 Q22 27 0 27 Q-22 27 -23 14 C-24 2 -16 -16 0 -30 Z";
const SHELL = "M0 -26 C12.8 -14.8 19.2 -0.4 18.4 9.2 Q17.6 19.6 0 19.6 Q-17.6 19.6 -18.4 9.2 C-19.2 -0.4 -12.8 -14.8 0 -26 Z";
const CORD = "M0 24 C-4 34 -16 30 -22 37";
const ironAt = `translate(440 520) rotate(-16) scale(8.2)`;

// The sock, struck: its own units like the game's sprite (peg at the origin).
const SOCK = "M-9 0 L9 0 L9 26 Q10 32 16 33 Q25 35 23 42 Q21 49 10 48 L1 47 Q-11 47 -9 34 Z";
const sockAt = `translate(790 120) rotate(-24) scale(5.6)`;

out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">`);
out.push(`<defs><clipPath id="iron"><path d="${IRON}"/></clipPath><clipPath id="shell"><path d="${SHELL}"/></clipPath><clipPath id="sock"><path d="${SOCK}"/></clipPath></defs>`);
out.push(`<rect width="1024" height="1024" fill="${SKY}"/>`);
out.push(`<g fill="${RAY}">${rayPaths.join("")}</g>`);
out.push(`<g fill="${DOT}" opacity="0.9">${dots.join("")}</g>`);

// Die-cut backing and hard shadow for the iron + cord + sock.
const sil = (fill: string, stroke: string, sw: number) =>
  `<g transform="${ironAt}"><path d="${IRON}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/><path d="${CORD}" fill="none" stroke="${stroke}" stroke-width="${sw + 5}" stroke-linecap="round"/><g transform="translate(-22 37) rotate(40)"><rect x="-7" y="-2" width="14" height="19" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/></g></g>` +
  `<g transform="${sockAt}"><path d="${SOCK}" fill="${fill}" stroke="${stroke}" stroke-width="${(sw * 8.2) / 5.6}" stroke-linejoin="round"/></g>`;
out.push(`<g transform="translate(26 30)">${sil(INK, INK, 5.2)}</g>`);
out.push(sil(WHITE, WHITE, 5.2));

// Steam streaks from the tip toward the sock.
for (const [x, y, rot] of [[612, 300, 58], [560, 196, 58]] as const) {
  out.push(`<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M-22 -40 A22 22 0 0 1 22 -40 L9 100 Q0 114 -9 100 Z" fill="${WHITE}" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/><rect x="-5" y="-34" width="10" height="64" rx="5" fill="#CFE3FF"/></g>`);
}

// The cord and plug.
out.push(`<g transform="${ironAt}"><path d="${CORD}" fill="none" stroke="${INK}" stroke-width="6.5" stroke-linecap="round"/><path d="${CORD}" fill="none" stroke="${CREAM}" stroke-width="3" stroke-linecap="round"/>` +
  `<g transform="translate(-22 37) rotate(40)"><line x1="-3.5" y1="10" x2="-3.5" y2="17" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><line x1="3.5" y1="10" x2="3.5" y2="17" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><rect x="-7" y="-2" width="14" height="13" rx="3" fill="${BANANA}" stroke="${INK}" stroke-width="2.2"/></g></g>`);

// The iron.
out.push(`<g transform="${ironAt}">`);
out.push(`<path d="${IRON}" fill="${STEEL}"/>`);
out.push(`<g clip-path="url(#iron)"><rect x="4" y="-40" width="30" height="80" fill="${STEEL_SHADE}"/></g>`);
out.push(`<path d="${IRON}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`);
out.push(`<path d="${SHELL}" fill="${TOMATO}"/>`);
out.push(`<g clip-path="url(#shell)"><ellipse cx="14" cy="8" rx="12" ry="26" transform="rotate(11 14 8)" fill="${TOMATO_SHADE}"/></g>`);
out.push(`<path d="${SHELL}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`);
out.push(`<rect x="-5" y="-3" width="10" height="22" rx="5" fill="${CREAM}" stroke="${INK}" stroke-width="2.4"/>`);
out.push(`<circle cx="0" cy="21" r="4.2" fill="${BANANA}" stroke="${INK}" stroke-width="2"/><line x1="0" y1="21" x2="0" y2="18" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`);
out.push(`<ellipse cx="-9" cy="-9" rx="4.5" ry="1.9" transform="rotate(-63 -9 -9)" fill="${WHITE}"/>`);
// Googly eyes, looking up at the sock, and a determined grin.
for (const ex of [-8, 8]) {
  out.push(`<circle cx="${ex}" cy="-13" r="6.4" fill="${WHITE}" stroke="${INK}" stroke-width="2"/><circle cx="${ex + 1.6}" cy="-15.6" r="3.3" fill="${INK}"/><circle cx="${ex + 0.6}" cy="-16.8" r="1.1" fill="${WHITE}"/>`);
}
out.push(`</g>`);

// The sock, mid-press: squeezed eyes, stripes.
out.push(`<g transform="${sockAt}">`);
out.push(`<path d="${SOCK}" fill="${WHITE}"/>`);
out.push(`<g clip-path="url(#sock)" fill="${COBALT}"><rect x="-12" y="4" width="30" height="3.5"/><rect x="-12" y="10" width="30" height="3.5"/><circle cx="20" cy="44" r="8"/><circle cx="-7" cy="43" r="7"/></g>`);
out.push(`<path d="${SOCK}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`);
out.push(`<path d="M-6.5 18.5 L-2 21.5 L-6.5 24.5 M6.5 18.5 L2 21.5 L6.5 24.5" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="0" cy="29" rx="2.2" ry="1.8" fill="${INK}"/>`);
out.push(`</g>`);

// Impact stars and a coin or two.
const star = (x: number, y: number, r: number, fill: string, rot: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 ? r * 0.46 : r;
    pts.push(`${f(x + Math.cos(a) * k)},${f(y + Math.sin(a) * k)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/>`;
};
out.push(star(690, 110, 44, BANANA, 0.2));
out.push(star(930, 420, 34, WHITE, -0.3));
out.push(star(720, 420, 26, TOMATO, 0.5));
for (const [x, y, r] of [[160, 250, 50], [250, 140, 34], [850, 640, 40]] as const) {
  out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${BANANA}" stroke="${INK}" stroke-width="13"/><circle cx="${x}" cy="${y}" r="${f(r * 0.6)}" fill="none" stroke="${BANANA_SHADE}" stroke-width="8"/><ellipse cx="${x - r * 0.38}" cy="${y - r * 0.38}" rx="${f(r * 0.24)}" ry="${f(r * 0.1)}" transform="rotate(-45 ${x - r * 0.38} ${y - r * 0.38})" fill="${WHITE}"/>`);
}
// Motion lines.
out.push(`<g fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"><path d="M150 560 Q130 640 146 720"/><path d="M700 700 Q722 780 706 860"/></g>`);
out.push(`</svg>`);

writeFileSync(new URL("../art/icon.svg", import.meta.url), `${out.join("\n")}\n`);
console.log("art/icon.svg written");
