/**
 * Clackwood's DOM layer on top of the toybox HUD: the clock chip, the rack chip, the power meter, banners, the
 * first-run tip with its ghost finger, and the game-over card. Same cream pills and Rubik as the rest of lowpolyfox.
 */
import type { Insets } from "@thumbcade/sdk";
import { cubeSvg } from "./toybox/hud.ts";
import { FONT } from "./toybox/fonts.ts";
import { P } from "./toybox/palette.ts";

const CSS = `
.cw{position:fixed;inset:0;pointer-events:none;font-family:${FONT};color:${P.ink};-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}
.cw *{box-sizing:border-box}
.cw-pill{position:absolute;display:flex;align-items:center;gap:7px;background:${P.cream};border-radius:999px;padding:7px 13px;font-weight:500;font-size:14px;line-height:1;white-space:nowrap;box-shadow:0 3px 0 rgba(75,64,96,.13),0 10px 22px rgba(75,64,96,.13);transition:opacity .25s ease,transform .3s cubic-bezier(.3,1.6,.5,1)}
.cw-pill b{font-weight:900}
.cw-off{opacity:0!important;transform:translateY(-8px) scale(.92)!important}
.cw-clock{font-weight:900;font-size:22px;padding:7px 14px 7px 10px;font-variant-numeric:tabular-nums}
.cw-clock.clutch{background:${P.butter}}
.cw-power{flex-direction:column;align-items:stretch;gap:6px;padding:9px 12px 10px;border-radius:18px}
.cw-power .row{display:flex;gap:4px;justify-content:center}
.cw-power i{display:block;width:17px;height:17px;border-radius:4px;background:rgba(75,64,96,.12);box-shadow:inset 0 -3px 0 rgba(75,64,96,.12)}
.cw-power .cap{display:flex;justify-content:space-between;font-size:12px;color:${P.inkSoft}}
.cw-power .cap b{color:${P.ink}}
.cw-banner{position:absolute;left:50%;top:0;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 22px 12px;border-radius:22px;background:${P.cream};box-shadow:0 4px 0 rgba(75,64,96,.14),0 14px 30px rgba(75,64,96,.18);white-space:nowrap;will-change:transform,opacity;opacity:0}
.cw-banner .big{font-weight:900;font-size:32px;line-height:1;letter-spacing:-.01em}
.cw-banner .sub{font-weight:500;font-size:13px;color:${P.inkSoft}}
.cw-tip{flex-direction:column;align-items:center;gap:3px;border-radius:16px;padding:9px 14px;background:rgba(255,247,236,.94);font-size:14px}
.cw-tip span{font-size:12px;color:${P.inkSoft};font-weight:500}
.cw-finger{position:absolute;left:0;top:0;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:rgba(255,247,236,.85);border:2.5px solid rgba(75,64,96,.45);box-shadow:0 4px 10px rgba(75,64,96,.2);opacity:0;transition:opacity .2s}
.cw-card{position:absolute;display:flex;flex-direction:column;gap:9px;padding:14px 16px 15px;border-radius:20px;background:${P.cream};box-shadow:0 4px 0 rgba(75,64,96,.14),0 14px 30px rgba(75,64,96,.18);font-size:13px;font-weight:500;transition:opacity .3s ease,transform .35s cubic-bezier(.3,1.6,.5,1)}
.cw-card .stats{display:flex;justify-content:space-between;gap:10px}
.cw-card .stat{display:flex;flex-direction:column;gap:3px}
.cw-card .stat span{font-size:11px;color:${P.inkSoft}}
.cw-card .stat b{font-size:17px;font-weight:900}
.cw-card .bar{height:9px;border-radius:9px;background:rgba(75,64,96,.12);overflow:hidden}
.cw-card .bar i{display:block;height:100%;width:0;border-radius:9px;background:${P.lilacDeep};transition:width .8s cubic-bezier(.3,1,.4,1) .3s}
.cw-card .line b{font-weight:900}
.cw-card .tip{color:${P.inkSoft};line-height:1.3;white-space:normal}
`;

const POWER_SEG = 10;
const POWER_COLORS = ["#A8E6C1", "#A8E6C1", "#A8E6C1", "#FFE7A1", "#FFE7A1", "#FFE7A1", "#FFCBA6", "#FFCBA6", "#F27C6B", "#F27C6B"];

export interface SummaryInfo {
  score: number;
  best: number | null;
  isBest: boolean;
  prevBest: number | null;
  bestShot: string;
  bestTag: string;
  pots: number;
  racks: number;
  streak: number;
  hint: string;
}

export function createPanel() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.className = "cw";
  document.body.appendChild(root);
  const el = (cls: string, html = "") => {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    root.appendChild(d);
    return d;
  };
  const clock = el("cw-pill cw-clock cw-off", `${cubeSvg({ top: P.sky, left: P.skyDeep, right: "#5FA9CF" }, 20)}<span>0</span>`);
  const clockTxt = clock.querySelector("span")!;
  const rack = el("cw-pill cw-off");
  const power = el("cw-pill cw-power cw-off", `<div class="row">${"<i></i>".repeat(POWER_SEG)}</div><div class="cap"><span>Power</span><b>0%</b></div>`);
  const segs = Array.from(power.querySelectorAll("i"));
  const powerTxt = power.querySelector(".cap b")!;
  const powerCap = power.querySelector(".cap span")!;
  const tip = el("cw-pill cw-tip cw-off");
  const finger = el("cw-finger");
  const card = el("cw-card cw-off");
  const banners = Array.from({ length: 3 }, () => {
    const b = el("cw-banner", `<div class="big"></div><div class="sub"></div>`);
    return { el: b, big: b.querySelector<HTMLDivElement>(".big")!, sub: b.querySelector<HTMLDivElement>(".sub")!, t: 1, life: 1 };
  });
  let bannerNext = 0;
  let W = 390;
  let H = 800;
  let safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let bannerY = 200;
  let shownClock = "";
  let shownPower = -1;
  let shownRack = "";

  return {
    layout(s: Insets, w: number, h: number, tableTop: number) {
      safe = s;
      W = w;
      H = h;
      const right = w - s.right - 14;
      clock.style.left = `${right}px`;
      clock.style.top = `${s.top + 14}px`;
      clock.style.translate = "-100% 0";
      rack.style.left = `${right}px`;
      rack.style.top = `${s.top + 58}px`;
      rack.style.translate = "-100% 0";
      power.style.left = `${w / 2}px`;
      power.style.top = `${h - s.bottom - 72}px`;
      power.style.translate = "-50% 0";
      tip.style.left = `${w / 2}px`;
      tip.style.top = `${h - s.bottom - 132}px`;
      tip.style.translate = "-50% 0";
      bannerY = Math.max(s.top + 112, tableTop + 40);
    },
    showPlay(on: boolean) {
      clock.classList.toggle("cw-off", !on);
      rack.classList.toggle("cw-off", !on);
    },
    setClock(sec: number, clutch: boolean, pulse: number) {
      const t = sec >= 10 ? sec.toFixed(0) : sec.toFixed(1);
      if (t !== shownClock) {
        shownClock = t;
        clockTxt.textContent = t;
      }
      clock.classList.toggle("clutch", clutch && pulse > 0.5);
    },
    bumpClock() {
      clock.animate([{ transform: "scale(1)" }, { transform: "scale(1.16)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(.3,1.6,.5,1)" });
    },
    setRack(n: number, left: number) {
      const s = `Rack <b>${n}</b> · ${left} left`;
      if (s !== shownRack) {
        shownRack = s;
        rack.innerHTML = s;
      }
    },
    /** Shows the meter at `p` (0-1), or hides it with null. `ready` = a release would shoot. */
    setPower(p: number | null, ready = true) {
      if (p === null) {
        power.classList.add("cw-off");
        shownPower = -1;
        return;
      }
      power.classList.remove("cw-off");
      const n = Math.round(p * POWER_SEG);
      const k = Math.round(p * 100);
      if (k === shownPower) return;
      shownPower = k;
      segs.forEach((s, i) => (s.style.background = i < n ? POWER_COLORS[i]! : ""));
      powerTxt.textContent = `${k}%`;
      powerCap.textContent = ready ? "Let go to shoot" : "Pull down for power";
    },
    banner(text: string, sub = "", color: string = P.ink, life = 1.1) {
      const b = banners[bannerNext]!;
      bannerNext = (bannerNext + 1) % banners.length;
      // Only one banner at a time: newer ones replace older ones.
      for (const o of banners) if (o !== b) o.t = Math.max(o.t, 0.999);
      b.big.textContent = text;
      b.big.style.color = color;
      b.sub.textContent = sub;
      b.sub.style.display = sub ? "" : "none";
      b.t = 0;
      b.life = life;
    },
    setTip(text: string | null, sub = "") {
      if (text === null) {
        tip.classList.add("cw-off");
        return;
      }
      tip.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ""}`;
      tip.classList.remove("cw-off");
    },
    finger(x: number, y: number, alpha: number, pressed = false) {
      finger.style.opacity = alpha.toFixed(2);
      finger.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${pressed ? 0.86 : 1})`;
    },
    summary(info: SummaryInfo | null, standalone: boolean, overlay: Insets = safe) {
      if (!info) {
        card.classList.add("cw-off");
        return;
      }
      // In the feed the shell's result card covers the top and its rail and caption come back: stay clear of both.
      const left = overlay.left + 14;
      const right = W - (standalone ? 14 : Math.max(14, overlay.right + 8));
      const h = 176;
      const bottom = H - (standalone ? 40 : overlay.bottom + 10);
      const y0 = standalone ? H * 0.5 : Math.max(H * 0.585, bottom - h);
      card.style.left = `${left}px`;
      card.style.top = `${y0}px`;
      card.style.width = `${right - left}px`;
      const prev = info.prevBest;
      const frac = info.score <= 0 ? 0 : info.isBest ? 1 : prev ? Math.min(1, info.score / prev) : 1;
      const line =
        info.score <= 0
          ? "No pots this time. The first one is the hardest."
          : info.isBest
            ? prev
              ? `New best, <b>+${(info.score - prev).toLocaleString("en-US")}</b> on your old one`
              : "First score on the board"
            : `${Math.round(frac * 100)}% of your best (${(prev ?? 0).toLocaleString("en-US")})`;
      card.innerHTML =
        `<div class="stats"><div class="stat"><span>Best shot${info.bestTag ? ` · ${info.bestTag}` : ""}</span><b>${info.bestShot}</b></div>` +
        `<div class="stat"><span>Pots</span><b>${info.pots}</b></div><div class="stat"><span>Racks</span><b>${info.racks}</b></div>` +
        `<div class="stat"><span>Streak</span><b>${info.streak}</b></div></div>` +
        `<div class="bar"><i></i></div><div class="line">${line}</div><div class="tip">Next time: ${info.hint}</div>` +
        (standalone ? `<div class="line" style="text-align:center;margin-top:2px"><b>${info.score.toLocaleString("en-US")}</b> · Tap to play again</div>` : "");
      card.classList.remove("cw-off");
      const bar = card.querySelector<HTMLElement>(".bar i")!;
      requestAnimationFrame(() => (bar.style.width = `${(frac * 100).toFixed(0)}%`));
    },
    update(dt: number) {
      for (const b of banners) {
        if (b.t >= 1) {
          b.el.style.opacity = "0";
          continue;
        }
        b.t = Math.min(1, b.t + dt / b.life);
        const k = b.t;
        const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.48 : 1.08 - Math.min(0.08, (k - 0.12) * 0.5);
        b.el.style.opacity = String(k > 0.78 ? Math.max(0, 1 - (k - 0.78) / 0.22) : 1);
        b.el.style.transform = `translate(-50%, ${bannerY.toFixed(0)}px) scale(${pop.toFixed(3)})`;
      }
    },
  };
}

export type Panel = ReturnType<typeof createPanel>;
