import {
  createAudio,
  createRng,
  createSession,
  loadFonts,
  onTapOrHold,
  Particles,
  Shake,
  type Rng,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import "./style.css";

const COLS = 8;
const ROWS = 12;
const MINES = 15;
const ACCENT = "#7CC4FF";

interface Cell {
  i: number;
  x: number;
  y: number;
  mine: boolean;
  n: number;
  open: boolean;
  flag: boolean;
  el: HTMLDivElement;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;

async function main() {
  const [session] = await Promise.all([createSession({ id: "mines" }), loadFonts()]);
  const audio = createAudio();
  root.classList.toggle("standalone", session.standalone);
  const fx = new Particles(600);
  const shake = new Shake(10, 0.02, 1.7, session.reducedMotion);
  const boardEl = $<HTMLDivElement>("board");
  const bg = $<HTMLCanvasElement>("bg");
  const fxCanvas = $<HTMLCanvasElement>("fx");
  const bgCtx = bg.getContext("2d")!;
  const fxCtx = fxCanvas.getContext("2d")!;
  const leftEl = $("left");
  const scoreEl = $("score");
  const timeEl = $("time");
  const bestEl = $("best");
  const stampEl = $("stamp");

  // ---------------------------------------------------------------------------
  // Layout: the board never moves between attract and play, so starting a run doesn't jump.
  // ---------------------------------------------------------------------------
  let W = 0;
  let H = 0;
  let dpr = 1;
  let cellSize = 44;
  const gap = 3;
  let boardX = 0;
  let boardY = 0;
  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [bg, fxCanvas]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const top = session.play().top + 58;
    const availH = H - top - 18;
    cellSize = Math.floor(Math.min((W - 24 - gap * (COLS - 1)) / COLS, (availH - gap * (ROWS - 1)) / ROWS));
    const bw = cellSize * COLS + gap * (COLS - 1);
    const bh = cellSize * ROWS + gap * (ROWS - 1);
    boardX = Math.round((W - bw) / 2);
    boardY = Math.round(top + (availH - bh) / 2);
    root.style.setProperty("--cell", `${cellSize}px`);
    root.style.setProperty("--gap", `${gap}px`);
    boardEl.style.left = `${boardX}px`;
    boardEl.style.top = `${boardY}px`;
  }
  layout();
  window.addEventListener("resize", layout);
  session.on("insets", layout);

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------
  const cells: Cell[] = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const el = document.createElement("div");
    el.className = "cell";
    boardEl.appendChild(el);
    cells.push({ i, x: i % COLS, y: Math.floor(i / COLS), mine: false, n: 0, open: false, flag: false, el });
  }
  const neighbors = (c: Cell): Cell[] => {
    const out: Cell[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = c.x + dx;
        const y = c.y + dy;
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS) out.push(cells[y * COLS + x]!);
      }
    return out;
  };

  let generated = false;
  let opened = 0;
  let flags = 0;
  let elapsed = 0;
  let over = false;
  let demo = true;
  let score = 0;
  let ignoreTapsUntil = 0;
  let endAt = -1;
  let pendingEnd: { score: number; outcome: "win" | "lose" } | null = null;
  /** Reveals scheduled on the game clock (so a pause freezes a flood mid-wave). */
  let queue: Array<{ c: Cell; at: number }> = [];
  let clock = 0;
  /** Other timed effects, also on the game clock. */
  let timers: Array<{ at: number; fn: () => void }> = [];
  const later = (delay: number, fn: () => void) => timers.push({ at: clock + delay, fn });

  function resetBoard(deal: boolean) {
    generated = false;
    opened = 0;
    flags = 0;
    elapsed = 0;
    over = false;
    score = 0;
    queue = [];
    timers = [];
    endAt = -1;
    pendingEnd = null;
    for (const c of cells) {
      c.mine = false;
      c.n = 0;
      c.open = false;
      c.flag = false;
      c.el.className = deal ? "cell dealing" : "cell";
      c.el.textContent = "";
      if (deal) c.el.style.animationDelay = `${(c.x + c.y) * 18}ms`;
      else c.el.style.animationDelay = "";
    }
    renderHud();
  }

  function generate(safe: Cell, rng: Rng) {
    const banned = new Set([safe.i, ...neighbors(safe).map((c) => c.i)]);
    let placed = 0;
    while (placed < MINES) {
      const c = cells[rng.int(0, cells.length - 1)]!;
      if (c.mine || banned.has(c.i)) continue;
      c.mine = true;
      placed++;
    }
    for (const c of cells) c.n = neighbors(c).filter((n) => n.mine).length;
    generated = true;
  }

  function cellAt(px: number, py: number): Cell | null {
    const x = Math.floor((px - boardX) / (cellSize + gap));
    const y = Math.floor((py - boardY) / (cellSize + gap));
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
    return cells[y * COLS + x] ?? null;
  }

  const center = (c: Cell) => ({ x: boardX + c.x * (cellSize + gap) + cellSize / 2, y: boardY + c.y * (cellSize + gap) + cellSize / 2 });

  /** Opens a cell (and floods zeros, staggered by distance). */
  function reveal(start: Cell) {
    if (start.open || start.flag) return;
    if (start.mine) return detonate(start);
    const seen = new Set<number>([start.i]);
    const frontier: Array<{ c: Cell; d: number }> = [{ c: start, d: 0 }];
    while (frontier.length) {
      const { c, d } = frontier.shift()!;
      queue.push({ c, at: clock + d * 0.03 });
      c.open = true; // claim now so double taps don't double count
      if (c.n === 0) {
        for (const n of neighbors(c)) {
          if (!seen.has(n.i) && !n.mine && !n.flag && !n.open) {
            seen.add(n.i);
            frontier.push({ c: n, d: d + 1 });
          }
        }
      }
    }
  }

  function paintOpen(c: Cell, index: number) {
    c.el.className = `cell open${c.n ? ` n${c.n}` : ""}`;
    c.el.style.animationDelay = "";
    c.el.textContent = c.n ? String(c.n) : "";
    opened++;
    if (!demo) score += 10;
    if (index < 6) audio.play("tick", { pitch: Math.min(14, opened % 15), volume: 0.8 });
    if (c.n === 0 && !demo) {
      const p = center(c);
      fx.emit(p.x, p.y, { count: 2, speed: [10, 50], life: [0.2, 0.45], size: [2, 3], colors: [ACCENT, "#BFE3FF"], drag: 3 });
    }
    if (opened === COLS * ROWS - MINES) win();
  }

  function detonate(c: Cell) {
    over = true;
    c.open = true;
    c.el.className = "cell mine boom";
    const p = center(c);
    audio.play("explode");
    audio.play("thud");
    shake.add(0.85);
    tc.feedback("impact");
    fx.emit(p.x, p.y, { count: 46, speed: [80, 520], life: [0.4, 1.1], size: [2, 6], colors: ["#FF4A3D", "#FFB547", "#FFF1C2", ACCENT], drag: 2.2, shape: "spark" });
    fx.emit(p.x, p.y, { count: 14, speed: [20, 90], life: [0.8, 1.4], size: [10, 22], colors: ["#2A3445", "#1B2533"], drag: 1.5, shape: "circle", endScale: 1.6 });
    // Ring the other mines in order of distance; mark wrong buoys.
    const rest = cells.filter((m) => m !== c && ((m.mine && !m.flag) || (!m.mine && m.flag)));
    rest.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    rest.forEach((m, k) => {
      later(0.04 + k * 0.035, () => {
        if (m.mine) m.el.className = "cell mine";
        else m.el.className = "cell flag wrong";
      });
    });
    if (!demo) {
      pendingEnd = { score, outcome: "lose" };
      endAt = clock + 0.5;
    } else {
      endAt = clock + 1.6;
    }
  }

  function win() {
    over = true;
    const bonus = demo ? 0 : 1000 + Math.max(0, 900 - Math.floor(elapsed) * 10);
    score += bonus;
    audio.play("win");
    for (const c of cells) {
      if (c.mine && !c.flag) {
        c.flag = true;
        c.el.className = "cell flag";
      }
    }
    cells.forEach((c) => {
      c.el.classList.add("win");
      c.el.style.animationDelay = `${(c.x + c.y) * 25}ms`;
    });
    fx.emit(W / 2, boardY + 40, { count: 70, speed: [120, 420], angle: [Math.PI * 0.15, Math.PI * 0.85], life: [0.8, 1.6], size: [3, 6], colors: [ACCENT, "#5CF2B8", "#F3F0E8", "#FF6FB5"], gravity: 420, drag: 0.8, spin: [-8, 8] });
    if (!demo) {
      pendingEnd = { score, outcome: "win" };
      endAt = clock + 0.45;
    } else endAt = clock + 2;
  }

  function toggleFlag(c: Cell) {
    if (c.open || over) return;
    c.flag = !c.flag;
    flags += c.flag ? 1 : -1;
    c.el.className = c.flag ? "cell flag" : "cell";
    c.el.style.animationDelay = "";
    audio.play(c.flag ? "pop" : "click");
    if (!demo) tc.feedback("tap");
    renderHud();
  }

  function chord(c: Cell) {
    if (!c.open || c.n === 0) return;
    const ns = neighbors(c);
    if (ns.filter((n) => n.flag).length !== c.n) return;
    const hidden = ns.filter((n) => !n.open && !n.flag);
    if (!hidden.length) return;
    audio.play("select");
    for (const n of hidden) {
      if (n.mine) return detonate(n);
      reveal(n);
    }
  }

  function act(c: Cell, rng: Rng) {
    if (over) return;
    if (c.open) return chord(c);
    if (c.flag) return;
    if (!generated) generate(c, rng);
    reveal(c);
  }

  function renderHud() {
    leftEl.textContent = String(MINES - flags);
    scoreEl.textContent = score.toLocaleString("en-US");
    const s = Math.floor(elapsed);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    bestEl.textContent = session.best !== null ? `Best ${session.best.toLocaleString("en-US")}` : "";
    bestEl.style.display = session.best !== null ? "" : "none";
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  let rng = createRng(session.ctx.seed);
  let holding: Cell | null = null;
  const clearHold = () => {
    holding?.el.classList.remove("holding");
    holding = null;
  };
  onTapOrHold(boardEl, {
    holdStart(x, y) {
      if (session.phase !== "playing" || demo) return;
      const c = cellAt(x, y);
      if (c && !c.open && !over) {
        holding = c;
        c.el.classList.add("holding");
      }
    },
    tap(x, y) {
      clearHold();
      if (session.phase !== "playing" || demo || performance.now() < ignoreTapsUntil) return;
      const c = cellAt(x, y);
      if (c) act(c, rng);
    },
    hold(x, y) {
      clearHold();
      if (session.phase !== "playing" || demo) return;
      const c = cellAt(x, y);
      if (c) toggleFlag(c);
    },
  });
  for (const t of ["pointerup", "pointercancel"]) window.addEventListener(t, clearHold);
  session.on("cancel", clearHold);

  session.startOnTap(window);
  session.on("start", () => {
    demo = false;
    ignoreTapsUntil = performance.now() + 80;
    rng = createRng(session.ctx.seed + session.runs * 7919);
    resetBoard(true);
    root.classList.add("playing");
    root.classList.remove("ended");
    audio.play("powerup", { volume: 0.7 });
  });
  session.on("pause", () => root.classList.add("paused"));
  session.on("resume", () => root.classList.remove("paused"));

  // ---------------------------------------------------------------------------
  // Attract demo: a sweeper that plays logically (and knows where the mines are when stuck).
  // ---------------------------------------------------------------------------
  let demoRng = createRng(session.ctx.seed ^ 0x5eed);
  let demoTimer = 0.9;
  function demoStep() {
    if (over) return;
    if (!generated) {
      act(cells[Math.floor(cells.length / 2) + 3]!, demoRng);
      return;
    }
    for (const c of cells) {
      if (!c.open || c.n === 0) continue;
      const ns = neighbors(c);
      const hidden = ns.filter((n) => !n.open && !n.flag);
      const flagged = ns.filter((n) => n.flag).length;
      if (hidden.length && hidden.length + flagged === c.n) return toggleFlag(hidden[0]!);
      if (hidden.length && flagged === c.n) return reveal(hidden[0]!);
    }
    const safe = cells.filter((c) => !c.open && !c.mine && !c.flag);
    if (safe.length) reveal(demoRng.pick(safe));
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  let sweep = 0;
  function drawBg(dt: number) {
    sweep += dt * 0.9;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bgCtx.fillStyle = "#08111D";
    bgCtx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = boardY + (cellSize * ROWS) / 2;
    bgCtx.strokeStyle = "rgba(124,196,255,0.07)";
    bgCtx.lineWidth = 1;
    for (let r = 60; r < Math.max(W, H); r += 60) {
      bgCtx.beginPath();
      bgCtx.arc(cx, cy, r, 0, Math.PI * 2);
      bgCtx.stroke();
    }
    bgCtx.beginPath();
    bgCtx.moveTo(0, cy);
    bgCtx.lineTo(W, cy);
    bgCtx.moveTo(cx, 0);
    bgCtx.lineTo(cx, H);
    bgCtx.stroke();
    const g = (bgCtx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient?.(sweep, cx, cy);
    if (g) {
      g.addColorStop(0, "rgba(124,196,255,0.22)");
      g.addColorStop(0.08, "rgba(124,196,255,0.02)");
      g.addColorStop(1, "rgba(124,196,255,0)");
      bgCtx.fillStyle = g;
      bgCtx.fillRect(0, 0, W, H);
    }
  }

  let readySent = false;
  resetBoard(false);
  tc.loop((dt) => {
    session.tick(dt);
    clock += dt;
    if (session.phase === "playing" && !over && generated) elapsed += dt;
    if (timers.length) {
      const due = timers.filter((t) => t.at <= clock);
      timers = timers.filter((t) => t.at > clock);
      due.forEach((t) => t.fn());
    }
    // Scheduled reveals.
    if (queue.length) {
      let k = 0;
      queue = queue.filter((q) => {
        if (q.at > clock) return true;
        paintOpen(q.c, k++);
        return false;
      });
    }
    if (demo) {
      demoTimer -= dt;
      if (demoTimer <= 0) {
        demoTimer = 0.24;
        demoStep();
      }
      if (over && endAt >= 0 && clock >= endAt) {
        demoRng = createRng(demoRng.int(0, 1e9));
        resetBoard(true);
        demoTimer = 1;
      }
    } else if (pendingEnd && clock >= endAt) {
      const r = session.end(pendingEnd.score, { outcome: pendingEnd.outcome, stats: { seconds: Math.round(elapsed), revealed: opened } });
      stampEl.textContent = pendingEnd.outcome === "win" ? (r.isBest ? "NEW BEST" : "CLEAR") : "BOOM";
      stampEl.classList.toggle("lost", pendingEnd.outcome === "lose");
      root.classList.add("ended");
      pendingEnd = null;
    }
    renderHud();
    shake.update(dt);
    const o = shake.offset;
    boardEl.style.transform = o.x || o.y ? `translate(${o.x}px, ${o.y}px) rotate(${o.angle}rad)` : "";
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
    resetBoard(true);
  });
}

void main();
