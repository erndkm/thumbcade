import { readProbe } from "../probe/index.ts";

/**
 * Observes pointer input inside a SAME-ORIGIN game iframe without touching it, so a web host can
 * arbitrate feed gestures the way the native pager does (the game gets every touch immediately;
 * the feed claims retroactively). Cross-origin frames can't be observed: `attached` stays false and
 * the host should fall back to Dock-only navigation.
 *
 * When the frame runs the probe (`@thumbcade/sdk/probe`, injected before any game script), input is
 * read from it: its listeners run before the SDK's, so the host keeps seeing a gesture the SDK
 * swallowed after `input.cancel`. Without the probe, listeners are attached on load (the host then
 * stops seeing a claimed gesture once the SDK swallows it — fine for taps, lossy for drags).
 *
 * Coordinates are CSS px relative to the iframe's viewport.
 */

export interface FrameInputEvent {
  kind: "down" | "move" | "up" | "cancel" | "wheel";
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  x: number;
  y: number;
  /** Wheel deltas (wheel only). */
  dx: number;
  dy: number;
  /** Modifier keys, so desktop users can emulate a two-finger swipe (alt/option + drag). */
  altKey: boolean;
  shiftKey: boolean;
  /** `performance.now()` of the parent window. */
  t: number;
  /** Synthesized by the SDK (e.g. the pointercancel that follows input.cancel). */
  synthetic: boolean;
}

export type FrameInputListener = (e: FrameInputEvent) => void;

export interface FrameInputObserver {
  /** True while listeners are attached to the current document. */
  readonly attached: boolean;
  /** True when input comes from the probe (lossless during feed drags). */
  readonly viaProbe: boolean;
  stop(): void;
}

const KINDS: Record<string, FrameInputEvent["kind"]> = {
  pointerdown: "down",
  pointermove: "move",
  pointerup: "up",
  pointercancel: "cancel",
  wheel: "wheel",
};

export function observeFrameInput(iframe: HTMLIFrameElement, listener: FrameInputListener): FrameInputObserver {
  let attachedTo: Window | null = null;
  let unsubscribeProbe: (() => void) | null = null;
  const handler = (ev: Event) => {
    const e = ev as PointerEvent & WheelEvent;
    const kind = KINDS[ev.type];
    if (!kind) return;
    listener({
      kind,
      pointerId: e.pointerId ?? 1,
      pointerType: e.pointerType || "mouse",
      isPrimary: e.isPrimary ?? true,
      x: e.clientX,
      y: e.clientY,
      dx: kind === "wheel" ? e.deltaX : 0,
      dy: kind === "wheel" ? e.deltaY : 0,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      t: performance.now(),
      synthetic: !e.isTrusted,
    });
  };
  const detach = () => {
    unsubscribeProbe?.();
    unsubscribeProbe = null;
    if (!attachedTo) return;
    for (const type of Object.keys(KINDS)) {
      try {
        attachedTo.removeEventListener(type, handler, true);
      } catch {
        /* the old document is gone */
      }
    }
    attachedTo = null;
  };
  const attach = () => {
    detach();
    try {
      const w = iframe.contentWindow;
      if (!w || !w.document) return;
      const probe = readProbe(w);
      if (probe?.onInput) {
        unsubscribeProbe = probe.onInput((e) => listener({ ...e, t: performance.now() }));
        attachedTo = w;
        return;
      }
      for (const type of Object.keys(KINDS)) w.addEventListener(type, handler, { capture: true, passive: true });
      attachedTo = w;
    } catch {
      attachedTo = null; // cross-origin
    }
  };
  iframe.addEventListener("load", attach);
  attach();
  return {
    get attached() {
      return attachedTo !== null;
    },
    get viaProbe() {
      return unsubscribeProbe !== null;
    },
    stop() {
      iframe.removeEventListener("load", attach);
      detach();
    },
  };
}
