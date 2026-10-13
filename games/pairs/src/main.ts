import { createAudio, createRng, createSession, loadFonts, onTap, Particles, PENTATONIC, type Rng } from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { COLORS, glyphSvg, SHAPES, type Glyph } from "./glyphs.ts";
import "./style.css";

const ACCENT = "#FF6FB5";
const LEVELS: Array<[number, number]> = [
  [3, 4],
  [4, 4],
  [4, 5],
  [4, 6],
  [5, 6],
];
const START_TIME = 45;
const MATCH_TIME = 2;
const CLEAR_TIME = 6;

interface Card {
  i: number;
  key: string;
  glyph: Glyph;
  up: boolean;
  done: boolean;
  el: HTMLDivElement;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;

async function main() {
  const [session] = await Promise.all([createSession({ id: "pairs" }), loadFonts()]);
  const audio = createAudio();
  root.classList.toggle("standalone", session.standalone);
  const fx = new Particles(500);
  const grid = $<HTMLDivElement>("grid");
  const bg = $<HTMLCanvasElement>("bg");
  const fxCanvas = $<HTMLCanvasElement>("fx");
  const bgCtx = bg.getContext("2d")!;
  const fxCtx = fxCanvas.getContext("2d")!;
  const scoreEl = $("score");
  const levelEl = $("level");
  const comboEl = $("combo");
  const timeFill = $("timefill");
  const timeBar = $("timebar");
  const bestEl = $("best");
  const banner = $("banner");
  const stampEl = $("stamp");

  let W = 0;
  let H = 0;
  let dpr = 1;
  let cols = 4;
  let rows = 4;
  function resizeCanvases() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [bg, fxCanvas]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
  }
  function layoutGrid() {
    const top = session.play().top + 78;
    const availH = H - top - 20;
    const availW = W - 32;
    const gap = cols >= 5 ? 8 : 10;
    const ratio = 0.78;
    const w = Math.floor(Math.min(98, (availW - gap * (cols - 1)) / cols, ((availH - gap * (rows - 1)) / rows) * ratio));
    const h = Math.floor(w / ratio);
    root.style.setProperty("--card-w", `${w}px`);
    root.style.setProperty("--card-h", `${h}px`);
    root.style.setProperty("--gap", `${gap}px`);
    grid.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
    const gw = w * cols + gap * (cols - 1);
    const gh = h * rows + gap * (rows - 1);
    grid.style.left = `${Math.round((W - gw) / 2)}px`;
    grid.style.top = `${Math.round(top + (availH - gh) / 2)}px`;
  }
  resizeCanvases();
  window.addEventListener("resize", () => {
    resizeCanvases();
    layoutGrid();
  });
  session.on("insets", layoutGrid);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let cards: Card[] = [];
  let open: Card[] = [];
  let level = 0;
  let timeLeft = START_TIME;
  let score = 0;
  let combo = 0;
  let clock = 0;
  let lockUntil = 0;
  let flipBackAt = -1;
  let transition = false;
  let demo = true;
  let over = false;
  let endAt = -1;
  let rng: Rng = createRng(session.ctx.seed);
  let timers: Array<{ at: number; fn: () => void }> = [];
  const memory = new Map<number, string>();
  const later = (delay: number, fn: () => void) => timers.push({ at: clock + delay, fn });

  /** Picks pair identities. Later levels reuse shapes in other colors: the decoys are the difficulty. */
  function pickGlyphs(n: number, lvl: number, r: Rng): Glyph[] {
    const shapes = r.shuffle(Object.keys(SHAPES));
    const colors = r.shuffle([...COLORS]);
    const out: Glyph[] = [];
    const used = new Set<string>();
    const decoys = lvl >= 2 ? Math.min(n - 2, Math.floor(n * (0.25 + 0.08 * lvl))) : 0;
    for (let k = 0; out.length < n; k++) {
      const reuse = out.length > 0 && out.length <= decoys && r.chance(0.8);
      const shape = reuse ? out[r.int(0, out.length - 1)]!.shape : shapes[k % shapes.length]!;
      const color = colors[(k * 3 + r.int(0, 7)) % colors.length]!;
      const key = `${shape}:${color}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push({ shape, color });
    }
    return out;
  }

  function buildLevel(lvl: number, r: Rng, peek: number) {
    [cols, rows] = demo ? [4, 4] : (LEVELS[Math.min(lvl, LEVELS.length - 1)] ?? [5, 6]);
    layoutGrid();
    const pairs = (cols * rows) / 2;
    const glyphs = pickGlyphs(pairs, demo ? 0 : lvl, r);
    memory.clear();
    const deck = r.shuffle([...glyphs, ...glyphs]);
    grid.textContent = "";
    open = [];
    flipBackAt = -1;
    cards = deck.map((g, i) => {
      const el = document.createElement("div");
      el.className = "card deal";
      el.style.animationDelay = `${i * 22}ms`;
      el.innerHTML = `<div class="inner"><div class="face back"></div><div class="face front">${glyphSvg(g)}</div></div>`;
      el.dataset.i = String(i);
      grid.appendChild(el);
      return { i, key: `${g.shape}:${g.color}`, glyph: g, up: false, done: false, el };
    });
    const dealt = 0.25 + cards.length * 0.022;
    lockUntil = clock + dealt + peek + 0.35;
    transition = true;
    if (peek > 0) {
      later(dealt, () => {
        cards.forEach((c) => c.el.classList.add("up"));
        audio.play("whoosh", { volume: 0.6 });
      });
      later(dealt + peek, () => {
        cards.forEach((c) => c.el.classList.remove("up"));
        audio.play("whoosh", { volume: 0.5, pitch: -3 });
      });
    }
    later(dealt + peek + 0.3, () => (transition = false));
    levelEl.textContent = `LEVEL ${lvl + 1}`;
  }

  const center = (c: Card) => {
    const r = c.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  function flipDownOpen() {
    for (const c of open) {
      c.up = false;
      c.el.classList.remove("up", "miss");
    }
    open = [];
    flipBackAt = -1;
  }

  function flip(c: Card) {
    if (clock < lockUntil || c.up || c.done || over) return;
    if (open.length >= 2) flipDownOpen();
    c.up = true;
    c.el.classList.add("up");
    c.el.classList.remove("miss");
    audio.play("click", { pitch: open.length ? 5 : 0, volume: 0.9 });
    open.push(c);
    if (open.length < 2) return;
    const [a, b] = open as [Card, Card];
    if (a.key === b.key) {
      a.done = b.done = true;
      open = [];
      if (!demo) {
        combo++;
        const mult = Math.min(combo, 5);
        score += 100 * mult;
        timeLeft += MATCH_TIME;
        comboEl.classList.add("bump");
        later(0.16, () => comboEl.classList.remove("bump"));
        tc.feedback("success");
      }
      const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.max(0, combo - 1))]!;
      audio.play("score", { pitch: step });
      for (const card of [a, b]) {
        card.el.classList.add("hit");
        const p = center(card);
        fx.emit(p.x, p.y, { count: 16, speed: [80, 260], life: [0.35, 0.7], size: [3, 6], colors: [card.glyph.color, "#FBF4EA", ACCENT], drag: 2.4, spin: [-6, 6] });
        fx.emit(p.x, p.y, { count: 1, speed: [0, 0], life: [0.4, 0.4], size: [70, 70], colors: [card.glyph.color], shape: "ring", endScale: 1.8 });
        later(0.52, () => card.el.classList.add("gone"));
      }
      if (cards.every((k) => k.done)) levelClear();
    } else {
      if (!demo) {
        combo = 0;
        tc.feedback("fail");
      }
      audio.play("error", { volume: 0.6 });
      later(0.12, () => {
        a.el.classList.add("miss");
        b.el.classList.add("miss");
      });
      flipBackAt = clock + 0.6;
    }
  }

  function levelClear() {
    transition = true;
    if (demo) {
      later(1.2, () => buildLevel(0, rng, 0));
      return;
    }
    const bonus = 250 * (level + 1);
    score += bonus;
    timeLeft += CLEAR_TIME;
    audio.play("win");
    banner.textContent = `LEVEL ${level + 2}`;
    banner.classList.remove("show");
    void banner.offsetWidth;
    banner.classList.add("show");
    fx.emit(W / 2, H * 0.45, { count: 60, speed: [150, 460], life: [0.7, 1.3], size: [3, 7], colors: [...COLORS], gravity: 500, drag: 0.8, spin: [-8, 8] });
    level++;
    later(1.0, () => buildLevel(level, rng, Math.max(0.6, 1.4 - 0.2 * level)));
  }

  function timeUp() {
    over = true;
    flipDownOpen();
    cards.forEach((c, k) => {
      if (!c.done) later(k * 0.015, () => c.el.classList.add("up"));
    });
    audio.play("lose");
    endAt = clock + 0.4;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  let ignoreUntil = 0;
  onTap(grid, (x, y) => {
    if (session.phase !== "playing" || demo || performance.now() < ignoreUntil) return;
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLDivElement>(".card");
    if (!el) return;
    const c = cards[Number(el.dataset.i)];
    if (c) flip(c);
  });
  session.startOnTap(window);
  session.on("start", () => {
    demo = false;
    over = false;
    ignoreUntil = performance.now() + 80;
    rng = createRng(session.ctx.seed + session.runs * 104729);
    level = 0;
    score = 0;
    combo = 0;
    timeLeft = START_TIME;
    timers = [];
    endAt = -1;
    root.classList.add("playing");
    root.classList.remove("ended");
    audio.play("powerup", { volume: 0.7 });
    buildLevel(0, rng, 1.4);
  });
  session.on("pause", () => root.classList.add("paused"));
  session.on("resume", () => root.classList.remove("paused"));

  // ---------------------------------------------------------------------------
  // Attract demo: a player with a decent (not perfect) memory.
  // ---------------------------------------------------------------------------
  let demoTimer = 1.2;
  function demoStep() {
    if (clock < lockUntil || transition) return;
    if (open.length === 2) return;
    const hidden = cards.filter((c) => !c.done && !c.up);
    if (!hidden.length) return;
    if (open.length === 1) {
      const first = open[0]!;
      const known = hidden.find((c) => memory.get(c.i) === first.key && rng.chance(0.85));
      const pick = known ?? rng.pick(hidden.filter((c) => !memory.has(c.i)).concat(hidden).slice(0, 6));
      memory.set(pick.i, pick.key);
      flip(pick);
      return;
    }
    // Known pair?
    for (const a of hidden) {
      const ka = memory.get(a.i);
      if (!ka) continue;
      const b = hidden.find((c) => c !== a && memory.get(c.i) === ka);
      if (b && rng.chance(0.9)) {
        flip(a);
        return;
      }
    }
    const unknown = hidden.filter((c) => !memory.has(c.i));
    const pick = unknown.length ? rng.pick(unknown) : rng.pick(hidden);
    memory.set(pick.i, pick.key);
    flip(pick);
  }

  // ---------------------------------------------------------------------------
  // Background: slow drifting glyph confetti.
  // ---------------------------------------------------------------------------
  const motes = Array.from({ length: 26 }, (_, k) => ({
    x: Math.random(),
    y: Math.random(),
    s: 6 + Math.random() * 14,
    v: 0.008 + Math.random() * 0.02,
    c: COLORS[k % COLORS.length]!,
    r: Math.random() * Math.PI,
    kind: k % 3,
  }));
  function drawBg(dt: number) {
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = bgCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#140A12");
    g.addColorStop(1, "#22101D");
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);
    bgCtx.globalAlpha = 0.09;
    for (const m of motes) {
      m.y -= m.v * dt;
      m.r += dt * 0.3;
      if (m.y < -0.05) m.y = 1.05;
      const x = m.x * W;
      const y = m.y * H;
      bgCtx.fillStyle = m.c;
      bgCtx.save();
      bgCtx.translate(x, y);
      bgCtx.rotate(m.r);
      if (m.kind === 0) {
        bgCtx.beginPath();
        bgCtx.arc(0, 0, m.s / 2, 0, Math.PI * 2);
        bgCtx.fill();
      } else if (m.kind === 1) bgCtx.fillRect(-m.s / 2, -m.s / 2, m.s, m.s);
      else {
        bgCtx.beginPath();
        bgCtx.moveTo(0, -m.s / 2);
        bgCtx.lineTo(m.s / 2, m.s / 2);
        bgCtx.lineTo(-m.s / 2, m.s / 2);
        bgCtx.fill();
      }
      bgCtx.restore();
    }
    bgCtx.globalAlpha = 1;
  }

  function renderHud() {
    scoreEl.textContent = score.toLocaleString("en-US");
    comboEl.textContent = `×${Math.max(1, Math.min(combo, 5))}`;
    const frac = Math.max(0, Math.min(1, timeLeft / START_TIME));
    timeFill.style.transform = `scaleX(${frac})`;
    timeBar.classList.toggle("low", timeLeft < 6 && !over);
    bestEl.textContent = session.best !== null ? `Best ${session.best.toLocaleString("en-US")}` : "";
    bestEl.style.display = session.best !== null ? "" : "none";
  }

  buildLevel(0, rng, 0);
  let lastTick = 0;
  let readySent = false;
  tc.loop((dt) => {
    session.tick(dt);
    clock += dt;
    if (timers.length) {
      const due = timers.filter((t) => t.at <= clock);
      timers = timers.filter((t) => t.at > clock);
      due.forEach((t) => t.fn());
    }
    if (flipBackAt >= 0 && clock >= flipBackAt) flipDownOpen();
    if (demo) {
      demoTimer -= dt;
      if (demoTimer <= 0) {
        demoTimer = 0.5;
        demoStep();
      }
    } else if (session.phase === "playing" && !over) {
      if (!transition) timeLeft -= dt;
      if (timeLeft < 5.5 && Math.ceil(timeLeft) !== lastTick && timeLeft > 0) {
        lastTick = Math.ceil(timeLeft);
        audio.play("tick", { volume: 1.2 });
      }
      if (timeLeft <= 0) {
        timeLeft = 0;
        timeUp();
      }
    }
    if (over && endAt >= 0 && clock >= endAt) {
      endAt = -1;
      const r = session.end(score, { outcome: "lose", stats: { level: level + 1 } });
      stampEl.textContent = r.isBest ? "NEW BEST" : "TIME";
      root.classList.add("ended");
    }
    renderHud();
    drawBg(dt);
    fx.update(dt);
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxCtx.clearRect(0, 0, W, H);
    fx.draw(fxCtx);
    if (!readySent) {
      readySent = true;
      session.ready();
    }
  });
  session.on("attract", () => {
    demo = true;
    root.classList.remove("playing", "ended");
    memory.clear();
    buildLevel(0, rng, 0);
  });
}

void main();
