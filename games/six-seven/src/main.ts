import {
  clamp,
  Counter,
  createAudio,
  createCanvas,
  createMusic,
  createRng,
  createSession,
  damp,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  easeOutCubic,
  FONT_DISPLAY,
  loadFonts,
  midiToFreq,
  onKeys,
  Particles,
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
import { drawBoard, drawDesk, drawKid, drawTeacher, glowSprite, palm, PAL, restPose, type Mood, type TeacherLook } from "./art.ts";
import {
  CAUGHT,
  CAUGHT_GRACE,
  drainPerSecond,
  FUMBLE,
  GAIN,
  nextVisit,
  teacherPhase,
  tierOf,
  TIER_NAMES,
  visitOver,
  type Side,
  type TeacherPhase,
  type TeacherVisit,
} from "./rules.ts";

const SND = {
  six: { wave: "square", freq: midiToFreq(62), duration: 0.09, volume: 0.15, lowpass: 2400, punch: 2 },
  seven: { wave: "square", freq: midiToFreq(67), duration: 0.11, volume: 0.15, lowpass: 2600, punch: 2 },
  step: { wave: "sine", freq: 150, freqEnd: 70, duration: 0.09, volume: 0.35, punch: 2.5 },
  ahem: { wave: "sawtooth", freq: 210, freqEnd: 160, duration: 0.24, volume: 0.1, lowpass: 900, vibrato: [0.6, 7] },
  whistle: { wave: "sine", freq: 2200, duration: 0.42, volume: 0.18, vibrato: [1.4, 26] },
  phew: { wave: "triangle", freq: 520, freqEnd: 900, duration: 0.16, volume: 0.2 },
} satisfies Record<string, SfxParams>;
const TIER_PITCH = [0, 2, 4, 7];
/** Teacher slide (0 hidden, 1 leaning in) per phase. */
const PEEK = 0.42;

async function main() {
  const [session] = await Promise.all([createSession({ id: "six-seven" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const music = createMusic(audio, {
    bpm: 134,
    stepsPerBeat: 2,
    wave: "triangle",
    volume: 0.05,
    steps: [38, null, 38, 50, null, 38, 45, null, 41, null, 41, 53, null, 41, 43, 45],
  });
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.03, 2, session.reducedMotion);
  const fx = new Particles(500);
  const popups = new Popups();
  const counter = new Counter(0, 18);
  // Photosensitivity: getting caught and the 67 milestone share one capped, rate-limited flash.
  const light = new Photosafe(session.reducedMotion);
  const flash = light.flash({ alpha: 0.2, decay: 0.3 });

  let W = view.width;
  let H = view.height;
  view.onResize((w, h) => {
    W = w;
    H = h;
    wall = null;
  });
  let wall: CanvasGradient | null = null;

  const handL = new Spring(0, 520, 20);
  const handR = new Spring(0, 520, 20);
  const bob = new Spring(0, 420, 15);
  const sway = new Spring(0, 150, 6);
  const pose = restPose();
  let lookTarget = 0;

  let mode: "attract" | "play" = "attract";
  let time = 0;
  /** Run clock (the demo's clock in attract). */
  let clock = 0;
  /** Run time without the teacher's stares: what the drain ramps on. */
  let active = 0;
  let hype = 1;
  let count = 0;
  let combo = 0;
  let bestCombo = 0;
  let expect: Side = "six";
  let visit: TeacherVisit = attractVisit(4.5);
  let visitSide: -1 | 1 = -1;
  let caught = false;
  let caughtCount = 0;
  let fumbles = 0;
  let lastPress = -9;
  let moodTimer = 0;
  let moodHold: Mood = "happy";
  let dead: { t: number } | null = null;
  let endSent = false;
  let titleIn = 0;
  let demoNext = 0.5;
  let prevPhase: TeacherPhase = "away";
  let stepTwo = false;
  let slide = 0;
  let slump = 0;
  const zone = { six: 0, seven: 0 };
  const lay = { cx: 0, desk: 0, k: 1, init: false };

  function attractVisit(at: number): TeacherVisit {
    return { at, warn: 0.8, watch: 1.4 };
  }

  function layoutTarget(): { cx: number; desk: number; k: number } {
    if (mode === "attract") {
      const r = safeRect(session.preview(), W, H);
      const top = r.y + 128;
      const desk = r.y + r.h - 54;
      return { cx: r.x + r.w / 2, desk, k: clamp(Math.min(r.w / 440, (desk - top) / 420), 0.3, 1.3) };
    }
    const ins = session.play();
    const top = ins.top + 124;
    const floor = H - ins.bottom - Math.max(112, H * 0.165);
    const w = W - ins.left - ins.right;
    const k = clamp(Math.min(w / 450, (floor - top) / 420), 0.3, 1.3);
    // On tall screens the spare height goes to the tap zones under the desk, not to a gap under the HUD.
    return { cx: ins.left + w / 2, desk: Math.min(floor, top + 470 * k), k };
  }

  const sx = (x: number) => lay.cx + x * lay.k;
  const sy = (y: number) => lay.desk + y * lay.k;
  const headY = () => sy(-262 + pose.bob);

  function palmAt(side: Side): { x: number; y: number } {
    const s = side === "six" ? -1 : 1;
    const p = palm(s, side === "six" ? pose.left : pose.right);
    return { x: sx(p.x), y: sy(p.y) };
  }

  function press(side: Side, demo: boolean) {
    if (!demo) {
      if (mode !== "play" || session.phase !== "playing" || session.paused || dead) return;
      const tp = teacherPhase(visit, clock);
      if (tp.phase === "watch") {
        if (!caught && tp.k * visit.watch > CAUGHT_GRACE) getCaught();
        return;
      }
    }
    zone[side] = 1;
    lastPress = time;
    const s = side === "six" ? -1 : 1;
    if (side !== expect) {
      fumble(side, demo);
      return;
    }
    if (side === "six") {
      handL.target = -1;
      handR.target = 1;
      handL.kick(-10);
      pose.kickLeft = 1;
    } else {
      handR.target = -1;
      handL.target = 1;
      handR.kick(-10);
      pose.kickRight = 1;
    }
    bob.kick(70);
    sway.kick(-s * 3.2);
    pose.shout = 1;
    lookTarget = s;
    const p = palmAt(side);
    // Above where the hand is headed, not where it is: it is still on its way up.
    const top = palm(s, -1);
    popups.add(side === "six" ? "6" : "7", sx(top.x - s * 14), sy(top.y - 70), side === "six" ? PAL.paper : PAL.accentHi, Math.round(56 * lay.k), 0.42);
    fx.emit(p.x, p.y, {
      count: 5,
      speed: [70, 210],
      angle: [-Math.PI * 0.85, -Math.PI * 0.15],
      life: [0.2, 0.38],
      size: [3, 5],
      colors: [PAL.accent, PAL.paper],
      drag: 4,
      gravity: 320,
    });
    expect = side === "six" ? "seven" : "six";
    if (demo) return;
    const tier = tierOf(combo);
    hype = Math.min(1, hype + GAIN);
    audio.play(side === "six" ? SND.six : SND.seven, { pitch: TIER_PITCH[tier] ?? 0, pan: s * 0.35 });
    if (side === "seven") {
      count++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      session.feedback("tap");
      const next = tierOf(combo);
      if (next > tier) {
        popups.add(TIER_NAMES[next] ?? "", W / 2, headY() - 150 * lay.k, PAL.accentHi, 30, 0.9);
        audio.play("coin");
      }
      if (count % 67 === 0) milestone();
    }
  }

  function fumble(side: Side, demo: boolean) {
    const s = side === "six" ? -1 : 1;
    (side === "six" ? handL : handR).kick(-4);
    sway.kick(s * 2);
    moodHold = "confused";
    moodTimer = 0.35;
    if (demo) return;
    hype = Math.max(0, hype - FUMBLE);
    combo = 0;
    fumbles++;
    audio.play("error");
    popups.add("?!", sx(s * 60), headY() - 110 * lay.k, PAL.heat, 30, 0.5);
    shake.add(0.12);
  }

  function getCaught() {
    caught = true;
    caughtCount++;
    hype = Math.max(0, hype - CAUGHT);
    combo = 0;
    moodHold = "shock";
    moodTimer = 0.8;
    audio.play(SND.whistle);
    audio.play("hit");
    session.feedback("impact");
    shake.add(0.45);
    flash.trigger(PAL.heat);
    popups.add("CAUGHT", W / 2, headY() - 150 * lay.k, PAL.heat, 40, 0.9);
  }

  function milestone() {
    audio.play("powerup");
    audio.play("win");
    session.feedback("success");
    popups.add(`${count}!`, W / 2, headY() - 30 * lay.k, PAL.paper, 76, 1.1);
    fx.emit(W / 2, headY(), {
      count: 90,
      speed: [220, 640],
      life: [0.8, 1.4],
      size: [5, 9],
      colors: [PAL.accent, PAL.paper, PAL.accentHi, "#FFD23F"],
      gravity: 700,
      drag: 1.2,
      spin: [-10, 10],
    });
    flash.trigger(PAL.accent, 0.6);
    shake.add(0.3);
  }

  function die() {
    dead = { t: 0 };
    music.stop();
    audio.play("lose");
    audio.play("thud");
    shake.add(0.25);
    popups.add("OUT OF HYPE", W / 2, headY() - 150 * lay.k, PAL.heat, 30, 1.2);
  }

  /** Sounds and cues when the teacher's visit changes phase (play only). */
  function teacherCues(phase: TeacherPhase, k: number) {
    if (phase !== prevPhase) {
      if (phase === "warn") {
        audio.play(SND.step, { pan: visitSide * 0.7 });
        stepTwo = false;
      } else if (phase === "watch") audio.play(SND.ahem, { pan: visitSide * 0.5 });
      else if (phase === "leave" && !caught) {
        audio.play(SND.phew);
        popups.add("GO!", W / 2, headY() - 150 * lay.k, PAL.accentHi, 34, 0.6);
      }
      prevPhase = phase;
    }
    if (phase === "warn" && !stepTwo && k > 0.5) {
      stepTwo = true;
      audio.play(SND.step, { pan: visitSide * 0.7, pitch: -2 });
    }
  }

  session.startOnTap(window);
  session.on("start", () => {
    mode = "play";
    clock = 0;
    active = 0;
    hype = 1;
    count = 0;
    combo = 0;
    bestCombo = 0;
    expect = "six";
    visit = nextVisit(rng, null);
    visitSide = rng.chance(0.5) ? -1 : 1;
    caught = false;
    caughtCount = 0;
    fumbles = 0;
    dead = null;
    endSent = false;
    moodTimer = 0;
    prevPhase = "away";
    counter.snap(0);
    popups.clear();
    fx.clear();
    audio.play("select");
    music.start();
  });
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (session.phase === "playing" && !dead) music.start();
  });
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    press(e.clientX < W / 2 ? "six" : "seven", false);
  });
  onKeys({ left: () => press("six", false), right: () => press("seven", false) });

  function update(dt: number) {
    session.tick(dt);
    time += dt;
    titleIn = Math.min(1, titleIn + dt * 1.5);
    shake.update(dt);
    fx.update(dt);
    popups.update(dt);
    flash.update(dt);
    counter.set(count);
    counter.update(dt);
    zone.six = Math.max(0, zone.six - dt * 5);
    zone.seven = Math.max(0, zone.seven - dt * 5);

    const tgt = layoutTarget();
    if (!lay.init) {
      Object.assign(lay, tgt);
      lay.init = true;
    } else {
      lay.cx = damp(lay.cx, tgt.cx, 8, dt);
      lay.desk = damp(lay.desk, tgt.desk, 8, dt);
      lay.k = damp(lay.k, tgt.k, 8, dt);
    }

    if (mode === "play" && session.phase === "playing" && !dead) {
      clock += dt;
      const tp = teacherPhase(visit, clock);
      if (tp.phase !== "watch") {
        active += dt;
        hype -= drainPerSecond(active) * dt;
      }
      teacherCues(tp.phase, tp.k);
      if (visitOver(visit, clock)) {
        visit = nextVisit(rng, visit);
        visitSide = rng.chance(0.5) ? -1 : 1;
        caught = false;
      }
      if (hype <= 0) {
        hype = 0;
        die();
      }
    } else if (mode === "attract") {
      clock += dt;
      const tp = teacherPhase(visit, clock);
      if (visitOver(visit, clock)) {
        visit = attractVisit(clock + rng.range(4.5, 6.5));
        visitSide = visitSide === -1 ? 1 : -1;
      }
      // The demo kid freezes a beat after the footsteps, like a player would.
      const quiet = tp.phase === "watch" || (tp.phase === "warn" && tp.k * visit.warn > 0.22);
      demoNext -= dt;
      if (demoNext <= 0) {
        if (!quiet) press(expect, true);
        demoNext = rng.range(0.17, 0.23);
      }
    }
    if (dead) {
      dead.t += dt;
      if (!endSent && dead.t > 0.45) {
        endSent = true;
        session.end(count, { outcome: "lose", stats: { bestCombo, caught: caughtCount, fumbles } });
      }
    }

    // The kid.
    const tp = teacherPhase(visit, clock);
    const freezing = tp.phase === "watch" && !caught && !dead;
    if (freezing) {
      handL.target = 1.5;
      handR.target = 1.5;
    } else if (time - lastPress > 0.4) {
      handL.target = 0;
      handR.target = 0;
      lookTarget = 0;
    }
    pose.left = handL.update(dt);
    pose.right = handR.update(dt);
    pose.bob = bob.update(dt);
    pose.sway = sway.update(dt);
    pose.kickLeft = Math.max(0, pose.kickLeft - dt * 5);
    pose.kickRight = Math.max(0, pose.kickRight - dt * 5);
    pose.shout = Math.max(0, pose.shout - dt * 4.5);
    moodTimer -= dt;
    pose.mood = dead ? "out" : moodTimer > 0 ? moodHold : freezing ? "innocent" : "happy";
    const innocent = pose.mood === "innocent";
    pose.lookX = damp(pose.lookX, innocent ? -0.6 : lookTarget, 14, dt);
    pose.lookY = damp(pose.lookY, innocent ? -0.8 : 0, 14, dt);
    pose.tilt = damp(pose.tilt, innocent ? -0.08 : 0.06 * (pose.left - pose.right) * 0.5, 10, dt);
    pose.tier = mode === "play" ? tierOf(combo) : 1;
    slump = damp(slump, dead ? 1 : 0, 7, dt);
    pose.slump = slump;
    pose.t = time;

    // The teacher's lean.
    const lean = tp.phase === "warn" ? PEEK * easeOutCubic(clamp(tp.k * 2.2)) : tp.phase === "watch" ? 1 : tp.phase === "leave" ? 1 - tp.k : 0;
    slide = tp.phase === "watch" ? damp(slide, 1, 22, dt) : tp.phase === "away" ? damp(slide, 0, 12, dt) : lean;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------------------------------------------

  function drawWall() {
    if (!wall) {
      wall = ctx.createLinearGradient(0, 0, 0, H);
      wall.addColorStop(0, PAL.wallTop);
      wall.addColorStop(1, PAL.wallLow);
    }
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    // Faint tile grid.
    ctx.fillStyle = rgba(PAL.accent, 0.035);
    const step = 32;
    for (let x = ((W / 2) % step) - 1; x < W; x += step) ctx.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, 1);
  }

  function drawTeacherLayer() {
    if (slide <= 0.01) return;
    const tp = teacherPhase(visit, clock);
    const ins = mode === "attract" ? session.preview() : session.play();
    const edge = visitSide < 0 ? ins.left : W - ins.right;
    const k = lay.k;
    const x = edge - visitSide * (-72 + 132 * slide) * k;
    const y = sy(-292);
    const look: TeacherLook = moodTimer > 0 && moodHold === "shock" ? "yell" : tp.phase === "watch" ? "watch" : "peek";
    const glow = tp.phase === "watch" ? 1 : 0.3;
    if (tp.phase === "watch") {
      // Their line of sight: a steady warm tint from that edge.
      const g = ctx.createLinearGradient(edge, 0, edge - visitSide * W * 0.6, 0);
      g.addColorStop(0, rgba(PAL.heat, 0.13));
      g.addColorStop(1, rgba(PAL.heat, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    drawTeacher(ctx, visitSide, look, glow, time);
    ctx.restore();
    if (look !== "peek") {
      const s = glowSprite(PAL.heat);
      const size = 120 * k;
      ctx.drawImage(s, x - visitSide * 32 * k - size / 2, y - 4 * k - size / 2, size, size);
    }
    if (tp.phase === "warn") {
      ctx.save();
      ctx.translate(x - visitSide * 20 * k, y - 104 * k + Math.sin(time * 9) * 3);
      const s = easeOutBack(clamp(tp.k * 4));
      ctx.scale(s, s);
      ctx.font = `900 ${Math.round(46 * k)}px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.heat;
      ctx.fillText("!", 0, 0);
      ctx.restore();
    }
  }

  function drawAura() {
    const tier = pose.tier;
    if (tier <= 0 || dead) return;
    const s = glowSprite(PAL.accent);
    const size = (360 + 90 * tier) * lay.k * (1 + 0.04 * pose.shout);
    ctx.globalAlpha = Math.min(1, 0.35 + 0.25 * tier);
    ctx.drawImage(s, lay.cx - size / 2, sy(-200) - size / 2, size, size);
    ctx.globalAlpha = 1;
  }

  function drawZones() {
    const ins = session.play();
    const y = Math.min(H - ins.bottom - 52, sy(18) + (H - ins.bottom - sy(18)) * 0.5);
    const size = Math.round(clamp(lay.k * 70, 40, 84));
    const tp = teacherPhase(visit, clock);
    const locked = tp.phase === "watch" && !dead;
    for (const side of ["six", "seven"] as const) {
      const x = side === "six" ? W * 0.25 : W * 0.75;
      const hot = zone[side];
      if (hot > 0) {
        const g = glowSprite(PAL.accent);
        const gs = size * 3 * (0.8 + 0.2 * hot);
        ctx.globalAlpha = hot;
        ctx.drawImage(g, x - gs / 2, y - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
      }
      ctx.font = `900 ${size}px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = side === "six" ? "6" : "7";
      if (locked) {
        ctx.strokeStyle = rgba(PAL.heat, 0.6);
        ctx.lineWidth = 2;
        ctx.strokeText(label, x, y);
      } else if (side === expect && !dead) {
        ctx.fillStyle = rgba(PAL.accent, 0.55 + 0.45 * Math.max(hot, light.pulse(time, 1.5)));
        ctx.fillText(label, x, y);
      } else {
        ctx.strokeStyle = rgba(PAL.paper, 0.28 + 0.5 * hot);
        ctx.lineWidth = 2;
        ctx.strokeText(label, x, y);
      }
      if (side === expect && count < 2 && !locked && !dead) drawLabel(ctx, "TAP HERE", x, y + size * 0.62, PAL.paper, 11);
    }
    // The split.
    ctx.fillStyle = rgba(PAL.paper, 0.08);
    ctx.fillRect(W / 2 - 0.5, sy(30), 1, H - sy(30) - ins.bottom - 12);
  }

  function drawHud() {
    const top = session.play().top;
    drawLabel(ctx, "SIX SEVENS", W / 2, top + 14, PAL.mute, 10);
    drawNumber(ctx, Math.round(counter.shown), W / 2, top + 46, 44, PAL.paper);
    const bw = Math.min(W - 140, 230);
    const bx = W / 2 - bw / 2;
    const by = top + 78;
    ctx.fillStyle = rgba(PAL.paper, 0.1);
    roundRect(ctx, bx, by, bw, 10, 5);
    ctx.fill();
    const low = hype < 0.25;
    ctx.fillStyle = low ? rgba(PAL.heat, 0.55 + 0.45 * light.pulse(time, 2)) : PAL.accent;
    if (hype > 0) {
      roundRect(ctx, bx, by, Math.max(10, bw * hype), 10, 5);
      ctx.fill();
    }
    drawLabel(ctx, "HYPE", bx - 10, by + 5, low ? PAL.heat : PAL.mute, 10, "right");
    const tier = tierOf(combo);
    if (tier > 0) {
      drawLabel(ctx, TIER_NAMES[tier] ?? "", 20, top + 14, PAL.accentHi, 11, "left");
      drawLabel(ctx, `${combo} IN A ROW`, 20, top + 30, PAL.mute, 10, "left");
    }
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, W - 20, top + 14, PAL.mute, 10, "right");
    if (dead) return;
    const tp = teacherPhase(visit, clock);
    if (tp.phase === "warn") {
      drawLabel(ctx, "TEACHER INCOMING", W / 2, by + 30, rgba(PAL.heat, 0.55 + 0.45 * light.pulse(time, 2)), 12);
    } else if (tp.phase === "watch" && !caught) {
      ctx.save();
      ctx.translate(W / 2, by + 62);
      const s = easeOutBack(clamp(tp.k * visit.watch * 6));
      ctx.scale(s, s);
      drawTitle(ctx, "FREEZE", 0, 0, W - 80, PAL.heat, 34, rgba(PAL.ink, 0.6));
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
    drawTitle(ctx, "SIX SEVEN", 0, 0, r.w - 10, PAL.accent, 60, PAL.accentDeep);
    ctx.restore();
    drawLabel(ctx, "LEFT HAND SIX · RIGHT HAND SEVEN", cx, r.y + 84, rgba(PAL.paper, 0.78), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 104, PAL.paper, 13);
    drawTapPrompt(ctx, cx, r.y + r.h - 22, time, PAL.paper);
  }

  function render() {
    view.begin();
    drawWall();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    ctx.save();
    ctx.translate(lay.cx, lay.desk);
    ctx.scale(lay.k, lay.k);
    drawBoard(ctx);
    ctx.restore();
    drawAura();
    drawTeacherLayer();
    ctx.save();
    ctx.translate(lay.cx, lay.desk);
    ctx.scale(lay.k, lay.k);
    drawKid(ctx, pose);
    drawDesk(ctx, (H - lay.desk) / lay.k + 40, W / lay.k / 2 + 40);
    ctx.restore();
    if (mode === "play") drawZones();
    fx.draw(ctx);
    popups.draw(ctx, FONT_DISPLAY);
    ctx.restore();
    flash.draw(ctx, W, H);
    if (mode === "attract") drawAttract();
    else {
      drawHud();
      if (session.phase === "over" && session.standalone && session.phaseTime > 0.7) {
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
