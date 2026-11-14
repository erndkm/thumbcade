/**
 * Where everything sits, as pure functions of the viewport and the insets, so the game and scripts/shoot-plan.ts
 * agree on every peg's position. During a run: the score and the kitchen timer under the status bar, the jars, the
 * wall with its counter, the shelf and the magnet. In attract mode the same pieces, smaller, under the title.
 */
import { WALL_H, WALL_W } from "./board.ts";
import { DOCKS } from "./deal.ts";
import { FLOOR } from "./physics.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Frame {
  W: number;
  H: number;
  /** Left and right edges of the playing column, and the top of the HUD. */
  L: number;
  R: number;
  top: number;
  /** The wall's top-left corner and its scale (px per wall unit). */
  wx: number;
  wy: number;
  u: number;
  /** The counter top (where dishes land), in px. */
  floor: number;
  /** Jar slots: the open docks, then two rush spots. Centre x, bottom y, width and height. */
  jars: Array<{ x: number; y: number; w: number; h: number }>;
  /** Where the next jar in line peeks out. */
  next: { x: number; y: number; s: number };
  shelf: Box;
  /** Shelf slot pitch and size. */
  pitch: number;
  slot: number;
  magnet: Box;
  /** Score anchor (left) and the timer's centre. */
  score: { x: number; y: number };
  clock: { x: number; y: number; r: number };
  /** The message lane under the jars. */
  lane: { x: number; y: number };
}

const SHELF_SLOTS = 6;

function build(W: number, H: number, L: number, R: number, top: number, jarTop: number, jarScale: number, wallBottom: number, shelfY: number, maxU: number): Frame {
  const jw = 76 * jarScale;
  const jh = 84 * jarScale;
  const mid = (L + R) / 2;
  const gap = 18 * jarScale;
  const jars: Frame["jars"] = [];
  for (let k = 0; k < DOCKS; k++) jars.push({ x: mid + (k - (DOCKS - 1) / 2) * (jw + gap), y: jarTop + jh, w: jw, h: jh });
  const rx = R - jw * 0.42;
  jars.push({ x: rx, y: jarTop + jh * 0.92, w: jw * 0.84, h: jh * 0.84 }, { x: rx - jw * 0.9, y: jarTop + jh * 0.92, w: jw * 0.84, h: jh * 0.84 });
  const wallTop = jarTop + jh + 12 * jarScale;
  const floorPad = (FLOOR - WALL_H) + 0.32;
  const u = Math.max(18, Math.min((R - L) / WALL_W, (wallBottom - wallTop) / (WALL_H + floorPad), maxU));
  const wx = Math.round(mid - (WALL_W * u) / 2);
  const wy = Math.round(wallTop + Math.max(0, wallBottom - wallTop - (WALL_H + floorPad) * u) * 0.5);
  // Room for six cups (the spare slot) and the magnet beside them.
  const slot = Math.min(50, Math.floor((R - L - 58 - 10 - 16) / SHELF_SLOTS) - 4);
  const pitch = slot + 4;
  const shelfW = pitch * SHELF_SLOTS + 16;
  const magnet: Box = { x: R - 58, y: shelfY, w: 58, h: slot + 14 };
  const shelf: Box = { x: Math.round(Math.max(L, Math.min(mid - (shelfW - pitch) / 2, magnet.x - 10 - shelfW))), y: shelfY, w: shelfW, h: slot + 14 };
  return {
    W,
    H,
    L,
    R,
    top,
    wx,
    wy,
    u,
    floor: wy + FLOOR * u,
    jars,
    next: { x: L + 24 * jarScale, y: jarTop + jh * 0.62, s: jarScale },
    shelf,
    pitch,
    slot,
    magnet,
    score: { x: L + 4, y: top + 26 },
    clock: { x: R - 30, y: top + 32, r: 27 },
    lane: { x: mid, y: wallTop + 16 },
  };
}

/** The run's layout. */
export function playFrame(W: number, H: number, ins: Insets): Frame {
  const L = ins.left + 12;
  const R = W - ins.right - 12;
  const top = ins.top + 6;
  const jarTop = top + 66;
  const shelfY = H - 12 - 64;
  return build(W, H, L, R, top, jarTop, 1, shelfY - 8, shelfY, 64);
}

/** Attract mode: the title block above, the demo below it, clear of the rail and the caption. */
export function attractFrame(W: number, H: number, ins: Insets, titleH: number): Frame {
  const L = ins.left + 14;
  const R = W - Math.max(ins.right + 8, 14);
  const top = ins.top + 4;
  const jarTop = top + titleH + 4;
  const promptY = H - ins.bottom - 46;
  const f = build(W, H, L, R, top, jarTop, 0.72, promptY - 18, H - 12 - 64, 52);
  return f;
}

/** Wall units -> screen px. */
export const toScreen = (f: Frame, x: number, y: number): [number, number] => [f.wx + x * f.u, f.wy + y * f.u];

/** The centre of shelf slot `i`. */
export const shelfSlot = (f: Frame, i: number): [number, number] => [f.shelf.x + 8 + f.pitch * i + f.slot / 2 + 2, f.shelf.y + 7 + f.slot / 2];

/** Blends two frames (the start of a run slides the attract layout into the run's). */
export function blendFrames(a: Frame, b: Frame, k: number): Frame {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const l = (x: number, y: number) => x + (y - x) * k;
  const box = (p: Box, q: Box): Box => ({ x: l(p.x, q.x), y: l(p.y, q.y), w: l(p.w, q.w), h: l(p.h, q.h) });
  return {
    W: b.W,
    H: b.H,
    L: l(a.L, b.L),
    R: l(a.R, b.R),
    top: l(a.top, b.top),
    wx: l(a.wx, b.wx),
    wy: l(a.wy, b.wy),
    u: l(a.u, b.u),
    floor: l(a.floor, b.floor),
    jars: b.jars.map((j, i) => ({ x: l(a.jars[i]!.x, j.x), y: l(a.jars[i]!.y, j.y), w: l(a.jars[i]!.w, j.w), h: l(a.jars[i]!.h, j.h) })),
    next: { x: l(a.next.x, b.next.x), y: l(a.next.y, b.next.y), s: l(a.next.s, b.next.s) },
    shelf: box(a.shelf, b.shelf),
    pitch: l(a.pitch, b.pitch),
    slot: l(a.slot, b.slot),
    magnet: box(a.magnet, b.magnet),
    score: { x: l(a.score.x, b.score.x), y: l(a.score.y, b.score.y) },
    clock: { x: l(a.clock.x, b.clock.x), y: l(a.clock.y, b.clock.y), r: l(a.clock.r, b.clock.r) },
    lane: { x: l(a.lane.x, b.lane.x), y: l(a.lane.y, b.lane.y) },
  };
}
