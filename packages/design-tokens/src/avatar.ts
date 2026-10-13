import { hash32 } from "@thumbcade/protocol";

/**
 * Generative default avatars: deterministic 8x8 horizontally-symmetric pixel sprites.
 * Never initials in a circle. Same seed => same sprite on every platform.
 */

/** Curated pairs: [background, foreground]. Each pair is tuned for contrast on ink. */
export const AVATAR_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#1B1F0A", "#D4FF3D"],
  ["#2A0F0C", "#FF4A3D"],
  ["#0C1A2A", "#5CC8FF"],
  ["#1E0F2A", "#C79BFF"],
  ["#2A1F0A", "#FFB547"],
  ["#0A2A1F", "#3DFFB0"],
  ["#2A0A1E", "#FF6FB5"],
  ["#1A1A1F", "#F3F0E8"],
  ["#0F2426", "#7FE3DA"],
  ["#2A160A", "#FF8A3D"],
] as const;

export interface PixelAvatar {
  size: 8;
  /** Row-major 8x8 cells; true = foreground. */
  cells: boolean[];
  background: string;
  foreground: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pixelAvatar(seed: string): PixelAvatar {
  const rand = mulberry32(hash32(seed));
  const [background, foreground] = AVATAR_PALETTE[Math.floor(rand() * AVATAR_PALETTE.length)]!;
  const cells: boolean[] = new Array(64).fill(false);
  // Fill the left half (4 columns) inside a 1-cell margin, mirror to the right.
  for (let y = 1; y < 7; y++) {
    for (let x = 1; x < 4; x++) {
      // Denser toward the center column for a "character" silhouette.
      const p = x === 3 ? 0.62 : x === 2 ? 0.5 : 0.38;
      const on = rand() < p;
      cells[y * 8 + x] = on;
      cells[y * 8 + (7 - x)] = on;
    }
  }
  // Guarantee a recognizable mass: at least 10 lit cells.
  let lit = cells.filter(Boolean).length;
  for (let y = 2; lit < 10 && y < 6; y++) {
    if (!cells[y * 8 + 3]) {
      cells[y * 8 + 3] = true;
      cells[y * 8 + 4] = true;
      lit += 2;
    }
  }
  return { size: 8, cells, background, foreground };
}

/** SVG markup for web use (portal, simulator, share cards). */
export function pixelAvatarSvg(seed: string, px = 64): string {
  const a = pixelAvatar(seed);
  const rects: string[] = [];
  a.cells.forEach((on, i) => {
    if (on) rects.push(`<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1.02" height="1.02"/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="8" height="8" fill="${a.background}"/><g fill="${a.foreground}">${rects.join("")}</g></svg>`;
}
