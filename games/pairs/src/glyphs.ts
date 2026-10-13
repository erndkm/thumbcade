/** Original card faces: bold geometric glyphs (SVG, viewBox 0 0 100 100). No emoji, no stock art. */

function star(n: number, outer: number, inner: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}
function poly(n: number, r: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rot + (i * 360) / n) * Math.PI) / 180;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}"/>`;
}

export const SHAPES: Record<string, string> = {
  circle: `<circle cx="50" cy="50" r="30"/>`,
  ring: `<path fill-rule="evenodd" d="M50 18a32 32 0 1 1 0 64a32 32 0 1 1 0-64zm0 16a16 16 0 1 0 0 32a16 16 0 1 0 0-32z"/>`,
  triangle: `<polygon points="50,16 86,80 14,80"/>`,
  square: `<rect x="22" y="22" width="56" height="56" rx="6"/>`,
  diamond: `<polygon points="50,12 84,50 50,88 16,50"/>`,
  star: star(5, 36, 15),
  hexagon: poly(6, 34, 0),
  plus: `<path d="M40 16h20v24h24v20H60v24H40V60H16V40h24z"/>`,
  moon: `<path d="M62 14a36 36 0 1 0 24 58A30 30 0 1 1 62 14z"/>`,
  bolt: `<polygon points="58,10 22,56 46,56 38,90 78,40 54,40"/>`,
  drop: `<path d="M50 12C50 12 22 46 22 62a28 28 0 0 0 56 0C78 46 50 12 50 12z"/>`,
  heart: `<path d="M50 84L18 52C8 42 10 26 22 20c10-5 20-1 28 8c8-9 18-13 28-8c12 6 14 22 4 32z"/>`,
  arrow: `<polygon points="50,12 84,50 62,50 62,88 38,88 38,50 16,50"/>`,
  wave: `<path d="M10 40c10-14 20-14 30 0s20 14 30 0s20-14 20-14v22s-10 14-20 0s-20-14-30 0s-20 14-30 0z"/>`,
  flower: `<g><circle cx="50" cy="30" r="17"/><circle cx="70" cy="50" r="17"/><circle cx="50" cy="70" r="17"/><circle cx="30" cy="50" r="17"/><circle cx="50" cy="50" r="12"/></g>`,
  burst: star(8, 38, 22, -90),
  chevrons: `<path d="M18 38l32-22l32 22v16L50 32L18 54zM18 66l32-22l32 22v16L50 60L18 82z"/>`,
  eye: `<path fill-rule="evenodd" d="M50 26c22 0 36 24 36 24s-14 24-36 24S14 50 14 50s14-24 36-24zm0 12a12 12 0 1 0 0 24a12 12 0 1 0 0-24z"/>`,
};

/** Saturated inks tuned for contrast on the cream card face. */
export const COLORS = ["#F0449A", "#14B886", "#2F7DF6", "#F59A0B", "#7C4DEB", "#E8392E", "#2B1B2A", "#0EA5B7"];

export interface Glyph {
  shape: string;
  color: string;
}

export function glyphSvg(g: Glyph): string {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="${g.color}">${SHAPES[g.shape]}</g></svg>`;
}
