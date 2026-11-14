/**
 * The dish wall: dishes laid out in layers, each pinned by two or more pegs. A peg can only be pulled while no dish on
 * a higher layer covers it, and what covers what depends on how the dishes hang: a dish down to one peg swings on it
 * and comes to rest with its weight straight below, so it may now cover pegs it didn't (or free ones it did). Every
 * one of those resting poses is worked out when the wall is laid out, and no peg ever sits within a hair of a dish's
 * edge in any of them, so "covered" is never a matter of a pixel. Pure, deterministic.
 */
import type { Rng } from "@thumbcade-games/kit/rng";
import { extent, hangPose, type Kind, massOf, type Mass, outline, PEG_R, type Pose, sdf, sdfAt, type Shape, toWorld } from "./geom.ts";

/** The wall is this many units wide and tall. */
export const WALL_W = 6;
export const WALL_H = 7;
/** Most pegs on one wall (the solver keys positions on a bit per peg). */
export const MAX_PEGS = 48;
/** A peg is either covered by at least this much or clear of every dish above by this much, in every pose. */
const MARGIN = 0.07;
/** Closest two pegs may be (centre to centre). */
const PEG_GAP = 0.72;
/** A peg's centre sits at least this far inside its own dish. */
const EDGE_IN = 0.34;
/** No peg near a dish's centre of mass: hanging from it, the dish would just balance. */
const OFF_COM = 0.45;

export interface Dish {
  id: number;
  shape: Shape;
  layer: number;
  base: Pose;
  mass: Mass;
  /** Peg ids, in the order of `hang`. */
  pegs: number[];
  /** The pose it rests in when hanging from each of its pegs. */
  hang: Pose[];
  /** Local outline (for drawing, bounds and shards). */
  out: Array<[number, number]>;
  /** Fine china: smashing it pays extra. */
  fancy: boolean;
  /** Paint (palette index) and pattern, for whoever draws it. */
  paint: number;
  pattern: number;
  /** Whether it wears a face, and where (local). */
  face: boolean;
}

export interface Peg {
  id: number;
  dish: number;
  /** Local position on its dish and the spot on the wall. */
  lx: number;
  ly: number;
  x: number;
  y: number;
  /** Colour (0..5), handed out by the dealer. */
  color: number;
}

/** One dish above a peg: does it cover the peg in its pinned pose, and hanging from each of its pegs? */
export interface CoverEntry {
  dish: number;
  base: boolean;
  hang: boolean[];
}

export interface Wall {
  dishes: Dish[];
  pegs: Peg[];
  /** For each peg, the dishes on higher layers that cover it in some pose. */
  cover: CoverEntry[][];
}

export interface Plan {
  board: number;
  /** Pegs the wall aims for (it gets the nearest multiple of three it can fit). */
  pegs: number;
  dishes: number;
  layers: number;
  colors: number;
  kinds: Kind[];
  fancy: boolean;
  /** The dealer's witness never holds more than this on the shelf. */
  witnessCap: number;
  /** How often the witness hands a peg to the shelf when it could go to a jar. */
  spread: number;
  /** Share of pegs whose colours are swapped at random after dealing (the solver must still clear it). */
  scatter: number;
  /** Dish size factor: the first walls have fewer, bigger dishes. */
  grow: number;
}

const at = <T>(xs: readonly T[], i: number): T => xs[Math.min(xs.length - 1, Math.max(0, i))]!;

/** What wall number `n` (from 1) is made of. */
export function planFor(n: number): Plan {
  const i = n - 1;
  const kinds: Kind[] = ["plate", "board"];
  if (n >= 2) kinds.push("tray");
  if (n >= 3) kinds.push("platter");
  if (n >= 4) kinds.push("wedge");
  if (n >= 5) kinds.push("pan");
  return {
    board: n,
    pegs: at([12, 13, 15, 15, 16, 17, 18], i),
    dishes: at([6, 7, 8, 9, 10, 10, 11], i),
    layers: at([2, 2, 3, 3, 3, 4, 4, 4, 4, 5], i),
    colors: at([3, 4, 5, 5, 6], i),
    kinds,
    fancy: n >= 2,
    witnessCap: at([3, 3, 4], i),
    spread: at([0.4, 0.5, 0.55, 0.6, 0.65], i),
    scatter: at([0.1, 0.2, 0.3, 0.4, 0.5], i),
    grow: at([1.25, 1.18, 1.1, 1.05, 1], i),
  };
}

function shapeFor(kind: Kind, rng: Rng, k = 1): Shape {
  const s = shapeBase(kind, rng);
  return kind === "board" ? { ...s, a: s.a * k } : { ...s, a: s.a * k, b: kind === "pan" ? s.b : s.b * k };
}

function shapeBase(kind: Kind, rng: Rng): Shape {
  switch (kind) {
    case "plate":
      return { kind, a: rng.range(0.82, 1.2), b: 0, c: 0 };
    case "board":
      return { kind, a: rng.range(0.95, 1.7), b: 0.42, c: 0 };
    case "tray":
      return { kind, a: rng.range(0.8, 1.1), b: rng.range(0.72, 1.0), c: 0.24 };
    case "platter":
      return { kind, a: rng.range(1.12, 1.48), b: rng.range(0.76, 0.94), c: 0 };
    case "wedge":
      return { kind, a: rng.range(1.32, 1.58), b: 0, c: 0.2 };
    case "pan":
      return { kind, a: rng.range(0.74, 0.9), b: rng.range(0.92, 1.15), c: 0.24 };
  }
}

function angleFor(kind: Kind, rng: Rng): number {
  switch (kind) {
    case "plate":
      return rng.range(0, Math.PI * 2);
    case "board":
      return rng.pick([0, 0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) + rng.range(-0.15, 0.15);
    case "tray":
      return rng.pick([0, 0, Math.PI / 4]) + rng.range(-0.18, 0.18);
    case "platter":
      return rng.pick([0, 0, Math.PI / 2]) + rng.range(-0.3, 0.3);
    case "wedge":
      return rng.pick([0, Math.PI]) + rng.range(-0.3, 0.3);
    case "pan":
      return rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + rng.range(-0.35, 0.35);
  }
}

/** Where pegs can go on a dish (local), most natural first. */
function pegSpots(s: Shape, rng: Rng): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  switch (s.kind) {
    case "plate": {
      const r = s.a - 0.36;
      const a0 = rng.range(0, Math.PI * 2);
      const step = rng.chance(0.5) ? (Math.PI * 2) / 3 : rng.range(2.3, Math.PI);
      // The natural spots first, then a few in between in case one of them is taken.
      for (const a of [0, step, step * 2, step / 2, step * 1.5, -step / 2]) out.push([Math.cos(a0 + a) * r, Math.sin(a0 + a) * r]);
      break;
    }
    case "board":
      out.push([-s.a, 0], [s.a, 0]);
      if (s.a > 1.2) out.push([rng.chance(0.5) ? s.a * 0.4 : -s.a * 0.4, 0]);
      break;
    case "tray": {
      const x = s.a - 0.36;
      const y = s.b - 0.36;
      const corners: Array<[number, number]> = [
        [-x, -y],
        [x, y],
        [x, -y],
        [-x, y],
      ];
      if (rng.chance(0.5)) corners.reverse();
      out.push(...corners);
      break;
    }
    case "platter":
      out.push([-(s.a - 0.4), 0], [s.a - 0.4, 0], [0, rng.chance(0.5) ? s.b - 0.36 : -(s.b - 0.36)]);
      break;
    case "wedge": {
      const r = s.a - 0.74;
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      break;
    }
    case "pan": {
      out.push([s.a + s.b - 0.3, 0]);
      const r = s.a - 0.36;
      const a0 = rng.range(2.1, 2.6);
      out.push([Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(-a0) * r, Math.sin(-a0) * r]);
      break;
    }
  }
  return out;
}

interface Placed {
  shape: Shape;
  layer: number;
  base: Pose;
  mass: Mass;
  out: Array<[number, number]>;
  /** World outline in the base pose. */
  wout: Array<[number, number]>;
  pegs: Array<{ lx: number; ly: number; x: number; y: number }>;
  hang: Pose[];
  /** Farthest the shape reaches from its origin. */
  reach: number;
}

function worldOutline(out: ReadonlyArray<[number, number]>, p: Pose): Array<[number, number]> {
  return out.map(([x, y]) => toWorld(p, x, y));
}

function inBounds(pts: ReadonlyArray<[number, number]>, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const [x, y] of pts) if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  return true;
}

/** Smallest gap between two placed dishes (negative when they overlap), from both outlines. */
function gapBetween(a: Placed, b: Placed): number {
  let g = Infinity;
  for (const [x, y] of a.wout) g = Math.min(g, sdfAt(b.shape, b.base, x, y));
  for (const [x, y] of b.wout) g = Math.min(g, sdfAt(a.shape, a.base, x, y));
  return g;
}

/** Tries to place one dish on `layer`; returns the best of a few valid candidates, or null. */
function tryPlace(kind: Kind, layer: number, placed: Placed[], rng: Rng, want: number, grow = 1): Placed | null {
  let best: Placed | null = null;
  let bestScore = -Infinity;
  let found = 0;
  const below = placed.filter((p) => p.layer === layer - 1);
  for (let tries = 0; tries < 50 && found < 3; tries++) {
    const shape = shapeFor(kind, rng, grow * (1 - 0.05 * layer));
    const th = angleFor(kind, rng);
    // Its box, turned: sample only positions that keep it on the wall.
    const e = extent(shape);
    const box = worldOutline(
      [
        [e.x0, e.y0],
        [e.x1, e.y0],
        [e.x1, e.y1],
        [e.x0, e.y1],
      ],
      { x: 0, y: 0, th },
    );
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let by0 = Infinity;
    let by1 = -Infinity;
    for (const [x, y] of box) {
      bx0 = Math.min(bx0, x);
      bx1 = Math.max(bx1, x);
      by0 = Math.min(by0, y);
      by1 = Math.max(by1, y);
    }
    const lo = [0.06 - bx0 * 0.8, 0.06 - by0 * 0.8];
    const hi = [WALL_W - 0.06 - bx1 * 0.8, WALL_H - 0.06 - by1 * 0.8];
    if (lo[0]! > hi[0]! || lo[1]! > hi[1]!) continue;
    let px = rng.range(lo[0]!, hi[0]!);
    let py = rng.range(lo[1]!, hi[1]!);
    // Upper layers mostly land on a dish below, off its centre.
    if (below.length && rng() < 0.75) {
      const d = rng.pick(below);
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.4, 1.3);
      px = Math.min(hi[0]!, Math.max(lo[0]!, d.base.x + Math.cos(a) * r));
      py = Math.min(hi[1]!, Math.max(lo[1]!, d.base.y + Math.sin(a) * r));
    }
    const base: Pose = { x: px, y: py, th };
    // Pegs first (cheap): inside the dish, off its centre of mass, apart from every other peg, on the wall.
    const mass = massOf(shape, 0.06);
    const spots = pegSpots(shape, rng);
    const pegs: Placed["pegs"] = [];
    for (const [lx, ly] of spots) {
      if (pegs.length >= want) break;
      const inside = sdf(shape, lx, ly);
      if (inside > (kind === "pan" && lx > shape.a ? -0.15 : -EDGE_IN)) continue;
      if (Math.hypot(lx - mass.cx, ly - mass.cy) < OFF_COM) continue;
      const [x, y] = toWorld(base, lx, ly);
      if (x < 0.3 || x > WALL_W - 0.3 || y < 0.3 || y > WALL_H - 0.3) continue;
      if (pegs.some((q) => Math.hypot(q.x - x, q.y - y) < PEG_GAP)) continue;
      if (placed.some((p) => p.pegs.some((q) => Math.hypot(q.x - x, q.y - y) < PEG_GAP))) continue;
      pegs.push({ lx, ly, x, y });
    }
    if (pegs.length < 2) continue;
    const out = outline(shape, 24);
    const wout = worldOutline(out, base);
    if (!inBounds(wout, 0.06, 0.06, WALL_W - 0.06, WALL_H - 0.06)) continue;
    const reachC = Math.hypot(Math.max(-e.x0, e.x1), Math.max(-e.y0, e.y1));
    const cand: Placed = { shape, layer, base, mass, out, wout, pegs: [], hang: [], reach: reachC };
    // The same layer never overlaps; a higher layer must lie on something below it.
    let ok = true;
    let onBelow = 0;
    for (const p of placed) {
      // Far apart: no need to measure.
      if (Math.hypot(p.base.x - base.x, p.base.y - base.y) > reachC + p.reach + 0.1) continue;
      const g = gapBetween(cand, p);
      if (p.layer === layer && g < 0.08) {
        ok = false;
        break;
      }
      if (p.layer === layer - 1 && g < -0.3) onBelow++;
    }
    if (!ok || (layer > 0 && onBelow === 0)) continue;
    // Hanging from any one of them it stays on the wall (a little below its foot at most).
    const hang = pegs.map((q) => hangPose(cand.mass, [q.lx, q.ly], [q.x, q.y]));
    if (!hang.every((h) => inBounds(worldOutline(out, h), -0.05, -0.3, WALL_W + 0.05, WALL_H + 0.5))) continue;
    // Over the pegs below: clearly covering them or clearly clear, pinned and in every hanging pose.
    let covers = 0;
    for (const p of placed) {
      if (p.layer >= layer) continue;
      for (const q of p.pegs) {
        for (const pose of [base, ...hang]) {
          const d = sdfAt(shape, pose, q.x, q.y) - PEG_R;
          if (Math.abs(d) < MARGIN) ok = false;
        }
        if (sdfAt(shape, base, q.x, q.y) < PEG_R) covers++;
      }
      if (!ok) break;
    }
    if (!ok) continue;
    cand.pegs = pegs;
    cand.hang = hang;
    found++;
    const score = (layer === 0 ? 0 : Math.min(covers, 3) * 2 - Math.max(0, covers - 4)) + rng() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/** How many dishes go on each layer (a little heavier at the bottom). */
function layerSizes(dishes: number, layers: number): number[] {
  const out = Array.from({ length: layers }, () => 0);
  for (let i = 0; i < dishes; i++) out[i % layers]!++;
  return out;
}

/** Runs a stepwise job to the end. */
export function drain<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** Lays out a wall for `plan`: dishes on layers, pegs in them, a peg total divisible by three. */
export function layoutWall(plan: Plan, rng: Rng): Wall {
  return drain(layoutSteps(plan, rng));
}

/** `layoutWall` in small steps (it yields after every dish), so a game can lay out the next wall between frames. */
export function* layoutSteps(plan: Plan, rng: Rng): Generator<void, Wall> {
  for (let attempt = 0; ; attempt++) {
    const placed: Placed[] = [];
    const sizes = layerSizes(plan.dishes, plan.layers);
    let total = 0;
    for (let layer = 0; layer < plan.layers; layer++) {
      for (let k = 0; k < sizes[layer]! && total < plan.pegs + 2; k++) {
        const kind = rng.pick(plan.kinds);
        const want = rng.chance(0.7) ? 3 : 2;
        const p = tryPlace(kind, layer, placed, rng, want, plan.grow) ?? (layer <= 1 ? tryPlace(rng.pick(["plate", "board"] as Kind[]), layer, placed, rng, want, plan.grow) : null);
        if (p) {
          placed.push(p);
          total += p.pegs.length;
        }
        yield;
      }
    }
    // Close enough to the plan (looser after a few tries), and at least two layers.
    if (total < plan.pegs - (attempt < 3 ? 1 : 3) || !placed.some((p) => p.layer > 0)) continue;
    // Three pegs to a jar: take pegs off dishes with three or more, top layers first, until the total divides.
    const order = placed.map((_, i) => i).sort((a, b) => placed[b]!.layer - placed[a]!.layer);
    for (const i of order) {
      const p = placed[i]!;
      while (total % 3 !== 0 && p.pegs.length > 2) {
        p.pegs.pop();
        p.hang.pop();
        total--;
      }
    }
    if (total % 3 !== 0 || total > MAX_PEGS || total < 9) continue;
    return buildWall(placed, plan, rng);
  }
}

/** A face needs its middle free of pegs (a peg between the eyes reads as a nose). */
function faceClear(p: Placed): boolean {
  const r = p.shape.kind === "wedge" ? p.shape.a * 0.3 : Math.min(p.shape.a, p.shape.b || p.shape.a) * 0.5;
  return p.pegs.every((q) => Math.hypot(q.lx, q.ly) > r + PEG_R + 0.08);
}

function buildWall(placed: Placed[], plan: Plan, rng: Rng): Wall {
  const dishes: Dish[] = [];
  const pegs: Peg[] = [];
  placed.forEach((p, id) => {
    const ids: number[] = [];
    for (const q of p.pegs) {
      ids.push(pegs.length);
      pegs.push({ id: pegs.length, dish: id, lx: q.lx, ly: q.ly, x: q.x, y: q.y, color: 0 });
    }
    dishes.push({
      id,
      shape: p.shape,
      layer: p.layer,
      base: p.base,
      mass: p.mass,
      pegs: ids,
      hang: p.hang,
      out: p.out,
      fancy: false,
      paint: rng.int(0, 5),
      pattern: rng.int(0, 3),
      face: p.shape.kind !== "board" && rng.chance(0.65) && faceClear(p),
    });
  });
  if (plan.fancy && dishes.length) {
    const plates = dishes.filter((d) => d.shape.kind === "plate" || d.shape.kind === "platter");
    const pick = plates.length ? rng.pick(plates) : rng.pick(dishes);
    pick.fancy = true;
  }
  return { dishes, pegs, cover: coverTable(dishes, pegs) };
}

/** For every peg, each dish above it that covers it in any of its poses. */
export function coverTable(dishes: readonly Dish[], pegs: readonly Peg[]): CoverEntry[][] {
  return pegs.map((q) => {
    const own = dishes[q.dish]!;
    const out: CoverEntry[] = [];
    for (const d of dishes) {
      if (d.layer <= own.layer) continue;
      const base = sdfAt(d.shape, d.base, q.x, q.y) < PEG_R;
      const hang = d.hang.map((h) => sdfAt(d.shape, h, q.x, q.y) < PEG_R);
      if (base || hang.some(Boolean)) out.push({ dish: d.id, base, hang });
    }
    return out;
  });
}

/** Pegs still in each dish, given which pegs are still in the wall. */
export function pegsLeft(wall: Wall, left: ArrayLike<number>, dish: number): number {
  let n = 0;
  for (const id of wall.dishes[dish]!.pegs) if (left[id]) n++;
  return n;
}

/**
 * Whether peg `id` is covered when the dishes rest where they rest (pinned with two or more pegs, hanging from the
 * last one, gone with none). This is the rule the dealer and the solver use; in play the swinging pose decides.
 */
export function coveredAtRest(wall: Wall, left: ArrayLike<number>, id: number): boolean {
  for (const e of wall.cover[id]!) {
    const d = wall.dishes[e.dish]!;
    let n = 0;
    let last = -1;
    for (let k = 0; k < d.pegs.length; k++)
      if (left[d.pegs[k]!]) {
        n++;
        last = k;
      }
    if (n === 0) continue;
    if (n >= 2 ? e.base : e.hang[last]!) return true;
  }
  return false;
}

/** Pegs that can be pulled now (resting poses). */
export function freePegs(wall: Wall, left: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < wall.pegs.length; i++) if (left[i] && !coveredAtRest(wall, left, i)) out.push(i);
  return out;
}
