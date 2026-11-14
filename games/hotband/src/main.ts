import {
  clamp,
  Counter,
  createAudio,
  createCanvas,
  createMusic,
  createRng,
  createSession,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  easeOutCubic,
  FONT_DISPLAY,
  HitStop,
  loadFonts,
  midiToFreq,
  onKeys,
  Particles,
  Photosafe,
  Popups,
  rgba,
  roundRect,
  Shake,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { displayFont, drawFinger, drawGhost, drawMini, drawNoise, drawSeg, drawSlot, monoFont, PAL, ZONE } from "./art.ts";
import { charsFit, COACH, hintFor, SUB, summaryLines, TITLE, wrapWords } from "./copy.ts";
import { Gesture } from "./gesture.ts";
import { attractLayout, playLayout, summaryBox, type Meter } from "./layout.ts";
import { COLS, HIDDEN, ROWS, VISIBLE } from "./pieces.ts";
import { DEMO, Pilot, skillByName } from "./pilot.ts";
import { activeCells, CUT_NAMES, GAIN_NAMES, Run, TUNE, zoneOf, type RunListener } from "./run.ts";
import { heights, NOISE } from "./well.ts";

/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good vite build`); a normal build has none. */
const QA_AUTOPLAY = skillByName(import.meta.env.VITE_AUTOPLAY ?? "") ?? null;

// ---------------------------------------------------------------------------
// Sounds: relay clicks for moves, a thock for a lock, a chord for a cut.
// ---------------------------------------------------------------------------
const TICK: SfxParams = { wave: "sine", freq: 1250, duration: 0.022, volume: 0.1 };
const TURN: SfxParams = { wave: "triangle", freq: 880, freqEnd: 1320, duration: 0.045, volume: 0.16 };
const NOPE: SfxParams = { wave: "triangle", freq: 240, freqEnd: 200, duration: 0.07, volume: 0.14 };
const THOCK: SfxParams = { wave: "sine", freq: 210, freqEnd: 90, duration: 0.08, volume: 0.4, punch: 2.4 };
const SLAM: SfxParams = { wave: "sine", freq: 150, freqEnd: 46, duration: 0.17, volume: 0.62, punch: 2.2 };
const SNAP: SfxParams = { wave: "noise", freq: 2600, freqEnd: 900, duration: 0.05, volume: 0.2, highpass: 700, punch: 2.6 };
const BELL: SfxParams = { wave: "sine", freq: 1318.5, duration: 0.6, volume: 0.15, punch: 1.1 };
const RUMBLE: SfxParams = { wave: "noise", freq: 240, freqEnd: 120, attack: 0.08, duration: 0.5, volume: 0.3, lowpass: 420 };
const HISS: SfxParams = { wave: "noise", freq: 900, freqEnd: 2400, duration: 0.2, volume: 0.24, highpass: 500, punch: 1.6 };
const CLIP: SfxParams = { wave: "sawtooth", freq: 220, freqEnd: 55, duration: 0.7, volume: 0.22, lowpass: 1400, vibrato: [0.5, 11] };
/** A minor pentatonic from A3: a cut plays the next notes up, so a chain climbs. */
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
const BASS = [45, null, 45, null, 48, null, 45, null, 43, null, 43, null, 40, null, 43, 45];
const BASS_BUSY = [45, 45, 57, 45, 48, 48, 60, 48, 43, 43, 55, 43, 40, 40, 52, 45];

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

async function main() {
  const [session] = await Promise.all([createSession({ id: "hotband" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const music = createMusic(audio, { bpm: 116, steps: BASS, wave: "triangle", volume: 0.045, stepsPerBeat: 2 });
  const reduced = session.reducedMotion;
  const fxRng = createRng(session.ctx.seed ^ 0x40b4);
  const shake = new Shake(8, 0.012, 2.2, reduced);
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.18, decay: 0.4 });
  const hitStop = new HitStop();
  const fx = new Particles(600);
  const popups = new Popups();
  const scoreShown = new Counter(0, 14);
  const gesture = new Gesture();

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
  });

  // Player memory: which of the three moves the coach has seen made (bit 0 slide, 1 turn, 2 slam).
  let taught = 0;
  try {
    const v = await tc.storage.get<number>("taught");
    if (typeof v === "number") taught = v & 7;
  } catch {
    /* guest or offline: coach again */
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let over: { t: number; isBest: boolean; ended: boolean; prev: number } | null = null;
  let summary: string[] = [];
  let passedBest = false;
  let banners: Banner[] = [];
  let line: Line | null = null;
  let scoreBump = 0;
  let gainBump = 0;
  let demoOverT = 0;
  let lastDanger = 0;

  // What the meter is doing beyond the grid itself.
  let shownX = 0;
  let turnPop = 0;
  const lockAt = new Float32Array(COLS * ROWS).fill(-9);
  let cutAt = -9;
  let dropAt = -9;
  let dropBy = new Int8Array(ROWS);
  let riseAt = -9;
  let warnAt = -9;
  let tripAt = -9;
  let tripped: Uint8Array | null = null;
  let trail: { x: number; y0: number; y1: number; t0: number }[] = [];
  const peak = new Float32Array(COLS);
  const peakHold = new Float32Array(COLS);

  const demo = new Pilot(DEMO, createRng(session.ctx.seed ^ 0xd3));
  const qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(session.ctx.seed ^ 0x9a)) : null;

  const vol = () => (mode === "attract" ? 0.3 : 1);
  const say = (text: string, color: string = PAL.paper, life = 1.3) => {
    line = { text, color, t: 0, life };
  };
  const banner = (text: string, sub: string, color: string, life = 1.1) => {
    banners = banners.filter((b) => b.t > b.life * 0.6);
    banners.push({ text, sub, color, t: 0, life });
  };

  let M: Meter = attractLayout(W, H, session.preview()).meter;
  const layoutNow = () => (mode === "attract" ? attractLayout(W, H, session.preview()).meter : playLayout(W, H, session.play().top).meter);
  const cellXY = (col: number, row: number) => ({ x: M.x + col * M.cw, y: M.y + (row - HIDDEN) * M.ch });

  const listener: RunListener = {
    spawn() {
      shownX = run.active?.x ?? 0;
    },
    slide() {
      audio.play(TICK, { volume: vol() });
    },
    turn(ok) {
      audio.play(ok ? TURN : NOPE, { volume: vol() });
      if (ok) turnPop = 1;
    },
    lock(e) {
      for (const i of e.cells) lockAt[i] = time;
      const cols = e.cells.map((i) => i % COLS);
      const rows = e.cells.map((i) => Math.floor(i / COLS));
      const cx = M.x + ((Math.min(...cols) + Math.max(...cols) + 1) / 2) * M.cw;
      const by = M.y + (Math.max(...rows) - HIDDEN + 1) * M.ch;
      if (e.slam > 0) {
        audio.play(SLAM, { volume: vol() * (0.7 + Math.min(0.3, e.slam * 0.03)) });
        audio.play(SNAP, { volume: vol() });
        shake.add(0.1 + Math.min(0.16, e.slam * 0.014));
        for (const i of e.cells) {
          const c = cellXY(i % COLS, Math.floor(i / COLS));
          trail.push({ x: c.x, y0: c.y - e.slam * M.ch, y1: c.y, t0: time });
        }
        fx.emit(cx, by, { count: reduced ? 3 : 9, speed: [40, 190], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.18, 0.4], size: [2, 4], colors: [PAL.accent, PAL.accentHot], gravity: 520, drag: 2, shape: "square" });
      } else {
        audio.play(THOCK, { volume: vol() });
      }
    },
    cut(e) {
      cutAt = time;
      const n = e.rows.length;
      const zone = ZONE[zoneOf(e.rows[0]!)]!;
      const midRow = (e.rows[0]! + e.rows[n - 1]!) / 2;
      const y = M.y + (midRow - HIDDEN + 0.5) * M.ch;
      const cx = M.x + M.w / 2;
      // The chord climbs with the chain.
      const base = Math.min(SCALE.length - 3, Math.max(0, e.chain - n));
      for (let i = 0; i < n + 1; i++) {
        const note = midiToFreq(57 + SCALE[Math.min(SCALE.length - 1, base + i)]!);
        schedule(i * 0.055, () => audio.note(note, 0.22, "triangle", 0.2 * vol()));
      }
      if (n >= 2) schedule(0.1, () => audio.play(BELL, { volume: vol(), pitch: n === 3 ? 5 : 0 }));
      popups.add(`+${e.points.toLocaleString("en-US")}`, cx, y, PAL.paper, n >= 2 ? 30 : 24, 0.9);
      scoreBump = 1;
      if (!reduced) {
        for (const r of e.rows) {
          for (let x = 0; x < COLS; x++) {
            const c = cellXY(x, r);
            fx.emit(c.x + M.cw / 2, c.y + M.ch / 2, { count: 3, speed: [40, 220], life: [0.25, 0.6], size: [2, 4], colors: [ZONE[zoneOf(r)]!, PAL.accentHot], gravity: 300, drag: 1.6, shape: "square" });
          }
        }
      }
      hitStop.freeze(n >= 3 ? 0.09 : n === 2 ? 0.06 : 0.025);
      shake.add(0.08 + n * 0.07);
      if (n >= 2) {
        flash.trigger(zone, n === 3 ? 1 : 0.7);
        banner(CUT_NAMES[n]!, `+${e.points.toLocaleString("en-US")}`, zone);
        session.feedback("impact");
      }
      if (e.silence) {
        schedule(0.25, () => {
          banner("SILENCE", `+${(TUNE.silence * e.gain).toLocaleString("en-US")}`, PAL.accentHot, 1.4);
          audio.play("win", { volume: vol() });
          session.feedback("success");
        });
      } else if (e.hot > 0) say(`CUT IN THE RED · +${(e.hot * TUNE.hot * e.gain).toLocaleString("en-US")}`, PAL.red);
      else if (e.noise > 0) say(`NOISE CUT · +${(e.noise * TUNE.noiseCut * e.gain).toLocaleString("en-US")}`, PAL.dim);
    },
    drop(rows) {
      // How far each row of the settled grid fell: one row for every cut row that was below it.
      const cut = new Set(rows);
      dropBy = new Int8Array(ROWS);
      let y = ROWS - 1;
      for (let o = ROWS - 1; o >= 0; o--) {
        if (cut.has(o)) continue;
        dropBy[y] = y - o;
        y--;
      }
      dropAt = time;
      lockAt.fill(-9);
      audio.play(THOCK, { volume: 0.5 * vol(), pitch: -5 });
    },
    tier(gain) {
      gainBump = 1;
      say(`${GAIN_NAMES[gain - 1]} · GAIN ×${gain}`, PAL.accentHot, 1.6);
      audio.play("powerup", { volume: 0.8 * vol(), pitch: (gain - 2) * 2 });
      session.feedback("success");
      if (!reduced) fx.emit(M.x + 30, M.y - 34, { count: 14, speed: [60, 240], life: [0.3, 0.7], size: [2, 5], colors: [PAL.accent, PAL.accentHot], gravity: 240, drag: 1.4, shape: "square" });
    },
    chainEnd() {
      gainBump = -1;
    },
    level(level) {
      if (mode !== "play") return;
      say(`LEVEL ${level} · FASTER`, PAL.accent);
      tc.analytics.track("level_complete", { level: level - 1 });
      audio.play("select", { pitch: Math.min(12, level) });
      music.setSteps(level >= 5 ? BASS_BUSY : BASS);
    },
    noiseWarn() {
      warnAt = time;
      audio.play(RUMBLE, { volume: vol() });
      if (mode === "play" && run.stats.noisePushed === 0) say("THE NOISE FLOOR IS RISING", PAL.dim, 1.8);
    },
    breaker(was) {
      tripped = was;
      tripAt = time;
      lockAt.fill(-9);
      peak.fill(0);
      say("BREAKER TRIPPED · FREE THIS EARLY", PAL.accentHot, 2);
      audio.play(SLAM, { volume: 0.8 * vol(), pitch: -5 });
      audio.play(SNAP, { volume: vol(), pitch: -8 });
      shake.add(0.3);
      session.feedback("impact");
    },
    noise() {
      riseAt = time;
      lockAt.fill(-9);
      audio.play(HISS, { volume: vol() });
      shake.add(0.12);
    },
  };

  let run = new Run(session.ctx.seed, listener).start();
  const later: { at: number; fn: () => void }[] = [];
  function schedule(delay: number, fn: () => void) {
    later.push({ at: time + delay, fn });
  }

  function newRun(seed: number) {
    run = new Run(seed >>> 0, listener).start();
    lockAt.fill(-9);
    cutAt = dropAt = riseAt = warnAt = tripAt = -9;
    tripped = null;
    trail = [];
    peak.fill(0);
    peakHold.fill(0);
    banners = [];
    line = null;
    later.length = 0;
    popups.clear();
    demo.reset();
    qaPilot?.reset();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const playing = () => session.phase === "playing" && mode === "play" && !over && !session.paused;

  function learned(bit: number) {
    if (taught & bit) return;
    taught |= bit;
    if (taught === 7) {
      tc.storage.set("taught", 7).catch(() => undefined);
      tc.analytics.track("tutorial_complete");
    }
  }

  window.addEventListener("pointerdown", (e) => {
    audio.unlock();
    if (!playing() || qaPilot || gesture.active) return;
    gesture.colW = M.cw;
    gesture.press(e.clientX, e.clientY, performance.now(), run);
  });
  window.addEventListener("pointermove", (e) => {
    if (!gesture.active) return;
    if (!playing()) return gesture.cancel(run);
    const r = gesture.move(e.clientX, e.clientY, performance.now(), run);
    if (r === "slide") learned(1);
    else if (r === "slam") learned(4);
  });
  window.addEventListener("pointerup", (e) => {
    if (!gesture.active) return;
    if (!playing()) return gesture.cancel(run);
    if (gesture.release(e.clientX, e.clientY, performance.now(), run) === "turn") learned(2);
  });
  window.addEventListener("pointercancel", () => gesture.cancel(run));
  session.on("cancel", () => gesture.cancel(run));
  session.on("pause", () => gesture.cancel(run));
  onKeys({
    left: () => playing() && run.shift(-1) && learned(1),
    right: () => playing() && run.shift(1) && learned(1),
    up: () => playing() && run.rotate() && learned(2),
    action: () => playing() && run.rotate() && learned(2),
    down: () => {
      if (!playing()) return;
      run.slam();
      learned(4);
    },
  });
  session.startOnTap(window);

  session.on("start", () => {
    mode = "play";
    over = null;
    summary = [];
    passedBest = false;
    scoreShown.snap(0);
    newRun((session.ctx.seed ^ Math.imul(session.runs, 0x9e3779b1)) >>> 0);
    M = layoutNow();
    music.setSteps(BASS);
    music.start();
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
    gesture.cancel(run);
    music.stop();
    scoreShown.set(run.score);
    audio.play(CLIP, { volume: 0.9 });
    audio.play("hit", { volume: 0.5 });
    shake.add(0.4);
    flash.trigger(PAL.red, 0.8);
    banner("CLIPPED", "", PAL.red, 1.3);
    if (isBest) {
      schedule(0.45, () => {
        audio.play("win");
        flash.trigger(PAL.accent, 1);
        if (!reduced) {
          for (let i = 0; i < 6; i++) fx.emit(fxRng.range(W * 0.15, W * 0.85), H * 0.3, { count: 16, speed: [120, 380], life: [0.6, 1.2], size: [3, 7], colors: [PAL.accent, PAL.accentHot, PAL.green, PAL.amber], gravity: 360, drag: 1.2, spin: [-9, 9] });
        }
        banner("NEW BEST", "", PAL.accentHot, 1.6);
      });
    }
    summary = summaryLines(run.score, best, run.stats, hintFor(run.stats));
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    shake.update(rawDt);
    flash.update(rawDt);
    fx.update(dt);
    popups.update(dt);
    scoreShown.set(run.score);
    scoreShown.update(rawDt);
    scoreBump = Math.max(0, scoreBump - rawDt * 4);
    gainBump = gainBump > 0 ? Math.max(0, gainBump - rawDt * 3) : Math.min(0, gainBump + rawDt * 3);
    turnPop = Math.max(0, turnPop - rawDt * 9);
    M = layoutNow();

    if (mode === "attract") {
      if (run.over) {
        demoOverT += dt;
        if (demoOverT > 1.6) {
          demoOverT = 0;
          newRun((session.ctx.seed ^ Math.imul(Math.floor(time * 10) + 7, 0x85ebca6b)) >>> 0);
        }
      } else {
        demo.update(run, dt);
        run.step(dt);
      }
    } else if (!over) {
      if (qaPilot) qaPilot.update(run, dt);
      // A first-timer reading the coach is not idling.
      else if (taught !== 7 && run.time < 7) run.poke();
      run.step(dt);
      if (run.over) endRun();
      const best = session.best;
      if (!passedBest && best !== null && best > 0 && run.score > best && !run.over) {
        passedBest = true;
        say("PAST YOUR BEST", PAL.accentHot, 1.8);
        audio.play("score");
        session.feedback("success");
        if (!reduced) fx.emit(W / 2, session.play().top + 34, { count: 22, speed: [80, 300], life: [0.4, 0.9], size: [2, 6], colors: [PAL.accent, PAL.accentHot], gravity: 260, drag: 1.3, shape: "square" });
      }
    }

    if (run.active) shownX += (run.active.x - shownX) * (1 - Math.exp(-34 * rawDt));

    // Peak-hold markers: each band remembers its highest segment for a moment, then lets it fall.
    const hs = heights(run.well);
    for (let x = 0; x < COLS; x++) {
      const h = Math.min(VISIBLE, hs[x]!);
      if (h >= peak[x]!) {
        peak[x] = h;
        peakHold[x] = 0.9;
      } else if (peakHold[x]! > 0) peakHold[x] = peakHold[x]! - dt;
      else peak[x] = Math.max(h, peak[x]! - 6 * dt);
    }

    const due = later.filter((l) => l.at <= time);
    if (due.length) {
      for (const l of due) later.splice(later.indexOf(l), 1);
      for (const l of due) l.fn();
    }
    for (const b of banners) b.t += rawDt;
    banners = banners.filter((b) => b.t < b.life);
    if (line) {
      line.t += rawDt;
      if (line.t >= line.life) line = null;
    }
    trail = trail.filter((s) => time - s.t0 < 0.2);

    // In the red: a tick a second while the stack is up there.
    if (mode === "play" && !over && run.height() - HIDDEN > VISIBLE - TUNE.redRows && time - lastDanger > 1) {
      lastDanger = time;
      audio.play("tick", { pitch: -7, volume: 0.9 });
    }

    if (over) {
      over.t += rawDt;
      if (!over.ended && over.t > 0.7) {
        over.ended = true;
        const s = run.stats;
        session.end(run.score, { outcome: "lose", stats: { rows: s.rows, chain: s.bestChain, gain: s.bestGain, level: run.level, pieces: s.pieces, seconds: Math.round(s.seconds) } });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawHousing() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    // Brushed panel: a few faint horizontal strokes, steady.
    ctx.fillStyle = "rgba(255,255,255,0.012)";
    for (let y = 7; y < H; y += 23) ctx.fillRect(0, y, W, 1);
    const pad = Math.max(6, M.cw * 0.18);
    const danger = mode === "play" && !over && run.height() - HIDDEN > VISIBLE - TUNE.redRows ? light.pulse(time, 1.4, { still: 0.6 }) : 0;
    ctx.fillStyle = PAL.panel;
    roundRect(ctx, M.x - pad, M.y - pad, M.w + pad * 2, M.h + pad * 2, 12);
    ctx.fill();
    ctx.strokeStyle = danger > 0 ? rgba(PAL.red, 0.25 + 0.5 * danger) : rgba(PAL.accent, 0.3);
    ctx.lineWidth = 1.5;
    roundRect(ctx, M.x - pad, M.y - pad, M.w + pad * 2, M.h + pad * 2, 12);
    ctx.stroke();
    for (let r = 0; r < VISIBLE; r++) for (let x = 0; x < COLS; x++) drawSlot(ctx, M.x + x * M.cw, M.y + r * M.ch, M.cw, M.ch);
    // Where the red begins.
    const ry = M.y + TUNE.redRows * M.ch;
    ctx.fillStyle = rgba(PAL.red, 0.5);
    ctx.fillRect(M.x - pad + 2, ry - 0.75, pad - 3, 1.5);
    ctx.fillRect(M.x + M.w + 1, ry - 0.75, pad - 3, 1.5);
    ctx.fillStyle = rgba(PAL.amber, 0.45);
    const ay = M.y + (TUNE.redRows + TUNE.amberRows) * M.ch;
    ctx.fillRect(M.x - pad + 2, ay - 0.75, pad - 3, 1.5);
    ctx.fillRect(M.x + M.w + 1, ay - 0.75, pad - 3, 1.5);
  }

  function drawStack() {
    const cutK = clamp((time - cutAt) / TUNE.clearPause);
    const cutting = run.cutting ? new Set(run.cutting) : null;
    const dropK = reduced ? 1 : clamp((time - dropAt) / 0.17);
    const riseK = reduced ? 1 : clamp((time - riseAt) / 0.14);
    const rise = (1 - easeOutCubic(riseK)) * M.ch;
    const fade = over ? clamp(over.t / 0.6) : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(M.x - 2, M.y - 2, M.w + 4, M.h + 4);
    ctx.clip();
    for (let row = HIDDEN; row < ROWS; row++) {
      const fall = dropK < 1 ? -dropBy[row]! * M.ch * (1 - easeOutBack(dropK, 1.2)) : 0;
      for (let x = 0; x < COLS; x++) {
        const v = run.well[row * COLS + x];
        if (!v) continue;
        const px = M.x + x * M.cw;
        const py = M.y + (row - HIDDEN) * M.ch + fall + rise;
        const dark = fade > 0 ? 1 - 0.72 * clamp(fade * 1.6 - (row - HIDDEN) / VISIBLE) : 1;
        if (cutting?.has(row)) {
          // The cut runs out from the middle: white-hot first, then the bar closes.
          const k = clamp((cutK - (Math.abs(x - 3.5) / 3.5) * 0.3) / 0.7);
          drawSeg(ctx, px, py, M.cw, M.ch, { color: v === NOISE ? PAL.noise : ZONE[zoneOf(row)]!, hot: clamp(k * 3), sx: reduced ? 1 : 1 - easeOutCubic(clamp((k - 0.35) / 0.65)), alpha: reduced ? 1 - k : 1 });
          continue;
        }
        if (v === NOISE) {
          drawNoise(ctx, px, py, M.cw, M.ch, dark, x * 7 + row * 3);
          continue;
        }
        const age = time - lockAt[row * COLS + x]!;
        const hot = age < 0.16 ? 1 - age / 0.16 : 0;
        drawSeg(ctx, px, py, M.cw, M.ch, { color: ZONE[zoneOf(row)]!, hot, sy: reduced || age > 0.12 ? 1 : 0.8 + 0.2 * (age / 0.12), alpha: dark });
      }
    }
    // What the breaker took: it falls dark from the top row down.
    if (tripped) {
      const tk = (time - tripAt) / 0.6;
      if (tk >= 1) tripped = null;
      else {
        for (let row = HIDDEN; row < ROWS; row++) {
          const a = clamp(1 - (tk * 1.6 - ((row - HIDDEN) / VISIBLE) * 0.6));
          if (a <= 0) continue;
          for (let x = 0; x < COLS; x++) {
            const v = tripped[row * COLS + x];
            if (!v) continue;
            const px = M.x + x * M.cw;
            const py = M.y + (row - HIDDEN) * M.ch;
            if (v === NOISE) drawNoise(ctx, px, py, M.cw, M.ch, a * 0.8, x * 7 + row * 3);
            else drawSeg(ctx, px, py, M.cw, M.ch, { color: ZONE[zoneOf(row)]!, alpha: a * 0.8 });
          }
        }
      }
    }
    // Slam streaks.
    for (const s of trail) {
      const k = (time - s.t0) / 0.2;
      ctx.fillStyle = rgba(PAL.accentHot, 0.22 * (1 - k));
      ctx.fillRect(s.x + M.cw * 0.2, s.y0, M.cw * 0.6, s.y1 - s.y0);
    }
    // Peak hold.
    for (let x = 0; x < COLS; x++) {
      if (peak[x]! <= 0.05) continue;
      const y = M.y + (VISIBLE - peak[x]!) * M.ch + rise;
      ctx.fillStyle = rgba(PAL.accentHot, over ? 0.3 : 0.85);
      ctx.fillRect(M.x + x * M.cw + M.cw * 0.14, Math.round(y) - 1, M.cw * 0.72, 2);
    }
    // The falling piece and where it will land.
    const a = run.active;
    if (a && !over) {
      const gy = run.ghostY();
      const cells = activeCells(a);
      const dx = (shownX - a.x) * M.cw;
      if (gy > a.y) for (const [cx, cy] of cells) drawGhost(ctx, M.x + cx * M.cw, M.y + (cy + gy - a.y - HIDDEN) * M.ch, M.cw, M.ch, 0.5);
      const fy = reduced ? 0 : run.fallK * M.ch;
      const pop = 1 + turnPop * 0.08;
      for (const [cx, cy] of cells) {
        const px = M.x + cx * M.cw + dx;
        const py = M.y + (cy - HIDDEN) * M.ch + fy + rise;
        ctx.save();
        ctx.translate(px + M.cw / 2, py + M.ch / 2);
        ctx.scale(pop, pop);
        drawSeg(ctx, -M.cw / 2, -M.ch / 2, M.cw, M.ch, { color: PAL.paper });
        ctx.restore();
      }
    }
    // The floor warns before it rises.
    const w = time - warnAt;
    if (w >= 0 && w < TUNE.noiseWarn + 0.1 && !over) {
      const k = light.pulse(w, 2, { still: 0.7 });
      ctx.fillStyle = rgba(PAL.dim, 0.18 + 0.3 * k);
      ctx.fillRect(M.x, M.y + M.h - 3, M.w, 3);
    }
    ctx.restore();
  }

  function drawBandLabels(y: number) {
    if (M.cw < 26) return;
    const names = ["63", "125", "250", "500", "1K", "2K", "4K", "8K"];
    for (let x = 0; x < COLS; x++) drawLabel(ctx, names[x]!, M.x + (x + 0.5) * M.cw, y, PAL.mute, 8);
  }

  function drawHud() {
    if (mode !== "play") return;
    const L = playLayout(W, H, session.play().top);
    drawNumber(ctx, scoreShown.shown ? Math.round(scoreShown.shown) : 0, L.score.x, L.score.y, 34 + scoreBump * 5, PAL.paper);
    // Gain, with pips for the rows still to cut before the next tier.
    const g = run.gain;
    const gx = L.gain.x;
    const gy = L.gain.y;
    drawLabel(ctx, "GAIN", gx + 2, gy + 6, PAL.mute, 9, "left");
    ctx.save();
    ctx.font = displayFont(20 + Math.max(0, gainBump) * 6);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = g > 1 ? (run.chainAtRisk ? PAL.amber : PAL.accentHot) : PAL.mute;
    ctx.fillText(`×${g}`, gx, gy + 25);
    ctx.restore();
    const need = run.toNextTier;
    const pips = Math.min(4, need);
    for (let i = 0; i < pips; i++) {
      ctx.fillStyle = run.chain > 0 ? (run.chainAtRisk ? rgba(PAL.amber, 0.9) : rgba(PAL.accent, 0.9)) : rgba(PAL.mute, 0.6);
      ctx.fillRect(gx + 46 + i * 9, gy + 22, 6, 6);
    }
    drawLabel(ctx, `LVL ${run.level} · ${run.stats.rows} ROWS`, L.info.x, L.info.y, PAL.dim, 11);
    // Next piece.
    const nx = L.next;
    drawLabel(ctx, "NEXT", nx.x + nx.w - 2, nx.y + 6, PAL.mute, 9, "right");
    if (!over) drawMini(ctx, run.next, nx.x + nx.w - 30, nx.y + 25, 17, 11, PAL.accent);
    drawBandLabels(L.labelsY);
    // One message at a time.
    const first = taught !== 7 && !over && !qaPilot;
    const coach = first ? COACH[(taught & 1) === 0 ? 0 : (taught & 2) === 0 ? 1 : 2]! : null;
    if (line) {
      const a = clamp(line.t / 0.12) * clamp((line.life - line.t) / 0.25);
      ctx.globalAlpha = a;
      drawLabel(ctx, line.text, L.lane.x, L.lane.y, line.color, 12);
      ctx.globalAlpha = 1;
    } else if (coach) {
      drawLabel(ctx, coach, L.lane.x, L.lane.y, PAL.accentHot, 12);
    }
    if (coach) drawCoach((taught & 1) === 0 ? 0 : (taught & 2) === 0 ? 1 : 2);
  }

  /** A fingertip showing the move the coach is asking for, low on the meter where a thumb rests. */
  function drawCoach(step: number) {
    const cx = M.x + M.w / 2;
    const cy = M.y + M.h * 0.8;
    const k = (time % 1.6) / 1.6;
    if (step === 0) {
      const s = Math.sin(k * Math.PI * 2);
      drawFinger(ctx, cx + s * M.cw * 1.6, cy, 1, 0.8);
    } else if (step === 1) {
      const press = k < 0.25 ? k / 0.25 : k < 0.4 ? 1 - (k - 0.25) / 0.15 : 0;
      drawFinger(ctx, cx, cy, press, 0.8);
    } else {
      const d = k < 0.3 ? easeOutCubic(k / 0.3) : 1;
      drawFinger(ctx, cx, cy - 46 + d * 92, 1, k < 0.5 ? 0.8 : 0.8 * clamp(1 - (k - 0.5) / 0.2));
    }
  }

  function drawBanners() {
    for (const b of banners) {
      const k = b.t / b.life;
      const s = k < 0.18 ? easeOutBack(k / 0.18) : 1;
      const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      const cx = M.x + M.w / 2;
      const cy = M.y + M.h * 0.36;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy);
      ctx.scale(reduced ? 1 : s, reduced ? 1 : s);
      const size = Math.min(34, (M.w - 24) / (b.text.length * 0.78));
      ctx.font = displayFont(size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.bgDeep;
      ctx.fillText(b.text, 0, 3);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, 0);
      if (b.sub) {
        ctx.font = monoFont(13);
        ctx.fillStyle = PAL.paper;
        ctx.fillText(b.sub, 0, size * 0.5 + 14);
      }
      ctx.restore();
    }
  }

  function drawAttract() {
    if (mode !== "attract") return;
    const L = attractLayout(W, H, session.preview());
    drawTitle(ctx, TITLE, L.title.x, L.title.y, L.title.maxW, PAL.accentHot, 44, PAL.accentDeep);
    drawLabel(ctx, SUB, L.sub.x, L.sub.y, PAL.dim, 11);
    if (session.best !== null && session.best > 0) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, L.best.x, L.best.y, PAL.accent, 12);
    drawBandLabels(M.y + M.h + 12);
    ctx.fillStyle = rgba(PAL.bgDeep, 0.78);
    roundRect(ctx, L.prompt.x - 86, L.prompt.y - 13, 172, 26, 13);
    ctx.fill();
    drawTapPrompt(ctx, L.prompt.x, L.prompt.y, time, PAL.accentHot);
  }

  function drawSummary() {
    if (!over || over.t < 0.9 || !summary.length) return;
    const hintSize = 10;
    const pad = 28;
    const probe = summaryBox(W, H, session.preview(), session.standalone, 1);
    const hint = wrapWords(summary[2]!, Math.max(12, charsFit(probe.w - pad, hintSize)));
    const box = summaryBox(W, H, session.preview(), session.standalone, hint.length);
    const { x: x0, y: y0, w, h } = box;
    const a = clamp((over.t - 0.9) / 0.4);
    const cx = x0 + w / 2;
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(6,7,9,0.92)";
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = rgba(over.isBest ? PAL.accentHot : PAL.accent, over.isBest ? 0.6 : 0.16);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.stroke();
    fitLabel(summary[0]!, cx, y0 + 20, w - pad, over.isBest ? PAL.accentHot : PAL.paper, 13);
    fitLabel(summary[1]!, cx, y0 + 40, w - pad, PAL.dim, 11);
    hint.forEach((text, i) => drawLabel(ctx, text, cx, y0 + 62 + i * 16, PAL.accent, hintSize));
    ctx.globalAlpha = 1;
    if (session.standalone && session.phase === "over" && session.phaseTime > 0.8) drawTapPrompt(ctx, W / 2, y0 + h + 20, time, PAL.accentHot, "TAP TO PLAY AGAIN");
  }

  /** A label shrunk to fit its plate. */
  function fitLabel(text: string, x: number, y: number, maxW: number, color: string, size: number) {
    const fit = Math.min(size, Math.floor(maxW / (text.length * 0.68)));
    drawLabel(ctx, text, x, y, color, Math.max(8, fit));
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    drawHousing();
    drawStack();
    fx.draw(ctx);
    popups.draw(ctx, FONT_DISPLAY);
    ctx.restore();
    flash.draw(ctx, W, H);
    drawAttract();
    drawHud();
    ctx.save();
    ctx.translate(o.x, o.y);
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
