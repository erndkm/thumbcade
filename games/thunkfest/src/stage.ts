import { WebGLRenderer } from "three";

/** A full-viewport WebGL canvas plus a transparent 2D canvas on top for the comic HUD. */
export interface Stage {
  renderer: WebGLRenderer;
  hud: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  /** Clears the HUD canvas and sets CSS-pixel space. */
  beginHud(): void;
  onResize(cb: (w: number, h: number) => void): void;
}

export function createStage(clear: number): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setClearColor(clear, 1);
  const gl = renderer.domElement;
  gl.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  document.body.appendChild(gl);
  const hudCanvas = document.createElement("canvas");
  hudCanvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;pointer-events:none";
  document.body.appendChild(hudCanvas);
  const hud = hudCanvas.getContext("2d")!;
  const listeners: Array<(w: number, h: number) => void> = [];
  const stage: Stage = {
    renderer,
    hud,
    width: 0,
    height: 0,
    dpr: 1,
    beginHud() {
      hud.setTransform(1, 0, 0, 1, 0, 0);
      hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
      hud.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    },
    onResize(cb) {
      listeners.push(cb);
    },
  };
  const resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === stage.width && h === stage.height && dpr === stage.dpr) return;
    stage.width = w;
    stage.height = h;
    stage.dpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    hudCanvas.width = Math.round(w * dpr);
    hudCanvas.height = Math.round(h * dpr);
    listeners.forEach((l) => l(w, h));
  };
  resize();
  window.addEventListener("resize", resize);
  return stage;
}
