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
  FONT_DISPLAY,
  FONT_MONO,
  hsl,
  loadFonts,
  midiToFreq,
  onPress,
  Particles,
  PENTATONIC,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
  HitStop,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { answerPoint, inkButtons, judge, LABELS, makeRound, oddCells, type Area, type Kind, type Round } from "./rounds.ts";

const PAL = {
  bg: "#0B0F14",
  panel: "#141A22",
  panelHi: "#1E2632",
  accent: "#00E5C7",
  accentDeep: "#00806F",
  heat: "#FF4A3D",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E6A78",
  ink: "#0D0D10",
} as const;

const KINDS: Kind[] = ["wait", "odd", "ink", "pop"];
const LIVES = 3;
const GAP = 0.55;

async function main() {
  const [session] = await Promise.all([createSession({ id: "reflex" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(14, 0.03, 2, session.reducedMotion);
  const hitStop = new HitStop();
  const fx = new Particles(600);
  const popups = new Popups();
  const counter = new Counter(0, 14);

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
  });

  let mode: "attract" | "play" = "attract";
  let round: Round | null = null;
  let lastKind: Kind | null = null;
  let level = 0;
  let lives = LIVES;
  let score = 0;
  let streak = 0;
  let gap = 0.8;
  let intro = 0;
  let dead: { t: number } | null = null;
  let endSent = false;
  let time = 0;
  let flash: { t: number; color: string } = { t: 1, color: PAL.heat };
  let titleIn = 0;
  let lostPip = { i: -1, t: 1 };
  let ghost: { at: number; x: number; y: number; done: boolean } | null = null;
  let fastest: number | null = null;

  const mult = () => 1 + Math.min(3, Math.floor(streak / 3));

  function area(): Area {
    if (mode === "attract") {
      const r = safeRect(session.preview(), W, H);
      const top = r.y + 168;
      const bottom = r.y + r.h - 66;
      const size = Math.max(120, Math.min(r.w - 28, bottom - top));
      return { x: r.x + (r.w - size) / 2, y: top + (bottom - top - size) / 2, size };
    }
    const top = session.play().top + 128;
    const size = Math.min(W - 48, H - top - 64, 420);
    return { x: (W - size) / 2, y: top + Math.max(0, (H - top - 40 - size) * 0.4), size };
  }

  function nextRound() {
    let kind: Kind;
    if (mode === "play" && level === 0) kind = "wait";
    else {
      do kind = rng.pick(KINDS);
      while (kind === lastKind);
    }
    lastKind = kind;
    round = makeRound(kind, mode === "attract" ? 4 : level, rng);
    if (mode === "attract") {
      const delay = round.kind === "wait" ? 0.32 : rng.range(0.55, 0.85);
      ghost = { at: round.liveAt + delay, x: 0, y: 0, done: false };
    } else ghost = null;
  }

  function resolve(ok: boolean, text: string, x: number, y: number) {
    if (!round || round.result) return;
    const a = area();
    if (ok) {
      const elapsed = Math.max(0, round.t - round.liveAt);
      const speed = clamp(1 - elapsed / round.limit);
      streak++;
      const points = Math.round((100 + 150 * speed) * mult());
      round.result = { ok, at: round.t, text: `+${points}`, points, x, y };
      if (mode === "play") {
        score += points;
        level++;
        const ms = Math.round(elapsed * 1000);
        popups.add(`+${points}`, x, y - 20, PAL.accent, 26, 0.75);
        if (round.kind === "wait") {
          popups.add(`${ms} MS`, a.x + a.size / 2, a.y + a.size / 2 + a.size * 0.2, PAL.ink, 16, 0.7);
          if (fastest === null || ms < fastest) fastest = ms;
        }
        const step = PENTATONIC[Math.min(PENTATONIC.length - 1, streak)] ?? 0;
        audio.note(midiToFreq(67 + step), 0.12, "triangle", 0.32);
        audio.play("blip", { pitch: streak });
        tc.feedback("tap");
        if (streak % 3 === 0 && mult() > 1) {
          popups.add(`STREAK ×${mult()}`, W / 2, a.y - 54, PAL.paper, 18, 1);
          audio.play("powerup");
        }
      }
      fx.emit(x, y, { count: 22, speed: [80, 300], life: [0.3, 0.6], size: [3, 6], colors: [PAL.accent, PAL.paper, "#7FFFF0"], drag: 3, spin: [-6, 6] });
      flash = { t: 0, color: PAL.accent };
      shake.add(0.06);
    } else {
      round.result = { ok, at: round.t, text, points: 0, x, y };
      streak = 0;
      if (mode === "play") {
        lives--;
        lostPip = { i: lives, t: 0 };
        popups.add(text, W / 2, a.y + a.size / 2, PAL.heat, 24, 0.9);
        audio.play("error");
        audio.play("thud");
        tc.feedback("fail");
        shake.add(0.45);
        hitStop.freeze(0.08);
        flash = { t: 0, color: PAL.heat };
        if (lives <= 0) {
          dead = { t: 0 };
          audio.play("lose");
        }
      }
    }
    gap = GAP;
  }

  function tap(x: number, y: number) {
    if (mode !== "play" || session.phase !== "playing" || session.paused || dead || intro > 0) return;
    if (!round || round.result) return;
    const v = judge(round, area(), x, y);
    if (v) resolve(v.ok, v.text, x, y);
  }

  function reset(forMode: "attract" | "play") {
    mode = forMode;
    level = 0;
    lives = LIVES;
    score = 0;
    streak = 0;
    dead = null;
    endSent = false;
    lastKind = null;
    round = null;
    gap = 0;
    intro = forMode === "play" ? 0.9 : 0;
    counter.snap(0);
    lostPip = { i: -1, t: 1 };
    fastest = null;
    if (forMode === "attract") nextRound();
  }

  session.startOnTap(window);
  session.on("start", () => {
    reset("play");
    audio.play("select");
  });
  onPress(window, tap);

  reset("attract");

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    shake.update(rawDt);
    fx.update(dt);
    popups.update(rawDt);
    flash.t += rawDt;
    lostPip.t += rawDt;
    counter.set(score);
    counter.update(rawDt);

    if (dead) {
      dead.t += rawDt;
      if (!endSent && dead.t > 0.45) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { rounds: level } });
      }
      return;
    }
    if (intro > 0) {
      intro -= dt;
      if (intro <= 0) nextRound();
      return;
    }
    if (!round) return;
    if (round.result) {
      gap -= dt;
      if (gap <= 0) nextRound();
      return;
    }
    round.t += dt;
    if (round.kind === "wait" && round.t >= round.liveAt && round.t - dt < round.liveAt && mode === "play") audio.play("tick", { pitch: 7 });
    if (ghost && !ghost.done && round.t >= ghost.at) {
      ghost.done = true;
      const p = answerPoint(round, area());
      ghost.x = p.x;
      ghost.y = p.y;
      resolve(true, "", p.x, p.y);
    }
    if (round.t > round.liveAt + round.limit) {
      const a = area();
      resolve(false, "TOO SLOW", a.x + a.size / 2, a.y + a.size / 2);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawWait(r: Round, a: Area) {
    const live = r.t >= r.liveAt || (r.result?.ok ?? false);
    const cx = a.x + a.size / 2;
    const cy = a.y + a.size / 2;
    const k = live ? easeOutBack(clamp((r.t - r.liveAt) / 0.18)) : 1;
    const rad = a.size * 0.38 * (live ? 0.9 + 0.1 * k : 1 + 0.02 * Math.sin(time * 6));
    if (!live) {
      const failed = !!r.result && !r.result.ok;
      ctx.fillStyle = failed ? rgba(PAL.heat, 0.22) : PAL.panelHi;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(PAL.heat, 0.5 + 0.4 * Math.sin(time * 8));
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.font = `${Math.round(a.size * 0.09)}px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.dim;
      if (!failed) ctx.fillText("WAIT…", cx, cy);
      return;
    }
    ctx.fillStyle = r.result && !r.result.ok ? PAL.heat : PAL.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `900 ${Math.round(a.size * 0.16)}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = PAL.ink;
    ctx.fillText("NOW", cx, cy);
  }

  function drawOdd(r: Round, a: Area) {
    const o = r.odd!;
    const cells = oddCells(r, a);
    cells.forEach((c, i) => {
      const k = easeOutBack(clamp((r.t - i * 0.015) / 0.25));
      const s = c.s * k;
      const reveal = r.result && i === o.index;
      ctx.fillStyle = hsl(o.hue, 0.62, i === o.index ? o.light + o.delta : o.light);
      roundRect(ctx, c.x + (c.s - s) / 2, c.y + (c.s - s) / 2, s, s, s * 0.16);
      ctx.fill();
      if (reveal) {
        ctx.strokeStyle = r.result!.ok ? PAL.paper : PAL.heat;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    });
  }

  function drawInk(r: Round, a: Area) {
    const ink = r.ink!;
    const k = easeOutBack(clamp(r.t / 0.25));
    ctx.save();
    ctx.translate(a.x + a.size / 2, a.y + a.size * 0.3);
    ctx.scale(k, k);
    ctx.font = `900 ${Math.round(a.size * (ink.word.name.length > 4 ? 0.19 : 0.24))}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink.ink.hex;
    ctx.fillText(ink.word.name, 0, 0);
    ctx.restore();
    inkButtons(a).forEach((b, i) => {
      const opt = ink.options[i]!;
      const kk = easeOutBack(clamp((r.t - 0.08 - i * 0.05) / 0.22));
      const h = b.h * kk;
      ctx.fillStyle = opt.hex;
      roundRect(ctx, b.x, b.y + (b.h - h), b.w, h, 12);
      ctx.fill();
      if (kk > 0.8) drawLabel(ctx, opt.name, b.x + b.w / 2, b.y + b.h - 14, rgba(PAL.ink, 0.75), 10);
      if (r.result && opt === ink.ink) {
        ctx.strokeStyle = PAL.paper;
        ctx.lineWidth = 4;
        roundRect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 14);
        ctx.stroke();
      }
    });
  }

  function drawPop(r: Round, a: Area) {
    const p = answerPoint(r, a);
    const k = Math.max(0, 1 - Math.max(0, r.t - r.liveAt) / r.limit);
    const appear = easeOutBack(clamp(r.t / 0.2));
    const rad = r.pop!.r * a.size * (0.45 + 0.55 * k) * appear;
    if (rad <= 1) return;
    const rings = [PAL.accent, PAL.ink, PAL.paper, PAL.ink, PAL.accent];
    rings.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad * (1 - i * 0.2), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawRound(a: Area) {
    if (!round) return;
    const r = round;
    // Panel.
    ctx.fillStyle = PAL.panel;
    roundRect(ctx, a.x - 14, a.y - 14, a.size + 28, a.size + 28, 22);
    ctx.fill();
    if (r.kind === "wait") drawWait(r, a);
    else if (r.kind === "odd") drawOdd(r, a);
    else if (r.kind === "ink") drawInk(r, a);
    else drawPop(r, a);
    // Label + timer.
    drawLabel(ctx, LABELS[r.kind], a.x + a.size / 2, a.y - 38, PAL.paper, 13);
    const live = r.t >= r.liveAt;
    const left = live ? clamp(1 - (r.t - r.liveAt) / r.limit) : 1;
    const bw = a.size + 28;
    ctx.fillStyle = PAL.panelHi;
    roundRect(ctx, a.x - 14, a.y - 24, bw, 4, 2);
    ctx.fill();
    if (live && !r.result) {
      ctx.fillStyle = left < 0.3 ? PAL.heat : PAL.accent;
      roundRect(ctx, a.x - 14, a.y - 24, bw * left, 4, 2);
      ctx.fill();
    }
    if (ghost?.done && mode === "attract" && r.result) {
      // The attract demo's ghost finger.
      const k = clamp((r.t - r.result.at) / 0.4);
      ctx.strokeStyle = rgba(PAL.paper, 1 - k);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, 14 + k * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(PAL.paper, 0.7 * (1 - k));
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud() {
    const top = session.play().top;
    drawLabel(ctx, "SCORE", 20, top + 12, PAL.mute, 10, "left");
    drawNumber(ctx, Math.round(counter.shown), 20, top + 36, 32, PAL.paper, "left");
    drawLabel(ctx, `ROUND ${level + (round && !round.result ? 1 : 0)}`, W / 2, top + 12, PAL.mute, 10);
    if (mult() > 1) {
      ctx.fillStyle = PAL.accent;
      roundRect(ctx, W / 2 - 22, top + 24, 44, 22, 6);
      ctx.fill();
      ctx.font = `900 14px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.ink;
      ctx.fillText(`×${mult()}`, W / 2, top + 35);
    }
    for (let i = 0; i < LIVES; i++) {
      const x = W - 20 - (LIVES - 1 - i) * 26 - 9;
      const y = top + 36;
      const alive = i < lives;
      if (i === lostPip.i && lostPip.t < 0.5) {
        const k = lostPip.t / 0.5;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = PAL.heat;
        const s = 18 * (1 + k);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = alive ? PAL.accent : "transparent";
      ctx.strokeStyle = alive ? PAL.accent : PAL.mute;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(x - 8, y - 8, 16, 16);
      if (alive) ctx.fill();
      else ctx.stroke();
    }
    drawLabel(ctx, "LIVES", W - 20, top + 12, PAL.mute, 10, "right");
    const a0 = area();
    const statY = a0.y + a0.size + 48;
    if (statY < H - 16) {
      drawLabel(ctx, "FASTEST REACTION", W / 2, statY, PAL.mute, 10);
      drawNumber(ctx, fastest === null ? "—" : `${fastest} MS`, W / 2, statY + 22, 18, fastest === null ? PAL.mute : PAL.accent);
    }
    if (intro > 0) {
      const a = area();
      const k = 1 - intro / 0.9;
      ctx.save();
      ctx.translate(a.x + a.size / 2, a.y + a.size / 2);
      const s = easeOutBack(clamp(k * 2.5));
      ctx.scale(s, s);
      drawTitle(ctx, "READY", 0, 18, a.size, PAL.accent, 64, PAL.accentDeep);
      ctx.restore();
    }
  }

  function drawAttract() {
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(titleIn);
    ctx.save();
    ctx.translate(cx, r.y + 58);
    ctx.scale(k, k);
    drawTitle(ctx, "REFLEX", 0, 0, r.w, PAL.accent, 62, PAL.accentDeep);
    ctx.restore();
    drawLabel(ctx, "FOUR TESTS · ONE THUMB", cx, r.y + 84, rgba(PAL.paper, 0.78), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 104, PAL.paper, 13);
    drawTapPrompt(ctx, cx, r.y + r.h - 22, time, PAL.paper);
  }

  function render() {
    view.begin();
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);
    // Live-moment wash.
    if (round && round.kind === "wait" && round.t >= round.liveAt && !round.result) {
      ctx.fillStyle = rgba(PAL.accent, 0.08);
      ctx.fillRect(0, 0, W, H);
    }
    // Faint scanlines for texture.
    ctx.fillStyle = "rgba(255,255,255,0.018)";
    for (let y = (time * 20) % 6; y < H; y += 6) ctx.fillRect(0, y, W, 1);
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    const a = area();
    if (mode === "play" && intro > 0) {
      ctx.fillStyle = PAL.panel;
      roundRect(ctx, a.x - 14, a.y - 14, a.size + 28, a.size + 28, 22);
      ctx.fill();
    } else drawRound(a);
    fx.draw(ctx);
    popups.draw(ctx, FONT_DISPLAY);
    ctx.restore();
    if (flash.t < 0.25) {
      ctx.fillStyle = rgba(flash.color, (1 - flash.t / 0.25) * (flash.color === PAL.heat ? 0.3 : 0.12));
      ctx.fillRect(0, 0, W, H);
    }
    if (mode === "attract") drawAttract();
    else {
      drawHud();
      if (session.phase === "over" && session.phaseTime > 0.7) {
        const r = safeRect(session.preview(), W, H);
        drawTapPrompt(ctx, r.x + r.w / 2, r.y + r.h - 22, time, PAL.accent, "TAP TO PLAY AGAIN");
      }
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
