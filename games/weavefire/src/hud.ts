/**
 * Everything with type on it, drawn with the kit's house fonts on a 2D canvas over the WebGL scene: the title and
 * prompt in attract mode, the run's HUD (score, multiplier, shields, gun level, the Loom's health), score pop-ups,
 * banners, the first-run ghost finger and the game-over summary. Glows here are pre-rendered images, never
 * shadowBlur.
 */
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, Spring } from "@thumbcade-games/kit/ease";
import { rgba } from "@thumbcade-games/kit/color";
import { display, mono } from "@thumbcade-games/kit/fonts";
import type { Photosafe } from "@thumbcade-games/kit/photosafe";
import type { Session } from "@thumbcade-games/kit/session";
import { Counter, drawLabel, drawTapPrompt, drawTitle, roundRect, safeRect } from "@thumbcade-games/kit/ui";
import { CHAIN_HOLD, MAX_LEVEL, MAX_SHIELDS, PAL } from "./consts.ts";
import type { PickupKind, RunStats, Sim } from "./sim.ts";

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
  seconds: number;
}

/** Multiplier colours by tier: paper, then aquamarine, gold, then hot pink at the top. */
export function multColor(m: number): string {
  return m <= 2 ? PAL.paper : m <= 4 ? PAL.accent : m <= 6 ? PAL.crystal : PAL.bullet;
}

const PICKUP_TEXT: Record<PickupKind, string> = { power: PAL.accent, drone: PAL.paper, shield: "#8CB8FF", nova: PAL.bloom };

export class Hud {
  readonly ctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  private readonly popups: Popup[] = [];
  private banners: Banner[] = [];
  private readonly counter = new Counter(0, 12);
  readonly multPop = new Spring(1, 320, 14);
  readonly scorePop = new Spring(1, 300, 16);
  readonly shieldPop = new Spring(1, 280, 12);
  readonly titlePop = new Spring(0, 140, 13);
  private scoreN = -1;
  private scoreS = "0";
  private multGlows: Record<string, HTMLCanvasElement> = {};
  private shade: HTMLCanvasElement | null = null;
  private edge: HTMLCanvasElement | null = null;
  end: EndInfo | null = null;
  private readonly trail = new Float32Array(36);
  private trailHead = 0;
  private trailN = 0;
  /** First-run hint: shown until the player has flown the ship a little. */
  showHint = false;
  hintFade = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly session: Session,
    private readonly light: Photosafe,
  ) {
    this.ctx = canvas.getContext("2d")!;
    for (let i = 0; i < 40; i++) this.popups.push({ on: false, text: "", x: 0, y: 0, t: 0, life: 1, color: PAL.paper, size: 12, big: false });
    for (const c of [PAL.paper, PAL.accent, PAL.crystal, PAL.bullet]) this.multGlows[c] = glowImage(c);
  }

  resize(W: number, H: number, dpr: number): void {
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.edge = null;
  }

  // --- feeds -------------------------------------------------------------------------------------------

  popup(text: string, x: number, y: number, color: string, size = 12, big = false, life = 0.7): void {
    let p = this.popups.find((q) => !q.on);
    if (!p) {
      p = this.popups[0]!;
      for (const q of this.popups) if (q.t / q.life > p.t / p.life) p = q;
    }
    p.on = true;
    p.text = text;
    p.x = x;
    p.y = y;
    p.t = 0;
    p.life = life;
    p.color = color;
    p.size = size;
    p.big = big;
  }

  banner(text: string, sub: string, color: string, big = false, life = 1.6): void {
    this.banners = this.banners.filter((b) => b.big !== big || b.t > b.life);
    this.banners.push({ text, sub, color, t: 0, life, big });
  }

  setScore(v: number, snap = false): void {
    if (snap) this.counter.snap(v);
    else this.counter.set(v);
  }

  clear(): void {
    for (const p of this.popups) p.on = false;
    this.banners = [];
  }

  update(dt: number): void {
    this.counter.update(dt);
    this.multPop.update(dt);
    this.scorePop.update(dt);
    this.shieldPop.update(dt);
    this.titlePop.update(dt);
    for (const p of this.popups) {
      if (!p.on) continue;
      p.t += dt;
      if (p.t >= p.life) p.on = false;
    }
    for (const b of this.banners) b.t += dt;
    if (this.banners.length && this.banners.every((b) => b.t > b.life)) this.banners = [];
    this.hintFade = clamp(this.hintFade + (this.showHint ? dt * 3 : -dt * 4));
  }

  // --- drawing -----------------------------------------------------------------------------------------

  begin(dpr: number): void {
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
  }

  private scoreText(n: number): string {
    if (n !== this.scoreN) {
      this.scoreN = n;
      this.scoreS = n.toLocaleString("en-US");
    }
    return this.scoreS;
  }

  /** Attract mode: title, tagline, best, the tap prompt, and a ghost thumb under the demo ship. */
  drawAttract(time: number, shipX: number, shipY: number, thumbX: number, thumbY: number, touching: boolean): void {
    const g = this.ctx;
    const r = safeRect(this.session.preview(), this.W, this.H);
    const cx = r.x + r.w / 2;
    // Ink shade behind the title so it reads over the action.
    g.drawImage(this.topShade(), 0, 0, this.W, r.y + 150);
    const k = easeOutBack(clamp(this.titlePop.value));
    g.save();
    g.translate(cx, r.y + 50);
    g.scale(k, k);
    drawTitle(g, "WEAVEFIRE", 0, 0, r.w - 10, PAL.paper, 46, rgba(PAL.accent, 0.95));
    g.restore();
    drawLabel(g, "DRAG TO WEAVE · THE GUNS NEVER STOP", cx, r.y + 76, rgba(PAL.paper, 0.82), 11);
    if (this.session.best !== null) drawLabel(g, `BEST ${this.session.best.toLocaleString("en-US")}`, cx, r.y + 97, PAL.accent, 13);
    // The demo's thumb: it shows the verb (relative drag, the ship rides above the thumb).
    this.trackThumb(thumbX, thumbY);
    this.drawThumb(thumbX, thumbY, shipX, shipY, 0.7, touching);
    const py = Math.min(r.y + r.h - 22, this.H * 0.78);
    g.fillStyle = rgba(PAL.ink, 0.7);
    roundRect(g, cx - 100, py - 17, 200, 34, 17);
    g.fill();
    drawTapPrompt(g, cx, py, time, PAL.paper);
  }

  /** Records where the ghost fingertip is this frame (for its trail). */
  trackThumb(x: number, y: number): void {
    const i = (this.trailHead = (this.trailHead + 1) % 18) * 2;
    this.trail[i] = x;
    this.trail[i + 1] = y;
    if (this.trailN < 18) this.trailN++;
  }

  /** The ghost fingertip (house style: a paper disc with an accent trail), tethered to the ship it drives. */
  drawThumb(x: number, y: number, sx: number, sy: number, alpha: number, pressed: boolean): void {
    if (alpha <= 0.01) return;
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    // Tether: the ship rides above the finger.
    g.strokeStyle = rgba(PAL.paper, 0.3);
    g.lineWidth = 1.5;
    g.setLineDash([3, 5]);
    g.beginPath();
    g.moveTo(x, y - 18);
    g.lineTo(sx, sy + 24);
    g.stroke();
    g.setLineDash([]);
    // Trail of the drag.
    if (this.trailN > 2) {
      g.strokeStyle = PAL.accent;
      g.lineCap = "round";
      g.lineJoin = "round";
      for (let k = 1; k < this.trailN; k++) {
        const a = ((this.trailHead - k + 18) % 18) * 2;
        const b = ((this.trailHead - k + 1 + 18) % 18) * 2;
        g.globalAlpha = alpha * 0.75 * (1 - k / this.trailN);
        g.lineWidth = 5 * (1 - k / this.trailN) + 1;
        g.beginPath();
        g.moveTo(this.trail[a]!, this.trail[a + 1]!);
        g.lineTo(this.trail[b]!, this.trail[b + 1]!);
        g.stroke();
      }
      g.globalAlpha = alpha;
    }
    g.fillStyle = rgba(PAL.paper, 0.85);
    g.beginPath();
    g.arc(x, y, pressed ? 15 : 17, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(PAL.ink, 0.5);
    g.lineWidth = 2;
    g.stroke();
    if (pressed) {
      g.strokeStyle = rgba(PAL.accent, 0.6);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 22, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  /** The run's HUD row and everything that floats over the field. */
  drawPlay(sim: Sim, time: number, k: number, ox: number, oy: number, label: (kind: PickupKind) => string): void {
    const g = this.ctx;
    const ins = this.session.play();
    const top = ins.top + 10;
    const W = this.W;
    g.drawImage(this.topShade(), 0, 0, W, top + 78);
    // Low shields: a steady warm edge (never blinking), stronger on the last one.
    const s = sim.ship;
    if (s.alive && s.shields <= 1) {
      g.save();
      g.globalAlpha = 0.35 + 0.15 * this.light.pulse(time, 0.8, { still: 0.5 });
      g.drawImage(this.edgeImage(), 0, 0, W, this.H);
      g.restore();
    }

    // Pickup labels under each pickup.
    for (let i = 0; i < sim.pickups.length; i++) {
      const p = sim.pickups[i]!;
      if (p.t < 0.2) continue;
      const x = p.x * k + ox;
      const y = (p.y + 21) * k + oy;
      drawLabel(g, p.recover ? "GRAB IT BACK" : label(p.kind), x, y, PICKUP_TEXT[p.kind], 9);
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
      const y = p.y - easeOutCubic(u) * (p.big ? 26 : 18);
      g.fillStyle = rgba(PAL.ink, 0.8);
      g.fillText(p.text, p.x + 1.5, y + 1.5);
      g.fillStyle = p.color;
      g.fillText(p.text, p.x, y);
    }
    g.globalAlpha = 1;

    // Score.
    const sc = this.scorePop.value;
    g.save();
    g.translate(W / 2, top + 20);
    g.scale(sc, sc);
    g.font = mono(30);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const txt = this.scoreText(Math.round(this.counter.shown));
    g.fillStyle = rgba(PAL.ink, 0.7);
    g.fillText(txt, 2, 2);
    g.fillStyle = PAL.paper;
    g.fillText(txt, 0, 0);
    g.restore();

    // Shields (top left) and gun level under them.
    const sp = this.shieldPop.value;
    for (let i = 0; i < MAX_SHIELDS; i++) {
      const full = i < s.shields;
      const x = 22 + i * 21;
      const y = top + 14;
      const last = full && s.shields === 1;
      const size = (last ? 7.2 + 1.2 * this.light.pulse(time, 1.6, { still: 0.5 }) : 7) * (i === s.shields ? sp : 1);
      hex(g, x, y, size);
      if (full) {
        g.fillStyle = last ? PAL.warn : PAL.accent;
        g.fill();
      } else {
        g.strokeStyle = rgba(PAL.paper, 0.3);
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    drawLabel(g, "GUN", 14, top + 36, rgba(PAL.paper, 0.6), 9, "left");
    for (let i = 0; i < MAX_LEVEL; i++) {
      g.fillStyle = i < s.level ? PAL.accent : rgba(PAL.paper, 0.16);
      g.fillRect(38 + i * 9, top + 31, 6, 10);
    }
    if (s.drones > 0) drawLabel(g, `+${s.drones} DRONE${s.drones > 1 ? "S" : ""}`, 14, top + 52, rgba(PAL.paper, 0.6), 9, "left");

    // Multiplier (top right) with the chain timer.
    const m = sim.mult;
    const mc = multColor(m);
    const mx = W - 18;
    const my = top + 18;
    const mp = this.multPop.value;
    if (m > 1) {
      g.save();
      g.globalAlpha = 0.35 + 0.1 * m;
      g.drawImage(this.multGlows[mc]!, mx - 46 - 18 * mp, my - 30, 70 + 20 * mp, 60);
      g.restore();
    }
    g.save();
    g.translate(mx, my);
    g.scale(mp, mp);
    g.font = display(m >= 5 ? 28 : 24);
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillStyle = rgba(PAL.ink, 0.75);
    g.fillText(`×${m}`, 2, 2);
    g.fillStyle = mc;
    g.fillText(`×${m}`, 0, 0);
    g.restore();
    const bw = 58;
    const hold = clamp(sim.chainTimer / CHAIN_HOLD);
    g.fillStyle = rgba(PAL.paper, 0.14);
    g.fillRect(mx - bw, my + 18, bw, 3);
    g.fillStyle = mc;
    g.fillRect(mx - bw, my + 18, bw * (sim.chain > 0 ? Math.max(hold, 0.02) : 0), 3);
    g.fillStyle = rgba(mc, 0.55);
    g.fillRect(mx - bw, my + 23, bw * sim.multProgress, 2);
    drawLabel(g, `CHAIN ${Math.floor(sim.chain)}`, mx, my + 34, rgba(PAL.paper, 0.6), 9, "right");

    // The Loom's health.
    const b = sim.boss;
    if (b.phase === "arms" || b.phase === "core" || b.phase === "enter") {
      const w = Math.min(220, W * 0.5);
      const x0 = W / 2 - w / 2;
      const y0 = top + 46;
      const a = b.phase === "enter" ? clamp(b.phaseT / 1.2) : 1;
      g.save();
      g.globalAlpha = a;
      drawLabel(g, b.phase === "arms" ? "THE LOOM · BREAK ITS ARMS" : b.phase === "core" ? "THE LOOM · HIT THE EYE" : "THE LOOM", W / 2, y0, rgba(PAL.paper, 0.85), 9);
      g.fillStyle = rgba(PAL.paper, 0.14);
      g.fillRect(x0, y0 + 9, w, 4);
      g.fillStyle = b.enraged ? PAL.bullet : PAL.loomGold;
      g.fillRect(x0, y0 + 9, w * clamp(b.hpMax > 0 ? b.hp / b.hpMax : 0), 4);
      g.restore();
    }

    // Grazes chaining near the ship.
    if (sim.grazeRun >= 3 && s.alive) {
      drawLabel(g, `GRAZE ×${sim.grazeRun}`, s.x * k + ox, (s.y + 34) * k + oy, PAL.paper, 10);
    }

    // First-run hint: a ghost thumb dragging under the ship.
    if (this.hintFade > 0 && s.alive) {
      const cyc = 2.4;
      const u = (time % cyc) / cyc;
      const dx = Math.sin(u * Math.PI * 2) * 54;
      const sx = s.x * k + ox;
      const sy = s.y * k + oy;
      const ty = Math.min(this.H - 70, sy + 84);
      this.trackThumb(sx + dx, ty);
      this.drawThumb(sx + dx, ty, sx, sy, 0.85 * this.hintFade, true);
      g.save();
      g.globalAlpha = this.hintFade;
      const ly = Math.min(this.H - 40, ty + 56);
      g.fillStyle = rgba(PAL.ink, 0.6);
      roundRect(g, W / 2 - 132, ly - 16, 264, 44, 12);
      g.fill();
      drawLabel(g, "DRAG ANYWHERE TO FLY", W / 2, ly - 2, PAL.paper, 13);
      drawLabel(g, "THE GUNS FIRE ON THEIR OWN", W / 2, ly + 15, rgba(PAL.paper, 0.75), 10);
      g.restore();
    }
    this.drawBanners();
  }

  private drawBanners(): void {
    const g = this.ctx;
    for (const b of this.banners) {
      if (b.t > b.life) continue;
      const u = b.t / b.life;
      const inK = easeOutBack(clamp(b.t / 0.32), 2);
      // A little see-through, so a banner never fully hides a bullet behind it.
      const a = (u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1) * 0.88;
      // Between the enemies' holding band and the ship, never on top of the Loom.
      const y = this.H * (b.big ? 0.4 : 0.42);
      g.save();
      g.globalAlpha = a;
      g.translate(this.W / 2, y);
      g.scale(inK, inK);
      const size = b.big ? 34 : 22;
      drawTitle(g, b.text, 0, 0, this.W - 40, b.color, size, rgba(PAL.ink, 0.85));
      if (b.sub) drawLabel(g, b.sub, 0, b.big ? 24 : 18, PAL.paper, b.big ? 13 : 11);
      g.restore();
    }
  }

  /**
   * Game over: what the run did, how it compares with the best, and one thing to try next. In the feed the shell's
   * result card covers the middle and the caption the bottom, so this is a compact strip just above the caption.
   */
  drawSummary(time: number, tapLabel: string): void {
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
    const h = 122;
    const y0 = solo ? Math.round(this.H * 0.52) : this.H - pv.bottom - h - 8;
    const k = easeOutBack(clamp((t - 0.3) / 0.35), 1.4);
    g.save();
    g.globalAlpha = a;
    g.translate(left + w / 2, y0 + h / 2);
    g.scale(k, k);
    g.translate(-w / 2, -h / 2);
    g.fillStyle = rgba(PAL.ink1, 0.9);
    roundRect(g, 0, 0, w, h, 14);
    g.fill();
    g.fillStyle = PAL.accent;
    g.fillRect(14, 0, w - 28, 2);
    const st = info.stats;
    const cols: Array<[string, string]> = [
      ["BEST CHAIN", `×${st.maxMult}`],
      ["GRAZES", `${st.grazes}`],
      ["THE LOOM", st.bossesKilled > 0 ? `DOWN${st.bossesKilled > 1 ? ` ×${st.bossesKilled}` : ""} ${st.bossFastest.toFixed(1)}S` : st.bossLeft >= 0 ? `${Math.round((1 - st.bossLeft) * 100)}% BROKEN` : "NOT YET"],
    ];
    const cw = (w - 28) / 3;
    cols.forEach(([label, value], i) => {
      const x = 14 + i * cw;
      drawLabel(g, label, x, 18, rgba(PAL.paper, 0.6), 9, "left");
      drawLabel(g, value, x, 35, i === 2 && st.bossesKilled > 0 ? PAL.loomGold : PAL.paper, 13, "left");
    });
    // Progress against the best.
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
      g.fillStyle = info.isBest ? PAL.crystal : PAL.accent;
      roundRect(g, 14, by, Math.max(8, bw * frac * grow), 8, 4);
      g.fill();
    }
    const line = !scored
      ? "NOTHING ON THE BOARD YET"
      : info.isBest
        ? prev
          ? `NEW BEST · +${(info.score - prev).toLocaleString("en-US")} ON YOUR OLD ONE`
          : "FIRST SCORE ON THE BOARD"
        : `${Math.round(frac * 100)}% OF YOUR BEST (${(prev ?? 0).toLocaleString("en-US")})`;
    drawLabel(g, line, 14, by + 22, info.isBest && scored ? PAL.crystal : PAL.paper, 11, "left");
    g.font = mono(11);
    wrap(g, `NEXT TIME: ${info.hint}`, 14, by + 44, bw, rgba(PAL.paper, 0.78));
    g.restore();
    if (solo && t > 0.8) {
      drawTitle(this.ctx, info.score.toLocaleString("en-US"), this.W / 2, this.H * 0.36, this.W - 60, PAL.paper, 52, rgba(PAL.accent, 0.9));
      if (info.isBest && scored) drawLabel(this.ctx, "NEW BEST", this.W / 2, this.H * 0.36 + 26, PAL.crystal, 13);
      g.fillStyle = rgba(PAL.ink, 0.7);
      roundRect(g, this.W / 2 - 112, y0 + h + 22, 224, 34, 17);
      g.fill();
      drawTapPrompt(g, this.W / 2, y0 + h + 39, time, PAL.paper, tapLabel);
    }
  }

  private topShade(): HTMLCanvasElement {
    if (this.shade) return this.shade;
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, rgba(PAL.ink, 0.78));
    gr.addColorStop(0.6, rgba(PAL.ink, 0.4));
    gr.addColorStop(1, rgba(PAL.ink, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, 2, 64);
    this.shade = c;
    return c;
  }

  private edgeImage(): HTMLCanvasElement {
    if (this.edge) return this.edge;
    const c = document.createElement("canvas");
    c.width = 90;
    c.height = 180;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(45, 90, 70, 45, 90, 105);
    gr.addColorStop(0, rgba(PAL.warn, 0));
    gr.addColorStop(1, rgba(PAL.warn, 0.26));
    g.fillStyle = gr;
    g.fillRect(0, 0, 90, 180);
    this.edge = c;
    return c;
  }
}

function hex(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

function glowImage(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.translate(64, 48);
  g.scale(1, 0.7);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  gr.addColorStop(0, rgba(color, 0.55));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(-64, -64, 128, 128);
  return c;
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, color: string): void {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  g.font = mono(11);
  (g as unknown as { letterSpacing: string }).letterSpacing = "0.9px";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxW && line) {
      drawLabel(g, line, x, yy, color, 11, "left");
      line = word;
      yy += 15;
    } else line = next;
  }
  if (line) drawLabel(g, line, x, yy, color, 11, "left");
  (g as unknown as { letterSpacing: string }).letterSpacing = "0px";
}

