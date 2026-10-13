import { TAP_SLOP, TRIGGER_WINDOW_MS } from "./constants.ts";
import type { StartTrigger } from "./types.ts";

/**
 * Pointer bookkeeping for the Swipe Contract.
 *
 * - Records every pointer sequence (window, capture phase — before any game listener) so
 *   `gameplay.start()` can report whether the run was started by a tap or a swipe.
 * - On `input.cancel` (the feed claimed the gesture) dispatches synthetic `pointercancel` and
 *   `touchcancel` to the active targets, then swallows the rest of the cancelled sequence
 *   (moves, ups, compat mouse events, the click) so no half-jump or half-move ever registers.
 */

interface Ptr {
  id: number;
  type: string;
  primary: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  target: EventTarget | null;
}

interface TouchRec {
  touch: Touch;
  target: EventTarget | null;
}

export interface InputTracker {
  /** Classifies the input that is starting a run right now. */
  trigger(): StartTrigger;
  /** Cancels every active pointer/touch. Returns true if anything was active. */
  cancel(): boolean;
  /** Fallback tap injection (`input.inject`). Coordinates are viewport CSS px. */
  inject(x: number, y: number): void;
}

const POINTER_SWALLOW = ["pointermove", "pointerup", "pointercancel"] as const;
const COMPAT_SWALLOW = ["mousemove", "mouseup", "click", "touchmove", "touchend"] as const;

/**
 * @param isOwnUi optional predicate for SDK-owned UI (the standalone dev HUD). Events that hit it
 *   are handed to `onOwnUi` and never reach the game.
 */
export function createInput(
  win: Window & typeof globalThis,
  isOwnUi?: (e: Event) => boolean,
  onOwnUi?: (e: Event) => void,
): InputTracker {
  const doc = win.document;
  const now = () => win.performance.now();
  const ptrs = new Map<number, Ptr>();
  const touches = new Map<number, TouchRec>();
  const dead = new Set<number>();
  let swallowCompat = false;
  let last: { d: number; t: number } | null = null;
  let lastKey = -1;

  const add = (type: string, fn: (e: Event) => void) =>
    win.addEventListener(type, fn, { capture: true, passive: true });

  const guard = (e: Event): boolean => {
    if (isOwnUi && isOwnUi(e)) {
      e.stopImmediatePropagation();
      onOwnUi?.(e);
      return true;
    }
    return false;
  };

  add("pointerdown", (ev) => {
    if (guard(ev)) return;
    const e = ev as PointerEvent;
    swallowCompat = false;
    dead.delete(e.pointerId);
    ptrs.set(e.pointerId, {
      id: e.pointerId,
      type: e.pointerType || "mouse",
      primary: e.isPrimary,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      target: e.target,
    });
  });

  for (const type of POINTER_SWALLOW) {
    add(type, (ev) => {
      if (guard(ev)) return;
      const e = ev as PointerEvent;
      if (dead.has(e.pointerId)) {
        // Our own synthetic pointercancel must reach the game; everything trusted after the cancel is swallowed.
        if (!e.isTrusted && type === "pointercancel") return;
        e.stopImmediatePropagation();
        if (type !== "pointermove") dead.delete(e.pointerId);
        return;
      }
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (type !== "pointermove") {
        ptrs.delete(e.pointerId);
        last = { d: Math.hypot(p.x - p.x0, p.y - p.y0), t: now() };
      }
    });
  }

  add("gotpointercapture", (ev) => {
    const e = ev as PointerEvent;
    const p = ptrs.get(e.pointerId);
    if (p) p.target = e.target;
  });

  for (const type of COMPAT_SWALLOW) {
    add(type, (e) => {
      if (guard(e)) return;
      if (swallowCompat) e.stopImmediatePropagation();
    });
  }
  for (const type of ["mousedown", "touchstart", "contextmenu"]) add(type, guard);

  add("touchstart", (ev) => {
    const e = ev as TouchEvent;
    for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { touch: t, target: t.target });
  });
  const touchDone = (ev: Event) => {
    for (const t of Array.from((ev as TouchEvent).changedTouches ?? [])) touches.delete(t.identifier);
  };
  add("touchend", touchDone);
  add("touchcancel", touchDone);
  add("keydown", () => {
    lastKey = now();
  });

  const live = (t: EventTarget | null): EventTarget =>
    t && (t as Node).isConnected !== false ? t : (doc.body ?? doc.documentElement);

  function fire(target: EventTarget, type: string, init: PointerEventInit): void {
    const Ctor = typeof win.PointerEvent === "function" ? win.PointerEvent : win.MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: type !== "pointercancel", composed: true, ...init }));
  }

  return {
    trigger() {
      const t = now();
      for (const p of ptrs.values()) return Math.hypot(p.x - p.x0, p.y - p.y0) >= TAP_SLOP ? "swipe" : "tap";
      const recent = last && t - last.t <= TRIGGER_WINDOW_MS ? last : null;
      if (lastKey >= 0 && t - lastKey <= TRIGGER_WINDOW_MS && (!recent || lastKey > recent.t)) return "key";
      if (recent) return recent.d >= TAP_SLOP ? "swipe" : "tap";
      return "none";
    },

    cancel() {
      const had = ptrs.size > 0 || touches.size > 0;
      const active = Array.from(ptrs.values());
      ptrs.clear();
      for (const p of active) {
        dead.add(p.id);
        fire(live(p.target), "pointercancel", {
          pointerId: p.id,
          pointerType: p.type,
          isPrimary: p.primary,
          clientX: p.x,
          clientY: p.y,
        });
      }
      if (touches.size) {
        const byTarget = new Map<EventTarget, Touch[]>();
        for (const { touch, target } of touches.values()) {
          const key = live(target);
          byTarget.set(key, [...(byTarget.get(key) ?? []), touch]);
        }
        touches.clear();
        for (const [target, list] of byTarget) {
          let ev: Event;
          try {
            ev = new win.TouchEvent("touchcancel", {
              bubbles: true,
              cancelable: false,
              composed: true,
              touches: [],
              targetTouches: [],
              changedTouches: list,
            });
          } catch {
            // Browsers without the TouchEvent constructor: a plain event carrying the same fields.
            ev = new win.Event("touchcancel", { bubbles: true, composed: true });
            for (const k of ["touches", "targetTouches"]) Object.defineProperty(ev, k, { value: [] });
            Object.defineProperty(ev, "changedTouches", { value: list });
          }
          target.dispatchEvent(ev);
        }
      }
      if (had) swallowCompat = true;
      return had;
    },

    inject(x, y) {
      const target = doc.elementFromPoint(x, y) ?? doc.body ?? doc.documentElement;
      const init: PointerEventInit = { pointerId: 9_999, pointerType: "touch", isPrimary: true, clientX: x, clientY: y };
      fire(target, "pointerdown", { ...init, buttons: 1 });
      fire(target, "pointerup", init);
      target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y }));
    },
  };
}
