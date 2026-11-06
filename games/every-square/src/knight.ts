import { INK, PAPER, rgba } from "./qm/palette.ts";

/** An ink knight, drawn in a 100 × 100 box facing left. */
const BODY =
  "M 24 93 L 78 93 C 79 89 78 86 74 85 C 77 70 82 56 80 42 C 78 28 70 19 60 15 L 61 7 C 56 9 53 12 51 15 L 47 8 " +
  "C 44 12 43 15 43 18 C 33 22 25 31 20 42 C 17 48 15 53 17 57 C 19 61 24 62 28 60 C 32 58 36 55 41 55 " +
  "C 45 55 49 53 52 50 C 50 60 40 68 34 76 C 31 80 30 83 30 85 C 26 86 24 89 24 93 Z";
const MANE = "M 64 24 C 72 32 75 44 73 56 M 68.5 22 C 76.5 31 79.5 44 77.5 58";

let body: Path2D | null = null;
let mane: Path2D | null = null;

/** Draws the knight centred at (x, y), `size` px tall. `ink` lets the end state fade it to graphite. */
export function drawKnight(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, ink = INK, alpha = 1): void {
  body ??= new Path2D(BODY);
  mane ??= new Path2D(MANE);
  const k = size / 100;
  ctx.save();
  ctx.translate(x - 50 * k, y - 52 * k);
  ctx.scale(k, k);
  // Bleed first, then the body.
  ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(ink, 0.12 * alpha);
  ctx.lineWidth = 5;
  ctx.stroke(body);
  ctx.fillStyle = rgba(ink, 0.94 * alpha);
  ctx.fill(body);
  ctx.strokeStyle = rgba(PAPER, 0.9 * alpha);
  ctx.lineCap = "round";
  ctx.lineWidth = 1.7;
  ctx.stroke(mane);
  ctx.beginPath();
  ctx.moveTo(30, 88);
  ctx.lineTo(74, 88);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = rgba(PAPER, 0.92 * alpha);
  ctx.beginPath();
  ctx.arc(38, 30, 2.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(21.5, 50.5, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
