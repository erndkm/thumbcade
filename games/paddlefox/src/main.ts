import { createAudio, createMusic } from "@thumbcade-games/kit/audio";
import { clamp, damp, lerp, Spring } from "@thumbcade-games/kit/ease";
import { onDrag, onKeys } from "@thumbcade-games/kit/input";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BoxGeometry, DynamicDrawUsage, Euler, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3, type BufferGeometry } from "three";
import { branchGeometry, canoeGeometry, damGeometry, fishGeometry, logGeometry, paddleGeometry, rockGeometry, whirlGeometry } from "./models.ts";
import { buildChunk, type River } from "./river.ts";
import { FISH_POINTS, fishArc, Run, type Fish, type Kind, type Obstacle, type RunEvents } from "./sim.ts";
import { createFox } from "./toybox/fox.ts";
import { loadRubik } from "./toybox/fonts.ts";
import { createHud } from "./toybox/hud.ts";
import { P } from "./toybox/palette.ts";
import { Puffs } from "./toybox/puffs.ts";
import { flourish, S, streak } from "./toybox/sfx.ts";
import { createSign } from "./toybox/sign.ts";
import { createStage, SCREEN_RIGHT as R, SCREEN_UP as F } from "./toybox/stage.ts";
import { col } from "./toybox/vox.ts";

const CHUNK = 10;
const BOAT_SCALE = 1.25;
const FOX_SCALE = 0.042;

async function main() {
  const [session] = await Promise.all([createSession({ id: "paddlefox" }), loadRubik()]);
  const reduced = session.reducedMotion;
  const stage = createStage({ viewW: 7.2, fog: [3, 19], shadowExtent: 14 });
  const { scene } = stage;
  const audio = createAudio();
  const hud = createHud();
  const music = createMusic(audio, {
    bpm: 104,
    wave: "sine",
    volume: 0.028,
    steps: [74, null, 78, null, 81, null, 78, null, 76, null, 79, null, 83, null, 81, 79, 74, null, 78, null, 81, null, 86, null, 83, null, 81, null, 78, null, null, null],
  });

  // ---------------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------------
  const logGeos = [logGeometry(1.1), logGeometry(1.4), logGeometry(1.7)];
  const fishGeos = [fishGeometry(0), fishGeometry(1), fishGeometry(2)];
  const whirlGeo = whirlGeometry();

  const boat = new Group();
  boat.rotation.order = "YXZ";
  boat.scale.setScalar(BOAT_SCALE);
  const hull = new Mesh(canoeGeometry(), stage.vox);
  hull.castShadow = true;
  hull.receiveShadow = true;
  boat.add(hull);
  const fox = createFox(stage.vox, FOX_SCALE);
  for (const l of fox.legs) l.visible = false;
  fox.root.rotation.order = "YXZ";
  const paddle = new Group();
  paddle.position.set(0, 0.32, 0.12);
  paddle.rotation.order = "YXZ";
  const paddleMesh = new Mesh(paddleGeometry(), stage.vox);
  paddleMesh.castShadow = true;
  paddle.add(paddleMesh);
  boat.add(paddle);
  scene.add(boat);

  const puffs = new Puffs(280);
  scene.add(puffs.mesh);

  // Flow streaks drifting downstream on the water.
  const STREAKS = 24;
  const streaks = new InstancedMesh(new BoxGeometry(0.06, 0.012, 0.36), new MeshBasicMaterial({ color: col("#D9F2F8") }), STREAKS);
  streaks.frustumCulled = false;
  streaks.instanceMatrix.setUsage(DynamicDrawUsage);
  const streakState = Array.from({ length: STREAKS }, () => ({ s: -999, u: 0, len: 1 }));
  scene.add(streaks);

  // Bubbles over a waiting fish.
  const markerGeo = new BoxGeometry(0.1, 0.02, 0.1);
  const markerMat = new MeshBasicMaterial({ color: col(P.foam) });
  const markers: Mesh[] = [];

  const sign = createSign(stage.vox, "Paddlefox");
  stage.ui.scene.add(sign.group);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let run!: Run;
  let river!: River;
  const chunks = new Map<number, Mesh>();
  const views = new Map<Obstacle, { mesh: Mesh; owned: BufferGeometry | null }>();
  const fishViews = new Map<Fish, { mesh: Mesh; t: number; from: Vector3; bubbles: number }>();
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let attractT = 0;
  let overT = 0;
  let endSent = false;
  let fishStreak = 0;
  let lastFishT = -9;
  let lastBump = 0;
  let paddleT = 0;
  let wakeT = 0;
  let sprayT = 0;
  let camF = 0;
  let camLat = 0;
  let camY = 0;
  let lastPrompt: string | null = "";
  let foxOverboard = false;
  const roll = new Spring(0, 120, 9);
  const bob = new Spring(0, 90, 6);
  const focus = new Vector3();
  const tmp = new Vector3();
  const mtx = new Matrix4();
  const q = new Quaternion();
  const eul = new Euler();
  const scl = new Vector3();

  const wx = (s: number, u: number) => river.worldX(s, u);
  const wz = (s: number, u: number) => river.worldZ(s, u);
  /** Yaw that points local +Z along the river at s (plus an extra sideways slope). */
  const yawAt = (s: number, extra = 0) => {
    const k = river.slope(s) + extra;
    return Math.atan2(F.x + R.x * k, F.z + R.z * k);
  };
  const playing = () => mode === "play" && session.phase === "playing";

  // ---------------------------------------------------------------------------
  // What the run tells us
  // ---------------------------------------------------------------------------
  const events: RunEvents = {
    spawn(o) {
      const rng = createRng(o.seed);
      const L = river.level(o.s);
      let mesh: Mesh;
      let owned: BufferGeometry | null = null;
      if (o.kind === "rock") mesh = new Mesh((owned = rockGeometry(wx(o.s, o.u), L, wz(o.s, o.u), o.r, rng)), stage.vox);
      else if (o.kind === "dam") mesh = new Mesh((owned = damGeometry(river, o.s, o.g0, o.g1, rng)), stage.vox);
      else if (o.kind === "branch") mesh = new Mesh((owned = branchGeometry(river, o.s, o.side, o.tip, rng)), stage.vox);
      else if (o.kind === "log") mesh = new Mesh(logGeos[o.variant]!, stage.vox);
      else {
        mesh = new Mesh(whirlGeo, stage.vox);
        mesh.position.set(wx(o.s, o.u), L + 0.006, wz(o.s, o.u));
      }
      mesh.castShadow = o.kind !== "whirl";
      mesh.receiveShadow = true;
      views.set(o, { mesh, owned });
      scene.add(mesh);
    },
    despawn(o) {
      const v = views.get(o);
      if (!v) return;
      scene.remove(v.mesh);
      v.owned?.dispose();
      views.delete(o);
    },
    spawnFish(f) {
      const mesh = new Mesh(fishGeos[f.variant]!, stage.vox);
      mesh.scale.setScalar(1.45);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      fishViews.set(f, { mesh, t: 0, from: new Vector3(), bubbles: Math.random() * 3 });
    },
    despawnFish(f) {
      const v = fishViews.get(f);
      if (!v) return;
      scene.remove(v.mesh);
      fishViews.delete(f);
    },
    leap(f) {
      const v = fishViews.get(f);
      if (v) v.mesh.visible = true;
      if (playing()) audio.play(S.bubble, { pitch: 3 });
    },
    caught(f, u, h) {
      const v = fishViews.get(f);
      if (v) {
        v.t = 0;
        v.from.copy(v.mesh.position);
      }
      fishStreak = time - lastFishT < 6 ? fishStreak + 1 : 0;
      lastFishT = time;
      const L = river.level(f.s);
      puffs.emit(wx(f.s, u), L + h, wz(f.s, u), { count: 10, colors: [P.foam, P.butter, P.sky], speed: [0.6, 1.6], up: [0.8, 2], size: [0.05, 0.09], life: [0.3, 0.6], gravity: 7 });
      if (!playing()) return;
      streak(audio, fishStreak + 1, 74);
      session.feedback("success");
      const p = stage.toScreen(tmp.set(wx(f.s, u), L + 0.9, wz(f.s, u)));
      hud.toast(`+${FISH_POINTS}`, p.x, p.y, P.peachDeep);
      hud.setSub(`× ${run.caught}`, { top: "#FFF0B8", left: P.butterDeep, right: "#E0A93E" });
      hud.bump();
    },
    splashFish(f, u) {
      const L = river.level(f.s);
      const v = fishViews.get(f);
      if (v) v.mesh.visible = false;
      puffs.emit(wx(f.s, u), L + 0.04, wz(f.s, u), { count: 5, colors: [P.foam, P.sky], speed: [0.4, 1], up: [1, 1.8], size: [0.04, 0.08], life: [0.3, 0.5], gravity: 8, floor: L });
    },
    capsize(by: Kind) {
      const x = wx(run.s, run.u);
      const z = wz(run.s, run.u);
      const L = river.level(run.s);
      puffs.emit(x, L + 0.1, z, { count: reduced ? 14 : 28, colors: [P.foam, P.sky, P.foam, P.water], speed: [0.8, 2.6], up: [2, 4.2], size: [0.06, 0.14], life: [0.5, 0.9], gravity: 11, floor: L });
      if (by !== "whirl") puffs.emit(x, L + 0.4, z, { count: 8, colors: [P.wood, P.leaf, P.bark], speed: [0.8, 2], up: [1, 2.5], size: [0.05, 0.1], life: [0.4, 0.7], gravity: 9 });
      roll.target = Math.PI * (run.vu >= 0 ? -1 : 1);
      if (!playing()) return;
      audio.play(S.bonk);
      audio.play(S.sploosh);
      window.setTimeout(() => audio.play(S.sad), 220);
      session.feedback("impact");
    },
    airborne() {
      if (playing()) audio.play(S.swish);
    },
    land() {
      bob.velocity -= 2.4;
      const L = river.level(run.s);
      puffs.emit(wx(run.s, run.u), L + 0.05, wz(run.s, run.u), { count: reduced ? 12 : 24, colors: [P.foam, P.sky, P.foam], speed: [1, 2.6], up: [1.8, 3.6], size: [0.06, 0.13], life: [0.4, 0.8], gravity: 10, floor: L });
      if (!playing()) return;
      audio.play(S.splash);
      session.feedback("impact");
    },
    bump() {
      if (!playing() || time - lastBump < 0.35) return;
      lastBump = time;
      audio.play(S.tokLow, { volume: 0.5 });
    },
  };

  // ---------------------------------------------------------------------------
  // Terrain chunks: nearest first, at most one new chunk per frame once running.
  // ---------------------------------------------------------------------------
  function updateChunks(sync: boolean) {
    const cs = run.s;
    const lo = Math.floor((cs - 12) / CHUNK);
    const hi = Math.floor((cs + 36) / CHUNK);
    for (const [n, m] of chunks)
      if (n < lo - 1 || n > hi + 1) {
        scene.remove(m);
        m.geometry.dispose();
        chunks.delete(n);
      }
    const order: number[] = [];
    for (let n = lo; n <= hi; n++) if (!chunks.has(n)) order.push(n);
    order.sort((a, b) => Math.abs(a * CHUNK + 5 - cs - 8) - Math.abs(b * CHUNK + 5 - cs - 8));
    for (const n of order) {
      river.ensureFalls(n * CHUNK + CHUNK * 4);
      const mesh = new Mesh(buildChunk(river, n * CHUNK, (n + 1) * CHUNK, (n * 7919) ^ 0x5f3759df), stage.vox);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      chunks.set(n, mesh);
      scene.add(mesh);
      if (!sync) break;
    }
  }

  function resetWorld(m: "attract" | "play") {
    mode = m;
    // Tear down the previous trip.
    for (const [, c] of chunks) {
      scene.remove(c);
      c.geometry.dispose();
    }
    chunks.clear();
    for (const [o] of views) events.despawn(o);
    for (const [f] of fishViews) events.despawnFish(f);
    puffs.clear();
    const seed = (session.ctx.seed + session.runs * 7919 + (m === "attract" ? Math.floor(time * 31) : 0)) >>> 0;
    run = new Run(seed, events, m === "attract" ? 0.92 : 1);
    river = run.river;
    run.generate(run.s + 40);
    endSent = false;
    fishStreak = 0;
    attractT = 0;
    overT = 0;
    roll.snap(0);
    bob.snap(0);
    foxOverboard = false;
    fox.root.scale.setScalar(FOX_SCALE);
    fox.root.position.set(0, -0.02, -0.08);
    fox.root.rotation.set(0, 0, 0);
    fox.tail.rotation.x = -0.2;
    boat.add(fox.root);
    for (const st of streakState) st.s = -999;
    updateChunks(true);
    camF = run.s + aheadDist();
    camLat = wx(run.s, 0) * R.x + wz(run.s, 0) * R.z;
    camY = 0;
    hud.setScore(0);
    hud.setSub(null);
  }

  function aheadDist() {
    return (stage.height * 0.17) / (stage.ppu * 0.577);
  }

  // ---------------------------------------------------------------------------
  // Input: a tap (release) starts a run; a horizontal drag anywhere steers, relative to where it began.
  // ---------------------------------------------------------------------------
  session.startOnTap(window);
  let dragBase = 0;
  let dragging = false;
  onDrag(window, {
    start() {
      dragging = playing();
      dragBase = run.target;
    },
    move(_x, _y, dx) {
      if (dragging && playing()) run.target = dragBase + (dx / stage.ppu) * 1.25;
    },
    end() {
      dragging = false;
    },
  });
  onKeys({
    left: () => {
      if (playing()) run.target -= 0.7;
    },
    right: () => {
      if (playing()) run.target += 0.7;
    },
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
    hud.layout(session.safe());
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
  function update(dt: number) {
    time += dt;
    session.tick(dt);
    if (mode === "attract") {
      attractT += dt;
      // The demo paddler reads the river well at first, then gets careless so the loop shows a spill.
      run.target = run.plan(attractT > 30 ? 0.9 : 2.2);
    }
    run.step(dt);
    const L = river.level(run.s);
    const v = run.speed;

    if (playing()) hud.setScore(run.score);
    if (run.capsized && mode === "play" && !endSent && run.capT > 0.6) {
      endSent = true;
      music.stop();
      const prev = session.best;
      const r = session.end(run.score, { outcome: "lose", stats: { meters: run.meters, fish: run.caught } });
      if (r.isBest && prev !== null) flourish(audio, 74);
      hud.setBest(session.best);
    }

    updateChunks(false);

    // Hazards that move.
    for (const [o, view] of views) {
      if (o.kind === "log") {
        view.mesh.position.set(wx(o.s, o.u), river.level(o.s) + Math.sin(time * 2 + o.s) * 0.02, wz(o.s, o.u));
        view.mesh.rotation.y = yawAt(o.s) - Math.PI / 2 + o.ang;
      } else if (o.kind === "whirl") view.mesh.rotation.y -= dt * (reduced ? 1.2 : 2.4);
    }

    // Fish: arcs, the hop into the canoe, bubbles where one waits.
    let mi = 0;
    for (const [f, view] of fishViews) {
      const FL = river.level(f.s);
      if (f.state === 0) {
        const { u, h } = fishArc(f);
        view.mesh.position.set(wx(f.s, u), FL + h, wz(f.s, u));
        view.mesh.rotation.set(0, yawAt(f.s) + (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0);
        view.mesh.rotateX(-(0.5 - f.t) * 2.2);
      } else if (f.state === 2 && view.mesh.visible) {
        view.t += dt / 0.35;
        const k = Math.min(1, view.t);
        tmp.set(boat.position.x, boat.position.y + 0.4 + Math.sin(k * Math.PI) * 0.5, boat.position.z);
        view.mesh.position.lerpVectors(view.from, tmp, k);
        view.mesh.scale.setScalar(1.45 * (1 - k * 0.7));
        if (k >= 1) view.mesh.visible = false;
      } else if (f.state === -1 && f.s < run.s + 24) {
        view.bubbles += dt;
        for (let b = 0; b < 3; b++) {
          let m = markers[mi];
          if (!m) {
            m = new Mesh(markerGeo, markerMat);
            markers.push(m);
            scene.add(m);
          }
          const a = view.bubbles * 2 + (b * Math.PI * 2) / 3;
          const ph = (view.bubbles * 1.6 + b / 3) % 1;
          m.visible = true;
          m.position.set(wx(f.s, f.u) + Math.cos(a) * 0.22, FL + 0.02 + ph * 0.06, wz(f.s, f.u) + Math.sin(a) * 0.22);
          m.scale.setScalar(1 - ph * 0.6);
          mi++;
        }
      }
    }
    for (; mi < markers.length; mi++) markers[mi]!.visible = false;

    // The boat.
    roll.target = run.capsized ? roll.target : clamp(-run.vu * 0.07, -0.35, 0.35);
    roll.update(dt);
    bob.update(dt);
    const flip = Math.min(1, Math.abs(roll.value) / Math.PI);
    const yaw = yawAt(run.s, run.capsized ? 0 : clamp(run.vu / Math.max(1, v), -0.6, 0.6));
    boat.position.set(wx(run.s, run.u), run.y + 0.02 + Math.sin(time * 3.1) * 0.015 + bob.value * 0.05 + (run.capsized ? flip * 0.32 - run.capT * 0.04 : 0), wz(run.s, run.u));
    boat.rotation.set(Math.sin(time * 2.3) * 0.02 + (run.airborne ? -run.vy * 0.06 : 0), yaw, roll.value);
    if (!run.capsized) {
      paddleT += dt * (5 + v * 0.55);
      const st = Math.sin(paddleT);
      paddle.rotation.set(0, Math.cos(paddleT) * 0.3, st * 0.55 + clamp(run.vu * 0.05, -0.25, 0.25));
      fox.head.rotation.y = clamp(-run.vu * 0.06, -0.4, 0.4);
      fox.body.position.y = Math.abs(st) * 0.4;
      fox.tail.rotation.y = Math.sin(time * 2) * 0.25;
      // Wake.
      wakeT -= dt;
      if (wakeT <= 0 && !run.airborne) {
        wakeT = reduced ? 0.16 : 0.08;
        const ss = run.s - 0.75;
        puffs.emit(wx(ss, run.u), L + 0.03, wz(ss, run.u), { count: 2, colors: [P.foam], speed: [0.2, 0.6], up: [0.2, 0.6], size: [0.05, 0.08], life: [0.35, 0.55], gravity: 3, floor: L + 0.01 });
      }
    } else if (!foxOverboard && flip > 0.85) {
      // The fox pops out and bobs next to the upturned canoe.
      foxOverboard = true;
      scene.add(fox.root);
      fox.root.scale.setScalar(FOX_SCALE * BOAT_SCALE);
      fox.root.position.set(wx(run.s - 0.2, run.u + 0.55), L - 0.2, wz(run.s - 0.2, run.u + 0.55));
      fox.root.rotation.set(0, yawAt(run.s) + 2.4, 0);
      fox.tail.rotation.x = 0.4;
    }
    if (foxOverboard) fox.root.position.y = L - 0.22 + Math.sin(time * 4) * 0.03;

    // Spray rising off the next waterfall so the drop reads from upstream.
    const fall = river.nextFall(run.s - 1);
    if (fall - run.s < 26 && fall - run.s > -3) {
      sprayT -= dt;
      if (sprayT <= 0) {
        sprayT = reduced ? 0.12 : 0.06;
        const hw = river.half(fall);
        const u = (Math.random() * 2 - 1) * hw;
        const low = river.level(fall + 1);
        puffs.emit(wx(fall + 0.5, u), low + 0.05, wz(fall + 0.5, u), { count: 2, colors: [P.foam, P.foam, P.sky], speed: [0.2, 0.7], up: [1.6, 2.8], size: [0.06, 0.12], life: [0.5, 0.8], gravity: 4, floor: low });
      }
    }

    puffs.update(dt);

    // Streaks drift with the current (slower than the canoe, so they slide back past it).
    for (let k = 0; k < STREAKS; k++) {
      const st = streakState[k]!;
      if (st.s < run.s - 7 || st.s > run.s + 30) {
        st.s = run.s + (st.s < -900 ? Math.random() * 32 - 4 : 18 + Math.random() * 10);
        const hw = river.half(st.s);
        st.u = (Math.random() * 2 - 1) * (hw - 0.3);
        st.len = 0.5 + Math.random() * 0.7;
      }
      st.s += v * 0.72 * dt;
      const SL = river.level(st.s);
      const nearFall = Math.abs(river.nextFall(st.s - 0.5) - st.s) < 0.7;
      const s = nearFall ? 0 : st.len;
      tmp.set(wx(st.s, st.u), SL + 0.012, wz(st.s, st.u));
      eul.set(0, yawAt(st.s), 0);
      q.setFromEuler(eul);
      scl.set(s, 1, s);
      mtx.compose(tmp, q, scl);
      streaks.setMatrixAt(k, mtx);
    }
    streaks.instanceMatrix.needsUpdate = true;

    // Camera: glide after the canoe, leaning toward where the river goes; ease down after a fall.
    const bx = boat.position.x;
    const bz = boat.position.z;
    const riverLat = wx(run.s + 6, 0) * R.x + wz(run.s + 6, 0) * R.z;
    if (!run.capsized) {
      camF = damp(camF, bx * F.x + bz * F.z + aheadDist(), reduced ? 5 : 7, dt);
      camLat = damp(camLat, lerp(bx * R.x + bz * R.z, riverLat, 0.35), reduced ? 2 : 3, dt);
    }
    camY = damp(camY, L, reduced ? 2.5 : 4, dt);
    focus.copy(F).multiplyScalar(camF).addScaledVector(R, camLat);
    focus.y = camY;
    stage.look(focus);

    // Mode housekeeping.
    if (mode === "attract") {
      if ((run.capsized && run.capT > 2) || attractT > 75) resetWorld("attract");
    } else if (session.phase === "over") overT += dt;

    // UI.
    const attractish = session.phase === "attract";
    sign.show(attractish);
    sign.update(dt);
    hud.showScore(mode === "play" && session.phase !== "attract" && !(session.phase === "over" && session.standalone && overT > 0.7));
    hud.showBest(attractish && session.best !== null);
    hud.showHint(attractish);
    const prompt = attractish ? "Tap to start" : session.phase === "over" && session.standalone && overT > 0.7 ? `${run.score} · Tap to try again` : null;
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
  hud.setHint("Drag sideways to steer · catch the fish");
  resetWorld("attract");
  layout();
  puffs.warm();
  update(0);
  stage.renderer.compile(scene, stage.camera);
  stage.renderer.compile(stage.ui.scene, stage.ui.camera);
  stage.render();
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
