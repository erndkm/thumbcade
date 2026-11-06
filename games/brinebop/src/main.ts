import { createAudio, createMusic, midiToFreq, PENTATONIC } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeInCubic, easeOutBack, lerp } from "@thumbcade-games/kit/ease";
import { onDrag } from "@thumbcade-games/kit/input";
import { Particles } from "@thumbcade-games/kit/particles";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { CLEAR_T, col, COLS, idx, N, row, ROWS, type Combo, type Move, type Piece, type Special } from "./board.ts";
import { Bits, burstPath, burstSticker, drawSprite, font, hash, inkFill, loadComicFont, makeHalftone, makeSprite, PAL, Pows, roundRectPath, setSpriteScale, sticker, stickerWord, Wobble, type Sprite } from "./comic.ts";
import { drawEyes, KIND, makeCritterArt, makeGlove, type CritterArt, type Look } from "./critters.ts";
import { poolLayout } from "./layout.ts";
import { FRENZY_T, Run, runSeed, type RunEvent } from "./run.ts";
import { S as SND } from "./sfx.ts";
import { chooseMove, Pilot, SKILLS, type Skill } from "./sim.ts";

// ---------------------------------------------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------------------------------------------
const SEA = "#2ED3E6";
const SEA_RAY = "#8DEBF5";
const WATER = "#123B66";
const TILE_A = "#174C7E";
const TILE_B = "#1B5890";
const ROCK = "#F5C46A";
const ROCK_SHADE = "#D9963F";
const ROCK_HI = "#FFE3A3";

/** The attract-mode player: good, a touch showy, never instant. */
const DEMO: Skill = { name: "demo", think: [0.75, 1.15], greed: 0.8, miss: 0 };
/** Seconds without a move (on a quiet board) before the hint wiggles a pair. */
const HINT_AFTER = 3;
/** Fraction of a cell the finger must drag before the swap commits (or less, on a quick release). */
const COMMIT = 0.4;
const FLICK = 0.2;
const GHOST_CYCLE = 1.7;
/** Design QA builds can shorten the clock (`VITE_CLOCK=12 vite build`); a normal build leaves it alone. */
const QA_CLOCK = Number(import.meta.env.VITE_CLOCK) || undefined;
/** Design QA builds can also let a pilot play the run (`VITE_AUTOPLAY=expert`), to record and measure it. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

const CHAIN_WORDS = ["", "", "NICE!", "SPLISH!", "SPLOSH!", "TIDAL!", "SEA-RIOUS!", "OCEANIC!", "BRINE-TASTIC!"];
const COMBO_WORDS: Record<Combo, string> = {
  cross: "CROSSFIRE!",
  triple: "TRIPLE SQUIRT!",
  megablast: "MEGA BOOM!",
  conchKind: "HONK HONK!",
  conchLine: "SQUIRT PARTY!",
  conchBomb: "BOOM PARTY!",
  tidal: "TIDAL WAVE!",
};
const MADE_WORDS: Partial<Record<Special, string>> = { lineH: "SQUIRTER!", lineV: "SQUIRTER!", bomb: "BOOMER!", conch: "CONCH!" };

interface Beam {
  x: number;
  y: number;
  horiz: boolean;
  t: number;
}
interface Blast {
  x: number;
  y: number;
  r: number;
  t: number;
}
interface Ring {
  x: number;
  y: number;
  t: number;
  life: number;
  r: number;
}
interface Flyer {
  pts: number;
  x: number;
  y: number;
  t: number;
  size: number;
  /** "score" flies into the score, "time" into the clock. */
  to: "score" | "time";
  label: string;
}
interface Hand {
  phase: "idle" | "reach" | "press" | "drag" | "lift";
  t: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  move: Move | null;
  alpha: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "brinebop" }), loadComicFont()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
  } catch {
    /* guests and offline: show the hint */
  }

  const view = createCanvas({ maxDpr: 2.5, background: SEA });
  const g = view.ctx;
  let W = view.width;
  let H = view.height;
  let D = view.dpr;
  let cell = 50;
  let R = 21;
  let bx = 0;
  let by = 0;
  let art: CritterArt | null = null;
  let glove: Sprite | null = null;
  let pool: HTMLCanvasElement | null = null;
  let halftone: HTMLCanvasElement | null = null;
  let blastSpr: Sprite | null = null;
  const RIM = 10;

  function layout() {
    W = view.width;
    H = view.height;
    D = view.dpr;
    setSpriteScale(D);
    const L = poolLayout(W, H, session.play().top);
    const changed = L.cell !== cell || !art;
    cell = L.cell;
    R = cell * 0.42;
    bx = L.bx;
    by = L.by;
    const k = Math.min(3, D * 1.1);
    if (changed) {
      art = makeCritterArt(R, k);
      glove = makeGlove(cell * 0.9, k);
      const br = cell * 2.6;
      blastSpr = makeSprite(br * 2.3, br * 2.3, br * 1.15, br * 1.15, (bg) => {
        burstPath(bg, br, br, 12, 5, 0.3);
        inkFill(bg, PAL.banana, 5, 0);
        burstPath(bg, br * 0.72, br * 0.72, 12, 9, 0.28);
        bg.fillStyle = PAL.white;
        bg.fill();
      }, Math.min(2, D));
    }
    pool = makePool();
    const hd = Math.min(D, 1.5);
    halftone = makeHalftone(W * hd, H * hd, 14 * hd, PAL.white, (x, y) => clamp(0.08 + y * y * 0.7 + Math.abs(x - 0.5) * 0.3, 0, 0.9));
  }

  /** The rock pool (rim, water, tiles) drawn once per layout. */
  function makePool(): HTMLCanvasElement {
    const bw = cell * COLS;
    const bh = cell * ROWS;
    const pad = RIM + 10;
    const c = document.createElement("canvas");
    const k = Math.min(D, 2);
    c.width = Math.ceil((bw + pad * 2) * k);
    c.height = Math.ceil((bh + pad * 2) * k);
    const p = c.getContext("2d")!;
    p.scale(k, k);
    p.translate(pad, pad);
    // Rim: chunky sandstone with an ink outline and a hard shadow.
    roundRectPath(p, -RIM, -RIM, bw + RIM * 2, bh + RIM * 2, RIM + 8);
    inkFill(p, ROCK, 4.5, 5);
    p.save();
    roundRectPath(p, -RIM, -RIM, bw + RIM * 2, bh + RIM * 2, RIM + 8);
    p.clip();
    p.fillStyle = ROCK_SHADE;
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const along = (bw + bh) * 2 * t;
      let x: number;
      let y: number;
      if (along < bw) [x, y] = [along, -RIM * 0.5];
      else if (along < bw + bh) [x, y] = [bw + RIM * 0.5, along - bw];
      else if (along < bw * 2 + bh) [x, y] = [bw - (along - bw - bh), bh + RIM * 0.5];
      else [x, y] = [-RIM * 0.5, bh - (along - bw * 2 - bh)];
      p.beginPath();
      p.ellipse(x + (hash(i, 3) - 0.5) * 8, y + (hash(i, 4) - 0.5) * 5, 2 + hash(i, 5) * 3, 1.5 + hash(i, 6) * 2, hash(i, 7) * 3, 0, Math.PI * 2);
      p.fill();
    }
    p.fillStyle = ROCK_HI;
    p.fillRect(-RIM + 10, -RIM + 3, bw * 0.3, 3);
    p.restore();
    // Water and tiles.
    roundRectPath(p, -2, -2, bw + 4, bh + 4, 10);
    p.fillStyle = WATER;
    p.fill();
    p.lineWidth = 3.5;
    p.strokeStyle = PAL.ink;
    p.stroke();
    for (let r = 0; r < ROWS; r++)
      for (let cc = 0; cc < COLS; cc++) {
        roundRectPath(p, cc * cell + 2.5, r * cell + 2.5, cell - 5, cell - 5, cell * 0.22);
        p.fillStyle = (r + cc) % 2 ? TILE_A : TILE_B;
        p.fill();
      }
    // A lighter ripple across the top of the water.
    p.strokeStyle = "rgba(255,255,255,0.08)";
    p.lineWidth = 3;
    for (let r = 0; r < ROWS; r += 3) {
      p.beginPath();
      for (let x = 0; x <= bw; x += 8) p.lineTo(x, r * cell + cell * 0.18 + Math.sin(x * 0.07 + r) * 2.5);
      p.stroke();
    }
    return c;
  }

  layout();
  view.onResize(layout);
  let playTop = session.play().top;
  session.on("insets", () => {
    if (session.play().top !== playTop) {
      playTop = session.play().top;
      layout();
    }
  });

  const audio = createAudio();
  const BASS = [45, null, 52, null, 57, null, 52, 55, 45, null, 52, null, 57, 59, 57, null, 41, null, 48, null, 53, null, 48, 52, 43, null, 50, null, 55, 57, 59, null];
  const FRENZY_BASS = [57, 64, 57, 64, 59, 66, 59, 66, 60, 67, 60, 67, 62, 69, 64, 71];
  const music = createMusic(audio, { bpm: 132, wave: "triangle", volume: 0.045, steps: BASS });
  const shake = new Shake(11, 0.025, 1.8, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.18, decay: 0.35 });
  const drops = new Particles(520);
  const bits = new Bits(200);
  const hudBits = new Bits(140);
  const pows = new Pows(reduced);
  const hudPows = new Pows(reduced);
  const scorePop = new Wobble(300, 11);
  const clockPop = new Wobble(320, 10);
  const titlePop = new Wobble(200, 9);
  const look: Look = { x: 0, y: 0, blink: 0, mood: "plain" };

  // -------------------------------------------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let seed = session.ctx.seed >>> 0;
  let run = new Run(createRng(seed), { endless: true });
  let pilot = new Pilot(DEMO, createRng(seed ^ 77));
  let time = 0;
  let titleIn = 0;
  /** Score that has arrived in the counter (flyers land), and what the counter shows while it rolls. */
  let banked = 0;
  let shown = 0;
  let flyers: Flyer[] = [];
  let beams: Beam[] = [];
  let blasts: Blast[] = [];
  let rings: Ring[] = [];
  let endT = -1;
  let endSent = false;
  let bestCheered = false;
  let lastTick = -1;
  let plipAt = 0;
  let idle = 0;
  let hint: Move | null = null;
  let hintLook = 0;
  let ghostDone = false;
  /** This frame's real time step, for the effect timers advanced while drawing. */
  let frameDt = 0;
  let frenzyBanner = 0;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string } | null = null;
  const hand: Hand = { phase: "idle", t: 0, x: 0, y: 0, sx: 0, sy: 0, move: null, alpha: 0 };
  let handNow = { x: 0, y: 0, press: 0 };
  const ghost: Hand = { phase: "idle", t: 0, x: 0, y: 0, sx: 0, sy: 0, move: null, alpha: 0 };

  /** The critter under the finger, the way it follows, and a tap-selected critter. */
  let held: { i: number; piece: Piece; x0: number; y0: number; off: number; axis: "x" | "y" | null; demo: boolean; dist: number } | null = null;
  let selected = -1;
  let selectedPiece: Piece | null = null;
  let finger: { x: number; y: number } | null = null;

  const cx = (i: number) => bx + (col(i) + 0.5) * cell;
  const cy = (i: number) => by + (row(i) + 0.5) * cell;
  const playing = () => mode === "play" && session.phase === "playing";

  function resetFx() {
    drops.clear();
    bits.clear();
    hudBits.clear();
    pows.clear();
    hudPows.clear();
    flyers = [];
    beams = [];
    blasts = [];
    rings = [];
    held = null;
    selected = -1;
    hint = null;
    idle = 0;
    frenzyBanner = 0;
  }

  function newAttract(pour = true) {
    mode = "attract";
    seed = (seed * 1664525 + 1013904223) >>> 0;
    run = new Run(createRng(seed), { endless: true, pour });
    pilot = new Pilot(DEMO, createRng(seed ^ 77));
    resetFx();
    hand.phase = "idle";
    hand.alpha = 0;
  }

  /** The old pool's critters on their way out the bottom when a new run pours in (no hard cut between pools). */
  let b0Pour = false;
  let qaPilot: Pilot | null = null;
  let leaving: Array<{ kind: number; special: Special; x: number; y: number; t: number }> = [];
  const LEAVE_T = 0.16;

  /** The old pool's critters pop away in a wave from the bottom left while the new ones plop in behind them. */
  function flush() {
    leaving = [];
    for (let i = 0; i < N; i++) {
      const p = run.board.grid[i];
      if (!p || p.state === "clear") continue;
      leaving.push({ kind: p.kind, special: p.special, x: col(i) + p.ox, y: row(i) + p.oy, t: -(col(i) * 0.04 + (ROWS - 1 - row(i)) * 0.03) + 0.02 });
    }
  }

  function stepLeaving(dt: number) {
    if (!leaving.length) return;
    for (const l of leaving) l.t += dt;
    if (leaving.some((l) => l.t > LEAVE_T)) leaving = leaving.filter((l) => l.t <= LEAVE_T);
  }

  function startRun() {
    flush();
    mode = "play";
    // Each run's pool comes from the launch seed and the run number, never from how long the demo ran.
    run = new Run(createRng(runSeed(session.ctx.seed, session.runs)), { pour: true, clock: QA_CLOCK });
    resetFx();
    banked = shown = 0;
    endT = -1;
    endSent = false;
    bestCheered = false;
    lastTick = -1;
    summary = null;
    hand.phase = "idle";
    hand.alpha = 0;
    ghost.phase = "idle";
    ghost.t = -0.9;
    ghost.alpha = 0;
    ghostDone = hintSeen;
    music.setSteps(BASS);
    music.start();
    audio.play(SND.whistleDown, { volume: 0.6, pitch: 3 });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input: drag a critter onto a neighbour, or tap one and then its neighbour. A run starts on a tap's release.
  // -------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  session.on("start", startRun);

  function cellAt(x: number, y: number): number {
    const slop = 12;
    if (x < bx - slop || y < by - slop || x > bx + cell * COLS + slop || y > by + cell * ROWS + slop) return -1;
    const c = clamp(Math.floor((x - bx) / cell), 0, COLS - 1);
    const r = clamp(Math.floor((y - by) / cell), 0, ROWS - 1);
    return idx(c, r);
  }

  function neighbour(i: number, axis: "x" | "y", sign: number): number {
    if (axis === "x") {
      const c = col(i) + sign;
      return c >= 0 && c < COLS ? i + sign : -1;
    }
    const r = row(i) + sign;
    return r >= 0 && r < ROWS ? i + sign * COLS : -1;
  }

  function trySwap(i: number, j: number, drag: number): boolean {
    if (j < 0 || !run.canSwap) return false;
    if (!run.board.canSwap(i, j)) {
      // The neighbour is still busy (falling, popping): a little bump, nothing lost.
      const p = run.board.grid[i];
      if (p) p.sqv += 6;
      return false;
    }
    const ok = mode === "play" ? run.swap(i, j, drag) : run.board.trySwap(i, j, drag);
    if (ok) {
      idle = 0;
      hint = null;
    }
    return ok;
  }

  let downWasPlaying = false;
  onDrag(window, {
    start(x, y) {
      finger = { x, y };
      downWasPlaying = playing();
      if (!downWasPlaying || !run.canSwap) return;
      idle = 0;
      hint = null;
      const i = cellAt(x, y);
      if (i < 0) return;
      const p = run.board.grid[i];
      if (!p || !run.board.settled(p)) return;
      held = { i, piece: p, x0: x, y0: y, off: 0, axis: null, demo: false, dist: 0 };
      audio.play(SND.lift, { pitch: KIND[p.kind] ? p.kind : 0 });
    },
    move(x, y) {
      finger = { x, y };
      const h = held;
      if (!h || h.demo) return;
      const dx = (x - h.x0) / cell;
      const dy = (y - h.y0) / cell;
      h.dist = Math.max(h.dist, Math.hypot(dx, dy));
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.1) {
        // Pick the axis, and let it switch if the finger clearly changes its mind.
        if (!h.axis || (h.axis === "x" ? Math.abs(dy) > Math.abs(dx) * 1.4 : Math.abs(dx) > Math.abs(dy) * 1.4)) h.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      }
      if (!h.axis) return;
      const along = h.axis === "x" ? dx : dy;
      const a = Math.abs(along);
      // Follows the finger, then rubber-bands past the commit point.
      h.off = Math.sign(along) * (a < COMMIT ? a : COMMIT + (a - COMMIT) * 0.25);
      if (a >= COMMIT && run.board.grid[h.i] === h.piece) {
        const j = neighbour(h.i, h.axis, Math.sign(along));
        const ok = trySwap(h.i, j, Math.min(0.5, a));
        held = null;
        selected = -1;
        if (!ok && j < 0) h.piece.sqv += 5;
      }
    },
    end(x, y, cancelled) {
      finger = null;
      const h = held;
      held = null;
      if (cancelled || !downWasPlaying || !playing()) return;
      if (h && h.axis && Math.abs(h.off) >= FLICK) {
        trySwap(h.i, neighbour(h.i, h.axis, Math.sign(h.off)), Math.abs(h.off));
        selected = -1;
        return;
      }
      if ((h && h.dist > 0.15) || !run.canSwap) return;
      // A tap: select, or swap with the selected neighbour.
      const i = cellAt(x, y);
      if (i < 0) {
        selected = -1;
        return;
      }
      if (selected >= 0 && selected !== i && Math.abs(col(i) - col(selected)) + Math.abs(row(i) - row(selected)) === 1) {
        trySwap(selected, i, 0);
        selected = -1;
      } else {
        selected = selected === i ? -1 : run.board.settled(run.board.grid[i] ?? null) ? i : -1;
        selectedPiece = selected >= 0 ? run.board.grid[selected]! : null;
      }
    },
  });
  session.on("cancel", () => {
    held = null;
    finger = null;
  });
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (playing() && run.phase === "play") music.start();
  });

  // -------------------------------------------------------------------------------------------------------------
  // The demo hand (attract mode) and the first-run ghost hand
  // -------------------------------------------------------------------------------------------------------------
  function stepDemo(dt: number) {
    const h = hand;
    h.t += dt;
    h.alpha = Math.min(1, h.alpha + dt * 3);
    switch (h.phase) {
      case "idle": {
        const m = pilot.next(run.board, dt);
        if (m && run.board.canSwap(m.from, m.to)) {
          h.move = m;
          h.phase = "reach";
          h.t = 0;
          h.sx = h.x || W * 0.7;
          h.sy = h.y || H * 0.9;
        }
        break;
      }
      case "reach":
        if (h.t >= 0.3) {
          h.phase = "press";
          h.t = 0;
          const m = h.move!;
          const p = run.board.grid[m.from];
          if (!p || !run.board.canSwap(m.from, m.to)) h.phase = "lift";
          else held = { i: m.from, piece: p, x0: cx(m.from), y0: cy(m.from), off: 0, axis: col(m.to) !== col(m.from) ? "x" : "y", demo: true, dist: 0 };
        }
        break;
      case "press":
        if (h.t >= 0.1) {
          h.phase = "drag";
          h.t = 0;
        }
        break;
      case "drag": {
        const m = h.move!;
        const sign = m.to - m.from > 0 ? 1 : -1;
        if (held?.demo) held.off = sign * Math.min(0.45, (h.t / 0.16) * 0.45);
        if (h.t >= 0.16) {
          if (held?.demo && run.board.grid[m.from] === held.piece) trySwap(m.from, m.to, 0.45);
          held = null;
          h.phase = "lift";
          h.t = 0;
        }
        break;
      }
      case "lift":
        if (h.t >= 0.3) {
          h.phase = "idle";
          h.t = 0;
        }
        break;
    }
  }

  /** Where the hand's fingertip is drawn right now. */
  function handPos(h: Hand): { x: number; y: number; press: number } {
    const m = h.move;
    if (!m) return { x: h.x, y: h.y, press: 0 };
    const fx = cx(m.from);
    const fy = cy(m.from) + cell * 0.15;
    const tx = cx(m.to);
    const ty = cy(m.to) + cell * 0.15;
    switch (h.phase) {
      case "reach": {
        const k = easeOutBack(Math.min(1, h.t / 0.3), 1.2);
        return { x: lerp(h.sx, fx, k), y: lerp(h.sy, fy, k), press: 0 };
      }
      case "press":
        return { x: fx, y: fy, press: Math.min(1, h.t / 0.1) };
      case "drag": {
        const k = Math.min(1, h.t / 0.16);
        return { x: lerp(fx, lerp(fx, tx, 0.6), k), y: lerp(fy, lerp(fy, ty, 0.6), k), press: 1 };
      }
      case "lift": {
        const k = Math.min(1, h.t / 0.3);
        const x = lerp(fx, tx, 0.6);
        const y = lerp(fy, ty, 0.6);
        h.x = x;
        h.y = y + k * cell * 0.4;
        return { x, y: y + k * cell * 0.4, press: 1 - k };
      }
      default:
        return { x: h.x, y: h.y, press: 0 };
    }
  }

  /** The first-run ghost: shows the hinted swap again and again until the player makes their first match. */
  function stepGhost(dt: number) {
    const gh = ghost;
    gh.t += dt;
    if (ghostDone || !run.canSwap) {
      gh.alpha = Math.max(0, gh.alpha - dt * 3);
      return;
    }
    if (gh.t < 0) return;
    if (!gh.move || gh.t > GHOST_CYCLE) {
      // Teach the plainest swap first: a simple three.
      const moves = run.board.findMoves().sort((a, b) => a.value - b.value);
      gh.move = moves.find((m) => m.value >= 3) ?? moves[0] ?? null;
      gh.t = 0;
    } else if (!run.board.canSwap(gh.move.from, gh.move.to)) gh.move = null;
    // Out of the way while the player has a critter in hand.
    gh.alpha = held ? Math.max(0, gh.alpha - dt * 4) : Math.min(0.85, gh.alpha + dt * 2.5);
  }

  function drawGhost() {
    const gh = ghost;
    if (gh.alpha <= 0.01 || !gh.move || !glove) return;
    const m = gh.move;
    const k = gh.t / GHOST_CYCLE;
    // 0-0.25 press on the critter, 0.25-0.6 slide to the neighbour, then fade and repeat.
    const slide = clamp((k - 0.25) / 0.35);
    const ease = slide * slide * (3 - 2 * slide);
    const x = lerp(cx(m.from), cx(m.to), ease);
    const y = lerp(cy(m.from), cy(m.to), ease) + cell * 0.15;
    const fade = k < 0.12 ? k / 0.12 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    const press = k > 0.15 && k < 0.65 ? 1 : 0;
    g.save();
    g.globalAlpha = gh.alpha * fade;
    // A trail from the critter to where it goes.
    g.strokeStyle = PAL.white;
    g.lineWidth = 5;
    g.lineCap = "round";
    g.setLineDash([2, 9]);
    g.beginPath();
    g.moveTo(cx(m.from), cy(m.from));
    g.lineTo(cx(m.to), cy(m.to));
    g.stroke();
    g.setLineDash([]);
    drawGloveAt(x, y, press);
    g.restore();
    if (k < 0.7) sticker(g, "DRAG!", x + cell * 0.95, y + cell * 1.05, { size: 16, fill: PAL.banana, rot: -0.12, shadow: 2, alpha: gh.alpha * fade });
  }

  function drawGloveAt(x: number, y: number, press: number) {
    if (!glove) return;
    const s = cell * 0.9;
    const k = 1 - press * 0.1;
    drawSprite(g, glove, x - s * 0.2 * k, y + s * 0.06 * k + press * 3, -0.18, k, k);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Events -> juice
  // -------------------------------------------------------------------------------------------------------------
  const loud = () => mode === "play";

  function popAt(x: number, y: number, kind: number, special: Special) {
    const s = KIND[kind];
    const colors = s ? [s.body, s.hi] : [PAL.banana, PAL.bubblegum];
    // A cartoon splash: outlined drops in the critter's colours, a spray of white, a ring.
    bits.emit(x, y, { count: reduced ? 1 : 3, speed: [90, 230], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.35, 0.6], size: [7, 11], colors, shape: "drop", gravity: 900, drag: 1.2 });
    drops.emit(x, y, { count: reduced ? 2 : 5, speed: [60, 240], life: [0.2, 0.45], size: [2.5, 5], colors: [PAL.white, s?.hi ?? PAL.white], gravity: 600, drag: 2, shape: "circle" });
    if (special !== "none" || !reduced) rings.push({ x, y, t: 0, life: 0.28, r: R * 1.05 });
  }

  function addFlyer(pts: number, x: number, y: number, chain: number) {
    if (pts <= 0) return;
    // Stack above a fresh number already hanging there instead of printing on top of it.
    for (let k = 0; k < 4 && flyers.some((f) => f.t < 0.5 && Math.abs(f.x - x) < 70 && Math.abs(f.y - y) < 26); k++) y -= 28;
    flyers.push({ pts, x, y, t: 0, size: Math.min(34, 17 + chain * 2 + Math.log10(pts) * 2), to: "score", label: `+${pts.toLocaleString("en-US")}` });
  }

  function handle(e: RunEvent) {
    switch (e.type) {
      case "swap":
        if (loud()) audio.play(SND.whoop, { pitch: (hash(e.a, 3) - 0.5) * 4, volume: 0.8 });
        else audio.play(SND.whoop, { volume: 0.3 });
        break;
      case "reject":
        audio.play(SND.boop, { volume: loud() ? 1 : 0.4 });
        break;
      case "land": {
        const p = run.board.grid[e.i];
        if (p) p.sqv += Math.min(9, e.speed * 0.55);
        if (time - plipAt > 0.045 && e.speed > 4) {
          plipAt = time;
          audio.play(SND.plip, { pitch: (hash(e.i, 9) - 0.5) * 6, volume: loud() ? 0.8 : 0.3 });
        }
        break;
      }
      case "pop":
        popAt(bx + (e.x + 0.5) * cell, by + (e.y + 0.5) * cell, e.kind, e.special);
        break;
      case "match": {
        const x = e.cells.reduce((s, i) => s + cx(i), 0) / e.cells.length;
        const y = e.cells.reduce((s, i) => s + cy(i), 0) / e.cells.length;
        const step = Math.min(PENTATONIC.length - 1, e.chain - 1 + (e.cells.length > 3 ? 1 : 0));
        audio.note(midiToFreq(64 + PENTATONIC[step]!), 0.16, "triangle", loud() ? 0.2 : 0.08);
        audio.play(SND.blub, { pitch: PENTATONIC[step]! - 2, volume: loud() ? 1 : 0.35 });
        if (!loud()) break;
        addFlyer(e.pts ?? 0, x, y - cell * 0.2, e.chain);
        if (e.player && !ghostDone) {
          ghostDone = true;
          if (!hintSeen) {
            hintSeen = true;
            tc.storage.set("hint", true).catch(() => undefined);
          }
        }
        if (e.created !== "none") {
          pows.burst(MADE_WORDS[e.created] ?? "WOW!", cx(e.at), cy(e.at) - cell * 0.75, { size: 15, fill: e.created === "conch" ? PAL.banana : PAL.white, life: 0.75 });
          audio.play(SND.sproing, { volume: 0.7, pitch: e.created === "conch" ? 5 : 0 });
          audio.play(SND.ding, { pitch: e.created === "conch" ? 7 : 2, volume: 0.6 });
          session.feedback("tap");
          shake.add(0.08);
        }
        // Call-outs for cascades, and for the player's own matches only at chain milestones.
        if (run.phase === "play" && e.chain >= 2 && (!e.player || (e.chain >= 4 && e.chain % 2 === 0))) {
          const word = CHAIN_WORDS[Math.min(e.chain, CHAIN_WORDS.length - 1)]!;
          if (word && (e.chain <= 8 || e.chain % 2 === 0)) {
            const big = e.chain >= 5;
            hudPows.burst(e.chain > 8 ? `${word} ×${e.chain}` : word, clamp(x, W * 0.3, W * 0.7), clamp(y - cell, by + cell, by + cell * (ROWS - 1)), {
              size: big ? 26 : 19 + e.chain,
              fill: [PAL.banana, PAL.white, PAL.bubblegumHi, PAL.limeHi, PAL.banana][e.chain % 5]!,
              life: big ? 0.95 : 0.75,
            });
            if (e.chain >= 4) {
              shake.add(0.06 + Math.min(0.2, e.chain * 0.02));
              session.feedback(e.chain >= 6 ? "success" : "tap");
            }
            if (e.chain >= 6 && !reduced) hudBits.emit(x, y, { count: 14, speed: [180, 420], life: [0.6, 1.1], size: [7, 11], colors: [PAL.banana, PAL.bubblegum, PAL.lime, PAL.white], shape: "confetti", gravity: 700, drag: 1.4 });
          }
        }
        break;
      }
      case "fire": {
        const x = cx(e.at);
        const y = cy(e.at);
        // A combo's points hang under its call-out; a single special's over the spot it went off.
        if (loud()) addFlyer(e.pts ?? 0, x, e.combo ? clamp(y - cell * 0.2, by + cell * 1.6, by + cell * ROWS) : y - cell * 0.4, e.chain);
        if (e.combo) {
          hudPows.burst(COMBO_WORDS[e.combo], clamp(x, W * 0.32, W * 0.68), clamp(y - cell * 1.2, by + cell, by + cell * (ROWS - 1)), { size: 26, fill: PAL.banana, life: 1.1 });
          flash.trigger(PAL.white, 0.9);
          shake.add(0.45);
          hitStop.freeze(reduced ? 0.03 : 0.09);
          audio.play(SND.sploosh);
          audio.play(SND.thud);
          if (e.combo.startsWith("conch") || e.combo === "tidal") {
            audio.play(SND.honk);
            window.setTimeout(() => audio.play(SND.honkHi), 140);
          }
          if (e.combo === "cross" || e.combo === "triple") {
            const rows = e.combo === "triple" ? [-1, 0, 1] : [0];
            for (const d of rows) {
              if (row(e.at) + d >= 0 && row(e.at) + d < ROWS) beams.push({ x, y: y + d * cell, horiz: true, t: 0 });
              if (col(e.at) + d >= 0 && col(e.at) + d < COLS) beams.push({ x: x + d * cell, y, horiz: false, t: 0 });
            }
          } else if (e.combo === "megablast") blasts.push({ x, y, r: cell * 3.6, t: 0 });
          else for (let k = 0; k < 4; k++) rings.push({ x, y, t: -k * 0.12, life: 0.7, r: cell * (2.5 + k) });
          if (loud()) session.feedback("impact");
          if (!reduced) bits.emit(x, y, { count: 24, speed: [200, 520], life: [0.6, 1.2], size: [7, 12], colors: [PAL.banana, PAL.white, PAL.tomato, PAL.bubblegum, PAL.lime], shape: "confetti", gravity: 800, drag: 1.3 });
          break;
        }
        if (e.special === "lineH" || e.special === "lineV") {
          beams.push({ x, y, horiz: e.special === "lineH", t: 0 });
          audio.play(SND.squirt, { pitch: (hash(e.at, 1) - 0.5) * 4, volume: loud() ? 1 : 0.4 });
          shake.add(0.12);
          hitStop.freeze(reduced ? 0 : 0.03);
        } else if (e.special === "bomb") {
          blasts.push({ x, y, r: cell * 2.6, t: 0 });
          audio.play(SND.thud, { volume: loud() ? 1 : 0.4 });
          audio.play(SND.crack, { volume: loud() ? 0.8 : 0.3 });
          audio.play(SND.sploosh, { volume: loud() ? 0.7 : 0.25 });
          shake.add(0.28);
          hitStop.freeze(reduced ? 0.02 : 0.05);
          if (loud()) session.feedback("impact");
          if (!reduced) bits.emit(x, y, { count: 10, speed: [150, 380], life: [0.5, 0.9], size: [6, 10], colors: [PAL.banana, PAL.white, PAL.tomato], shape: "star", gravity: 600, drag: 2 });
        } else if (e.special === "conch") {
          audio.play(SND.honk, { volume: loud() ? 1 : 0.4 });
          for (let k = 0; k < 3; k++) rings.push({ x, y, t: -k * 0.12, life: 0.7, r: cell * (2.5 + k) });
          shake.add(0.2);
          if (loud()) session.feedback("impact");
        }
        break;
      }
      case "shuffle":
        hudPows.burst("SHUFFLE!", W / 2, by + cell * ROWS * 0.45, { size: 26, fill: PAL.bubblegumHi, life: 1 });
        audio.play(SND.swirl, { volume: loud() ? 1 : 0.4 });
        break;
      case "time":
        if (!loud()) break;
        flyers.push({ pts: e.amount, x: cx(e.at), y: cy(e.at) - cell * 0.6, t: 0, size: 18, to: "time", label: `+${e.amount}s` });
        break;
      case "frenzy":
        frenzyBanner = 1;
        hudPows.burst("FRENZY!", W / 2, by + cell * 2.2, { size: 34, fill: PAL.tomato, life: 1.2 });
        audio.play(SND.whistleUp);
        audio.play(SND.fanfare, { volume: 0.8 });
        flash.trigger(PAL.banana, 0.8);
        shake.add(0.25);
        session.feedback("success");
        music.setSteps(FRENZY_BASS);
        for (const i of e.cells) {
          pows.burst(i % 2 ? "PUFF!" : "POOF!", cx(i), cy(i) - cell * 0.6, { size: 14, fill: PAL.white, life: 0.6 });
          rings.push({ x: cx(i), y: cy(i), t: 0, life: 0.45, r: R * 1.6 });
        }
        break;
      case "timeup":
        hudPows.burst("TIME!", W / 2, by + cell * ROWS * 0.42, { size: 44, fill: PAL.tomato, life: 1.1 });
        held = null;
        selected = -1;
        music.stop();
        audio.play(SND.buzzer);
        shake.add(0.2);
        session.feedback("impact");
        break;
      case "cashout":
        if (e.specials > 0) {
          window.setTimeout(() => {
            if (mode !== "play") return;
            hudPows.burst("CASH-OUT!", W / 2, by + cell * ROWS * 0.4, { size: 40, fill: PAL.lime, life: 1.1 });
            audio.play(SND.fanfare, { pitch: 5 });
          }, 260);
        }
        break;
      case "cash": {
        const x = cx(e.at);
        const y = cy(e.at);
        // The score climbs with each one: a bigger sticker, a higher ka-ching, a little more shake.
        hudPows.burst(`×${e.mult}`, x, y - cell * 0.55, { size: Math.min(40, 24 + e.mult * 3), fill: [PAL.banana, PAL.limeHi, PAL.bubblegumHi][e.mult % 3]!, life: 0.85 });
        rings.push({ x, y, t: 0, life: 0.5, r: cell * 1.8 }, { x, y, t: -0.1, life: 0.5, r: cell * 2.6 });
        audio.play(SND.chaChing, { pitch: Math.min(14, (e.mult - 2) * 2), volume: 0.9 });
        scorePop.kick(2 + e.mult * 0.5);
        shake.add(0.1);
        session.feedback("tap");
        if (!reduced) hudBits.emit(x, y, { count: 12, speed: [180, 420], life: [0.6, 1.1], size: [7, 11], colors: [PAL.banana, PAL.lime, PAL.white, PAL.bubblegum], shape: "confetti", gravity: 800, drag: 1.3 });
        break;
      }
      case "done":
        endT = 0;
        if (run.stats.cashPoints > 0) {
          hudPows.burst(`BONUS +${fmt(run.stats.cashPoints)}`, W / 2, by + cell * ROWS * 0.42, { size: 28, fill: PAL.banana, life: 1.2 });
          audio.play(SND.ding, { pitch: 12 });
        }
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------------------------
  const scorePos = () => ({ x: session.play().left + 22, y: session.play().top + 30 });
  const clockPos = () => ({ x: W - session.play().right - 46, y: session.play().top + 40 });

  function tipFor(): string {
    const s = run.stats;
    if (s.specialsMade < 3) return "MATCH 4, OR AN L, FOR A SPECIAL!";
    if (s.combos === 0) return "SWAP TWO SPECIALS TOGETHER!";
    if (s.biggestChain < 4) return "MATCH LOW: THE FALLOUT CHAINS!";
    if (s.cashout < 2) return "SAVE SPECIALS FOR THE CASH-OUT!";
    return "KEEP SWAPPING WHILE IT CASCADES!";
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    frameDt = rawDt;
    titleIn = Math.min(1, titleIn + rawDt * 1.6);
    const dt = hitStop.scale(rawDt);
    shake.update(rawDt);
    flash.update(rawDt);
    drops.update(rawDt);
    bits.update(rawDt);
    hudBits.update(rawDt);
    pows.update(rawDt);
    hudPows.update(rawDt);
    scorePop.update(rawDt);
    clockPop.update(rawDt);
    titlePop.update(rawDt);
    frenzyBanner = Math.max(0, frenzyBanner - rawDt * 0.6);

    if (dt > 0) {
      stepLeaving(dt);
      if (QA_AUTOPLAY && playing() && run.canSwap) {
        qaPilot ??= new Pilot(QA_AUTOPLAY, createRng(7));
        const m = qaPilot.next(run.board, dt);
        if (m) trySwap(m.from, m.to, 0.4);
      }
      if (mode === "attract") stepDemo(dt);
      else if (playing()) stepGhost(dt);
      run.step(dt);
      for (const e of run.events) handle(e);
      run.events.length = 0;
      if (mode === "attract" && run.board.cleared > 260) newAttract();
    }

    // A selection lapses if its critter is swept away or falls elsewhere.
    if (selected >= 0 && run.board.grid[selected] !== selectedPiece) selected = -1;
    // Squash springs.
    for (const p of run.board.grid) {
      if (!p) continue;
      p.sqv += (-260 * p.sq - 13 * p.sqv) * rawDt;
      p.sq += p.sqv * rawDt;
    }

    // Flyers: hang for a beat where they scored, then fly into the counter.
    for (const f of flyers) f.t += rawDt;
    if (flyers.some((f) => f.t >= 0.75)) {
      flyers = flyers.filter((f) => {
        if (f.t < 0.75) return true;
        if (f.to === "score") {
          banked += f.pts;
          scorePop.kick(Math.min(4, 1 + f.pts / 300));
          if (!bestCheered && session.best !== null && session.best > 0 && banked > session.best && mode === "play") {
            bestCheered = true;
            hudPows.burst("NEW BEST!", W / 2, by + cell * 3, { size: 34, fill: PAL.banana, life: 1.4 });
            audio.play(SND.fanfare);
            audio.play(SND.whistleUp, { pitch: 4 });
            flash.trigger(PAL.banana, 0.7);
            session.feedback("success");
            for (const side of [-1, 1])
              hudBits.emit(W / 2 + side * W * 0.42, H * 0.55, { count: 30, speed: [300, 640], angle: side < 0 ? [-Math.PI * 0.45, -Math.PI * 0.15] : [-Math.PI * 0.85, -Math.PI * 0.55], life: [0.9, 1.6], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.bubblegum, PAL.banana], shape: "confetti", gravity: 700, drag: 1.2 });
          }
        } else {
          clockPop.kick(4);
          audio.play(SND.ding, { pitch: 9, volume: 0.5 });
        }
        return false;
      });
    }
    shown = shown < banked ? Math.min(banked, damp(shown, banked, 10, rawDt) + 1) : banked;

    if (mode === "play" && playing()) {
      // Last ten seconds tick, the last five tock.
      const sec = Math.ceil(run.clock);
      if (run.phase === "play" && sec <= 10 && sec !== lastTick && sec > 0) {
        lastTick = sec;
        audio.play(sec <= FRENZY_T ? SND.tock : SND.tick, { pitch: (10 - sec) * 0.6 });
        clockPop.kick(sec <= FRENZY_T ? 3 : 1.5);
      }
      // Hint: a gentle wiggle after a few quiet seconds.
      if (run.phase === "play" && ghostDone) {
        idle += held ? 0 : rawDt;
        hintLook -= rawDt;
        if (idle > HINT_AFTER && hintLook <= 0 && (!hint || !run.board.canSwap(hint.from, hint.to))) {
          hintLook = 0.25;
          hint = chooseMove(run.board.findMoves(), 1, Math.random);
        }
      }
      if (endT >= 0 && !endSent) {
        endT += rawDt;
        // Let the last flyers land, then report (well inside the 1 s rule).
        if (endT > 0.55 || (endT > 0.2 && flyers.length === 0)) {
          for (const f of flyers) if (f.to === "score") banked += f.pts;
          flyers = [];
          endSent = true;
          const prevBest = session.best;
          const res = session.end(run.score, {
            stats: { chain: run.stats.biggestChain, specials: run.stats.specialsMade, combos: run.stats.combos, cashout: run.stats.cashout, bestMove: run.stats.bestMove },
          });
          summary = { score: run.score, isBest: res.isBest, prevBest, tip: tipFor() };
          music.stop();
          if (res.isBest && prevBest !== null) {
            hudPows.burst("NEW BEST!", W / 2, H * 0.36, { size: 38, fill: PAL.banana, life: 1.6 });
          }
        }
      }
    }
  }

  function drawBackdrop() {
    g.fillStyle = SEA;
    g.fillRect(0, 0, W, H);
    const cxs = W * 0.5;
    const cys = by + cell * ROWS * 0.4;
    const rad = Math.hypot(W, H);
    const hot = run.frenzy && mode === "play" && (run.phase === "play" || run.phase === "timeup");
    const rot = reduced ? 0.15 : time * (hot ? 0.22 : 0.05);
    const rays = 18;
    g.fillStyle = hot ? "#FFE38A" : SEA_RAY;
    g.beginPath();
    for (let i = 0; i < rays; i++) {
      const a0 = rot + (i / rays) * Math.PI * 2;
      const a1 = rot + ((i + 0.5) / rays) * Math.PI * 2;
      g.moveTo(cxs, cys);
      g.lineTo(cxs + Math.cos(a0) * rad, cys + Math.sin(a0) * rad);
      g.lineTo(cxs + Math.cos(a1) * rad, cys + Math.sin(a1) * rad);
      g.closePath();
    }
    g.fill();
    if (halftone) {
      g.globalAlpha = 0.4;
      g.drawImage(halftone, 0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  function drawPool() {
    if (!pool) return;
    const pad = RIM + 10;
    g.drawImage(pool, bx - pad, by - pad, cell * COLS + pad * 2, cell * ROWS + pad * 2);
  }

  /** Every critter, with its squash, swap stretch, lift, pop and eyes. */
  function drawCritters(ox: number, oy: number) {
    if (!art) return;
    b0Pour = run.board.time < 1.2;
    const b = run.board;
    const t = b.time;
    g.save();
    g.beginPath();
    g.rect(bx - 4, by - 4, cell * COLS + 8, cell * ROWS + 8);
    g.clip();
    // Selection and hint glows underneath.
    if (selected >= 0 && b.grid[selected]) drawSprite(g, art.glow, cx(selected) + ox, cy(selected) + oy, 0, 1 + 0.04 * light.pulse(time, 1.5), 1 + 0.04 * light.pulse(time, 1.5));
    const heldPiece = held?.piece ?? null;
    let top: Piece[] | null = null;
    for (let i = 0; i < N; i++) {
      const p = b.grid[i];
      if (!p) continue;
      if (p === heldPiece || p.state === "swap" || p.state === "back") {
        (top ??= []).push(p);
        continue;
      }
      drawCritter(p, i, ox, oy, t);
    }
    if (top) for (const p of top) drawCritter(p, b.grid.indexOf(p), ox, oy, t);
    for (const l of leaving) {
      const spr = art.body[l.special === "conch" ? 6 : l.kind];
      if (!spr) continue;
      const u = clamp(l.t / LEAVE_T);
      const k = u <= 0 ? 1 : (1 - u) * (1 + 0.3 * Math.sin(u * Math.PI));
      if (k <= 0.02) continue;
      g.setTransform(D * k, 0, 0, D * k, D * (bx + (l.x + 0.5) * cell + ox), D * (by + (l.y + 0.5) * cell + oy - u * cell * 0.25));
      g.drawImage(spr.c, -spr.ox, -spr.oy, spr.w, spr.h);
    }
    g.restore();
    g.setTransform(D, 0, 0, D, 0, 0);
  }

  function drawCritter(p: Piece, i: number, ox: number, oy: number, bt: number) {
    if (!art || i < 0) return;
    let x = bx + (col(i) + 0.5 + p.ox) * cell + ox;
    let y = by + (row(i) + 0.5 + p.oy) * cell + oy;
    if (y < by - cell * 0.6 || p.wait > 0) return;
    let sx = 1;
    let sy = 1;
    // Plopping in at the start of a run: grows as it drops into its slot.
    let k = p.oy < 0 && p.oy > -1 && b0Pour ? 0.45 + 0.55 * (1 + p.oy / 0.85) : 1;
    look.mood = "plain";
    look.blink = 0;
    // Landing squash.
    const sq = clamp(p.sq, -0.25, 0.35);
    sx *= 1 + sq * 0.7;
    sy *= 1 - sq;
    if (p.vy > 0) {
      const st = Math.min(0.14, p.vy * 0.007);
      sy *= 1 + st;
      sx *= 1 - st * 0.6;
    }
    if (p.state === "swap" || p.state === "back") {
      const u = Math.min(1, p.t / p.dur);
      const st = Math.sin(u * Math.PI) * 0.14;
      if (Math.abs(p.fx) > Math.abs(p.fy)) {
        sx *= 1 + st;
        sy *= 1 - st * 0.7;
      } else {
        sy *= 1 + st;
        sx *= 1 - st * 0.7;
      }
      if (p.state === "back") look.mood = "worried";
    } else if (p.state === "clear") {
      look.mood = "happy";
      if (p.t < 0) {
        k = 1.08;
        if (!reduced) x += Math.sin(time * 70 + i) * 1.4;
      } else {
        const u = p.t / CLEAR_T;
        k = u < 0.35 ? 1 + 0.3 * (u / 0.35) : 1.3 * (1 - (u - 0.35) / 0.65) ** 1.4;
      }
    } else if (!reduced && p.vy === 0 && p.oy === 0) {
      const br = Math.sin(time * 2.4 + p.id * 1.7) * 0.022;
      sy *= 1 + br;
      sx *= 1 - br * 0.6;
    }
    if (held && held.piece === p) {
      k *= 1.13;
      if (held.axis === "x") x += held.off * cell;
      else if (held.axis === "y") y += held.off * cell;
      y -= cell * 0.04;
    } else if (selected === i) k *= 1.08;
    if (hint && (hint.from === i || hint.to === i) && p.state === "idle") {
      // The pair nudges toward each other in short bursts.
      const other = hint.from === i ? hint.to : hint.from;
      const ph = (time % 1.3) / 1.3;
      const amp = ph < 0.45 ? Math.sin((ph / 0.45) * Math.PI * 3) * 0.09 : 0;
      x += (col(other) - col(i)) * amp * cell * (reduced ? 0.4 : 1);
      y += (row(other) - row(i)) * amp * cell * (reduced ? 0.4 : 1);
      look.mood = ph < 0.45 ? "worried" : "plain";
    }
    const age = bt - p.bornAt;
    if (age >= 0 && age < 0.7) k *= 1 + 0.45 * Math.exp(-age * 7) * Math.sin(age * 20 + 0.6);
    sx *= k;
    sy *= k;

    // Specials draw something behind.
    if (p.special === "bomb") {
      g.setTransform(D * k, 0, 0, D * k, D * x, D * y);
      const spr = art.burst;
      const rot = reduced ? 0 : time * 0.9;
      g.rotate(rot);
      g.drawImage(spr.c, -spr.ox, -spr.oy, spr.w, spr.h);
    } else if (p.special === "conch") {
      g.setTransform(D * k, 0, 0, D * k, D * x, D * y);
      const spr = art.rays;
      g.rotate(reduced ? 0 : -time * 0.7);
      g.drawImage(spr.c, -spr.ox, -spr.oy, spr.w, spr.h);
    }
    const body = art.body[p.special === "conch" ? 6 : p.kind]!;
    g.setTransform(D * sx, 0, 0, D * sy, D * x, D * y);
    g.drawImage(body.c, -body.ox, -body.oy, body.w, body.h);
    if (p.kind >= 0) {
      // Eyes follow the finger when it's near, look up while falling, wander otherwise.
      if (finger && mode === "play") {
        const dx = finger.x - x;
        const dy = finger.y - y;
        const d = Math.max(36, Math.hypot(dx, dy));
        look.x = clamp(dx / d, -1, 1);
        look.y = clamp(dy / d, -1, 1);
      } else if (p.vy > 0) {
        look.x = 0;
        look.y = -0.9;
      } else if (mode === "attract" && hand.phase !== "idle") {
        const dx = handNow.x - x;
        const dy = handNow.y - y;
        const d = Math.max(36, Math.hypot(dx, dy));
        look.x = dx / d;
        look.y = dy / d;
      } else {
        look.x = Math.sin(time * 0.7 + p.id * 2.1) * 0.6;
        look.y = Math.cos(time * 0.5 + p.id * 1.3) * 0.4;
      }
      const period = 3 + hash(p.id, 2) * 4;
      const bph = (time + hash(p.id, 5) * 9) % period;
      look.blink = look.mood === "plain" && bph < 0.14 ? Math.sin((bph / 0.14) * Math.PI) : 0;
      drawEyes(g, p.kind, R, look);
    }
    if (p.special === "lineH" || p.special === "lineV") {
      const pulse = reduced ? 1 : 1 + 0.07 * light.pulse(time, 1.6);
      const vert = p.special === "lineV";
      const spr = art.arrows;
      if (vert) g.setTransform(0, D * k, -D * k * pulse, 0, D * x, D * y);
      else g.setTransform(D * k * pulse, 0, 0, D * k, D * x, D * y);
      g.drawImage(spr.c, -spr.ox, -spr.oy, spr.w, spr.h);
    } else if (p.special === "bomb") {
      g.setTransform(D * k, 0, 0, D * k, D * (x + R * 0.66 * k), D * (y + R * 0.6 * k));
      g.drawImage(art.bomb.c, -art.bomb.ox, -art.bomb.oy, art.bomb.w, art.bomb.h);
      const sp = 0.8 + 0.35 * light.pulse(time + p.id, 2);
      g.setTransform(D * k * sp, 0, 0, D * k * sp, D * (x + R * (0.66 + 0.5) * k), D * (y + R * (0.6 - 0.5) * k));
      g.drawImage(art.spark.c, -art.spark.ox, -art.spark.oy, art.spark.w, art.spark.h);
    }
  }

  function drawFx(ox: number, oy: number) {
    g.save();
    g.translate(ox, oy);
    const bw = cell * COLS;
    const bh = cell * ROWS;
    // Water jets.
    for (let k = beams.length - 1; k >= 0; k--) {
      const b = beams[k]!;
      b.t += frameDt;
      // Shoots out to both edges, holds a beat, then thins away.
      const grow = clamp(b.t / 0.1);
      const thin = b.t < 0.22 ? 1 : Math.max(0, 1 - (b.t - 0.22) / 0.3) ** 0.7;
      if (thin <= 0) {
        beams.splice(k, 1);
        continue;
      }
      const w = Math.max(4, cell * 0.66 * thin);
      if (b.horiz) {
        const x0 = lerp(b.x, bx, grow);
        const x1 = lerp(b.x, bx + bw, grow);
        roundRectPath(g, x0 - 4, b.y - w / 2, x1 - x0 + 8, w, w / 2);
      } else {
        const y0 = lerp(b.y, by, grow);
        const y1 = lerp(b.y, by + bh, grow);
        roundRectPath(g, b.x - w / 2, y0 - 4, w, y1 - y0 + 8, w / 2);
      }
      inkFill(g, PAL.white, 3.5, 0);
      g.fillStyle = SEA_RAY;
      if (b.horiz) g.fillRect(lerp(b.x, bx, grow), b.y - w * 0.12, lerp(b.x, bx + bw, grow) - lerp(b.x, bx, grow), w * 0.24);
      else g.fillRect(b.x - w * 0.12, lerp(b.y, by, grow), w * 0.24, lerp(b.y, by + bh, grow) - lerp(b.y, by, grow));
    }
    // Boomer blasts: a jagged burst that grows in and shrinks away (never pops on or off in one frame).
    for (let k = blasts.length - 1; k >= 0; k--) {
      const b = blasts[k]!;
      b.t += frameDt;
      const life = 0.42;
      if (b.t >= life || !blastSpr) {
        blasts.splice(k, 1);
        continue;
      }
      const u = b.t / life;
      const s = (u < 0.35 ? easeOutBack(u / 0.35, 1.4) : 1 - easeInCubic((u - 0.35) / 0.65)) * (b.r / (cell * 2.6));
      drawSprite(g, blastSpr, b.x, b.y, b.t * 2, s, s);
    }
    // Rings (pops, honks).
    g.lineWidth = 3;
    g.strokeStyle = PAL.white;
    for (let k = rings.length - 1; k >= 0; k--) {
      const r = rings[k]!;
      r.t += frameDt;
      if (r.t >= r.life) {
        rings.splice(k, 1);
        continue;
      }
      if (r.t < 0) continue;
      const u = r.t / r.life;
      g.globalAlpha = 1 - u;
      g.lineWidth = 4 * (1 - u) + 1;
      g.beginPath();
      g.arc(r.x, r.y, r.r * (0.4 + u * 0.8), 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    drops.draw(g);
    bits.draw(g);
    pows.draw(g);
    g.restore();
  }

  function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
  }

  function drawHud() {
    hudBits.draw(g);
    // Flyers (under the call-outs, so a word is never covered by a number).
    const sp = scorePos();
    const cp = clockPos();
    for (const f of flyers) {
      const hang = 0.4;
      let x = f.x;
      let y = f.y - Math.min(1, f.t / hang) * 18;
      let s: number;
      if (f.t > hang) {
        const u = easeInCubic(Math.min(1, (f.t - hang) / 0.35));
        const tx = f.to === "score" ? sp.x + 40 : cp.x;
        const ty = f.to === "score" ? sp.y : cp.y;
        x = lerp(x, tx, u);
        y = lerp(y, ty, u) - Math.sin(u * Math.PI) * 30;
        s = 1 - u * 0.45;
      } else s = f.t < 0.1 ? 0.5 + f.t * 5 : 1;
      sticker(g, f.label, x, y, { size: Math.round(f.size), fill: f.to === "time" ? PAL.limeHi : PAL.banana, sx: s, sy: s, shadow: 2.5 });
    }
    hudPows.draw(g);
    if (mode !== "play") {
      drawAttract();
      return;
    }
    // Score.
    g.save();
    g.translate(sp.x, sp.y);
    g.rotate(-0.06);
    g.scale(scorePop.v, scorePop.v);
    const cashing = run.phase === "cashout";
    sticker(g, fmt(shown), 0, 0, { size: cashing ? 44 : 38, align: "left", fill: cashing ? PAL.banana : PAL.white, shadow: 4 });
    g.restore();
    if (session.best !== null) sticker(g, `BEST ${fmt(session.best)}`, sp.x + 2, sp.y + 40, { size: 13, align: "left", fill: PAL.banana, shadow: 2, rot: -0.04 });
    // Clock: a stopwatch badge whose wedge drains.
    const secs = Math.ceil(run.clock);
    const hot = run.phase === "play" && run.clock <= FRENZY_T;
    g.save();
    g.translate(cp.x, cp.y);
    const cs = clockPop.v;
    g.scale(cs, cs);
    g.rotate(0.05);
    // Crown button.
    roundRectPath(g, -8, -40, 16, 10, 3);
    inkFill(g, PAL.tomato, 3, 2.5);
    g.beginPath();
    g.arc(0, 0, 32, 0, Math.PI * 2);
    inkFill(g, PAL.cream, 4, 4);
    const frac = run.phase === "play" ? clamp(run.clock / 60) : 0;
    if (frac > 0) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      g.closePath();
      g.fillStyle = hot ? PAL.tomato : SEA;
      g.fill();
    }
    g.restore();
    sticker(g, run.phase === "play" ? `${secs}` : "0", cp.x, cp.y + 1, { size: secs >= 100 ? 20 : 24, fill: hot ? PAL.banana : PAL.white, shadow: 2.5, sx: cs, sy: cs });
    // Banners over the top of the pool.
    if (run.frenzy && run.phase === "play") {
      const wob = reduced ? 0 : Math.sin(time * 9) * 0.04;
      burstSticker(g, "FRENZY ×2", W / 2, by - 30, { size: 17, fill: PAL.tomato, rx: 82, ry: 24, seed: 11, rot: -0.04 + wob, scale: 1 + frenzyBanner * 0.3 });
    } else if (run.phase === "cashout") {
      burstSticker(g, "CASH-OUT!", W / 2, by - 30, { size: 18, fill: PAL.lime, textFill: PAL.white, rx: 92, ry: 24, seed: 21, rot: 0.04 + (reduced ? 0 : Math.sin(time * 7) * 0.04) });
    }
    if (session.phase === "over") drawSummary();
  }

  /**
   * What the run achieved, how it compares with the best, and one tip. In the feed the shell's result card covers
   * the upper middle and the caption the bottom, so this is a compact strip just above the caption.
   */
  function drawSummary() {
    const sm = summary;
    if (!sm || session.phaseTime < 0.35) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 16 : pv.left + 12;
    const right = W - (solo ? 16 : pv.right + 6);
    const w = right - left;
    const ph = 112;
    const topY = solo ? Math.round(H * 0.5) : H - pv.bottom - ph - 6;
    const k = easeOutBack(clamp((session.phaseTime - 0.35) / 0.4), 1.5);
    g.save();
    g.translate(left + w / 2, topY + ph / 2);
    g.scale(k, k);
    g.rotate(-0.012);
    roundRectPath(g, -w / 2, -ph / 2, w, ph, 16);
    inkFill(g, PAL.cream, 4, 5);
    const x0 = -w / 2 + 14;
    const s = run.stats;
    sticker(g, `CHAIN ×${Math.max(1, s.biggestChain)}`, x0, -ph / 2 + 20, { size: 14, align: "left", fill: PAL.banana, shadow: 2 });
    sticker(g, `BEST MOVE +${fmt(s.bestMove)}`, w / 2 - 14, -ph / 2 + 20, { size: 14, align: "right", fill: PAL.bubblegumHi, shadow: 2 });
    // Progress against the best.
    const y0 = -ph / 2 + 40;
    const bw = w - 28;
    roundRectPath(g, x0, y0, bw, 22, 11);
    inkFill(g, PAL.white, 3, 0);
    const prev = sm.prevBest;
    const frac = sm.isBest || !prev ? 1 : clamp(sm.score / prev);
    const grow = Math.min(1, (session.phaseTime - 0.35) / 0.8);
    if (frac > 0.02) {
      roundRectPath(g, x0 + 3, y0 + 3, Math.max(16, (bw - 6) * frac * grow), 16, 8);
      g.fillStyle = sm.isBest ? PAL.lime : SEA;
      g.fill();
    }
    const label = sm.isBest ? (prev ? `NEW BEST! +${fmt(sm.score - prev)}` : "FIRST SCORE ON THE BOARD!") : `${Math.round(frac * 100)}% OF YOUR BEST`;
    sticker(g, label, 0, y0 + 11, { size: 13, fill: PAL.white, shadow: 1.5 });
    // One tip for next time.
    g.font = font(12);
    g.fillStyle = PAL.ink;
    g.textAlign = "left";
    g.textBaseline = "middle";
    const tip = `TIP: ${sm.tip}`;
    let size = 12;
    while (size > 9 && g.measureText(tip).width > bw) g.font = font(--size);
    g.fillText(tip, x0, ph / 2 - 24);
    g.restore();
    if (solo && session.phaseTime > 0.8) {
      sticker(g, fmt(sm.score), W / 2, topY - 70, { size: 52, fill: PAL.banana, cut: 5, shadow: 5, rot: -0.05, sx: scorePop.v, sy: scorePop.v });
      burstSticker(g, "TAP TO BOP AGAIN!", W / 2, topY + ph + 54, { size: 19, fill: PAL.tomato, rx: 150, ry: 34, seed: 31, rot: -0.04 + (reduced ? 0 : Math.sin(time * 5) * 0.05) });
    }
  }

  function drawAttract() {
    const ins = session.preview();
    const left = ins.left + 12;
    const right = W - ins.right - 12;
    const topY = ins.top + 6;
    const bottomY = H - ins.bottom - 10;
    const aw = right - left;
    const cxx = left + aw / 2;
    const k = Math.min(1, aw / 300);
    const pop = titleIn < 1 ? 0.4 + 0.6 * (1 - (1 - titleIn) ** 3) + Math.sin(titleIn * 9) * 0.08 * (1 - titleIn) : 1;
    const amp = reduced ? 2 : 9;
    const letter = (i: number, fill: string) => {
      const ph = (((time * (reduced ? 0.5 : 1.3) - i * 0.08) % 1) + 1) % 1;
      const hop = 4 * ph * (1 - ph);
      return { dx: 0, dy: -hop * amp, rot: Math.sin(time * 2 + i) * 0.05, sx: 1, sy: 1, fill };
    };
    g.save();
    g.translate(cxx, topY + 46 * k);
    g.scale(pop * k * titlePop.v, pop * k * titlePop.v);
    stickerWord(g, "BRINE", -18, 0, { size: 52, rot: -0.08, cut: 6, shadow: 6 }, (i) => letter(i, i % 2 ? PAL.tomato : "#FF6E5E"));
    stickerWord(g, "BOP!", 58, 54, { size: 60, rot: 0.06, cut: 6, shadow: 7 }, (i) => letter(i + 5, PAL.banana));
    g.restore();
    if (session.best !== null) sticker(g, `BEST ${fmt(session.best)}`, left + 56 * k, topY + 118 * k, { size: 15 * Math.max(0.85, k), rot: -0.08, fill: PAL.white, shadow: 2.5 });
    const py = bottomY - 34;
    const wob = reduced ? 0 : Math.sin(time * 5.2) * 0.07;
    const sc = 1 + (reduced ? 0 : Math.sin(time * 7.3) * 0.045);
    burstSticker(g, "TAP TO BOP!", cxx + 2, py, { size: 25, fill: PAL.tomato, rx: 132, ry: 40, seed: 42, rot: -0.06 + wob, scale: sc * k });
    // The demo hand.
    if (hand.alpha > 0.01 && hand.phase !== "idle") {
      g.save();
      g.globalAlpha = hand.alpha;
      drawGloveAt(handNow.x, handNow.y, handNow.press);
      g.restore();
    }
  }

  function render() {
    handNow = handPos(hand);
    view.begin();
    drawBackdrop();
    const o = shake.offset;
    g.save();
    g.translate(o.x, o.y);
    drawPool();
    g.restore();
    drawCritters(o.x, o.y);
    view.begin();
    if (mode === "play" && session.phase === "over") {
      // The pool steps back behind the summary.
      g.fillStyle = "rgba(22,18,28,0.28)";
      g.fillRect(bx - RIM, by - RIM, cell * COLS + RIM * 2, cell * ROWS + RIM * 2);
    }
    drawFx(o.x, o.y);
    if (mode === "play" && session.phase === "playing") drawGhost();
    drawHud();
    flash.draw(g, W, H);
  }

  newAttract(false);
  update(0);
  render();
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (++frames === 2) session.ready();
  });
}

void main();
