import {
  clamp,
  createAudio,
  createCanvas,
  createRng,
  createSession,
  Counter,
  damp,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  FONT_DISPLAY,
  FONT_MONO,
  HitStop,
  lerp,
  loadFonts,
  onPress,
  Particles,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { forkHead, neonSigns, PAL, pancake } from "./art.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const GRAVITY = 1750;
const FLAP_VY = -520;
const MAX_FALL = 760;
const RADIUS = 17;
const CAKE_SCALE = 1.2;
const FORK_W = 64;
const FLOOR_H = 66;

/** Difficulty 0..1 from the score: speed up, narrower gaps, bigger swings, then bobbing forks. */
function tuning(score: number) {
  const d = clamp(score / 45);
  return {
    speed: lerp(160, 255, d),
    gap: lerp(196, 140, d),
    spacing: lerp(250, 205, d),
    swing: lerp(90, 210, d),
    bob: score >= 14 ? lerp(10, 34, clamp((score - 14) / 30)) : 0,
  };
}

interface Fork {
  x: number;
  gapY: number;
  gap: number;
  bobAmp: number;
  bobPhase: number;
  passed: boolean;
  berry: { dy: number; taken: boolean } | null;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "flapjack" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.wallTop });
  const { ctx } = view;
  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.03, 1.8, session.reducedMotion);
  const hitStop = new HitStop();
  const fx = new Particles(700);
  const popups = new Popups();
  const counter = new Counter(0, 18);

  const S = Math.min(view.dpr, 2);
  const forkSprite = forkHead(S);
  const signs = neonSigns(S, FONT_DISPLAY);
  const cakeTop = pancake(S, false);
  const cakeUnder = pancake(S, true);

  // World state.
  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
  });
  const floorY = () => H - FLOOR_H;
  let forks: Fork[] = [];
  let scroll = 0;
  let score = 0;
  let streak = 0;
  let time = 0;
  let deadT = -1;
  let endSent = false;
  const p = { x: 0, y: 0, vy: 0, flipT: 1, tilt: 0, squash: 0 };
  let flash = 0;
  let titleIn = 0;
  let mode: "attract" | "play" = "attract";

  function obstacleTop(f: Fork): number {
    return f.gapY + Math.sin(time * 2.1 + f.bobPhase) * f.bobAmp - f.gap / 2;
  }

  function spawn(x: number, prevGap: number | null, s: number): Fork {
    const t = tuning(s);
    const top = Math.max(110, session.play().top + 70);
    const bottom = floorY() - 60;
    const center = prevGap === null ? (top + bottom) / 2 : clamp(prevGap + rng.range(-t.swing, t.swing), top + t.gap / 2, bottom - t.gap / 2);
    return {
      x,
      gapY: center,
      gap: t.gap,
      bobAmp: t.bob * (rng.chance(0.55) ? 1 : 0),
      bobPhase: rng.range(0, Math.PI * 2),
      passed: false,
      berry: rng.chance(0.28) ? { dy: rng.range(-t.gap * 0.25, t.gap * 0.25), taken: false } : null,
    };
  }

  function resetWorld(forMode: "attract" | "play") {
    mode = forMode;
    forks = [];
    score = 0;
    streak = 0;
    deadT = -1;
    endSent = false;
    counter.snap(0);
    p.x = Math.round(W * 0.3);
    p.y = H * 0.45;
    p.vy = 0;
    p.flipT = 1;
    let x = W + (forMode === "play" ? 120 : 40);
    let prev: number | null = null;
    for (let i = 0; i < 4; i++) {
      const f = spawn(x, prev, 0);
      if (forMode === "attract") f.berry = null;
      forks.push(f);
      prev = f.gapY;
      x += tuning(0).spacing;
    }
  }

  function flap(byPlayer: boolean) {
    p.vy = FLAP_VY;
    p.flipT = 0;
    p.squash = 1;
    if (!byPlayer) return;
    audio.play("flap", { pitch: rng.range(-1, 2) });
    fx.emit(p.x - 6, p.y + 10, {
      count: 7,
      speed: [40, 140],
      angle: [Math.PI * 0.35, Math.PI * 0.85],
      life: [0.25, 0.5],
      size: [2, 4],
      colors: [PAL.cake, PAL.cakeEdge, PAL.butter],
      gravity: 500,
      drag: 2,
    });
  }

  function die() {
    if (deadT >= 0) return;
    deadT = 0;
    hitStop.freeze(0.09);
    shake.add(0.65);
    flash = 1;
    audio.play("hit");
    audio.play("thud");
    tc.feedback("impact");
    p.vy = -380;
    fx.emit(p.x, p.y, {
      count: 34,
      speed: [120, 420],
      life: [0.4, 0.9],
      size: [3, 7],
      colors: [PAL.syrup, PAL.syrupDeep, PAL.amber, PAL.cake],
      gravity: 900,
      drag: 1.2,
      shape: "circle",
    });
  }

  // Input: taps start runs (on release, Swipe Contract rule 1); during a run a press flaps instantly.
  session.startOnTap(window);
  onPress(window, () => {
    if (session.phase === "playing" && deadT < 0 && mode === "play") flap(true);
  });
  session.on("start", () => {
    resetWorld("play");
    flap(true);
  });
  session.on("cancel", () => {
    /* taps are instantaneous; nothing half-finished to undo */
  });

  resetWorld("attract");

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    shake.update(rawDt);
    fx.update(dt);
    popups.update(rawDt);
    flash = Math.max(0, flash - rawDt * 4);
    titleIn = Math.min(1, titleIn + rawDt * 1.6);
    counter.set(score);
    counter.update(rawDt);

    const t = tuning(mode === "attract" ? 4 : score);
    const alive = deadT < 0;
    const speed = alive ? t.speed : t.speed * Math.max(0, 1 - deadT * 2.5);
    scroll += speed * dt;
    for (const f of forks) f.x -= speed * dt;
    if (forks.length && forks[0]!.x < -FORK_W) forks.shift();
    const last = forks[forks.length - 1];
    if (last && last.x < W + 40) {
      const f = spawn(last.x + t.spacing, last.gapY, mode === "attract" ? 4 : score);
      if (mode === "attract") f.berry = null;
      forks.push(f);
    }

    // Attract-mode pilot: flaps when it sinks below the next gap's center.
    if (mode === "attract") {
      const next = forks.find((f) => f.x + FORK_W / 2 > p.x - RADIUS) ?? forks[0];
      if (next) {
        const target = obstacleTop(next) + next.gap * 0.62;
        if (p.y > target && p.vy > -60) flap(false);
      }
    }

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    p.y += p.vy * dt;
    p.flipT = Math.min(1, p.flipT + dt / 0.34);
    p.squash = damp(p.squash, 0, 10, dt);
    p.tilt = damp(p.tilt, clamp(p.vy / 900, -0.45, 0.9), 12, dt);

    if (p.y < RADIUS) {
      p.y = RADIUS;
      p.vy = Math.max(0, p.vy);
    }

    if (alive) {
      // Collisions.
      if (p.y + RADIUS * 0.8 >= floorY()) {
        p.y = floorY() - RADIUS * 0.8;
        if (mode === "play") die();
        else p.vy = FLAP_VY;
      }
      for (const f of forks) {
        const top = obstacleTop(f);
        const bottom = top + f.gap;
        const left = f.x - FORK_W / 2 + 4;
        const right = f.x + FORK_W / 2 - 4;
        const cx = clamp(p.x, left, right);
        const inX = Math.abs(cx - p.x) < RADIUS;
        if (inX && (p.y - RADIUS * 0.75 < top || p.y + RADIUS * 0.75 > bottom)) {
          if (mode === "play") die();
          else p.vy = p.y > (top + bottom) / 2 ? FLAP_VY : 0;
          break;
        }
        if (f.berry && !f.berry.taken && mode === "play") {
          const by = top + f.gap / 2 + f.berry.dy;
          if (Math.hypot(p.x - f.x, p.y - by) < RADIUS + 10) {
            f.berry.taken = true;
            score += 1;
            audio.play("coin");
            popups.add("+1", f.x, by - 12, PAL.berry, 18);
            fx.emit(f.x, by, { count: 14, speed: [60, 200], life: [0.3, 0.6], size: [2, 4], colors: [PAL.berry, "#9AA6FF", PAL.paper], drag: 3 });
          }
        }
        if (!f.passed && f.x + FORK_W / 2 < p.x - RADIUS) {
          f.passed = true;
          if (mode !== "play") continue;
          score += 1;
          streak += 1;
          const margin = Math.min(p.y - RADIUS - top, bottom - (p.y + RADIUS));
          audio.play("score", { pitch: (streak % 8) * 1.5 });
          if (margin < 12) {
            score += 1;
            popups.add("CLOSE +1", p.x + 30, p.y - 26, PAL.pink, 16);
            audio.play("whoosh");
            shake.add(0.12);
          }
          tc.feedback("tap");
        }
      }
    } else {
      deadT += rawDt;
      if (p.y + RADIUS * 0.8 >= floorY()) {
        p.y = floorY() - RADIUS * 0.8;
        p.vy = -p.vy * 0.25;
      }
      // End within 1 s of game over (we report at 0.45 s, once the impact has read).
      if (!endSent && deadT > 0.45) {
        endSent = true;
        session.end(score, { outcome: "lose" });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawWall() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.wallTop);
    g.addColorStop(1, PAL.wallBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Wall tiles (slow parallax).
    const tile = 26;
    const off = -(scroll * 0.25) % tile;
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let x = off; x < W; x += tile) ctx.fillRect(Math.round(x), 0, 1, floorY() * 0.62);
    for (let y = 0; y < floorY() * 0.62; y += tile) ctx.fillRect(0, y, W, 1);
    // Wainscot: chrome rail + darker panels.
    const railY = Math.round(floorY() * 0.62);
    ctx.fillStyle = PAL.panel;
    ctx.fillRect(0, railY, W, floorY() - railY);
    ctx.fillStyle = PAL.rail;
    ctx.fillRect(0, railY - 3, W, 3);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, railY - 3, W, 1);
    const panel = 58;
    const poff = -(scroll * 0.5) % panel;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    for (let x = poff; x < W; x += panel) ctx.fillRect(Math.round(x), railY + 10, 2, floorY() - railY - 20);
    // Red vinyl booths and steel-edged tables along the wall.
    const boothGap = 210;
    const boff = -(scroll * 0.55) % boothGap;
    const seatTop = floorY() - 118;
    for (let x = boff - boothGap; x < W + boothGap; x += boothGap) {
      for (const dx of [0, 112]) {
        ctx.fillStyle = "#7E1D2A";
        roundRect(ctx, x + dx, seatTop, 30, 118, 8);
        ctx.fill();
        ctx.fillStyle = "#A8303F";
        roundRect(ctx, x + dx + 4, seatTop + 6, 22, 100, 6);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(x + dx + 8, seatTop + 10, 3, 88);
      }
      ctx.fillStyle = PAL.rail;
      ctx.fillRect(x + 38, seatTop + 46, 66, 6);
      ctx.fillStyle = PAL.steelLight;
      ctx.fillRect(x + 38, seatTop + 46, 66, 1.5);
      ctx.fillStyle = "#3B4A52";
      ctx.fillRect(x + 68, seatTop + 52, 6, 66);
    }
    // Neon signs.
    const signSpacing = 240;
    const soff = -(scroll * 0.32) % (signSpacing * signs.length);
    for (let i = -1; i < Math.ceil(W / signSpacing) + 2; i++) {
      const idx = (((i + Math.floor((scroll * 0.32) / (signSpacing * signs.length)) * signs.length) % signs.length) + signs.length) % signs.length;
      const sign = signs[idx]!;
      const x = soff + i * signSpacing;
      const w = sign.width / S;
      const h = sign.height / S;
      const flicker = Math.sin(time * 37 + i * 5) > 0.97 ? 0.35 : 1;
      ctx.globalAlpha = 0.55 * flicker;
      ctx.drawImage(sign, x, railY * 0.42 - h / 2 + (i % 2) * 34, w, h);
    }
    ctx.globalAlpha = 1;
  }

  function drawFork(f: Fork) {
    const top = obstacleTop(f);
    const bottom = top + f.gap;
    const hw = forkSprite.width / S;
    const hh = forkSprite.height / S;
    const x = f.x - hw / 2;
    const steel = ctx.createLinearGradient(f.x - 10, 0, f.x + 10, 0);
    steel.addColorStop(0, PAL.steelDark);
    steel.addColorStop(0.4, PAL.steelLight);
    steel.addColorStop(1, PAL.steelDark);
    // Top fork: handle from the ceiling, tines pointing down at the gap.
    ctx.fillStyle = steel;
    ctx.fillRect(f.x - 10, -4, 20, top - hh + 6);
    ctx.drawImage(forkSprite, x, top - hh, hw, hh);
    // Bottom fork: mirrored.
    ctx.save();
    ctx.translate(0, bottom * 2);
    ctx.scale(1, -1);
    ctx.drawImage(forkSprite, x, bottom - hh, hw, hh);
    ctx.restore();
    ctx.fillStyle = steel;
    ctx.fillRect(f.x - 10, bottom + hh - 2, 20, floorY() - bottom - hh + 4);
    // Shadow on the tine tips toward the gap, for depth.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(f.x - hw / 2 + 4, top - 4, hw - 8, 4);
    if (f.berry && !f.berry.taken) {
      const by = top + f.gap / 2 + f.berry.dy + Math.sin(time * 4 + f.bobPhase) * 3;
      ctx.fillStyle = PAL.berry;
      ctx.beginPath();
      ctx.arc(f.x, by, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2B2F8F";
      ctx.fillRect(f.x - 2, by - 8, 4, 3);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillRect(f.x - 3.5, by - 3.5, 2.5, 2.5);
    }
  }

  function drawFloor() {
    const y = floorY();
    ctx.fillStyle = PAL.floorB;
    ctx.fillRect(0, y, W, FLOOR_H);
    const sq = 22;
    const off = -scroll % (sq * 2);
    for (let row = 0; row < 3; row++) {
      const yy = y + 6 + row * sq;
      for (let x = off + (row % 2) * sq; x < W + sq; x += sq * 2) {
        ctx.fillStyle = PAL.floorA;
        ctx.globalAlpha = 0.9 - row * 0.18;
        ctx.fillRect(Math.round(x), Math.round(yy), sq, sq);
      }
    }
    ctx.globalAlpha = 1;
    // Chrome counter edge.
    ctx.fillStyle = PAL.rail;
    ctx.fillRect(0, y, W, 6);
    ctx.fillStyle = PAL.steelLight;
    ctx.fillRect(0, y, W, 1.5);
  }

  function drawPancake() {
    const k = p.flipT;
    // A flip: the cake goes edge-on halfway and shows its freckled underside.
    const sy = Math.cos(k * Math.PI * 2) * (1 - p.squash * 0.25);
    const sx = 1 + p.squash * 0.18;
    const sprite = Math.abs(k - 0.5) < 0.25 ? cakeUnder : cakeTop;
    const w = sprite.width / S;
    const h = sprite.height / S;
    // Drop shadow on the floor.
    const fy = floorY();
    const dist = clamp((fy - p.y) / H);
    ctx.fillStyle = `rgba(0,0,0,${0.32 * (1 - dist)})`;
    ctx.beginPath();
    ctx.ellipse(p.x, fy + 4, 18 * (1 - dist * 0.6), 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt + (deadT >= 0 ? deadT * 9 : 0));
    ctx.scale(sx * CAKE_SCALE, Math.max(0.12, Math.abs(sy)) * CAKE_SCALE);
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawUi() {
    const phase = session.phase;
    const cx = (W - session.safe().right) / 2 + session.safe().left / 2;
    if (mode === "play") {
      if (phase === "playing") {
        const top = session.play().top;
        drawNumber(ctx, counter.shown < score ? Math.round(counter.shown) : score, W / 2, top + 44, 44, PAL.paper);
      } else if (session.standalone && session.phaseTime > 0.7) {
        // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
        const r = safeRect(session.preview(), W, H);
        drawNumber(ctx, score, cx, r.y + 70, 56, PAL.paper);
        drawTapPrompt(ctx, cx, r.y + r.h - 24, time, PAL.amber, "TAP TO FLIP AGAIN");
      }
      return;
    }
    const r = safeRect(session.preview(), W, H);
    const k = easeOutBack(titleIn);
    const titleY = r.y + 70;
    // The diner's sign: a dark plate with a neon edge, so the title reads over the demo.
    const plateW = Math.min(r.w, 300);
    const plateH = session.best !== null ? 132 : 112;
    ctx.save();
    ctx.translate(cx, titleY);
    ctx.scale(k, k);
    ctx.fillStyle = "rgba(6,15,19,0.9)";
    roundRect(ctx, -plateW / 2, -70, plateW, plateH, 18);
    ctx.fill();
    const flick = Math.sin(time * 31) > 0.985 ? 0.4 : 1;
    ctx.strokeStyle = rgba(PAL.amber, 0.9 * flick);
    ctx.lineWidth = 2;
    ctx.shadowColor = PAL.amber;
    ctx.shadowBlur = 14 * flick;
    roundRect(ctx, -plateW / 2 + 5, -65, plateW - 10, plateH - 10, 14);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.rotate(-0.04);
    drawTitle(ctx, "FLAPJACK", 0, 0, plateW - 36, PAL.amber, 52, PAL.syrupDeep);
    ctx.restore();
    drawLabel(ctx, "A MIDNIGHT DINER FLYER", cx, titleY + 24, rgba(PAL.paper, 0.75), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, titleY + 46, PAL.amber, 13);
    drawTapPrompt(ctx, cx, r.y + r.h - 24, time, PAL.paper);
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    drawWall();
    for (const f of forks) drawFork(f);
    drawFloor();
    fx.draw(ctx);
    drawPancake();
    popups.draw(ctx, FONT_MONO);
    ctx.restore();
    if (mode === "attract") {
      // Dim the demo slightly so the title reads.
      ctx.fillStyle = "rgba(11,26,32,0.35)";
      ctx.fillRect(0, 0, W, H);
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,236,200,${flash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawUi();
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
  session.on("attract", () => resetWorld("attract"));
}

void main();
