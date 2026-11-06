/** quietmoves: paper, ink, graphite, a faded ink blue, and one seal red. */
export const PAPER = "#F2EBDD";
export const INK = "#1E1A17";
export const GRAPHITE = "#6F6961";
export const PENCIL = "#A79F93";
export const BLUE = "#4D6584";
export const SEAL = "#B9432C";

/** "#RRGGBB" + alpha → rgba() string. */
export function rgba(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/** Instrument Serif, registered as "QM Serif" with a regular and an italic face. */
export const FAMILY = '"QM Serif", "Iowan Old Style", Georgia, serif';
export const serif = (px: number): string => `${px}px ${FAMILY}`;
export const italic = (px: number): string => `italic ${px}px ${FAMILY}`;
