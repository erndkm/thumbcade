/**
 * Gesture recognizers built on pointer events. Every recognizer honors `pointercancel` (the SDK
 * dispatches it when the feed claims a gesture), so a cancelled gesture never fires.
 */

export type Dir = "up" | "down" | "left" | "right";

interface Track {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  done: boolean;
}

function listen(target: EventTarget, handlers: {
  down(e: PointerEvent, t: Track): void;
  move?(e: PointerEvent, t: Track): void;
  up?(e: PointerEvent, t: Track): void;
  cancel?(t: Track): void;
}): () => void {
  let cur: Track | null = null;
  const down = (ev: Event) => {
    const e = ev as PointerEvent;
    if (cur || (e.pointerType === "mouse" && e.button !== 0)) return;
    cur = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), done: false };
    handlers.down(e, cur);
  };
  const move = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!cur || e.pointerId !== cur.id) return;
    cur.x = e.clientX;
    cur.y = e.clientY;
    handlers.move?.(e, cur);
  };
  const up = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!cur || e.pointerId !== cur.id) return;
    cur.x = e.clientX;
    cur.y = e.clientY;
    const t = cur;
    cur = null;
    handlers.up?.(e, t);
  };
  const cancel = (ev: Event) => {
    const e = ev as PointerEvent;
    if (!cur || e.pointerId !== cur.id) return;
    const t = cur;
    cur = null;
    handlers.cancel?.(t);
  };
  target.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  return () => {
    target.removeEventListener("pointerdown", down);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
  };
}

/** A tap = press and release within `slop` px and `maxMs`. Fires on release (Swipe Contract rule 1). */
export function onTap(
  target: EventTarget,
  cb: (x: number, y: number) => void,
  opts: { slop?: number; maxMs?: number } = {},
): () => void {
  const slop = opts.slop ?? 12;
  const maxMs = opts.maxMs ?? 500;
  return listen(target, {
    down() {},
    up(_e, t) {
      if (Math.hypot(t.x - t.x0, t.y - t.y0) < slop && performance.now() - t.t0 <= maxMs) cb(t.x, t.y);
    },
  });
}

/** Fires on press (no wait for release). For in-run actions like flapping; never use it to start a run. */
export function onPress(target: EventTarget, cb: (x: number, y: number) => void): () => void {
  return listen(target, { down: (e) => cb(e.clientX, e.clientY) });
}

/**
 * 4-way swipe. Fires as soon as the finger passes `threshold` px along the dominant axis, so moves
 * feel instant. One swipe per gesture.
 */
export function onSwipe(
  target: EventTarget,
  cb: (dir: Dir) => void,
  opts: { threshold?: number; maxMs?: number } = {},
): () => void {
  const threshold = opts.threshold ?? 24;
  const maxMs = opts.maxMs ?? 900;
  const check = (t: Track) => {
    if (t.done) return;
    const dx = t.x - t.x0;
    const dy = t.y - t.y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;
    if (performance.now() - t.t0 > maxMs) return;
    t.done = true;
    cb(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  };
  return listen(target, { down() {}, move: (_e, t) => check(t), up: (_e, t) => check(t) });
}

export interface DragHandlers {
  start?(x: number, y: number): void;
  move?(x: number, y: number, dx: number, dy: number): void;
  end?(x: number, y: number, cancelled: boolean): void;
}

/** Continuous drag tracking. `dx/dy` are relative to the press point. */
export function onDrag(target: EventTarget, h: DragHandlers): () => void {
  return listen(target, {
    down: (_e, t) => h.start?.(t.x, t.y),
    move: (_e, t) => h.move?.(t.x, t.y, t.x - t.x0, t.y - t.y0),
    up: (_e, t) => h.end?.(t.x, t.y, false),
    cancel: (t) => h.end?.(t.x, t.y, true),
  });
}

/** Tap vs long-press on the same target (e.g. reveal vs flag). */
export function onTapOrHold(
  target: EventTarget,
  h: { tap(x: number, y: number): void; hold(x: number, y: number): void; holdStart?(x: number, y: number): void },
  opts: { holdMs?: number; slop?: number } = {},
): () => void {
  const holdMs = opts.holdMs ?? 380;
  const slop = opts.slop ?? 10;
  let timer = 0;
  return listen(target, {
    down(_e, t) {
      h.holdStart?.(t.x, t.y);
      timer = window.setTimeout(() => {
        if (Math.hypot(t.x - t.x0, t.y - t.y0) < slop && !t.done) {
          t.done = true;
          h.hold(t.x0, t.y0);
        }
      }, holdMs);
    },
    move(_e, t) {
      if (Math.hypot(t.x - t.x0, t.y - t.y0) >= slop) window.clearTimeout(timer);
    },
    up(_e, t) {
      window.clearTimeout(timer);
      if (!t.done && Math.hypot(t.x - t.x0, t.y - t.y0) < slop) h.tap(t.x, t.y);
    },
    cancel() {
      window.clearTimeout(timer);
    },
  });
}

/** Arrow keys / WASD / space for desktop testing in the simulator. */
export function onKeys(map: Partial<Record<Dir | "action", () => void>>): () => void {
  const keys: Record<string, Dir | "action"> = {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    Space: "action",
    Enter: "action",
  };
  const h = (e: KeyboardEvent) => {
    const k = keys[e.code];
    if (k && map[k]) {
      e.preventDefault();
      map[k]!();
    }
  };
  window.addEventListener("keydown", h);
  return () => window.removeEventListener("keydown", h);
}
