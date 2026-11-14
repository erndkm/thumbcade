/**
 * What I drew: the squared page of my maths book, the dungeon's pen lines, my stick knight, the four scribbles,
 * coins, swords, the gold star and the hearts. Characters are drawn live so their lines boil; the page and the
 * maze are baked once. Everything here is in "square" units: one maze square is 48 across, centred on the origin.
 */
import { begin, ellipse, ellipsePts, fillBuf, hand, hash, ink, line, makeSprite, PAL, pt, shash, write, type Sprite } from "./ink.ts";
import { COLS, isOpen, ROWS, type Maze } from "./maze.ts";
import type { MonsterKind } from "./sim.ts";

export const CELL = 48;
const TAU = Math.PI * 2;

export const INKS = {
  coin: "#D99A12",
  gold: PAL.hiYellow,
  steel: "#7C8698",
  felt: "#2E8B57",
  plume: PAL.red,
} as const;
/** Each scribble's pen. */
export const PEN: Record<MonsterKind, string> = { 0: PAL.red, 1: PAL.inkDeep, 2: PAL.graphite, 3: INKS.felt };
const TINT: Record<MonsterKind, string> = { 0: "#F9D5D2", 1: "#D5DBF2", 2: "#E4E4E6", 3: "#D3EEDD" };

// ---------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------

/**
 * A page of squared paper, its print lined up with the maze: `pitch` px between lines, one of them through
 * (ox, oy). Rendered once per size into an opaque canvas.
 */
export function renderPage(W: number, H: number, dpr: number, ox: number, oy: number, pitch: number, notes: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAL.paper;
  ctx.fillRect(0, 0, W, H);
  const specks = Math.round((W * H) / 700);
  for (let i = 0; i < specks; i++) {
    const a = 0.03 + hash(i, 13) * 0.06;
    ctx.fillStyle = hash(i, 14) < 0.5 ? `rgba(120,100,70,${a})` : `rgba(90,90,100,${a})`;
    const s = 0.6 + hash(i, 15) * 1.1;
    ctx.fillRect(hash(i, 11) * W, hash(i, 12) * H, s, s);
  }
  // The print: squares, with a heavier line every third (one maze square).
  for (let x = ox - Math.ceil(ox / pitch) * pitch, i = -Math.ceil(ox / pitch); x < W; x += pitch, i++) {
    ctx.fillStyle = ((i % 3) + 3) % 3 === 0 ? "rgba(112,156,214,0.4)" : "rgba(112,156,214,0.22)";
    ctx.fillRect(Math.round(x) - 0.5, 0, 1, H);
  }
  for (let y = oy - Math.ceil(oy / pitch) * pitch, i = -Math.ceil(oy / pitch); y < H; y += pitch, i++) {
    ctx.fillStyle = ((i % 3) + 3) % 3 === 0 ? "rgba(112,156,214,0.4)" : "rgba(112,156,214,0.22)";
    ctx.fillRect(0, Math.round(y) - 0.5, W, 1);
  }
  // Punched holes down the left edge, and a coffee ring I am not responsible for.
  for (const k of [0.16, 0.5, 0.84]) {
    ctx.fillStyle = PAL.paperBack;
    ctx.beginPath();
    ctx.arc(-2, Math.round(H * k), 9, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(140,92,45,0.1)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W * 0.83, H * 0.9, 34, 0.4, 5.2);
  ctx.stroke();
  // Faint pencil homework along the bottom, and the teacher's opinion.
  const hw = HOMEWORK[notes % HOMEWORK.length]!;
  write(ctx, hw[0]!, 14, H - 30, hand(15), "rgba(98,102,110,0.42)", 4 + notes, { step: 0, rot: -0.01 });
  write(ctx, hw[1]!, 14, H - 12, hand(15), "rgba(98,102,110,0.42)", 5 + notes, { step: 0, rot: 0.008 });
  write(ctx, "do NOT doodle in class", W - 14, H - 8, hand(13), "rgba(210,51,47,0.4)", 9, { step: 0, align: "right", rot: -0.012 });
  return c;
}

const HOMEWORK: Array<[string, string]> = [
  ["maths p.47: area + perimeter", "a square has 4 sides (so does my dungeon)"],
  ["hw: times tables, 7 and 8", "7 × 8 = 56  (fifty-six coins!!)"],
  ["fractions: 3/4 of the monsters", "are scribbles. the rest: also scribbles"],
  ["ch. 5: coordinates (x, y)", "the knight is at (3, 8). x marks the gold"],
];

// ---------------------------------------------------------------------------------------------------------------
// The dungeon
// ---------------------------------------------------------------------------------------------------------------

/**
 * The maze's pen lines (and the scribbled holes), drawn once for boil step `step` at `cs` px a square. Runs of wall
 * are drawn as one long stroke, the way a hand would rule them.
 */
export function bakeMaze(m: Maze, cs: number, dpr: number, step: number, seed: number): Sprite {
  const pad = 8;
  const w = COLS * cs + pad * 2;
  const h = ROWS * cs + pad * 2;
  return makeSprite(w, h, dpr, (ctx) => {
    ctx.translate(-w / 2 + pad, -h / 2 + pad);
    for (const hole of m.holes) {
      ctx.save();
      ctx.translate(((hole % COLS) + 0.5) * cs, (Math.floor(hole / COLS) + 0.5) * cs);
      ctx.scale(cs / CELL, cs / CELL);
      drawHole(ctx, hole, step);
      ctx.restore();
    }
    const o = { width: Math.max(2, cs * 0.052), jitter: 0.9, step, color: PAL.ink };
    // Horizontal lines: along the top of row y, wherever the square above (or the edge of the sheet) is walled off.
    for (let y = 0; y <= ROWS; y++) {
      let from = -1;
      for (let x = 0; x <= COLS; x++) {
        const wall = x < COLS && (y === 0 || y === ROWS || !isOpen(m, y * COLS + x, 0));
        if (wall && from < 0) from = x;
        if (!wall && from >= 0) {
          line(ctx, from * cs - 1.5, y * cs + shash(seed, y, from) * 0.8, x * cs + 1.5, y * cs + shash(seed, y, x + 40) * 0.8, seed + y * 31 + from, o);
          from = -1;
        }
      }
    }
    for (let x = 0; x <= COLS; x++) {
      let from = -1;
      for (let y = 0; y <= ROWS; y++) {
        const wall = y < ROWS && (x === 0 || x === COLS || !isOpen(m, y * COLS + x, 3));
        if (wall && from < 0) from = y;
        if (!wall && from >= 0) {
          line(ctx, x * cs + shash(seed, x + 80, from) * 0.8, from * cs - 1.5, x * cs + shash(seed, x + 80, y + 40) * 0.8, y * cs + 1.5, seed + 500 + x * 37 + from, o);
          from = -1;
        }
      }
    }
  });
}

/** A hole a scribble crawls out of: a tight dark scrawl. */
function drawHole(ctx: CanvasRenderingContext2D, seed: number, step: number): void {
  begin();
  for (let i = 0; i <= 44; i++) {
    const a = (i / 44) * TAU * 4.2 + hash(seed, 2) * 6;
    const r = 3 + (i / 44) * 13;
    pt(Math.cos(a) * r, Math.sin(a) * r * 0.82);
  }
  ink(ctx, seed * 7 + 3, { width: 2.4, jitter: 1.2, step, color: PAL.inkDeep, alpha: 0.85 });
  begin();
  for (let i = 0; i <= 26; i++) {
    const a = (i / 26) * TAU * 2.4 + 1;
    const r = 2 + (i / 26) * 9;
    pt(Math.cos(a) * r, Math.sin(a) * r * 0.8);
  }
  ink(ctx, seed * 7 + 5, { width: 2, jitter: 1, step, color: PAL.graphite, alpha: 0.8, passes: 1 });
}

export interface Bits {
  coin: Sprite;
  sword: Sprite;
  star: Sprite;
  heart: Sprite;
  heartLost: Sprite;
}

/** The small things, baked at `k` device px a unit. */
export function bakeBits(k: number): Bits {
  return {
    coin: makeSprite(18, 18, k, (ctx) => {
      ctx.fillStyle = "#FFE9A8";
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, TAU);
      ctx.fill();
      ellipse(ctx, 0, 0, 5, 5, 71, { width: 1.5, jitter: 0.4, step: 0, color: INKS.coin, passes: 1 });
    }),
    sword: makeSprite(30, 44, k, (ctx) => {
      // Blade, tip up.
      begin();
      pt(-2.6, 6);
      pt(-2.6, -12);
      pt(0, -18);
      pt(2.6, -12);
      pt(2.6, 6);
      fillBuf(ctx, "#E9EDF4");
      ink(ctx, 81, { width: 1.5, jitter: 0.4, step: 0, color: INKS.steel, closed: true, passes: 1 });
      line(ctx, 0, -12, 0, 5, 82, { width: 1, jitter: 0.3, step: 0, color: INKS.steel, passes: 1 });
      line(ctx, -8, 6.5, 8, 6.5, 83, { width: 2.6, jitter: 0.5, step: 0, color: PAL.ink });
      line(ctx, 0, 7, 0, 15, 84, { width: 2.6, jitter: 0.4, step: 0, color: INKS.coin });
      ellipse(ctx, 0, 17, 2.4, 2.4, 85, { width: 1.6, jitter: 0.3, step: 0, color: PAL.ink, passes: 1 });
    }),
    star: makeSprite(40, 40, k, (ctx) => {
      begin();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const r = i % 2 ? 6.6 : 15;
        pt(Math.cos(a) * r, Math.sin(a) * r);
      }
      fillBuf(ctx, INKS.gold);
      ink(ctx, 91, { width: 1.8, jitter: 0.5, step: 0, color: PAL.ink, closed: true });
    }),
    heart: heart(k, true),
    heartLost: heart(k, false),
  };
}

function heart(k: number, full: boolean): Sprite {
  return makeSprite(30, 28, k, (ctx) => {
    begin();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * TAU;
      // The classic heart curve, small.
      pt(0.68 * 16 * Math.sin(a) ** 3, -0.68 * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) + 1);
    }
    if (full) fillBuf(ctx, "#F28B84");
    ink(ctx, 95, { width: 1.8, jitter: 0.5, step: 0, color: full ? PAL.red : "rgba(98,102,110,0.6)", closed: true, passes: full ? 2 : 1 });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// My knight
// ---------------------------------------------------------------------------------------------------------------

export interface KnightLook {
  /** 1 facing right, -1 facing left. */
  flip: number;
  /** Running phase in radians (legs and arms swing), or null standing. */
  run: number | null;
  /** Holding a sword. */
  brave: boolean;
  /** 0-1: squashed flat (caught). */
  squash: number;
  seed: number;
}

export function drawKnight(ctx: CanvasRenderingContext2D, o: KnightLook): void {
  const s = o.seed;
  const sw = o.run === null ? 0 : Math.sin(o.run);
  const bob = o.run === null ? 0 : Math.abs(Math.cos(o.run)) * 1.6;
  ctx.save();
  ctx.scale(o.flip, 1 - o.squash * 0.75);
  ctx.translate(0, -bob + o.squash * 30);
  const pen = { width: 2.3, jitter: 0.7, color: PAL.ink };
  // Legs and body.
  line(ctx, 0, 6, -4 - sw * 6, 18, s + 1, pen);
  line(ctx, 0, 6, 4 + sw * 6, 18, s + 2, pen);
  line(ctx, 0, -4, 0, 6, s + 3, pen);
  // The back arm and the shield on it.
  line(ctx, 0, -1, -7, 3 + sw * 2, s + 4, pen);
  begin();
  pt(-12.5, -3);
  pt(-5.5, -3);
  pt(-5.5, 4);
  pt(-9, 9);
  pt(-12.5, 4);
  fillBuf(ctx, "#CFE0F7");
  ink(ctx, s + 5, { width: 1.8, jitter: 0.5, color: PAL.ink, closed: true, passes: 1 });
  // The sword arm.
  if (o.brave) {
    line(ctx, 0, -1, 8, -6, s + 6, pen);
    line(ctx, 8, -6, 15, -22, s + 7, { width: 2.6, jitter: 0.5, color: INKS.steel });
    line(ctx, 5.5, -9.5, 11.5, -6.5, s + 8, { width: 2.2, jitter: 0.4, color: PAL.ink, passes: 1 });
  } else line(ctx, 0, -1, 7 - sw * 3, 4 - sw * 2, s + 6, pen);
  // Head in a bucket helmet with a red plume.
  ctx.fillStyle = PAL.paper;
  ctx.beginPath();
  ctx.arc(0, -11, 7.5, 0, TAU);
  ctx.fill();
  ellipse(ctx, 0, -11, 7.5, 7.5, s + 9, { width: 2.2, jitter: 0.6, color: PAL.ink });
  line(ctx, -7, -12.5, 7.5, -12.5, s + 10, { width: 1.7, jitter: 0.5, color: PAL.ink, passes: 1 });
  line(ctx, 2.5, -12, 2.5, -6, s + 11, { width: 1.5, jitter: 0.4, color: PAL.ink, passes: 1 });
  ctx.fillStyle = PAL.ink;
  ctx.beginPath();
  ctx.arc(5, -10, 1.1, 0, TAU);
  ctx.fill();
  begin();
  pt(-1, -18.5);
  pt(-5, -24);
  pt(-9, -21);
  pt(-7, -26.5);
  pt(-12, -25);
  ink(ctx, s + 12, { width: 2.2, jitter: 0.8, color: INKS.plume });
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// The scribbles
// ---------------------------------------------------------------------------------------------------------------

export interface ScribbleLook {
  /** Where it is looking (unit vector). */
  lx: number;
  ly: number;
  scared: boolean;
  /** 0-1 of the scrawl drawn so far (being drawn out of its hole). */
  drawn: number;
  /** Seconds, for the walk and the shiver. */
  t: number;
  seed: number;
}

/** The scrawl each scribble is made of, as points round the origin (about 17 units across). */
function scrawl(kind: MonsterKind, seed: number, upTo: number): void {
  begin();
  const ph = hash(seed, 1) * TAU;
  const push = (n: number, f: (u: number) => [number, number]) => {
    const last = Math.max(2, Math.round(n * upTo));
    for (let i = 0; i <= last; i++) {
      const [x, y] = f(i / n);
      pt(x, y);
    }
  };
  switch (kind) {
    case 0:
      // Grumble: a spiky ball, twice round.
      push(34, (u) => {
        const a = ph + u * TAU * 2;
        const r = (Math.round(u * 34) % 2 ? 17 : 9.5) * (u > 0.5 ? 0.86 : 1);
        return [Math.cos(a) * r, Math.sin(a) * r * 0.92];
      });
      break;
    case 1:
      // Sneak: a spiral wound up tight.
      push(40, (u) => {
        const a = ph + u * TAU * 3.4;
        const r = 3 + u * 13.5;
        return [Math.cos(a) * r, Math.sin(a) * r * 0.94];
      });
      break;
    case 2:
      // Dither: a cloud of loops.
      push(44, (u) => {
        const a = ph + u * TAU * 1.12;
        return [11.5 * Math.cos(a) + 5 * Math.cos(a * 6), 10.5 * Math.sin(a) + 5 * Math.sin(a * 6)];
      });
      break;
    default:
      // Lurk: a flat, heavy blob gone over three times.
      push(40, (u) => {
        const a = ph + u * TAU * 3;
        const k = 1 - u * 0.22;
        return [Math.cos(a) * 17.5 * k, 2 + Math.sin(a) * 12 * k];
      });
  }
}

export function drawScribble(ctx: CanvasRenderingContext2D, kind: MonsterKind, o: ScribbleLook): void {
  const s = o.seed;
  const shiver = o.scared ? Math.sin(o.t * 46) * 1.1 : 0;
  ctx.save();
  ctx.translate(shiver, 0);
  const walk = Math.sin(o.t * 13);
  if (o.drawn >= 1) {
    // Two little legs.
    const pen = { width: 1.9, jitter: 0.5, color: o.scared ? PAL.graphite : PEN[kind], passes: 1 };
    line(ctx, -5, 11, -6 - walk * 3, 19, s + 1, pen);
    line(ctx, 5, 11, 6 + walk * 3, 19, s + 2, pen);
    ctx.globalAlpha = o.scared ? 0.5 : 0.85;
    ctx.fillStyle = o.scared ? "#F1EFE8" : TINT[kind];
    ctx.beginPath();
    ctx.ellipse(0, kind === 3 ? 2 : 0, kind === 3 ? 15 : 12.5, kind === 3 ? 10 : 12, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  scrawl(kind, s, o.drawn);
  if (o.scared) ctx.setLineDash([3.5, 4]);
  ink(ctx, s + 3, { width: kind === 3 ? 2.6 : 2.1, jitter: o.scared ? 1.9 : 1.25, color: o.scared ? PAL.graphite : PEN[kind], alpha: o.scared ? 0.75 : 1 });
  ctx.setLineDash([]);
  if (o.drawn >= 0.85) {
    const ey = kind === 3 ? 0 : -2;
    const eyes: Array<[number, number, number]> = kind === 1 ? [[0, ey, 6.2]] : [[-5.2, ey, 4.6], [5.2, ey, 4.6]];
    eyes.forEach(([ex, eyy, r], i) => {
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(ex, eyy, r, 0, TAU);
      ctx.fill();
      ellipsePts(ex, eyy, r, r, s + 10 + i, 0.08, 9);
      ink(ctx, s + 10 + i, { width: 1.4, jitter: 0.35, color: PAL.inkDeep, passes: 1 });
      // Dither's eyes wander off on their own.
      const wx = kind === 2 && !o.scared ? Math.cos(o.t * 2.3 + i * 2.6) : o.lx;
      const wy = kind === 2 && !o.scared ? Math.sin(o.t * 1.9 + i * 1.7) : o.ly;
      ctx.fillStyle = PAL.inkDeep;
      ctx.beginPath();
      ctx.arc(ex + wx * r * 0.42, eyy + wy * r * 0.42, o.scared ? r * 0.26 : r * 0.46, 0, TAU);
      ctx.fill();
    });
    if (!o.scared && kind === 0) {
      // Grumble's brows.
      line(ctx, -10, -9.5, -2, -6, s + 20, { width: 2.2, jitter: 0.4, color: PAL.red, passes: 1 });
      line(ctx, 10, -9.5, 2, -6, s + 21, { width: 2.2, jitter: 0.4, color: PAL.red, passes: 1 });
    } else if (!o.scared && kind === 3) {
      // Lurk's heavy lids.
      line(ctx, -10, -3.2, -0.6, -3.2, s + 22, { width: 2.4, jitter: 0.3, color: INKS.felt, passes: 1 });
      line(ctx, 0.6, -3.2, 10, -3.2, s + 23, { width: 2.4, jitter: 0.3, color: INKS.felt, passes: 1 });
    } else if (o.scared) {
      // A wobbly mouth.
      begin();
      for (let i = 0; i <= 6; i++) pt(-5 + (i / 6) * 10, 7 + (i % 2 ? -1.6 : 1.6));
      ink(ctx, s + 24, { width: 1.5, jitter: 0.5, color: PAL.graphite, passes: 1 });
    }
  }
  ctx.restore();
}

/** A soft yellow glow behind the knight while the sword lasts: a highlighter ring that runs down. */
export function drawBraveRing(ctx: CanvasRenderingContext2D, frac: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = PAL.hiYellow;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 6;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.arc(0, 0, 21, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, frac));
  ctx.stroke();
  ctx.restore();
}
