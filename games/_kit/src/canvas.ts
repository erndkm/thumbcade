/** A full-viewport 2D canvas with device-pixel-ratio handling. Draw in CSS pixels. */
export interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Viewport size in CSS px. */
  width: number;
  height: number;
  dpr: number;
  /** Resets the transform to CSS-pixel space (call at the start of every frame). */
  begin(): void;
  onResize(cb: (w: number, h: number) => void): void;
}

export function createCanvas(opts: { maxDpr?: number; parent?: HTMLElement; background?: string } = {}): Canvas2D {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  (opts.parent ?? document.body).appendChild(canvas);
  if (opts.background) document.body.style.background = opts.background;
  const ctx = canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
  const listeners: Array<(w: number, h: number) => void> = [];
  const state: Canvas2D = {
    canvas,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    begin() {
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    },
    onResize(cb) {
      listeners.push(cb);
    },
  };
  const resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2);
    if (w === state.width && h === state.height && dpr === state.dpr) return;
    state.width = w;
    state.height = h;
    state.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    listeners.forEach((l) => l(w, h));
  };
  resize();
  window.addEventListener("resize", resize);
  return state;
}
