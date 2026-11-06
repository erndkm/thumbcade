import {
  clamp,
  Counter,
  createAudio,
  createCanvas,
  createRng,
  createSession,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  FONT_DISPLAY,
  FONT_MONO,
  HitStop,
  lerp,
  loadFonts,
  midiToFreq,
  mix,
  Particles,
  PENTATONIC,
  Photosafe,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BAND, CARD_ASPECT, CardSprites, PAL } from "./art.ts";
import { playGeometry } from "./layout.ts";
import { RANK_NAME, rankOf } from "./cards.ts";
import { Dealer, DRAW, exposed, plan, plays, type Deal, type Pos } from "./deal.ts";
import { Pilot, SKILLS } from "./pilot.ts";
import { multOf, Run, tierOf, TIERS, TUNE, type RunListener } from "./run.ts";

// ---------------------------------------------------------------------------
// Sounds: wood and paper, no chimes that sound like a machine paying out.
// ---------------------------------------------------------------------------
const THOCK: SfxParams = { wave: "sine", freq: 210, freqEnd: 88, duration: 0.09, volume: 0.5, punch: 2.4 };
const SLAP: SfxParams = { wave: "noise", freq: 2600, freqEnd: 900, duration: 0.05, volume: 0.22, highpass: 700, punch: 2 };
const FLIP: SfxParams = { wave: "noise", freq: 1800, freqEnd: 4200, attack: 0.01, duration: 0.08, volume: 0.15, highpass: 900 };
const NOPE: SfxParams = { wave: "triangle", freq: 240, freqEnd: 190, duration: 0.08, volume: 0.16 };
const PRESS: SfxParams = { wave: "square", freq: 2200, duration: 0.012, volume: 0.05, highpass: 1200 };

/** First-run hint text, and how many plays (ever) keep the playable cards lit. */
const TEACH_PLAYS = 12;
/** Seconds without input before the hints come back. */
const IDLE_HINT = 2.6;
/** Flight times (s). */
const FLY = 0.17;
const FLY_DRAW = 0.2;

interface Slot {
  x: number;
  y: number;
  w: number;
}

interface Layout {
  cw: number;
  band: number;
  colX: number[];
  top: number;
  pile: Slot;
  stock: Slot;
  /** Where the streak label sits. */
  meter: { x: number; y: number };
}

interface Flight {
  card: number;
  from: Slot & { a: number };
  t: number;
  dur: number;
  angle: number;
  dx: number;
  dy: number;
  /** Visual only (a stock card counted off as a bonus after a clear). */
  bonus: boolean;
  onLand?: () => void;
}

interface PileCard {
  card: number;
  angle: number;
  dx: number;
  dy: number;
  t: number;
}

interface Fly {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  color: string;
  size: number;
  onLand?: () => void;
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  t: number;
  life: number;
}

interface Falling {
  card: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  w: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "laddersnap" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const reduced = session.reducedMotion;
  const fxRng = createRng(session.ctx.seed ^ 0x1add3);
  const shake = new Shake(10, 0.02, 1.8, reduced);
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2, decay: 0.4 });
  const hitStop = new HitStop();
  const fx = new Particles(700);
  const sprites = new CardSprites(view.dpr);
  const layoutT = new Spring(0, 170, 24);
  const scoreShown = new Counter(0, 14);

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
    sprites.setDpr(view.dpr);
  });

  // Player memory: the first-run finger, and how many plays the lit-card hint has left.
  let taught = false;
  let lifetimePlays = 0;
  try {
    taught = (await tc.storage.get<boolean>("taught")) === true;
    lifetimePlays = (await tc.storage.get<number>("plays")) ?? 0;
  } catch {
    /* guest or offline: teach again */
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let time = 0;
  let mode: "attract" | "play" = "attract";
  let dealer = new Dealer(createRng(session.ctx.dailySeed ^ 0x5eed));
  let run: Run;
  const pilot = new Pilot({ ...SKILLS.skilled, think: [0.42, 0.62], miss: 0 }, createRng(session.ctx.dailySeed ^ 0x9117));
  let flights: Flight[] = [];
  let pile: PileCard[] = [];
  let flies: Fly[] = [];
  let banners: Banner[] = [];
  let falling: Falling[] = [];
  /** When each tableau card (col * 8 + depth) arrives on the table. */
  const born = new Map<number, number>();
  /** Spring per column for the "you can play this" lift. */
  const lift = Array.from({ length: 8 }, () => new Spring(0, 260, 20));
  const nope = new Float32Array(8).fill(-10);
  let stockNope = -10;
  let shownStock = 0;
  let nextFlip = -10;
  let clockShown: number = TUNE.start;
  let clockBump = 0;
  let scoreBump = 0;
  let tierAt = -10;
  let lastInput = 0;
  let lastTick = 0;
  let pressed: { target: number; x: number; y: number; t: number } | null = null;
  let over: { t: number; isBest: boolean; ended: boolean } | null = null;
  let summary: string[] = [];
  let firstPlayDone = false;
  let hintFor: { pos: Pos; move: number | null } | null = null;
  let titleIn = 0;

  const STOCK = -2;

  /** Effects that land a beat later run on game time, so a pause holds them too (never setTimeout). */
  let later: Array<{ at: number; fn: () => void }> = [];
  const schedule = (secs: number, fn: () => void) => later.push({ at: time + secs, fn });

  // ---------------------------------------------------------------------------
  // Layout: attract (inside the preview safe area) ↔ play (full width)
  // ---------------------------------------------------------------------------
  const cols = () => run.deal.shape.cols;
  const maxDepth = 4;

  function attractLayout(): Layout {
    const r = safeRect(session.preview(), W, H, 16);
    const n = cols();
    const gap = 6;
    const cw = Math.min(54, (r.w - gap * (n - 1)) / n);
    const band = cw * CARD_ASPECT * BAND;
    const rowW = n * cw + (n - 1) * gap;
    const x0 = r.x + (r.w - rowW) / 2 + cw / 2;
    const top = r.y + 104;
    const pileY = Math.min(r.y + r.h - 96, top + (maxDepth - 1) * band + cw * CARD_ASPECT + 70);
    const pw = cw * 1.16;
    return {
      cw,
      band,
      colX: Array.from({ length: n }, (_, i) => x0 + i * (cw + gap)),
      top,
      pile: { x: r.x + r.w * 0.5, y: pileY, w: pw },
      stock: { x: r.x + r.w * 0.5 + pw * 1.55, y: pileY, w: cw },
      meter: { x: r.x + r.w * 0.5 - pw * 1.55, y: pileY },
    };
  }

  function playLayout(): Layout {
    const g = playGeometry(W, H, session.play().top, cols(), run.deal.shape.depth);
    return { cw: g.cw, band: g.band, colX: g.colX, top: g.top, pile: g.pile, stock: g.stock, meter: g.meter };
  }

  function layout(): Layout {
    const a = attractLayout();
    const p = playLayout();
    const k = clamp(layoutT.value, 0, 1.04);
    const L = (x: number, y: number) => lerp(x, y, k);
    const slot = (s: Slot, q: Slot): Slot => ({ x: L(s.x, q.x), y: L(s.y, q.y), w: L(s.w, q.w) });
    return {
      cw: L(a.cw, p.cw),
      band: L(a.band, p.band),
      colX: a.colX.map((x, i) => L(x, p.colX[i]!)),
      top: L(a.top, p.top),
      pile: slot(a.pile, p.pile),
      stock: slot(a.stock, p.stock),
      meter: { x: L(a.meter.x, p.meter.x), y: L(a.meter.y, p.meter.y) },
    };
  }
  let Lay: Layout;

  const cardY = (d: number) => Lay.top + d * Lay.band + (Lay.cw * CARD_ASPECT) / 2;

  // ---------------------------------------------------------------------------
  // The run, and what each rule event looks and sounds like
  // ---------------------------------------------------------------------------
  const player = () => mode === "play";

  function noteFor(streak: number): number {
    const i = Math.min(PENTATONIC.length - 1, Math.max(0, streak - 1));
    return midiToFreq(60 + PENTATONIC[i]!);
  }

  function popAt(text: string, x: number, y: number, to: { x: number; y: number }, color: string, size: number, onLand?: () => void) {
    flies.push({ text, x0: x, y0: y, x1: to.x, y1: to.y, t: reduced ? 0.3 : 0, dur: reduced ? 0.55 : 0.62, color, size, onLand });
  }
  const scoreAt = () => ({ x: W / 2, y: session.play().top + 34 });
  const clockAt = () => ({ x: 24 + (W - 48) * clamp(run.clock / TUNE.max), y: session.play().top + 66 });

  function addScore(points: number, x: number, y: number, color: string = PAL.paper, size = 22) {
    if (!player()) return;
    popAt(`+${points}`, x, y, scoreAt(), color, size, () => {
      // Never past the real score: the counter is snapped to it when the run ends.
      scoreShown.set(Math.min(run.score, scoreShown.target + points));
      scoreBump = 1;
    });
  }

  function addTime(secs: number, x: number, y: number) {
    if (!player()) return;
    popAt(`+${secs.toFixed(secs % 1 ? 1 : 0)}S`, x, y, clockAt(), PAL.accentHot, 16, () => (clockBump = 1));
  }

  const listener: RunListener = {
    deal(hand, d) {
      pile = [];
      flights = flights.filter((f) => !f.bonus);
      falling = [];
      for (let c = 0; c < d.shape.cols; c++)
        for (let k = 0; k < d.shape.depth; k++) born.set(c * 8 + k, time + (reduced ? 0 : 0.035 * (k * d.shape.cols + c)));
      shownStock = d.stock.length;
      nextFlip = time + 0.45;
      // The opening card slides off the stock onto the pile.
      launch(d.pile, { ...layout().stock, a: 0 }, 0.24, false, () => audio.play(FLIP, { volume: 0.7 }));
      if (hand > 0 && player()) banners.push({ text: `HAND ${hand + 1}`, sub: hand >= 3 ? "THE CLOCK RUNS FASTER" : "", color: PAL.paper, t: 0, life: 0.9 });
      audio.play("whoosh", { volume: 0.5 });
    },
    play(col, card, streak, points, tierUp) {
      const L = layout();
      const depth = run.pos.heights[col]!;
      const from = { x: L.colX[col]!, y: cardY(depth) - lift[col]!.value * 6, w: L.cw, a: 0 };
      launch(card, from, FLY, false, () => {
        audio.play(THOCK, { pitch: fxRng.range(-1, 1), volume: player() ? 1 : 0.6 });
        audio.play(SLAP, { volume: 0.6 });
        audio.note(noteFor(streak), 0.14, "triangle", 0.2 + Math.min(0.1, streak * 0.01));
        const tier = tierOf(streak);
        const colors = tier >= 2 ? [PAL.accent, PAL.accentHot, PAL.paper] : [PAL.paper, PAL.accent];
        fx.emit(L.pile.x, L.pile.y, { count: 6 + tier * 4, speed: [60, 180 + tier * 50], life: [0.25, 0.5], size: [2, 4 + tier], colors, drag: 3, spread: L.pile.w * 0.4 });
        shake.add(0.04 + tier * 0.015);
        addScore(points, L.pile.x + L.pile.w * 0.7, L.pile.y - L.pile.w * 0.6, tier >= 2 ? PAL.accentHot : PAL.paper, 20 + tier * 2);
        if (tierUp && streak > 1) {
          tierAt = time;
          audio.play("powerup", { pitch: tier * 2, volume: 0.6 });
          fx.emit(L.meter.x, L.meter.y, { count: 18, speed: [80, 260], life: [0.4, 0.8], size: [2, 5], colors: [PAL.accent, PAL.accentHot, PAL.paper], drag: 2.5, shape: "spark" });
          shake.add(0.12);
          session.feedback("tap");
        }
      });
      if (player()) {
        if (!firstPlayDone) {
          firstPlayDone = true;
          if (!taught) {
            taught = true;
            tc.storage.set("taught", true).catch(() => undefined);
            tc.analytics.track("tutorial_complete");
          }
        }
        lifetimePlays++;
      }
    },
    draw(card) {
      const L = layout();
      shownStock = run.stock;
      launch(card, { ...L.stock, a: 0 }, FLY_DRAW, false, () => {
        audio.play(THOCK, { pitch: -3, volume: 0.6 });
      });
      audio.play(FLIP);
      // The new top of the stock turns over a beat later, and the last few take longer: will it go?
      const last = run.stock <= 2;
      nextFlip = time + (last && !reduced ? 0.32 : 0.12);
      if (last && run.next !== null) schedule(0.24, () => audio.play("tick", { pitch: 6 - run.stock * 3 }));
    },
    column(col, points, secs) {
      // The column that finishes a hand pays out with the hand (one popup, not three on top of each other).
      if (run.pos.heights.every((h) => h === 0)) return;
      const L = layout();
      const x = L.colX[col]!;
      const y = Lay.top + L.cw * 0.4;
      schedule(FLY, () => {
        audio.play("pop", { pitch: 5 });
        fx.emit(x, y, { count: 14, speed: [60, 220], life: [0.3, 0.7], size: [2, 5], colors: [PAL.accent, PAL.paper], drag: 2, shape: "ring" });
        addScore(points, x, y, PAL.paper, 20);
        addTime(secs, x, y + 24);
        session.feedback("impact");
      });
    },
    clear(hand, points, secs, stock) {
      const cx = W / 2;
      const cy = bannerY();
      const d = run.deal;
      const leftover = d.stock.slice(d.stock.length - stock);
      const step = Math.min(0.07, 0.7 / Math.max(1, stock));
      schedule(FLY, () => {
        hitStop.freeze(reduced ? 0 : 0.11);
        flash.trigger(PAL.accent, 0.9);
        shake.add(0.42);
        audio.play("win", { volume: 0.8 });
        session.feedback("success");
        banners.push({ text: "CLEARED", sub: stock ? `${stock} LEFT IN THE STOCK` : "NOT A CARD TO SPARE", color: PAL.accent, t: 0, life: 1.15 });
        for (let i = 0; i < 5; i++)
          fx.emit(cx + fxRng.range(-W * 0.35, W * 0.35), cy + fxRng.range(-30, 60), { count: 16, speed: [90, 330], life: [0.5, 1], size: [3, 7], colors: [PAL.accent, PAL.accentHot, PAL.paper, PAL.red], gravity: 380, drag: 1.4, spin: [-9, 9] });
        schedule(0.25, () => addScore(TUNE.clear + TUNE.column, cx - 46, cy + 66, PAL.accentHot, 28));
        schedule(0.4, () => addTime(TUNE.clearBack(hand) + TUNE.columnBack, cx + 50, cy + 66));
        audio.play("pop", { pitch: 5 });
        // Every card left in the stock is counted off onto the pile.
        leftover.forEach((card, i) =>
          schedule(0.2 + i * step, () => {
            if (run.deal !== d) return;
            const st = layout().stock;
            shownStock = Math.max(0, shownStock - 1);
            launch(card, { ...st, a: 0 }, 0.14, true, () => {
              audio.note(midiToFreq(72 + PENTATONIC[Math.min(PENTATONIC.length - 1, i)]!), 0.1, "triangle", 0.16);
              addScore(TUNE.stockBonus, st.x, st.y - st.w, PAL.paper, 16);
            });
          }),
        );
        if (stock) schedule(0.25 + stock * step, () => addTime(TUNE.stockBack * stock, layout().stock.x, layout().stock.y - 60));
        if (player()) tc.analytics.track("level_complete", { level: hand + 1 });
      });
    },
    stall() {
      schedule(FLY + 0.12, () => {
        const L = layout();
        for (let c = 0; c < run.deal.shape.cols; c++)
          for (let k = 0; k < run.pos.heights[c]!; k++)
            falling.push({ card: run.deal.cols[c]![k]!, x: L.colX[c]!, y: cardY(k), vx: fxRng.range(-60, 60), vy: fxRng.range(-160, -40), a: 0, va: fxRng.range(-3, 3), w: L.cw });
        audio.play("lose", { volume: 0.45 });
        shake.add(0.2);
        if (player()) {
          banners.push({ text: "OUT OF MOVES", sub: "NEXT HAND", color: PAL.paper, t: 0, life: 0.9 });
          session.feedback("fail");
        }
      });
    },
    end() {
      // Handled in update(): the run is over when the clock is.
    },
  };

  function launch(card: number, from: Slot & { a: number }, dur: number, bonus: boolean, onLand?: () => void) {
    flights.push({ card, from, t: 0, dur: reduced ? dur * 0.7 : dur, angle: fxRng.range(-0.09, 0.09), dx: fxRng.range(-3, 3), dy: fxRng.range(-2, 2), bonus, onLand });
  }

  function newRun(seed: number) {
    dealer = new Dealer(createRng(seed));
    flights = [];
    flies = [];
    banners = [];
    born.clear();
    run = new Run((i) => dealer.get(i), listener);
    run.start();
    clockShown = run.clock;
  }

  newRun(session.ctx.dailySeed ^ 0x5eed);
  Lay = layout();

  // ---------------------------------------------------------------------------
  // Input: a tap (press and release in place) on a column plays its exposed card; on the stock, draws. The press
  // shows at once; the move happens on release, so a swipe the feed takes over never plays a card.
  // ---------------------------------------------------------------------------
  function hit(x: number, y: number): number | null {
    const L = Lay;
    const ch = L.cw * CARD_ASPECT;
    const st = L.stock;
    if (Math.abs(x - st.x) < st.w / 2 + 16 && Math.abs(y - st.y) < (st.w * CARD_ASPECT) / 2 + 16) return STOCK;
    const gap = L.colX.length > 1 ? L.colX[1]! - L.colX[0]! : L.cw;
    for (let c = 0; c < L.colX.length; c++) {
      if (Math.abs(x - L.colX[c]!) > gap / 2) continue;
      const h = run.pos.heights[c]!;
      if (h === 0) return null;
      if (y >= L.top - 14 && y <= L.top + (h - 1) * L.band + ch + 28) return c;
    }
    return null;
  }

  function act(target: number) {
    lastInput = time;
    if (run.phase !== "play") return;
    if (target === STOCK) {
      if (!run.draw()) {
        stockNope = time;
        audio.play(NOPE);
      }
      return;
    }
    if (!run.play(target)) {
      // Not one up or one down: the card shrugs. Nothing is lost.
      nope[target] = time;
      audio.play(NOPE, { pitch: fxRng.range(-1, 1) });
    }
  }

  window.addEventListener("pointerdown", (e) => {
    audio.unlock();
    lastInput = time;
    if (session.phase !== "playing" || mode !== "play" || over || pressed) return;
    const target = hit(e.clientX, e.clientY);
    if (target === null) return;
    pressed = { target, x: e.clientX, y: e.clientY, t: time };
    audio.play(PRESS);
  });
  window.addEventListener("pointermove", (e) => {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 16) pressed = null;
  });
  window.addEventListener("pointerup", () => {
    const p = pressed;
    pressed = null;
    if (p && session.phase === "playing" && !over) act(p.target);
  });
  window.addEventListener("pointercancel", () => (pressed = null));
  session.on("cancel", () => (pressed = null));
  session.startOnTap(window);

  session.on("start", () => {
    mode = "play";
    over = null;
    summary = [];
    firstPlayDone = false;
    scoreShown.snap(0);
    newRun((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    layoutT.target = 1;
    lastInput = time;
    audio.play("select");
  });

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function hintCols(): Set<number> {
    const out = new Set<number>();
    if (run.phase !== "play") return out;
    const idle = time - lastInput > IDLE_HINT;
    const teaching = player() && lifetimePlays < TEACH_PLAYS;
    if (!player() || teaching || idle) for (const c of plays(run.deal, run.pos)) out.add(c);
    return out;
  }

  function endRun() {
    if (over) return;
    const s = run.stats;
    const best = session.best;
    const isBest = run.score > 0 && (best === null || run.score > best);
    over = { t: 0, isBest, ended: false };
    pressed = null;
    tc.storage.set("plays", lifetimePlays).catch(() => undefined);
    scoreShown.set(run.score);
    audio.play("lose", { volume: 0.4 });
    shake.add(0.25);
    banners.push({ text: "TIME", sub: "", color: PAL.heat, t: 0, life: 1.3 });
    if (isBest) {
      schedule(0.35, () => {
        audio.play("win");
        flash.trigger(PAL.accent, 1);
        for (let i = 0; i < 6; i++) fx.emit(fxRng.range(W * 0.15, W * 0.85), H * 0.3, { count: 18, speed: [120, 380], life: [0.6, 1.2], size: [3, 7], colors: [PAL.accent, PAL.accentHot, PAL.paper, PAL.red], gravity: 360, drag: 1.2, spin: [-9, 9] });
        banners.push({ text: "NEW BEST", sub: "", color: PAL.accent, t: 0, life: 1.6 });
      });
    }
    // One concrete thing to try next time, picked from how this run went.
    const hint =
      s.cleared === 0 && s.columns < 3
        ? "EMPTY A COLUMN: EACH ONE GIVES +1.5S"
        : s.draws > s.plays * 0.9
          ? "PLAY EVERY CARD YOU CAN BEFORE YOU DRAW"
          : s.bestStreak < 5
            ? "CHECK THE NEXT STOCK CARD BEFORE YOU PICK"
            : s.cleared < 3
              ? "KINGS GO ON ACES AND ACES ON KINGS"
              : "CLEAR FAST: LEFTOVER STOCK PAYS 40 A CARD";
    const prev = best ?? 0;
    const n = (v: number) => v.toLocaleString("en-US");
    summary = [
      isBest
        ? prev > 0
          ? `NEW BEST · ${n(run.score)} · +${n(run.score - prev)}`
          : `FIRST BEST · ${n(run.score)}`
        : prev <= 0
          ? "NO SCORE YET · ONE CARD PUTS YOU ON THE BOARD"
          : run.score === prev
            ? `LEVEL WITH YOUR BEST · ${n(prev)}`
            : `BEST ${n(prev)} · ${n(prev - run.score)} TO GO`,
      `LONGEST STREAK ${s.bestStreak} · ${s.cleared} ${s.cleared === 1 ? "HAND" : "HANDS"} CLEARED`,
      `NEXT: ${hint}`,
    ];
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    titleIn = Math.min(1, titleIn + rawDt * 1.4);
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(dt);
    layoutT.update(rawDt);
    Lay = layout();
    scoreShown.update(rawDt);
    scoreBump = Math.max(0, scoreBump - rawDt * 4);
    clockBump = Math.max(0, clockBump - rawDt * 3);
    clockShown += (run.clock - clockShown) * (1 - Math.exp(-9 * rawDt));

    // Keep the next hand ready: a few ms of dealing per frame, never a long task.
    dealer.pump(run.hand + 1, 4);

    if (mode === "attract") {
      run.clock = TUNE.max;
      const m = pilot.update(run, dt);
      if (m !== null) {
        if (m === DRAW) run.draw();
        else run.play(m);
      }
    }
    if (!over) run.step(dt);
    if (mode === "play" && run.over && !over) endRun();

    const hints = hintCols();
    for (let c = 0; c < lift.length; c++) {
      lift[c]!.target = hints.has(c) ? 1 : 0;
      lift[c]!.update(rawDt);
    }

    for (const f of flights) {
      f.t += dt;
      if (f.t >= f.dur) {
        pile.push({ card: f.card, angle: f.angle, dx: f.dx, dy: f.dy, t: time });
        if (pile.length > 4) pile.shift();
        f.onLand?.();
      }
    }
    flights = flights.filter((f) => f.t < f.dur);
    const due = later.filter((l) => l.at <= time);
    if (due.length) {
      later = later.filter((l) => l.at > time);
      for (const l of due) l.fn();
    }

    for (const f of flies) {
      const before = f.t;
      f.t += rawDt;
      if (before < f.dur && f.t >= f.dur) f.onLand?.();
    }
    flies = flies.filter((f) => f.t < f.dur + 0.05);
    for (const b of banners) b.t += rawDt;
    banners = banners.filter((b) => b.t < b.life);
    for (const p of falling) {
      p.vy += 1500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += p.va * dt;
    }
    falling = falling.filter((p) => p.y < H + 200);

    if (mode === "play" && !over && run.phase === "play" && run.clock < 6 && time - lastTick > 1) {
      lastTick = time;
      audio.play("tick", { pitch: 12 - run.clock * 2 });
    }

    if (over) {
      over.t += rawDt;
      if (!over.ended && over.t > 0.7) {
        over.ended = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { hands: s.cleared, streak: s.bestStreak, plays: s.plays, seconds: Math.round(s.seconds) } });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawBackground() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);
    // The table warms with the streak, a soft pool of light under the pile.
    const tier = run.phase === "play" || run.phase === "clear" ? tierOf(run.streak) : 0;
    const p = Lay.pile;
    const g = ctx.createRadialGradient(p.x, p.y, p.w * 0.3, p.x, p.y, Math.max(W, H) * 0.75);
    g.addColorStop(0, rgba(PAL.accent, 0.08 + tier * 0.035));
    g.addColorStop(1, rgba(PAL.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Faint diagonal hatching, like a cutting mat, so the table isn't a flat void.
    ctx.strokeStyle = "rgba(122,134,255,0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -H; x < W; x += 22) {
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
    }
    ctx.stroke();
  }

  function drawTableau() {
    if (run.phase === "stall" && falling.length) return;
    const L = Lay;
    const d: Deal = run.deal;
    const playable = new Set(run.phase === "play" ? plays(d, run.pos) : []);
    for (let c = 0; c < d.shape.cols; c++) {
      const h = run.pos.heights[c]!;
      // Empty column: a faint slot outline so the gap reads as earned space.
      if (h === 0) {
        ctx.strokeStyle = rgba(PAL.accent, 0.16);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        roundRect(ctx, L.colX[c]! - L.cw / 2, L.top, L.cw, L.cw * CARD_ASPECT, L.cw * 0.12);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      for (let k = 0; k < h; k++) {
        const b = born.get(c * 8 + k) ?? -10;
        const age = time - b;
        if (age < 0) continue;
        const kIn = reduced ? clamp(age / 0.15) : easeOutBack(clamp(age / 0.3), 1.2);
        const isTop = k === h - 1;
        let x = L.colX[c]!;
        let y = cardY(k);
        let w = L.cw;
        let a = 0;
        if (!reduced && kIn < 1) {
          y = lerp(L.top - H * 0.4, y, kIn);
          a = (1 - kIn) * (c % 2 ? 0.2 : -0.2);
        }
        if (isTop) {
          y -= lift[c]!.value * 6;
          const nk = time - nope[c]!;
          if (nk < 0.35) x += Math.sin(nk * 46) * 5 * (1 - nk / 0.35) * (reduced ? 0.3 : 1);
          if (pressed && pressed.target === c) w *= 0.95;
          const glow = lift[c]!.value;
          if (glow > 0.02 && playable.has(c)) {
            const pulse = light.pulse(time, 1.2, { still: 0.7 });
            ctx.strokeStyle = rgba(PAL.accent, glow * (0.55 + 0.35 * pulse));
            ctx.lineWidth = 3;
            roundRect(ctx, x - w / 2 - 3, y - (w * CARD_ASPECT) / 2 - 3, w + 6, w * CARD_ASPECT + 6, w * 0.15);
            ctx.stroke();
          }
        }
        sprites.draw(ctx, d.cols[c]![k]!, x, y, w, a, clamp(age / 0.08));
      }
    }
  }

  function drawPile() {
    const p = Lay.pile;
    const ph = p.w * CARD_ASPECT;
    // The pile's well.
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(ctx, p.x - p.w / 2 - 6, p.y - ph / 2 - 6, p.w + 12, ph + 12, p.w * 0.16);
    ctx.fill();
    const tier = run.phase === "play" || run.phase === "clear" ? tierOf(run.streak) : 0;
    if (tier > 0) {
      ctx.strokeStyle = rgba(tier >= 3 ? PAL.accentHot : PAL.accent, 0.35 + tier * 0.12);
      ctx.lineWidth = 2 + tier;
      roundRect(ctx, p.x - p.w / 2 - 6, p.y - ph / 2 - 6, p.w + 12, ph + 12, p.w * 0.16);
      ctx.stroke();
    }
    for (let i = 0; i < pile.length; i++) {
      const c = pile[i]!;
      const age = time - c.t;
      // A landing card arrives a little large and settles with weight.
      const s = reduced ? 1 : 1 + 0.08 * Math.max(0, 1 - age / 0.14);
      sprites.draw(ctx, c.card, p.x + c.dx, p.y + c.dy, p.w * s, c.angle);
    }
  }

  function drawStock() {
    const st = Lay.stock;
    const n = Math.max(0, shownStock);
    const sh = st.w * CARD_ASPECT;
    if (n === 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      roundRect(ctx, st.x - st.w / 2, st.y - sh / 2, st.w, sh, st.w * 0.12);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const sx = time - stockNope < 0.3 ? Math.sin((time - stockNope) * 46) * 4 * (1 - (time - stockNope) / 0.3) : 0;
    const press = pressed && pressed.target === STOCK ? 0.95 : 1;
    // Card edges under the top card show how much is left.
    const edges = Math.min(n, 7);
    for (let i = edges - 1; i >= 1; i--) sprites.draw(ctx, -1, st.x + sx + i * 1.2, st.y + i * 2.2, st.w * press);
    const next = run.next;
    const low = run.phase === "play" && n > 0 && n <= 3;
    if (n > 0) {
      if (next !== null && time >= nextFlip) {
        const k = reduced ? 1 : easeOutCubic(clamp((time - nextFlip) / 0.14));
        ctx.save();
        ctx.translate(st.x + sx, st.y);
        ctx.scale(Math.max(0.02, k), 1);
        sprites.draw(ctx, next, 0, 0, st.w * press);
        ctx.restore();
      } else sprites.draw(ctx, -1, st.x + sx, st.y, st.w * press);
      const idle = time - lastInput > IDLE_HINT * 0.6;
      if (run.phase === "play" && plays(run.deal, run.pos).length === 0 && (idle || (player() && lifetimePlays < TEACH_PLAYS))) {
        const pulse = light.pulse(time, 1.2, { still: 0.7 });
        ctx.strokeStyle = rgba(PAL.accent, 0.5 + 0.4 * pulse);
        ctx.lineWidth = 3;
        roundRect(ctx, st.x - st.w / 2 - 4, st.y - sh / 2 - 4, st.w + 8, sh + 8, st.w * 0.16);
        ctx.stroke();
      }
    }
    drawLabel(ctx, n === 0 ? "EMPTY" : low ? (n === 1 ? "LAST CARD" : `${n} LEFT`) : `DRAW · ${n}`, st.x, st.y + sh / 2 + 14, low ? PAL.heat : PAL.dim, 10);
  }

  function drawMeter() {
    const m = Lay.meter;
    const streak = run.phase === "play" || run.phase === "clear" ? run.streak : 0;
    const tier = tierOf(streak);
    const mult = multOf(streak);
    const k = time - tierAt;
    const pop = !reduced && tier > 0 && k < 0.45 ? 1 + 0.5 * (1 - easeOutCubic(k / 0.45)) : 1;
    ctx.save();
    ctx.translate(m.x, m.y - 6);
    ctx.scale(pop, pop);
    ctx.font = `900 ${Math.round(30 + tier * 3)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PAL.bgDeep;
    ctx.fillText(`×${mult}`, 0, 3);
    ctx.fillStyle = tier === 0 ? PAL.mute : tier >= 3 ? PAL.accentHot : PAL.accent;
    ctx.fillText(`×${mult}`, 0, 0);
    ctx.restore();
    // Progress to the next tier: pips that fill one per play.
    const nextAt = TIERS[tier + 1];
    const from = TIERS[tier]!;
    const pips = nextAt ? nextAt - from : 1;
    const filled = nextAt ? streak - from : 1;
    const pw = 7;
    const gap = 4;
    const total = pips * pw + (pips - 1) * gap;
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = i < filled && streak > 0 ? (tier >= 3 ? PAL.accentHot : PAL.accent) : "rgba(255,255,255,0.12)";
      ctx.fillRect(Math.round(m.x - total / 2 + i * (pw + gap)), Math.round(m.y + 22), pw, 5);
    }
    drawLabel(ctx, streak > 0 ? `STREAK ${streak}` : "STREAK", m.x, m.y + 40, streak > 0 ? PAL.paper : PAL.mute, 10);
  }

  function drawFlights() {
    const p = Lay.pile;
    for (const f of flights) {
      const k = clamp(f.t / f.dur);
      const e = easeOutCubic(k);
      const x = lerp(f.from.x, p.x + f.dx, e);
      const arc = reduced ? 0 : Math.sin(k * Math.PI) * Math.min(40, Math.abs(f.from.y - p.y) * 0.2);
      const y = lerp(f.from.y, p.y + f.dy, e) - arc;
      const w = lerp(f.from.w, p.w, e);
      const a = lerp(f.from.a, f.angle, e) + (reduced ? 0 : Math.sin(k * Math.PI) * 0.18 * Math.sign(x - p.x || 1));
      // A soft shadow under the card in flight lifts it off the table.
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      roundRect(ctx, x - w / 2 + 4, y - (w * CARD_ASPECT) / 2 + 8 + arc * 0.3, w, w * CARD_ASPECT, w * 0.12);
      ctx.fill();
      sprites.draw(ctx, f.card, x, y, w, a);
    }
  }

  function drawFalling() {
    for (const f of falling) sprites.draw(ctx, f.card, f.x, f.y, f.w, f.a, clamp(1 - (f.y - Lay.top) / (H * 1.1)));
  }

  function drawFlies() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of flies) {
      const k = clamp(f.t / f.dur);
      // Rise and hold a beat, then streak into the counter.
      const hold = 0.35;
      let x: number;
      let y: number;
      let s: number;
      if (k < hold) {
        const q = k / hold;
        x = f.x0;
        y = f.y0 - 16 * easeOutCubic(q);
        s = 0.7 + 0.45 * easeOutBack(q);
      } else {
        const q = easeInOutCubic((k - hold) / (1 - hold));
        x = lerp(f.x0, f.x1, q);
        y = lerp(f.y0 - 16, f.y1, q) - Math.sin(q * Math.PI) * 30;
        s = lerp(1.15, 0.6, q);
      }
      ctx.globalAlpha = k > 0.92 ? (1 - k) / 0.08 : 1;
      ctx.font = `900 ${Math.round(f.size * s)}px ${FONT_DISPLAY}`;
      // A dark outline keeps the number readable over a white card face mid-flight.
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = PAL.bgDeep;
      ctx.strokeText(f.text, x, y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  /** Banners sit in the free band between the HUD and the tableau when there is one, else over the tableau. */
  function bannerY(): number {
    const hud = session.play().top + 96;
    return Lay.top - hud > 72 ? (hud + Lay.top) / 2 : Lay.top + Lay.cw * CARD_ASPECT * 0.9;
  }

  function drawBanners() {
    const cy = bannerY();
    for (const b of banners) {
      const k = b.t / b.life;
      const inK = reduced ? 1 : easeOutBack(clamp(b.t / 0.25), 2);
      const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : clamp(b.t / 0.06);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, cy);
      ctx.scale(inK, inK);
      const size = Math.min(54, (W - 40) / (b.text.length * 0.78));
      ctx.font = `900 ${Math.round(size)}px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.bgDeep;
      ctx.fillText(b.text, 0, size * 0.08);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, 0);
      ctx.restore();
      if (b.sub) {
        ctx.globalAlpha = a;
        drawLabel(ctx, b.sub, W / 2, cy + 36, PAL.paper, 11);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawHud() {
    const top = session.play().top;
    const a = clamp(layoutT.value);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    const s = 1 + scoreBump * 0.12;
    ctx.save();
    ctx.translate(W / 2, top + 34);
    ctx.scale(s, s);
    drawNumber(ctx, Math.round(scoreShown.shown), 0, 0, 44, PAL.paper);
    ctx.restore();
    // The clock: a bar that empties, with bought-back seconds springing into it.
    const x0 = 24;
    const bw = W - 48;
    const y = top + 66;
    const f = clamp(clockShown / TUNE.max);
    const low = run.clock < 6 && !over;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x0, y - 3, bw, 6, 3);
    ctx.fill();
    const color = low ? mix(PAL.heat, "#FF9F80", light.pulse(time, 1.6)) : PAL.accent;
    const th = 6 + clockBump * 4;
    ctx.fillStyle = color;
    roundRect(ctx, x0, y - th / 2, Math.max(th, bw * f), th, th / 2);
    ctx.fill();
    drawLabel(ctx, `TIME ${Math.max(0, Math.ceil(run.clock))}S`, x0, y + 18, low ? PAL.heat : PAL.dim, 11, "left");
    const best = Math.max(session.best ?? 0, over ? run.score : 0);
    if (best > 0) drawLabel(ctx, `BEST ${best.toLocaleString("en-US")}`, x0 + bw, y + 18, PAL.mute, 11, "right");
    drawLabel(ctx, `HAND ${run.hand + 1}`, W / 2, y + 18, PAL.dim, 11);
    ctx.globalAlpha = 1;
  }

  function drawFirstRunHint() {
    if (!player() || taught || firstPlayDone || run.phase !== "play" || over) return;
    if (hintFor?.pos !== run.pos) hintFor = { pos: run.pos, move: plan(run.deal, run.pos) };
    const m = hintFor.move;
    if (m === null || m === DRAW) {
      drawLabel(ctx, "NO CARD GOES · TAP THE STOCK", W / 2, Lay.pile.y - Lay.pile.w * CARD_ASPECT * 0.5 - 22, PAL.accent, 11);
      return;
    }
    const x = Lay.colX[m]!;
    const y = cardY(run.pos.heights[m]! - 1);
    // A ghost fingertip presses the card in a slow loop.
    const cyc = (time % 1.4) / 1.4;
    const press = reduced ? 0.5 : cyc < 0.5 ? easeOutCubic(cyc / 0.5) : 1 - easeOutCubic((cyc - 0.5) / 0.5);
    const fx0 = x + Lay.cw * 0.12;
    const fy0 = y + Lay.cw * 0.42 - press * 8;
    // The press ring spreads from the fingertip as it touches down.
    if (!reduced && cyc < 0.6) {
      const rk = cyc / 0.6;
      ctx.strokeStyle = rgba(PAL.accent, 0.7 * (1 - rk));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx0, fy0, 16 + rk * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(PAL.accentDeep, 0.55);
    ctx.beginPath();
    ctx.arc(fx0, fy0, 17 - press * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PAL.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = rgba(PAL.paper, 0.9);
    ctx.beginPath();
    ctx.arc(fx0, fy0, 5, 0, Math.PI * 2);
    ctx.fill();
    const card = exposed(run.deal, run.pos, m)!;
    const pileName = RANK_NAME[rankOf(run.pos.pile)]!;
    const up = (rankOf(card) - rankOf(run.pos.pile) + 13) % 13 === 1;
    drawLabel(ctx, `${RANK_NAME[rankOf(card)]!.toUpperCase()} IS ONE ${up ? "UP" : "DOWN"} FROM ${pileName.toUpperCase()}`, W / 2, Lay.pile.y - Lay.pile.w * CARD_ASPECT * 0.5 - 22, PAL.accent, 11);
    drawLabel(ctx, "TAP CARDS ONE UP OR ONE DOWN", W / 2, Lay.pile.y - Lay.pile.w * CARD_ASPECT * 0.5 - 40, PAL.paper, 11);
  }

  function drawAttract() {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = reduced ? 1 : easeOutBack(titleIn);
    const ty = r.y + 52;
    ctx.save();
    ctx.translate(cx, ty);
    ctx.scale(k, k);
    drawTitle(ctx, "LADDERSNAP", 0, 0, r.w - 4, PAL.accent, 52, PAL.accentDeep);
    ctx.restore();
    drawLabel(ctx, "ONE UP · ONE DOWN · BEAT THE CLOCK", cx, ty + 24, rgba(PAL.paper, 0.8), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 44, PAL.accent, 12);
    drawTapPrompt(ctx, cx, r.y + r.h - 16, time, PAL.paper);
  }

  function drawSummary() {
    if (!over || over.t < 0.9 || !summary.length) return;
    // In the feed the result card covers the top half after the run, and the action rail returns on the right: the
    // panel sits just above the caption in the result card's own column (gutter to rail), its lines centred in it.
    const ins = session.preview();
    const a = clamp((over.t - 0.9) / 0.4);
    const x0 = ins.left + 16;
    const w = W - ins.right - 4 - x0;
    const cx = x0 + w / 2;
    // Never over the pile row (which sits under the caption in the feed, but is the whole bottom in a bare tab).
    const pileTop = Lay.pile.y - (Lay.pile.w * CARD_ASPECT) / 2;
    const bottom = Math.min(session.standalone ? H : H - ins.bottom - 12, pileTop - 10);
    const sizes = [13, 11, 11];
    const gaps = [0, 22, 19];
    const h = 22 + gaps.reduce((p, q) => p + q, 0) + 14;
    const y0 = bottom - h;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(5,6,12,0.78)";
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = rgba(over.isBest ? PAL.accent : PAL.paper, over.isBest ? 0.5 : 0.08);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.stroke();
    let y = y0 + 22;
    summary.forEach((line, i) => {
      y += gaps[i] ?? 19;
      const base = sizes[i] ?? 11;
      ctx.save();
      ctx.font = `${base}px ${FONT_MONO}`;
      // drawLabel spaces letters by 8 % of the size.
      const lw = ctx.measureText(line).width + line.length * base * 0.08;
      const size = lw > w - 24 ? Math.max(8, (base * (w - 24)) / lw) : base;
      ctx.restore();
      const color = i === 0 ? (over!.isBest ? PAL.accent : PAL.paper) : i === 2 ? PAL.accentHot : PAL.dim;
      drawLabel(ctx, line, cx, y, color, size);
    });
    ctx.globalAlpha = 1;
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawTapPrompt(ctx, W / 2, y0 - 20, time, PAL.accent, "TAP TO DEAL AGAIN");
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    drawBackground();
    drawTableau();
    drawFalling();
    drawPile();
    drawStock();
    drawMeter();
    drawFlights();
    fx.draw(ctx);
    drawFirstRunHint();
    drawBanners();
    ctx.restore();
    flash.draw(ctx, W, H);
    if (mode === "attract") drawAttract();
    else drawHud();
    drawFlies();
    drawSummary();
  }

  let readySent = false;
  tc.loop((dt) => {
    update(dt);
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
