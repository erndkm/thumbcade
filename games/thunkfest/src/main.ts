import { createAudio, createMusic } from "@thumbcade-games/kit/audio";
import { clamp, easeInOutCubic, easeInQuad, easeOutBack, easeOutCubic, lerp } from "@thumbcade-games/kit/ease";
import { onPress } from "@thumbcade-games/kit/input";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { HitStop, Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector3 } from "three";
import { Bits, burstPath, burstSticker, cachedSprite, drawSprite, inkFill, loadComicFont, PAL, Pows, roundRectPath, setSpriteScale, starPath, sticker, stickerWord, Wobble } from "./comic.ts";
import {
  buildBackdrop,
  buildBoard,
  buildCritter,
  buildMallet,
  DIRT,
  DIRT_DARK,
  HOLES,
  ROW,
  BOARD_W,
  BOARD_D,
  GRASS_T,
  DIRT_T,
  COL,
  HAT_PIVOT,
  CRITTER_SCALE,
  type CritterRig,
  type Kind,
  type MalletRig,
} from "./models.ts";
import { S } from "./sfx.ts";
import { createStage } from "./stage.ts";
import { outlineUniforms } from "./toon.ts";

// ---------------------------------------------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------------------------------------------
const LIVES = 3;
/** A hit within this long of the previous one keeps the streak alive. */
const COMBO_WINDOW = 1.3;
const FOV = 34;
const ELEVATION = (47 * Math.PI) / 180;
const POINTS: Record<Kind, number> = { gopher: 1, helmet: 2, golden: 5, bunny: 0 };

const multFor = (streak: number) => Math.min(5, 1 + Math.floor(Math.max(0, streak - 1) / 4));
/** After the main ramp the screws keep turning slowly, so even a great run tops out. */
const late = (t: number) => clamp((t - 75) / 30);
const spawnEvery = (t: number) => lerp(1.0, 0.34, clamp(t / 75)) - 0.08 * late(t);
const upTime = (t: number) => lerp(1.6, 0.58, clamp(t / 85)) - 0.1 * late(t);
const peekTime = (t: number) => lerp(0.34, 0.16, clamp(t / 60));
const maxActive = (t: number) => Math.min(5, 1 + Math.floor(t / 10));
const bunnyChance = (t: number) => (t < 6 ? 0 : lerp(0.14, 0.26, clamp((t - 6) / 50)));
const helmetChance = (t: number) => (t < 10 ? 0 : lerp(0.14, 0.22, clamp((t - 10) / 50)));

/** The opening is scripted so a first-timer meets one gopher at a time. [time, hole, kind] */
const OPENING: Array<[number, number, Kind]> = [
  [0.45, 4, "gopher"],
  [1.55, 0, "gopher"],
  [2.6, 8, "gopher"],
];

type State = "peek" | "up" | "down" | "thunked";

interface Critter {
  kind: Kind;
  rig: CritterRig;
  slot: number;
  state: State;
  t: number;
  peekT: number;
  upT: number;
  y: number;
  /** Height when it started going down. */
  y0: number;
  hideY: number;
  peekY: number;
  /** A mallet is on its way: freeze the critter until it lands. */
  struck: boolean;
  hits: number;
  sx: Wobble;
  sy: Wobble;
  /** Attract demo: when the robot swings (critter time), or Infinity. */
  aiAt: number;
  /** Seconds of dizzy stars left. */
  dizzy: number;
  seed: number;
}

interface Swing {
  m: MalletRig;
  t: number;
  slot: number;
  target: Critter | null;
  landed: boolean;
  hitY: number;
  squash: Wobble;
}

interface Flyer {
  kind: Kind;
  rig: CritterRig;
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  life: number;
  bounces: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "thunkfest" }), loadComicFont()]);
  const reduced = session.reducedMotion;
  const stage = createStage(0xffd83a);
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;

  const audio = createAudio();
  const music = createMusic(audio, {
    bpm: 132,
    wave: "triangle",
    volume: 0.045,
    steps: [43, null, 50, null, 47, null, 50, null, 43, null, 50, null, 45, 47, 48, 50],
  });
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(9, 0.02, 2.2, reduced);
  const hitStop = new HitStop();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.2, decay: 0.35 });
  const bits = new Bits(260);
  const pows = new Pows(reduced);
  const scorePop = new Wobble(380, 12);
  const comboPop = new Wobble(300, 9);
  const logoPop = new Wobble(260, 8);
  let logoPh = 0;

  // -------------------------------------------------------------------------------------------------------------
  // Scene
  // -------------------------------------------------------------------------------------------------------------
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, W / H, 1, 120);
  const backdrop = buildBackdrop();
  scene.add(backdrop.mesh);
  scene.add(new AmbientLight(0xffffff, 0.4 * Math.PI));
  const sun = new DirectionalLight(0xffffff, 0.62 * Math.PI);
  sun.position.set(-5, 9, 6);
  scene.add(sun);
  scene.add(buildBoard());

  const slots = HOLES.map((pos) => {
    const rigs = {
      gopher: buildCritter("gopher"),
      helmet: buildCritter("helmet"),
      golden: buildCritter("golden"),
      bunny: buildCritter("bunny"),
    } satisfies Record<Kind, CritterRig>;
    for (const r of Object.values(rigs)) {
      r.root.position.copy(pos);
      r.root.visible = false;
      scene.add(r.root);
    }
    return { pos, rigs, c: null as Critter | null };
  });

  const swings: Swing[] = [0, 1].map(() => {
    const m = buildMallet();
    scene.add(m.rig);
    return { m, t: 99, slot: -1, target: null, landed: true, hitY: 0, squash: new Wobble(520, 14) };
  });
  let swingIdx = 0;

  // Headgear that gets knocked off flies on its own: two of each kind, hat only, spinning around its own centre.
  const flyers: Flyer[] = (["gopher", "gopher", "golden", "helmet", "helmet"] as const).map((kind) => {
    const rig = buildCritter(kind);
    rig.body.children.forEach((ch) => (ch.visible = ch === rig.hat));
    rig.hat!.position.y = 0;
    rig.root.visible = false;
    scene.add(rig.root);
    return { kind, rig, pos: new Vector3(), vel: new Vector3(), spin: new Vector3(), life: 0, bounces: 0 };
  });
  function launchHat(c: Critter, x: number, z: number, power: number) {
    const f = flyers.find((q) => q.kind === c.kind && q.life <= 0) ?? flyers.find((q) => q.kind === c.kind)!;
    c.rig.hat!.visible = false;
    f.life = 1.6;
    f.bounces = 0;
    f.pos.set(x, c.y + HAT_PIVOT * CRITTER_SCALE * c.rig.body.scale.y, z);
    f.rig.root.rotation.set(0, 0, 0);
    f.vel.set((x <= 0 ? -1 : 1) * rng.range(2.2, 3.4) * power, rng.range(7, 9) * power, rng.range(0.5, 1.8));
    f.spin.set(rng.range(-9, 9), rng.range(-4, 4), rng.range(-12, 12));
    f.rig.root.visible = true;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Camera framing: fit the board into a screen rect (attract leaves room for the logo and prompt)
  // -------------------------------------------------------------------------------------------------------------
  const target = new Vector3(0, -0.3, 0.2);
  const dir = new Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
  const probe = new Vector3();
  const corners = [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => new Vector3((sx * BOARD_W) / 2, 0, (sz * BOARD_D) / 2))),
    new Vector3(-BOARD_W / 2, -GRASS_T - DIRT_T, BOARD_D / 2),
    new Vector3(BOARD_W / 2, -GRASS_T - DIRT_T, BOARD_D / 2),
    new Vector3(-COL, 2.6, -ROW),
    new Vector3(COL, 2.6, -ROW),
  ];
  interface Fit {
    dist: number;
    offX: number;
    offY: number;
  }
  function placeCamera(dist: number) {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function fitRect(x0: number, y0: number, x1: number, y1: number): Fit {
    camera.aspect = W / H;
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    let dist = 24;
    let bx0 = 0;
    let by0 = 0;
    let bx1 = 0;
    let by1 = 0;
    for (let it = 0; it < 5; it++) {
      placeCamera(dist);
      bx0 = by0 = Infinity;
      bx1 = by1 = -Infinity;
      for (const c of corners) {
        probe.copy(c).project(camera);
        const px = (probe.x * 0.5 + 0.5) * W;
        const py = (-probe.y * 0.5 + 0.5) * H;
        bx0 = Math.min(bx0, px);
        bx1 = Math.max(bx1, px);
        by0 = Math.min(by0, py);
        by1 = Math.max(by1, py);
      }
      const s = Math.max((bx1 - bx0) / Math.max(40, x1 - x0), (by1 - by0) / Math.max(40, y1 - y0));
      dist *= s;
    }
    return { dist, offX: (bx0 + bx1) / 2 - (x0 + x1) / 2, offY: (by0 + by1) / 2 - (y0 + y1) / 2 };
  }
  let fitAttract: Fit = { dist: 24, offX: 0, offY: 0 };
  let fitPlay: Fit = { dist: 24, offX: 0, offY: 0 };
  let framing = 0;
  let framingTo = 0;
  function layout() {
    const p = session.preview();
    const q = session.play();
    const scaleUi = clamp(W / 390, 0.8, 1.5);
    fitAttract = fitRect(10 + p.left, p.top + 132 * scaleUi, W - 10 - Math.max(0, p.right - 40), H - p.bottom - 74 * scaleUi);
    fitPlay = fitRect(8 + q.left, q.top + 74 * scaleUi, W - 8 - q.right, H - Math.max(14, q.bottom + 10));
    setSpriteScale(stage.dpr);
    backdrop.uniforms.uRes.value.set(W, H);
    backdrop.uniforms.uDpr.value = stage.dpr;
    outlineUniforms.uPx.value = 5.2 * clamp(W / 390, 0.8, 1.6);
  }
  layout();
  stage.onResize((w, h) => {
    W = w;
    H = h;
    layout();
  });
  session.on("insets", layout);

  let punch = 0;
  let punchX = 0;
  let punchY = 0;
  function applyCamera() {
    const k = easeInOutCubic(framing);
    const dist = lerp(fitAttract.dist, fitPlay.dist, k);
    const offX = lerp(fitAttract.offX, fitPlay.offX, k);
    const offY = lerp(fitAttract.offY, fitPlay.offY, k);
    placeCamera(dist);
    const o = shake.offset;
    camera.rotateZ(o.angle);
    camera.aspect = W / H;
    camera.zoom = 1 + punch * 0.05;
    camera.setViewOffset(W, H, offX - o.x - punchX * punch, offY - o.y - punchY * punch, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    outlineUniforms.uK.value = (2 * Math.tan(((FOV / 2) * Math.PI) / 180)) / (H * camera.zoom);
  }

  const scr = { x: 0, y: 0 };
  function toScreen(x: number, y: number, z: number): { x: number; y: number } {
    probe.set(x, y, z).project(camera);
    scr.x = (probe.x * 0.5 + 0.5) * W;
    scr.y = (-probe.y * 0.5 + 0.5) * H;
    return scr;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Run state
  // -------------------------------------------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let runT = 0;
  let score = 0;
  let lives = LIVES;
  let streak = 0;
  let lastHit = -99;
  let bestMult = 1;
  let thunks = 0;
  let spawnT = 0.6;
  let opening = 0;
  let lastSlot = -1;
  let dying = false;
  let dieT = 0;
  let endSent = false;
  /** HUD hats that got knocked off: [index, age]. */
  const lostHats: Array<{ i: number; t: number }> = [];

  const isPlay = () => mode === "play" && session.phase === "playing" && !dying;

  function resetRun(m: "attract" | "play") {
    mode = m;
    for (const s of slots) if (s.c) hideCritter(s.c);
    for (const sw of swings) {
      sw.m.rig.visible = false;
      sw.t = 99;
      sw.target = null;
    }
    for (const f of flyers) {
      f.rig.root.visible = false;
      f.life = 0;
    }
    bits.clear();
    pows.clear();
    runT = 0;
    score = 0;
    lives = LIVES;
    streak = 0;
    lastHit = -99;
    bestMult = 1;
    thunks = 0;
    spawnT = m === "play" ? 99 : 0.2;
    opening = 0;
    dying = false;
    dieT = 0;
    endSent = false;
    lostHats.length = 0;
  }

  function hideCritter(c: Critter) {
    c.rig.root.visible = false;
    slots[c.slot]!.c = null;
  }

  function spawn(slot: number, kind: Kind, t: number) {
    const s = slots[slot]!;
    if (s.c) return;
    const rig = s.rigs[kind];
    const hideY = -(rig.top + 0.2);
    const c: Critter = {
      kind,
      rig,
      slot,
      state: "peek",
      t: 0,
      peekT: peekTime(t) * (kind === "golden" ? 0.7 : 1),
      upT: upTime(t) * (kind === "golden" ? 0.62 : kind === "bunny" ? 1.1 : kind === "helmet" ? 1.15 : 1),
      y: hideY,
      y0: 0,
      hideY,
      peekY: -(rig.top - 0.42),
      struck: false,
      hits: 0,
      sx: new Wobble(300, 10),
      sy: new Wobble(300, 10),
      aiAt: Infinity,
      dizzy: 0,
      seed: Math.floor(rng() * 1000),
    };
    if (mode === "attract" && kind !== "bunny" && rng() > 0.14) c.aiAt = c.peekT + rng.range(0.2, 0.5);
    rig.root.visible = true;
    rig.root.position.set(s.pos.x, hideY, s.pos.z);
    rig.root.rotation.set(0, 0, 0);
    rig.body.scale.set(1, 1, 1);
    rig.eyes.scale.set(1, 1, 1);
    rig.eyes.visible = true;
    if (rig.xEyes) rig.xEyes.visible = false;
    if (rig.hat) {
      rig.hat.visible = true;
      rig.hat.rotation.set(0, 0, 0);
    }
    s.c = c;
    lastSlot = slot;
    const p = toScreen(s.pos.x, 0.1, s.pos.z);
    bits.emit(p.x, p.y, { count: 5, speed: [60, 160], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.3, 0.55], size: [5, 9], colors: [DIRT, DIRT_DARK], shape: "dot", gravity: 900 });
    if (isPlay()) audio.play(S.rumble, { volume: 0.5, pitch: rng.range(-2, 2) });
  }

  function pickKind(t: number): Kind {
    const golden = !slots.some((s) => s.c?.kind === "golden") && t > 5 && rng() < 0.06;
    if (golden) return "golden";
    const r = rng();
    if (r < bunnyChance(t)) return "bunny";
    if (r < bunnyChance(t) + helmetChance(t)) return "helmet";
    return "gopher";
  }

  function spawnRandom(t: number) {
    const active = slots.filter((s) => s.c).length;
    if (active >= maxActive(t)) {
      spawnT = 0.12;
      return;
    }
    const free = slots.map((s, i) => (s.c ? -1 : i)).filter((i) => i >= 0 && i !== lastSlot);
    if (!free.length) return;
    spawn(rng.pick(free), pickKind(t), t);
    // Later on, gophers sometimes come in pairs.
    if (t > 22 && rng() < 0.22 && active + 1 < maxActive(t)) {
      const more = slots.map((s, i) => (s.c ? -1 : i)).filter((i) => i >= 0);
      if (more.length) spawn(rng.pick(more), rng() < bunnyChance(t) ? "bunny" : "gopher", t);
    }
    spawnT = spawnEvery(t) * rng.range(0.8, 1.2);
  }

  // -------------------------------------------------------------------------------------------------------------
  // Swings and hits
  // -------------------------------------------------------------------------------------------------------------
  const SWING_T = 0.07;
  const HOLD_T = 0.1;
  const LIFT_T = 0.24;
  const RAISED = -1.55;
  const YAW = -0.55;

  function hittable(c: Critter | null): c is Critter {
    return !!c && !c.struck && (c.state === "peek" || c.state === "up");
  }

  function swingAt(slot: number, c: Critter | null) {
    const sw = swings[swingIdx++ % swings.length]!;
    sw.t = 0;
    sw.slot = slot;
    sw.target = c;
    sw.landed = false;
    if (c) {
      c.struck = true;
      sw.hitY = Math.max(0.15, c.y + c.rig.top - (c.kind === "bunny" ? 0.75 : 0.05));
    } else sw.hitY = 0.15;
    const p = slots[slot]!.pos;
    sw.m.rig.visible = true;
    sw.m.rig.position.set(p.x, sw.hitY, p.z);
    sw.m.rig.rotation.set(0, YAW, 0);
    sw.m.swing.rotation.z = RAISED;
    sw.squash.v = 1;
    sw.squash.vel = 0;
    if (isPlay() || mode === "attract") audio.play(S.whiff, { volume: mode === "attract" ? 0.5 : 1, pitch: rng.range(-2, 3) });
  }

  function tapAt(x: number, y: number) {
    // Prefer a critter whose body contains the tap, else the nearest hole (a whiff).
    const a = toScreen(HOLES[3]!.x, 0, HOLES[3]!.z);
    const ax = a.x;
    const ay = a.y;
    const b = toScreen(HOLES[4]!.x, 0, HOLES[4]!.z);
    const cell = Math.hypot(b.x - ax, b.y - ay);
    let best = -1;
    let bestD = Infinity;
    slots.forEach((s, i) => {
      const c = s.c;
      if (!hittable(c)) return;
      const mid = toScreen(s.pos.x, c.y + c.rig.top * 0.55, s.pos.z);
      const dx = (x - mid.x) / (cell * 0.55);
      const dy = (y - mid.y) / (cell * 0.7);
      const d = dx * dx + dy * dy;
      if (d < 1 && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      slots.forEach((s, i) => {
        const p = toScreen(s.pos.x, 0.3, s.pos.z);
        const d = Math.hypot(x - p.x, y - p.y) / (cell * 0.62);
        if (d < 1 && d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) return;
    }
    const c = slots[best]!.c;
    swingAt(best, hittable(c) ? c : null);
  }

  function addScore(c: Critter, p: { x: number; y: number }) {
    if (time - lastHit <= COMBO_WINDOW) streak++;
    else streak = 1;
    lastHit = time;
    const before = multFor(streak - 1);
    const mult = multFor(streak);
    const gained = POINTS[c.kind] * mult;
    score += gained;
    thunks++;
    scorePop.kick(9 + gained * 1.5);
    pows.float(`+${gained}`, p.x + 58, p.y + 6, { size: c.kind === "golden" ? 30 : 24, textFill: c.kind === "golden" ? PAL.banana : PAL.white });
    if (mult > before && mult > 1) {
      bestMult = Math.max(bestMult, mult);
      comboPop.kick(16);
      const cx = W / 2;
      const cy = H * 0.3;
      pows.burst(`COMBO ×${mult}!`, cx, cy, { size: 26, fill: PAL.bubblegum, life: 0.95, rot: -0.12 });
      bits.emit(cx, cy, { count: reduced ? 12 : 30, speed: [180, 460], life: [0.7, 1.3], size: [8, 13], colors: [PAL.tomato, PAL.cobalt, PAL.lime, PAL.white, PAL.bubblegum], shape: "confetti", gravity: 520, drag: 1.6 });
      audio.play({ ...S.kazoo, arp: [0, 4, 7, 12], arpStep: 0.07, duration: 0.34 }, { pitch: mult });
    }
  }

  function loseLife(why: "escape" | "bunny", p: { x: number; y: number }) {
    streak = 0;
    lives--;
    lostHats.push({ i: lives, t: 0 });
    shake.add(0.35);
    flash.trigger(PAL.tomato, 0.7);
    session.feedback("fail");
    if (why === "escape") {
      pows.burst("HEH HEH!", p.x, p.y - 30, { size: 20, fill: PAL.tomato, life: 0.8 });
      audio.play({ ...S.kazoo, arp: [0, -3, 0, -5], arpStep: 0.09, duration: 0.38 });
    }
    if (lives <= 0) {
      dying = true;
      dieT = 0;
      music.stop();
      audio.play(S.whistleDown);
      audio.play(S.wahwah, { pitch: -5, volume: 0.9 });
      pows.burst("KAPUT!", W / 2, H * 0.4, { size: 54, fill: PAL.tomato, life: 2.2, rot: -0.1 });
      shake.add(0.5);
      hitStop.freeze(0.12);
      // Everyone ducks.
      for (const s of slots) if (s.c && s.c.state !== "thunked" && s.c.state !== "down") goDown(s.c);
    }
  }

  function goDown(c: Critter) {
    c.state = "down";
    c.t = 0;
    c.y0 = Math.min(c.y, 0.05);
    c.sy.kick(-1.5);
  }

  /** The mallet lands on `sw.slot`. */
  function land(sw: Swing) {
    sw.landed = true;
    sw.squash.v = 0.72;
    sw.squash.vel = 0;
    const s = slots[sw.slot]!;
    const c = sw.target;
    const scoring = isPlay();
    const p = { ...toScreen(s.pos.x, sw.hitY, s.pos.z) };
    if (!c || c.state === "down") {
      // Whiff: the mallet thuds into the lawn.
      if (c) c.struck = false;
      bits.emit(p.x, p.y, { count: 8, speed: [80, 220], angle: [-Math.PI, 0], life: [0.25, 0.5], size: [5, 9], colors: [DIRT, PAL.limeShade], shape: "dot", gravity: 900 });
      shake.add(0.12);
      if (scoring) {
        streak = 0;
        audio.play(S.thud, { pitch: -6, volume: 0.6 });
        session.feedback("tap");
      }
      return;
    }
    c.struck = false;
    const big = c.kind === "golden";
    if (c.kind === "helmet" && c.hits === 0) {
      // First hit: the helmet flies off; the gopher is dazed but still up.
      c.hits = 1;
      c.sy.v = 0.62;
      c.sx.v = 1.25;
      c.t = Math.min(c.t, c.peekT + c.upT * 0.35);
      if (c.state === "peek") {
        c.state = "up";
        c.t = c.peekT;
      }
      c.upT += 0.35;
      launchHat(c, s.pos.x, s.pos.z, 1);
      pows.burst("CLANK!", p.x, p.y - 26, { size: 24, fill: PAL.cobalt });
      hitStop.freeze(0.045);
      shake.add(0.2);
      punchAt(p, 0.6);
      bits.emit(p.x, p.y, { count: 8, speed: [120, 300], life: [0.25, 0.5], size: [7, 11], colors: [PAL.white, PAL.cobaltHi], shape: "star", drag: 3 });
      if (scoring || mode === "attract") {
        audio.play(S.clank, { volume: mode === "attract" ? 0.5 : 1 });
        audio.play(S.ring, { volume: mode === "attract" ? 0.4 : 0.8 });
      }
      if (scoring) session.feedback("impact");
      if (mode === "attract") c.aiAt = c.t + rng.range(0.25, 0.4);
      return;
    }
    // THUNK: squash flat, stars, burst.
    c.state = "thunked";
    c.t = 0;
    c.sy.v = 0.4;
    c.sy.vel = 0;
    c.sx.v = 1.42;
    c.sx.vel = 0;
    c.dizzy = 1.1;
    if (c.rig.xEyes) {
      // Seeing crosses, and the hard hat goes flying.
      c.rig.eyes.visible = false;
      c.rig.xEyes.visible = true;
      if (c.rig.hat?.visible) launchHat(c, s.pos.x, s.pos.z, 0.85);
    } else c.rig.eyes.scale.set(1.15, 0.18, 1);
    hitStop.freeze(big ? 0.09 : 0.06);
    shake.add(big ? 0.42 : 0.26);
    punchAt(p, big ? 1 : 0.75);
    // Classic comic lettering: each word gets its own burst and letter colours.
    const [word, fill, textFill] =
      c.kind === "bunny"
        ? ["OUCH!", PAL.bubblegum, PAL.white]
        : big
          ? ["KA-CHING!", PAL.banana, PAL.tomato]
          : rng.pick([
              ["THUNK!", PAL.white, PAL.tomato],
              ["THUNK!", PAL.banana, PAL.tomato],
              ["POW!", PAL.white, PAL.cobalt],
              ["WHAM!", PAL.lime, PAL.white],
            ] as const);
    pows.burst(word, p.x, p.y - 30, { size: big ? 26 : 25, fill, textFill });
    bits.emit(p.x, p.y, { count: reduced ? 6 : 12, speed: [160, 380], life: [0.3, 0.6], size: [8, 13], colors: [PAL.banana, PAL.white], shape: "star", drag: 3.2 });
    if (c.kind === "bunny") {
      bits.emit(p.x, p.y - 10, { count: 8, speed: [120, 240], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [0.5, 0.8], size: [7, 10], colors: [PAL.cobaltHi], shape: "drop", gravity: 800 });
    }
    if (big) {
      flash.trigger(PAL.white, 0.6);
      bits.emit(p.x, p.y, { count: reduced ? 14 : 34, speed: [200, 520], life: [0.7, 1.2], size: [8, 13], colors: [PAL.banana, PAL.bananaHi, PAL.white, PAL.tomato], shape: "confetti", gravity: 600, drag: 1.5 });
    }
    if (scoring || mode === "attract") {
      const v = mode === "attract" ? 0.5 : 1;
      audio.play(S.crack, { volume: v, pitch: rng.range(-2, 2) });
      audio.play(S.thud, { volume: v });
      if (c.kind === "bunny") {
        audio.play(S.squeak, { volume: v });
      } else {
        audio.play(S.boing, { volume: v * 0.8, pitch: Math.min(12, streak) });
        if (big) audio.play(S.ding, { volume: v });
      }
    }
    if (scoring) {
      session.feedback(c.kind === "bunny" ? "fail" : "impact");
      if (c.kind === "bunny") {
        audio.play(S.wahwah, { pitch: 2 });
        loseLife("bunny", p);
      } else addScore(c, p);
    }
  }

  function punchAt(p: { x: number; y: number }, k: number) {
    if (reduced) return;
    punch = Math.max(punch, k);
    punchX = (p.x - W / 2) * 0.05;
    punchY = (p.y - H / 2) * 0.05;
  }

  // -------------------------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------------------------
  session.startOnTap(window);
  onPress(window, (x, y) => {
    if (isPlay()) tapAt(x, y);
  });
  session.on("start", () => {
    resetRun("play");
    framingTo = 1;
    audio.play(S.whistleUp);
    music.start();
  });
  session.on("cancel", () => {
    /* a press is instantaneous; nothing half-done to drop */
  });
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (isPlay()) music.start();
  });
  resetRun("attract");

  // -------------------------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------------------------
  function updateCritter(c: Critter, dt: number) {
    const root = c.rig.root;
    const body = c.rig.body;
    if (!c.struck) c.t += dt;
    let wiggle = 0;
    switch (c.state) {
      case "peek": {
        // Anticipation: the hat (or ears) pokes out and shivers.
        const k = clamp(c.t / c.peekT);
        c.y = lerp(c.hideY, c.peekY, easeOutCubic(clamp(k * 2.5))) + Math.abs(Math.sin(c.t * 26)) * 0.08;
        wiggle = Math.sin(c.t * 42) * 0.13;
        if (c.t >= c.peekT) {
          c.state = "up";
          c.sy.kick(5);
          c.sx.kick(-2);
          if (isPlay() || mode === "attract") audio.play(S.pop, { pitch: c.kind === "bunny" ? 7 : c.kind === "golden" ? 4 : rng.range(-1, 2), volume: mode === "attract" ? 0.4 : 0.8 });
        }
        break;
      }
      case "up": {
        const u = c.t - c.peekT;
        const rise = clamp(u / 0.15);
        c.y = lerp(c.peekY, 0, easeOutBack(rise, 2.2)) + (rise >= 1 ? Math.sin(u * 7 + c.seed) * 0.05 : 0);
        body.rotation.y = rise >= 1 && !c.struck ? Math.sin(u * 3.3 + c.seed) * 0.32 : 0;
        if (c.kind === "golden" && rng() < dt * 8) {
          const p = toScreen(root.position.x + rng.range(-0.8, 0.8), c.y + rng.range(0.8, 2.4), root.position.z);
          bits.emit(p.x, p.y, { count: 1, speed: [10, 40], life: [0.35, 0.6], size: [8, 12], colors: [PAL.white], shape: "star" });
        }
        // Duck anticipation for the last moment, then down.
        if (u > c.upT - 0.16 && !c.struck) c.sy.v = Math.min(c.sy.v, 0.9);
        if (u >= c.upT && !c.struck) goDown(c);
        if (mode === "attract" && c.t >= c.aiAt && !c.struck) {
          c.aiAt = Infinity;
          swingAt(c.slot, c);
        }
        break;
      }
      case "down": {
        const k = clamp(c.t / 0.13);
        c.y = lerp(c.y0, c.hideY, easeInQuad(k));
        if (k >= 1) {
          if (c.kind !== "bunny" && c.kind !== "golden" && isPlay()) {
            const p = toScreen(root.position.x, 0.6, root.position.z);
            loseLife("escape", { x: p.x, y: p.y });
          }
          hideCritter(c);
          return;
        }
        break;
      }
      case "thunked": {
        c.dizzy -= dt;
        if (c.t > 0.75) {
          const k = clamp((c.t - 0.75) / 0.28);
          c.y = lerp(0, c.hideY * 0.6, easeInQuad(k));
          if (k >= 1) {
            hideCritter(c);
            return;
          }
        }
        break;
      }
    }
    // Squash and stretch, volume-ish preserving.
    if (c.state !== "thunked") {
      c.sx.update(dt);
      c.sy.update(dt);
    } else {
      // Flattened: settle toward a pancake with a little wobble.
      c.sy.k = 260;
      c.sy.v += (0.44 - c.sy.v) * Math.min(1, dt * 10);
      c.sx.v += (1.38 - c.sx.v) * Math.min(1, dt * 10);
    }
    const sy = Math.max(0.15, c.sy.v);
    const sx = c.state === "thunked" ? c.sx.v : 1 / Math.sqrt(sy);
    body.scale.set(sx, sy, sx);
    root.position.y = c.y;
    root.rotation.z = wiggle;
  }

  function updateSwing(sw: Swing, dt: number) {
    if (!sw.m.rig.visible) return;
    sw.t += dt;
    const t = sw.t;
    let a: number;
    if (t < SWING_T) a = lerp(RAISED, 0, easeInQuad(t / SWING_T));
    else {
      if (!sw.landed) land(sw);
      if (t < SWING_T + HOLD_T) a = Math.sin(((t - SWING_T) / HOLD_T) * Math.PI) * -0.06;
      else {
        const k = clamp((t - SWING_T - HOLD_T) / LIFT_T);
        a = lerp(0, RAISED - 0.4, easeOutCubic(k));
        if (k >= 1) sw.m.rig.visible = false;
      }
    }
    sw.m.swing.rotation.z = a;
    const q = sw.squash.update(dt);
    sw.m.head.scale.set(1 + (1 - q) * 0.6, q, 1 + (1 - q) * 0.6);
  }

  function updateFlyer(f: Flyer, dt: number) {
    if (f.life <= 0) return;
    f.life -= dt;
    f.vel.y -= 26 * dt;
    f.pos.addScaledVector(f.vel, dt);
    f.rig.root.position.copy(f.pos);
    f.rig.root.rotation.x += f.spin.x * dt;
    f.rig.root.rotation.y += f.spin.y * dt;
    f.rig.root.rotation.z += f.spin.z * dt;
    // Hats that land on the lawn bounce once, then vanish in a puff.
    const onBoard = Math.abs(f.pos.x) < BOARD_W / 2 && Math.abs(f.pos.z) < BOARD_D / 2;
    if (onBoard && f.pos.y < 0.3 && f.vel.y < 0) {
      if (f.bounces++ === 0) {
        f.vel.y = Math.abs(f.vel.y) * 0.45;
        f.vel.x *= 1.25;
        f.spin.multiplyScalar(0.6);
        if (isPlay()) audio.play(S.clank, { volume: 0.25, pitch: f.kind === "helmet" ? 0 : -9 });
      } else f.life = 0;
      const p = toScreen(f.pos.x, 0.2, f.pos.z);
      bits.emit(p.x, p.y, { count: 5, speed: [50, 140], angle: [-Math.PI, 0], life: [0.25, 0.45], size: [6, 10], colors: [PAL.white, PAL.limeHi], shape: "dot", gravity: 500 });
    }
    if (f.life <= 0) f.rig.root.visible = false;
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += rawDt;
    shake.update(rawDt);
    flash.update(rawDt);
    bits.update(rawDt);
    pows.update(rawDt);
    scorePop.update(rawDt);
    comboPop.update(rawDt);
    logoPop.update(rawDt);
    punch = Math.max(0, punch - rawDt * 6);
    framing = framingTo > framing ? Math.min(framingTo, framing + rawDt / 0.7) : Math.max(framingTo, framing - rawDt / 0.7);
    for (const h of lostHats) h.t += rawDt;

    // Spawning: the run's clock drives difficulty; attract and the result screen idle at an easy pace.
    if (mode === "play" && session.phase === "playing" && !dying) {
      runT += dt;
      if (opening < OPENING.length) {
        const [at, hole, kind] = OPENING[opening]!;
        if (runT >= at) {
          spawn(hole, kind, runT);
          opening++;
          if (opening === OPENING.length) spawnT = 0.9;
        }
      } else {
        spawnT -= dt;
        if (spawnT <= 0) spawnRandom(runT);
      }
    } else if (mode === "attract" || (session.phase === "over" && !dying)) {
      spawnT -= dt;
      if (spawnT <= 0) spawnRandom(mode === "attract" ? 21 : 4);
    }

    for (const s of slots) if (s.c) updateCritter(s.c, dt);
    for (const sw of swings) updateSwing(sw, dt);
    for (const f of flyers) updateFlyer(f, dt);

    if (dying) {
      dieT += rawDt;
      if (!endSent && dieT > 0.6) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { thunks, bestCombo: bestMult } });
        spawnT = 1.6;
      }
      if (dieT > 1.2) dying = false;
    }

    applyCamera();
    // Backdrop rays turn slowly around the board's centre.
    const c = toScreen(0, 0, -1);
    backdrop.uniforms.uCenter.value.set(c.x / W, c.y / H);
    backdrop.uniforms.uSpin.value = reduced ? 0 : time * 0.06;
  }

  // -------------------------------------------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------------------------------------------
  function hatIcon(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, alive: boolean) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(-r * 0.92, 0);
    g.bezierCurveTo(-r * 0.98, -r * 1.5, r * 0.98, -r * 1.5, r * 0.92, 0);
    g.closePath();
    if (alive) {
      inkFill(g, PAL.banana, 3.5, 3);
      // Centre ridge and a cel-shade on the right.
      g.save();
      g.clip();
      g.fillStyle = PAL.bananaShade;
      g.beginPath();
      g.ellipse(r * 0.95, -r * 0.2, r * 0.55, r * 1.3, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      roundRectPath(g, -r * 0.2, -r * 1.12, r * 0.4, r * 1.12, r * 0.16);
      inkFill(g, PAL.banana, 3, 0);
      roundRectPath(g, -r * 1.25, -r * 0.12, r * 2.5, r * 0.36, r * 0.18);
      inkFill(g, PAL.banana, 3.5, 3);
      g.fillStyle = PAL.white;
      g.beginPath();
      g.ellipse(-r * 0.5, -r * 0.72, r * 0.22, r * 0.1, -0.8, 0, Math.PI * 2);
      g.fill();
    } else {
      // An empty slot: a flat ink silhouette.
      g.globalAlpha = 0.22;
      g.fillStyle = PAL.ink;
      g.fill();
      roundRectPath(g, -r * 1.25, -r * 0.12, r * 2.5, r * 0.36, r * 0.18);
      g.fill();
    }
    g.restore();
  }

  function drawDizzy(g: CanvasRenderingContext2D) {
    for (const s of slots) {
      const c = s.c;
      if (!c || c.dizzy <= 0) continue;
      const p = toScreen(s.pos.x, c.y + c.rig.top * c.rig.body.scale.y + 0.45, s.pos.z);
      const n = c.kind === "golden" ? 4 : 3;
      for (let k = 0; k < n; k++) {
        const a = time * 7 + (k / n) * Math.PI * 2;
        const x = p.x + Math.cos(a) * 34;
        const y = p.y + Math.sin(a) * 11;
        g.save();
        g.translate(x, y);
        g.rotate(time * 4 + k);
        const sz = 8 + Math.sin(a) * 2;
        starPath(g, sz);
        inkFill(g, c.kind === "bunny" ? PAL.bubblegumHi : PAL.banana, 2.5, 0);
        g.restore();
      }
    }
  }

  function drawLogo(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
    // A hop every 1.2 s: rise, land, squash.
    const ph = (time % 1.2) / 1.2;
    const hop = reduced ? 0 : Math.max(0, Math.sin(ph * Math.PI * 2)) * 7;
    if (!reduced && logoPh < 0.5 && ph >= 0.5) logoPop.kick(-3.2);
    logoPh = ph;
    const sq = logoPop.v;
    g.save();
    g.translate(cx, cy - hop);
    g.rotate(-0.09 + (reduced ? 0 : Math.sin(time * 1.7) * 0.025));
    g.scale(s * (2 - sq), s * sq);
    drawSprite(
      g,
      cachedSprite("logo-burst", 400, 240, 195, 115, (cg) => {
        burstPath(cg, 158, 86, 15, 4242, 0.2);
        inkFill(cg, PAL.tomato, 6, 8);
      }),
      0,
      0,
    );
    stickerWord(g, "THUNK", -4, -20, { size: 56, cut: 0, stroke: 0.25, shadow: 5 }, (i) => ({
      dx: 0,
      dy: reduced ? 0 : -Math.max(0, Math.sin(time * 6 - i * 0.7)) * 6,
      rot: reduced ? 0 : Math.sin(time * 3.1 + i * 1.7) * 0.07,
      sx: 1,
      sy: 1,
    }));
    stickerWord(g, "FEST!", 26, 33, { size: 40, fill: PAL.banana, stroke: 0.26, shadow: 4 }, (i) => ({
      dx: 0,
      dy: reduced ? 0 : -Math.max(0, Math.sin(time * 6 - 2.2 - i * 0.7)) * 5,
      rot: (i % 2 ? 0.08 : -0.06) + (reduced ? 0 : Math.sin(time * 2.7 + i) * 0.05),
      sx: 1,
      sy: 1,
    }));
    g.restore();
  }

  function drawPrompt(g: CanvasRenderingContext2D, cx: number, cy: number, text: string, s: number, fill: string) {
    const wob = reduced ? 0 : Math.sin(time * 5.2) * 0.06;
    const pulse = reduced ? 1 : 1 + Math.sin(time * 7.3) * 0.04;
    burstSticker(g, text, cx, cy, { size: 22, fill, rx: 134, ry: 38, spikes: 13, seed: 99, jag: 0.2, rot: 0.05 + wob, scale: s * pulse });
  }

  function drawHud() {
    stage.beginHud();
    const g = hud;
    drawDizzy(g);
    bits.draw(g);
    pows.draw(g);
    const ui = clamp(W / 390, 0.8, 1.4);

    if (mode === "play") {
      const q = session.play();
      const top = q.top + 12;
      // Score sticker, top left.
      const sp = scorePop.v;
      sticker(g, String(score), q.left + 18, top + 30 * ui, { size: 46 * ui, align: "left", rot: -0.07, sx: sp, sy: sp, stroke: 0.24 });
      // Combo tag with a draining ring.
      const mult = multFor(streak);
      const left = COMBO_WINDOW - (time - lastHit);
      if (mult > 1 && left > 0 && isPlay()) {
        const x = q.left + 52 * ui;
        const y = top + 84 * ui;
        const s = comboPop.v * ui;
        g.save();
        g.translate(x, y);
        g.rotate(-0.12 + (reduced ? 0 : Math.sin(time * 9) * 0.04));
        g.scale(s, s);
        g.beginPath();
        g.arc(0, 0, 26, 0, Math.PI * 2);
        inkFill(g, PAL.cobalt, 3.5, 3);
        g.beginPath();
        g.arc(0, 0, 26, -Math.PI / 2, -Math.PI / 2 + (left / COMBO_WINDOW) * Math.PI * 2);
        g.lineWidth = 6;
        g.strokeStyle = PAL.banana;
        g.stroke();
        sticker(g, `×${mult}`, 0, 0, { size: 20, stroke: 0.26, shadow: 2 });
        g.restore();
      }
      // Lives: hard hats, top right; lost ones pop off and tumble.
      for (let i = 0; i < LIVES; i++) {
        const x = W - q.right - 30 * ui - (LIVES - 1 - i) * 42 * ui;
        const y = top + 26 * ui;
        const lost = lostHats.find((h) => h.i === i);
        hatIcon(g, x, y, 15 * ui, (i - 1) * 0.12, false);
        if (i < lives) hatIcon(g, x, y + (reduced ? 0 : Math.sin(time * 3 + i) * 1.5), 15 * ui, (i - 1) * 0.12, true);
        else if (lost && lost.t < 1.2) {
          const t = lost.t;
          hatIcon(g, x + t * 80, y - 180 * t + 520 * t * t, 15 * ui, t * 9, true);
        }
      }
      if (session.best) {
        sticker(g, `BEST ${session.best}`, W - q.right - 18 * ui, top + 62 * ui, { size: 13 * ui, align: "right", rot: 0.05, stroke: 0.28, shadow: 2 });
      }
      if (session.phase === "over" && session.standalone && session.phaseTime > 0.8) {
        const p = session.preview();
        const cx = (p.left + W - p.right) / 2;
        drawPrompt(g, cx, H - p.bottom - 40 * ui, "TAP TO RETRY!", ui, PAL.cobalt);
      }
    } else {
      const p = session.preview();
      const cx = (p.left + 16 + (W - p.right - 10)) / 2;
      drawLogo(g, cx, p.top + 84 * ui, ui * 0.88);
      if (session.best) {
        sticker(g, `BEST ${session.best}`, cx + 88 * ui, p.top + 138 * ui, { size: 14 * ui, rot: 0.08, stroke: 0.28, shadow: 2, fill: PAL.white });
      }
      drawPrompt(g, cx, H - p.bottom - 36 * ui, "TAP TO THUNK!", ui, PAL.cobalt);
    }
    flash.draw(g, W, H);
  }

  // Compile every shader before ready() so no frame after it stalls.
  update(0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  let frames = 0;
  tc.loop((dt) => {
    update(Math.min(dt, 0.05));
    renderer.render(scene, camera);
    drawHud();
    if (++frames === 2) session.ready();
  });
}

void main();
