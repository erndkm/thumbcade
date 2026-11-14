/**
 * What the forts are made of: the desk things on my textbooks, and the doodles that live in them. Sizes are in
 * metres of the world (the view is 8 m wide), half extents like the physics wants them. Every piece is one box or
 * one polygon, except the paper cup, which is upturned and hollow so a doodle can hide under it.
 */

export type PieceKind = "pencil" | "pencilTip" | "pencilEnd" | "eraser" | "pad" | "ruler" | "cup";
export type MiteKind = "tick" | "stub" | "lanky";
export type Kind = PieceKind | MiteKind | "wad" | "tape";

export interface Spec {
  /** Half width and half height of the bounding box (local, unrotated). */
  hw: number;
  hh: number;
  density: number;
  friction: number;
  restitution: number;
  /**
   * Speed change (m/s) one impact has to give this piece to break it (pencils snap, pads burst, cups crumple), or to
   * knock out a doodle. Infinity: it never breaks.
   */
  breakDv: number;
  /** Short name for the copy. */
  name: string;
}

export const PIECES: Record<PieceKind, Spec> = {
  pencil: { hw: 1.0, hh: 0.12, density: 0.7, friction: 0.5, restitution: 0.05, breakDv: 6.2, name: "pencil" },
  pencilTip: { hw: 0.5, hh: 0.12, density: 0.7, friction: 0.5, restitution: 0.05, breakDv: Infinity, name: "half a pencil" },
  pencilEnd: { hw: 0.5, hh: 0.12, density: 0.7, friction: 0.5, restitution: 0.05, breakDv: Infinity, name: "half a pencil" },
  eraser: { hw: 0.42, hh: 0.23, density: 1.05, friction: 0.85, restitution: 0.28, breakDv: Infinity, name: "eraser" },
  pad: { hw: 0.32, hh: 0.32, density: 0.5, friction: 0.65, restitution: 0.04, breakDv: 7.5, name: "sticky notes" },
  ruler: { hw: 1.5, hh: 0.1, density: 0.7, friction: 0.35, restitution: 0.08, breakDv: Infinity, name: "ruler" },
  cup: { hw: 0.36, hh: 0.4, density: 0.5, friction: 0.5, restitution: 0.05, breakDv: 4.2, name: "paper cup" },
};

/** The upturned cup: its base (now on top) is narrower than its rim (on the desk). Walls this thick. */
export const CUP = { top: 0.25, bottom: 0.36, wall: 0.07, plate: 0.07 } as const;

export interface MiteSpec extends Spec {
  /** Points for knocking it out. */
  pts: number;
}

/** The doodles. A tick is a little triangle, a stub a square, a lanky a tall slip that falls over if you look at it. */
export const MITES: Record<MiteKind, MiteSpec> = {
  tick: { hw: 0.27, hh: 0.25, density: 0.55, friction: 0.75, restitution: 0.1, breakDv: 3.0, name: "tick", pts: 100 },
  stub: { hw: 0.28, hh: 0.28, density: 0.55, friction: 0.75, restitution: 0.1, breakDv: 3.2, name: "stub", pts: 100 },
  lanky: { hw: 0.2, hh: 0.46, density: 0.55, friction: 0.75, restitution: 0.1, breakDv: 3.2, name: "lanky", pts: 150 },
};

/** The paper wad, and the tape ball you earn (heavier, bigger, and it doesn't bounce off). */
export const WAD = { r: 0.21, density: 6, friction: 0.5, restitution: 0.3 } as const;
export const TAPE = { r: 0.28, density: 10, friction: 0.6, restitution: 0.12 } as const;

export const isMite = (k: Kind): k is MiteKind => k === "tick" || k === "stub" || k === "lanky";
export const isShot = (k: Kind): k is "wad" | "tape" => k === "wad" || k === "tape";

export function specOf(k: Kind): Spec {
  if (isMite(k)) return MITES[k];
  if (k === "wad") return { hw: WAD.r, hh: WAD.r, density: WAD.density, friction: WAD.friction, restitution: WAD.restitution, breakDv: Infinity, name: "wad" };
  if (k === "tape") return { hw: TAPE.r, hh: TAPE.r, density: TAPE.density, friction: TAPE.friction, restitution: TAPE.restitution, breakDv: Infinity, name: "tape ball" };
  return PIECES[k];
}

/** Local outline of a piece's collision shape(s), as convex polygons (for drawing debug outlines and tests). */
export function tickPoly(): Array<[number, number]> {
  const { hw, hh } = MITES.tick;
  return [
    [-hw, -hh],
    [hw, -hh],
    [0, hh],
  ];
}
