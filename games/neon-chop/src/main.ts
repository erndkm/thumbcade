import "pixi.js/unsafe-eval";
import {
  clamp,
  createAudio,
  createRng,
  createSession,
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
  onDrag,
  Photosafe,
  Popups,
  rgba,
  safeRect,
  Shake,
  type SfxParams,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { Application, Container, Graphics, GraphicsContext, Sprite, Texture, Ticker } from "pixi.js";
import { centroid, distToSegment, rotatePoly, scalePoly, splitPoly, type Poly } from "./geometry.ts";
import { KINDS, STATIC, SURGE, type Kind } from "./kinds.ts";
import { createQuality } from "./quality.ts";

const BG = "#0C0912";
const ACCENT = "#FF3D6E";
const PAPER = "#F3F0E8";
const GRAVITY = 980;
const MAX_STRIKES = 3;
/** How many produce a surge cell arcs into. */
const SURGE_ARCS = 3;

const CRACK: SfxParams = { wave: "noise", freq: 900, freqEnd: 240, duration: 0.16, volume: 0.22, lowpass: 2400, punch: 2 };
const SURGE_SFX: SfxParams = { wave: "sawtooth", freq: 1900, freqEnd: 420, duration: 0.32, volume: 0.13, lowpass: 4600, vibrato: [1.2, 28] };
const LAUNCH: SfxParams = { wave: "noise", freq: 300, freqEnd: 900, attack: 0.04, duration: 0.22, volume: 0.07, lowpass: 1600 };

interface Item {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  node: Container;
  core: Graphics | null;
  seeds: Array<[number, number]>;
  alive: boolean;
}

interface Half {
  node: Container;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
}

interface Bit {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  gravity: number;
  drag: number;
  scale0: number;
}

/** A light streak left along a cut: additive, gone in half a second. */
interface Decal {
  sprite: Sprite;
  life: number;
}

/** A surge arc between two produce. */
interface Arc {
  g: Graphics;
  life: number;
}

interface Pending {
  at: number;
  kind: Kind;
  x0: number;
  apex: number;
  targetX: number;
}

function makeTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  return Texture.from(c);
}

async function main() {
  const [session] = await Promise.all([createSession({ id: "neon-chop" }), loadFonts()]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = window.innerWidth;
  let H = window.innerHeight;

  const app = new Application();
  await app.init({
    width: W,
    height: H,
    resolution: dpr,
    autoDensity: true,
    // MSAA costs more than it gives at resolution 2; the neon edges stay crisp without it.
    antialias: false,
    background: BG,
    autoStart: false,
    preference: "webgl",
  });
  // Pixi's own tickers would keep requestAnimationFrame alive through a pause; we drive them from tc.loop.
  app.ticker.stop();
  Ticker.system.autoStart = false;
  Ticker.system.stop();
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
  app.canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  document.body.appendChild(app.canvas);

  // 2D overlay for type (kit fonts + helpers), never intercepts input.
  const hud = document.createElement("canvas");
  hud.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none";
  document.body.appendChild(hud);
  const hctx = hud.getContext("2d")!;
  const sizeHud = () => {
    hud.width = Math.round(W * dpr);
    hud.height = Math.round(H * dpr);
  };
  sizeHud();
  window.addEventListener("resize", () => {
    W = window.innerWidth;
    H = window.innerHeight;
    app.renderer.resize(W, H);
    sizeHud();
    drawBackdrop();
  });

  const audio = createAudio();
  /** Haptics only during a run: attract mode must never buzz a phone that's just scrolling the feed. */
  const haptic = (kind: "tap" | "success" | "fail" | "impact") => {
    if (session.phase === "playing") tc.feedback(kind);
  };
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(14, 0.03, 1.7, session.reducedMotion);
  const hitStop = new HitStop();
  const popups = new Popups();
  // Photosensitivity: the static blast is one capped, rate-limited flash; under reduced motion a faint tint.
  const light = new Photosafe(session.reducedMotion);
  const flash = light.flash({ alpha: 0.25, decay: 0.35 });

  // Textures.
  const glowTex = makeTexture(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,0.9)");
    r.addColorStop(0.35, "rgba(255,255,255,0.35)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
  const dotTex = makeTexture(32, (g, s) => {
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
    g.fill();
  });
  // A thin bar of light, bright in the middle and fading at both ends; stretched along each cut.
  const streakTex = makeTexture(128, (g, s) => {
    const along = g.createLinearGradient(0, 0, s, 0);
    along.addColorStop(0, "rgba(255,255,255,0)");
    along.addColorStop(0.5, "rgba(255,255,255,1)");
    along.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = along;
    g.fillRect(0, s / 2 - 5, s, 10);
    g.globalCompositeOperation = "destination-in";
    const across = g.createLinearGradient(0, s / 2 - 5, 0, s / 2 + 5);
    across.addColorStop(0, "rgba(255,255,255,0)");
    across.addColorStop(0.5, "rgba(255,255,255,1)");
    across.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = across;
    g.fillRect(0, 0, s, s);
  });

  // Layers.
  const backdrop = new Sprite(Texture.EMPTY);
  const halfLayer = new Container();
  const itemLayer = new Container();
  const fxLayer = new Container();
  const blade = new Graphics();
  blade.blendMode = "add";
  const world = new Container();
  world.addChild(halfLayer, itemLayer, fxLayer, blade);
  app.stage.addChild(backdrop, world);

  /** The whole static backdrop baked into one opaque texture (one quad per frame instead of several additive layers). */
  function drawBackdrop() {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.fillStyle = BG;
    g.fillRect(0, 0, W, H);
    const glow = (x: number, y: number, rx: number, ry: number, color: string, a: number) => {
      g.save();
      g.translate(x, y);
      g.scale(1, ry / rx);
      const r = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      r.addColorStop(0, rgba(color, a));
      r.addColorStop(1, rgba(color, 0));
      g.fillStyle = r;
      g.fillRect(-rx, -rx, rx * 2, rx * 2);
      g.restore();
    };
    glow(W / 2, H * 0.42, Math.max(W, H) * 0.55, Math.max(W, H) * 0.55, "#7A2CFF", 0.09);
    glow(W / 2, H + 40, W * 0.8, H * 0.25, ACCENT, 0.16);
    // Market-sign hexagons, very faint.
    const cx = W / 2;
    const cy = H * 0.42;
    g.lineWidth = 1.5;
    for (let i = 1; i <= 5; i++) {
      const r = i * Math.max(W, H) * 0.14;
      g.strokeStyle = rgba(i % 2 ? ACCENT : "#7FE3FF", 0.05 + 0.012 * (5 - i));
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k / 6) * Math.PI * 2;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
      g.stroke();
    }
    g.fillStyle = rgba(PAPER, 0.06);
    for (let y = 24; y < H; y += 32) for (let x = 16; x < W; x += 32) g.fillRect(x, y, 1.5, 1.5);
    const old = backdrop.texture;
    backdrop.texture = Texture.from(c);
    backdrop.width = W;
    backdrop.height = H;
    if (old !== Texture.EMPTY) old.destroy(true);
  }
  drawBackdrop();

  // State.
  let items: Item[] = [];
  let halves: Half[] = [];
  const bits: Bit[] = [];
  const freeBits: Sprite[] = [];
  const decals: Decal[] = [];
  const arcs: Arc[] = [];
  let pending: Pending[] = [];
  let mode: "attract" | "play" = "attract";
  let score = 0;
  let strikes = 0;
  let strikeFlash = 0;
  let elapsed = 0;
  let spawnTimer = 0.4;
  let lastSurgeAt = -99;
  let overT = -1;
  let endSent = false;
  let time = 0;
  let titleIn = 0;
  let combo = 0;
  let comboTimer = 0;
  let maxCombo = 0;
  let cutsTotal = 0;
  const trail: Array<{ x: number; y: number; t: number }> = [];
  let bladeDown = false;
  let ai: { ax: number; ay: number; bx: number; by: number; t: number; dur: number } | null = null;
  let aiCooldown = 1;

  // --- spawning ---------------------------------------------------------------------------
  const contexts = new Map<string, { body: GraphicsContext; core: GraphicsContext | null }>();
  function shapeContext(kind: Kind): { body: GraphicsContext; core: GraphicsContext | null } {
    let c = contexts.get(kind.id);
    if (c) return c;
    const body = new GraphicsContext();
    let core: GraphicsContext | null = null;
    if (kind.special === "static") {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        body
          .moveTo(Math.cos(a) * kind.radius * 0.8, Math.sin(a) * kind.radius * 0.8)
          .lineTo(Math.cos(a) * kind.radius * 1.32, Math.sin(a) * kind.radius * 1.32)
          .stroke({ width: 4, color: "#FF2D2D", cap: "square" });
      }
      body.poly(kind.shape).fill({ color: "#140A0E" }).stroke({ width: 3.5, color: "#FF2D2D" });
      body.poly(scalePoly(kind.shape, 0.55)).stroke({ width: 2, color: "#FF2D2D", alpha: 0.5 });
      core = new GraphicsContext().circle(0, 0, kind.radius * 0.3).fill({ color: "#FF6B5A" });
    } else {
      body.poly(kind.shape).fill({ color: mix(kind.shell, BG, 0.72) }).stroke({ width: 4, color: kind.shell, join: "round" });
      body.poly(scalePoly(kind.shape, 0.62)).stroke({ width: 2, color: kind.shell, alpha: 0.38, join: "round" });
      // Specular tick.
      body.moveTo(-kind.radius * 0.45, -kind.radius * 0.35).lineTo(-kind.radius * 0.18, -kind.radius * 0.55).stroke({ width: 4, color: PAPER, alpha: 0.75, cap: "round" });
      if (kind.special === "surge") {
        // A bolt marks the charged cell.
        const bolt = [0.08, -0.6, -0.3, 0.08, -0.02, 0.08, -0.12, 0.6, 0.3, -0.1, 0.02, -0.1].map((v) => v * kind.radius);
        body.poly(bolt).fill({ color: PAPER, alpha: 0.95 });
      }
    }
    c = { body, core };
    contexts.set(kind.id, c);
    return c;
  }

  function buildItem(kind: Kind): Item {
    const node = new Container();
    const glow = new Sprite(glowTex);
    glow.anchor.set(0.5);
    glow.tint = kind.shell;
    glow.blendMode = "add";
    glow.width = glow.height = kind.radius * 3.6;
    glow.alpha = kind.special === "static" ? 0.55 : 0.42;
    // Whole produce shares one geometry per kind: built once, never leaked.
    const shared = shapeContext(kind);
    const body = new Graphics(shared.body);
    let core: Graphics | null = null;
    if (shared.core) {
      core = new Graphics(shared.core);
      core.blendMode = "add";
    }
    node.addChild(glow, body);
    if (core) node.addChild(core);
    const seeds: Array<[number, number]> = [];
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng.range(0.15, 0.55) * kind.radius;
      seeds.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    itemLayer.addChild(node);
    return { kind, x: 0, y: 0, vx: 0, vy: 0, rot: rng() * Math.PI, vr: rng.range(-2.4, 2.4), node, core, seeds, alive: true };
  }

  function launch(p: Pending) {
    const it = buildItem(p.kind);
    const y0 = H + p.kind.radius + 10;
    const g = GRAVITY * gravityScale();
    it.x = p.x0;
    it.y = y0;
    it.vy = -Math.sqrt(2 * g * (y0 - p.apex));
    const tApex = -it.vy / g;
    it.vx = (p.targetX - p.x0) / (tApex * 2);
    items.push(it);
  }

  const difficulty = () => clamp(elapsed / 70);
  const gravityScale = () => (mode === "play" ? lerp(1, 1.18, difficulty()) : 1);

  function queueWave() {
    const d = mode === "play" ? difficulty() : 0.25;
    const count = mode === "play" ? 1 + Math.floor(rng() * lerp(2.2, 4.8, d)) : rng.int(2, 3);
    const bombChance = mode === "play" ? (elapsed < 6 ? 0 : lerp(0.1, 0.24, d)) : 0.12;
    const now = time;
    // In attract, produce peaks below the title block so the logo stays readable.
    const top = mode === "play" ? session.play().top + 60 : session.preview().top + 200;
    for (let i = 0; i < count; i++) {
      let kind: Kind = rng.pick(KINDS);
      if (rng.chance(bombChance)) kind = STATIC;
      if (mode === "play" && elapsed > 14 && elapsed - lastSurgeAt > 18 && rng.chance(0.08)) {
        kind = SURGE;
        lastSurgeAt = elapsed;
      }
      const x0 = rng.range(W * 0.14, W * 0.86);
      pending.push({
        at: now + i * rng.range(0.08, 0.22),
        kind,
        x0,
        apex: rng.range(top, Math.max(top + 40, H * (mode === "play" ? 0.46 : 0.55))),
        targetX: clamp(x0 + rng.range(-W * 0.35, W * 0.35), W * 0.18, W * 0.82),
      });
    }
    audio.play(LAUNCH, { pitch: rng.range(-2, 2) });
    spawnTimer = mode === "play" ? lerp(1.25, 0.72, d) : 1.05;
  }

  // --- effects ----------------------------------------------------------------------------
  function bit(x: number, y: number, color: string, o: { speed: [number, number]; size: [number, number]; life: [number, number]; gravity?: number; drag?: number; angle?: [number, number]; add?: boolean }) {
    const s = freeBits.pop() ?? new Sprite(dotTex);
    s.anchor.set(0.5);
    s.tint = color;
    s.blendMode = o.add ? "add" : "normal";
    const a = o.angle ? rng.range(o.angle[0], o.angle[1]) : rng() * Math.PI * 2;
    const v = rng.range(o.speed[0], o.speed[1]);
    const size = rng.range(o.size[0], o.size[1]);
    s.scale.set(size / 32);
    s.position.set(x, y);
    s.alpha = 1;
    (o.add ? fxLayer : halfLayer).addChild(s);
    const life = rng.range(o.life[0], o.life[1]);
    bits.push({ sprite: s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, gravity: o.gravity ?? 0, drag: o.drag ?? 0, scale0: size / 32 });
  }

  /** A streak of light along the cut, in the produce's own color. */
  function streak(x: number, y: number, angle: number, color: string, length: number) {
    const s = new Sprite(streakTex);
    s.anchor.set(0.5);
    s.tint = color;
    s.blendMode = "add";
    s.position.set(x, y);
    s.rotation = angle;
    s.scale.set(length / 128, rng.range(0.9, 1.3));
    s.alpha = 0.9;
    fxLayer.addChild(s);
    decals.push({ sprite: s, life: 0.45 });
    if (decals.length > 14) {
      const old = decals.shift()!;
      old.sprite.destroy();
    }
  }

  /** A jagged surge arc from (ax, ay) to (bx, by); fades in a quarter second. */
  function zap(ax: number, ay: number, bx: number, by: number) {
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const pts = [ax, ay];
    for (let i = 1; i < 7; i++) {
      const k = i / 7;
      const j = rng.range(-16, 16);
      pts.push(ax + (bx - ax) * k + nx * j, ay + (by - ay) * k + ny * j);
    }
    pts.push(bx, by);
    const g = new Graphics();
    g.blendMode = "add";
    g.poly(pts, false).stroke({ width: 7, color: SURGE.shell, alpha: 0.45, join: "round", cap: "round" });
    g.poly(pts, false).stroke({ width: 2.5, color: "#FFFFFF", join: "round", cap: "round" });
    fxLayer.addChild(g);
    arcs.push({ g, life: 0.25 });
  }

  /** A cut surge cell arcs into the nearest produce still in the air and cuts them too. It never touches static. */
  function surge(from: Item) {
    const dist = (o: Item) => Math.hypot(o.x - from.x, o.y - from.y);
    const targets = items
      .filter((o) => o.alive && !o.kind.special)
      .sort((a, b) => dist(a) - dist(b))
      .slice(0, SURGE_ARCS);
    audio.play(SURGE_SFX);
    haptic("success");
    popups.add(targets.length ? `SURGE ×${targets.length}` : "SURGE", from.x, from.y - 30, SURGE.shell, 20, 1);
    for (const t of targets) {
      zap(from.x, from.y, t.x, t.y);
      const a = rng() * Math.PI;
      cut(t, t.x - Math.cos(a) * 10, t.y - Math.sin(a) * 10, Math.cos(a) * 20, Math.sin(a) * 20);
    }
  }

  function cut(it: Item, ax: number, ay: number, dx: number, dy: number) {
    it.alive = false;
    itemLayer.removeChild(it.node);
    it.node.destroy({ children: true });
    const kind = it.kind;

    if (kind.special === "static") {
      detonate(it);
      return;
    }

    // Cut line in the item's local (unrotated) space.
    const len = Math.hypot(dx, dy) || 1;
    const ndx = dx / len;
    const ndy = dy / len;
    const c = Math.cos(-it.rot);
    const s = Math.sin(-it.rot);
    const lx = (ax - it.x) * c - (ay - it.y) * s;
    const ly = (ax - it.x) * s + (ay - it.y) * c;
    const ldx = ndx * c - ndy * s;
    const ldy = ndx * s + ndy * c;
    let [left, right] = splitPoly(kind.shape, lx, ly, ldx, ldy);
    let px = lx;
    let py = ly;
    if (!left.length || !right.length) {
      px = 0;
      py = 0;
      [left, right] = splitPoly(kind.shape, 0, 0, ldx, ldy);
    }
    const flesh = scalePoly(kind.shape, 0.8);
    const [fl, fr] = splitPoly(flesh, px, py, ldx, ldy);
    const side = (x: number, y: number) => ldx * (y - py) - ldy * (x - px);
    for (const [poly, fpoly, sign] of [
      [left, fl, 1],
      [right, fr, -1],
    ] as Array<[Poly, Poly, number]>) {
      if (!poly.length) continue;
      const g = new Graphics();
      g.poly(poly).fill({ color: mix(kind.shell, BG, 0.25) }).stroke({ width: 3, color: kind.shell, join: "round" });
      if (fpoly.length) g.poly(fpoly).fill({ color: kind.flesh });
      for (const [sx, sy] of it.seeds) {
        if (side(sx, sy) * sign > 4) g.ellipse(sx, sy, 2.6, 4).fill({ color: kind.seed, alpha: 0.85 });
      }
      const [cx0, cy0] = centroid(poly);
      const node = new Container();
      node.addChild(g);
      node.position.set(it.x, it.y);
      node.rotation = it.rot;
      halfLayer.addChild(node);
      // Push halves apart, perpendicular to the cut.
      const wc = rotatePoly([cx0, cy0], it.rot);
      const nx = -ndy * sign;
      const ny = ndx * sign;
      const dirSign = Math.sign(nx * (wc[0] ?? 0) + ny * (wc[1] ?? 0)) || 1;
      halves.push({
        node,
        x: it.x,
        y: it.y,
        vx: it.vx * 0.6 + nx * dirSign * rng.range(90, 150),
        vy: Math.min(it.vy, 0) * 0.4 + ny * dirSign * rng.range(90, 150) - 60,
        rot: it.rot,
        vr: it.vr + sign * rng.range(1.5, 4),
        life: 2.4,
      });
    }

    // Sparks, and a streak of light along the cut.
    for (let i = 0; i < 14; i++) bit(it.x, it.y, kind.flesh, { speed: [80, 340], size: [2, 5], life: [0.25, 0.6], gravity: 160, drag: 2, add: true });
    for (let i = 0; i < 10; i++) bit(it.x, it.y, kind.shell, { speed: [160, 520], size: [2, 5], life: [0.15, 0.4], drag: 3, add: true });
    streak(it.x, it.y, Math.atan2(ndy, ndx), kind.shell, kind.radius * 4.2);
    audio.play("slice", { pitch: rng.range(-1, 3) + combo * 1.2 });
    audio.play(CRACK, { volume: 0.8 });
    shake.add(0.06);

    if (mode !== "play") return;
    cutsTotal++;
    combo++;
    comboTimer = 0.32;
    score += kind.points;
    if (kind.special === "surge") surge(it);
  }

  function settleCombo() {
    if (combo >= 3 && mode === "play") {
      const bonus = (combo - 2) * 2;
      score += bonus;
      maxCombo = Math.max(maxCombo, combo);
      const last = trail[trail.length - 1];
      popups.add(`COMBO ×${combo} +${bonus}`, clamp(last?.x ?? W / 2, 90, W - 90), clamp((last?.y ?? H / 2) - 40, 120, H - 120), ACCENT, 20, 1.1);
      audio.play("powerup", { pitch: Math.min(combo, 8) });
      hitStop.freeze(0.06);
      shake.add(0.18);
      haptic("success");
    }
    combo = 0;
  }

  function detonate(it: Item) {
    flash.trigger("#FFDCD2");
    hitStop.freeze(0.16);
    shake.add(0.95);
    audio.play("explode");
    audio.play("thud");
    haptic("impact");
    for (let i = 0; i < 36; i++) bit(it.x, it.y, i % 3 ? "#FF2D2D" : "#FFB0A0", { speed: [200, 700], size: [3, 9], life: [0.3, 0.9], drag: 2.2, add: true });
    for (let i = 0; i < 18; i++) bit(it.x, it.y, "#2A1A20", { speed: [60, 300], size: [6, 14], life: [0.6, 1.2], gravity: 400, drag: 1 });
    if (mode !== "play") return;
    // Everything still in the air fizzles.
    for (const other of items) {
      if (!other.alive) continue;
      other.alive = false;
      for (let i = 0; i < 6; i++) bit(other.x, other.y, other.kind.shell, { speed: [40, 160], size: [2, 5], life: [0.3, 0.6], add: true });
      itemLayer.removeChild(other.node);
      other.node.destroy({ children: true });
    }
    pending = [];
    gameOver();
  }

  function gameOver() {
    if (overT >= 0) return;
    overT = 0;
    settleCombo();
  }

  function strike(it: Item) {
    strikes++;
    strikeFlash = 1;
    audio.play("error");
    haptic("fail");
    popups.add("MISS", clamp(it.x, 50, W - 50), H - 96, "#FF2D2D", 20, 0.9);
    if (strikes >= MAX_STRIKES) {
      shake.add(0.5);
      gameOver();
    }
  }

  // --- blade ------------------------------------------------------------------------------
  function bladeTo(x: number, y: number) {
    const prev = trail[trail.length - 1];
    trail.push({ x, y, t: time });
    if (!prev) return;
    const dx = x - prev.x;
    const dy = y - prev.y;
    if (Math.hypot(dx, dy) < 3) return;
    for (const it of items) {
      if (!it.alive) continue;
      if (distToSegment(it.x, it.y, prev.x, prev.y, x, y) < it.kind.radius * 0.92) cut(it, prev.x, prev.y, dx, dy);
    }
    items = items.filter((i) => i.alive);
  }

  onDrag(window, {
    start(x, y) {
      if (mode !== "play" || session.phase !== "playing" || overT >= 0) return;
      bladeDown = true;
      trail.length = 0;
      trail.push({ x, y, t: time });
    },
    move(x, y) {
      if (!bladeDown) return;
      bladeTo(x, y);
    },
    end(_x, _y, cancelled) {
      if (!bladeDown) return;
      bladeDown = false;
      if (!cancelled) settleCombo();
      else combo = 0;
    },
  });

  function drawBlade() {
    blade.clear();
    const life = 0.13;
    const pts = trail.filter((p) => time - p.t < life);
    if (pts.length < 2) return;
    const left: number[] = [];
    const right: number[] = [];
    const coreL: number[] = [];
    const coreR: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[Math.min(pts.length - 1, i + 1)]!;
      const o = pts[Math.max(0, i - 1)]!;
      let nx = -(q.y - o.y);
      let ny = q.x - o.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const k = (i + 1) / pts.length;
      const w = 9 * k;
      left.push(p.x + nx * w, p.y + ny * w);
      right.unshift(p.x - nx * w, p.y - ny * w);
      coreL.push(p.x + nx * w * 0.35, p.y + ny * w * 0.35);
      coreR.unshift(p.x - nx * w * 0.35, p.y - ny * w * 0.35);
    }
    blade.poly([...left, ...right]).fill({ color: ACCENT, alpha: 0.85 });
    blade.poly([...coreL, ...coreR]).fill({ color: "#FFFFFF", alpha: 0.95 });
    const head = pts[pts.length - 1]!;
    blade.circle(head.x, head.y, 5).fill({ color: "#FFFFFF", alpha: 0.9 });
  }

  // --- attract pilot ----------------------------------------------------------------------
  function aiThink(dt: number) {
    if (ai) {
      ai.t += dt;
      const k = Math.min(1, ai.t / ai.dur);
      bladeTo(ai.ax + (ai.bx - ai.ax) * k, ai.ay + (ai.by - ai.ay) * k);
      if (k >= 1) {
        ai = null;
        aiCooldown = rng.range(0.25, 0.7);
      }
      return;
    }
    aiCooldown -= dt;
    if (aiCooldown > 0) return;
    const ripe = items.filter((i) => i.alive && i.kind.special !== "static" && i.vy > -220 && i.y < H * 0.75);
    if (!ripe.length) return;
    const target = ripe[0]!;
    const friends = ripe.filter((i) => Math.abs(i.y - target.y) < 90).slice(0, 3);
    const xs = friends.map((f) => f.x);
    const ys = friends.map((f) => f.y);
    const minX = Math.min(...xs) - 70;
    const maxX = Math.max(...xs) + 70;
    const tilt = rng.range(-50, 50);
    const ay = ys.reduce((a, b) => a + b, 0) / ys.length + tilt;
    const by = ay - tilt * 2;
    // Never swipe through static.
    const hitsStatic = items.some((i) => i.alive && i.kind.special === "static" && distToSegment(i.x, i.y, minX, ay, maxX, by) < i.kind.radius * 1.6);
    if (hitsStatic) {
      aiCooldown = 0.15;
      return;
    }
    const lr = rng.chance(0.5);
    trail.length = 0;
    ai = { ax: lr ? minX : maxX, ay: lr ? ay : by, bx: lr ? maxX : minX, by: lr ? by : ay, t: 0, dur: 0.16 };
    trail.push({ x: ai.ax, y: ai.ay, t: time });
  }

  // --- run lifecycle ----------------------------------------------------------------------
  function clearWorld() {
    for (const it of items) it.node.destroy({ children: true });
    for (const h of halves) h.node.destroy({ children: true, context: true });
    for (const b of bits) {
      b.sprite.removeFromParent();
      freeBits.push(b.sprite);
    }
    for (const d of decals) d.sprite.destroy();
    for (const a of arcs) a.g.destroy();
    items = [];
    halves = [];
    bits.length = 0;
    decals.length = 0;
    arcs.length = 0;
    pending = [];
    trail.length = 0;
  }

  session.startOnTap(window);
  session.on("start", () => {
    clearWorld();
    mode = "play";
    score = 0;
    strikes = 0;
    elapsed = 0;
    spawnTimer = 0.5;
    lastSurgeAt = -99;
    overT = -1;
    endSent = false;
    combo = 0;
    maxCombo = 0;
    cutsTotal = 0;
    ai = null;
    bladeDown = false;
  });
  session.on("cancel", () => {
    bladeDown = false;
    combo = 0;
  });

  // --- frame ------------------------------------------------------------------------------
  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    flash.update(rawDt);
    strikeFlash = Math.max(0, strikeFlash - rawDt * 2);
    shake.update(rawDt);
    popups.update(rawDt);
    const dt = hitStop.scale(rawDt);

    if (mode === "play" && overT < 0) elapsed += rawDt;
    if (comboTimer > 0) {
      comboTimer -= rawDt;
      if (comboTimer <= 0 && !bladeDown) settleCombo();
    }

    // Spawning.
    const spawning = mode === "attract" || overT < 0;
    if (spawning) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) queueWave();
      const due = pending.filter((p) => p.at <= time);
      pending = pending.filter((p) => p.at > time);
      due.forEach(launch);
    }
    if (mode === "attract") aiThink(rawDt);

    // Items.
    const g = GRAVITY * gravityScale();
    // The static cell's core throbs as a warning: capped at 2 Hz (it was ~2.9), slow under reduced motion.
    const coreScale = 0.8 + 0.35 * light.pulse(time, 1.8);
    for (const it of items) {
      it.vy += g * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.vr * dt;
      it.node.position.set(it.x, it.y);
      it.node.rotation = it.rot;
      if (it.core) it.core.scale.set(coreScale);
      if (it.y > H + it.kind.radius * 2 && it.vy > 0) {
        it.alive = false;
        it.node.destroy({ children: true });
        if (mode === "play" && overT < 0 && !it.kind.special) strike(it);
      }
    }
    items = items.filter((i) => i.alive);

    // Halves.
    for (const h of halves) {
      h.vy += g * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
      h.life -= dt;
      h.node.position.set(h.x, h.y);
      h.node.rotation = h.rot;
      h.node.alpha = Math.min(1, h.life * 2);
    }
    halves = halves.filter((h) => {
      if (h.life > 0 && h.y < H + 120) return true;
      h.node.destroy({ children: true, context: true });
      return false;
    });

    // Bits.
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]!;
      b.life -= dt;
      if (b.life <= 0) {
        b.sprite.removeFromParent();
        freeBits.push(b.sprite);
        bits.splice(i, 1);
        continue;
      }
      const dmp = b.drag ? Math.exp(-b.drag * dt) : 1;
      b.vx *= dmp;
      b.vy = b.vy * dmp + b.gravity * dt;
      b.sprite.x += b.vx * dt;
      b.sprite.y += b.vy * dt;
      const k = b.life / b.max;
      b.sprite.alpha = Math.min(1, k * 2);
      b.sprite.scale.set(b.scale0 * (0.4 + 0.6 * k));
    }
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i]!;
      d.life -= rawDt;
      d.sprite.alpha = 0.9 * clamp(d.life / 0.45);
      if (d.life <= 0) {
        d.sprite.destroy();
        decals.splice(i, 1);
      }
    }
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i]!;
      a.life -= rawDt;
      a.g.alpha = clamp(a.life / 0.25);
      if (a.life <= 0) {
        a.g.destroy();
        arcs.splice(i, 1);
      }
    }

    // Game over -> report within 1 s (at 0.55 s, after the hit has read).
    if (overT >= 0) {
      overT += rawDt;
      if (!endSent && overT > 0.55) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { cuts: cutsTotal, maxCombo } });
      }
    }
  }

  function drawHud() {
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, W, H);
    popups.draw(hctx, FONT_MONO);
    if (mode === "play" && session.phase === "playing") {
      const top = session.play().top;
      drawNumber(hctx, score, W / 2, top + 34, 40, PAPER);
      // Lives: three market lights under the score. A miss blows the rightmost one still lit.
      for (let i = 0; i < MAX_STRIKES; i++) {
        const lit = i < MAX_STRIKES - strikes;
        const x = W / 2 + (i - (MAX_STRIKES - 1) / 2) * 24;
        const y = top + 66;
        const pop = !lit && i === MAX_STRIKES - strikes ? 1 + strikeFlash * 0.7 : 1;
        hctx.beginPath();
        hctx.arc(x, y, 6 * pop, 0, Math.PI * 2);
        if (lit) {
          hctx.shadowColor = ACCENT;
          hctx.shadowBlur = 10;
          hctx.fillStyle = ACCENT;
          hctx.fill();
          hctx.shadowBlur = 0;
        } else {
          hctx.strokeStyle = rgba(PAPER, 0.28);
          hctx.lineWidth = 2;
          hctx.stroke();
        }
      }
    } else if (mode === "play") {
      // In the feed the shell's result card takes over after end(); a bare tab needs its own.
      if (session.standalone && session.phaseTime > 0.7) {
        const r = safeRect(session.preview(), W, H);
        drawNumber(hctx, score, r.x + r.w / 2, r.y + 80, 56, PAPER);
        drawTapPrompt(hctx, r.x + r.w / 2, r.y + r.h - 24, time, PAPER, "TAP TO CHOP AGAIN");
      }
    } else {
      const r = safeRect(session.preview(), W, H);
      const cx = r.x + r.w / 2;
      const k = easeOutBack(titleIn);
      const ty = r.y + 92;
      hctx.save();
      hctx.translate(cx, ty);
      hctx.scale(k, k);
      hctx.rotate(-0.06);
      drawTitle(hctx, "NEON CHOP", 0, 0, r.w - 14, ACCENT, 92, "#5A0F24");
      hctx.restore();
      drawLabel(hctx, "CUT THE GLOW · DODGE THE STATIC", cx, ty + 30, rgba(PAPER, 0.75), 11);
      if (session.best !== null) drawLabel(hctx, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 52, PAPER, 13);
      drawTapPrompt(hctx, cx, r.y + r.h - 24, time, PAPER);
    }
    flash.draw(hctx, W, H);
  }

  function render() {
    const o = shake.offset;
    world.position.set(o.x, o.y);
    world.rotation = o.angle;
    drawBlade();
    Ticker.system.update(performance.now());
    app.renderer.render(app.stage);
    drawHud();
  }

  /**
   * Draws one of everything once before ready(): shader compiles and texture uploads happen here, not as a
   * long task during attract mode.
   */
  function warmUp() {
    for (const k of [...KINDS, SURGE, STATIC]) {
      const it = buildItem(k);
      it.x = W / 2;
      it.y = H / 2;
      it.node.position.set(it.x, it.y);
      items.push(it);
    }
    cut(items[0]!, W / 2 - 60, H / 2, 120, 4);
    zap(0, H / 2, W / 2, H / 2);
    items = items.filter((i) => i.alive);
    trail.push({ x: 0, y: H / 2, t: time }, { x: W / 2, y: H / 2 + 10, t: time }, { x: W, y: H / 2, t: time });
    drawBlade();
    world.alpha = 0.001;
    app.renderer.render(app.stage);
    world.alpha = 1;
    drawHud();
    clearWorld();
    popups.clear();
    shake.trauma = 0;
  }
  warmUp();

  // ready() after a few presented frames, so first-frame GPU work never lands in attract mode.
  let framesShown = 0;
  const quality = createQuality(app);
  tc.loop((dt) => {
    update(dt);
    render();
    quality(dt);
    if (++framesShown === 3) session.ready();
  });
}

void main();
