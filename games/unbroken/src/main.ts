import { createSession } from "@thumbcade-games/kit/session";
import { onDrag, onTap } from "@thumbcade-games/kit/input";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { thumbcade as tc } from "@thumbcade/sdk";
import { drawNib } from "./nib.ts";
import { adjacent, generate, type Puzzle, SIZES } from "./puzzle.ts";
import {
  drawPrompt,
  drawRuns,
  drawSeal,
  drawTitleBlock,
  fitText,
  easeInOut,
  easeOut,
  handRing,
  handRule,
  inkStroke,
  makeSeal,
  type Seal,
  Smudges,
  titleBlockHeight,
  titlePx,
} from "./qm/ink.ts";
import { GRAPHITE, INK, italic, PENCIL, rgba, SEAL, serif } from "./qm/palette.ts";
import { createSurface } from "./qm/paper.ts";
import { createSound, scaleNote } from "./qm/sound.ts";
import { issueNumber, loadSerif, roman, words } from "./qm/type.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const CLOCK = 75;
const TITLE = "Unbroken";
/** Seconds the solved puzzle rests before the page turns, the turn itself, and the new dots arriving. */
const REST = 0.85;
const TURN = 0.4;
const ARRIVE = 0.55;
const DEMO_SPEED = 4.2;

const bonusSeconds = (dots: number) => (dots <= 24 ? 2 : 3);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geo {
  gx: number;
  gy: number;
  s: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

async function main() {
  const [session] = await Promise.all([createSession({ id: "unbroken" }), loadSerif()]);
  const view = createSurface();
  const { ctx } = view;
  const sound = createSound();
  const reduced = session.reducedMotion;
  const smudges = new Smudges();
  const issue = issueNumber();
  let W = view.width;
  let H = view.height;
  const seals = new Map<string, Seal>();
  const sealFor = (text: string) => {
    let s = seals.get(text);
    if (!s) seals.set(text, (s = makeSeal(text, 64, view.dpr, text.length + 5)));
    return s;
  };
  view.onResize(() => {
    W = view.width;
    H = view.height;
    seals.clear();
  });

  let time = 0;
  let layoutK = 0;
  let layoutTarget = 0;

  // ---------------------------------------------------------------------------
  // The demo: the pen solves a puzzle by itself.
  // ---------------------------------------------------------------------------
  const DEMO_SIZES: Array<[number, number, number, number]> = [
    [5, 5, 2, 3],
    [4, 5, 2, 2],
    [5, 6, 2, 4],
  ];
  const demoRng = createRng(session.ctx.dailySeed ^ 0x0b0e);
  let demoN = 0;
  const newDemo = () => {
    const [c, r, a, b] = DEMO_SIZES[demoN++ % DEMO_SIZES.length]!;
    return generate(c, r, a, b, demoRng, 40);
  };
  let demo = newDemo();
  let demoProg = 0;
  let demoDone = -1;
  let demoAppear = 0;
  let demoOut = 0;

  // ---------------------------------------------------------------------------
  // The run.
  // ---------------------------------------------------------------------------
  let rng: Rng = createRng(session.ctx.seed);
  let index = 0;
  /** The number printed above the puzzle on the page (it changes when the page turns). */
  let puzzleNo = 1;
  let puzzle: Puzzle = demo;
  let path: number[] = [];
  let inPath = new Uint8Array(0);
  let clock = CLOCK;
  let lastWhole = CLOCK;
  let score = 0;
  let solved = 0;
  /** -1 while drawing; otherwise seconds since the puzzle was solved. */
  let solvedT = -1;
  let appear = 0;
  let next: Puzzle | null = null;
  let ended = false;
  let endT = 0;
  let endSent = false;
  let startT = 0;
  let lastErase = -10;
  let lastRustle = -10;
  let lastBlock = -10;
  let bonusT = -10;
  let bonus = { points: 0, secs: 0 };
  let dragging = false;
  let finger: [number, number] = [0, 0];

  function load(p: Puzzle) {
    puzzle = p;
    puzzleNo = index + 1;
    path = [p.start];
    inPath = new Uint8Array(p.cols * p.rows);
    inPath[p.start] = 1;
    appear = 0;
    solvedT = -1;
  }

  const sizeFor = (i: number) => SIZES[Math.min(i, SIZES.length - 1)]!;

  session.on("start", () => {
    rng = createRng(session.ctx.seed + session.runs * 977);
    index = 0;
    const [c, r, a, b] = sizeFor(0);
    load(generate(c, r, a, b, rng));
    clock = CLOCK;
    lastWhole = CLOCK;
    score = 0;
    solved = 0;
    ended = false;
    endT = 0;
    endSent = false;
    startT = 0;
    dragging = false;
    bonusT = -10;
    lastErase = -10;
    next = null;
    smudges.clear();
    layoutTarget = 1;
    sound.rustle();
  });

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  function attractFrame(): { frame: Rect; L: number; R: number; top: number } {
    const ins = session.preview();
    const L = ins.left + 26;
    const R = W - Math.max(ins.right + 8, 24);
    const top = ins.top + 20;
    const y = top + titleBlockHeight(titlePx(ctx, TITLE, R - L)) + 22;
    const h = Math.max(120, Math.min(H * 0.66 - y, (R - L) * 1.05));
    return { frame: { x: L, y, w: R - L, h }, L, R, top };
  }

  function playFrame(): { frame: Rect; L: number; R: number; top: number; rule: number } {
    const ins = session.play();
    const L = ins.left + 22;
    const R = W - ins.right - 22;
    const top = ins.top + 12;
    const rule = top + 70;
    const y = rule + 24;
    const h = Math.max(160, H - y - 106);
    return { frame: { x: L, y, w: R - L, h }, L, R, top, rule };
  }

  /** The figure box hugs its puzzle: left-aligned under the title in attract, centred during a run. */
  function targetFrame(): Rect {
    const a = attractFrame().frame;
    const p = playFrame().frame;
    const k = reduced ? (layoutK > 0.5 ? 1 : 0) : easeInOut(layoutK);
    const area = { x: lerp(a.x, p.x, k), y: lerp(a.y, p.y, k), w: lerp(a.w, p.w, k), h: lerp(a.h, p.h, k) };
    const pz = session.runs > 0 ? puzzle : demo;
    const pad = 14;
    const sp = Math.min(lerp(56, 72, k), (area.w - pad * 2) / pz.cols, (area.h - pad * 2) / pz.rows);
    const w = pz.cols * sp + pad * 2;
    const h = pz.rows * sp + pad * 2;
    return { x: lerp(area.x, area.x + (area.w - w) / 2, k), y: lerp(area.y, area.y + (area.h - h) * 0.42, k), w, h };
  }

  let frameNow: Rect | null = null;
  function easeFrame(dt: number) {
    const t = targetFrame();
    if (!frameNow || reduced) {
      frameNow = t;
      return;
    }
    const f = 1 - Math.exp(-11 * dt);
    frameNow = { x: lerp(frameNow.x, t.x, f), y: lerp(frameNow.y, t.y, f), w: lerp(frameNow.w, t.w, f), h: lerp(frameNow.h, t.h, f) };
  }

  const currentFrame = (): Rect => frameNow ?? targetFrame();

  function geo(p: Puzzle, f: Rect, max = 72): Geo {
    const pad = 14;
    const s = Math.min(max, (f.w - pad * 2) / p.cols, (f.h - pad * 2) / p.rows);
    return { gx: f.x + (f.w - s * p.cols) / 2, gy: f.y + (f.h - s * p.rows) / 2, s };
  }

  const center = (p: Puzzle, g: Geo, i: number): [number, number] => [g.gx + ((i % p.cols) + 0.5) * g.s, g.gy + (Math.floor(i / p.cols) + 0.5) * g.s];

  function cellAt(p: Puzzle, g: Geo, x: number, y: number, clampInside: boolean): number {
    let c = Math.floor((x - g.gx) / g.s);
    let r = Math.floor((y - g.gy) / g.s);
    if (clampInside) {
      c = Math.max(0, Math.min(p.cols - 1, c));
      r = Math.max(0, Math.min(p.rows - 1, r));
    } else if (c < 0 || r < 0 || c >= p.cols || r >= p.rows) return -1;
    return r * p.cols + c;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  onTap(window, () => {
    sound.unlock();
    if (session.phase !== "playing") session.start();
  });

  const canDraw = () => session.phase === "playing" && !ended && solvedT < 0 && appear > 0.25;
  const head = () => path[path.length - 1]!;

  function extend(c: number) {
    path.push(c);
    inPath[c] = 1;
    sound.pluck(scaleNote((path.length - 2) % 10), 0.7);
    if (path.length === puzzle.dots) solve();
  }

  function retract() {
    const c = path.pop()!;
    inPath[c] = 0;
    lastErase = time;
    if (time - lastRustle > 0.12) {
      lastRustle = time;
      sound.rustle(0.55);
    }
  }

  function blocked(x: number, y: number, g: Geo) {
    if (time - lastBlock < 0.7) return;
    lastBlock = time;
    smudges.add(x, y, g.s * 0.3);
    sound.smudge();
    session.feedback("fail");
  }

  function stepToward(x: number, y: number) {
    const f = currentFrame();
    const g = geo(puzzle, f);
    for (let guard = 0; guard < 24 && !ended && solvedT < 0; guard++) {
      const target = cellAt(puzzle, g, x, y, true);
      const h = head();
      if (target === h) return;
      const hc = h % puzzle.cols;
      const hr = Math.floor(h / puzzle.cols);
      const dc = (target % puzzle.cols) - hc;
      const dr = Math.floor(target / puzzle.cols) - hr;
      const [hx, hy] = center(puzzle, g, h);
      const horizFirst = Math.abs(dc) > Math.abs(dr) || (Math.abs(dc) === Math.abs(dr) && Math.abs(x - hx) >= Math.abs(y - hy));
      const steps: number[] = [];
      if (dc && horizFirst) steps.push(h + Math.sign(dc));
      if (dr) steps.push(h + Math.sign(dr) * puzzle.cols);
      if (dc && !horizFirst) steps.push(h + Math.sign(dc));
      let moved = false;
      for (const n of steps) {
        if (path.length >= 2 && n === path[path.length - 2]) {
          retract();
          moved = true;
          break;
        }
        if (puzzle.cells[n] && !inPath[n]) {
          extend(n);
          moved = true;
          break;
        }
      }
      if (!moved) {
        // Into a gap or across the line itself: the pen hesitates.
        const fc = cellAt(puzzle, g, x, y, false);
        if (fc >= 0 && fc !== h && (!puzzle.cells[fc] || inPath[fc]) && Math.hypot(x - hx, y - hy) > g.s * 0.9) blocked(x, y, g);
        return;
      }
    }
  }

  onDrag(window, {
    start(x, y) {
      dragging = false;
      if (!canDraw()) return;
      const g = geo(puzzle, currentFrame());
      finger = [x, y];
      const c = cellAt(puzzle, g, x, y, false);
      if (c < 0) return;
      if (inPath[c]) {
        // Pick the line up wherever you touch it: everything after that dot lifts away.
        if (c !== head()) {
          while (head() !== c) retract();
        }
        dragging = true;
        return;
      }
      if (puzzle.cells[c] && adjacent(puzzle, head(), c)) {
        extend(c);
        dragging = solvedT < 0;
        return;
      }
      blocked(x, y, g);
    },
    move(x, y) {
      if (!dragging || !canDraw()) return;
      finger = [x, y];
      stepToward(x, y);
    },
    end() {
      dragging = false;
    },
  });
  session.on("cancel", () => (dragging = false));

  function solve() {
    solvedT = 0;
    dragging = false;
    solved++;
    const secs = bonusSeconds(puzzle.dots);
    score += puzzle.dots;
    clock += secs;
    bonus = { points: puzzle.dots, secs };
    bonusT = time;
    session.feedback("success");
    index++;
    const [c, r, a, b] = sizeFor(index);
    next = generate(c, r, a, b, rng);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(rawDt: number) {
    // The clock runs on real time (paused time never arrives here); animation steps stay small.
    const dt = Math.min(rawDt, 0.1);
    session.tick(rawDt);
    time += dt;
    smudges.update(dt);
    const lk = reduced ? 3 : 1.45;
    layoutK = layoutTarget > layoutK ? Math.min(layoutTarget, layoutK + dt * lk) : Math.max(layoutTarget, layoutK - dt * lk);
    easeFrame(dt);

    if (session.runs === 0) {
      demoAppear += dt;
      if (demoAppear > ARRIVE + 0.3) {
        if (demoProg < demo.dots - 1) demoProg = Math.min(demo.dots - 1, demoProg + dt * DEMO_SPEED);
        else {
          demoDone = demoDone < 0 ? 0 : demoDone + dt;
          if (demoDone > 3.6) {
            demo = newDemo();
            demoProg = 0;
            demoDone = -1;
            demoAppear = 0;
          }
        }
      }
    } else demoOut = Math.min(1, demoOut + dt / 0.4);

    if (session.phase !== "playing") return;
    startT += dt;
    appear += dt;
    if (ended) {
      endT += dt;
      if (!endSent && endT >= 0.25) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { puzzles: solved } });
      }
      return;
    }
    if (solvedT >= 0) {
      const before = solvedT;
      solvedT += dt;
      if (before < 0.28 && solvedT >= 0.28) sound.bell(79 + (solved % 3) * 2);
      if (before < REST + TURN && solvedT >= REST + TURN && next) {
        load(next);
        next = null;
        sound.rustle(0.8);
      }
    }
    // The clock keeps burning while the seal dries: only the bonus buys time.
    clock -= rawDt;
    const whole = Math.ceil(clock);
    if (whole !== lastWhole) {
      lastWhole = whole;
      if (whole <= 10 && whole > 0) sound.tick();
    }
    if (clock <= 0) {
      clock = 0;
      ended = true;
      endT = 0;
      dragging = false;
      sound.bell(57);
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function perimeterPoint(f: Rect, t: number): [number, number] {
    let d = clamp01(t) * (f.w + f.h) * 2;
    if (d <= f.w) return [f.x + d, f.y];
    d -= f.w;
    if (d <= f.h) return [f.x + f.w, f.y + d];
    d -= f.h;
    if (d <= f.w) return [f.x + f.w - d, f.y + f.h];
    d -= f.w;
    return [f.x, f.y + f.h - d];
  }

  function drawClock(f: Rect, frac: number, burning: boolean) {
    if (frac < 1) {
      ctx.save();
      ctx.setLineDash([1, 4]);
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h);
      ctx.strokeStyle = rgba(PENCIL, 0.55);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
    if (frac <= 0) return;
    const corners: Array<[number, number]> = [
      [f.x + f.w, f.y],
      [f.x + f.w, f.y + f.h],
      [f.x, f.y + f.h],
      [f.x, f.y],
    ];
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    let left = Math.min(1, frac) * (f.w + f.h) * 2;
    let px = f.x;
    let py = f.y;
    for (const [cx, cy] of corners) {
      const seg = Math.hypot(cx - px, cy - py);
      if (left >= seg) {
        ctx.lineTo(cx, cy);
        left -= seg;
        px = cx;
        py = cy;
      } else {
        ctx.lineTo(px + ((cx - px) * left) / seg, py + ((cy - py) * left) / seg);
        break;
      }
    }
    inkStroke(ctx, 1.7, INK, 0.92);
    if (!burning || frac >= 1) return;
    const [ex, ey] = perimeterPoint(f, frac);
    ctx.fillStyle = rgba(SEAL, 0.95);
    ctx.beginPath();
    ctx.arc(ex, ey, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    const sway = reduced ? 0 : Math.sin(time * 1.7) * 3;
    ctx.moveTo(ex, ey - 3);
    ctx.bezierCurveTo(ex + 3 + sway, ey - 8, ex - 4 + sway, ey - 13, ex + 1 + sway * 1.4, ey - 19);
    ctx.strokeStyle = rgba(GRAPHITE, 0.22);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  /** The line through `pts`, with softly rounded corners. */
  function strokeLine(pts: Array<[number, number]>, w: number, alpha: number) {
    if (pts.length < 2) return;
    const r = w * 1.6;
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1]!;
      const [bx, by] = pts[i]!;
      const [cx, cy] = pts[i + 1]!;
      const rr = Math.min(r, Math.hypot(bx - ax, by - ay) * 0.5, Math.hypot(cx - bx, cy - by));
      ctx.arcTo(bx, by, cx, cy, Math.max(0.01, rr));
    }
    const last = pts[pts.length - 1]!;
    ctx.lineTo(last[0], last[1]);
    inkStroke(ctx, w, INK, alpha);
  }

  function drawPuzzle(p: Puzzle, g: Geo, line: number[], tail: [number, number] | null, appearK: number, alpha: number, showStart = true) {
    if (alpha <= 0) return;
    const dotR = Math.max(2.8, g.s * 0.072);
    // Dots arrive one by one, spreading out from the start.
    const sc = p.start % p.cols;
    const sr = Math.floor(p.start / p.cols);
    const maxD = p.cols + p.rows;
    ctx.fillStyle = rgba(INK, 0.9 * alpha);
    for (let i = 0; i < p.cells.length; i++) {
      if (!p.cells[i]) continue;
      const d = Math.abs((i % p.cols) - sc) + Math.abs(Math.floor(i / p.cols) - sr);
      const k = reduced ? clamp01(appearK / 0.3) : easeOut((appearK - (d / maxD) * 0.35) / 0.3);
      if (k <= 0) continue;
      const [x, y] = center(p, g, i);
      ctx.beginPath();
      ctx.arc(x, y, dotR * k, 0, Math.PI * 2);
      ctx.fill();
    }
    const pts = line.map((i) => center(p, g, i));
    if (tail) pts.push(tail);
    const w = Math.max(2.6, g.s * 0.118);
    strokeLine(pts, w, alpha);
    const [sx, sy] = center(p, g, p.start);
    ctx.fillStyle = rgba(INK, 0.92 * alpha);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(dotR * 1.5, w * 0.85), 0, Math.PI * 2);
    ctx.fill();
    if (showStart) handRing(ctx, sx, sy, dotR * 2.9, reduced ? 1 : easeOut((appearK - 0.3) / 0.45), p.start * 0.13, 1.1, INK, 0.8 * alpha);
    if (pts.length > 1) {
      const [hx, hy] = pts[pts.length - 1]!;
      ctx.fillStyle = rgba(INK, 0.9 * alpha);
      ctx.beginPath();
      ctx.arc(hx, hy, w * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The partial line toward the finger, so the pen never lags behind it. */
  function stretch(g: Geo): [number, number] | null {
    if (!dragging || solvedT >= 0) return null;
    const h = head();
    const [hx, hy] = center(puzzle, g, h);
    const dx = finger[0] - hx;
    const dy = finger[1] - hy;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const d = horiz ? dx : dy;
    if (Math.abs(d) < 2) return null;
    const c = h % puzzle.cols;
    const r = Math.floor(h / puzzle.cols);
    const nc = horiz ? c + Math.sign(d) : c;
    const nr = horiz ? r : r + Math.sign(d);
    if (nc < 0 || nr < 0 || nc >= puzzle.cols || nr >= puzzle.rows) return null;
    const n = nr * puzzle.cols + nc;
    if (!puzzle.cells[n] || inPath[n]) return null;
    const len = Math.min(Math.abs(d), g.s * 0.42);
    return horiz ? [hx + Math.sign(d) * len, hy] : [hx, hy + Math.sign(d) * len];
  }

  function drawTitle(alpha: number) {
    if (alpha <= 0) return;
    const { frame, L, R, top } = attractFrame();
    const block = { title: TITLE, kicker: `no. ${issue} · the one-line puzzle`, dek: "one line through every dot. no lifting the pen." };
    drawTitleBlock(ctx, block, L, top, R - L, time, alpha, reduced);
    const by = frame.y + frame.h + 30;
    ctx.fillStyle = rgba(GRAPHITE, alpha * clamp01((time - 0.9) / 0.8));
    ctx.font = italic(15);
    ctx.textAlign = "left";
    ctx.fillText("fig. the pen goes first, this once.", L, by);
    drawPrompt(ctx, "tap to begin", L, by + 40, time - 1.2, reduced, alpha * clamp01((time - 1) / 0.6), 21);
    if ((session.best ?? 0) > 0) {
      ctx.fillStyle = rgba(GRAPHITE, alpha);
      drawRuns(ctx, [["best ", italic(16)], [String(session.best), serif(17)]], R, by + 40, "right");
    }
  }

  function statusLine(): string {
    const left = puzzle.dots - path.length;
    if (ended) return solved ? `time. ${words(solved)} ${solved === 1 ? "puzzle" : "puzzles"} unbroken.` : "time. the page stays blank, for now.";
    if (solvedT >= 0) return solved === 1 ? "unbroken. the seal is yours." : "unbroken, again.";
    if (startT < 4.5) return "one line through every dot.";
    if (time - lastErase < 2.2) return "retrace the line to lift it.";
    if (clock < 10) return "the line is nearly ash.";
    return left === 1 ? "one dot to go." : `${words(left)} dots to go.`;
  }

  function drawHud(alpha: number) {
    if (alpha <= 0) return;
    const { frame, L, R, top, rule } = playFrame();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = rgba(INK, alpha);
    ctx.font = italic(28);
    ctx.fillText(TITLE, L, top + 32);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.font = italic(14);
    ctx.fillText(`no. ${roman(puzzleNo)} · ${words(puzzle.cols)} by ${words(puzzle.rows)}`, L + 1, top + 54);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(INK, alpha);
    ctx.font = serif(46);
    ctx.fillText(String(score), R, top + 40);
    const scoreW = ctx.measureText(String(score)).width;
    ctx.font = italic(14);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.fillText(score === 1 ? "point" : "points", R, top + 58);
    handRule(ctx, L, R, rule, 1, 0.8, INK, 0.75 * alpha, 0.4);

    // The notes sit under the figure box, and follow it as the puzzles grow.
    const fb = currentFrame();
    const by = Math.min(frame.y + frame.h, fb.y + fb.h) + 44;
    const secs = Math.ceil(clock);
    ctx.textAlign = "left";
    ctx.font = serif(28);
    ctx.fillStyle = rgba(INK, alpha);
    ctx.fillText(String(secs), L, by);
    const nw = ctx.measureText(String(secs)).width;
    ctx.font = italic(16);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.fillText(secs === 1 ? "second" : "seconds", L + nw + 6, by);
    const bk = time - bonusT;
    if (bk < 2.2) {
      const a = alpha * clamp01(bk / 0.2) * (1 - clamp01((bk - 1.4) / 0.8));
      ctx.fillStyle = rgba(INK, 0.8 * a);
      const sw = ctx.measureText(secs === 1 ? "second" : "seconds").width;
      ctx.fillText(`+${bonus.secs}`, L + nw + 6 + sw + 10, by - (reduced ? 0 : 4 * easeOut(bk / 0.6)));
      ctx.textAlign = "right";
      ctx.font = italic(18);
      ctx.fillText(`+${bonus.points}`, R - scoreW - 10, top + 40 - (reduced ? 0 : 4 * easeOut(bk / 0.6)));
      ctx.textAlign = "left";
    }
    if ((session.best ?? 0) > 0) {
      ctx.fillStyle = rgba(GRAPHITE, alpha);
      drawRuns(ctx, [["best ", italic(16)], [String(session.best), serif(18)]], R, by, "right");
    }
    ctx.textAlign = "left";
    ctx.fillStyle = rgba(INK, 0.8 * alpha);
    fitText(ctx, statusLine(), L, by + 32, R - L, 17);
    if (session.phase === "over" && session.standalone && session.phaseTime > 0.8) {
      drawPrompt(ctx, "tap to begin again", L, by + 72, session.phaseTime - 0.8, reduced, alpha, 19);
    }
  }

  function render() {
    view.begin();
    const f = currentFrame();
    const k = easeInOut(layoutK);
    const running = session.runs > 0;
    drawClock(f, running ? clock / CLOCK : 1, running && session.phase === "playing" && !ended);

    // Attract demo, fading as the run takes over.
    const da = 1 - demoOut;
    if (da > 0) {
      const g = geo(demo, f, 64);
      const n = Math.floor(demoProg);
      const line = demo.solution.slice(0, n + 1);
      let tail: [number, number] | null = null;
      if (n < demo.dots - 1) {
        const [ax, ay] = center(demo, g, demo.solution[n]!);
        const [bx, by] = center(demo, g, demo.solution[n + 1]!);
        const t = demoProg - n;
        tail = [lerp(ax, bx, t), lerp(ay, by, t)];
      }
      const fade = demoDone > 2.9 ? 1 - clamp01((demoDone - 2.9) / 0.6) : 1;
      drawPuzzle(demo, g, demoAppear > ARRIVE + 0.3 ? line : [demo.start], tail, demoAppear, da * fade);
      if (demoDone >= 0) drawSeal(ctx, sealFor("qm"), f.x + f.w - 30, f.y + f.h - 30, 44, demoDone - 0.2, reduced, -0.08, da * fade);
      // The pen rests on the line's end while it thinks, and travels with it.
      const tip = tail ?? center(demo, g, line[line.length - 1]!);
      const lift = demoDone >= 0 ? easeOut(demoDone / 0.8) : 0;
      if (demoAppear > ARRIVE * 0.5) drawNib(ctx, tip[0] + lift * 14, tip[1] - lift * 22, g.s * 0.95, da * fade * clamp01((demoAppear - ARRIVE * 0.5) / 0.4), reduced ? 0.52 : 0.52 + Math.sin(time * 1.3) * 0.03);
    }

    if (running) {
      const g = geo(puzzle, f);
      let alpha = demoOut;
      if (solvedT >= REST) alpha *= 1 - clamp01((solvedT - REST) / TURN);
      drawPuzzle(puzzle, g, path, stretch(g), appear, alpha);
      if (solvedT >= 0) drawSeal(ctx, sealFor(roman(puzzleNo)), f.x + f.w - 34, f.y + f.h - 34, 50, solvedT - 0.12, reduced, -0.08, alpha);
    }
    smudges.draw(ctx);
    drawTitle(1 - clamp01(k * 1.8));
    drawHud(clamp01((k - 0.45) / 0.55));
  }

  let readySent = false;
  tc.loop(
    (dt) => {
      update(dt);
      render();
      if (!readySent) {
        readySent = true;
        session.ready();
      }
    },
    { maxDt: 1 },
  );
}

void main();
