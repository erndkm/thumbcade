import type { Rng } from "@thumbcade-games/kit/rng";

/**
 * The stepping-stone path. It is a chain of w×w blocks, each shifted one cell forward in the current
 * direction: A = -X (up-left on screen) or B = -Z (up-right). A segment is a straight run of blocks;
 * segments alternate direction, so the path bends left, right, left...
 *
 * Fairness: the fox keeps its sideways position until it turns, and the turn window is exactly the
 * next segment's width (2 cells normally, 1 on the narrow boardwalks). Width only changes at a bend, so
 * a straight stretch never narrows under the fox.
 */

export type Dir = 0 | 1;
export const DX = [-1, 0] as const;
export const DZ = [0, -1] as const;

export interface Segment {
  dir: Dir;
  /** Lowest cell of the sideways range (z for A, x for B). */
  lo: number;
  w: 1 | 2;
}

export interface Block {
  x: number;
  z: number;
  w: 1 | 2;
  seg: number;
  /** Progress of the block's front cell: -(x + z). */
  p: number;
}

export interface Cell {
  i: number;
  j: number;
  p: number;
  seg: number;
  dir: Dir;
  narrow: boolean;
  berry: boolean;
  /** Order of creation inside its block (for staggered drops). */
  order: number;
}

/** How far the path may wander sideways (cells of x - z) before the next bend must bring it back. */
const DRIFT = 5;

export const keyOf = (i: number, j: number): number => (i + 100000) * 262144 + (j + 100000);

export class PathGen {
  readonly segs: Segment[] = [];
  readonly blocks: Block[] = [];
  private head = { x: 0, z: 3, w: 2 as 1 | 2 };
  private lastBerry = -10;
  private readonly seen = new Set<number>();

  constructor(
    private readonly rng: Rng,
    private readonly onCell: (c: Cell) => void,
  ) {}

  /** Progress of the newest block's front. */
  get front(): number {
    return -(this.head.x + this.head.z);
  }

  /** Difficulty from 0 to 1 by distance. */
  static level(p: number): number {
    return Math.max(0, Math.min(1, p / 380));
  }

  extend(): void {
    const { rng } = this;
    const first = this.segs.length === 0;
    const prev = this.segs[this.segs.length - 1];
    const dir: Dir = first || !prev ? 1 : prev.dir === 0 ? 1 : 0;
    const p = this.front;
    const k = PathGen.level(p);
    let w: 1 | 2 = 2;
    if (!first && p > 30 && rng() < 0.14 + 0.3 * k) w = 1;
    const h = this.head;
    const lat = dir === 0 ? h.z : h.x;
    let lo = lat;
    if (!first) {
      if (w < h.w) lo = lat + rng.int(0, 1);
      else if (w > h.w) lo = lat - rng.int(0, 1);
    }
    let n: number;
    if (first) n = 9;
    else if (w === 2) n = rng.int(Math.round(3 - 2 * k), Math.round(7 - 3 * k));
    else n = rng.int(1, Math.round(3 - k));
    // Sideways wander (x - z), centred so the long first stretch starts left and ends right.
    const drift = h.x - h.z - 1.5;
    const room = Math.floor(dir === 0 ? drift + DRIFT : DRIFT - drift);
    n = Math.max(1, Math.min(n, room));

    const seg = this.segs.length;
    this.segs.push({ dir, lo, w });
    for (let s = 0; s < n; s++) {
      const cur = this.head;
      const b: Block = dir === 0 ? { x: cur.x - 1, z: lo, w, seg, p: 0 } : { x: lo, z: cur.z - 1, w, seg, p: 0 };
      b.p = -(b.x + b.z);
      this.head = { x: b.x, z: b.z, w };
      this.blocks.push(b);
      this.emit(b, dir, first);
    }
  }

  private emit(b: Block, dir: Dir, first: boolean): void {
    const fresh: Cell[] = [];
    let order = 0;
    for (let a = 0; a < b.w; a++)
      for (let c = 0; c < b.w; c++) {
        const i = b.x + a;
        const j = b.z + c;
        const key = keyOf(i, j);
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        fresh.push({ i, j, p: -(i + j), seg: b.seg, dir, narrow: b.w === 1, berry: false, order: order++ });
      }
    const k = PathGen.level(b.p);
    if (!first && fresh.length && this.blocks.length - this.lastBerry > 2 && this.rng() < 0.11 + 0.05 * k) {
      this.rng.pick(fresh).berry = true;
      this.lastBerry = this.blocks.length;
    }
    fresh.forEach(this.onCell);
  }
}
