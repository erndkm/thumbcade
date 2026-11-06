import { createAudio } from "@thumbcade-games/kit/audio";
import { createCanvas } from "@thumbcade-games/kit/canvas";
import { clamp, damp, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { onDrag } from "@thumbcade-games/kit/input";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import boldUrl from "@thumbcade-games/kit/assets/fonts/library/caveat/Caveat-Bold.woff2?url";
import mediumUrl from "@thumbcade-games/kit/assets/fonts/library/caveat/Caveat-Medium.woff2?url";
import { bowHand, drawArcher, drawArrow, type ArcherPose } from "./archer.ts";
import { Fx } from "./fx.ts";
import {
  begin,
  blit,
  bold,
  boil,
  doodleArrow,
  ellipse,
  ellipseProgress,
  FAMILY,
  hand,
  highlight,
  ink,
  line,
  PAL,
  pt,
  shash,
  updateBoil,
  write,
} from "./ink.ts";
import { GROUND_TOP, onRule, renderGround, renderPage, type Page } from "./paper.ts";
import { loadFonts } from "./fonts.ts";
import { sfx } from "./sfx.ts";
import { BALLOON, BALLOON_FILLS, buildSprites, CLOUD_SHAPES, VARIANTS, type BalloonFill } from "./sprites.ts";

// ---------------------------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------------------------
const GRAVITY = 820;
const V_MIN = 320;
const V_MAX = 1240;
/** Drag length (px) for a full draw, and the least that still counts as a shot. */
const DRAG_FULL = 172;
const DRAG_MIN = 22;
const START_ARROWS = 10;
const MAX_ARROWS = 15;
/** Seconds without shooting before arrows start getting erased, and the pace of the erasing. */
const IDLE_GRACE = 5;
const IDLE_STEP = 1;
/** Holding a full draw: the arm shakes after this long and lets go on its own at the max. */
const HOLD_TIRED = 3.5;
const HOLD_MAX = 6;
const PREVIEW_SECONDS = 0.26;
const ANGLE_MIN = -1.9;
const ANGLE_MAX = 0.45;
const REST_AIM = -0.62;

/** Difficulty by run time: smaller, faster, windier, busier. */
function tuning(t: number) {
  const k = clamp(t / 62);
  return {
    scale: lerp(1, 0.55, k) - 0.07 * clamp((t - 62) / 40),
    speed: lerp(1, 2, k) + Math.max(0, t - 62) * 0.03,
    maxAlive: 4 + Math.round(k),
    wind: t < 5 ? 0 : lerp(40, 170, clamp((t - 5) / 55)),
    swing: lerp(0.14, 0.4, k),
    spawnGap: lerp(0.95, 0.7, k),
    hang: lerp(9, 5, k),
  };
}

type Kind = "balloon" | "bird" | "target" | "star";
const HIT_R: Record<Kind, number> = { balloon: 24, bird: 18, target: 30, star: 21 };

interface Target {
  id: number;
  kind: Kind;
  seed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseY: number;
  k: number;
  t: number;
  life: number;
  phase: number;
  amp: number;
  freq: number;
  fill: BalloonFill;
  /** String anchor x, full and current string length (bullseyes hang from the top edge). */
  ax: number;
  len: number;
  lenNow: number;
  rot: number;
  vr: number;
  dead: boolean;
  deadT: number;
}

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  flying: boolean;
  demo: boolean;
  hits: number;
  hitIds: number[];
  seed: number;
  /** Stuck in a target (offset from its center) or in the ground. */
  host: Target | null;
  dx: number;
  dy: number;
  stuckT: number;
  age: number;
}

interface Cloud {
  x: number;
  y: number;
  vx: number;
  shape: number;
  k: number;
  seed: number;
}

interface Gust {
  x: number;
  y: number;
  t: number;
  life: number;
  seed: number;
}

// Closest point on a segment, without allocating.
let cpx = 0;
let cpy = 0;
function closest(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2) : 0;
  cpx = ax + dx * t;
  cpy = ay + dy * t;
  return Math.hypot(px - cpx, py - cpy);
}

async function main() {
  const fonts = loadFonts([
    { family: FAMILY, url: boldUrl, descriptors: { weight: "700" } },
    { family: FAMILY, url: mediumUrl, descriptors: { weight: "500" } },
  ]);
  const [session] = await Promise.all([createSession({ id: "doodlebow" }), fonts]);
  const view = createCanvas({ maxDpr: 2, background: PAL.paper });
  const { ctx } = view;
  const audio = createAudio();
  const snd = sfx(audio);
  const rng = createRng(session.ctx.seed);
  const reduced = session.reducedMotion;
  const shake = new Shake(8, 0.018, 2.4, reduced);
  const hitStop = new HitStop();
  const fx = new Fx();
  const sprites = buildSprites(Math.min(2, view.dpr));

  // ---------------------------------------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------------------------------------
  let W = view.width;
  let H = view.height;
  const page: Page = { W, H, marginX: 52, rule0: 84, ruleGap: 28, groundY: H - 148 };
  let pageCanvas: HTMLCanvasElement = document.createElement("canvas");
  let ground = renderGround(page, view.dpr);

  function layout() {
    W = view.width;
    H = view.height;
    page.W = W;
    page.H = H;
    page.marginX = Math.round(clamp(W * 0.135, 44, 60));
    page.ruleGap = 28;
    page.rule0 = 84;
    page.groundY = Math.round(H - clamp(session.preview().bottom, 110, 172));
    pageCanvas = renderPage(page, view.dpr);
    ground = renderGround(page, view.dpr);
  }
  layout();
  view.onResize(() => layout());
  session.on("insets", () => layout());

  const archerX = () => page.marginX + 16;
  const playTop = () => session.play().top;

  // ---------------------------------------------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let runT = 0;
  let targets: Target[] = [];
  let arrows: Arrow[] = [];
  const clouds: Cloud[] = [];
  const gusts: Gust[] = [];
  let nextId = 1;
  let score = 0;
  let arrowsLeft = START_ARROWS;
  const slotBorn: number[] = [];
  let streak = 0;
  let bestStreak = 0;
  let shots = 0;
  let hitsTotal = 0;
  let wind = 0;
  let windTarget = 0;
  let windTimer = 6;
  let gustTimer = 0;
  let spawnT = 0;
  let starT = 15;
  let idleT = 0;
  let drainT = 0;
  let endT = -1;
  let endSent = false;
  let circleP = 1;
  let shownScore = 0;
  let hintGone = false;
  let hintFade = 0;
  let tallyShake = 0;

  interface Aim {
    x0: number;
    y0: number;
    x: number;
    y: number;
    t: number;
    lastStep: number;
  }
  let aim: Aim | null = null;
  const pose: ArcherPose = { x: 0, y: 0, aim: REST_AIM, power: 0, nocked: true, quiver: START_ARROWS, twang: 0, time: 0, tremble: 0, slump: 0 };
  let reload = 0;

  // Attract-mode archer AI.
  const ai = { cool: 0.9, aiming: false, t: 0, angle: REST_AIM, power: 0, target: -1 };

  function mkTarget(kind: Kind, k: number): Target {
    return {
      id: nextId++,
      kind,
      seed: rng.int(1, 1e6),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      baseY: 0,
      k,
      t: 0,
      life: 99,
      phase: rng.range(0, Math.PI * 2),
      amp: 0,
      freq: 1,
      fill: rng.pick(BALLOON_FILLS),
      ax: 0,
      len: 0,
      lenNow: 0,
      rot: 0,
      vr: 0,
      dead: false,
      deadT: 0,
    };
  }

  function fieldTop(): number {
    return mode === "attract" ? attractTop() : playTop() + 56;
  }

  function spawn(kind: Kind) {
    const d = tuning(mode === "attract" ? 12 : runT);
    const spd = mode === "attract" ? 1 : d.speed;
    const t = mkTarget(kind, mode === "attract" ? 0.95 : d.scale * rng.range(0.92, 1.08));
    const left = page.marginX + 100;
    const right = W - 36;
    const top = fieldTop();
    const bottom = page.groundY - 150;
    switch (kind) {
      case "balloon": {
        if (mode === "play" && rng.chance(0.35)) {
          // A drifter, coming in from the right at a height.
          t.x = W + 30;
          t.y = rng.range(top + 30, bottom);
          t.vx = -rng.range(34, 56) * spd;
          t.vy = -rng.range(4, 12) * spd;
        } else {
          const r = mode === "attract" ? W - session.preview().right - 14 : right;
          t.x = rng.range(mode === "attract" ? Math.max(left + 40, W * 0.47) : left + 20, r);
          t.y = page.groundY - 34;
          t.vx = 0;
          t.vy = -rng.range(40, 60) * spd;
        }
        t.amp = rng.range(8, 16);
        t.freq = rng.range(1.2, 1.9);
        break;
      }
      case "bird": {
        const dir = rng.chance(0.5) ? 1 : -1;
        t.x = dir > 0 ? -34 : W + 34;
        t.baseY = rng.range(top + 20, Math.max(top + 40, page.groundY - 230));
        t.y = t.baseY;
        t.vx = dir * rng.range(92, 138) * spd;
        t.amp = rng.range(12, 30);
        t.freq = rng.range(2.2, 3.2);
        break;
      }
      case "target": {
        // Keep hanging targets apart so their strings never tangle.
        for (let tries = 0; tries < 8; tries++) {
          // Strings stay clear of the score in the top-right corner.
          t.ax = rng.range(left + 10, Math.min(right - 14, W - 112));
          if (targets.every((o) => o.kind !== "target" || o.dead || Math.abs(o.ax - t.ax) > 84)) break;
        }
        const y = rng.range(top + 70, Math.max(top + 90, page.groundY - 210));
        t.len = y + 10;
        t.vx = (rng.chance(0.5) ? 1 : -1) * rng.range(6, 14) * spd;
        t.amp = d.swing * rng.range(0.7, 1.2);
        t.freq = rng.range(1.3, 1.9);
        t.life = d.hang * rng.range(0.85, 1.15);
        t.x = t.ax;
        t.y = -10;
        break;
      }
      case "star": {
        const dir = rng.chance(0.5) ? 1 : -1;
        t.x = dir > 0 ? -30 : W + 30;
        t.baseY = rng.range(top + 40, Math.max(top + 60, page.groundY - 260));
        t.y = t.baseY;
        t.vx = dir * rng.range(175, 225) * Math.min(spd, 1.35);
        t.amp = rng.range(24, 44);
        t.freq = rng.range(2.6, 3.4);
        t.vr = dir * 2.4;
        t.k = Math.max(0.8, t.k);
        break;
      }
    }
    targets.push(t);
  }

  function addCloud(x: number) {
    const top = fieldTop() + 50;
    const bottom = Math.max(top + 20, page.groundY - 250);
    clouds.push({
      x,
      y: rng.range(top, bottom),
      vx: (rng.chance(0.5) ? 1 : -1) * rng.range(7, 13),
      shape: clouds.length % 2,
      k: rng.range(0.85, 1.1),
      seed: rng.int(1, 1e5),
    });
  }

  function eraseAll() {
    for (const t of targets) if (!t.dead || t.kind !== "balloon") fx.crumbs(t.x, t.y, 22 * t.k, 7);
    for (const a of arrows) if (!a.flying) fx.crumbs(a.x, a.y, 10, 3);
    targets = [];
    arrows = [];
  }

  function resetAttract() {
    mode = "attract";
    targets = [];
    arrows = [];
    clouds.length = 0;
    addCloud(W * 0.62);
    clouds[0]!.y = attractTop() + 60;
    wind = 0;
    windTarget = 0;
    ai.cool = 0.5;
    ai.aiming = false;
    // A few balloons already on their way up so the very first frame is alive.
    for (let i = 0; i < 3; i++) {
      spawn("balloon");
      const b = targets[targets.length - 1]!;
      b.y = page.groundY - 60 - i * 120;
      b.t = 1;
    }
    spawnT = 0.8;
  }

  function startRun() {
    eraseAll();
    mode = "play";
    runT = 0;
    score = 0;
    shownScore = 0;
    arrowsLeft = START_ARROWS;
    slotBorn.length = 0;
    for (let i = 0; i < START_ARROWS; i++) slotBorn.push(time - 1 + i * 0.03);
    streak = 0;
    bestStreak = 0;
    shots = 0;
    hitsTotal = 0;
    wind = 0;
    windTarget = 0;
    windTimer = 5;
    starT = rng.range(13, 17);
    idleT = 0;
    drainT = 0;
    endT = -1;
    endSent = false;
    circleP = 0;
    hintGone = session.runs > 1;
    hintFade = hintGone ? 0 : 1;
    aim = null;
    reload = 0;
    pose.slump = 0;
    clouds.length = 0;
    addCloud(W * 0.55);
    // Something to shoot right away: a bullseye lowered mid-page and a balloon.
    spawn("target");
    const first = targets[targets.length - 1]!;
    first.ax = clamp(W * 0.62, page.marginX + 130, W - 70);
    first.len = clamp((playTop() + page.groundY) * 0.42, 160, 330) + 10;
    first.life = 10;
    spawn("balloon");
    spawnT = 1.6;
    snd.scribble();
  }

  // ---------------------------------------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------------------------------------
  function aimOf(a: Aim): { angle: number; power: number; len: number } {
    const dx = a.x - a.x0;
    const dy = a.y - a.y0;
    const len = Math.hypot(dx, dy);
    let angle = Math.atan2(-dy, -dx);
    if (angle > ANGLE_MAX) angle = angle < 2.3 ? ANGLE_MAX : ANGLE_MIN;
    if (angle < ANGLE_MIN) angle = ANGLE_MIN;
    return { angle, power: clamp((len - 10) / DRAG_FULL), len };
  }

  function launchPoint(angle: number): { x: number; y: number } {
    const h = bowHand({ x: archerX(), y: page.groundY, aim: angle });
    return { x: h.x + Math.cos(angle) * 14, y: h.y + Math.sin(angle) * 14 };
  }

  function shoot(angle: number, power: number, demo: boolean) {
    const v = lerp(V_MIN, V_MAX, power);
    const p = launchPoint(angle);
    arrows.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      angle,
      flying: true,
      demo,
      hits: 0,
      hitIds: [],
      seed: rng.int(1, 1e6),
      host: null,
      dx: 0,
      dy: 0,
      stuckT: 0,
      age: 0,
    });
    pose.twang = 1;
    reload = 0.24;
    fx.mark("whoosh", p.x - Math.cos(angle) * 30, p.y - Math.sin(angle) * 30, 16, PAL.graphite, 0.35, angle);
    if (demo) return;
    arrowsLeft--;
    shots++;
    idleT = 0;
    drainT = 0;
    snd.shoot(power, -0.6);
    session.feedback("tap");
    if (!hintGone) hintGone = true;
  }

  function release(cancelled: boolean) {
    const a = aim;
    aim = null;
    if (!a || cancelled) return;
    const r = aimOf(a);
    if (r.len < DRAG_MIN) return;
    shoot(r.angle, r.power, false);
  }

  onDrag(window, {
    start(x, y) {
      if (session.phase !== "playing" || session.paused || endT >= 0 || arrowsLeft <= 0) return;
      aim = { x0: x, y0: y, x, y, t: 0, lastStep: 0 };
    },
    move(x, y) {
      if (!aim) return;
      aim.x = x;
      aim.y = y;
      // A pencil scratch / bow creak for every notch of draw.
      const step = Math.floor(aimOf(aim).power * 5);
      if (step !== aim.lastStep) {
        if (step > aim.lastStep) snd.play("creak", step * 1.5, 1, -0.6);
        aim.lastStep = step;
      }
    },
    end(_x, _y, cancelled) {
      release(cancelled);
    },
  });
  session.on("cancel", () => {
    aim = null;
  });
  session.startOnTap(window);
  session.on("start", () => startRun());

  // ---------------------------------------------------------------------------------------------------------
  // Hits
  // ---------------------------------------------------------------------------------------------------------
  function addArrows(n: number) {
    for (let i = 0; i < n && arrowsLeft < MAX_ARROWS; i++) {
      slotBorn[arrowsLeft] = time + i * 0.08;
      arrowsLeft++;
    }
  }

  function hit(a: Arrow, t: Target, hx: number, hy: number) {
    a.hits++;
    a.hitIds.push(t.id);
    const pan = clamp((t.x / W) * 2 - 1, -1, 1);
    const play = !a.demo && mode === "play";
    let base = 0;
    let refund = 1;
    let label = "";
    let labelColor: string = PAL.ink;
    switch (t.kind) {
      case "balloon": {
        base = 10;
        t.dead = true;
        fx.mark("burst", t.x, t.y, 30 * t.k, PAL.ink, 0.32, rng.range(0, 1));
        const color = t.fill === "yellow" ? "#C9A800" : t.fill === "green" ? "#4C9A2A" : t.fill === "red" ? PAL.red : PAL.ink;
        fx.bit("rubber", t.x, t.y, { count: 7, speed: [90, 260], life: [0.4, 0.8], size: [3, 6], color, grav: 650 });
        if (play || mode === "attract") label = "pop!";
        if (play) snd.pop(pan);
        break;
      }
      case "bird": {
        base = 25;
        t.dead = true;
        t.vy = -140;
        t.vr = (t.vx > 0 ? 1 : -1) * 9;
        fx.bit("scrap", t.x, t.y, { count: 6, speed: [60, 200], life: [0.6, 1.1], size: [3, 6], color: PAL.paper, grav: 260 });
        fx.mark("cross", t.x, t.y, 10 * t.k, PAL.red, 0.5);
        label = "squawk";
        if (play) snd.play("crumple", 0, 1, pan);
        break;
      }
      case "target": {
        const d = Math.hypot(hx - t.x, hy - t.y) / (HIT_R.target * t.k);
        a.flying = false;
        a.host = t;
        a.dx = hx - t.x;
        a.dy = hy - t.y;
        t.dead = true;
        t.deadT = 0;
        if (d < 0.37) {
          base = 50;
          refund = 2;
          label = "A+";
          labelColor = PAL.red;
          hitStop.freeze(reduced ? 0 : 0.06);
          shake.add(0.35);
          fx.mark("ring", t.x, t.y, 18 * t.k, PAL.red, 0.45);
          fx.mark("ring", t.x, t.y, 30 * t.k, PAL.red, 0.6);
          if (play) {
            snd.play("ding", 0, 1, pan);
            session.feedback("success");
          }
        } else if (d < 0.69) {
          base = 25;
          label = "B+";
          labelColor = PAL.red;
          shake.add(0.15);
        } else {
          base = 10;
          label = "C";
          labelColor = PAL.red;
          shake.add(0.1);
        }
        fx.mark("check", t.x + HIT_R.target * t.k + 12, t.y + 2, 12, PAL.red, 0.9);
        fx.bit("dot", hx, hy, { count: 5, speed: [40, 140], life: [0.2, 0.4], size: [2, 3.4], color: PAL.ink, grav: 300 });
        if (play) snd.thock(pan);
        break;
      }
      case "star": {
        base = 75;
        refund = 2;
        t.dead = true;
        label = "wow!";
        labelColor = PAL.red;
        fx.bit("star", t.x, t.y, { count: 12, speed: [80, 260], life: [0.5, 0.9], size: [3, 6], color: PAL.ink, grav: 260 });
        fx.bit("star", t.x, t.y, { count: 6, speed: [60, 200], life: [0.5, 0.9], size: [3, 5], color: PAL.red, grav: 260 });
        fx.mark("burst", t.x, t.y, 34, PAL.red, 0.4, 0.3);
        shake.add(0.3);
        if (play) {
          snd.play("sparkle", 0, 1, pan);
          session.feedback("success");
        }
        break;
      }
    }
    if (!play) {
      if (label && mode === "attract") fx.note(label, t.x, t.y - 18, labelColor, 26, 0.8);
      return;
    }
    hitsTotal++;
    if (a.hits === 1) {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      if (streak % 5 === 0 && streak <= 15) {
        snd.play("up");
        fx.note(`×${1 + Math.floor(streak / 5)}!`, W - 70, playTop() + 120, PAL.red, 30, 1.1, -0.1, 16);
      }
    } else {
      fx.note(a.hits === 2 ? "2 in 1!" : `${a.hits} in 1!!`, hx, hy - 52, PAL.red, 26, 1.1, -0.08);
    }
    const mult = 1 + Math.min(3, Math.floor(streak / 5));
    const pts = base * a.hits * mult;
    score += pts;
    circleP = Math.min(circleP, 0.25);
    addArrows(refund);
    if (t.kind === "target") {
      // Graded like homework: the grade to the left of the target, the points above it.
      fx.note(label, t.x - (HIT_R.target * t.k + 20), t.y + 8, labelColor, 32, 1, -0.12, 10);
      fx.note(`+${pts}`, t.x + 4, t.y - (HIT_R.target * t.k + 16), pts >= 50 ? PAL.red : PAL.ink, pts >= 50 ? 32 : 26, 0.9);
    } else {
      if (label && t.kind !== "balloon") fx.note(label, t.x - 18, t.y - 30 * t.k, labelColor, 28, 0.9, -0.12, 20);
      fx.note(`+${pts}`, hx + 16, hy - 10, pts >= 50 ? PAL.red : PAL.ink, pts >= 50 ? 32 : 26, 0.9);
    }
  }

  function arrowDone(a: Arrow) {
    if (a.demo || mode !== "play") return;
    if (a.hits === 0) {
      if (streak > 0) {
        fx.crumbs(W - 60, playTop() + 92, 22, 8);
        tallyShake = 0.3;
      }
      streak = 0;
      snd.play("flick", -5, 0.5);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Attract AI: picks a balloon, leads it, draws, lets go. Misses now and then like a person.
  // ---------------------------------------------------------------------------------------------------------
  function solve(tx: number, ty: number, v: number, guess: number): number | null {
    let angle = guess;
    for (let i = 0; i < 4; i++) {
      const p = launchPoint(angle);
      const dx = tx - p.x;
      const dy = p.y - ty;
      if (dx < 10) return null;
      const g = GRAVITY;
      const disc = v ** 4 - g * (g * dx * dx + 2 * dy * v * v);
      if (disc < 0) return null;
      angle = -Math.atan((v * v - Math.sqrt(disc)) / (g * dx));
    }
    return angle;
  }

  function aiUpdate(dt: number) {
    if (!ai.aiming) {
      ai.cool -= dt;
      pose.aim = damp(pose.aim, REST_AIM, 6, dt);
      pose.power = damp(pose.power, 0, 14, dt);
      if (ai.cool > 0) return;
      const ax = archerX();
      const lo = attractTop() + 40;
      const choices = targets.filter((t) => !t.dead && t.x > ax + 90 && t.y > lo && t.y < page.groundY - 90 && t.t > 0.4);
      if (!choices.length) {
        ai.cool = 0.25;
        return;
      }
      const t = choices.reduce((m, c) => (c.y > m.y ? c : m));
      ai.target = t.id;
      ai.aiming = true;
      ai.t = 0;
      ai.power = rng.range(0.66, 0.8);
      return;
    }
    ai.t += dt;
    const t = targets.find((x) => x.id === ai.target && !x.dead);
    if (!t) {
      ai.aiming = false;
      ai.cool = 0.3;
      return;
    }
    const v = lerp(V_MIN, V_MAX, ai.power);
    // Lead the target by the flight time.
    let tx = t.x;
    let ty = t.y;
    let angle = solve(tx, ty, v, -0.5) ?? -0.6;
    for (let i = 0; i < 2; i++) {
      const p = launchPoint(angle);
      const tf = (tx - p.x) / (v * Math.cos(angle));
      tx = t.x + t.vx * tf;
      ty = t.y + t.vy * tf;
      angle = solve(tx, ty, v, angle) ?? angle;
    }
    pose.aim = damp(pose.aim, angle, 12, dt);
    pose.power = Math.min(ai.power, easeOutCubic(clamp(ai.t / 0.5)) * ai.power);
    if (ai.t > 0.62) {
      shoot(angle + rng.range(-0.028, 0.028), ai.power, true);
      ai.aiming = false;
      ai.cool = rng.range(0.7, 1.25);
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------------------------------------
  function updateTargets(dt: number) {
    const d = tuning(mode === "attract" ? 12 : runT);
    for (const t of targets) {
      t.t += dt;
      if (t.dead) {
        t.deadT += dt;
        if (t.kind === "bird") {
          t.vy += 900 * dt;
          t.x += t.vx * 0.3 * dt;
          t.y += t.vy * dt;
          t.rot += t.vr * dt;
        }
        continue;
      }
      switch (t.kind) {
        case "balloon":
          t.x += (t.vx + wind * 0.12 + Math.cos(t.t * t.freq + t.phase) * t.amp * t.freq) * dt;
          t.y += t.vy * dt;
          break;
        case "bird":
          t.x += t.vx * dt;
          t.y = t.baseY + Math.sin(t.t * t.freq + t.phase) * t.amp;
          break;
        case "target": {
          t.ax += t.vx * dt;
          if ((t.ax < page.marginX + 100 && t.vx < 0) || (t.ax > W - 112 && t.vx > 0)) t.vx = -t.vx;
          // Hanging targets drift apart instead of tangling their strings.
          for (const o of targets) {
            if (o === t || o.kind !== "target" || o.dead) continue;
            const gap = t.ax - o.ax;
            if (Math.abs(gap) < 90 && Math.sign(t.vx) !== Math.sign(gap)) t.vx = -t.vx;
          }
          if (t.t < t.life) t.lenNow = t.len * easeOutBack(clamp(t.t / 0.9));
          else t.lenNow = Math.max(0, t.lenNow - dt * 700);
          const a = t.amp * Math.sin(t.t * t.freq + t.phase) * clamp(t.t / 1.2);
          t.x = t.ax + Math.sin(a) * t.lenNow;
          t.y = -10 + Math.cos(a) * t.lenNow;
          break;
        }
        case "star":
          t.x += t.vx * dt;
          t.y = t.baseY + Math.sin(t.t * t.freq + t.phase) * t.amp;
          t.rot += t.vr * dt;
          break;
      }
    }
    // Leaving the page, or done being dead.
    targets = targets.filter((t) => {
      if (t.dead) {
        if (t.kind === "balloon" || t.kind === "star") return false;
        if (t.kind === "bird" && t.y > page.groundY - 4) {
          fx.crumbs(t.x, page.groundY - 6, 16, 8);
          if (mode === "play") snd.play("erase", 0, 0.7);
          return false;
        }
        if (t.kind === "target" && t.deadT > 0.85) {
          fx.crumbs(t.x, t.y, 26 * t.k, 12);
          if (mode === "play") snd.play("erase", 0, 0.8);
          return false;
        }
        return t.y < H + 60;
      }
      if (t.kind === "balloon") return t.y > -80 && t.x > -60 && t.x < W + 60;
      if (t.kind === "bird" || t.kind === "star") return t.t < 1 || (t.x > -70 && t.x < W + 70);
      if (t.kind === "target") return !(t.t > t.life && t.lenNow <= 0);
      return true;
    });

    // Spawning.
    spawnT -= dt;
    const alive = targets.reduce((n, t) => n + (t.dead ? 0 : 1), 0);
    if (mode === "attract") {
      if (spawnT <= 0 && alive < 4) {
        spawn(rng.chance(0.85) ? "balloon" : "bird");
        spawnT = rng.range(0.8, 1.4);
      }
      return;
    }
    if (spawnT <= 0 && alive < d.maxAlive) {
      const k = clamp(runT / 55);
      const hanging = targets.filter((t) => t.kind === "target" && !t.dead).length;
      const wb = lerp(0.6, 0.34, k);
      const wt = hanging >= 2 ? 0 : 0.3;
      const wbird = runT < 6 ? 0 : lerp(0.16, 0.42, k);
      const r = rng() * (wb + wt + wbird);
      const kind: Kind = r < wb ? "balloon" : r < wb + wt ? "target" : "bird";
      spawn(kind);
      spawnT = d.spawnGap * rng.range(0.8, 1.2);
    }
    starT -= dt;
    if (starT <= 0) {
      spawn("star");
      starT = rng.range(12, 18);
    }
  }

  function updateArrows(dt: number) {
    for (const a of arrows) {
      a.age += dt;
      if (!a.flying) {
        a.stuckT += dt;
        if (a.host) {
          a.x = a.host.x + a.dx;
          a.y = a.host.y + a.dy;
        }
        continue;
      }
      const px = a.x;
      const py = a.y;
      a.vx += wind * dt;
      a.vy += GRAVITY * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.angle = Math.atan2(a.vy, a.vx);
      for (const t of targets) {
        if (t.dead || a.hitIds.includes(t.id)) continue;
        if (t.kind === "target" && t.lenNow < t.len * 0.6) continue;
        const appear = clamp(t.t / 0.25);
        const r = HIT_R[t.kind] * t.k * appear;
        if (closest(px, py, a.x, a.y, t.x, t.y) < r) {
          hit(a, t, cpx, cpy);
          if (!a.flying) break;
        }
      }
      if (!a.flying) {
        a.stuckT = 0;
        if (!a.host) arrowDone(a);
        continue;
      }
      if (a.y >= page.groundY + 5 && a.x > -10 && a.x < W + 10) {
        a.flying = false;
        a.y = page.groundY + 5;
        a.stuckT = 0;
        fx.bit("dot", a.x, page.groundY, { count: 4, speed: [30, 90], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.2, 0.4], size: [2, 3], color: PAL.graphite, grav: 500 });
        if (!a.demo && mode === "play") snd.play("thud", 0, 0.8, clamp((a.x / W) * 2 - 1, -1, 1));
        arrowDone(a);
      } else if (a.x > W + 50 || a.x < -50 || a.y > H + 50) {
        a.flying = false;
        a.stuckT = 99;
        arrowDone(a);
      }
    }
    // Arrows that landed get erased after a moment; arrows in a target leave with it.
    arrows = arrows.filter((a) => {
      if (a.flying) return true;
      if (a.host) return !(a.host.deadT > 0.85 || !targets.includes(a.host));
      if (a.stuckT > 1.4) {
        if (a.stuckT < 50) fx.crumbs(a.x - Math.cos(a.angle) * 16, a.y - Math.sin(a.angle) * 16, 12, 5);
        return false;
      }
      return true;
    });
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += rawDt;
    updateBoil(time, reduced);
    shake.update(rawDt);
    fx.update(dt);
    pose.time = time;
    pose.x = archerX();
    pose.y = page.groundY;
    pose.twang = Math.max(0, pose.twang - rawDt * 3.2);
    reload = Math.max(0, reload - dt);
    circleP = Math.min(1, circleP + rawDt * 3.2);
    shownScore = score;
    tallyShake = Math.max(0, tallyShake - rawDt);

    // Wind: a new gust direction every few seconds, eased in.
    if (mode === "play") {
      runT += dt;
      windTimer -= dt;
      if (windTimer <= 0) {
        const max = tuning(runT).wind;
        windTarget = max * (0.45 + 0.55 * rng()) * (rng.chance(0.5) ? 1 : -1);
        windTimer = rng.range(6, 10);
      }
    } else {
      windTarget = Math.sin(time * 0.21) * 24;
    }
    wind = damp(wind, windTarget, 1.2, dt);
    gustTimer -= dt;
    if (gustTimer <= 0 && Math.abs(wind) > 18) {
      gustTimer = rng.range(0.9, 1.6) * (60 / Math.max(60, Math.abs(wind)));
      gusts.push({ x: wind > 0 ? -30 : W + 30, y: rng.range(fieldTop(), page.groundY - 60), t: 0, life: 6, seed: rng.int(1, 1e5) });
    }
    for (const g of gusts) {
      g.t += dt;
      g.x += wind * 0.9 * dt;
    }
    for (let i = gusts.length - 1; i >= 0; i--) {
      const g = gusts[i]!;
      if (g.t > g.life || g.x < -60 || g.x > W + 60) gusts.splice(i, 1);
    }

    for (const c of clouds) {
      c.x += (c.vx + wind * 0.05) * dt;
      if (c.x > W + 90) c.x = -90;
      if (c.x < -90) c.x = W + 90;
    }
    if (mode === "play" && runT > 18 && clouds.length < 2) addCloud(-80);

    updateTargets(dt);
    updateArrows(dt);

    if (mode === "attract") {
      aiUpdate(dt);
      pose.nocked = reload <= 0;
      pose.quiver = 4;
      pose.tremble = 0;
      return;
    }

    // Aiming.
    if (aim) {
      aim.t += dt;
      const r = aimOf(aim);
      pose.aim = damp(pose.aim, r.angle, 30, dt);
      pose.power = damp(pose.power, r.power, 30, dt);
      pose.tremble = clamp((aim.t - HOLD_TIRED) / (HOLD_MAX - HOLD_TIRED)) * clamp(r.power * 3);
      if (aim.t > HOLD_MAX && r.len >= DRAG_MIN) {
        fx.note("ugh, arm!", pose.x + 40, page.groundY - 100, PAL.red, 24, 1);
        release(false);
      } else if (aim.t > HOLD_MAX) {
        // A finger resting on the page isn't aiming: let the idle clock run again.
        aim = null;
      }
    } else {
      pose.power = damp(pose.power, 0, 22, dt);
      pose.tremble = 0;
      if (endT >= 0) pose.aim = damp(pose.aim, 0.6, 4, dt);
    }
    pose.nocked = reload <= 0 && arrowsLeft > 0;
    pose.quiver = arrowsLeft;

    const flying = arrows.some((a) => a.flying && !a.demo);
    if (session.phase === "playing" && endT < 0) {
      // Doodling instead of shooting? Arrows start getting erased.
      if (!aim && !flying && arrowsLeft > 0) idleT += dt;
      if (idleT > IDLE_GRACE) {
        drainT -= dt;
        if (drainT <= 0) {
          drainT = IDLE_STEP;
          arrowsLeft--;
          const sx = slotX(arrowsLeft);
          fx.crumbs(sx, slotY(), 14, 8);
          snd.play("erase");
          if (streak > 0) {
            streak = 0;
            fx.crumbs(W - 60, playTop() + 92, 22, 8);
          }
        }
      }
      if (arrowsLeft <= 0 && !flying && !aim) {
        endT = 0;
        snd.play("sad");
        fx.note("out of arrows!", Math.min(W * 0.5, page.marginX + 130), page.groundY + 56, PAL.red, 30, 2.5, -0.05, 6);
      }
    }
    if (endT >= 0) {
      endT += rawDt;
      pose.slump = damp(pose.slump, 1, 6, rawDt);
      if (!endSent && endT > 0.55) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { shots, hits: hitsTotal, bestStreak } });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------------------
  const slotX = (i: number) => page.marginX + 18 + i * 13;
  const slotY = () => page.groundY + 50;

  /** The "tap to start!" note sits under the heading; the demo plays below it. */
  function promptY(): number {
    return titleBaseline() + 4 * page.ruleGap + 8;
  }
  function attractTop(): number {
    return promptY() + 34;
  }
  function titleBaseline(): number {
    return onRule(page, session.preview().top + 64);
  }

  function variant(seed: number): number {
    return (boil.step + seed) % VARIANTS;
  }

  function drawStrings() {
    ctx.lineCap = "round";
    for (const t of targets) {
      if (t.kind === "balloon" && !t.dead) {
        const k = t.k * easeOutBack(clamp(t.t / 0.3));
        const x0 = t.x;
        const y0 = t.y + (BALLOON.ry + 4) * k;
        begin();
        for (let i = 0; i <= 4; i++) {
          const yy = y0 + i * 10 * k;
          pt(x0 + Math.sin(time * 3 + t.phase + i * 1.3) * 3 * (i / 4) - (t.vx + wind * 0.12) * 0.02 * i, yy);
        }
        ink(ctx, t.seed, { color: PAL.graphite, width: 1.1, passes: 1, jitter: 0.6 });
      } else if (t.kind === "target" && (!t.dead || t.deadT < 0.85)) {
        line(ctx, t.ax, -12, t.x, t.y - (HIT_R.target + 7) * t.k, t.seed, { color: PAL.graphite, width: 1.1, passes: 1, jitter: 0.8 });
      }
    }
  }

  function drawTargets() {
    ctx.globalCompositeOperation = "multiply";
    for (const t of targets) {
      const v = variant(t.seed);
      const appear = t.kind === "target" ? 1 : easeOutBack(clamp(t.t / 0.3));
      const k = t.k * appear;
      switch (t.kind) {
        case "balloon":
          if (!t.dead) blit(ctx, sprites.balloon[t.fill][v]!, t.x, t.y + 6 * k, k, Math.sin(t.t * t.freq + t.phase) * 0.08);
          break;
        case "bird": {
          const frame = t.dead ? 1 : Math.floor(time * 7 + t.phase) % 2;
          const s = sprites.bird[v]![frame]!;
          ctx.save();
          ctx.translate(t.x, t.y);
          if (t.vx < 0) ctx.scale(-1, 1);
          blit(ctx, s, 0, 0, k, t.dead ? t.rot : Math.sin(t.t * t.freq + t.phase) * -0.15);
          ctx.restore();
          if (!t.dead) speedLines(t.x - Math.sign(t.vx) * 26 * k, t.y, Math.sign(t.vx), 14 * k, t.seed);
          break;
        }
        case "target": {
          const alpha = t.dead ? clamp(1 - (t.deadT - 0.55) / 0.3) : 1;
          blit(ctx, sprites.target[v]!, t.x, t.y - 3 * k, k, 0, alpha);
          break;
        }
        case "star":
          if (!t.dead) {
            blit(ctx, sprites.star[v]!, t.x, t.y, k, t.rot);
            speedLines(t.x - Math.sign(t.vx) * 24, t.y, Math.sign(t.vx), 20, t.seed);
          }
          break;
      }
    }
    ctx.globalCompositeOperation = "source-over";
    // Star twinkles: little ballpoint plus-signs that boil around it.
    for (const t of targets) {
      if (t.kind !== "star" || t.dead) continue;
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + boil.step * 0.7;
        const r = 30 + (i % 2) * 6;
        const x = t.x + Math.cos(a) * r;
        const y = t.y + Math.sin(a) * r;
        line(ctx, x - 4, y, x + 4, y, t.seed + i, { width: 1.3, passes: 1, color: PAL.red, jitter: 0.4 });
        line(ctx, x, y - 4, x, y + 4, t.seed + i + 9, { width: 1.3, passes: 1, color: PAL.red, jitter: 0.4 });
      }
    }
  }

  function speedLines(x: number, y: number, dir: number, len: number, seed: number) {
    for (let i = -1; i <= 1; i++) {
      const yy = y + i * 7;
      const off = Math.abs(i) * 5;
      line(ctx, x - dir * off, yy, x - dir * (off + len), yy, seed + i + boil.step, { color: PAL.graphite, width: 1, passes: 1, jitter: 0.5, alpha: 0.6 });
    }
  }

  const cloudPaths = CLOUD_SHAPES.map((pts) => {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i === 0 ? p.moveTo(x * 0.97, y * 0.97) : p.lineTo(x * 0.97, y * 0.97)));
    p.closePath();
    return p;
  });

  function drawClouds(ox: number, oy: number) {
    for (const c of clouds) {
      // Clouds hide what is behind them: put the bare page back inside the outline, then draw the outline.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.k, c.k);
      ctx.clip(cloudPaths[c.shape]!);
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      const bx = Math.max(0, Math.floor(c.x + ox - 80 * c.k));
      const by = Math.max(0, Math.floor(c.y + oy - 46 * c.k));
      const bw = Math.min(W - bx, Math.ceil(160 * c.k));
      const bh = Math.min(H - by, Math.ceil(92 * c.k));
      if (bw > 0 && bh > 0) ctx.drawImage(pageCanvas, bx * view.dpr, by * view.dpr, bw * view.dpr, bh * view.dpr, bx, by, bw, bh);
      ctx.restore();
      ctx.globalCompositeOperation = "multiply";
      blit(ctx, sprites.cloud[c.shape]![variant(c.seed)]!, c.x, c.y, c.k);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawArrows() {
    for (const a of arrows) {
      if (a.flying) {
        const sp = Math.hypot(a.vx, a.vy);
        const c = Math.cos(a.angle);
        const s = Math.sin(a.angle);
        const len = Math.min(70, sp * 0.05);
        // Smear lines trailing the arrow.
        for (let j = -1; j <= 1; j += 2) {
          const ox = -s * j * 3.2;
          const oy = c * j * 3.2;
          const x0 = a.x - c * 40 + ox;
          const y0 = a.y - s * 40 + oy;
          line(ctx, x0, y0, x0 - c * len, y0 - s * len, a.seed + j, { color: PAL.graphite, width: 1, passes: 1, jitter: 0.6, alpha: 0.55 });
        }
        drawArrow(ctx, a.x, a.y, a.angle, a.seed);
      } else if (a.stuckT < 50) {
        const alpha = a.host ? clamp(1 - (a.host.deadT - 0.55) / 0.3) : clamp(1 - (a.stuckT - 1.1) / 0.3);
        drawArrow(ctx, a.x, a.y, a.angle, a.seed, 38, alpha);
      }
    }
  }

  function drawGusts() {
    for (const g of gusts) {
      const alpha = clamp(g.t / 0.4) * clamp((g.life - g.t) / 0.6) * 0.75;
      const dir = wind >= 0 ? 1 : -1;
      begin();
      for (let i = 0; i <= 8; i++) pt(g.x + dir * i * 5, g.y + Math.sin(i * 1.4 + g.seed) * 3.4);
      ink(ctx, g.seed, { color: PAL.graphite, width: 1.1, passes: 1, alpha, jitter: 0.6 });
      begin();
      for (let i = 0; i <= 5; i++) pt(g.x - dir * 10 + dir * i * 5, g.y + 8 + Math.sin(i * 1.4 + g.seed + 2) * 2.4);
      ink(ctx, g.seed + 3, { color: PAL.graphite, width: 1, passes: 1, alpha: alpha * 0.7, jitter: 0.5 });
    }
  }

  function drawWindsock() {
    const px = W - 44;
    const base = page.groundY;
    const top = base - 66;
    line(ctx, px, base + 2, px, top, 1501, { width: 2 });
    ellipse(ctx, px, top - 2, 2.6, 2.6, 1502, { width: 1.4, passes: 1 });
    const s = clamp(Math.abs(wind) / 150);
    const dir = wind >= 0 ? 1 : -1;
    const flutter = Math.sin(time * 9) * 0.07 * (0.3 + s);
    const ang = (dir > 0 ? lerp(Math.PI / 2 - 0.08, 0.06, s) : lerp(Math.PI / 2 + 0.08, Math.PI - 0.06, s)) + flutter;
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const nx = -sn;
    const ny = c;
    const L = 36;
    const x0 = px;
    const y0 = top + 3;
    // A cone: wide at the pole, narrow at the tail, three red stripes.
    const pts: Array<[number, number]> = [
      [x0 + nx * 7, y0 + ny * 7],
      [x0 + c * L + nx * 3.5, y0 + sn * L + ny * 3.5],
      [x0 + c * L - nx * 3.5, y0 + sn * L - ny * 3.5],
      [x0 - nx * 7, y0 - ny * 7],
    ];
    begin();
    for (const p of pts) pt(p[0], p[1]);
    pt(pts[0]![0], pts[0]![1]);
    ink(ctx, 1503, { width: 1.8 });
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      const w = lerp(7, 3.5, t);
      const cx = x0 + c * L * t;
      const cy = y0 + sn * L * t;
      line(ctx, cx + nx * w, cy + ny * w, cx - nx * w, cy - ny * w, 1504 + i, { width: 3.4, passes: 1, color: PAL.red });
    }
    write(ctx, "wind", px - 2, base + 22, hand(15), "rgba(98,102,110,0.8)", 1510, { align: "center" });
  }

  function drawAimGuide() {
    if (!aim) return;
    const r = aimOf(aim);
    if (r.len < 6) return;
    // The pull: a pencil dashed line from where the finger landed, and a small ring there.
    ctx.globalAlpha = 0.5;
    ellipse(ctx, aim.x0, aim.y0, 7, 7, 1601, { color: PAL.graphite, width: 1.2, passes: 1 });
    ctx.strokeStyle = PAL.graphite;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(aim.x0, aim.y0);
    ctx.lineTo(aim.x, aim.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (r.len < DRAG_MIN) return;
    // The first part of the arc, as pencil dots.
    const v = lerp(V_MIN, V_MAX, r.power);
    const p = launchPoint(pose.aim);
    let x = p.x;
    let y = p.y;
    let vx = Math.cos(pose.aim) * v;
    let vy = Math.sin(pose.aim) * v;
    const step = 1 / 120;
    let acc = 0;
    let i = 0;
    ctx.fillStyle = PAL.graphite;
    for (let tt = 0; tt < PREVIEW_SECONDS; tt += step) {
      vx += wind * step;
      vy += GRAVITY * step;
      x += vx * step;
      y += vy * step;
      acc += step;
      if (acc >= 0.022) {
        acc = 0;
        i++;
        const k = tt / PREVIEW_SECONDS;
        ctx.globalAlpha = 0.85 * (1 - k * 0.8);
        ctx.beginPath();
        ctx.arc(x + shash(i, boil.step) * 0.6, y + shash(i, boil.step, 1) * 0.6, 2.1 - k * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawScore() {
    const top = playTop();
    const cy = top + 42;
    const txt = String(shownScore);
    ctx.font = bold(46);
    const tw = ctx.measureText(txt).width;
    const right = W - 30;
    const cx = right - tw / 2;
    write(ctx, txt, right, cy + 15, bold(46), PAL.ink, 1701, { align: "right" });
    ellipseProgress(ctx, cx, cy, tw / 2 + 18, 27, 1702 + Math.floor(score / 7), easeOutCubic(circleP), { color: PAL.red, width: 2.3 });
    // Streak tallies in pencil underneath; every bundle of five bumps the multiplier.
    const n = Math.min(streak, 20);
    const ty = top + 92;
    const groups = Math.ceil(n / 5);
    let x = right - groups * 30 + 6;
    const sh = tallyShake > 0 ? shash(boil.step, 5) * 2 : 0;
    for (let g = 0; g < groups; g++) {
      const c = Math.min(5, n - g * 5);
      for (let i = 0; i < Math.min(4, c); i++) line(ctx, x + i * 5 + sh, ty - 10, x + i * 5 + 0.5 + sh, ty + 9, 1710 + g * 7 + i, { color: PAL.graphite, width: 1.6, passes: 1, jitter: 0.6 });
      if (c === 5) line(ctx, x - 4, ty + 6, x + 19, ty - 7, 1760 + g, { color: PAL.graphite, width: 1.6, passes: 1, jitter: 0.6 });
      x += 30;
    }
    const mult = 1 + Math.min(3, Math.floor(streak / 5));
    if (mult > 1) write(ctx, `×${mult}`, right - groups * 30 - 4, ty + 9, bold(28), PAL.red, 1770, { align: "right", rot: -0.08 });
    if (streak > 20) write(ctx, "...", right + 4, ty + 6, bold(20), PAL.graphite, 1771);
  }

  function drawQuiverRow() {
    const y = slotY();
    const warn = idleT > IDLE_GRACE - 1.5 && session.phase === "playing" && endT < 0;
    for (let i = 0; i < arrowsLeft; i++) {
      const x = slotX(i);
      const born = slotBorn[i] ?? -9;
      const p = clamp((time - born) / 0.18);
      if (p <= 0) continue;
      const wig = warn && i === arrowsLeft - 1 ? shash(boil.step, 9) * 2.5 : 0;
      // Scribbled in from the bottom up when it arrives.
      const len = 30 * easeOutCubic(p);
      drawArrow(ctx, x + wig, y + 15 - len, -Math.PI / 2, 1800 + i * 3, Math.max(4, len - 2));
    }
    if (arrowsLeft > 0) write(ctx, `${arrowsLeft}`, slotX(arrowsLeft) + 6, y + 10, bold(28), PAL.ink, 1850);
    if (warn && idleT > IDLE_GRACE - 1.5) {
      const k = clamp((idleT - IDLE_GRACE + 1.5) / 0.3);
      write(ctx, "shoot already!", pose.x + 34, page.groundY - 96, bold(26 * (0.8 + 0.2 * k)), PAL.red, 1851, { rot: -0.12, alpha: k });
    }
  }

  function drawHint() {
    if (hintGone || endT >= 0) hintFade = Math.max(0, hintFade - 1 / 30);
    if (hintFade <= 0) return;
    const a = hintFade;
    const hx = pose.x + 118;
    const hy = page.groundY - 120;
    ctx.globalAlpha = a;
    ellipse(ctx, hx, hy, 9, 9, 1901, { color: PAL.graphite, width: 1.4, passes: 1, alpha: a });
    // The pull, then the arc it gives.
    const k = (time % 1.6) / 1.6;
    const pull = easeOutCubic(clamp(k / 0.6));
    doodleArrow(ctx, hx, hy, hx - 44 * pull - 2, hy + 34 * pull + 2, 3, 1902, { color: PAL.graphite, width: 1.4, passes: 1, head: 8, alpha: a });
    ctx.fillStyle = PAL.graphite;
    for (let i = 1; i <= 7; i++) {
      const t = i / 7;
      ctx.globalAlpha = a * (k > 0.6 ? 1 : 0.3);
      ctx.beginPath();
      ctx.arc(hx + t * 90, hy - 20 - Math.sin(t * 2.4) * 60 * t, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    write(ctx, "pull back, let go", hx - 30, hy + 64, hand(22), PAL.graphite, 1903, { rot: -0.04, alpha: a });
  }

  function drawTitle() {
    const pv = session.preview();
    const x = page.marginX + 16;
    const maxW = W - pv.right - x - 12;
    ctx.font = bold(66);
    const w66 = ctx.measureText("Doodlebow").width;
    const size = Math.min(66, (66 * maxW) / w66);
    const tw = (w66 * size) / 66;
    const by = titleBaseline();
    write(ctx, "Doodlebow", x, by, bold(size), PAL.ink, 2001, { rot: -0.015 });
    // Underlined twice, like a notebook heading, drawn on when the page loads.
    const u1 = easeOutCubic(clamp((time - 0.15) / 0.3));
    const u2 = easeOutCubic(clamp((time - 0.45) / 0.25));
    if (u1 > 0) line(ctx, x - 4, by + 10, x - 4 + (tw + 12) * u1, by + 8, 2002, { width: 2.4 });
    if (u2 > 0) line(ctx, x + 6, by + 17, x + 6 + (tw - 22) * u2, by + 16, 2003, { width: 2 });
    write(ctx, "archery in the margins", x + 4, by + page.ruleGap + 20, hand(24), PAL.graphite, 2004, { rot: -0.025 });
    if (session.best !== null) {
      const t = `best: ${session.best}`;
      const yy = by + page.ruleGap * 2 + 22;
      write(ctx, t, x + 6, yy, hand(24), PAL.red, 2005, { rot: 0.02 });
      ctx.font = hand(24);
      const bw = ctx.measureText(t).width;
      write(ctx, "✓", x + 14 + bw, yy + 1, bold(26), PAL.red, 2006);
    }
  }

  function drawTapPrompt(cx: number, cy: number, text: string, arrowTo: { x: number; y: number } | null) {
    ctx.font = bold(34);
    const tw = ctx.measureText(text).width;
    const breathe = reduced ? 1 : 1 + Math.sin(time * 2 * Math.PI * 0.9) * 0.025;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(breathe, breathe);
    ctx.rotate(-0.06);
    highlight(ctx, -tw / 2 - 8, -22, tw + 16, 26, 2101 + (boil.step % 3), PAL.hiYellow, 0.6);
    write(ctx, text, 0, 0, bold(34), PAL.ink, 2102, { align: "center" });
    ctx.restore();
    if (arrowTo) {
      const sx = cx - tw / 2 + 4;
      const sy = cy + 14;
      const bend = Math.min(60, Math.hypot(arrowTo.x - sx, arrowTo.y - sy) * 0.22);
      doodleArrow(ctx, sx, sy, arrowTo.x, arrowTo.y, bend, 2103, { width: 2, head: 12 });
    }
  }

  function drawUi() {
    if (mode === "attract") {
      drawTitle();
      const pv = session.preview();
      const cx = (page.marginX + W - pv.right) / 2 + 22;
      drawTapPrompt(cx, promptY(), "tap to start!", { x: pose.x + 26, y: page.groundY - 132 });
      return;
    }
    drawScore();
    drawQuiverRow();
    drawHint();
    if (session.phase === "playing" && runT < 6 && session.runs <= 1) {
      write(ctx, "hits give arrows back", slotX(0) - 2, slotY() + 46, hand(19), PAL.graphite, 2201, { alpha: clamp((6 - runT) / 1) });
    }
    if (session.phase === "over" && session.standalone && session.phaseTime > 0.8) {
      drawTapPrompt(W / 2 + 10, H * 0.42, "tap to try again", null);
    }
  }

  function render() {
    view.begin();
    ctx.drawImage(pageCanvas, 0, 0, W, H);
    const o = shake.offset;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    const g = ground[boil.step % ground.length]!;
    ctx.drawImage(g.canvas, 0, page.groundY - GROUND_TOP, W, g.h);
    drawGusts();
    drawWindsock();
    drawStrings();
    drawTargets();
    drawClouds(o.x, o.y);
    drawArrows();
    drawArcher(ctx, pose);
    drawAimGuide();
    fx.drawMarks(ctx);
    fx.drawBits(ctx);
    ctx.restore();
    fx.drawNotes(ctx);
    drawUi();
  }

  resetAttract();
  let readySent = false;
  session.on("pause", () => {
    aim = null;
  });
  // A run never idles forever: if nothing at all happens, the arrows get erased one by one (see update()).
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
