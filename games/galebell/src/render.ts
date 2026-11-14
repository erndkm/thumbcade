/**
 * The Pixi scene: the baked table, lit inserts and the lighthouse's beam, buoys, flags, the vane, balls with their
 * trails, flippers, then sparks. It reads the game; it never changes it. Everything lives in table units inside one
 * container scaled to the screen; textures are baked at the screen's pixel density.
 */
import { hexToRgb } from "@thumbcade-games/kit/color";
import type { Photosafe } from "@thumbcade-games/kit/photosafe";
import { Container, Sprite, Texture } from "pixi.js";
import {
  BUOYS,
  canvas,
  drawArrowLit,
  drawBall,
  drawBeam,
  drawBoatLit,
  drawBuoy,
  drawDotLit,
  drawFlag,
  drawFlipper,
  drawGlow,
  drawRing,
  drawSpark,
  drawSpinner,
  drawStreak,
  drawTable,
  drawWindowLit,
  INSERTS,
  PAL,
} from "./art.ts";
import { BALL_R } from "./physics.ts";
import type { Game } from "./rules.ts";
import { TABLE_W, type TableDef } from "./table.ts";

export const hex = (c: string): number => {
  const [r, g, b] = hexToRgb(c);
  return (r << 16) | (g << 8) | b;
};

/** The table's drawn extent in units (the bottom lets the drain show). */
export const VIEW_TOP = -6;
export const VIEW_H = 650;

interface Tex {
  table: Texture;
  ball: Texture;
  glow: Texture;
  glowSoft: Texture;
  flip: Texture;
  flipLit: Texture;
  buoys: Texture[];
  buoysLit: Texture[];
  buoyGold: Texture[];
  flags: Texture[];
  arrow: Texture;
  dot: Texture;
  window: Texture;
  boat: Texture;
  beam: Texture;
  spinner: Texture;
  spark: Texture;
  ring: Texture;
  streak: Texture;
}

function bake(wUnits: number, hUnits: number, T: number, ox: number, oy: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const { c, g } = canvas(wUnits * T, hUnits * T);
  g.scale(T, T);
  g.translate(ox, oy);
  draw(g);
  return Texture.from(c);
}

const POOL = 260;

class Sparks {
  readonly layer = new Container();
  private readonly s: Sprite[] = [];
  private readonly vx = new Float32Array(POOL);
  private readonly vy = new Float32Array(POOL);
  private readonly life = new Float32Array(POOL);
  private readonly max = new Float32Array(POOL);
  private readonly s0 = new Float32Array(POOL);
  private readonly grav = new Float32Array(POOL);
  private readonly ring = new Uint8Array(POOL);
  private next = 0;
  constructor() {
    this.layer.blendMode = "add";
  }
  init(spark: Texture, ring: Texture): void {
    if (this.s.length) {
      for (let i = 0; i < POOL; i++) this.s[i]!.texture = this.ring[i] ? ring : spark;
      this.texSpark = spark;
      this.texRing = ring;
      return;
    }
    this.texSpark = spark;
    this.texRing = ring;
    for (let i = 0; i < POOL; i++) {
      const sp = new Sprite(spark);
      sp.anchor.set(0.5);
      sp.visible = false;
      this.s.push(sp);
      this.layer.addChild(sp);
    }
  }
  private texSpark: Texture = Texture.WHITE;
  private texRing: Texture = Texture.WHITE;
  private unit = 1;
  setUnit(u: number): void {
    this.unit = u;
  }
  emit(x: number, y: number, n: number, color: number, speed: [number, number], size: number, life = 0.45, grav = 600, ring = false): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const sp = this.s[i];
      if (!sp) return;
      const a = Math.random() * Math.PI * 2;
      const v = speed[0] + Math.random() * (speed[1] - speed[0]);
      sp.texture = ring ? this.texRing : this.texSpark;
      this.ring[i] = ring ? 1 : 0;
      sp.position.set(x, y);
      sp.tint = color;
      sp.visible = true;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v;
      this.life[i] = this.max[i] = life * (0.7 + Math.random() * 0.6);
      this.s0[i] = size * (0.6 + Math.random() * 0.6);
      this.grav[i] = grav;
    }
  }
  update(dt: number): void {
    for (let i = 0; i < POOL; i++) {
      const sp = this.s[i]!;
      if (!sp.visible) continue;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        sp.visible = false;
        continue;
      }
      const u = this.life[i]! / this.max[i]!;
      this.vx[i]! *= 1 - 2.5 * dt;
      this.vy[i] = this.vy[i]! * (1 - 2.5 * dt) + this.grav[i]! * dt;
      sp.x += this.vx[i]! * dt;
      sp.y += this.vy[i]! * dt;
      const sc = this.ring[i] ? this.s0[i]! * (1.6 - u) : this.s0[i]! * (0.3 + 0.7 * u);
      sp.scale.set((sc / 32) * this.unit);
      sp.alpha = this.ring[i] ? u * 0.7 : Math.min(1, u * 1.6);
    }
  }
  clear(): void {
    for (const sp of this.s) sp.visible = false;
  }
}

interface BallVis {
  id: number;
  glow: Sprite;
  body: Sprite;
  trail: Sprite[];
  hist: Float32Array;
  head: number;
  n: number;
}

const TRAIL = 10;

export class Renderer {
  readonly stage = new Container();
  readonly world = new Container();
  /** CSS px per table unit, and the table's offset on screen. */
  k = 1;
  ox = 0;
  oy = 0;
  private T = 2;
  private tex: Tex | null = null;
  private readonly tableSprite = new Sprite();
  private readonly beamLayer = new Container();
  private readonly beams = [new Sprite(), new Sprite()];
  private readonly insertGlow = new Container();
  private readonly inserts = new Container();
  private readonly buoyGlow: Sprite[] = [];
  private readonly buoyCap: Sprite[] = [];
  private readonly buoyPulse = [0, 0, 0];
  private readonly flags: Sprite[] = [];
  private readonly flagK = [1, 1, 1, 1];
  private readonly slingFlash: Sprite[] = [];
  private readonly slingK = [0, 0];
  private readonly spinner = new Sprite();
  private readonly flippers: Sprite[] = [];
  private readonly flipGlow: Sprite[] = [];
  private readonly ballLayer = new Container();
  private readonly trailLayer = new Container();
  private readonly balls = new Map<number, BallVis>();
  private readonly free: BallVis[] = [];
  readonly sparks = new Sparks();
  private readonly rain = new Container();
  private readonly drops: Sprite[] = [];
  private readonly harbourGlow = new Sprite();
  private readonly heldBall = new Sprite();
  private harbourK = 0;
  // Insert sprites.
  private readonly ins = {
    orbitL: new Sprite(),
    orbitR: new Sprite(),
    harbour: new Sprite(),
    berths: [new Sprite(), new Sprite()],
    lanes: [new Sprite(), new Sprite(), new Sprite()],
    windows: [0, 1, 2, 3, 4].map(() => new Sprite()),
    boat: new Sprite(),
    lamp: new Sprite(),
  };
  private readonly insGlows: Sprite[] = [];
  private beamA = 0;
  private chase = 0;

  constructor(private readonly def: TableDef) {
    this.stage.addChild(this.world);
    this.beamLayer.blendMode = "add";
    this.insertGlow.blendMode = "add";
    this.trailLayer.blendMode = "add";
    this.rain.blendMode = "add";
    const glowLayer = new Container();
    glowLayer.blendMode = "add";
    this.world.addChild(this.tableSprite, this.rain, this.beamLayer, this.insertGlow, this.inserts, glowLayer, this.trailLayer, this.ballLayer, this.sparks.layer);
    for (const b of this.beams) {
      b.anchor.set(0, 0.5);
      this.beamLayer.addChild(b);
    }
    for (let i = 0; i < 3; i++) {
      const g = new Sprite();
      g.anchor.set(0.5);
      glowLayer.addChild(g);
      this.buoyGlow.push(g);
      const c = new Sprite();
      c.anchor.set(0.5);
      this.inserts.addChild(c);
      this.buoyCap.push(c);
    }
    for (let i = 0; i < 4; i++) {
      const f = new Sprite();
      f.anchor.set(0.5);
      this.inserts.addChild(f);
      this.flags.push(f);
    }
    for (let i = 0; i < 2; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      glowLayer.addChild(s);
      this.slingFlash.push(s);
      const fg = new Sprite();
      fg.anchor.set(0.5);
      glowLayer.addChild(fg);
      this.flipGlow.push(fg);
    }
    this.spinner.anchor.set(0.5);
    this.inserts.addChild(this.spinner);
    this.harbourGlow.anchor.set(0.5);
    glowLayer.addChild(this.harbourGlow);
    this.heldBall.anchor.set(0.5);
    this.heldBall.visible = false;
    this.inserts.addChild(this.heldBall);
    const all = [this.ins.orbitL, this.ins.orbitR, this.ins.harbour, ...this.ins.berths, ...this.ins.lanes, ...this.ins.windows, this.ins.boat, this.ins.lamp];
    for (const s of all) {
      s.anchor.set(0.5);
      this.inserts.addChild(s);
      const g = new Sprite();
      g.anchor.set(0.5);
      this.insertGlow.addChild(g);
      this.insGlows.push(g);
    }
    for (let i = 0; i < 2; i++) {
      const f = new Sprite();
      this.world.addChild(f);
      this.flippers.push(f);
    }
    // Flippers sit above the balls' layer order except sparks.
    this.world.removeChild(this.sparks.layer);
    this.world.addChild(this.sparks.layer);
    for (let i = 0; i < 46; i++) {
      const d = new Sprite();
      d.anchor.set(0.5);
      d.visible = false;
      this.rain.addChild(d);
      this.drops.push(d);
    }
  }

  /** Fits the table to the screen (width first, aligned to the bottom) and re-bakes every texture at that density. */
  layout(W: number, H: number, dpr: number, topReserve: number): void {
    // The table fills the width (a 2-unit margin a side) and sits on the bottom edge; a very tall screen gets the
    // spare room above the arch, where the HUD lives.
    const k = Math.min(W / (TABLE_W + 4), (H - Math.max(0, topReserve - 30)) / VIEW_H);
    this.k = k;
    this.ox = (W - TABLE_W * k) / 2;
    this.oy = H - (VIEW_H + VIEW_TOP) * k;
    this.world.position.set(this.ox, this.oy);
    this.world.scale.set(k);
    const T = Math.min(4, k * dpr);
    if (this.tex && Math.abs(T - this.T) < 0.01) return;
    this.T = T;
    this.tex?.table.destroy(true);
    this.tex = this.bakeAll(T);
    const t = this.tex;
    const u = 1 / T;
    this.tableSprite.texture = t.table;
    this.tableSprite.position.set(-14, -14);
    this.tableSprite.scale.set(u);
    for (const b of this.beams) {
      b.texture = t.beam;
      b.scale.set(u * 2);
      b.position.set(INSERTS.lamp.x, INSERTS.lamp.y - 4);
    }
    this.def.bumpers.forEach((bp, i) => {
      const g = this.buoyGlow[i]!;
      g.texture = t.glow;
      g.position.set(bp.x, bp.y);
      g.tint = hex(BUOYS[i]!.color);
      const c = this.buoyCap[i]!;
      c.texture = t.buoys[i]!;
      c.position.set(bp.x, bp.y);
      c.scale.set(u);
    });
    this.def.targets.forEach((tg, i) => {
      const f = this.flags[i]!;
      f.texture = t.flags[i]!;
      f.position.set((tg.ax + tg.bx) / 2, (tg.ay + tg.by) / 2);
      f.rotation = Math.atan2(tg.by - tg.ay, tg.bx - tg.ax);
      f.scale.set(u);
    });
    this.def.slings.forEach((s, i) => {
      const f = this.slingFlash[i]!;
      const [ax, ay, bx, by] = s.face;
      f.texture = t.glowSoft;
      f.position.set((ax + bx) / 2, (ay + by) / 2);
      f.rotation = Math.atan2(by - ay, bx - ax);
      f.tint = hex(PAL.seaHi);
      const len = Math.hypot(bx - ax, by - ay);
      f.scale.set((len + 16) / 64, 14 / 64);
      f.alpha = 0;
    });
    this.spinner.texture = t.spinner;
    this.spinner.position.set((this.def.spinner.x0 + this.def.spinner.x1) / 2, this.def.spinner.y);
    this.spinner.scale.set(u);
    this.harbourGlow.texture = t.glow;
    this.harbourGlow.position.set(this.def.harbour.x, this.def.harbour.y);
    this.harbourGlow.tint = hex(PAL.lamp);
    this.heldBall.texture = t.ball;
    this.heldBall.position.set(this.def.harbour.x, this.def.harbour.y);
    this.heldBall.scale.set(u * 0.9);
    // Inserts.
    const place = (s: Sprite, tex: Texture, x: number, y: number) => {
      s.texture = tex;
      s.position.set(x, y);
      s.scale.set(u);
    };
    place(this.ins.orbitL, t.arrow, INSERTS.orbitL.x, INSERTS.orbitL.y);
    place(this.ins.orbitR, t.arrow, INSERTS.orbitR.x, INSERTS.orbitR.y);
    place(this.ins.harbour, t.arrow, INSERTS.harbour.x, INSERTS.harbour.y);
    INSERTS.berths.forEach((b, i) => place(this.ins.berths[i]!, t.ball, b.x, b.y));
    for (const s of this.ins.berths) s.scale.set(u * 0.72);
    INSERTS.lanes.forEach((l, i) => place(this.ins.lanes[i]!, t.dot, l.x, l.y));
    INSERTS.windows.forEach((wd, i) => place(this.ins.windows[i]!, t.window, wd.x, wd.y));
    place(this.ins.boat, t.boat, INSERTS.lifeboat.x, INSERTS.lifeboat.y);
    place(this.ins.lamp, t.dot, INSERTS.lamp.x, INSERTS.lamp.y - 4);
    this.ins.lamp.scale.set(u * 1.1);
    const sprites = [this.ins.orbitL, this.ins.orbitR, this.ins.harbour, ...this.ins.berths, ...this.ins.lanes, ...this.ins.windows, this.ins.boat, this.ins.lamp];
    sprites.forEach((s, i) => {
      const g = this.insGlows[i]!;
      g.texture = t.glowSoft;
      g.position.copyFrom(s.position);
      g.tint = hex(s === this.ins.boat ? PAL.kelp : PAL.lamp);
      g.scale.set(0.5);
    });
    this.def.flippers.forEach((fd, i) => {
      const f = this.flippers[i]!;
      f.texture = t.flip;
      f.anchor.set((fd.r0 + 3) / (fd.len + fd.r0 + fd.r1 + 6), 0.5);
      f.position.set(fd.x, fd.y);
      f.scale.set(u);
      const g = this.flipGlow[i]!;
      g.texture = t.glowSoft;
      g.tint = hex(PAL.lamp);
      g.alpha = 0;
    });
    for (const d of this.drops) {
      d.texture = t.streak;
      d.scale.set(u);
      d.tint = hex(PAL.seaHi);
    }
    this.sparks.init(t.spark, t.ring);
    this.sparks.setUnit(1);
    for (const v of this.balls.values()) this.texBall(v);
    for (const v of this.free) this.texBall(v);
  }

  private bakeAll(T: number): Tex {
    const def = this.def;
    const fd = def.flippers[0];
    const fw = fd.len + fd.r0 + fd.r1 + 6;
    const fh = fd.r0 * 2 + 6;
    const flip = (lit: boolean) => bake(fw, fh, T, fd.r0 + 3, fh / 2, (g) => drawFlipper(g, fd, lit));
    const R = def.bumpers[0]!.R;
    const buoy = (i: number, lit: boolean, gold: boolean) =>
      bake(R * 2 + 4, R * 2 + 4, T, R + 2, R + 2, (g) => drawBuoy(g, R, gold ? PAL.gold : BUOYS[i]!.color, BUOYS[i]!.mark, lit, gold));
    const tg = def.targets[0]!;
    const flagW = Math.hypot(tg.bx - tg.ax, tg.by - tg.ay) + 2;
    return {
      table: bake(TABLE_W + 28, VIEW_H + 22, T, 14, 14, (g) => drawTable(g, def)),
      ball: bake(BALL_R * 2 + 2, BALL_R * 2 + 2, T, BALL_R + 1, BALL_R + 1, (g) => drawBall(g, BALL_R)),
      glow: bake(64, 64, Math.min(T, 2), 32, 32, (g) => drawGlow(g, 32, "#ffffff", 0.7)),
      glowSoft: bake(64, 64, Math.min(T, 1.5), 32, 32, (g) => drawGlow(g, 32, "#ffffff", 0.45)),
      flip: flip(false),
      flipLit: flip(true),
      buoys: [0, 1, 2].map((i) => buoy(i, false, false)),
      buoysLit: [0, 1, 2].map((i) => buoy(i, true, false)),
      buoyGold: [0, 1, 2].map((i) => buoy(i, false, true)),
      flags: [0, 1, 2, 3].map((i) => bake(flagW + 2, 8, T, flagW / 2 + 1, 4, (g) => drawFlag(g, flagW, 5.5, i))),
      arrow: bake(22, 22, T, 11, 11, (g) => drawArrowLit(g, 9)),
      dot: bake(14, 14, T, 7, 7, (g) => drawDotLit(g, 5)),
      window: bake(10, 10, T, 5, 5, (g) => drawWindowLit(g, 4)),
      boat: bake(22, 14, T, 11, 8, (g) => drawBoatLit(g)),
      beam: bake(140, 50, Math.min(T, 1.2), 0, 25, (g) => drawBeam(g, 140, 22)),
      spinner: bake(36, 6, T, 18, 3, (g) => drawSpinner(g, 33)),
      spark: bake(32, 32, Math.min(T, 1.5), 16, 16, (g) => drawSpark(g, 16)),
      ring: bake(32, 32, Math.min(T, 1.5), 16, 16, (g) => drawRing(g, 16)),
      streak: bake(2, 16, T, 1, 8, (g) => drawStreak(g, 14)),
    };
  }

  private texBall(v: BallVis): void {
    const t = this.tex!;
    v.body.texture = t.ball;
    v.body.scale.set(1 / this.T);
    v.glow.texture = t.glow;
    v.glow.scale.set(46 / 64);
    for (const s of v.trail) {
      s.texture = t.glowSoft;
    }
  }

  private visFor(id: number): BallVis {
    let v = this.balls.get(id);
    if (v) return v;
    v = this.free.pop();
    if (!v) {
      const glow = new Sprite();
      glow.anchor.set(0.5);
      glow.blendMode = "add";
      const body = new Sprite();
      body.anchor.set(0.5);
      const trail: Sprite[] = [];
      for (let i = 0; i < TRAIL; i++) {
        const s = new Sprite();
        s.anchor.set(0.5);
        this.trailLayer.addChild(s);
        trail.push(s);
      }
      this.ballLayer.addChild(glow, body);
      v = { id, glow, body, trail, hist: new Float32Array(TRAIL * 2), head: 0, n: 0 };
      if (this.tex) this.texBall(v);
    }
    v.id = id;
    v.n = 0;
    v.glow.visible = v.body.visible = true;
    this.balls.set(id, v);
    return v;
  }

  // --- reactions ---------------------------------------------------------------------------------------------------

  bumperHit(i: number): void {
    this.buoyPulse[i] = 1;
  }

  slingKick(i: number): void {
    this.slingK[i] = 1;
  }

  harbourPulse(): void {
    this.harbourK = 1;
  }

  burst(x: number, y: number, color: string, n: number, speed = 260, size = 7): void {
    this.sparks.emit(x, y, n, hex(color), [speed * 0.4, speed], size, 0.5, 500);
  }

  ring(x: number, y: number, color: string, size = 30): void {
    this.sparks.emit(x, y, 1, hex(color), [0, 0], size, 0.45, 0, true);
  }

  chaseLights(): void {
    this.chase = 1;
  }

  clear(): void {
    this.sparks.clear();
    for (const v of this.balls.values()) {
      v.n = 0;
    }
  }

  // --- the frame ---------------------------------------------------------------------------------------------------

  draw(g: Game, time: number, dt: number, light: Photosafe, shakeX: number, shakeY: number, reduced: boolean, pressed: [boolean, boolean]): void {
    const t = this.tex;
    if (!t) return;
    this.world.position.set(this.ox + shakeX, this.oy + shakeY);
    const w = g.world;
    // Flippers.
    w.flippers.forEach((f, i) => {
      const s = this.flippers[i]!;
      s.rotation = f.angle;
      const lit = pressed[i]!;
      s.texture = lit ? t.flipLit : t.flip;
      const gl = this.flipGlow[i]!;
      const tip = w.tip(i);
      gl.position.set((f.def.x + tip.x) / 2, (f.def.y + tip.y) / 2);
      gl.rotation = f.angle;
      gl.scale.set(80 / 64, 26 / 64);
      gl.alpha = lit ? 0.35 : Math.max(0, gl.alpha - dt * 4);
    });
    // Balls.
    const seen = new Set<number>();
    for (const b of w.balls) {
      seen.add(b.id);
      const v = this.visFor(b.id);
      v.body.position.set(b.x, b.y);
      v.body.rotation = b.roll * 0.2;
      v.glow.position.set(b.x, b.y);
      const sp = Math.hypot(b.vx, b.vy);
      v.glow.tint = hex(PAL.lampHi);
      v.glow.alpha = 0.18 + Math.min(0.22, sp / 9000);
      v.head = (v.head + 1) % TRAIL;
      v.hist[v.head * 2] = b.x;
      v.hist[v.head * 2 + 1] = b.y;
      v.n = Math.min(TRAIL, v.n + 1);
      for (let k = 0; k < TRAIL; k++) {
        const s = v.trail[k]!;
        if (k >= v.n || sp < 250) {
          s.visible = false;
          continue;
        }
        const j = ((v.head - k + TRAIL) % TRAIL) * 2;
        s.visible = true;
        s.position.set(v.hist[j]!, v.hist[j + 1]!);
        const u = 1 - k / TRAIL;
        s.scale.set((BALL_R * 2.2 * u) / 64);
        s.alpha = 0.32 * u * Math.min(1, sp / 1500);
        s.tint = hex(g.multiball ? PAL.lamp : PAL.seaHi);
      }
    }
    for (const [id, v] of this.balls) {
      if (seen.has(id)) continue;
      this.balls.delete(id);
      v.glow.visible = v.body.visible = false;
      for (const s of v.trail) s.visible = false;
      this.free.push(v);
    }
    // Buoys.
    for (let i = 0; i < 3; i++) {
      const p = this.buoyPulse[i]!;
      this.buoyPulse[i] = Math.max(0, p - dt * 6);
      const gold = g.gold === i;
      const c = this.buoyCap[i]!;
      c.texture = gold ? t.buoyGold[i]! : p > 0.4 ? t.buoysLit[i]! : t.buoys[i]!;
      c.scale.set((1 / this.T) * (1 + 0.14 * p * (reduced ? 0.3 : 1)));
      const gl = this.buoyGlow[i]!;
      gl.tint = hex(gold ? PAL.gold : BUOYS[i]!.color);
      gl.alpha = 0.12 + 0.55 * p + (gold ? 0.25 + 0.15 * light.pulse(time, 1.2, { still: 0.5 }) : 0);
      gl.scale.set((60 + 22 * p) / 64);
    }
    // Flags drop and rise.
    for (let i = 0; i < 4; i++) {
      const up = g.flags[i]!;
      this.flagK[i] = Math.max(0, Math.min(1, this.flagK[i]! + (up ? dt * 6 : -dt * 8)));
      const f = this.flags[i]!;
      f.alpha = 0.15 + 0.85 * this.flagK[i]!;
      f.scale.set(1 / this.T, (1 / this.T) * (0.25 + 0.75 * this.flagK[i]!));
    }
    // Sling flashes.
    for (let i = 0; i < 2; i++) {
      this.slingK[i] = Math.max(0, this.slingK[i]! - dt * 7);
      this.slingFlash[i]!.alpha = this.slingK[i]! * 0.8;
    }
    // The vane.
    this.spinner.scale.set(1 / this.T, (1 / this.T) * Math.max(0.12, Math.abs(Math.cos(w.spin))));
    // A ball sitting in the harbour.
    this.heldBall.visible = g.harbourHolding;
    // Harbour glow.
    this.harbourK = Math.max(0, this.harbourK - dt * 2.5);
    const lit = g.harbourLit;
    this.harbourGlow.alpha = (lit !== "none" ? 0.25 + 0.25 * light.pulse(time, 1.5, { still: 0.6 }) : 0) + this.harbourK * 0.6;
    this.harbourGlow.scale.set(54 / 64);
    // Inserts.
    const pulse = light.pulse(time, 2, { still: 1 });
    const set = (s: Sprite, on: number, glowIndex: number) => {
      s.alpha = on;
      const gl = this.insGlows[glowIndex]!;
      gl.alpha = on * 0.45;
      gl.scale.set(0.55 + 0.15 * on);
    };
    this.chase = Math.max(0, this.chase - dt * 0.6);
    const ch = this.chase > 0 ? (this.chase * 6) % 1 : -1;
    const comboOpen = g.t - g.lastShotT < 4 && g.phase === "play";
    const orbitOn = g.multiball ? 0.45 + 0.55 * pulse : comboOpen ? 0.5 : 0.12;
    set(this.ins.orbitL, Math.max(orbitOn, ch >= 0 && ch < 0.33 ? 1 : 0), 0);
    set(this.ins.orbitR, Math.max(orbitOn, ch >= 0.33 && ch < 0.66 ? 1 : 0), 1);
    set(this.ins.harbour, lit !== "none" ? 0.45 + 0.55 * pulse : ch >= 0.66 ? 1 : 0.05, 2);
    set(this.ins.berths[0]!, g.locks >= 1 ? 1 : 0, 3);
    set(this.ins.berths[1]!, g.locks >= 2 ? 1 : 0, 4);
    for (let i = 0; i < 3; i++) set(this.ins.lanes[i]!, g.lanes[i] ? (g.lanesFlash > 0 ? 0.5 + 0.5 * pulse : 1) : 0, 5 + i);
    for (let i = 0; i < 5; i++) set(this.ins.windows[i]!, i < g.tier ? 1 : i === g.tier && g.needed > 0 ? 0.25 * (g.charge / g.needed) : 0, 8 + i);
    const left = g.saveLeft;
    set(this.ins.boat, g.lifeboatOn ? (left < 2 ? 0.4 + 0.6 * pulse : 1) : 0, 13);
    set(this.ins.lamp, 0.55 + 0.09 * g.tier, 14);
    this.insGlows[14]!.scale.set(0.6 + 0.12 * g.tier);
    // The lighthouse beam turns (two opposite beams), faster as the storm rises; dim and slow under reduced motion.
    const spin = (0.32 + 0.12 * (g.tier - 1)) * (reduced ? 0.4 : 1);
    this.beamA += dt * spin;
    this.beams.forEach((b, i) => {
      b.rotation = this.beamA + i * Math.PI;
      b.alpha = (0.1 + 0.025 * g.tier) * (reduced ? 0.6 : 1);
    });
    // Rain: a few faint streaks, more as the storm rises.
    const want = reduced ? 0 : Math.round(6 + 8 * (g.tier - 1));
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]!;
      if (i >= want) {
        d.visible = false;
        continue;
      }
      if (!d.visible || d.y > VIEW_H) {
        d.visible = true;
        d.position.set(Math.random() * (TABLE_W + 40) - 20, -20 - Math.random() * 300);
        d.alpha = 0.08 + Math.random() * 0.1;
      }
      d.x -= 90 * dt;
      d.y += 520 * dt;
      d.rotation = 0.17;
    }
    this.sparks.update(dt);
  }

  /** Draws each texture once (uploads before ready()). */
  prewarmSprites(): Sprite[] {
    const t = this.tex!;
    return [t.ball, t.glow, t.glowSoft, t.flip, t.flipLit, ...t.buoys, ...t.buoysLit, ...t.buoyGold, ...t.flags, t.arrow, t.dot, t.window, t.boat, t.beam, t.spinner, t.spark, t.ring, t.streak].map((x) => {
      const s = new Sprite(x);
      s.alpha = 0.01;
      return s;
    });
  }

  /** Table units to CSS px. */
  sx(x: number): number {
    return this.ox + x * this.k;
  }
  sy(y: number): number {
    return this.oy + y * this.k;
  }
}
