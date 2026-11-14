/**
 * The hill the cat climbs: an endless strip of rows, eight columns wide, generated as it is needed.
 *
 * Rows are either safe ground (`path`: garden beds, cobbles, peat, orchard grass, with a few things in the way) or a
 * lane: enchanted brooms sweeping across, rolling jack-o'-lanterns, runaway yarn, drifting will-o'-wisps (all of them
 * bump the cat), the brook (water: the cat rides paper boats across) or the bog (the cat stands only on toadstools,
 * which bloom and sink on a rhythm). Every 25 rows the scenery changes: the pumpkin patch, the night market, the wisp
 * bog, the moon orchard, and round again a little harder.
 *
 * Everything that moves is a pure function of time: a lane is a loop of movers sliding at one speed, so the pilot,
 * the tests and the screen all see the same thing at the same moment. Pure and deterministic for a seed.
 */
import { createRng, type Rng } from "@thumbcade-games/kit/rng";

export const COLS = 8;
/** One cell, in art px (and sim units). */
export const CELL = 14;
/** Field width: the columns the cat can stand in. */
export const FW = COLS * CELL;
/** Movers loop from LEFT to LEFT + period, which always reaches past the widest screen's margins. */
export const LEFT = -100;
export const MIN_PERIOD = FW + 152;
/** Rows per stretch of scenery. */
export const STRETCH = 25;

export type Kind = "path" | "broom" | "pumpkin" | "yarn" | "wisp" | "brook" | "bog";
export type Hazard = "broom" | "pumpkin" | "yarn" | "wisp";
export const HAZARDS: readonly Kind[] = ["broom", "pumpkin", "yarn", "wisp"];
export const isHazard = (k: Kind): k is Hazard => k === "broom" || k === "pumpkin" || k === "yarn" || k === "wisp";

export interface Biome {
  id: "garden" | "market" | "bog" | "orchard";
  /** The sign over the arch. */
  name: string;
}
export const BIOMES: readonly Biome[] = [
  { id: "garden", name: "the pumpkin patch" },
  { id: "market", name: "the night market" },
  { id: "bog", name: "the wisp bog" },
  { id: "orchard", name: "the moon orchard" },
];

export interface Mover {
  /** Offset along the loop (px). */
  off: number;
  /** Length (px). */
  len: number;
  /** Sprite variant. */
  v: number;
}

export interface Toad {
  col: number;
  /** Seconds into its cycle at t = 0. */
  phase: number;
}

export interface Pickup {
  col: number;
  gold: boolean;
  /** On a boat: the mover's index (the fish rides along); otherwise sits in its cell. */
  mover: number;
}

export interface Row {
  i: number;
  kind: Kind;
  /** Stretch index (0, 1, 2, ...); the biome is `stretch % 4`. */
  stretch: number;
  dir: 1 | -1;
  /** px/s. */
  speed: number;
  /** Loop length (px). */
  period: number;
  movers: Mover[];
  /** Path rows: an obstacle per column (-1 = free, else its sprite variant). */
  block: number[];
  toads: Toad[];
  /** Bog rows: seconds of a toadstool's cycle, and how long of it the cap is up. */
  cycle: number;
  up: number;
  pickup: Pickup | null;
  /** The first row of a stretch: an arch with the stretch's name. */
  arch: boolean;
  /** Milestone post (every 10 rows) on this path row, or 0. */
  post: number;
  /** Ground texture variant. */
  look: number;
}

export const biomeOf = (row: Row): Biome => BIOMES[row.stretch % BIOMES.length]!;
export const colX = (c: number): number => c * CELL + CELL / 2;
export const colOf = (x: number): number => Math.max(0, Math.min(COLS - 1, Math.round((x - CELL / 2) / CELL)));

/** Hitbox inset (px) per hazard: the drawn sprite is a little bigger than what bumps you. */
export const HIT_INSET: Record<Hazard, number> = { broom: 3, pumpkin: 2, yarn: 1.5, wisp: 2 };
/** Toadstool cycle: the cap wobbles this long before it sinks, and takes this long to sink or rise. */
export const WOBBLE = 0.7;

const wrap = (a: number, p: number): number => ((a % p) + p) % p;

/** Left edge of a mover at time t (px, field coords). */
export function moverX(row: Row, m: Mover, t: number): number {
  let x = LEFT + wrap(m.off + row.dir * row.speed * t, row.period);
  if (row.kind === "wisp") x += Math.sin(t * 1.6 + m.off * 0.37) * 5;
  return x;
}

/** Hitbox [x0, x1] of a hazard mover at time t. */
export function hitbox(row: Row, m: Mover, t: number): [number, number] {
  const x = moverX(row, m, t);
  const inset = isHazard(row.kind) ? HIT_INSET[row.kind] : 0;
  return [x + inset, x + m.len - inset];
}

/** 0..1 through the toadstool's cycle, and whether its cap is up (safe). */
export function toadState(row: Row, toad: Toad, t: number): { k: number; up: boolean; wobble: boolean; sink: number } {
  const k = wrap(t + toad.phase, row.cycle);
  const up = k < row.up;
  const wobble = up && k > row.up - WOBBLE;
  // 0 = fully up, 1 = fully under (eased over 0.25 s either side of the change).
  const sink = up ? Math.max(0, (k - (row.up - 0.25)) / 0.25) : k > row.cycle - 0.25 ? (row.cycle - k) / 0.25 : 1;
  return { k, up, wobble, sink: Math.min(1, sink) };
}

export const toadAt = (row: Row, col: number): Toad | undefined => row.toads.find((t) => t.col === col);

/** Difficulty 0..1 by row index (a second lap round the scenery keeps getting harder through the speeds). */
export function difficulty(i: number): number {
  return Math.max(0, Math.min(1, (i - 5) / 95));
}

/** Speed multiplier past the first lap. */
const lapBoost = (i: number): number => 1 + Math.max(0, i - 100) / 220;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface GroupPlan {
  cls: "street" | "water" | "bog";
  left: number;
}

/** Lane mixes per biome: which street hazards, and how often a group is water or bog instead. */
const POOLS: Record<Biome["id"], { street: Array<[Hazard, number]>; water: number; bog: number }> = {
  garden: { street: [["pumpkin", 3], ["broom", 2]], water: 0.3, bog: 0 },
  market: { street: [["broom", 3], ["yarn", 2.2], ["pumpkin", 0.8]], water: 0.2, bog: 0 },
  bog: { street: [["wisp", 3], ["broom", 1]], water: 0.22, bog: 0.38 },
  orchard: { street: [["pumpkin", 2], ["broom", 2], ["wisp", 1.4], ["yarn", 1]], water: 0.25, bog: 0.12 },
};

export class World {
  private readonly rng: Rng;
  private rows: Row[] = [];
  /** Index of rows[0]. */
  private base = 0;
  private group: GroupPlan | null = null;
  private safeLeft = 0;
  private nextFish = 7;
  private nextGold = 32;
  private nextPost = 10;

  constructor(readonly seed: number) {
    this.rng = createRng(seed ^ 0x9177e2);
  }

  /** The row at index i (generating up to it). Rows far behind are pruned with `forget`. */
  row(i: number): Row {
    if (i < this.base) i = this.base;
    while (this.base + this.rows.length <= i) this.rows.push(this.make(this.base + this.rows.length));
    return this.rows[i - this.base]!;
  }

  /** Drops rows below `i` (they can never be seen again). */
  forget(i: number): void {
    // The newest row always stays: the next one is made against it.
    const n = Math.min(this.rows.length - 1, Math.max(0, i - this.base));
    if (n > 0) {
      this.rows.splice(0, n);
      this.base += n;
    }
  }

  get firstKept(): number {
    return this.base;
  }

  private make(i: number): Row {
    const r = this.rng;
    const stretch = Math.floor(i / STRETCH);
    const biome = BIOMES[stretch % BIOMES.length]!.id;
    const d = difficulty(i);
    const row: Row = { i, kind: "path", stretch, dir: 1, speed: 0, period: MIN_PERIOD, movers: [], block: Array(COLS).fill(-1), toads: [], cycle: 4, up: 2.6, pickup: null, arch: false, post: 0, look: r.int(0, 3) };
    const prev = i > 0 ? this.row(i - 1) : null;

    // The doorstep (rows 0-3) is safe; every stretch opens on its arch; groups of lanes alternate with safe strips.
    let kind: Kind;
    if (i < 4) kind = "path";
    else if (i % STRETCH === 0) {
      kind = "path";
      row.arch = true;
      this.group = null;
      this.safeLeft = 1;
    } else if (this.group && this.group.left > 0) {
      kind = this.laneOf(this.group.cls, biome, d, prev);
      this.group.left--;
      if (this.group.left === 0) {
        this.group = null;
        this.safeLeft = d < 0.25 ? 2 : r.chance(lerp(0.35, 0.75, d)) ? 1 : 2;
      }
    } else if (this.safeLeft > 0) {
      kind = "path";
      this.safeLeft--;
    } else {
      // A new group of lanes.
      const pool = POOLS[biome];
      const roll = r();
      const cls: GroupPlan["cls"] = roll < pool.bog ? "bog" : roll < pool.bog + pool.water ? "water" : "street";
      const max = d < 0.15 ? 2 : d < 0.4 ? 3 : 4;
      const min = d < 0.4 ? 1 : 2;
      let size = r.int(min, max);
      if (cls === "bog") size = Math.min(size, 2);
      if (cls === "water") size = Math.min(size, d < 0.3 ? 2 : 3);
      // Never run a group across the next arch.
      size = Math.min(size, STRETCH - (i % STRETCH) - 1);
      if (size > 0) {
        this.group = { cls, left: size };
        return this.make(i);
      }
      kind = "path";
    }
    row.kind = kind;
    this.fill(row, biome, d, prev);
    return row;
  }

  private laneOf(cls: GroupPlan["cls"], biome: Biome["id"], d: number, prev: Row | null): Kind {
    if (cls === "water") return "brook";
    if (cls === "bog") return "bog";
    const pool = POOLS[biome].street;
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let x = this.rng() * total;
    for (const [k, w] of pool) {
      x -= w;
      if (x <= 0) {
        // Wisps are slow: never two wisp lanes in a row early on (they read as one blob).
        if (k === "wisp" && prev?.kind === "wisp" && d < 0.5) return pool[0]![0] === "wisp" ? "broom" : pool[0]![0];
        return k;
      }
    }
    return pool[0]![0];
  }

  private fill(row: Row, biome: Biome["id"], d: number, prev: Row | null): void {
    const r = this.rng;
    const boost = lapBoost(row.i);
    if (row.kind === "path") {
      this.obstacles(row, d, prev);
    } else if (isHazard(row.kind)) {
      // Alternate directions lane to lane: two fast lanes going the same way at nearly the same speed would line their
      // gaps up only every half minute. Slow ones (pumpkins, wisps) may now and then go the same way.
      const fast = row.kind === "broom" || row.kind === "yarn";
      const prevFast = prev?.kind === "broom" || prev?.kind === "yarn";
      const dir: 1 | -1 = prev && isHazard(prev.kind) ? (fast || prevFast || r.chance(0.8) ? (-prev.dir as 1 | -1) : prev.dir) : r.chance(0.5) ? 1 : -1;
      row.dir = dir;
      const base = { broom: [30, 62], pumpkin: [18, 36], yarn: [36, 66], wisp: [11, 21] }[row.kind];
      row.speed = lerp(base[0]!, base[1]!, d) * r.range(0.88, 1.12) * boost;
      this.loop(row, d);
    } else if (row.kind === "brook") {
      const dir: 1 | -1 = prev?.kind === "brook" ? (-prev.dir as 1 | -1) : r.chance(0.5) ? 1 : -1;
      row.dir = dir;
      row.speed = lerp(13, 25, d) * r.range(0.85, 1.15) * Math.min(1.35, boost);
      this.boats(row, d);
    } else {
      // Bog: a toadstool in every column, rising and sinking in a wave that runs along the lane, so whenever one
      // sinks, its neighbour on one side stays up a moment longer: the cat can always surf the wave sideways.
      row.cycle = r.range(3.6, 4.4);
      row.up = row.cycle * lerp(0.72, 0.56, d);
      row.dir = r.chance(0.5) ? 1 : -1;
      const step = row.cycle / COLS;
      const offs = r.range(0, row.cycle);
      row.toads = Array.from({ length: COLS }, (_, col) => ({ col, phase: wrap(offs + row.dir * col * step, row.cycle) }));
    }
    this.pickups(row, d);
    if (row.kind === "path" && !row.arch && row.i >= this.nextPost) {
      row.post = Math.floor(row.i / 10) * 10;
      this.nextPost = row.post + 10;
    }
    void biome;
  }

  /** Static things on safe ground. Never two side by side, and never a dead end against the row before. */
  private obstacles(row: Row, d: number, prev: Row | null): void {
    const r = this.rng;
    if (row.i < 3 || row.arch) return;
    const n = r.int(0, d < 0.2 ? 1 : d < 0.6 ? 2 : 3);
    // Off a toadstool the cat goes straight up: keep the cells above them clear. Boats carry the cat to the edges of the
    // hill: keep the outer cells above a brook clear.
    const keep = new Set(prev?.kind === "bog" ? prev.toads.map((t) => t.col) : prev?.kind === "brook" ? [0, COLS - 1] : []);
    const cols = r.shuffle([...Array(COLS).keys()]);
    let placed = 0;
    for (const c of cols) {
      if (placed >= n) break;
      if (keep.has(c)) continue;
      if (row.block[c - 1] !== undefined && row.block[c - 1]! >= 0) continue;
      if (row.block[c + 1] !== undefined && row.block[c + 1]! >= 0) continue;
      row.block[c] = r.int(0, 2);
      if (prev && !this.connected(prev, row)) row.block[c] = -1;
      else placed++;
    }
  }

  /** From every free cell of `a`, some free cell of `b` straight above is reachable by side steps along `a`. */
  connected(a: Row, b: Row): boolean {
    if (a.kind !== "path") return b.block.some((x) => x < 0);
    let c = 0;
    while (c < COLS) {
      if (a.block[c]! >= 0) {
        c++;
        continue;
      }
      let ok = false;
      let e = c;
      for (; e < COLS && a.block[e]! < 0; e++) if (b.block[e]! < 0) ok = true;
      if (!ok) return false;
      c = e;
    }
    return true;
  }

  /** A loop of hazards with gaps the cat always fits through. */
  private loop(row: Row, d: number): void {
    const r = this.rng;
    const kind = row.kind as Hazard;
    // The narrowest gap still leaves 0.55 s (0.45 s late on) for the cat to stand in it, plus its own width.
    const window = lerp(0.62, 0.45, d);
    const gmin = Math.max(CELL + 6 + row.speed * window, lerp(48, 30, d));
    const gmax = Math.max(gmin + 10, lerp(120, 64, d));
    const movers: Mover[] = [];
    let at = r.range(0, 30);
    while (at < MIN_PERIOD) {
      let len: number;
      let v: number;
      if (kind === "broom") {
        len = 26;
        v = r.int(0, 2);
      } else if (kind === "pumpkin") {
        const big = r.chance(lerp(0.15, 0.4, d));
        len = big ? 15 : 12;
        v = big ? 1 : 0;
      } else if (kind === "yarn") {
        len = 9;
        v = r.int(0, 2);
      } else {
        len = 10;
        v = r.int(0, 1);
      }
      movers.push({ off: at, len, v });
      // Pumpkins and yarn come in little runs now and then.
      const run = (kind === "pumpkin" || kind === "yarn") && r.chance(lerp(0.15, 0.45, d));
      at += len + (run ? r.range(4, 7) : r.range(gmin, gmax));
    }
    row.movers = movers;
    row.period = Math.max(MIN_PERIOD, at);
    // The last gap (across the loop seam) must also be a real gap.
    const last = movers[movers.length - 1]!;
    const seam = row.period - (last.off + last.len) + movers[0]!.off;
    if (seam < gmin) row.period += gmin - seam;
  }

  /** Paper boats on the brook: two or three cells long, with water between them. */
  private boats(row: Row, d: number): void {
    const r = this.rng;
    const movers: Mover[] = [];
    let at = r.range(0, 20);
    while (at < MIN_PERIOD) {
      const long = r.chance(lerp(0.65, 0.35, d));
      const len = long ? CELL * 3 : CELL * 2;
      movers.push({ off: at, len, v: long ? 1 : 0 });
      at += len + r.range(lerp(16, 24, d), lerp(34, 50, d));
    }
    row.movers = movers;
    row.period = Math.max(MIN_PERIOD, at);
  }

  /** Fish now and then, worth a detour; a golden moonfish rarely, somewhere brave. */
  private pickups(row: Row, d: number): void {
    const r = this.rng;
    if (row.i < this.nextFish || row.arch || row.i < 4) return;
    const gold = row.i >= this.nextGold;
    // Gold only goes somewhere brave: a lane or a boat.
    if (gold && row.kind === "path") return;
    if (row.kind === "path") {
      const free = [...Array(COLS).keys()].filter((c) => row.block[c]! < 0);
      row.pickup = { col: r.pick(free), gold: false, mover: -1 };
    } else if (row.kind === "brook") {
      row.pickup = { col: -1, gold, mover: r.int(0, row.movers.length - 1) };
    } else if (row.kind === "bog") {
      row.pickup = { col: r.pick(row.toads).col, gold, mover: -1 };
    } else {
      row.pickup = { col: r.int(0, COLS - 1), gold, mover: -1 };
    }
    if (gold) this.nextGold = row.i + r.int(30, 42);
    this.nextFish = row.i + r.int(4, Math.round(lerp(6, 8, d)));
  }
}

/** Runs of free columns on a path row. */
export function segments(row: Row): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (row.block[c]! < 0) cur.push(c);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Half the width of what of the cat a hazard can bump. */
export const CAT_HALF = 4;

/** True when a hazard in this lane overlaps the cat's box at x (grown by `margin` px) at time t. */
export function laneHit(row: Row, x: number, t: number, margin = 0): boolean {
  for (const m of row.movers) {
    const [a, b] = hitbox(row, m, t);
    if (a < x + CAT_HALF + margin && b > x - CAT_HALF - margin) return true;
  }
  return false;
}

/** The boat under x at time t (with `slack` px of grace at its ends), or -1. */
export function boatAt(row: Row, x: number, t: number, slack = 1): number {
  for (let k = 0; k < row.movers.length; k++) {
    const m = row.movers[k]!;
    const bx = moverX(row, m, t);
    if (x >= bx - slack && x <= bx + m.len + slack) return k;
  }
  return -1;
}

/** True when the toadstool in this column has its cap up at time t. */
export function toadUp(row: Row, col: number, t: number): boolean {
  const toad = toadAt(row, col);
  return toad !== undefined && toadState(row, toad, t).up;
}

/** True when a free path cell, a toadstool, a boat or an open lane cell is directly reachable at all (for tests). */
export function standable(row: Row, col: number): boolean {
  if (row.kind === "path") return row.block[col]! < 0;
  if (row.kind === "bog") return toadAt(row, col) !== undefined;
  return true;
}
