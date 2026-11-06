/**
 * Weavefire's whole game, without a screen: the ship, its guns, every enemy, bullet, crystal and pickup, the wave
 * script, the Loom (the boss), scoring and the chain multiplier. Pure and seeded: the same seed, field size and inputs
 * give the same run, so the attract demo, the headless pilot and the tests all play the real game.
 *
 * Nothing here allocates while a run is going: every entity lives in a pool created up front, and the renderer reads
 * the live lists directly. Events for sound and effects go into a fixed ring the renderer drains every frame.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import {
  CHAIN_HOLD,
  FIELD_W,
  GRAZE_R,
  GRAZE_TOPUP,
  HIT_CLEAR_R,
  INVULN,
  MAX_DRONES,
  MAX_LEVEL,
  MAX_SHIELDS,
  MULT_STEPS,
  SHIP_BOTTOM_MARGIN,
  SHIP_HIT_R,
  SHIP_PICK_R,
  SHIP_SIDE_MARGIN,
  SHIP_TOP_FRAC,
} from "./consts.ts";
import { ATTRACT, ATTRACT_PERIOD, LOOP, LOOP_BOSS, LOOP_WARN, OVERDRIVE_FROM, type ScriptEntry } from "./waves.ts";

export type EnemyKind = "dart" | "weaver" | "bloom" | "bastion" | "skiff" | "arm" | "core";
export type PathKind = "hook" | "swoop" | "lob" | "vdive" | "drop" | "snake" | "cross" | "boss";
export type PickupKind = "power" | "drone" | "shield" | "nova";
export type Phase = "waves" | "warning" | "boss" | "clear";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  path: PathKind;
  x: number;
  y: number;
  /** Heading (radians, 0 = down the screen), for drawing. */
  heading: number;
  t: number;
  hp: number;
  maxHp: number;
  r: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  /** Seconds of age at which the enemy fires next (Infinity = never). */
  fireAt: number;
  fireEvery: number;
  shots: number;
  formation: number;
  /** Hit flash, counts down. */
  flash: number;
  value: number;
  crystals: number;
  chainValue: number;
  drop: PickupKind | "";
  drop2: PickupKind | "";
  entered: boolean;
  /** Shots glance off (the Loom's core while its arms stand). */
  armor: boolean;
  /** Body contact hurts the ship. */
  solid: boolean;
  novaMark: number;
  /** Index of a boss arm (0-5), else -1. */
  arm: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  big: boolean;
  grazed: boolean;
  t: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  /** 0 = main gun, 1 = drone dart (homes). */
  kind: number;
  level: number;
  /** A straight-ahead stream (drawn brighter than the angled ones). */
  main: boolean;
  target: number;
  t: number;
}

export interface Crystal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  t: number;
  big: boolean;
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  /** A gun level knocked out of the ship by a hit, flying back for a recapture. */
  recover: boolean;
}

export interface Drone {
  x: number;
  y: number;
  fire: number;
  t: number;
}

export interface Formation {
  size: number;
  killed: number;
  escaped: number;
  bonus: number;
  lastX: number;
  lastY: number;
}

export interface Ship {
  x: number;
  y: number;
  /** Where the ship was at the end of the previous step; collisions sweep from there. */
  lx: number;
  ly: number;
  shields: number;
  level: number;
  drones: number;
  invuln: number;
  alive: boolean;
  fire: number;
  /** Seconds since the last hit (for the HUD). */
  sinceHit: number;
}

export interface BossState {
  phase: "off" | "enter" | "arms" | "core" | "dying";
  t: number;
  phaseT: number;
  x: number;
  y: number;
  rot: number;
  spin: number;
  armFire: number;
  coreFire: number;
  ringFire: number;
  spiral: number;
  spiralFire: number;
  armsLeft: number;
  hpMax: number;
  hp: number;
  enraged: boolean;
  dyingT: number;
  boomAt: number;
}

export interface RunStats {
  kills: number;
  grazes: number;
  crystals: number;
  maxMult: number;
  maxChain: number;
  formations: number;
  pickups: number;
  hits: number;
  bossesKilled: number;
  /** Fraction of the Loom left when the run ended (1 = never hurt it, -1 = never met it). */
  bossLeft: number;
  bossFastest: number;
  peakLevel: number;
  levelLosses: number;
  chainBreaks: number;
  timeAlive: number;
  deathBy: "" | "bullet" | "body";
  firstHitAt: number;
  novas: number;
}

/** Event types the renderer and sound react to. */
export const EV = {
  shot: 1,
  hit: 2,
  kill: 3,
  formation: 4,
  graze: 5,
  crystal: 6,
  pickup: 7,
  shieldHit: 8,
  multUp: 9,
  multDown: 10,
  warning: 11,
  bossIn: 12,
  armDown: 13,
  bossDead: 14,
  death: 15,
  nova: 16,
  loop: 17,
  cancel: 18,
  enemyFire: 19,
  deflect: 20,
  pickupLost: 21,
  bossPhase: 22,
  levelUp: 23,
  maxedBonus: 24,
  bossBoom: 25,
  droneUp: 26,
  shieldUp: 27,
  escape: 28,
} as const;

export interface SimEvent {
  type: number;
  x: number;
  y: number;
  /** Type-specific numbers (points, level, multiplier…). */
  a: number;
  b: number;
  kind: string;
}

export interface SimOptions {
  seed: number;
  /** Visible field height in field units (the width is always 360). */
  fieldH: number;
  attract?: boolean;
  /** Lowest y the ship may use (attract keeps it above the feed caption). */
  shipMaxY?: number;
  /** Tests: an empty field, no wave script. */
  noScript?: boolean;
}

const MAX_ENEMIES = 72;
const MAX_BULLETS = 720;
const MAX_SHOTS = 220;
const MAX_CRYSTALS = 320;
const MAX_PICKUPS = 12;
const MAX_EVENTS = 640;
const MAX_FORMATIONS = 48;
const SUBSTEP = 1 / 120;
const TAU = Math.PI * 2;
const ARMS = 6;

/** One volley of the main gun at each level: x offset, angle (degrees from straight up), damage. */
export const GUN: ReadonlyArray<{ rate: number; streams: ReadonlyArray<readonly [number, number, number]> }> = [
  { rate: 11, streams: [[-6, 0, 1], [6, 0, 1]] },
  { rate: 12, streams: [[-8, 0, 1], [0, 0, 1.2], [8, 0, 1]] },
  { rate: 12, streams: [[-8, 0, 1.1], [0, 0, 1.4], [8, 0, 1.1], [-10, -9, 1], [10, 9, 1]] },
  { rate: 13, streams: [[-9, 0, 1.25], [0, 0, 1.6], [9, 0, 1.25], [-11, -8, 1], [11, 8, 1], [-12, -17, 0.9], [12, 17, 0.9]] },
  { rate: 14, streams: [[-10, 0, 1.45], [0, 0, 2], [10, 0, 1.45], [-12, -7, 1.2], [12, 7, 1.2], [-13, -15, 1], [13, 15, 1], [-14, -24, 0.85], [14, 24, 0.85]] },
];

export const SHOT_SPEED = 960;
export const DRONE_EVERY = 0.3;
export const DRONE_DMG = 1.6;

/** Multiplier for a chain length. */
export function multFor(chain: number): number {
  let m = 1;
  for (let i = 1; i < MULT_STEPS.length; i++) if (chain >= MULT_STEPS[i]!) m = i + 1;
  return m;
}

/** Closest approach of a point moving from (ax, ay) to (bx, by) to the point (px, py): squared distance. */
export function sweepDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let u = l2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const qx = ax + dx * u - px;
  const qy = ay + dy * u - py;
  return qx * qx + qy * qy;
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function newEnemy(): Enemy {
  return {
    id: 0, kind: "dart", path: "hook", x: 0, y: 0, heading: 0, t: 0, hp: 1, maxHp: 1, r: 10,
    p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0,
    fireAt: Infinity, fireEvery: 0, shots: 0, formation: -1, flash: 0, value: 0, crystals: 0, chainValue: 1,
    drop: "", drop2: "", entered: false, armor: false, solid: true, novaMark: 0, arm: -1,
  };
}

export class Sim {
  readonly fieldH: number;
  readonly attract: boolean;
  readonly noScript: boolean;
  readonly rng: Rng;
  shipMinY: number;
  shipMaxY: number;

  /** Seconds since the run (or demo) began. */
  t = 0;
  loop = 0;
  loopT = 0;
  phase: Phase = "waves";
  phaseT = 0;
  private cursor = 0;
  /** Run time when overdrive began (0 = not yet). */
  overAt = 0;

  readonly ship: Ship;
  readonly enemies: Enemy[] = [];
  readonly bullets: Bullet[] = [];
  readonly shots: Shot[] = [];
  readonly crystals: Crystal[] = [];
  readonly pickups: Pickup[] = [];
  readonly drones: Drone[] = [];
  readonly formations: Formation[] = [];
  private readonly freeEnemies: Enemy[] = [];
  private readonly freeBullets: Bullet[] = [];
  private readonly freeShots: Shot[] = [];
  private readonly freeCrystals: Crystal[] = [];
  private readonly freePickups: Pickup[] = [];
  private nextFormation = 0;
  private nextId = 1;

  score = 0;
  chain = 0;
  chainTimer = 0;
  private lastMult = 1;
  /** Consecutive grazes inside a short window (for the rising graze tick). */
  grazeRun = 0;
  private grazeRunT = 0;

  readonly boss: BossState = {
    phase: "off", t: 0, phaseT: 0, x: FIELD_W / 2, y: -200, rot: 0, spin: 0.55, armFire: 0, coreFire: 0, ringFire: 0,
    spiral: 0, spiralFire: 0, armsLeft: 0, hpMax: 1, hp: 0, enraged: false, dyingT: 0, boomAt: 0,
  };
  private readonly armRefs: Array<Enemy | null> = [null, null, null, null, null, null];
  private coreRef: Enemy | null = null;

  nova = { on: false, t: 0, r: 0, x: 0, y: 0, id: 0 };
  /** A hit clears nearby bullets, after the bullet pass (never while it iterates them). */
  private clearAt = { on: false, x: 0, y: 0 };

  readonly events: SimEvent[] = [];
  private evHead = 0;
  evCount = 0;

  readonly stats: RunStats = {
    kills: 0, grazes: 0, crystals: 0, maxMult: 1, maxChain: 0, formations: 0, pickups: 0, hits: 0, bossesKilled: 0,
    bossLeft: -1, bossFastest: 0, peakLevel: 1, levelLosses: 0, chainBreaks: 0, timeAlive: 0, deathBy: "", firstHitAt: -1, novas: 0,
  };

  constructor(o: SimOptions) {
    this.fieldH = o.fieldH;
    this.attract = !!o.attract;
    this.noScript = !!o.noScript;
    this.rng = createRng(o.seed);
    this.shipMinY = Math.round(o.fieldH * SHIP_TOP_FRAC);
    this.shipMaxY = o.shipMaxY ?? o.fieldH - SHIP_BOTTOM_MARGIN;
    const startY = Math.min(this.shipMaxY, o.fieldH * 0.78);
    this.ship = {
      x: FIELD_W / 2, y: startY, lx: FIELD_W / 2, ly: startY, shields: MAX_SHIELDS, level: 1, drones: 0, invuln: 0,
      alive: true, fire: 0.05, sinceHit: 99,
    };
    for (let i = 0; i < MAX_ENEMIES; i++) this.freeEnemies.push(newEnemy());
    for (let i = 0; i < MAX_BULLETS; i++) this.freeBullets.push({ x: 0, y: 0, vx: 0, vy: 0, r: 4, big: false, grazed: false, t: 0 });
    for (let i = 0; i < MAX_SHOTS; i++) this.freeShots.push({ x: 0, y: 0, vx: 0, vy: 0, dmg: 1, kind: 0, level: 1, main: true, target: 0, t: 0 });
    for (let i = 0; i < MAX_CRYSTALS; i++) this.freeCrystals.push({ x: 0, y: 0, vx: 0, vy: 0, value: 0, t: 0, big: false });
    for (let i = 0; i < MAX_PICKUPS; i++) this.freePickups.push({ kind: "power", x: 0, y: 0, vx: 0, vy: 0, t: 0, recover: false });
    for (let i = 0; i < MAX_DRONES; i++) this.drones.push({ x: this.ship.x, y: this.ship.y, fire: i * 0.15, t: 0 });
    for (let i = 0; i < MAX_FORMATIONS; i++) this.formations.push({ size: 0, killed: 0, escaped: 0, bonus: 0, lastX: 0, lastY: 0 });
    for (let i = 0; i < MAX_EVENTS; i++) this.events.push({ type: 0, x: 0, y: 0, a: 0, b: 0, kind: "" });
    if (this.attract) {
      this.ship.level = 3;
      this.ship.drones = 1;
    }
  }

  // --- derived ---------------------------------------------------------------------------------------

  get mult(): number {
    return multFor(this.chain);
  }

  /** Progress (0-1) of the chain toward the next multiplier tier. */
  get multProgress(): number {
    const m = this.mult;
    if (m >= MULT_STEPS.length) return 1;
    const a = MULT_STEPS[m - 1]!;
    const b = MULT_STEPS[m]!;
    return clamp((this.chain - a) / (b - a), 0, 1);
  }

  /**
   * Difficulty: 1 to about 1.3 over the first loop. After the first Loom falls the run goes into overdrive: it starts
   * at 2 and keeps climbing every second, so a great run ends in a blaze of score instead of going on for ever.
   */
  get d(): number {
    if (this.loop === 0) return 1 + 0.008 * this.loopT;
    return 3.2 + 0.16 * this.overT;
  }

  /** Seconds since overdrive began (0 before the first Loom falls). */
  get overT(): number {
    return this.overAt > 0 ? this.t - this.overAt : 0;
  }

  get dead(): boolean {
    return !this.ship.alive;
  }

  /** Bullet speed for a base speed at the current difficulty. */
  bs(base: number): number {
    return base * (1 + 0.22 * (this.d - 1)) * (this.attract ? 0.92 : 1);
  }

  // --- input -----------------------------------------------------------------------------------------

  /** Moves the ship by a finger's delta, in field units, clamped to its zone. Takes effect immediately. */
  moveShip(dx: number, dy: number): void {
    const s = this.ship;
    if (!s.alive) return;
    s.x = clamp(s.x + dx, SHIP_SIDE_MARGIN, FIELD_W - SHIP_SIDE_MARGIN);
    s.y = clamp(s.y + dy, this.shipMinY, this.shipMaxY);
  }

  /** Puts the ship somewhere (attract set-up and tests). */
  placeShip(x: number, y: number): void {
    const s = this.ship;
    s.x = s.lx = clamp(x, SHIP_SIDE_MARGIN, FIELD_W - SHIP_SIDE_MARGIN);
    s.y = s.ly = clamp(y, this.shipMinY, this.shipMaxY);
  }

  /** Re-clamps the ship after the zone changed (attract -> run). */
  setShipZone(minY: number, maxY: number): void {
    this.shipMinY = minY;
    this.shipMaxY = maxY;
    this.moveShip(0, 0);
  }

  // --- events ----------------------------------------------------------------------------------------

  private emit(type: number, x: number, y: number, a = 0, b = 0, kind = ""): void {
    const i = (this.evHead + this.evCount) % MAX_EVENTS;
    if (this.evCount < MAX_EVENTS) this.evCount++;
    else this.evHead = (this.evHead + 1) % MAX_EVENTS;
    const e = this.events[i]!;
    e.type = type;
    e.x = x;
    e.y = y;
    e.a = a;
    e.b = b;
    e.kind = kind;
  }

  /** Visits and clears the events emitted since the last drain. */
  drain(cb: (e: SimEvent) => void): void {
    for (let k = 0; k < this.evCount; k++) cb(this.events[(this.evHead + k) % MAX_EVENTS]!);
    this.evHead = 0;
    this.evCount = 0;
  }

  // --- spawning --------------------------------------------------------------------------------------

  newFormation(size: number, bonus: number): number {
    const id = this.nextFormation;
    this.nextFormation = (this.nextFormation + 1) % MAX_FORMATIONS;
    const f = this.formations[id]!;
    f.size = size;
    f.killed = 0;
    f.escaped = 0;
    f.bonus = bonus;
    return id;
  }

  spawn(kind: EnemyKind, path: PathKind, p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, p5 = 0, p6 = 0): Enemy | null {
    const e = this.freeEnemies.pop();
    if (!e) return null;
    e.id = this.nextId++;
    e.kind = kind;
    e.path = path;
    e.p0 = p0;
    e.p1 = p1;
    e.p2 = p2;
    e.p3 = p3;
    e.p4 = p4;
    e.p5 = p5;
    e.p6 = p6;
    e.t = 0;
    e.x = -999;
    e.y = -999;
    e.heading = 0;
    e.fireAt = Infinity;
    e.fireEvery = 0;
    e.shots = 0;
    e.formation = -1;
    e.flash = 0;
    e.drop = "";
    e.drop2 = "";
    e.entered = false;
    e.armor = false;
    e.solid = true;
    e.novaMark = 0;
    e.arm = -1;
    // The demo's enemies are tougher, so the showreel stays busy instead of being shredded on arrival.
    const hpScale = (1 + 0.35 * (this.d - 1)) * (this.attract ? 2.6 : 1);
    switch (kind) {
      case "dart":
        e.hp = 2;
        e.r = 11;
        e.value = 100;
        e.crystals = 2;
        e.chainValue = 1;
        break;
      case "weaver":
        e.hp = 3;
        e.r = 10;
        e.value = 80;
        e.crystals = 1;
        e.chainValue = 1;
        break;
      case "bloom":
        e.hp = 16;
        e.r = 20;
        e.value = 400;
        e.crystals = 6;
        e.chainValue = 3;
        break;
      case "bastion":
        e.hp = 48;
        e.r = 30;
        e.value = 1200;
        e.crystals = 14;
        e.chainValue = 5;
        break;
      case "skiff":
        e.hp = 12;
        e.r = 18;
        e.value = 500;
        e.crystals = 4;
        e.chainValue = 2;
        e.solid = false;
        break;
      case "arm":
        e.hp = 56;
        e.r = 19;
        e.value = 2500;
        e.crystals = 10;
        e.chainValue = 6;
        break;
      case "core":
        e.hp = 470;
        e.r = 34;
        e.value = 30000;
        e.crystals = 40;
        e.chainValue = 20;
        break;
    }
    e.hp *= hpScale;
    // In the demo the pods live through their rings: the pink patterns are the show.
    if (this.attract && kind === "bloom") e.hp *= 2.4;
    e.maxHp = e.hp;
    this.enemies.push(e);
    this.place(e, 0);
    return e;
  }

  private recycleEnemy(i: number): void {
    const e = this.enemies[i]!;
    const last = this.enemies.length - 1;
    this.enemies[i] = this.enemies[last]!;
    this.enemies.pop();
    this.freeEnemies.push(e);
  }

  fire(x: number, y: number, angle: number, speed: number, big = false): void {
    const b = this.freeBullets.pop();
    if (!b) return;
    b.x = x;
    b.y = y;
    b.vx = Math.sin(angle) * speed;
    b.vy = Math.cos(angle) * speed;
    b.big = big;
    b.r = big ? 6.5 : 4.2;
    b.grazed = false;
    b.t = 0;
    this.bullets.push(b);
  }

  /** Fires `n` bullets spread over `spread` radians around `angle` (0 = straight down). */
  fan(x: number, y: number, angle: number, n: number, spread: number, speed: number, big = false): void {
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? angle : angle - spread / 2 + (spread * i) / (n - 1);
      this.fire(x, y, a, speed, big);
    }
    this.emit(EV.enemyFire, x, y, n);
  }

  /** A ring of `n` bullets starting at `offset`, skipping `gap` bullets centred on `gapAt` (radians). */
  ring(x: number, y: number, n: number, offset: number, speed: number, big = false, gap = 0, gapAt = 0): void {
    const step = TAU / n;
    for (let i = 0; i < n; i++) {
      const a = offset + i * step;
      if (gap > 0) {
        let da = (a - gapAt) % TAU;
        if (da > Math.PI) da -= TAU;
        if (da < -Math.PI) da += TAU;
        if (Math.abs(da) < (gap * step) / 2) continue;
      }
      this.fire(x, y, a, speed, big);
    }
    this.emit(EV.enemyFire, x, y, n);
  }

  /** Angle (0 = down) from (x, y) to the ship. */
  aim(x: number, y: number): number {
    return Math.atan2(this.ship.x - x, this.ship.y - y);
  }

  private dropPickup(kind: PickupKind, x: number, y: number, vx: number, vy: number, recover = false): void {
    const p = this.freePickups.pop();
    if (!p) return;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.t = 0;
    p.recover = recover;
    this.pickups.push(p);
  }

  private dropCrystals(x: number, y: number, n: number, value: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const c = this.freeCrystals.pop();
      if (!c) return;
      const a = this.rng() * TAU;
      const sp = spread * (0.35 + this.rng() * 0.65);
      c.x = x + Math.cos(a) * 4;
      c.y = y + Math.sin(a) * 4;
      c.vx = Math.cos(a) * sp;
      c.vy = Math.sin(a) * sp - 30;
      c.value = value;
      c.t = -this.rng() * 0.1;
      c.big = value >= 50;
      this.crystals.push(c);
    }
  }

  // --- script helpers (used by waves.ts) ---------------------------------------------------------------

  /**
   * Darts that dive in, turn and climb back out the top: they never reach the ship's zone, so the opening is safe.
   * `depth` is a fraction of the field height.
   */
  hookChain(x: number, n: number, amp: number, depth: number, opts: { gap?: number; drift?: number; shoot?: boolean; bonus?: number } = {}): void {
    const f = this.newFormation(n, opts.bonus ?? 150);
    const gap = opts.gap ?? 0.2;
    const dur = 3.6;
    for (let i = 0; i < n; i++) {
      const e = this.spawn("dart", "hook", x, amp, 1.7, 0, depth * this.fieldH, dur, opts.drift ?? 0);
      if (!e) continue;
      e.t = -i * gap;
      e.formation = f;
      if (opts.shoot) this.armShooter(e, 1.0 + i * 0.12, 0, 1);
    }
  }

  /** Darts that fall through the whole field on a sine (they can hit the ship, so they come after the opening). */
  swoopChain(x: number, n: number, amp: number, speed: number, opts: { gap?: number; phase?: number; shoot?: boolean; bonus?: number } = {}): void {
    const f = this.newFormation(n, opts.bonus ?? 150);
    const gap = opts.gap ?? 0.18;
    for (let i = 0; i < n; i++) {
      const e = this.spawn("dart", "swoop", x, amp, 2.2, opts.phase ?? 0, speed);
      if (!e) continue;
      e.t = -i * gap;
      e.formation = f;
      if (opts.shoot) this.armShooter(e, 0.9 + (i % 3) * 0.25, 0, 1);
    }
  }

  /** Darts thrown in from a side on a falling arc. */
  lobChain(fromLeft: boolean, n: number, y0: number, opts: { gap?: number; speed?: number; lift?: number; fall?: number; shoot?: boolean; bonus?: number } = {}): void {
    const f = this.newFormation(n, opts.bonus ?? 150);
    const gap = opts.gap ?? 0.17;
    const dir = fromLeft ? 1 : -1;
    const speed = opts.speed ?? 165;
    for (let i = 0; i < n; i++) {
      const e = this.spawn("dart", "lob", fromLeft ? -24 : FIELD_W + 24, y0, dir * speed, -(opts.lift ?? 40), opts.fall ?? 46);
      if (!e) continue;
      e.t = -i * gap;
      e.formation = f;
      if (opts.shoot) this.armShooter(e, 1.0 + (i % 2) * 0.35, 0, 1);
    }
  }

  /** A V that comes down together and peels outward at `splitFrac` of the field. */
  vdive(cx: number, n: number, speed: number, splitFrac: number, opts: { shoot?: boolean; bonus?: number; spacing?: number } = {}): void {
    const f = this.newFormation(n, opts.bonus ?? 160);
    const sp = opts.spacing ?? 30;
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      const off = k * sp;
      const e = this.spawn("dart", "vdive", cx + off, -30 - Math.abs(k) * 22, speed, splitFrac * this.fieldH, Math.sign(k) * 260);
      if (!e) continue;
      e.formation = f;
      if (opts.shoot) this.armShooter(e, 1.1 + Math.abs(k) * 0.18, 0, 1);
    }
  }

  /** A petal pod that drops to `holdFrac`, opens and fires rings for `hold` seconds, then climbs away. */
  bloom(x: number, holdFrac: number, opts: { hold?: number; every?: number; n?: number; speed?: number; formation?: number; drop?: PickupKind } = {}): Enemy | null {
    const e = this.spawn("bloom", "drop", x, -40, holdFrac * this.fieldH, 1.5, 1.5 + (opts.hold ?? 6), -70);
    if (!e) return null;
    e.fireAt = 1.9;
    e.fireEvery = (opts.every ?? 1.5) / Math.sqrt(this.d);
    e.shots = 99;
    e.p6 = opts.n ?? 12;
    e.p5 = opts.speed ?? 98;
    e.formation = opts.formation ?? -1;
    if (opts.drop) e.drop = opts.drop;
    // p5 is reused as ring speed; the exit speed is fixed (see place()).
    return e;
  }

  /** A heavy hex block that drops to `holdFrac` and fires aimed fans, then sinks off the bottom. */
  bastion(x: number, holdFrac: number, opts: { hold?: number; every?: number; drop?: PickupKind; drop2?: PickupKind } = {}): Enemy | null {
    const e = this.spawn("bastion", "drop", x, -50, holdFrac * this.fieldH, 2.0, 2.0 + (opts.hold ?? 7.5), -60);
    if (!e) return null;
    e.fireAt = 2.4;
    e.fireEvery = (opts.every ?? 1.3) / Math.sqrt(this.d);
    e.shots = 99;
    if (opts.drop) e.drop = opts.drop;
    if (opts.drop2) e.drop2 = opts.drop2;
    return e;
  }

  /** A chain of linked beads snaking across the field. Killing every bead pays the formation bonus. */
  weaver(fromLeft: boolean, yFrac: number, n: number, opts: { speed?: number; amp?: number; drift?: number; bonus?: number } = {}): void {
    const f = this.newFormation(n, opts.bonus ?? 120);
    const dir = fromLeft ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const e = this.spawn("weaver", "snake", fromLeft ? -20 : FIELD_W + 20, yFrac * this.fieldH, dir * (opts.speed ?? 92), opts.amp ?? 46, 2.3, opts.drift ?? 6, i === 0 ? 1 : 0);
      if (!e) continue;
      e.t = -i * 0.16;
      e.formation = f;
      if (i === 0) {
        e.hp *= 1.6;
        e.maxHp = e.hp;
        e.value = 160;
        e.crystals = 3;
        // The head spits aimed beads while it crosses.
        e.fireAt = 1.1;
        e.fireEvery = 1.25 / Math.sqrt(this.d);
        e.shots = 5;
      }
    }
  }

  /** A harmless supply skiff crossing the field; shoot it to spill two pickups, one to each side. */
  skiff(fromLeft: boolean, yFrac: number, drop: PickupKind, drop2: PickupKind | ""): void {
    // Shields come back only on the first loop; after the Loom, a shield drop becomes a nova.
    if (this.loop > 0 && !this.attract) {
      if (drop === "shield") drop = "nova";
      if (drop2 === "shield") drop2 = "nova";
    }
    const e = this.spawn("skiff", "cross", fromLeft ? -30 : FIELD_W + 30, yFrac * this.fieldH, (fromLeft ? 1 : -1) * 70);
    if (!e) return;
    e.drop = drop;
    e.drop2 = drop2;
  }

  private armShooter(e: Enemy, at: number, every: number, shots: number): void {
    const loopBoost = this.loop > 0 ? 1 : 0;
    e.fireAt = at;
    e.fireEvery = every || 1.1;
    e.shots = shots + loopBoost;
  }

  // --- paths -----------------------------------------------------------------------------------------

  /** Puts an enemy where its path says it is at its age. */
  private place(e: Enemy, dt: number): void {
    const t = e.t;
    const ox = e.x;
    const oy = e.y;
    switch (e.path) {
      case "hook": {
        // Down to `depth` and back up, on a sine sideways.
        const k = clamp(t / e.p5, 0, 1);
        e.x = e.p0 + e.p1 * Math.sin(e.p2 * t + e.p3) + e.p6 * t;
        e.y = -30 + (e.p4 + 30) * Math.sin(Math.PI * k);
        if (t > e.p5) e.y = -30 - (t - e.p5) * 200;
        break;
      }
      case "swoop":
        e.x = e.p0 + e.p1 * Math.sin(e.p2 * t + e.p3);
        e.y = -30 + e.p4 * t;
        break;
      case "lob":
        e.x = e.p0 + e.p2 * t;
        e.y = e.p1 + e.p3 * t + 0.5 * e.p4 * t * t;
        break;
      case "vdive": {
        const split = (e.p3 - e.p1) / e.p2;
        e.y = e.p1 + e.p2 * t;
        e.x = e.p0;
        if (t > split) {
          const u = t - split;
          e.x = e.p0 + 0.5 * e.p4 * u * u;
          e.y = e.p3 + e.p2 * u * 0.7;
        }
        break;
      }
      case "drop": {
        // p0 x, p1 start y, p2 hold y, p3 time to arrive, p4 time to leave, p5 leave speed (bloom: ring speed).
        const leave = e.kind === "bloom" ? -80 : e.p5;
        if (t < e.p3) e.y = e.p1 + (e.p2 - e.p1) * easeOutCubic(clamp(t / e.p3, 0, 1));
        else if (t < e.p4) e.y = e.p2 + Math.sin((t - e.p3) * 1.3) * 5;
        else {
          const u = t - e.p4;
          e.y = e.p2 + Math.sin((e.p4 - e.p3) * 1.3) * 5 + leave * u * Math.min(1, u * 1.5);
        }
        e.x = e.p0 + (e.kind === "bloom" ? Math.sin(t * 0.8 + e.p0) * 10 : 0);
        break;
      }
      case "snake":
        e.x = e.p0 + e.p2 * t;
        e.y = e.p1 + e.p3 * Math.sin(e.p4 * t) + e.p5 * t;
        break;
      case "cross":
        e.x = e.p0 + e.p2 * t;
        e.y = e.p1 + Math.sin(t * 1.8) * 8;
        break;
      case "boss":
        break;
    }
    if (dt > 0 && e.path !== "boss") {
      const vx = e.x - ox;
      const vy = e.y - oy;
      if (vx * vx + vy * vy > 1e-6) e.heading = Math.atan2(vx, vy);
    }
  }

  // --- the run ---------------------------------------------------------------------------------------

  private script(): readonly ScriptEntry[] {
    return this.attract ? ATTRACT : LOOP;
  }

  private runScript(): void {
    // After the ship is lost the world winds down: nothing new arrives.
    if (!this.ship.alive || this.noScript) return;
    const list = this.script();
    if (this.attract) {
      while (this.cursor < list.length && list[this.cursor]!.at <= this.loopT) list[this.cursor++]!.run(this);
      if (this.loopT >= ATTRACT_PERIOD) {
        this.loopT -= ATTRACT_PERIOD;
        this.cursor = 0;
        // Each pass of the showreel starts from a mid-level gun, so it can show the pickups again.
        this.ship.level = 3;
        this.ship.drones = 1;
      }
      return;
    }
    // Later loops run the script faster as well as hotter.
    const scale = this.loop === 0 ? 1 : Math.max(0.6, 0.86 - 0.1 * (this.loop - 1));
    if (this.phase === "waves") {
      while (this.cursor < list.length && list[this.cursor]!.at * scale <= this.loopT) list[this.cursor++]!.run(this);
      if (this.loopT >= LOOP_WARN * scale) {
        this.setPhase("warning");
        this.emit(EV.warning, FIELD_W / 2, this.fieldH * 0.4, this.loop);
      }
    } else if (this.phase === "warning") {
      if (this.loopT >= LOOP_BOSS * scale) {
        this.setPhase("boss");
        this.startBoss();
      }
    } else if (this.phase === "clear" && this.phaseT > 2) {
      if (this.loop === 0) this.overAt = this.t;
      this.loop++;
      // Overdrive skips the gentle opening and comes back in at the first pods.
      const sc = Math.max(0.6, 0.86 - 0.1 * (this.loop - 1));
      this.cursor = 0;
      while (this.cursor < list.length && list[this.cursor]!.at < OVERDRIVE_FROM) this.cursor++;
      // Straight in: the first overdrive wave arrives at once.
      this.loopT = (list[this.cursor]?.at ?? OVERDRIVE_FROM) * sc;
      this.setPhase("waves");
      this.emit(EV.loop, FIELD_W / 2, this.fieldH * 0.4, this.loop);
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
  }

  /** Advances the world by `dt` seconds in equal substeps of at most 1/120 s. */
  step(dt: number): void {
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-6));
    const h = dt / n;
    const s = this.ship;
    const x0 = s.lx;
    const y0 = s.ly;
    const x1 = s.x;
    const y1 = s.y;
    for (let i = 0; i < n; i++) {
      // The ship sweeps from where it was to where the finger put it, so a fast drag can't skip collisions.
      const ka = i / n;
      const kb = (i + 1) / n;
      this.substep(h, x0 + (x1 - x0) * ka, y0 + (y1 - y0) * ka, x0 + (x1 - x0) * kb, y0 + (y1 - y0) * kb);
    }
    s.lx = s.x;
    s.ly = s.y;
  }

  private substep(h: number, ax: number, ay: number, bx: number, by: number): void {
    this.t += h;
    this.loopT += h;
    this.phaseT += h;
    const s = this.ship;
    if (s.alive) this.stats.timeAlive += h;
    this.runScript();
    // The ship's position within this substep (end of the sweep), used for aiming and pickups.
    const sx = bx;
    const sy = by;
    if (s.invuln > 0) s.invuln -= h;
    s.sinceHit += h;

    this.updateChain(h);
    if (s.alive) this.fireGuns(h, sx, sy);
    this.updateDrones(h, sx, sy);
    this.updateShots(h);
    this.updateBoss(h);
    this.updateEnemies(h, ax, ay, bx, by);
    this.updateBullets(h, ax, ay, bx, by);
    if (this.clearAt.on) {
      this.clearAt.on = false;
      this.cancelBullets(this.clearAt.x, this.clearAt.y, HIT_CLEAR_R, false);
    }
    this.updateCrystals(h, sx, sy);
    this.updatePickups(h, sx, sy);
    this.updateNova(h);
    if (this.grazeRunT > 0) {
      this.grazeRunT -= h;
      if (this.grazeRunT <= 0) this.grazeRun = 0;
    }
  }

  // --- chain multiplier --------------------------------------------------------------------------------

  private updateChain(h: number): void {
    if (this.chainTimer > 0) {
      this.chainTimer -= h;
    } else if (this.chain > 0) {
      // Stop killing and the chain drains: slowly at first, faster the longer it is.
      const before = this.mult;
      this.chain = Math.max(0, this.chain - Math.max(7, this.chain * 0.55) * h);
      if (this.mult < before) {
        this.stats.chainBreaks++;
        this.emit(EV.multDown, this.ship.x, this.ship.y, this.mult, before);
      }
    }
    const m = this.mult;
    if (m !== this.lastMult) {
      if (m > this.lastMult) this.emit(EV.multUp, this.ship.x, this.ship.y - 30, m);
      this.lastMult = m;
      if (m > this.stats.maxMult) this.stats.maxMult = m;
    }
  }

  private addChain(n: number): void {
    this.chain += n;
    this.chainTimer = CHAIN_HOLD;
    if (this.chain > this.stats.maxChain) this.stats.maxChain = this.chain;
  }

  private addScore(points: number): number {
    const p = Math.round(points);
    if (!this.attract) this.score = Math.min(10_000_000, this.score + p);
    return p;
  }

  // --- the player's guns -------------------------------------------------------------------------------

  private fireGuns(h: number, sx: number, sy: number): void {
    const s = this.ship;
    s.fire -= h;
    const gun = GUN[s.level - 1]!;
    if (s.fire > 0) return;
    s.fire += 1 / gun.rate;
    if (s.fire < 0) s.fire = 0;
    const streams = gun.streams;
    for (let k = 0; k < streams.length; k++) {
      const st = streams[k]!;
      const ox = st[0];
      const deg = st[1];
      const dmg = st[2];
      const sh = this.freeShots.pop();
      if (!sh) break;
      const a = (deg * Math.PI) / 180;
      sh.x = sx + ox;
      sh.y = sy - 14 + Math.abs(ox) * 0.4;
      sh.vx = Math.sin(a) * SHOT_SPEED;
      sh.vy = -Math.cos(a) * SHOT_SPEED;
      sh.dmg = dmg;
      sh.kind = 0;
      sh.level = s.level;
      sh.main = deg === 0;
      sh.target = 0;
      sh.t = 0;
      this.shots.push(sh);
    }
    this.emit(EV.shot, sx, sy, s.level);
  }

  private updateDrones(h: number, sx: number, sy: number): void {
    const s = this.ship;
    for (let i = 0; i < MAX_DRONES; i++) {
      const d = this.drones[i]!;
      d.t += h;
      const side = i === 0 ? -1 : 1;
      const tx = sx + side * 30;
      const ty = sy + 10 + Math.sin(d.t * 3 + i) * 4;
      const k = 1 - Math.exp(-14 * h);
      d.x += (tx - d.x) * k;
      d.y += (ty - d.y) * k;
      if (i >= s.drones || !s.alive) continue;
      d.fire -= h;
      if (d.fire > 0) continue;
      d.fire += DRONE_EVERY;
      const target = this.nearestEnemy(d.x, d.y);
      const sh = this.freeShots.pop();
      if (!sh) continue;
      sh.x = d.x;
      sh.y = d.y - 6;
      let a = -0.12 * side;
      if (target) a = Math.atan2(target.x - d.x, -(target.y - d.y));
      sh.vx = Math.sin(a) * 620;
      sh.vy = -Math.cos(a) * 620;
      sh.dmg = DRONE_DMG;
      sh.kind = 1;
      sh.level = 0;
      sh.main = false;
      sh.target = target ? target.id : 0;
      sh.t = 0;
      this.shots.push(sh);
    }
  }

  private nearestEnemy(x: number, y: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (!e.entered || e.armor || e.y > y + 10 || e.y < 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy * 0.6;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private findEnemy(id: number): Enemy | null {
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i]!.id === id) return this.enemies[i]!;
    return null;
  }

  private updateShots(h: number): void {
    let i = 0;
    while (i < this.shots.length) {
      const sh = this.shots[i]!;
      sh.t += h;
      if (sh.kind === 1 && sh.target) {
        const tg = this.findEnemy(sh.target);
        if (tg && tg.entered) {
          // Homing: turn toward the target at a capped rate.
          const want = Math.atan2(tg.x - sh.x, -(tg.y - sh.y));
          const cur = Math.atan2(sh.vx, -sh.vy);
          let d = want - cur;
          if (d > Math.PI) d -= TAU;
          if (d < -Math.PI) d += TAU;
          const turn = clamp(d, -9 * h, 9 * h);
          const sp = Math.hypot(sh.vx, sh.vy);
          sh.vx = Math.sin(cur + turn) * sp;
          sh.vy = -Math.cos(cur + turn) * sp;
        } else sh.target = 0;
      }
      sh.x += sh.vx * h;
      sh.y += sh.vy * h;
      let gone = sh.y < -30 || sh.x < -30 || sh.x > FIELD_W + 30 || sh.y > this.fieldH + 30 || sh.t > 1.6;
      if (!gone) {
        for (let k = 0; k < this.enemies.length; k++) {
          const e = this.enemies[k]!;
          if (!e.entered || e.hp <= 0) continue;
          const dx = e.x - sh.x;
          const dy = e.y - sh.y;
          const rr = e.r + 4;
          if (dx * dx + dy * dy > rr * rr) continue;
          gone = true;
          if (e.armor) {
            this.emit(EV.deflect, sh.x, sh.y);
            break;
          }
          this.damage(e, sh.dmg, sh.x, sh.y);
          break;
        }
      }
      if (gone) {
        const last = this.shots.length - 1;
        this.shots[i] = this.shots[last]!;
        this.shots.pop();
        this.freeShots.push(sh);
      } else i++;
    }
  }

  private damage(e: Enemy, dmg: number, x: number, y: number): void {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.07;
    // Working on the Loom keeps the chain warm: it is one long kill.
    if ((e.kind === "arm" || e.kind === "core") && this.chainTimer < 1.2) this.chainTimer = 1.2;
    if (e.hp <= 0) this.kill(e);
    else this.emit(EV.hit, x, y, e.hp / e.maxHp, 0, e.kind);
  }

  private kill(e: Enemy): void {
    e.hp = 0;
    const m = this.mult;
    const pts = this.addScore(e.value * m);
    this.stats.kills++;
    this.addChain(e.chainValue);
    this.emit(EV.kill, e.x, e.y, pts, m, e.kind);
    this.dropCrystals(e.x, e.y, e.crystals, e.kind === "core" ? 60 : e.kind === "arm" || e.kind === "bastion" ? 30 : 20, e.kind === "core" ? 260 : e.r * 5 + 60);
    if (e.drop) this.dropPickup(e.drop, e.x, e.y, e.drop2 ? -52 : 0, -40);
    if (e.drop2) this.dropPickup(e.drop2, e.x, e.y, 52, -40);
    if (e.formation >= 0) {
      const f = this.formations[e.formation]!;
      f.killed++;
      f.lastX = e.x;
      f.lastY = e.y;
      if (f.killed === f.size && f.escaped === 0) {
        const bonus = this.addScore(f.bonus * f.size * this.mult);
        this.stats.formations++;
        this.addChain(2);
        this.emit(EV.formation, e.x, e.y, bonus, f.size);
        this.dropCrystals(e.x, e.y, Math.min(10, f.size + 2), 25, 180);
      }
    }
    if (e.kind === "arm") this.armDown(e);
    if (e.kind === "core") this.bossDown();
  }

  // --- enemies ----------------------------------------------------------------------------------------

  private updateEnemies(h: number, ax: number, ay: number, bx: number, by: number): void {
    const s = this.ship;
    let i = 0;
    while (i < this.enemies.length) {
      const e = this.enemies[i]!;
      if (e.hp <= 0) {
        this.recycleEnemy(i);
        continue;
      }
      e.t += h;
      if (e.flash > 0) e.flash -= h;
      if (e.t < 0) {
        i++;
        continue;
      }
      this.place(e, h);
      if (!e.entered && e.y > 4 && e.x > 0 && e.x < FIELD_W) e.entered = true;
      // Firing.
      if (e.entered && e.shots > 0 && e.t >= e.fireAt && s.alive) this.enemyFire(e);
      // Body contact.
      if (e.solid && e.entered && s.alive && s.invuln <= 0) {
        const rr = e.r * 0.72 + SHIP_HIT_R + 3;
        if (sweepDist2(ax, ay, bx, by, e.x, e.y) < rr * rr) {
          this.hitShip("body", bx, by);
          if (e.kind === "dart" || e.kind === "weaver") this.damage(e, 99, e.x, e.y);
        }
      }
      // Leaving the field.
      const out = e.y > this.fieldH + 60 || e.x < -70 || e.x > FIELD_W + 70 || (e.entered && e.y < -60);
      if (out && e.path !== "boss") {
        if (e.formation >= 0) this.formations[e.formation]!.escaped++;
        if (e.entered) this.emit(EV.escape, e.x, e.y, 0, 0, e.kind);
        this.recycleEnemy(i);
        continue;
      }
      i++;
    }
  }

  private enemyFire(e: Enemy): void {
    const d = this.d;
    switch (e.kind) {
      case "dart": {
        // Darts only fire while they are well above the ship and on screen.
        if (e.y > this.ship.y - 140 || e.y < 20) {
          e.fireAt = e.t + 0.15;
          return;
        }
        this.fan(e.x, e.y + 8, this.aim(e.x, e.y), d > 1.5 ? 2 : 1, 0.16, this.bs(160));
        break;
      }
      case "bloom": {
        if (e.t > e.p4) {
          e.shots = 0;
          return;
        }
        const n = Math.round(e.p6 * (1 + 0.25 * (d - 1)));
        const off = (e.shots % 2) * (Math.PI / n) + e.x * 0.01;
        this.ring(e.x, e.y, n, off, this.bs(e.p5));
        break;
      }
      case "bastion": {
        if (e.t > e.p4 + 0.4) {
          e.shots = 0;
          return;
        }
        const n = d > 1.12 ? 5 : 3;
        this.fan(e.x, e.y + 22, this.aim(e.x, e.y), n, 0.3 + 0.07 * n, this.bs(136), true);
        break;
      }
      case "weaver": {
        if (e.y > this.ship.y - 120 || e.x < 10 || e.x > FIELD_W - 10) {
          e.fireAt = e.t + 0.2;
          return;
        }
        this.fan(e.x, e.y + 6, this.aim(e.x, e.y), 1, 0, this.bs(145));
        break;
      }
      default:
        break;
    }
    e.shots--;
    e.fireAt = e.t + e.fireEvery;
  }

  // --- the Loom --------------------------------------------------------------------------------------

  private startBoss(): void {
    const b = this.boss;
    b.phase = "enter";
    b.t = 0;
    b.phaseT = 0;
    b.x = FIELD_W / 2;
    b.y = -150;
    b.rot = 0;
    b.spin = 0.55;
    b.armFire = 0;
    b.coreFire = 1.2;
    b.ringFire = 1;
    b.spiral = 0;
    b.spiralFire = 0;
    b.enraged = false;
    b.armsLeft = ARMS;
    b.dyingT = 0;
    for (let k = 0; k < ARMS; k++) {
      const e = this.spawn("arm", "boss");
      this.armRefs[k] = e;
      if (e) {
        e.arm = k;
        e.entered = false;
      }
    }
    const core = this.spawn("core", "boss");
    this.coreRef = core;
    if (core) {
      core.armor = true;
      core.entered = false;
    }
    b.hpMax = this.bossHp();
    b.hp = b.hpMax;
    this.stats.bossLeft = 1;
    this.emit(EV.bossIn, b.x, this.fieldH * 0.22, this.loop);
  }

  private bossHp(): number {
    let hp = 0;
    for (let k = 0; k < ARMS; k++) {
      const a = this.armRefs[k];
      if (a && a.hp > 0) hp += a.hp;
    }
    if (this.coreRef && this.coreRef.hp > 0) hp += this.coreRef.hp;
    return hp;
  }

  private armDown(e: Enemy): void {
    const b = this.boss;
    b.armsLeft--;
    this.armRefs[e.arm] = null;
    this.emit(EV.armDown, e.x, e.y, b.armsLeft);
    b.spin = 0.55 + (ARMS - b.armsLeft) * 0.09;
    if (b.armsLeft === 3) this.dropPickup(this.ship.level < MAX_LEVEL ? "power" : "nova", e.x, e.y, 0, -40);
    if (b.armsLeft === 0) {
      b.phase = "core";
      b.phaseT = 0;
      if (this.coreRef) this.coreRef.armor = false;
      this.dropPickup(this.ship.shields < MAX_SHIELDS && this.loop === 0 ? "shield" : "nova", e.x, e.y, 0, -50);
      this.emit(EV.bossPhase, b.x, b.y, 2);
    }
  }

  private bossDown(): void {
    const b = this.boss;
    b.phase = "dying";
    b.dyingT = 0;
    b.boomAt = 0;
    this.coreRef = null;
    this.stats.bossesKilled++;
    this.stats.bossLeft = 0;
    if (this.stats.bossFastest === 0 || b.t < this.stats.bossFastest) this.stats.bossFastest = b.t;
    // Every bullet on screen turns into a crystal.
    this.cancelBullets(b.x, b.y, 9999, true);
    const timeBonus = Math.max(0, Math.round(35 - b.t)) * 1000;
    const bonus = this.addScore((25000 + timeBonus) * (1 + this.loop * 0.5));
    this.emit(EV.bossDead, b.x, b.y, bonus, b.t);
  }

  private updateBoss(h: number): void {
    const b = this.boss;
    if (b.phase === "off") return;
    b.t += h;
    b.phaseT += h;
    const d = this.d;
    const rate = (b.enraged ? 1.35 : 1) * Math.sqrt(d);
    if (b.phase === "enter") {
      b.y = -150 + (this.fieldH * 0.28 + 150) * easeOutCubic(clamp(b.phaseT / 2.6, 0, 1));
      if (b.phaseT >= 2.6) {
        b.phase = "arms";
        b.phaseT = 0;
        for (let k = 0; k < ARMS; k++) {
          const a = this.armRefs[k];
          if (a) a.entered = true;
        }
        if (this.coreRef) this.coreRef.entered = true;
      }
    } else if (b.phase === "arms" || b.phase === "core") {
      if (!b.enraged && b.t > 30) b.enraged = true;
      if (b.phase === "core") b.x = FIELD_W / 2 + Math.sin(b.phaseT * 0.55) * 70;
      b.y = this.fieldH * 0.28 + Math.sin(b.t * 0.9) * 8;
    }
    b.rot += b.spin * h * (b.enraged ? 1.3 : 1);
    // Place the parts.
    const R = 74;
    for (let k = 0; k < ARMS; k++) {
      const a = this.armRefs[k];
      if (!a) continue;
      const ang = b.rot + (k * TAU) / ARMS;
      a.x = b.x + Math.sin(ang) * R;
      a.y = b.y + Math.cos(ang) * R * 0.86;
      a.heading = ang;
    }
    if (this.coreRef) {
      this.coreRef.x = b.x;
      this.coreRef.y = b.y;
      this.coreRef.heading = b.rot;
    }
    b.hp = this.bossHp();
    if (b.hpMax > 0 && b.phase !== "dying") this.stats.bossLeft = b.hp / b.hpMax;
    if (!this.ship.alive) return;

    if (b.phase === "arms") {
      // Each standing arm spins out a thread of bullets: together they weave a slow spiral.
      b.armFire -= h * rate;
      if (b.armFire <= 0) {
        b.armFire += 0.27;
        for (let k = 0; k < ARMS; k++) {
          const a = this.armRefs[k];
          if (!a) continue;
          const ang = b.rot + (k * TAU) / ARMS;
          this.fire(a.x, a.y, ang + 0.35, this.bs(96));
        }
        this.emit(EV.enemyFire, b.x, b.y, 0);
      }
      b.coreFire -= h * rate;
      if (b.coreFire <= 0) {
        b.coreFire += 2.2;
        this.fan(b.x, b.y + 30, this.aim(b.x, b.y), 5, 0.5, this.bs(140), true);
      }
    } else if (b.phase === "core") {
      // Rings with a gap near the ship, plus two slow spiral threads.
      b.ringFire -= h * rate;
      if (b.ringFire <= 0) {
        b.ringFire += 1.25;
        const n = Math.round(20 * (1 + 0.2 * (d - 1)));
        this.ring(b.x, b.y, n, this.rng() * TAU, this.bs(104), false, 3, this.aim(b.x, b.y) + (this.rng() - 0.5) * 0.9);
      }
      b.spiralFire -= h * rate;
      if (b.spiralFire <= 0) {
        b.spiralFire += 0.16;
        b.spiral += 0.42;
        this.fire(b.x, b.y, b.spiral, this.bs(86));
        this.fire(b.x, b.y, b.spiral + Math.PI, this.bs(86));
      }
      if (b.enraged) {
        b.coreFire -= h;
        if (b.coreFire <= 0) {
          b.coreFire += 1.8;
          this.fan(b.x, b.y + 30, this.aim(b.x, b.y), 5, 0.6, this.bs(150), true);
        }
      }
    } else if (b.phase === "dying") {
      b.dyingT += h;
      b.boomAt -= h;
      if (b.boomAt <= 0 && b.dyingT < 2.2) {
        b.boomAt = 0.16;
        const a = this.rng() * TAU;
        const r = this.rng() * 80;
        this.emit(EV.bossBoom, b.x + Math.sin(a) * r, b.y + Math.cos(a) * r * 0.8, b.dyingT / 2.2);
      }
      if (b.dyingT >= 2.4) {
        b.phase = "off";
        for (let k = 0; k < ARMS; k++) {
          const a = this.armRefs[k];
          if (a) a.hp = 0;
          this.armRefs[k] = null;
        }
        this.setPhase("clear");
      }
    }
  }

  // --- enemy bullets -----------------------------------------------------------------------------------

  private updateBullets(h: number, ax: number, ay: number, bx: number, by: number): void {
    const s = this.ship;
    const vulnerable = s.alive && s.invuln <= 0 && !this.attract;
    const grazeable = s.alive && s.invuln <= 0;
    const H = this.fieldH;
    let i = 0;
    while (i < this.bullets.length) {
      const b = this.bullets[i]!;
      b.t += h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      let gone = b.y < -40 || b.y > H + 40 || b.x < -40 || b.x > FIELD_W + 40;
      if (!gone && s.alive) {
        const near = Math.abs(b.x - bx) < 60 && Math.abs(b.y - by) < 60;
        if (near) {
          const d2 = sweepDist2(ax, ay, bx, by, b.x, b.y);
          const hit = b.r + SHIP_HIT_R;
          if (d2 < hit * hit) {
            if (vulnerable) {
              gone = true;
              this.hitShip("bullet", bx, by);
            } else if (this.attract && s.invuln <= 0) {
              // The demo pilot never dies; a touch just pops the bullet.
              gone = true;
              this.emit(EV.cancel, b.x, b.y);
            }
          } else if (!b.grazed && grazeable && d2 < GRAZE_R * GRAZE_R) {
            b.grazed = true;
            this.graze(b);
          }
        }
      }
      if (gone) {
        const last = this.bullets.length - 1;
        this.bullets[i] = this.bullets[last]!;
        this.bullets.pop();
        this.freeBullets.push(b);
      } else i++;
    }
  }

  private graze(b: Bullet): void {
    this.stats.grazes++;
    this.grazeRun++;
    this.grazeRunT = 0.9;
    this.chainTimer = Math.max(this.chainTimer, Math.min(CHAIN_HOLD, this.chainTimer + GRAZE_TOPUP));
    const pts = this.addScore(10 * this.mult);
    this.emit(EV.graze, b.x, b.y, pts, this.grazeRun);
  }

  /** Removes enemy bullets within `r` of (x, y); as crystals (boss kill, nova) or as plain sparks (a hit). */
  private cancelBullets(x: number, y: number, r: number, toCrystals: boolean): void {
    let i = 0;
    let made = 0;
    while (i < this.bullets.length) {
      const b = this.bullets[i]!;
      const dx = b.x - x;
      const dy = b.y - y;
      if (dx * dx + dy * dy < r * r) {
        if (toCrystals && made < 120 && b.y > 0) {
          const c = this.freeCrystals.pop();
          if (c) {
            c.x = b.x;
            c.y = b.y;
            c.vx = b.vx * 0.2;
            c.vy = b.vy * 0.2;
            c.value = 10;
            c.t = -made * 0.004;
            c.big = false;
            this.crystals.push(c);
            made++;
          }
        }
        this.emit(EV.cancel, b.x, b.y, toCrystals ? 1 : 0);
        const last = this.bullets.length - 1;
        this.bullets[i] = this.bullets[last]!;
        this.bullets.pop();
        this.freeBullets.push(b);
      } else i++;
    }
  }

  // --- the ship takes a hit -----------------------------------------------------------------------------

  private hitShip(by: "bullet" | "body", x: number, y: number): void {
    const s = this.ship;
    if (!s.alive || s.invuln > 0) return;
    if (this.attract) {
      s.invuln = 0.6;
      return;
    }
    s.shields--;
    s.invuln = INVULN;
    s.sinceHit = 0;
    this.stats.hits++;
    if (this.stats.firstHitAt < 0) this.stats.firstHitAt = this.t;
    const before = this.mult;
    this.chain *= 0.5;
    if (this.mult < before) this.emit(EV.multDown, x, y, this.mult, before);
    this.clearAt.on = true;
    this.clearAt.x = x;
    this.clearAt.y = y;
    if (s.shields <= 0) {
      s.alive = false;
      this.stats.deathBy = by;
      this.emit(EV.death, x, y, this.score);
      return;
    }
    let lost = 0;
    if (s.level > 1) {
      s.level--;
      lost = 1;
      this.stats.levelLosses++;
      // The lost gun level pops out and drifts back down: grab it to win it back.
      this.dropPickup("power", x, y - 10, (this.rng() - 0.5) * 90, -150, true);
    }
    this.emit(EV.shieldHit, x, y, s.shields, lost);
  }

  // --- crystals and pickups ------------------------------------------------------------------------------

  private updateCrystals(h: number, sx: number, sy: number): void {
    const s = this.ship;
    let i = 0;
    while (i < this.crystals.length) {
      const c = this.crystals[i]!;
      c.t += h;
      if (c.t > 0.32 && s.alive) {
        // Drift to the ship, faster and faster.
        const dx = sx - c.x;
        const dy = sy - c.y;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = 900 + c.t * 1400;
        c.vx += (dx / dist) * pull * h;
        c.vy += (dy / dist) * pull * h;
        const sp = Math.hypot(c.vx, c.vy);
        const max = 420 + c.t * 500;
        if (sp > max) {
          c.vx *= max / sp;
          c.vy *= max / sp;
        }
        // Damp the sideways part so they curl in instead of orbiting.
        const along = (c.vx * dx + c.vy * dy) / dist;
        const k = Math.exp(-5 * h);
        c.vx = (c.vx - (dx / dist) * along) * k + (dx / dist) * along;
        c.vy = (c.vy - (dy / dist) * along) * k + (dy / dist) * along;
      } else {
        const k = Math.exp(-3.2 * h);
        c.vx *= k;
        c.vy = c.vy * k + 40 * h;
      }
      c.x += c.vx * h;
      c.y += c.vy * h;
      let gone = false;
      if (c.t > 0.32 && s.alive) {
        const dx = sx - c.x;
        const dy = sy - c.y;
        if (dx * dx + dy * dy < SHIP_PICK_R * SHIP_PICK_R) {
          gone = true;
          const pts = this.addScore(c.value * this.mult);
          this.stats.crystals++;
          this.emit(EV.crystal, c.x, c.y, pts, c.big ? 1 : 0);
        }
      }
      if (!gone && (c.y > this.fieldH + 80 || c.t > 6)) gone = true;
      if (gone) {
        const last = this.crystals.length - 1;
        this.crystals[i] = this.crystals[last]!;
        this.crystals.pop();
        this.freeCrystals.push(c);
      } else i++;
    }
  }

  private updatePickups(h: number, sx: number, sy: number): void {
    const s = this.ship;
    let i = 0;
    while (i < this.pickups.length) {
      const p = this.pickups[i]!;
      p.t += h;
      // Float up a little when released, then drift down slowly with a sway: slow enough to steer to.
      p.vx *= Math.exp(-2.2 * h);
      p.vy += (p.recover ? 150 : 140) * h;
      const maxFall = p.recover ? 70 : 88;
      if (p.vy > maxFall) p.vy = maxFall;
      p.x = clamp(p.x + p.vx * h + Math.sin(p.t * 2.2) * 9 * h, 18, FIELD_W - 18);
      p.y += p.vy * h;
      let gone = false;
      if (s.alive && p.t > 0.25) {
        const dx = sx - p.x;
        const dy = sy - p.y;
        if (dx * dx + dy * dy < (SHIP_PICK_R + 8) * (SHIP_PICK_R + 8)) {
          gone = true;
          this.collect(p);
        }
      }
      if (!gone && (p.y > this.fieldH + 30 || (p.recover && p.t > 4.5))) {
        gone = true;
        this.emit(EV.pickupLost, p.x, Math.min(p.y, this.fieldH), 0, 0, p.kind);
      }
      if (gone) {
        const last = this.pickups.length - 1;
        this.pickups[i] = this.pickups[last]!;
        this.pickups.pop();
        this.freePickups.push(p);
      } else i++;
    }
  }

  private collect(p: Pickup): void {
    const s = this.ship;
    this.stats.pickups++;
    const m = this.mult;
    switch (p.kind) {
      case "power":
        if (s.level < MAX_LEVEL) {
          s.level++;
          if (s.level > this.stats.peakLevel) this.stats.peakLevel = s.level;
          this.emit(EV.levelUp, p.x, p.y, s.level, p.recover ? 1 : 0, p.kind);
        } else this.emit(EV.maxedBonus, p.x, p.y, this.addScore(2000 * m), 0, p.kind);
        break;
      case "drone":
        if (s.drones < MAX_DRONES) {
          s.drones++;
          const d = this.drones[s.drones - 1]!;
          d.x = p.x;
          d.y = p.y;
          this.emit(EV.droneUp, p.x, p.y, s.drones, 0, p.kind);
        } else this.emit(EV.maxedBonus, p.x, p.y, this.addScore(1500 * m), 0, p.kind);
        break;
      case "shield":
        if (s.shields < MAX_SHIELDS) {
          s.shields++;
          this.emit(EV.shieldUp, p.x, p.y, s.shields, 0, p.kind);
        } else this.emit(EV.maxedBonus, p.x, p.y, this.addScore(1500 * m), 0, p.kind);
        break;
      case "nova": {
        const n = this.nova;
        n.on = true;
        n.t = 0;
        n.r = 0;
        n.x = s.x;
        n.y = s.y;
        n.id++;
        this.stats.novas++;
        this.emit(EV.nova, s.x, s.y, 0, 0, p.kind);
        break;
      }
    }
    this.emit(EV.pickup, p.x, p.y, 0, 0, p.kind);
  }

  private updateNova(h: number): void {
    const n = this.nova;
    if (!n.on) return;
    n.t += h;
    const k = clamp(n.t / 0.75, 0, 1);
    n.r = 640 * easeOutCubic(k);
    this.cancelBullets(n.x, n.y, n.r, true);
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (!e.entered || e.novaMark === n.id || e.hp <= 0) continue;
      const dx = e.x - n.x;
      const dy = e.y - n.y;
      if (dx * dx + dy * dy < n.r * n.r) {
        e.novaMark = n.id;
        if (!e.armor) this.damage(e, e.kind === "arm" || e.kind === "core" ? 30 : 28, e.x, e.y);
      }
    }
    if (k >= 1) n.on = false;
  }
}
