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
  HitStop,
  lerp,
  loadFonts,
  midiToFreq,
  mix,
  onKeys,
  onSwipe,
  Particles,
  PENTATONIC,
  Photosafe,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { DELTA, inside, key, OPPOSITE, pilot, type Cell, type Dir } from "./snake.ts";

const PAL = {
  bg: "#06120C",
  floorA: "#0A1B11",
  floorB: "#0C2015",
  accent: "#4DFF88",
  tail: "#139A55",
  belly: "#0B5E33",
  berry: "#FF4F6E",
  berryDeep: "#B8213F",
  leaf: "#7CF0A0",
  gold: "#FFD84D",
  paper: "#F3F0E8",
  dim: "#A7A3AE",
  mute: "#6E7A70",
  ink: "#0D0D10",
} as const;

const COLS = 13;
const COMBO_WINDOW = 3.2;

async function main() {
  const [session] = await Promise.all([createSession({ id: "snek" }), loadFonts()]);
  const view = createCanvas({ maxDpr: 2, background: PAL.bg });
  const { ctx } = view;
  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(12, 0.025, 1.8, session.reducedMotion);
  // Flashes and pulses go through Photosafe: capped at 2 Hz, faint/still under reduced motion.
  const light = new Photosafe(session.reducedMotion);
  // Red-dominant, so Photosafe caps it lower (0.18) and keeps it single.
  const flash = light.flash({ alpha: 0.25, decay: 0.32 });
  const STAR_PULSE = { still: 0.5 };
  const hitStop = new HitStop();
  const fx = new Particles(900);
  const popups = new Popups();
  const counter = new Counter(0, 16);

  let W = view.width;
  let H = view.height;
  const A = { x: 0, y: 0, cell: 24, cols: COLS, rows: 20 };
  function layout() {
    const top = session.play().top + 52;
    A.cell = Math.floor((W - 20) / COLS);
    A.rows = Math.max(10, Math.floor((H - top - 14) / A.cell));
    A.x = Math.round((W - A.cell * COLS) / 2);
    A.y = Math.round(top + (H - top - 14 - A.rows * A.cell) / 2);
  }
  layout();
  view.onResize((w, h) => {
    W = w;
    H = h;
    layout();
  });

  let mode: "attract" | "play" = "attract";
  let body: Cell[] = [];
  let prev: Cell[] = [];
  let dir: Dir = "up";
  const queue: Dir[] = [];
  let acc = 0;
  let grow = 0;
  let food: Cell = { x: 0, y: 0 };
  let bonus: { cell: Cell; t: number; life: number } | null = null;
  /** Stones that appear as the run goes on: the arena gets tighter. */
  let rocks = new Map<number, { cell: Cell; born: number }>();
  let foods = 0;
  let score = 0;
  let combo = 0;
  let lastEat = -99;
  let gulps: number[] = [];
  let dead: { t: number; popped: number } | null = null;
  let endSent = false;
  let time = 0;
  let titleIn = 0;
  const fireflies = Array.from({ length: 18 }, () => ({ x: rng.range(0, 1), y: rng.range(0, 1), p: rng.range(0, 6.28), s: rng.range(0.4, 1) }));

  const speed = () => (mode === "attract" ? 10 : Math.min(15, 7 + foods * 0.22));
  const center = (c: Cell) => ({ x: A.x + (c.x + 0.5) * A.cell, y: A.y + (c.y + 0.5) * A.cell });

  function freeCell(minDist: number): Cell {
    const taken = new Set([...body.map(key), ...rocks.keys()]);
    if (bonus) taken.add(key(bonus.cell));
    taken.add(key(food));
    const head = body[0] ?? { x: 0, y: 0 };
    for (let tries = 0; tries < 400; tries++) {
      const c = { x: rng.int(0, COLS - 1), y: rng.int(0, A.rows - 1) };
      if (taken.has(key(c))) continue;
      if (tries < 300 && Math.abs(c.x - head.x) + Math.abs(c.y - head.y) < minDist) continue;
      return c;
    }
    return { x: 0, y: 0 };
  }

  function reset(forMode: "attract" | "play") {
    mode = forMode;
    const hx = Math.floor(COLS / 2);
    const hy = forMode === "play" ? A.rows - 6 : Math.floor(A.rows * 0.6);
    body = [0, 1, 2, 3].map((i) => ({ x: hx, y: hy + i }));
    prev = body.map((c) => ({ ...c }));
    dir = "up";
    queue.length = 0;
    acc = 0;
    grow = 0;
    foods = 0;
    score = 0;
    combo = 0;
    lastEat = -99;
    gulps = [];
    dead = null;
    endSent = false;
    bonus = null;
    rocks = new Map();
    counter.snap(0);
    food = { x: -1, y: -1 };
    food = freeCell(5);
  }

  function eat(isBonus: boolean) {
    const at = center(isBonus && bonus ? bonus.cell : food);
    combo = time - lastEat < COMBO_WINDOW ? Math.min(5, combo + 1) : 1;
    lastEat = time;
    const gain = (isBonus ? 50 : 10) * combo;
    if (mode === "play") {
      score += gain;
      tc.feedback("tap");
    }
    grow += isBonus ? 3 : 2;
    gulps.push(0);
    const colors = isBonus ? [PAL.gold, PAL.paper, "#FFE98A"] : [PAL.berry, PAL.berryDeep, PAL.leaf, PAL.paper];
    fx.emit(at.x, at.y, { count: isBonus ? 30 : 16, speed: [60, isBonus ? 320 : 220], life: [0.3, 0.7], size: [2, 5], colors, drag: 3, spin: [-6, 6] });
    if (mode === "play") {
      popups.add(combo > 1 ? `+${gain} ×${combo}` : `+${gain}`, at.x, at.y - A.cell * 0.7, isBonus ? PAL.gold : PAL.accent, isBonus ? 22 : 17, 0.8);
      const step = PENTATONIC[Math.min(PENTATONIC.length - 1, combo + 1)] ?? 0;
      audio.note(midiToFreq(64 + step), 0.12, "triangle", 0.3);
      audio.play(isBonus ? "powerup" : "pop", { pitch: combo });
      shake.add(isBonus ? 0.22 : 0.07);
    }
    if (isBonus) bonus = null;
    else {
      foods++;
      food = freeCell(4);
      if (foods % 5 === 0 && !bonus) bonus = { cell: freeCell(6), t: 0, life: 6 };
      if (mode === "play" && foods >= 6 && foods % 3 === 0 && rocks.size < 14) {
        const c = freeCell(5);
        rocks.set(key(c), { cell: c, born: time });
        audio.play("thud", { volume: 0.5 });
        const p = center(c);
        fx.emit(p.x, p.y, { count: 10, speed: [40, 140], life: [0.3, 0.6], size: [2, 4], colors: ["#3B4A40", "#5C6E62"], drag: 3 });
      }
    }
  }

  function die() {
    if (dead) return;
    dead = { t: 0, popped: 0 };
    hitStop.freeze(0.12);
    shake.add(0.7);
    flash.trigger(PAL.berry);
    audio.play("hit");
    audio.play("lose");
    tc.feedback("impact");
  }

  function step() {
    if (mode === "attract") dir = pilot({ cols: COLS, rows: A.rows }, body, dir, bonus?.cell ?? food, new Set(rocks.keys()));
    else {
      while (queue.length) {
        const d = queue.shift()!;
        if (d !== OPPOSITE[dir] && d !== dir) {
          dir = d;
          break;
        }
      }
    }
    const head = body[0]!;
    const n = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y };
    const growing = grow > 0;
    const hitSelf = body.slice(0, growing ? body.length : body.length - 1).some((c) => c.x === n.x && c.y === n.y);
    if (!inside({ cols: COLS, rows: A.rows }, n) || hitSelf || rocks.has(key(n))) {
      if (mode === "play") die();
      else reset("attract");
      return;
    }
    prev = body.map((c) => ({ ...c }));
    body.unshift(n);
    if (growing) {
      grow--;
      prev.push({ ...prev[prev.length - 1]! });
    } else body.pop();
    if (mode === "play") audio.play("tick", { volume: 0.35, pitch: -6 });
    if (n.x === food.x && n.y === food.y) eat(false);
    else if (bonus && n.x === bonus.cell.x && n.y === bonus.cell.y) eat(true);
    if (mode === "attract" && body.length > 46) reset("attract");
  }

  session.startOnTap(window);
  session.on("start", () => {
    reset("play");
    audio.play("select");
  });
  const steer = (d: Dir) => {
    if (session.phase !== "playing" || mode !== "play" || dead) return;
    const last = queue[queue.length - 1] ?? dir;
    if (d === last || d === OPPOSITE[last] || queue.length >= 2) return;
    queue.push(d);
  };
  onSwipe(window, steer, { threshold: 18 });
  onKeys({ up: () => steer("up"), down: () => steer("down"), left: () => steer("left"), right: () => steer("right") });

  reset("attract");

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += dt;
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    shake.update(rawDt);
    fx.update(dt);
    popups.update(rawDt);
    flash.update(rawDt);
    counter.set(score);
    counter.update(rawDt);
    gulps = gulps.map((g) => g + dt * 16).filter((g) => g < body.length + 2);
    if (bonus) {
      bonus.t += dt;
      if (bonus.t > bonus.life) bonus = null;
    }
    if (dead) {
      dead.t += rawDt;
      const target = Math.min(body.length, Math.floor(dead.t / 0.035));
      while (dead.popped < target) {
        const c = center(body[dead.popped]!);
        const k = dead.popped / Math.max(1, body.length - 1);
        fx.emit(c.x, c.y, { count: 6, speed: [40, 200], life: [0.3, 0.7], size: [3, 6], colors: [mix(PAL.accent, PAL.tail, k), PAL.belly, PAL.paper], gravity: 300, drag: 1.5, spin: [-8, 8] });
        if (dead.popped % 3 === 0) audio.play("pop", { pitch: -dead.popped * 0.4, volume: 0.5 });
        dead.popped++;
      }
      if (!endSent && dead.t > 0.5) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { length: body.length, foods } });
      }
      return;
    }
    acc += dt * speed();
    while (acc >= 1 && !dead) {
      acc -= 1;
      step();
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawArena() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);
    const w = COLS * A.cell;
    const h = A.rows * A.cell;
    ctx.save();
    roundRect(ctx, A.x, A.y, w, h, 14);
    ctx.clip();
    ctx.fillStyle = PAL.floorA;
    ctx.fillRect(A.x, A.y, w, h);
    ctx.fillStyle = PAL.floorB;
    for (let y = 0; y < A.rows; y++) for (let x = (y % 2); x < COLS; x += 2) ctx.fillRect(A.x + x * A.cell, A.y + y * A.cell, A.cell, A.cell);
    // Fireflies drifting through the terrarium.
    for (const f of fireflies) {
      const fx0 = A.x + ((f.x * w + Math.sin(time * 0.3 * f.s + f.p) * 30) % w);
      const fy0 = A.y + ((f.y * h + time * 8 * f.s) % h);
      ctx.fillStyle = rgba(PAL.accent, 0.12 + 0.12 * Math.sin(time * 2 * f.s + f.p));
      ctx.fillRect(fx0, fy0, 2, 2);
    }
    ctx.restore();
    ctx.strokeStyle = rgba(PAL.accent, 0.28);
    ctx.lineWidth = 2;
    roundRect(ctx, A.x - 1, A.y - 1, w + 2, h + 2, 15);
    ctx.stroke();
  }

  function drawRocks() {
    for (const r of rocks.values()) {
      const p = center(r.cell);
      const k = easeOutBack(clamp((time - r.born) / 0.3));
      const s = A.cell * 0.86 * k;
      ctx.fillStyle = "#1F2A23";
      roundRect(ctx, p.x - s / 2, p.y - s / 2 + 3, s, s, s * 0.28);
      ctx.fill();
      ctx.fillStyle = "#4A5A4F";
      roundRect(ctx, p.x - s / 2, p.y - s / 2, s, s - 3, s * 0.28);
      ctx.fill();
      ctx.fillStyle = "#6B7D70";
      roundRect(ctx, p.x - s * 0.32, p.y - s * 0.36, s * 0.3, s * 0.16, s * 0.08);
      ctx.fill();
    }
  }

  function drawFood() {
    const c = center(food);
    const bob = Math.sin(time * 5) * 2;
    const r = A.cell * 0.34;
    const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, A.cell);
    glow.addColorStop(0, rgba(PAL.berry, 0.35));
    glow.addColorStop(1, rgba(PAL.berry, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(c.x - A.cell, c.y - A.cell, A.cell * 2, A.cell * 2);
    ctx.fillStyle = PAL.berryDeep;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob + 1.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.berry;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(c.x - r * 0.5, c.y + bob - r * 0.55, r * 0.35, r * 0.35);
    ctx.fillStyle = PAL.leaf;
    ctx.beginPath();
    ctx.ellipse(c.x + r * 0.45, c.y + bob - r * 1.05, r * 0.45, r * 0.2, -0.6, 0, Math.PI * 2);
    ctx.fill();
    if (bonus) {
      const b = center(bonus.cell);
      const k = 1 - bonus.t / bonus.life;
      const s = A.cell * 0.36 * (1 + 0.3 * (light.pulse(time, 1.6, STAR_PULSE) - 0.5));
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(time * 2);
      ctx.fillStyle = PAL.gold;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 === 0 ? s : s * 0.45;
        const a = (i / 8) * Math.PI * 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = rgba(PAL.gold, 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, A.cell * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
    }
  }

  function drawSnake() {
    const p = dead ? 1 : clamp(acc);
    const pts = body.map((c, i) => {
      const from = prev[i] ?? c;
      const a = center(from);
      const b = center(c);
      return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
    });
    const start = dead ? dead.popped : 0;
    const n = pts.length;
    const base = A.cell * 0.8;
    const widthAt = (i: number) => {
      let w = base * (1 - 0.38 * (i / Math.max(1, n - 1)));
      for (const g of gulps) {
        const d = Math.abs(i - g);
        if (d < 1.5) w *= 1 + 0.32 * (1 - d / 1.5);
      }
      return w;
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Shadow pass.
    for (let i = Math.max(1, start); i < n; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = widthAt(i);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + 3);
      ctx.lineTo(b.x, b.y + 3);
      ctx.stroke();
    }
    for (let i = n - 1; i >= Math.max(1, start); i--) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const k = i / Math.max(1, n - 1);
      ctx.strokeStyle = mix(PAL.accent, PAL.tail, k);
      ctx.lineWidth = widthAt(i);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (i % 2 === 0) {
        ctx.fillStyle = rgba(PAL.belly, 0.55);
        ctx.beginPath();
        ctx.arc(b.x, b.y, widthAt(i) * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (start > 0 || !pts[0]) return;
    const h = pts[0];
    const r = A.cell * 0.5;
    ctx.fillStyle = PAL.accent;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fill();
    const d = DELTA[dir];
    const px = -d.y;
    const py = d.x;
    // Tongue flick.
    if ((time % 1.6) < 0.16 && !dead) {
      ctx.strokeStyle = PAL.berry;
      ctx.lineWidth = 2;
      const tx = h.x + d.x * r * 1.7;
      const ty = h.y + d.y * r * 1.7;
      ctx.beginPath();
      ctx.moveTo(h.x + d.x * r, h.y + d.y * r);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx + (d.x + px) * 4, ty + (d.y + py) * 4);
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + (d.x - px) * 4, ty + (d.y - py) * 4);
      ctx.stroke();
    }
    const f = center(bonus?.cell ?? food);
    const look = Math.atan2(f.y - h.y, f.x - h.x);
    for (const side of [-1, 1]) {
      const ex = h.x + d.x * r * 0.25 + px * side * r * 0.45;
      const ey = h.y + d.y * r * 0.25 + py * side * r * 0.45;
      ctx.fillStyle = PAL.paper;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(ex + Math.cos(look) * r * 0.1, ey + Math.sin(look) * r * 0.1, dead ? r * 0.05 : r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud() {
    const top = session.play().top;
    drawLabel(ctx, "SCORE", 18, top + 10, PAL.mute, 10, "left");
    drawNumber(ctx, Math.round(counter.shown), 18, top + 32, 30, PAL.paper, "left");
    drawLabel(ctx, "LENGTH", W - 18, top + 10, PAL.mute, 10, "right");
    drawNumber(ctx, body.length, W - 18, top + 32, 22, PAL.dim, "right");
    if (combo > 1 && time - lastEat < COMBO_WINDOW && !dead) {
      const k = 1 - (time - lastEat) / COMBO_WINDOW;
      const x = W / 2;
      ctx.fillStyle = PAL.accent;
      roundRect(ctx, x - 30, top + 16, 60, 26, 6);
      ctx.fill();
      ctx.font = `900 16px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = PAL.ink;
      ctx.fillText(`×${combo}`, x, top + 30);
      ctx.fillStyle = rgba(PAL.accent, 0.35);
      ctx.fillRect(x - 30, top + 46, 60, 3);
      ctx.fillStyle = PAL.accent;
      ctx.fillRect(x - 30, top + 46, 60 * k, 3);
    }
  }

  function drawAttract() {
    // Scrims so the title and prompt read over the demo.
    const r = safeRect(session.preview(), W, H);
    const g = ctx.createLinearGradient(0, 0, 0, r.y + 150);
    g.addColorStop(0, rgba(PAL.bg, 0.92));
    g.addColorStop(0.75, rgba(PAL.bg, 0.75));
    g.addColorStop(1, rgba(PAL.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, r.y + 150);
    const g2 = ctx.createLinearGradient(0, r.y + r.h - 90, 0, H);
    g2.addColorStop(0, rgba(PAL.bg, 0));
    g2.addColorStop(0.4, rgba(PAL.bg, 0.8));
    g2.addColorStop(1, rgba(PAL.bg, 0.95));
    ctx.fillStyle = g2;
    ctx.fillRect(0, r.y + r.h - 90, W, H);
    const cx = r.x + r.w / 2;
    const k = easeOutBack(titleIn);
    ctx.save();
    ctx.translate(cx, r.y + 64);
    ctx.scale(k, k);
    ctx.rotate(-0.03);
    drawTitle(ctx, "SNEK", 0, 0, r.w, PAL.accent, 72, "#0B5E33");
    ctx.restore();
    drawLabel(ctx, "SWIPE TO STEER · EAT FAST", cx, r.y + 92, rgba(PAL.paper, 0.78), 11);
    if (session.best !== null) drawLabel(ctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, r.y + 112, PAL.paper, 13);
    drawTapPrompt(ctx, cx, r.y + r.h - 22, time, PAL.paper);
  }

  function render() {
    view.begin();
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    drawArena();
    drawRocks();
    drawFood();
    drawSnake();
    fx.draw(ctx);
    popups.draw(ctx, FONT_DISPLAY);
    ctx.restore();
    flash.draw(ctx, W, H);
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
