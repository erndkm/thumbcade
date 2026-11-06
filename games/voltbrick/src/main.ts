import "pixi.js/unsafe-eval";
import {
  clamp,
  createAudio,
  createRng,
  createSession,
  damp,
  drawLabel,
  drawNumber,
  drawTapPrompt,
  drawTitle,
  easeOutBack,
  FONT_DISPLAY,
  FONT_MONO,
  HitStop,
  lerp,
  loadFonts,
  midiToFreq,
  onDrag,
  onKeys,
  PENTATONIC,
  Photosafe,
  Popups,
  rgba,
  safeRect,
  Shake,
  Spring,
} from "@thumbcade-games/kit";
import { thumbcade as tc } from "@thumbcade/sdk";
import { Application, Container, Graphics, Sprite, Texture, Ticker } from "pixi.js";
import { createQuality } from "./quality.ts";
import { COLS, parseLevel, TIER_COLORS, TIER_POINTS } from "./levels.ts";
import { brickAtlas, dotTexture, glowTexture, POWER_COLORS, squareTexture, tokenTexture, type PowerKind } from "./textures.ts";

const BG = "#070B1A";
const ACCENT = "#4D8DFF";
const PAPER = "#F3F0E8";
const BALL_R = 7;
const PADDLE_H = 14;
const PADDLE_W = 84;
const START_LIVES = 3;
const MAX_BALLS = 7;
/** The most colorful layouts carry attract mode. */
const ATTRACT_LEVELS = [0, 1, 3, 5];
const TRAIL = 8;
const MARGIN = 10;
const GAP = 4;
const BRICK_H = 18;

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  tier: number;
  hp: number;
  sprite: Sprite;
  alive: boolean;
  flash: number;
  appear: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean;
  offset: number;
  sprite: Sprite;
  glow: Sprite;
  trail: Array<[number, number]>;
  trailSprites: Sprite[];
  alive: boolean;
}

interface Drop {
  kind: PowerKind;
  x: number;
  y: number;
  sprite: Sprite;
  t: number;
}

interface Beam {
  x: number;
  y: number;
  sprite: Sprite;
}

interface Shard {
  sprite: Sprite;
  vx: number;
  vy: number;
  vr: number;
  life: number;
  max: number;
  gravity: number;
  s0: number;
}

const POWER_WEIGHTS: Array<[PowerKind, number]> = [
  ["split", 0.3],
  ["wide", 0.25],
  ["beam", 0.2],
  ["slow", 0.17],
  ["life", 0.08],
];
const POWER_TIME: Record<PowerKind, number> = { split: 0, wide: 10, beam: 6, slow: 8, life: 0 };

async function main() {
  const [session] = await Promise.all([createSession({ id: "voltbrick" }), loadFonts()]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = window.innerWidth;
  let H = window.innerHeight;

  const app = new Application();
  await app.init({ width: W, height: H, resolution: dpr, autoDensity: true, antialias: false, background: BG, autoStart: false, preference: "webgl" });
  // Pixi's tickers would keep requestAnimationFrame alive through a pause; we drive them from tc.loop.
  app.ticker.stop();
  Ticker.system.autoStart = false;
  Ticker.system.stop();
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
  app.canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none";
  document.body.appendChild(app.canvas);

  const hud = document.createElement("canvas");
  hud.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none";
  document.body.appendChild(hud);
  const hctx = hud.getContext("2d")!;
  const sizeHud = () => {
    hud.width = Math.round(W * dpr);
    hud.height = Math.round(H * dpr);
  };
  sizeHud();

  const audio = createAudio();
  /** Haptics only during a run: attract mode must never buzz a phone that's just scrolling the feed. */
  const haptic = (kind: "tap" | "success" | "fail" | "impact") => {
    if (session.phase === "playing") tc.feedback(kind);
  };
  const rng = createRng(session.ctx.seed);
  const shake = new Shake(10, 0.02, 1.9, session.reducedMotion);
  const hitStop = new HitStop();
  const popups = new Popups();
  // Photosensitivity: losing a life tints the screen red once (capped for red, rate-limited); a faint tint under reduced motion.
  const light = new Photosafe(session.reducedMotion);
  const flash = light.flash({ alpha: 0.18, decay: 0.3 });

  const glowTex = glowTexture();
  const dotTex = dotTexture();
  const sqTex = squareTexture();
  const tokens = Object.fromEntries((Object.keys(POWER_COLORS) as PowerKind[]).map((k) => [k, tokenTexture(k, dpr)])) as Record<PowerKind, Texture>;

  // Layers.
  const backdrop = new Sprite(Texture.EMPTY);
  const brickLayer = new Container();
  const fxLayer = new Container();
  const trailLayer = new Container();
  const ballLayer = new Container();
  const paddleG = new Graphics();
  const paddleGlow = new Sprite(glowTex);
  paddleGlow.anchor.set(0.5);
  paddleGlow.tint = ACCENT;
  paddleGlow.blendMode = "add";
  const world = new Container();
  world.addChild(brickLayer, trailLayer, fxLayer, paddleGlow, paddleG, ballLayer);
  app.stage.addChild(backdrop, world);

  // Geometry (CSS px).
  const hudTop = () => session.play().top;
  const wallTop = () => hudTop() + 46;
  const paddleY = () => H - 62;
  const brickW = () => (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const brickTop = () => wallTop() + 34;

  let atlasFor = -1;
  let atlas: ReturnType<typeof brickAtlas> | null = null;
  const brickTex = (tier: number, dmg: number) => {
    const bw = Math.round(brickW() * 4) / 4;
    if (!atlas || atlasFor !== bw) {
      atlas = brickAtlas(bw, BRICK_H, dpr);
      atlasFor = bw;
    }
    return atlas(tier, dmg);
  };

  function drawBackdrop() {
    const c = document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#060914");
    sky.addColorStop(0.7, BG);
    sky.addColorStop(1, "#0B1430");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Perspective floor grid under the paddle.
    const horizon = H * 0.66;
    g.strokeStyle = rgba(ACCENT, 0.12);
    g.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * 14, horizon);
      g.lineTo(W / 2 + i * 120, H);
      g.stroke();
    }
    for (let k = 0; k < 9; k++) {
      const t = (k / 8) ** 2;
      const y = lerp(horizon, H, t);
      g.globalAlpha = 0.25 + t * 0.75;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    const fade = g.createLinearGradient(0, horizon - 40, 0, horizon + 60);
    fade.addColorStop(0, rgba(BG, 1));
    fade.addColorStop(1, rgba(BG, 0));
    g.fillStyle = fade;
    g.fillRect(0, horizon - 40, W, 100);
    // Ceiling rail under the HUD.
    g.fillStyle = rgba(ACCENT, 0.5);
    g.fillRect(MARGIN, wallTop() - 2, W - MARGIN * 2, 2);
    g.fillStyle = rgba(PAPER, 0.08);
    for (let x = MARGIN; x < W - MARGIN; x += 12) g.fillRect(x, wallTop() - 8, 6, 2);
    // Side rails.
    g.fillStyle = rgba(ACCENT, 0.18);
    g.fillRect(0, wallTop(), 2, H - wallTop());
    g.fillRect(W - 2, wallTop(), 2, H - wallTop());
    const old = backdrop.texture;
    backdrop.texture = Texture.from(c);
    backdrop.width = W;
    backdrop.height = H;
    if (old !== Texture.EMPTY) old.destroy(true);
  }
  drawBackdrop();

  window.addEventListener("resize", () => {
    W = window.innerWidth;
    H = window.innerHeight;
    app.renderer.resize(W, H);
    sizeHud();
    drawBackdrop();
  });

  // State.
  let mode: "attract" | "play" = "attract";
  let bricks: Brick[] = [];
  let balls: Ball[] = [];
  let drops: Drop[] = [];
  let beams: Beam[] = [];
  const shards: Shard[] = [];
  const freeShards: Sprite[] = [];
  let level = 0;
  let score = 0;
  let lives = START_LIVES;
  let chain = 0;
  let paddleHits = 0;
  let time = 0;
  let titleIn = 0;
  let overT = -1;
  let endSent = false;
  let launchIn = 0;
  let levelClearT = -1;
  let livesPulse = 0;
  const powers: Record<PowerKind, number> = { split: 0, wide: 0, beam: 0, slow: 0, life: 0 };
  let beamCooldown = 0;
  const paddle = { x: W / 2, target: W / 2, w: PADDLE_W, drawnW: 0, squash: new Spring(0, 520, 18) };
  let aiAim = 0;
  let dragging = false;

  const baseSpeed = () => Math.min(760, 430 * (1 + 0.07 * level)) * (mode === "attract" ? 0.95 : 1);
  const ballSpeed = () => Math.min(820, baseSpeed() * (1 + 0.012 * Math.min(paddleHits, 30))) * (powers.slow > 0 ? 0.66 : 1);

  // --- construction -----------------------------------------------------------------------
  function buildLevel(index: number, animate: boolean) {
    for (const b of bricks) b.sprite.destroy();
    bricks = [];
    const bw = brickW();
    parseLevel(index).forEach((spec, i) => {
      const sprite = new Sprite(brickTex(spec.tier, 0));
      sprite.width = bw;
      sprite.height = BRICK_H;
      brickLayer.addChild(sprite);
      bricks.push({
        x: MARGIN + spec.col * (bw + GAP),
        y: brickTop() + spec.row * (BRICK_H + GAP),
        w: bw,
        h: BRICK_H,
        tier: spec.tier,
        hp: spec.hp,
        sprite,
        alive: true,
        flash: 0,
        appear: animate ? -(spec.row * 0.06 + spec.col * 0.025 + (i % 3) * 0.01) : 1,
      });
    });
  }

  function newBall(x: number, y: number, vx: number, vy: number, stuck: boolean): Ball {
    const glow = new Sprite(glowTex);
    glow.anchor.set(0.5);
    glow.tint = ACCENT;
    glow.blendMode = "add";
    glow.width = glow.height = 46;
    glow.alpha = 0.7;
    const sprite = new Sprite(dotTex);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = BALL_R * 2;
    ballLayer.addChild(glow, sprite);
    const trailSprites: Sprite[] = [];
    for (let i = 0; i < TRAIL; i++) {
      const t = new Sprite(dotTex);
      t.anchor.set(0.5);
      t.blendMode = "add";
      t.visible = false;
      trailLayer.addChild(t);
      trailSprites.push(t);
    }
    const b: Ball = { x, y, vx, vy, stuck, offset: rng.range(-0.25, 0.25), sprite, glow, trail: [], trailSprites, alive: true };
    balls.push(b);
    return b;
  }

  function park() {
    for (const b of balls) {
      b.sprite.destroy();
      b.glow.destroy();
      for (const t of b.trailSprites) t.destroy();
    }
    balls = [];
    newBall(paddle.x, paddleY() - PADDLE_H / 2 - BALL_R - 1, 0, 0, true);
    launchIn = 0.85;
  }

  function launch() {
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const a = clamp(b.offset + rng.range(-0.2, 0.2), -0.45, 0.45);
      const s = ballSpeed();
      b.vx = Math.sin(a) * s;
      b.vy = -Math.cos(a) * s;
    }
    audio.play("select");
  }

  function resetRun(forMode: "attract" | "play") {
    mode = forMode;
    for (const d of drops) d.sprite.destroy();
    for (const bm of beams) bm.sprite.destroy();
    drops = [];
    beams = [];
    for (const k of Object.keys(powers) as PowerKind[]) powers[k] = 0;
    level = forMode === "attract" ? rng.pick(ATTRACT_LEVELS) : 0;
    score = 0;
    lives = START_LIVES;
    chain = 0;
    paddleHits = 0;
    overT = -1;
    endSent = false;
    levelClearT = -1;
    paddle.x = paddle.target = W / 2;
    buildLevel(level, true);
    park();
  }

  // --- effects ----------------------------------------------------------------------------
  function shard(x: number, y: number, color: string, o: { speed: [number, number]; size: [number, number]; life: [number, number]; gravity?: number; add?: boolean; angle?: [number, number] }) {
    const s = freeShards.pop() ?? new Sprite(sqTex);
    s.anchor.set(0.5);
    s.tint = color;
    s.blendMode = o.add ? "add" : "normal";
    s.alpha = 1;
    s.position.set(x, y);
    const size = rng.range(o.size[0], o.size[1]);
    s.scale.set(size / 8);
    s.rotation = rng() * Math.PI;
    fxLayer.addChild(s);
    const a = o.angle ? rng.range(o.angle[0], o.angle[1]) : rng() * Math.PI * 2;
    const v = rng.range(o.speed[0], o.speed[1]);
    const life = rng.range(o.life[0], o.life[1]);
    shards.push({ sprite: s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vr: rng.range(-8, 8), life, max: life, gravity: o.gravity ?? 0, s0: size / 8 });
  }

  function brickNote(): number {
    const step = PENTATONIC[Math.min(chain, PENTATONIC.length - 1)] ?? 0;
    return midiToFreq(64 + step);
  }

  function damage(b: Brick, fromBeam: boolean) {
    b.hp--;
    b.flash = 1;
    const color = TIER_COLORS[b.tier] ?? PAPER;
    if (b.hp > 0) {
      b.sprite.texture = brickTex(b.tier, b.tier === 7 ? 3 - b.hp : 1);
      audio.play("click", { pitch: 3 });
      audio.note(220, 0.06, "square", 0.12);
      for (let i = 0; i < 4; i++) shard(b.x + b.w / 2, b.y + b.h, color, { speed: [60, 160], size: [2, 3], life: [0.2, 0.4], gravity: 600 });
      shake.add(0.04);
      return;
    }
    b.alive = false;
    b.sprite.visible = false;
    chain++;
    const mult = Math.min(5, 1 + Math.floor(chain / 3));
    const pts = (TIER_POINTS[b.tier] ?? 10) * (mode === "play" ? mult : 0);
    score += pts;
    audio.note(brickNote(), 0.12, "triangle", 0.22);
    if (!fromBeam) audio.play("tick", { pitch: rng.range(-2, 2) });
    for (let i = 0; i < 10; i++) shard(b.x + rng.range(0, b.w), b.y + rng.range(0, b.h), color, { speed: [60, 260], size: [2.5, 5.5], life: [0.35, 0.8], gravity: 900 });
    for (let i = 0; i < 4; i++) shard(b.x + b.w / 2, b.y + b.h / 2, PAPER, { speed: [120, 320], size: [1.5, 2.5], life: [0.15, 0.3], add: true });
    shake.add(b.tier >= 6 ? 0.14 : 0.05);
    if (b.tier >= 6) hitStop.freeze(0.03);
    if (mode === "play" && mult >= 2 && chain % 3 === 0) popups.add(`×${mult}`, b.x + b.w / 2, b.y - 6, color, 18, 0.7);
    if (rng.chance(mode === "play" ? 0.11 : 0.06)) spawnDrop(b.x + b.w / 2, b.y + b.h / 2);
  }

  function spawnDrop(x: number, y: number, forced?: PowerKind) {
    let r = rng();
    let kind: PowerKind = "split";
    for (const [k, w] of POWER_WEIGHTS) {
      if ((r -= w) <= 0) {
        kind = k;
        break;
      }
    }
    if (kind === "life" && (mode === "attract" || lives >= 5)) kind = "wide";
    if (forced) kind = forced;
    const sprite = new Sprite(tokens[kind]);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = 30;
    sprite.position.set(x, y);
    fxLayer.addChild(sprite);
    drops.push({ kind, x, y, sprite, t: 0 });
  }

  function collect(d: Drop) {
    const color = POWER_COLORS[d.kind];
    audio.play("powerup");
    haptic("success");
    for (let i = 0; i < 14; i++) shard(d.x, d.y, color, { speed: [80, 260], size: [2, 4], life: [0.3, 0.6], add: true });
    const label: Record<PowerKind, string> = { split: "SPLIT", wide: "WIDE", beam: "BEAM", slow: "SLOW", life: "+1 LIFE" };
    if (mode === "play") popups.add(label[d.kind], d.x, paddleY() - 40, color, 16, 0.9);
    if (d.kind === "split") {
      const free = balls.filter((b) => b.alive && !b.stuck);
      for (const b of free.length ? free : balls) {
        for (const turn of [-0.35, 0.35]) {
          if (balls.length >= MAX_BALLS) break;
          const c = Math.cos(turn);
          const s = Math.sin(turn);
          const vx = b.stuck ? Math.sin(turn) * ballSpeed() : b.vx * c - b.vy * s;
          const vy = b.stuck ? -Math.cos(turn) * ballSpeed() : b.vx * s + b.vy * c;
          newBall(b.x, b.y, vx, vy, false);
        }
      }
    } else if (d.kind === "life") {
      lives = Math.min(5, lives + 1);
      livesPulse = 1;
    } else {
      powers[d.kind] = POWER_TIME[d.kind];
    }
  }

  function loseBall() {
    if (balls.some((b) => b.alive)) return;
    chain = 0;
    if (mode === "attract") {
      park();
      return;
    }
    lives--;
    livesPulse = 1;
    shake.add(0.5);
    hitStop.freeze(0.12);
    flash.trigger("#FF4A5C");
    audio.play("lose");
    haptic("fail");
    for (const k of ["wide", "beam", "slow"] as PowerKind[]) powers[k] = 0;
    if (lives <= 0) {
      overT = 0;
      return;
    }
    paddleHits = Math.floor(paddleHits / 2);
    park();
  }

  // --- input ------------------------------------------------------------------------------
  session.startOnTap(window);
  onDrag(window, {
    start(x) {
      if (mode !== "play" || session.phase !== "playing") return;
      dragging = true;
      paddle.target = x;
    },
    move(x) {
      if (dragging) paddle.target = x;
    },
    end() {
      dragging = false;
    },
  });
  onKeys({
    left: () => {
      if (mode === "play") paddle.target -= 48;
    },
    right: () => {
      if (mode === "play") paddle.target += 48;
    },
  });
  session.on("start", () => {
    resetRun("play");
    audio.play("select");
  });
  session.on("cancel", () => {
    dragging = false;
  });

  // --- simulation -------------------------------------------------------------------------
  function predictX(b: Ball): number {
    if (b.vy <= 0) return b.x;
    const t = (paddleY() - b.y) / b.vy;
    let x = b.x + b.vx * t;
    const L = BALL_R + 2;
    const R = W - BALL_R - 2;
    const span = R - L;
    x -= L;
    x = ((x % (2 * span)) + 2 * span) % (2 * span);
    if (x > span) x = 2 * span - x;
    return x + L;
  }

  function aiThink(dt: number) {
    const live = balls.filter((b) => b.alive && !b.stuck);
    const falling = live.filter((b) => b.vy > 0).sort((a, b) => b.y - a.y);
    const lead = falling[0] ?? live[0];
    aiAim = damp(aiAim, Math.sin(time * 0.7) * 0.5, 2, dt);
    if (lead) paddle.target = predictX(lead) - aiAim * paddle.w * 0.4;
    else paddle.target = W / 2 + Math.sin(time * 0.8) * W * 0.2;
    // Catch power-ups when nothing is urgent.
    if (!falling.length || falling[0]!.y < H * 0.4) {
      const d = drops.find((dd) => dd.y > H * 0.5);
      if (d) paddle.target = d.x;
    }
  }

  function step(b: Ball, dt: number) {
    const speed = ballSpeed();
    const n = Math.max(1, Math.ceil((speed * dt) / 4));
    const h = dt / n;
    for (let i = 0; i < n && b.alive; i++) {
      // Keep the speed exact and the angle honest (no near-horizontal loops).
      const len = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / len) * speed;
      b.vy = (b.vy / len) * speed;
      if (Math.abs(b.vy) < speed * 0.28) {
        b.vy = Math.sign(b.vy || -1) * speed * 0.28;
        b.vx = Math.sign(b.vx || 1) * Math.sqrt(speed * speed - b.vy * b.vy);
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      // Walls.
      if (b.x < BALL_R + 2) {
        b.x = BALL_R + 2;
        b.vx = Math.abs(b.vx);
        audio.play("click", { volume: 0.5 });
      } else if (b.x > W - BALL_R - 2) {
        b.x = W - BALL_R - 2;
        b.vx = -Math.abs(b.vx);
        audio.play("click", { volume: 0.5 });
      }
      if (b.y < wallTop() + BALL_R) {
        b.y = wallTop() + BALL_R;
        b.vy = Math.abs(b.vy);
        audio.play("click", { volume: 0.5 });
      }
      // Paddle.
      const py = paddleY();
      if (b.vy > 0 && b.y + BALL_R >= py - PADDLE_H / 2 && b.y - BALL_R <= py + PADDLE_H / 2 && Math.abs(b.x - paddle.x) <= paddle.w / 2 + BALL_R) {
        const k = clamp((b.x - paddle.x) / (paddle.w / 2), -1, 1);
        const a = k * 1.08;
        b.vx = Math.sin(a) * speed;
        b.vy = -Math.cos(a) * speed;
        b.y = py - PADDLE_H / 2 - BALL_R;
        paddleHits++;
        chain = 0;
        paddle.squash.kick(-9);
        audio.play("blip", { pitch: k * 4 });
        shard(b.x, py - PADDLE_H / 2, ACCENT, { speed: [60, 180], size: [1.5, 3], life: [0.15, 0.3], angle: [-Math.PI * 0.85, -Math.PI * 0.15], add: true });
        haptic("tap");
      }
      // Bricks (one per sub-step).
      for (const br of bricks) {
        if (!br.alive || br.appear < 0.6) continue;
        const cx = clamp(b.x, br.x, br.x + br.w);
        const cy = clamp(b.y, br.y, br.y + br.h);
        const dx = b.x - cx;
        const dy = b.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > BALL_R * BALL_R) continue;
        let nx: number;
        let ny: number;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          b.x = cx + nx * (BALL_R + 0.5);
          b.y = cy + ny * (BALL_R + 0.5);
        } else {
          // Center inside the brick: push out along the shallower axis.
          const left = b.x - br.x;
          const right = br.x + br.w - b.x;
          const top = b.y - br.y;
          const bottom = br.y + br.h - b.y;
          const m = Math.min(left, right, top, bottom);
          nx = m === left ? -1 : m === right ? 1 : 0;
          ny = m === top ? -1 : m === bottom ? 1 : 0;
        }
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) {
          b.vx -= 2 * dot * nx;
          b.vy -= 2 * dot * ny;
        }
        damage(br, false);
        break;
      }
      if (b.y > H + 30) {
        b.alive = false;
        b.sprite.destroy();
        b.glow.destroy();
        for (const t of b.trailSprites) t.destroy();
      }
    }
  }

  function update(rawDt: number) {
    session.tick(rawDt);
    time += rawDt;
    titleIn = Math.min(1, titleIn + rawDt * 1.5);
    flash.update(rawDt);
    livesPulse = Math.max(0, livesPulse - rawDt * 2.5);
    shake.update(rawDt);
    popups.update(rawDt);
    const dt = hitStop.scale(rawDt);
    for (const k of ["wide", "beam", "slow"] as PowerKind[]) powers[k] = Math.max(0, powers[k] - dt);

    if (mode === "attract") aiThink(rawDt);
    paddle.target = clamp(paddle.target, paddle.w / 2 + 4, W - paddle.w / 2 - 4);
    paddle.x = damp(paddle.x, paddle.target, mode === "attract" ? 14 : 34, rawDt);
    paddle.w = damp(paddle.w, powers.wide > 0 ? PADDLE_W * 1.6 : PADDLE_W, 10, rawDt);
    paddle.squash.update(rawDt);

    // Bricks drop in on a new level.
    for (const br of bricks) {
      br.appear = Math.min(1, br.appear + rawDt * 2.2);
      br.flash = Math.max(0, br.flash - rawDt * 6);
    }

    if (overT < 0 && levelClearT < 0) {
      if (launchIn > 0) {
        launchIn -= dt;
        if (launchIn <= 0) launch();
      }
      for (const b of balls) {
        if (b.stuck) {
          b.x = paddle.x + b.offset * paddle.w * 0.3;
          b.y = paddleY() - PADDLE_H / 2 - BALL_R - 1;
        } else if (b.alive) step(b, dt);
      }
      balls = balls.filter((b) => b.alive);
      if (!balls.length) loseBall();
      // Beams.
      if (powers.beam > 0) {
        beamCooldown -= dt;
        if (beamCooldown <= 0) {
          beamCooldown = 0.26;
          for (const side of [-1, 1]) {
            const s = new Sprite(sqTex);
            s.anchor.set(0.5, 1);
            s.tint = POWER_COLORS.beam;
            s.blendMode = "add";
            s.scale.set(3 / 8, 16 / 8);
            const x = paddle.x + side * (paddle.w / 2 - 8);
            fxLayer.addChild(s);
            beams.push({ x, y: paddleY() - PADDLE_H / 2, sprite: s });
          }
          audio.play("laser", { volume: 0.6 });
        }
      }
    }
    for (const bm of beams) {
      bm.y -= 900 * dt;
      bm.sprite.position.set(bm.x, bm.y);
      const hit = bricks.find((br) => br.alive && bm.x >= br.x && bm.x <= br.x + br.w && bm.y <= br.y + br.h && bm.y >= br.y - 4);
      if (hit) {
        damage(hit, true);
        bm.y = -100;
      }
    }
    beams = beams.filter((bm) => {
      if (bm.y > wallTop()) return true;
      bm.sprite.destroy();
      return false;
    });

    // Drops.
    for (const d of drops) {
      d.t += dt;
      d.y += 175 * dt;
      d.sprite.position.set(d.x, d.y);
      d.sprite.rotation = Math.sin(d.t * 5) * 0.25;
      const py = paddleY();
      if (d.y + 12 >= py - PADDLE_H / 2 && d.y - 12 <= py + PADDLE_H / 2 && Math.abs(d.x - paddle.x) <= paddle.w / 2 + 12) {
        collect(d);
        d.y = H + 100;
      }
    }
    drops = drops.filter((d) => {
      if (d.y < H + 40) return true;
      d.sprite.destroy();
      return false;
    });

    // Shards.
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        s.sprite.removeFromParent();
        freeShards.push(s.sprite);
        shards.splice(i, 1);
        continue;
      }
      s.vy += s.gravity * dt;
      s.sprite.x += s.vx * dt;
      s.sprite.y += s.vy * dt;
      s.sprite.rotation += s.vr * dt;
      const k = s.life / s.max;
      s.sprite.alpha = Math.min(1, k * 2);
      s.sprite.scale.set(s.s0 * (0.5 + 0.5 * k));
    }

    // Level clear.
    if (overT < 0 && levelClearT < 0 && bricks.every((b) => !b.alive)) {
      levelClearT = 0;
      if (mode === "play") {
        const bonus = 250 * (level + 1);
        score += bonus;
        popups.add(`LEVEL CLEAR +${bonus}`, W / 2, H * 0.45, ACCENT, 22, 1.4);
        audio.play("win");
        haptic("success");
        tc.analytics.track("level_complete", { level: level + 1 });
      }
    }
    if (levelClearT >= 0) {
      levelClearT += rawDt;
      if (levelClearT > 1.3) {
        levelClearT = -1;
        level = mode === "play" ? level + 1 : rng.pick(ATTRACT_LEVELS);
        paddleHits = 0;
        buildLevel(level, true);
        park();
        launchIn = 1.1;
      }
    }

    if (overT >= 0) {
      overT += rawDt;
      if (!endSent && overT > 0.5) {
        endSent = true;
        session.end(score, { outcome: "lose", stats: { level: level + 1 } });
      }
    }
  }

  // --- rendering --------------------------------------------------------------------------
  function drawWorld() {
    for (const br of bricks) {
      if (!br.alive) continue;
      const k = easeOutBack(clamp(br.appear));
      br.sprite.position.set(br.x, br.y - (1 - clamp(br.appear)) * 60);
      br.sprite.alpha = clamp(br.appear * 1.5);
      // Hit pop on armored bricks: a quick swell around the brick's center.
      const pop = (0.7 + 0.3 * k) * (1 + br.flash * 0.14);
      br.sprite.scale.set((br.w / br.sprite.texture.width) * pop, (br.h / br.sprite.texture.height) * pop);
      br.sprite.x -= (br.w * (pop - 1)) / 2;
      br.sprite.y -= (br.h * (pop - 1)) / 2;
    }
    // Paddle (redrawn only when its width changes).
    const w = paddle.w;
    const sq = paddle.squash.value;
    if (Math.abs(w - paddle.drawnW) > 0.25) {
      paddle.drawnW = w;
      paddleG.clear();
      paddleG.roundRect(-w / 2, -PADDLE_H / 2, w, PADDLE_H, PADDLE_H / 2).fill({ color: "#13234D" }).stroke({ width: 2, color: ACCENT });
      paddleG.roundRect(-w / 2 + 8, -2, w - 16, 4, 2).fill({ color: "#9CC1FF" });
      paddleG.roundRect(-w / 2 + 3, -PADDLE_H / 2 + 2.5, w * 0.35, 2, 1).fill({ color: PAPER, alpha: 0.6 });
    }
    paddleG.position.set(paddle.x, paddleY());
    paddleG.scale.set(1 - sq * 0.012, 1 + sq * 0.03);
    paddleGlow.position.set(paddle.x, paddleY() + 6);
    paddleGlow.width = w * 1.9;
    paddleGlow.height = 54;
    paddleGlow.alpha = powers.beam > 0 ? 0.55 : 0.32;
    paddleGlow.tint = powers.beam > 0 ? POWER_COLORS.beam : powers.wide > 0 ? POWER_COLORS.wide : ACCENT;
    // Balls + trails (pooled sprites: no geometry rebuilt per frame).
    const trailColor = powers.slow > 0 ? POWER_COLORS.slow : ACCENT;
    for (const b of balls) {
      b.trail.unshift([b.x, b.y]);
      if (b.trail.length > TRAIL + 1) b.trail.pop();
      b.trailSprites.forEach((t, i) => {
        const p = b.trail[i + 1];
        t.visible = !!p;
        if (!p) return;
        const k = 1 - (i + 1) / (TRAIL + 1);
        t.position.set(p[0], p[1]);
        t.tint = trailColor;
        t.alpha = 0.35 * k;
        t.width = t.height = BALL_R * 2 * (0.35 + 0.55 * k);
      });
      b.sprite.position.set(b.x, b.y);
      b.glow.position.set(b.x, b.y);
      b.glow.tint = trailColor;
    }
  }

  /** One word, two tones: "VOLT" in the accent over a paper "BRICK", with a spark zigzag underneath. */
  function drawWordmark(g: CanvasRenderingContext2D, y: number, maxWidth: number) {
    const size = drawTitle(g, "VOLTBRICK", 0, y, maxWidth, PAPER, 56, "#1B2B5C");
    g.save();
    g.font = `900 ${size}px ${FONT_DISPLAY}`;
    (g as unknown as { letterSpacing: string }).letterSpacing = `${-size * 0.02}px`;
    const full = g.measureText("VOLTBRICK").width;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = ACCENT;
    g.fillText("VOLT", -full / 2, y);
    const w = full * 0.84;
    const amp = size * 0.07;
    const uy = y + size * 0.3;
    const steps = 10;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = -w / 2 + (w * i) / steps;
      const yy = uy + (i % 2 ? -amp : amp);
      if (i === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.strokeStyle = ACCENT;
    g.lineWidth = Math.max(2, size * 0.06);
    g.lineJoin = "miter";
    g.stroke();
    g.restore();
  }

  let titleCache: HTMLCanvasElement | null = null;
  let titleKey = "";
  function drawTitleBlock(g: CanvasRenderingContext2D, cx: number, ty: number, rw: number, k: number) {
    const pool = g.createRadialGradient(cx, ty + 20, 10, cx, ty + 20, rw * 0.62);
    pool.addColorStop(0, rgba(BG, 0.78));
    pool.addColorStop(1, rgba(BG, 0));
    g.fillStyle = pool;
    g.fillRect(0, ty - 150, W, 330);
    g.save();
    g.translate(cx, ty);
    g.scale(k, k);
    g.rotate(-0.04);
    drawWordmark(g, 40, rw - 20);
    g.restore();
    drawLabel(g, "DRAG ANYWHERE · BREAK EVERYTHING", cx, ty + 92, rgba(PAPER, 0.72), 11);
    if (session.best !== null) drawLabel(g, `BEST ${session.best.toLocaleString("en-US")}`, cx, ty + 114, PAPER, 13);
  }

  function drawHud() {
    hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hctx.clearRect(0, 0, W, H);
    popups.draw(hctx, FONT_MONO);
    if (mode === "play" && session.phase === "playing") {
      const top = hudTop() + 22;
      drawNumber(hctx, score, 14, top, 24, PAPER, "left");
      drawLabel(hctx, `LV ${level + 1}`, W / 2, top, rgba(PAPER, 0.6), 12);
      for (let i = 0; i < Math.max(lives, 0); i++) {
        const pulse = i === lives - 1 ? 1 + livesPulse * 0.5 : 1;
        const x = W - 22 - i * 26;
        hctx.fillStyle = ACCENT;
        hctx.save();
        hctx.translate(x, top);
        hctx.scale(pulse, pulse);
        hctx.beginPath();
        hctx.roundRect(-9, -3, 18, 6, 3);
        hctx.fill();
        hctx.restore();
      }
      // Active power timers under the rail.
      let px = 14;
      for (const k of ["wide", "beam", "slow"] as PowerKind[]) {
        if (powers[k] <= 0) continue;
        const frac = powers[k] / POWER_TIME[k];
        hctx.fillStyle = rgba(POWER_COLORS[k], 0.2);
        hctx.fillRect(px, wallTop() + 8, 54, 4);
        hctx.fillStyle = POWER_COLORS[k];
        hctx.fillRect(px, wallTop() + 8, 54 * frac, 4);
        drawLabel(hctx, k, px, wallTop() + 22, POWER_COLORS[k], 10, "left");
        px += 64;
      }
    } else if (mode === "play") {
      // In the feed the shell's result card takes over after end(); a bare tab needs its own.
      if (session.standalone && session.phaseTime > 0.7) {
        const r = safeRect(session.preview(), W, H);
        drawNumber(hctx, score, r.x + r.w / 2, r.y + 80, 56, PAPER);
        drawTapPrompt(hctx, r.x + r.w / 2, r.y + r.h - 24, time, PAPER, "TAP TO PLAY AGAIN");
      }
    } else {
      const r = safeRect(session.preview(), W, H);
      const cx = r.x + r.w / 2;
      // The logo sits in the open field between the bricks and the paddle, on a soft ink pool.
      const ty = clamp(brickTop() + 7 * (BRICK_H + GAP) + 70, r.y + 70, r.y + r.h - 170);
      if (titleIn < 1) drawTitleBlock(hctx, cx, ty, r.w, easeOutBack(titleIn));
      else {
        const key = `${W}x${H}:${session.best}:${ty}`;
        if (!titleCache || titleKey !== key) {
          titleKey = key;
          titleCache ??= document.createElement("canvas");
          titleCache.width = Math.round(W * dpr);
          titleCache.height = Math.round(H * dpr);
          const g = titleCache.getContext("2d")!;
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.clearRect(0, 0, W, H);
          drawTitleBlock(g, cx, ty, r.w, 1);
        }
        hctx.setTransform(1, 0, 0, 1, 0, 0);
        hctx.drawImage(titleCache, 0, 0);
        hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      drawTapPrompt(hctx, cx, r.y + r.h - 24, time, PAPER);
    }
    flash.draw(hctx, W, H);
  }

  function render() {
    const o = shake.offset;
    world.position.set(o.x, o.y);
    world.rotation = o.angle;
    drawWorld();
    Ticker.system.update(performance.now());
    app.renderer.render(app.stage);
    drawHud();
  }

  /** Draw one of everything before ready() so shader compiles / uploads never land in attract mode. */
  function warmUp() {
    resetRun("attract");
    for (const k of Object.keys(POWER_COLORS) as PowerKind[]) spawnDrop(W / 2, H / 2, k);
    for (const br of bricks) br.appear = 1;
    shard(W / 2, H / 2, ACCENT, { speed: [1, 2], size: [2, 3], life: [0.1, 0.2], add: true });
    shard(W / 2, H / 2, ACCENT, { speed: [1, 2], size: [2, 3], life: [0.1, 0.2] });
    world.alpha = 0.01;
    drawWorld();
    app.renderer.render(app.stage);
    world.alpha = 1;
    drawHud();
    for (const d of drops) d.sprite.destroy();
    drops = [];
    resetRun("attract");
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
  session.on("attract", () => resetRun("attract"));
}

void main();
