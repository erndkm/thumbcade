import { begin, ellipse, hash, hatch, ink, line, PAL, pt, shash, write, hand, bold, type Sprite } from "./ink.ts";

/** Notebook geometry shared by the page, the HUD and the handwriting. */
export interface Page {
  W: number;
  H: number;
  /** The red margin line. */
  marginX: number;
  /** First ruled line and the gap between lines. */
  rule0: number;
  ruleGap: number;
  /** Where the doodled ground runs (the archer's feet). */
  groundY: number;
}

/** y of the ruled line closest to `y` (handwriting sits on the lines). */
export function onRule(p: Page, y: number): number {
  return p.rule0 + Math.round((y - p.rule0) / p.ruleGap) * p.ruleGap;
}

/**
 * The static page: paper, grain, rules, margin, punched holes, a coffee ring, a dog-ear and some faint
 * math-class pencil notes. Rendered once per resize; blitted every frame.
 */
export function renderPage(p: Page, dpr: number): HTMLCanvasElement {
  const { W, H } = p;
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, W, H);

  // Grain: tiny specks and fibres.
  const specks = Math.round((W * H) / 700);
  for (let i = 0; i < specks; i++) {
    const x = hash(i, 11) * W;
    const y = hash(i, 12) * H;
    const a = 0.03 + hash(i, 13) * 0.06;
    ctx.fillStyle = hash(i, 14) < 0.5 ? `rgba(120,100,70,${a})` : `rgba(90,90,100,${a})`;
    const s = 0.6 + hash(i, 15) * 1.1;
    ctx.fillRect(x, y, s, s);
  }
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 21) * W;
    const y = hash(i, 22) * H;
    const a = hash(i, 23) * Math.PI;
    const l = 4 + hash(i, 24) * 9;
    ctx.strokeStyle = "rgba(110,95,70,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }

  // Ruled lines (printed, so they are straight; the hand-drawn stuff wobbles, not these).
  ctx.fillStyle = PAL.rule;
  for (let y = p.rule0; y < H; y += p.ruleGap) ctx.fillRect(0, Math.round(y) - 0.5, W, 1);
  // Margin.
  ctx.fillStyle = PAL.margin;
  ctx.fillRect(Math.round(p.marginX) - 0.75, 0, 1.5, H);

  // Punched holes: the page underneath shows through, with a shadow on the upper rim.
  const hx = Math.round(p.marginX * 0.42);
  for (const k of [0.17, 0.5, 0.83]) {
    const hy = Math.round(H * k);
    ctx.fillStyle = PAL.paperBack;
    ctx.beginPath();
    ctx.arc(hx, hy, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(80,70,50,0.25)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hx, hy, 7.8, Math.PI * 0.95, Math.PI * 1.9);
    ctx.stroke();
    ctx.strokeStyle = "rgba(80,70,50,0.12)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(hx, hy, 8.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  coffeeRing(ctx, W - 22, onRule(p, H * 0.27) + 6, 52);
  dogEar(ctx, W, H, 44);

  // Faint pencil: homework note, a projectile sketch and its formula (it is math class, after all).
  ctx.globalAlpha = 1;
  const g = "rgba(98,102,110,0.42)";
  write(ctx, "hw: p.112, #4-18 (evens)", p.marginX + 12, p.rule0 - 6, hand(15), g, 4, { step: 0, rot: -0.02 });
  const gx = W - 158;
  const gy = p.groundY + 92;
  if (gy + 30 < H) {
    line(ctx, gx, gy, gx + 96, gy, 501, { color: g, width: 1, passes: 1, step: 0 });
    line(ctx, gx, gy, gx, gy - 54, 502, { color: g, width: 1, passes: 1, step: 0 });
    ctx.fillStyle = g;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = gx + 4 + t * 84;
      const y = gy - 4 - Math.sin(t * Math.PI) * 44;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    write(ctx, "y = x·tan a - gx", gx - 2, gy + 24, hand(15), g, 5, { step: 0 });
    ctx.font = hand(15);
    const w0 = ctx.measureText("y = x·tan a - gx").width;
    write(ctx, "2", gx - 1 + w0, gy + 17, hand(10), g, 6, { step: 0 });
    write(ctx, "/ 2v", gx + 6 + w0, gy + 24, hand(15), g, 7, { step: 0 });
    write(ctx, "?!", gx + 104, gy - 36, bold(18), "rgba(210,51,47,0.35)", 8, { step: 0, rot: 0.2 });
  }
  return c;
}

function coffeeRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // A stain: a faint wash, a darker dried rim that thins out, a gap where the mug was lifted, one drip.
  ctx.fillStyle = "rgba(140,92,45,0.035)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 48; i++) {
    const a0 = (i / 48) * Math.PI * 2;
    const a1 = ((i + 1.15) / 48) * Math.PI * 2;
    const gap = Math.abs(Math.sin((a0 - 2.4) / 2)) < 0.22;
    if (gap) continue;
    const w = 1 + 2.4 * (0.5 + 0.5 * Math.sin(a0 * 3 + 1)) * (0.6 + hash(i, 41) * 0.4);
    ctx.strokeStyle = `rgba(140,92,45,${0.1 + hash(i, 42) * 0.08})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, r - w / 2 + shash(i, 43) * 0.6, a0, a1);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(140,92,45,0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx + 2, cy - 1, r - 6, 0.4, 3.6);
  ctx.stroke();
  ctx.fillStyle = "rgba(140,92,45,0.12)";
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.86, cy + r * 0.7, 3.2, 2.4, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function dogEar(ctx: CanvasRenderingContext2D, W: number, H: number, s: number): void {
  // The corner is folded over: the next page shows where the corner was, the flap lies on top.
  ctx.fillStyle = PAL.paperBack;
  ctx.beginPath();
  ctx.moveTo(W - s, H);
  ctx.lineTo(W, H - s);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(60,50,30,0.10)";
  ctx.beginPath();
  ctx.moveTo(W - s - 3, H);
  ctx.lineTo(W, H - s - 3);
  ctx.lineTo(W, H - s);
  ctx.lineTo(W - s, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#F3EEE1";
  ctx.beginPath();
  ctx.moveTo(W - s, H);
  ctx.lineTo(W, H - s);
  ctx.lineTo(W - s + 2, H - s + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(80,70,50,0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * The ground the archer stands on, in three boil variants: a wobbly ballpoint horizon with grass tufts, a pebble
 * and a flower, pencil hatching underneath.
 */
export function renderGround(p: Page, dpr: number): Sprite[] {
  const { W } = p;
  const top = 34;
  const h = 64;
  const out: Sprite[] = [];
  for (let v = 0; v < 3; v++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(W * dpr);
    canvas.height = Math.ceil(h * dpr);
    const ctx = canvas.getContext("2d")!;
    // Local origin: x = 0 at the left edge, y = 0 on the ground line.
    ctx.setTransform(dpr, 0, 0, dpr, 0, top * dpr);
    const step = 1000 + v;
    // Hatching under the ground, sparser as it goes down.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-2, 1, W + 4, 26);
    ctx.clip();
    for (let x = -10, i = 0; x < W + 10; x += 6.5, i++) {
      const l = 7 + hash(i, 61) * 12;
      const y0 = 3 + hash(i, 62) * 2;
      line(ctx, x, y0, x - l * 0.45, y0 + l, 600 + i, { color: PAL.graphite, width: 0.9, passes: 1, jitter: 0.5, step, alpha: 0.55 });
    }
    ctx.restore();
    // The horizon.
    begin();
    for (let x = -6, i = 0; x <= W + 6; x += 26, i++) pt(x, Math.sin(x * 0.021 + 1.3) * 1.6 + shash(i, 71) * 1.2);
    ink(ctx, 700, { width: 2.1, jitter: 1, step });
    // Grass tufts.
    for (let i = 0; i < Math.floor(W / 34); i++) {
      const x = 14 + i * 34 + shash(i, 81) * 10;
      const k = 0.7 + hash(i, 82) * 0.6;
      for (let j = -1; j <= 1; j++) {
        line(ctx, x + j * 3, 0, x + j * 6 * k, -8 * k - (j === 0 ? 3 : 0), 800 + i * 5 + j, { width: 1.3, passes: 1, jitter: 0.5, step });
      }
    }
    // A pebble with hatching, and a flower.
    const px = W * 0.56;
    ellipse(ctx, px, -3, 10, 5.5, 900, { width: 1.6, jitter: 0.6, step, passes: 1 });
    hatch(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(px, -3, 10, 5.5, 0, 0, Math.PI * 2);
      },
      px - 10,
      -9,
      20,
      11,
      0.8,
      3.2,
      910,
      { color: PAL.graphite, step, alpha: 0.7 },
    );
    const fx = W * 0.36;
    line(ctx, fx, 0, fx + 1, -16, 920, { width: 1.3, passes: 1, step });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ellipse(ctx, fx + 1 + Math.cos(a) * 4.5, -19 + Math.sin(a) * 4.5, 3, 3, 930 + k, { width: 1.1, passes: 1, jitter: 0.4, step, color: PAL.red });
    }
    out.push({ canvas, w: W, h, scale: dpr });
  }
  return out;
}

/** Height above the ground line that the ground sprite reaches (its local origin offset). */
export const GROUND_TOP = 34;
