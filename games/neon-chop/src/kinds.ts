import { regular, type Poly } from "./geometry.ts";

/** The neon produce of the Glow Market. Every kind is a convex shape with a bright cross-section. */
export interface Kind {
  id: string;
  /** Outline / shell color. */
  shell: string;
  /** Cross-section color revealed by a cut. */
  flesh: string;
  /** Seed / pattern color inside the flesh. */
  seed: string;
  shape: Poly;
  radius: number;
  points: number;
  special?: "surge" | "static";
}

const R = 40;

export const KINDS: Kind[] = [
  { id: "hexberry", shell: "#4D8DFF", flesh: "#D8E6FF", seed: "#2343B8", shape: regular(6, R + 2, Math.PI / 6), radius: R + 2, points: 1 },
  { id: "prismpear", shell: "#FFC93D", flesh: "#FFF1B8", seed: "#C98A12", shape: roundedTriangle(R + 4), radius: R + 2, points: 1 },
  { id: "orbitplum", shell: "#B07CFF", flesh: "#E9DBFF", seed: "#5C2EB8", shape: regular(18, R - 3), radius: R - 3, points: 1 },
  { id: "rhombery", shell: "#FF3D6E", flesh: "#FFC2D2", seed: "#9E1238", shape: regular(4, R + 6, 0, 0.78), radius: R, points: 1 },
  { id: "octrus", shell: "#FF8A3D", flesh: "#FFD9A8", seed: "#FFFFFF", shape: regular(8, R, Math.PI / 8), radius: R, points: 1 },
];

/** A charged cell: cutting it arcs a surge into the nearest produce in the air. */
export const SURGE: Kind = {
  id: "surge",
  shell: "#5CF6FF",
  flesh: "#F2FEFF",
  seed: "#5CF6FF",
  shape: regular(5, R + 2, -Math.PI / 2),
  radius: R + 2,
  points: 2,
  special: "surge",
};

export const STATIC: Kind = {
  id: "static",
  shell: "#FF2D2D",
  flesh: "#FF2D2D",
  seed: "#FF2D2D",
  shape: regular(14, R - 4),
  radius: R - 4,
  points: 0,
  special: "static",
};

function roundedTriangle(r: number): Poly {
  // Triangle with clipped corners (a hexagon with alternating short edges) — reads as a soft pyramid.
  const out: Poly = [];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
    for (const d of [-0.22, 0.22]) {
      const rr = r * 0.92;
      out.push(Math.cos(a + d) * rr, Math.sin(a + d) * rr + r * 0.12);
    }
  }
  return out;
}
