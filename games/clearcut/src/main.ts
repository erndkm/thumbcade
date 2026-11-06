import {
  clamp,
  Counter,
  createAudio,
  createCanvas,
  createRng,
  createSession,
  damp,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  FONT_DISPLAY,
  HitStop,
  lerp,
  loadFonts,
  midiToFreq,
  mix,
  onDrag,
  Particles,
  PENTATONIC,
  Photosafe,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BlockSprites, PAL, TONES } from "./art.ts";
import { bestMove, canFit, cut, deal, fits, fullLines, isEmpty, linesIf, N, newBoard, place, type Cells, type Lines, type Shape } from "./board.ts";

// ---------------------------------------------------------------------------
// Tuning: the fuse
// ---------------------------------------------------------------------------
const FUSE_START = 18;
const FUSE_MAX = 24;
/** Burn rate (fuse seconds per second) climbs with time survived. */
const drain = (elapsed: number) => 0.6 + elapsed / 35;
/** Fuse bought back by a cut: more for multi-line cuts and live streaks. */
const refill = (lines: number, streak: number) => 4.5 * lines + 2.5 * (lines - 1) + 0.6 * Math.min(6, streak - 1);
const CLEARCUT_FUSE = 5;
const CLEARCUT_POINTS = 300;
/** Points for cutting n lines at once, before the streak multiplier. */
const LINE_POINTS = [0, 10, 30, 60, 100, 150, 210, 280, 360, 450];
const MAX_MULT = 8;
/** How long one blade takes to cross the board (s). */
const SWEEP = 0.24;
/** Difficulty 0..1 for the piece mix. */
const mixAt = (elapsed: number) => Math.min(1, Math.floor(elapsed / 7) / 10);

const THOCK: SfxParams = { wave: "sine", freq: 230, freqEnd: 82, duration: 0.11, volume: 0.55, punch: 2.2 };
const SNAP: SfxParams = { wave: "square", freq: 1900, duration: 0.02, volume: 0.1, highpass: 1200 };
const LIFT: SfxParams = { wave: "triangle", freq: 520, freqEnd: 780, duration: 0.06, volume: 0.22 };

interface TrayPiece {
  shape: Shape;
  tone: number;
  /** When it slides into its slot. */
  born: number;
  fitsNow: boolean;
  /** Spring-back after a rejected drop: where it was released (CSS px) and when. */
  back: { x: number; y: number; s: number; t: number } | null;
}

interface Drag {
  slot: number;
  /** Finger. */
  fx: number;
  fy: number;
  /** Drawn center, chasing the target. */
  vx: number;
  vy: number;
  /** 0 = tray size, 1 = board size. */
  grow: number;
}

interface Ghost {
  r: number;
  c: number;
  lines: Lines;
}

interface Dying {
  r: number;
  c: number;
  tone: number;
  at: number;
  popped: boolean;
}

interface Blade {
  kind: "row" | "col";
  index: number;
  t0: number;
}

interface Layout {
  bx: number;
  by: number;
  size: number;
  cell: number;
  trayTop: number;
  trayBottom: number;
  trayCell: number;
}

/** The kit's popups with a dark drop shadow under each one, so they read over bright blocks too. */
function drawPopupsShadowed(ctx: CanvasRenderingContext2D, popups: Popups, font: string, shadow: string): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of popups.items) {
    const k = p.t / p.life;
    const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1.1 - Math.min(0.1, (k - 0.15) * 0.4);
    const size = Math.round(p.size * pop);
    const y = p.y - k * 40;
    ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = shadow;
    ctx.fillText(p.text, p.x, y + Math.max(2, size * 0.09));
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  ctx.globalAlpha = 1;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "clearcut" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  /** Cosmetics and the demo player. */
  const rng = createRng(session.ctx.seed ^ 0x51ed27);
  /** The tray dealer: reseeded per run, so a run's deals depend only on the seed and the moves made. */
  let dealer = createRng(session.ctx.seed);
  const shake = new Shake(11, 0.022, 1.9, session.reducedMotion);
  // Every flash and pulse goes through Photosafe: capped at 2 Hz, faint or still under reduced motion.
  const light = new Photosafe(session.reducedMotion);
  const flash = light.flash({ alpha: 0.2, decay: 0.35 });
  const ALARM_HZ = 1.8;
  const hitStop = new HitStop();
  const fx = new Particles(900);
  const popups = new Popups();
  const counter = new Counter(0, 16);
  const layoutT = new Spring(0, 170, 24);
  const sprites = new BlockSprites(view.dpr);

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
    sprites.setDpr(view.dpr);
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let board: Cells = newBoard();
  const born = new Float32Array(N * N).fill(-10);
  let tray: Array<TrayPiece | null> = [null, null, null];
  let drag: Drag | null = null;
  let ghost: Ghost | null = null;
  let dying: Dying[] = [];
  let blades: Blade[] = [];
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let elapsed = 0;
  let score = 0;
  let streak = 0;
  /** Placements since the last cut. The streak survives one dry drop and breaks on the second. */
  let dry = 0;
  let fuse = FUSE_START;
  let over: { t: number; reason: string } | null = null;
  let endSent = false;
  let titleIn = 0;
  let lastWarn = 0;
  let placed = 0;
  let linesCut = 0;
  let bestCut = 0;
  let clearcuts = 0;
  let fuseBump = 0;
  /** The attract-mode demo player. */
  const ai = { phase: "wait" as "wait" | "carry" | "wipe", t: 1.1, slot: 0, r: 0, c: 0 };

  // ---------------------------------------------------------------------------
  // Layout: attract (smaller, inside the preview safe area) ↔ play (full width)
  // ---------------------------------------------------------------------------
  function attractLayout(): Layout {
    const r = safeRect(session.preview(), W, H);
    const top = r.y + 116;
    const bottom = r.y + r.h - 52;
    const avail = Math.max(120, bottom - top);
    const size = Math.min(r.w - 8, avail / 1.34, 330);
    const trayH = size * 0.3;
    const by = top + Math.max(0, (avail - size - trayH) * 0.5);
    return { bx: r.x + (r.w - size) / 2, by, size, cell: size / N, trayTop: by + size + 8, trayBottom: by + size + 8 + trayH, trayCell: (size / N) * 0.56 };
  }

  function playLayout(): Layout {
    const top = session.play().top;
    const by = top + 106;
    const size = Math.max(160, Math.min(W - 28, H - by - 200, 440));
    const trayTop = by + size + 14;
    const trayBottom = Math.max(trayTop + 100, H - 12);
    const cell = size / N;
    const slotW = size / 3;
    return { bx: (W - size) / 2, by, size, cell, trayTop, trayBottom, trayCell: Math.min(cell * 0.58, (slotW - 14) / 5, (trayBottom - trayTop - 16) / 5) };
  }

  let L: Layout = attractLayout();
  function layout(): Layout {
    const a = attractLayout();
    const p = playLayout();
    const k = clamp(layoutT.value, 0, 1.06);
    const size = lerp(a.size, p.size, k);
    return {
      bx: lerp(a.bx, p.bx, k),
      by: lerp(a.by, p.by, k),
      size,
      cell: size / N,
      trayTop: lerp(a.trayTop, p.trayTop, k),
      trayBottom: lerp(a.trayBottom, p.trayBottom, k),
      trayCell: lerp(a.trayCell, p.trayCell, k),
    };
  }

  const cellCenter = (r: number, c: number) => ({ x: L.bx + (c + 0.5) * L.cell, y: L.by + (r + 0.5) * L.cell });
  function slotCenter(i: number): { x: number; y: number } {
    const w = L.size / 3;
    return { x: L.bx + w * (i + 0.5), y: (L.trayTop + L.trayBottom) / 2 };
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  function refreshFits() {
    for (const p of tray) if (p) p.fitsNow = canFit(board, p.shape);
  }

  function refillTray(assist?: number) {
    const src = mode === "play" ? dealer : rng;
    const shapes = deal(board, src, mode === "play" ? mixAt(elapsed) : 0.35, assist);
    tray = shapes.map((shape, i) => ({ shape, tone: src.int(0, TONES.length - 1), born: time + i * 0.07, fitsNow: true, back: null }));
    refreshFits();
  }

  /** Fills the demo board by playing a few silent moves, so attract opens mid-game. */
  function presim() {
    board = newBoard();
    born.fill(-10);
    refillTray();
    const steps = rng.int(7, 10);
    for (let i = 0; i < steps; i++) {
      const m = bestMove(board, tray.map((p) => p?.shape ?? null), 18, rng);
      if (!m) break;
      const p = tray[m.slot]!;
      place(board, p.shape, m.r, m.c, p.tone + 1);
      tray[m.slot] = null;
      cut(board, fullLines(board));
      if (tray.every((t) => !t)) refillTray();
    }
    // Open on a full tray with a cut on offer, so the demo's first move pays off.
    refillTray(1);
    for (const p of tray) if (p) p.born = time;
  }

  /** Every block pops off in a diagonal wave (new run, or the demo running out of room). */
  function wipe() {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const tone = board[r * N + c]!;
        if (tone) dying.push({ r, c, tone, at: time + 0.02 + (r + c) * 0.025, popped: false });
      }
    board = newBoard();
  }

  function commit(slot: number, r: number, c: number, byPlayer: boolean) {
    const piece = tray[slot];
    if (!piece) return;
    tray[slot] = null;
    const s = piece.shape;
    place(board, s, r, c, piece.tone + 1);
    for (const [dr, dc] of s.cells) born[(r + dr) * N + c + dc] = time;
    const center = cellCenter(r + s.rows / 2 - 0.5, c + s.cols / 2 - 0.5);
    audio.play(THOCK, { pitch: 4 - s.cells.length * 0.6 + rng.range(-0.5, 0.5), volume: byPlayer ? 1 : 0.7 });
    audio.play(SNAP);
    fx.emit(center.x, center.y, { count: 6 + s.cells.length * 2, speed: [40, 150], life: [0.2, 0.45], size: [2, 4], colors: [TONES[piece.tone]!.fill, PAL.paper], drag: 4, spread: L.cell * 0.8 });
    shake.add(0.05);
    if (byPlayer) {
      score += s.cells.length;
      placed++;
      session.feedback("tap");
    }

    const lines = fullLines(board);
    const n = lines.rows.length + lines.cols.length;
    if (n > 0) {
      streak = dry <= 1 && streak > 0 ? streak + 1 : 1;
      dry = 0;
      const cuts = cut(board, lines);
      for (const k of cuts) dying.push({ r: k.r, c: k.c, tone: k.tone, at: time + 0.02 + k.order * SWEEP, popped: false });
      lines.rows.forEach((i, j) => blades.push({ kind: "row", index: i, t0: time + j * 0.035 }));
      lines.cols.forEach((i, j) => blades.push({ kind: "col", index: i, t0: time + j * 0.035 }));
      // Score popup at the middle of what was cut.
      let sx = 0;
      let sy = 0;
      for (const k of cuts) {
        const p = cellCenter(k.r, k.c);
        sx += p.x;
        sy += p.y;
      }
      sx /= cuts.length;
      sy /= cuts.length;
      const mult = Math.min(MAX_MULT, streak);
      const pts = LINE_POINTS[Math.min(n, LINE_POINTS.length - 1)]! * mult;
      const clean = isEmpty(board);
      for (let i = 0; i < n; i++) {
        const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.min(8, streak - 1) + i)]!;
        window.setTimeout(() => audio.note(midiToFreq(67 + step), 0.18, "triangle", 0.24), i * 55);
      }
      audio.play("slice", { pitch: Math.min(6, n * 1.5), volume: 0.8 });
      shake.add(n === 1 ? 0.16 : n === 2 ? 0.3 : 0.44);
      if (n >= 2) hitStop.freeze(n >= 3 ? 0.07 : 0.04);
      if (byPlayer) {
        score += pts;
        linesCut += n;
        bestCut = Math.max(bestCut, n);
        const gain = refill(n, streak);
        fuse = Math.min(FUSE_MAX, fuse + gain + (clean ? CLEARCUT_FUSE : 0));
        fuseBump = 1;
        popups.add(`+${gain.toFixed(1)}s`, L.bx + 128, session.play().top + 76, PAL.accent, 15, 0.8);
        popups.add(`+${pts}`, sx, sy, PAL.paper, n >= 2 ? 34 : 28, 0.9);
        if (n >= 2) {
          popups.add(n === 2 ? "DOUBLE CUT" : n === 3 ? "TRIPLE CUT" : `${n}× CUT`, sx, sy - 34, PAL.accent, n >= 3 ? 24 : 20, 1);
          audio.play("powerup", { volume: 0.7, pitch: n * 2 });
        }
        if (streak >= 2) popups.add(`STREAK ×${mult}`, W / 2, L.by + L.size + 2, PAL.accent, 20, 1);
        if (n >= 3) flash.trigger(PAL.accent, 0.8);
        session.feedback(n >= 2 ? "success" : "impact");
      }
      if (clean) {
        if (byPlayer) {
          score += CLEARCUT_POINTS;
          clearcuts++;
          popups.add("CLEARCUT", L.bx + L.size / 2, L.by + L.size / 2 - 10, PAL.accent, 44, 1.4);
          popups.add(`+${CLEARCUT_POINTS}`, L.bx + L.size / 2, L.by + L.size / 2 + 34, PAL.paper, 26, 1.3);
          if (clearcuts === 1) tc.analytics.track("milestone", { clearcut: 1 });
        }
        audio.play("win");
        flash.trigger(PAL.paper, 1);
        shake.add(0.5);
        for (let i = 0; i < 4; i++) {
          const p = { x: L.bx + rng.range(0.15, 0.85) * L.size, y: L.by + rng.range(0.15, 0.85) * L.size };
          fx.emit(p.x, p.y, { count: 22, speed: [80, 360], life: [0.4, 0.9], size: [3, 7], colors: [PAL.accent, PAL.paper, TONES[2]!.fill], drag: 2, spin: [-8, 8] });
        }
      }
    } else {
      dry++;
      if (dry >= 2) streak = 0;
    }

    if (tray.every((p) => !p)) refillTray();
    else refreshFits();
    if (!tray.some((p) => p?.fitsNow)) {
      if (mode === "play") gameOver("NO ROOM");
      else {
        ai.phase = "wipe";
        ai.t = 1.0;
      }
    }
  }

  function gameOver(reason: string) {
    if (over) return;
    over = { t: 0, reason };
    if (drag) returnPiece();
    ghost = null;
    shake.add(0.5);
    hitStop.freeze(0.1);
    audio.play("lose");
    tc.feedback("fail");
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const tone = board[r * N + c];
        if (!tone) continue;
        const p = cellCenter(r, c);
        fx.emit(p.x, p.y, { count: 3, speed: [30, 140], life: [0.4, 0.9], size: [2, 5], colors: [TONES[tone - 1]!.fill], gravity: 520, drag: 1 });
      }
  }

  // ---------------------------------------------------------------------------
  // Input: a tap starts a run (release); during a run, drag pieces from the tray.
  // The press that starts a run happens in attract, so it can never pick up a piece.
  // ---------------------------------------------------------------------------
  function trayPos(slot: number, p: TrayPiece): { x: number; y: number; s: number } {
    const home = slotCenter(slot);
    if (!p.back) return { x: home.x, y: home.y, s: L.trayCell };
    const k = easeOutBack(clamp((time - p.back.t) / 0.32), 1.4);
    return { x: lerp(p.back.x, home.x, k), y: lerp(p.back.y, home.y, k), s: lerp(p.back.s, L.trayCell, clamp(k)) };
  }

  /** Where the dragged piece wants to be: lifted above the finger so the thumb never hides it. */
  function dragTarget(d: Drag, s: Shape): { x: number; y: number } {
    return { x: d.fx, y: d.fy - (s.rows * L.cell) / 2 - L.cell * 1.25 };
  }

  function findGhost(s: Shape, cx: number, cy: number): Ghost | null {
    const fc = (cx - (s.cols * L.cell) / 2 - L.bx) / L.cell;
    const fr = (cy - (s.rows * L.cell) / 2 - L.by) / L.cell;
    let best: Ghost | null = null;
    let bestD = 0.75;
    for (let r = Math.round(fr) - 1; r <= Math.round(fr) + 1; r++)
      for (let c = Math.round(fc) - 1; c <= Math.round(fc) + 1; c++) {
        const d = Math.hypot(r - fr, c - fc);
        if (d < bestD && fits(board, s, r, c)) {
          bestD = d;
          best = { r, c, lines: { rows: [], cols: [] } };
        }
      }
    if (best) best.lines = linesIf(board, s, best.r, best.c);
    return best;
  }

  function returnPiece() {
    if (!drag) return;
    const p = tray[drag.slot];
    if (p) p.back = { x: drag.vx, y: drag.vy, s: lerp(L.trayCell, L.cell, drag.grow), t: time };
    drag = null;
    ghost = null;
  }

  onDrag(window, {
    start(x, y) {
      if (session.phase !== "playing" || mode !== "play" || over || drag) return;
      if (y < L.trayTop - 20) return;
      const slot = clamp(Math.floor((x - L.bx) / (L.size / 3)), 0, 2);
      const p = tray[slot];
      if (!p || time < p.born) return;
      const pos = trayPos(slot, p);
      p.back = null;
      drag = { slot, fx: x, fy: y, vx: pos.x, vy: pos.y, grow: 0 };
      audio.play(LIFT, { pitch: rng.range(-1, 1) });
      session.feedback("tap");
    },
    move(x, y) {
      if (!drag) return;
      drag.fx = x;
      drag.fy = y;
    },
    end(_x, _y, cancelled) {
      if (!drag) return;
      const g = ghost;
      if (!cancelled && g && !over) {
        const slot = drag.slot;
        drag = null;
        ghost = null;
        commit(slot, g.r, g.c, true);
      } else {
        // Over the board but nowhere it fits: a soft knock as it springs home.
        if (!cancelled && drag.vy < L.by + L.size) audio.play("error", { volume: 0.45 });
        returnPiece();
      }
    },
  });
  session.on("cancel", returnPiece);
  session.startOnTap(window);
  session.on("start", () => {
    mode = "play";
    over = null;
    endSent = false;
    score = 0;
    streak = 0;
    dry = 0;
    fuse = FUSE_START;
    elapsed = 0;
    placed = 0;
    linesCut = 0;
    bestCut = 0;
    clearcuts = 0;
    counter.snap(0);
    drag = null;
    ghost = null;
    wipe();
    dealer = createRng((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    refillTray();
    for (const p of tray) if (p) p.born += 0.25;
    layoutT.target = 1;
    audio.play("select");
  });

  presim();

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function updateAttract(dt: number) {
    ai.t -= dt;
    if (ai.phase === "wipe") {
      if (ai.t <= 0) {
        wipe();
        refillTray();
        ai.phase = "wait";
        ai.t = 0.9;
      }
      return;
    }
    if (ai.phase === "wait") {
      if (ai.t > 0) return;
      const m = bestMove(board, tray.map((p) => p?.shape ?? null), 10, rng);
      if (!m) {
        ai.phase = "wipe";
        ai.t = 0.2;
        return;
      }
      ai.phase = "carry";
      ai.t = 0;
      ai.slot = m.slot;
      ai.r = m.r;
      ai.c = m.c;
      return;
    }
    // carry: ai.t counts down from 0, so -ai.t is the time spent carrying.
    if (-ai.t >= 0.62) {
      ghost = null;
      commit(ai.slot, ai.r, ai.c, false);
      if (ai.phase === "carry") {
        ai.phase = "wait";
        ai.t = rng.range(0.3, 0.55);
      }
    } else if (-ai.t > 0.3) {
      const p = tray[ai.slot];
      if (p) ghost = { r: ai.r, c: ai.c, lines: linesIf(board, p.shape, ai.r, ai.c) };
    }
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(dt);
    popups.update(rawDt);
    layoutT.update(rawDt);
    L = layout();
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    fuseBump = Math.max(0, fuseBump - rawDt * 3);
    counter.set(score);
    counter.update(rawDt);

    // Cut cells pop when the blade reaches them.
    for (const d of dying) {
      if (d.popped || time < d.at) continue;
      d.popped = true;
      const p = cellCenter(d.r, d.c);
      const tone = TONES[d.tone - 1]!;
      fx.emit(p.x, p.y, { count: 5, speed: [60, 260], life: [0.3, 0.7], size: [2.5, 6], colors: [tone.fill, tone.lip, PAL.paper], gravity: 420, drag: 1.4, spin: [-10, 10] });
    }
    dying = dying.filter((d) => time < d.at + 0.3);
    blades = blades.filter((b) => time < b.t0 + SWEEP + 0.2);

    if (drag) {
      const p = tray[drag.slot];
      if (!p) drag = null;
      else {
        const t = dragTarget(drag, p.shape);
        drag.vx = damp(drag.vx, t.x, 30, rawDt);
        drag.vy = damp(drag.vy, t.y, 30, rawDt);
        drag.grow = damp(drag.grow, 1, 18, rawDt);
        ghost = findGhost(p.shape, t.x, t.y);
      }
    }

    if (mode === "attract") {
      updateAttract(dt);
      return;
    }
    if (over) {
      over.t += rawDt;
      if (!endSent && over.t > 0.4) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { seconds: Math.round(elapsed), lines: linesCut, pieces: placed, bestCut } });
      }
      return;
    }
    elapsed += dt;
    fuse -= drain(elapsed) * dt;
    if (fuse < 4 && time - lastWarn > 0.5) {
      lastWarn = time;
      audio.play("tick", { pitch: 12 - fuse * 3 });
    }
    if (rng.chance(0.75)) {
      const p = fuseTip();
      fx.emit(p.x, p.y, { count: 1, speed: [30, 120], life: [0.2, 0.5], size: [2, 3.5], colors: [fuse < 4 ? PAL.heat : PAL.accent, PAL.paper, "#FFD84D"], gravity: 240, drag: 1 });
    }
    if (fuse <= 0) {
      fuse = 0;
      gameOver("FUSE OUT");
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const fuseY = () => L.by - 16;
  function fuseTip() {
    return { x: L.bx + L.size * clamp(fuse / FUSE_MAX), y: fuseY() };
  }

  function drawBackground() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);
    const cx = L.bx + L.size / 2;
    const cy = L.by + L.size / 2;
    const low = mode === "play" && fuse < 4 && !over;
    const glow = ctx.createRadialGradient(cx, cy, L.size * 0.1, cx, cy, L.size * 1.15);
    glow.addColorStop(0, rgba(low ? PAL.heat : PAL.accent, low ? 0.05 + 0.08 * light.pulse(time, ALARM_HZ, { still: 0.5 }) : 0.1));
    glow.addColorStop(1, rgba(PAL.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    // The cutting mat: the board's grid runs on, faintly, across the whole screen.
    const step = L.cell;
    if (step < 4) return;
    const x0 = L.bx - Math.ceil(L.bx / step) * step;
    const y0 = L.by - Math.ceil(L.by / step) * step;
    ctx.fillStyle = "rgba(166,242,61,0.035)";
    for (let x = x0, i = 0; x < W; x += step, i++) ctx.fillRect(Math.round(x), 0, 1, H);
    for (let y = y0; y < H; y += step) ctx.fillRect(0, Math.round(y), W, 1);
    ctx.fillStyle = "rgba(166,242,61,0.07)";
    for (let x = x0; x < W; x += step) for (let y = y0; y < H; y += step) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  }

  function drawFuse() {
    const y = fuseY();
    const f = clamp(fuse / FUSE_MAX);
    const low = fuse < 4 && !over;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(ctx, L.bx, y - 2, L.size, 4, 2);
    ctx.fill();
    if (f <= 0) return;
    const color = low ? mix(PAL.heat, "#FF9F6E", light.pulse(time, ALARM_HZ)) : PAL.accent;
    ctx.fillStyle = color;
    const thick = 4 + fuseBump * 3;
    roundRect(ctx, L.bx, y - thick / 2, L.size * f, thick, thick / 2);
    ctx.fill();
    const tip = fuseTip();
    const g = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 20);
    g.addColorStop(0, rgba(low ? PAL.heat : PAL.accent, 0.85));
    g.addColorStop(1, rgba(PAL.accent, 0));
    ctx.fillStyle = g;
    ctx.fillRect(tip.x - 20, tip.y - 20, 40, 40);
    ctx.fillStyle = PAL.paper;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 2.6 + 2 * light.pulse(time, 2, { still: 0.5 }), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBoard() {
    const { bx, by, size, cell } = L;
    const pad = cell * 0.16;
    const rad = cell * 0.36;
    ctx.fillStyle = PAL.boardLip;
    roundRect(ctx, bx - pad, by - pad + 7, size + pad * 2, size + pad * 2, rad);
    ctx.fill();
    ctx.fillStyle = PAL.board;
    roundRect(ctx, bx - pad, by - pad, size + pad * 2, size + pad * 2, rad);
    ctx.fill();
    const block = cell * 0.9;
    const inset = (cell - block) / 2;
    ctx.fillStyle = PAL.slot;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        roundRect(ctx, bx + c * cell + inset, by + r * cell + inset, block, block, block * 0.16);
        ctx.fill();
      }
    // Placed blocks: they land with a little squash.
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const tone = board[r * N + c]!;
        if (!tone) continue;
        const age = time - born[r * N + c]!;
        const k = age < 0.22 ? 1 + 0.14 * Math.sin(clamp(age / 0.22) * Math.PI) * (1 - age / 0.22) : 1;
        const p = cellCenter(r, c);
        const dim = over ? clamp(over.t * 3) * 0.5 : 0;
        ctx.globalAlpha = 1 - dim;
        sprites.draw(ctx, tone - 1, p.x, p.y, block * k);
      }
    ctx.globalAlpha = 1;
  }

  /** Where the dragged piece would land, and the lines it would cut. */
  function drawGhost() {
    const g = ghost;
    if (!g) return;
    const p = drag ? tray[drag.slot] : tray[ai.slot];
    if (!p) return;
    const { cell } = L;
    const block = cell * 0.9;
    const pulse = light.pulse(time, 1.6, { still: 0.6 });
    // Lines this drop would complete light up in the accent.
    if (g.lines.rows.length + g.lines.cols.length) {
      ctx.fillStyle = rgba(PAL.accent, 0.16 + 0.14 * pulse);
      for (const r of g.lines.rows) {
        roundRect(ctx, L.bx + 2, L.by + r * cell + 2, L.size - 4, cell - 4, cell * 0.2);
        ctx.fill();
      }
      for (const c of g.lines.cols) {
        roundRect(ctx, L.bx + c * cell + 2, L.by + 2, cell - 4, L.size - 4, cell * 0.2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.38;
    for (const [dr, dc] of p.shape.cells) {
      const c = cellCenter(g.r + dr, g.c + dc);
      sprites.draw(ctx, p.tone, c.x, c.y, block);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(PAL.accent, 0.7);
    ctx.lineWidth = 2;
    for (const [dr, dc] of p.shape.cells) {
      const c = cellCenter(g.r + dr, g.c + dc);
      roundRect(ctx, c.x - block / 2 + 1, c.y - block / 2 + 1, block - 2, block - 2, block * 0.16);
      ctx.stroke();
    }
  }

  function drawCuts() {
    const block = L.cell * 0.9;
    for (const d of dying) {
      const p = cellCenter(d.r, d.c);
      if (time < d.at) {
        ctx.globalAlpha = 1;
        sprites.draw(ctx, d.tone - 1, p.x, p.y, block);
        continue;
      }
      const k = clamp((time - d.at) / 0.3);
      ctx.globalAlpha = 1 - k;
      sprites.draw(ctx, d.tone - 1, p.x, p.y, block * (1 + 0.35 * easeOutCubic(k)));
      ctx.fillStyle = PAL.paper;
      ctx.globalAlpha = (1 - k) * 0.7;
      roundRect(ctx, p.x - block / 2, p.y - block / 2, block, block, block * 0.16);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The blades: a hot line racing along each cut row or column, with a fading wake.
    for (const b of blades) {
      const k = (time - b.t0) / SWEEP;
      if (k < 0) continue;
      const head = clamp(k);
      const fade = k > 1 ? 1 - clamp((k - 1) / 0.8) : 1;
      const len = L.size * head;
      const across = L.cell * 0.9;
      ctx.save();
      if (b.kind === "row") ctx.translate(L.bx, L.by + (b.index + 0.5) * L.cell);
      else {
        ctx.translate(L.bx + (b.index + 0.5) * L.cell, L.by);
        ctx.rotate(Math.PI / 2);
      }
      const wake = ctx.createLinearGradient(len - L.size * 0.6, 0, len, 0);
      wake.addColorStop(0, rgba(PAL.accent, 0));
      wake.addColorStop(1, rgba(PAL.accent, 0.5 * fade));
      ctx.fillStyle = wake;
      ctx.fillRect(Math.max(0, len - L.size * 0.6), -across / 2, Math.min(len, L.size * 0.6), across);
      ctx.fillStyle = rgba(PAL.paper, 0.95 * fade);
      ctx.fillRect(0, -1.5, len, 3);
      if (k <= 1) {
        ctx.fillStyle = PAL.paper;
        ctx.fillRect(len - 3, -across * 0.7, 6, across * 1.4);
        const g = ctx.createRadialGradient(len, 0, 0, len, 0, across);
        g.addColorStop(0, rgba(PAL.accent, 0.8));
        g.addColorStop(1, rgba(PAL.accent, 0));
        ctx.fillStyle = g;
        ctx.fillRect(len - across, -across, across * 2, across * 2);
      }
      ctx.restore();
    }
  }

  function drawPiece(p: TrayPiece, cx: number, cy: number, cell: number, alpha: number, shadow: boolean) {
    const s = p.shape;
    const block = cell * 0.9;
    const x0 = cx - (s.cols * cell) / 2;
    const y0 = cy - (s.rows * cell) / 2;
    if (shadow) {
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      for (const [r, c] of s.cells) {
        roundRect(ctx, x0 + c * cell + (cell - block) / 2 + 5, y0 + r * cell + (cell - block) / 2 + 9, block, block, block * 0.16);
        ctx.fill();
      }
    }
    ctx.globalAlpha = alpha;
    for (const [r, c] of s.cells) sprites.draw(ctx, p.tone, x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, block);
    ctx.globalAlpha = 1;
  }

  function drawTray() {
    // Three faint pads anchor the pieces under the board.
    const padW = L.size / 3 - 10;
    const padH = Math.min(L.trayBottom - L.trayTop - 8, padW);
    for (let i = 0; i < 3; i++) {
      const c = slotCenter(i);
      const active = !!drag && drag.slot === i;
      ctx.fillStyle = active ? rgba(PAL.accent, 0.06) : "rgba(255,255,255,0.025)";
      roundRect(ctx, c.x - padW / 2, c.y - padH / 2, padW, padH, Math.min(18, padW * 0.16));
      ctx.fill();
    }
    tray.forEach((p, i) => {
      if (!p || (drag && drag.slot === i)) return;
      if (mode === "attract" && ai.phase === "carry" && ai.slot === i) return;
      const k = clamp((time - p.born) / 0.32);
      if (k <= 0) return;
      const pos = trayPos(i, p);
      const slide = (1 - easeOutBack(k)) * 70;
      drawPiece(p, pos.x + slide, pos.y, pos.s, k * (p.fitsNow ? 1 : 0.28), false);
    });
  }

  function drawCarried() {
    if (drag) {
      const p = tray[drag.slot];
      if (p) drawPiece(p, drag.vx, drag.vy, lerp(L.trayCell, L.cell, drag.grow), 1, true);
    }
    if (mode === "attract" && ai.phase === "carry") {
      const p = tray[ai.slot];
      if (!p) return;
      const k = easeInOutCubic(clamp(-ai.t / 0.62));
      const from = slotCenter(ai.slot);
      const to = cellCenter(ai.r + p.shape.rows / 2 - 0.5, ai.c + p.shape.cols / 2 - 0.5);
      const arc = Math.sin(k * Math.PI) * L.cell * 1.6;
      drawPiece(p, lerp(from.x, to.x, k), lerp(from.y, to.y, k) - arc, lerp(L.trayCell, L.cell, clamp(k * 1.6)), 1, true);
    }
  }

  function drawHud() {
    const top = session.play().top;
    const a = clamp(layoutT.value);
    ctx.globalAlpha = a;
    drawNumber(ctx, Math.round(counter.shown), W / 2, top + 42, 46, PAL.paper);
    const low = fuse < 4 && !over;
    drawLabel(ctx, `FUSE ${fuse.toFixed(1)}S`, L.bx, top + 78, low ? PAL.heat : PAL.dim, 11, "left");
    drawLabel(ctx, `BEST ${Math.max(session.best ?? 0, score).toLocaleString("en-US")}`, L.bx + L.size, top + 78, PAL.mute, 11, "right");
    if (streak >= 2 && !over) drawLabel(ctx, `STREAK ×${Math.min(MAX_MULT, streak)}`, W / 2, top + 78, dry ? rgba(PAL.accent, 0.45) : PAL.accent, 11);
    else if (placed === 0 && !over && elapsed < 6) drawLabel(ctx, "DRAG A PIECE", W / 2, top + 78, PAL.accent, 11);
    ctx.globalAlpha = 1;
  }

  function drawAttract() {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(titleIn);
    const ty = r.y + 58;
    ctx.save();
    ctx.translate(cx, ty);
    ctx.scale(k, k);
    drawTitle(ctx, "CLEARCUT", 0, 0, r.w - 8, PAL.accent, 60, PAL.accentDeep);
    ctx.restore();
    drawLabel(ctx, "FILL THE LINE · CUT IT CLEAN", cx, ty + 26, rgba(PAL.paper, 0.78), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 46, PAL.accent, 13);
    drawTapPrompt(ctx, cx, r.y + r.h - 22, time, PAL.paper);
  }

  function drawOver() {
    if (!over) return;
    const a = clamp(over.t * 4);
    const s = 1 + 0.25 * (1 - easeOutBack(clamp(over.t * 3)));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(L.bx + L.size / 2, L.by + L.size / 2);
    ctx.scale(s, s);
    ctx.font = `900 ${Math.round(L.size * 0.12)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PAL.bgDeep;
    ctx.fillText(over.reason, 0, 5);
    ctx.fillStyle = over.reason === "FUSE OUT" ? PAL.heat : PAL.paper;
    ctx.fillText(over.reason, 0, 0);
    ctx.restore();
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.7) {
      // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
      drawTapPrompt(ctx, W / 2, (L.trayTop + L.trayBottom) / 2, time, PAL.accent, "TAP TO CUT AGAIN");
    }
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    drawBackground();
    if (mode === "play") drawFuse();
    drawBoard();
    drawGhost();
    drawCuts();
    if (!(over && session.standalone && session.phaseTime > 0.7)) drawTray();
    drawCarried();
    fx.draw(ctx);
    drawPopupsShadowed(ctx, popups, FONT_DISPLAY, PAL.bgDeep);
    ctx.restore();
    flash.draw(ctx, W, H);
    if (mode === "attract") drawAttract();
    else {
      drawHud();
      drawOver();
    }
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
