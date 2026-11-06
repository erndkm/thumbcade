/**
 * The Pixi scene: parallax backdrop, enemies, the player's fire, effects, the ship, then enemy bullets on top of
 * everything (readability first), then the hitbox above them. It only reads the simulation; it never changes it.
 */
import { Container, Sprite, Texture, TilingSprite } from "pixi.js";
import { hexToRgb, rgba } from "@thumbcade-games/kit/color";
import { FIELD_W, PAL } from "./consts.ts";
import { FX_DOT, FX_GLOW, FX_PUFF, FX_RING, FX_SHARD, FX_SPARK, Fx } from "./fx.ts";
import type { Enemy, EnemyKind, PickupKind, Sim } from "./sim.ts";
import { TS, type Textures } from "./textures.ts";

const hex = (c: string): number => {
  const [r, g, b] = hexToRgb(c);
  return (r << 16) | (g << 8) | b;
};

export const C = {
  white: 0xffffff,
  paper: hex(PAL.paper),
  accent: hex(PAL.accent),
  accentHi: hex(PAL.accentHi),
  bullet: hex(PAL.bullet),
  bulletHi: hex(PAL.bulletHi),
  crystal: hex(PAL.crystal),
  dart: hex(PAL.dart),
  weaver: hex(PAL.weaver),
  bloom: hex(PAL.bloom),
  bastion: hex(PAL.bastion),
  skiff: hex(PAL.skiff),
  loom: hex(PAL.loom),
  loomGold: hex(PAL.loomGold),
  smoke: 0x2a1d48,
  smokeWarm: 0x4a2430,
  warn: hex(PAL.warn),
  shield: 0x8cb8ff,
} as const;

export const KIND_COLOR: Record<EnemyKind, number> = {
  dart: C.dart,
  weaver: C.weaver,
  bloom: C.bloom,
  bastion: C.bastion,
  skiff: C.skiff,
  arm: C.loomGold,
  core: C.loom,
};

export const PICKUP_COLOR: Record<PickupKind, number> = { power: C.accent, drone: C.paper, shield: C.shield, nova: C.bloom };

interface Vis {
  kind: EnemyKind;
  glow: Sprite;
  body: Sprite;
  flash: Sprite;
  extra: Sprite[];
  stamp: number;
  id: number;
}

/** Per-frame view state the renderer needs beyond the simulation. */
export interface View {
  time: number;
  dt: number;
  shakeX: number;
  shakeY: number;
  shakeA: number;
  /** -1 (left) … 1 (right): the ship banks into sideways motion. */
  bank: number;
  attract: boolean;
  reduced: boolean;
  /** 0-1 warm tint while the Loom is on its way and on screen. */
  bossTint: number;
  /** How far the planet has sunk (field units). */
  planetSink: number;
  /** Seconds the backdrop has scrolled (slower in attract under reduced motion). */
  scroll: number;
}

const SCALE = 1 / TS;
/** Drawn sizes relative to the art: the shuttle and enemies read bigger than their hitboxes. */
const SHIPV = 1.3;
const ENV = 1.15;
/** The Loom is drawn larger again: it has to loom. */
const BOSSV = 1.3;
/** Sprite scale per field unit of diameter for the 64-unit glow textures, per unit of radius for the ring, per unit of diameter for the puff. */
const G = SCALE / 64;
const R = SCALE / 30;
const P = SCALE / 32;

export class Renderer {
  readonly stage = new Container();
  readonly fx = new Fx();
  /** CSS px per field unit. */
  k = 1;
  fieldH = 700;

  private readonly bg = new Container();
  private readonly world = new Container();
  private readonly bgBase = new Sprite();
  private nebula: TilingSprite | null = null;
  private dustFar: TilingSprite | null = null;
  private dustNear: TilingSprite | null = null;
  private readonly planet = new Sprite();
  private readonly streaks: Sprite[] = [];
  private readonly rocks: Sprite[] = [];
  private readonly vignette = new Sprite();
  private readonly tint = new Sprite(Texture.WHITE);

  private readonly enemyGlow = new Container();
  private readonly threads = new Container();
  private readonly enemyLayer = new Container();
  private readonly pickupGlow = new Container();
  private readonly pickupLayer = new Container();
  private readonly shotLayer = new Container();
  private readonly crystalLayer = new Container();
  private readonly shipGlowLayer = new Container();
  private readonly shipLayer = new Container();
  private readonly bulletLayer = new Container();
  private readonly topLayer = new Container();

  private readonly bossGlow = new Sprite();
  private readonly bossWheel = new Sprite();

  private readonly vis = new Map<number, Vis>();
  private readonly active: Vis[] = [];
  private readonly free = new Map<EnemyKind, Vis[]>();
  private stamp = 0;

  private readonly bulletSprites: Sprite[] = [];
  private readonly shotSprites: Sprite[] = [];
  private readonly crystalSprites: Sprite[] = [];
  private readonly threadSprites: Sprite[] = [];
  private readonly pickupSprites: Array<{ glow: Sprite; ring: Sprite; body: Sprite }> = [];

  private readonly ship = new Sprite();
  private readonly shipGlow = new Sprite();
  private readonly flames: Sprite[] = [];
  private readonly bubble = new Sprite();
  private readonly hitbox = new Sprite();
  private readonly hitboxGlow = new Sprite();
  private readonly drones: Sprite[] = [];
  private readonly droneGlows: Sprite[] = [];
  private shipLevel = 0;

  constructor(private readonly t: Textures) {
    this.stage.addChild(this.bg, this.world);
    this.bg.addChild(this.bgBase);
    this.enemyGlow.blendMode = "add";
    this.threads.blendMode = "add";
    this.pickupGlow.blendMode = "add";
    this.shotLayer.blendMode = "add";
    this.crystalLayer.blendMode = "add";
    this.shipGlowLayer.blendMode = "add";
    this.world.addChild(
      this.enemyGlow,
      this.threads,
      this.bossWheel,
      this.enemyLayer,
      this.pickupGlow,
      this.pickupLayer,
      this.shotLayer,
      this.fx.matter.layer,
      this.fx.light.layer,
      this.crystalLayer,
      this.shipGlowLayer,
      this.shipLayer,
      this.bulletLayer,
      this.topLayer,
    );
    this.enemyGlow.addChild(this.bossGlow);
    this.bossGlow.texture = t.glowSoft;
    this.bossGlow.anchor.set(0.5);
    this.bossGlow.tint = C.loom;
    this.bossWheel.texture = t.loomWheel;
    this.bossWheel.anchor.set(0.5);
    this.bossWheel.scale.set(SCALE);

    // The ship.
    this.shipGlow.texture = t.glow;
    this.shipGlow.anchor.set(0.5);
    this.shipGlow.tint = C.accent;
    this.shipGlowLayer.addChild(this.shipGlow);
    for (let i = 0; i < 2; i++) {
      const f = new Sprite(t.flame);
      f.anchor.set(0.5, 0.15);
      this.flames.push(f);
      this.shipGlowLayer.addChild(f);
    }
    for (let i = 0; i < 2; i++) {
      const g = new Sprite(t.glow);
      g.anchor.set(0.5);
      g.tint = C.accent;
      g.visible = false;
      this.droneGlows.push(g);
      this.shipGlowLayer.addChild(g);
      const d = new Sprite(t.drone);
      d.anchor.set(0.5);
      d.scale.set(SCALE * 1.25);
      d.visible = false;
      this.drones.push(d);
      this.shipLayer.addChild(d);
    }
    this.ship.anchor.set(0.5);
    this.ship.scale.set(SCALE);
    this.shipLayer.addChild(this.ship);
    this.bubble.texture = t.bubble;
    this.bubble.anchor.set(0.5);
    this.bubble.blendMode = "add";
    this.bubble.scale.set(SCALE * 1.15);
    this.shipLayer.addChild(this.bubble);
    this.hitboxGlow.texture = t.glowSoft;
    this.hitboxGlow.anchor.set(0.5);
    this.hitboxGlow.blendMode = "add";
    this.hitboxGlow.tint = C.white;
    this.hitbox.texture = t.hitbox;
    this.hitbox.anchor.set(0.5);
    this.hitbox.scale.set(SCALE);
    this.topLayer.addChild(this.hitboxGlow, this.hitbox);
  }

  /** Lays out for a W×H viewport (CSS px). Rebuilds the backdrop. */
  layout(W: number, H: number): void {
    this.k = W / FIELD_W;
    this.fieldH = H / this.k;
    this.bg.scale.set(this.k);
    this.world.scale.set(this.k);
    this.buildBackdrop();
  }

  /** Field units -> CSS px. */
  toCss(v: number): number {
    return v * this.k;
  }

  // --- backdrop ------------------------------------------------------------------------------------------

  private buildBackdrop(): void {
    const H = this.fieldH;
    const W = FIELD_W;
    // Base: deep midnight with a faint violet band; static, one quad.
    const base = canvas(W, H, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, "#08071A");
      gr.addColorStop(0.45, "#0C0920");
      gr.addColorStop(1, "#05040B");
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      blob(g, W * 0.2, H * 0.2, W * 0.75, "#3B1C6E", 0.22);
      blob(g, W * 0.95, H * 0.55, W * 0.7, "#0E4A5A", 0.2);
      blob(g, W * 0.45, H * 0.95, W * 0.8, "#40123E", 0.16);
      // A small far moon, lit from the left.
      const mx = W * 0.8;
      const my = H * 0.13;
      blob(g, mx, my, 70, "#38FFD0", 0.06);
      g.fillStyle = "#16122E";
      g.beginPath();
      g.arc(mx, my, 22, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(mx, my, 22, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = "#3A3270";
      g.beginPath();
      g.arc(mx - 9, my - 4, 22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#16122E";
      g.beginPath();
      g.arc(mx + 4, my + 1, 21, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.strokeStyle = rgba(PAL.accent, 0.35);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(mx, my, 22, Math.PI * 0.6, Math.PI * 1.45);
      g.stroke();
    }, 1.2);
    this.setTex(this.bgBase, base, W, H);

    // Nebula wisps and the loom's threads of light: a tall seamless tile that drifts down.
    const tileH = 720;
    const neb = canvas(W, tileH, (g) => {
      const wrap = (fn: (dy: number) => void) => {
        fn(0);
        fn(-tileH);
        fn(tileH);
      };
      // Clouds: clusters of soft blobs, so the nebula has structure instead of a smooth wash.
      let seed = 4242;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const clouds: Array<[number, number, number, string, number]> = [
        [70, 120, 120, "#6A34C8", 0.09],
        [300, 330, 130, "#1C9AAE", 0.08],
        [140, 560, 110, "#B83A7E", 0.07],
        [330, 640, 80, "#6A34C8", 0.06],
      ];
      for (const [cx, cy, r, col, a] of clouds) {
        for (let i = 0; i < 22; i++) {
          const ang = rnd() * Math.PI * 2;
          const d = Math.sqrt(rnd()) * r;
          const br = r * (0.22 + rnd() * 0.4);
          wrap((dy) => blob(g, cx + Math.cos(ang) * d * 1.3, cy + Math.sin(ang) * d * 0.8 + dy, br, col, a * (0.6 + rnd() * 0.8)));
        }
        wrap((dy) => blob(g, cx, cy + dy, r * 1.4, col, a * 0.7));
      }
      // Threads: long faint curves crossing the field, two colours.
      g.lineCap = "round";
      for (let i = 0; i < 7; i++) {
        const y0 = (i / 7) * tileH;
        const col = i % 2 ? PAL.accent : PAL.loom;
        wrap((dy) => {
          g.strokeStyle = rgba(col, i % 3 === 0 ? 0.09 : 0.05);
          g.lineWidth = i % 3 === 0 ? 1.4 : 0.8;
          g.beginPath();
          for (let x = -10; x <= W + 10; x += 10) {
            const y = y0 + dy + Math.sin(x * 0.018 + i * 1.7) * 36 + (x - W / 2) * (i % 2 ? 0.35 : -0.35);
            if (x === -10) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        });
      }
    });
    this.nebula?.destroy();
    this.nebula = new TilingSprite({ texture: Texture.from(neb), width: W, height: H });
    this.nebula.alpha = 1;

    // Dust: two tiles of tiny lights at different depths.
    const dust = (n: number, rMin: number, rMax: number, aMin: number, aMax: number, glints: number) =>
      canvas(256, 256, (g) => {
        let seed = n * 31 + 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
        for (let i = 0; i < n; i++) {
          const x = rnd() * 256;
          const y = rnd() * 256;
          const r = rMin + rnd() * (rMax - rMin);
          const a = aMin + rnd() * (aMax - aMin);
          const col = rnd() < 0.2 ? PAL.accentHi : rnd() < 0.3 ? "#FFD9EC" : PAL.paper;
          g.fillStyle = rgba(col, a);
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          if (i < glints) {
            g.strokeStyle = rgba(col, a * 0.5);
            g.lineWidth = 0.6;
            g.beginPath();
            g.moveTo(x - r * 4, y);
            g.lineTo(x + r * 4, y);
            g.moveTo(x, y - r * 4);
            g.lineTo(x, y + r * 4);
            g.stroke();
          }
        }
      });
    this.dustFar?.destroy();
    this.dustNear?.destroy();
    this.dustFar = new TilingSprite({ texture: Texture.from(dust(90, 0.5, 1.1, 0.25, 0.6, 0)), width: W, height: H });
    this.dustFar.tileScale.set(0.6);
    this.dustNear = new TilingSprite({ texture: Texture.from(dust(14, 1, 1.8, 0.45, 0.85, 4)), width: W, height: H });
    this.dustNear.tileScale.set(0.85);

    // The planet below: a dark world with a lit rim and a ring, leaving as the run climbs.
    const pr = 330;
    const planet = canvas(W * 1.4, 420, (g) => {
      const cx = W * 0.26;
      const cy = pr + 70;
      g.save();
      g.beginPath();
      g.arc(cx, cy, pr, 0, Math.PI * 2);
      g.clip();
      const body = g.createRadialGradient(cx + 90, cy - 140, 20, cx, cy, pr);
      body.addColorStop(0, "#3A2C78");
      body.addColorStop(0.5, "#1B1440");
      body.addColorStop(1, "#0A081E");
      g.fillStyle = body;
      g.fillRect(cx - pr, cy - pr, pr * 2, pr * 2);
      // Cloud bands.
      for (let i = 0; i < 9; i++) {
        g.strokeStyle = rgba(i % 2 ? "#5B48A8" : "#2A5A8A", 0.2);
        g.lineWidth = 6 + (i % 3) * 5;
        g.beginPath();
        g.ellipse(cx, cy - pr * 0.25 + i * 26, pr * 1.1, 26 + i * 3, -0.12, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      }
      g.restore();
      // Atmosphere, then the rim light on the upper edge.
      const atm = g.createRadialGradient(cx, cy, pr - 4, cx, cy, pr + 34);
      atm.addColorStop(0, rgba(PAL.accent, 0.22));
      atm.addColorStop(1, rgba(PAL.accent, 0));
      g.fillStyle = atm;
      g.beginPath();
      g.arc(cx, cy, pr + 34, Math.PI, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(PAL.accent, 0.5);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(cx, cy, pr - 1, Math.PI * 1.08, Math.PI * 1.85);
      g.stroke();
      g.strokeStyle = rgba(PAL.accent, 0.12);
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, pr + 2, Math.PI * 1.1, Math.PI * 1.8);
      g.stroke();
      // The ring, in front.
      g.strokeStyle = rgba("#CFC3FF", 0.22);
      g.lineWidth = 2.2;
      g.beginPath();
      g.ellipse(cx, cy - 40, pr * 1.55, 58, -0.16, Math.PI * 0.96, Math.PI * 2.04);
      g.stroke();
      g.strokeStyle = rgba("#CFC3FF", 0.08);
      g.lineWidth = 9;
      g.beginPath();
      g.ellipse(cx, cy - 44, pr * 1.5, 54, -0.16, Math.PI * 0.96, Math.PI * 2.04);
      g.stroke();
    }, 1.4);
    this.setTex(this.planet, planet, W * 1.4, 420);

    // Drifting rocks between the far dust and the action: dark, rim-lit, slow.
    for (const r of this.rocks) r.destroy();
    this.rocks.length = 0;
    const rockTex: Texture[] = [];
    for (let v = 0; v < 3; v++) {
      rockTex.push(
        Texture.from(
          canvas(40, 40, (g) => {
            let seed = 99 + v * 13;
            const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
            const pts: number[] = [];
            const n = 6 + v;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
              const r = 7 + rnd() * 10;
              pts.push(20 + Math.cos(a) * r * 1.2, 20 + Math.sin(a) * r * 0.7);
            }
            g.beginPath();
            g.moveTo(pts[0]!, pts[1]!);
            for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
            g.closePath();
            g.fillStyle = "#1E1838";
            g.fill();
            g.save();
            g.clip();
            g.fillStyle = "#3A3066";
            g.beginPath();
            g.arc(14, 14, 14, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "#1E1838";
            g.beginPath();
            g.arc(19, 19, 14, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = "#151129";
            g.beginPath();
            g.arc(23, 22, 2.4, 0, Math.PI * 2);
            g.arc(15, 25, 1.6, 0, Math.PI * 2);
            g.fill();
            g.restore();
            g.strokeStyle = rgba(PAL.loom, 0.45);
            g.lineWidth = 0.8;
            g.stroke();
          }, 3),
        ),
      );
    }
    const rockLayer = new Container();
    for (let i = 0; i < 7; i++) {
      const r = new Sprite(rockTex[i % 3]!);
      r.anchor.set(0.5);
      r.scale.set((0.3 + (i % 4) * 0.12) / 3);
      r.alpha = 0.8;
      this.rocks.push(r);
      rockLayer.addChild(r);
    }
    for (const s of this.streaks) s.destroy();
    this.streaks.length = 0;
    const streakLayer = new Container();
    streakLayer.blendMode = "add";
    for (let i = 0; i < 9; i++) {
      const s = new Sprite(this.t.line);
      s.anchor.set(0.5);
      s.tint = i % 3 ? C.paper : C.accentHi;
      this.streaks.push(s);
      streakLayer.addChild(s);
    }

    const vig = canvas(W, H, (g) => {
      const gr = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
      gr.addColorStop(0, "rgba(3,2,8,0)");
      gr.addColorStop(1, "rgba(3,2,8,0.72)");
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    });
    this.setTex(this.vignette, vig, W, H);
    this.tint.width = W;
    this.tint.height = H;
    this.tint.tint = C.bullet;
    this.tint.alpha = 0;

    this.bg.removeChildren();
    this.bg.addChild(this.bgBase, this.nebula, this.dustFar, this.planet, rockLayer, this.dustNear, streakLayer, this.tint, this.vignette);
  }

  private setTex(s: Sprite, c: HTMLCanvasElement, w: number, h: number): void {
    const old = s.texture;
    s.texture = Texture.from(c);
    s.width = w;
    s.height = h;
    if (old && old !== Texture.EMPTY && old !== Texture.WHITE) old.destroy(true);
  }

  // --- per frame -------------------------------------------------------------------------------------------

  draw(sim: Sim, v: View): void {
    this.world.position.set(v.shakeX, v.shakeY);
    this.world.rotation = v.shakeA;
    this.drawBackdrop(sim, v);
    this.drawEnemies(sim, v);
    this.drawPickups(sim, v);
    this.drawShots(sim);
    this.drawCrystals(sim, v);
    this.drawShip(sim, v);
    this.drawBullets(sim);
    this.tickBooms(v.dt);
    this.fx.update(v.dt);
    this.fx.draw();
  }

  private drawBackdrop(sim: Sim, v: View): void {
    const H = this.fieldH;
    const t = v.scroll;
    if (this.nebula) this.nebula.tilePosition.y = t * 7;
    if (this.dustFar) this.dustFar.tilePosition.y = t * 15;
    if (this.dustNear) this.dustNear.tilePosition.y = t * 46;
    this.planet.y = H - 250 + v.planetSink;
    this.planet.x = -40;
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i]!;
      const speed = 18 + (i % 4) * 9;
      const span = H + 120;
      r.position.set((i * 131 + 40) % FIELD_W, ((t * speed + i * 211) % span) - 60);
      r.rotation = t * (0.1 + (i % 3) * 0.07) * (i % 2 ? 1 : -1) + i;
    }
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i]!;
      const speed = 380 + (i % 3) * 140;
      const span = H + 200;
      const y = ((t * speed + i * 263) % span) - 100;
      s.position.set(((i * 97 + 31) % FIELD_W) + Math.sin(i * 3.1) * 8, y);
      s.scale.set(SCALE, SCALE * (2.5 + (i % 3) * 1.2));
      s.alpha = v.reduced ? 0.04 : 0.1;
    }
    this.tint.alpha = 0.05 * v.bossTint;
    void sim;
  }

  private visFor(e: Enemy): Vis {
    let vis = this.vis.get(e.id);
    if (vis) return vis;
    const list = this.free.get(e.kind);
    vis = list?.pop();
    if (!vis) vis = this.makeVis(e.kind);
    vis.id = e.id;
    this.vis.set(e.id, vis);
    this.active.push(vis);
    vis.glow.visible = vis.body.visible = true;
    for (const x of vis.extra) x.visible = true;
    return vis;
  }

  private makeVis(kind: EnemyKind): Vis {
    const t = this.t;
    const glow = new Sprite(t.glowSoft);
    glow.anchor.set(0.5);
    glow.tint = KIND_COLOR[kind];
    this.enemyGlow.addChild(glow);
    const tex: Record<EnemyKind, [Texture, Texture]> = {
      dart: [t.dart, t.dartFlash],
      weaver: [t.weaverBead, t.weaverFlash],
      bloom: [t.bloomCore, t.bloomFlash],
      bastion: [t.bastion, t.bastionFlash],
      skiff: [t.skiff, t.skiffFlash],
      arm: [t.loomArm, t.loomArmFlash],
      core: [t.loomCoreShut, t.loomCoreFlash],
    };
    const extra: Sprite[] = [];
    if (kind === "bloom") {
      for (let i = 0; i < 6; i++) {
        const p = new Sprite(t.bloomPetal);
        p.anchor.set(0.5);
        p.scale.set(SCALE);
        extra.push(p);
        this.enemyLayer.addChild(p);
      }
    }
    const vs = kind === "arm" || kind === "core" ? BOSSV : ENV;
    const body = new Sprite(tex[kind][0]);
    body.anchor.set(0.5);
    body.scale.set(SCALE * vs);
    const flash = new Sprite(tex[kind][1]);
    flash.anchor.set(0.5);
    flash.scale.set(SCALE * vs);
    flash.alpha = 0;
    this.enemyLayer.addChild(body, flash);
    if (kind === "bastion") {
      const eye = new Sprite(t.bastionEye);
      eye.anchor.set(0.5);
      eye.scale.set(SCALE);
      eye.blendMode = "add";
      extra.push(eye);
      this.enemyLayer.addChild(eye);
    }
    return { kind, glow, body, flash, extra, stamp: 0, id: 0 };
  }

  private drawEnemies(sim: Sim, v: View): void {
    const stamp = ++this.stamp;
    const time = v.time;
    for (let i = 0; i < sim.enemies.length; i++) {
      const e = sim.enemies[i]!;
      if (e.t < 0 || e.hp <= 0) continue;
      if (e.path === "boss" && sim.boss.phase === "off") continue;
      const vis = this.visFor(e);
      vis.stamp = stamp;
      const x = e.x;
      const y = e.y;
      // Big targets take a steady stream of hits: a softer flash, so they never turn into a white disc.
      const fl = e.flash > 0 ? Math.min(1, e.flash / 0.07) : 0;
      const big = e.kind === "core" || e.kind === "arm" || e.kind === "bastion";
      vis.flash.alpha = fl * (big ? 0.28 : 0.85);
      vis.body.position.set(x, y);
      vis.flash.position.set(x, y);
      vis.glow.position.set(x, y);
      let rot = 0;
      let glowSize = e.r * 3.4;
      let glowA = 0.32;
      switch (e.kind) {
        case "dart":
          rot = -e.heading;
          break;
        case "weaver":
          if (e.p6 === 1) {
            if (vis.body.texture !== this.t.weaverHead) vis.body.texture = this.t.weaverHead;
            rot = -e.heading;
          } else {
            if (vis.body.texture !== this.t.weaverBead) vis.body.texture = this.t.weaverBead;
            rot = time * 2 + e.id;
          }
          break;
        case "bloom": {
          // Petals open just before a ring: the tell.
          const toFire = e.fireAt - e.t;
          const firing = e.t > 1.6 && e.t < e.p4 + 0.2;
          const open = firing ? Math.max(0, 1 - Math.max(0, toFire) / 0.5) : 0;
          const after = firing ? Math.max(0, 1 - (e.t - (e.fireAt - e.fireEvery)) / 0.35) : 0;
          const spread = (10.5 + 6 * Math.max(open, after) + Math.sin(time * 2.4 + e.id) * 0.8) * ENV;
          const spin = time * 0.6 + e.id;
          for (let k = 0; k < 6; k++) {
            const p = vis.extra[k]!;
            const a = spin + (k * Math.PI) / 3;
            p.position.set(x + Math.sin(a) * spread, y - Math.cos(a) * spread);
            p.rotation = a;
            p.scale.set(SCALE * ENV * (0.95 + 0.15 * open));
          }
          glowA = 0.28 + 0.3 * open;
          glowSize = 64 + 22 * open;
          break;
        }
        case "bastion": {
          const toFire = e.fireAt - e.t;
          const charge = e.t > 2 ? Math.max(0, 1 - Math.max(0, toFire) / 0.55) : 0;
          const eye = vis.extra[0]!;
          eye.position.set(x, y + 3);
          eye.alpha = 0.35 + 0.65 * charge;
          eye.scale.set(SCALE * ENV * (0.8 + 0.5 * charge), SCALE * ENV * (0.7 + 0.9 * charge));
          glowA = 0.24 + 0.2 * charge;
          glowSize = 110;
          break;
        }
        case "skiff":
          vis.body.scale.x = e.p2 < 0 ? -SCALE * ENV : SCALE * ENV;
          vis.flash.scale.x = vis.body.scale.x;
          glowA = 0.2;
          break;
        case "arm":
          rot = -e.heading;
          glowA = 0.3;
          break;
        case "core": {
          const open = sim.boss.phase === "core" || sim.boss.phase === "dying";
          const tex = open ? this.t.loomCoreOpen : this.t.loomCoreShut;
          if (vis.body.texture !== tex) vis.body.texture = tex;
          rot = sim.boss.rot * -0.25;
          glowA = open ? 0.5 : 0.3;
          glowSize = 150;
          break;
        }
      }
      vis.body.rotation = rot;
      vis.flash.rotation = rot;
      vis.glow.scale.set((SCALE * glowSize) / 64);
      vis.glow.alpha = glowA;
    }
    // Release visuals of enemies that are gone.
    let i = 0;
    while (i < this.active.length) {
      const vis = this.active[i]!;
      if (vis.stamp === stamp) {
        i++;
        continue;
      }
      vis.glow.visible = vis.body.visible = false;
      vis.flash.alpha = 0;
      for (const x of vis.extra) x.visible = false;
      this.vis.delete(vis.id);
      let list = this.free.get(vis.kind);
      if (!list) this.free.set(vis.kind, (list = []));
      list.push(vis);
      const last = this.active.length - 1;
      this.active[i] = this.active[last]!;
      this.active.pop();
    }
    this.drawThreads(sim);
    // The Loom's wheel and glow.
    const b = sim.boss;
    const on = b.phase !== "off";
    this.bossWheel.visible = on;
    this.bossGlow.visible = on;
    if (on) {
      this.bossWheel.position.set(b.x, b.y);
      this.bossWheel.rotation = -b.rot;
      this.bossWheel.scale.set(SCALE, SCALE * 0.86);
      this.bossWheel.alpha = b.phase === "dying" ? Math.max(0, 1 - b.dyingT / 2.2) : 1;
      this.bossGlow.position.set(b.x, b.y);
      this.bossGlow.scale.set((SCALE * 300) / 64);
      this.bossGlow.alpha = 0.22;
    }
  }

  /** Weaver beads are strung on a thread of light, segment to segment. */
  private drawThreads(sim: Sim): void {
    let n = 0;
    for (let i = 0; i < sim.enemies.length; i++) {
      const a = sim.enemies[i]!;
      if (a.kind !== "weaver" || a.t < 0 || a.hp <= 0) continue;
      // Find the next bead of the same chain (spawned right after: the id is one higher).
      for (let j = 0; j < sim.enemies.length; j++) {
        const b = sim.enemies[j]!;
        if (b.id !== a.id + 1 || b.formation !== a.formation || b.t < 0 || b.hp <= 0) continue;
        let s = this.threadSprites[n];
        if (!s) {
          s = new Sprite(this.t.line);
          s.anchor.set(0.5);
          s.tint = C.weaver;
          this.threadSprites.push(s);
          this.threads.addChild(s);
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        s.visible = len < 60;
        s.position.set((a.x + b.x) / 2, (a.y + b.y) / 2);
        s.rotation = Math.atan2(-dx, dy);
        s.scale.set(SCALE * 1.4, SCALE * (len / 32) * 1.15);
        s.alpha = 0.55;
        n++;
        break;
      }
    }
    for (let i = n; i < this.threadSprites.length; i++) this.threadSprites[i]!.visible = false;
  }

  private drawPickups(sim: Sim, v: View): void {
    let i = 0;
    for (; i < sim.pickups.length; i++) {
      const p = sim.pickups[i]!;
      let ps = this.pickupSprites[i];
      if (!ps) {
        ps = { glow: new Sprite(this.t.glow), ring: new Sprite(this.t.pickupRing), body: new Sprite(this.t.pickups.power) };
        ps.glow.anchor.set(0.5);
        ps.ring.anchor.set(0.5);
        ps.ring.scale.set(SCALE);
        ps.body.anchor.set(0.5);
        ps.body.scale.set(SCALE);
        this.pickupSprites.push(ps);
        this.pickupGlow.addChild(ps.glow);
        this.pickupLayer.addChild(ps.ring, ps.body);
      }
      const col = PICKUP_COLOR[p.kind];
      const tex = this.t.pickups[p.kind];
      if (ps.body.texture !== tex) ps.body.texture = tex;
      const pop = Math.min(1, p.t / 0.25);
      const bob = Math.sin(p.t * 3.2) * 1.5;
      // A lost gun level blinks gently (a slow pulse, well under 2 Hz) until it is caught or gone.
      const fade = p.recover ? 0.65 + 0.35 * Math.cos(p.t * Math.PI * 2 * 1.5) : 1;
      ps.body.visible = ps.ring.visible = ps.glow.visible = true;
      ps.body.position.set(p.x, p.y + bob);
      ps.body.scale.set(SCALE * (0.4 + 0.6 * pop));
      ps.body.alpha = fade;
      ps.ring.position.set(p.x, p.y + bob);
      ps.ring.rotation = v.time * 1.4;
      ps.ring.tint = col;
      ps.ring.alpha = 0.75 * fade;
      ps.glow.position.set(p.x, p.y + bob);
      ps.glow.tint = col;
      ps.glow.scale.set(SCALE * (0.9 + 0.08 * Math.sin(v.time * 4)));
      ps.glow.alpha = 0.32 * fade;
    }
    for (; i < this.pickupSprites.length; i++) {
      const ps = this.pickupSprites[i]!;
      ps.body.visible = ps.ring.visible = ps.glow.visible = false;
    }
  }

  private drawShots(sim: Sim): void {
    let i = 0;
    for (; i < sim.shots.length; i++) {
      const sh = sim.shots[i]!;
      let s = this.shotSprites[i];
      if (!s) {
        s = new Sprite(this.t.shot);
        s.anchor.set(0.5);
        this.shotSprites.push(s);
        this.shotLayer.addChild(s);
      }
      const heavy = sh.kind === 0 && sh.dmg >= 1.4;
      const tex = sh.kind === 1 ? this.t.dartShot : heavy ? this.t.shotHeavy : this.t.shot;
      if (s.texture !== tex) s.texture = tex;
      s.visible = true;
      s.position.set(sh.x, sh.y);
      s.rotation = Math.atan2(sh.vx, -sh.vy);
      // Longer bolts at higher levels; the angled streams stay dimmer and thinner so the player's fire never
      // competes with the enemy's bullets.
      const lv = sh.level;
      if (sh.main) {
        s.scale.set(SCALE * (0.9 + 0.05 * lv), SCALE * (0.85 + 0.08 * lv));
        s.alpha = 0.78 + 0.04 * lv;
      } else {
        s.scale.set(SCALE * 0.75, SCALE * (0.8 + 0.05 * lv));
        s.alpha = sh.kind === 1 ? 0.9 : 0.42;
      }
      s.tint = sh.kind === 1 ? C.paper : C.white;
    }
    for (; i < this.shotSprites.length; i++) {
      const s = this.shotSprites[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
  }

  private drawCrystals(sim: Sim, v: View): void {
    let i = 0;
    for (; i < sim.crystals.length; i++) {
      const c = sim.crystals[i]!;
      let s = this.crystalSprites[i];
      if (!s) {
        s = new Sprite(this.t.crystal);
        s.anchor.set(0.5);
        this.crystalSprites.push(s);
        this.crystalLayer.addChild(s);
      }
      s.visible = c.t >= 0;
      s.position.set(c.x, c.y);
      const flip = Math.cos(v.time * 7 + i * 1.7);
      const big = c.big ? 1.35 : 1;
      s.scale.set(SCALE * big * (0.35 + 0.65 * Math.abs(flip)), SCALE * big);
      s.alpha = 0.95;
    }
    for (; i < this.crystalSprites.length; i++) {
      const s = this.crystalSprites[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
  }

  private drawShip(sim: Sim, v: View): void {
    const s = sim.ship;
    const alive = s.alive;
    this.ship.visible = alive;
    this.shipGlow.visible = alive;
    this.hitbox.visible = alive;
    this.hitboxGlow.visible = alive;
    for (const f of this.flames) f.visible = alive;
    if (s.level !== this.shipLevel) {
      this.shipLevel = s.level;
      this.ship.texture = this.t.ships[s.level - 1]!;
    }
    const bank = v.bank;
    this.ship.position.set(s.x, s.y);
    this.ship.scale.set(SCALE * SHIPV * (1 - 0.2 * Math.abs(bank)), SCALE * SHIPV);
    this.ship.rotation = bank * 0.1;
    this.shipGlow.position.set(s.x, s.y + 4);
    this.shipGlow.scale.set(SCALE * (0.9 + 0.1 * s.level));
    this.shipGlow.alpha = 0.16 + 0.03 * s.level;
    const flick = 0.85 + 0.15 * Math.sin(v.time * 37) * Math.sin(v.time * 23);
    for (let i = 0; i < 2; i++) {
      const f = this.flames[i]!;
      const side = i === 0 ? -1 : 1;
      f.position.set(s.x + side * 3.4 * (1 - 0.2 * Math.abs(bank)), s.y + 15.5);
      f.scale.set(SCALE * 1.05, SCALE * (1.05 + 0.45 * flick));
      f.alpha = 0.9;
    }
    // Invulnerability: a shield bubble that fades out over the last half second.
    const inv = s.invuln > 0 && alive;
    this.bubble.visible = inv;
    if (inv) {
      this.bubble.position.set(s.x, s.y);
      this.bubble.alpha = Math.min(1, s.invuln / 0.5) * 0.85;
      this.bubble.rotation = v.time;
    }
    // The hitbox, always on top; it brightens when something is close.
    let near = 0;
    for (let i = 0; i < sim.bullets.length; i++) {
      const b = sim.bullets[i]!;
      const dx = b.x - s.x;
      const dy = b.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 3600) near = Math.max(near, 1 - Math.sqrt(d2) / 60);
    }
    this.hitbox.position.set(s.x, s.y);
    this.hitbox.scale.set(SCALE * (1 + 0.25 * near));
    this.hitboxGlow.position.set(s.x, s.y);
    this.hitboxGlow.scale.set(SCALE * (0.22 + 0.25 * near));
    this.hitboxGlow.alpha = 0.25 + 0.45 * near;
    for (let i = 0; i < 2; i++) {
      const d = sim.drones[i]!;
      const on = alive && i < s.drones;
      this.drones[i]!.visible = on;
      this.droneGlows[i]!.visible = on;
      if (!on) continue;
      this.drones[i]!.position.set(d.x, d.y);
      this.drones[i]!.rotation = Math.sin(d.t * 2 + i) * 0.2;
      this.droneGlows[i]!.position.set(d.x, d.y);
      this.droneGlows[i]!.scale.set(SCALE * 0.5);
      this.droneGlows[i]!.alpha = 0.3;
    }
  }

  private drawBullets(sim: Sim): void {
    let i = 0;
    for (; i < sim.bullets.length; i++) {
      const b = sim.bullets[i]!;
      let s = this.bulletSprites[i];
      if (!s) {
        s = new Sprite(this.t.bulletS);
        s.anchor.set(0.5);
        s.scale.set(SCALE);
        this.bulletSprites.push(s);
        this.bulletLayer.addChild(s);
      }
      const tex = b.big ? this.t.bulletL : this.t.bulletS;
      if (s.texture !== tex) s.texture = tex;
      s.visible = true;
      s.position.set(b.x, b.y);
      // Fresh bullets pop in from a dot, so a ring reads as fired, not as appearing.
      const k = b.t < 0.08 ? 0.45 + (b.t / 0.08) * 0.55 : 1;
      s.scale.set(SCALE * k);
    }
    for (; i < this.bulletSprites.length; i++) {
      const s = this.bulletSprites[i]!;
      if (!s.visible) break;
      s.visible = false;
    }
  }

  /** Creates the sprites a busy frame needs, so pools never grow during play. */
  prewarm(): void {
    const grow = (arr: Sprite[], layer: Container, n: number, tex: Texture) => {
      while (arr.length < n) {
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.scale.set(SCALE);
        s.visible = false;
        arr.push(s);
        layer.addChild(s);
      }
    };
    grow(this.bulletSprites, this.bulletLayer, 420, this.t.bulletS);
    grow(this.shotSprites, this.shotLayer, 160, this.t.shot);
    grow(this.crystalSprites, this.crystalLayer, 200, this.t.crystal);
    this.fx.light.prewarm(700, this.t.spark);
    this.fx.matter.prewarm(260, this.t.shard);
    for (const k of ["dart", "dart", "dart", "dart", "dart", "dart", "weaver", "weaver", "weaver", "bloom", "bloom", "bastion", "skiff", "arm", "core"] as const) {
      let list = this.free.get(k);
      if (!list) this.free.set(k, (list = []));
      const vis = this.makeVis(k);
      vis.glow.visible = vis.body.visible = false;
      for (const x of vis.extra) x.visible = false;
      list.push(vis);
    }
  }

  // --- effect recipes ------------------------------------------------------------------------------------

  /** Secondary blasts scheduled after a big kill (a fixed ring of slots, no allocation). */
  private readonly booms = Array.from({ length: 24 }, () => ({ t: -1, x: 0, y: 0, kind: "dart" as EnemyKind, size: 1, reduced: false }));

  private schedule(delay: number, kind: EnemyKind, x: number, y: number, size: number, reduced: boolean): void {
    let slot = this.booms[0]!;
    for (const b of this.booms) {
      if (b.t < 0) {
        slot = b;
        break;
      }
    }
    slot.t = delay;
    slot.x = x;
    slot.y = y;
    slot.kind = kind;
    slot.size = size;
    slot.reduced = reduced;
  }

  /** Runs the scheduled secondary blasts. */
  private tickBooms(dt: number): void {
    for (const b of this.booms) {
      if (b.t < 0) continue;
      b.t -= dt;
      if (b.t < 0) this.burst(b.kind, b.x, b.y, b.size, b.reduced);
    }
  }

  /** An enemy blows up. `size` 1 = dart, ~2 bloom, ~3 bastion, ~4 Loom parts. Big ones keep going off for a moment. */
  explode(kind: EnemyKind, x: number, y: number, size: number, reduced: boolean): void {
    this.burst(kind, x, y, size, reduced);
    if (size >= 2.5) {
      const n = Math.round(size);
      for (let i = 0; i < n; i++) {
        const a = this.fx.r() * Math.PI * 2;
        const r = 10 + this.fx.r() * 12 * size;
        this.schedule(0.07 + i * 0.09, kind, x + Math.cos(a) * r, y + Math.sin(a) * r, 0.9 + this.fx.r() * 0.5, reduced);
      }
    }
  }

  private burst(kind: EnemyKind, x: number, y: number, size: number, reduced: boolean): void {
    const fx = this.fx;
    const t = this.t;
    const col = KIND_COLOR[kind];
    const hot = mixNum(col, C.white, 0.55);
    const n = Math.round(8 + size * 7);
    // A small bright core, then a dim wide glow (dim so big kills never flash a large area).
    fx.put(true, FX_GLOW, t.glow, x, y, 0, 0, 0.2 + 0.04 * size, G * 12, G * (26 + 12 * size), 0.95, C.white, 0, 0, 0, 0.02);
    fx.put(true, FX_GLOW, t.glowSoft, x, y, 0, 0, 0.45 + 0.1 * size, G * 26 * size, G * (60 + 46 * size), Math.min(0.5, 0.8 / size), col, 0, 0, 0, 0.05);
    fx.put(true, FX_RING, t.ring, x, y, 0, 0, 0.32 + 0.08 * size, R * 4, R * (16 + 18 * size), 0.75, hot);
    for (let i = 0; i < n; i++) {
      const a = fx.r() * Math.PI * 2;
      const sp = fx.range(120, 260 + 90 * size);
      fx.put(true, FX_SPARK, t.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(0.22, 0.42 + 0.08 * size), SCALE * fx.range(0.45, 0.75), 0, 1, i % 3 ? hot : C.white, 3.2);
    }
    const shards = Math.round(4 + size * 4);
    for (let i = 0; i < shards; i++) {
      const a = fx.r() * Math.PI * 2;
      const sp = fx.range(50, 150 + 50 * size);
      fx.put(false, FX_SHARD, t.shard, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(0.5, 0.9 + 0.1 * size), SCALE * fx.range(0.7, 1.15), SCALE * 0.3, 1, col, 1.6, 60, fx.range(-9, 9));
    }
    if (!reduced || size > 1.5) {
      const puffs = Math.round(1 + size);
      for (let i = 0; i < puffs; i++) {
        const a = fx.r() * Math.PI * 2;
        fx.put(false, FX_PUFF, t.puff, x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * 26, Math.sin(a) * 26 - 10, fx.range(0.6, 0.9 + 0.15 * size), P * (10 + 5 * size), P * (28 + 14 * size), 0.42, size > 2 ? C.smokeWarm : C.smoke, 1.5, 0, fx.range(-1, 1), 0.08);
      }
    }
  }

  hitSpark(x: number, y: number, color: number): void {
    const fx = this.fx;
    for (let i = 0; i < 2; i++) {
      const a = -Math.PI / 2 + fx.range(-1.2, 1.2);
      const sp = fx.range(90, 200);
      fx.put(true, FX_SPARK, this.t.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(0.1, 0.2), SCALE * 0.4, 0, 0.9, i ? color : C.white, 4);
    }
  }

  /** A bullet skimmed past: white sparks thrown off the side away from the ship. */
  graze(x: number, y: number, sx: number, sy: number, run: number): void {
    const fx = this.fx;
    const base = Math.atan2(y - sy, x - sx);
    const n = 3 + Math.min(3, run >> 2);
    for (let i = 0; i < n; i++) {
      const a = base + fx.range(-0.7, 0.7);
      const sp = fx.range(160, 320);
      fx.put(true, FX_SPARK, this.t.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(0.14, 0.26), SCALE * 0.45, 0, 1, i % 2 ? C.white : C.accentHi, 5);
    }
    fx.put(true, FX_GLOW, this.t.glow, x, y, 0, 0, 0.16, G * 6, G * 18, 0.75, C.white);
  }

  /** A bullet removed by a hit or a nova (as a crystal when `crystal`). */
  cancel(x: number, y: number, crystal: boolean): void {
    this.fx.put(true, FX_GLOW, this.t.glow, x, y, 0, 0, 0.25, G * 8, G * 18, crystal ? 0.5 : 0.6, crystal ? C.crystal : C.bulletHi);
    this.fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.25, R * 2, R * 9, 0.5, crystal ? C.crystal : C.bullet);
  }

  crystalPop(x: number, y: number): void {
    this.fx.put(true, FX_DOT, this.t.dot, x, y, 0, -20, 0.18, (SCALE * 7) / 8, (SCALE * 2) / 8, 0.8, C.crystal);
  }

  pickupBurst(x: number, y: number, color: number): void {
    const fx = this.fx;
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.45, R * 6, R * 44, 0.85, color);
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.6, R * 3, R * 28, 0.5, C.white);
    fx.put(true, FX_GLOW, this.t.glowSoft, x, y, 0, 0, 0.4, G * 26, G * 90, 0.4, color, 0, 0, 0, 0.04);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      fx.put(true, FX_SPARK, this.t.spark, x, y, Math.cos(a) * 240, Math.sin(a) * 240, 0.32, SCALE * 0.6, 0, 1, i % 2 ? color : C.white, 3);
    }
  }

  /** The gun steps up: a column of light rises off the ship. */
  levelUp(x: number, y: number, level: number): void {
    const fx = this.fx;
    for (let i = 0; i < 6 + level * 2; i++) {
      const ox = fx.range(-16, 16);
      fx.put(true, FX_SPARK, this.t.spark, x + ox, y + fx.range(-4, 10), 0, -fx.range(260, 520), fx.range(0.3, 0.5), SCALE * 0.6, 0, 1, i % 2 ? C.accent : C.white, 1.5);
    }
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.5, R * 10, R * (42 + level * 6), 0.9, C.accent);
  }

  shipHit(x: number, y: number): void {
    const fx = this.fx;
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.55, R * 8, R * 120, 0.8, C.accent);
    fx.put(true, FX_GLOW, this.t.glowSoft, x, y, 0, 0, 0.5, G * 30, G * 140, 0.4, C.white, 0, 0, 0, 0.03);
    for (let i = 0; i < 18; i++) {
      const a = fx.r() * Math.PI * 2;
      const sp = fx.range(140, 380);
      fx.put(true, FX_SPARK, this.t.spark, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(0.25, 0.5), SCALE * 0.6, 0, 1, i % 2 ? C.accent : C.white, 2.5);
    }
  }

  shipDeath(x: number, y: number): void {
    this.burst("dart", x, y, 3.2, false);
    const fx = this.fx;
    for (let i = 0; i < 12; i++) {
      const a = fx.r() * Math.PI * 2;
      const sp = fx.range(60, 200);
      fx.put(false, FX_SHARD, this.t.shard, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(0.8, 1.4), SCALE * fx.range(1, 1.6), SCALE * 0.4, 1, C.paper, 1.2, 40, fx.range(-8, 8));
    }
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.8, R * 10, R * 160, 0.7, C.accent);
  }

  nova(x: number, y: number): void {
    const fx = this.fx;
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.75, R * 6, R * 640, 0.9, C.bloom);
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 0.9, R * 3, R * 560, 0.5, C.white);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      fx.put(true, FX_SPARK, this.t.spark, x, y, Math.cos(a) * 520, Math.sin(a) * 520, 0.6, SCALE * 0.8, 0, 1, i % 2 ? C.bloom : C.white, 1);
    }
  }

  bossBoom(x: number, y: number, k: number, reduced: boolean): void {
    this.explode(k > 0.5 ? "core" : "arm", x, y, 1.6 + k * 1.2, reduced);
  }

  bossFinale(x: number, y: number, reduced: boolean): void {
    this.burst("core", x, y, 5, reduced);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.schedule(0.12 + i * 0.11, i % 2 ? "arm" : "core", x + Math.sin(a) * 60, y + Math.cos(a) * 50, 2, reduced);
    }
    const fx = this.fx;
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 1.1, R * 12, R * 420, 0.9, C.loomGold);
    fx.put(true, FX_RING, this.t.ring, x, y, 0, 0, 1.4, R * 8, R * 300, 0.6, C.bullet);
    for (let i = 0; i < 40; i++) {
      const a = fx.r() * Math.PI * 2;
      const sp = fx.range(100, 420);
      fx.put(false, FX_SHARD, this.t.shard, x, y, Math.cos(a) * sp, Math.sin(a) * sp, fx.range(1, 1.8), SCALE * fx.range(1, 1.8), SCALE * 0.5, 1, i % 3 ? C.loom : C.loomGold, 1, 50, fx.range(-6, 6));
    }
  }

  /** Hides everything that belongs to a run (used when a new run or the demo starts). */
  reset(): void {
    for (const b of this.booms) b.t = -1;
    this.fx.clear();
  }
}

function mixNum(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** A canvas of w×h field units at `res` texels per unit; draw() works in field units. */
function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, res = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * res);
  c.height = Math.ceil(h * res);
  const g = c.getContext("2d")!;
  g.scale(res, res);
  draw(g);
  return c;
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(color, a));
  gr.addColorStop(0.6, rgba(color, a * 0.35));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

