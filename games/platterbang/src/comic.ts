/**
 * juicefactory's comic toolkit (Canvas 2D): Bungee sticker type, jagged onomatopoeia bursts, sunbursts, halftone
 * dots, outlined confetti and wobbling pop numbers. Shared look for every juicefactory game.
 */
import bungeeUrl from "@thumbcade-games/kit/assets/fonts/library/bungee/Bungee-Regular.woff2?url";
import { loadFontFaces } from "@thumbcade-games/kit/font-faces";

export const PAL = {
  ink: "#16121C",
  white: "#FFFFFF",
  cream: "#FFF5D8",
  banana: "#FFD83A",
  bananaHi: "#FFEC8A",
  bananaShade: "#F4A51C",
  tomato: "#FF4A38",
  tomatoShade: "#C9281E",
  cobalt: "#2F5CFF",
  cobaltHi: "#7FA4FF",
  cobaltShade: "#1B37B4",
  bubblegum: "#FF7CC6",
  bubblegumHi: "#FFB8E0",
  bubblegumShade: "#D93F95",
  lime: "#9AE43C",
  limeHi: "#C8F57E",
  limeShade: "#58AB23",
} as const;

export const font = (px: number): string => `${Math.round(px)}px Bungee, "Arial Black", Impact, sans-serif`;

/** Loads Bungee (bundled, same origin) through the kit's face loader. Resolves after at most `timeoutMs` either way. */
export async function loadComicFont(timeoutMs = 1500): Promise<void> {
  await loadFontFaces([{ family: "Bungee", url: bungeeUrl }], timeoutMs);
  // Anything cached before the face arrived used the fallback font.
  sprites.clear();
  advanceCache.clear();
}

const TAU = Math.PI * 2;

/** Tiny deterministic hash -> [0, 1). */
export function hash(n: number, seed = 0): number {
  let h = Math.imul((n | 0) ^ 0x5bd1e995, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------------------
// Sticker type
// ---------------------------------------------------------------------------------------------------------------

export interface StickerOpts {
  /** Font size in px. */
  size: number;
  fill?: string;
  ink?: string;
  /** Rotation in radians. */
  rot?: number;
  /** Outline width as a fraction of the size (default 0.24). */
  stroke?: number;
  /** Hard shadow offset in px (default size * 0.1). */
  shadow?: number;
  /** White die-cut backing around the outline, in px (0 = none). */
  cut?: number;
  align?: CanvasTextAlign;
  sx?: number;
  sy?: number;
  alpha?: number;
}

// Stroked type is expensive to rasterise every frame, so every sticker is drawn once into a cached bitmap at
// device resolution and then blitted with its transform (rotation, pop, wobble).

let spriteScale = 2;
/** Device pixels per CSS pixel for cached stickers. Call on resize; it drops the cache when it changes. */
export function setSpriteScale(dpr: number): void {
  const s = Math.min(3, dpr * 1.2);
  if (s !== spriteScale) {
    spriteScale = s;
    sprites.clear();
  }
}

export interface Sprite {
  c: HTMLCanvasElement;
  /** Size in CSS px and the anchor inside it. */
  w: number;
  h: number;
  ox: number;
  oy: number;
}

const sprites = new Map<string, Sprite>();
const MAX_SPRITES = 120;

export function makeSprite(w: number, h: number, ox: number, oy: number, draw: (g: CanvasRenderingContext2D) => void, scale = spriteScale): Sprite {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * scale));
  c.height = Math.max(1, Math.ceil(h * scale));
  const cg = c.getContext("2d")!;
  cg.scale(scale, scale);
  cg.translate(ox, oy);
  draw(cg);
  return { c, w, h, ox, oy };
}

/** A bitmap drawn once per `key` (least recently used ones are dropped). */
export function cachedSprite(key: string, w: number, h: number, ox: number, oy: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const hit = sprites.get(key);
  if (hit) {
    sprites.delete(key);
    sprites.set(key, hit);
    return hit;
  }
  const s = makeSprite(w, h, ox, oy, draw);
  sprites.set(key, s);
  if (sprites.size > MAX_SPRITES) sprites.delete(sprites.keys().next().value!);
  return s;
}

export function drawSprite(g: CanvasRenderingContext2D, s: Sprite, x: number, y: number, rot = 0, sx = 1, sy = 1): void {
  if (!rot && sx === 1 && sy === 1) {
    g.drawImage(s.c, x - s.ox, y - s.oy, s.w, s.h);
    return;
  }
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.scale(sx, sy);
  g.drawImage(s.c, -s.ox, -s.oy, s.w, s.h);
  g.restore();
}

let measureCtx: CanvasRenderingContext2D | null = null;
const measurer = () => (measureCtx ??= document.createElement("canvas").getContext("2d")!);

/** Draws the sticker at the origin with no caching (used to fill sprites). */
function stickerDirect(g: CanvasRenderingContext2D, text: string, o: StickerOpts): void {
  const ink = o.ink ?? PAL.ink;
  const lw = o.size * (o.stroke ?? 0.24);
  const sh = o.shadow ?? o.size * 0.1;
  const cut = o.cut ?? 0;
  g.font = font(o.size);
  g.textAlign = o.align ?? "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.miterLimit = 2;
  const yy = o.size * 0.06;
  // Shadow (includes the backing / outline so the whole sticker casts it).
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = lw + cut * 2;
  g.strokeText(text, sh, yy + sh);
  g.fillText(text, sh, yy + sh);
  if (cut > 0) {
    g.strokeStyle = PAL.white;
    g.strokeText(text, 0, yy);
    g.strokeStyle = ink;
  }
  g.lineWidth = lw;
  g.strokeText(text, 0, yy);
  g.fillStyle = o.fill ?? PAL.white;
  g.fillText(text, 0, yy);
}

/** White (or `fill`) letters, a fat black outline, a hard offset shadow; optionally on a white die-cut backing. */
export function sticker(g: CanvasRenderingContext2D, text: string, x: number, y: number, o: StickerOpts): void {
  const ink = o.ink ?? PAL.ink;
  const lw = o.size * (o.stroke ?? 0.24);
  const sh = o.shadow ?? o.size * 0.1;
  const cut = o.cut ?? 0;
  const align = o.align ?? "center";
  const key = `s|${text}|${o.size}|${o.fill ?? ""}|${ink}|${lw}|${sh}|${cut}|${align}`;
  const m = measurer();
  m.font = font(o.size);
  const tw = m.measureText(text).width;
  const pad = lw / 2 + cut + 3;
  const w = tw + pad * 2 + sh;
  const h = o.size * 1.3 + pad * 2 + sh;
  const ox = align === "left" ? pad : align === "right" ? tw + pad : tw / 2 + pad;
  const oy = o.size * 0.65 + pad;
  const spr = cachedSprite(key, w, h, ox, oy, (cg) => stickerDirect(cg, text, { ...o, align, rot: 0, sx: 1, sy: 1, alpha: 1 }));
  const a = g.globalAlpha;
  if (o.alpha !== undefined) g.globalAlpha = a * o.alpha;
  drawSprite(g, spr, x, y, o.rot ?? 0, o.sx ?? 1, o.sy ?? 1);
  g.globalAlpha = a;
}

const advanceCache = new Map<string, number>();
/** Advance width of `ch` at 100 px, cached. */
function advance(_g: CanvasRenderingContext2D, ch: string): number {
  let a = advanceCache.get(ch);
  if (a === undefined) {
    const m = measurer();
    m.font = font(100);
    a = m.measureText(ch).width;
    advanceCache.set(ch, a);
  }
  return a;
}

export function textWidth(g: CanvasRenderingContext2D, text: string, size: number, tracking = 0): number {
  let w = 0;
  for (const ch of text) w += (advance(g, ch) / 100) * size + tracking;
  return w - tracking;
}

export interface LetterStyle {
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
  fill?: string;
}

/** One letter of a sticker word as three stacked layers: shadow + backing, outline, fill. */
function letterLayer(ch: string, layer: 0 | 1 | 2, o: StickerOpts, fill: string): Sprite {
  const ink = o.ink ?? PAL.ink;
  const lw = o.size * (o.stroke ?? 0.24);
  const sh = o.shadow ?? o.size * 0.1;
  const cut = o.cut ?? 0;
  const a = (advance(measurer(), ch) / 100) * o.size;
  const pad = lw / 2 + cut + 3;
  const w = a + pad * 2 + sh;
  const h = o.size * 1.3 + pad * 2 + sh;
  const key = `l${layer}|${ch}|${o.size}|${layer === 2 ? fill : ""}|${ink}|${lw}|${sh}|${cut}`;
  return cachedSprite(key, w, h, a / 2 + pad, o.size * 0.65 + pad, (g) => {
    g.font = font(o.size);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.miterLimit = 2;
    const yy = o.size * 0.06;
    if (layer === 0) {
      g.strokeStyle = ink;
      g.fillStyle = ink;
      g.lineWidth = lw + cut * 2;
      g.strokeText(ch, sh, yy + sh);
      g.fillText(ch, sh, yy + sh);
      if (cut > 0) {
        g.strokeStyle = PAL.white;
        g.strokeText(ch, 0, yy);
      }
    } else if (layer === 1) {
      g.strokeStyle = ink;
      g.lineWidth = lw;
      g.strokeText(ch, 0, yy);
    } else {
      g.fillStyle = fill;
      g.fillText(ch, 0, yy);
    }
  });
}

/**
 * A word set letter by letter, each letter its own sticker (for logos that bounce letter by letter).
 * `style(i)` returns per-letter offsets. Whole word rotated by `rot` around (x, y).
 */
export function stickerWord(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: StickerOpts & { tracking?: number },
  style: (i: number) => LetterStyle,
): void {
  const chars = [...text];
  const tracking = o.tracking ?? -o.size * 0.02;
  const total = textWidth(g, text, o.size, tracking);
  g.save();
  g.translate(x, y);
  if (o.rot) g.rotate(o.rot);
  const pos: number[] = [];
  let cx = -total / 2;
  for (const ch of chars) {
    const w = (advance(g, ch) / 100) * o.size;
    pos.push(cx + w / 2);
    cx += w + tracking;
  }
  const styles = chars.map((_, i) => style(i));
  // Three passes so outlines never cover a neighbour's fill: shadow + backing, outline, fill.
  for (const layer of [0, 1, 2] as const) {
    chars.forEach((ch, i) => {
      if (ch === " ") return;
      const s = styles[i]!;
      drawSprite(g, letterLayer(ch, layer, o, s.fill ?? o.fill ?? PAL.white), pos[i]! + s.dx, s.dy, s.rot, s.sx, s.sy);
    });
  }
  g.restore();
}

/** A sticker label on a jagged burst, cached as one bitmap. */
export function burstSticker(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { size: number; fill: string; textFill?: string; rx: number; ry: number; spikes?: number; seed?: number; jag?: number; rot?: number; scale?: number },
): void {
  const pad = 14;
  const w = o.rx * 2.3 + pad * 2;
  const h = o.ry * 2.3 + pad * 2;
  const key = `b|${text}|${o.size}|${o.fill}|${o.textFill ?? ""}|${o.rx}|${o.ry}|${o.spikes ?? 13}|${o.seed ?? 1}|${o.jag ?? 0.2}`;
  const spr = cachedSprite(key, w, h, w / 2, h / 2, (cg) => {
    burstPath(cg, o.rx, o.ry, o.spikes ?? 13, o.seed ?? 1, o.jag ?? 0.2);
    inkFill(cg, o.fill, 4.5, 5);
    stickerDirect(cg, text, { size: o.size, fill: o.textFill ?? PAL.white, stroke: 0.24, shadow: o.size * 0.11 });
  });
  drawSprite(g, spr, x, y, o.rot ?? 0, o.scale ?? 1, o.scale ?? 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------------------------

/** A jagged comic speech burst. `seed` keeps its spikes stable while it animates. */
export function burstPath(g: CanvasRenderingContext2D, rx: number, ry: number, spikes: number, seed: number, jag = 0.3): void {
  const n = spikes * 2;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash(seed, 3) * 0.6;
    const k = i % 2 === 0 ? 1 + (hash(i, seed) - 0.5) * 0.22 : 1 - jag + (hash(i, seed + 7) - 0.5) * 0.12;
    const px = Math.cos(a) * rx * k;
    const py = Math.sin(a) * ry * k;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** Fills and outlines the current path with a hard offset shadow. */
export function inkFill(g: CanvasRenderingContext2D, fill: string, lw: number, shadow = lw * 0.9, ink: string = PAL.ink): void {
  if (shadow > 0) {
    g.save();
    g.translate(shadow, shadow);
    g.fillStyle = ink;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = ink;
    g.lineJoin = "round";
    g.stroke();
    g.restore();
  }
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = ink;
  g.lineJoin = "round";
  g.stroke();
}

export function starPath(g: CanvasRenderingContext2D, r: number, points = 5, inner = 0.48, rot = -Math.PI / 2): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * TAU;
    const k = i % 2 === 0 ? r : r * inner;
    if (i === 0) g.moveTo(Math.cos(a) * k, Math.sin(a) * k);
    else g.lineTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  g.closePath();
}

export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** A white "shine" tick: the cartoon specular mark. */
export function shine(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot = -0.7, alpha = 1): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.globalAlpha *= alpha;
  g.fillStyle = PAL.white;
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.42, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(r * 1.55, 0, r * 0.32, 0, TAU);
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// Backdrops (pre-rendered once, blitted every frame)
// ---------------------------------------------------------------------------------------------------------------

/** A square sunburst of `rays` alternating wedges, `size` px across (draw it rotated around its centre). */
export function makeSunburst(size: number, rays: number, a: string, b: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = Math.max(2, Math.round(size));
  const g = c.getContext("2d")!;
  const r = c.width / 2;
  g.fillStyle = a;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = b;
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * TAU;
    const a1 = ((i + 0.5) / rays) * TAU;
    g.beginPath();
    g.moveTo(r, r);
    g.lineTo(r + Math.cos(a0) * r * 1.5, r + Math.sin(a0) * r * 1.5);
    g.lineTo(r + Math.cos(a1) * r * 1.5, r + Math.sin(a1) * r * 1.5);
    g.closePath();
    g.fill();
  }
  return c;
}

/**
 * A halftone dot field: dots on a 45° grid whose radius follows `radius(x01, y01)` (0..1 of the cell).
 * Transparent between dots, so it can overlay anything.
 */
export function makeHalftone(w: number, h: number, spacing: number, color: string, radius: (x: number, y: number) => number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  const s = spacing;
  for (let row = -1, y = 0; y < c.height + s; row++, y = row * s * 0.5) {
    const off = row % 2 === 0 ? 0 : s / 2;
    for (let x = off - s; x < c.width + s; x += s) {
      const r = radius(x / c.width, y / c.height) * s * 0.5;
      if (r < 0.35) continue;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Confetti, clods and stars (pooled, outlined)
// ---------------------------------------------------------------------------------------------------------------

export type BitShape = "confetti" | "dot" | "star" | "drop";

export class Bits {
  private n = 0;
  private readonly f: Float32Array[];
  private readonly color: string[];
  private readonly shape: BitShape[];
  constructor(readonly capacity = 240) {
    // x, y, vx, vy, life, max, size, rot, vr, grav, drag, flip
    this.f = Array.from({ length: 12 }, () => new Float32Array(capacity));
    this.color = new Array<string>(capacity).fill(PAL.white);
    this.shape = new Array<BitShape>(capacity).fill("dot");
  }
  get count(): number {
    return this.n;
  }
  emit(
    x: number,
    y: number,
    o: {
      count: number;
      speed: [number, number];
      angle?: [number, number];
      life: [number, number];
      size: [number, number];
      colors: readonly string[];
      shape: BitShape;
      gravity?: number;
      drag?: number;
      spread?: number;
      vx?: number;
      vy?: number;
    },
  ): void {
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    const [X, Y, VX, VY, L, M, S, R, VR, G, D, FL] = this.f as [
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
    ];
    for (let k = 0; k < o.count; k++) {
      const i = this.n < this.capacity ? this.n++ : Math.floor(Math.random() * this.capacity);
      const a = o.angle ? r(o.angle) : Math.random() * TAU;
      const sp = r(o.speed);
      const j = o.spread ? Math.random() * o.spread : 0;
      const ja = Math.random() * TAU;
      X[i] = x + Math.cos(ja) * j;
      Y[i] = y + Math.sin(ja) * j;
      VX[i] = Math.cos(a) * sp + (o.vx ?? 0);
      VY[i] = Math.sin(a) * sp + (o.vy ?? 0);
      L[i] = M[i] = r(o.life);
      S[i] = r(o.size);
      R[i] = Math.random() * TAU;
      VR[i] = (Math.random() - 0.5) * 14;
      G[i] = o.gravity ?? 0;
      D[i] = o.drag ?? 0;
      FL[i] = Math.random() * TAU;
      this.color[i] = o.colors[Math.floor(Math.random() * o.colors.length)] ?? PAL.white;
      this.shape[i] = o.shape;
    }
  }
  update(dt: number): void {
    const [X, Y, VX, VY, L, , , R, VR, G, D, FL] = this.f as Float32Array[] as [
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
    ];
    let i = 0;
    while (i < this.n) {
      L[i]! -= dt;
      if (L[i]! <= 0) {
        this.remove(i);
        continue;
      }
      const d = D[i]! > 0 ? Math.exp(-D[i]! * dt) : 1;
      VX[i]! *= d;
      VY[i] = VY[i]! * d + G[i]! * dt;
      X[i]! += VX[i]! * dt;
      Y[i]! += VY[i]! * dt;
      R[i]! += VR[i]! * dt;
      FL[i]! += dt * 9;
      i++;
    }
  }
  /** Moves every bit (e.g. when a camera scrolls). */
  shift(dx: number, dy: number): void {
    const X = this.f[0]!;
    const Y = this.f[1]!;
    for (let i = 0; i < this.n; i++) {
      X[i]! += dx;
      Y[i]! += dy;
    }
  }
  draw(g: CanvasRenderingContext2D, ink: string = PAL.ink): void {
    const [X, Y, , , L, M, S, R, , , , FL] = this.f as [
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
      Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array,
    ];
    g.lineJoin = "round";
    g.strokeStyle = ink;
    for (let i = 0; i < this.n; i++) {
      const t = L[i]! / M[i]!;
      const s = S[i]! * (t < 0.25 ? t / 0.25 : 1);
      if (s < 0.6) continue;
      g.save();
      g.translate(X[i]!, Y[i]!);
      g.rotate(R[i]!);
      g.fillStyle = this.color[i]!;
      g.lineWidth = Math.max(1.5, s * 0.22);
      switch (this.shape[i]) {
        case "confetti": {
          g.scale(Math.cos(FL[i]!), 1);
          g.beginPath();
          g.rect(-s / 2, -s * 0.3, s, s * 0.6);
          g.fill();
          g.stroke();
          break;
        }
        case "star":
          starPath(g, s / 2);
          g.fill();
          g.stroke();
          break;
        case "drop":
          g.beginPath();
          g.moveTo(0, -s * 0.6);
          g.quadraticCurveTo(s * 0.45, 0, 0, s * 0.4);
          g.quadraticCurveTo(-s * 0.45, 0, 0, -s * 0.6);
          g.fill();
          g.stroke();
          break;
        default:
          g.beginPath();
          g.arc(0, 0, s / 2, 0, TAU);
          g.fill();
          g.stroke();
      }
      g.restore();
    }
  }
  clear(): void {
    this.n = 0;
  }
  private remove(i: number): void {
    const last = --this.n;
    if (i === last) return;
    for (const a of this.f) a[i] = a[last]!;
    this.color[i] = this.color[last]!;
    this.shape[i] = this.shape[last]!;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Onomatopoeia bursts and wobbling pop numbers
// ---------------------------------------------------------------------------------------------------------------

interface Pow {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  size: number;
  fill: string;
  textFill: string;
  rot: number;
  seed: number;
  /** "burst": text on a jagged burst; "float": bare sticker number that rises and wobbles. */
  kind: "burst" | "float";
  spr?: Sprite;
}

/** Pops in with overshoot, wobbles, then shrinks away. */
export class Pows {
  items: Pow[] = [];
  constructor(public reduced = false) {}
  burst(text: string, x: number, y: number, o: { size?: number; fill?: string; textFill?: string; life?: number; rot?: number } = {}): void {
    this.items.push({
      text,
      x,
      y,
      t: 0,
      life: o.life ?? 0.62,
      size: o.size ?? 30,
      fill: o.fill ?? PAL.banana,
      textFill: o.textFill ?? PAL.white,
      rot: o.rot ?? (Math.random() - 0.5) * 0.5,
      seed: Math.floor(Math.random() * 1e6),
      kind: "burst",
    });
    if (this.items.length > 12) this.items.shift();
  }
  float(text: string, x: number, y: number, o: { size?: number; textFill?: string; life?: number } = {}): void {
    this.items.push({
      text,
      x,
      y,
      t: 0,
      life: o.life ?? 0.8,
      size: o.size ?? 26,
      fill: PAL.ink,
      textFill: o.textFill ?? PAL.white,
      rot: (Math.random() - 0.5) * 0.3,
      seed: Math.floor(Math.random() * 1e6),
      kind: "float",
    });
    if (this.items.length > 12) this.items.shift();
  }
  update(dt: number): void {
    for (const p of this.items) p.t += dt;
    if (this.items.some((p) => p.t >= p.life)) this.items = this.items.filter((p) => p.t < p.life);
  }
  shift(dx: number, dy: number): void {
    for (const p of this.items) {
      p.x += dx;
      p.y += dy;
    }
  }
  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      const k = p.t / p.life;
      // Overshoot pop (0 -> 1.25 -> 1), a damped wobble, then a quick shrink.
      const pop = k < 0.14 ? (k / 0.14) * 1.25 : 1 + 0.25 * Math.exp(-(k - 0.14) * 14) * Math.cos((k - 0.14) * 40);
      const out = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
      const s = pop * out;
      if (s <= 0.02) continue;
      const wob = this.reduced ? 0 : Math.sin(p.t * 30) * 0.06 * Math.exp(-p.t * 5);
      if (p.kind === "burst") {
        if (!p.spr) {
          const m = measurer();
          m.font = font(p.size);
          const w = Math.max(p.size * 1.6, m.measureText(p.text).width * 0.62 + p.size * 0.9);
          const rx = w * 1.15 + 8;
          const ry = p.size * 1.3 * 1.15 + 8;
          p.spr = makeSprite(rx * 2 + 6, ry * 2 + 6, rx, ry, (cg) => {
            burstPath(cg, w, p.size * 1.3, 11, p.seed, 0.32);
            inkFill(cg, p.fill, 4.5, 5);
            stickerDirect(cg, p.text, { size: p.size, fill: p.textFill, stroke: 0.22, shadow: p.size * 0.08 });
          }, spriteScale * 1.15);
        }
        drawSprite(g, p.spr, p.x, p.y - (this.reduced ? 0 : k * 16), p.rot + wob, s, s);
      } else {
        sticker(g, p.text, p.x, p.y - (this.reduced ? k * 20 : easeOut(k) * 46), {
          size: p.size,
          fill: p.textFill,
          rot: p.rot + wob * 2,
          sx: s,
          sy: s,
        });
      }
    }
  }
  clear(): void {
    this.items = [];
  }
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** A scale spring for HUD numbers that pop and wobble on change. */
export class Wobble {
  v = 1;
  vel = 0;
  constructor(
    public k = 320,
    public d = 11,
  ) {}
  kick(amount: number): void {
    this.vel += amount;
  }
  update(dt: number): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel += (-this.k * (this.v - 1) - this.d * this.vel) * h;
      this.v += this.vel * h;
    }
    return this.v;
  }
}
