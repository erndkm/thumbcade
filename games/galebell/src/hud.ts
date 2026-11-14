/**
 * Everything with type on it, drawn with the kit's house fonts on a 2D canvas over the WebGL table: the title block in
 * attract mode, the run's HUD (ball, score, the storm tier), what the harbour gives, points where they were earned,
 * banners in their own band, the first-run thumbs, the bonus count after each ball and the game-over strip. Glows are
 * pre-rendered images, never shadowBlur.
 */
import { rgba } from "@thumbcade-games/kit/color";
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, Spring } from "@thumbcade-games/kit/ease";
import { display, mono } from "@thumbcade-games/kit/fonts";
import type { Photosafe } from "@thumbcade-games/kit/photosafe";
import type { Session } from "@thumbcade-games/kit/session";
import { Counter, drawLabel, drawTapPrompt, drawTitle, roundRect, safeRect } from "@thumbcade-games/kit/ui";
import { INSERTS, PAL } from "./art.ts";
import { TIERS } from "./copy.ts";
import type { Renderer } from "./render.ts";
import type { Game, HarbourLit, RunStats } from "./rules.ts";

interface Popup {
  on: boolean;
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  color: string;
  size: number;
  big: boolean;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  t: number;
  life: number;
  big: boolean;
}

export interface EndInfo {
  score: number;
  prevBest: number | null;
  isBest: boolean;
  stats: RunStats;
  hint: string;
}

export const HARBOUR_LABEL: Record<HarbourLit, string> = { none: "", lock: "LOCK", multiball: "HIGH TIDE", extra: "EXTRA BALL", super: "SUPER JACKPOT" };

/** Tier colours: paper, sea, lamp, coral, gold. */
export function tierColor(t: number): string {
  return [PAL.paper, PAL.seaHi, PAL.lamp, PAL.coral, PAL.gold][Math.max(0, Math.min(4, t - 1))]!;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export class Hud {
  readonly ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  private readonly popups: Popup[] = [];
  private banners: Banner[] = [];
  private readonly counter = new Counter(0, 12);
  readonly scorePop = new Spring(1, 300, 16);
  readonly tierPop = new Spring(1, 320, 14);
  readonly titlePop = new Spring(0, 140, 13);
  private shade: HTMLCanvasElement | null = null;
  private scoreN = -1;
  private scoreS = "0";
  end: EndInfo | null = null;
  /** First-run teaching, 0-1 (fades). */
  hint = 0;
  showHint = false;
  /** Idle nudge strength 0-1. */
  nudge = 0;
  combo: { n: number; name: string; pts: number; t: number } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly session: Session,
    private readonly light: Photosafe,
  ) {
    this.ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 32; i++) this.popups.push({ on: false, text: "", x: 0, y: 0, t: 0, life: 1, color: PAL.paper, size: 12, big: false });
  }

  resize(W: number, H: number, dpr: number): void {
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
  }

  popup(text: string, x: number, y: number, color: string, size = 12, big = false, life = 0.8): void {
    let p = this.popups.find((q) => !q.on);
    if (!p) {
      p = this.popups[0]!;
      for (const q of this.popups) if (q.t / q.life > p.t / p.life) p = q;
    }
    // Keep it on screen and out of the top HUD row.
    const top = this.session.play().top + 70;
    Object.assign(p, { on: true, text, x: clamp(x, 40, this.W - 40), y: Math.max(top, y), t: 0, life, color, size, big });
  }

  /**
   * One banner at a time, in one band. A big one (tier, high tide, jackpot, extra ball) takes the slot at once; a
   * small one replaces a small one, but waits for a big one to finish (at most two wait; the oldest is dropped).
   */
  banner(text: string, sub: string, color: string, big = false, life = 1.6): void {
    const b: Banner = { text, sub, color, t: 0, life, big };
    const cur = this.banners[0];
    const showing = cur && cur.t < cur.life;
    if (!showing || big || !cur.big) {
      this.banners = [b];
      return;
    }
    this.queue.push(b);
    if (this.queue.length > 2) this.queue.shift();
  }

  private queue: Banner[] = [];

  setScore(v: number, snap = false): void {
    if (snap) this.counter.snap(v);
    else this.counter.set(v);
  }

  clear(): void {
    for (const p of this.popups) p.on = false;
    this.banners = [];
    this.queue = [];
    this.combo = null;
  }

  update(dt: number): void {
    this.counter.update(dt);
    this.scorePop.update(dt);
    this.tierPop.update(dt);
    this.titlePop.update(dt);
    for (const p of this.popups) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life) p.on = false;
    }
    for (const b of this.banners) b.t += dt;
    if (this.banners.length && this.banners.every((b) => b.t > b.life)) this.banners = [];
    if (!this.banners.length && this.queue.length) this.banners = [this.queue.shift()!];
    if (this.combo) {
      this.combo.t += dt;
      if (this.combo.t > 1.4) this.combo = null;
    }
    this.hint = clamp(this.hint + (this.showHint ? dt * 3 : -dt * 3));
  }

  begin(dpr: number): void {
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
  }

  private scoreText(n: number): string {
    if (n !== this.scoreN) {
      this.scoreN = n;
      this.scoreS = fmt(n);
    }
    return this.scoreS;
  }

  private topShade(): HTMLCanvasElement {
    if (this.shade) return this.shade;
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, rgba(PAL.ink, 0.86));
    gr.addColorStop(0.6, rgba(PAL.ink, 0.5));
    gr.addColorStop(1, rgba(PAL.ink, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 2, 64);
    this.shade = c;
    return c;
  }

  // --- attract ---------------------------------------------------------------------------------------------------

  drawAttract(time: number): void {
    const g = this.ctx;
    const r = safeRect(this.session.preview(), this.W, this.H);
    const cx = r.x + r.w / 2;
    g.drawImage(this.topShade(), 0, 0, this.W, r.y + 150);
    const k = easeOutBack(clamp(this.titlePop.value));
    g.save();
    g.translate(cx, r.y + 46);
    g.scale(k, k);
    drawTitle(g, "GALEBELL", 0, 0, r.w - 8, PAL.paper, 46, rgba(PAL.accent, 0.95));
    g.restore();
    drawLabel(g, "HOLD A SIDE TO FLIP · BOTH THUMBS", cx, r.y + 72, rgba(PAL.paper, 0.85), 11);
    if (this.session.best !== null) drawLabel(g, `BEST ${fmt(this.session.best)}`, cx, r.y + 93, PAL.lamp, 13);
    const py = Math.min(r.y + r.h - 24, this.H * 0.7);
    g.fillStyle = rgba(PAL.ink, 0.78);
    roundRect(g, cx - 100, py - 17, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, py, time, PAL.paper);
  }

  // --- play --------------------------------------------------------------------------------------------------------

  drawPlay(gm: Game, rend: Renderer, time: number, pressed: [boolean, boolean]): void {
    const g = this.ctx;
    const W = this.W;
    const top = this.session.play().top + 8;
    g.drawImage(this.topShade(), 0, 0, W, top + 64);

    // Ball and the balls left (pips), left.
    drawLabel(g, gm.ballNo > 3 ? "EXTRA BALL" : `BALL ${Math.min(gm.ballNo, 3)}`, 16, top + 12, rgba(PAL.paper, 0.8), 10, "left");
    const total = gm.ballsTotal;
    for (let i = 0; i < Math.min(5, total); i++) {
      const x = 21 + i * 13;
      const y = top + 29;
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      const used = i < gm.ballNo - 1;
      const current = i === gm.ballNo - 1;
      if (!used) {
        g.fillStyle = i >= 3 ? PAL.gold : current ? PAL.paper : rgba(PAL.paper, 0.55);
        g.fill();
      } else {
        g.strokeStyle = rgba(PAL.paper, 0.28);
        g.lineWidth = 1.2;
        g.stroke();
      }
    }

    // Score.
    const sc = this.scorePop.value;
    g.save();
    g.translate(W / 2, top + 18);
    g.scale(sc, sc);
    g.font = mono(28);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const txt = this.scoreText(Math.round(this.counter.shown));
    g.fillStyle = rgba(PAL.ink, 0.75);
    g.fillText(txt, 2, 2);
    g.fillStyle = PAL.paper;
    g.fillText(txt, 0, 0);
    g.restore();

    // The storm tier, right: ×n, its name, and the charge toward the next.
    const tc = tierColor(gm.tier);
    const mx = W - 16;
    g.save();
    g.translate(mx, top + 14);
    const tp = this.tierPop.value;
    g.scale(tp, tp);
    g.font = display(22);
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillStyle = rgba(PAL.ink, 0.8);
    g.fillText(`×${gm.tier}`, 2, 2);
    g.fillStyle = tc;
    g.fillText(`×${gm.tier}`, 0, 0);
    g.restore();
    drawLabel(g, TIERS[gm.tier - 1]!.name, mx, top + 33, rgba(PAL.paper, 0.75), 9, "right");
    const need = gm.needed;
    if (need > 0) {
      const bw = 54;
      const seg = bw / need;
      for (let i = 0; i < need; i++) {
        g.fillStyle = i < gm.charge ? tc : rgba(PAL.paper, 0.16);
        g.fillRect(mx - bw + i * seg + 0.5, top + 42, seg - 1.5, 3);
      }
    }

    // What the harbour gives, on a plate under its arrow.
    const lit = gm.harbourLit;
    if (lit !== "none" && this.session.phase === "playing") {
      const hx = rend.sx(INSERTS.harbour.x);
      const hy = rend.sy(INSERTS.harbour.y) + 15;
      const label = HARBOUR_LABEL[lit];
      g.font = mono(9);
      const w = g.measureText(label).width + 14;
      g.fillStyle = rgba(PAL.ink, 0.78);
      roundRect(g, hx - w / 2, hy - 7, w, 14, 7);
      g.fill();
      drawLabel(g, label, hx, hy, PAL.lamp, 9);
    }
    // Jackpot labels on the orbit arrows during the high tide.
    if (gm.multiball) {
      for (const ins of [INSERTS.orbitL, INSERTS.orbitR]) {
        const a = 0.6 + 0.4 * this.light.pulse(time, 2, { still: 1 });
        g.globalAlpha = a;
        drawLabel(g, "JACKPOT", rend.sx(ins.x + (ins.x < 169 ? 7 : -9)), rend.sy(ins.y) - 16, PAL.lamp, 9);
        g.globalAlpha = 1;
      }
    }

    // The cradle limit: a ring fills round a held ball.
    for (let i = 0; i < 2; i++) {
      const p = gm.holdProgress(i);
      if (p < 0.35) continue;
      const b = gm.world.balls.find((q) => q.live && Math.hypot(q.vx, q.vy) < 40);
      if (!b) continue;
      const x = rend.sx(b.x);
      const y = rend.sy(b.y);
      const rr = 8 * rend.k + 5;
      g.strokeStyle = rgba(PAL.paper, 0.25);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = p > 0.8 ? PAL.coral : PAL.lamp;
      g.beginPath();
      g.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((p - 0.35) / 0.65));
      g.stroke();
    }

    // Pop-ups.
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const p of this.popups) {
      if (!p.on) continue;
      const u = p.t / p.life;
      const pop = u < 0.15 ? 0.65 + (u / 0.15) * 0.45 : 1.1 - Math.min(0.1, (u - 0.15) * 0.3);
      g.globalAlpha = u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1;
      const size = Math.round(p.size * pop);
      g.font = p.big ? display(size) : mono(size);
      const y = p.y - easeOutCubic(u) * (p.big ? 22 : 16);
      g.fillStyle = rgba(PAL.ink, 0.85);
      g.fillText(p.text, p.x + 1.5, y + 1.5);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, y);
    }
    g.globalAlpha = 1;

    // The plunger waits.
    if (gm.laneBall && gm.phase !== "bonus") {
      const b = gm.laneBall;
      if (b.y > gm.def.plunger.y - 6) {
        const x = rend.sx(337);
        const y = rend.sy(560);
        g.globalAlpha = 0.6 + 0.4 * this.light.pulse(time, 1.5, { still: 1 });
        g.fillStyle = PAL.lamp;
        // A chevron pointing up the lane.
        for (let i = 0; i < 3; i++) {
          const yy = y - i * 9;
          g.beginPath();
          g.moveTo(x - 5, yy + 3);
          g.lineTo(x, yy - 2);
          g.lineTo(x + 5, yy + 3);
          g.lineWidth = 2;
          g.strokeStyle = PAL.lamp;
          g.stroke();
        }
        g.globalAlpha = 1;
        const cy = rend.sy(470);
        g.fillStyle = rgba(PAL.ink, 0.8);
        roundRect(g, W / 2 - 96, cy - 15, 192, 30, 15);
        g.fill();
        drawTapPrompt(g, W / 2, cy, time, PAL.paper, "TAP TO LAUNCH", 13);
      }
    }

    // Lifeboat seconds, by the boat.
    if (gm.lifeboatOn && gm.phase === "play" && gm.ballT >= 0) {
      drawLabel(g, `${Math.ceil(gm.saveLeft)}`, rend.sx(INSERTS.lifeboat.x + 16), rend.sy(INSERTS.lifeboat.y - 2), PAL.kelp, 10);
    }

    // First-run thumbs, or an idle nudge (only while a ball is in play).
    const live = this.session.phase === "playing" && gm.phase !== "over";
    const ta = live ? Math.max(this.hint, this.nudge * 0.6) : 0;
    if (ta > 0.01) this.drawThumbs(time, ta, pressed, this.hint > 0.01, rend);

    // Combo callout under the banner band.
    if (this.combo) {
      const c = this.combo;
      const u = c.t / 1.4;
      const k = easeOutBack(clamp(c.t / 0.25), 2);
      g.save();
      g.globalAlpha = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      g.translate(W / 2, this.bandY() + 52);
      g.scale(k, k);
      g.font = mono(12);
      const line = `${c.name} ×${c.n} · +${fmt(c.pts)}`;
      const w = g.measureText(line).width + 26;
      g.fillStyle = rgba(PAL.ink, 0.82);
      roundRect(g, -w / 2, -12, w, 24, 12);
      g.fill();
      drawLabel(g, line, 0, 0, PAL.lampHi, 12);
      g.restore();
    }

    this.drawBanners();

    // The count after each ball.
    if (gm.phase === "bonus") this.drawBonus(gm);
  }

  /** The banner band: over the buoys, in the upper table, so a callout never covers the flippers. */
  bandY(): number {
    return Math.max(this.session.play().top + 96, this.bandAt);
  }

  /** Where the band sits on screen (set from the table's layout). */
  bandAt = 200;

  /** Ghost thumbs beside the flippers (on the cabinet, outside the inlane guides), with what to do. */
  private drawThumbs(time: number, a: number, pressed: [boolean, boolean], teach: boolean, rend: Renderer): void {
    const g = this.ctx;
    // On the cabinet beside each flipper: left of the left pivot, between the right pivot and the shooter lane.
    const y = Math.min(this.H - 30, rend.sy(614));
    for (let side = 0; side < 2; side++) {
      const x = side ? rend.sx(290) : rend.sx(46);
      const down = pressed[side]!;
      const breathe = this.light.pulse(time + side * 0.4, 1.1, { still: 0.5 });
      g.save();
      g.globalAlpha = a * (down ? 0.45 : 0.75 + 0.25 * breathe);
      g.fillStyle = rgba(PAL.paper, 0.85);
      g.beginPath();
      g.arc(x, y, down ? 12 : 14, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(PAL.lamp, 0.8);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 18 + 3 * breathe, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      if (teach) {
        g.save();
        g.globalAlpha = a;
        g.fillStyle = rgba(PAL.ink, 0.78);
        const ly = rend.sy(584);
        g.font = mono(10);
        const label = side ? "HOLD RIGHT" : "HOLD LEFT";
        const w = g.measureText(label).width + 16;
        const lx = clamp(x, w / 2 + 4, this.W - w / 2 - 4);
        roundRect(g, lx - w / 2, ly - 10, w, 20, 10);
        g.fill();
        drawLabel(g, label, lx, ly, PAL.paper, 10);
        g.restore();
      }
    }
  }

  private drawBanners(): void {
    const g = this.ctx;
    for (const b of this.banners) {
      if (b.t > b.life) continue;
      const u = b.t / b.life;
      const inK = easeOutBack(clamp(b.t / 0.3), 2);
      const a = u > 0.78 ? 1 - (u - 0.78) / 0.22 : 1;
      const y = this.bandY() + (b.big ? -6 : 0);
      g.save();
      g.globalAlpha = a;
      g.translate(this.W / 2, y);
      g.scale(inK, inK);
      const size = b.big ? 32 : 22;
      // The plate fits the wider of the two lines (the title shrinks to fit the screen, the line doesn't).
      g.font = display(size);
      const titleW = Math.min(this.W - 50, g.measureText(b.text).width);
      g.font = mono(b.big ? 12 : 10);
      (g as unknown as { letterSpacing: string }).letterSpacing = `${(b.big ? 12 : 10) * 0.08}px`;
      const subW = b.sub ? g.measureText(b.sub.toUpperCase()).width : 0;
      (g as unknown as { letterSpacing: string }).letterSpacing = "0px";
      const tw = Math.min(this.W - 16, Math.max(titleW, subW) + 36);
      g.fillStyle = rgba(PAL.ink, 0.82);
      roundRect(g, -tw / 2, -size * 0.95, tw, size * 1.2 + (b.sub ? 22 : 6), 12);
      g.fill();
      drawTitle(g, b.text, 0, 0, this.W - 50, b.color, size, rgba(PAL.ink, 0.9));
      if (b.sub) drawLabel(g, b.sub, 0, b.big ? 17 : 14, PAL.paper, b.big ? 12 : 10);
      g.restore();
    }
  }

  private drawBonus(gm: Game): void {
    const g = this.ctx;
    const t = gm.bonusT;
    const a = clamp(t / 0.15) * (t > 1.1 ? 1 - (t - 1.1) / 0.2 : 1);
    if (a <= 0) return;
    const y = this.bandY();
    g.save();
    g.globalAlpha = a;
    g.fillStyle = rgba(PAL.ink, 0.88);
    roundRect(g, this.W / 2 - 120, y - 40, 240, 80, 14);
    g.fill();
    g.fillStyle = PAL.lamp;
    g.fillRect(this.W / 2 - 104, y - 40, 208, 2);
    drawLabel(g, `BALL ${Math.min(3, gm.ballNo)} BONUS`, this.W / 2, y - 22, rgba(PAL.paper, 0.75), 10);
    const shown = Math.round(gm.bonusValue * easeOutCubic(clamp(t / 0.7)));
    g.font = mono(24);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = PAL.paper;
    g.fillText(fmt(shown), this.W / 2, y);
    const next = gm.ballNo >= gm.ballsTotal ? "THAT WAS THE LAST BALL" : gm.ballNo + 1 === gm.ballsTotal ? "LAST BALL NEXT" : `BALL ${gm.ballNo + 1} NEXT`;
    drawLabel(g, `×${gm.tier} ${TIERS[gm.tier - 1]!.name} · ${next}`, this.W / 2, y + 23, tierColor(gm.tier), 10);
    g.restore();
  }

  /**
   * Game over: what the run did, how it compares with the best, and one thing to try next. In the feed the shell's
   * result card covers the middle and the caption the bottom, so this is a compact strip just above the caption.
   */
  drawSummary(time: number): void {
    const info = this.end;
    if (!info) return;
    const t = this.session.phaseTime;
    const a = clamp((t - 0.3) / 0.3);
    if (a <= 0) return;
    const g = this.ctx;
    const solo = this.session.standalone;
    const pv = this.session.preview();
    const left = solo ? 16 : pv.left + 12;
    const right = this.W - (solo ? 16 : pv.right + 8);
    const w = right - left;
    const st = info.stats;
    g.font = mono(11);
    const lines = wrapLines(g, `NEXT TIME: ${info.hint}`, w - 28);
    const h = 108 + lines.length * 15;
    const y0 = solo ? Math.round(this.H * 0.5) : this.H - pv.bottom - h - 8;
    const k = easeOutBack(clamp((t - 0.3) / 0.35), 1.4);
    g.save();
    g.globalAlpha = a;
    g.translate(left + w / 2, y0 + h / 2);
    g.scale(k, k);
    g.translate(-w / 2, -h / 2);
    g.fillStyle = rgba(PAL.ink1, 0.92);
    roundRect(g, 0, 0, w, h, 14);
    g.fill();
    g.fillStyle = PAL.accent;
    g.fillRect(14, 0, w - 28, 2);
    const cols: Array<[string, string, string]> = [
      ["STORM", TIERS[st.tier - 1]!.name, tierColor(st.tier)],
      ["BEST COMBO", st.maxCombo >= 2 ? `×${st.maxCombo}` : "-", PAL.paper],
      [st.multiballs > 0 ? "JACKPOTS" : "MOORED", st.multiballs > 0 ? `${st.jackpots + st.supers}` : `${st.locks}`, PAL.paper],
    ];
    const cw = (w - 28) / 3;
    cols.forEach(([label, value, color], i) => {
      const x = 14 + i * cw;
      drawLabel(g, label, x, 18, rgba(PAL.paper, 0.6), 9, "left");
      drawLabel(g, value, x, 35, color, 13, "left");
    });
    const bw = w - 28;
    const by = 54;
    g.fillStyle = rgba(PAL.paper, 0.12);
    roundRect(g, 14, by, bw, 8, 4);
    g.fill();
    const prev = info.prevBest;
    const scored = info.score > 0;
    const frac = !scored ? 0 : info.isBest || !prev ? 1 : clamp(info.score / prev);
    const grow = easeInOutCubic(clamp((t - 0.45) / 0.7));
    if (frac > 0) {
      g.fillStyle = info.isBest ? PAL.gold : PAL.lamp;
      roundRect(g, 14, by, Math.max(8, bw * frac * grow), 8, 4);
      g.fill();
    }
    const line = !scored
      ? "NOTHING ON THE BOARD YET"
      : info.isBest
        ? prev
          ? `NEW BEST · +${fmt(info.score - prev)} ON YOUR OLD ONE`
          : "FIRST SCORE ON THE BOARD"
        : `${Math.round(frac * 100)}% OF YOUR BEST (${fmt(prev ?? 0)})`;
    drawLabel(g, line, 14, by + 22, info.isBest && scored ? PAL.gold : PAL.paper, 11, "left");
    lines.forEach((l, i) => drawLabel(g, l, 14, by + 44 + i * 15, rgba(PAL.paper, 0.8), 11, "left"));
    g.restore();
    if (solo && t > 0.8) {
      drawTitle(g, fmt(info.score), this.W / 2, this.H * 0.34, this.W - 60, PAL.paper, 52, rgba(PAL.accent, 0.9));
      if (info.isBest && scored) drawLabel(g, "NEW BEST", this.W / 2, this.H * 0.34 + 26, PAL.gold, 13);
      g.fillStyle = rgba(PAL.ink, 0.78);
      roundRect(g, this.W / 2 - 112, y0 + h + 18, 224, 34, 17);
      g.fill();
      drawTapPrompt(g, this.W / 2, y0 + h + 35, time, PAL.paper, "TAP TO PLAY AGAIN");
    }
  }
}

/** Splits text into lines that fit `maxW` in the current font (with the label's letter spacing). */
export function wrapLines(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  (g as unknown as { letterSpacing: string }).letterSpacing = "0.9px";
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  (g as unknown as { letterSpacing: string }).letterSpacing = "0px";
  return out;
}
