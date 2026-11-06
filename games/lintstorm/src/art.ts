/**
 * Lintstorm's cast, in juicefactory's cartoon (thick ink outlines, hard offset shadows, a white shine): the steam
 * iron, the sock gang (socks, lint fluff, tees, mittens, sweaters), the three bosses, loot and power-up stickers.
 * Everything is drawn once into a bitmap at device resolution (`k` device px per logical px) and blitted.
 * Faces that look around (bosses, the iron's eyes) are drawn live on top.
 */
import { inkFill, makeSprite, PAL, roundRectPath, shine, starPath, type Sprite } from "./comic.ts";
import type { EnemyKind, PowerKind } from "./sim.ts";

const INK = PAL.ink;
const TAU = Math.PI * 2;

/** The sky (the game's accent) and the rest of the laundry-day palette. */
export const C = {
  sky: "#B13DFF",
  skyRay: "#C266FF",
  skyBoss: "#8F1FE6",
  skyBossRay: "#A23CF5",
  cloud: "#D9A2FF",
  cloudShade: "#9B30EE",
  cloudLine: "#7E16CF",
  steel: "#E8EBF4",
  steelShade: "#AEB4C8",
  fluff: "#DCD2EA",
  fluffShade: "#B5A6CC",
  fluffDeep: "#8F7EAB",
  wood: "#E8A85C",
  woodShade: "#B9743A",
  wicker: "#F0B461",
  wickerShade: "#C27D34",
  rope: "#FFF5D8",
  water: "#3B7BFF",
  waterHi: "#8DB6FF",
  cheek: "#FF9C8A",
} as const;

/** Each sock line gets one stripe colour; the rest of the gang have their own. */
export const STRIPES = [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum] as const;

export interface Art {
  k: number;
  iron: Sprite;
  steam: Sprite;
  spark: Sprite;
  socks: Sprite[];
  socksHit: Sprite[];
  minisock: Sprite;
  fluff: Sprite;
  fluffHit: Sprite;
  tee: [Sprite, Sprite];
  teeHit: Sprite;
  mitten: Sprite;
  mittenHit: Sprite;
  sweater: Sprite;
  sweaterHit: Sprite;
  coin: Sprite;
  buttons: Sprite[];
  power: Record<PowerKind, Sprite>;
  heart: Sprite;
  heartEmpty: Sprite;
  king: Sprite;
  spin: Sprite;
  hamper: Sprite;
  hamperLid: Sprite;
  clouds: Sprite[];
  glove: Sprite;
}

// ---------------------------------------------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------------------------------------------

/** Googly eye: white ball, ink pupil looking along (lx, ly) (-1..1), a glint. */
export function eye(g: CanvasRenderingContext2D, x: number, y: number, r: number, lx = 0, ly = 0, lw = 2): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = PAL.white;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke();
  const pr = r * 0.52;
  const px = x + lx * (r - pr) * 0.85;
  const py = y + ly * (r - pr) * 0.85;
  g.beginPath();
  g.arc(px, py, pr, 0, TAU);
  g.fillStyle = INK;
  g.fill();
  g.beginPath();
  g.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.32, 0, TAU);
  g.fillStyle = PAL.white;
  g.fill();
}

/** Squeezed-shut eyes (><) for a hit. */
function squint(g: CanvasRenderingContext2D, x: number, y: number, r: number, side: number, lw: number): void {
  g.beginPath();
  g.moveTo(x - r * side, y - r * 0.7);
  g.lineTo(x + r * 0.6 * side, y);
  g.lineTo(x - r * side, y + r * 0.7);
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke();
}

/** Angry brows over two eyes at ±dx. */
function brows(g: CanvasRenderingContext2D, x: number, y: number, dx: number, w: number, lw: number, tilt = 0.45): void {
  g.strokeStyle = INK;
  g.lineWidth = lw;
  g.lineCap = "round";
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(x + s * (dx + w * 0.6), y - w * tilt);
    g.lineTo(x + s * (dx - w * 0.6), y + w * tilt * 0.3);
    g.stroke();
  }
}

/** A face: two googly eyes looking down, brows, a little grumpy mouth; or squeezed shut when hit. */
function face(g: CanvasRenderingContext2D, x: number, y: number, r: number, hit: boolean, mood: "grump" | "grin" = "grump"): void {
  const dx = r * 1.15;
  const lw = Math.max(1.6, r * 0.32);
  if (hit) {
    squint(g, x - dx, y, r, -1, lw);
    squint(g, x + dx, y, r, 1, lw);
    g.beginPath();
    g.ellipse(x, y + r * 1.7, r * 0.55, r * 0.45, 0, 0, TAU);
    g.fillStyle = INK;
    g.fill();
    return;
  }
  eye(g, x - dx, y, r, 0.2, 0.5, lw * 0.7);
  eye(g, x + dx, y, r, -0.2, 0.5, lw * 0.7);
  if (mood === "grump") brows(g, x, y - r * 1.25, dx, r * 1.1, lw);
  g.beginPath();
  if (mood === "grump") {
    g.moveTo(x - r * 0.6, y + r * 1.9);
    g.quadraticCurveTo(x, y + r * 1.4, x + r * 0.6, y + r * 1.9);
  } else {
    g.moveTo(x - r * 0.7, y + r * 1.4);
    g.quadraticCurveTo(x, y + r * 2.2, x + r * 0.7, y + r * 1.4);
  }
  g.lineWidth = lw * 0.8;
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.stroke();
}

function heartPath(g: CanvasRenderingContext2D, r: number): void {
  g.beginPath();
  g.moveTo(0, r * 0.95);
  g.bezierCurveTo(-r * 1.25, r * 0.15, -r * 1.05, -r * 0.95, -r * 0.05, -r * 0.45);
  g.lineTo(0, -r * 0.38);
  g.lineTo(r * 0.05, -r * 0.45);
  g.bezierCurveTo(r * 1.05, -r * 0.95, r * 1.25, r * 0.15, 0, r * 0.95);
  g.closePath();
}

/** A bumpy outline (fluff, clouds): `n` bumps around an ellipse. */
function bumpy(g: CanvasRenderingContext2D, rx: number, ry: number, n: number, bump: number, seed: number): void {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 0.5) / n) * TAU;
    const j = 1 + Math.sin(seed * 12.9898 + i * 78.233) * 0.12;
    const x0 = Math.cos(a0) * rx;
    const y0 = Math.sin(a0) * ry;
    if (i === 0) g.moveTo(x0, y0);
    else g.quadraticCurveTo(Math.cos(a1 - TAU / n) * rx * (1 + bump * j), Math.sin(a1 - TAU / n) * ry * (1 + bump * j), x0, y0);
  }
  g.closePath();
}

// ---------------------------------------------------------------------------------------------------------------
// The iron
// ---------------------------------------------------------------------------------------------------------------

/** The iron's outline, tip up, centred on the origin, 46 × 58. */
function ironPath(g: CanvasRenderingContext2D, s = 1, dy = 0): void {
  g.beginPath();
  g.moveTo(0, -30 * s + dy);
  g.bezierCurveTo(16 * s, -16 * s + dy, 24 * s, 2 * s + dy, 23 * s, 14 * s + dy);
  g.quadraticCurveTo(22 * s, 27 * s + dy, 0, 27 * s + dy);
  g.quadraticCurveTo(-22 * s, 27 * s + dy, -23 * s, 14 * s + dy);
  g.bezierCurveTo(-24 * s, 2 * s + dy, -16 * s, -16 * s + dy, 0, -30 * s + dy);
  g.closePath();
}

function drawIron(g: CanvasRenderingContext2D): void {
  // Sole plate (steel), peeking out all round.
  ironPath(g);
  inkFill(g, C.steel, 3.2, 3.5);
  g.save();
  ironPath(g);
  g.clip();
  g.fillStyle = C.steelShade;
  g.fillRect(4, -40, 30, 80);
  g.restore();
  ironPath(g);
  g.lineWidth = 3.2;
  g.strokeStyle = INK;
  g.stroke();
  // The red shell.
  ironPath(g, 0.8, -2);
  g.fillStyle = PAL.tomato;
  g.fill();
  g.save();
  ironPath(g, 0.8, -2);
  g.clip();
  g.fillStyle = PAL.tomatoShade;
  g.beginPath();
  g.ellipse(14, 8, 12, 26, 0.2, 0, TAU);
  g.fill();
  g.restore();
  ironPath(g, 0.8, -2);
  g.lineWidth = 2.6;
  g.strokeStyle = INK;
  g.stroke();
  // Handle grip and the heat dial.
  roundRectPath(g, -5, -3, 10, 22, 5);
  inkFill(g, PAL.cream, 2.4, 1.6);
  g.beginPath();
  g.arc(0, 21, 4.2, 0, TAU);
  inkFill(g, PAL.banana, 2, 0);
  g.beginPath();
  g.moveTo(0, 21);
  g.lineTo(0, 18);
  g.lineWidth = 1.6;
  g.stroke();
  shine(g, -9, -10, 4.5, -1.1);
}

// ---------------------------------------------------------------------------------------------------------------
// The sock gang
// ---------------------------------------------------------------------------------------------------------------

function sockPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-9, 0);
  g.lineTo(9, 0);
  g.lineTo(9, 26);
  g.quadraticCurveTo(10, 32, 16, 33);
  g.quadraticCurveTo(25, 35, 23, 42);
  g.quadraticCurveTo(21, 49, 10, 48);
  g.lineTo(1, 47);
  g.quadraticCurveTo(-11, 47, -9, 34);
  g.closePath();
}

function drawSock(g: CanvasRenderingContext2D, stripe: string, hit: boolean, peg: boolean): void {
  sockPath(g);
  inkFill(g, PAL.white, 2.6, 2.6);
  g.save();
  sockPath(g);
  g.clip();
  g.fillStyle = stripe;
  g.fillRect(-12, 4, 30, 3.5);
  g.fillRect(-12, 10, 30, 3.5);
  // Toe and heel patches.
  g.beginPath();
  g.arc(20, 44, 8, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(-7, 43, 7, 0, TAU);
  g.fill();
  g.restore();
  sockPath(g);
  g.lineWidth = 2.6;
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.moveTo(-9, 2.5);
  g.lineTo(9, 2.5);
  g.lineWidth = 1.4;
  g.stroke();
  face(g, 0, 22, 3.6, hit);
  if (peg) {
    roundRectPath(g, -3.5, -9, 7, 13, 2);
    inkFill(g, C.wood, 2, 0);
    g.beginPath();
    g.moveTo(-3.5, -2);
    g.lineTo(3.5, -2);
    g.lineWidth = 1.4;
    g.stroke();
  }
}

function drawFluff(g: CanvasRenderingContext2D, hit: boolean): void {
  // Ears.
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 7, -14, 4, 8, s * 0.35, 0, TAU);
    inkFill(g, C.fluff, 2.2, 2);
  }
  bumpy(g, 15, 13, 11, 0.16, 3);
  inkFill(g, C.fluff, 2.4, 2.4);
  g.save();
  bumpy(g, 15, 13, 11, 0.16, 3);
  g.clip();
  g.fillStyle = C.fluffShade;
  g.beginPath();
  g.ellipse(6, 9, 13, 8, -0.3, 0, TAU);
  g.fill();
  g.restore();
  bumpy(g, 15, 13, 11, 0.16, 3);
  g.lineWidth = 2.4;
  g.strokeStyle = INK;
  g.stroke();
  // A few lint tufts.
  g.strokeStyle = C.fluffDeep;
  g.lineWidth = 1.3;
  g.lineCap = "round";
  for (const [x, y] of [[-9, -3], [9, 4], [-4, 8]] as const) {
    g.beginPath();
    g.moveTo(x - 2, y);
    g.quadraticCurveTo(x, y - 2, x + 2, y);
    g.stroke();
  }
  face(g, 0, -2, 3.4, hit, "grin");
}

function teePath(g: CanvasRenderingContext2D, up: boolean): void {
  const sy = up ? -12 : 6;
  g.beginPath();
  g.moveTo(-9, -15);
  g.quadraticCurveTo(0, -9, 9, -15);
  g.lineTo(15, -13);
  g.lineTo(26, sy - 3);
  g.lineTo(20, sy + 8);
  g.lineTo(13, -2);
  g.lineTo(13, 19);
  g.quadraticCurveTo(0, 22, -13, 19);
  g.lineTo(-13, -2);
  g.lineTo(-20, sy + 8);
  g.lineTo(-26, sy - 3);
  g.lineTo(-15, -13);
  g.closePath();
}

function drawTee(g: CanvasRenderingContext2D, up: boolean, hit: boolean): void {
  teePath(g, up);
  inkFill(g, PAL.lime, 2.6, 2.6);
  g.save();
  teePath(g, up);
  g.clip();
  g.fillStyle = PAL.limeShade;
  g.fillRect(6, -20, 30, 50);
  g.fillStyle = PAL.banana;
  g.fillRect(-30, 9, 60, 4);
  g.restore();
  teePath(g, up);
  g.lineWidth = 2.6;
  g.strokeStyle = INK;
  g.stroke();
  // Collar.
  g.beginPath();
  g.moveTo(-9, -15);
  g.quadraticCurveTo(0, -6, 9, -15);
  g.lineWidth = 2;
  g.stroke();
  face(g, 0, -1, 3.6, hit);
}

function mittenPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-10, 14);
  g.lineTo(-11, -4);
  g.quadraticCurveTo(-12, -19, 1, -19);
  g.quadraticCurveTo(12, -19, 11, -4);
  g.lineTo(11, 2);
  g.quadraticCurveTo(19, -6, 20, 2);
  g.quadraticCurveTo(21, 8, 11, 12);
  g.lineTo(10, 14);
  g.closePath();
}

function drawMitten(g: CanvasRenderingContext2D, hit: boolean): void {
  mittenPath(g);
  inkFill(g, PAL.cobalt, 2.6, 2.6);
  g.save();
  mittenPath(g);
  g.clip();
  g.fillStyle = PAL.cobaltShade;
  g.fillRect(3, -22, 20, 40);
  g.restore();
  mittenPath(g);
  g.lineWidth = 2.6;
  g.strokeStyle = INK;
  g.stroke();
  roundRectPath(g, -12, 12, 24, 8, 3);
  inkFill(g, PAL.white, 2.4, 1.5);
  g.fillStyle = PAL.tomato;
  for (let x = -8; x <= 8; x += 8) {
    g.beginPath();
    g.arc(x, 16, 1.8, 0, TAU);
    g.fill();
  }
  face(g, 0, -6, 3.4, hit);
}

function sweaterPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-14, -26);
  g.quadraticCurveTo(0, -18, 14, -26);
  g.lineTo(26, -22);
  g.lineTo(40, 6);
  g.lineTo(36, 14);
  g.lineTo(28, 12);
  g.lineTo(24, -2);
  g.lineTo(24, 28);
  g.quadraticCurveTo(0, 32, -24, 28);
  g.lineTo(-24, -2);
  g.lineTo(-28, 12);
  g.lineTo(-36, 14);
  g.lineTo(-40, 6);
  g.lineTo(-26, -22);
  g.closePath();
}

function drawSweater(g: CanvasRenderingContext2D, hit: boolean): void {
  sweaterPath(g);
  inkFill(g, PAL.banana, 3, 3.4);
  g.save();
  sweaterPath(g);
  g.clip();
  g.fillStyle = PAL.bananaShade;
  g.fillRect(12, -30, 40, 70);
  // The zig-zag knit band.
  g.fillStyle = PAL.tomato;
  g.beginPath();
  g.moveTo(-44, 6);
  for (let x = -44, i = 0; x <= 44; x += 6, i++) g.lineTo(x, i % 2 ? 1 : 7);
  g.lineTo(44, 13);
  for (let x = 44, i = 0; x >= -44; x -= 6, i++) g.lineTo(x, i % 2 ? 13 : 19);
  g.closePath();
  g.fill();
  // Ribbed hem and cuffs.
  g.fillStyle = PAL.tomatoShade;
  g.fillRect(-26, 23, 52, 8);
  g.restore();
  sweaterPath(g);
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.moveTo(-14, -26);
  g.quadraticCurveTo(0, -14, 14, -26);
  g.lineWidth = 2.4;
  g.stroke();
  g.lineWidth = 1.2;
  for (let x = -22; x <= 22; x += 4) {
    g.beginPath();
    g.moveTo(x, 24);
    g.lineTo(x, 30);
    g.stroke();
  }
  face(g, 0, -9, 4.6, hit);
}

// ---------------------------------------------------------------------------------------------------------------
// Bosses (bodies; their eyes and mouths are drawn live)
// ---------------------------------------------------------------------------------------------------------------

function drawKing(g: CanvasRenderingContext2D): void {
  // A huge lint fluff with a crown.
  bumpy(g, 74, 58, 18, 0.12, 9);
  inkFill(g, C.fluff, 4, 5);
  g.save();
  bumpy(g, 74, 58, 18, 0.12, 9);
  g.clip();
  g.fillStyle = C.fluffShade;
  g.beginPath();
  g.ellipse(26, 30, 64, 40, -0.3, 0, TAU);
  g.fill();
  g.restore();
  bumpy(g, 74, 58, 18, 0.12, 9);
  g.lineWidth = 4;
  g.strokeStyle = INK;
  g.stroke();
  g.strokeStyle = C.fluffDeep;
  g.lineWidth = 2;
  g.lineCap = "round";
  for (const [x, y] of [[-48, -10], [44, 2], [-30, 30], [10, 40], [52, -28], [-56, 18]] as const) {
    g.beginPath();
    g.moveTo(x - 5, y);
    g.quadraticCurveTo(x, y - 5, x + 5, y);
    g.stroke();
  }
  // Cheeks.
  g.fillStyle = C.cheek;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 44, 12, 11, 6, 0, 0, TAU);
    g.fill();
  }
  // Crown.
  g.beginPath();
  g.moveTo(-34, -48);
  g.lineTo(-38, -86);
  g.lineTo(-18, -64);
  g.lineTo(0, -94);
  g.lineTo(18, -64);
  g.lineTo(38, -86);
  g.lineTo(34, -48);
  g.quadraticCurveTo(0, -40, -34, -48);
  g.closePath();
  inkFill(g, PAL.banana, 3.4, 3.4);
  for (const [x, y, c] of [[0, -58, PAL.tomato], [-22, -54, PAL.cobalt], [22, -54, PAL.lime]] as const) {
    g.beginPath();
    g.arc(x, y, 5, 0, TAU);
    inkFill(g, c, 2, 0);
  }
  shine(g, -16, -70, 4, -1);
}

function drawSpin(g: CanvasRenderingContext2D): void {
  // A washing machine: white cabinet, control strip, a big porthole (its water and eye are live).
  roundRectPath(g, -62, -68, 124, 136, 16);
  inkFill(g, "#F6F3EC", 4, 5);
  g.save();
  roundRectPath(g, -62, -68, 124, 136, 16);
  g.clip();
  g.fillStyle = "#D9D4E4";
  g.fillRect(36, -70, 30, 140);
  g.restore();
  roundRectPath(g, -62, -68, 124, 136, 16);
  g.lineWidth = 4;
  g.strokeStyle = INK;
  g.stroke();
  // Control strip.
  g.beginPath();
  g.moveTo(-62, -40);
  g.lineTo(62, -40);
  g.lineWidth = 3.4;
  g.stroke();
  roundRectPath(g, -46, -60, 40, 13, 4);
  inkFill(g, PAL.lime, 2.4, 0);
  for (const [x, c] of [[18, PAL.tomato], [40, PAL.banana]] as const) {
    g.beginPath();
    g.arc(x, -54, 8, 0, TAU);
    inkFill(g, c, 2.6, 2);
    g.beginPath();
    g.moveTo(x, -54);
    g.lineTo(x + 4, -59);
    g.lineWidth = 2;
    g.stroke();
  }
  // Porthole ring.
  g.beginPath();
  g.arc(0, 14, 46, 0, TAU);
  inkFill(g, C.steel, 4, 3);
  g.beginPath();
  g.arc(0, 14, 46, Math.PI * 0.95, Math.PI * 1.6);
  g.lineWidth = 3;
  g.strokeStyle = PAL.white;
  g.stroke();
  // Feet.
  for (const s of [-1, 1]) {
    roundRectPath(g, s * 44 - 9, 64, 18, 10, 3);
    inkFill(g, INK, 2, 0);
  }
}

function hamperBody(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-64, -26);
  g.lineTo(64, -26);
  g.lineTo(52, 54);
  g.quadraticCurveTo(0, 62, -52, 54);
  g.closePath();
}

function drawHamper(g: CanvasRenderingContext2D): void {
  // Socks spilling over the back rim.
  for (const [x, rot, c] of [[-38, -0.5, PAL.cobalt], [30, 0.6, PAL.tomato], [4, 0.1, PAL.lime]] as const) {
    g.save();
    g.translate(x, -24);
    g.rotate(Math.PI + rot);
    g.scale(0.8, 0.8);
    drawSock(g, c, false, false);
    g.restore();
  }
  hamperBody(g);
  inkFill(g, C.wicker, 4, 5);
  g.save();
  hamperBody(g);
  g.clip();
  // The weave.
  g.strokeStyle = C.wickerShade;
  g.lineWidth = 3;
  for (let y = -16; y < 60; y += 11) {
    g.beginPath();
    for (let x = -70, i = 0; x <= 70; x += 10, i++) {
      const yy = y + (i % 2 ? 3 : -3);
      if (x === -70) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  for (let x = -60; x <= 60; x += 15) {
    g.beginPath();
    g.moveTo(x, -26);
    g.lineTo(x * 0.85, 60);
    g.stroke();
  }
  g.fillStyle = "rgba(22,18,28,0.18)";
  g.fillRect(30, -30, 40, 100);
  g.restore();
  hamperBody(g);
  g.lineWidth = 4;
  g.strokeStyle = INK;
  g.stroke();
  // Rim band.
  roundRectPath(g, -68, -32, 136, 14, 6);
  inkFill(g, C.wickerShade, 3.4, 2);
  // Handles.
  for (const s of [-1, 1]) {
    roundRectPath(g, s * 40 - 12, 8, 24, 9, 4);
    inkFill(g, INK, 2, 0);
  }
}

function drawHamperLid(g: CanvasRenderingContext2D): void {
  // Hinged at the back-left (the origin), 136 wide.
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(136, 0);
  g.quadraticCurveTo(140, -16, 120, -20);
  g.lineTo(16, -20);
  g.quadraticCurveTo(-4, -16, 0, 0);
  g.closePath();
  inkFill(g, C.wicker, 3.6, 3);
  roundRectPath(g, 56, -30, 24, 12, 5);
  inkFill(g, C.wickerShade, 3, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Loot, stickers, backdrop
// ---------------------------------------------------------------------------------------------------------------

function drawCoin(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.arc(0, 0, 9, 0, TAU);
  inkFill(g, PAL.banana, 2.4, 1.8);
  g.beginPath();
  g.arc(0, 0, 5.5, 0, TAU);
  g.lineWidth = 1.6;
  g.strokeStyle = PAL.bananaShade;
  g.stroke();
  shine(g, -3.5, -3.5, 2.2, -0.8);
}

function drawButton(g: CanvasRenderingContext2D, c: string): void {
  g.beginPath();
  g.arc(0, 0, 9.5, 0, TAU);
  inkFill(g, c, 2.4, 1.8);
  g.beginPath();
  g.arc(0, 0, 6.5, 0, TAU);
  g.lineWidth = 1.4;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = INK;
  for (const [x, y] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]] as const) {
    g.beginPath();
    g.arc(x, y, 1.3, 0, TAU);
    g.fill();
  }
}

export const POWER_FILL: Record<PowerKind, string> = { spread: PAL.lime, rapid: PAL.tomato, shield: PAL.cobalt, magnet: PAL.banana };

/** Power-up icons, drawn into a ~22 px box at the origin. */
export function powerIcon(g: CanvasRenderingContext2D, kind: PowerKind, s = 1): void {
  g.save();
  g.scale(s, s);
  g.lineJoin = "round";
  g.lineCap = "round";
  switch (kind) {
    case "spread":
      for (const a of [-0.45, 0, 0.45]) {
        g.save();
        g.rotate(a);
        roundRectPath(g, -2.6, -11, 5.2, 12, 2.6);
        inkFill(g, PAL.white, 1.6, 0);
        g.restore();
      }
      break;
    case "rapid":
      g.beginPath();
      g.moveTo(3, -11);
      g.lineTo(-6, 2);
      g.lineTo(0, 2);
      g.lineTo(-3, 11);
      g.lineTo(7, -3);
      g.lineTo(1, -3);
      g.closePath();
      inkFill(g, PAL.banana, 1.8, 0);
      break;
    case "shield":
      g.beginPath();
      g.arc(0, 0, 9, 0, TAU);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = PAL.white;
      g.stroke();
      shine(g, -3.5, -4, 2.6, -0.8);
      break;
    case "magnet":
      g.beginPath();
      g.arc(0, -1, 7.5, Math.PI, 0);
      g.lineWidth = 6.5;
      g.strokeStyle = INK;
      g.stroke();
      g.lineWidth = 4;
      g.strokeStyle = PAL.tomato;
      g.stroke();
      for (const x of [-7.5, 7.5]) {
        g.beginPath();
        g.moveTo(x, -1);
        g.lineTo(x, 7);
        g.lineWidth = 6.5;
        g.strokeStyle = INK;
        g.stroke();
        g.lineWidth = 4;
        g.strokeStyle = PAL.white;
        g.stroke();
      }
      break;
  }
  g.restore();
}

function drawPower(g: CanvasRenderingContext2D, kind: PowerKind): void {
  // A die-cut sticker badge.
  g.beginPath();
  g.arc(0, 0, 20, 0, TAU);
  g.fillStyle = INK;
  g.save();
  g.translate(2.5, 3);
  g.fill();
  g.restore();
  g.fillStyle = PAL.white;
  g.fill();
  g.beginPath();
  g.arc(0, 0, 15.5, 0, TAU);
  inkFill(g, POWER_FILL[kind], 2.6, 0);
  powerIcon(g, kind, 1);
  g.beginPath();
  g.arc(0, 0, 20, 0, TAU);
  g.lineWidth = 2.6;
  g.strokeStyle = INK;
  g.stroke();
}

function drawHeart(g: CanvasRenderingContext2D, empty: boolean): void {
  heartPath(g, 11);
  if (empty) {
    g.fillStyle = "rgba(22,18,28,0.35)";
    g.fill();
    g.lineWidth = 2.6;
    g.strokeStyle = INK;
    g.stroke();
    return;
  }
  inkFill(g, PAL.tomato, 2.6, 2.4);
  shine(g, -5, -3, 2.8, -0.9);
}

/** Background clouds: printed in the sky's own violets so they stay behind the action. */
function drawCloud(g: CanvasRenderingContext2D, w: number, seed: number): void {
  const h = w * 0.42;
  g.save();
  g.translate(w * 0.05, h * 0.18);
  bumpy(g, w / 2, h / 2, 9, 0.28, seed);
  g.fillStyle = C.cloudShade;
  g.fill();
  g.restore();
  bumpy(g, w / 2, h / 2, 9, 0.28, seed);
  g.fillStyle = C.cloud;
  g.fill();
  g.lineWidth = 2.2;
  g.strokeStyle = C.cloudLine;
  g.lineJoin = "round";
  g.stroke();
}

function drawGlove(g: CanvasRenderingContext2D, s: number): void {
  const lw = Math.max(2, s * 0.07);
  const parts: Array<(g2: CanvasRenderingContext2D) => void> = [
    (g2) => {
      g2.moveTo(s * 0.14, s * 1.05);
      g2.lineTo(s * 0.86, s * 1.05);
      g2.lineTo(s * 0.9, s * 1.36);
      g2.lineTo(s * 0.1, s * 1.36);
      g2.closePath();
    },
    (g2) => {
      g2.moveTo(s * 0.08, s * 0.62);
      g2.quadraticCurveTo(s * 0.02, s * 0.42, s * 0.24, s * 0.4);
      g2.lineTo(s * 0.92, s * 0.42);
      g2.quadraticCurveTo(s * 1.08, s * 0.5, s * 0.98, s * 0.74);
      g2.quadraticCurveTo(s * 0.98, s * 1.08, s * 0.62, s * 1.1);
      g2.lineTo(s * 0.3, s * 1.1);
      g2.quadraticCurveTo(s * 0.06, s * 1.0, s * 0.08, s * 0.62);
      g2.closePath();
    },
    (g2) => {
      g2.moveTo(s * 0.08, s * 0.66);
      g2.lineTo(s * 0.08, s * 0.06);
      g2.quadraticCurveTo(s * 0.08, -s * 0.06, s * 0.2, -s * 0.06);
      g2.quadraticCurveTo(s * 0.32, -s * 0.06, s * 0.32, s * 0.06);
      g2.lineTo(s * 0.32, s * 0.6);
      g2.closePath();
    },
  ];
  g.lineJoin = "round";
  g.save();
  g.translate(s * 0.06, s * 0.08);
  for (const p of parts) {
    g.beginPath();
    p(g);
    g.fillStyle = INK;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
  }
  g.restore();
  for (const [i, p] of parts.entries()) {
    g.beginPath();
    p(g);
    g.fillStyle = i === 0 ? PAL.cream : PAL.white;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.stroke();
  }
  g.strokeStyle = INK;
  g.lineWidth = lw * 0.7;
  g.lineCap = "round";
  for (const x of [0.5, 0.72]) {
    g.beginPath();
    g.moveTo(s * x, s * 0.44);
    g.lineTo(s * x, s * 0.64);
    g.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------------------

export function makeArt(k: number): Art {
  const sp = (w: number, h: number, ox: number, oy: number, draw: (g: CanvasRenderingContext2D) => void) => makeSprite(w, h, ox, oy, draw, k);
  const sock = (c: string, hit: boolean) => sp(44, 64, 15, 13, (g) => drawSock(g, c, hit, true));
  const glove = 44;
  return {
    k,
    iron: sp(60, 72, 30, 34, drawIron),
    steam: sp(16, 40, 8, 14, (g) => {
      // A steam streak: a round head and a tapering tail.
      g.beginPath();
      g.moveTo(-4.5, -8);
      g.arc(0, -8, 4.5, Math.PI, 0);
      g.lineTo(2, 22);
      g.quadraticCurveTo(0, 25, -2, 22);
      g.closePath();
      inkFill(g, PAL.white, 2, 0);
      g.fillStyle = "#CFE3FF";
      g.fillRect(-1, -7, 2.2, 14);
    }),
    spark: sp(30, 30, 15, 15, (g) => {
      starPath(g, 11.5, 8, 0.58);
      inkFill(g, PAL.tomato, 2.6, 0);
      g.beginPath();
      g.arc(0, 0, 4.6, 0, TAU);
      g.fillStyle = PAL.white;
      g.fill();
    }),
    socks: STRIPES.map((c) => sock(c, false)),
    socksHit: STRIPES.map((c) => sock(c, true)),
    minisock: sp(44, 60, 15, 4, (g) => drawSock(g, PAL.bubblegum, false, false)),
    fluff: sp(40, 44, 20, 24, (g) => drawFluff(g, false)),
    fluffHit: sp(40, 44, 20, 24, (g) => drawFluff(g, true)),
    tee: [sp(60, 46, 30, 20, (g) => drawTee(g, true, false)), sp(60, 46, 30, 20, (g) => drawTee(g, false, false))],
    teeHit: sp(60, 46, 30, 20, (g) => drawTee(g, false, true)),
    mitten: sp(40, 46, 16, 22, (g) => drawMitten(g, false)),
    mittenHit: sp(40, 46, 16, 22, (g) => drawMitten(g, true)),
    sweater: sp(90, 66, 45, 30, (g) => drawSweater(g, false)),
    sweaterHit: sp(90, 66, 45, 30, (g) => drawSweater(g, true)),
    coin: sp(24, 24, 12, 12, drawCoin),
    buttons: [PAL.bubblegum, PAL.cobaltHi, PAL.lime].map((c) => sp(26, 26, 13, 13, (g) => drawButton(g, c))),
    power: {
      spread: sp(48, 48, 23, 23, (g) => drawPower(g, "spread")),
      rapid: sp(48, 48, 23, 23, (g) => drawPower(g, "rapid")),
      shield: sp(48, 48, 23, 23, (g) => drawPower(g, "shield")),
      magnet: sp(48, 48, 23, 23, (g) => drawPower(g, "magnet")),
    },
    heart: sp(30, 28, 14, 13, (g) => drawHeart(g, false)),
    heartEmpty: sp(30, 28, 14, 13, (g) => drawHeart(g, true)),
    king: sp(176, 176, 88, 104, drawKing),
    spin: sp(140, 160, 70, 76, drawSpin),
    hamper: sp(160, 120, 80, 50, drawHamper),
    hamperLid: sp(150, 40, 6, 34, drawHamperLid),
    clouds: [
      sp(104, 54, 52, 25, (g) => drawCloud(g, 90, 1)),
      sp(78, 42, 39, 19, (g) => drawCloud(g, 66, 2)),
      sp(132, 68, 66, 31, (g) => drawCloud(g, 116, 3)),
    ],
    glove: sp(glove * 1.4, glove * 1.7, glove * 0.1, glove * 0.12, (g) => drawGlove(g, glove)),
  };
}

/** The sprite for an enemy this frame. */
export function enemySprite(art: Art, kind: EnemyKind, stripe: number, hit: boolean, t: number): Sprite {
  switch (kind) {
    case "sock":
      return (hit ? art.socksHit : art.socks)[stripe % STRIPES.length]!;
    case "minisock":
      return art.minisock;
    case "fluff":
      return hit ? art.fluffHit : art.fluff;
    case "tee":
      return hit ? art.teeHit : art.tee[Math.floor(Math.abs(t) * 6) % 2]!;
    case "mitten":
      return hit ? art.mittenHit : art.mitten;
    case "sweater":
      return hit ? art.sweaterHit : art.sweater;
  }
}
