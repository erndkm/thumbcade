/**
 * Where everything sits during a run, as pure functions of the viewport and the play insets, so the game and
 * scripts/shoot-plan.ts agree on every slip's position.
 */
import type { Slot } from "./board.ts";
import { TRAY } from "./deal.ts";

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
  L: number;
  R: number;
  top: number;
  /** The clock's rule under the HUD (play only). */
  rule: number;
  board: Box;
  /** The lane above the tray where triples are sealed. */
  lane: Box;
  tray: Box;
  slot: number;
  pitch: number;
  helpers: Box | null;
  msg: Box | null;
}

/** Where a heap sits: the origin of its bottom layer, the slip size and the lift of each layer. */
export interface Geo {
  ox: number;
  oy: number;
  S: number;
  lx: number;
  ly: number;
  minx: number;
  miny: number;
}

export function trayBox(L: number, R: number, bottom: number, maxSlot: number): { tray: Box; slot: number; pitch: number } {
  const gap = 5;
  const slot = Math.max(30, Math.min(maxSlot, Math.floor((R - L - 18 - gap * (TRAY - 1)) / TRAY)));
  const w = slot * TRAY + gap * (TRAY - 1) + 18;
  const h = slot + 16;
  return { tray: { x: (L + R - w) / 2, y: bottom - h, w, h }, slot, pitch: slot + gap };
}

/** The run's layout: HUD and clock rule, a message lane, the heap, the seal lane, the tray and the helpers. */
export function playFrame(W: number, H: number, ins: Insets): Frame {
  const L = ins.left + 16;
  const R = W - ins.right - 16;
  const top = ins.top + 6;
  const rule = top + 56;
  const msg: Box = { x: L, y: rule + 8, w: R - L, h: 30 };
  const helpers: Box = { x: L, y: H - 10 - 44, w: R - L, h: 44 };
  const t = trayBox(L, R, helpers.y - 8, 50);
  const lane: Box = { x: L, y: t.tray.y - 50, w: R - L, h: 48 };
  const by = msg.y + msg.h + 8;
  return { L, R, top, rule, msg, helpers, board: { x: L, y: by, w: R - L, h: Math.max(160, lane.y - 6 - by) }, lane, ...t };
}

/** Fits a heap into `board`, slightly below the middle (nearer the thumb and the tray). */
export function heapGeo(slips: readonly Slot[], board: Box): Geo {
  let minx = 99;
  let maxx = -99;
  let miny = 99;
  let maxy = -99;
  let maxz = 0;
  for (const s of slips) {
    minx = Math.min(minx, s.x);
    maxx = Math.max(maxx, s.x);
    miny = Math.min(miny, s.y);
    maxy = Math.max(maxy, s.y);
    maxz = Math.max(maxz, s.z);
  }
  const wt = (maxx - minx) / 2 + 1;
  const ht = (maxy - miny) / 2 + 1;
  const LX = 0.07;
  const LY = 0.1;
  const S = Math.max(26, Math.min(board.w / (wt + maxz * LX), board.h / (ht + maxz * LY), 74));
  const lx = S * LX;
  const ly = S * LY;
  const ox = board.x + maxz * lx + (board.w - (wt * S + maxz * lx)) / 2;
  const oy = board.y + maxz * ly + (board.h - (ht * S + maxz * ly)) * 0.62;
  return { ox, oy, S, lx, ly, minx, miny };
}

export const slipPos = (g: Geo, s: Slot): [number, number] => [g.ox + ((s.x - g.minx) / 2) * g.S - s.z * g.lx, g.oy + ((s.y - g.miny) / 2) * g.S - s.z * g.ly];

export const slotPos = (f: Frame, i: number): [number, number] => [f.tray.x + 9 + i * f.pitch, f.tray.y + 8];
