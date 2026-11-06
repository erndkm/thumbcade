import { begin, ellipse, fillBuf, hatch, highlight, ink, line, makeSprite, PAL, pt, shash, type Sprite } from "./ink.ts";

/** Boil variants baked per drawing. */
export const VARIANTS = 3;

export type BalloonFill = "yellow" | "green" | "red" | "blue";
export const BALLOON_FILLS: readonly BalloonFill[] = ["yellow", "green", "red", "blue"];

export interface SpriteSet {
  balloon: Record<BalloonFill, Sprite[]>;
  /** [variant][frame]: frame 0 wings up, 1 wings down. */
  bird: Sprite[][];
  target: Sprite[];
  star: Sprite[];
  cloud: Sprite[][];
}

/** Balloon body geometry (sprite-local, centered on the body). */
export const BALLOON = { rx: 21, ry: 26 };
export const TARGET_R = 30;
export const STAR_R = 19;

function balloonPts(seed: number): void {
  begin();
  const N = 14;
  const a0 = -Math.PI / 2 + shash(seed, 1) * 0.3;
  for (let i = 0; i <= N + 1; i++) {
    const a = a0 + (i / N) * Math.PI * 2;
    const s = Math.sin(a);
    const x = Math.cos(a) * BALLOON.rx * (1 - 0.16 * Math.max(0, s));
    const y = s * BALLOON.ry + (s > 0 ? s * s * 2 : 0);
    pt(x, y);
  }
}

function balloon(fill: BalloonFill, v: number, scale: number): Sprite {
  const step = 2000 + v;
  return makeSprite(60, 74, scale, (ctx) => {
    ctx.translate(0, -6);
    const seed = 40 + BALLOON_FILLS.indexOf(fill) * 13;
    const clip = () => {
      ctx.beginPath();
      ctx.ellipse(1.5, 2, BALLOON.rx - 1, BALLOON.ry - 1, 0, 0, Math.PI * 2);
    };
    if (fill === "yellow" || fill === "green") {
      // Highlighter, a little off-register like a real quick fill.
      ctx.save();
      clip();
      ctx.clip();
      highlight(ctx, -BALLOON.rx - 2, -BALLOON.ry, BALLOON.rx * 2 + 6, BALLOON.ry * 2 + 4, seed + v, fill === "yellow" ? PAL.hiYellow : PAL.hiGreen, 0.62);
      ctx.restore();
    } else {
      hatch(ctx, clip, -BALLOON.rx, -BALLOON.ry, BALLOON.rx * 2, BALLOON.ry * 2, fill === "red" ? -0.85 : 0.75, 4, seed, {
        color: fill === "red" ? PAL.red : PAL.ink,
        step,
        width: 1.1,
        alpha: 0.8,
      });
    }
    balloonPts(seed);
    ink(ctx, seed, { width: 2.2, step, jitter: 0.9 });
    // Shine and knot.
    begin();
    for (let i = 0; i <= 4; i++) {
      const a = Math.PI * (1.08 + i * 0.07);
      pt(Math.cos(a) * BALLOON.rx * 0.62, Math.sin(a) * BALLOON.ry * 0.62);
    }
    ink(ctx, seed + 3, { width: 1.6, step, passes: 1, jitter: 0.4 });
    const ky = BALLOON.ry + 1;
    begin();
    pt(-4, ky + 5);
    pt(0, ky - 1);
    pt(4, ky + 5);
    pt(-4, ky + 5);
    fillBuf(ctx, PAL.ink, 0.85);
    ink(ctx, seed + 5, { width: 1.5, step, passes: 1, jitter: 0.4 });
  });
}

function bird(v: number, frame: number, scale: number): Sprite {
  const step = 2100 + v;
  return makeSprite(60, 56, scale, (ctx) => {
    // An origami bird facing right.
    const wingUp = frame === 0;
    // Wing (behind): a long triangle hinged on the back.
    begin();
    pt(-7, -3);
    pt(wingUp ? -12 : -6, wingUp ? -25 : 22);
    pt(9, -3);
    const wingClip = () => {
      ctx.beginPath();
      ctx.moveTo(-7, -3);
      ctx.lineTo(wingUp ? -12 : -6, wingUp ? -25 : 22);
      ctx.lineTo(9, -3);
      ctx.closePath();
    };
    hatch(ctx, wingClip, -14, -26, 26, 50, wingUp ? 1.1 : -1.1, 3.4, 77 + frame, { color: PAL.graphite, step, alpha: 0.75 });
    begin();
    pt(-7, -3);
    pt(wingUp ? -12 : -6, wingUp ? -25 : 22);
    pt(9, -3);
    ink(ctx, 70 + frame, { width: 1.8, step, jitter: 0.6 });
    // Body: tail, back, neck, head, beak, chest, belly.
    begin();
    pt(-26, -8);
    pt(-8, -2);
    pt(10, -3);
    pt(17, -15);
    pt(27, -12);
    pt(18, -8);
    pt(13, 5);
    pt(-6, 7);
    pt(-26, -8);
    ink(ctx, 80, { width: 2, step, jitter: 0.6 });
    // Folds.
    line(ctx, -8, -2, -6, 7, 83, { width: 1.1, passes: 1, step, jitter: 0.4 });
    line(ctx, 10, -3, 13, 5, 84, { width: 1.1, passes: 1, step, jitter: 0.4 });
    ctx.fillStyle = PAL.inkDeep;
    ctx.beginPath();
    ctx.arc(19.5, -12, 1.4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function target(v: number, scale: number): Sprite {
  const step = 2200 + v;
  const R = TARGET_R;
  return makeSprite(R * 2 + 12, R * 2 + 16, scale, (ctx) => {
    ctx.translate(0, 3);
    const ring = (r: number) => () => {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    };
    // Outer band: ballpoint hatching; middle band: highlighter; bull: red pen scribble.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.arc(0, 0, R * 0.66, 0, Math.PI * 2, true);
    ctx.clip();
    hatch(ctx, ring(R), -R, -R, R * 2, R * 2, 0.8, 3.6, 120, { color: PAL.ink, step, alpha: 0.7 });
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.66, 0, Math.PI * 2);
    ctx.arc(0, 0, R * 0.33, 0, Math.PI * 2, true);
    ctx.clip();
    highlight(ctx, -R, -R * 0.7, R * 2, R * 1.4, 130 + v, PAL.hiYellow, 0.6);
    ctx.restore();
    // Bull: a tight circular red scribble.
    begin();
    for (let i = 0; i <= 26; i++) {
      const a = i * 0.95;
      const r = R * 0.3 * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.37 + v)));
      pt(Math.cos(a) * r, Math.sin(a) * r);
    }
    ink(ctx, 140, { color: PAL.red, width: 2, step, passes: 1, jitter: 0.5 });
    ellipse(ctx, 0, 0, R, R, 150, { width: 2.2, step });
    ellipse(ctx, 0, 0, R * 0.66, R * 0.66, 151, { width: 1.8, step, passes: 1 });
    ellipse(ctx, 0, 0, R * 0.33, R * 0.33, 152, { width: 1.7, step, passes: 1, color: PAL.red });
    // The eyelet the string ties to.
    ellipse(ctx, 0, -R - 3.5, 3, 3.5, 153, { width: 1.5, step, passes: 1 });
  });
}

function starPts(R: number, r: number, rot: number): void {
  begin();
  for (let i = 0; i <= 10; i++) {
    const a = rot + (i / 10) * Math.PI * 2;
    const rr = i % 2 === 0 ? R : r;
    pt(Math.cos(a) * rr, Math.sin(a) * rr);
  }
}

function star(v: number, scale: number): Sprite {
  const step = 2300 + v;
  const R = STAR_R;
  return makeSprite(R * 2 + 14, R * 2 + 14, scale, (ctx) => {
    const clip = () => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const rr = i % 2 === 0 ? R + 2 : R * 0.45 + 1;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr + 1, Math.sin(a) * rr + 1);
        else ctx.lineTo(Math.cos(a) * rr + 1, Math.sin(a) * rr + 1);
      }
      ctx.closePath();
    };
    ctx.save();
    clip();
    ctx.clip();
    highlight(ctx, -R - 2, -R - 2, R * 2 + 4, R * 2 + 4, 160 + v, PAL.hiYellow, 0.75);
    highlight(ctx, -R - 2, -R + 3, R * 2 + 4, R * 2 - 4, 170 + v, PAL.hiYellow, 0.5);
    ctx.restore();
    starPts(R, R * 0.45, -Math.PI / 2);
    ink(ctx, 180, { width: 2.1, step, jitter: 0.8 });
    // Two little shine ticks.
    line(ctx, -R * 0.15, -R * 0.55, -R * 0.05, -R * 0.25, 181, { width: 1.3, passes: 1, step });
    line(ctx, R * 0.62, -R * 0.12, R * 0.38, -R * 0.06, 182, { width: 1.3, passes: 1, step });
  });
}

/**
 * Cloud outlines: the union of a few bumps with a flat-ish bottom, sampled as rays from the middle so the scallops
 * meet in little cusps like a quick doodle. Base (unjittered) points, also used for clipping.
 */
const CLOUD_BUMPS: Array<Array<[number, number, number]>> = [
  [
    [-46, 8, 20],
    [-22, -6, 26],
    [10, -14, 30],
    [40, -2, 24],
    [60, 10, 14],
  ],
  [
    [-38, 6, 18],
    [-12, -8, 25],
    [18, -6, 23],
    [42, 6, 16],
  ],
];
export const CLOUD_SHAPES: Array<Array<[number, number]>> = CLOUD_BUMPS.map((bumps) => {
  const pts: Array<[number, number]> = [];
  const N = 64;
  const oy = 6;
  const bottom = 22;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = 0;
    for (const [cx, cy, r] of bumps) {
      const px = cx;
      const py = cy - oy;
      const b = dx * px + dy * py;
      const disc = b * b - (px * px + py * py) + r * r;
      if (disc >= 0) t = Math.max(t, b + Math.sqrt(disc));
    }
    if (dy > 0.05) t = Math.min(t, (bottom - oy) / dy);
    pts.push([dx * t, oy + dy * t]);
  }
  return pts;
});

function cloud(shape: number, v: number, scale: number): Sprite {
  const step = 2400 + v;
  const pts = CLOUD_SHAPES[shape]!;
  return makeSprite(160, 92, scale, (ctx) => {
    const clip = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    };
    // Pencil shading along the underside only.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-90, 10, 180, 40);
    ctx.clip();
    hatch(ctx, clip, -80, -40, 160, 80, -0.9, 4.2, 190 + shape, { color: PAL.graphite, step, alpha: 0.6 });
    ctx.restore();
    begin();
    for (let i = 0; i <= pts.length + 2; i++) {
      const p = pts[i % pts.length]!;
      pt(p[0], p[1]);
    }
    ink(ctx, 200 + shape, { width: 2, step, jitter: 0.45 });
    // A couple of inner puff curls.
    begin();
    for (let i = 0; i <= 5; i++) {
      const a = Math.PI * (1.15 + i * 0.12);
      pt(-18 + Math.cos(a) * 14, 4 + Math.sin(a) * 10);
    }
    ink(ctx, 210 + shape, { width: 1.3, step, passes: 1, jitter: 0.5 });
  });
}

/** Bakes every target drawing in all boil variants at `scale` device px per CSS px. */
export function buildSprites(scale: number): SpriteSet {
  const vs = [...Array(VARIANTS).keys()];
  return {
    balloon: {
      yellow: vs.map((v) => balloon("yellow", v, scale)),
      green: vs.map((v) => balloon("green", v, scale)),
      red: vs.map((v) => balloon("red", v, scale)),
      blue: vs.map((v) => balloon("blue", v, scale)),
    },
    bird: vs.map((v) => [bird(v, 0, scale), bird(v, 1, scale)]),
    target: vs.map((v) => target(v, scale)),
    star: vs.map((v) => star(v, scale)),
    cloud: [0, 1].map((s) => vs.map((v) => cloud(s, v, scale))),
  };
}
