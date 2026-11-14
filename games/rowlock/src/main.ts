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
  Photosafe,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { digitFont, drawCalendar, drawCheck, drawKey, drawLamp, drawLockMark, drawSpark, monoFont, PAL } from "./art.ts";
import { Controls, type TapResult, type Target } from "./controls.ts";
import { Dealer, type Puzzle } from "./gen.ts";
import { boxOf, colOf, geometry, rowOf } from "./grid.ts";
import { attractGeometry, boardSize, fitCell, keyAt, keyRect, lerpBoard, makeBoard, playGeometry, type Board, type Rect } from "./layout.ts";
import { Pilot, skillByName, SKILLS } from "./pilot.ts";
import { COMBO_NAMES, multOf, Run, TIER_NAMES, tierOf, TIERS, TUNE, type RunListener } from "./run.ts";
import { charsFit, gridTag, hintFor, summaryBox, summaryLines, wrapWords } from "./copy.ts";
import { pencil, TECH } from "./solver.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;

// ---------------------------------------------------------------------------
// Sounds: key clicks and thocks, each digit its own note, a bell for every lock.
// ---------------------------------------------------------------------------
const CLICK: SfxParams = { wave: "noise", freq: 3200, freqEnd: 1800, duration: 0.025, volume: 0.12, highpass: 1400, punch: 2.5 };
const THOCK: SfxParams = { wave: "sine", freq: 230, freqEnd: 95, duration: 0.08, volume: 0.42, punch: 2.4 };
const BONK: SfxParams = { wave: "triangle", freq: 190, freqEnd: 120, duration: 0.16, volume: 0.32, punch: 1.8 };
const NOPE: SfxParams = { wave: "triangle", freq: 260, freqEnd: 210, duration: 0.07, volume: 0.14 };
const BELL: SfxParams = { wave: "sine", freq: 1318.5, duration: 0.7, volume: 0.16, punch: 1.1 };
const SHIMMER: SfxParams = { wave: "triangle", freq: 1760, duration: 0.28, volume: 0.12, arp: [0, 7, 12, 19], arpStep: 0.05 };
/** Digits 1..6 on a major pentatonic from E4, so any row plays a tune that sounds fine. */
const SCALE = [0, 2, 4, 7, 9, 12];
const noteOf = (d: number, lift = 0) => midiToFreq(64 + (SCALE[d - 1] ?? 0) + lift);

/** How many right digits (ever) keep the first-run finger. */
const TEACH_DIGITS = 3;

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

interface Line {
  text: string;
  color: string;
  t: number;
  life: number;
}

interface Sweep {
  cells: number[];
  t0: number;
}

interface Falling {
  cell: number;
  digit: number;
  t0: number;
}

interface Leaving {
  board: Board;
  values: Int8Array;
  givens: Int8Array;
  t0: number;
}

interface View {
  board: Board;
  pad: Rect[];
  lamp: Rect | null;
  tagY: number;
  meterY: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "rowlock" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const reduced = session.reducedMotion;
  const fxRng = createRng(session.ctx.seed ^ 0x70c4);
  const shake = new Shake(9, 0.018, 1.9, reduced);
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2, decay: 0.45 });
  const hitStop = new HitStop();
  const fx = new Particles(700);
  const scoreShown = new Counter(0, 14);
  const titleA = new Spring(1, 180, 24);

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
  });

  // Player memory: the first-run finger.
  let taught = false;
  try {
    taught = (await tc.storage.get<boolean>("taught")) === true;
  } catch {
    /* guest or offline: teach again */
  }

  const daily = session.ctx.dailySeed;
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let time = 0;
  let mode: "attract" | "play" = "attract";
  let dealer = new Dealer((session.ctx.dailySeed ^ 0x5eed) >>> 0, daily);
  let run!: Run;
  const controls = new Controls(() => run);
  const demo = new Pilot({ ...SKILLS.good, slip: 0, look: 0.72, tap: [0.26, 0.36] }, createRng(daily ^ 0x9117));
  const qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;
  let flies: Fly[] = [];
  let banners: Banner[] = [];
  let lines: Line[] = [];
  let sweeps: Sweep[] = [];
  let falling: Falling[] = [];
  let leaving: Leaving | null = null;
  const born = new Float32Array(36).fill(-10);
  const placedAt = new Float32Array(36).fill(-10);
  const shakeAt = new Float32Array(36).fill(-10);
  const clashAt = new Float32Array(36).fill(-10);
  const padNope = new Float32Array(7).fill(-10);
  const padPop = new Float32Array(7).fill(-10);
  const lockedAt = new Map<number, number>();
  let lampNope = -10;
  let lampPop = -10;
  let peek: { digit: number; t: number } | null = null;
  let ripple: { cell: number; t0: number } | null = null;
  let tierAt = -10;
  let clockShown: number = TUNE.start;
  let clockBump = 0;
  let scoreBump = 0;
  let lastTick = 0;
  let pressed: { target: Target; x: number; y: number } | null = null;
  let ghost: { x: number; y: number; t0: number } | null = null;
  let over: { t: number; isBest: boolean; ended: boolean; prev: number } | null = null;
  let summary: string[] = [];
  let passedBest = false;
  let rightThisRun = 0;
  let marksIn = -10;

  /** Effects that land a beat later run on game time, so a pause holds them too (never setTimeout). */
  let later: Array<{ at: number; fn: () => void }> = [];
  const schedule = (secs: number, fn: () => void) => later.push({ at: time + secs, fn });
  const player = () => mode === "play";

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  function currentView(): View {
    const shape = run.puzzle.shape;
    if (mode === "attract") {
      const a = attractGeometry(safeRect(session.preview(), W, H, 16), shape);
      return { board: a.board, pad: a.pad, lamp: null, tagY: a.board.y - 14, meterY: -100 };
    }
    const p = playGeometry(W, H, session.play().top, shape);
    let board = p.board;
    if (over && summary.length) {
      // After the bell the board shrinks into the space above the game-over panel.
      const box = summaryBox(W, H, session.preview(), session.standalone, hintLines().lines.length);
      const top = p.hud + 30;
      const bottom = box.y - 24;
      const cell = Math.min(p.board.cell, fitCell(shape, box.w - 28, bottom - top, p.board.cell));
      const target = makeBoard(shape, cell, box.x + box.w / 2, top + Math.max(0, (bottom - top - boardSize(shape, cell).h) * 0.5));
      board = lerpBoard(p.board, target, easeInOutCubic(clamp((over.t - 0.5) / 0.5)));
    }
    return { board, pad: p.pad, lamp: p.lamp, tagY: board.y - 16, meterY: p.meterY };
  }
  let V: View;

  const scoreAt = () => ({ x: W / 2, y: session.play().top + 34 });
  const clockAt = () => ({ x: 24 + (W - 48) * clamp(run.clock / TUNE.max), y: session.play().top + 66 });
  const keyCenter = (i: number) => {
    const k = keyRect(V.board, i);
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  };

  function popAt(text: string, x: number, y: number, to: { x: number; y: number }, color: string, size: number, onLand?: () => void) {
    flies.push({ text, x0: x, y0: y, x1: to.x, y1: to.y, t: reduced ? 0.3 : 0, dur: reduced ? 0.55 : 0.66, color, size, onLand });
  }
  function addScore(points: number, x: number, y: number, color: string = PAL.paper, size = 20) {
    if (!player()) return;
    popAt(`+${points}`, x, y, scoreAt(), color, size, () => {
      scoreShown.set(Math.min(run.score, scoreShown.target + points));
      scoreBump = 1;
    });
  }
  function addTime(secs: number, x: number, y: number) {
    if (!player()) return;
    popAt(`+${secs.toFixed(secs % 1 ? 1 : 0)}S`, x, y, clockAt(), PAL.accentHot, 15, () => (clockBump = 1));
  }
  function say(text: string, color: string = PAL.accentHot, life = 1.3) {
    lines = lines.filter((l) => l.t < l.life * 0.6);
    lines.push({ text, color, t: 0, life });
  }

  // ---------------------------------------------------------------------------
  // The run, and what each rule event looks and sounds like
  // ---------------------------------------------------------------------------
  const listener: RunListener = {
    deal(index, p: Puzzle) {
      const g = geometry(p.shape);
      for (let i = 0; i < g.cells; i++) born[i] = time + (reduced ? 0 : 0.018 * i + (p.givens[i] ? 0 : 0.05));
      placedAt.fill(-10);
      shakeAt.fill(-10);
      clashAt.fill(-10);
      lockedAt.clear();
      sweeps = [];
      falling = [];
      ripple = null;
      peek = null;
      marksIn = -10;
      controls.reset();
      audio.play("whoosh", { volume: 0.4 });
      if (index > 0 && player()) say(index === 4 ? "FROM HERE THEY HIDE THEIR MOVES" : `GRID ${index + 1}`, PAL.paper, 1.1);
    },
    place(cell, digit, streak, points, tierUp) {
      placedAt[cell] = time;
      const c = keyCenter(cell);
      const tier = tierOf(streak);
      audio.play(THOCK, { pitch: fxRng.range(-1, 1), volume: player() ? 1 : 0.6 });
      audio.note(noteOf(digit, tier >= 3 ? 12 : 0), 0.16, "triangle", 0.2 + Math.min(0.08, streak * 0.004));
      fx.emit(c.x, c.y, { count: 5 + tier * 2, speed: [40, 120 + tier * 30], life: [0.2, 0.45], size: [2, 3 + tier * 0.6], colors: tier >= 2 ? [PAL.accent, PAL.accentHot] : [PAL.accent, PAL.paper], drag: 3, spread: V.board.cell * 0.3, shape: "square" });
      shake.add(0.03 + tier * 0.01);
      addScore(points, c.x, c.y - V.board.cell * 0.55, tier >= 2 ? PAL.accentHot : PAL.paper, 16 + tier * 2);
      peek = { digit, t: time };
      if (player()) {
        rightThisRun++;
        if (!taught && rightThisRun >= TEACH_DIGITS) {
          taught = true;
          tc.storage.set("taught", true).catch(() => undefined);
          tc.analytics.track("tutorial_complete");
        }
        const best = session.best;
        if (!passedBest && best !== null && best > 0 && run.score > best) {
          passedBest = true;
          say("PAST YOUR BEST", PAL.accent, 1.6);
          session.feedback("success");
        }
      }
      if (tierUp && tier > 0) {
        tierAt = time;
        audio.play("powerup", { pitch: tier * 2, volume: 0.55 });
        if (player()) {
          say(`${TIER_NAMES[tier]} · ×${tier + 1}`, tier >= 3 ? PAL.accentHot : PAL.accent, 1.5);
          session.feedback("tap");
          const m = meterAt();
          fx.emit(m.x, m.y, { count: 14 + tier * 4, speed: [70, 240], life: [0.35, 0.8], size: [2, 5], colors: [PAL.accent, PAL.accentHot, PAL.paper], drag: 2.5, shape: "spark" });
        }
        shake.add(0.1);
      }
    },
    wrong(cell, digit, clashes, secs) {
      shakeAt[cell] = time;
      falling.push({ cell, digit, t0: time });
      for (const p of clashes) clashAt[p] = time;
      audio.play(BONK, { pitch: fxRng.range(-1, 1) });
      audio.play("error", { volume: 0.35 });
      shake.add(0.16);
      if (player()) {
        const c = keyCenter(cell);
        popAt(`−${secs}S`, c.x, c.y - V.board.cell * 0.5, clockAt(), PAL.heat, 16);
        if (clashes.length) say(`${digit} IS ALREADY IN ${clashWord(cell, clashes[0]!)}`, PAL.heat, 1.3);
        else say("NOT THAT ONE · STREAK RESET", PAL.heat, 1.1);
      }
    },
    lock(units, points, secs, cell, final) {
      const g = run.g;
      const c = keyCenter(cell);
      // Each unit plays its digits in order, then rings.
      units.forEach((u, k) => {
        const cells = g.units[u]!;
        sweeps.push({ cells, t0: time + k * 0.06 });
        const step = reduced ? 0.03 : 0.045;
        cells.forEach((i, j) => schedule(k * 0.06 + j * step, () => audio.note(noteOf(run.values[i] || 1, 12), 0.14, "triangle", 0.11)));
        schedule(k * 0.06 + cells.length * step, () => audio.play(BELL, { pitch: k * 7, volume: 0.9 }));
        lockedAt.set(u, time + k * 0.06 + cells.length * step);
      });
      if (!final) {
        addScore(points, c.x, c.y - V.board.cell * 0.15, PAL.accent, units.length > 1 ? 24 : 19);
        schedule(0.12, () => addTime(secs, c.x, c.y + V.board.cell * 0.5));
      }
      if (units.length >= 2 && !final) {
        say(COMBO_NAMES[units.length]!, PAL.accentHot, 1.4);
        hitStop.freeze(reduced ? 0 : 0.05);
        shake.add(0.2 + 0.08 * units.length);
        // Haptics only for the big beats: a triple, not every double.
        if (units.length === 3) session.feedback("impact");
        fx.emit(c.x, c.y, { count: 22 * units.length, speed: [90, 320], life: [0.4, 0.9], size: [2, 6], colors: [PAL.accent, PAL.accentHot, PAL.paper], drag: 2, shape: "spark" });
        if (units.length === 3) schedule(0.3, () => audio.play(SHIMMER));
      } else if (!final) {
        fx.emit(c.x, c.y, { count: 10, speed: [60, 180], life: [0.3, 0.6], size: [2, 4], colors: [PAL.accent, PAL.paper], drag: 2.5, shape: "ring" });
      }
    },
    spark(cell, lamp) {
      const c = keyCenter(cell);
      audio.play(SHIMMER, { volume: 0.9 });
      fx.emit(c.x, c.y, { count: 20, speed: [60, 220], life: [0.4, 0.9], size: [2, 5], colors: [PAL.accentHot, PAL.paper], drag: 2, shape: "spark" });
      if (!player()) return;
      addScore(TUNE.spark, c.x, c.y - V.board.cell * 0.8, PAL.accentHot, 18);
      if (lamp && V.lamp) {
        const l = V.lamp;
        popAt("LAMP", c.x, c.y, { x: l.x + l.w / 2, y: l.y + l.h / 2 }, PAL.accentHot, 14, () => {
          lampPop = time;
          audio.play("powerup", { pitch: 7, volume: 0.4 });
        });
        say("SPARK · A LAMP FOR LATER", PAL.accentHot, 1.4);
      } else say("SPARK · +50", PAL.accentHot, 1.1);
    },
    lamp(cell, digit) {
      placedAt[cell] = time;
      const c = keyCenter(cell);
      audio.play("whoosh", { volume: 0.5, pitch: 5 });
      schedule(0.08, () => audio.note(noteOf(digit, 12), 0.3, "sine", 0.22));
      fx.emit(c.x, c.y, { count: 26, speed: [40, 200], life: [0.4, 0.9], size: [2, 5], colors: [PAL.accentHot, PAL.accent, PAL.paper], drag: 2, shape: "spark" });
      lampPop = time;
    },
    marks() {
      marksIn = time;
      if (player()) say("PENCIL MARKS ARE OUT", PAL.dim, 1.4);
    },
    solve(index, points, secs, clean) {
      const last = run.values.findIndex((_, i) => placedAt[i] === Math.max(...placedAt));
      ripple = { cell: Math.max(0, last), t0: time };
      hitStop.freeze(reduced ? 0 : 0.12);
      flash.trigger(PAL.accent, 0.85);
      shake.add(0.4);
      schedule(0.05, () => audio.play("win", { volume: 0.75 }));
      // The whole grid plays back as a quick cascade.
      const order = Array.from(run.values, (v, i) => ({ v, i })).sort((a, b) => dist(a.i) - dist(b.i));
      order.forEach(({ v }, k) => {
        if (k % 2 === 0) schedule(0.25 + k * 0.018, () => audio.note(noteOf(v, 12), 0.12, "triangle", 0.07));
      });
      if (player()) {
        session.feedback("success");
        banners.push({ text: index === 0 ? "TODAY'S GRID" : "LOCKED", sub: clean ? "NOT ONE SLIP · +100" : `GRID ${index + 1} DONE`, color: PAL.accent, t: 0, life: 1.4 });
        const b = V.board;
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        for (let i = 0; i < 5; i++)
          fx.emit(cx + fxRng.range(-b.w * 0.4, b.w * 0.4), cy + fxRng.range(-b.h * 0.3, b.h * 0.3), { count: 16, speed: [90, 330], life: [0.5, 1], size: [3, 7], colors: [PAL.accent, PAL.accentHot, PAL.paper], gravity: 380, drag: 1.4, spin: [-9, 9] });
        schedule(0.3, () => addScore(points, cx - 44, b.y + b.h * 0.42 + 76, PAL.accentHot, 26));
        schedule(0.45, () => addTime(secs, cx + 48, b.y + b.h * 0.42 + 76));
        tc.analytics.track("level_complete", { level: index + 1 });
      }
      function dist(i: number) {
        const g = run.g;
        return Math.abs(rowOf(g, i) - rowOf(g, ripple!.cell)) + Math.abs(colOf(g, i) - colOf(g, ripple!.cell));
      }
    },
    end() {
      // Handled in update(): the run is over when the clock is.
    },
  };

  function clashWord(cell: number, other: number): string {
    const g = run.g;
    if (rowOf(g, cell) === rowOf(g, other)) return "THIS ROW";
    if (colOf(g, cell) === colOf(g, other)) return "THIS COLUMN";
    return boxOf(g, cell) === boxOf(g, other) ? "THIS BOX" : "THIS ROW";
  }

  function newRun(seed: number) {
    if (run && V) leaving = { board: V.board, values: Int8Array.from(run.values), givens: Int8Array.from(run.given), t0: time };
    dealer = new Dealer(seed, daily);
    flies = [];
    banners = [];
    lines = [];
    run = new Run((i) => dealer.get(i), listener);
    run.start();
    clockShown = run.clock;
  }

  newRun((session.ctx.dailySeed ^ 0x5eed) >>> 0);
  V = currentView();

  // ---------------------------------------------------------------------------
  // Input: a press shows at once; the move happens on release, so a swipe the feed takes over never enters a digit.
  // ---------------------------------------------------------------------------
  function hit(x: number, y: number): Target | null {
    for (let i = 0; i < V.pad.length; i++) {
      const p = V.pad[i]!;
      if (x >= p.x - 4 && x <= p.x + p.w + 4 && y >= p.y - 8 && y <= p.y + p.h + 10) return { kind: "pad", digit: i + 1 };
    }
    const l = V.lamp;
    if (l && x >= l.x - 6 && x <= l.x + l.w + 6 && y >= l.y - 6 && y <= l.y + l.h + 6) return { kind: "lamp" };
    const b = V.board;
    const k = keyAt(b, x, y, 12);
    if (k === null) return null;
    // Near-miss help with a digit armed: a touch on the edge of a full key goes to the empty key beside it.
    if (controls.armed !== null && run.values[k] !== 0) {
      let best = -1;
      let bestD = 14 * 14;
      for (let i = 0; i < run.values.length; i++) {
        if (run.values[i]) continue;
        const r = keyRect(b, i);
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        if (dx * dx + dy * dy < bestD) {
          bestD = dx * dx + dy * dy;
          best = i;
        }
      }
      if (best >= 0) return { kind: "key", cell: best };
    }
    return { kind: "key", cell: k };
  }

  function act(target: Target, byPilot: boolean) {
    const before = controls.armed;
    const r: TapResult = controls.tap(target);
    if (byPilot) showGhost(target);
    switch (r) {
      case "select":
      case "deselect":
        audio.play(CLICK, { pitch: r === "select" ? 3 : -2 });
        break;
      case "arm":
      case "disarm":
        audio.play(CLICK, { pitch: r === "arm" ? 7 : 0 });
        audio.play("select", { volume: 0.25, pitch: r === "arm" ? 4 : -5 });
        if (target.kind === "pad") padPop[target.digit] = time;
        else if (controls.armed !== null) padPop[controls.armed] = time;
        if (r === "arm" && controls.armed !== null) peek = { digit: controls.armed, t: time };
        break;
      case "peek":
        if (target.kind === "key") peek = { digit: run.values[target.cell]!, t: time };
        audio.play(CLICK);
        break;
      case "nope":
        audio.play(NOPE);
        if (target.kind === "pad") padNope[target.digit] = time;
        else if (target.kind === "lamp") lampNope = time;
        break;
      default:
        break;
    }
    if (before !== null && controls.armed === null && r === "right") {
      // That digit is complete: its pad key locks.
      padPop[before] = time;
      audio.play("pop", { pitch: 7, volume: 0.5 });
    }
  }

  function targetCenter(t: Target): { x: number; y: number } {
    if (t.kind === "key") return keyCenter(t.cell);
    if (t.kind === "pad") {
      const p = V.pad[t.digit - 1]!;
      return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    }
    const l = V.lamp;
    return l ? { x: l.x + l.w / 2, y: l.y + l.h / 2 } : { x: -99, y: -99 };
  }
  function showGhost(t: Target) {
    const c = targetCenter(t);
    ghost = { x: c.x, y: c.y, t0: time };
  }

  window.addEventListener("pointerdown", (e) => {
    audio.unlock();
    if (session.phase !== "playing" || mode !== "play" || over || pressed || qaPilot) return;
    const target = hit(e.clientX, e.clientY);
    if (!target) return;
    pressed = { target, x: e.clientX, y: e.clientY };
    audio.play(CLICK, { volume: 0.5, pitch: -4 });
  });
  window.addEventListener("pointermove", (e) => {
    if (pressed && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 18) pressed = null;
  });
  window.addEventListener("pointerup", () => {
    const p = pressed;
    pressed = null;
    if (p && session.phase === "playing" && !over) act(p.target, false);
  });
  window.addEventListener("pointercancel", () => (pressed = null));
  session.on("cancel", () => (pressed = null));
  session.startOnTap(window);

  session.on("start", () => {
    mode = "play";
    over = null;
    summary = [];
    passedBest = false;
    rightThisRun = 0;
    scoreShown.snap(0);
    titleA.target = 0;
    demo.reset();
    qaPilot?.reset();
    newRun((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    audio.play("select");
  });

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function endRun() {
    if (over) return;
    const best = session.best;
    const isBest = run.score > 0 && (best === null || run.score > best);
    over = { t: 0, isBest, ended: false, prev: best ?? 0 };
    pressed = null;
    controls.reset();
    scoreShown.set(run.score);
    audio.play("lose", { volume: 0.4 });
    shake.add(0.25);
    banners.push({ text: "TIME", sub: "", color: PAL.heat, t: 0, life: 1.3 });
    if (isBest) {
      schedule(0.35, () => {
        audio.play("win");
        flash.trigger(PAL.accent, 1);
        for (let i = 0; i < 6; i++) fx.emit(fxRng.range(W * 0.15, W * 0.85), H * 0.3, { count: 18, speed: [120, 380], life: [0.6, 1.2], size: [3, 7], colors: [PAL.accent, PAL.accentHot, PAL.paper], gravity: 360, drag: 1.2, spin: [-9, 9] });
        banners.push({ text: "NEW BEST", sub: "", color: PAL.accent, t: 0, life: 1.6 });
      });
    }
    summary = summaryLines(run.score, best, run.stats, hintFor(run.stats, run.lamps));
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(dt);
    titleA.update(rawDt);
    scoreShown.update(rawDt);
    scoreBump = Math.max(0, scoreBump - rawDt * 4);
    clockBump = Math.max(0, clockBump - rawDt * 3);
    clockShown += (run.clock - clockShown) * (1 - Math.exp(-9 * rawDt));

    // Keep the next grid ready: a few ms of dealing per frame, never a long task.
    dealer.pump(run.index + 1, 3);

    if (mode === "attract") {
      run.clock = TUNE.max;
      const t = demo.update(run, controls, dt);
      if (t) act(t, true);
    } else if (qaPilot && session.phase === "playing" && !over) {
      const t = qaPilot.update(run, controls, dt);
      if (t) act(t, true);
    }
    if (!over) run.step(dt);
    if (mode === "play" && run.over && !over) endRun();
    V = currentView();

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
    for (const l of lines) l.t += rawDt;
    lines = lines.filter((l) => l.t < l.life);
    sweeps = sweeps.filter((s) => time - s.t0 < 1.2);
    falling = falling.filter((f) => time - f.t0 < 0.7);
    if (leaving && time - leaving.t0 > 0.6) leaving = null;

    if (mode === "play" && !over && run.phase === "play" && run.clock < 6 && time - lastTick > 1) {
      lastTick = time;
      audio.play("tick", { pitch: 12 - run.clock * 2 });
    }

    if (over) {
      over.t += rawDt;
      if (!over.ended && over.t > 0.7) {
        over.ended = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { grids: s.solved, locks: s.locks, streak: s.bestStreak, digits: s.digits, seconds: Math.round(s.seconds) } });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function meterAt() {
    return { x: 12 + 44, y: V.meterY };
  }

  function drawBackground() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);
    // A pool of warm light under the board that grows with the streak.
    const tier = run.phase === "play" || run.phase === "solved" ? tierOf(run.streak) : 0;
    const b = V.board;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const g = ctx.createRadialGradient(cx, cy, b.w * 0.2, cx, cy, Math.max(W, H) * 0.8);
    g.addColorStop(0, rgba(PAL.accent, 0.035 + tier * 0.012));
    g.addColorStop(1, rgba(PAL.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // A fine dot screen, like a speaker grille, so the ground isn't a flat void.
    ctx.fillStyle = "rgba(198,170,57,0.035)";
    for (let y = 6; y < H; y += 12) for (let x = (y / 12) % 2 ? 12 : 6; x < W; x += 12) ctx.fillRect(x, y, 1.5, 1.5);
  }

  function keyGlow(i: number): number {
    let gl = 0;
    for (const s of sweeps) {
      const j = s.cells.indexOf(i);
      if (j < 0) continue;
      const k = time - (s.t0 + j * (reduced ? 0.03 : 0.045));
      if (k < 0 || k > 0.5) continue;
      gl = Math.max(gl, k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.42);
    }
    if (ripple) {
      const g = run.g;
      const d = Math.abs(rowOf(g, i) - rowOf(g, ripple.cell)) + Math.abs(colOf(g, i) - colOf(g, ripple.cell));
      // The finished grid lights up in a wave from the last key: never all at once, and never at full brass.
      const k = time - ripple.t0 - 0.12 - d * 0.06;
      if (k > 0 && k < 0.6) gl = Math.max(gl, 0.6 * (k < 0.14 ? k / 0.14 : 1 - (k - 0.14) / 0.46));
    }
    return reduced ? gl * 0.5 : gl;
  }

  function drawPlates(b: Board, alpha: number) {
    const { n, br, bc } = b.shape;
    const g = geometry(b.shape);
    const pad = b.boxGap * 0.38;
    for (let bx = 0; bx < n; bx++) {
      const cells = g.units[2 * n + bx]!;
      const a = keyRect(b, cells[0]!);
      const z = keyRect(b, cells[cells.length - 1]!);
      const across = n / bc;
      const alt = (Math.floor(bx / across) + (bx % across)) % 2 === 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = alt ? PAL.plateAlt : PAL.plate;
      roundRect(ctx, a.x - pad, a.y - pad, z.x + z.w - a.x + pad * 2, z.y + z.h - a.y + pad * 2, b.cell * 0.26);
      ctx.fill();
      const locked = lockedAt.get(2 * n + bx);
      if (locked !== undefined && time >= locked && mode === "play") {
        const k = reduced ? 1 : easeOutCubic(clamp((time - locked) / 0.3));
        ctx.strokeStyle = rgba(PAL.accent, 0.55 * k);
        ctx.lineWidth = 2;
        roundRect(ctx, a.x - pad, a.y - pad, z.x + z.w - a.x + pad * 2, z.y + z.h - a.y + pad * 2, b.cell * 0.26);
        ctx.stroke();
      }
      void br;
    }
    ctx.globalAlpha = 1;
  }

  /** Rowlock marks along the board's edge for locked rows (right) and columns (below). */
  function drawLockMarks(b: Board) {
    if (mode !== "play") return;
    const n = b.shape.n;
    const s = Math.max(7, Math.min(10, b.cell * 0.17));
    for (const [u, at] of lockedAt) {
      if (u >= 2 * n || time < at) continue;
      const k = reduced ? 1 : easeOutBack(clamp((time - at) / 0.35), 2.2);
      ctx.globalAlpha = clamp((time - at) / 0.1);
      if (u < n) {
        const r = keyRect(b, u * n);
        drawLockMark(ctx, b.x + b.w + 11, r.y + r.h / 2, s * k, -Math.PI / 2, PAL.accent);
      } else {
        const r = keyRect(b, u - n);
        drawLockMark(ctx, r.x + r.w / 2, b.y + b.h + 11, s * k, 0, PAL.accent);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBoard() {
    const b = V.board;
    const n = b.shape.n;
    const g = run.g;
    const dealing = run.phase === "deal";
    const sel = controls.selected;
    const armed = controls.armed;
    const peekDigit = peek && time - peek.t < 1.1 ? peek.digit : null;
    const showDigit = armed ?? peekDigit;
    const nudge = mode === "play" && run.nudging && !over ? run.nudge() : null;
    const marks = run.marks && !over ? pencil(g, run.values) : null;

    // The board that was just finished slides away to the left.
    if (leaving) {
      const k = easeInOutCubic(clamp((time - leaving.t0) / 0.5));
      const lb = leaving.board;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(-W * 0.6 * k, 0);
      drawPlates(lb, 1);
      const lg = geometry(lb.shape);
      for (let i = 0; i < lg.cells; i++) {
        const r = keyRect(lb, i);
        const v = leaving.values[i]!;
        drawKey(ctx, r.x, r.y, r.w, { state: leaving.givens[i] ? "given" : v ? "placed" : "empty", digit: v, glow: 0.5, pressed: false, lit: false, scale: 1, alpha: 1 });
      }
      ctx.restore();
    }

    const inK = leaving ? easeOutCubic(clamp((time - leaving.t0 - 0.15) / 0.5)) : 1;
    ctx.save();
    if (inK < 1) ctx.translate(W * 0.5 * (1 - inK), 0);
    drawPlates(b, inK);

    // The selected key's row, column and box light up behind the keys.
    if (sel !== null && !dealing) {
      const units = g.unitsOf[sel]!;
      ctx.fillStyle = rgba(PAL.accent, 0.1);
      const e = b.gap / 2;
      for (let i = 0; i < g.cells; i++) {
        if (i === sel || !units.some((u) => g.units[u]!.includes(i))) continue;
        const r = keyRect(b, i);
        roundRect(ctx, r.x - e, r.y - e, r.w + e * 2, r.h + e * 2, b.cell * 0.24);
        ctx.fill();
      }
    }
    if (nudge) {
      // One dashed outline round the unit that shows the nudged key.
      const cells = g.units[nudge.unit]!;
      const a = keyRect(b, cells[0]!);
      const z = keyRect(b, cells[cells.length - 1]!);
      const pulse = light.pulse(time, 1.1, { still: 0.6 });
      ctx.strokeStyle = rgba(PAL.accent, 0.3 + 0.3 * pulse);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      roundRect(ctx, a.x - 4, a.y - 4, z.x + z.w - a.x + 8, z.y + z.h - a.y + 8, b.cell * 0.28);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let i = 0; i < g.cells; i++) {
      const r = keyRect(b, i);
      const age = time - born[i]!;
      if (age < 0) continue;
      const v = run.values[i]!;
      const given = run.given[i] !== 0;
      const pop = time - placedAt[i]!;
      let scale = reduced ? 1 : easeOutBack(clamp(age / 0.28), 1.6);
      if (!reduced && pop >= 0 && pop < 0.25) scale *= 1 + 0.12 * Math.sin((pop / 0.25) * Math.PI);
      let x = r.x;
      const sk = time - shakeAt[i]!;
      if (sk < 0.4) x += Math.sin(sk * 52) * 6 * (1 - sk / 0.4) * (reduced ? 0.3 : 1);
      const isPressed = pressed?.target.kind === "key" && pressed.target.cell === i;
      const glow = keyGlow(i);
      const hot = showDigit !== null && v === showDigit;
      drawKey(ctx, x, r.y, r.w, {
        state: given ? "given" : v ? "placed" : "empty",
        digit: v,
        glow,
        pressed: isPressed,
        lit: run.lit.has(i),
        scale,
        alpha: clamp(age / 0.12),
        ink: glow > 0.45 ? PAL.ink : hot ? PAL.accentHot : undefined,
      });
      if (hot && glow < 0.2) {
        // The armed digit's homes: a brass ring round every key that holds it.
        ctx.strokeStyle = rgba(PAL.accent, 0.85);
        ctx.lineWidth = 2;
        roundRect(ctx, x - 1.5, r.y - 1.5, r.w + 3, r.h + 3, b.cell * 0.23);
        ctx.stroke();
      }
      if (!v) {
        if (i === run.puzzle.spark && mode === "play") {
          const p = light.pulse(time, 0.9, { still: 0.8 });
          drawSpark(ctx, x + r.w * 0.79, r.y + r.h * 0.2, r.w * (0.09 + 0.03 * p), rgba(PAL.accentHot, 0.6 + 0.4 * p));
        }
        if (marks) drawMarks(x, r.y, r.w, marks[i]!, showDigit);
      }
      // Clashing digits ring once in heat.
      const ck = time - clashAt[i]!;
      if (ck < 0.7) {
        ctx.strokeStyle = rgba(PAL.heat, 0.9 * (1 - ck / 0.7));
        ctx.lineWidth = 3;
        roundRect(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, b.cell * 0.24);
        ctx.stroke();
      }
    }

    // The selected key and the armed digit's homes get rings.
    if (sel !== null && !dealing) {
      const r = keyRect(b, sel);
      ctx.strokeStyle = PAL.accent;
      ctx.lineWidth = 3;
      roundRect(ctx, r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5, b.cell * 0.25);
      ctx.stroke();
    }
    if (nudge && !dealing) {
      const r = keyRect(b, nudge.cell);
      const pulse = light.pulse(time, 1.1, { still: 0.7 });
      ctx.strokeStyle = rgba(PAL.accentHot, 0.45 + 0.45 * pulse);
      ctx.lineWidth = 3;
      roundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, b.cell * 0.26);
      ctx.stroke();
    }
    // Wrong digits don't stick: they drop off the key, struck through.
    for (const f of falling) {
      const r = keyRect(b, f.cell);
      const k = (time - f.t0) / 0.7;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2 + (reduced ? 0 : k * k * r.h * 0.9));
      ctx.rotate(reduced ? 0 : k * 0.5);
      ctx.font = digitFont(r.w * 0.5);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.heat;
      ctx.fillText(String(f.digit), 0, 0);
      ctx.strokeStyle = PAL.heat;
      ctx.lineWidth = Math.max(2, r.w * 0.06);
      ctx.beginPath();
      ctx.moveTo(-r.w * 0.24, r.w * 0.2);
      ctx.lineTo(r.w * 0.24, -r.w * 0.2);
      ctx.stroke();
      ctx.restore();
    }
    // After the bell, the keys you didn't reach show their digits in pencil (never on today's grid, which everyone
    // shares and replays).
    if (over && over.t > 1 && run.index > 0) {
      ctx.globalAlpha = clamp((over.t - 1) / 0.6) * 0.5;
      ctx.font = digitFont(b.cell * 0.36);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.dim;
      for (let i = 0; i < g.cells; i++) {
        if (run.values[i]) continue;
        const r = keyRect(b, i);
        ctx.fillText(String(run.puzzle.solution[i]), r.x + r.w / 2, r.y + r.h / 2 - b.cell * 0.03);
      }
      ctx.globalAlpha = 1;
    }
    drawLockMarks(b);
    ctx.restore();
    void n;
  }

  function drawMarks(x: number, y: number, s: number, ds: number[], hot: number | null) {
    const n = run.n;
    const cols = n === 4 ? 2 : 3;
    const rows = n === 4 ? 2 : 2;
    const k = clamp((time - marksIn) / 0.5);
    ctx.font = monoFont(Math.max(8, s * 0.2));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const d of ds) {
      const cx = x + s * (0.24 + ((d - 1) % cols) * (0.52 / (cols - 1)));
      const cy = y + s * (0.26 + Math.floor((d - 1) / cols) * (0.4 / (rows - 1)));
      ctx.fillStyle = rgba(d === hot ? PAL.accentHot : PAL.dim, 0.85 * k);
      ctx.fillText(String(d), cx, cy);
    }
  }

  function drawPad() {
    const n = run.n;
    const a = over ? 1 - clamp(over.t / 0.4) : 1;
    if (a <= 0.01) return;
    const small = mode === "attract";
    ctx.save();
    ctx.globalAlpha = a;
    for (let i = 0; i < V.pad.length; i++) {
      const d = i + 1;
      const p = V.pad[i]!;
      const done = run.done(d);
      const armed = controls.armed === d;
      const isPressed = pressed?.target.kind === "pad" && pressed.target.digit === d;
      const nk = time - padNope[d]!;
      const pk = time - padPop[d]!;
      let x = p.x;
      if (nk < 0.3) x += Math.sin(nk * 46) * 4 * (1 - nk / 0.3);
      const s = !reduced && pk < 0.3 ? 1 + 0.1 * Math.sin((pk / 0.3) * Math.PI) : 1;
      const lip = small ? 3 : 5;
      const down = isPressed || armed;
      ctx.save();
      ctx.translate(x + p.w / 2, p.y + p.h / 2);
      ctx.scale(s, s);
      ctx.translate(-p.w / 2, -p.h / 2);
      ctx.fillStyle = PAL.keyLip;
      roundRect(ctx, 0, lip, p.w, p.h - lip, p.w * 0.2);
      ctx.fill();
      ctx.fillStyle = armed ? PAL.accent : done ? PAL.plate : PAL.keyTop;
      roundRect(ctx, 0, down ? lip * 0.7 : 0, p.w, p.h - lip, p.w * 0.2);
      ctx.fill();
      const cy = (down ? lip * 0.7 : 0) + (p.h - lip) / 2;
      if (done) {
        drawCheck(ctx, p.w / 2, cy, Math.min(p.w, p.h) * 0.32, rgba(PAL.accent, 0.7));
      } else {
        ctx.font = digitFont(small ? p.h * 0.5 : Math.min(32, p.h * 0.48));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = armed ? PAL.ink : PAL.paper;
        ctx.fillText(String(d), p.w / 2, cy - (small ? 0 : p.h * 0.06));
        if (!small) {
          // Pips: how many of this digit are still to place.
          const left = n - run.count(d);
          const pw = 4;
          const gap = 3;
          const tw = left * pw + (left - 1) * gap;
          ctx.fillStyle = armed ? rgba(PAL.ink, 0.7) : rgba(PAL.accent, 0.8);
          for (let k = 0; k < left; k++) ctx.fillRect(Math.round(p.w / 2 - tw / 2 + k * (pw + gap)), Math.round(cy + p.h * 0.24), pw, 3);
        }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawMeter() {
    if (mode !== "play") return;
    const a = over ? 1 - clamp(over.t / 0.4) : clamp(1 - titleA.value);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    const m = meterAt();
    const streak = run.phase === "play" || run.phase === "solved" ? run.streak : 0;
    const tier = tierOf(streak);
    const mult = multOf(streak);
    const k = time - tierAt;
    const pop = !reduced && tier > 0 && k < 0.45 ? 1 + 0.45 * (1 - easeOutCubic(k / 0.45)) : 1;
    ctx.save();
    ctx.translate(m.x - 18, m.y - 4);
    ctx.scale(pop, pop);
    ctx.font = `900 ${Math.round(26 + tier * 2)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PAL.bgDeep;
    ctx.fillText(`×${mult}`, 0, 3);
    ctx.fillStyle = tier === 0 ? PAL.mute : tier >= 3 ? PAL.accentHot : PAL.accent;
    ctx.fillText(`×${mult}`, 0, 0);
    ctx.restore();
    const nextAt = TIERS[tier + 1];
    const from = TIERS[tier]!;
    const pips = nextAt ? Math.min(9, nextAt - from) : 1;
    const filled = nextAt ? Math.round(((streak - from) / (nextAt - from)) * pips) : 1;
    const pw = 5;
    const gap = 3;
    const x0 = m.x + 14;
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = i < filled && streak > 0 ? (tier >= 3 ? PAL.accentHot : PAL.accent) : "rgba(255,255,255,0.12)";
      ctx.fillRect(Math.round(x0 + i * (pw + gap)), Math.round(m.y - 9), pw, 5);
    }
    drawLabel(ctx, streak > 0 ? `STREAK ${streak}` : "STREAK", x0, m.y + 8, streak > 0 ? PAL.paper : PAL.mute, 10, "left");
    ctx.globalAlpha = 1;
    drawLampButton(a);
  }

  function drawLampButton(a: number) {
    const l = V.lamp;
    if (!l) return;
    const nk = time - lampNope;
    const pk = time - lampPop;
    let x = l.x;
    if (nk < 0.3) x += Math.sin(nk * 46) * 4 * (1 - nk / 0.3);
    const s = !reduced && pk < 0.35 ? 1 + 0.16 * Math.sin((pk / 0.35) * Math.PI) : 1;
    const has = run.lamps > 0;
    const isPressed = pressed?.target.kind === "lamp";
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x + l.w / 2, l.y + l.h / 2);
    ctx.scale(s, s);
    ctx.translate(-l.w / 2, -l.h / 2);
    if (has) {
      ctx.fillStyle = PAL.keyLip;
      roundRect(ctx, 0, 4, l.w, l.h - 4, 12);
      ctx.fill();
      ctx.fillStyle = PAL.keyTop;
      roundRect(ctx, 0, isPressed ? 3 : 0, l.w, l.h - 4, 12);
      ctx.fill();
      ctx.strokeStyle = rgba(PAL.accent, 0.55 + 0.3 * light.pulse(time, 0.8, { still: 0.6 }));
      ctx.lineWidth = 1.5;
      roundRect(ctx, 0.75, (isPressed ? 3 : 0) + 0.75, l.w - 1.5, l.h - 5.5, 12);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      roundRect(ctx, 0.75, 0.75, l.w - 1.5, l.h - 5.5, 12);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const oy = isPressed ? 3 : 0;
    drawLamp(ctx, 20, oy + (l.h - 4) / 2, 18, has ? PAL.accentHot : PAL.mute, has);
    for (let i = 0; i < TUNE.lampMax; i++) {
      ctx.fillStyle = i < run.lamps ? PAL.accent : "rgba(255,255,255,0.14)";
      ctx.fillRect(38 + i * 9, oy + (l.h - 4) / 2 - 3, 6, 6);
    }
    ctx.restore();
    if (has) drawLabel(ctx, "LAMP", l.x + l.w / 2, l.y + l.h + 7, PAL.dim, 8);
  }

  function drawTag() {
    const y = V.tagY;
    const b = V.board;
    const t = gridTag(run.index, run.puzzle, today);
    if (teaching()) return;
    // In play, the newest message (tier, combo, spark, slip) pops in the band above the grid's tag.
    const line = mode === "play" && !over ? lines.at(-1) : undefined;
    if (line) {
      const k = line.t / line.life;
      const inK = reduced ? 1 : easeOutBack(clamp(line.t / 0.22), 2.4);
      const a = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
      const ly = Math.max(session.play().top + 112, y - 30);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, ly);
      ctx.scale(inK, inK);
      fitLabel(line.text, 0, 0, W - 32, line.color, 14);
      ctx.restore();
    }
    const daily = run.index === 0;
    ctx.save();
    ctx.globalAlpha = mode === "attract" ? 1 : clamp(1 - titleA.value);
    if (daily) {
      ctx.font = monoFont(11);
      const w = ctx.measureText(t.text).width + t.text.length * 0.88;
      drawCalendar(ctx, b.x + b.w / 2 - w / 2 - 10, y, 11, PAL.accent);
      drawLabel(ctx, t.text, b.x + b.w / 2 + 6, y, PAL.accent, 11);
    } else drawLabel(ctx, t.text, b.x + b.w / 2, y, PAL.dim, 11);
    ctx.restore();
  }

  /** A mono label shrunk to fit `maxW`. */
  function fitLabel(text: string, x: number, y: number, maxW: number, color: string, size: number) {
    ctx.save();
    ctx.font = `${size}px ${FONT_MONO}`;
    const w = ctx.measureText(text.toUpperCase()).width + text.length * size * 0.08;
    ctx.restore();
    drawLabel(ctx, text, x, y, color, w > maxW ? Math.max(8, (size * maxW) / w) : size);
  }

  function drawFlies() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of flies) {
      const k = clamp(f.t / f.dur);
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
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = PAL.bgDeep;
      ctx.strokeText(f.text, x, y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function drawBanners() {
    const b = V.board;
    const cy = b.y + b.h * 0.42;
    for (const bn of banners) {
      const k = bn.t / bn.life;
      const inK = reduced ? 1 : easeOutBack(clamp(bn.t / 0.25), 2);
      const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : clamp(bn.t / 0.06);
      ctx.save();
      ctx.globalAlpha = a * 0.82;
      ctx.fillStyle = PAL.bgDeep;
      roundRect(ctx, 16, cy - 44, W - 32, bn.sub ? 92 : 76, 18);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, cy);
      ctx.scale(inK, inK);
      const size = Math.min(50, (W - 56) / (bn.text.length * 0.8));
      ctx.font = `900 ${Math.round(size)}px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.accentDeep;
      ctx.fillText(bn.text, 0, size * 0.08);
      ctx.fillStyle = bn.color;
      ctx.fillText(bn.text, 0, 0);
      ctx.restore();
      if (bn.sub) {
        ctx.globalAlpha = a;
        drawLabel(ctx, bn.sub, W / 2, cy + 34, PAL.paper, 11);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawHud() {
    const top = session.play().top;
    const a = clamp(1 - titleA.value);
    if (a <= 0.01 || mode !== "play") return;
    ctx.globalAlpha = a;
    const s = 1 + scoreBump * 0.12;
    ctx.save();
    ctx.translate(W / 2, top + 34);
    ctx.scale(s, s);
    drawNumber(ctx, Math.round(scoreShown.shown), 0, 0, 44, PAL.paper);
    ctx.restore();
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
    const still = run.phase === "deal" || run.phase === "solved";
    drawLabel(ctx, still && !over ? "CLOCK HELD" : `TIME ${Math.max(0, Math.ceil(run.clock))}S`, x0, y + 18, low ? PAL.heat : PAL.dim, 11, "left");
    const best = Math.max(session.best ?? 0, over ? run.score : 0);
    if (best > 0) drawLabel(ctx, `BEST ${best.toLocaleString("en-US")}`, x0 + bw, y + 18, PAL.mute, 11, "right");
    drawLabel(ctx, `GRID ${run.index + 1}`, W / 2, y + 18, PAL.dim, 11);
    ctx.globalAlpha = 1;
  }

  /** The first-run finger: it presses the easiest key, then its digit, until three right digits are in. */
  const teaching = () => player() && !taught && !over && run.phase === "play" && run.index === 0;

  function drawFirstRunHint() {
    if (!teaching()) return;
    const p = run.nudge();
    if (!p) return;
    const onPad = controls.selected === p.cell;
    const target: Target = onPad ? { kind: "pad", digit: p.digit } : { kind: "key", cell: p.cell };
    const c = targetCenter(target);
    const cyc = (time % 1.4) / 1.4;
    const press = reduced ? 0.5 : cyc < 0.5 ? easeOutCubic(cyc / 0.5) : 1 - easeOutCubic((cyc - 0.5) / 0.5);
    drawFinger(c.x + 10, c.y + 14 - press * 8, cyc);
    const why = p.tech === TECH.fullHouse ? `${p.digit} IS THE ONE MISSING` : p.tech === TECH.nakedSingle ? `ONLY ${p.digit} FITS HERE` : `${p.digit} HAS ONE HOME HERE`;
    const msg = onPad ? `${why} · TAP ${p.digit}` : "TAP A KEY, THEN ITS DIGIT";
    fitLabel(`EVERY ROW, COLUMN AND BOX TAKES 1-${run.n} ONCE`, W / 2, V.tagY - 22, W - 32, PAL.paper, 11);
    fitLabel(msg, W / 2, V.tagY, W - 32, PAL.accentHot, 12);
  }

  function drawFinger(x: number, y: number, cyc: number) {
    if (!reduced && cyc < 0.6) {
      const rk = cyc / 0.6;
      ctx.strokeStyle = rgba(PAL.accent, 0.7 * (1 - rk));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 14 + rk * 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(PAL.accentDeep, 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PAL.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = rgba(PAL.paper, 0.9);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The pilot's taps (attract demo, QA autoplay) show as a fingertip. */
  function drawGhost() {
    if (!ghost) return;
    const k = (time - ghost.t0) / 0.35;
    if (k > 1) return;
    ctx.globalAlpha = 1 - k;
    drawFinger(ghost.x + 8, ghost.y + 10 - (1 - k) * 4, k * 0.6);
    ctx.globalAlpha = 1;
  }

  function drawAttract() {
    const r = safeRect(session.preview(), W, H);
    const a = titleA.value;
    if (a <= 0.01) return;
    const cx = r.x + r.w / 2;
    const ty = attractGeometry(r, run.puzzle.shape).titleY;
    ctx.save();
    ctx.globalAlpha = clamp(a);
    const k = reduced ? 1 : easeOutBack(clamp(time * 1.4));
    ctx.translate(cx, ty);
    ctx.scale(k, k);
    drawTitle(ctx, "ROWLOCK", 0, 0, r.w - 4, PAL.accent, 54, PAL.accentDeep);
    ctx.restore();
    ctx.globalAlpha = clamp(a);
    drawLabel(ctx, "EVERY DIGIT ONCE · BEAT THE CLOCK", cx, ty + 24, rgba(PAL.paper, 0.8), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 44, PAL.accent, 12);
    if (mode === "attract") drawTapPrompt(ctx, cx, r.y + r.h - 14, time, PAL.paper);
    ctx.globalAlpha = 1;
  }

  /** The hint, wrapped to the panel at 11 px (two lines at most; a longer one shrinks). */
  function hintLines(): { lines: string[]; size: number } {
    const box = summaryBox(W, H, session.preview(), session.standalone, 1);
    const text = summary[2] ?? "";
    for (const size of [11, 10]) {
      const lines = wrapWords(text, charsFit(box.w - 28, size));
      if (lines.length <= 2) return { lines, size };
    }
    return { lines: wrapWords(text, charsFit(box.w - 28, 10)).slice(0, 2), size: 10 };
  }

  function drawSummary() {
    if (!over || over.t < 0.9 || !summary.length) return;
    // In the feed the result card covers the top half after the run and the action rail returns on the right: the
    // panel sits just above the caption, gutter to rail, and the board shrinks above it.
    const hint = hintLines();
    const box = summaryBox(W, H, session.preview(), session.standalone, hint.lines.length);
    const { x: x0, y: y0, w, h } = box;
    const a = clamp((over.t - 0.9) / 0.4);
    const cx = x0 + w / 2;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(5,6,8,0.9)";
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = rgba(over.isBest ? PAL.accent : PAL.paper, over.isBest ? 0.5 : 0.08);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.stroke();
    fitLabel(summary[0]!, cx, y0 + 22, w - 28, over.isBest ? PAL.accent : PAL.paper, 13);
    fitLabel(summary[1]!, cx, y0 + 44, w - 28, PAL.dim, 11);
    // A bar of this run against the best.
    const bx = x0 + 18;
    const bw = w - 36;
    const by = y0 + 66;
    const top = Math.max(run.score, over.prev, 1);
    const k = easeOutCubic(clamp((over.t - 1.1) / 0.7));
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, bx, by - 4, bw, 8, 4);
    ctx.fill();
    ctx.fillStyle = over.isBest ? PAL.accentHot : PAL.accent;
    roundRect(ctx, bx, by - 4, Math.max(8, bw * (run.score / top) * k), 8, 4);
    ctx.fill();
    if (over.prev > 0) {
      const mx = bx + bw * (over.prev / top);
      ctx.fillStyle = PAL.paper;
      ctx.fillRect(Math.round(mx) - 1, by - 8, 2, 16);
      drawLabel(ctx, "BEST", Math.min(bx + bw - 14, Math.max(bx + 14, mx)), by + 15, PAL.mute, 8);
    }
    hint.lines.forEach((line, i) => drawLabel(ctx, line, cx, y0 + 98 + i * 16, PAL.accentHot, hint.size));
    ctx.globalAlpha = 1;
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawTapPrompt(ctx, W / 2, y0 - 20, time, PAL.accent, "TAP TO PLAY AGAIN");
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    drawBackground();
    drawBoard();
    drawPad();
    drawMeter();
    fx.draw(ctx);
    drawTag();
    drawFirstRunHint();
    drawGhost();
    ctx.restore();
    flash.draw(ctx, W, H);
    drawAttract();
    drawHud();
    drawFlies();
    // Big banners sit over everything but the game-over panel, so the score flights pass behind them.
    ctx.save();
    ctx.translate(shake.offset.x, shake.offset.y);
    drawBanners();
    ctx.restore();
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
