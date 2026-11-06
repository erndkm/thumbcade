/**
 * Clackwood's table, physics and rules, pure (no DOM, no Three.js), so the game, the attract pilot, the tests and
 * the headless run-length script share one source of truth.
 *
 * The table is a 2D plane: x to the right, z toward the player (down the screen). The cloth spans
 * |x| < HW, |z| < HL; cushion noses run along its edges, broken by six pocket mouths with angled jaws.
 *
 * A shot is simulated to its end the moment the cue strikes (balls, cushions, jaws, blockers, pockets), at a fixed
 * 480 Hz, and recorded at 60 Hz for the game to play back. Every shot is deterministic, the game knows each pot
 * before the ball gets there, and playback can run faster once everything has slowed down.
 */
import { clamp } from "@thumbcade-games/kit/ease";
import { createRng } from "@thumbcade-games/kit/rng";

// ---------------------------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------------------------
export const HW = 2.5;
export const HL = 4.5;
export const R = 0.17;
/** Corner mouths: the cushions stop this far from each corner. Side mouths: half-width of the gap. */
const CORNER_M = 0.5;
const SIDE_S = 0.38;
/** Where the cue ball comes back to: the head spot, on the player's half. */
export const HEAD = { x: 0, z: HL * 0.5 };
export const FOOT = { x: 0, z: -HL * 0.5 };

export interface Vec {
  x: number;
  z: number;
}

export interface Pocket extends Vec {
  /** A ball whose centre comes this close is down. */
  r: number;
  corner: boolean;
}

export const POCKETS: Pocket[] = [
  { x: -HW - 0.12, z: -HL - 0.12, r: 0.33, corner: true },
  { x: HW + 0.12, z: -HL - 0.12, r: 0.33, corner: true },
  { x: -HW - 0.2, z: 0, r: 0.3, corner: false },
  { x: HW + 0.2, z: 0, r: 0.3, corner: false },
  { x: -HW - 0.12, z: HL + 0.12, r: 0.33, corner: true },
  { x: HW + 0.12, z: HL + 0.12, r: 0.33, corner: true },
];

/** Where to send a ball into each pocket (just inside the mouth), for aiming. */
export const POCKET_AIM: Vec[] = POCKETS.map((p) => (p.corner ? { x: Math.sign(p.x) * (HW - 0.06), z: Math.sign(p.z) * (HL - 0.06) } : { x: Math.sign(p.x) * (HW + 0.02), z: 0 }));

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** A pocket jaw (a rattle off one doesn't make a bank). */
  jaw?: boolean;
}

function buildCushions(): Segment[] {
  const s: Segment[] = [];
  const m = CORNER_M;
  for (const sx of [-1, 1]) {
    // Long rails, in two halves around the side pocket, with jaws into it and into the corners.
    s.push({ ax: sx * HW, az: -(HL - m), bx: sx * HW, bz: -SIDE_S });
    s.push({ ax: sx * HW, az: SIDE_S, bx: sx * HW, bz: HL - m });
    s.push({ ax: sx * HW, az: -SIDE_S, bx: sx * (HW + 0.26), bz: -SIDE_S + 0.07, jaw: true });
    s.push({ ax: sx * HW, az: SIDE_S, bx: sx * (HW + 0.26), bz: SIDE_S - 0.07, jaw: true });
    for (const sz of [-1, 1]) {
      s.push({ ax: sx * HW, az: sz * (HL - m), bx: sx * (HW + 0.26), bz: sz * (HL - m + 0.26), jaw: true });
      s.push({ ax: sx * (HW - m), az: sz * HL, bx: sx * (HW - m + 0.26), bz: sz * (HL + 0.26), jaw: true });
    }
  }
  // Short rails.
  for (const sz of [-1, 1]) s.push({ ax: -(HW - m), az: sz * HL, bx: HW - m, bz: sz * HL });
  return s;
}
export const CUSHIONS: Segment[] = buildCushions();

export interface Blocker extends Vec {
  r: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Balls and their simulation
// ---------------------------------------------------------------------------------------------------------------
export const MAX_BALLS = 13;
/** Cue speed range (units/s): a feather tap to a full break. */
export const V_MIN = 1.1;
export const V_MAX = 12.5;
export const speedFor = (power: number): number => V_MIN + (V_MAX - V_MIN) * clamp(power) ** 1.55;
export const powerFor = (v: number): number => clamp((v - V_MIN) / (V_MAX - V_MIN)) ** (1 / 1.55);

const STEP = 1 / 480;
const FRAME_HZ = 60;
export const FRAME_DT = 1 / FRAME_HZ;
export const MAX_SHOT_T = 12;
/** Rolling resistance (units/s²) plus a little speed-proportional drag. */
export const ROLL_A = 2.05;
const ROLL_D = 0.1;
const STOP_V = 0.035;
export const E_BALL = 0.95;
const E_CUSHION = 0.76;
const E_BLOCKER = 0.6;

export interface Ball {
  /** 0 = cue ball, 1.. = object balls by number. */
  n: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** -1 on the table, else the pocket it fell in. */
  pocket: number;
}

export interface Table {
  balls: Ball[];
  blockers: Blocker[];
}

export const cloneTable = (t: Table): Table => ({ balls: t.balls.map((b) => ({ ...b })), blockers: t.blockers.map((b) => ({ ...b })) });

export type ShotEventKind = "clack" | "cushion" | "blocker" | "pot";
export interface ShotEvent {
  t: number;
  kind: ShotEventKind;
  /** Ball index (into table.balls) and, for clacks, the other ball. */
  a: number;
  b: number;
  x: number;
  z: number;
  power: number;
}

export interface Pot {
  /** Index into table.balls. */
  i: number;
  n: number;
  pocket: number;
  t: number;
  /** Bounced off a cushion on its way (a bank). */
  bank: boolean;
  /** Was put in by another object ball (a combination). */
  combo: boolean;
  /** Travelled a long way. */
  long: boolean;
}

export interface Shot {
  /** Positions per recorded frame: [x, z] per ball. */
  frames: Float32Array;
  nFrames: number;
  nBalls: number;
  /** Fastest ball per frame (for the playback speed-up). */
  maxSpeed: Float32Array;
  events: ShotEvent[];
  pots: Pot[];
  scratch: boolean;
  /** The first object ball the cue ball touched (index), -1 = none. */
  first: number;
  /** The cue ball hit a cushion before its first contact (a kick). */
  kick: boolean;
  /** Seconds of simulated time until everything stopped. */
  end: number;
  /** The table after the shot (potted balls keep their pocket index). */
  after: Table;
}

export function newShotBuffer(): { frames: Float32Array; maxSpeed: Float32Array } {
  const n = Math.ceil(MAX_SHOT_T * FRAME_HZ) + 2;
  return { frames: new Float32Array(n * MAX_BALLS * 2), maxSpeed: new Float32Array(n) };
}

/** Distance from point p to segment ab, and the closest point. */
function closest(s: Segment, px: number, pz: number, out: { x: number; z: number }): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - s.ax) * dx + (pz - s.az) * dz) / l2) : 0;
  out.x = s.ax + dx * t;
  out.z = s.az + dz * t;
  return Math.hypot(px - out.x, pz - out.z);
}

const CP = { x: 0, z: 0 };

/** Plays a shot to the end: the cue ball leaves at `angle` (radians, 0 = +x, π/2 = +z) and `speed`. */
export function simulateShot(table: Table, angle: number, speed: number, buf = newShotBuffer()): Shot {
  const t = cloneTable(table);
  const balls = t.balls;
  const N = balls.length;
  const cue = balls[0]!;
  cue.vx = Math.cos(angle) * speed;
  cue.vz = Math.sin(angle) * speed;
  const events: ShotEvent[] = [];
  const pots: Pot[] = [];
  const cushionHits = new Int32Array(N);
  const hitByCue = new Uint8Array(N);
  const travel = new Float64Array(N);
  const lastClack = new Float64Array(N * N).fill(-1);
  let first = -1;
  let kick = false;
  let cueCushions = 0;
  let scratch = false;
  let time = 0;
  let nFrames = 0;
  const { frames, maxSpeed } = buf;
  const record = () => {
    if (nFrames * N * 2 + N * 2 > frames.length) return;
    let ms = 0;
    for (let i = 0; i < N; i++) {
      const b = balls[i]!;
      frames[(nFrames * N + i) * 2] = b.x;
      frames[(nFrames * N + i) * 2 + 1] = b.z;
      if (b.pocket < 0) ms = Math.max(ms, Math.hypot(b.vx, b.vz));
    }
    maxSpeed[nFrames] = ms;
    nFrames++;
  };
  record();
  let nextFrame = FRAME_DT;
  let still = 0;
  while (time < MAX_SHOT_T) {
    time += STEP;
    let anyMoving = false;
    for (let i = 0; i < N; i++) {
      const b = balls[i]!;
      if (b.pocket >= 0) continue;
      const v = Math.hypot(b.vx, b.vz);
      if (v <= 0) continue;
      const nv = Math.max(0, v - ROLL_A * STEP) * (1 - ROLL_D * STEP);
      if (nv < STOP_V) {
        b.vx = b.vz = 0;
        continue;
      }
      anyMoving = true;
      b.vx *= nv / v;
      b.vz *= nv / v;
      b.x += b.vx * STEP;
      b.z += b.vz * STEP;
      travel[i]! += nv * STEP;
    }
    // Ball against ball.
    for (let i = 0; i < N; i++) {
      const a = balls[i]!;
      if (a.pocket >= 0) continue;
      for (let j = i + 1; j < N; j++) {
        const b = balls[j]!;
        if (b.pocket >= 0) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= 4 * R * R || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const pen = 2 * R - d;
        a.x -= nx * pen * 0.5;
        a.z -= nz * pen * 0.5;
        b.x += nx * pen * 0.5;
        b.z += nz * pen * 0.5;
        const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
        if (vn <= 0) continue;
        const jn = ((1 + E_BALL) / 2) * vn;
        a.vx -= jn * nx;
        a.vz -= jn * nz;
        b.vx += jn * nx;
        b.vz += jn * nz;
        const key = i * N + j;
        if (time - lastClack[key]! > 0.05) events.push({ t: time, kind: "clack", a: i, b: j, x: a.x + nx * R, z: a.z + nz * R, power: vn });
        lastClack[key] = time;
        if (i === 0) {
          if (first < 0) {
            first = j;
            kick = cueCushions > 0;
          }
          hitByCue[j] = 1;
        }
      }
    }
    // Cushions and jaws, then blockers.
    for (let i = 0; i < N; i++) {
      const b = balls[i]!;
      if (b.pocket >= 0) continue;
      // Only near the edges can a ball touch a cushion.
      if (Math.abs(b.x) > HW - R - 0.02 || Math.abs(b.z) > HL - R - 0.02) {
        for (const s of CUSHIONS) {
          const d = closest(s, b.x, b.z, CP);
          if (d >= R || d < 1e-9) continue;
          const nx = (b.x - CP.x) / d;
          const nz = (b.z - CP.z) / d;
          b.x = CP.x + nx * R;
          b.z = CP.z + nz * R;
          const vn = b.vx * nx + b.vz * nz;
          if (vn >= 0) continue;
          b.vx -= (1 + E_CUSHION) * vn * nx;
          b.vz -= (1 + E_CUSHION) * vn * nz;
          // A little grip along the cushion.
          const tx = -nz;
          const tz = nx;
          const vt = b.vx * tx + b.vz * tz;
          b.vx -= vt * tx * 0.04;
          b.vz -= vt * tz * 0.04;
          if (!s.jaw) {
            cushionHits[i]!++;
            if (i === 0 && first < 0) cueCushions++;
          }
          if (-vn > 0.25) events.push({ t: time, kind: "cushion", a: i, b: -1, x: CP.x, z: CP.z, power: -vn });
        }
      }
      for (const k of t.blockers) {
        const dx = b.x - k.x;
        const dz = b.z - k.z;
        const d = Math.hypot(dx, dz);
        if (d >= R + k.r || d < 1e-9) continue;
        const nx = dx / d;
        const nz = dz / d;
        b.x = k.x + nx * (R + k.r);
        b.z = k.z + nz * (R + k.r);
        const vn = b.vx * nx + b.vz * nz;
        if (vn >= 0) continue;
        b.vx -= (1 + E_BLOCKER) * vn * nx;
        b.vz -= (1 + E_BLOCKER) * vn * nz;
        cushionHits[i]!++;
        if (i === 0 && first < 0) cueCushions++;
        if (-vn > 0.25) events.push({ t: time, kind: "blocker", a: i, b: -1, x: b.x - nx * R, z: b.z - nz * R, power: -vn });
      }
      // Pockets (and a safety net: anything off the cloth beyond the cushions has gone down the nearest one).
      let into = -1;
      for (let p = 0; p < POCKETS.length; p++) {
        const pk = POCKETS[p]!;
        if (Math.hypot(b.x - pk.x, b.z - pk.z) < pk.r) into = p;
      }
      if (into < 0 && (Math.abs(b.x) > HW + 0.3 || Math.abs(b.z) > HL + 0.3)) {
        let bestD = Infinity;
        POCKETS.forEach((pk, p) => {
          const d = Math.hypot(b.x - pk.x, b.z - pk.z);
          if (d < bestD) {
            bestD = d;
            into = p;
          }
        });
      }
      if (into >= 0) {
        b.pocket = into;
        const speed = Math.hypot(b.vx, b.vz);
        b.vx = b.vz = 0;
        events.push({ t: time, kind: "pot", a: i, b: into, x: POCKETS[into]!.x, z: POCKETS[into]!.z, power: speed });
        if (i === 0) scratch = true;
        else pots.push({ i, n: b.n, pocket: into, t: time, bank: cushionHits[i]! > 0, combo: !hitByCue[i], long: travel[i]! > 4.2 });
      }
    }
    while (time >= nextFrame) {
      record();
      nextFrame += FRAME_DT;
    }
    if (!anyMoving) {
      still += STEP;
      if (still > 0.05) break;
    } else still = 0;
  }
  record();
  return { frames, nFrames, nBalls: N, maxSpeed, events, pots, scratch, first, kick, end: time, after: t };
}

/** Ball i's position at time t of a recorded shot. */
export function sampleShot(s: Shot, i: number, t: number, out: Vec): Vec {
  const f = clamp(t / FRAME_DT, 0, s.nFrames - 1);
  const k = Math.min(s.nFrames - 2, Math.floor(f));
  const u = f - k;
  const N = s.nBalls;
  const o0 = (k * N + i) * 2;
  const o1 = ((k + 1) * N + i) * 2;
  out.x = s.frames[o0]! + (s.frames[o1]! - s.frames[o0]!) * u;
  out.z = s.frames[o0 + 1]! + (s.frames[o1 + 1]! - s.frames[o0 + 1]!) * u;
  return out;
}

/** Playback rate once things slow down: full speed while anything moves fast, up to 3× when it's all crawling. */
export function playbackRate(maxSpeed: number): number {
  if (maxSpeed >= 1.6) return 1;
  if (maxSpeed <= 0.6) return 3;
  return 1 + (2 * (1.6 - maxSpeed)) / 1.0;
}

/** Real seconds a shot takes to watch, with the speed-up. */
export function watchTime(s: Shot): number {
  let t = 0;
  for (let k = 0; k < s.nFrames - 1; k++) t += FRAME_DT / playbackRate(s.maxSpeed[k]!);
  return t;
}

/** Real seconds until simulated time `simT` of a shot. */
export function watchTimeAt(s: Shot, simT: number): number {
  let t = 0;
  const last = Math.min(s.nFrames - 1, Math.floor(simT / FRAME_DT));
  for (let k = 0; k < last; k++) t += FRAME_DT / playbackRate(s.maxSpeed[k]!);
  return t + (simT - last * FRAME_DT) / playbackRate(s.maxSpeed[last] ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// The aiming guide (ghost ball)
// ---------------------------------------------------------------------------------------------------------------
export interface Guide {
  /** Where the cue ball is when it first touches something, and what it touches. */
  ghost: Vec;
  hit: "ball" | "cushion" | "blocker" | "none";
  /** Object ball index, if a ball. */
  ball: number;
  /** Unit direction the object ball leaves in, and the cue ball's deflection (the tangent line). */
  objDir: Vec;
  cueDir: Vec;
  /** For a cushion first: the bounce direction. */
  bounce: Vec;
}

/** Casts the cue ball's path from `from` along `angle` to the first ball, blocker or cushion it would touch. */
export function castGuide(table: Table, angle: number, from: Vec = table.balls[0]!): Guide {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  let best = Infinity;
  let hit = "none" as Guide["hit"];
  let ball = -1;
  let nrm = { x: 0, z: 0 };
  // Balls: solve |from + d t - c| = 2R.
  table.balls.forEach((b, i) => {
    if (i === 0 || b.pocket >= 0) return;
    const ox = from.x - b.x;
    const oz = from.z - b.z;
    const bq = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - 4 * R * R;
    const disc = bq * bq - c;
    if (disc < 0) return;
    const tt = -bq - Math.sqrt(disc);
    if (tt > 1e-4 && tt < best) {
      best = tt;
      hit = "ball";
      ball = i;
    }
  });
  for (const k of table.blockers) {
    const ox = from.x - k.x;
    const oz = from.z - k.z;
    const rr = R + k.r;
    const bq = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - rr * rr;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const tt = -bq - Math.sqrt(disc);
    if (tt > 1e-4 && tt < best) {
      best = tt;
      hit = "blocker";
      const px = from.x + dx * tt - k.x;
      const pz = from.z + dz * tt - k.z;
      const l = Math.hypot(px, pz) || 1;
      nrm = { x: px / l, z: pz / l };
    }
  }
  // Cushion lines (the cloth's edges, inset by a radius).
  const walls: Array<[number, number, number]> = [
    [1, 0, HW - R],
    [-1, 0, HW - R],
    [0, 1, HL - R],
    [0, -1, HL - R],
  ];
  for (const [wx, wz, lim] of walls) {
    const v = dx * wx + dz * wz;
    if (v <= 1e-6) continue;
    const tt = (lim - (from.x * wx + from.z * wz)) / v;
    if (tt > 1e-4 && tt < best) {
      best = tt;
      hit = "cushion";
      nrm = { x: -wx, z: -wz };
    }
  }
  const ghost = { x: from.x + dx * (Number.isFinite(best) ? best : 0), z: from.z + dz * (Number.isFinite(best) ? best : 0) };
  let objDir = { x: 0, z: 0 };
  let cueDir = { x: 0, z: 0 };
  let bounce = { x: 0, z: 0 };
  if (hit === "ball") {
    const b = table.balls[ball]!;
    const nx = b.x - ghost.x;
    const nz = b.z - ghost.z;
    const l = Math.hypot(nx, nz) || 1;
    objDir = { x: nx / l, z: nz / l };
    // The cue ball keeps the part of its motion along the tangent.
    const along = dx * objDir.x + dz * objDir.z;
    const tx = dx - along * objDir.x;
    const tz = dz - along * objDir.z;
    const tl = Math.hypot(tx, tz);
    cueDir = tl > 1e-4 ? { x: tx / tl, z: tz / tl } : { x: 0, z: 0 };
  } else if (hit === "cushion" || hit === "blocker") {
    const vn = dx * nrm.x + dz * nrm.z;
    bounce = { x: dx - 2 * vn * nrm.x, z: dz - 2 * vn * nrm.z };
  }
  return { ghost, hit, ball, objDir, cueDir, bounce };
}

/** How long the guide's object and deflection lines are in rack n: generous at first, shorter later. */
export function guideLengths(rack: number): { obj: number; cue: number; bounce: boolean } {
  const k = clamp(rack / 5);
  return { obj: 2.8 - 1.8 * k, cue: 1.5 - 1.0 * k, bounce: rack < 2 };
}

// ---------------------------------------------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------------------------------------------
export interface RackSpec {
  n: number;
  count: number;
  layout: "loose" | "diamond" | "triangle" | "clusters";
  blockers: number;
  label: string;
}

export function rackSpec(n: number): RackSpec {
  if (n === 0) return { n, count: 5, layout: "loose", blockers: 0, label: "Five to warm up" };
  if (n === 1) return { n, count: 7, layout: "loose", blockers: 0, label: "Seven, spread out" };
  if (n === 2) return { n, count: 9, layout: "diamond", blockers: 0, label: "A diamond: break it" };
  if (n === 3) return { n, count: 10, layout: "triangle", blockers: 1, label: "Tight rack, one stump" };
  return { n, count: Math.min(12, 10 + Math.floor((n - 4) / 2)), layout: n % 2 ? "clusters" : "triangle", blockers: 2, label: n % 2 ? "Clusters and stumps" : "Tight rack, two stumps" };
}

const farFromPockets = (x: number, z: number, d: number) => POCKETS.every((p) => Math.hypot(x - p.x, z - p.z) > d);

/** Lays out rack n's object balls (numbered 1..count) and blockers around a cue ball at `cue`. Deterministic per seed. */
export function makeRack(n: number, seed: number, cue: Vec = HEAD): Table {
  const spec = rackSpec(n);
  const rng = createRng(seed);
  const balls: Ball[] = [{ n: 0, x: cue.x, z: cue.z, vx: 0, vz: 0, pocket: -1 }];
  const blockers: Blocker[] = [];
  const free = (x: number, z: number, sep: number) =>
    Math.abs(x) < HW - R - 0.08 &&
    Math.abs(z) < HL - R - 0.08 &&
    farFromPockets(x, z, 0.62) &&
    balls.every((b) => Math.hypot(b.x - x, b.z - z) > sep) &&
    blockers.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + R + 0.25);
  // Blockers first: stumps in the middle band, away from the pockets' paths.
  for (let k = 0; k < spec.blockers; k++) {
    for (let tries = 0; tries < 200; tries++) {
      const x = rng.range(-HW + 1.0, HW - 1.0);
      const z = rng.range(-HL + 2.2, HL - 2.6);
      if (Math.hypot(x - cue.x, z - cue.z) < 1.4 || blockers.some((o) => Math.hypot(o.x - x, o.z - z) < 1.6) || Math.abs(z) < 0.5) continue;
      // Keep stumps off a racked triangle or diamond.
      if ((spec.layout === "triangle" || spec.layout === "diamond") && Math.abs(x) < 1.55 && z > FOOT.z - 1.4 && z < FOOT.z + 1.4) continue;
      blockers.push({ x, z, r: 0.24 });
      break;
    }
  }
  const nums = Array.from({ length: spec.count }, (_, i) => i + 1);
  const place = (x: number, z: number) => {
    const num = nums.shift();
    if (num !== undefined) balls.push({ n: num, x, z, vx: 0, vz: 0, pocket: -1 });
  };
  if (spec.layout === "triangle" || spec.layout === "diamond") {
    const gap = spec.layout === "diamond" ? 0.1 : 0.012;
    const d = 2 * R + gap;
    const rows = spec.layout === "diamond" ? [1, 2, 3, 2, 1] : [1, 2, 3, 4, 5, 6];
    const apex = { x: FOOT.x, z: FOOT.z + 0.9 };
    let placed = 0;
    for (let r = 0; r < rows.length && placed < spec.count; r++) {
      const k = rows[r]!;
      for (let c = 0; c < k && placed < spec.count; c++) {
        const x = apex.x + (c - (k - 1) / 2) * d;
        const z = apex.z - r * d * 0.866;
        place(x + rng.range(-0.004, 0.004), z);
        placed++;
      }
    }
    // Whatever didn't fit the shape is scattered.
    while (nums.length) {
      const x = rng.range(-HW + 0.5, HW - 0.5);
      const z = rng.range(-HL + 0.5, HL - 0.8);
      if (free(x, z, 0.7)) place(x, z);
    }
  } else if (spec.layout === "clusters") {
    while (nums.length) {
      const cx = rng.range(-HW + 0.7, HW - 0.7);
      const cz = rng.range(-HL + 0.7, HL - 1.6);
      if (!free(cx, cz, 0.9)) continue;
      place(cx, cz);
      const a = rng.range(0, Math.PI * 2);
      const x2 = cx + Math.cos(a) * (2 * R + 0.01);
      const z2 = cz + Math.sin(a) * (2 * R + 0.01);
      if (nums.length && free(x2, z2, 2 * R)) place(x2, z2);
    }
  } else {
    // Loose: a spread over the far half, a couple of them sitting near pockets so the first pots come easy.
    const easy = n === 0 ? 2 : 1;
    let tries = 0;
    while (nums.length && tries++ < 5000) {
      let x: number;
      let z: number;
      if (spec.count - nums.length < easy) {
        const p = POCKETS[rng.int(0, 3)]!;
        x = p.x * 0.72 + rng.range(-0.3, 0.3);
        z = p.z === 0 ? rng.range(-0.6, 0.6) : p.z * 0.78 + rng.range(-0.3, 0.3);
      } else {
        x = rng.range(-HW + 0.5, HW - 0.5);
        z = rng.range(-HL + 0.5, n === 0 ? 0.6 : HL - 1.2);
      }
      if (free(x, z, n === 0 ? 0.75 : 0.62) && Math.hypot(x - cue.x, z - cue.z) > 1.1) place(x, z);
    }
  }
  return { balls, blockers };
}

/** A spot for the cue ball after a scratch: the head spot, or the nearest free point along the head line. */
export function respawnCue(t: Table): Vec {
  for (let k = 0; k < 40; k++) {
    const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22;
    const p = { x: HEAD.x + off, z: HEAD.z };
    if (Math.abs(p.x) > HW - R - 0.05) continue;
    const ok = t.balls.every((b, i) => i === 0 || b.pocket >= 0 || Math.hypot(b.x - p.x, b.z - p.z) > 2 * R + 0.05) && t.blockers.every((b) => Math.hypot(b.x - p.x, b.z - p.z) > b.r + R + 0.05);
    if (ok) return p;
  }
  return { x: HEAD.x, z: HEAD.z + 0.5 };
}

// ---------------------------------------------------------------------------------------------------------------
// The run: the clock, points, the streak, racks
// ---------------------------------------------------------------------------------------------------------------
export const START_CLOCK = 32;
export const MAX_CLOCK = 60;
export const CLUTCH_T = 8;
export const POT_TIME = 3.4;
export const MULTI_TIME = 1.5;
export const TRICK_TIME = 1.2;
export const RACK_TIME = 7;
export const SCRATCH_TIME = 3;

/** The clock burns faster the longer you last: 1 s/s at the break, about 2 s/s a minute and a half in. */
export const drainAt = (elapsed: number): number => 1 + Math.min(1.5, elapsed / 85);

/** Later racks give back a little less time per pot. */
export const potTimeScale = (rack: number): number => Math.max(0.62, 1 - rack * 0.08);

/** Streak tiers for consecutive potting shots. */
export function multFor(streak: number): number {
  return streak >= 7 ? 4 : streak >= 4 ? 3 : streak >= 2 ? 2 : 1;
}
export const STREAK_NAMES = ["", "", "On a roll", "Red hot", "Unstoppable"] as const;

export interface Award {
  points: number;
  time: number;
  pots: number;
  tags: string[];
  mult: number;
  tierUp: boolean;
  scratch: boolean;
  rackClear: boolean;
  clutch: boolean;
  /** Per-pot breakdown, in potting order, for the popups. */
  each: Array<{ n: number; points: number; tag: string }>;
}

export class Run {
  clock = START_CLOCK;
  elapsed = 0;
  score = 0;
  shots = 0;
  potShots = 0;
  pots = 0;
  streak = 0;
  bestStreak = 0;
  rack = 0;
  racksCleared = 0;
  scratches = 0;
  banks = 0;
  kicks = 0;
  combos = 0;
  longs = 0;
  multis = 0;
  misses = 0;
  dryShots = 0;
  buzzer = false;
  best: Award | null = null;

  get mult(): number {
    return multFor(this.streak);
  }
  get clutch(): boolean {
    return !this.buzzer && this.clock <= CLUTCH_T;
  }

  /** Advance the clock; `frozen` while a new rack drops in. Returns true on the frame the buzzer goes. */
  tick(dt: number, frozen = false): boolean {
    if (this.buzzer) return false;
    this.elapsed += dt;
    if (frozen) return false;
    this.clock -= dt * drainAt(this.elapsed);
    if (this.clock <= 0) {
      this.clock = 0;
      this.buzzer = true;
      return true;
    }
    return false;
  }

  /** A shot has come to rest. `ballsLeft` = object balls still on the table after it. */
  settle(s: Shot, ballsLeft: number, afterBuzzer: boolean): Award {
    this.shots++;
    const before = multFor(this.streak);
    const each: Award["each"] = [];
    const tags: string[] = [];
    const clutch = !afterBuzzer && this.clock <= CLUTCH_T;
    let time = 0;
    let points = 0;
    const n = s.pots.length;
    if (n > 0) {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.potShots++;
      this.pots += n;
    } else {
      this.streak = 0;
      if (s.first < 0) this.misses++;
      else this.dryShots++;
    }
    const mult = multFor(this.streak);
    s.pots.forEach((p, k) => {
      let pts = 100;
      let tag = "";
      if (p.combo) {
        pts += 200;
        tag = "Combo";
        this.combos++;
      } else if (p.bank) {
        pts += 150;
        tag = "Bank";
        this.banks++;
      } else if (s.kick && p.i === s.first) {
        pts += 150;
        tag = "Kick";
      } else if (p.long) {
        pts += 100;
        tag = "Long pot";
        this.longs++;
      }
      if (k > 0) pts += 100 * k;
      pts *= mult * (clutch ? 2 : 1);
      points += pts;
      each.push({ n: p.n, points: pts, tag });
      time += (POT_TIME + (tag ? TRICK_TIME : 0) + (k > 0 ? MULTI_TIME : 0)) * potTimeScale(this.rack);
    });
    if (s.kick && n > 0) this.kicks++;
    if (n >= 2) {
      this.multis++;
      tags.push(n === 2 ? "Double" : n === 3 ? "Triple" : `${n} in one`);
    }
    for (const e of each) if (e.tag && !tags.includes(e.tag)) tags.push(e.tag);
    if (clutch && n > 0) tags.push("Clutch");
    const rackClear = ballsLeft === 0 && n > 0;
    if (rackClear) {
      points += 1000 * (this.rack + 1) * (clutch ? 2 : 1);
      time += RACK_TIME;
      this.racksCleared++;
      tags.unshift("Rack cleared");
    }
    if (s.scratch) {
      this.scratches++;
      this.streak = 0;
      time -= SCRATCH_TIME;
      tags.push("Scratch");
    }
    this.score += points;
    if (!afterBuzzer && !this.buzzer) this.clock = clamp(this.clock + time, 0.5, MAX_CLOCK);
    const award: Award = { points, time: afterBuzzer || this.buzzer ? 0 : time, pots: n, tags, mult, tierUp: mult > before, scratch: s.scratch, rackClear, clutch, each };
    if (n > 0 && (!this.best || points > this.best.points)) this.best = award;
    return award;
  }

  /** On to the next rack. */
  nextRack(): RackSpec {
    this.rack++;
    return rackSpec(this.rack);
  }

  /** One concrete thing to try next time, from how the run went. */
  hint(): string {
    if (this.shots === 0) return "Drag to aim, pull down to power up, let go. The clock is already running.";
    if (this.scratches >= 2 && this.scratches * 3 > this.shots) return "Ease off the power: the cue ball keeps following the others in.";
    if (this.misses > this.shots / 3) return "Follow the dotted line: it shows exactly what you'll hit first.";
    if (this.dryShots > this.potShots * 1.5) return "Line the ghost ball up so its arrow points into a pocket, then shoot.";
    if (this.racksCleared === 0) return `Clearing a rack gives back ${RACK_TIME} seconds. Go for the easy ones first.`;
    if (this.bestStreak < 4) return "Pots in a row stack up the multiplier. Keep the streak alive.";
    return "Banks, kicks and combos give back extra time. Use the cushions.";
  }
}
