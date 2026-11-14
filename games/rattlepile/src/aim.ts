/**
 * Reading the thumb. A drag anywhere aims the cannon: drag down and it works like a slingshot (the shot goes the
 * other way); drag up or sideways and the shot follows the thumb. The first few pixels decide nothing, a drag back
 * to the middle cancels, and once the drag is long enough its mind is made up for the rest of the gesture.
 */
import { clampAim } from "./sim.ts";

/** A drag shorter than this (CSS px) is no shot: letting go in the middle cancels. */
export const ARM = 16;
/** Past this the drag has made up its mind: pulling back or pointing. */
export const LOCK = 36;

export interface Drag {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** 0: not armed, 1: pulling back (the shot goes the other way), 2: pointing (the shot follows the thumb). */
  mode: 0 | 1 | 2;
}

export const startDrag = (id: number, x: number, y: number): Drag => ({ id, x0: x, y0: y, x, y, mode: 0 });

/** Moves the thumb. Returns true when the drag has just armed. */
export function moveDrag(a: Drag, x: number, y: number): boolean {
  a.x = x;
  a.y = y;
  const d = Math.hypot(x - a.x0, y - a.y0);
  if (d < ARM * 0.6) {
    a.mode = 0;
    return false;
  }
  if (d >= ARM && (!a.mode || d < LOCK)) {
    const was = a.mode;
    a.mode = y - a.y0 > 4 ? 1 : 2;
    return !was;
  }
  return false;
}

/** The shot this drag asks for (a unit vector, always upward), or null while it is not armed. */
export function aimOf(a: Drag): [number, number] | null {
  if (!a.mode) return null;
  const dx = a.x - a.x0;
  const dy = a.y - a.y0;
  return a.mode === 1 ? clampAim(-dx, -dy) : clampAim(dx, dy);
}
