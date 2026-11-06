import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic } from "@thumbcade-games/kit/ease";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createSession } from "@thumbcade-games/kit/session";
import { Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { LANES, MIN_L, setList } from "./chart.ts";
import { Fx, type Ink } from "./fx.ts";
import { PAPER, Press, RISO } from "./riso.ts";
import { LIVES, Pilot, Run, SHOWMAN, SKILLS } from "./sim.ts";
import { SONGS } from "./songs.ts";
import { createSound, type Voice } from "./sound.ts";
import { display, loadType, small, spaced, spacedWidth } from "./type.ts";

/** The strike line, as a fraction of the screen height. */
const LINE = 0.76;
const TAU = Math.PI * 2;
const INKS: Ink[] = ["blue", "red", "yellow"];
/** Played tiles a first-time player gets the ghost finger for. */
const HINT_HITS = 6;
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=expert vite build`), to record and measure it. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

interface Summary {
  score: number;
  isBest: boolean;
  prevBest: number | null;
  won: boolean;
  cleared: number;
  combo: number;
  perfectPct: number;
  tip: string;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "halftune", restartDelayMs: 900 }), loadType()]);
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
  } catch {
    /* storage unavailable: show the hint */
  }
  const view = createCanvas({ maxDpr: 2, background: PAPER });
  const press = new Press({
    paper: PAPER,
    inks: [
      { name: "blue", color: RISO.blue, angle: 0.26 },
      { name: "red", color: RISO.brightRed, angle: 1.31 },
      { name: "yellow", color: RISO.yellow, angle: 0.79 },
    ],
    grain: 0.42,
    slip: 1.3,
    cell: 3.4,
    scale: 0.9,
  });
  const { ctx } = view;
  const reduced = session.reducedMotion;
  const light = new Photosafe(reduced);
  const shake = new Shake(9, 0, 2.2, reduced);
  const sound = createSound();
  const fx = new Fx();
  fx.reduced = reduced;

  // --- layout ------------------------------------------------------------------------------------
  let W = view.width;
  let H = view.height;
  let u = 1;
  let lineY = 0;
  let side = 0;
  let laneW = 0;
  function layout(): void {
    u = clamp(Math.min(W / 390, H / 760), 0.85, 1.5);
    lineY = Math.round(H * LINE);
    side = Math.round(8 * u);
    laneW = (W - side * 2) / LANES;
  }
  press.resize(W, H, view.dpr);
  layout();
  view.onResize((w, h) => {
    W = w;
    H = h;
    press.resize(w, h, view.dpr);
    layout();
  });
  const laneX = (lane: number) => side + lane * laneW;
  const laneCx = (lane: number) => side + (lane + 0.5) * laneW;

  // --- runs ------------------------------------------------------------------------------------
  let mode: "attract" | "run" = "attract";
  const seedFor = (n: number) => (session.ctx.seed ^ Math.imul(n, 7919)) >>> 0;
  let demo = newDemo();
  let demoPilot = new Pilot(SHOWMAN, 1);
  let run: Run | null = null;
  let qaPilot: Pilot | null = null;
  let time = 0;
  let overT = -1;
  let ended = false;
  let veil = 0;
  let summary: Summary | null = null;
  let bestAtStart: number | null = null;
  let bestFired = false;
  let hits = 0;
  const voices = new Map<number, Voice>();

  // Presentation state.
  const laneGlow = new Float32Array(LANES);
  const laneRed = new Float32Array(LANES);
  let bump = 0;
  let scorePunch = 0;
  let shownScore = 0;
  let slam: { text: string; t: number } | null = null;
  let stamp: { text: string; sub: string; t: number; big: boolean } | null = null;
  let bestT = -1;
  let lifeT = -1;

  function newDemo(): Run {
    // The livelier tunes, a little faster than in a run: the feed should see the roll busy.
    const pool = ["minuet", "elise", "cancan", "mountain"];
    const id = pool[Math.floor(Math.random() * pool.length)]!;
    return new Run({ seed: Math.floor(Math.random() * 1e9), set: [id], demo: true, leadIn: 0.5, leads: [1.1] });
  }

  function resetPresentation(): void {
    for (const v of voices.values()) v.stop(false);
    voices.clear();
    laneGlow.fill(0);
    laneRed.fill(0);
    fx.clear();
    slam = null;
    stamp = null;
    bestT = -1;
    lifeT = -1;
    shownScore = 0;
  }

  function startRun(): void {
    mode = "run";
    resetPresentation();
    run = new Run({ seed: seedFor(session.runs) });
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, 77) : null;
    bestAtStart = session.best;
    bestFired = false;
    overT = -1;
    ended = false;
    summary = null;
    hits = 0;
    press.register(session.runs + 1);
    veil = Math.max(veil, 0.5);
    sound.start();
    sound.card();
  }

  // --- input -------------------------------------------------------------------------------------
  let frameAt = performance.now();
  // Registered before startOnTap: the tap that starts a run is never a press.
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (mode !== "run" || !run || run.over || session.phase !== "playing" || session.paused) return;
    const x = e.clientX;
    const y = e.clientY;
    const f = (x - side) / laneW;
    const lane = clamp(Math.floor(f), 0, LANES - 1);
    const frac = f - Math.floor(f);
    const lanes = [lane];
    if (frac < 0.3 && lane > 0 && f >= 0) lanes.push(lane - 1);
    else if (frac > 0.7 && lane < LANES - 1 && f < LANES) lanes.push(lane + 1);
    const at = run.S + (lineY - y) / lineY;
    const ahead = (Math.max(0, e.timeStamp - frameAt) / 1000) * run.pace;
    run.press(e.pointerId, lanes, at, ahead);
    handle(run, true, x, y);
  });
  const lift = (e: PointerEvent) => {
    if (run && mode === "run") {
      run.release(e.pointerId);
      handle(run, true);
    }
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  const dropAll = () => {
    if (run && mode === "run") {
      run.releaseAll();
      handle(run, true);
    }
  };
  session.on("cancel", dropAll);
  session.on("pause", dropAll);
  session.startOnTap(window);
  session.on("start", startRun);

  // --- events → sound, fx --------------------------------------------------------------------------
  function handle(r: Run, live: boolean, tx = -1, ty = -1): void {
    const lv = live ? 1 : 0.5;
    for (const e of r.events) {
      switch (e.k) {
        case "hit": {
          const tl = e.tile;
          const x = laneCx(tl.lane);
          const v = sound.note(tl.midi, tl.chord, e.judge, tl.hold, lv);
          if (v && tl.hold) voices.set(tl.id, v);
          laneGlow[tl.lane] = 1;
          bump = Math.min(1.4, bump + 0.35);
          const perfect = e.judge === "perfect";
          fx.spray(x, lineY, perfect ? 12 : 7, (perfect ? 380 : 260) * u, u, perfect ? ["yellow", "red", "red"] : ["red", "blue"]);
          fx.ring(x, lineY, laneW * 0.22, laneW * (perfect ? 0.66 : 0.5), (perfect ? 5 : 3) * u, perfect ? "red" : "blue", perfect ? 0.4 : 0.28);
          if (live) {
            scorePunch = 1;
            hits++;
            if (!hintSeen && hits >= HINT_HITS) {
              hintSeen = true;
              tc.storage.set("hint", true).catch(() => undefined);
            }
            const py = lineY - 40 * u;
            if (perfect) fx.pop("PERFECT", x, py, 11 * u, "red", 0.5, 30 * u);
            else if (e.judge === "early") fx.pop("EARLY", x, py, 10 * u, "blue", 0.45, 22 * u);
            else if (e.judge === "late") fx.pop("LATE", x, py, 10 * u, "blue", 0.45, 22 * u);
            if (perfect || tl.hold) session.feedback("tap");
          }
          break;
        }
        case "holdEnd": {
          const v = voices.get(e.tile.id);
          if (v) v.stop(e.full);
          voices.delete(e.tile.id);
          if (e.full) {
            const x = laneCx(e.tile.lane);
            fx.ring(x, lineY, laneW * 0.3, laneW * 0.95, 5 * u, "yellow", 0.5);
            fx.spray(x, lineY, 10, 320 * u, u, ["yellow", "red"]);
            if (live) fx.pop(`+${e.points}`, x, lineY - 48 * u, 12 * u, "red", 0.6, 30 * u);
          }
          break;
        }
        case "miss": {
          const tl = e.tile;
          laneRed[tl.lane] = 1;
          if (live) {
            sound.miss();
            shake.add(0.5);
            session.feedback("impact");
            fx.pop("MISS", laneCx(tl.lane), lineY - 30 * u, 13 * u, "red", 0.7, 26 * u);
          }
          break;
        }
        case "wrong": {
          const x = tx >= 0 ? tx : laneCx(e.lane);
          const y = ty >= 0 ? ty : lineY;
          laneRed[e.lane] = 0.7;
          if (live) {
            sound.wrong();
            shake.add(0.42);
            session.feedback("impact");
            // A smudge where the thumb landed.
            for (let i = 0; i < 7; i++) fx.dot(x + (Math.random() - 0.5) * 26 * u, y + (Math.random() - 0.5) * 26 * u, 0, 0, (5 + Math.random() * 7) * u, "red", 0.55 + Math.random() * 0.3);
            fx.pop("OOPS", x, y - 30 * u, 12 * u, "red", 0.6, 24 * u);
          }
          break;
        }
        case "mult":
          if (live) {
            slam = { text: `×${e.mult}`, t: time };
            sound.mult(e.mult);
            session.feedback("success");
            fx.ring(W / 2, H * 0.4, W * 0.2, W * 0.7, 7 * u, "red", 0.7);
            fx.ring(W / 2, H * 0.4, W * 0.1, W * 0.5, 4 * u, "blue", 0.6);
          }
          break;
        case "life":
          if (live && e.delta < 0) lifeT = time;
          break;
        case "clear":
          if (live) {
            const next = r.chart.plays[e.slot + 1];
            stamp = {
              text: e.clean ? "CLEAN!" : "CLEAR",
              sub: [e.clean ? `+${e.bonus}` : "", e.life ? "♥ BACK" : ""].filter(Boolean).join("  ·  "),
              t: time,
              big: false,
            };
            sound.clear(e.clean);
            session.feedback("success");
            fx.spray(W / 2, H * 0.36, 26, 420 * u, u);
            if (next) sound.card();
          }
          break;
        case "encore":
          if (live) {
            stamp = { text: "ENCORE!", sub: `+${e.bonus}`, t: time, big: true };
            sound.encore();
            session.feedback("success");
            fx.confetti(W, H, 150, u);
            for (let i = 0; i < 4; i++) fx.ring(W / 2, H * 0.4, W * (0.1 + i * 0.08), W * (0.6 + i * 0.16), (8 - i) * u, i % 2 ? "blue" : "red", 0.8 + i * 0.25);
            bump = 1.4;
          }
          break;
        case "die":
          if (live) {
            sound.end();
            shake.add(0.4);
          }
          for (const v of voices.values()) v.stop(false);
          voices.clear();
          break;
      }
    }
    r.events.length = 0;
  }

  // --- update ------------------------------------------------------------------------------------
  function update(dt: number): void {
    session.tick(dt);
    time += dt;
    frameAt = performance.now();
    veil = Math.max(0, veil - dt * 1.6);
    shake.update(dt);
    bump = Math.max(0, bump - dt * 4);
    scorePunch = Math.max(0, scorePunch - dt * 4);
    for (let i = 0; i < LANES; i++) {
      laneGlow[i] = Math.max(0, laneGlow[i]! - dt * 5.5);
      laneRed[i] = Math.max(0, laneRed[i]! - dt * 2.4);
    }

    if (mode === "attract") {
      demoPilot.play(demo);
      demo.step(dt);
      handle(demo, false);
      if (demo.over) {
        veil = Math.min(1, veil + dt * 5);
        if (veil >= 0.98) {
          demo = newDemo();
          demoPilot = new Pilot(SHOWMAN, Math.floor(Math.random() * 1e6));
          resetPresentation();
        }
      }
    } else if (run) {
      if (session.phase === "playing" && !session.paused) {
        if (qaPilot) qaPilot.play(run);
        run.step(dt);
        handle(run, true);
        // Held notes sparkle at the line.
        for (const id of voices.keys()) {
          const tl = run.tiles[id];
          if (tl && Math.random() < dt * 30) fx.spray(laneCx(tl.lane), lineY, 1, 220 * u, u, ["red", "yellow"], 0.8);
        }
      }
      if (run.over && overT < 0) overT = time;
      if (run.over && !ended && time - overT >= (run.won ? 0.95 : 0.8)) {
        ended = true;
        const s = run.stats;
        const hitsN = s.perfect + s.great + s.early + s.late;
        const prevBest = session.best;
        const res = session.end(run.score, {
          outcome: run.won ? "win" : "lose",
          stats: { tunes: s.cleared, combo: s.bestCombo, perfect: hitsN ? Math.round((100 * s.perfect) / hitsN) : 0, misses: s.misses + s.wrongs },
        });
        summary = {
          score: run.score,
          isBest: res.isBest,
          prevBest,
          won: run.won,
          cleared: s.cleared,
          combo: s.bestCombo,
          perfectPct: hitsN ? Math.round((100 * s.perfect) / hitsN) : 0,
          tip: tipFor(run),
        };
      }
      // Score counts up; a new best mid-run is a moment.
      if (shownScore < run.score) shownScore = Math.min(run.score, shownScore + Math.max(1, (run.score - shownScore) * dt * 12));
      if (!bestFired && bestAtStart !== null && bestAtStart > 0 && run.score > bestAtStart && session.phase === "playing") {
        bestFired = true;
        bestT = time;
        sound.best();
        session.feedback("success");
      }
    }
    fx.update(dt);
  }

  function tipFor(r: Run): string {
    const s = r.stats;
    const hitsN = s.perfect + s.great + s.early + s.late;
    if (r.won) return "Encore! Now chase perfects: they pay three times as much.";
    if (s.wrongs > s.misses) return "Tap where the ink is. Near the red line, the right lane always counts.";
    if (s.misses > 0 && s.early > s.late * 2) return "Wait for the ink to reach the red line. Early taps rush the tune.";
    if (s.holds > 0 && s.holdsFull < s.holds * 0.6) return "Keep holding long notes until they run out: they pay extra.";
    if (hitsN && s.perfect / hitsN < 0.35) return "Tap as the ink meets the red line for a perfect.";
    if (s.misses > 0) return "Keep your eyes just above the line, where the next tile comes from.";
    return "Every clean tune pays a bonus and gives a life back.";
  }

  // --- drawing helpers ---------------------------------------------------------------------------
  let shakeX = 0;
  let shakeY = 0;
  /** A plate with the camera shake applied. */
  function world(ink: Ink): CanvasRenderingContext2D {
    const c = press.plate(ink);
    if (shakeX || shakeY) press.transform(c, 1, 0, 0, 1, shakeX, shakeY);
    return c;
  }

  function knockout(x: number, y: number, w: number, h: number, r: number): void {
    for (const ink of INKS) {
      const c = press.plate(ink);
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.beginPath();
      c.roundRect(x, y, w, h, r);
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
  }

  /** An eighth note cut out of the ink (paper shows through). `open`: a hollow head for long notes. */
  function noteGlyph(c: CanvasRenderingContext2D, x: number, y: number, s: number, open: boolean): void {
    c.save();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    c.beginPath();
    c.ellipse(x - s * 0.17, y + s * 0.3, s * 0.27, s * 0.19, -0.42, 0, TAU);
    if (open) {
      c.ellipse(x - s * 0.17, y + s * 0.3, s * 0.15, s * 0.08, -0.42, 0, TAU, true);
    }
    c.fill("evenodd");
    c.fillRect(x + s * 0.05, y - s * 0.55, s * 0.085, s * 0.86);
    if (!open) {
      c.beginPath();
      c.moveTo(x + s * 0.13, y - s * 0.55);
      c.quadraticCurveTo(x + s * 0.52, y - s * 0.3, x + s * 0.38, y + s * 0.0);
      c.quadraticCurveTo(x + s * 0.4, y - s * 0.22, x + s * 0.13, y - s * 0.3);
      c.fill();
    }
    c.restore();
  }

  function doublePrint(text: string, x: number, y: number, font: string, track: number, a: Ink, b: Ink, off: number, level = 1): void {
    const ca = press.plate(a);
    ca.fillStyle = level >= 1 ? press.solid(a) : press.screen(a, level);
    spaced(ca, text, x, y, font, track);
    const cb = press.plate(b);
    cb.fillStyle = level >= 1 ? press.solid(b) : press.screen(b, level);
    spaced(cb, text, x + off, y + off * 0.6, font, track);
  }

  /** A capsule of solid ink with the word knocked out. */
  function capsule(ink: Ink, word: string, x: number, y: number, size = 12.5): void {
    const breathe = light.pulse(time, 0.5, { still: 0.5 });
    const font = small(size * u);
    const track = 4.2 * u;
    const tw = spacedWidth(press.plate(ink), word, font, track);
    const w = tw + 34 * u + breathe * 6 * u;
    const h = (size + 17.5) * u;
    knockout(x - w / 2, y - h / 2, w, h, h / 2);
    const c = press.plate(ink);
    c.fillStyle = press.solid(ink);
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    spaced(c, word, x + track / 2, y + size * 0.36 * u, font, track);
    c.globalCompositeOperation = "source-over";
  }

  function registrationMark(x: number, y: number, r: number): void {
    for (const ink of INKS) {
      const c = press.plate(ink);
      c.strokeStyle = press.solid(ink);
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.moveTo(x - r * 1.6, y);
      c.lineTo(x + r * 1.6, y);
      c.moveTo(x, y - r * 1.6);
      c.lineTo(x, y + r * 1.6);
      c.stroke();
    }
  }

  // --- the sheet ---------------------------------------------------------------------------------
  /** The record behind the roll: concentric halftone discs that swell a little with every note. */
  function drawRecord(r: Run): void {
    const cx = W / 2;
    const cy = H * 0.4;
    const R = W * 0.54 * (1 + 0.025 * Math.min(1, bump) * (reduced ? 0.3 : 1));
    const heat = Math.min(4, r.mult - 1);
    const y = world("yellow");
    y.fillStyle = press.screen("yellow", 0.16 + heat * 0.05);
    y.beginPath();
    y.arc(cx, cy, R, 0, TAU);
    y.fill();
    y.fillStyle = press.screen("yellow", 0.32 + heat * 0.06);
    y.beginPath();
    y.arc(cx, cy, R * 0.64, 0, TAU);
    y.fill();
    const rr = world("red");
    // The label in the middle of the record; a combo prints over it instead.
    if (r.combo < 5 || mode !== "run") {
      rr.fillStyle = press.screen("red", 0.22 + heat * 0.04);
      rr.beginPath();
      rr.arc(cx, cy, R * 0.2, 0, TAU);
      rr.fill();
    }
    rr.strokeStyle = press.screen("red", 0.35);
    rr.lineWidth = 1.2 * u;
    for (let i = 0; i < 3; i++) {
      rr.beginPath();
      rr.arc(cx, cy, R * (0.74 + i * 0.08), 0, TAU);
      rr.stroke();
    }
  }

  function drawLanes(top: number): void {
    const b = world("blue");
    b.fillStyle = press.screen("blue", 0.4);
    for (let i = 1; i < LANES; i++) b.fillRect(Math.round(laneX(i)) - 0.75 * u, top, 1.5 * u, H - top);
    // The press bed under the line: late ink lands here.
    b.fillStyle = press.screen("blue", 0.11);
    b.fillRect(0, lineY, W, H - lineY);
    const rd = world("red");
    for (let i = 0; i < LANES; i++) {
      if (laneRed[i]! > 0.01) {
        rd.fillStyle = press.screen("red", 0.2 * laneRed[i]!);
        rd.fillRect(laneX(i), top, laneW, H - top);
      }
    }
  }

  function drawLine(): void {
    const rd = world("red");
    rd.fillStyle = press.solid("red");
    rd.fillRect(side, lineY - 2 * u, W - side * 2, 4 * u);
    const y = world("yellow");
    for (let i = 0; i < LANES; i++) {
      const g = laneGlow[i]!;
      if (g > 0.02) {
        y.fillStyle = press.screen("yellow", Math.min(1, g * 1.3));
        const h = 34 * u * (0.6 + 0.4 * g);
        y.fillRect(laneX(i) + 2 * u, lineY - h / 2, laneW - 4 * u, h);
      }
      y.fillStyle = press.solid("yellow");
      y.beginPath();
      y.arc(laneCx(i), lineY, 3.4 * u, 0, TAU);
      y.fill();
    }
  }

  let drawFrom = 0;
  let drawRun: Run | null = null;
  function clipAll(y0: number, y1: number): void {
    for (const ink of INKS) {
      const c = press.plate(ink);
      c.save();
      c.beginPath();
      c.rect(-20, y0, W + 40, y1 - y0);
      c.clip();
    }
  }
  function unclipAll(): void {
    for (const ink of INKS) press.plate(ink).restore();
  }

  function drawTiles(r: Run, top: number): void {
    if (top > 0) clipAll(top, H + 20);
    drawTilesIn(r, top);
    if (top > 0) unclipAll();
  }

  function drawTilesIn(r: Run, top: number): void {
    if (drawRun !== r) {
      drawRun = r;
      drawFrom = 0;
    }
    const tiles = r.tiles;
    const S = r.S;
    const pad = 4 * u;
    const rad = 9 * u;
    const blue = world("blue");
    const red = world("red");
    const yel = world("yellow");
    while (drawFrom < tiles.length && lineY - (tiles[drawFrom]!.P + tiles[drawFrom]!.L - S) * lineY > H + 4) drawFrom++;
    let hintTile = -1;
    if (!hintSeen && mode === "run") {
      for (let i = drawFrom; i < tiles.length; i++) {
        if (r.state[i] === 0) {
          hintTile = i;
          break;
        }
      }
    }
    for (let i = drawFrom; i < tiles.length; i++) {
      const tl = tiles[i]!;
      const yHead = lineY - (tl.P - S) * lineY;
      if (yHead < top) break;
      const yTop = yHead - tl.L * lineY;
      if (yTop > H) continue;
      const x = laneX(tl.lane) + pad;
      const w = laneW - pad * 2;
      const h = yHead - yTop;
      const st = r.state[i]!;
      if (st === 0 || st === 1) {
        if (i === hintTile) {
          // The next tile for a first-timer: a yellow halo around the ink.
          yel.fillStyle = press.solid("yellow");
          yel.beginPath();
          yel.roundRect(x - 5 * u, yTop - 5 * u, w + 10 * u, h + 10 * u, rad + 5 * u);
          yel.fill();
        }
        // Live ink sits on bare paper: no yellow under it (blue over yellow would print green).
        yel.globalCompositeOperation = "destination-out";
        yel.fillStyle = "#000";
        yel.beginPath();
        yel.roundRect(x, yTop, w, h, rad);
        yel.fill();
        yel.globalCompositeOperation = "source-over";
      }
      if (st === 0) {
        if (tl.hold) drawHold(blue, red, x, w, yTop, yHead, rad, false);
        else {
          blue.fillStyle = press.solid("blue");
          blue.beginPath();
          blue.roundRect(x, yTop, w, h, rad);
          blue.fill();
          noteGlyph(blue, x + w / 2, yTop + h / 2, Math.min(w, h) * 0.42, false);
        }
      } else if (st === 1) {
        drawHold(blue, red, x, w, yTop, yHead, rad, true);
      } else if (st === 2) {
        const age = r.now - r.hitAt[i]!;
        if (tl.hold) {
          red.fillStyle = press.screen("red", 0.22);
          red.beginPath();
          red.roundRect(x, yTop, w, h, rad);
          red.fill();
        } else if (age < 0.26 && !reduced) {
          const k = age / 0.26;
          const grow = 1 + 0.14 * easeOutCubic(k);
          const cx = x + w / 2;
          const cy = yTop + h / 2;
          blue.fillStyle = press.screen("blue", 1 - k);
          blue.beginPath();
          blue.roundRect(cx - (w * grow) / 2, cy - (h * grow) / 2, w * grow, h * grow, rad);
          blue.fill();
          red.fillStyle = press.screen("red", 0.6 * (1 - k));
          red.beginPath();
          red.roundRect(cx - (w * grow) / 2, cy - (h * grow) / 2, w * grow, h * grow, rad);
          red.fill();
        } else {
          // The imprint a played note leaves on the sheet.
          blue.fillStyle = press.screen("blue", 0.12);
          blue.beginPath();
          blue.roundRect(x, yTop, w, h, rad);
          blue.fill();
        }
      } else {
        // Missed: smudged.
        red.fillStyle = press.screen("red", 0.55);
        red.beginPath();
        red.roundRect(x + 4 * u, yTop, w, h, rad);
        red.fill();
        blue.fillStyle = press.screen("blue", 0.3);
        blue.beginPath();
        blue.roundRect(x - 2 * u, yTop + 3 * u, w, h, rad);
        blue.fill();
      }
    }
  }

  function drawHold(blue: CanvasRenderingContext2D, red: CanvasRenderingContext2D, x: number, w: number, yTop: number, yHead: number, rad: number, held: boolean): void {
    const headH = Math.min(yHead - yTop, MIN_L * lineY * 0.7);
    // Body: a halftone column with a solid stem.
    blue.fillStyle = press.screen("blue", 0.42);
    blue.beginPath();
    blue.roundRect(x, yTop, w, yHead - yTop, rad);
    blue.fill();
    blue.fillStyle = press.solid("blue");
    blue.fillRect(x + w / 2 - w * 0.06, yTop + rad, w * 0.12, yHead - yTop - rad);
    blue.beginPath();
    blue.roundRect(x, yHead - headH, w, headH, rad);
    blue.fill();
    if (!held) {
      blue.save();
      blue.globalCompositeOperation = "destination-out";
      blue.fillStyle = "#000";
      spaced(blue, "HOLD", x + w / 2 + 1 * u, yHead - headH / 2 + 5.5 * u, display(16 * u), 2 * u);
      blue.restore();
    }
    if (held) {
      // The ink turns red as it runs through the press.
      const yFill = Math.max(yTop, Math.min(yHead, lineY));
      red.fillStyle = press.solid("red");
      red.beginPath();
      red.roundRect(x, yFill, w, yHead - yFill, rad);
      red.fill();
      const yy = world("yellow");
      yy.fillStyle = press.solid("yellow");
      yy.fillRect(x, lineY - 3 * u, w, 6 * u);
    }
  }

  // --- HUD -----------------------------------------------------------------------------------------
  function hudTop(): number {
    return session.play().top + 6 * u;
  }

  function drawHud(r: Run): void {
    const top = hudTop();
    // Score tag, top middle: paper knocked out of every plate, the score double-printed in it.
    const tw = Math.min(W * 0.46, 190 * u);
    const th = 58 * u;
    const tx = W / 2 - tw / 2;
    knockout(tx, top, tw, th, 10 * u);
    const punch = 1 + easeOutCubic(scorePunch) * 0.08;
    doublePrint(String(Math.floor(shownScore)), W / 2, top + 31 * u, display(34 * u * punch), 1.5 * u, "blue", "red", 1.6 * u);
    // Tune progress: one segment per tune.
    const n = r.chart.plays.length;
    const gw = tw - 28 * u;
    const seg = gw / n;
    const by = top + 37 * u;
    const b = press.plate("blue");
    const rd = press.plate("red");
    for (let k = 0; k < n; k++) {
      const p = r.chart.plays[k]!;
      const sx = tx + 14 * u + k * seg + 2 * u;
      const sw = seg - 4 * u;
      b.fillStyle = press.screen("blue", 0.35);
      b.fillRect(sx, by, sw, 5 * u);
      const f = k < r.slot ? 1 : k === r.slot ? clamp((r.now - p.start) / (p.end - p.start)) : 0;
      if (f > 0) {
        const pc = k < r.slot ? b : rd;
        pc.fillStyle = k < r.slot ? press.solid("blue") : press.solid("red");
        pc.fillRect(sx, by, sw * f, 5 * u);
      }
    }
    const play = r.chart.plays[Math.min(r.slot, n - 1)]!;
    b.fillStyle = press.solid("blue");
    const name = `${play.song.title} · ${play.song.composer}`;
    let ns = 8.5;
    while (ns > 6.5 && spacedWidth(b, name, small(ns * u), 2 * u) > tw - 20 * u) ns -= 0.25;
    spaced(b, name, W / 2, by + 15 * u, small(ns * u), 2 * u);

    // Lives, top left.
    const lx = side + 8 * u;
    const lw = 76 * u;
    knockout(lx - 6 * u, top, lw, 34 * u, 10 * u);
    for (let i = 0; i < LIVES; i++) {
      const cx = lx + 10 * u + i * 22 * u;
      const cy = top + 17 * u;
      const alive = i < r.lives;
      let rr = 7.5 * u;
      if (alive && r.lives === 1) rr *= 0.85 + 0.25 * light.pulse(time, 1.6, { still: 0.5 });
      if (!alive && i === r.lives && lifeT >= 0 && time - lifeT < 0.5) rr *= 1 + 0.8 * (1 - (time - lifeT) / 0.5);
      rd.fillStyle = alive ? press.solid("red") : press.screen("red", 0.22);
      rd.beginPath();
      rd.arc(cx, cy, rr, 0, TAU);
      rd.fill();
    }

    // Multiplier, top right.
    const mx = W - side - 8 * u - 26 * u;
    const my = top + 20 * u;
    knockout(mx - 30 * u, top, 60 * u, 40 * u, 10 * u);
    const hot = r.mult > 1;
    const mc = press.plate(hot ? "red" : "blue");
    mc.fillStyle = press.solid(hot ? "red" : "blue");
    mc.beginPath();
    mc.arc(mx, my, 18 * u, 0, TAU);
    mc.fill();
    mc.globalCompositeOperation = "destination-out";
    mc.fillStyle = "#000";
    spaced(mc, `×${r.mult}`, mx, my + 6.5 * u, display(19 * u), 0.5 * u);
    mc.globalCompositeOperation = "source-over";
    // Combo toward the next step: a thin arc around the badge.
    const next = [10, 25, 50, 90][r.mult - 1];
    if (next !== undefined) {
      const prev = [0, 10, 25, 50][r.mult - 1]!;
      const k = clamp((r.combo - prev) / (next - prev));
      const yc = press.plate("yellow");
      yc.strokeStyle = press.solid("yellow");
      yc.lineWidth = 3.5 * u;
      yc.beginPath();
      yc.arc(mx, my, 22 * u, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      yc.stroke();
    }

    // New best, under the score.
    if (bestT >= 0 && time - bestT < 1.8) {
      const k = (time - bestT) / 1.8;
      const s = easeOutBack(Math.min(1, (time - bestT) / 0.3));
      const c = press.plate("red");
      c.save();
      c.translate(W / 2, top + th + 18 * u);
      c.rotate(-0.06);
      c.scale(s, s);
      c.fillStyle = k < 0.75 ? press.solid("red") : press.screen("red", 1 - (k - 0.75) / 0.25);
      c.beginPath();
      c.roundRect(-58 * u, -13 * u, 116 * u, 26 * u, 13 * u);
      c.fill();
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      spaced(c, "NEW BEST", 0, 4.5 * u, small(11 * u), 3.5 * u);
      c.restore();
    }
  }

  /** The combo, printed big and light behind the roll. */
  function drawCombo(r: Run): void {
    if (r.combo < 5 || r.over || stamp) return;
    const size = (r.combo >= 100 ? 96 : 116) * u;
    const text = String(r.combo);
    const by = H * 0.4 + size * 0.36;
    // Cut out of the yellow so the digits print on bare paper, then a red screen in them.
    const yk = world("yellow");
    yk.globalCompositeOperation = "destination-out";
    yk.fillStyle = "#000";
    spaced(yk, text, W / 2, by, display(size), 2 * u);
    yk.globalCompositeOperation = "source-over";
    const c = world("red");
    c.fillStyle = press.screen("red", 0.34 + Math.min(1, bump) * 0.14);
    spaced(c, text, W / 2, by, display(size), 2 * u);
    c.fillStyle = press.screen("red", 0.75);
    spaced(c, "COMBO", W / 2, by + 20 * u, small(10 * u), 6 * u);
  }

  /** The tune's title card before it starts, the clear stamp after it ends, the multiplier slam. */
  function drawCards(r: Run): void {
    // Title card: from the gap before a tune until just before its first note.
    for (const p of r.chart.plays) {
      const from = p.slot === 0 ? 0 : r.chart.plays[p.slot - 1]!.end + 0.85;
      const to = p.start - 0.1;
      if (r.now < from || r.now > to || r.slot !== p.slot) continue;
      const inK = clamp((r.now - from) / 0.35);
      const outK = clamp((to - r.now) / 0.3);
      const level = Math.min(1, outK);
      const cy = H * 0.3 + (1 - easeOutCubic(inK)) * -14 * u;
      const fit = Math.min(48 * u, ((W - 64 * u) / Math.max(6, p.song.title.length)) * 1.62);
      const finale0 = p.slot === r.chart.plays.length - 1 && r.chart.plays.length > 1;
      // A paper ticket: the roll passes under it.
      const cw = W - 36 * u;
      const ch = (finale0 ? 132 : 112) * u;
      const ct = cy - fit * 0.95 - 26 * u;
      if (level > 0.25) {
        knockout(W / 2 - cw / 2, ct, cw, ch, 12 * u);
        const rr = press.plate("red");
        rr.fillStyle = press.screen("red", 0.85 * level);
        rr.fillRect(W / 2 - cw / 2 + 12 * u, ct + 8 * u, cw - 24 * u, 1.5 * u);
        rr.fillRect(W / 2 - cw / 2 + 12 * u, ct + ch - 9.5 * u, cw - 24 * u, 1.5 * u);
      }
      const nb = press.plate("blue");
      nb.fillStyle = level >= 1 ? press.solid("blue") : press.screen("blue", level);
      const finale = p.slot === r.chart.plays.length - 1 && r.chart.plays.length > 1;
      spaced(nb, finale ? "THE FINALE" : `TUNE ${p.slot + 1} OF ${r.chart.plays.length}`, W / 2, cy - fit * 0.95, small(11 * u), 5 * u);
      doublePrint(p.song.title, W / 2, cy, display(fit), 1.2 * u, "red", "blue", 2 * u, level);
      nb.fillStyle = level >= 1 ? press.solid("blue") : press.screen("blue", level);
      spaced(nb, p.song.composer, W / 2, cy + 24 * u, small(11 * u), 6 * u);
      if (finale) spaced(nb, "IT SPEEDS UP", W / 2, cy + 46 * u, small(9.5 * u), 4 * u);
    }
    // Clear / encore stamp.
    if (stamp) {
      const age = time - stamp.t;
      const life = stamp.big ? 3 : 0.95;
      if (age > life) stamp = null;
      else {
        const s = easeOutBack(Math.min(1, age / 0.22), 2.2) * (stamp.big ? 1.25 : 1);
        const fade = age > life - 0.25 ? (life - age) / 0.25 : 1;
        const c = press.plate("red");
        c.save();
        c.translate(W / 2, H * 0.36);
        c.rotate(-0.09);
        c.scale(1.6 - 0.6 * s, 1.6 - 0.6 * s);
        const size = (stamp.big ? 68 : 50) * u;
        c.fillStyle = fade >= 1 ? press.solid("red") : press.screen("red", fade);
        spaced(c, stamp.text, 0, size * 0.34, display(size), 2 * u);
        const bl = press.plate("blue");
        bl.save();
        bl.setTransform(c.getTransform());
        bl.fillStyle = fade >= 1 ? press.solid("blue") : press.screen("blue", fade);
        spaced(bl, stamp.text, 2 * u, size * 0.34 + 1.2 * u, display(size), 2 * u);
        if (stamp.sub) spaced(bl, stamp.sub, 0, size * 0.34 + (stamp.big ? 34 : 26) * u, small((stamp.big ? 15 : 12) * u), 4 * u);
        bl.restore();
        c.restore();
      }
    }
    if (slam) {
      const age = time - slam.t;
      if (age > 0.7) slam = null;
      else {
        const s = 1.7 - 0.7 * easeOutBack(Math.min(1, age / 0.2), 2);
        const level = age > 0.45 ? 1 - (age - 0.45) / 0.25 : 1;
        const c = press.plate("blue");
        c.save();
        c.translate(W / 2, H * 0.24);
        c.scale(s, s);
        c.fillStyle = level >= 1 ? press.solid("blue") : press.screen("blue", level);
        spaced(c, slam.text, 0, 22 * u, display(64 * u), 1 * u);
        const rr = press.plate("red");
        rr.save();
        rr.setTransform(c.getTransform());
        rr.fillStyle = level >= 1 ? press.solid("red") : press.screen("red", level);
        spaced(rr, slam.text, 2.4 * u, 23.5 * u, display(64 * u), 1 * u);
        rr.restore();
        c.restore();
      }
    }
  }

  /** First runs: a ghost thumb taps the next tile as it meets the line. */
  function drawHint(r: Run): void {
    if (hintSeen || session.phase !== "playing") return;
    let next = -1;
    for (let i = 0; i < r.tiles.length; i++) {
      if (r.state[i] === 0) {
        next = i;
        break;
      }
    }
    if (next < 0) return;
    const tl = r.tiles[next]!;
    const dt = tl.t - r.now;
    if (dt > 1.6) return;
    const x = laneCx(tl.lane);
    const down = clamp(1 - Math.abs(dt) / 0.12);
    const y = lineY + 22 * u - down * 10 * u;
    const c = press.plate("red");
    c.fillStyle = press.screen("red", 0.45);
    c.beginPath();
    c.roundRect(x - 13 * u, y, 26 * u, 70 * u, 13 * u);
    c.fill();
    c.fillStyle = press.solid("red");
    c.beginPath();
    c.arc(x, y + 12 * u, 9 * u, 0, TAU);
    c.fill();
    if (down > 0.5) fx.ring(x, lineY, 8 * u, 30 * u, 2 * u, "red", 0.2);
    capsule("blue", "TAP THE INK ON THE RED LINE", W / 2, lineY + (H - lineY) * 0.62, 10.5);
  }

  // --- attract poster --------------------------------------------------------------------------------
  const posterTitleY = () => Math.max(session.preview().top + 58 * u, H * 0.09);
  function posterBottom(): number {
    return posterTitleY() + 132 * u;
  }

  function drawPoster(): void {
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const bottom = posterBottom();
    const k = clamp(time / 1.0);
    const aw = W - r.left - r.right;
    const titleY = posterTitleY();
    const size = Math.min(76 * u, (aw * 0.9) / 4.6);
    doublePrint("HALFTUNE", cx, titleY + (1 - easeOutCubic(k)) * 8, display(size), 1.5 * u, "blue", "red", 2.4 * u);
    const b = press.plate("blue");
    b.fillStyle = press.solid("blue");
    const tag = "EVERY TILE IS A NOTE";
    let tsz = 10.5;
    while (tsz > 7 && spacedWidth(b, tag, small(tsz * u), 4 * u) > aw - 24 * u) tsz -= 0.5;
    spaced(b, tag, cx + 2 * u, titleY + 24 * u, small(tsz * u), 4 * u);
    // Tonight's set: the one the next tap plays, two tunes a line.
    const set = setList(seedFor(session.runs + 1)).map((id) => SONGS[id]!.title);
    const ly = titleY + 50 * u;
    const rd = press.plate("red");
    rd.fillStyle = press.solid("red");
    spaced(rd, "TONIGHT", cx, ly, small(9.5 * u), 7 * u);
    const lines = [`${set[0]} · ${set[1]}`, `${set[2]} · ${set[3]}`];
    let fsz = 17;
    while (fsz > 11 && Math.max(...lines.map((l) => spacedWidth(b, l, display(fsz * u), 1.2 * u))) > aw - 28 * u) fsz -= 0.5;
    lines.forEach((l, i) => spaced(b, l, cx, ly + 21 * u + i * 19 * u, display(fsz * u), 1.2 * u));
    const best = session.best;
    if (best !== null && best > 0) {
      rd.fillStyle = press.solid("red");
      spaced(rd, `BEST ${best}`, r.left + 22 * u, r.top + 22 * u + 4 * u, small(10 * u), 4 * u, 0);
    }
    capsule("red", "TAP TO PLAY", cx, bottom - 18 * u, 12.5);
    const m = 16 * u;
    registrationMark(r.left + m, r.top + m + 6, 5 * u);
    registrationMark(W - r.right - m, r.top + m + 6, 5 * u);
    // A rule under the poster: the roll comes out from under it.
    rd.fillStyle = press.screen("red", 0.6);
    rd.fillRect(0, bottom, W, 2 * u);
  }

  // --- game over -------------------------------------------------------------------------------------
  function drawSummary(): void {
    const sm = summary;
    if (!sm || session.phaseTime < 0.3) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 16 * u : pv.left + 12 * u;
    const right = W - (solo ? 16 * u : pv.right + 8 * u);
    const w = right - left;
    const ph = 118 * u;
    const topY = solo ? Math.round(H * 0.52) : H - pv.bottom - ph - 8 * u;
    const k = easeOutBack(clamp((session.phaseTime - 0.3) / 0.35), 1.4);
    const cx = left + w / 2;
    const y0 = topY + (1 - k) * 20 * u;
    knockout(left, y0, w, ph, 12 * u);
    const b = press.plate("blue");
    const rd = press.plate("red");
    // A ticket: paper, a red rule along the top and the bottom.
    rd.fillStyle = press.solid("red");
    rd.fillRect(left + 8 * u, y0 + 3 * u, w - 16 * u, 3 * u);
    rd.fillRect(left + 8 * u, y0 + ph - 6 * u, w - 16 * u, 3 * u);
    rd.fillRect(left + 14 * u, y0 + 30 * u, w - 28 * u, 1.5 * u);
    b.fillStyle = press.solid("blue");
    const line1 = `${sm.won ? "ENCORE" : `${sm.cleared} OF 4 TUNES`}  ·  COMBO ${sm.combo}  ·  ${sm.perfectPct}% PERFECT`;
    let fs = 11;
    while (fs > 8 && spacedWidth(b, line1, small(fs * u), 2.2 * u) > w - 28 * u) fs -= 0.5;
    spaced(b, line1, cx, y0 + 21 * u, small(fs * u), 2.2 * u);
    // Against the best.
    const bw = w - 28 * u;
    const bx = left + 14 * u;
    const byy = y0 + 42 * u;
    b.fillStyle = press.screen("blue", 0.25);
    b.fillRect(bx, byy, bw, 12 * u);
    const frac = sm.isBest || !sm.prevBest ? 1 : clamp(sm.score / sm.prevBest);
    const grow = clamp((session.phaseTime - 0.4) / 0.7);
    rd.fillStyle = sm.isBest ? press.solid("red") : press.screen("red", 0.75);
    rd.fillRect(bx, byy, bw * frac * easeOutCubic(grow), 12 * u);
    const label = sm.isBest ? (sm.prevBest ? `NEW BEST  +${sm.score - sm.prevBest}` : "FIRST BEST") : `${Math.round(frac * 100)}% OF YOUR BEST`;
    b.fillStyle = press.solid("blue");
    spaced(b, label, cx, byy + 27 * u, small(10.5 * u), 3.5 * u);
    // The tip, on one or two lines.
    const tip = sm.tip.toUpperCase();
    const tf = small(9.5 * u);
    const words = tip.split(" ");
    const tipLines: string[] = [];
    let cur = "";
    for (const wd of words) {
      const next = cur ? `${cur} ${wd}` : wd;
      if (cur && spacedWidth(b, next, tf, 1.4 * u) > w - 28 * u) {
        tipLines.push(cur);
        cur = wd;
      } else cur = next;
    }
    if (cur) tipLines.push(cur);
    b.fillStyle = press.solid("blue");
    tipLines.slice(0, 2).forEach((l, i, all) => spaced(b, l, cx, y0 + ph - 14 * u - (all.length - 1 - i) * 13 * u, tf, 1.4 * u));
    if (solo && session.phaseTime > 0.8) {
      doublePrint(String(sm.score), cx, topY - 96 * u, display(72 * u), 2 * u, "blue", "red", 2.4 * u);
      b.fillStyle = press.solid("blue");
      spaced(b, "POINTS", cx, topY - 72 * u, small(11 * u), 6 * u);
      capsule("red", "TAP TO PLAY AGAIN", cx, topY + ph + 46 * u, 12.5);
    }
  }

  // --- render ----------------------------------------------------------------------------------------
  function render(): void {
    press.begin();
    const so = shake.offset;
    shakeX = so.x;
    shakeY = so.y;
    const r = mode === "run" && run ? run : demo;
    const attract = mode === "attract";
    const top = attract ? posterBottom() : 0;
    drawRecord(r);
    if (!attract) drawCombo(r);
    drawLanes(top);
    drawTiles(r, top);
    drawLine();
    fx.draw(press);
    if (attract) drawPoster();
    else if (run) {
      drawCards(run);
      drawHint(run);
      drawHud(run);
      if (session.phase === "over") drawSummary();
    }
    press.print(ctx);
    if (veil > 0) drawVeil(easeInOutCubic(Math.min(1, veil)));
  }

  /** A halftone dissolve to paper. */
  const veilPatterns = new Map<number, CanvasPattern>();
  let veilDpr = 0;
  function drawVeil(k: number): void {
    const q = Math.round(k * 12);
    if (q <= 0) return;
    view.begin();
    if (q >= 12) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const dpr = view.dpr;
    if (dpr !== veilDpr) {
      veilPatterns.clear();
      veilDpr = dpr;
    }
    let pat = veilPatterns.get(q);
    if (!pat) {
      // Drawn in device pixels and mapped 1:1 onto the screen: WebKit fills a scaled pattern on a very slow path.
      const s = 6 * dpr;
      const c = document.createElement("canvas");
      c.width = c.height = Math.round(s * 2);
      const g = c.getContext("2d")!;
      g.fillStyle = PAPER;
      g.beginPath();
      g.arc(c.width / 2, c.width / 2, Math.sqrt(((q / 12) * 4 * s * s) / Math.PI) * 1.02, 0, TAU);
      g.fill();
      pat = ctx.createPattern(c, "repeat")!;
      pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
      veilPatterns.set(q, pat);
    }
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }

  session.on("attract", () => {
    mode = "attract";
    run = null;
    resetPresentation();
  });

  let readySent = false;
  tc.loop((dt) => {
    update(Math.min(dt, 0.05));
    render();
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
}

void main();
