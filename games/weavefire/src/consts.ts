/** Shared numbers for the simulation, the renderer and the HUD. Field units: the field is always 360 wide. */

export const FIELD_W = 360;

/** The ship's real hitbox: a dot, drawn as the bright core of the shuttle. */
export const SHIP_HIT_R = 3;
/** A bullet whose centre passes within this of the ship's centre (and misses) is a graze. */
export const GRAZE_R = 21;
/** Pickups and crystals are collected inside this radius. */
export const SHIP_PICK_R = 22;
export const MAX_SHIELDS = 3;
export const MAX_LEVEL = 5;
export const MAX_DRONES = 2;
/** Seconds of invulnerability after a hit. */
export const INVULN = 1.9;
/** Bullets this close to the ship are cleared when it takes a hit, so one mistake never chains into two. */
export const HIT_CLEAR_R = 120;

/** How long a chain survives without a kill, in seconds. A graze tops it up a little. */
export const CHAIN_HOLD = 2.4;
export const GRAZE_TOPUP = 0.35;
/** Kill counts that unlock each multiplier tier (×1 … ×8). */
export const MULT_STEPS = [0, 8, 20, 36, 56, 80, 110, 150] as const;
export const MAX_MULT = MULT_STEPS.length;

/** The ship stays in the lower part of the field so the first seconds stay safe and the thumb has room. */
export const SHIP_TOP_FRAC = 0.38;
export const SHIP_BOTTOM_MARGIN = 48;
export const SHIP_SIDE_MARGIN = 14;

/** Palette (midnight arcade). The player's side is aquamarine, the enemy's bullets hot pink with white cores. */
export const PAL = {
  ink: "#07060D",
  ink1: "#0D0D10",
  ink2: "#151227",
  paper: "#F3F0E8",
  paperDim: "#A7A3AE",
  accent: "#38FFD0",
  accentHi: "#B8FFF0",
  bullet: "#FF3D9A",
  bulletHi: "#FFD1E8",
  crystal: "#FFE15C",
  dart: "#4DA8FF",
  weaver: "#B8FF4D",
  bloom: "#FFB23F",
  bastion: "#FF7A2E",
  skiff: "#F3F0E8",
  loom: "#A77BFF",
  loomGold: "#FFD25C",
  warn: "#FF6A3D",
} as const;
