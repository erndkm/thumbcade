import { createAudio, createMusic } from "@thumbcade-games/kit/audio";
import { clamp, damp, lerp, Spring } from "@thumbcade-games/kit/ease";
import { onKeys } from "@thumbcade-games/kit/input";
import { Photosafe } from "@thumbcade-games/kit/photosafe";
import { createRng } from "@thumbcade-games/kit/rng";
import { createSession } from "@thumbcade-games/kit/session";
import { Shake } from "@thumbcade-games/kit/shake";
import { thumbcade as tc } from "@thumbcade/sdk";
import { BoxGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Plane, Quaternion, Raycaster, Vector2, Vector3, type BufferGeometry } from "three";
import {
  ballGeometry,
  BALL_COLORS,
  blockerGeometry,
  capAtlas,
  capGeometry,
  capMaterial,
  createBeaver,
  createRabbit,
  CUE_COLOR,
  cueGeometry,
  meadowGeometry,
  stumpGeometry,
  tableGeometry,
  type Critter,
} from "./models.ts";
import { createPanel } from "./panel.ts";
import { choose, execute, SKILLS, type Skill } from "./pilot.ts";
import { afterShot, FIRST_T, RACK_DROP_T } from "./runs.ts";
import {
  castGuide,
  CLUTCH_T,
  guideLengths,
  HL,
  HW,
  makeRack,
  playbackRate,
  POCKETS,
  RACK_TIME,
  powerFor,
  R,
  rackSpec,
  Run,
  sampleShot,
  simulateShot,
  speedFor,
  STREAK_NAMES,
  type Award,
  type Shot,
  type Table,
} from "./sim.ts";
import { createFox, type Fox } from "./toybox/fox.ts";
import { loadRubik } from "./toybox/fonts.ts";
import { createHud } from "./toybox/hud.ts";
import { P } from "./toybox/palette.ts";
import { Puffs } from "./toybox/puffs.ts";
import { flourish, plink, S, streak } from "./toybox/sfx.ts";
import { createSign } from "./toybox/sign.ts";
import { createStage } from "./toybox/stage.ts";
import { col } from "./toybox/vox.ts";

/** The camera looks down at 66°: steep enough to aim precisely, tilted enough that the diorama still has sides. */
const TILT = (66 * Math.PI) / 180;
const VIEW = new Vector3(0, Math.sin(TILT), Math.cos(TILT));
/** Aim turns this much per pixel of sideways drag (a third of it once you're pulling for power). */
const ROT = 0.0042;
const FINE = 0.3;
/** Pull below this and letting go doesn't shoot. */
const MIN_POWER = 0.06;
const STRIKE_T = 0.08;
const DEMO: Skill = { ...SKILLS.good, check: 3, blunder: 0, think: [0.9, 1.5] };
/** Design QA builds can let a pilot play the run (`VITE_AUTOPLAY=good`); a normal build has none. */
const QA_AUTOPLAY: Skill | null = (SKILLS as Record<string, Skill>)[import.meta.env.VITE_AUTOPLAY ?? ""] ?? null;

type Phase = "aim" | "strike" | "roll" | "rack" | "over";

async function main() {
  const [session] = await Promise.all([createSession({ id: "clackwood" }), loadRubik()]);
  const reduced = session.reducedMotion;
  let hintSeen = false;
  try {
    hintSeen = (await tc.storage.get<number>("hint")) === 1;
  } catch {
    /* storage unavailable: show the hint */
  }
  const stage = createStage({ viewW: 7.8, view: VIEW, shadowExtent: 9.5, shadowSize: 2048 });
  const { scene } = stage;
  const audio = createAudio();
  const music = createMusic(audio, {
    bpm: 96,
    wave: "sine",
    volume: 0.024,
    steps: [72, null, 76, null, 79, null, 76, null, 74, null, 77, null, 81, null, 79, 77, 72, null, 76, null, 79, null, 84, null, 81, null, 79, null, 76, null, null, null],
  });
  const hud = createHud();
  const panel = createPanel();
  const light = new Photosafe(reduced);
  const flash = light.flash({ alpha: 0.16, decay: 0.4 });
  const flashEl = document.createElement("div");
  flashEl.style.cssText = "position:fixed;inset:0;pointer-events:none;opacity:0";
  document.body.appendChild(flashEl);
  const shake = new Shake(1, 0, 2.2, reduced);
  const rng = createRng(session.ctx.seed || 1);

  // ---------------------------------------------------------------------------
  // The diorama
  // ---------------------------------------------------------------------------
  const meadow = new Mesh(meadowGeometry(), stage.vox);
  meadow.receiveShadow = true;
  scene.add(meadow);
  const table = new Mesh(tableGeometry(), stage.vox);
  table.receiveShadow = true;
  table.castShadow = true;
  scene.add(table);

  const atlas = capAtlas();
  const capMat = capMaterial(atlas);
  const geoCache = new Map<number, BufferGeometry>();
  const ballGeo = (n: number) => {
    let g = geoCache.get(n);
    if (!g) geoCache.set(n, (g = n === 0 ? ballGeometry(CUE_COLOR, P.lilacDeep) : ballGeometry(BALL_COLORS[(n - 1) % BALL_COLORS.length]!)));
    return g;
  };
  interface BallView {
    root: Group;
    mesh: Mesh;
    cap: Mesh | null;
    q: Quaternion;
    lx: number;
    lz: number;
    /** Pot animation: seconds since it dropped (-1 = on the table). */
    drop: number;
    pocket: number;
    from: Vector3;
    /** Drop-in animation for a new rack (-1 = done). */
    land: number;
    landDelay: number;
  }
  const views: BallView[] = [];
  for (let n = 0; n <= 12; n++) {
    const root = new Group();
    const mesh = new Mesh(ballGeo(n), stage.vox);
    mesh.castShadow = true;
    root.add(mesh);
    let cap: Mesh | null = null;
    if (n > 0) {
      cap = new Mesh(capGeometry(n), capMat);
      cap.position.y = R + 0.008;
      root.add(cap);
    }
    root.visible = false;
    scene.add(root);
    views.push({ root, mesh, cap, q: new Quaternion(), lx: 0, lz: 0, drop: -1, pocket: -1, from: new Vector3(), land: -1, landDelay: 0 });
  }
  const blockerGeo = blockerGeometry();
  const blockerMeshes = [0, 1].map(() => {
    const m = new Mesh(blockerGeo, stage.vox);
    m.castShadow = true;
    m.visible = false;
    scene.add(m);
    return m;
  });
  const cue = new Group();
  const cueMesh = new Mesh(cueGeometry(), stage.vox);
  cueMesh.castShadow = true;
  cueMesh.rotation.z = 0.1;
  cue.add(cueMesh);
  scene.add(cue);
  // The guide: little cubes on the cloth.
  const DOTS = 140;
  const dots = new InstancedMesh(new BoxGeometry(0.06, 0.02, 0.06), new MeshBasicMaterial({ color: "#ffffff" }), DOTS);
  dots.instanceMatrix.setUsage(DynamicDrawUsage);
  dots.frustumCulled = false;
  dots.count = 0;
  for (let i = 0; i < DOTS; i++) dots.setColorAt(i, new Color(1, 1, 1));
  scene.add(dots);
  const puffs = new Puffs(320);
  scene.add(puffs.mesh);

  // Spectators on stumps round the table.
  const stumpGeo = stumpGeometry();
  const fox = createFox(stage.vox, 0.05);
  const beaver = createBeaver(stage.vox, 0.052);
  const rabbit = createRabbit(stage.vox, 0.05);
  interface Seat {
    c: Fox | Critter;
    x: number;
    z: number;
    yaw: number;
    hop: Spring;
    squash: Spring;
    hopV: number;
    hopY: number;
  }
  const seats: Seat[] = (
    [
      [fox, -1.7, HL + 1.25, Math.PI * 0.9],
      [beaver, 0.9, -HL - 1.15, Math.PI * 0.05],
      [rabbit, HW + 0.95, 1.6, -Math.PI * 0.5],
    ] as const
  ).map(([c, x, z, yaw]) => {
    const stump = new Mesh(stumpGeo, stage.vox);
    stump.position.set(x, -1.4, z);
    stump.castShadow = true;
    stump.receiveShadow = true;
    scene.add(stump);
    c.root.position.set(x, -1.4 + 0.455, z);
    c.root.rotation.y = yaw;
    scene.add(c.root);
    return { c, x, z, yaw, hop: new Spring(0, 200, 14), squash: new Spring(1, 260, 11), hopV: 0, hopY: 0 };
  });

  const sign = createSign(stage.vox, "Clackwood", VIEW, -Math.PI / 2, -0.95);
  stage.ui.scene.add(sign.group);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let mode: "attract" | "play" = "attract";
  let phase: Phase = "aim";
  let phaseT = 0;
  let time = 0;
  let run = new Run();
  let tab: Table = makeRack(0, 11);
  let shot: Shot | null = null;
  let simT = 0;
  let evIdx = 0;
  let preview: Award | null = null;
  let potsSeen = 0;
  let aim = -Math.PI / 2;
  let power = 0;
  let endSent = false;
  let prevBest: number | null = null;
  let celebratedBest = false;
  let clutchShown = false;
  let lastTick = -1;
  let lastBand = -1;
  let rackSeed = 0;
  // Attract pilot.
  let demo: { at: number; from: number; to: number; speed: number; t0: number } | null = null;
  let attractT = 0;
  // Input.
  let drag: { id: number; x0: number; y0: number; lx: number; t0: number; moved: boolean } | null = null;
  const tmp = new Vector3();
  const mtx = new Matrix4();
  const q = new Quaternion();
  const axis = new Vector3();
  const pos = { x: 0, z: 0 };
  const ray = new Raycaster();
  const plane = new Plane(new Vector3(0, 1, 0), -R);
  const ndc = new Vector2();

  const playing = () => mode === "play" && session.phase === "playing";
  const cueBall = () => tab.balls[0]!;
  const ballsLeft = () => tab.balls.filter((b, i) => i > 0 && b.pocket < 0).length;

  function showTable(dropIn: boolean) {
    for (const v of views) {
      v.root.visible = false;
      v.drop = -1;
      v.land = -1;
    }
    tab.balls.forEach((b, k) => {
      const v = views[b.n]!;
      v.root.visible = true;
      v.lx = b.x;
      v.lz = b.z;
      v.root.position.set(b.x, R, b.z);
      if (dropIn && b.n > 0) {
        v.land = 0;
        v.landDelay = (reduced ? 0.02 : 0.055) * k;
        v.root.position.y = R + 3;
      }
    });
    blockerMeshes.forEach((m, i) => {
      const k = tab.blockers[i];
      m.visible = !!k;
      if (k) m.position.set(k.x, 0, k.z);
    });
  }

  function resetRun(m: "attract" | "play") {
    mode = m;
    run = new Run();
    rackSeed = (session.ctx.seed + session.runs * 7919 + (m === "attract" ? Math.floor(time * 31) : 0)) >>> 0;
    tab = makeRack(0, rackSeed);
    shot = null;
    phase = m === "play" ? "rack" : "aim";
    phaseT = m === "play" ? RACK_DROP_T - FIRST_T : 0;
    power = 0;
    aim = -Math.PI / 2;
    endSent = false;
    celebratedBest = false;
    clutchShown = false;
    lastTick = -1;
    demo = null;
    attractT = 0;
    drag = null;
    puffs.clear();
    showTable(m === "play");
    hud.setScore(0);
    hud.setSub(null);
    panel.summary(null, session.standalone);
    prevBest = session.best;
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------
  const canShoot = () => phase === "aim" && (mode === "attract" || (playing() && !run.buzzer));

  function shoot(speed: number) {
    if (!canShoot()) return;
    shot = simulateShot(tab, aim, speed);
    // What this shot will be worth, for the popups as each ball drops (the real award is settled at the end).
    const ghost = Object.assign(Object.create(Run.prototype) as Run, run, { best: run.best });
    preview = ghost.settle(shot, shot.after.balls.filter((b, i) => i > 0 && b.pocket < 0).length, run.buzzer);
    simT = 0;
    evIdx = 0;
    potsSeen = 0;
    phase = "strike";
    phaseT = 0;
    const p = powerFor(speed);
    audio.play(S.tok, { volume: (mode === "play" ? 0.5 : 0.2) + p * 0.5, pitch: -2 + p * 4 });
    if (mode === "play") session.feedback("tap");
    shake.add(0.05 + p * 0.12);
  }

  function onEvent(kind: string, a: number, x: number, z: number, pw: number) {
    const loud = mode === "play";
    const vol = loud ? 1 : 0.35;
    switch (kind) {
      case "clack": {
        const k = clamp(pw / 6);
        if (k < 0.03) return;
        // Clack: pitched and loudened by how hard they met.
        audio.play(S.tok, { volume: vol * (0.25 + k * 0.85), pitch: -3 + k * 9 + rng.range(-0.6, 0.6) });
        if (k > 0.5) audio.play(S.tokLow, { volume: vol * k * 0.5 });
        if (k > 0.6) shake.add(0.08 * k);
        if (k > 0.35) puffs.emit(x, R, z, { count: 3, colors: [P.cream, P.butter], speed: [0.4, 1.2], up: [0.6, 1.4], size: [0.03, 0.06], life: [0.2, 0.4], gravity: 8, floor: 0 });
        break;
      }
      case "cushion":
      case "blocker": {
        const k = clamp(pw / 6);
        audio.play(S.tokLow, { volume: vol * (0.2 + k * 0.6), pitch: kind === "blocker" ? 3 : -2 });
        break;
      }
      case "pot":
        onPot(a, x, z, pw);
        break;
    }
  }

  function onPot(i: number, px: number, pz: number, pw: number) {
    const s = shot!;
    const b = s.after.balls[i]!;
    const v = views[b.n]!;
    v.drop = 0;
    v.pocket = POCKETS.findIndex((p) => p.x === px && p.z === pz);
    v.from.copy(v.root.position);
    const loud = mode === "play";
    const vol = loud ? 1 : 0.35;
    // The rattle: a few quick toks dropping in pitch, a plop, a bubble.
    const k = clamp(pw / 4);
    [0, 45, 95].forEach((ms, j) => window.setTimeout(() => audio.play(S.tok, { volume: vol * (0.5 - j * 0.12) * (0.6 + k * 0.4), pitch: 5 - j * 3 }), ms));
    window.setTimeout(() => audio.play(S.plop, { volume: vol }), 130);
    const pocket = POCKETS[v.pocket] ?? POCKETS[0]!;
    if (b.n === 0) {
      // A scratch: no fanfare, a little puff, a sad plink.
      puffs.emit(pocket.x, 0.1, pocket.z, { count: 8, colors: [P.cream, P.stone], speed: [0.4, 1], up: [1, 2], size: [0.04, 0.08], life: [0.3, 0.6], gravity: 8 });
      if (loud) window.setTimeout(() => audio.play(S.sad, { volume: 0.6 }), 200);
      for (const st of seats) st.squash.velocity -= 3;
      return;
    }
    const color = BALL_COLORS[(b.n - 1) % BALL_COLORS.length]!;
    puffs.emit(pocket.x, 0.12, pocket.z, { count: reduced ? 10 : 18, colors: [color, color, P.cream, P.butter], speed: [0.6, 1.8], up: [1.6, 3.2], size: [0.05, 0.1], life: [0.45, 0.85], gravity: 9 });
    // Sparkle: tiny bright cubes popping straight up.
    puffs.emit(pocket.x, 0.2, pocket.z, { count: reduced ? 3 : 6, colors: [P.cream, P.butter], speed: [0.1, 0.4], up: [2.6, 3.8], size: [0.03, 0.05], life: [0.35, 0.6], gravity: 5 });
    const step = potsSeen++;
    streak(audio, Math.min(10, run.streak + step), 72);
    if (!loud) {
      hopNearest(pocket.x, pocket.z, 1);
      return;
    }
    if (step === 0) session.feedback("success");
    const e = preview?.each[step];
    const p = stage.toScreen(tmp.set(pocket.x, 0.6, pocket.z));
    if (e) hud.toast(e.tag ? `${e.tag} +${e.points.toLocaleString("en-US")}` : `+${e.points.toLocaleString("en-US")}`, clamp(p.x, 70, stage.width - 70), p.y, e.tag ? P.lilacDeep : P.berryDeep);
    hopNearest(pocket.x, pocket.z, step > 0 ? 1.4 : 1);
    if (step > 0) for (const st of seats) hop(st, 0.8);
    if (!hintSeen) {
      hintSeen = true;
      tc.storage.set("hint", 1).catch(() => undefined);
    }
  }

  function hop(st: Seat, k: number) {
    if (st.hopY > 0.02) return;
    st.hopV = (reduced ? 1.4 : 2.6) * k;
  }
  function hopNearest(x: number, z: number, k: number) {
    let best = seats[0]!;
    let bd = Infinity;
    for (const st of seats) {
      const d = Math.hypot(st.x - x, st.z - z);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    hop(best, k);
  }

  /** The shot has come to rest: score it, clear up, maybe a new rack. */
  function settle() {
    const s = shot!;
    shot = null;
    const loud = mode === "play";
    const afterBuzzer = run.buzzer;
    const left = s.after.balls.filter((b, i) => i > 0 && b.pocket < 0).length;
    const award = run.settle(s, left, afterBuzzer);
    tab = afterShot(s);
    if (s.scratch) {
      const v = views[0]!;
      v.drop = -1;
      v.root.visible = true;
      v.root.position.set(tab.balls[0]!.x, R, tab.balls[0]!.z);
      v.lx = tab.balls[0]!.x;
      v.lz = tab.balls[0]!.z;
      v.land = 0;
      v.landDelay = 0.1;
      v.root.position.y = R + 1.2;
    }
    if (loud) {
      hud.setScore(run.score);
      if (award.points > 0) hud.bump();
      hud.setSub(run.streak >= 2 ? `×${run.mult} ${STREAK_NAMES[run.mult] ?? ""} · ${run.streak}` : null, { top: "#FFF0B8", left: P.butterDeep, right: "#E0A93E" });
      if (Math.abs(award.time) > 0.05) {
        panel.bumpClock();
        const c = { x: stage.width - session.play().right - 60, y: session.play().top + 70 };
        hud.toast(`${award.time > 0 ? "+" : "−"}${Math.abs(award.time).toFixed(1)}s`, c.x, c.y, award.time > 0 ? P.leafDeep : P.coral);
      }
      if (award.rackClear) {
        panel.banner("Rack cleared!", `+${(1000 * run.racksCleared).toLocaleString("en-US")} · +${RACK_TIME}s`, P.ink, 1.4);
        flash.trigger(P.cream, 0.9);
        flourish(audio, 76);
        session.feedback("success");
        for (const st of seats) hop(st, 1.3);
      } else if (award.pots >= 2) {
        panel.banner(award.pots === 2 ? "Double!" : award.pots === 3 ? "Triple!" : `${award.pots} in one!`, award.tags.filter((t) => t !== "Double" && t !== "Triple" && !t.includes("in one")).join(" · "), P.lilacDeep);
        flash.trigger(P.butter, 0.6);
        shake.add(0.3);
      } else if (award.tierUp) {
        panel.banner(`${STREAK_NAMES[award.mult]}`, `×${award.mult} points`, P.berryDeep, 1);
      } else if (s.scratch) {
        panel.banner("Scratch", "−3s · the cue ball's back on the line", P.inkSoft, 1);
      }
      const best = session.best;
      if (!celebratedBest && best !== null && best > 0 && run.score > best) {
        celebratedBest = true;
        window.setTimeout(() => {
          if (mode !== "play") return;
          panel.banner("New best!", "Keep going", P.berryDeep, 1.2);
          flourish(audio, 79);
          for (const st of seats) hop(st, 1);
        }, award.rackClear ? 1300 : 500);
      }
      if (afterBuzzer || run.buzzer) {
        endRun();
        return;
      }
    } else if (award.rackClear) for (const st of seats) hop(st, 1.2);
    if (award.rackClear && !(mode === "play" && run.buzzer)) {
      const spec = run.nextRack();
      tab = makeRack(run.rack, rackSeed * 31 + run.rack, tab.balls[0]!);
      phase = "rack";
      phaseT = 0;
      showTable(true);
      if (loud) window.setTimeout(() => panel.banner(`Rack ${spec.n + 1}`, spec.label, P.ink, 1.3), 900);
      if (mode === "attract" && run.rack >= 3) resetRun("attract");
      return;
    }
    phase = "aim";
    phaseT = 0;
  }

  function endRun() {
    if (endSent) return;
    endSent = true;
    phase = "over";
    phaseT = 0;
    music.stop();
    const prev = session.best;
    const r = session.end(run.score, { outcome: "lose", stats: { pots: run.pots, racks: run.racksCleared, shots: run.shots, streak: run.bestStreak } });
    if (r.isBest && run.score > 0) {
      flourish(audio, 74);
      for (const st of seats) hop(st, 1.3);
    }
    const b = run.best;
    panel.summary(
      {
        score: run.score,
        best: r.best,
        isBest: r.isBest,
        prevBest: prev,
        bestShot: b ? b.points.toLocaleString("en-US") : "None yet",
        bestTag: b?.tags[0] ?? "",
        pots: run.pots,
        racks: run.racksCleared,
        streak: run.bestStreak,
        hint: run.hint(),
      },
      session.standalone,
      session.preview(),
    );
    hud.setBest(session.best);
    void prevBest;
  }

  // ---------------------------------------------------------------------------
  // Input: a tap starts a run. During a run: drag sideways to turn the aim, pull down for power, let go to shoot.
  // A tap without a drag aims at that spot. A short pull, or a gesture the feed takes over, never shoots.
  // ---------------------------------------------------------------------------
  session.startOnTap(window);
  window.addEventListener("pointerdown", (e) => {
    if (!playing() || drag) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, t0: performance.now(), moved: false };
    lastBand = -1;
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id || !playing()) return;
    const dx = e.clientX - drag.lx;
    drag.lx = e.clientX;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 9) drag.moved = true;
    if (phase !== "aim") return;
    const pull = clamp((e.clientY - drag.y0 - 14) / (stage.height * 0.3));
    aim += dx * ROT * (power > 0.05 ? FINE : 1);
    power = pull;
    const band = Math.floor(power * 10);
    if (band !== lastBand && power > 0.02) {
      if (lastBand >= 0) plink(audio, 60 + band * 2, 0.35);
      lastBand = band;
    }
  });
  const release = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!playing() || phase !== "aim") {
      power = 0;
      return;
    }
    if (!d.moved && performance.now() - d.t0 < 320) {
      // Tap to aim at a spot on the cloth.
      ndc.set((e.clientX / stage.width) * 2 - 1, -(e.clientY / stage.height) * 2 + 1);
      ray.setFromCamera(ndc, stage.camera);
      if (ray.ray.intersectPlane(plane, tmp)) {
        const c = cueBall();
        if (Math.hypot(tmp.x - c.x, tmp.z - c.z) > R * 1.2) {
          aim = Math.atan2(tmp.z - c.z, tmp.x - c.x);
          audio.play(S.rustle);
        }
      }
      power = 0;
      return;
    }
    if (power >= MIN_POWER) shoot(speedFor(power));
    else audio.play(S.rustle, { volume: 0.5 });
    power = 0;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      power = 0;
    }
  });
  session.on("cancel", () => {
    drag = null;
    power = 0;
  });
  let keyPower = 0.45;
  onKeys({
    left: () => {
      if (playing()) aim -= 0.026;
    },
    right: () => {
      if (playing()) aim += 0.026;
    },
    up: () => {
      keyPower = clamp(keyPower + 0.1, 0.1, 1);
    },
    down: () => {
      keyPower = clamp(keyPower - 0.1, 0.1, 1);
    },
    action: () => {
      if (playing()) shoot(speedFor(keyPower));
    },
  });

  session.on("start", () => {
    resetRun("play");
    audio.play(S.hop);
    music.start();
  });
  session.on("attract", () => resetRun("attract"));
  session.on("pause", () => music.stop());
  session.on("resume", () => {
    if (session.phase === "playing") music.start();
  });

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  const focus = new Vector3();
  let tableTop = 120;
  function layout() {
    const s = session.safe();
    hud.layout(s);
    const pv = session.preview();
    const sw = stage.width - pv.left - pv.right;
    sign.layout(pv.left + 12, pv.top + 8, Math.min(178, sw * 0.6), stage.ui.place);
    hud.placeBest(sign.left + 6, sign.bottom + 4);
    // The table sits a little below the middle so the HUD has the top band.
    const shift = (stage.height * 0.045) / stage.ppu;
    focus.set(0, 0, -shift / Math.sin(TILT));
    stage.look(focus);
    tableTop = stage.toScreen(tmp.set(0, 0.2, -HL - 0.5)).y;
    panel.layout(session.play(), stage.width, stage.height, tableTop);
  }
  session.on("insets", layout);
  stage.onResize(layout);

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function update(dt: number) {
    time += dt;
    phaseT += dt;
    session.tick(dt);
    shake.update(dt);
    flash.update(dt);

    // The clock.
    if (playing() && phase !== "over") {
      if (run.tick(dt, phase === "rack")) {
        audio.play(S.bonk);
        session.feedback("impact");
        if (phase === "aim") endRun();
        else panel.banner("Time!", "Let's see where they roll", P.ink, 1);
      }
      if (run.clutch && !clutchShown) {
        clutchShown = true;
        panel.banner("Last 8 seconds", "Pots count double", P.berryDeep, 1.1);
      }
      const sec = Math.ceil(run.clock);
      if (run.clock <= CLUTCH_T && sec !== lastTick && !run.buzzer) {
        lastTick = sec;
        audio.play(S.bubble, { pitch: (CLUTCH_T - sec) * 1.5, volume: 0.7 });
      }
    }

    // Attract (and QA autoplay builds): the pilot lines up, pulls back and shoots, visibly.
    const pilot = mode === "attract" ? DEMO : QA_AUTOPLAY && playing() ? QA_AUTOPLAY : null;
    if (mode === "attract") attractT += dt;
    if (pilot) {
      if (phase === "aim" && !demo && phaseT > 0.25) {
        const plan = choose(tab, pilot, rng);
        const ex = execute(plan, pilot, run.rack, rng);
        // Turn the short way round.
        let to = ex.angle;
        while (to - aim > Math.PI) to -= Math.PI * 2;
        while (to - aim < -Math.PI) to += Math.PI * 2;
        demo = { at: time + rng.range(pilot.think[0], pilot.think[1]), from: aim, to, speed: ex.speed, t0: time };
      }
      if (demo && phase === "aim") {
        const total = demo.at - demo.t0;
        const u = clamp((time - demo.t0) / Math.max(0.3, total - 0.45));
        const e = u * u * (3 - 2 * u);
        aim = lerp(demo.from, demo.to, e);
        const pullU = clamp((time - (demo.at - 0.45)) / 0.4);
        power = powerFor(demo.speed) * pullU;
        if (time >= demo.at) {
          aim = demo.to;
          const sp = demo.speed;
          demo = null;
          power = 0;
          shoot(sp);
        }
      }
      if (mode === "attract" && attractT > 80 && phase === "aim") resetRun("attract");
    }

    // Phases.
    if (phase === "strike" && phaseT >= STRIKE_T) {
      phase = "roll";
      phaseT = 0;
    }
    if (phase === "roll" && shot) {
      const s = shot;
      const k = Math.min(s.nFrames - 1, Math.floor(simT * 60));
      simT = Math.min(s.end, simT + dt * playbackRate(s.maxSpeed[k] ?? 0));
      while (evIdx < s.events.length && s.events[evIdx]!.t <= simT) {
        const ev = s.events[evIdx++]!;
        onEvent(ev.kind, ev.a, ev.x, ev.z, ev.power);
      }
      if (simT >= s.end) settle();
    }
    if (phase === "rack" && phaseT >= RACK_DROP_T) {
      phase = "aim";
      phaseT = 0;
    }

    placeBalls(dt);
    placeCue();
    placeGuide();
    placeCritters(dt);
    puffs.update(dt);

    // Camera: a little shake on big hits.
    const o = shake.offset;
    stage.look(tmp.copy(focus).add(new Vector3(o.x * 0.05, 0, o.y * 0.05)));

    // UI.
    const attractish = session.phase === "attract";
    sign.show(attractish);
    sign.update(dt);
    hud.showScore(mode === "play" && session.phase === "playing");
    hud.showBest(attractish && session.best !== null);
    hud.showHint(attractish);
    hud.setPrompt(attractish ? "Tap to start" : null);
    hud.update(dt, time);
    panel.showPlay(mode === "play" && session.phase === "playing");
    if (mode === "play") {
      panel.setClock(run.clock, run.clutch, light.pulse(time, 2, { still: 1 }));
      panel.setRack(run.rack + 1, ballsLeft());
    }
    const showPower = (mode === "play" && drag !== null && phase === "aim" && (power > 0.01 || drag.moved)) || (demo !== null && power > 0.01);
    panel.setPower(showPower ? power : null, power >= MIN_POWER);
    // First run: a ghost finger shows the drag, until the first pot.
    if (mode === "play" && !hintSeen && phase === "aim" && !drag && session.phase === "playing") {
      panel.setTip("Drag sideways to aim", "pull down for power, then let go");
      const cyc = 2.4;
      const t = time % cyc;
      const x0 = stage.width * 0.5;
      const y0 = stage.height * 0.62;
      const slide = clamp(t / 0.8);
      const pull = clamp((t - 0.95) / 0.6);
      const a = t < 0.2 ? t / 0.2 : t > cyc - 0.3 ? (cyc - t) / 0.3 : 1;
      panel.finger(x0 + Math.sin(slide * Math.PI) * 46, y0 + pull * 90, 0.9 * a, t > 0.1 && t < cyc - 0.35);
    } else if (demo) {
      const total = demo.at - demo.t0;
      const t = time - demo.t0;
      const turn = clamp(t / Math.max(0.3, total - 0.45));
      const pull = clamp((time - (demo.at - 0.45)) / 0.4);
      const x0 = stage.width * 0.55;
      const y0 = stage.height * 0.6;
      panel.finger(x0 + clamp((demo.to - demo.from) / ROT / 3, -70, 70) * turn, y0 + pull * 90, t < 0.2 ? t / 0.2 : 0.85, true);
      panel.setTip(null);
    } else {
      panel.finger(0, 0, 0);
      panel.setTip(null);
    }
    panel.update(dt);
    const fa = flash.alpha;
    flashEl.style.opacity = fa.toFixed(3);
    if (fa > 0) flashEl.style.background = flash.color;
  }

  function placeBalls(dt: number) {
    const s = phase === "roll" || phase === "strike" ? shot : null;
    const list = s ? s.after.balls : tab.balls;
    for (let i = 0; i < list.length; i++) {
      const b = list[i]!;
      const v = views[b.n]!;
      if (s && v.drop < 0) {
        sampleShot(s, i, simT, pos);
        v.root.position.set(pos.x, R, pos.z);
      } else if (!s && v.drop < 0 && v.land < 0) v.root.position.set(b.x, R, b.z);
      // Rolling: turn the ball by the distance it moved.
      const mx = v.root.position.x - v.lx;
      const mz = v.root.position.z - v.lz;
      const d = Math.hypot(mx, mz);
      if (d > 1e-5 && d < 1) {
        axis.set(mz / d, 0, -mx / d);
        q.setFromAxisAngle(axis, d / R);
        v.q.premultiply(q);
        v.mesh.quaternion.copy(v.q);
      }
      v.lx = v.root.position.x;
      v.lz = v.root.position.z;
    }
    for (const v of views) {
      if (v.drop >= 0) {
        v.drop += dt;
        const pk = POCKETS[v.pocket] ?? POCKETS[0]!;
        const k = clamp(v.drop / 0.22);
        v.root.position.set(lerp(v.from.x, pk.x, k), R - k * k * 0.55, lerp(v.from.z, pk.z, k));
        v.root.scale.setScalar(1 - k * 0.35);
        if (k >= 1) v.root.visible = false;
      } else if (v.land >= 0) {
        v.land += dt;
        const t = v.land - v.landDelay;
        if (t < 0) {
          v.root.visible = false;
          continue;
        }
        v.root.visible = true;
        const fall = clamp(t / 0.3);
        const y = (1 - fall * fall) * 3;
        const bounce = t > 0.3 ? Math.max(0, Math.sin(((t - 0.3) / 0.22) * Math.PI)) * 0.18 * Math.max(0, 1 - (t - 0.3) / 0.22) : 0;
        v.root.position.y = R + y + bounce;
        v.root.scale.setScalar(1);
        if (t >= 0.3 && t - dt < 0.3) {
          puffs.emit(v.root.position.x, 0.02, v.root.position.z, { count: 4, colors: [P.cream, P.lilac], speed: [0.3, 0.8], up: [0.5, 1.2], size: [0.03, 0.06], life: [0.2, 0.4], gravity: 8, floor: 0 });
          audio.play(S.tok, { volume: mode === "play" ? 0.25 : 0.08, pitch: 6 + rng.range(-2, 2) });
        }
        if (t > 0.52) {
          v.land = -1;
          v.root.position.y = R;
        }
      } else v.root.scale.setScalar(1);
    }
  }

  function placeCue() {
    const c = cueBall();
    const aiming = (phase === "aim" && (mode === "attract" || playing())) || phase === "strike";
    cue.visible = aiming && views[0]!.land < 0;
    if (!cue.visible) return;
    const dx = Math.cos(aim);
    const dz = Math.sin(aim);
    let pull = 0.06 + power * 0.85;
    if (phase === "strike") pull = lerp(pull, -0.02, clamp(phaseT / STRIKE_T));
    const p = views[0]!.root.position;
    cue.position.set(p.x - dx * (R + pull), R * 1.15, p.z - dz * (R + pull));
    cue.rotation.set(0, Math.atan2(dz, -dx), 0);
    void c;
  }

  let dotN = 0;
  const dotColor = new Color();
  function dot(x: number, z: number, color: string, s = 1) {
    if (dotN >= DOTS) return;
    mtx.makeScale(s, 1, s);
    mtx.setPosition(x, 0.012, z);
    dots.setMatrixAt(dotN, mtx);
    dots.setColorAt(dotN, dotColor.copy(col(color)));
    dotN++;
  }
  function line(x0: number, z0: number, dx: number, dz: number, len: number, step: number, color: string) {
    for (let d = 0; d <= len; d += step) dot(x0 + dx * d, z0 + dz * d, color, 1 - (d / Math.max(len, 0.01)) * 0.4);
  }
  function placeGuide() {
    dotN = 0;
    const show = phase === "aim" && (mode === "attract" || playing()) && views[0]!.land < 0;
    if (show) {
      const c = cueBall();
      const dx = Math.cos(aim);
      const dz = Math.sin(aim);
      const g = castGuide(tab, aim);
      const L = guideLengths(run.rack);
      const len = Math.hypot(g.ghost.x - c.x, g.ghost.z - c.z) - R * 1.6;
      line(c.x + dx * R * 1.4, c.z + dz * R * 1.4, dx, dz, Math.max(0, len), 0.17, P.cream);
      // The ghost ball: a ring where the cue ball will be at contact.
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        dot(g.ghost.x + Math.cos(a) * R, g.ghost.z + Math.sin(a) * R, P.cream, 0.85);
      }
      if (g.hit === "ball") {
        const ob = tab.balls[g.ball]!;
        // Racks 1-2 tint the object line green when it heads into a pocket.
        let onTarget = false;
        if (run.rack < 2)
          for (const pk of POCKETS) {
            const px = pk.x - ob.x;
            const pz = pk.z - ob.z;
            const along = px * g.objDir.x + pz * g.objDir.z;
            if (along > 0 && Math.abs(px * g.objDir.z - pz * g.objDir.x) < pk.r * 0.75) onTarget = true;
          }
        line(ob.x + g.objDir.x * R * 1.3, ob.z + g.objDir.z * R * 1.3, g.objDir.x, g.objDir.z, L.obj, 0.15, onTarget ? P.leafDeep : P.butterDeep);
        if (g.cueDir.x || g.cueDir.z) line(g.ghost.x + g.cueDir.x * R * 1.3, g.ghost.z + g.cueDir.z * R * 1.3, g.cueDir.x, g.cueDir.z, L.cue, 0.16, P.skyDeep);
      } else if ((g.hit === "cushion" || g.hit === "blocker") && L.bounce) {
        line(g.ghost.x + g.bounce.x * R, g.ghost.z + g.bounce.z * R, g.bounce.x, g.bounce.z, 1.3, 0.18, P.stoneDeep);
      }
    }
    dots.count = dotN;
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
  }

  function placeCritters(dt: number) {
    const c = views[0]!.root.position;
    for (const st of seats) {
      st.hopV -= 14 * dt;
      st.hopY = Math.max(0, st.hopY + st.hopV * dt);
      if (st.hopY <= 0 && st.hopV < 0) {
        if (st.hopV < -1.5) st.squash.velocity -= 2.5;
        st.hopV = 0;
      }
      st.squash.update(dt);
      const sq = st.squash.value;
      const breathe = reduced ? 0 : Math.sin(time * 2 + st.x) * 0.015;
      st.c.root.position.y = -1.4 + 0.455 + st.hopY * 0.35;
      st.c.body.scale.set(1 + (1 - sq) * 0.4, sq + breathe, 1 + (1 - sq) * 0.4);
      // Watch the cue ball.
      const want = Math.atan2(c.x - st.x, c.z - st.z) - st.yaw;
      let d = want;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      st.c.head.rotation.y = damp(st.c.head.rotation.y, clamp(d, -0.9, 0.9), 6, dt);
    }
    if (seats[0]) (seats[0].c as Fox).tail.rotation.y = Math.sin(time * 2.2) * 0.3;
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  hud.setBest(session.best);
  hud.setHint("Drag to aim · pull back · let go");
  resetRun("attract");
  layout();
  puffs.warm();
  dots.count = 1;
  update(0);
  stage.renderer.compile(scene, stage.camera);
  stage.renderer.compile(stage.ui.scene, stage.ui.camera);
  stage.render();
  puffs.clear();
  let frames = 0;
  let lastPhase = session.phase;
  tc.loop((dt) => {
    update(Math.min(dt, 1 / 20));
    if (session.phase !== lastPhase) {
      lastPhase = session.phase;
      layout();
    }
    stage.render();
    if (++frames === 2) session.ready();
  });
  void rackSpec;
}

void main();
