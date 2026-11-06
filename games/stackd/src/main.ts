import {
  clamp,
  Counter,
  createAudio,
  createRng,
  createSession,
  damp,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  FONT_MONO,
  HitStop,
  lerp,
  loadFonts,
  mix,
  onPress,
  Particles,
  PENTATONIC,
  Photosafe,
  midiToFreq,
  Popups,
  rgba,
  roundRect,
  safeRect,
  Shake,
  Spring,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
  type Material,
} from "three";
import { createStage } from "./stage.ts";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const BASE = 3.2;
/** Floors below the playable roof (they run off the bottom of the screen). */
const PLINTH = 14;
const LAYER_H = 0.5;
const PERFECT = 0.1;
const MAX_SWEEPS = 5;
const ACCENT = "#3DE0FF";
const VIEW_H = 19;
const ACCENT_GLOW = new Color(ACCENT);
const WARN_GLOW = new Color("#FF4A3D");
/** The warning starts at its dark point so it fades in instead of popping on. */
const WARN_PULSE = { phase: -Math.PI / 2 };

const speedFor = (n: number) => lerp(2.7, 6.4, clamp(n / 45));
const rangeFor = (n: number) => lerp(4.6, 5.6, clamp(n / 60));

/** Layer colors: a curated walk from dusk teal through mint and lime into warm neon, then around again. */
const LAYER_STOPS = ["#2EC4D6", "#3DE0FF", "#5CE6C0", "#A8EE7A", "#FFD166", "#FF9F6E", "#FF6F91", "#4FB3FF"];
const LAYERS_PER_STOP = 5;
function layerColor(i: number): string {
  const f = i / LAYERS_PER_STOP;
  const a = LAYER_STOPS[Math.floor(f) % LAYER_STOPS.length]!;
  const b = LAYER_STOPS[(Math.floor(f) + 1) % LAYER_STOPS.length]!;
  return mix(a, b, f - Math.floor(f));
}

interface Slab {
  mesh: Mesh;
  x: number;
  z: number;
  w: number;
  d: number;
  y: number;
  color: string;
  squash: Spring;
}

interface Piece {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  life: number;
}

// Window mask texture: black body, white windows (used as an emissive map so windows glow at night).
function windowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 32);
  const rnd = createRng(7);
  for (let col = 0; col < 8; col++) {
    const lit = rnd() < 0.62;
    g.fillStyle = lit ? `rgba(255,255,255,${0.55 + rnd() * 0.45})` : "rgba(255,255,255,0.06)";
    g.fillRect(col * 8 + 2, 11, 4, 10);
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "stackd" }), loadFonts()]);

  // Background canvas (sky, stars, city), WebGL in the middle, HUD on top.
  const bg = document.createElement("canvas");
  bg.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block";
  document.body.appendChild(bg);
  const bgx = bg.getContext("2d", { alpha: false })!;
  const stage = createStage({ alpha: true, clear: 0x000000 });
  const { renderer, hud } = stage;
  let W = stage.width;
  let H = stage.height;
  const sizeBg = () => {
    bg.width = Math.round(W * Math.min(stage.dpr, 1.5));
    bg.height = Math.round(H * Math.min(stage.dpr, 1.5));
  };
  sizeBg();

  const audio = createAudio();
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.02, 1.9, session.reducedMotion);
  // Glows and warnings go through Photosafe: capped at 2 Hz, slower and softer under reduced motion.
  const light = new Photosafe(session.reducedMotion);
  /** The perfect-drop light-up: roof glow and window blaze, each fading over its own time (s). */
  const PERFECT_FX = light.reduced ? { roof: 0.3, roofT: 0.6, windows: 0.9, windowsT: 0.8 } : { roof: 0.8, roofT: 0.25, windows: 2.4, windowsT: 0.5 };
  const hitStop = new HitStop();
  const fx = new Particles(500);
  const popups = new Popups();
  const counter = new Counter(0, 16);

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const fitCamera = () => {
    const aspect = W / H;
    camera.left = (-VIEW_H * aspect) / 2;
    camera.right = (VIEW_H * aspect) / 2;
    camera.top = VIEW_H / 2;
    camera.bottom = -VIEW_H / 2;
    camera.updateProjectionMatrix();
  };
  fitCamera();
  stage.onResize((w, h) => {
    W = w;
    H = h;
    sizeBg();
    fitCamera();
  });

  scene.add(new HemisphereLight(0xcfe8ff, 0x1a1030, 1.9));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-6, 12, 4);
  scene.add(sun);

  const winTex = windowTexture();
  const geoCache = new BoxGeometry(1, 1, 1);

  function makeMaterials(color: string, w: number, d: number): Material[] {
    const base = new Color(color);
    const top = new MeshLambertMaterial({ color: base.clone().offsetHSL(0, 0, 0.08) });
    const bottom = new MeshLambertMaterial({ color: base.clone().offsetHSL(0, -0.1, -0.25) });
    const side = (repeat: number) => {
      const map = winTex.clone();
      map.repeat.set(Math.max(0.25, repeat / 1.1), 1);
      return new MeshLambertMaterial({ color: base.clone().offsetHSL(0, -0.05, -0.12), emissive: new Color("#FFD59A"), emissiveMap: map, emissiveIntensity: 0.9 });
    };
    const sx = side(d);
    const sz = side(w);
    return [sx, sx, top, bottom, sz, sz];
  }

  function makeSlab(x: number, y: number, z: number, w: number, d: number, color: string): Slab {
    const mesh = new Mesh(geoCache, makeMaterials(color, w, d));
    mesh.scale.set(w, LAYER_H, d);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    return { mesh, x, z, w, d, y, color, squash: new Spring(1, 520, 16) };
  }

  function disposeMesh(m: Mesh) {
    scene.remove(m);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const lm = mat as MeshLambertMaterial;
      if (lm.emissiveMap && lm.emissiveMap !== winTex) lm.emissiveMap.dispose();
      mat.dispose();
    }
  }

  /** A perfect drop lights the new floor: the roof flashes and every window blazes, then settles to its night glow. */
  function settleFlash() {
    if (!flashSlab) return;
    const mats = flashSlab.slab.mesh.material as MeshLambertMaterial[];
    mats[2]!.emissive.setRGB(0, 0, 0);
    for (const i of [0, 4]) mats[i]!.emissiveIntensity = 0.9;
    flashSlab = null;
  }

  // ---------------------------------------------------------------------------
  // World
  // ---------------------------------------------------------------------------
  let tower: Slab[] = [];
  let pieces: Piece[] = [];
  let moving: (Slab & { axis: "x" | "z"; pos: number; dir: number; speed: number; range: number }) | null = null;
  let score = 0;
  let combo = 0;
  let over = false;
  let overT = 0;
  let endSent = false;
  let mode: "attract" | "play" = "attract";
  let time = 0;
  let camY = 0;
  let camZoom = 1;
  let titleIn = 0;
  let aiTimer = 0;
  let aiError = 0;
  /** Direction flips of the current slab. The crane lets go after MAX_SWEEPS — no stalling forever. */
  let sweeps = 0;
  /** Seconds the last-sweep warning has been glowing. */
  let warnT = 0;
  let flashSlab: { slab: Slab; t: number } | null = null;

  const top = () => tower[tower.length - 1]!;

  function clearWorld() {
    for (const s of tower) disposeMesh(s.mesh);
    for (const p of pieces) disposeMesh(p.mesh);
    if (moving) disposeMesh(moving.mesh);
    flashSlab = null;
    tower = [];
    pieces = [];
    moving = null;
  }

  function resetWorld(m: "attract" | "play") {
    mode = m;
    clearWorld();
    score = 0;
    combo = 0;
    over = false;
    overT = 0;
    endSent = false;
    counter.snap(0);
    // The building's lower floors run down into the city; the game starts on its roof.
    for (let i = 0; i < PLINTH; i++) {
      const k = i / (PLINTH - 1);
      tower.push(makeSlab(0, (i - PLINTH + 1) * LAYER_H, 0, BASE, BASE, mix("#16213F", layerColor(0), 0.15 + k * 0.6)));
    }
    if (m === "attract") {
      // The demo picks up a tower already in progress, so the title screen shows a building.
      let x = 0;
      let z = 0;
      let w = BASE;
      let d = BASE;
      for (let i = 1; i <= 5; i++) {
        const cut = rng.range(0.05, 0.35);
        if (i % 2) {
          w -= cut;
          x += (rng.chance(0.5) ? 1 : -1) * (cut / 2);
        } else {
          d -= cut;
          z += (rng.chance(0.5) ? 1 : -1) * (cut / 2);
        }
        tower.push(makeSlab(x, top().y + LAYER_H, z, w, d, layerColor(i)));
      }
    }
    camY = top().y;
    camZoom = 1;
    spawnMoving();
  }

  function spawnMoving() {
    const t = top();
    const n = tower.length - PLINTH;
    const axis = n % 2 === 0 ? "x" : "z";
    const range = rangeFor(n);
    const dir = rng.chance(0.5) ? 1 : -1;
    const slab = makeSlab(axis === "x" ? -range * dir : t.x, t.y + LAYER_H, axis === "z" ? -range * dir : t.z, t.w, t.d, layerColor(n + 1));
    moving = { ...slab, axis, pos: -range * dir, dir, speed: speedFor(n) * (mode === "attract" ? 0.9 : 1), range };
    aiError = (rng() - 0.5) * (rng.chance(0.3) ? 0.05 : 0.5);
    aiTimer = 0;
    sweeps = 0;
    warnT = 0;
  }

  function screenOf(x: number, y: number, z: number): { x: number; y: number } {
    const v = new Vector3(x, y, z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
  }

  function drop() {
    if (!moving || over) return;
    const t = top();
    const m = moving;
    const delta = m.axis === "x" ? m.mesh.position.x - t.x : m.mesh.position.z - t.z;
    const size = m.axis === "x" ? t.w : t.d;
    const n = tower.length - PLINTH;
    disposeMesh(m.mesh);
    moving = null;

    if (Math.abs(delta) <= PERFECT) {
      combo++;
      let w = t.w;
      let d = t.d;
      // A streak of perfects grows the slab back toward full size.
      if (combo >= 3) {
        if (m.axis === "x") w = Math.min(BASE, w + 0.14);
        else d = Math.min(BASE, d + 0.14);
      }
      const slab = makeSlab(t.x, t.y + LAYER_H, t.z, w, d, m.color);
      tower.push(slab);
      slab.squash.snap(0.72);
      settleFlash();
      flashSlab = { slab, t: 0 };
      if (mode === "play") {
        score += 1;
        const note = PENTATONIC[Math.min(combo - 1, PENTATONIC.length - 1)]!;
        audio.note(midiToFreq(72 + note), 0.28, "triangle", 0.3);
        audio.play("tick");
        const p = screenOf(slab.x, slab.y, slab.z);
        popups.add(combo > 1 ? `PERFECT ×${combo}` : "PERFECT", p.x, p.y - 40, ACCENT, 18, 0.9);
        fx.emit(p.x, p.y, { count: 18 + combo * 2, speed: [80, 260], life: [0.3, 0.7], size: [2, 5], colors: [ACCENT, "#FFFFFF", m.color], drag: 2.5, shape: "square" });
        shake.add(0.1);
        tc.feedback("success");
      }
    } else {
      const overlap = size - Math.abs(delta);
      if (overlap <= 0) {
        // Missed the tower completely: the slab falls.
        const piece = makeSlab(m.mesh.position.x, m.mesh.position.y, m.mesh.position.z, m.w, m.d, m.color);
        pieces.push({ mesh: piece.mesh, vel: new Vector3(m.axis === "x" ? m.dir * m.speed : 0, 0, m.axis === "z" ? m.dir * m.speed : 0), spin: new Vector3(rng.range(-2, 2), 0, rng.range(-2, 2)), life: 4 });
        gameOver();
        return;
      }
      combo = 0;
      const sign = Math.sign(delta);
      const keepCenter = (m.axis === "x" ? t.x : t.z) + delta / 2;
      const cutCenter = keepCenter + sign * (overlap / 2 + Math.abs(delta) / 2);
      const w = m.axis === "x" ? overlap : t.w;
      const d = m.axis === "z" ? overlap : t.d;
      const x = m.axis === "x" ? keepCenter : t.x;
      const z = m.axis === "z" ? keepCenter : t.z;
      const slab = makeSlab(x, t.y + LAYER_H, z, w, d, m.color);
      slab.squash.snap(0.82);
      tower.push(slab);
      const cw = m.axis === "x" ? Math.abs(delta) : t.w;
      const cd = m.axis === "z" ? Math.abs(delta) : t.d;
      const cut = makeSlab(m.axis === "x" ? cutCenter : t.x, t.y + LAYER_H, m.axis === "z" ? cutCenter : t.z, cw, cd, m.color);
      pieces.push({
        mesh: cut.mesh,
        vel: new Vector3(m.axis === "x" ? sign * 1.6 : 0, 1.2, m.axis === "z" ? sign * 1.6 : 0),
        spin: new Vector3(m.axis === "z" ? sign * 3 : rng.range(-0.6, 0.6), 0, m.axis === "x" ? -sign * 3 : rng.range(-0.6, 0.6)),
        life: 3,
      });
      if (mode === "play") {
        score += 1;
        audio.play("thud", { pitch: Math.min(12, n * 0.25) });
        audio.play("slice", { volume: 0.6 });
        const p = screenOf(slab.x, slab.y, slab.z);
        fx.emit(p.x, p.y + 6, { count: 10, speed: [40, 160], angle: [Math.PI * 1.05, Math.PI * 1.95], life: [0.25, 0.5], size: [2, 4], colors: ["#FFFFFF", m.color], gravity: 400, drag: 2 });
        shake.add(0.16);
        tc.feedback("tap");
      }
    }
    spawnMoving();
  }

  function gameOver() {
    if (mode === "attract") {
      // The demo builder lost one: start a fresh tower after a beat.
      over = true;
      overT = 0;
      return;
    }
    over = true;
    overT = 0;
    hitStop.freeze(0.08);
    shake.add(0.5);
    audio.play("lose");
    tc.feedback("fail");
  }

  // Input: a tap starts a run (release); during a run each press drops the slab.
  session.startOnTap(window);
  onPress(window, () => {
    if (session.phase === "playing" && mode === "play" && !over) drop();
  });
  session.on("start", () => resetWorld("play"));
  session.on("cancel", () => {
    /* a press is instantaneous; nothing to undo */
  });
  resetWorld("attract");

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------
  function updateMoving(dt: number) {
    const m = moving;
    if (!m) return;
    m.pos += m.dir * m.speed * dt;
    if (Math.abs(m.pos) > m.range) {
      m.pos = Math.sign(m.pos) * m.range;
      m.dir *= -1;
      sweeps++;
      if (mode === "play" && sweeps >= MAX_SWEEPS && !over) {
        // The crane lets go.
        audio.play("error");
        drop();
        return;
      }
    }
    if (mode === "play") {
      // Last sweep: the slab glows hot as a warning (rising from dark at 1.8 Hz; 0.5 Hz under reduced motion).
      const roof = (m.mesh.material as MeshLambertMaterial[])[2]!;
      if (sweeps >= MAX_SWEEPS - 1) {
        warnT += dt;
        roof.emissive.copy(WARN_GLOW).multiplyScalar(0.08 + 0.62 * light.pulse(warnT, 1.8, WARN_PULSE));
      } else roof.emissive.setRGB(0, 0, 0);
    }
    const t = top();
    if (m.axis === "x") m.mesh.position.set(t.x + m.pos, t.y + LAYER_H, t.z);
    else m.mesh.position.set(t.x, t.y + LAYER_H, t.z + m.pos);
    // The demo builder drops when the slab lines up (with a little human error).
    if (mode === "attract" && !over) {
      aiTimer += dt;
      if (aiTimer > 0.6 && Math.abs(m.pos - aiError) < m.speed * dt * 1.2) drop();
    }
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    const dt = hitStop.scale(rawDt);
    time += rawDt;
    shake.update(rawDt);
    fx.update(rawDt);
    popups.update(rawDt);
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    counter.set(score);
    counter.update(rawDt);

    if (moving) updateMoving(dt);

    for (const s of tower) {
      s.squash.target = 1;
      const k = s.squash.update(rawDt);
      s.mesh.scale.y = LAYER_H * k;
      s.mesh.position.y = s.y - (LAYER_H * (1 - k)) / 2;
    }
    if (flashSlab) {
      flashSlab.t += rawDt;
      const mats = flashSlab.slab.mesh.material as MeshLambertMaterial[];
      const roof = Math.max(0, 1 - flashSlab.t / PERFECT_FX.roofT);
      const windows = Math.max(0, 1 - flashSlab.t / PERFECT_FX.windowsT);
      mats[2]!.emissive.copy(ACCENT_GLOW).multiplyScalar(roof * PERFECT_FX.roof);
      for (const i of [0, 4]) mats[i]!.emissiveIntensity = 0.9 + windows * PERFECT_FX.windows;
      if (windows <= 0) settleFlash();
    }
    for (const p of pieces) {
      p.vel.y -= 16 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      p.life -= dt;
    }
    pieces = pieces.filter((p) => {
      if (p.life > 0) return true;
      disposeMesh(p.mesh);
      return false;
    });

    // Camera: follow the top; after game over pull back to show the whole tower.
    const topY = top().y;
    if (over) {
      overT += rawDt;
      if (mode === "play") {
        const height = topY + LAYER_H * 2;
        const fit = clamp((VIEW_H * 0.72) / Math.max(VIEW_H * 0.72, height + 3), 0.18, 1);
        camZoom = damp(camZoom, fit, 3, rawDt);
        camY = damp(camY, height / 2 - 1, 3, rawDt);
        if (!endSent && overT > 0.55) {
          endSent = true;
          session.end(score, { outcome: "lose", stats: { height: tower.length - PLINTH } });
        }
      } else if (overT > 1.2) {
        resetWorld("attract");
      }
    } else {
      camY = damp(camY, topY, 6, rawDt);
      camZoom = damp(camZoom, 1, 4, rawDt);
      if (mode === "attract" && tower.length > PLINTH + 24) resetWorld("attract");
    }
    // Attract keeps the tower low on screen so the title has room above it.
    const lift = mode === "attract" ? 0.6 : 2.6;
    const o = shake.offset;
    camera.position.set(9 + o.x * 0.02, camY + 8 + lift + o.y * 0.02, 9);
    camera.lookAt(0, camY + lift, 0);
    camera.zoom = camZoom;
    camera.updateProjectionMatrix();
  }

  function drawBackground() {
    const k = bg.width / W;
    bgx.setTransform(k, 0, 0, k, 0, 0);
    const height = Math.max(0, top().y);
    const alt = clamp(height / 30);
    const g = bgx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix("#0E1838", "#04040C", alt));
    g.addColorStop(0.55, mix("#1D2D5C", "#0B0F26", alt));
    g.addColorStop(1, mix("#E0745A", "#2A1F4D", alt));
    bgx.fillStyle = g;
    bgx.fillRect(0, 0, W, H);
    // Stars fade in with altitude.
    const starRng = createRng(99);
    for (let i = 0; i < 70; i++) {
      const x = starRng() * W;
      const y = (starRng() * H * 0.8 + height * 6) % (H * 0.85);
      const tw = 0.5 + 0.5 * Math.sin(time * (1 + starRng() * 2) + i);
      bgx.globalAlpha = (0.15 + alt * 0.85) * tw * 0.8;
      bgx.fillStyle = "#F3F0E8";
      const s = starRng() < 0.15 ? 2 : 1;
      bgx.fillRect(x, y, s, s);
    }
    bgx.globalAlpha = 1;
    // City skyline sinking as the tower rises (parallax).
    const sink = height * 9;
    const cityRng = createRng(5);
    for (let layer = 0; layer < 2; layer++) {
      bgx.fillStyle = layer === 0 ? "#2B2350" : "#160F2E";
      let x = -20;
      while (x < W + 20) {
        const bw = 26 + cityRng() * 46;
        const bh = (layer === 0 ? 120 : 70) + cityRng() * (layer === 0 ? 150 : 110);
        const y = H - bh + sink * (layer === 0 ? 0.6 : 1);
        bgx.fillRect(x, y, bw, bh + 400);
        if (layer === 1) {
          bgx.fillStyle = "rgba(255,213,154,0.55)";
          for (let wy = y + 10; wy < H; wy += 14) for (let wx = x + 5; wx < x + bw - 6; wx += 9) if (cityRng() < 0.3) bgx.fillRect(wx, wy, 3, 5);
          bgx.fillStyle = "#160F2E";
        }
        x += bw + 2;
      }
    }
  }

  /** Ink capsule behind the prompt so it reads over the lit windows. */
  function promptPill(g: CanvasRenderingContext2D, x: number, y: number, w = 200) {
    g.fillStyle = "rgba(13,13,16,0.62)";
    roundRect(g, x - w / 2, y - 17, w, 34, 17);
    g.fill();
  }

  function drawHud() {
    stage.beginHud();
    const g = hud;
    fx.draw(g);
    popups.draw(g, FONT_MONO);
    if (mode === "play") {
      if (session.phase === "playing") {
        const shown = Math.round(counter.shown);
        drawNumber(g, shown, W / 2, session.play().top + 52, 52, "#F3F0E8");
        drawLabel(g, shown === 1 ? "FLOOR" : "FLOORS", W / 2, session.play().top + 86, rgba("#F3F0E8", 0.6), 11);
        if (combo >= 2 && !over) drawLabel(g, `PERFECT STREAK ${combo}`, W / 2, session.play().top + 106, ACCENT, 11);
      } else if (session.standalone && session.phaseTime > 0.7) {
        // In the feed the shell's result card takes over; a bare tab needs its own retry prompt.
        const r = safeRect(session.preview(), W, H);
        drawNumber(g, score, r.x + r.w / 2, r.y + 64, 56, "#F3F0E8");
        drawLabel(g, score === 1 ? "FLOOR" : "FLOORS", r.x + r.w / 2, r.y + 100, rgba("#F3F0E8", 0.7), 11);
        promptPill(g, r.x + r.w / 2, r.y + r.h - 20, 236);
        drawTapPrompt(g, r.x + r.w / 2, r.y + r.h - 20, time, "#F3F0E8", "TAP TO BUILD AGAIN");
      }
      return;
    }
    const r = safeRect(session.preview(), W, H);
    const cx = r.x + r.w / 2;
    const ty = r.y + 70;
    const k = easeOutBack(titleIn);
    g.save();
    g.translate(cx, ty);
    g.scale(k, k);
    drawTitle(g, "STACKD", 0, 0, r.w - 10, "#F3F0E8", 60, rgba(ACCENT, 0.9));
    g.restore();
    drawLabel(g, "BUILD IT TALL. DROP IT CLEAN.", cx, ty + 28, rgba("#F3F0E8", 0.75), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best} FLOORS`, cx, ty + 50, ACCENT, 13);
    promptPill(g, cx, r.y + r.h - 20);
    drawTapPrompt(g, cx, r.y + r.h - 20, time, "#F3F0E8");
  }

  // Compile every shader variant up front (slab, falling piece) so no frame after ready() stalls.
  update(0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  let frames = 0;
  tc.loop((dt) => {
    update(dt);
    drawBackground();
    renderer.render(scene, camera);
    drawHud();
    // ready() on the second frame: the first one pays for GPU uploads.
    if (++frames === 2) session.ready();
  });
}

void main();
