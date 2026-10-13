/**
 * Calls `onTap` when a pointer is pressed and released without moving (a tap, not a swipe).
 * Runs must start on a tap's release, never on pointerdown: a swipe that the feed takes over
 * then can't start a run by accident (Swipe Contract rule 1). A cancelled gesture never fires.
 */
export function onTap(target: EventTarget, onTap: (x: number, y: number) => void): void {
  let down: { id: number; x: number; y: number; t: number } | null = null;
  target.addEventListener("pointerdown", (e) => {
    const p = e as PointerEvent;
    down = { id: p.pointerId, x: p.clientX, y: p.clientY, t: performance.now() };
  });
  window.addEventListener("pointercancel", () => (down = null));
  window.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved < 12 && quick) onTap(e.clientX, e.clientY);
  });
}
