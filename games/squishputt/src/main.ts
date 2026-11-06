import { damp } from "@thumbcade-games/kit/ease";
import { onDrag } from "@thumbcade-games/kit/input";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createClayKit, lumpify, sharedGeo } from "./clay.ts";
import { loadFredoka } from "./fonts.ts";
import { buildHoleView, TABLE_Y, type HoleView } from "./course.ts";
import { createCritters, hopTo, place, poseCritter, type Mood } from "./critters.ts";
import type { V2 } from "./geom.ts";
import { BALL_R, buildHole, heightAt, poolFor, type HoleDef, type TemplateName } from "./holes.ts";
import { Hud, type HudLayout } from "./hud.ts";
import { PAL } from "./palette.ts";
import { bladeAngle, Course, MAX_SPEED, newEvents, step, STEP, type Ball, type RollState } from "./physics.ts";
import { DistanceField, ShotPlanner } from "./planner.ts";
import { createSounds } from "./sound.ts";

const ID = "squishputt";
const START_STROKES = 8;
const MAX_STROKES = 12;
const SHOT_CLOCK = 12;
const SHOT_CLOCK_IDLE = 6;
const DEAD_PX = 14;
const FPS = 12;
/** Dev builds only (VITE_SP_AUTOPLAY=1): the demo golfer plays real runs, for soak tests and screenshots. */
const AUTOPLAY = import.meta.env.VITE_SP_AUTOPLAY === "1";
const ATTRACT_HOLES: TemplateName[] = ["windmill", "garden", "pond", "plateau", "millpond", "volcano", "sandglass", "hump"];

type Phase = "aim" | "swing" | "rolling" | "sinking" | "splash" | "cheer" | "transition" | "over";

async function main() {
  const [session] = await Promise.all([
    createSession({ id: ID }),
    loadFredoka(),
  ]);
  const reduced = session.reducedMotion;
  const sfx = createSounds();
  const rng = createRng(session.ctx.seed || 1);
  const jitter = createRng(97);

  // ---------------------------------------------------------------------------
  // Renderer, scene, lights
  // ---------------------------------------------------------------------------
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  // PCFSoftShadowMap is gone in r186; PCF with a radius gives the same soft, sampled edge.
  renderer.shadowMap.type = PCFShadowMap;
  const felt = new Color(PAL.felt);
  renderer.setClearColor(felt);
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  document.body.appendChild(canvas);
  const vignette = document.createElement("div");
  vignette.style.cssText =
    "position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse 85% 70% at 50% 46%,rgba(255,240,220,0) 55%,rgba(150,90,55,.2) 100%)";
  document.body.appendChild(vignette);
  const hud = new Hud();
  hud.setReduced(reduced);

  let W = 1;
  let H = 1;
  /** Drops (never rises) when a slow GPU can't keep up: sharpness is the first thing we trade. */
  let dprCap = 2;
  const camera = new PerspectiveCamera(30, 1, 0.1, 120);
  const resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    W = w;
    H = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    relayout();
  };

  const scene = new Scene();
  const fog = new Fog(felt, 14, 40);
  scene.fog = fog;
  scene.add(new HemisphereLight(0xfff1e0, 0xd9b08c, 1.05));
  const key = new DirectionalLight(0xffdcb0, 2.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera;
  sc.left = -9;
  sc.right = 9;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 40;
  scene.add(key, key.target);
  const fill = new DirectionalLight(0xb4ccff, 0.6);
  scene.add(fill, fill.target);
  const kit = createClayKit(createRng(42));

  const tableMat = new MeshStandardMaterial({ color: felt, map: kit.felt, normalMap: kit.feltNormal, roughness: 1, metalness: 0 });
  kit.felt.repeat.set(26, 26);
  kit.feltNormal.repeat.set(26, 26);
  const table = new Mesh(new PlaneGeometry(90, 90), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = TABLE_Y;
  table.receiveShadow = true;
  scene.add(table);

  // Ball, its contact shadow, the putter and the bead aim line.
  const ballMesh = new Mesh(lumpify(new SphereGeometry(BALL_R, 26, 18), 0.006, 30, 4), kit.clay(PAL.ball));
  ballMesh.castShadow = true;
  scene.add(ballMesh);
  const ballShadow = new Mesh(sharedGeo("plane", () => new PlaneGeometry(1, 1)), kit.shadowMat);
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.scale.set(0.42, 0.42, 1);
  scene.add(ballShadow);

  const putter = new Group();
  const head = new Mesh(new RoundedBoxGeometry(0.46, 0.13, 0.15, 2, 0.05), kit.clay(PAL.salmon));
  head.position.y = 0.075;
  head.castShadow = true;
  const shaft = new Mesh(new CapsuleGeometry(0.028, 0.9, 4, 8), kit.clay(PAL.choc));
  shaft.position.set(0.14, 0.52, 0.13);
  shaft.rotation.set(0.32, 0, -0.25);
  shaft.castShadow = true;
  const grip = new Mesh(new CapsuleGeometry(0.042, 0.2, 4, 8), kit.clay(PAL.butter));
  grip.position.set(0.27, 0.95, 0.28);
  grip.rotation.copy(shaft.rotation);
  putter.add(head, shaft, grip);
  putter.visible = false;
  scene.add(putter);

  const beadGeo = lumpify(new SphereGeometry(0.066, 14, 10), 0.007, 40, 1);
  const beadMats = [kit.clay(PAL.cream), kit.clay(PAL.butter), kit.clay(PAL.salmon), kit.clay(PAL.salmonDeep)];
  const beads: Mesh[] = [];
  for (let i = 0; i < 11; i++) {
    const b = new Mesh(beadGeo, beadMats[0]);
    b.castShadow = true;
    b.visible = false;
    scene.add(b);
    beads.push(b);
  }

  // Clay crumbs (confetti and splashes), animated in stop-motion.
  const CRUMBS = 70;
  const crumbMesh = new InstancedMesh(lumpify(new SphereGeometry(0.075, 12, 8), 0.016, 30, 2), kit.clay(PAL.cream), CRUMBS);
  crumbMesh.castShadow = true;
  crumbMesh.count = 0;
  scene.add(crumbMesh);
  interface Crumb {
    p: Vector3;
    v: Vector3;
    s: number;
    life: number;
    color: Color;
  }
  let crumbs: Crumb[] = [];
  const dummy = new Object3D();

  const critters = createCritters(kit);
  for (const c of critters) scene.add(c.root);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  interface HoleState {
    def: HoleDef;
    course: Course;
    view: HoleView;
    field: DistanceField | null;
    number: number;
    t: number;
  }
  let hole: HoleState | null = null;
  let mode: "attract" | "play" = "attract";
  let phase: Phase = "aim";
  let phaseT = 0;
  const ball: Ball = { x: 0, z: 0, vx: 0, vz: 0 };
  const roll: RollState = { slowFor: 0, inSand: false };
  const ballQ = new Quaternion();
  let ballScale = 1;
  let ballHidden = false;
  let lastFrom: V2 = { x: 0, z: 0 };
  let strokes = START_STROKES;
  let taken = 0;
  let score = 0;
  let sunkHoles = 0;
  let aces = 0;
  let shotClock = 0;
  let idleStreak = 0;
  let lastTemplate: TemplateName | null = null;
  let attractIndex = 0;
  let mood: Mood = "idle";
  let moodStep = 0;
  let stepClock = 0;
  let stepN = 0;
  let plapCool = 0;
  let endSent = false;
  let flagHop = -1;
  const bumperHops = new Map<number, number>();
  /** Squash-in / squash-out of a hole (stop-motion frames). */
  let trans: { step: number; next: (() => void) | null } | null = null;
  // Aim (player or demo).
  const aim = { active: false, angle: -Math.PI / 2, power: 0, x0: 0, y0: 0, band: -1 };
  let swing: { t: number; angle: number; power: number } | null = null;
  let demo: { planner: ShotPlanner; releaseAt: number } | null = null;
  let time = 0;

  // Camera rig (smoothed toward the fit for the current hole).
  const rig = { yaw: 0, elev: 0.98, dist: 18, offX: 0, offY: 0, tx: 0, ty: 0, tz: 0, init: false };

  const layoutFor = (): HudLayout => ({ w: W, h: H, safe: mode === "play" ? session.play() : session.preview() });
  function relayout(): void {
    hud.layout(layoutFor());
  }

  // ---------------------------------------------------------------------------
  // Holes
  // ---------------------------------------------------------------------------
  function makeHole(def: HoleDef, number: number): HoleState {
    const course = new Course(def);
    const view = buildHoleView(def, kit, createRng(rng.int(1, 1e9)), number, mode === "attract" ? attractIndex - 1 : number);
    view.group.scale.set(1.12, 0.05, 1.12);
    scene.add(view.group);
    return { def, course, view, field: mode === "attract" ? new DistanceField(course) : null, number, t: 0 };
  }

  function seatCritters(h: HoleState, instant: boolean): void {
    const spots = h.view.critterSpots.slice();
    // The chick hosts the attract screen: give it the seat nearest the tee.
    spots.sort((a, b) => b.z - a.z);
    critters.forEach((c, i) => {
      const s = spots[i] ?? { x: (i - 1) * 3, z: 7 };
      if (instant) place(c, s.x, TABLE_Y, s.z);
      else hopTo(c, s.x, TABLE_Y, s.z, 9 + i * 2);
    });
  }

  function nextDef(): HoleDef {
    if (mode === "attract") {
      const name = ATTRACT_HOLES[attractIndex++ % ATTRACT_HOLES.length]!;
      return buildHole(name, createRng(rng.int(1, 1e9)), 2);
    }
    const n = sunkHoles;
    const pool = poolFor(n).filter((p) => p !== lastTemplate);
    const name = rng.pick(pool);
    lastTemplate = name;
    return buildHole(name, createRng(rng.int(1, 1e9)), n);
  }

  /** Squash the current hole away, sculpt the next one. */
  function changeHole(instant = false): void {
    const def = nextDef();
    const number = mode === "play" ? sunkHoles + 1 : 0;
    const swap = () => {
      if (hole) {
        scene.remove(hole.view.group);
        hole.view.dispose();
      }
      hole = makeHole(def, number);
      seatCritters(hole, instant);
      setBall(def.tee.x, def.tee.z);
      ballHidden = true;
      taken = 0;
      shotClock = 0;
      sfx.squelch();
      if (mode === "play") hud.setHole(number, def.par);
    };
    phase = "transition";
    phaseT = 0;
    aim.active = false;
    swing = null;
    demo = null;
    if (mode === "play") hud.holeCard(number, def.name, def.par);
    if (instant || !hole) {
      swap();
      trans = { step: 5, next: null };
    } else {
      trans = { step: 0, next: swap };
      sfx.squelch();
    }
  }

  function setBall(x: number, z: number): void {
    ball.x = x;
    ball.z = z;
    ball.vx = 0;
    ball.vz = 0;
    roll.slowFor = 0;
    roll.inSand = hole ? hole.course.inSand(x, z) : false;
    lastFrom = { x, z };
  }

  const OUT_Y = [1, 0.72, 0.42, 0.18, 0.04];
  const OUT_XZ = [1, 1.04, 1.08, 1.1, 1.12];
  const IN_Y = [0.05, 0.42, 0.88, 1.13, 0.95, 1.03, 1];
  const IN_XZ = [1.12, 1.07, 1.0, 0.97, 1.01, 1, 1];

  function stepTransition(): void {
    if (!trans) return;
    const s = trans.step++;
    if (s < OUT_Y.length && trans.next && hole) {
      const g = hole.view.group;
      g.scale.set(OUT_XZ[s]!, reduced ? Math.max(0.04, 1 - s * 0.25) : OUT_Y[s]!, OUT_XZ[s]!);
      return;
    }
    if (trans.next) {
      trans.next();
      trans.next = null;
      trans.step = OUT_Y.length;
    }
    const i = trans.step - OUT_Y.length - 1;
    if (hole && i >= 0 && i < IN_Y.length) {
      hole.view.group.scale.set(reduced ? 1 : IN_XZ[i]!, reduced ? Math.min(1, 0.25 + i * 0.25) : IN_Y[i]!, reduced ? 1 : IN_XZ[i]!);
    }
    if (hole && i >= IN_Y.length) {
      hole.view.group.scale.set(1, 1, 1);
      trans = null;
      ballHidden = false;
      ballScale = 0.3;
      popBall = 0;
      sfx.pop(4);
      beginAim();
    }
  }
  let popBall = -1;
  const POP = [0.3, 1.25, 0.9, 1.04, 1];

  function beginAim(): void {
    phase = "aim";
    phaseT = 0;
    shotClock = 0;
    if ((mode === "attract" || AUTOPLAY) && hole) {
      const releaseAt = hole.t + 1.7 + (taken === 0 ? 0.6 : 0);
      hole.field ??= new DistanceField(hole.course);
      demo = { planner: new ShotPlanner(hole.course, hole.field, { x: ball.x, z: ball.z }, releaseAt), releaseAt };
    }
  }

  // ---------------------------------------------------------------------------
  // Shots
  // ---------------------------------------------------------------------------
  function launch(angle: number, power: number): void {
    if (!hole) return;
    const p = Math.max(0.04, Math.min(1, power));
    lastFrom = { x: ball.x, z: ball.z };
    ball.vx = Math.cos(angle) * p * MAX_SPEED;
    ball.vz = Math.sin(angle) * p * MAX_SPEED;
    roll.slowFor = 0;
    roll.inSand = hole.course.inSand(ball.x, ball.z);
    phase = "rolling";
    phaseT = 0;
    sfx.putt(p);
    if (mode === "play") {
      strokes--;
      taken++;
      idleStreak = 0;
      hud.setStrokes(strokes);
      session.feedback("tap");
    } else taken++;
  }

  function release(angle: number, power: number): void {
    swing = { t: 0, angle, power };
    phase = "swing";
    phaseT = 0;
  }

  function burnStroke(): void {
    strokes = Math.max(0, strokes - 1);
    taken++;
    idleStreak++;
    hud.setStrokes(strokes);
    const p = screenOf(ball.x, ballY() + 0.4, ball.z);
    hud.popup("too slow! –1", p.x, p.y, "salmon");
    sfx.miss();
    setMood("gasp");
    shotClock = 0;
    if (strokes <= 0) gameOver();
  }

  function sinkRewards(): void {
    if (!hole) return;
    const par = hole.def.par;
    const kind = taken === 1 ? "ace" : taken < par ? "under" : taken === par ? "par" : "over";
    sfx.sink(kind);
    const cup = screenOf(hole.def.cup.x, heightAt(hole.def, hole.def.cup.x, hole.def.cup.z) + 1.1, hole.def.cup.z);
    if (mode === "play") {
      const refund = { ace: 3, under: 2, par: 1, over: 0 }[kind];
      const bonus = { ace: 100, under: 50, par: 20, over: 0 }[kind];
      strokes = Math.min(MAX_STROKES, strokes + refund);
      score += 100 + bonus;
      sunkHoles++;
      if (kind === "ace") aces++;
      hud.setStrokes(strokes);
      hud.setScore(score);
      const label = { ace: "hole in one!", under: "under par!", par: "par!", over: "sunk it" }[kind];
      const tone = ({ ace: "powder", under: "sage", par: "butter", over: "cream" } as const)[kind];
      hud.popup(label, cup.x, cup.y, tone, 1.6);
      hud.popup(refund ? `+${refund} stroke${refund > 1 ? "s" : ""} · +${100 + bonus}` : `+${100 + bonus}`, cup.x, cup.y + 46, "cream", 1.6);
      session.feedback("success");
    } else {
      const label = { ace: "hole in one!", under: "nice putt!", par: "plop!", over: "plop!" }[kind];
      hud.popup(label, cup.x, cup.y, kind === "ace" ? "powder" : "butter", 1.3);
    }
    setMood("cheer");
    flagHop = 0;
    const cy = heightAt(hole.def, hole.def.cup.x, hole.def.cup.z);
    burst(hole.def.cup.x, cy + 0.1, hole.def.cup.z, kind === "ace" ? 34 : 22, [PAL.salmon, PAL.butter, PAL.lavender, PAL.powder, PAL.cream, PAL.pink], 2.6);
  }

  function gameOver(): void {
    if (mode !== "play" || phase === "over") return;
    phase = "over";
    phaseT = 0;
    setMood("sad");
    sfx.miss();
    aim.active = false;
    const p = screenOf(ball.x, ballY() + 0.5, ball.z);
    hud.popup("out of putty!", p.x, p.y, "salmon", 1.8);
    hud.setClock(null);
    session.feedback("fail");
  }

  function setMood(m: Mood): void {
    mood = m;
    moodStep = 0;
    if (m === "cheer") for (let i = 0; i < 3; i++) sfx.chirp();
  }

  function burst(x: number, y: number, z: number, n: number, colors: string[], up: number): void {
    for (let i = 0; i < n && crumbs.length < CRUMBS; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 1.6;
      crumbs.push({
        p: new Vector3(x, y, z),
        v: new Vector3(Math.cos(a) * s, up * (0.7 + Math.random() * 0.7), Math.sin(a) * s),
        s: 0.7 + Math.random() * 0.8,
        life: 1.2 + Math.random() * 0.8,
        color: new Color(colors[i % colors.length]!),
      });
    }
  }

  const ballY = () => (hole ? heightAt(hole.def, ball.x, ball.z) : 0) + BALL_R;

  // ---------------------------------------------------------------------------
  // Projection helpers
  // ---------------------------------------------------------------------------
  const tmpV = new Vector3();
  function screenOf(x: number, y: number, z: number): { x: number; y: number } {
    tmpV.set(x, y, z).project(camera);
    return { x: (tmpV.x * 0.5 + 0.5) * W, y: (-tmpV.y * 0.5 + 0.5) * H };
  }
  const ray = new Raycaster();
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const ndc = new Vector2();
  function groundAt(px: number, py: number, y: number): Vector3 | null {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -y;
    return ray.ray.intersectPlane(plane, new Vector3());
  }

  // ---------------------------------------------------------------------------
  // Input: drag back anywhere, release to putt.
  // ---------------------------------------------------------------------------
  session.startOnTap(window);
  onDrag(window, {
    start(x, y) {
      if (session.phase !== "playing" || mode !== "play" || phase !== "aim") return;
      aim.active = true;
      aim.x0 = x;
      aim.y0 = y;
      aim.power = 0;
      aim.band = -1;
    },
    move(x, y, dx, dy) {
      if (!aim.active) return;
      const len = Math.hypot(dx, dy);
      const maxPx = Math.max(130, Math.min(230, Math.min(W, H) * 0.42));
      aim.power = Math.max(0, Math.min(1, (len - DEAD_PX) / (maxPx - DEAD_PX)));
      if (len > DEAD_PX * 0.6) {
        // Opposite of the drag, measured on the green under the ball.
        const by = ballY();
        const b = screenOf(ball.x, by, ball.z);
        const k = 120 / len;
        const t = groundAt(b.x - dx * k, b.y - dy * k, by);
        if (t) aim.angle = Math.atan2(t.z - ball.z, t.x - ball.x);
      }
      const band = Math.floor(aim.power * 10);
      if (band !== aim.band && len > DEAD_PX) {
        if (aim.band >= 0) sfx.aimTick(aim.power);
        aim.band = band;
      }
      void x;
      void y;
    },
    end(_x, _y, cancelled) {
      if (!aim.active) return;
      aim.active = false;
      if (cancelled || phase !== "aim" || aim.power <= 0.015) return;
      release(aim.angle, aim.power);
    },
  });
  session.on("cancel", () => {
    aim.active = false;
  });
  session.on("insets", relayout);
  session.on("start", () => {
    mode = "play";
    strokes = START_STROKES;
    score = 0;
    sunkHoles = 0;
    aces = 0;
    idleStreak = 0;
    endSent = false;
    lastTemplate = null;
    hud.setMode("play");
    hud.setScore(0);
    hud.setStrokes(strokes);
    hud.setClock(null);
    setMood("idle");
    relayout();
    changeHole();
  });
  window.addEventListener("resize", resize);

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function physics(dt: number): void {
    if (!hole) return;
    let acc = Math.min(dt, 0.05);
    const ev = newEvents();
    while (acc > 1e-6) {
      const h = Math.min(STEP, acc);
      acc -= h;
      hole.t += h;
      if (phase === "swing" && swing) {
        swing.t += h;
        if (swing.t >= 0.09) {
          const s = swing;
          swing = null;
          launch(s.angle, s.power);
        }
      }
      if (phase !== "rolling") continue;
      // No roll lasts forever (a ball ping-ponging between two macarons): the clay soaks it up.
      if (phaseT > 10) {
        ball.vx = 0;
        ball.vz = 0;
        ballStopped();
        break;
      }
      const before = { x: ball.x, z: ball.z };
      ev.sunk = ev.water = false;
      const rolling = step(hole.course, ball, hole.t, roll, ev);
      // Roll the clay ball by the distance it travelled.
      const mx = ball.x - before.x;
      const mz = ball.z - before.z;
      const d = Math.hypot(mx, mz);
      if (d > 1e-6) {
        tmpQ.setFromAxisAngle(tmpAxis.set(mz / d, 0, -mx / d), d / BALL_R);
        ballQ.premultiply(tmpQ);
      }
      if (!rolling) {
        if (ev.sunk) startSink();
        else if (ev.water) startSplash();
        else ballStopped();
        break;
      }
    }
    if (ev.wall > 0.35 && plapCool <= 0) {
      sfx.plap(ev.wall);
      plapCool = 0.06;
    }
    if (ev.gate > 0.2) sfx.creak();
    if (ev.bumper > 0.2) {
      sfx.boing(ev.bumper);
      bumperHops.set(ev.bumperIndex, 0);
      if (mode === "play") session.feedback("impact");
    }
    if (ev.enteredSand) sfx.sand();
  }
  const tmpQ = new Quaternion();
  const tmpAxis = new Vector3();

  function startSink(): void {
    phase = "sinking";
    phaseT = 0;
    sinkFrom = { x: ball.x, z: ball.z };
  }
  let sinkFrom: V2 = { x: 0, z: 0 };

  function startSplash(): void {
    phase = "splash";
    phaseT = 0;
    ballHidden = true;
    sfx.splash();
    setMood("gasp");
    if (hole) burst(ball.x, heightAt(hole.def, ball.x, ball.z) + 0.05, ball.z, 16, [PAL.powder, PAL.cream, PAL.powderDeep], 2.2);
    if (mode === "play") {
      strokes = Math.max(0, strokes - 1);
      taken++;
      hud.setStrokes(strokes);
      const p = screenOf(ball.x, ballY() + 0.3, ball.z);
      hud.popup("splash! –1", p.x, p.y, "powder");
      session.feedback("fail");
    }
  }

  function ballStopped(): void {
    if (mode === "play" && strokes <= 0) {
      gameOver();
      return;
    }
    if (mood !== "idle") setMood("idle");
    beginAim();
  }

  function update(dt: number): void {
    session.tick(dt);
    time += dt;
    phaseT += dt;
    plapCool -= dt;
    hud.update(dt);
    physics(dt);
    if (!hole) return;

    if (phase === "sinking") {
      const t = Math.min(1, phaseT / 0.32);
      ball.x = sinkFrom.x + (hole.def.cup.x - sinkFrom.x) * t;
      ball.z = sinkFrom.z + (hole.def.cup.z - sinkFrom.z) * t;
      if (t >= 1) {
        phase = "cheer";
        phaseT = 0;
        ballHidden = true;
        sinkRewards();
      }
    } else if (phase === "cheer" && phaseT > 1.5) {
      changeHole();
    } else if (phase === "splash" && phaseT > 0.9) {
      if (mode === "play" && strokes <= 0) gameOver();
      else {
        setBall(lastFrom.x, lastFrom.z);
        ballHidden = false;
        popBall = 0;
        sfx.pop();
        setMood("idle");
        beginAim();
      }
    } else if (phase === "over") {
      if (!endSent && phaseT > 0.55) {
        endSent = true;
        const r = session.end(score, { outcome: "lose", stats: { holes: sunkHoles, aces } });
        hud.setMode("over");
        if (session.standalone) hud.showOver(score, r.best, r.isBest, sunkHoles);
        hud.setBest(r.best);
      }
    }

    // Shot clock: a run can never idle forever.
    if (mode === "play" && phase === "aim" && session.phase === "playing") {
      shotClock += dt;
      const limit = idleStreak > 0 ? SHOT_CLOCK_IDLE : SHOT_CLOCK;
      const left = Math.ceil(limit - shotClock);
      hud.setClock(left <= 5 ? Math.max(0, left) : null);
      if (shotClock >= limit) {
        if (aim.active && aim.power > 0.05) {
          aim.active = false;
          release(aim.angle, aim.power);
        } else burnStroke();
        hud.setClock(null);
      }
    } else if (mode === "play") hud.setClock(null);

    // Attract demo: plan in small slices, line up, putt.
    if ((mode === "attract" || AUTOPLAY) && demo && phase === "aim") {
      if (!demo.planner.done) demo.planner.work(2.2);
      const best = demo.planner.best;
      if (best) {
        const lead = demo.releaseAt - hole.t;
        aim.angle = best.angle + (lead > 0.7 ? Math.sin(time * 3) * 0.08 * Math.min(1, lead - 0.7) : 0);
        aim.power = best.power * Math.min(1, Math.max(0.15, 1.15 - lead / 1.4));
        if (hole.t >= demo.releaseAt - 0.09) {
          const b = demo.planner.best!;
          demo = null;
          const miss = AUTOPLAY && mode === "play" ? 1 : 0;
          release(b.angle + (Math.random() - 0.5) * 0.17 * miss, b.power * (1 + (Math.random() - 0.5) * 0.3 * miss));
        }
      }
    }

    // Stop-motion clock: decorative things move only on these steps.
    stepClock += dt;
    while (stepClock >= 1 / FPS) {
      stepClock -= 1 / FPS;
      stopMotionStep();
    }

    updateCamera(dt);
    placeBall();
    placeAim();
  }

  function stopMotionStep(): void {
    stepN++;
    // Boiling clay: the hand-pressed surface detail shifts a hair between frames, like re-posed plasticine.
    if (!reduced) {
      kit.thumb.offset.set(jitter.range(-1, 1) / 256, jitter.range(-1, 1) / 256);
      kit.stipple.offset.set(jitter.range(-1, 1) / 512, jitter.range(-1, 1) / 512);
    }
    moodStep++;
    if (mood === "cheer" && moodStep > 22) setMood("idle");
    if (mood === "gasp" && moodStep > 14) setMood("idle");
    stepTransition();
    if (popBall >= 0) {
      ballScale = POP[Math.min(POP.length - 1, popBall)]!;
      popBall = popBall + 1 >= POP.length ? -1 : popBall + 1;
    }
    const look = new Vector3(ball.x, ballY(), ball.z);
    if (phase === "transition" && hole) look.set(hole.def.tee.x, 0, hole.def.tee.z);
    for (const c of critters) poseCritter(c, jitter, look, mood, moodStep, reduced);

    const v = hole?.view;
    if (v && hole) {
      if (v.blades) {
        v.blades.rotation.z = bladeAngle(hole.def, hole.t);
        v.blades.position.x = jitter.range(-0.004, 0.004);
      }
      // The flag is a stiff clay pennant re-posed every frame.
      const wave = Math.sin(stepN * 0.9) * 0.22 + jitter.range(-0.06, 0.06) * (reduced ? 0.3 : 1);
      v.pennant.rotation.y = wave;
      v.pennant.scale.x = 1 + Math.sin(stepN * 1.3) * 0.05;
      const flag = v.pennant.parent!;
      if (flagHop >= 0) {
        const hop = [0.1, 0.24, 0.3, 0.24, 0.1, -0.02, 0];
        flag.position.y = heightAt(hole.def, hole.def.cup.x, hole.def.cup.z) + (hop[flagHop] ?? 0) * (reduced ? 0.4 : 1);
        flagHop = flagHop + 1 >= hop.length ? -1 : flagHop + 1;
      }
      for (const p of v.puppets) {
        if (p.kind === "sway") {
          p.obj.rotation.z = Math.sin(stepN * 0.35 + p.seed) * 0.05 * (reduced ? 0.4 : 1) + jitter.range(-0.015, 0.015);
          p.obj.rotation.y = p.base + jitter.range(-0.02, 0.02);
        } else if (p.kind === "ripple") {
          const cyc = ((stepN / 30 + p.seed) % 1 + 1) % 1;
          const s = p.base * (0.25 + cyc * 1.1);
          p.obj.scale.set(s, 1, s);
          p.obj.visible = cyc < 0.85;
        }
      }
      const SQ = [0.7, 1.15, 0.94, 1];
      for (const [i, n] of bumperHops) {
        const m = v.bumpers[i];
        if (!m) continue;
        const k = SQ[n] ?? 1;
        m.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
        if (n + 1 >= SQ.length) bumperHops.delete(i);
        else bumperHops.set(i, n + 1);
      }
    }

    // Crumbs: posed at 12 fps.
    const dt = 1 / FPS;
    crumbs = crumbs.filter((c) => (c.life -= dt) > 0);
    for (const c of crumbs) {
      c.v.y -= 7 * dt;
      c.p.addScaledVector(c.v, dt);
      const floorY = (hole ? heightAt(hole.def, c.p.x, c.p.z) : 0) + 0.03;
      if (c.p.y < floorY) {
        c.p.y = floorY;
        c.v.y *= -0.35;
        c.v.x *= 0.6;
        c.v.z *= 0.6;
      }
    }
    crumbMesh.count = crumbs.length;
    crumbs.forEach((c, i) => {
      dummy.position.copy(c.p);
      const s = c.s * Math.min(1, c.life * 2);
      dummy.scale.set(s, s * 0.8, s);
      dummy.rotation.set(c.life * 3, c.life * 2, 0);
      dummy.updateMatrix();
      crumbMesh.setMatrixAt(i, dummy.matrix);
      crumbMesh.setColorAt(i, c.color);
    });
    crumbMesh.instanceMatrix.needsUpdate = true;
    if (crumbMesh.instanceColor) crumbMesh.instanceColor.needsUpdate = true;

    hud.step(jitter, layoutFor());
    if (mode === "attract") {
      const host = critters[0]!;
      const p = screenOf(host.root.position.x, host.root.position.y + host.top, host.root.position.z);
      hud.setBubbleAnchor(p.x, p.y, layoutFor());
    }
  }

  function placeBall(): void {
    if (!hole) return;
    let y = ballY();
    if (phase === "sinking") y -= Math.min(1, phaseT / 0.32) ** 2 * 0.34;
    ballMesh.position.set(ball.x, y, ball.z);
    ballMesh.quaternion.copy(ballQ);
    ballMesh.scale.setScalar(ballScale);
    ballMesh.visible = !ballHidden;
    const gy = heightAt(hole.def, ball.x, ball.z) + 0.008;
    ballShadow.position.set(ball.x + 0.03, gy, ball.z + 0.03);
    ballShadow.visible = !ballHidden && phase !== "sinking";
  }

  function placeAim(): void {
    const showDemo = (mode === "attract" || AUTOPLAY) && phase === "aim" && !!demo?.planner.best;
    const show = (mode === "play" && aim.active && aim.power > 0.01) || showDemo || phase === "swing";
    putter.visible = show;
    const power = phase === "swing" && swing ? swing.power : aim.power;
    const angle = phase === "swing" && swing ? swing.angle : aim.angle;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const by = ballY();
    if (show) {
      const pull = phase === "swing" && swing ? (1 - Math.min(1, swing.t / 0.09)) * (0.18 + power * 0.5) : 0.18 + power * 0.5;
      putter.position.set(ball.x - dx * (pull + 0.1), by - BALL_R, ball.z - dz * (pull + 0.1));
      putter.rotation.y = -angle + Math.PI / 2;
    }
    const beadsOn = show && phase !== "swing";
    const n = beadsOn ? 2 + Math.round(power * 9) : 0;
    const mat = beadMats[power < 0.35 ? 0 : power < 0.6 ? 1 : power < 0.85 ? 2 : 3]!;
    beads.forEach((b, i) => {
      b.visible = i < n;
      if (!b.visible || !hole) return;
      const d = 0.3 + i * (0.2 + power * 0.08);
      const x = ball.x + dx * d;
      const z = ball.z + dz * d;
      b.material = mat;
      const bob = (stepN + i) % 4 < 2 ? 0 : 0.012;
      b.position.set(x, heightAt(hole.def, x, z) + 0.05 + bob, z);
      const s = 1 - i * 0.045;
      b.scale.set(s, s * 0.85, s);
    });
  }

  // Camera: fit the hole (and its focus points) into the free part of the screen.
  const fitPos = new Vector3();
  function fitTo(points: Vector3[], yaw: number, elev: number, target: Vector3, rect: [number, number, number, number]): { dist: number; offX: number; offY: number } {
    let dist = rig.dist;
    camera.clearViewOffset();
    const dir = new Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;
    for (let it = 0; it < 6; it++) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      minX = minY = Infinity;
      maxX = maxY = -Infinity;
      for (const p of points) {
        fitPos.copy(p).project(camera);
        const sx = (fitPos.x * 0.5 + 0.5) * W;
        const sy = (-fitPos.y * 0.5 + 0.5) * H;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
      const s = Math.max((maxX - minX) / (rect[2] - rect[0]), (maxY - minY) / (rect[3] - rect[1]));
      dist *= 0.35 + 0.65 * s;
    }
    return { dist, offX: (minX + maxX) / 2 - (rect[0] + rect[2]) / 2, offY: (minY + maxY) / 2 - (rect[1] + rect[3]) / 2 };
  }

  const target = new Vector3();
  function updateCamera(dt: number): void {
    if (!hole) return;
    const def = hole.def;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of def.outline) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    let yaw = 0;
    let elev = 0.98;
    let rect: [number, number, number, number];
    if (mode === "attract") {
      const amp = reduced ? 0.08 : 0.28;
      yaw = Math.sin(time * 0.15) * amp;
      elev = 0.98 + Math.sin(time * 0.11) * (reduced ? 0.02 : 0.07);
      const s = session.preview();
      rect = [s.left + 6, s.top + 126, W - s.right - 4, H - s.bottom + 22];
    } else {
      const s = session.play();
      rect = [s.left + 10, s.top + 70, W - s.right - 10, H - s.bottom - 12];
    }
    const fit = fitTo(hole.view.focus, yaw, elev, target, rect);
    const k = rig.init ? 1 : 0;
    const lam = 4;
    rig.yaw = k ? damp(rig.yaw, yaw, lam, dt) : yaw;
    rig.elev = k ? damp(rig.elev, elev, lam, dt) : elev;
    rig.dist = k ? damp(rig.dist, fit.dist, lam, dt) : fit.dist;
    rig.offX = k ? damp(rig.offX, fit.offX, lam, dt) : fit.offX;
    rig.offY = k ? damp(rig.offY, fit.offY, lam, dt) : fit.offY;
    rig.tx = k ? damp(rig.tx, target.x, lam, dt) : target.x;
    rig.tz = k ? damp(rig.tz, target.z, lam, dt) : target.z;
    rig.init = true;
    const dir = new Vector3(Math.sin(rig.yaw) * Math.cos(rig.elev), Math.sin(rig.elev), Math.cos(rig.yaw) * Math.cos(rig.elev));
    const t = new Vector3(rig.tx, 0, rig.tz);
    camera.position.copy(t).addScaledVector(dir, rig.dist);
    camera.lookAt(t);
    camera.setViewOffset(W, H, rig.offX, rig.offY, W, H);
    camera.updateProjectionMatrix();
    fog.near = rig.dist * 0.95;
    fog.far = rig.dist * 2.4;
    // Light and shadow frustum follow the hole.
    key.target.position.copy(t);
    key.position.set(t.x - 5, 10, t.z + 4.5);
    fill.target.position.copy(t);
    fill.position.set(t.x + 6, 5, t.z - 3);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  resize();
  hud.setBest(session.best);
  hud.setMode("attract");
  changeHole(true);
  // Warm every shader variant (sand, water, crumbs) before ready().
  const warm = new Group();
  const warmDef = buildHole("sandglass", createRng(3), 0);
  warmDef.water.push({ ...warmDef.sand[0]!, x: 0, z: 0 });
  const warmView = buildHoleView(warmDef, kit, createRng(4), 1);
  warm.add(warmView.group);
  warm.position.set(0, -50, 0);
  scene.add(warm);
  crumbMesh.count = 1;
  crumbMesh.setMatrixAt(0, new Object3D().matrix);
  crumbMesh.setColorAt(0, new Color(PAL.cream));
  update(0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  scene.remove(warm);
  warmView.dispose();
  crumbMesh.count = 0;

  let frames = 0;
  let slowFor = 0;
  let watchAt = 3;
  tc.loop((dt) => {
    update(Math.min(dt, 0.1));
    renderer.render(scene, camera);
    if (++frames === 2) session.ready();
    // Adaptive sharpness: sustained frames slower than ~45 fps step the pixel ratio down.
    if (time > watchAt && dprCap > 1 && dt < 0.25) {
      slowFor = dt > 1 / 45 ? slowFor + dt : Math.max(0, slowFor - dt * 0.5);
      if (slowFor > 1.5) {
        dprCap = dprCap > 1.5 ? 1.5 : 1;
        slowFor = 0;
        watchAt = time + 2;
        resize();
      }
    }
  });
}

void main();

