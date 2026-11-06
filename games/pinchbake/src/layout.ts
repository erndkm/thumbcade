import { HOLD_Y, RIM, TIN_W } from "./run.ts";

/** Room the score and the next piece take below the status bar. */
export const HUD_H = 58;
/** The recipe strip under the tin (play only). */
export const STRIP_H = 40;

/** Where the tin sits for a viewport: pixels per tin unit and the screen spot of the tin's inner bottom-left. */
export interface Layout {
  W: number;
  H: number;
  /** CSS px per tin unit. */
  s: number;
  /** Screen x of the tin's inner left wall, and screen y of its inner bottom. */
  tx: number;
  ty: number;
  /** Clay wall thickness in px. */
  wall: number;
  /** Top of the playing area (status bar). */
  top: number;
}

/** Pure, so tools and tests share it. */
export function tinLayout(W: number, H: number, top: number): Layout {
  const wallU = 0.36;
  // Width: the tin and its walls with a gutter. Height: HUD, the pinch above the rim, the tin, the strip.
  const byW = (W - 24) / (TIN_W + wallU * 2);
  const needU = HOLD_Y + 1.25 + 0.75 + wallU;
  const byH = (H - top - HUD_H - STRIP_H - 6) / needU;
  const s = Math.max(10, Math.min(byW, byH, 44));
  const tx = Math.round((W - TIN_W * s) / 2);
  const ty = Math.round(H - STRIP_H - wallU * s);
  return { W, H, s, tx, ty, wall: wallU * s, top };
}

export const sx = (L: Layout, x: number): number => L.tx + x * L.s;
export const sy = (L: Layout, y: number): number => L.ty - y * L.s;
/** Tin units from a screen x. */
export const ux = (L: Layout, px: number): number => (px - L.tx) / L.s;
export const rimY = (L: Layout): number => sy(L, RIM);
