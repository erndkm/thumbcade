import { PAPER } from "./palette.ts";

/**
 * The page: a cream sheet with grain, a soft cloudy formation and a few fibres, generated once into a
 * seamless tile and laid on a static background canvas. The game draws its ink on a transparent canvas
 * above it, so the paper costs nothing per frame.
 */

const TILE = 240;

function periodicNoise(cells: number, rand: () => number): (x: number, y: number) => number {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand() * 2 - 1;
  const at = (i: number, j: number) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]!;
  return (x, y) => {
    const fx = x * cells;
    const fy = y * cells;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seamless paper tile, `TILE` CSS px square, rendered at `scale` device px per CSS px. */
export function paperTile(scale: number, seed = 7): HTMLCanvasElement {
  const size = Math.round(TILE * scale);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rand = mulberry(seed);
  const base = parseInt(PAPER.slice(1), 16);
  const br = (base >> 16) & 255;
  const bg = (base >> 8) & 255;
  const bb = base & 255;
  const cloud = periodicNoise(5, rand);
  const mottle = periodicNoise(14, rand);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const l = cloud(u, v) * 5 + mottle(u, v) * 2.4 + (rand() - 0.5) * 7;
      const i = (y * size + x) * 4;
      d[i] = br + l;
      d[i + 1] = bg + l * 0.96;
      d[i + 2] = bb + l * 0.9;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Fibres: short, faint, slightly curved strands, light and dark, wrapped across the edges.
  g.lineCap = "round";
  for (let n = 0; n < 90; n++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = (5 + rand() * 18) * scale;
    const a = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * 0.9;
    const light = rand() < 0.55;
    g.strokeStyle = light ? `rgba(255,252,244,${0.18 + rand() * 0.2})` : `rgba(96,80,60,${0.05 + rand() * 0.06})`;
    g.lineWidth = (0.35 + rand() * 0.5) * scale;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx < -len || sx > size + len || sy < -len || sy > size + len) continue;
        g.beginPath();
        g.moveTo(sx, sy);
        const mx = sx + Math.cos(a) * len * 0.5 + Math.cos(a + Math.PI / 2) * len * bend * 0.3;
        const my = sy + Math.sin(a) * len * 0.5 + Math.sin(a + Math.PI / 2) * len * bend * 0.3;
        g.quadraticCurveTo(mx, my, sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        g.stroke();
      }
    }
  }
  // A few specks of pulp.
  for (let n = 0; n < 7; n++) {
    g.fillStyle = `rgba(90,72,55,${0.12 + rand() * 0.14})`;
    g.beginPath();
    g.arc(rand() * size, rand() * size, (0.35 + rand() * 0.5) * scale, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export interface Surface {
  /** Transparent ink canvas, full viewport. Draw in CSS px after `begin()`. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  begin(): void;
  onResize(cb: () => void): void;
}

/** Paper underneath, ink above. Both at full device pixel ratio (capped at 3). */
export function createSurface(): Surface {
  const css = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  const paper = document.createElement("canvas");
  const ink = document.createElement("canvas");
  paper.style.cssText = css;
  ink.style.cssText = css;
  document.body.style.background = PAPER;
  document.body.append(paper, ink);
  const pctx = paper.getContext("2d", { alpha: false })!;
  const ctx = ink.getContext("2d")!;
  let tile: HTMLCanvasElement | null = null;
  let tileScale = 0;
  const listeners: Array<() => void> = [];
  const s: Surface = {
    canvas: ink,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    begin() {
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, s.width, s.height);
    },
    onResize(cb) {
      listeners.push(cb);
    },
  };
  const resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (w === s.width && h === s.height && dpr === s.dpr) return;
    s.width = w;
    s.height = h;
    s.dpr = dpr;
    for (const c of [paper, ink]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const want = Math.min(dpr, 2);
    if (!tile || tileScale !== want) {
      tile = paperTile(want);
      tileScale = want;
    }
    const pattern = pctx.createPattern(tile, "repeat")!;
    pattern.setTransform(new DOMMatrix().scale(dpr / want));
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.fillStyle = pattern;
    pctx.fillRect(0, 0, paper.width, paper.height);
    listeners.forEach((l) => l());
  };
  resize();
  window.addEventListener("resize", resize);
  return s;
}
