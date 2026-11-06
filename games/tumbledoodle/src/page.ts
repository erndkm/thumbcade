/**
 * The notebook page in page units: paper, printed rules and margin, punched holes, a coffee ring, faint pencil
 * homework, and the desk around it. Drawn every frame under the camera transform, only what is in view; the paper
 * grain is one pre-rendered tile laid in page space so it moves with the page.
 */
import { hand, hash, PAL, write } from "./ink.ts";
import { PAGE_H, PAGE_W } from "./sim.ts";

export const RULE_GAP = 52;
export const RULE_TOP = 150;
export const MARGIN_X = 196;
export const DESK = "#2C2622";
/** Device px of the paper tile (opaque paper with its grain baked in). */
const TILE = 512;

let paper: HTMLCanvasElement | null = null;

function paperTile(): HTMLCanvasElement {
  if (paper) return paper;
  paper = document.createElement("canvas");
  paper.width = paper.height = TILE;
  const g = paper.getContext("2d", { alpha: false })!;
  g.fillStyle = PAL.paper;
  g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 1400; i++) {
    const a = 0.03 + hash(i, 13) * 0.06;
    g.fillStyle = hash(i, 14) < 0.5 ? `rgba(120,100,70,${a})` : `rgba(90,90,100,${a})`;
    const s = 1 + hash(i, 15) * 1.8;
    g.fillRect(hash(i, 11) * TILE, hash(i, 12) * TILE, s, s);
  }
  g.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 21) * TILE;
    const y = hash(i, 22) * TILE;
    const a = hash(i, 23) * Math.PI;
    const l = 8 + hash(i, 24) * 16;
    g.strokeStyle = "rgba(110,95,70,0.08)";
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return paper;
}

export interface ViewBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen px per page unit. */
  z: number;
}

/** Camera: page units to device px is `x * a + e`, `y * a + f`. */
export interface Cam {
  a: number;
  e: number;
  f: number;
}

/**
 * Draws the desk, the page and its printed lines (ctx in page space, set by `cam`). The paper is an opaque tile with
 * the grain baked in, blitted 1:1 in device px and anchored to the page corner so it moves with the page; scaled
 * tiles cost several times more to raster.
 */
export function drawPage(ctx: CanvasRenderingContext2D, view: ViewBox, cam: Cam): void {
  // A little beyond the view, so a screen shake never shows last frame at the edges.
  const pad = 24 / view.z;
  const v = { x0: view.x0 - pad, y0: view.y0 - pad, x1: view.x1 + pad, y1: view.y1 + pad, z: view.z };
  const x0 = Math.max(0, v.x0);
  const y0 = Math.max(0, v.y0);
  const x1 = Math.min(PAGE_W, v.x1);
  const y1 = Math.min(PAGE_H, v.y1);
  if (v.x0 < 0 || v.y0 < 0 || v.x1 > PAGE_W || v.y1 > PAGE_H) {
    ctx.fillStyle = DESK;
    ctx.fillRect(v.x0 - 2, v.y0 - 2, v.x1 - v.x0 + 4, v.y1 - v.y0 + 4);
    // The page's shadow on the desk.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(10, 14, PAGE_W, PAGE_H);
  }
  if (x1 <= x0 || y1 <= y0) return;
  const sx0 = Math.round(x0 * cam.a + cam.e);
  const sy0 = Math.round(y0 * cam.a + cam.f);
  const sx1 = Math.round(x1 * cam.a + cam.e);
  const sy1 = Math.round(y1 * cam.a + cam.f);
  const ox = Math.round(cam.e);
  const oy = Math.round(cam.f);
  const tile = paperTile();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  ctx.clip();
  const tx0 = ox + Math.floor((sx0 - ox) / TILE) * TILE;
  const ty0 = oy + Math.floor((sy0 - oy) / TILE) * TILE;
  for (let ty = ty0; ty < sy1; ty += TILE) for (let tx = tx0; tx < sx1; tx += TILE) ctx.drawImage(tile, tx, ty);
  ctx.restore();
  const lw = Math.max(1.1, 0.95 / v.z);
  ctx.fillStyle = PAL.rule;
  const first = Math.max(RULE_TOP, RULE_TOP + Math.ceil((y0 - RULE_TOP) / RULE_GAP) * RULE_GAP);
  for (let y = first; y < y1; y += RULE_GAP) ctx.fillRect(x0, y - lw / 2, x1 - x0, lw);
  if (MARGIN_X > x0 && MARGIN_X < x1) {
    ctx.fillStyle = PAL.margin;
    ctx.fillRect(MARGIN_X - lw * 0.8, y0, lw * 1.6, y1 - y0);
  }
  // Punched holes down the left edge.
  for (const k of [0.17, 0.5, 0.83]) {
    const hy = PAGE_H * k;
    if (hy < y0 - 30 || hy > y1 + 30 || x0 > 110) continue;
    // Punched through: the page underneath shows.
    ctx.fillStyle = PAL.paperBack;
    ctx.beginPath();
    ctx.arc(72, hy, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(80,70,50,0.3)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(72, hy, 22, Math.PI * 0.95, Math.PI * 1.9);
    ctx.stroke();
  }
  // A coffee ring.
  const cx = PAGE_W - 210;
  const cy = 520;
  if (cx + 130 > x0 && cx - 130 < x1 && cy + 130 > y0 && cy - 130 < y1) {
    ctx.fillStyle = "rgba(140,92,45,0.04)";
    ctx.beginPath();
    ctx.arc(cx, cy, 118, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      const a0 = (i / 40) * Math.PI * 2;
      if (Math.abs(Math.sin((a0 - 2.4) / 2)) < 0.2) continue;
      ctx.strokeStyle = `rgba(140,92,45,${0.1 + hash(i, 42) * 0.08})`;
      ctx.lineWidth = 2 + 5 * (0.5 + 0.5 * Math.sin(a0 * 3 + 1));
      ctx.beginPath();
      ctx.arc(cx, cy, 114, a0, a0 + (Math.PI * 2) / 38);
      ctx.stroke();
    }
  }
}

/** The faint pencil homework (decoration only, never food). */
export function drawPencilNotes(ctx: CanvasRenderingContext2D, v: ViewBox): void {
  const g = "rgba(98,102,110,0.38)";
  const notes: Array<[string, number, number, number, number]> = [
    ["hw: p.112, #4-18 (evens)", MARGIN_X + 24, RULE_TOP - 18, 34, -0.02],
    ["name: ____________", PAGE_W - 470, RULE_TOP - 20, 30, 0],
    ["ch. 7: area of a circle", MARGIN_X + 30, RULE_TOP + RULE_GAP * 6 - 10, 34, 0.01],
    ["A = πr²   (r keeps getting bigger??)", MARGIN_X + 30, RULE_TOP + RULE_GAP * 7 - 10, 30, -0.01],
    ["do NOT doodle in class", MARGIN_X + 380, RULE_TOP + RULE_GAP * 28 - 10, 32, 0.03],
    ["test on friday!!", MARGIN_X + 60, RULE_TOP + RULE_GAP * 21 - 10, 34, -0.03],
  ];
  for (const [text, x, y, size, rot] of notes) {
    if (y < v.y0 - 40 || y > v.y1 + 40 || x > v.x1 || x + 500 < v.x0) continue;
    write(ctx, text, x, y, hand(size), g, Math.round(x + y), { step: 0, rot });
  }
}
