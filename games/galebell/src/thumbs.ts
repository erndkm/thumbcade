/**
 * Two thumbs: each pointer belongs to the half of the screen it went down on, and a flipper is up while any pointer
 * holds its half (so both together work, and sliding a thumb across the middle doesn't drop or swap a flipper). A
 * short, still press is also a tap, which launches a waiting ball. A cancelled pointer (the feed took the gesture)
 * lets go and is never a tap.
 */
export const TAP_MS = 320;
export const TAP_SLOP = 16;

interface Press {
  side: 0 | 1;
  t: number;
  x: number;
  y: number;
}

export class Thumbs {
  private readonly held = new Map<number, Press>();

  down(id: number, x: number, y: number, t: number, width: number): void {
    this.held.set(id, { side: x < width / 2 ? 0 : 1, t, x, y });
  }

  /** Returns true when the release was a tap. */
  up(id: number, x: number, y: number, t: number): boolean {
    const p = this.held.get(id);
    if (!p) return false;
    this.held.delete(id);
    return t - p.t < TAP_MS && Math.hypot(x - p.x, y - p.y) < TAP_SLOP;
  }

  cancel(id: number): void {
    this.held.delete(id);
  }

  cancelAll(): void {
    this.held.clear();
  }

  /** Is a flipper's half held? */
  side(s: 0 | 1): boolean {
    for (const p of this.held.values()) if (p.side === s) return true;
    return false;
  }

  get count(): number {
    return this.held.size;
  }
}
