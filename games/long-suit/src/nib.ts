import { INK, PAPER, rgba } from "./qm/palette.ts";

/** A fountain-pen nib in a 100 × 100 box, tip at (50, 100). */
const BODY = "M 50 100 L 31.5 57 C 28 49 28.5 41 32.5 34.5 L 35 28 L 65 28 L 67.5 34.5 C 71.5 41 72 49 68.5 57 Z";
const COLLAR = "M 33.5 27 L 66.5 27 L 68.5 13 L 31.5 13 Z";

let body: Path2D | null = null;
let collar: Path2D | null = null;

/** Draws the nib with its tip at (x, y), leaning like a pen held in the right hand. */
export function drawNib(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha = 1, lean = 0.52): void {
  body ??= new Path2D(BODY);
  collar ??= new Path2D(COLLAR);
  const k = size / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.scale(k, k);
  ctx.translate(-50, -100);
  ctx.fillStyle = rgba(INK, 0.94 * alpha);
  ctx.fill(body);
  ctx.fillStyle = rgba(INK, 0.8 * alpha);
  ctx.fill(collar);
  ctx.strokeStyle = rgba(PAPER, 0.9 * alpha);
  ctx.lineCap = "round";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(50, 96);
  ctx.lineTo(50, 56);
  ctx.stroke();
  // Engraved scrolls on the shoulders.
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(37, 36);
  ctx.quadraticCurveTo(42, 46, 47, 44);
  ctx.moveTo(63, 36);
  ctx.quadraticCurveTo(58, 46, 53, 44);
  ctx.stroke();
  ctx.fillStyle = rgba(PAPER, 0.92 * alpha);
  ctx.beginPath();
  ctx.arc(50, 52, 3.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
