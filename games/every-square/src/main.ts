import { createSession } from "@thumbcade-games/kit/session";
import { onTap } from "@thumbcade-games/kit/input";
import { createRng } from "@thumbcade-games/kit/rng";
import { thumbcade as tc } from "@thumbcade/sdk";
import { drawKnight } from "./knight.ts";
import {
  brushCurve,
  drawPrompt,
  drawRuns,
  drawSeal,
  fitText,
  drawTitleBlock,
  easeInOut,
  easeOut,
  handRing,
  handRule,
  inkStroke,
  makeSeal,
  quad,
  type Seal,
  Smudges,
  titleBlockHeight,
  titlePx,
} from "./qm/ink.ts";
import { BLUE, GRAPHITE, INK, italic, PENCIL, rgba, SEAL, serif } from "./qm/palette.ts";
import { createSurface } from "./qm/paper.ts";
import { createSound, scaleNote } from "./qm/sound.ts";
import { issueNumber, loadSerif, words } from "./qm/type.ts";
import { fullTour, N, Tour } from "./tour.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const CLOCK = 90;
const HINT_AFTER = 6;
const BOW = 0.17;
const DEMO_STEP = 0.58;
const TITLE = "Every Square";

interface Box {
  x: number;
  y: number;
  s: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

async function main() {
  const [session] = await Promise.all([createSession({ id: "every-square" }), loadSerif()]);
  const view = createSurface();
  const { ctx } = view;
  const sound = createSound();
  const reduced = session.reducedMotion;
  const smudges = new Smudges();
  const issue = issueNumber();
  const dailyStart = createRng(session.ctx.dailySeed)() * 64;
  const today = Math.floor(dailyStart);
  let seal: Seal = makeSeal("64", 64, view.dpr, 11);
  view.onResize(() => (seal = makeSeal("64", 64, view.dpr, 11)));

  let W = view.width;
  let H = view.height;
  view.onResize(() => {
    W = view.width;
    H = view.height;
  });

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let time = 0;
  /** 0 = attract layout, 1 = play layout. */
  let layoutK = 0;
  let layoutTarget = 0;

  // The demo: the knight tours alone by Warnsdorff's rule from today's square.
  let demoRng = createRng(session.ctx.dailySeed ^ 0x51ed);
  let demo = new Tour(today);
  let demoSeq: number[] = fullTour(today, demoRng);
  let demoI = 1;
  let demoStep = 0;
  let demoAnim = 1;
  let demoDone = -1;
  let demoFade = 0;
  let demoOut = 0;

  // The run.
  let tour = new Tour(today);
  let anim = 1;
  const moveDur = reduced ? 0.12 : 0.34;
  let ringsT = 0;
  let clock = CLOCK;
  let idle = 0;
  let lastWhole = CLOCK;
  let endKind: "tour" | "stuck" | "time" | null = null;
  let endT = 0;
  let endSent = false;
  let score = 0;
  let startT = 0;

  function resetDemo(newTieBreaks: boolean) {
    if (newTieBreaks) demoRng = createRng((session.ctx.dailySeed ^ 0x51ed) + Math.floor(time * 1000));
    demo = new Tour(today);
    demoSeq = fullTour(today, demoRng);
    demoI = 1;
    demoStep = 0;
    demoAnim = 1;
    demoDone = -1;
    demoFade = 0;
  }

  session.on("start", () => {
    const start = session.runs <= 1 ? today : createRng(session.ctx.seed + session.runs * 7919).int(0, 63);
    tour = new Tour(start);
    anim = 1;
    ringsT = 0;
    clock = CLOCK;
    lastWhole = CLOCK;
    idle = 0;
    endKind = null;
    endT = 0;
    endSent = false;
    score = 1;
    startT = 0;
    smudges.clear();
    layoutTarget = 1;
    demoOut = 0;
    sound.rustle();
  });
  session.on("attract", () => {
    layoutTarget = 0;
    resetDemo(true);
  });

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  const LABEL_GAP = 20;

  function attractBox(): { box: Box; L: number; R: number; top: number } {
    const ins = session.preview();
    const L = ins.left + 26;
    const R = W - Math.max(ins.right + 8, 24);
    const top = ins.top + 20;
    const blockBottom = top + titleBlockHeight(titlePx(ctx, TITLE, R - L));
    const y = blockBottom + 24;
    const s = Math.max(120, Math.min(R - L - LABEL_GAP - 4, H * 0.66 - y, 300));
    return { box: { x: L + LABEL_GAP, y, s }, L, R, top };
  }

  function playBox(): { box: Box; L: number; R: number; top: number; rule: number } {
    const ins = session.play();
    const L = ins.left + 22;
    const R = W - ins.right - 22;
    const top = ins.top + 12;
    const rule = top + 70;
    const bottomArea = 92;
    const avail = H - (rule + 28) - bottomArea - 14;
    const s = Math.max(140, Math.min(R - L - LABEL_GAP - 4, avail));
    const free = Math.max(0, avail - s);
    return { box: { x: L + LABEL_GAP + (R - L - LABEL_GAP - s) / 2 - 2, y: rule + 28 + free * 0.24, s }, L, R, top, rule };
  }

  function currentBox(): Box {
    const a = attractBox().box;
    const p = playBox().box;
    const k = reduced ? (layoutK > 0.5 ? 1 : 0) : easeInOut(layoutK);
    return { x: lerp(a.x, p.x, k), y: lerp(a.y, p.y, k), s: lerp(a.s, p.s, k) };
  }

  const center = (b: Box, i: number): [number, number] => {
    const q = b.s / N;
    return [b.x + (i % N) * q + q / 2, b.y + Math.floor(i / N) * q + q / 2];
  };

  function control(ax: number, ay: number, bx: number, by: number): [number, number] {
    // The ink always bows to the left of the knight's travel: one hand, one habit.
    return [(ax + bx) / 2 + (by - ay) * BOW, (ay + by) / 2 - (bx - ax) * BOW];
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  onTap(window, (x, y) => {
    sound.unlock();
    if (session.phase !== "playing") {
      session.start();
      return;
    }
    if (endKind) return;
    idle = 0;
    const b = currentBox();
    const q = b.s / N;
    let best = -1;
    let bestD = q * 0.78;
    for (const m of tour.legal()) {
      const [cx, cy] = center(b, m);
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (best < 0) {
      // Not a knight's move: a soft blot of ink where the pen hesitated.
      const onBoard = x > b.x - 8 && x < b.x + b.s + 8 && y > b.y - 8 && y < b.y + b.s + 8;
      if (onBoard) {
        smudges.add(x, y, q * 0.34);
        sound.smudge();
        session.feedback("fail");
      }
      return;
    }
    anim = 1;
    tour.visit(best);
    anim = 0;
    ringsT = 0;
    score = tour.length;
    const row = Math.floor(best / N);
    sound.pluck(scaleNote(7 - row + Math.floor((best % N) / 3)), 0.9);
    session.feedback("tap");
    if (tour.length === N * N) finish("tour");
    else if (tour.legal().length === 0) finish("stuck");
  });

  function finish(kind: "tour" | "stuck" | "time") {
    endKind = kind;
    endT = 0;
    if (kind === "tour") score = N * N + Math.floor(clock);
    else score = tour.length;
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

    // Demo (attract, and it lingers a moment as the run takes over).
    if (session.phase === "attract" || session.runs === 0) {
      demoAnim = Math.min(1, demoAnim + dt / Math.min(0.34, (demoI < 12 ? 0.15 : DEMO_STEP) * 0.85));
      if (demoI < demoSeq.length) {
        demoStep += dt;
        const interval = demoI < 12 ? 0.15 : DEMO_STEP;
        if (demoStep >= interval) {
          demoStep -= interval;
          demo.visit(demoSeq[demoI++]!);
          demoAnim = 0;
        }
      } else if (demoAnim >= 1) {
        demoDone = demoDone < 0 ? 0 : demoDone + dt;
        if (demoDone > 4.6) demoFade = clamp01((demoDone - 4.6) / 1.2);
        if (demoDone > 6) resetDemo(true);
      }
    }
    if (session.runs > 0) demoOut = Math.min(1, demoOut + dt / 0.4);

    if (session.phase !== "playing") return;
    startT += dt;
    anim = Math.min(1, anim + dt / moveDur);
    if (anim >= 1) ringsT += dt;
    if (endKind) {
      endT += dt;
      if (endKind === "tour" && endT > 0.3 && endT - dt <= 0.3) sound.bell(81);
      if (endKind === "stuck" && endT > 0.34 && endT - dt <= 0.34) sound.pluck(scaleNote(0, 50), 0.8);
      const sendAt = endKind === "time" ? 0.25 : endKind === "stuck" ? 0.7 : 0.8;
      if (!endSent && endT >= sendAt) {
        endSent = true;
        session.end(score, { outcome: endKind === "tour" ? "win" : "lose", stats: { squares: tour.length } });
      }
      return;
    }
    idle += dt;
    clock -= rawDt;
    const whole = Math.ceil(clock);
    if (whole !== lastWhole) {
      lastWhole = whole;
      if (whole <= 10 && whole > 0) sound.tick();
    }
    if (clock <= 0) {
      clock = 0;
      const b = currentBox();
      const pt = perimeterPoint(b, 0);
      smudges.add(pt[0], pt[1], 9);
      sound.bell(57);
      finish("time");
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  let boardCache: HTMLCanvasElement | null = null;
  let cacheKey = "";

  function drawBoard(b: Box, labelAlpha: number) {
    const key = `${b.s.toFixed(1)}:${view.dpr}`;
    const m = 30;
    if (key !== cacheKey || !boardCache) {
      cacheKey = key;
      const c = boardCache ?? document.createElement("canvas");
      c.width = Math.ceil((b.s + m * 2) * view.dpr);
      c.height = Math.ceil((b.s + m * 2) * view.dpr);
      const g = c.getContext("2d")!;
      g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      g.clearRect(0, 0, b.s + m * 2, b.s + m * 2);
      const q = b.s / N;
      // Engraved hatching on the dark squares.
      g.beginPath();
      const step = Math.max(2.6, q / 10);
      for (let r = 0; r < N; r++) {
        for (let cc = 0; cc < N; cc++) {
          if ((r + cc) % 2 === 0) continue;
          const x0 = m + cc * q;
          const y0 = m + r * q;
          for (let k = step * 0.5; k < q * 2; k += step) {
            const xa = Math.max(0, k - q);
            const xb = Math.min(q, k);
            g.moveTo(x0 + xa, y0 + q - (k - xa));
            g.lineTo(x0 + xb, y0 + q - (k - xb));
          }
        }
      }
      g.strokeStyle = rgba(INK, 0.2);
      g.lineWidth = 0.55;
      g.stroke();
      // The grid, fine; the frame, firmer.
      g.beginPath();
      for (let i = 1; i < N; i++) {
        g.moveTo(m + i * q, m);
        g.lineTo(m + i * q, m + b.s);
        g.moveTo(m, m + i * q);
        g.lineTo(m + b.s, m + i * q);
      }
      g.strokeStyle = rgba(INK, 0.32);
      g.lineWidth = 0.6;
      g.stroke();
      g.beginPath();
      g.rect(m, m, b.s, b.s);
      inkStroke(g, 1.15, INK, 0.9);
      boardCache = c;
    }
    ctx.drawImage(boardCache, b.x - m, b.y - m, b.s + m * 2, b.s + m * 2);
    if (labelAlpha > 0) {
      const q = b.s / N;
      ctx.font = italic(Math.max(10, Math.min(13, q * 0.3)));
      ctx.fillStyle = rgba(GRAPHITE, 0.85 * labelAlpha);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (let i = 0; i < N; i++) {
        ctx.fillText("abcdefgh"[i]!, b.x + i * q + q / 2, b.y + b.s + 25);
        ctx.fillText(String(N - i), b.x - 17, b.y + i * q + q / 2 + 4);
      }
    }
  }

  /** A point on the clock's line, which runs clockwise from the top-left corner just outside the frame. */
  function perimeterPoint(b: Box, f: number): [number, number] {
    const o = 8;
    const x0 = b.x - o;
    const y0 = b.y - o;
    const S = b.s + o * 2;
    let d = clamp01(f) * S * 4;
    if (d <= S) return [x0 + d, y0];
    d -= S;
    if (d <= S) return [x0 + S, y0 + d];
    d -= S;
    if (d <= S) return [x0 + S - d, y0 + S];
    d -= S;
    return [x0, y0 + S - d];
  }

  function drawClock(b: Box, f: number, alpha: number, burning: boolean) {
    const o = 8;
    const x0 = b.x - o;
    const y0 = b.y - o;
    const S = b.s + o * 2;
    // Ash: where the line has burned, a faint dotted trace.
    if (f < 1) {
      ctx.save();
      ctx.setLineDash([1, 4]);
      ctx.beginPath();
      ctx.rect(x0, y0, S, S);
      ctx.strokeStyle = rgba(PENCIL, 0.55 * alpha);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
    if (f <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const corners: Array<[number, number]> = [
      [x0 + S, y0],
      [x0 + S, y0 + S],
      [x0, y0 + S],
      [x0, y0],
    ];
    let left = f * S * 4;
    let px = x0;
    let py = y0;
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
    inkStroke(ctx, 1.7, INK, 0.92 * alpha);
    if (!burning) return;
    // The ember: the one warm point on the page, and a thread of smoke.
    const [ex, ey] = perimeterPoint(b, f);
    ctx.fillStyle = rgba(SEAL, 0.95 * alpha);
    ctx.beginPath();
    ctx.arc(ex, ey, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    const sway = reduced ? 0 : Math.sin(time * 1.7) * 3;
    ctx.moveTo(ex, ey - 3);
    ctx.bezierCurveTo(ex + 3 + sway, ey - 8, ex - 4 + sway, ey - 13, ex + 1 + sway * 1.4, ey - 19);
    ctx.strokeStyle = rgba(GRAPHITE, 0.22 * alpha);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function drawTour(t: Tour, b: Box, a: number, alpha: number, numerals: boolean) {
    if (alpha <= 0) return;
    const q = b.s / N;
    const w = Math.max(1.6, q * 0.072);
    const p = t.path;
    for (let i = 1; i < p.length; i++) {
      const [ax, ay] = center(b, p[i - 1]!);
      const [bx, by] = center(b, p[i]!);
      const [cx, cy] = control(ax, ay, bx, by);
      const upto = i === p.length - 1 ? easeInOut(a) : 1;
      brushCurve(ctx, ax, ay, cx, cy, bx, by, upto, w, INK, alpha);
    }
    // Where the knight landed: a dot, and the move's number in the corner.
    ctx.fillStyle = rgba(INK, 0.85 * alpha);
    for (let i = 0; i < p.length; i++) {
      if (i === p.length - 1 && a < 1) continue;
      const [x, y] = center(b, p[i]!);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, q * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
    if (!numerals) return;
    ctx.font = serif(Math.max(8, q * 0.27));
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < p.length; i++) {
      const sq = p[i]!;
      const fade = i === p.length - 1 ? clamp01((a - 0.6) / 0.4) : 1;
      if (fade <= 0) continue;
      ctx.fillStyle = rgba(GRAPHITE, 0.95 * alpha * fade);
      const x = b.x + (sq % N) * q + q * 0.09;
      const y = b.y + Math.floor(sq / N) * q + q * 0.3;
      ctx.fillText(String(i + 1), x, y);
    }
  }

  function knightAt(t: Tour, b: Box, a: number): [number, number, number] {
    const p = t.path;
    const [hx, hy] = center(b, p[p.length - 1]!);
    if (p.length < 2 || a >= 1) return [hx, hy, 0];
    const [ax, ay] = center(b, p[p.length - 2]!);
    const [cx, cy] = control(ax, ay, hx, hy);
    const k = easeInOut(a);
    const [x, y] = quad(ax, ay, cx, cy, hx, hy, k);
    return [x, y, Math.sin(Math.PI * k)];
  }

  function drawKnightOn(t: Tour, b: Box, a: number, ink = INK, alpha = 1) {
    const q = b.s / N;
    const [x, y, hop] = knightAt(t, b, a);
    drawKnight(ctx, x, y - hop * q * 0.08, q * 0.78 * (1 + hop * 0.07), ink, alpha);
  }

  function drawRings(b: Box) {
    if (anim < 1 || endKind) return;
    const q = b.s / N;
    const moves = tour.legal();
    const hint = idle > HINT_AFTER ? tour.warnsdorff(() => 0.5) : null;
    const hk = hint === null ? 0 : clamp01((idle - HINT_AFTER) / 1.4);
    moves.forEach((m, i) => {
      const [x, y] = center(b, m);
      if (m === hint) {
        ctx.fillStyle = rgba(BLUE, 0.16 * hk);
        ctx.beginPath();
        ctx.arc(x, y, q * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }
      const pr = reduced ? 1 : easeOut((ringsT - i * 0.045) / 0.32);
      handRing(ctx, x, y, q * 0.15, pr, m * 0.37, 1.15, m === hint ? BLUE : INK, m === hint ? 0.6 + 0.4 * (1 - hk) : 0.85);
    });
  }

  function drawTitle(alpha: number) {
    if (alpha <= 0) return;
    const { box, L, R, top } = attractBox();
    const width = R - L;
    ctx.save();
    const block = { title: TITLE, kicker: `no. ${issue} · the daily knight`, dek: "a knight’s tour, against a patient clock." };
    drawTitleBlock(ctx, block, L, top, width, time, alpha, reduced);
    // Figure caption, prompt and best under the board.
    const by = box.y + box.s + 48;
    ctx.fillStyle = rgba(GRAPHITE, alpha * clamp01((time - 0.9) / 0.8));
    ctx.textAlign = "left";
    fitText(ctx, "today, everyone sets out from the same square.", box.x - LABEL_GAP, by, box.s + LABEL_GAP, 15);
    drawPrompt(ctx, "tap to begin", box.x - LABEL_GAP, by + 40, time - 1.2, reduced, alpha * clamp01((time - 1) / 0.6), 21);
    if ((session.best ?? 0) > 0) {
      ctx.fillStyle = rgba(GRAPHITE, alpha);
      drawRuns(ctx, [["best ", italic(16)], [String(session.best), serif(17)]], box.x + box.s, by + 40, "right");
    }
    ctx.restore();
  }

  function statusLine(): string {
    if (endKind === "tour") return `every square, and ${words(Math.floor(clock))} seconds to spare.`;
    if (endKind === "stuck") return `${words(tour.length)} squares, then nowhere to go.`;
    if (endKind === "time") return `the clock burned out at ${words(tour.length)} squares.`;
    if (startT < 5) return "every square once. none of them twice.";
    if (clock < 10) return "the line is nearly ash.";
    if (idle > HINT_AFTER + 0.5) return "the faint blue ring is only a suggestion.";
    return `${words(N * N - tour.length)} squares still unvisited.`;
  }

  function drawHud(alpha: number) {
    if (alpha <= 0) return;
    const { box, L, R, top, rule } = playBox();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = rgba(INK, alpha);
    ctx.font = italic(28);
    ctx.fillText(TITLE, L, top + 32);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.font = italic(14);
    ctx.fillText(`no. ${issue} · ${tour.path[0] === today ? "today’s square" : "a square of its own"}`, L + 1, top + 54);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(INK, alpha);
    ctx.font = serif(46);
    ctx.fillText(String(tour.length), R, top + 40);
    ctx.font = italic(14);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.fillText("of sixty-four", R, top + 58);
    handRule(ctx, L, R, rule, 1, 0.8, INK, 0.75 * alpha, 0.4);

    const by = box.y + box.s + 58;
    const secs = endKind ? Math.floor(clock) : Math.ceil(clock);
    ctx.textAlign = "left";
    ctx.font = serif(28);
    ctx.fillStyle = rgba(INK, alpha);
    const sx = box.x - LABEL_GAP;
    ctx.fillText(String(secs), sx, by);
    const nw = ctx.measureText(String(secs)).width;
    ctx.font = italic(16);
    ctx.fillStyle = rgba(GRAPHITE, alpha);
    ctx.fillText(secs === 1 ? "second" : "seconds", sx + nw + 6, by);
    if ((session.best ?? 0) > 0) drawRuns(ctx, [["best ", italic(16)], [String(session.best), serif(18)]], box.x + box.s, by, "right");
    ctx.textAlign = "left";
    ctx.fillStyle = rgba(INK, 0.8 * alpha);
    fitText(ctx, statusLine(), sx, by + 32, box.s + LABEL_GAP, 17);
    if (session.phase === "over" && session.standalone && session.phaseTime > 0.8) {
      drawPrompt(ctx, "tap to begin again", sx, by + 72, session.phaseTime - 0.8, reduced, alpha, 19);
    }
  }

  function render() {
    view.begin();
    const b = currentBox();
    const k = easeInOut(layoutK);
    const playing = session.runs > 0;
    drawBoard(b, 1);

    // Attract demo (fades as a run takes over).
    const demoAlpha = (1 - demoFade) * (1 - demoOut);
    if (demoAlpha > 0) {
      drawTour(demo, b, demoAnim, demoAlpha, true);
      drawKnightOn(demo, b, demoAnim, INK, demoAlpha);
      if (demoDone >= 0) drawSeal(ctx, seal, b.x + b.s - b.s * 0.07, b.y + b.s - b.s * 0.07, b.s * 0.2, demoDone - 0.3, reduced, -0.08, demoAlpha);
    }
    const f = playing ? clock / CLOCK : 1;
    drawClock(b, f, 1, playing && session.phase === "playing" && !endKind);

    if (playing) {
      const ra = demoOut;
      if (session.phase === "playing" && !endKind) drawRings(b);
      drawTour(tour, b, anim, ra, true);
      const ended = endKind === "stuck" || endKind === "time";
      if (ended) {
        const q = b.s / N;
        const [x, y] = center(b, tour.head);
        handRing(ctx, x, y, q * 0.52, reduced ? 1 : easeOut(endT / 0.6), 2.1, 1, GRAPHITE, 0.7 * ra);
      }
      drawKnightOn(tour, b, anim, ended ? GRAPHITE : INK, ra);
      if (endKind === "tour") drawSeal(ctx, seal, b.x + b.s - b.s * 0.07, b.y + b.s - b.s * 0.07, b.s * 0.2, endT - 0.3, reduced, -0.08);
    }
    smudges.draw(ctx);
    drawTitle(1 - clamp01(k * 1.8));
    drawHud(clamp01((k - 0.45) / 0.55));
  }

  // The first moves of the demo are already on the page when it opens.
  for (let i = 0; i < 6 && demoI < demoSeq.length; i++) demo.visit(demoSeq[demoI++]!);

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
