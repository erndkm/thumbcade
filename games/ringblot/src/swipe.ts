/**
 * Reading the thumb: a swipe is read the moment the finger has gone far enough in one direction, and the finger can
 * keep going. Every further stretch in a new direction is another swipe, so the beetle can be steered round a whole
 * corner without lifting the thumb.
 */
import type { Dir } from "./sim.ts";

/** CSS px a finger travels before it counts as a swipe. */
export const SWIPE = 14;

export interface Thumb {
  id: number;
  /** Where the current stretch began. */
  ax: number;
  ay: number;
}

export const startThumb = (id: number, x: number, y: number): Thumb => ({ id, ax: x, ay: y });

/** Moves the thumb to (x, y). Returns the direction swiped, or -1 if it hasn't gone far enough yet. */
export function readSwipe(t: Thumb, x: number, y: number): Dir | -1 {
  const dx = x - t.ax;
  const dy = y - t.ay;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return -1;
  t.ax = x;
  t.ay = y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
}
