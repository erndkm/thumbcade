/**
 * Gambit's original piece set: chunky geometric silhouettes on a 100×100 grid.
 * Drawn twice — a fat outline pass, then the fill — so overlapping parts never show inner seams.
 */
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

const BASE = "M20 80 h60 a4 4 0 0 1 4 4 v8 h-68 v-8 a4 4 0 0 1 4 -4 Z";
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;

const BODY: Record<PieceType, string> = {
  p: `${circle(50, 27, 13)} M35 44 h30 v8 h-30 Z M40 52 h20 l7 28 h-34 Z ${BASE}`,
  r: `M27 14 h11 v9 h6 v-9 h12 v9 h6 v-9 h11 v22 l-7 7 v31 h-32 v-31 l-7 -7 Z M29 74 h42 v8 h-42 Z ${BASE}`,
  n: `M62 10 L68 22 C80 34 80 56 76 80 H30 C32 70 40 62 44 54 L36 58 C28 62 20 58 18 50 L24 38 C30 26 44 16 56 16 Z ${BASE}`,
  b: `${circle(50, 11, 6)} M50 19 C35 29 31 45 37 58 H63 C69 45 65 29 50 19 Z M33 58 h34 v8 h-34 Z M39 66 h22 l6 14 h-34 Z ${BASE}`,
  q: `${circle(14, 27, 6)} ${circle(32, 21, 6)} ${circle(50, 13, 6)} ${circle(68, 21, 6)} ${circle(86, 27, 6)} M14 30 L27 60 L32 26 L43 54 L50 18 L57 54 L68 26 L73 60 L86 30 L76 68 H24 Z M26 68 h48 v12 h-48 Z ${BASE}`,
  k: `M45 2 h10 v8 h8 v10 h-8 v8 h-10 v-8 h-8 v-10 h8 Z M50 30 C30 30 18 40 22 54 L30 70 H70 L78 54 C82 40 70 30 50 30 Z M28 70 h44 v10 h-44 Z ${BASE}`,
};

/** Detail strokes drawn on top (eye, slit, bands). */
const DETAIL: Partial<Record<PieceType, string>> = {
  n: `M46 30 h0.1 M60 22 C66 36 68 52 66 72`,
  b: `M57 33 L45 47`,
  k: `M30 54 H70`,
  r: `M33 43 H67`,
  q: `M30 74 H70`,
};

export function pieceSvg(type: PieceType, color: "w" | "b"): string {
  const fill = color === "w" ? "#FBF7EE" : "#1A1A21";
  const edge = color === "w" ? "#0D0D10" : "#0D0D10";
  const detail = color === "w" ? "#0D0D10" : "#5E6E68";
  const sheen = color === "w" ? "rgba(13,13,16,0.08)" : "rgba(255,255,255,0.08)";
  const d = BODY[type];
  const det = DETAIL[type];
  return (
    `<svg viewBox="0 0 100 100" aria-hidden="true">` +
    `<path d="${d}" fill="${edge}" stroke="${edge}" stroke-width="9" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="${fill}"/>` +
    `<path d="M20 84 h60 v4 h-60 Z" fill="${sheen}"/>` +
    (det ? `<path d="${det}" fill="none" stroke="${detail}" stroke-width="${type === "n" ? 7 : 4}" stroke-linecap="round"/>` : "") +
    `</svg>`
  );
}
