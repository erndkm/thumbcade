import { clamp, lerp } from "@thumbcade-games/kit/ease";
import { createRng, type Rng } from "@thumbcade-games/kit/rng";
import { level01, River } from "./river.ts";

/**
 * One trip down the river, without any rendering: the canoe, the hazards, the fish, the falls.
 * The game draws it; the playtest script runs it headless with a simulated player.
 */

export const START_S = 2;
export const FISH_POINTS = 10;
/** Canoe half-length and half-width in river space (for collisions). */
export const HL = 0.68;
export const HWID = 0.23;
/** Canoe speed (m/s) by distance: brisk at first, a proper rapid later. */
export const speedAt = (s: number): number => lerp(4.6, 9.4, level01(s)) + Math.max(0, s - 520) * 0.004;

export type Kind = "rock" | "log" | "dam" | "branch" | "whirl";
/** Logs start drifting when the canoe is this close (m). */
const LOG_WAKE = 14;

export interface Obstacle {
  kind: Kind;
  s: number;
  u: number;
  r: number;
  /** Logs: sideways and downstream drift, angle, half-length. */
  vu: number;
  vs: number;
  ang: number;
  half: number;
  /** Dams: the gap. */
  g0: number;
  g1: number;
  /** Branches: which bank, and where the branch ends. */
  side: number;
  tip: number;
  /** Seed for the look (props are built from it). */
  seed: number;
  variant: number;
}

export interface Fish {
  s: number;
  u: number;
  dir: number;
  t: number;
  /** -1 waiting, 0 leaping (t goes 0..1), 2 caught, 3 splashed back. */
  state: number;
  variant: number;
}

export interface RunEvents {
  spawn(o: Obstacle): void;
  despawn(o: Obstacle): void;
  spawnFish(f: Fish): void;
  despawnFish(f: Fish): void;
  leap(f: Fish): void;
  caught(f: Fish, u: number, height: number): void;
  splashFish(f: Fish, u: number): void;
  capsize(by: Kind): void;
  airborne(): void;
  land(): void;
  bump(): void;
}

/** Sideways offset and height of a leaping fish at its current t. */
export const fishArc = (f: Fish): { u: number; h: number } => ({ u: f.u + f.dir * (f.t - 0.5) * 0.9, h: 1.3 * 4 * f.t * (1 - f.t) });

export class Run {
  readonly river: River;
  readonly obstacles: Obstacle[] = [];
  readonly fishes: Fish[] = [];
  s = START_S;
  u = 0;
  vu = 0;
  target = 0;
  y = 0;
  vy = 0;
  airborne = false;
  capsized = false;
  capT = 0;
  caught = 0;
  time = 0;
  private nextEvent = 18;
  private nextFish = 9;
  private readonly rng: Rng;

  constructor(
    seed: number,
    private readonly ev: Partial<RunEvents> = {},
    readonly speedScale = 1,
  ) {
    this.rng = createRng(seed);
    this.river = new River(this.rng.int(1, 1e9));
  }

  get speed(): number {
    return speedAt(this.s) * this.speedScale;
  }

  get meters(): number {
    return Math.max(0, Math.floor(this.s - START_S));
  }

  get score(): number {
    return this.meters + this.caught * FISH_POINTS;
  }

  /** Generates hazards and fish up to `upTo` metres. */
  generate(upTo: number): void {
    const { rng, river } = this;
    while (this.nextEvent < upTo) {
      const s = this.nextEvent;
      const k = level01(s);
      river.ensureFalls(s + 20);
      const fall = river.nextFall(s - 5);
      if (Math.abs(fall - s) < 5.5) {
        this.nextEvent = fall + 6;
        continue;
      }
      const hw = river.half(s);
      const gap = lerp(8.5, 4.2, k) + rng.range(0, 2.4);
      const pick = rng();
      const base = { s, u: 0, r: 0, vu: 0, vs: 0, ang: 0, half: 0, g0: 0, g1: 0, side: 0, tip: 0, seed: rng.int(1, 1e9), variant: 0 };
      if (s > 80 && pick < 0.16) {
        // Beaver dam with a single gap.
        const gw = lerp(1.75, 1.25, k);
        const gm = rng.range(-hw + gw / 2 + 0.25, hw - gw / 2 - 0.25);
        this.add({ ...base, kind: "dam", u: gm, g0: gm - gw / 2, g1: gm + gw / 2 });
        this.nextEvent = s + gap + 2.5;
      } else if (s > 130 && pick < 0.27) {
        this.add({ ...base, kind: "whirl", u: rng.range(-hw + 1.1, hw - 1.1), r: 1.2 });
        this.nextEvent = s + gap + 2.5;
      } else if (s > 50 && pick < 0.43) {
        const side = rng.chance(0.5) ? 1 : -1;
        const cover = lerp(0.42, 0.62, k) * 2 * hw;
        const tip = side * (hw - cover);
        this.add({ ...base, kind: "branch", u: tip, side, tip });
        this.nextEvent = s + gap;
      } else if (s > 30 && pick < 0.6) {
        // A log drifting across. It wakes when the canoe gets near and then floats downstream (slower than
        // the canoe) and sideways, so it's spawned a little upstream to cross the canoe's path near s.
        const variant = rng.int(0, 2);
        const half = [0.55, 0.7, 0.85][variant]!;
        const side = rng.chance(0.5) ? 1 : -1;
        const drift = 1.2;
        const v = speedAt(s);
        const lead = (LOG_WAKE * drift) / Math.max(1, v - drift);
        this.add({ ...base, kind: "log", s: s - lead * 0.6, u: side * (hw - half * 0.8), vu: -side * rng.range(0.25, 0.55), vs: drift, ang: (rng.chance(0.5) ? 1 : -1) * rng.range(0.3, 1.0), half, variant, r: 0 });
        this.nextEvent = s + gap;
      } else if (s > 25 && pick < 0.8) {
        // Two rocks with a passage between them.
        const pass = lerp(1.9, 1.3, k);
        const pm = rng.range(-hw + pass / 2 + 0.3, hw - pass / 2 - 0.3);
        const r = rng.range(0.36, 0.48);
        if (pm - pass / 2 - r > -hw + 0.2) this.add({ ...base, kind: "rock", u: (pm - pass / 2 - r - hw) / 2, r });
        if (pm + pass / 2 + r < hw - 0.2) this.add({ ...base, kind: "rock", s: s + rng.range(-0.4, 0.4), u: (pm + pass / 2 + r + hw) / 2, r, seed: base.seed + 1 });
        this.nextEvent = s + gap;
      } else {
        // One rock, sometimes right in your line.
        const aim = s > 30 && rng() < 0.35 ? clamp(this.u, -hw + 0.5, hw - 0.5) : rng.range(-hw + 0.5, hw - 0.5);
        this.add({ ...base, kind: "rock", u: aim, r: rng.range(0.34, 0.5) });
        this.nextEvent = s + gap * 0.8;
      }
    }
    while (this.nextFish < upTo) {
      const s = this.nextFish;
      this.nextFish = s + rng.range(9, 15);
      if (Math.abs(river.nextFall(s - 4) - s) < 5) continue;
      const hw = river.half(s);
      const f: Fish = { s, u: rng.range(-hw + 0.6, hw - 0.6), dir: rng.chance(0.5) ? 1 : -1, t: 0, state: -1, variant: rng.int(0, 2) };
      this.fishes.push(f);
      this.ev.spawnFish?.(f);
    }
  }

  private add(o: Obstacle): void {
    this.obstacles.push(o);
    this.ev.spawn?.(o);
  }

  /** Distance from point (ps, pu) to the canoe's centre line. */
  private distToCanoe(ps: number, pu: number): number {
    const ds = clamp(ps, this.s - HL, this.s + HL) - ps;
    return Math.hypot(ds, this.u - pu);
  }

  hits(o: Obstacle): boolean {
    switch (o.kind) {
      case "rock":
        return this.distToCanoe(o.s, o.u) < o.r * 0.8 + HWID;
      case "log":
        for (let k = -1; k <= 1; k += 0.25) {
          if (this.distToCanoe(o.s + Math.sin(o.ang) * o.half * k, o.u + Math.cos(o.ang) * o.half * k) < 0.15 + HWID) return true;
        }
        return false;
      case "dam":
        return Math.abs(o.s - this.s) < 0.42 + HL && (this.u - HWID < o.g0 || this.u + HWID > o.g1);
      case "branch":
        return Math.abs(o.s - this.s) < 0.3 + HL * 0.5 && (o.side > 0 ? this.u + HWID > o.tip : this.u - HWID < o.tip);
      case "whirl":
        return Math.hypot(o.s - this.s, o.u - this.u) < 0.26;
    }
  }

  step(dt: number): void {
    this.time += dt;
    const { river } = this;
    const L = river.level(this.s);
    if (this.capsized) {
      this.capT += dt;
      this.s += this.speed * dt * Math.max(0, 0.6 - this.capT);
    } else {
      const v = this.speed;
      this.s += v * dt;
      const lim = river.half(this.s) - 0.35;
      this.target = clamp(this.target, -lim - 0.4, lim + 0.4);
      // The canoe chases the target; whirlpools tug it toward their eye.
      let pull = 0;
      for (const o of this.obstacles) {
        if (o.kind !== "whirl") continue;
        const d = Math.hypot(o.s - this.s, o.u - this.u);
        if (d < o.r) pull += Math.sign(o.u - this.u) * lerp(3.2, 1.2, d / o.r);
      }
      const before = this.u;
      this.u += (clamp(this.target, -lim, lim) - this.u) * (1 - Math.exp(-8.5 * dt)) + pull * dt;
      if (Math.abs(this.u) > lim) {
        if (Math.abs(this.u - before) > 0.02) this.ev.bump?.();
        this.u = Math.sign(this.u) * lim;
      }
      this.vu = dt > 0 ? (this.u - before) / dt : 0;

      // Waterfalls: the river drops away under the canoe.
      if (this.y > L + 0.01) {
        if (!this.airborne) {
          this.airborne = true;
          this.vy = 1.1;
          this.ev.airborne?.();
        }
        this.vy -= 15 * dt;
        this.y += this.vy * dt;
        if (this.y <= L) {
          this.y = L;
          this.airborne = false;
          this.ev.land?.();
        }
      } else this.y = L;

      if (!this.airborne) {
        for (const o of this.obstacles) {
          if (Math.abs(o.s - this.s) < 3 && this.hits(o)) {
            this.capsized = true;
            this.capT = 0;
            this.ev.capsize?.(o.kind);
            break;
          }
        }
      }

      // Fish jump as the canoe gets close and are caught if it passes under the arc.
      for (const f of this.fishes) {
        if (f.state === -1 && f.s - this.s < v * 0.5 && f.s - this.s > -1) {
          f.state = 0;
          f.t = 0;
          this.ev.leap?.(f);
        }
        if (f.state === 0 && !this.capsized) {
          const { u, h } = fishArc(f);
          if (Math.abs(f.s - this.s) < HL + 0.15 && Math.abs(u - this.u) < 0.5 && h > 0.12 && h < 1.25) {
            f.state = 2;
            this.caught++;
            this.ev.caught?.(f, u, h);
          }
        }
      }
    }

    // Logs drift; leaping fish fly.
    for (const o of this.obstacles) {
      if (o.kind !== "log") continue;
      if (o.r === 0) {
        if (o.s - this.s > LOG_WAKE) continue;
        o.r = 1;
      }
      o.s += o.vs * dt;
      o.u += o.vu * dt;
      const hw = river.half(o.s);
      const reach = Math.abs(Math.cos(o.ang)) * o.half;
      if (Math.abs(o.u) + reach > hw - 0.05) {
        o.u = Math.sign(o.u) * (hw - 0.05 - reach);
        o.vu = -o.vu;
      }
      o.ang += o.vu * 0.08 * dt;
    }
    for (const f of this.fishes) {
      if (f.state !== 0) continue;
      f.t += dt / 0.9;
      if (f.t >= 1) {
        f.state = 3;
        this.ev.splashFish?.(f, fishArc({ ...f, t: 1 }).u);
      }
    }

    // Upkeep: generate ahead, drop what's behind.
    this.generate(this.s + 40);
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i]!;
      if (o.s < this.s - 12) {
        this.obstacles.splice(i, 1);
        this.ev.despawn?.(o);
      }
    }
    for (let i = this.fishes.length - 1; i >= 0; i--) {
      const f = this.fishes[i]!;
      if (f.s < this.s - 10) {
        this.fishes.splice(i, 1);
        this.ev.despawnFish?.(f);
      }
    }
  }

  /** The clearest line through what's coming in the next `look` seconds (the demo paddler and the playtest bot). */
  plan(look: number): number {
    const { river } = this;
    const v = this.speed;
    const lim = river.half(this.s + 2) - 0.4;
    let best = this.u;
    let bestCost = Infinity;
    for (let cand = -lim; cand <= lim + 1e-6; cand += 0.15) {
      let cost = Math.abs(cand - this.u) * 0.6 + Math.abs(cand) * 0.15;
      for (const o of this.obstacles) {
        const ds = o.s - this.s;
        // Keep respecting what's alongside until the stern is clear.
        if (ds < -(HL + 1.1) || ds > v * look) continue;
        const w = 1 / (1 + Math.max(0, ds) * 0.25);
        let blocked = false;
        // Something alongside right now also blocks the sideways path to the candidate.
        if (ds < HL + 0.5 && (o.kind === "rock" || o.kind === "log")) {
          const ext = o.kind === "rock" ? o.r * 0.8 + HWID + 0.1 : Math.abs(Math.cos(o.ang)) * o.half + HWID + 0.15;
          const lo = Math.min(cand, this.u);
          const hi = Math.max(cand, this.u);
          if (o.u + ext > lo && o.u - ext < hi && Math.abs(ds) < HL + 0.6) cost += 120;
        }
        if (o.kind === "rock") blocked = Math.abs(cand - o.u) < o.r * 0.8 + HWID + 0.3;
        else if (o.kind === "dam") blocked = cand - HWID - 0.12 < o.g0 || cand + HWID + 0.12 > o.g1;
        else if (o.kind === "branch") blocked = o.side > 0 ? cand + HWID + 0.25 > o.tip : cand - HWID - 0.25 < o.tip;
        else if (o.kind === "whirl") cost += Math.max(0, 1.6 - Math.abs(cand - o.u)) * 30 * w;
        else {
          const awake = o.r > 0 || ds < LOG_WAKE;
          const t = awake ? Math.max(0, ds) / Math.max(1, v - o.vs) : 0;
          blocked = Math.abs(cand - (o.u + o.vu * t)) < Math.abs(Math.cos(o.ang)) * o.half + HWID + 0.35;
        }
        if (blocked) cost += 100 * w;
      }
      for (const f of this.fishes) {
        const ds = f.s - this.s;
        if (f.state === -1 && ds > 0 && ds < v * 1.6 && Math.abs(cand - f.u) < 0.4) cost -= 8;
      }
      if (cost < bestCost - 0.01) {
        bestCost = cost;
        best = cand;
      }
    }
    return best;
  }
}
