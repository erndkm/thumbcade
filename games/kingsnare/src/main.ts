import { createAudio, createRng, createSession, loadFonts, Particles, Photosafe, type Rng } from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { Chess, type Move, type Square } from "chess.js";
import { pieceSvg, type PieceType } from "./pieces.ts";
import { PUZZLES, type Puzzle } from "./puzzles.ts";
import "./style.css";

const ACCENT = "#5CF2B8";
const RUN_SECONDS = 90;
const PENALTY = 5;
const POINTS: Record<1 | 2 | 3, number> = { 1: 100, 2: 250, 3: 450 };
const FILES = "abcdefgh";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;

async function main() {
  const [session] = await Promise.all([createSession({ id: "kingsnare" }), loadFonts()]);
  const audio = createAudio();
  root.classList.toggle("standalone", session.standalone);
  const fx = new Particles(400);
  const light = new Photosafe(session.reducedMotion);
  const wrap = $<HTMLDivElement>("board-wrap");
  const boardEl = $<HTMLDivElement>("board");
  const piecesEl = $<HTMLDivElement>("pieces");
  const fxCanvas = $<HTMLCanvasElement>("fx");
  const bg = $<HTMLCanvasElement>("bg");
  const fxCtx = fxCanvas.getContext("2d")!;
  const popups = $("popups");
  const scoreEl = $("score");
  const streakEl = $("streak");
  const mateEl = $("mate");
  const timeFill = $("timefill");
  const timeBar = $("timebar");
  const turnEl = $("turn");
  const turnText = $("turn-text");
  const turnDot = $("turn-dot");
  const bestEl = $("best");
  const dailyEl = $("daily");
  const stampEl = $("stamp");
  const shelf = $("shelf");

  // ---------------------------------------------------------------------------
  // Board DOM
  // ---------------------------------------------------------------------------
  const squares = new Map<Square, HTMLDivElement>();
  /** The mated king's square, whose red glow breathes (see the frame loop). */
  let matedSq: HTMLDivElement | null = null;
  let flipped = false;
  function buildSquares() {
    boardEl.textContent = "";
    squares.clear();
    matedSq = null;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const file = flipped ? 7 - col : col;
        const rank = flipped ? row + 1 : 8 - row;
        const name = `${FILES[file]}${rank}` as Square;
        const el = document.createElement("div");
        el.className = `sq${(file + rank) % 2 === 0 ? " d" : ""}`;
        if (row === 7) el.insertAdjacentHTML("beforeend", `<span class="coord f">${FILES[file]}</span>`);
        if (col === 0) el.insertAdjacentHTML("beforeend", `<span class="coord r">${rank}</span>`);
        boardEl.appendChild(el);
        squares.set(name, el);
      }
    }
  }

  let W = 0;
  let H = 0;
  let dpr = 1;
  let sq = 44;
  let boardLeft = 0;
  let boardTop = 0;
  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [fxCanvas, bg]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const top = session.play().top + 86;
    const availH = H - top - 64;
    sq = Math.floor(Math.min((W - 32) / 8, availH / 8));
    const size = sq * 8;
    boardLeft = Math.round((W - size) / 2);
    boardTop = Math.round(top + Math.max(0, (availH - size) * 0.3));
    root.style.setProperty("--sq", `${sq}px`);
    wrap.style.left = `${boardLeft}px`;
    wrap.style.top = `${boardTop}px`;
    wrap.style.width = wrap.style.height = `${size}px`;
    turnEl.style.top = `${boardTop + size + 22}px`;
    shelf.style.top = `${boardTop + size + 58}px`;
    drawBg();
    placeAll();
  }

  function drawBg() {
    const g = bg.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = g.createRadialGradient(W / 2, H * 0.55, 40, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    grad.addColorStop(0, "#13261F");
    grad.addColorStop(1, "#070D0C");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Felt grain.
    const rng = createRng(7);
    g.fillStyle = "rgba(255,255,255,0.025)";
    for (let i = 0; i < 900; i++) g.fillRect(rng() * W, rng() * H, 1, 1);
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------
  let chess = new Chess();
  const pieceEls = new Map<Square, HTMLDivElement>();
  const xy = (s: Square) => {
    const file = FILES.indexOf(s[0]!);
    const rank = Number(s[1]);
    const col = flipped ? 7 - file : file;
    const row = flipped ? rank - 1 : 8 - rank;
    return { x: col * sq, y: row * sq };
  };
  const place = (el: HTMLDivElement, s: Square) => {
    const p = xy(s);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  };
  function placeAll() {
    for (const [s, el] of pieceEls) place(el, s);
  }
  function renderPieces() {
    piecesEl.textContent = "";
    pieceEls.clear();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        const el = document.createElement("div");
        el.className = "pc";
        el.innerHTML = pieceSvg(cell.type as PieceType, cell.color);
        piecesEl.appendChild(el);
        pieceEls.set(cell.square, el);
        place(el, cell.square);
      }
    }
  }

  function clearMarks(...cls: string[]) {
    for (const el of squares.values()) el.classList.remove(...cls);
  }

  /** Applies a move to the DOM: slides the piece, removes captures, handles castling, en passant and promotion. */
  function animateMove(m: Move) {
    const el = pieceEls.get(m.from);
    const victimSq = m.flags.includes("e") ? (`${m.to[0]}${m.from[1]}` as Square) : m.to;
    const victim = m.captured ? pieceEls.get(victimSq) : undefined;
    if (victim) {
      victim.classList.add("gone");
      pieceEls.delete(victimSq);
      later(0.3, () => victim.remove());
      const p = xy(victimSq);
      fx.emit(boardLeft + p.x + sq / 2, boardTop + p.y + sq / 2, { count: 14, speed: [60, 220], life: [0.3, 0.6], size: [2, 5], colors: [ACCENT, "#F3F0E8", "#4C7A6B"], drag: 3 });
    }
    if (el) {
      pieceEls.delete(m.from);
      pieceEls.set(m.to, el);
      el.classList.remove("drag");
      place(el, m.to);
      if (m.promotion) el.innerHTML = pieceSvg(m.promotion as PieceType, m.color);
    }
    if (m.flags.includes("k") || m.flags.includes("q")) {
      const rank = m.from[1];
      const [rf, rt] = m.flags.includes("k") ? ["h", "f"] : ["a", "d"];
      const rook = pieceEls.get(`${rf}${rank}` as Square);
      if (rook) {
        pieceEls.delete(`${rf}${rank}` as Square);
        pieceEls.set(`${rt}${rank}` as Square, rook);
        place(rook, `${rt}${rank}` as Square);
      }
    }
    clearMarks("last", "check", "sel", "hint", "cap", "over");
    squares.get(m.from)?.classList.add("last");
    squares.get(m.to)?.classList.add("last");
    if (chess.isCheck()) {
      const k = kingSquare(chess.turn());
      const el = k ? squares.get(k) : undefined;
      el?.classList.add(chess.isCheckmate() ? "mated" : "check");
      if (el && chess.isCheckmate()) matedSq = el;
    } else {
      clearMarks("mated");
      matedSq = null;
    }
    audio.play(m.captured ? "hit" : "thud", { volume: m.captured ? 0.5 : 0.45, pitch: m.captured ? -4 : 4 });
    if (chess.isCheck() && !chess.isCheckmate()) audio.play("select", { volume: 0.6 });
  }

  const kingSquare = (color: "w" | "b"): Square | null => {
    for (const row of chess.board()) for (const c of row) if (c && c.type === "k" && c.color === color) return c.square;
    return null;
  };

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let puzzle: Puzzle = PUZZLES[0]!;
  let ply = 0;
  let playerColor: "w" | "b" = "w";
  let busy = true;
  let demo = true;
  let over = false;
  let score = 0;
  let streak = 0;
  let solved = 0;
  let timeLeft = RUN_SECONDS;
  let clock = 0;
  let endAt = -1;
  let timers: Array<{ at: number; fn: () => void }> = [];
  const later = (d: number, fn: () => void) => timers.push({ at: clock + d, fn });
  let order: Puzzle[] = [];
  let used = new Set<Puzzle>();
  let rng: Rng = createRng(session.ctx.seed);

  const daily = (() => {
    const m2 = PUZZLES.filter((p) => p.mateIn === 2);
    return m2[session.ctx.dailySeed % m2.length]!;
  })();
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
  dailyEl.textContent = `Today's opener · ${today}`;

  function setPuzzle(p: Puzzle, animateIn: boolean) {
    puzzle = p;
    ply = 0;
    chess = new Chess(p.fen);
    playerColor = chess.turn();
    flipped = playerColor === "b";
    buildSquares();
    renderPieces();
    clearMarks("last", "check", "mated", "sel", "hint", "cap", "over");
    selected = null;
    mateEl.textContent = p === daily && !demo ? "DAILY · MATE IN 2" : `MATE IN ${p.mateIn}`;
    mateEl.classList.toggle("is-daily", p === daily && !demo);
    turnText.textContent = playerColor === "w" ? "White to move" : "Black to move";
    turnDot.style.background = playerColor === "w" ? "#FBF7EE" : "#1A1A21";
    if (animateIn) {
      wrap.classList.remove("out");
      wrap.classList.add("in");
      later(0.45, () => wrap.classList.remove("in"));
    }
  }

  function nextPuzzle(): Puzzle {
    const tier = solved < 4 ? 1 : solved < 10 ? 2 : 3;
    const pickFrom = (n: number) => order.find((p) => p.mateIn === n && !used.has(p));
    let p = pickFrom(tier) ?? pickFrom(2) ?? pickFrom(1) ?? pickFrom(3);
    if (!p) {
      used = new Set();
      p = order[0]!;
    }
    used.add(p);
    return p;
  }

  function transitionTo(p: Puzzle) {
    busy = true;
    wrap.classList.add("out");
    later(0.32, () => {
      setPuzzle(p, true);
      later(0.4, () => (busy = false));
    });
  }

  // ---------------------------------------------------------------------------
  // Moves
  // ---------------------------------------------------------------------------
  const uciOf = (from: string, to: string, promo?: string) => `${from}${to}${promo ?? ""}`;

  function popup(text: string, x: number, y: number, cls = "") {
    const el = document.createElement("div");
    el.className = `pop ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    popups.appendChild(el);
    later(0.95, () => el.remove());
  }

  function attempt(from: Square, to: Square): boolean {
    const legal = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!legal.length) return false;
    const expected = puzzle.line[ply] ?? "";
    const promo = legal.some((m) => m.promotion) ? (expected.startsWith(from + to) && expected[4] ? expected[4] : "q") : undefined;
    const uci = uciOf(from, to, promo);
    const lastMove = ply === puzzle.line.length - 1;
    let ok = uci === expected;
    if (!ok && lastMove) {
      const probe = new Chess(chess.fen());
      probe.move({ from, to, promotion: promo });
      ok = probe.isCheckmate();
    }
    if (!ok) {
      wrong();
      return false;
    }
    const m = chess.move({ from, to, promotion: promo });
    animateMove(m);
    ply++;
    if (chess.isCheckmate()) {
      solvedPuzzle();
      return true;
    }
    // Opponent's best defence.
    busy = true;
    later(0.5, () => {
      const reply = puzzle.line[ply]!;
      const r = chess.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
      animateMove(r);
      ply++;
      later(0.2, () => (busy = false));
    });
    return true;
  }

  function wrong() {
    if (demo) return;
    streak = 0;
    timeLeft = Math.max(0, timeLeft - PENALTY);
    wrap.classList.remove("shake");
    void wrap.offsetWidth;
    wrap.classList.add("shake");
    audio.play("error");
    tc.feedback("fail");
    popup(`−${PENALTY}s`, boardLeft + sq * 4, boardTop - 16, "bad");
  }

  function solvedPuzzle() {
    busy = true;
    const k = kingSquare(chess.turn());
    const p = k ? xy(k) : { x: sq * 4, y: sq * 4 };
    const cx = boardLeft + p.x + sq / 2;
    const cy = boardTop + p.y + sq / 2;
    fx.emit(cx, cy, { count: 50, speed: [100, 420], life: [0.5, 1.1], size: [3, 7], colors: [ACCENT, "#F3F0E8", "#FFB547", "#FF6FB5"], gravity: 380, drag: 1, spin: [-8, 8] });
    fx.emit(cx, cy, { count: 1, speed: [0, 0], life: [0.5, 0.5], size: [sq * 1.4, sq * 1.4], colors: [ACCENT], shape: "ring", endScale: 3 });
    audio.play("win");
    if (!demo) {
      const mult = Math.min(3, 1 + 0.25 * streak);
      const gained = Math.round(POINTS[puzzle.mateIn] * mult);
      score += gained;
      streak++;
      solved++;
      const pip = document.createElement("b");
      pip.className = `m${puzzle.mateIn}`;
      shelf.appendChild(pip);
      tc.feedback("success");
      popup("MATE", W / 2, boardTop + sq * 3.4, "big");
      popup(`+${gained}`, W / 2, boardTop + sq * 4.6);
      streakEl.classList.add("bump");
      later(0.18, () => streakEl.classList.remove("bump"));
      later(0.9, () => transitionTo(nextPuzzle()));
    }
  }

  // ---------------------------------------------------------------------------
  // Input: drag a piece, or tap a piece then a square.
  // ---------------------------------------------------------------------------
  let selected: Square | null = null;
  let drag: { id: number; from: Square | null; x0: number; y0: number; moved: boolean } | null = null;

  const squareAt = (x: number, y: number): Square | null => {
    const r = wrap.getBoundingClientRect();
    const col = Math.floor(((x - r.left) / r.width) * 8);
    const row = Math.floor(((y - r.top) / r.height) * 8);
    if (col < 0 || row < 0 || col > 7 || row > 7) return null;
    const file = flipped ? 7 - col : col;
    const rank = flipped ? row + 1 : 8 - row;
    return `${FILES[file]}${rank}` as Square;
  };
  const canInput = () => session.phase === "playing" && !demo && !busy && !over;

  function select(s: Square | null) {
    clearMarks("sel", "hint", "cap");
    selected = s;
    if (!s) return;
    squares.get(s)?.classList.add("sel");
    for (const m of chess.moves({ square: s, verbose: true })) {
      const el = squares.get(m.to);
      el?.classList.add("hint");
      if (m.captured) el?.classList.add("cap");
    }
    audio.play("click", { volume: 0.6 });
  }

  function snapBack(from: Square) {
    const el = pieceEls.get(from);
    if (el) {
      el.classList.remove("drag");
      place(el, from);
    }
    clearMarks("over");
  }

  let ignoreUntil = 0;
  wrap.addEventListener("pointerdown", (e) => {
    if (!canInput() || performance.now() < ignoreUntil || drag) return;
    const s = squareAt(e.clientX, e.clientY);
    if (!s) return;
    const piece = chess.get(s);
    drag = { id: e.pointerId, from: piece && piece.color === playerColor ? s : null, x0: e.clientX, y0: e.clientY, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id || !drag.from) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!canInput()) return;
    const el = pieceEls.get(drag.from);
    if (!el) return;
    if (!drag.moved) {
      drag.moved = true;
      el.classList.add("drag");
      if (selected !== drag.from) select(drag.from);
    }
    const r = wrap.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - r.left - sq / 2}px, ${e.clientY - r.top - sq / 2}px)`;
    clearMarks("over");
    const over = squareAt(e.clientX, e.clientY);
    if (over) squares.get(over)?.classList.add("over");
  });
  window.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!canInput()) {
      if (d.from) snapBack(d.from);
      return;
    }
    const target = squareAt(e.clientX, e.clientY);
    if (d.moved && d.from) {
      if (!target || target === d.from || !attempt(d.from, target)) snapBack(d.from);
      else select(null);
      return;
    }
    // A tap.
    const s = squareAt(d.x0, d.y0);
    if (!s) return;
    if (selected && s !== selected && chess.moves({ square: selected, verbose: true }).some((m) => m.to === s)) {
      const from = selected;
      select(null);
      attempt(from, s);
      return;
    }
    const piece = chess.get(s);
    if (piece && piece.color === playerColor) select(selected === s ? null : s);
    else select(null);
  });
  window.addEventListener("pointercancel", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.from) snapBack(drag.from);
    drag = null;
  });

  session.startOnTap(window);
  session.on("start", () => {
    demo = false;
    over = false;
    ignoreUntil = performance.now() + 120;
    rng = createRng(session.ctx.seed + session.runs * 31337);
    order = rng.shuffle(PUZZLES.filter((p) => p !== daily));
    used = new Set([daily]);
    score = 0;
    streak = 0;
    solved = 0;
    shelf.textContent = "";
    timeLeft = RUN_SECONDS;
    timers = [];
    endAt = -1;
    root.classList.add("playing");
    root.classList.remove("ended");
    audio.play("powerup", { volume: 0.6 });
    busy = true;
    setPuzzle(daily, false);
    later(0.5, () => (busy = false));
  });
  session.on("pause", () => root.classList.add("paused"));
  session.on("resume", () => root.classList.remove("paused"));
  session.on("cancel", () => {
    if (drag?.from) snapBack(drag.from);
    drag = null;
  });

  // ---------------------------------------------------------------------------
  // Attract demo: the board solves puzzles on its own, starting with today's opener.
  // ---------------------------------------------------------------------------
  const demoOrder = [daily, ...createRng(session.ctx.dailySeed).shuffle(PUZZLES.filter((p) => p !== daily && p.mateIn > 1))];
  let demoIndex = 0;
  let demoTimer = 1.1;
  function demoStep() {
    if (busy) return;
    if (chess.isCheckmate()) {
      demoIndex = (demoIndex + 1) % demoOrder.length;
      transitionTo(demoOrder[demoIndex]!);
      demoTimer = 1.6;
      return;
    }
    const u = puzzle.line[ply];
    if (!u) return;
    const from = u.slice(0, 2) as Square;
    const m = chess.move({ from, to: u.slice(2, 4), promotion: u[4] });
    squares.get(from)?.classList.add("sel");
    animateMove(m);
    ply++;
    if (chess.isCheckmate()) {
      solvedPuzzle();
      busy = false;
      demoTimer = 1.4;
    } else demoTimer = 0.8;
  }

  function renderHud() {
    scoreEl.textContent = score.toLocaleString("en-US");
    streakEl.textContent = `×${Math.min(3, 1 + 0.25 * streak).toFixed(2).replace(/\.?0+$/, "")}`;
    timeFill.style.transform = `scaleX(${Math.max(0, Math.min(1, timeLeft / RUN_SECONDS))})`;
    const low = timeLeft < 10 && !over;
    timeBar.classList.toggle("low", low);
    // Low-time warning: the bar breathes at 1 Hz (slower under reduced motion; the kit caps it either way).
    timeFill.style.opacity = low ? (0.6 + 0.4 * light.pulse(clock, 1)).toFixed(3) : "";
    // The mated king's glow breathes at ~0.8 Hz; under reduced motion it holds steady.
    matedSq?.style.setProperty("--mate", (0.6 + 0.4 * light.pulse(clock, 0.8, { still: 1 })).toFixed(3));
    bestEl.textContent = session.best !== null ? `Best ${session.best.toLocaleString("en-US")}` : "";
    bestEl.style.display = session.best !== null ? "" : "none";
  }

  layout();
  window.addEventListener("resize", layout);
  session.on("insets", layout);
  setPuzzle(daily, false);
  busy = false;

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
    if (demo) {
      demoTimer -= dt;
      if (demoTimer <= 0) {
        demoTimer = 0.8;
        demoStep();
      }
    } else if (session.phase === "playing" && !over) {
      if (!busy) timeLeft -= dt;
      if (timeLeft < 10 && timeLeft > 0 && Math.ceil(timeLeft) !== lastTick) {
        lastTick = Math.ceil(timeLeft);
        audio.play("tick", { volume: 1.2 });
      }
      if (timeLeft <= 0) {
        timeLeft = 0;
        over = true;
        select(null);
        audio.play("lose");
        endAt = clock + 0.35;
      }
    }
    if (over && endAt >= 0 && clock >= endAt) {
      endAt = -1;
      const r = session.end(score, { outcome: solved > 0 ? "win" : "lose", stats: { solved, streak } });
      stampEl.textContent = r.isBest ? "NEW BEST" : `${solved} MATE${solved === 1 ? "" : "S"}`;
      root.classList.add("ended");
    }
    renderHud();
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
    setPuzzle(daily, false);
  });
}

void main();
