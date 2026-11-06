import { createAudio, createMusic } from "@thumbcade-games/kit/audio";
import { clamp, damp, lerp, Spring } from "@thumbcade-games/kit/ease";
import { onKeys, onPress } from "@thumbcade-games/kit/input";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BoxGeometry, type BufferGeometry, type Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Vector3 } from "three";
import {
  berryGeometry,
  decorModels,
  homeGeometry,
  plankGeometry,
  PLANK_TOP,
  rippleGeometry,
  stoneGeometry,
  STONE_TOP,
  waterGeometry,
  type DecorKind,
} from "./models.ts";
import { DX, DZ, keyOf, PathGen, type Cell, type Dir } from "./path.ts";
import { createFox } from "./toybox/fox.ts";
import { loadRubik } from "./toybox/fonts.ts";
import { createHud } from "./toybox/hud.ts";
import { P } from "./toybox/palette.ts";
import { Puffs } from "./toybox/puffs.ts";
import { flourish, S, streak } from "./toybox/sfx.ts";
import { createSign } from "./toybox/sign.ts";
import { createStage, SCREEN_RIGHT, SCREEN_UP } from "./toybox/stage.ts";
import { col } from "./toybox/vox.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
/** Path generated this far ahead of the fox (progress units = cells). */
const AHEAD = 30;
/** Stones drop into place once they are this close (so the path assembles at the top of the screen). */
const REVEAL = 21;
/** Path and props this far behind the fox are recycled (well off the bottom of the screen). */
const BEHIND = 14;
const BERRY_POINTS = 3;
const speedAt = (t: number) => lerp(3.0, 6.6, clamp(t / 75)) + Math.max(0, t - 75) * 0.04;
const ATTRACT_SPEED = 3.3;

interface Tile {
  c: Cell;
  kind: "stone" | "moss" | "plank";
  pool: { mesh: InstancedMesh; release(slot: number): void } | null;
  slot: number;
  tint: Color;
  top: number;
  yaw: number;
  jx: number;
  jz: number;
  y: number;
  vy: number;
  wait: number;
  /** 0 waiting, 1 dropping, 2 landed. */
  state: 0 | 1 | 2;
  bounced: boolean;
  berry: Berry | null;
}

interface Berry {
  mesh: Mesh;
  tile: Tile;
  taken: number;
  phase: number;
}

interface Prop {
  mesh: Mesh;
  p: number;
  keys: number[];
  grow: Spring;
  y0: number;
}

interface Ripple {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  dur: number;
  s0: number;
  s1: number;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "foxbend" }), loadRubik()]);
  const reduced = session.reducedMotion;
  const stage = createStage({ viewW: 7.6, fog: [3, 19], shadowExtent: 14 });
  const { scene } = stage;
  const audio = createAudio();
  const hud = createHud();
  const music = createMusic(audio, {
    bpm: 92,
    wave: "sine",
    volume: 0.03,
    steps: [72, null, 79, null, 76, null, 74, 76, 72, null, 69, null, 67, null, null, null, 72, null, 79, null, 81, null, 79, 76, 74, null, 72, null, null, null, null, null],
  });

  // ---------------------------------------------------------------------------
  // Scene pieces
  // ---------------------------------------------------------------------------
  // Stones live in instanced pools: one set on the ground (casts shadows), one in the air while they drop
  // in (no shadows, so incoming stones don't paint stray shapes on the pond).
  const instMat = new MeshLambertMaterial({ vertexColors: true });
  const zero = new Matrix4().makeScale(0, 0, 0);
  const white = col("#FFFFFF");
  class Pool {
    readonly mesh: InstancedMesh;
    private readonly free: number[];
    constructor(geo: BufferGeometry, cap: number, shadows: boolean) {
      this.mesh = new InstancedMesh(geo, instMat, cap);
      this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.castShadow = shadows;
      this.mesh.receiveShadow = true;
      for (let i = 0; i < cap; i++) {
        this.mesh.setMatrixAt(i, zero);
        this.mesh.setColorAt(i, white);
      }
      this.free = Array.from({ length: cap }, (_, i) => cap - 1 - i);
      scene.add(this.mesh);
    }
    alloc(): number | undefined {
      return this.free.pop();
    }
    release(slot: number) {
      this.mesh.setMatrixAt(slot, zero);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.free.push(slot);
    }
  }
  const stoneGeo = stoneGeometry(false);
  const mossGeo = stoneGeometry(true);
  const plankGeo = plankGeometry();
  const ground = { stone: new Pool(stoneGeo, 220, true), moss: new Pool(mossGeo, 110, true), plank: new Pool(plankGeo, 150, true) };
  const air = { stone: new Pool(stoneGeo, 40, false), moss: new Pool(mossGeo, 24, false), plank: new Pool(plankGeo, 30, false) };
  type Kind = keyof typeof ground;

  const water = new Mesh(waterGeometry(), new MeshLambertMaterial({ vertexColors: true }));
  water.receiveShadow = true;
  scene.add(water);

  // Sparkles: little flat glints that blink on the pond.
  const GLINTS = 34;
  const glints = new InstancedMesh(new BoxGeometry(1, 0.01, 1), new MeshBasicMaterial({ color: col(P.foam) }), GLINTS);
  glints.frustumCulled = false;
  glints.instanceMatrix.setUsage(DynamicDrawUsage);
  const glint = Array.from({ length: GLINTS }, () => ({ x: 0, z: 0, ph: Math.random() * 10, sp: 0.5 + Math.random() * 0.6, s: 0.2 + Math.random() * 0.25 }));
  scene.add(glints);

  const rippleGeo = rippleGeometry();
  const ripples: Ripple[] = Array.from({ length: 12 }, () => {
    const mat = new MeshBasicMaterial({ color: col(P.foam), transparent: true, opacity: 0, depthWrite: false });
    const mesh = new Mesh(rippleGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat, t: 1, dur: 1, s0: 1, s1: 2 };
  });
  let rippleNext = 0;
  function ripple(x: number, z: number, s0: number, s1: number, dur = 0.9, strength = 0.85) {
    const r = ripples[rippleNext]!;
    rippleNext = (rippleNext + 1) % ripples.length;
    r.t = 0;
    r.dur = dur;
    r.s0 = s0;
    r.s1 = s1;
    r.mesh.position.set(x, 0.012, z);
    r.mesh.visible = true;
    r.mat.opacity = strength;
    r.mesh.userData.strength = strength;
  }

  const puffs = new Puffs(260);
  scene.add(puffs.mesh);

  const berryGeo = berryGeometry();
  const models = decorModels();
  const home = new Mesh(homeGeometry(), stage.vox);
  home.castShadow = true;
  home.receiveShadow = true;
  scene.add(home);

  const fox = createFox(stage.vox, 0.06);
  fox.root.rotation.order = "YXZ";
  scene.add(fox.root);

  const sign = createSign(stage.vox, "Foxbend");
  stage.ui.scene.add(sign.group);

  // ---------------------------------------------------------------------------
  // World state
  // ---------------------------------------------------------------------------
  let rng: Rng = createRng(session.ctx.seed);
  let gen!: PathGen;
  const tiles = new Map<number, Tile>();
  const dropping: Tile[] = [];
  const berries: Berry[] = [];
  const props: Prop[] = [];
  const propCells = new Set<number>();
  let decorDone = 0;
  let instant = false;

  let mode: "attract" | "play" = "attract";
  let time = 0;
  let runT = 0;
  let fx = 1;
  let fz = 3.4;
  let fy = STONE_TOP;
  let fvy = 0;
  let dropIn = false;
  let dir: Dir = 1;
  let foxSeg = 0;
  let falling = false;
  let fallT = 0;
  let splashed = false;
  let swimT = 0;
  let lastSwimRipple = 0;
  let endSent = false;
  let lastCell = -1;
  let passed = 0;
  let picked = 0;
  let score = 0;
  let berryStreak = 0;
  let lastBerryT = -9;
  let trot = 0;
  let aiErr = 0;
  let attractT = 0;
  let overT = 0;
  let lastPlop = 0;
  let lastPrompt: string | null = "";
  let turnSnap: { x: number; z: number; dir: Dir; seg: number; t: number } | null = null;
  const yaw = new Spring(-Math.PI, 340, 26);
  const hop = new Spring(0, 260, 14);
  const lean = new Spring(0, 200, 14);
  let camF = 0;
  let camLat = 0;
  const focus = new Vector3();

  const mtx = new Matrix4();
  const q = new Quaternion();
  const eul = new Euler();
  const pos = new Vector3();
  const scl = new Vector3();

  function placeTile(t: Tile) {
    if (!t.pool) return;
    eul.set(0, t.yaw, 0);
    q.setFromEuler(eul);
    pos.set(t.c.i + 0.5 + t.jx, t.y, t.c.j + 0.5 + t.jz);
    scl.set(1, 1, 1);
    mtx.compose(pos, q, scl);
    t.pool.mesh.setMatrixAt(t.slot, mtx);
    t.pool.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Moves a tile into a pool (ground or air), carrying its tint along. */
  function seat(t: Tile, pools: Record<Kind, Pool>) {
    if (t.pool) t.pool.release(t.slot);
    t.pool = null;
    let pool = pools[t.kind];
    let slot = pool.alloc();
    if (slot === undefined && pools === air) {
      pool = ground[t.kind];
      slot = pool.alloc();
    }
    if (slot === undefined) return;
    t.pool = pool;
    t.slot = slot;
    pool.mesh.setColorAt(slot, t.tint);
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    placeTile(t);
  }

  function onCell(c: Cell) {
    const kind: Kind = c.narrow ? "plank" : rng() < 0.3 ? "moss" : "stone";
    const top = c.narrow ? PLANK_TOP : STONE_TOP;
    // Stones sit a little off-grid and askew, like someone actually placed them.
    const yawv = c.narrow ? (c.dir === 0 ? Math.PI / 2 : 0) : rng.int(0, 3) * (Math.PI / 2) + rng.range(-0.12, 0.12);
    const jx = c.narrow ? 0 : rng.range(-0.05, 0.05);
    const jz = c.narrow ? 0 : rng.range(-0.05, 0.05);
    // Warm/cool variation so the path doesn't look stamped.
    const v = rng.range(-1, 1);
    const tint = col("#FFFFFF").clone().setRGB(1 - Math.max(0, v) * 0.05, 1 - Math.abs(v) * 0.03, 1 - Math.max(0, -v) * 0.06);
    const t: Tile = { c, kind, pool: null, slot: -1, tint, top, yaw: yawv, jx, jz, y: top, vy: 0, wait: 0, state: 2, bounced: false, berry: null };
    if (!instant || c.p > -(fx + fz) + REVEAL) {
      t.state = 0;
      t.wait = c.order * 0.07 + rng.range(0, 0.06);
      t.y = top + 4.5;
      dropping.push(t);
    } else seat(t, ground);
    tiles.set(keyOf(c.i, c.j), t);
    if (c.berry) {
      const mesh2 = new Mesh(berryGeo, stage.vox);
      mesh2.castShadow = true;
      mesh2.visible = false;
      const b: Berry = { mesh: mesh2, tile: t, taken: -1, phase: rng() * 6 };
      t.berry = b;
      berries.push(b);
      scene.add(mesh2);
    }
  }

  function freeTile(key: number, t: Tile) {
    if (t.pool) t.pool.release(t.slot);
    t.pool = null;
    tiles.delete(key);
    if (t.berry) removeBerry(t.berry);
  }

  function removeBerry(b: Berry) {
    scene.remove(b.mesh);
    b.tile.berry = null;
    const i = berries.indexOf(b);
    if (i >= 0) berries.splice(i, 1);
  }

  // Props sit beside the path, never on it or touching it, and only where the path can't come later.
  function decorate() {
    const blocks = gen.blocks;
    while (decorDone < blocks.length && blocks[decorDone]!.p <= gen.front - 4) {
      const b = blocks[decorDone++]!;
      for (const side of [-1, 1]) {
        if (rng() > 0.55) continue;
        const kind: DecorKind = rng.pick(["lily", "lily", "lilyFlower", "reeds", "rock", "hedge", "tree", "lily"] as const);
        const m = models[kind];
        const k = side * rng.int(m.size === 2 ? 3 : 2, 4);
        const i0 = b.x + (side > 0 ? b.w - 1 : 0) + k;
        const j0 = b.z - k;
        const cells: number[] = [];
        let ok = true;
        for (let a = -1; a <= m.size && ok; a++)
          for (let c = -1; c <= m.size && ok; c++) {
            const key = keyOf(i0 + a, j0 + c);
            if (tiles.has(key) || propCells.has(key)) ok = false;
          }
        if (!ok) continue;
        for (let a = 0; a < m.size; a++) for (let c = 0; c < m.size; c++) cells.push(keyOf(i0 + a, j0 + c));
        cells.forEach((c) => propCells.add(c));
        const mesh = new Mesh(m.geo, stage.vox);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const off = m.size / 2;
        mesh.position.set(i0 + off, 0, j0 + off);
        mesh.rotation.y = m.size === 1 ? rng.int(0, 3) * (Math.PI / 2) : rng.chance(0.5) ? 0 : Math.PI / 2;
        const grow = new Spring(instant && -(i0 + j0) <= -(fx + fz) + REVEAL ? 1 : 0, 150, 11);
        mesh.scale.setScalar(Math.max(0.001, grow.value));
        props.push({ mesh, p: -(i0 + j0), keys: cells, grow, y0: 0 });
        scene.add(mesh);
      }
    }
  }

  function extendTo(p: number) {
    while (gen.front < p) {
      gen.extend();
      decorate();
    }
  }

  function clearWorld() {
    for (const [key, t] of [...tiles]) freeTile(key, t);
    dropping.length = 0;
    for (const b of [...berries]) removeBerry(b);
    for (const pr of props) scene.remove(pr.mesh);
    props.length = 0;
    propCells.clear();
    puffs.clear();
    for (const r of ripples) {
      r.t = 1;
      r.mesh.visible = false;
    }
  }

  function resetWorld(m: "attract" | "play") {
    mode = m;
    clearWorld();
    // The path has its own seeded stream so a run's layout never depends on frame timing.
    const seed = (session.ctx.seed + session.runs * 7919 + (m === "attract" ? Math.floor(time * 13) : 0)) >>> 0;
    rng = createRng(seed ^ 0x5bd1e995);
    gen = new PathGen(createRng(seed), onCell);
    decorDone = 0;
    home.position.set(1, 0, 5.55);
    for (let a = -1; a <= 2; a++) for (let c = 4; c <= 7; c++) propCells.add(keyOf(a, c));
    fx = 1;
    fz = 3.4;
    instant = true;
    extendTo(AHEAD);
    instant = false;
    fx = 1;
    fz = 3.4;
    dropIn = m === "play";
    fy = dropIn ? STONE_TOP + 1.6 : STONE_TOP;
    fvy = 0;
    dir = 1;
    foxSeg = 0;
    falling = false;
    fallT = 0;
    splashed = false;
    swimT = 0;
    lastSwimRipple = 0;
    endSent = false;
    lastCell = keyOf(1, 3);
    passed = 0;
    picked = 0;
    score = 0;
    berryStreak = 0;
    runT = 0;
    attractT = 0;
    overT = 0;
    turnSnap = null;
    yaw.snap(-Math.PI);
    hop.snap(0);
    lean.snap(0);
    fox.root.visible = true;
    fox.root.rotation.set(0, -Math.PI, 0);
    fox.root.scale.setScalar(0.06);
    pickAiError();
    const f = fx * SCREEN_UP.x + fz * SCREEN_UP.z;
    camF = f + aheadDist();
    camLat = fx * SCREEN_RIGHT.x + fz * SCREEN_RIGHT.z;
    hud.setScore(0);
    hud.setSub(null);
  }

  function aheadDist() {
    // Keep the fox about two thirds down the screen so the path ahead is in view.
    return (stage.height * 0.16) / (stage.ppu * 0.577);
  }

  function pickAiError() {
    const next = gen.segs[foxSeg + 1];
    const w = next?.w ?? 2;
    aiErr = (rng() - 0.5) * 0.5 * w;
    // The demo fox gets sloppier the longer it runs, so the attract loop shows a splash now and then.
    if (mode === "attract" && attractT > 18 && rng() < 0.22) aiErr = (rng() < 0.5 ? -1 : 1) * (w * 0.5 + 0.5);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function turn(byPlayer: boolean) {
    if (falling) return;
    turnSnap = byPlayer ? { x: fx, z: fz, dir, seg: foxSeg, t: time } : null;
    dir = dir === 0 ? 1 : 0;
    foxSeg++;
    yaw.target = dir === 0 ? -Math.PI / 2 : -Math.PI;
    hop.velocity += 2.6;
    lean.velocity += dir === 0 ? -6 : 6;
    if (mode === "play") {
      audio.play(S.tok, { pitch: dir === 0 ? 0 : 3 });
      session.feedback("tap");
    }
    puffs.emit(fx, fy + 0.02, fz, { count: reduced ? 3 : 6, colors: [P.cream, P.stone], speed: [0.4, 1.2], up: [0.6, 1.4], size: [0.05, 0.09], life: [0.25, 0.45], gravity: 6 });
    pickAiError();
  }

  function startFall() {
    falling = true;
    fallT = 0;
    fvy = 1.2;
    if (mode === "play") {
      audio.play(S.swish);
      session.feedback("impact");
    }
  }

  function splash() {
    splashed = true;
    const n = reduced ? 14 : 26;
    puffs.emit(fx, 0.05, fz, { count: n, colors: [P.foam, P.sky, P.foam, P.water], speed: [0.6, 2.4], up: [2.2, 4.4], size: [0.06, 0.14], life: [0.5, 0.9], gravity: 11, floor: 0 });
    ripple(fx, fz, 0.6, 3.2, 1.2, 0.95);
    ripple(fx, fz, 0.3, 2.0, 0.9, 0.7);
    if (mode === "play") {
      audio.play(S.sploosh);
      window.setTimeout(() => audio.play(S.sad), 180);
    }
  }

  function grabBerry(b: Berry) {
    b.taken = 0;
    picked++;
    berryStreak = time - lastBerryT < 4 ? berryStreak + 1 : 0;
    lastBerryT = time;
    const bx = b.tile.c.i + 0.5;
    const bz = b.tile.c.j + 0.5;
    puffs.emit(bx, b.tile.top + 0.25, bz, { count: reduced ? 6 : 12, colors: [P.berry, P.berryDeep, P.leaf, P.blossom], speed: [0.8, 2], up: [1.5, 3], size: [0.05, 0.1], life: [0.35, 0.6], gravity: 9 });
    if (mode === "play") {
      streak(audio, berryStreak, 76);
      session.feedback("success");
      const s = stage.toScreen(pos.set(bx, b.tile.top + 0.6, bz));
      hud.toast(`+${BERRY_POINTS}`, s.x, s.y);
      hud.setSub(`× ${picked}`, { top: "#F7A3B8", left: P.berry, right: P.berryDeep });
      hud.bump();
    }
  }

  // Input: a tap (release) starts a run; during a run each press turns the fox.
  session.startOnTap(window);
  const press = () => {
    if (session.phase === "playing" && mode === "play" && !falling) turn(true);
  };
  onPress(window, press);
  onKeys({ action: press, left: press, right: press });
  // The feed claimed the touch (a vertical pan): undo a turn that press made a moment ago.
  session.on("cancel", () => {
    if (!turnSnap || time - turnSnap.t > 0.3 || falling) return;
    const back = time - turnSnap.t;
    const v = speedAt(runT);
    dir = turnSnap.dir;
    foxSeg = turnSnap.seg;
    fx = turnSnap.x + DX[dir] * v * back;
    fz = turnSnap.z + DZ[dir] * v * back;
    yaw.target = dir === 0 ? -Math.PI / 2 : -Math.PI;
    turnSnap = null;
  });
  session.on("start", () => {
    resetWorld("play");
    audio.play(S.hop);
    music.start();
  });
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (session.phase === "playing") music.start();
  });

  function layout() {
    const s = session.safe();
    hud.layout(s);
    const pv = session.preview();
    const sw = stage.width - pv.left - pv.right;
    sign.layout(pv.left + 12, pv.top + 10, Math.min(205, sw * 0.68), stage.ui.place);
    hud.placeBest(sign.left + 6, sign.bottom + 6);
  }
  session.on("insets", layout);
  stage.onResize(layout);

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function updateFox(dt: number) {
    const playing = mode === "play" && session.phase === "playing";
    const v = mode === "play" ? speedAt(runT) : ATTRACT_SPEED + Math.min(1.6, attractT * 0.03);
    if (falling) {
      fallT += dt;
      const k = Math.max(0, 1 - fallT * 1.6);
      fx += DX[dir] * v * dt * k;
      fz += DZ[dir] * v * dt * k;
      if (!splashed) {
        fvy -= 16 * dt;
        fy += fvy * dt;
        fox.root.rotation.x = Math.min(1.3, fallT * 4);
        if (fy < 0.05) {
          splash();
          // Turn to face the camera while treading water.
          const want = Math.PI / 4;
          yaw.target = want + Math.round((yaw.value - want) / (Math.PI * 2)) * Math.PI * 2;
        }
      } else {
        // Treading water: just the head and ears above the surface, bobbing.
        swimT += dt;
        fy = damp(fy, -0.36 + Math.sin(swimT * 3.2) * 0.035, 5, dt);
        fox.root.rotation.x = damp(fox.root.rotation.x, 0, 6, dt);
        if (swimT - lastSwimRipple > 0.75) {
          lastSwimRipple = swimT;
          ripple(fx, fz, 0.5, 1.4, 0.9, 0.45);
        }
      }
      if (mode === "play" && !endSent && fallT > 0.55) {
        endSent = true;
        music.stop();
        const prev = session.best;
        const r = session.end(score, { outcome: "lose", stats: { stones: passed, berries: picked } });
        if (r.isBest && prev !== null) flourish(audio, 72);
        hud.setBest(session.best);
      }
      return;
    }
    // Drop onto the start stone at the beginning of a run.
    if (dropIn) {
      fvy -= 22 * dt;
      fy = Math.max(STONE_TOP, fy + fvy * dt);
      if (fy === STONE_TOP) {
        dropIn = false;
        fvy = 0;
        hop.velocity -= 2;
        puffs.emit(fx, STONE_TOP, fz, { count: 8, colors: [P.cream, P.stone], speed: [0.5, 1.4], up: [0.5, 1.2], size: [0.05, 0.09], life: [0.3, 0.5], gravity: 6 });
        if (playing) audio.play(S.tokLow);
      }
      return;
    }
    if (playing) runT += dt;
    fx += DX[dir] * v * dt;
    fz += DZ[dir] * v * dt;
    trot += dt * (8 + v * 2.2);

    // Attract: the demo fox turns by itself near the middle of each bend's window.
    if (mode === "attract") {
      const next = gen.segs[foxSeg + 1];
      if (next) {
        const along = dir === 1 ? fz : fx;
        if (along <= next.lo + next.w * 0.5 + aiErr) turn(false);
      }
    }

    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const key = keyOf(i, j);
    if (key !== lastCell) {
      lastCell = key;
      const t = tiles.get(key);
      if (!t) {
        startFall();
        return;
      }
      if (playing) passed++;
      if (t.berry && t.berry.taken < 0) grabBerry(t.berry);
      if (playing) {
        score = passed + picked * BERRY_POINTS;
        hud.setScore(score);
      }
      fy = t.top;
    }
  }

  function update(dt: number) {
    time += dt;
    session.tick(dt);
    if (mode === "attract") attractT += dt;
    updateFox(dt);

    // Extend ahead and recycle behind.
    const fp = -(fx + fz);
    extendTo(fp + AHEAD);
    for (const [key, t] of tiles) if (t.c.p < fp - BEHIND) freeTile(key, t);
    for (let k = props.length - 1; k >= 0; k--) {
      const pr = props[k]!;
      if (pr.p < fp - BEHIND - 2) {
        scene.remove(pr.mesh);
        pr.keys.forEach((c) => propCells.delete(c));
        props.splice(k, 1);
      } else {
        if (pr.p <= fp + REVEAL + 1) pr.grow.target = 1;
        if (pr.grow.settled) continue;
        const s = Math.max(0.001, pr.grow.update(dt));
        pr.mesh.scale.set(s, s, s);
      }
    }

    // Stones dropping into place ahead.
    for (let k = dropping.length - 1; k >= 0; k--) {
      const t = dropping[k]!;
      if (t.state === 0) {
        if (t.c.p > fp + REVEAL) continue;
        t.wait -= dt;
        if (t.wait > 0) continue;
        t.state = 1;
        seat(t, air);
      }
      t.vy -= 30 * dt;
      t.y += t.vy * dt;
      if (t.y <= t.top) {
        t.y = t.top;
        if (!t.bounced && t.vy < -3) {
          t.bounced = true;
          t.vy = -t.vy * 0.22;
          const cx = t.c.i + 0.5;
          const cz = t.c.j + 0.5;
          ripple(cx, cz, 1.0, 1.9, 0.7, 0.55);
          if (!reduced) puffs.emit(cx, 0.05, cz, { count: 4, colors: [P.foam, P.sky], speed: [0.6, 1.3], up: [1.4, 2.4], size: [0.05, 0.09], life: [0.3, 0.5], gravity: 10, floor: 0 });
          if (mode === "play" && time - lastPlop > 0.14) {
            lastPlop = time;
            audio.play(S.plop, { pitch: rng.range(-3, 5), volume: 0.5 });
          }
        } else {
          t.state = 2;
          dropping.splice(k, 1);
          seat(t, ground);
          continue;
        }
      }
      placeTile(t);
    }

    // Berries bob; taken ones pop up and vanish.
    for (let k = berries.length - 1; k >= 0; k--) {
      const b = berries[k]!;
      const base = b.tile.y;
      if (b.taken >= 0) {
        b.taken += dt;
        const s = Math.max(0, 1 + b.taken * 3 - b.taken * b.taken * 18);
        b.mesh.scale.setScalar(s);
        b.mesh.position.set(b.tile.c.i + 0.5, base + 0.1 + b.taken * 2.2, b.tile.c.j + 0.5);
        if (s <= 0) removeBerry(b);
        continue;
      }
      b.phase += dt * 2.4;
      b.mesh.visible = b.tile.state !== 0;
      b.mesh.position.set(b.tile.c.i + 0.5, base + 0.03 + Math.abs(Math.sin(b.phase)) * 0.08, b.tile.c.j + 0.5);
      b.mesh.rotation.y = b.phase * 0.4;
    }

    // Fox pose.
    yaw.update(dt);
    hop.update(dt);
    lean.update(dt);
    fox.root.position.set(fx, fy + Math.max(0, hop.value) * 0.12, fz);
    if (!falling) {
      fox.root.rotation.set(0, yaw.value, lean.value * 0.22);
      fox.trot(trot, dropIn ? 0 : 1);
    } else {
      fox.root.rotation.y = yaw.value;
      fox.root.rotation.z = 0;
      fox.trot(trot, 0);
    }

    puffs.update(dt);
    for (const r of ripples) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.dur);
      const e = 1 - (1 - r.t) ** 2;
      const s = lerp(r.s0, r.s1, e);
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = (1 - r.t) * (r.mesh.userData.strength as number);
      if (r.t >= 1) r.mesh.visible = false;
    }

    // Camera glides after the fox, leaning toward where the path is heading.
    const foxF = fx * SCREEN_UP.x + fz * SCREEN_UP.z;
    const foxLat = fx * SCREEN_RIGHT.x + fz * SCREEN_RIGHT.z;
    let pathLat = foxLat;
    const blocks = gen.blocks;
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k]!;
      if (b.p <= -(fx + fz) + 9) {
        pathLat = (b.x + b.w / 2) * SCREEN_RIGHT.x + (b.z + b.w / 2) * SCREEN_RIGHT.z;
        break;
      }
    }
    if (!falling) {
      camF = damp(camF, foxF + aheadDist(), reduced ? 4 : 6, dt);
      camLat = damp(camLat, lerp(foxLat, pathLat, 0.4), reduced ? 1.5 : 2.2, dt);
    }
    focus.copy(SCREEN_UP).multiplyScalar(camF).addScaledVector(SCREEN_RIGHT, camLat);
    stage.look(focus);
    water.position.set(focus.x, 0, focus.z);
    home.visible = -(fx + fz) < BEHIND + 2;

    // Glints: blink in place; ones that leave the view come back near the top.
    const vh = (stage.height / stage.ppu) / 0.577;
    const vw = stage.width / stage.ppu;
    for (let k = 0; k < GLINTS; k++) {
      const g = glint[k]!;
      const gf = g.x * SCREEN_UP.x + g.z * SCREEN_UP.z - camF;
      const gl = g.x * SCREEN_RIGHT.x + g.z * SCREEN_RIGHT.z - camLat;
      if (gf < -vh * 0.55 || gf > vh * 0.6 || Math.abs(gl) > vw * 0.7) {
        const nf = camF + (gf < 0 ? rng.range(0.1, 0.55) : rng.range(-0.55, 0.3)) * vh;
        const nl = camLat + rng.range(-0.6, 0.6) * vw;
        g.x = SCREEN_UP.x * nf + SCREEN_RIGHT.x * nl;
        g.z = SCREEN_UP.z * nf + SCREEN_RIGHT.z * nl;
        if (tiles.has(keyOf(Math.floor(g.x), Math.floor(g.z)))) g.x += 2.5;
      }
      g.ph += dt * g.sp;
      const s = Math.max(0, Math.sin(g.ph)) ** 2 * g.s;
      pos.set(g.x, 0.008, g.z);
      eul.set(0, k % 2 ? 0 : Math.PI / 2, 0);
      q.setFromEuler(eul);
      scl.set(s, 1, s * 0.25);
      mtx.compose(pos, q, scl);
      glints.setMatrixAt(k, mtx);
    }
    glints.instanceMatrix.needsUpdate = true;

    // Mode housekeeping.
    if (mode === "attract") {
      if (falling && fallT > 1.8) resetWorld("attract");
    } else if (session.phase === "over") {
      overT += dt;
    }

    // UI.
    const attractish = session.phase === "attract";
    sign.show(attractish);
    sign.update(dt);
    hud.showScore(mode === "play" && session.phase !== "attract" && !(session.phase === "over" && session.standalone && overT > 0.7));
    hud.showBest(attractish && session.best !== null);
    hud.showHint(attractish);
    const prompt = attractish ? "Tap to start" : session.phase === "over" && session.standalone && overT > 0.7 ? `${score} · Tap to try again` : null;
    if (prompt !== lastPrompt) {
      lastPrompt = prompt;
      hud.setPrompt(prompt);
    }
    hud.update(dt, time);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  hud.setBest(session.best);
  hud.setHint("Tap to turn at every bend");
  resetWorld("attract");
  layout();
  // Warm every shader (instanced stones, puffs, ripples, the sign) before ready so no frame compiles later.
  puffs.warm();
  for (const r of ripples.slice(0, 1)) r.mesh.visible = true;
  update(0);
  stage.renderer.compile(scene, stage.camera);
  stage.renderer.compile(stage.ui.scene, stage.ui.camera);
  stage.render();
  ripples[0]!.mesh.visible = false;
  puffs.clear();
  let frames = 0;
  let lastPhase = session.phase;
  tc.loop((dt) => {
    update(dt);
    if (session.phase !== lastPhase) {
      lastPhase = session.phase;
      layout();
    }
    stage.render();
    if (++frames === 2) session.ready();
  });
}

void main();
