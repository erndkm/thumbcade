/**
 * The demo golfer's brain: a walking-distance field to the cup (so doglegs and walls make sense) and a shot
 * search that runs the real physics a few candidates at a time, so it never stalls a frame.
 */
import { closestOnPolygon, closestOnSegment, pointInPolygon, bounds, type V2 } from "./geom.ts";
import { BALL_R, inBlob } from "./holes.ts";
import type { Course} from "./physics.ts";
import { MAX_SPEED, simulate, type ShotResult } from "./physics.ts";

const CELL = 0.1;

export class DistanceField {
  readonly nx: number;
  readonly nz: number;
  readonly x0: number;
  readonly z0: number;
  readonly dist: Float32Array;

  constructor(c: Course) {
    const h = c.hole;
    const b = bounds(h.outline);
    this.x0 = b.minX;
    this.z0 = b.minZ;
    this.nx = Math.ceil((b.maxX - b.minX) / CELL) + 1;
    this.nz = Math.ceil((b.maxZ - b.minZ) / CELL) + 1;
    const n = this.nx * this.nz;
    const free = new Uint8Array(n);
    const sand = new Uint8Array(n);
    const tmp: V2 = { x: 0, z: 0 };
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * CELL;
        const z = this.z0 + j * CELL;
        let ok = pointInPolygon(h.outline, x, z) && closestOnPolygon(h.outline, x, z).d > BALL_R * 0.9;
        if (ok) for (const w of h.walls) if (closestOnSegment(w.ax, w.az, w.bx, w.bz, x, z, tmp) < (w.r + BALL_R) ** 2) ok = false;
        if (ok) for (const p of h.bumpers) if (Math.hypot(x - p.x, z - p.z) < p.r + BALL_R) ok = false;
        if (ok) for (const wt of h.water) if (inBlob(wt, x, z, -0.05)) ok = false;
        free[j * this.nx + i] = ok ? 1 : 0;
        if (ok) for (const s of h.sand) if (inBlob(s, x, z)) sand[j * this.nx + i] = 1;
      }
    }
    const dist = new Float32Array(n).fill(Infinity);
    this.dist = dist;
    // Dijkstra from the cup over 8-connected free cells (binary heap).
    const heap: number[] = [];
    const push = (idx: number) => {
      heap.push(idx);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (dist[heap[p]!]! <= dist[heap[k]!]!) break;
        [heap[p], heap[k]] = [heap[k]!, heap[p]!];
        k = p;
      }
    };
    const pop = (): number => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && dist[heap[l]!]! < dist[heap[m]!]!) m = l;
          if (r < heap.length && dist[heap[r]!]! < dist[heap[m]!]!) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k]!, heap[m]!];
          k = m;
        }
      }
      return top;
    };
    const ci = Math.round((h.cup.x - this.x0) / CELL);
    const cj = Math.round((h.cup.z - this.z0) / CELL);
    const start = cj * this.nx + ci;
    dist[start] = 0;
    push(start);
    const done = new Uint8Array(n);
    while (heap.length) {
      const k = pop();
      if (done[k]) continue;
      done[k] = 1;
      const i = k % this.nx;
      const j = (k - i) / this.nx;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di;
          const b2 = j + dj;
          if (a < 0 || b2 < 0 || a >= this.nx || b2 >= this.nz) continue;
          const q = b2 * this.nx + a;
          if (!free[q] || done[q]) continue;
          const step = (di && dj ? Math.SQRT2 : 1) * CELL * (sand[q] ? 2.2 : 1);
          if (dist[k]! + step < dist[q]!) {
            dist[q] = dist[k]! + step;
            push(q);
          }
        }
      }
    }
  }

  at(x: number, z: number): number {
    const i = Math.round((x - this.x0) / CELL);
    const j = Math.round((z - this.z0) / CELL);
    let best = Infinity;
    // The resting ball can sit right against a wall (a blocked cell): look around it.
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
        const d = this.dist[b * this.nx + a]! + Math.hypot(di, dj) * CELL;
        if (d < best) best = d;
      }
    }
    return best === Infinity ? 99 : best;
  }
}

export interface Shot {
  angle: number;
  power: number;
  result: ShotResult;
  cost: number;
}

export const shotVelocity = (angle: number, power: number): [number, number] => [Math.cos(angle) * power * MAX_SPEED, Math.sin(angle) * power * MAX_SPEED];

/** Lower is better. */
function costOf(r: ShotResult, field: DistanceField, c: Course, power: number): number {
  if (r.sunk) return -100 + power;
  if (r.water) return 50;
  return field.at(r.x, r.z) + (c.inSand(r.x, r.z) ? 0.6 : 0);
}

/** Incremental shot search: call `work(ms)` every frame until `done`. */
export class ShotPlanner {
  private queue: Array<[number, number]> = [];
  private refined = false;
  best: Shot | null = null;
  private top: Shot[] = [];

  constructor(
    private readonly c: Course,
    private readonly field: DistanceField,
    private readonly from: V2,
    private readonly t0: number,
  ) {
    const aim = Math.atan2(c.hole.cup.z - from.z, c.hole.cup.x - from.x);
    const dCup = Math.hypot(c.hole.cup.x - from.x, c.hole.cup.z - from.z);
    const near = dCup < 2.2;
    const angles = near ? 36 : 60;
    const powers = near ? [0.12, 0.18, 0.24, 0.3, 0.38, 0.48] : [0.3, 0.42, 0.54, 0.66, 0.78, 0.9, 1];
    for (let k = 0; k < angles; k++) {
      // Start around the straight line, fan out both ways.
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((Math.PI * 2) / angles);
      for (const p of powers) this.queue.push([aim + off, p]);
    }
  }

  get done(): boolean {
    return this.refined && this.queue.length === 0;
  }

  /** Runs candidates for up to `ms` milliseconds. */
  work(ms: number): void {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const next = this.queue.shift();
      if (!next) {
        if (this.refined) return;
        this.refine();
        continue;
      }
      const [angle, power] = next;
      const [vx, vz] = shotVelocity(angle, power);
      const result = simulate(this.c, this.from, vx, vz, this.t0, 9);
      const shot: Shot = { angle, power, result, cost: costOf(result, this.field, this.c, power) };
      if (!this.best || shot.cost < this.best.cost) this.best = shot;
      this.top.push(shot);
      if (this.top.length > 24) {
        this.top.sort((a, b) => a.cost - b.cost);
        this.top.length = 6;
      }
    }
  }

  /** Finishes the search right now (tests). */
  finish(): Shot {
    while (!this.done) this.work(1000);
    return this.best!;
  }

  private refine(): void {
    this.refined = true;
    this.top.sort((a, b) => a.cost - b.cost);
    for (const s of this.top.slice(0, 3)) {
      for (const da of [-0.05, -0.025, 0, 0.025, 0.05]) for (const dp of [-0.05, 0.05]) this.queue.push([s.angle + da, Math.min(1, Math.max(0.08, s.power + dp))]);
      for (const da of [-0.012, 0.012]) this.queue.push([s.angle + da, s.power]);
    }
  }
}
