import type { Insets } from "@thumbcade/sdk";
import { FONT } from "./fonts.ts";
import { P } from "./palette.ts";

/**
 * DOM overlay: the score with its little cube, a sub chip, the best chip, the "Tap to start" pill with
 * a hopping cube cursor, and floating "+3" toasts. Positions follow the current safe insets.
 */

export interface CubeTones {
  top: string;
  left: string;
  right: string;
}

export const cubeSvg = (t: CubeTones, size = 24): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,1.5 21.5,7 12,12.5 2.5,7" fill="${t.top}"/><polygon points="2.5,7 12,12.5 12,23 2.5,17.5" fill="${t.left}"/><polygon points="12,12.5 21.5,7 21.5,17.5 12,23" fill="${t.right}"/></svg>`;

export const FOX_CUBE: CubeTones = { top: "#FFB98A", left: P.fox, right: P.foxDeep };

export interface Hud {
  root: HTMLDivElement;
  layout(safe: Insets): void;
  /** Score block visible (play) or hidden (attract). */
  showScore(on: boolean): void;
  setScore(n: number): void;
  /** A small chip under the score: icon tones + text, or null to hide. */
  setSub(text: string | null, tones?: CubeTones): void;
  setBest(n: number | null, label?: string): void;
  /** One line of how-to under the title sign (attract only). */
  setHint(text: string): void;
  showBest(on: boolean): void;
  showHint(on: boolean): void;
  /** Places the hint and best chips at an absolute screen position (px). */
  placeBest(x: number, y: number): void;
  setPrompt(text: string | null): void;
  toast(text: string, x: number, y: number, color?: string): void;
  bump(): void;
  update(dt: number, time: number): void;
}

const CSS = `
.lpf{position:fixed;inset:0;pointer-events:none;font-family:${FONT};color:${P.ink};-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.lpf *{box-sizing:border-box}
.lpf-score{position:absolute;display:flex;align-items:center;gap:9px;transform-origin:0 50%;transition:opacity .25s ease,transform .35s cubic-bezier(.3,1.6,.5,1)}
.lpf-score.off{opacity:0;transform:translateY(-14px) scale(.9)}
.lpf-num{font-weight:900;font-size:46px;line-height:1;letter-spacing:-.02em;text-shadow:0 3px 0 rgba(255,255,255,.85),0 8px 16px rgba(75,64,96,.18)}
.lpf-score svg{filter:drop-shadow(0 3px 0 rgba(75,64,96,.14))}
.lpf-pill{position:absolute;display:flex;align-items:center;gap:7px;background:${P.cream};border-radius:999px;padding:8px 14px;font-weight:500;font-size:14px;line-height:1;white-space:nowrap;box-shadow:0 3px 0 rgba(75,64,96,.13),0 10px 22px rgba(75,64,96,.13);transition:opacity .25s ease,transform .3s cubic-bezier(.3,1.6,.5,1)}
.lpf-pill.off{opacity:0;transform:translateY(8px) scale(.92)}
.lpf-pill b{font-weight:900}
.lpf-prompt{font-size:16px;padding:12px 20px 12px 20px}
.lpf-hint{font-size:13px;padding:7px 12px;background:rgba(255,247,236,.9);color:${P.inkSoft}}
.lpf-cursor{position:absolute;left:10px;top:-20px;width:26px;height:26px;transform-origin:50% 100%}
.lpf-toast{position:absolute;left:0;top:0;font-weight:900;font-size:22px;white-space:nowrap;text-shadow:0 2px 0 rgba(255,255,255,.9);will-change:transform,opacity;opacity:0}
`;

export function createHud(): Hud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.className = "lpf";
  document.body.appendChild(root);

  const score = document.createElement("div");
  score.className = "lpf-score off";
  score.innerHTML = `${cubeSvg(FOX_CUBE, 30)}<span class="lpf-num">0</span>`;
  root.appendChild(score);
  const num = score.querySelector<HTMLSpanElement>(".lpf-num")!;

  const sub = document.createElement("div");
  sub.className = "lpf-pill off";
  root.appendChild(sub);

  const best = document.createElement("div");
  best.className = "lpf-pill off";
  root.appendChild(best);
  const hint = document.createElement("div");
  hint.className = "lpf-pill lpf-hint off";
  root.appendChild(hint);

  const prompt = document.createElement("div");
  prompt.className = "lpf-pill lpf-prompt off";
  prompt.innerHTML = `<span class="lpf-cursor">${cubeSvg({ top: P.butter, left: P.butterDeep, right: "#E0A93E" }, 26)}</span><span class="lpf-txt"></span>`;
  root.appendChild(prompt);
  const promptTxt = prompt.querySelector<HTMLSpanElement>(".lpf-txt")!;
  const cursor = prompt.querySelector<HTMLSpanElement>(".lpf-cursor")!;

  const toasts = Array.from({ length: 6 }, () => {
    const el = document.createElement("div");
    el.className = "lpf-toast";
    root.appendChild(el);
    return { el, t: 1, x: 0, y: 0 };
  });
  let toastNext = 0;

  let shown = -1;
  let bumpT = 1;
  let safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  const hud: Hud = {
    root,
    layout(s) {
      safe = s;
      const W = window.innerWidth;
      const H = window.innerHeight;
      score.style.left = `${s.left + 18}px`;
      score.style.top = `${s.top + 14}px`;
      sub.style.left = `${s.left + 18}px`;
      sub.style.top = `${s.top + 70}px`;
      const cx = s.left + (W - s.left - s.right) / 2;
      prompt.style.left = `${cx}px`;
      prompt.style.top = `${H - s.bottom - 64}px`;
      prompt.style.translate = "-50% 0";
    },
    showScore(on) {
      score.classList.toggle("off", !on);
      if (!on) sub.classList.add("off");
    },
    setScore(n) {
      if (n === shown) return;
      shown = n;
      num.textContent = String(n);
    },
    setSub(text, tones) {
      if (text === null) {
        sub.classList.add("off");
        return;
      }
      sub.innerHTML = `${cubeSvg(tones ?? FOX_CUBE, 16)}<b>${text}</b>`;
      sub.classList.remove("off");
    },
    setBest(n, label = "Best") {
      best.innerHTML = n === null ? "" : `${cubeSvg({ top: P.lilac, left: P.lilacDeep, right: "#8A75CC" }, 16)}${label} <b>${n}</b>`;
    },
    setHint(text) {
      hint.textContent = text;
    },
    showBest(on) {
      best.classList.toggle("off", !on || best.innerHTML === "");
    },
    showHint(on) {
      hint.classList.toggle("off", !on || hint.textContent === "");
    },
    placeBest(x, y) {
      const l = `${Math.max(safe.left + 12, x)}px`;
      hint.style.left = l;
      hint.style.top = `${y}px`;
      best.style.left = l;
      best.style.top = `${y + 38}px`;
    },
    setPrompt(text) {
      if (text === null) {
        prompt.classList.add("off");
        return;
      }
      promptTxt.textContent = text;
      prompt.classList.remove("off");
    },
    toast(text, x, y, color = P.berryDeep) {
      const t = toasts[toastNext]!;
      toastNext = (toastNext + 1) % toasts.length;
      t.el.textContent = text;
      t.el.style.color = color;
      t.t = 0;
      t.x = x;
      t.y = y;
    },
    bump() {
      bumpT = 0;
    },
    update(dt, time) {
      // The cube cursor hops on the pill: up, down, squash.
      const ph = (time * 1.5) % 1;
      const air = Math.sin(Math.min(1, ph / 0.72) * Math.PI);
      const land = ph > 0.72 ? Math.sin(((ph - 0.72) / 0.28) * Math.PI) : 0;
      cursor.style.transform = `translateY(${(-air * 12).toFixed(1)}px) scale(${(1 + land * 0.18).toFixed(3)},${(1 - land * 0.2).toFixed(3)})`;
      bumpT = Math.min(1, bumpT + dt * 4);
      const b = bumpT < 1 ? Math.sin(bumpT * Math.PI) * 0.12 : 0;
      num.style.transform = b ? `scale(${(1 + b).toFixed(3)})` : "";
      for (const t of toasts) {
        if (t.t >= 1) continue;
        t.t = Math.min(1, t.t + dt / 0.85);
        const rise = 1 - (1 - t.t) ** 3;
        const pop = t.t < 0.15 ? 0.6 + (t.t / 0.15) * 0.5 : 1.1 - Math.min(0.1, (t.t - 0.15) * 0.4);
        t.el.style.opacity = t.t >= 1 ? "0" : String(Math.min(1, (1 - t.t) * 2.5));
        t.el.style.transform = `translate(${t.x}px, ${(t.y - 20 - rise * 42).toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      }
    },
  };
  num.style.display = "inline-block";
  num.style.transformOrigin = "0 60%";
  return hud;
}
