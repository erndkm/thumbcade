/**
 * Rattlepile's drawings, in juicefactory's hand: fat ink outlines, hard offset shadows, flat toy colours and a white
 * shine tick on anything round. Everything is drawn once into sprites in logical px (one block is 50 across) and
 * blitted scaled.
 */
import { inkFill, makeSprite, PAL, roundRectPath, shine, starPath, type Sprite } from "./comic.ts";
import { CELL, COLS, FLOOR, PILE_H, ROWS, W } from "./sim.ts";

const TAU = Math.PI * 2;

export const C = {
  sky: "#2F6BFF",
  skyRay: "#4A83FF",
  skyLow: "#2456E0",
  mat: "#FFF5D8",
  matAlt: "#FBEBC2",
  matLine: "#EAD9AC",
  shelf: "#F4A51C",
  shelfShade: "#D98810",
  orange: "#FF9A2E",
  orangeHi: "#FFC27A",
  orangeShade: "#E0701A",
} as const;

/** Block colours by how many knocks are left: cool for a pushover, hot and then deep blue for a monster. */
export const TIERS = [
  { upTo: 3, fill: PAL.lime, hi: PAL.limeHi, shade: PAL.limeShade },
  { upTo: 8, fill: PAL.banana, hi: PAL.bananaHi, shade: PAL.bananaShade },
  { upTo: 15, fill: C.orange, hi: C.orangeHi, shade: C.orangeShade },
  { upTo: 27, fill: PAL.tomato, hi: "#FF8A7C", shade: PAL.tomatoShade },
  { upTo: 45, fill: PAL.bubblegum, hi: PAL.bubblegumHi, shade: PAL.bubblegumShade },
  { upTo: Infinity, fill: PAL.cobalt, hi: PAL.cobaltHi, shade: PAL.cobaltShade },
] as const;

export function tierOf(hp: number): number {
  for (let i = 0; i < TIERS.length; i++) if (hp <= TIERS[i]!.upTo) return i;
  return TIERS.length - 1;
}

export const MARBLES = [
  [PAL.tomato, "#FFB3A8"],
  [PAL.cobaltHi, "#DCE7FF"],
  [PAL.lime, PAL.limeHi],
  [PAL.bubblegum, PAL.bubblegumHi],
  [PAL.banana, PAL.bananaHi],
] as const;

/** The mat's frame, in logical px around the 350 × (FLOOR + SHELF) play area. */
export const FRAME = 9;
export const SHELF = 24;
export const MAT_H = FLOOR + SHELF;

export interface Art {
  /** Device px per logical px the sprites were drawn at. */
  k: number;
  blocks: Sprite[];
  marbles: Sprite[];
  plus: Sprite;
  zap: Sprite;
  barrel: Sprite;
  cart: Sprite;
  glove: Sprite;
  mat: Sprite;
}

function block(k: number, t: (typeof TIERS)[number]): Sprite {
  const s = CELL - 5;
  return makeSprite(CELL + 8, CELL + 8, CELL / 2 + 3, CELL / 2 + 3, (g) => {
    roundRectPath(g, -s / 2, -s / 2, s, s, 9);
    inkFill(g, t.fill, 3, 3.2);
    // The routed frame of a wooden block, lit from the top left.
    roundRectPath(g, -s / 2 + 5.5, -s / 2 + 5.5, s - 11, s - 11, 5);
    g.lineWidth = 2.6;
    g.strokeStyle = t.shade;
    g.stroke();
    g.save();
    g.beginPath();
    g.moveTo(-s / 2, -s / 2);
    g.lineTo(s / 2, -s / 2);
    g.lineTo(-s / 2, s / 2);
    g.closePath();
    g.clip();
    roundRectPath(g, -s / 2 + 5.5, -s / 2 + 5.5, s - 11, s - 11, 5);
    g.strokeStyle = t.hi;
    g.stroke();
    g.restore();
    shine(g, -s / 2 + 12, -s / 2 + 10.5, 3.6, -0.6, 0.9);
  }, k);
}

function marble(k: number, fill: string, hi: string): Sprite {
  return makeSprite(26, 26, 13, 13, (g) => {
    g.beginPath();
    g.arc(0, 0, 8, 0, TAU);
    inkFill(g, fill, 2.4, 1.6);
    // The swirl inside the glass.
    g.save();
    g.beginPath();
    g.arc(0, 0, 6.8, 0, TAU);
    g.clip();
    g.strokeStyle = hi;
    g.lineWidth = 2.6;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(-6, 3);
    g.quadraticCurveTo(0, -1, 6, 4);
    g.stroke();
    g.restore();
    shine(g, -2.8, -3.4, 2, -0.7);
  }, k);
}

function plus(k: number): Sprite {
  return makeSprite(44, 44, 22, 22, (g) => {
    g.beginPath();
    g.arc(0, 0, 14, 0, TAU);
    inkFill(g, PAL.white, 3, 2.6);
    g.beginPath();
    g.arc(0, 0, 9.5, 0, TAU);
    g.fillStyle = PAL.lime;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = PAL.ink;
    g.stroke();
    g.strokeStyle = PAL.ink;
    g.lineCap = "round";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(-5, 0);
    g.lineTo(5, 0);
    g.moveTo(0, -5);
    g.lineTo(0, 5);
    g.stroke();
    g.strokeStyle = PAL.white;
    g.lineWidth = 2.8;
    g.stroke();
  }, k);
}

function zap(k: number): Sprite {
  return makeSprite(48, 48, 24, 24, (g) => {
    starPath(g, 16, 8, 0.62, -Math.PI / 2);
    inkFill(g, PAL.bubblegum, 3, 2.6);
    // A lightning bolt.
    g.beginPath();
    g.moveTo(2.5, -9);
    g.lineTo(-5, 1.5);
    g.lineTo(-0.5, 1.5);
    g.lineTo(-2.5, 9);
    g.lineTo(5, -1.5);
    g.lineTo(0.5, -1.5);
    g.closePath();
    inkFill(g, PAL.banana, 2, 0);
  }, k);
}

/** The toy cannon's barrel, muzzle up, pivot at the origin. Eyes are drawn live so they can look and blink. */
function barrel(k: number): Sprite {
  return makeSprite(56, 70, 28, 52, (g) => {
    // Wind-up key on the side.
    g.lineCap = "round";
    g.lineWidth = 7;
    g.strokeStyle = PAL.ink;
    g.beginPath();
    g.moveTo(11, -12);
    g.lineTo(19, -12);
    g.stroke();
    g.beginPath();
    g.ellipse(21, -12, 4.5, 7, 0, 0, TAU);
    inkFill(g, PAL.banana, 2.4, 0);
    // Barrel: wider at the breech.
    g.beginPath();
    g.moveTo(-10, -40);
    g.lineTo(10, -40);
    g.quadraticCurveTo(15, -18, 14, 0);
    g.quadraticCurveTo(13, 12, 0, 12);
    g.quadraticCurveTo(-13, 12, -14, 0);
    g.quadraticCurveTo(-15, -18, -10, -40);
    g.closePath();
    inkFill(g, PAL.tomato, 3, 3);
    g.save();
    g.clip();
    g.fillStyle = PAL.tomatoShade;
    g.fillRect(5, -44, 14, 60);
    g.restore();
    // Muzzle ring.
    roundRectPath(g, -13, -47, 26, 10, 4.5);
    inkFill(g, PAL.banana, 3, 2.4);
    shine(g, -7, -31, 2.6, -1.2, 0.85);
  }, k);
}

function cart(k: number): Sprite {
  return makeSprite(64, 40, 32, 16, (g) => {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(s * 15, 8, 8.5, 0, TAU);
      inkFill(g, PAL.banana, 2.8, 2.2);
      g.beginPath();
      g.arc(s * 15, 8, 2.8, 0, TAU);
      g.fillStyle = PAL.ink;
      g.fill();
    }
    roundRectPath(g, -17, 0, 34, 10, 4);
    inkFill(g, PAL.cobalt, 2.8, 0);
  }, k);
}

/** A cartoon glove with one finger out: the first-run hint. */
function glove(k: number): Sprite {
  return makeSprite(48, 60, 20, 8, (g) => {
    g.beginPath();
    g.moveTo(-5, 0);
    g.quadraticCurveTo(-5, -6, 0, -6);
    g.quadraticCurveTo(5, -6, 5, 0);
    g.lineTo(5, 16);
    g.quadraticCurveTo(18, 14, 20, 24);
    g.lineTo(20, 36);
    g.quadraticCurveTo(18, 48, 4, 48);
    g.quadraticCurveTo(-12, 48, -13, 34);
    g.lineTo(-13, 24);
    g.quadraticCurveTo(-13, 18, -5, 18);
    g.closePath();
    inkFill(g, PAL.white, 3, 3);
  }, k);
}

function mat(k: number): Sprite {
  const w = W + FRAME * 2;
  const h = MAT_H + FRAME * 2;
  const pad = 10;
  return makeSprite(w + pad * 2, h + pad * 2, pad + FRAME, pad + FRAME, (g) => {
    roundRectPath(g, -FRAME, -FRAME, w, h, 16);
    inkFill(g, PAL.white, 4, 6);
    g.save();
    roundRectPath(g, 0, 0, W, MAT_H, 9);
    g.clip();
    g.fillStyle = C.mat;
    g.fillRect(0, 0, W, MAT_H);
    // A play mat: soft checks, one square a block.
    g.fillStyle = C.matAlt;
    for (let r = 0; r < ROWS; r++) for (let c = (r + 1) % 2; c < COLS; c += 2) g.fillRect(c * CELL, r * CELL, CELL, CELL);
    // The last row is the edge of the mat: hazard stripes.
    g.save();
    g.beginPath();
    g.rect(0, PILE_H - CELL, W, CELL);
    g.clip();
    g.fillStyle = "#FFE3C4";
    g.fillRect(0, PILE_H - CELL, W, CELL);
    g.strokeStyle = "rgba(255,74,56,0.2)";
    g.lineWidth = 9;
    for (let x = -CELL; x < W + CELL; x += 26) {
      g.beginPath();
      g.moveTo(x, PILE_H);
      g.lineTo(x + CELL, PILE_H - CELL);
      g.stroke();
    }
    g.restore();
    // The floorboards under the mat, and the shelf the cannon rolls on.
    g.fillStyle = "#E9F1FF";
    g.fillRect(0, PILE_H, W, FLOOR - PILE_H);
    g.fillStyle = C.shelf;
    g.fillRect(0, FLOOR, W, SHELF);
    g.fillStyle = C.shelfShade;
    g.fillRect(0, FLOOR + SHELF - 7, W, 7);
    for (let x = 58; x < W; x += 88) g.fillRect(x, FLOOR + 3, 3, SHELF - 10);
    g.fillStyle = PAL.ink;
    g.fillRect(0, FLOOR - 1.5, W, 3);
    g.fillRect(0, PILE_H - 1, W, 2);
    g.restore();
    roundRectPath(g, 0, 0, W, MAT_H, 9);
    g.lineWidth = 3.2;
    g.strokeStyle = PAL.ink;
    g.stroke();
  }, k);
}

export function makeArt(k: number): Art {
  return {
    k,
    blocks: TIERS.map((t) => block(k, t)),
    marbles: MARBLES.map(([fill, hi]) => marble(k, fill, hi)),
    plus: plus(k),
    zap: zap(k),
    barrel: barrel(k),
    cart: cart(k),
    glove: glove(k),
    mat: mat(k),
  };
}

/** A googly eye looking along (lx, ly). */
export function eye(g: CanvasRenderingContext2D, x: number, y: number, r: number, lx: number, ly: number, lw = 2): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = PAL.white;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = PAL.ink;
  g.stroke();
  g.beginPath();
  g.arc(x + lx * r * 0.42, y + ly * r * 0.42, r * 0.5, 0, TAU);
  g.fillStyle = PAL.ink;
  g.fill();
}
