import { begin, boil, ellipse, fillBuf, highlight, ink, line, PAL, pt, shash } from "./ink.ts";

export interface ArcherPose {
  /** Feet position. */
  x: number;
  y: number;
  /** Aim angle (radians, screen space: 0 = right, negative = up). */
  aim: number;
  /** How far the string is drawn, 0-1. */
  power: number;
  /** An arrow sits on the string. */
  nocked: boolean;
  /** Arrows left in the back quiver (only the first few fletchings show). */
  quiver: number;
  /** 0-1 after a release: the string twangs and the arm follows through. */
  twang: number;
  /** Seconds, for breathing and blinking. */
  time: number;
  /** Arm fatigue tremble 0-1 (held the draw too long). */
  tremble: number;
  /** 0 = normal, 1 = slumped (out of arrows). */
  slump: number;
}

/** The archer is drawn at this scale (line widths are tuned for it). */
export const ARCHER_SCALE = 1.32;

/** The bow hand for a pose: where the arrow leaves the bow. */
export function bowHand(p: Pick<ArcherPose, "x" | "y" | "aim">): { x: number; y: number } {
  const k = ARCHER_SCALE;
  const sx = p.x + 5 * k;
  const sy = p.y - 53 * k;
  return { x: sx + Math.cos(p.aim) * 22 * k, y: sy + Math.sin(p.aim) * 22 * k };
}

/** A stick-figure archer in ballpoint: pointed cap (green highlighter), red feather, back quiver, bow and string. */
export function drawArcher(ctx: CanvasRenderingContext2D, p: ArcherPose): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(ARCHER_SCALE, ARCHER_SCALE);
  body(ctx, p);
  ctx.restore();
}

function body(ctx: CanvasRenderingContext2D, p: ArcherPose): void {
  const fx = 0;
  const fy = 0;
  const breathe = Math.sin(p.time * 2.2) * 0.8;
  const slump = p.slump;
  const trem = p.tremble * p.tremble;
  const tj = trem > 0 ? shash(boil.step, 3) * 0.05 * trem : 0;
  const aim = p.aim + tj;
  const c = Math.cos(aim);
  const s = Math.sin(aim);
  // Perpendicular, pointing "below" the aim line.
  const nx = -s;
  const ny = c;

  const hipX = fx + 1;
  const hipY = fy - 27;
  const shX = fx + 5 - slump * 4;
  const shY = fy - 53 + breathe + slump * 6;
  const headX = shX + 2 - slump * 3;
  const headY = shY - 14 + slump * 4;

  // Back quiver: a slanted, paper-filled tube on the back with arrow tails (red fletching) sticking out.
  const qx0 = shX - 7;
  const qy0 = shY + 1;
  const qx1 = shX;
  const qy1 = shY + 25;
  const qd = Math.atan2(qy1 - qy0, qx1 - qx0);
  const shown = Math.min(2, p.quiver);
  for (let i = 0; i < shown; i++) {
    // Arrow tails poking out of the mouth: a short shaft and a tiny red "v" of fletching.
    const a = qd + Math.PI + (i ? 0.22 : -0.08);
    const ox = qx0 + (i ? 2.5 : -1);
    const oy = qy0;
    const ex = ox + Math.cos(a) * 9;
    const ey = oy + Math.sin(a) * 9;
    line(ctx, ox, oy, ex, ey, 310 + i, { width: 1, passes: 1, jitter: 0.25 });
    const c2 = Math.cos(a);
    const s2 = Math.sin(a);
    line(ctx, ex - c2 * 3.5, ey - s2 * 3.5, ex - s2 * 2.2, ey + c2 * 2.2, 320 + i, { width: 1, passes: 1, color: PAL.red, jitter: 0.15 });
    line(ctx, ex - c2 * 3.5, ey - s2 * 3.5, ex + s2 * 2.2, ey - c2 * 2.2, 330 + i, { width: 1, passes: 1, color: PAL.red, jitter: 0.15 });
  }
  begin();
  pt(qx0 - 4, qy0 + 1);
  pt(qx1 - 3.5, qy1 + 1);
  pt(qx1 + 3, qy1 - 1);
  pt(qx0 + 3.5, qy0 - 1.5);
  fillBuf(ctx, PAL.paper);
  begin();
  pt(qx0 - 4, qy0 + 1);
  pt(qx1 - 3.5, qy1 + 1);
  pt(qx1 + 3, qy1 - 1);
  pt(qx0 + 3.5, qy0 - 1.5);
  pt(qx0 - 4, qy0 + 1);
  ink(ctx, 340, { width: 1.3, passes: 1, jitter: 0.35 });
  line(ctx, qx0 - 1.5, qy0 + 8, qx0 + 4.5, qy0 + 6.5, 341, { width: 0.9, passes: 1, color: PAL.graphite });
  line(ctx, qx0 + 0.5, qy0 + 15, qx0 + 6.5, qy0 + 13.5, 342, { width: 0.9, passes: 1, color: PAL.graphite });

  // Legs: a confident stance; each leg its own stroke so the hip stays a sharp joint.
  begin();
  pt(hipX, hipY);
  pt(fx - 6, fy - 13);
  pt(fx - 12, fy);
  ink(ctx, 350, { width: 1.8 });
  begin();
  pt(hipX, hipY);
  pt(fx + 8, fy - 13);
  pt(fx + 15, fy);
  ink(ctx, 354, { width: 1.8 });
  line(ctx, fx + 15, fy, fx + 21, fy - 0.5, 351, { width: 2, passes: 1 });
  line(ctx, fx - 12, fy, fx - 6, fy + 0.5, 352, { width: 2, passes: 1 });
  // Torso, up to the chin.
  begin();
  pt(hipX, hipY + 1);
  pt((hipX + shX) / 2 - 1, (hipY + shY) / 2);
  pt(shX, shY);
  pt(headX - 1, headY + 9);
  ink(ctx, 353, { width: 1.9 });

  // Head and face.
  ellipse(ctx, headX, headY, 9, 9.5, 360, { width: 1.6 });
  const look = slump > 0.5 ? 0.6 : aim;
  const ex = headX + 1 + Math.cos(look) * 3;
  const ey = headY + Math.sin(look) * 2.2 - 0.5;
  const blink = p.time % 3.7 < 0.12;
  ctx.fillStyle = PAL.inkDeep;
  if (blink) {
    line(ctx, ex - 1.4, ey, ex + 1.4, ey, 361, { width: 1.1, passes: 1 });
    line(ctx, ex + 3.4, ey - 0.4, ex + 5.8, ey - 0.4, 362, { width: 1.1, passes: 1 });
  } else {
    ctx.beginPath();
    ctx.arc(ex, ey, 1.15, 0, Math.PI * 2);
    ctx.arc(ex + 4.4, ey - 0.4, 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  if (slump > 0.5) {
    begin();
    pt(headX, headY + 5.5);
    pt(headX + 2.8, headY + 4.2);
    pt(headX + 5.6, headY + 5.5);
    ink(ctx, 363, { width: 1.1, passes: 1, jitter: 0.25 });
  } else if (p.power > 0.7) {
    // Gritted teeth.
    begin();
    for (let i = 0; i <= 4; i++) pt(headX + 1 + i * 1.4, headY + 4.8 + (i % 2 ? -0.9 : 0.9));
    ink(ctx, 364, { width: 0.9, passes: 1, jitter: 0.15 });
  } else {
    begin();
    pt(headX + 1, headY + 4.2);
    pt(headX + 3.2, headY + 5.4);
    pt(headX + 5.6, headY + 4);
    ink(ctx, 365, { width: 1.1, passes: 1, jitter: 0.2 });
  }
  // Pointed cap, leaning back a little, with one red feather.
  const cbx0 = headX - 9;
  const cby0 = headY - 4;
  const cbx1 = headX + 8.5;
  const cby1 = headY - 6;
  const tipX = headX - 11;
  const tipY = headY - 19;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cbx0, cby0);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(cbx1, cby1);
  ctx.closePath();
  ctx.clip();
  highlight(ctx, tipX - 2, tipY - 2, cbx1 - tipX + 4, cby0 - tipY + 4, 366, PAL.hiGreen, 0.75);
  ctx.restore();
  begin();
  pt(cbx0, cby0);
  pt(tipX, tipY);
  pt(cbx1, cby1);
  pt(cbx0 - 1, cby0 + 0.5);
  ink(ctx, 367, { width: 1.5 });
  // Feather: a slim red leaf with a quill line.
  const f0x = headX - 3;
  const f0y = headY - 8;
  const f1x = headX - 16;
  const f1y = headY - 23;
  begin();
  pt(f0x, f0y);
  pt(f0x - 8, f0y - 4);
  pt(f1x, f1y);
  pt(f0x - 3, f0y - 10);
  pt(f0x, f0y);
  ink(ctx, 368, { width: 1.2, color: PAL.red, passes: 1, jitter: 0.3 });
  line(ctx, f0x + 1, f0y + 1, f1x + 3, f1y + 3, 369, { width: 0.9, passes: 1, color: PAL.red, jitter: 0.2 });

  // Bow arm, bow, string, draw arm.
  const hx = shX + c * 22 * (1 - slump * 0.4) + slump * 2;
  const hy = shY + s * 22 * (1 - slump * 0.4) + slump * 14;
  const pw = p.power;
  const bend = 5 + 8 * pw;
  const tx = hx - nx * 26 - c * bend;
  const ty = hy - ny * 26 - s * bend;
  const bx = hx + nx * 26 - c * bend;
  const by = hy + ny * 26 - s * bend;
  // Twang: the string's middle oscillates after release.
  const tw = p.twang > 0 ? Math.sin(p.twang * 60) * 5 * p.twang : 0;
  const pull = 6 + 26 * pw;
  const nockX = hx - c * pull - c * tw;
  const nockY = hy - s * pull - s * tw;

  line(ctx, shX, shY, hx, hy, 380, { width: 1.8 });
  begin();
  pt(tx, ty);
  pt(hx + c * 3 - nx * 14, hy + s * 3 - ny * 14);
  pt(hx + c * 4, hy + s * 4);
  pt(hx + c * 3 + nx * 14, hy + s * 3 + ny * 14);
  pt(bx, by);
  ink(ctx, 381, { width: 2.2, color: PAL.inkDeep });
  // String in pencil.
  begin();
  pt(tx, ty);
  pt(nockX, nockY);
  pt(bx, by);
  ink(ctx, 382, { width: 0.8, color: PAL.graphite, passes: 1, jitter: 0.25 });
  // Grip wrap.
  line(ctx, hx - nx * 3, hy - ny * 3, hx + nx * 3, hy + ny * 3, 383, { width: 2.4, passes: 1, color: PAL.inkDeep });

  // Draw arm: shoulder → raised elbow → nock.
  const elX = (shX + nockX) / 2 - nx * 8 - c * 2;
  const elY = (shY + nockY) / 2 - ny * 8 - s * 2;
  begin();
  pt(shX, shY);
  pt(elX, elY);
  pt(nockX, nockY);
  ink(ctx, 384, { width: 1.7 });

  if (p.nocked) drawArrow(ctx, nockX + c * 34, nockY + s * 34, aim, 390, 34, 1, 0.8);
}

/** A doodled arrow with its tip at (x, y): ballpoint shaft and head, red-pen fletching. */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, seed: number, len = 38, alpha = 1, w = 1): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const nx = -s;
  const ny = c;
  const tx = x - c * len;
  const ty = y - s * len;
  line(ctx, tx, ty, x - c * 4, y - s * 4, seed, { width: 1.9 * w, passes: 1, jitter: 0.5, alpha });
  // Head.
  begin();
  pt(x + c * 1.5, y + s * 1.5);
  pt(x - c * 8 + nx * 4.2, y - s * 8 + ny * 4.2);
  pt(x - c * 6 , y - s * 6);
  pt(x - c * 8 - nx * 4.2, y - s * 8 - ny * 4.2);
  pt(x + c * 1.5, y + s * 1.5);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = PAL.inkDeep;
  ctx.beginPath();
  ctx.moveTo(x + c * 1.5, y + s * 1.5);
  ctx.lineTo(x - c * 8 + nx * 4.2, y - s * 8 + ny * 4.2);
  ctx.lineTo(x - c * 6, y - s * 6);
  ctx.lineTo(x - c * 8 - nx * 4.2, y - s * 8 - ny * 4.2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ink(ctx, seed + 1, { width: 1.3, passes: 1, jitter: 0.3, alpha });
  // Fletching: two pairs of red feathers.
  for (let k = 0; k < 2; k++) {
    const fx = tx + c * (3 + k * 5);
    const fy = ty + s * (3 + k * 5);
    line(ctx, fx, fy, fx - c * 6 + nx * 5, fy - s * 6 + ny * 5, seed + 3 + k, { width: 1.4, passes: 1, color: PAL.red, jitter: 0.3, alpha });
    line(ctx, fx, fy, fx - c * 6 - nx * 5, fy - s * 6 - ny * 5, seed + 5 + k, { width: 1.4, passes: 1, color: PAL.red, jitter: 0.3, alpha });
  }
}
