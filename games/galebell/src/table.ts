/**
 * The Galebell table: a lighthouse playfield of our own design, in table units (360 wide, 640 tall, y down).
 *
 *   - an arch over the top, a shooter lane on the right with a one-way gate at its head;
 *   - an orbit: a lane up each side joined under the arch, with the wind vane (spinner) in the left one;
 *   - three lamp lanes (rollovers) under the arch and three buoys (pop bumpers) below them;
 *   - four signal flags (drop targets) on a chevron guarding the harbour (the lock saucer) behind them;
 *   - a breakwater (slingshot) above each flipper, an inlane down each side and no outlanes: every ball that is lost
 *     goes between the flippers, so every drain is one you could have flipped.
 *
 * Everything here is data. The physics builds its colliders from it and the renderer draws it, so the two can never
 * disagree.
 */

export const TABLE_W = 360;
export const BALL_R = 8;
export const TABLE_H = 640;
/** Below this the ball is gone. */
export const DRAIN_Y = 664;
/** The playfield between the side walls is symmetric about this line (the shooter lane sits right of it). */
export const MID_X = 169;

/** What a collider is, for scoring, sound and drawing. */
export const Tag = {
  Wall: 0,
  Rubber: 1,
  SlingL: 2,
  SlingR: 3,
  Bumper0: 4,
  Bumper1: 5,
  Bumper2: 6,
  Target0: 7,
  Target1: 8,
  Target2: 9,
  Target3: 10,
  Gate: 11,
  Plunger: 12,
  LaneGuide: 13,
  FlipperL: 14,
  FlipperR: 15,
  Ball: 16,
} as const;
export type Tag = (typeof Tag)[keyof typeof Tag];

export const Sensor = {
  Lane0: 0,
  Lane1: 1,
  Lane2: 2,
  Spinner: 3,
  OrbitL: 4,
  OrbitR: 5,
  ShooterExit: 6,
  InlaneL: 7,
  InlaneR: 8,
} as const;
export type Sensor = (typeof Sensor)[keyof typeof Sensor];

export interface SegDef {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Half thickness of the wall. */
  r: number;
  e: number;
  f: number;
  tag: Tag;
  /** One-way: only a ball on this side (moving against it) collides. */
  block?: [number, number];
}

export interface CircleDef {
  x: number;
  y: number;
  R: number;
  e: number;
  f: number;
  tag: Tag;
}

/** A circular wall: centre, centreline radius, half thickness; angles in screen radians (atan2 with y down). */
export interface ArcDef {
  x: number;
  y: number;
  R: number;
  r: number;
  start: number;
  sweep: number;
  /** 1 = the inner face only (the ball runs inside it), 2 = the outer face only, 3 = both. */
  sides: 1 | 2 | 3;
  e: number;
  f: number;
  tag: Tag;
}

export interface LineSensorDef {
  id: Sensor;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface FlipperDef {
  side: 0 | 1;
  x: number;
  y: number;
  len: number;
  /** Base and tip radius. */
  r0: number;
  r1: number;
  /** Screen angles of the rubber's axis at rest and fully raised. */
  rest: number;
  up: number;
}

export interface TableDef {
  segs: SegDef[];
  circles: CircleDef[];
  arcs: ArcDef[];
  sensors: LineSensorDef[];
  flippers: [FlipperDef, FlipperDef];
  /** The harbour: a saucer that holds the ball. */
  harbour: { x: number; y: number; r: number; capture: number };
  /** Where a served ball waits for the plunger. */
  plunger: { x: number; y: number; floorY: number };
  /** Drawing helpers. */
  bumpers: Array<{ x: number; y: number; R: number }>;
  targets: Array<{ ax: number; ay: number; bx: number; by: number; nx: number; ny: number }>;
  lanes: Array<{ x: number; y: number }>;
  slings: Array<{ pts: number[]; face: [number, number, number, number] }>;
  spinner: { x0: number; x1: number; y: number };
}

const DEG = Math.PI / 180;

/** Mirrors an x coordinate about the playfield's middle. */
export const mx = (x: number): number => 2 * MID_X - x;

const WALL_E = 0.42;
const WALL_F = 0.05;
const RUBBER_E = 0.7;
const RUBBER_F = 0.08;

export const BUMPER_R = 17;
/**
 * The inlane guide's lower end: just above and right of the flipper's pivot, 1.6 units off its base circle. A ball
 * rolling down the guide drops onto the base's upper-right and rolls on down the rubber (no pocket on a lowered
 * flipper); a raised rubber and the guide make a V that cradles it.
 */
export const GUIDE_END = [95.5, 552] as const;
/** The shooter lane's inner wall ends here, low enough for a plunged ball to curl over it along the arch. */
export const LANE_TOP = 196;
/** Where the gate's 45° line from the wall's top meets the arch (centre (180, 180), radius 168). */
const GATE_S = (() => {
  // (146 + s)² + (LANE_TOP - 180 - s)² = 168²
  const p = 146;
  const q = LANE_TOP - 180;
  const A = 2;
  const B = 2 * p - 2 * q;
  const C = p * p + q * q - 168 * 168;
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
})();
export const GATE_TOP = [326 + GATE_S, LANE_TOP - GATE_S] as const;
export const LANE_X = [135, 169, 203] as const;
export const LANE_GUIDES = [118, 152, 186, 220] as const;

export function buildTable(): TableDef {
  const segs: SegDef[] = [];
  const circles: CircleDef[] = [];
  const arcs: ArcDef[] = [];
  const sensors: LineSensorDef[] = [];
  const wall = (ax: number, ay: number, bx: number, by: number, tag: Tag = Tag.Wall, r = 2, e = WALL_E, f = WALL_F) =>
    segs.push({ ax, ay, bx, by, r, e, f, tag });

  // --- the cabinet: left wall, arch, shooter lane --------------------------------------------------------------
  wall(12, 180, 12, 410);
  arcs.push({ x: 180, y: 180, R: 168, r: 2, start: -Math.PI, sweep: Math.PI, sides: 1, e: 0.3, f: 0.02, tag: Tag.Wall });
  wall(348, 180, 348, 640);
  // The shooter lane's inner wall: the right orbit's outer wall on its other face.
  wall(326, LANE_TOP, 326, 640);
  // A slanted one-way gate at the lane's head: a plunged ball passes up, a ball coming round the arch rolls off it
  // into the right orbit lane.
  segs.push({ ax: 326, ay: LANE_TOP, bx: GATE_TOP[0], by: GATE_TOP[1], r: 1.5, e: 0.3, f: 0.05, tag: Tag.Gate, block: [-Math.SQRT1_2, -Math.SQRT1_2] });
  segs.push({ ax: 326, ay: 628, bx: 348, by: 628, r: 2, e: 0.15, f: 0.2, tag: Tag.Plunger });

  // --- inlane guides: the side walls bend in and lead to each flipper (no outlanes) ----------------------------
  wall(12, 410, GUIDE_END[0], GUIDE_END[1]);
  wall(326, 410, mx(GUIDE_END[0]), GUIDE_END[1]);

  // --- orbit guides ----------------------------------------------------------------------------------------------
  wall(50, 330, 50, 190);
  arcs.push({ x: 180, y: 190, R: 130, r: 2, start: -Math.PI, sweep: 40 * DEG, sides: 3, e: WALL_E, f: WALL_F, tag: Tag.Wall });
  const lEnd = [180 + 130 * Math.cos(-140 * DEG), 190 + 130 * Math.sin(-140 * DEG)] as const;
  circles.push({ x: lEnd[0], y: lEnd[1], R: 2, e: WALL_E, f: WALL_F, tag: Tag.Wall });
  wall(288, 330, 288, 190);
  arcs.push({ x: 180, y: 190, R: 108, r: 2, start: -45 * DEG, sweep: 45 * DEG, sides: 3, e: WALL_E, f: WALL_F, tag: Tag.Wall });
  const rEnd = [180 + 108 * Math.cos(-45 * DEG), 190 + 108 * Math.sin(-45 * DEG)] as const;
  circles.push({ x: rEnd[0], y: rEnd[1], R: 2, e: WALL_E, f: WALL_F, tag: Tag.Wall });

  // --- lamp lanes --------------------------------------------------------------------------------------------------
  for (const x of LANE_GUIDES) wall(x, 62, x, 96, Tag.LaneGuide, 3, RUBBER_E, RUBBER_F);
  const lanes = LANE_X.map((x) => ({ x, y: 80 }));
  LANE_X.forEach((x, i) => sensors.push({ id: i as Sensor, ax: x - 14, ay: 80, bx: x + 14, by: 80 }));

  // --- buoys -------------------------------------------------------------------------------------------------------
  const bumpers = [
    { x: 136, y: 168, R: BUMPER_R },
    { x: 202, y: 168, R: BUMPER_R },
    { x: MID_X, y: 218, R: BUMPER_R },
  ];
  bumpers.forEach((b, i) => circles.push({ x: b.x, y: b.y, R: b.R, e: 0.6, f: 0.02, tag: (Tag.Bumper0 + i) as Tag }));

  // --- signal flags on a chevron, the harbour behind them ------------------------------------------------------
  const apex = [MID_X, 300] as const;
  const left = [125, 316] as const;
  const right = [mx(125), 316] as const;
  const targets: TableDef["targets"] = [];
  const along = (a: readonly [number, number], b: readonly [number, number], t0: number, t1: number) =>
    [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1] as const;
  const flagSpans: Array<[readonly [number, number], readonly [number, number], number, number]> = [
    [left, apex, 0.04, 0.48],
    [left, apex, 0.52, 0.96],
    [apex, right, 0.04, 0.48],
    [apex, right, 0.52, 0.96],
  ];
  flagSpans.forEach(([a, b, t0, t1], i) => {
    const [ax, ay, bx, by] = along(a, b, t0, t1);
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy);
    // Front faces down toward the flippers.
    let nx = -dy / l;
    let ny = dx / l;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    targets.push({ ax, ay, bx, by, nx, ny });
    segs.push({ ax, ay, bx, by, r: 3, e: 0.3, f: 0.06, tag: (Tag.Target0 + i) as Tag });
  });
  // Posts at the chevron's ends and apex (the apex post keeps the roof shut between the two pairs).
  for (const p of [left, right]) circles.push({ x: p[0], y: p[1], R: 4, e: RUBBER_E, f: RUBBER_F, tag: Tag.Rubber });
  circles.push({ x: apex[0], y: apex[1] - 1, R: 3, e: RUBBER_E, f: RUBBER_F, tag: Tag.Rubber });
  const harbour = { x: MID_X, y: 270, r: 12, capture: 8.5 };

  // --- breakwaters (slingshots) ------------------------------------------------------------------------------------
  // Left: its outer side parallels the inlane guide 25 units in; the kicking face looks up and in.
  const gl = Math.hypot(GUIDE_END[0] - 12, GUIDE_END[1] - 410);
  const gx = (GUIDE_END[0] - 12) / gl;
  const gy = (GUIDE_END[1] - 410) / gl;
  const inX = gy; // inward normal of the guide (up-right)
  const inY = -gx;
  const o = [12 + 25 * inX, 410 + 25 * inY] as const;
  const T = [o[0] + 30 * gx, o[1] + 30 * gy] as const;
  const B = [o[0] + 118 * gx, o[1] + 118 * gy] as const;
  const K = [B[0] + 38 * Math.cos(30 * DEG), B[1] + 38 * Math.sin(30 * DEG)] as const;
  const slings: TableDef["slings"] = [];
  for (const side of [0, 1] as const) {
    const X = (x: number) => (side ? mx(x) : x);
    const t = [X(T[0]), T[1]] as const;
    const b = [X(B[0]), B[1]] as const;
    const k = [X(K[0]), K[1]] as const;
    wall(t[0], t[1], b[0], b[1], Tag.Rubber, 2.5, 0.55, RUBBER_F);
    wall(b[0], b[1], k[0], k[1], Tag.Rubber, 2.5, 0.55, RUBBER_F);
    segs.push({ ax: t[0], ay: t[1], bx: k[0], by: k[1], r: 2.5, e: 0.6, f: RUBBER_F, tag: side ? Tag.SlingR : Tag.SlingL });
    slings.push({ pts: [t[0], t[1], b[0], b[1], k[0], k[1]], face: [t[0], t[1], k[0], k[1]] });
  }

  // --- sensors -------------------------------------------------------------------------------------------------------
  sensors.push({ id: Sensor.Spinner, ax: 14, ay: 292, bx: 48, by: 292 });
  sensors.push({ id: Sensor.OrbitL, ax: 14, ay: 250, bx: 48, by: 250 });
  sensors.push({ id: Sensor.OrbitR, ax: 290, ay: 250, bx: 324, by: 250 });
  sensors.push({ id: Sensor.ShooterExit, ax: 328, ay: 206, bx: 346, by: 206 });
  // Across each inlane, halfway down.
  const im = [12 + 80 * gx, 410 + 80 * gy] as const;
  sensors.push({ id: Sensor.InlaneL, ax: im[0], ay: im[1], bx: im[0] + 25 * inX, by: im[1] + 25 * inY });
  sensors.push({ id: Sensor.InlaneR, ax: mx(im[0]), ay: im[1], bx: mx(im[0] + 25 * inX), by: im[1] + 25 * inY });

  // --- flippers ------------------------------------------------------------------------------------------------------
  const flippers: [FlipperDef, FlipperDef] = [
    // 58 long: when both are level their tips leave 22 units, so a ball is never pinched between two moving rubbers.
    { side: 0, x: 94, y: 566, len: 58, r0: 10.5, r1: 6, rest: 29 * DEG, up: -24 * DEG },
    { side: 1, x: mx(94), y: 566, len: 58, r0: 10.5, r1: 6, rest: Math.PI - 29 * DEG, up: Math.PI + 24 * DEG },
  ];

  return {
    segs,
    circles,
    arcs,
    sensors,
    flippers,
    harbour,
    plunger: { x: 337, y: 628 - 8 - 2, floorY: 628 },
    bumpers,
    targets,
    lanes,
    slings,
    spinner: { x0: 14, x1: 48, y: 292 },
  };
}
