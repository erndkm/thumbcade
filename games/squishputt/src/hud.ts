/**
 * The paper-and-clay layer on top of the scene (DOM): the title plaque with hand-placed letters, the speech
 * bubble, little clay chips for the HUD, popups and the hole card. Everything wobbles in 12 fps steps.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import type { Insets } from "@thumbcade/sdk";
import { PAL } from "./palette.ts";

const FONT = `"Fredoka", "Avenir Next Rounded", ui-rounded, system-ui, sans-serif`;

const CSS = `
.sp-hud{position:fixed;inset:0;pointer-events:none;font-family:${FONT};color:${PAL.chocDeep};-webkit-font-smoothing:antialiased;user-select:none;overflow:hidden}
.sp-hud *{box-sizing:border-box}
.sp-bubble{position:absolute}
.sp-abs{position:absolute;left:0;top:0;width:max-content;will-change:transform;transform-origin:30% 50%}
.sp-clay{border-radius:18px;
  box-shadow:inset 0 3px 1px rgba(255,255,255,.55),inset 0 -4px 2px rgba(80,40,20,.14),0 5px 0 var(--deep),0 9px 14px rgba(90,50,30,.28)}
.sp-clay::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:repeating-radial-gradient(ellipse 60% 45% at var(--px,72%) var(--py,62%),rgba(70,35,20,.075) 0 1.5px,transparent 1.5px 4.5px);
  -webkit-mask-image:radial-gradient(ellipse 26% 40% at var(--px,72%) var(--py,62%),#000 55%,transparent 100%);
  mask-image:radial-gradient(ellipse 26% 40% at var(--px,72%) var(--py,62%),#000 55%,transparent 100%)}
.sp-plaque{padding:10px 20px 14px;background:radial-gradient(130% 110% at 30% 20%,#F8B9A6 0%,${PAL.salmon} 55%,#E68F78 100%);--deep:${PAL.salmonDeep};border-radius:26px}
.sp-title{font-weight:700;font-size:46px;line-height:1;letter-spacing:.5px;white-space:nowrap;display:flex}
.sp-title span{display:inline-block;color:${PAL.cream};text-shadow:0 3px 0 ${PAL.chocDeep},0 4px 3px rgba(60,30,20,.35)}
.sp-chip{font-weight:600;font-size:14px;line-height:1;padding:8px 13px 9px;white-space:nowrap;border-radius:14px;
  background:radial-gradient(130% 120% at 30% 20%,#FFFDF6 0%,${PAL.cream} 60%,${PAL.creamDeep} 100%);--deep:${PAL.creamDeep}}
.sp-butter{background:radial-gradient(130% 120% at 30% 20%,#FFF0BF 0%,${PAL.butter} 60%,${PAL.butterDeep} 100%);--deep:${PAL.butterDeep}}
.sp-lav{background:radial-gradient(130% 120% at 30% 20%,#E6DBFA 0%,${PAL.lavender} 60%,${PAL.lavenderDeep} 100%);--deep:${PAL.lavenderDeep}}
.sp-sage{background:radial-gradient(130% 120% at 30% 20%,#D4EBC7 0%,${PAL.sage} 60%,${PAL.sageDeep} 100%);--deep:${PAL.sageDeep}}
.sp-powder{background:radial-gradient(130% 120% at 30% 20%,#D8EAFA 0%,${PAL.powder} 60%,${PAL.powderDeep} 100%);--deep:${PAL.powderDeep}}
.sp-salmon{background:radial-gradient(130% 120% at 30% 20%,#F9C5B6 0%,${PAL.salmon} 60%,${PAL.salmonDeep} 100%);--deep:${PAL.salmonDeep}}
.sp-bubble{padding:12px 18px 13px;font-weight:700;font-size:22px;border-radius:24px;white-space:nowrap}
.sp-tail{position:absolute;width:22px;height:22px;bottom:-9px;border-radius:5px 2px 9px 2px;transform:rotate(45deg);
  background:${PAL.cream};box-shadow:4px 4px 0 ${PAL.creamDeep}}
.sp-big{font-weight:700;font-size:26px;line-height:1}
.sp-small{font-weight:600;font-size:12px;opacity:.78;line-height:1}
.sp-stack{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 13px 8px}
.sp-beads{display:flex;gap:4px;align-items:center;padding:9px 11px 10px;min-height:38px}
.sp-bead{width:13px;height:13px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0%,${PAL.ball} 45%,#E2D3BC 100%);
  box-shadow:0 2px 0 rgba(90,50,30,.35)}
.sp-bead.gone{background:radial-gradient(circle at 50% 40%,rgba(90,50,30,.28),rgba(90,50,30,.12));box-shadow:inset 0 1px 1px rgba(60,30,20,.3)}
.sp-pop{font-weight:700;font-size:20px;padding:8px 14px 9px;border-radius:16px;white-space:nowrap}
.sp-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 26px 20px;border-radius:28px}
.sp-card .sp-big{font-size:40px}
.sp-card .sp-name{font-weight:600;font-size:17px}
.sp-hide{display:none!important}
`;

export interface HudLayout {
  w: number;
  h: number;
  safe: Insets;
}

interface Pop {
  el: HTMLDivElement;
  x: number;
  y: number;
  age: number;
  life: number;
}

const SQUISH = [0.35, 1.18, 0.92, 1.04, 1];

export class Hud {
  readonly root = document.createElement("div");
  private plaque = document.createElement("div");
  private letters: HTMLSpanElement[] = [];
  private tagline = document.createElement("div");
  private bestChip = document.createElement("div");
  private bubble = document.createElement("div");
  private holeChip = document.createElement("div");
  private scoreChip = document.createElement("div");
  private strokeChip = document.createElement("div");
  private clockChip = document.createElement("div");
  private card = document.createElement("div");
  private overCard = document.createElement("div");
  private pops: Pop[] = [];
  private beads: HTMLDivElement[] = [];
  private mode: "attract" | "play" | "over" = "attract";
  private plaquePos = { x: 0, y: 0 };
  private bubblePos = { x: 0, y: 0, tail: 0.3 };
  private cardAge = Infinity;
  private plaqueAge = 0;
  private stepN = 0;
  private reduced = false;

  constructor() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.className = "sp-hud";
    document.body.appendChild(this.root);

    this.plaque.className = "sp-abs sp-clay sp-plaque";
    const title = document.createElement("div");
    title.className = "sp-title";
    for (const ch of "Squishputt") {
      const s = document.createElement("span");
      s.textContent = ch;
      title.appendChild(s);
      this.letters.push(s);
    }
    this.plaque.appendChild(title);
    this.tagline.className = "sp-abs sp-clay sp-chip";
    this.tagline.textContent = "mini golf, squished by hand";
    this.tagline.style.setProperty("--px", "20%");
    this.bestChip.className = "sp-abs sp-clay sp-chip sp-butter";
    this.bubble.className = "sp-abs sp-clay sp-chip sp-bubble";
    this.bubble.innerHTML = `tap to play!<i class="sp-tail"></i>`;

    this.holeChip.className = "sp-abs sp-clay sp-chip sp-butter sp-stack";
    this.scoreChip.className = "sp-abs sp-clay sp-chip sp-stack";
    this.strokeChip.className = "sp-abs sp-clay sp-chip sp-lav sp-beads";
    this.clockChip.className = "sp-abs sp-clay sp-chip sp-salmon";
    this.card.className = "sp-abs sp-clay sp-chip sp-card sp-butter";
    this.overCard.className = "sp-abs sp-clay sp-chip sp-card";
    for (const el of [this.plaque, this.tagline, this.bestChip, this.bubble, this.holeChip, this.scoreChip, this.strokeChip, this.clockChip, this.card, this.overCard]) {
      this.root.appendChild(el);
    }
    this.card.classList.add("sp-hide");
    this.overCard.classList.add("sp-hide");
    this.clockChip.classList.add("sp-hide");
    this.setMode("attract");
  }

  setReduced(r: boolean): void {
    this.reduced = r;
  }

  setMode(m: "attract" | "play" | "over"): void {
    this.mode = m;
    const attract = m === "attract";
    for (const el of [this.plaque, this.tagline, this.bubble]) el.classList.toggle("sp-hide", !attract);
    this.bestChip.classList.toggle("sp-hide", !attract || !this.bestChip.textContent);
    for (const el of [this.holeChip, this.scoreChip, this.strokeChip]) el.classList.toggle("sp-hide", attract);
    if (attract) this.plaqueAge = 0;
    if (m !== "over") this.overCard.classList.add("sp-hide");
    if (m !== "play") this.clockChip.classList.add("sp-hide");
  }

  setBest(best: number | null): void {
    this.bestChip.textContent = best !== null && best > 0 ? `your best · ${best.toLocaleString("en-US")}` : "";
    this.bestChip.classList.toggle("sp-hide", this.mode !== "attract" || !this.bestChip.textContent);
  }

  setHole(n: number, par: number): void {
    this.holeChip.innerHTML = `<span class="sp-big">hole ${n}</span><span class="sp-small">par ${par}</span>`;
  }

  setScore(n: number): void {
    this.scoreChip.innerHTML = `<span class="sp-big">${n.toLocaleString("en-US")}</span><span class="sp-small">points</span>`;
  }

  setStrokes(n: number): void {
    const shown = Math.max(8, Math.min(12, n));
    while (this.beads.length < shown) {
      const b = document.createElement("div");
      b.className = "sp-bead";
      this.strokeChip.appendChild(b);
      this.beads.push(b);
    }
    while (this.beads.length > shown) this.beads.pop()!.remove();
    this.beads.forEach((b, i) => b.classList.toggle("gone", i >= n));
  }

  /** Seconds left on the shot clock, or null to hide it. */
  setClock(s: number | null): void {
    this.clockChip.classList.toggle("sp-hide", s === null);
    if (s !== null) this.clockChip.textContent = `hurry! ${s}`;
  }

  layout(l: HudLayout): void {
    const s = l.safe;
    const left = s.left + 16;
    this.plaquePos = { x: left, y: s.top + 16 };
    const top = s.top + 10;
    const right = l.w - s.right - 12;
    this.place(this.holeChip, left - 4, top);
    // Score sits in the middle, strokes on the right (measured after fonts load).
    const sw = this.scoreChip.offsetWidth || 80;
    this.place(this.scoreChip, l.w / 2 - sw / 2, top);
    const kw = this.strokeChip.offsetWidth || 130;
    this.place(this.strokeChip, right - kw, top + 2);
    const cw = this.clockChip.offsetWidth || 80;
    this.place(this.clockChip, right - cw, top + 54);
    const ow = this.overCard.offsetWidth || 220;
    const oh = this.overCard.offsetHeight || 150;
    this.place(this.overCard, (l.w - ow) / 2, (l.h - oh) / 2 - 20);
  }

  /** Puts the speech bubble near a screen point (the host critter), clamped into the safe area. */
  setBubbleAnchor(x: number, y: number, l: HudLayout): void {
    const bw = this.bubble.offsetWidth || 150;
    const bh = this.bubble.offsetHeight || 48;
    const s = l.safe;
    const minX = s.left + 14;
    const maxX = l.w - s.right - 14 - bw;
    const bx = Math.max(minX, Math.min(maxX, x - bw * 0.3));
    const by = Math.max(s.top + 150, Math.min(l.h - s.bottom - bh - 22, y - bh - 26));
    this.bubblePos = { x: bx, y: by, tail: Math.max(0.15, Math.min(0.85, (x - bx) / bw)) };
  }

  private place(el: HTMLElement, x: number, y: number, rot = 0, scale = 1): void {
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
  }

  popup(text: string, x: number, y: number, tone: "cream" | "butter" | "sage" | "salmon" | "powder" | "lav" = "cream", life = 1.3): void {
    const el = document.createElement("div");
    el.className = `sp-abs sp-clay sp-chip sp-pop${tone === "cream" ? "" : ` sp-${tone}`}`;
    el.textContent = text;
    el.style.setProperty("--px", `${20 + Math.random() * 60}%`);
    this.root.appendChild(el);
    this.pops.push({ el, x, y, age: 0, life });
  }

  holeCard(n: number, name: string, par: number): void {
    this.card.innerHTML = `<span class="sp-big">hole ${n}</span><span class="sp-name">${name}</span><span class="sp-small">par ${par}</span>`;
    this.card.classList.remove("sp-hide");
    this.cardAge = 0;
  }

  showOver(score: number, best: number | null, isBest: boolean, holes: number): void {
    this.overCard.innerHTML =
      `<span class="sp-name">${holes === 1 ? "1 hole sunk" : `${holes} holes sunk`}</span><span class="sp-big">${score.toLocaleString("en-US")}</span>` +
      `<span class="sp-small">${isBest ? "a new best ★" : best ? `best ${best.toLocaleString("en-US")}` : ""}</span>` +
      `<span class="sp-name" style="margin-top:6px">tap to go again</span>`;
    this.overCard.classList.remove("sp-hide");
  }

  /** One stop-motion step (12 fps): every element is re-posed with a tiny wobble. */
  step(rng: Rng, l: HudLayout): void {
    this.stepN++;
    const j = this.reduced ? 0.3 : 1;
    const wob = (a: number) => rng.range(-a, a) * j;
    if (this.mode === "attract") {
      this.plaqueAge++;
      const k = SQUISH[Math.min(SQUISH.length - 1, this.plaqueAge)]!;
      const scale = this.reduced ? 1 : k;
      this.place(this.plaque, this.plaquePos.x + wob(1), this.plaquePos.y + wob(1), -3 + wob(1.2), scale);
      // Letters were stuck on one by one; each one gets nudged on its own.
      this.letters.forEach((s, i) => {
        const bob = (this.stepN + i * 2) % 12 < 6 ? 0 : -1.5;
        s.style.transform = `translate(${wob(0.8).toFixed(1)}px,${(bob * j + wob(0.8)).toFixed(1)}px) rotate(${(((i % 3) - 1) * 2.5 + wob(3)).toFixed(1)}deg)`;
      });
      const pw = this.plaque.offsetWidth || 260;
      const ph = this.plaque.offsetHeight || 70;
      const tw = this.tagline.offsetWidth || 180;
      this.place(this.tagline, this.plaquePos.x + Math.max(18, pw - tw + 6) + wob(1), this.plaquePos.y + ph - 10 + wob(1), 2.5 + wob(1), scale);
      this.place(this.bestChip, this.plaquePos.x + 2 + wob(1), this.plaquePos.y + ph - 6 + wob(1), -3 + wob(1), scale);
      const b = this.bubblePos;
      const bounce = (this.stepN % 16 < 8 ? 0 : -3) * j;
      this.place(this.bubble, b.x + wob(1), b.y + bounce + wob(1), wob(2.2) + 1.5);
      const tail = this.bubble.querySelector<HTMLElement>(".sp-tail");
      if (tail) tail.style.left = `${(b.tail * (this.bubble.offsetWidth || 150) - 11).toFixed(0)}px`;
    } else {
      const top = l.safe.top + 10;
      const left = l.safe.left + 12;
      const right = l.w - l.safe.right - 12;
      this.place(this.holeChip, left + wob(0.6), top + wob(0.6), -2 + wob(1));
      const sw = this.scoreChip.offsetWidth || 80;
      this.place(this.scoreChip, l.w / 2 - sw / 2 + wob(0.6), top + wob(0.6), 1 + wob(1));
      const kw = this.strokeChip.offsetWidth || 130;
      this.place(this.strokeChip, right - kw + wob(0.6), top + 4 + wob(0.6), 1.5 + wob(1));
      const cw = this.clockChip.offsetWidth || 80;
      this.place(this.clockChip, right - cw + wob(1), top + 56 + wob(1), -3 + wob(3));
      if (this.mode === "over") {
        const ow = this.overCard.offsetWidth || 220;
        const oh = this.overCard.offsetHeight || 150;
        this.place(this.overCard, (l.w - ow) / 2 + wob(1), (l.h - oh) / 2 - 20 + wob(1), -1.5 + wob(1.2));
      }
    }
    // Hole card: squish in, hold, squish out.
    if (this.cardAge < Infinity) {
      this.cardAge++;
      const n = this.cardAge;
      const out = n > 17 ? Math.max(0, 1 - (n - 17) / 3) : 1;
      const k = (this.reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n - 1)]!) * out;
      const cw = this.card.offsetWidth || 200;
      const ch = this.card.offsetHeight || 120;
      this.place(this.card, (l.w - cw) / 2 + wob(1), l.h * 0.42 - ch / 2 + wob(1), -2 + wob(1.5), Math.max(0.01, k));
      if (out <= 0) {
        this.card.classList.add("sp-hide");
        this.cardAge = Infinity;
      }
    }
    for (const p of this.pops) {
      const n = Math.round(p.age * 12);
      const k = this.reduced ? 1 : SQUISH[Math.min(SQUISH.length - 1, n)]!;
      const fade = Math.max(0, Math.min(1, (p.life - p.age) / 0.25));
      const w = p.el.offsetWidth || 90;
      this.place(p.el, p.x - w / 2 + wob(1), p.y - 30 - Math.floor(n / 2) * 2 + wob(1), wob(4), k * (0.7 + 0.3 * fade));
      p.el.style.opacity = fade.toFixed(2);
    }
  }

  update(dt: number): void {
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => {
      if (p.age < p.life) return true;
      p.el.remove();
      return false;
    });
  }
}
