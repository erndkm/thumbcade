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
  easeOutBack,
  easeOutCubic,
  FONT_DISPLAY,
  HitStop,
  lerp,
  loadFonts,
  midiToFreq,
  mix,
  onKeys,
  onSwipe,
  Particles,
  PENTATONIC,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
  type Dir as KitDir,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { PAL, drawTile, tileStyle } from "./art.ts";
import { Board, bestMove, N, type Dir, type Tile } from "./board.ts";

// ---------------------------------------------------------------------------
// Tuning: the fuse
// ---------------------------------------------------------------------------
const SLIDE = 0.1;
const FUSE_START = 9;
const FUSE_MAX = 10;
/** Seconds of fuse a merge buys: bigger merges buy more. */
const refill = (value: number) => 0.32 + 0.09 * Math.log2(value);
/** Burn rate (fuse seconds per second) grows with time survived. */
const drain = (elapsed: number) => 1 + elapsed / 40;
const DUD_BURN = 0.6;

interface Ghost {
  tile: Tile;
  until: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "merge" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const board = new Board(rng);
  const shake = new Shake(10, 0.02, 2, session.reducedMotion);
  const hitStop = new HitStop();
  const fx = new Particles(700);
  const popups = new Popups();
  const counter = new Counter(0, 16);
  const layoutT = new Spring(0, 170, 24);
  const nudge = { x: new Spring(0, 520, 18), y: new Spring(0, 520, 18) };

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
  });

  let time = 0;
  let slideStart = -1;
  let ghosts: Ghost[] = [];
  let score = 0;
  let fuse = FUSE_START;
  let elapsed = 0;
  let mode: "attract" | "play" = "attract";
  let over: { t: number; reason: string } | null = null;
  let endSent = false;
  let aiTimer = 0.8;
  let bestTileShown = 0;
  let lastWarn = 0;
  let titleIn = 0;
  const pending: Array<{ at: number; run: () => void }> = [];
  let waves: Array<{ x: number; y: number; r0: number; t: number; color: string }> = [];

  function newBoard() {
    board.reset();
    ghosts = [];
    board.spawn(time, 2);
    board.spawn(time, 2);
  }

  function boardRect(): { x: number; y: number; size: number } {
    const a = (() => {
      const r = safeRect(session.preview(), W, H);
      const size = Math.min(r.w, r.h - 210, 300);
      return { x: r.x + (r.w - size) / 2, y: r.y + 128 + (r.h - 128 - 70 - size) / 2, size };
    })();
    const p = (() => {
      const top = session.play().top + 108;
      const size = Math.min(W - 44, H - top - 64, 460);
      return { x: (W - size) / 2, y: top + Math.max(0, (H - top - size) * 0.45), size };
    })();
    const k = clamp(layoutT.value, 0, 1.08);
    return { x: lerp(a.x, p.x, k), y: lerp(a.y, p.y, k), size: lerp(a.size, p.size, k) };
  }

  function cellCenter(r: number, c: number, b = boardRect()) {
    const gap = b.size * 0.03;
    const cell = (b.size - gap * (N + 1)) / N;
    return { x: b.x + gap + cell / 2 + c * (cell + gap), y: b.y + gap + cell / 2 + r * (cell + gap), cell };
  }

  function doMove(dir: Dir, player: boolean) {
    if (over) return;
    const res = board.move(dir, time);
    if (!res.moved) {
      if (!player) return;
      const k = 9;
      nudge.x.kick(dir === "left" ? -k * 30 : dir === "right" ? k * 30 : 0);
      nudge.y.kick(dir === "up" ? -k * 30 : dir === "down" ? k * 30 : 0);
      fuse = Math.max(0, fuse - DUD_BURN);
      audio.play("error", { volume: 0.7 });
      popups.add(`-${DUD_BURN}s`, W / 2, session.play().top + 68, PAL.heat, 16, 0.6);
      return;
    }
    slideStart = time;
    ghosts.push(...res.ghosts.map((tile) => ({ tile, until: time + SLIDE })));
    board.spawn(time + SLIDE * 0.9);
    audio.play("click", { volume: 0.8, pitch: rng.range(-2, 2) });
    if (player) {
      score += res.gained;
      let bought = 0;
      for (const m of res.merges) bought += refill(m.value);
      if (res.merges.length >= 2) bought += 0.4 * (res.merges.length - 1);
      fuse = Math.min(FUSE_MAX, fuse + bought);
      if (bought > 0) popups.add(`+${bought.toFixed(1)}s`, W / 2, session.play().top + 68, PAL.accent, 16, 0.7);
    }
    const merges = res.merges.slice();
    const chain = merges.length;
    pending.push({
      at: time + SLIDE,
      run: () => {
        merges.forEach((m, i) => {
          const { x, y, cell } = cellCenter(m.r, m.c);
          const st = tileStyle(m.value);
          fx.emit(x, y, { count: 10 + Math.min(18, Math.log2(m.value) * 2), speed: [80, 260], life: [0.25, 0.55], size: [3, 7], colors: [st.fill, st.lip, PAL.paper], drag: 3.5, spin: [-8, 8] });
          waves.push({ x, y, r0: cell * 0.5, t: 0, color: st.fill });
          const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.log2(m.value) - 1)] ?? 0;
          window.setTimeout(() => audio.note(midiToFreq(60 + step), 0.16, "triangle", 0.26), i * 45);
          if (m.value >= 128 && m.value > bestTileShown && player) {
            bestTileShown = m.value;
            popups.add(`${m.value}!`, x, y - cell * 0.7, tileStyle(m.value).fill, 34, 1.1);
            shake.add(0.35);
            hitStop.freeze(0.06);
            audio.play("powerup");
            tc.analytics.track("milestone", { tile: m.value });
          }
        });
        if (chain >= 2 && player) {
          const b = boardRect();
          popups.add(`CHAIN ×${chain}`, b.x + b.size / 2, b.y - 18, PAL.pink, 22, 0.9);
          shake.add(0.08 + chain * 0.05);
          audio.play("score", { pitch: chain * 2 });
        } else if (chain === 1) shake.add(0.06);
        if (!board.canMove() && mode === "play") gameOver("NO MOVES LEFT");
        if (!board.canMove() && mode === "attract") window.setTimeout(newBoard, 900);
      },
    });
  }

  function gameOver(reason: string) {
    if (over) return;
    over = { t: 0, reason };
    shake.add(0.55);
    hitStop.freeze(0.1);
    audio.play("lose");
    tc.feedback("fail");
    const b = boardRect();
    for (const t of board.tiles()) {
      const { x, y } = cellCenter(t.r, t.c, b);
      const st = tileStyle(t.value);
      fx.emit(x, y, { count: 6, speed: [40, 180], life: [0.4, 0.9], size: [3, 6], colors: [st.fill, st.lip], gravity: 600, drag: 1 });
    }
  }

  session.startOnTap(window);
  session.on("start", () => {
    mode = "play";
    over = null;
    endSent = false;
    score = 0;
    fuse = FUSE_START;
    elapsed = 0;
    bestTileShown = 0;
    counter.snap(0);
    newBoard();
    layoutT.target = 1;
    audio.play("select");
  });
  const swipe = (d: KitDir) => {
    if (session.phase === "playing" && mode === "play") doMove(d, true);
  };
  onSwipe(window, swipe, { threshold: 22 });
  onKeys({ up: () => swipe("up"), down: () => swipe("down"), left: () => swipe("left"), right: () => swipe("right") });

  newBoard();

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    shake.update(rawDt);
    fx.update(dt);
    popups.update(rawDt);
    layoutT.update(rawDt);
    nudge.x.update(rawDt);
    nudge.y.update(rawDt);
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    counter.set(score);
    counter.update(rawDt);
    ghosts = ghosts.filter((g) => g.until > time);
    for (const w of waves) w.t += dt;
    waves = waves.filter((w) => w.t < 0.4);
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i]!.at <= time) {
        const p = pending.splice(i, 1)[0]!;
        p.run();
      }
    }

    if (mode === "attract") {
      aiTimer -= dt;
      if (aiTimer <= 0) {
        aiTimer = 0.42 + rng.range(0, 0.25);
        const d = bestMove(board.values());
        if (d) doMove(d, false);
        else newBoard();
      }
      return;
    }
    if (over) {
      over.t += rawDt;
      if (over.t > 0.6) layoutT.target = 0;
      if (!endSent && over.t > 0.35) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { maxTile: board.maxValue(), seconds: Math.round(elapsed) } });
      }
      return;
    }
    elapsed += dt;
    fuse -= drain(elapsed) * dt;
    if (fuse < 3 && time - lastWarn > 0.5) {
      lastWarn = time;
      audio.play("tick", { pitch: 12 - fuse * 3 });
    }
    // Embers off the burning end of the fuse.
    if (rng.chance(0.7)) {
      const p = fusePoint(clamp(fuse / FUSE_MAX));
      fx.emit(p.x, p.y, { count: 1, speed: [30, 120], life: [0.2, 0.5], size: [2, 3.5], colors: [fuse < 3 ? PAL.heat : PAL.pink, PAL.paper, "#FFD84D"], gravity: 220, drag: 1 });
    }
    if (fuse <= 0) {
      fuse = 0;
      gameOver("FUSE OUT");
    }
  }

  /** The fuse runs clockwise around the board from the top-left corner; f = remaining fraction. */
  function fusePerimeter() {
    const b = boardRect();
    const m = 12;
    const x = b.x - m;
    const y = b.y - m;
    const w = b.size + m * 2;
    const h = b.size + m * 2;
    const r = b.size * 0.06 + m;
    const arc = (Math.PI * r) / 2;
    const segs = [w - 2 * r, arc, h - 2 * r, arc, w - 2 * r, arc, h - 2 * r, arc];
    const total = segs.reduce((a, v) => a + v, 0);
    return { x, y, w, h, r, segs, total };
  }

  function fusePoint(f: number): { x: number; y: number } {
    const P = fusePerimeter();
    let d = f * P.total;
    const { x, y, w, h, r } = P;
    const corners = [
      [x + w - r, y + r, -Math.PI / 2],
      [x + w - r, y + h - r, 0],
      [x + r, y + h - r, Math.PI / 2],
      [x + r, y + r, Math.PI],
    ] as const;
    const lines = [
      [x + r, y, 1, 0],
      [x + w, y + r, 0, 1],
      [x + w - r, y + h, -1, 0],
      [x, y + h - r, 0, -1],
    ] as const;
    for (let i = 0; i < 4; i++) {
      const len = P.segs[i * 2]!;
      const L = lines[i]!;
      if (d <= len) return { x: L[0] + L[2] * d, y: L[1] + L[3] * d };
      d -= len;
      const C = corners[i]!;
      if (d <= P.segs[i * 2 + 1]!) {
        const a = C[2] + d / r;
        return { x: C[0] + Math.cos(a) * r, y: C[1] + Math.sin(a) * r };
      }
      d -= P.segs[i * 2 + 1]!;
    }
    return { x: x + r, y };
  }

  function drawFuse() {
    const P = fusePerimeter();
    const f = clamp(fuse / FUSE_MAX);
    const low = fuse < 3 && !over;
    // Burnt track.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 3;
    roundRect(ctx, P.x, P.y, P.w, P.h, P.r);
    ctx.stroke();
    if (f <= 0) return;
    ctx.strokeStyle = low ? mix(PAL.heat, PAL.paper, 0.5 + 0.5 * Math.sin(time * 14)) : PAL.accent;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    const steps = Math.max(2, Math.ceil((P.total * f) / 6));
    for (let i = 0; i <= steps; i++) {
      const p = fusePoint((f * i) / steps);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    const tip = fusePoint(f);
    const glow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 18);
    glow.addColorStop(0, rgba(low ? PAL.heat : PAL.pink, 0.8));
    glow.addColorStop(1, rgba(PAL.pink, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(tip.x - 18, tip.y - 18, 36, 36);
    ctx.fillStyle = PAL.paper;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4 + Math.sin(time * 30) * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWaves() {
    for (const w of waves) {
      const k = w.t / 0.4;
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r0 * (0.9 + easeOutCubic(k) * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawBackground() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);
    const b = boardRect();
    const glow = ctx.createRadialGradient(b.x + b.size / 2, b.y + b.size / 2, b.size * 0.1, b.x + b.size / 2, b.y + b.size / 2, b.size * 1.1);
    glow.addColorStop(0, rgba(PAL.accent, mode === "play" && fuse < 3 && !over ? 0.1 + 0.08 * Math.sin(time * 12) : 0.14));
    glow.addColorStop(1, rgba(PAL.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    // Drifting plus-sign field.
    ctx.fillStyle = "rgba(180,140,255,0.07)";
    const step = 34;
    const off = (time * 6) % step;
    for (let y = -step + off; y < H + step; y += step)
      for (let x = ((y / step) % 2) * (step / 2); x < W + step; x += step) {
        ctx.fillRect(x - 4, y - 1, 8, 2);
        ctx.fillRect(x - 1, y - 4, 2, 8);
      }
  }

  function drawBoard() {
    const b = boardRect();
    const ox = nudge.x.value * 0.02;
    const oy = nudge.y.value * 0.02;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.fillStyle = PAL.boardLip;
    roundRect(ctx, b.x, b.y + 8, b.size, b.size, b.size * 0.06);
    ctx.fill();
    ctx.fillStyle = PAL.board;
    roundRect(ctx, b.x, b.y, b.size, b.size, b.size * 0.06);
    ctx.fill();
    const k = slideStart < 0 ? 1 : easeOutCubic(clamp((time - slideStart) / SLIDE));
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const { x, y, cell } = cellCenter(r, c, b);
        ctx.fillStyle = PAL.cell;
        roundRect(ctx, x - cell / 2, y - cell / 2, cell, cell, cell * 0.16);
        ctx.fill();
      }
    const pos = (t: Tile) => {
      const from = cellCenter(t.fromR, t.fromC, b);
      const to = cellCenter(t.r, t.c, b);
      return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), cell: to.cell };
    };
    for (const g of ghosts) {
      const p = pos(g.tile);
      drawTile(ctx, g.tile.value, p.x, p.y, p.cell);
    }
    const dimmed = over ? clamp(over.t * 3) : 0;
    for (const t of board.tiles()) {
      if (time < t.born) continue;
      const p = pos(t);
      let s = p.cell;
      const age = time - t.born;
      if (age < 0.18) s *= easeOutBack(clamp(age / 0.18));
      const sinceMerge = time - t.mergedAt - SLIDE;
      let value = t.value;
      if (t.mergedAt >= 0 && time - t.mergedAt < SLIDE) value = t.value / 2;
      if (t.mergedAt >= 0 && sinceMerge >= 0 && sinceMerge < 0.2) s *= 1 + 0.2 * Math.sin((sinceMerge / 0.2) * Math.PI);
      drawTile(ctx, value, p.x, p.y, s, 1 - dimmed * 0.55);
    }
    ctx.restore();
  }

  function drawHud() {
    const top = session.play().top;
    drawNumber(ctx, Math.round(counter.shown), 20, top + 32, 40, PAL.paper, "left");
    drawLabel(ctx, "SCORE", 22, top + 6, PAL.mute, 10, "left");
    drawLabel(ctx, "BEST", W - 20, top + 6, PAL.mute, 10, "right");
    drawNumber(ctx, Math.max(session.best ?? 0, score).toLocaleString("en-US"), W - 20, top + 30, 20, PAL.dim, "right");
    const low = fuse < 3 && !over;
    drawLabel(ctx, `FUSE ${fuse.toFixed(1)}s`, 22, top + 68, low ? PAL.heat : PAL.dim, 11, "left");
    if (elapsed < 4 && !over) drawLabel(ctx, "SWIPE TO MERGE", W - 20, top + 68, PAL.accent, 11, "right");
    // Biggest tile so far, under the board.
    const b = boardRect();
    const y = b.y + b.size + 52;
    if (y < H - 20 && !over) {
      const big = board.maxValue();
      drawLabel(ctx, "BIGGEST", W / 2 - 14, y, PAL.mute, 11, "right");
      drawTile(ctx, big, W / 2 + 8, y - 1, 30);
    }
  }

  function drawAttract() {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(titleIn);
    ctx.save();
    ctx.translate(cx, r.y + 60);
    ctx.scale(k, k);
    drawTitle(ctx, "MERGE", 0, 0, r.w, PAL.accent, 60, "#3B2A66");
    ctx.restore();
    drawLabel(ctx, "SLIDE · MERGE · BEAT THE FUSE", cx, r.y + 86, rgba(PAL.paper, 0.75), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 106, PAL.paper, 13);
    drawTapPrompt(ctx, cx, r.y + r.h - 22, time, PAL.paper);
  }

  function drawOver() {
    if (!over) return;
    const b = boardRect();
    const a = clamp(over.t * 4);
    ctx.save();
    ctx.globalAlpha = a;
    const s = 1 + 0.25 * (1 - easeOutBack(clamp(over.t * 3)));
    ctx.translate(b.x + b.size / 2, b.y + b.size / 2);
    ctx.scale(s, s);
    ctx.font = `900 ${Math.round(b.size * 0.11)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PAL.bgDeep;
    ctx.fillText(over.reason, 0, 4);
    ctx.fillStyle = over.reason === "FUSE OUT" ? PAL.heat : PAL.paper;
    ctx.fillText(over.reason, 0, 0);
    ctx.restore();
    if (session.phase === "over" && session.phaseTime > 0.7) {
      const r = safeRect(session.preview(), W, H);
      drawTapPrompt(ctx, r.x + r.w / 2, r.y + r.h - 22, time, PAL.accent, "TAP TO PLAY AGAIN");
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
    drawWaves();
    fx.draw(ctx);
    popups.draw(ctx, FONT_DISPLAY);
    ctx.restore();
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
