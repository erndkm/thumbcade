/**
 * One thumb, three moves: drag sideways to slide the piece band by band, tap to turn it, flick down to slam it
 * home (a slow pull down lets it fall faster instead). Pure, so the tests can feed it touches.
 *
 * The piece follows the thumb from wherever the thumb went down, not from under it, so the meter is never covered.
 */
export interface Steerable {
  readonly active: { x: number } | null;
  readonly pieceCount: number;
  shift(n: number): number;
  rotate(): boolean;
  slam(): number;
  setSoft(on: boolean): void;
  poke(): void;
}

export const TOUCH = {
  /** The piece moves this many bands per band-width of thumb travel. */
  gearing: 1.15,
  /** Sideways travel before a touch counts as a drag (px). */
  dragSlop: 9,
  /** A tap: released within this long and this close to where it went down. */
  tapMs: 320,
  tapSlop: 12,
  /** A flick: this far down inside the window, and mostly downwards. */
  flickPx: 44,
  flickMs: 130,
  flickRatio: 1.4,
  /** A slow pull this far down lets the piece fall fast until the thumb comes back up or lifts. */
  pullPx: 30,
} as const;

export type Result = "none" | "slide" | "turn" | "slam" | "pull";

interface Sample {
  t: number;
  x: number;
  y: number;
}

export class Gesture {
  private down = false;
  private x0 = 0;
  private y0 = 0;
  private t0 = 0;
  /** The thumb position and band the current drag is measured from. */
  private anchorX = 0;
  private anchorY = 0;
  private anchorCol = 0;
  private piece = -1;
  private dragged = false;
  private spent = false;
  private pulling = false;
  private far = 0;
  private trail: Sample[] = [];

  constructor(public colW = 44) {}

  get active(): boolean {
    return this.down;
  }

  press(x: number, y: number, t: number, run: Steerable): void {
    this.down = true;
    this.x0 = x;
    this.y0 = y;
    this.t0 = t;
    this.dragged = false;
    this.spent = false;
    this.pulling = false;
    this.far = 0;
    this.trail = [{ t, x, y }];
    this.anchor(x, y, run);
    run.poke();
  }

  private anchor(x: number, y: number, run: Steerable): void {
    this.anchorX = x;
    this.anchorY = y;
    this.anchorCol = run.active?.x ?? 0;
    this.piece = run.pieceCount;
  }

  move(x: number, y: number, t: number, run: Steerable): Result {
    if (!this.down) return "none";
    this.far = Math.max(this.far, Math.hypot(x - this.x0, y - this.y0));
    this.trail.push({ t, x, y });
    while (this.trail.length > 2 && t - this.trail[0]!.t > TOUCH.flickMs) this.trail.shift();
    if (this.spent) return "none";
    run.poke();
    // A new piece arrived under a thumb that is still down: it starts from where the thumb is now.
    if (run.pieceCount !== this.piece) {
      if (this.pulling) {
        this.pulling = false;
        run.setSoft(false);
      }
      this.anchor(x, y, run);
      this.trail = [{ t, x, y }];
      return "none";
    }
    if (!run.active) return "none";

    const first = this.trail[0]!;
    const fy = y - first.y;
    const fx = Math.abs(x - first.x);
    if (fy >= TOUCH.flickPx && fy >= TOUCH.flickRatio * fx) {
      this.spent = true;
      if (this.pulling) run.setSoft(false);
      this.pulling = false;
      run.slam();
      return "slam";
    }

    let result: Result = "none";
    const dx = x - this.anchorX;
    const dy = y - this.anchorY;
    if (this.dragged || Math.abs(dx) > TOUCH.dragSlop) {
      this.dragged = true;
      const want = this.anchorCol + Math.round((dx * TOUCH.gearing) / this.colW);
      const delta = want - run.active.x;
      if (delta !== 0) {
        const moved = run.shift(delta);
        if (moved !== 0) result = "slide";
        // Against a wall or the stack: measure from here, so the way back answers at once.
        if (moved !== delta) {
          this.anchorCol = run.active.x;
          this.anchorX = x;
        }
      }
    }
    if (!this.pulling && dy >= TOUCH.pullPx && dy > 1.2 * Math.abs(dx)) {
      this.pulling = true;
      run.setSoft(true);
      result = "pull";
    } else if (this.pulling && dy < TOUCH.pullPx * 0.5) {
      this.pulling = false;
      run.setSoft(false);
    }
    return result;
  }

  release(x: number, y: number, t: number, run: Steerable): Result {
    if (!this.down) return "none";
    this.down = false;
    const wasPulling = this.pulling;
    if (this.pulling) run.setSoft(false);
    this.pulling = false;
    this.far = Math.max(this.far, Math.hypot(x - this.x0, y - this.y0));
    if (this.spent || this.dragged || wasPulling) return "none";
    if (t - this.t0 > TOUCH.tapMs || this.far > TOUCH.tapSlop) return "none";
    run.rotate();
    return "turn";
  }

  /** The feed took the gesture: nothing half-done may land. */
  cancel(run: Steerable): void {
    if (this.pulling) run.setSoft(false);
    this.down = false;
    this.pulling = false;
    this.spent = true;
  }
}
