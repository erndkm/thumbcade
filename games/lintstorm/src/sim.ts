/**
 * Lintstorm's world, pure and time-stepped (no DOM, no clock, no Math.random), so the game, the attract demo, the
 * headless pilots and the tests all run the same rules.
 *
 * The dryer burst: a steam iron flies up through a sky full of laundry. The thumb drags the iron (relative, so it
 * never covers it), the iron fires steam on its own. Socks hang in on clotheslines, lint fluff drifts down in V's,
 * tees swoop in on their sleeves and dive, mittens snake down in a column, sweaters park and spray buttons of
 * static. Every ~20 s a boss rolls in: the Lint King, the Spin Cycle, the Hamper. Kills drop loose change and
 * buttons; kills and pickups in quick succession build a combo whose tiers multiply everything. Boxes hold short
 * power-ups (triple steam, turbo, softener shield, static cling). Three hearts, a breather after every hit.
 *
 * Coordinates are logical px: the field is `w` wide (390 on a phone) and `h` tall, y grows downward, `top` is the
 * status-bar inset the HUD sits under.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export type EnemyKind = "sock" | "fluff" | "tee" | "mitten" | "sweater" | "minisock";
export type BossKind = "king" | "spin" | "hamper";
export type PowerKind = "spread" | "rapid" | "shield" | "magnet";
export type PickupKind = "coin" | "button" | "heart" | PowerKind;
export type WaveKind = "line" | "vee" | "swoop" | "snake" | "tank" | "drift";
export type HurtBy = "spark" | "body" | "boss";

/** No enemy fires before this many seconds into a run. */
export const FIRE_FROM = 8;
/** When the first boss is due, and the pause after a boss before the next one is due. */
export const FIRST_BOSS = 21;
export const BOSS_GAP = 19;
/** A boss that isn't beaten in this long gets bored and leaves (no reward). */
export const BOSS_PATIENCE = 30;
/** Seconds a combo survives without a kill or a pickup. */
export const COMBO_WINDOW = 2.2;
/** Combo counts at which the multiplier steps up: ×1 … ×8. */
export const TIERS = [0, 10, 25, 45, 70, 100, 140, 190];
export const POWER_TIME: Record<PowerKind, number> = { spread: 9, rapid: 8, shield: 12, magnet: 10 };
export const HEARTS = 3;
/** The iron's hitbox: much smaller than the sprite, so grazes are forgiven. */
export const HERO_R = 8;
/** Invulnerable seconds after losing a heart (and after the shield pops). */
export const INV_TIME = 1.8;
export const SHIELD_INV = 1.0;
/** Pickup reach (plus a bit more under static cling). */
export const REACH = 30;
const FIRE_GAP = 1 / 9;
const RAPID_GAP = 1 / 16;
const SHOT_SPEED = 950;
const SUBSTEP = 1 / 120;

export interface KindStats {
  hp: number;
  r: number;
  pts: number;
  coins: number;
}
export const KINDS: Record<EnemyKind, KindStats> = {
  sock: { hp: 4, r: 17, pts: 100, coins: 2 },
  fluff: { hp: 2, r: 14, pts: 50, coins: 1 },
  tee: { hp: 4, r: 20, pts: 150, coins: 2 },
  mitten: { hp: 3, r: 16, pts: 80, coins: 1 },
  sweater: { hp: 26, r: 32, pts: 500, coins: 8 },
  minisock: { hp: 2, r: 13, pts: 40, coins: 1 },
};

export const multFor = (combo: number): number => {
  let m = 1;
  for (let i = 1; i < TIERS.length; i++) if (combo >= TIERS[i]!) m = i + 1;
  return m;
};

export interface Hero {
  x: number;
  y: number;
  /** Smoothed velocity (for tilt and the pilots). */
  vx: number;
  vy: number;
  hearts: number;
  inv: number;
  alive: boolean;
  fireT: number;
  power: Record<PowerKind, number>;
}

export interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}

/** An enemy bullet: a spark of static. */
export interface Spark {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  alive: boolean;
}

type Move =
  | { k: "hang"; slot: number }
  | { k: "fall"; vy: number; amp: number; freq: number; x0: number; phase: number }
  | { k: "arc"; p: [number, number, number, number, number, number]; dur: number; dive: boolean; diving: boolean }
  | { k: "snake"; cx: number; amp: number; freq: number; vy: number; delay: number }
  | { k: "park"; stopY: number; stay: number; vx: number }
  | { k: "hop"; g: number };

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  max: number;
  r: number;
  t: number;
  alive: boolean;
  group: number;
  fireT: number;
  /** Seconds since the last hit (for the wobble). */
  hitT: number;
  /** -1 / 1: which way it faces (for art). */
  face: number;
  move: Move;
}

export interface Boss {
  kind: BossKind;
  i: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  max: number;
  t: number;
  phase: "enter" | "fight" | "leave";
  angry: boolean;
  patT: number;
  patT2: number;
  angle: number;
  spin: number;
  hitT: number;
  /** 0..1 how open the hamper lid / the drum door is (art). */
  mouth: number;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  alive: boolean;
  pulled: boolean;
}

export interface Group {
  id: number;
  kind: WaveKind;
  size: number;
  killed: number;
  escaped: number;
  t: number;
  /** Clothesline: anchor height and sway; others: the last kill (where the bonus drops). */
  y: number;
  stopY: number;
  stay: number;
  sway: number;
  x0: number;
  x1: number;
  lastX: number;
  lastY: number;
  done: boolean;
  /** The line snapped (every sock pressed) or let go (it left). */
  rope: "up" | "snap" | "gone";
}

export type SimEvent =
  | { k: "fire"; x: number; y: number; n: number }
  | { k: "hit"; kind: EnemyKind; x: number; y: number }
  | { k: "kill"; kind: EnemyKind; x: number; y: number; pts: number; mult: number; combo: number }
  | { k: "clear"; kind: WaveKind; x: number; y: number; bonus: number; size: number }
  | { k: "pickup"; kind: "coin" | "button"; x: number; y: number; pts: number; combo: number; mult: number }
  | { k: "power"; kind: PowerKind; x: number; y: number; refresh: boolean }
  | { k: "powerEnd"; kind: PowerKind }
  | { k: "heart"; x: number; y: number; hearts: number }
  | { k: "tier"; mult: number }
  | { k: "drop"; mult: number; combo: number }
  | { k: "hurt"; x: number; y: number; hearts: number; by: HurtBy; lost: number }
  | { k: "shield"; x: number; y: number }
  | { k: "spark"; x: number; y: number; n: number }
  | { k: "wave"; kind: WaveKind }
  | { k: "bossIn"; kind: BossKind; i: number }
  | { k: "bossAngry"; kind: BossKind }
  | { k: "bossHit"; x: number; y: number }
  | { k: "bossBreak"; kind: BossKind; x: number; y: number; pts: number; i: number }
  | { k: "bossLeave"; kind: BossKind }
  | { k: "over"; x: number; y: number };

export interface Stats {
  kills: number;
  coins: number;
  buttons: number;
  powerups: number;
  bosses: number;
  clears: number;
  maxCombo: number;
  maxMult: number;
  hurt: Record<HurtBy, number>;
  /** Px the iron travelled (a parked iron gets a "keep moving" tip). */
  travelled: number;
  shots: number;
  hits: number;
  firstHurt: number;
}

export interface SimOptions {
  seed: number;
  w?: number;
  h?: number;
  top?: number;
  /** Attract mode: the iron can't go down, difficulty stays early-game. */
  demo?: boolean;
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Sim {
  w: number;
  h: number;
  top: number;
  readonly demo: boolean;
  readonly rng: Rng;
  t = 0;
  score = 0;
  combo = 0;
  comboT = 0;
  mult = 1;
  over = false;
  hero: Hero;
  shots: Shot[] = [];
  sparks: Spark[] = [];
  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  groups: Group[] = [];
  boss: Boss | null = null;
  bossCount = 0;
  events: SimEvent[] = [];
  stats: Stats = {
    kills: 0,
    coins: 0,
    buttons: 0,
    powerups: 0,
    bosses: 0,
    clears: 0,
    maxCombo: 0,
    maxMult: 1,
    hurt: { spark: 0, body: 0, boss: 0 },
    travelled: 0,
    shots: 0,
    hits: 0,
    firstHurt: -1,
  };
  private nextId = 1;
  private nextWaveAt = 0.6;
  private nextBossAt = FIRST_BOSS;
  private lastWave: WaveKind | null = null;
  private waves = 0;
  private px: number;
  private py: number;

  constructor(o: SimOptions) {
    this.w = o.w ?? 390;
    this.h = o.h ?? 754;
    this.top = o.top ?? 47;
    this.demo = !!o.demo;
    this.rng = createRng(o.seed);
    this.hero = {
      x: this.w / 2,
      y: this.h * 0.8,
      vx: 0,
      vy: 0,
      hearts: HEARTS,
      inv: 0,
      alive: true,
      fireT: 0.25,
      power: { spread: 0, rapid: 0, shield: 0, magnet: 0 },
    };
    this.px = this.hero.x;
    this.py = this.hero.y;
  }

  /** Difficulty: 0 at the first tap, 1 at 70 s, then faster (2 at 100 s). Attract mode stays early. */
  get d(): number {
    const t = this.t;
    return Math.min(this.demo ? 0.3 : 2.4, t < 70 ? t / 70 : 1 + (t - 70) / 30);
  }

  /** The highest y the iron may climb to (it stays out of the HUD and under the bosses). */
  get ceiling(): number {
    return Math.max(this.top + 150, this.h * 0.42);
  }

  /** A new field size (rotation, a resized window): the iron stays inside. */
  resize(w: number, h: number, top: number): void {
    this.w = w;
    this.h = h;
    this.top = top;
    this.moveBy(0, 0);
  }

  /** Moves the iron by a thumb's motion (relative drag). */
  moveBy(dx: number, dy: number): void {
    const h = this.hero;
    if (!h.alive) return;
    h.x = clamp(h.x + dx, 20, this.w - 20);
    h.y = clamp(h.y + dy, this.ceiling, this.h - 34);
  }

  step(dt: number): void {
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.tick(h);
  }

  // -----------------------------------------------------------------------------------------------------------
  // One substep
  // -----------------------------------------------------------------------------------------------------------
  private tick(dt: number): void {
    this.t += dt;
    const hero = this.hero;
    // Velocity from what the thumb did since the last substep.
    const ivx = (hero.x - this.px) / dt;
    const ivy = (hero.y - this.py) / dt;
    this.stats.travelled += Math.hypot(hero.x - this.px, hero.y - this.py);
    const k = 1 - Math.exp(-14 * dt);
    hero.vx += (ivx - hero.vx) * k;
    hero.vy += (ivy - hero.vy) * k;
    this.px = hero.x;
    this.py = hero.y;

    if (hero.alive) {
      hero.inv = Math.max(0, hero.inv - dt);
      for (const p of ["spread", "rapid", "magnet", "shield"] as const) {
        if (hero.power[p] <= 0) continue;
        hero.power[p] = Math.max(0, hero.power[p] - dt);
        if (hero.power[p] === 0) this.events.push({ k: "powerEnd", kind: p });
      }
      this.fire(dt);
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        if (this.mult > 1) this.events.push({ k: "drop", mult: this.mult, combo: this.combo });
        this.combo = 0;
        this.mult = 1;
      }
    }

    this.director();
    this.moveShots(dt);
    this.moveEnemies(dt);
    if (this.boss) this.stepBoss(dt);
    this.moveSparks(dt);
    this.movePickups(dt);
    this.collide();
    this.sweep();
  }

  private fire(dt: number): void {
    const hero = this.hero;
    hero.fireT -= dt;
    if (hero.fireT > 0) return;
    hero.fireT += hero.power.rapid > 0 ? RAPID_GAP : FIRE_GAP;
    const x = hero.x;
    const y = hero.y - 22;
    const angles = hero.power.spread > 0 ? [-0.2, 0, 0.2] : [0];
    for (const a of angles) {
      this.shots.push({ id: this.nextId++, x: x + a * 30, y, vx: Math.sin(a) * SHOT_SPEED, vy: -Math.cos(a) * SHOT_SPEED, alive: true });
      this.stats.shots++;
    }
    this.events.push({ k: "fire", x, y, n: angles.length });
  }

  // -----------------------------------------------------------------------------------------------------------
  // Waves
  // -----------------------------------------------------------------------------------------------------------
  private director(): void {
    if (!this.hero.alive) return;
    if (this.boss) return;
    const live = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    if (this.t >= this.nextBossAt) {
      // Let the sky thin out a little before the boss rolls in.
      if (live <= 4 || this.t > this.nextBossAt + 4) this.spawnBoss();
      return;
    }
    if (this.t < this.nextWaveAt) return;
    const d = this.d;
    this.nextWaveAt = this.t + 3.0 * Math.exp(-0.55 * d) * this.rng.range(0.85, 1.15);
    // No new wave right before a boss.
    if (this.nextBossAt - this.t < 1.5) return;
    this.spawnWave(this.pickWave());
  }

  private pickWave(): WaveKind {
    const t = this.t;
    this.waves++;
    if (this.waves === 1) return "line";
    if (this.waves === 2) return "vee";
    const w: Array<[WaveKind, number]> = [
      ["line", 3],
      ["vee", 2],
      ["drift", 1.3],
      ["swoop", t > 10 ? 2.2 : 0],
      ["snake", t > 13 ? 2 : 0],
      ["tank", t > 15 ? 1.3 + this.d : 0],
    ];
    const pool = w.filter(([k, v]) => v > 0 && k !== this.lastWave);
    const sum = pool.reduce((s, [, v]) => s + v, 0);
    let r = this.rng() * sum;
    for (const [k, v] of pool) {
      r -= v;
      if (r <= 0) {
        this.lastWave = k;
        return k;
      }
    }
    this.lastWave = "line";
    return "line";
  }

  private group(kind: WaveKind, size: number): Group {
    const g: Group = { id: this.nextId++, kind, size, killed: 0, escaped: 0, t: 0, y: -60, stopY: 0, stay: 0, sway: 0, x0: 0, x1: 0, lastX: 0, lastY: 0, done: false, rope: "up" };
    this.groups.push(g);
    return g;
  }

  private enemy(kind: EnemyKind, x: number, y: number, move: Move, group: number, hpScale = 1): Enemy {
    const s = KINDS[kind];
    const hp = Math.max(1, Math.round(s.hp * hpScale));
    const e: Enemy = { id: this.nextId++, kind, x, y, vx: 0, vy: 0, hp, max: hp, r: s.r, t: 0, alive: true, group, fireT: 0, hitT: 9, face: 1, move };
    this.enemies.push(e);
    return e;
  }

  /** Seconds until an enemy's first shot (and between shots), by kind and difficulty. */
  private fireGap(kind: EnemyKind): number {
    const k = Math.exp(-0.6 * this.d);
    const base = kind === "sock" ? 2.2 : kind === "mitten" ? 2.6 : kind === "sweater" ? 1.8 : kind === "fluff" ? 4 : 99;
    return base * k * this.rng.range(0.75, 1.3);
  }

  spawnWave(kind: WaveKind): void {
    const { w, rng } = this;
    const d = this.d;
    this.events.push({ k: "wave", kind });
    switch (kind) {
      case "line": {
        // A clothesline of socks: it lowers in, sways, then lets go.
        const n = rng.int(5, d > 0.6 ? 7 : 6);
        const g = this.group(kind, n);
        g.stopY = this.top + rng.range(105, 175);
        g.stay = rng.range(6.5, 8.5);
        g.x0 = 34;
        g.x1 = w - 34;
        for (let i = 0; i < n; i++) {
          const e = this.enemy("sock", 0, -60, { k: "hang", slot: n === 1 ? 0.5 : i / (n - 1) }, g.id, 1 + d * 0.4);
          e.fireT = rng.range(0.2, 0.6) + this.fireGap("sock") * 0.6;
          e.face = i % 2 ? 1 : -1;
        }
        break;
      }
      case "vee": {
        const n = d > 0.5 ? 7 : 5;
        const g = this.group(kind, n);
        const cx = rng.range(w * 0.3, w * 0.7);
        const vy = lerp(115, 175, clamp(d, 0, 1));
        for (let i = 0; i < n; i++) {
          const side = i === 0 ? 0 : i % 2 ? -1 : 1;
          const rank = Math.ceil(i / 2);
          const x0 = cx + side * rank * 34;
          const e = this.enemy("fluff", x0, -30 - rank * 30, { k: "fall", vy, amp: 22, freq: 1.4, x0, phase: 0 }, g.id, 1 + d * 0.35);
          e.fireT = this.t > 18 && rng.chance(0.45) ? this.fireGap("fluff") : 99;
        }
        break;
      }
      case "drift": {
        const n = rng.int(6, 9);
        const g = this.group(kind, n);
        for (let i = 0; i < n; i++) {
          const x0 = rng.range(30, w - 30);
          const e = this.enemy("fluff", x0, -30 - rng.range(0, 260), { k: "fall", vy: rng.range(70, 110) + d * 40, amp: rng.range(10, 30), freq: rng.range(0.8, 1.6), x0, phase: rng.range(0, TAU) }, g.id, 1 + d * 0.35);
          e.fireT = this.t > 16 && rng.chance(0.4) ? this.fireGap("fluff") : 99;
        }
        break;
      }
      case "swoop": {
        // Tees flap in from a top corner along an arc; some break off and dive at the iron.
        const n = d > 0.6 ? 6 : 5;
        const g = this.group(kind, n);
        const left = rng.chance(0.5);
        const s = left ? 1 : -1;
        const ox = left ? -40 : w + 40;
        const p: [number, number, number, number, number, number] = [ox, this.top + 60, w / 2 + s * w * 0.15, this.h * 0.62, left ? w + 50 : -50, this.top + 40];
        const diveP = lerp(0.15, 0.6, clamp(d, 0, 1));
        for (let i = 0; i < n; i++) {
          const e = this.enemy("tee", ox, this.top + 60, { k: "arc", p, dur: lerp(4.6, 3.6, clamp(d, 0, 1)), dive: rng.chance(diveP), diving: false }, g.id, 1 + d * 0.35);
          e.t = -i * 0.32;
          e.face = s;
        }
        break;
      }
      case "snake": {
        const n = d > 0.6 ? 8 : 6;
        const g = this.group(kind, n);
        const cx = rng.range(w * 0.3, w * 0.7);
        const amp = rng.range(70, Math.min(130, w * 0.3));
        for (let i = 0; i < n; i++) {
          const e = this.enemy("mitten", cx, -40, { k: "snake", cx, amp, freq: rng.range(0.7, 0.95), vy: lerp(95, 140, clamp(d, 0, 1)), delay: i * 0.3 }, g.id, 1 + d * 0.35);
          e.fireT = this.fireGap("mitten") + i * 0.2;
        }
        break;
      }
      case "tank": {
        const n = d > 0.9 ? 2 : 1;
        const g = this.group(kind, n);
        for (let i = 0; i < n; i++) {
          const x = n === 1 ? rng.range(w * 0.3, w * 0.7) : i === 0 ? w * 0.28 : w * 0.72;
          const e = this.enemy("sweater", x, -50, { k: "park", stopY: this.top + rng.range(110, 160), stay: rng.range(8, 10), vx: (rng.chance(0.5) ? 1 : -1) * 38 }, g.id, 1 + d * 0.6);
          e.fireT = 1.4 + i * 0.6;
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------------------------------------------
  // Movement
  // -----------------------------------------------------------------------------------------------------------
  private moveShots(dt: number): void {
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y < -30 || s.x < -30 || s.x > this.w + 30) s.alive = false;
    }
  }

  private groupById(id: number): Group | undefined {
    for (const g of this.groups) if (g.id === id) return g;
    return undefined;
  }

  private moveEnemies(dt: number): void {
    // Clotheslines first: socks hang off them.
    for (const g of this.groups) {
      g.t += dt;
      if (g.kind !== "line" || g.done) continue;
      if (g.t < g.stay) g.y += (g.stopY - g.y) * (1 - Math.exp(-2.4 * dt));
      else g.y += (90 + (g.t - g.stay) * 260) * dt;
      g.sway = Math.sin(g.t * 1.25) * 26;
      if (g.t >= g.stay && g.rope === "up") g.rope = "gone";
    }
    const hero = this.hero;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const ox = e.x;
      const oy = e.y;
      e.t += dt;
      e.hitT += dt;
      const m = e.move;
      switch (m.k) {
        case "hang": {
          const g = this.groupById(e.group)!;
          const x = g.x0 + (g.x1 - g.x0) * m.slot + g.sway;
          // The rope sags in the middle; each sock swings a little on its own peg.
          const sag = Math.sin(m.slot * Math.PI) * 26;
          e.x = x + Math.sin(e.t * 2.1 + m.slot * 5) * 4;
          e.y = g.y + sag + 26;
          break;
        }
        case "fall":
          e.y += m.vy * dt;
          e.x = m.x0 + Math.sin(e.t * m.freq * TAU * 0.5 + m.phase) * m.amp;
          break;
        case "arc": {
          if (e.t < 0) break;
          if (m.diving) {
            // Homes in for a moment, then commits.
            if (e.t < 0.45) {
              const ax = hero.x - e.x;
              const ay = hero.y - e.y;
              const l = Math.hypot(ax, ay) || 1;
              const sp = Math.hypot(e.vx, e.vy);
              const tv = 260 + 140 * clamp(this.d, 0, 1);
              const nvx = lerp(e.vx, (ax / l) * tv, 1 - Math.exp(-4 * dt));
              const nvy = lerp(e.vy, Math.max(80, (ay / l) * tv), 1 - Math.exp(-4 * dt));
              const k = Math.max(sp, tv * 0.6) / (Math.hypot(nvx, nvy) || 1);
              e.vx = nvx * k;
              e.vy = nvy * k;
            }
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.face = e.vx >= 0 ? 1 : -1;
            break;
          }
          const u = e.t / m.dur;
          const [x0, y0, x1, y1, x2, y2] = m.p;
          const v = 1 - u;
          e.x = v * v * x0 + 2 * v * u * x1 + u * u * x2;
          e.y = v * v * y0 + 2 * v * u * y1 + u * u * y2;
          if (m.dive && u > 0.42 && hero.alive) {
            m.diving = true;
            e.t = 0;
            e.vx = (e.x - ox) / dt;
            e.vy = (e.y - oy) / dt;
          }
          if (u > 1.05) e.alive = false;
          break;
        }
        case "snake": {
          const tt = e.t - m.delay;
          if (tt < 0) {
            e.y = -40;
            break;
          }
          e.y = -40 + tt * m.vy;
          e.x = m.cx + Math.sin(tt * m.freq * TAU * 0.5) * m.amp;
          break;
        }
        case "park": {
          if (e.t < 3) e.y += (m.stopY - e.y) * (1 - Math.exp(-2.2 * dt));
          if (e.t > 1.5 && e.t < m.stay) {
            e.x += m.vx * dt;
            if (e.x < 50 || e.x > this.w - 50) m.vx = -m.vx;
          }
          if (e.t >= m.stay) e.y -= (60 + (e.t - m.stay) * 120) * dt;
          if (e.t > m.stay + 1 && e.y < -60) e.alive = false;
          break;
        }
        case "hop":
          e.vy += m.g * dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.x < 16 || e.x > this.w - 16) e.vx = -e.vx;
          break;
      }
      if (m.k !== "arc" || !m.diving) {
        e.vx = (e.x - ox) / dt;
        e.vy = (e.y - oy) / dt;
      }
      if (m.k !== "hang" && Math.abs(e.vx) > 5) e.face = e.vx > 0 ? 1 : -1;
      if (e.y > this.h + 60 || e.x < -90 || e.x > this.w + 90) e.alive = false;
      if (!e.alive) {
        const g = this.groupById(e.group);
        if (g) g.escaped++;
        continue;
      }
      this.enemyFire(e, dt);
    }
  }

  private onScreen(x: number, y: number): boolean {
    return y > this.top + 20 && y < this.h * 0.62 && x > 10 && x < this.w - 10;
  }

  private enemyFire(e: Enemy, dt: number): void {
    if (!this.hero.alive || this.t < FIRE_FROM) return;
    if (e.kind === "tee" || e.kind === "minisock") return;
    if (e.move.k === "hang") {
      const g = this.groupById(e.group);
      if (!g || g.t < 1.2 || g.t > g.stay) return;
    }
    e.fireT -= dt;
    if (e.fireT > 0) return;
    if (!this.onScreen(e.x, e.y)) {
      e.fireT = 0.4;
      return;
    }
    e.fireT = this.fireGap(e.kind);
    const sp = 215 + 100 * clamp(this.d, 0, 1.8);
    // Later on, socks and mittens lead their shots a little: an iron that only ever slides one way gets caught.
    const lead = Math.min(0.65, 0.15 + 0.35 * this.d);
    if (e.kind === "sweater") this.fan(e.x, e.y + 20, this.d > 0.8 ? 5 : 3, 0.36, sp * 0.95, 0.05);
    else this.aimed(e.x, e.y + 10, sp, 0.035, e.kind === "fluff" ? 0 : lead);
    if (e.kind === "fluff") e.fireT = 99;
  }

  private angleToHero(x: number, y: number): number {
    return Math.atan2(this.hero.y - y, this.hero.x - x);
  }

  private spark(x: number, y: number, a: number, sp: number, r = 9): void {
    this.sparks.push({ id: this.nextId++, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, t: 0, alive: true });
  }

  private aimed(x: number, y: number, sp: number, err: number, lead = 0): void {
    const h = this.hero;
    const t = (Math.hypot(h.x - x, h.y - y) / sp) * lead;
    const tx = Math.min(this.w - 20, Math.max(20, h.x + h.vx * t));
    const ty = h.y + h.vy * t;
    this.spark(x, y, Math.atan2(ty - y, tx - x) + this.rng.range(-err, err), sp);
    this.events.push({ k: "spark", x, y, n: 1 });
  }

  private fan(x: number, y: number, n: number, spread: number, sp: number, err: number): void {
    const a0 = this.angleToHero(x, y) + this.rng.range(-err, err);
    for (let i = 0; i < n; i++) this.spark(x, y, a0 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread * 2), sp);
    this.events.push({ k: "spark", x, y, n });
  }

  private moveSparks(dt: number): void {
    for (const s of this.sparks) {
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > this.h + 30 || s.y < -40 || s.x < -30 || s.x > this.w + 30) s.alive = false;
    }
  }

  private movePickups(dt: number): void {
    const hero = this.hero;
    const magnet = hero.power.magnet > 0;
    for (const p of this.pickups) {
      p.t += dt;
      const power = p.kind !== "coin" && p.kind !== "button";
      if (hero.alive && (p.pulled || (magnet && !power && p.t > 0.25))) {
        p.pulled = true;
        const ax = hero.x - p.x;
        const ay = hero.y - p.y;
        const l = Math.hypot(ax, ay) || 1;
        const sp = Math.min(900, Math.hypot(p.vx, p.vy) + 2400 * dt);
        p.vx = (ax / l) * sp;
        p.vy = (ay / l) * sp;
      } else {
        const fall = power ? 75 : 120;
        p.vx *= Math.exp(-2.2 * dt);
        p.vy = Math.min(fall, p.vy + 300 * dt);
        if (power) p.x += Math.sin(p.t * 2.4) * 30 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.x = clamp(p.x, 12, this.w - 12);
      if (p.y > this.h + 24) p.alive = false;
    }
  }

  // -----------------------------------------------------------------------------------------------------------
  // Bosses
  // -----------------------------------------------------------------------------------------------------------
  private spawnBoss(): void {
    const i = this.bossCount++;
    const kind: BossKind = (["king", "spin", "hamper"] as const)[i % 3]!;
    const hp = Math.round((kind === "hamper" ? 150 : 170) + 70 * i);
    this.boss = { kind, i, x: this.w / 2, y: -110, vx: 0, vy: 0, r: kind === "hamper" ? 58 : 62, hp, max: hp, t: 0, phase: "enter", angry: false, patT: 1.2, patT2: 2.2, angle: 0, spin: 1, hitT: 9, mouth: 0 };
    this.events.push({ k: "bossIn", kind, i });
  }

  private stepBoss(dt: number): void {
    const b = this.boss!;
    b.t += dt;
    b.hitT += dt;
    const ox = b.x;
    const oy = b.y;
    const stopY = this.top + 172;
    const i = Math.min(b.i, 4);
    if (b.phase === "enter") {
      b.y += (stopY - b.y) * (1 - Math.exp(-2.4 * dt));
      if (b.t > 1.8) {
        b.phase = "fight";
        b.t = 0;
      }
    } else if (b.phase === "fight") {
      const span = this.w / 2 - 80;
      b.x = this.w / 2 + Math.sin(b.t * (0.5 + 0.06 * i)) * span;
      b.y = stopY + Math.sin(b.t * 1.3) * 12;
      if (!b.angry && b.hp <= b.max * 0.5) {
        b.angry = true;
        this.events.push({ k: "bossAngry", kind: b.kind });
      }
      if (this.hero.alive) this.bossPattern(b, dt, i);
      if (b.t > BOSS_PATIENCE) {
        b.phase = "leave";
        b.t = 0;
        this.events.push({ k: "bossLeave", kind: b.kind });
      }
    } else {
      b.y -= (80 + b.t * 220) * dt;
      if (b.y < -160) {
        this.boss = null;
        this.nextBossAt = this.t + BOSS_GAP;
        this.nextWaveAt = this.t + 1;
      }
    }
    b.mouth = Math.max(0, b.mouth - dt * 2.5);
    b.vx = (b.x - ox) / dt;
    b.vy = (b.y - oy) / dt;
  }

  private bossPattern(b: Boss, dt: number, i: number): void {
    const rage = b.angry ? 0.75 : 1;
    b.patT -= dt;
    b.patT2 -= dt;
    switch (b.kind) {
      case "king": {
        // Rings of fluff-static with a gap to slip through, and aimed triples once he's angry.
        if (b.patT <= 0) {
          b.patT = (1.9 - 0.12 * i) * rage;
          const n = 12 + 2 * i;
          const gap = this.angleToHero(b.x, b.y) + this.rng.range(-0.8, 0.8);
          const a0 = this.rng() * TAU;
          let fired = 0;
          for (let k = 0; k < n; k++) {
            const a = a0 + (k / n) * TAU;
            const da = Math.abs(((a - gap + Math.PI * 3) % TAU) - Math.PI);
            // A gap to slip through, and nothing fired back up at the HUD.
            if (da < (TAU / n) * 1.6 || Math.sin(a) < -0.3) continue;
            this.spark(b.x, b.y + 20, a, 140 + 12 * i);
            fired++;
          }
          b.mouth = 1;
          this.events.push({ k: "spark", x: b.x, y: b.y, n: fired });
        }
        if (b.angry && b.patT2 <= 0) {
          b.patT2 = 2.4 - 0.15 * i;
          this.fan(b.x, b.y + 30, 3, 0.22, 200 + 15 * i, 0.05);
        }
        break;
      }
      case "spin": {
        // Bursts of a two- or three-armed spiral, then a breath.
        const cycle = 3.6;
        const on = 2.3 + 0.1 * i;
        const ph = b.t % cycle;
        if (ph < on) {
          if (b.patT <= 0) {
            b.patT = Math.max(0.1, 0.15 - 0.008 * i);
            const arms = b.angry ? 3 : 2;
            b.angle += 0.34 * b.spin;
            // From the rim of the drum, not out of its eye.
            for (let k = 0; k < arms; k++) {
              const a = b.angle + (k / arms) * TAU;
              this.spark(b.x + Math.cos(a) * 42, b.y + 14 + Math.sin(a) * 42, a, 130 + 10 * i);
            }
            this.events.push({ k: "spark", x: b.x, y: b.y, n: arms });
            b.mouth = 1;
          }
        } else if (b.patT2 <= 0) {
          b.patT2 = cycle;
          b.spin = -b.spin;
          this.fan(b.x, b.y + 30, 3, 0.3, 190 + 15 * i, 0.06);
        }
        break;
      }
      case "hamper": {
        // Spits socks that hop down the screen, and fans of static.
        if (b.patT <= 0) {
          b.patT = (2.5 - 0.15 * i) * rage;
          const n = 2 + Math.min(2, i);
          for (let k = 0; k < n; k++) {
            const e = this.enemy("minisock", b.x, b.y - 10, { k: "hop", g: 300 }, -1);
            e.vx = this.rng.range(-130, 130);
            e.vy = this.rng.range(-230, -150);
          }
          b.mouth = 1;
        }
        if (b.patT2 <= 0) {
          b.patT2 = (2.1 - 0.12 * i) * rage;
          this.fan(b.x, b.y + 30, b.angry ? 5 : 4, 0.42, 175 + 14 * i, 0.06);
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------------------------------------------
  // Collisions and rewards
  // -----------------------------------------------------------------------------------------------------------
  private collide(): void {
    const hero = this.hero;
    // Steam vs laundry.
    for (const s of this.shots) {
      if (!s.alive) continue;
      const b = this.boss;
      if (b && b.phase !== "leave" && b.y > 0 && Math.abs(s.x - b.x) < b.r && Math.abs(s.y - b.y) < b.r * 0.9) {
        s.alive = false;
        this.stats.hits++;
        if (b.phase === "fight") this.hurtBoss(b, s.x, s.y);
        continue;
      }
      for (const e of this.enemies) {
        if (!e.alive || e.y < -10) continue;
        const dx = s.x - e.x;
        const dy = s.y - e.y;
        const rr = e.r + 5;
        if (dx * dx + dy * dy > rr * rr) continue;
        s.alive = false;
        this.stats.hits++;
        e.hp--;
        e.hitT = 0;
        if (e.hp <= 0) this.kill(e);
        else this.events.push({ k: "hit", kind: e.kind, x: s.x, y: s.y });
        break;
      }
    }
    if (!hero.alive) return;
    // Static vs the iron.
    for (const s of this.sparks) {
      if (!s.alive) continue;
      const dx = s.x - hero.x;
      const dy = s.y - hero.y;
      const rr = s.r * 0.75 + HERO_R;
      if (dx * dx + dy * dy < rr * rr) {
        s.alive = false;
        this.hurt("spark");
        if (!hero.alive) return;
      }
    }
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - hero.x;
      const dy = e.y - hero.y;
      const rr = e.r * 0.72 + HERO_R;
      if (dx * dx + dy * dy < rr * rr) {
        if (hero.inv > 0) continue;
        // Ramming costs a heart but presses the laundry too.
        this.hurt("body");
        e.hp = 0;
        this.kill(e);
        if (!hero.alive) return;
      }
    }
    const b = this.boss;
    if (b && b.phase !== "leave") {
      const dx = (b.x - hero.x) / (b.r * 0.85 + HERO_R);
      const dy = (b.y - hero.y) / (b.r * 0.75 + HERO_R);
      if (dx * dx + dy * dy < 1) this.hurt("boss");
    }
    // Pickups.
    const reach = REACH + (hero.power.magnet > 0 ? 12 : 0);
    for (const p of this.pickups) {
      if (!p.alive) continue;
      const dx = p.x - hero.x;
      const dy = p.y - hero.y;
      const rr = reach + (p.kind === "coin" || p.kind === "button" ? 0 : 6);
      if (dx * dx + dy * dy > rr * rr) continue;
      p.alive = false;
      this.collect(p);
    }
  }

  private bump(n: number): void {
    this.combo += n;
    this.comboT = COMBO_WINDOW;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    const m = multFor(this.combo);
    if (m > this.mult) {
      this.mult = m;
      this.stats.maxMult = Math.max(this.stats.maxMult, m);
      this.events.push({ k: "tier", mult: m });
    }
  }

  private kill(e: Enemy): void {
    e.alive = false;
    const s = KINDS[e.kind];
    this.bump(e.kind === "sweater" ? 3 : 1);
    const pts = s.pts * this.mult;
    this.score += pts;
    this.stats.kills++;
    this.events.push({ k: "kill", kind: e.kind, x: e.x, y: e.y, pts, mult: this.mult, combo: this.combo });
    // Loose change and buttons.
    const buttons = e.kind === "sweater" ? 3 : this.rng.chance(0.18) ? 1 : 0;
    this.drop("coin", e.x, e.y, s.coins);
    this.drop("button", e.x, e.y, buttons);
    if (e.kind === "sweater") this.drop(this.pickPower(), e.x, e.y, 1);
    else if (e.kind !== "minisock" && this.rng.chance(0.025)) this.drop(this.pickPower(), e.x, e.y, 1);
    const g = this.groupById(e.group);
    if (g) {
      g.killed++;
      g.lastX = e.x;
      g.lastY = e.y;
      if (!g.done && g.killed === g.size && g.size >= 4) {
        g.done = true;
        if (g.kind === "line") g.rope = "snap";
        const bonus = 60 * g.size * this.mult;
        this.score += bonus;
        this.stats.clears++;
        this.events.push({ k: "clear", kind: g.kind, x: e.x, y: e.y, bonus, size: g.size });
        // A full formation drops a box; later on, sometimes a heart instead.
        const heart = this.hero.hearts < HEARTS && this.t > 40 && this.rng.chance(0.12);
        this.drop(heart ? "heart" : this.pickPower(), e.x, e.y, 1);
      }
    }
  }

  private pickPower(): PowerKind {
    const p = this.hero.power;
    // Prefer something the iron doesn't have right now.
    const all: PowerKind[] = ["spread", "rapid", "shield", "magnet"];
    const free = all.filter((k) => p[k] <= 0);
    return this.rng.pick(free.length ? free : all);
  }

  drop(kind: PickupKind, x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const big = kind !== "coin" && kind !== "button";
      const a = -Math.PI / 2 + this.rng.range(-1.1, 1.1);
      const sp = big ? 80 : this.rng.range(90, 220);
      this.pickups.push({ id: this.nextId++, kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (big ? 40 : 0), t: 0, alive: true, pulled: false });
    }
  }

  private collect(p: Pickup): void {
    const hero = this.hero;
    switch (p.kind) {
      case "coin":
      case "button": {
        this.bump(p.kind === "coin" ? 1 : 3);
        const pts = (p.kind === "coin" ? 10 : 50) * this.mult;
        this.score += pts;
        if (p.kind === "coin") this.stats.coins++;
        else this.stats.buttons++;
        this.events.push({ k: "pickup", kind: p.kind, x: p.x, y: p.y, pts, combo: this.combo, mult: this.mult });
        break;
      }
      case "heart":
        hero.hearts = Math.min(HEARTS, hero.hearts + 1);
        this.score += 250 * this.mult;
        this.events.push({ k: "heart", x: p.x, y: p.y, hearts: hero.hearts });
        break;
      default: {
        const refresh = hero.power[p.kind] > 0;
        hero.power[p.kind] = p.kind === "shield" ? POWER_TIME.shield : Math.min(POWER_TIME[p.kind] * 1.6, hero.power[p.kind] + POWER_TIME[p.kind]);
        this.score += 200 * this.mult;
        this.stats.powerups++;
        this.bump(2);
        this.events.push({ k: "power", kind: p.kind, x: p.x, y: p.y, refresh });
      }
    }
  }

  private hurtBoss(b: Boss, x: number, y: number): void {
    b.hp--;
    b.hitT = 0;
    this.events.push({ k: "bossHit", x, y });
    if (b.hp > 0) return;
    this.bump(10);
    const pts = (2000 + 1000 * b.i) * this.mult;
    this.score += pts;
    this.stats.bosses++;
    this.events.push({ k: "bossBreak", kind: b.kind, x: b.x, y: b.y, pts, i: b.i });
    this.drop("coin", b.x, b.y, 24);
    this.drop("button", b.x, b.y, 6);
    this.drop(this.pickPower(), b.x - 30, b.y, 1);
    if (this.hero.hearts < HEARTS) this.drop("heart", b.x + 30, b.y, 1);
    // The fight's leftovers fizzle out.
    for (const s of this.sparks) s.alive = false;
    for (const e of this.enemies) if (e.kind === "minisock" && e.alive) this.kill(e);
    this.boss = null;
    this.nextBossAt = this.t + BOSS_GAP;
    this.nextWaveAt = this.t + 2.6;
  }

  private hurt(by: HurtBy): void {
    const hero = this.hero;
    if (hero.inv > 0 || !hero.alive) return;
    if (hero.power.shield > 0) {
      hero.power.shield = 0;
      hero.inv = SHIELD_INV;
      this.events.push({ k: "shield", x: hero.x, y: hero.y });
      this.clearNear(90);
      return;
    }
    const lost = this.combo;
    if (!this.demo || hero.hearts > 1) hero.hearts--;
    hero.inv = INV_TIME;
    this.stats.hurt[by]++;
    if (this.stats.firstHurt < 0) this.stats.firstHurt = this.t;
    this.combo = 0;
    this.comboT = 0;
    this.mult = 1;
    this.clearNear(110);
    this.events.push({ k: "hurt", x: hero.x, y: hero.y, hearts: hero.hearts, by, lost });
    if (hero.hearts <= 0) {
      hero.alive = false;
      this.over = true;
      for (const k of Object.keys(hero.power) as PowerKind[]) hero.power[k] = 0;
      this.events.push({ k: "over", x: hero.x, y: hero.y });
    }
  }

  /** Static near the iron fizzles out when it's hit, so one mistake never costs two hearts. */
  private clearNear(r: number): void {
    const { x, y } = this.hero;
    for (const s of this.sparks) if (s.alive && Math.hypot(s.x - x, s.y - y) < r) s.alive = false;
  }

  private sweep(): void {
    if (this.shots.some((s) => !s.alive)) this.shots = this.shots.filter((s) => s.alive);
    if (this.sparks.some((s) => !s.alive)) this.sparks = this.sparks.filter((s) => s.alive);
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
    if (this.pickups.some((p) => !p.alive)) this.pickups = this.pickups.filter((p) => p.alive);
    if (this.groups.length > 12) this.groups = this.groups.filter((g) => g.t < 30 || this.enemies.some((e) => e.group === g.id));
  }

  /** Living members of a group (the clothesline rope is drawn while any sock hangs on it). */
  members(g: Group): number {
    let n = 0;
    for (const e of this.enemies) if (e.group === g.id) n++;
    return n;
  }
}
