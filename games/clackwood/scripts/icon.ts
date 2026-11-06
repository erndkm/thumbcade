/**
 * Writes art/icon.svg: an isometric voxel diorama in lowpolyfox's icon style (a log pool table on a grass slab,
 * three balls, a cue and the fox), drawn back to front with top / left / right face shading.
 * `pnpm --filter @thumbcade-games/clackwood icon`
 */
import { writeFileSync } from "node:fs";

type V = [number, number, number, string];
const vox = new Map<string, V>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const put = (x: number, y: number, z: number, c: string) => vox.set(key(x, y, z), [x, y, z, c]);
const fill = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string) => {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) put(x, y, z, c);
};

const MINT = "#A8E6C1";
const SOIL = "#D9A98A";
const WOOD = "#DDA676";
const BARK = "#9C7059";
const FELT = "#D2C3F3";
const FELT2 = "#C3B1EE";
const HOLE = "#3A2F45";
const FOX = "#F68A4A";
const CREAM = "#FFF3E2";
const DARK = "#5B4759";

// Ground: grass over soil, 14 × 14.
fill(0, 0, 0, 13, 0, 13, SOIL);
fill(0, 1, 0, 13, 1, 13, MINT);
// Table legs and body.
for (const [x, z] of [
  [3, 3],
  [10, 3],
  [3, 10],
  [10, 10],
] as const)
  fill(x, 2, z, x, 3, z, BARK);
fill(2, 4, 2, 11, 4, 11, BARK);
// Felt in a checker, rails of logs, knot-hole pockets in the corners.
for (let x = 3; x <= 10; x++) for (let z = 3; z <= 10; z++) put(x, 5, z, (x + z) % 2 ? FELT : FELT2);
for (let i = 2; i <= 11; i++) {
  put(i, 5, 2, WOOD);
  put(i, 5, 11, WOOD);
  put(2, 5, i, WOOD);
  put(11, 5, i, WOOD);
}
for (const [x, z] of [
  [2, 2],
  [11, 2],
  [2, 11],
  [11, 11],
  [2, 7],
  [11, 7],
] as const)
  put(x, 5, z, HOLE);
put(2, 6, 2, BARK);
put(11, 6, 2, BARK);
// Balls (single voxels on the felt) and the cream cue ball.
put(5, 6, 4, "#F4C964");
put(8, 6, 5, "#F27C6B");
put(4, 6, 7, "#6EB5E0");
put(7, 6, 8, "#FFF7EC");
// A ball dropping into the far-right pocket.
put(11, 6, 2, "#A592E0");
// The cue, lying toward the cue ball from the near corner.
for (let k = 0; k < 4; k++) put(8 + k, 6, 9 + k, k === 0 ? "#78C2E4" : k < 3 ? WOOD : BARK);
// The fox at the front-left corner, watching: body, head with a cream muzzle, dark ears, a tail with a cream tip.
fill(0, 2, 10, 1, 3, 11, FOX);
fill(0, 4, 11, 1, 5, 12, FOX);
fill(0, 4, 13, 1, 4, 13, CREAM);
put(0, 5, 13, FOX);
put(1, 5, 13, FOX);
put(0, 6, 11, DARK);
put(1, 6, 11, DARK);
put(0, 2, 12, CREAM);
put(1, 2, 12, CREAM);
fill(0, 2, 9, 0, 3, 9, FOX);
put(0, 2, 8, CREAM);
// A tree at the back and flowers.
fill(13, 2, 0, 13, 4, 0, BARK);
fill(12, 5, 0, 13, 6, 1, "#86D3A0");
put(13, 7, 0, "#A8E6C1");
put(6, 2, 13, "#FBC3D4");
put(13, 2, 9, "#FFE7A1");
put(10, 2, 13, "#D2C3F3");

// Projection (isometric) and shading.
const S = 40;
const A = S * 0.866;
const B = S * 0.5;
const CX = 512;
const CY = 590;
const proj = (x: number, y: number, z: number) => [CX + (x - z) * A, CY + (x + z) * B - y * S - 6.5 * S] as const;
const mixHex = (h: string, t: number) => {
  const n = parseInt(h.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};
const poly = (pts: Array<readonly [number, number]>, fillC: string) =>
  `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="${fillC}" stroke="${fillC}" stroke-width="1.1" stroke-linejoin="round"/>`;

const list = [...vox.values()].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]) || a[1] - b[1]);
const parts: string[] = [];
for (const [x, y, z, c] of list) {
  if (!vox.has(key(x, y + 1, z))) parts.push(poly([proj(x, y + 1, z), proj(x + 1, y + 1, z), proj(x + 1, y + 1, z + 1), proj(x, y + 1, z + 1)], mixHex(c, 0.16)));
  if (!vox.has(key(x, y, z + 1))) parts.push(poly([proj(x, y, z + 1), proj(x + 1, y, z + 1), proj(x + 1, y + 1, z + 1), proj(x, y + 1, z + 1)], c));
  if (!vox.has(key(x + 1, y, z))) parts.push(poly([proj(x + 1, y, z), proj(x + 1, y, z + 1), proj(x + 1, y + 1, z + 1), proj(x + 1, y + 1, z)], mixHex(c, -0.22)));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBEFE6"/><stop offset="1" stop-color="#F3D8E6"/></linearGradient>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter></defs>
<rect width="1024" height="1024" fill="url(#bg)"/>
<ellipse cx="512" cy="905" rx="360" ry="58" fill="#B08AA8" opacity="0.28" filter="url(#soft)"/>
<g>${parts.join("")}</g>
</svg>
`;
writeFileSync(new URL("../art/icon.svg", import.meta.url), svg);
console.log(`art/icon.svg: ${list.length} voxels`);
