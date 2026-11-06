/**
 * The bitbybit look: a risograph print that moves. Every color on screen is one of a few spot inks laid down on
 * warm paper, each ink on its own plate. Plates overprint (multiply), so two inks crossing make a third color;
 * each plate sits a hair off register; the ink lies a little unevenly (grain); tints are halftone screens, never
 * gradients or alpha washes. No outlines, no glow, no drop shadows.
 *
 * Usage, once per frame:
 *   press.begin();                         // clears every plate
 *   const c = press.plate("teal");         // a 2D context in CSS px, filled in that ink only
 *   c.fillStyle = press.solid("teal");     // full-strength ink
 *   c.fillStyle = press.screen("teal", 0.3); // a 30 % halftone tint
 *   ...
 *   press.print(ctx);                      // paper, then every plate overprinted with grain and misregistration
 *
 * Plates draw in screen space (CSS px). For a world camera, call `press.transform(c, a, b, c, d, e, f)`, which
 * prepends the plate's pixel scale, instead of `setTransform`.
 */

export interface Ink {
  name: string;
  color: string;
  /**
   * Halftone screen angle (rad). Different angles per ink keep overlapping screens free of moiré. Snapped to within a
   * degree or so of an angle whose screen tiles (see makeScreen).
   */
  angle: number;
}

export interface PressOptions {
  paper: string;
  inks: Ink[];
  /** 0..1: how much ink the grain lifts off each plate. */
  grain?: number;
  /** Max misregistration per plate in CSS px. */
  slip?: number;
  /** Halftone cell size in CSS px. */
  cell?: number;
  /** Plate resolution relative to the canvas (lower is cheaper). */
  scale?: number;
}

interface Plate {
  ink: Ink;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dx: number;
  dy: number;
  grainShift: [number, number];
  screens: Map<number, CanvasPattern>;
}

function hash(n: number, seed: number): number {
  let h = Math.imul(n | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Press {
  readonly paper: string;
  readonly inks: Ink[];
  private plates: Plate[] = [];
  private byName = new Map<string, Plate>();
  private W = 1;
  private H = 1;
  private px = 1;
  private grain: number;
  private slip: number;
  private cell: number;
  private scale: number;
  private grainTile: HTMLCanvasElement;
  private grainPattern: CanvasPattern | null = null;
  private paperCanvas: HTMLCanvasElement | null = null;

  constructor(opts: PressOptions) {
    this.paper = opts.paper;
    this.inks = opts.inks;
    this.grain = opts.grain ?? 0.55;
    this.slip = opts.slip ?? 1.4;
    this.cell = opts.cell ?? 4.2;
    this.scale = opts.scale ?? 1;
    this.grainTile = makeGrain(GRAIN_TILE, 7);
    for (const ink of opts.inks) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const p: Plate = { ink, canvas, ctx, dx: 0, dy: 0, grainShift: [0, 0], screens: new Map() };
      this.plates.push(p);
      this.byName.set(ink.name, p);
    }
    this.register(1);
  }

  /** Size every plate for a canvas of w × h CSS px at `dpr`. */
  resize(w: number, h: number, dpr: number): void {
    this.W = w;
    this.H = h;
    this.px = dpr * this.scale;
    for (const p of this.plates) {
      p.canvas.width = Math.max(1, Math.round(w * this.px));
      p.canvas.height = Math.max(1, Math.round(h * this.px));
      p.screens.clear();
    }
    this.grainPattern = null;
    this.paperCanvas = null;
  }

  /** New misregistration for every plate (call when a run starts: every print comes off the drum a bit different). */
  register(seed: number): void {
    this.plates.forEach((p, i) => {
      const a = hash(seed * 31 + i, 3) * Math.PI * 2;
      const r = this.slip * (0.45 + 0.55 * hash(seed * 31 + i, 5));
      // The first plate is the key plate and stays put.
      p.dx = i === 0 ? 0 : Math.cos(a) * r;
      p.dy = i === 0 ? 0 : Math.sin(a) * r;
      p.grainShift = [Math.floor(hash(seed + i, 9) * GRAIN_TILE), Math.floor(hash(seed + i, 11) * GRAIN_TILE)];
    });
  }

  begin(): void {
    for (const p of this.plates) {
      p.ctx.setTransform(1, 0, 0, 1, 0, 0);
      p.ctx.globalAlpha = 1;
      p.ctx.globalCompositeOperation = "source-over";
      p.ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
      p.ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    }
  }

  private get(name: string): Plate {
    const p = this.byName.get(name);
    if (!p) throw new Error(`no plate for ink "${name}"`);
    return p;
  }

  /** The plate for an ink, transform reset to CSS px. */
  plate(name: string): CanvasRenderingContext2D {
    const p = this.get(name);
    p.ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    return p.ctx;
  }

  /** Like `ctx.setTransform(a, b, c, d, e, f)` in CSS px, with the plate's pixel scale prepended. */
  transform(ctx: CanvasRenderingContext2D, a: number, b: number, c: number, d: number, e: number, f: number): void {
    const s = this.px;
    ctx.setTransform(a * s, b * s, c * s, d * s, e * s, f * s);
  }

  solid(name: string): string {
    return this.get(name).ink.color;
  }

  /**
   * A halftone tint of an ink: dots on a screen fixed to the paper, whatever the plate's transform is now.
   * `level` is ink coverage 0..1 (quantized to 5 % steps).
   */
  screen(name: string, level: number): CanvasPattern | string {
    const p = this.get(name);
    const q = Math.round(Math.max(0, Math.min(1, level)) * 20);
    if (q >= 20) return p.ink.color;
    if (q <= 0) return "rgba(0,0,0,0)";
    let pat = p.screens.get(q);
    if (!pat) {
      pat = makeScreen(p.ctx, p.ink.color, q / 20, this.cell * this.px, p.ink.angle);
      p.screens.set(q, pat);
    }
    // Pin the screen to the paper: undo the current transform. The screen angle is drawn into the tile instead of
    // set here: WebKit fills a rotated or scaled pattern on a slow path that drops a frame to a second or more.
    pat.setTransform(p.ctx.getTransform().inverse());
    return pat;
  }

  /** Paper, then every plate overprinted: grain lifts some ink, each plate lands slightly off register. */
  print(ctx: CanvasRenderingContext2D): void {
    const W = this.W;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.paperTexture(ctx), 0, 0);
    if (!this.grainPattern) this.grainPattern = this.plates[0]!.ctx.createPattern(this.grainTile, "repeat");
    const k = ctx.canvas.width / Math.max(1, W * this.px);
    for (const p of this.plates) {
      const c = p.ctx;
      if (this.grain > 0 && this.grainPattern) {
        c.save();
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalCompositeOperation = "destination-out";
        c.globalAlpha = this.grain;
        this.grainPattern.setTransform(new DOMMatrix([1, 0, 0, 1, p.grainShift[0], p.grainShift[1]]));
        c.fillStyle = this.grainPattern;
        c.fillRect(0, 0, p.canvas.width, p.canvas.height);
        c.restore();
      }
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(p.canvas, p.dx * this.px * k, p.dy * this.px * k, p.canvas.width * k, p.canvas.height * k);
    }
    ctx.restore();
  }

  /** Warm paper with faint fibres, rendered once per size. */
  private paperTexture(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (this.paperCanvas && this.paperCanvas.width === w && this.paperCanvas.height === h) return this.paperCanvas;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { alpha: false })!;
    g.fillStyle = this.paper;
    g.fillRect(0, 0, w, h);
    const s = w / Math.max(1, this.W);
    const n = Math.round((this.W * this.H) / 260);
    for (let i = 0; i < n; i++) {
      const x = hash(i, 21) * w;
      const y = hash(i, 22) * h;
      const a = 0.025 + hash(i, 23) * 0.05;
      g.fillStyle = hash(i, 24) < 0.7 ? `rgba(90,70,40,${a.toFixed(3)})` : `rgba(255,255,255,${(a * 2).toFixed(3)})`;
      if (hash(i, 25) < 0.18) {
        // A fibre.
        g.save();
        g.translate(x, y);
        g.rotate(hash(i, 26) * Math.PI);
        g.fillRect(0, 0, (3 + hash(i, 27) * 9) * s, 0.5 * s);
        g.restore();
      } else g.fillRect(x, y, s * 0.8, s * 0.8);
    }
    this.paperCanvas = c;
    return c;
  }
}

/**
 * A tileable halftone screen: round dots on a grid turned to the ink's screen angle, each dot's area equal to the
 * coverage. The angle snaps to atan(p / q) for small p, q; that grid repeats every cell·√(p² + q²) along both axes,
 * so one square tile carries the whole turned screen.
 */
function makeScreen(ctx: CanvasRenderingContext2D, color: string, level: number, cellPx: number, angle: number): CanvasPattern {
  const [p, q] = screenSlope(angle);
  const n = Math.hypot(p, q);
  const size = Math.max(3, Math.round(cellPx * n));
  const cell = size / n;
  const ca = q / n;
  const sa = p / n;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  // Past ~78 % the dots merge: draw the paper holes (between the dots) instead.
  const holes = level > 0.78;
  const r = Math.sqrt(((holes ? 1 - level : level) * cell * cell) / Math.PI);
  const o = holes ? 0.5 : 0;
  if (holes) {
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = "destination-out";
  }
  g.beginPath();
  const k = Math.ceil(n * 1.5) + 2;
  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) {
      const x = ((i + o) * ca - (j + o) * sa) * cell;
      const y = ((i + o) * sa + (j + o) * ca) * cell;
      if (x < -r || x > size + r || y < -r || y > size + r) continue;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  g.fill();
  return ctx.createPattern(c, "repeat")!;
}

/** The screen angle nearest `angle` (rad) whose grid repeats in a small square tile, as the slope p / q. */
function screenSlope(angle: number): [number, number] {
  const quarter = Math.PI / 2;
  const a = ((angle % quarter) + quarter) % quarter;
  let best: [number, number] = [0, 1];
  let bestCost = Infinity;
  for (let q = 0; q <= 5; q++) {
    for (let p = 0; p <= 5; p++) {
      if (p === 0 && q === 0) continue;
      // Closest angle first; between near-equal ones, the smaller tile.
      const cost = Math.abs(Math.atan2(p, q) - a) + Math.hypot(p, q) * 1e-3;
      if (cost < bestCost) {
        bestCost = cost;
        best = [p, q];
      }
    }
  }
  return best;
}

const GRAIN_TILE = 384;

/** Speckled grain: mostly clear, with soft clusters where the drum laid less ink. */
function makeGrain(size: number, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Three octaves of tileable value noise (no octave lines up with the tile's grid), plus per-pixel speckle.
      const blot = tileNoise(x, y, size, 77, seed) * 0.5 + tileNoise(x, y, size, 29, seed + 1) * 0.32 + tileNoise(x, y, size, 11, seed + 3) * 0.18;
      const speck = hash(x + y * size, seed + 2);
      let a = Math.max(0, blot - 0.56) * 1.3 + (speck > 0.9 ? (speck - 0.9) * 6 : 0);
      a = Math.min(1, a);
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function tileNoise(x: number, y: number, size: number, period: number, seed: number): number {
  const n = Math.max(1, Math.round(size / period));
  const fx = (x / size) * n;
  const fy = (y / size) * n;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);
  const v = (i: number, j: number) => hash(((i % n) + n) % n + (((j % n) + n) % n) * 977, seed);
  const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * ux;
  const b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * ux;
  return a + (b - a) * uy;
}

/** Spot inks after real riso drum colors. Each game picks three or four. */
export const RISO = {
  fluoPink: "#FF48B0",
  teal: "#00838A",
  yellow: "#FFE800",
  blue: "#0078BF",
  federal: "#3D5588",
  orange: "#FF6C2F",
  sunflower: "#FFB511",
  brightRed: "#F15060",
  green: "#00A95C",
  aqua: "#5EC8E5",
  purple: "#765BA7",
  black: "#2B2A2A",
} as const;

/** Warm uncoated stock. */
export const PAPER = "#F3EDE0";
