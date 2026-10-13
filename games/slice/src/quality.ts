import type { Application } from "pixi.js";

/**
 * Dynamic resolution: if the game can't hold ~50 fps for two consecutive seconds, render at a lower
 * resolution (2 -> 1.5 -> 1). Phones with a weak GPU (or none: software GL) keep a smooth frame rate;
 * everyone else keeps full sharpness. Never steps back up within a session (avoids oscillation).
 */
export function createQuality(app: Application, onChange?: (resolution: number) => void): (dt: number) => void {
  let frames = 0;
  let elapsed = 0;
  let slowSeconds = 0;
  let warmup = 1.5;
  return (dt: number) => {
    if (dt <= 0 || dt > 0.25) return; // first frame after a pause/resume, or a hitch
    if (warmup > 0) {
      warmup -= dt;
      return;
    }
    frames++;
    elapsed += dt;
    if (elapsed < 1) return;
    const fps = frames / elapsed;
    frames = 0;
    elapsed = 0;
    slowSeconds = fps < 50 ? slowSeconds + 1 : 0;
    const res = app.renderer.resolution;
    if (slowSeconds >= 2 && res > 1) {
      const next = Math.max(1, res - 0.5);
      app.renderer.resolution = next;
      app.renderer.resize(window.innerWidth, window.innerHeight);
      slowSeconds = 0;
      warmup = 1;
      onChange?.(next);
    }
  };
}
