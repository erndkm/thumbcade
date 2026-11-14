/**
 * Ringblot: beetles that walked through the ink share a sheet of paper. Swipe to walk a loop off your print and come
 * home: the press prints everything inside it. Walk across a rival's wet line and its print is gone. The ink is
 * drying the whole time. Printed the bitbybit way: four spot inks on warm paper, halftone tints, a hair off register.
 */
import { clamp, dampAngle, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BANNER_PX, BANNER_SUB_PX, barLabel, goalLine, HINT, HINT_LINE, LINES, NOTES, POP_PX, printedSub, PROMPT, pullLine, shareLine, sheetLine, statLine, TAGLINE, TAGLINE_2, TIP_MIN_PX, TIP_PX, tipFor, TITLE } from "./copy.ts";
import { bedFor, bedKey, cueFor } from "./cues.ts";
import { steps } from "./grid.ts";
import { sheetLayout } from "./layout.ts";
import { DEMO, Pilot, SKILLS } from "./pilot.ts";
import { PAPER, Press, RISO, type Ink } from "./riso.ts";
import { QA_PILOT_SEED, runSeed } from "./runs.ts";
import { COLS, HERO, HZ, INK_LOW, INK_MAX, N, posX, posY, PRINT_TIME, ROWS, Sim, xOf, yOf, type Bug, type SimEvent } from "./sim.ts";
import { createSound } from "./sound.ts";
import { readSwipe, startThumb, type Thumb } from "./swipe.ts";
import { fmt, light, loadType, medium, spaced, spacedWidth } from "./type.ts";

const TAU = Math.PI * 2;
const KEY = "key";
const RED = "red";
const BLUE = "blue";
const SUN = "sun";
const PLATES = [KEY, RED, BLUE, SUN] as const;
type PlateName = (typeof PLATES)[number];
/** Black is the key plate (type, legs, the grid); bright red is the player; blue and sunflower are the rivals. */
const INKS: Ink[] = [
  { name: KEY, color: RISO.black, angle: 0.79 },
  { name: RED, color: RISO.brightRed, angle: 0.26 },
  { name: BLUE, color: RISO.blue, angle: 1.31 },
  { name: SUN, color: RISO.sunflower, angle: 0 },
];
const PLATE_OF: PlateName[] = [KEY, RED, BLUE, SUN];
/** How heavily each beetle's print is laid down (sunflower is a light ink and needs more of it). */
const COVER = [0, 0.6, 0.55, 0.8];
/** Seconds between the ink running dry and gameplay.end, well inside the 1 s rule. */
const END_AFTER = 0.8;
/** Seconds a smudged print takes to lift off the paper. */
const GHOST = 0.8;
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=expert vite build`); a normal build can't. */
const QA_AUTOPLAY = SKILLS.find((k) => k.name === import.meta.env.VITE_AUTOPLAY) ?? null;

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  life: number;
  plate: PlateName;
  size: number;
}
interface Banner {
  text: string;
  sub: string;
  t: number;
  life: number;
}
interface Ghost {
  cells: number[];
  line: number[];
  plate: PlateName;
  cover: number;
  t: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "ringblot", restartDelayMs: 800 }), loadType()]);
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<boolean>("hint")) === true;
  } catch {
    /* guests and offline: show the hint */
  }
  const view = createCanvas({ maxDpr: 2, background: PAPER });
  const { ctx } = view;
  const press = new Press({ paper: PAPER, inks: INKS, grain: 0.4, slip: 1.2, cell: 3.9, scale: 0.8 });
  const reduced = session.reducedMotion;
  const light01 = new Photosafe(reduced);
  const sound = createSound();
  const shake = new Shake(6, 0, 2.4, reduced);
  const hitStop = new HitStop();

  let W = view.width;
  let H = view.height;
  /** Px a square, and the sheet's top-left corner. */
  let cs = 24;
  let fx = 0;
  let fy = 0;
  let grid: HTMLCanvasElement | null = null;

  function layout(): void {
    W = view.width;
    H = view.height;
    press.resize(W, H, view.dpr);
    ({ cs, fx, fy } = sheetLayout(W, H, session.play().top));
    // The dot grid, once per size: a faint key-ink dot at every corner of every square.
    const g = document.createElement("canvas");
    const k = view.dpr * 0.8;
    g.width = Math.ceil((COLS * cs + 4) * k);
    g.height = Math.ceil((ROWS * cs + 4) * k);
    const c = g.getContext("2d")!;
    c.scale(k, k);
    c.fillStyle = RISO.black;
    c.globalAlpha = 0.34;
    for (let y = 0; y <= ROWS; y++) for (let x = 0; x <= COLS; x++) c.fillRect(2 + x * cs - 0.7, 2 + y * cs - 0.7, 1.4, 1.4);
    grid = g;
  }
  layout();
  view.onResize(layout);
  session.on("insets", layout);

  // ------------------------------------------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let demoSeed = (session.ctx.seed ^ 0x51ab07) >>> 0;
  let sim = new Sim({ seed: demoSeed });
  let pilot: Pilot | null = new Pilot(DEMO, createRng(demoSeed ^ 7));
  let qaPilot: Pilot | null = null;
  let qaAcc = 0;
  let time = 0;
  let shown = 0;
  let endT = -1;
  let ended = false;
  let bestCheered = false;
  let bestAtStart: number | null = null;
  let summary: { score: number; isBest: boolean; prevBest: number | null; tip: string; line: string } | null = null;
  let popups: Popup[] = [];
  let banners: Banner[] = [];
  let ghosts: Ghost[] = [];
  let thumb: Thumb | null = null;
  let prints = 0;
  let stepAt = 0;
  let inkPop = 0;
  let sharePop = 0;
  let fresh = 1;
  let fly: { x: number; y: number; t: number } | null = null;
  let bonkT = 9;
  let bonkDir = 0;
  /** When each square's print shows (seconds on `time`), so a loop floods outward from where it closed. */
  const born = new Float32Array(N);
  const angle = [0, 0, 0, 0];
  const walk = [0, 0, 0, 0];

  const playing = () => mode === "play" && session.phase === "playing" && !session.paused;
  const loud = () => mode === "play";
  const X = (x: number) => fx + (x + 0.5) * cs;
  const Y = (y: number) => fy + (y + 0.5) * cs;

  function resetFx(): void {
    popups = [];
    banners = [];
    ghosts = [];
    thumb = null;
    fly = null;
    born.fill(-9);
    fresh = 1;
    bonkT = 9;
    press.register(sim.sheet * 7 + (demoSeed & 0xff));
  }

  function newDemo(): void {
    mode = "attract";
    demoSeed = (Math.imul(demoSeed, 1664525) + 1013904223) >>> 0;
    sim = new Sim({ seed: demoSeed });
    pilot = new Pilot(DEMO, createRng(demoSeed ^ 7));
    resetFx();
  }

  function startRun(): void {
    mode = "play";
    sim = new Sim({ seed: runSeed(session.ctx.seed, session.runs) });
    pilot = null;
    qaPilot = QA_AUTOPLAY ? new Pilot(QA_AUTOPLAY, createRng(QA_PILOT_SEED)) : null;
    qaAcc = 0;
    resetFx();
    shown = 0;
    endT = -1;
    ended = false;
    bestCheered = false;
    bestAtStart = session.best;
    summary = null;
    prints = 0;
    sound.play("start");
    banner(sheetLine(1), goalLine(sim.goal), 1.5);
  }

  session.startOnTap(window);
  session.on("start", startRun);

  // ------------------------------------------------------------------------------------------------------------
  // Input: swipe anywhere, and keep the thumb down to steer round the next corner too
  // ------------------------------------------------------------------------------------------------------------
  function steer(d: number): void {
    if (!playing() || qaPilot) return;
    sim.steer(d);
  }
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (thumb || !playing()) return;
    thumb = startThumb(e.pointerId, e.clientX, e.clientY);
  });
  window.addEventListener("pointermove", (e) => {
    if (!thumb || e.pointerId !== thumb.id) return;
    const d = readSwipe(thumb, e.clientX, e.clientY);
    if (d >= 0) steer(d);
  });
  const lift = (e: PointerEvent) => {
    if (thumb && e.pointerId === thumb.id) thumb = null;
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  session.on("cancel", () => (thumb = null));
  session.on("pause", () => {
    thumb = null;
    sound.bed("off", bedKey(sim.sheet));
  });
  window.addEventListener("keydown", (e) => {
    const d = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, KeyW: 0, KeyD: 1, KeyS: 2, KeyA: 3 }[e.code];
    if (d !== undefined) {
      e.preventDefault();
      steer(d);
    }
  });

  // ------------------------------------------------------------------------------------------------------------
  // What happens, as words, ink and sound
  // ------------------------------------------------------------------------------------------------------------
  function popup(text: string, x: number, y: number, plate: PlateName, size = POP_PX, life = 0.9): void {
    popups.push({ text, x: clamp(x, fx + 44, fx + COLS * cs - 44), y: Math.max(fy + 22, y), t: 0, life, plate, size });
    if (popups.length > 8) popups.shift();
  }
  function banner(text: string, sub = "", life = 1.6): void {
    banners = [{ text, sub, t: 0, life }];
  }

  function handle(e: SimEvent): void {
    // The cue table decides what is heard and felt; the rest of this is what is seen.
    const cue = cueFor(e);
    const level = loud() ? 1 : 0.25;
    if (loud() || e.k === "print" || e.k === "smudge" || e.k === "sheet") {
      cue.sounds.forEach((name, i) => {
        if (name === "step") {
          if (time - stepAt < 0.05) return;
          stepAt = time;
        }
        sound.play(name, i === 0 ? (cue.pitch ?? 0) : 0, level);
      });
    }
    if (cue.haptic && loud()) session.feedback(cue.haptic);
    switch (e.k) {
      case "bonk":
        bonkT = 0;
        bonkDir = e.dir;
        break;
      case "print": {
        // The ink floods outward from where the loop closed.
        for (const c of e.cells) born[c] = time + (reduced ? 0 : steps(c, e.from) * 0.016);
        if (e.id !== HERO) break;
        prints++;
        if (!hintSeen && prints >= 2) {
          hintSeen = true;
          tc.storage.set("hint", true).catch(() => undefined);
        }
        inkPop = 1;
        sharePop = 1;
        popup(pullLine(e.pts, e.tier, fmt), X(xOf(e.from)), Y(yOf(e.from)) - cs * 1.1, RED, POP_PX + (e.tier - 1) * 1.5, 1);
        if (e.tier >= 2 && !reduced) {
          press.jolt(1.2 + e.tier * 0.5, sim.tick);
          shake.add(0.1 * e.tier);
          hitStop.freeze(0.03 * e.tier);
        }
        break;
      }
      case "shave":
        popup(`${NOTES.shave} +${e.pts}`, X(xOf(e.cell)), Y(yOf(e.cell)) + cs * 1.3, KEY, 13, 0.9);
        break;
      case "smudge":
        ghosts.push({ cells: e.land, line: e.line, plate: PLATE_OF[e.id]!, cover: COVER[e.id]!, t: 0 });
        if (e.by === HERO) {
          popup(`${NOTES.smudge} +${fmt(e.pts)}`, X(xOf(e.cell)), Y(yOf(e.cell)) - cs, RED, POP_PX + 2, 1.1);
          inkPop = 1;
          if (!reduced) press.jolt(3, sim.tick);
          shake.add(0.35);
          hitStop.freeze(0.08);
        }
        break;
      case "smudged": {
        ghosts.push({ cells: [], line: e.line, plate: RED, cover: 1, t: 0 });
        const l = e.by === 0 ? LINES.boxed : LINES.smudged;
        if (loud()) banner(l[0], l[1], 1.3);
        fly = { x: xOf(e.cell), y: yOf(e.cell), t: 0 };
        if (!reduced) press.jolt(4, sim.tick);
        shake.add(0.5);
        hitStop.freeze(0.1);
        break;
      }
      case "crawl":
        for (let i = 0; i < N; i++) if (sim.owner[i] === e.id) born[i] = time + (reduced ? 0 : steps(i, e.cell) * 0.05);
        break;
      case "low":
        if (loud()) popup(LINES.low[0], W / 2, fy + 26, RED, 14, 1.4);
        break;
      case "sheet":
        if (loud()) banner(`${sheetLine(e.sheet)} printed`, printedSub(e.bonus, e.clean, fmt), PRINT_TIME);
        if (!reduced) press.jolt(2.5, sim.tick);
        break;
      case "fresh":
        ghosts = [];
        born.fill(-9);
        fresh = 0;
        press.register(e.sheet * 7 + (demoSeed & 0xff));
        if (loud()) banner(sheetLine(e.sheet), goalLine(sim.goal), 1.5);
        break;
      case "over":
        endT = 0;
        if (loud()) banner(LINES.dry[0], "", 1.2);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------------------------
  function update(rawDt: number): void {
    session.tick(rawDt);
    time += rawDt;
    // QA runs skip hit-stop, so the run's clock is the wall clock and its screenshots can be planned.
    const dt = QA_AUTOPLAY ? rawDt : hitStop.scale(rawDt);
    shake.update(rawDt);
    press.settle(rawDt);
    inkPop = Math.max(0, inkPop - rawDt * 3);
    sharePop = Math.max(0, sharePop - rawDt * 3);
    fresh = Math.min(1, fresh + rawDt / 0.4);
    bonkT += rawDt;
    for (const p of popups) p.t += rawDt;
    if (popups.some((p) => p.t >= p.life)) popups = popups.filter((p) => p.t < p.life);
    for (const b of banners) b.t += rawDt;
    if (banners.some((b) => b.t >= b.life)) banners = banners.filter((b) => b.t < b.life);
    for (const g of ghosts) g.t += rawDt;
    if (ghosts.some((g) => g.t >= GHOST)) ghosts = ghosts.filter((g) => g.t < GHOST);
    if (fly && (fly.t += rawDt) >= 0.28) fly = null;

    if (dt > 0 && (mode === "attract" || session.phase === "playing")) {
      if (qaPilot && mode === "play") {
        // In lockstep, sixty looks a second: the same run scripts/shoot-plan.ts replays headless.
        qaAcc += dt;
        while (qaAcc >= 1 / 60 - 1e-9 && !sim.over) {
          qaAcc -= 1 / 60;
          qaPilot.step(sim, 1 / 60);
          sim.step(1 / 60);
        }
      } else {
        if (mode === "attract") pilot?.step(sim, dt);
        sim.step(dt);
      }
      for (const e of sim.events) handle(e);
      sim.events.length = 0;
      for (const b of sim.bugs) {
        if (b.dir >= 0) {
          angle[b.id] = dampAngle(angle[b.id]!, (b.dir * Math.PI) / 2, reduced ? 60 : 22, dt);
          walk[b.id] = (walk[b.id]! + b.speed * dt * 0.9) % 1;
        }
      }
      if (mode === "attract" && (sim.over || sim.sheet > 2 || sim.t > 60)) newDemo();
    }
    sound.bed(bedFor(sim.phase, sim.ink, playing()), bedKey(sim.sheet));

    const target = sim.score;
    shown = shown < target ? Math.min(target, shown + Math.max(1, (target - shown) * 12 * rawDt)) : target;
    if (mode === "play" && !bestCheered && bestAtStart !== null && bestAtStart > 0 && shown > bestAtStart && session.phase === "playing") {
      bestCheered = true;
      banner(LINES.best[0], fmt(sim.score), 1.5);
      sound.play("best");
      session.feedback("success");
    }
    if (mode === "play" && endT >= 0 && !ended) {
      endT += rawDt;
      if (endT >= END_AFTER) {
        ended = true;
        const prevBest = session.best;
        const s = sim.stats;
        const res = session.end(sim.score, { stats: { sheet: sim.sheet, squares: s.squares, prints: s.prints, biggest: s.biggest, smudges: s.smudges, smudged: s.smudged + s.selfCuts } });
        summary = { score: sim.score, isBest: res.isBest, prevBest, tip: tipFor(s, sim.sheet, sim.t), line: statLine(sim.sheet, s, fmt) };
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // The press
  // ------------------------------------------------------------------------------------------------------------
  function knock(path: (c: CanvasRenderingContext2D) => void): void {
    for (const p of PLATES) {
      const c = press.plate(p);
      c.globalCompositeOperation = "destination-out";
      c.fillStyle = "#000";
      c.beginPath();
      path(c);
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
  }
  function ticket(x: number, y: number, w: number, h: number, rule = true): void {
    knock((c) => c.rect(x, y, w, h));
    if (rule) {
      const r = press.plate(RED);
      r.fillStyle = press.solid(RED);
      r.fillRect(x, y, w, 1.5);
    }
  }
  function doublePrint(text: string, x: number, y: number, font: string, track: number, off: number, align = 0.5): void {
    const k = press.plate(KEY);
    k.fillStyle = press.solid(KEY);
    spaced(k, text, x, y, font, track, align);
    const r = press.plate(RED);
    r.fillStyle = press.solid(RED);
    spaced(r, text, x + off, y + off * 0.6, font, track, align);
  }
  function capsule(word: string, x: number, y: number, u: number): void {
    const c = press.plate(RED);
    const breathe = light01.pulse(time, 0.5, { still: 0.5 });
    const font = medium(12.5 * u);
    const track = 4.2 * u;
    const tw = spacedWidth(c, word, font, track);
    const w = tw + 34 * u + breathe * 6 * u;
    const h = 30 * u;
    knock((g) => g.roundRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, h / 2 + 3));
    c.fillStyle = press.solid(RED);
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "#000";
    spaced(c, word, x + track / 2, y + 4.5 * u, font, track);
    c.globalCompositeOperation = "source-over";
  }
  function regMark(x: number, y: number, r: number): void {
    for (const p of PLATES) {
      const c = press.plate(p);
      c.strokeStyle = press.solid(p);
      c.lineWidth = 0.9;
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.moveTo(x - r * 1.7, y);
      c.lineTo(x + r * 1.7, y);
      c.moveTo(x, y - r * 1.7);
      c.lineTo(x, y + r * 1.7);
      c.stroke();
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // The sheet
  // ------------------------------------------------------------------------------------------------------------
  function drawSheet(): void {
    const sx = shake.offset.x;
    const sy = shake.offset.y;
    const ox = fx + sx;
    const oy = fy + sy;
    const k = press.plate(KEY);
    if (grid) k.drawImage(grid, ox - 2, oy - 2, COLS * cs + 4, ROWS * cs + 4);
    // The edge of the sheet, and its registration marks.
    k.strokeStyle = press.solid(KEY);
    k.lineWidth = 1.2;
    k.strokeRect(ox - 1.5, oy - 1.5, COLS * cs + 3, ROWS * cs + 3);
    // Prints: a halftone tint a square, growing in as the flood reaches it, with a solid edge where the print stops.
    for (let id = 1; id <= 3; id++) {
      if (!sim.held[id]) continue;
      const plate = PLATE_OF[id]!;
      const c = press.plate(plate);
      const tint = press.screen(plate, COVER[id]!);
      const solid = press.solid(plate);
      const edge = Math.max(1.6, cs * 0.09);
      for (let i = 0; i < N; i++) {
        if (sim.owner[i] !== id) continue;
        const age = time - born[i]!;
        if (age <= 0) continue;
        const x = ox + xOf(i) * cs;
        const y = oy + yOf(i) * cs;
        if (age < 0.16) {
          const g = easeOutBack(age / 0.16, 1.4);
          c.fillStyle = tint;
          c.fillRect(x + (cs * (1 - g)) / 2, y + (cs * (1 - g)) / 2, cs * g, cs * g);
          continue;
        }
        c.fillStyle = tint;
        c.fillRect(x - 0.3, y - 0.3, cs + 0.6, cs + 0.6);
        c.fillStyle = solid;
        const cx = xOf(i);
        const cy = yOf(i);
        if (cy === 0 || sim.owner[i - COLS] !== id) c.fillRect(x, y, cs, edge);
        if (cy === ROWS - 1 || sim.owner[i + COLS] !== id) c.fillRect(x, y + cs - edge, cs, edge);
        if (cx === 0 || sim.owner[i - 1] !== id) c.fillRect(x, y, edge, cs);
        if (cx === COLS - 1 || sim.owner[i + 1] !== id) c.fillRect(x + cs - edge, y, edge, cs);
      }
    }
    // A smudged print lifts off the paper: its tint thins out, its line breaks up.
    for (const g of ghosts) {
      const f = 1 - g.t / GHOST;
      const c = press.plate(g.plate);
      c.fillStyle = press.screen(g.plate, g.cover * f);
      for (const i of g.cells) c.fillRect(ox + xOf(i) * cs, oy + yOf(i) * cs, cs, cs);
      c.fillStyle = press.screen(g.plate, f);
      const r = cs * 0.17 * (0.6 + 0.4 * f);
      for (const i of g.line) {
        c.beginPath();
        c.arc(ox + (xOf(i) + 0.5) * cs + Math.sin(i * 7.3) * (1 - f) * cs * 0.3, oy + (yOf(i) + 0.5) * cs + Math.cos(i * 5.1) * (1 - f) * cs * 0.3, r, 0, TAU);
        c.fill();
      }
    }
    // Wet lines.
    for (const b of sim.bugs) {
      if (!b.on || !b.line.length) continue;
      const c = press.plate(PLATE_OF[b.id]!);
      c.strokeStyle = press.solid(PLATE_OF[b.id]!);
      c.lineWidth = cs * (b.id === HERO ? 0.34 : 0.28);
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(ox + (xOf(b.gate) + 0.5) * cs, oy + (yOf(b.gate) + 0.5) * cs);
      for (const i of b.line) c.lineTo(ox + (xOf(i) + 0.5) * cs, oy + (yOf(i) + 0.5) * cs);
      c.lineTo(ox + (posX(b) + 0.5) * cs, oy + (posY(b) + 0.5) * cs);
      c.stroke();
    }
    for (const b of sim.bugs) if (b.on) drawBug(b, sx, sy);
  }

  /** A beetle from above: body in its own ink, head and legs in key, on a little halo of bare paper. */
  function drawBug(b: Bug, sx: number, sy: number): void {
    let x = X(posX(b)) + sx;
    let y = Y(posY(b)) + sy;
    if (b.id === HERO) {
      if (fly) {
        const f = easeOutCubic(fly.t / 0.28);
        x = lerp(X(fly.x), x, f);
        y = lerp(Y(fly.y), y, f);
      }
      if (bonkT < 0.18) {
        const bump = Math.sin((bonkT / 0.18) * Math.PI) * cs * 0.16;
        x += [0, 1, 0, -1][bonkDir]! * bump;
        y += [-1, 0, 1, 0][bonkDir]! * bump;
      }
    }
    const s = cs * (b.id === HERO ? 1.12 : 1);
    const a = angle[b.id]!;
    const w = walk[b.id]!;
    const moving = b.dir >= 0 && sim.phase === "play";
    knock((c) => c.arc(x, y, s * 0.52, 0, TAU));
    const k = press.plate(KEY);
    k.save();
    k.translate(x, y);
    k.rotate(a);
    k.strokeStyle = press.solid(KEY);
    k.fillStyle = press.solid(KEY);
    k.lineWidth = Math.max(1.2, s * 0.07);
    k.lineCap = "round";
    k.beginPath();
    for (let i = -1; i <= 1; i++) {
      const swing = moving ? Math.sin(w * TAU + i * 2.1) * s * 0.09 : 0;
      const yy = i * s * 0.19 + s * 0.04;
      k.moveTo(-s * 0.18, yy);
      k.lineTo(-s * 0.43, yy - s * 0.07 + swing);
      k.moveTo(s * 0.18, yy);
      k.lineTo(s * 0.43, yy - s * 0.07 - swing);
    }
    // Antennae.
    k.moveTo(-s * 0.06, -s * 0.36);
    k.lineTo(-s * 0.17, -s * 0.5);
    k.moveTo(s * 0.06, -s * 0.36);
    k.lineTo(s * 0.17, -s * 0.5);
    k.stroke();
    k.beginPath();
    k.arc(0, -s * 0.28, s * 0.15, 0, TAU);
    k.fill();
    k.restore();
    const plate = PLATE_OF[b.id]!;
    const c = press.plate(plate);
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = press.solid(plate);
    c.beginPath();
    c.ellipse(0, s * 0.06, s * 0.27, s * 0.32, 0, 0, TAU);
    c.fill();
    // The seam down its back, knocked out to paper.
    c.globalCompositeOperation = "destination-out";
    c.fillRect(-s * 0.025, -s * 0.2, s * 0.05, s * 0.56);
    c.globalCompositeOperation = "source-over";
    c.restore();
    if (b.id === HERO && mode === "play" && sim.t < 3 && b.dir < 0 && sim.sheet === 1) {
      // A ring round the player's beetle until it first moves.
      const r = press.plate(RED);
      r.strokeStyle = press.solid(RED);
      r.lineWidth = 1.6;
      r.beginPath();
      r.arc(x, y, s * (0.75 + 0.12 * light01.pulse(time, 1, { still: 0.5 })), 0, TAU);
      r.stroke();
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // HUD and words
  // ------------------------------------------------------------------------------------------------------------
  function drawHud(): void {
    const top = session.play().top;
    const ly = top + 8;
    const k = press.plate(KEY);
    const sc = fmt(shown);
    const font = light(28);
    const sw = spacedWidth(k, sc, font, 1.2);
    ticket(fx, ly, Math.max(96, sw + 26), 44);
    doublePrint(sc, fx + 12, ly + 31, font, 1.2, 1.3, 0);
    // Right: the sheet, and how much of it is printed against how much it takes.
    const share = shareLine(sim.share, sim.goal);
    const sheet = sheetLine(sim.sheet);
    const sf = medium(13 + sharePop * 2);
    const rw = Math.max(spacedWidth(k, share, sf, 1.4), spacedWidth(k, sheet, medium(10), 1.8), 70) + 22;
    const rx = fx + COLS * cs - rw;
    ticket(rx, ly, rw, 44);
    k.fillStyle = press.solid(KEY);
    spaced(k, sheet, rx + rw - 11, ly + 17, medium(10), 1.8, 1);
    const r = press.plate(RED);
    r.fillStyle = press.solid(RED);
    spaced(r, share, rx + rw - 11, ly + 35, sf, 1.4, 1);
    // The ink: a bar over the sheet that runs down as it dries. Printing tops it up.
    const by = ly + 50;
    const bw = COLS * cs;
    knock((c) => c.rect(fx - 2, by - 2, bw + 4, 10));
    const frac = clamp(sim.ink / INK_MAX);
    const low = sim.ink <= INK_LOW && sim.phase === "play";
    r.fillStyle = press.screen(RED, 0.25);
    r.fillRect(fx, by, bw, 6);
    r.fillStyle = low ? press.screen(RED, 0.55 + 0.45 * light01.pulse(time, 1.6, { still: 1 })) : press.solid(RED);
    r.fillRect(fx, by - inkPop * 1.5, bw * frac, 6 + inkPop * 3);
    // A tick where the ink counts as nearly dry.
    k.fillStyle = press.solid(KEY);
    k.fillRect(fx + bw * (INK_LOW / INK_MAX), by - 1, 1, 8);
  }

  function drawPopups(): void {
    for (const p of popups) {
      const k = p.t / p.life;
      const pop = k < 0.14 ? 0.6 + (k / 0.14) * 0.55 : 1.15 - Math.min(0.15, (k - 0.14) * 0.5);
      const font = medium(p.size * pop);
      const y = p.y - easeOutCubic(k) * 20;
      const c = press.plate(p.plate);
      const w = spacedWidth(c, p.text, font, 1.2);
      knock((g) => g.roundRect(p.x - w / 2 - 7, y - p.size * pop * 0.95, w + 14, p.size * pop * 1.35, 4));
      c.fillStyle = k > 0.7 ? press.screen(p.plate, 1 - (k - 0.7) / 0.3) : press.solid(p.plate);
      spaced(c, p.text, p.x, y, font, 1.2, 0.5);
    }
  }

  function drawBanners(): void {
    for (const b of banners) {
      const k = b.t / b.life;
      const out = k > 0.8 ? easeOutCubic((k - 0.8) / 0.2) : 0;
      const stamp = (k < 0.1 && !reduced ? 1.4 - easeOutCubic(k / 0.1) * 0.4 : 1) * (1 - out * 0.2);
      const size = BANNER_PX * stamp * Math.min(1, W / 390);
      const track = size * 0.08;
      const cx = W / 2;
      const cy = fy + ROWS * cs * 0.36 - out * 14;
      const kk = press.plate(KEY);
      const tw = spacedWidth(kk, b.text, light(size), track);
      const sw = b.sub ? spacedWidth(kk, b.sub, medium(BANNER_SUB_PX), 2.4) : 0;
      const w = Math.max(tw, sw) + 36;
      const h = size + (b.sub ? 30 : 16);
      if (out < 0.95) ticket(cx - w / 2, cy - size * 0.95, w, h);
      doublePrint(b.text, cx, cy, light(size), track, 1.8);
      if (b.sub) {
        kk.fillStyle = press.solid(KEY);
        spaced(kk, b.sub, cx, cy + 22, medium(BANNER_SUB_PX), 2.4);
      }
    }
  }

  /** First run: a dashed loop out of the print and home again, and the word. */
  function drawHint(): void {
    if (hintSeen || qaPilot || sim.phase !== "play" || sim.hero.line.length || prints >= 2) return;
    const h = sim.hero;
    const x0 = X(xOf(h.gate));
    const y0 = Y(yOf(h.gate));
    const k = press.plate(KEY);
    const reach = 4 * cs;
    const side = xOf(h.gate) > COLS / 2 ? -1 : 1;
    const pts: Array<[number, number]> = [[x0, y0 - 1.2 * cs], [x0, y0 - reach], [x0 + side * reach, y0 - reach], [x0 + side * reach, y0], [x0 + side * 1.6 * cs, y0]];
    const lap = reduced ? 1 : (time * 0.6) % 1.25;
    k.strokeStyle = press.solid(KEY);
    k.lineWidth = 2;
    k.setLineDash([2, 6]);
    k.lineCap = "round";
    k.beginPath();
    let total = 0;
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
    const all = lens.reduce((a, b) => a + b, 0);
    k.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) {
      const seg = lens[i - 1]!;
      const f = clamp((Math.min(1, lap) * all - total) / seg);
      if (f <= 0) break;
      k.lineTo(lerp(pts[i - 1]![0], pts[i]![0], f), lerp(pts[i - 1]![1], pts[i]![1], f));
      total += seg;
    }
    k.stroke();
    k.setLineDash([]);
    capsule(HINT, x0 + side * reach * 0.5, y0 - reach - 26, 1);
    const tw = spacedWidth(k, HINT_LINE, medium(11), 1.8);
    const tx = clamp(x0 + side * reach * 0.5, fx + tw / 2 + 12, fx + COLS * cs - tw / 2 - 12);
    knock((c) => c.rect(tx - tw / 2 - 8, y0 - reach - 60, tw + 16, 18));
    k.fillStyle = press.solid(KEY);
    spaced(k, HINT_LINE, tx, y0 - reach - 47, medium(11), 1.8);
  }

  function drawAttract(): void {
    const r = session.preview();
    const cx = r.left + (W - r.left - r.right) / 2;
    const u = clamp(Math.min(W / 390, H / 760), 0.85, 1.4);
    const k = clamp(time / 1.0);
    const avail = W - r.left - r.right - 28;
    const size = Math.min(54 * u, avail / 5.2);
    const cw = Math.min(avail, size * 5.6);
    const hasBest = session.best !== null && session.best > 0;
    const ch = (hasBest ? 150 : 132) * u;
    const top = r.top + (H - r.bottom - r.top) * 0.3 + (1 - easeOutCubic(k)) * 8;
    ticket(cx - cw / 2, top, cw, ch);
    const rr = press.plate(RED);
    rr.fillStyle = press.solid(RED);
    rr.fillRect(cx - cw / 2, top + ch - 1.5, cw, 1.5);
    regMark(cx - cw / 2 + 12, top + 14, 4);
    regMark(cx + cw / 2 - 12, top + 14, 4);
    doublePrint(TITLE, cx, top + 24 * u + size * 0.85, light(size), size * 0.1, 2.2);
    const kk = press.plate(KEY);
    kk.fillStyle = press.solid(KEY);
    const ty = top + 24 * u + size * 0.85 + 26 * u;
    spaced(kk, TAGLINE, cx, ty, medium(11 * u), 2 * u);
    spaced(kk, TAGLINE_2, cx, ty + 16 * u, medium(11 * u), 2 * u);
    if (hasBest) {
      rr.fillStyle = press.solid(RED);
      spaced(rr, `best ${fmt(session.best!)}`, cx, ty + 36 * u, medium(10.5 * u), 3.4 * u);
    }
    capsule(PROMPT, cx, top + ch + 30 * u, u);
  }

  /**
   * What the run printed, against the best, and one tip. In the feed the shell's result card covers the middle and
   * the caption the bottom, so this is a strip just above the caption; a bare tab gets the score and a prompt too.
   */
  function drawSummary(): void {
    const sm = summary;
    if (!sm || session.phaseTime < 0.4) return;
    const pv = session.preview();
    const solo = session.standalone;
    const left = solo ? 18 : pv.left + 14;
    const right = W - (solo ? 18 : pv.right + 8);
    const w = right - left;
    const h = 98;
    const top = solo ? Math.round(H * 0.5) : H - pv.bottom - h - 8;
    const k = easeOutCubic(clamp((session.phaseTime - 0.4) / 0.5));
    const lift = reduced ? 0 : (1 - k) * 14;
    knock((c) => c.rect(left - 6, top + lift - 6, w + 12, h + 12));
    const t = press.plate(KEY);
    const r = press.plate(RED);
    r.fillStyle = press.solid(RED);
    r.fillRect(left, top + lift, w * k, 2);
    t.fillStyle = press.solid(KEY);
    t.fillRect(left + w * (1 - k), top + lift + h, w * k, 1);
    let sz = 12;
    while (sz > 10 && spacedWidth(t, sm.line, medium(sz), 1.6) > w - 24) sz -= 0.5;
    spaced(t, sm.line, left + 12, top + lift + 24, medium(sz), 1.6, 0);
    const barY = top + lift + 36;
    const bw = w - 24;
    t.fillStyle = press.screen(KEY, 0.25);
    t.fillRect(left + 12, barY, bw, 10);
    const frac = sm.isBest || !sm.prevBest ? 1 : clamp(sm.score / sm.prevBest);
    const grow = clamp((session.phaseTime - 0.5) / 0.8);
    if (sm.score > 0) {
      r.fillStyle = press.solid(RED);
      r.fillRect(left + 12, barY, Math.max(4, bw * frac * grow), 10);
    }
    t.fillStyle = press.solid(KEY);
    spaced(t, barLabel(sm.isBest, sm.score, sm.prevBest, frac, fmt), left + 12, barY + 27, light(14), 1.2, 0);
    let size = TIP_PX;
    while (size > TIP_MIN_PX && spacedWidth(t, sm.tip, light(size), 0.6) > bw) size -= 0.5;
    spaced(t, sm.tip, left + 12, top + lift + h - 12, light(size), 0.6, 0);
    if (solo && session.phaseTime > 0.8) {
      knock((c) => c.rect(W / 2 - 120, top - 140, 240, 100));
      doublePrint(fmt(sm.score), W / 2, top - 82, light(60), 3, 2.4);
      if (session.best !== null) {
        t.fillStyle = press.solid(KEY);
        spaced(t, `best ${fmt(session.best)}`, W / 2, top - 56, medium(11), 4.5);
      }
      capsule(PROMPT, W / 2, top + h + 46, 1);
    }
  }

  function render(): void {
    press.begin();
    drawSheet();
    if (mode === "attract") drawAttract();
    else {
      drawHud();
      drawPopups();
      if (session.phase === "playing") drawHint();
      drawBanners();
      if (session.phase === "over") drawSummary();
    }
    press.print(ctx);
    // A finished sheet is lifted off: the print fades to paper and the next sheet fades in.
    const veil = sim.phase === "printed" ? clamp((sim.pt / HZ - (PRINT_TIME - 0.45)) / 0.4) : 1 - fresh;
    if (veil > 0.01) {
      view.begin();
      ctx.globalAlpha = veil;
      ctx.fillStyle = PAPER;
      ctx.fillRect(fx - 4, fy - 4, COLS * cs + 8, ROWS * cs + 8);
      ctx.globalAlpha = 1;
    }
  }

  newDemo();
  // Let the demo get going before the first frame, so attract opens with a loop already printed.
  for (let i = 0; i < 240; i++) {
    pilot?.step(sim, 1 / 60);
    sim.step(1 / 60);
    sim.events.length = 0;
  }
  born.fill(-1);
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    render();
    if (++frames === 2) session.ready();
  });
}

void main();
