/**
 * The rules of the cat's night out.
 *
 * - A tap pads the cat up one row, a sideways swipe sidesteps one column. There is no stepping back.
 * - The hop happens on the tap's release (a press only crouches), so a swipe the feed takes over never moves the cat.
 *   To keep that instant, a bump that lands while a finger is already down waits up to 0.16 s for the release: if the
 *   cat hops away in time, the hop counts from the press, and the escape is a whisker-close.
 * - Brooms, jack-o'-lanterns, yarn and wisps bump the cat; the brook and the bog soak it. Either way the cat tumbles
 *   back to the last safe ground it stood on, dazed for a moment, and the zoomies are gone. Nothing ends the run but
 *   first light: the dawn creeps up the hill behind the cat, never more than six and a half rows back, a little faster
 *   every second, and when it reaches the cat the night is over.
 * - Each new row pays 10 × the zoomies tier: quick hops in a row (no more than 1.3 s apart) build ×2 at 6, ×3 at 15,
 *   ×4 at 30. Whisker-close misses pay 25 × the tier and keep the zoomies going. Fish pay 50 (a golden moonfish 250),
 *   and every fifth fish brings the witch on her broom, who lifts the cat six rows up the hill. A new stretch of
 *   scenery pays 150 × its number.
 *
 * Pure and deterministic: the same seed and the same inputs at the same times play out the same.
 */
import { clamp } from "@thumbcade-games/kit/ease";
import {
  BIOMES,
  boatAt,
  CAT_HALF,
  CELL,
  colOf,
  COLS,
  colX,
  FW,
  hitbox,
  isHazard,
  laneHit,
  moverX,
  toadAt,
  toadState,
  toadUp,
  World,
  type Hazard,
  type Kind,
  type Row,
} from "./world.ts";

export const RULES = {
  /** Hop lengths (s): up a row, a sidestep, a bump into something in the way. */
  hop: 0.12,
  side: 0.1,
  bump: 0.13,
  /** A bump that lands while a finger is down waits this long for the release. */
  defer: 0.16,
  /** Tumbling back to safe ground, then dazed, then a moment where nothing bumps you. */
  knock: 0.5,
  stun: 0.3,
  invuln: 1.1,
  startRow: 1,
  startCol: 3,
  /** The dawn starts this far down the hill, holds still for `grace` seconds, and is never more than `leash` behind. */
  dawnStart: -3.2,
  grace: 2.5,
  leash: 6.5,
  /** The dawn has the cat once it is this close to the middle of the cat's row. */
  catchAt: 0.4,
  /** While the cat tumbles, the sun gains on it (DAWN.fumble rows; never in the first 12 s, never closer than 1.2). */
  fumbleGrace: 12,
  rowPts: 10,
  whiskerPts: 25,
  fishPts: 50,
  goldPts: 250,
  stretchPts: 150,
  liftEvery: 5,
  liftRows: 6,
  liftTime: 1.25,
  /** Quick hops: no more than this long between new rows keeps the zoomies. */
  streakGrace: 1.3,
  tiers: [0, 6, 15, 30],
  /** A landing within this many px of a boat's end scrambles aboard. */
  scramble: 6,
  /** How far past the outer columns a boat can carry the cat before the cat has to let go. */
  edge: 3,
  /** A hazard that passes within this many px of the cat is whisker-close. */
  whiskerPx: 4,
  /** Spots the cat just left count a whisker-close if a hazard sweeps through them this soon. */
  vacate: 0.3,
} as const;

export const TIER_NAMES = ["", "pitter-pat", "scamper!", "zoomies!"] as const;

/** How fast the dawn climbs (rows per second) at run time t. */
/** How fast first light climbs (see dawnSpeed), and how far it gains while the cat tumbles. Tuned with the pilots. */
export const DAWN = { base: 0.19, lin: 0.0042, quad: 0.00005, from: 75, fumble: 3 };
export function dawnSpeed(t: number): number {
  if (t < RULES.grace) return 0;
  return DAWN.base + DAWN.lin * (t - RULES.grace) + DAWN.quad * Math.max(0, t - DAWN.from) ** 2;
}

/** Zoomies tier (0..3) for a streak of quick hops. */
export function tierOf(streak: number): number {
  let k = 0;
  for (let i = 0; i < RULES.tiers.length; i++) if (streak >= RULES.tiers[i]!) k = i;
  return k;
}

export type FailKind = "bonk" | "splash" | "sink";

export type RunEvent =
  | { type: "press" }
  | { type: "hop"; dir: -1 | 0 | 1; quick: boolean }
  | { type: "bump"; dir: -1 | 0 | 1; x: number; row: number }
  | { type: "land"; x: number; row: number; kind: Kind }
  | { type: "row"; rows: number; points: number; mult: number }
  | { type: "tier"; tier: number }
  | { type: "cool"; tier: number }
  | { type: "whisker"; x: number; row: number; points: number; escape: boolean }
  | { type: "scramble"; x: number; row: number }
  | { type: "fish"; x: number; row: number; gold: boolean; points: number; basket: number }
  | { type: "lift"; fromRow: number; toRow: number }
  | { type: "liftRow"; row: number; points: number }
  | { type: "liftEnd"; x: number; row: number }
  | { type: "fail"; kind: FailKind; by: Kind; x: number; row: number; toRow: number; toX: number }
  | { type: "edge"; x: number; row: number }
  | { type: "milestone"; rows: number }
  | { type: "stretch"; stretch: number; name: string; points: number }
  | { type: "bestRow"; rows: number }
  | { type: "hurry" }
  | { type: "over"; rows: number; score: number };

export interface RunStats {
  taps: number;
  swipes: number;
  hops: number;
  sides: number;
  bumps: number;
  bonks: Record<Hazard, number>;
  splashes: number;
  sinks: number;
  edges: number;
  whiskers: number;
  escapes: number;
  fish: number;
  gold: number;
  lifts: number;
  bestStreak: number;
  maxTier: number;
  scrambles: number;
  /** Seconds the cat sat still with no input at all. */
  still: number;
  /** The dawn caught the cat while it was waiting (not mid-tumble). */
  caughtWaiting: boolean;
  stretches: number;
}

interface Hop {
  kind: "up" | "side" | "bump";
  /** Hopping away from a bump that was waiting on this release: already off the ground. */
  escape?: boolean;
  dir: -1 | 0 | 1;
  fromRow: number;
  fromX: number;
  toRow: number;
  toX: number;
  t: number;
  dur: number;
}

interface Flight {
  fromRow: number;
  fromX: number;
  toRow: number;
  toX: number;
  t: number;
  dur: number;
  kind: FailKind | "lift";
  by: Kind;
  paid: number;
}

export type CatState = "ok" | "knock" | "lift" | "caught";

export class Run {
  readonly world: World;
  t = 0;
  score = 0;
  streak = 0;
  /** Highest row index reached. */
  best: number = RULES.startRow;
  dawn: number = RULES.dawnStart;
  over = false;
  /** Attract mode: the dawn holds still. */
  dawnOff = false;
  /** Rows climbed in the player's best run so far (for the ribbon); null = none yet. */
  bestRows: number | null = null;

  readonly cat = {
    row: RULES.startRow as number,
    x: colX(RULES.startCol),
    state: "ok" as CatState,
    face: 0 as -1 | 0 | 1,
    stun: 0,
    invuln: 0,
    /** Seconds since the cat last moved (for the look-back and the idle nudge). */
    still: 0,
    safeRow: RULES.startRow as number,
  };
  hop: Hop | null = null;
  flight: Flight | null = null;
  /** A finger is down (crouching). */
  pressing = false;
  private pressAt = 0;
  private queued: -1 | 0 | 1 | null = null;
  private pending: { kind: FailKind; by: Kind; at: number } | null = null;
  private vac: { row: number; x: number; until: number; seen: boolean } | null = null;
  private lastProgress = -9;
  private lastWhisker = -9;
  private hurryArmed = true;
  private edged = false;
  private liftDue = false;
  fish = 0;
  basket = 0;
  readonly taken = new Set<number>();
  events: RunEvent[] = [];
  readonly stats: RunStats = {
    taps: 0,
    swipes: 0,
    hops: 0,
    sides: 0,
    bumps: 0,
    bonks: { broom: 0, pumpkin: 0, yarn: 0, wisp: 0 },
    splashes: 0,
    sinks: 0,
    edges: 0,
    whiskers: 0,
    escapes: 0,
    fish: 0,
    gold: 0,
    lifts: 0,
    bestStreak: 0,
    maxTier: 0,
    scrambles: 0,
    still: 0,
    caughtWaiting: false,
    stretches: 0,
  };

  constructor(seed: number) {
    this.world = new World(seed);
  }

  /** Rows climbed so far this run. */
  get rows(): number {
    return this.best - RULES.startRow;
  }

  get tier(): number {
    return tierOf(this.streak);
  }

  get mult(): number {
    return this.tier + 1;
  }

  /** 0..1 of the zoomies' grace left before the streak lapses. */
  get zoomLeft(): number {
    return this.streak > 0 ? clamp(1 - (this.t - this.lastProgress) / RULES.streakGrace) : 0;
  }

  /** The row the dawn is racing for: where the cat is, or is about to be. */
  get dawnTarget(): number {
    if (this.flight) return this.flight.kind === "lift" ? this.flight.fromRow + (this.flight.toRow - this.flight.fromRow) * (this.flight.t / this.flight.dur) : this.flight.toRow;
    if (this.hop && this.hop.t / this.hop.dur > 0.5) return this.hop.toRow;
    return this.cat.row;
  }

  /** Rows between the dawn and the cat. */
  get gap(): number {
    return this.dawnTarget - this.dawn;
  }

  get canAct(): boolean {
    return !this.over && this.cat.state === "ok";
  }

  // ---- input (the same calls for a thumb and for the pilot) ---------------------------------------

  /** A finger goes down: the cat crouches. */
  press(): void {
    if (this.over) return;
    this.pressing = true;
    this.pressAt = this.t;
    this.cat.still = 0;
    this.events.push({ type: "press" });
  }

  /** The finger comes up without travelling: a tap, so the cat pads up a row. */
  release(): void {
    if (!this.pressing) return;
    this.pressing = false;
    this.stats.taps++;
    this.go(0);
  }

  /** The feed took the gesture (or it wandered off): no hop. */
  cancel(): void {
    this.pressing = false;
  }

  /** A sideways swipe was recognised: sidestep now, mid-gesture. */
  swipe(dir: -1 | 1): void {
    this.pressing = false;
    this.stats.swipes++;
    this.cat.still = 0;
    this.go(dir);
  }

  private go(dir: -1 | 0 | 1): void {
    if (this.over || this.cat.state !== "ok") return;
    if (this.cat.stun > 0) return;
    if (this.hop) {
      this.queued = dir;
      return;
    }
    this.start(dir);
  }

  private start(dir: -1 | 0 | 1): void {
    const cat = this.cat;
    const from = this.world.row(cat.row);
    cat.face = dir;
    cat.still = 0;
    let hop: Hop;
    if (dir === 0) {
      const next = this.world.row(cat.row + 1);
      const toX = next.kind === "brook" ? cat.x : colX(colOf(cat.x));
      if (next.kind === "path" && next.block[colOf(cat.x)]! >= 0) hop = { kind: "bump", dir, fromRow: cat.row, fromX: cat.x, toRow: cat.row, toX: cat.x, t: 0, dur: RULES.bump };
      else hop = { kind: "up", dir, fromRow: cat.row, fromX: cat.x, toRow: cat.row + 1, toX, t: 0, dur: RULES.hop };
    } else {
      let toX: number;
      let ok: boolean;
      if (from.kind === "brook") {
        toX = cat.x + dir * CELL;
        ok = toX >= colX(0) - RULES.edge && toX <= colX(COLS - 1) + RULES.edge;
      } else {
        const c = colOf(cat.x) + dir;
        toX = colX(c);
        ok = c >= 0 && c < COLS && !(from.kind === "path" && from.block[c]! >= 0);
      }
      hop = ok
        ? { kind: "side", dir, fromRow: cat.row, fromX: cat.x, toRow: cat.row, toX, t: 0, dur: RULES.side }
        : { kind: "bump", dir, fromRow: cat.row, fromX: cat.x, toRow: cat.row, toX: cat.x, t: 0, dur: RULES.bump };
    }
    this.hop = hop;
    // Hopping away from a bump that was waiting on this release: it never happened.
    const escaped = this.pending !== null && hop.kind !== "bump";
    if (escaped) {
      this.pending = null;
      hop.escape = true;
    }
    if (hop.kind === "bump") {
      this.stats.bumps++;
      this.events.push({ type: "bump", dir, x: cat.x, row: cat.row });
    } else {
      if (hop.kind === "up") this.stats.hops++;
      else this.stats.sides++;
      if (from.kind !== "path") this.vac = { row: cat.row, x: cat.x, until: this.t + RULES.vacate, seen: false };
      this.events.push({ type: "hop", dir, quick: this.t - this.lastProgress <= RULES.streakGrace });
    }
    if (escaped) {
      this.stats.escapes++;
      this.whisker(cat.x, cat.row, true);
    }
  }

  // ---- the frame ---------------------------------------------------------------------------------

  /** Advances the run by dt seconds. `drive` (the pilot) gets to press and swipe first. */
  update(dt: number, drive?: (run: Run, dt: number) => void): void {
    if (this.over) {
      this.t += dt;
      return;
    }
    drive?.(this, dt);
    this.t += dt;
    const cat = this.cat;

    // First light.
    if (!this.dawnOff && !(this.flight && this.flight.kind === "lift")) {
      this.dawn += dawnSpeed(this.t) * dt;
      const target = this.dawnTarget;
      if (target - this.dawn > RULES.leash) this.dawn = target - RULES.leash;
    }

    if (cat.state === "knock" || cat.state === "lift") this.fly(dt);
    else if (cat.state === "ok") {
      cat.stun = Math.max(0, cat.stun - dt);
      cat.invuln = Math.max(0, cat.invuln - dt);
      cat.still += dt;
      if (!this.pressing && !this.hop) this.stats.still += dt;
      if (this.hop) {
        const h = this.hop;
        h.t += dt;
        // A sidestep (or a bump) on a boat rides along with it.
        const from = this.world.row(h.fromRow);
        if (h.kind !== "up" && from.kind === "brook" && !this.pending) {
          h.fromX += from.dir * from.speed * dt;
          h.toX += from.dir * from.speed * dt;
        }
        if (h.t >= h.dur) this.land();
      } else {
        this.ride(dt);
      }
      if (cat.state === "ok") this.check();
      this.whiskerWatch();
      if (cat.state === "ok" && !this.hop && cat.stun <= 0 && this.queued !== null) {
        const q = this.queued;
        this.queued = null;
        this.start(q);
      }
      if (this.liftDue && cat.state === "ok" && !this.hop) this.startLift();
    }

    // The zoomies wear off.
    if (this.streak > 0 && this.t - this.lastProgress > RULES.streakGrace) {
      const was = this.tier;
      this.streak = 0;
      if (was > 0) this.events.push({ type: "cool", tier: was });
    }

    if (!this.dawnOff) {
      const gap = this.gap;
      if (gap < 2.2 && this.hurryArmed) {
        this.hurryArmed = false;
        this.events.push({ type: "hurry" });
      } else if (gap > 3.5) this.hurryArmed = true;
      if (gap <= RULES.catchAt) this.end();
    }
  }

  drain(): RunEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Where the cat is now for bumping purposes: its row and x, or null in mid-air. */
  private presence(): { row: number; x: number; landed: boolean } | null {
    const h = this.hop;
    if (!h) return { row: this.cat.row, x: this.cat.x, landed: true };
    const p = h.t / h.dur;
    const x = h.fromX + (h.toX - h.fromX) * Math.min(1, p);
    // An escape counts from the press: the cat is already off the ground where the bump was.
    if (h.escape && (h.kind !== "up" ? p < 0.5 : p < 0.7)) return null;
    if (h.kind !== "up") return { row: h.fromRow, x, landed: false };
    if (p < 0.3) return { row: h.fromRow, x, landed: false };
    if (p > 0.7) return { row: h.toRow, x, landed: false };
    return null;
  }

  /** The cat rides the brook: a boat carries it, up to the edge of the hill. */
  private ride(dt: number): void {
    const cat = this.cat;
    const row = this.world.row(cat.row);
    if (row.kind !== "brook" || this.pending) return;
    const lo = colX(0) - RULES.edge;
    const hi = colX(COLS - 1) + RULES.edge;
    const nx = cat.x + row.dir * row.speed * dt;
    cat.x = clamp(nx, lo, hi);
    if (cat.x !== nx && !this.edged) {
      this.edged = true;
      this.stats.edges++;
      this.events.push({ type: "edge", x: cat.x, row: cat.row });
    } else if (cat.x === nx) this.edged = false;
  }

  /** Bumps, soakings and sinkings; deferred while a finger is down, so a hop on its release still escapes. */
  private check(): void {
    if (this.pending) {
      if (!this.pressing || this.t - this.pending.at > RULES.defer) {
        const p = this.pending;
        this.pending = null;
        this.fail(p.kind, p.by);
      }
      return;
    }
    const at = this.presence();
    if (!at) return;
    const row = this.world.row(at.row);
    let kind: FailKind | null = null;
    if (isHazard(row.kind)) {
      if (this.cat.invuln <= 0 && laneHit(row, at.x, this.t)) kind = "bonk";
    } else if (at.landed && row.kind === "brook") {
      if (boatAt(row, at.x, this.t) < 0) kind = "splash";
    } else if (at.landed && row.kind === "bog") {
      if (!toadUp(row, colOf(at.x), this.t)) kind = "sink";
    }
    if (!kind) return;
    if (this.pressing && this.pressAt <= this.t) this.pending = { kind, by: row.kind, at: this.t };
    else this.fail(kind, row.kind);
  }

  private land(): void {
    const h = this.hop!;
    const cat = this.cat;
    this.hop = null;
    cat.row = h.toRow;
    cat.x = h.toX;
    if (h.kind === "bump") return;
    const row = this.world.row(cat.row);
    // A near miss onto a boat: scramble aboard.
    if (row.kind === "brook" && boatAt(row, cat.x, this.t) < 0) {
      let best = Infinity;
      let to = cat.x;
      for (const m of row.movers) {
        const bx = moverX(row, m, this.t);
        for (const end of [bx, bx + m.len]) {
          const d = Math.abs(end - cat.x);
          if (d < best) {
            best = d;
            to = clamp(cat.x, bx + 4, bx + m.len - 4);
          }
        }
      }
      if (best <= RULES.scramble && to >= colX(0) - RULES.edge && to <= colX(COLS - 1) + RULES.edge) {
        cat.x = to;
        this.stats.scrambles++;
        this.events.push({ type: "scramble", x: to, row: cat.row });
      }
    }
    this.events.push({ type: "land", x: cat.x, row: cat.row, kind: row.kind });
    if (row.kind === "path") cat.safeRow = cat.row;
    if (h.kind === "up" && cat.row > this.best) this.newRow(cat.row);
    this.pickup(row);
    // Just behind something that went by: whisker-close.
    if (isHazard(row.kind)) {
      for (const m of row.movers) {
        const [a, b] = hitbox(row, m, this.t);
        const behind = row.dir > 0 ? cat.x - CAT_HALF - b : a - (cat.x + CAT_HALF);
        if (behind >= 0 && behind < RULES.whiskerPx) {
          this.whisker(cat.x, cat.row, false);
          break;
        }
      }
    }
  }

  private newRow(r: number): void {
    const quick = this.t - this.lastProgress <= RULES.streakGrace;
    const was = this.tier;
    this.streak = quick ? this.streak + 1 : 1;
    this.lastProgress = this.t;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.streak);
    const tier = this.tier;
    if (tier > was) {
      this.stats.maxTier = Math.max(this.stats.maxTier, tier);
      this.events.push({ type: "tier", tier });
    }
    for (let k = this.best + 1; k <= r; k++) this.payRow(k);
    this.best = Math.max(this.best, r);
  }

  /** Pays a new row and anything that comes with it. */
  private payRow(k: number): void {
    const pts = RULES.rowPts * this.mult;
    this.score += pts;
    const rows = k - RULES.startRow;
    this.events.push({ type: "row", rows, points: pts, mult: this.mult });
    const row = this.world.row(k);
    if (row.arch && k > 0) {
      const stretch = row.stretch;
      const p = RULES.stretchPts * stretch;
      this.score += p;
      this.stats.stretches++;
      this.events.push({ type: "stretch", stretch, name: BIOMES[stretch % BIOMES.length]!.name, points: p });
    } else if (rows > 0 && rows % 10 === 0) this.events.push({ type: "milestone", rows });
    if (this.bestRows !== null && this.bestRows > 0 && rows === this.bestRows + 1) this.events.push({ type: "bestRow", rows });
  }

  private pickup(row: Row): void {
    const p = row.pickup;
    if (!p || this.taken.has(row.i)) return;
    const cat = this.cat;
    const got = p.mover >= 0 ? boatAt(row, cat.x, this.t, 0) === p.mover : Math.abs(colX(p.col) - cat.x) < 8;
    if (!got) return;
    this.taken.add(row.i);
    const pts = (p.gold ? RULES.goldPts : RULES.fishPts) * this.mult;
    this.score += pts;
    this.fish++;
    this.stats.fish++;
    if (p.gold) this.stats.gold++;
    this.basket++;
    this.events.push({ type: "fish", x: cat.x, row: row.i, gold: p.gold, points: pts, basket: this.basket });
    if (this.basket >= RULES.liftEvery) {
      this.basket = 0;
      this.liftDue = true;
    }
  }

  private whisker(x: number, row: number, escape: boolean): void {
    if (this.t - this.lastWhisker < 0.25) return;
    this.lastWhisker = this.t;
    const pts = RULES.whiskerPts * this.mult;
    this.score += pts;
    this.stats.whiskers++;
    if (this.streak > 0) this.lastProgress = this.t;
    this.events.push({ type: "whisker", x, row, points: pts, escape });
  }

  /** A spot the cat just left gets swept through (or sinks) a moment later: whisker-close. */
  private whiskerWatch(): void {
    const v = this.vac;
    if (!v) return;
    if (this.t > v.until) {
      this.vac = null;
      return;
    }
    const row = this.world.row(v.row);
    let close = false;
    if (isHazard(row.kind)) close = laneHit(row, v.x, this.t, 1);
    else if (row.kind === "bog") close = !toadUp(row, colOf(v.x), this.t);
    if (close) {
      this.vac = null;
      if (this.cat.state === "ok") this.whisker(v.x, v.row, false);
    }
  }

  private fail(kind: FailKind, by: Kind): void {
    const cat = this.cat;
    const at = this.presence() ?? { row: cat.row, x: cat.x };
    const fromRow = at.row;
    const fromX = at.x;
    const safe = this.world.row(cat.safeRow);
    const toX = colX(nearestFree(safe, colOf(fromX)));
    this.hop = null;
    this.queued = null;
    this.vac = null;
    this.liftDue = false;
    const was = this.tier;
    this.streak = 0;
    if (was > 0) this.events.push({ type: "cool", tier: was });
    if (kind === "bonk") this.stats.bonks[by as Hazard]++;
    else if (kind === "splash") this.stats.splashes++;
    else this.stats.sinks++;
    cat.state = "knock";
    if (!this.dawnOff && this.t > RULES.fumbleGrace) this.dawn = Math.max(this.dawn, Math.min(this.dawn + DAWN.fumble, cat.safeRow - 1.2));
    this.flight = { fromRow, fromX, toRow: cat.safeRow, toX, t: 0, dur: RULES.knock, kind, by, paid: 0 };
    this.events.push({ type: "fail", kind, by, x: fromX, row: fromRow, toRow: cat.safeRow, toX });
  }

  private startLift(): void {
    this.liftDue = false;
    const cat = this.cat;
    let to = cat.row + RULES.liftRows;
    while (this.world.row(to).kind !== "path") to++;
    const toX = colX(nearestFree(this.world.row(to), colOf(cat.x)));
    this.pending = null;
    this.vac = null;
    cat.state = "lift";
    this.stats.lifts++;
    this.flight = { fromRow: cat.row, fromX: cat.x, toRow: to, toX, t: 0, dur: RULES.liftTime, kind: "lift", by: "path", paid: cat.row };
    this.events.push({ type: "lift", fromRow: cat.row, toRow: to });
  }

  private fly(dt: number): void {
    const f = this.flight!;
    const cat = this.cat;
    f.t += dt;
    if (f.kind === "lift") {
      // Rows pay as the broom passes them.
      const at = Math.floor(f.fromRow + (f.toRow - f.fromRow) * Math.min(1, f.t / f.dur));
      while (f.paid < at) {
        f.paid++;
        if (f.paid > this.best) {
          this.lastProgress = this.t;
          this.payRow(f.paid);
          this.best = f.paid;
          this.events.push({ type: "liftRow", row: f.paid, points: RULES.rowPts * this.mult });
        }
      }
    }
    if (f.t < f.dur) return;
    cat.row = f.toRow;
    cat.x = f.toX;
    cat.safeRow = f.toRow;
    cat.state = "ok";
    cat.still = 0;
    this.flight = null;
    if (f.kind === "lift") {
      cat.invuln = 0.6;
      if (f.toRow > this.best) this.best = f.toRow;
      this.events.push({ type: "liftEnd", x: cat.x, row: cat.row });
      this.pickup(this.world.row(cat.row));
    } else {
      cat.stun = RULES.stun;
      cat.invuln = RULES.invuln;
    }
  }

  private end(): void {
    this.over = true;
    this.stats.caughtWaiting = this.cat.state === "ok" && !this.hop && this.cat.still > 0.8;
    this.cat.state = "caught";
    this.hop = null;
    this.pending = null;
    this.pressing = false;
    this.events.push({ type: "over", rows: this.rows, score: this.score });
  }

  // ---- looking ahead (the pilot and the tests use these) -------------------------------------------

  /**
   * Seconds until the cat, standing (or riding) where it is from time t0 on, would be bumped or soaked: Infinity if
   * not within `horizon`. `margin` grows the hazards, `skew` shifts the pilot's idea of the time.
   */
  dangerIn(rowI: number, x: number, t0: number, horizon: number, margin = 0, skew = 0): number {
    const row = this.world.row(rowI);
    if (row.kind === "path") return Infinity;
    const step = 1 / 60;
    let px = x;
    for (let s = 0; s <= horizon; s += step) {
      const t = t0 + s + skew;
      if (isHazard(row.kind)) {
        if (laneHit(row, px, t, margin)) return s;
      } else if (row.kind === "brook") {
        if (boatAt(row, px, t, -margin) < 0) return s;
        const nx = px + row.dir * row.speed * step;
        px = clamp(nx, colX(0) - RULES.edge, colX(COLS - 1) + RULES.edge);
      } else if (row.kind === "bog") {
        const toad = toadAt(row, colOf(px));
        if (!toad) return s;
        const st = toadState(row, toad, t);
        if (!st.up) return s;
      }
    }
    return Infinity;
  }

  /** The row at index i. */
  row(i: number): Row {
    return this.world.row(i);
  }
}

/** The free column nearest c on a path row (c itself if free). */
export function nearestFree(row: Row, c: number): number {
  if (row.kind !== "path") return c;
  for (let d = 0; d < COLS; d++) {
    if (c - d >= 0 && row.block[c - d]! < 0) return c - d;
    if (c + d < COLS && row.block[c + d]! < 0) return c + d;
  }
  return c;
}

export { FW };
